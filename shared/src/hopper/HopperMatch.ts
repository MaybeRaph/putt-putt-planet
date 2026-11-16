import { DT } from '../config';
import { Match, type ScoreState } from '../match/Match';
import type { CollectibleKind } from '../schema';
import { hashString, rng } from '../rng';
import {
  JITTER_DEGREES,
  MAX_DEPTH,
  NEXT_HOLE_POWERUPS,
  OMEN_IDS,
  POWERUPS,
  PRESTIGE,
  SKELETON,
  TRINKETS,
  TRINKET_IDS,
  UPGRADES,
  UPGRADE_IDS,
  COMBOS,
  activeCombos,
  isCurse,
  isTrinket,
  loopOf,
  maxLevelOf,
  sellPrice,
  skeletonAt,
  type ChoiceOption,
  type ComboId,
  type PowerupId,
  type HopperState,
  type OmenId,
  type RewardId,
  type StageSpec,
  type TrinketId,
  type UpgradeId,
} from './defs';
import { stageHole } from './generate';
import { CASES, caseOfItem } from '../cases';

export interface HopperSetup {
  seed: number;
  players: { id: string; name: string }[];
  /** Clubhouse upgrades of the player who started the run. */
  upgrades: Record<string, number>;
  /**
   * Keepsakes: v1.12 only the host's (the first entry) is used. Every player bringing one made
   * big co-op teams start with a pile of trinkets, which was far too easy.
   */
  keepsakes: (string | null | undefined)[];
  /** Chaos mode: balls collide with each other. */
  chaos?: boolean;
}

/** Trinkets that change the hole itself (baked into the generated geometry/physics). */
const SHAPING: TrinketId[] = ['magnet', 'glove', 'socks', 'compass', 'laser', 'lucky', 'jitter', 'lantern'];
const VOTE_SECONDS = 25;
/**
 * Co-op votes with more than two connected players: once a strict majority of them is on one
 * option, the countdown drops to this (it is never raised or restarted by it). The rules:
 * - Only connected players count, both for the majority and for the final tally.
 * - The shortened deadline sticks: if a vote then changes and the majority breaks up, the clock
 *   keeps running from where it was and the choice is decided by the votes at that moment (ties go
 *   to the option that was voted for first, as always). Votes can still change until then.
 * - A disconnect re-checks: the remaining players may now all have voted (decided at once) or
 *   form a majority (countdown drops). Fewer than three connected players never shortens it,
 *   but an already shortened deadline stays.
 * - A reroll deals fresh options: votes, majority and countdown start over (VOTE_SECONDS).
 */
export const MAJORITY_SECONDS = 5;
/** Gimme Clover reach by level (metres from the cup a resting ball drops in for free). */
export const GIMME_RANGE = [0, 0.9, 1.3, 1.7];
/**
 * Draft weight by current level: new trinket, level-up to Lv2, level-up to Lv3. v1.9: level-ups
 * were 0.4 / 0.12 and turned up too often (in most drafts once a few trinkets are owned); a draft
 * now also offers at most one level-up while new trinkets are left.
 */
const LEVEL_UP_WEIGHT = [1, 0.08, 0.03, 0];
/** Draft weight of a rare trinket relative to a common one. */
const RARE_WEIGHT = 0.25;
/** Draft weight of a cursed trinket (at most one per draft). */
const CURSE_WEIGHT = 0.35;
const REST_REWARDS: RewardId[] = ['heal', 'dust', 'trinket', 'vitality', 'gamble'];
/**
 * Small teams (1–2 players) play by harder heart rules (v1.9; a fully upgraded solo player won
 * 9 runs out of 9): under par heals at most 1 heart (a hole-in-one still 2), from the second
 * planet on a hole over par costs one more heart (still at most 3), and a boss heals nothing.
 */
export const SMALL_TEAM = 2;
/** Boss holes give up to par + this many strokes (normal holes: par + 4) before a pick-up. */
export const BOSS_STROKE_ALLOWANCE = 3;
/**
 * Share of all Clubhouse upgrade ranks from which a small team's boss holes count one stroke
 * harder (a par on a boss costs a heart).
 */
export const STRONG_CLUBHOUSE = 0.5;

/** World order for a run: meadow first, space last, two of the others in between. */
export function runWorlds(seed: number): string[] {
  const mid = ['candy', 'frozen', 'clockwork'];
  const r = rng(hashString(`worlds:${seed}`));
  mid.splice(Math.floor(r() * 3), 1);
  if (r() < 0.5) mid.reverse();
  return ['meadow', ...mid, 'space'];
}

/** Depth (difficulty step) of a stage: golf stages before it. */
export function stageDepth(index: number): number {
  const pos = index % SKELETON.length;
  return SKELETON.slice(0, pos).filter((s) => s.kind !== 'rest').length;
}

