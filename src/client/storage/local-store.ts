import { sanitizeDisplayName, type Color, type GameResult } from '../../shared/protocol';
import type { TimeControlId } from '../../shared/time-controls';

export type UiTheme = 'dark' | 'light';
export type BoardTheme = 'walnut' | 'slate' | 'linen';

export interface UserPrefs {
  nickname: string;
  uiTheme: UiTheme;
  boardTheme: BoardTheme;
  soundEnabled: boolean;
}

export interface SavedGame {
  id: string;
  mode: 'solo' | 'online';
  playedAt: number;
  timeControl: TimeControlId;
  whiteName: string;
  blackName: string;
  userColor: Color;
  result: GameResult;
  pgn: string;
  finalFen: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const PREFS_KEY = 'clubchess:v1:prefs';
const SEATS_KEY = 'clubchess:v1:seats';
const HISTORY_KEY = 'clubchess:v1:history';
const MAX_SEATS = 20;
const MAX_HISTORY = 50;

const DEFAULT_PREFS: UserPrefs = {
  nickname: 'Club Player',
  uiTheme: 'dark',
  boardTheme: 'walnut',
  soundEnabled: true,
};

export function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

function getDefaultStorage(): StorageLike {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : createMemoryStorage();
  } catch {
    return createMemoryStorage();
  }
}

function safeSetItem(storage: StorageLike, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage quota / private-browsing errors
  }
}

function safeReadJson<T>(storage: StorageLike, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadPrefs(storage: StorageLike = getDefaultStorage()): UserPrefs {
  const raw = safeReadJson<unknown>(storage, PREFS_KEY, {});
  const parsed: Partial<UserPrefs> =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Partial<UserPrefs>) : {};
  return {
    nickname: sanitizeDisplayName(
      typeof parsed.nickname === 'string' ? parsed.nickname : DEFAULT_PREFS.nickname,
    ),
    uiTheme: parsed.uiTheme === 'light' ? 'light' : 'dark',
    boardTheme:
      parsed.boardTheme === 'slate' || parsed.boardTheme === 'linen' ? parsed.boardTheme : 'walnut',
    soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : true,
  };
}

export function savePrefs(prefs: UserPrefs, storage: StorageLike = getDefaultStorage()): void {
  safeSetItem(
    storage,
    PREFS_KEY,
    JSON.stringify({ ...prefs, nickname: sanitizeDisplayName(prefs.nickname) }),
  );
}

interface SeatEntry {
  roomId: string;
  token: string;
}

function readSeatEntries(storage: StorageLike): SeatEntry[] {
  const raw = safeReadJson<unknown>(storage, SEATS_KEY, []);
  return Array.isArray(raw) ? (raw as SeatEntry[]) : [];
}

export function getSeatToken(
  roomId: string,
  storage: StorageLike = getDefaultStorage(),
): string | undefined {
  return readSeatEntries(storage).find((e) => e.roomId === roomId)?.token;
}

export function saveSeatToken(
  roomId: string,
  token: string,
  storage: StorageLike = getDefaultStorage(),
): void {
  const entries = readSeatEntries(storage).filter((e) => e.roomId !== roomId);
  entries.unshift({ roomId, token });
  safeSetItem(storage, SEATS_KEY, JSON.stringify(entries.slice(0, MAX_SEATS)));
}

export function loadHistory(storage: StorageLike = getDefaultStorage()): SavedGame[] {
  const items = safeReadJson<unknown>(storage, HISTORY_KEY, []);
  return Array.isArray(items) ? (items as SavedGame[]) : [];
}

export function appendHistory(
  game: SavedGame,
  storage: StorageLike = getDefaultStorage(),
): SavedGame[] {
  const existing = loadHistory(storage).filter((g) => g.id !== game.id);
  const next = [game, ...existing].slice(0, MAX_HISTORY);
  safeSetItem(storage, HISTORY_KEY, JSON.stringify(next));
  return next;
}
