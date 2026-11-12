import { PHYSICS } from './config';
import type { Hole, Vec3 } from './schema';
import { progressAlong } from './math';
import { Simulation } from './sim/Simulation';

/**
 * Headless greedy hole solver used by `npm run validate:courses` and the test suite.
 * For each stroke it tries a fan of angles x powers, simulates each shot to rest and keeps the
 * one that makes the most progress along the authored path (holing out wins immediately).
 * It is not a perfect player — it proves a hole is completable and gives a rough par check.
 */

export interface ShotResult {
  pos: Vec3;
  holed: boolean;
  hazard: boolean;
  tick: number;
  collected: string[];
}

export function simulateShot(
  hole: Hole,
  from: Vec3,
  tick: number,
  angle: number,
  power: number,
  maxTicks = 1500,
): ShotResult {
  const sim = new Simulation(hole);
  sim.addBall('b', from);
  sim.setTick(tick);
  sim.shoot('b', Math.cos(angle), Math.sin(angle), power);
  let hazard = false;
  const collected: string[] = [];
  let t = 0;
  for (; t < maxTicks; t++) {
    sim.step();
    for (const e of sim.events.splice(0)) {
      if (e.type === 'water' || e.type === 'oob') hazard = true;
      if (e.type === 'collect') collected.push(e.item);
    }
    const b = sim.getBall('b')!;
    if (b.phase === 'holed') break;
    if (b.phase === 'rest' && t > 2) break;
    if (hazard) break;
  }
  const b = sim.getBall('b')!;
  const res = { pos: [...b.pos] as Vec3, holed: b.phase === 'holed', hazard, tick: sim.tick, collected };
  sim.dispose();
  return res;
}

export interface SolveResult {
  strokes: number;
  holed: boolean;
  shots: { angle: number; power: number; pos: Vec3 }[];
}

export function solveHole(
  hole: Hole,
  opts: { maxStrokes?: number; angles?: number; powers?: number[] } = {},
): SolveResult {
  const maxStrokes = opts.maxStrokes ?? hole.par + 4;
  const nAngles = opts.angles ?? 48;
  const powers = opts.powers ?? [0.15, 0.25, 0.35, 0.45, 0.55, 0.68, 0.82, 1];
  let pos: Vec3 = [hole.tee[0], hole.tee[1] + PHYSICS.ballRadius + 0.01, hole.tee[2]];
  let tick = 0;
  const shots: SolveResult['shots'] = [];
  const total = progressAlong(hole.path, hole.cup).total;
  // A shot can't advance along the path much further than the ball actually moved, so a ball
  // that stops beside a later leg (behind a wall) isn't scored as having got there.
  const reach = (from: Vec3, to: Vec3) => Math.hypot(to[0] - from[0], to[2] - from[2]) + 1.5;
  let along = 0;
  for (let s = 1; s <= maxStrokes; s++) {
    let best: { score: number; angle: number; power: number; r: ShotResult } | null = null;
    const toCup = Math.atan2(hole.cup[2] - pos[2], hole.cup[0] - pos[0]);
    const candidates: [number, number][] = [];
    for (let i = 0; i < nAngles; i++)
      for (const p of powers) candidates.push([(i / nAngles) * Math.PI * 2, p]);
    for (let k = -3; k <= 3; k++)
      for (let p = 0.08; p <= 0.7; p += 0.04) candidates.push([toCup + k * 0.02, p]);
    for (const [angle, power] of candidates) {
      const r = simulateShot(hole, pos, tick, angle, power);
      let score: number;
      if (r.holed)
        score = 1e6 - power; // prefer the softest holing shot
      else if (r.hazard) score = -1e6;
      else {
        const pr = progressAlong(hole.path, r.pos, along + reach(pos, r.pos));
        score =
          pr.along -
          pr.dist * 0.5 -
          (pr.along >= total - 0.01 ? Math.hypot(r.pos[0] - hole.cup[0], r.pos[2] - hole.cup[2]) : 0);
      }
      if (!best || score > best.score) best = { score, angle, power, r };
      if (r.holed && power < 0.5) break;
    }
    shots.push({ angle: best!.angle, power: best!.power, pos: best!.r.pos });
    if (best!.r.holed) return { strokes: s, holed: true, shots };
    along = progressAlong(hole.path, best!.r.pos, along + reach(pos, best!.r.pos)).along;
    pos = best!.r.pos;
    tick = best!.r.tick;
  }
  return { strokes: maxStrokes, holed: false, shots };
}
