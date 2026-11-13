import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

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

// The hole intro was reworked in v1.7.1: see v171.test.ts.

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