/**
 * Team-size balance. Hearts are shared, but each player's result moves them, so a bigger team
 * swings the pool harder. The pools are tuned (with a model of whole runs at the v1.6 pars) so
 * an average team of any size finishes roughly a third of its runs.
 */
const TEAM_HEARTS = [3, 6, 12, 16, 22, 27];
const PICNIC_HEAL = [1, 2, 2, 3, 3, 4];
const SECOND_WIND = [2, 3, 3, 4, 4, 5];
const byTeam = (table: number[], n: number) => table[Math.max(0, Math.min(table.length, n) - 1)];
export const teamHearts = (players: number) => byTeam(TEAM_HEARTS, players);
export const picnicHeal = (players: number) => byTeam(PICNIC_HEAL, players);
export const secondWindHearts = (players: number) => byTeam(SECOND_WIND, players);

/**
 * A Match whose holes are generated as the run goes, with hearts, forks, trinkets, omens and
 * rest stops on top of the normal stroke rules. Runs on the host (server, direct host, or
 * locally for solo); clients mirror its state from `score().hopper`.
 */
export class HopperMatch extends Match {
  readonly seed: number;
  readonly worlds: string[];
  readonly upgrades: Record<string, number>;
  readonly hs: HopperState;
  private queue: ('trinket' | 'route' | 'prestige')[] = [];
  private optionSpecs: StageSpec[] = [];
  private nextSpec: StageSpec | null = null;
  private choiceTimer = 0;
  private voteOrder: string[] = [];
  private rerollsUsed = 0;
  private shieldUsed = 0;
  private restClaimed = false;
  private pendingEnd: 'won' | 'lost' | null = null;
  private lostToBoss = false;
  /** Hot Streak: holes in a row the whole team finished at par or better. */
  private streak = 0;

  constructor(setup: HopperSetup) {
    super({ mode: 'hopper', holes: [], players: setup.players, holeEndDelay: 3.5, chaos: !!setup.chaos });
    this.seed = setup.seed;
    this.worlds = runWorlds(setup.seed);
    this.upgrades = setup.upgrades;
    const max = teamHearts(setup.players.length) + this.rank('vigor');
    this.hs = {
      seed: setup.seed,
      stage: 0,
      stages: [],
      hearts: max,
      maxHearts: max,
      dust: 0,
      trinkets: [],
      levels: {},
      rerolls: this.rank('dice'),
      secondWind: this.rank('secondwind') > 0,
      strokeLimit: 0,
      choice: null,
      lastDelta: null,
      result: 'running',
      prestige: 0,
      coins: 0,
      coinsEarned: 0,
      coinsSpent: 0,
      shopLog: [],
      boosts: [],
    };
    // v1.12: only the host's keepsake joins the run.
    const keepsake = setup.keepsakes[0];
    if (isTrinket(keepsake) && !isCurse(keepsake)) this.addTrinket(keepsake, false);
    const first = this.makeSpec(0, null, 'dust', 0);
    this.hs.stages.push(first);
    this.cfg.holes.push(stageHole(this.seed, 0, first));
  }

  /** Share (0–1) of every Clubhouse upgrade rank the run started with. */
  clubhousePower(): number {
    const total = UPGRADE_IDS.reduce((a, id) => a + UPGRADES[id].costs.length, 0);
    return UPGRADE_IDS.reduce((a, id) => a + this.rank(id), 0) / total;
  }

  private rank(id: UpgradeId): number {
    return Math.min(UPGRADES[id].costs.length, Math.max(0, Math.floor(this.upgrades[id] ?? 0)));
  }

  private has(t: TrinketId): boolean {
    return this.hs.trinkets.includes(t);
  }

  /** Run level of a trinket: 0 = not owned, else 1..3 (curses: 1). */
  lv(t: TrinketId): number {
    return this.has(t) ? Math.min(maxLevelOf(t), this.hs.levels[t] ?? 1) : 0;
  }

  combo(c: ComboId): boolean {
    return COMBOS[c].needs.every((t) => this.has(t));
  }

  /** Prestige loop of the current stage (0 = first time round). */
  get loop(): number {
    return loopOf(this.hs.stage);
  }

  /** Planet order for a prestige loop (the first loop keeps the run's own order). */
  worldsFor(loop: number): string[] {
    return loop === 0 ? this.worlds : runWorlds(this.seed + loop * 7919);
  }

  /** Stardust gained (the Glass Cannon doubles it). */
  private addDust(n: number): void {
    this.hs.dust += this.has('glass') ? n * 2 : n;
  }

  /** Shaping list for a stage spec: one copy per level of each hole-shaping trinket. */
  private shaping(): TrinketId[] {
    return this.hs.trinkets.filter((t) => SHAPING.includes(t)).flatMap((t) => Array(this.lv(t)).fill(t));
  }

