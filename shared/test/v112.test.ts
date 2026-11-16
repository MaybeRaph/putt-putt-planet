import { beforeAll, describe, expect, it } from 'vitest';
import {
  CASE_SPAWN_CHANCE,
  COMBOS,
  COURSES,
  COSMETICS,
  CASE_IDS,
  DEFAULT_LOADOUT,
  HopperMatch,
  JITTER_DEGREES,
  MAX_DEPTH,
  Match,
  POWERUPS,
  PRESTIGE,
  SKELETON,
  Simulation,
  TRINKETS,
  TRINKET_IDS,
  activeCombos,
  applyHopperRun,
  caseSkins,
  defaultProfile,
  initPhysics,
  isCurse,
  loopOf,
  parseS2C,
  runLaps,
  sanitizeLoadout,
  sellPrice,
  skeletonAt,
  stageCaseChance,
  stageHole,
  type HopperMatch as HM,
  type TrinketId,
} from '../src/index';

beforeAll(async () => {
  await initPhysics();
});

const solo = [{ id: 'a', name: 'A' }];
const duo = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
];

type Priv = {
  addTrinket(t: string, announce?: boolean): void;
  onCollected(item: string, kind: string): void;
  aimShot(p: string, e: string, x: number, z: number): [number, number];
  strokes: Record<string, number>;
  shotsThisHole: Record<string, number>;
  bankContacts: Record<string, number>;
};
const priv = (m: unknown) => m as Priv;

/** Finish the current hole for everyone with `strokes` (teleport next to the cup + tiny putt). */
function finishHole(m: Match, strokes: (e: string) => number): void {
  for (const e of m.entrants) {
    const n = strokes(e);
    for (let k = 0; k < n - 1; k++) priv(m).strokes[e]++;
    const c = m.hole.cup;
    m.sim.placeBall(e, [c[0] - 0.5, c[1] + 0.2, c[2]]);
    m.shoot(e, 1, 0, 0.1);
  }
  for (let t = 0; t < 900 && m.phase === 'playing'; t++) m.step();
}

/** Par every stage until the run reaches `stage` (choices: always option `pick`). */
function playTo(m: HM, stage: number, pick = 0): void {
  if (m.holeIndex < 0) m.startHole(0);
  for (let guard = 0; guard < 80 && m.hs.stage < stage && m.phase !== 'courseEnd'; guard++) {
    finishHole(m, () => m.hole.par);
    expect(m.phase).toBe('holeEnd');
    m.advance();
    for (let k = 0; k < 6 && m.hs.choice; k++) {
      if (m.hs.choice.kind === 'prestige') return;
      for (const p of m.players) m.vote(p.id, pick);
    }
  }
}

