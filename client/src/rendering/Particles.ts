import * as THREE from 'three';

interface BurstOpts {
  count: number;
  colors: string[];
  speed?: number;
  spread?: number; // 0 = straight up cone, 1 = sphere
  up?: number;
  gravity?: number;
  life?: number;
  size?: number;
  drag?: number;
}

/**
 * One pooled GPU point cloud for all effects (dust, sparkles, confetti, splashes).
 * Each particle has position, velocity, colour, size and life; updated on the CPU (cheap at
 * this scale) and drawn in a single draw call.
 */
export class Particles {
  readonly points: THREE.Points;
  private readonly max = 2500;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private cursor = 0;
  private readonly geo: THREE.BufferGeometry;
  scale = 1;

  constructor() {
    this.pos = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 4);
    this.size = new Float32Array(this.max);
    this.life = new Float32Array(this.max);
    this.maxLife = new Float32Array(this.max);
    this.grav = new Float32Array(this.max);
    this.drag = new Float32Array(this.max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard;
        gl_FragColor = vec4(vC.rgb, vC.a * smoothstep(0.5, 0.3, r)); }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  burst(at: THREE.Vector3, o: BurstOpts): void {
    const n = Math.round(o.count * this.scale);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const a = Math.random() * Math.PI * 2;
      const spread = o.spread ?? 0.6;
      const elev = Math.PI / 2 - Math.random() * Math.PI * spread;
      const sp = (o.speed ?? 2) * (0.4 + Math.random() * 0.8);
      this.pos.set([at.x, at.y, at.z], k * 3);
      this.vel.set(
        [
          Math.cos(a) * Math.cos(elev) * sp,
          Math.sin(elev) * sp + (o.up ?? 0),
          Math.sin(a) * Math.cos(elev) * sp,
        ],
        k * 3,
      );
      c.set(o.colors[Math.floor(Math.random() * o.colors.length)]);
      this.col.set([c.r, c.g, c.b, 1], k * 4);
      this.size[k] = (o.size ?? 0.12) * (0.6 + Math.random() * 0.8);
      this.life[k] = this.maxLife[k] = (o.life ?? 0.8) * (0.7 + Math.random() * 0.6);
      this.grav[k] = o.gravity ?? -6;
      this.drag[k] = o.drag ?? 1.5;
    }
  }

  update(dt: number): void {
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      const i = k * 3;
      const d = Math.exp(-this.drag[k] * dt);
      this.vel[i] *= d;
      this.vel[i + 2] *= d;
      this.vel[i + 1] = this.vel[i + 1] * d + this.grav[k] * dt;
      this.pos[i] += this.vel[i] * dt;
      this.pos[i + 1] += this.vel[i + 1] * dt;
      this.pos[i + 2] += this.vel[i + 2] * dt;
      const t = Math.max(0, this.life[k] / this.maxLife[k]);
      this.col[k * 4 + 3] = Math.min(1, t * 2.5);
      if (this.life[k] <= 0) this.size[k] = 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.size.fill(0);
  }
}