  private note(text: string, tone: 'good' | 'bad' | 'info' | 'epic' = 'info'): void {
    this.events.push({ type: 'note', text, tone });
  }

  private changed(): void {
    this.events.push({ type: 'hopper' });
  }

  get spec(): StageSpec {
    return this.hs.stages[this.hs.stage];
  }

  makeSpec(index: number, omen: OmenId | null, reward: RewardId | null, variant: number): StageSpec {
    const sk = skeletonAt(index);
    const loop = loopOf(index);
    const spec: StageSpec = {
      kind: sk.kind,
      sector: sk.sector,
      world: this.worldsFor(loop)[sk.sector],
      // Prestige loops start harder and reach the hardest holes sooner.
      depth: Math.min(MAX_DEPTH, stageDepth(index) + PRESTIGE.depthPerLoop * loop),
      variant,
      omen,
      reward,
      shaping: this.shaping(),
    };
    if (loop > 0) spec.loop = loop;
    if (sk.kind === 'rest') {
      const r = rng(hashString(`rest:${this.seed}:${index}`));
      const pool = [...REST_REWARDS];
      spec.crates = [0, 1, 2].map(() => pool.splice(Math.floor(r() * pool.length), 1)[0]);
      spec.omen = null;
      spec.reward = null;
    }
    if (sk.kind === 'boss') {
      const r = rng(hashString(`boss:${this.seed}:${index}`));
      const omens = OMEN_IDS.filter((o) => o !== 'fog' && o !== 'fuse');
      spec.omen = omens[Math.floor(r() * omens.length)];
      spec.reward = 'trinket';
    }
    return spec;
  }

  // ------------------------------------------------------------------------------------------
  // Rules
  // ------------------------------------------------------------------------------------------

  override strokeLimit(): number {
    const par = this.hole.par;
    if (this.spec.kind === 'rest') return par + 8;
    const base =
      this.spec.omen === 'fuse'
        ? [2, 3, 4, 4][this.lv('compass')]
        : this.spec.kind === 'boss'
          ? BOSS_STROKE_ALLOWANCE
          : 4;
    const overtime = [0, 3, 5, 7][this.lv('overtime')];
    const moth = [0, 0, 2, 4][this.lv('moth')];
    const extra = this.spec.boosts?.includes('strokes') ? 3 : 0;
    return par + base + overtime + moth + extra;
  }

  override startHole(index: number): void {
    this.restClaimed = false;
    this.shieldUsed = 0;
    super.startHole(index);
    this.hs.strokeLimit = this.strokeLimit();
    this.hs.lastDelta = null;
    const spec = this.spec;
    if (spec.kind === 'rest') {
      const n = 1 + this.lv('hourglass');
      this.heal(n);
      this.note(`🌿 Rest stop — the team catches its breath (+${n} ❤️)`, 'good');
      if (this.hs.coins > 0) this.note(`🛒 The shop is open: ${this.hs.coins} coins to spend`, 'info');
    } else if (spec.kind === 'boss') this.note(`☠️ Boss hole: ${this.hole.name}`, 'epic');
    this.changed();
  }

  protected override hazardPenalty(e: string): number {
    return this.has('moth') ? 0 : super.hazardPenalty(e);
  }

  protected override restCountsAsHoled(e: string): boolean {
    if (!this.has('clover') || this.spec.kind === 'rest') return false;
    const b = this.sim.getBall(e);
    if (!b) return false;
    const cup = this.hole.cup;
    const reach = GIMME_RANGE[this.lv('clover')];
    const d = Math.hypot(b.pos[0] - cup[0], b.pos[2] - cup[2]);
    if (d >= reach || Math.abs(b.pos[1] - cup[1]) > 0.45) return false;
    this.note('🍀 Gimme! It drops in for free', 'good');
    return true;
  }

  /** The clover's tap-in is free: the ball just drops in. */
  protected override gimmeStrokes(): number {
    return 0;
  }

  protected override holedStrokes(e: string, strokes: number): number {
    if (this.has('bank') && (this.bankContacts[e] ?? 0) > 0 && strokes > 1) {
      const refund = Math.min(strokes - 1, this.lv('bank'));
      this.note(`🎱 Bank shot! −${refund} stroke${refund > 1 ? 's' : ''}`, 'good');
      return strokes - refund;
    }
    return strokes;
  }

