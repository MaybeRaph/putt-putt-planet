import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Theme } from '@ppp/shared';
import natureUrl from '../assets/nature.glb?url';
import cliffUrl from '../assets/rocks-cliff.webp?url';
import { addTranslucency } from './lighting';

/**
 * Stylised scenery models (Quaternius' Stylized Nature MegaKit, CC0; see scripts/build-nature.ts)
 * with painterly per-world shading: canopies get a soft height + depth gradient from the world
 * palette (lime-topped meadow trees, cotton-candy pink, snow-tipped pines, autumn copper, glowing
 * alien teal), gentle wind sway, and leaves lit from outside the canopy so trees read as soft
 * puffy shapes, like classic cartoon battle-royale scenery.
 *
 * Loaded once at boot. Until it has loaded (or if it fails, or on Low quality) the game falls
 * back to the procedural low-poly decor.
 */

type Kit = Theme['decorKit'];
type Role = 'canopy' | 'foliage' | 'bark' | 'rock' | 'plain';

interface ModelPart {
  /** Quantised geometry (16-bit positions); `local` holds the scale/offset that decodes it. */
  geo: THREE.BufferGeometry;
  local: THREE.Matrix4;
  role: Role;
  tex: THREE.Texture | null;
  /** Source material name (picks the palette: pine needles vs round leaves). */
  src: string;
}
interface Model {
  parts: ModelPart[];
  height: number;
}

const models = new Map<string, Model>();
let loading: Promise<boolean> | null = null;
let enabled = true;
let cliffTex: THREE.Texture | null = null;

/** Shared wind clock for every foliage material. */
const windTime = { value: 0 };

export function loadNature(): Promise<boolean> {
  if (loading) return loading;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const t0 = performance.now();
  loading = Promise.all([
    loader.loadAsync(natureUrl),
    new THREE.TextureLoader().loadAsync(cliffUrl).catch(() => null),
  ])
    .then(([gltf, cliff]) => {
      for (const root of gltf.scene.children) {
        const parts: ModelPart[] = [];
        root.updateMatrixWorld(true);
        root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          // Keep the geometry quantised: baking the node transform into normalised 16-bit
          // positions would clamp them to +-1. The transform rides along in the part matrix.
          const geo = mesh.geometry;
          const name = mat.name;
          const role: Role = /^Leaves_(NormalTree|Pine|TwistedTree)/.test(name)
            ? 'canopy'
            : /^Leaves$|^Flowers|^Grass/.test(name)
              ? 'foliage'
              : /^Bark/.test(name)
                ? 'bark'
                : /Rocks/.test(name)
                  ? 'rock'
                  : 'plain';
          if (mat.map) mat.map.anisotropy = 4;
          geo.computeBoundingSphere();
          parts.push({ geo, local: mesh.matrixWorld.clone(), role, tex: mat.map ?? null, src: name });
        });
        const box = new THREE.Box3().setFromObject(root);
        models.set(root.name, { parts, height: box.max.y - box.min.y });
      }
      if (cliff) {
        cliff.colorSpace = THREE.SRGBColorSpace;
        cliff.flipY = false;
        cliff.anisotropy = 4;
        cliffTex = cliff;
      }
      console.info(`[boot] nature models ${models.size} in ${Math.round(performance.now() - t0)} ms`);
      return true;
    })
    .catch((e: unknown) => {
      console.warn('[boot] nature models failed to load; using classic scenery', e);
      return false;
    });
  return loading;
}

/** Stylised models are used when loaded and the quality tier asks for them. */
export function setNatureEnabled(on: boolean): void {
  enabled = on;
}
export function natureActive(): boolean {
  return enabled && models.size > 0;
}

export function tickNature(time: number): void {
  windTime.value = time;
}

// --------------------------------------------------------------------------------------------
// Per-world palettes

interface Palette {
  /** Canopy colours: inside/bottom -> outside/top. */
  leafLow: string;
  leafHigh: string;
  pineLow: string;
  pineHigh: string;
  bark: string;
  rock: string;
  /** Plants and flowers (multiplies their painted texture). */
  plant: string;
  /** Self-light on the leaves (alien glow in space). */
  glow: number;
  /** Rocks use the warm cliff paint instead of the grey stone. */
  cliff: boolean;
}

