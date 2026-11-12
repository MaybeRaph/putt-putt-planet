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
import { WALL_T, coinLine, decor, item, makeHole, pillar, room, wall, zone } from '../courses/builder';
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
      const [near, far] = ([[3, 11], [4.5, 17], [6, 24]] as const)[g];
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
type Special = 'ramp' | 'hump' | 'split' | 'jump' | 'plaza';
/** What each polyline segment is (features only go on plain 'flat' stretches). */
type SegTag = 'flat' | 'landing' | 'ramp' | 'arc' | 'kicker' | 'gap' | 'split' | 'plaza';

interface Leg {
  a: Vec3;
  b: Vec3;
  ang: number;
  len: number;
  special: Special | null;
  dy: number;
}

const SPECIAL_LEN: Record<Special, number> = { ramp: 6.5, hump: 9.5, split: 10, jump: 11.5, plaza: 10 };
/** Par difficulty points per special. */
const SPECIAL_DIFF: Record<Special, number> = { ramp: 0.3, hump: 0.6, split: 0.5, jump: 1.5, plaza: 1.3 };

const norm = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function golfHole(seed: number, index: number, spec: StageSpec) {
  const r = rng(hashString(`hop:${seed}:${index}:${spec.variant}`));
  const t = Math.min(1, spec.depth / MAX_DEPTH);
  const boss = spec.kind === 'boss';
  const W = Math.max(1.6, (boss ? 2.35 : 2.6) - 0.75 * t);
  const holeId = `hop${seed}-${index}`;
  const socks = lv(spec, 'socks');
  const world = spec.world;
  const nLegs = Math.min(6, 2 + Math.round(t * 2.5) + (r() < 0.5 ? 1 : 0) + (boss ? 1 : 0));

  // ---- 1. Legs: straight runs in 8 directions, turning ±90° (sometimes ±45°), never crossing.
  const specialPool: Special[] = ['ramp'];
  if (spec.depth >= 1) specialPool.push('hump');
  if (spec.depth >= 2) specialPool.push('split', 'ramp');
  if (spec.depth >= 3) specialPool.push('jump');
  if (spec.depth >= 5) specialPool.push('plaza');
  if (spec.depth >= 8) specialPool.push('jump', 'split');
  const maxSpecials = 1 + (t > 0.3 ? 1 : 0) + (boss ? 1 : 0);
  const usedSpecials: Special[] = [];
  const legs: Leg[] = [];
  const cells = new Set<string>();
  const cellOf = (x: number, z: number) => `${Math.round(x / 4)},${Math.round(z / 4)}`;
  cells.add(cellOf(0, 0));
  let dir = 0;
  let cur: Vec3 = [0, 0, 0];
  for (let i = 0; i < nLegs; i++) {
    let special: Special | null = null;
    if (i > 0 && usedSpecials.length < maxSpecials && r() < 0.3 + 0.35 * t + (boss ? 0.15 : 0)) {
      const avail = specialPool.filter((x) => x === 'ramp' || !usedSpecials.includes(x));
      special = pick(r, avail);
    }
    let len = Math.round(range(r, 5.5, 8.5 + t * 2));
    if (special) len = Math.max(len, Math.ceil(SPECIAL_LEN[special] + (i === nLegs - 1 ? 2 : 0) + range(r, 0, 1.5)));
    const dy =
      special === 'ramp' ? (r() < 0.5 ? 1 : -1) * (t > 0.5 && r() < 0.5 ? 0.9 : 0.5) : 0;
    const diag = i > 0 && r() < 0.3;
    const quarter = diag ? Math.PI / 4 : Math.PI / 2;
    const turns = i === 0 ? [0] : r() < 0.5 ? [quarter, -quarter, 0] : [-quarter, quarter, 0];
    let placed = false;
    for (const turn of turns) {
      const d = dir + turn;
      const ux = Math.cos(d),
        uz = Math.sin(d);
      const b: Vec3 = [cur[0] + ux * len, cur[1] + dy, cur[2] + uz * len];
      const mine = new Set<string>();
      const start = cellOf(cur[0], cur[2]);
      let clash = false;
      for (let k = 1; k <= Math.ceil(len); k++) {
        const c = cellOf(cur[0] + ux * Math.min(k, len), cur[2] + uz * Math.min(k, len));
        if (c !== start && !mine.has(c) && cells.has(c)) clash = true;
        mine.add(c);
      }
      if (clash) continue;
      mine.forEach((c) => cells.add(c));
      legs.push({ a: cur, b, ang: d, len, special, dy });
      if (special) usedSpecials.push(special);
      dir = d;
      cur = b;
      placed = true;
      break;
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
    if (r() > 0.25 + 0.45 * (1 - t) + (Math.abs(th) < 1 ? 0.3 : 0)) {
      sharp++;
      continue;
    }
    const tanH = Math.tan(Math.abs(th) / 2);
    const R0 = Math.abs(th) > 1 ? range(r, 1.6, 2.8) : range(r, 2.5, 4.5);
    // Never eat into the room a special needs (a ramp must keep its gentle slope).
    const room = (leg: Leg, k: number) =>
      leg.special
        ? Math.max(0, (leg.len - SPECIAL_LEN[leg.special] - (k === legs.length - 1 ? 2.5 : 0)) / 2)
        : leg.len * 0.28;
    const d = Math.min(R0 * tanH, prev.len * 0.28, next.len * 0.28, room(prev, i - 1), room(next, i));
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
  const pathPts: Vec3[] = [];
  const push = (p: Vec3, tag: SegTag, pathOverride?: Vec3[]) => {
    if (pts.length) tags.push(tag);
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
  const laneW = Math.max(1.2, W * 0.72);
  const splitW = laneW * 2 + WALL_T;
  const plazaW = W * 1.6 + 1.4;

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
    const y0 = L.a[1];
    if (i === 0) push(S, 'flat');
    else if (arcs[i]) for (const p of arcs[i]!) push(p, 'arc');
    else push(S, 'flat'); // sharp corner: S === corner point (zero-length push is skipped below)
    const lastLeg = i === legs.length - 1;
    const tail = lastLeg ? 2.5 : 0; // keep the approach to the cup clean
    let sp = L.special;
    if (sp && Lp < SPECIAL_LEN[sp] + tail - 0.5) sp = sp === 'ramp' && Lp >= 5 ? 'ramp' : null;
    if (L.dy && sp !== 'ramp') sp = 'ramp';
    switch (sp) {
      case 'ramp': {
        const land = 1.5;
        push(at(land, y0), 'landing');
        push(at(Lp - land, E[1]), 'ramp');
        push(E, 'landing');
        difficulty += SPECIAL_DIFF.ramp;
        break;
      }
      case 'hump': {
        const hgt = t > 0.5 ? 0.7 : 0.5;
        const run = (Lp - tail - 1.5) / 2 - 1.2;
        push(at(1.2, y0), 'landing');
        push(at(1.2 + run, y0 + hgt), 'ramp');
        push(at(1.2 + run + 1.5, y0 + hgt), 'landing');
        push(at(1.2 + 2 * run + 1.5, y0), 'ramp');
        push(E, 'flat');
        collectibles.push(item(holeId, 'coin', ...(at(1.2 + run + 0.75, y0 + hgt) as [number, number, number])));
        difficulty += SPECIAL_DIFF.hump;
        tips.push('Over the hump: give it enough to crest the hill.');
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
        zones.push(zone('water', gm[0], gm[2], gap + 0.3, W + 3, y0, { rotY: -L.ang }));
        if (world === 'space' || gap > 2)
          zones.push(zone('lowGravity', gm[0], gm[2], gap + 2, W + 1, y0, { strength: 0.5, h: 3, rotY: -L.ang }));
        if (r() < 0.45)
          zones.push(
            zone('boost', K0[0] - ux * 1, K0[2] - uz * 1, 1.2, W * 0.8, y0, {
              dir: L.ang,
              strength: 8.5,
              rotY: -L.ang,
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
      case 'split':
      case 'plaza': {
        const A1 = at(1.4, y0);
        const B1 = at(Lp - 1.4 - tail, y0);
        const wide = sp === 'split' ? splitW : plazaW;
        // The path (camera, rescue) runs down lane A instead of over the divider.
        const off = sp === 'split' ? (laneW + WALL_T) / 2 : 0;
        push(A1, 'flat');
        push(B1, sp, [
          [A1[0] + ux * 0.9 + nx * off, y0, A1[2] + uz * 0.9 + nz * off],
          [B1[0] - ux * 0.9 + nx * off, y0, B1[2] - uz * 0.9 + nz * off],
        ]);
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
        const segLen = Lp - 2.8 - tail;
        const mid = at(1.4 + segLen / 2, y0);
        if (sp === 'split') {
          extraSolids.push(wall(at(2.5, y0), at(1.4 + segLen - 1.1, y0)));
          // Two lanes with different characters.
          const laneOpts = ['boost', 'coins', 'bumper', 'pillar'];
          if (!socks) laneOpts.push('sand');
          if (socks < 2) laneOpts.push('ice');
          const a = pick(r, laneOpts);
          const b = pick(r, laneOpts.filter((x) => x !== a));
          for (const [kind, side] of [
            [a, 1],
            [b, -1],
          ] as const) {
            const c: Vec3 = [mid[0] + nx * side * off, y0, mid[2] + nz * side * off];
            laneFeature(kind, c, side);
          }
          if (r() < 0.6) {
            const side = r() < 0.5 ? 1 : -1;
            collectibles.push(item(holeId, 'gem', mid[0] + nx * side * off + ux * 1.8, y0, mid[2] + nz * side * off + uz * 1.8));
          }
          difficulty += SPECIAL_DIFF.split;
          tips.push('The fairway splits in two: pick your lane.');
        } else {
          // Pinball plaza: a staggered field of bumpers.
          const rows = Math.max(2, Math.floor((segLen - 1.6) / 1.6));
          for (let k = 0; k < rows; k++) {
            const along = 1.4 + 0.8 + (k + 0.5) * ((segLen - 1.6) / rows);
            const lanes = k % 2 ? [-0.5, 0.5] : [-0.75, 0, 0.75];
            for (const q of lanes) {
              const jitter = (r() - 0.5) * 0.25;
              const p = at(along, y0);
              obstacles.push({
                type: 'bumper',
                id: `pz${i}-${k}-${q}`,
                pos: [p[0] + nx * (q * (wide / 2 - 0.5) + jitter), y0, p[2] + nz * (q * (wide / 2 - 0.5) + jitter)],
                radius: 0.28,
                height: 0.4,
                strength: 1,
                phase: 0,
              });
            }
          }
          collectibles.push(...coinLine(holeId, at(2.4, y0), at(1.4 + segLen - 0.8, y0), 3));
          difficulty += SPECIAL_DIFF.plaza;
          tips.push('Pinball plaza! Bumpers everywhere: bank it through.');
        }
        break;
      }
      default:
        push(E, 'flat');
        break;
    }
    function laneFeature(kind: string, c: Vec3, side: number) {
      switch (kind) {
        case 'boost':
          zones.push(
            zone('boost', c[0] - ux * 1.6, c[2] - uz * 1.6, 1.1, laneW - 0.1, y0, { dir: L.ang, strength: 8, rotY: -L.ang }),
          );
          break;
        case 'sand':
          zones.push(zone('sand', c[0], c[2], 2.2, laneW, y0, { rotY: -L.ang }));
          break;
        case 'ice':
          zones.push(zone('ice', c[0], c[2], 3, laneW, y0, { rotY: -L.ang }));
          break;
        case 'bumper':
          obstacles.push({ type: 'bumper', id: `lb${i}${side}`, pos: c, radius: 0.28, height: 0.4, strength: 1, phase: 0 });
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
    }
  for (let i = pathPts.length - 1; i > 0; i--)
    if (Math.hypot(pathPts[i][0] - pathPts[i - 1][0], pathPts[i][2] - pathPts[i - 1][2], pathPts[i][1] - pathPts[i - 1][1]) < 1e-3)
      pathPts.splice(i, 1);

  // ---- 4. Hazards and machinery on the plain flat stretches.
  const openLeft: number[] = [];
  const openRight: number[] = [];
  const noFloor: number[] = [];
  const widths: Record<number, number> = {};
  tags.forEach((tg, i) => {
    if (tg === 'gap') {
      noFloor.push(i);
      openLeft.push(i);
      openRight.push(i);
    } else if (tg === 'split') widths[i] = splitW;
    else if (tg === 'plaza') widths[i] = plazaW;
  });
  const speed = 1 + 0.6 * t;

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
  const pool: Feature[] = ['bumpers', 'pillars'];
  if (!socks) pool.push('sand');
  if (spec.depth >= 1) pool.push('boost');
  if (spec.depth >= 2) pool.push('spinner');
  if (spec.depth >= 3) pool.push('mover');
  if (spec.depth >= 4 && socks < 3) pool.push('pools');
  if (spec.depth >= 5) pool.push('windmill');
  if (spec.depth >= 7 && socks < 2) pool.push('ice', 'conveyor');
  if (spec.depth >= 9) pool.push('gate', 'spinner');
  if (spec.depth >= 9 && socks < 3) pool.push('pools');
  // Each planet leans on its own signature hazards.
  const flavour: Record<string, Feature[]> = {
    meadow: ['bumpers', 'pillars'],
    candy: socks ? ['bumpers'] : ['sticky', 'sticky'],
    frozen: socks < 2 ? ['ice', 'ice'] : ['pillars'],
    clockwork: spec.depth >= 3 ? ['gate', 'mover', 'spinner'] : ['spinner'],
    space: ['bumpers', 'spinner'],
  };
  pool.push(...(flavour[world] ?? []).filter((f) => spec.depth >= 2 || (f !== 'gate' && f !== 'mover')));
  const heavy: Feature[] =
    spec.depth >= 5 ? ['windmill', 'spinner', 'mover', 'gate'] : ['spinner', 'mover', 'bumpers'];

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
    if (tags[i] !== 'flat' || segLen < 4) {
      continue;
    }
    const chance = first ? (t > 0.4 ? 0.5 : 0) : boss ? 1 : 0.45 + 0.5 * t;
    const count = r() < chance ? (segLen > 7 && r() < t - 0.3 ? 2 : 1) : 0;
    const rot = { rotY: -ang };
    for (let k = 0; k < count; k++) {
      const lo = first ? 0.5 : 0.25;
      const hi = lastSeg ? 0.6 : 0.75;
      const f = count === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * (k + 0.5)) / count;
      const c: Vec3 = [a[0] + (b[0] - a[0]) * f, a[1], a[2] + (b[2] - a[2]) * f];
      const kind: Feature = boss && k === 0 ? pick(r, heavy) : pick(r, pool);
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
            [1, -0.6],
            [-1, 0.6],
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
            zone('boost', c[0] - ux * 1.2, c[2] - uz * 1.2, 1.2, 1.4, c[1], { dir: ang, strength: 9, rotY: -ang }),
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
            length: Math.min(W - 0.3, 2.3),
            arms: spec.depth >= 8 && r() < 0.5 ? 3 : 2,
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
    const wide = L.special === 'plaza' ? plazaW : L.special === 'split' ? splitW : W;
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
  if (legs.length >= 4 && spec.depth >= 4 && r() < 0.35) {
    const early = flatSegs.filter((i) => i > 0 && i < pts.length / 2 && !openLeft.includes(i) && !openRight.includes(i));
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
      obstacles.push({ type: 'teleporter', id: 'wormhole', a: A, b: B, exitDir: exitAng, radius: 0.36, phase: 0 });
      tips.push('A wormhole pad hides beside the rail: a shortcut to the green!');
    }
  }

  let length = 0;
  for (let i = 0; i < pts.length - 1; i++) length += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][2] - pts[i][2]);
  const par = Math.max(
    2,
    Math.min(
      6,
      Math.round(1.0 + length / 15 + sharp * 0.28 + curves * 0.16 + difficulty * 0.14 + (boss ? 0.25 : 0)),
    ),
  );
  const [adj, noun] = NAMES[world] ?? NAMES.meadow;
  const name = boss ? (BOSS_NAMES[world] ?? 'Boss') : `${pick(r, adj)} ${pick(r, noun)}`;

  return makeHole({
    id: holeId,
    name,
    par,
    fairway: { width: W, openLeft, openRight, noFloor, widths },
    points: pts,
    path: pathPts,
    obstacles,
    zones,
    collectibles,
    decor: decorList,
    solids: extraSolids,
    tip: boss
      ? `Boss hole! Clear it to bank a trinket and stardust.${tips.length ? ` ${tips[0]}` : ''}`
      : tips.length
        ? tips[Math.floor(r() * tips.length)]
        : undefined,
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
