import * as THREE from 'three';
import type { Theme, Zone } from '@ppp/shared';
import { liveSun } from './lighting';

/**
 * Ponds, brooks and lagoons (v1.8.5).
 *
 * Water zones are hazard boxes; drawn one by one they were flat rectangles floating a few
 * centimetres over the terrain with a loose blue box under them (and the terrain poking through
 * their edges). Now every group of water zones at one level is drawn as a single body of water:
 *
 * - the union of the zones' rectangles, rounded and blended (a smooth-min of rounded-box signed
 *   distances), so overlapping zones merge into one pond with soft curved shores;
 * - an opaque surface (no sorting or double blending where zones overlap) that is deep blue in
 *   the middle, lighter in the shallows and frothy along the shore;
 * - a low rim round the edge (stone, sugar, snow, brass...) and earth banks from the rim down to
 *   the terrain, so raised ponds read as built into the course like its terraced greens.
 *
 * The surface and rim are big quads whose fragments outside the shape are discarded (the same
 * distance function runs in the shader); the banks are walls traced along the shape's outline
 * with marching squares.
 */

/** Most zones one body of water can hold (shader uniform array size). */
const MAX = 16;
/** Water reaches this far past a zone's rectangle (so it tucks under the greens it meets). */
const EDGE = 0.12;
/** Rim width and height above the water. */
const RIM_W = 0.24;
const RIM_H = 0.1;
/** Surface sits this far below the zone's top (the hazard's trigger level). */
const SURFACE_DROP = 0.14;
/** Blend radius between overlapping zones, and corner rounding. */
const BLEND = 0.35;
const CORNER = 0.45;
/** How far the shoreline wanders outwards (m). */
const WOBBLE = 0.5;

interface Rect {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  c: number;
  s: number;
  r: number;
}

const RIM: Record<Theme['decorKit'], string> = {
  meadow: '#b9ab8e',
  candy: '#f6cfe2',
  frozen: '#eef6fb',
  clockwork: '#9a8058',
  space: '#6b6599',
};

function rectOf(z: Zone): Rect {
  const hx = z.size[0] / 2,
    hz = z.size[2] / 2;
  return {
    cx: z.center[0],
    cz: z.center[2],
    hx,
    hz,
    c: Math.cos(z.rotY),
    s: Math.sin(z.rotY),
    r: Math.min(CORNER, hx * 0.8, hz * 0.8),
  };
}

function sdRect(R: Rect, x: number, z: number): number {
  const dx = x - R.cx,
    dz = z - R.cz;
  // World -> zone-local (inverse of the zone's Euler Y rotation).
  const lx = dx * R.c - dz * R.s,
    lz = dx * R.s + dz * R.c;
  const qx = Math.abs(lx) - (R.hx - R.r),
    qz = Math.abs(lz) - (R.hz - R.r);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - R.r;
}

function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * Natural shores: a slow 0..1 undulation. It only ever pushes the shore outwards (past the hazard
 * box), so the water you see never stops short of where a ball actually splashes.
 */
function wobble(x: number, z: number): number {
  const w =
    0.5 +
    0.25 * Math.sin(x * 1.7 + 1.3 * Math.sin(z * 0.9)) +
    0.25 * Math.sin(z * 1.3 + 1.1 * Math.sin(x * 1.1 + 2.0)) +
    0.12 * Math.sin(x * 3.7 + z * 2.9);
  return Math.min(1, Math.max(0, w));
}

function sdUnion(rects: Rect[], x: number, z: number): number {
  let d = Infinity;
  for (const R of rects) {
    const e = sdRect(R, x, z);
    d = d === Infinity ? e : smin(d, e, BLEND);
  }
  return d - WOBBLE * wobble(x, z);
}

