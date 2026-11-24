import { DurableObject } from 'cloudflare:workers';
import { Chess } from 'chess.js';
import { computeRemainingMs, createInitialClock, resolveTimeoutResult } from '../shared/clock';
import {
  parseClientRoomMessage,
  sanitizeDisplayName,
  type ClockState,
  type Color,
  type GameResult,
  type GameStatus,
  type MoveRecord,
  type PlayerInfo,
  type Role,
  type ServerRoomMessage,
  type SidePref,
} from '../shared/protocol';
import { isTimeControlId, type TimeControlId } from '../shared/time-controls';
import type { Env } from './env';

const GRACE_PERIOD_MS = 60_000;
const UNUSED_ROOM_TTL_MS = 5 * 60_000;
const WAITING_CLEANUP_MS = 30 * 60_000;
const FINISHED_CLEANUP_MS = 24 * 60 * 60_000;
const WS_READY_STATE_OPEN = 1;
const STARTING_FEN = new Chess().fen();

interface SeatRecord {
  name: string;
  token: string;
  graceDeadlineAt: number | null;
}

interface StoredRoomState {
  roomId: string;
  timeControl: TimeControlId;
  status: GameStatus;
  fen: string;
  moves: MoveRecord[];
  clocks: ClockState;
  seats: { w: SeatRecord | null; b: SeatRecord | null };
  drawOfferBy: Color | null;
  rematchBy: Color[];
  result: GameResult | null;
  cleanupAt: number | null;
}

interface SocketAttachment {
  role: Role;
  seatToken?: string;
}

function generateSeatToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export class GameRoomDO extends DurableObject<Env> {
  private room: StoredRoomState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS room_kv (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)',
      );
      const rows = this.ctx.storage.sql
        .exec<{ payload: string }>('SELECT payload FROM room_kv WHERE id = 1')
        .toArray();
      if (rows.length > 0) {
        this.room = JSON.parse(rows[0].payload) as StoredRoomState;
      }
    });
  }

  private persist(): void {
    if (!this.room) return;
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO room_kv (id, payload) VALUES (1, ?)',
      JSON.stringify(this.room),
    );
  }

  private countSocketsForColor(color: Color): number {
    const seat = this.room?.seats[color];
    if (!seat) return 0;
    let count = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (att?.seatToken === seat.token && ws.readyState === WS_READY_STATE_OPEN) {
        count++;
      }
    }
    return count;
  }

  private getPlayersView(): { w: PlayerInfo | null; b: PlayerInfo | null } {
    if (!this.room) return { w: null, b: null };
    const build = (color: Color): PlayerInfo | null => {
      const seat = this.room!.seats[color];
      if (!seat) return null;
      return {
        name: seat.name,
        online: this.countSocketsForColor(color) > 0,
        graceDeadlineAt: seat.graceDeadlineAt,
      };
    };
    return { w: build('w'), b: build('b') };
  }

  private buildRoomStateMessage(role: Role, seatToken?: string): ServerRoomMessage {
    const room = this.room!;
    const now = Date.now();
    return {
      type: 'room_state',
      roomId: room.roomId,
      timeControl: room.timeControl,
      status: room.status,
      fen: room.fen,
      moves: room.moves,
      clocks: room.clocks,
      players: this.getPlayersView(),
      yourRole: role,
      ...(seatToken ? { seatToken } : {}),
      drawOfferBy: room.drawOfferBy,
      rematchBy: room.rematchBy,
      result: room.result,
      serverNow: now,
    };
  }

  private send(ws: WebSocket, msg: ServerRoomMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Closed socket cleaned up by runtime
    }
  }

  private broadcast(msg: ServerRoomMessage, exclude?: WebSocket): void {
    const serialized = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      try {
        ws.send(serialized);
      } catch {
        // Ignore stale sockets
      }
    }
  }

  private broadcastPersonalizedRoomState(): void {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      const role = this.resolveRoleForToken(att?.seatToken);
      ws.serializeAttachment({ role, seatToken: att?.seatToken } satisfies SocketAttachment);
      this.send(ws, this.buildRoomStateMessage(role, att?.seatToken));
    }
  }

  private resolveRoleForToken(token?: string): Role {
    if (!this.room || !token) return 'spectator';
    if (this.room.seats.w?.token === token) return 'w';
    if (this.room.seats.b?.token === token) return 'b';
    return 'spectator';
  }

  private async scheduleNextAlarm(): Promise<void> {
    if (!this.room) return;
    const now = Date.now();
    const deadlines: number[] = [];

    if (this.room.status === 'active' && this.room.timeControl !== 'unlimited' && this.room.clocks.running) {
      const turn = new Chess(this.room.fen).turn() as Color;
      const activeMs = turn === 'w' ? this.room.clocks.wMs : this.room.clocks.bMs;
      deadlines.push(this.room.clocks.lastTickAt + activeMs);
    }
    if (this.room.status === 'active') {
      if (this.room.seats.w?.graceDeadlineAt && this.room.seats.w.graceDeadlineAt > now) {
        deadlines.push(this.room.seats.w.graceDeadlineAt);
      }
      if (this.room.seats.b?.graceDeadlineAt && this.room.seats.b.graceDeadlineAt > now) {
        deadlines.push(this.room.seats.b.graceDeadlineAt);
      }
    }
    if (this.room.cleanupAt) {
      deadlines.push(this.room.cleanupAt);
    }

    if (deadlines.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const earliest = Math.min(...deadlines);
    await this.ctx.storage.setAlarm(Math.max(now + 50, earliest));
  }

  private finishGame(result: GameResult, now: number): void {
    if (!this.room || this.room.status === 'finished') return;
    this.room.status = 'finished';
    this.room.clocks.running = false;
    this.room.clocks.lastTickAt = now;
    this.room.result = result;
    this.room.drawOfferBy = null;
    this.room.cleanupAt = now + FINISHED_CLEANUP_MS;
    this.persist();
    this.broadcast({
      type: 'game_over',
      result,
      clocks: this.room.clocks,
      serverNow: now,
    });
  }

  private isThreefoldFromHistory(currentFen: string): boolean {
    if (!this.room) return false;
    const target = positionKey(currentFen);
    let count = positionKey(STARTING_FEN) === target ? 1 : 0;
    for (const move of this.room.moves) {
      if (positionKey(move.fen) === target) {
        count++;
        if (count >= 3) return true;
      }
    }
    return false;
  }

  private detectFideTermination(chess: Chess): GameResult | null {
    if (chess.isCheckmate()) {
      const winner: Color = chess.turn() === 'w' ? 'b' : 'w';
      return { winner, reason: 'checkmate' };
    }
    if (chess.isStalemate()) return { winner: 'draw', reason: 'stalemate' };
    if (chess.isThreefoldRepetition() || this.isThreefoldFromHistory(chess.fen())) {
      return { winner: 'draw', reason: 'threefold' };
    }
    if (chess.isInsufficientMaterial()) return { winner: 'draw', reason: 'insufficient_material' };
    if (chess.isDrawByFiftyMoves()) return { winner: 'draw', reason: 'fifty_move' };
    return null;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/init-private') {
      const body = (await request.json()) as {
        roomId: string;
        timeControl: string;
        sidePref?: SidePref;
        name?: string;
      };
      if (!isTimeControlId(body.timeControl)) {
        return Response.json({ error: 'Invalid time control' }, { status: 400 });
      }
      const now = Date.now();
      const sidePref: SidePref = body.sidePref === 'w' || body.sidePref === 'b' ? body.sidePref : 'random';
      const creatorColor: Color =
        sidePref === 'random' ? (crypto.getRandomValues(new Uint8Array(1))[0] % 2 === 0 ? 'w' : 'b') : sidePref;
      const seatToken = generateSeatToken();
      const seat: SeatRecord = {
        name: sanitizeDisplayName(body.name),
        token: seatToken,
        graceDeadlineAt: null,
      };
      this.room = {
        roomId: body.roomId,
        timeControl: body.timeControl,
        status: 'waiting',
        fen: STARTING_FEN,
        moves: [],
        clocks: createInitialClock(body.timeControl, now),
        seats: creatorColor === 'w' ? { w: seat, b: null } : { w: null, b: seat },
        drawOfferBy: null,
        rematchBy: [],
        result: null,
        cleanupAt: now + WAITING_CLEANUP_MS,
      };
      this.persist();
      await this.scheduleNextAlarm();
      return Response.json({ roomId: body.roomId, seatToken, color: creatorColor });
    }

    if (request.method === 'POST' && url.pathname === '/init-matched') {
      const body = (await request.json()) as {
        roomId: string;
        timeControl: string;
        whiteName: string;
        blackName: string;
      };
      if (!isTimeControlId(body.timeControl)) {
        return Response.json({ error: 'Invalid time control' }, { status: 400 });
      }
      const now = Date.now();
      const whiteToken = generateSeatToken();
      const blackToken = generateSeatToken();
      this.room = {
        roomId: body.roomId,
        timeControl: body.timeControl,
        status: 'active',
        fen: STARTING_FEN,
        moves: [],
        clocks: createInitialClock(body.timeControl, now),
        seats: {
          w: {
            name: sanitizeDisplayName(body.whiteName),
            token: whiteToken,
            graceDeadlineAt: now + GRACE_PERIOD_MS,
          },
          b: {
            name: sanitizeDisplayName(body.blackName),
            token: blackToken,
            graceDeadlineAt: now + GRACE_PERIOD_MS,
          },
        },
        drawOfferBy: null,
        rematchBy: [],
        result: null,
        cleanupAt: now + UNUSED_ROOM_TTL_MS,
      };
      this.persist();
      await this.scheduleNextAlarm();
      return Response.json({ roomId: body.roomId, whiteToken, blackToken });
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      if (!this.room) return Response.json({ exists: false }, { status: 404 });
      const playersCount = Number(Boolean(this.room.seats.w)) + Number(Boolean(this.room.seats.b));
      return Response.json({
        exists: true,
        roomId: this.room.roomId,
        status: this.room.status,
        timeControl: this.room.timeControl,
        playersCount,
      });
    }

    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ role: 'spectator' } satisfies SocketAttachment);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;
    const msg = parseClientRoomMessage(raw);
    if (!msg) {
      this.send(ws, { type: 'error', code: 'BAD_MESSAGE', message: 'Invalid message payload' });
      return;
    }

    if (msg.type === 'ping') {
      this.send(ws, { type: 'pong', ts: msg.ts, serverNow: Date.now() });
      return;
    }

    if (!this.room) {
      this.send(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'Room does not exist' });
      return;
    }

    const now = Date.now();

    if (msg.type === 'join') {
      let role = this.resolveRoleForToken(msg.seatToken);
      let assignedToken = msg.seatToken;
      let stateChanged = false;
      let nameChanged = false;

      if (role !== 'spectator') {
        const seat = this.room.seats[role]!;
        const nextName = sanitizeDisplayName(msg.name);
        if (seat.name !== nextName) {
          seat.name = nextName;
          nameChanged = true;
        }
        if (seat.graceDeadlineAt !== null) {
          seat.graceDeadlineAt = null;
          stateChanged = true;
        }
        if (this.room.status === 'active' && this.room.cleanupAt !== null) {
          this.room.cleanupAt = null;
          stateChanged = true;
        }
      } else if (this.room.status === 'waiting') {
        const openColor: Color | null = !this.room.seats.w ? 'w' : !this.room.seats.b ? 'b' : null;
        if (openColor) {
          assignedToken = generateSeatToken();
          this.room.seats[openColor] = {
            name: sanitizeDisplayName(msg.name),
            token: assignedToken,
            graceDeadlineAt: null,
          };
          role = openColor;
          this.room.status = 'active';
          this.room.cleanupAt = null;
          stateChanged = true;
        }
      }

      ws.serializeAttachment({ role, seatToken: assignedToken } satisfies SocketAttachment);

      if (stateChanged) {
        this.persist();
        await this.scheduleNextAlarm();
        this.broadcastPersonalizedRoomState();
      } else {
        if (nameChanged) {
          this.persist();
        }
        this.send(ws, this.buildRoomStateMessage(role, assignedToken));
        if (role !== 'spectator') {
          this.broadcast(
            {
              type: 'presence',
              color: role,
              online: true,
              graceDeadlineAt: null,
              serverNow: now,
            },
            ws,
          );
        }
      }
      return;
    }

    const att = ws.deserializeAttachment() as SocketAttachment | null;
    const role = this.resolveRoleForToken(att?.seatToken);
    if (role === 'spectator') {
      this.send(ws, { type: 'error', code: 'FORBIDDEN', message: 'Spectators cannot perform game actions' });
      return;
    }

    if (msg.type === 'move') {
      if (this.room.status !== 'active') {
        this.send(ws, {
          type: 'error',
          code: 'NOT_ACTIVE',
          message: 'Game is not active',
          revertFen: this.room.fen,
        });
        return;
      }

      const chess = new Chess(this.room.fen);
      if (chess.turn() !== role) {
        this.send(ws, {
          type: 'error',
          code: 'NOT_YOUR_TURN',
          message: 'It is not your turn',
          revertFen: this.room.fen,
        });
        return;
      }

      let remaining: { wMs: number; bMs: number } | null = null;
      if (this.room.timeControl !== 'unlimited' && this.room.clocks.running) {
        remaining = computeRemainingMs(this.room.clocks, role, now);
        const moverRemaining = role === 'w' ? remaining.wMs : remaining.bMs;
        if (moverRemaining <= 0) {
          this.room.clocks.wMs = remaining.wMs;
          this.room.clocks.bMs = remaining.bMs;
          this.finishGame(resolveTimeoutResult(this.room.fen, role), now);
          await this.scheduleNextAlarm();
          return;
        }
      }

      let applied;
      try {
        applied = chess.move({ from: msg.from, to: msg.to, promotion: msg.promotion });
      } catch {
        applied = null;
      }

      if (!applied) {
        this.send(ws, {
          type: 'error',
          code: 'ILLEGAL_MOVE',
          message: 'Illegal chess move',
          revertFen: this.room.fen,
        });
        return;
      }

      if (this.room.timeControl !== 'unlimited') {
        if (remaining) {
          this.room.clocks.wMs = remaining.wMs;
          this.room.clocks.bMs = remaining.bMs;
        }
        if (this.room.clocks.running) {
          if (role === 'w') this.room.clocks.wMs += this.room.clocks.incrementMs;
          else this.room.clocks.bMs += this.room.clocks.incrementMs;
        }
        this.room.clocks.running = true;
        this.room.clocks.lastTickAt = now;
      }

      const moveRecord: MoveRecord = {
        san: applied.san,
        uci: `${applied.from}${applied.to}${applied.promotion ?? ''}`,
        fen: chess.fen(),
        wMs: this.room.clocks.wMs,
        bMs: this.room.clocks.bMs,
      };
      this.room.fen = chess.fen();
      this.room.moves.push(moveRecord);
      this.room.drawOfferBy = null;

      const result = this.detectFideTermination(chess);
      if (result) {
        this.room.status = 'finished';
        this.room.clocks.running = false;
        this.room.result = result;
        this.room.cleanupAt = now + FINISHED_CLEANUP_MS;
      }

      this.persist();
      await this.scheduleNextAlarm();
      this.broadcast({
        type: 'move_applied',
        move: moveRecord,
        clocks: this.room.clocks,
        result,
        serverNow: now,
      });
      return;
    }

    if (msg.type === 'resign' && this.room.status === 'active') {
      const winner: Color = role === 'w' ? 'b' : 'w';
      this.finishGame({ winner, reason: 'resignation' }, now);
      await this.scheduleNextAlarm();
      return;
    }

    if (msg.type === 'draw_offer' && this.room.status === 'active') {
      if (this.room.drawOfferBy !== role) {
        this.room.drawOfferBy = role;
        this.persist();
        this.broadcast({ type: 'draw_offered', by: role });
      }
      return;
    }

    if (msg.type === 'draw_response' && this.room.status === 'active') {
      if (this.room.drawOfferBy && this.room.drawOfferBy !== role) {
        if (msg.accept) {
          this.finishGame({ winner: 'draw', reason: 'draw_agreement' }, now);
          await this.scheduleNextAlarm();
        } else {
          this.room.drawOfferBy = null;
          this.persist();
          this.broadcast({ type: 'draw_declined' });
        }
      }
      return;
    }

    if (msg.type === 'claim_abandonment' && this.room.status === 'active') {
      const opp: Color = role === 'w' ? 'b' : 'w';
      const oppSeat = this.room.seats[opp];
      if (
        oppSeat &&
        this.countSocketsForColor(opp) === 0 &&
        oppSeat.graceDeadlineAt !== null &&
        now >= oppSeat.graceDeadlineAt
      ) {
        this.finishGame({ winner: role, reason: 'abandonment' }, now);
        await this.scheduleNextAlarm();
      }
      return;
    }

    if (msg.type === 'rematch_request' && this.room.status === 'finished') {
      if (!this.room.rematchBy.includes(role)) {
        this.room.rematchBy.push(role);
      }
      if (this.room.rematchBy.includes('w') && this.room.rematchBy.includes('b')) {
        const oldW = this.room.seats.w;
        const oldB = this.room.seats.b;
        this.room.seats = {
          w: oldB ? { ...oldB, graceDeadlineAt: null } : null,
          b: oldW ? { ...oldW, graceDeadlineAt: null } : null,
        };
        this.room.status = 'active';
        this.room.fen = STARTING_FEN;
        this.room.moves = [];
        this.room.clocks = createInitialClock(this.room.timeControl, now);
        this.room.drawOfferBy = null;
        this.room.rematchBy = [];
        this.room.result = null;
        this.room.cleanupAt = null;
        this.persist();
        await this.scheduleNextAlarm();
        this.broadcastPersonalizedRoomState();
      } else {
        this.persist();
        this.broadcast({ type: 'rematch_updated', rematchBy: [...this.room.rematchBy] });
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    if (!this.room || this.room.status !== 'active') return;
    const att = ws.deserializeAttachment() as SocketAttachment | null;
    const role = this.resolveRoleForToken(att?.seatToken);
    if (role === 'spectator') return;

    // Only start disconnect grace when the player's last active socket closes
    let remainingOpen = 0;
    for (const sock of this.ctx.getWebSockets()) {
      if (sock === ws) continue;
      const other = sock.deserializeAttachment() as SocketAttachment | null;
      if (other?.seatToken === att?.seatToken && sock.readyState === WS_READY_STATE_OPEN) {
        remainingOpen++;
      }
    }

    if (remainingOpen === 0) {
      const now = Date.now();
      const seat = this.room.seats[role];
      if (seat) {
        seat.graceDeadlineAt = now + GRACE_PERIOD_MS;
        this.persist();
        await this.scheduleNextAlarm();
        this.broadcast({
          type: 'presence',
          color: role,
          online: false,
          graceDeadlineAt: seat.graceDeadlineAt,
          serverNow: now,
        });
      }
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  async alarm(): Promise<void> {
    if (!this.room) return;
    const now = Date.now();

    if (this.room.status === 'active' && this.room.timeControl !== 'unlimited' && this.room.clocks.running) {
      const turn = new Chess(this.room.fen).turn() as Color;
      const rem = computeRemainingMs(this.room.clocks, turn, now);
      const activeMs = turn === 'w' ? rem.wMs : rem.bMs;
      if (activeMs <= 0) {
        this.room.clocks.wMs = rem.wMs;
        this.room.clocks.bMs = rem.bMs;
        this.finishGame(resolveTimeoutResult(this.room.fen, turn), now);
      }
    }

    const isUnusedActiveRoom =
      this.room.status === 'active' &&
      this.room.moves.length === 0 &&
      this.countSocketsForColor('w') === 0 &&
      this.countSocketsForColor('b') === 0;

    if (
      this.room.cleanupAt !== null &&
      now >= this.room.cleanupAt &&
      (this.room.status !== 'active' || isUnusedActiveRoom)
    ) {
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(1000, 'Room expired');
        } catch {
          // Ignore
        }
      }
      this.room = null;
      await this.ctx.storage.deleteAll();
      return;
    }

    await this.scheduleNextAlarm();
  }
}
