import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** A pointer event with just what Controls reads (Node has no PointerEvent). */
function pointer(type: string, x: number, y: number, button: number, buttons: number): Event {
  return Object.assign(new Event(type), {
    pointerId: 1,
    pointerType: 'mouse',
    clientX: x,
    clientY: y,
    button,
    buttons,
  });
}
function key(type: string, code: string): Event {
  return Object.assign(new Event(type), { code, key: code === 'Space' ? ' ' : code, repeat: false });
}

/** Controls on a fake 800x600 canvas, the camera looking down at a ball in the middle of it. */
async function setup() {
  const win = Object.assign(new EventTarget(), { innerWidth: 800, innerHeight: 600 });
  vi.stubGlobal('window', win);
  vi.stubGlobal('innerWidth', 800);
  vi.stubGlobal('innerHeight', 600);
  vi.stubGlobal('document', { activeElement: null });
  vi.stubGlobal('navigator', { getGamepads: () => [] });
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    setPointerCapture: () => {},
  });
  const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 100);
  camera.position.set(0, 4, 4);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const rig = { yaw: 0, orbit: vi.fn(), zoom: vi.fn() };
  const { DEFAULT_SETTINGS } = await import('../src/core/settings');
  const shots: number[] = [];
  const cancels: number[] = [];
  const { Controls } = await import('../src/input/Controls');
  const c = new Controls(
    canvas as unknown as HTMLCanvasElement,
    camera,
    rig as never,
    structuredClone(DEFAULT_SETTINGS),
    {
      canAim: () => true,
      ballPos: () => new THREE.Vector3(0, 0, 0),
      onShoot: (_a, p) => shots.push(p),
      onAction: () => {},
      onAimCancel: () => cancels.push(1),
    },
  );
  // The ball is at the middle of the canvas.
  return { c, canvas, win, rig, shots, cancels, bx: 400, by: 300 };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('v1.11 right click cancels a shot', () => {
  it('a normal left-drag from the ball still shoots', async () => {
    const { c, canvas, win, shots } = await setup();
    canvas.dispatchEvent(pointer('pointerdown', 400, 300, 0, 1));
    win.dispatchEvent(pointer('pointermove', 400, 420, -1, 1));
    expect(c.aiming).toBe(true);
    expect(c.power).toBeGreaterThan(0.3);
    win.dispatchEvent(pointer('pointerup', 400, 420, 0, 0));
    expect(shots).toHaveLength(1);
  });

  it('pressing the right button during a left-drag aim cancels it, and letting go shoots nothing', async () => {
    const { c, canvas, win, shots, cancels, rig } = await setup();
    canvas.dispatchEvent(pointer('pointerdown', 400, 300, 0, 1));
    win.dispatchEvent(pointer('pointermove', 400, 420, -1, 1));
    expect(c.aiming).toBe(true);
    // Browsers report the second button of a chord as a move with both buttons held.
    win.dispatchEvent(pointer('pointermove', 400, 422, 2, 3));
    expect(c.aiming).toBe(false);
    expect(cancels).toHaveLength(1);
    // Moving on and letting go does nothing: no shot, no camera swing.
    win.dispatchEvent(pointer('pointermove', 460, 440, -1, 3));
    win.dispatchEvent(pointer('pointerup', 460, 440, 0, 0));
    expect(shots).toHaveLength(0);
    expect(rig.orbit).not.toHaveBeenCalled();
  });

  it('a right click while charging with Space cancels instead of orbiting', async () => {
    const { c, canvas, win, shots, cancels, rig } = await setup();
    win.dispatchEvent(key('keydown', 'Space'));
    expect(c.aiming).toBe(true);
    canvas.dispatchEvent(pointer('pointerdown', 700, 100, 2, 2));
    expect(c.aiming).toBe(false);
    expect(cancels).toHaveLength(1);
    win.dispatchEvent(pointer('pointermove', 740, 120, -1, 2));
    win.dispatchEvent(pointer('pointerup', 740, 120, 2, 0));
    win.dispatchEvent(key('keyup', 'Space'));
    expect(shots).toHaveLength(0);
    expect(rig.orbit).not.toHaveBeenCalled();
  });

  it('right-drag still orbits the camera when not aiming', async () => {
    const { c, canvas, win, rig, cancels } = await setup();
    canvas.dispatchEvent(pointer('pointerdown', 700, 100, 2, 2));
    win.dispatchEvent(pointer('pointermove', 760, 110, -1, 2));
    win.dispatchEvent(pointer('pointerup', 760, 110, 2, 0));
    expect(rig.orbit).toHaveBeenCalled();
    expect(cancels).toHaveLength(0);
    expect(c.aiming).toBe(false);
  });
});
