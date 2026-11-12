import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  COSMETICS,
  COURSES,
  applyRun,
  buyCosmetic,
  courseSpecials,
  crateDrop,
  defaultProfile,
  mergeProfiles,
  starsTotal,
  worldUnlocked,
  xpToNext,
  type RunSummary,
} from '../src/index';

const course = COURSES[0];
const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  courseId: course.id,
  mode: 'solo',
  playerCount: 1,
  chaos: false,
  completed: true,
  holes: course.holes.map((h) => ({
    strokes: h.par,
    par: h.par,
    holeInOne: false,
    penalties: 0,
    pickedUp: false,
    bankContacts: 0,
  })),
  individualStrokes: course.holes.reduce((a, h) => a + h.par, 0),
  individualPar: course.holes.reduce((a, h) => a + h.par, 0),
  teamStrokes: 0,
  teamPar: 0,
  collected: [],
  playtimeSec: 600,
  shots: 26,
  ...over,
});

describe('progression', () => {
  it('XP curve is increasing', () => {
    for (let l = 1; l < 50; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
  });

  it('applies a run: stars, xp, coins ledger, best score', () => {
    const p0 = defaultProfile('g1', 'Tester');
    const { profile, grant } = applyRun(p0, run(), course);
    expect(grant.stars).toEqual([true, true, false]);
    expect(profile.stars[course.id]).toEqual([true, true, false]);
    expect(grant.coinsTotal).toBeGreaterThan(0);
    expect(profile.coins).toBe(profile.coinsEarned - profile.coinsSpent);
    expect(profile.coins).toBe(grant.coinsTotal);
    expect(profile.best[course.id]).toBe(26);
    expect(profile.level).toBeGreaterThan(1);
    expect(p0.level).toBe(1); // input not mutated
  });

  it('third star needs every gem and golden ball', () => {
    const specials = courseSpecials(course);
    expect(specials.length).toBeGreaterThan(0);
    const collected = specials.map((item) => ({
      item,
      kind: item.includes(':golden') ? ('golden' as const) : ('gem' as const),
    }));
    const { profile, grant } = applyRun(defaultProfile('g2', 'T'), run({ collected }), course);
    expect(grant.stars[2]).toBe(true);
    expect(profile.achievements).toContain('perfect_course');
    expect(profile.owned).toContain('ball.gold'); // golden_touch unlock
  });

  it('coins survive merges and purchases cannot be undone by merging', () => {
    const base = applyRun(defaultProfile('g3', 'T'), run(), course).profile;
    const bought = buyCosmetic(
      { ...base, coins: 1000, coinsEarned: base.coinsEarned + 1000 - base.coins },
      'ball.beach',
    );
    expect(typeof bought).not.toBe('string');
    const b = bought as typeof base;
    const merged = mergeProfiles(base, b);
    expect(merged.coinsSpent).toBe(120);
    expect(merged.coins).toBe(merged.coinsEarned - merged.coinsSpent);
    expect(merged.owned).toContain('ball.beach');
    // merging is idempotent and commutative for these fields
    expect(mergeProfiles(merged, merged)).toEqual(merged);
    expect(mergeProfiles(b, base).coins).toBe(merged.coins);
  });

  it('crate drops are deterministic and only give unowned crate items', () => {
    const p = defaultProfile('g4', 'T');
    const a = crateDrop(p, 'x:crate@1,1');
    expect(a).toBe(crateDrop(p, 'x:crate@1,1'));
    expect(COSMETICS.find((c) => c.id === a)?.unlock.type).toBe('crate');
  });

  it('world gates open by level or stars', () => {
    const p = defaultProfile('g5', 'T');
    expect(worldUnlocked(p, 'meadow')).toBe(true);
    expect(worldUnlocked(p, 'candy')).toBe(false);
    expect(worldUnlocked({ ...p, level: 3 }, 'candy')).toBe(true);
    expect(worldUnlocked({ ...p, stars: { a: [true, true, true] } }, 'candy')).toBe(true);
    expect(starsTotal({ ...p, stars: { a: [true, false, true] } })).toBe(2);
  });

  it('has at least 20 achievements with unique ids', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    // every achievement-unlock cosmetic points at a real achievement
    for (const c of COSMETICS)
      if (c.unlock.type === 'achievement')
        expect(ACHIEVEMENTS.some((a) => a.id === (c.unlock as { id: string }).id)).toBe(true);
  });
});
