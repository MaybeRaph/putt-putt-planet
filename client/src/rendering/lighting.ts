import * as THREE from 'three';
import type { Theme } from '@ppp/shared';

/**
 * Golden-hour lighting (v1.8.2). Every world is lit by a low, warm sun with long shadows, cool
 * blue-violet fill in the shade, a warm haze towards the horizon and light shafts through the
 * trees. The course files keep their original daytime colours (other clients and the course
 * cards use them); `goldenTheme` restyles a theme for rendering only.
 *
 * The sun also drifts slowly across the sky while you play (`sunAt`), so shadows and light
 * shafts sweep gently over the course. Shadows are redrawn every frame anyway (balls and trees
 * move), so the moving sun costs nothing extra.
 */

type Kit = Theme['decorKit'];

export interface GoldenLook {
  skyTop: string;
  /** Mid sky, between the zenith and the horizon glow. */
  skyMid: string;
  skyBottom: string;
  fog: string;
  sun: string;
  /** Sun strength (replaces the theme's; a low sun lights the ground at a grazing angle). */
  sunIntensity: number;
  /** Fill light from the sky (hemisphere light's sky colour) and its strength. */
  ambient: string;
  fill: number;
  /** How much of the theme's ground colour the bounce light keeps (the rest is warm bounce). */
  bounce: string;
  /** Image-based lighting strength (sky reflections). */
  env: number;
  /** Sun height above the horizon and compass direction, in degrees. */
  elevation: number;
  azimuth: number;
  /** Light shafts / sunlit haze density (0 = none) and colour. */
  rays: number;
  rayColor: string;
}

export const GOLDEN: Record<Kit, GoldenLook> = {
  meadow: {
    skyTop: '#3e6fb8',
    skyMid: '#8cb2dc',
    skyBottom: '#ffd7a6',
    fog: '#efcfa8',
    sun: '#ffad62',
    sunIntensity: 4.6,
    ambient: '#9fb3e6',
    fill: 0.42,
    bounce: '#7d8a4c',
    env: 0.42,
    elevation: 19,
    azimuth: 34,
    rays: 1,
    rayColor: '#ffc887',
  },
  candy: {
    skyTop: '#a774d8',
    skyMid: '#f6a6d2',
    skyBottom: '#ffd6b0',
    fog: '#ffcfc4',
    sun: '#ffb27e',
    sunIntensity: 4.4,
    ambient: '#d6b4f0',
    fill: 0.5,
    bounce: '#e8a0c4',
    env: 0.48,
    elevation: 20,
    azimuth: 45,
    rays: 0.75,
    rayColor: '#ffc8a0',
  },
  frozen: {
    skyTop: '#4d72c4',
    skyMid: '#b9b4e2',
    skyBottom: '#ffd2b8',
    fog: '#e6cdd0',
    sun: '#ffb98a',
    sunIntensity: 3.8,
    ambient: '#a9bdf2',
    fill: 0.46,
    bounce: '#c8c4dc',
    env: 0.48,
    elevation: 16,
    azimuth: 56,
    rays: 0.8,
    rayColor: '#ffd0b0',
  },
  clockwork: {
    skyTop: '#9a5f7c',
    skyMid: '#ec9d74',
    skyBottom: '#ffd29a',
    fog: '#e9b88e',
    sun: '#ffa456',
    sunIntensity: 4.4,
    ambient: '#b7a0d0',
    fill: 0.42,
    bounce: '#6e5440',
    env: 0.42,
    elevation: 14,
    azimuth: 33,
    rays: 0.8,
    rayColor: '#ffb874',
  },
  // Space has no atmosphere: no golden hour, only a slightly lower star for longer shadows.
  space: {
    skyTop: '#05051a',
    skyMid: '#14103a',
    skyBottom: '#2a1a5e',
    fog: '#160f38',
    sun: '#d6dcff',
    sunIntensity: 2.8,
    ambient: '#a3a8ff',
    fill: 0.55,
    bounce: '#1a1838',
    env: 0.45,
    elevation: 34,
    azimuth: 34,
    rays: 0,
    rayColor: '#000000',
  },
};

/** The theme as it is rendered: golden-hour sky, fog and sun. Thick fog (an omen) keeps its grey. */
export function goldenTheme(theme: Theme): Theme {
  const g = GOLDEN[theme.decorKit];
  const dense = theme.fogFar < 40;
  return {
    ...theme,
    skyTop: g.skyTop,
    skyBottom: g.skyBottom,
    fog: dense ? theme.fog : g.fog,
    sun: g.sun,
    sunIntensity: g.sunIntensity,
    ambient: g.ambient,
  };
}

/** How far the sun drifts while you play: degrees of compass and height, over one cycle. */
const DRIFT_AZ = 16;
const DRIFT_EL = 4;
/** Seconds for one full back-and-forth drift. */
const DRIFT_PERIOD = 300;

/** Direction towards the sun at time `t` (seconds); `t = null` is the still, central position. */
export function sunAt(kit: Kit, t: number | null, out = new THREE.Vector3()): THREE.Vector3 {
  const g = GOLDEN[kit];
  const w = t === null ? 0 : (t / DRIFT_PERIOD) * Math.PI * 2;
  const az = THREE.MathUtils.degToRad(g.azimuth + Math.sin(w) * DRIFT_AZ);
  // Sinks a little as it swings one way: reads like the sun going down, then resets slowly.
  const el = THREE.MathUtils.degToRad(g.elevation + Math.sin(w + 1.2) * DRIFT_EL);
  return out.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
}

/**
 * The current direction towards the sun, shared by everything that draws its own sunlight
 * (water highlights). The renderer updates it every frame.
 */
export const liveSun = new THREE.Vector3(0.5, 0.35, 0.5).normalize();

const RE_DIRECT =
  'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

/**
 * Backlit translucency for thin foliage (grass blades, leaves): when the sun is behind a leaf
 * from the camera's point of view, light shining through it adds a warm glow. Patched into
 * three's light loop, so it respects shadows (a leaf in shade doesn't glow). `strength` is how
 * much of the sun's light passes through.
 */
export function addTranslucency(shader: { fragmentShader: string }, strength: number): void {
  const chunk = THREE.ShaderChunk.lights_fragment_begin.replaceAll(
    RE_DIRECT,
    `${RE_DIRECT}
    reflectedLight.directDiffuse += directLight.color * diffuseColor.rgb * ${strength.toFixed(3)}
      * pow(max(dot(-geometryViewDir, directLight.direction), 0.0), 3.0);`,
  );
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', chunk);
}
