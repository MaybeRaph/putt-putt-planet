import { DT, RULES, SNAPSHOT_RATE, TICK_RATE } from '../config';
import { Match, type GameMode, type MatchEvent } from '../match/Match';
import { applyRun, buildRunSummary, worldUnlocked } from '../progression';
import { dailyCourse } from '../daily';
import { filterChat, type C2SMsg, type RoomState, type S2CMsg } from '../protocol';
import { getCourse } from '../courses/index';
import { sanitizeLoadout, type Loadout } from '../cosmetics';
import type { Profile } from '../profile';
import type { Course } from '../schema';
import { randomToken } from './util';
import { HopperMatch } from '../hopper/HopperMatch';
import { hopperCourse } from '../hopper/generate';
import { applyHopperRun } from '../hopper/rewards';
import type { Conn, Lobby } from './Lobby';

/** Events after which clients need a fresh scorecard. */
const SCORE_EVENTS = new Set<MatchEvent['type']>([
  'shot',
  'penalty',
  'entrantDone',
  'holeStart',
  'turn',
  'holeComplete',
  'rescueOffered',
  'rest',
  'stuck',
  'collected',
  'strokeLimit',
  'courseComplete',
  'note',
  'hopper',
]);
const PHASE_CODE = { rest: 0, moving: 1, sinking: 2, holed: 3 } as const;

export interface Member {
  id: string;
  name: string;
  conn: Conn | null;
  ready: boolean;
  token: string;
  ping: number;
  level: number;
  loadout: Loadout;
  lastShotAt: number;
  chatTimes: number[];
  disconnectedAt: number | null;
}

/**
 * One room = up to 4 players + (while playing) an authoritative Match stepped at 60 Hz.
 * Clients send intents (shots); the room validates, simulates and streams snapshots at 20 Hz.
 */
export class Room {
  readonly members = new Map<string, Member>();
  hostId = '';
  phase: 'lobby' | 'playing' = 'lobby';
  courseId = 'meadow';
  mode: GameMode = 'parallel';
  chaos = false;
  match: Match | null = null;
  course: Course | null = null;
  private loop: { stop(): void } | null = null;
  private lastTime = 0;
  private acc = 0;
  private startedAt = 0;
  private snapEvery = Math.round(TICK_RATE / SNAPSHOT_RATE);
  private roomBroadcastAt = 0;
  /** Monotonic tick across holes (clients sync their clock to it). */
  private st = 0;

  constructor(
    readonly code: string,
    private readonly lobby: Lobby,
    readonly daily: string | null = null,
  ) {
    if (daily) this.mode = 'daily';
  }

  // ------------------------------------------------------------------------------------------
  // Membership
  // ------------------------------------------------------------------------------------------

