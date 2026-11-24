import { Clock } from 'lucide-react';
import type { Color, PlayerInfo } from '../../shared/protocol';
import { formatClockMs, type TimeControlId } from '../../shared/time-controls';

export interface PlayerBarProps {
  player: PlayerInfo | null;
  color: Color;
  timeControl: TimeControlId;
  clockMs: number;
  isActiveTurn: boolean;
  materialDiff: number;
  isThinking?: boolean;
  graceRemainingSec?: number | null;
}

export function PlayerBar({
  player,
  color,
  timeControl,
  clockMs,
  isActiveTurn,
  materialDiff,
  isThinking = false,
  graceRemainingSec = null,
}: PlayerBarProps) {
  const isLow = timeControl !== 'unlimited' && clockMs < 20_000;

  const clockClasses = isActiveTurn
    ? isLow
      ? 'bg-[var(--danger)] text-white border-transparent'
      : 'bg-[var(--accent-primary)] text-[var(--accent-contrast)] border-transparent'
    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)]';

  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          aria-hidden="true"
          className="w-3 h-3 rounded-full shrink-0 border border-[var(--border-subtle)]"
          style={{
            backgroundColor: player
              ? player.online
                ? 'var(--success)'
                : 'var(--danger)'
              : 'var(--bg-elevated)',
          }}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate text-[var(--text-primary)]">
              {player ? player.name : color === 'w' ? 'Waiting for White…' : 'Waiting for Black…'}
            </span>
            {materialDiff > 0 && (
              <span className="text-xs font-mono-tabular px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                +{materialDiff}
              </span>
            )}
          </div>
          {isThinking && (
            <p className="text-xs text-[var(--accent-primary)] m-0">Thinking…</p>
          )}
          {!isThinking && player && !player.online && graceRemainingSec !== null && (
            <p className="text-xs text-[var(--danger)] m-0">
              Offline · claim in {Math.max(0, graceRemainingSec)}s
            </p>
          )}
        </div>
      </div>

      {timeControl !== 'unlimited' ? (
        <div
          className={`font-mono-tabular text-lg font-semibold px-3 py-1 rounded-md border flex items-center gap-1.5 shrink-0 ${clockClasses}`}
        >
          <Clock className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
          <span>{formatClockMs(clockMs)}</span>
        </div>
      ) : (
        <span
          aria-label="Unlimited time"
          className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-mono-tabular"
        >
          ∞
        </span>
      )}
    </div>
  );
}
