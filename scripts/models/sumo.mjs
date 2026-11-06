// The red sumo: a square head under a black bob with a topknot, white face
// paint, a great belly over blue shorts, arms hanging to fists, orange
// trainers.
import { ellipsoid, capsule, rbox, sphere, plane, intersect, cut, rgb, clamp } from './sdf.mjs';

const RED = rgb('#c4342b');
const DARK_RED = rgb('#7e1d18');
const BLUE = rgb('#1f7f9c');
const ORANGE = rgb('#f28a1c');
const BLACK = rgb('#1b1a19');
const WHITE = rgb('#f2f0ea');
const CREAM = rgb('#efe6d4');

/** 2D distance from (x, y) to the segment a-b. */
function seg(x, y, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, wx = x - ax, wy = y - ay;
  const t = clamp((vx * wx + vy * wy) / (vx * vx + vy * vy || 1e-9), 0, 1);
  return Math.hypot(wx - vx * t, wy - vy * t);
}

const shoe = (sx) => (p) => Math.min(
  rbox([sx * 0.17, 0.058, 0.04], [0.095, 0.058, 0.16], 0.05)(p),
  sphere([sx * 0.17, 0.065, 0.175], 0.08)(p),
);
// the hair: a cap above the fringe line, and a bob down the back and sides with a scalloped hem
const hairCap = intersect(sphere([0, 0.815, -0.01], 0.228), plane([0, 0.895, 0], [0, -1, 0]), 0.01);
const hairBack = cut(
  intersect(rbox([0, 0.78, -0.12], [0.235, 0.16, 0.11], 0.06), sphere([0, 0.78, -0.04], 0.3), 0.02),
  (p) => (0.635 + 0.014 * Math.cos(p[0] * 42)) - p[1],
  0.008,
);

const parts = [
  { name: 'shoeL', sdf: shoe(-1), color: ORANGE, bone: 'legL', k: 0 },
  { name: 'shoeR', sdf: shoe(1), color: ORANGE, bone: 'legR', k: 0 },
  { name: 'legL', sdf: capsule([-0.155, 0.06, 0.0], [-0.155, 0.3, 0.0], 0.09), color: RED, bone: 'legL', k: 0.015 },
  { name: 'legR', sdf: capsule([0.155, 0.06, 0.0], [0.155, 0.3, 0.0], 0.09), color: RED, bone: 'legR', k: 0.015 },
  { name: 'shorts', sdf: rbox([0, 0.31, 0.0], [0.27, 0.1, 0.2], 0.09), color: BLUE, bone: 'body', k: 0.02 },
  { name: 'crotch', sdf: rbox([0, 0.19, 0], [0.035, 0.07, 0.3], 0.02), op: 'cut', k: 0.01 },
  { name: 'belly', sdf: ellipsoid([0, 0.5, 0.03], [0.3, 0.22, 0.26]), color: RED, bone: 'body', k: 0.05 },
  { name: 'chest', sdf: ellipsoid([0, 0.63, 0.0], [0.31, 0.14, 0.22]), color: RED, bone: 'body', k: 0.06 },
  { name: 'armL', sdf: capsule([-0.29, 0.67, -0.01], [-0.33, 0.36, 0.05], [0.095, 0.082]), color: RED, bone: 'armL', k: 0.05 },
  { name: 'armR', sdf: capsule([0.29, 0.67, -0.01], [0.33, 0.36, 0.05], [0.095, 0.082]), color: RED, bone: 'armR', k: 0.05 },
  { name: 'fistL', sdf: ellipsoid([-0.33, 0.3, 0.07], [0.085, 0.095, 0.09]), color: RED, bone: 'armL', k: 0.03 },
  { name: 'fistR', sdf: ellipsoid([0.33, 0.3, 0.07], [0.085, 0.095, 0.09]), color: RED, bone: 'armR', k: 0.03 },
  { name: 'head', sdf: rbox([0, 0.79, 0.02], [0.2, 0.16, 0.16], 0.1), color: RED, bone: 'head', k: 0.04 },
  { name: 'jaw', sdf: ellipsoid([0, 0.7, 0.06], [0.21, 0.1, 0.16]), color: RED, bone: 'head', k: 0.05 },
  { name: 'earL', sdf: ellipsoid([-0.225, 0.77, 0.0], [0.04, 0.07, 0.05]), color: RED, bone: 'head', k: 0.02 },
  { name: 'earR', sdf: ellipsoid([0.225, 0.77, 0.0], [0.04, 0.07, 0.05]), color: RED, bone: 'head', k: 0.02 },
  { name: 'nose', sdf: ellipsoid([0, 0.75, 0.17], [0.045, 0.045, 0.045]), color: RED, bone: 'head', k: 0.025 },
  { name: 'hairCap', sdf: hairCap, color: BLACK, bone: 'head', k: 0.01 },
  { name: 'hairBack', sdf: hairBack, color: BLACK, bone: 'head', k: 0.012 },
  { name: 'knot', sdf: capsule([0, 1.0, -0.04], [0, 1.07, -0.06], [0.036, 0.028]), color: BLACK, bone: 'head', k: 0.015 },
  { name: 'knotL', sdf: sphere([-0.021, 1.085, -0.06], 0.023), color: BLACK, bone: 'head', k: 0.012 },
  { name: 'knotR', sdf: sphere([0.021, 1.085, -0.06], 0.023), color: BLACK, bone: 'head', k: 0.012 },
];

