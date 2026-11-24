import type {
  ClockState,
  Color,
  GameResult,
  GameStatus,
  MoveRecord,
  PlayerInfo,
  PromotionPiece,
  Role,
} from '../../shared/protocol';
import type { TimeControlId } from '../../shared/time-controls';

export type ConnectionStatus = 'local' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface GameSessionState {
  mode: 'solo' | 'online';
  roomId?: string;
  timeControl: TimeControlId;
  status: GameStatus;
  fen: string;
  moves: MoveRecord[];
  clocks: ClockState;
  players: { w: PlayerInfo | null; b: PlayerInfo | null };
  yourRole: Role;
  drawOfferBy: Color | null;
  rematchBy: Color[];
  result: GameResult | null;
  connectionStatus: ConnectionStatus;
  isAiThinking: boolean;
  errorMessage: string | null;
  clockOffsetMs: number;
}

export interface GameSessionActions {
  makeMove(from: string, to: string, promotion?: PromotionPiece): boolean;
  resign(): void;
  offerDraw(): void;
  respondDraw(accept: boolean): void;
  requestRematch(): void;
  claimAbandonment(): void;
  retryAi(): void;
}

export interface GameSession extends GameSessionActions {
  start(): void;
  getState(): GameSessionState;
  subscribe(listener: (state: GameSessionState) => void): () => void;
  getPgn(): string;
  dispose(): void;
}