/** GLSL twin of sdUnion (uniforms uA: centre + half size, uB: cos, sin, corner radius). */
const SDF_GLSL = `
  uniform vec4 uA[${MAX}];
  uniform vec3 uB[${MAX}];
  uniform int uN;
  float sdRectW(int i, vec2 p){
    vec2 d = p - uA[i].xy;
    vec2 l = vec2(d.x * uB[i].x - d.y * uB[i].y, d.x * uB[i].y + d.y * uB[i].x);
    vec2 q = abs(l) - (uA[i].zw - uB[i].z);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uB[i].z;
  }
  float waterSdf(vec2 p){
    float d = 1e5;
    for (int i = 0; i < ${MAX}; i++) {
      if (i >= uN) break;
      float e = sdRectW(i, p);
      if (i == 0) { d = e; continue; }
      float h = max(${BLEND.toFixed(3)} - abs(d - e), 0.0) / ${BLEND.toFixed(3)};
      d = min(d, e) - h * h * ${BLEND.toFixed(3)} * 0.25;
    }
    float w = 0.5 + 0.25 * sin(p.x * 1.7 + 1.3 * sin(p.y * 0.9)) + 0.25 * sin(p.y * 1.3 + 1.1 * sin(p.x * 1.1 + 2.0))
      + 0.12 * sin(p.x * 3.7 + p.y * 2.9);
    return d - ${WOBBLE.toFixed(3)} * clamp(w, 0.0, 1.0);
  }`;

function shapeUniforms(rects: Rect[]): Record<string, THREE.IUniform> {
  const a: THREE.Vector4[] = [];
  const b: THREE.Vector3[] = [];
  for (let i = 0; i < MAX; i++) {
    const R = rects[i];
    a.push(R ? new THREE.Vector4(R.cx, R.cz, R.hx, R.hz) : new THREE.Vector4());
    b.push(R ? new THREE.Vector3(R.c, R.s, R.r) : new THREE.Vector3(1, 0, 0));
  }
  return { uA: { value: a }, uB: { value: b }, uN: { value: Math.min(MAX, rects.length) } };
}

export interface WaterBuild {
  group: THREE.Group;
  /** Materials whose `uTime` uniform ticks. */
  animated: THREE.ShaderMaterial[];
  owned: { dispose(): void }[];
}

export interface WaterOpts {
  theme: Theme;
  /** Terrain level beside the course (banks reach just below it). */
  groundY: number;
  /** Earth material for the banks (the course's skirt material). */
  bankMat: THREE.Material;
  /** True where the course (greens, rails) covers the ground: no reeds or lily pads there. */
  blocked?: (x: number, z: number, margin?: number) => boolean;
}

/** Builds every body of water in a hole's zones. */
export function buildWater(zones: Zone[], o: WaterOpts): WaterBuild {
  const out: WaterBuild = { group: new THREE.Group(), animated: [], owned: [] };
  out.group.name = 'water';
  const water = zones.filter((z) => z.kind === 'water');
  // One body per surface level (zones at one height merge; zones at another are another pond).
  const levels: { y: number; zones: Zone[] }[] = [];
  for (const z of water) {
    const y = z.center[1] + z.size[1] / 2 - SURFACE_DROP;
    const L = levels.find((l) => Math.abs(l.y - y) < 0.03);
    if (L) L.zones.push(z);
    else levels.push({ y, zones: [z] });
  }
  // Then one body per cluster of touching zones, so each pond's quads only cover that pond.
  for (const L of levels)
    for (const c of clusters(L.zones))
      for (let i = 0; i < c.length; i += MAX) buildBody(c.slice(i, i + MAX), L.y, o, out);
  return out;
}

/** Groups zones whose (padded) footprints touch. */
function clusters(zones: Zone[]): Zone[][] {
  const box = zones.map((z) => {
    const R = rectOf(z);
    const ex = Math.abs(R.hx * R.c) + Math.abs(R.hz * R.s) + 1.2,
      ez = Math.abs(R.hx * R.s) + Math.abs(R.hz * R.c) + 1.2;
    return [R.cx - ex, R.cx + ex, R.cz - ez, R.cz + ez];
  });
  const parent = zones.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < zones.length; i++)
    for (let j = i + 1; j < zones.length; j++) {
      const a = box[i],
        b = box[j];
      if (a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3]) parent[find(i)] = find(j);
    }
  const groups = new Map<number, Zone[]>();
  zones.forEach((z, i) => {
    const k = find(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(z);
  });
  return [...groups.values()];
}