function paint(p, n, col, part) {
  const [x, y, z] = p;
  const front = n[2] > 0.3;
  if (part.name === 'shoeL' || part.name === 'shoeR') {
    if (z < -0.07 && n[2] < -0.2) return CREAM;                // the heel tab
    return col;
  }
  if (part.name === 'hairCap') {
    // the white sheen across the front of the cap
    if (z > 0.04 && Math.abs(x) < 0.2 && Math.abs(y - (0.955 + 0.03 * Math.cos(x * 7))) < 0.012) return WHITE;
    return col;
  }
  if (part.name === 'belly' || part.name === 'chest') {
    if (front) {
      if (Math.hypot(x - 0.12, y - 0.6) < 0.015 || Math.hypot(x + 0.12, y - 0.6) < 0.015) return DARK_RED;
      if (Math.hypot(x, y - 0.49) < 0.012) return DARK_RED;
    }
    return col;
  }
  if (front && (part.name === 'head' || part.name === 'jaw' || part.name === 'nose')) {
    // closed eyes and a flat mouth
    if (seg(x, y, -0.15, 0.815, -0.065, 0.815) < 0.0085 || seg(x, y, 0.065, 0.815, 0.15, 0.815) < 0.0085) return BLACK;
    if (seg(x, y, -0.05, 0.675, 0.05, 0.675) < 0.0085) return BLACK;
    // three white bars down the bridge of the nose
    for (const yy of [0.85, 0.82, 0.79]) if (Math.abs(x) < 0.04 && Math.abs(y - yy) < 0.0085) return WHITE;
    // two vertical strokes on the left cheek, three bars on the right
    if (seg(x, y, -0.155, 0.69, -0.15, 0.78) < 0.007 || seg(x, y, -0.12, 0.675, -0.115, 0.775) < 0.007) return WHITE;
    for (const yy of [0.76, 0.728, 0.696]) if (seg(x, y, 0.095, yy, 0.165, yy + 0.004) < 0.0075) return WHITE;
  }
  return col;
}

export const sumo = {
  name: 'sumo',
  height: 1.11,
  footprint: 0.8,
  bounds: [[-0.5, -0.02, -0.4], [0.5, 1.14, 0.4]],
  bones: { head: [0, 0.68, 0.0], armL: [-0.3, 0.66, 0], armR: [0.3, 0.66, 0], legL: [-0.155, 0.32, 0], legR: [0.155, 0.32, 0] },
  skinBlend: 0.1,
  parts,
  paint,
};
