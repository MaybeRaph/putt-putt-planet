import type { Collectible, CollectibleKind, Decor, HoleInput, Obstacle, Solid, Tunnel, Vec3, Zone } from '../schema';
import type { SurfaceKind } from '../config';
import { yawFor } from '../math';

/**
 * Authoring helpers. A hole is usually one `fairway` (a centreline polyline that becomes floors,
 * ramps and mitred side walls) plus extra solids, zones, obstacles and collectibles.
 */

export const FLOOR_T = 0.4;
export const WALL_H = 0.32;
export const WALL_T = 0.2;

export interface FairwayOpts {
  width?: number;
  wallH?: number;
  surface?: SurfaceKind;
  /** Extra floor beyond the first / last point (and where the end-cap wall sits). */
  endPad?: number;
  openStart?: boolean;
  openEnd?: boolean;
  /** Segment indices with no wall on that side. */
  openLeft?: number[];
  openRight?: number[];
  /** Segment indices with no floor (e.g. a gap over water). */
  noFloor?: number[];
  /** Per-segment width overrides. */
  widths?: Record<number, number>;
  /** Per-segment rail height overrides. */
  wallHs?: Record<number, number>;
  /** Segment indices whose floor gets no earth skirt (it passes over another track). */
  noSkirt?: number[];
}

const EPS = 1e-4;

function segDir(a: Vec3, b: Vec3) {
  const dx = b[0] - a[0],
    dz = b[2] - a[2];
  const l = Math.hypot(dx, dz);
  return { dx: dx / l, dz: dz / l, l, dy: b[1] - a[1], angle: Math.atan2(dz, dx) };
}

/** A box spanning a->b along its length (handles pitch), top surface on the a->b line. */
export function beam(
  a: Vec3,
  b: Vec3,
  width: number,
  thickness: number,
  role: Solid['role'],
  surface: SurfaceKind = 'grass',
  topOffset = 0,
  color?: string,
): Solid {
  const d = segDir(a, b);
  const len = Math.hypot(d.l, d.dy);
  const pitch = Math.atan2(d.dy, d.l);
  // Local -Y (box centre below the top line) rotated by pitch, then yaw.
  const down = thickness / 2 - topOffset;
  const nx = Math.sin(pitch) * d.dx,
    nz = Math.sin(pitch) * d.dz,
    ny = -Math.cos(pitch);
  const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return {
    shape: 'box',
    role,
    center: [mid[0] + nx * down, mid[1] + ny * down, mid[2] + nz * down],
    size: [len, thickness, width],
    rot: [0, yawFor(d.angle), pitch],
    surface,
    color,
  };
}

