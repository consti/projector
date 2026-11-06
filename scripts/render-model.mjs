#!/usr/bin/env node
// Look at a built model without the app: a small software rasteriser that
// draws four views (front, three-quarter, side, back) of assets/models/<name>.glb
// into tmp/renders/<name>.png, lit the way the effects light it. `--pose`
// bends the rig (head nod, arm swing, leg step) so the skinning can be checked.
//
//   node scripts/render-model.mjs sumo [--pose] [--size 420]

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseGlb } from '../src/shared/fx/glb.mjs';

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

// ---- views
const VIEWS = [['front', 0], ['three-quarter', -40], ['side', -90], ['back', 180]];
const W = S * VIEWS.length, Hpx = Math.round(S * 1.25);
const img = new Uint8Array(W * Hpx * 3).fill(0);
for (let i = 0; i < W * Hpx; i++) { img[i * 3] = 38; img[i * 3 + 1] = 40; img[i * 3 + 2] = 46; }
const depth = new Float32Array(W * Hpx).fill(Infinity);
const L = [0.45, 0.7, 0.75]; { const l = Math.hypot(...L); L[0] /= l; L[1] /= l; L[2] /= l; }

function drawView(vx, yawDeg) {
  const a = (yawDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const scale = (S * 0.82) / H;
  const cx = vx + S / 2, cy = Hpx * 0.92;
  const n = m.count;
  const sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n);
  const nz = new Float32Array(n), nxv = new Float32Array(n), nyv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = posed(i);
    // yaw about y, then a touch of perspective
    const x = p[0] * ca + p[2] * sa, z = -p[0] * sa + p[2] * ca, y = p[1];
    const persp = 1 / (1 - z * 0.12);
    sx[i] = cx + x * scale * persp; sy[i] = cy - y * scale * persp; sz[i] = -z;
    const nx0 = m.normals[i * 3], ny0 = m.normals[i * 3 + 1], nz0 = m.normals[i * 3 + 2];
    nxv[i] = nx0 * ca + nz0 * sa; nyv[i] = ny0; nz[i] = -nx0 * sa + nz0 * ca;
  }
  const idx = m.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a0 = idx[t], b0 = idx[t + 1], c0 = idx[t + 2];
    const x0 = sx[a0], y0 = sy[a0], x1 = sx[b0], y1 = sy[b0], x2 = sx[c0], y2 = sy[c0];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area >= 0) continue;                       // back face (screen y runs down)
    const minX = Math.max(vx, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(vx + S - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(Hpx - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      let w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
      let w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
      let w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * sz[a0] + w1 * sz[b0] + w2 * sz[c0];
      const di = y * W + x;
      if (z >= depth[di]) continue;
      depth[di] = z;
      const nx1 = w0 * nxv[a0] + w1 * nxv[b0] + w2 * nxv[c0];
      const ny1 = w0 * nyv[a0] + w1 * nyv[b0] + w2 * nyv[c0];
      const nz1 = w0 * nz[a0] + w1 * nz[b0] + w2 * nz[c0];
      const nl = Math.hypot(nx1, ny1, nz1) || 1;
      const ndl = Math.max(0, (nx1 * L[0] + ny1 * L[1] + nz1 * L[2]) / nl);
      const ao = m.bones ? (w0 * m.bones[a0 * 4 + 2] + w1 * m.bones[b0 * 4 + 2] + w2 * m.bones[c0 * 4 + 2]) / 255 : 1;
      const hx = L[0], hy = L[1], hz = L[2] + 1; const hl = Math.hypot(hx, hy, hz);
      const spec = Math.pow(Math.max(0, (nx1 * hx + ny1 * hy + nz1 * hz) / (nl * hl)), 40) * 0.35;
      const rim = Math.pow(1 - Math.max(0, nz1 / nl), 3) * 0.12;
      for (let c = 0; c < 3; c++) {
        const col = m.colors ? (w0 * m.colors[a0 * 3 + c] + w1 * m.colors[b0 * 3 + c] + w2 * m.colors[c0 * 3 + c]) / 255 : 0.8;
        const v = col * (0.3 * ao + 0.8 * ndl * (0.6 + 0.4 * ao)) + spec + rim;
        img[di * 3 + c] = Math.max(0, Math.min(255, Math.round(Math.pow(v, 1 / 1.6) * 255)));
      }
    }
  }
}
VIEWS.forEach(([, yaw], i) => drawView(i * S, yaw));

// ---- png
function crc32(b) { let c, crc = 0xffffffff; for (let n = 0; n < b.length; n++) { c = (crc ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
const raw = Buffer.alloc((W * 3 + 1) * Hpx);
for (let y = 0; y < Hpx; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(img.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(Hpx, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
const outDir = path.join(ROOT, 'tmp', 'renders');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, name + (POSE ? '-pose' : '') + '.png');
fs.writeFileSync(file, png);
console.log(`${path.relative(ROOT, file)} ${W}x${Hpx}, ${m.count} verts`);
