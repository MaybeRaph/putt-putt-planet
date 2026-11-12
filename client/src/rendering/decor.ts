import * as THREE from 'three';
import { hashString, rng, range, pick, type Decor, type Theme } from '@ppp/shared';
import { flat } from './materials';

/**
 * Procedural low-poly decor. Each kind is a list of parts (shared geometry + material + local
 * transform). All parts of a hole are batched into InstancedMeshes, so a lush scene costs only
 * a few dozen draw calls.
 */

interface Part {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  m: THREE.Matrix4;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    g.computeVertexNormals();
    geoCache.set(key, g);
  }
  return g;
}

const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );

const G = {
  cyl: () => geo('cyl', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 8)),
  cone: () => geo('cone', () => new THREE.ConeGeometry(0.5, 1, 7)),
  ico: () => geo('ico', () => new THREE.IcosahedronGeometry(0.5, 0)),
  ico1: () => geo('ico1', () => new THREE.IcosahedronGeometry(0.5, 1)),
  dodec: () => geo('dodec', () => new THREE.DodecahedronGeometry(0.5, 0)),
  sphere: () => geo('sphere', () => new THREE.SphereGeometry(0.5, 12, 8)),
  box: () => geo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  octa: () => geo('octa', () => new THREE.OctahedronGeometry(0.5, 0)),
  torus: () => geo('torus', () => new THREE.TorusGeometry(0.4, 0.12, 6, 14)),
  disc: () => geo('disc', () => new THREE.CylinderGeometry(0.5, 0.5, 0.12, 16)),
  gear: () =>
    geo('gear', () => {
      const shape = new THREE.Shape();
      const teeth = 10;
      for (let i = 0; i <= teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2;
        const r = i % 2 === 0 ? 0.5 : 0.4;
        const a2 = a + Math.PI / (teeth * 2);
        if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        shape.lineTo(Math.cos(a2) * r, Math.sin(a2) * r);
      }
      const hole = new THREE.Path();
      hole.absarc(0, 0, 0.14, 0, Math.PI * 2, true);
      shape.holes.push(hole);
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false });
      g.translate(0, 0, -0.07);
      return g;
    }),
};

type Kit = Theme['decorKit'];

