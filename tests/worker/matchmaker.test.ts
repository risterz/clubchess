import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { ServerQueueMessage } from '../../src/shared/protocol';

async function connectQueue(tc: string, name: string): Promise<{
  ws: WebSocket;
  nextMessage: () => Promise<ServerQueueMessage>;
}> {
  const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName(tc));
  const res = await stub.fetch(
    `https://internal/ws/queue/${encodeURIComponent(tc)}?name=${encodeURIComponent(name)}`,
    {
      headers: { Upgrade: 'websocket' },
    },
  );
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const queue: ServerQueueMessage[] = [];
  const waiters: Array<(msg: ServerQueueMessage) => void> = [];
  ws.addEventListener('message', (ev: MessageEvent) => {
    const parsed = JSON.parse(String(ev.data)) as ServerQueueMessage;
    const w = waiters.shift();
    if (w) w(parsed);
    else queue.push(parsed);
  });
  return {
    ws,
    nextMessage: () =>
      queue.length > 0
        ? Promise.resolve(queue.shift()!)
        : new Promise<ServerQueueMessage>((resolve) => waiters.push(resolve)),
  };
}

describe('MatchmakerDO', () => {
  it('pairs two waiting players into an initialized GameRoomDO with opposite colors', async () => {
    const q1 = await connectQueue('3+0', 'Alice');
    const queued1 = await q1.nextMessage();
    expect(queued1).toEqual({ type: 'queued', timeControl: '3+0', waitingCount: 1 });

    const q2 = await connectQueue('3+0', 'Bob');
    const [m1, m2] = await Promise.all([q1.nextMessage(), q2.nextMessage()]);
    // q2 may receive queued then matched, or matched directly; unwrap to matched
    const final2 = m2.type === 'queued' ? await q2.nextMessage() : m2;

    expect(m1.type).toBe('matched');
    expect(final2.type).toBe('matched');
    if (m1.type === 'matched' && final2.type === 'matched') {
      expect(m1.roomId).toBe(final2.roomId);
      expect(m1.color).not.toBe(final2.color);
      expect(m1.seatToken).not.toBe(final2.seatToken);

      const roomStub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(m1.roomId));
      const statusRes = await roomStub.fetch('https://internal/status');
      expect(statusRes.status).toBe(200);
      const status = (await statusRes.json()) as { status: string; playersCount: number };
      expect(status.status).toBe('active');
      expect(status.playersCount).toBe(2);
    }
  });

  it('cleans up disconnected waiters so a third player does not match a ghost socket', async () => {
    const q1 = await connectQueue('5+0', 'Ghost');
    await q1.nextMessage();
    q1.ws.close(1000, 'cancel');

    const q2 = await connectQueue('5+0', 'Real');
    const msg = await q2.nextMessage();
    expect(msg).toEqual({ type: 'queued', timeControl: '5+0', waitingCount: 1 });
    q2.ws.close();
  });

  it('rejects non-websocket upgrades with 426 and invalid time controls with 400', async () => {
    const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('3+0'));
    const noUpgrade = await stub.fetch('https://internal/ws/queue/3+0?name=Alice');
    expect(noUpgrade.status).toBe(426);

    const badTc = await stub.fetch('https://internal/ws/queue/99+0?name=Alice', {
      headers: { Upgrade: 'websocket' },
    });
    expect(badTc.status).toBe(400);

    const badEncoding = await stub.fetch('https://internal/ws/queue/%E0%A4%A?name=Alice', {
      headers: { Upgrade: 'websocket' },
    });
    expect(badEncoding.status).toBe(400);
  });

  it('routes /ws/queue/:tc through the Worker edge router and pairs players', async () => {
    const r1 = await SELF.fetch('https://clubchess.example/ws/queue/3%2B2?name=EdgeA', {
      headers: { Upgrade: 'websocket' },
    });
    expect(r1.status).toBe(101);
    const ws1 = r1.webSocket!;
    ws1.accept();
    const msgs1: ServerQueueMessage[] = [];
    const waiters1: Array<(m: ServerQueueMessage) => void> = [];
    ws1.addEventListener('message', (ev: MessageEvent) => {
      const m = JSON.parse(String(ev.data)) as ServerQueueMessage;
      const w = waiters1.shift();
      if (w) w(m);
      else msgs1.push(m);
    });
    const next1 = () =>
      msgs1.length > 0
        ? Promise.resolve(msgs1.shift()!)
        : new Promise<ServerQueueMessage>((resolve) => waiters1.push(resolve));

    const first = await next1();
    expect(first).toEqual({ type: 'queued', timeControl: '3+2', waitingCount: 1 });

    const r2 = await SELF.fetch('https://clubchess.example/ws/queue/3%2B2?name=EdgeB', {
      headers: { Upgrade: 'websocket' },
    });
    expect(r2.status).toBe(101);
    const ws2 = r2.webSocket!;
    ws2.accept();
    const msgs2: ServerQueueMessage[] = [];
    const waiters2: Array<(m: ServerQueueMessage) => void> = [];
    ws2.addEventListener('message', (ev: MessageEvent) => {
      const m = JSON.parse(String(ev.data)) as ServerQueueMessage;
      const w = waiters2.shift();
      if (w) w(m);
      else msgs2.push(m);
    });
    const next2 = () =>
      msgs2.length > 0
        ? Promise.resolve(msgs2.shift()!)
        : new Promise<ServerQueueMessage>((resolve) => waiters2.push(resolve));

    const [m1, m2] = await Promise.all([next1(), next2()]);
    const final2 = m2.type === 'queued' ? await next2() : m2;
    expect(m1.type).toBe('matched');
    expect(final2.type).toBe('matched');
    if (m1.type === 'matched' && final2.type === 'matched') {
      expect(m1.roomId).toBe(final2.roomId);
      expect(m1.color).not.toBe(final2.color);
    }

    const badRouterTc = await SELF.fetch('https://clubchess.example/ws/queue/invalid', {
      headers: { Upgrade: 'websocket' },
    });
    expect(badRouterTc.status).toBe(400);
  });
});
