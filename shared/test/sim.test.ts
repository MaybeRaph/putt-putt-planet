import { beforeAll, describe, expect, it } from 'vitest';
import {
  HoleSchema,
  initPhysics,
  Match,
  Simulation,
  type Hole,
  type HoleInput,
  type SimEvent,
} from '../src/index';
import { makeHole, slab, zone } from '../src/courses/builder';

const hole = (spec: Parameters<typeof makeHole>[0]): Hole => HoleSchema.parse(makeHole(spec) as HoleInput);
const straight = (extra: Partial<Parameters<typeof makeHole>[0]> = {}) =>
  hole({
    id: 't',
    name: 't',
    par: 3,
    points: [
      [0, 0, 0],
      [20, 0, 0],
    ],
    cup: [30, 0, 30],
    ...extra,
  });

function run(sim: Simulation, id = 'a', max = 2000): SimEvent[] {
  const evs: SimEvent[] = [];
  for (let i = 0; i < max; i++) {
    sim.step();
    evs.push(...sim.events.splice(0));
    const b = sim.getBall(id)!;
    if (i > 2 && (b.phase === 'rest' || b.phase === 'holed')) break;
  }
  return evs;
}

beforeAll(async () => {
  await initPhysics();
});

describe('Simulation', () => {
  it('ball rolls and settles cleanly on flat grass', () => {
    const sim = new Simulation(straight());
    sim.addBall('a');
    expect(sim.shoot('a', 1, 0, 0.4)).toBe(true);
    const evs = run(sim);
    const b = sim.getBall('a')!;
    expect(b.phase).toBe('rest');
    expect(b.pos[0]).toBeGreaterThan(2);
    expect(Math.abs(b.pos[2])).toBeLessThan(0.01);
    expect(evs.some((e) => e.type === 'rest')).toBe(true);
  });

  it('rejects shots while moving, and invalid input', () => {
    const sim = new Simulation(straight());
    sim.addBall('a');
    expect(sim.shoot('a', 0, 0, 1)).toBe(false);
    expect(sim.shoot('a', NaN, 0, 1)).toBe(false);
    expect(sim.shoot('a', 1, 0, 0.5)).toBe(true);
    sim.step();
    expect(sim.shoot('a', 1, 0, 0.5)).toBe(false);
  });

  it('sinks a gentle putt and lips out a full-power one', () => {
    const h = hole({
      id: 't',
      name: 't',
      par: 2,
      points: [
        [0, 0, 0],
        [6, 0, 0],
      ],
    });
    const soft = new Simulation(h);
    soft.addBall('a', [4, 0.17, 0]);
    soft.shoot('a', 1, 0, 0.32);
    expect(run(soft).some((e) => e.type === 'holed')).toBe(true);
    const hard = new Simulation(h);
    hard.addBall('a', [4, 0.17, 0]);
    hard.shoot('a', 1, 0, 1);
    const evs: SimEvent[] = [];
    for (let i = 0; i < 20; i++) {
      hard.step();
      evs.push(...hard.events.splice(0));
    }
    expect(evs.some((e) => e.type === 'lipout')).toBe(true);
    expect(evs.some((e) => e.type === 'sunk')).toBe(false);
  });

  it('is deterministic for identical inputs', () => {
    const h = straight({
      obstacles: [
        {
          type: 'spinner',
          id: 's',
          pos: [8, 0, 0],
          length: 2,
          arms: 2,
          speed: 2,
          height: 0.3,
          thickness: 0.18,
          phase: 0,
        },
      ],
    });
    const go = () => {
      const s = new Simulation(h);
      s.addBall('a');
      s.shoot('a', 1, 0.05, 0.8);
      run(s);
      return s.getBall('a')!.pos;
    };
    expect(go()).toEqual(go());
  });

  it('water resets to the last rest spot', () => {
    const h = straight({
      fairway: { noFloor: [0] },
      solids: [slab(-2, -1, 0, 1, 0)],
      zones: [zone('water', 10, 0, 20, 2, 0)],
    });
    const sim = new Simulation(h);
    sim.addBall('a', [0, 0.5, 0]);
    sim.placeBall('a', [-0.5, 0.17, 0]);
    sim.shoot('a', 1, 0, 0.3);
    const evs = run(sim);
    expect(evs.some((e) => e.type === 'water')).toBe(true);
    expect(sim.getBall('a')!.pos[0]).toBeCloseTo(-0.5, 1);
  });

  it('boost pad speeds the ball up', () => {
    const h = straight({ zones: [zone('boost', 3, 0, 1.5, 2, 0, { dir: 0, strength: 12 })] });
    const sim = new Simulation(h);
    sim.addBall('a');
    sim.shoot('a', 1, 0, 0.3);
    const evs = run(sim);
    expect(evs.some((e) => e.type === 'boost')).toBe(true);
    expect(sim.getBall('a')!.pos[0]).toBeGreaterThan(12);
  });

  it('one-way gate bounces balls going the wrong way', () => {
    const h = straight({ zones: [zone('oneWay', 5, 0, 0.6, 2, 0, { dir: Math.PI })] });
    const sim = new Simulation(h);
    sim.addBall('a');
    sim.shoot('a', 1, 0, 0.6);
    run(sim);
    expect(sim.getBall('a')!.pos[0]).toBeLessThan(5.5);
  });

  it('teleporter moves the ball to its exit', () => {
    const h = straight({
      obstacles: [
        { type: 'teleporter', id: 'tp', a: [3, 0, 0], b: [15, 0, 0], exitDir: 0, radius: 0.4, phase: 0 },
      ],
    });
    const sim = new Simulation(h);
    sim.addBall('a');
    sim.shoot('a', 1, 0, 0.4);
    const evs = run(sim);
    expect(evs.some((e) => e.type === 'teleport')).toBe(true);
    expect(sim.getBall('a')!.pos[0]).toBeGreaterThan(15);
  });

  it('a fast ball completes the loop-the-loop', () => {
    const h = hole({
      id: 't',
      name: 't',
      par: 3,
      points: [
        [0, 0, 0],
        [16, 0, 0],
      ],
      fairway: { width: 3.2 },
      cup: [30, 0, 30],
      obstacles: [
        {
          type: 'loop',
          id: 'lp',
          pos: [6, 0, -0.6],
          rotY: 0,
          radius: 1.1,
          width: 0.9,
          shift: 1.2,
          segments: 28,
          phase: 0,
        },
      ],
    });
    const sim = new Simulation(h);
    sim.addBall('a', [0, 0.17, -0.6]);
    sim.shoot('a', 1, 0, 1);
    let maxY = 0;
    for (let i = 0; i < 600; i++) {
      sim.step();
      sim.events.length = 0;
      maxY = Math.max(maxY, sim.getBall('a')!.pos[1]);
      if (sim.getBall('a')!.phase === 'rest') break;
    }
    const b = sim.getBall('a')!;
    expect(maxY).toBeGreaterThan(2); // went over the top
    expect(b.pos[0]).toBeGreaterThan(7.5); // exited forward
    expect(b.pos[2]).toBeGreaterThan(0); // on the shifted exit lane
  });

  it('moving floor platforms carry a resting ball', () => {
    const h = hole({
      id: 't',
      name: 't',
      par: 3,
      fairway: false,
      points: [
        [0, 0, 0],
        [10, 0, 0],
      ],
      solids: [slab(-1, -1, 1, 1, 0)],
      obstacles: [
        {
          type: 'mover',
          id: 'm',
          size: [2, 0.3, 2],
          from: [4, -0.15, 0],
          to: [8, -0.15, 0],
          period: 4,
          rotY: 0,
          role: 'floor',
          phase: 0,
        },
      ],
    });
    const sim = new Simulation(h);
    sim.addBall('a', [4, 0.17, 0]);
    for (let i = 0; i < 60; i++) sim.step();
    const b = sim.getBall('a')!;
    expect(b.pos[0]).toBeGreaterThan(4.3);
    expect(b.pos[1]).toBeGreaterThan(0.1);
  });
});

