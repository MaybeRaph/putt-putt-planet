import * as THREE from 'three';

/**
 * Shared, cached materials. The look is "soft stylised": physically-based (MeshStandardMaterial)
 * so it picks up the sky environment, shadows and AO, but with matte, saturated colours and
 * low-poly shapes. Cached materials are owned by this module (never disposed per hole);
 * per-hole materials are created by CourseView and disposed with it.
 */

const cache = new Map<string, THREE.Material>();

interface LitOpts {
  emissive?: number;
  transparent?: number;
  flat?: boolean;
  roughness?: number;
  metalness?: number;
}

/** Matte stylised material (name kept from the original toon pass). */
export function toon(color: THREE.ColorRepresentation, opts: LitOpts = {}): THREE.MeshStandardMaterial {
  const key = `lit:${new THREE.Color(color).getHexString()}:${opts.emissive ?? 0}:${opts.transparent ?? 1}:${opts.flat ? 1 : 0}:${opts.roughness ?? 0.78}:${opts.metalness ?? 0}`;
  let m = cache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.78,
      metalness: opts.metalness ?? 0,
      flatShading: !!opts.flat,
    });
    if (opts.emissive) {
      m.emissive = new THREE.Color(color);
      m.emissiveIntensity = opts.emissive;
    }
    if (opts.transparent !== undefined && opts.transparent < 1) {
      m.transparent = true;
      m.opacity = opts.transparent;
      m.depthWrite = false;
    }
    cache.set(key, m);
  }
  return m;
}

/** Faceted low-poly variant for decor (trees, rocks, candy). */
export function flat(color: THREE.ColorRepresentation, opts: LitOpts = {}): THREE.MeshStandardMaterial {
  return toon(color, { ...opts, flat: true, roughness: opts.roughness ?? 0.85 });
}

/**
 * Putting-green surface: world-space checkerboard (so adjoining floor pieces line up), plus
 * fine grass speckle, mowing streaks and large-scale colour variation so it reads as turf.
 */
export function checkerMaterial(a: string, b: string, cell = 1): THREE.MeshStandardMaterial {
  const key = `checker:${a}:${b}:${cell}`;
  let m = cache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  const ca = new THREE.Color(a),
    cb = new THREE.Color(b);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uA = { value: ca };
    shader.uniforms.uB = { value: cb };
    shader.uniforms.uCell = { value: cell };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        uniform vec3 uA; uniform vec3 uB; uniform float uCell;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 cc = floor(vWPos.xz / uCell);
        float chk = mod(cc.x + cc.y, 2.0);
        vec3 base = mix(uA, uB, chk);
        float speck = h21(floor(vWPos.xz * 22.0));
        float big = sin(vWPos.x * 0.37 + 1.3) * sin(vWPos.z * 0.29);
        float streak = sin((vWPos.x + vWPos.z) * 9.0) * 0.5 + 0.5;
        base *= 0.93 + 0.07 * speck + 0.04 * big + 0.03 * streak;
        base = pow(base, vec3(1.12));
        diffuseColor.rgb *= base;`,
      );
  };
  m.customProgramCacheKey = () => key;
  cache.set(key, m);
  return m;
}

/** Canvas texture helper for simple procedural patterns. */
export function canvasTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, s: number) => void,
  srgb = true,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

let woodTex: THREE.CanvasTexture | null = null;
/** Light wood planks (tinted by the wall colour). Shared image; callers clone to set repeat. */
export function woodTexture(): THREE.CanvasTexture {
  if (woodTex) return woodTex;
  woodTex = canvasTexture(256, (c, s) => {
    c.fillStyle = '#e9e1d6';
    c.fillRect(0, 0, s, s);
    const planks = 4;
    for (let p = 0; p < planks; p++) {
      const y0 = (p * s) / planks;
      const tone = 225 + ((p * 37) % 25);
      c.fillStyle = `rgb(${tone},${tone - 8},${tone - 20})`;
      c.fillRect(0, y0, s, s / planks);
      // grain
      c.strokeStyle = 'rgba(120,80,40,0.16)';
      c.lineWidth = 1.2;
      for (let g = 0; g < 9; g++) {
        const gy = y0 + 4 + ((g * 7 + p * 3) % (s / planks - 8));
        c.beginPath();
        c.moveTo(0, gy);
        for (let x = 0; x <= s; x += 16) c.lineTo(x, gy + Math.sin(x * 0.05 + g + p) * 1.6);
        c.stroke();
      }
      // knot
      c.fillStyle = 'rgba(110,70,35,0.25)';
      c.beginPath();
      c.ellipse(((p * 97) % 200) + 30, y0 + s / planks / 2, 7, 3, 0, 0, 7);
      c.fill();
      // seam
      c.fillStyle = 'rgba(70,40,20,0.35)';
      c.fillRect(0, y0, s, 2);
    }
  });
  return woodTex;
}

let stoneTex: THREE.CanvasTexture | null = null;
/** Mottled stone/painted texture for blocks and floor sides. */
export function mottleTexture(): THREE.CanvasTexture {
  if (stoneTex) return stoneTex;
  stoneTex = canvasTexture(128, (c, s) => {
    c.fillStyle = '#e6e6e6';
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      const v = 200 + Math.floor(Math.random() * 55);
      c.fillStyle = `rgba(${v},${v},${v},0.5)`;
      c.beginPath();
      c.arc(Math.random() * s, Math.random() * s, 2 + Math.random() * 6, 0, 7);
      c.fill();
    }
  });
  return stoneTex;
}

let dimples: THREE.CanvasTexture | null = null;
/** Golf-ball dimple bump map. */
export function dimpleTexture(): THREE.CanvasTexture {
  if (dimples) return dimples;
  dimples = canvasTexture(
    256,
    (c, s) => {
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, s, s);
      const n = 16;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n * 2; x++) {
          const cx = ((x + (y % 2) * 0.5) * s) / (n * 2),
            cy = ((y + 0.5) * s) / n;
          const g = c.createRadialGradient(cx, cy, 0, cx, cy, s / n / 2.4);
          g.addColorStop(0, '#9a9a9a');
          g.addColorStop(1, '#ffffff');
          c.fillStyle = g;
          c.beginPath();
          c.arc(cx, cy, s / n / 2.4, 0, 7);
          c.fill();
        }
    },
    false,
  );
  return dimples;
}

export function darken(hex: string, k: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(k);
}
