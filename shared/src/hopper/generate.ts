import {
  HoleSchema,
  type Collectible,
  type Course,
  type Decor,
  type Hole,
  type Obstacle,
  type Solid,
  type Theme,
  type Vec3,
  type Zone,
} from '../schema';
import { COURSES } from '../courses/index';
import {
  FLOOR_T,
  WALL_T,
  beam,
  coinLine,
  decor,
  fairway,
  item,
  makeHole,
  pillar,
  ribbon,
  room,
  wall,
  zone,
} from '../courses/builder';
import { hashString, pick, range, rng } from '../rng';
import { MAX_DEPTH, countLevel, type OmenId, type RewardId, type StageSpec, type TrinketId } from './defs';

/**
 * Procedural holes for Planet Hopper. A hole is a pure function of (run seed, stage index,
 * stage spec), so the host and every client build identical geometry from a few bytes.
 * Difficulty rises with depth: more and longer segments, narrower fairways, faster machinery,
 * ramps, water beside open edges, ice and conveyors.
 */

const NAMES: Record<string, [string[], string[]]> = {
  meadow: [
    ['Clover', 'Bramble', 'Buttercup', 'Dandelion', 'Mossy', 'Honey', 'Thistle', 'Willow'],
    ['Bend', 'Hollow', 'Meander', 'Ramble', 'Dell', 'Lane', 'Knoll', 'Run'],
  ],
  candy: [
    ['Gumdrop', 'Taffy', 'Fudge', 'Sherbet', 'Toffee', 'Caramel', 'Licorice', 'Sprinkle'],
    ['Swirl', 'Drop', 'Alley', 'Twist', 'Ripple', 'Crunch', 'Lane', 'Loop'],
  ],
  frozen: [
    ['Frosty', 'Glacier', 'Icicle', 'Blizzard', 'Snowdrift', 'Aurora', 'Polar', 'Sleet'],
    ['Slide', 'Pass', 'Crevasse', 'Ridge', 'Rink', 'Chute', 'Drift', 'Peak'],
  ],
  clockwork: [
    ['Cog', 'Sprocket', 'Piston', 'Brass', 'Gizmo', 'Ratchet', 'Gear', 'Spring'],
    ['Works', 'Junction', 'Gauntlet', 'Foundry', 'Mill', 'Circuit', 'Shaft', 'Loop'],
  ],
  space: [
    ['Comet', 'Nebula', 'Quasar', 'Meteor', 'Orbit', 'Pulsar', 'Nova', 'Stardust'],
    ['Drift', 'Belt', 'Rim', 'Halo', 'Crossing', 'Reach', 'Corridor', 'Spiral'],
  ],
};
const BOSS_NAMES: Record<string, string> = {
  meadow: 'The Old Windmill',
  candy: 'Sugar Rush Gauntlet',
  frozen: 'The Glacier King',
  clockwork: 'The Grand Escapement',
  space: 'Event Horizon',
};

export function worldTheme(world: string): Theme {
  return (COURSES.find((c) => c.world === world) ?? COURSES[0]).theme;
}

/** Run level (0..3) of a hole-shaping trinket for this stage. */
const lv = (spec: StageSpec, t: TrinketId) => countLevel(spec.shaping, t);

/** Hole for one stage of a run. */
export function stageHole(seed: number, index: number, spec: StageSpec): Hole {
  const input = spec.kind === 'rest' ? restHole(seed, index, spec) : golfHole(seed, index, spec);
  // Storm Compass softens omens by level; at Lv3 they have no effect at all.
  const g = lv(spec, 'compass');
  const theme: Theme = structuredClone(worldTheme(spec.world));
  let cupScale = 1 + [0, 0.35, 0.5, 0.65][lv(spec, 'magnet')];
  let powerScale = 1 + [0, 0.18, 0.26, 0.34][lv(spec, 'glove')];
  let wind: [number, number] = [0, 0];
  let gravityScale = 1;
  const omen: OmenId | null = spec.omen;
  const r = rng(hashString(`hop-omen:${seed}:${index}`));
  switch (omen) {
    case 'tiny':
      cupScale *= [0.75, 0.85, 0.92, 1][g];
      break;
    case 'heavy':
      powerScale *= [0.8, 0.9, 0.95, 1][g];
      break;
    case 'gale': {
      const a = r() * Math.PI * 2;
      const m = [0.85, 0.45, 0.25, 0][g];
      wind = [Math.cos(a) * m, Math.sin(a) * m];
      break;
    }
    case 'fog': {
      if (g >= 3) break;
      // Thick: the ball (about 4.5 m from the camera) stays visible, the cup is lost past ~10 m.
      const [near, far] = (
        [
          [3, 11],
          [4.5, 17],
          [6, 24],
        ] as const
      )[g];
      theme.fogNear = near;
      theme.fogFar = far;
      const grey: Record<string, string> = {
        meadow: '#c9d2cf',
        candy: '#e8d3df',
        frozen: '#d5e0e8',
        clockwork: '#b9aa9c',
        space: '#3a3658',
      };
      theme.fog = grey[theme.decorKit] ?? '#c9d2cf';
      break;
    }
    case 'moon':
      gravityScale = [0.55, 0.75, 0.87, 1][g];
      break;
    case 'slick':
      if (g < 3)
        for (const s of input.solids as Solid[]) if (s.role === 'floor') s.surface = g ? 'metal' : 'ice';
      break;
    default:
      break;
  }
  return HoleSchema.parse({ ...input, theme, cupScale, powerScale, wind, gravityScale });
}

/** Signature mechanics that turn up on some legs of a hole. */
type Special =
  | 'ramp'
  | 'hump'
  | 'valley'
  | 'climb'
  | 'split'
  | 'jump'
  | 'plaza'
  | 'stream'
  | 'lake'
  | 'fork'
  | 'spiral'
  | 'slide'
  | 'drop'
  | 'leap'
  | 'loop';
/** What each polyline segment is (features only go on plain 'flat' stretches). */
type SegTag =
  | 'flat'
  | 'landing'
  | 'ramp'
  | 'arc'
  | 'kicker'
  | 'gap'
  | 'split'
  | 'plaza'
  | 'lake'
  | 'stream'
  | 'fork'
  | 'lead'
  | 'spiral'
  | 'slide'
  | 'drop'
  | 'loop';
type Feature =
  | 'sand'
  | 'bumpers'
  | 'boost'
  | 'spinner'
  | 'mover'
  | 'windmill'
  | 'pools'
  | 'ice'
  | 'conveyor'
  | 'gate'
  | 'pillars'
  | 'sticky';

/** Lanes of a forked fairway: one steady route, one quick-but-risky route. */
type LaneKind = 'sand' | 'slalom' | 'hill' | 'bumpers' | 'bridge' | 'boost' | 'jump' | 'machine' | 'ice';
const SAFE_LANES: LaneKind[] = ['sand', 'slalom', 'hill', 'bumpers'];
const LANE_TIP: Record<LaneKind, string> = {
  sand: 'sand traps',
  slalom: 'a pillar slalom',
  hill: 'a big hill',
  bumpers: 'a couple of bumpers',
  bridge: 'a narrow bridge',
  boost: 'speed pads along the water',
  jump: 'a jump over the water',
  machine: 'machinery',
  ice: 'slick ice along the water',
};

interface ForkPlan {
  /** Length from where the lanes split to where they rejoin. */
  m: number;
  /** Length of the swoop out (and back in) at each end. */
  sweep: number;
  /** Lane centre offsets from the axis on the straight middle part: lane 0 left, lane 1 right. */
  hs: [number, number];
  rin: number;
  rout: number;
  lanes: [LaneKind, LaneKind];
}

/** A corkscrew round a tower: one full turn down to a lower tier. */
interface SpiralPlan {
  /** +1: the tower is to the left of the leg. */
  side: 1 | -1;
  /** Track centreline radius. */
  R: number;
  /** Lead-in before the corkscrew starts. */
  lead: number;
}

interface Leg {
  a: Vec3;
  b: Vec3;
  ang: number;
  len: number;
  special: Special | null;
  dy: number;
  fork?: ForkPlan;
  spiral?: SpiralPlan;
  /** Sideways swing of a slide. */
  amp?: number;
  /** A leap launched by a spring pad (up to a much higher ledge) instead of a kicker ramp. */
  spring?: boolean;
}

const SPECIAL_LEN: Record<Exclude<Special, 'fork' | 'spiral'>, number> = {
  ramp: 6.5,
  hump: 9.5,
  valley: 9.5,
  climb: 10,
  split: 10,
  jump: 11.5,
  plaza: 10,
  stream: 9,
  lake: 11,
  slide: 12,
  drop: 7,
  leap: 12,
  loop: 10.5,
};
/** Par difficulty points per special. */
const SPECIAL_DIFF: Record<Special, number> = {
  ramp: 0.3,
  hump: 0.6,
  valley: 0.4,
  climb: 0.8,
  split: 0.5,
  jump: 1.5,
  plaza: 0.8,
  stream: 1.2,
  lake: 1.0,
  fork: 1.0,
  spiral: 0.6,
  slide: 0.5,
  drop: 0.3,
  leap: 1.6,
  loop: 1.2,
};
/** Specials that may turn up more than once on a hole. */
const REPEATABLE: Special[] = ['ramp', 'climb', 'hump', 'stream', 'drop', 'slide'];
/** Specials that change the height of the course. */
const ELEVATION: Special[] = ['ramp', 'climb', 'spiral', 'slide', 'drop', 'leap'];

/** Whole-hole personalities, so neighbouring holes feel different. */
export type Archetype =
  | 'classic'
  | 'fork'
  | 'switchback'
  | 'drive'
  | 'summit'
  | 'waterworks'
  | 'gauntlet'
  | 'funhouse'
  | 'skyway';

interface ArchStyle {
  minDepth: number;
  /** Extra legs. */
  legs: number;
  /** Base leg length range. */
  len: [number, number];
  width: number;
  specialChance: number;
  maxSpecials: number;
  specials: Partial<Record<Special, number>>;
  /** Extra copies of features in the hazard pool. */
  features: Partial<Record<Feature, number>>;
  featureChance: number;
  /** Chance of 45° turns. */
  diag: number;
  /** Added to the chance a corner is rounded into a curve. */
  round: number;
  nouns: string[];
}

const style = (s: Partial<ArchStyle>): ArchStyle => ({
  minDepth: 0,
  legs: 0,
  len: [5.5, 8.5],
  width: 0,
  specialChance: 0,
  maxSpecials: 0,
  specials: {},
  features: {},
  featureChance: 0,
  diag: 0.3,
  round: 0,
  nouns: [],
  ...s,
});

