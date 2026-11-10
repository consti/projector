// Image rot: the picture damaged on purpose. These are live shader takes on
// the effects and modes of sixem's ImageRot (github.com/sixem/imagerot), a
// library that corrupts still images by working over their raw buffers:
// pixel sorting, quadtree mosaics, vaporwave tone bands, displaced rectangles,
// channel bleed, wrapped-around shadows, JPEG damage, 1-bit dither and wave
// distortion. Here each one runs every frame over the mapped picture.

import { PingPong, prog, bindTex, VS_SCREEN } from '../glu.mjs';
import { R, B, S, C } from './common.mjs';
import { postEffect } from './post.mjs';

// ---------------------------------------------------------------- shared GLSL
// Film grain in ImageRot's manner: a fifth of the pixels pick up a warm
// speck, two fifths a brighter one, and the whole frame is pulled down a
// little. Re-rolled 24 times a second.
const GLSL_GRAIN = `
uniform float uFrame;
uniform float uGrainSize;
vec3 grainRnd(){ return hash33(vec3(floor(gl_FragCoord.xy / uGrainSize), uFrame)); }
vec3 rotGrain(vec3 col, float amt, float dark){
  vec3 h = grainRnd();
  col += amt * (step(0.8, h.x) * vec3(0.06, 0.04, 0.04) * h.y + step(0.6, h.z) * h.y * 0.2);
  return col - dark * 0.08;
}`;

// Rectangles of the picture lifted out and put back a little way off, some
// brighter, some darker, some inverted. Each one lives for one beat of uRT
// and is then dealt again somewhere else, out of step with the others.
const GLSL_RECTS = `
uniform float uRN;
uniform float uRT;
uniform float uRSize;
uniform float uROff;
uniform float uRFlash;
uniform float uRInv;
// xy: displacement in uv, z: brightness shift, w: 1 where inverted
vec4 rects(vec2 uv){
  vec4 r = vec4(0.0);
  int n = int(uRN);
  for (int i = 0; i < 48; i++) {
    if (i >= n) break;
    float fi = float(i);
    float e = floor(uRT + hash11(fi * 7.13 + 1.0));
    vec2 s = vec2(fi * 3.7 + 0.5, e * 1.31 + 2.0);
    vec2 h1 = hash22(s), h2 = hash22(s + 17.0), h3 = hash22(s + 41.0), h4 = hash22(s + 71.0);
    vec2 d = (0.25 + 0.75 * h1) * 0.1 * uRSize;        // in units of the wall's height
    // never nearly square
    if (max(d.x, d.y) < 1.5 * min(d.x, d.y)) { if (h4.x < 0.5) d.x = d.y * 1.8; else d.y = d.x * 1.8; }
    d.x *= uAspect;
    vec2 q = uv - h2 * (1.0 - d);
    if (q.x >= 0.0 && q.x < d.x && q.y >= 0.0 && q.y < d.y) {
      r = vec4((h3 - 0.5) * 2.0 * uROff * vec2(uAspect, 1.0),
               (0.02 + 0.06 * h4.y) * (h3.x > 0.5 ? 1.0 : -1.0) * uRFlash,
               step(1.0 - uRInv, hash11(fi + e * 0.37 + 5.0)));
    }
  }
  return r;
}
vec3 applyRect(vec3 col, vec4 r){
  vec3 lit = col + r.z;
  vec3 inv = 1.0 - lit;
  // an inverted block only takes where it comes out bright
  return mix(lit, mix(col, inv, step(0.2, inv)), r.w);
}`;

const RECT_PARAMS = (n, size, off, inv) => [
  R('blocks', 'Blocks', n, 0, 48, 1),
  R('blockSize', 'Block size', size, 0.3, 6),
  R('blockOffset', 'Block displacement', off, 0, 0.3, 0.005),
  R('blockRate', 'Reshuffles per second', 1.5, 0, 20, 0.1),
  R('blockFlash', 'Block brightness', 1, 0, 4),
  R('blockInvert', 'Inverted blocks', inv, 0, 1),
];
function rectUniforms(gl, u, p, st) {
  gl.uniform1f(u.uRN, Math.round(p.blocks));
  gl.uniform1f(u.uRT, st.t * p.blockRate);
  gl.uniform1f(u.uRSize, p.blockSize);
  gl.uniform1f(u.uROff, p.blockOffset);
  gl.uniform1f(u.uRFlash, p.blockFlash);
  gl.uniform1f(u.uRInv, p.blockInvert);
}
function grainUniforms(gl, u, p, st) {
  gl.uniform1f(u.uFrame, Math.floor(st.t * 24) % 997);
  gl.uniform1f(u.uGrainSize, Math.max(1, p.grainSize || 1));
}

