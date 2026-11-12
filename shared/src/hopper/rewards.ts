import { addXp, applyRun, buildRunSummary, type Grant } from '../progression';
import type { Profile } from '../profile';
import { UPGRADES, dustBalance, upgradeRank, type UpgradeId } from './defs';
import type { HopperMatch } from './HopperMatch';

/** Stages cleared in a run (a won run cleared all of them). */
export function stagesCleared(match: HopperMatch): number {
  return match.hs.stage + (match.hs.result === 'won' ? 1 : 0);
}

/**
 * End of a Planet Hopper run for one player: the usual hole/coin XP plus depth XP, and the
 * run's stardust banked into the Clubhouse (won or lost, like any good roguelike).
 */
export function applyHopperRun(
  profile: Profile,
  match: HopperMatch,
  playerId: string,
  playtimeSec: number,
): { profile: Profile; grant: Grant } {
  const run = buildRunSummary(match, playerId, 'hopper', playtimeSec);
  // Rest-stop crates are wishes, not loot crates; runs never award course stars.
  run.collected = run.collected.filter((c) => c.kind !== 'crate');
  // Rest stops are not golf holes (no XP for "holing" a wish).
  const entrant = match.entrantOf(playerId) ?? playerId;
  run.holes = (match.results[entrant] ?? []).filter((h, i) => h && match.hs.stages[i]?.kind !== 'rest');
  run.completed = false;
  const { profile: p, grant } = applyRun(profile, run, null);
  const cleared = stagesCleared(match);
  const won = match.hs.result === 'won';
  const extra = cleared * 12 + (won ? 400 : 0);
  if (extra > 0) {
    grant.xpItems.push({
      label: won ? `🪐 Planet Hopper victory (${cleared} stages)` : `🪐 ${cleared} stages cleared`,
      xp: extra,
    });
    grant.xpTotal += extra;
    addXp(p, extra, grant);
  }
  const mult = 1 + 0.25 * upgradeRank(p.hopper, 'pockets');
  const dust = Math.round(match.hs.dust * mult) + (won ? 50 : 0);
  p.hopper = {
    ...p.hopper,
    dustEarned: p.hopper.dustEarned + dust,
    runs: p.hopper.runs + 1,
    wins: p.hopper.wins + (won ? 1 : 0),
    bestStage: Math.max(p.hopper.bestStage, cleared),
    discovered: [...new Set([...p.hopper.discovered, ...match.hs.trinkets])],
  };
  grant.dust = dust;
  return { profile: p, grant };
}

/** Buy the next rank of a Clubhouse upgrade. Returns an error message on failure. */
export function buyUpgrade(profile: Profile, id: UpgradeId): Profile | string {
  const rank = upgradeRank(profile.hopper, id);
  const cost = UPGRADES[id].costs[rank];
  if (cost === undefined) return 'Already maxed out';
  if (dustBalance(profile.hopper) < cost) return 'Not enough stardust';
  const p = structuredClone(profile);
  p.hopper.dustSpent += cost;
  p.hopper.upgrades[id] = rank + 1;
  return p;
}

export function setKeepsake(profile: Profile, id: string | null): Profile {
  const p = structuredClone(profile);
  p.hopper.keepsake = id && p.hopper.discovered.includes(id) ? id : null;
  return p;
}