export function fairway(points: Vec3[], opts: FairwayOpts = {}): Solid[] {
  const W = opts.width ?? 2;
  const wallH = opts.wallH ?? WALL_H;
  const surface = opts.surface ?? 'grass';
  const endPad = opts.endPad ?? 0.7;
  const out: Solid[] = [];
  const n = points.length;
  const segs: ReturnType<typeof segDir>[] = [];
  for (let i = 0; i < n - 1; i++) segs.push(segDir(points[i], points[i + 1]));
  const widthOf = (i: number) => opts.widths?.[i] ?? W;
  const isFlat = (i: number) => Math.abs(segs[i].dy) < EPS;
  const turnAt = (i: number) =>
    i > 0 && i < n - 1 && Math.abs(segs[i - 1].dx * segs[i].dz - segs[i - 1].dz * segs[i].dx) > 1e-3;
  /** Floor overlap needed at joint i to close the outer wedge of the turn (w/2 at 90°). */
  const turnExt = (i: number, w: number) => {
    const c = Math.max(-1, Math.min(1, segs[i - 1].dx * segs[i].dx + segs[i - 1].dz * segs[i].dz));
    return (w / 2) * Math.min(2.5, Math.tan(Math.acos(c) / 2)) + 0.02;
  };

  // Floors
  for (let i = 0; i < segs.length; i++) {
    if (opts.noFloor?.includes(i)) continue;
    const s = segs[i];
    let a = points[i],
      b = points[i + 1];
    const w = widthOf(i);
    if (isFlat(i)) {
      let ext0 = 0,
        ext1 = 0;
      if (i === 0) ext0 = opts.openStart ? 0 : endPad;
      else if (turnAt(i)) ext0 = turnExt(i, Math.max(w, widthOf(i - 1)));
      if (i === segs.length - 1) ext1 = opts.openEnd ? 0 : endPad;
      else if (turnAt(i + 1)) ext1 = turnExt(i + 1, Math.max(w, widthOf(i + 1)));
      a = [a[0] - s.dx * ext0, a[1], a[2] - s.dz * ext0];
      b = [b[0] + s.dx * ext1, b[1], b[2] + s.dz * ext1];
    } else {
      // Sloped and turning (slides, spirals): overlap along the slope to close the outer wedge.
      const k = s.dy / s.l;
      const ext0 = turnAt(i) ? turnExt(i, w) : 0;
      const ext1 = i < segs.length - 1 && turnAt(i + 1) ? turnExt(i + 1, w) : 0;
      a = [a[0] - s.dx * ext0, a[1] - k * ext0, a[2] - s.dz * ext0];
      b = [b[0] + s.dx * ext1, b[1] + k * ext1, b[2] + s.dz * ext1];
    }
    const f = beam(a, b, w, FLOOR_T, 'floor', surface);
    if (opts.noSkirt?.includes(i)) f.skirt = false;
    out.push(f);
  }

  // Walls: offset polylines with mitred joints.
  for (const side of [1, -1] as const) {
    const open = side === 1 ? opts.openLeft : opts.openRight;
    for (let i = 0; i < segs.length; i++) {
      if (open?.includes(i)) continue;
      const off = (j: number, segIdx: number): Vec3 => {
        const s = segs[segIdx];
        const w = widthOf(segIdx) / 2 + WALL_T / 2;
        // left normal of segment = (-dz, dx) rotated; side=1 -> left
        let nx = -s.dz * side,
          nz = s.dx * side;
        let k = w;
        const neighbour = j === segIdx ? segIdx - 1 : segIdx + 1;
        if (neighbour >= 0 && neighbour < segs.length && turnAt(j)) {
          const t = segs[neighbour];
          const mx = nx + -t.dz * side,
            mz = nz + t.dx * side;
          const ml = Math.hypot(mx, mz);
          const cosHalf = (mx / ml) * nx + (mz / ml) * nz;
          nx = mx / ml;
          nz = mz / ml;
          k = w / Math.max(cosHalf, 0.3);
        }
        const p = points[j];
        return [p[0] + nx * k, p[1], p[2] + nz * k];
      };
      let a = off(i, i),
        b = off(i + 1, i);
      const s = segs[i];
      // extend to cover end pads
      if (i === 0 && !opts.openStart) a = [a[0] - s.dx * endPad, a[1], a[2] - s.dz * endPad];
      if (i === segs.length - 1 && !opts.openEnd) b = [b[0] + s.dx * endPad, b[1], b[2] + s.dz * endPad];
      // extend slightly to close mitre notches
      const e = WALL_T / 2;
      a = [a[0] - s.dx * e, a[1], a[2] - s.dz * e];
      b = [b[0] + s.dx * e, b[1], b[2] + s.dz * e];
      // A short segment beside a sharp turn: the inner mitre swallows it whole, and the
      // neighbouring rails already close the corner.
      if ((b[0] - a[0]) * s.dx + (b[2] - a[2]) * s.dz < 0.05) continue;
      const h = opts.wallHs?.[i] ?? wallH;
      out.push(beam(a, b, WALL_T, h + FLOOR_T, 'wall', 'grass', h));
    }
  }

  // End caps
  const cap = (p: Vec3, s: ReturnType<typeof segDir>, sign: number, w: number) => {
    const c: Vec3 = [
      p[0] + s.dx * sign * (endPad + WALL_T / 2),
      p[1],
      p[2] + s.dz * sign * (endPad + WALL_T / 2),
    ];
    const half = w / 2 + WALL_T;
    const a: Vec3 = [c[0] + s.dz * half, c[1], c[2] - s.dx * half];
    const b: Vec3 = [c[0] - s.dz * half, c[1], c[2] + s.dx * half];
    out.push(beam(a, b, WALL_T, wallH + FLOOR_T, 'wall', 'grass', wallH));
  };
  if (!opts.openStart) cap(points[0], segs[0], -1, widthOf(0));
  if (!opts.openEnd) cap(points[n - 1], segs[segs.length - 1], 1, widthOf(segs.length - 1));
  return out;
}