  protected override onCollected(item: string, kind: CollectibleKind): void {
    if (kind === 'coin') {
      const jackpot = this.combo('jackpot') ? 1 : 0;
      this.addDust(1 + this.lv('pouch') + jackpot);
      const coins =
        1 + this.lv('piggy') + (this.has('greed') ? 2 : 0) + jackpot + PRESTIGE.coinPerLoop * this.loop;
      this.hs.coins += coins;
      this.hs.coinsEarned += coins;
    } else if (kind === 'gem') this.addDust(5);
    else if (kind === 'case') {
      const id = caseOfItem(item);
      // Everyone in the run gets one (applyHopperRun banks it for each player at the end).
      if (id) this.note(`💼 ${CASES[id].name} found! Everyone gets one`, 'epic');
    } else if (kind === 'crate' && this.spec.kind === 'rest' && !this.restClaimed) {
      const m = /:rest\d:(\w+)$/.exec(item);
      const reward = m?.[1] as RewardId | undefined;
      if (!reward) return;
      this.restClaimed = true;
      this.grant(reward);
      // The wish is made: everyone's done here.
      for (const e of this.entrants)
        if (!this.done[e]) {
          this.sim.pickUp(e);
          this.finishEntrant(e, false);
        }
    }
    this.changed();
  }

  private heal(n: number): void {
    this.hs.hearts = Math.min(this.hs.maxHearts, this.hs.hearts + n);
  }

  /** Gain a trinket, or level it up if the team already has it. */
  private addTrinket(t: TrinketId, announce = true): void {
    const before = activeCombos(this.hs.trinkets);
    if (this.has(t)) {
      const lv = this.lv(t);
      if (lv >= maxLevelOf(t)) return;
      this.hs.levels[t] = lv + 1;
      if (announce) this.note(`⬆️ ${TRINKETS[t].icon} ${TRINKETS[t].name} Lv${lv + 1}!`, 'epic');
    } else {
      this.hs.trinkets.push(t);
      this.hs.levels[t] = 1;
      if (announce) this.note(`${TRINKETS[t].icon} ${TRINKETS[t].name}!`, 'epic');
    }
    if (t === 'ironheart') {
      this.hs.maxHearts += 2;
      this.heal(2);
    }
    if (t === 'glass' && this.lv(t) === 1) this.setMax(this.hs.maxHearts - 2);
    for (const c of activeCombos(this.hs.trinkets))
      if (!before.includes(c)) {
        if (c === 'fortress') {
          this.hs.maxHearts += 2;
          this.heal(2);
        }
        if (announce) this.note(`${COMBOS[c].icon} Combo: ${COMBOS[c].name}!`, 'epic');
      }
  }

  /** Change max hearts (never below 1), keeping hearts within it. */
  private setMax(n: number): void {
    this.hs.maxHearts = Math.max(1, n);
    this.hs.hearts = Math.min(this.hs.hearts, this.hs.maxHearts);
  }

  /** Sell (lose) a trinket: undo what it added to max hearts, and any combo it broke. */
  private removeTrinket(t: TrinketId): void {
    if (!this.has(t)) return;
    const lv = this.lv(t);
    const before = activeCombos(this.hs.trinkets);
    this.hs.trinkets = this.hs.trinkets.filter((x) => x !== t);
    delete this.hs.levels[t];
    let max = this.hs.maxHearts;
    if (t === 'ironheart') max -= 2 * lv;
    if (t === 'glass') max += 2;
    const after = activeCombos(this.hs.trinkets);
    if (before.includes('fortress') && !after.includes('fortress')) max -= 2;
    this.setMax(max);
  }

  // ------------------------------------------------------------------------------------------
  // v1.12 rest-stop shop (team coins picked up this run)
  // ------------------------------------------------------------------------------------------

  /** Is the shop open (the team is at a rest stop and the run is on)? */
  get shopOpen(): boolean {
    return this.spec?.kind === 'rest' && this.hs.result === 'running' && this.phase !== 'courseEnd';
  }

  /** Buy a powerup or sell a trinket. Returns an error message, or null when it worked. */
  shop(playerId: string, action: 'buy' | 'sell', item: string): string | null {
    if (!this.players.some((p) => p.id === playerId)) return 'Not in this run';
    if (!this.shopOpen) return 'The shop is only open at rest stops';
    const who = this.players.find((p) => p.id === playerId)?.name ?? '';
    const by = this.players.length > 1 && who ? ` (${who})` : '';
    if (action === 'buy') {
      const def = POWERUPS[item as PowerupId];
      if (!def) return 'Unknown item';
      if (NEXT_HOLE_POWERUPS.includes(def.id) && this.hs.boosts.includes(def.id)) return 'Already bought';
      if (this.hs.coins < def.price) return 'Not enough coins';
      this.hs.coins -= def.price;
      this.hs.coinsSpent += def.price;
      this.hs.shopLog.push({ item: def.id, coins: def.price });
      if (def.id === 'snack') this.heal(2);
      else if (def.id === 'dice') this.hs.rerolls++;
      else this.hs.boosts.push(def.id);
      this.note(`🛒 ${def.icon} ${def.name} bought${by}`, 'good');
    } else {
      if (!isTrinket(item) || !this.has(item)) return 'You don’t have that trinket';
      const price = sellPrice(item, this.lv(item));
      this.removeTrinket(item);
      this.hs.coins += price;
      this.hs.shopLog.push({ item, coins: price, sold: true });
      this.note(`🛒 ${TRINKETS[item].icon} ${TRINKETS[item].name} sold for ${price} coins${by}`, 'info');
    }
    this.changed();
    return null;
  }

