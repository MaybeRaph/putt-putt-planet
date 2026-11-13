import {
  DT,
  NET,
  PHASES,
  DEFAULT_LOADOUT,
  sanitizeLoadout,
  syncHopperHoles,
  type BallPhase,
  type Course,
  type GameMode,
  type MatchEvent,
  type RoomState,
  type S2CMsg,
  type ScoreState,
  type Vec3,
} from '@ppp/shared';
import { EventBus } from '../core/EventBus';
import type { RenderBall, Session, SessionEvents, SessionPlayer } from '../core/Session';
import type { NetClient } from './NetClient';

interface Snap {
  st: number;
  tick: number;
  hole: number;
  balls: Map<string, { pos: Vec3; vel: Vec3; phase: BallPhase }>;
}

const MS_PER_TICK = DT * 1000;

/**
 * Mirrors an authoritative server match.
 *  - Clock: tracks the server's monotonic tick from snapshot arrival times (earliest-arrival
 *    filter) and renders `interp` ticks in the past, adapting to measured jitter.
 *  - Balls: interpolated between the two snapshots around render time (brief extrapolation if
 *    starved), snapping on teleports/resets.
 *  - Events: queued and released when render time reaches their tick, so sounds and particles
 *    line up with what is on screen.
 */
export class RemoteSession implements Session {
  readonly kind = 'remote' as const;
  readonly bus = new EventBus<SessionEvents>();
  timeScale = 1;
  holeIndex: number;
  private snaps: Snap[] = [];
  private evQueue: { st: number; hole: number; events: MatchEvent[] }[] = [];
  private offset: number | null = null; // serverTick - localTick
  private jitter = 0;
  private scoreState: ScoreState;
  private room: RoomState | null = null;
  private pendingShotUntil = 0;
  private ended: ScoreState | null = null;
  private unsub: () => void;
  private items: Set<string>;
  private holeBaseSt = 0; // st at which the current hole's tick 0 happened
  private renderSt = 0;
  private readonly playersFallback: SessionPlayer[];

  constructor(
    private readonly net: NetClient,
    readonly course: Course,
    readonly mode: GameMode,
    readonly localPlayerId: string,
    start: Extract<S2CMsg, { t: 'matchStart' }>,
    room: RoomState | null,
  ) {
    this.holeIndex = start.holeIndex;
    this.room = room;
    this.holeBaseSt = start.st - start.tick;
    this.playersFallback = start.players.map((p) => ({
      id: p.id,
      name: p.name,
      loadout: DEFAULT_LOADOUT,
      connected: true,
    }));
    this.scoreState = {
      mode,
      holeIndex: start.holeIndex,
      phase: 'playing',
      pars: course.holes.map((h) => h.par),
      entrants: mode === 'relay' ? ['team'] : start.players.map((p) => p.id),
      card: {},
      strokesThisHole: {},
      done: {},
      turn: null,
      rescue: [],
      collected: [],
    };
    this.items = this.itemsForHole();
    this.unsub = net.bus.on('msg', (m) => this.onMsg(m));
  }

  private itemsForHole(): Set<string> {
    const taken = new Set(this.scoreState.collected.map((c) => c.item));
    return new Set(
      this.course.holes[this.holeIndex].collectibles.filter((c) => !taken.has(c.id)).map((c) => c.id),
    );
  }

  private nowTicks(): number {
    return performance.now() / MS_PER_TICK;
  }

