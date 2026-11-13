import { z } from 'zod';

/**
 * Planet Hopper: a roguelike run through procedurally generated holes.
 *
 * - Hearts are the run's life (shared by the team). Over par costs hearts, under par earns them.
 * - Between holes the team picks a route at a fork: each route shows its reward and its omen.
 * - Trinkets are run-long perks; keepsakes let you start a run with one you have found before.
 * - Each sector ends in a boss hole, then a Wishing Green rest stop where you putt into the
 *   reward crate you want.
 * - Stardust is banked at the end of every run (won or lost) and spent in the Clubhouse.
 */

export const TRINKET_IDS = [
  'magnet',
  'glove',
  'moth',
  'feeder',
  'bank',
  'clover',
  'pouch',
  'ironheart',
  'shield',
  'socks',
  'overtime',
  'compass',
] as const;
export type TrinketId = (typeof TRINKET_IDS)[number];

export interface TrinketDef {
  id: TrinketId;
  icon: string;
  name: string;
  /** Level 1 description (what you get when you first pick it). */
  desc: string;
  /** What each level does, Lv1..Lv3 (picking a trinket you own levels it up during the run). */
  levels: [string, string, string];
  rare?: boolean;
}

/** Trinkets level up (within a run) by picking them again: Lv1 -> Lv3. */
export const MAX_TRINKET_LEVEL = 3;

const T = (
  id: TrinketId,
  icon: string,
  name: string,
  levels: [string, string, string],
  rare = false,
): TrinketDef => ({ id, icon, name, desc: levels[0], levels, ...(rare ? { rare } : {}) });

export const TRINKETS: Record<TrinketId, TrinketDef> = {
  magnet: T('magnet', '🧲', 'Magnet Cup', [
    'Cups are 35% wider and pull harder.',
    'Cups are 50% wider.',
    'Cups are 65% wider.',
  ]),
  glove: T('glove', '🥊', 'Power Glove', ['Shots hit 18% harder.', 'Shots hit 26% harder.', 'Shots hit 34% harder.']),
  moth: T('moth', '🦋', 'Mulligan Moth', [
    'Water and out-of-bounds cost no penalty stroke.',
    'No hazard penalties, and +2 stroke limit.',
    'No hazard penalties, and +4 stroke limit.',
  ]),
  feeder: T('feeder', '🐦', 'Birdie Feeder', [
    'Any under-par hole heals 1 extra heart.',
    'Any under-par hole heals 2 extra hearts.',
    'Any under-par hole heals 3 extra hearts.',
  ]),
  bank: T(
    'bank',
    '🎱',
    'Bank Shot Badge',
    [
      'Sink a putt off a wall: one stroke refunded.',
      'Sink a putt off a wall: two strokes refunded.',
      'Sink a putt off a wall: three strokes refunded.',
    ],
    true,
  ),
  clover: T(
    'clover',
    '🍀',
    'Gimme Clover',
    [
      'A ball that stops within 0.9 m of the cup drops in for free.',
      'Gimme range grows to 1.3 m.',
      'Gimme range grows to 1.7 m.',
    ],
    true,
  ),
  pouch: T('pouch', '✨', 'Stardust Pouch', [
    'Coins are worth double stardust.',
    'Coins are worth triple stardust.',
    'Coins are worth 4× stardust.',
  ]),
  ironheart: T('ironheart', '💗', 'Iron Heart', [
    '+2 max hearts and heal 2.',
    'Another +2 max hearts and heal 2.',
    'Another +2 max hearts and heal 2.',
  ]),
  shield: T(
    'shield',
    '🛡️',
    'Bogey Shield',
    [
      'The first heart the team would lose each hole is blocked.',
      'Blocks up to 2 lost hearts each hole.',
      'Blocks up to 3 lost hearts each hole.',
    ],
    true,
  ),
  socks: T('socks', '🧦', 'Grippy Socks', [
    'Sand traps and sticky patches dry up.',
    'No sand, and ice patches and conveyor belts switch off.',
    'No sand, ice or belts, and water edges get rails.',
  ]),
  overtime: T('overtime', '⏱️', 'Overtime', [
    '+3 stroke limit, and picking up costs 1 heart less.',
    '+5 stroke limit, and picking up costs 1 heart less.',
    '+7 stroke limit, and picking up costs 2 hearts less.',
  ]),
  compass: T('compass', '🧭', 'Storm Compass', [
    'Omens are gentler: half wind, smaller fog, milder curses.',
    'Omens are much gentler.',
    'Omens have no effect at all.',
  ]),
};

