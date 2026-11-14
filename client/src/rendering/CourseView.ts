import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  PHYSICS,
  computeBounds,
  dirVec,
  kinematicParts,
  obstaclePose,
  obstacleSolids,
  domeGrid,
  domeGridIndex,
  funnelGrid,
  funnelGridIndex,
  funnelHeightAt,
  solidRibbon,
  windmillVisual,
  type Collectible,
  type Hole,
  type Obstacle,
  type Solid,
  type Theme,
  type Tunnel,
  type Zone,
} from '@ppp/shared';
import { canvasTexture, checkerMaterial, darken, mottleTexture, toon, woodTexture } from './materials';
import { buildDecor } from './decor';
import { setSceneryFade } from './fade';
import { buildWater } from './water';
import { Footprint } from './footprint';
import { Landscape } from './Landscape';
import { hashString } from '@ppp/shared';

/** Frozen-looking floor surfaces (ice patches' texture, world-space UVs). */
const isFrozen = (s: Solid['surface']): boolean =>
  s === 'ice' || s === 'slick' || s === 'frost' || s === 'rime';

/**
 * Turns a Hole (schema data) into a Three.js scene graph. Owns every geometry/material/texture
 * it creates and frees them in dispose(). Moving parts and collectibles are animated in update().
 */
export class CourseView {
  readonly root = new THREE.Group();
  /** Meshes the camera must not pass through, and the aim preview reflects off. */
  readonly colliders: THREE.Object3D[] = [];
  /** Other pieces that may hide the ball from the camera (raised terraces); they fade too. */
  private readonly occluders: THREE.Object3D[] = [];
  readonly bounds: { min: THREE.Vector3; max: THREE.Vector3 };
  readonly groundY: number;
  private readonly owned: { dispose(): void }[] = [];
  private readonly movers: { o: Obstacle; obj: THREE.Object3D }[] = [];
  private readonly items = new Map<
    string,
    { c: Collectible; obj: THREE.Object3D; base: THREE.Vector3; taken: boolean; t: number }
  >();
  private readonly bumpers = new Map<string, { obj: THREE.Object3D; pulse: number }>();
  private readonly animTextures: { tex: THREE.Texture; dir: THREE.Vector2; speed: number }[] = [];
  private readonly waterMats: THREE.ShaderMaterial[] = [];
  private readonly spinners: { obj: THREE.Object3D; speed: number }[] = [];
  private readonly springs: { obj: THREE.Object3D; pulse: number; z: Zone }[] = [];
  private readonly tubes: { t: Tunnel; mats: THREE.MeshStandardMaterial[]; base: number; fade: number }[] =
    [];
  private flag!: THREE.Group;
  private flagCloth!: THREE.Mesh;
  private flagLift = 0;
  private colliderDebug: THREE.Group | null = null;
  private landscape: Landscape | null = null;
  private skirtIndex = 0;
  private clock = 0;

  constructor(
    readonly hole: Hole,
    readonly theme: Theme,
    opts: { decorDensity?: number; ownedItems?: Set<string>; grass?: number } = {},
  ) {
    this.root.name = `hole:${hole.id}`;
    const all: Solid[] = [...hole.solids];
    for (const o of hole.obstacles) all.push(...obstacleSolids(o));
    const b = computeBounds(all);
    this.bounds = { min: new THREE.Vector3(...b.min), max: new THREE.Vector3(...b.max) };
    const floorTops = hole.solids.filter((s) => s.role === 'floor').map((s) => computeBounds([s]).max[1]);
    // Ground sits just under the lowest green so courses look built into the landscape
    // (raised sections become terraces). In space the course floats high above a moon surface.
    this.groundY = Math.min(...floorTops) - (theme.decorKit === 'space' ? 9 : 0.32);

    for (const s of hole.solids) this.addSolid(s);
    this.flushStatic();
    for (const o of hole.obstacles) this.addObstacle(o);
    for (const z of hole.zones) this.addZone(z);
    this.courseCover = new Footprint(all, [], b.min, b.max);
    this.addWater();
    for (const t of hole.tunnels ?? []) this.addTunnel(t);
    for (const c of hole.collectibles) this.addItem(c, opts.ownedItems?.has(c.id) ?? false);
    this.addCup();
    this.addTee();

    // Exact footprint of the course (floors, rails, blocks, ponds): grass and scenery grow right
    // up to it, but never through it.
    const foot = new Footprint(all, hole.zones, b.min, b.max);
    const solidFoot = this.courseCover;
    // Keep the camera's usual spot behind the tee clear of trees.
    const t0 = hole.tee,
      t1 = hole.path[1] ?? hole.cup;
    const tl = Math.hypot(t1[0] - t0[0], t1[2] - t0[2]) || 1;
    const bx = t0[0] - ((t1[0] - t0[0]) / tl) * 3.5,
      bz = t0[2] - ((t1[2] - t0[2]) / tl) * 3.5;
    const nearCourse = (x: number, z: number, margin: number) => foot.near(x, z, margin);
    const keepOut = (x: number, z: number, margin: number) =>
      foot.near(x, z, margin) || (Math.abs(x - bx) < 3 + margin && Math.abs(z - bz) < 3 + margin);
    const onCourse = (x: number, z: number, margin: number) => solidFoot.near(x, z, margin);
    this.scenery = { nearCourse, keepOut, onCourse };
    this.buildScenery(opts.decorDensity ?? 1, opts.grass ?? 40000);
  }

  /** Footprint tests the scenery is placed with (kept so it can be rebuilt). */
  private readonly scenery: {
    nearCourse: (x: number, z: number, margin: number) => boolean;
    keepOut: (x: number, z: number, margin: number) => boolean;
    onCourse: (x: number, z: number, margin: number) => boolean;
  };
  private decor: THREE.Group | null = null;

  /** Terrain, grass and decor round the course. */
  private buildScenery(decorDensity: number, grass: number): void {
    const { hole, theme } = this;
    this.landscape = new Landscape({
      center: new THREE.Vector2(
        (this.bounds.min.x + this.bounds.max.x) / 2,
        (this.bounds.min.z + this.bounds.max.z) / 2,
      ),
      half: new THREE.Vector2(
        (this.bounds.max.x - this.bounds.min.x) / 2,
        (this.bounds.max.z - this.bounds.min.z) / 2,
      ),
      groundY: this.groundY,
      kit: theme.decorKit,
      seed: hashString(hole.id) % 100000,
      keepOut: this.scenery.nearCourse,
      grass: theme.decorKit === 'space' ? 0 : grass,
      // No far mountains in thick fog (the Fog Bank omen hides everything past the course).
      haze: theme.fogFar < 40 ? undefined : { fog: theme.fog, sky: theme.skyBottom },
    });
    this.root.add(this.landscape.group);
    this.decor = buildDecor(
      hole.id,
      theme.decorKit,
      hole.decor,
      this.bounds,
      this.scenery.keepOut,
      this.groundY,
      decorDensity,
      this.landscape.heightAt,
      this.scenery.onCourse,
    );
    this.root.add(this.decor);
  }

  private disposeScenery(): void {
    this.landscape?.dispose();
    this.landscape = null;
    if (this.decor) {
      this.decor.removeFromParent();
      this.decor.children.forEach((c) => {
        const im = c as THREE.InstancedMesh;
        im.dispose();
        // Per-batch wrappers only (the shapes they share are cached for the next hole).
        if (im.geometry.userData.wrapper) im.geometry.dispose();
      });
      this.decor = null;
    }
  }