  private onMsg(m: S2CMsg): void {
    switch (m.t) {
      case 'snap': {
        const sample = m.st - this.nowTicks();
        if (this.offset === null || sample > this.offset + 30 || sample < this.offset - 60)
          this.offset = sample;
        else {
          // Earliest-arrival tracking with slow decay; jitter = mean deviation.
          this.jitter = this.jitter * 0.95 + Math.abs(sample - this.offset) * 0.05;
          this.offset = Math.max(sample, this.offset - 0.02);
        }
        const balls = new Map<string, { pos: Vec3; vel: Vec3; phase: BallPhase }>();
        for (const b of m.balls)
          balls.set(b[0], { pos: [b[1], b[2], b[3]], vel: [b[4], b[5], b[6]], phase: PHASES[b[7]] });
        this.snaps.push({ st: m.st, tick: m.tick, hole: m.hole, balls });
        if (this.snaps.length > 60) this.snaps.splice(0, this.snaps.length - 60);
        if (performance.now() > this.pendingShotUntil - 400) {
          const mine = balls.get(this.myEntrant());
          if (mine && mine.phase !== 'rest') this.pendingShotUntil = 0;
        }
        break;
      }
      case 'ev':
        this.evQueue.push({ st: m.st, hole: m.hole, events: m.events });
        break;
      case 'score':
        this.syncHopper(m.score);
        this.scoreState = m.score;
        break;
      case 'matchEnd':
        this.syncHopper(m.score);
        this.scoreState = m.score;
        this.ended = m.score;
        break;
      case 'room':
        this.room = m.room;
        this.bus.emit('players', this.players());
        break;
      case 'emote':
        this.bus.emit('emote', { from: m.from, emote: m.emote });
        break;
      case 'chat':
        this.bus.emit('chat', { from: m.from, name: m.name, text: m.text });
        break;
      case 'matchStart':
        // Resumed after a reconnect: realign the clock and hole.
        this.offset = null;
        this.holeBaseSt = m.st - m.tick;
        if (m.holeIndex !== this.holeIndex) {
          this.holeIndex = m.holeIndex;
          this.snaps = [];
          this.evQueue = [];
          this.items = this.itemsForHole();
          this.bus.emit('match', { type: 'holeStart', hole: m.holeIndex });
        }
        break;
      case 'error':
        if (m.code === 'replaced') this.bus.emit('disconnected', { reason: 'Signed in from another tab' });
        break;
      default:
        break;
    }
  }

  private interpTicks(): number {
    return NET.interpDelayMs / MS_PER_TICK + Math.min(12, this.jitter * 2.5);
  }

  update(_dt: number): void {
    if (this.offset === null) return;
    this.renderSt = this.nowTicks() + this.offset - this.interpTicks();
    // Release events whose time has come (or that are badly behind).
    while (this.evQueue.length && (this.evQueue[0].st <= this.renderSt || this.evQueue.length > 40)) {
      const batch = this.evQueue.shift()!;
      for (const ev of batch.events) {
        if (ev.type === 'holeStart') {
          this.holeIndex = ev.hole;
          this.holeBaseSt = batch.st;
          this.snaps = this.snaps.filter((s) => s.hole === ev.hole);
          this.items = this.itemsForHole();
        }
        if (ev.type === 'collected') this.items.delete(ev.item);
        this.bus.emit('match', ev);
      }
    }
    if (this.ended && !this.evQueue.length) {
      const s = this.ended;
      this.ended = null;
      this.bus.emit('courseEnd', { score: s });
    }
  }

  renderBalls(): RenderBall[] {
    const snaps = this.snaps.filter((s) => s.hole === this.holeIndex);
    if (!snaps.length) return [];
    const rt = this.renderSt;
    let i = snaps.findIndex((s) => s.st > rt);
    if (i === -1) i = snaps.length; // starved: extrapolate from the newest
    const a = snaps[Math.max(0, i - 1)];
    const b = snaps[Math.min(snaps.length - 1, i)];
    const out: RenderBall[] = [];
    for (const [id, A] of a.balls) {
      const B = b.balls.get(id) ?? A;
      let pos: Vec3;
      let phase = A.phase;
      if (a === b) {
        // extrapolate up to 6 ticks (100 ms) along velocity
        const dtx = Math.min(6, Math.max(0, rt - a.st)) * DT;
        pos =
          A.phase === 'moving'
            ? [A.pos[0] + A.vel[0] * dtx, A.pos[1] + A.vel[1] * dtx, A.pos[2] + A.vel[2] * dtx]
            : A.pos;
      } else {
        const k = Math.min(1, Math.max(0, (rt - a.st) / (b.st - a.st)));
        const jump = Math.hypot(B.pos[0] - A.pos[0], B.pos[1] - A.pos[1], B.pos[2] - A.pos[2]) > 1.5;
        pos = jump
          ? k < 0.5
            ? A.pos
            : B.pos
          : [
              A.pos[0] + (B.pos[0] - A.pos[0]) * k,
              A.pos[1] + (B.pos[1] - A.pos[1]) * k,
              A.pos[2] + (B.pos[2] - A.pos[2]) * k,
            ];
        if (k >= 0.5) phase = B.phase;
      }
      out.push({ id, pos, vel: A.vel, phase });
    }
    return out;
  }

