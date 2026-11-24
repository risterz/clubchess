import { generateRoomId, isValidRoomId, sanitizeDisplayName, type SidePref } from '../shared/protocol';
import { isTimeControlId } from '../shared/time-controls';
import type { Env } from './env';

export { GameRoomDO } from './game-room-do';
export { MatchmakerDO } from './matchmaker-do';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      let rawBody: unknown;
      try {
        rawBody = await request.json();
      } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
      }
      if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
      }
      const body = rawBody as Record<string, unknown>;
      if (body.name !== undefined && typeof body.name !== 'string') {
        return Response.json({ error: 'Invalid display name' }, { status: 400 });
      }
      const timeControl = body.timeControl ?? '5+0';
      if (typeof timeControl !== 'string' || !isTimeControlId(timeControl)) {
        return Response.json({ error: 'Unsupported time control' }, { status: 400 });
      }
      const sidePref: SidePref =
        body.sidePref === 'w' || body.sidePref === 'b' || body.sidePref === 'random'
          ? body.sidePref
          : 'random';
      const roomId = generateRoomId();
      const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId));
      return stub.fetch('https://internal/init-private', {
        method: 'POST',
        body: JSON.stringify({
          roomId,
          timeControl,
          sidePref,
          name: sanitizeDisplayName(typeof body.name === 'string' ? body.name : ''),
        }),
      });
    }

    const statusMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (request.method === 'GET' && statusMatch) {
      const roomId = statusMatch[1].toUpperCase();
      if (!isValidRoomId(roomId)) {
        return Response.json({ exists: false }, { status: 400 });
      }
      const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId));
      return stub.fetch('https://internal/status');
    }

    const wsRoomMatch = url.pathname.match(/^\/ws\/room\/([^/]+)$/);
    if (wsRoomMatch) {
      const roomId = wsRoomMatch[1].toUpperCase();
      if (!isValidRoomId(roomId)) {
        return new Response('Invalid room ID', { status: 400 });
      }
      const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId));
      return stub.fetch('https://internal/ws', request);
    }

    const wsQueueMatch = url.pathname.match(/^\/ws\/queue\/([^/]+)$/);
    if (wsQueueMatch) {
      let tc: string;
      try {
        tc = decodeURIComponent(wsQueueMatch[1]);
      } catch {
        return new Response('Invalid time control', { status: 400 });
      }
      if (!isTimeControlId(tc)) {
        return new Response('Invalid time control', { status: 400 });
      }
      const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName(tc));
      return stub.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
