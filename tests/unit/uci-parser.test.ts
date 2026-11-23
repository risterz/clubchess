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
});

