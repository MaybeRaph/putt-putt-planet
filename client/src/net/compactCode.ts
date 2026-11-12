/**
 * Compact, chat-safe direct-play codes.
 *
 * A data-channel-only SDP is almost entirely boilerplate. The only parts the other side needs are
 * the ICE username/password, the DTLS certificate fingerprint, the DTLS role and the candidate
 * addresses. Those are packed into bytes, protected by a checksum and written in Base58 (letters
 * and digits only, no look-alikes), so chat apps can't turn parts of the code into formatting and
 * a double-click selects the whole code. The receiver rebuilds a standard SDP from a template.
 *
 * Anything that doesn't fit this shape (unusual fingerprint hash, odd candidate addresses) returns
 * null from `packSdp`, and the caller falls back to the older, longer format.
 */

export const COMPACT_PREFIX = 'PPP2';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function toBase58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = '';
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = '1' + s;
  }
  return s;
}

export function fromBase58(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const v = B58.indexOf(c);
    if (v < 0) throw new Error('bad char');
    n = n * 58n + BigInt(v);
  }
  const out: number[] = [];
  while (n > 0n) {
    out.unshift(Number(n & 255n));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== '1') break;
    out.unshift(0);
  }
  return Uint8Array.from(out);
}

/** CRC-16/CCITT: catches a dropped or changed character before we try to connect with it. */
function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

class Writer {
  private bytes: number[] = [];
  u8(v: number): void {
    this.bytes.push(v & 255);
  }
  u16(v: number): void {
    this.u8(v >> 8);
    this.u8(v);
  }
  raw(b: ArrayLike<number>): void {
    for (let i = 0; i < b.length; i++) this.u8(b[i]);
  }
  /** Length-prefixed text. ICE strings are base64 characters, so pack 4 chars into 3 bytes when possible. */
  ice(s: string): void {
    if (s.length % 4 === 0 && s.length <= 4 * 63 && /^[A-Za-z0-9+/]+$/.test(s)) {
      const packed = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      this.u8(0x80 | (s.length / 4));
      this.raw(packed);
    } else {
      const b = new TextEncoder().encode(s);
      if (b.length > 127) throw new Error('too long');
      this.u8(b.length);
      this.raw(b);
    }
  }
  text(s: string, max: number): void {
    // Cut on whole characters so a long name never ends in half a UTF-8 sequence.
    const enc = new TextEncoder();
    let b = enc.encode(s);
    const chars = [...s];
    while (b.length > max) {
      chars.pop();
      b = enc.encode(chars.join(''));
    }
    this.u8(b.length);
    this.raw(b);
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

class Reader {
  private i = 0;
  constructor(private readonly b: Uint8Array) {}
  u8(): number {
    if (this.i >= this.b.length) throw new Error('short');
    return this.b[this.i++];
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  raw(n: number): Uint8Array {
    if (this.i + n > this.b.length) throw new Error('short');
    const out = this.b.slice(this.i, this.i + n);
    this.i += n;
    return out;
  }
  ice(): string {
    const h = this.u8();
    if (h & 0x80) {
      const bytes = this.raw((h & 0x3f) * 3);
      let s = '';
      for (const c of bytes) s += String.fromCharCode(c);
      return btoa(s);
    }
    return new TextDecoder().decode(this.raw(h));
  }
  text(): string {
    return new TextDecoder().decode(this.raw(this.u8()));
  }
  get atEnd(): boolean {
    return this.i === this.b.length;
  }
}

/** The fields of an SDP that a data-channel peer actually needs. */
export interface SdpEssentials {
  ufrag: string;
  pwd: string;
  /** sha-256 fingerprint, 32 bytes. */
  fingerprint: Uint8Array;
  setup: 'actpass' | 'active' | 'passive';
  candidates: Cand[];
}

interface Cand {
  type: 'host' | 'srflx';
  /** IPv4/IPv6 address, or an mDNS "<uuid>.local" name. */
  address: string;
  port: number;
}

const ADDR_V4 = 0;
const ADDR_V6 = 1;
const ADDR_MDNS = 2;
const SETUPS = ['actpass', 'active', 'passive'] as const;

function parseV4(a: string): number[] | null {
  const p = a.split('.');
  if (p.length !== 4) return null;
  const n = p.map(Number);
  return n.every((x, i) => Number.isInteger(x) && x >= 0 && x <= 255 && String(x) === p[i]) ? n : null;
}

function parseV6(a: string): number[] | null {
  if (!/^[0-9a-fA-F:]+$/.test(a) || !a.includes(':')) return null;
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.some((g) => g.length < 1 || g.length > 4)) return null;
  return groups.flatMap((g) => {
    const v = parseInt(g, 16);
    return [v >> 8, v & 255];
  });
}

function formatV6(b: Uint8Array): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(((b[i] << 8) | b[i + 1]).toString(16));
  return groups.join(':');
}

const UUID_LOCAL = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;

/**
 * Link-local and unique-local IPv6 addresses only work inside one home network, where the IPv4
 * host address already does the job, so leave them out to keep codes short.
 */
function usefulV6(bytes: number[]): boolean {
  const first = (bytes[0] << 8) | bytes[1];
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique-local
  return true;
}

/** Most global IPv6 candidates kept; machines often have several temporary addresses. */
const MAX_V6 = 2;

/** Pull the essentials out of a data-channel SDP, or null if it isn't the expected shape. */
export function extractEssentials(sdp: string): SdpEssentials | null {
  const lines = sdp.split(/\r?\n/).filter(Boolean);
  const value = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length).trim();
  const ufrag = value('a=ice-ufrag:');
  const pwd = value('a=ice-pwd:');
  const fp = value('a=fingerprint:');
  const setup = value('a=setup:') as SdpEssentials['setup'] | undefined;
  if (!ufrag || !pwd || !fp || !setup || !SETUPS.includes(setup)) return null;
  if (lines.filter((l) => l.startsWith('m=')).length !== 1 || !lines.some((l) => l.startsWith('m=application'))) return null;
  const [alg, hex] = fp.split(/\s+/);
  if (alg.toLowerCase() !== 'sha-256' || !hex) return null;
  const fpBytes = hex.split(':').map((h) => parseInt(h, 16));
  if (fpBytes.length !== 32 || fpBytes.some((b) => !(b >= 0 && b <= 255))) return null;

