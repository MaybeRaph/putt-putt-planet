import * as THREE from 'three';
import type { Theme } from '@ppp/shared';

/**
 * Atmosphere motes that drift through the air around the camera: pollen and fireflies on the
 * meadow, sugar sparkles on candy, snowfall on the frozen world, embers in the clockwork and
 * stardust in space. One draw call; motes wrap round a box that follows the camera.
 */
interface Look {
  color: string;
  color2: string;
  size: number;
  /** Fall speed (m/s, negative rises). */
  fall: number;
  sway: number;
  additive: boolean;
  twinkle: number;
}

const LOOKS: Record<Theme['decorKit'], Look> = {
  meadow: {
    color: '#fff3b0',
    color2: '#d8ff9a',
    size: 0.07,
    fall: -0.05,
    sway: 0.35,
    additive: true,
    twinkle: 1,
  },
  candy: {
    color: '#ffd1ec',
    color2: '#fff6a8',
    size: 0.06,
    fall: 0.08,
    sway: 0.25,
    additive: true,
    twinkle: 1,
  },
  frozen: {
    color: '#ffffff',
    color2: '#dff0ff',
    size: 0.075,
    fall: 0.55,
    sway: 0.4,
    additive: false,
    twinkle: 0,
  },
  clockwork: {
    color: '#ffb066',
    color2: '#ffd9a0',
    size: 0.055,
    fall: -0.35,
    sway: 0.3,
    additive: true,
    twinkle: 0.6,
  },
  space: {
    color: '#c9b8ff',
    color2: '#9ce8ff',
    size: 0.05,
    fall: 0.02,
    sway: 0.15,
    additive: true,
    twinkle: 1,
  },
};

const BOX = new THREE.Vector3(36, 14, 36);

export class Ambience {
  readonly points: THREE.Points;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private count = 0;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uBox: { value: BOX.clone() },
        uSize: { value: 0.07 },
        uFall: { value: 0 },
        uSway: { value: 0.3 },
        uTwinkle: { value: 1 },
        uColor: { value: new THREE.Color() },
        uColor2: { value: new THREE.Color() },
        uScale: { value: 600 },
        fogColor: { value: new THREE.Color() },
        fogNear: { value: 1 },
        fogFar: { value: 1000 },
      },
      vertexShader: `
        attribute vec4 seed;
        uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform float uSize; uniform float uFall;
        uniform float uSway; uniform float uScale;
        varying float vMix; varying float vTw; varying float vFogDepth; varying float vNear;
        void main(){
          vec3 p = seed.xyz * uBox;
          p.y -= uFall * uTime * (0.7 + seed.w * 0.6);
          p.x += sin(uTime * 0.6 + seed.w * 31.0) * uSway;
          p.z += cos(uTime * 0.5 + seed.w * 17.0) * uSway;
          // Wrap into a box centred on the camera.
          vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
          vec3 w = uCam + rel;
          vec4 mv = viewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          // Fade near the box edges so the wrap never pops.
          vec3 e = abs(rel) / (uBox * 0.5);
          float edge = 1.0 - smoothstep(0.75, 1.0, max(max(e.x, e.y), e.z));
          gl_PointSize = min(uSize * uScale / max(-mv.z, 0.5) * edge * (0.6 + seed.w * 0.8), uScale * 0.012);
          vNear = smoothstep(1.2, 3.5, -mv.z);
          vMix = fract(seed.w * 7.13);
          vTw = 0.55 + 0.45 * sin(uTime * (1.5 + seed.w * 2.5) + seed.w * 40.0);
          vFogDepth = -mv.z;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform vec3 uColor2; uniform float uTwinkle;
        uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;
        varying float vMix; varying float vTw; varying float vFogDepth; varying float vNear;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(d));
          float tw = mix(1.0, vTw, uTwinkle);
          vec3 c = mix(uColor, uColor2, vMix);
          float fog = smoothstep(fogNear, fogFar, vFogDepth);
          gl_FragColor = vec4(c * (1.0 + tw * 0.6), a * tw * (1.0 - fog) * vNear * 0.9);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.visible = false;
  }

  private base = 0;
  private kit: Theme['decorKit'] = 'meadow';

  /** Number of motes for this quality (0 hides them); snowfall gets extra. */
  setCount(base: number): void {
    this.base = base;
    const n = Math.round(base * (this.kit === 'frozen' ? 1.8 : 1));
    if (n === this.count) return;
    this.count = n;
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) seeds[i] = Math.random();
    this.geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
    // Points need a position attribute for three's bookkeeping (bounds are skipped: no culling).
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geo.setDrawRange(0, n);
    this.points.visible = n > 0;
  }

  applyTheme(theme: Theme): void {
    const L = LOOKS[theme.decorKit];
    this.kit = theme.decorKit;
    this.setCount(this.base);
    const u = this.mat.uniforms;
    u.uColor.value.set(L.color);
    u.uColor2.value.set(L.color2);
    u.uSize.value = L.size;
    u.uFall.value = L.fall;
    u.uSway.value = L.sway;
    u.uTwinkle.value = L.twinkle;
    this.mat.blending = L.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.mat.needsUpdate = true;
  }

  update(time: number, camera: THREE.PerspectiveCamera, fog: THREE.Fog, viewportH: number): void {
    if (!this.points.visible) return;
    const u = this.mat.uniforms;
    u.uTime.value = time;
    u.uCam.value.copy(camera.position);
    u.uScale.value = viewportH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    u.fogColor.value.copy(fog.color);
    u.fogNear.value = fog.near;
    u.fogFar.value = fog.far;
  }
}
