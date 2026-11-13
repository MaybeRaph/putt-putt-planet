import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { FLOOR_T, makeHole, dome, slab } from '../src/courses/builder';
import {
  HoleSchema,
  HopperMatch,
  PHYSICS,
  SKELETON,
  Simulation,
  domeCapPoints,
  domeSphere,
  initPhysics,
  stageHole,
  MAJORITY_SECONDS,
  parseS2C,
  type Hole,
  type Vec3,
} from '../src/index';

beforeAll(async () => {
  await initPhysics();
});

/** Generated stages over a few seeds (every variant), rest stops skipped. */
function* stages(seeds: number): Generator<Hole> {
  for (let seed = 1; seed <= seeds; seed++) {
    const m = new HopperMatch({ seed, players: [{ id: 'p', name: 'P' }], upgrades: {}, keepsakes: [] });
    for (let i = 0; i < SKELETON.length; i++) {
      const spec = m.makeSpec(i, null, null, seed % 3);
      if (spec.kind !== 'rest') yield stageHole(seed, i, spec);
    }
  }
}

describe('v1.7.1 ledges are solid where they are drawn', () => {
  it('a ball putted back at a drop ledge bounces off its face instead of rolling in under the upper green', () => {
    let drops = 0;
    const under: string[] = [];
    for (const h of stages(12)) {
      for (let k = 0; k < h.path.length - 1; k++) {
        const a = h.path[k],
          b = h.path[k + 1];
        const dxz = Math.hypot(b[0] - a[0], b[2] - a[2]);
        if (!(b[1] - a[1] < -0.3 && dxz < 1.2)) continue; // a drop: 0.9 m along, 0.7-1.1 m down
        drops++;
        const ux = (b[0] - a[0]) / dxz,
          uz = (b[2] - a[2]) / dxz;
        for (const power of [0.25, 0.45]) {
          const sim = new Simulation(h);
          sim.addBall('p', [b[0] + ux * 1.2, b[1] + PHYSICS.ballRadius + 0.01, b[2] + uz * 1.2]);
          sim.shoot('p', -ux, -uz, power);
          let deepest = Infinity;
          for (let t = 0; t < 420; t++) {
            sim.step();
            const p = sim.getBall('p')!.pos;
            deepest = Math.min(deepest, (p[0] - a[0]) * ux + (p[2] - a[2]) * uz);
          }
          sim.dispose();
          // 0 = the ledge's edge. Before v1.7.1 a firm putt rolled ~1.3 m in under the slab.
          if (deepest < -0.05) under.push(`${h.id} power ${power}: ${(-deepest).toFixed(2)} m`);
        }
      }
    }
    expect(drops).toBeGreaterThan(10);
    expect(under).toEqual([]);
  });

  it('the face under every leap ledge is solid from the slab down to the run-in level', () => {
    let leaps = 0;
    const open: string[] = [];
    for (const h of stages(12)) {
      const sim = new Simulation(h);
      sim.step(); // builds the query pipeline
      const world = (sim as unknown as { world: RAPIER.World }).world;
      const cast = (o: Vec3, d: Vec3, len: number) =>
        world.castRay(
          new RAPIER.Ray({ x: o[0], y: o[1], z: o[2] }, { x: d[0], y: d[1], z: d[2] }),
          len,
          true,
        );
      for (let k = 0; k < h.path.length - 1; k++) {
        const a = h.path[k],
          b = h.path[k + 1];
        const dxz = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const rise = b[1] - a[1];
        if (rise < 0.25 || dxz < 1) continue;
        const mid: Vec3 = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) + 0.3, (a[2] + b[2]) / 2];
        if (cast(mid, [0, -1, 0], 1.5)) continue; // a ramp, not a gap over water
        leaps++;
        const ux = (b[0] - a[0]) / dxz,
          uz = (b[2] - a[2]) / dxz;
        // Probe the face from 0.25 m out, between the run-in level and the ledge slab's underside.
        for (let y = a[1] + 0.03; y < b[1] - FLOOR_T - 0.03; y += 0.05) {
          const hit = cast([b[0] - ux * 0.25, y, b[2] - uz * 0.25], [ux, 0, uz], 0.6);
          if (!hit || hit.timeOfImpact > 0.27) open.push(`${h.id} at ${(y - a[1]).toFixed(2)} m`);
        }
      }
      sim.dispose();
    }
    expect(leaps).toBeGreaterThan(3);
    expect(open).toEqual([]);
  });
});

