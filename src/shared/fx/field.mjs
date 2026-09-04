// The "world" every effect collides against: the blackout shapes you drew,
// plus the walls of the projected frame. It is published in two forms because
// the two halves of the system want different things —
//
//   * a signed distance field (CPU Float32Array + an R32F texture) for
//     particles, fluids and shading, which want a smooth normal anywhere; and
//   * the raw line segments with a uniform-grid index for the rigid-body
//     solver, which wants exact contacts so boxes can actually stack on a ledge.
//
// Both are rebuilt only when the shape geometry changes.

import * as Mesh from '../mesh.mjs';
import { texFromData } from './glu.mjs';

const INF = 1e20;

// ---------------------------------------------------------------- occluders
// Output-space polygons that solid things must not pass through.
export function collectOccluders(project, fx) {
  const polys = [];
  const refW = (project.global && project.global.refW) || 1920;
  const refH = (project.global && project.global.refH) || 1080;
  const aspect = refH / refW;
  if (fx.collideMasks !== false) {
    for (const m of project.masks || []) {
      if (!m.enabled || m.fxCollide === false) continue;
      if (!m.points || m.points.length < 3) continue;
      // grow in output px, matching what the mask actually paints
      const px = m.points.map((p) => [p[0] * refW, p[1] * refH]);
      const g = m.grow || 0;
      const grown = g ? Mesh.offsetPolygon(px, g) : px;
      polys.push(grown.map((p) => [p[0] / refW, (p[1] / refH) * aspect]));
    }
  }
  if (fx.collideSurfaceEdges) {
    for (const s of project.surfaces || []) {
      if (!s.enabled) continue;
      const c = Mesh.corners(s.mesh);          // TL, TR, BR, BL
      polys.push(c.map((p) => [p[0], p[1] * aspect]));
    }
  }
  return { polys, aspect };
}

export function occluderKey(project, fx) {
  const parts = [fx.collideMasks !== false ? 1 : 0, fx.collideSurfaceEdges ? 1 : 0,
    fx.walls || 'lrb', project.global?.refW, project.global?.refH];
  for (const m of project.masks || []) {
    if (!m.enabled || m.fxCollide === false) continue;
    parts.push(m.id, m.grow || 0, m.points.length, ...m.points.flat().map((v) => Math.round(v * 4096)));
  }
  if (fx.collideSurfaceEdges) {
    for (const s of project.surfaces || []) {
      if (!s.enabled) continue;
      parts.push(s.id, ...Mesh.corners(s.mesh).flat().map((v) => Math.round(v * 4096)));
    }
  }
  return parts.join(',');
}

// ------------------------------------------------------- exact distance xform
// Felzenszwalb & Huttenlocher: squared EDT of a 1-D sampled function, applied
// per row then per column. O(n) and exact, which matters because the field is
// what everything else derives its normals from.
function edt1d(f, d, v, z, n) {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }
}

function edt2d(grid, w, h) {
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n);
  const v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, d, v, z, w);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, d, v, z, h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  return grid;
}

