import { DT, PHYSICS, RULES } from '../config';
import type { CollectibleKind, Hole, Vec3 } from '../schema';
import { progressAlong } from '../math';
import { Simulation, type BallState, type SimEvent } from '../sim/Simulation';
import type { HopperState } from '../hopper/defs';

export type GameMode = 'solo' | 'relay' | 'parallel' | 'versus' | 'daily' | 'hopper';

export const MODE_INFO: Record<GameMode, { label: string; desc: string; online: boolean }> = {
  solo: { label: 'Solo', desc: 'Just you and the course.', online: false },
  relay: { label: 'Co-op Relay', desc: 'One ball, take turns. Beat par as a team.', online: true },
  parallel: {
    label: 'Co-op Parallel',
    desc: 'Everyone plays at once. Team score is the total.',
    online: true,
  },
  versus: { label: 'Casual Versus', desc: 'Everyone plays at once. Lowest score wins.', online: true },
  daily: { label: 'Daily Challenge', desc: 'One seeded hole, one global leaderboard.', online: false },
  hopper: {
    label: 'Planet Hopper',
    desc: 'Roguelike run: endless new holes, shared hearts, trinkets and omens.',
    online: true,
  },
};

export interface MatchPlayer {
  id: string;
  name: string;
  connected: boolean;
}

export interface MatchConfig {
  mode: GameMode;
  holes: Hole[];
  players: { id: string; name: string }[];
  chaos?: boolean;
  /** Seconds between hole end and next hole (0 = wait for advance()). */
  holeEndDelay?: number;
}

/** Per entrant per hole. */
export interface HoleResult {
  strokes: number;
  par: number;
  holeInOne: boolean;
  penalties: number;
  pickedUp: boolean;
  /** Wall/bumper contacts on the stroke that sank the ball (for "Bank Shot"). */
  bankContacts: number;
}

export interface CollectedItem {
  item: string;
  kind: CollectibleKind;
  hole: number;
  by: string; // player id
}

export type MatchEvent =
  | (SimEvent & { entrant: string })
  | { type: 'holeStart'; hole: number }
  | { type: 'turn'; player: string }
  | { type: 'penalty'; entrant: string; reason: 'water' | 'oob' }
  | { type: 'strokeLimit'; entrant: string }
  | { type: 'entrantDone'; entrant: string; strokes: number; par: number }
  | { type: 'collected'; item: string; kind: CollectibleKind; by: string }
  | { type: 'rescueOffered'; entrant: string }
  | { type: 'holeComplete'; hole: number }
  | { type: 'note'; text: string; tone: 'good' | 'bad' | 'info' | 'epic' }
  | { type: 'hopper' }
  | { type: 'courseComplete' };

export interface ScoreState {
  mode: GameMode;
  holeIndex: number;
  phase: MatchPhase;
  pars: number[];
  entrants: string[];
  /** entrant -> strokes per hole (null = not played yet). */
  card: Record<string, (number | null)[]>;
  strokesThisHole: Record<string, number>;
  done: Record<string, boolean>;
  turn: string | null;
  rescue: string[];
  collected: CollectedItem[];
  /** Planet Hopper run state (hopper mode only). */
  hopper?: HopperState;
}

export type MatchPhase = 'playing' | 'holeEnd' | 'courseEnd';

