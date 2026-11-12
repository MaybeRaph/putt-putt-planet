import { NET, parseS2C, type C2SMsg, type Profile, type S2CMsg } from '@ppp/shared';
import { EventBus } from '../core/EventBus';

export type NetStatus = 'offline' | 'connecting' | 'online';

interface NetEvents {
  msg: S2CMsg;
  status: NetStatus;
}

/** Minimal message pipe the client speaks the game protocol over. */
export interface Transport {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: (() => void) | null;
}

/**
 * Where the client connects:
 *  - server: a dedicated server or a LAN host (WebSocket, auto-reconnect)
 *  - loopback: this device is hosting a direct game; the room runs in-process
 *  - peer: a direct (WebRTC) game hosted by a friend
 */
export type NetTarget =
  | { kind: 'server'; url: string }
  | { kind: 'loopback'; open: () => Transport }
  | { kind: 'peer'; channel: RTCDataChannel };

const TOKEN_KEY = 'ppp.roomToken';

class WebSocketTransport implements Transport {
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: (() => void) | null = null;
  private readonly ws: WebSocket;
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.onopen?.();
    this.ws.onmessage = (e) => this.onmessage?.(String(e.data));
    this.ws.onclose = () => this.onclose?.();
    this.ws.onerror = () => this.ws.close();
  }
  send(data: string): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }
  close(): void {
    this.ws.close();
  }
}

/** Wraps an already-open WebRTC data channel. */
export class DataChannelTransport implements Transport {
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(private readonly dc: RTCDataChannel) {
    dc.onmessage = (e) => this.onmessage?.(String(e.data));
    dc.onclose = () => this.onclose?.();
    if (dc.readyState === 'open') queueMicrotask(() => this.onopen?.());
    else dc.onopen = () => this.onopen?.();
  }
  send(data: string): void {
    if (this.dc.readyState === 'open') this.dc.send(data);
  }
  close(): void {
    this.dc.close();
  }
}

/**
 * Game-protocol client over any transport, with auto-reconnect (server targets), ping/RTT
 * tracking, room-token resume and a developer network simulator:
 * `?lag=150&jitter=30&loss=0.05` delays all traffic (one-way lag/2 each direction, preserving
 * order) and drops that fraction of snapshot messages.
 */
export class NetClient {
  readonly bus = new EventBus<NetEvents>();
  status: NetStatus = 'offline';
  rtt = 0;
  private transport: Transport | null = null;
  private target: NetTarget;
  private wantOpen = false;
  private retry = 0;
  private pingTimer = 0;
  private getProfile: () => Profile;
  private readonly sim = { lag: 0, jitter: 0, loss: 0 };
  private lastOut = 0;
  private lastIn = 0;
  readonly stats = { snapsIn: 0, snapsDropped: 0, msgsIn: 0, msgsOut: 0 };

  constructor(getProfile: () => Profile) {
    this.getProfile = getProfile;
    const q = new URLSearchParams(location.search);
    this.sim.lag = Number(q.get('lag') ?? 0);
    this.sim.jitter = Number(q.get('jitter') ?? 0);
    this.sim.loss = Number(q.get('loss') ?? 0);
    this.target = { kind: 'server', url: NetClient.defaultServerUrl() };
  }

