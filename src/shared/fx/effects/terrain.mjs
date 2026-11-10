// Flying over a generated landscape. A tileable heightmap is built on the CPU
// (mountains, hills, dunes, a canyon, islands, mesas, a city, the moon) and
// drawn as a grid mesh that the camera flies across forever, as a wireframe,
// a shaded low-poly surface, both, a cloud of points or contour lines. The
// picture can be the sky, the ground texture, or the colour of the wires.
//
// The grid is snapped to the terrain cells, so the mesh never swims: the
// camera moves through a fixed lattice. Everything is periodic over one tile
// (1.0 world unit), so the camera position wraps and never loses precision.

import { R, B, C, S } from './common.mjs';
import { postEffect } from './post.mjs';
import { prog, bindTex, Target, hexRgb } from '../glu.mjs';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sat = (v) => clamp(v, 0, 1);
const sstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = (v) => v - Math.floor(v);
const lerp = (a, b, k) => a + (b - a) * k;

// ------------------------------------------------------------ heightmaps ---
const HM = 320;              // texels per tile

function ihash(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const GRAD = new Float32Array(512);
for (let i = 0; i < 256; i++) { GRAD[i * 2] = Math.cos((i / 256) * TAU); GRAD[i * 2 + 1] = Math.sin((i / 256) * TAU); }

/** Periodic gradient noise, -1..1-ish; `per` lattice cells per tile, x/y in tiles. */
function gnoise(x, y, per, s) {
  x *= per; y *= per;
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const X0 = ((ix % per) + per) % per, Y0 = ((iy % per) + per) % per, X1 = (X0 + 1) % per, Y1 = (Y0 + 1) % per;
  const g = (X, Y, dx, dy) => { const k = (ihash(X, Y, s) * 256) & 255; return GRAD[k * 2] * dx + GRAD[k * 2 + 1] * dy; };
  const a = g(X0, Y0, fx, fy), b = g(X1, Y0, fx - 1, fy), c = g(X0, Y1, fx, fy - 1), d = g(X1, Y1, fx - 1, fy - 1);
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 1.414;
}
function fbm(x, y, s, oct, per = 4, gain = 0.5) {
  let a = 1, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) { sum += a * gnoise(x, y, per, s + o * 77); norm += a; a *= gain; per *= 2; }
  return sum / norm;
}
function ridged(x, y, s, oct, per = 3) {
  let a = 0.5, sum = 0, w = 1;
  for (let o = 0; o < oct; o++) {
    let n = 1 - Math.abs(gnoise(x, y, per, s + o * 77));
    n = n * n * w;
    w = sat(n * 2);
    sum += n * a; a *= 0.5; per *= 2;
  }
  return sum;
}
const wrapD = (d) => d - Math.round(d);      // shortest periodic difference