function partsFor(kind: string, color: string | undefined, r: () => number): Part[] {
  const c = (hex: string) => flat(color ?? hex);
  switch (kind) {
    case 'tree': {
      const leaf = pick(r, ['#4caf50', '#43a047', '#66bb6a', '#2e7d32']);
      return [
        { geo: G.cyl(), mat: flat('#8d5a3b'), m: M(0, 0.6, 0, 0.28, 1.2, 0.28) },
        { geo: G.ico1(), mat: c(leaf), m: M(0, 1.7, 0, 1.8, 1.6, 1.8, r() * 6) },
        { geo: G.ico(), mat: c(leaf), m: M(0.3, 2.4, 0.1, 1.1, 1.0, 1.1, r() * 6) },
      ];
    }
    case 'pine': {
      const leaf = color ?? pick(r, ['#2e7d4f', '#357a50', '#2b6b45', '#3d8a55']);
      const dark = new THREE.Color(leaf).multiplyScalar(0.8).getStyle();
      const parts: Part[] = [{ geo: G.cyl(), mat: flat('#6d4530'), m: M(0, 0.5, 0, 0.28, 1.0, 0.28) }];
      const tiers = 5;
      for (let i = 0; i < tiers; i++) {
        const k = 1 - i / tiers;
        parts.push({ geo: G.cone(), mat: flat(i % 2 ? dark : leaf), m: M(0, 1.0 + i * 0.62, 0, 2.1 * k + 0.35, 1.25, 2.1 * k + 0.35, r() * 6) });
      }
      return parts;
    }
    case 'snowpine': {
      return [
        { geo: G.cyl(), mat: flat('#6d4c3d'), m: M(0, 0.4, 0, 0.25, 0.8, 0.25) },
        { geo: G.cone(), mat: flat('#2f6f5e'), m: M(0, 1.3, 0, 1.8, 1.5, 1.8) },
        { geo: G.cone(), mat: flat('#f4fbff'), m: M(0, 1.75, 0, 1.2, 0.6, 1.2) },
        { geo: G.cone(), mat: flat('#2f6f5e'), m: M(0, 2.2, 0, 1.3, 1.2, 1.3, 0.4) },
        { geo: G.cone(), mat: flat('#f4fbff'), m: M(0, 2.65, 0, 0.8, 0.6, 0.8) },
      ];
    }
    case 'rock':
      return [{ geo: G.dodec(), mat: c('#9aa3ad'), m: M(0, 0.2, 0, 1.2, 0.7, 1.0, r() * 6) }];
    case 'bush': {
      const leaf = pick(r, ['#5cb85c', '#4caf50', '#7cc96b']);
      return [
        { geo: G.ico1(), mat: c(leaf), m: M(0, 0.35, 0, 1.1, 0.8, 1.1) },
        { geo: G.ico1(), mat: c(leaf), m: M(0.45, 0.3, 0.2, 0.8, 0.6, 0.8) },
      ];
    }
    case 'flower': {
      const petal = pick(r, ['#ff6b9a', '#ffd23f', '#ffffff', '#b388ff', '#ff8a3d']);
      return [
        { geo: G.cyl(), mat: flat('#3e8e41'), m: M(0, 0.15, 0, 0.04, 0.3, 0.04) },
        { geo: G.ico(), mat: flat(petal), m: M(0, 0.32, 0, 0.18, 0.1, 0.18) },
      ];
    }
    case 'mushroom':
      return [
        { geo: G.cyl(), mat: flat('#f5ead6'), m: M(0, 0.15, 0, 0.12, 0.3, 0.12) },
        { geo: G.sphere(), mat: c('#e8453c'), m: M(0, 0.32, 0, 0.42, 0.24, 0.42) },
      ];
    case 'lollipop': {
      const col = color ?? pick(r, ['#ff5fa2', '#7bdff2', '#ffd166', '#b28dff', '#06d6a0']);
      return [
        { geo: G.cyl(), mat: flat('#fff7f0'), m: M(0, 1.0, 0, 0.1, 2, 0.1) },
        { geo: G.disc(), mat: flat(col), m: M(0, 2.2, 0, 1.3, 1.3, 1.3, 0, Math.PI / 2) },
        { geo: G.torus(), mat: flat('#ffffff'), m: M(0, 2.2, 0.08, 1.2, 1.2, 0.5) },
      ];
    }
    case 'gumdrop': {
      const col = color ?? pick(r, ['#ff6f91', '#ffc75f', '#845ec2', '#00c9a7', '#f9f871']);
      return [{ geo: G.sphere(), mat: flat(col), m: M(0, 0.25, 0, 0.9, 0.9, 0.9) }];
    }
    case 'candycane':
      return [
        { geo: G.cyl(), mat: flat('#ffffff'), m: M(0, 1, 0, 0.18, 2, 0.18) },
        { geo: G.cyl(), mat: flat('#ff3b5c'), m: M(0, 0.6, 0, 0.19, 0.25, 0.19) },
        { geo: G.cyl(), mat: flat('#ff3b5c'), m: M(0, 1.2, 0, 0.19, 0.25, 0.19) },
        { geo: G.torus(), mat: flat('#ff3b5c'), m: M(0.3, 2.0, 0, 0.8, 0.8, 0.8) },
      ];
    case 'donut': {
      const icing = pick(r, ['#ff8fab', '#7b4b2a', '#b5ead7', '#ffffff']);
      return [
        { geo: G.torus(), mat: flat('#e0a96d'), m: M(0, 0.25, 0, 1.6, 1.6, 2.2, 0, Math.PI / 2) },
        { geo: G.torus(), mat: flat(icing), m: M(0, 0.33, 0, 1.55, 1.55, 1.2, 0, Math.PI / 2) },
      ];
    }
    case 'snowman':
      return [
        { geo: G.sphere(), mat: flat('#ffffff'), m: M(0, 0.4, 0, 0.8, 0.8, 0.8) },
        { geo: G.sphere(), mat: flat('#ffffff'), m: M(0, 0.95, 0, 0.55, 0.55, 0.55) },
        { geo: G.sphere(), mat: flat('#ffffff'), m: M(0, 1.35, 0, 0.38, 0.38, 0.38) },
        { geo: G.cone(), mat: flat('#ff8c1a'), m: M(0, 1.36, 0.22, 0.08, 0.25, 0.08, 0, Math.PI / 2) },
        { geo: G.cyl(), mat: flat('#263238'), m: M(0, 1.6, 0, 0.3, 0.25, 0.3) },
      ];
    case 'crystal': {
      const col = color ?? pick(r, ['#bfe9ff', '#9ad8ff', '#d6f3ff']);
      return [
        { geo: G.octa(), mat: flat(col, { emissive: 0.15 }), m: M(0, 0.6, 0, 0.6, 1.6, 0.6, r()) },
        {
          geo: G.octa(),
          mat: flat(col, { emissive: 0.15 }),
          m: M(0.35, 0.35, 0.1, 0.35, 0.9, 0.35, r(), 0.3),
        },
        {
          geo: G.octa(),
          mat: flat(col, { emissive: 0.15 }),
          m: M(-0.3, 0.3, -0.1, 0.3, 0.7, 0.3, r(), -0.4),
        },
      ];
    }
    case 'iceblock':
      return [
        { geo: G.box(), mat: flat('#cdeeff', { transparent: 0.85 }), m: M(0, 0.4, 0, 0.9, 0.8, 0.9, r()) },
      ];
    case 'gear': {
      const col = color ?? pick(r, ['#c99a2e', '#9e9e9e', '#b87333']);
      return [{ geo: G.gear(), mat: flat(col), m: M(0, 1.2, 0, 2.4, 2.4, 2.4, r() * 6) }];
    }
    case 'pipe':
      return [
        { geo: G.cyl(), mat: flat('#7d8c99'), m: M(0, 1.2, 0, 0.5, 2.4, 0.5) },
        { geo: G.cyl(), mat: flat('#5b6773'), m: M(0, 2.4, 0, 0.65, 0.2, 0.65) },
        { geo: G.cyl(), mat: flat('#5b6773'), m: M(0, 0.3, 0, 0.65, 0.2, 0.65) },
      ];
    case 'chimney':
      return [
        { geo: G.box(), mat: flat('#8a4f3d'), m: M(0, 1.6, 0, 0.9, 3.2, 0.9) },
        { geo: G.box(), mat: flat('#5d3a2e'), m: M(0, 3.25, 0, 1.05, 0.2, 1.05) },
      ];
    case 'crate':
      return [{ geo: G.box(), mat: flat('#b5803f'), m: M(0, 0.4, 0, 0.8, 0.8, 0.8, r()) }];
    case 'antenna':
      return [
        { geo: G.cyl(), mat: flat('#cfd8dc'), m: M(0, 1.2, 0, 0.08, 2.4, 0.08) },
        { geo: G.sphere(), mat: flat('#ff5252', { emissive: 0.8 }), m: M(0, 2.45, 0, 0.18, 0.18, 0.18) },
        { geo: G.disc(), mat: flat('#b0bec5'), m: M(0, 1.6, 0, 1.0, 1.0, 1.0, 0, 0.5) },
      ];
    case 'spacerock':
      return [{ geo: G.dodec(), mat: c('#5c5470'), m: M(0, 0.3, 0, 1.3, 0.8, 1.1, r() * 6) }];
    case 'alienplant': {
      const col = pick(r, ['#64ffda', '#ea80fc', '#b9f6ca']);
      return [
        { geo: G.cyl(), mat: flat('#37474f'), m: M(0, 0.4, 0, 0.08, 0.8, 0.08) },
        { geo: G.sphere(), mat: flat(col, { emissive: 0.6 }), m: M(0, 0.85, 0, 0.3, 0.3, 0.3) },
      ];
    }
    case 'hill': {
      const col = color ?? '#79c26b';
      return [{ geo: G.ico1(), mat: flat(col), m: M(0, 0, 0, 14, 7, 14, r() * 6) }];
    }
    case 'mountain': {
      const col = color ?? '#8fa3b8';
      return [
        { geo: G.cone(), mat: flat(col), m: M(0, 6, 0, 18, 12, 18, r() * 6) },
        { geo: G.cone(), mat: flat('#ffffff'), m: M(0, 10.5, 0, 6.8, 3, 6.8) },
      ];
    }
    case 'planet': {
      const col = color ?? pick(r, ['#ff8a65', '#9575cd', '#4fc3f7']);
      return [
        { geo: G.sphere(), mat: flat(col, { emissive: 0.4 }), m: M(0, 0, 0, 10, 10, 10) },
        { geo: G.torus(), mat: flat('#ffe0b2', { emissive: 0.3 }), m: M(0, 0, 0, 20, 20, 4, 0, 1.2, 0.3) },
      ];
    }
    default:
      return [{ geo: G.ico(), mat: c('#999999'), m: M(0, 0.25, 0, 0.5, 0.5, 0.5) }];
  }
}