  /** Dedicated server URL: ?server=, VITE_SERVER_URL, or same origin /ws. */
  static defaultServerUrl(): string {
    const q = new URLSearchParams(location.search).get('server');
    if (q) return q;
    const env = import.meta.env.VITE_SERVER_URL as string | undefined;
    if (env) return env;
    // Packaged apps (app:// on desktop, capacitor:// on iOS) have no same-origin server; unless a
    // server URL was baked in at build time, online-server features are unavailable (Direct play works).
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return '';
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  /** ws URL for "join by address" input like `192.168.1.20` or `192.168.1.20:8787`. */
  static addressUrl(address: string): string {
    const a = address.trim().replace(/^wss?:\/\//, '').replace(/\/ws$/, '');
    return `ws://${a.includes(':') ? a : `${a}:8787`}/ws`;
  }

  get kind(): NetTarget['kind'] {
    return this.target.kind;
  }

  get isDefaultServer(): boolean {
    return this.target.kind === 'server' && this.target.url === NetClient.defaultServerUrl();
  }

  /** Switch where we connect (drops the current connection). */
  useTarget(t: NetTarget): void {
    this.disconnect();
    this.target = t;
  }

  get simulated(): string {
    return this.sim.lag || this.sim.jitter || this.sim.loss
      ? `lag ${this.sim.lag}ms ±${this.sim.jitter} loss ${this.sim.loss * 100}%`
      : 'off';
  }

  get token(): string | null {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  set token(t: string | null) {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  }

  /** Resolves once connected (and hello sent), rejects after a timeout. */
  connect(timeoutMs = 4000): Promise<void> {
    if (this.target.kind === 'server' && !this.target.url)
      return Promise.reject(new Error('No online server in this version — use Direct connection to play with friends'));
    this.wantOpen = true;
    if (this.status === 'online') return Promise.resolve();
    if (!this.transport) this.open();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        off();
        reject(new Error(this.target.kind === 'server' ? 'Could not reach the game server' : 'Could not reach the host'));
      }, timeoutMs);
      const off = this.bus.on('status', (s) => {
        if (s === 'online') {
          clearTimeout(t);
          off();
          resolve();
        }
      });
    });
  }

  private makeTransport(): Transport {
    switch (this.target.kind) {
      case 'server':
        return new WebSocketTransport(this.target.url);
      case 'loopback':
        return this.target.open();
      case 'peer':
        return new DataChannelTransport(this.target.channel);
    }
  }

  private open(): void {
    this.setStatus('connecting');
    let tr: Transport;
    try {
      tr = this.makeTransport();
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.transport = tr;
    tr.onopen = () => {
      this.retry = 0;
      // Room tokens only make sense on the server that issued them.
      const token = this.target.kind === 'server' ? (this.token ?? undefined) : undefined;
      this.sendNow({ t: 'hello', profile: this.getProfile(), token });
      this.setStatus('online');
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(
        () => this.send({ t: 'ping', t0: performance.now(), rtt: this.rtt }),
        NET.pingIntervalMs,
      );
    };
    tr.onmessage = (d) => this.receive(d);
    tr.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.transport === tr) this.transport = null;
      this.setStatus('offline');
      // Direct (peer) links can't be re-dialled without new codes; servers can.
      if (this.wantOpen && this.target.kind === 'server') this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    this.retry++;
    setTimeout(() => this.wantOpen && !this.transport && this.open(), Math.min(5000, 400 * 2 ** this.retry));
  }

  private setStatus(s: NetStatus): void {
    this.status = s;
    this.bus.emit('status', s);
  }

  disconnect(): void {
    this.wantOpen = false;
    const tr = this.transport;
    this.transport = null;
    tr?.close();
    if (this.status !== 'offline') this.setStatus('offline');
  }

  /** Delay for the simulator, keeping message order like TCP does. */
  private delay(dirLast: 'lastOut' | 'lastIn'): number {
    if (!this.sim.lag && !this.sim.jitter) return 0;
    const now = performance.now();
    const at = Math.max(this[dirLast], now + this.sim.lag / 2 + Math.random() * this.sim.jitter);
    this[dirLast] = at;
    return at - now;
  }

  send(msg: C2SMsg): void {
    const d = this.delay('lastOut');
    if (d > 0) setTimeout(() => this.sendNow(msg), d);
    else this.sendNow(msg);
  }

  private sendNow(msg: C2SMsg): void {
    if (!this.transport) return;
    this.transport.send(JSON.stringify(msg));
    this.stats.msgsOut++;
  }

  private receive(data: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      return;
    }
    const msg = parseS2C(raw);
    if (!msg) {
      console.warn('[net] dropped invalid message', data.slice(0, 120));
      return;
    }
    if (msg.t === 'snap' && this.sim.loss && Math.random() < this.sim.loss) {
      this.stats.snapsDropped++;
      return;
    }
    const d = this.delay('lastIn');
    if (d > 0) setTimeout(() => this.dispatch(msg), d);
    else this.dispatch(msg);
  }

  private dispatch(msg: S2CMsg): void {
    this.stats.msgsIn++;
    if (msg.t === 'snap') this.stats.snapsIn++;
    if (msg.t === 'pong')
      this.rtt = this.rtt ? this.rtt * 0.7 + (performance.now() - msg.t0) * 0.3 : performance.now() - msg.t0;
    if (this.target.kind === 'server') {
      if (msg.t === 'joined') this.token = msg.token;
      if (msg.t === 'left') this.token = null;
    }
    this.bus.emit('msg', msg);
  }
}
