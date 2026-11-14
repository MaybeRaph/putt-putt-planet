import * as THREE from 'three';

/**
 * Scenery that gets in the way dissolves (v1.9). Every instanced scenery mesh (trees, bushes,
 * rocks and props) fades out with a screen-door dither when it stands close to the camera, or
 * between the camera and the ball being followed, so the ball is never hidden in a canopy. It is
 * done in the vertex shader per instance (the decor is batched into a few InstancedMeshes), so it
 * costs nothing on the CPU and needs no transparency sorting.
 */
export const sceneryFade = {
  uFadeFocus: { value: new THREE.Vector3(0, -1e6, 0) },
  /** 0 = off (menus), 1 = on. */
  uFadeOn: { value: 0 },
  /** Anything whose base is closer than this to the camera (XZ, m) is fully faded. */
  uFadeNear: { value: 2.4 },
};

/** Point the fade at a camera target (the ball) for this frame. */
export function setSceneryFade(focus: THREE.Vector3 | null): void {
  if (!focus) {
    sceneryFade.uFadeOn.value = 0;
    return;
  }
  sceneryFade.uFadeFocus.value.copy(focus);
  sceneryFade.uFadeOn.value = 1;
}

const VERT_HEAD = /* glsl */ `
uniform vec3 uFadeFocus;
uniform float uFadeOn;
uniform float uFadeNear;
attribute vec3 aFadeBase;
varying float vFade;
`;
const VERT_BODY = /* glsl */ `
#ifdef USE_INSTANCING
  {
    // Where the whole prop stands (every part of a tree fades together).
    vec3 fp = (modelMatrix * vec4(aFadeBase, 1.0)).xyz;
    vec2 cp = cameraPosition.xz;
    vec2 ab = uFadeFocus.xz - cp;
    float tt = clamp(dot(fp.xz - cp, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
    float ds = distance(fp.xz, cp + ab * tt);
    float nearF = 1.0 - smoothstep(uFadeNear, uFadeNear + 1.6, distance(fp.xz, cp));
    // Between the camera and the ball (not behind the ball, nor below the sight line).
    float lineF = (1.0 - smoothstep(1.3, 2.6, ds)) * step(0.04, tt) * (1.0 - smoothstep(0.85, 0.97, tt));
    vFade = uFadeOn * max(nearF, lineF) * 0.92;
  }
#else
  vFade = 0.0;
#endif
`;
const FRAG_HEAD = /* glsl */ `
varying float vFade;
float sceneryBayer(vec2 p) {
  int i = int(mod(p.x, 4.0)) + int(mod(p.y, 4.0)) * 4;
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[i] + 0.5) / 16.0;
}
`;
const FRAG_BODY = /* glsl */ `
  if (vFade > 0.01 && sceneryBayer(gl_FragCoord.xy) < vFade) discard;
`;

/** Per-instance base positions for a batch of scenery (the attribute the fade reads). */
export function fadeBaseAttribute(bases: THREE.Vector3[]): THREE.InstancedBufferAttribute {
  const a = new Float32Array(bases.length * 3);
  bases.forEach((b, i) => a.set([b.x, b.y, b.z], i * 3));
  return new THREE.InstancedBufferAttribute(a, 3);
}

/** Give a scenery material the fade (once; chains any shader tweak it already has). */
export function enableSceneryFade(mat: THREE.Material): void {
  if (mat.userData.sceneryFade) return;
  mat.userData.sceneryFade = true;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  const prevSrc = prev.toString();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, sceneryFade);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAG_BODY}`);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|${prevSrc.length}|fade`;
}
