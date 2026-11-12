import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  PHYSICS,
  computeBounds,
  dirVec,
  kinematicParts,
  obstaclePose,
  obstacleSolids,
  windmillVisual,
  type Collectible,
  type Hole,
  type Obstacle,
  type Solid,
  type Theme,
  type Zone,
} from '@ppp/shared';
import { canvasTexture, checkerMaterial, darken, mottleTexture, toon, woodTexture } from './materials';
import { buildDecor, type Rect2 } from './decor';
import { Landscape } from './Landscape';
import { hashString } from '@ppp/shared';

/**
 * Turns a Hole (schema data) into a Three.js scene graph. Owns every geometry/material/texture
 * it creates and frees them in dispose(). Moving parts and collectibles are animated in update().
 */
export class CourseView {
  readonly root = new THREE.Group();
  /** Meshes the camera must not pass through, and the aim preview reflects off. */
  readonly colliders: THREE.Object3D[] = [];
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
    for (const o of hole.obstacles) this.addObstacle(o);
    for (const z of hole.zones) this.addZone(z);
    for (const c of hole.collectibles) this.addItem(c, opts.ownedItems?.has(c.id) ?? false);
    this.addCup();
    this.addTee();

    const keepOut: Rect2[] = all.map((s) => {
      const bb = computeBounds([s]);
      return { x0: bb.min[0], z0: bb.min[2], x1: bb.max[0], z1: bb.max[2] };
    });
    // Keep the camera's usual spot behind the tee clear of trees.
    const t0 = hole.tee,
      t1 = hole.path[1] ?? hole.cup;
    const tl = Math.hypot(t1[0] - t0[0], t1[2] - t0[2]) || 1;
    const bx = t0[0] - ((t1[0] - t0[0]) / tl) * 3.5,
      bz = t0[2] - ((t1[2] - t0[2]) / tl) * 3.5;
    const courseRects = keepOut.slice();
    keepOut.push({ x0: bx - 3, z0: bz - 3, x1: bx + 3, z1: bz + 3 });
    this.landscape = new Landscape({
      center: new THREE.Vector2((this.bounds.min.x + this.bounds.max.x) / 2, (this.bounds.min.z + this.bounds.max.z) / 2),
      half: new THREE.Vector2((this.bounds.max.x - this.bounds.min.x) / 2, (this.bounds.max.z - this.bounds.min.z) / 2),
      groundY: this.groundY,
      kit: theme.decorKit,
      seed: hashString(hole.id) % 100000,
      keepOut: courseRects,
      grass: theme.decorKit === 'space' ? 0 : (opts.grass ?? 40000),
    });
    this.root.add(this.landscape.group);
    const heightAt = this.landscape.heightAt;
    const decor = buildDecor(
      hole.id,
      theme.decorKit,
      hole.decor,
      this.bounds,
      keepOut,
      this.groundY,
      opts.decorDensity ?? 1,
      heightAt,
    );
    this.root.add(decor);
    this.owned.push({ dispose: () => decor.children.forEach((c) => (c as THREE.InstancedMesh).dispose()) });
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

