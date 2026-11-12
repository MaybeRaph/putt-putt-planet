import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { COURSES, type Vec3 } from '@ppp/shared';
import { HoleIntro, INTRO, introDuration } from '../src/rendering/HoleIntro';

const json = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

describe('game version', () => {
  it('comes from the root package.json and the installer agrees with it', async () => {
    const root = json('../../package.json').version as string;
    expect(root).toMatch(/^\d+\.\d+\.\d+$/);
    // The desktop package.json names the installers; it must never drift from the game's version.
    expect(json('../../desktop/package.json').version).toBe(root);
    const lock = json('../../package-lock.json');
    expect(lock.version).toBe(root);
    expect(lock.packages[''].version).toBe(root);
    expect(lock.packages['desktop'].version).toBe(root);
    // The menu label is injected from that same file at build time.
    const cfg = (await import('../vite.config')).default as { define: Record<string, string> };
    expect(cfg.define.__APP_VERSION__).toBe(JSON.stringify(root));
  });

  it('is what the menu shows', async () => {
    vi.stubGlobal('__APP_VERSION__', '9.8.7');
    vi.resetModules();
    expect((await import('../src/version')).APP_VERSION).toBe('9.8.7');
    vi.unstubAllGlobals();
  });
});

describe('hole intro flyover', () => {
  const path: Vec3[] = [
    [0, 0, 0],
    [8, 0, 0],
    [8, 1, 9],
    [20, 1, 9],
  ];
  const gamePos = new THREE.Vector3(-4, 2.1, 0);
  const gameLook = new THREE.Vector3(0, 0.25, 0);
  const run = (intro: HoleIntro, cam: THREE.PerspectiveCamera, until: () => boolean, dt = 1 / 60) => {
    let t = 0;
    while (!until() && t < 20) {
      intro.update(dt, cam, gamePos, gameLook);
      t += dt;
    }
    return t;
  };

  it('lasts 3 to 5 seconds whatever the hole', () => {
    expect(introDuration(2)).toBe(INTRO.min);
    expect(introDuration(500)).toBe(INTRO.max);
    for (const c of COURSES)
      for (const h of c.holes) {
        const d = new HoleIntro(h.path).duration;
        expect(d).toBeGreaterThanOrEqual(3);
        expect(d).toBeLessThanOrEqual(5);
      }
  });

  it('flies from the tee to the cup, then ends exactly on the gameplay camera', () => {
    const cam = new THREE.PerspectiveCamera();
    const intro = new HoleIntro(path);
    intro.update(1 / 60, cam, gamePos, gameLook);
    // Starts over the tee end, looking down the hole.
    expect(intro.look.distanceTo(new THREE.Vector3(0, 0.3, 0))).toBeLessThan(4.5);
    expect(cam.position.y).toBeGreaterThan(3);
    // By the end of the outward leg the view has reached the cup.
    let closest = Infinity;
    let prev = cam.position.clone();
    let maxStep = 0;
    const t = run(intro, cam, () => {
      closest = Math.min(closest, intro.look.distanceTo(new THREE.Vector3(20, 1.3, 9)));
      maxStep = Math.max(maxStep, cam.position.distanceTo(prev));
      prev = cam.position.clone();
      return intro.done;
    });
    expect(closest).toBeLessThan(0.5);
    expect(t).toBeGreaterThan(intro.duration - 0.1);
    expect(t).toBeLessThan(intro.duration + 0.1);
    // No jump anywhere, including the hand-over: the camera never moves more than a metre a frame.
    expect(maxStep).toBeLessThan(1);
    expect(cam.position.distanceTo(gamePos)).toBeLessThan(1e-6);
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    expect(fwd.angleTo(gameLook.clone().sub(gamePos).normalize())).toBeLessThan(1e-4);
  });

  it('can be skipped at any moment and still lands on the gameplay camera without a cut', () => {
    for (const at of [0.05, 1.2, 3.3]) {
      const cam = new THREE.PerspectiveCamera();
      const intro = new HoleIntro(path);
      run(intro, cam, () => false, at / 10); // ten steps up to the skip
      const before = cam.position.clone();
      intro.skip();
      intro.skip(); // a second key press changes nothing
      intro.update(1 / 60, cam, gamePos, gameLook);
      expect(cam.position.distanceTo(before)).toBeLessThan(1.2);
      const t = run(intro, cam, () => intro.done);
      expect(t).toBeLessThanOrEqual(INTRO.skip + 0.05);
      expect(cam.position.distanceTo(gamePos)).toBeLessThan(1e-6);
    }
  });

  it('copes with degenerate paths', () => {
    const cam = new THREE.PerspectiveCamera();
    const intro = new HoleIntro([
      [1, 0, 1],
      [1, 0, 1],
    ]);
    run(intro, cam, () => intro.done);
    expect(Number.isFinite(cam.position.x + cam.position.y + cam.position.z)).toBe(true);
  });
});

describe('network client', () => {
  it('ignores a link that has been replaced', async () => {
    vi.stubGlobal('location', { search: '', protocol: 'http:', host: 'localhost' });
    vi.stubGlobal('window', globalThis);
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    const { NetClient } = await import('../src/net/NetClient');
    const { defaultProfile } = await import('@ppp/shared');
    type T = import('../src/net/NetClient').Transport & { sent: string[] };
    const mk = (): T => ({
      sent: [],
      onopen: null,
      onmessage: null,
      onclose: null,
      send(d) {
        this.sent.push(d);
      },
      close() {},
    });
    const net = new NetClient(() => defaultProfile('g_me', 'Me'));
    const first = mk();
    net.useTarget({ kind: 'loopback', open: () => first });
    void net.connect();
    first.onopen!();
    expect(net.status).toBe('online');
    // The player switches to a second link; the first one reports "closed" a moment later.
    const second = mk();
    net.useTarget({ kind: 'loopback', open: () => second });
    void net.connect();
    second.onopen!();
    expect(net.status).toBe('online');
    first.onclose?.();
    first.onmessage?.(JSON.stringify({ t: 'left' }));
    expect(net.status).toBe('online');
    net.send({ t: 'ready', ready: true });
    expect(second.sent.map((d) => JSON.parse(d).t)).toEqual(['hello', 'ready']);
    expect(first.sent.map((d) => JSON.parse(d).t)).toEqual(['hello']);
    // The live link closing is still noticed.
    second.onclose!();
    expect(net.status).toBe('offline');
    net.disconnect();
    vi.unstubAllGlobals();
  });
});
