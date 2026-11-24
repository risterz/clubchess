import { describe, expect, it, vi } from 'vitest';
import type { AiEngine } from '../../src/client/engine/stockfish';
import { LocalAISession } from '../../src/client/session/local-ai';

class StubEngine implements AiEngine {
  public calls = 0;
  public stopCalls = 0;
  public disposeCalls = 0;

  constructor(private nextMove: string | null | (() => Promise<string | null>)) {}

  async init(): Promise<void> {}

  async getBestMove(): Promise<string | null> {
    this.calls += 1;
    if (typeof this.nextMove === 'function') {
      return this.nextMove();
    }
    return this.nextMove;
  }

  stop(): void {
    this.stopCalls += 1;
  }

  dispose(): void {
    this.disposeCalls += 1;
  }
}

describe('LocalAISession', () => {
  it('applies human move and triggers AI reply', async () => {
    const engine = new StubEngine('e7e5');
    const session = new LocalAISession(
      {
        playerName: 'Ada',
        playerColor: 'w',
        difficulty: 'club',
        timeControl: '5+0',
      },
      engine,
    );

    session.start();
    expect(session.getState().status).toBe('active');

    const ok = session.makeMove('e2', 'e4');
    expect(ok).toBe(true);

    // Wait for async stub AI turn
    await new Promise((r) => setTimeout(r, 20));
    const state = session.getState();
    expect(state.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
    expect(state.isAiThinking).toBe(false);
    expect(session.getPgn()).toContain('1. e4 e5');
    session.dispose();
  });

  it('allows resigning and starting a rematch with swapped colors', () => {
    const engine = new StubEngine('e2e4');
    const onGameEnd = vi.fn();
    const session = new LocalAISession(
      {
        playerName: 'Ada',
        playerColor: 'w',
        difficulty: 'novice',
        timeControl: 'unlimited',
        onGameEnd,
      },
      engine,
    );
    session.start();
    session.resign();
    expect(session.getState().result).toEqual({ winner: 'b', reason: 'resignation' });
    expect(onGameEnd).toHaveBeenCalledTimes(1);

    session.requestRematch();
    expect(session.getState().yourRole).toBe('b');
    expect(session.getState().status).toBe('active');
    session.dispose();
  });

  it('triggers AI first move when human plays black and rejects moves out of turn', async () => {
    const engine = new StubEngine('d2d4');
    const session = new LocalAISession(
      {
        playerName: 'Ada',
        playerColor: 'b',
        difficulty: 'club',
        timeControl: 'unlimited',
      },
      engine,
    );

    session.start();
    expect(session.makeMove('e7', 'e5')).toBe(false);

    await new Promise((r) => setTimeout(r, 20));
    expect(session.getState().moves.map((m) => m.san)).toEqual(['d4']);
    expect(session.makeMove('d7', 'd5')).toBe(true);
    session.dispose();
  });

  it('sets errorMessage on engine failure and recovers via retryAi', async () => {
    let shouldFail = true;
    const engine = new StubEngine(async () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('timeout');
      }
      return 'e7e5';
    });

    const session = new LocalAISession(
      {
        playerName: 'Ada',
        playerColor: 'w',
        difficulty: 'club',
        timeControl: 'unlimited',
      },
      engine,
    );

    session.start();
    expect(session.makeMove('e2', 'e4')).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    expect(session.getState().errorMessage).toBe('Engine unresponsive — Retry');
    expect(session.getState().isAiThinking).toBe(false);

    session.retryAi();
    await new Promise((r) => setTimeout(r, 20));
    expect(session.getState().errorMessage).toBeNull();
    expect(session.getState().moves.map((m) => m.san)).toEqual(['e4', 'e5']);
    session.dispose();
  });

  it('preserves clocks and avoids double deduction on illegal move attempts in timed games', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-24T12:00:00.000Z'));
      let replyIndex = 0;
      const replies = ['e7e5', 'b8c6'];
      const engine = new StubEngine(async () => replies[replyIndex++] ?? null);
      const session = new LocalAISession(
        {
          playerName: 'Ada',
          playerColor: 'w',
          difficulty: 'club',
          timeControl: '5+0',
        },
        engine,
      );

      session.start();
      // First move starts the clock without deducting from white
      expect(session.makeMove('e2', 'e4')).toBe(true);
      await vi.advanceTimersByTimeAsync(0);

      const afterAiReply = session.getState();
      expect(afterAiReply.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
      expect(afterAiReply.clocks.running).toBe(true);
      const savedWMs = afterAiReply.clocks.wMs;
      const savedBMs = afterAiReply.clocks.bMs;
      const savedLastTickAt = afterAiReply.clocks.lastTickAt;

      // Advance 5 seconds, then attempt an illegal move
      vi.advanceTimersByTime(5_000);
      expect(session.makeMove('e4', 'e8')).toBe(false);

      const afterIllegal = session.getState();
      expect(afterIllegal).toBe(afterAiReply);
      expect(afterIllegal.clocks.wMs).toBe(savedWMs);
      expect(afterIllegal.clocks.bMs).toBe(savedBMs);
      expect(afterIllegal.clocks.lastTickAt).toBe(savedLastTickAt);

      // Advance 3 more seconds (8s total since lastTickAt) and make a legal move
      vi.advanceTimersByTime(3_000);
      expect(session.makeMove('g1', 'f3')).toBe(true);

      const afterLegal = session.getState();
      expect(afterLegal.clocks.wMs).toBe(savedWMs - 8_000);
      expect(afterLegal.clocks.bMs).toBe(savedBMs);
      expect(afterLegal.clocks.lastTickAt).toBe(savedLastTickAt + 8_000);

      session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sets errorMessage when AI returns null on an active turn and allows retryAi', async () => {
    let returnNull = true;
    const engine = new StubEngine(async () => {
      if (returnNull) {
        returnNull = false;
        return null;
      }
      return 'e7e5';
    });

    const session = new LocalAISession(
      {
        playerName: 'Ada',
        playerColor: 'w',
        difficulty: 'club',
        timeControl: 'unlimited',
      },
      engine,
    );

    session.start();
    expect(session.makeMove('e2', 'e4')).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    const stalled = session.getState();
    expect(stalled.isAiThinking).toBe(false);
    expect(stalled.errorMessage).toBe('Engine returned no move — Retry');
    expect(stalled.moves.map((m) => m.san)).toEqual(['e4']);

    session.retryAi();
    await new Promise((r) => setTimeout(r, 20));
    const recovered = session.getState();
    expect(recovered.isAiThinking).toBe(false);
    expect(recovered.errorMessage).toBeNull();
    expect(recovered.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
    session.dispose();
  });

  it('returns a new state reference from getState() on every state update without mutating prior snapshots', async () => {
    let resolveAi!: (move: string | null) => void;
    const engine = new StubEngine(
      () =>
        new Promise<string | null>((resolve) => {
          resolveAi = resolve;
        }),
    );

    const onGameEnd = vi.fn();
    const session = new LocalAISession(
      {
        playerName: 'Ada',
        playerColor: 'w',
        difficulty: 'club',
        timeControl: 'unlimited',
        onGameEnd,
      },
      engine,
    );

    const observed: ReturnType<typeof session.getState>[] = [];
    session.subscribe((s) => observed.push(s));

    const initial = session.getState();
    session.start();
    expect(session.makeMove('e2', 'e4')).toBe(true);
    const afterHumanMove = session.getState();
    expect(afterHumanMove).not.toBe(initial);
    expect(initial.moves).toEqual([]);
    expect(afterHumanMove.isAiThinking).toBe(true);

    resolveAi('e7e5');
    await new Promise((r) => setTimeout(r, 20));
    const afterAiMove = session.getState();
    expect(afterAiMove).not.toBe(afterHumanMove);
    expect(afterHumanMove.isAiThinking).toBe(true);
    expect(afterAiMove.isAiThinking).toBe(false);

    session.resign();
    const finished = session.getState();
    expect(finished).not.toBe(afterAiMove);
    expect(finished.status).toBe('finished');
    expect(onGameEnd).toHaveBeenCalledTimes(1);
    const endSnapshot = onGameEnd.mock.calls[0][0];
    expect(endSnapshot).toBe(finished);

    session.requestRematch();
    const rematched = session.getState();
    expect(rematched).not.toBe(finished);
    expect(endSnapshot.status).toBe('finished');
    expect(endSnapshot.result).toEqual({ winner: 'b', reason: 'resignation' });

    // Every emitted state is strictly distinct from the previous one
    for (let i = 1; i < observed.length; i++) {
      expect(observed[i]).not.toBe(observed[i - 1]);
    }
    session.dispose();
  });
});