  /** The Jittery Glove wobbles every putt a little (unless Steady Hands holds it still). */
  protected override aimShot(playerId: string, e: string, dirX: number, dirZ: number): [number, number] {
    if (!this.has('jitter') || this.combo('steady')) return [dirX, dirZ];
    const r = rng(
      hashString(`jitter:${this.seed}:${this.hs.stage}:${playerId}:${this.shotsThisHole[e] ?? 0}`),
    );
    const a = (r() * 2 - 1) * ((JITTER_DEGREES * Math.PI) / 180);
    const c = Math.cos(a),
      sn = Math.sin(a);
    return [dirX * c - dirZ * sn, dirX * sn + dirZ * c];
  }

  private grant(reward: RewardId): void {
    switch (reward) {
      case 'heal': {
        const n = picnicHeal(this.players.length);
        this.heal(n);
        this.note(`❤️ +${n} heart${n > 1 ? 's' : ''}`, 'good');
        break;
      }
      case 'dust':
        this.addDust(12);
        this.note('✨ +12 stardust', 'good');
        break;
      case 'vitality':
        this.hs.maxHearts += 1;
        this.heal(1);
        this.note('💖 +1 max heart', 'good');
        break;
      case 'trinket':
        this.queue.unshift('trinket');
        break;
      case 'gamble': {
        const r = rng(hashString(`gamble:${this.seed}:${this.hs.stage}`));
        const rares = TRINKET_IDS.filter((t) => TRINKETS[t].rare && !isCurse(t) && !this.has(t));
        if (rares.length && r() < 0.4) this.addTrinket(rares[Math.floor(r() * rares.length)]);
        else {
          this.addDust(25);
          this.note('🎲 Mystery box: +25 stardust', 'good');
        }
        break;
      }
    }
  }

  protected override onHoleComplete(): void {
    const spec = this.spec;
    const idx = this.hs.stage;
    if (spec.kind === 'rest') {
      if (!this.restClaimed) {
        this.addDust(8);
        this.note('⛳ Sunk it instead: +8 stardust tip', 'info');
      }
    } else {
      const by: Record<string, number> = {};
      let net = 0;
      const small = this.players.length <= SMALL_TEAM;
      const boss = spec.kind === 'boss';
      // A small, fully kitted team needs to beat a boss's par to stay level.
      const bossPar = boss && small && this.clubhousePower() >= STRONG_CLUBHOUSE ? 1 : 0;
      let cleared = false;
      let counted = false;
      let allGood = true;
      let underPar = 0;
      let bankHoled = false;
      for (const e of this.entrants) {
        const res = this.results[e][this.holeIndex];
        const connected = this.players.find((p) => p.id === e)?.connected ?? true;
        if (!res || !connected) {
          by[e] = 0;
          continue;
        }
        counted = true;
        if (!res.pickedUp) cleared = true;
        if (res.pickedUp || res.strokes > res.par) allGood = false;
        if (!res.pickedUp && res.strokes < res.par) underPar++;
        if (!res.pickedUp && res.bankContacts > 0) bankHoled = true;
        let d = res.pickedUp
          ? -[3, 2, 2, 1][this.lv('overtime')]
          : res.holeInOne
            ? 2
            : Math.max(-3, Math.min(small ? 1 : 2, res.par - bossPar - res.strokes));
        if (small && !res.pickedUp && d < 0 && spec.sector >= 1) d = Math.max(-3, d - 1);
        // Greedy Gremlin: an over-par hole costs one more heart.
        if (this.has('greed') && !res.pickedUp && res.strokes > res.par) d = Math.max(-4, d - 1);
        if (d > 0) d += this.lv('feeder');
        by[e] = d;
        net += d;
      }
      const block = Math.min(-net, this.lv('shield') + (this.combo('fortress') ? 1 : 0) - this.shieldUsed);
      if (net < 0 && block > 0) {
        this.shieldUsed += block;
        net += block;
        this.note(`🛡️ Bogey Shield blocked ${block > 1 ? `${block} hearts` : 'a heart'}`, 'good');
      }
      if (net < 0 && spec.boosts?.includes('bubble')) {
        this.note(`🫧 The bubble popped: no hearts lost`, 'good');
        net = 0;
      }
      this.hs.hearts = Math.min(this.hs.maxHearts, this.hs.hearts + net);
      this.hs.lastDelta = { by, net };
      if (counted && underPar && this.combo('birdbath')) {
        this.addDust(4 * underPar);
        this.note(`🛁 Bird Bath: +${4 * underPar} stardust`, 'good');
      }
      if (counted && bankHoled && this.combo('trickshot')) {
        this.heal(1);
        this.note('🎱 Trick Shot: +1 ❤️', 'good');
      }
      // Hot Streak: two holes in a row with the whole team at par or better.
      this.streak = counted && allGood ? this.streak + 1 : 0;
      const hot = this.lv('streak');
      if (hot && this.streak >= 2) {
        this.streak = 0;
        const n = hot >= 3 ? 2 : 1;
        this.heal(n);
        if (hot >= 2) this.addDust(5);
        this.note(`🔥 Hot Streak! +${n} ❤️${hot >= 2 ? ', +5 stardust' : ''}`, 'good');
      }
      if (spec.reward) this.grant(spec.reward);
      if (boss && counted && !cleared) {
        // Nobody holed the boss: the run ends here, whatever hearts are left.
        this.lostToBoss = true;
        this.pendingEnd = 'lost';
      } else if (boss) {
        const dust = 15 + PRESTIGE.bossDustPerLoop * this.loop + 10 * this.lv('crown');
        this.addDust(dust);
        const heal = (small ? 0 : 1) + this.lv('crown');
        this.heal(heal);
        this.note(`☠️ Boss cleared! +${dust} stardust${heal ? `, +${heal} ❤️` : ''}`, 'epic');
      }
      if (!this.pendingEnd && this.hs.hearts <= 0) {
        if (this.hs.secondWind) {
          this.hs.secondWind = false;
          const back = secondWindHearts(this.players.length);
          this.hs.hearts = back;
          this.note(`🔥 Second Wind! Back up with ${back} hearts`, 'epic');
        } else {
          this.hs.hearts = 0;
          this.pendingEnd = 'lost';
        }
      }
    }
    // The last boss of a loop: go round again (prestige) or cash out.
    const lastOfLoop = (idx + 1) % SKELETON.length === 0;
    if (!this.pendingEnd && lastOfLoop) this.queue.push('prestige');
    else if (!this.pendingEnd && skeletonAt(idx + 1).kind === 'hole') this.queue.push('route');
    if (this.pendingEnd) this.queue = [];
    this.changed();
  }

