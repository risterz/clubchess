import { Chess } from 'chess.js';
import { computeRemainingMs, createInitialClock, resolveTimeoutResult } from '../../shared/clock';
import type { Color, GameResult, PromotionPiece } from '../../shared/protocol';
import type { TimeControlId } from '../../shared/time-controls';
import { AI_DIFFICULTIES, type AiDifficultyId, type AiEngine } from '../engine/stockfish';
import { parseUciMove } from '../engine/uci-parser';
import type { GameSession, GameSessionState } from './types';

export interface LocalAIOptions {
  playerName: string;
  playerColor: Color;
  difficulty: AiDifficultyId;
  timeControl: TimeControlId;
  onGameEnd?: (state: GameSessionState, pgn: string) => void;
}

export class LocalAISession implements GameSession {
  private chess = new Chess();
  private state: GameSessionState;
  private listeners = new Set<(state: GameSessionState) => void>();
  private timerId: ReturnType<typeof setInterval> | null = null;
  private turnGeneration = 0;

  constructor(
    private options: LocalAIOptions,
    private engine: AiEngine,
  ) {
    this.state = this.buildInitialState(options.playerColor);
  }

  private buildInitialState(playerColor: Color): GameSessionState {
    const now = Date.now();
    const diff = AI_DIFFICULTIES[this.options.difficulty];
    const aiName = `Stockfish (${diff.label})`;
    const human = { name: this.options.playerName, online: true, graceDeadlineAt: null };
    const ai = { name: aiName, online: true, graceDeadlineAt: null };
    return {
      mode: 'solo',
      timeControl: this.options.timeControl,
      status: 'active',
      fen: this.chess.fen(),
      moves: [],
      clocks: createInitialClock(this.options.timeControl, now),
      players: playerColor === 'w' ? { w: human, b: ai } : { w: ai, b: human },
      yourRole: playerColor,
      drawOfferBy: null,
      rematchBy: [],
      result: null,
      connectionStatus: 'local',
      isAiThinking: false,
      errorMessage: null,
      clockOffsetMs: 0,
    };
  }

  start(): void {
    this.startClockWatcher();
    if (this.state.yourRole === 'b') {
      void this.triggerAiTurn();
    }
  }

  getState(): GameSessionState {
    return this.state;
  }

  subscribe(listener: (state: GameSessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = { ...this.state };
    for (const l of this.listeners) l(snapshot);
  }

  private startClockWatcher(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.options.timeControl === 'unlimited') return;
    this.timerId = setInterval(() => {
      if (this.state.status !== 'active' || !this.state.clocks.running) return;
      const turn = this.chess.turn() as Color;
      const now = Date.now();
      const rem = computeRemainingMs(this.state.clocks, turn, now);
      if ((turn === 'w' ? rem.wMs : rem.bMs) <= 0) {
        this.state.clocks = { ...this.state.clocks, ...rem, running: false, lastTickAt: now };
        this.finish(resolveTimeoutResult(this.chess.fen(), turn));
      }
    }, 100);
  }

  private detectFideEnd(): GameResult | null {
    if (this.chess.isCheckmate()) {
      return { winner: this.chess.turn() === 'w' ? 'b' : 'w', reason: 'checkmate' };
    }
    if (this.chess.isStalemate()) return { winner: 'draw', reason: 'stalemate' };
    if (this.chess.isThreefoldRepetition()) return { winner: 'draw', reason: 'threefold' };
    if (this.chess.isInsufficientMaterial()) return { winner: 'draw', reason: 'insufficient_material' };
    if (this.chess.isDrawByFiftyMoves()) return { winner: 'draw', reason: 'fifty_move' };
    return null;
  }

