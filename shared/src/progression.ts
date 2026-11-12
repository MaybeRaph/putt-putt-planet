import { COINS, WORLD_GATES, XP, xpToNext } from './config';
import { COSMETICS, COSMETIC_BY_ID } from './cosmetics';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID } from './achievements';
import { starsTotal, type Profile } from './profile';
import type { Course, CollectibleKind } from './schema';
import type { GameMode, HoleResult, Match } from './match/Match';
import { hashString } from './rng';

/** Everything the reward calculation needs to know about one player's run. */
export interface RunSummary {
  courseId: string;
  mode: GameMode;
  playerCount: number;
  chaos: boolean;
  completed: boolean;
  /** Results of this player's entrant (team in relay). */
  holes: HoleResult[];
  individualStrokes: number;
  individualPar: number;
  teamStrokes: number;
  teamPar: number;
  /** Everything collected by anyone during the run (shared rewards). */
  collected: { item: string; kind: CollectibleKind }[];
  playtimeSec: number;
  shots: number;
  daily?: { date: string; strokes: number; par: number };
}

export interface Grant {
  xpItems: { label: string; xp: number }[];
  coinItems: { label: string; coins: number }[];
  xpTotal: number;
  coinsTotal: number;
  startLevel: number;
  startXp: number;
  levelsGained: number[];
  stars: [boolean, boolean, boolean];
  newStars: number;
  unlocked: string[];
  achievements: string[];
  newCollectibles: string[];
  /** Planet Hopper stardust banked from this run. */
  dust?: number;
}

export function buildRunSummary(
  match: Match,
  playerId: string,
  courseId: string,
  playtimeSec: number,
  daily?: string,
): RunSummary {
  const entrant = match.entrantOf(playerId) ?? playerId;
  const holes = (match.results[entrant] ?? []).filter(Boolean);
  const sum = (arr: HoleResult[], f: (h: HoleResult) => number) => arr.reduce((a, h) => a + f(h), 0);
  const individualStrokes = sum(holes, (h) => h.strokes);
  const individualPar = sum(holes, (h) => h.par);
  let teamStrokes = 0,
    teamPar = 0;
  for (const e of match.entrants) {
    const r = (match.results[e] ?? []).filter(Boolean);
    teamStrokes += sum(r, (h) => h.strokes);
    teamPar += sum(r, (h) => h.par);
  }
  return {
    courseId,
    mode: match.cfg.mode,
    playerCount: match.players.length,
    chaos: !!match.cfg.chaos,
    completed: match.phase === 'courseEnd',
    holes,
    individualStrokes,
    individualPar,
    teamStrokes,
    teamPar,
    collected: match.collected.map((c) => ({ item: c.item, kind: c.kind })),
    playtimeSec,
    shots: match.shotsBy[playerId] ?? 0,
    daily: daily ? { date: daily, strokes: individualStrokes, par: individualPar } : undefined,
  };
}

/** Course specials = gems + golden balls (persistent per profile). */
export function courseSpecials(course: Course): string[] {
  return course.holes.flatMap((h) =>
    h.collectibles.filter((c) => c.kind === 'gem' || c.kind === 'golden').map((c) => c.id),
  );
}

export function isOwned(p: Profile, cosmeticId: string): boolean {
  const c = COSMETIC_BY_ID.get(cosmeticId);
  return !!c && (c.unlock.type === 'default' || p.owned.includes(cosmeticId));
}

export function worldUnlocked(p: Profile, world: string): boolean {
  const g = WORLD_GATES[world];
  if (!g) return true;
  return p.level >= g.level || starsTotal(p) >= g.stars;
}

/** Add XP, handling level-ups (coins + level cosmetics). Mutates p. */
export function addXp(p: Profile, amount: number, grant: Grant): void {
  p.xp += Math.round(amount);
  while (p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level);
    p.level++;
    grant.levelsGained.push(p.level);
    p.coins += COINS.levelUp;
    grant.coinItems.push({ label: `Level ${p.level}!`, coins: COINS.levelUp });
    grant.coinsTotal += COINS.levelUp;
    for (const c of COSMETICS)
      if (c.unlock.type === 'level' && c.unlock.level <= p.level && !p.owned.includes(c.id)) {
        p.owned.push(c.id);
        grant.unlocked.push(c.id);
      }
  }
}