  const candidates: Cand[] = [];
  const seen = new Set<string>();
  let v6 = 0;
  for (const l of lines) {
    if (!l.startsWith('a=candidate:')) continue;
    // candidate:<foundation> <component> <transport> <priority> <address> <port> typ <type> ...
    const f = l.slice('a=candidate:'.length).split(' ');
    if (f.length < 8 || f[1] !== '1' || f[2].toLowerCase() !== 'udp' || f[6] !== 'typ') continue;
    const type = f[7];
    if (type !== 'host' && type !== 'srflx') continue;
    const address = f[4];
    const port = Number(f[5]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    const key = `${address} ${port}`;
    if (seen.has(key)) continue;
    if (parseV4(address)) {
      // ok
    } else if (parseV6(address)) {
      if (!usefulV6(parseV6(address)!) || v6 >= MAX_V6) continue;
      v6++;
    } else if (!UUID_LOCAL.test(address)) {
      continue; // an address shape we can't pack; dropping one candidate is fine
    }
    seen.add(key);
    candidates.push({ type, address, port });
  }
  return { ufrag, pwd, fingerprint: Uint8Array.from(fpBytes), setup, candidates };
}

/** Rebuild a standard data-channel SDP from the essentials. */
export function buildSdp(e: SdpEssentials): string {
  const sessionId = Array.from({ length: 18 }, (_, i) => (i === 0 ? 1 + Math.floor(Math.random() * 9) : Math.floor(Math.random() * 10))).join('');
  const fp = Array.from(e.fingerprint, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
  const cands = e.candidates.map((c, i) => {
    // Same priority formula browsers use: host above srflx, earlier candidates first.
    const priority = (c.type === 'host' ? 126 : 100) * 2 ** 24 + (65535 - i) * 2 ** 8 + 255;
    const rel = c.type === 'srflx' ? ' raddr 0.0.0.0 rport 0' : '';
    return `a=candidate:${i + 1} 1 udp ${priority} ${c.address} ${c.port} typ ${c.type}${rel} generation 0`;
  });
  return [
    'v=0',
    `o=- ${sessionId} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...cands,
    `a=ice-ufrag:${e.ufrag}`,
    `a=ice-pwd:${e.pwd}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${e.setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
  ].join('\r\n');
}

const FLAG_ROOM = 1;
const FLAG_HOST = 2;
const FORMAT_VERSION = 1;

export interface CompactPayload {
  essentials: SdpEssentials;
  room?: string;
  host?: string;
}

/** Pack into a chat-safe code, or null when the SDP doesn't fit the compact shape. */
export function packCompact(p: { sdp: string; room?: string; host?: string }): string | null {
  const e = extractEssentials(p.sdp);
  if (!e || e.candidates.length === 0 || e.candidates.length > 15) return null;
  try {
    const w = new Writer();
    w.u8((FORMAT_VERSION << 4) | (p.room ? FLAG_ROOM : 0) | (p.host ? FLAG_HOST : 0));
    w.u8((SETUPS.indexOf(e.setup) << 4) | e.candidates.length);
    w.ice(e.ufrag);
    w.ice(e.pwd);
    w.raw(e.fingerprint);
    for (const c of e.candidates) {
      const v4 = parseV4(c.address);
      const v6 = v4 ? null : parseV6(c.address);
      const kind = v4 ? ADDR_V4 : v6 ? ADDR_V6 : ADDR_MDNS;
      w.u8((c.type === 'srflx' ? 1 : 0) | (kind << 1));
      if (v4) w.raw(v4);
      else if (v6) w.raw(v6);
      else w.raw(c.address.replace(/\.local$/i, '').replace(/-/g, '').match(/../g)!.map((h) => parseInt(h, 16)));
      w.u16(c.port);
    }
    if (p.room) w.text(p.room, 16);
    if (p.host) w.text(p.host, 24);
    const body = w.done();
    const crc = crc16(body);
    return COMPACT_PREFIX + toBase58(Uint8Array.from([...body, crc >> 8, crc & 255]));
  } catch {
    return null;
  }
}

/**
 * Chat apps add formatting characters (`**`, `__`, backticks, `||`) or line breaks around and
 * inside pasted text. Base58 is letters and digits only, so anything else can simply be dropped.
 */
export function cleanCompact(code: string): string {
  return code.replace(/[^0-9A-Za-z]/g, '');
}

/** Unpack a compact code (already cleaned, prefix included). Throws on damage. */
export function unpackCompact(code: string): { sdp: string; room?: string; host?: string } {
  const all = fromBase58(code.slice(COMPACT_PREFIX.length));
  if (all.length < 4) throw new Error('short');
  const body = all.slice(0, -2);
  const crc = (all[all.length - 2] << 8) | all[all.length - 1];
  if (crc16(body) !== crc) throw new Error('checksum');
  const r = new Reader(body);
  const head = r.u8();
  if (head >> 4 !== FORMAT_VERSION) throw new Error('version');
  const counts = r.u8();
  const setup = SETUPS[counts >> 4];
  if (!setup) throw new Error('setup');
  const ufrag = r.ice();
  const pwd = r.ice();
  const fingerprint = r.raw(32);
  const candidates: Cand[] = [];
  for (let i = 0; i < (counts & 15); i++) {
    const t = r.u8();
    const kind = t >> 1;
    let address: string;
    if (kind === ADDR_V4) address = Array.from(r.raw(4)).join('.');
    else if (kind === ADDR_V6) address = formatV6(r.raw(16));
    else if (kind === ADDR_MDNS) {
      const h = Array.from(r.raw(16), (b) => b.toString(16).padStart(2, '0')).join('');
      address = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`;
    } else throw new Error('addr');
    candidates.push({ type: t & 1 ? 'srflx' : 'host', address, port: r.u16() });
  }
  const room = head & FLAG_ROOM ? r.text() : undefined;
  const host = head & FLAG_HOST ? r.text() : undefined;
  if (!r.atEnd) throw new Error('trailing');
  const out: { sdp: string; room?: string; host?: string } = { sdp: buildSdp({ ufrag, pwd, fingerprint, setup, candidates }) };
  if (room !== undefined) out.room = room;
  if (host !== undefined) out.host = host;
  return out;
}
