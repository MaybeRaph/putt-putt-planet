import { afterEach, describe, expect, it, vi } from 'vitest';
import { RELINK_MS, keepKnocking, relinkOnDrop } from '../src/net/p2p';

/** Just enough of RTCPeerConnection for the knocking code: states, events, added candidates. */
class FakePc extends EventTarget {
  connectionState: RTCPeerConnectionState = 'connected';
  iceConnectionState: RTCIceConnectionState = 'connected';
  added: string[] = [];
  addIceCandidate(c: RTCIceCandidateInit): Promise<void> {
    this.added.push(c.candidate ?? '');
    return Promise.resolve();
  }
  getStats(): Promise<RTCStatsReport> {
    return Promise.resolve(new Map() as unknown as RTCStatsReport);
  }
  set(state: RTCPeerConnectionState, ice: RTCIceConnectionState = state as RTCIceConnectionState): void {
    this.connectionState = state;
    this.iceConnectionState = ice;
    this.dispatchEvent(new Event('connectionstatechange'));
  }
}
const asPc = (f: FakePc) => f as unknown as RTCPeerConnection;
const CANDS = [
  'candidate:1 1 udp 2130706431 192.168.1.20 58357 typ host generation 0',
  'candidate:2 1 udp 1694498559 203.0.113.7 1516 typ srflx raddr 0.0.0.0 rport 0 generation 0',
];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('v1.8.8 direct links come back after their route dies', () => {
  it('does nothing while the link is healthy', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const pc = new FakePc();
    relinkOnDrop(asPc(pc), CANDS, '0', 'test');
    vi.advanceTimersByTime(30_000);
    expect(pc.added).toEqual([]);
  });

  it('re-offers the peer addresses as fresh variants when the link drops, and stops once it is back', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pc = new FakePc();
    // What the browser already has from connecting: the originals and the early variants.
    const known = new Set<string>();
    void keepKnocking(asPc(pc), CANDS, '0', 1).then(() => undefined);
    pc.added.forEach((c) => known.add(c));
    pc.added = [];

    relinkOnDrop(asPc(pc), CANDS, '0', 'test');
    pc.set('disconnected');
    expect(pc.added).toHaveLength(CANDS.length); // knocked at once
    vi.advanceTimersByTime(2000);
    expect(pc.added).toHaveLength(CANDS.length * 2); // and again while still down
    // Every one is new to the browser (a repeat would be ignored and restart nothing).
    for (const c of pc.added) expect(known.has(c)).toBe(false);
    expect(new Set(pc.added).size).toBe(pc.added.length);
    // Same addresses and ports, only the foundation and priority differ.
    expect(pc.added[0]).toContain('192.168.1.20 58357 typ host');
    expect(pc.added[1]).toContain('203.0.113.7 1516 typ srflx');

    pc.set('connected');
    const after = pc.added.length;
    vi.advanceTimersByTime(10_000);
    expect(pc.added).toHaveLength(after);
  });

  it('tries again on a second drop, with variants it has not used yet', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pc = new FakePc();
    relinkOnDrop(asPc(pc), CANDS, '0', 'test');
    pc.set('failed');
    const first = [...pc.added];
    pc.set('connected');
    vi.advanceTimersByTime(2000); // the first knock settles
    pc.set('disconnected');
    const second = pc.added.slice(first.length);
    expect(second).toHaveLength(CANDS.length);
    for (const c of second) expect(first).not.toContain(c);
  });

  it('gives up after RELINK_MS, and leaves a closed link alone', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pc = new FakePc();
    const stop = relinkOnDrop(asPc(pc), CANDS, '0', 'test');
    pc.set('failed');
    vi.advanceTimersByTime(RELINK_MS + 5000);
    const n = pc.added.length;
    vi.advanceTimersByTime(20_000);
    expect(pc.added).toHaveLength(n);
    stop();
    pc.set('disconnected');
    expect(pc.added).toHaveLength(n);
    const closed = new FakePc();
    relinkOnDrop(asPc(closed), CANDS, '0', 'test');
    closed.set('closed');
    expect(closed.added).toEqual([]);
  });
});

describe('v1.8.8 a silent host is noticed', () => {
  it('measures how long the host has been silent on the current link', async () => {
    vi.stubGlobal('location', { search: '', protocol: 'http:', host: 'localhost' });
    vi.stubGlobal('window', globalThis);
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { NetClient } = await import('../src/net/NetClient');
    const { defaultProfile } = await import('@ppp/shared');
    const tr: import('../src/net/NetClient').Transport = {
      onopen: null,
      onmessage: null,
      onclose: null,
      send() {},
      close() {},
    };
    const net = new NetClient(() => defaultProfile('g_me', 'Me'));
    expect(net.silentMs).toBe(0); // not online: nothing to be silent about
    net.useTarget({ kind: 'loopback', open: () => tr });
    void net.connect();
    tr.onopen!();
    now += 3000;
    expect(net.silentMs).toBe(3000);
    tr.onmessage!(JSON.stringify({ t: 'pong', t0: 1 }));
    expect(net.silentMs).toBe(0);
    now += 9000;
    expect(net.silentMs).toBe(9000);
    // Anything that arrives counts, even a message this version can't read.
    tr.onmessage!('{"t":"fromTheFuture"}');
    expect(net.silentMs).toBe(0);
    net.disconnect();
    expect(net.silentMs).toBe(0);
    vi.unstubAllGlobals();
  });

  it("keeps handling messages when one handler throws, and says which", async () => {
    vi.stubGlobal('location', { search: '', protocol: 'http:', host: 'localhost' });
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem() {}, removeItem() {} });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { NetClient } = await import('../src/net/NetClient');
    const { defaultProfile } = await import('@ppp/shared');
    const tr: import('../src/net/NetClient').Transport = {
      onopen: null,
      onmessage: null,
      onclose: null,
      send() {},
      close() {},
    };
    const net = new NetClient(() => defaultProfile('g_me', 'Me'));
    const seen: string[] = [];
    net.bus.on('msg', (m) => {
      if (m.t === 'left') throw new Error('boom');
      seen.push(m.t);
    });
    net.useTarget({ kind: 'loopback', open: () => tr });
    void net.connect();
    tr.onopen!();
    tr.onmessage!(JSON.stringify({ t: 'left' }));
    tr.onmessage!(JSON.stringify({ t: 'pong', t0: 1 }));
    expect(seen).toEqual(['pong']);
    expect(String(err.mock.calls[0]?.[0])).toContain("handling 'left' failed");
    net.disconnect();
    vi.unstubAllGlobals();
  });
});
