/** Cosmetic catalog. Visuals live in the client; this is the data both sides agree on. */

export type CosmeticSlot = 'ball' | 'trail' | 'putter' | 'hat' | 'victory' | 'hio' | 'sticker';

/** Case regions: one case per planet (see cases.ts). */
export type CaseId = 'meadow' | 'candy' | 'frozen' | 'clockwork' | 'space';
/** Skin and case rarities, lowest first. */
export const RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythic'] as const;
export type Rarity = (typeof RARITIES)[number];

export type Unlock =
  | { type: 'default' }
  | { type: 'level'; level: number }
  | { type: 'shop'; price: number }
  | { type: 'achievement'; id: string }
  | { type: 'crate' }
  /** Only from opening this planet's case (see cases.ts). */
  | { type: 'case'; case: CaseId };

export type SkinPattern =
  | 'solid'
  | 'stripes'
  | 'dots'
  | 'star'
  | 'half'
  | 'rainbow'
  | 'galaxy'
  | 'swirl'
  // v1.11 case skins
  | 'gradient'
  | 'rings'
  | 'sprinkles'
  | 'hex'
  | 'crystal'
  | 'gear'
  | 'circuit'
  | 'nebula'
  | 'marble'
  | 'petals';

export interface Cosmetic {
  id: string;
  slot: CosmeticSlot;
  name: string;
  /** Primary colour (UI swatch + renderer). */
  color: string;
  color2?: string;
  pattern?: SkinPattern;
  /** Putters: head style (looks only; every putter plays the same). */
  shape?: PutterShape;
  unlock: Unlock;
  /** Case skins: how rare the drop is. */
  rarity?: Rarity;
  /**
   * Extra render effect. metal: polished. glow: lit from inside with a soft aura.
   * mythic: animated holographic shell, pulsing aura, orbiting sparks and a stardust wake.
   */
  fx?: 'metal' | 'glow' | 'mythic';
  /** v1.12 stickers: the art (an emoji, or a short word) and the print finish. */
  glyph?: string;
  finish?: StickerFinish;
}

/** Sticker print finishes, like the real thing: plain paper, rainbow holo, gold foil. */
export type StickerFinish = 'paper' | 'holo' | 'gold';

export type PutterShape =
  'blade' | 'mallet' | 'fang' | 'hammer' | 'hockey' | 'flamingo' | 'cane' | 'star' | 'rocket';

const C = (
  id: string,
  slot: CosmeticSlot,
  name: string,
  color: string,
  unlock: Unlock,
  extra: Partial<Pick<Cosmetic, 'color2' | 'pattern' | 'shape'>> = {},
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
  // Putters (looks only: every putter plays the same)
  C('putter.classic', 'putter', 'Classic Blade', '#b0bec5', def, { shape: 'blade' }),
  C('putter.mallet', 'putter', 'Moon Mallet', '#37474f', def, { color2: '#ffd23f', shape: 'mallet' }),
  C('putter.fang', 'putter', 'Twin Fang', '#e53935', lvl(2), { color2: '#263238', shape: 'fang' }),
  C('putter.wood', 'putter', 'Driftwood', '#a1887f', lvl(3), { shape: 'blade' }),
  C('putter.hockey', 'putter', 'Hockey Stick', '#1565c0', lvl(4), { color2: '#ffffff', shape: 'hockey' }),
  C('putter.cane', 'putter', 'Candy Cane', '#ffffff', lvl(6), { color2: '#ff1744', pattern: 'stripes', shape: 'cane' }),
  C('putter.rocket', 'putter', 'Rocket', '#eceff1', lvl(8), { color2: '#ff5252', shape: 'rocket' }),
  C('putter.neon', 'putter', 'Neon', '#18ffff', shop(150), { color2: '#ff4081', shape: 'fang' }),
  C('putter.star', 'putter', 'Star Wand', '#7c4dff', shop(220), { color2: '#ffeb3b', shape: 'star' }),
  C('putter.gold', 'putter', 'Golden Putter', '#ffc400', shop(600), { color2: '#fff59d', shape: 'mallet' }),
  C('putter.flamingo', 'putter', 'Flamingo', '#ff80ab', crate, { color2: '#ffffff', shape: 'flamingo' }),
  C('putter.hammer', 'putter', 'Croquet Mallet', '#8d6e63', ach('bank_shot'), { color2: '#ffca28', shape: 'hammer' }),
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
  // Stickers (v1.12): the only plain one is "none"; the rest come out of cases.
  C('sticker.none', 'sticker', 'No Sticker', '#000000', def),
  ...caseSkins(),
  ...caseStickers(),
];

/**
 * v1.12 stickers: a decal slapped on the ball, like the stickers in a certain shooter's cases.
 * Each case holds three: a paper one (common), a holo (rare) and a gold foil (epic).
 */
