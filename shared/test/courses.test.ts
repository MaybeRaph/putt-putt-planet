import { beforeAll, describe, expect, it } from 'vitest';
import {
  COURSES,
  CourseSchema,
  RAW_COURSES,
  WORLD_GATES,
  courseSpecials,
  dailyCourse,
  getCourse,
  initPhysics,
  solveHole,
} from '../src/index';

beforeAll(async () => {
  await initPhysics();
});

describe('course data', () => {
  it('ships at least 4 worlds x 9 holes, all schema-valid', () => {
    expect(COURSES.length).toBeGreaterThanOrEqual(4);
    for (const raw of RAW_COURSES) expect(CourseSchema.safeParse(raw).success).toBe(true);
    for (const c of COURSES) expect(c.holes.length).toBe(9);
    expect(COURSES.reduce((a, c) => a + c.holes.length, 0)).toBeGreaterThanOrEqual(36);
  });

  it('has unique hole, obstacle and collectible ids', () => {
    const holeIds = COURSES.flatMap((c) => c.holes.map((h) => h.id));
    expect(new Set(holeIds).size).toBe(holeIds.length);
    for (const c of COURSES)
      for (const h of c.holes) {
        const ids = h.collectibles.map((x) => x.id);
        expect(new Set(ids).size, `${h.id} collectibles`).toBe(ids.length);
        const ob = h.obstacles.map((o) => o.id);
        expect(new Set(ob).size, `${h.id} obstacles`).toBe(ob.length);
      }
  });

  it('every world has exactly one golden ball, some gems, a crate, and a gate', () => {
    for (const c of COURSES) {
      const all = c.holes.flatMap((h) => h.collectibles);
      expect(all.filter((x) => x.kind === 'golden').length, c.id).toBe(1);
      expect(all.filter((x) => x.kind === 'gem').length, c.id).toBeGreaterThanOrEqual(2);
      expect(all.filter((x) => x.kind === 'crate').length, c.id).toBeGreaterThanOrEqual(1);
      expect(courseSpecials(c).length).toBeGreaterThanOrEqual(3);
      expect(WORLD_GATES[c.world], c.world).toBeTruthy();
    }
  });

  it('pars are sane and every hole has a tip', () => {
    for (const c of COURSES)
      for (const h of c.holes) {
        expect(h.par).toBeGreaterThanOrEqual(2);
        expect(h.par).toBeLessThanOrEqual(5);
        expect(h.tip, h.id).toBeTruthy();
      }
  });

  it('daily hole is deterministic per date and changes between dates', () => {
    const a = dailyCourse('2026-01-01');
    expect(JSON.stringify(dailyCourse('2026-01-01'))).toBe(JSON.stringify(a));
    expect(JSON.stringify(dailyCourse('2026-01-02'))).not.toBe(JSON.stringify(a));
  });

  // The full sweep runs in `npm run validate:courses`; here we spot-check the trickiest mechanics.
  it.each([
    ['meadow', 5, 'windmill'],
    ['candy', 4, 'loop'],
    ['candy', 6, 'teleporter-only green'],
    ['frozen', 9, 'moving floe'],
    ['clockwork', 8, 'freight elevator'],
    ['space', 6, 'gravity well'],
  ])('solver completes %s hole %i (%s)', (courseId, n) => {
    const h = getCourse(courseId)!.holes[n - 1];
    const r = solveHole(h, { angles: 24 });
    expect(r.holed).toBe(true);
    expect(r.strokes).toBeLessThanOrEqual(h.par + 2);
  });
});
