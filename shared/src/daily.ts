import { CourseSchema, type Course, type Obstacle, type Vec3, type Zone, type Collectible } from './schema';
import { COURSES } from './courses/index';
import { coinLine, item, makeHole, zone } from './courses/builder';
import { dateKey, hashString, pick, range, rng } from './rng';

/**
 * Seeded procedural hole for the daily challenge. Same date -> same hole on every client and
 * the server. Built from the same builder + obstacle components as hand-made holes.
 */
export function dailyCourse(date = dateKey()): Course {
  const r = rng(hashString(`daily:${date}`));
  const W = 2.4;
  const pts: Vec3[] = [[0, 0, 0]];
  let dir = 0;
  const cells = new Set<string>(['0,0']);
  const nSeg = 3 + Math.floor(r() * 3);
  for (let i = 0; i < nSeg; i++) {
    const len = Math.round(range(r, 5.5, 9.5));
    let ok = false;
    for (const turn of i === 0
      ? [0]
      : r() < 0.5
        ? [Math.PI / 2, -Math.PI / 2, 0]
        : [-Math.PI / 2, Math.PI / 2, 0]) {
      const d = dir + turn;
      const last = pts[pts.length - 1];
      const nx = last[0] + Math.round(Math.cos(d)) * len;
      const nz = last[2] + Math.round(Math.sin(d)) * len;
      // reject paths that come back near earlier ones (coarse 4-unit grid)
      const samples: string[] = [];
      for (let k = 1; k <= 4; k++)
        samples.push(
          `${Math.round((last[0] + ((nx - last[0]) * k) / 4) / 4)},${Math.round((last[2] + ((nz - last[2]) * k) / 4) / 4)}`,
        );
      const lastCell = `${Math.round(last[0] / 4)},${Math.round(last[2] / 4)}`;
      if (samples.some((c) => c !== lastCell && cells.has(c))) continue;
      samples.forEach((c) => cells.add(c));
      dir = d;
      pts.push([nx, 0, nz]);
      ok = true;
      break;
    }
    if (!ok) break;
  }

  const obstacles: Obstacle[] = [];
  const zones: Zone[] = [];
  const collectibles: Collectible[] = [];
  const holeId = `daily-${date}`;
  let difficulty = 0;
  // One feature per straight segment (skipping the first, which is the tee).
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i],
      b = pts[i + 1];
    const mid: Vec3 = [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2];
    const ang = Math.atan2(b[2] - a[2], b[0] - a[0]);
    const kind = pick(r, ['spinner', 'bumpers', 'sand', 'boost', 'mover', 'windmill', 'none'] as const);
    const across = Math.abs(Math.cos(ang)) > 0.5;
    switch (kind) {
      case 'spinner':
        obstacles.push({
          type: 'spinner',
          id: `s${i}`,
          pos: mid,
          length: 2.2,
          arms: 2,
          speed: range(r, 0.9, 1.6) * (r() < 0.5 ? 1 : -1),
          height: 0.3,
          thickness: 0.18,
          phase: r() * 6,
        });
        difficulty++;
        break;
      case 'bumpers': {
        const off = 0.6;
        const side: Vec3 = across ? [0, 0, off] : [off, 0, 0];
        obstacles.push({
          type: 'bumper',
          id: `b${i}a`,
          pos: [mid[0] + side[0], 0, mid[2] + side[2]],
          radius: 0.32,
          height: 0.4,
          strength: 1,
          phase: 0,
        });
        obstacles.push({
          type: 'bumper',
          id: `b${i}b`,
          pos: [mid[0] - side[0] + (across ? 1.4 : 0), 0, mid[2] - side[2] + (across ? 0 : 1.4)],
          radius: 0.32,
          height: 0.4,
          strength: 1,
          phase: 0,
        });
        difficulty++;
        break;
      }
      case 'sand':
        zones.push(zone('sand', mid[0], mid[2], across ? 2 : W * 0.75, across ? W * 0.75 : 2, 0));
        difficulty++;
        break;
      case 'boost':
        zones.push(
          zone(
            'boost',
            a[0] + (b[0] - a[0]) * 0.3,
            a[2] + (b[2] - a[2]) * 0.3,
            across ? 1.2 : 1.6,
            across ? 1.6 : 1.2,
            0,
            { dir: ang, strength: 10 },
          ),
        );
        break;
      case 'mover': {
        const s = across ? [0, 0, 0.75] : [0.75, 0, 0];
        obstacles.push({
          type: 'mover',
          id: `m${i}`,
          size: across ? [0.5, 0.5, 0.9] : [0.9, 0.5, 0.5],
          from: [mid[0] - s[0], 0.25, mid[2] - s[2]],
          to: [mid[0] + s[0], 0.25, mid[2] + s[2]],
          period: range(r, 2.5, 4),
          rotY: 0,
          role: 'block',
          phase: r() * 6,
        });
        difficulty++;
        break;
      }
      case 'windmill':
        obstacles.push({
          type: 'windmill',
          id: `w${i}`,
          pos: mid,
          rotY: ang,
          speed: range(r, 0.9, 1.4),
          bladeLength: 1.9,
          tunnelWidth: 0.8,
          baseWidth: W + 0.4,
          phase: r() * 6,
        });
        difficulty += 2;
        break;
      default:
        break;
    }
    collectibles.push(
      ...coinLine(
        holeId,
        [a[0] + (b[0] - a[0]) * 0.15, 0, a[2] + (b[2] - a[2]) * 0.15],
        [a[0] + (b[0] - a[0]) * 0.32, 0, a[2] + (b[2] - a[2]) * 0.32],
        2,
      ),
    );
  }
  collectibles.push(...coinLine(holeId, [pts[0][0] + 2, 0, pts[0][2]], [pts[0][0] + 4, 0, pts[0][2]], 3));
  const last = pts[pts.length - 1];
  collectibles.push(
    item(holeId, 'gem', last[0] + (r() < 0.5 ? 0.8 : -0.8), 0, last[2] + (r() < 0.5 ? 0.8 : -0.8)),
  );

  let length = 0;
  for (let i = 0; i < pts.length - 1; i++)
    length += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][2] - pts[i][2]);
  const par = Math.max(
    2,
    Math.min(5, Math.round(1.2 + length / 14 + (pts.length - 2) * 0.3 + difficulty * 0.25)),
  );

  const base = COURSES[hashString(date) % COURSES.length];
  return CourseSchema.parse({
    id: holeId,
    name: 'Daily Challenge',
    world: base.world,
    description: `The hole for ${date}. One shot at glory.`,
    theme: base.theme,
    holes: [
      makeHole({
        id: holeId,
        name: `Daily · ${date}`,
        par,
        fairway: { width: W },
        points: pts,
        obstacles,
        zones,
        collectibles,
        tip: 'Same hole for everyone today. Lowest strokes tops the leaderboard!',
      }),
    ],
  });
}
