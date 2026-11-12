/**
 * Serverless WebRTC signalling: the host's offer and the guest's answer are exchanged by hand
 * as short text codes (copy/paste or share sheet). Public STUN servers only help peers discover
 * their public addresses through home routers; no game data goes through them.
 */

import { COMPACT_PREFIX, cleanCompact, packCompact, unpackCompact } from './compactCode';

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const PREFIX = 'PPP1.';

export interface InvitePayload {
  sdp: string;
  /** Room code to join once connected (host invites only). */
  room?: string;
  /** Host's display name, shown to the guest. */
  host?: string;
}

function toB64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function pipeThrough(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Drop SDP lines the peer does not need, to keep codes short. */
function slimSdp(sdp: string): string {
  return sdp
    .split('\r\n')
    .filter((l) => l && !l.startsWith('a=extmap') && !l.startsWith('a=msid-semantic'))
    .join('\r\n') + '\r\n';
}

/** Older, longer format; still produced when an SDP doesn't fit the compact shape. */
export async function encodeLegacyCode(p: InvitePayload): Promise<string> {
  const json = JSON.stringify({ ...p, sdp: slimSdp(p.sdp) });
  const packed = await pipeThrough(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return PREFIX + toB64Url(packed);
}

export async function encodeCode(p: InvitePayload): Promise<string> {
  return packCompact(p) ?? encodeLegacyCode(p);
}

export async function decodeCode(code: string): Promise<InvitePayload> {
  // People paste whole chat messages ("Join my game! … paste: PPP2…"), so look for the code
  // inside the text rather than insisting it starts there.
  const cleaned = cleanCompact(code);
  const at = cleaned.indexOf(COMPACT_PREFIX);
  if (at >= 0 && !cleaned.startsWith('PPP1')) {
    try {
      return unpackCompact(cleaned.slice(at));
    } catch {
      throw new Error('That code is incomplete or damaged — copy the whole thing');
    }
  }
  const c = code.trim().replace(/\s+/g, '');
  if (!c.startsWith(PREFIX)) throw new Error("That doesn't look like a Putt-Putt Planet code");
  try {
    const raw = await pipeThrough(fromB64Url(c.slice(PREFIX.length)), new DecompressionStream('deflate-raw'));
    const p = JSON.parse(new TextDecoder().decode(raw)) as InvitePayload;
    if (typeof p.sdp !== 'string') throw new Error('bad');
    return p;
  } catch {
    throw new Error('That code is incomplete or damaged — copy the whole thing');
  }
}

/**
 * Wait until ICE gathering finishes (codes are not trickled). Gathering often never "completes"
 * (an unanswered IPv6 STUN probe holds it open), so stop shortly after the first public
 * (server-reflexive) address arrives, or after `ms` at most.
 */
export function gatherComplete(pc: RTCPeerConnection, ms = 5000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let early = 0;
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      pc.removeEventListener('icecandidate', onCand);
      clearTimeout(t);
      clearTimeout(early);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const onCand = (e: RTCPeerConnectionIceEvent) => {
      if (!early && e.candidate?.candidate.includes(' typ srflx')) early = window.setTimeout(done, 1200);
    };
    pc.addEventListener('icegatheringstatechange', check);
    pc.addEventListener('icecandidate', onCand);
    const t = setTimeout(done, ms);
  });
}

/** Separate an SDP's candidate lines from the rest, so we control when connection checks start. */
export function splitCandidates(sdp: string): { sdp: string; candidates: string[]; mid: string } {
  const lines = sdp.split(/\r?\n/).filter(Boolean);
  const candidates = lines
    .filter((l) => l.startsWith('a=candidate:'))
    .map((l) => l.slice(2))
    // "tcptype active" candidates (port 9) can never be connected to.
    .filter((c) => !/ tcp .* tcptype active/.test(c));
  const mid = lines.find((l) => l.startsWith('a=mid:'))?.slice(6) ?? '0';
  const rest = lines.filter((l) => !l.startsWith('a=candidate:') && !l.startsWith('a=end-of-candidates'));
  return { sdp: rest.join('\r\n') + '\r\n', candidates, mid };
}