// ------------------------------------------------------------------ pixel sort
// The glitch-art staple. Runs of pixels whose brightness lies between two
// thresholds are sorted along a row or column, so the picture drips. A full
// sort every frame is out of reach for a shader, so the wall keeps a small
// copy of the picture and runs a few passes of odd-even transposition sort on
// it each frame: neighbours swap when they are out of order. Pixels outside
// the thresholds are walls the sort cannot cross and always show the live
// picture; inside, a trickle of fresh pixels is let in so the melt never sets.
const SORT_PASS_FS = `#version 300 es
precision highp float;
#include <hash>
in vec2 vUV;
out vec4 o;
uniform sampler2D uBuf;
uniform sampler2D uSrc;
uniform ivec2 uAxis;
uniform int uParity;
uniform int uInject;
uniform int uKey;
uniform float uLo;
uniform float uHi;
uniform float uRefresh;
uniform float uSeed;
uniform float uFlip;
float key(vec3 c){
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  if (uKey == 1) {
    float d = mx - mn;
    if (d < 1e-4) return 0.0;
    float h = mx == c.r ? (c.g - c.b) / d : mx == c.g ? 2.0 + (c.b - c.r) / d : 4.0 + (c.r - c.g) / d;
    return fract(h / 6.0);
  }
  if (uKey == 2) return mx - mn;
  return dot(c, vec3(0.299, 0.587, 0.114));
}
bool inRange(float k){ return k >= uLo && k <= uHi; }
vec3 cell(ivec2 p, ivec2 size){
  vec3 b = texelFetch(uBuf, p, 0).rgb;
  if (uInject == 0) return b;
  vec3 s = texture(uSrc, (vec2(p) + 0.5) / vec2(size)).rgb;
  if (!inRange(key(s)) || !inRange(key(b)) || hash12(vec2(p) + uSeed) < uRefresh) return s;
  return b;
}
void main(){
  ivec2 size = textureSize(uBuf, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  int i = uAxis.x * p.x + uAxis.y * p.y;
  int n = uAxis.x * size.x + uAxis.y * size.y;
  bool first = ((i + uParity) & 1) == 0;
  int j = first ? i + 1 : i - 1;
  vec3 a = cell(p, size);
  if (j >= 0 && j < n) {
    vec3 b = cell(p + (first ? uAxis : -uAxis), size);
    float ka = key(a), kb = key(b);
    if (inRange(ka) && inRange(kb)) {
      float lead = first ? ka : kb, trail = first ? kb : ka;
      if ((trail - lead) * uFlip > 0.0) a = b;
    }
  }
  o = vec4(a, 1.0);
}`;

