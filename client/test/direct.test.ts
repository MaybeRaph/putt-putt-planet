import { beforeAll, describe, expect, it } from 'vitest';
import { defaultProfile, initPhysics, parseS2C, type S2CMsg } from '@ppp/shared';
import { candidateVariant, decodeCode, encodeCode, encodeLegacyCode, splitCandidates } from '../src/net/p2p';
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

  // Shaped like a real Chromium/Electron offer; addresses are documentation ranges.
  const offer = [
    'v=0',
    'o=- 7451908646671703742 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS',
    'm=application 1425 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 203.0.113.9',
    'a=candidate:587826199 1 udp 2122129151 192.168.0.54 54452 typ host generation 0 network-id 1 network-cost 10',
    'a=candidate:747986482 1 udp 2122265343 fd31:1623:ad00:6543:a8:d596:209c:5025 57978 typ host generation 0 network-id 3 network-cost 10',
    'a=candidate:3799125122 1 udp 2122197247 2001:db8:3208:4b00:e402:be03:ea13:f6ec 50326 typ host generation 0 network-id 2 network-cost 10',
    'a=candidate:1111 1 udp 2122197246 fe80::1 50327 typ host generation 0',
    'a=candidate:2222 1 udp 2122197245 0f2c1a3e-4b5d-4c6e-8f70-112233445566.local 50328 typ host generation 0',
    'a=candidate:1676932798 1 udp 1685921535 203.0.113.9 1425 typ srflx raddr 192.168.0.54 rport 54452 generation 0 network-id 1 network-cost 10',
    'a=candidate:1573283471 1 tcp 1518149375 192.168.0.54 9 typ host tcptype active generation 0 network-id 1 network-cost 10',
    'a=ice-ufrag:9S7J',
    'a=ice-pwd:BHXqChyXaLRmeP+HGk/bDhAI',
    'a=ice-options:trickle',
    'a=fingerprint:sha-256 01:A0:D6:45:3E:97:FC:BB:D2:6A:C0:B6:CD:35:B7:83:1D:C4:37:C5:A7:89:0C:20:BC:39:56:5F:52:CB:E2:42',
    'a=setup:actpass',
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
  ].join('\r\n');

  it('makes short, chat-safe codes from real offers', async () => {
    const code = await encodeCode({ sdp: offer, room: 'ABC123', host: 'Zoë 🏌️' });
    const legacy = await encodeLegacyCode({ sdp: offer, room: 'ABC123', host: 'Zoë 🏌️' });
    expect(code).toMatch(/^PPP2[1-9A-HJ-NP-Za-km-z]+$/); // letters and digits only
    expect(code.length).toBeLessThan(legacy.length / 2);
    expect(code.length).toBeLessThan(190);

    const back = await decodeCode(code);
    expect(back.room).toBe('ABC123');
    expect(back.host).toBe('Zoë 🏌️');
    const s = splitCandidates(back.sdp);
    expect(s.mid).toBe('0');
    expect(back.sdp).toMatch(/a=ice-ufrag:9S7J\r\n/);
    expect(back.sdp).toMatch(/a=ice-pwd:BHXqChyXaLRmeP\+HGk\/bDhAI\r\n/);
    expect(back.sdp).toMatch(/a=fingerprint:sha-256 01:A0:D6:45:3E:97:FC:BB:D2:6A:C0:B6:CD:35:B7:83:1D:C4:37:C5:A7:89:0C:20:BC:39:56:5F:52:CB:E2:42\r\n/);
    expect(back.sdp).toMatch(/a=setup:actpass\r\n/);
    // Keeps IPv4, global IPv6, mDNS and the public address; drops unique-local, link-local and TCP.
    expect(s.candidates.map((c) => c.split(' ').slice(4, 8).join(' '))).toEqual([
      '192.168.0.54 54452 typ host',
      '2001:db8:3208:4b00:e402:be03:ea13:f6ec 50326 typ host',
      '0f2c1a3e-4b5d-4c6e-8f70-112233445566.local 50328 typ host',
      '203.0.113.9 1425 typ srflx',
    ]);
  });

  it('survives Discord-style formatting and rejects damaged codes', async () => {
    const reply = offer.replace('a=setup:actpass', 'a=setup:active');
    const code = await encodeCode({ sdp: reply });
    const mangled = `**${code.slice(0, 50)}__\n${code.slice(50)}**`;
    const back = await decodeCode(mangled);
    expect(back.room).toBeUndefined();
    expect(back.sdp).toMatch(/a=setup:active\r\n/);
    // One changed or missing character is caught instead of failing to connect later.
    const swapped = code.slice(0, 30) + (code[30] === 'a' ? 'b' : 'a') + code.slice(31);
    await expect(decodeCode(swapped)).rejects.toThrow(/incomplete/);
    await expect(decodeCode(code.slice(0, -1))).rejects.toThrow(/incomplete/);
  });

  // A Windows 11 PC as Chromium reports it: several adapters (Wi-Fi, Hyper-V/WSL, VPN), privacy
  // (temporary) IPv6 addresses, link-local and Teredo, mDNS-hidden host names and TCP candidates.
  const windowsAnswer = [
    'v=0',
    'o=- 5512907741230098113 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=candidate:1 1 udp 2122260223 192.168.1.73 61522 typ host generation 0 network-id 1 network-cost 10',
    'a=candidate:2 1 udp 2122194687 172.29.96.1 61523 typ host generation 0 network-id 2',
    'a=candidate:3 1 udp 2122129151 10.8.0.6 61524 typ host generation 0 network-id 3 network-cost 50',
    'a=candidate:4 1 udp 2122063615 3b1f9c2e-7a4d-4e0b-9c11-5d6e7f8091a2.local 61525 typ host generation 0 network-id 4',
    'a=candidate:5 1 udp 2121998079 2001:db8:85a3:0:d9c4:7e1f:22b0:91aa 61526 typ host generation 0 network-id 5',
    'a=candidate:6 1 udp 2121932543 2001:db8:85a3::1c2 61527 typ host generation 0 network-id 5',
    'a=candidate:7 1 udp 2121867007 2001:db8:85a3:0:5cd1:aa02:9f3e:7b10 61528 typ host generation 0 network-id 5',
    'a=candidate:8 1 udp 2121801471 fe80::a4c1:2bff:fe33:9d07 61529 typ host generation 0 network-id 6',
    'a=candidate:9 1 udp 1686052607 198.51.100.24 61522 typ srflx raddr 192.168.1.73 rport 61522 generation 0 network-id 1',
    'a=candidate:10 1 udp 1685987071 2001:db8:85a3:0:d9c4:7e1f:22b0:91aa 61526 typ srflx raddr :: rport 0 generation 0',
    'a=candidate:11 1 tcp 1518280447 192.168.1.73 9 typ host tcptype active generation 0 network-id 1',
    'a=candidate:12 1 tcp 1518214911 172.29.96.1 9 typ host tcptype active generation 0 network-id 2',
    'a=ice-ufrag:Zq+7',
    'a=ice-pwd:u4X/0mWcR1nT9aGk+Lh2PpYe',
    'a=ice-options:trickle',
    'a=fingerprint:sha-256 7B:0F:9E:11:C4:5A:D2:63:88:1E:F0:27:AB:34:6C:D9:02:E5:71:BE:48:93:5D:A6:0C:FF:13:7A:E8:29:B4:60',
    'a=setup:active',
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
  ].join('\r\n');

  it('keeps every address a Windows PC needs to be reached on', async () => {
    const code = await encodeCode({ sdp: windowsAnswer });
    expect(code).toMatch(/^PPP2[1-9A-HJ-NP-Za-km-z]+$/);
    const back = await decodeCode(code);
    expect(back.room).toBeUndefined();
    // Credentials survive byte for byte (base64 with + and /), and the answering role is kept.
    expect(back.sdp).toMatch(/a=ice-ufrag:Zq\+7\r\n/);
    expect(back.sdp).toMatch(/a=ice-pwd:u4X\/0mWcR1nT9aGk\+Lh2PpYe\r\n/);
    expect(back.sdp).toMatch(/a=fingerprint:sha-256 7B:0F:9E:11:C4:5A:D2:63:88:1E:F0:27:AB:34:6C:D9:02:E5:71:BE:48:93:5D:A6:0C:FF:13:7A:E8:29:B4:60\r\n/);
    expect(back.sdp).toMatch(/a=setup:active\r\n/);
    const got = splitCandidates(back.sdp).candidates.map((c) => c.split(' ').slice(4, 8).join(' '));
    // Every IPv4 adapter, the mDNS name, two global IPv6 addresses and both public addresses.
    expect(got).toEqual([
      '192.168.1.73 61522 typ host',
      '172.29.96.1 61523 typ host',
      '10.8.0.6 61524 typ host',
      '3b1f9c2e-7a4d-4e0b-9c11-5d6e7f8091a2.local 61525 typ host',
      '2001:db8:85a3:0:d9c4:7e1f:22b0:91aa 61526 typ host',
      '2001:db8:85a3:0:0:0:0:1c2 61527 typ host',
      '198.51.100.24 61522 typ srflx',
    ]);
    // Packing the rebuilt SDP again gives the same code: nothing drifts on a second pass.
    expect(await encodeCode({ sdp: back.sdp })).toBe(code);
  });

  it('falls back to the long format rather than dropping addresses', async () => {
    // A PC with more adapters than a compact code can hold.
    const many = Array.from({ length: 17 }, (_, i) => `a=candidate:${20 + i} 1 udp ${2000000000 - i} 10.0.${i}.2 ${50000 + i} typ host generation 0`);
    const sdp = windowsAnswer.replace('a=ice-ufrag', `${many.join('\r\n')}\r\na=ice-ufrag`);
    const code = await encodeCode({ sdp });
    expect(code.startsWith('PPP1.')).toBe(true);
    expect(splitCandidates((await decodeCode(code)).sdp).candidates.filter((c) => c.includes(' 10.0.'))).toHaveLength(17);
  });

  it('finds the code inside a pasted chat message, in any letter case of the wrapper', async () => {
    const code = await encodeCode({ sdp: offer, room: 'ABC123', host: 'Alice' });
    const back = await decodeCode(`Join my Putt-Putt Planet game! Open the game → Play with Friends → Enter invite code, and paste:\r\n\`${code}\`\r\n`);
    expect(back.room).toBe('ABC123');
    // Codes are case-sensitive: one that was lower-cased by an app is rejected, not half-read.
    await expect(decodeCode(code.toLowerCase())).rejects.toThrow(/incomplete|doesn't look/);
  });

  it('still reads codes from older versions', async () => {
    const old = await encodeLegacyCode({ sdp: offer, room: 'ABC123', host: 'Alice' });
    expect((await decodeCode(old)).room).toBe('ABC123');
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