/**
 * Re-issue a candidate as a "new" one (fresh foundation, marginally lower priority). Browsers
 * ignore exact duplicates, but a variant restarts connection checks on a peer connection that
 * gave up.
 */
export function candidateVariant(candidate: string, round: number): string {
  if (round === 0) return candidate;
  const f = candidate.split(' ');
  // candidate:<foundation> <component> <transport> <priority> <address> <port> typ <type> ...
  if (f.length < 8) return candidate;
  f[0] = `${f[0]}${round}`.slice(0, 42);
  f[3] = String(Math.max(1, Number(f[3]) - round));
  return f.join(' ');
}

/**
 * Hole punching without a signalling server. Each side's router only lets the other side's
 * packets in after it has itself sent packets out to them, and a browser abandons a connection
 * attempt after ~15 s of silence. With hand-copied codes the two sides start minutes apart, so
 * keep re-offering the peer's addresses (restarting checks) until connected or `forMs` runs out.
 * Resolves true once connected.
 */
export function keepKnocking(pc: RTCPeerConnection, candidates: string[], mid: string, forMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let round = 0;
    const end = Date.now() + forMs;
    const knock = () => {
      for (const c of candidates)
        pc.addIceCandidate({ candidate: candidateVariant(c, round), sdpMid: mid }).catch(() => undefined);
      round++;
    };
    const finish = (ok: boolean) => {
      clearInterval(timer);
      pc.removeEventListener('connectionstatechange', onState);
      resolve(ok);
    };
    const onState = () => {
      if (pc.connectionState === 'connected') finish(true);
      else if (pc.connectionState === 'closed') finish(false);
    };
    pc.addEventListener('connectionstatechange', onState);
    const timer = setInterval(() => {
      if (pc.connectionState === 'connected') return finish(true);
      if (pc.connectionState === 'closed') return finish(false);
      if (Date.now() > end) return finish(false);
      // 'failed' = checks gave up; 'disconnected' before ever connecting = about to.
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') knock();
    }, 2000);
    knock();
  });
}

/** How long each side keeps trying while the other is still copying/pasting codes. */
export const GUEST_KNOCK_MS = 15 * 60_000;
export const HOST_KNOCK_MS = 3 * 60_000;

/**
 * Guest side: turn a host's invite code into a reply code. Resolves `channel` once the host
 * has accepted the reply and the data channel is open.
 */
export async function answerInvite(inviteCode: string): Promise<{
  reply: string;
  invite: InvitePayload;
  channel: Promise<RTCDataChannel>;
  pc: RTCPeerConnection;
  /** Give up on this attempt (the player pasted another invite): closes the link quietly. */
  cancel: () => void;
}> {
  const invite = await decodeCode(inviteCode);
  if (!invite.room) throw new Error("That's a reply code — paste the invite code your host sent you");
  const offer = splitCandidates(invite.sdp);
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const opened = new Promise<RTCDataChannel>((resolve) => {
    pc.ondatachannel = (e) => {
      const dc = e.channel;
      if (dc.readyState === 'open') resolve(dc);
      else dc.onopen = () => resolve(dc);
    };
  });
  await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await gatherComplete(pc);
  const reply = await encodeCode({ sdp: pc.localDescription!.sdp });
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    pc.close();
  };
  const channel = Promise.race([
    opened.then((dc) => (cancelled ? new Promise<RTCDataChannel>(() => undefined) : dc)),
    keepKnocking(pc, offer.candidates, offer.mid, GUEST_KNOCK_MS).then(async (ok) => {
      // A cancelled attempt never settles: no error toast for a link the player abandoned.
      if (cancelled) return new Promise<RTCDataChannel>(() => undefined);
      if (ok) return opened;
      pc.close();
      throw new Error(
        "Couldn't connect to the host. Check they pasted your reply code, then try a new invite. Some networks (mobile hotspots, school/office Wi-Fi) block direct links — the same Wi-Fi always works.",
      );
    }),
  ]);
  return { reply, invite, channel, pc, cancel };
}