/** Pick a crate reward deterministically (same result on client and server). */
export function crateDrop(p: Profile, itemId: string): string | null {
  const pool = COSMETICS.filter((c) => c.unlock.type === 'crate' && !p.owned.includes(c.id))
    .map((c) => c.id)
    .sort();
  if (!pool.length) return null;
  return pool[hashString(itemId + p.id) % pool.length];
}

/**
 * Apply a finished run to a profile. Pure: returns a new profile plus a breakdown of every
 * reward for the results screen. Used by the server for online games and by the client for
 * solo/offline games.
 */
export function applyRun(
  profile: Profile,
  run: RunSummary,
  course: Course | null,
): { profile: Profile; grant: Grant } {
  const p: Profile = structuredClone(profile);
  const grant: Grant = {
    xpItems: [],
    coinItems: [],
    xpTotal: 0,
    coinsTotal: 0,
    startLevel: p.level,
    startXp: p.xp,
    levelsGained: [],
    stars: [false, false, false],
    newStars: 0,
    unlocked: [],
    achievements: [],
    newCollectibles: [],
  };
  const xp = (label: string, n: number) => {
    if (n <= 0) return;
    grant.xpItems.push({ label, xp: Math.round(n) });
    grant.xpTotal += Math.round(n);
  };
  const coins = (label: string, n: number) => {
    if (n <= 0) return;
    grant.coinItems.push({ label, coins: n });
    grant.coinsTotal += n;
  };

  // --- holes
  let underParStrokes = 0,
    aces = 0,
    underParHoles = 0,
    bank = 0,
    penalties = 0;
  for (const h of run.holes) {
    if (!h.pickedUp && h.strokes < h.par) {
      underParStrokes += h.par - h.strokes;
      underParHoles++;
    }
    if (h.holeInOne) aces++;
    if (h.bankContacts > 0 && !h.pickedUp) bank++;
    penalties += h.penalties;
  }
  xp(
    `${run.holes.length} hole${run.holes.length === 1 ? '' : 's'} played`,
    run.holes.length * XP.holeFinished,
  );
  xp('Strokes under par', underParStrokes * XP.perStrokeUnderPar);
  xp('Holes-in-one', aces * XP.holeInOne);
  coins('Holes finished', run.holes.length * COINS.holeFinished);
  coins('Under-par holes', underParHoles * COINS.underPar);
  coins('Holes-in-one', aces * COINS.holeInOne);

  // --- collectibles (shared: everyone present gets them)
  const counts = { coin: 0, gem: 0, golden: 0, crate: 0 };
  let dupCoins = 0;
  for (const c of run.collected) {
    counts[c.kind]++;
    if (c.kind === 'gem' || c.kind === 'golden') {
      if (!p.collected.includes(c.item)) {
        p.collected.push(c.item);
        grant.newCollectibles.push(c.item);
        coins(
          c.kind === 'gem' ? 'New gem' : 'New golden ball',
          c.kind === 'gem' ? COINS.gemPickup : COINS.goldenPickup,
        );
      } else dupCoins += c.kind === 'gem' ? COINS.gemDuplicate : COINS.goldenDuplicate;
    } else if (c.kind === 'crate') {
      const drop = crateDrop(p, c.item);
      if (drop) {
        p.owned.push(drop);
        grant.unlocked.push(drop);
      } else dupCoins += COINS.crateDuplicate;
    }
  }
  if (counts.coin)
    coins(`${counts.coin} coin${counts.coin === 1 ? '' : 's'} picked up`, counts.coin * COINS.coinPickup);
  if (dupCoins) coins('Repeat finds', dupCoins);
  xp(
    'Collectibles',
    counts.coin * XP.coin + counts.gem * XP.gem + counts.golden * XP.golden + counts.crate * XP.crate,
  );

  // --- course / stars
  if (run.daily) {
    xp('Daily challenge', XP.dailyComplete);
    if (run.daily.strokes < run.daily.par) xp('Daily under par', XP.dailyUnderPar);
    if (p.daily.date !== run.daily.date) p.daily = { date: run.daily.date, best: run.daily.strokes };
    else p.daily.best = p.daily.best === null ? run.daily.strokes : Math.min(p.daily.best, run.daily.strokes);
    p.stats.dailyPlayed++;
  } else if (run.completed && course) {
    xp('Course complete', XP.courseComplete);
    const prev = p.stars[course.id] ?? [false, false, false];
    const specials = courseSpecials(course);
    const strokes = run.mode === 'versus' || run.mode === 'solo' ? run.individualStrokes : run.teamStrokes;
    const par = run.mode === 'versus' || run.mode === 'solo' ? run.individualPar : run.teamPar;
    const s: [boolean, boolean, boolean] = [
      true,
      strokes <= par,
      specials.every((id) => p.collected.includes(id)),
    ];
    grant.stars = s;
    const merged: [boolean, boolean, boolean] = [prev[0] || s[0], prev[1] || s[1], prev[2] || s[2]];
    grant.newStars = merged.filter(Boolean).length - prev.filter(Boolean).length;
    p.stars[course.id] = merged;
    xp('New stars', grant.newStars * XP.starBonus);
    if (run.mode === 'solo' || run.mode === 'versus') {
      const best = p.best[course.id];
      if (best === undefined || run.individualStrokes < best) p.best[course.id] = run.individualStrokes;
    }
    p.stats.coursesCompleted++;
    if (run.mode === 'relay' || run.mode === 'parallel') p.stats.coopCourses++;
  }

  // Team bonus: more friends = more XP.
  if (run.playerCount > 1 && grant.xpTotal > 0) {
    xp(
      `Team bonus (${run.playerCount} players)`,
      grant.xpTotal * XP.teamBonusPerExtraPlayer * (run.playerCount - 1),
    );
  }

  // --- stats
  p.stats.holes += run.holes.length;
  p.stats.strokes += run.shots;
  p.stats.holesInOne += aces;
  p.stats.underPar += underParHoles;
  p.stats.coinsFound += counts.coin;
  p.stats.gemsFound += counts.gem;
  p.stats.goldenFound += counts.golden;
  p.stats.cratesOpened += counts.crate;
  p.stats.playtimeSec += run.playtimeSec;
  p.stats.waterHits += penalties;
  p.stats.bankShots += bank;

  p.coins += grant.coinsTotal;
  addXp(p, grant.xpTotal, grant);

  // --- achievements (may cascade XP / coins / cosmetics)
  for (let pass = 0; pass < 3; pass++) {
    let any = false;
    for (const a of ACHIEVEMENTS) {
      if (p.achievements.includes(a.id) || !a.check(p, run)) continue;
      any = true;
      p.achievements.push(a.id);
      grant.achievements.push(a.id);
      if (a.coins) {
        p.coins += a.coins;
        coins(`🏅 ${a.name}`, a.coins);
      }
      for (const c of COSMETICS)
        if (c.unlock.type === 'achievement' && c.unlock.id === a.id && !p.owned.includes(c.id)) {
          p.owned.push(c.id);
          grant.unlocked.push(c.id);
        }
      if (a.xp) {
        xp(`🏅 ${a.name}`, a.xp);
        addXp(p, a.xp, grant);
      }
    }
    if (!any) break;
  }
  // Keep the coin ledger consistent (coins === coinsEarned - coinsSpent).
  p.coinsEarned += p.coins - profile.coins;
  return { profile: p, grant };
}

/** Buy a cosmetic from the shop. Returns the new profile or an error string. */
export function buyCosmetic(profile: Profile, id: string): Profile | string {
  const c = COSMETIC_BY_ID.get(id);
  if (!c || c.unlock.type !== 'shop') return 'Not for sale';
  if (isOwned(profile, id)) return 'Already owned';
  if (profile.coins < c.unlock.price) return 'Not enough coins';
  const p = structuredClone(profile);
  p.coins -= c.unlock.price;
  p.coinsSpent += c.unlock.price;
  p.owned.push(id);
  return p;
}

export function achievementName(id: string): string {
  return ACHIEVEMENT_BY_ID.get(id)?.name ?? id;
}
