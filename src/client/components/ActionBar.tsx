import {
  Check,
  Copy,
  Flag,
  Handshake,
  RotateCw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Color, GameStatus, Role } from '../../shared/protocol';

export interface ActionBarProps {
  status: GameStatus;
  mode: 'solo' | 'online';
  yourRole: Role;
  drawOfferBy: Color | null;
  canClaimAbandonment: boolean;
  soundEnabled: boolean;
  onOfferDraw: () => void;
  onRespondDraw: (accept: boolean) => void;
  onResign: () => void;
  onClaimAbandonment: () => void;
  onFlip: () => void;
  onCopyPgn: () => void;
  onCopyFen: () => void;
  onToggleSound: () => void;
}

export function ActionBar({
  status,
  mode,
  yourRole,
  drawOfferBy,
  canClaimAbandonment,
  soundEnabled,
  onOfferDraw,
  onRespondDraw,
  onResign,
  onClaimAbandonment,
  onFlip,
  onCopyPgn,
  onCopyFen,
  onToggleSound,
}: ActionBarProps) {
  const [confirmResign, setConfirmResign] = useState(false);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isPlayer = yourRole === 'w' || yourRole === 'b';
  const incomingDraw = isPlayer && drawOfferBy !== null && drawOfferBy !== yourRole;
  const outgoingDraw = isPlayer && drawOfferBy === yourRole;

  useEffect(() => {
    if (status !== 'active') {
      setConfirmResign(false);
    }
  }, [status]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  function flashCopy(label: string, fn: () => void): void {
    fn();
    setCopiedLabel(label);
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => {
      copyTimerRef.current = null;
      setCopiedLabel(null);
    }, 1800);
  }

  return (
    <div className="flex flex-col gap-2">
      {incomingDraw && status === 'active' && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--accent-primary)]">
          <span className="text-sm font-medium">Opponent offers a draw</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onRespondDraw(true)}
              className="min-h-[44px] min-w-[44px] px-3 rounded-md bg-[var(--accent-primary)] text-[var(--accent-contrast)] text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Check className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Accept
            </button>
            <button
              type="button"
              onClick={() => onRespondDraw(false)}
              className="min-h-[44px] min-w-[44px] px-3 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium flex items-center gap-1 cursor-pointer"
            >
              <X className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Decline
            </button>
          </div>
        </div>
      )}

      {canClaimAbandonment && status === 'active' && (
        <button
          type="button"
          onClick={onClaimAbandonment}
          className="min-h-[44px] w-full rounded-lg bg-[var(--accent-primary)] text-[var(--accent-contrast)] font-semibold text-sm cursor-pointer"
        >
          Claim Victory (Opponent Abandoned)
        </button>
      )}

      {confirmResign && status === 'active' && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--danger)]">
          <span className="text-sm font-medium">Resign this game?</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setConfirmResign(false);
                onResign();
              }}
              className="min-h-[44px] min-w-[44px] px-3 rounded-md bg-[var(--danger)] text-white text-xs font-semibold cursor-pointer"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmResign(false)}
              className="min-h-[44px] min-w-[44px] px-3 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isPlayer && status === 'active' && (
        <div className={`grid gap-1.5 ${mode === 'online' ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {mode === 'online' && (
            <button
              type="button"
              disabled={outgoingDraw}
              onClick={onOfferDraw}
              className="min-h-[44px] rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)] disabled:opacity-45 disabled:cursor-not-allowed text-sm font-medium flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Handshake className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
              <span>{outgoingDraw ? 'Draw Offered' : 'Offer Draw'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmResign(true)}
            className="min-h-[44px] rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)] text-sm font-medium text-[var(--danger)] flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Flag className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
            <span>Resign</span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-4 gap-1.5">
        <button
          type="button"
          aria-label="Flip board"
          onClick={onFlip}
          title="Flip board"
          className="min-h-[44px] min-w-[44px] rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)] flex items-center justify-center cursor-pointer"
        >
          <RotateCw className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
        </button>

        <button
          type="button"
          aria-label="Copy FEN"
          onClick={() => flashCopy('FEN', onCopyFen)}
          title="Copy FEN"
          className="min-h-[44px] min-w-[44px] rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)] text-xs font-mono-tabular font-medium flex items-center justify-center cursor-pointer"
        >
          {copiedLabel === 'FEN' ? (
            <Check className="w-4 h-4 text-[var(--success)]" strokeWidth={1.75} aria-hidden="true" />
          ) : (
            'FEN'
          )}
        </button>

        <button
          type="button"
          aria-label="Copy PGN"
          onClick={() => flashCopy('PGN', onCopyPgn)}
          title="Copy PGN"
          className="min-h-[44px] min-w-[44px] rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)] text-xs font-mono-tabular font-medium flex items-center justify-center gap-1 cursor-pointer"
        >
          {copiedLabel === 'PGN' ? (
            <Check className="w-4 h-4 text-[var(--success)]" strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden="true" />
              <span>PGN</span>
            </>
          )}
        </button>

        <button
          type="button"
          aria-label={soundEnabled ? 'Mute sound' : 'Unmute sound'}
          onClick={onToggleSound}
          title={soundEnabled ? 'Sound on' : 'Sound muted'}
          className="min-h-[44px] min-w-[44px] rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)] flex items-center justify-center cursor-pointer"
        >
          {soundEnabled ? (
            <Volume2 className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <VolumeX className="w-4 h-4 text-[var(--text-secondary)]" strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
