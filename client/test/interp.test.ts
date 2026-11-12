import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COURSES, DT, type S2CMsg } from '@ppp/shared';
import { EventBus } from '../src/core/EventBus';
import { RemoteSession } from '../src/net/RemoteSession';
import type { NetClient } from '../src/net/NetClient';

/**
 * Proves the client stays smooth and in sync under bad network conditions:
 * 150 ms RTT (75 ms each way), ±30 ms jitter, 5% snapshot loss.
 */
describe('RemoteSession interpolation under simulated latency', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('renders monotonic, accurate motion with lag + jitter + loss', () => {
    const bus = new EventBus<{ msg: S2CMsg; status: 'online' }>();
    const net = {
      bus,
      send: () => {},
      rtt: 150,
      stats: { snapsIn: 0, snapsDropped: 0 },
      simulated: 'test',
    } as unknown as NetClient;
    const course = COURSES[0];
    const start: Extract<S2CMsg, { t: 'matchStart' }> = {
      t: 'matchStart',
      courseId: course.id,
      daily: null,
      mode: 'parallel',
      chaos: false,
      players: [
        { id: 'me', name: 'Me' },
        { id: 'them', name: 'Them' },
      ],
      holeIndex: 0,
      tick: 0,
      st: 0,
    };
    const session = new RemoteSession(net, course, 'parallel', 'me', start, null);

    const speed = 5; // units/s along x
    const truth = (st: number) => st * DT * speed;
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const deliveries: { at: number; msg: S2CMsg }[] = [];
    let lastAt = 0;
    const tickMs = DT * 1000;

    // Server: 600 ticks (10 s), snapshot every 3 ticks.
    for (let st = 0; st <= 600; st += 3) {
      if (rand() < 0.05) continue; // lost
      const sentAt = st * tickMs;
      const at = Math.max(lastAt, sentAt + 75 + rand() * 30);
      lastAt = at;
      const x = truth(st);
      deliveries.push({
        at,
        msg: { t: 'snap', hole: 0, tick: st, st, balls: [['them', x, 0.17, 0, speed, 0, 0, 1]] },
      });
    }

    const t0 = performance.now();
    let prevX = -Infinity;
    let maxErr = 0;
    let maxStep = 0;
    let frames = 0;
    for (let ms = 0; ms < 10_000; ms += 16) {
      vi.advanceTimersByTime(16);
      while (deliveries.length && deliveries[0].at <= performance.now() - t0)
        bus.emit('msg', deliveries.shift()!.msg);
      session.update(0.016);
      const b = session.renderBalls().find((x) => x.id === 'them');
      if (!b || ms < 1000) continue; // let the clock settle
      frames++;
      const renderSt = (session as unknown as { renderSt: number }).renderSt;
      maxErr = Math.max(maxErr, Math.abs(b.pos[0] - truth(renderSt)));
      if (prevX !== -Infinity) maxStep = Math.max(maxStep, b.pos[0] - prevX);
      expect(b.pos[0]).toBeGreaterThanOrEqual(prevX - 1e-6); // never jumps backwards
      prevX = b.pos[0];
    }
    expect(frames).toBeGreaterThan(400);
    expect(maxErr).toBeLessThan(0.02); // within 2 cm of the true path at render time
    expect(maxStep).toBeLessThan(speed * 0.016 * 2.5); // no visible hitches
    session.dispose();
  });
});
