import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import type { Theme } from '@ppp/shared';
import { Ambience } from './Ambience';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

interface Tier {
  /** Max device pixel ratio. */
  dpr: number;
  /** Shadow map size (0 = no shadows). */
  shadow: number;
  /** Softening of shadow edges (texels). */
  shadowRadius: number;
  /** MSAA samples on the scene render target. */
  samples: number;
  /** Ambient occlusion resolution scale (0 = off). */
  ao: number;
  bloom: boolean;
  grade: boolean;
  /** Miniature tilt-shift blur at the top and bottom of the screen. */
  tilt: boolean;
  /** Atmosphere motes drifting around the camera. */
  motes: number;
}

/**
 * Quality tiers. Every tier renders through one MSAA scene target (the canvas itself has no
 * MSAA backbuffer, which would be wasted memory under post-processing). High keeps the look
 * at a much smaller memory footprint than before (1.5x pixel ratio, half-res AO, 2048 shadows);
 * Ultra spends it all.
 */
export const TIERS: Record<Quality, Tier> = {
  low: {
    dpr: 1,
    shadow: 0,
    shadowRadius: 1,
    samples: 2,
    ao: 0,
    bloom: false,
    grade: false,
    tilt: false,
    motes: 0,
  },
  medium: {
    dpr: 1.5,
    shadow: 2048,
    shadowRadius: 1,
    samples: 2,
    ao: 0,
    bloom: false,
    grade: true,
    tilt: false,
    motes: 0,
  },
  high: {
    dpr: 1.5,
    shadow: 2048,
    shadowRadius: 2,
    samples: 4,
    ao: 0.5,
    bloom: true,
    grade: true,
    tilt: false,
    motes: 260,
  },
  ultra: {
    dpr: 2,
    shadow: 4096,
    shadowRadius: 3,
    samples: 4,
    ao: 1,
    bloom: true,
    grade: true,
    tilt: true,
    motes: 700,
  },
};

/** Tilt-shift: blur grows away from a horizontal focus band (a poisson disc, one pass). */
const TiltShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uRadius: { value: 3 },
    uFocus: { value: 0.47 },
    uBand: { value: 0.2 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uRadius; uniform float uFocus; uniform float uBand; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float k = smoothstep(uBand, uBand + 0.38, abs(vUv.y - uFocus));
      if (k < 0.02) { gl_FragColor = c; return; }
      vec4 acc = c; float n = 1.0;
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 2.39996;
        float r = sqrt((float(i) + 0.5) / 12.0);
        acc += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * r * k * uRadius / uRes);
        n += 1.0;
      }
      gl_FragColor = acc / n;
    }`,
};

/** Colour grade + vignette, applied in linear space before tone mapping (OutputPass). */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.28 },
    uSaturation: { value: 1.22 },
    uContrast: { value: 1.08 },
    uWarm: { value: new THREE.Vector3(1.02, 1.0, 0.97) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVignette; uniform float uSaturation; uniform float uContrast; uniform vec3 uWarm; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSaturation);
      c.rgb = max(vec3(0.0), (c.rgb - 0.18) * uContrast + 0.18);
      c.rgb *= uWarm;
      float v = smoothstep(0.9, 0.25, length(vUv - 0.5) * 1.3);
      c.rgb *= mix(1.0 - uVignette, 1.0, v);
      gl_FragColor = c;
    }`,
};

