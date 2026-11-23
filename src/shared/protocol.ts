import type { TimeControlId } from './time-controls';

export type Color = 'w' | 'b';
export type Role = 'w' | 'b' | 'spectator';
export type SidePref = 'random' | 'w' | 'b';
export type PromotionPiece = 'q' | 'r' | 'b' | 'n';
export type GameStatus = 'waiting' | 'active' | 'finished';

export type GameEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'fifty_move'
  | 'insufficient_material'
  | 'timeout'
  | 'timeout_vs_insufficient'
  | 'resignation'
  | 'draw_agreement'
  | 'abandonment';

export interface GameResult {
  winner: Color | 'draw';
  reason: GameEndReason;
}

export interface ClockState {
  wMs: number;
  bMs: number;
  incrementMs: number;
  running: boolean;
  lastTickAt: number;
}

export interface PlayerInfo {
  name: string;
  online: boolean;
  graceDeadlineAt: number | null;
}

export interface MoveRecord {
  san: string;
  uci: string;
  fen: string;
  wMs: number;
  bMs: number;
}

export type ClientRoomMessage =
  | { type: 'join'; name: string; seatToken?: string }
  | { type: 'move'; from: string; to: string; promotion?: PromotionPiece; seq: number }
  | { type: 'resign' }
  | { type: 'draw_offer' }
  | { type: 'draw_response'; accept: boolean }
  | { type: 'rematch_request' }
  | { type: 'claim_abandonment' }
  | { type: 'ping'; ts: number };

export type ServerRoomMessage =
  | {
      type: 'room_state';
      roomId: string;
      timeControl: TimeControlId;
      status: GameStatus;
      fen: string;
      moves: MoveRecord[];
      clocks: ClockState;
      players: { w: PlayerInfo | null; b: PlayerInfo | null };
      yourRole: Role;
      seatToken?: string;
      drawOfferBy: Color | null;
      rematchBy: Color[];
      result: GameResult | null;
      serverNow: number;
    }
  | {
      type: 'move_applied';
      move: MoveRecord;
      clocks: ClockState;
      result: GameResult | null;
      serverNow: number;
    }
  | {
      type: 'presence';
      color: Color;
      online: boolean;
      graceDeadlineAt: number | null;
      serverNow: number;
    }
  | { type: 'draw_offered'; by: Color }
  | { type: 'draw_declined' }
  | { type: 'rematch_updated'; rematchBy: Color[] }
  | { type: 'game_over'; result: GameResult; clocks: ClockState; serverNow: number }
  | { type: 'error'; code: string; message: string; revertFen?: string }
  | { type: 'pong'; ts: number; serverNow: number };

export type ServerQueueMessage =
  | { type: 'queued'; timeControl: TimeControlId; waitingCount: number }
  | { type: 'matched'; roomId: string; seatToken: string; color: Color };

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_ID_REGEX = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const PROMOTIONS = new Set<string>(['q', 'r', 'b', 'n']);

export function isValidRoomId(id: string): boolean {
  return ROOM_ID_REGEX.test(id);
}

export function generateRoomId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  }
  return out;
}

export function sanitizeDisplayName(name: string | undefined): string {
  const cleaned = (name ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return cleaned.length > 0 ? cleaned : 'Guest';
}

export function parseClientRoomMessage(raw: string): ClientRoomMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || !('type' in data)) return null;
  const msg = data as Record<string, unknown>;

  switch (msg.type) {
    case 'join':
      if (typeof msg.name !== 'string') return null;
      if (msg.seatToken !== undefined && typeof msg.seatToken !== 'string') return null;
      return {
        type: 'join',
        name: sanitizeDisplayName(msg.name),
        ...(msg.seatToken ? { seatToken: msg.seatToken } : {}),
      };
    case 'move':
      if (typeof msg.from !== 'string' || typeof msg.to !== 'string' || typeof msg.seq !== 'number') {
        return null;
      }
      if (msg.promotion !== undefined && (typeof msg.promotion !== 'string' || !PROMOTIONS.has(msg.promotion))) {
        return null;
      }
      return {
        type: 'move',
        from: msg.from,
        to: msg.to,
        ...(msg.promotion ? { promotion: msg.promotion as PromotionPiece } : {}),
        seq: msg.seq,
      };
    case 'resign':
    case 'draw_offer':
    case 'rematch_request':
    case 'claim_abandonment':
      return { type: msg.type };
    case 'draw_response':
      if (typeof msg.accept !== 'boolean') return null;
      return { type: 'draw_response', accept: msg.accept };
    case 'ping':
      if (typeof msg.ts !== 'number') return null;
      return { type: 'ping', ts: msg.ts };
    default:
      return null;
  }
}
