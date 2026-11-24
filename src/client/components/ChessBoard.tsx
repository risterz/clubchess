import { Chess, type Square } from 'chess.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Color, PromotionPiece } from '../../shared/protocol';
import type { BoardTheme } from '../storage/local-store';
import { StauntonPiece } from './pieces/StauntonPieces';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const;
const PROMO_OPTIONS: PromotionPiece[] = ['q', 'r', 'b', 'n'];

export interface ChessBoardProps {
  fen: string;
  orientation: Color;
  interactive: boolean;
  allowedColor: Color | null;
  lastMove?: { from: string; to: string } | null;
  onMove: (from: string, to: string, promotion?: PromotionPiece) => void;
  boardTheme?: BoardTheme;
  ariaAnnouncement?: string;
}

interface PendingPromotion {
  from: Square;
  to: Square;
  color: Color;
  fileIndex: number;
}

interface DragState {
  from: Square;
  pieceColor: Color;
  pieceType: 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
  x: number;
  y: number;
}

export function ChessBoard({
  fen,
  orientation,
  interactive,
  allowedColor,
  lastMove,
  onMove,
  boardTheme,
  ariaAnnouncement,
}: ChessBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Square | null>(null);
  const [pendingPromo, setPendingPromo] = useState<PendingPromotion | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const chess = useMemo(() => new Chess(fen), [fen]);
  const turn = chess.turn() as Color;
  const canInteract = interactive && allowedColor !== null && turn === allowedColor;

  // Clear pending promotion or stale selection whenever FEN or interactivity changes
  useEffect(() => {
    setSelected(null);
    setPendingPromo(null);
    setDrag(null);
  }, [fen, interactive]);

  useEffect(() => {
    if (!pendingPromo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingPromo(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingPromo]);

  const legalTargets = useMemo(() => {
    if (!selected || !canInteract) return new Map<Square, boolean>();
    const moves = chess.moves({ square: selected, verbose: true });
    const map = new Map<Square, boolean>();
    for (const m of moves) {
      map.set(m.to, Boolean(m.captured));
    }
    return map;
  }, [chess, selected, canInteract]);

  const checkedKingSquare = useMemo<Square | null>(() => {
    if (!chess.inCheck()) return null;
    for (const row of chess.board()) {
      for (const cell of row) {
        if (cell && cell.type === 'k' && cell.color === turn) return cell.square;
      }
    }
    return null;
  }, [chess, turn]);

  const displayRanks = orientation === 'w' ? RANKS : [...RANKS].reverse();
  const displayFiles = orientation === 'w' ? FILES : [...FILES].reverse();

  function attemptMove(from: Square, to: Square): void {
    const matching = chess
      .moves({ square: from, verbose: true })
      .filter((m) => m.to === to);
    if (matching.length === 0) {
      setSelected(null);
      return;
    }
    if (matching.some((m) => Boolean(m.promotion))) {
      const fileIndex = displayFiles.indexOf(to[0] as (typeof FILES)[number]);
      setPendingPromo({ from, to, color: turn, fileIndex: Math.max(0, fileIndex) });
      setSelected(null);
      return;
    }
    setSelected(null);
    onMove(from, to);
  }

  function squareFromPoint(clientX: number, clientY: number): Square | null {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const col = Math.floor(((clientX - rect.left) / rect.width) * 8);
    const row = Math.floor(((clientY - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return `${displayFiles[col]}${displayRanks[row]}` as Square;
  }

  function handleSquarePointerDown(sq: Square, e: React.PointerEvent<HTMLButtonElement>): void {
    if (!canInteract) return;
    const piece = chess.get(sq);

    if (selected && legalTargets.has(sq)) {
      attemptMove(selected, sq);
      return;
    }

    if (piece && piece.color === allowedColor) {
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // Ignore synthetic pointer events without an active pointer id
      }
      setSelected(sq);
      setDrag({
        from: sq,
        pieceColor: piece.color,
        pieceType: piece.type,
        x: e.clientX,
        y: e.clientY,
      });
    } else {
      setSelected(null);
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!drag) return;
    setDrag((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (!drag) return;
    const dropSq = squareFromPoint(e.clientX, e.clientY);
    const fromSq = drag.from;
    setDrag(null);
    if (dropSq && dropSq !== fromSq) {
      attemptMove(fromSq, dropSq);
    }
  }

  const promoAtTop = pendingPromo ? orientation === pendingPromo.color : true;

  return (
    <div
      className="relative w-full aspect-square select-none"
      data-board={boardTheme}
    >
      <div
        ref={boardRef}
        role="grid"
        aria-label="Chessboard"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDrag(null)}
        className="grid grid-cols-8 grid-rows-8 w-full h-full rounded-lg overflow-hidden border border-[var(--border-subtle)] shadow-xl touch-none"
      >
        {displayRanks.map((rank, rIdx) =>
          displayFiles.map((file, fIdx) => {
            const sq = `${file}${rank}` as Square;
            const isLight = (FILES.indexOf(file) + Number(rank)) % 2 === 0;
            const piece = chess.get(sq);
            const isSelected = selected === sq;
            const isLast = lastMove?.from === sq || lastMove?.to === sq;
            const isTarget = legalTargets.has(sq);
            const isCaptureTarget = legalTargets.get(sq) === true;
            const isKingChecked = checkedKingSquare === sq;
            const isDraggedOrigin = drag?.from === sq;

            return (
              <button
                key={sq}
                type="button"
                role="gridcell"
                aria-label={`${sq}${piece ? ` ${piece.color === 'w' ? 'white' : 'black'} ${piece.type}` : ''}`}
                onPointerDown={(e) => handleSquarePointerDown(sq, e)}
                onClick={() => {
                  if (!canInteract || drag) return;
                  if (selected && legalTargets.has(sq)) {
                    attemptMove(selected, sq);
                    return;
                  }
                  if (piece && piece.color === allowedColor && selected !== sq) {
                    setSelected(sq);
                  }
                }}
                style={{
                  backgroundColor: isLight ? 'var(--sq-light)' : 'var(--sq-dark)',
                }}
                className="relative flex items-center justify-center p-0 border-0 cursor-pointer"
              >
                {(isLast || isSelected) && (
                  <span
                    className="pointer-events-none absolute inset-0"
                    style={{
                      backgroundColor: isSelected ? 'var(--sq-selected)' : 'var(--sq-last)',
                    }}
                  />
                )}

                {isKingChecked && (
                  <span
                    className="pointer-events-none absolute inset-0"
                    style={{ background: 'var(--sq-check)' }}
                  />
                )}

                {piece && (
                  <span
                    className={`relative z-10 w-[86%] h-[86%] transition-transform duration-150 ${
                      isDraggedOrigin ? 'opacity-25' : 'opacity-100'
                    }`}
                  >
                    <StauntonPiece color={piece.color} type={piece.type} />
                  </span>
                )}

                {isTarget && !isCaptureTarget && (
                  <span
                    className="pointer-events-none absolute z-20 w-[26%] h-[26%] rounded-full"
                    style={{ backgroundColor: 'var(--sq-legal-dot)' }}
                  />
                )}

                {isTarget && isCaptureTarget && (
                  <span
                    className="pointer-events-none absolute z-20 inset-[6%] rounded-full border-[4px]"
                    style={{ borderColor: 'var(--sq-legal-capture)' }}
                  />
                )}

                {fIdx === 0 && (
                  <span
                    className="pointer-events-none absolute top-0.5 left-1 text-[10px] font-mono-tabular font-semibold opacity-75"
                    style={{ color: isLight ? 'var(--sq-dark)' : 'var(--sq-light)' }}
                  >
                    {rank}
                  </span>
                )}

                {rIdx === 7 && (
                  <span
                    className="pointer-events-none absolute bottom-0.5 right-1 text-[10px] font-mono-tabular font-semibold opacity-75"
                    style={{ color: isLight ? 'var(--sq-dark)' : 'var(--sq-light)' }}
                  >
                    {file}
                  </span>
                )}
              </button>
            );
          }),
        )}
      </div>

      {drag && (
        <div
          className="pointer-events-none fixed z-50 w-16 h-16 -translate-x-1/2 -translate-y-1/2"
          style={{ left: drag.x, top: drag.y }}
        >
          <StauntonPiece color={drag.pieceColor} type={drag.pieceType} />
        </div>
      )}

      {pendingPromo && (
        <div
          className="absolute inset-0 z-30 flex items-start"
          style={{ backgroundColor: 'var(--scrim)' }}
          onClick={() => setPendingPromo(null)}
        >
          <div
            role="dialog"
            aria-label="Choose promotion piece"
            onClick={(e) => e.stopPropagation()}
            style={{
              left: `${pendingPromo.fileIndex * 12.5}%`,
              width: '12.5%',
            }}
            className={`absolute ${
              promoAtTop ? 'top-0 rounded-b-lg' : 'bottom-0 rounded-t-lg'
            } flex flex-col overflow-hidden bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl`}
          >
            {PROMO_OPTIONS.map((p) => (
              <button
                key={p}
                type="button"
                aria-label={`Promote to ${p}`}
                onClick={() => {
                  onMove(pendingPromo.from, pendingPromo.to, p);
                  setPendingPromo(null);
                }}
                className="aspect-square min-h-[44px] min-w-[44px] p-1.5 hover:bg-[var(--bg-elevated)] cursor-pointer flex items-center justify-center"
              >
                <StauntonPiece color={pendingPromo.color} type={p} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sr-only" aria-live="polite">
        {ariaAnnouncement ?? ''}
      </div>
    </div>
  );
}