const KIT_SCATTER: Record<Kit, { near: string[]; far: string[]; backdrop: string }> = {
  meadow: {
    near: ['tree', 'tree', 'pine', 'bush', 'bush', 'flower', 'flower', 'flower', 'rock', 'mushroom'],
    far: ['tree', 'pine', 'pine'],
    backdrop: 'hill',
  },
  candy: {
    near: ['lollipop', 'gumdrop', 'gumdrop', 'candycane', 'donut', 'gumdrop'],
    far: ['lollipop', 'candycane'],
    backdrop: 'hill',
  },
  frozen: {
    near: ['snowpine', 'snowpine', 'crystal', 'snowman', 'iceblock', 'rock'],
    far: ['snowpine', 'snowpine'],
    backdrop: 'mountain',
  },
  clockwork: {
    near: ['gear', 'pipe', 'crate', 'crate', 'chimney', 'gear'],
    far: ['chimney', 'pipe', 'gear'],
    backdrop: 'mountain',
  },
  space: {
    near: ['crystal', 'spacerock', 'alienplant', 'alienplant', 'antenna', 'spacerock'],
    far: ['crystal', 'spacerock'],
    backdrop: 'planet',
  },
};

const BACKDROP_COLOR: Record<Kit, string> = {
  meadow: '#86c773',
  candy: '#ffb3d1',
  frozen: '#a9bfd6',
  clockwork: '#6e6258',
  space: '',
};