describe('v1.7.1 bumps collide exactly where they are drawn', () => {
  it('the hull is the visible cap: same height at the top, nothing past the rim or below the green', () => {
    const d = dome(0, 0, 0, 1.24, 0.12);
    const pts = domeCapPoints(d.center, d.size);
    const { r } = domeSphere(d.center, d.size);
    expect(r).toBeGreaterThan(1.5); // the sphere the cap is cut from is far bigger than the cap
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(0.12, 6);
    expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(0, 6);
    expect(Math.max(...pts.map((p) => Math.hypot(p[0], p[2])))).toBeCloseTo(0.62, 6);
  });

  it('a ball dropping past the end of a green beside a bump falls straight down', () => {
    // A green that ends at x = 0.3, with a bump whose rim touches that edge. Before v1.7.1 the
    // bump's collider was its whole sphere (r 1.66 m, centre 1.54 m below the green), which
    // stuck out of the green's end face and caught a ball falling past it.
    const hole = HoleSchema.parse(
      makeHole({
        id: 'bump-edge',
        name: 'Bump edge',
        par: 2,
        fairway: false,
        points: [
          [-4, 0, 0],
          [0, 0, 0],
        ],
        solids: [slab(-4, -1, 0.3, 1, 0), dome(-0.32, 0, 0, 1.24, 0.12)],
      }),
    );
    const sim = new Simulation(hole);
    const start: Vec3 = [0.6, -0.3, 0];
    sim.addBall('p', start);
    sim.placeBall('p', start);
    let maxDx = 0;
    for (let t = 0; t < 30; t++) {
      sim.step();
      const p = sim.getBall('p')!.pos;
      maxDx = Math.max(maxDx, Math.abs(p[0] - start[0]), Math.abs(p[2] - start[2]));
    }
    sim.dispose();
    expect(maxDx).toBeLessThan(0.01);
  });

  it('a putt over a bump still rolls over it and carries on', () => {
    const hole = HoleSchema.parse(
      makeHole({
        id: 'bump-roll',
        name: 'Bump roll',
        par: 2,
        points: [
          [0, 0, 0],
          [8, 0, 0],
        ],
        solids: [dome(3, 0, 0, 1.1, 0.12)],
      }),
    );
    const sim = new Simulation(hole);
    sim.addBall('p', [0, PHYSICS.ballRadius + 0.01, 0]);
    sim.shoot('p', 1, 0, 0.45);
    let peak = 0;
    for (let t = 0; t < 360; t++) {
      sim.step();
      const p = sim.getBall('p')!.pos;
      if (Math.abs(p[0] - 3) < 0.1) peak = Math.max(peak, p[1]);
    }
    const end = sim.getBall('p')!.pos;
    sim.dispose();
    expect(peak).toBeGreaterThan(0.12); // went over the top
    expect(end[0]).toBeGreaterThan(4);
    expect(Math.abs(end[2])).toBeLessThan(0.2); // a centred line isn't deflected sideways
  });
});

// ---------------------------------------------------------------------------------------------
// Planet Hopper: a strict majority of connected players cuts the vote countdown to 5 s
// ---------------------------------------------------------------------------------------------

const team = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

/** A co-op run of `n` players with the first fork vote open (2 route options). */
function openVote(n: number, upgrades: Record<string, number> = {}): HopperMatch {
  const m = new HopperMatch({ seed: 9, players: team(n), upgrades, keepsakes: [] });
  m.startHole(0);
  for (const e of m.entrants) {
    const c = m.hole.cup;
    m.sim.placeBall(e, [c[0] - 0.5, c[1] + 0.2, c[2]]);
    m.shoot(e, 1, 0, 0.1);
  }
  for (let t = 0; t < 900 && m.phase === 'playing'; t++) m.step();
  expect(m.phase).toBe('holeEnd');
  m.advance();
  expect(m.hs.choice?.kind).toBe('route');
  expect(m.hs.choice?.options.length).toBe(2);
  return m;
}
const tick = (m: HopperMatch, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) m.step();
};