const LANDS = {
  mountains(x, y, s) {
    const wx = 0.04 * fbm(x, y, s + 5, 2, 2), wy = 0.04 * fbm(x, y, s + 6, 2, 2);
    const r = ridged(x + wx, y + wy, s, 6, 3);
    return Math.pow(sat(r / 1.15), 1.35);
  },
  hills(x, y, s) {
    return 0.42 + 0.3 * fbm(x, y, s, 5, 3) + 0.03 * fbm(x, y, s + 1, 2, 16);
  },
  dunes(x, y, s) {
    const warp = 0.22 * fbm(x, y, s, 2, 2) + 0.06 * fbm(x, y, s + 9, 3, 6);
    const v = fract(y * 5 + warp);
    const slip = v < 0.72 ? v / 0.72 : (1 - v) / 0.28;
    const prof = v < 0.72 ? slip * slip * (2 - slip) : slip;
    const big = 0.7 + 0.3 * fbm(x, y, s + 3, 2, 2);
    return 0.33 + 0.3 * prof * big + 0.012 * fbm(x, y, s + 4, 2, 40);
  },
  canyon(x, y, s) {
    const plateau = 0.78 + 0.08 * fbm(x, y, s, 4, 4) - 0.05 * Math.abs(fbm(x, y, s + 8, 3, 8));
    const xc = 0.5 + 0.16 * Math.sin(y * TAU) + 0.07 * Math.sin(y * TAU * 2 + 1.3);
    const d = Math.abs(wrapD(x - xc));
    const w = 0.11 + 0.035 * fbm(x, y, s + 2, 2, 2);
    const t = sat((d - 0.012) / w);
    const k = 5, q = t * k;
    const tt = (Math.floor(q) + sstep(0.55, 1, q - Math.floor(q))) / k;
    return lerp(0.12, plateau, Math.min(1, tt));
  },
  islands(x, y, s) {
    const n = fbm(x, y, s, 6, 2);
    const r = ridged(x, y, s + 4, 4, 4);
    return sat(0.22 + 0.45 * n + 0.45 * r * sat(n + 0.4));
  },
  mesas(x, y, s) {
    const n = 0.5 + 0.35 * fbm(x, y, s, 5, 3);
    const k = 7, q = n * k;
    const h = (Math.floor(q) + sstep(0.7, 1, q - Math.floor(q))) / k;
    return 0.32 + 0.62 * sat(h - 0.1);
  },
  city(x, y, s) {
    const C = 24;
    const cx = Math.floor(x * C), cy = Math.floor(y * C);
    const fx = x * C - cx, fy = y * C - cy;
    const X = ((cx % C) + C) % C, Y = ((cy % C) + C) % C;
    if (fx < 0.14 || fx > 0.86 || fy < 0.14 || fy > 0.86) return 0.35;
    if (ihash(X, Y, s + 3) < 0.12) return 0.36;          // an empty lot
    const downtown = 0.5 + 0.5 * fbm(x, y, s + 1, 3, 2);
    const tall = Math.pow(ihash(X, Y, s), 2.2) * (0.25 + 0.75 * downtown * downtown);
    // a few blocks are two towers
    const split = ihash(X, Y, s + 7) < 0.25 && (fx > 0.47 && fx < 0.53);
    return split ? 0.36 : 0.38 + 0.6 * tall;
  },
  moon(x, y, s) {
    let h = 0.42 + 0.05 * fbm(x, y, s, 4, 3);
    const scales = [5, 11, 24];
    for (let k = 0; k < 3; k++) {
      const sc = scales[k];
      const cx = Math.floor(x * sc), cy = Math.floor(y * sc);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const gx = cx + i, gy = cy + j;
        const X = ((gx % sc) + sc) % sc, Y = ((gy % sc) + sc) % sc;
        if (ihash(X, Y, s + 11 + k) > 0.5) continue;
        const ox = (gx + 0.25 + 0.5 * ihash(X, Y, s + 21 + k)) / sc, oy = (gy + 0.25 + 0.5 * ihash(X, Y, s + 31 + k)) / sc;
        const r = (0.16 + 0.3 * ihash(X, Y, s + 41 + k)) / sc;
        const u = Math.hypot(x - ox, y - oy) / r;
        if (u > 1.5) continue;
        const depth = r * 0.9;
        if (u < 1) h -= depth * (1 - u * u) * 0.8;
        h += depth * 0.45 * Math.exp(-(u - 1) * (u - 1) * 9);
      }
    }
    return sat(h);
  },
};

export const LANDSCAPES = [
  ['mountains', 'Mountains'], ['hills', 'Hills'], ['dunes', 'Dunes'], ['canyon', 'Canyon'],
  ['islands', 'Islands'], ['mesas', 'Mesas'], ['city', 'City'], ['moon', 'Moon'],
];

/** Build one tile of heights, 0..1, as a wrapping HM x HM array. */
export function buildHeightmap(kind, seed) {
  const f = LANDS[kind] || LANDS.mountains;
  const out = new Float32Array(HM * HM);
  const s = (seed * 7919) | 0;
  for (let j = 0; j < HM; j++) {
    const y = (j + 0.5) / HM;
    for (let i = 0; i < HM; i++) out[j * HM + i] = sat(f((i + 0.5) / HM, y, s));
  }
  return out;
}

/** Bilinear height at a world position (tiles), mirroring the vertex shader. */
function heightAt(map, x, z) {
  const px = fract(x) * HM - 0.5, pz = fract(z) * HM - 0.5;
  const ix = Math.floor(px), iz = Math.floor(pz);
  const fx = px - ix, fz = pz - iz;
  const X0 = ((ix % HM) + HM) % HM, Z0 = ((iz % HM) + HM) % HM, X1 = (X0 + 1) % HM, Z1 = (Z0 + 1) % HM;
  const a = map[Z0 * HM + X0], b = map[Z0 * HM + X1], c = map[Z1 * HM + X0], d = map[Z1 * HM + X1];
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}