const ARCH: Record<Archetype, ArchStyle> = {
  classic: style({}),
  fork: style({
    minDepth: 2,
    legs: -1,
    len: [5, 7.5],
    specialChance: -0.1,
    featureChance: -0.1,
    diag: 0.2,
    nouns: ['Crossroads', 'Fork', 'Divide', 'Junction'],
  }),
  switchback: style({
    minDepth: 1,
    legs: 2,
    len: [4.5, 6.5],
    width: -0.15,
    specialChance: -0.15,
    specials: { ramp: 1, valley: 0.5, drop: 0.6 },
    features: { pillars: 1 },
    featureChance: -0.15,
    diag: 0.55,
    round: -0.1,
    nouns: ['Zigzag', 'Switchback', 'Hairpins', 'Maze'],
  }),
  drive: style({
    legs: -1,
    len: [9, 12.5],
    width: 0.35,
    specialChance: 0.15,
    specials: { jump: 2, ramp: 1, stream: 0.8, slide: 1 },
    features: { boost: 3 },
    diag: 0.15,
    round: 0.2,
    nouns: ['Straightaway', 'Express', 'Long Drive', 'Runway'],
  }),
  summit: style({
    minDepth: 1,
    len: [6, 9],
    width: 0.1,
    specialChance: 0.45,
    maxSpecials: 2,
    specials: { ramp: 2, climb: 2.5, hump: 1, valley: 1, drop: 1, spiral: 0.8 },
    featureChance: -0.1,
    diag: 0.25,
    round: 0.15,
    nouns: ['Summit', 'Heights', 'Terraces', 'Climb'],
  }),
  waterworks: style({
    minDepth: 2,
    len: [6, 9],
    width: 0.1,
    specialChance: 0.35,
    maxSpecials: 1,
    specials: { stream: 3, lake: 2.5, jump: 0.8, leap: 0.5 },
    features: { pools: 3 },
    round: 0.1,
    nouns: ['Lagoon', 'Rapids', 'Brook', 'Falls'],
  }),
  gauntlet: style({
    minDepth: 3,
    len: [6, 9],
    width: -0.1,
    specialChance: -0.1,
    features: { windmill: 2, gate: 2, mover: 2, spinner: 2, conveyor: 1 },
    featureChance: 0.35,
    diag: 0.25,
    nouns: ['Gauntlet', 'Grinder', 'Machine', 'Clockworks'],
  }),
  funhouse: style({
    minDepth: 1,
    len: [6, 9],
    width: 0.1,
    specialChance: 0.4,
    maxSpecials: 1,
    specials: { loop: 2.5, spiral: 2.5, slide: 1.5 },
    featureChance: -0.2,
    round: 0.2,
    nouns: ['Funhouse', 'Twister', 'Corkscrew', 'Tubes'],
  }),
  skyway: style({
    minDepth: 2,
    len: [6, 9],
    specialChance: 0.4,
    maxSpecials: 1,
    specials: { drop: 2.5, leap: 2, jump: 1, climb: 1 },
    featureChance: -0.15,
    round: 0.1,
    nouns: ['Skyway', 'Ledges', 'Cascade', 'Tiers'],
  }),
};
export const ARCHETYPES = Object.keys(ARCH) as Archetype[];

/**
 * The personality of a stage's hole. Stages walk a per-run shuffled deck (four steps at a
 * time, so neighbouring stages and the options of one route vote never share an archetype).
 */
export function holeArchetype(seed: number, index: number, spec: StageSpec): Archetype {
  if (spec.kind !== 'hole') return 'classic';
  const deck = ARCHETYPES.slice();
  const r = rng(hashString(`deck:${seed}`));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  // 4 is coprime with the deck size, so every route option walks the whole deck.
  const a = deck[(index * 4 + spec.variant) % deck.length];
  return spec.depth >= ARCH[a].minDepth ? a : 'classic';
}

/** Every boss has a set piece from its planet and leans on its planet's heaviest machinery. */
const BOSS_SPECIAL: Record<string, Special> = {
  meadow: 'stream',
  candy: 'loop',
  frozen: 'lake',
  clockwork: 'fork',
  space: 'jump',
};
const BOSS_HEAVY: Record<string, Feature[]> = {
  meadow: ['windmill', 'spinner', 'mover'],
  candy: ['spinner', 'mover', 'sticky'],
  frozen: ['windmill', 'ice', 'spinner'],
  clockwork: ['gate', 'mover', 'windmill', 'conveyor'],
  space: ['spinner', 'gate', 'windmill'],
};
const TOWER: Record<string, string> = {
  meadow: '#8a6a4a',
  candy: '#f3a6c4',
  frozen: '#bcdcec',
  clockwork: '#b08d57',
  space: '#6d6a99',
};
const BRIDGE: Record<string, string> = {
  meadow: '#a0703f',
  candy: '#e98fb4',
  frozen: '#9fc6dd',
  clockwork: '#a17d45',
  space: '#7d7aa8',
};
const ISLET: Record<string, string> = {
  meadow: 'rock',
  candy: 'gumdrop',
  frozen: 'iceblock',
  clockwork: 'gear',
  space: 'spacerock',
};

const norm = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function wpick<T>(r: () => number, items: [T, number][]): T | null {
  const total = items.reduce((a, [, w]) => a + w, 0);
  if (total <= 0) return null;
  let x = r() * total;
  for (const [v, w] of items) if ((x -= w) <= 0) return v;
  return items[items.length - 1][0];
}

function planFork(
  r: () => number,
  W: number,
  depth: number,
  socks: number,
  first: boolean,
  last: boolean,
): ForkPlan {
  const safe = SAFE_LANES.filter((k) => !(k === 'sand' && socks));
  const risky: LaneKind[] = ['bridge', 'boost'];
  if (depth >= 3) risky.push('jump', 'machine');
  if (depth >= 4 && socks < 2) risky.push('ice');
  const a = pick(r, safe);
  const b = pick(r, risky);
  const lanes: [LaneKind, LaneKind] = r() < 0.5 ? [a, b] : [b, a];
  // The lanes swoop apart round a wide lagoon, run side by side, then swoop back together.
  // The steady lane swings out further (it's the long way round).
  const base = W / 2 + range(r, 2.4, 3.4);
  const wider = range(r, 0.5, 1.6);
  const hs = lanes.map((k) => base + (SAFE_LANES.includes(k) ? wider : 0)) as [number, number];
  const sweep = Math.min(7, Math.max(4.5, 1.25 * Math.max(...hs)));
  const straight = range(r, 8.5, 10.5 + depth / 5) + (lanes.includes('jump') || lanes.includes('hill') ? 1.5 : 0);
  const m = Math.round(straight + 2 * sweep);
  return { m, sweep, hs, rin: first ? 2.6 : 3.2, rout: last ? 3.6 : 3.2, lanes };
}

/** Lateral offset of a fork lane `s` metres after the split (smooth swoop out and back in). */
function forkLat(F: ForkPlan, k: number, s: number): number {
  const h = F.hs[k];
  const e = s < F.sweep ? s / F.sweep : s > F.m - F.sweep ? (F.m - s) / F.sweep : 1;
  return (h * (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, e))))) / 2;
}

/** Set pieces of the most recently generated hole (for tests and tooling). */
export let lastHoleSpecials: string[] = [];