describe('Match rules', () => {
  const h = straight({ par: 2 });
  it('counts strokes and enforces the stroke limit', () => {
    const m = new Match({ mode: 'solo', holes: [h], players: [{ id: 'p', name: 'P' }] });
    m.startHole(0);
    for (let s = 0; s < 20 && m.phase === 'playing'; s++) {
      m.shoot('p', -1, 0, 0.05); // feeble shots away from the cup
      for (let i = 0; i < 400 && m.sim.getBall('p')!.phase === 'moving'; i++) m.step();
      m.step();
    }
    expect(m.card.p[0]).toBe(2 + 6);
    expect(m.results.p[0].pickedUp).toBe(true);
  });

  it('relay alternates turns between connected players', () => {
    const m = new Match({
      mode: 'relay',
      holes: [h],
      players: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    });
    m.startHole(0);
    expect(m.turn).toBe('a');
    expect(m.canShoot('b')).toBe(false);
    m.shoot('a', 1, 0, 0.2);
    for (let i = 0; i < 600 && m.turn === 'a'; i++) m.step();
    expect(m.turn).toBe('b');
    m.setConnected('a', false);
    m.shoot('b', 1, 0, 0.1);
    for (let i = 0; i < 600 && m.sim.getBall('team')!.phase !== 'rest'; i++) m.step();
    m.step();
    expect(m.turn).toBe('b'); // a is disconnected, so b keeps the turn
  });

  it('parallel mode finishes the hole when every connected entrant is done', () => {
    const h = hole({
      id: 'p',
      name: 'p',
      par: 2,
      points: [
        [0, 0, 0],
        [10, 0, 0],
      ],
    });
    const m = new Match({
      mode: 'parallel',
      holes: [h, h],
      players: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      holeEndDelay: 0,
    });
    m.startHole(0);
    m.setConnected('b', false);
    m.sim.placeBall('a', [h.cup[0] - 0.5, 0.17, h.cup[2]]);
    m.shoot('a', 1, 0, 0.15);
    for (let i = 0; i < 600 && m.phase === 'playing'; i++) m.step();
    expect(m.phase).toBe('holeEnd');
    expect(m.results.b[0].pickedUp).toBe(true);
    m.advance();
    expect(m.holeIndex).toBe(1);
  });
});

describe('6-player chaos mode', () => {
  it('fits six colliding balls on every tee without falling off', async () => {
    const { COURSES } = await import('../src/index');
    for (const c of COURSES)
      for (const h of c.holes) {
        const sim = new Simulation(h, { ballsCollide: true });
        for (let i = 0; i < 6; i++) sim.addBall(`b${i}`);
        const evs: SimEvent[] = [];
        for (let t = 0; t < 30; t++) {
          sim.step();
          evs.push(...sim.events.splice(0));
        }
        expect(evs.filter((e) => e.type === 'oob' || e.type === 'water'), `${h.id}`).toEqual([]);
        sim.dispose();
      }
  });
});

