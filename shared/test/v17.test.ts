import { beforeAll, describe, expect, it } from 'vitest';
import { makeHole } from '../src/courses/builder';
import { SLICK_SURFACES } from '../src/hopper/generate';
import {
  HoleSchema,
  HopperMatch,
  Lobby,
  PHYSICS,
  SKELETON,
  SLICK_GREEN_GRIP,
  SURFACES,
  Simulation,
  defaultProfile,
  initPhysics,
  memoryStorage,
  parseC2S,
  parseS2C,
  stageHole,
  type Conn,
  type S2CMsg,
  type Solid,
  type SurfaceKind,
} from '../src/index';

beforeAll(async () => {
  await initPhysics();
});

describe('v1.7 slick greens', () => {
  it('has one named grip constant, about 20% up on ice, and leaves other surfaces alone', () => {
    expect(SLICK_GREEN_GRIP).toBeCloseTo(1.2, 5);
    expect(SURFACES.slick.rolling).toBeCloseTo(SURFACES.ice.rolling * SLICK_GREEN_GRIP, 6);
    expect(SURFACES.slick.drag).toBeCloseTo(SURFACES.ice.drag * SLICK_GREEN_GRIP, 6);
    // The surfaces that are not part of the Slick Greens omen keep their v1.6 feel.
    expect(SURFACES.ice).toEqual({ rolling: 0.12, drag: 0.04, restitution: 0.1, settle: 0.6 });
    expect(SURFACES.grass).toEqual({ rolling: 1.15, drag: 0.32, restitution: 0.12, settle: 1 });
    expect(SURFACES.sand.rolling).toBe(6);
    expect(SURFACES.sticky.rolling).toBe(4.5);
    expect(SURFACES.metal.rolling).toBe(0.8);
    // Still ordered from glassy to grippy: slick < frost < rime < grass.
    expect(SURFACES.slick.rolling).toBeLessThan(SURFACES.frost.rolling);
    expect(SURFACES.frost.rolling).toBeLessThan(SURFACES.rime.rolling);
    expect(SURFACES.rime.rolling).toBeLessThan(SURFACES.grass.rolling);
  });

  /** How far a putt of the same strength rolls along a long flat lane of one surface. */
  function roll(surface: SurfaceKind): number {
    const input = makeHole({
      id: `roll-${surface}`,
      name: 'Roll',
      par: 3,
      points: [
        [0, 0, 0],
        [70, 0, 0],
      ],
    });
    for (const s of input.solids as Solid[]) if (s.role === 'floor') s.surface = surface;
    const sim = new Simulation(HoleSchema.parse(input));
    sim.addBall('b', [1, PHYSICS.ballRadius + 0.01, 0]);
    sim.shoot('b', 1, 0, 0.35);
    for (let i = 0; i < 60 * 40; i++) sim.step();
    const x = sim.getBall('b')!.pos[0];
    sim.dispose();
    return x - 1;
  }

  it('slides roughly a fifth less far than true ice', () => {
    const ice = roll('ice');
    const slick = roll('slick');
    expect(ice).toBeGreaterThan(8);
    expect(slick / ice).toBeGreaterThan(0.74);
    expect(slick / ice).toBeLessThan(0.9);
    // And the softened versions are progressively grippier.
    const frost = roll('frost');
    const rime = roll('rime');
    expect(frost).toBeLessThan(slick);
    expect(rime).toBeLessThan(frost);
    expect(rime).toBeGreaterThan(roll('grass'));
  });

  it('freezes slopes, curves and slides in every sector, at every Storm Compass level', () => {
    const sloped = (s: Solid) => Math.abs(s.rot[0]) > 0.02 || Math.abs(s.rot[2]) > 0.02;
    const slopesSeen: Record<string, number> = {};
    for (let seed = 1; seed <= 8; seed++) {
      const m = new HopperMatch({ seed, players: [{ id: 'p', name: 'P' }], upgrades: {}, keepsakes: [] });
      for (let i = 0; i < SKELETON.length; i++) {
        const base = m.makeSpec(i, 'slick', null, 0);
        if (base.kind === 'rest' || base.omen !== 'slick') continue; // bosses roll their own omen
        for (let level = 0; level <= 2; level++) {
          const hole = stageHole(seed, i, { ...base, shaping: Array(level).fill('compass') });
          for (const s of hole.solids) {
            if (s.role !== 'floor' || s.color) continue;
            expect(s.surface, `${base.world} stage ${i} compass ${level} ${s.shape}`).toBe(
              SLICK_SURFACES[level],
            );
            if (sloped(s) || s.shape === 'ribbon')
              slopesSeen[`${base.world}:${level}`] = (slopesSeen[`${base.world}:${level}`] ?? 0) + 1;
          }
        }
      }
    }
    // The check above really did cover sloped ground on Space (the sector in the bug report) and elsewhere.
    for (const level of [0, 1, 2]) expect(slopesSeen[`space:${level}`]).toBeGreaterThan(5);
    expect(Object.keys(slopesSeen).some((k) => k.startsWith('meadow'))).toBe(true);
  });

  it('a ball actually slides on a frozen slope (physics, not just looks)', () => {
    // Same ramp twice: frozen it lets the ball run on much further than on grass.
    const run = (surface: SurfaceKind) => {
      const input = makeHole({
        id: `ramp-${surface}`,
        name: 'Ramp',
        par: 3,
        points: [
          [0, 0, 0],
          [40, 0, 0],
        ],
      });
      const floor = (input.solids as Solid[]).find((s) => s.role === 'floor')!;
      floor.surface = surface;
      floor.rot = [0, 0, -0.06]; // gentle downhill towards +x
      const sim = new Simulation(HoleSchema.parse(input));
      const y = (x: number) => floor.center[1] + floor.size[1] / 2 + (floor.center[0] - x) * Math.tan(0.06);
      sim.addBall('b', [2, y(2) + PHYSICS.ballRadius + 0.05, 0]);
      sim.shoot('b', 1, 0, 0.12);
      // Three seconds: long enough for grass to stop the ball, short enough to stay on the ramp.
      for (let i = 0; i < 60 * 3; i++) sim.step();
      const x = sim.getBall('b')!.pos[0];
      sim.dispose();
      return x;
    };
    expect(run('slick')).toBeGreaterThan(run('grass') + 1.5);
  });
});

