#!/usr/bin/env node
// Build the toy figurines: each character in scripts/models/ is a stack of
// signed-distance parts with a colour, a bone and a blend radius, plus a
// paint function for the decals (spots, stripes, eyes). This samples the
// field on a grid, meshes it with surface nets, takes normals from the
// field's gradient, bakes ambient occlusion and skinning weights per vertex,
// and writes assets/models/<name>.glb.
//
//   node scripts/build-models.mjs                 # every model, final resolution
//   node scripts/build-models.mjs sumo --res 120  # one model, quick preview
//
// Then `node scripts/render-model.mjs sumo` to look at it without the app.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { surfaceNets, smooth, smoothColors } from './models/mesh.mjs';
import { writeGlb } from './models/glb-write.mjs';
import { smin, smax, clamp, smoothstep } from './models/sdf.mjs';
import { MODELS } from './models/index.mjs';
import { BONES } from '../src/shared/fx/glb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'models');
const args = process.argv.slice(2);
const resArg = args.indexOf('--res');
const RES = resArg >= 0 ? parseInt(args[resArg + 1], 10) : 200;
const names = args.filter((a, i) => !a.startsWith('--') && (resArg < 0 || i !== resArg + 1));
const list = names.length ? names : Object.keys(MODELS);

function build(name, model) {
  const t0 = Date.now();
  const parts = model.parts;
  const adds = parts.filter((p) => p.op !== 'cut');

  // the field, built part by part: smooth unions and smooth cuts in order
  const field = (p) => {
    let d = Infinity;
    for (const part of parts) {
      const v = part.sdf(p);
      d = part.op === 'cut' ? smax(d, -v, part.k || 0) : smin(d, v, part.k || 0);
    }
    return d;
  };

  // ---- sample
  const [lo, hi] = model.bounds;
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const cell = Math.max(...ext) / RES;
  const nx = Math.ceil(ext[0] / cell) + 2, ny = Math.ceil(ext[1] / cell) + 2, nz = Math.ceil(ext[2] / cell) + 2;
  const origin = [lo[0] - cell, lo[1] - cell, lo[2] - cell];
  const samples = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
  const q = [0, 0, 0];
  let i = 0;
  for (let k = 0; k <= nz; k++) {
    q[2] = origin[2] + k * cell;
    for (let j = 0; j <= ny; j++) {
      q[1] = origin[1] + j * cell;
      for (let ii = 0; ii <= nx; ii++) { q[0] = origin[0] + ii * cell; samples[i++] = field(q); }
    }
  }
  const t1 = Date.now();

  // ---- mesh
  const net = surfaceNets(samples, nx, ny, nz, origin, cell);
  let pos = smooth(net.positions, net.indices, 1, 0.35);
  const n = pos.length / 3;
  const t2 = Date.now();

  // ---- per-vertex: snap to the surface, normal, occlusion, colour, bone
  const normals = new Float32Array(n * 3);
  const colors = new Uint8Array(n * 3);
  const bones = new Uint8Array(n * 4);
  const eps = cell * 0.5;
  const grad = (p, out) => {
    const x = p[0], y = p[1], z = p[2];
    out[0] = field([x + eps, y, z]) - field([x - eps, y, z]);
    out[1] = field([x, y + eps, z]) - field([x, y - eps, z]);
    out[2] = field([x, y, z + eps]) - field([x, y, z - eps]);
    const m = Math.hypot(out[0], out[1], out[2]) || 1;
    out[0] /= m; out[1] /= m; out[2] /= m;
    return out;
  };
  const nrm = [0, 0, 1];
  const boneIndex = new Map(BONES.map((b, idx) => [b, idx]));
  const partsByBone = new Map();
  for (const part of adds) {
    const b = part.bone || 'body';
    if (!boneIndex.has(b)) throw new Error(`${name}: unknown bone "${b}" on part ${part.name}`);
    if (!partsByBone.has(b)) partsByBone.set(b, []);
    partsByBone.get(b).push(part);
  }
  const aoStep = model.aoStep || 0.035;
  for (let v = 0; v < n; v++) {
    const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
    // two Newton steps back onto the zero set (smoothing pulls vertices off it)
    for (let s = 0; s < 2; s++) {
      grad(p, nrm);
      const d = field(p);
      p[0] -= nrm[0] * d; p[1] -= nrm[1] * d; p[2] -= nrm[2] * d;
    }
    grad(p, nrm);
    pos[v * 3] = p[0]; pos[v * 3 + 1] = p[1]; pos[v * 3 + 2] = p[2];
    normals[v * 3] = nrm[0]; normals[v * 3 + 1] = nrm[1]; normals[v * 3 + 2] = nrm[2];

    // nearest part decides the material and the bone
    let best = Infinity, part = adds[0];
    for (const cand of adds) { const d = cand.sdf(p); if (d < best) { best = d; part = cand; } }
    const bone = part.bone || 'body';
    let others = Infinity;
    for (const cand of adds) { if ((cand.bone || 'body') === bone) continue; const d = cand.sdf(p); if (d < others) others = d; }
    const weight = bone === 'body' ? 1 : smoothstep(0, model.skinBlend || 0.12, others);

    // ambient occlusion: how much of the field closes in along the normal
    let occ = 0, w = 1;
    for (let s = 1; s <= 5; s++) {
      const h = aoStep * s;
      const d = field([p[0] + nrm[0] * h, p[1] + nrm[1] * h, p[2] + nrm[2] * h]);
      occ += (h - d) * w; w *= 0.65;
    }
    let ao = clamp(1 - occ * (model.aoGain || 9), 0, 1);
    ao *= 0.55 + 0.45 * smoothstep(0, 0.12, p[1]);       // the floor it stands on
    ao = 0.25 + 0.75 * ao;

    let col = typeof part.color === 'function' ? part.color(p, nrm) : part.color;
    if (model.paint) col = model.paint(p, nrm, col, part) || col;
    colors[v * 3] = clamp(Math.round(col[0] * 255), 0, 255);
    colors[v * 3 + 1] = clamp(Math.round(col[1] * 255), 0, 255);
    colors[v * 3 + 2] = clamp(Math.round(col[2] * 255), 0, 255);
    bones[v * 4] = boneIndex.get(bone);
    bones[v * 4 + 1] = Math.round(weight * 255);
    bones[v * 4 + 2] = Math.round(ao * 255);
    bones[v * 4 + 3] = 0;
  }
  // soften the paint edges: a vertex colour is one sample, and a hard edge
  // between two samples turns into stair steps across the triangles
  smoothColors(colors, net.indices, model.paintSoft == null ? 1 : model.paintSoft);
  const t3 = Date.now();

  const rig = BONES.map((b) => ({ name: b, pivot: (model.bones && model.bones[b]) || [0, 0, 0] }));
  const glb = writeGlb({ name, positions: pos, normals, colors, bones, indices: net.indices, rig,
    extras: { height: model.height || 1, footprint: model.footprint || 0.5, ...(model.extras || {}) } });
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name + '.glb');
  fs.writeFileSync(file, glb);
  console.log(`${name}: grid ${nx}x${ny}x${nz} (${(t1 - t0) / 1000}s), ${n} verts / ${net.indices.length / 3} tris (${(t2 - t1) / 1000}s), `
    + `shading ${(t3 - t2) / 1000}s -> ${path.relative(ROOT, file)} ${(glb.byteLength / 1048576).toFixed(2)} MB`);
}

for (const name of list) {
  if (!MODELS[name]) { console.error('no such model: ' + name + ' (have ' + Object.keys(MODELS).join(', ') + ')'); process.exit(1); }
  build(name, MODELS[name]);
}
