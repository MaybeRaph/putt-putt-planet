import * as THREE from 'three';
import type { Theme } from '@ppp/shared';
import { fbm, noise2, ridged, smoothstep } from './noise';
import { natureActive, rockMaterial, rockModels } from './nature';
import { addTranslucency } from './lighting';

type Kit = Theme['decorKit'];

/** Per-world terrain palette: low grass, high grass, dirt, rock, peak. */
const PALETTE: Record<
  Kit,
  {
    g1: string;
    g2: string;
    dirt: string;
    rock: string;
    rock2: string;
    peak: string;
    grassBase: string;
    grassTip: string;
  }
> = {
  meadow: {
    g1: '#4f9e3f',
    g2: '#76c257',
    dirt: '#8a6a48',
    rock: '#8a7f75',
    rock2: '#a89c8e',
    peak: '#eef3f8',
    grassBase: '#3f8a35',
    grassTip: '#a6dd6a',
  },
  candy: {
    g1: '#ff9ccb',
    g2: '#ffc2e0',
    dirt: '#d98bb5',
    rock: '#b07ccf',
    rock2: '#cfa3e6',
    peak: '#fff4fb',
    grassBase: '#ff7fb8',
    grassTip: '#ffe0f0',
  },
  frozen: {
    g1: '#dbe8f2',
    g2: '#eef5fb',
    dirt: '#b9c9d6',
    rock: '#6f8296',
    rock2: '#8fa2b5',
    peak: '#ffffff',
    grassBase: '#9fb7c4',
    grassTip: '#f2f8fc',
  },
  clockwork: {
    g1: '#7a6553',
    g2: '#8c7561',
    dirt: '#5e4b3d',
    rock: '#55473d',
    rock2: '#6e5c4f',
    peak: '#a07b5c',
    grassBase: '#6b5a3a',
    grassTip: '#b49a62',
  },
  space: {
    g1: '#2f2a50',
    g2: '#3b3560',
    dirt: '#2a2645',
    rock: '#4a4470',
    rock2: '#5b5488',
    peak: '#7d74c4',
    grassBase: '#4a3f7a',
    grassTip: '#9f8cff',
  },
};

export interface LandscapeOpts {
  center: THREE.Vector2;
  /** Half extents of the course footprint. */
  half: THREE.Vector2;
  groundY: number;
  kit: Kit;
  seed: number;
  /** True if (x, z) is within `margin` of the course footprint. */
  keepOut: (x: number, z: number, margin: number) => boolean;
  grass: number; // number of grass blades (0 = none)
  /** Horizon haze colours for the distant mountain layers (omit to leave them out, e.g. in thick fog). */
  haze?: { fog: string; sky: string };
}

/** Deterministic 0..1 value for a hole seed and a slot (per-hole variety in the scenery). */
const vary = (seed: number, slot: number): number =>
  noise2(seed * 0.731 + slot * 12.9898, slot * 4.1414 + 0.5, 911);

/**
 * Crater field: scattered bowls with raised rims (space). One candidate crater per grid cell,
 * so the cost per sample is constant however many craters there are.
 */
function craters(x: number, z: number, seed: number): number {
  const cell = 30;
  const cx = Math.floor(x / cell),
    cz = Math.floor(z / cell);
  let h = 0;
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      const gx = cx + i,
        gz = cz + j;
      if (noise2(gx * 7.31, gz * 3.17, seed) < 0.45) continue; // roughly half the cells are empty
      const r = 5 + noise2(gx * 1.93, gz * 5.71, seed + 1) * 9;
      const ox = (gx + 0.2 + 0.6 * noise2(gx * 9.1, gz * 2.3, seed + 2)) * cell;
      const oz = (gz + 0.2 + 0.6 * noise2(gx * 4.7, gz * 8.9, seed + 3)) * cell;
      const q = Math.hypot(x - ox, z - oz) / r;
      if (q > 1.8) continue;
      const bowl = q < 1 ? -r * 0.34 * (1 - q * q) : 0;
      const rim = r * 0.2 * Math.exp(-(((q - 1) / 0.22) ** 2));
      h += bowl + rim;
    }
  return h;
}

/** Wind-blown dunes: long asymmetric crests that wander with the noise. */
function dunes(x: number, z: number, seed: number, angle: number): number {
  const u = x * Math.cos(angle) + z * Math.sin(angle);
  const wobble = fbm(x * 0.02, z * 0.02, 2, seed) * 9;
  const k = (u * 0.085 + wobble) % (Math.PI * 2);
  const s = Math.sin(k);
  // Gentle windward slope, sharper lee side.
  return (s > 0 ? s : s * 0.35) * 0.5 + 0.18;
}