/**
 * Build all decor (authored + scattered) for a hole as instanced meshes.
 * `keepOut(x, z, margin)` is true within `margin` of the course footprint (nothing goes there).
 */
export function buildDecor(
  holeId: string,
  kit: Kit,
  authored: Decor[],
  bounds: { min: THREE.Vector3; max: THREE.Vector3 },
  keepOut: (x: number, z: number, margin: number) => boolean,
  groundY: number,
  density = 1,
  heightAt: (x: number, z: number) => number = () => groundY,
): THREE.Group {
  const r = rng(hashString(holeId + kit));
  const placements: { kind: string; pos: THREE.Vector3; scale: number; rotY: number; color?: string }[] = [];
  for (const d of authored)
    placements.push({
      kind: d.kind,
      pos: new THREE.Vector3(d.pos[0], heightAt(d.pos[0], d.pos[2]), d.pos[2]),
      scale: d.scale,
      rotY: d.rotY,
      color: d.color,
    });

  const blocked = keepOut;
  const cx = (bounds.min.x + bounds.max.x) / 2,
    cz = (bounds.min.z + bounds.max.z) / 2;
  const rx = (bounds.max.x - bounds.min.x) / 2,
    rz = (bounds.max.z - bounds.min.z) / 2;
  const kitDef = KIT_SCATTER[kit];
  const count = Math.round((70 + (rx + rz) * 3.2) * density);
  for (let i = 0, tries = 0; i < count && tries < count * 8; tries++) {
    const ring = r() < 0.45 ? range(r, 0.9, 5) : range(r, 5, 30);
    const a = r() * Math.PI * 2;
    const x = cx + Math.cos(a) * (rx + ring);
    const z = cz + Math.sin(a) * (rz + ring);
    const kind = pick(r, ring < 5 ? kitDef.near : kitDef.far);
    const isSmall = kind === 'flower' || kind === 'mushroom';
    if (blocked(x, z, isSmall ? 0.5 : 1.6)) continue;
    placements.push({
      kind,
      pos: new THREE.Vector3(x, heightAt(x, z) - 0.05, z),
      scale: range(r, 0.8, 1.4) * (ring > 6 ? 1.25 + ring / 40 : 1),
      rotY: r() * 6.28,
    });
    i++;
  }
  // Inner fill: small items close to the course for a lush look.
  const fillers = kit === 'meadow' ? ['flower', 'flower', 'bush', 'mushroom'] : kitDef.near;
  for (let i = 0, tries = 0; i < 30 * density && tries < 400; tries++) {
    const x = range(r, bounds.min.x - 2, bounds.max.x + 2);
    const z = range(r, bounds.min.z - 2, bounds.max.z + 2);
    if (blocked(x, z, 0.6)) continue;
    placements.push({
      kind: pick(r, fillers),
      pos: new THREE.Vector3(x, heightAt(x, z) - 0.02, z),
      scale: range(r, 0.5, 0.9),
      rotY: r() * 6.28,
    });
    i++;
  }
  // Backdrop: planets in the space sky (other worlds get real terrain mountains instead).
  const R = Math.max(rx, rz) + 45;
  for (let i = 0; i < 14 && kit === 'space'; i++) {
    const a = (i / 14) * Math.PI * 2 + r() * 0.3;
    const y = groundY + range(r, 30, 60);
    if (i % 4 !== 0) continue;
    placements.push({
      kind: kitDef.backdrop,
      pos: new THREE.Vector3(
        cx + Math.cos(a) * R * range(r, 0.9, 1.3),
        y,
        cz + Math.sin(a) * R * range(r, 0.9, 1.3),
      ),
      scale: range(r, 0.8, 1.5),
      rotY: r() * 6,
      color: BACKDROP_COLOR[kit] || undefined,
    });
  }

  // Batch into instanced meshes keyed by geometry+material.
  const batches = new Map<
    string,
    { geo: THREE.BufferGeometry; mat: THREE.Material; mats: THREE.Matrix4[] }
  >();
  const base = new THREE.Matrix4();
  for (const p of placements) {
    base.compose(
      p.pos,
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotY),
      new THREE.Vector3(p.scale, p.scale, p.scale),
    );
    for (const part of partsFor(p.kind, p.color, r)) {
      const key = part.geo.uuid + part.mat.uuid;
      let b = batches.get(key);
      if (!b) batches.set(key, (b = { geo: part.geo, mat: part.mat, mats: [] }));
      b.mats.push(base.clone().multiply(part.m));
    }
  }
  const group = new THREE.Group();
  group.name = 'decor';
  for (const b of batches.values()) {
    const im = new THREE.InstancedMesh(b.geo, b.mat, b.mats.length);
    b.mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  return group;
}
