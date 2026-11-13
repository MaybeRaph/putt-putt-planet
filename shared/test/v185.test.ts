import { beforeAll, describe, expect, it } from 'vitest';
import { lastHoleSpecials } from '../src/hopper/generate';
import { makeHole, zone } from '../src/courses/builder';
import {
  HoleSchema,
  HopperMatch,
  PHYSICS,
  SKELETON,
  Simulation,
  inYawBox,
  initPhysics,
  quatFromEuler,
  rotateVec,
  solidRibbon,
  solveHole,
  stageHole,
  type Hole,
  type Solid,
  type Vec3,
} from '../src/index';

beforeAll(async () => {
  await initPhysics();
});

/** Every generated (non-rest) hole for a few seeds. */
function runHoles(seeds: number[]): { hole: Hole; specials: string[]; seed: number; i: number }[] {
  const out: { hole: Hole; specials: string[]; seed: number; i: number }[] = [];
  for (const seed of seeds) {
    const m = new HopperMatch({ seed, players: [{ id: 'p', name: 'P' }], upgrades: {}, keepsakes: [] });
    for (let i = 0; i < SKELETON.length; i++) {
      const spec = m.makeSpec(i, null, null, seed % 3);
      if (spec.kind === 'rest') continue;
      const hole = stageHole(seed, i, spec);
      out.push({ hole, specials: [...lastHoleSpecials], seed, i });
    }
  }
  return out;
}

/** Points on the top surface of a floor. */
function floorSamples(s: Solid): Vec3[] {
  if (s.shape === 'ribbon') {
    const { left, right } = solidRibbon(s);
    const out: Vec3[] = [];
    for (let i = 0; i < left.length; i++)
      for (const f of [0.1, 0.5, 0.9])
        out.push([
          left[i][0] + (right[i][0] - left[i][0]) * f,
          left[i][1] + (right[i][1] - left[i][1]) * f,
          left[i][2] + (right[i][2] - left[i][2]) * f,
        ]);
    return out;
  }
  if (s.shape !== 'box') return [];
  const q = quatFromEuler(s.rot[0], s.rot[1], s.rot[2]);
  const out: Vec3[] = [];
  for (const u of [-0.45, -0.2, 0, 0.2, 0.45])
    for (const v of [-0.4, 0, 0.4]) {
      const c = rotateVec(q, [u * s.size[0], s.size[1] / 2, v * s.size[2]]);
      out.push([s.center[0] + c[0], s.center[1] + c[1], s.center[2] + c[2]]);
    }
  return out;
}

