import * as THREE from 'three';
import { SKELETON, computeBounds, obstacleSolids, windmillVisual, type Hole, type Vec3 } from '@ppp/shared';

/** Timing and framing of the hole intro (seconds / metres). */
export const INTRO = {
  /** On the cup, with the name and par card, before the camera moves. */
  hold: 2,
  /** The pass from the cup back to the tee: base + per metre of hole, clamped. */
  flyBase: 2.2,
  flyPerMetre: 0.16,
  minFly: 2.8,
  maxFly: 10.8,
  /** Easing from the end of the pass into the gameplay camera. */
  settle: 1.2,
  /** How long a skipped intro takes to settle into the normal camera (never a hard cut). */
  skip: 0.45,
  /** The camera stays this far above anything solid within `reach` of it (no clipping). */
  clearance: 1.6,
  reach: 1.4,
  /** Camera trails the spot being shown by this much path (metres), and looks this far ahead. */
  minBack: 4.5,
  maxBack: 6,
  lookAhead: 4,
  minHeight: 3.4,
  maxHeight: 8,
} as const;

/** Total intro = hold + pass + settle: 6 s for a short hole up to 14 s for the longest. */
export function introTiming(pathLength: number): {
  hold: number;
  fly: number;
  settle: number;
  total: number;
} {
  const fly = Math.min(INTRO.maxFly, Math.max(INTRO.minFly, INTRO.flyBase + pathLength * INTRO.flyPerMetre));
  return { hold: INTRO.hold, fly, settle: INTRO.settle, total: INTRO.hold + fly + INTRO.settle };
}

/** Intro length for a hole whose centreline is `pathLength` metres long. */
export function introDuration(pathLength: number): number {
  return introTiming(pathLength).total;
}

/** What to play when a hole loads: the flyover, just the card (reduced motion), or nothing. */
export function introPlan(o: {
  courseId: string;
  holeIndex: number;
  fresh: boolean;
  reducedMotion: boolean;
  disabled?: boolean;
}): 'fly' | 'card' | 'none' {
  if (!o.fresh || o.disabled) return 'none';
  // Planet Hopper rest stops are a breather, not a hole: no card, no flyover, no input lock.
  // (The run's skeleton is fixed and hole i is stage i, so this never depends on a late score.)
  if (o.courseId === 'hopper' && SKELETON[o.holeIndex]?.kind === 'rest') return 'none';
  return o.reducedMotion ? 'card' : 'fly';
}

/** Axis-aligned boxes of everything the flyover camera must stay above (solids, machinery, roofs). */
export function introBlockers(hole: Pick<Hole, 'solids' | 'obstacles'>): { min: Vec3; max: Vec3 }[] {
  const out = hole.solids.map((s) => computeBounds([s]));
  for (const o of hole.obstacles) {
    for (const s of obstacleSolids(o)) out.push(computeBounds([s]));
    if (o.type === 'windmill') {
      // Blades and the roof are drawn above the tower.
      const { height } = windmillVisual(o);
      const r = Math.max(o.bladeLength + 0.3, o.baseWidth * 0.62);
      out.push({
        min: [o.pos[0] - r, o.pos[1], o.pos[2] - r],
        max: [o.pos[0] + r, o.pos[1] + height + 1.2, o.pos[2] + r],
      });
    } else if (o.type === 'mover') {
      for (const c of [o.from, o.to])
        out.push({
          min: [c[0] - o.size[0], c[1] - o.size[1], c[2] - o.size[0]],
          max: [c[0] + o.size[0], c[1] + o.size[1], c[2] + o.size[0]],
        });
    }
  }
  return out;
}

