import { quatFromEuler, rotateVec, solidRibbon, type Solid, type Vec3, type Zone } from '@ppp/shared';

type P2 = [number, number];

/**
 * The course's exact ground footprint (floors, rails, blocks, ponds) rasterised onto a grid,
 * with a distance field so scenery can ask "how far is this spot from the course?" in O(1).
 * Diagonal fairways, curves and corkscrews keep only the ground they really cover clear, so
 * grass and flowers grow right up to the rails.
 */
export class Footprint {
  private readonly cell = 0.2;
  private readonly x0: number;
  private readonly z0: number;
  private readonly nx: number;
  private readonly nz: number;
  /** Distance (m) from each cell centre to the nearest covered cell (0 = covered). */
  private readonly dist: Float32Array;
  private static readonly FAR = 99;

  constructor(solids: Solid[], zones: Zone[], min: Vec3, max: Vec3) {
    const pad = 3;
    this.x0 = min[0] - pad;
    this.z0 = min[2] - pad;
    this.nx = Math.max(1, Math.ceil((max[0] - min[0] + 2 * pad) / this.cell));
    this.nz = Math.max(1, Math.ceil((max[2] - min[2] + 2 * pad) / this.cell));
    const covered = new Uint8Array(this.nx * this.nz);
    for (const s of solids) for (const poly of solidPolys(s)) this.fill(covered, poly);
    for (const z of zones) if (z.kind === 'water') this.fill(covered, rectPoly(z.center, z.size[0], z.size[2], z.rotY));
    this.dist = this.distanceField(covered);
  }

  /** True if (x, z) is on the course or within `margin` metres of it. */
  near(x: number, z: number, margin: number): boolean {
    const i = Math.floor((x - this.x0) / this.cell),
      j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) {
      // Outside the grid: measure to the grid's edge and add the edge cell's own distance.
      const ci = Math.max(0, Math.min(this.nx - 1, i)),
        cj = Math.max(0, Math.min(this.nz - 1, j));
      const off = Math.hypot((i - ci) * this.cell, (j - cj) * this.cell);
      return this.dist[cj * this.nx + ci] + off < margin;
    }
    return this.dist[j * this.nx + i] < margin + this.cell * 0.5;
  }

  private fill(grid: Uint8Array, poly: P2[]): void {
    if (poly.length < 3) return;
    let a = Infinity,
      b = -Infinity,
      c = Infinity,
      d = -Infinity;
    for (const [x, z] of poly) {
      a = Math.min(a, x);
      b = Math.max(b, x);
      c = Math.min(c, z);
      d = Math.max(d, z);
    }
    const i0 = Math.max(0, Math.floor((a - this.x0) / this.cell)),
      i1 = Math.min(this.nx - 1, Math.floor((b - this.x0) / this.cell));
    const j0 = Math.max(0, Math.floor((c - this.z0) / this.cell)),
      j1 = Math.min(this.nz - 1, Math.floor((d - this.z0) / this.cell));
    // Orientation of the (convex) polygon, so "inside" is the same side of every edge.
    let area = 0;
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k],
        q = poly[(k + 1) % poly.length];
      area += p[0] * q[1] - q[0] * p[1];
    }
    const sgn = area >= 0 ? 1 : -1;
    for (let j = j0; j <= j1; j++) {
      const z = this.z0 + (j + 0.5) * this.cell;
      for (let i = i0; i <= i1; i++) {
        const x = this.x0 + (i + 0.5) * this.cell;
        let inside = true;
        for (let k = 0; k < poly.length && inside; k++) {
          const p = poly[k],
            q = poly[(k + 1) % poly.length];
          // A little slack (half a cell) so thin rails still mark the cells they cross.
          const cross = (q[0] - p[0]) * (z - p[1]) - (q[1] - p[1]) * (x - p[0]);
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
          if ((sgn * cross) / len < -this.cell * 0.5) inside = false;
        }
        if (inside) grid[j * this.nx + i] = 1;
      }
    }
  }

  /** Two-pass chamfer distance transform (metres). */
  private distanceField(covered: Uint8Array): Float32Array {
    const { nx, nz } = this;
    const d = new Float32Array(nx * nz);
    for (let k = 0; k < d.length; k++) d[k] = covered[k] ? 0 : Footprint.FAR;
    const a = this.cell,
      b = this.cell * Math.SQRT2;
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        let v = d[k];
        if (i > 0) v = Math.min(v, d[k - 1] + a);
        if (j > 0) {
          v = Math.min(v, d[k - nx] + a);
          if (i > 0) v = Math.min(v, d[k - nx - 1] + b);
          if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + b);
        }
        d[k] = v;
      }
    for (let j = nz - 1; j >= 0; j--)
      for (let i = nx - 1; i >= 0; i--) {
        const k = j * nx + i;
        let v = d[k];
        if (i < nx - 1) v = Math.min(v, d[k + 1] + a);
        if (j < nz - 1) {
          v = Math.min(v, d[k + nx] + a);
          if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + b);
          if (i > 0) v = Math.min(v, d[k + nx - 1] + b);
        }
        d[k] = v;
      }
    return d;
  }
}

function rectPoly(c: Vec3, sx: number, sz: number, rotY: number): P2[] {
  const cs = Math.cos(rotY),
    sn = Math.sin(rotY);
  // Euler Y rotation: local (x, z) -> world (x cos + z sin, -x sin + z cos).
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => {
    const x = (u * sx) / 2,
      z = (v * sz) / 2;
    return [c[0] + x * cs + z * sn, c[2] - x * sn + z * cs] as P2;
  });
}

function circlePoly(x: number, z: number, r: number): P2[] {
  const out: P2[] = [];
  for (let k = 0; k < 12; k++) out.push([x + Math.cos((k / 12) * Math.PI * 2) * r, z + Math.sin((k / 12) * Math.PI * 2) * r]);
  return out;
}

/** Convex XZ outlines covering a solid. */
function solidPolys(s: Solid): P2[][] {
  if (s.shape === 'ribbon') {
    const { left, right } = solidRibbon(s);
    const out: P2[][] = [];
    for (let i = 0; i < left.length - 1; i++)
      out.push([
        [left[i][0], left[i][2]],
        [left[i + 1][0], left[i + 1][2]],
        [right[i + 1][0], right[i + 1][2]],
        [right[i][0], right[i][2]],
      ]);
    return out;
  }
  if (s.shape === 'dome') return [circlePoly(s.center[0], s.center[2], s.size[0] / 2)];
  if (s.shape === 'cylinder') return [circlePoly(s.center[0], s.center[2], s.size[0] / 2)];
  // Box: hull of its 8 corners seen from above (handles yaw, pitch and roll).
  const q = quatFromEuler(s.rot[0], s.rot[1], s.rot[2]);
  const pts: P2[] = [];
  for (const sx of [-0.5, 0.5])
    for (const sy of [-0.5, 0.5])
      for (const sz of [-0.5, 0.5]) {
        const c = rotateVec(q, [s.size[0] * sx, s.size[1] * sy, s.size[2] * sz]);
        pts.push([s.center[0] + c[0], s.center[2] + c[2]]);
      }
  return [hull(pts)];
}

function hull(p: P2[]): P2[] {
  const pts = [...p].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P2[] = [],
    upper: P2[] = [];
  for (const q of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (const q of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