function buildBody(zones: Zone[], y: number, o: WaterOpts, out: WaterBuild): void {
  const rects = zones.map(rectOf);
  const space = o.theme.decorKit === 'space';
  // Bounds of the shape, padded past the rim.
  let x0 = Infinity,
    x1 = -Infinity,
    z0 = Infinity,
    z1 = -Infinity;
  for (const R of rects) {
    const ex = Math.abs(R.hx * R.c) + Math.abs(R.hz * R.s),
      ez = Math.abs(R.hx * R.s) + Math.abs(R.hz * R.c);
    x0 = Math.min(x0, R.cx - ex);
    x1 = Math.max(x1, R.cx + ex);
    z0 = Math.min(z0, R.cz - ez);
    z1 = Math.max(z1, R.cz + ez);
  }
  const pad = EDGE + RIM_W + WOBBLE + 0.3;
  x0 -= pad;
  x1 += pad;
  z0 -= pad;
  z1 += pad;
  const cx = (x0 + x1) / 2,
    cz = (z0 + z1) / 2;
  const own = <T extends { dispose(): void }>(t: T): T => {
    out.owned.push(t);
    return t;
  };
  const quad = (yy: number, down = false) => {
    const g = own(new THREE.PlaneGeometry(x1 - x0, z1 - z0));
    g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
    g.translate(cx, yy, cz);
    return g;
  };
  const shape = shapeUniforms(rects);

  // ---- Surface.
  const t = o.theme;
  const deep = new THREE.Color(t.water).multiplyScalar(0.5);
  const shallow = new THREE.Color(t.water).lerp(new THREE.Color('#b8f4ec'), space ? 0.15 : 0.38);
  const mat = own(
    new THREE.ShaderMaterial({
      uniforms: {
        ...shape,
        uTime: { value: 0 },
        uDeep: { value: deep },
        uShallow: { value: shallow },
        uSkyTop: { value: new THREE.Color(t.skyTop) },
        uSkyHor: { value: new THREE.Color(t.skyBottom) },
        uSunDir: { value: liveSun },
        uSun: { value: new THREE.Color(t.sun) },
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      },
      fog: true,
      vertexShader: `#include <fog_pars_vertex>
        varying vec3 vW;
        void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `${SDF_GLSL}
        #include <fog_pars_fragment>
        uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSkyTop; uniform vec3 uSkyHor;
        uniform vec3 uSunDir; uniform vec3 uSun;
        varying vec3 vW;
        float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
        float waves(vec2 p){
          return vn(p * 1.3 + uTime * vec2(0.22, 0.09)) + 0.55 * vn(p * 3.1 - uTime * vec2(0.08, 0.26)) + 0.25 * vn(p * 7.3 + uTime * vec2(0.3, -0.2));
        }
        void main(){
          vec2 p = vW.xz;
          float sd = waterSdf(p) - ${EDGE.toFixed(3)};
          if (sd > 0.0) discard;
          float shore = -sd;
          float w0 = waves(p);
          float e = 0.06;
          float dx = waves(p + vec2(e, 0.0)) - w0, dz = waves(p + vec2(0.0, e)) - w0;
          vec3 n = normalize(vec3(-dx * 2.0, 1.0, -dz * 2.0));
          vec3 v = normalize(cameraPosition - vW);
          float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
          vec3 r = reflect(-v, n);
          vec3 sky = mix(uSkyHor, uSkyTop, smoothstep(0.0, 0.55, r.y));
          // Deep in the middle, lighter towards the banks, ripples catching the light.
          float depth = smoothstep(0.05, 1.6, shore);
          vec3 body = mix(uShallow, uDeep, depth) * (0.88 + 0.22 * smoothstep(0.6, 1.5, w0));
          vec3 c = mix(body, sky, clamp(0.12 + fres * 1.1, 0.0, 0.8));
          // Painted bands along the ripple crests.
          float band = fract(w0 * 2.2);
          c += vec3(0.07) * smoothstep(0.55, 0.6, band) * smoothstep(0.66, 0.6, band);
          // Shore foam: a broken frothy line hugging the bank, and a ripple ring that laps in and out.
          float fn = vn(p * 5.0 + vec2(uTime * 0.35, -uTime * 0.2)) * 0.6 + vn(p * 11.0 - uTime * 0.5) * 0.4;
          float foam = smoothstep(0.12, 0.04, shore + (fn - 0.5) * 0.12);
          float lap = 0.2 + 0.07 * sin(uTime * 1.3 + fn * 3.0);
          foam = max(foam, smoothstep(0.03, 0.0, abs(shore - lap)) * smoothstep(0.35, 0.65, fn) * 0.75);
          c = mix(c, vec3(0.96, 0.99, 1.0), foam * 0.85);
          float sp = max(dot(r, uSunDir), 0.0);
          c += uSun * (pow(sp, 260.0) * 2.4 + pow(sp, 18.0) * 0.12) * (1.0 - foam);
          vec2 sc = p * 14.0;
          float spark = step(0.993, h21(floor(sc) + floor(uTime * 2.5))) * smoothstep(0.32, 0.05, length(fract(sc) - 0.5));
          c += uSun * spark * pow(sp, 4.0) * 1.4 * (1.0 - foam);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    }),
  );
  out.animated.push(mat);
  const surf = new THREE.Mesh(quad(y), mat);
  surf.name = 'water-surface';
  out.group.add(surf);

  // ---- Rim (a flat band round the shore) and its faces.
  const rimMat = own(new THREE.MeshStandardMaterial({ color: RIM[t.decorKit], roughness: 0.85 }));
  const band = { lo: EDGE, hi: EDGE + RIM_W };
  rimMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shape);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWp;\n${SDF_GLSL}`)
      .replace(
        'void main() {',
        `void main() {
          float rimSd = waterSdf(vWp.xz);
          if (rimSd < ${band.lo.toFixed(3)} || rimSd > ${band.hi.toFixed(3)}) discard;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Pebbles: a cell pattern of stones of slightly different shades with dark joints,
        // darker and wetter where they meet the water.
        {
          vec2 g = vWp.xz * 7.0;
          vec2 gi = floor(g);
          float md = 9.0, pid = 0.0;
          for (int yy = -1; yy <= 1; yy++)
            for (int xx = -1; xx <= 1; xx++) {
              vec2 o = vec2(float(xx), float(yy));
              vec2 rr = gi + o;
              vec2 jit = fract(sin(vec2(dot(rr, vec2(127.1, 311.7)), dot(rr, vec2(269.5, 183.3)))) * 43758.5453);
              vec2 cc = o + jit - fract(g);
              float dd = dot(cc, cc);
              if (dd < md) { md = dd; pid = fract(sin(dot(rr, vec2(12.9898, 78.233))) * 43758.5453); }
            }
          diffuseColor.rgb *= (0.8 + 0.32 * pid) * (1.0 - 0.38 * smoothstep(0.3, 0.62, md));
          diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(${band.lo.toFixed(3)}, ${(band.lo + 0.09).toFixed(3)}, rimSd));
        }`,
      );
  };
  rimMat.customProgramCacheKey = () => 'water-rim';
  const top = y + RIM_H;
  const cap = new THREE.Mesh(quad(top), rimMat);
  cap.receiveShadow = true;
  out.group.add(cap);

  // Walls traced along the outline: the rim's inner face down into the water, and the bank from
  // the rim down to the ground (in space, a short tank side and a floor underneath).
  const bottom = space ? y - 0.7 : o.groundY - 0.6;
  const innerMat = own(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(RIM[t.decorKit]).multiplyScalar(0.72),
      roughness: 0.9,
    }),
  );
  const inner = traceWall(rects, band.lo, top, y - 0.08, -1, [x0, z0, x1, z1]);
  if (inner) out.group.add(new THREE.Mesh(own(inner), innerMat));
  const outer = traceWall(rects, band.hi, top, bottom, 1, [x0, z0, x1, z1]);
  if (outer) {
    const m = new THREE.Mesh(own(outer), space ? innerMat : o.bankMat);
    m.receiveShadow = true;
    m.castShadow = true;
    out.group.add(m);
  }
  scatterShore(rects, y, top, [x0, z0, x1, z1], o, out);
  if (space) {
    const floorMat = own(rimMat.clone());
    floorMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, shape);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWp;\n${SDF_GLSL}`)
        .replace('void main() {', `void main() {\n if (waterSdf(vWp.xz) > ${band.hi.toFixed(3)}) discard;`);
    };
    floorMat.customProgramCacheKey = () => 'water-floor';
    floorMat.color.set(innerMat.color);
    out.group.add(new THREE.Mesh(quad(bottom, true), floorMat));
  }
}