/** Level of a trinket in a list where each copy is one level (stage shaping lists). */
export function countLevel(list: readonly string[], t: TrinketId): number {
  return Math.min(MAX_TRINKET_LEVEL, list.filter((x) => x === t).length);
}

export const OMEN_IDS = ['gale', 'slick', 'heavy', 'tiny', 'fog', 'moon', 'fuse'] as const;
export type OmenId = (typeof OMEN_IDS)[number];

export const OMENS: Record<OmenId, { id: OmenId; icon: string; name: string; desc: string }> = {
  gale: { id: 'gale', icon: '🌬️', name: 'Gale', desc: 'A steady wind pushes rolling balls.' },
  slick: { id: 'slick', icon: '🧊', name: 'Slick Greens', desc: 'The whole green is frozen over.' },
  heavy: { id: 'heavy', icon: '🪨', name: 'Heavy Ball', desc: 'Shots hit 20% softer.' },
  tiny: { id: 'tiny', icon: '🕳️', name: 'Tiny Cup', desc: 'The cup shrinks by a quarter.' },
  fog: { id: 'fog', icon: '🌫️', name: 'Fog Bank', desc: 'You can barely see the cup.' },
  moon: { id: 'moon', icon: '🌙', name: 'Moon Gravity', desc: 'Low gravity: bumps and ramps launch you.' },
  fuse: { id: 'fuse', icon: '⏳', name: 'Short Fuse', desc: 'Stroke limit is par + 2.' },
};

export const REWARD_IDS = ['heal', 'dust', 'trinket', 'vitality', 'gamble'] as const;
export type RewardId = (typeof REWARD_IDS)[number];

export const REWARDS: Record<RewardId, { id: RewardId; icon: string; name: string; desc: string }> = {
  heal: { id: 'heal', icon: '❤️', name: 'Picnic', desc: 'Heal 2 hearts (1 solo, more for bigger teams).' },
  dust: { id: 'dust', icon: '✨', name: 'Stardust Cache', desc: '+12 stardust.' },
  trinket: { id: 'trinket', icon: '🎁', name: 'Trinket', desc: 'Choose 1 of 3 trinkets.' },
  vitality: { id: 'vitality', icon: '💖', name: 'Vitality', desc: '+1 max heart and heal 1.' },
  gamble: { id: 'gamble', icon: '🎲', name: 'Mystery Box', desc: 'Maybe a rare trinket… or 25 stardust.' },
};

/** Permanent Clubhouse upgrades bought with stardust. */
export const UPGRADES = {
  vigor: { icon: '❤️', name: 'Hearty Breakfast', desc: '+1 starting heart per rank.', costs: [20, 45, 80] },
  secondwind: {
    icon: '🔥',
    name: 'Second Wind',
    desc: 'Once per run, get back up with 3 hearts (2 solo, more for bigger teams).',
    costs: [90],
  },
  dice: {
    icon: '🎲',
    name: 'Lucky Dice',
    desc: '+1 reroll per run for forks and trinket picks.',
    costs: [30, 70],
  },
  wide: { icon: '🃏', name: 'Wider Draft', desc: 'Trinket picks offer 4 choices.', costs: [60] },
  pockets: { icon: '💰', name: 'Deep Pockets', desc: '+25% stardust per rank.', costs: [40, 90] },
  cartographer: { icon: '🗺️', name: 'Cartographer', desc: 'Forks offer a third route.', costs: [110] },
} as const;
export type UpgradeId = keyof typeof UPGRADES;
export const UPGRADE_IDS = Object.keys(UPGRADES) as UpgradeId[];

export const SECTORS = 4;
export const HOLES_PER_SECTOR = 3; // + 1 boss
export type StageKind = 'hole' | 'boss' | 'rest';

/** The run's fixed skeleton: 3 holes + boss per sector, a rest stop between sectors. */
export const SKELETON: { kind: StageKind; sector: number }[] = (() => {
  const out: { kind: StageKind; sector: number }[] = [];
  for (let s = 0; s < SECTORS; s++) {
    for (let i = 0; i < HOLES_PER_SECTOR; i++) out.push({ kind: 'hole', sector: s });
    out.push({ kind: 'boss', sector: s });
    if (s < SECTORS - 1) out.push({ kind: 'rest', sector: s });
  }
  return out;
})();
/** Golf stages (difficulty steps) in a full run. */
export const MAX_DEPTH = SKELETON.filter((s) => s.kind !== 'rest').length - 1;

