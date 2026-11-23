import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockfishWorkerEngine } from '../../src/client/engine/stockfish';
import { parseUciLine, parseUciMove } from '../../src/client/engine/uci-parser';

describe('uci-parser', () => {
  it('parses uciok, readyok, and bestmove lines', () => {
    expect(parseUciLine('uciok')).toEqual({ type: 'uciok' });
    expect(parseUciLine('  readyok \r\n')).toEqual({ type: 'readyok' });
    expect(parseUciLine('bestmove e2e4 ponder e7e5')).toEqual({ type: 'bestmove', move: 'e2e4' });
    expect(parseUciLine('bestmove (none)')).toEqual({ type: 'bestmove', move: null });
    expect(parseUciLine('info depth 12 score cp 34')).toBeNull();
  });

  it('splits UCI move strings including promotion', () => {
    expect(parseUciMove('e2e4')).toEqual({ from: 'e2', to: 'e4' });
    expect(parseUciMove('a7a8q')).toEqual({ from: 'a7', to: 'a8', promotion: 'q' });
    expect(parseUciMove('h2h1n')).toEqual({ from: 'h2', to: 'h1', promotion: 'n' });
    expect(parseUciMove('bad')).toBeNull();
    expect(parseUciMove('e2e4k')).toBeNull();
    expect(parseUciMove('i2e4')).toBeNull();
  });
});

