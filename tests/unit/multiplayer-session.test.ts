import { Chess } from 'chess.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerRoomMessage } from '../../src/shared/protocol';
import { MultiplayerSession } from '../../src/client/session/multiplayer';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  public readyState = FakeWebSocket.CONNECTING;
  public sent: string[] = [];
  public onopen: (() => void) | null = null;
  public onmessage: ((ev: { data: string }) => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: (() => void) | null = null;

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(msg: ServerRoomMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  drop(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

const START_FEN = new Chess().fen();

function makeActiveRoomState(overrides: Partial<Extract<ServerRoomMessage, { type: 'room_state' }>> = {}): Extract<ServerRoomMessage, { type: 'room_state' }> {
  return {
    type: 'room_state',
    roomId: 'RM1001',
    timeControl: '5+0',
    status: 'active',
    fen: START_FEN,
    moves: [],
    clocks: { wMs: 300_000, bMs: 300_000, incrementMs: 0, running: false, lastTickAt: Date.now() },
    players: {
      w: { name: 'Ada', online: true, graceDeadlineAt: null },
      b: { name: 'Grace', online: true, graceDeadlineAt: null },
    },
    yourRole: 'w',
    drawOfferBy: null,
    rematchBy: [],
    result: null,
    serverNow: Date.now(),
    ...overrides,
  };
}

describe('MultiplayerSession', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'clubchess.example' },
    });
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('rejects makeMove without mutating FEN when WebSocket is not OPEN', () => {
    const session = new MultiplayerSession({ roomId: 'RM1001', playerName: 'Ada' });

    // Before start(): ws is null
    expect(session.makeMove('e2', 'e4')).toBe(false);
    expect(session.getState().fen).toBe(START_FEN);

    session.start();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.receive(makeActiveRoomState());

    // Simulate connection drop (socket is no longer OPEN)
    ws.drop();
    const stateBeforeMove = session.getState();
    const sentCountBefore = ws.sent.length;

    expect(session.makeMove('e2', 'e4')).toBe(false);
    expect(session.getState()).toBe(stateBeforeMove);
    expect(session.getState().fen).toBe(START_FEN);
    expect(ws.sent.length).toBe(sentCountBefore);

    session.dispose();
  });

  it('returns a new state reference from getState() on every state update', () => {
    const session = new MultiplayerSession({ roomId: 'RM1001', playerName: 'Ada' });
    const s0 = session.getState();

    session.start();
    const s1 = session.getState();
    expect(s1).not.toBe(s0);

    const ws = FakeWebSocket.instances[0];
    ws.open();
    const s2 = session.getState();
    expect(s2).not.toBe(s1);
    expect(s1.connectionStatus).toBe('connecting');
    expect(s2.connectionStatus).toBe('connected');

    ws.receive(makeActiveRoomState());
    const s3 = session.getState();
    expect(s3).not.toBe(s2);

    ws.receive({ type: 'pong', ts: Date.now(), serverNow: Date.now() + 50 });
    const s4 = session.getState();
    expect(s4).not.toBe(s3);

    expect(session.makeMove('e2', 'e4')).toBe(true);
    const s5 = session.getState();
    expect(s5).not.toBe(s4);
    expect(s4.fen).toBe(START_FEN);
    expect(s5.fen).not.toBe(START_FEN);

    ws.drop();
    const s6 = session.getState();
    expect(s6).not.toBe(s5);
    expect(s5.connectionStatus).toBe('connected');
    expect(s6.connectionStatus).toBe('reconnecting');

    session.dispose();
  });

  it('resets recordedGameEnd when reconnecting to a non-finished rematch that already has moves', () => {
    const onGameEnd = vi.fn();
    const session = new MultiplayerSession({
      roomId: 'RM1001',
      playerName: 'Ada',
      onGameEnd,
    });

    session.start();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.receive(makeActiveRoomState());

    // First game finishes
    ws.receive({
      type: 'game_over',
      result: { winner: 'b', reason: 'resignation' },
      clocks: { wMs: 290_000, bMs: 295_000, incrementMs: 0, running: false, lastTickAt: Date.now() },
      serverNow: Date.now(),
    });
    expect(onGameEnd).toHaveBeenCalledTimes(1);

    // Reconnecting to an already-finished game must NOT re-trigger onGameEnd
    ws.receive(
      makeActiveRoomState({
        status: 'finished',
        result: { winner: 'b', reason: 'resignation' },
      }),
    );
    expect(onGameEnd).toHaveBeenCalledTimes(1);

    // Rematch begins and opponent has already played 1. e4 before reconnect sync arrives
    const chessAfterE4 = new Chess();
    chessAfterE4.move('e4');
    ws.receive(
      makeActiveRoomState({
        status: 'active',
        yourRole: 'b',
        fen: chessAfterE4.fen(),
        moves: [
          {
            san: 'e4',
            uci: 'e2e4',
            fen: chessAfterE4.fen(),
            wMs: 300_000,
            bMs: 300_000,
          },
        ],
      }),
    );

    // Rematch ends -> onGameEnd must fire again
    ws.receive({
      type: 'game_over',
      result: { winner: 'b', reason: 'checkmate' },
      clocks: { wMs: 250_000, bMs: 260_000, incrementMs: 0, running: false, lastTickAt: Date.now() },
      serverNow: Date.now(),
    });
    expect(onGameEnd).toHaveBeenCalledTimes(2);

    session.dispose();
  });
});
