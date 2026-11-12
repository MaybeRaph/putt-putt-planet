import * as THREE from 'three';
import { PHYSICS } from '@ppp/shared';

export type Palette = 'default' | 'colorblind' | 'contrast';

/** Aim colours. The colourblind palette (blue -> orange -> vermillion) is Okabe-Ito based. */
export const PALETTES: Record<Palette, [string, string, string]> = {
  default: ['#4cff7a', '#ffe14d', '#ff4d4d'],
  colorblind: ['#56b4e9', '#e69f00', '#d55e00'],
  contrast: ['#ffffff', '#ffff00', '#ff00ff'],
};

export function powerColor(p: number, palette: Palette): THREE.Color {
  const [a, b, c] = PALETTES[palette].map((h) => new THREE.Color(h));
  return p < 0.5 ? a.lerp(b, p * 2) : b.lerp(c, (p - 0.5) * 2);
}

/**
 * Aim arrow (length and colour = power, plus tick marks so power never relies on colour alone)
 * and a short dotted trajectory preview that reflects off the first wall it meets.
 */
export class AimView {
  readonly root = new THREE.Group();
  private readonly arrow: THREE.Mesh;
  private readonly arrowMat: THREE.MeshBasicMaterial;
  private readonly dots: THREE.InstancedMesh;
  private readonly ticks: THREE.Mesh[] = [];
  private readonly ray = new THREE.Raycaster();
  palette: Palette = 'default';
  private readonly MAX_DOTS = 28;

  constructor() {
    const shape = new THREE.Shape();
    // unit arrow along +X, length 1
    shape.moveTo(0, -0.05);
    shape.lineTo(0.78, -0.05);
    shape.lineTo(0.78, -0.13);
    shape.lineTo(1, 0);
    shape.lineTo(0.78, 0.13);
    shape.lineTo(0.78, 0.05);
    shape.lineTo(0, 0.05);
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    this.arrowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
    });
    this.arrow = new THREE.Mesh(geo, this.arrowMat);
    this.arrow.renderOrder = 10;
    this.root.add(this.arrow);
    const tickGeo = new THREE.PlaneGeometry(0.03, 0.22);
    tickGeo.rotateX(-Math.PI / 2);
    const tickMat = new THREE.MeshBasicMaterial({
      color: 0x222222,
      depthTest: false,
      transparent: true,
      opacity: 0.6,
    });
    for (let i = 1; i <= 4; i++) {
      const t = new THREE.Mesh(tickGeo, tickMat);
      t.renderOrder = 11;
      this.ticks.push(t);
      this.root.add(t);
    }
    this.dots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.035, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
      this.MAX_DOTS,
    );
    this.dots.frustumCulled = false;
    this.root.add(this.dots);
    this.root.visible = false;
  }

  hide(): void {
    this.root.visible = false;
  }

  /**
   * @param ball ball centre
   * @param angle aim direction (0 = +X)
   * @param power 0..1
   * @param colliders walls/blocks for reflection
   * @param previewOnly faint direction-only preview (keyboard aiming before charging)
   */
  show(ball: THREE.Vector3, angle: number, power: number, colliders: THREE.Object3D[]): void {
    this.root.visible = true;
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const ground = ball.clone().setY(ball.y - PHYSICS.ballRadius + 0.02);
    const len = 0.35 + power * 2.2;
    this.arrow.position.copy(ground).addScaledVector(dir, PHYSICS.ballRadius + 0.05);
    this.arrow.rotation.y = -angle;
    this.arrow.scale.set(len, 1, 1 + power * 0.6);
    this.arrowMat.color.copy(powerColor(power, this.palette));
    this.ticks.forEach((t, i) => {
      const k = (i + 1) / 5;
      t.visible = power >= k;
      t.position.copy(this.arrow.position).addScaledVector(dir, (0.35 + k * 2.2) * 0.78 * 0.98);
      t.position.y += 0.002;
      t.rotation.y = -angle;
    });

    // Dotted preview: estimated roll distance, capped, with a single reflection.
    const travel = Math.min(5.5, 0.6 + power * 6.5);
    const pts: THREE.Vector3[] = [];
    let origin = ball.clone();
    let d = dir.clone();
    let remaining = travel;
    for (let bounce = 0; bounce < 2 && remaining > 0; bounce++) {
      this.ray.set(origin, d);
      this.ray.far = remaining;
      const hit = this.ray.intersectObjects(colliders, false)[0];
      const segLen = hit ? Math.max(0, hit.distance - PHYSICS.ballRadius) : remaining;
      const step = 0.2;
      for (let s = bounce === 0 ? 0.5 : step; s <= segLen; s += step)
        pts.push(origin.clone().addScaledVector(d, s));
      if (!hit || !hit.face) break;
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      n.y = 0;
      if (n.lengthSq() < 1e-4) break;
      n.normalize();
      origin = origin.clone().addScaledVector(d, segLen);
      d = d.clone().reflect(n);
      d.y = 0;
      d.normalize();
      remaining -= segLen;
    }
    const m = new THREE.Matrix4();
    const count = Math.min(this.MAX_DOTS, pts.length);
    for (let i = 0; i < count; i++) {
      const p = pts[i];
      const fade = 1 - i / Math.max(1, count);
      m.makeScale(fade + 0.3, fade + 0.3, fade + 0.3).setPosition(p.x, p.y - PHYSICS.ballRadius * 0.7, p.z);
      this.dots.setMatrixAt(i, m);
    }
    this.dots.count = count;
    this.dots.instanceMatrix.needsUpdate = true;
  }
}