describe('v1.12 Planet Hopper: host keepsake, new trinkets, curses, combos', () => {
  it('only the host keepsake joins a co-op run', () => {
    const m = new HopperMatch({ seed: 3, players: duo, upgrades: {}, keepsakes: ['glove', 'magnet'] });
    expect(m.hs.trinkets).toEqual(['glove']);
    // A cursed keepsake is never brought along.
    const c = new HopperMatch({ seed: 3, players: solo, upgrades: {}, keepsakes: ['glass'] });
    expect(c.hs.trinkets).toEqual([]);
  });

  it('defines 6 new trinkets and 4 single-level curses', () => {
    for (const t of ['piggy', 'crown', 'streak', 'hourglass', 'laser', 'lucky'] as TrinketId[]) {
      expect(TRINKET_IDS).toContain(t);
      expect(TRINKETS[t].levels).toHaveLength(3);
      expect(isCurse(t)).toBe(false);
    }
    const curses = TRINKET_IDS.filter(isCurse);
    expect(curses).toEqual(['jitter', 'glass', 'greed', 'lantern']);
    const m = new HopperMatch({ seed: 4, players: solo, upgrades: {}, keepsakes: [] });
    priv(m).addTrinket('greed');
    priv(m).addTrinket('greed');
    expect(m.lv('greed')).toBe(1);
  });

  it('Glass Cannon: −2 max hearts, double stardust; selling it gives them back', () => {
    const m = new HopperMatch({ seed: 4, players: duo, upgrades: {}, keepsakes: [] });
    const max = m.hs.maxHearts;
    priv(m).addTrinket('glass');
    expect(m.hs.maxHearts).toBe(max - 2);
    priv(m).onCollected('x', 'gem');
    expect(m.hs.dust).toBe(10);
    // Sell it at a rest stop.
    playTo(m, 4);
    expect(m.spec.kind).toBe('rest');
    const [maxNow, coins] = [m.hs.maxHearts, m.hs.coins];
    expect(m.shop('a', 'sell', 'glass')).toBeNull();
    expect(m.hs.maxHearts).toBe(maxNow + 2);
    expect(m.hs.coins).toBe(coins + sellPrice('glass', 1));
  });

  it('Jittery Glove wobbles each putt by up to 4°, the same on every machine; Steady Hands holds it still', () => {
    const m = new HopperMatch({ seed: 6, players: solo, upgrades: {}, keepsakes: [] });
    m.startHole(0);
    expect(priv(m).aimShot('a', 'a', 1, 0)).toEqual([1, 0]);
    priv(m).addTrinket('jitter');
    const angles = [0, 1, 2, 3, 4, 5].map((k) => {
      priv(m).shotsThisHole.a = k;
      const [x, z] = priv(m).aimShot('a', 'a', 1, 0);
      expect(Math.hypot(x, z)).toBeCloseTo(1);
      return (Math.atan2(z, x) * 180) / Math.PI;
    });
    for (const a of angles) expect(Math.abs(a)).toBeLessThanOrEqual(JITTER_DEGREES + 1e-9);
    expect(new Set(angles.map((a) => a.toFixed(4))).size).toBeGreaterThan(3);
    priv(m).shotsThisHole.a = 2;
    expect(priv(m).aimShot('a', 'a', 1, 0)).toEqual(priv(m).aimShot('a', 'a', 1, 0));
    // +30% power is part of the hole.
    const spec = m.makeSpec(1, null, null, 0);
    expect(spec.shaping).toContain('jitter');
    expect(stageHole(m.seed, 1, spec).powerScale).toBeCloseTo(1.3);
    priv(m).addTrinket('glove');
    priv(m).addTrinket('laser');
    expect(priv(m).aimShot('a', 'a', 1, 0)).toEqual([1, 0]);
  });

  it('Haunted Lantern: a wider cup, but fog on every hole', () => {
    const m = new HopperMatch({ seed: 8, players: solo, upgrades: {}, keepsakes: [] });
    const plain = stageHole(m.seed, 1, m.makeSpec(1, null, null, 0));
    priv(m).addTrinket('lantern');
    const cursed = stageHole(m.seed, 1, m.makeSpec(1, null, null, 0));
    expect(cursed.cupScale / plain.cupScale).toBeCloseTo(1.4);
    expect(cursed.theme!.fogFar).toBeLessThanOrEqual(17);
    expect(plain.theme!.fogFar).toBeGreaterThan(17);
  });

  it('combos switch on with both trinkets: Fortress adds hearts, Homing bends putts towards the cup', () => {
    expect(activeCombos(['magnet', 'glove'])).toEqual([]);
    expect(activeCombos(['magnet', 'compass'])).toEqual(['homing']);
    for (const c of Object.values(COMBOS)) for (const t of c.needs) expect(TRINKET_IDS).toContain(t);
    const m = new HopperMatch({ seed: 9, players: solo, upgrades: {}, keepsakes: [] });
    priv(m).addTrinket('shield');
    const max = m.hs.maxHearts;
    priv(m).addTrinket('ironheart');
    expect(m.hs.maxHearts).toBe(max + 2 + 2);
    expect(m.combo('fortress')).toBe(true);
    priv(m).addTrinket('magnet');
    priv(m).addTrinket('compass');
    const hole = stageHole(m.seed, 1, m.makeSpec(1, null, null, 0));
    expect(hole.homing).toBeGreaterThan(0);
  });

  it('a homing hole curves a slightly mis-aimed putt closer to the cup (same speed)', () => {
    const base = COURSES[0].holes[0]; // First Putt: straight, tee to cup along +X
    const run = (homing: number) => {
      const sim = new Simulation({ ...base, homing }, { ballsCollide: false, activeCollectibles: [] });
      sim.addBall('x');
      const c = base.cup;
      sim.placeBall('x', [c[0] - 3.5, c[1] + 0.2, c[2]]);
      const a = (13 * Math.PI) / 180;
      sim.shoot('x', Math.cos(a), Math.sin(a), 0.32);
      let best = Infinity;
      for (let t = 0; t < 900; t++) {
        sim.step();
        const b = sim.getBall('x')!;
        if (b.phase === 'holed' || b.phase === 'sinking') return 0;
        best = Math.min(best, Math.hypot(b.pos[0] - c[0], b.pos[2] - c[2]));
        if (b.phase === 'rest') break;
      }
      sim.dispose();
      return best;
    };
    const plain = run(0);
    const homing = run(1.1);
    expect(homing).toBeLessThan(plain);
  });
});

