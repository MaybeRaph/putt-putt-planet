import type { Obstacle, Solid, Vec3 } from '../schema';
import {
  type Quat,
  QUAT_ID,
  add,
  cross,
  dirVec,
  eulerFromQuat,
  lerp3,
  norm,
  quatAxisAngle,
  quatFromBasis,
  quatMul,
  rotateVec,
  scale,
  yawFor,
} from '../math';

/**
 * Obstacles are reusable parametric components. Each one can contribute:
 *  - static solids (fixed geometry, e.g. the windmill base or a loop track), and/or
 *  - a kinematic body made of parts, whose pose is a pure function of time.
 * Both the physics (client + server) and the renderer use these functions, so moving
 * machinery stays perfectly in sync with no network traffic.
 */

export interface KinematicPart {
  shape: 'box' | 'cylinder';
  size: Vec3; // box: full extents; cylinder: [diameter, height, diameter]
  offset: Vec3;
  rot: Quat;
  /** Visual hint for renderer. */
  look: 'blade' | 'bar' | 'platform' | 'block';
}

export interface Pose {
  p: Vec3;
  q: Quat;
}

const yawQuat = (angle: number): Quat => quatAxisAngle(0, 1, 0, yawFor(angle));

/** Windmill dimensions derived from params. Local frame: +X = fairway direction through the tunnel. */
function windmillDims(o: Extract<Obstacle, { type: 'windmill' }>) {
  const depth = 1.3;
  const tunnelH = 0.62;
  const hubH = o.bladeLength + 0.06;
  const height = hubH + 0.8;
  return { depth, tunnelH, hubH, height };
}

export function obstacleSolids(o: Obstacle): Solid[] {
  switch (o.type) {
    case 'windmill': {
      const { depth, tunnelH, height } = windmillDims(o);
      const q = yawQuat(o.rotY);
      const sideW = (o.baseWidth - o.tunnelWidth) / 2;
      const mk = (local: Vec3, size: Vec3): Solid => ({
        shape: 'box',
        role: 'block',
        center: add(o.pos, rotateVec(q, local)),
        size,
        rot: [0, yawFor(o.rotY), 0],
        surface: 'grass',
        color: o.color ?? '#d9573b',
      });
      const zOff = o.tunnelWidth / 2 + sideW / 2;
      return [
        mk([0, height / 2, zOff], [depth, height, sideW]),
        mk([0, height / 2, -zOff], [depth, height, sideW]),
        mk([0, tunnelH + (height - tunnelH) / 2, 0], [depth, height - tunnelH, o.tunnelWidth]),
      ];
    }
    case 'spinner':
      return [
        {
          shape: 'cylinder',
          role: 'block',
          center: add(o.pos, [0, 0.3, 0]),
          size: [0.3, 0.6, 0.3],
          rot: [0, 0, 0],
          surface: 'metal',
          color: '#ffd166',
        },
      ];
    case 'bumper':
      return [
        {
          shape: 'cylinder',
          role: 'block',
          center: add(o.pos, [0, o.height / 2, 0]),
          size: [o.radius * 2, o.height, o.radius * 2],
          rot: [0, 0, 0],
          surface: 'rubber',
          restitution: 1.05,
          color: '#ff4f8b',
        },
      ];
    case 'loop':
      return loopSolids(o);
    case 'mover':
    case 'teleporter':
      return [];
  }
}

