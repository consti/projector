// The red sumo: a big flat-faced block of a head under a black helmet of a
// bob with a straight fringe and a topknot, white face paint, a great belly
// over a narrow band of blue shorts, thick arms hugging the body down to the
// fists, short legs, orange trainers. Proportions measured off the photos:
// the head is two fifths of him.
import { ellipsoid, capsule, rbox, sphere, plane, intersect, cut, sunion, rotate, rgb, clamp, smoothstep, mix } from './sdf.mjs';

const RED = rgb('#c4342b');
const DARK_RED = rgb('#7e1d18');
const BLUE = rgb('#1f7f9c');
const ORANGE = rgb('#f28a1c');
const BLACK = rgb('#1b1a19');
const WHITE = rgb('#f4f2ec');
const CREAM = rgb('#efe6d4');

/** 2D distance from (x, y) to the segment a-b. */
function seg(x, y, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, wx = x - ax, wy = y - ay;
  const t = clamp((vx * wx + vy * wy) / (vx * vx + vy * vy || 1e-9), 0, 1);
  return Math.hypot(wx - vx * t, wy - vy * t);
}

// the head proper: a rounded block with a domed crown; the hair is an offset of it
const headCore = sunion(0.06, rbox([0, 0.77, 0.06], [0.2, 0.18, 0.155], 0.09), sphere([0, 0.78, 0.03], 0.175));
// the hem of the hair: a straight fringe over the forehead, sloping down behind
// the ears to the shoulders at the back, with scalloped strands
const hem = (p) => mix(0.585 + 0.012 * Math.cos(p[0] * 42), 0.845, smoothstep(-0.12, 0.12, p[2]));
const belowHem = (p) => p[1] - hem(p);
// the hair hugs the head: flush with the forehead, a little proud at the sides and on top
const hairCap = cut(sunion(0.05, rbox([0, 0.79, 0.04], [0.22, 0.19, 0.185], 0.1), sphere([0, 0.79, 0.03], 0.195)), belowHem, 0.01);
const hairBell = cut(intersect(ellipsoid([0, 0.7, -0.05], [0.245, 0.17, 0.17]), plane([0, 0, 0.04], [0, 0, 1]), 0.02), belowHem, 0.01);

const torso = sunion(0.08,
  ellipsoid([0, 0.53, -0.01], [0.33, 0.12, 0.2]),      // shoulders and chest
  ellipsoid([0, 0.45, 0.05], [0.3, 0.18, 0.25]),       // the belly, forward
  ellipsoid([0, 0.5, -0.06], [0.29, 0.2, 0.18]),       // a round back
);
const shoe = (sx) => rotate((p) => Math.min(
  rbox([sx * 0.19, 0.07, 0.08], [0.095, 0.07, 0.165], 0.055)(p),
  sphere([sx * 0.19, 0.075, 0.235], 0.085)(p),
), [sx * 0.19, 0, 0.05], 'y', sx * -10);