/** Gradient sky with sun glow and soft procedural clouds. */
const SKY_VERT = `varying vec3 vP; void main(){ vP = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;
const SKY_FRAG = `
uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uClouds; uniform float uTime; uniform vec3 uCloudColor;
varying vec3 vP;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vP);
  float h = d.y;
  vec3 col = mix(uBottom, uTop, smoothstep(-0.02, 0.55, h));
  col = mix(col, uBottom * 1.06, smoothstep(0.12, 0.0, abs(h)) * 0.6); // bright horizon band
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 600.0) * 4.0 + pow(s, 24.0) * 0.25 + pow(s, 4.0) * 0.08);
  if (h > 0.0 && uClouds > 0.0) {
    vec2 uv = d.xz / (h + 0.18) * 1.1 + vec2(uTime * 0.004, uTime * 0.0015);
    float c = fbm(uv * 1.4);
    float cov = smoothstep(0.52 - uClouds * 0.12, 0.85, c) * smoothstep(0.0, 0.18, h);
    float shade = 0.82 + 0.18 * smoothstep(0.4, 0.9, fbm(uv * 1.4 + 0.15));
    vec3 cc = uCloudColor * shade + uSunColor * pow(s, 6.0) * 0.25;
    col = mix(col, cc, cov * 0.9);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Owns the WebGL renderer, scene, camera, lights, sky, environment lighting and post-processing. */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private readonly sky: THREE.Mesh;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly stars: THREE.Points;
  private readonly pmrem: THREE.PMREMGenerator;
  private envTex: THREE.Texture | null = null;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private gtao: GTAOPass | null = null;
  private tilt: ShaderPass | null = null;
  private readonly ambience = new Ambience();
  private time = 0;
  quality: Quality = 'high';
  contextLost = false;
  private lastTheme: Theme | null = null;

  constructor(container: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.gl.domElement);
    this.gl.domElement.id = 'game-canvas';
    // Mobile GPUs can drop the context under memory pressure: allow WebGL to restore it, then
    // rebuild the post stack and sky lighting (three.js re-uploads meshes/textures by itself).
    this.gl.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[render] WebGL context lost');
      this.contextLost = true;
    });
    this.gl.domElement.addEventListener('webglcontextrestored', () => {
      console.warn('[render] WebGL context restored');
      this.contextLost = false;
      this.setQuality(this.quality);
      if (this.lastTheme) this.applyTheme(this.lastTheme);
    });
    const glc = this.gl.getContext();
    const dbg = glc.getExtension('WEBGL_debug_renderer_info');
    console.info(
      `[render] ${dbg ? glc.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'GPU'} | maxTex ${glc.getParameter(glc.MAX_TEXTURE_SIZE)} | dpr ${devicePixelRatio} | ${innerWidth}x${innerHeight}`,
    );
    this.pmrem = new THREE.PMREMGenerator(this.gl);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 600);
    this.scene.fog = new THREE.Fog(0xcfe9ff, 40, 200);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x88aa77, 0.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.scene.add(this.sun, this.sun.target);

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color('#5fb4ff') },
        uBottom: { value: new THREE.Color('#e8f6ff') },
        uSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.35).normalize() },
        uSunColor: { value: new THREE.Color('#fff4dc') },
        uCloudColor: { value: new THREE.Color('#ffffff') },
        uClouds: { value: 1 },
        uTime: { value: 0 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24), this.skyMat);
    this.sky.renderOrder = -2;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // Starfield (space world only).
    const n = 2200;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1,
        a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * r * 380, Math.abs(u) * 380 - 30, Math.sin(a) * r * 380], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 1.6,
        sizeAttenuation: false,
        fog: false,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.stars.visible = false;
    this.stars.renderOrder = -1;
    this.scene.add(this.stars);
    this.scene.add(this.ambience.points);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality): void {
    if (!(q in TIERS)) q = 'high';
    this.quality = q;
    const T = TIERS[q];
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, T.dpr));
    this.gl.shadowMap.enabled = T.shadow > 0;
    if (T.shadow) {
      this.sun.shadow.mapSize.set(T.shadow, T.shadow);
      this.sun.shadow.radius = T.shadowRadius;
    }
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.composer?.passes.forEach((p) => p.dispose());
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    this.gtao = null;
    this.tilt = null;
    const size = this.gl.getDrawingBufferSize(new THREE.Vector2());
    // Only the buffer the scene is drawn into needs MSAA (RenderPass draws into readBuffer =
    // renderTarget2); the ping-pong partner stays single-sampled.
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.gl, rt);
    this.composer.renderTarget2.samples = T.samples;
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (T.ao) {
      const gtao = new GTAOPass(this.scene, this.camera, size.x * T.ao, size.y * T.ao);
      gtao.updateGtaoMaterial({
        radius: 0.9,
        distanceExponent: 1.4,
        thickness: 1.2,
        scale: 1.1,
        samples: q === 'ultra' ? 16 : 10,
      });
      gtao.blendIntensity = 0.85;
      if (T.ao < 1) {
        const full = gtao.setSize.bind(gtao);
        gtao.setSize = (w: number, h: number) => full(Math.round(w * T.ao), Math.round(h * T.ao));
      }
      this.gtao = gtao;
      this.composer.addPass(gtao);
    }
    if (T.bloom) {
      // Subtle: low strength and a threshold above 1, so only emissive bits (cups, coins, pads)
      // glow and large pale lit surfaces (ice, snow, sky) never wash out.
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.12, 0.3, 1.2);
      this.composer.addPass(this.bloom);
    }
    if (T.tilt) {
      this.tilt = new ShaderPass(TiltShader);
      this.composer.addPass(this.tilt);
    }
    if (T.grade) this.composer.addPass(new ShaderPass(GradeShader));
    this.composer.addPass(new OutputPass());
    this.ambience.setCount(T.motes);
    this.resize();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });
  }

  applyTheme(theme: Theme): void {
    this.lastTheme = theme;
    const u = this.skyMat.uniforms;
    u.uTop.value.set(theme.skyTop);
    u.uBottom.value.set(theme.skyBottom);
    u.uSunColor.value.set(theme.sun);
    const space = theme.decorKit === 'space';
    u.uClouds.value = space ? 0 : theme.decorKit === 'clockwork' ? 0.7 : 1;
    u.uCloudColor.value.set(
      theme.decorKit === 'clockwork' ? '#f2d8c2' : theme.decorKit === 'candy' ? '#fff0f8' : '#ffffff',
    );
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set(theme.fog);
    // Heavy fog (the Fog Bank omen): exact distances from the camera, and the sky itself turns
    // to fog so the course can't be read against it.
    const dense = theme.fogFar < 40;
    fog.near = dense ? theme.fogNear : theme.fogNear * 1.1;
    fog.far = dense ? theme.fogFar : theme.fogFar * 1.9;
    if (dense) {
      u.uTop.value.set(theme.fog);
      u.uBottom.value.set(theme.fog);
      u.uSunColor.value.set(theme.fog).multiplyScalar(0.15);
      u.uClouds.value = 0;
      this.stars.visible = false;
    }
    this.sun.color.set(theme.sun);
    this.sun.intensity = theme.sunIntensity * 1.35;
    this.hemi.color.set(theme.ambient);
    this.hemi.groundColor.set(theme.ground);
    this.stars.visible = space && !dense;
    this.scene.environmentIntensity = space ? 0.45 : 0.75;
    this.ambience.applyTheme(theme);
    this.buildEnvironment();
  }

  /** Image-based lighting from the current sky (soft ambient + sky reflections). */
  private buildEnvironment(): void {
    const envScene = new THREE.Scene();
    const skyMat = this.skyMat.clone();
    skyMat.uniforms = THREE.UniformsUtils.clone(this.skyMat.uniforms);
    skyMat.uniforms.uClouds.value = 0;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMat);
    envScene.add(mesh);
    const rt = this.pmrem.fromScene(envScene, 0.02);
    this.envTex?.dispose();
    this.envTex = rt.texture;
    this.scene.environment = this.envTex;
    mesh.geometry.dispose();
    skyMat.dispose();
  }

  /** Fit the sun's shadow camera around the current hole and point the sky's sun glow. */
  fitShadow(min: THREE.Vector3, max: THREE.Vector3): void {
    const c = min.clone().add(max).multiplyScalar(0.5);
    const r = min.distanceTo(max) / 2 + 3;
    const dir = new THREE.Vector3(0.55, 0.75, 0.38).normalize();
    this.sun.position.copy(c).addScaledVector(dir, r + 15);
    this.sun.target.position.copy(c);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = 1;
    cam.far = r * 2 + 40;
    cam.updateProjectionMatrix();
    this.skyMat.uniforms.uSunDir.value.copy(dir);
  }

  resize(): void {
    const w = window.innerWidth,
      h = window.innerHeight;
    this.gl.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 68 : 52;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
    const pr = this.gl.getPixelRatio();
    // Bloom works at half resolution: it is a blur anyway.
    this.bloom?.setSize((w * pr) / 2, (h * pr) / 2);
    this.tilt?.uniforms.uRes.value.set(w * pr, h * pr);
    if (this.tilt) this.tilt.uniforms.uRadius.value = 3.2 * pr;
  }

  render(dt = 1 / 60): void {
    if (this.contextLost) return;
    this.time += dt;
    this.skyMat.uniforms.uTime.value = this.time;
    this.sky.position.copy(this.camera.position);
    this.stars.position.copy(this.camera.position);
    this.ambience.update(
      this.time,
      this.camera,
      this.scene.fog as THREE.Fog,
      window.innerHeight * this.gl.getPixelRatio(),
    );
    if (this.composer) this.composer.render();
    else this.gl.render(this.scene, this.camera);
  }
}
