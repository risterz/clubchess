import { DurableObject } from 'cloudflare:workers';
import {
  generateRoomId,
  sanitizeDisplayName,
  type ServerQueueMessage,
} from '../shared/protocol';
import { isTimeControlId, type TimeControlId } from '../shared/time-controls';
import type { Env } from './env';

const WS_READY_STATE_OPEN = 1;

interface QueueAttachment {
  name: string;
  timeControl: TimeControlId;
  joinedAt: number;
}

export class MatchmakerDO extends DurableObject<Env> {
  private readonly pairing = new WeakSet<WebSocket>();

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }

    const url = new URL(request.url);
    let tcRaw: string;
    try {
      tcRaw = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    } catch {
      return new Response('Invalid time control', { status: 400 });
    }
    if (!isTimeControlId(tcRaw)) {
      return new Response('Invalid time control', { status: 400 });
    }
    const name = sanitizeDisplayName(url.searchParams.get('name') ?? undefined);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      name,
      timeControl: tcRaw,
      joinedAt: Date.now(),
    } satisfies QueueAttachment);

    await this.tryPair(tcRaw, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private sendQueued(ws: WebSocket, timeControl: TimeControlId, waitingCount: number): void {
    const queuedMsg: ServerQueueMessage = {
      type: 'queued',
      timeControl,
      waitingCount,
    };
    try {
      ws.send(JSON.stringify(queuedMsg));
    } catch {
      // Ignore closed socket
    }
  }

  private async tryPair(timeControl: TimeControlId, newlyJoined: WebSocket): Promise<void> {
    const active = this.ctx
      .getWebSockets()
      .filter((ws) => ws.readyState === WS_READY_STATE_OPEN && !this.pairing.has(ws))
      .map((ws) => ({
        ws,
        att: ws.deserializeAttachment() as QueueAttachment | null,
      }))
      .filter((entry): entry is { ws: WebSocket; att: QueueAttachment } => entry.att !== null)
      .sort((a, b) => a.att.joinedAt - b.att.joinedAt);

    if (active.length < 2) {
      this.sendQueued(newlyJoined, timeControl, active.length);
      return;
    }

    const [first, second] = active;
    if (newlyJoined !== first.ws && newlyJoined !== second.ws) {
      this.sendQueued(newlyJoined, timeControl, active.length - 2);
    }

    this.pairing.add(first.ws);
    this.pairing.add(second.ws);

    try {
      const swap = crypto.getRandomValues(new Uint8Array(1))[0] % 2 === 1;
      const white = swap ? second : first;
      const black = swap ? first : second;
      const roomId = generateRoomId();

      const roomStub = this.env.GAME_ROOM.get(this.env.GAME_ROOM.idFromName(roomId));
      const initRes = await roomStub.fetch('https://internal/init-matched', {
        method: 'POST',
        body: JSON.stringify({
          roomId,
          timeControl,
          whiteName: white.att.name,
          blackName: black.att.name,
        }),
      });

      if (!initRes.ok) return;
      const { whiteToken, blackToken } = (await initRes.json()) as {
        whiteToken: string;
        blackToken: string;
      };

      const whiteMsg: ServerQueueMessage = {
        type: 'matched',
        roomId,
        seatToken: whiteToken,
        color: 'w',
      };
      const blackMsg: ServerQueueMessage = {
        type: 'matched',
        roomId,
        seatToken: blackToken,
        color: 'b',
      };

      try {
        white.ws.send(JSON.stringify(whiteMsg));
        white.ws.close(1000, 'Matched');
      } catch {
        // Ignore
      }
      try {
        black.ws.send(JSON.stringify(blackMsg));
        black.ws.close(1000, 'Matched');
      } catch {
        // Ignore
      }
    } finally {
      this.pairing.delete(first.ws);
      this.pairing.delete(second.ws);
    }
  }

  webSocketClose(): void {
    // Hibernation runtime removes closed sockets from ctx.getWebSockets()
  }

  webSocketError(): void {
    // Hibernation runtime removes errored sockets from ctx.getWebSockets()
  }
}