describe('StockfishWorkerEngine', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses /engine/stockfish-19-lite-single.js by default, runs UCI handshake, and ignores stale bestmove after stop', async () => {
    const createdUrls: string[] = [];
    const sent: string[] = [];
    let activeWorker: FakeWorker | null = null;

    class FakeWorker {
      onmessage: ((ev: { data: unknown }) => void) | null = null;
      onerror: ((ev: { message?: string }) => void) | null = null;
      terminated = false;

      constructor(url: string) {
        createdUrls.push(url);
        activeWorker = this;
      }

      postMessage(msg: string) {
        sent.push(msg);
        if (msg === 'uci') {
          queueMicrotask(() => this.onmessage?.({ data: 'uciok' }));
        } else if (msg === 'isready') {
          queueMicrotask(() => this.onmessage?.({ data: 'readyok' }));
        }
      }

      emit(line: string) {
        this.onmessage?.({ data: line });
      }

      terminate() {
        this.terminated = true;
      }
    }

    vi.stubGlobal('Worker', FakeWorker);

    const engine = new StockfishWorkerEngine();
    await engine.init();
    expect(createdUrls).toEqual(['/engine/stockfish-19-lite-single.js']);
    expect(sent).toEqual(['uci', 'isready']);

    // Start search A, then supersede it with search B
    const p1 = engine.getBestMove('startpos-fen-1', 'novice');
    await Promise.resolve();
    const p2 = engine.getBestMove('startpos-fen-2', 'club');
    await Promise.resolve();

    expect(await p1).toBeNull();

    // Emit stale bestmove from search A, then real bestmove from search B
    activeWorker!.emit('bestmove a2a3');
    activeWorker!.emit('bestmove e2e4');

    expect(await p2).toBe('e2e4');
    expect(sent).toContain('setoption name Skill Level value 7');
    expect(sent).toContain('position fen startpos-fen-2');
    expect(sent).toContain('go depth 8 movetime 450');

    engine.dispose();
    expect(activeWorker!.terminated).toBe(true);
  });

  it('rejects pending init on dispose() and does not let stale initTimer kill a re-initialized worker', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];

    class FakeWorker {
      onmessage: ((ev: { data: unknown }) => void) | null = null;
      onerror: ((ev: { message?: string }) => void) | null = null;
      terminated = false;
      autoHandshake: boolean;

      constructor() {
        this.autoHandshake = workers.length > 0;
        workers.push(this);
      }

      postMessage(msg: string) {
        if (!this.autoHandshake) return;
        if (msg === 'uci') {
          queueMicrotask(() => this.onmessage?.({ data: 'uciok' }));
        } else if (msg === 'isready') {
          queueMicrotask(() => this.onmessage?.({ data: 'readyok' }));
        }
      }

      terminate() {
        this.terminated = true;
      }
    }

    vi.stubGlobal('Worker', FakeWorker);

    const engine = new StockfishWorkerEngine();
    const firstInit = engine.init();
    expect(workers).toHaveLength(1);

    engine.dispose();
    await expect(firstInit).rejects.toThrow('disposed');
    expect(workers[0].terminated).toBe(true);

    // Re-initialize a healthy worker before the old 10s timer would have fired
    await engine.init();
    expect(workers).toHaveLength(2);
    expect(workers[1].terminated).toBe(false);

    // Advance past the 10s init timeout window
    await vi.advanceTimersByTimeAsync(11_000);
    expect(workers[1].terminated).toBe(false);

    engine.dispose();
  });

  it('resolves getBestMove() to null when stop() or dispose() is called during MIN_REPLY_MS delay', async () => {
    vi.useFakeTimers();
    let activeWorker: FakeWorker | null = null;
    const sent: string[] = [];

    class FakeWorker {
      onmessage: ((ev: { data: unknown }) => void) | null = null;
      onerror: ((ev: { message?: string }) => void) | null = null;
      terminated = false;

      constructor() {
        activeWorker = this;
      }

      postMessage(msg: string) {
        sent.push(msg);
        if (msg === 'uci') {
          queueMicrotask(() => this.onmessage?.({ data: 'uciok' }));
        } else if (msg === 'isready') {
          queueMicrotask(() => this.onmessage?.({ data: 'readyok' }));
        }
      }

      emit(line: string) {
        this.onmessage?.({ data: line });
      }

      terminate() {
        this.terminated = true;
      }
    }

    vi.stubGlobal('Worker', FakeWorker);

    const engine = new StockfishWorkerEngine();
    await engine.init();

    // Case 1: stop() during MIN_REPLY_MS delay
    const movePromise1 = engine.getBestMove('fen-1', 'novice');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.at(-1)).toBe('go depth 4 movetime 250');
    activeWorker!.emit('bestmove e2e4');
    await vi.advanceTimersByTimeAsync(50);
    engine.stop();
    expect(await movePromise1).toBeNull();
    // Search already finished before stop(), so no UCI 'stop' command was needed
    expect(sent.filter((m) => m === 'stop')).toHaveLength(0);

    // Case 2: dispose() during MIN_REPLY_MS delay
    const movePromise2 = engine.getBestMove('fen-2', 'novice');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.at(-1)).toBe('go depth 4 movetime 250');
    activeWorker!.emit('bestmove d2d4');
    await vi.advanceTimersByTimeAsync(50);
    engine.dispose();
    expect(await movePromise2).toBeNull();
  });

  it('rejects in-flight search and resets worker on post-init onerror so next getBestMove() spawns a fresh worker', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];

    class FakeWorker {
      onmessage: ((ev: { data: unknown }) => void) | null = null;
      onerror: ((ev: { message?: string }) => void) | null = null;
      terminated = false;

      constructor() {
        workers.push(this);
      }

      postMessage(msg: string) {
        if (msg === 'uci') {
          queueMicrotask(() => this.onmessage?.({ data: 'uciok' }));
        } else if (msg === 'isready') {
          queueMicrotask(() => this.onmessage?.({ data: 'readyok' }));
        }
      }

      emit(line: string) {
        this.onmessage?.({ data: line });
      }

      fail(message: string) {
        this.onerror?.({ message });
      }

      terminate() {
        this.terminated = true;
      }
    }

    vi.stubGlobal('Worker', FakeWorker);

    const engine = new StockfishWorkerEngine();
    await engine.init();
    expect(workers).toHaveLength(1);

    const failedSearch = engine.getBestMove('fen-crash', 'club');
    await vi.advanceTimersByTimeAsync(0);
    workers[0].fail('WASM OOM');

    await expect(failedSearch).rejects.toThrow('WASM OOM');
    expect(workers[0].terminated).toBe(true);

    // Next getBestMove() should spawn a fresh worker and succeed
    const recoveredSearch = engine.getBestMove('fen-recover', 'club');
    await vi.advanceTimersByTimeAsync(0);
    expect(workers).toHaveLength(2);
    expect(workers[1].terminated).toBe(false);

    workers[1].emit('bestmove g1f3');
    await vi.advanceTimersByTimeAsync(350);
    expect(await recoveredSearch).toBe('g1f3');

    engine.dispose();
  });
});

