import * as THREE from 'three';
import type { Course } from '@ppp/shared';
import { CourseView } from './CourseView';
import type { Renderer } from './Renderer';

/** Slowly orbiting view of a hole behind the menus. */
export class MenuBackdrop {
  private view: CourseView | null = null;
  private t = 0;
  private center = new THREE.Vector3();
  private radius = 10;

  constructor(private readonly renderer: Renderer) {}

  show(course: Course, holeIndex: number): void {
    this.view?.dispose();
    const hole = course.holes[holeIndex % course.holes.length];
    console.info(`[boot] backdrop ${course.id} hole ${holeIndex + 1}`);
    this.view = new CourseView(hole, course.theme, { decorDensity: this.renderer.quality === 'low' ? 0.5 : 0.8, grass: { low: 0, medium: 8000, high: 20000, ultra: 30000 }[this.renderer.quality] });
    this.renderer.scene.add(this.view.root);
    this.renderer.applyTheme(course.theme);
    this.renderer.fitShadow(this.view.bounds.min, this.view.bounds.max);
    this.center.copy(this.view.bounds.min).add(this.view.bounds.max).multiplyScalar(0.5);
    const size = this.view.bounds.max.clone().sub(this.view.bounds.min);
    this.radius = Math.max(size.x, size.z) * 0.6 + 6;
  }

  update(dt: number): void {
    if (!this.view) return;
    this.t += dt;
    const a = this.t * 0.06;
    const cam = this.renderer.camera;
    cam.position.set(
      this.center.x + Math.cos(a) * this.radius,
      this.center.y + this.radius * 0.45,
      this.center.z + Math.sin(a) * this.radius,
    );
    cam.lookAt(this.center);
    this.view.update(this.t, dt, []);
  }

  dispose(): void {
    this.view?.dispose();
    this.view = null;
  }
}