  obstacleTime(): number {
    return Math.max(0, this.renderSt - this.holeBaseSt) * DT;
  }

  activeItems(): Set<string> {
    return this.items;
  }

  score(): ScoreState {
    return this.scoreState;
  }

  players(): SessionPlayer[] {
    if (!this.room) return this.playersFallback;
    return this.room.players.map((p) => ({
      id: p.id,
      name: p.name,
      loadout: sanitizeLoadout(p.loadout),
      connected: p.connected,
      // My own link is measured here every couple of seconds; others' come with the room state.
      ping: p.id === this.localPlayerId && this.net.status === 'online' ? Math.round(this.net.rtt) : p.ping,
      isHost: p.id === this.room!.hostId,
      level: p.level,
    }));
  }

  myEntrant(): string {
    return this.mode === 'relay' ? 'team' : this.localPlayerId;
  }

  canShoot(): boolean {
    const s = this.scoreState;
    if (s.phase !== 'playing' || s.holeIndex !== this.holeIndex) return false;
    const e = this.myEntrant();
    if (s.done[e]) return false;
    if (this.mode === 'relay' && s.turn !== this.localPlayerId) return false;
    if (performance.now() < this.pendingShotUntil) return false;
    const latest = this.snaps[this.snaps.length - 1];
    const ball = latest?.hole === this.holeIndex ? latest.balls.get(e) : undefined;
    return ball?.phase === 'rest';
  }

  shoot(dirX: number, dirZ: number, power: number): void {
    this.pendingShotUntil = performance.now() + 1500;
    this.net.send({ t: 'shot', seq: Date.now() % 1e9, dir: [dirX, dirZ], power });
  }

  reposition(): void {
    this.net.send({ t: 'reposition' });
  }

  advance(): void {
    this.net.send({ t: 'next' });
  }

  hopperVote(option: number): void {
    this.net.send({ t: 'hopperVote', option });
  }

  hopperReroll(): void {
    this.net.send({ t: 'hopperReroll' });
  }

  /** Planet Hopper: build holes for stages the host has generated (deterministic from the seed). */
  private syncHopper(score: ScoreState): void {
    if (score.hopper) {
      syncHopperHoles(this.course, score.hopper.seed, score.hopper.stages);
      this.scoreState.pars = this.course.holes.map((h) => h.par);
    }
  }

  debugTeleport(pos: Vec3): void {
    this.net.send({ t: 'debugTeleport', pos });
  }

  sendEmote(id: string): void {
    this.net.send({ t: 'emote', emote: id });
  }

  sendChat(text: string): void {
    this.net.send({ t: 'chat', text });
  }

  netStats(): Record<string, string | number> {
    const latest = this.snaps[this.snaps.length - 1];
    return {
      rtt: `${Math.round(this.net.rtt)} ms`,
      'interp delay': `${Math.round(this.interpTicks() * MS_PER_TICK)} ms`,
      jitter: `${(this.jitter * MS_PER_TICK).toFixed(1)} ms`,
      'snap buffer': `${latest ? (latest.st - this.renderSt).toFixed(1) : '-'} ticks ahead`,
      'snaps in/dropped': `${this.net.stats.snapsIn}/${this.net.stats.snapsDropped}`,
      'net sim': this.net.simulated,
    };
  }

  dispose(): void {
    this.unsub();
    this.bus.clear();
  }
}