function golfHole(seed: number, index: number, spec: StageSpec) {
  const r = rng(hashString(`hop:${seed}:${index}:${spec.variant}`));
  const t = Math.min(1, spec.depth / MAX_DEPTH);
  const depth = spec.depth;
  const boss = spec.kind === 'boss';
  const arch = holeArchetype(seed, index, spec);
  const st = ARCH[arch];
  const W = Math.max(1.6, (boss ? 2.3 : 2.6) - 0.75 * t + st.width);
  const holeId = `hop${seed}-${index}`;
  const socks = lv(spec, 'socks');
  const world = spec.world;
  const nLegs = Math.max(
    2,
    Math.min(7, 2 + Math.round(t * 2.5) + (r() < 0.5 ? 1 : 0) + (boss ? 1 : 0) + st.legs),
  );
  const laneW = Math.max(1.2, W * 0.72);
  const splitW = laneW * 2 + WALL_T;
  const plazaW = W * 1.6 + 1.4;
  const pondW = 2.2 + 0.6 * t;
  const sideW = Math.max(1.15, W * 0.55);
  const lakeW = pondW + sideW * 2;

  // ---- 1. Legs: straight runs in 8 directions, turning ±90° (sometimes ±45°), never crossing.
  const weights = new Map<Special, number>();
  const addW = (s: Special, w: number) => weights.set(s, (weights.get(s) ?? 0) + w);
  addW('ramp', 1.3);
  if (depth >= 1) {
    addW('hump', 0.8);
    addW('valley', 0.6);
  }
  if (depth >= 2) {
    addW('climb', 0.6);
    addW('split', 0.6);
    addW('stream', 0.7);
  }
  if (depth >= 3) {
    addW('jump', 0.8);
    addW('lake', 0.5);
  }
  if (depth >= 1) {
    addW('drop', 0.7);
    addW('slide', 0.6);
  }
  if (depth >= 2) {
    addW('spiral', 0.5);
    addW('loop', 0.5);
  }
  if (depth >= 4) {
    addW('plaza', 0.3);
    addW('leap', 0.5);
  }
  if (depth >= 8) {
    addW('jump', 0.4);
    addW('split', 0.3);
    addW('lake', 0.3);
  }
  for (const [s, w] of Object.entries(st.specials) as [Special, number][])
    if (s !== 'jump' || depth >= 2) addW(s, w);

  const forced = new Map<number, Special>();
  if (arch === 'fork') forced.set(nLegs >= 3 ? 1 : 0, 'fork');
  if (boss) forced.set(Math.min(nLegs - 1, 1 + (r() < 0.5 ? 1 : 0)), BOSS_SPECIAL[world] ?? 'jump');
  const maxSpecials = 1 + (t > 0.3 ? 1 : 0) + (boss ? 1 : 0) + st.maxSpecials;
  const specialChance = 0.32 + 0.35 * t + (boss ? 0.15 : 0) + st.specialChance;

  const usedSpecials: Special[] = [];
  const legs: Leg[] = [];
  /**
   * Footprints of placed legs (centre segment + half width) so later legs keep clear. A strict
   * footprint (a spiral tower) is kept clear even of the neighbouring legs.
   */
  const feet: { a: Vec3; b: Vec3; half: number; leg: number; strict?: boolean }[] = [];
  const segDist = (p: Vec3, a: Vec3, b: Vec3) => {
    const abx = b[0] - a[0],
      abz = b[2] - a[2];
    const l2 = abx * abx + abz * abz || 1e-9;
    const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[2] - a[2]) * abz) / l2));
    return Math.hypot(p[0] - a[0] - abx * k, p[2] - a[2] - abz * k);
  };
  let dir = 0;
  let cur: Vec3 = [0, 0, 0];
  for (let i = 0; i < nLegs; i++) {
    const last = i === nLegs - 1;
    let placed = false;
    for (let attempt = 0; attempt < 2 && !placed; attempt++) {
      let special: Special | null = null;
      if (attempt === 0) {
        const want = forced.get(i);
        if (want) special = want;
        else if (i > 0 && usedSpecials.length < maxSpecials && r() < specialChance)
          special = wpick(
            r,
            [...weights].map(([s, w]) => [
              s,
              w * (usedSpecials.includes(s) ? (REPEATABLE.includes(s) ? 0.5 : 0) : 1),
            ]),
          );
      }
      const fork = special === 'fork' ? planFork(r, W, depth, socks, i === 0, last) : undefined;
      let spiral: SpiralPlan | undefined;
      if (special === 'spiral') {
        const R = W / 2 + range(r, 1.0, 1.4);
        spiral = { side: r() < 0.5 ? 1 : -1, R, lead: R + W / 2 + 1.0 };
      }
      const amp = special === 'slide' ? range(r, 0.5, 1.1) * (r() < 0.5 ? 1 : -1) : 0;
      const spring = special === 'leap' && r() < 0.5;
      let len = Math.round(range(r, st.len[0], st.len[1] + t * 2));
      if (fork) len = Math.ceil(fork.rin + fork.m + fork.rout);
      else if (spiral) len = Math.ceil(spiral.lead + 3.5 + W / 2 + (last ? 2.5 : 0) + range(r, 0, 1.5));
      else if (special && special !== 'fork' && special !== 'spiral')
        len = Math.max(len, Math.ceil(SPECIAL_LEN[special] + (last ? 2 : 0) + range(r, 0, 1.5)));
      const up = arch === 'summit' ? 0.8 : 0.55;
      const sgn = r() < up ? 1 : -1;
      const dy =
        special === 'ramp'
          ? sgn * (t > 0.5 && r() < 0.5 ? 0.9 : 0.5)
          : special === 'climb'
            ? sgn * (t > 0.4 ? 1.3 : 1.0)
            : special === 'spiral'
              ? -range(r, 1.6, 2.0)
              : special === 'slide'
                ? -range(r, 1.2, 1.7 + 0.4 * t)
                : special === 'drop'
                  ? -range(r, 0.7, 1.1)
                  : special === 'leap'
                    ? spring
                      ? range(r, 0.8, 1.1)
                      : range(r, 0.3, 0.45)
                    : 0;
      const diag = i > 0 && !fork && r() < st.diag;
      const quarter = diag ? Math.PI / 4 : Math.PI / 2;
      const turns = i === 0 || fork ? [0] : r() < 0.5 ? [quarter, -quarter, 0] : [-quarter, quarter, 0];
      const half =
        special === 'lake'
          ? lakeW / 2
          : special === 'plaza'
            ? plazaW / 2
            : special === 'split'
              ? splitW / 2
              : W / 2 + Math.abs(amp);
      for (const turn of turns) {
        const d = dir + turn;
        const ux = Math.cos(d),
          uz = Math.sin(d);
        const b: Vec3 = [cur[0] + ux * len, cur[1] + dy, cur[2] + uz * len];
        const mine: { a: Vec3; b: Vec3; half: number; strict?: boolean }[] = [{ a: cur, b, half }];
        const p = (s: number): Vec3 => [cur[0] + ux * s, cur[1], cur[2] + uz * s];
        if (fork)
          mine.push({
            a: p(fork.rin + 0.5),
            b: p(fork.rin + fork.m - 0.5),
            half: Math.max(...fork.hs) + W / 2 + WALL_T,
          });
        if (spiral) {
          const c = p(spiral.lead);
          const C: Vec3 = [c[0] - uz * spiral.side * spiral.R, c[1], c[2] + ux * spiral.side * spiral.R];
          mine.push({ a: C, b: C, half: spiral.R + W / 2 + WALL_T, strict: true });
        }
        let clash = false;
        for (const m of mine) {
          const l = Math.hypot(m.b[0] - m.a[0], m.b[2] - m.a[2]);
          const n = Math.max(1, Math.ceil(l / 0.5));
          for (let k = 0; k <= n && !clash; k++) {
            const q: Vec3 = [m.a[0] + ((m.b[0] - m.a[0]) * k) / n, 0, m.a[2] + ((m.b[2] - m.a[2]) * k) / n];
            for (const f of feet) {
              if (f.leg === i - 1 && !f.strict && !m.strict) continue;
              if (f.leg === i) continue;
              if (segDist(q, f.a, f.b) < f.half + m.half + (f.strict || m.strict ? 0.3 : 0.9)) {
                clash = true;
                break;
              }
            }
          }
        }
        if (clash) continue;
        for (const m of mine) feet.push({ ...m, leg: i });
        legs.push({ a: cur, b, ang: d, len, special, dy, fork, spiral, amp, spring });
        if (special) usedSpecials.push(special);
        dir = d;
        cur = b;
        placed = true;
        break;
      }
    }
    if (!placed) break;
  }

  // ---- 2. Corners: round most of them into smooth curves (always flat at the corner).
  const trimIn: number[] = legs.map(() => 0); // trim at the start of leg i
  const trimOut: number[] = legs.map(() => 0); // trim at the end of leg i
  const arcs: (Vec3[] | null)[] = legs.map(() => null); // arc points before leg i
  let curves = 0;
  let sharp = 0;
  for (let i = 1; i < legs.length; i++) {
    const prev = legs[i - 1],
      next = legs[i];
    const th = norm(next.ang - prev.ang);
    if (Math.abs(th) < 1e-3) continue;
    // Most corners sweep round in a curve: the course should flow.
    if (r() > 0.82 + st.round + (Math.abs(th) < 1 ? 0.2 : 0)) {
      sharp++;
      continue;
    }
    const tanH = Math.tan(Math.abs(th) / 2);
    const R0 = Math.abs(th) > 1 ? range(r, 2.4, 4.2) : range(r, 3.5, 6);
    // Never eat into the room a special needs (a ramp must keep its gentle slope).
    const room = (leg: Leg, k: number, atStart: boolean) => {
      const tail = k === legs.length - 1 ? 2.5 : 0;
      if (leg.fork) return (atStart ? leg.fork.rin : leg.fork.rout) - 0.6;
      if (leg.spiral) return atStart ? 0.6 : Math.max(0, leg.len - leg.spiral.lead - 3.5 - W / 2 - tail);
      if (leg.special && leg.special !== 'fork' && leg.special !== 'spiral')
        return Math.max(0, (leg.len - SPECIAL_LEN[leg.special] - tail) / 2);
      return leg.len * 0.42;
    };
    const d = Math.min(R0 * tanH, room(prev, i - 1, false), room(next, i, true));
    const R = d / tanH;
    if (R < 1.3) {
      sharp++;
      continue;
    }
    curves++;
    trimOut[i - 1] = d;
    trimIn[i] = d;
    const P = next.a;
    const T1: Vec3 = [P[0] - Math.cos(prev.ang) * d, P[1], P[2] - Math.sin(prev.ang) * d];
    const sg = Math.sign(th);
    const C: Vec3 = [T1[0] - Math.sin(prev.ang) * R * sg, P[1], T1[2] + Math.cos(prev.ang) * R * sg];
    const m = Math.max(2, Math.ceil(Math.abs(th) / (Math.PI / 8)));
    const pts: Vec3[] = [];
    for (let k = 1; k <= m; k++) {
      const phi = prev.ang + (th * k) / m;
      pts.push([C[0] + Math.sin(phi) * R * sg, P[1], C[2] - Math.cos(phi) * R * sg]);
    }
    arcs[i] = pts;
  }

  // ---- 3. Centreline points, segment tags, and specials laid out inside each leg.
  const pts: Vec3[] = [];
  const tags: SegTag[] = [];
  /** Per segment: which side has no rail because a tower stands there (+1 left, -1 right). */
  const towerSide: number[] = [];
  const pathPts: Vec3[] = [];
  const push = (p: Vec3, tag: SegTag, pathOverride?: Vec3[], tower = 0) => {
    if (pts.length) {
      tags.push(tag);
      towerSide.push(tower);
    }
    pts.push(p);
    if (pathOverride) pathPts.push(...pathOverride);
    pathPts.push(p);
  };
  const obstacles: Obstacle[] = [];
  const zones: Zone[] = [];
  const collectibles: Collectible[] = [];
  const decorList: Decor[] = [];
  const extraSolids: Solid[] = [];
  let difficulty = 0;
  const tips: string[] = [];
  let leadTip: string | null = null;
  const speed = (1 + 0.6 * t) * (arch === 'gauntlet' ? 1.12 : 1) * (boss ? 1.2 : 1);
  const bridgeColor = BRIDGE[world] ?? BRIDGE.meadow;

  for (let i = 0; i < legs.length; i++) {
    const L = legs[i];
    const ux = Math.cos(L.ang),
      uz = Math.sin(L.ang);
    const nx = -uz,
      nz = ux;
    const S: Vec3 = [L.a[0] + ux * trimIn[i], L.a[1], L.a[2] + uz * trimIn[i]];
    const E: Vec3 = [L.b[0] - ux * trimOut[i], L.b[1], L.b[2] - uz * trimOut[i]];
    const Lp = L.len - trimIn[i] - trimOut[i];
    const at = (d: number, y: number): Vec3 => [S[0] + ux * d, y, S[2] + uz * d];
    /** Point `d` along the leg and `l` to its left. */
    const atL = (d: number, l: number, y = L.a[1]): Vec3 => [
      S[0] + ux * d + nx * l,
      y,
      S[2] + uz * d + nz * l,
    ];
    const rot = { rotY: -L.ang };
    const y0 = L.a[1];
    if (i === 0) push(S, 'flat');
    else if (arcs[i]) for (const p of arcs[i]!) push(p, 'arc');
    else push(S, 'flat'); // sharp corner: S === corner point (zero-length push is skipped below)
    const lastLeg = i === legs.length - 1;
    const tail = lastLeg ? 2.5 : 0; // keep the approach to the cup clean
    let sp = L.special;
    if (sp && sp !== 'fork' && sp !== 'spiral' && Lp < SPECIAL_LEN[sp] + tail - 0.5)
      sp = L.dy && Lp >= 5 ? 'ramp' : null;
    if (L.dy && !(sp && ELEVATION.includes(sp))) sp = 'ramp';
    switch (sp) {
      case 'ramp': {
        const land = 1.5;
        push(at(land, y0), 'landing');
        push(at(Lp - land, E[1]), 'ramp');
        push(E, 'landing');
        difficulty += SPECIAL_DIFF.ramp;
        break;
      }
      case 'climb': {
        // Two ramps with a terrace between them.
        const run = (Lp - tail - 1.2 - 1.4 - 1.2) / 2;
        const mid = y0 + L.dy / 2;
        push(at(1.2, y0), 'landing');
        push(at(1.2 + run, mid), 'ramp');
        push(at(1.2 + run + 1.4, mid), 'landing');
        push(at(1.2 + 2 * run + 1.4, E[1]), 'ramp');
        push(E, 'landing');
        collectibles.push(item(holeId, 'coin', ...(at(1.2 + run + 0.7, mid) as [number, number, number])));
        difficulty += SPECIAL_DIFF.climb;
        tips.push(
          L.dy > 0
            ? 'Terraces ahead: putt firmly up the steps.'
            : 'Downhill terraces: a gentle tap goes a long way.',
        );
        break;
      }
      case 'hump':
      case 'valley': {
        const hgt = (t > 0.5 ? 0.7 : 0.5) * (sp === 'hump' ? 1 : -1);
        const flat = sp === 'hump' ? 1.5 : 1.7;
        const run = (Lp - tail - flat) / 2 - 1.2;
        push(at(1.2, y0), 'landing');
        push(at(1.2 + run, y0 + hgt), 'ramp');
        push(at(1.2 + run + flat, y0 + hgt), 'landing');
        push(at(1.2 + 2 * run + flat, y0), 'ramp');
        push(E, 'flat');
        collectibles.push(
          item(holeId, 'coin', ...(at(1.2 + run + flat / 2, y0 + hgt) as [number, number, number])),
        );
        difficulty += SPECIAL_DIFF[sp];
        tips.push(
          sp === 'hump'
            ? 'Over the hump: give it enough to crest the hill.'
            : 'A dip in the green: it will roll down fast and climb out slow.',
        );
        break;
      }
      case 'jump': {
        const gap = range(r, 1.3, 1.7 + 0.8 * t);
        const kick = 2;
        const landLen = Math.max(4, 4 + tail);
        const runIn = Math.max(2.5, Lp - kick - gap - landLen);
        const K0 = at(runIn, y0);
        const K1 = at(runIn + kick, y0 + 0.45);
        const G = at(runIn + kick + gap, y0);
        push(K0, 'flat');
        push(K1, 'kicker');
        push(G, 'gap');
        push(E, 'landing');
        const gm: Vec3 = [(K1[0] + G[0]) / 2, y0, (K1[2] + G[2]) / 2];
        zones.push(zone('water', gm[0], gm[2], gap + 0.3, W + 3, y0, rot));
        if (world === 'space' || gap > 2)
          zones.push(
            zone('lowGravity', gm[0], gm[2], gap + 2, W + 1, y0, { strength: 0.5, h: 3, rotY: -L.ang }),
          );
        if (r() < 0.45)
          zones.push(
            zone('boost', K0[0] - ux * 1, K0[2] - uz * 1, 1.2, W * 0.8, y0, {
              dir: L.ang,
              strength: 8.5,
              ...rot,
            }),
          );
        // Coins hanging in the air over the gap.
        collectibles.push(
          ...coinLine(
            holeId,
            [K1[0] + ux * gap * 0.3, y0 + 0.5, K1[2] + uz * gap * 0.3],
            [K1[0] + ux * gap * 0.75, y0 + 0.45, K1[2] + uz * gap * 0.75],
            2,
          ),
        );
        difficulty += SPECIAL_DIFF.jump;
        tips.push('Jump! Hit the kicker ramp hard enough to clear the gap.');
        break;
      }
      case 'spiral': {
        // A corkscrew: one full turn round a tower, down to a lower tier.
        const P = L.spiral!;
        const D = -L.dy;
        const lead = P.lead - trimIn[i];
        push(at(lead, y0), 'lead');
        const N = 40;
        for (let k = 1; k <= N; k++) {
          const phi = (Math.PI * 2 * k) / N;
          push(
            atL(lead + P.R * Math.sin(phi), P.side * P.R * (1 - Math.cos(phi)), y0 - (D * k) / N),
            'spiral',
            undefined,
            P.side,
          );
        }
        push(E, 'landing');
        const C = atL(lead, P.side * P.R);
        const top = y0 + 1.7,
          bottom = y0 - D - 3;
        const dia = 2 * (P.R - W / 2) - 0.04;
        extraSolids.push({
          shape: 'cylinder',
          role: 'block',
          center: [C[0], (top + bottom) / 2, C[2]],
          size: [dia, top - bottom, dia],
          rot: [0, 0, 0],
          surface: 'grass',
          color: TOWER[world] ?? TOWER.meadow,
        });
        decorList.push(decor(ISLET[world] ?? 'rock', C[0], top, C[2], Math.min(1.2, dia * 0.45), r() * 6));
        for (const phi of [Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
          const c = atL(lead + P.R * Math.sin(phi), P.side * P.R * (1 - Math.cos(phi)), y0 - (D * phi) / (Math.PI * 2));
          collectibles.push(item(holeId, 'coin', c[0], c[1], c[2]));
        }
        difficulty += SPECIAL_DIFF.spiral;
        tips.push('Corkscrew! Roll into the spiral and let it carry you down.');
        break;
      }
      case 'slide': {
        // A twisting chute down to a lower tier.
        const D = -L.dy;
        const A = L.amp ?? 0.8;
        const lead = 1.4;
        const run = Lp - lead - 2.4 - tail;
        const n = Math.max(10, Math.ceil(run / 0.65));
        push(at(lead, y0), 'landing');
        for (let k = 1; k <= n; k++) {
          const sk = (run * k) / n;
          push(
            atL(lead + sk, A * Math.sin((Math.PI * 2 * sk) / run), y0 - (D * (1 - Math.cos((Math.PI * sk) / run))) / 2),
            'slide',
          );
        }
        push(E, 'landing');
        for (const f of [0.25, 0.5, 0.75]) {
          const c = atL(lead + run * f, A * Math.sin(Math.PI * 2 * f), y0 - (D * (1 - Math.cos(Math.PI * f))) / 2);
          collectibles.push(item(holeId, 'coin', c[0], c[1], c[2]));
        }
        difficulty += SPECIAL_DIFF.slide;
        tips.push('A twisting slide: it picks up speed on the way down.');
        break;
      }
      case 'drop': {
        // Ledges: roll off the edge onto the green below (sometimes two steps).
        const D = -L.dy;
        const steps = D > 0.85 && Lp - tail >= 9.5 && r() < 0.5 ? 2 : 1;
        const fall = 0.9;
        let a = 2.4;
        let y = y0;
        for (let k = 0; k < steps; k++) {
          const lo = y - D / steps;
          push(at(a, y), k === 0 ? 'landing' : 'landing');
          push(at(a + fall, lo), 'drop');
          // The lower green tucks back under the ledge so a slow ball can't fall between them.
          extraSolids.push(beam(at(a - 0.3, lo), at(a + fall, lo), W, FLOOR_T, 'floor'));
          const c = at(a + fall / 2, y - D / steps / 2 + 0.25);
          collectibles.push(item(holeId, 'coin', c[0], c[1], c[2]));
          a += fall + 2;
          y = lo;
        }
        push(E, Lp - a > 5 ? 'flat' : 'landing');
        difficulty += SPECIAL_DIFF.drop;
        tips.push('Over the ledge: the ball drops to the green below and keeps rolling.');
        break;
      }
      case 'leap': {
        if (L.spring) {
          // A spring pad pops the ball up onto a ledge a metre higher across the water. Too soft
          // and it drops short; too hard and it smacks into the ledge's face.
          const gap = range(r, 1.3, 1.6 + 0.4 * t);
          const pad = 1.0;
          const landLen = Math.max(4, 4 + tail);
          const runIn = Math.max(2.5, Lp - pad - gap - landLen);
          const K0 = at(runIn + pad, y0);
          const G = at(runIn + pad + gap, E[1]);
          push(at(Math.max(1, runIn - 1.5), y0), 'flat');
          push(K0, 'landing');
          push(G, 'gap');
          push(E, 'landing');
          const pc = at(runIn + pad / 2, y0);
          zones.push(zone('spring', pc[0], pc[2], pad, W - 0.2, y0, { strength: 5.6, ...rot }));
          const gm: Vec3 = [(K0[0] + G[0]) / 2, y0, (K0[2] + G[2]) / 2];
          zones.push(zone('water', gm[0], gm[2], gap + 0.3, W + 3, y0, rot));
          collectibles.push(
            ...coinLine(
              holeId,
              [K0[0] + ux * gap * 0.25, y0 + 1.45, K0[2] + uz * gap * 0.25],
              [K0[0] + ux * gap * 0.7, y0 + 1.5, K0[2] + uz * gap * 0.7],
              2,
            ),
          );
          difficulty += SPECIAL_DIFF.leap;
          tips.push('Spring pad! Roll onto it at a steady pace to bounce up to the ledge.');
          break;
        }
        // A kicker launches the ball up onto a higher ledge across water.
        const gap = range(r, 1.2, 1.5 + 0.5 * t);
        const kick = 2.2;
        const landLen = Math.max(4, 4 + tail);
        const runIn = Math.max(2.5, Lp - kick - gap - landLen);
        const K0 = at(runIn, y0);
        const K1 = at(runIn + kick, y0 + 0.6);
        const G = at(runIn + kick + gap, E[1]);
        push(K0, 'flat');
        push(K1, 'kicker');
        push(G, 'gap');
        push(E, 'landing');
        const gm: Vec3 = [(K1[0] + G[0]) / 2, y0, (K1[2] + G[2]) / 2];
        zones.push(zone('water', gm[0], gm[2], gap + 0.3, W + 3, y0, rot));
        if (world === 'space')
          zones.push(zone('lowGravity', gm[0], gm[2], gap + 2, W + 1, y0, { strength: 0.6, h: 3, rotY: -L.ang }));
        if (depth < 6 || r() < 0.5)
          zones.push(
            zone('boost', K0[0] - ux * 1, K0[2] - uz * 1, 1.2, W * 0.8, y0, { dir: L.ang, strength: 9, ...rot }),
          );
        collectibles.push(
          ...coinLine(
            holeId,
            [K1[0] + ux * gap * 0.3, y0 + 0.9, K1[2] + uz * gap * 0.3],
            [K1[0] + ux * gap * 0.75, y0 + 0.85, K1[2] + uz * gap * 0.75],
            2,
          ),
        );
        if (r() < 0.5) {
          const g = at(runIn + kick + gap + 1.6, E[1]);
          collectibles.push(item(holeId, 'gem', g[0], g[1], g[2]));
        }
        difficulty += SPECIAL_DIFF.leap;
        tips.push('Leap up to the ledge: too soft and you splash, too hard and you overshoot.');
        break;
      }
      case 'loop': {
        // Loop-the-loop: a funnel steers into the entry lane; the loop drops you in the exit lane.
        const sg = r() < 0.5 ? 1 : -1;
        const q = (W + WALL_T) / 4;
        const R = range(r, 1.1, 1.25 + 0.2 * t);
        const aF = 1.0;
        const aP = aF + 3.6;
        const stop = aP + R + 0.35;
        push(at(aF, y0), 'landing');
        push(at(stop + 0.6, y0), 'loop', [atL(aP - 1.4, -sg * q), atL(aP - 0.2, -sg * q), atL(aP + 0.3, sg * q)]);
        push(E, Lp - stop - 0.6 > 5 ? 'flat' : 'landing');
        extraSolids.push(
          wall(atL(aF + 0.4, sg * (W / 2)), atL(aP - 0.9, 0)),
          wall(atL(aP - 0.9, 0), atL(stop, 0)),
          wall(atL(stop, 0), atL(stop, -sg * (W / 2 + WALL_T / 2))),
        );
        obstacles.push({
          type: 'loop',
          id: `lp${i}`,
          pos: atL(aP, -sg * q, y0),
          rotY: L.ang,
          radius: R,
          width: Math.max(0.8, 2 * q - 0.25),
          shift: sg * 2 * q,
          segments: 28,
          phase: 0,
        });
        if (depth < 5 || r() < 0.4) {
          const b = atL(aP - 2.0, -sg * q);
          zones.push(zone('boost', b[0], b[2], 1.0, 2 * q - 0.3, y0, { dir: L.ang, strength: 9.5, ...rot }));
        }
        collectibles.push(...coinLine(holeId, atL(stop + 0.4, sg * q), atL(stop + 1.8, sg * q), 2));
        difficulty += SPECIAL_DIFF.loop;
        tips.push('Loop-the-loop! Line up with the entry lane and give it plenty of pace.');
        break;
      }
      case 'stream': {
        // A brook crosses the fairway: thread one of the narrow bridges.
        const g = range(r, 1.5, 1.9 + 0.6 * t);
        const x0 = Math.max(3, (Lp - tail - g) / 2);
        const modes = depth < 4 ? ['center', 'offset'] : ['offset', 'twin', 'center', 'offset'];
        const mode = pick(r, modes);
        const side = r() < 0.5 ? 1 : -1;
        const bw = mode === 'center' ? 0.95 - 0.2 * t : mode === 'twin' ? 0.75 : 0.9;
        const lats =
          mode === 'center'
            ? [0]
            : mode === 'twin'
              ? [W / 2 - bw / 2 - 0.05, -(W / 2 - bw / 2 - 0.05)]
              : [side * (W / 2 - bw / 2 - 0.05)];
        push(at(x0, y0), 'flat');
        push(at(x0 + g, y0), 'stream', [atL(x0 - 0.5, lats[0]), atL(x0 + g + 0.5, lats[0])]);
        push(E, Lp - x0 - g > 5 ? 'flat' : 'landing');
        for (const l of lats) {
          extraSolids.push(beam(atL(x0, l), atL(x0 + g, l), bw, FLOOR_T, 'floor', 'grass', 0, bridgeColor));
          collectibles.push(item(holeId, 'coin', ...(atL(x0 + g / 2, l) as [number, number, number])));
        }
        const c = at(x0 + g / 2, y0);
        zones.push(zone('water', c[0], c[2], g + 0.3, W + 3, y0, rot));
        difficulty += SPECIAL_DIFF.stream + (mode === 'center' ? -0.3 : 0);
        tips.push('A brook cuts across: line your putt up with a bridge!');
        break;
      }
      case 'split':
      case 'plaza':
      case 'lake': {
        const A1 = at(1.4, y0);
        const B1 = at(Lp - 1.4 - tail, y0);
        const wide = sp === 'split' ? splitW : sp === 'plaza' ? plazaW : lakeW;
        const segLen = Lp - 2.8 - tail;
        const strip = 1.3;
        const lakeSide = r() < 0.5 ? 1 : -1;
        const laneOff = pondW / 2 + sideW / 2;
        // The path (camera, rescue) runs down lane A / round the lake instead of over the divider.
        const off = sp === 'split' ? (laneW + WALL_T) / 2 : 0;
        push(A1, 'flat');
        push(
          B1,
          sp,
          sp === 'lake'
            ? [
                atL(1.4 + strip / 2, 0),
                atL(1.4 + strip / 2, lakeSide * laneOff),
                atL(1.4 + segLen - strip / 2, lakeSide * laneOff),
                atL(1.4 + segLen - strip / 2, 0),
              ]
            : [
                [A1[0] + ux * 0.9 + nx * off, y0, A1[2] + uz * 0.9 + nz * off],
                [B1[0] - ux * 0.9 + nx * off, y0, B1[2] - uz * 0.9 + nz * off],
              ],
        );
        push(E, 'flat');
        // Shoulders where the fairway widens / narrows.
        for (const [P, sgn] of [
          [A1, 1],
          [B1, -1],
        ] as const)
          for (const side of [1, -1]) {
            const o = (k: number): Vec3 => [
              P[0] + nx * side * k + ux * sgn * (WALL_T / 2),
              y0,
              P[2] + nz * side * k + uz * sgn * (WALL_T / 2),
            ];
            extraSolids.push(wall(o(W / 2), o(wide / 2 + WALL_T)));
          }
        const mid = at(1.4 + segLen / 2, y0);
        if (sp === 'split') {
          extraSolids.push(wall(at(2.5, y0), at(1.4 + segLen - 1.1, y0)));
          // Two lanes with different characters.
          const laneOpts = ['boost', 'coins', 'bumper', 'pillar'];
          if (!socks) laneOpts.push('sand');
          if (socks < 2) laneOpts.push('ice');
          const a = pick(r, laneOpts);
          const b = pick(
            r,
            laneOpts.filter((x) => x !== a),
          );
          for (const [kind, side] of [
            [a, 1],
            [b, -1],
          ] as const) {
            const c: Vec3 = [mid[0] + nx * side * off, y0, mid[2] + nz * side * off];
            laneFeature(kind, c, side);
          }
          if (r() < 0.6) {
            const side = r() < 0.5 ? 1 : -1;
            collectibles.push(
              item(
                holeId,
                'gem',
                mid[0] + nx * side * off + ux * 1.8,
                y0,
                mid[2] + nz * side * off + uz * 1.8,
              ),
            );
          }
          difficulty += SPECIAL_DIFF.split;
          tips.push('The fairway splits in two: pick your lane.');
        } else if (sp === 'lake') {
          // A pond in the middle of a wide green: roll round either side, or risk the plank.
          extraSolids.push(
            beam(at(1.4, y0), at(1.4 + strip, y0), lakeW, FLOOR_T, 'floor'),
            beam(at(1.4 + segLen - strip, y0), at(1.4 + segLen, y0), lakeW, FLOOR_T, 'floor'),
          );
          for (const side of [1, -1])
            extraSolids.push(
              beam(
                atL(1.4 + strip, side * laneOff),
                atL(1.4 + segLen - strip, side * laneOff),
                sideW,
                FLOOR_T,
                'floor',
              ),
            );
          zones.push(zone('water', mid[0], mid[2], segLen - 2 * strip + 0.1, pondW + 0.1, y0, rot));
          if (r() < 0.6) {
            extraSolids.push(
              beam(
                at(1.4 + strip, y0),
                at(1.4 + segLen - strip, y0),
                0.75,
                FLOOR_T,
                'floor',
                'grass',
                0,
                bridgeColor,
              ),
            );
            collectibles.push(item(holeId, 'gem', mid[0], y0, mid[2]));
            tips.push('A pond splits the green: go round, or brave the plank straight across!');
          } else tips.push('A pond splits the green: pick a side to go round.');
          collectibles.push(
            ...coinLine(
              holeId,
              atL(1.4 + strip + 0.6, -lakeSide * laneOff),
              atL(1.4 + segLen - strip - 0.6, -lakeSide * laneOff),
              3,
            ),
          );
          difficulty += SPECIAL_DIFF.lake;
        } else {
          // A wide green with a boulder in the middle and a couple of well-spaced bumpers.
          extraSolids.push(pillar(mid[0], mid[2], 1.1, y0, 0.7));
          const sg = r() < 0.5 ? 1 : -1;
          for (const [f, l] of [
            [0.22, sg],
            [0.78, -sg],
          ] as const) {
            const p = atL(1.4 + segLen * f, l * (wide / 2 - 0.75));
            obstacles.push({
              type: 'bumper',
              id: `pz${i}-${f}`,
              pos: p,
              radius: 0.3,
              height: 0.4,
              strength: 1,
              phase: 0,
            });
          }
          collectibles.push(...coinLine(holeId, atL(2.6, -sg * 0.8), atL(1.4 + segLen - 1.2, -sg * 0.8), 3));
          difficulty += SPECIAL_DIFF.plaza;
          tips.push('A wide green with a boulder in the middle: bank it round either side.');
        }
        break;
      }
      case 'fork': {
        buildFork(L.fork!);
        break;
      }
      default:
        push(E, 'flat');
        break;
    }

    /**
     * Forked fairway: the lanes swoop apart round a lagoon, run side by side (one steady, one
     * quick but risky), then swoop back together before the hole carries on.
     */
    function buildFork(F: ForkPlan) {
      const off0 = F.rin - trimIn[i];
      const a0 = off0 + F.sweep,
        a1 = off0 + F.m - F.sweep;
      const lat = (k: number, a: number) => forkLat(F, k, a - off0);
      /** Gap between the lanes' inner edges `a` along the leg (negative where they overlap). */
      const gapAt = (a: number) => lat(0, a) + lat(1, a) - W;
      // Where the lanes stop sharing a floor (and meet again): the island's tips.
      const crossing = (lo: number, hi: number) => {
        let x = lo,
          y = hi;
        const rising = gapAt(hi) > gapAt(lo);
        for (let k = 0; k < 40; k++) {
          const mid = (x + y) / 2;
          if (gapAt(mid) < 0 === rising) x = mid;
          else y = mid;
        }
        return (x + y) / 2;
      };
      const tips = [crossing(off0, a0), crossing(a1, off0 + F.m)];
      const nS = Math.max(7, Math.ceil(F.sweep / 0.55));
      const sweepIn: number[] = [];
      const sweepOut: number[] = [];
      for (let j = 0; j <= nS; j++) {
        sweepIn.push(off0 + (F.sweep * j) / nS);
        sweepOut.push(a1 + (F.sweep * j) / nS);
      }
      for (const [list, c] of [
        [sweepIn, tips[0]],
        [sweepOut, tips[1]],
      ] as const) {
        if (list.every((v) => Math.abs(v - c) > 0.08)) list.push(c);
        list.sort((x, y) => x - y);
      }
      const nIn = sweepIn.length - 1;
      // Rocks round off the tips of the island.
      for (const sc of tips) {
        const c = atL(sc, (lat(0, sc) - lat(1, sc)) / 2);
        extraSolids.push(pillar(c[0], c[2], 0.5, y0, 0.45));
      }
      const hA = F.hs[0],
        hB = F.hs[1];
      const lagoonW = hA + hB - W - 2 * WALL_T - 0.1;
      const ic = atL((a0 + a1) / 2, (hA - hB) / 2);
      zones.push(zone('water', ic[0], ic[2], a1 - a0 + 1.2, lagoonW, y0, rot));
      decorList.push(decor(ISLET[world] ?? 'rock', ic[0], y0 - 0.35, ic[2], 0.9, r() * 6));
      if (a1 - a0 > 9)
        decorList.push(
          decor(ISLET[world] ?? 'rock', ...(atL(a0 + 1.5, (hA - hB) / 2 + 0.6, y0 - 0.4) as [number, number, number]), 0.55, r() * 6),
        );

      const lanePaths: Vec3[][] = [];
      ([1, -1] as const).forEach((side, k) => lanePaths.push(buildLane(F.lanes[k], side, k)));
      const safeK = SAFE_LANES.includes(F.lanes[0]) ? 0 : 1;
      push(at(off0, y0), 'flat');
      push(at(off0 + F.m, y0), 'fork', lanePaths[safeK].slice(1, -1));
      push(E, 'landing');
      difficulty += SPECIAL_DIFF.fork;
      leadTip = `The fairway forks round a lagoon: ${LANE_TIP[F.lanes[1 - safeK]]} one way, ${LANE_TIP[F.lanes[safeK]]} the other. Pick your route!`;

      function buildLane(kind: LaneKind, side: 1 | -1, k: number): Vec3[] {
        const h = F.hs[k];
        const w = W;
        const LP = (a: number, y = y0, l = 0): Vec3 => atL(a, side * h + l, y);
        const ll = a1 - a0;
        const am = (a0 + a1) / 2;
        const openL: number[] = [];
        const openR: number[] = [];
        const noF: number[] = [];
        // Indices below are segments of the straight middle part; the swoop in comes first.
        const openOuter = (s: number) => (side === 1 ? openL : openR).push(s + nIn);
        const openInner = (s: number) => (side === 1 ? openR : openL).push(s + nIn);
        const outerWater = (from: number, to: number) => {
          const c = LP((from + to) / 2, y0, side * (w / 2 + 1.1));
          zones.push(zone('water', c[0], c[2], to - from + 0.4, 2, y0, rot));
        };
        const coins = (from: number, to: number, n: number, l = 0) =>
          collectibles.push(...coinLine(holeId, LP(from, y0, l), LP(to, y0, l), n));
        const gem = (a: number, y = y0) => {
          const p = LP(a, y);
          collectibles.push(item(holeId, 'gem', p[0], y, p[2]));
        };
        let lp: Vec3[] = [LP(a0), LP(a1)];
        switch (kind) {
          case 'sand':
            for (const [f, l] of [
              [0.3, 0.15],
              [0.68, -0.15],
            ] as const) {
              const c = LP(a0 + ll * f, y0, l * w);
              zones.push(zone(world === 'candy' ? 'sticky' : 'sand', c[0], c[2], 2, w * 0.75, y0, rot));
            }
            coins(a0 + 1, a0 + 2.2, 2);
            break;
          case 'slalom':
            [0.25, 0.5, 0.75].forEach((f, j) => {
              const c = LP(a0 + ll * f, y0, (j % 2 ? -1 : 1) * w * 0.24);
              extraSolids.push(pillar(c[0], c[2], 0.42, y0, 0.6));
            });
            coins(a0 + ll * 0.36, a0 + ll * 0.64, 2, 0);
            break;
          case 'bumpers':
            [0.3, 0.7].forEach((f, j) => {
              const c = LP(a0 + ll * f, y0, (j % 2 ? -1 : 1) * w * 0.24);
              obstacles.push({
                type: 'bumper',
                id: `fk${i}${side}${j}`,
                pos: c,
                radius: 0.3,
                height: 0.4,
                strength: 1,
                phase: 0,
              });
            });
            coins(a0 + ll * 0.42, a0 + ll * 0.58, 2, 0);
            break;
          case 'hill': {
            const hh = t > 0.5 ? 0.8 : 0.65;
            const run = (ll - 2.4 - 1.4) / 2;
            lp = [
              LP(a0),
              LP(a0 + 1.2),
              LP(a0 + 1.2 + run, y0 + hh),
              LP(a0 + 1.2 + run + 1.4, y0 + hh),
              LP(a1 - 1.2),
              LP(a1),
            ];
            const top = LP(a0 + 1.2 + run + 0.7, y0 + hh);
            collectibles.push(item(holeId, 'coin', top[0], y0 + hh, top[2]));
            break;
          }
          case 'bridge': {
            // A narrow plank over the water.
            lp = [LP(a0), LP(a0 + 1.4), LP(a1 - 1.4), LP(a1)];
            noF.push(1 + nIn);
            openOuter(1);
            openInner(1);
            const bw = Math.max(0.8, w * 0.42);
            extraSolids.push(beam(LP(a0 + 1.4), LP(a1 - 1.4), bw, FLOOR_T, 'floor', 'grass', 0, bridgeColor));
            const c = LP(am, y0, side * 0.6);
            zones.push(zone('water', c[0], c[2], ll - 2.8 + 0.2, w + 2.4, y0, rot));
            gem(am);
            coins(a0 + 2, am - 1, 2);
            break;
          }
          case 'boost': {
            lp = [LP(a0), LP(a0 + 2.4), LP(a1 - 1.4), LP(a1)];
            openOuter(1);
            outerWater(a0 + 2.4, a1 - 1.4);
            for (const f of [a0 + 1.1, am]) {
              const c = LP(f);
              zones.push(zone('boost', c[0], c[2], 1.1, w - 0.3, y0, { dir: L.ang, strength: 8.5, ...rot }));
            }
            gem(a1 - 2.4);
            coins(am + 1, am + 3, 3);
            break;
          }
          case 'ice': {
            lp = [LP(a0), LP(a0 + 1.5), LP(a1 - 1.5), LP(a1)];
            openOuter(1);
            outerWater(a0 + 1.5, a1 - 1.5);
            const c = LP(am);
            zones.push(zone('ice', c[0], c[2], ll - 3, w, y0, rot));
            gem(am, y0);
            coins(a0 + 2, a0 + 3.5, 2);
            break;
          }
          case 'jump': {
            const gap = range(r, 1.3, 1.8);
            const k0 = a0 + 2.4,
              k1 = k0 + 2,
              g1 = k1 + gap;
            lp = [LP(a0), LP(k0), LP(k1, y0 + 0.45), LP(g1), LP(a1)];
            noF.push(2 + nIn);
            openL.push(2 + nIn);
            openR.push(2 + nIn);
            const c = LP((k1 + g1) / 2);
            zones.push(zone('water', c[0], c[2], gap + 0.3, w + 3, y0, rot));
            const b = LP(k0 - 1.2);
            zones.push(zone('boost', b[0], b[2], 1.1, w - 0.3, y0, { dir: L.ang, strength: 8.5, ...rot }));
            const c0 = LP(k1 + gap * 0.3, y0 + 0.5),
              c1 = LP(k1 + gap * 0.75, y0 + 0.45);
            collectibles.push(...coinLine(holeId, c0, c1, 2));
            gem(g1 + 1.5);
            break;
          }
          case 'machine': {
            const c = LP(am);
            if (depth >= 5)
              obstacles.push({
                type: 'windmill',
                id: `fw${i}${side}`,
                pos: c,
                rotY: L.ang,
                speed: range(r, 0.8, 1.2) * speed,
                bladeLength: Math.min(2.1, w * 0.85),
                tunnelWidth: 0.8,
                baseWidth: w + 0.4,
                phase: r() * 6,
              });
            else {
              const travel = w * 0.25;
              obstacles.push({
                type: 'mover',
                id: `fg${i}${side}`,
                size: [0.45, 0.5, w * 0.5],
                from: LP(am, y0 + 0.25, travel),
                to: LP(am, y0 + 0.25, -travel),
                period: range(r, 2.8, 3.5) / speed,
                rotY: L.ang,
                role: 'block',
                phase: r() * 6,
              });
            }
            gem(a1 - 1.6);
            coins(a0 + 1.5, a0 + 3, 2);
            break;
          }
        }
        const inPts = sweepIn.slice(0, -1).map((a) => atL(a, side * lat(k, a), y0));
        const outPts = sweepOut.slice(1).map((a) => atL(a, side * lat(k, a), y0));
        const full = [...inPts, ...lp, ...outPts];
        // Inner rails only where the lanes have parted (they share one floor near the ends).
        const along = [...sweepIn.slice(0, -1), ...lp.map(() => (a0 + a1) / 2), ...sweepOut.slice(1)];
        for (let j = 0; j < full.length - 1; j++)
          if (Math.min(gapAt(along[j]), gapAt(along[j + 1])) < -0.02) (side === 1 ? openR : openL).push(j);
        extraSolids.push(
          ...fairway(full, {
            width: w,
            openStart: true,
            openEnd: true,
            openLeft: openL,
            openRight: openR,
            noFloor: noF,
          }),
        );
        return full;
      }
    }

    function laneFeature(kind: string, c: Vec3, side: number) {
      switch (kind) {
        case 'boost':
          zones.push(
            zone('boost', c[0] - ux * 1.6, c[2] - uz * 1.6, 1.1, laneW - 0.1, y0, {
              dir: L.ang,
              strength: 8,
              ...rot,
            }),
          );
          break;
        case 'sand':
          zones.push(zone('sand', c[0], c[2], 2.2, laneW, y0, rot));
          break;
        case 'ice':
          zones.push(zone('ice', c[0], c[2], 3, laneW, y0, rot));
          break;
        case 'bumper':
          obstacles.push({
            type: 'bumper',
            id: `lb${i}${side}`,
            pos: c,
            radius: 0.28,
            height: 0.4,
            strength: 1,
            phase: 0,
          });
          break;
        case 'pillar':
          extraSolids.push(pillar(c[0] + ux * 0.6, c[2] + uz * 0.6, 0.45, y0, 0.6));
          break;
        default:
          collectibles.push(...coinLine(holeId, [c[0] - ux, y0, c[2] - uz], [c[0] + ux, y0, c[2] + uz], 3));
      }
    }
  }
  // Drop zero-length segments (sharp corners push the corner twice).
  for (let i = pts.length - 1; i > 0; i--)
    if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]) < 1e-3) {
      pts.splice(i, 1);
      tags.splice(i - 1, 1);
      towerSide.splice(i - 1, 1);
    }
  for (let i = pathPts.length - 1; i > 0; i--)
    if (
      Math.hypot(
        pathPts[i][0] - pathPts[i - 1][0],
        pathPts[i][2] - pathPts[i - 1][2],
        pathPts[i][1] - pathPts[i - 1][1],
      ) < 1e-3
    )
      pathPts.splice(i, 1);

  // ---- 4. Hazards and machinery on the plain flat stretches.
  const openLeft: number[] = [];
  const openRight: number[] = [];
  const noFloor: number[] = [];
  const noSkirt: number[] = [];
  const wallHs: Record<number, number> = {};
  const widths: Record<number, number> = {};
  tags.forEach((tg, i) => {
    if (tg === 'gap' || tg === 'stream' || tg === 'fork') {
      noFloor.push(i);
      openLeft.push(i);
      openRight.push(i);
    } else if (tg === 'drop') noFloor.push(i);
    else if (tg === 'spiral' || tg === 'lead') {
      // The corkscrew passes over itself: no earth under it, and the tower is its inner rail.
      noSkirt.push(i);
      if (tg === 'spiral') {
        wallHs[i] = 0.5;
        (towerSide[i] > 0 ? openLeft : openRight).push(i);
      }
    } else if (tg === 'slide') wallHs[i] = 0.5;
    else if (tg === 'split') widths[i] = splitW;
    if (tg === 'spiral' || tg === 'slide') noFloor.push(i);
    else if (tg === 'plaza') widths[i] = plazaW;
    else if (tg === 'lake') {
      widths[i] = lakeW;
      noFloor.push(i);
    }
  });

  const pool: Feature[] = ['pillars'];
  if (!socks) pool.push('sand');
  if (depth >= 1) pool.push('boost', 'bumpers');
  if (depth >= 2) pool.push('spinner');
  if (depth >= 3) pool.push('mover');
  if ((depth >= 4 || arch === 'waterworks') && socks < 3) pool.push('pools');
  if (depth >= 5) pool.push('windmill');
  if (depth >= 7 && socks < 2) pool.push('ice', 'conveyor');
  if (depth >= 9) pool.push('gate', 'spinner');
  if (depth >= 9 && socks < 3) pool.push('pools');
  // Each planet leans on its own signature hazards.
  const flavour: Record<string, Feature[]> = {
    meadow: socks ? ['pillars'] : ['pillars', 'sand'],
    candy: socks ? ['bumpers'] : ['sticky', 'sticky'],
    frozen: socks < 2 ? ['ice', 'ice'] : ['pillars'],
    clockwork: depth >= 3 ? ['gate', 'mover', 'spinner'] : ['spinner'],
    space: ['spinner', 'boost'],
  };
  pool.push(...(flavour[world] ?? []).filter((f) => depth >= 2 || (f !== 'gate' && f !== 'mover')));
  for (const [f, n] of Object.entries(st.features) as [Feature, number][])
    if (pool.includes(f)) for (let k = 0; k < n; k++) pool.push(f);
  if (boss && depth >= 3 && socks < 3) pool.push('pools', 'pools');
  const heavy: Feature[] = boss
    ? (BOSS_HEAVY[world] ?? ['spinner', 'mover']).filter(
        (f) => !(f === 'ice' && socks >= 2) && !(f === 'sticky' && socks),
      )
    : depth >= 5
      ? ['windmill', 'spinner', 'mover', 'gate']
      : ['spinner', 'mover', 'bumpers'];

  // Corkscrews and slides get one smooth floor each (no seams to kick the ball at speed).
  for (let i = 0; i < tags.length; ) {
    if (tags[i] !== 'spiral' && tags[i] !== 'slide') {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < tags.length && tags[j + 1] === tags[i]) j++;
    extraSolids.push(ribbon(pts.slice(i, j + 2), W, 'grass', tags[i] !== 'spiral'));
    i = j + 1;
  }

  // Tunnels: some sweeping corners, slides and quiet straights get a covered tube.
  const tunnels: { points: Vec3[]; width: number }[] = [];
  const tunnelSegs = new Set<number>();
  const runs: [number, number][] = [];
  for (let i = 0; i < tags.length; ) {
    let j = i;
    if (tags[i] === 'arc' || tags[i] === 'slide') {
      while (j + 1 < tags.length && tags[j + 1] === tags[i]) j++;
      if (j > i) runs.push([i, j]);
    } else if (tags[i] === 'flat' && i > 0 && i < tags.length - 1) {
      const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][2] - pts[i][2]);
      if (l >= 3 && l <= 7.5) runs.push([i, i]);
    }
    i = j + 1;
  }
  const tubeBias = arch === 'funhouse' ? 0.25 : 0;
  for (const [i0, i1] of runs) {
    if (tunnels.length >= 2) break;
    const tg = tags[i0];
    let runLen = 0;
    for (let k = i0; k <= i1; k++) runLen += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][2] - pts[k][2]);
    if (runLen < 3) continue;
    const chance = (tg === 'slide' ? 0.5 : tg === 'arc' ? 0.3 : 0.1) + tubeBias;
    if (r() > chance) continue;
    tunnels.push({ points: pts.slice(i0, i1 + 2).map((p) => [...p] as Vec3), width: W });
    for (let k = i0; k <= i1; k++) tunnelSegs.add(k);
  }

  const BLOCKING: Feature[] = ['bumpers', 'pillars', 'spinner', 'mover', 'gate', 'windmill'];
  const flatSegs = tags.map((tg, i) => i).filter((i) => tags[i] === 'flat');
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i],
      b = pts[i + 1];
    const segLen = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const ang = Math.atan2(b[2] - a[2], b[0] - a[0]);
    const ux = Math.cos(ang),
      uz = Math.sin(ang);
    const nx = -uz,
      nz = ux;
    const first = i === 0;
    const lastSeg = i === pts.length - 2;
    if (tags[i] !== 'flat' || segLen < 4 || tunnelSegs.has(i)) {
      continue;
    }
    const chance = first ? (t > 0.4 ? 0.5 : 0) : boss ? 1 : Math.min(1, 0.4 + 0.45 * t + st.featureChance);
    const twice = t - 0.3 + (arch === 'gauntlet' ? 0.3 : 0) + (boss ? 0.25 : 0);
    // Two features only on long stretches, well apart, and never two blockers side by side.
    const count = r() < chance ? (segLen >= 9 && r() < twice ? 2 : 1) : 0;
    const rot = { rotY: -ang };
    let prevKind: Feature | null = null;
    for (let k = 0; k < count; k++) {
      const lo = first ? 0.5 : 0.25;
      const hi = lastSeg ? 0.6 : 0.75;
      const f = count === 1 ? (lo + hi) / 2 : k === 0 ? 0.28 : 0.72;
      const c: Vec3 = [a[0] + (b[0] - a[0]) * f, a[1], a[2] + (b[2] - a[2]) * f];
      let kind: Feature | null = boss && k === 0 && heavy.length ? pick(r, heavy) : pick(r, pool);
      if (prevKind && BLOCKING.includes(prevKind) && BLOCKING.includes(kind)) {
        const calm = pool.filter((x) => !BLOCKING.includes(x));
        kind = calm.length ? pick(r, calm) : null;
      }
      if (!kind) break;
      prevKind = kind;
      const id = `${i}-${k}`;
      switch (kind) {
        case 'sand':
          zones.push(zone('sand', c[0], c[2], 2, W * 0.7, c[1], rot));
          difficulty += 1;
          break;
        case 'sticky':
          zones.push(zone('sticky', c[0], c[2], 1.8, W * 0.8, c[1], rot));
          difficulty += 0.8;
          break;
        case 'ice':
          zones.push(zone('ice', c[0], c[2], 3, W, c[1], rot));
          difficulty += 1;
          break;
        case 'bumpers': {
          const off = W * 0.25;
          for (const [s, along] of [
            [1, -1.1],
            [-1, 1.1],
          ] as const)
            obstacles.push({
              type: 'bumper',
              id: `b${id}${s}`,
              pos: [c[0] + nx * off * s + ux * along, c[1], c[2] + nz * off * s + uz * along],
              radius: 0.3,
              height: 0.4,
              strength: 1,
              phase: 0,
            });
          difficulty += 1;
          break;
        }
        case 'pillars': {
          const off = W * 0.22;
          extraSolids.push(
            pillar(c[0] + nx * off, c[2] + nz * off, 0.4, c[1], 0.6),
            pillar(c[0] - nx * off + ux * 1.2, c[2] - nz * off + uz * 1.2, 0.4, c[1], 0.6),
          );
          difficulty += 0.5;
          break;
        }
        case 'boost':
          zones.push(
            zone('boost', c[0] - ux * 1.2, c[2] - uz * 1.2, 1.2, 1.4, c[1], {
              dir: ang,
              strength: 9,
              rotY: -ang,
            }),
          );
          break;
        case 'conveyor': {
          // Belt across the fairway: pushes balls sideways toward a wall.
          const side = r() < 0.5 ? 1 : -1;
          zones.push(
            zone('conveyor', c[0], c[2], 1.6, W, c[1], {
              dir: Math.atan2(nz * side, nx * side),
              strength: 1.4 + t,
              rotY: -ang,
            }),
          );
          difficulty += 1;
          break;
        }
        case 'spinner':
          obstacles.push({
            type: 'spinner',
            id: `s${id}`,
            pos: c,
            length: Math.min(W - 0.4, 2.2),
            arms: depth >= 8 && r() < 0.5 ? 3 : 2,
            speed: range(r, 0.9, 1.5) * speed * (r() < 0.5 ? 1 : -1),
            height: 0.3,
            thickness: 0.18,
            phase: r() * 6,
          });
          difficulty += 1.2;
          break;
        case 'mover': {
          const s = W * 0.3;
          obstacles.push({
            type: 'mover',
            id: `m${id}`,
            size: [0.5, 0.5, 0.9],
            from: [c[0] - nx * s, c[1] + 0.25, c[2] - nz * s],
            to: [c[0] + nx * s, c[1] + 0.25, c[2] + nz * s],
            period: range(r, 2.4, 3.8) / speed,
            rotY: ang,
            role: 'block',
            phase: r() * 6,
          });
          difficulty += 1.2;
          break;
        }
        case 'gate': {
          // Sliding door across the fairway: wait for it to open up on one side.
          const travel = W * 0.25;
          obstacles.push({
            type: 'mover',
            id: `g${id}`,
            size: [0.45, 0.5, W * 0.5],
            from: [c[0] + nx * travel, c[1] + 0.25, c[2] + nz * travel],
            to: [c[0] - nx * travel, c[1] + 0.25, c[2] - nz * travel],
            period: range(r, 3, 3.8) / speed,
            rotY: ang,
            role: 'block',
            phase: r() * 6,
          });
          difficulty += 1.3;
          break;
        }
        case 'windmill':
          obstacles.push({
            type: 'windmill',
            id: `w${id}`,
            pos: c,
            rotY: ang,
            speed: range(r, 0.8, 1.2) * speed,
            bladeLength: Math.min(2.1, W * 0.85),
            tunnelWidth: 0.8,
            baseWidth: W + 0.4,
            phase: r() * 6,
          });
          difficulty += 2;
          break;
        case 'pools': {
          // One edge has no wall: roll off it and you're in the drink.
          const side = r() < 0.5 ? 1 : -1;
          (side === 1 ? openLeft : openRight).push(i);
          const off = W / 2 + 1.1;
          const len = segLen + (lastSeg ? 0.7 : 0);
          const mid: Vec3 = [(a[0] + b[0]) / 2, a[1], (a[2] + b[2]) / 2];
          zones.push(zone('water', mid[0] + nx * side * off, mid[2] + nz * side * off, len, 2, a[1], rot));
          difficulty += 1.5;
          break;
        }
      }
    }
    // Coins: a short line on most stretches.
    if (!first || r() < 0.5) {
      const off = (r() - 0.5) * W * 0.5;
      collectibles.push(
        ...coinLine(
          holeId,
          [a[0] + (b[0] - a[0]) * 0.12 + nx * off, a[1], a[2] + (b[2] - a[2]) * 0.12 + nz * off],
          [a[0] + (b[0] - a[0]) * 0.22 + nx * off, a[1], a[2] + (b[2] - a[2]) * 0.22 + nz * off],
          boss ? 3 : 2,
        ),
      );
    }
  }
  // Scenery beside each leg.
  for (const L of legs) {
    if (r() > 0.75) continue;
    const side = r() < 0.5 ? 1 : -1;
    const nx = -Math.sin(L.ang),
      nz = Math.cos(L.ang);
    const wide = L.fork
      ? 2 * Math.max(...L.fork.hs) + W
      : L.spiral
        ? 2 * (2 * L.spiral.R + W)
        : L.amp
          ? W + 2 * Math.abs(L.amp)
          : L.special === 'plaza'
        ? plazaW
        : L.special === 'split'
          ? splitW
          : L.special === 'lake'
            ? lakeW
            : W;
    decorList.push(
      decor(
        pick(r, DECOR[world] ?? DECOR.meadow),
        (L.a[0] + L.b[0]) / 2 + nx * side * (wide / 2 + 2.5),
        Math.min(L.a[1], L.b[1]) - 0.2,
        (L.a[2] + L.b[2]) / 2 + nz * side * (wide / 2 + 2.5),
        range(r, 0.8, 1.3),
        r() * 6,
      ),
    );
  }

  // ---- 5. Wormhole shortcut on long holes: a small pad tucked beside the rail.
  if (legs.length >= 4 && depth >= 4 && arch !== 'fork' && r() < 0.35) {
    const early = flatSegs.filter(
      (i) => i > 0 && i < pts.length / 2 && !openLeft.includes(i) && !openRight.includes(i),
    );
    const j = early.find((i) => Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][2] - pts[i][2]) >= 5);
    const lastI = pts.length - 2;
    if (j !== undefined && tags[lastI] !== 'gap') {
      const a = pts[j],
        b = pts[j + 1];
      const ang = Math.atan2(b[2] - a[2], b[0] - a[0]);
      const side = r() < 0.5 ? 1 : -1;
      const lat = W / 2 - 0.45;
      const A: Vec3 = [
        a[0] + (b[0] - a[0]) * 0.86 - Math.sin(ang) * lat * side,
        a[1],
        a[2] + (b[2] - a[2]) * 0.86 + Math.cos(ang) * lat * side,
      ];
      const la = pts[lastI],
        lb = pts[lastI + 1];
      const lLen = Math.hypot(lb[0] - la[0], lb[2] - la[2]);
      const exitAng = Math.atan2(lb[2] - la[2], lb[0] - la[0]);
      const k = Math.min(1.2, lLen * 0.3) / lLen;
      const B: Vec3 = [la[0] + (lb[0] - la[0]) * k, la[1], la[2] + (lb[2] - la[2]) * k];
      obstacles.push({
        type: 'teleporter',
        id: 'wormhole',
        a: A,
        b: B,
        exitDir: exitAng,
        radius: 0.36,
        phase: 0,
      });
      tips.push('A wormhole pad hides beside the rail: a shortcut to the green!');
    }
  }

  lastHoleSpecials = [...legs.map((l) => l.special ?? ''), ...(tunnels.length ? ['tunnel'] : [])].filter(Boolean);
  let length = 0;
  for (let i = 0; i < pts.length - 1; i++)
    length +=
      Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][2] - pts[i][2]) *
      (tags[i] === 'spiral' ? 0.15 : tags[i] === 'slide' ? 0.5 : 1);
  const base = 1.0 + length / 15 + sharp * 0.28 + curves * 0.16 + difficulty * 0.14;
  // Bosses get a stingier par: every stroke over costs hearts.
  const par = boss
    ? Math.max(3, Math.min(6, Math.round(base - 1.0)))
    : Math.max(2, Math.min(6, Math.round(base)));
  const [adj, noun] = NAMES[world] ?? NAMES.meadow;
  const nouns = st.nouns.length && r() < 0.65 ? st.nouns : noun;
  const name = boss ? (BOSS_NAMES[world] ?? 'Boss') : `${pick(r, adj)} ${pick(r, nouns)}`;
  const tip = leadTip ?? (tips.length ? tips[Math.floor(r() * tips.length)] : undefined);

  return makeHole({
    id: holeId,
    name,
    par,
    fairway: { width: W, openLeft, openRight, noFloor, widths, wallHs, noSkirt },
    points: pts,
    path: pathPts,
    obstacles,
    zones,
    collectibles,
    decor: decorList,
    tunnels,
    solids: extraSolids,
    tip: boss ? `Boss hole! Clear it to bank a trinket and stardust.${tip ? ` ${tip}` : ''}` : tip,
  });
}

