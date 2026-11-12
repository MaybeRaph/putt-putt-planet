import type { BallPhase, Course, GameMode, Loadout, MatchEvent, ScoreState, Vec3 } from '@ppp/shared';
import type { EventBus } from './EventBus';

/** Ball state ready for rendering (already interpolated). */
export interface RenderBall {
  id: string;
  pos: Vec3;
  vel: Vec3;
  phase: BallPhase;
}

export interface SessionPlayer {
  id: string;
  name: string;
  loadout: Loadout;
  connected: boolean;
  ping?: number;
  isHost?: boolean;
  level?: number;
}

export interface CourseEndInfo {
  score: ScoreState;
}

export interface SessionEvents {
  match: MatchEvent;
  courseEnd: CourseEndInfo;
  chat: { from: string; name: string; text: string };
  emote: { from: string; emote: string };
  players: SessionPlayer[];
  disconnected: { reason: string };
}

/**
 * The Playing scene talks only to a Session. LocalSession runs the shared Match in the
 * browser (solo/offline); RemoteSession mirrors the authoritative server.
 */
export interface Session {
  readonly kind: 'local' | 'remote';
  readonly mode: GameMode;
  readonly course: Course;
  readonly localPlayerId: string;
  readonly bus: EventBus<SessionEvents>;
  readonly holeIndex: number;
  update(dt: number): void;
  renderBalls(): RenderBall[];
  /** Obstacle clock (seconds since hole start) for kinematic machinery. */
  obstacleTime(): number;
  activeItems(): Set<string>;
  score(): ScoreState;
  players(): SessionPlayer[];
  myEntrant(): string;
  canShoot(): boolean;
  shoot(dirX: number, dirZ: number, power: number): void;
  reposition(): void;
  /** Skip the hole-end wait (solo / host). */
  advance(): void;
  debugTeleport(pos: Vec3): void;
  sendEmote(id: string): void;
  sendChat(text: string): void;
  /** Planet Hopper: vote for a fork/trinket option, or spend a reroll. */
  hopperVote(option: number): void;
  hopperReroll(): void;
  /** Network stats for the debug overlay. */
  netStats(): Record<string, string | number>;
  timeScale: number;
  dispose(): void;
}