describe('v1.7.1 majority vote', () => {
  it('two players: one vote never shortens the countdown', () => {
    const m = openVote(2);
    m.vote('p0', 0);
    expect(m.hs.choice!.majority).toBeUndefined();
    expect(m.choiceSecondsLeft).toBeGreaterThan(24);
    expect(m.hs.choice!.secondsLeft).toBe(25);
    m.dispose();
  });

  it('three players: two matching votes cut it to 5 s, then the majority option wins', () => {
    const m = openVote(3);
    m.vote('p0', 1);
    expect(m.choiceSecondsLeft).toBeGreaterThan(24);
    m.vote('p1', 1);
    expect(m.hs.choice!.majority).toBe(1);
    expect(m.hs.choice!.secondsLeft).toBe(MAJORITY_SECONDS);
    expect(m.choiceSecondsLeft).toBeCloseTo(MAJORITY_SECONDS, 6);
    tick(m, MAJORITY_SECONDS - 0.1);
    expect(m.hs.choice).not.toBeNull(); // still open: P2 can still have a say
    tick(m, 0.2);
    expect(m.hs.choice).toBeNull();
    expect(m.hs.stage).toBe(1);
    expect(m.hs.stages[1].variant).toBe(1);
    m.dispose();
  });

  it('four players split 2-2: no majority, the full countdown runs', () => {
    const m = openVote(4);
    m.vote('p0', 0);
    m.vote('p1', 0);
    m.vote('p2', 1);
    m.vote('p3', 1); // everyone has voted: decided at once (tie -> first voted option)
    expect(m.hs.choice).toBeNull();
    expect(m.hs.stages[1].variant).toBe(0);
    const n = openVote(4);
    n.vote('p0', 0);
    n.vote('p1', 0);
    n.vote('p2', 1);
    expect(n.hs.choice!.majority).toBeUndefined();
    expect(n.choiceSecondsLeft).toBeGreaterThan(24);
    m.dispose();
    n.dispose();
  });

  it('a changed vote: the cut deadline is never raised or restarted', () => {
    const m = openVote(4);
    m.vote('p0', 0);
    m.vote('p1', 0);
    m.vote('p2', 0); // 3 of 4
    expect(m.hs.choice!.majority).toBe(0);
    expect(m.choiceSecondsLeft).toBeCloseTo(5, 6);
    tick(m, 2);
    const left = m.choiceSecondsLeft;
    expect(left).toBeCloseTo(3, 1);
    m.vote('p1', 1); // 2 of 4: the majority breaks up...
    expect(m.hs.choice!.majority).toBeUndefined();
    expect(m.choiceSecondsLeft).toBeCloseTo(left, 6); // ...but the clock keeps running
    m.vote('p1', 0); // and back: no fresh 5 s either
    expect(m.hs.choice!.majority).toBe(0);
    expect(m.choiceSecondsLeft).toBeCloseTo(left, 6);
    tick(m, left + 0.05);
    expect(m.hs.choice).toBeNull();
    expect(m.hs.stages[1].variant).toBe(0);
    m.dispose();
  });

  it('a disconnect: only connected players count', () => {
    // 2 of 4 is no majority; once the player voting the other way drops, 2 of 3 is (P3 still
    // hasn't voted, so it isn't decided outright).
    const m = openVote(4);
    m.vote('p0', 1);
    m.vote('p1', 1);
    m.vote('p2', 0);
    expect(m.hs.choice!.majority).toBeUndefined();
    m.setConnected('p2', false);
    expect(m.hs.choice!.majority).toBe(1);
    expect(m.choiceSecondsLeft).toBeCloseTo(5, 6);
    m.dispose();

    // A dropped player's vote no longer counts towards a majority.
    const n = openVote(4);
    n.vote('p0', 1);
    n.vote('p1', 1);
    n.vote('p2', 1);
    tick(n, 1);
    n.setConnected('p0', false); // 2 of the 3 still here: still a majority, deadline unchanged
    expect(n.hs.choice!.majority).toBe(1);
    expect(n.choiceSecondsLeft).toBeCloseTo(4, 1);
    n.dispose();

    // Down to two connected players: no new cut (the rule needs three or more).
    const o = openVote(3);
    o.vote('p0', 0);
    o.setConnected('p2', false);
    expect(o.hs.choice!.majority).toBeUndefined();
    expect(o.choiceSecondsLeft).toBeGreaterThan(24);
    // Everyone still here has voted: decided at once.
    o.vote('p1', 1);
    expect(o.hs.choice).toBeNull();
    o.dispose();
  });

  it('a reroll deals fresh options with fresh votes and a fresh countdown', () => {
    const m = openVote(3, { dice: 1 });
    expect(m.hs.rerolls).toBe(1);
    m.vote('p0', 0);
    m.vote('p1', 0);
    expect(m.choiceSecondsLeft).toBeCloseTo(5, 6);
    expect(m.reroll('p2')).toBe(true);
    const c = m.hs.choice!;
    expect(c.votes).toEqual({});
    expect(c.majority).toBeUndefined();
    expect(c.secondsLeft).toBe(25);
    m.vote('p1', 1);
    m.vote('p2', 1);
    expect(m.hs.choice!.majority).toBe(1);
    expect(m.choiceSecondsLeft).toBeCloseTo(5, 6);
    m.dispose();
  });

  it('the majority rides on the score as an optional field (older peers parse without it)', () => {
    const m = openVote(3);
    m.vote('p0', 1);
    m.vote('p1', 1);
    const wire = JSON.parse(JSON.stringify({ t: 'score', score: m.score() }));
    const msg = parseS2C(wire);
    expect(msg?.t === 'score' && msg.score.hopper?.choice?.majority).toBe(1);
    delete wire.score.hopper.choice.majority;
    const old = parseS2C(wire);
    expect(old?.t === 'score' && old.score.hopper?.choice?.majority).toBeUndefined();
    expect(old?.t === 'score' && old.score.hopper?.choice?.secondsLeft).toBe(5);
    m.dispose();
  });
});
