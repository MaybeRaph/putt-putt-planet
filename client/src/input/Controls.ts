import * as THREE from 'three';
import { PHYSICS } from '@ppp/shared';
import type { CameraRig } from '../rendering/CameraRig';
import type { Action, Settings } from '../core/settings';

export interface ControlsHost {
  canAim(): boolean;
  ballPos(): THREE.Vector3 | null;
  onShoot(angle: number, power: number): void;
  onAction(action: HostAction): void;
  onAimStart?(): void;
}

export type HostAction = Action | 'pause' | 'scoreboardUp';

type DragMode = 'none' | 'aim' | 'orbit';

/**
 * Unified input: pointer slingshot aiming (mouse + touch), orbit/zoom gestures, keyboard
 * (rotate aim, hold to charge with a ping-pong meter) and gamepad. Aim direction follows the
 * camera yaw unless the player is dragging the slingshot.
 */
export class Controls {
  aimAngle = 0;
  power = 0;
  aiming = false;
  source: 'pointer' | 'keys' | 'pad' | null = null;
  private drag: DragMode = 'none';
  private dragId = -1;
  private dragStart = new THREE.Vector2();
  private last = new THREE.Vector2();
  private readonly pointers = new Map<number, THREE.Vector2>();
  private pinchDist = 0;
  private charging = false;
  private chargeT = 0;
  private readonly down = new Set<string>();
  private readonly ray = new THREE.Raycaster();
  private padShootHeld = false;
  private padButtons: boolean[] = [];
  enabled = true;
  private readonly unsub: (() => void)[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly rig: CameraRig,
    private readonly settings: Settings,
    private readonly host: ControlsHost,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement | Window,
      ev: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      el.addEventListener(ev, fn as EventListener, opts);
      this.unsub.push(() => el.removeEventListener(ev, fn as EventListener));
    };
    on(canvas, 'pointerdown', (e) => this.onDown(e));
    on(window, 'pointermove', (e) => this.onMove(e as PointerEvent));
    on(window, 'pointerup', (e) => this.onUp(e as PointerEvent));
    on(window, 'pointercancel', (e) => this.onUp(e as PointerEvent, true));
    on(
      canvas,
      'wheel',
      (e) => {
        e.preventDefault();
        this.rig.zoom(Math.exp((e as WheelEvent).deltaY * 0.0012));
      },
      { passive: false },
    );
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    on(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    on(window, 'blur', () => {
      this.down.clear();
      this.cancelAim();
    });
  }

  private screenDistToBall(x: number, y: number): number {
    const b = this.host.ballPos();
    if (!b) return Infinity;
    const p = b.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    const sx = (p.x * 0.5 + 0.5) * r.width + r.left;
    const sy = (-p.y * 0.5 + 0.5) * r.height + r.top;
    return Math.hypot(x - sx, y - sy);
  }

