#!/usr/bin/env node
// The picture the wall shows when nothing is playing, and the one the effect
// thumbnails are shot over: a plain studio backdrop — a wall under a soft
// spotlight, a glossy floor, a few bokeh lights — with nothing in it, so the
// effects are what you see. Writes assets/default-picture.jpg (1920x1080).
//
//   node scripts/default-picture.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeImage, camera, writePng } from './models/raster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 1920, H = 1080;
const img = makeImage(W, H, [0, 0, 0]);
const cam = camera([0, 0.9, 3.9], [0, 0.5, 0], 35, W, H);

let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const bokeh = [];
for (let i = 0; i < 11; i++) {
  const warm = rnd() < 0.55;
  bokeh.push({ x: -2.6 + rnd() * 5.2, y: 0.4 + rnd() * 2.0, r: 0.1 + rnd() * 0.16, k: 0.14 + rnd() * 0.22,
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
    // a dark glossy floor: the spotlight pools on it and the wall's glow reaches it
    const px = E[0] + d[0] * tFloor, pz = E[2] + d[2] * tFloor;
    const pool = Math.exp(-(px * px + (pz - 0.1) * (pz - 0.1)) / 2.2);
    c = [0.06 + 0.3 * pool, 0.055 + 0.25 * pool, 0.07 + 0.2 * pool];
    const near = smooth(1.2, -2.4, pz);
    c = [c[0] + 0.12 * near, c[1] + 0.1 * near, c[2] + 0.11 * near];
  } else {
    // the wall: darker towards the top, a soft spotlight, the bokeh
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

const png = path.join(ROOT, 'tmp', 'default-picture.png');
fs.mkdirSync(path.dirname(png), { recursive: true });
writePng(png, img, 1.25);
const jpg = path.join(ROOT, 'assets', 'default-picture.jpg');
execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88', png, '--out', jpg], { stdio: 'ignore' });
fs.unlinkSync(png);
console.log(path.relative(ROOT, jpg), W + 'x' + H, Math.round(fs.statSync(jpg).size / 1024) + ' KB');
