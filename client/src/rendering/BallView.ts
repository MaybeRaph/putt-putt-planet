import * as THREE from 'three';
import { buildSticker } from './stickers';
import { COSMETIC_BY_ID, PHYSICS, type Loadout } from '@ppp/shared';
import { canvasTexture, dimpleTexture, toon } from './materials';

const R = PHYSICS.ballRadius;

const skinCache = new Map<string, THREE.Texture>();
export function skinTexture(id: string): THREE.Texture | null {
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
      default:
        drawCasePattern(ctx, s, c.pattern ?? 'solid', a, b);
    }
  });
  skinCache.set(id, t);
  return t;
}

/** v1.11 case-skin patterns (equirectangular: x wraps around the ball, y runs pole to pole). */
export function drawCasePattern(ctx: CanvasRenderingContext2D, s: number, pattern: string, a: string, b: string): void {
  // A fixed pseudo-random sequence, so every player sees the same skin.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  switch (pattern) {
    case 'gradient': {
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, b);
      g.addColorStop(1, a);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      break;
    }
    case 'rings':
      for (let i = 0; i < 9; i++) {
        ctx.fillStyle = i % 2 ? b : a;
        ctx.fillRect(0, (i * s) / 9, s, s / 9 + 1);
      }
      break;
    case 'sprinkles': {
      const cols = [b, '#ffffff', '#ffeb3b', '#69f0ae', '#40c4ff'];
      for (let i = 0; i < 90; i++) {
        ctx.save();
        ctx.translate(rnd() * s, rnd() * s);
        ctx.rotate(rnd() * Math.PI);
        ctx.fillStyle = cols[i % cols.length];
        ctx.fillRect(-5, -1.5, 10, 3);
        ctx.restore();
      }
      break;
    }
    case 'hex': {
      ctx.strokeStyle = b;
      ctx.lineWidth = 3;
      const r = s / 12;
      for (let row = -1; row < 9; row++)
        for (let col = -1; col < 9; col++) {
          const cx = col * r * 1.75 + (row % 2 ? r * 0.87 : 0),
            cy = row * r * 1.5;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const ang = Math.PI / 6 + (k * Math.PI) / 3;
            ctx.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
          }
          ctx.closePath();
          ctx.stroke();
        }
      break;
    }
    case 'crystal':
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = i % 3 ? b : `${b}99`;
        ctx.beginPath();
        const x = rnd() * s,
          y = rnd() * s,
          w = 6 + rnd() * 16;
        ctx.moveTo(x, y - w);
        ctx.lineTo(x + w * 0.5, y);
        ctx.lineTo(x, y + w);
        ctx.lineTo(x - w * 0.5, y);
        ctx.closePath();
        ctx.fill();
      }
      break;
    case 'gear':
      for (let i = 0; i < 7; i++) {
        const x = rnd() * s,
          y = rnd() * s,
          r = 8 + rnd() * 12;
        ctx.fillStyle = b;
        ctx.beginPath();
        for (let k = 0; k < 24; k++) {
          const ang = (k / 24) * Math.PI * 2;
          const rr = k % 2 ? r : r * 1.3;
          ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = a;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.35, 0, 7);
        ctx.fill();
      }
      break;
    case 'circuit':
      ctx.strokeStyle = b;
      ctx.fillStyle = b;
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 18; i++) {
        let x = Math.round(rnd() * 16) * (s / 16),
          y = Math.round(rnd() * 16) * (s / 16);
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 3; k++) {
          if (k % 2) y += (rnd() - 0.5) * s * 0.4;
          else x += (rnd() - 0.5) * s * 0.4;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, 7);
        ctx.fill();
      }
      break;
    case 'nebula': {
      for (let i = 0; i < 9; i++) {
        const x = rnd() * s,
          y = rnd() * s,
          r = s * (0.15 + rnd() * 0.25);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, i % 2 ? `${b}cc` : '#ffffff55');
        g.addColorStop(1, `${b}00`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      }
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 60; i++) {
        ctx.globalAlpha = 0.4 + rnd() * 0.6;
        ctx.fillRect(rnd() * s, rnd() * s, 1.5, 1.5);
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'marble':
      ctx.strokeStyle = b;
      for (let i = 0; i < 7; i++) {
        ctx.lineWidth = 2 + rnd() * 5;
        ctx.beginPath();
        let y = rnd() * s;
        ctx.moveTo(0, y);
        for (let x = 0; x <= s; x += 8) {
          y += (rnd() - 0.5) * 12;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    case 'petals': {
      ctx.fillStyle = b;
      for (let i = 0; i < 4; i++) {
        const cx = (i + 0.5) * (s / 4),
          cy = i % 2 ? s * 0.3 : s * 0.7;
        for (let k = 0; k < 8; k++) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate((k / 8) * Math.PI * 2);
          ctx.beginPath();
          ctx.ellipse(0, -9, 4, 8, 0, 0, 7);
          ctx.fill();
          ctx.restore();
        }
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, 7);
        ctx.fill();
      }
      break;
    }
  }
}

