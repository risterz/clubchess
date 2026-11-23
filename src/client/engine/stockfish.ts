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
  private initTimer: ReturnType<typeof setTimeout> | null = null;
  private initReject: ((err: Error) => void) | null = null;
  private pendingResolve: ((move: string | null) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private replyTimer: ReturnType<typeof setTimeout> | null = null;
  private replyResolve: (() => void) | null = null;
  private searchToken = 0;
  private staleBestMoves = 0;
  private workerUrl: string;

  constructor(workerUrl = '/engine/stockfish-19-lite-single.js') {
    this.workerUrl = workerUrl;
  }

  async init(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.initReject = reject;
      try {
        const w = new Worker(this.workerUrl);
        this.worker = w;
        this.initTimer = setTimeout(() => {
          if (this.worker !== w) return;
          this.resetWorker(new Error('Stockfish failed to initialize within 10s'));
        }, SEARCH_TIMEOUT_MS);

        w.onerror = (ev) => {
          if (this.worker !== w) return;
          const err = new Error(ev.message || 'Stockfish worker error');
          this.rejectPending(err);
          this.resetWorker(err);
        };

        w.onmessage = (ev) => {
          if (this.worker !== w) return;
          const parsed = parseUciLine(String(ev.data ?? ''));
          if (!parsed) return;
          if (parsed.type === 'uciok') {
            w.postMessage('isready');
          } else if (parsed.type === 'readyok') {
            if (this.initTimer) {
              clearTimeout(this.initTimer);
              this.initTimer = null;
            }
            this.initReject = null;
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
        this.resetWorker(err instanceof Error ? err : new Error('Unable to start Stockfish worker'));
      }
    });
    return this.readyPromise;
  }

  async getBestMove(fen: string, difficulty: AiDifficultyId): Promise<string | null> {
    await this.init();
    const w = this.worker;
    if (!w) throw new Error('Engine not initialized');

    this.stop();
    const token = this.searchToken;
    const cfg = AI_DIFFICULTIES[difficulty];
    const startedAt = Date.now();

    const move = await new Promise<string | null>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.timeoutId = setTimeout(() => {
        if (this.worker !== w) return;
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

    if (move === null || this.searchToken !== token) return null;

    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_REPLY_MS) {
      await new Promise<void>((resolve) => {
        this.replyResolve = resolve;
        this.replyTimer = setTimeout(() => {
          this.replyTimer = null;
          this.replyResolve = null;
          resolve();
        }, MIN_REPLY_MS - elapsed);
      });
    }
    if (this.searchToken !== token) return null;
    return move;
  }

  stop(): void {
    this.searchToken += 1;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.replyTimer) {
      clearTimeout(this.replyTimer);
      this.replyTimer = null;
    }
    const replyRes = this.replyResolve;
    this.replyResolve = null;
    replyRes?.();

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
    this.resetWorker(new Error('Stockfish engine disposed'));
  }

  private resetWorker(initError?: Error): void {
    if (this.initTimer) {
      clearTimeout(this.initTimer);
      this.initTimer = null;
    }
    const initRej = this.initReject;
    this.initReject = null;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.readyPromise = null;
    this.staleBestMoves = 0;
    if (initRej) {
      initRej(initError ?? new Error('Stockfish worker reset'));
    }
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
