import { beforeAll, describe, expect, it } from 'vitest';
import { makeHole, slab } from '../src/courses/builder';
import {
  BOSS_STROKE_ALLOWANCE,
  HoleSchema,
  HopperMatch,
  SKELETON,
  Simulation,
  domeGrid,
  domeHeightAt,
  initPhysics,
  stageHole,
  type Hole,
  type Solid,
  type Vec3,
} from '../src/index';

beforeAll(async () => {
  await initPhysics();
});

/** Generated stages (rest stops skipped) over `seeds` runs, every variant 0..2. */
function* stages(seeds: number, variants = 3): Generator<Hole> {
  for (let seed = 1; seed <= seeds; seed++) {
    const m = new HopperMatch({
      seed: seed * 104729,
      players: [{ id: 'p', name: 'P' }],
      upgrades: {},
      keepsakes: [],
    });
    for (let i = 0; i < SKELETON.length; i++)
      for (let v = 0; v < variants; v++) {
        const spec = m.makeSpec(i, null, null, v);
        if (spec.kind !== 'rest') yield stageHole(m.seed, i, spec);
      }
  }
}

function funnelHoles(n: number): { hole: Hole; f: Solid }[] {
  const out: { hole: Hole; f: Solid }[] = [];
  for (const hole of stages(12)) {
    const f = hole.solids.find((s) => s.shape === 'funnel');
    if (f) out.push({ hole, f });
    if (out.length >= n) break;
  }
  return out;
}

describe('v1.9 funnels', () => {
  it('turn up in generated holes', () => {
    expect(funnelHoles(3).length).toBeGreaterThanOrEqual(3);
  });

  it('a ball rolled in spins round the basin, then drops through to the green below', () => {
    const found = funnelHoles(6);
    let runs = 0,
      dropped = 0,
      clear = 0,
      laps = 0;
    for (const { hole, f } of found) {
      const C = f.center;
      const R = f.size[0] / 2;
      // Entry: the path point just before the basin's centre (where its green meets the rim).
      const k = hole.path.findIndex((p) => Math.hypot(p[0] - C[0], p[2] - C[2]) < 0.05 && p[1] < C[1] - 0.3);
      expect(k).toBeGreaterThan(0);
      const entry = hole.path[k - 1];
      const ux = (C[0] - entry[0]) / Math.hypot(C[0] - entry[0], C[2] - entry[2]);
      const uz = (C[2] - entry[2]) / Math.hypot(C[0] - entry[0], C[2] - entry[2]);
      for (const lat of [0, 0.35, -0.6])
        for (const power of [0.32, 0.45]) {
          const start: Vec3 = [
            entry[0] - ux * 1.2 - uz * lat,
            entry[1] + 0.16,
            entry[2] - uz * 1.2 + ux * lat,
          ];
          const sim = new Simulation(hole);
          sim.addBall('p', start);
          sim.placeBall('p', start);
          // Aim a little off the middle so the ball curls round.
          const a = Math.atan2(uz, ux) + 0.12;
          sim.shoot('p', Math.cos(a), Math.sin(a), power);
          let ang = 0,
            last: number | null = null;
          for (let t = 0; t < 60 * 15 && sim.anyMoving(); t++) {
            sim.step();
            const p = sim.getBall('p')!.pos;
            if (Math.hypot(p[0] - C[0], p[2] - C[2]) < R && p[1] < C[1] + 0.2) {
              const th = Math.atan2(p[2] - C[2], p[0] - C[0]);
              if (last !== null) ang += Math.abs(Math.atan2(Math.sin(th - last), Math.cos(th - last)));
              last = th;
            }
          }
          const p = sim.getBall('p')!.pos;
          sim.dispose();
          runs++;
          laps += ang / (Math.PI * 2);
          // Below the basin's hole and on the course (not fallen off).
          if (p[1] < C[1] - f.size[1] - 0.5 && p[1] > C[1] - f.size[1] - 3) dropped++;
          // ...and rolls on out from under the basin (where the camera can see it).
          if (Math.hypot(p[0] - C[0], p[2] - C[2]) > R) clear++;
        }
    }
    console.log(
      `funnel: ${dropped}/${runs} dropped through, ${clear} rolled out, ${(laps / runs).toFixed(2)} laps`,
    );
    expect(dropped).toBe(runs);
    expect(clear).toBe(runs);
    expect(laps / runs).toBeGreaterThan(0.5);
  });
});