/**
 * A vertical wall along the iso-line sdf = `iso` (marching squares), from `top` down to
 * `bottom`. `facing` +1 points the wall outwards (away from the water), -1 inwards.
 */
function traceWall(
  rects: Rect[],
  iso: number,
  top: number,
  bottom: number,
  facing: 1 | -1,
  box: [number, number, number, number],
): THREE.BufferGeometry | null {
  const [x0, z0, x1, z1] = box;
  const area = (x1 - x0) * (z1 - z0);
  const cell = Math.max(0.07, Math.sqrt(area / 160000));
  const nx = Math.ceil((x1 - x0) / cell) + 1,
    nz = Math.ceil((z1 - z0) / cell) + 1;
  const f = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) f[j * nx + i] = sdUnion(rects, x0 + i * cell, z0 + j * cell) - iso;
  const pos: number[] = [];
  const nrm: number[] = [];
  const grad = (x: number, z: number) => {
    const e = 0.02;
    const gx = sdUnion(rects, x + e, z) - sdUnion(rects, x - e, z);
    const gz = sdUnion(rects, x, z + e) - sdUnion(rects, x, z - e);
    const l = Math.hypot(gx, gz) || 1;
    return [(gx / l) * facing, (gz / l) * facing];
  };
  const seg = (ax: number, az: number, bx: number, bz: number) => {
    const ga = grad(ax, az),
      gb = grad(bx, bz);
    // Wind each quad so its front faces along the wall's normal.
    const ex = bx - ax,
      ez = bz - az;
    // Front face normal of (a_top, b_top, b_bot) is (ez, 0, -ex) up to sign.
    const flip = ez * (ga[0] + gb[0]) - ex * (ga[1] + gb[1]) < 0;
    const A = flip ? [bx, bz, gb] : [ax, az, ga];
    const B = flip ? [ax, az, ga] : [bx, bz, gb];
    const [pax, paz, na] = A as [number, number, number[]];
    const [pbx, pbz, nb] = B as [number, number, number[]];
    pos.push(
      pax,
      top,
      paz,
      pbx,
      top,
      pbz,
      pbx,
      bottom,
      pbz,
      pax,
      top,
      paz,
      pbx,
      bottom,
      pbz,
      pax,
      bottom,
      paz,
    );
    nrm.push(
      na[0],
      0,
      na[1],
      nb[0],
      0,
      nb[1],
      nb[0],
      0,
      nb[1],
      na[0],
      0,
      na[1],
      nb[0],
      0,
      nb[1],
      na[0],
      0,
      na[1],
    );
  };
  const lerp = (a: number, b: number) => a / (a - b);
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const v0 = f[j * nx + i],
        v1 = f[j * nx + i + 1],
        v2 = f[(j + 1) * nx + i + 1],
        v3 = f[(j + 1) * nx + i];
      const k = (v0 < 0 ? 1 : 0) | (v1 < 0 ? 2 : 0) | (v2 < 0 ? 4 : 0) | (v3 < 0 ? 8 : 0);
      if (k === 0 || k === 15) continue;
      const X = x0 + i * cell,
        Z = z0 + j * cell;
      // Edge crossings: bottom (v0-v1), right (v1-v2), top (v3-v2), left (v0-v3).
      const eB = (): [number, number] => [X + lerp(v0, v1) * cell, Z];
      const eR = (): [number, number] => [X + cell, Z + lerp(v1, v2) * cell];
      const eT = (): [number, number] => [X + lerp(v3, v2) * cell, Z + cell];
      const eL = (): [number, number] => [X, Z + lerp(v0, v3) * cell];
      const pairs: [() => [number, number], () => [number, number]][] = [];
      switch (k) {
        case 1:
        case 14:
          pairs.push([eL, eB]);
          break;
        case 2:
        case 13:
          pairs.push([eB, eR]);
          break;
        case 3:
        case 12:
          pairs.push([eL, eR]);
          break;
        case 4:
        case 11:
          pairs.push([eR, eT]);
          break;
        case 6:
        case 9:
          pairs.push([eB, eT]);
          break;
        case 7:
        case 8:
          pairs.push([eL, eT]);
          break;
        case 5:
        case 10: {
          const centre = (v0 + v1 + v2 + v3) / 4 < 0;
          if ((k === 5) === centre) pairs.push([eL, eT], [eB, eR]);
          else pairs.push([eL, eB], [eR, eT]);
          break;
        }
      }
      for (const [a, b] of pairs) {
        const p = a(),
          q = b();
        seg(p[0], p[1], q[0], q[1]);
      }
    }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

