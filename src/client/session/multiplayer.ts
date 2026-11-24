import { Chess } from 'chess.js';
import { createInitialClock } from '../../shared/clock';
import type {
  ClientRoomMessage,
  PromotionPiece,
  ServerRoomMessage,
} from '../../shared/protocol';
import { getSeatToken, saveSeatToken } from '../storage/local-store';
import type { GameSession, GameSessionState } from './types';

export interface MultiplayerOptions {
  roomId: string;
  playerName: string;
  onGameEnd?: (state: GameSessionState, pgn: string) => void;
}

const STARTING_FEN = new Chess().fen();

export class MultiplayerSession implements GameSession {
  private ws: WebSocket | null = null;
  private listeners = new Set<(state: GameSessionState) => void>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private terminalError = false;
  private moveSeq = 0;
  private recordedGameEnd = false;
  private state: GameSessionState;

  constructor(private options: MultiplayerOptions) {
    this.state = {
      mode: 'online',
      roomId: options.roomId,
      timeControl: '5+0',
      status: 'waiting',
      fen: STARTING_FEN,
      moves: [],
      clocks: createInitialClock('5+0', Date.now()),
      players: { w: null, b: null },
      yourRole: 'spectator',
      drawOfferBy: null,
      rematchBy: [],
      result: null,
      connectionStatus: 'connecting',
      isAiThinking: false,
      errorMessage: null,
      clockOffsetMs: 0,
    };
  }

  start(): void {
    this.connect();
  }

  getState(): GameSessionState {
    return this.state;
  }

