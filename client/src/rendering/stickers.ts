import * as THREE from 'three';
import { COSMETIC_BY_ID, PHYSICS, type Cosmetic } from '@ppp/shared';

/**
 * v1.12 ball stickers: a die-cut decal drawn on a canvas (an emoji or a chunky word with a thick
 * border, like a real sticker) and wrapped onto a small patch of the ball, so it rolls with it.
 * Finishes: paper (matte, white border), holo (rainbow border and an iridescent sheen) and gold
 * foil (gold border, metallic). Everything is code-drawn; no image files.
 */

const SIZE = 256;
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const canvases = new Map<string, HTMLCanvasElement>();
const textures = new Map<string, THREE.CanvasTexture>();

const isWord = (glyph: string) => /^[A-Za-z0-9!?.]+$/.test(glyph);

/** Draw a sticker onto a fresh square canvas (transparent outside the die-cut). */
function draw(c: Cosmetic, cv: HTMLCanvasElement): void {
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, SIZE, SIZE);
  const glyph = c.glyph ?? '⭐';
  const finish = c.finish ?? 'paper';
  // 1. The art on its own layer.
  const art = document.createElement('canvas');
  art.width = art.height = SIZE;
  const a = art.getContext('2d')!;
  a.textAlign = 'center';
  a.textBaseline = 'middle';
  if (isWord(glyph)) {
    const px = glyph.length <= 2 ? 120 : glyph.length <= 3 ? 96 : glyph.length <= 4 ? 74 : 60;
    a.font = `${px}px "Lilita One", "Baloo 2", system-ui, sans-serif`;
    a.translate(SIZE / 2, SIZE / 2);
    a.rotate(-0.12);
    a.lineJoin = 'round';
    a.lineWidth = px * 0.16;
    a.strokeStyle = '#2a1f5c';
    a.strokeText(glyph, 0, 4);
    a.fillStyle = c.color;
    a.fillText(glyph, 0, 4);
  } else {
    a.font = `150px ${EMOJI_FONT}`;
    a.fillText(glyph, SIZE / 2, SIZE / 2 + 8);
  }
  // 2. The die-cut border: the art's silhouette, grown by stamping it round in a circle.
  const sil = document.createElement('canvas');
  sil.width = sil.height = SIZE;
  const s = sil.getContext('2d')!;
  s.drawImage(art, 0, 0);
  s.globalCompositeOperation = 'source-in';
  s.fillStyle = border(s, finish);
  s.fillRect(0, 0, SIZE, SIZE);
  const grow = 14;
  for (let k = 0; k < 24; k++) {
    const ang = (k / 24) * Math.PI * 2;
    ctx.drawImage(sil, Math.cos(ang) * grow, Math.sin(ang) * grow);
  }
  ctx.drawImage(sil, 0, 0);
  // A thin ink edge round the border reads well on any ball colour.
  ctx.globalCompositeOperation = 'destination-over';
  ctx.filter = 'drop-shadow(0 0 2px rgba(42,31,92,0.9))';
  ctx.drawImage(cv, 0, 0);
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  // 3. The art on top, then the finish.
  ctx.drawImage(art, 0, 0);
  if (finish === 'holo') {
    ctx.globalCompositeOperation = 'source-atop';
    const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    ['#ff5ec4', '#ffe45e', '#5effa0', '#5ec8ff', '#b05eff'].forEach((col, i, arr) =>
      g.addColorStop(i / (arr.length - 1), col),
    );
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  } else if (finish === 'gold') {
    ctx.globalCompositeOperation = 'source-atop';
    const g = ctx.createLinearGradient(0, 0, SIZE, SIZE * 0.6);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.55, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.globalCompositeOperation = 'source-over';
  }
}

function border(ctx: CanvasRenderingContext2D, finish: string): string | CanvasGradient {
  if (finish === 'gold') {
    const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    g.addColorStop(0, '#fff3b0');
    g.addColorStop(0.35, '#ffc400');
    g.addColorStop(0.65, '#c98a00');
    g.addColorStop(1, '#ffe27a');
    return g;
  }
  if (finish === 'holo') {
    const g = ctx.createLinearGradient(0, SIZE, SIZE, 0);
    ['#ffb3e6', '#fff2a8', '#b3ffd1', '#b3e6ff', '#d9b3ff'].forEach((col, i, arr) =>
      g.addColorStop(i / (arr.length - 1), col),
    );
    return g;
  }
  return '#ffffff';
}

/** The sticker art as a canvas (shared by the ball texture and UI thumbnails). */
export function stickerCanvas(id: string): HTMLCanvasElement | null {
  const c = COSMETIC_BY_ID.get(id);
  if (!c || c.slot !== 'sticker' || !c.glyph) return null;
  let cv = canvases.get(id);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  draw(c, cv);
  canvases.set(id, cv);
  // The word stickers use the display font: redraw once it has loaded.
  if (isWord(c.glyph) && typeof document !== 'undefined' && document.fonts?.load)
    void document.fonts.load('80px "Lilita One"').then(() => {
      draw(c, cv);
      const t = textures.get(id);
      if (t) t.needsUpdate = true;
    });
  return cv;
}

function stickerTexture(id: string): THREE.CanvasTexture | null {
  const cached = textures.get(id);
  if (cached) return cached;
  const cv = stickerCanvas(id);
  if (!cv) return null;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textures.set(id, t);
  return t;
}

/**
 * A sticker patch for a ball: a slice of a sphere just outside the ball's surface, facing the
 * ball's local +Z, with the sticker art mapped across it. Null for "no sticker".
 */
export function buildSticker(id: string, ghost: boolean): THREE.Mesh | null {
  const c = COSMETIC_BY_ID.get(id);
  const map = stickerTexture(id);
  if (!c || !map) return null;
  const R = PHYSICS.ballRadius;
  const span = 1.05; // radians of arc each way: about half the ball's width
  // Centred on phi = 0 at the equator (the ball's local -X), upright; turned to face +Z, the
  // side the menu and locker cameras look at.
  const geo = new THREE.SphereGeometry(R * 1.008, 24, 18, -span / 2, span, Math.PI / 2 - span / 2, span);
  geo.rotateY(Math.PI / 2);
  const finish = c.finish ?? 'paper';
  const mat = new THREE.MeshPhysicalMaterial({
    map,
    transparent: true,
    alphaTest: 0.05,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    roughness: finish === 'paper' ? 0.65 : 0.25,
    metalness: finish === 'gold' ? 0.75 : 0.05,
    clearcoat: finish === 'paper' ? 0.2 : 1,
    iridescence: finish === 'holo' ? 1 : 0,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [200, 900],
    opacity: ghost ? 0.5 : 1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sticker';
  mesh.renderOrder = 2;
  return mesh;
}
