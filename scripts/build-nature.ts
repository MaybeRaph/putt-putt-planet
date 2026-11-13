/**
 * Builds client/src/assets/nature.glb from Quaternius' Stylized Nature MegaKit (CC0).
 *
 *   npx tsx scripts/build-nature.ts <path to the unzipped kit>   (the folder holding glTF/ and Textures/)
 *
 * Download the free "Standard" pack from https://quaternius.com/packs/stylizednaturemegakit.html
 * (also on itch.io and OpenGameArt). Needs the dev dependencies @gltf-transform/*, sharp and meshoptimizer. The script:
 *  - picks the models the game uses and merges them into one file (one root node per model),
 *  - bakes stylised foliage shading into the leaves: soft "puffy" normals that point out of the
 *    canopy, and a vertex colour holding the height gradient (R) and canopy occlusion (G), which
 *    the game's foliage shader turns into per-world colours,
 *  - turns the leaf textures into white alpha masks (the colour comes from the world palette),
 *  - drops normal maps, shrinks textures to 256-512 px WebP, and quantises and meshopt-compresses
 *    the meshes (the client decodes them with three's MeshoptDecoder).
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Document, NodeIO, type Primitive, type Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, weld, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const MODELS = [
  'CommonTree_1',
  'CommonTree_2',
  'CommonTree_3',
  'CommonTree_4',
  'CommonTree_5',
  'Pine_1',
  'Pine_2',
  'Pine_3',
  'Pine_4',
  'Pine_5',
  'DeadTree_1',
  'DeadTree_3',
  'Bush_Common',
  'Bush_Common_Flowers',
  'Fern_1',
  'Plant_1_Big',
  'Plant_7_Big',
  'Clover_1',
  'Flower_3_Group',
  'Flower_4_Group',
  'Mushroom_Common',
  'Rock_Medium_1',
  'Rock_Medium_2',
  'Rock_Medium_3',
  'Pebble_Round_1',
  'Pebble_Round_3',
];

/** Leaf materials that get the baked canopy shading and become white masks. */
const CANOPY = /^Leaves_(NormalTree|Pine|TwistedTree)/;
/** Texture size per material name prefix (the longest match wins). */
const SIZES: [RegExp, number][] = [
  [/^Leaves_|^Leaf_/, 256],
  [/^Bark_/, 512],
  [/^Rocks/, 512],
  [/^Leaves$/, 512],
  [/^Flowers/, 256],
  [/^Mushrooms/, 256],
  [/^PathRocks/, 256],
];

const src = process.argv[2];
if (!src || !fs.existsSync(path.join(src, 'glTF'))) {
  console.error('usage: npx tsx scripts/build-nature.ts <unzipped Stylized Nature MegaKit folder>');
  process.exit(1);
}
const out = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'client',
  'src',
  'assets',
  'nature.glb',
);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const doc = new Document();
doc.createBuffer();
const scene = doc.createScene('nature');

for (const name of MODELS) {
  const part = await io.read(path.join(src, 'glTF', `${name}.gltf`));
  for (const m of part.getRoot().listMeshes()) for (const p of m.listPrimitives()) bake(p, name);
  const map = mergeDocuments(doc, part);
  // mergeDocuments adds the source scene; move its root nodes into ours under the model name.
  for (const s of part.getRoot().listScenes()) {
    const merged = map.get(s) as ReturnType<Document['createScene']>;
    for (const n of merged.listChildren()) {
      n.setName(name);
      scene.addChild(n);
    }
    merged.dispose();
  }
}

// Normal maps: the stylised look doesn't need them and they are the heaviest images.
for (const mat of doc.getRoot().listMaterials()) {
  const nt = mat.getNormalTexture();
  mat.setNormalTexture(null);
  if (nt && !nt.listParents().some((p) => p !== doc.getRoot())) nt.dispose();
  mat.setMetallicFactor(0);
  mat.setRoughnessFactor(0.9);
}

await unpartition()(doc);
await dedup()(doc);
await prune()(doc);
await weld()(doc);

// Textures: canopy leaves become white alpha masks; everything is resized and stored as WebP.
doc.createExtension(EXTTextureWebP).setRequired(true);
const done = new Set<Texture>();
for (const mat of doc.getRoot().listMaterials()) {
  const tex = mat.getBaseColorTexture();
  if (!tex || done.has(tex)) continue;
  done.add(tex);
  const name = mat.getName();
  const size = SIZES.find(([re]) => re.test(name))?.[1] ?? 256;
  let img = sharp(Buffer.from(tex.getImage()!)).ensureAlpha();
  if (CANOPY.test(name)) {
    const alpha = await img.clone().extractChannel('alpha').toBuffer();
    const { width, height } = await img.metadata();
    // sharp resizes before it joins channels, so build the white mask as its own image first.
    const mask = await sharp({
      create: { width: width!, height: height!, channels: 3, background: '#ffffff' },
    })
      .joinChannel(alpha)
      .png()
      .toBuffer();
    img = sharp(mask);
  }
  // Resize first, then bleed the leaf colours out under the transparent area: texture filtering
  // and mipmaps mix in the colour of see-through pixels, which otherwise darkens the cut edge.
  // `exact` stops the WebP encoder throwing that hidden colour away again.
  const raw = await img.resize(size, size, { fit: 'fill' }).raw().toBuffer();
  bleed(raw, size, size);
  const webp = await sharp(raw, { raw: { width: size, height: size, channels: 4 } })
    .webp({ quality: 88, alphaQuality: 90, exact: true })
    .toBuffer();
  tex.setImage(new Uint8Array(webp)).setMimeType('image/webp').setURI(`${name}.webp`);
}