  get connectedCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.disconnectedAt === null) n++;
    return n;
  }

  join(conn: Conn): Member | string {
    if (this.members.has(conn.id!))
      return this.resume(this.members.get(conn.id!)!.token, conn) ?? 'Could not rejoin';
    if (this.phase !== 'lobby') return 'That game has already started';
    if (this.members.size >= RULES.maxPlayers) return 'Room is full';
    const p = conn.profile!;
    const m: Member = {
      id: p.id,
      name: p.name,
      conn,
      ready: false,
      token: randomToken(),
      ping: 0,
      level: p.level,
      loadout: sanitizeLoadout(p.loadout, new Set(p.owned)),
      lastShotAt: 0,
      chatTimes: [],
      disconnectedAt: null,
    };
    this.members.set(m.id, m);
    if (!this.hostId) this.hostId = m.id;
    conn.room = this;
    this.lobby.tokens.set(m.token, { code: this.code, playerId: m.id });
    this.send(m, { t: 'joined', code: this.code, token: m.token });
    this.broadcastRoom();
    return m;
  }

  /** Reattach a reconnecting client within the reconnect window. */
  resume(token: string, conn: Conn): Member | null {
    const m = [...this.members.values()].find((x) => x.token === token);
    if (!m || m.id !== conn.id) return null;
    if (m.conn && m.conn !== conn) m.conn.room = null;
    m.conn = conn;
    m.disconnectedAt = null;
    conn.room = this;
    this.match?.setConnected(m.id, true);
    this.send(m, { t: 'joined', code: this.code, token: m.token });
    this.broadcastRoom();
    if (this.phase === 'playing' && this.match) {
      this.sendMatchStart(m);
      this.send(m, { t: 'score', score: this.match.score() });
      this.sendSnapshot(m);
    }
    this.broadcastSys(`${m.name} reconnected`);
    return m;
  }

  /** Socket dropped: keep the seat for RULES.reconnectWindowSec. */
  disconnect(id: string): void {
    const m = this.members.get(id);
    if (!m) return;
    m.conn = null;
    m.disconnectedAt = Date.now();
    this.match?.setConnected(id, false);
    if (this.hostId === id) this.migrateHost();
    this.broadcastRoom();
    this.broadcastSys(`${m.name} disconnected`);
  }

  leave(id: string): void {
    const m = this.members.get(id);
    if (!m) return;
    if (m.conn) m.conn.room = null;
    this.members.delete(id);
    this.lobby.tokens.delete(m.token);
    this.match?.setConnected(id, false);
    if (this.hostId === id) this.migrateHost();
    if (this.members.size === 0) {
      this.close();
      return;
    }
    this.broadcastRoom();
    this.broadcastSys(`${m.name} left`);
  }

  private migrateHost(): void {
    const next =
      [...this.members.values()].find((m) => m.disconnectedAt === null) ?? [...this.members.values()][0];
    this.hostId = next?.id ?? '';
    if (next) this.broadcastSys(`${next.name} is now the host`);
  }

  /** Periodic housekeeping: expire seats, close empty rooms. */
  housekeeping(now: number): void {
    for (const m of [...this.members.values()])
      if (m.disconnectedAt !== null && now - m.disconnectedAt > RULES.reconnectWindowSec * 1000)
        this.leave(m.id);
    if (this.members.size && now - this.roomBroadcastAt > 3000) this.broadcastRoom();
  }

  close(): void {
    this.loop?.stop();
    this.loop = null;
    this.match?.dispose();
    this.match = null;
    for (const m of this.members.values()) {
      this.lobby.tokens.delete(m.token);
      if (m.conn) m.conn.room = null;
    }
    this.lobby.rooms.delete(this.code);
  }

  // ------------------------------------------------------------------------------------------
  // Messages
  // ------------------------------------------------------------------------------------------

  handle(conn: Conn, msg: C2SMsg): void {
    const m = this.members.get(conn.id!);
    if (!m) return;
    const isHost = m.id === this.hostId;
    switch (msg.t) {
      case 'ready':
        m.ready = msg.ready;
        this.broadcastRoom();
        break;
      case 'configure': {
        if (!isHost || this.phase !== 'lobby')
          return this.error(m, 'not_allowed', 'Only the host can change settings');
        const c = getCourse(msg.courseId);
        if (!c) return this.error(m, 'bad_course', 'Unknown course');
        if (conn.profile && !worldUnlocked(conn.profile, c.world))
          return this.error(m, 'locked', 'Host has not unlocked that world yet');
        this.courseId = c.id;
        this.mode = msg.mode;
        this.chaos = msg.chaos;
        this.broadcastRoom();
        break;
      }
      case 'start': {
        if (!isHost || this.phase !== 'lobby') return this.error(m, 'not_allowed', 'Only the host can start');
        const notReady = [...this.members.values()].filter(
          (x) => x.id !== this.hostId && x.disconnectedAt === null && !x.ready,
        );
        if (notReady.length)
          return this.error(
            m,
            'not_ready',
            `Waiting for ${notReady.map((x) => x.name).join(', ')} to ready up`,
          );
        this.startMatch();
        break;
      }
      case 'shot': {
        if (!this.match) return;
        const now = Date.now();
        if (now - m.lastShotAt < RULES.shotCooldown * 1000) return;
        // Server clamps and normalises: clients cannot exceed max power or send NaNs.
        const power = Math.min(1, Math.max(0, msg.power));
        if (this.match.shoot(m.id, msg.dir[0], msg.dir[1], power)) m.lastShotAt = now;
        break;
      }
      case 'reposition':
        this.match?.reposition(m.id);
        break;
      case 'hopperVote':
        if (this.match instanceof HopperMatch) {
          this.match.vote(m.id, msg.option);
          this.flushEvents();
        }
        break;
      case 'hopperReroll':
        if (this.match instanceof HopperMatch) {
          this.match.reroll(m.id);
          this.flushEvents();
        }
        break;
      case 'next':
        if (isHost || this.daily) this.match?.advance();
        break;
      case 'emote':
        this.broadcast({ t: 'emote', from: m.id, emote: msg.emote });
        break;
      case 'chat': {
        const now = Date.now();
        m.chatTimes = m.chatTimes.filter((t) => now - t < 5000);
        if (m.chatTimes.length >= RULES.chatRatePerSec * 5) return this.error(m, 'rate', 'Slow down!');
        m.chatTimes.push(now);
        const text = filterChat(msg.text);
        if (text) this.broadcast({ t: 'chat', from: m.id, name: m.name, text });
        break;
      }
      case 'loadout':
        m.loadout = sanitizeLoadout(msg.loadout, new Set(conn.profile?.owned ?? []));
        this.broadcastRoom();
        break;
      case 'debugTeleport':
        if (this.lobby.dev && this.match) {
          const e = this.match.entrantOf(m.id);
          if (e) this.match.sim.placeBall(e, msg.pos);
        }
        break;
      default:
        break;
    }
  }

  updateProfile(p: Profile): void {
    const m = this.members.get(p.id);
    if (!m) return;
    m.name = p.name;
    m.level = p.level;
    this.broadcastRoom();
  }

  // ------------------------------------------------------------------------------------------
  // Match
  // ------------------------------------------------------------------------------------------

  startMatch(): void {
    const players = [...this.members.values()]
      .filter((m) => m.disconnectedAt === null)
      .map((m) => ({ id: m.id, name: m.name }));
    if (this.mode === 'hopper' && !this.daily) {
      const host = this.members.get(this.hostId)?.conn?.profile;
      const match = new HopperMatch({
        seed: Math.floor(Math.random() * 2 ** 31),
        players,
        upgrades: host?.hopper.upgrades ?? {},
        keepsakes: [...this.members.values()].map((m) => m.conn?.profile?.hopper.keepsake),
      });
      this.match = match;
      this.course = hopperCourse(match.seed, match.cfg.holes);
    } else {
      const course = this.daily ? dailyCourse(this.daily) : getCourse(this.courseId);
      if (!course) return;
      this.course = course;
      this.match = new Match({
        mode: this.mode,
        holes: course.holes,
        players,
        chaos: this.chaos && this.mode !== 'relay',
      });
    }
    for (const m of this.members.values())
      if (!players.some((p) => p.id === m.id)) this.match.setConnected(m.id, false);
    this.match.startHole(0);
    this.phase = 'playing';
    this.startedAt = Date.now();
    for (const m of this.members.values()) this.sendMatchStart(m);
    this.flushEvents();
    this.broadcast({ t: 'score', score: this.match.score() });
    this.broadcastRoom();
    this.lastTime = performance.now();
    this.acc = 0;
    this.loop = this.lobby.interval(() => this.tick(), 1000 / TICK_RATE);
  }

  private sendMatchStart(m: Member): void {
    if (!this.match || !this.course) return;
    this.send(m, {
      t: 'matchStart',
      courseId: this.course.id,
      daily: this.daily,
      mode: this.mode,
      chaos: !!this.match.cfg.chaos,
      players: this.match.players.map((p) => ({ id: p.id, name: p.name })),
      holeIndex: this.match.holeIndex,
      tick: this.match.sim.tick,
      st: this.st,
      hopper:
        this.match instanceof HopperMatch
          ? { seed: this.match.seed, stages: this.match.hs.stages }
          : undefined,
    });
  }

  private tick(): void {
    const match = this.match;
    if (!match) return;
    const now = performance.now();
    this.acc += Math.min(0.25, (now - this.lastTime) / 1000);
    this.lastTime = now;
    let steps = 0;
    while (this.acc >= DT && steps < 8) {
      this.acc -= DT;
      steps++;
      match.step();
      this.st++;
      this.flushEvents();
      if (this.st % this.snapEvery === 0) this.broadcastSnapshot();
      if (match.phase === 'courseEnd') {
        this.endMatch();
        return;
      }
    }
  }

  private flushEvents(): void {
    const match = this.match!;
    const events = match.events.splice(0);
    if (!events.length) return;
    this.broadcast({ t: 'ev', hole: match.holeIndex, tick: match.sim.tick, st: this.st, events });
    if (events.some((e) => SCORE_EVENTS.has(e.type))) this.broadcast({ t: 'score', score: match.score() });
  }

  private snapshotMsg(): S2CMsg {
    const match = this.match!;
    return {
      t: 'snap',
      hole: match.holeIndex,
      tick: match.sim.tick,
      st: this.st,
      balls: match
        .balls()
        .map((b) => [
          b.id,
          r3(b.pos[0]),
          r3(b.pos[1]),
          r3(b.pos[2]),
          r3(b.vel[0]),
          r3(b.vel[1]),
          r3(b.vel[2]),
          PHASE_CODE[b.phase],
        ]),
    };
  }

  private broadcastSnapshot(): void {
    this.broadcast(this.snapshotMsg());
  }

  private sendSnapshot(m: Member): void {
    this.send(m, this.snapshotMsg());
  }

  /** Course complete: apply rewards server-side (authoritative) and return to the lobby. */
  private endMatch(): void {
    const match = this.match!;
    const course = this.course!;
    this.loop?.stop();
    this.loop = null;
    const score = match.score();
    this.broadcast({ t: 'matchEnd', score });
    const playtime = (Date.now() - this.startedAt) / 1000;
    for (const m of this.members.values()) {
      if (!match.players.some((p) => p.id === m.id)) continue;
      const stored = this.lobby.profiles.get(m.id) ?? m.conn?.profile;
      if (!stored) continue;
      const run = buildRunSummary(match, m.id, course.id, playtime, this.daily ?? undefined);
      const { profile, grant } =
        match instanceof HopperMatch
          ? applyHopperRun(stored, match, m.id, playtime)
          : applyRun(stored, run, this.daily ? null : course);
      this.lobby.profiles.put(profile);
      if (m.conn) {
        m.conn.profile = profile;
        this.send(m, { t: 'rewards', profile, grant });
      }
      if (this.daily && run.completed) {
        this.lobby.board.submit(this.daily, { id: m.id, name: m.name, strokes: run.individualStrokes });
        if (m.conn) this.lobby.sendBoard(m.conn);
      }
      m.level = profile.level;
      m.ready = false;
    }
    match.dispose();
    this.match = null;
    this.phase = 'lobby';
    if (this.daily) {
      this.close();
      return;
    }
    this.broadcastRoom();
  }

  // ------------------------------------------------------------------------------------------
  // Output
  // ------------------------------------------------------------------------------------------

  state(): RoomState {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      courseId: this.courseId,
      mode: this.mode,
      chaos: this.chaos,
      players: [...this.members.values()].map((m) => ({
        id: m.id,
        name: m.name,
        ready: m.ready,
        connected: m.disconnectedAt === null,
        ping: Math.round(m.ping),
        level: m.level,
        loadout: m.loadout,
      })),
    };
  }

  setPing(id: string, rtt: number): void {
    const m = this.members.get(id);
    if (m) m.ping = Math.max(0, Math.min(5000, rtt));
  }

  broadcastRoom(): void {
    this.roomBroadcastAt = Date.now();
    this.broadcast({ t: 'room', room: this.state() });
  }

  private broadcastSys(text: string): void {
    this.broadcast({ t: 'chat', from: 'system', name: '⛳', text });
  }

  broadcast(msg: S2CMsg): void {
    const data = JSON.stringify(msg);
    for (const m of this.members.values()) m.conn?.sendRaw(data);
  }

  send(m: Member, msg: S2CMsg): void {
    m.conn?.sendRaw(JSON.stringify(msg));
  }

  private error(m: Member, code: string, message: string): void {
    this.send(m, { t: 'error', code, message });
  }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
