import { describe, expect, it } from 'vitest';
import {
  computeRemainingMs,
  createInitialClock,
  hasSufficientMatingMaterial,
  resolveTimeoutResult,
} from '../../src/shared/clock';

describe('clock', () => {
  it('does not deduct time before clock is running', () => {
    const clock = createInitialClock('3+2', 1000);
    expect(computeRemainingMs(clock, 'w', 5000)).toEqual({ wMs: 180_000, bMs: 180_000 });
  });

  it('deducts elapsed time only from active side when running', () => {
    const clock = { ...createInitialClock('3+2', 1000), running: true, lastTickAt: 1000 };
    expect(computeRemainingMs(clock, 'b', 4500)).toEqual({ wMs: 180_000, bMs: 176_500 });
  });

  it('clamps remaining time at 0', () => {
    const clock = { wMs: 1000, bMs: 5000, incrementMs: 0, running: true, lastTickAt: 1000 };
    expect(computeRemainingMs(clock, 'w', 5000)).toEqual({ wMs: 0, bMs: 5000 });
  });

  it('returns draw on timeout vs insufficient mating material', () => {
    // White has lone King, Black has King + Knight -> Black cannot mate if White flags
    const knOnlyFen = '4k3/8/8/8/8/8/8/4K1n1 w - - 0 1';
    expect(hasSufficientMatingMaterial(knOnlyFen, 'b')).toBe(false);
    expect(resolveTimeoutResult(knOnlyFen, 'w')).toEqual({
      winner: 'draw',
      reason: 'timeout_vs_insufficient',
    });

    // Black has King + Rook -> sufficient mating material
    const krFen = '4k3/8/8/8/8/8/8/4K1r1 w - - 0 1';
    expect(hasSufficientMatingMaterial(krFen, 'b')).toBe(true);
    expect(resolveTimeoutResult(krFen, 'w')).toEqual({
      winner: 'b',
      reason: 'timeout',
    });
  });
});
