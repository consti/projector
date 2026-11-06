// Naive surface nets over a sampled distance field: one vertex per cell that
// the surface crosses, placed at the mean of its edge crossings, and a quad
// across every lattice edge whose ends have different signs. No lookup
// tables, well-shaped triangles, and the normals come from the field itself
// (its gradient), so the mesh shades like the smooth surface it approximates.

/** The twelve cell edges as corner-index pairs; corner bit 0 = x, 1 = y, 2 = z. */
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

/**
 * @param {Float32Array} field (nx+1)*(ny+1)*(nz+1) samples, x fastest
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function surfaceNets(field, nx, ny, nz, origin, cell) {
  const sx = 1, sy = nx + 1, sz = (nx + 1) * (ny + 1);
  const cellIndex = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [];
  const corner = new Float32Array(8);

  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const base = i + j * sy + k * sz;
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = field[base + (c & 1) * sx + ((c >> 1) & 1) * sy + ((c >> 2) & 1) * sz];
      corner[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let ax = 0, ay = 0, az = 0, n = 0;
    for (const [a, b] of EDGES) {
      const va = corner[a], vb = corner[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      const ex = (a & 1) + (((b & 1) - (a & 1)) * t);
      const ey = ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t);
      const ez = ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
      ax += ex; ay += ey; az += ez; n++;
    }
    cellIndex[i + j * nx + k * nx * ny] = pos.length / 3;
    pos.push(origin[0] + (i + ax / n) * cell, origin[1] + (j + ay / n) * cell, origin[2] + (k + az / n) * cell);
  }

  const idx = [];
  const ci = (i, j, k) => cellIndex[i + j * nx + k * nx * ny];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const base = i + j * sy + k * sz;
    const v0 = field[base];
    // the edge from this lattice point along +x is shared by the four cells around it
    const vx = field[base + sx];
    if ((v0 < 0) !== (vx < 0) && j > 0 && k > 0) quad(ci(i, j - 1, k - 1), ci(i, j, k - 1), ci(i, j, k), ci(i, j - 1, k), v0 >= 0);
    const vy = field[base + sy];
    if ((vy < 0) !== (v0 < 0) && i > 0 && k > 0) quad(ci(i - 1, j, k - 1), ci(i - 1, j, k), ci(i, j, k), ci(i, j, k - 1), v0 >= 0);
    const vz = field[base + sz];
    if ((v0 < 0) !== (vz < 0) && i > 0 && j > 0) quad(ci(i - 1, j - 1, k), ci(i, j - 1, k), ci(i, j, k), ci(i - 1, j, k), v0 >= 0);
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

/** Laplacian smoothing with a small step; keeps the surface-nets vertices from ringing. */
export function smooth(positions, indices, iterations = 1, lambda = 0.5) {
  const n = positions.length / 3;
  const nbr = new Array(n);
  for (let i = 0; i < n; i++) nbr[i] = new Set();
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    nbr[a].add(b); nbr[a].add(c); nbr[b].add(a); nbr[b].add(c); nbr[c].add(a); nbr[c].add(b);
  }
  let cur = positions;
  for (let it = 0; it < iterations; it++) {
    const next = new Float32Array(cur.length);
    for (let i = 0; i < n; i++) {
      const s = nbr[i];
      if (!s.size) { next[i * 3] = cur[i * 3]; next[i * 3 + 1] = cur[i * 3 + 1]; next[i * 3 + 2] = cur[i * 3 + 2]; continue; }
      let x = 0, y = 0, z = 0;
      for (const j of s) { x += cur[j * 3]; y += cur[j * 3 + 1]; z += cur[j * 3 + 2]; }
      x /= s.size; y /= s.size; z /= s.size;
      next[i * 3] = cur[i * 3] + (x - cur[i * 3]) * lambda;
      next[i * 3 + 1] = cur[i * 3 + 1] + (y - cur[i * 3 + 1]) * lambda;
      next[i * 3 + 2] = cur[i * 3 + 2] + (z - cur[i * 3 + 2]) * lambda;
    }
    cur = next;
  }
  return cur;
}

/** Blur vertex colours (rgb bytes) with their neighbours, in place. */
export function smoothColors(colors, indices, iterations = 1) {
  const n = colors.length / 3;
  const nbr = new Array(n);
  for (let i = 0; i < n; i++) nbr[i] = new Set();
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    nbr[a].add(b); nbr[a].add(c); nbr[b].add(a); nbr[b].add(c); nbr[c].add(a); nbr[c].add(b);
  }
  for (let it = 0; it < iterations; it++) {
    const src = Uint8Array.from(colors);
    for (let i = 0; i < n; i++) {
      const s = nbr[i];
      if (!s.size) continue;
      let r = src[i * 3] * 2, g = src[i * 3 + 1] * 2, b = src[i * 3 + 2] * 2, w = 2;
      for (const j of s) { r += src[j * 3]; g += src[j * 3 + 1]; b += src[j * 3 + 2]; w++; }
      colors[i * 3] = Math.round(r / w); colors[i * 3 + 1] = Math.round(g / w); colors[i * 3 + 2] = Math.round(b / w);
    }
  }
}