function loopSolids(o: Extract<Obstacle, { type: 'loop' }>): Solid[] {
  const f = dirVec(o.rotY);
  const s = dirVec(o.rotY + Math.PI / 2);
  const u: Vec3 = [0, 1, 0];
  const R = o.radius;
  const n = o.segments;
  const thick = 0.14;
  const out: Solid[] = [];
  const point = (phi: number): Vec3 =>
    add(
      add(add(o.pos, scale(f, R * Math.sin(phi))), scale(u, R - R * Math.cos(phi))),
      scale(s, (o.shift * phi) / (Math.PI * 2)),
    );
  // Follow the true helix tangent (including the sideways drift) so consecutive segments and
  // rails form a continuous track with no ledges for the ball to catch on.
  const lateral = o.shift / (Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = ((i + 1) / n) * Math.PI * 2;
    const m = (a + b) / 2;
    const pa = point(a),
      pb = point(b);
    const chord = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
    const T = norm(add(add(scale(f, R * Math.cos(m)), scale(u, R * Math.sin(m))), scale(s, lateral)));
    const N = norm(add(scale(f, -Math.sin(m)), scale(u, Math.cos(m))));
    const B = cross(T, N);
    const q = quatFromBasis(T, N, B);
    const rot = eulerFromQuat(q);
    const mid = lerp3(pa, pb, 0.5);
    out.push({
      shape: 'box',
      role: 'floor',
      center: add(mid, scale(N, -thick / 2)),
      size: [chord * 1.12, thick, o.width],
      rot,
      surface: 'metal',
      color: '#9fb4c8',
    });
    for (const side of [-1, 1]) {
      out.push({
        shape: 'box',
        role: 'wall',
        center: add(add(mid, scale(N, 0.14)), scale(B, side * (o.width / 2 + 0.05))),
        size: [chord * 1.12, 0.34, 0.08],
        rot,
        surface: 'metal',
        color: '#5d7189',
      });
    }
  }
  return out;
}

/** Parts of the kinematic body (in body-local space), or null if the obstacle has none. */
export function kinematicParts(o: Obstacle): KinematicPart[] | null {
  switch (o.type) {
    case 'windmill': {
      const parts: KinematicPart[] = [];
      const L = o.bladeLength;
      for (let k = 0; k < 4; k++) {
        const q = quatAxisAngle(1, 0, 0, (k * Math.PI) / 2);
        parts.push({
          shape: 'box',
          size: [0.08, L, 0.38],
          offset: rotateVec(q, [0, L / 2 + 0.12, 0]),
          rot: q,
          look: 'blade',
        });
      }
      return parts;
    }
    case 'spinner': {
      const parts: KinematicPart[] = [];
      const half = o.length / 2;
      for (let k = 0; k < o.arms; k++) {
        const q = quatAxisAngle(0, 1, 0, (k * Math.PI * 2) / o.arms);
        parts.push({
          shape: 'box',
          size: [half, o.height, o.thickness],
          offset: rotateVec(q, [half / 2 + 0.1, 0, 0]),
          rot: q,
          look: 'bar',
        });
      }
      return parts;
    }
    case 'mover':
      return [
        {
          shape: 'box',
          size: o.size,
          offset: [0, 0, 0],
          rot: QUAT_ID,
          look: o.role === 'floor' ? 'platform' : 'block',
        },
      ];
    default:
      return null;
  }
}

/** World pose of an obstacle's kinematic body at time t (seconds since hole start). */
export function obstaclePose(o: Obstacle, t: number): Pose {
  switch (o.type) {
    case 'windmill': {
      const { depth, hubH } = windmillDims(o);
      const yq = yawQuat(o.rotY);
      const p = add(o.pos, rotateVec(yq, [-depth / 2 - 0.12, hubH, 0]));
      const spin = quatAxisAngle(1, 0, 0, o.phase + o.speed * t);
      return { p, q: quatMul(yq, spin) };
    }
    case 'spinner': {
      const p = add(o.pos, [0, o.height / 2 + 0.01, 0]);
      return { p, q: quatAxisAngle(0, 1, 0, o.phase + o.speed * t) };
    }
    case 'mover': {
      const k = (1 - Math.cos((Math.PI * 2 * t) / o.period + o.phase)) / 2;
      return { p: lerp3(o.from, o.to, k), q: yawQuat(o.rotY) };
    }
    default:
      return { p: 'pos' in o ? o.pos : [0, 0, 0], q: QUAT_ID };
  }
}

/** Windmill tower dimensions for the renderer. */
export function windmillVisual(o: Extract<Obstacle, { type: 'windmill' }>) {
  return windmillDims(o);
}
