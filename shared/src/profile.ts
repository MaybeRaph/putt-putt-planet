import { z } from 'zod';
import { DEFAULT_LOADOUT, COSMETICS, type Loadout } from './cosmetics';
import { HopperProfileSchema, defaultHopperProfile, type HopperProfile } from './hopper/defs';

export const StatsSchema = z.object({
  strokes: z.number().int().nonnegative().default(0),
  holes: z.number().int().nonnegative().default(0),
  holesInOne: z.number().int().nonnegative().default(0),
  underPar: z.number().int().nonnegative().default(0),
  coinsFound: z.number().int().nonnegative().default(0),
  gemsFound: z.number().int().nonnegative().default(0),
  goldenFound: z.number().int().nonnegative().default(0),
  cratesOpened: z.number().int().nonnegative().default(0),
  playtimeSec: z.number().nonnegative().default(0),
  coursesCompleted: z.number().int().nonnegative().default(0),
  coopCourses: z.number().int().nonnegative().default(0),
  waterHits: z.number().int().nonnegative().default(0),
  bankShots: z.number().int().nonnegative().default(0),
  dailyPlayed: z.number().int().nonnegative().default(0),
});
export type Stats = z.infer<typeof StatsSchema>;

const idStr = z.string().min(1).max(64);

export const ProfileSchema = z.object({
  version: z.literal(1),
  id: idStr,
  name: z.string().min(1).max(20),
  level: z.number().int().min(1).max(999),
  xp: z.number().int().nonnegative(),
  /** Spendable coins; always equals coinsEarned - coinsSpent (a ledger keeps merges safe). */
  coins: z.number().int().nonnegative(),
  coinsEarned: z.number().int().nonnegative(),
  coinsSpent: z.number().int().nonnegative(),
  /** courseId -> [completed, par-or-better, all specials found] */
  stars: z.record(z.string(), z.tuple([z.boolean(), z.boolean(), z.boolean()])),
  /** courseId -> best total strokes (solo/individual). */
  best: z.record(z.string(), z.number().int()),
  owned: z.array(idStr).max(500),
  loadout: z.record(z.string(), z.string()),
  /** Persistently collected gem / golden ball ids. */
  collected: z.array(z.string().max(80)).max(2000),
  achievements: z.array(idStr).max(200),
  stats: StatsSchema,
  /** Rolling per-day record for the daily challenge. */
  daily: z.object({ date: z.string(), best: z.number().int().nullable() }),
  /** Planet Hopper meta-progression (Clubhouse). */
  hopper: HopperProfileSchema.default(defaultHopperProfile),
});
export type Profile = z.infer<typeof ProfileSchema>;

export function defaultProfile(id: string, name: string): Profile {
  return {
    version: 1,
    id,
    name,
    level: 1,
    xp: 0,
    coins: 0,
    coinsEarned: 0,
    coinsSpent: 0,
    stars: {},
    best: {},
    owned: COSMETICS.filter((c) => c.unlock.type === 'default').map((c) => c.id),
    loadout: { ...DEFAULT_LOADOUT },
    collected: [],
    achievements: [],
    stats: StatsSchema.parse({}),
    daily: { date: '', best: null },
    hopper: defaultHopperProfile(),
  };
}

function mergeHopper(a: HopperProfile, b: HopperProfile): HopperProfile {
  const upgrades: Record<string, number> = { ...a.upgrades };
  for (const [k, v] of Object.entries(b.upgrades)) upgrades[k] = Math.max(upgrades[k] ?? 0, v);
  return {
    dustEarned: Math.max(a.dustEarned, b.dustEarned),
    dustSpent: Math.max(a.dustSpent, b.dustSpent),
    upgrades,
    keepsake: b.keepsake ?? a.keepsake,
    discovered: [...new Set([...a.discovered, ...b.discovered])],
    runs: Math.max(a.runs, b.runs),
    wins: Math.max(a.wins, b.wins),
    bestStage: Math.max(a.bestStage, b.bestStage),
  };
}

export function starsTotal(p: Profile): number {
  return Object.values(p.stars).reduce((a, s) => a + s.filter(Boolean).length, 0);
}

export function getLoadout(p: Profile): Loadout {
  return { ...DEFAULT_LOADOUT, ...p.loadout } as Loadout;
}

/**
 * Merge two copies of the same profile (e.g. local offline progress + server copy).
 * Monotonic: takes the max of counters and the union of unlocks, so no progress is lost.
 */
export function mergeProfiles(a: Profile, b: Profile): Profile {
  const hi = a.level > b.level || (a.level === b.level && a.xp >= b.xp) ? a : b;
  const stars: Profile['stars'] = { ...a.stars };
  for (const [k, v] of Object.entries(b.stars)) {
    const s = stars[k] ?? [false, false, false];
    stars[k] = [s[0] || v[0], s[1] || v[1], s[2] || v[2]];
  }
  const best: Profile['best'] = { ...a.best };
  for (const [k, v] of Object.entries(b.best)) best[k] = best[k] === undefined ? v : Math.min(best[k], v);
  const stats = { ...a.stats };
  for (const k of Object.keys(stats) as (keyof Stats)[]) stats[k] = Math.max(a.stats[k], b.stats[k]);
  const daily =
    a.daily.date > b.daily.date
      ? a.daily
      : b.daily.date > a.daily.date
        ? b.daily
        : {
            date: a.daily.date,
            best: [a.daily.best, b.daily.best]
              .filter((x): x is number => x !== null)
              .reduce<number | null>((m, x) => (m === null ? x : Math.min(m, x)), null),
          };
  return {
    version: 1,
    id: a.id,
    name: b.name || a.name,
    level: hi.level,
    xp: hi.xp,
    coins: Math.max(a.coinsEarned, b.coinsEarned) - Math.max(a.coinsSpent, b.coinsSpent),
    coinsEarned: Math.max(a.coinsEarned, b.coinsEarned),
    coinsSpent: Math.max(a.coinsSpent, b.coinsSpent),
    stars,
    best,
    owned: [...new Set([...a.owned, ...b.owned])],
    loadout: { ...a.loadout, ...b.loadout },
    collected: [...new Set([...a.collected, ...b.collected])],
    achievements: [...new Set([...a.achievements, ...b.achievements])],
    stats,
    daily,
    hopper: mergeHopper(a.hopper, b.hopper),
  };
}