  private applyCheckedMove(from: string, to: string, promotion?: PromotionPiece): boolean {
    if (this.state.status !== 'active') return false;
    const mover = this.chess.turn() as Color;
    const now = Date.now();

    if (this.options.timeControl !== 'unlimited' && this.state.clocks.running) {
      const rem = computeRemainingMs(this.state.clocks, mover, now);
      this.state.clocks = { ...this.state.clocks, ...rem };
      if ((mover === 'w' ? rem.wMs : rem.bMs) <= 0) {
        this.finish(resolveTimeoutResult(this.chess.fen(), mover));
        return false;
      }
    }

    let move;
    try {
      move = this.chess.move({ from, to, promotion });
    } catch {
      return false;
    }
    if (!move) return false;

    if (this.options.timeControl !== 'unlimited') {
      const nextClocks = { ...this.state.clocks };
      if (nextClocks.running) {
        if (mover === 'w') nextClocks.wMs += nextClocks.incrementMs;
        else nextClocks.bMs += nextClocks.incrementMs;
      }
      nextClocks.running = true;
      nextClocks.lastTickAt = now;
      this.state.clocks = nextClocks;
    }

    this.state.fen = this.chess.fen();
    this.state.moves = [
      ...this.state.moves,
      {
        san: move.san,
        uci: `${move.from}${move.to}${move.promotion ?? ''}`,
        fen: this.state.fen,
        wMs: this.state.clocks.wMs,
        bMs: this.state.clocks.bMs,
      },
    ];
    this.state.errorMessage = null;

    const result = this.detectFideEnd();
    if (result) {
      this.finish(result);
    } else {
      this.emit();
    }
    return true;
  }

  makeMove(from: string, to: string, promotion?: PromotionPiece): boolean {
    if (this.state.status !== 'active' || this.chess.turn() !== this.state.yourRole) return false;
    const applied = this.applyCheckedMove(from, to, promotion);
    if (applied && this.state.status === 'active') {
      void this.triggerAiTurn();
    }
    return applied;
  }

  private async triggerAiTurn(): Promise<void> {
    const gen = ++this.turnGeneration;
    this.state.isAiThinking = true;
    this.state.errorMessage = null;
    this.emit();

    try {
      const best = await this.engine.getBestMove(this.chess.fen(), this.options.difficulty);
      if (gen !== this.turnGeneration || this.state.status !== 'active') return;
      this.state.isAiThinking = false;
      if (!best) {
        this.emit();
        return;
      }
      const parsed = parseUciMove(best);
      if (!parsed || !this.applyCheckedMove(parsed.from, parsed.to, parsed.promotion)) {
        if (this.state.status === 'active') {
          this.state.errorMessage = 'Engine returned illegal move — Retry';
          this.emit();
        }
      }
    } catch {
      if (gen !== this.turnGeneration) return;
      this.state.isAiThinking = false;
      this.state.errorMessage = 'Engine unresponsive — Retry';
      this.emit();
    }
  }

  retryAi(): void {
    if (this.state.status === 'active' && this.chess.turn() !== this.state.yourRole) {
      void this.triggerAiTurn();
    }
  }

  private finish(result: GameResult): void {
    this.turnGeneration++;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.engine.stop();
    this.state.status = 'finished';
    this.state.isAiThinking = false;
    this.state.clocks = { ...this.state.clocks, running: false, lastTickAt: Date.now() };
    this.state.result = result;
    this.emit();
    this.options.onGameEnd?.(this.state, this.getPgn());
  }

  resign(): void {
    if (this.state.status !== 'active') return;
    const winner: Color = this.state.yourRole === 'w' ? 'b' : 'w';
    this.finish({ winner, reason: 'resignation' });
  }

  offerDraw(): void {
    // Disabled in solo mode
  }

  respondDraw(): void {}

  claimAbandonment(): void {}

  requestRematch(): void {
    this.turnGeneration++;
    this.engine.stop();
    this.chess.reset();
    const nextColor: Color = this.state.yourRole === 'w' ? 'b' : 'w';
    this.state = this.buildInitialState(nextColor);
    this.emit();
    this.startClockWatcher();
    if (nextColor === 'b') {
      void this.triggerAiTurn();
    }
  }

  getPgn(): string {
    return this.chess.pgn();
  }

  dispose(): void {
    this.turnGeneration++;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.engine.dispose();
    this.listeners.clear();
  }
}
