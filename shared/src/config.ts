/**
 * Every balance knob in the game lives here: physics feel, rules, XP curve, prices, unlock gates.
 * Tuning notes are kept in docs/PROGRESS.md.
 */

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 20; // Hz, server -> client ball state

export type SurfaceKind = 'grass' | 'sand' | 'ice' | 'sticky' | 'rubber' | 'metal' | 'candy';

export interface SurfaceParams {
  /** Constant deceleration (units/s^2) while touching the ground: rolling resistance. */
  rolling: number;
  /** Velocity-proportional drag (1/s). */
  drag: number;
  /** Restitution of the collider. */
  restitution: number;
  /** Multiplier on the speed below which the ball is allowed to settle. */
  settle: number;
}

export const PHYSICS = {
  gravity: -14,
  ballRadius: 0.16,
  ballMass: 1,
  /** Shot speed at power = 1 (units/s). */
  maxShotSpeed: 17,
  /** Shot speed curve exponent: power^curve gives finer control on short putts. */
  powerCurve: 1.35,
  minPower: 0.03,
  /** Speed below which the ball may settle (units/s). */
  settleSpeed: 0.16,
  /** How long it must stay below settleSpeed (s). */
  settleTime: 0.22,
  /** Slope (normal.y) above which a slow ball is considered resting even on a gentle incline. */
  settleFlatness: 0.985,
  /** Hard cap: a shot cannot last longer than this (s) before we force rest. */
  maxShotTime: 25,
  /** Extra air drag (1/s). */
  airDrag: 0.05,
  /** High-speed damping: above this speed, add drag proportional to the excess. */
  highSpeed: 14,
  highSpeedDrag: 0.6,
  maxSpeed: 30,
  wallRestitution: 0.72,
  floorRestitution: 0.12,
  bumperBoost: 7,
  cupRadius: 0.27,
  /** Maximum speed at which a ball dropping over the cup will fall in. */
  sinkSpeed: 4.4,
  /** Pull towards the cup centre when nearby and slow (units/s^2). */
  cupPull: 3.0,
  cupPullRadius: 0.45,
  lipOutSpeedKeep: 0.72,
  /** Stuck detection: moving for this long with less than stuckDistance net displacement. */
  stuckTime: 3.5,
  stuckDistance: 0.35,
  teleportCooldown: 0.6,
} as const;

export const SURFACES: Record<SurfaceKind, SurfaceParams> = {
  grass: { rolling: 1.15, drag: 0.32, restitution: 0.12, settle: 1 },
  candy: { rolling: 1.0, drag: 0.28, restitution: 0.15, settle: 1 },
  metal: { rolling: 0.8, drag: 0.22, restitution: 0.2, settle: 1 },
  rubber: { rolling: 1.6, drag: 0.4, restitution: 0.5, settle: 1 },
  sand: { rolling: 6.0, drag: 2.2, restitution: 0.02, settle: 2.2 },
  sticky: { rolling: 4.5, drag: 3.6, restitution: 0.0, settle: 2.5 },
  ice: { rolling: 0.12, drag: 0.04, restitution: 0.1, settle: 0.6 },
};

export const RULES = {
  /** Stroke limit = par + this. */
  strokeLimitOverPar: 6,
  /** Penalty strokes for water / out of bounds. */
  hazardPenalty: 1,
  /** Seconds to show hole results before auto-advancing. */
  holeEndDelay: 4.5,
  /** Minimum time between two shots from one client (anti-spam), seconds. */
  shotCooldown: 0.25,
  maxPlayers: 6,
  reconnectWindowSec: 60,
  chatMaxLength: 120,
  chatRatePerSec: 1.5,
} as const;

// ---------------------------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------------------------

export const XP = {
  holeFinished: 20,
  perStrokeUnderPar: 15,
  holeInOne: 100,
  coin: 2,
  gem: 25,
  golden: 120,
  crate: 30,
  courseComplete: 80,
  starBonus: 40,
  teamBonusPerExtraPlayer: 0.15, // +15% XP per extra teammate
  dailyComplete: 150,
  dailyUnderPar: 100,
} as const;

/** XP required to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.round(120 + 60 * Math.pow(level - 1, 1.35));
}

export const COINS = {
  coinPickup: 1,
  holeFinished: 3,
  underPar: 5,
  holeInOne: 25,
  gemPickup: 15,
  gemDuplicate: 4,
  goldenPickup: 60,
  goldenDuplicate: 10,
  crateDuplicate: 25,
  levelUp: 40,
} as const;

/** Worlds unlock when EITHER the level OR the star total is reached. */
export const WORLD_GATES: Record<string, { level: number; stars: number }> = {
  meadow: { level: 1, stars: 0 },
  candy: { level: 3, stars: 3 },
  frozen: { level: 6, stars: 6 },
  clockwork: { level: 9, stars: 9 },
  space: { level: 12, stars: 12 },
};

export const NET = {
  /** Client renders remote state this far in the past (ms). */
  interpDelayMs: 110,
  pingIntervalMs: 2000,
  maxMessageBytes: 4096,
  maxMessagesPerSec: 60,
} as const;
