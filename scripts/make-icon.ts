/**
 * Procedurally renders the 1024x1024 app icon (no image tools needed) to build/icon.png.
 * electron-builder derives .icns/.ico from it; the iOS project uses it as the App Store icon.
 * Usage: npx tsx scripts/make-icon.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const S = 1024;
const px = new Float32Array(S * S * 4);

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Alpha-composite colour c with coverage a at pixel. */
function blend(x: number, y: number, c: RGB, a: number) {
  if (a <= 0) return;
  const i = (y * S + x) * 4;
  const da = px[i + 3];
  const oa = a + da * (1 - a);
  for (let k = 0; k < 3; k++) px[i + k] = (c[k] * a + px[i + k] * da * (1 - a)) / (oa || 1);
  px[i + 3] = oa;
}

function shape(sdf: (x: number, y: number) => number, color: (x: number, y: number) => RGB) {
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = sdf(x + 0.5, y + 0.5);
      const a = clamp(0.5 - d);
      if (a > 0) blend(x, y, color(x, y), a);
    }
}

const roundRect = (cx: number, cy: number, hw: number, hh: number, r: number) => (x: number, y: number) => {
  const qx = Math.abs(x - cx) - hw + r,
    qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const circle = (cx: number, cy: number, r: number) => (x: number, y: number) => Math.hypot(x - cx, y - cy) - r;

// Background: sky gradient into a rolling green hill (full-bleed square; platforms round it).
const sky1 = hex('#4aa8ff'),
  sky2 = hex('#bfe6ff'),
  g1 = hex('#7cd15a'),
  g2 = hex('#3f9a35');
shape(roundRect(S / 2, S / 2, S / 2, S / 2, 0), (_x, y) => mix(sky1, sky2, y / S));
const hill = (x: number) => S * 0.6 + Math.sin(x / S * Math.PI * 1.3 + 0.4) * 40;
shape((x, y) => hill(x) - y, (x, y) => {
  const base = mix(g1, g2, clamp((y - hill(x)) / (S * 0.4)));
  const checker = (Math.floor(x / 96) + Math.floor((y - hill(x) * 0.2) / 64)) % 2 === 0 ? 1 : 0.92;
  return [base[0] * checker, base[1] * checker, base[2] * checker];
});
// Cup shadow
shape((x, y) => Math.hypot((x - 640) / 1.0, (y - 770) * 2.6) - 70, () => hex('#1b3b17'));
// Flag pole + flag
shape(roundRect(668, 470, 10, 300, 8), (_x, y) => (Math.floor(y / 60) % 2 ? hex('#ffffff') : hex('#e53935')));
shape((x, y) => {
  // waving triangular flag
  const t = (x - 678) / 240;
  if (t < 0 || t > 1) return 10;
  const top = 190 + Math.sin(t * 3) * 14;
  const bottom = 360 - t * 85 + Math.sin(t * 3) * 14;
  return Math.max(top - y, y - bottom, -x + 678, x - (678 + 240 * (1 - (y - top) / (bottom - top) * 0.0)));
}, (x) => mix(hex('#ff4d4d'), hex('#d32f2f'), clamp((x - 678) / 240)));
// Ball shadow
shape((x, y) => Math.hypot((x - 420) / 1.0, (y - 860) * 3) - 190, () => [0.1, 0.25, 0.1]);
// Ball with soft shading and dimples
const BX = 420,
  BY = 640,
  BR = 230;
shape(circle(BX, BY, BR), (x, y) => {
  const nx = (x - BX) / BR,
    ny = (y - BY) / BR;
  const nz = Math.sqrt(clamp(1 - nx * nx - ny * ny));
  const light = clamp(0.35 + 0.65 * (nx * -0.45 + ny * -0.55 + nz * 0.7));
  // dimples: hex grid in projected sphere space
  const u = Math.atan2(nx, nz) * 6,
    v = Math.asin(clamp(ny, -1, 1)) * 6;
  const gu = u - Math.round(u),
    gv = v - Math.round(v + (Math.round(u) % 2) * 0.5) + (Math.round(u) % 2) * 0.5;
  const dimple = smooth(0.38, 0.18, Math.hypot(gu, gv)) * 0.1 * nz;
  const spec = Math.pow(clamp(nx * -0.4 + ny * -0.5 + nz * 0.77), 40) * 0.6;
  const c = 0.55 + 0.45 * light - dimple + spec;
  return [clamp(c * 0.98), clamp(c * 0.99), clamp(c)];
});
// Rim outline for readability at small sizes
shape((x, y) => Math.abs(circle(BX, BY, BR)(x, y)) - 3, () => hex('#9aa7b5'));

// Encode PNG (RGBA8, no filter).
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  for (let x = 0; x < S; x++)
    for (let k = 0; k < 4; k++) {
      const v = k === 3 ? 1 : px[(y * S + x) * 4 + k];
      raw[y * (S * 4 + 1) + 1 + x * 4 + k] = Math.round(clamp(v) * 255);
    }
}
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