  private groundPoint(x: number, y: number, height: number): THREE.Vector3 | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height);
    const hit = new THREE.Vector3();
    return this.ray.ray.intersectPlane(plane, hit) ? hit : null;
  }

  private onDown(e: PointerEvent): void {
    if (!this.enabled) return;
    this.pointers.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY));
    if (this.pointers.size === 2) {
      // second finger: switch to pinch/orbit
      this.cancelAim();
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = a.distanceTo(b);
      this.drag = 'orbit';
      this.last.set((a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (this.drag !== 'none') return;
    const nearBall =
      this.screenDistToBall(e.clientX, e.clientY) < Math.max(80, Math.min(innerWidth, innerHeight) * 0.12);
    if (e.button === 0 && nearBall && this.host.canAim()) {
      this.drag = 'aim';
      this.aiming = true;
      this.source = 'pointer';
      this.power = 0;
      this.host.onAimStart?.();
    } else {
      this.drag = 'orbit';
    }
    this.dragId = e.pointerId;
    this.dragStart.set(e.clientX, e.clientY);
    this.last.set(e.clientX, e.clientY);
    this.canvas.setPointerCapture?.(e.pointerId);
  }

  private onMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (p) p.set(e.clientX, e.clientY);
    if (this.pointers.size === 2 && this.drag === 'orbit') {
      const [a, b] = [...this.pointers.values()];
      const d = a.distanceTo(b);
      if (this.pinchDist > 0) this.rig.zoom(this.pinchDist / d);
      this.pinchDist = d;
      const mid = new THREE.Vector2((a.x + b.x) / 2, (a.y + b.y) / 2);
      this.orbitBy(mid.x - this.last.x, mid.y - this.last.y);
      this.last.copy(mid);
      return;
    }
    if (e.pointerId !== this.dragId) return;
    if (this.drag === 'orbit') {
      this.orbitBy(e.clientX - this.last.x, e.clientY - this.last.y);
      this.last.set(e.clientX, e.clientY);
    } else if (this.drag === 'aim') {
      const ball = this.host.ballPos();
      if (!ball) return;
      const g = this.groundPoint(e.clientX, e.clientY, ball.y);
      const screenDist = Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y);
      const ref = Math.min(innerWidth, innerHeight) * 0.34;
      this.power = THREE.MathUtils.clamp((screenDist - 6) / ref, 0, 1);
      if (g) {
        const dx = ball.x - g.x,
          dz = ball.z - g.z;
        if (Math.hypot(dx, dz) > 0.05) this.aimAngle = Math.atan2(dz, dx);
      } else {
        // pointer above the horizon: use screen-space pull projected with camera yaw
        const sx = this.dragStart.x - e.clientX,
          sy = this.dragStart.y - e.clientY;
        this.aimAngle = this.rig.yaw + Math.atan2(sx, -sy);
      }
    }
  }

  private orbitBy(dx: number, dy: number): void {
    const s = 0.006 * this.settings.camSensitivity;
    this.rig.orbit(dx * s, dy * s * (this.settings.invertY ? -1 : 1));
    if (!this.aiming) this.aimAngle = this.rig.yaw;
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDist = 0;
    if (e.pointerId !== this.dragId) {
      if (this.pointers.size === 0) this.drag = 'none';
      return;
    }
    if (this.drag === 'aim') {
      if (!cancelled && this.power >= PHYSICS.minPower && this.host.canAim())
        this.host.onShoot(this.aimAngle, this.power);
      this.cancelAim();
    }
    this.drag = 'none';
    this.dragId = -1;
  }

  cancelAim(): void {
    this.aiming = false;
    this.charging = false;
    this.power = 0;
    if (this.drag === 'aim') this.drag = 'none';
    this.source = null;
  }

  private isTyping(): boolean {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  }

  private actionFor(code: string): Action | null {
    for (const [action, key] of Object.entries(this.settings.keys)) if (key === code) return action as Action;
    return null;
  }

  private onKey(e: KeyboardEvent, isDown: boolean): void {
    if (this.isTyping()) return;
    if (!this.enabled) {
      // While paused only Esc works (to resume).
      if (isDown && e.code === 'Escape') this.host.onAction('pause');
      return;
    }
    const action = this.actionFor(e.code);
    if (isDown) this.down.add(e.code);
    else this.down.delete(e.code);
    if (!action) {
      if (isDown && e.code === 'Escape') {
        if (this.aiming) this.cancelAim();
        else this.host.onAction('pause');
      }
      return;
    }
    if (action === 'shoot' || action === 'scoreboard' || action === 'chat') e.preventDefault();
    if (action === 'shoot') {
      if (isDown && !e.repeat && !this.charging && this.host.canAim()) {
        this.charging = true;
        this.chargeT = 0;
        this.aiming = true;
        this.source = 'keys';
        this.host.onAimStart?.();
      } else if (!isDown && this.charging) {
        if (this.power >= PHYSICS.minPower && this.host.canAim())
          this.host.onShoot(this.aimAngle, this.power);
        this.cancelAim();
      }
      return;
    }
    if (isDown && !e.repeat && ['overview', 'rescue', 'emote', 'chat', 'debug'].includes(action)) {
      e.preventDefault();
      this.host.onAction(action);
    }
    if (action === 'scoreboard') this.host.onAction(isDown ? 'scoreboard' : 'scoreboardUp');
  }

  private held(a: Action): boolean {
    return this.down.has(this.settings.keys[a]);
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const fine = this.down.has('ShiftLeft') || this.down.has('ShiftRight');
    const aimSpeed = (fine ? 0.35 : 1.5) * dt;
    let turn = 0;
    if (this.held('aimLeft')) turn -= 1;
    if (this.held('aimRight')) turn += 1;
    if (this.held('camLeft')) this.rig.orbit(-1.8 * dt, 0);
    if (this.held('camRight')) this.rig.orbit(1.8 * dt, 0);
    if (this.held('zoomIn')) this.rig.zoom(Math.exp(-dt * 1.5));
    if (this.held('zoomOut')) this.rig.zoom(Math.exp(dt * 1.5));

    this.pollGamepad(dt, (t) => (turn += t));

    if (turn !== 0) this.rig.orbit(turn * aimSpeed, 0);
    if (this.drag !== 'aim') this.aimAngle = this.rig.yaw;

    if (this.charging || this.padShootHeld) {
      // ping-pong meter: 0 -> 1 -> 0 over 2.4s
      this.chargeT += dt;
      const ph = (this.chargeT / 1.2) % 2;
      this.power = ph < 1 ? ph : 2 - ph;
      if (!this.host.canAim()) this.cancelAim();
    }
  }

  private pollGamepad(dt: number, turn: (t: number) => void): void {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((p) => p && p.connected);
    if (!pad) return;
    const dead = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    const lx = dead(pad.axes[0] ?? 0);
    const rx = dead(pad.axes[2] ?? 0),
      ry = dead(pad.axes[3] ?? 0);
    if (lx) turn(lx);
    if (rx || ry) this.rig.orbit(rx * 2 * dt, ry * 1.5 * dt * (this.settings.invertY ? -1 : 1));
    const btn = (i: number) => !!pad.buttons[i]?.pressed;
    const pressed = (i: number) => btn(i) && !this.padButtons[i];
    if (btn(4)) this.rig.zoom(Math.exp(-dt * 1.5));
    if (btn(5)) this.rig.zoom(Math.exp(dt * 1.5));
    if (pressed(3)) this.host.onAction('overview');
    if (pressed(2)) this.host.onAction('rescue');
    if (pressed(9)) this.host.onAction('pause');
    if (pressed(1)) this.cancelAim();
    if (btn(0) && !this.padShootHeld && !this.padButtons[0] && this.host.canAim()) {
      this.padShootHeld = true;
      this.aiming = true;
      this.source = 'pad';
      this.chargeT = 0;
      this.host.onAimStart?.();
    } else if (!btn(0) && this.padShootHeld) {
      this.padShootHeld = false;
      if (this.aiming && this.power >= PHYSICS.minPower && this.host.canAim())
        this.host.onShoot(this.aimAngle, this.power);
      this.cancelAim();
    }
    if (!this.aiming) this.padShootHeld = false;
    this.padButtons = pad.buttons.map((b) => b.pressed);
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
  }
}