  private addSolid(s: Solid): void {
    let mesh: THREE.Mesh;
    const t = this.theme;
    if (s.role === 'floor') {
      const geo = this.solidGeometry(s, false);
      if (s.color) {
        mesh = new THREE.Mesh(geo, toon(s.color));
      } else {
        const top = this.floorTopMaterial(s);
        const side = toon(darken(t.ground, 0.62));
        mesh = new THREE.Mesh(
          geo,
          s.shape === 'box' ? [side, side, top, side, side, side] : [side, top, side],
        );
        this.addSkirt(s);
      }
      mesh.receiveShadow = true;
    } else if (s.role === 'wall') {
      mesh = new THREE.Mesh(this.solidGeometry(s, true), s.color ? toon(s.color) : this.woodMaterial(s.size[0]));
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

  /** Wood-plank rail material tinted with the world's wall colour (texture repeats along the rail). */
  private woodMaterial(length: number): THREE.Material {
    const map = this.own(woodTexture().clone());
    map.needsUpdate = true;
    map.repeat.set(Math.max(1, length / 1.4), 1);
    return this.own(new THREE.MeshStandardMaterial({ color: new THREE.Color(this.theme.wall).multiplyScalar(1.15), map, roughness: 0.82 }));
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
  private addSkirt(s: Solid): void {
    if (this.theme.decorKit === 'space' || s.shape !== 'box') return;
    if (Math.abs(s.rot[0]) > 0.6 || Math.abs(s.rot[2]) > 0.6) return;
    const bb = computeBounds([s]);
    const top = bb.min[1] + 0.02;
    const bottom = this.groundY - 0.6;
    if (top - bottom < 0.05) return;
    const inset = 0.004 * (this.skirtIndex++ % 5);
    const pitch = s.rot[2];
    const len = s.size[0] * Math.cos(pitch) - inset * 2;
    const geo = this.own(new THREE.BoxGeometry(len, top - bottom, s.size[2] - inset * 2));
    const m = new THREE.Mesh(geo, this.skirtMaterial());
    m.position.set(s.center[0], (top + bottom) / 2, s.center[2]);
    m.rotation.set(0, s.rot[1], 0);
    m.receiveShadow = true;
    this.root.add(m);
  }

  private skirtMat: THREE.Material | null = null;
  private skirtMaterial(): THREE.Material {
    this.skirtMat ??= this.own(
      new THREE.MeshStandardMaterial({ color: darken(this.theme.ground, 0.7), map: mottleTexture(), roughness: 0.95 }),
    );
    return this.skirtMat;
  }

  /**
   * Ice: a mid-blue, semi-glossy surface. Kept well below pure white so that a whole frozen green
   * (Slick Greens) under a strong sun doesn't blow out or bloom on high quality.
   */
  private iceMaterial(rx: number, ry: number, overlay = false): THREE.MeshStandardMaterial {
    const tex = this.own(
      canvasTexture(256, (c, s) => {
        c.fillStyle = '#9ccbe3';
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
        ...(overlay ? { transparent: true, opacity: 0.94, polygonOffset: true, polygonOffsetFactor: -2 } : {}),
      }),
    );
  }

  private floorTopMaterial(s: Solid): THREE.Material {
    const t = this.theme;
    switch (s.surface) {
      case 'sand':
        return toon('#ecd9a0');
      case 'ice':
        return this.iceMaterial(s.size[0] / 3, s.size[2] / 3);
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
      case 'water': {
        const top = z.center[1] + z.size[1] / 2;
        const mat = new THREE.ShaderMaterial({
          transparent: true,
          uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(this.theme.water) },
            uSky: { value: new THREE.Color(this.theme.skyBottom).lerp(new THREE.Color(this.theme.skyTop), 0.4) },
          },
          vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
          fragmentShader: `uniform float uTime; uniform vec3 uColor; uniform vec3 uSky; varying vec3 vW;
            void main(){
              vec2 g = vec2(cos(vW.x*2.1 + uTime*1.3) + cos((vW.x+vW.z)*3.3 - uTime*1.7), sin(vW.z*2.7 - uTime*1.1) + sin((vW.x-vW.z)*2.9 + uTime*0.9)) * 0.08;
              vec3 n = normalize(vec3(g.x, 1.0, g.y));
              vec3 v = normalize(cameraPosition - vW);
              float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
              vec3 sunDir = normalize(vec3(0.55, 0.75, 0.38));
              float spec = pow(max(dot(reflect(-v, n), sunDir), 0.0), 120.0);
              vec3 deep = uColor * 0.55;
              vec3 c = mix(mix(deep, uColor, 0.6 + 0.4 * n.x), uSky, fres * 0.75) + spec * 1.6;
              gl_FragColor = vec4(c, 0.88 + fres * 0.1);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }`,
        });
        this.own(mat);
        this.waterMats.push(mat);
        mkPlane(mat, top - 0.14);
        // pool bed
        const bed = new THREE.Mesh(
          this.own(new THREE.BoxGeometry(z.size[0], 0.2, z.size[2])),
          toon(darken(this.theme.water, 0.5)),
        );
        bed.position.set(z.center[0], top - 0.75, z.center[2]);
        bed.rotation.y = z.rotY;
        this.root.add(bed);
        break;
      }
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
      this.addSolid(s);
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
        for (const [p, col] of [
          [o.a, '#7c4dff'],
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
    this.toggleColliderDebug(false);
    this.root.removeFromParent();
    this.landscape?.dispose();
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
  }
}
