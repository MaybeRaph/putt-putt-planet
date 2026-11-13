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
  /** Half-width (m of path) of each smoothing pass over the camera's line. */
  smooth: 2.6,
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
  private readonly back: number;
  /**
   * The camera's rails, sampled every `ds` metres of path from `s0` (= -back) to the cup:
   * `raw` is the course centreline itself, `soft` the same line with its corners, ramps and
   * ledges smoothed out, and `high` the camera's height. The flyover reads all three through a
   * cubic, so the camera's position, and the point it looks at, never change speed or direction
   * abruptly (it used to ride the centreline itself and swung at every corner).
   */
  private readonly soft: Float32Array;
  private readonly high: Float32Array;
  private readonly n: number;
  private readonly s0: number;
  private readonly ds: number;
  private readonly cup = new THREE.Vector3();
  private t = 0;
  private skipFrom: { t: number; w: number } | null = null;
  private w = 0;
  private readonly a = new THREE.Vector3();

  constructor(path: Vec3[], blockers: { min: Vec3; max: Vec3 }[] = []) {
    // Drop repeated waypoints (a zero-length span would break the curve's parameterisation).
    const pts: THREE.Vector3[] = [];
    for (const p of path) {
      const v = new THREE.Vector3(p[0], p[1], p[2]);
      if (!pts.length || pts[pts.length - 1].distanceTo(v) > 0.05) pts.push(v);
    }
    if (pts.length < 2) pts.push(pts[0].clone().add(new THREE.Vector3(0.5, 0, 0)));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    // Fine arc-length table: the default 200 steps make speed ripple on long, twisty holes.
    curve.arcLengthDivisions = Math.min(6000, Math.max(400, pts.length * 24));
    this.length = curve.getLength();
    this.timing = introTiming(this.length);
    this.duration = this.timing.total;
    this.cup.copy(pts[pts.length - 1]);
    const startDir = new THREE.Vector3().subVectors(pts[1], pts[0]).setY(0);
    if (startDir.lengthSq() < 1e-8) startDir.set(1, 0, 0);
    startDir.normalize();

    const box = new THREE.Box3().setFromPoints(pts);
    const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 4);
    this.back = Math.min(INTRO.maxBack, Math.max(INTRO.minBack, span * 0.25));
    const lift = Math.min(INTRO.maxHeight, Math.max(INTRO.minHeight, span * 0.18));

    // The centreline, sampled evenly from `back` metres behind the tee to the cup.
    this.s0 = -this.back;
    const total = this.length + this.back;
    const n = (this.n = Math.max(64, Math.ceil(total * 5) + 1));
    const ds = (this.ds = total / (n - 1));
    const raw = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const s = this.s0 + i * ds;
      if (s <= 0) v.copy(pts[0]).addScaledVector(startDir, s);
      else curve.getPointAt(Math.min(1, s / this.length), v);
      raw.set([v.x, v.y, v.z], i * 3);
    }
    // Smoothed: three passes of a moving average (close to a Gaussian about 2 m wide). The ends
    // are pinned so the intro still starts dead on the cup and ends over the tee.
    const rad = Math.max(1, Math.round(INTRO.smooth / ds));
    let cur = raw;
    for (let pass = 0; pass < 3; pass++) {
      const next = new Float32Array(n * 3);
      for (let i = 0; i < n; i++)
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let j = i - rad; j <= i + rad; j++) sum += cur[Math.max(0, Math.min(n - 1, j)) * 3 + c];
          next[i * 3 + c] = sum / (2 * rad + 1);
        }
      cur = next;
    }
    this.soft = cur;
    const pin = Math.max(2, Math.round((INTRO.smooth * 3) / ds));
    for (let i = 0; i < n; i++) {
      const k = smoother(Math.min(i, n - 1 - i) / pin);
      for (let c = 0; c < 3; c++) this.soft[i * 3 + c] = raw[i * 3 + c] * (1 - k) + this.soft[i * 3 + c] * k;
    }

    // Height profile: the camera's base height over its (smoothed) line, raised wherever something
    // solid stands near it, then widened and smoothed so it climbs early and never dips into anything.
    const need = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = this.soft[i * 3],
        z = this.soft[i * 3 + 2];
      let h = this.soft[i * 3 + 1] + lift;
      for (const bb of blockers) {
        const dx = Math.max(bb.min[0] - x, 0, x - bb.max[0]);
        const dz = Math.max(bb.min[2] - z, 0, z - bb.max[2]);
        const reach = INTRO.reach + ds;
        if (dx * dx + dz * dz <= reach * reach) h = Math.max(h, bb.max[1] + INTRO.clearance + 0.05);
      }
      need[i] = h;
    }
    const r = Math.max(2, Math.round(2 / ds)); // ~2 m
    let hs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = -Infinity;
      for (let j = Math.max(0, i - 2 * r - 2); j <= Math.min(n - 1, i + 2 * r + 2); j++)
        m = Math.max(m, need[j]);
      hs[i] = m;
    }
    // Two averaging passes of half the dilation each: smooth slopes, and still never below `need`.
    for (let pass = 0; pass < 2; pass++) {
      const next = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = i - r; j <= i + r; j++) sum += hs[Math.max(0, Math.min(n - 1, j))];
        next[i] = sum / (2 * r + 1);
      }
      hs = next;
    }
    this.high = hs;
    this.flyPose(this.length);
  }

  /** Cubic (Catmull-Rom) read of a sampled rail at path position `s`: continuous in speed. */
  private read(arr: Float32Array, stride: number, comp: number, s: number): number {
    const x = Math.max(0, Math.min(this.n - 1, (s - this.s0) / this.ds));
    const i = Math.min(this.n - 2, Math.floor(x));
    const u = x - i;
    const at = (k: number) => arr[Math.max(0, Math.min(this.n - 1, k)) * stride + comp];
    const p0 = at(i - 1),
      p1 = at(i),
      p2 = at(i + 1),
      p3 = at(i + 2);
    return p1 + 0.5 * u * (p2 - p0 + u * (2 * p0 - 5 * p1 + 4 * p2 - p3 + u * (3 * (p1 - p2) + p3 - p0)));
  }

  /** Camera height for a camera standing over path position `s` (smoothed profile). */
  heightAt(s: number): number {
    return this.read(this.high, 1, 0, s);
  }

  /** Flyover pose showing path position `s` (0 = tee, length = cup). */
  private flyPose(s: number): void {
    const cs = s - this.back;
    this.pos.set(this.read(this.soft, 3, 0, cs), this.heightAt(cs), this.read(this.soft, 3, 2, cs));
    // Looks ahead along the hole; the lead shrinks to nothing at the cup (so the hold frames the
    // cup itself) and grows back without a jolt as the camera pulls away.
    const rest = Math.max(0, this.length - s);
    const ls = s + INTRO.lookAhead * (1 - Math.exp(-rest / INTRO.lookAhead));
    if (rest <= 1e-9) this.look.copy(this.cup);
    else
      this.look.set(
        this.read(this.soft, 3, 0, ls),
        this.read(this.soft, 3, 1, ls),
        this.read(this.soft, 3, 2, ls),
      );
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