/** Arc length along a hole's path to the path point nearest `p`, as a share of the whole path. */
function pathShare(hole: Hole, p: Vec3): number {
  const cum = [0];
  for (let k = 1; k < hole.path.length; k++)
    cum.push(
      cum[k - 1] + Math.hypot(hole.path[k][0] - hole.path[k - 1][0], hole.path[k][2] - hole.path[k - 1][2]),
    );
  let best = 0;
  for (let k = 1; k < hole.path.length; k++)
    if (
      Math.hypot(hole.path[k][0] - p[0], hole.path[k][2] - p[2]) <
      Math.hypot(hole.path[best][0] - p[0], hole.path[best][2] - p[2])
    )
      best = k;
  return cum[best] / cum[cum.length - 1];
}

describe('v1.9 wormholes', () => {
  it('an easy pad only skips ahead; a pad that warps to the green is tiny and needs a slow ball', () => {
    let easy = 0,
      jackpot = 0;
    for (const hole of stages(10, 2)) {
      for (const o of hole.obstacles) {
        if (o.type !== 'teleporter' || o.id !== 'wormhole') continue;
        const share = pathShare(hole, o.b);
        if (o.maxSpeed !== undefined) {
          jackpot++;
          expect(o.radius).toBeLessThanOrEqual(0.22);
          expect(share).toBeGreaterThan(0.7);
        } else {
          easy++;
          expect(o.radius).toBeGreaterThan(0.3);
          expect(share, hole.name).toBeLessThan(0.8);
          expect(share - pathShare(hole, o.a)).toBeGreaterThan(0);
        }
      }
    }
    expect(easy).toBeGreaterThan(0);
    expect(jackpot).toBeGreaterThan(0);
  });

  it('a fast ball rolls over a jackpot pad; a creeping one warps', () => {
    const hole = HoleSchema.parse(
      makeHole({
        id: 'pad',
        name: 'Pad',
        par: 2,
        fairway: false,
        points: [
          [-6, 0, 0],
          [6, 0, 0],
        ],
        solids: [slab(-7, -1, 7, 1, 0), slab(-7, 5, 7, 7, 0)],
        obstacles: [
          {
            type: 'teleporter',
            id: 'w',
            a: [0, 0, 0],
            b: [0, 0, 6],
            exitDir: 0,
            radius: 0.2,
            maxSpeed: 1.6,
            phase: 0,
          },
        ],
      }),
    );
    const roll = (power: number, from: number) => {
      const sim = new Simulation(hole);
      sim.addBall('p', [from, 0.17, 0]);
      sim.placeBall('p', [from, 0.17, 0]);
      sim.shoot('p', 1, 0, power);
      let warped = false;
      for (let t = 0; t < 600 && sim.anyMoving(); t++) {
        sim.step();
        if (sim.getBall('p')!.pos[2] > 3) warped = true;
      }
      sim.dispose();
      return warped;
    };
    expect(roll(0.55, -4)).toBe(false);
    expect(roll(0.2, -0.8)).toBe(true);
  });
});

describe('v1.9 bumps', () => {
  it('rise out of the green with no crease and a rounded top', () => {
    const size: Vec3 = [1.24, 0.12, 1.24];
    // Tangent to the green at the rim, flat on top.
    const slopeAt = (r: number) => (domeHeightAt(size, r + 0.005) - domeHeightAt(size, r - 0.005)) / 0.01;
    expect(Math.abs(slopeAt(0.615))).toBeLessThan(0.02);
    expect(Math.abs(slopeAt(0.005))).toBeLessThan(0.02);
    expect(domeHeightAt(size, 0)).toBeCloseTo(0.12, 6);
    expect(Math.max(...domeGrid([0, 0, 0], size).map((p) => Math.hypot(p[0], p[2])))).toBeCloseTo(0.62, 6);
  });
});