  // ------------------------------------------------------------------------------------------
  // Flow: hole end -> choices -> next stage
  // ------------------------------------------------------------------------------------------

  override step(): void {
    super.step();
    if (this.hs.choice && this.hs.choice.secondsLeft >= 0) {
      this.choiceTimer -= DT;
      const s = Math.max(0, Math.ceil(this.choiceTimer));
      if (s !== this.hs.choice.secondsLeft) this.hs.choice.secondsLeft = s;
      if (this.choiceTimer <= 0) this.resolve();
    }
  }

  override advance(): void {
    if (this.phase !== 'holeEnd' || this.hs.choice) return;
    if (this.pendingEnd) {
      this.hs.result = this.pendingEnd;
      this.phase = 'courseEnd';
      this.note(
        this.pendingEnd === 'won'
          ? this.hs.prestige > 0
            ? `🏆 Cashed out after ${this.hs.prestige + 1} laps of the planets!`
            : '🏆 You conquered every planet!'
          : this.lostToBoss
            ? '☠️ The boss beat you: nobody holed out'
            : '💔 Out of hearts…',
        this.pendingEnd === 'won' ? 'epic' : 'bad',
      );
      this.events.push({ type: 'courseComplete' });
      this.changed();
      return;
    }
    while (this.queue.length) {
      const next = this.queue.shift()!;
      if (this.openChoice(next)) return;
    }
    this.goNext();
  }

  private goNext(): void {
    const i = this.hs.stage + 1;
    const spec = this.nextSpec ?? this.makeSpec(i, null, null, 0);
    this.nextSpec = null;
    // Shop powerups ride on the next golf hole (Big Cup is part of the hole itself).
    if (spec.kind !== 'rest' && this.hs.boosts.length) {
      spec.boosts = [...this.hs.boosts];
      if (spec.boosts.includes('fairweather') && spec.omen) {
        spec.omen = null;
        this.note('🌤️ Fair Weather: the omen blew over', 'good');
      }
      this.hs.boosts = [];
    }
    this.hs.stages.push(spec);
    this.cfg.holes.push(stageHole(this.seed, i, spec));
    this.hs.stage = i;
    this.startHole(i);
  }

