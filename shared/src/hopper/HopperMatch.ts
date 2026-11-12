import { DT } from '../config';
import { Match, type ScoreState } from '../match/Match';
import type { CollectibleKind } from '../schema';
import { hashString, rng } from '../rng';
import {
  MAX_TRINKET_LEVEL,
  OMEN_IDS,
  SKELETON,
  TRINKETS,
  TRINKET_IDS,
  UPGRADES,
  isTrinket,
  type ChoiceOption,
  type HopperState,
  type OmenId,
  type RewardId,
  type StageSpec,
  type TrinketId,
  type UpgradeId,
} from './defs';
import { stageHole } from './generate';

export interface HopperSetup {
  seed: number;
  players: { id: string; name: string }[];
  /** Clubhouse upgrades of the player who started the run. */
  upgrades: Record<string, number>;
  /** Every player's equipped keepsake joins the team's trinkets. */
  keepsakes: (string | null | undefined)[];
}

/** Trinkets that change the hole itself (baked into the generated geometry/physics). */
const SHAPING: TrinketId[] = ['magnet', 'glove', 'socks', 'compass'];
const VOTE_SECONDS = 25;
/** Draft weight by current level: new trinket, level-up to Lv2, level-up to Lv3. */
const LEVEL_UP_WEIGHT = [1, 0.4, 0.12, 0];
const REST_REWARDS: RewardId[] = ['heal', 'dust', 'trinket', 'vitality', 'gamble'];

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
  return SKELETON.slice(0, index).filter((s) => s.kind !== 'rest').length;
}

/**
 * Team-size balance. Hearts are shared, but each player's result moves them, so a bigger team
 * swings the pool harder; three players is the reference. A solo run gets a smaller pool and
 * smaller picnics so it is about as hard to finish as a three-player run.
 */