export class Match {
  readonly cfg: MatchConfig;
  readonly players: MatchPlayer[];
  readonly entrants: string[];
  sim!: Simulation;
  holeIndex = -1;
  phase: MatchPhase = 'playing';
  turnIndex = 0;
  turn: string | null = null;
  readonly card: Record<string, (number | null)[]> = {};
  readonly results: Record<string, HoleResult[]> = {};
  strokes: Record<string, number> = {};
  done: Record<string, boolean> = {};
  rescue = new Set<string>();
  readonly collected: CollectedItem[] = [];
  readonly events: MatchEvent[] = [];
  /** player id -> number of shots taken (for stats in relay). */
  readonly shotsBy: Record<string, number> = {};
  protected holeEndTimer = 0;
  protected lastShooter: Record<string, string> = {};
  protected bankContacts: Record<string, number> = {};
  protected penalties: Record<string, number> = {};

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    this.players = cfg.players.map((p) => ({ ...p, connected: true }));
    this.entrants = cfg.mode === 'relay' ? ['team'] : cfg.players.map((p) => p.id);
    for (const e of this.entrants) {
      this.card[e] = cfg.holes.map(() => null);
      this.results[e] = [];
    }
    for (const p of this.players) this.shotsBy[p.id] = 0;
  }

  get hole(): Hole {
    return this.cfg.holes[this.holeIndex];
  }

  entrantOf(playerId: string): string | null {
    if (!this.players.some((p) => p.id === playerId)) return null;
    return this.cfg.mode === 'relay' ? 'team' : playerId;
  }

  strokeLimit(): number {
    return this.hole.par + RULES.strokeLimitOverPar;
  }

  startHole(index: number): void {
    this.sim?.dispose();
    this.holeIndex = index;
    this.phase = 'playing';
    const collectedIds = new Set(this.collected.map((c) => c.item));
    const hole = this.cfg.holes[index];
    this.sim = new Simulation(hole, {
      ballsCollide: !!this.cfg.chaos && this.entrants.length > 1,
      activeCollectibles: hole.collectibles.filter((c) => !collectedIds.has(c.id)).map((c) => c.id),
    });
    this.strokes = {};
    this.done = {};
    this.rescue.clear();
    this.bankContacts = {};
    this.penalties = {};
    for (const e of this.entrants) {
      this.sim.addBall(e);
      this.strokes[e] = 0;
      this.done[e] = false;
      this.penalties[e] = 0;
      this.bankContacts[e] = 0;
    }
    this.events.push({ type: 'holeStart', hole: index });
    if (this.cfg.mode === 'relay') {
      this.turnIndex = index % this.players.length;
      this.turnIndex = this.nextConnectedIndex(this.turnIndex - 1);
      this.turn = this.players[this.turnIndex]?.id ?? null;
      if (this.turn) this.events.push({ type: 'turn', player: this.turn });
    } else {
      this.turn = null;
    }
  }

  private nextConnectedIndex(from: number): number {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + k) % n) + n) % n;
      if (this.players[i].connected) return i;
    }
    return (((from + 1) % n) + n) % n;
  }

  canShoot(playerId: string): boolean {
    if (this.phase !== 'playing') return false;
    const e = this.entrantOf(playerId);
    if (!e || this.done[e]) return false;
    if (this.cfg.mode === 'relay' && this.turn !== playerId) return false;
    return this.sim.getBall(e)?.phase === 'rest';
  }

  shoot(playerId: string, dirX: number, dirZ: number, power: number): boolean {
    if (!this.canShoot(playerId)) return false;
    const e = this.entrantOf(playerId)!;
    if (!this.sim.shoot(e, dirX, dirZ, power)) return false;
    this.strokes[e]++;
    this.shotsBy[playerId] = (this.shotsBy[playerId] ?? 0) + 1;
    this.lastShooter[e] = playerId;
    this.bankContacts[e] = 0;
    this.rescue.delete(e);
    return true;
  }

  /** Free reposition onto the authored path when the ball got stuck. */
  reposition(playerId: string): boolean {
    const e = this.entrantOf(playerId);
    if (!e || !this.rescue.has(e)) return false;
    const ball = this.sim.getBall(e);
    if (!ball || ball.phase !== 'rest') return false;
    this.sim.placeBall(e, rescuePoint(this.hole.path, ball.pos));
    this.rescue.delete(e);
    return true;
  }

  setConnected(playerId: string, connected: boolean): void {
    const p = this.players.find((x) => x.id === playerId);
    if (!p) return;
    p.connected = connected;
    if (
      this.cfg.mode === 'relay' &&
      !connected &&
      this.turn === playerId &&
      this.sim.getBall('team')?.phase === 'rest'
    ) {
      this.advanceTurn();
    }
    if (this.cfg.mode === 'relay' && connected && this.turn === null) this.advanceTurn();
  }

  private advanceTurn(): void {
    if (this.cfg.mode !== 'relay') return;
    if (!this.players.some((p) => p.connected)) {
      this.turn = null;
      return;
    }
    this.turnIndex = this.nextConnectedIndex(this.turnIndex);
    this.turn = this.players[this.turnIndex].id;
    this.events.push({ type: 'turn', player: this.turn });
  }

  step(): void {
    if (this.phase === 'courseEnd') return;
    if (this.phase === 'holeEnd') {
      this.sim.step();
      this.drainSim();
      if (this.cfg.holeEndDelay !== 0) {
        this.holeEndTimer -= DT;
        if (this.holeEndTimer <= 0) this.advance();
      }
      return;
    }
    this.sim.step();
    this.drainSim();
    this.checkHoleEnd();
  }

  private drainSim(): void {
    for (const ev of this.sim.events.splice(0)) {
      const e = ev.ball;
      this.events.push({ ...ev, entrant: e });
      switch (ev.type) {
        case 'wall':
        case 'bumper':
          this.bankContacts[e] = (this.bankContacts[e] ?? 0) + 1;
          break;
        case 'water':
        case 'oob':
          {
            const pen = this.hazardPenalty(e);
            this.strokes[e] += pen;
            this.penalties[e] += pen;
            if (pen) this.events.push({ type: 'penalty', entrant: e, reason: ev.type });
          }
          this.afterBallStopped(e);
          break;
        case 'rest':
          if (this.restCountsAsHoled(e)) this.finishEntrant(e, false, 1);
          else this.afterBallStopped(e);
          break;
        case 'stuck':
          this.rescue.add(e);
          this.events.push({ type: 'rescueOffered', entrant: e });
          this.afterBallStopped(e);
          break;
        case 'holed':
          this.finishEntrant(e, false);
          break;
        case 'collect': {
          const c = this.hole.collectibles.find((x) => x.id === ev.item);
          if (c) {
            const by = this.lastShooter[e] ?? (this.cfg.mode === 'relay' ? this.players[0].id : e);
            this.collected.push({ item: c.id, kind: c.kind, hole: this.holeIndex, by });
            this.events.push({ type: 'collected', item: c.id, kind: c.kind, by });
            this.onCollected(c.id, c.kind, by);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  protected afterBallStopped(e: string): void {
    if (this.done[e] || this.phase !== 'playing') return;
    if (this.strokes[e] >= this.strokeLimit()) {
      this.sim.pickUp(e);
      this.events.push({ type: 'strokeLimit', entrant: e });
      this.finishEntrant(e, true);
      return;
    }
    if (this.cfg.mode === 'relay') this.advanceTurn();
  }

  /** Hooks for rule variants (Planet Hopper trinkets/omens). */
  protected hazardPenalty(_e: string): number {
    return RULES.hazardPenalty;
  }
  /** A ball came to rest: return true to count it as holed ("gimme"). */
  protected restCountsAsHoled(_e: string): boolean {
    return false;
  }
  /** Final stroke count for an entrant that holed out. */
  protected holedStrokes(_e: string, strokes: number): number {
    return strokes;
  }
  protected onCollected(_item: string, _kind: CollectibleKind, _by: string): void {}
  /** Called once when every entrant is done, before the holeComplete event. */
  protected onHoleComplete(): void {}

  protected finishEntrant(e: string, pickedUp: boolean, extraStrokes = 0): void {
    if (this.done[e]) return;
    this.done[e] = true;
    if (extraStrokes) {
      this.strokes[e] += extraStrokes;
      this.sim.pickUp(e);
      this.events.push({ type: 'holed', ball: e, entrant: e });
    }
    const strokes = pickedUp
      ? this.strokeLimit()
      : Math.max(1, this.holedStrokes(e, this.strokes[e]));
    this.strokes[e] = strokes;
    this.card[e][this.holeIndex] = strokes;
    this.results[e][this.holeIndex] = {
      strokes,
      par: this.hole.par,
      holeInOne: !pickedUp && strokes === 1,
      penalties: this.penalties[e],
      pickedUp,
      bankContacts: pickedUp ? 0 : this.bankContacts[e],
    };
    this.events.push({ type: 'entrantDone', entrant: e, strokes, par: this.hole.par });
  }

  protected checkHoleEnd(): void {
    const activeEntrants = this.entrants.filter((e) => this.isEntrantActive(e));
    if (activeEntrants.length === 0) return; // everyone disconnected: wait
    if (!activeEntrants.every((e) => this.done[e])) return;
    // Entrants that are disconnected and unfinished get the stroke limit.
    for (const e of this.entrants)
      if (!this.done[e]) {
        this.sim.pickUp(e);
        this.finishEntrant(e, true);
      }
    this.phase = 'holeEnd';
    this.holeEndTimer = this.cfg.holeEndDelay ?? RULES.holeEndDelay;
    this.onHoleComplete();
    this.events.push({ type: 'holeComplete', hole: this.holeIndex });
  }

  private isEntrantActive(e: string): boolean {
    if (e === 'team') return this.players.some((p) => p.connected);
    return this.players.find((p) => p.id === e)?.connected ?? false;
  }

  /** Move to the next hole, or finish the course. */
  advance(): void {
    if (this.phase !== 'holeEnd') return;
    if (this.holeIndex + 1 < this.cfg.holes.length) {
      this.startHole(this.holeIndex + 1);
    } else {
      this.phase = 'courseEnd';
      this.events.push({ type: 'courseComplete' });
    }
  }

  balls(): BallState[] {
    return this.sim.ballIds().map((id) => this.sim.getBall(id)!);
  }

  score(): ScoreState {
    return {
      mode: this.cfg.mode,
      holeIndex: this.holeIndex,
      phase: this.phase,
      pars: this.cfg.holes.map((h) => h.par),
      entrants: this.entrants,
      card: structuredClone(this.card),
      strokesThisHole: { ...this.strokes },
      done: { ...this.done },
      turn: this.turn,
      rescue: [...this.rescue],
      collected: [...this.collected],
    };
  }

  dispose(): void {
    this.sim?.dispose();
  }
}

/** Closest point on the authored path, slightly ahead, resting on it. */
export function rescuePoint(path: Vec3[], from: Vec3): Vec3 {
  const { along } = progressAlong(path, from);
  let acc = 0;
  const target = Math.max(0, along);
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i],
      b = path[i + 1];
    const l = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (acc + l >= target || i === path.length - 2) {
      const t = l > 0 ? Math.min(1, (target - acc) / l) : 0;
      return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t + PHYSICS.ballRadius + 0.02,
        a[2] + (b[2] - a[2]) * t,
      ];
    }
    acc += l;
  }
  const last = path[path.length - 1];
  return [last[0], last[1] + PHYSICS.ballRadius + 0.02, last[2]];
}