/** Soft round glow sprite (additive), shared by every glowing and mythic ball. */
let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  glowTex = canvasTexture(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  return glowTex;
}

/**
 * Mythic balls: a holographic shell whose pattern drifts and whose glow slides between the
 * skin's two colours, a breathing aura, sparks orbiting on two tilted rings, and a wake of
 * stardust while it rolls.
 */
class MythicFx {
  readonly group = new THREE.Group();
  private readonly aura: THREE.Sprite;
  private readonly sparks: THREE.Points;
  /** World-space stardust wake (added to the scene beside the ball, like the trail). */
  readonly wake: THREE.Points;
  private readonly life = new Float32Array(48);
  private readonly vel: THREE.Vector3[] = [];
  private next = 0;
  private t = Math.random() * 10;
  private readonly c1: THREE.Color;
  private readonly c2: THREE.Color;
  private readonly white = new THREE.Color('#ffffff');
  private readonly tmp = new THREE.Color();

  constructor(
    color: string,
    color2: string,
    private readonly mat: THREE.MeshPhysicalMaterial,
    private readonly map: THREE.Texture | null,
    ghost: boolean,
  ) {
    this.c1 = new THREE.Color(color);
    this.c2 = new THREE.Color(color2);
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false } as const;
    this.aura = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: this.c2, opacity: ghost ? 0.3 : 1, ...additive }),
    );
    this.aura.scale.setScalar(R * 7);
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(14 * 3), 3));
    this.sparks = new THREE.Points(
      sparkGeo,
      new THREE.PointsMaterial({ map: glowTexture(), size: 0.12, color: this.c2.clone().lerp(this.white, 0.45), ...additive }),
    );
    // A shockwave ring that pulses out across the ground every couple of seconds.
    this.wave = new THREE.Mesh(
      new THREE.RingGeometry(R * 0.9, R * 1.25, 40),
      new THREE.MeshBasicMaterial({ color: this.c2, side: THREE.DoubleSide, opacity: 0, ...additive }),
    );
    this.wave.rotation.x = -Math.PI / 2;
    this.wave.position.y = -R + 0.012;
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(48 * 3), 3));
    dustGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(48 * 3), 3));
    this.wake = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({ map: glowTexture(), size: 0.07, vertexColors: true, ...additive }),
    );
    this.wake.frustumCulled = false;
    for (let i = 0; i < 48; i++) this.vel.push(new THREE.Vector3());
    this.group.add(this.aura, this.sparks, this.wave);
  }

  private readonly wave: THREE.Mesh;

  update(dt: number, worldPos: THREE.Vector3, speed: number, visible: boolean): void {
    this.t += dt;
    const t = this.t;
    // The glow follows the skin's pattern (emissiveMap); its tint slides from white to the accent colour.
    this.mat.emissive.setRGB(1, 1, 1).lerp(this.c2, 0.35 + 0.35 * Math.sin(t * 1.6));
    this.mat.emissiveIntensity = 0.55 + 0.4 * Math.sin(t * 3.1) ** 2;
    if (this.map) this.map.offset.x = (this.map.offset.x + dt * 0.08) % 1;
    this.mat.iridescenceThicknessRange = [180 + 120 * Math.sin(t), 700 + 200 * Math.cos(t * 0.7)];
    // Aura breathes.
    (this.aura.material as THREE.SpriteMaterial).color.copy(this.c2).lerp(this.white, 0.2 + 0.2 * Math.sin(t * 2.2));
    this.aura.scale.setScalar(R * (6.4 + Math.sin(t * 3) * 0.9));
    // Shockwave: grows from the ball and fades, every 2.2 s.
    const ph = (t / 2.2) % 1;
    this.wave.scale.setScalar(1 + ph * 4.5);
    (this.wave.material as THREE.MeshBasicMaterial).opacity = (1 - ph) ** 2 * 0.9;
    // Sparks on two tilted rings, in opposite directions.
    const sp = this.sparks.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < 14; i++) {
      const ring = i % 2;
      const ang = t * (ring ? 2.6 : -2.1) + (i / 14) * Math.PI * 2;
      const r = R * (ring ? 1.9 : 2.4);
      const tilt = ring ? 0.6 : -0.9;
      const z = Math.sin(ang) * r;
      sp.setXYZ(i, Math.cos(ang) * r, z * Math.sin(tilt) + R * 0.2, z * Math.cos(tilt));
    }
    sp.needsUpdate = true;
    (this.sparks.material as THREE.PointsMaterial).size = 0.07 + 0.03 * Math.sin(t * 9);
    // Stardust wake while rolling.
    const dp = this.wake.geometry.attributes.position as THREE.BufferAttribute;
    const dc = this.wake.geometry.attributes.color as THREE.BufferAttribute;
    if (visible && speed > 0.5) {
      const n = Math.min(3, Math.ceil(speed * dt * 20));
      for (let j = 0; j < n; j++) {
        const i = this.next++ % 48;
        this.life[i] = 0.8;
        dp.setXYZ(
          i,
          worldPos.x + (Math.random() - 0.5) * R,
          worldPos.y + (Math.random() - 0.3) * R,
          worldPos.z + (Math.random() - 0.5) * R,
        );
        this.vel[i].set((Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 0.4);
      }
    }
    for (let i = 0; i < 48; i++) {
      if (this.life[i] <= 0) {
        dc.setXYZ(i, 0, 0, 0);
        continue;
      }
      this.life[i] -= dt;
      const v = this.vel[i];
      dp.setXYZ(i, dp.getX(i) + v.x * dt, dp.getY(i) + v.y * dt, dp.getZ(i) + v.z * dt);
      const k = Math.max(0, this.life[i] / 0.8);
      this.tmp.copy(this.c1).lerp(this.c2, (i % 5) / 4).lerp(this.white, 0.3);
      dc.setXYZ(i, this.tmp.r * k, this.tmp.g * k, this.tmp.b * k);
    }
    dp.needsUpdate = true;
    dc.needsUpdate = true;
    this.group.visible = visible;
  }

  dispose(): void {
    this.wake.removeFromParent();
    this.sparks.geometry.dispose();
    this.wake.geometry.dispose();
    (this.sparks.material as THREE.Material).dispose();
    (this.wake.material as THREE.Material).dispose();
    (this.aura.material as THREE.Material).dispose();
    this.wave.geometry.dispose();
    (this.wave.material as THREE.Material).dispose();
    this.map?.dispose();
  }
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