const DECOR: Record<string, string[]> = {
  meadow: ['tree', 'bush', 'flower', 'rock', 'mushroom'],
  candy: ['lollipop', 'gumdrop', 'candycane', 'donut'],
  frozen: ['snowpine', 'snowman', 'crystal', 'iceblock'],
  clockwork: ['gear', 'pipe', 'chimney', 'crate'],
  space: ['spacerock', 'alienplant', 'antenna', 'crystal'],
};

/** Crate positions on the Wishing Green, left to right (stable: the UI labels them). */
export const REST_CRATES: Vec3[] = [
  [-3, 0, 5],
  [0, 0, 6.2],
  [3, 0, 5],
];
export const REST_CUP: Vec3 = [3.6, 0, 1.2];

export function restCrateId(index: number, reward: RewardId): string {
  return `rest${index}:${reward}`;
}

/**
 * Wishing Green: a calm plaza with no stroke pressure. Putt into the crate holding the reward
 * you want; sinking the cup instead takes a small stardust tip and moves on.
 */
function restHole(seed: number, index: number, spec: StageSpec) {
  const holeId = `hop${seed}-${index}`;
  const crates = spec.crates ?? ['heal', 'dust', 'trinket'];
  const collectibles: Collectible[] = crates.map((rw, i) => ({
    id: `${holeId}:${restCrateId(i, rw)}`,
    kind: 'crate',
    pos: [REST_CRATES[i][0], 0.3, REST_CRATES[i][2]],
  }));
  for (let i = 0; i < 5; i++) collectibles.push(item(holeId, 'coin', -1.6 + i * 0.8, 0, 2.6));
  const solids = [
    ...room(-4.6, -1.6, 4.6, 7.8, 0),
    pillar(-1.5, 5.6, 0.5, 0, 0.7),
    pillar(1.5, 5.6, 0.5, 0, 0.7),
    pillar(-3.4, 2.4, 0.5, 0, 0.7),
  ];
  const decorList = [
    decor(pick(rng(seed + index), DECOR[spec.world] ?? DECOR.meadow), -6.5, -0.2, 3, 1.2),
    decor(pick(rng(seed + index + 1), DECOR[spec.world] ?? DECOR.meadow), 6.5, -0.2, 5, 1.1),
  ];
  return makeHole({
    id: holeId,
    name: 'Wishing Green',
    par: 2,
    fairway: false,
    points: [[0, 0, 0], [0, 0, 2.5], REST_CUP],
    tee: [0, 0, 0],
    cup: REST_CUP,
    solids,
    collectibles,
    decor: decorList,
    tip: 'Rest stop — no hearts at stake. Putt into the crate with the reward you want!',
  });
}

/** The run as a Course object (holes are appended as stages are generated). */
export function hopperCourse(seed: number, holes: Hole[] = []): Course {
  return {
    id: 'hopper',
    name: 'Planet Hopper',
    world: 'meadow',
    description: 'A roguelike run across procedurally generated planets.',
    theme: worldTheme('meadow'),
    holes,
  };
}

/** Clients: make sure every stage the host has announced has its hole built locally. */
export function syncHopperHoles(course: Course, seed: number, stages: StageSpec[]): void {
  for (let i = course.holes.length; i < stages.length; i++) course.holes.push(stageHole(seed, i, stages[i]));
}