function fakeConn(lobby: Lobby) {
  const inbox: S2CMsg[] = [];
  let closed = false;
  const conn: Conn = {
    id: null,
    profile: null,
    room: null,
    bucket: 60,
    lastRefill: Date.now(),
    sendRaw: (d) => {
      const m = parseS2C(JSON.parse(d));
      if (!m) throw new Error(`host sent an invalid message: ${d.slice(0, 200)}`);
      inbox.push(m);
    },
    close: () => {
      closed = true;
    },
  };
  const send = (msg: object) => lobby.onMessage(conn, JSON.stringify(msg));
  const last = <T extends S2CMsg['t']>(t: T) =>
    [...inbox].reverse().find((m) => m.t === t) as Extract<S2CMsg, { t: T }> | undefined;
  return { conn, inbox, send, last, isClosed: () => closed };
}

function party(lobby: Lobby, names: string[]) {
  const conns = names.map((n) => {
    const c = fakeConn(lobby);
    c.send({ t: 'hello', profile: defaultProfile(`g_${n.toLowerCase()}`, n) });
    return c;
  });
  conns[0].send({ t: 'createRoom' });
  const code = conns[0].last('joined')!.code;
  for (const c of conns.slice(1)) c.send({ t: 'joinRoom', code });
  return { conns, code, room: lobby.rooms.get(code)! };
}

describe('v1.7 lobby: ready state', () => {
  it('readies and un-readies a guest, and tells everyone', () => {
    const lobby = new Lobby(memoryStorage(), false, { daily: false });
    const {
      conns: [host, guest],
      room,
    } = party(lobby, ['Hana', 'Gus']);
    const readyOf = (c: typeof host) => c.last('room')!.room.players.find((p) => p.id === 'g_gus')!.ready;
    expect(readyOf(host)).toBe(false);
    guest.send({ t: 'ready', ready: true });
    expect(readyOf(host)).toBe(true);
    expect(readyOf(guest)).toBe(true);
    // Sending the same state twice (a double-click) is harmless.
    guest.send({ t: 'ready', ready: true });
    expect(readyOf(host)).toBe(true);
    guest.send({ t: 'ready', ready: false });
    expect(readyOf(host)).toBe(false);
    expect(room.members.get('g_gus')!.ready).toBe(false);
    lobby.shutdown();
  });

  it("keeps a guest's seat usable after they switch to a new link", () => {
    const lobby = new Lobby(memoryStorage(), false, { daily: false });
    const {
      conns: [host, old],
      code,
    } = party(lobby, ['Hana', 'Gus']);
    // The same player arrives on a second link (a retried invite); the old link closes late.
    const fresh = fakeConn(lobby);
    fresh.send({ t: 'hello', profile: defaultProfile('g_gus', 'Gus') });
    fresh.send({ t: 'joinRoom', code });
    lobby.onClose(old.conn);
    const gus = () => host.last('room')!.room.players.find((p) => p.id === 'g_gus')!;
    expect(gus().connected).toBe(true);
    fresh.send({ t: 'ready', ready: true });
    expect(gus().ready).toBe(true);
    host.send({ t: 'start' });
    expect(host.last('error')).toBeUndefined();
    expect(host.last('matchStart')).toBeDefined();
    lobby.shutdown();
  });

  it("one player's broken link doesn't stop the others hearing about a ready-up", () => {
    const lobby = new Lobby(memoryStorage(), false, { daily: false });
    const {
      conns: [host, broken, guest],
    } = party(lobby, ['Hana', 'Bo', 'Gus']);
    broken.conn.sendRaw = () => {
      throw new Error('channel is closing');
    };
    guest.send({ t: 'ready', ready: true });
    // Gus joined after Bo, so his update is sent after Bo's failed one.
    expect(guest.last('room')!.room.players.find((p) => p.id === 'g_gus')!.ready).toBe(true);
    expect(host.last('room')!.room.players.find((p) => p.id === 'g_gus')!.ready).toBe(true);
    lobby.shutdown();
  });
});

