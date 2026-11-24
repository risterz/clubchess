import { Copy, X } from 'lucide-react';
import { useEffect } from 'react';
import type { SavedGame } from '../storage/local-store';

export interface HistoryDrawerProps {
  open: boolean;
  games: SavedGame[];
  onClose: () => void;
  onSelectGame: (game: SavedGame) => void;
}

export function HistoryDrawer({ open, games, onClose, onSelectGame }: HistoryDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Local match history"
      className="fixed inset-0 z-50 flex justify-end"
      style={{ backgroundColor: 'var(--scrim)' }}
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md h-full bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] flex flex-col shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 h-14 border-b border-[var(--border-subtle)]">
          <h2 className="font-editorial text-xl font-semibold m-0">Match History</h2>
          <button
            type="button"
            aria-label="Close history"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-lg hover:bg-[var(--bg-elevated)] flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
          {games.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)] text-center py-12">
              Completed games are saved locally here for replay and PGN export.
            </p>
          ) : (
            games.map((g) => {
              const outcome =
                g.result.winner === 'draw'
                  ? 'Draw'
                  : g.result.winner === g.userColor
                    ? 'Win'
                    : 'Loss';
              const badgeClasses =
                outcome === 'Win'
                  ? 'bg-[var(--success)] text-[var(--accent-contrast)]'
                  : outcome === 'Loss'
                    ? 'bg-[var(--danger)] text-white'
                    : 'bg-[var(--bg-surface)] text-[var(--text-secondary)]';
              const opp = g.userColor === 'w' ? g.blackName : g.whiteName;
              return (
                <div
                  key={g.id}
                  className="p-3.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-between gap-3"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectGame(g);
                      onClose();
                    }}
                    className="min-h-[44px] text-left flex-1 min-w-0 bg-transparent border-0 p-0 cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${badgeClasses}`}>
                        {outcome}
                      </span>
                      <span className="font-medium text-sm truncate text-[var(--text-primary)]">
                        vs {opp}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] font-mono-tabular mt-1 mb-0">
                      {g.timeControl} · {new Date(g.playedAt).toLocaleDateString()}
                    </p>
                  </button>
                  <button
                    type="button"
                    aria-label="Copy PGN"
                    onClick={() => void navigator.clipboard.writeText(g.pgn).catch(() => {})}
                    className="min-h-[44px] min-w-[44px] rounded-md hover:bg-[var(--bg-surface)] flex items-center justify-center cursor-pointer"
                  >
                    <Copy className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}
