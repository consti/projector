// The yellow leopard: a pear of a body with a broad head, folded arms, flat
// feet with claws, and hand-painted rosettes. Smug closed eyes, whiskers.
import { ellipsoid, capsule, rotate, vnoise, rgb, mixRgb, clamp, smoothstep, len } from './sdf.mjs';

const YELLOW = rgb('#f4b228');
const BLACK = rgb('#1a1612');
const BROWN = rgb('#8a4a16');
const WHITE = rgb('#f6f3ea');

const hash = (v) => { const s = Math.sin(v * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/**
 * Rosettes in the tangent plane: cellular noise where each feature point near
 * the surface paints one spot at full size, sliced neither thin nor fat.
 * Returns 0 (no spot), 1 (black ring / blob) or 2 (brown core).
 */
function spot(p, n, freq, seed) {
  const x = p[0] * freq, y = p[1] * freq, z = p[2] * freq;
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let out = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const gx = ix + dx, gy = iy + dy, gz = iz + dz;
    const id = hash(gx * 7.13 + gy * 31.7 + gz * 113.9 + seed);
    if (id < 0.22) continue;                                   // an empty cell now and then
    const cx = gx + hash(id * 17.1 + 1), cy = gy + hash(id * 23.3 + 2), cz = gz + hash(id * 29.7 + 3);
    const rx = (cx - x) / freq, ry = (cy - y) / freq, rz = (cz - z) / freq;
    const along = rx * n[0] + ry * n[1] + rz * n[2];
    if (Math.abs(along) > 0.075) continue;                     // not this layer of cells
    const tx = rx - n[0] * along, ty = ry - n[1] * along, tz = rz - n[2] * along;
    let d = len(tx, ty, tz);
    d += (vnoise(p[0] * 60 + id * 9, p[1] * 60, p[2] * 60) - 0.5) * 0.02;   // hand-painted wobble
    const kind = hash(id * 51.3 + 4);
    const R = 0.02 + 0.018 * hash(id * 3.7 + 5);
    if (kind < 0.45) {                                         // rosette: thin black ring, a brown core on the big ones
      if (d < R - 0.009) { if (R > 0.03) out = Math.max(out, 2); }
      else if (d < R) out = Math.max(out, 1);
    } else if (kind < 0.8) {                                   // solid blob, now and then with a brown fleck
      if (d < R * 0.65) out = Math.max(out, d < R * 0.22 && hash(id * 9.1) < 0.35 ? 2 : 1);
    } else {                                                   // a C: ring with a gap
      const ang = Math.atan2(ty * (1 - Math.abs(n[1])) + tz * n[1], tx);
      const gap = hash(id * 13.7 + 6) * Math.PI * 2;
      const da = Math.abs(((ang - gap + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
      if (d < R && d > R - 0.01 && da > 1.0) out = Math.max(out, 1);
    }
  }
  return out;
}

/** 2D distance from (x, y) to the segment a-b. */
function seg(x, y, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, wx = x - ax, wy = y - ay;
  const t = clamp((vx * wx + vy * wy) / (vx * vx + vy * vy || 1e-9), 0, 1);
  return Math.hypot(wx - vx * t, wy - vy * t);
}

const parts = [
  { name: 'body', sdf: ellipsoid([0, 0.40, 0], [0.36, 0.33, 0.34]), color: YELLOW, bone: 'body', k: 0 },
  { name: 'head', sdf: ellipsoid([0, 0.72, 0.02], [0.33, 0.27, 0.31]), color: YELLOW, bone: 'head', k: 0.12 },
  { name: 'earL', sdf: rotate(ellipsoid([-0.27, 0.95, -0.02], [0.1, 0.1, 0.055]), [-0.27, 0.95, -0.02], 'z', 25), color: YELLOW, bone: 'earL', k: 0.035 },
  { name: 'earR', sdf: rotate(ellipsoid([0.27, 0.95, -0.02], [0.1, 0.1, 0.055]), [0.27, 0.95, -0.02], 'z', -25), color: YELLOW, bone: 'earR', k: 0.035 },
  { name: 'browL', sdf: ellipsoid([-0.14, 0.75, 0.27], [0.12, 0.06, 0.06]), color: YELLOW, bone: 'head', k: 0.05 },
  { name: 'browR', sdf: ellipsoid([0.14, 0.75, 0.27], [0.12, 0.06, 0.06]), color: YELLOW, bone: 'head', k: 0.05 },
  { name: 'cheekL', sdf: ellipsoid([-0.11, 0.62, 0.27], [0.15, 0.1, 0.1]), color: YELLOW, bone: 'head', k: 0.04 },
  { name: 'cheekR', sdf: ellipsoid([0.11, 0.62, 0.27], [0.15, 0.1, 0.1]), color: YELLOW, bone: 'head', k: 0.04 },
  { name: 'chin', sdf: ellipsoid([0, 0.53, 0.25], [0.12, 0.07, 0.08]), color: YELLOW, bone: 'head', k: 0.05 },
  { name: 'armL', sdf: capsule([-0.32, 0.50, 0.17], [0.10, 0.42, 0.30], [0.1, 0.085]), color: YELLOW, bone: 'armL', k: 0.05 },
  { name: 'armR', sdf: capsule([0.32, 0.49, 0.17], [-0.10, 0.34, 0.30], [0.1, 0.085]), color: YELLOW, bone: 'armR', k: 0.05 },
  { name: 'footL', sdf: ellipsoid([-0.17, 0.065, 0.14], [0.15, 0.065, 0.21]), color: YELLOW, bone: 'legL', k: 0.05 },
  { name: 'footR', sdf: ellipsoid([0.17, 0.065, 0.14], [0.15, 0.065, 0.21]), color: YELLOW, bone: 'legR', k: 0.05 },
  { name: 'tail', sdf: capsule([0.0, 0.17, -0.27], [0.2, 0.3, -0.36], [0.065, 0.045]), color: YELLOW, bone: 'body', k: 0.05 },
];

function paint(p, n, col, part) {
  const [x, y, z] = p;
  const front = n[2] > 0.25;
  // inner ears: a black patch on the front face
  if (part.name === 'earL' || part.name === 'earR') {
    const ex = part.name === 'earL' ? -0.27 : 0.27;
    const d = Math.hypot((x - ex) / 0.065, (y - 0.95) / 0.07);
    if (front && d < 1) return mixRgb(BLACK, BROWN, smoothstep(0.4, 0.9, d) * 0.5);
  }
  // claws: three dark strokes on the top front of each foot
  if (part.name === 'footL' || part.name === 'footR') {
    const fx = part.name === 'footL' ? -0.17 : 0.17;
    if (n[1] > 0.2 && z > 0.2 && z < 0.37) {
      const u = x - fx;
      for (const o of [-0.058, 0, 0.058]) if (Math.abs(u - o) < 0.014) return BLACK;
    }
    return col;
  }
  // the face is spotless: the muzzle, cheeks and brows
  const face = z > 0.16 && y > 0.45 && y < 0.86 && Math.abs(x) < 0.3;
  if (!face) {
    const s = spot(p, n, 11, part.name === 'head' ? 3 : 1);
    if (s === 2) return BROWN;
    if (s === 1) return BLACK;
  }
  if (front) {
    // closed eyes: a white slit with a black lid line above, outer ends lower
    for (const sgn of [-1, 1]) {
      const ex = sgn * 0.14;
      const dw = seg(x, y, ex - sgn * 0.045, 0.775, ex + sgn * 0.05, 0.765);
      const dk = seg(x, y, ex - sgn * 0.05, 0.792, ex + sgn * 0.055, 0.778);
      if (dk < 0.009) return BLACK;
      if (dw < 0.008) return WHITE;
    }
    // nose and the mouth line
    if (Math.hypot(x / 0.028, (y - 0.655) / 0.017) < 1) return BLACK;
    if (seg(x, y, 0, 0.655, 0, 0.61) < 0.006) return BLACK;
    if (seg(x, y, 0, 0.61, -0.05, 0.595) < 0.006 || seg(x, y, 0, 0.61, 0.05, 0.595) < 0.006) return BLACK;
    // whiskers: three strokes fanning out on each cheek
    for (const sgn of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const y0 = 0.665 - i * 0.03, y1 = y0 + 0.02 - i * 0.02;
        if (seg(x, y, sgn * 0.07, y0, sgn * 0.21, y1) < 0.009) return WHITE;
      }
    }
  }
  return col;
}

export const leopard = {
  name: 'leopard',
  height: 1.05,
  footprint: 0.78,
  bounds: [[-0.48, -0.02, -0.48], [0.48, 1.1, 0.48]],
  bones: { head: [0, 0.58, 0.02], armL: [-0.3, 0.5, 0.15], armR: [0.3, 0.5, 0.15], legL: [-0.17, 0.1, 0], legR: [0.17, 0.1, 0], earL: [-0.22, 0.86, -0.02], earR: [0.22, 0.86, -0.02] },
  skinBlend: 0.1,
  parts,
  paint,
};
