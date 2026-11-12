import { DT, HopperMatch, Match, type Course, type GameMode, type Loadout, type ScoreState, type Vec3 } from '@ppp/shared';
import { EventBus } from '../core/EventBus';
import type { RenderBall, Session, SessionEvents, SessionPlayer } from '../core/Session';

/**
 * Runs the shared Match (rules + Rapier simulation) in the browser at a fixed 60 Hz step,
 * interpolating between the last two physics states for smooth rendering at any frame rate.
 */
export class LocalSession implements Session {
  readonly kind = 'local' as const;
  readonly bus = new EventBus<SessionEvents>();
  readonly match: Match;
  private acc = 0;
  private prev = new Map<string, Vec3>();
  private finished = false;
  timeScale = 1;
  private readonly player: SessionPlayer;

  constructor(
    readonly course: Course,
    readonly mode: GameMode,
    readonly localPlayerId: string,
    name: string,
    loadout: Loadout,
    holes = course.holes,
    startHole = 0,
    match?: Match,
  ) {
    this.player = { id: localPlayerId, name, loadout, connected: true, isHost: true };
    this.match = match ?? new Match({ mode, holes, players: [{ id: localPlayerId, name }] });
    this.match.startHole(Math.min(startHole, holes.length - 1));
    this.snapshotPrev();
  }

  get holeIndex(): number {
    return this.match.holeIndex;
  }

  private snapshotPrev(): void {
    this.prev.clear();
    for (const b of this.match.balls()) this.prev.set(b.id, [...b.pos]);
  }

  update(dt: number): void {
    this.acc += Math.min(dt, 0.1) * this.timeScale;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.snapshotPrev();
      this.match.step();
      for (const ev of this.match.events.splice(0)) {
        this.bus.emit('match', ev);
        if (ev.type === 'holeStart') this.snapshotPrev();
      }
      if (this.match.phase === 'courseEnd' && !this.finished) {
        this.finished = true;
        this.bus.emit('courseEnd', { score: this.match.score() });
      }
    }
  }

  renderBalls(): RenderBall[] {
    const alpha = this.acc / DT;
    return this.match.balls().map((b) => {
      const p = this.prev.get(b.id) ?? b.pos;
      const teleported = Math.hypot(b.pos[0] - p[0], b.pos[1] - p[1], b.pos[2] - p[2]) > 1.5;
      const pos: Vec3 = teleported
        ? [...b.pos]
        : [
            p[0] + (b.pos[0] - p[0]) * alpha,
            p[1] + (b.pos[1] - p[1]) * alpha,
            p[2] + (b.pos[2] - p[2]) * alpha,
          ];
      return { id: b.id, pos, vel: b.vel, phase: b.phase };
    });
  }

  obstacleTime(): number {
    return (this.match.sim.tick + this.acc / DT) * DT;
  }

  activeItems(): Set<string> {
    return new Set(this.match.sim.activeItems.keys());
  }

  score(): ScoreState {
    return this.match.score();
  }

  players(): SessionPlayer[] {
    return [this.player];
  }

  myEntrant(): string {
    return this.match.entrantOf(this.localPlayerId) ?? this.localPlayerId;
  }

  canShoot(): boolean {
    return this.match.canShoot(this.localPlayerId);
  }

  shoot(dirX: number, dirZ: number, power: number): void {
    this.match.shoot(this.localPlayerId, dirX, dirZ, power);
  }

  reposition(): void {
    this.match.reposition(this.localPlayerId);
  }

  advance(): void {
    this.match.advance();
  }

  debugTeleport(pos: Vec3): void {
    this.match.sim.placeBall(this.myEntrant(), pos);
    this.snapshotPrev();
  }

  sendEmote(id: string): void {
    this.bus.emit('emote', { from: this.localPlayerId, emote: id });
  }

  hopperVote(option: number): void {
    if (this.match instanceof HopperMatch) this.match.vote(this.localPlayerId, option);
    this.flush();
  }

  hopperReroll(): void {
    if (this.match instanceof HopperMatch) this.match.reroll(this.localPlayerId);
    this.flush();
  }

  /** Deliver events produced outside the fixed step (votes) right away. */
  private flush(): void {
    for (const ev of this.match.events.splice(0)) {
      this.bus.emit('match', ev);
      if (ev.type === 'holeStart') this.snapshotPrev();
    }
  }

  sendChat(text: string): void {
    this.bus.emit('chat', { from: this.localPlayerId, name: this.player.name, text });
  }

  netStats(): Record<string, string | number> {
    return { mode: 'local', tick: this.match.sim.tick };
  }

  dispose(): void {
    this.match.dispose();
    this.bus.clear();
  }
}
