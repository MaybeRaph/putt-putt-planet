import type { Theme } from '@ppp/shared';

/**
 * Painted sky dome. One full-screen-ish shader, no textures:
 *  - a three-stop gradient (zenith, mid sky, bright horizon band),
 *  - a soft sun disc with a wide warm halo,
 *  - big stylised cumulus: domain-warped fbm cut into puffy shapes, lit from the sun side with
 *    cool lavender undersides and bright rims (the classic cartoon battle-royale look),
 *  - high wispy streaks,
 *  - per-world extras: a pastel rainbow (candy), aurora ribbons (frozen), layered sunset clouds
 *    (clockwork), and nebulae, twinkling stars and a galaxy band (space).
 * Since v1.8.2 every world is drawn at golden hour: a low sun, warm horizon, clouds lit warm on
 * the sun's side and cool lavender opposite it.
 * `uDetail` trims the noise octaves on lower quality tiers.
 */

type Kit = Theme['decorKit'];

export interface SkyStyle {
  cloudLit: string;
  cloudShade: string;
  /** Cumulus coverage 0..1. */
  clouds: number;
  /** Cloud layer shape: 0 = puffy cumulus, 1 = long layered (sunset) bands. */
  layered: number;
  cirrus: number;
  /** Extra effect: 0 none, 1 rainbow, 2 aurora, 3 space. */
  extra: number;
  /** Sun halo strength. */
  halo: number;
}

/** Cloud styles per world, for the golden-hour light (sky colours and the sun: lighting.ts). */
export const SKY: Record<Kit, SkyStyle> = {
  meadow: {
    cloudLit: '#ffe4c2',
    cloudShade: '#8f90c2',
    clouds: 0.5,
    layered: 0.25,
    cirrus: 0.6,
    extra: 0,
    halo: 0.95,
  },
  candy: {
    cloudLit: '#ffe4cf',
    cloudShade: '#c486c9',
    clouds: 0.55,
    layered: 0.2,
    cirrus: 0.4,
    extra: 1,
    halo: 0.95,
  },
  frozen: {
    cloudLit: '#ffe6d6',
    cloudShade: '#9ca5d8',
    clouds: 0.35,
    layered: 0.4,
    cirrus: 0.8,
    extra: 2,
    halo: 0.85,
  },
  clockwork: {
    cloudLit: '#ffd39e',
    cloudShade: '#8a5076',
    clouds: 0.6,
    layered: 1,
    cirrus: 0.6,
    extra: 0,
    halo: 1.15,
  },
  space: {
    cloudLit: '#ff7ad9',
    cloudShade: '#3a1f8a',
    clouds: 0,
    layered: 0,
    cirrus: 0,
    extra: 3,
    halo: 0.15,
  },
};

export const SKY_VERT = `varying vec3 vP; void main(){ vP = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;

export const SKY_FRAG = `
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uHalo;
uniform vec3 uCloudLit; uniform vec3 uCloudShade;
uniform float uClouds; uniform float uLayered; uniform float uCirrus; uniform float uExtra;
uniform float uTime; uniform float uDetail;
varying vec3 vP;

float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 6; i++){
    if (float(i) >= uDetail) break;
    s += a * vn(p); n += a; p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5;
  }
  return s / n;
}

/** Cloud density at a sky-plane coordinate. */
float cloud(vec2 uv){
  vec2 w = vec2(fbm(uv * 0.7 + 3.1), fbm(uv * 0.7 - 5.7));
  vec2 q = uv + (w - 0.5) * 1.6;
  q.x *= mix(1.0, 0.32, uLayered);           // layered: long horizontal bands
  float base = fbm(q);
  float billow = 1.0 - abs(vn(q * 3.1) * 2.0 - 1.0);  // round lumpy edges
  return base + billow * 0.12;
}

