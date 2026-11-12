/** Cosmetic catalog. Visuals live in the client; this is the data both sides agree on. */

export type CosmeticSlot = 'ball' | 'trail' | 'putter' | 'hat' | 'victory' | 'hio';

export type Unlock =
  | { type: 'default' }
  | { type: 'level'; level: number }
  | { type: 'shop'; price: number }
  | { type: 'achievement'; id: string }
  | { type: 'crate' };

export interface Cosmetic {
  id: string;
  slot: CosmeticSlot;
  name: string;
  /** Primary colour (UI swatch + renderer). */
  color: string;
  color2?: string;
  pattern?: 'solid' | 'stripes' | 'dots' | 'star' | 'half' | 'rainbow' | 'galaxy' | 'swirl';
  unlock: Unlock;
}

const C = (
  id: string,
  slot: CosmeticSlot,
  name: string,
  color: string,
  unlock: Unlock,
  extra: Partial<Pick<Cosmetic, 'color2' | 'pattern'>> = {},
): Cosmetic => ({ id, slot, name, color, unlock, ...extra });

const def: Unlock = { type: 'default' };
const lvl = (level: number): Unlock => ({ type: 'level', level });
const shop = (price: number): Unlock => ({ type: 'shop', price });
const ach = (id: string): Unlock => ({ type: 'achievement', id });
const crate: Unlock = { type: 'crate' };

