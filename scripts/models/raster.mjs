// A small software rasteriser for the built models: draws a parsed .glb into
// an RGB float image with a z-buffer, lit roughly the way the effects light
// the toys (key light, ambient against the baked occlusion, a specular and a
// rim). Used by the turnaround renders and the default picture; no GPU, no
// dependencies.
import fs from 'node:fs';
import zlib from 'node:zlib';

export function makeImage(w, h, bg = [0.15, 0.16, 0.18]) {
  const rgb = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { rgb[i * 3] = bg[0]; rgb[i * 3 + 1] = bg[1]; rgb[i * 3 + 2] = bg[2]; }
  return { w, h, rgb, depth: new Float32Array(w * h).fill(Infinity) };
}

export function clearDepth(img) { img.depth.fill(Infinity); }

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/**
 * Draw one mesh. Options:
 *  pose(i) -> model-space position of vertex i (default: the mesh's own)
 *  xform(p) -> world position; nrmXform(n) -> world normal
 *  project(world) -> [sx, sy, depth] or null
 *  light (towards the light), lightCol, ambient, rimCol, viewDir (towards the camera)
 *  specular, alpha, tint, fadeY (alpha falls off with world y, for reflections),
 *  cull: 1 draws front faces, -1 back faces (a mirrored copy), 0 both
 */
export function drawMesh(img, m, o) {
  const { w: W, h: H, rgb, depth } = img;
  const n = m.count;
  const sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n);
  const nx = new Float32Array(n), ny = new Float32Array(n), nz = new Float32Array(n), wy = new Float32Array(n);
  const ok = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = o.pose ? o.pose(i) : [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
    const wp = o.xform(p);
    const s = o.project(wp);
    if (!s) continue;
    ok[i] = 1; sx[i] = s[0]; sy[i] = s[1]; sz[i] = s[2]; wy[i] = wp[1];
    const nn = o.nrmXform([m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]]);
    nx[i] = nn[0]; ny[i] = nn[1]; nz[i] = nn[2];
  }
  const L = norm(o.light || [0.45, 0.7, 0.75]);
  const V = norm(o.viewDir || [0, 0, 1]);
  const Hh = norm([L[0] + V[0], L[1] + V[1], L[2] + V[2]]);
  const lightCol = o.lightCol || [1, 1, 1], amb = o.ambient || [0.3, 0.3, 0.34], rimCol = o.rimCol || [0.12, 0.12, 0.12];
  const specular = o.specular == null ? 0.35 : o.specular, cull = o.cull == null ? 1 : o.cull;
  const tint = o.tint || [1, 1, 1], alpha0 = o.alpha == null ? 1 : o.alpha, fadeY = o.fadeY || 0;
  const depthWrite = o.depthWrite !== false;
  const idx = m.indices, col = m.colors, bones = m.bones;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (!ok[a] || !ok[b] || !ok[c]) continue;
    const x0 = sx[a], y0 = sy[a], x1 = sx[b], y1 = sy[b], x2 = sx[c], y2 = sy[c];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (cull > 0 ? area >= 0 : cull < 0 ? area <= 0 : area === 0) continue;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
      const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * sz[a] + w1 * sz[b] + w2 * sz[c];
      const di = y * W + x;
      if (z >= depth[di]) continue;
      if (depthWrite) depth[di] = z;
      let n0 = w0 * nx[a] + w1 * nx[b] + w2 * nx[c], n1 = w0 * ny[a] + w1 * ny[b] + w2 * ny[c], n2 = w0 * nz[a] + w1 * nz[b] + w2 * nz[c];
      const nl = Math.hypot(n0, n1, n2) || 1; n0 /= nl; n1 /= nl; n2 /= nl;
      const ndl = n0 * L[0] + n1 * L[1] + n2 * L[2];
      const diff = Math.max(ndl, 0) * 0.65 + Math.max((ndl + 0.4) / 1.4, 0) * 0.35;
      const ao = bones ? (w0 * bones[a * 4 + 2] + w1 * bones[b * 4 + 2] + w2 * bones[c * 4 + 2]) / 255 : 1;
      const spec = Math.pow(Math.max(0, n0 * Hh[0] + n1 * Hh[1] + n2 * Hh[2]), 60) * specular * (0.3 + 0.7 * ao);
      const fr = Math.pow(1 - Math.max(0, n0 * V[0] + n1 * V[1] + n2 * V[2]), 3) * ao;
      let alpha = alpha0;
      if (fadeY) alpha *= Math.max(0, 1 - Math.abs(w0 * wy[a] + w1 * wy[b] + w2 * wy[c]) * fadeY);
      if (alpha <= 0) continue;
      for (let k = 0; k < 3; k++) {
        const albedo = (col ? (w0 * col[a * 3 + k] + w1 * col[b * 3 + k] + w2 * col[c * 3 + k]) / 255 : 0.8) * tint[k];
        const v = albedo * (amb[k] * ao + lightCol[k] * diff * (0.55 + 0.45 * ao)) + lightCol[k] * spec + rimCol[k] * fr;
        rgb[di * 3 + k] += (v - rgb[di * 3 + k]) * alpha;
      }
    }
  }
}

/** A look-at camera: returns { project(world), ray(sx, sy), viewDir, eye }. */
export function camera(eye, target, fovDeg, W, H) {
  const f = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const r = norm([-f[2], 0, f[0]]);                       // right = f x up, with up = +y
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const F = 1 / Math.tan((fovDeg * Math.PI) / 360);
  return {
    eye, viewDir: [-f[0], -f[1], -f[2]],
    project(p) {
      const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
      const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
      if (z < 0.05) return null;
      const x = (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / z, y = (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / z;
      return [W / 2 + x * F * (H / 2), H / 2 - y * F * (H / 2), z];
    },
    ray(sx, sy) {
      const x = (sx - W / 2) / (H / 2) / F, y = (H / 2 - sy) / (H / 2) / F;
      return norm([f[0] + r[0] * x + u[0] * y, f[1] + r[1] * x + u[1] * y, f[2] + r[2] * x + u[2] * y]);
    },
  };
}

/** Yaw about y, then move; the normals turn with it. */
export function placement(x, y, z, yawDeg, scale = 1) {
  const a = (yawDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return {
    xform: (p) => [x + (p[0] * c + p[2] * s) * scale, y + p[1] * scale, z + (-p[0] * s + p[2] * c) * scale],
    nrmXform: (n) => [n[0] * c + n[2] * s, n[1], -n[0] * s + n[2] * c],
  };
}

function crc32(b) { let c, crc = 0xffffffff; for (let n = 0; n < b.length; n++) { c = (crc ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Write the image as a PNG, with a gamma lift (1 = none). */
export function writePng(file, img, gamma = 1) {
  const { w: W, h: H, rgb } = img;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    const row = y * (W * 3 + 1);
    raw[row] = 0;
    for (let i = 0; i < W * 3; i++) {
      const v = Math.max(0, Math.min(1, rgb[y * W * 3 + i]));
      raw[row + 1 + i] = Math.round((gamma === 1 ? v : Math.pow(v, 1 / gamma)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
