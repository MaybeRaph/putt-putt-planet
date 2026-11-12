import { NET } from '../config';
import { dateKey, makeRoomCode } from '../rng';
import { dailyCourse } from '../daily';
import { parseC2S, sanitizeName, type S2CMsg } from '../protocol';
import type { Profile } from '../profile';
import { Room } from './Room';
import type { HostStorage } from './storage';

/** Repeating timer abstraction. */
export type Interval = (fn: () => void, ms: number) => { stop(): void };
const defaultInterval: Interval = (fn, ms) => {
  const h = setInterval(fn, ms);
  return { stop: () => clearInterval(h) };
};

/** One client connection (WebSocket, WebRTC data channel or in-process loopback). */
export interface Conn {
  id: string | null;
  profile: Profile | null;
  room: Room | null;
  sendRaw(data: string): void;
  close(code?: number, reason?: string): void;
  /** token-bucket rate limiter */
  bucket: number;
  lastRefill: number;
}

/**
 * Routes messages, owns rooms, reconnect tokens and persistence. Runs on the dedicated server
 * and, for direct (peer-to-peer) games, inside the hosting player's client.
 */
export class Lobby {
  readonly rooms = new Map<string, Room>();
  readonly tokens = new Map<string, { code: string; playerId: string }>();
  readonly online = new Map<string, Conn>();
  readonly profiles: HostStorage['profiles'];
  readonly board: HostStorage['board'];
  private readonly housekeeping: ReturnType<typeof setInterval>;
  /** Timer used for room ticks (a player hosting in a browser swaps in an unthrottled one). */
  readonly interval: Interval;

  /**
   * @param storage profile + daily-board persistence (JSON files on the server, memory in-game)
   * @param dev allow debug-only messages
   * @param opts.daily whether this host offers the daily challenge (dedicated server only)
   */
  constructor(
    storage: HostStorage,
    readonly dev: boolean,
    readonly opts: { daily?: boolean; interval?: Interval } = { daily: true },
  ) {
    this.interval = opts.interval ?? defaultInterval;
    this.profiles = storage.profiles;
    this.board = storage.board;
    this.housekeeping = setInterval(() => {
      const now = Date.now();
      for (const r of [...this.rooms.values()]) r.housekeeping(now);
    }, 1000);
  }

  send(conn: Conn, msg: S2CMsg): void {
    conn.sendRaw(JSON.stringify(msg));
  }

  private error(conn: Conn, code: string, message: string): void {
    this.send(conn, { t: 'error', code, message });
  }

  /** Returns false if the client should be dropped. */
  onMessage(conn: Conn, data: string): boolean {
    // Rate limit: refill NET.maxMessagesPerSec tokens per second, burst of the same size.
    const now = Date.now();
    conn.bucket = Math.min(
      NET.maxMessagesPerSec,
      conn.bucket + ((now - conn.lastRefill) / 1000) * NET.maxMessagesPerSec,
    );
    conn.lastRefill = now;
    if (conn.bucket < 1) return true; // silently drop
    conn.bucket -= 1;
    if (data.length > NET.maxMessageBytes) return false;

    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      return false;
    }
    const msg = parseC2S(raw);
    if (!msg) {
      this.error(conn, 'bad_message', 'Malformed message');
      return true;
    }

    if (msg.t === 'hello') {
      const incoming = { ...msg.profile, name: sanitizeName(msg.profile.name) };
      const prev = this.online.get(incoming.id);
      if (prev && prev !== conn) {
        this.send(prev, { t: 'error', code: 'replaced', message: 'Signed in from another tab' });
        prev.room?.disconnect(incoming.id);
        prev.room = null;
        prev.close(4000, 'replaced');
      }
      conn.id = incoming.id;
      conn.profile = this.profiles.merge(incoming);
      this.online.set(conn.id, conn);
      this.send(conn, { t: 'welcome', playerId: conn.id, profile: conn.profile, dev: this.dev });
      if (msg.token) this.tryResume(conn, msg.token);
      return true;
    }
    if (!conn.id || !conn.profile) {
      this.error(conn, 'no_hello', 'Say hello first');
      return true;
    }

    switch (msg.t) {
      case 'profile': {
        if (msg.profile.id !== conn.id) return true;
        conn.profile = this.profiles.merge({ ...msg.profile, name: sanitizeName(msg.profile.name) });
        conn.room?.updateProfile(conn.profile);
        this.send(conn, { t: 'profile', profile: conn.profile });
        return true;
      }
      case 'createRoom': {
        conn.room?.leave(conn.id);
        let code = makeRoomCode();
        while (this.rooms.has(code)) code = makeRoomCode();
        const room = new Room(code, this);
        this.rooms.set(code, room);
        room.join(conn);
        return true;
      }
      case 'joinRoom': {
        const room = this.rooms.get(msg.code.toUpperCase());
        if (!room || room.daily) return (this.error(conn, 'no_room', 'No room with that code'), true);
        if (conn.room && conn.room !== room) conn.room.leave(conn.id);
        const r = room.join(conn);
        if (typeof r === 'string') this.error(conn, 'join_failed', r);
        return true;
      }
      case 'resume':
        if (!this.tryResume(conn, msg.token)) this.send(conn, { t: 'left' });
        return true;
      case 'leaveRoom':
        conn.room?.leave(conn.id);
        this.send(conn, { t: 'left' });
        return true;
      case 'ping':
        if (msg.rtt !== undefined) conn.room?.setPing(conn.id, msg.rtt);
        this.send(conn, { t: 'pong', t0: msg.t0 });
        return true;
      case 'dailyStart': {
        if (!this.opts.daily) return this.error(conn, 'no_daily', 'The daily challenge needs the online server'), true;
        conn.room?.leave(conn.id);
        const code = 'D' + makeRoomCode().slice(1);
        const room = new Room(code, this, dateKey());
        this.rooms.set(code, room);
        room.join(conn);
        room.startMatch();
        return true;
      }
      case 'dailyBoard':
        this.sendBoard(conn);
        return true;
      default:
        conn.room?.handle(conn, msg);
        return true;
    }
  }

  sendBoard(conn: Conn): void {
    const date = dateKey();
    this.send(conn, {
      t: 'dailyBoard',
      date,
      par: dailyCourse(date).holes[0].par,
      entries: this.board.top(date),
    });
  }

  private tryResume(conn: Conn, token: string): boolean {
    const t = this.tokens.get(token);
    if (!t || t.playerId !== conn.id) return false;
    const room = this.rooms.get(t.code);
    return !!room?.resume(token, conn);
  }

  onClose(conn: Conn): void {
    if (conn.id && this.online.get(conn.id) === conn) this.online.delete(conn.id);
    if (conn.id && conn.room) conn.room.disconnect(conn.id);
  }

  shutdown(): void {
    clearInterval(this.housekeeping);
    for (const r of [...this.rooms.values()]) r.close();
    this.profiles.flush();
    this.board.flush();
  }
}
