import { z } from 'zod';
import { RULES } from './config';
import { ProfileSchema } from './profile';
import { HopperStateSchema, StageSpecSchema } from './hopper/defs';

/**
 * Wire protocol: JSON messages with a `t` discriminator. Every incoming message is validated
 * with these schemas on both ends before it is touched.
 */

const num = z.number().finite();
const id = z.string().min(1).max(64);
const LoadoutSchema = z.record(z.string().max(16), z.string().max(48));
export const ModeSchema = z.enum(['solo', 'relay', 'parallel', 'versus', 'daily', 'hopper']);
export const OnlineModeSchema = z.enum(['relay', 'parallel', 'versus', 'hopper']);

// ---------------------------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------------------------

export const C2S = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), profile: ProfileSchema, token: z.string().max(64).optional() }),
  z.object({ t: z.literal('profile'), profile: ProfileSchema }),
  z.object({ t: z.literal('createRoom') }),
  z.object({ t: z.literal('joinRoom'), code: z.string().regex(/^[A-Za-z0-9]{6}$/) }),
  z.object({ t: z.literal('resume'), token: z.string().min(8).max(64) }),
  z.object({ t: z.literal('leaveRoom') }),
  z.object({ t: z.literal('ready'), ready: z.boolean() }),
  z.object({ t: z.literal('configure'), courseId: id, mode: OnlineModeSchema, chaos: z.boolean() }),
  /** Host only. `force` starts without waiting for everyone to ready up. */
  z.object({ t: z.literal('start'), force: z.boolean().optional() }),
  /** Host only: remove a player from the room. */
  z.object({ t: z.literal('kick'), id }),
  z.object({
    t: z.literal('shot'),
    seq: z.number().int().nonnegative(),
    dir: z.tuple([num, num]),
    power: num,
  }),
  z.object({ t: z.literal('reposition') }),
  z.object({ t: z.literal('next') }),
  z.object({ t: z.literal('emote'), emote: z.string().min(1).max(8) }),
  z.object({ t: z.literal('chat'), text: z.string().min(1).max(RULES.chatMaxLength) }),
  z.object({ t: z.literal('ping'), t0: num, rtt: num.optional() }),
  z.object({ t: z.literal('loadout'), loadout: LoadoutSchema }),
  z.object({ t: z.literal('dailyStart') }),
  z.object({ t: z.literal('hopperVote'), option: z.number().int().min(0).max(8) }),
  z.object({ t: z.literal('hopperReroll') }),
  z.object({ t: z.literal('dailyBoard') }),
  z.object({ t: z.literal('debugTeleport'), pos: z.tuple([num, num, num]) }),
]);
export type C2SMsg = z.infer<typeof C2S>;

// ---------------------------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------------------------

export const RoomPlayerSchema = z.object({
  id,
  name: z.string().max(20),
  ready: z.boolean(),
  connected: z.boolean(),
  ping: num,
  level: z.number().int(),
  loadout: LoadoutSchema,
});
export type RoomPlayer = z.infer<typeof RoomPlayerSchema>;

export const RoomStateSchema = z.object({
  code: z.string(),
  hostId: id,
  phase: z.enum(['lobby', 'playing']),
  courseId: id,
  mode: ModeSchema,
  chaos: z.boolean(),
  players: z.array(RoomPlayerSchema).max(RULES.maxPlayers),
});
export type RoomState = z.infer<typeof RoomStateSchema>;

const Kind = z.enum(['coin', 'gem', 'golden', 'crate']);
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
const e = <T extends string, S extends z.ZodRawShape = {}>(t: T, shape?: S) =>
  z.object({ type: z.literal(t) }).extend((shape ?? {}) as S);
const ent = { ball: z.string(), entrant: z.string() };

export const MatchEventSchema = z.discriminatedUnion('type', [
  e('shot', { ...ent, power: num }),
  e('wall', { ...ent, speed: num }),
  e('bumper', { ...ent, obstacle: z.string() }),
  e('land', { ...ent, speed: num }),
  e('boost', ent),
  e('teleport', { ...ent, obstacle: z.string() }),
  e('water', ent),
  e('oob', ent),
  e('lipout', ent),
  e('sunk', ent),
  e('holed', ent),
  e('rest', ent),
  e('stuck', ent),
  e('collect', { ...ent, item: z.string() }),
  e('holeStart', { hole: z.number().int() }),
  e('turn', { player: z.string() }),
  e('penalty', { entrant: z.string(), reason: z.enum(['water', 'oob']) }),
  e('strokeLimit', { entrant: z.string() }),
  e('entrantDone', { entrant: z.string(), strokes: z.number().int(), par: z.number().int() }),
  e('collected', { item: z.string(), kind: Kind, by: z.string() }),
  e('rescueOffered', { entrant: z.string() }),
  e('holeComplete', { hole: z.number().int() }),
  e('courseComplete'),
  e('note', { text: z.string().max(120), tone: z.enum(['good', 'bad', 'info', 'epic']) }),
  e('hopper'),
]);