await MeshoptEncoder.ready;
await meshopt({
  encoder: MeshoptEncoder,
  level: 'medium',
  quantizePosition: 14,
  quantizeNormal: 10,
  quantizeTexcoord: 12,
  quantizeColor: 8,
})(doc);
fs.mkdirSync(path.dirname(out), { recursive: true });
await io.write(out, doc);
// The warm desert rock paint, used for the big cliffs and boulders round the courses.
await sharp(path.join(src, 'Textures', 'Rocks_Desert_Diffuse.png'))
  .resize(512, 512)
  .webp({ quality: 86 })
  .toFile(path.join(path.dirname(out), 'rocks-cliff.webp'));
const tris = doc
  .getRoot()
  .listMeshes()
  .flatMap((m) => m.listPrimitives())
  .reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);
console.log(
  `wrote ${out}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB, ${MODELS.length} models, ${tris} triangles`,
);

/**
 * Edge padding: repeatedly give each transparent pixel the average colour of its opaque (or
 * already filled) neighbours, until the whole image has a colour. Alpha is left untouched.
 */
function bleed(px: Buffer, w: number, h: number): void {
  const filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) filled[i] = px[i * 4 + 3] > 8 ? 1 : 0;
  for (let pass = 0; pass < w; pass++) {
    const next = filled.slice();
    let changed = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (filled[i]) continue;
        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx,
              yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (!filled[j]) continue;
            r += px[j * 4];
            g += px[j * 4 + 1];
            b += px[j * 4 + 2];
            n++;
          }
        if (!n) continue;
        px[i * 4] = r / n;
        px[i * 4 + 1] = g / n;
        px[i * 4 + 2] = b / n;
        next[i] = 1;
        changed++;
      }
    filled.set(next);
    if (!changed) break;
  }
}

/**
 * Canopy leaves: normals blended towards the direction out of the canopy (spherical for round
 * trees and bushes, a cone round the trunk for pines), and COLOR_0 = (height 0..1, openness 0..1).
 * Other foliage (ferns, flowers) only gets its normals tipped upwards so back faces aren't black.
 */
function bake(p: Primitive, model: string): void {
  const mat = p.getMaterial()?.getName() ?? '';
  const isLeaf = /^Leaves|^Leaf_|^Grass|^Flowers/.test(mat);
  if (!isLeaf) return;
  const pos = p.getAttribute('POSITION')!;
  const nrm = p.getAttribute('NORMAL')!;
  const n = pos.getCount();
  const v: number[] = [],
    o: number[] = [];
  if (!CANOPY.test(mat)) {
    for (let i = 0; i < n; i++) {
      nrm.getElement(i, o);
      const k = Math.hypot(o[0], o[1] + 1.4, o[2]) || 1;
      nrm.setElement(i, [o[0] / k, (o[1] + 1.4) / k, o[2] / k]);
    }
    return;
  }
  const min = pos.getMin([]),
    max = pos.getMax([]);
  const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const h = [(max[0] - min[0]) / 2 || 1, (max[1] - min[1]) / 2 || 1, (max[2] - min[2]) / 2 || 1];
  const pine = model.startsWith('Pine');
  const col = p.getAttribute('COLOR_0');
  const colors = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    pos.getElement(i, v);
    nrm.getElement(i, o);
    const dx = (v[0] - c[0]) / h[0],
      dy = (v[1] - c[1]) / h[1],
      dz = (v[2] - c[2]) / h[2];
    const grad = (v[1] - min[1]) / (max[1] - min[1] || 1);
    let sx: number, sy: number, sz: number, open: number;
    if (pine) {
      // Cone: the radius shrinks towards the tip, so "openness" is the distance from the trunk
      // relative to the radius at this height.
      const r = Math.hypot(dx, dz);
      const radiusHere = Math.max(0.12, 1 - grad * 0.85);
      open = Math.min(1, r / radiusHere);
      sx = dx;
      sy = 0.55 * Math.max(r, 0.3);
      sz = dz;
    } else {
      open = Math.min(1, Math.hypot(dx, dy * 0.9, dz));
      sx = dx;
      sy = dy + 0.25;
      sz = dz;
    }
    const sk = Math.hypot(sx, sy, sz) || 1;
    const mix = 0.82;
    const nx = o[0] * (1 - mix) + (sx / sk) * mix,
      ny = o[1] * (1 - mix) + (sy / sk) * mix,
      nz = o[2] * (1 - mix) + (sz / sk) * mix;
    const nk = Math.hypot(nx, ny, nz) || 1;
    nrm.setElement(i, [nx / nk, ny / nk, nz / nk]);
    colors.set([grad, open, 0, 1], i * 4);
  }
  const doc = Document.fromGraph(p.getGraph())!;
  const attr = doc
    .createAccessor()
    .setType('VEC4')
    .setArray(colors)
    .setBuffer(doc.getRoot().listBuffers()[0]);
  p.setAttribute('COLOR_0', attr);
  col?.dispose();
}
