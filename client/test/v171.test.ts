import { describe, expect, it } from 'vitest';
import { pingClass, pingLabel, pingReadout } from '../src/ui/ping';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import * as THREE from 'three';
import { COURSES, HopperMatch, SKELETON, stageHole, type Hole, type Vec3 } from '@ppp/shared';
import { choiceTimerText } from '../src/ui/HopperHud';
import {
  HoleIntro,
  INTRO,
  introBlockers,
  introDuration,
  introPlan,
  introTiming,
} from '../src/rendering/HoleIntro';

describe('v1.7.1 ping', () => {
  it('labels each player on the Tab board: ms, reconnecting, nothing offline', () => {
    expect(pingLabel({ connected: true, ping: 41.6 }, true)).toBe('42 ms');
    expect(pingLabel({ connected: false, ping: 41 }, true)).toBe('reconnecting…');
    expect(pingLabel({ connected: true, ping: 41 }, false)).toBeNull();
    expect(pingLabel({ connected: false }, false)).toBeNull();
    expect(pingLabel({ connected: true }, true)).toBeNull(); // no measurement yet
    expect(pingLabel({ connected: true, ping: -3 }, true)).toBe('0 ms');
  });

  it('colours pings by quality', () => {
    expect(pingClass({ connected: true, ping: 30 })).toBe('good');
    expect(pingClass({ connected: true, ping: 120 })).toBe('fair');
    expect(pingClass({ connected: true, ping: 400 })).toBe('poor');
    expect(pingClass({ connected: false, ping: 10 })).toBe('poor');
  });

  it('the Show ping readout is online-only, off by default, and says when the link is down', () => {
    expect(DEFAULT_SETTINGS.showPing).toBe(false);
    expect(pingReadout(false, true, 'online', 50)).toBeNull();
    expect(pingReadout(true, false, 'online', 50)).toBeNull();
    expect(pingReadout(true, true, 'online', 49.5)).toBe('50 ms');
    expect(pingReadout(true, true, 'connecting', 50)).toBe('reconnecting…');
    expect(pingReadout(true, true, 'offline', 50)).toBe('reconnecting…');
  });
});

// ---------------------------------------------------------------------------------------------
// Hole intro: one slow pass, cup -> tee
// ---------------------------------------------------------------------------------------------

/** Hand-made holes plus generated Planet Hopper stages (long, curvy, forked, set pieces, bosses). */
function sampleHoles(): Hole[] {
  const out: Hole[] = COURSES.flatMap((c) => c.holes);
  for (const seed of [3, 11]) {
    const m = new HopperMatch({ seed, players: [{ id: 'p', name: 'P' }], upgrades: {}, keepsakes: [] });
    for (let i = 0; i < SKELETON.length; i++) {
      const spec = m.makeSpec(i, null, null, seed % 3);
      if (spec.kind !== 'rest') out.push(stageHole(seed, i, spec));
    }
  }
  return out;
}

const DT = 1 / 60;
const gamePos = new THREE.Vector3(-4, 2.1, 0);
const gameLook = new THREE.Vector3(0, 0.25, 0);

/** Play an intro to the end, recording each frame. */
function play(intro: HoleIntro, until: () => boolean = () => intro.done) {
  const cam = new THREE.PerspectiveCamera();
  const frames: { t: number; pos: THREE.Vector3; look: THREE.Vector3; blend: number }[] = [];
  let t = 0;
  while (!until() && t < 30) {
    intro.update(DT, cam, gamePos, gameLook);
    t += DT;
    frames.push({ t, pos: cam.position.clone(), look: intro.look.clone(), blend: intro.blend });
  }
  return { cam, frames, t };
}

