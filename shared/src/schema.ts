import { z } from 'zod';

/**
 * Course schema. Courses are authored as TypeScript data (see ./courses) using builder helpers,
 * but anything that parses with `CourseSchema` (e.g. a hand-written .json file) is loadable.
 * Angles are radians. Y is up. Sizes are full extents (not half extents).
 */

const num = z.number().finite();
export const Vec3Schema = z.tuple([num, num, num]);
export const Vec2Schema = z.tuple([num, num]);
export type Vec3 = z.infer<typeof Vec3Schema>;
export type Vec2 = z.infer<typeof Vec2Schema>;

export const SurfaceSchema = z.enum(['grass', 'sand', 'ice', 'sticky', 'rubber', 'metal', 'candy']);

export const SolidSchema = z.object({
  shape: z.enum(['box', 'cylinder']),
  /** floor: walkable, checker-rendered. wall: rail. block: solid obstacle. */
  role: z.enum(['floor', 'wall', 'block']),
  center: Vec3Schema,
  /** box: [sx, sy, sz]; cylinder: [diameter, height, diameter]. */
  size: Vec3Schema,
  /** Euler XYZ rotation. */
  rot: Vec3Schema.default([0, 0, 0]),
  surface: SurfaceSchema.default('grass'),
  restitution: num.optional(),
  color: z.string().optional(),
});
export type Solid = z.infer<typeof SolidSchema>;

export const ZoneSchema = z.object({
  kind: z.enum(['sand', 'ice', 'sticky', 'boost', 'conveyor', 'water', 'lowGravity', 'oneWay']),
  center: Vec3Schema,
  size: Vec3Schema,
  rotY: num.default(0),
  /** Direction (radians around Y, 0 = +X) for boost / conveyor / oneWay. */
  dir: num.default(0),
  /** boost: target speed; conveyor: acceleration; lowGravity: gravity multiplier. */
  strength: num.default(1),
});
export type Zone = z.infer<typeof ZoneSchema>;

const ObstacleBase = { id: z.string(), phase: num.default(0) };

export const ObstacleSchema = z.discriminatedUnion('type', [
  z.object({
    ...ObstacleBase,
    type: z.literal('windmill'),
    /** Centre of the base, at floor level. */
    pos: Vec3Schema,
    /** Direction the fairway runs through the tunnel. */
    rotY: num.default(0),
    speed: num.default(1.2),
    bladeLength: num.default(1.9),
    tunnelWidth: num.default(0.75),
    baseWidth: num.default(2.4),
    color: z.string().optional(),
  }),
  z.object({
    ...ObstacleBase,
    type: z.literal('spinner'),
    pos: Vec3Schema,
    length: num.default(2),
    arms: z.number().int().min(1).max(4).default(2),
    speed: num.default(1),
    height: num.default(0.35),
    thickness: num.default(0.18),
  }),
  z.object({
    ...ObstacleBase,
    type: z.literal('mover'),
    size: Vec3Schema,
    from: Vec3Schema,
    to: Vec3Schema,
    /** Seconds for a full back-and-forth cycle. */
    period: num.default(4),
    rotY: num.default(0),
    role: z.enum(['floor', 'block']).default('block'),
  }),
  z.object({
    ...ObstacleBase,
    type: z.literal('bumper'),
    pos: Vec3Schema,
    radius: num.default(0.35),
    height: num.default(0.4),
    strength: num.default(1),
  }),
  z.object({
    ...ObstacleBase,
    type: z.literal('teleporter'),
    a: Vec3Schema,
    b: Vec3Schema,
    exitDir: num.default(0),
    radius: num.default(0.4),
  }),
  z.object({
    ...ObstacleBase,
    type: z.literal('loop'),
    /** Floor point where the loop starts. */
    pos: Vec3Schema,
    rotY: num.default(0),
    radius: num.default(1.1),
    width: num.default(0.9),
    /** Sideways offset accumulated over the loop so the exit clears the entry. */
    shift: num.default(1.0),
    segments: z.number().int().default(28),
  }),
]);
export type Obstacle = z.infer<typeof ObstacleSchema>;
export type ObstacleType = Obstacle['type'];

export const CollectibleSchema = z.object({
  id: z.string(),
  kind: z.enum(['coin', 'gem', 'golden', 'crate']),
  pos: Vec3Schema,
});
export type Collectible = z.infer<typeof CollectibleSchema>;
export type CollectibleKind = Collectible['kind'];

export const DecorSchema = z.object({
  kind: z.string(),
  pos: Vec3Schema,
  scale: num.default(1),
  rotY: num.default(0),
  color: z.string().optional(),
});
export type Decor = z.infer<typeof DecorSchema>;

export const ThemeSchema = z.object({
  skyTop: z.string(),
  skyBottom: z.string(),
  fog: z.string(),
  fogNear: num,
  fogFar: num,
  floorA: z.string(),
  floorB: z.string(),
  wall: z.string(),
  wallTop: z.string(),
  block: z.string(),
  ground: z.string(),
  water: z.string(),
  sun: z.string(),
  sunIntensity: num,
  ambient: z.string(),
  decorKit: z.enum(['meadow', 'candy', 'frozen', 'clockwork', 'space']),
  music: z.object({
    root: num,
    scale: z.enum(['major', 'minor', 'dorian', 'lydian', 'pentatonic']),
    bpm: num,
  }),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const HoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  par: z.number().int().min(1).max(8),
  tee: Vec3Schema,
  cup: Vec3Schema,
  solids: z.array(SolidSchema),
  zones: z.array(ZoneSchema).default([]),
  obstacles: z.array(ObstacleSchema).default([]),
  collectibles: z.array(CollectibleSchema).default([]),
  decor: z.array(DecorSchema).default([]),
  /** Authored centreline tee -> cup (camera hints, rescue, solver). */
  path: z.array(Vec3Schema).min(2),
  tip: z.string().optional(),
  gravityScale: num.default(1),
  /** Per-hole look override (procedural runs travel through several worlds). */
  theme: ThemeSchema.optional(),
  /** Cup radius multiplier (run trinkets / omens). */
  cupScale: num.min(0.5).max(2).default(1),
  /** Shot speed multiplier. */
  powerScale: num.min(0.5).max(1.6).default(1),
  /** Constant wind acceleration on moving balls, [x, z] units/s^2. */
  wind: Vec2Schema.default([0, 0]),
});
export type Hole = z.infer<typeof HoleSchema>;
export type HoleInput = z.input<typeof HoleSchema>;


export const CourseSchema = z.object({
  id: z.string(),
  name: z.string(),
  world: z.string(),
  description: z.string(),
  theme: ThemeSchema,
  holes: z.array(HoleSchema).min(1),
});
export type Course = z.infer<typeof CourseSchema>;
export type CourseInput = z.input<typeof CourseSchema>;

export function parseCourse(data: unknown): Course {
  return CourseSchema.parse(data);
}
