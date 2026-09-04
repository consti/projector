// Shared building blocks for effects: parameter-schema shorthands, palettes,
// and the GLSL every "solid object on a wall" effect wants — sphere impostor
// shading, contact shadows and a soft radial falloff.

import { hexRgb } from '../glu.mjs';

export const R = (key, label, def, min, max, step = 0.01, extra = {}) =>
  ({ key, label, type: 'range', def, min, max, step, ...extra });
export const B = (key, label, def = false) => ({ key, label, type: 'bool', def: !!def });
export const C = (key, label, def) => ({ key, label, type: 'color', def });
export const S = (key, label, def, options) => ({ key, label, type: 'select', def, options });
export const T = (key, label, def) => ({ key, label, type: 'text', def });

export const PALETTES = {
  neon: ['#ff2d95', '#00e5ff', '#ffe600', '#7cff00', '#b14bff'],
  ember: ['#ff6a00', '#ff2d00', '#ffb300', '#ff8f3f', '#ffd98a'],
  ocean: ['#00b4ff', '#0066ff', '#00ffd0', '#8ad8ff', '#0b3d91'],
  candy: ['#ff9ecb', '#ffd166', '#8ef6e4', '#c3a7ff', '#ff6b6b'],
  mono: ['#ffffff', '#d9dee6', '#b6bfcc', '#8e99a8', '#ffffff'],
  forest: ['#3fbf6f', '#1f8a4c', '#a8e063', '#0f5132', '#d7f5a4'],
  gold: ['#ffd977', '#ffb648', '#fff3c4', '#e09b16', '#fff'],
};

export const PALETTE_OPTIONS = Object.keys(PALETTES).map((k) => [k, k[0].toUpperCase() + k.slice(1)]);

const _c = [0, 0, 0];
export function paletteColor(name, rng, out = [0, 0, 0]) {
  const p = PALETTES[name] || PALETTES.neon;
  hexRgb(p[(rng.next() * p.length) | 0], _c);
  out[0] = _c[0]; out[1] = _c[1]; out[2] = _c[2];
  return out;
}

/** Simple exponential emitter: returns how many to spawn this step. */
export class Emitter {
  constructor() { this.acc = 0; }
  tick(dt, rate) {
    this.acc += dt * rate;
    const n = Math.floor(this.acc);
    this.acc -= n;
    return n;
  }
}

// --------------------------------------------------------------------- GLSL
export const GLSL_SPHERE = `
// Screen-space sphere impostor. vLocal is the -1..1 quad coordinate.
struct Sphere { vec3 n; float mask; float edge; };
Sphere sphereAt(vec2 local){
  Sphere s;
  float r2 = dot(local, local);
  s.mask = 1.0 - smoothstep(0.94, 1.0, r2);
  float z = sqrt(max(0.0, 1.0 - r2));
  s.n = vec3(local, z);
  s.edge = 1.0 - z;
  return s;
}
vec3 shadeSolid(vec3 n, vec3 albedo, vec3 lightDir, float rough, float ambient){
  float diff = max(dot(n, lightDir), 0.0);
  float wrap = max(0.0, (dot(n, lightDir) + 0.35) / 1.35);
  vec3 h = normalize(lightDir + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, h), 0.0), mix(160.0, 8.0, rough));
  float rim = pow(1.0 - max(n.z, 0.0), 3.0);
  return albedo * (ambient + 0.85 * mix(diff, wrap, 0.5)) + vec3(spec) * (1.0 - rough) * 1.4 + albedo * rim * 0.35;
}`;

export const GLSL_SOFT = `
float softDisc(vec2 local, float hard){
  float r = length(local);
  return 1.0 - smoothstep(hard, 1.0, r);
}`;

export function lightDir(angleDeg, out = [0, 0]) {
  const a = (angleDeg * Math.PI) / 180;
  out[0] = Math.cos(a); out[1] = Math.sin(a);
  return out;
}

/** Spawn positions along the top edge, or from a chosen zone. */
export function spawnPoint(rng, zone, aspect, out = [0, 0]) {
  switch (zone) {
    case 'top': out[0] = rng.range(0.02, 0.98); out[1] = -0.03 - rng.next() * 0.08; break;
    case 'left': out[0] = -0.03; out[1] = rng.range(0, aspect); break;
    case 'right': out[0] = 1.03; out[1] = rng.range(0, aspect); break;
    case 'bottom': out[0] = rng.range(0.02, 0.98); out[1] = aspect + 0.03; break;
    case 'centre': out[0] = 0.5 + rng.gauss() * 0.06; out[1] = aspect * 0.5 + rng.gauss() * 0.06; break;
    case 'everywhere': out[0] = rng.next(); out[1] = rng.next() * aspect; break;
    default: out[0] = rng.range(0.02, 0.98); out[1] = -0.05; break;
  }
  return out;
}

export const ZONES = [['top', 'Top'], ['left', 'Left'], ['right', 'Right'],
  ['bottom', 'Bottom'], ['centre', 'Centre'], ['everywhere', 'Everywhere']];