const parts = [
  { name: 'shoeL', sdf: shoe(-1), color: ORANGE, bone: 'legL', k: 0 },
  { name: 'shoeR', sdf: shoe(1), color: ORANGE, bone: 'legR', k: 0 },
  { name: 'legL', sdf: capsule([-0.145, 0.06, 0.02], [-0.145, 0.3, 0.02], 0.085), color: RED, bone: 'legL', k: 0.015 },
  { name: 'legR', sdf: capsule([0.145, 0.06, 0.02], [0.145, 0.3, 0.02], 0.085), color: RED, bone: 'legR', k: 0.015 },
  { name: 'shorts', sdf: rbox([0, 0.27, 0.0], [0.275, 0.08, 0.215], 0.07), color: BLUE, bone: 'body', k: 0.02 },
  { name: 'crotch', sdf: rbox([0, 0.18, 0], [0.03, 0.055, 0.3], 0.012), op: 'cut', k: 0.01 },
  { name: 'torso', sdf: torso, color: RED, bone: 'body', k: 0.05 },
  { name: 'pecL', sdf: ellipsoid([-0.12, 0.54, 0.17], [0.11, 0.06, 0.06]), color: RED, bone: 'body', k: 0.05 },
  { name: 'pecR', sdf: ellipsoid([0.12, 0.54, 0.17], [0.11, 0.06, 0.06]), color: RED, bone: 'body', k: 0.05 },
  { name: 'shoulderL', sdf: sphere([-0.27, 0.56, -0.01], 0.09), color: RED, bone: 'body', k: 0.07 },
  { name: 'shoulderR', sdf: sphere([0.27, 0.56, -0.01], 0.09), color: RED, bone: 'body', k: 0.07 },
  { name: 'armL', sdf: capsule([-0.3, 0.57, -0.02], [-0.325, 0.36, 0.02], [0.088, 0.078]), color: RED, bone: 'armL', k: 0.06 },
  { name: 'armR', sdf: capsule([0.3, 0.57, -0.02], [0.325, 0.36, 0.02], [0.088, 0.078]), color: RED, bone: 'armR', k: 0.06 },
  { name: 'forearmL', sdf: capsule([-0.325, 0.36, 0.02], [-0.33, 0.25, 0.09], [0.078, 0.07]), color: RED, bone: 'armL', k: 0.03 },
  { name: 'forearmR', sdf: capsule([0.325, 0.36, 0.02], [0.33, 0.25, 0.09], [0.078, 0.07]), color: RED, bone: 'armR', k: 0.03 },
  { name: 'fistL', sdf: ellipsoid([-0.33, 0.235, 0.11], [0.075, 0.08, 0.085]), color: RED, bone: 'armL', k: 0.03 },
  { name: 'fistR', sdf: ellipsoid([0.33, 0.235, 0.11], [0.075, 0.08, 0.085]), color: RED, bone: 'armR', k: 0.03 },
  { name: 'head', sdf: headCore, color: RED, bone: 'head', k: 0.04 },
  { name: 'jaw', sdf: ellipsoid([0, 0.64, 0.09], [0.21, 0.09, 0.15]), color: RED, bone: 'head', k: 0.05 },
  { name: 'earL', sdf: ellipsoid([-0.225, 0.74, 0.05], [0.035, 0.07, 0.05]), color: RED, bone: 'head', k: 0.015 },
  { name: 'earR', sdf: ellipsoid([0.225, 0.74, 0.05], [0.035, 0.07, 0.05]), color: RED, bone: 'head', k: 0.015 },
  { name: 'nose', sdf: ellipsoid([0, 0.705, 0.205], [0.05, 0.045, 0.045]), color: RED, bone: 'head', k: 0.02 },
  { name: 'hairCap', sdf: hairCap, color: BLACK, bone: 'head', k: 0.01 },
  { name: 'hairBell', sdf: hairBell, color: BLACK, bone: 'head', k: 0.03 },
  { name: 'knot', sdf: capsule([0, 0.945, -0.03], [0, 1.015, -0.045], [0.04, 0.032]), color: BLACK, bone: 'head', k: 0.015 },
  { name: 'knotL', sdf: sphere([-0.022, 1.025, -0.048], 0.024), color: BLACK, bone: 'head', k: 0.012 },
  { name: 'knotR', sdf: sphere([0.022, 1.025, -0.048], 0.024), color: BLACK, bone: 'head', k: 0.012 },
];

function paint(p, n, col, part) {
  const [x, y, z] = p;
  const front = n[2] > 0.3;
  if (part.name === 'shoeL' || part.name === 'shoeR') {
    if (z < -0.05 && n[2] < -0.2) return CREAM;                // the heel tab
    return col;
  }
  if (part.name === 'hairCap') {
    // the crescent of sheen across the front of the hair, thick in the middle
    const w = 0.012 * Math.max(0, 1 - (x / 0.18) * (x / 0.18));
    if (z > 0.07 && Math.abs(x) < 0.18 && Math.abs(y - (0.905 + 0.025 * Math.cos(x * 8))) < w) return WHITE;
    return col;
  }
  if (part.name === 'torso' || part.name === 'pecL' || part.name === 'pecR') {
    if (front) {
      if (Math.hypot(x - 0.115, y - 0.535) < 0.013 || Math.hypot(x + 0.115, y - 0.535) < 0.013) return DARK_RED;
      if (Math.hypot(x, y - 0.42) < 0.011) return DARK_RED;    // the navel
    }
    return col;
  }
  if (front && (part.name === 'head' || part.name === 'jaw' || part.name === 'nose')) {
    // long closed eyes, a wide flat mouth
    if (seg(x, y, -0.16, 0.78, -0.055, 0.79) < 0.008 || seg(x, y, 0.055, 0.79, 0.16, 0.78) < 0.008) return BLACK;
    if (seg(x, y, -0.055, 0.605, 0.055, 0.605) < 0.008) return BLACK;
    // three white bars between the eyes, down the bridge of the nose
    for (const yy of [0.80, 0.765, 0.73]) if (Math.abs(x) < 0.045 && Math.abs(y - yy) < 0.0075) return WHITE;
    // two vertical strokes on the left cheek, three bars on the right
    if (seg(x, y, -0.165, 0.60, -0.16, 0.715) < 0.006 || seg(x, y, -0.125, 0.60, -0.12, 0.715) < 0.006) return WHITE;
    for (const yy of [0.71, 0.675, 0.64]) if (seg(x, y, 0.085, yy, 0.175, yy + 0.004) < 0.0065) return WHITE;
  }
  return col;
}

export const sumo = {
  name: 'sumo',
  height: 1.03,
  footprint: 0.75,
  bounds: [[-0.5, -0.02, -0.4], [0.5, 1.08, 0.45]],
  bones: { head: [0, 0.6, 0.02], armL: [-0.28, 0.57, 0], armR: [0.28, 0.57, 0], legL: [-0.145, 0.32, 0], legR: [0.145, 0.32, 0] },
  skinBlend: 0.1,
  parts,
  paint,
};