const SORT_FS = `
uniform sampler2D uSort;
uniform float uMix;
void main(){
  vec3 bg = texture(uBg, vUV).rgb;
  vec3 col = mix(bg, texture(uSort, vUV).rgb, uMix);
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

const SORT_DIR = { up: [0, 1, -1], down: [0, 1, 1], right: [1, 0, -1], left: [1, 0, 1] };

export const pixelsort = postEffect({
  type: 'pixelsort',
  label: 'Pixel sort',
  group: 'Rot',
  hint: 'Runs of mid-bright pixels sort themselves along each column, so the picture melts into streaks between its darkest and brightest parts.',
  actions: [{ name: 'reset', label: 'Start over' }],
  params: [
    S('direction', 'Direction', 'down', [['down', 'Bright sinks'], ['up', 'Bright rises'], ['left', 'Bright to the left'], ['right', 'Bright to the right']]),
    S('key', 'Sort by', 'brightness', [['brightness', 'Brightness'], ['hue', 'Hue'], ['saturation', 'Saturation']]),
    R('lo', 'Sort from', 0.2, 0, 1),
    R('hi', 'Sort up to', 0.8, 0, 1),
    R('detail', 'Rows', 300, 60, 720, 1),
    R('passes', 'Sort speed', 12, 1, 48, 1),
    R('refresh', 'Fresh pixels let in', 0.03, 0, 0.5, 0.005),
    R('mix', 'Amount', 1, 0, 1),
  ],
}, SORT_FS, {
  init(ctx) { return { gl: ctx.gl, pp: null, clear: true, par: 0, pass: prog(ctx.gl, VS_SCREEN, SORT_PASS_FS) }; },
  action(st, name) { if (name === 'reset') st.clear = true; },
  before(st, c) {
    const gl = st.gl, p = c.params;
    const h = Math.round(p.detail), w = Math.max(2, Math.round((h * c.size[0]) / c.size[1]));
    if (!st.pp || st.pp.w !== w || st.pp.h !== h) {
      if (st.pp) st.pp.dispose();
      st.pp = new PingPong(gl, w, h, 'rgba8', { nearest: true });
      st.clear = true;
    }
    if (st.clear) { c.screen.copy(c.src, st.pp.read); st.clear = false; }
    if (st.stepped === false) return;
    const dir = SORT_DIR[p.direction] || SORT_DIR.down;
    const u = st.pass.u;
    gl.disable(gl.BLEND);
    const n = Math.round(p.passes);
    for (let i = 0; i < n; i++) {
      st.pp.write.bind();
      st.pass.use();
      bindTex(gl, 0, st.pp.read.tex, u.uBuf);
      bindTex(gl, 1, c.src, u.uSrc);
      gl.uniform2i(u.uAxis, dir[0], dir[1]);
      gl.uniform1i(u.uParity, st.par);
      gl.uniform1i(u.uInject, i === 0 ? 1 : 0);
      gl.uniform1i(u.uKey, { brightness: 0, hue: 1, saturation: 2 }[p.key] || 0);
      gl.uniform1f(u.uLo, Math.min(p.lo, p.hi));
      gl.uniform1f(u.uHi, Math.max(p.lo, p.hi));
      gl.uniform1f(u.uRefresh, p.refresh);
      gl.uniform1f(u.uSeed, (st.t * 61.7) % 500);
      gl.uniform1f(u.uFlip, dir[2]);
      c.screen.draw();
      st.pp.swap();
      st.par ^= 1;
    }
  },
  uniforms(gl, u, p, st) {
    bindTex(gl, 2, st.pp ? st.pp.read.tex : null, u.uSort);
    gl.uniform1f(u.uMix, p.mix);
  },
  dispose(st) { if (st.pp) st.pp.dispose(); },
});

// -------------------------------------------------------------------- quadtree
// Adaptive pixelation: start from a few big squares and split any square
// whose colours vary too much into four, down to a limit. Flat areas stay as
// big slabs while detail breaks into fine tiles. The variance of a square is
// estimated from a 4x4 grid of samples, one level at a time.
const QUAD_FS = `
uniform float uBase;
uniform float uDepth;
uniform float uThresh;
uniform float uOutline;
uniform float uFill;      // 0 flat, 1 discs, 2 the whole picture in every tile
void main(){
  vec3 bg = texture(uBg, vUV).rgb;
  vec2 asp = vec2(1.0, uAspect);
  vec2 s = vUV * asp;
  float size = 1.0 / uBase;
  vec3 mean = vec3(0.0);
  vec2 f = vec2(0.0);
  int depth = int(uDepth);
  for (int L = 0; L < 9; L++) {
    vec2 o0 = floor(s / size) * size;
    vec3 m = vec3(0.0), m2 = vec3(0.0);
    for (int j = 0; j < 4; j++) {
      for (int i = 0; i < 4; i++) {
        vec2 q = (o0 + (vec2(float(i), float(j)) + 0.5) * 0.25 * size) / asp;
        vec3 c = textureLod(uBg, min(q, vec2(1.0)), 0.0).rgb;
        m += c; m2 += c * c;
      }
    }
    m /= 16.0; m2 /= 16.0;
    mean = m;
    f = (s - o0) / size;
    float var = dot(m2 - m * m, vec3(1.0 / 3.0));
    if (var < uThresh || L >= depth - 1) break;
    size *= 0.5;
  }
  float px = size * uSize.x;                 // this tile's side in pixels
  vec3 col = mean;
  if (uFill > 1.5) {
    col = mean * (0.45 + 1.1 * luma(textureLod(uBg, f, 0.0).rgb));
  } else if (uFill > 0.5) {
    float r = length(f - 0.5);
    col = mean * (1.0 - smoothstep(0.47 - 1.5 / px, 0.47, r));
  }
  vec2 e = min(f, 1.0 - f) * px;
  col *= 1.0 - uOutline * (1.0 - smoothstep(0.5, 1.5, min(e.x, e.y)));
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const quadtree = postEffect({
  type: 'quadtree',
  label: 'Quadtree',
  group: 'Rot',
  hint: 'Squares that split in four wherever the picture is busy: flat areas stay as big slabs, detail crumbles into fine tiles.',
  actions: [],
  params: [
    R('base', 'Biggest squares across', 4, 1, 16, 1),
    R('depth', 'Splits', 6, 1, 8, 1),
    R('threshold', 'Split where busier than', 0.3, 0, 1),
    S('fill', 'Tiles', 'flat', [['flat', 'Flat colour'], ['discs', 'Discs'], ['picture', 'The whole picture in each']]),
    R('outline', 'Outlines', 0.5, 0, 1),
  ],
}, QUAD_FS, {
  uniforms(gl, u, p) {
    gl.uniform1f(u.uBase, Math.round(p.base));
    gl.uniform1f(u.uDepth, Math.round(p.depth));
    gl.uniform1f(u.uThresh, (p.threshold * 0.1) ** 2);
    gl.uniform1f(u.uOutline, p.outline);
    gl.uniform1f(u.uFill, { flat: 0, discs: 1, picture: 2 }[p.fill] || 0);
  },
});

// ------------------------------------------------------------------- vaporwave
// Tone bands: near-black stays black, then cyan, magenta, purple, teal, and
// white for the highlights. ImageRot only recolours pixels that are close to
// grey; "Greys only" brings that back, otherwise the bands follow brightness.
const VAPOR_FS = `
uniform float uSoft;
uniform float uStrict;
uniform float uShade;
uniform float uHue;
uniform float uDrift;
uniform float uMix;
void main(){
  vec3 bg = texture(uBg, vUV).rgb;
  float l = dot(bg, vec3(1.0 / 3.0));
  float k = l + uDrift * 0.12 * sin(uTime * 0.6 + vUV.y * 4.0 + vUV.x * 1.5);
  float s = 0.002 + uSoft * 0.05;
  vec3 col = vec3(0.0);
  col = mix(col, vec3(0.0, 0.72, 1.0),    smoothstep(0.059 - s, 0.059 + s, k));
  col = mix(col, vec3(1.0, 0.0, 0.757),   smoothstep(0.235 - s, 0.235 + s, k));
  col = mix(col, vec3(0.588, 0.0, 1.0),   smoothstep(0.471 - s, 0.471 + s, k));
  col = mix(col, vec3(0.0, 1.0, 0.976),   smoothstep(0.706 - s, 0.706 + s, k));
  col = mix(col, vec3(1.0),               smoothstep(0.918 - s, 0.918 + s, k));
  col = sat(hueShift(col, uHue));
  col = mix(col, col * (0.45 + 1.1 * l), uShade);
  float grey = 1.0 - smoothstep(0.0, 0.3, max(bg.r, max(bg.g, bg.b)) - min(bg.r, min(bg.g, bg.b)));
  col = mix(bg, col, uMix * mix(1.0, grey, uStrict));
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const vaporwave = postEffect({
  type: 'vaporwave',
  label: 'Vaporwave',
  group: 'Rot',
  hint: 'Brightness cut into bands of cyan, magenta, purple and teal, with black shadows and white highlights.',
  actions: [],
  params: [
    R('soft', 'Soft band edges', 0.15, 0, 1),
    R('shade', 'Keep the shading', 0.25, 0, 1),
    R('drift', 'Bands drift', 0.4, 0, 2),
    R('hue', 'Palette turn (°)', 0, -180, 180, 1),
    R('cycle', 'Palette cycle', 0, -2, 2),
    R('strict', 'Greys only', 0, 0, 1),
    R('mix', 'Amount', 1, 0, 1),
  ],
}, VAPOR_FS, {
  uniforms(gl, u, p, st) {
    gl.uniform1f(u.uSoft, p.soft);
    gl.uniform1f(u.uStrict, p.strict);
    gl.uniform1f(u.uShade, p.shade);
    gl.uniform1f(u.uHue, (p.hue * Math.PI) / 180 + st.t * p.cycle);
    gl.uniform1f(u.uDrift, p.drift);
    gl.uniform1f(u.uMix, p.mix);
  },
});

// ------------------------------------------------------------------ rectangles
const RECTS_FS = `
${GLSL_RECTS}
uniform float uSplit;
void main(){
  vec3 bg = texture(uBg, vUV).rgb;
  vec4 r = rects(vUV);
  vec2 uv = vUV + r.xy;
  vec2 d = vec2(uSplit * 0.004 * step(1e-5, abs(r.z)), 0.0);
  vec3 col = vec3(pic(uv + d).r, pic(uv).g, pic(uv - d).b);
  col = applyRect(col, r);
  o = vec4(mix(bg, sat(col), uOpacity), 1.0);
}`;

export const rectangles = postEffect({
  type: 'rectangles',
  label: 'Displaced blocks',
  group: 'Rot',
  hint: 'Rectangles of the picture lifted out and set back slightly off, some brighter, some darker, a few inverted, reshuffling as they go.',
  actions: [],
  params: [
    ...RECT_PARAMS(24, 2, 0.05, 0.2),
    R('split', 'Colour split in blocks', 1, 0, 4),
  ],
}, RECTS_FS, {
  uniforms(gl, u, p, st) {
    rectUniforms(gl, u, p, st);
    gl.uniform1f(u.uSplit, p.split);
  },
});

// --------------------------------------------------------------------- chimera
// A one-sided motion blur, then every channel takes on half or a quarter of
// the other two, so colour bleeds across and the picture washes out toward a
// hot pastel. Grain and a few displaced blocks finish it.
const CHIMERA_FS = `
${GLSL_GRAIN}
${GLSL_RECTS}
uniform float uBleed;
uniform float uBlur;
uniform float uAngle;
uniform float uGrain;
uniform float uDark;
vec3 chim(vec2 uv){
  vec2 d = vec2(cos(uAngle), sin(uAngle)) * uBlur / uSize;
  vec3 a = vec3(0.0);
  for (int i = 1; i <= 10; i++) a += pic(uv + d * float(i) * 0.1);
  a *= 0.1;
  vec3 m = vec3(dot(a, vec3(1.0, 0.5, 0.25)), dot(a, vec3(0.5, 1.0, 0.25)), dot(a, vec3(0.25, 0.5, 1.0)));
  return mix(a, m, uBleed);
}
void main(){
  vec3 bg = texture(uBg, vUV).rgb;
  vec4 r = rects(vUV);
  vec3 col = chim(vUV + r.xy);
  col = rotGrain(col, uGrain, uDark);
  col = applyRect(col, r);
  o = vec4(mix(bg, sat(col), uOpacity), 1.0);
}`;

export const chimera = postEffect({
  type: 'chimera',
  label: 'Chimera',
  group: 'Rot',
  hint: 'Every colour bleeds into the other two under a one-sided blur, washing the picture out to a hot, grainy pastel.',
  actions: [],
  params: [
    R('bleed', 'Channel bleed', 0.55, 0, 1),
    R('blur', 'Smear (px)', 24, 0, 120, 1),
    R('angle', 'Smear angle (°)', 0, 0, 360, 1),
    R('turn', 'Smear turns', 0.2, -3, 3, 0.05),
    R('grain', 'Grain', 1, 0, 3),
    R('grainSize', 'Grain size', 2, 1, 8, 1),
    R('dark', 'Darken', 1, 0, 4),
    ...RECT_PARAMS(15, 1.25, 0.02, 0.15),
  ],
}, CHIMERA_FS, {
  uniforms(gl, u, p, st) {
    rectUniforms(gl, u, p, st);
    grainUniforms(gl, u, p, st);
    gl.uniform1f(u.uBleed, p.bleed);
    gl.uniform1f(u.uBlur, p.blur);
    gl.uniform1f(u.uAngle, (p.angle * Math.PI) / 180 + st.t * p.turn);
    gl.uniform1f(u.uGrain, p.grain);
    gl.uniform1f(u.uDark, p.dark);
  },
});

// --------------------------------------------------------------------- lacunae
// Gaps. A random amount is taken off every channel and whatever drops below
// black wraps round to white, so the shadows fill with bright, coloured
// holes. The amount can come from per-pixel static or from slow noise, which
// turns the speckle into patches that crawl.
const LACUNAE_FS = `
${GLSL_GRAIN}
uniform float uEat;
uniform float uPatch;
uniform float uScale;
uniform float uSpeed;
uniform float uGrain;
uniform float uDark;
void main(){
  vec3 bg = texture(uBg, vUV).rgb;
  vec3 h = grainRnd().zxy;
  vec2 p = vUV * vec2(1.0, uAspect) * uScale;
  float t = uTime * uSpeed;
  vec3 n = vec3(fbm(p + vec2(t * 0.2, 0.0), 4), fbm(p + vec2(5.2, t * 0.17), 4), fbm(p + vec2(-t * 0.13, 9.1), 4));
  vec3 k = mix(h, sat((n - 0.25) * 2.0), uPatch);
  vec3 col = fract(min(bg, vec3(0.999)) - uEat * k + 1.0);
  col = rotGrain(col, uGrain, uDark);
  o = vec4(mix(bg, sat(col), uOpacity), 1.0);
}`;

export const lacunae = postEffect({
  type: 'lacunae',
  label: 'Lacunae',
  group: 'Rot',
  hint: 'The shadows are eaten through: anything pushed below black wraps round to white, leaving bright coloured holes that crawl.',
  actions: [],
  params: [
    R('eat', 'Eaten away', 0.4, 0, 1),
    R('patch', 'Patches rather than speckle', 0.6, 0, 1),
    R('scale', 'Patch size', 5, 0.5, 30, 0.1),
    R('speed', 'Crawl', 1, 0, 6),
    R('grain', 'Grain', 1, 0, 3),
    R('grainSize', 'Grain size', 2, 1, 8, 1),
    R('dark', 'Darken', 1, 0, 4),
  ],
}, LACUNAE_FS, {
  uniforms(gl, u, p, st) {
    grainUniforms(gl, u, p, st);
    gl.uniform1f(u.uEat, p.eat);
    gl.uniform1f(u.uPatch, p.patch);
    gl.uniform1f(u.uScale, p.scale);
    gl.uniform1f(u.uSpeed, p.speed);
    gl.uniform1f(u.uGrain, p.grain);
    gl.uniform1f(u.uDark, p.dark);
  },
});

// ------------------------------------------------------------------- nostalgia
// A photo saved as a JPEG too many times. Each block of the picture goes
// through a small cosine transform (4x4 frequencies of its brightness), the
// coefficients are rounded as coarsely as the quality says, higher
// frequencies harder, and the block is rebuilt from what is left; its colour
// is flattened to one value. Then the picture is split a little, faded and
// given grain, as ImageRot's nostalgia mode does.
const NOSTALGIA_FS = `
${GLSL_GRAIN}
uniform float uBlock;
uniform float uQ;
uniform float uChroma;
uniform float uShimmer;
uniform float uSplit;
uniform float uFade;
uniform float uGrain;
uniform float uLift;
void main(){
  vec3 bg = texture(uBg, vUV).rgb;
  vec2 px = vUV * uSize;
  vec2 b0 = floor(px / uBlock) * uBlock;
  vec2 f = (px - b0) / uBlock;
  mat4 Y; vec3 cm = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec3 c = textureLod(uBg, min((b0 + (vec2(float(i), float(j)) + 0.5) * 0.25 * uBlock) / uSize, vec2(1.0)), 0.0).rgb;
      float y = luma(c);
      Y[j][i] = y; cm += c - y;
    }
  }
  cm /= 16.0;
  mat4 A;
  for (int i = 0; i < 4; i++) {
    for (int k = 0; k < 4; k++) {
      A[i][k] = (k == 0 ? 0.5 : 0.70710678) * cos(PI * float(k) * (2.0 * float(i) + 1.0) / 8.0);
    }
  }
  mat4 F = A * Y * transpose(A);
  for (int v = 0; v < 4; v++) {
    for (int k = 0; k < 4; k++) {
      float q = uQ * (0.5 + float(k + v) * 0.6);
      float n = (hash12(b0 * 0.37 + vec2(float(k), float(v)) * 13.0 + uFrame) - 0.5) * uShimmer;
      F[v][k] = floor(F[v][k] / q + 0.5 + n) * q;
    }
  }
  vec4 kk = vec4(0.5, 0.70710678, 0.70710678, 0.70710678);
  vec4 bx = kk * cos(PI * vec4(0.0, 1.0, 2.0, 3.0) * f.x);
  vec4 by = kk * cos(PI * vec4(0.0, 1.0, 2.0, 3.0) * f.y);
  float y = dot(bx, F * by);
  float cq = uQ * uChroma;
  if (cq > 1e-4) cm = floor(cm / cq + 0.5) * cq;
  vec3 col = vec3(y) + cm;
  vec2 d = vec2(uSplit / uSize.x, 0.0);
  col.r += pic(vUV + d).r - bg.r;
  col.b += pic(vUV - d).b - bg.b;
  col = satur(col, 1.0 - uFade) + uLift;
  col += (grainRnd() - 0.5) * 0.16 * uGrain;
  o = vec4(mix(bg, sat(col), uOpacity), 1.0);
}`;

export const nostalgia = postEffect({
  type: 'nostalgia',
  label: 'JPEG nostalgia',
  group: 'Rot',
  hint: 'A photo saved as a JPEG too many times: blocky, banded, its colour smeared in squares, then faded and grainy.',
  actions: [],
  params: [
    R('quality', 'JPEG quality', 0.5, 0, 1),
    R('block', 'Block size (px)', 16, 4, 96, 1),
    R('chroma', 'Colour loss', 0.5, 0, 2),
    R('shimmer', 'Artefacts shimmer', 0.4, 0, 1),
    R('split', 'Colour split (px)', 2, 0, 20, 0.5),
    R('fade', 'Fade', 0.275, 0, 1),
    R('lift', 'Brightness', 0.02, -0.3, 0.3),
    R('grain', 'Grain', 1, 0, 4),
    R('grainSize', 'Grain size', 2, 1, 8, 1),
  ],
}, NOSTALGIA_FS, {
  uniforms(gl, u, p, st) {
    grainUniforms(gl, u, p, st);
    gl.uniform1f(u.uBlock, Math.round(p.block));
    gl.uniform1f(u.uQ, 0.6 * (1 - p.quality) ** 2 + 0.004);
    gl.uniform1f(u.uChroma, p.chroma);
    gl.uniform1f(u.uShimmer, p.shimmer);
    gl.uniform1f(u.uSplit, p.split);
    gl.uniform1f(u.uFade, p.fade);
    gl.uniform1f(u.uLift, p.lift);
    gl.uniform1f(u.uGrain, p.grain);
  },
});

// --------------------------------------------------------------------- rainbow
// ImageRot's acid mode: three sine waves, one across, one down and one on the
// diagonal, each dim a different channel, so soft bands of colour lie over
// the picture; then it is partly solarised, ruled with scanlines, split,
// grained and cut up with inverted blocks.
const RAINBOW_FS = `
${GLSL_GRAIN}
${GLSL_RECTS}
uniform float uWaves;
uniform float uDepth;
uniform vec3 uPhase;
uniform float uMono;
uniform float uSolar;
uniform float uLines;
uniform float uLineOp;
uniform float uSplit;
uniform float uGrain;
void main(){
  vec3 bg = texture(uBg, vUV).rgb;
  vec4 r = rects(vUV);
  vec2 uv = vUV + r.xy;
  vec2 d = vec2(uSplit * 0.004, 0.0);
  vec3 c = vec3(pic(uv + d).r, pic(uv).g, pic(uv - d).b);
  vec3 base = mix(c, vec3(luma(c)), uMono);
  vec3 w = sin(TAU * uWaves * vec3(vUV.x, vUV.y, vUV.x + vUV.y) + uPhase);
  vec3 col = pow(max(base * (1.0 - 0.5 * uDepth + 0.5 * uDepth * w), 0.0), vec3(0.75));
  col = mix(col, 1.0 - col, step(uSolar, col));
  col *= 1.0 - uLineOp * step(fract(vUV.y * uLines), 0.25);
  col += (grainRnd() - 0.5) * 0.2 * uGrain;
  col = applyRect(col, r);
  o = vec4(mix(bg, sat(col), uOpacity), 1.0);
}`;

export const rainbow = postEffect({
  type: 'rainbow',
  label: 'Rainbow rot',
  group: 'Rot',
  hint: 'Slow waves of red, green and blue wash across a half-solarised picture, ruled with scanlines and cut up with inverted blocks.',
  actions: [],
  params: [
    R('waves', 'Waves across', 1, 0.25, 8, 0.05),
    R('depth', 'Wave depth', 1, 0, 2),
    R('speed', 'Wave speed', 0.6, -4, 4, 0.05),
    R('mono', 'From brightness only', 0.7, 0, 1),
    R('solar', 'Solarise above', 0.6, 0, 1),
    R('lines', 'Scanlines', 100, 0, 400, 1),
    R('lineOpacity', 'Scanline strength', 0.2, 0, 1),
    R('split', 'Colour split', 1.2, 0, 6),
    R('grain', 'Grain', 1, 0, 4),
    R('grainSize', 'Grain size', 2, 1, 8, 1),
    ...RECT_PARAMS(15, 3, 0.04, 0.3),
  ],
}, RAINBOW_FS, {
  uniforms(gl, u, p, st) {
    rectUniforms(gl, u, p, st);
    grainUniforms(gl, u, p, st);
    const t = st.t * p.speed;
    gl.uniform1f(u.uWaves, p.waves);
    gl.uniform1f(u.uDepth, p.depth);
    gl.uniform3f(u.uPhase, t, t * 0.8 + 2.1, t * 1.3 + 4.2);
    gl.uniform1f(u.uMono, p.mono);
    gl.uniform1f(u.uSolar, p.solar);
    gl.uniform1f(u.uLines, Math.round(p.lines));
    gl.uniform1f(u.uLineOp, p.lines > 0 ? p.lineOpacity : 0);
    gl.uniform1f(u.uSplit, p.split);
    gl.uniform1f(u.uGrain, p.grain);
  },
});

// ---------------------------------------------------------------------- dither
// One bit per pixel. ImageRot diffuses the rounding error to the neighbours
// (Floyd-Steinberg), which a shader cannot do in one pass; an ordered Bayer
// threshold or animated static gives the same two-ink picture.
const DITHER_FS = `
uniform float uPx;
uniform float uThresh;
uniform float uContrast;
uniform float uKind;      // 0 fine Bayer, 1 coarse Bayer, 2 static
uniform float uRgb;
uniform float uFrame;
uniform vec3 uInk;
uniform vec3 uPaper;
float bayer2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a){ return bayer4(0.5 * a) * 0.25 + bayer2(a); }
void main(){
  vec3 bg = texture(uBg, vUV).rgb;
  vec2 cell = floor(gl_FragCoord.xy / uPx);
  vec3 c = textureLod(uBg, min((cell + 0.5) * uPx / uSize, vec2(1.0)), 0.0).rgb;
  float th = uKind < 0.5 ? bayer8(cell) : uKind < 1.5 ? bayer2(cell) : hash12(cell + uFrame * 17.0);
  th = th * 0.98 + 0.01;
  c = (c - 0.5) * uContrast + 1.0 - uThresh;
  vec3 col = uRgb > 0.5 ? step(vec3(th), c) : mix(uInk, uPaper, step(th, luma(c)));
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const dither = postEffect({
  type: 'dither',
  label: '1-bit dither',
  group: 'Rot',
  hint: 'The picture in two inks and nothing between, its tones made of dot patterns like an early Macintosh screen.',
  actions: [],
  params: [
    R('pixel', 'Pixel size', 3, 1, 16, 1),
    S('pattern', 'Pattern', 'bayer', [['bayer', 'Fine weave'], ['coarse', 'Coarse checks'], ['static', 'Static']]),
    R('threshold', 'Threshold', 0.5, 0, 1),
    R('contrast', 'Contrast', 1.2, 0.2, 4),
    C('ink', 'Ink', '#0b0b12'),
    C('paper', 'Paper', '#f2efe4'),
    B('rgb', 'Dither each colour (8 colours)', false),
  ],
}, DITHER_FS, {
  uniforms(gl, u, p, st, c, setCol) {
    gl.uniform1f(u.uPx, Math.round(p.pixel));
    gl.uniform1f(u.uThresh, p.threshold);
    gl.uniform1f(u.uContrast, p.contrast);
    gl.uniform1f(u.uKind, { bayer: 0, coarse: 1, static: 2 }[p.pattern] || 0);
    gl.uniform1f(u.uRgb, p.rgb ? 1 : 0);
    gl.uniform1f(u.uFrame, Math.floor(st.t * 24) % 997);
    setCol('uInk', p.ink);
    setCol('uPaper', p.paper);
  },
});

// ------------------------------------------------------------------------ wave
const WAVE_FS = `
uniform float uAmp;
uniform float uFreq;
uniform float uPhase;
uniform float uAxis;      // 0 rows slide, 1 columns slide, 2 both
uniform float uShape;     // 0 sine, 1 zigzag, 2 steps
uniform float uHarm;
uniform float uSplit;
float wv(float x){
  if (uShape < 0.5) return sin(x);
  if (uShape < 1.5) return abs(fract(x / TAU) * 2.0 - 1.0) * 2.0 - 1.0;
  return floor(sin(x) * 3.0 + 0.5) / 3.0;
}
float wave(float x, float ph){
  float a = x * uFreq * TAU;
  return wv(a + ph) + uHarm * 0.5 * wv(a * 2.3 - ph * 1.7 + 1.0);
}
vec2 disp(float ph){
  vec2 d = vec2(0.0);
  if (uAxis < 0.5 || uAxis > 1.5) d.x = wave(vUV.y, ph) * uAmp;
  if (uAxis > 0.5) d.y = wave(vUV.x / uAspect, ph) * uAmp / uAspect;
  return d;
}
void main(){
  vec3 bg = texture(uBg, vUV).rgb;
  vec3 col = vec3(pic(vUV + disp(uPhase + uSplit)).r, pic(vUV + disp(uPhase)).g, pic(vUV + disp(uPhase - uSplit)).b);
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const wave = postEffect({
  type: 'wave',
  label: 'Wave distort',
  group: 'Rot',
  hint: 'Rows of the picture slide left and right along a travelling wave, the colours a little out of step with each other.',
  actions: [],
  params: [
    S('axis', 'Slide', 'rows', [['rows', 'Rows sideways'], ['columns', 'Columns up and down'], ['both', 'Both']]),
    S('shape', 'Wave', 'sine', [['sine', 'Sine'], ['zigzag', 'Zigzag'], ['steps', 'Steps']]),
    R('amplitude', 'Amplitude', 0.03, 0, 0.3, 0.002),
    R('frequency', 'Waves down the wall', 3, 0.25, 40, 0.25),
    R('speed', 'Travel speed', 1.5, -10, 10, 0.1),
    R('harmonic', 'Second wave', 0.4, 0, 2),
    R('split', 'Colours out of step', 0.25, 0, 2),
  ],
}, WAVE_FS, {
  uniforms(gl, u, p, st) {
    gl.uniform1f(u.uAmp, p.amplitude);
    gl.uniform1f(u.uFreq, p.frequency);
    gl.uniform1f(u.uPhase, st.t * p.speed);
    gl.uniform1f(u.uAxis, { rows: 0, columns: 1, both: 2 }[p.axis] || 0);
    gl.uniform1f(u.uShape, { sine: 0, zigzag: 1, steps: 2 }[p.shape] || 0);
    gl.uniform1f(u.uHarm, p.harmonic);
    gl.uniform1f(u.uSplit, p.split);
  },
});