/** Stepped shelves (glacier terraces, mesa tiers): flat treads with steep risers between. */
function shelves(h: number, step: number): number {
  const t = h / step;
  const f = t - Math.floor(t);
  return (Math.floor(t) + smoothstep(0.72, 0.98, f)) * step;
}

/**
 * Terrain + rock spires + grass field around a hole. Flat near the course, rolling hills
 * further out, and ridged cliffs/mountains on the horizon (aerial haze comes from fog).
 */
export class Landscape {
  readonly group = new THREE.Group();
  private readonly owned: { dispose(): void }[] = [];
  private grassMat: THREE.MeshStandardMaterial | null = null;
  private grassShader: { uniforms: Record<string, { value: unknown }> } | null = null;

  /** Per-hole character: how strong each landform is and which way ridges and dunes run. */
  private readonly style: {
    swell: number;
    feature: number;
    ridge: number;
    angle: number;
    tint: number;
    light: number;
  };

  /** Stylised look (smooth painted terrain, model cliffs, hazier distance) on the model tiers. */
  private readonly stylized = natureActive();

  constructor(private readonly o: LandscapeOpts) {
    this.group.name = 'landscape';
    const s = o.seed;
    this.style = {
      swell: 0.6 + vary(s, 1) * 0.9,
      feature: 0.55 + vary(s, 2) * 0.95,
      ridge: 0.5 + vary(s, 3) * 1.0,
      angle: vary(s, 4) * Math.PI * 2,
      tint: (vary(s, 5) - 0.5) * 0.07,
      light: (vary(s, 6) - 0.5) * 0.09,
    };
    this.buildTerrain();
    if (o.haze) this.buildBackdrop(o.haze);
    this.buildRocks();
    if (o.grass > 0) this.buildGrass();
  }

  /** Distance (XZ) from the course footprint rectangle. */
  private distToCourse(x: number, z: number): number {
    const dx = Math.max(0, Math.abs(x - this.o.center.x) - this.o.half.x);
    const dz = Math.max(0, Math.abs(z - this.o.center.y) - this.o.half.y);
    return Math.hypot(dx, dz);
  }

  heightAt = (x: number, z: number): number => {
    const d = this.distToCourse(x, z);
    const s = this.o.seed;
    const space = this.o.kit === 'space';
    const hills = (fbm(x * 0.045, z * 0.045, 4, s) - 0.42) * 7 * smoothstep(5, 26, d);
    const mount = ridged(x * 0.011, z * 0.011, 5, s + 9) * (space ? 18 : 52) * smoothstep(34, 95, d);
    const cliffs = Math.max(0, ridged(x * 0.035, z * 0.035, 3, s + 3) - 0.55) * 26 * smoothstep(18, 40, d);
    let h = hills + mount + cliffs;
    // Everything below only starts well clear of the course, so the scenery frames the hole
    // without ever rising into the playable area or between the camera and the ball.
    const mid = smoothstep(16, 46, d);
    if (mid > 0) {
      const st = this.style;
      // A long ridge crossing the view somewhere beyond the course (direction varies per hole).
      const ax = Math.cos(st.angle),
        az = Math.sin(st.angle);
      const across = (x - this.o.center.x) * -az + (z - this.o.center.y) * ax;
      const offset = across - (48 + Math.max(this.o.half.x, this.o.half.y)) * (vary(s, 7) > 0.5 ? 1 : -1);
      const spine = Math.exp(-((offset / 16) ** 2)) * (0.55 + 0.45 * fbm(x * 0.03, z * 0.03, 3, s + 61));
      const swell = (fbm(x * 0.016, z * 0.016, 3, s + 21) - 0.42) * 22 * st.swell;
      switch (this.o.kit) {
        case 'meadow':
          // Rolling downs and one grassy ridge.
          h += (swell + spine * 15 * st.ridge) * mid;
          break;
        case 'candy': {
          // Gumdrop mounds (smooth domes) and soft sugar dunes.
          const drop = Math.pow(noise2(x * 0.045, z * 0.045, s + 31), 3) * 34 * st.feature;
          h += (swell * 0.5 + drop + dunes(x, z, s + 33, st.angle) * 4 * st.ridge) * mid;
          break;
        }
        case 'frozen': {
          // Glacier shelves: stepped ice terraces with sheer faces, and a knife-edge ridge.
          const ice = (fbm(x * 0.02, z * 0.02, 3, s + 41) - 0.3) * 30 * st.feature;
          h += (shelves(Math.max(0, ice), 5.5) + spine * 20 * st.ridge + swell * 0.35) * mid;
          break;
        }
        case 'clockwork': {
          // Mesa country: flat-topped tiers above a dune floor.
          const m = fbm(x * 0.019, z * 0.019, 3, s + 51);
          const mesa = (smoothstep(0.5, 0.56, m) * 11 + smoothstep(0.62, 0.67, m) * 9) * st.feature;
          h += (mesa + dunes(x, z, s + 53, st.angle) * 3.2 * st.ridge + swell * 0.3) * mid;
          break;
        }
        case 'space':
          // Regolith dunes and a crater rim ridge; the crater bowls come below.
          h += (dunes(x, z, s + 71, st.angle) * 2.6 * st.ridge + spine * 12 * st.ridge + swell * 0.4) * mid;
          break;
      }
    }
    if (space) h += craters(x, z, s + 5) * (0.7 + 0.5 * this.style.feature) * smoothstep(8, 20, d);
    return this.o.groundY + h;
  };