/** A smooth floor strip along a curving, sloping centreline (slides, corkscrews). */
export function ribbon(path: Vec3[], width: number, surface: SurfaceKind = 'grass', skirt = true): Solid {
  const m = path[Math.floor(path.length / 2)];
  return {
    shape: 'ribbon',
    role: 'floor',
    center: [m[0], m[1] - FLOOR_T / 2, m[2]],
    size: [1, FLOOR_T, width],
    rot: [0, 0, 0],
    surface,
    path: path.map((p) => [...p] as Vec3),
    ...(skirt ? {} : { skirt: false }),
  };
}

/** Flat rectangular floor slab from (x0,z0) to (x1,z1) with top at y. */
export function slab(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  surface: SurfaceKind = 'grass',
): Solid {
  return {
    shape: 'box',
    role: 'floor',
    center: [(x0 + x1) / 2, y - FLOOR_T / 2, (z0 + z1) / 2],
    size: [Math.abs(x1 - x0), FLOOR_T, Math.abs(z1 - z0)],
    rot: [0, 0, 0],
    surface,
  };
}

/** Straight wall between two floor points (base y taken from each point). */
export function wall(a: Vec3, b: Vec3, h = WALL_H): Solid {
  return beam(a, b, WALL_T, h + FLOOR_T, 'wall', 'grass', h);
}

/** Rectangle of walls around a slab. */
export function wallBox(x0: number, z0: number, x1: number, z1: number, y: number, h = WALL_H): Solid[] {
  const o = WALL_T / 2;
  return [
    wall([x0 - o, y, z0 - o], [x1 + o, y, z0 - o], h),
    wall([x0 - o, y, z1 + o], [x1 + o, y, z1 + o], h),
    wall([x0 - o, y, z0 - o], [x0 - o, y, z1 + o], h),
    wall([x1 + o, y, z0 - o], [x1 + o, y, z1 + o], h),
  ];
}

/** Solid block sitting on the floor at y. */
export function block(
  x: number,
  z: number,
  sx: number,
  sz: number,
  y: number,
  h = 0.5,
  rotY = 0,
  color?: string,
): Solid {
  return {
    shape: 'box',
    role: 'block',
    center: [x, y + h / 2 - 0.05, z],
    size: [sx, h + 0.1, sz],
    rot: [0, rotY, 0],
    surface: 'grass',
    color,
  };
}

export function pillar(x: number, z: number, d: number, y: number, h = 0.6, color?: string): Solid {
  return {
    shape: 'cylinder',
    role: 'block',
    center: [x, y + h / 2 - 0.05, z],
    size: [d, h + 0.1, d],
    rot: [0, 0, 0],
    surface: 'grass',
    color,
  };
}

export function zone(
  kind: Zone['kind'],
  x: number,
  z: number,
  sx: number,
  sz: number,
  y: number,
  extra: { dir?: number; strength?: number; rotY?: number; h?: number } = {},
): Zone {
  // Water volumes sit just below the playing surface so balls rolling over bridges are safe;
  // a ball that drops below the surface level inside the zone is in the water.
  const h = extra.h ?? (kind === 'water' ? 2 : 1);
  return {
    kind,
    center: [x, kind === 'water' ? y - 0.12 - h / 2 : y + h / 2 - 0.05, z],
    size: [sx, h, sz],
    rotY: extra.rotY ?? 0,
    dir: extra.dir ?? 0,
    strength: extra.strength ?? 1,
  };
}

