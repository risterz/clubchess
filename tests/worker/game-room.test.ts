import { SELF, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { ServerRoomMessage } from '../../src/shared/protocol';

async function openRoomSocket(roomId: string): Promise<{
  ws: WebSocket;
  nextMessage: () => Promise<ServerRoomMessage>;
}> {
  const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId));
  const res = await stub.fetch('https://internal/ws', {
    headers: { Upgrade: 'websocket' },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();

  const queue: ServerRoomMessage[] = [];
  const waiters: Array<(msg: ServerRoomMessage) => void> = [];
  ws.addEventListener('message', (ev: MessageEvent) => {
    const parsed = JSON.parse(String(ev.data)) as ServerRoomMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(parsed);
    else queue.push(parsed);
  });

  return {
    ws,
    nextMessage: () =>
      queue.length > 0
        ? Promise.resolve(queue.shift()!)
        : new Promise<ServerRoomMessage>((resolve) => waiters.push(resolve)),
  };
}

describe('GameRoomDO', () => {
  it('seats two players, validates legal/illegal moves, and supports reconnect + rematch swap', async () => {
    const roomId = 'ABCDEF';
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId));
    const initRes = await stub.fetch('https://internal/init-private', {
      method: 'POST',
      body: JSON.stringify({ roomId, timeControl: '3+2', sidePref: 'w', name: 'Alice' }),
    });
    expect(initRes.status).toBe(200);
    const { seatToken: whiteToken } = (await initRes.json()) as { seatToken: string; color: string };

    const p1 = await openRoomSocket(roomId);
    p1.ws.send(JSON.stringify({ type: 'join', name: 'Alice', seatToken: whiteToken }));
    const s1 = await p1.nextMessage();
    expect(s1.type).toBe('room_state');
    if (s1.type === 'room_state') {
      expect(s1.yourRole).toBe('w');
      expect(s1.status).toBe('waiting');
    }

    const p2 = await openRoomSocket(roomId);
    p2.ws.send(JSON.stringify({ type: 'join', name: 'Bob' }));
    const s2 = await p2.nextMessage();
    expect(s2.type).toBe('room_state');
    const blackToken = s2.type === 'room_state' ? s2.seatToken : undefined;
    expect(blackToken).toBeTruthy();
    if (s2.type === 'room_state') {
      expect(s2.yourRole).toBe('b');
      expect(s2.status).toBe('active');
    }
    // Alice receives updated room_state when Bob joins
    const s1Active = await p1.nextMessage();
    expect(s1Active.type).toBe('room_state');

    // Legal opening move by White
    p1.ws.send(JSON.stringify({ type: 'move', from: 'e2', to: 'e4', seq: 1 }));
    const m1a = await p1.nextMessage();
    const m1b = await p2.nextMessage();
    expect(m1a.type).toBe('move_applied');
    expect(m1b.type).toBe('move_applied');

    // Illegal move by White on Black's turn -> error with revertFen
    p1.ws.send(JSON.stringify({ type: 'move', from: 'd2', to: 'd4', seq: 2 }));
    const err = await p1.nextMessage();
    expect(err.type).toBe('error');
    if (err.type === 'error') {
      expect(err.revertFen).toContain('4P3');
    }

    // Reconnect by Black using issued seatToken restores seat and full game state
    p2.ws.close();
    const p1DisconnectNotice = await p1.nextMessage();
    expect(p1DisconnectNotice.type).toBe('presence');
    if (p1DisconnectNotice.type === 'presence') {
      expect(p1DisconnectNotice.color).toBe('b');
      expect(p1DisconnectNotice.online).toBe(false);
      expect(p1DisconnectNotice.graceDeadlineAt).toBeTypeOf('number');
    }

    const p2Reconnected = await openRoomSocket(roomId);
    p2Reconnected.ws.send(JSON.stringify({ type: 'join', name: 'Bob', seatToken: blackToken }));
    const s2Reconnected = await p2Reconnected.nextMessage();
    const s1AfterReconnect = await p1.nextMessage();
    expect(s2Reconnected.type).toBe('room_state');
    expect(s1AfterReconnect.type).toBe('room_state');
    if (s2Reconnected.type === 'room_state') {
      expect(s2Reconnected.yourRole).toBe('b');
      expect(s2Reconnected.moves).toHaveLength(1);
      expect(s2Reconnected.players.b?.graceDeadlineAt).toBeNull();
    }

    // Resign by Black
    p2Reconnected.ws.send(JSON.stringify({ type: 'resign' }));
    const over1 = await p1.nextMessage();
    const over2 = await p2Reconnected.nextMessage();
    expect(over1.type).toBe('game_over');
    expect(over2.type).toBe('game_over');

    // Mutual rematch swaps seats in place
    p1.ws.send(JSON.stringify({ type: 'rematch_request' }));
    await p1.nextMessage();
    await p2Reconnected.nextMessage();
    p2Reconnected.ws.send(JSON.stringify({ type: 'rematch_request' }));
    const r1 = await p1.nextMessage();
    const r2 = await p2Reconnected.nextMessage();
    expect(r1.type).toBe('room_state');
    expect(r2.type).toBe('room_state');
    if (r1.type === 'room_state' && r2.type === 'room_state') {
      expect(r1.yourRole).toBe('b');
      expect(r2.yourRole).toBe('w');
      expect(r1.moves).toHaveLength(0);
    }

    p1.ws.close();
    p2Reconnected.ws.close();
  });

  it('flags active side when DO alarm fires after clock expiry', async () => {
    const roomId = 'CLOCK2';
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId));
    const initRes = await stub.fetch('https://internal/init-matched', {
      method: 'POST',
      body: JSON.stringify({ roomId, timeControl: '1+0', whiteName: 'W', blackName: 'B' }),
    });
    const { whiteToken } = (await initRes.json()) as { whiteToken: string; blackToken: string };
    const p1 = await openRoomSocket(roomId);
    p1.ws.send(JSON.stringify({ type: 'join', name: 'W', seatToken: whiteToken }));
    await p1.nextMessage();

    // White makes move 1 -> clock starts ticking for Black and alarm is scheduled
    p1.ws.send(JSON.stringify({ type: 'move', from: 'e2', to: 'e4', seq: 1 }));
    await p1.nextMessage();

    // Backdate clocks.lastTickAt past Black's 60s clock before invoking DO alarm
    await runInDurableObject(stub, async (instance, state) => {
      const expiredTickAt = Date.now() - 65_000;
      const internal = instance as unknown as {
        room: { clocks: { lastTickAt: number } } | null;
      };
      expect(internal.room).not.toBeNull();
      internal.room!.clocks.lastTickAt = expiredTickAt;
      state.storage.sql.exec(
        'INSERT OR REPLACE INTO room_kv (id, payload) VALUES (1, ?)',
        JSON.stringify(internal.room),
      );
    });

    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    const over = await p1.nextMessage();
    expect(over.type).toBe('game_over');
    if (over.type === 'game_over') {
      expect(over.result).toEqual({ winner: 'w', reason: 'timeout' });
      expect(over.clocks.running).toBe(false);
      expect(over.clocks.bMs).toBe(0);
    }

    const statusRes = await stub.fetch('https://internal/status');
    const statusBody = (await statusRes.json()) as { status: string };
    expect(statusBody.status).toBe('finished');

    p1.ws.close();
  });

  it('routes private room creation, status lookup, and websocket upgrade through Worker edge router', async () => {
    const createRes = await SELF.fetch('https://clubchess.example/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeControl: '5+0', sidePref: 'w', name: 'EdgeAlice' }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { roomId: string; seatToken: string; color: string };
    expect(created.roomId).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(created.color).toBe('w');
    expect(created.seatToken).toBeTruthy();

    const statusRes = await SELF.fetch(`https://clubchess.example/api/rooms/${created.roomId.toLowerCase()}`);
    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as {
      exists: boolean;
      status: string;
      timeControl: string;
      playersCount: number;
    };
    expect(status).toMatchObject({
      exists: true,
      status: 'waiting',
      timeControl: '5+0',
      playersCount: 1,
    });

    const invalidStatus = await SELF.fetch('https://clubchess.example/api/rooms/BAD!');
    expect(invalidStatus.status).toBe(400);

    const wsRes = await SELF.fetch(`https://clubchess.example/ws/room/${created.roomId}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket!;
    ws.accept();
    const statePromise = new Promise<ServerRoomMessage>((resolve) => {
      ws.addEventListener('message', (ev: MessageEvent) => resolve(JSON.parse(String(ev.data)) as ServerRoomMessage), {
        once: true,
      });
    });
    ws.send(JSON.stringify({ type: 'join', name: 'EdgeAlice', seatToken: created.seatToken }));
    const firstMsg = await statePromise;
    expect(firstMsg.type).toBe('room_state');
    if (firstMsg.type === 'room_state') {
      expect(firstMsg.roomId).toBe(created.roomId);
      expect(firstMsg.yourRole).toBe('w');
    }
    ws.close();
  });
});
