import { Copy, RotateCcw, Trophy } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Color, GameResult, Role } from '../../shared/protocol';

const REASON_LABELS: Record<GameResult['reason'], string> = {
  checkmate: 'by checkmate',
  stalemate: 'by stalemate',
  threefold: 'by threefold repetition',
  fifty_move: 'by 50-move rule',
  insufficient_material: 'by insufficient material',
  timeout: 'on time',
  timeout_vs_insufficient: 'timeout vs insufficient material',
  resignation: 'by resignation',
  draw_agreement: 'by agreement',
  abandonment: 'by abandonment',
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface GameOverModalProps {
  result: GameResult;
  mode: 'solo' | 'online';
  yourRole: Role;
  rematchBy: Color[];
  onRematch: () => void;
  onNewGame: () => void;
  onReview: () => void;
  onCopyPgn: () => void;
}

export function GameOverModal({
  result,
  mode,
  yourRole,
  rematchBy,
  onRematch,
  onNewGame,
  onReview,
  onCopyPgn,
}: GameOverModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onReviewRef = useRef(onReview);
  onReviewRef.current = onReview;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialogEl = dialogRef.current;
    const firstFocusable = dialogEl?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? dialogEl)?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onReviewRef.current();
        return;
      }
      if (e.key === 'Tab' && dialogEl) {
        const focusables = Array.from(dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  const headline =
    result.winner === 'draw'
      ? 'Draw'
      : result.winner === yourRole
        ? 'Victory'
        : yourRole === 'spectator'
          ? `${result.winner === 'w' ? 'White' : 'Black'} Wins`
          : 'Defeat';

  const isPlayer = yourRole === 'w' || yourRole === 'b';
  const youRequested = isPlayer && rematchBy.includes(yourRole);
  const oppRequested = isPlayer && rematchBy.some((c) => c !== yourRole);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-over-title"
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--scrim)' }}
      onClick={onReview}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-6 shadow-2xl text-center"
      >
        <div className="w-11 h-11 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] mx-auto mb-3 flex items-center justify-center text-[var(--accent-primary)]">
          <Trophy className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <h2 id="game-over-title" className="font-editorial text-2xl font-semibold m-0">
          {headline}
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1 mb-5">
          {result.winner === 'draw'
            ? `Drawn ${REASON_LABELS[result.reason]}`
            : `${result.winner === 'w' ? 'White' : 'Black'} wins ${REASON_LABELS[result.reason]}`}
        </p>

        <div className="flex flex-col gap-2">
          {isPlayer && (
            <button
              type="button"
              disabled={youRequested}
              onClick={onRematch}
              className="min-h-[44px] w-full rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
              {youRequested
                ? 'Waiting for opponent…'
                : oppRequested
                  ? 'Accept Rematch'
                  : mode === 'solo'
                    ? 'Rematch (Swap Sides)'
                    : 'Request Rematch'}
            </button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onReview}
              className="min-h-[44px] rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-sm font-medium cursor-pointer"
            >
              Review Board
            </button>
            <button
              type="button"
              onClick={onCopyPgn}
              className="min-h-[44px] rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-sm font-medium flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden="true" /> Copy PGN
            </button>
          </div>
          <button
            type="button"
            onClick={onNewGame}
            className="min-h-[44px] w-full rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            Return to Lobby
          </button>
        </div>
      </div>
    </div>
  );
}