const Trinket = z.enum(TRINKET_IDS);
const Omen = z.enum(OMEN_IDS);
const Reward = z.enum(REWARD_IDS);

/** Everything needed to regenerate a stage's hole deterministically on every machine. */
export const StageSpecSchema = z.object({
  kind: z.enum(['hole', 'boss', 'rest']),
  sector: z.number().int().min(0).max(9),
  world: z.string().max(20),
  depth: z.number().int().min(0).max(99),
  variant: z.number().int().min(0).max(999),
  omen: Omen.nullable(),
  reward: Reward.nullable(),
  /** Trinkets that shape the hole itself (cup size, power, sand); one copy per level. */
  shaping: z.array(Trinket).max(48),
  /** Rest stops: the reward in each crate. */
  crates: z.array(Reward).max(3).optional(),
});
export type StageSpec = z.infer<typeof StageSpecSchema>;

export const ChoiceOptionSchema = z.object({
  reward: Reward.nullable().optional(),
  omen: Omen.nullable().optional(),
  trinket: Trinket.optional(),
  /** Trinket picks: the level it reaches if chosen (2+ means a level-up of one you own). */
  level: z.number().int().min(1).max(3).optional(),
  /** Route previews: par and name of the hole behind this door. */
  par: z.number().int().optional(),
  name: z.string().max(40).optional(),
});
export type ChoiceOption = z.infer<typeof ChoiceOptionSchema>;

export const HopperStateSchema = z.object({
  seed: z.number().int(),
  stage: z.number().int(),
  stages: z.array(StageSpecSchema).max(64),
  hearts: z.number().int(),
  maxHearts: z.number().int(),
  dust: z.number().int(),
  trinkets: z.array(Trinket).max(24),
  /** Trinket levels this run (1..3); missing = 1. */
  levels: z.record(z.string(), z.number().int().min(1).max(3)).default({}),
  rerolls: z.number().int(),
  secondWind: z.boolean(),
  strokeLimit: z.number().int(),
  choice: z
    .object({
      kind: z.enum(['route', 'trinket']),
      title: z.string().max(60),
      options: z.array(ChoiceOptionSchema).max(4),
      votes: z.record(z.string(), z.number().int()),
      secondsLeft: z.number(),
      /**
       * The option a strict majority of connected players is on right now (3+ players), which
       * cut the countdown to MAJORITY_SECONDS. Optional: older peers neither send nor need it.
       */
      majority: z.number().int().optional(),
    })
    .nullable(),
  /** Hearts gained/lost on the last finished hole: entrant -> delta, plus the team net. */
  lastDelta: z.object({ by: z.record(z.string(), z.number().int()), net: z.number().int() }).nullable(),
  result: z.enum(['running', 'won', 'lost']),
});
export type HopperState = z.infer<typeof HopperStateSchema>;

export const HopperProfileSchema = z.object({
  dustEarned: z.number().int().nonnegative(),
  dustSpent: z.number().int().nonnegative(),
  upgrades: z.record(z.string(), z.number().int().nonnegative()),
  keepsake: z.string().max(20).nullable(),
  discovered: z.array(z.string().max(20)).max(64),
  runs: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  bestStage: z.number().int().nonnegative(),
});
export type HopperProfile = z.infer<typeof HopperProfileSchema>;

export const defaultHopperProfile = (): HopperProfile => ({
  dustEarned: 0,
  dustSpent: 0,
  upgrades: {},
  keepsake: null,
  discovered: [],
  runs: 0,
  wins: 0,
  bestStage: 0,
});

export function dustBalance(h: HopperProfile): number {
  return h.dustEarned - h.dustSpent;
}

export function upgradeRank(h: HopperProfile | undefined, id: UpgradeId): number {
  return Math.min(UPGRADES[id].costs.length, h?.upgrades[id] ?? 0);
}

export function isTrinket(id: string | null | undefined): id is TrinketId {
  return !!id && (TRINKET_IDS as readonly string[]).includes(id);
}