const smoother = (k: number): number => {
  const t = Math.min(1, Math.max(0, k));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/**
 * Camera flyover that shows a hole off before play starts, in one slow pass: it holds on the cup
 * (with the hole's name and par), glides back along the whole course to the tee, then eases into
 * the normal gameplay camera, so the last frame of the intro is exactly the first frame of play.
 *
 * The camera rides above the course's own centreline a few metres behind the spot it shows,
 * looking ahead along the hole, so every leg, fork and set piece passes through the frame and the
 * camera is always over the course (never out among the trees). Its height follows a smoothed
 * profile that clears every solid near it.
 *
 * It only moves the camera: the match, turns and timers know nothing about it, which is why it
 * cannot desync a multiplayer game.
 */
export class HoleIntro {
  readonly duration: number;
  readonly timing: ReturnType<typeof introTiming>;
  readonly length: number;
  readonly pos = new THREE.Vector3();
  readonly look = new THREE.Vector3();
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly back: number;
  private readonly startDir = new THREE.Vector3();
  /** Camera height (world y) by camera arc position, sampled from -back to length. */
  private readonly heights: Float32Array;
  private readonly h0: number;
  private readonly dh: number;
  private t = 0;
  private skipFrom: { t: number; w: number } | null = null;
  private w = 0;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  constructor(path: Vec3[], blockers: { min: Vec3; max: Vec3 }[] = []) {
    // Drop repeated waypoints (a zero-length span would break the curve's parameterisation).
    const pts: THREE.Vector3[] = [];
    for (const p of path) {
      const v = new THREE.Vector3(p[0], p[1], p[2]);
      if (!pts.length || pts[pts.length - 1].distanceTo(v) > 0.05) pts.push(v);
    }
    if (pts.length < 2) pts.push(pts[0].clone().add(new THREE.Vector3(0.5, 0, 0)));
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.length = this.curve.getLength();
    this.timing = introTiming(this.length);
    this.duration = this.timing.total;
    this.startDir.subVectors(pts[1], pts[0]).setY(0);
    if (this.startDir.lengthSq() < 1e-8) this.startDir.set(1, 0, 0);
    this.startDir.normalize();

    const box = new THREE.Box3().setFromPoints(pts);
    const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 4);
    this.back = Math.min(INTRO.maxBack, Math.max(INTRO.minBack, span * 0.25));
    const lift = Math.min(INTRO.maxHeight, Math.max(INTRO.minHeight, span * 0.18));

    // Height profile: the camera's base height over the path, raised wherever something solid
    // stands near it, then widened and smoothed so it climbs early and never dips into anything.
    this.h0 = -this.back;
    const n = Math.max(64, Math.ceil((this.length + this.back) * 4));
    this.dh = (this.length + this.back) / (n - 1);
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = this.pathAt(this.h0 + i * this.dh, this.a);
      let need = p.y + lift;
      for (const bb of blockers) {
        const dx = Math.max(bb.min[0] - p.x, 0, p.x - bb.max[0]);
        const dz = Math.max(bb.min[2] - p.z, 0, p.z - bb.max[2]);
        if (dx * dx + dz * dz <= INTRO.reach * INTRO.reach)
          need = Math.max(need, bb.max[1] + INTRO.clearance);
      }
      raw[i] = need;
    }
    const r = Math.max(1, Math.round(2 / this.dh)); // ~2 m
    const dil = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = -Infinity;
      for (let j = Math.max(0, i - 2 * r); j <= Math.min(n - 1, i + 2 * r); j++) m = Math.max(m, raw[j]);
      dil[i] = m;
    }
    this.heights = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0,
        c = 0;
      for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) {
        s += dil[j];
        c++;
      }
      this.heights[i] = s / c;
    }
    this.flyPose(this.length);
  }

  /** Point on the course centreline `s` metres from the tee (straight on behind the tee). */
  private pathAt(s: number, out: THREE.Vector3): THREE.Vector3 {
    if (s <= 0) return out.copy(this.curve.getPointAt(0)).addScaledVector(this.startDir, s);
    return out.copy(this.curve.getPointAt(Math.min(1, s / this.length)));
  }

  /** Camera height for a camera standing over path position `s` (smoothed profile). */
  heightAt(s: number): number {
    const x = (s - this.h0) / this.dh;
    const i = Math.max(0, Math.min(this.heights.length - 2, Math.floor(x)));
    const k = Math.max(0, Math.min(1, x - i));
    return this.heights[i] * (1 - k) + this.heights[i + 1] * k;
  }

  /** Flyover pose showing path position `s` (0 = tee, length = cup). */
  private flyPose(s: number): void {
    const cs = s - this.back;
    this.pathAt(cs, this.pos);
    this.pos.y = this.heightAt(cs);
    this.pathAt(Math.min(this.length, s + INTRO.lookAhead), this.look);
    this.look.y += 0.3;
  }

  /** Position along the hole being shown at intro time `t` (cup -> tee). */
  focusAt(t: number): number {
    const { hold, fly } = this.timing;
    if (t <= hold) return this.length;
    return this.length * (1 - smoother((t - hold) / fly));
  }

  /** Any key or tap: glide straight into the gameplay camera. */
  skip(): void {
    this.skipFrom ??= { t: this.t, w: this.w };
  }

  get skipped(): boolean {
    return this.skipFrom !== null;
  }

  /** Seconds since the intro started. */
  get elapsed(): number {
    return this.t;
  }

  /** How much of the gameplay camera is mixed in: 0 = pure flyover, 1 = finished. */
  get blend(): number {
    return this.w;
  }

  get done(): boolean {
    return this.w >= 1;
  }

  /**
   * Advance by `dt` and write the camera. `gamePos` / `gameLook` are where the normal camera
   * wants to be right now; the camera ends exactly there.
   */
  update(dt: number, camera: THREE.Camera, gamePos: THREE.Vector3, gameLook: THREE.Vector3): void {
    this.t += dt;
    const { hold, fly, settle, total } = this.timing;
    if (this.skipFrom) {
      const k = smoother((this.t - this.skipFrom.t) / INTRO.skip);
      this.w = this.t - this.skipFrom.t >= INTRO.skip ? 1 : this.skipFrom.w + (1 - this.skipFrom.w) * k;
    } else {
      this.flyPose(this.focusAt(this.t));
      this.w = this.t >= total ? 1 : smoother((this.t - hold - fly) / settle);
    }
    if (this.w >= 1) {
      camera.position.copy(gamePos);
      camera.lookAt(gameLook);
      return;
    }
    camera.position.lerpVectors(this.pos, gamePos, this.w);
    camera.lookAt(this.a.lerpVectors(this.look, gameLook, this.w));
  }
}
