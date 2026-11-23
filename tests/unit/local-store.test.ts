import { describe, expect, it } from 'vitest';
import {
  appendHistory,
  createMemoryStorage,
  getSeatToken,
  loadHistory,
  loadPrefs,
  savePrefs,
  saveSeatToken,
  type SavedGame,
} from '../../src/client/storage/local-store';

function makeGame(id: string): SavedGame {
  return {
    id,
    mode: 'solo',
    playedAt: Date.now(),
    timeControl: '5+0',
    whiteName: 'Guest',
    blackName: 'Stockfish (Club)',
    userColor: 'w',
    result: { winner: 'w', reason: 'checkmate' },
    pgn: '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#',
    finalFen: 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4',
  };
}

describe('local-store', () => {
  it('returns defaults on empty or corrupted storage', () => {
    const store = createMemoryStorage();
    store.setItem('clubchess:v1:prefs', '{bad-json');
    const prefs = loadPrefs(store);
    expect(prefs.uiTheme).toBe('dark');
    expect(prefs.boardTheme).toBe('walnut');
    expect(prefs.soundEnabled).toBe(true);
    expect(prefs.nickname).toBe('Club Player');

    // Non-object / wrong-type JSON should also degrade safely
    store.setItem('clubchess:v1:prefs', 'null');
    store.setItem('clubchess:v1:seats', '{}');
    store.setItem('clubchess:v1:history', '"corrupt"');
    expect(loadPrefs(store).uiTheme).toBe('dark');
    expect(getSeatToken('RM0001', store)).toBeUndefined();
    expect(loadHistory(store)).toEqual([]);
  });

  it('persists prefs and caps seat tokens to 20 and history to 50', () => {
    const store = createMemoryStorage();
    savePrefs({ nickname: 'Kasparov', uiTheme: 'light', boardTheme: 'slate', soundEnabled: false }, store);
    const loaded = loadPrefs(store);
    expect(loaded).toEqual({
      nickname: 'Kasparov',
      uiTheme: 'light',
      boardTheme: 'slate',
      soundEnabled: false,
    });

    for (let i = 0; i < 25; i++) {
      saveSeatToken(`RM${String(i).padStart(4, '0')}`, `tok-${i}`, store);
    }
    expect(getSeatToken('RM0024', store)).toBe('tok-24');
    expect(getSeatToken('RM0005', store)).toBe('tok-5');
    expect(getSeatToken('RM0000', store)).toBeUndefined();

    // Updating an existing room token refreshes its value without duplicating
    saveSeatToken('RM0005', 'tok-5-updated', store);
    expect(getSeatToken('RM0005', store)).toBe('tok-5-updated');

    for (let i = 0; i < 55; i++) {
      appendHistory(makeGame(`g-${i}`), store);
    }
    const hist = loadHistory(store);
    expect(hist).toHaveLength(50);
    expect(hist[0].id).toBe('g-54');
    expect(hist[49].id).toBe('g-5');

    // Deduplicating an existing game moves it to front without exceeding cap
    const updated = appendHistory(makeGame('g-10'), store);
    expect(updated).toHaveLength(50);
    expect(updated[0].id).toBe('g-10');
  });
});