void main(){
  vec3 d = normalize(vP);
  float h = d.y;
  // Gradient: horizon -> mid -> zenith, with a bright haze band right at the horizon.
  vec3 col = mix(uBottom, uMid, smoothstep(-0.02, 0.22, h));
  col = mix(col, uTop, smoothstep(0.18, 0.85, h));
  col = mix(col, uBottom * 1.04, smoothstep(0.08, 0.0, abs(h)) * 0.5);
  if (h < 0.0) col = mix(uBottom, uBottom * 0.92, smoothstep(0.0, -0.3, h));

  float s = max(dot(d, uSunDir), 0.0);
  // Low golden-hour sun: a soft-edged disc, a tight corona and a wide warm glow.
  float disc = smoothstep(0.99935, 0.99975, s);
  col += uSunColor * (disc * 7.0 + pow(s, 280.0) * 1.1 * uHalo + pow(s, 36.0) * 0.42 * uHalo + pow(s, 5.0) * 0.2 * uHalo);
  // Warm glow along the horizon on the sun's side, and a cooler, dimmer sky opposite it.
  float toward = dot(normalize(vec3(d.x, 0.0, d.z) + 1e-4), normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-4)) * 0.5 + 0.5;
  float sideSun = pow(toward, 3.0);
  col += uSunColor * sideSun * smoothstep(0.4, 0.0, abs(h)) * 0.26 * uHalo;
  col *= mix(0.9, 1.0, toward);
  // Belt of Venus: a soft pink band above the horizon on the side away from the sun.
  col += vec3(1.0, 0.55, 0.62) * uHalo * 0.09 * pow(1.0 - toward, 2.0) * exp(-pow((h - 0.07) / 0.08, 2.0));

  if (uExtra > 2.5) {
    // Space: nebula clouds, a galaxy band, and stars.
    vec2 np = vec2(atan(d.z, d.x) * 1.4, h * 3.2);
    float neb = fbm(np * 1.3 + 7.0);
    float neb2 = fbm(np * 2.1 - 3.0 + uTime * 0.002);
    vec3 nebCol = mix(uCloudShade, uCloudLit, smoothstep(0.45, 0.8, neb2));
    col += nebCol * smoothstep(0.42, 0.85, neb) * 0.55;
    float band = exp(-pow((d.y - d.x * 0.45 - 0.15) / 0.18, 2.0));
    col += vec3(0.75, 0.7, 1.0) * band * (0.18 + 0.25 * fbm(np * 4.0)) ;
    vec2 sp = d.xz / (abs(d.y) + 0.6) * 140.0 + d.y * 37.0;
    vec2 cell = floor(sp);
    float r = h21(cell);
    if (r > 0.965) {
      vec2 off = vec2(h21(cell + 3.1), h21(cell + 7.7)) - 0.5;
      float dd = length(fract(sp) - 0.5 - off * 0.6);
      float tw = 0.65 + 0.35 * sin(uTime * (1.0 + r * 3.0) + r * 60.0);
      vec3 sc = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.85, 0.7), h21(cell + 1.3));
      col += sc * smoothstep(0.16, 0.0, dd) * tw * (1.2 + band * 1.5);
    }
  } else if (h > -0.02) {
    vec2 uv = d.xz / (max(h, 0.0) + 0.14) * 0.95;
    vec2 drift = vec2(uTime * 0.006, uTime * 0.002);

    // High cirrus streaks.
    if (uCirrus > 0.0) {
      vec2 cp = uv * vec2(0.35, 1.6) + drift * 1.6;
      float ci = smoothstep(0.55, 0.85, fbm(cp + 11.0)) * smoothstep(0.02, 0.3, h);
      col = mix(col, uCloudLit, ci * 0.45 * uCirrus);
    }

    // Aurora ribbons (frozen): curtains that hang towards the horizon on one side of the sky.
    if (uExtra > 1.5) {
      float ax = atan(d.z, d.x);
      float wave = sin(ax * 3.0 + fbm(vec2(ax * 2.0, uTime * 0.05)) * 4.0 + uTime * 0.12) * 0.06;
      float band = exp(-pow((h - 0.32 - wave) / 0.07, 2.0)) * smoothstep(-0.2, 0.6, sin(ax * 2.0 + 1.0));
      float rays = 0.6 + 0.4 * sin(ax * 70.0 + fbm(vec2(ax * 9.0, uTime * 0.2)) * 6.0);
      vec3 ac = mix(vec3(0.3, 1.0, 0.75), vec3(0.6, 0.55, 1.0), smoothstep(0.25, 0.45, h));
      col += ac * band * rays * 0.35;
    }

    // Rainbow (candy): a soft pastel arc opposite the sun.
    if (uExtra > 0.5 && uExtra < 1.5) {
      vec3 anti = normalize(vec3(-uSunDir.x, -uSunDir.y * 0.2, -uSunDir.z));
      float ang = acos(clamp(dot(d, anti), -1.0, 1.0));
      float t = (ang - 0.62) / 0.11;
      if (t > 0.0 && t < 1.0) {
        vec3 rb = clamp(abs(fract(t * 0.85 + vec3(0.0, 0.33, 0.67)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
        rb = mix(rb, vec3(1.0), 0.45);
        col = mix(col, rb, sin(t * 3.14159) * 0.32 * smoothstep(0.0, 0.25, h));
      }
    }

    // Cumulus.
    if (uClouds > 0.0) {
      vec2 p = uv * 0.55 + drift;
      float c = cloud(p);
      float edge = 0.62 - uClouds * 0.2;
      float cov = smoothstep(edge, edge + 0.12, c);
      // Thin out overhead a touch and hold the clouds well above the horizon haze.
      cov *= smoothstep(-0.01, 0.12, h) * (0.75 + 0.25 * smoothstep(0.9, 0.3, h));
      if (cov > 0.001) {
        // Light: how much denser the cloud gets towards the sun (denser = in shadow).
        vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.09;
        float occl = cloud(p + toSun) - c;
        float lit = clamp(0.62 - occl * 4.5, 0.0, 1.0);
        // Undersides darker, tops brighter; a soft painted step between them.
        lit *= mix(0.75, 1.1, smoothstep(edge, edge + 0.35, c));
        lit = smoothstep(0.1, 0.9, lit);
        // Clouds on the sun's side catch warm gold light, with cool lavender undersides.
        // (Opposite the sun they catch the low light on their faces: a rosy pink.)
        vec3 litCol = uCloudLit * mix(vec3(1.02, 0.86, 0.9), vec3(1.06, 1.0, 0.92), toward);
        vec3 cc = mix(uCloudShade * mix(0.85, 1.05, toward), litCol, lit);
        // Silver lining where a thin edge faces the sun, and the sun glowing through thin cloud.
        float thin = 1.0 - smoothstep(edge, edge + 0.1, c);
        cc += uSunColor * (pow(s, 4.0) * thin * 0.7 + pow(s, 24.0) * 0.5);
        // Distant clouds melt into the horizon haze.
        cc = mix(cc, uBottom, smoothstep(0.18, 0.0, h) * 0.55);
        col = mix(col, cc, cov);
      }
    }
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