describe('v1.9 Planet Hopper rules', () => {
  const solo = [{ id: 'a', name: 'A' }];
  const duo = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ];
  type Priv = {
    addTrinket(t: string): void;
    trinketOptions(): { trinket?: string; level?: number }[];
    rerollsUsed: number;
    finishEntrant(e: string, pickedUp: boolean): void;
    checkHoleEnd(): void;
    strokes: Record<string, number>;
  };

  it('offers at most one level-up per trinket draft while new trinkets are left', () => {
    const m = new HopperMatch({ seed: 11, players: solo, upgrades: { wide: 1 }, keepsakes: [] });
    const p = m as unknown as Priv;
    for (const t of ['magnet', 'glove', 'moth', 'feeder', 'pouch']) p.addTrinket(t);
    let ups = 0;
    for (let k = 0; k < 300; k++) {
      p.rerollsUsed = k;
      const n = p.trinketOptions().filter((o) => (o.level ?? 1) > 1).length;
      expect(n).toBeLessThanOrEqual(1);
      ups += n;
    }
    // Level-ups are uncommon: in well under half the four-card drafts with five trinkets owned.
    expect(ups / 300).toBeLessThan(0.45);
  });

  /** Make the match's current hole stage `index` of the run. */
  const at = (m: HopperMatch, index: number) => {
    const spec = m.makeSpec(index, null, null, 0);
    m.hs.stages[0] = spec;
    m.cfg.holes[0] = stageHole(m.seed, index, spec);
    m.startHole(0);
  };

  it('a boss nobody holes ends the run; in co-op one player holing it is enough', () => {
    const bossIdx = SKELETON.findIndex((s) => s.kind === 'boss');
    const lone = new HopperMatch({ seed: 21, players: solo, upgrades: {}, keepsakes: [] });
    at(lone, bossIdx);
    expect(lone.strokeLimit()).toBe(lone.hole.par + BOSS_STROKE_ALLOWANCE);
    lone.hs.hearts = 99;
    (lone as unknown as Priv).finishEntrant('a', true);
    (lone as unknown as Priv).checkHoleEnd();
    lone.advance();
    expect(lone.hs.result).toBe('lost');

    const pair = new HopperMatch({ seed: 21, players: duo, upgrades: {}, keepsakes: [] });
    at(pair, bossIdx);
    pair.hs.hearts = 99;
    const p = pair as unknown as Priv;
    p.strokes.a = pair.hole.par - 1;
    p.finishEntrant('a', false);
    p.finishEntrant('b', true);
    p.checkHoleEnd();
    pair.advance();
    expect(pair.hs.result).toBe('running');
  });

  it('small teams heal at most one heart for an under-par hole, and pay more late in the run', () => {
    const m = new HopperMatch({ seed: 4, players: solo, upgrades: {}, keepsakes: [] });
    // The first hole long enough for an eagle that isn't a hole-in-one.
    at(
      m,
      SKELETON.findIndex(
        (s, i) => s.kind === 'hole' && stageHole(m.seed, i, m.makeSpec(i, null, null, 0)).par >= 4,
      ),
    );
    m.hs.hearts = 1;
    const p = m as unknown as Priv;
    expect(m.hole.par).toBeGreaterThanOrEqual(4);
    p.strokes.a = 2; // an eagle or better (not a hole-in-one)
    p.finishEntrant('a', false);
    p.checkHoleEnd();
    expect(m.hs.lastDelta?.net).toBe(1);

    const late = new HopperMatch({ seed: 4, players: solo, upgrades: {}, keepsakes: [] });
    at(
      late,
      SKELETON.findIndex((s) => s.kind === 'hole' && s.sector === 2),
    );
    late.hs.hearts = 10;
    late.hs.maxHearts = 10;
    const q = late as unknown as Priv;
    q.strokes.a = late.hole.par + 1; // a bogey
    q.finishEntrant('a', false);
    q.checkHoleEnd();
    expect(late.hs.lastDelta?.net).toBe(-2);
  });

  it('can be played in Chaos mode (balls collide)', () => {
    const m = new HopperMatch({ seed: 2, players: duo, upgrades: {}, keepsakes: [], chaos: true });
    expect(m.cfg.chaos).toBe(true);
    const off = new HopperMatch({ seed: 2, players: duo, upgrades: {}, keepsakes: [] });
    expect(!!off.cfg.chaos).toBe(false);
  });
});