/** Deterministic 0..1 hash of a position and a slot. */
function hash(x: number, z: number, k: number): number {
  const v = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * Life round the water: boulders sitting on the rim, and per world reeds and lily pads (meadow),
 * ice floes (frozen) or sugar-glass floats (candy). All instanced: a few draw calls per pond.
 */
function scatterShore(
  rects: Rect[],
  y: number,
  top: number,
  box: [number, number, number, number],
  o: WaterOpts,
  out: WaterBuild,
): void {
  const kit = o.theme.decorKit;
  const [x0, z0, x1, z1] = box;
  const free = (x: number, z: number) => !o.blocked?.(x, z);
  const rocks: THREE.Matrix4[] = [];
  const reeds: THREE.Matrix4[] = [];
  const pads: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const step = 0.3;
  for (let x = x0; x <= x1; x += step)
    for (let z = z0; z <= z1; z += step) {
      const px = x + (hash(x, z, 1) - 0.5) * step,
        pz = z + (hash(x, z, 2) - 0.5) * step;
      const d = sdUnion(rects, px, pz);
      const h = hash(px, pz, 3);
      if (!free(px, pz)) continue;
      // On the rim: an occasional boulder.
      if (d > EDGE + 0.02 && d < EDGE + RIM_W && h < 0.045) {
        const s = 0.16 + hash(px, pz, 4) * 0.2;
        // The whole boulder clear of rails and greens, not just its middle.
        if (o.blocked?.(px, pz, s * 1.35 + 0.05)) continue;
        q.setFromAxisAngle(up, hash(px, pz, 5) * 6.28);
        rocks.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(px, top + s * 0.25, pz),
            q,
            new THREE.Vector3(s * 1.3, s * 0.8, s),
          ),
        );
      }
      // In the shallows: reeds (meadow) along the bank.
      if (kit === 'meadow' && d > EDGE - 0.32 && d < EDGE - 0.08 && h > 0.86) {
        const n = 3 + Math.floor(hash(px, pz, 6) * 4);
        for (let k = 0; k < n; k++) {
          const a = hash(px, pz, 10 + k) * 6.28,
            r = hash(px, pz, 20 + k) * 0.12;
          const hgt = 0.35 + hash(px, pz, 30 + k) * 0.4;
          q.setFromEuler(
            new THREE.Euler((hash(px, pz, 40 + k) - 0.5) * 0.35, 0, (hash(px, pz, 50 + k) - 0.5) * 0.35),
          );
          reeds.push(
            new THREE.Matrix4().compose(
              new THREE.Vector3(px + Math.cos(a) * r, y - 0.05, pz + Math.sin(a) * r),
              q,
              new THREE.Vector3(1, hgt, 1),
            ),
          );
        }
      }
      // Out on the water: lily pads, floes or floats, away from the shore.
      if (
        (kit === 'meadow' || kit === 'frozen' || kit === 'candy') &&
        d < EDGE - 0.45 &&
        h > (kit === 'meadow' ? 0.945 : 0.975)
      ) {
        const s = kit === 'frozen' ? 0.16 + hash(px, pz, 7) * 0.22 : 0.13 + hash(px, pz, 7) * 0.12;
        q.setFromAxisAngle(up, hash(px, pz, 8) * 6.28);
        pads.push(
          new THREE.Matrix4().compose(new THREE.Vector3(px, y + 0.012, pz), q, new THREE.Vector3(s, 1, s)),
        );
      }
    }
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], shadow = true) => {
    if (!list.length) {
      geo.dispose();
      mat.dispose();
      return;
    }
    out.owned.push(geo, mat);
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    // Frees its per-instance matrix buffer when the hole is torn down.
    out.owned.push(im);
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.castShadow = shadow;
    im.receiveShadow = true;
    out.group.add(im);
  };
  const rockColor: Record<Theme['decorKit'], string> = {
    meadow: '#8f877c',
    candy: '#e9a8cf',
    frozen: '#c9dbe8',
    clockwork: '#6f5a44',
    space: '#4f4a7a',
  };
  const rockGeo = new THREE.DodecahedronGeometry(1, 1);
  {
    // Lumpy, flattened boulders.
    const p = rockGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const k = 0.82 + hash(p.getX(i), p.getZ(i), p.getY(i) * 9) * 0.3;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    rockGeo.computeVertexNormals();
  }
  add(
    rockGeo,
    new THREE.MeshStandardMaterial({ color: rockColor[kit], roughness: 0.9, flatShading: true }),
    rocks,
  );
  if (reeds.length) {
    const reed = new THREE.ConeGeometry(0.018, 1, 4, 1);
    reed.translate(0, 0.5, 0);
    add(reed, new THREE.MeshStandardMaterial({ color: '#5f8f3a', roughness: 0.8 }), reeds);
  }
  if (pads.length) {
    let geo: THREE.BufferGeometry;
    let mat: THREE.MeshStandardMaterial;
    if (kit === 'meadow') {
      // A round leaf with a notch cut out.
      geo = new THREE.CircleGeometry(1, 14, 0.35, Math.PI * 2 - 0.5);
      mat = new THREE.MeshStandardMaterial({ color: '#4f9a3c', roughness: 0.6, side: THREE.DoubleSide });
    } else if (kit === 'frozen') {
      geo = new THREE.CylinderGeometry(1, 1, 0.06, 6);
      mat = new THREE.MeshStandardMaterial({ color: '#f2f8fc', roughness: 0.4 });
    } else {
      geo = new THREE.TorusGeometry(0.7, 0.28, 6, 14);
      mat = new THREE.MeshStandardMaterial({ color: '#ffd1e6', roughness: 0.35 });
    }
    if (kit === 'meadow' || kit === 'candy') geo.rotateX(-Math.PI / 2);
    add(geo, mat, pads, kit === 'frozen');
  }
}
