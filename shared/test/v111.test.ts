import { beforeAll, describe, expect, it } from 'vitest';
import {
  CASES,
  CASE_IDS,
  CASE_SPAWN_CHANCE,
  COSMETICS,
  GrantSchema,
  HopperMatch,
  ProfileSchema,
  RARITIES,
  SKELETON,
  applyHopperRun,
  applyRun,
  buyCaseKey,
  caseOdds,
  caseOfItem,
  caseSkins,
  caseStock,
  defaultProfile,
  dustBalance,
  initPhysics,
  mergeProfiles,
  openCase,
  parseS2C,
  pickCaseSkin,
  sanitizeLoadout,
  stageHole,
  type Profile,
} from '../src/index';

beforeAll(async () => {
  await initPhysics();
});

const withDust = (p: Profile, dust: number): Profile => ({ ...p, hopper: { ...p.hopper, dustEarned: dust } });

describe('v1.11 cases: catalog', () => {
  it('has a case per planet, each with 3 common, 2 rare, 1 epic, 1 legendary and 1 mythic skin of its own', () => {
    expect(CASE_IDS).toEqual(['meadow', 'candy', 'frozen', 'clockwork', 'space']);
    const ids = new Set<string>();
    for (const id of CASE_IDS) {
      const skins = caseSkins(id);
      const count = (r: string) => skins.filter((s) => s.rarity === r).length;
      expect([count('common'), count('rare'), count('epic'), count('legendary'), count('mythic')]).toEqual([
        3, 2, 1, 1, 1,
      ]);
      for (const s of skins) {
        expect(ids.has(s.id)).toBe(false);
        ids.add(s.id);
        expect(['ball', 'trail', 'putter']).toContain(s.slot);
      }
      // The mythic is a ball with the full mythic effect.
      const mythic = skins.find((s) => s.rarity === 'mythic')!;
      expect(mythic.slot).toBe('ball');
      expect(mythic.fx).toBe('mythic');
    }
    // Case skins are only in cases: no other unlock path and no rarity outside them.
    expect(COSMETICS.filter((c) => c.rarity).every((c) => c.unlock.type === 'case')).toBe(true);
    expect(new Set(COSMETICS.map((c) => c.id)).size).toBe(COSMETICS.length);
  });

  it('prices keys by case rarity: rarer cases cost more and pay out the best skins more often', () => {
    const prices = CASE_IDS.map((id) => CASES[id].keyPrice);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    expect(CASE_IDS.map((id) => CASES[id].rarity)).toEqual([...RARITIES]);
    for (const id of CASE_IDS) {
      const o = caseOdds(id);
      expect(Object.values(o).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      // Rarer skins are always less likely.
      for (let i = 1; i < RARITIES.length; i++) expect(o[RARITIES[i]]).toBeLessThan(o[RARITIES[i - 1]]);
    }
    expect(caseOdds('space').mythic).toBeGreaterThan(caseOdds('meadow').mythic);
    expect(caseOdds('meadow').mythic).toBeLessThan(0.006);
  });

  it('draws skins at the stated odds', () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const n = 200_000;
    const got: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const s = pickCaseSkin('frozen', rnd(), rnd());
      got[s.rarity!] = (got[s.rarity!] ?? 0) + 1;
      expect(s.unlock).toEqual({ type: 'case', case: 'frozen' });
    }
    const o = caseOdds('frozen');
    for (const r of RARITIES) expect((got[r] ?? 0) / n).toBeCloseTo(o[r], 2);
    // The extremes of the roll land on the extremes of the table.
    expect(pickCaseSkin('candy', 0, 0).rarity).toBe('common');
    expect(pickCaseSkin('candy', 0.999999, 0).rarity).toBe('mythic');
  });
});