describe('v1.12 rest-stop shop and shop coins', () => {
  it('coins earn shop coins (Piggy Bank, Greedy Gremlin, prestige add more)', () => {
    const m = new HopperMatch({ seed: 11, players: solo, upgrades: {}, keepsakes: [] });
    priv(m).onCollected('c1', 'coin');
    expect(m.hs.coins).toBe(1);
    priv(m).addTrinket('piggy');
    priv(m).onCollected('c2', 'coin');
    expect(m.hs.coins).toBe(3);
    priv(m).addTrinket('greed');
    priv(m).onCollected('c3', 'coin');
    expect(m.hs.coins).toBe(3 + 4);
    expect(m.hs.coinsEarned).toBe(7);
  });

  it('only opens at rest stops; powerups ride on the next golf hole', () => {
    const m = new HopperMatch({ seed: 12, players: solo, upgrades: {}, keepsakes: [] });
    m.startHole(0);
    expect(m.shop('a', 'buy', 'snack')).toMatch(/rest stops/);
    playTo(m, 4);
    expect(skeletonAt(4).kind).toBe('rest');
    expect(m.spec.kind).toBe('rest');
    m.hs.coins = 55;
    for (const id of ['bigcup', 'fairweather', 'strokes', 'bubble', 'dice'] as const)
      expect(m.shop('a', 'buy', id)).toBeNull();
    expect(m.shop('a', 'buy', 'bigcup')).toBe('Already bought');
    const spent =
      POWERUPS.bigcup.price +
      POWERUPS.fairweather.price +
      POWERUPS.strokes.price +
      POWERUPS.bubble.price +
      POWERUPS.dice.price;
    expect(m.hs.coins).toBe(55 - spent);
    expect(m.hs.coinsSpent).toBe(spent);
    expect(m.shop('a', 'buy', 'snack')).toBe('Not enough coins');
    expect(m.hs.shopLog.map((x) => x.item)).toEqual(['bigcup', 'fairweather', 'strokes', 'bubble', 'dice']);
    // Leave the rest stop and take the first route.
    finishHole(m, () => m.hole.par);
    m.advance();
    m.vote('a', 0);
    expect(m.hs.stage).toBe(5);
    expect(m.spec.boosts).toEqual(['bigcup', 'fairweather', 'strokes', 'bubble']);
    expect(m.spec.omen).toBeNull();
    expect(m.hs.boosts).toEqual([]);
    const plain = stageHole(m.seed, 5, { ...m.spec, boosts: [] });
    expect(m.hole.cupScale).toBeCloseTo(Math.min(2, plain.cupScale * 1.5));
    expect(m.strokeLimit()).toBe(m.hole.par + 4 + 3);
    // Bubble: a bad hole costs nothing.
    const hearts = m.hs.hearts;
    finishHole(m, () => m.hole.par + 3);
    expect(m.hs.hearts).toBe(hearts);
  });

  it('sells trinkets for coins (Iron Heart takes its hearts with it)', () => {
    const m = new HopperMatch({ seed: 13, players: solo, upgrades: {}, keepsakes: [] });
    playTo(m, 4);
    const max = m.hs.maxHearts;
    priv(m).addTrinket('ironheart');
    priv(m).addTrinket('ironheart');
    expect(m.hs.maxHearts).toBe(max + 4);
    const before = m.hs.coins;
    expect(m.shop('a', 'sell', 'ironheart')).toBeNull();
    expect(m.hs.coins).toBe(before + sellPrice('ironheart', 2));
    expect(m.hs.maxHearts).toBe(max);
    expect(m.hs.trinkets).not.toContain('ironheart');
    expect(m.shop('a', 'sell', 'ironheart')).toMatch(/don’t have/);
  });
});