const PALETTES: Record<Kit, Palette> = {
  meadow: {
    leafLow: '#24631f',
    leafHigh: '#a9d63c',
    pineLow: '#174d2b',
    pineHigh: '#62ad31',
    bark: '#ffffff',
    rock: '#f2e6d8',
    plant: '#ffffff',
    glow: 0.1,
    cliff: true,
  },
  candy: {
    leafLow: '#e2589f',
    leafHigh: '#fff1fa',
    pineLow: '#9a5ad6',
    pineHigh: '#ffd2f1',
    bark: '#ffd9c2',
    rock: '#f7c7e4',
    plant: '#ffd0ec',
    glow: 0.14,
    cliff: false,
  },
  frozen: {
    leafLow: '#3d7f8c',
    leafHigh: '#f7fcff',
    pineLow: '#1f5550',
    pineHigh: '#f4fbff',
    bark: '#c9b8b0',
    rock: '#c9dcef',
    plant: '#d9f0ff',
    glow: 0.12,
    cliff: false,
  },
  clockwork: {
    leafLow: '#7a2410',
    leafHigh: '#e8892a',
    pineLow: '#4a4a1a',
    pineHigh: '#b59234',
    bark: '#d9b8a0',
    rock: '#ffffff',
    plant: '#ffc78a',
    glow: 0.1,
    cliff: true,
  },
  space: {
    leafLow: '#3a2380',
    leafHigh: '#6ff3ff',
    pineLow: '#2a1f66',
    pineHigh: '#d68bff',
    bark: '#8f86b8',
    rock: '#8d84b8',
    plant: '#b7a6ff',
    glow: 0.45,
    cliff: false,
  },
};

const matCache = new Map<string, THREE.Material>();

/**
 * Leaf cut-outs: mipmapping averages the thin leaves away into the transparent background, so
 * distant trees go see-through and fringed. Boost alpha with the mip level (keeps coverage), then
 * sharpen it to a one-pixel ramp so the 0.5 alpha test gives clean edges at every distance.
 *
 * (v1.8.0 used alpha-to-coverage here; under the HDR post chain its partly covered edge samples
 * came out as a bright speckled rim round every branch. Edges are smoothed by the anti-aliasing
 * setting instead: FXAA or SMAA.)
 */
const ALPHA_SHARPEN = `
  {
    vec2 tsz = vec2(textureSize(map, 0));
    vec2 dx = dFdx(vMapUv * tsz), dy = dFdy(vMapUv * tsz);
    float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
    diffuseColor.a *= 1.0 + lod * 0.28;
    diffuseColor.a = (diffuseColor.a - 0.5) / max(fwidth(diffuseColor.a), 0.0001) + 0.5;
  }`;
const ALPHA_FIX = `#include <map_fragment>${ALPHA_SHARPEN}`;
/** Canopies: the leaf texture is only a mask (colour comes from the palette), so take its alpha
 * alone; the colour under the cut-out can never bleed into the edge. */
const MASK_ONLY = `
  #ifdef USE_MAP
    diffuseColor.a *= texture2D(map, vMapUv).a;
  #endif${ALPHA_SHARPEN}`;

function canopyMaterial(kit: Kit, tex: THREE.Texture | null, pine: boolean): THREE.Material {
  const key = `canopy:${kit}:${tex?.uuid}:${pine}`;
  const cached = matCache.get(key);
  if (cached) return cached;
  const P = PALETTES[kit];
  const low = new THREE.Color(pine ? P.pineLow : P.leafLow),
    high = new THREE.Color(pine ? P.pineHigh : P.leafHigh);
  // Lambert: matte, no specular sheen (which turns puffy canopy edges white under the sky light).
  const mat = new THREE.MeshLambertMaterial({
    map: tex,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLow = { value: low };
    shader.uniforms.uHigh = { value: high };
    shader.uniforms.uGlow = { value: P.glow };
    shader.uniforms.uWind = windTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 color;
        uniform float uWind;
        varying vec2 vShade;
        varying float vVar;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vShade = color.rg;
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
        #else
          vec3 ip = vec3(0.0);
        #endif
        vVar = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
        float sway = color.r * color.r;
        transformed.x += sin(uWind * 1.3 + ip.x * 0.3 + position.y * 0.6) * 0.06 * sway;
        transformed.z += cos(uWind * 1.1 + ip.z * 0.3 + position.y * 0.5) * 0.05 * sway;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uLow; uniform vec3 uHigh; uniform float uGlow;
        varying vec2 vShade;
        varying float vVar;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float g = clamp(vShade.x * 0.75 + vShade.y * 0.45 - 0.12, 0.0, 1.0);
        vec3 leaf = mix(uLow, uHigh, g * g * (3.0 - 2.0 * g));
        leaf *= mix(0.62, 1.0, vShade.y) * (0.92 + vVar * 0.16);
        diffuseColor.rgb *= leaf;`,
      )
      .replace('#include <map_fragment>', MASK_ONLY)
      // Leaves are lit from outside the canopy whichever side of the card faces the camera.
      .replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * uGlow;`,
      );
    addTranslucency(shader, 0.55);
  };
  mat.customProgramCacheKey = () => `canopy${kit}${pine}`;
  matCache.set(key, mat);
  return mat;
}

