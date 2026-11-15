import { COSMETICS, COSMETIC_BY_ID, RARITIES, type CaseId, type Cosmetic, type Rarity } from './cosmetics';
import { defaultCases, type Profile } from './profile';
import { dustBalance } from './hopper/defs';

/**
 * v1.11 cases. Planet Hopper stages sometimes hide a case (one per planet, so cases are
 * regional); a case opens with a key bought with stardust, and drops one skin that only that
 * case holds, weighted by rarity. Everything here is pure, so the client and tests agree.
 */

export const CASE_IDS: readonly CaseId[] = ['meadow', 'candy', 'frozen', 'clockwork', 'space'];

export interface CaseDef {
  id: CaseId;
  name: string;
  icon: string;
  /** How prized the case is: sets the key price and nudges up the odds of the best skins. */
  rarity: Rarity;
  /** Stardust per key. */
  keyPrice: number;
  /** Case art colours. */
  color: string;
  color2: string;
}

export const CASES: Record<CaseId, CaseDef> = {
  meadow: {
    id: 'meadow',
    name: 'Meadow Case',
    icon: '🌻',
    rarity: 'common',
    keyPrice: 100,
    color: '#43a047',
    color2: '#c5e1a5',
  },
  candy: {
    id: 'candy',
    name: 'Candy Case',
    icon: '🍭',
    rarity: 'rare',
    keyPrice: 175,
    color: '#ec407a',
    color2: '#f8bbd0',
  },
  frozen: {
    id: 'frozen',
    name: 'Frozen Case',
    icon: '❄️',
    rarity: 'epic',
    keyPrice: 275,
    color: '#29b6f6',
    color2: '#e1f5fe',
  },
  clockwork: {
    id: 'clockwork',
    name: 'Clockwork Case',
    icon: '⚙️',
    rarity: 'legendary',
    keyPrice: 400,
    color: '#b87333',
    color2: '#ffe0b2',
  },
  space: {
    id: 'space',
    name: 'Space Case',
    icon: '🪐',
    rarity: 'mythic',
    keyPrice: 600,
    color: '#5e35b1',
    color2: '#b388ff',
  },
};

export const RARITY_INFO: Record<Rarity, { label: string; color: string; weight: number }> = {
  common: { label: 'Common', color: '#4b8bff', weight: 72 },
  rare: { label: 'Rare', color: '#8847ff', weight: 20 },
  epic: { label: 'Epic', color: '#d32ce6', weight: 6 },
  legendary: { label: 'Legendary', color: '#eb4b4b', weight: 1.6 },
  mythic: { label: 'Mythic', color: '#ffc400', weight: 0.4 },
};

/** Chance a Planet Hopper golf stage hides a case: ~0.8 per 16-hole run. */
export const CASE_SPAWN_CHANCE = 1 / 20;

/** Better cases weight their epic and rarer skins up by this much. */
const LUCK: Record<Rarity, number> = { common: 1, rare: 1.15, epic: 1.3, legendary: 1.5, mythic: 1.8 };

/** Stardust back for a skin you already own, as a share of the key price. */
const DUPLICATE_REFUND: Record<Rarity, number> = {
  common: 0.15,
  rare: 0.3,
  epic: 0.6,
  legendary: 1.2,
  mythic: 3,
};

export const isCaseId = (s: string): s is CaseId => (CASE_IDS as readonly string[]).includes(s);

/** The skins a case can drop, rarest last. */
export function caseSkins(id: CaseId): Cosmetic[] {
  return COSMETICS.filter((c) => c.unlock.type === 'case' && c.unlock.case === id).sort(
    (a, b) => RARITIES.indexOf(a.rarity ?? 'common') - RARITIES.indexOf(b.rarity ?? 'common'),
  );
}

