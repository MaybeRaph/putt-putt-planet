import * as THREE from 'three';
import type { Vec3 } from '@ppp/shared';

/** Timing of the hole intro flyover (seconds). */
export const INTRO = {
  min: 3,
  max: 5,
  /** Share of the time spent sweeping back from the cup to the tee and into the normal camera. */
  returnShare: 0.42,
  /** How long a skipped intro takes to settle into the normal camera (never a hard cut). */
  skip: 0.45,
} as const;

const ease = (k: number): number => {
  const t = Math.min(1, Math.max(0, k));
  return t * t * (3 - 2 * t);
};

/** Flyover length for a hole whose centreline is `pathLength` metres long. */
export function introDuration(pathLength: number): number {
  return Math.min(INTRO.max, Math.max(INTRO.min, 2.6 + pathLength * 0.075));
}

/**
 * Camera flyover that shows a hole off before play starts. The view travels the hole's centreline
 * from the tee to the cup, then sweeps back along it and blends into the normal gameplay camera, so the
 * last frame of the intro is exactly the first frame of play.
 *
 * It only moves the camera: the match, turns and timers know nothing about it, which is why it
 * cannot desync a multiplayer game.
 */
export class HoleIntro {
  readonly duration: number;
  readonly pos = new THREE.Vector3();
  readonly look = new THREE.Vector3();
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly back: number;
  private readonly height: number;
  private t = 0;
  private skipFrom: { t: number; w: number } | null = null;
  private w = 0;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  constructor(path: Vec3[]) {
    // Drop repeated waypoints (a zero-length span would break the curve's parameterisation).
    const pts: THREE.Vector3[] = [];
    for (const p of path) {
      const v = new THREE.Vector3(p[0], p[1], p[2]);
      if (!pts.length || pts[pts.length - 1].distanceTo(v) > 0.05) pts.push(v);
    }
    if (pts.length < 2) pts.push(pts[0].clone().add(new THREE.Vector3(0.5, 0, 0)));
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const length = this.curve.getLength();
    this.duration = introDuration(length);
    const box = new THREE.Box3().setFromPoints(pts);
    const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 4);
    this.back = Math.min(8.5, Math.max(4.5, span * 0.3));
    this.height = Math.min(6.5, Math.max(3.4, span * 0.2));
    this.flyPose(0);
  }

  /** Flyover pose with the view `u` (0 = tee, 1 = cup) of the way along the hole. */
  private flyPose(u: number): void {
    const p = this.curve.getPointAt(u, this.a);
    // Heading from a wide chord, so the camera sweeps round corners instead of snapping.
    const ahead = this.curve.getPointAt(Math.min(1, u + 0.1));
    const behind = this.curve.getPointAt(Math.max(0, u - 0.1));
    const dir = this.b.subVectors(ahead, behind).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    dir.normalize();
    // Look a few metres past the spot being shown, so the horizon and scenery are in frame;
    // close in on the cup itself at the end.
    const reach = 4 * (1 - ease((u - 0.8) / 0.2));
    this.look
      .copy(p)
      .addScaledVector(dir, reach)
      .add(new THREE.Vector3(0, 0.3, 0));
    this.pos
      .copy(p)
      .addScaledVector(dir, -this.back)
      .add(new THREE.Vector3(0, this.height, 0));
  }

  /** Any key or tap: glide straight into the gameplay camera. */
  skip(): void {
    this.skipFrom ??= { t: this.t, w: this.w };
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
    const fly = this.duration * (1 - INTRO.returnShare);
    if (this.skipFrom) {
      const k = ease((this.t - this.skipFrom.t) / INTRO.skip);
      this.w = this.t - this.skipFrom.t >= INTRO.skip ? 1 : this.skipFrom.w + (1 - this.skipFrom.w) * k;
    } else if (this.t <= fly) {
      this.flyPose(ease(this.t / fly));
      this.w = 0;
    } else {
      // Way back: retrace the hole quickly (the view stays on the course the whole time), and
      // over the last stretch melt into the gameplay camera behind the tee.
      const k = (this.t - fly) / (this.duration - fly);
      this.flyPose(1 - ease(k));
      this.w = this.t >= this.duration ? 1 : ease((k - 0.45) / 0.55);
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