function plainMaterial(kit: Kit, role: Role, tex: THREE.Texture | null): THREE.Material {
  const key = `${role}:${kit}:${tex?.uuid}`;
  let m = matCache.get(key);
  if (m) return m;
  const P = PALETTES[kit];
  if (role === 'rock') {
    const cliff = P.cliff && !!cliffTex;
    const rock = new THREE.MeshStandardMaterial({
      map: cliff ? cliffTex : tex,
      color: P.rock,
      roughness: 0.92,
    });
    if (!cliff) {
      // Recolour the painted stone from its brightness, so a tint gives pastel pink or icy blue
      // stone instead of murky green-grey.
      rock.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float lum = dot(diffuseColor.rgb / max(diffuse, vec3(0.001)), vec3(0.3, 0.55, 0.15));
          diffuseColor.rgb = diffuse * (0.35 + lum * 1.9);`,
        );
      };
      rock.customProgramCacheKey = () => 'rock-tint';
    }
    m = rock;
  } else if (role === 'bark') {
    m = new THREE.MeshStandardMaterial({ map: tex, color: P.bark, roughness: 0.9, vertexColors: true });
  } else if (role === 'foliage') {
    const mat = new THREE.MeshLambertMaterial({
      map: tex,
      color: P.plant,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_fragment>', ALPHA_FIX)
        .replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
      addTranslucency(shader, 0.5);
    };
    mat.customProgramCacheKey = () => 'foliage';
    m = mat;
  } else {
    m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide });
  }
  matCache.set(key, m);
  return m;
}

export interface NaturePart {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  m: THREE.Matrix4;
}

/**
 * The parts of one model, scaled so the model is `height` metres tall (or by `scale` if
 * height is 0), with world-specific materials. Null if the model isn't loaded.
 */
export function naturePartsFor(name: string, kit: Kit, height: number, scale = 1): NaturePart[] | null {
  const model = models.get(name);
  if (!model) return null;
  const s = height > 0 ? height / model.height : scale;
  const k = new THREE.Matrix4().makeScale(s, s, s);
  return model.parts.map((p) => {
    const m = k.clone().multiply(p.local);
    let mat: THREE.Material;
    if (p.role === 'canopy') mat = canopyMaterial(kit, p.tex, p.src.startsWith('Leaves_Pine'));
    else mat = plainMaterial(kit, p.role, p.tex);
    return { geo: p.geo, mat, m };
  });
}

/** Big rock models (for cliffs and spires in the landscape): geometry, decode matrix and size. */
export function rockModels(): { geo: THREE.BufferGeometry; local: THREE.Matrix4; size: THREE.Vector3 }[] {
  const out: { geo: THREE.BufferGeometry; local: THREE.Matrix4; size: THREE.Vector3 }[] = [];
  for (const name of ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3']) {
    const p = models.get(name)?.parts[0];
    if (!p) continue;
    p.geo.computeBoundingBox();
    const size = p.geo.boundingBox!.clone().applyMatrix4(p.local).getSize(new THREE.Vector3());
    out.push({ geo: p.geo, local: p.local, size });
  }
  return out;
}

export function rockMaterial(kit: Kit): THREE.Material | null {
  const p = models.get('Rock_Medium_1')?.parts[0];
  return p ? plainMaterial(kit, 'rock', p.tex) : null;
}