const TEAM_HEARTS = [4, 7, 10, 12, 14, 16];
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
  private queue: ('trinket' | 'route')[] = [];
  private optionSpecs: StageSpec[] = [];
  private nextSpec: StageSpec | null = null;
  private choiceTimer = 0;
  private voteOrder: string[] = [];
  private rerollsUsed = 0;
  private shieldUsed = 0;
  private restClaimed = false;
  private pendingEnd: 'won' | 'lost' | null = null;

  constructor(setup: HopperSetup) {
    super({ mode: 'hopper', holes: [], players: setup.players, holeEndDelay: 3.5 });
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
    };
    // Matching keepsakes in co-op stack: the second copy levels the trinket up.
    for (const k of setup.keepsakes) if (isTrinket(k)) this.addTrinket(k, false);
    const first = this.makeSpec(0, null, 'dust', 0);
    this.hs.stages.push(first);
    this.cfg.holes.push(stageHole(this.seed, 0, first));
  }

  private rank(id: UpgradeId): number {
    return Math.min(UPGRADES[id].costs.length, Math.max(0, Math.floor(this.upgrades[id] ?? 0)));
  }

  private has(t: TrinketId): boolean {
    return this.hs.trinkets.includes(t);
  }

  /** Run level of a trinket: 0 = not owned, else 1..3. */
  lv(t: TrinketId): number {
    return this.has(t) ? Math.min(MAX_TRINKET_LEVEL, this.hs.levels[t] ?? 1) : 0;
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
    const sk = SKELETON[index];
    const spec: StageSpec = {
      kind: sk.kind,
      sector: sk.sector,
      world: this.worlds[sk.sector],
      depth: stageDepth(index),
      variant,
      omen,
      reward,
      shaping: this.shaping(),
    };
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
    const base = this.spec.omen === 'fuse' ? [2, 3, 4, 4][this.lv('compass')] : 4;
    const overtime = [0, 3, 5, 7][this.lv('overtime')];
    const moth = [0, 0, 2, 4][this.lv('moth')];
    return par + base + overtime + moth;
  }

  override startHole(index: number): void {
    this.restClaimed = false;
    this.shieldUsed = 0;
    super.startHole(index);
    this.hs.strokeLimit = this.strokeLimit();
    this.hs.lastDelta = null;
    const spec = this.spec;
    if (spec.kind === 'rest') {
      this.heal(1);
      this.note('🌿 Rest stop — the team catches its breath (+1 ❤️)', 'good');
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
    const reach = [0, 0.55, 0.8, 1.05][this.lv('clover')];
    return Math.hypot(b.pos[0] - cup[0], b.pos[2] - cup[2]) < reach && Math.abs(b.pos[1] - cup[1]) < 0.4;
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
    if (kind === 'coin') this.hs.dust += 1 + this.lv('pouch');
    else if (kind === 'gem') this.hs.dust += 5;
    else if (kind === 'crate' && this.spec.kind === 'rest' && !this.restClaimed) {
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
    if (this.has(t)) {
      const lv = this.lv(t);
      if (lv >= MAX_TRINKET_LEVEL) return;
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
        this.hs.dust += 12;
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
        const rares = TRINKET_IDS.filter((t) => TRINKETS[t].rare && !this.has(t));
        if (rares.length && r() < 0.6) this.addTrinket(rares[Math.floor(r() * rares.length)]);
        else {
          this.hs.dust += 25;
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
        this.hs.dust += 8;
        this.note('⛳ Sunk it instead: +8 stardust tip', 'info');
      }
    } else {
      const by: Record<string, number> = {};
      let net = 0;
      for (const e of this.entrants) {
        const res = this.results[e][this.holeIndex];
        const connected = this.players.find((p) => p.id === e)?.connected ?? true;
        if (!res || !connected) {
          by[e] = 0;
          continue;
        }
        let d = res.pickedUp
          ? -[3, 2, 2, 1][this.lv('overtime')]
          : res.holeInOne
            ? 2
            : Math.max(-3, Math.min(2, res.par - res.strokes));
        if (d > 0) d += this.lv('feeder');
        by[e] = d;
        net += d;
      }
      const block = Math.min(-net, this.lv('shield') - this.shieldUsed);
      if (net < 0 && block > 0) {
        this.shieldUsed += block;
        net += block;
        this.note(`🛡️ Bogey Shield blocked ${block > 1 ? `${block} hearts` : 'a heart'}`, 'good');
      }
      this.hs.hearts = Math.min(this.hs.maxHearts, this.hs.hearts + net);
      this.hs.lastDelta = { by, net };
      if (spec.reward) this.grant(spec.reward);
      if (spec.kind === 'boss') {
        this.hs.dust += 15;
        this.heal(1);
        this.note('☠️ Boss cleared! +15 stardust, +1 ❤️', 'epic');
      }
      if (this.hs.hearts <= 0) {
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
    if (!this.pendingEnd && idx + 1 >= SKELETON.length) this.pendingEnd = 'won';
    if (!this.pendingEnd && SKELETON[idx + 1].kind === 'hole') this.queue.push('route');
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
        this.pendingEnd === 'won' ? '🏆 You conquered every planet!' : '💔 Out of hearts…',
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
    this.hs.stages.push(spec);
    this.cfg.holes.push(stageHole(this.seed, i, spec));
    this.hs.stage = i;
    this.startHole(i);
  }

  private openChoice(kind: 'trinket' | 'route'): boolean {
    const options = kind === 'route' ? this.routeOptions() : this.trinketOptions();
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
      title: kind === 'route' ? 'Choose your route' : 'Choose a trinket',
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
    const t = stageDepth(i) / 15;
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
        ['gamble', 0.3],
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
    const pool = TRINKET_IDS.filter((t) => this.lv(t) < MAX_TRINKET_LEVEL);
    const n = Math.min(pool.length, 3 + (this.rank('wide') > 0 ? 1 : 0));
    const out: ChoiceOption[] = [];
    while (out.length < n) {
      // Rares are half as likely; each level is rarer than the last (Lv2 uncommon, Lv3 rare).
      const weights = pool.map((t) => (TRINKETS[t].rare ? 0.5 : 1) * LEVEL_UP_WEIGHT[this.lv(t)]);
      let x = r() * weights.reduce((a, b) => a + b, 0);
      let k = 0;
      while ((x -= weights[k]) > 0) k++;
      const t = pool.splice(Math.min(k, pool.length - 1), 1)[0];
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
    const voters = this.players.filter((p) => p.connected);
    if (voters.every((p) => c.votes[p.id] !== undefined)) this.resolve();
    else this.changed();
    return true;
  }

  /** Spend a Lucky Dice reroll on the open choice. */
  reroll(playerId: string): boolean {
    const c = this.hs.choice;
    if (!c || this.hs.rerolls <= 0 || !this.players.some((p) => p.id === playerId)) return false;
    this.hs.rerolls--;
    this.rerollsUsed++;
    c.options = c.kind === 'route' ? this.routeOptions() : this.trinketOptions();
    if (!c.options.length) {
      this.hs.choice = null;
      this.advance();
      return true;
    }
    c.votes = {};
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
    const tally = new Map<number, number>();
    for (const v of Object.values(c.votes)) tally.set(v, (tally.get(v) ?? 0) + 1);
    let pick = 0;
    if (tally.size) {
      const best = Math.max(...tally.values());
      const tied = [...tally.entries()].filter(([, n]) => n === best).map(([i]) => i);
      // Tie: the option that got its first vote earliest.
      pick = this.voteOrder.map((p) => c.votes[p]).find((v) => tied.includes(v)) ?? tied[0];
    }
    const opt = c.options[pick];
    this.hs.choice = null;
    if (c.kind === 'trinket' && opt.trinket) this.addTrinket(opt.trinket);
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
