import { Chess } from 'chess.js';
import type { ClockState, Color, GameResult } from './protocol';
import { TIME_CONTROLS, type TimeControlId } from './time-controls';

export function createInitialClock(tc: TimeControlId, now: number): ClockState {
  const cfg = TIME_CONTROLS[tc];
  return {
    wMs: cfg.initialMs,
    bMs: cfg.initialMs,
    incrementMs: cfg.incrementMs,
    running: false,
    lastTickAt: now,
  };
}

export function computeRemainingMs(
  clock: ClockState,
  activeColor: Color,
  now: number,
): { wMs: number; bMs: number } {
  if (!clock.running) {
    return { wMs: clock.wMs, bMs: clock.bMs };
  }
  const elapsed = Math.max(0, now - clock.lastTickAt);
  if (activeColor === 'w') {
    return { wMs: Math.max(0, clock.wMs - elapsed), bMs: clock.bMs };
  }
  return { wMs: clock.wMs, bMs: Math.max(0, clock.bMs - elapsed) };
}

export function hasSufficientMatingMaterial(fen: string, color: Color): boolean {
  const chess = new Chess(fen);
  const pieces = chess
    .board()
    .flat()
    .filter((p): p is NonNullable<typeof p> => p !== null && p.color === color && p.type !== 'k');

  if (pieces.length === 0) return false;
  if (pieces.some((p) => p.type === 'p' || p.type === 'q' || p.type === 'r')) return true;
  if (pieces.length === 1 && (pieces[0].type === 'b' || pieces[0].type === 'n')) return false;
  return true;
}

export function resolveTimeoutResult(fen: string, flaggedColor: Color): GameResult {
  const opponent: Color = flaggedColor === 'w' ? 'b' : 'w';
  if (!hasSufficientMatingMaterial(fen, opponent)) {
    return { winner: 'draw', reason: 'timeout_vs_insufficient' };
  }
  return { winner: opponent, reason: 'timeout' };
}
