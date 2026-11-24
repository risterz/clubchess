import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { MoveRecord } from '../../shared/protocol';

export interface MoveListProps {
  moves: MoveRecord[];
  viewPly: number;
  onSelectPly: (ply: number) => void;
}

export function MoveList({ moves, viewPly, onSelectPly }: MoveListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const mobileListRef = useRef<HTMLDivElement>(null);
  const isViewingHistory = viewPly < moves.length;

  useEffect(() => {
    if (!isViewingHistory) {
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
      if (mobileListRef.current) {
        mobileListRef.current.scrollLeft = mobileListRef.current.scrollWidth;
      }
    }
  }, [moves.length, isViewingHistory]);

  const rows: Array<{
    moveNumber: number;
    w?: { san: string; ply: number };
    b?: { san: string; ply: number };
  }> = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({
      moveNumber: i / 2 + 1,
      w: { san: moves[i].san, ply: i + 1 },
      b: moves[i + 1] ? { san: moves[i + 1].san, ply: i + 2 } : undefined,
    });
  }

  return (
    <div className="flex flex-col rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden">
      <div className="flex items-center justify-between min-h-[44px] px-3 border-b border-[var(--border-subtle)]">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Moves
        </span>
        {isViewingHistory && (
          <button
            type="button"
            onClick={() => onSelectPly(moves.length)}
            className="min-h-[44px] px-1 text-xs font-medium text-[var(--accent-primary)] hover:underline cursor-pointer"
          >
            Move {viewPly} · Back to live
          </button>
        )}
      </div>

      {/* Desktop 2-column SAN table */}
      <div
        ref={listRef}
        className="hidden lg:block h-64 overflow-y-auto px-2 py-1.5 font-mono-tabular text-sm"
      >
        {rows.length === 0 ? (
          <p className="text-center text-xs text-[var(--text-secondary)] py-10 m-0">
            No moves played yet
          </p>
        ) : (
          rows.map((r) => (
            <div
              key={r.moveNumber}
              className="grid grid-cols-[2.2rem_1fr_1fr] items-center gap-1 py-0.5"
            >
              <span className="text-xs text-[var(--text-secondary)] text-right pr-1">
                {r.moveNumber}.
              </span>
              {r.w && (
                <button
                  type="button"
                  onClick={() => onSelectPly(r.w!.ply)}
                  className={`text-left px-2 py-1 rounded cursor-pointer transition-colors ${
                    viewPly === r.w.ply
                      ? 'bg-[var(--accent-primary)] text-[var(--accent-contrast)] font-semibold'
                      : 'hover:bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                  }`}
                >
                  {r.w.san}
                </button>
              )}
              {r.b ? (
                <button
                  type="button"
                  onClick={() => onSelectPly(r.b!.ply)}
                  className={`text-left px-2 py-1 rounded cursor-pointer transition-colors ${
                    viewPly === r.b.ply
                      ? 'bg-[var(--accent-primary)] text-[var(--accent-contrast)] font-semibold'
                      : 'hover:bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                  }`}
                >
                  {r.b.san}
                </button>
              ) : (
                <span />
              )}
            </div>
          ))
        )}
      </div>

      {/* Mobile horizontal move ticker */}
      <div
        ref={mobileListRef}
        className="flex lg:hidden items-center gap-1.5 overflow-x-auto px-2.5 py-2 font-mono-tabular text-sm"
      >
        {moves.length === 0 ? (
          <span className="text-xs text-[var(--text-secondary)] py-2">No moves yet</span>
        ) : (
          moves.map((m, idx) => {
            const ply = idx + 1;
            const prefix = idx % 2 === 0 ? `${idx / 2 + 1}. ` : '';
            return (
              <button
                key={ply}
                type="button"
                onClick={() => onSelectPly(ply)}
                className={`min-h-[44px] min-w-[44px] px-2.5 rounded shrink-0 cursor-pointer ${
                  viewPly === ply
                    ? 'bg-[var(--accent-primary)] text-[var(--accent-contrast)] font-semibold'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                }`}
              >
                {prefix}
                {m.san}
              </button>
            );
          })
        )}
      </div>

      {/* Replay controls */}
      <div className="grid grid-cols-4 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
        <button
          type="button"
          aria-label="First move"
          disabled={viewPly === 0}
          onClick={() => onSelectPly(0)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-35 disabled:cursor-not-allowed hover:bg-[var(--bg-surface)] cursor-pointer"
        >
          <ChevronFirst className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Previous move"
          disabled={viewPly === 0}
          onClick={() => onSelectPly(Math.max(0, viewPly - 1))}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-35 disabled:cursor-not-allowed hover:bg-[var(--bg-surface)] cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Next move"
          disabled={viewPly >= moves.length}
          onClick={() => onSelectPly(Math.min(moves.length, viewPly + 1))}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-35 disabled:cursor-not-allowed hover:bg-[var(--bg-surface)] cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Latest move"
          disabled={viewPly >= moves.length}
          onClick={() => onSelectPly(moves.length)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-35 disabled:cursor-not-allowed hover:bg-[var(--bg-surface)] cursor-pointer"
        >
          <ChevronLast className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
