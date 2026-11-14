import * as THREE from 'three';
import { PHYSICS, type Loadout } from '@ppp/shared';
import { BallView, buildPutter } from '../rendering/BallView';
import { Particles } from '../rendering/Particles';
import { flat, toon } from '../rendering/materials';

const R = PHYSICS.ballRadius;
const CONFETTI = ['#ff5fa2', '#ffd23f', '#34c3ff', '#6ad04a', '#8a5cff', '#ffffff'];

/**
 * The main menu's "character": your own ball (skin + hat) standing on a little putting-green
 * pedestal with your putter leaning beside it, like a party-game lobby shows off your avatar.
 * It idles with small hops, turns to look at the pointer, spins when dragged and plays its
 * victory animation (with confetti) when poked. Owns its own transparent WebGL canvas so the
 * course backdrop shows through; dispose() frees it when the menu closes.
 */
export class MenuHero {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.05, 40);
  /** Turns as a whole (ball + putter) to look at the pointer / follow drags. */
  private readonly char = new THREE.Group();
  private readonly pedestal = new THREE.Group();
  private readonly flag: THREE.Mesh;
  private ball: BallView | null = null;
  private putter: THREE.Group | null = null;
  private readonly shadow: THREE.Mesh;
  private readonly particles = new Particles();
  private readonly ro: ResizeObserver;
  private raf = 0;
  private t = 0;
  private last = performance.now();
  private disposed = false;
  /** Yaw of the character, its drag spin velocity and the pointer-follow target. */
  private yaw = -0.35;
  private spin = 0;
  private lookYaw = -0.35;
  private drag: { x: number; moved: number } | null = null;
  private nextHop = 1.6;
  private hopT = -1;
  reducedMotion = false;
  /** Called when the ball is poked (click/tap without dragging). */
  onPoke: (() => void) | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hero-canvas';
    this.gl = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.gl.setPixelRatio(Math.min(2, devicePixelRatio));
    this.gl.setClearColor(0x000000, 0);
    this.gl.shadowMap.enabled = true;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.1;

    // Warm key, cool fill, and a pink rim from behind so the ball pops off any backdrop.
    this.scene.add(new THREE.HemisphereLight(0xfff6e8, 0x7a9a6a, 1.5));
    const sun = new THREE.DirectionalLight(0xfff0d6, 2.8);
    sun.position.set(1.6, 3.2, 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -1.2;
    sun.shadow.camera.right = sun.shadow.camera.top = 1.2;
    sun.shadow.radius = 4;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xff8fd0, 1.6);
    rim.position.set(-1.8, 1.2, -2.4);
    this.scene.add(rim);

    // Pedestal: a chunky faceted turf disc on a dirt plug, with a cup and a waving flag.
    const turf = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.64, 0.09, 12), flat('#6ad04a'));
    turf.position.y = -0.045;
    turf.receiveShadow = true;
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.645, 0.6, 0.05, 12), flat('#4fae3a'));
    lip.position.y = -0.11;
    const dirt = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.42, 0.34, 12), flat('#b9773f'));
    dirt.position.y = -0.3;
    const dirt2 = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.22, 0.2, 12), flat('#93582c'));
    dirt2.position.y = -0.57;
    const cup = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), toon('#1f2a1a'));
    cup.rotation.x = -Math.PI / 2;
    cup.position.set(-0.32, 0.002, -0.22);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.62, 6), toon('#f4f4f4'));
    pole.position.set(-0.32, 0.31, -0.22);
    pole.castShadow = true;
    const cloth = new THREE.PlaneGeometry(0.2, 0.13, 6, 2);
    cloth.translate(0.1, 0, 0);
    this.flag = new THREE.Mesh(
      cloth,
      new THREE.MeshStandardMaterial({ color: '#ff5fa2', roughness: 0.8, side: THREE.DoubleSide }),
    );
    this.flag.position.set(-0.32, 0.55, -0.22);
    this.flag.castShadow = true;
    this.pedestal.add(turf, lip, dirt, dirt2, cup, pole, this.flag);
    this.pedestal.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o !== turf) (o as THREE.Mesh).castShadow = true;
    });

    // Soft contact shadow under the ball (shrinks as it hops).
    const sc = document.createElement('canvas');
    sc.width = sc.height = 64;
    const cx = sc.getContext('2d')!;
    const grd = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(20,30,10,0.45)');
    grd.addColorStop(1, 'rgba(20,30,10,0)');
    cx.fillStyle = grd;
    cx.fillRect(0, 0, 64, 64);
    const shTex = new THREE.CanvasTexture(sc);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.003;

    this.scene.add(this.pedestal, this.char, this.shadow, this.particles.points);

    this.canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas);
    this.loop();
  }

  setLoadout(l: Loadout): void {
    this.ball?.dispose();
    this.putter?.removeFromParent();
    this.ball = new BallView('hero', l, false);
    this.char.add(this.ball.root);
    // The full-size putter is ~7 ball radii tall; at half size it reads as the ball's club.
    this.putter = buildPutter(l.putter);
    this.putter.scale.setScalar(0.5);
    this.putter.position.set(R * 1.35, 0, 0.02);
    this.putter.rotation.set(0.05, -0.5, -0.32);
    this.char.add(this.putter);
    this.ball.update(new THREE.Vector3(0, R, 0), new THREE.Vector3(), 0, false, true);
    this.frame(0);
  }

  /** Poke: play the equipped victory animation with a burst of confetti. */
  poke(): void {
    if (!this.ball) return;
    this.ball.celebrate();
    this.particles.burst(new THREE.Vector3(0, R * 2, 0), {
      count: 70,
      colors: CONFETTI,
      speed: 1.6,
      spread: 0.5,
      up: 1.5,
      life: 1.2,
      size: 0.035,
      gravity: -2.6,
    });
    this.onPoke?.();
  }

  private readonly onDown = (e: PointerEvent): void => {
    this.drag = { x: e.clientX, moved: 0 };
    this.canvas.setPointerCapture?.(e.pointerId);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (this.drag) {
      const dx = e.clientX - this.drag.x;
      this.drag.x = e.clientX;
      this.drag.moved += Math.abs(dx);
      this.yaw += dx * 0.012;
      this.spin = dx * 0.6;
      this.lookYaw = this.yaw;
      return;
    }
    // Look towards the pointer (only roughly: a gentle head turn, not a full spin).
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return;
    const nx = ((e.clientX - (r.left + r.width / 2)) / Math.max(320, window.innerWidth / 2)) * 1.0;
    this.lookYaw = Math.max(-1, Math.min(1, nx)) * 0.9 - 0.15;
  };

  private readonly onUp = (): void => {
    if (!this.drag) return;
    const tap = this.drag.moved < 6;
    this.drag = null;
    if (tap) this.poke();
  };

  private resize(): void {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the pedestal in frame on tall/narrow stages by backing the camera off.
    const fit = Math.max(1, 0.95 / this.camera.aspect);
    this.camera.position.set(0, 0.62 * fit + 0.2, 2.75 * fit);
    this.camera.lookAt(0, 0.16, 0);
    this.camera.updateProjectionMatrix();
    this.frame(0);
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
    const calm = this.reducedMotion;
    // Turning: drag spin coasts to a stop, then the ball eases back to look at the pointer.
    if (!this.drag) {
      if (Math.abs(this.spin) > 0.01) {
        this.yaw += this.spin * dt;
        this.spin *= Math.pow(0.04, dt);
        this.lookYaw = this.yaw;
      } else {
        const d = Math.atan2(Math.sin(this.lookYaw - this.yaw), Math.cos(this.lookYaw - this.yaw));
        this.yaw += d * Math.min(1, dt * 3);
      }
    }
    this.char.rotation.y = this.yaw;

    // Idle: a little hop every few seconds (squash on landing), plus a slow breathing sway.
    let y = 0;
    if (!calm) {
      this.nextHop -= dt;
      if (this.nextHop <= 0 && this.hopT < 0) {
        this.hopT = 0;
        this.nextHop = 2.4 + Math.random() * 2.2;
      }
      if (this.hopT >= 0) {
        this.hopT += dt;
        const k = this.hopT / 0.42;
        if (k >= 1) {
          this.hopT = -1;
          this.ball?.impact(0.55);
        } else y = Math.sin(k * Math.PI) * 0.14;
      }
      this.char.rotation.z = Math.sin(this.t * 1.7) * 0.03;
    }
    if (this.ball) this.ball.update(new THREE.Vector3(0, R + y, 0), new THREE.Vector3(), dt, false, calm);
    if (this.putter) this.putter.rotation.z = -0.32 + (calm ? 0 : Math.sin(this.t * 1.7 + 0.6) * 0.04);
    // The shadow stays on the turf, shrinking while the ball is up.
    const lift = this.ball ? Math.max(0, this.ball.root.position.y - R) : 0;
    this.shadow.scale.setScalar(Math.max(0.35, 1 - lift * 1.6));
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.25, 1 - lift * 1.4);

    // Flag ripple.
    if (!calm) {
      const pos = this.flag.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        pos.setZ(i, Math.sin(this.t * 5 - x * 30) * 0.025 * (x / 0.2));
      }
      pos.needsUpdate = true;
    }
    this.particles.update(dt);
    this.gl.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.ball?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.parent === this.pedestal) m.geometry.dispose();
    });
    (this.flag.material as THREE.Material).dispose();
    this.shadow.geometry.dispose();
    const sm = this.shadow.material as THREE.MeshBasicMaterial;
    sm.map?.dispose();
    sm.dispose();
    this.particles.points.geometry.dispose();
    (this.particles.points.material as THREE.Material).dispose();
    this.gl.dispose();
    this.gl.forceContextLoss();
  }
}
