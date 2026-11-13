import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * Light shafts ("god rays") and sunlit haze, v1.8.2.
 *
 * For every pixel the view ray is marched from the camera to the first surface (or a fixed
 * distance for the sky) through a thin ground-hugging haze. Each step asks the sun's shadow map
 * whether that point of air is in sunlight; sunlit air scatters the sun's colour towards the
 * camera, most strongly when looking towards the sun. Gaps between trunks and leaves therefore
 * become visible beams, and the whole scene gains a warm atmospheric glow on the sun's side.
 *
 * Cost control: the march runs at half resolution (a quarter of the pixels) with a per-pixel
 * jittered start, a small blur hides the jitter, and the colour-grade pass adds the result to the
 * full-resolution image (no extra full-screen pass). It needs the scene's depth (a DepthTexture on the scene target) and the sun's shadow
 * map, so it is off when shadows are off.
 */
const MarchShader = {
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    precision highp sampler2DShadow;
    uniform sampler2D tDepth;
    uniform sampler2DShadow tShadow;
    uniform mat4 uShadowMatrix;
    uniform mat4 uProjInv;
    uniform mat4 uCamWorld;
    uniform vec3 uCamPos;
    uniform vec3 uSunDir;
    uniform float uSteps;
    uniform float uMaxDist;
    uniform float uGroundY;
    uniform float uHeight;
    uniform vec2 uRes;
    varying vec2 vUv;
    void main(){
      float depth = texture2D(tDepth, vUv).x;
      vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec4 vp = uProjInv * ndc; vp /= vp.w;
      vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
      vec3 ray = wp - uCamPos;
      float dist = length(ray);
      vec3 dir = ray / dist;
      if (depth >= 1.0) dist = uMaxDist;
      dist = min(dist, uMaxDist);
      // Interleaved gradient noise: a different start offset per pixel, cleaned up by the blur.
      vec2 px = vUv * uRes;
      float jitter = fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
      float stepLen = dist / uSteps;
      float lit = 0.0;
      float air = 0.0;
      for (int i = 0; i < 48; i++) {
        if (float(i) >= uSteps) break;
        vec3 p = uCamPos + dir * (float(i) + jitter) * stepLen;
        // Haze is thickest near the ground and thins out with height.
        float dens = exp(-max(p.y - uGroundY, 0.0) / uHeight);
        vec4 sc = uShadowMatrix * vec4(p, 1.0);
        float sun = 1.0;
        if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0)
          sun = texture(tShadow, vec3(sc.xy, sc.z - 0.002));
        lit += sun * dens;
        air += dens;
      }
      // Fraction of sunlit air along the ray, and how much air there was.
      float amount = lit * stepLen;
      float shade = (air - lit) * stepLen;
      gl_FragColor = vec4(amount, shade, 0.0, 1.0);
    }`,
};

const BlurShader = {
  vertexShader: MarchShader.vertexShader,
  fragmentShader: `
    uniform sampler2D tInput; uniform vec2 uDir; varying vec2 vUv;
    void main(){
      vec4 acc = texture2D(tInput, vUv) * 0.2270;
      acc += (texture2D(tInput, vUv + uDir * 1.3846) + texture2D(tInput, vUv - uDir * 1.3846)) * 0.3162;
      acc += (texture2D(tInput, vUv + uDir * 3.2308) + texture2D(tInput, vUv - uDir * 3.2308)) * 0.0703;
      gl_FragColor = acc;
    }`,
};

/**
 * Compositing is done inside the colour-grade pass (which reads and writes the full-resolution
 * image anyway), saving a full-screen copy: these are its extra uniforms and shader code.
 */
export function raysUniforms(): Record<string, THREE.IUniform> {
  return {
    tRays: { value: null },
    uRayProjInv: { value: new THREE.Matrix4() },
    uRayCamWorld: { value: new THREE.Matrix4() },
    uRayCamPos: { value: new THREE.Vector3() },
    uRaySun: { value: new THREE.Vector3(0, 1, 0) },
    uRayColor: { value: new THREE.Color('#ffc887') },
    uRayStrength: { value: 0 },
    uRayDensity: { value: 0.045 },
  };
}

export const RAYS_PARS = `
  uniform sampler2D tRays; uniform mat4 uRayProjInv; uniform mat4 uRayCamWorld; uniform vec3 uRayCamPos;
  uniform vec3 uRaySun; uniform vec3 uRayColor; uniform float uRayStrength; uniform float uRayDensity;
  vec3 applyRays(vec3 c, vec2 uv){
    if (uRayStrength <= 0.0) return c;
    vec2 r = texture2D(tRays, uv).xy;
    vec4 vp = uRayProjInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0); vp /= vp.w;
    vec3 dir = normalize((uRayCamWorld * vec4(vp.xyz, 1.0)).xyz - uRayCamPos);
    // Henyey-Greenstein forward scattering (bright towards the sun) plus a little all-round haze.
    float g = 0.62;
    float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * dot(dir, uRaySun), 1.5) / 12.566;
    float phase = hg * 5.0 + 0.12;
    // Sunlit air glows; air in shadow dims the image a touch, which deepens the beams.
    float glow = 1.0 - exp(-r.x * uRayDensity);
    float dim = 1.0 - exp(-r.y * uRayDensity * 0.6);
    return c * (1.0 - dim * 0.18 * uRayStrength) + uRayColor * glow * phase * uRayStrength;
  }`;

export interface GodRaysOptions {
  steps: number;
  /** Fraction of the full resolution the march runs at. */
  scale: number;
}

/**
 * Renders the light-shaft buffer and hands it to the grade pass (`target`, uniforms from
 * `raysUniforms`). It leaves the main image alone, so it needs no buffer swap.
 */
export class GodRaysPass extends Pass {
  private readonly march: THREE.ShaderMaterial;
  private readonly blur: THREE.ShaderMaterial;
  private readonly quad = new FullScreenQuad();
  private readonly rtA: THREE.WebGLRenderTarget;
  private readonly rtB: THREE.WebGLRenderTarget;
  /** Haze strength (per world; 0 = off). */
  strength = 1;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly sun: THREE.DirectionalLight,
    depth: THREE.DepthTexture,
    private readonly target: Record<string, THREE.IUniform>,
    private readonly opts: GodRaysOptions,
  ) {
    super();
    this.needsSwap = false;
    const rtOpts = { type: THREE.HalfFloatType, format: THREE.RGFormat, depthBuffer: false } as const;
    this.rtA = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.march = new THREE.ShaderMaterial({
      ...MarchShader,
      uniforms: {
        tDepth: { value: depth },
        tShadow: { value: null },
        uShadowMatrix: { value: new THREE.Matrix4() },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSteps: { value: opts.steps },
        uMaxDist: { value: 48 },
        uGroundY: { value: 0 },
        uHeight: { value: 5 },
        uRes: { value: new THREE.Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.blur = new THREE.ShaderMaterial({
      ...BlurShader,
      uniforms: { tInput: { value: null }, uDir: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    target.tRays.value = this.rtA.texture;
  }

  /** Per-world haze colour and strength, and the height of the ground the haze lies on. */
  configure(color: THREE.ColorRepresentation, strength: number, groundY: number): void {
    (this.target.uRayColor.value as THREE.Color).set(color);
    this.strength = strength;
    this.march.uniforms.uGroundY.value = groundY;
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width * this.opts.scale));
    const h = Math.max(1, Math.round(height * this.opts.scale));
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    this.march.uniforms.uRes.value.set(w, h);
  }

  override render(renderer: THREE.WebGLRenderer): void {
    const shadow = this.sun.shadow.map?.depthTexture;
    const t = this.target;
    if (!shadow || this.strength <= 0) {
      t.uRayStrength.value = 0;
      return;
    }
    const cam = this.camera;
    const mu = this.march.uniforms;
    mu.uProjInv.value.copy(cam.projectionMatrixInverse);
    mu.uCamWorld.value.copy(cam.matrixWorld);
    mu.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    mu.uSunDir.value.copy(this.sun.position).sub(this.sun.target.position).normalize();
    mu.tShadow.value = shadow;
    mu.uShadowMatrix.value.copy(this.sun.shadow.matrix);
    t.uRayProjInv.value.copy(mu.uProjInv.value);
    t.uRayCamWorld.value.copy(mu.uCamWorld.value);
    t.uRayCamPos.value.copy(mu.uCamPos.value);
    t.uRaySun.value.copy(mu.uSunDir.value);
    t.uRayStrength.value = this.strength;

    this.quad.material = this.march;
    renderer.setRenderTarget(this.rtA);
    this.quad.render(renderer);

    // Separable blur, two texels wide, hides the per-pixel jitter.
    this.quad.material = this.blur;
    this.blur.uniforms.tInput.value = this.rtA.texture;
    this.blur.uniforms.uDir.value.set(1 / this.rtA.width, 0);
    renderer.setRenderTarget(this.rtB);
    this.quad.render(renderer);
    this.blur.uniforms.tInput.value = this.rtB.texture;
    this.blur.uniforms.uDir.value.set(0, 1 / this.rtA.height);
    renderer.setRenderTarget(this.rtA);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.target.uRayStrength.value = 0;
    this.rtA.dispose();
    this.rtB.dispose();
    this.march.dispose();
    this.blur.dispose();
    this.quad.dispose();
  }
}
