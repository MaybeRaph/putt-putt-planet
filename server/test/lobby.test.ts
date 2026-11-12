import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { Lobby, defaultProfile, initPhysics, parseS2C, type Conn, type S2CMsg } from '@ppp/shared';
import { DailyBoard, ProfileStore } from '../src/store';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppp-test-'));
let lobby: Lobby;

function fakeConn() {
  const inbox: S2CMsg[] = [];
  const conn: Conn = {
    id: null,
    profile: null,
    room: null,
    bucket: 60,
    lastRefill: Date.now(),
    sendRaw: (d) => {
      const m = parseS2C(JSON.parse(d));
      if (!m) throw new Error(`server sent invalid message: ${d.slice(0, 200)}`);
      inbox.push(m);
    },
    close: () => {},
  };
  const send = (msg: object) => lobby.onMessage(conn, JSON.stringify(msg));
  const last = <T extends S2CMsg['t']>(t: T) =>
    [...inbox].reverse().find((m) => m.t === t) as Extract<S2CMsg, { t: T }> | undefined;
  return { conn, inbox, send, last };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 4000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await wait(20);
  }
}

beforeAll(async () => {
  await initPhysics();
  lobby = new Lobby({ profiles: new ProfileStore(dir), board: new DailyBoard(dir) }, true);
});
afterAll(() => lobby.shutdown());

describe('Lobby + Room', () => {
  it('runs a 2-player synced game with reconnect', async () => {
    const a = fakeConn(),
      b = fakeConn();
    a.send({ t: 'hello', profile: defaultProfile('g_alice', 'Alice') });
    b.send({ t: 'hello', profile: defaultProfile('g_bob', 'Bob') });
    expect(a.last('welcome')?.playerId).toBe('g_alice');

    a.send({ t: 'createRoom' });
    const code = a.last('joined')!.code;
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    b.send({ t: 'joinRoom', code: code.toLowerCase() });
    expect(b.last('room')?.room.players.length).toBe(2);

    // Non-host cannot configure; host can.
    b.send({ t: 'configure', courseId: 'meadow', mode: 'relay', chaos: false });
    expect(b.last('error')?.code).toBe('not_allowed');
    a.send({ t: 'configure', courseId: 'meadow', mode: 'parallel', chaos: false });
    expect(a.last('room')?.room.mode).toBe('parallel');

    // Start requires everyone ready.
    a.send({ t: 'start' });
    expect(a.last('error')?.code).toBe('not_ready');
    b.send({ t: 'ready', ready: true });
    a.send({ t: 'start' });
    expect(a.last('matchStart')?.players.length).toBe(2);

    // Both shoot; server streams snapshots and events.
    a.send({ t: 'shot', seq: 1, dir: [1, 0], power: 99 }); // power is clamped server-side
    b.send({ t: 'shot', seq: 1, dir: [1, 0.02], power: 0.3 });
    await until(() =>
      a.inbox.some((m) => m.t === 'ev' && m.events.some((e) => e.type === 'shot' && e.entrant === 'g_bob')),
    );
    await until(() => !!a.last('snap')?.balls.some((x) => x[0] === 'g_alice' && x[7] === 1));
    const shotEv = a.inbox
      .flatMap((m) => (m.t === 'ev' ? m.events : []))
      .find((e) => e.type === 'shot' && e.entrant === 'g_alice');
    expect(shotEv && 'power' in shotEv ? shotEv.power : 0).toBe(1);
    // Both clients receive identical snapshots.
    const sa = a.last('snap')!,
      sb = b.last('snap')!;
    expect(sa.tick === sb.tick ? sa.balls : null).toEqual(sa.tick === sb.tick ? sb.balls : null);

    // Bob drops and comes back with his token.
    const token = b.last('joined')!.token;
    lobby.onClose(b.conn);
    await until(() => a.last('room')!.room.players.some((p) => p.id === 'g_bob' && !p.connected));
    const b2 = fakeConn();
    b2.send({ t: 'hello', profile: defaultProfile('g_bob', 'Bob'), token });
    expect(b2.last('matchStart')).toBeTruthy();
    expect(b2.last('score')).toBeTruthy();
    await until(() => a.last('room')!.room.players.every((p) => p.connected));

    // Host leaves -> host migrates.
    a.send({ t: 'leaveRoom' });
    expect(b2.last('room')?.room.hostId).toBe('g_bob');
  });

  it('rejects malformed and unauthenticated messages', () => {
    const c = fakeConn();
    expect(lobby.onMessage(c.conn, 'not json')).toBe(false);
    c.send({ t: 'createRoom' });
    expect(c.last('error')?.code).toBe('no_hello');
    c.send({ t: 'hello', profile: { id: 'x' } });
    expect(c.last('error')?.code).toBe('bad_message');
    c.send({ t: 'hello', profile: defaultProfile('g_carol', 'Carol') });
    c.send({ t: 'joinRoom', code: 'ZZZZZZ' });
    expect(c.last('error')?.code).toBe('no_room');
    c.send({ t: 'shot', seq: 1, dir: [1, 0], power: 'lots' });
    expect(c.last('error')?.code).toBe('bad_message');
  });

  it('serves the daily challenge as a private server-side room', async () => {
    const d = fakeConn();
    d.send({ t: 'hello', profile: defaultProfile('g_dan', 'Dan') });
    d.send({ t: 'dailyStart' });
    const start = d.last('matchStart')!;
    expect(start.mode).toBe('daily');
    expect(start.daily).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    d.send({ t: 'dailyBoard' });
    expect(d.last('dailyBoard')?.par).toBeGreaterThanOrEqual(2);
  });

  it('holds up to 6 players and turns the 7th away', () => {
    const conns = Array.from({ length: 7 }, () => fakeConn());
    conns.forEach((c, i) => c.send({ t: 'hello', profile: defaultProfile(`g_six${i}`, `P${i}`) }));
    conns[0].send({ t: 'createRoom' });
    const code = conns[0].last('joined')!.code;
    for (let i = 1; i < 7; i++) conns[i].send({ t: 'joinRoom', code });
    expect(conns[0].last('room')!.room.players.length).toBe(6);
    expect(conns[6].last('error')).toMatchObject({ code: 'join_failed', message: 'Room is full' });
  });
});