describe('v1.7.1 hole intro', () => {
  const path: Vec3[] = [
    [0, 0, 0],
    [8, 0, 0],
    [8, 1, 9],
    [20, 1, 9],
  ];
  const cup = new THREE.Vector3(20, 1.3, 9);

  it('lasts 6 to 14 s: 2 s on the cup, a pass that scales with the hole, then the settle', () => {
    expect(introTiming(0)).toMatchObject({ hold: 2, fly: INTRO.minFly, settle: INTRO.settle });
    expect(introDuration(0)).toBeCloseTo(6, 6);
    expect(introDuration(1000)).toBeCloseTo(14, 6);
    let prev = 0;
    for (const L of [5, 10, 20, 30, 45, 60, 80]) {
      expect(introDuration(L)).toBeGreaterThanOrEqual(prev);
      prev = introDuration(L);
    }
    for (const h of sampleHoles()) {
      const d = new HoleIntro(h.path).duration;
      expect(d).toBeGreaterThanOrEqual(6 - 1e-9);
      expect(d).toBeLessThanOrEqual(14 + 1e-9);
    }
  });

  it('holds on the cup, sweeps back to the tee in one eased pass, and ends exactly on the gameplay camera', () => {
    const intro = new HoleIntro(path);
    const { cam, frames, t } = play(intro);
    const { hold, fly, total } = intro.timing;
    // The hold: looking at the cup, camera still.
    const held = frames.filter((f) => f.t <= hold);
    for (const f of held) expect(f.look.distanceTo(cup)).toBeLessThan(1e-6);
    expect(held[held.length - 1].pos.distanceTo(held[0].pos)).toBeLessThan(1e-6);
    // The pass only ever moves towards the tee (one pass, no back-and-forth).
    let s = Infinity;
    for (let k = 0; k <= 200; k++) {
      const f = intro.focusAt(hold + (fly * k) / 200);
      expect(f).toBeLessThanOrEqual(s + 1e-9);
      s = f;
    }
    expect(intro.focusAt(hold + fly)).toBeCloseTo(0, 6);
    // Eased: slow at both ends of the pass, fastest in the middle.
    const speed = (a: number) => Math.abs(intro.focusAt(a + 0.01) - intro.focusAt(a)) / 0.01;
    expect(speed(hold + 0.02)).toBeLessThan(speed(hold + fly / 2) * 0.05);
    expect(speed(hold + fly - 0.03)).toBeLessThan(speed(hold + fly / 2) * 0.05);
    // Smooth throughout, hand-over included, and well within a "slow" pace.
    let maxStep = 0;
    for (let i = 1; i < frames.length; i++)
      maxStep = Math.max(maxStep, frames[i].pos.distanceTo(frames[i - 1].pos));
    expect(maxStep).toBeLessThan(0.3);
    // Gameplay camera only blends in after the pass.
    for (const f of frames) if (f.t < hold + fly) expect(f.blend).toBe(0);
    expect(t).toBeGreaterThan(total - 0.05);
    expect(t).toBeLessThan(total + 0.05);
    expect(cam.position.distanceTo(gamePos)).toBeLessThan(1e-6);
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    expect(fwd.angleTo(gameLook.clone().sub(gamePos).normalize())).toBeLessThan(1e-4);
  });

  it('shows the whole course and never clips through it, on every kind of hole', () => {
    for (const h of sampleHoles()) {
      const blockers = introBlockers(h);
      const intro = new HoleIntro(h.path, blockers);
      const { frames } = play(intro, () => intro.blend > 0);
      const pts = h.path.map((p) => new THREE.Vector3(...p));
      // The camera flies over every waypoint of the hole (within its trailing distance)...
      for (const p of pts) {
        const near = Math.min(...frames.map((f) => Math.hypot(f.pos.x - p.x, f.pos.z - p.z)));
        expect(near, `${h.id} waypoint ${p.toArray()}`).toBeLessThan(INTRO.maxBack + 0.5);
      }
      // ...and is always above anything solid nearby, with room to spare.
      for (const f of frames)
        for (const b of blockers) {
          const dx = Math.max(b.min[0] - f.pos.x, 0, f.pos.x - b.max[0]);
          const dz = Math.max(b.min[2] - f.pos.z, 0, f.pos.z - b.max[2]);
          if (dx * dx + dz * dz <= INTRO.reach * INTRO.reach)
            expect(f.pos.y, `${h.id} over a solid`).toBeGreaterThanOrEqual(b.max[1] + INTRO.clearance - 1e-3);
        }
    }
  });

  it('can be skipped at any moment and still lands on the gameplay camera without a cut', () => {
    for (const at of [0.05, 1.5, 4, 7.5]) {
      const intro = new HoleIntro(path);
      const cam = new THREE.PerspectiveCamera();
      for (let t = 0; t < at; t += DT) intro.update(DT, cam, gamePos, gameLook);
      const before = cam.position.clone();
      intro.skip();
      intro.skip(); // a second key press changes nothing
      intro.update(DT, cam, gamePos, gameLook);
      expect(cam.position.distanceTo(before)).toBeLessThan(1.2);
      let t = 0;
      while (!intro.done && t < 5) {
        intro.update(DT, cam, gamePos, gameLook);
        t += DT;
      }
      expect(t).toBeLessThanOrEqual(INTRO.skip + 0.05);
      expect(cam.position.distanceTo(gamePos)).toBeLessThan(1e-6);
    }
  });

  it('copes with degenerate paths', () => {
    const intro = new HoleIntro([
      [1, 0, 1],
      [1, 0, 1],
    ]);
    const { cam } = play(intro);
    expect(Number.isFinite(cam.position.x + cam.position.y + cam.position.z)).toBe(true);
  });

  it('plays on normal and boss stages but not on Planet Hopper rest stops', () => {
    const rest = SKELETON.findIndex((s) => s.kind === 'rest');
    const boss = SKELETON.findIndex((s) => s.kind === 'boss');
    const hole = SKELETON.findIndex((s) => s.kind === 'hole');
    const plan = (
      courseId: string,
      holeIndex: number,
      extra: Partial<Parameters<typeof introPlan>[0]> = {},
    ) => introPlan({ courseId, holeIndex, fresh: true, reducedMotion: false, ...extra });
    expect(rest).toBeGreaterThan(0);
    expect(plan('hopper', rest)).toBe('none');
    expect(plan('hopper', rest, { reducedMotion: true })).toBe('none'); // no card either
    expect(plan('hopper', boss)).toBe('fly');
    expect(plan('hopper', hole)).toBe('fly');
    // Ordinary courses don't have rest stops, whatever the hole number.
    expect(plan('meadow', rest)).toBe('fly');
    expect(plan('meadow', 0, { reducedMotion: true })).toBe('card');
    expect(plan('meadow', 0, { fresh: false })).toBe('none');
    expect(plan('meadow', 0, { disabled: true })).toBe('none');
  });
});

