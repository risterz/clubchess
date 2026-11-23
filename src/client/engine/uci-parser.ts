import type { PromotionPiece } from '../../shared/protocol';

export type UciEvent =
  | { type: 'uciok' }
  | { type: 'readyok' }
  | { type: 'bestmove'; move: string | null };

const PROMOS = new Set<string>(['q', 'r', 'b', 'n']);

export function parseUciLine(raw: string): UciEvent | null {
  const line = raw.trim();
  if (line === 'uciok') return { type: 'uciok' };
  if (line === 'readyok') return { type: 'readyok' };
  if (line.startsWith('bestmove ')) {
    const token = line.split(/\s+/)[1];
    if (!token || token === '(none)') return { type: 'bestmove', move: null };
    return { type: 'bestmove', move: token };
  }
  return null;
}

export function parseUciMove(
  uci: string,
): { from: string; to: string; promotion?: PromotionPiece } | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promo = uci[4];
  return promo && PROMOS.has(promo)
    ? { from, to, promotion: promo as PromotionPiece }
    : { from, to };
}
