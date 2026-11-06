#!/usr/bin/env node
// The picture the wall shows when nothing is playing, and the one the effect
// thumbnails are shot over: the three toys on a glossy studio floor under a
// spotlight, with a little bokeh behind them. Rendered in software from
// assets/models/*.glb; writes assets/default-picture.jpg (1920x1080).
//
//   node scripts/default-picture.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseGlb } from '../src/shared/fx/glb.mjs';
import { makeImage, clearDepth, drawMesh, camera, placement, writePng } from './models/raster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 1920, H = 1080;
const img = makeImage(W, H, [0, 0, 0]);
const cam = camera([0, 0.9, 3.9], [0, 0.5, 0], 35, W, H);

const load = (name) => { const b = fs.readFileSync(path.join(ROOT, 'assets', 'models', name + '.glb')); return parseGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const toys = [
  { m: load('alpaca'), x: -1.12, z: 0.05, yaw: -30 },
  { m: load('leopard'), x: 0.02, z: 0.22, yaw: 10 },
  { m: load('sumo'), x: 1.14, z: 0.0, yaw: 28 },
];

// ---- backdrop: a wall at the back, a floor, a spotlight pool, a few bokeh lights
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const bokeh = [];
for (let i = 0; i < 16; i++) {
  const warm = rnd() < 0.55;
  bokeh.push({ x: -2.6 + rnd() * 5.2, y: 0.5 + rnd() * 1.9, r: 0.1 + rnd() * 0.16, k: 0.18 + rnd() * 0.3,
    col: warm ? [1, 0.6 + rnd() * 0.3, 0.3] : (rnd() < 0.5 ? [0.3, 0.75, 1] : [0.9, 0.4, 0.85]) });
}
const WALL_Z = -2.4;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const d = cam.ray(x + 0.5, y + 0.5);
  const E = cam.eye;
  let c;
  const tWall = (WALL_Z - E[2]) / d[2];
  const tFloor = d[1] < 0 ? -E[1] / d[1] : Infinity;
  if (tFloor < tWall) {
    const px = E[0] + d[0] * tFloor, pz = E[2] + d[2] * tFloor;
    // a dark glossy floor with the spotlight pooling under the toys and the wall's glow reflected
    const pool = Math.exp(-(px * px + (pz - 0.1) * (pz - 0.1)) / 2.2);
    c = [0.06 + 0.3 * pool, 0.055 + 0.25 * pool, 0.07 + 0.2 * pool];
    const near = smooth(1.2, -2.4, pz);
    c = [c[0] + 0.12 * near, c[1] + 0.1 * near, c[2] + 0.11 * near];
    // soft contact shadows under the toys
    let sh = 1;
    for (const t of toys) sh *= 1 - 0.6 * Math.exp(-(((px - t.x) / 0.42) ** 2) - ((pz - t.z) / 0.3) ** 2);
    c = [c[0] * sh, c[1] * sh, c[2] * sh];
  } else {
    const px = E[0] + d[0] * tWall, py = E[1] + d[1] * tWall;
    const up = smooth(-0.2, 2.6, py);
    c = [0.2 - 0.14 * up, 0.17 - 0.1 * up, 0.18 - 0.07 * up];
    const spot = Math.exp(-((px * 0.75) ** 2 + ((py - 1.0) * 0.9) ** 2) / 1.4);
    c = [c[0] + 0.5 * spot, c[1] + 0.42 * spot, c[2] + 0.34 * spot];
    for (const b of bokeh) {
      const dd = Math.hypot(px - b.x, py - b.y) / b.r;
      const g = (1 - smooth(0.6, 1.05, dd)) * b.k + Math.exp(-dd * dd * 0.5) * b.k * 0.35;
      c = [c[0] + b.col[0] * g, c[1] + b.col[1] * g, c[2] + b.col[2] * g];
    }
  }
  const i = (y * W + x) * 3;
  img.rgb[i] = c[0]; img.rgb[i + 1] = c[1]; img.rgb[i + 2] = c[2];
}

// ---- the toys: reflections first, then the models
const light = [-0.5, 0.85, 0.7], lightCol = [1, 0.96, 0.9], ambient = [0.24, 0.25, 0.32], rimCol = [0.3, 0.45, 0.6];
for (const t of toys) {
  const s = 1 / (t.m.extras.height || 1);
  const P = placement(t.x, 0, t.z, t.yaw, s);
  drawMesh(img, t.m, { xform: (p) => { const w = P.xform(p); w[1] = -w[1]; return w; }, nrmXform: (n) => { const w = P.nrmXform(n); w[1] = -w[1]; return w; },
    project: cam.project, viewDir: cam.viewDir, light, lightCol, ambient, rimCol, cull: -1, alpha: 0.45, tint: [0.75, 0.78, 0.85], fadeY: 1.5 });
}
clearDepth(img);
for (const t of toys) {
  const s = 1 / (t.m.extras.height || 1);
  const P = placement(t.x, 0, t.z, t.yaw, s);
  drawMesh(img, t.m, { ...P, project: cam.project, viewDir: cam.viewDir, light, lightCol, ambient, rimCol, specular: 0.4 });
}

const png = path.join(ROOT, 'tmp', 'default-picture.png');
fs.mkdirSync(path.dirname(png), { recursive: true });
writePng(png, img, 1.25);
const jpg = path.join(ROOT, 'assets', 'default-picture.jpg');
execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88', png, '--out', jpg], { stdio: 'ignore' });
fs.unlinkSync(png);
console.log(path.relative(ROOT, jpg), W + 'x' + H, Math.round(fs.statSync(jpg).size / 1024) + ' KB');