/**
 * Procedural putter for the aiming pose. Origin = where the head meets the ball; the ball sits
 * towards +z, the shaft leans back towards -z. Every style plays the same: looks only.
 */
export function buildPutter(id: string): THREE.Group {
  const c = COSMETIC_BY_ID.get(id) ?? COSMETIC_BY_ID.get('putter.classic')!;
  const shape = c.shape ?? 'blade';
  const col = c.color,
    col2 = c.color2 ?? '#263238';
  const grp = new THREE.Group();
  // Neon, star wands and the rarer case putters (v1.11) glow.
  const glow = id === 'putter.neon' || shape === 'star' ? 0.55 : c.rarity === 'legendary' ? 0.8 : c.rarity === 'epic' ? 0.4 : 0;
  const add = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, emissive = 0) => {
    const m = new THREE.Mesh(geo, toon(color, { emissive, metalness: id === 'putter.gold' ? 0.6 : 0 }));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    grp.add(m);
    return m;
  };
  const shaftColor =
    shape === 'cane'
      ? '#ffffff'
      : shape === 'hockey' || shape === 'flamingo' || shape === 'star'
        ? col
        : id === 'putter.wood'
          ? '#6d4c41'
          : shape === 'hammer'
            ? '#a1887f'
            : '#eceff1';
  // Shaft (striped for the candy cane) and grip.
  if (shape === 'cane') {
    for (let k = 0; k < 8; k++) {
      const f = (k + 0.5) / 8;
      add(
        g('caneseg', () => new THREE.CylinderGeometry(0.02, 0.02, 1.0 / 8, 8)),
        k % 2 ? col2 : '#ffffff',
        0,
        0.55 + (f - 0.5) * Math.cos(0.25),
        -0.12 + (f - 0.5) * Math.sin(-0.25),
        -0.25,
      );
    }
  } else add(g('shaft', () => new THREE.CylinderGeometry(0.018, 0.018, 1.0, 8)), shaftColor, 0, 0.55, -0.12, -0.25);
  if (shape !== 'cane') add(g('grip', () => new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8)), shape === 'hockey' ? '#212121' : col2, 0, 1.02, -0.24, -0.25);
  switch (shape) {
    case 'mallet':
      // Half-moon mallet with a sight line on top.
      add(g('mallet', () => new THREE.CylinderGeometry(0.12, 0.12, 0.07, 24, 1, false, Math.PI / 2, Math.PI)), col, 0, 0.045, -0.04);
      add(g('malletface', () => new THREE.BoxGeometry(0.24, 0.07, 0.014)), col, 0, 0.045, -0.04);
      add(g('sight', () => new THREE.BoxGeometry(0.012, 0.004, 0.1)), col2, 0, 0.082, -0.09, 0, 0, 0, 0.3);
      break;
    case 'fang':
      add(g('fangface', () => new THREE.BoxGeometry(0.26, 0.065, 0.045)), col, 0, 0.045, -0.06, 0, 0, 0, glow);
      for (const sx of [-1, 1])
        add(g('fangprong', () => new THREE.BoxGeometry(0.06, 0.06, 0.15)), col2, sx * 0.1, 0.042, -0.15, 0, 0, 0, glow ? 0.4 : 0);
      break;
    case 'hammer':
      add(g('hammer', () => new THREE.CylinderGeometry(0.075, 0.075, 0.3, 14).rotateZ(Math.PI / 2)), col, 0, 0.075, -0.08);
      for (const sx of [-1, 1])
        add(g('hammerband', () => new THREE.CylinderGeometry(0.078, 0.078, 0.03, 14).rotateZ(Math.PI / 2)), col2, sx * 0.11, 0.075, -0.08);
      break;
    case 'hockey': {
      // Flat, upturned blade with a band of tape.
      add(g('hockey', () => new THREE.BoxGeometry(0.32, 0.075, 0.03)), col, 0.06, 0.04, -0.05, 0, 0, 0.12);
      add(g('hockeytape', () => new THREE.BoxGeometry(0.12, 0.078, 0.034)), col2, 0.1, 0.045, -0.05, 0, 0, 0.12);
      break;
    }
    case 'flamingo': {
      // The bird's head is the club head: a pink head with a hooked, black-tipped beak.
      const head = add(g('flamhead', () => new THREE.SphereGeometry(0.06, 14, 10)), col, -0.04, 0.06, -0.07);
      head.scale.set(1.5, 0.95, 0.95);
      add(g('flambeak', () => new THREE.ConeGeometry(0.03, 0.12, 10).rotateZ(-Math.PI / 2)), '#fff3e0', 0.1, 0.05, -0.07);
      add(g('flamtip', () => new THREE.ConeGeometry(0.018, 0.045, 8).rotateZ(-Math.PI / 2)), '#212121', 0.175, 0.045, -0.07);
      for (const sx of [-1, 1]) add(g('flameye', () => new THREE.SphereGeometry(0.012, 8, 6)), '#212121', -0.01, 0.085, -0.07 + sx * 0.05);
      break;
    }
    case 'cane':
      // The crook of the cane lies on the green as the head.
      for (let k = 0; k < 6; k++)
        add(
          g('canehead', () => new THREE.CylinderGeometry(0.03, 0.03, 0.05, 10).rotateZ(Math.PI / 2)),
          k % 2 ? col2 : '#ffffff',
          -0.125 + k * 0.05,
          0.04,
          -0.07,
        );
      add(g('canetip', () => new THREE.SphereGeometry(0.03, 10, 8)), col2, 0.15, 0.04, -0.07);
      break;
    case 'star': {
      add(g('starstrike', () => new THREE.BoxGeometry(0.2, 0.05, 0.05)), col, 0, 0.035, -0.06);
      const star = add(
        g('star', () => {
          const sh = new THREE.Shape();
          for (let k = 0; k < 10; k++) {
            const a = Math.PI / 2 + (k * Math.PI) / 5;
            const r = k % 2 ? 0.045 : 0.1;
            if (k) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
            else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          return new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false }).translate(0, 0, -0.015);
        }),
        col2,
        0,
        0.16,
        -0.08,
        0,
        0,
        0,
        glow,
      );
      star.rotation.x = -0.25;
      break;
    }
    case 'rocket':
      add(g('rocketbody', () => new THREE.CylinderGeometry(0.045, 0.045, 0.2, 14).rotateZ(Math.PI / 2)), col, -0.02, 0.05, -0.07);
      add(g('rocketnose', () => new THREE.ConeGeometry(0.045, 0.09, 14).rotateZ(-Math.PI / 2)), col2, 0.125, 0.05, -0.07);
      for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
        const fin = add(g('rocketfin', () => new THREE.BoxGeometry(0.06, 0.05, 0.008)), col2, -0.11, 0.05, -0.07);
        fin.rotation.x = a;
        fin.translateY(0.045);
      }
      add(g('rocketwin', () => new THREE.CylinderGeometry(0.018, 0.018, 0.01, 12).rotateX(Math.PI / 2)), '#4fc3f7', 0.03, 0.05, -0.024, 0, 0, 0, 0.3);
      break;
    default:
      add(g('head', () => new THREE.BoxGeometry(0.28, 0.09, 0.08)), col, 0, 0.05, -0.08, 0, 0, 0, glow);
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
  private readonly sticker: THREE.Mesh | null;
  private squash = 0;
  private squashDir = new THREE.Vector3(0, 1, 0);
  private putterSwing = 0;
  private hopT = -1;
  /** Case-skin effects (v1.11). */
  private mythic: MythicFx | null = null;
  private glow: THREE.Sprite | null = null;
  private fxT = 0;
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
    const fx = skin.fx;
    // Mythic shells drift their pattern, so they get their own copy of the (shared) texture.
    let map = tex;
    if (fx === 'mythic' && tex) {
      map = tex.clone();
      map.wrapS = THREE.RepeatWrapping;
      map.needsUpdate = true;
    }
    // Glossy clear-coated ball with a dimple bump map; case skins add metal, glow or mythic.
    this.bodyMat = new THREE.MeshPhysicalMaterial({
      color: tex ? 0xffffff : skin.color,
      map,
      roughness: fx === 'metal' ? 0.22 : fx === 'mythic' ? 0.18 : 0.42,
      metalness: fx === 'metal' ? 0.85 : fx === 'mythic' ? 0.25 : 0,
      clearcoat: fx ? 1 : 0.8,
      clearcoatRoughness: 0.18,
      iridescence: fx === 'mythic' ? 1 : 0,
      iridescenceIOR: 1.7,
      emissive: fx === 'glow' ? new THREE.Color(skin.color2 ?? skin.color) : new THREE.Color(0x000000),
      // Glowing and mythic skins light up along their own pattern (dark parts stay dark).
      emissiveMap: fx === 'glow' ? tex : fx === 'mythic' ? map : null,
      emissiveIntensity: fx === 'glow' ? 0.6 : 0,
      bumpMap: dimpleTexture(),
      bumpScale: 0.6,
      transparent: ghost,
      opacity: ghost ? 0.5 : 1,
    });
    this.body = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 24), this.bodyMat);
    this.body.castShadow = !ghost;
    this.root.add(this.body);
    // v1.12 sticker: a decal on the ball's side that rolls with it.
    this.sticker = buildSticker(loadout.sticker ?? 'sticker.none', ghost);
    if (this.sticker) this.body.add(this.sticker);
    if (fx === 'mythic') {
      this.mythic = new MythicFx(skin.color, skin.color2 ?? '#ffffff', this.bodyMat, map, ghost);
      this.root.add(this.mythic.group);
    } else if (fx === 'glow') {
      this.glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture(),
          color: skin.color2 ?? skin.color,
          transparent: true,
          opacity: ghost ? 0.2 : 0.45,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      this.glow.scale.setScalar(R * 4);
      this.root.add(this.glow);
    }
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

  /** Seconds left of the pop-in after a reset (0 = none). */
  private popT = 0;

  /** The ball was reset after a hazard: it pops back in where it's placed. */
  respawn(): void {
    this.popT = 0.95;
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
    // Pop-in after a hazard reset: hidden while the camera lingers on the splash, then it springs
    // up to size with a little overshoot.
    if (this.popT > 0) {
      this.popT = Math.max(0, this.popT - dt);
      const u = Math.min(1, Math.max(0, (0.4 - this.popT) / 0.4));
      const k = reducedMotion ? (u > 0 ? 1 : 0) : 1 + 2.70158 * Math.pow(u - 1, 3) + 1.70158 * Math.pow(u - 1, 2);
      this.root.scale.setScalar(Math.max(0.001, k));
    } else if (this.root.scale.x !== 1) this.root.scale.setScalar(1);

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
    if (this.mythic) {
      // The stardust wake lives in world space, beside the trail.
      const parent = this.trail.mesh.parent ?? this.root.parent;
      if (parent && this.mythic.wake.parent !== parent) parent.add(this.mythic.wake);
      this.mythic.update(reducedMotion ? dt * 0.3 : dt, this.root.position, speed, this.root.visible && !holed);
    }
    if (this.glow) {
      this.fxT += dt;
      (this.glow.material as THREE.SpriteMaterial).opacity = (this.ghost ? 0.2 : 0.38) + 0.12 * Math.sin(this.fxT * 2.4);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.body.geometry.dispose();
    this.bodyMat.dispose();
    this.trail.dispose();
    this.mythic?.dispose();
    (this.glow?.material as THREE.Material | undefined)?.dispose();
    if (this.sticker) {
      this.sticker.geometry.dispose();
      (this.sticker.material as THREE.Material).dispose();
    }
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
  /** v1.11 legendary trails: wider, additive, shimmering between their two colours. */
  private readonly glowing: boolean;
  private readonly enabled: boolean;
  private t = 0;

  constructor(id: string, ghost: boolean) {
    const c = COSMETIC_BY_ID.get(id);
    this.enabled = !!c && id !== 'trail.none';
    this.c1 = new THREE.Color(c?.color ?? '#ffffff');
    this.c2 = new THREE.Color(c?.color2 ?? c?.color ?? '#ffffff');
    this.rainbow = c?.pattern === 'rainbow';
    this.glowing = c?.fx === 'glow' || c?.fx === 'mythic';
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
      blending: this.glowing ? THREE.AdditiveBlending : THREE.NormalBlending,
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
      const w = (this.glowing ? 0.19 : 0.13) * (1 - k);
      pos.setXYZ(i * 2, a.x - dz * w, a.y, a.z + dx * w);
      pos.setXYZ(i * 2 + 1, a.x + dz * w, a.y, a.z - dx * w);
      if (this.rainbow) tmp.setHSL((k * 1.5 + this.t * 0.5) % 1, 0.9, 0.6);
      else if (this.glowing) tmp.copy(this.c1).lerp(this.c2, 0.5 + 0.5 * Math.sin(this.t * 5 - k * 9));
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