describe('v1.7 kick', () => {
  it('is part of the protocol', () => {
    expect(parseC2S({ t: 'kick', id: 'g_x' })).toEqual({ t: 'kick', id: 'g_x' });
    expect(parseC2S({ t: 'kick' })).toBeNull();
    expect(parseS2C({ t: 'kicked', message: 'bye' })).toEqual({ t: 'kicked', message: 'bye' });
  });

  it('lets the host remove a player, who gets a clear message and cannot walk back in', () => {
    const lobby = new Lobby(memoryStorage(), false, { daily: false });
    const {
      conns: [host, guest, other],
      code,
      room,
    } = party(lobby, ['Hana', 'Gus', 'Ola']);
    host.send({ t: 'kick', id: 'g_gus' });
    expect(guest.last('kicked')?.message).toBe('Hana removed you from the game');
    expect(room.members.has('g_gus')).toBe(false);
    for (const c of [host, other])
      expect(c.last('room')!.room.players.map((p) => p.name)).toEqual(['Hana', 'Ola']);
    expect(other.last('chat')?.text).toBe('Gus was removed by the host');
    // The kicked player is no longer in the room: nothing they send reaches it.
    guest.send({ t: 'ready', ready: true });
    expect(room.members.has('g_gus')).toBe(false);
    guest.send({ t: 'joinRoom', code });
    expect(guest.last('error')?.message).toBe('The host removed you from this game');
    expect(room.members.has('g_gus')).toBe(false);
    lobby.shutdown();
  });

  it("ignores a kick from anyone but the host, and the host can't remove themself", () => {
    const lobby = new Lobby(memoryStorage(), false, { daily: false });
    const {
      conns: [host, guest, other],
      room,
    } = party(lobby, ['Hana', 'Gus', 'Ola']);
    guest.send({ t: 'kick', id: 'g_ola' });
    expect(guest.last('error')).toMatchObject({
      code: 'not_allowed',
      message: 'Only the host can remove players',
    });
    guest.send({ t: 'kick', id: 'g_hana' });
    expect(room.members.size).toBe(3);
    expect(other.last('kicked')).toBeUndefined();
    expect(host.last('kicked')).toBeUndefined();
    host.send({ t: 'kick', id: 'g_hana' });
    expect(host.last('error')?.message).toBe("The host can't be removed");
    host.send({ t: 'kick', id: 'g_nobody' });
    expect(host.last('error')?.message).toBe('That player already left');
    expect(room.members.size).toBe(3);
    expect(room.hostId).toBe('g_hana');
    lobby.shutdown();
  });

  it('works mid-game: the player leaves the turn order and the game carries on', () => {
    const lobby = new Lobby(memoryStorage(), false, { daily: false });
    const {
      conns: [host, guest, other],
      room,
    } = party(lobby, ['Hana', 'Gus', 'Ola']);
    host.send({ t: 'configure', courseId: 'meadow', mode: 'relay', chaos: false });
    guest.send({ t: 'ready', ready: true });
    other.send({ t: 'ready', ready: true });
    host.send({ t: 'start' });
    expect(room.phase).toBe('playing');
    host.send({ t: 'kick', id: 'g_gus' });
    expect(guest.last('kicked')).toBeDefined();
    expect(room.members.has('g_gus')).toBe(false);
    expect(room.phase).toBe('playing');
    // Relay turns skip the removed player from now on.
    const turns = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const t = room.match!.score().turn;
      if (t) turns.add(t);
      room.match!.shoot(t!, 1, 0, 0.2);
      for (let k = 0; k < 900 && room.match!.score().turn === t && room.match!.phase === 'playing'; k++)
        room.match!.step();
    }
    expect(turns.has('g_gus')).toBe(false);
    expect(turns.size).toBeGreaterThan(0);
    lobby.shutdown();
  });

  it('direct games close the kicked link and allow a fresh invite later', () => {
    const dropped: Conn[] = [];
    const lobby = new Lobby(memoryStorage(), false, {
      daily: false,
      rejoinAfterKick: true,
      onKick: (c) => dropped.push(c),
    });
    const {
      conns: [host, guest],
      code,
      room,
    } = party(lobby, ['Hana', 'Gus']);
    host.send({ t: 'kick', id: 'g_gus' });
    expect(dropped).toEqual([guest.conn]);
    guest.send({ t: 'joinRoom', code });
    expect(room.members.has('g_gus')).toBe(true);
    lobby.shutdown();
  });
});