/** Chance of each rarity from this case (sums to 1; rarities the case lacks are left out). */
export function caseOdds(id: CaseId): Record<Rarity, number> {
  const have = new Set(caseSkins(id).map((s) => s.rarity ?? 'common'));
  const luck = LUCK[CASES[id].rarity];
  const w = {} as Record<Rarity, number>;
  let total = 0;
  for (const r of RARITIES) {
    const boost = RARITIES.indexOf(r) >= 2 ? luck : 1;
    w[r] = have.has(r) ? RARITY_INFO[r].weight * boost : 0;
    total += w[r];
  }
  for (const r of RARITIES) w[r] /= total;
  return w;
}

/** Pick the drop from two uniform randoms in [0, 1): one for the rarity, one for the skin. */
export function pickCaseSkin(id: CaseId, rollRarity: number, rollSkin: number): Cosmetic {
  const odds = caseOdds(id);
  let acc = 0;
  let rarity: Rarity = 'common';
  for (const r of RARITIES) {
    if (!odds[r]) continue;
    acc += odds[r];
    rarity = r;
    if (rollRarity < acc) break;
  }
  const pool = caseSkins(id).filter((s) => (s.rarity ?? 'common') === rarity);
  return pool[Math.min(pool.length - 1, Math.floor(rollSkin * pool.length))];
}

/** Cases and keys in hand for one case type. */
export function caseStock(p: Profile, id: CaseId): { cases: number; keys: number } {
  const c = p.cases ?? defaultCases();
  const opened = c.opened[id] ?? 0;
  return { cases: Math.max(0, (c.found[id] ?? 0) - opened), keys: Math.max(0, (c.keys[id] ?? 0) - opened) };
}

/** Buy a key for a case with stardust. Returns the new profile or an error string. */
export function buyCaseKey(profile: Profile, id: CaseId): Profile | string {
  if (!isCaseId(id)) return 'Unknown case';
  const price = CASES[id].keyPrice;
  if (dustBalance(profile.hopper) < price) return 'Not enough stardust';
  const p = structuredClone(profile);
  p.cases ??= defaultCases();
  p.hopper.dustSpent += price;
  p.cases.keys[id] = (p.cases.keys[id] ?? 0) + 1;
  return p;
}

export interface CaseOpening {
  profile: Profile;
  skin: Cosmetic;
  /** Already owned: refunded in stardust instead. */
  duplicate: boolean;
  refund: number;
}

/** Open a case with a key (both in hand). `rollRarity`/`rollSkin` are uniform randoms in [0, 1). */
export function openCase(
  profile: Profile,
  id: CaseId,
  rollRarity: number,
  rollSkin: number,
): CaseOpening | string {
  if (!isCaseId(id)) return 'Unknown case';
  const stock = caseStock(profile, id);
  if (stock.cases < 1) return `No ${CASES[id].name} to open`;
  if (stock.keys < 1) return 'You need a key first';
  const skin = pickCaseSkin(id, rollRarity, rollSkin);
  const p = structuredClone(profile);
  p.cases ??= defaultCases();
  p.cases.opened[id] = (p.cases.opened[id] ?? 0) + 1;
  const duplicate = p.owned.includes(skin.id);
  let refund = 0;
  if (duplicate) {
    refund = Math.max(1, Math.round(CASES[id].keyPrice * DUPLICATE_REFUND[skin.rarity ?? 'common']));
    p.hopper.dustEarned += refund;
  } else p.owned.push(skin.id);
  return { profile: p, skin, duplicate, refund };
}

/** The case a pickup id belongs to (`<hole>:case:<planet>@x,z`), or null. */
export function caseOfItem(itemId: string): CaseId | null {
  const m = /:case:([a-z]+)@/.exec(itemId);
  return m && isCaseId(m[1]) ? m[1] : null;
}

export function caseSkinById(id: string): Cosmetic | undefined {
  const c = COSMETIC_BY_ID.get(id);
  return c?.unlock.type === 'case' ? c : undefined;
}