// ---------------------------------------------------------------- shaders ---
const TERRAIN_VS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
#include <common>
uniform ivec2 uGrid;          // cells across, cells deep
uniform vec2 uOrigin;         // world xz of vertex (0, 0), snapped to the lattice
uniform float uCell;
uniform float uHM;
uniform sampler2D uHeight;
uniform float uAmp;
uniform float uWater;
uniform vec3 uCam, uR, uU, uF;
uniform vec2 uTan;
uniform float uNear, uFar;
uniform float uZOff;          // pulls the wire pass towards the camera
uniform float uPointPx;
uniform float uSmooth;
uniform float uSkirt;         // tiles the outer rows stretch to, so the ground reaches the horizon
uniform vec2 uRes;
out vec3 vWorld; out vec3 vNrm; out float vH; out float vWater; out float vDist; out float vCellPx; out float vWall;
const float K = 10.0;         // rows and columns in the skirt
float stretch(float k){ return k <= 0.0 ? 0.0 : (pow(1.7, k) - 1.0) / 0.7 * uSkirt; }
vec3 toView(vec3 P){ vec3 d = P - uCam; return vec3(dot(d, uR), dot(d, uU), dot(d, uF)); }
vec2 toPix(vec3 v){ float z = max(v.z, 0.01); return vec2(v.x / uTan.x, v.y / uTan.y) / z * uRes * 0.5; }
float hAt(vec2 w){
  vec2 p = fract(w) * uHM - 0.5;
  vec2 i = floor(p); vec2 f = p - i;
  ivec2 I0 = ivec2(mod(i, uHM)); ivec2 I1 = ivec2(mod(i + 1.0, uHM));
  float a = texelFetch(uHeight, I0, 0).r, b = texelFetch(uHeight, ivec2(I1.x, I0.y), 0).r;
  float c = texelFetch(uHeight, ivec2(I0.x, I1.y), 0).r, d = texelFetch(uHeight, I1, 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main(){
  int W1 = uGrid.x + 1;
  int i = gl_VertexID % W1, j = gl_VertexID / W1;
  float fi = float(i), fj = float(j), W = float(uGrid.x), D = float(uGrid.y);
  // the inner grid is one lattice cell per step; the last rows and the outer columns stretch away
  float jz = min(fj, D - K) * uCell + stretch(fj - (D - K));
  float ix = clamp(fi, K, W - K) * uCell + stretch(fi - (W - K)) - stretch(K - fi);
  vec2 w = uOrigin + vec2(ix, jz);
  float h = hAt(w);
  vH = h; vWater = h < uWater ? 1.0 : 0.0;
  vec3 P = vec3(w.x, max(h, uWater) * uAmp, w.y);
  if (uSmooth > 0.5) {
    float e = uCell;
    float l = max(hAt(w - vec2(e, 0.0)), uWater), r = max(hAt(w + vec2(e, 0.0)), uWater);
    float d = max(hAt(w - vec2(0.0, e)), uWater), u = max(hAt(w + vec2(0.0, e)), uWater);
    vNrm = normalize(vec3((l - r) * uAmp, 2.0 * e, (d - u) * uAmp));
  } else vNrm = vec3(0.0, 1.0, 0.0);
  vWorld = P;
  vDist = length(P - uCam);
  vec3 v = toView(P);
  gl_Position = vec4(v.x / uTan.x, v.y / uTan.y, (v.z * (uFar + uNear) - 2.0 * uFar * uNear) / (uFar - uNear) - uZOff * v.z, v.z);
  // how big this cell is on screen: the nearer of the two neighbours, in pixels
  vec2 pix = toPix(v);
  vec3 Px = vec3(w.x + uCell, max(hAt(w + vec2(uCell, 0.0)), uWater) * uAmp, w.y);
  vec3 Pz = vec3(w.x, max(hAt(w + vec2(0.0, uCell)), uWater) * uAmp, w.y + uCell);
  vCellPx = min(length(toPix(toView(Px)) - pix), length(toPix(toView(Pz)) - pix));
  // a cell that climbs several cells' worth is a wall: its long edges would pile up as wires
  vWall = sat((max(abs(Px.y - P.y), abs(Pz.y - P.y)) / uCell - 1.5) * 0.4);
  gl_PointSize = clamp(vCellPx * uPointPx, 1.0, 18.0);
}`;

const TERRAIN_FS = `#version 300 es
precision highp float;
#include <common>
in vec3 vWorld; in vec3 vNrm; in float vH; in float vWater; in float vDist; in float vCellPx; in float vWall;
out vec4 o;
uniform int uPass;            // 0 solid, 1 lines, 2 points, 3 contours
uniform int uSurface;         // 0 by height, 1 the picture, 2 one colour
uniform float uFlat;
uniform float uWater;
uniform vec3 uLow, uHigh, uWaterCol, uWire, uSun, uSunCol, uAmb;
uniform float uSnow, uGlow, uFogK, uFarEdge;
uniform vec3 uCam;
uniform vec2 uRes;
uniform sampler2D uBg;
vec2 mirrorUV(vec2 uv){ return 1.0 - abs(fract(uv * 0.5) * 2.0 - 1.0); }
void main(){
  float fog = exp(-pow(vDist * uFogK, 2.0)) * (1.0 - smoothstep(uFarEdge * 0.78, uFarEdge, vDist));
  vec3 col;
  if (uPass == 1 || uPass == 2) {
    // wires dissolve as the cells shrink to a few pixels, or the distance turns solid
    fog *= smoothstep(1.5, 7.0, vCellPx) * (1.0 - 0.7 * vWall);
    col = uWire;
    if (uSurface == 1) col = texture(uBg, gl_FragCoord.xy / uRes).rgb * 1.6 + 0.04;
    if (vWater > 0.5) col = uWaterCol * 1.6;
    col *= 1.0 + uGlow;
    if (uPass == 2) {
      float r = length(gl_PointCoord - 0.5);
      if (r > 0.5) discard;
      fog *= 1.0 - smoothstep(0.25, 0.5, r);
    }
  } else {
    vec3 n = uFlat > 0.5 ? normalize(cross(dFdx(vWorld), dFdy(vWorld))) : normalize(vNrm);
    if (n.y < 0.0) n = -n;
    float t = sat((vH - uWater) / max(0.05, 1.0 - uWater));
    vec3 base;
    if (uSurface == 1) base = texture(uBg, mirrorUV(vWorld.xz)).rgb;
    else if (uSurface == 2) base = uLow;
    else {
      base = mix(uLow, uHigh, pow(t, 0.7));
      float slope = 1.0 - n.y;
      base *= 1.0 - 0.45 * smoothstep(0.3, 0.7, slope);
      base = mix(base, vec3(0.95), uSnow * smoothstep(0.78 - 0.3 * uSnow, 0.92, t) * smoothstep(0.3, 0.6, n.y));
    }
    vec3 V = normalize(uCam - vWorld);
    if (vWater > 0.5) {
      vec3 h = normalize(uSun + V);
      float spec = pow(max(h.y, 0.0), 160.0);
      float fr = pow(1.0 - max(V.y, 0.0), 3.0);
      col = uWaterCol * (uAmb * 1.3 + uSunCol * 0.45 * max(uSun.y, 0.0)) + mix(uAmb, uSunCol, 0.5) * fr * 0.5 + uSunCol * spec * 0.4;
    } else {
      float ndl = max(dot(n, uSun), 0.0);
      float wrap = max((dot(n, uSun) + 0.3) / 1.3, 0.0);
      col = base * (uAmb * (0.6 + 0.4 * n.y) + uSunCol * mix(ndl, wrap, 0.3));
    }
    if (uPass == 3) {
      float f = vH * 28.0;
      float d = abs(fract(f) - 0.5);
      float line = 1.0 - smoothstep(0.0, fwidth(f) * 1.4, 0.5 - d);
      vec3 fill = uSurface == 1 ? base * 0.3 : uLow * 0.18;
      col = mix(fill, uWire * (1.0 + uGlow), line);
      if (vWater > 0.5) col = uWaterCol * 0.3;
    }
  }
  o = vec4(col * fog, fog);
}`;

// the sky, with the landscape laid over it
const SKY_FS = `
uniform sampler2D uTerrain;
uniform vec3 uR, uU, uF;
uniform vec2 uTan;
uniform int uSky;             // 0 picture, 1 gradient, 2 dark, 3 stars
uniform vec3 uSkyA, uSkyB, uSunDir, uSunCol;
uniform float uSun, uTopY, uFit, uGlow;
void main(){
  vec2 uv = vUV;
  vec2 nd = uv * 2.0 - 1.0;
  vec3 rd = normalize(uF + uR * nd.x * uTan.x + uU * nd.y * uTan.y);
  vec3 sky;
  float cs = dot(rd, uSunDir);
  if (uSky == 0) {
    // squeezed between the horizon and the top of the view, so it rolls and pitches with the world;
    // below the horizon its bottom row is drawn out and hazed with the horizon colour
    sky = pic(uFit > 0.5 ? vec2(uv.x, max(0.0, rd.y / uTopY)) : uv);
    if (uFit > 0.5 && rd.y < 0.0) sky = mix(sky, uSkyA, 0.6);
  } else {
    float up = sat(rd.y * 1.7);
    vec3 above = mix(uSkyA, uSkyB, pow(up, 0.55));
    vec3 below = uSkyA * mix(0.45, 1.0, sat(1.0 + rd.y * 10.0));
    sky = rd.y > 0.0 ? above : below;
    if (uSky >= 2) sky *= 0.12;
    if (uSky == 3 && rd.y > -0.02) {
      vec2 sp = rd.xz / (1.0 + max(rd.y, 0.0)) * 90.0;
      vec2 id = floor(sp);
      float h = hash12(id);
      vec2 c = fract(sp) - 0.5 - (hash22(id) - 0.5) * 0.6;
      float tw = 0.55 + 0.45 * sin(uTime * (1.0 + h * 4.0) + h * 50.0);
      float st = smoothstep(0.86, 1.0, h) * tw * (1.0 - smoothstep(0.0, 0.1 + 0.08 * h, length(c)));
      sky += vec3(st) * 1.2 * smoothstep(-0.02, 0.1, rd.y);
    }
    sky += uSunCol * pow(sat(cs), 10.0) * 0.18 * uSun;
  }
  if (uSun > 0.0 && uSky != 0) {
    float disc = smoothstep(0.9975, 0.9988, cs);
    float halo = pow(sat(cs), 300.0) * 0.5;
    sky += uSunCol * (disc * (1.0 + uGlow) + halo) * uSun;
  }
  vec4 T = texture(uTerrain, uv);
  vec3 col = T.rgb + sky * (1.0 - T.a);
  vec3 bg = texture(uBg, uv).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

const MODES = [['both', 'Solid and wire'], ['wire', 'Wireframe'], ['solid', 'Solid'], ['points', 'Points'], ['contour', 'Contour lines']];
const SURFACES = [['height', 'By height'], ['picture', 'The picture'], ['flat', 'One colour']];
const SKIES = [['picture', 'The picture'], ['gradient', 'Gradient'], ['dark', 'Dark'], ['stars', 'Stars']];

export const flyover = postEffect({
  type: 'flyover',
  label: 'Flyover',
  group: 'Worlds',
  hint: 'Flying over an endless generated landscape: mountains, dunes, a canyon, islands, a city or the moon, as a wireframe, a low-poly surface, points or contours, with the picture as the sky or the ground.',
  actions: [{ name: 'roll', label: 'Barrel roll' }, { name: 'reseed', label: 'New land' }],
  params: [
    S('land', 'Landscape', 'mountains', LANDSCAPES),
    S('mode', 'Drawn as', 'both', MODES),
    S('surface', 'Surface colour', 'height', SURFACES),
    S('sky', 'Sky', 'picture', SKIES),
    R('height', 'Relief', 0.16, 0.01, 0.5),
    R('water', 'Water level', 0.3, 0, 0.9),
    R('speed', 'Speed', 0.12, 0, 0.8),
    R('altitude', 'Altitude', 0.06, 0.005, 0.5),
    R('pitch', 'Look down', 10, -20, 45, 1),
    R('weave', 'Weave', 0.5, 0, 1),
    R('lens', 'Lens', 80, 40, 120, 1),
    R('fog', 'Haze', 0.45, 0, 1),
    R('detail', 'Mesh detail', 1, 0.4, 2),
    R('weight', 'Line weight', 1.6, 1, 4, 0.1),
    R('glow', 'Glow', 0.8, 0, 3),
    R('snow', 'Snow', 0.5, 0, 1),
    R('sunAz', 'Sun direction', 40, 0, 360, 1),
    R('sunEl', 'Sun height', 22, 3, 80, 1),
    R('sun', 'Sun in the sky', 1, 0, 1),
    R('seed', 'Seed', 1, 1, 99, 1),
    B('flat', 'Faceted shading', true),
    B('fitSky', 'Whole picture above the horizon', false),
    C('wire', 'Wire', '#5ef2ff'),
    C('low', 'Low ground', '#1e5e3a'),
    C('high', 'High ground', '#9a8a70'),
    C('waterCol', 'Water', '#163f7a'),
    C('skyA', 'Horizon', '#ff7a59'),
    C('skyB', 'Zenith', '#160f3a'),
  ],
}, SKY_FS, {
  init(ctx) {
    const gl = ctx.gl;
    const st = {
      gl, quality: ctx.quality,
      pr: prog(gl, TERRAIN_VS, TERRAIN_FS),
      vao: gl.createVertexArray(),
      iboTri: gl.createBuffer(), iboLine: gl.createBuffer(),
      nTri: 0, nLine: 0, nVerts: 0, gridKey: '',
      grid: { W: 0, D: 0, cells: 96, cell: 1 / 96 },
      heightTex: gl.createTexture(),
      map: null, mapKey: '', mapDirty: false, mapAt: 0,
      target: null,
      cam: { x: 0.5, y: 0.3, z: 0, yaw: 0, pitch: 0, roll: 0, vx: 0 },
      basis: { R: [1, 0, 0], U: [0, 1, 0], F: [0, 0, 1], tan: [1, 1], topY: 0.5, sun: [0, 1, 0] },
      barrel: 2, seedOff: 0, t: 0,
    };
    gl.bindTexture(gl.TEXTURE_2D, st.heightTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, HM, HM, 0, gl.RED, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return st;
  },

  step(st, dt, w, p) {
    ensureMap(st, p);
    st.t += dt;
    const cam = st.cam;
    const t = st.t;
    // forward along +z, weaving sideways; the heading follows the velocity
    cam.z = fract(cam.z + p.speed * dt);
    const wv = p.weave;
    const lateral = wv * (0.3 * Math.sin(t * 0.21) + 0.12 * Math.sin(t * 0.53 + 1.0));
    const vLat = wv * (0.3 * 0.21 * Math.cos(t * 0.21) + 0.12 * 0.53 * Math.cos(t * 0.53 + 1.0));
    cam.x = fract(0.5 + lateral);
    cam.vx = vLat;
    const yawT = Math.atan2(vLat, Math.max(p.speed, 0.04)) * 0.8;
    cam.yaw += (clamp(yawT, -0.45, 0.45) - cam.yaw) * Math.min(1, dt * 2.5);
    // stay above the ground ahead
    const amp = p.height;
    let ground = p.water;
    if (st.map) {
      const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
      for (let k = 0; k <= 6; k++) {
        const d = k * 0.05;
        ground = Math.max(ground, heightAt(st.map, cam.x + sy * d, cam.z + cy * d));
      }
    }
    const targetY = ground * amp + p.altitude;
    if (!st.started) { cam.y = targetY; st.started = true; }
    cam.y += (targetY - cam.y) * Math.min(1, dt * (targetY > cam.y ? 4 : 1.6));
    // bank into the turns, bob a little, and the barrel roll
    let roll = -cam.yaw * 1.1 + wv * 0.04 * Math.sin(t * 0.7);
    if (st.barrel < 1) { st.barrel = Math.min(1, st.barrel + dt / 1.5); roll += TAU * sstep(0, 1, st.barrel); }
    cam.roll += (roll - cam.roll) * Math.min(1, dt * 4);
    cam.pitch = -(p.pitch + wv * 2.5 * Math.sin(t * 0.37)) * Math.PI / 180;
    // camera basis
    const b = st.basis;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const syw = Math.sin(cam.yaw), cyw = Math.cos(cam.yaw);
    const F = [syw * cp, sp, cyw * cp];
    let Rv = [cyw, 0, -syw];
    let Uv = [F[1] * Rv[2] - F[2] * Rv[1], F[2] * Rv[0] - F[0] * Rv[2], F[0] * Rv[1] - F[1] * Rv[0]];
    const cr = Math.cos(cam.roll), sr = Math.sin(cam.roll);
    const R2 = [Rv[0] * cr + Uv[0] * sr, Rv[1] * cr + Uv[1] * sr, Rv[2] * cr + Uv[2] * sr];
    const U2 = [Uv[0] * cr - Rv[0] * sr, Uv[1] * cr - Rv[1] * sr, Uv[2] * cr - Rv[2] * sr];
    b.F = F; b.R = R2; b.U = U2;
    const tanH = Math.tan((p.lens * Math.PI / 180) / 2);
    b.tan = [tanH, tanH * w.aspect];
    // how high the top of the view looks (for the squeezed picture sky)
    const ty = F[1] + U2[1] * b.tan[1], tl = Math.hypot(F[0] + U2[0] * b.tan[1], ty, F[2] + U2[2] * b.tan[1]);
    b.topY = Math.max(0.05, ty / tl);
    const az = p.sunAz * Math.PI / 180, el = p.sunEl * Math.PI / 180;
    b.sun = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
  },

  action(st, name) {
    if (name === 'roll') { if (st.barrel >= 1) st.barrel = 0; }
    else if (name === 'reseed') { st.seedOff++; }
  },

  before(st, c, pr) {
    const gl = st.gl, p = c.params;
    ensureMap(st, p);
    if (st.mapDirty) {
      st.mapDirty = false;
      gl.bindTexture(gl.TEXTURE_2D, st.heightTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, HM, HM, gl.RED, gl.FLOAT, st.map);
    }
    // the terrain target, smaller when the lines should be thicker
    const scale = 1 / p.weight;
    const tw = Math.max(32, Math.round(c.size[0] * scale)), th = Math.max(32, Math.round(c.size[1] * scale));
    if (!st.target || st.target.w !== tw || st.target.h !== th) {
      if (st.target) st.target.dispose();
      st.target = new Target(gl, tw, th, 'rgba16f', { depth: true });
    }
    // the grid: cells per tile from the detail, width from the lens
    const b = st.basis;
    const cells = clamp(Math.round(96 * p.detail * Math.sqrt(st.quality.sim || 1)), 24, 240);
    const depthTiles = 2.4;
    const halfW = b.tan[0] * depthTiles * 1.05 + 0.25;
    const W = Math.round(2 * halfW * cells), D = Math.round(depthTiles * cells);
    const gridKey = cells + ',' + W + ',' + D;
    if (gridKey !== st.gridKey) { st.gridKey = gridKey; buildGrid(st, cells, W, D); }
    const g = st.grid;
    const cam = st.cam;
    const behind = 8;
    const snap = (v) => Math.floor(v * g.cells) / g.cells;
    const shift = Math.sin(cam.yaw) * D * g.cell * 0.45;
    const ox = snap(cam.x + shift) - Math.round(W / 2) * g.cell;
    const oz = snap(cam.z) - behind * g.cell;

    const T = st.target;
    T.bind([0, 0, 0, 0]);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    const P = st.pr; P.use();
    const u = P.u;
    gl.uniform2i(u.uGrid, W, D);
    gl.uniform2f(u.uOrigin, ox, oz);
    gl.uniform1f(u.uCell, g.cell);
    gl.uniform1f(u.uHM, HM);
    gl.uniform1f(u.uAmp, p.height);
    gl.uniform1f(u.uWater, p.water);
    gl.uniform3f(u.uCam, cam.x, cam.y, cam.z);
    gl.uniform3fv(u.uR, b.R); gl.uniform3fv(u.uU, b.U); gl.uniform3fv(u.uF, b.F);
    gl.uniform2fv(u.uTan, b.tan);
    gl.uniform1f(u.uNear, 0.004);
    gl.uniform1f(u.uFar, 8);
    gl.uniform1f(u.uSmooth, p.flat ? 0 : 1);
    gl.uniform1f(u.uPointPx, 0.2 * p.weight);          // a point is a fraction of its cell
    const skirt = 3.0;                                   // tiles the outer rows reach beyond the grid
    gl.uniform1f(u.uSkirt, skirt / ((Math.pow(1.7, 10) - 1) / 0.7));
    gl.uniform1f(u.uFlat, p.flat ? 1 : 0);
    gl.uniform1i(u.uSurface, p.surface === 'picture' ? 1 : p.surface === 'flat' ? 2 : 0);
    const col = (name, hex) => { const v = hexRgb(hex, COL); gl.uniform3f(u[name], v[0], v[1], v[2]); };
    col('uLow', p.low); col('uHigh', p.high); col('uWaterCol', p.waterCol); col('uWire', p.wire);
    gl.uniform3fv(u.uSun, b.sun);
    // the sun warms as it sets; the ambient is the sky
    const warm = 1 - sat((p.sunEl - 5) / 30) * 0.5;
    gl.uniform3f(u.uSunCol, 1.05, 0.98 * (1 - warm * 0.15), 0.9 * (1 - warm * 0.35));
    const skyA = hexRgb(p.skyA, COL), skyB = hexRgb(p.skyB, COL2);
    const dark = p.sky === 'dark' || p.sky === 'stars' ? 0.35 : 1;
    gl.uniform3f(u.uAmb, (skyA[0] * 0.4 + skyB[0] * 0.6) * 0.5 * dark + 0.08, (skyA[1] * 0.4 + skyB[1] * 0.6) * 0.5 * dark + 0.08, (skyA[2] * 0.4 + skyB[2] * 0.6) * 0.5 * dark + 0.1);
    gl.uniform1f(u.uSnow, p.snow);
    gl.uniform1f(u.uGlow, p.glow);
    const vis = lerp(3.2, 0.55, p.fog);
    gl.uniform1f(u.uFogK, 1 / vis);
    gl.uniform1f(u.uFarEdge, ((D - behind) * g.cell + skirt) * 0.97);
    gl.uniform2f(u.uRes, tw, th);
    bindTex(gl, 0, st.heightTex, u.uHeight);
    bindTex(gl, 1, c.src, u.uBg);
    gl.bindVertexArray(st.vao);
    const mode = p.mode;
    if (mode === 'solid' || mode === 'both' || mode === 'contour') {
      gl.uniform1f(u.uZOff, 0);
      gl.uniform1i(u.uPass, mode === 'contour' ? 3 : 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, st.iboTri);
      gl.drawElements(gl.TRIANGLES, st.nTri, gl.UNSIGNED_INT, 0);
    }
    if (mode === 'wire' || mode === 'both') {
      gl.uniform1f(u.uZOff, 0.0025);
      gl.uniform1i(u.uPass, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, st.iboLine);
      gl.drawElements(gl.LINES, st.nLine, gl.UNSIGNED_INT, 0);
    }
    if (mode === 'points') {
      gl.uniform1f(u.uZOff, 0);
      gl.uniform1i(u.uPass, 2);
      gl.drawArrays(gl.POINTS, 0, st.nVerts);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  },

  uniforms(gl, u, p, st, c, color) {
    const b = st.basis;
    bindTex(gl, 2, st.target.tex, u.uTerrain);
    gl.uniform3fv(u.uR, b.R); gl.uniform3fv(u.uU, b.U); gl.uniform3fv(u.uF, b.F);
    gl.uniform2fv(u.uTan, b.tan);
    gl.uniform1i(u.uSky, p.sky === 'gradient' ? 1 : p.sky === 'dark' ? 2 : p.sky === 'stars' ? 3 : 0);
    color('uSkyA', p.skyA); color('uSkyB', p.skyB);
    gl.uniform3fv(u.uSunDir, b.sun);
    const warm = 1 - sat((p.sunEl - 5) / 30) * 0.5;
    gl.uniform3f(u.uSunCol, 1.1, 0.95 * (1 - warm * 0.2), 0.8 * (1 - warm * 0.4));
    gl.uniform1f(u.uSun, p.sun);
    gl.uniform1f(u.uTopY, b.topY);
    gl.uniform1f(u.uFit, p.fitSky ? 1 : 0);
    gl.uniform1f(u.uGlow, p.glow);
  },

  dispose(st) {
    const gl = st.gl;
    gl.deleteProgram(st.pr.p);
    gl.deleteVertexArray(st.vao);
    gl.deleteBuffer(st.iboTri); gl.deleteBuffer(st.iboLine);
    gl.deleteTexture(st.heightTex);
    if (st.target) st.target.dispose();
  },
});

const COL = [0, 0, 0], COL2 = [0, 0, 0];

/** Regenerate the heightmap when the landscape, seed or a "new land" action changed it. */
function ensureMap(st, p) {
  const key = p.land + ':' + Math.round(p.seed) + ':' + st.seedOff;
  if (key === st.mapKey && st.map) return;
  const now = performance.now();
  if (st.map && now - st.mapAt < 120) return;       // a slider mid-drag: one rebuild per 120 ms is plenty
  st.mapAt = now;
  st.mapKey = key;
  st.map = buildHeightmap(p.land, Math.round(p.seed) + st.seedOff * 101);
  st.mapDirty = true;
}

/** Index buffers for a W x D cell grid: triangles, and the three edges of every cell as lines. */
function buildGrid(st, cells, W, D) {
  const gl = st.gl;
  const W1 = W + 1;
  st.grid = { W, D, cells, cell: 1 / cells };
  st.nVerts = W1 * (D + 1);
  const tri = new Uint32Array(W * D * 6);
  const lines = new Uint32Array(W * D * 6 + W * 2 + D * 2);
  let t = 0, l = 0;
  for (let j = 0; j < D; j++) {
    for (let i = 0; i < W; i++) {
      const a = j * W1 + i, b = a + 1, c = a + W1, d = c + 1;
      tri[t++] = a; tri[t++] = c; tri[t++] = b;
      tri[t++] = b; tri[t++] = c; tri[t++] = d;
      lines[l++] = a; lines[l++] = b;
      lines[l++] = a; lines[l++] = c;
      lines[l++] = a; lines[l++] = d;
    }
    const e = j * W1 + W;                       // the right edge
    lines[l++] = e; lines[l++] = e + W1;
  }
  for (let i = 0; i < W; i++) { const e = D * W1 + i; lines[l++] = e; lines[l++] = e + 1; }   // the far edge
  st.nTri = t; st.nLine = l;
  gl.bindVertexArray(st.vao);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, st.iboTri);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tri, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, st.iboLine);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lines, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
}
