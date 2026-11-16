import * as THREE from 'three';
import type { Loadout } from '@ppp/shared';
import { BallView } from './BallView';

/** One recorded frame of a putt: seconds since the shot, and where the ball was. */
export interface ReplayFrame {
  t: number;
  pos: THREE.Vector3;
}

/** Longest stretch of a putt kept for a replay (seconds of play). */
export const REPLAY_MAX_SECONDS = 14;
/** Replays play back at this fraction of real time. */
export const REPLAY_SPEED = 0.6;

/**
 * v1.12 hole-in-one replays. The recorder keeps the path of the current putt (cleared on every
 * new shot), so after a true ace (one putt struck, in the cup) the scene can play it back.
 */
export class ShotRecorder {
  frames: ReplayFrame[] = [];
  private t0 = 0;
  private active = false;

  start(now: number, pos: THREE.Vector3): void {
    this.frames = [{ t: 0, pos: pos.clone() }];
    this.t0 = now;
    this.active = true;
  }

  /** Add a frame while the putt is running (stops on its own after REPLAY_MAX_SECONDS). */
  sample(now: number, pos: THREE.Vector3): void {
    if (!this.active) return;
    const t = (now - this.t0) / 1000;
    if (t > REPLAY_MAX_SECONDS) {
      this.active = false;
      return;
    }
    const last = this.frames[this.frames.length - 1];
    if (last && last.pos.distanceToSquared(pos) < 1e-8 && t - last.t < 0.25) return;
    this.frames.push({ t, pos: pos.clone() });
  }

  stop(): void {
    this.active = false;
  }

  /** Long enough to be worth replaying. */
  get usable(): boolean {
    return this.frames.length >= 8 && this.frames[this.frames.length - 1].t > 0.4;
  }
}

/** Position along recorded frames at time t (linear between samples). */
export function samplePath(frames: ReplayFrame[], t: number, out = new THREE.Vector3()): THREE.Vector3 {
  if (!frames.length) return out.set(0, 0, 0);
  if (t <= frames[0].t) return out.copy(frames[0].pos);
  for (let i = 1; i < frames.length; i++) {
    const b = frames[i];
    if (b.t >= t) {
      const a = frames[i - 1];
      const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return out.copy(a.pos).lerp(b.pos, k);
    }
  }
  return out.copy(frames[frames.length - 1].pos);
}

/**
 * Plays a recorded putt back with its own ball (your loadout, trail and all) and a chase camera
 * that swings round to face the cup as the ball drops in.
 */
export class ReplayPlayer {
  private readonly ball: BallView;
  private time = 0;
  private readonly length: number;
  private readonly cam = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly prev = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly heading = new THREE.Vector3(0, 0, 1);
  private started = false;
  done = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly frames: ReplayFrame[],
    private readonly cup: THREE.Vector3,
    loadout: Loadout,
  ) {
    this.ball = new BallView('replay', loadout, false);
    scene.add(this.ball.root, this.ball.trailMesh);
    this.length = frames[frames.length - 1].t + 1.2; // a beat in the cup at the end
    samplePath(frames, 0, this.pos);
    this.prev.copy(this.pos);
    this.ball.snap(this.pos);
  }

  /** Seconds the replay lasts (playback time). */
  get duration(): number {
    return this.length / REPLAY_SPEED;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, reducedMotion: boolean): void {
    if (this.done) return;
    this.time += dt * REPLAY_SPEED;
    const end = this.frames[this.frames.length - 1].t;
    samplePath(this.frames, Math.min(this.time, end), this.pos);
    this.vel
      .copy(this.pos)
      .sub(this.prev)
      .divideScalar(Math.max(1e-4, dt * REPLAY_SPEED));
    this.prev.copy(this.pos);
    const inCup = this.time > end - 0.05;
    this.ball.update(this.pos, this.vel, dt, inCup && this.time > end + 0.3, reducedMotion);
    // Chase camera: behind and above the ball along its travel, easing towards a view of the cup.
    const flat = this.vel.clone().setY(0);
    if (flat.lengthSq() > 0.04) this.heading.lerp(flat.normalize(), Math.min(1, dt * 3)).normalize();
    const toCup = this.cup.clone().sub(this.pos).setY(0);
    const near = Math.max(0, Math.min(1, 1 - toCup.length() / 3));
    const back = this.heading.clone().multiplyScalar(-(1.9 - near * 0.6));
    const want = this.pos
      .clone()
      .add(back)
      .add(new THREE.Vector3(0, 0.95 + near * 0.4, 0));
    const lookAt = this.pos.clone().lerp(this.cup, near * 0.6);
    if (!this.started) {
      this.cam.copy(want);
      this.look.copy(lookAt);
      this.started = true;
    }
    const k = Math.min(1, dt * 4);
    this.cam.lerp(want, k);
    this.look.lerp(lookAt, k);
    camera.position.copy(this.cam);
    camera.lookAt(this.look);
    if (this.time >= this.length) this.done = true;
  }

  dispose(): void {
    this.ball.dispose();
    this.scene.remove(this.ball.root, this.ball.trailMesh);
  }
}
