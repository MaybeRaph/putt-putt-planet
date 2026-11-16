import type { MatchStats, ScoreState } from '@ppp/shared';
import { h } from './dom';

/**
 * v1.12 end-of-game stat awards. Each award goes to whoever has the best value of one stat
 * (ties share it); an award nobody earned (a zero) is left out. Solo games show the ones you
 * earned, as personal highlights.
 */
export interface AwardDef {
  id: string;
  icon: string;
  title: string;
  /** What the winning value means, for the card ("3 aces"). */
  label(v: number): string;
  value(s: MatchStats, card: (number | null)[], pars: number[]): number;
  /** Lowest wins (default: highest). */
  low?: boolean;
  /** Smallest value that earns it. */
  min?: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const AWARDS: AwardDef[] = [
  {
    id: 'ace',
    icon: '🎯',
    title: 'Ace',
    label: (v) => plural(v, 'hole-in-one', 'holes-in-one'),
    value: (s) => s.aces,
    min: 1,
  },
  {
    id: 'sniper',
    icon: '📏',
    title: 'Long Bomb',
    label: (v) => `sank one from ${v.toFixed(1)} m`,
    value: (s) => s.longest,
    min: 4,
  },
  {
    id: 'birdie',
    icon: '🐦',
    title: 'Birdie Machine',
    label: (v) => plural(v, 'hole', 'holes') + ' under par',
    value: (s) => s.birdies,
    min: 1,
  },
  {
    id: 'bank',
    icon: '🎱',
    title: 'Bank Robber',
    label: (v) => plural(v, 'bounce') + ' off walls',
    value: (s) => s.wallHits,
    min: 5,
  },
  {
    id: 'coins',
    icon: '🪙',
    title: 'Coin Magnet',
    label: (v) => plural(v, 'coin'),
    value: (s) => s.coins,
    min: 3,
  },
  {
    id: 'steady',
    icon: '🧘',
    title: 'Mr. Steady',
    label: (v) => plural(v, 'par'),
    value: (s) => s.pars,
    min: 3,
  },
  {
    id: 'power',
    icon: '💪',
    title: 'Big Hitter',
    label: (v) => `average power ${Math.round(v * 100)}%`,
    value: (s) => (s.shots >= 5 ? s.power / s.shots : 0),
    min: 0.55,
  },
  {
    id: 'feather',
    icon: '🪶',
    title: 'Soft Touch',
    label: (v) => `average power ${Math.round(v * 100)}%`,
    value: (s) => (s.shots >= 5 ? s.power / s.shots : 1),
    low: true,
    min: 0.35,
  },
  {
    id: 'splash',
    icon: '💦',
    title: 'Splash Zone',
    label: (v) => plural(v, 'trip') + ' into the water or out of bounds',
    value: (s) => s.hazards,
    min: 2,
  },
  {
    id: 'gems',
    icon: '💎',
    title: 'Treasure Hunter',
    label: (v) => plural(v, 'gem'),
    value: (s) => s.gems,
    min: 1,
  },
  {
    id: 'scenic',
    icon: '🐌',
    title: 'Scenic Route',
    label: (v) => plural(v, 'shot'),
    value: (s) => s.shots,
    min: 1,
  },
];

export interface Award {
  def: AwardDef;
  winners: string[];
  value: number;
}

/**
 * Pick the awards for a finished game. `entrants` are the competitors (players, or the team in
 * relay). Low-is-best awards use `min` as an upper bound. "Scenic Route" (most shots) only
 * goes out in multiplayer, where it's a friendly ribbing rather than a stat you'd want solo.
 */
export function pickAwards(score: ScoreState, max = 6): Award[] {
  const stats = score.stats;
  if (!stats) return [];
  const entrants = score.entrants.filter((e) => stats[e]);
  if (!entrants.length) return [];
  const multi = entrants.length > 1;
  const out: Award[] = [];
  for (const def of AWARDS) {
    if (def.id === 'scenic' && !multi) continue;
    const vals = entrants.map((e) => ({ e, v: def.value(stats[e], score.card[e] ?? [], score.pars) }));
    const best = def.low ? Math.min(...vals.map((x) => x.v)) : Math.max(...vals.map((x) => x.v));
    const min = def.min ?? 1;
    if (def.low ? best > min : best < min) continue;
    const winners = vals.filter((x) => Math.abs(x.v - best) < 1e-9).map((x) => x.e);
    // In multiplayer an award everybody ties for says nothing.
    if (multi && winners.length === entrants.length) continue;
    out.push({ def, winners, value: best });
  }
  return out.slice(0, max);
}

/** The awards row for the results screen (empty when there is nothing to hand out). */
export function awardsEl(score: ScoreState, nameOf: (entrant: string) => string): HTMLElement | null {
  const awards = pickAwards(score);
  if (!awards.length) return null;
  return h(
    'div',
    { class: 'awards' },
    h('h3', { class: 'section-title' }, '🏅 Awards'),
    h(
      'div',
      { class: 'award-grid' },
      ...awards.map((a, i) =>
        h(
          'div',
          { class: 'award', style: `--i:${i}` },
          h('div', { class: 'award-ico' }, a.def.icon),
          h('div', { class: 'award-title' }, a.def.title),
          h('div', { class: 'award-who' }, a.winners.map(nameOf).join(' & ')),
          h('div', { class: 'award-val' }, a.def.label(a.value)),
        ),
      ),
    ),
  );
}
