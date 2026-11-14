import * as THREE from 'three';
import { hashString, rng, range, pick, type Decor, type Theme } from '@ppp/shared';
import { flat } from './materials';
import { natureActive, naturePartsFor } from './nature';
import { enableSceneryFade, fadeBaseAttribute } from './fade';

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

/** A model pick: one of `names`, `height` metres tall (or scaled by `scale` if height is 0). */
const MODEL: Record<string, { names: string[]; height: number; scale?: number }> = {
  tree: { names: ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5'], height: 4.8 },
  pine: { names: ['Pine_1', 'Pine_2', 'Pine_3', 'Pine_4', 'Pine_5'], height: 5.6 },
  snowpine: { names: ['Pine_1', 'Pine_2', 'Pine_3', 'Pine_4', 'Pine_5'], height: 4.8 },
  deadtree: { names: ['DeadTree_1', 'DeadTree_3'], height: 5.2 },
  bush: { names: ['Bush_Common', 'Bush_Common', 'Bush_Common_Flowers'], height: 1.15 },
  fern: { names: ['Fern_1', 'Plant_1_Big', 'Plant_7_Big'], height: 0, scale: 0.55 },
  flower: { names: ['Flower_3_Group', 'Flower_4_Group', 'Clover_1', 'Clover_1'], height: 0, scale: 0.28 },
  mushroom: { names: ['Mushroom_Common'], height: 0, scale: 0.75 },
  rock: { names: ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3'], height: 0, scale: 0.42 },
  spacerock: { names: ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3'], height: 0, scale: 0.5 },
  pebble: { names: ['Pebble_Round_1', 'Pebble_Round_3'], height: 0, scale: 1.1 },
};

/** Stylised model parts for a decor kind, or null to use the procedural shape. */
function modelParts(kind: string, kit: Kit, r: () => number): Part[] | null {
  const def = MODEL[kind];
  if (!def) return null;
  return naturePartsFor(pick(r, def.names), kit, def.height, def.scale);
}

function partsFor(kind: string, color: string | undefined, r: () => number, kit: Kit = 'meadow'): Part[] {
  if (natureActive()) {
    const parts = modelParts(kind, kit, r);
    if (parts) return parts;
  }
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

const TALL = new Set(['tree', 'pine', 'snowpine', 'deadtree', 'lollipop', 'chimney', 'pipe', 'antenna']);

/**
 * Rough ground radius of each kind at scale 1 (m): props keep this far apart (trunks and rocks
 * never grow into each other) and authored props are kept this far off the course.
 */
const FOOT_R: Record<string, number> = {
  tree: 1.4,
  pine: 1.7,
  snowpine: 1.5,
  deadtree: 1.5,
  bush: 0.7,
  rock: 0.75,
  spacerock: 0.75,
  lollipop: 0.75,
  gumdrop: 0.5,
  candycane: 0.45,
  donut: 0.85,
  crystal: 0.5,
  snowman: 0.45,
  iceblock: 0.5,
  gear: 1.0,
  pipe: 0.4,
  chimney: 0.6,
  crate: 0.5,
  antenna: 0.5,
  alienplant: 0.3,
  fern: 0.45,
  flower: 0.2,
  mushroom: 0.2,
  pebble: 0.2,
};
const SMALL = new Set(['flower', 'mushroom', 'fern', 'pebble', 'alienplant']);
const footR = (kind: string, scale: number) => (FOOT_R[kind] ?? 0.5) * scale;

/** Scatter lists when the stylised models are in use (the procedural props stay for flavour). */
const KIT_SCATTER_MODELS: Record<Kit, { near: string[]; far: string[]; fill: string[] }> = {
  meadow: {
    near: ['tree', 'tree', 'pine', 'pine', 'bush', 'bush', 'fern', 'flower', 'flower', 'rock', 'mushroom'],
    far: ['tree', 'pine', 'pine', 'tree', 'pine'],
    fill: ['flower', 'flower', 'fern', 'bush', 'mushroom', 'pebble'],
  },
  candy: {
    near: ['tree', 'lollipop', 'gumdrop', 'bush', 'candycane', 'donut', 'gumdrop', 'tree'],
    far: ['tree', 'pine', 'lollipop', 'tree'],
    fill: ['flower', 'gumdrop', 'bush', 'flower'],
  },
  frozen: {
    near: ['snowpine', 'snowpine', 'snowpine', 'rock', 'crystal', 'snowman', 'bush', 'iceblock'],
    far: ['snowpine', 'snowpine', 'snowpine', 'tree'],
    fill: ['bush', 'rock', 'crystal', 'pebble'],
  },
  clockwork: {
    near: ['gear', 'pipe', 'crate', 'tree', 'deadtree', 'rock', 'chimney', 'bush'],
    far: ['tree', 'deadtree', 'chimney', 'pine', 'tree'],
    fill: ['bush', 'fern', 'crate', 'pebble'],
  },
  space: {
    near: ['crystal', 'spacerock', 'alienplant', 'tree', 'antenna', 'spacerock', 'alienplant'],
    far: ['crystal', 'spacerock', 'tree'],
    fill: ['alienplant', 'crystal', 'pebble'],
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
  /** Solid course only (floors, rails, blocks; not ponds): what a prop must never poke into. */
  onCourse: (x: number, z: number, margin: number) => boolean = () => false,
): THREE.Group {
  const r = rng(hashString(holeId + kit));
  /** `far`: beyond the shadow map round the course, so it needn't render into it. */
  const placements: { kind: string; pos: THREE.Vector3; scale: number; rotY: number; color?: string; far?: boolean }[] = [];
  /** Ground taken by big props so far (small ones may tuck in between). */
  const taken: { x: number; z: number; r: number }[] = [];
  const crowded = (x: number, z: number, rad: number, small: boolean) =>
    taken.some((t) => Math.hypot(t.x - x, t.z - z) < (t.r + rad) * (small ? 0.45 : 0.9));
  for (const d of authored) {
    let x = d.pos[0],
      z = d.pos[2];
    const ground = heightAt(x, z);
    const rad = footR(d.kind, d.scale);
    let y = ground;
    if (onCourse(x, z, 0) && d.pos[1] > ground + 0.6) {
      // Standing on top of the course (a rock on a corkscrew's tower): keep its height.
      y = d.pos[1];
    } else if (onCourse(x, z, rad * 0.85)) {
      // Would poke through a rail or green: slide it out to the nearest clear spot, else drop it.
      let best: [number, number] | null = null;
      for (let step = 0.3; step <= 2.7 && !best; step += 0.3)
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const nx = x + Math.cos(a) * step,
            nz = z + Math.sin(a) * step;
          if (!onCourse(nx, nz, rad * 0.85)) {
            best = [nx, nz];
            break;
          }
        }
      if (!best) continue;
      [x, z] = best;
      y = heightAt(x, z);
    }
    if (!SMALL.has(d.kind) && y === ground && crowded(x, z, rad, false)) continue;
    placements.push({
      kind: d.kind,
      pos: new THREE.Vector3(x, y, z),
      scale: d.scale,
      rotY: d.rotY,
      color: d.color,
    });
    if (!SMALL.has(d.kind)) taken.push({ x, z, r: rad });
  }

  const blocked = keepOut;
  const cx = (bounds.min.x + bounds.max.x) / 2,
    cz = (bounds.min.z + bounds.max.z) / 2;
  const rx = (bounds.max.x - bounds.min.x) / 2,
    rz = (bounds.max.z - bounds.min.z) / 2;
  const models = natureActive();
  const kitDef = models ? { ...KIT_SCATTER[kit], ...KIT_SCATTER_MODELS[kit] } : KIT_SCATTER[kit];
  const count = Math.round((70 + (rx + rz) * 3.2) * density);
  for (let i = 0, tries = 0; i < count && tries < count * 8; tries++) {
    const ring = r() < 0.45 ? range(r, 0.9, 5) : range(r, 5, 30);
    const a = r() * Math.PI * 2;
    const x = cx + Math.cos(a) * (rx + ring);
    const z = cz + Math.sin(a) * (rz + ring);
    let kind = pick(r, ring < 5 ? kitDef.near : kitDef.far);
    // Full-size model trees would wall in the camera right beside the rails: close in, keep to
    // low plants and rocks, and let the trees start a few metres out.
    if (models && ring < 3.2 && TALL.has(kind)) kind = pick(r, KIT_SCATTER_MODELS[kit].fill);
    const isSmall = kind === 'flower' || kind === 'mushroom' || kind === 'fern' || kind === 'pebble';
    const scale = range(r, 0.8, 1.4) * (ring > 6 ? 1.25 + ring / 40 : 1);
    const rad = footR(kind, scale);
    if (blocked(x, z, isSmall ? 0.5 : Math.max(1.6, rad + 0.3))) continue;
    if (crowded(x, z, rad, isSmall)) continue;
    placements.push({
      kind,
      pos: new THREE.Vector3(x, heightAt(x, z) - 0.05, z),
      scale,
      rotY: r() * 6.28,
      far: ring > 7,
    });
    if (!isSmall) taken.push({ x, z, r: rad });
    i++;
  }
  // Inner fill: small items close to the course for a lush look.
  const fillers = models ? KIT_SCATTER_MODELS[kit].fill : kit === 'meadow' ? ['flower', 'flower', 'bush', 'mushroom'] : kitDef.near;
  for (let i = 0, tries = 0; i < 30 * density && tries < 400; tries++) {
    const x = range(r, bounds.min.x - 2, bounds.max.x + 2);
    const z = range(r, bounds.min.z - 2, bounds.max.z + 2);
    if (blocked(x, z, 0.6)) continue;
    const kind = pick(r, fillers);
    const scale = range(r, 0.5, 0.9);
    const small = SMALL.has(kind);
    if (!small && blocked(x, z, footR(kind, scale) + 0.2)) continue;
    if (crowded(x, z, footR(kind, scale), small)) continue;
    placements.push({
      kind,
      pos: new THREE.Vector3(x, heightAt(x, z) - 0.02, z),
      scale,
      rotY: r() * 6.28,
    });
    if (!small) taken.push({ x, z, r: footR(kind, scale) });
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
    { geo: THREE.BufferGeometry; mat: THREE.Material; mats: THREE.Matrix4[]; bases: THREE.Vector3[]; far: boolean }
  >();
  const base = new THREE.Matrix4();
  for (const p of placements) {
    base.compose(
      p.pos,
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotY),
      new THREE.Vector3(p.scale, p.scale, p.scale),
    );
    for (const part of partsFor(p.kind, p.color, r, kit)) {
      const far = !!p.far || p.kind === 'planet';
      const key = part.geo.uuid + part.mat.uuid + (far ? 'f' : 'n');
      let b = batches.get(key);
      if (!b) batches.set(key, (b = { geo: part.geo, mat: part.mat, mats: [], bases: [], far }));
      b.mats.push(base.clone().multiply(part.m));
      b.bases.push(p.pos);
    }
  }
  const group = new THREE.Group();
  group.name = 'decor';
  for (const b of batches.values()) {
    enableSceneryFade(b.mat);
    // A per-batch geometry sharing the cached shape's buffers, plus this batch's fade bases.
    const geo = new THREE.BufferGeometry();
    geo.setIndex(b.geo.index);
    for (const [k, v] of Object.entries(b.geo.attributes)) geo.setAttribute(k, v);
    geo.boundingSphere = b.geo.boundingSphere;
    geo.boundingBox = b.geo.boundingBox;
    geo.setAttribute('aFadeBase', fadeBaseAttribute(b.bases));
    geo.userData.wrapper = true;
    const im = new THREE.InstancedMesh(geo, b.mat, b.mats.length);
    b.mats.forEach((m, i) => im.setMatrixAt(i, m));
    // The sun's shadow map only covers the course and a few metres round it.
    im.castShadow = !b.far;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  return group;
}
