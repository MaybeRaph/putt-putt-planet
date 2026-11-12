import { beforeAll, describe, expect, it } from 'vitest';
import { defaultProfile, initPhysics, parseS2C, type S2CMsg } from '@ppp/shared';
import { candidateVariant, decodeCode, encodeCode, splitCandidates } from '../src/net/p2p';
import { NetClient } from '../src/net/NetClient';
import { LocalHost } from '../src/net/LocalHost';

beforeAll(async () => {
  await initPhysics();
});

describe('direct connection', () => {
  it('round-trips invite codes and keeps them short', async () => {
    const sdp = 'v=0\r\no=- 46117317 2 IN IP4 127.0.0.1\r\n' + 'a=candidate:1 1 udp 2122260223 192.168.1.20 54400 typ host\r\n'.repeat(6);
    const code = await encodeCode({ sdp, room: 'ABC123', host: 'Alice' });
    expect(code.startsWith('PPP1.')).toBe(true);
    expect(code.length).toBeLessThan(sdp.length);
    const back = await decodeCode(`  ${code.slice(0, 40)}\n${code.slice(40)}  `); // tolerate whitespace/newlines from chat apps
    expect(back).toEqual({ sdp, room: 'ABC123', host: 'Alice' });
    await expect(decodeCode('hello')).rejects.toThrow(/doesn't look like/);
    await expect(decodeCode(code.slice(0, 30))).rejects.toThrow(/incomplete/);
  });

  it('parses join-by-address input', () => {
    expect(NetClient.addressUrl('192.168.1.20')).toBe('ws://192.168.1.20:8787/ws');
    expect(NetClient.addressUrl(' 10.0.0.5:9000 ')).toBe('ws://10.0.0.5:9000/ws');
    expect(NetClient.addressUrl('ws://host.local:8787/ws')).toBe('ws://host.local:8787/ws');
  });

  it('runs the room in-process: host via loopback, a peer joins the same room', async () => {
    const host = new LocalHost();
    const tr = host.openLoopback();
    const inbox: S2CMsg[] = [];
    tr.onmessage = (d) => inbox.push(parseS2C(JSON.parse(d))!);
    await new Promise((r) => setTimeout(r, 0));
    tr.send(JSON.stringify({ t: 'hello', profile: defaultProfile('g_host', 'Host') }));
    tr.send(JSON.stringify({ t: 'createRoom' }));
    await new Promise((r) => setTimeout(r, 10));
    const joined = inbox.find((m) => m.t === 'joined') as Extract<S2CMsg, { t: 'joined' }>;
    expect(joined.code).toMatch(/^[A-Z0-9]{6}$/);

    // A guest connection as the data channel would deliver it.
    const guestInbox: S2CMsg[] = [];
    const guest = { id: null, profile: null, room: null, bucket: 60, lastRefill: Date.now(), sendRaw: (d: string) => guestInbox.push(parseS2C(JSON.parse(d))!), close: () => {} };
    host.lobby.onMessage(guest, JSON.stringify({ t: 'hello', profile: defaultProfile('g_guest', 'Guest') }));
    host.lobby.onMessage(guest, JSON.stringify({ t: 'joinRoom', code: joined.code }));
    await new Promise((r) => setTimeout(r, 10));
    const room = [...inbox].reverse().find((m) => m.t === 'room') as Extract<S2CMsg, { t: 'room' }>;
    expect(room.room.players.map((p) => p.name)).toEqual(['Host', 'Guest']);
    // Direct hosts don't offer the server-only daily challenge.
    host.lobby.onMessage(guest, JSON.stringify({ t: 'dailyStart' }));
    expect(guestInbox.at(-1)).toMatchObject({ t: 'error', code: 'no_daily' });
    host.shutdown();
  });
});

describe('hole punching helpers', () => {
  const sdp = [
    'v=0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'a=mid:0',
    'a=candidate:356791228 1 udp 2122129151 192.168.0.27 64860 typ host generation 0',
    'a=candidate:1438531861 1 udp 1685921535 90.193.153.1 64860 typ srflx raddr 192.168.0.27 rport 64860 generation 0',
    'a=candidate:1804325156 1 tcp 1518149375 192.168.0.27 9 typ host tcptype active generation 0',
    'a=end-of-candidates',
    '',
  ].join('\r\n');

  it('splits candidates out of an SDP and drops unconnectable ones', () => {
    const s = splitCandidates(sdp);
    expect(s.mid).toBe('0');
    expect(s.candidates).toHaveLength(2);
    expect(s.candidates[1]).toMatch(/^candidate:1438531861 .* typ srflx/);
    expect(s.sdp).not.toMatch(/candidate/);
    expect(s.sdp).toMatch(/a=mid:0\r\n$/);
  });

  it('makes distinct candidate variants for each retry round', () => {
    const c = splitCandidates(sdp).candidates[1];
    expect(candidateVariant(c, 0)).toBe(c);
    const v1 = candidateVariant(c, 1);
    const v2 = candidateVariant(c, 2);
    expect(new Set([c, v1, v2]).size).toBe(3);
    expect(v1).toMatch(/^candidate:14385318611 1 udp 1685921534 90\.193\.153\.1 64860 typ srflx/);
  });
});
