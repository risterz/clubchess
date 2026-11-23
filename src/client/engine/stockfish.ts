import { parseUciLine } from './uci-parser';

export type AiDifficultyId = 'novice' | 'club' | 'candidate' | 'master';

export interface AiDifficultyConfig {
  id: AiDifficultyId;
  label: string;
  eloLabel: string;
  skillLevel: number;
  depth: number;
  movetimeMs: number;
}

export const AI_DIFFICULTIES: Record<AiDifficultyId, AiDifficultyConfig> = {
  novice: { id: 'novice', label: 'Novice', eloLabel: '~800', skillLevel: 2, depth: 4, movetimeMs: 250 },
  club: { id: 'club', label: 'Club', eloLabel: '~1300', skillLevel: 7, depth: 8, movetimeMs: 450 },
  candidate: { id: 'candidate', label: 'Candidate', eloLabel: '~1800', skillLevel: 14, depth: 12, movetimeMs: 700 },
  master: { id: 'master', label: 'Master', eloLabel: '~2200', skillLevel: 20, depth: 16, movetimeMs: 1100 },
};

export const AI_DIFFICULTY_LIST = Object.values(AI_DIFFICULTIES);

export interface AiEngine {
  init(): Promise<void>;
  getBestMove(fen: string, difficulty: AiDifficultyId): Promise<string | null>;
  stop(): void;
  dispose(): void;
}

const MIN_REPLY_MS = 300;
const SEARCH_TIMEOUT_MS = 10_000;

export class StockfishWorkerEngine implements AiEngine {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private pendingResolve: ((move: string | null) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private staleBestMoves = 0;
  private workerUrl: string;

  constructor(workerUrl = '/engine/stockfish-19-lite-single.js') {
    this.workerUrl = workerUrl;
  }

  async init(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      let initialized = false;
      try {
        const w = new Worker(this.workerUrl);
        this.worker = w;
        const initTimer = setTimeout(() => {
          if (!initialized) {
            this.resetWorker();
            reject(new Error('Stockfish failed to initialize within 10s'));
          }
        }, SEARCH_TIMEOUT_MS);

        w.onerror = (ev) => {
          clearTimeout(initTimer);
          const err = new Error(ev.message || 'Stockfish worker error');
          this.rejectPending(err);
          if (!initialized) {
            this.resetWorker();
            reject(err);
          }
        };

        w.onmessage = (ev) => {
          const parsed = parseUciLine(String(ev.data ?? ''));
          if (!parsed) return;
          if (parsed.type === 'uciok') {
            w.postMessage('isready');
          } else if (parsed.type === 'readyok') {
            initialized = true;
            clearTimeout(initTimer);
            resolve();
          } else if (parsed.type === 'bestmove') {
            if (this.staleBestMoves > 0) {
              this.staleBestMoves -= 1;
              return;
            }
            this.resolvePending(parsed.move);
          }
        };

        w.postMessage('uci');
      } catch (err) {
        this.resetWorker();
        reject(err instanceof Error ? err : new Error('Unable to start Stockfish worker'));
      }
    });
    return this.readyPromise;
  }

  async getBestMove(fen: string, difficulty: AiDifficultyId): Promise<string | null> {
    await this.init();
    const w = this.worker;
    if (!w) throw new Error('Engine not initialized');

    this.stop();
    const cfg = AI_DIFFICULTIES[difficulty];
    const startedAt = Date.now();

    const move = await new Promise<string | null>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.timeoutId = setTimeout(() => {
        if (this.pendingResolve) {
          this.staleBestMoves += 1;
          w.postMessage('stop');
          this.rejectPending(new Error('Stockfish timed out'));
        }
      }, SEARCH_TIMEOUT_MS);

      w.postMessage(`setoption name Skill Level value ${cfg.skillLevel}`);
      w.postMessage(`position fen ${fen}`);
      w.postMessage(`go depth ${cfg.depth} movetime ${cfg.movetimeMs}`);
    });

    if (move === null) return null;

    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_REPLY_MS) {
      await new Promise((r) => setTimeout(r, MIN_REPLY_MS - elapsed));
    }
    return move;
  }

  stop(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    const res = this.pendingResolve;
    if (this.worker && res) {
      this.staleBestMoves += 1;
      this.worker.postMessage('stop');
    }
    this.pendingResolve = null;
    this.pendingReject = null;
    res?.(null);
  }

  dispose(): void {
    this.stop();
    this.resetWorker();
  }

  private resetWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.readyPromise = null;
    this.staleBestMoves = 0;
  }

  private resolvePending(move: string | null): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    const res = this.pendingResolve;
    this.pendingResolve = null;
    this.pendingReject = null;
    res?.(move);
  }

  private rejectPending(err: Error): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    const rej = this.pendingReject;
    this.pendingResolve = null;
    this.pendingReject = null;
    rej?.(err);
  }
}