  subscribe(listener: (state: GameSessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snap = this.state;
    for (const l of this.listeners) l(snap);
  }

  private connect(): void {
    if (this.disposed || this.terminalError) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws/room/${encodeURIComponent(this.options.roomId)}`;
    this.state = {
      ...this.state,
      connectionStatus: this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting',
    };
    this.emit();

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws || this.disposed) return;
      this.reconnectAttempt = 0;
      this.state = {
        ...this.state,
        connectionStatus: 'connected',
        errorMessage: null,
      };
      const seatToken = getSeatToken(this.options.roomId);
      this.send({ type: 'join', name: this.options.playerName, ...(seatToken ? { seatToken } : {}) });
      this.emit();
    };

    ws.onmessage = (ev) => {
      if (this.ws !== ws || this.disposed) return;
      let msg: ServerRoomMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerRoomMessage;
      } catch {
        return;
      }
      this.handleMessage(msg);
    };

    ws.onclose = (ev) => {
      if (this.ws !== ws || this.disposed || this.terminalError) return;
      if (ev?.code === 1000 && ev?.reason === 'Room expired') {
        this.stopReconnecting('Room expired');
        return;
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose handles reconnect
    };
  }

  private stopReconnecting(message: string): void {
    this.terminalError = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.state = {
      ...this.state,
      connectionStatus: 'error',
      errorMessage: message,
    };
    this.emit();
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.terminalError) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const base = Math.min(10_000, 500 * 2 ** this.reconnectAttempt);
    const jitter = Math.floor(Math.random() * 250);
    this.reconnectAttempt++;
    this.state = {
      ...this.state,
      connectionStatus: 'reconnecting',
    };
    this.emit();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, base + jitter);
  }

  private handleMessage(msg: ServerRoomMessage): void {
    switch (msg.type) {
      case 'room_state':
        if (msg.seatToken) {
          saveSeatToken(this.options.roomId, msg.seatToken);
        }
        if (msg.status !== 'finished') {
          this.recordedGameEnd = false;
        }
        this.state = {
          ...this.state,
          timeControl: msg.timeControl,
          status: msg.status,
          fen: msg.fen,
          moves: [...msg.moves],
          clocks: { ...msg.clocks },
          players: {
            w: msg.players.w ? { ...msg.players.w } : null,
            b: msg.players.b ? { ...msg.players.b } : null,
          },
          yourRole: msg.yourRole,
          drawOfferBy: msg.drawOfferBy,
          rematchBy: [...msg.rematchBy],
          result: msg.result ? { ...msg.result } : null,
          errorMessage: null,
          clockOffsetMs: msg.serverNow - Date.now(),
        };
        this.emit();
        break;

      case 'move_applied': {
        this.state = {
          ...this.state,
          fen: msg.move.fen,
          moves: [...this.state.moves, msg.move],
          clocks: { ...msg.clocks },
          drawOfferBy: null,
          status: msg.result ? 'finished' : this.state.status,
          result: msg.result ? { ...msg.result } : this.state.result,
          clockOffsetMs: msg.serverNow - Date.now(),
        };
        this.emit();
        if (msg.result) this.recordEndOnce();
        break;
      }

      case 'presence': {
        const current = this.state.players[msg.color];
        if (current) {
          this.state = {
            ...this.state,
            players: {
              ...this.state.players,
              [msg.color]: { ...current, online: msg.online, graceDeadlineAt: msg.graceDeadlineAt },
            },
            clockOffsetMs: msg.serverNow - Date.now(),
          };
          this.emit();
        }
        break;
      }

      case 'draw_offered':
        this.state = { ...this.state, drawOfferBy: msg.by };
        this.emit();
        break;

      case 'draw_declined':
        this.state = { ...this.state, drawOfferBy: null };
        this.emit();
        break;

      case 'rematch_updated':
        this.state = { ...this.state, rematchBy: [...msg.rematchBy] };
        this.emit();
        break;

      case 'game_over':
        this.state = {
          ...this.state,
          status: 'finished',
          clocks: { ...msg.clocks },
          result: { ...msg.result },
          drawOfferBy: null,
          clockOffsetMs: msg.serverNow - Date.now(),
        };
        this.emit();
        this.recordEndOnce();
        break;

      case 'error':
        if (msg.code === 'ROOM_NOT_FOUND') {
          this.terminalError = true;
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          this.state = {
            ...this.state,
            fen: msg.revertFen ?? this.state.fen,
            connectionStatus: 'error',
            errorMessage: msg.message,
          };
          this.emit();
          this.ws?.close(1000, 'Room not found');
          return;
        }
        this.state = {
          ...this.state,
          fen: msg.revertFen ?? this.state.fen,
          errorMessage: msg.message,
        };
        this.emit();
        break;

      case 'pong':
        this.state = {
          ...this.state,
          clockOffsetMs: msg.serverNow - Date.now(),
        };
        break;
    }
  }

  private recordEndOnce(): void {
    if (this.recordedGameEnd || this.state.yourRole === 'spectator') return;
    this.recordedGameEnd = true;
    this.options.onGameEnd?.(this.state, this.getPgn());
  }

  private send(msg: ClientRoomMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  makeMove(from: string, to: string, promotion?: PromotionPiece): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    if (this.state.status !== 'active' || this.state.yourRole === 'spectator') return false;
    const chess = new Chess(this.state.fen);
    if (chess.turn() !== this.state.yourRole) return false;
    try {
      const ok = chess.move({ from, to, promotion });
      if (!ok) return false;
    } catch {
      return false;
    }

    // Optimistic board preview; server move_applied or error(revertFen) reconciles
    this.state = { ...this.state, fen: chess.fen(), errorMessage: null };
    this.emit();
    this.send({ type: 'move', from, to, ...(promotion ? { promotion } : {}), seq: ++this.moveSeq });
    return true;
  }

  resign(): void {
    this.send({ type: 'resign' });
  }

  offerDraw(): void {
    this.send({ type: 'draw_offer' });
  }

  respondDraw(accept: boolean): void {
    this.send({ type: 'draw_response', accept });
  }

  requestRematch(): void {
    this.send({ type: 'rematch_request' });
  }

  claimAbandonment(): void {
    this.send({ type: 'claim_abandonment' });
  }

  retryAi(): void {}

  getPgn(): string {
    const chess = new Chess();
    for (const m of this.state.moves) {
      chess.move(m.san);
    }
    return chess.pgn();
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close(1000, 'Leave room');
    this.ws = null;
    this.listeners.clear();
  }
}
