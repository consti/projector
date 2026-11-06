// The alpaca: a cloud of cream wool with a round head, bead eyes, a felt
// muzzle with the little Y of a mouth, dark ear tips and brown hooves.
import { ellipsoid, capsule, cylinder, sphere, rotate, displace, sunion, worley, vnoise, rgb, mixRgb, clamp, smoothstep } from './sdf.mjs';

const WOOL = rgb('#f3eee4');
const WOOL_DEEP = rgb('#d9d0bf');
const FELT = rgb('#ebe4d6');
const BLACK = rgb('#1d1a18');
const EAR = rgb('#5a463a');
const HOOF = rgb('#6b4a36');

/** Curly wool: round bumps at cellular feature points, two sizes. */
function curl(p) {
  const a = worley(p[0] * 16, p[1] * 16, p[2] * 16, 3).d;
  const b = worley(p[0] * 34 + 5, p[1] * 34, p[2] * 34, 7).d;
  const big = Math.pow(clamp(1 - a, 0, 1), 1.4), small = Math.pow(clamp(1 - b, 0, 1), 1.8);
  // the wool thins out over the face so the eyes and muzzle sit in it, not under it
  const face = 1 - 0.7 * smoothstep(0.26, 0.12, Math.hypot(p[0] * 0.8, p[1] - 0.77, (p[2] - 0.3) * 1.5));
  return (big * 0.03 + small * 0.012 + (vnoise(p[0] * 40, p[1] * 40, p[2] * 40) - 0.5) * 0.005) * face;
}
const fluffy = (f) => displace(f, (p) => -curl(p));

function seg(x, y, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, wx = x - ax, wy = y - ay;
  const t = clamp((vx * wx + vy * wy) / (vx * vx + vy * vy || 1e-9), 0, 1);
  return Math.hypot(wx - vx * t, wy - vy * t);
}

// the wool is one smooth mass before the curls go on, so the curls run over the joins
const wool = fluffy(sunion(0.14,
  ellipsoid([0, 0.34, -0.14], [0.27, 0.32, 0.42]),
  capsule([0, 0.36, 0.05], [0, 0.7, 0.09], 0.21),
  ellipsoid([0, 0.82, 0.1], [0.22, 0.2, 0.21]),
));
// the wool colour sits deeper in the valleys between curls
const woolColor = (p) => mixRgb(WOOL_DEEP, WOOL, smoothstep(0.005, 0.03, curl(p)));

const hoof = (x, z) => cylinder([x, 0.03, z], 0.05, 0.034, 0.012);
const leg = (x, z) => capsule([x, 0.03, z], [x, 0.12, z], 0.052);

const parts = [
  { name: 'woolBody', sdf: wool, color: woolColor, bone: 'body', k: 0 },
  { name: 'head', sdf: fluffy(ellipsoid([0, 0.82, 0.1], [0.22, 0.2, 0.21])), color: woolColor, bone: 'head', k: 0.02 },
  { name: 'muzzle', sdf: ellipsoid([0, 0.73, 0.3], [0.095, 0.085, 0.08]), color: FELT, bone: 'head', k: 0.05 },
  { name: 'eyeL', sdf: sphere([-0.085, 0.8, 0.315], 0.027), color: BLACK, bone: 'head', k: 0.004 },
  { name: 'eyeR', sdf: sphere([0.085, 0.8, 0.315], 0.027), color: BLACK, bone: 'head', k: 0.004 },
  { name: 'earL', sdf: rotate(ellipsoid([-0.1, 1.04, 0.02], [0.038, 0.075, 0.028]), [-0.1, 0.98, 0.02], 'z', 18), color: EAR, bone: 'earL', k: 0.02 },
  { name: 'earR', sdf: rotate(ellipsoid([0.1, 1.04, 0.02], [0.038, 0.075, 0.028]), [0.1, 0.98, 0.02], 'z', -18), color: EAR, bone: 'earR', k: 0.02 },
  { name: 'legFL', sdf: leg(-0.11, 0.14), color: WOOL, bone: 'legL', k: 0.03 },
  { name: 'legFR', sdf: leg(0.11, 0.14), color: WOOL, bone: 'legR', k: 0.03 },
  { name: 'legBL', sdf: leg(-0.12, -0.38), color: WOOL, bone: 'body', k: 0.03 },
  { name: 'legBR', sdf: leg(0.12, -0.38), color: WOOL, bone: 'body', k: 0.03 },
  { name: 'hoofFL', sdf: hoof(-0.11, 0.14), color: HOOF, bone: 'legL', k: 0.008 },
  { name: 'hoofFR', sdf: hoof(0.11, 0.14), color: HOOF, bone: 'legR', k: 0.008 },
  { name: 'hoofBL', sdf: hoof(-0.12, -0.38), color: HOOF, bone: 'body', k: 0.008 },
  { name: 'hoofBR', sdf: hoof(0.12, -0.38), color: HOOF, bone: 'body', k: 0.008 },
];

function paint(p, n, col, part) {
  const [x, y, z] = p;
  if (part.name === 'muzzle' && n[2] > 0.2) {
    // nose, the line down from it, and a gently smiling mouth
    if (Math.hypot(x / 0.022, (y - 0.772) / 0.014) < 1) return BLACK;
    if (seg(x, y, 0, 0.772, 0, 0.722) < 0.006) return BLACK;
    if (seg(x, y, -0.05, 0.73, 0, 0.72) < 0.006 || seg(x, y, 0, 0.72, 0.05, 0.73) < 0.006) return BLACK;
  }
  return col;
}

export const alpaca = {
  name: 'alpaca',
  height: 1.08,
  footprint: 0.6,
  bounds: [[-0.4, -0.02, -0.64], [0.4, 1.14, 0.45]],
  bones: { head: [0, 0.66, 0.08], legL: [-0.11, 0.25, 0.14], legR: [0.11, 0.25, 0.14], earL: [-0.1, 0.95, 0.02], earR: [0.1, 0.95, 0.02] },
  skinBlend: 0.1,
  aoStep: 0.025,
  aoGain: 7,
  parts,
  paint,
};