export const ScoreStateSchema = z.object({
  mode: ModeSchema,
  holeIndex: z.number().int(),
  phase: z.enum(['playing', 'holeEnd', 'courseEnd']),
  pars: z.array(z.number().int()),
  entrants: z.array(z.string()),
  card: z.record(z.string(), z.array(z.number().int().nullable())),
  strokesThisHole: z.record(z.string(), z.number().int()),
  done: z.record(z.string(), z.boolean()),
  turn: z.string().nullable(),
  rescue: z.array(z.string()),
  collected: z.array(z.object({ item: z.string(), kind: Kind, hole: z.number().int(), by: z.string() })),
  hopper: HopperStateSchema.optional(),
});

/** Compact ball: [id, x, y, z, vx, vy, vz, phase] with phase 0 rest, 1 moving, 2 sinking, 3 holed. */
export const SnapBallSchema = z.tuple([
  z.string(),
  num,
  num,
  num,
  num,
  num,
  num,
  z.number().int().min(0).max(3),
]);
export const PHASES = ['rest', 'moving', 'sinking', 'holed'] as const;

export const GrantSchema = z.object({
  xpItems: z.array(z.object({ label: z.string(), xp: num })),
  coinItems: z.array(z.object({ label: z.string(), coins: num })),
  xpTotal: num,
  coinsTotal: num,
  startLevel: z.number().int(),
  startXp: num,
  levelsGained: z.array(z.number().int()),
  stars: z.tuple([z.boolean(), z.boolean(), z.boolean()]),
  newStars: z.number().int(),
  unlocked: z.array(z.string()),
  achievements: z.array(z.string()),
  newCollectibles: z.array(z.string()),
  /** Planet Hopper stardust banked from this run. */
  dust: num.optional(),
});

export const S2C = z.discriminatedUnion('t', [
  z.object({ t: z.literal('welcome'), playerId: id, profile: ProfileSchema, dev: z.boolean() }),
  z.object({ t: z.literal('error'), code: z.string(), message: z.string() }),
  z.object({ t: z.literal('joined'), code: z.string(), token: z.string() }),
  z.object({ t: z.literal('left') }),
  /** The host removed you from the room. */
  z.object({ t: z.literal('kicked'), message: z.string().max(200) }),
  z.object({ t: z.literal('room'), room: RoomStateSchema }),
  z.object({
    t: z.literal('matchStart'),
    courseId: z.string(),
    daily: z.string().nullable(),
    mode: ModeSchema,
    chaos: z.boolean(),
    players: z.array(z.object({ id, name: z.string() })),
    holeIndex: z.number().int(),
    tick: z.number().int(),
    st: z.number().int(),
    /** Planet Hopper: enough to regenerate every hole played so far. */
    hopper: z.object({ seed: z.number().int(), stages: z.array(StageSpecSchema).max(64) }).optional(),
  }),
  /** `tick` = hole-local sim tick (obstacle clock); `st` = monotonic server tick (clock sync). */
  z.object({
    t: z.literal('snap'),
    hole: z.number().int(),
    tick: z.number().int(),
    st: z.number().int(),
    balls: z.array(SnapBallSchema),
  }),
  z.object({
    t: z.literal('ev'),
    hole: z.number().int(),
    tick: z.number().int(),
    st: z.number().int(),
    events: z.array(MatchEventSchema),
  }),
  z.object({ t: z.literal('score'), score: ScoreStateSchema }),
  z.object({ t: z.literal('matchEnd'), score: ScoreStateSchema }),
  z.object({ t: z.literal('rewards'), profile: ProfileSchema, grant: GrantSchema }),
  z.object({ t: z.literal('profile'), profile: ProfileSchema }),
  z.object({ t: z.literal('emote'), from: id, emote: z.string() }),
  z.object({ t: z.literal('chat'), from: id, name: z.string(), text: z.string() }),
  z.object({ t: z.literal('pong'), t0: num }),
  z.object({
    t: z.literal('dailyBoard'),
    date: z.string(),
    par: z.number().int(),
    entries: z.array(z.object({ name: z.string(), strokes: z.number().int(), id: z.string() })),
  }),
]);
export type S2CMsg = z.infer<typeof S2C>;

export function parseC2S(raw: unknown): C2SMsg | null {
  const r = C2S.safeParse(raw);
  return r.success ? r.data : null;
}

export function parseS2C(raw: unknown): S2CMsg | null {
  const r = S2C.safeParse(raw);
  return r.success ? r.data : null;
}

// ---------------------------------------------------------------------------------------------
// Chat filter (stub): masks a small word list; swap for a real service in production.
// ---------------------------------------------------------------------------------------------
const BLOCKED = ['damn', 'hell', 'crap', 'stupid', 'idiot', 'dumb', 'shit', 'fuck', 'bitch', 'ass'];
const BLOCK_RE = new RegExp(`\\b(${BLOCKED.join('|')})\\w*`, 'gi');

export function filterChat(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex -- intentionally strips control characters
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, RULES.chatMaxLength)
      .replace(BLOCK_RE, (m) => m[0] + '*'.repeat(m.length - 1))
  );
}

export function sanitizeName(name: string): string {
  const n = filterChat(name).replace(/[<>]/g, '').slice(0, 20).trim();
  return n || 'Golfer';
}
