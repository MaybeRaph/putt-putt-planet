import { beforeAll, describe, expect, it } from 'vitest';
import { holeArchetype, lastHoleSpecials } from '../src/hopper/generate';
import { TRINKET_IDS } from '../src/hopper/defs';
import {
  HopperMatch,
  SKELETON,
  applyHopperRun,
  buyUpgrade,
  defaultProfile,
  initPhysics,
  mergeProfiles,
  solveHole,
  parseS2C,
  picnicHeal,
  stageHole,
  type HopperMatch as HM,
} from '../src/index';

beforeAll(async () => {
  await initPhysics();
});

const players = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
];

/** Finish the current hole for every entrant with `strokes` (teleport + tiny putt). */
function finishHole(m: HM, strokes: (e: string) => number): void {
  for (const e of m.entrants) {
    const n = strokes(e);
    for (let k = 0; k < n - 1; k++) {
      (m as unknown as { strokes: Record<string, number> }).strokes[e]++;
    }
    const c = m.hole.cup;
    m.sim.placeBall(e, [c[0] - 0.5, c[1] + 0.2, c[2]]);
    m.shoot(e, 1, 0, 0.1);
  }
  for (let t = 0; t < 600 && m.phase === 'playing'; t++) m.step();
}

describe('Planet Hopper', () => {
  it('levels trinkets up during a run (picking one you own again)', () => {
    const m = new HopperMatch({ seed: 5, players: [players[0]], upgrades: {}, keepsakes: ['overtime'] });
    type Priv = { addTrinket(t: string): void; trinketOptions(): { trinket?: string; level?: number }[] };
    const p = m as unknown as Priv;
    m.startHole(0);
    expect(m.strokeLimit()).toBe(m.hole.par + 4 + 3);
    p.addTrinket('overtime');
    expect(m.lv('overtime')).toBe(2);
    expect(m.strokeLimit()).toBe(m.hole.par + 4 + 5);
    p.addTrinket('overtime');
    p.addTrinket('overtime'); // capped at Lv3
    expect(m.lv('overtime')).toBe(3);
    expect(m.strokeLimit()).toBe(m.hole.par + 4 + 7);
    // Drafts offer level-ups of owned trinkets, never past Lv3.
    for (const t of [
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
      'compass',
    ])
      p.addTrinket(t);
    const opts = p.trinketOptions();
    expect(opts.length).toBe(3);
    for (const o of opts) {
      expect(o.trinket).not.toBe('overtime');
      expect(o.level).toBe(2);
    }
    for (const t of m.hs.trinkets) {
      p.addTrinket(t);
      p.addTrinket(t);
    }
    expect(p.trinketOptions()).toEqual([]);
    // Shaping trinkets reach the generated hole at their level.
    const spec = m.makeSpec(1, null, null, 0);
    expect(spec.shaping.filter((t) => t === 'magnet').length).toBe(3);
    expect(stageHole(5, 1, spec).cupScale).toBeCloseTo(1.65);
  });

  it('offers each trinket level more rarely than the last', () => {
    const m = new HopperMatch({ seed: 9, players: [players[0]], upgrades: {}, keepsakes: [] });
    type Priv = {
      addTrinket(t: string): void;
      trinketOptions(): { trinket?: string; level?: number }[];
      rerollsUsed: number;
    };
    const p = m as unknown as Priv;
    p.addTrinket('magnet'); // Lv1: offered as a Lv2 level-up
    p.addTrinket('glove');
    p.addTrinket('glove'); // Lv2: offered as a Lv3 level-up
    let lv2 = 0,
      lv3 = 0,
      fresh = 0;
    for (let k = 0; k < 600; k++) {
      p.rerollsUsed = k;
      for (const o of p.trinketOptions()) {
        if (o.trinket === 'magnet') lv2++;
        else if (o.trinket === 'glove') lv3++;
        else fresh++;
      }
    }
    const perFresh = fresh / (TRINKET_IDS.length - 2);
    expect(lv2).toBeLessThan(perFresh * 0.7);
    expect(lv3).toBeLessThan(lv2 * 0.6);
    expect(lv3).toBeGreaterThan(0);
  });

  it('builds varied holes: archetypes, forks round a lagoon, brooks and ponds', () => {
    const arch = new Set<string>();
    let fork: ReturnType<typeof stageHole> | null = null;
    let brook = 0,
      pond = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const m = new HopperMatch({ seed: seed * 31, players: [players[0]], upgrades: {}, keepsakes: [] });
      for (let i = 0; i < SKELETON.length; i++) {
        const spec = m.makeSpec(i, null, null, seed % 3);
        if (spec.kind === 'rest') continue;
        const h = stageHole(m.seed, i, spec);
        arch.add(holeArchetype(m.seed, i, spec));
        if (h.tip?.includes('forks round') && spec.kind === 'hole') fork ??= h;
        if (h.tip?.includes('brook')) brook++;
        if (h.tip?.includes('pond')) pond++;
      }
    }
    expect(arch.size).toBeGreaterThanOrEqual(7);
    expect(brook).toBeGreaterThan(0);
    expect(pond).toBeGreaterThan(0);
    expect(fork).not.toBeNull();
    // The two lanes of a fork are far apart: a lagoon (water) of at least 4 m sits between them.
    const lagoon = fork!.zones.filter((z) => z.kind === 'water').map((z) => Math.min(z.size[0], z.size[2]));
    expect(Math.max(...lagoon)).toBeGreaterThan(4);
    expect(solveHole(fork!, { maxStrokes: fork!.par + 5, angles: 36 }).holed).toBe(true);
  }, 120_000);

  it('builds flowing set pieces: corkscrews, slides, loops, drops, leaps and tunnels', () => {
    const seen = new Set<string>();
    let spiral: ReturnType<typeof stageHole> | null = null;
    let loop: ReturnType<typeof stageHole> | null = null;
    for (let seed = 1; seed <= 30 && !(spiral && loop && seen.size >= 6); seed++) {
      const m = new HopperMatch({ seed, players: [players[0]], upgrades: {}, keepsakes: [] });
      for (let i = 0; i < SKELETON.length; i++) {
        const spec = m.makeSpec(i, null, null, seed % 3);
        if (spec.kind !== 'hole') continue;
        const h = stageHole(seed, i, spec);
        for (const x of lastHoleSpecials) seen.add(x);
        if (lastHoleSpecials.includes('spiral') && !lastHoleSpecials.includes('fork')) spiral ??= h;
        if (lastHoleSpecials.includes('loop') && spec.depth < 8) loop ??= h;
      }
    }
    for (const k of ['spiral', 'slide', 'loop', 'drop', 'leap', 'tunnel']) expect(seen).toContain(k);
    // A corkscrew is one smooth floor (no seams to kick the ball) wound round a tower.
    expect(spiral!.solids.some((s) => s.shape === 'ribbon' && s.skirt === false)).toBe(true);
    expect(spiral!.solids.some((s) => s.shape === 'cylinder' && s.size[1] > 3)).toBe(true);
    for (const h of [spiral!, loop!]) expect(solveHole(h, { maxStrokes: h.par + 5, angles: 36 }).holed).toBe(true);
  }, 180_000);

  it('keeps clear space round spinners and windmills, and bumpers sparse', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const m = new HopperMatch({ seed, players: [players[0]], upgrades: {}, keepsakes: [] });
      for (let i = 0; i < SKELETON.length; i++) {
        const spec = m.makeSpec(i, null, null, seed % 3);
        if (spec.kind === 'rest') continue;
        const h = stageHole(seed, i, spec);
        expect(h.obstacles.filter((o) => o.type === 'bumper').length).toBeLessThanOrEqual(4);
        const things = h.obstacles.flatMap((o) =>
          o.type === 'spinner'
            ? [{ sweep: true, p: o.pos, r: o.length / 2 }]
            : o.type === 'windmill'
              ? [{ sweep: true, p: o.pos, r: 1 }]
              : o.type === 'bumper'
                ? [{ sweep: false, p: o.pos, r: o.radius }]
                : [],
        );
        for (const a of things)
          for (const b of things)
            if (a !== b && a.sweep)
              expect(Math.hypot(a.p[0] - b.p[0], a.p[2] - b.p[2]) - a.r - b.r).toBeGreaterThan(0.6);
      }
    }
  });

  it('generates the same hole for the same seed and spec', () => {
    const m = new HopperMatch({ seed: 42, players, upgrades: {}, keepsakes: [] });
    for (const i of [0, 3, 4, 10, SKELETON.length - 1]) {
      const spec = m.makeSpec(i, i === 10 ? 'gale' : null, null, 1);
      expect(JSON.stringify(stageHole(42, i, spec))).toBe(JSON.stringify(stageHole(42, i, spec)));
    }
    const gale = stageHole(42, 10, m.makeSpec(10, 'gale', null, 1));
    expect(Math.hypot(...gale.wind)).toBeGreaterThan(0.1);
    expect(stageHole(42, 4, m.makeSpec(4, null, null, 0)).name).toBe('Wishing Green');
  });

  it('shares hearts, opens a fork vote, and moves on when everyone voted', () => {
    const m = new HopperMatch({
      seed: 7,
      players,
      upgrades: { vigor: 1 },
      keepsakes: ['magnet', 'magnet', 'nope'],
    });
    expect(m.hs.maxHearts).toBe(6 + 1);
    // Two players with the same keepsake: it stacks into a level 2 trinket.
    expect(m.hs.trinkets).toEqual(['magnet']);
    expect(m.hs.levels.magnet).toBe(2);
    m.startHole(0);
    expect(m.hole.cupScale).toBeCloseTo(1.5);
    const par = m.hole.par;
    // A aces (+2), B double-bogeys (-2): teammates cover each other.
    finishHole(m, (e) => (e === 'a' ? 1 : par + 2));
    expect(m.phase).toBe('holeEnd');
    expect(m.hs.lastDelta).toEqual({ by: { a: 2, b: -2 }, net: 0 });
    expect(m.hs.hearts).toBe(7);
    m.advance();
    const c = m.hs.choice!;
    expect(c.kind).toBe('route');
    expect(c.options.length).toBe(2);
    expect(m.vote('a', 1)).toBe(true);
    expect(m.hs.stage).toBe(0); // still waiting for B
    m.vote('b', 1);
    expect(m.hs.choice).toBeNull();
    expect(m.hs.stage).toBe(1);
    expect(m.hs.stages[1].variant).toBe(1);
    // The parsed score (as sent to clients) carries the run state.
    const msg = parseS2C(JSON.parse(JSON.stringify({ t: 'score', score: m.score() })));
    expect(msg && msg.t === 'score' && msg.score.hopper?.stage).toBe(1);
    m.dispose();
  });

  it('ends the run at zero hearts unless Second Wind is owned', () => {
    const run = (upgrades: Record<string, number>) => {
      const m = new HopperMatch({ seed: 3, players: [players[0]], upgrades, keepsakes: [] });
      m.startHole(0);
      m.hs.hearts = 2;
      finishHole(m, () => m.hole.par + 3);
      m.advance();
      return m;
    };
    const dead = run({});
    expect(dead.phase).toBe('courseEnd');
    expect(dead.hs.result).toBe('lost');
    const saved = run({ secondwind: 1 });
    expect(saved.hs.result).toBe('running');
    expect(saved.hs.hearts).toBe(2);
    expect(saved.hs.secondWind).toBe(false);
  });

  it('scales the heart pool and picnics with team size (three players is the reference)', () => {
    const team = (n: number) =>
      new HopperMatch({
        seed: 5,
        players: Array.from({ length: n }, (_, k) => ({ id: `p${k}`, name: `P${k}` })),
        upgrades: {},
        keepsakes: [],
      });
    expect([1, 2, 3, 4].map((n) => team(n).hs.maxHearts)).toEqual([3, 6, 12, 16]);
    expect([1, 2, 3, 4].map((n) => picnicHeal(n))).toEqual([1, 2, 2, 3]);
  });

  it('banks stardust into the profile, and upgrades cost it', () => {
    const m = new HopperMatch({ seed: 11, players: [players[0]], upgrades: {}, keepsakes: [] });
    m.startHole(0);
    finishHole(m, () => m.hole.par);
    m.hs.dust = 40;
    m.hs.trinkets.push('feeder');
    const { profile, grant } = applyHopperRun(defaultProfile('a', 'A'), m, 'a', 60);
    expect(grant.dust).toBe(40);
    expect(profile.hopper.dustEarned).toBe(40);
    expect(profile.hopper.discovered).toContain('feeder');
    const bought = buyUpgrade(profile, 'vigor');
    expect(typeof bought).not.toBe('string');
    if (typeof bought === 'string') return;
    expect(bought.hopper.upgrades.vigor).toBe(1);
    expect(bought.hopper.dustSpent).toBe(20);
    expect(buyUpgrade(bought, 'secondwind')).toBe('Not enough stardust');
    // Merging keeps the ledger monotonic.
    const merged = mergeProfiles(profile, bought);
    expect(merged.hopper.dustEarned - merged.hopper.dustSpent).toBe(20);
  });
});
