import * as THREE from 'three';

/**
 * Smooth orbit camera around the ball. Yaw is the direction the camera looks along (0 = +X),
 * so "aim straight ahead" = camera yaw. Raycast pullback keeps it out of walls; an overview
 * mode frames the whole hole from above.
 */
export class CameraRig {
  yaw = 0;
  pitch = 0.5;
  dist = 4.2;
  private sYaw = 0;
  private sPitch = 0.5;
  private sDist = 4.2;
  readonly target = new THREE.Vector3();
  private readonly sTarget = new THREE.Vector3();
  overview = false;
  private overviewBlend = 0;
  private shakeAmp = 0;
  private readonly ray = new THREE.Raycaster();
  bounds: { min: THREE.Vector3; max: THREE.Vector3 } | null = null;
  reducedMotion = false;
  /** Height boost while the ball is in the air / flying (keeps it in frame). */
  private readonly tmp = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Snap behind `from` looking towards `to`. */
  frame(from: THREE.Vector3, to: THREE.Vector3): void {
    this.yaw = this.sYaw = Math.atan2(to.z - from.z, to.x - from.x);
    this.pitch = this.sPitch = 0.42;
    this.dist = this.sDist = 4.5;
    this.target.copy(from);
    this.sTarget.copy(from);
    this.overview = false;
    this.overviewBlend = 0;
  }

  orbit(dx: number, dy: number): void {
    this.yaw += dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy, 0.08, 1.45);
  }

  zoom(f: number): void {
    this.dist = THREE.MathUtils.clamp(this.dist * f, 1.6, 14);
  }

  shake(amount: number): void {
    if (this.reducedMotion) return;
    this.shakeAmp = Math.min(0.35, this.shakeAmp + amount);
  }

  update(dt: number, follow: THREE.Vector3, colliders: THREE.Object3D[]): void {
    this.target.copy(follow);
    const k = 1 - Math.exp(-dt * 7);
    this.sTarget.lerp(this.target, 1 - Math.exp(-dt * 9));
    let dy = this.yaw - this.sYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.sYaw += dy * k;
    this.sPitch += (this.pitch - this.sPitch) * k;
    this.sDist += (this.dist - this.sDist) * k;

    const cp = Math.cos(this.sPitch),
      sp = Math.sin(this.sPitch);
    const dir = new THREE.Vector3(-Math.cos(this.sYaw) * cp, sp, -Math.sin(this.sYaw) * cp);
    const look = this.sTarget.clone().add(new THREE.Vector3(0, 0.25, 0));

    // Pull the camera in front of walls between the ball and the camera.
    let d = this.sDist;
    if (colliders.length) {
      this.ray.set(look, dir);
      this.ray.far = d;
      const hit = this.ray.intersectObjects(colliders, false)[0];
      if (hit) d = Math.max(0.8, hit.distance - 0.25);
    }
    const follow3 = look.clone().addScaledVector(dir, d);

    this.overviewBlend += ((this.overview ? 1 : 0) - this.overviewBlend) * (1 - Math.exp(-dt * 4));
    if (this.overviewBlend > 0.001 && this.bounds) {
      const c = this.bounds.min.clone().add(this.bounds.max).multiplyScalar(0.5);
      const size = this.bounds.max.clone().sub(this.bounds.min);
      const span = Math.max(size.x, size.z);
      const h = span * 0.95 + 6;
      const over = c
        .clone()
        .add(new THREE.Vector3(-Math.cos(this.sYaw) * h * 0.35, h, -Math.sin(this.sYaw) * h * 0.35));
      this.camera.position.lerpVectors(follow3, over, this.overviewBlend);
      this.tmp.lerpVectors(look, c, this.overviewBlend);
      this.camera.lookAt(this.tmp);
    } else {
      this.camera.position.copy(follow3);
      this.camera.lookAt(look);
    }

    if (this.shakeAmp > 0.001) {
      const t = performance.now() / 1000;
      this.camera.position.x += Math.sin(t * 61) * this.shakeAmp * 0.3;
      this.camera.position.y += Math.sin(t * 47 + 1) * this.shakeAmp * 0.3;
      this.shakeAmp *= Math.exp(-dt * 7);
    }
  }
}