  private openChoice(kind: 'trinket' | 'route' | 'prestige'): boolean {
    const options: ChoiceOption[] =
      kind === 'route'
        ? this.routeOptions()
        : kind === 'prestige'
          ? [{ action: 'prestige' }, { action: 'cashout' }]
          : this.trinketOptions();
    if (!options.length) {
      if (kind === 'trinket') {
        this.hs.dust += 15;
        this.note('🎁 Every trinket is maxed: +15 stardust instead', 'good');
      }
      return false;
    }
    const solo = this.players.length === 1;
    this.hs.choice = {
      kind,
      title:
        kind === 'route'
          ? 'Choose your route'
          : kind === 'prestige'
            ? `Every planet conquered${this.hs.prestige ? ` ×${this.hs.prestige + 1}` : ''}!`
            : 'Choose a trinket',
      options,
      votes: {},
      secondsLeft: solo ? -1 : VOTE_SECONDS,
    };
    this.choiceTimer = VOTE_SECONDS;
    this.voteOrder = [];
    this.changed();
    return true;
  }

  private routeOptions(): ChoiceOption[] {
    const i = this.hs.stage + 1;
    const r = rng(hashString(`fork:${this.seed}:${i}:${this.rerollsUsed}`));
    const t = stageDepth(i) / 15 + PRESTIGE.omenPerLoop * loopOf(i);
    const n = 2 + (this.rank('cartographer') > 0 ? 1 : 0);
    const out: ChoiceOption[] = [];
    this.optionSpecs = [];
    const used = new Set<RewardId>();
    for (let k = 0; k < n; k++) {
      // Weighted rewards: hurting teams see more picnics; trinkets are the risky prize.
      const hurt = 1 - this.hs.hearts / this.hs.maxHearts;
      const weights: [RewardId, number][] = [
        ['heal', 0.6 + hurt * 2],
        ['dust', 1],
        ['trinket', 0.9],
        ['vitality', 0.25],
        ['gamble', 0.2],
      ];
      const avail = weights.filter(([id]) => !used.has(id));
      const total = avail.reduce((a, [, w]) => a + w, 0);
      let x = r() * total;
      let reward: RewardId = avail[0][0];
      for (const [id, w] of avail) {
        if ((x -= w) <= 0) {
          reward = id;
          break;
        }
      }
      used.add(reward);
      const risky = reward === 'trinket' || reward === 'vitality' || reward === 'gamble';
      const omenChance = (risky ? 0.55 : 0.15) + 0.4 * t;
      const omen = r() < omenChance ? OMEN_IDS[Math.floor(r() * OMEN_IDS.length)] : null;
      const spec = this.makeSpec(i, omen, reward, this.rerollsUsed * 10 + k);
      this.optionSpecs.push(spec);
      const hole = stageHole(this.seed, i, spec);
      out.push({ reward, omen, par: hole.par, name: hole.name });
    }
    return out;
  }

  private trinketOptions(): ChoiceOption[] {
    const r = rng(
      hashString(
        `draft:${this.seed}:${this.hs.stage}:${this.rerollsUsed}:${this.hs.trinkets.map((t) => this.lv(t)).join('')}`,
      ),
    );
    // New trinkets, plus level-ups of ones the team owns (below max level).
    const pool = TRINKET_IDS.filter((t) => this.lv(t) < maxLevelOf(t));
    // Prestige loops make rare trinkets turn up more.
    const rareWeight = RARE_WEIGHT * (1 + PRESTIGE.rarePerLoop * this.loop);
    let curses = 0;
    const n = Math.min(pool.length, 3 + (this.rank('wide') > 0 ? 1 : 0));
    const out: ChoiceOption[] = [];
    let levelUps = 0;
    while (out.length < n && pool.length) {
      // Rares turn up a quarter as often; each level is rarer than the last (Lv2 uncommon, Lv3 rare).
      // At most one level-up per draft while new trinkets are left to offer.
      const onlyNew = levelUps > 0 && pool.some((t) => this.lv(t) === 0 && !isCurse(t));
      const weights = pool.map(
        (t) =>
          (onlyNew && this.lv(t) > 0 ? 0 : 1) *
          (isCurse(t) ? (curses ? 0 : CURSE_WEIGHT) : TRINKETS[t].rare ? rareWeight : 1) *
          LEVEL_UP_WEIGHT[this.lv(t)],
      );
      let x = r() * weights.reduce((a, b) => a + b, 0);
      let k = -1;
      for (let j = 0; j < pool.length; j++) {
        if (weights[j] <= 0) continue;
        k = j;
        if ((x -= weights[j]) <= 0) break;
      }
      if (k < 0) break;
      const t = pool.splice(k, 1)[0];
      if (this.lv(t) > 0) levelUps++;
      if (isCurse(t)) curses++;
      out.push({ trinket: t, level: this.lv(t) + 1 });
    }
    return out;
  }