  /**
   * Swap the scenery for the current graphics settings (classic or stylised models, density,
   * grass) without touching the course itself, so a quality change shows at once mid-hole.
   */
  rebuildScenery(decorDensity: number, grass: number): void {
    this.disposeScenery();
    this.buildScenery(decorDensity, grass);
  }

  private own<T extends { dispose(): void }>(x: T): T {
    this.owned.push(x);
    return x;
  }

  // ------------------------------------------------------------------------------------------

  private solidGeometry(s: Solid, rounded: boolean): THREE.BufferGeometry {
    if (s.shape === 'cylinder')
      return this.own(new THREE.CylinderGeometry(s.size[0] / 2, s.size[0] / 2, s.size[1], 24));
    if (rounded) {
      const r = Math.min(0.06, Math.min(...s.size) / 2.2);
      return this.own(new RoundedBoxGeometry(s.size[0], s.size[1], s.size[2], 2, r));
    }
    return this.own(new THREE.BoxGeometry(s.size[0], s.size[1], s.size[2]));
  }

  /** Smooth strip (slide, corkscrew): checker top, earthy sides, and a curtain down to the ground. */
  private addRibbon(s: Solid): void {
    const { left, right } = solidRibbon(s);
    const n = left.length;
    const th = s.size[1];
    const pos: number[] = [];
    const top: number[] = [],
      side: number[] = [];
    // Rows: left top, right top, left bottom, right bottom.
    for (let i = 0; i < n; i++) {
      const l = left[i],
        r = right[i];
      pos.push(l[0], l[1], l[2], r[0], r[1], r[2], l[0], l[1] - th, l[2], r[0], r[1] - th, r[2]);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = i * 4,
        b = a + 4;
      top.push(a + 1, a, b, a + 1, b, b + 1);
      side.push(a, a + 2, b + 2, a, b + 2, b); // left side
      side.push(a + 1, b + 1, b + 3, a + 1, b + 3, a + 3); // right side
      side.push(a + 2, a + 3, b + 3, a + 2, b + 3, b + 2); // bottom
    }
    const geo = this.own(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // World-space UVs (for ice/frost textures; the checker is world-space already).
    const uvs: number[] = [];
    for (let i = 0; i < pos.length; i += 3) uvs.push(pos[i] / 3, pos[i + 2] / 3);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex([...top, ...side]);
    geo.addGroup(0, top.length, 0);
    geo.addGroup(top.length, side.length, 1);
    geo.computeVertexNormals();
    // (A double-sided copy: the cached toon material is shared by every floor's sides.)
    this.ribbonSideMat ??= this.own(
      Object.assign(toon(darken(this.theme.ground, 0.62)).clone(), { side: THREE.DoubleSide }),
    );
    const sideMat = this.ribbonSideMat;
    const mesh = new THREE.Mesh(geo, [this.floorTopMaterial(s), sideMat]);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.root.add(mesh);
    if (s.skirt === false || this.theme.decorKit === 'space') return;
    // Earth curtains under both edges so a slide reads as a bank, not a floating plank.
    const cpos: number[] = [];
    const cidx: number[] = [];
    const bottom = this.groundY - 0.6;
    for (const edge of [left, right]) {
      const base = cpos.length / 3;
      for (const p of edge) cpos.push(p[0], p[1] - th, p[2], p[0], bottom, p[2]);
      for (let i = 0; i < n - 1; i++) {
        const a = base + i * 2;
        cidx.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
    const cg = this.own(new THREE.BufferGeometry());
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3));
    cg.setIndex(cidx);
    cg.computeVertexNormals();
    const skirtMat = (this.skirtMaterial() as THREE.MeshStandardMaterial).clone();
    skirtMat.side = THREE.DoubleSide;
    skirtMat.map = null;
    this.own(skirtMat);
    const curtain = new THREE.Mesh(cg, skirtMat);
    curtain.receiveShadow = true;
    this.root.add(curtain);
  }

  /**
   * @param separate keep a floor as its own mesh instead of merging it into the static batch.
   *   Obstacle tracks (the loop-the-loop) are added after the batch is flushed, and they stand
   *   between the camera and the ball, so they must be real, fadeable pieces.
   */
  private addSolid(s: Solid, separate = false): void {
    if (s.shape === 'ribbon') {
      this.addRibbon(s);
      return;
    }
    if (s.shape === 'dome') {
      this.addDome(s);
      return;
    }
    if (s.shape === 'funnel') {
      this.addFunnel(s);
      return;
    }
    let mesh: THREE.Mesh;
    const t = this.theme;
    if (s.role === 'floor') {
      // Floors never move or fade: they are baked into a few merged meshes (one per material).
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(...s.center),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(s.rot[0], s.rot[1], s.rot[2])),
        new THREE.Vector3(1, 1, 1),
      );
      const geo =
        s.shape === 'cylinder'
          ? new THREE.CylinderGeometry(s.size[0] / 2, s.size[0] / 2, s.size[1], 24)
          : new THREE.BoxGeometry(s.size[0], s.size[1], s.size[2]);
      if (isFrozen(s.surface)) {
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++)
          uv.setXY(i, (uv.getX(i) * s.size[0]) / 3, (uv.getY(i) * s.size[2]) / 3);
      }
      const mats = s.color
        ? [toon(s.color)]
        : s.shape === 'box'
          ? [
              this.floorSide(),
              this.floorSide(),
              this.floorTopMaterial(s),
              this.floorSide(),
              this.floorSide(),
              this.floorSide(),
            ]
          : [this.floorSide(), this.floorTopMaterial(s), this.floorSide()];
      // Raised terraces can stand between the camera and a ball on the tier below, so they stay
      // separate pieces that can fade; everything low is merged.
      const raised =
        separate || (this.theme.decorKit !== 'space' && computeBounds([s]).max[1] - this.groundY > 0.9);
      if (raised) {
        const grp = new THREE.Group();
        const mesh = new THREE.Mesh(this.own(geo), s.color ? mats[0] : mats);
        mesh.applyMatrix4(m);
        mesh.receiveShadow = true;
        mesh.castShadow = separate;
        grp.add(mesh);
        if (!s.color) this.addSkirt(s, grp);
        this.root.add(grp);
        grp.traverse((o) => (o as THREE.Mesh).isMesh && this.occluders.push(o));
        return;
      }
      this.queueStatic(geo, m, mats);
      if (!s.color) this.addSkirt(s);
      geo.dispose();
      return;
    } else if (s.role === 'wall') {
      const geo = this.solidGeometry(s, true);
      if (!s.color) {
        // Bake the plank repeat into the rail's UVs so every rail shares one material.
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        const rx = Math.max(1, s.size[0] / 1.4);
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * rx);
      }
      mesh = new THREE.Mesh(geo, s.color ? toon(s.color) : this.woodMaterial());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.colliders.push(mesh);
    } else {
      mesh = new THREE.Mesh(this.solidGeometry(s, true), this.blockMaterial(s.color ?? t.block));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.colliders.push(mesh);
    }
    mesh.position.set(...s.center);
    mesh.rotation.set(s.rot[0], s.rot[1], s.rot[2]);
    this.root.add(mesh);
  }

  /**
   * A low mound in the green: a smooth bell that rises out of the floor with no rim, with the
   * green's world-space checker running over it and analytic normals for soft shading. It casts
   * no shadow of its own (a dark blob made it read as a hole).
   */
  private addDome(s: Solid): void {
    const around = 48,
      rings = 16;
    const pts = domeGrid(s.center, s.size, around, rings);
    const a = s.size[0] / 2,
      h = Math.max(0.01, s.size[1]);
    const pos = new Float32Array(pts.length * 3);
    const nrm = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => {
      pos.set(p, i * 3);
      const dx = p[0] - s.center[0],
        dz = p[2] - s.center[2];
      const rho = Math.hypot(dx, dz);
      const slope = rho > 1e-6 && rho < a ? ((h * Math.PI) / (2 * a)) * Math.sin((Math.PI * rho) / a) : 0;
      const n = new THREE.Vector3(rho > 1e-6 ? (slope * dx) / rho : 0, 1, rho > 1e-6 ? (slope * dz) / rho : 0).normalize();
      nrm.set([n.x, n.y, n.z], i * 3);
    });
    const geo = this.own(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pts.length * 2), 2));
    geo.setIndex(domeGridIndex(around, rings));
    const mesh = new THREE.Mesh(geo, this.floorTopMaterial(s));
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.root.add(mesh);
  }

  /**
   * A funnel basin: its top (the green's checker, smooth normals) and a dark shell underneath,
   * 0.18 m thick, whose inner lip lines the hole. Seen from the green below it reads as a solid
   * bowl hanging over the course. It can fade like a raised terrace when it hides a ball.
   */
  private addFunnel(s: Solid): void {
    const around = 48,
      rings = 18;
    const top = funnelGrid(s.center, s.size, around, rings);
    const idx = funnelGridIndex(around, rings);
    const th = 0.18;
    const pos: number[] = [];
    for (const p of top) pos.push(p[0], p[1], p[2]);
    for (const p of top) pos.push(p[0], p[1] - th, p[2]);
    const n = top.length;
    const index: number[] = [...idx];
    const shell: number[] = [];
    // Underside: the same grid shifted down, facing down.
    for (let k = 0; k < idx.length; k += 3) shell.push(idx[k] + n, idx[k + 2] + n, idx[k + 1] + n);
    // Hole lip (ring 0) and outer edge (last ring): quads joining top and underside.
    for (const ring of [0, rings])
      for (let j = 0; j < around; j++) {
        const a = ring * around + j,
          b = ring * around + ((j + 1) % around);
        if (ring === 0) shell.push(a, a + n, b, b, a + n, b + n);
        else shell.push(a, b, a + n, b, b + n, a + n);
      }
    const geo = this.own(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const uvs: number[] = [];
    for (let i = 0; i < pos.length; i += 3) uvs.push(pos[i] / 3, pos[i + 2] / 3);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex([...index, ...shell]);
    geo.addGroup(0, index.length, 0);
    geo.addGroup(index.length, shell.length, 1);
    geo.computeVertexNormals();
    // Analytic normals on the top (smooth across the collar and the well).
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    const R = s.size[0] / 2;
    for (let i = 0; i < n; i++) {
      const dx = pos[i * 3] - s.center[0],
        dz = pos[i * 3 + 2] - s.center[2];
      const rho = Math.hypot(dx, dz);
      const e = 0.01;
      const slope = (funnelHeightAt(s.size, Math.min(R, rho + e)) - funnelHeightAt(s.size, Math.max(0, rho - e))) / (2 * e);
      const v = new THREE.Vector3((-slope * dx) / (rho || 1), 1, (-slope * dz) / (rho || 1)).normalize();
      nrm.setXYZ(i, v.x, v.y, v.z);
    }
    this.ribbonSideMat ??= this.own(
      Object.assign(toon(darken(this.theme.ground, 0.62)).clone(), { side: THREE.DoubleSide }),
    );
    const mesh = new THREE.Mesh(geo, [this.floorTopMaterial(s), this.ribbonSideMat]);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    const grp = new THREE.Group();
    grp.add(mesh);
    this.root.add(grp);
    this.occluders.push(mesh);
  }

  /** Wood-plank rail material tinted with the world's wall colour (one per hole, shared by every rail). */
  private woodMat: THREE.Material | null = null;
  private woodMaterial(): THREE.Material {
    this.woodMat ??= this.own(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(this.theme.wall).multiplyScalar(1.15),
        map: woodTexture(),
        roughness: 0.82,
      }),
    );
    return this.woodMat;
  }

  /** Static geometry waiting to be merged, by material. */
  private readonly staticBatches = new Map<THREE.Material, THREE.BufferGeometry[]>();

  /** Queue a geometry (placed by `m`) for merging; `mats` is indexed by its groups' materialIndex. */
  private queueStatic(geo: THREE.BufferGeometry, m: THREE.Matrix4, mats: THREE.Material[]): void {
    const flat = geo.index ? geo.toNonIndexed() : geo.clone();
    flat.applyMatrix4(m);
    const groups = geo.groups.length
      ? geo.groups
      : [{ start: 0, count: flat.attributes.position.count, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0] ?? mats[0];
      const part = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'uv']) {
        const a = flat.attributes[name] as THREE.BufferAttribute | undefined;
        if (!a) continue;
        part.setAttribute(
          name,
          new THREE.BufferAttribute(
            a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize),
            a.itemSize,
          ),
        );
      }
      let list = this.staticBatches.get(mat);
      if (!list) this.staticBatches.set(mat, (list = []));
      list.push(part);
    }
    flat.dispose();
  }

  /** Merge everything queued into one mesh per material. */
  private flushStatic(): void {
    for (const [mat, parts] of this.staticBatches) {
      const merged = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(this.own(merged), mat);
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
    this.staticBatches.clear();
  }

  private readonly blockMats = new Map<string, THREE.Material>();
  private blockMaterial(color: string): THREE.Material {
    let m = this.blockMats.get(color);
    if (!m) {
      m = this.own(new THREE.MeshStandardMaterial({ color, map: mottleTexture(), roughness: 0.7 }));
      this.blockMats.set(color, m);
    }
    return m;
  }

  /** Visual-only earth "skirt" under a floor down to the terrain, so raised greens read as terraces. */
  private floorSide(): THREE.Material {
    return toon(darken(this.theme.ground, 0.62));
  }

  private addSkirt(s: Solid, into?: THREE.Group): void {
    if (this.theme.decorKit === 'space' || s.shape !== 'box' || s.skirt === false) return;
    if (Math.abs(s.rot[0]) > 0.6 || Math.abs(s.rot[2]) > 0.6) return;
    const bb = computeBounds([s]);
    const top = bb.min[1] + 0.02;
    const bottom = this.groundY - 0.6;
    if (top - bottom < 0.05) return;
    const inset = 0.004 * (this.skirtIndex++ % 5);
    const pitch = s.rot[2];
    const len = s.size[0] * Math.cos(pitch) - inset * 2;
    const geo = new THREE.BoxGeometry(len, top - bottom, s.size[2] - inset * 2);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(s.center[0], (top + bottom) / 2, s.center[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.rot[1], 0)),
      new THREE.Vector3(1, 1, 1),
    );
    if (into) {
      const mesh = new THREE.Mesh(this.own(geo), this.skirtMaterial());
      mesh.applyMatrix4(m);
      mesh.receiveShadow = true;
      into.add(mesh);
      return;
    }
    this.queueStatic(geo, m, [this.skirtMaterial()]);
    geo.dispose();
  }

  private skirtMat: THREE.Material | null = null;
  private skirtMaterial(): THREE.Material {
    this.skirtMat ??= this.own(
      new THREE.MeshStandardMaterial({
        color: darken(this.theme.ground, 0.7),
        map: mottleTexture(),
        roughness: 0.95,
      }),
    );
    return this.skirtMat;
  }

  /**
   * Ice: a mid-blue, semi-glossy surface. Kept well below pure white so that a whole frozen green
   * (Slick Greens) under a strong sun doesn't blow out or bloom on high quality.
   */
  private iceMaterial(rx: number, ry: number, overlay = false, base = '#9ccbe3'): THREE.MeshStandardMaterial {
    const tex = this.own(
      canvasTexture(256, (c, s) => {
        c.fillStyle = base;
        c.fillRect(0, 0, s, s);
        c.strokeStyle = 'rgba(235,248,255,0.55)';
        c.lineWidth = 2;
        for (let i = 0; i < 14; i++) {
          c.beginPath();
          const x = Math.random() * s,
            y = Math.random() * s;
          c.moveTo(x, y);
          c.lineTo(x + 40 + Math.random() * 40, y + 10 + Math.random() * 20);
          c.stroke();
        }
      }),
    );
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(Math.max(1, rx), Math.max(1, ry));
    return this.own(
      new THREE.MeshStandardMaterial({
        map: tex,
        color: 0xd8e6ee,
        roughness: 0.42,
        metalness: 0,
        envMapIntensity: 0.6,
        ...(overlay
          ? { transparent: true, opacity: 0.94, polygonOffset: true, polygonOffsetFactor: -2 }
          : {}),
      }),
    );
  }

  private readonly iceMats = new Map<string, THREE.Material>();
  private ribbonSideMat: THREE.Material | null = null;
  private floorTopMaterial(s: Solid): THREE.Material {
    const t = this.theme;
    switch (s.surface) {
      case 'sand':
        return toon('#ecd9a0');
      case 'ice':
      case 'slick':
      case 'frost':
      case 'rime': {
        // One material per hole and look; box floors bake their size into the UVs (see addSolid).
        // Slick Greens look like ice; frost is paler; rime is a thin frost the green shows through.
        const key = s.surface === 'slick' ? 'ice' : s.surface;
        let m = this.iceMats.get(key);
        if (!m) {
          const base =
            key === 'ice'
              ? '#9ccbe3'
              : key === 'frost'
                ? '#c4dce6'
                : `#${new THREE.Color(t.floorA).lerp(new THREE.Color('#d6e8ee'), 0.62).getHexString()}`;
          this.iceMats.set(key, (m = this.iceMaterial(1, 1, false, base)));
        }
        return m;
      }
      case 'sticky':
        return toon('#f28dc0');
      case 'rubber':
        return toon('#ff6f91');
      default: // grass, candy, metal: themed checker
        return checkerMaterial(t.floorA, t.floorB, 1);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Zones
  // ------------------------------------------------------------------------------------------

  /**
   * A covered stretch: an arched tube swept along the centreline, with a rim at each mouth. It
   * fades to see-through while a ball rolls inside, and never blocks the camera or aim line.
   */
  private addTunnel(t: Tunnel): void {
    const kit = this.theme.decorKit;
    const look: Record<string, { a: string; b: string; rim: string; opacity: number; metal: number }> = {
      meadow: { a: '#8a5a32', b: '#a8743f', rim: '#d9b98a', opacity: 1, metal: 0 },
      candy: { a: '#ff8fb8', b: '#fff2f6', rim: '#ff5d9a', opacity: 1, metal: 0 },
      frozen: { a: '#a9d8ee', b: '#d8f1fb', rim: '#ffffff', opacity: 0.72, metal: 0.1 },
      clockwork: { a: '#b8893f', b: '#8f6a33', rim: '#e0c07a', opacity: 1, metal: 0.65 },
      space: { a: '#7fe0ff', b: '#4a6cff', rim: '#c8f4ff', opacity: 0.55, metal: 0.3 },
    };
    const L = look[kit] ?? look.meadow;
    const pts = t.points.map((p) => new THREE.Vector3(...p));
    const n = pts.length;
    const rho = t.width / 2 + 0.28;
    const rise = 1.05;
    const seg = 18;
    // Frames: tangent averaged at joints, widened by the mitre so the tube keeps its width round bends.
    const frames = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)],
        b = pts[Math.min(n - 1, i + 1)];
      const dir = new THREE.Vector3().subVectors(b, a);
      dir.y = 0;
      dir.normalize();
      let k = 1;
      if (i > 0 && i < n - 1) {
        const d0 = new THREE.Vector3()
          .subVectors(p, pts[i - 1])
          .setY(0)
          .normalize();
        k = 1 / Math.max(0.5, d0.dot(dir));
      }
      return { p, side: new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(k) };
    });
    let len = 0;
    const along = pts.map((p, i) => (i ? (len += p.distanceTo(pts[i - 1])) : 0));
    const pos: number[] = [],
      uv: number[] = [],
      idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const { p, side } = frames[i];
      for (let j = 0; j <= seg; j++) {
        const th = (Math.PI * j) / seg;
        pos.push(
          p.x + side.x * rho * Math.cos(th),
          p.y - 0.05 + rise * rho * Math.sin(th),
          p.z + side.z * rho * Math.cos(th),
        );
        uv.push(along[i] / 1.2, j / seg);
      }
    }
    for (let i = 0; i < n - 1; i++)
      for (let j = 0; j < seg; j++) {
        const a = i * (seg + 1) + j,
          b = a + seg + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    const geo = this.own(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const map = this.own(
      canvasTexture(128, (c, sz) => {
        c.fillStyle = L.a;
        c.fillRect(0, 0, sz, sz);
        c.fillStyle = L.b;
        if (kit === 'meadow') {
          // bark: long grain lines
          c.strokeStyle = 'rgba(60,35,15,0.35)';
          c.lineWidth = 3;
          for (let k = 0; k < 9; k++) {
            c.beginPath();
            c.moveTo(0, (k * sz) / 9 + 4);
            c.lineTo(sz, (k * sz) / 9 + 4 + ((k % 3) - 1) * 3);
            c.stroke();
          }
        } else if (kit === 'clockwork') {
          c.fillRect(0, 0, sz / 6, sz);
          c.fillStyle = 'rgba(255,240,200,0.6)';
          for (let k = 0; k < 6; k++) c.fillRect(sz / 12 - 3, (k * sz) / 6 + 8, 6, 6);
        } else c.fillRect(0, 0, sz / 2, sz);
      }),
    );
    const outer = this.own(
      new THREE.MeshStandardMaterial({
        map,
        roughness: kit === 'frozen' || kit === 'space' ? 0.25 : 0.75,
        metalness: L.metal,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: L.opacity,
        depthWrite: L.opacity >= 1,
      }),
    );
    const tube = new THREE.Mesh(geo, outer);
    tube.castShadow = L.opacity >= 1;
    tube.receiveShadow = true;
    this.root.add(tube);
    // Rims at both mouths.
    const rimMat = this.own(
      new THREE.MeshStandardMaterial({
        color: L.rim,
        roughness: 0.5,
        metalness: L.metal,
        transparent: true,
        opacity: 1,
      }),
    );
    for (const i of [0, n - 1]) {
      const { p, side } = frames[i];
      const ring = new THREE.Mesh(this.own(new THREE.TorusGeometry(rho, 0.09, 8, 24, Math.PI)), rimMat);
      ring.position.set(p.x, p.y - 0.05, p.z);
      ring.scale.set(1, rise, 1);
      // The torus lies in its XY plane: point its X axis along the tube's sideways direction.
      ring.rotation.y = -Math.atan2(side.z, side.x);
      ring.castShadow = true;
      this.root.add(ring);
    }
    this.tubes.push({ t, mats: [outer, rimMat], base: L.opacity, fade: 0 });
  }

  /** True when `b` is inside the tube (near its centreline and under the arch). */
  private inTube(t: Tunnel, b: THREE.Vector3): boolean {
    const r = t.width / 2 + 0.6;
    for (let i = 0; i < t.points.length - 1; i++) {
      const a = t.points[i],
        c = t.points[i + 1];
      const abx = c[0] - a[0],
        abz = c[2] - a[2];
      const l2 = abx * abx + abz * abz || 1e-6;
      const k = Math.max(0, Math.min(1, ((b.x - a[0]) * abx + (b.z - a[2]) * abz) / l2));
      const y = a[1] + (c[1] - a[1]) * k;
      if (Math.hypot(b.x - a[0] - abx * k, b.z - a[2] - abz * k) < r && b.y > y - 0.4 && b.y < y + 1.4)
        return true;
    }
    return false;
  }

  /** Ground the course itself covers (greens, rails, blocks), without the water. */
  private courseCover!: Footprint;

  /** Ponds, brooks and lagoons: each level of water zones becomes one body of water. */
  private addWater(): void {
    const w = buildWater(this.hole.zones, {
      theme: this.theme,
      groundY: this.groundY,
      bankMat: this.skirtMaterial(),
      blocked: (x, z, margin = 0.12) => this.courseCover.near(x, z, margin),
    });
    this.owned.push(...w.owned);
    this.waterMats.push(...w.animated);
    if (w.group.children.length) this.root.add(w.group);
  }

  private addZone(z: Zone): void {
    const floorY = z.center[1] - z.size[1] / 2 + 0.05;
    const mkPlane = (mat: THREE.Material, y: number) => {
      const m = new THREE.Mesh(this.own(new THREE.PlaneGeometry(z.size[0], z.size[2])), mat);
      m.rotation.set(-Math.PI / 2, 0, 0);
      const g = new THREE.Group();
      g.position.set(z.center[0], y, z.center[2]);
      g.rotation.y = z.rotY;
      g.add(m);
      m.receiveShadow = true;
      this.root.add(g);
      return g;
    };
    switch (z.kind) {
      case 'sand': {
        const tex = this.own(
          canvasTexture(128, (c, s) => {
            c.fillStyle = '#efd9a2';
            c.fillRect(0, 0, s, s);
            for (let i = 0; i < 900; i++) {
              c.fillStyle = Math.random() < 0.5 ? '#e2c787' : '#f7e7bf';
              c.fillRect(Math.random() * s, Math.random() * s, 2, 2);
            }
          }),
        );
        tex.repeat.set(z.size[0] / 2, z.size[2] / 2);
        mkPlane(
          this.own(new THREE.MeshToonMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2 })),
          floorY + 0.003,
        );
        break;
      }
      case 'ice': {
        const mat = this.iceMaterial(z.size[0] / 3, z.size[2] / 3, true);
        mkPlane(mat, floorY + 0.003);
        break;
      }
      case 'sticky': {
        const tex = this.own(
          canvasTexture(128, (c, s) => {
            c.fillStyle = '#f48fb1';
            c.fillRect(0, 0, s, s);
            for (let i = 0; i < 18; i++) {
              c.fillStyle = 'rgba(255,255,255,0.35)';
              c.beginPath();
              c.arc(Math.random() * s, Math.random() * s, 4 + Math.random() * 10, 0, 7);
              c.fill();
            }
          }),
        );
        tex.repeat.set(z.size[0] / 2, z.size[2] / 2);
        mkPlane(
          this.own(new THREE.MeshToonMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2 })),
          floorY + 0.003,
        );
        break;
      }
      case 'spring': {
        // Launch pad: a round striped pad on a squat coil.
        const r = Math.min(z.size[0], z.size[2]) / 2 - 0.02;
        const g = new THREE.Group();
        g.position.set(z.center[0], floorY, z.center[2]);
        const coil = new THREE.Mesh(
          this.own(new THREE.TorusGeometry(r * 0.62, 0.035, 6, 20)),
          this.own(new THREE.MeshStandardMaterial({ color: '#cfd8dc', metalness: 0.7, roughness: 0.3 })),
        );
        coil.rotation.x = Math.PI / 2;
        coil.position.y = 0.02;
        const tex = this.own(
          canvasTexture(128, (c, sz) => {
            for (let k = 5; k >= 1; k--) {
              c.fillStyle = k % 2 ? '#ff3d5a' : '#fff4e0';
              c.beginPath();
              c.arc(sz / 2, sz / 2, (sz / 2) * (k / 5), 0, 7);
              c.fill();
            }
            c.fillStyle = '#ffd23f';
            c.beginPath();
            c.moveTo(sz / 2, sz * 0.28);
            c.lineTo(sz * 0.66, sz * 0.5);
            c.lineTo(sz * 0.34, sz * 0.5);
            c.fill();
          }),
        );
        const disk = new THREE.Mesh(this.own(new THREE.CylinderGeometry(r, r, 0.06, 28)), [
          this.own(new THREE.MeshStandardMaterial({ color: '#b71c3a', roughness: 0.5 })),
          this.own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 })),
          this.own(new THREE.MeshStandardMaterial({ color: '#b71c3a', roughness: 0.5 })),
        ]);
        disk.position.y = 0.06;
        disk.rotation.y = z.rotY;
        disk.castShadow = true;
        disk.receiveShadow = true;
        g.add(coil, disk);
        this.root.add(g);
        this.springs.push({ obj: disk, pulse: 0, z });
        break;
      }
      case 'boost':
      case 'conveyor': {
        const boost = z.kind === 'boost';
        const tex = this.own(
          canvasTexture(128, (c, s) => {
            c.fillStyle = boost ? '#ff9f1c' : '#455a64';
            c.fillRect(0, 0, s, s);
            c.fillStyle = boost ? '#fff3b0' : '#ffca28';
            for (let k = 0; k < 2; k++) {
              const ox = k * (s / 2);
              c.beginPath();
              c.moveTo(ox + 8, 10);
              c.lineTo(ox + s / 2 - 12, s / 2);
              c.lineTo(ox + 8, s - 10);
              c.lineTo(ox + 26, s - 10);
              c.lineTo(ox + s / 2 + 6, s / 2);
              c.lineTo(ox + 26, 10);
              c.fill();
            }
          }),
        );
        // Texture u runs along the plane's local X; orient the plane so +u matches zone.dir.
        const mat = this.own(
          new THREE.MeshToonMaterial({
            map: tex,
            emissive: boost ? 0xff7b00 : 0x000000,
            emissiveIntensity: boost ? 0.35 : 0,
            polygonOffset: true,
            polygonOffsetFactor: -2,
          }),
        );
        const g = mkPlane(mat, floorY + 0.004);
        // Make the texture flow along `dir` irrespective of zone rotation.
        g.rotation.y = -z.dir;
        const m = g.children[0] as THREE.Mesh;
        const d = dirVec(z.dir);
        const lx = Math.abs(d[0]) * z.size[0] + Math.abs(d[2]) * z.size[2];
        const lz = Math.abs(d[2]) * z.size[0] + Math.abs(d[0]) * z.size[2];
        m.geometry.dispose();
        m.geometry = this.own(new THREE.PlaneGeometry(lx, lz));
        tex.repeat.set(lx / 1.2, lz / 1.2);
        this.animTextures.push({ tex, dir: new THREE.Vector2(-1, 0), speed: boost ? 1.6 : 0.4 * z.strength });
        break;
      }
      case 'water':
        // Drawn as whole bodies of water in addWater().
        break;
      case 'lowGravity': {
        const mat = this.own(
          new THREE.MeshBasicMaterial({
            color: 0x9d7bff,
            transparent: true,
            opacity: 0.12,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        const m = new THREE.Mesh(this.own(new THREE.BoxGeometry(z.size[0], z.size[1], z.size[2])), mat);
        m.position.set(...z.center);
        m.rotation.y = z.rotY;
        this.root.add(m);
        break;
      }
      case 'oneWay': {
        // A row of little flaps showing the allowed direction.
        const g = new THREE.Group();
        g.position.set(z.center[0], floorY, z.center[2]);
        g.rotation.y = -z.dir;
        const across = Math.abs(Math.sin(z.dir)) * z.size[0] + Math.abs(Math.cos(z.dir)) * z.size[2];
        const arrow = new THREE.Mesh(
          this.own(new THREE.ConeGeometry(0.16, 0.4, 3)),
          toon('#29b6f6', { emissive: 0.4 }),
        );
        const flapGeo = this.own(new THREE.BoxGeometry(0.04, 0.26, 0.22));
        const n = Math.max(2, Math.floor(across / 0.32));
        for (let i = 0; i < n; i++) {
          const f = new THREE.Mesh(flapGeo, toon('#4fc3f7', { transparent: 0.7 }));
          f.position.set(0, 0.13, -across / 2 + (i + 0.5) * (across / n));
          f.rotation.z = -0.35;
          g.add(f);
        }
        const a = arrow.clone();
        a.rotation.z = -Math.PI / 2;
        a.position.set(0, 0.45, 0);
        g.add(a);
        this.spinners.push({ obj: a, speed: 0 });
        this.root.add(g);
        break;
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // Obstacles
  // ------------------------------------------------------------------------------------------

  private addObstacle(o: Obstacle): void {
    // Static parts are rendered like solids.
    for (const s of obstacleSolids(o)) {
      if (o.type === 'bumper') continue; // custom look below
      this.addSolid(s, true);
    }
    const parts = kinematicParts(o);
    if (parts) {
      const g = new THREE.Group();
      for (const p of parts) {
        const color =
          p.look === 'blade'
            ? '#fff3e0'
            : p.look === 'bar'
              ? '#ef476f'
              : p.look === 'platform'
                ? '#8d6e63'
                : '#ffb703';
        const geo =
          p.shape === 'box'
            ? this.own(
                new RoundedBoxGeometry(
                  p.size[0],
                  p.size[1],
                  p.size[2],
                  2,
                  Math.min(0.05, Math.min(...p.size) / 2.2),
                ),
              )
            : this.own(new THREE.CylinderGeometry(p.size[0] / 2, p.size[0] / 2, p.size[1], 20));
        const m = new THREE.Mesh(geo, toon(color));
        m.position.set(...p.offset);
        m.quaternion.set(...p.rot);
        m.castShadow = true;
        m.receiveShadow = true;
        g.add(m);
        this.colliders.push(m);
      }
      if (o.type === 'windmill') {
        const hub = new THREE.Mesh(
          this.own(new THREE.CylinderGeometry(0.16, 0.16, 0.16, 12)),
          toon('#5d4037'),
        );
        hub.rotation.z = Math.PI / 2;
        g.add(hub);
      }
      if (o.type === 'mover' && o.role === 'floor') {
        // Checker top so platforms read as walkable.
        const top = new THREE.Mesh(
          this.own(new THREE.PlaneGeometry(o.size[0] * 0.96, o.size[2] * 0.96)),
          checkerMaterial('#a1887f', '#8d6e63', 0.5),
        );
        top.rotation.x = -Math.PI / 2;
        top.position.y = o.size[1] / 2 + 0.003;
        g.add(top);
      }
      this.root.add(g);
      this.movers.push({ o, obj: g });
    }
    switch (o.type) {
      case 'windmill': {
        const { depth, height } = windmillVisual(o);
        const roof = new THREE.Mesh(
          this.own(new THREE.ConeGeometry(o.baseWidth * 0.62, 1.2, 4)),
          toon('#6d4c41'),
        );
        roof.position.set(o.pos[0], o.pos[1] + height + 0.6, o.pos[2]);
        roof.rotation.y = -o.rotY + Math.PI / 4;
        roof.castShadow = true;
        this.root.add(roof);
        // door frame trim
        const d = dirVec(o.rotY);
        const trim = new THREE.Mesh(
          this.own(new THREE.TorusGeometry(o.tunnelWidth / 2, 0.05, 6, 16, Math.PI)),
          toon('#fff3e0'),
        );
        trim.position.set(
          o.pos[0] - d[0] * (depth / 2 + 0.01),
          o.pos[1] + 0.62 - o.tunnelWidth / 2 + 0.02,
          o.pos[2] - d[2] * (depth / 2 + 0.01),
        );
        trim.rotation.y = -o.rotY + Math.PI / 2;
        this.root.add(trim);
        break;
      }
      case 'bumper': {
        const g = new THREE.Group();
        g.position.set(...o.pos);
        const body = new THREE.Mesh(
          this.own(new THREE.CylinderGeometry(o.radius, o.radius * 1.05, o.height, 24)),
          toon('#ff4f8b'),
        );
        body.position.y = o.height / 2;
        const ring = new THREE.Mesh(
          this.own(new THREE.TorusGeometry(o.radius, 0.05, 8, 24)),
          toon('#fff176', { emissive: 0.5 }),
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = o.height * 0.7;
        const cap = new THREE.Mesh(
          this.own(new THREE.SphereGeometry(o.radius * 0.95, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)),
          toon('#ffffff'),
        );
        cap.position.y = o.height;
        cap.scale.y = 0.35;
        for (const m of [body, ring, cap]) {
          m.castShadow = true;
          g.add(m);
        }
        this.root.add(g);
        this.colliders.push(body);
        this.bumpers.set(o.id, { obj: g, pulse: 0 });
        break;
      }
      case 'teleporter': {
        // A gold entry pad is the jackpot kind: it warps a slow ball to the green.
        for (const [p, col] of [
          [o.a, o.maxSpeed !== undefined ? '#ffb300' : '#7c4dff'],
          [o.b, '#00e5ff'],
        ] as const) {
          const g = new THREE.Group();
          g.position.set(p[0], p[1] + 0.01, p[2]);
          const pad = new THREE.Mesh(
            this.own(new THREE.CircleGeometry(o.radius, 28)),
            toon(col, { emissive: 0.6 }),
          );
          pad.rotation.x = -Math.PI / 2;
          const ring = new THREE.Mesh(
            this.own(new THREE.TorusGeometry(o.radius, 0.04, 6, 28)),
            toon('#ffffff', { emissive: 0.8 }),
          );
          ring.rotation.x = Math.PI / 2;
          ring.position.y = 0.15;
          const ring2 = ring.clone();
          ring2.scale.setScalar(0.7);
          ring2.position.y = 0.35;
          g.add(pad, ring, ring2);
          this.spinners.push({ obj: ring, speed: 2 }, { obj: ring2, speed: -3 });
          this.root.add(g);
        }
        // exit arrow
        const d = dirVec(o.exitDir);
        const arrow = new THREE.Mesh(
          this.own(new THREE.ConeGeometry(0.12, 0.3, 3)),
          toon('#00e5ff', { emissive: 0.6 }),
        );
        arrow.position.set(o.b[0] + d[0] * 0.7, o.b[1] + 0.05, o.b[2] + d[2] * 0.7);
        arrow.rotation.set(Math.PI / 2, 0, 0);
        arrow.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), -o.exitDir - Math.PI / 2);
        this.root.add(arrow);
        break;
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // Items, cup, tee, ground
  // ------------------------------------------------------------------------------------------

  private addItem(c: Collectible, alreadyOwned: boolean): void {
    let obj: THREE.Object3D;
    const ghost = alreadyOwned ? 0.45 : 1;
    switch (c.kind) {
      case 'coin': {
        const m = new THREE.Mesh(
          this.own(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 20)),
          toon('#ffd23f', { emissive: 0.35 }),
        );
        m.rotation.x = Math.PI / 2;
        obj = new THREE.Group();
        obj.add(m);
        break;
      }
      case 'gem': {
        obj = new THREE.Mesh(
          this.own(new THREE.OctahedronGeometry(0.22, 0)),
          toon('#2ee6d6', { emissive: 0.5, transparent: ghost }),
        );
        obj.scale.y = 1.4;
        break;
      }
      case 'golden': {
        obj = new THREE.Group();
        const s = new THREE.Mesh(
          this.own(new THREE.SphereGeometry(0.2, 20, 14)),
          toon('#ffc400', { emissive: 0.7, transparent: ghost }),
        );
        const halo = new THREE.Mesh(
          this.own(new THREE.TorusGeometry(0.32, 0.025, 6, 30)),
          toon('#fff59d', { emissive: 1 }),
        );
        obj.add(s, halo);
        break;
      }
      case 'crate': {
        obj = new THREE.Group();
        const box = new THREE.Mesh(
          this.own(new RoundedBoxGeometry(0.42, 0.42, 0.42, 2, 0.05)),
          toon('#8e5cf7'),
        );
        const rib1 = new THREE.Mesh(this.own(new THREE.BoxGeometry(0.44, 0.44, 0.08)), toon('#ffd23f'));
        const rib2 = rib1.clone();
        rib2.rotation.y = Math.PI / 2;
        obj.add(box, rib1, rib2);
        break;
      }
    }
    obj.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    obj.position.set(...c.pos);
    this.root.add(obj);
    this.items.set(c.id, { c, obj, base: new THREE.Vector3(...c.pos), taken: false, t: 0 });
  }

  private addCup(): void {
    const [x, y, z] = this.hole.cup;
    const r = PHYSICS.cupRadius * this.hole.cupScale;
    const holeTex = this.own(
      canvasTexture(64, (c, s) => {
        const g = c.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
        g.addColorStop(0, '#000000');
        g.addColorStop(0.75, '#1b1b1b');
        g.addColorStop(1, '#3a3a3a');
        c.fillStyle = g;
        c.fillRect(0, 0, s, s);
      }),
    );
    const disc = new THREE.Mesh(
      this.own(new THREE.CircleGeometry(r, 32)),
      this.own(new THREE.MeshBasicMaterial({ map: holeTex, polygonOffset: true, polygonOffsetFactor: -4 })),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x, y + 0.004, z);
    const rim = new THREE.Mesh(this.own(new THREE.RingGeometry(r, r + 0.04, 32)), toon('#ffffff'));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(x, y + 0.005, z);
    this.root.add(disc, rim);

    this.flag = new THREE.Group();
    this.flag.position.set(x, y, z);
    const poleTex = this.own(
      canvasTexture(16, (c, s) => {
        for (let i = 0; i < 8; i++) {
          c.fillStyle = i % 2 ? '#ffffff' : '#e53935';
          c.fillRect(0, (i * s) / 8, s, s / 8);
        }
      }),
    );
    poleTex.repeat.set(1, 2);
    const pole = new THREE.Mesh(
      this.own(new THREE.CylinderGeometry(0.03, 0.03, 2.1, 8)),
      this.own(new THREE.MeshToonMaterial({ map: poleTex })),
    );
    pole.position.y = 1.05;
    pole.castShadow = true;
    const clothGeo = this.own(new THREE.PlaneGeometry(0.7, 0.42, 8, 2));
    clothGeo.translate(0.35, 0, 0);
    this.flagCloth = new THREE.Mesh(
      clothGeo,
      this.own(new THREE.MeshToonMaterial({ color: '#ff3d3d', side: THREE.DoubleSide })),
    );
    this.flagCloth.position.y = 1.85;
    this.flagCloth.castShadow = true;
    this.flag.add(pole, this.flagCloth);
    this.root.add(this.flag);
  }

  private addTee(): void {
    const [x, y, z] = this.hole.tee;
    const a = this.hole.path[1];
    const mat = new THREE.Mesh(
      this.own(new THREE.PlaneGeometry(0.9, 0.9)),
      toon('#ffffff', { transparent: 0.35 }),
    );
    mat.rotation.x = -Math.PI / 2;
    mat.rotation.z = Math.atan2(a[2] - z, a[0] - x);
    mat.position.set(x, y + 0.003, z);
    this.root.add(mat);
  }

  // ------------------------------------------------------------------------------------------
  // Runtime
  // ------------------------------------------------------------------------------------------

  /** Hide collectibles that are not active in this run. */
  syncItems(active: Set<string>): void {
    for (const [id, it] of this.items)
      if (!active.has(id) && !it.taken) {
        it.taken = true;
        it.obj.visible = false;
      }
  }

  /** Animate an item being collected (flies up to the ball, shrinks). */
  collect(id: string): THREE.Vector3 | null {
    const it = this.items.get(id);
    if (!it || it.taken) return null;
    it.taken = true;
    it.t = 0;
    return it.obj.position.clone();
  }

  itemKind(id: string) {
    return this.items.get(id)?.c.kind;
  }

  /** A ball was just launched: bounce the spring pad under it (each launch, every ball). */
  pulseSpring(at: THREE.Vector3): void {
    for (const sp of this.springs)
      if (
        Math.hypot(at.x - sp.z.center[0], at.z - sp.z.center[2]) <
        Math.max(sp.z.size[0], sp.z.size[2]) / 2 + 0.4
      )
        sp.pulse = 1;
  }

  private readonly occRay = new THREE.Raycaster();
  /** Objects faded because they stand between the camera and the ball. */
  private readonly faded = new Map<
    THREE.Object3D,
    {
      alpha: number;
      hit: boolean;
      mats: {
        mesh: THREE.Mesh;
        orig: THREE.Material | THREE.Material[];
        fade: THREE.Material | THREE.Material[];
      }[];
    }
  >();

  private occList: THREE.Object3D[] | null = null;
  private occCandidates(): THREE.Object3D[] {
    this.occList ??= [...this.colliders, ...this.occluders];
    return this.occList;
  }

  /** The whole object a mesh belongs to (an obstacle's group, or the mesh itself). */
  private fadeUnit(o: THREE.Object3D): THREE.Object3D {
    let u = o;
    while (u.parent && u.parent !== this.root) u = u.parent;
    return u;
  }

  /**
   * Fade rails, blocks and machinery standing between the camera and the ball (or around the
   * camera), so the ball and the line of the shot always stay visible. They come back when clear.
   */
  updateOcclusion(cam: THREE.Vector3, ball: THREE.Vector3, dt: number): void {
    setSceneryFade(ball);
    for (const f of this.faded.values()) f.hit = false;
    const from = ball.clone().add(new THREE.Vector3(0, 0.12, 0));
    for (const lift of [0, 0.35]) {
      const to = cam.clone().add(new THREE.Vector3(0, -lift, 0));
      const dir = to.clone().sub(from);
      const far = dir.length();
      if (far < 1e-3) continue;
      this.occRay.set(from, dir.divideScalar(far));
      this.occRay.near = 0.25;
      this.occRay.far = far + 0.3;
      for (const hit of this.occRay.intersectObjects(this.occCandidates(), false)) {
        const u = this.fadeUnit(hit.object);
        let f = this.faded.get(u);
        if (!f) {
          f = { alpha: 1, hit: true, mats: [] };
          u.traverse((m) => {
            const mesh = m as THREE.Mesh;
            if (!mesh.isMesh) return;
            const orig = mesh.material;
            const fadeOne = (x: THREE.Material) => {
              const c = x.clone();
              c.transparent = true;
              c.depthWrite = false;
              this.owned.push(c);
              return c;
            };
            f!.mats.push({ mesh, orig, fade: Array.isArray(orig) ? orig.map(fadeOne) : fadeOne(orig) });
          });
          this.faded.set(u, f);
        }
        f.hit = true;
      }
    }
    // Faded copies of the materials are made once per object and kept for next time.
    const k = 1 - Math.exp(-dt * 10);
    for (const f of this.faded.values()) {
      if (!f.hit && f.alpha >= 1) continue;
      f.alpha = f.alpha + ((f.hit ? 0.28 : 1) - f.alpha) * k;
      if (!f.hit && f.alpha > 0.985) f.alpha = 1;
      for (const m of f.mats) {
        m.mesh.material = f.alpha >= 1 ? m.orig : m.fade;
        for (const x of Array.isArray(m.fade) ? m.fade : [m.fade]) x.opacity = f.alpha;
      }
    }
  }

  pulseBumper(id: string): void {
    const b = this.bumpers.get(id);
    if (b) b.pulse = 1;
  }

  /**
   * @param simTime obstacle clock (seconds since hole start)
   * @param dt frame delta
   * @param balls ball positions (magnet effect on items, flag lift)
   */
  update(simTime: number, dt: number, balls: THREE.Vector3[]): void {
    this.clock += dt;
    this.landscape?.update(this.clock);
    for (const m of this.movers) {
      const p = obstaclePose(m.o, simTime);
      m.obj.position.set(...p.p);
      m.obj.quaternion.set(...p.q);
    }
    const now = performance.now() / 1000;
    for (const [, it] of this.items) {
      if (it.taken) {
        if (it.obj.visible) {
          it.t += dt;
          const k = it.t / 0.35;
          it.obj.position.y += dt * 3;
          it.obj.scale.setScalar(Math.max(0.001, 1 + k * 0.6 - k * k * 1.6));
          if (k >= 1) it.obj.visible = false;
        }
        continue;
      }
      const ph = it.base.x * 0.7 + it.base.z * 0.3;
      it.obj.position.copy(it.base);
      it.obj.position.y += Math.sin(now * 2.4 + ph) * 0.06;
      it.obj.rotation.y = now * (it.c.kind === 'coin' ? 2.4 : 1.2) + ph;
      // magnetic lean towards nearby balls
      for (const b of balls) {
        const d = b.distanceTo(it.base);
        if (d < 1.4) it.obj.position.lerp(b, (1 - d / 1.4) * 0.35);
      }
    }
    for (const [, b] of this.bumpers) {
      if (b.pulse > 0) b.pulse = Math.max(0, b.pulse - dt * 4);
      const s = 1 + Math.sin(b.pulse * Math.PI) * 0.25;
      b.obj.scale.set(s, 1 + b.pulse * 0.1, s);
    }
    for (const a of this.animTextures) a.tex.offset.x += a.dir.x * a.speed * dt * 0.8;
    for (const w of this.waterMats) w.uniforms.uTime.value = now;
    for (const sp of this.springs) {
      sp.pulse = Math.max(0, sp.pulse - dt * 3);
      sp.obj.position.y = 0.06 + Math.sin(sp.pulse * Math.PI) * 0.18;
    }
    for (const tb of this.tubes) {
      const inside = balls.some((b) => this.inTube(tb.t, b));
      tb.fade += ((inside ? 1 : 0) - tb.fade) * Math.min(1, dt * 6);
      const o = tb.base * (1 - 0.78 * tb.fade);
      for (const m of tb.mats) {
        m.opacity = m === tb.mats[0] ? o : 1 - 0.7 * tb.fade;
        m.depthWrite = o >= 0.99;
      }
    }
    for (const s of this.spinners) {
      if (s.speed) s.obj.rotation.z += s.speed * dt;
      else s.obj.position.y = 0.45 + Math.sin(now * 3) * 0.06;
    }
    // Flag: waves, and lifts when a ball approaches the cup.
    const pos = this.flagCloth.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, Math.sin(x * 6 - now * 5) * 0.06 * x);
    }
    pos.needsUpdate = true;
    const cup = new THREE.Vector3(...this.hole.cup);
    let near = false;
    for (const b of balls) if (b.distanceTo(cup) < 2.2) near = true;
    this.flagLift += ((near ? 1 : 0) - this.flagLift) * Math.min(1, dt * 4);
    this.flag.position.y = this.hole.cup[1] + this.flagLift * 0.9;
  }

  /** Debug: wireframe of every physics collider (solids, obstacle parts). */
  toggleColliderDebug(show: boolean): void {
    if (this.colliderDebug) {
      this.root.remove(this.colliderDebug);
      this.colliderDebug.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.colliderDebug = null;
    }
    if (!show) return;
    const g = new THREE.Group();
    const mat = toon('#ff00ff');
    const wire = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
    void mat;
    const all = [...this.hole.solids, ...this.hole.obstacles.flatMap((o) => obstacleSolids(o))];
    for (const s of all) {
      if (s.shape === 'ribbon' || s.shape === 'dome' || s.shape === 'funnel') continue;
      const geo =
        s.shape === 'box'
          ? new THREE.BoxGeometry(...s.size)
          : new THREE.CylinderGeometry(s.size[0] / 2, s.size[0] / 2, s.size[1], 12);
      const m = new THREE.Mesh(geo, wire);
      m.position.set(...s.center);
      m.rotation.set(...s.rot);
      g.add(m);
    }
    for (const z of this.hole.zones) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(...z.size),
        new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true }),
      );
      m.position.set(...z.center);
      m.rotation.y = z.rotY;
      g.add(m);
    }
    this.colliderDebug = g;
    this.root.add(g);
  }

  dispose(): void {
    setSceneryFade(null);
    this.toggleColliderDebug(false);
    this.root.removeFromParent();
    this.disposeScenery();
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
  }
}