// even-odd scanline fill of a polygon set into a Uint8 coverage grid
function rasterize(polys, w, h, sx, sy) {
  const cov = new Uint8Array(w * h);
  const xs = [];
  for (const poly of polys) {
    let minY = Infinity, maxY = -Infinity;
    for (const p of poly) { const y = p[1] * sy; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(h - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      xs.length = 0;
      for (let i = 0, n = poly.length; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        const ay = a[1] * sy, by = b[1] * sy;
        if ((ay <= py && by > py) || (by <= py && ay > py)) {
          const t = (py - ay) / (by - ay);
          xs.push((a[0] + (b[0] - a[0]) * t) * sx);
        }
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const x0 = Math.max(0, Math.ceil(xs[i] - 0.5)), x1 = Math.min(w - 1, Math.floor(xs[i + 1] - 0.5));
        for (let x = x0; x <= x1; x++) cov[y * w + x] = 1;
      }
    }
  }
  return cov;
}

// ------------------------------------------------------------------- Field
export class Field {
  /** @param {WebGL2RenderingContext} gl */
  constructor(gl, res = 512) {
    this.gl = gl;
    this.res = res;
    this.w = res; this.h = res;
    this.aspect = 9 / 16;
    this.key = null;
    this.dist = new Float32Array(1);
    this.tex = null;
    this.polys = [];
    this.segs = new Float32Array(0);
    this.segCount = 0;
    this.cell = 1 / res;
    this.walls = { l: true, r: true, t: false, b: true };
    this.grid = null;          // uniform grid index over segments
    this.version = 0;
  }

  /** Rebuild from output-space polygons (y already scaled by aspect). */
  build(polys, aspect, walls) {
    const w = this.res;
    const h = Math.max(8, Math.round(this.res * aspect));
    this.w = w; this.h = h; this.aspect = aspect;
    this.polys = polys;
    this.walls = walls || this.walls;
    this.cell = 1 / w;

    const cov = rasterize(polys, w, h, w, w);   // uniform scale: 1 unit x == w cells
    const a = new Float64Array(w * h), b = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) { a[i] = cov[i] ? 0 : INF; b[i] = cov[i] ? INF : 0; }
    edt2d(a, w, h);   // distance to nearest solid cell
    edt2d(b, w, h);   // distance to nearest empty cell

    const d = new Float32Array(w * h);
    const k = this.cell;
    for (let i = 0; i < w * h; i++) d[i] = (Math.sqrt(a[i]) - Math.sqrt(b[i])) * k;
    this.dist = d;

    this._buildSegments(polys);
    this._upload();
    this.version++;
  }

  // World-space distance to the enabled frame walls (exact, not rasterized, so
  // the floor stays razor sharp whatever the grid resolution is).
  //
  // The side walls stop just above the frame: snow and rain are seeded off the
  // top edge over a wider span than the picture, and they must fall in rather
  // than splash against an invisible wall the moment they appear.
  wallDist(x, y) {
    let d = INF;
    const W = this.walls;
    if (y > -0.004) {
      if (W.l) d = Math.min(d, x);
      if (W.r) d = Math.min(d, 1 - x);
    }
    if (W.t) d = Math.min(d, y);
    if (W.b) d = Math.min(d, this.aspect - y);
    return d;
  }

  /** Signed distance at a world point (>0 outside solid). Bilinear. */
  sample(x, y) {
    const w = this.w, h = this.h;
    let gx = x * w - 0.5, gy = y * w - 0.5;
    gx = gx < 0 ? 0 : gx > w - 1.001 ? w - 1.001 : gx;
    gy = gy < 0 ? 0 : gy > h - 1.001 ? h - 1.001 : gy;
    const x0 = gx | 0, y0 = gy | 0, fx = gx - x0, fy = gy - y0;
    const i = y0 * w + x0, d = this.dist;
    const s = (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy)
            + (d[i + w] * (1 - fx) + d[i + w + 1] * fx) * fy;
    return Math.min(s, this.wallDist(x, y));
  }

  /** Unit outward normal (points away from solid) at a world point. */
  grad(x, y, out) {
    const e = this.cell;
    const gx = this.sample(x + e, y) - this.sample(x - e, y);
    const gy = this.sample(x, y + e) - this.sample(x, y - e);
    const m = Math.hypot(gx, gy);
    if (m < 1e-9) { out[0] = 0; out[1] = -1; return out; }
    out[0] = gx / m; out[1] = gy / m;
    return out;
  }

  // ------------------------------------------------------------- segments
  _buildSegments(polys) {
    const list = [];
    for (const poly of polys) {
      for (let i = 0, n = poly.length; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        list.push(a[0], a[1], b[0], b[1]);
      }
    }
    const A = this.aspect, W = this.walls;
    const M = 0.35;   // walls run past the frame so corners cannot be squeezed through
    if (W.b) list.push(-M, A, 1 + M, A);
    if (W.t) list.push(-M, 0, 1 + M, 0);
    if (W.l) list.push(0, -M, 0, A + M);
    if (W.r) list.push(1, -M, 1, A + M);
    this.segs = new Float32Array(list);
    this.segCount = list.length / 4;
    this._indexSegments();
  }

  _indexSegments() {
    const cols = 48, rows = Math.max(4, Math.round(48 * this.aspect));
    const buckets = new Array(cols * rows);
    for (let i = 0; i < buckets.length; i++) buckets[i] = [];
    const s = this.segs;
    const cw = 1 / cols, ch = this.aspect / rows;
    for (let i = 0; i < this.segCount; i++) {
      const x0 = s[i * 4], y0 = s[i * 4 + 1], x1 = s[i * 4 + 2], y1 = s[i * 4 + 3];
      const c0 = Math.max(0, Math.min(cols - 1, Math.floor(Math.min(x0, x1) / cw)));
      const c1 = Math.max(0, Math.min(cols - 1, Math.floor(Math.max(x0, x1) / cw)));
      const r0 = Math.max(0, Math.min(rows - 1, Math.floor(Math.min(y0, y1) / ch)));
      const r1 = Math.max(0, Math.min(rows - 1, Math.floor(Math.max(y0, y1) / ch)));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) buckets[r * cols + c].push(i);
    }
    this.grid = { cols, rows, cw, ch, buckets };
  }

  /** Segment indices whose cells overlap the AABB. Reuses `out`. */
  segsNear(minX, minY, maxX, maxY, out) {
    out.length = 0;
    const g = this.grid;
    if (!g) return out;
    const c0 = Math.max(0, Math.floor(minX / g.cw)), c1 = Math.min(g.cols - 1, Math.floor(maxX / g.cw));
    const r0 = Math.max(0, Math.floor(minY / g.ch)), r1 = Math.min(g.rows - 1, Math.floor(maxY / g.ch));
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        for (const i of g.buckets[r * g.cols + c]) if (!seen.has(i)) { seen.add(i); out.push(i); }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------- gpu
  _upload() {
    const gl = this.gl;
    const w = this.w, h = this.h;
    // Bake the walls in so shaders see one field. Row 0 of a render target is
    // the BOTTOM of the picture, so the rows are written in reverse: shaders
    // sample this with the same uv they rasterize into.
    const data = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const wy = (y + 0.5) / w;
      const dst = (h - 1 - y) * w;
      for (let x = 0; x < w; x++) {
        const wx = (x + 0.5) / w;
        data[dst + x] = Math.min(this.dist[y * w + x], this.wallDist(wx, wy));
      }
    }
    if (this.tex) gl.deleteTexture(this.tex);
    this.tex = texFromData(gl, w, h, 'r32f', data, { nearest: false });
    this.texel = [1 / w, 1 / h];
  }

  dispose() { if (this.tex) this.gl.deleteTexture(this.tex); this.tex = null; }
}
