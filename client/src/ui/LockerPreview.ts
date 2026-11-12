import * as THREE from 'three';
import type { CosmeticSlot, Loadout } from '@ppp/shared';
import { BallView } from '../rendering/BallView';
import { Particles } from '../rendering/Particles';
import { checkerMaterial } from '../rendering/materials';

const HIO_COLORS: Record<string, string[]> = {
  'hio.confetti': ['#ff5252', '#ffeb3b', '#40c4ff', '#69f0ae', '#e040fb'],
  'hio.fireworks': ['#ff5252', '#ffeb3b', '#ffffff'],
  'hio.hearts': ['#ff4081', '#ff80ab'],
  'hio.stars': ['#ffd740', '#ffffff'],
  'hio.bubbles': ['#80d8ff', '#e1f5fe'],
};

/**
 * Turntable renderer for the locker. Staging depends on the slot being browsed:
 *  - ball / trail: the ball rolls in a circle so skin and trail are visible
 *  - hat / putter: close-up turntable with the putter shown
 *  - victory / hio: the ball sits still and the effect plays (and can be replayed)
 * Owns its own WebGL context; dispose() frees it when the locker closes.
 */
export class LockerPreview {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.02, 50);
  private ball: BallView | null = null;
  private loadout: Loadout | null = null;
  private readonly particles = new Particles();
  private raf = 0;
  private t = 0;
  private last = performance.now();
  private readonly floor: THREE.Mesh;
  private readonly ro: ResizeObserver;
  private slot: CosmeticSlot = 'ball';
  private disposed = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'locker-canvas';
    this.gl = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.gl.setPixelRatio(Math.min(2, devicePixelRatio));
    this.gl.shadowMap.enabled = true;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa77, 1.6));
    const sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
    sun.position.set(1.5, 3, 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -1.5;
    sun.shadow.camera.right = sun.shadow.camera.top = 1.5;
    this.scene.add(sun);
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 48), checkerMaterial('#5fbf4f', '#4fae42', 0.2));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor, this.particles.points);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas);
    this.loop();
  }

  private resize(): void {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.frame(0);
  }

  setLoadout(l: Loadout): void {
    this.loadout = l;
    this.ball?.dispose();
    this.ball = new BallView('preview', l, false);
    this.scene.add(this.ball.root, this.ball.trailMesh);
    this.frame(0);
  }

  /** Change staging for the slot being browsed. */
  focus(slot: CosmeticSlot): void {
    this.slot = slot;
    this.t = 0;
    this.frame(0);
  }

  /** Something was equipped / tried on: show it off. */
  play(slot: CosmeticSlot, id: string): void {
    this.focus(slot);
    if (slot === 'victory') this.ball?.celebrate();
    if (slot === 'hio') this.holeInOne(id);
  }

  replay(): void {
    if (!this.loadout) return;
    if (this.slot === 'hio') this.holeInOne(this.loadout.hio);
    else this.ball?.celebrate();
  }

  private holeInOne(kind: string): void {
    const at = new THREE.Vector3(0, 0.25, 0);
    this.particles.burst(at, {
      count: 80,
      colors: HIO_COLORS[kind] ?? HIO_COLORS['hio.confetti'],
      speed: 1.8,
      spread: 0.5,
      up: 1.4,
      life: 1.3,
      size: 0.04,
      gravity: kind === 'hio.bubbles' ? 0.6 : -2.5,
    });
  }

  private readonly loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.frame(dt);
  };

  private frame(dt: number): void {
    if (this.disposed) return;
    this.t += dt;
    const rolling = this.slot === 'ball' || this.slot === 'trail';
    const closeUp = this.slot === 'hat' || this.slot === 'putter';
    if (this.ball) {
      if (rolling) {
        const a = this.t * 1.3;
        const r = 0.34;
        const pos = new THREE.Vector3(Math.cos(a) * r, 0.16, Math.sin(a) * r);
        const vel = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(r * 1.3);
        this.ball.showPutter(false);
        this.ball.update(pos, vel, dt, false, false);
      } else {
        this.ball.update(new THREE.Vector3(0, 0.16, 0), new THREE.Vector3(), dt, false, false);
        this.ball.showPutter(this.slot === 'putter', Math.PI / 2 + Math.sin(this.t * 0.6) * 0.4, 0.4);
      }
    }
    // Camera: wide orbit for rolling, close turntable for hats/putters.
    const ca = this.t * 0.35;
    if (closeUp) {
      const d = this.slot === 'putter' ? 1.35 : 1.0;
      this.camera.position.set(Math.cos(ca) * d, this.slot === 'putter' ? 0.6 : 0.42, Math.sin(ca) * d);
      this.camera.lookAt(0, this.slot === 'putter' ? 0.32 : 0.25, 0);
    } else {
      this.camera.position.set(0, 0.62, 1.25);
      this.camera.lookAt(0, 0.12, 0);
    }
    this.particles.update(dt);
    this.gl.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.ball?.dispose();
    this.floor.geometry.dispose();
    this.particles.points.geometry.dispose();
    (this.particles.points.material as THREE.Material).dispose();
    this.gl.dispose();
    this.gl.forceContextLoss();
  }
}
