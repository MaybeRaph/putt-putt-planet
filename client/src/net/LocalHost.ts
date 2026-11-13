import { Lobby, memoryStorage, NET, type Conn, type Interval } from '@ppp/shared';
import { EventBus } from '../core/EventBus';
import type { Transport } from './NetClient';
import {
  HOST_KNOCK_MS,
  ICE_SERVERS,
  decodeCode,
  encodeCode,
  gatherComplete,
  keepKnocking,
  relinkOnDrop,
  splitCandidates,
} from './p2p';

export type InviteState = 'waiting' | 'connecting' | 'connected' | 'failed' | 'closed';

export interface Invite {
  id: number;
  code: string;
  state: InviteState;
  name?: string;
}

/**
 * Browsers throttle main-thread timers in background tabs (down to ~1 Hz), which would freeze a
 * direct game whenever the host switches tabs. A tiny worker's timer keeps ticking and posts a
 * heartbeat; message delivery to the page is not throttled the same way.
 */
const workerInterval: Interval = (fn, ms) => {
  let worker: Worker | null = null;
  try {
    const src = `let h; onmessage = (e) => { clearInterval(h); if (e.data > 0) h = setInterval(() => postMessage(0), e.data); };`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = () => fn();
    worker.postMessage(ms);
    return { stop: () => worker?.terminate() };
  } catch {
    const h = setInterval(fn, ms); // CSP or no Worker support: plain timer
    return { stop: () => clearInterval(h) };
  }
};

const newConn = (send: (d: string) => void, close: () => void): Conn => ({
  id: null,
  profile: null,
  room: null,
  bucket: NET.maxMessagesPerSec,
  lastRefill: Date.now(),
  sendRaw: send,
  close,
});

/**
 * Runs the authoritative room (the same Lobby/Room/Match code as the dedicated server) inside
 * this player's game. The host plays through an in-process loopback; friends connect over
 * WebRTC data channels set up with invite/reply codes. No server involved.
 */
export class LocalHost {
  readonly lobby = new Lobby(memoryStorage(), false, {
    daily: false,
    interval: workerInterval,
    // A kicked friend's link is closed for good (after their "you were removed" message is sent);
    // the host can still let them back in with a fresh invite.
    rejoinAfterKick: true,
    onKick: (conn) => setTimeout(() => conn.close(), 250),
  });
  readonly bus = new EventBus<{ invites: Invite[] }>();
  private readonly peers = new Map<number, { pc: RTCPeerConnection; invite: Invite; conn?: Conn }>();
  private nextId = 1;
  roomCode: string | null = null;
  hostName = '';

  /** Transport for the hosting player's own client. */
  openLoopback = (): Transport => {
    let conn: Conn | null = null;
    const tr: Transport = {
      onopen: null,
      onmessage: null,
      onclose: null,
      send: (d) => queueMicrotask(() => conn && this.lobby.onMessage(conn, d)),
      close: () => {
        if (conn) this.lobby.onClose(conn);
        conn = null;
        tr.onclose?.();
      },
    };
    conn = newConn(
      (d) => queueMicrotask(() => tr.onmessage?.(d)),
      () => tr.close(),
    );
    queueMicrotask(() => tr.onopen?.());
    return tr;
  };

  invites(): Invite[] {
    return [...this.peers.values()].map((p) => p.invite);
  }

  private emit(): void {
    this.bus.emit('invites', this.invites());
  }

  /** Create a one-friend invite code (each friend needs their own). */
  async createInvite(): Promise<Invite> {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const dc = pc.createDataChannel('game', { ordered: true });
    const id = this.nextId++;
    const invite: Invite = { id, code: '', state: 'waiting' };
    const peer: { pc: RTCPeerConnection; invite: Invite; conn?: Conn } = { pc, invite };
    this.peers.set(id, peer);

    // The connection and the message handler exist from the start, not from `open`: Chromium
    // (seen on Windows 11) can deliver the guest's first messages — its hello and joinRoom, sent
    // the instant its side opens — before this side's `open` event runs. A handler attached in
    // `onopen` missed them, so the guest was never identified and the host answered everything
    // it sent afterwards (Ready included) with "Say hello first".
    // Replies to those early messages wait here until the channel reports itself open.
    const early: string[] = [];
    const conn = newConn(
      (d) => {
        if (dc.readyState === 'open') dc.send(d);
        else if (dc.readyState === 'connecting' && early.length < 256) early.push(d);
      },
      () => dc.close(),
    );
    peer.conn = conn;
    const linkOpen = () => {
      if (dc.readyState === 'open') for (const d of early.splice(0)) dc.send(d);
      if (invite.state === 'connected') return;
      console.info(`[direct] invite #${id}: link open`);
      invite.state = 'connected';
      this.emit();
    };
    dc.onopen = linkOpen;
    dc.onmessage = (e) => {
      linkOpen();
      if (!this.lobby.onMessage(conn, String(e.data))) dc.close();
      if (!invite.name && conn.profile) {
        invite.name = conn.profile.name;
        this.emit();
      }
    };
    dc.onclose = () => {
      console.info(`[direct] invite #${id}: link closed`);
      this.lobby.onClose(conn);
      invite.state = 'closed';
      this.emit();
    };

    await pc.setLocalDescription(await pc.createOffer());
    await gatherComplete(pc);
    invite.code = await encodeCode({ sdp: pc.localDescription!.sdp, room: this.roomCode ?? undefined, host: this.hostName });
    this.emit();
    return invite;
  }

  /** Accept a friend's reply code for a given invite. */
  async acceptReply(id: number, replyCode: string): Promise<void> {
    const peer = this.peers.get(id);
    if (!peer) throw new Error('That invite no longer exists');
    const reply = await decodeCode(replyCode);
    if (reply.room) throw new Error("That's an invite code — paste the reply code your friend sent back");
    if (peer.invite.state !== 'waiting') return;
    const answer = splitCandidates(reply.sdp);
    peer.invite.state = 'connecting';
    this.emit();
    try {
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
    } catch {
      peer.invite.state = 'waiting';
      this.emit();
      throw new Error("That reply code doesn't belong to this invite — each friend needs their own invite");
    }
    void keepKnocking(peer.pc, answer.candidates, answer.mid, HOST_KNOCK_MS).then((ok) => {
      // Up: from now on, bring the link back if its route dies mid-game (see relinkOnDrop).
      if (ok) return void relinkOnDrop(peer.pc, answer.candidates, answer.mid, `invite #${id}`);
      if (peer.invite.state !== 'connecting') return;
      peer.invite.state = 'failed';
      this.emit();
    });
  }

  cancelInvite(id: number): void {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    this.peers.delete(id);
    this.emit();
  }

  shutdown(): void {
    for (const p of this.peers.values()) p.pc.close();
    this.peers.clear();
    this.lobby.shutdown();
  }
}