describe('v1.7.1 majority hint', () => {
  it('reads the host countdown, with the majority wording once it is cut', () => {
    expect(choiceTimerText(25, false)).toBe('Auto-picks in 25s');
    expect(choiceTimerText(5, true)).toBe('Majority reached, deciding in 5s');
    expect(choiceTimerText(3, true)).toBe('Majority reached, deciding in 3s');
  });
});

describe('hole intro is smooth', () => {
  it('glides: no sudden swings of the camera or of where it looks, even round corkscrews', () => {
    let worstAcc = 0,
      worstTurn = 0;
    for (const h of sampleHoles()) {
      const intro = new HoleIntro(h.path, introBlockers(h));
      const cam = new THREE.PerspectiveCamera();
      const P: THREE.Vector3[] = [],
        D: THREE.Vector3[] = [];
      while (intro.blend === 0 && intro.elapsed < 30) {
        intro.update(DT, cam, gamePos, gameLook);
        P.push(cam.position.clone());
        D.push(cam.getWorldDirection(new THREE.Vector3()));
      }
      for (let k = 2; k < P.length; k++) {
        const acc =
          P[k]
            .clone()
            .sub(P[k - 1])
            .sub(P[k - 1].clone().sub(P[k - 2]))
            .length() /
          (DT * DT);
        const turn = Math.abs(D[k].angleTo(D[k - 1]) - D[k - 1].angleTo(D[k - 2])) / (DT * DT);
        worstAcc = Math.max(worstAcc, acc);
        worstTurn = Math.max(worstTurn, turn);
      }
    }
    // v1.8.5 peaked at ~3400 m/s² and ~325 rad/s² (it rode the centreline and swung at every corner).
    expect(worstAcc).toBeLessThan(150);
    expect(worstTurn).toBeLessThan(25);
  });
});
