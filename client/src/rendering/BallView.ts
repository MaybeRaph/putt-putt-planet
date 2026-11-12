import * as THREE from 'three';
import { COSMETIC_BY_ID, PHYSICS, type Loadout } from '@ppp/shared';
import { canvasTexture, dimpleTexture, toon } from './materials';

const R = PHYSICS.ballRadius;

const skinCache = new Map<string, THREE.Texture>();
function skinTexture(id: string): THREE.Texture | null {
  const c = COSMETIC_BY_ID.get(id);
  if (!c || !c.pattern || c.pattern === 'solid') return null;
  let t = skinCache.get(id);
  if (t) return t;
  t = canvasTexture(128, (ctx, s) => {
    const a = c.color,
      b = c.color2 ?? '#ffffff';
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, s, s);
    switch (c.pattern) {
      case 'stripes':
        for (let i = 0; i < 6; i++)
          if (i % 2) {
            ctx.fillStyle = b;
            ctx.fillRect((i * s) / 6, 0, s / 6, s);
          }
        break;
      case 'dots':
        ctx.fillStyle = b;
        for (let i = 0; i < 18; i++) {
          ctx.beginPath();
          ctx.arc(((i * 37) % s) + 6, ((i * 53) % s) + 6, 7, 0, 7);
          ctx.fill();
        }
        break;
      case 'star':
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.arc(s * 0.25, s * 0.5, s * 0.16, 0, 7);
        ctx.fill();
        ctx.fillStyle = a;
        ctx.font = `bold ${s * 0.2}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.id === 'ball.eight' ? '8' : '★', s * 0.25, s * 0.52);
        break;
      case 'half':
        ctx.fillStyle = b;
        ctx.fillRect(0, s / 2, s, s / 2);
        break;
      case 'rainbow':
        for (let i = 0; i < 7; i++) {
          ctx.fillStyle = `hsl(${i * 51},90%,60%)`;
          ctx.fillRect(0, (i * s) / 7, s, s / 7 + 1);
        }
        break;
      case 'galaxy':
        for (let i = 0; i < 70; i++) {
          ctx.fillStyle = i % 5 === 0 ? '#ff80ab' : b;
          ctx.fillRect((i * 97) % s, (i * 61) % s, 2 + (i % 3), 2 + (i % 3));
        }
        break;
      case 'swirl':
        ctx.strokeStyle = b;
        ctx.lineWidth = 10;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo((i * s) / 4, 0);
          ctx.bezierCurveTo((i * s) / 4 + 40, s / 3, (i * s) / 4 - 40, (2 * s) / 3, (i * s) / 4, s);
          ctx.stroke();
        }
        break;
    }
  });
  skinCache.set(id, t);
  return t;
}

const hatGeo = new Map<string, THREE.BufferGeometry>();
function g(key: string, make: () => THREE.BufferGeometry) {
  let x = hatGeo.get(key);
  if (!x) hatGeo.set(key, (x = make()));
  return x;
}

/** Procedural hat meshes, sized for the ball. Returns a group whose origin sits on top of the ball. */
export function buildHat(id: string): THREE.Group {
  const grp = new THREE.Group();
  const c = COSMETIC_BY_ID.get(id);
  if (!c || id === 'hat.none') return grp;
  const col = c.color,
    col2 = c.color2 ?? '#ffffff';
  const add = (
    geo: THREE.BufferGeometry,
    color: string,
    x = 0,
    y = 0,
    z = 0,
    rx = 0,
    ry = 0,
    rz = 0,
    s = 1,
  ) => {
    const m = new THREE.Mesh(geo, toon(color));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.scale.setScalar(s);
    m.castShadow = true;
    grp.add(m);
    return m;
  };
  const dome = g('dome', () => new THREE.SphereGeometry(R * 0.82, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2));
  const cone = g('cone', () => new THREE.ConeGeometry(R * 0.55, R * 1.5, 14));
  const cyl = g('cyl', () => new THREE.CylinderGeometry(R * 0.55, R * 0.6, R * 1.0, 16));
  const brim = g('brim', () => new THREE.CylinderGeometry(R * 1.0, R * 1.0, R * 0.08, 20));
  const ball = g('pom', () => new THREE.SphereGeometry(R * 0.22, 10, 8));
  switch (id) {
    case 'hat.cap': {
      add(dome, col, 0, -R * 0.25);
      const bill = add(
        g('bill', () => new THREE.CylinderGeometry(R * 0.6, R * 0.6, R * 0.06, 16, 1, false, 0, Math.PI)),
        col2 === '#ffffff' ? col : col2,
        0,
        -R * 0.2,
        R * 0.35,
      );
      bill.rotation.y = -Math.PI / 2;
      break;
    }
    case 'hat.party':
      add(cone, col, 0, R * 0.55);
      add(ball, col2, 0, R * 1.35);
      break;
    case 'hat.tophat':
      add(brim, col, 0, -R * 0.15);
      add(
        g('tall', () => new THREE.CylinderGeometry(R * 0.55, R * 0.55, R * 1.3, 16)),
        col,
        0,
        R * 0.5,
      );
      add(
        g('band', () => new THREE.CylinderGeometry(R * 0.57, R * 0.57, R * 0.2, 16)),
        col2,
        0,
        R * 0.0,
      );
      break;
    case 'hat.crown': {
      add(
        g('crownBase', () => new THREE.CylinderGeometry(R * 0.6, R * 0.6, R * 0.4, 16, 1, true)),
        col,
        0,
        R * 0.05,
      );
      const spike = g('spike', () => new THREE.ConeGeometry(R * 0.12, R * 0.35, 6));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(spike, col, Math.cos(a) * R * 0.55, R * 0.4, Math.sin(a) * R * 0.55);
      }
      add(ball, '#e53935', 0, R * 0.12, R * 0.6, 0, 0, 0, 0.6);
      break;
    }
    case 'hat.propeller': {
      add(dome, col, 0, -R * 0.25);
      add(
        g('stick', () => new THREE.CylinderGeometry(R * 0.04, R * 0.04, R * 0.5)),
        '#ffeb3b',
        0,
        R * 0.7,
      );
      const prop = add(
        g('prop', () => new THREE.BoxGeometry(R * 1.6, R * 0.04, R * 0.22)),
        col2,
        0,
        R * 0.95,
      );
      prop.name = 'spin';
      break;
    }
    case 'hat.cowboy':
      add(
        g('wide', () => new THREE.CylinderGeometry(R * 1.3, R * 1.3, R * 0.06, 20)),
        col,
        0,
        -R * 0.12,
      );
      add(cyl, col, 0, R * 0.3);
      break;
    case 'hat.viking': {
      add(dome, col, 0, -R * 0.25);
      const horn = g('horn', () => new THREE.ConeGeometry(R * 0.14, R * 0.7, 8));
      add(horn, col2, R * 0.7, R * 0.25, 0, 0, 0, -0.9);
      add(horn, col2, -R * 0.7, R * 0.25, 0, 0, 0, 0.9);
      break;
    }
    case 'hat.chef':
      add(cyl, col, 0, R * 0.25);
      add(
        g('puff', () => new THREE.SphereGeometry(R * 0.7, 12, 8)),
        col,
        0,
        R * 0.85,
      );
      break;
    case 'hat.wizard':
      add(
        g('wbrim', () => new THREE.CylinderGeometry(R * 1.1, R * 1.1, R * 0.05, 20)),
        col,
        0,
        -R * 0.12,
      );
      add(
        g('wcone', () => new THREE.ConeGeometry(R * 0.6, R * 2.0, 14)),
        col,
        0,
        R * 0.9,
        0,
        0,
        0,
        0.15,
      );
      add(
        g('star', () => new THREE.OctahedronGeometry(R * 0.16)),
        col2,
        R * 0.15,
        R * 0.8,
        R * 0.38,
      );
      break;
    case 'hat.santa':
      add(
        g('sband', () => new THREE.TorusGeometry(R * 0.6, R * 0.14, 8, 16)),
        col2,
        0,
        -R * 0.1,
        0,
        Math.PI / 2,
      );
      add(cone, col, 0, R * 0.6, 0, 0, 0, 0.35);
      add(ball, col2, R * 0.48, R * 1.2);
      break;
    case 'hat.halo': {
      const h = add(
        g('halo', () => new THREE.TorusGeometry(R * 0.6, R * 0.07, 8, 24)),
        col,
        0,
        R * 0.55,
        0,
        Math.PI / 2,
      );
      h.material = toon(col, { emissive: 0.9 });
      break;
    }
    case 'hat.beanie':
      add(dome, col, 0, -R * 0.25);
      add(
        g('bband', () => new THREE.TorusGeometry(R * 0.78, R * 0.09, 8, 18)),
        col2,
        0,
        -R * 0.22,
        0,
        Math.PI / 2,
      );
      add(ball, col2, 0, R * 0.62);
      break;
  }
  return grp;
}

/** Procedural putter for the aiming pose. Origin = where the head meets the ball. */
export function buildPutter(id: string): THREE.Group {
  const c = COSMETIC_BY_ID.get(id) ?? COSMETIC_BY_ID.get('putter.classic')!;
  const grp = new THREE.Group();
  const shaftColor =
    c.pattern === 'stripes' ? (c.color2 ?? '#ff1744') : id === 'putter.wood' ? '#6d4c41' : '#eceff1';
  const shaft = new THREE.Mesh(
    g('shaft', () => new THREE.CylinderGeometry(0.018, 0.018, 1.0, 8)),
    toon(shaftColor),
  );
  shaft.position.set(0, 0.55, -0.12);
  shaft.rotation.x = -0.25;
  const grip = new THREE.Mesh(
    g('grip', () => new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8)),
    toon(c.color2 ?? '#263238'),
  );
  grip.position.set(0, 1.02, -0.24);
  grip.rotation.x = -0.25;
  const headGeo =
    id === 'putter.hammer'
      ? g('hammer', () => new THREE.CylinderGeometry(0.08, 0.08, 0.3, 12).rotateZ(Math.PI / 2))
      : g('head', () => new THREE.BoxGeometry(0.28, 0.09, 0.08));
  const head = new THREE.Mesh(headGeo, toon(c.color, { emissive: id === 'putter.neon' ? 0.6 : 0 }));
  head.position.set(0, 0.05, -0.08);
  for (const m of [shaft, grip, head]) {
    m.castShadow = true;
    grp.add(m);
  }
  return grp;
}

/** Visual for one ball: rolling skinned sphere, upright hat, trail ribbon, putter, squash & stretch. */
export class BallView {
  readonly root = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly hat: THREE.Group;
  private readonly putter: THREE.Group;
  private readonly trail: TrailRibbon;
  private readonly bodyMat: THREE.MeshPhysicalMaterial;
  private squash = 0;
  private squashDir = new THREE.Vector3(0, 1, 0);
  private putterSwing = 0;
  private hopT = -1;
  readonly pos = new THREE.Vector3();
  private lastPos = new THREE.Vector3();
  private heading = 0;
  visibleBall = true;

  constructor(
    readonly id: string,
    readonly loadout: Loadout,
    readonly ghost: boolean,
  ) {
    const skin = COSMETIC_BY_ID.get(loadout.ball) ?? COSMETIC_BY_ID.get('ball.classic')!;
    const tex = skinTexture(skin.id);
    // Glossy clear-coated ball with a dimple bump map.
    this.bodyMat = new THREE.MeshPhysicalMaterial({
      color: tex ? 0xffffff : skin.color,
      map: tex,
      roughness: 0.42,
      clearcoat: 0.8,
      clearcoatRoughness: 0.18,
      bumpMap: dimpleTexture(),
      bumpScale: 0.6,
      transparent: ghost,
      opacity: ghost ? 0.5 : 1,
    });
    this.body = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 24), this.bodyMat);
    this.body.castShadow = !ghost;
    this.root.add(this.body);
    this.hat = buildHat(loadout.hat);
    this.hat.position.y = R * 0.85;
    if (ghost) this.hat.traverse((o) => ((o as THREE.Mesh).castShadow = false));
    this.root.add(this.hat);
    this.putter = buildPutter(loadout.putter);
    this.putter.visible = false;
    this.root.add(this.putter);
    this.trail = new TrailRibbon(loadout.trail, ghost);
  }

  get trailMesh(): THREE.Mesh {
    return this.trail.mesh;
  }

  /** Called when the ball is (re)placed without travelling (reset/teleport). */
  snap(p: THREE.Vector3): void {
    this.pos.copy(p);
    this.lastPos.copy(p);
    this.root.position.copy(p);
    this.trail.reset();
  }

  impact(strength: number, dir?: THREE.Vector3): void {
    this.squash = Math.min(1, Math.max(this.squash, strength));
    if (dir) this.squashDir.copy(dir).normalize();
  }

  swing(): void {
    this.putterSwing = 1;
  }

  /** Victory hop played when the ball is holed. */
  celebrate(): void {
    this.hopT = 0;
  }

  showPutter(show: boolean, aimAngle = 0, power = 0): void {
    this.putter.visible = show || this.putterSwing > 0;
    if (!show && this.putterSwing <= 0) return;
    const back = 0.06 + power * 0.45 * (1 - this.putterSwing);
    const d = new THREE.Vector3(Math.cos(aimAngle), 0, Math.sin(aimAngle));
    this.putter.position.set(-d.x * (R + back), -R, -d.z * (R + back));
    // local -Z (shaft lean) points away from the aim direction
    this.putter.rotation.y = -aimAngle + Math.PI / 2;
  }

  update(pos: THREE.Vector3, vel: THREE.Vector3, dt: number, holed: boolean, reducedMotion: boolean): void {
    this.pos.copy(pos);
    const moved = pos.distanceTo(this.lastPos);
    if (moved > 2) {
      this.snap(pos);
    } else if (moved > 1e-5) {
      // Rolling: rotate around the axis perpendicular to travel on the ground plane.
      const d = pos.clone().sub(this.lastPos);
      d.y = 0;
      const l = d.length();
      if (l > 1e-5) {
        const axis = new THREE.Vector3(d.z, 0, -d.x).normalize();
        this.body.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, l / R));
        const targetHeading = Math.atan2(d.x, d.z);
        let dh = targetHeading - this.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        this.heading += dh * Math.min(1, dt * 8);
      }
    }
    this.lastPos.copy(pos);
    this.root.position.copy(pos);

    // Squash & stretch: squash on impact, stretch along velocity at speed.
    this.squash = Math.max(0, this.squash - dt * 5);
    const speed = vel.length();
    const stretch = reducedMotion ? 0 : Math.min(0.18, speed * 0.012);
    const sq = reducedMotion ? 0 : Math.sin(this.squash * Math.PI) * 0.28;
    const s = new THREE.Vector3(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6);
    if (stretch > 0.01 && speed > 0.1) {
      // approximate: stretch along heading
      s.x *= 1 - stretch * 0.4;
      s.z *= 1 - stretch * 0.4;
      s.y *= 1 - stretch * 0.3;
    }
    this.body.scale.copy(s);

    this.hat.rotation.y = this.heading;
    this.hat.position.y = R * 0.85 * s.y + Math.sin(this.squash * Math.PI) * 0.03;
    const spin = this.hat.getObjectByName('spin');
    if (spin) spin.rotation.y += dt * (6 + speed * 4);

    if (this.putterSwing > 0) this.putterSwing = Math.max(0, this.putterSwing - dt * 3);

    // Victory animation out of the cup (cosmetic: hop / spin / flip / rocket / dance)
    if (this.hopT >= 0) {
      this.hopT += dt;
      const k = Math.min(1, this.hopT / 1.2);
      const pop = 0.32 * Math.min(1, k * 3);
      const kind = this.loadout.victory;
      this.root.rotation.set(0, 0, 0);
      if (kind === 'victory.spin') {
        this.root.position.y += pop + Math.sin(k * Math.PI) * 0.5;
        this.root.rotation.y = k * Math.PI * 6;
      } else if (kind === 'victory.flip') {
        this.root.position.y += pop + Math.sin(k * Math.PI) * 0.9;
        this.root.rotation.x = -k * Math.PI * 2;
      } else if (kind === 'victory.rocket') {
        this.root.position.y += pop + k * k * 5;
        this.root.rotation.y = k * 20;
      } else if (kind === 'victory.dance') {
        this.root.position.y += pop + Math.abs(Math.sin(k * Math.PI * 4)) * 0.25;
        this.root.rotation.z = Math.sin(k * Math.PI * 6) * 0.5;
      } else {
        this.root.position.y += pop + Math.abs(Math.sin(k * Math.PI * 2)) * 0.55;
      }
      if (k >= 1) {
        this.hopT = -1;
        this.root.rotation.set(0, 0, 0);
      }
    }
    this.root.visible = this.visibleBall && (!holed || this.hopT >= 0);
    this.trail.update(this.root.position, speed, dt, this.root.visible && !holed);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.body.geometry.dispose();
    this.bodyMat.dispose();
    this.trail.dispose();
  }
}

/** Flat ribbon trail on the ground plane with fading vertex alpha. */
class TrailRibbon {
  readonly mesh: THREE.Mesh;
  private readonly pts: THREE.Vector3[] = [];
  private readonly N = 36;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly c1: THREE.Color;
  private readonly c2: THREE.Color;
  private readonly rainbow: boolean;
  private readonly enabled: boolean;
  private t = 0;

  constructor(id: string, ghost: boolean) {
    const c = COSMETIC_BY_ID.get(id);
    this.enabled = !!c && id !== 'trail.none';
    this.c1 = new THREE.Color(c?.color ?? '#ffffff');
    this.c2 = new THREE.Color(c?.color2 ?? c?.color ?? '#ffffff');
    this.rainbow = c?.pattern === 'rainbow';
    this.geo = new THREE.BufferGeometry();
    const n = this.N * 2;
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    const idx: number[] = [];
    for (let i = 0; i < this.N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: ghost ? 0.4 : 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  reset(): void {
    this.pts.length = 0;
  }

  update(p: THREE.Vector3, speed: number, dt: number, visible: boolean): void {
    this.t += dt;
    this.mesh.visible = this.enabled && visible && this.pts.length > 1;
    if (!this.enabled) return;
    const last = this.pts[0];
    if (speed > 0.4 && (!last || last.distanceTo(p) > 0.06)) {
      this.pts.unshift(p.clone().setY(p.y - R * 0.85));
      if (this.pts.length > this.N) this.pts.pop();
    } else if (speed <= 0.4 && this.pts.length) {
      this.pts.pop(); // decay quickly once stopped
    }
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const col = this.geo.attributes.color as THREE.BufferAttribute;
    const n = this.pts.length;
    const tmp = new THREE.Color();
    for (let i = 0; i < this.N; i++) {
      const a = this.pts[Math.min(i, n - 1)] ?? p;
      const b = this.pts[Math.min(i + 1, n - 1)] ?? a;
      let dx = a.x - b.x,
        dz = a.z - b.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const k = i / (this.N - 1);
      const w = 0.13 * (1 - k);
      pos.setXYZ(i * 2, a.x - dz * w, a.y, a.z + dx * w);
      pos.setXYZ(i * 2 + 1, a.x + dz * w, a.y, a.z - dx * w);
      if (this.rainbow) tmp.setHSL((k * 1.5 + this.t * 0.5) % 1, 0.9, 0.6);
      else tmp.copy(this.c1).lerp(this.c2, k);
      const alpha = i < n ? (1 - k) * (1 - k) : 0;
      col.setXYZW(i * 2, tmp.r, tmp.g, tmp.b, alpha);
      col.setXYZW(i * 2 + 1, tmp.r, tmp.g, tmp.b, alpha);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