describe('v1.11 cases: keys and opening', () => {
  it('buys keys with stardust, and refuses when short', () => {
    const p = withDust(defaultProfile('g_a', 'A'), 100);
    expect(buyCaseKey(p, 'space')).toBe('Not enough stardust');
    const q = buyCaseKey(p, 'meadow') as Profile;
    expect(dustBalance(q.hopper)).toBe(100 - CASES.meadow.keyPrice);
    expect(caseStock(q, 'meadow')).toEqual({ cases: 0, keys: 1 });
    expect(dustBalance(p.hopper)).toBe(100); // pure
  });

  it('opens a case only with a case and a key, uses both, and gives the skin', () => {
    let p = withDust(defaultProfile('g_a', 'A'), 500);
    expect(openCase(p, 'candy', 0, 0)).toBe('No Candy Case to open');
    p = { ...p, cases: { found: { candy: 2 }, opened: {}, keys: {} } };
    expect(openCase(p, 'candy', 0, 0)).toBe('You need a key first');
    p = buyCaseKey(p, 'candy') as Profile;
    const r = openCase(p, 'candy', 0.999999, 0);
    if (typeof r === 'string') throw new Error(r);
    expect(r.skin.rarity).toBe('mythic');
    expect(r.duplicate).toBe(false);
    expect(r.profile.owned).toContain(r.skin.id);
    expect(caseStock(r.profile, 'candy')).toEqual({ cases: 1, keys: 0 });
    // The new skin can be equipped.
    expect(sanitizeLoadout({ ball: r.skin.id }, new Set(r.profile.owned)).ball).toBe(r.skin.id);
    expect(sanitizeLoadout({ ball: r.skin.id }, new Set(p.owned)).ball).not.toBe(r.skin.id);
  });

  it('refunds stardust for a skin you already own, more for rarer ones', () => {
    let p = withDust(defaultProfile('g_a', 'A'), 1000);
    p = { ...p, cases: { found: { meadow: 3 }, opened: {}, keys: {} } };
    const common = pickCaseSkin('meadow', 0, 0);
    const mythic = pickCaseSkin('meadow', 0.999999, 0);
    p = { ...p, owned: [...p.owned, common.id, mythic.id] };
    p = buyCaseKey(buyCaseKey(p, 'meadow') as Profile, 'meadow') as Profile;
    const a = openCase(p, 'meadow', 0, 0);
    if (typeof a === 'string') throw new Error(a);
    expect(a.duplicate).toBe(true);
    expect(dustBalance(a.profile.hopper)).toBe(dustBalance(p.hopper) + a.refund);
    const b = openCase(a.profile, 'meadow', 0.999999, 0);
    if (typeof b === 'string') throw new Error(b);
    expect(b.duplicate).toBe(true);
    expect(b.refund).toBeGreaterThan(CASES.meadow.keyPrice);
    expect(b.refund).toBeGreaterThan(a.refund);
    expect(b.profile.owned.filter((id) => id === mythic.id)).toHaveLength(1);
  });

  it('merges two copies of a profile without losing cases, keys or openings', () => {
    const base = defaultProfile('g_a', 'A');
    const a: Profile = {
      ...base,
      cases: { found: { meadow: 3, space: 1 }, opened: { meadow: 1 }, keys: { meadow: 2 } },
    };
    const b: Profile = {
      ...base,
      cases: { found: { meadow: 2, candy: 1 }, opened: { meadow: 2 }, keys: {} },
    };
    const m = mergeProfiles(a, b);
    expect(m.cases).toEqual({
      found: { meadow: 3, space: 1, candy: 1 },
      opened: { meadow: 2 },
      keys: { meadow: 2 },
    });
    // A copy from an older host (no cases at all) parses and merges fine.
    const { cases: _drop, ...old } = base;
    const parsed = ProfileSchema.parse(old);
    expect(parsed.cases).toEqual({ found: {}, opened: {}, keys: {} });
    expect(mergeProfiles(a, parsed).cases.found.meadow).toBe(3);
  });
});

describe('v1.11 cases: Planet Hopper only', () => {
  it('hides a case on about 1 in 20 golf stages, never on rest stops, the same for everyone', () => {
    let golf = 0;
    let withCase = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const m = new HopperMatch({ seed, players: [{ id: 'p', name: 'P' }], upgrades: {}, keepsakes: [] });
      for (let i = 0; i < SKELETON.length; i++) {
        const spec = m.makeSpec(i, null, null, 0);
        const hole = stageHole(seed, i, spec);
        const cases = hole.collectibles.filter((c) => c.kind === 'case');
        if (spec.kind === 'rest') {
          expect(cases).toHaveLength(0);
          continue;
        }
        golf++;
        expect(cases.length).toBeLessThanOrEqual(1);
        if (!cases.length) continue;
        withCase++;
        // Regional: the case belongs to the stage's planet, and every machine places it identically.
        expect(caseOfItem(cases[0].id)).toBe(spec.world);
        expect(stageHole(seed, i, spec).collectibles.find((c) => c.kind === 'case')).toEqual(cases[0]);
      }
    }
    const rate = withCase / golf;
    expect(rate).toBeGreaterThan(CASE_SPAWN_CHANCE * 0.4);
    expect(rate).toBeLessThan(CASE_SPAWN_CHANCE * 1.8);
  });

  it('never puts a case on the regular courses', async () => {
    const { COURSES } = await import('../src/index');
    for (const c of COURSES)
      for (const h of c.holes) expect(h.collectibles.some((x) => x.kind === 'case')).toBe(false);
  });

  it('a case found by one player in a co-op run goes to everyone', () => {
    const m = new HopperMatch({
      seed: 7,
      players: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      upgrades: {},
      keepsakes: [],
    });
    const item = 'hop-7-3:case:frozen@4.0,1.5';
    m.collected.push({ item, kind: 'case', hole: 0, by: 'a' });
    for (const id of ['a', 'b']) {
      const { profile, grant } = applyHopperRun(defaultProfile(id, id.toUpperCase()), m, id, 60);
      expect(profile.cases.found.frozen).toBe(1);
      expect(grant.cases).toEqual(['frozen']);
      // The rewards message carries it to clients (and old clients just ignore the field).
      expect(GrantSchema.parse(grant).cases).toEqual(['frozen']);
      expect(parseS2C({ t: 'rewards', profile, grant })).not.toBeNull();
    }
  });

  it('counts a case in the run summary like any shared pickup', () => {
    const p = defaultProfile('g_a', 'A');
    const { profile } = applyRun(
      p,
      {
        courseId: 'hopper',
        mode: 'parallel',
        holes: [],
        collected: [
          { item: 'x:case:space@1.0,1.0', kind: 'case' },
          { item: 'y:case:space@2.0,1.0', kind: 'case' },
          { item: 'z:case:nonsense@2.0,1.0', kind: 'case' },
        ],
        completed: false,
        shots: 0,
        playtimeSec: 1,
        playerCount: 2,
        individualStrokes: 0,
        individualPar: 0,
        teamStrokes: 0,
        teamPar: 0,
      } as unknown as Parameters<typeof applyRun>[1],
      null,
    );
    expect(profile.cases.found).toEqual({ space: 2 });
  });
});