function caseStickers(): Cosmetic[] {
  const st = (
    cs: CaseId,
    id: string,
    name: string,
    rarity: Rarity,
    glyph: string,
    color: string,
  ): Cosmetic => ({
    id: `sticker.${id}`,
    slot: 'sticker',
    name,
    color,
    glyph,
    finish: rarity === 'common' ? 'paper' : rarity === 'rare' ? 'holo' : 'gold',
    rarity,
    unlock: { type: 'case', case: cs },
  });
  return [
    st('meadow', 'gg', 'GG', 'common', 'GG', '#43a047'),
    st('meadow', 'frog', 'Pond Frog (Holo)', 'rare', '🐸', '#66bb6a'),
    st('meadow', 'clover', 'Lucky Clover (Gold)', 'epic', '🍀', '#ffc400'),
    st('candy', 'yum', 'YUM!', 'common', 'YUM!', '#ec407a'),
    st('candy', 'donut', 'Sprinkle Donut (Holo)', 'rare', '🍩', '#f48fb1'),
    st('candy', 'unicorn', 'Unicorn (Gold)', 'epic', '🦄', '#ffc400'),
    st('frozen', 'brr', 'BRR', 'common', 'BRR', '#29b6f6'),
    st('frozen', 'penguin', 'Penguin (Holo)', 'rare', '🐧', '#4fc3f7'),
    st('frozen', 'snowman', 'Snowman (Gold)', 'epic', '☃️', '#ffc400'),
    st('clockwork', 'fore', 'FORE!', 'common', 'FORE!', '#b87333'),
    st('clockwork', 'robot', 'Robot (Holo)', 'rare', '🤖', '#90a4ae'),
    st('clockwork', 'crown', 'Crown (Gold)', 'epic', '👑', '#ffc400'),
    st('space', 'ace', 'ACE', 'common', 'ACE', '#5e35b1'),
    st('space', 'alien', 'Alien (Holo)', 'rare', '👽', '#7c4dff'),
    st('space', 'rocket', 'Rocket (Gold)', 'epic', '🚀', '#ffc400'),
  ];
}

/**
 * v1.11 case skins: they only come out of their planet's case. Each case holds 3 common,
 * 2 rare, 1 epic, 1 legendary and 1 mythic skin.
 */
