import { Crown, History, Moon, Palette, Sun, User } from 'lucide-react';
import { useRef, useState } from 'react';
import type { BoardTheme, UserPrefs } from '../storage/local-store';

const BOARD_THEMES: Array<{ id: BoardTheme; label: string }> = [
  { id: 'walnut', label: 'Walnut' },
  { id: 'slate', label: 'Slate' },
  { id: 'linen', label: 'Linen' },
];

export interface HeaderProps {
  prefs: UserPrefs;
  historyCount: number;
  onUpdatePrefs: (patch: Partial<UserPrefs>) => void;
  onOpenHistory: () => void;
  onGoHome: () => void;
}

export function Header({
  prefs,
  historyCount,
  onUpdatePrefs,
  onOpenHistory,
  onGoHome,
}: HeaderProps) {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(prefs.nickname);
  const cancelingRef = useRef(false);

  function commitName(): void {
    if (cancelingRef.current) {
      cancelingRef.current = false;
      return;
    }
    setEditingName(false);
    const cleaned = draftName.trim();
    if (cleaned) onUpdatePrefs({ nickname: cleaned });
    else setDraftName(prefs.nickname);
  }

  function cancelEdit(): void {
    cancelingRef.current = true;
    setDraftName(prefs.nickname);
    setEditingName(false);
  }

  return (
    <header className="w-full border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onGoHome}
          className="min-h-[44px] flex items-center gap-2 text-[var(--text-primary)] cursor-pointer bg-transparent border-0 p-0"
        >
          <Crown className="w-5 h-5 text-[var(--accent-primary)]" strokeWidth={1.75} aria-hidden="true" />
          <span className="font-editorial text-xl font-semibold tracking-tight">ClubChess</span>
        </button>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {editingName ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                commitName();
              }}
              className="flex items-center"
            >
              <label htmlFor="nickname-input" className="sr-only">
                Display name
              </label>
              <input
                id="nickname-input"
                autoFocus
                maxLength={24}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelEdit();
                  }
                }}
                onBlur={commitName}
                className="min-h-[44px] w-32 sm:w-40 px-2.5 rounded-md bg-[var(--bg-elevated)] border border-[var(--accent-primary)] text-sm text-[var(--text-primary)]"
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                cancelingRef.current = false;
                setDraftName(prefs.nickname);
                setEditingName(true);
              }}
              className="min-h-[44px] px-2.5 rounded-lg hover:bg-[var(--bg-elevated)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1.5 cursor-pointer"
            >
              <User className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
              <span className="max-w-[96px] sm:max-w-[140px] truncate">{prefs.nickname}</span>
            </button>
          )}

          <button
            type="button"
            aria-label="Cycle board theme"
            title={`Board: ${BOARD_THEMES.find((b) => b.id === prefs.boardTheme)?.label}`}
            onClick={() => {
              const idx = BOARD_THEMES.findIndex((b) => b.id === prefs.boardTheme);
              const next = BOARD_THEMES[(idx + 1) % BOARD_THEMES.length].id;
              onUpdatePrefs({ boardTheme: next });
            }}
            className="min-h-[44px] min-w-[44px] rounded-lg hover:bg-[var(--bg-elevated)] flex items-center justify-center cursor-pointer"
          >
            <Palette className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
          </button>

          <button
            type="button"
            aria-label={prefs.uiTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => onUpdatePrefs({ uiTheme: prefs.uiTheme === 'dark' ? 'light' : 'dark' })}
            className="min-h-[44px] min-w-[44px] rounded-lg hover:bg-[var(--bg-elevated)] flex items-center justify-center cursor-pointer"
          >
            {prefs.uiTheme === 'dark' ? (
              <Sun className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Moon className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            aria-label="Open match history"
            onClick={onOpenHistory}
            className="min-h-[44px] min-w-[44px] px-2.5 rounded-lg hover:bg-[var(--bg-elevated)] flex items-center justify-center gap-1.5 text-sm cursor-pointer"
          >
            <History className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
            {historyCount > 0 && (
              <span className="font-mono-tabular text-xs px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                {historyCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