  /** A player picks option `i` (solo: applies immediately; co-op: majority vote). */
  vote(playerId: string, i: number): boolean {
    const c = this.hs.choice;
    if (!c || !Number.isInteger(i) || i < 0 || i >= c.options.length) return false;
    if (!this.players.some((p) => p.id === playerId)) return false;
    c.votes[playerId] = i;
    this.voteOrder = [...this.voteOrder.filter((x) => x !== playerId), playerId];
    this.recount();
    return true;
  }

  /** The option a strict majority of the connected players voted for, if any (3+ connected). */
  majorityOption(): number | null {
    const c = this.hs.choice;
    const voters = this.players.filter((p) => p.connected);
    if (!c || voters.length <= 2) return null;
    const tally = new Map<number, number>();
    for (const p of voters) {
      const v = c.votes[p.id];
      if (v !== undefined) tally.set(v, (tally.get(v) ?? 0) + 1);
    }
    for (const [opt, n] of tally) if (n * 2 > voters.length) return opt;
    return null;
  }

  /** After a vote or a (dis)connect: decide if everyone has voted, else apply the majority rule. */
  private recount(): void {
    const c = this.hs.choice;
    if (!c) return;
    const voters = this.players.filter((p) => p.connected);
    if (voters.length && voters.every((p) => c.votes[p.id] !== undefined)) {
      this.resolve();
      return;
    }
    const maj = this.majorityOption();
    if (maj === null) delete c.majority;
    else {
      c.majority = maj;
      // Never raise or restart it: only ever cut it down.
      if (c.secondsLeft >= 0 && this.choiceTimer > MAJORITY_SECONDS) {
        this.choiceTimer = MAJORITY_SECONDS;
        c.secondsLeft = MAJORITY_SECONDS;
      }
    }
    this.changed();
  }

  override setConnected(playerId: string, connected: boolean): void {
    super.setConnected(playerId, connected);
    this.recount();
  }

  /** Seconds left on the open choice's countdown (host side, exact). */
  get choiceSecondsLeft(): number {
    return this.hs.choice && this.hs.choice.secondsLeft >= 0 ? Math.max(0, this.choiceTimer) : -1;
  }

  /** Spend a Lucky Dice reroll on the open choice. */
  reroll(playerId: string): boolean {
    const c = this.hs.choice;
    if (!c || this.hs.rerolls <= 0 || !this.players.some((p) => p.id === playerId)) return false;
    this.hs.rerolls--;
    this.rerollsUsed++;
    if (c.kind === 'prestige') return false;
    c.options = c.kind === 'route' ? this.routeOptions() : this.trinketOptions();
    if (!c.options.length) {
      this.hs.choice = null;
      this.advance();
      return true;
    }
    c.votes = {};
    delete c.majority;
    this.voteOrder = [];
    this.choiceTimer = VOTE_SECONDS;
    if (c.secondsLeft >= 0) c.secondsLeft = VOTE_SECONDS;
    this.note('🎲 Rerolled!', 'info');
    this.changed();
    return true;
  }

  private resolve(): void {
    const c = this.hs.choice;
    if (!c) return;
    // Connected players' votes decide (all votes if nobody connected has voted).
    const live = new Set(this.players.filter((p) => p.connected).map((p) => p.id));
    const counted = Object.entries(c.votes).some(([id]) => live.has(id))
      ? Object.entries(c.votes).filter(([id]) => live.has(id))
      : Object.entries(c.votes);
    const tally = new Map<number, number>();
    for (const [, v] of counted) tally.set(v, (tally.get(v) ?? 0) + 1);
    let pick = 0;
    if (tally.size) {
      const best = Math.max(...tally.values());
      const tied = [...tally.entries()].filter(([, n]) => n === best).map(([i]) => i);
      // Tie: the option that got its first vote earliest.
      pick =
        this.voteOrder
          .filter((p) => counted.some(([id]) => id === p))
          .map((p) => c.votes[p])
          .find((v) => tied.includes(v)) ?? tied[0];
    }
    const opt = c.options[pick];
    this.hs.choice = null;
    if (c.kind === 'trinket' && opt.trinket) this.addTrinket(opt.trinket);
    if (c.kind === 'prestige') {
      if (opt.action === 'prestige') {
        this.hs.prestige++;
        this.heal(PRESTIGE.heal);
        this.note(`🌟 Prestige ${this.hs.prestige}! The planets get tougher, and richer`, 'epic');
        this.queue.push('route');
      } else this.pendingEnd = 'won';
    }
    if (c.kind === 'route') this.nextSpec = this.optionSpecs[pick] ?? null;
    // Trinkets picked after a fork was decided still shape that next hole.
    if (this.nextSpec) this.nextSpec.shaping = this.shaping();
    this.changed();
    this.advance();
  }

  override score(): ScoreState {
    return { ...super.score(), hopper: structuredClone(this.hs) };
  }
}
