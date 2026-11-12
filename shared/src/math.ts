import type { Vec3 } from './schema';

/** Quaternion as [x, y, z, w]. */
export type Quat = [number, number, number, number];

export const QUAT_ID: Quat = [0, 0, 0, 1];

/**
 * Left and right edges of a level-across strip of `width` along `path` (mitred at the joints, so
 * the strip keeps its width round bends). Each cross-section is horizontal, so a turning, sloping
 * path makes a smooth helicoid with no seams.
 */
export function ribbonEdges(
  path: Vec3[],
  width: number,
  dir0?: number,
  dir1?: number,
): { left: Vec3[]; right: Vec3[] } {
  const n = path.length;
  const left: Vec3[] = [],
    right: Vec3[] = [];
  const dir = (a: Vec3, b: Vec3) => {
    const dx = b[0] - a[0],
      dz = b[2] - a[2];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };
  for (let i = 0; i < n; i++) {
    const d0 = dir(path[Math.max(0, i - 1)], path[Math.max(1, i)]);
    const d1 = dir(path[Math.min(n - 2, i)], path[Math.min(n - 1, i + 1)]);
    let tx = d0[0] + d1[0],
      tz = d0[1] + d1[1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    let k = width / 2 / Math.max(0.5, tx * d1[0] + tz * d1[1]);
    // An end that meets a straight floor is cut square to that floor, so the two butt together
    // with no wedge-shaped gap or overlap.
    const end = i === 0 ? dir0 : i === n - 1 ? dir1 : undefined;
    if (end !== undefined) {
      tx = Math.cos(end);
      tz = Math.sin(end);
      k = width / 2;
    }
    const p = path[i];
    left.push([p[0] - tz * k, p[1], p[2] + tx * k]);
    right.push([p[0] + tz * k, p[1], p[2] - tx * k]);
  }
  return { left, right };
}

/** Edges of a ribbon solid: explicit edge lines when it has them, else its centreline widened. */
export function solidRibbon(s: {
  path?: Vec3[];
  left?: Vec3[];
  right?: Vec3[];
  size: Vec3;
}): { left: Vec3[]; right: Vec3[] } {
  if (s.left && s.right) return { left: s.left, right: s.right };
  return ribbonEdges(s.path ?? [], s.size[2]);
}

/**
 * A low mound (spherical cap) on the green: `center` is the middle of its base on the floor,
 * `size` = [base diameter, height, base diameter]. Returns the sphere it is cut from.
 */
export function domeSphere(center: Vec3, size: Vec3): { c: Vec3; r: number } {
  const a = size[0] / 2,
    h = Math.max(0.01, size[1]);
  const r = (a * a + h * h) / (2 * h);
  return { c: [center[0], center[1] + h - r, center[2]], r };
}

/** Unit vector in the XZ plane for an angle (0 = +X, PI/2 = +Z). */
export function dirVec(angle: number): Vec3 {
  return [Math.cos(angle), 0, Math.sin(angle)];
}

/** Euler Y rotation that maps local +X onto dirVec(angle). */
export function yawFor(angle: number): number {
  return -angle;
}

export function quatAxisAngle(ax: number, ay: number, az: number, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [ax * s, ay * s, az * s, Math.cos(angle / 2)];
}

export function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Euler XYZ (same convention as THREE.Euler default) to quaternion. */
export function quatFromEuler(x: number, y: number, z: number): Quat {
  const c1 = Math.cos(x / 2),
    c2 = Math.cos(y / 2),
    c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2),
    s2 = Math.sin(y / 2),
    s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/** Quaternion from an orthonormal basis given as columns (x axis, y axis, z axis). */
export function quatFromBasis(xa: Vec3, ya: Vec3, za: Vec3): Quat {
  const m11 = xa[0],
    m12 = ya[0],
    m13 = za[0];
  const m21 = xa[1],
    m22 = ya[1],
    m23 = za[1];
  const m31 = xa[2],
    m32 = ya[2],
    m33 = za[2];
  const tr = m11 + m22 + m33;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    return [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s];
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    return [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s];
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    return [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s];
  }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
  return [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s];
}

/** Euler XYZ from quaternion (inverse of quatFromEuler). */
export function eulerFromQuat(q: Quat): Vec3 {
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z),
    m12 = 2 * (x * y - z * w),
    m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z),
    m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w),
    m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) {
    return [Math.atan2(-m23, m33), ey, Math.atan2(-m12, m11)];
  }
  return [Math.atan2(m32, m22), ey, 0];
}

export function rotateVec(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const ix = qw * vx + qy * vz - qz * vy;
  const iy = qw * vy + qz * vx - qx * vz;
  const iz = qw * vz + qx * vy - qy * vx;
  const iw = -qx * vx - qy * vy - qz * vz;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const distXZ = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[2] - b[2]);
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Is point p inside a box zone (center, size, rotation about Y only)? */
export function inYawBox(p: Vec3, center: Vec3, size: Vec3, rotY: number): boolean {
  const dx = p[0] - center[0];
  const dz = p[2] - center[2];
  // inverse-rotate by rotY (Euler Y convention)
  const c = Math.cos(rotY),
    s = Math.sin(rotY);
  const lx = c * dx - s * dz;
  const lz = s * dx + c * dz;
  return (
    Math.abs(lx) <= size[0] / 2 && Math.abs(lz) <= size[2] / 2 && Math.abs(p[1] - center[1]) <= size[1] / 2
  );
}

/**
 * Project p onto polyline path, returning distance along it (XZ, used for progress metrics).
 * `maxAlong` ignores path stretches that start beyond it (a ball beside a later leg, behind a
 * wall, hasn't really got that far).
 */
export function progressAlong(
  path: Vec3[],
  p: Vec3,
  maxAlong = Infinity,
): { along: number; dist: number; total: number } {
  let best = Infinity;
  let bestAlong = 0;
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i],
      b = path[i + 1];
    const abx = b[0] - a[0],
      abz = b[2] - a[2];
    const segLen = Math.hypot(abx, abz) || 1e-6;
    if (acc > maxAlong) {
      acc += segLen;
      continue;
    }
    let t = ((p[0] - a[0]) * abx + (p[2] - a[2]) * abz) / (segLen * segLen);
    t = clamp(t, 0, 1);
    const qx = a[0] + abx * t,
      qz = a[2] + abz * t,
      qy = a[1] + (b[1] - a[1]) * t;
    const d = Math.hypot(p[0] - qx, p[2] - qz) + Math.abs(p[1] - qy) * 0.5;
    if (d < best) {
      best = d;
      bestAlong = acc + segLen * t;
    }
    acc += segLen;
  }
  return { along: bestAlong, dist: best, total: acc };
}
