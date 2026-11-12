import { beforeAll, describe, expect, it } from 'vitest';
import { lastHoleSpecials } from '../src/hopper/generate';
import { makeHole, zone } from '../src/courses/builder';
import {
  GIMME_RANGE,
  HoleSchema,
  HopperMatch,
  PHYSICS,
  SKELETON,
  Simulation,
  initPhysics,
  quatFromEuler,
  rotateVec,
  solidRibbon,
  stageHole,
  type Solid,
  type Vec3,
} from '../src/index';

beforeAll(async () => {
  await initPhysics();
});

/** Height of a floor's top surface at (x, z), or null if the point isn't over it. */
function topAt(s: Solid, x: number, z: number): number | null {
  if (s.shape === 'ribbon') {
    const { left, right } = solidRibbon(s);
    for (let i = 0; i < left.length - 1; i++)
      for (const [a, b, c] of [
        [left[i], right[i], right[i + 1]],
        [left[i], right[i + 1], left[i + 1]],
      ]) {
        const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        if (Math.abs(d) < 1e-9) continue;
        const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
        const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
        const w = 1 - u - v;
        if (u > 0.001 && v > 0.001 && w > 0.001) return u * a[1] + v * b[1] + w * c[1];
      }
    return null;
  }
  // Flat boxes only (sloped ramps never butt against a smooth floor).
  if (s.shape !== 'box' || Math.abs(s.rot[0]) > 0.01 || Math.abs(s.rot[2]) > 0.01) return null;
  const q = quatFromEuler(0, -s.rot[1], 0);
  const local = rotateVec(q, [x - s.center[0], 0, z - s.center[2]]);
  if (Math.abs(local[0]) > s.size[0] / 2 - 0.01 || Math.abs(local[2]) > s.size[2] / 2 - 0.01) return null;
  return s.center[1] + s.size[1] / 2;
}

describe('v1.6 polish', () => {
  it('Gimme Clover drops a ball that stops near the cup in for free', () => {
    const near = (clover: boolean) => {
      const m = new HopperMatch({ seed: 21, players: [{ id: 'p', name: 'P' }], upgrades: {}, keepsakes: [] });
      if (clover) {
        m.hs.trinkets.push('clover');
        m.hs.levels.clover = 1;
      }
      m.startHole(0);
      const cup = m.hole.cup;
      const prev = m.hole.path[m.hole.path.length - 2];
      const l = Math.hypot(prev[0] - cup[0], prev[2] - cup[2]);
      const k = (GIMME_RANGE[1] - 0.2) / l;
      const at: Vec3 = [cup[0] + (prev[0] - cup[0]) * k, cup[1] + PHYSICS.ballRadius + 0.01, cup[2] + (prev[2] - cup[2]) * k];
      m.sim.placeBall('p', at);
      // A feather-light tap sideways: it stops well outside the cup's pull, inside the gimme.
      m.shoot('p', -(prev[2] - cup[2]), prev[0] - cup[0], 0.04);
      for (let i = 0; i < 600 && !m.done.p; i++) m.step();
      return m;
    };
    const lucky = near(true);
    expect(lucky.done.p).toBe(true);
    expect(lucky.card.p[0]).toBe(1);
    const plain = near(false);
    expect(plain.done.p).toBe(false);
  });

  it('a spring pad launches a ball that hops onto it', () => {
    const hole = HoleSchema.parse(
      makeHole({
        id: 'spring',
        name: 'Spring',
        par: 2,
        points: [
          [0, 0, 0],
          [12, 0, 0],
        ],
        zones: [zone('spring', 4, 0, 1, 1.8, 0, { strength: 5.6 })],
      }),
    );
    const sim = new Simulation(hole);
    // Airborne as it reaches the pad (as if it bounced off a bump or a ledge).
    sim.addBall('b', [3.3, PHYSICS.ballRadius + 0.4, 0]);
    sim.shoot('b', 1, 0, 0.3);
    let peak = 0;
    for (let i = 0; i < 240; i++) {
      sim.step();
      peak = Math.max(peak, sim.getBall('b')!.pos[1]);
    }
    expect(peak).toBeGreaterThan(0.9);
    sim.dispose();
  });

  it('Slick Greens freezes the green, and the Storm Compass only thaws it to frost', () => {
    const m = new HopperMatch({ seed: 4, players: [{ id: 'p', name: 'P' }], upgrades: {}, keepsakes: [] });
    const floors = (shaping: string[]) =>
      stageHole(4, 6, { ...m.makeSpec(6, 'slick', null, 0), shaping: shaping as never[] }).solids.filter(
        (s) => s.role === 'floor' && !s.color,
      );
    expect(floors([]).every((s) => s.surface === 'slick')).toBe(true);
    expect(floors(['compass']).every((s) => s.surface === 'frost')).toBe(true);
    expect(floors(['compass', 'compass', 'compass']).some((s) => s.surface === 'slick' || s.surface === 'frost' || s.surface === 'rime')).toBe(
      false,
    );
  });

  it('smooth floors (curves, slides, fork swoops) never overlap another floor', () => {
    let checked = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const m = new HopperMatch({ seed, players: [{ id: 'p', name: 'P' }], upgrades: {}, keepsakes: [] });
      for (let i = 0; i < SKELETON.length; i++) {
        const spec = m.makeSpec(i, null, null, seed % 3);
        if (spec.kind === 'rest') continue;
        const h = stageHole(seed, i, spec);
        const floors = h.solids.filter((s) => s.role === 'floor');
        const ribbons = floors.filter((s) => s.shape === 'ribbon');
        if (!ribbons.length) continue;
        let samples = 0,
          overlaps = 0;
        for (const rb of ribbons) {
          const { left, right } = solidRibbon(rb);
          for (let k = 0; k < left.length - 1; k++)
            for (const [fu, fv] of [
              [0.5, 0.5],
              [0.15, 0.2],
              [0.85, 0.8],
            ]) {
              const p = (e: Vec3[], f: number): Vec3 => [
                e[k][0] + (e[k + 1][0] - e[k][0]) * f,
                0,
                e[k][2] + (e[k + 1][2] - e[k][2]) * f,
              ];
              const a = p(left, fu),
                b = p(right, fu);
              const x = a[0] + (b[0] - a[0]) * fv,
                z = a[2] + (b[2] - a[2]) * fv;
              const y = topAt(rb, x, z);
              if (y === null) continue;
              samples++;
              for (const o of floors)
                if (o !== rb) {
                  const oy = topAt(o, x, z);
                  if (oy !== null && Math.abs(oy - y) < 0.03) overlaps++;
                }
            }
        }
        checked += samples;
        expect(overlaps / Math.max(1, samples), `${h.name} (${lastHoleSpecials.join(',')})`).toBeLessThan(0.02);
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('every corkscrew and slide floor is one seamless ribbon squared off to its neighbours', () => {
    const m = new HopperMatch({ seed: 9, players: [{ id: 'p', name: 'P' }], upgrades: {}, keepsakes: [] });
    let ribbons = 0;
    for (let i = 0; i < SKELETON.length; i++) {
      const spec = m.makeSpec(i, null, null, 1);
      if (spec.kind === 'rest') continue;
      const h = stageHole(9, i, spec);
      for (const s of h.solids)
        if (s.shape === 'ribbon') {
          ribbons++;
          const { left, right } = solidRibbon(s);
          expect(left.length).toBe(right.length);
          for (let k = 0; k < left.length; k++) expect(Number.isFinite(left[k][0] + right[k][2])).toBe(true);
        }
    }
    expect(ribbons).toBeGreaterThan(3);
  });
});