describe('v1.12 prestige', () => {
  it('offers to go round again after the last boss; prestige loops are harder and richer', () => {
    const m = new HopperMatch({ seed: 21, players: solo, upgrades: { vigor: 3 }, keepsakes: [] });
    playTo(m, SKELETON.length);
    expect(m.hs.stage).toBe(SKELETON.length - 1);
    expect(m.hs.choice?.kind).toBe('prestige');
    expect(m.hs.choice?.options.map((o) => o.action)).toEqual(['prestige', 'cashout']);
    m.vote('a', 0);
    expect(m.hs.prestige).toBe(1);
    expect(m.hs.result).toBe('running');
    // The next fork leads into loop 1.
    expect(m.hs.choice?.kind).toBe('route');
    m.vote('a', 0);
    expect(m.hs.stage).toBe(SKELETON.length);
    expect(loopOf(m.hs.stage)).toBe(1);
    expect(m.spec.loop).toBe(1);
    expect(m.spec.depth).toBe(Math.min(MAX_DEPTH, PRESTIGE.depthPerLoop));
    expect(m.spec.world).toBe('meadow');
    expect(stageCaseChance(m.spec)).toBeCloseTo(CASE_SPAWN_CHANCE * (1 + PRESTIGE.casePerLoop));
    expect(m.hole.cupScale).toBeCloseTo(1 - PRESTIGE.cupPerLoop);
    // Rest stops come round again too.
    expect(skeletonAt(SKELETON.length + 4).kind).toBe('rest');
    // Cash out later: the run counts both laps as wins.
    const p = applyHopperRun(defaultProfile('a', 'A'), m, 'a', 60).profile;
    expect(runLaps(m)).toBe(1);
    expect(p.hopper.wins).toBe(1);
    expect(parseS2C(structuredClone({ t: 'score', score: m.score() }))).not.toBeNull();
  });

  it('cashing out ends the run as a win', () => {
    const m = new HopperMatch({ seed: 22, players: solo, upgrades: { vigor: 3 }, keepsakes: [] });
    playTo(m, SKELETON.length);
    m.vote('a', 1);
    m.advance();
    expect(m.hs.result).toBe('won');
    expect(m.phase).toBe('courseEnd');
    expect(runLaps(m)).toBe(1);
  });
});

describe('v1.12 cases and stickers', () => {
  it('a case turns up on 1 in 13 golf stages (more with the Lucky Charm and on prestige loops)', () => {
    expect(CASE_SPAWN_CHANCE).toBeCloseTo(1 / 13);
    const spec = {
      kind: 'hole' as const,
      sector: 0,
      world: 'meadow',
      depth: 0,
      variant: 0,
      omen: null,
      reward: null,
      shaping: [],
    };
    expect(stageCaseChance(spec)).toBeCloseTo(1 / 13);
    expect(stageCaseChance({ ...spec, shaping: ['lucky'] })).toBeCloseTo(1.5 / 13);
    expect(stageCaseChance({ ...spec, loop: 2 })).toBeCloseTo(2 / 13);
    expect(stageCaseChance({ ...spec, loop: 50, shaping: ['lucky', 'lucky', 'lucky'] })).toBe(
      PRESTIGE.maxCaseChance,
    );
  });

  it('every case holds a paper, a holo and a gold sticker, and you can wear one', () => {
    const stickers = COSMETICS.filter((c) => c.slot === 'sticker' && c.id !== 'sticker.none');
    expect(stickers).toHaveLength(15);
    for (const id of CASE_IDS) {
      const s = caseSkins(id).filter((c) => c.slot === 'sticker');
      expect(s.map((x) => x.finish)).toEqual(['paper', 'holo', 'gold']);
      for (const x of s) expect(x.glyph).toBeTruthy();
    }
    expect(DEFAULT_LOADOUT.sticker).toBe('sticker.none');
    expect(sanitizeLoadout({ sticker: 'sticker.frog' }, new Set(['sticker.frog'])).sticker).toBe(
      'sticker.frog',
    );
    expect(sanitizeLoadout({ sticker: 'sticker.frog' }, new Set()).sticker).toBe('sticker.none');
  });
});

describe('v1.12 match stats and real aces', () => {
  it('counts stats for the awards, and only a one-putt ace is a hole-in-one', () => {
    const course = COURSES[0];
    const m = new Match({ mode: 'solo', holes: course.holes.slice(0, 2), players: solo, holeEndDelay: 0 });
    m.startHole(0);
    finishHole(m, () => 1);
    expect(m.results.a[0].holeInOne).toBe(true);
    expect(m.stats.a.aces).toBe(1);
    expect(m.stats.a.shots).toBe(1);
    expect(m.stats.a.birdies).toBe(1);
    const done = m.events.find((e) => e.type === 'entrantDone');
    expect(done && 'shots' in done ? done.shots : -1).toBe(1);
    expect(m.score().stats?.a.aces).toBe(1);
  });

  it('a bank-shot refund down to 1 stroke is not an ace (two putts were struck)', () => {
    const m = new HopperMatch({ seed: 30, players: solo, upgrades: {}, keepsakes: [] });
    priv(m).addTrinket('bank');
    m.startHole(0);
    const c = m.hole.cup;
    priv(m).strokes.a = 1;
    m.sim.placeBall('a', [c[0] - 0.5, c[1] + 0.2, c[2]]);
    m.shoot('a', 1, 0, 0.1);
    priv(m).shotsThisHole.a = 2;
    priv(m).bankContacts.a = 1;
    for (let t = 0; t < 900 && m.phase === 'playing'; t++) m.step();
    expect(m.results.a[0].strokes).toBe(1);
    expect(m.results.a[0].holeInOne).toBe(false);
    expect(m.stats.a.aces).toBe(0);
  });
});
