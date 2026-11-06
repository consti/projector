#!/usr/bin/env node
// Look at a built model without the app: four views (front, three-quarter,
// side, back) of assets/models/<name>.glb drawn by the software rasteriser
// into tmp/renders/<name>.png, lit the way the effects light it. `--pose`
// bends the rig (head nod, arm swing, leg step) so the skinning can be checked.
//
//   node scripts/render-model.mjs sumo [--pose] [--size 420]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGlb } from '../src/shared/fx/glb.mjs';
import { makeImage, drawMesh, placement, writePng } from './models/raster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--'));
if (!name) { console.error('usage: render-model.mjs <name> [--pose] [--size N]'); process.exit(1); }
const POSE = args.includes('--pose');
const sizeArg = args.indexOf('--size');
const S = sizeArg >= 0 ? parseInt(args[sizeArg + 1], 10) : 420;

const buf = fs.readFileSync(path.join(ROOT, 'assets', 'models', name + '.glb'));
const m = parseGlb(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const H = m.extras.height || 1;

// ---- rig: rotate a vertex about its bone's pivot, scaled by its weight
const pivots = m.rig.map((r) => r.pivot);
const rotX = (p, c, a) => { const s = Math.sin(a), co = Math.cos(a), y = p[1] - c[1], z = p[2] - c[2]; p[1] = c[1] + y * co - z * s; p[2] = c[2] + y * s + z * co; };
const rotZ = (p, c, a) => { const s = Math.sin(a), co = Math.cos(a), x = p[0] - c[0], y = p[1] - c[1]; p[0] = c[0] + x * co - y * s; p[1] = c[1] + x * s + y * co; };
const pose = { nod: 0.35, swing: 0.6, step: 0.5, ears: 0.5 };
function posed(i) {
  const p = [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
  if (!POSE || !m.bones) return p;
  const b = m.bones[i * 4], w = m.bones[i * 4 + 1] / 255;
  const c = pivots[b] || [0, 0, 0];
  switch (b) {
    case 1: rotX(p, c, -pose.nod * w); break;
    case 2: rotX(p, c, pose.swing * w); break;
    case 3: rotX(p, c, -pose.swing * w); break;
    case 4: rotX(p, c, -pose.step * w); break;
    case 5: rotX(p, c, pose.step * w); break;
    case 6: rotZ(p, c, pose.ears * w); break;
    case 7: rotZ(p, c, -pose.ears * w); break;
    default: break;
  }
  return p;
}

// ---- four views side by side, each with a touch of perspective
const VIEWS = [0, -40, -90, 180];
const W = S * VIEWS.length, Hpx = Math.round(S * 1.25);
const img = makeImage(W, Hpx, [0.15, 0.16, 0.18]);
VIEWS.forEach((yaw, i) => {
  const P = placement(0, 0, 0, yaw, 1);
  const scale = (S * 0.82) / H, cx = i * S + S / 2, cy = Hpx * 0.92;
  drawMesh(img, m, {
    pose: posed, ...P,
    project: (p) => { const k = 1 / (1 + p[2] * 0.12); return [cx + p[0] * scale * k, cy - p[1] * scale * k, -p[2]]; },
    viewDir: [0, 0, 1], light: [0.45, 0.7, 0.75], lightCol: [1, 1, 1], ambient: [0.3, 0.3, 0.34], rimCol: [0.12, 0.12, 0.12],
  });
});
const outDir = path.join(ROOT, 'tmp', 'renders');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, name + (POSE ? '-pose' : '') + '.png');
writePng(file, img, 1.6);
console.log(`${path.relative(ROOT, file)} ${W}x${Hpx}, ${m.count} verts`);
