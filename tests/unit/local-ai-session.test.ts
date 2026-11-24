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
});
