import * as THREE from 'three';
import type { Theme } from '@ppp/shared';
import { fbm, noise2, ridged, smoothstep } from './noise';
import type { Rect2 } from './decor';

type Kit = Theme['decorKit'];

/** Per-world terrain palette: low grass, high grass, dirt, rock, peak. */
const PALETTE: Record<Kit, { g1: string; g2: string; dirt: string; rock: string; rock2: string; peak: string; grassBase: string; grassTip: string }> = {
  meadow: { g1: '#4f9e3f', g2: '#76c257', dirt: '#8a6a48', rock: '#7d828c', rock2: '#9aa0a8', peak: '#eef3f8', grassBase: '#3f8a35', grassTip: '#a6dd6a' },
  candy: { g1: '#ff9ccb', g2: '#ffc2e0', dirt: '#d98bb5', rock: '#b07ccf', rock2: '#cfa3e6', peak: '#fff4fb', grassBase: '#ff7fb8', grassTip: '#ffe0f0' },
  frozen: { g1: '#dbe8f2', g2: '#eef5fb', dirt: '#b9c9d6', rock: '#6f8296', rock2: '#8fa2b5', peak: '#ffffff', grassBase: '#9fb7c4', grassTip: '#f2f8fc' },
  clockwork: { g1: '#7a6553', g2: '#8c7561', dirt: '#5e4b3d', rock: '#55473d', rock2: '#6e5c4f', peak: '#a07b5c', grassBase: '#6b5a3a', grassTip: '#b49a62' },
  space: { g1: '#2f2a50', g2: '#3b3560', dirt: '#2a2645', rock: '#4a4470', rock2: '#5b5488', peak: '#7d74c4', grassBase: '#4a3f7a', grassTip: '#9f8cff' },
};

export interface LandscapeOpts {
  center: THREE.Vector2;
  /** Half extents of the course footprint. */
  half: THREE.Vector2;
  groundY: number;
  kit: Kit;
  seed: number;
  keepOut: Rect2[];
  grass: number; // number of grass blades (0 = none)
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

  constructor(private readonly o: LandscapeOpts) {
    this.group.name = 'landscape';
    this.buildTerrain();
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
    if (space) h += -Math.pow(Math.max(0, noise2(x * 0.06, z * 0.06, s + 5) - 0.72), 2) * 60; // craters
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
    const c = {
      g1: new THREE.Color(P.g1),
      g2: new THREE.Color(P.g2),
      dirt: new THREE.Color(P.dirt),
      rock: new THREE.Color(P.rock),
      rock2: new THREE.Color(P.rock2),
      peak: new THREE.Color(P.peak),
    };
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
      col.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.group.add(mesh);
    this.owned.push(geo, mat);
  }

  /** Big faceted rock spires and boulders (like cliffs rising out of the hills). */
  private buildRocks(): void {
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
    const mats = [new THREE.MeshStandardMaterial({ color: P.rock, roughness: 0.95, flatShading: true }), new THREE.MeshStandardMaterial({ color: P.rock2, roughness: 0.95, flatShading: true })];
    this.owned.push(...mats);
    let r = seed;
    const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
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
          new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 0.2, rand() * 6, (rand() - 0.5) * 0.2)),
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
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(7 * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6]);
    this.owned.push(geo);

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      this.grassShader = shader as unknown as { uniforms: Record<string, { value: unknown }> };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
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
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const blocked = (x: number, z: number) => keepOut.some((k) => x > k.x0 - 0.22 && x < k.x1 + 0.22 && z > k.z0 - 0.22 && z < k.z1 + 0.22);
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