export const COSMETICS: Cosmetic[] = [
  // Balls
  C('ball.classic', 'ball', 'Classic', '#f7f7f2', def),
  C('ball.sunny', 'ball', 'Sunny', '#ffd23f', def),
  C('ball.bubblegum', 'ball', 'Bubblegum', '#ff7eb6', def),
  C('ball.sky', 'ball', 'Sky', '#5ec8ff', lvl(2)),
  C('ball.mint', 'ball', 'Mint', '#7cf0b5', lvl(3)),
  C('ball.beach', 'ball', 'Beach Ball', '#ff5252', shop(120), { color2: '#ffffff', pattern: 'stripes' }),
  C('ball.dotty', 'ball', 'Dotty', '#7c4dff', shop(90), { color2: '#ffffff', pattern: 'dots' }),
  C('ball.melon', 'ball', 'Watermelon', '#2e7d32', crate, { color2: '#a5d6a7', pattern: 'stripes' }),
  C('ball.eight', 'ball', 'Eight Ball', '#1c1c1c', lvl(5), { color2: '#ffffff', pattern: 'star' }),
  C('ball.half', 'ball', 'Half & Half', '#ff9100', lvl(7), { color2: '#00b0ff', pattern: 'half' }),
  C('ball.galaxy', 'ball', 'Galaxy', '#2a1b5c', ach('collector'), { color2: '#e1bee7', pattern: 'galaxy' }),
  C('ball.rainbow', 'ball', 'Rainbow', '#ff5252', shop(400), { pattern: 'rainbow' }),
  C('ball.swirl', 'ball', 'Peppermint', '#ffffff', crate, { color2: '#ff1744', pattern: 'swirl' }),
  C('ball.gold', 'ball', 'Solid Gold', '#ffc400', ach('golden_touch'), {
    color2: '#fff59d',
    pattern: 'star',
  }),
  C('ball.frost', 'ball', 'Frostbite', '#b3e5fc', lvl(10), { color2: '#ffffff', pattern: 'dots' }),
  // Trails
  C('trail.none', 'trail', 'None', '#000000', def),
  C('trail.puff', 'trail', 'Cloud Puff', '#ffffff', def),
  C('trail.sunset', 'trail', 'Sunset', '#ff9e40', lvl(2), { color2: '#ff3d71' }),
  C('trail.ocean', 'trail', 'Ocean', '#00b0ff', shop(80), { color2: '#1de9b6' }),
  C('trail.rainbow', 'trail', 'Rainbow', '#ff5252', shop(300), { pattern: 'rainbow' }),
  C('trail.sparkle', 'trail', 'Sparkle', '#fff59d', ach('hole_in_one'), {
    color2: '#ffffff',
    pattern: 'star',
  }),
  C('trail.fire', 'trail', 'Fireball', '#ff6d00', lvl(8), { color2: '#ffd600' }),
  C('trail.toxic', 'trail', 'Toxic', '#76ff03', crate, { color2: '#00e676' }),
  // Putters
  C('putter.classic', 'putter', 'Classic', '#b0bec5', def),
  C('putter.wood', 'putter', 'Driftwood', '#a1887f', lvl(3)),
  C('putter.neon', 'putter', 'Neon', '#18ffff', shop(150), { color2: '#ff4081' }),
  C('putter.flamingo', 'putter', 'Flamingo', '#ff80ab', crate, { color2: '#ffffff' }),
  C('putter.hammer', 'putter', 'Mallet', '#8d6e63', ach('bank_shot'), { color2: '#ffca28' }),
  C('putter.gold', 'putter', 'Golden Putter', '#ffc400', shop(600), { color2: '#fff59d' }),
  C('putter.cane', 'putter', 'Candy Cane', '#ffffff', lvl(6), { color2: '#ff1744', pattern: 'stripes' }),
  // Hats
  C('hat.none', 'hat', 'No Hat', '#000000', def),
  C('hat.cap', 'hat', 'Ball Cap', '#1e88e5', def),
  C('hat.party', 'hat', 'Party Hat', '#ff4081', lvl(2), { color2: '#ffeb3b' }),
  C('hat.tophat', 'hat', 'Top Hat', '#212121', shop(120), { color2: '#d32f2f' }),
  C('hat.crown', 'hat', 'Crown', '#ffc400', ach('perfect_course')),
  C('hat.propeller', 'hat', 'Propeller', '#43a047', lvl(4), { color2: '#ff1744' }),
  C('hat.cowboy', 'hat', 'Cowboy', '#8d6e63', shop(160)),
  C('hat.viking', 'hat', 'Viking', '#9e9e9e', crate, { color2: '#fff8e1' }),
  C('hat.chef', 'hat', 'Chef', '#ffffff', crate),
  C('hat.wizard', 'hat', 'Wizard', '#5e35b1', lvl(9), { color2: '#ffeb3b' }),
  C('hat.santa', 'hat', 'Festive', '#d32f2f', ach('frozen_master'), { color2: '#ffffff' }),
  C('hat.halo', 'hat', 'Halo', '#fff59d', ach('no_water')),
  C('hat.beanie', 'hat', 'Beanie', '#ff7043', shop(70), { color2: '#ffffff' }),
  // Victory animations
  C('victory.hop', 'victory', 'Happy Hop', '#81c784', def),
  C('victory.spin', 'victory', 'Spin Out', '#64b5f6', lvl(3)),
  C('victory.flip', 'victory', 'Backflip', '#ffb74d', shop(200)),
  C('victory.rocket', 'victory', 'Rocket', '#e57373', ach('speed_demon')),
  C('victory.dance', 'victory', 'Wiggle', '#ba68c8', crate),
  // Hole-in-one effects
  C('hio.confetti', 'hio', 'Confetti', '#ffeb3b', def),
  C('hio.fireworks', 'hio', 'Fireworks', '#ff5252', lvl(5)),
  C('hio.hearts', 'hio', 'Hearts', '#ff4081', shop(250)),
  C('hio.stars', 'hio', 'Starburst', '#ffd740', ach('ace_collector')),
  C('hio.bubbles', 'hio', 'Bubbles', '#80d8ff', crate),
];

export const COSMETIC_BY_ID = new Map(COSMETICS.map((c) => [c.id, c]));

export type Loadout = Record<CosmeticSlot, string>;

export const DEFAULT_LOADOUT: Loadout = {
  ball: 'ball.classic',
  trail: 'trail.puff',
  putter: 'putter.classic',
  hat: 'hat.cap',
  victory: 'victory.hop',
  hio: 'hio.confetti',
};

export const SLOT_LABELS: Record<CosmeticSlot, string> = {
  ball: 'Balls',
  trail: 'Trails',
  putter: 'Putters',
  hat: 'Hats',
  victory: 'Victory',
  hio: 'Hole-in-One FX',
};

/** Sanitise a loadout coming from the network or storage. */
export function sanitizeLoadout(
  l: Partial<Record<string, string>> | undefined,
  owned?: Set<string>,
): Loadout {
  const out = { ...DEFAULT_LOADOUT };
  if (!l) return out;
  for (const slot of Object.keys(out) as CosmeticSlot[]) {
    const id = l[slot];
    const c = id ? COSMETIC_BY_ID.get(id) : undefined;
    if (c && c.slot === slot && (!owned || owned.has(id!) || c.unlock.type === 'default')) out[slot] = id!;
  }
  return out;
}