/** Collectible ids are derived from hole + kind + position so they stay stable across edits elsewhere. */
export function item(holeId: string, kind: CollectibleKind, x: number, y: number, z: number): Collectible {
  return { id: `${holeId}:${kind}@${x.toFixed(1)},${z.toFixed(1)}`, kind, pos: [x, y + 0.3, z] };
}

/** A line of coins between two floor points. */
export function coinLine(holeId: string, a: Vec3, b: Vec3, count: number): Collectible[] {
  const out: Collectible[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    out.push(
      item(holeId, 'coin', a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t),
    );
  }
  return out;
}

export function decor(
  kind: string,
  x: number,
  y: number,
  z: number,
  scale = 1,
  rotY = 0,
  color?: string,
): Decor {
  return { kind, pos: [x, y, z], scale, rotY, color };
}

export interface HoleSpec {
  id: string;
  name: string;
  par: number;
  /** Fairway centreline: first point = tee, last point = cup (unless tee/cup overridden). */
  points: Vec3[];
  fairway?: FairwayOpts | false;
  tee?: Vec3;
  cup?: Vec3;
  path?: Vec3[];
  solids?: Solid[];
  zones?: Zone[];
  obstacles?: Obstacle[];
  collectibles?: Collectible[];
  decor?: Decor[];
  tunnels?: Tunnel[];
  tip?: string;
  gravityScale?: number;
}

export function makeHole(spec: HoleSpec): HoleInput {
  const solids = spec.fairway === false ? [] : fairway(spec.points, spec.fairway ?? {});
  return {
    id: spec.id,
    name: spec.name,
    par: spec.par,
    tee: spec.tee ?? spec.points[0],
    cup: spec.cup ?? spec.points[spec.points.length - 1],
    solids: [...solids, ...(spec.solids ?? [])],
    zones: spec.zones ?? [],
    obstacles: spec.obstacles ?? [],
    collectibles: spec.collectibles ?? [],
    decor: spec.decor ?? [],
    tunnels: spec.tunnels ?? [],
    path: spec.path ?? spec.points,
    tip: spec.tip,
    gravityScale: spec.gravityScale ?? 1,
  };
}

export type Side = 'xmin' | 'xmax' | 'zmin' | 'zmax';

/**
 * Rectangular floor area with walls on all four sides, except the given openings
 * (ranges along that side, in world coordinates) where fairways connect.
 */
export function room(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  openings: { side: Side; from: number; to: number }[] = [],
  surface: SurfaceKind = 'grass',
  h = WALL_H,
): Solid[] {
  const o = WALL_T / 2;
  const out: Solid[] = [slab(x0, z0, x1, z1, y, surface)];
  const sides: { side: Side; fixed: number; lo: number; hi: number; axis: 'x' | 'z' }[] = [
    { side: 'zmin', fixed: z0 - o, lo: x0 - 2 * o, hi: x1 + 2 * o, axis: 'x' },
    { side: 'zmax', fixed: z1 + o, lo: x0 - 2 * o, hi: x1 + 2 * o, axis: 'x' },
    { side: 'xmin', fixed: x0 - o, lo: z0 - 2 * o, hi: z1 + 2 * o, axis: 'z' },
    { side: 'xmax', fixed: x1 + o, lo: z0 - 2 * o, hi: z1 + 2 * o, axis: 'z' },
  ];
  for (const s of sides) {
    const gaps = openings.filter((g) => g.side === s.side).sort((a, b) => a.from - b.from);
    let cur = s.lo;
    const segs: [number, number][] = [];
    for (const g of gaps) {
      if (g.from - o > cur) segs.push([cur, g.from - o]);
      cur = Math.max(cur, g.to + o);
    }
    if (cur < s.hi) segs.push([cur, s.hi]);
    for (const [a, b] of segs) {
      if (b - a < 0.05) continue;
      const pa: Vec3 = s.axis === 'x' ? [a, y, s.fixed] : [s.fixed, y, a];
      const pb: Vec3 = s.axis === 'x' ? [b, y, s.fixed] : [s.fixed, y, b];
      out.push(wall(pa, pb, h));
    }
  }
  return out;
}
