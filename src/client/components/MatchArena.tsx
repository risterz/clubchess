import { Chess } from 'chess.js';
import { Check, Copy, Link2, RefreshCw, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { computeRemainingMs } from '../../shared/clock';
import type { Color } from '../../shared/protocol';
import { playSound } from '../audio/sound-engine';
import type { GameSession, GameSessionState } from '../session/types';
import { ActionBar } from './ActionBar';
import { ChessBoard } from './ChessBoard';
import { GameOverModal } from './GameOverModal';
import { MoveList } from './MoveList';
import { PlayerBar } from './PlayerBar';

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const STARTING_FEN = new Chess().fen();

function computeMaterialDiff(fen: string): { w: number; b: number } {
  const chess = new Chess(fen);
  let w = 0;
  let b = 0;
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.type === 'k') continue;
      if (cell.color === 'w') w += PIECE_VALUES[cell.type] ?? 0;
      else b += PIECE_VALUES[cell.type] ?? 0;
    }
  }
  return { w: Math.max(0, w - b), b: Math.max(0, b - w) };
}

export interface MatchArenaProps {
  session: GameSession;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onReturnLobby: () => void;
}

export function MatchArena({
  session,
  soundEnabled,
  onToggleSound,
  onReturnLobby,
}: MatchArenaProps) {
  const [state, setState] = useState<GameSessionState>(() => session.getState());
  const [flipped, setFlipped] = useState(false);
  const [viewPly, setViewPly] = useState(0);
  const [dismissedModal, setDismissedModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const prevMovesLen = useRef(state.moves.length);
  const prevStatus = useRef(state.status);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = session.subscribe((next) => {
      setState(next);
    });
    session.start();
    return () => {
      unsub();
      session.dispose();
    };
  }, [session]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  // Smooth clock ticker
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  // Follow live ply unless user is inspecting history, and play sound cues on new moves / game end
  useEffect(() => {
    if (state.moves.length !== prevMovesLen.current) {
      if (viewPly === prevMovesLen.current || state.moves.length === 0) {
        setViewPly(state.moves.length);
      }
      if (state.moves.length > prevMovesLen.current) {
        const last = state.moves[state.moves.length - 1];
        if (last.san.includes('#') || last.san.includes('+')) playSound('check', soundEnabled);
        else if (last.san.startsWith('O-O')) playSound('castle', soundEnabled);
        else if (last.san.includes('x')) playSound('capture', soundEnabled);
        else playSound('move', soundEnabled);
      }
      prevMovesLen.current = state.moves.length;
    }

    if (state.status === 'finished' && prevStatus.current !== 'finished') {
      playSound('end', soundEnabled);
      setDismissedModal(false);
    }
    if (state.status === 'active' && prevStatus.current === 'finished') {
      setDismissedModal(false);
      setViewPly(0);
    }
    prevStatus.current = state.status;
  }, [state.moves, state.status, soundEnabled, viewPly]);

  const baseOrientation: Color = state.yourRole === 'b' ? 'b' : 'w';
  const orientation: Color = flipped ? (baseOrientation === 'w' ? 'b' : 'w') : baseOrientation;
  const topColor: Color = orientation === 'w' ? 'b' : 'w';
  const bottomColor: Color = orientation;

  const isLiveView = viewPly === state.moves.length;
  const displayedFen =
    viewPly === 0 ? STARTING_FEN : state.moves[viewPly - 1]?.fen ?? state.fen;
  const displayedLastMove = useMemo(() => {
    const rec = viewPly > 0 ? state.moves[viewPly - 1] : null;
    return rec ? { from: rec.uci.slice(0, 2), to: rec.uci.slice(2, 4) } : null;
  }, [state.moves, viewPly]);

  const activeTurn = useMemo(() => new Chess(state.fen).turn() as Color, [state.fen]);
  const serverNowEst = nowMs + state.clockOffsetMs;
  const liveClocks = computeRemainingMs(state.clocks, activeTurn, serverNowEst);
  const material = useMemo(() => computeMaterialDiff(displayedFen), [displayedFen]);

  const oppColor: Color | null = state.yourRole === 'w' ? 'b' : state.yourRole === 'b' ? 'w' : null;
  const oppPlayer = oppColor ? state.players[oppColor] : null;
  const canClaimAbandonment = Boolean(
    state.mode === 'online' &&
      state.status === 'active' &&
      oppPlayer &&
      !oppPlayer.online &&
      oppPlayer.graceDeadlineAt !== null &&
      serverNowEst >= oppPlayer.graceDeadlineAt,
  );

  function graceSecFor(color: Color): number | null {
    const p = state.players[color];
    if (!p || p.online || !p.graceDeadlineAt) return null;
    return Math.ceil((p.graceDeadlineAt - serverNowEst) / 1000);
  }

  const lastSan = state.moves[state.moves.length - 1]?.san;
  const announcement = state.result
    ? `Game over: ${state.result.winner === 'draw' ? 'Draw' : `${state.result.winner === 'w' ? 'White' : 'Black'} wins`} ${state.result.reason}`
    : lastSan
      ? `Last move ${lastSan}`
      : '';

  return (
    <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 w-full">
      {state.connectionStatus === 'reconnecting' && (
        <div
          role="status"
          className="mb-3 px-3.5 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--accent-primary)] flex items-center gap-2 text-sm"
        >
          <WifiOff className="w-4 h-4 text-[var(--accent-primary)]" strokeWidth={1.75} aria-hidden="true" />
          Reconnecting to table…
        </div>
      )}

      {state.mode === 'online' && state.status === 'waiting' && state.roomId && (
        <div className="mb-4 p-3.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--accent-primary)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Link2 className="w-4 h-4 text-[var(--accent-primary)]" strokeWidth={1.75} aria-hidden="true" />
            <span>
              Waiting for opponent — share room{' '}
              <strong className="font-mono-tabular">{state.roomId}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(window.location.href);
              setCopiedLink(true);
              if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
              copyTimerRef.current = setTimeout(() => {
                copyTimerRef.current = null;
                setCopiedLink(false);
              }, 1800);
            }}
            className="min-h-[44px] px-3.5 rounded-lg bg-[var(--accent-primary)] text-[var(--accent-contrast)] text-sm font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            {copiedLink ? (
              <Check className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Copy className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
            )}
            {copiedLink ? 'Link Copied' : 'Copy Invite Link'}
          </button>
        </div>
      )}

      {state.errorMessage && (
        <div
          role="alert"
          className="mb-3 px-3.5 py-2 rounded-lg border border-[var(--danger)] text-sm text-[var(--danger)] flex items-center justify-between gap-2"
        >
          <span>{state.errorMessage}</span>
          {state.mode === 'solo' && (
            <button
              type="button"
              onClick={() => session.retryAi()}
              className="min-h-[44px] min-w-[44px] px-3 rounded bg-[var(--danger)] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden="true" /> Retry
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,640px)_340px] gap-4 lg:gap-6 justify-center items-start">
        <div className="flex flex-col gap-2.5 w-full max-w-[min(78dvh,640px)] mx-auto">
          <div className="lg:hidden">
            <PlayerBar
              player={state.players[topColor]}
              color={topColor}
              timeControl={state.timeControl}
              clockMs={topColor === 'w' ? liveClocks.wMs : liveClocks.bMs}
              isActiveTurn={state.status === 'active' && activeTurn === topColor}
              materialDiff={material[topColor]}
              isThinking={state.isAiThinking && topColor !== state.yourRole}
              graceRemainingSec={graceSecFor(topColor)}
            />
          </div>

          <ChessBoard
            fen={displayedFen}
            orientation={orientation}
            interactive={isLiveView && state.status === 'active'}
            allowedColor={state.yourRole === 'spectator' ? null : state.yourRole}
            lastMove={displayedLastMove}
            onMove={(from, to, promo) => {
              session.makeMove(from, to, promo);
            }}
            ariaAnnouncement={announcement}
          />

          <div className="lg:hidden">
            <PlayerBar
              player={state.players[bottomColor]}
              color={bottomColor}
              timeControl={state.timeControl}
              clockMs={bottomColor === 'w' ? liveClocks.wMs : liveClocks.bMs}
              isActiveTurn={state.status === 'active' && activeTurn === bottomColor}
              materialDiff={material[bottomColor]}
              isThinking={state.isAiThinking && bottomColor !== state.yourRole}
              graceRemainingSec={graceSecFor(bottomColor)}
            />
          </div>
        </div>

        <aside className="flex flex-col gap-3 w-full max-w-[min(78dvh,640px)] lg:max-w-none mx-auto">
          <div className="hidden lg:block">
            <PlayerBar
              player={state.players[topColor]}
              color={topColor}
              timeControl={state.timeControl}
              clockMs={topColor === 'w' ? liveClocks.wMs : liveClocks.bMs}
              isActiveTurn={state.status === 'active' && activeTurn === topColor}
              materialDiff={material[topColor]}
              isThinking={state.isAiThinking && topColor !== state.yourRole}
              graceRemainingSec={graceSecFor(topColor)}
            />
          </div>

          <MoveList moves={state.moves} viewPly={viewPly} onSelectPly={setViewPly} />

          <ActionBar
            status={state.status}
            mode={state.mode}
            yourRole={state.yourRole}
            drawOfferBy={state.drawOfferBy}
            canClaimAbandonment={canClaimAbandonment}
            soundEnabled={soundEnabled}
            onOfferDraw={() => session.offerDraw()}
            onRespondDraw={(accept) => session.respondDraw(accept)}
            onResign={() => session.resign()}
            onClaimAbandonment={() => session.claimAbandonment()}
            onFlip={() => setFlipped((f) => !f)}
            onCopyPgn={() => void navigator.clipboard.writeText(session.getPgn())}
            onCopyFen={() => void navigator.clipboard.writeText(displayedFen)}
            onToggleSound={onToggleSound}
          />

          <div className="hidden lg:block">
            <PlayerBar
              player={state.players[bottomColor]}
              color={bottomColor}
              timeControl={state.timeControl}
              clockMs={bottomColor === 'w' ? liveClocks.wMs : liveClocks.bMs}
              isActiveTurn={state.status === 'active' && activeTurn === bottomColor}
              materialDiff={material[bottomColor]}
              isThinking={state.isAiThinking && bottomColor !== state.yourRole}
              graceRemainingSec={graceSecFor(bottomColor)}
            />
          </div>
        </aside>
      </div>

      {state.result && !dismissedModal && (
        <GameOverModal
          result={state.result}
          mode={state.mode}
          yourRole={state.yourRole}
          rematchBy={state.rematchBy}
          onRematch={() => session.requestRematch()}
          onNewGame={onReturnLobby}
          onReview={() => setDismissedModal(true)}
          onCopyPgn={() => void navigator.clipboard.writeText(session.getPgn())}
        />
      )}
    </main>
  );
}