  private buildTerrain(): void {
    const { center, half, kit } = this.o;
    const size = Math.max(half.x, half.y) * 2 + 240;
    const seg = 200;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + center.x,
        z = pos.getZ(i) + center.y;
      pos.setXYZ(i, x, this.heightAt(x, z), z);
    }
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    const P = PALETTE[kit];
    // Each hole shifts the sector's palette a little, so two holes on one planet don't look alike.
    const shade = (hex: string) => new THREE.Color(hex).offsetHSL(this.style.tint, 0, this.style.light);
    const c = {
      g1: shade(P.g1),
      g2: shade(P.g2),
      dirt: shade(P.dirt),
      rock: shade(P.rock),
      rock2: shade(P.rock2),
      peak: new THREE.Color(P.peak),
    };
    // Rock strata: faint horizontal bands on steep faces (cliffs, mesa walls, crater rims).
    const strata = kit === 'clockwork' || kit === 'frozen' || kit === 'space' ? 0.16 : 0.08;
    const col = new Float32Array(pos.count * 3);
    const tmp = new THREE.Color();
    const rockTmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        y = pos.getY(i) - this.o.groundY,
        z = pos.getZ(i);
      const steep = 1 - nrm.getY(i);
      const n = noise2(x * 0.15, z * 0.15, 7);
      tmp.copy(c.g1).lerp(c.g2, fbm(x * 0.08, z * 0.08, 3, 2));
      tmp.lerp(c.dirt, smoothstep(0.25, 0.4, steep) * 0.6);
      rockTmp.copy(c.rock).lerp(c.rock2, n);
      tmp.lerp(rockTmp, smoothstep(0.33, 0.5, steep + y * 0.006));
      tmp.lerp(c.peak, smoothstep(30, 42, y + n * 6) * (1 - smoothstep(0.55, 0.75, steep)));
      const band = Math.floor((y + n * 1.5) / 2.4) % 2 === 0 ? 1 : 1 - strata;
      tmp.multiplyScalar(1 - (1 - band) * smoothstep(0.3, 0.55, steep));
      col.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      flatShading: !this.stylized,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.group.add(mesh);
    this.owned.push(geo, mat);
  }

  /**
   * Two rings of far-off mountains beyond the terrain's edge, each hazier than the last, for a
   * sense of depth. They are plain unlit silhouettes (two small meshes, two draw calls), so they
   * cost next to nothing even on low-end machines.
   */
  private buildBackdrop(haze: { fog: string; sky: string }): void {
    const { center, half, kit, seed } = this.o;
    const P = PALETTE[kit];
    const edge = Math.max(half.x, half.y) + 118;
    const fog = new THREE.Color(haze.fog);
    const sky = new THREE.Color(haze.sky);
    // The stylised look pushes the distance further into the sky colour (soft blue aerial haze).
    const hz = this.stylized && kit !== 'space' ? 0.12 : 0;
    const layers = [
      { r: edge, amp: kit === 'space' ? 26 : 46, base: 10, mix: 0.5 + hz, seed: seed + 201, freq: 3.1 },
      { r: edge + 80, amp: kit === 'space' ? 40 : 78, base: 18, mix: 0.76 + hz, seed: seed + 301, freq: 2.2 },
    ];
    const n = 120;
    for (const [li, L] of layers.entries()) {
      const pos: number[] = [];
      const col: number[] = [];
      const idx: number[] = [];
      const low = new THREE.Color(P.rock).lerp(fog, L.mix);
      const high = new THREE.Color(kit === 'space' ? P.peak : P.rock2)
        .lerp(fog, L.mix)
        .lerp(sky, 0.25 + 0.15 * li + hz);
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        // Sample the noise on a circle so the ring closes without a seam.
        const nx = Math.cos(a) * L.freq,
          nz = Math.sin(a) * L.freq;
        let hgt =
          L.base +
          ridged(nx + 7, nz + 3, 4, L.seed) * L.amp * (0.55 + 0.45 * fbm(nx * 0.6, nz * 0.6, 2, L.seed + 5));
        // Sector silhouettes: flat-topped mesas, stepped ice, rounded candy hills.
        if (kit === 'clockwork') hgt = shelves(hgt, 14) + 4;
        else if (kit === 'frozen') hgt = hgt * 1.15 + (i % 2) * 5;
        else if (kit === 'candy') hgt = L.base + (hgt - L.base) * 0.7 + Math.sin(a * 9 + L.seed) * 4;
        const x = center.x + Math.cos(a) * L.r,
          z = center.y + Math.sin(a) * L.r;
        pos.push(x, this.o.groundY - 30, z, x, this.o.groundY + hgt, z);
        col.push(low.r, low.g, low.b, high.r, high.g, high.b);
        if (i < n) {
          const k = i * 2;
          idx.push(k, k + 1, k + 3, k, k + 3, k + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `backdrop:${li}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = -1;
      this.group.add(mesh);
      this.owned.push(geo, mat);
    }
  }

  /** Big faceted rock spires and boulders (like cliffs rising out of the hills). */
  private buildRocks(): void {
    if (this.stylized && this.buildModelRocks()) return;
    const { center, half, kit, seed } = this.o;
    const P = PALETTE[kit];
    const variants: THREE.BufferGeometry[] = [];
    for (let v = 0; v < 4; v++) {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i),
          y = p.getY(i),
          z = p.getZ(i);
        const k = 0.7 + 0.55 * noise2(x * 1.7 + v * 5, z * 1.7 + y * 1.3, 40 + v);
        p.setXYZ(i, x * k, y * k, z * k);
      }
      g.computeVertexNormals();
      variants.push(g);
      this.owned.push(g);
    }
    const mats = [
      new THREE.MeshStandardMaterial({ color: P.rock, roughness: 0.95, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: P.rock2, roughness: 0.95, flatShading: true }),
    ];
    this.owned.push(...mats);
    let r = seed;
    const rand = () => (r = (r * 16807) % 2147483647) / 2147483647;
    const R = Math.max(half.x, half.y);
    for (let v = 0; v < variants.length; v++) {
      const count = 5;
      const im = new THREE.InstancedMesh(variants[v], mats[v % 2], count);
      const m = new THREE.Matrix4();
      for (let i = 0; i < count; i++) {
        const a = rand() * Math.PI * 2;
        const dist = R + 16 + rand() * 40;
        const x = center.x + Math.cos(a) * dist,
          z = center.y + Math.sin(a) * dist;
        const tall = kit === 'space' ? 3 + rand() * 4 : 5 + rand() * 9;
        const w = 2.2 + rand() * 3;
        m.compose(
          new THREE.Vector3(x, this.heightAt(x, z) + tall * 0.35, z),
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler((rand() - 0.5) * 0.2, rand() * 6, (rand() - 0.5) * 0.2),
          ),
          new THREE.Vector3(w, tall, w * (0.8 + rand() * 0.4)),
        );
        im.setMatrixAt(i, m);
      }
      im.castShadow = true;
      im.receiveShadow = true;
      this.group.add(im);
      this.owned.push({ dispose: () => im.dispose() });
    }
  }

  /**
   * Stylised: painted cliff rocks (the nature kit's boulders, scaled up into chunky buttes and
   * spires) standing round the course at a distance.
   */
  private buildModelRocks(): boolean {
    const rocks = rockModels();
    const mat = rockMaterial(this.o.kit);
    if (!rocks.length || !mat) return false;
    const { center, half, kit, seed } = this.o;
    let r = seed;
    const rand = () => (r = (r * 16807) % 2147483647) / 2147483647;
    const R = Math.max(half.x, half.y);
    const per = 7;
    const m = new THREE.Matrix4();
    for (const [v, rock] of rocks.entries()) {
      const im = new THREE.InstancedMesh(rock.geo, mat, per);
      const box = rock.geo.boundingBox!.clone().applyMatrix4(rock.local);
      for (let i = 0; i < per; i++) {
        const a = rand() * Math.PI * 2;
        const dist = R + 14 + rand() * 44;
        const x = center.x + Math.cos(a) * dist,
          z = center.y + Math.sin(a) * dist;
        // Buttes (wide, flat-topped) and spires (tall, narrow), sized in metres.
        const spire = (i + v) % 3 === 0;
        const tall = (kit === 'space' ? 3 : 5) + rand() * (spire ? 12 : 6);
        const wide = spire ? 3 + rand() * 2.5 : 6 + rand() * 6;
        const sx = wide / rock.size.x,
          sy = tall / rock.size.y,
          sz = (wide * (0.8 + rand() * 0.4)) / rock.size.z;
        const base = this.heightAt(x, z) - 0.6 - box.min.y * sy;
        m.compose(
          new THREE.Vector3(x, base, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * 6.28, 0)),
          new THREE.Vector3(sx, sy, sz),
        );
        im.setMatrixAt(i, m.multiply(rock.local));
      }
      // Well outside the shadow map round the course: no need to render them into it.
      im.castShadow = false;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      im.name = `cliffs:${v}`;
      this.group.add(im);
      this.owned.push({ dispose: () => im.dispose() });
    }
    return true;
  }

  /** Thousands of instanced grass blades with GPU wind sway. */
  private buildGrass(): void {
    const { center, half, kit, keepOut } = this.o;
    const P = PALETTE[kit];
    // One tapered blade, 7 verts. Colour gradient base -> tip via vertex colours; uv.y = height.
    const w = 0.035,
      hgt = 1;
    const verts = [-w, 0, w, 0, -w * 0.75, 0.4, w * 0.75, 0.4, -w * 0.4, 0.75, w * 0.4, 0.75, 0, 1];
    const pos = new Float32Array(7 * 3);
    const uv = new Float32Array(7 * 2);
    const col = new Float32Array(7 * 3);
    const base = new THREE.Color(P.grassBase),
      tip = new THREE.Color(P.grassTip);
    for (let i = 0; i < 7; i++) {
      const y = verts[i * 2 + 1] * hgt;
      pos.set([verts[i * 2], y, 0], i * 3);
      uv.set([0, y], i * 2);
      const c = base.clone().lerp(tip, y);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute(
      'normal',
      new THREE.BufferAttribute(
        new Float32Array(7 * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)),
        3,
      ),
    );
    geo.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6]);
    this.owned.push(geo);

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      this.grassShader = shader as unknown as { uniforms: Record<string, { value: unknown }> };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
        #else
          vec3 ip = vec3(0.0);
        #endif
        float bend = uv.y * uv.y;
        float gust = sin(uTime * 1.6 + ip.x * 0.35 + ip.z * 0.22) * 0.5 + sin(uTime * 2.7 + ip.x * 1.3) * 0.25;
        transformed.x += gust * 0.18 * bend;
        transformed.z += cos(uTime * 1.2 + ip.z * 0.5) * 0.08 * bend;`,
        );
      // Low sun behind the blades: they glow as the light shines through them.
      addTranslucency(shader, 0.6);
    };
    this.grassMat = mat;
    this.owned.push(mat);

    const n = this.o.grass;
    const im = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const tint = new THREE.Color();
    let seed = this.o.seed + 101;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const blocked = (x: number, z: number) => keepOut(x, z, 0.16);
    const extent = 18;
    let placed = 0;
    for (let tries = 0; placed < n && tries < n * 4; tries++) {
      // Bias towards the course: more grass near the rails, sparser further out.
      const t = Math.pow(rand(), 1.6);
      const x = center.x + (rand() * 2 - 1) * (half.x + extent * t + 0.5);
      const z = center.y + (rand() * 2 - 1) * (half.y + extent * t + 0.5);
      if (blocked(x, z)) continue;
      const y = this.heightAt(x, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
      const hh = 0.13 + rand() * 0.22;
      s.set(0.8 + rand() * 0.6, hh, 1);
      p.set(x, y - 0.02, z);
      m.compose(p, q, s);
      im.setMatrixAt(placed, m);
      // Clumpy variation (natural patches) plus a little per-blade noise.
      tint.setScalar(0.72 + fbm(x * 0.18, z * 0.18, 3, 77) * 0.45 + rand() * 0.12);
      im.setColorAt(placed, tint);
      placed++;
    }
    im.count = placed;
    im.receiveShadow = true;
    im.frustumCulled = false;
    this.group.add(im);
    this.owned.push({ dispose: () => im.dispose() });
  }

  update(time: number): void {
    if (this.grassShader) this.grassShader.uniforms.uTime.value = time;
    void this.grassMat;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
  }
}