function caseSkins(): Cosmetic[] {
  type X = Partial<Pick<Cosmetic, 'color2' | 'pattern' | 'shape' | 'fx'>>;
  const k =
    (cs: CaseId) =>
    (id: string, slot: CosmeticSlot, name: string, rarity: Rarity, color: string, extra: X = {}): Cosmetic => ({
      id,
      slot,
      name,
      color,
      rarity,
      unlock: { type: 'case', case: cs },
      ...extra,
    });
  const m = k('meadow'),
    c = k('candy'),
    f = k('frozen'),
    w = k('clockwork'),
    s = k('space');
  return [
    // 🌻 Meadow Case
    m('ball.clover', 'ball', 'Four-Leaf', 'common', '#43a047', { color2: '#c8e6c9', pattern: 'dots' }),
    m('ball.ladybug', 'ball', 'Ladybug', 'common', '#e53935', { color2: '#1b1b1b', pattern: 'dots' }),
    m('trail.pollen', 'trail', 'Pollen Drift', 'common', '#ffee58', { color2: '#fffde7' }),
    m('ball.sunflower', 'ball', 'Sunflower', 'rare', '#ffca28', { color2: '#6d4c41', pattern: 'petals' }),
    m('putter.hedge', 'putter', 'Hedge Trimmer', 'rare', '#2e7d32', { color2: '#cfd8dc', shape: 'fang' }),
    m('ball.honeycomb', 'ball', 'Honeycomb', 'epic', '#ffb300', { color2: '#fff3c4', pattern: 'hex', fx: 'metal' }),
    m('trail.bloom', 'trail', 'Wildflower Bloom', 'legendary', '#ff80ab', { color2: '#b2ff59', fx: 'glow' }),
    m('ball.gaia', 'ball', 'Gaia', 'mythic', '#00e676', { color2: '#ffd740', pattern: 'petals', fx: 'mythic' }),
    // 🍭 Candy Case
    c('ball.gumdrop', 'ball', 'Gumdrop', 'common', '#ab47bc', { color2: '#fff176', pattern: 'sprinkles' }),
    c('ball.licorice', 'ball', 'Licorice', 'common', '#212121', { color2: '#e53935', pattern: 'stripes' }),
    c('trail.cottoncandy', 'trail', 'Cotton Candy', 'common', '#f8bbd0', { color2: '#b3e5fc' }),
    c('ball.jawbreaker', 'ball', 'Jawbreaker', 'rare', '#ff4081', { color2: '#40c4ff', pattern: 'rings' }),
    c('putter.lollipop', 'putter', 'Lollipop', 'rare', '#ff4081', { color2: '#ffffff', shape: 'star' }),
    c('ball.sprinklebomb', 'ball', 'Sprinkle Bomb', 'epic', '#ff80ab', { color2: '#7c4dff', pattern: 'sprinkles', fx: 'glow' }),
    c('ball.caramel', 'ball', 'Caramel Swirl', 'legendary', '#c77c2e', { color2: '#ffe0b2', pattern: 'marble', fx: 'metal' }),
    c('ball.sugarnova', 'ball', 'Sugarplum Nova', 'mythic', '#ff2d95', { color2: '#22e4ff', pattern: 'sprinkles', fx: 'mythic' }),
    // ❄️ Frozen Case
    f('ball.snowball', 'ball', 'Snowball', 'common', '#e3f2fd', { color2: '#90caf9', pattern: 'dots' }),
    f('ball.glacier', 'ball', 'Glacier', 'common', '#4fc3f7', { color2: '#e1f5fe', pattern: 'gradient' }),
    f('trail.frost', 'trail', 'Hoarfrost', 'common', '#b3e5fc', { color2: '#ffffff' }),
    f('ball.icicle', 'ball', 'Icicle', 'rare', '#81d4fa', { color2: '#ffffff', pattern: 'crystal' }),
    f('putter.icepick', 'putter', 'Ice Pick', 'rare', '#b3e5fc', { color2: '#37474f', shape: 'fang' }),
    f('ball.aurora', 'ball', 'Aurora', 'epic', '#00e5ff', { color2: '#d500f9', pattern: 'gradient', fx: 'glow' }),
    f('ball.diamonddust', 'ball', 'Diamond Dust', 'legendary', '#e0f7fa', { color2: '#80deea', pattern: 'crystal', fx: 'metal' }),
    f('ball.absolutezero', 'ball', 'Absolute Zero', 'mythic', '#7df9ff', { color2: '#ffffff', pattern: 'crystal', fx: 'mythic' }),
    // ⚙️ Clockwork Case
    w('ball.brass', 'ball', 'Polished Brass', 'common', '#c8a046', { color2: '#7a5c1e', pattern: 'gradient', fx: 'metal' }),
    w('ball.rivet', 'ball', 'Riveted', 'common', '#78909c', { color2: '#cfd8dc', pattern: 'dots', fx: 'metal' }),
    w('trail.steam', 'trail', 'Steam Vent', 'common', '#eceff1', { color2: '#90a4ae' }),
    w('ball.cogwork', 'ball', 'Cogwork', 'rare', '#b87333', { color2: '#5d4037', pattern: 'gear', fx: 'metal' }),
    w('putter.wrench', 'putter', 'Big Wrench', 'rare', '#b0bec5', { color2: '#d84315', shape: 'hammer' }),
    w('ball.circuit', 'ball', 'Live Circuit', 'epic', '#0b3d2e', { color2: '#00ff9c', pattern: 'circuit', fx: 'glow' }),
    w('putter.tesla', 'putter', 'Tesla Coil', 'legendary', '#263238', { color2: '#40c4ff', shape: 'rocket' }),
    w('ball.chronos', 'ball', 'Chronos', 'mythic', '#ffc400', { color2: '#00e5c0', pattern: 'gear', fx: 'mythic' }),
    // 🪐 Space Case
    s('ball.moonrock', 'ball', 'Moon Rock', 'common', '#9e9e9e', { color2: '#616161', pattern: 'dots' }),
    s('ball.redplanet', 'ball', 'Red Planet', 'common', '#d84315', { color2: '#ffab91', pattern: 'marble' }),
    s('trail.comet', 'trail', 'Comet Tail', 'common', '#82b1ff', { color2: '#ffffff' }),
    s('ball.ringworld', 'ball', 'Ringworld', 'rare', '#ffcc80', { color2: '#8d6e63', pattern: 'rings' }),
    s('putter.saber', 'putter', 'Star Saber', 'rare', '#eceff1', { color2: '#ff1744', shape: 'blade' }),
    s('ball.nebula', 'ball', 'Nebula', 'epic', '#311b92', { color2: '#ff4081', pattern: 'nebula', fx: 'glow' }),
    s('trail.warp', 'trail', 'Warp Drive', 'legendary', '#7c4dff', { color2: '#18ffff', fx: 'glow' }),
    s('ball.eventhorizon', 'ball', 'Event Horizon', 'mythic', '#0a0014', { color2: '#ff9100', pattern: 'nebula', fx: 'mythic' }),
  ];
}

export const COSMETIC_BY_ID = new Map(COSMETICS.map((c) => [c.id, c]));

export type Loadout = Record<CosmeticSlot, string>;

export const DEFAULT_LOADOUT: Loadout = {
  ball: 'ball.classic',
  trail: 'trail.puff',
  putter: 'putter.classic',
  hat: 'hat.cap',
  victory: 'victory.hop',
  hio: 'hio.confetti',
  sticker: 'sticker.none',
};

export const SLOT_LABELS: Record<CosmeticSlot, string> = {
  ball: 'Balls',
  trail: 'Trails',
  putter: 'Putters',
  hat: 'Hats',
  victory: 'Victory',
  hio: 'Hole-in-One FX',
  sticker: 'Stickers',
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
