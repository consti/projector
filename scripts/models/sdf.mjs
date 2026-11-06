// Signed-distance primitives and operators for building the toy figurines.
// Everything works on plain [x, y, z] arrays in model space: y up, the feet
// on y = 0, the figure facing +z. Distances are only ever sampled on a grid
// and differentiated numerically, so the primitives need to be sign-correct
// and smooth, not perfectly metric.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const len = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

// ----------------------------------------------------------- primitives ----
export const sphere = (c, r) => (p) => len(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r;

/** Ellipsoid with radii r (iq's bound, good enough for a figurine). */
export const ellipsoid = (c, r) => (p) => {
  const x = (p[0] - c[0]) / r[0], y = (p[1] - c[1]) / r[1], z = (p[2] - c[2]) / r[2];
  const k0 = len(x, y, z);
  const k1 = len(x / r[0], y / r[1], z / r[2]);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0], r[1], r[2]);
};

/** Capsule from a to b with radius r (r may be a pair for a tapered one). */
export const capsule = (a, b, r) => {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const bb = bx * bx + by * by + bz * bz || 1e-9;
  const r0 = Array.isArray(r) ? r[0] : r, r1 = Array.isArray(r) ? r[1] : r;
  return (p) => {
    const px = p[0] - a[0], py = p[1] - a[1], pz = p[2] - a[2];
    const h = clamp((px * bx + py * by + pz * bz) / bb, 0, 1);
    return len(px - bx * h, py - by * h, pz - bz * h) - (r0 + (r1 - r0) * h);
  };
};

/** Box with half extents h, corners rounded by r. */
export const rbox = (c, h, r = 0) => (p) => {
  const qx = Math.abs(p[0] - c[0]) - h[0] + r, qy = Math.abs(p[1] - c[1]) - h[1] + r, qz = Math.abs(p[2] - c[2]) - h[2] + r;
  const o = len(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  return o + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
};

/** Vertical cylinder (axis y) of radius r and half height h, edges rounded by rr. */
export const cylinder = (c, r, h, rr = 0) => (p) => {
  const dx = len(p[0] - c[0], 0, p[2] - c[2]) - r + rr, dy = Math.abs(p[1] - c[1]) - h + rr;
  return Math.min(Math.max(dx, dy), 0) + len(Math.max(dx, 0), Math.max(dy, 0), 0) - rr;
};

/** Half space: everything with dot(p - c, n) < 0 is inside. */
export const plane = (c, n) => {
  const m = len(n[0], n[1], n[2]) || 1;
  return (p) => ((p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1] + (p[2] - c[2]) * n[2]) / m;
};

// ------------------------------------------------------------ operators ----
export const smin = (a, b, k) => {
  if (k <= 0 || !isFinite(a) || !isFinite(b)) return Math.min(a, b);
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
};
export const smax = (a, b, k) => -smin(-a, -b, k);

export const union = (...fs) => (p) => { let d = Infinity; for (const f of fs) { const v = f(p); if (v < d) d = v; } return d; };
export const sunion = (k, ...fs) => (p) => { let d = Infinity; for (const f of fs) d = smin(d, f(p), k); return d; };
export const cut = (f, g, k = 0) => (p) => smax(f(p), -g(p), k);
export const intersect = (f, g, k = 0) => (p) => smax(f(p), g(p), k);
export const offset = (f, r) => (p) => f(p) - r;

/** Rotate the sampling point about an axis through `c` (so the shape turns the other way). */
export const rotate = (f, c, axis, deg) => {
  const a = (deg * Math.PI) / 180, s = Math.sin(-a), co = Math.cos(-a);
  return (p) => {
    const x = p[0] - c[0], y = p[1] - c[1], z = p[2] - c[2];
    let q;
    if (axis === 'x') q = [x, y * co - z * s, y * s + z * co];
    else if (axis === 'y') q = [x * co + z * s, y, -x * s + z * co];
    else q = [x * co - y * s, x * s + y * co, z];
    q[0] += c[0]; q[1] += c[1]; q[2] += c[2];
    return f(q);
  };
};

export const mirrorX = (f) => (p) => f([-p[0], p[1], p[2]]);
export const translate = (f, t) => (p) => f([p[0] - t[0], p[1] - t[1], p[2] - t[2]]);

/** Add a displacement function to the surface (negative = bulge outwards). */
export const displace = (f, fn) => (p) => f(p) + fn(p);

// ---------------------------------------------------------------- noise ----
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * (3 - 2 * t);

/** Value noise in [0, 1]. */
export function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), fx), l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), fx), fy),
    l(l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), fx), l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), fx), fy),
    fz);
}

export function fbm(x, y, z, oct = 3) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f + 17.3 * i, y * f - 9.1 * i, z * f + 3.7 * i); a *= 0.5; f *= 2.1; }
  return s;
}

/**
 * Worley / cellular noise: nearest feature point. Returns { d, id, cx, cy, cz }
 * with d the distance to the nearest jittered point and id a stable hash for it.
 */
export function worley(x, y, z, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let best = Infinity, id = 0, cx = 0, cy = 0, cz = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const gx = ix + dx, gy = iy + dy, gz = iz + dz;
    const px = gx + hash3(gx + seed, gy, gz), py = gy + hash3(gx, gy + seed, gz + 5), pz = gz + hash3(gx + 9, gy, gz + seed);
    const d = len(px - x, py - y, pz - z);
    if (d < best) { best = d; id = hash3(gx + 31 + seed, gy + 7, gz + 13); cx = px; cy = py; cz = pz; }
  }
  return { d: best, id, cx, cy, cz };
}

export const mix = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a || 1e-9), 0, 1); return t * t * (3 - 2 * t); };
export { clamp, len };

/** Hex colour to [r, g, b] in 0..1. */
export function rgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export const mixRgb = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