describe('v1.8.5 water and course design', () => {
  const holes = runHoles([1, 2, 3, 4]);

  it('puts water on nearly every hole, and much more of it', () => {
    let wet = 0;
    let area = 0;
    for (const { hole } of holes) {
      const w = hole.zones.filter((z) => z.kind === 'water');
      if (w.length) wet++;
      area += w.reduce((a, z) => a + z.size[0] * z.size[2], 0);
    }
    expect(wet / holes.length).toBeGreaterThan(0.85);
    // v1.8.2 averaged ~20 m² of water per hole.
    expect(area / holes.length).toBeGreaterThan(35);
  });

  it('no water zone swallows a ball resting on any green', () => {
    for (const { hole, specials } of holes) {
      const water = hole.zones.filter((z) => z.kind === 'water');
      for (const s of hole.solids) {
        if (s.role !== 'floor') continue;
        for (const p of floorSamples(s)) {
          const ball: Vec3 = [p[0], p[1] + PHYSICS.ballRadius, p[2]];
          for (const z of water)
            expect(
              inYawBox(ball, z.center, z.size, z.rotY),
              `${hole.name} (${specials.join(',')}) at ${ball.map((v) => v.toFixed(1))}`,
            ).toBe(false);
        }
      }
    }
  });

  it('builds island greens: the cup on an island ringed by water, reached over a bridge', () => {
    const islands = holes.filter((h) => h.specials.includes('island'));
    expect(islands.length).toBeGreaterThan(3);
    for (const { hole } of islands.slice(0, 3)) {
      const cup = hole.cup;
      // Water on both sides of the cup, beyond the island's rails.
      const water = hole.zones.filter((z) => z.kind === 'water');
      const ringed = [0, Math.PI / 2, Math.PI, -Math.PI / 2].filter((a) =>
        water.some((z) => {
          for (let d = 1; d < 6; d += 0.25) {
            const p: Vec3 = [cup[0] + Math.cos(a) * d, cup[1] - 0.5, cup[2] + Math.sin(a) * d];
            if (inYawBox(p, z.center, z.size, z.rotY)) return true;
          }
          return false;
        }),
      );
      expect(ringed.length, hole.name).toBeGreaterThanOrEqual(3);
    }
  });

  it('island green holes can be holed (the solver gets across the bridge)', () => {
    const isl = holes.find((h) => h.specials.includes('island') && h.hole.par <= 4)!;
    const r = solveHole(isl.hole, { maxStrokes: isl.hole.par + 4 });
    expect(r.holed, isl.hole.name).toBe(true);
  }, 120_000);

  it('a sloping green makes a putt break towards its low side', () => {
    let tested = 0;
    for (const { hole } of holes) {
      const tilt = hole.solids.find(
        (s) =>
          s.shape === 'ribbon' && s.left && s.left.some((p, j) => Math.abs(p[1] - s.right![j][1]) > 0.12),
      );
      if (!tilt || tested >= 3) continue;
      const { left, right } = solidRibbon(tilt);
      const k = Math.floor(left.length * 0.35);
      const mid: Vec3 = [
        (left[k][0] + right[k][0]) / 2,
        (left[k][1] + right[k][1]) / 2,
        (left[k][2] + right[k][2]) / 2,
      ];
      const end = Math.min(left.length - 1, k + 6);
      const ahead: Vec3 = [(left[end][0] + right[end][0]) / 2, 0, (left[end][2] + right[end][2]) / 2];
      const lowSide: Vec3 = left[k][1] < right[k][1] ? left[k] : right[k];
      const sim = new Simulation(hole);
      sim.addBall('b', [mid[0], mid[1] + PHYSICS.ballRadius + 0.01, mid[2]]);
      sim.shoot('b', ahead[0] - mid[0], ahead[2] - mid[2], 0.32);
      for (let t = 0; t < 70; t++) sim.step();
      const p = sim.getBall('b')!.pos;
      // Sideways drift measured towards the low edge.
      const sx = lowSide[0] - mid[0],
        sz = lowSide[2] - mid[2];
      const l = Math.hypot(sx, sz);
      const drift = ((p[0] - mid[0]) * sx + (p[2] - mid[2]) * sz) / l;
      expect(drift, hole.name).toBeGreaterThan(0.08);
      sim.dispose();
      tested++;
    }
    expect(tested).toBeGreaterThan(0);
  });

  it('eased ramps carry a rolling ball over the crest without a hop', () => {
    let tested = 0;
    for (const { hole } of holes) {
      for (const s of hole.solids) {
        if (s.shape !== 'ribbon' || !s.path || tested >= 12) continue;
        const p = s.path;
        const a = p[0],
          b = p[p.length - 1];
        const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const rise = b[1] - a[1];
        // Straight ramps only (slides swing sideways, curves turn).
        const straight = p.every((q) => {
          const t = ((q[0] - a[0]) * (b[0] - a[0]) + (q[2] - a[2]) * (b[2] - a[2])) / (len * len);
          return Math.hypot(a[0] + (b[0] - a[0]) * t - q[0], a[2] + (b[2] - a[2]) * t - q[2]) < 0.02;
        });
        if (!straight || Math.abs(rise) < 0.4 || len < 2) continue;
        if (s.left && s.left.some((q, j) => Math.abs(q[1] - s.right![j][1]) > 0.02)) continue;
        const ux = (b[0] - a[0]) / len,
          uz = (b[2] - a[2]) / len;
        const start: Vec3 = [a[0] - ux * 0.8, a[1] + PHYSICS.ballRadius + 0.01, a[2] - uz * 0.8];
        const sim = new Simulation(hole);
        sim.addBall('b', start);
        // Uphill: firm enough to make the top; downhill: a gentle roll.
        sim.shoot('b', ux, uz, rise > 0 ? 0.62 : 0.4);
        let air = 0,
          worst = 0;
        for (let t = 0; t < 150; t++) {
          sim.step();
          const st = sim.getBall('b')!;
          const along = (st.pos[0] - a[0]) * ux + (st.pos[2] - a[2]) * uz;
          if (along < -0.2 || along > len + 0.6 || st.phase !== 'moving') {
            air = 0;
            if (along > len + 0.6 || st.phase !== 'moving') break;
            continue;
          }
          air = st.grounded ? 0 : air + 1;
          worst = Math.max(worst, air);
        }
        sim.dispose();
        expect(worst, `${hole.name} ramp rise ${rise.toFixed(2)}`).toBeLessThanOrEqual(3);
        tested++;
      }
    }
    expect(tested).toBeGreaterThan(5);
  });

  it('a ball that flies off the course into a pond splashes (not out of bounds)', () => {
    const hole = HoleSchema.parse(
      makeHole({
        id: 'pond',
        name: 'Pond',
        par: 2,
        points: [
          [0, 0, 0],
          [4, 0, 0],
        ],
        // A pond well past the course's bounds.
        zones: [zone('water', 0, 6, 3, 3, 0)],
      }),
    );
    const sim = new Simulation(hole);
    sim.addBall('b', [0, 0.17, 0]);
    // Inside the pond (hazards apply to resting balls too, e.g. one carried in by a platform).
    sim.placeBall('b', [0, -0.5, 6]);
    const events: string[] = [];
    for (let t = 0; t < 120; t++) {
      sim.step();
      events.push(...sim.events.splice(0).map((e) => e.type));
      if (events.includes('water') || events.includes('oob')) break;
    }
    expect(events).toContain('water');
    expect(events).not.toContain('oob');
    sim.dispose();
  });
});
