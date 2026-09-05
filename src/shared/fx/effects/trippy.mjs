// The picture folded, tiled and fed back into itself: a kaleidoscope, Escher's
// Droste spiral, video feedback, wallpaper tessellations, a Poincaré-disc
// "Circle Limit", an endless tunnel and an acid domain warp. All of them are
// pure shaders over the mapped picture.

import { PingPong, bindTex } from '../glu.mjs';
import { R, B, C, S } from './common.mjs';
import { postEffect } from './post.mjs';

const CENTRE_PARAMS = (drift = 0.3) => [
  R('x', 'Centre x', 0.5, -0.2, 1.2),
  R('y', 'Centre y', 0.5, -0.2, 1.2),
  R('drift', 'Drift', drift, 0, 2),
  B('followPointer', 'Follow the pointer', false),
];

// --------------------------------------------------------------- kaleidoscope
const KALEIDO_FS = `
uniform float uSegments;
uniform float uSpin;      // rotation of the mirrors
uniform float uSourceSpin;
uniform float uZoom;
uniform float uMirror;
uniform float uTwist;
uniform float uPulse;
uniform float uHue;
void main(){
  vec2 p = toLocal(vUV);
  float r = length(p);
  float a = atan(p.y, p.x) + uSpin;
  float seg = TAU / max(uSegments, 1.0);
  a = mod(a, seg);
  if (uMirror > 0.5) a = abs(a - seg * 0.5);
  a += uSourceSpin + r * uTwist;
  float z = uZoom * (1.0 + uPulse * 0.25 * sin(uTime * 1.7 + r * 6.0));
  vec2 q = vec2(cos(a), sin(a)) * r * z;
  vec3 col = pic(fromLocal(q));
  col = hueShift(col, uHue * r * 4.0);
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const kaleido = postEffect({
  type: 'kaleido',
  label: 'Kaleidoscope',
  group: 'Trippy',
  hint: 'The picture mirrored into a turning wheel of wedges, the way a kaleidoscope folds the world.',
  actions: [],
  params: [
    R('segments', 'Wedges', 6, 2, 24, 1),
    R('spin', 'Mirror spin', 0.15, -2, 2),
    R('sourceSpin', 'Picture spin', 0.05, -2, 2),
    R('zoom', 'Zoom', 1, 0.2, 3),
    R('twist', 'Twist', 0, -6, 6),
    R('pulse', 'Breathe', 0.3, 0, 2),
    R('hue', 'Colour drift', 0, 0, 2),
    B('mirror', 'Mirror the wedges', true),
    ...CENTRE_PARAMS(0.2),
  ],
}, KALEIDO_FS, {
  centre: true,
  uniforms(gl, u, p, st) {
    gl.uniform1f(u.uSegments, Math.round(p.segments));
    gl.uniform1f(u.uSpin, st.t * p.spin);
    gl.uniform1f(u.uSourceSpin, st.t * p.sourceSpin);
    gl.uniform1f(u.uZoom, p.zoom);
    gl.uniform1f(u.uMirror, p.mirror ? 1 : 0);
    gl.uniform1f(u.uTwist, p.twist);
    gl.uniform1f(u.uPulse, p.pulse);
    gl.uniform1f(u.uHue, p.hue);
  },
});

// --------------------------------------------------------------------- droste
// Escher's "Print Gallery" transform: the annulus r1..r2 of the picture is
// repeated at every scale, and with twist the repeats wind into a spiral so
// the picture falls endlessly into itself.
const DROSTE_FS = `
uniform float uR1;
uniform float uR2;
uniform float uTwist;
uniform float uZoomT;    // scroll along log r
uniform float uSpin;
uniform float uHue;
uniform float uFade;
void main(){
  vec2 p = toLocal(vUV);
  float k = log(uR2 / uR1);
  float u = log(max(length(p), 1e-5));
  float v = atan(p.y, p.x) + uSpin;
  // multiply by (1 - i*twist*k/2pi): one turn round the centre = one step in scale
  float m = uTwist * k / TAU;
  float u2 = u + v * m;
  float v2 = v - u * m;
  float layer = floor((u2 - uZoomT - log(uR1)) / k);
  u2 = mod(u2 - uZoomT - log(uR1), k) + log(uR1);
  vec2 q = exp(u2) * vec2(cos(v2), sin(v2));
  vec3 col = pic(fromLocal(q));
  col = hueShift(col, uHue * layer * 0.8);
  // the rings deep in the centre dim a touch, so the eye reads depth
  col *= 1.0 - uFade * sat(-layer * 0.12);
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const droste = postEffect({
  type: 'droste',
  label: 'Droste spiral',
  group: 'Trippy',
  hint: 'The picture falls into itself: a ring of the frame repeats at every scale, wound into an Escher spiral.',
  actions: [],
  params: [
    R('inner', 'Inner ring', 0.22, 0.03, 0.6, 0.005),
    R('outer', 'Outer ring', 0.62, 0.2, 1.5, 0.005),
    R('twist', 'Twist', 1, -3, 3, 0.05),
    R('speed', 'Fall speed', 0.25, -2, 2, 0.01),
    R('spin', 'Spin', 0, -2, 2),
    R('hue', 'Colour per ring', 0, 0, 1),
    R('fade', 'Depth fade', 0.5, 0, 1),
    ...CENTRE_PARAMS(0.15),
  ],
}, DROSTE_FS, {
  centre: true,
  uniforms(gl, u, p, st) {
    const r1 = Math.min(p.inner, p.outer * 0.9);
    gl.uniform1f(u.uR1, r1);
    gl.uniform1f(u.uR2, Math.max(p.outer, r1 * 1.1));
    gl.uniform1f(u.uTwist, p.twist);
    gl.uniform1f(u.uZoomT, st.t * p.speed);
    gl.uniform1f(u.uSpin, st.t * p.spin);
    gl.uniform1f(u.uHue, p.hue);
    gl.uniform1f(u.uFade, p.fade);
  },
});

// ------------------------------------------------------------------- feedback
// A camera pointed at its own monitor: the last output frame is zoomed,
// rotated, hue-shifted and mixed back under the live picture, so the video
// recedes down an infinite corridor of itself.
const FEEDBACK_FS = `
uniform sampler2D uPrev;
uniform float uZoom;
uniform float uAngle;
uniform float uFeed;
uniform float uHue;
uniform float uDecay;
uniform float uMode;      // 0 mix, 1 screen, 2 difference
uniform float uThreshold;
uniform vec2 uSlide;
void main(){
  vec2 p = toLocal(vUV);
  p = rot2(uAngle) * p / uZoom + uSlide;
  vec2 q = fromLocal(p);
  vec3 prev = texture(uPrev, clamp(q, vec2(0.0), vec2(1.0))).rgb;
  float inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
  prev = hueShift(prev, uHue) * uDecay * inside;
  vec3 src = texture(uBg, vUV).rgb;
  vec3 col;
  if (uMode < 0.5) {
    // the live picture shows where it is bright, the corridor where it is dark
    float k = smoothstep(uThreshold - 0.2, uThreshold + 0.2, luma(src));
    col = mix(prev, src, mix(1.0 - uFeed, 1.0, k));
  } else if (uMode < 1.5) {
    col = 1.0 - (1.0 - src) * (1.0 - prev * uFeed);
  } else {
    col = abs(src - prev * uFeed);
  }
  vec3 bg = src;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const feedback = postEffect({
  type: 'feedback',
  label: 'Video feedback',
  group: 'Trippy',
  hint: 'The last frame is zoomed, turned and fed back under the picture, so the video recedes down a corridor of itself.',
  actions: [{ name: 'clear', label: 'Clear' }],
  params: [
    R('zoom', 'Zoom per frame', 1.03, 0.9, 1.15, 0.001),
    R('rotate', 'Turn per frame (°)', 1.5, -15, 15, 0.1),
    R('feed', 'Feedback', 0.82, 0, 1),
    R('decay', 'Persistence', 0.97, 0.8, 1, 0.001),
    R('hue', 'Colour shift', 0.08, -1, 1, 0.005),
    R('threshold', 'Picture shows where brighter than', 0.5, 0, 1),
    S('mode', 'Blend', 'mix', [['mix', 'Behind the picture'], ['screen', 'Screen'], ['diff', 'Difference']]),
    R('slideX', 'Slide x', 0, -0.05, 0.05, 0.001),
    R('slideY', 'Slide y', 0, -0.05, 0.05, 0.001),
    ...CENTRE_PARAMS(0.1),
  ],
}, FEEDBACK_FS, {
  centre: true,
  init(ctx) { return { gl: ctx.gl, pp: null, clear: false }; },
  resize(st, w, h) {
    if (st.pp) st.pp.dispose();
    st.pp = new PingPong(st.gl, w, h, 'rgba16f');
    st.clear = true;
  },
  action(st, name) { if (name === 'clear') st.clear = true; },
  uniforms(gl, u, p, st, c) {
    if (st.clear && st.pp) { st.pp.read.bind([0, 0, 0, 1]); st.clear = false; c.dst.bind(); }
    bindTex(gl, 2, st.pp ? st.pp.read.tex : null, u.uPrev);
    gl.uniform1f(u.uZoom, p.zoom);
    gl.uniform1f(u.uAngle, (p.rotate * Math.PI) / 180);
    gl.uniform1f(u.uFeed, p.feed);
    gl.uniform1f(u.uDecay, p.decay);
    gl.uniform1f(u.uHue, p.hue);
    gl.uniform1f(u.uThreshold, p.threshold);
    gl.uniform1f(u.uMode, p.mode === 'screen' ? 1 : p.mode === 'diff' ? 2 : 0);
    gl.uniform2f(u.uSlide, p.slideX, -p.slideY);
  },
  // keep a copy of what we just drew for the next frame
  after(st, c) {
    if (!st.pp) return;
    // c.dst was just filled; the feedback only advances when the sim did, so
    // 'pause with video' freezes the corridor too
    if (st.stepped !== false) c.screen.copy(c.dst.tex, st.pp.read);
    c.dst.bind();
  },
  dispose(st) { if (st.pp) st.pp.dispose(); },
});

// ----------------------------------------------------------------- tessellate
// Wallpaper-group folds: the plane is tiled with mirror images of one cell of
// the picture, so it repeats seamlessly like an Escher tessellation.
const TESS_FS = `
uniform float uKind;      // 0 square, 1 hex, 2 triangle, 3 diamond
uniform float uScale;
uniform float uSpin;
uniform float uCellSpin;
uniform vec2 uSlide;
uniform float uParity;
uniform float uZoom;
uniform float uOutline;
vec2 foldMirror(vec2 p){ return 1.0 - abs(fract(p * 0.5) * 2.0 - 1.0); }
void main(){
  vec2 p = rot2(uSpin) * toLocal(vUV) * uScale + uSlide;
  vec2 cell; float par = 0.0; float edge = 1.0;
  if (uKind < 0.5) {
    vec2 id = floor(p);
    par = mod(id.x + id.y, 2.0);
    cell = foldMirror(p) - 0.5;
    vec2 e = abs(fract(p) - 0.5); edge = max(e.x, e.y);
  } else if (uKind < 2.5) {
    const vec2 h = vec2(1.0, 1.7320508);
    vec2 a = mod(p, h) - h * 0.5;
    vec2 b = mod(p - h * 0.5, h) - h * 0.5;
    vec2 q = dot(a, a) < dot(b, b) ? a : b;
    float r = length(q);
    float ang = atan(q.y, q.x);
    float wedge = uKind < 1.5 ? PI / 3.0 : PI / 1.5;      // 6 or 3 mirrors
    float w = mod(ang, wedge);
    par = step(wedge * 0.5, w);
    w = abs(w - wedge * 0.5);
    cell = vec2(cos(w), sin(w)) * r;
    edge = r * 1.15;
  } else {
    vec2 q = vec2(p.x + p.y, p.x - p.y) * 0.7071;
    vec2 id = floor(q);
    par = mod(id.x + id.y, 2.0);
    cell = rot2(-0.7854) * (foldMirror(q) - 0.5);
    vec2 e = abs(fract(q) - 0.5); edge = max(e.x, e.y);
  }
  cell = rot2(uCellSpin) * cell;
  vec3 col = pic(fromLocal(cell * uZoom / uScale));
  if (uParity > 0.0 && par > 0.5) col = hueShift(col, uParity * PI);
  col *= 1.0 - uOutline * smoothstep(0.42, 0.5, edge);
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const tessellate = postEffect({
  type: 'tessellate',
  label: 'Tessellation',
  group: 'Trippy',
  hint: 'One cell of the picture mirrored across the wall in a square, hexagonal, triangular or diamond lattice.',
  actions: [],
  params: [
    S('kind', 'Lattice', 'hex', [['square', 'Squares'], ['hex', 'Hexagons'], ['triangle', 'Triangles'], ['diamond', 'Diamonds']]),
    R('scale', 'Tiles across', 3, 1, 12, 0.1),
    R('zoom', 'Cell zoom', 1, 0.2, 3),
    R('spin', 'Lattice spin', 0.02, -1, 1),
    R('cellSpin', 'Cell spin', 0.1, -2, 2),
    R('slideX', 'Slide x', 0.05, -1, 1),
    R('slideY', 'Slide y', 0.02, -1, 1),
    R('parity', 'Alternate colour', 0, 0, 1),
    R('outline', 'Tile edges', 0, 0, 1),
    ...CENTRE_PARAMS(0),
  ],
}, TESS_FS, {
  centre: true,
  uniforms(gl, u, p, st) {
    gl.uniform1f(u.uKind, { square: 0, hex: 1, triangle: 2, diamond: 3 }[p.kind] || 0);
    gl.uniform1f(u.uScale, p.scale);
    gl.uniform1f(u.uSpin, st.t * p.spin);
    gl.uniform1f(u.uCellSpin, st.t * p.cellSpin);
    gl.uniform2f(u.uSlide, st.t * p.slideX, st.t * p.slideY);
    gl.uniform1f(u.uParity, p.parity);
    gl.uniform1f(u.uZoom, p.zoom);
    gl.uniform1f(u.uOutline, p.outline);
  },
});

// ----------------------------------------------------------------- hyperbolic
// Escher's Circle Limit: a {p,q} tiling of the Poincaré disc, found by folding
// each pixel into the fundamental triangle (two mirrors through the origin and
// one circle inversion). A Möbius translation slides the whole disc around.
const HYPER_FS = `
uniform float uP;
uniform float uQ;
uniform float uDisc;
uniform vec2 uMobius;
uniform float uSpin;
uniform float uParity;
uniform float uOutside;
uniform float uZoom;
uniform float uLines;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cdiv(vec2 a, vec2 b){ return cmul(a, vec2(b.x, -b.y)) / max(dot(b, b), 1e-9); }
void main(){
  vec2 p = toLocal(vUV) / uDisc;
  float rr = dot(p, p);
  vec3 bg = texture(uBg, vUV).rgb;
  if (rr >= 1.0) {
    o = vec4(mix(bg, bg * uOutside, uOpacity), 1.0);
    return;
  }
  // slide the disc: z -> (z - a) / (1 - conj(a) z)
  p = cdiv(p - uMobius, vec2(1.0, 0.0) - cmul(vec2(uMobius.x, -uMobius.y), p));
  p = rot2(uSpin) * p;
  float ap = PI / uP, aq = PI / uQ;
  float d = cos(aq) / sqrt(max(cos(aq) * cos(aq) - sin(ap) * sin(ap), 1e-4));
  float r = d * sin(ap) / cos(aq);
  float par = 0.0;
  float edge = 1.0;
  for (int i = 0; i < 48; i++) {
    float a = atan(p.y, p.x);
    float w = mod(a, 2.0 * ap);
    if (w > ap) { w = 2.0 * ap - w; par += 1.0; }
    p = length(p) * vec2(cos(w), sin(w));
    vec2 q = p - vec2(d, 0.0);
    float l2 = dot(q, q);
    if (l2 < r * r) { p = vec2(d, 0.0) + q * (r * r / l2); par += 1.0; }
    else { edge = min(edge, (sqrt(l2) - r) / r); break; }
  }
  edge = min(edge, min(abs(p.y), abs(dot(p, vec2(-sin(ap), cos(ap))))) / (d - r));
  // the triangle is small: blow it up to fill the picture
  vec2 cell = p / (d - r) - vec2(0.5, 0.0);
  vec3 col = pic(fromLocal(cell * uZoom * 0.5));
  if (uParity > 0.0 && mod(par, 2.0) > 0.5) col = hueShift(col, uParity * PI);
  col *= 1.0 - uLines * (1.0 - smoothstep(0.0, 0.05, edge));
  // the rim of the disc darkens like the printed original
  col *= 1.0 - 0.6 * smoothstep(0.7, 1.0, rr);
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const hyperbolic = postEffect({
  type: 'hyperbolic',
  label: 'Circle limit',
  group: 'Trippy',
  hint: 'Escher’s Circle Limit: the picture tiled across a Poincaré disc, infinitely many copies shrinking towards the rim.',
  actions: [],
  params: [
    R('p', 'Polygon sides', 7, 3, 12, 1),
    R('q', 'Meeting at a corner', 3, 3, 12, 1),
    R('disc', 'Disc size', 0.5, 0.15, 1.2),
    R('slide', 'Slide', 0.3, 0, 1),
    R('spin', 'Spin', 0.05, -1, 1),
    R('zoom', 'Cell zoom', 1, 0.2, 3),
    R('parity', 'Alternate colour', 0.4, 0, 1),
    R('lines', 'Tile edges', 0.3, 0, 1),
    R('outside', 'Outside the disc', 0.15, 0, 1),
    ...CENTRE_PARAMS(0),
  ],
}, HYPER_FS, {
  centre: true,
  uniforms(gl, u, p, st) {
    let P = Math.round(p.p), Q = Math.round(p.q);
    // must be hyperbolic: 1/p + 1/q < 1/2
    while (1 / P + 1 / Q >= 0.5) { if (Q <= P) P++; else Q++; }
    gl.uniform1f(u.uP, P);
    gl.uniform1f(u.uQ, Q);
    gl.uniform1f(u.uDisc, p.disc);
    const s = p.slide * 0.45;
    gl.uniform2f(u.uMobius, Math.sin(st.t * 0.21) * s, Math.cos(st.t * 0.16) * s);
    gl.uniform1f(u.uSpin, st.t * p.spin);
    gl.uniform1f(u.uParity, p.parity);
    gl.uniform1f(u.uOutside, p.outside);
    gl.uniform1f(u.uZoom, p.zoom);
    gl.uniform1f(u.uLines, p.lines);
  },
});

// --------------------------------------------------------------------- tunnel
const TUNNEL_FS = `
uniform float uSpeed;
uniform float uTwist;
uniform float uRepeat;
uniform float uFog;
uniform float uShape;     // 0 round, 1 square, 2 star
uniform float uSpin;
uniform float uHue;
uniform float uStretch;
void main(){
  vec2 p = toLocal(vUV);
  float a = atan(p.y, p.x);
  float r;
  if (uShape < 0.5) r = length(p);
  else if (uShape < 1.5) r = max(abs(p.x), abs(p.y)) * 1.2;
  else r = length(p) * (1.0 + 0.25 * cos(a * 5.0));
  float depth = uStretch / max(r, 1e-4);
  float ang = a + uSpin + depth * uTwist * 0.1;
  vec2 q = vec2(ang / TAU * uRepeat, depth + uTime * uSpeed);
  vec3 col = pic(q);
  col = hueShift(col, uHue * depth * 0.3);
  col *= exp(-depth * uFog * 0.15);
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const tunnel = postEffect({
  type: 'tunnel',
  label: 'Tunnel',
  group: 'Trippy',
  hint: 'The picture wrapped around the inside of an endless tunnel you fly down.',
  actions: [],
  params: [
    S('shape', 'Shape', 'round', [['round', 'Round'], ['square', 'Square'], ['star', 'Star']]),
    R('speed', 'Speed', 0.6, -4, 4, 0.05),
    R('twist', 'Twist', 0.5, -4, 4),
    R('repeat', 'Wraps around', 2, 1, 8, 1),
    R('stretch', 'Depth stretch', 0.25, 0.05, 1),
    R('fog', 'Fog', 1, 0, 4),
    R('spin', 'Spin', 0.1, -2, 2),
    R('hue', 'Colour with depth', 0, 0, 1),
    ...CENTRE_PARAMS(0.25),
  ],
}, TUNNEL_FS, {
  centre: true,
  uniforms(gl, u, p, st) {
    gl.uniform1f(u.uSpeed, p.speed);
    gl.uniform1f(u.uTwist, p.twist);
    gl.uniform1f(u.uRepeat, Math.round(p.repeat));
    gl.uniform1f(u.uFog, p.fog);
    gl.uniform1f(u.uShape, { round: 0, square: 1, star: 2 }[p.shape] || 0);
    gl.uniform1f(u.uSpin, st.t * p.spin);
    gl.uniform1f(u.uHue, p.hue);
    gl.uniform1f(u.uStretch, p.stretch);
  },
});

// ----------------------------------------------------------------------- acid
const ACID_FS = `
uniform float uWarp;
uniform float uScale;
uniform float uSpeed;
uniform float uHueSpeed;
uniform float uRainbow;
uniform float uSplit;
uniform float uEdges;
uniform float uPoster;
uniform float uSat;
uniform float uMelt;
void main(){
  vec2 p = toLocal(vUV);
  float t = uTime * uSpeed;
  vec2 w = vec2(fbm(p * uScale + vec2(t * 0.31, 1.7), 4),
                fbm(p * uScale + vec2(7.1, -t * 0.27), 4)) - 0.5;
  // melt: the warp pulls harder downwards the lower you go
  w.y -= uMelt * (0.5 - vUV.y) * (0.5 + 0.5 * sin(t + p.x * 9.0));
  vec2 q = vUV + w * uWarp * 0.35;
  vec2 d = w * uSplit * 0.08;
  vec3 col;
  col.r = pic(q + d).r;
  col.g = pic(q).g;
  col.b = pic(q - d).b;
  // neon edges from the warped picture
  vec2 px = 1.0 / uSize;
  float e = 0.0;
  if (uEdges > 0.0) {
    float l0 = luma(pic(q));
    e += abs(luma(pic(q + vec2(px.x, 0.0))) - l0);
    e += abs(luma(pic(q + vec2(0.0, px.y))) - l0);
    e = sat(e * 6.0);
  }
  float h = t * uHueSpeed + uRainbow * (w.x * 4.0 + length(p) * 3.0);
  col = hueShift(col, h);
  col += hueShift(vec3(1.0, 0.2, 0.8), h * 1.3 + 2.0) * e * uEdges * 1.5;
  col = satur(col, uSat);
  if (uPoster > 1.5) col = floor(col * uPoster + 0.5) / uPoster;
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const acid = postEffect({
  type: 'acid',
  label: 'Acid',
  group: 'Trippy',
  hint: 'The picture melts and breathes under a slow noise warp while its colours cycle round the wheel.',
  actions: [],
  params: [
    R('warp', 'Warp', 0.5, 0, 2),
    R('scale', 'Warp size', 3, 0.5, 12, 0.1),
    R('speed', 'Speed', 1, 0, 4),
    R('melt', 'Melt down', 0.3, 0, 2),
    R('hueSpeed', 'Colour cycle', 0.4, 0, 3),
    R('rainbow', 'Rainbow spread', 0.5, 0, 2),
    R('split', 'Colour split', 0.5, 0, 2),
    R('edges', 'Neon edges', 0.4, 0, 2),
    R('sat', 'Saturation', 1.6, 0, 3),
    R('poster', 'Posterise', 0, 0, 12, 1),
    ...CENTRE_PARAMS(0),
  ],
}, ACID_FS, {
  centre: true,
  uniforms(gl, u, p) {
    gl.uniform1f(u.uWarp, p.warp);
    gl.uniform1f(u.uScale, p.scale);
    gl.uniform1f(u.uSpeed, p.speed);
    gl.uniform1f(u.uHueSpeed, p.hueSpeed);
    gl.uniform1f(u.uRainbow, p.rainbow);
    gl.uniform1f(u.uSplit, p.split);
    gl.uniform1f(u.uEdges, p.edges);
    gl.uniform1f(u.uPoster, Math.round(p.poster));
    gl.uniform1f(u.uSat, p.sat);
    gl.uniform1f(u.uMelt, p.melt);
  },
});

// ----------------------------------------------------------------- flip tiles
// The picture cut into tiles that flip over in waves, showing a treated copy
// of the picture on their backs.
const FLIP_FS = `
uniform float uCols;
uniform float uSpeed;
uniform float uWave;       // 0 radial, 1 diagonal, 2 random
uniform float uAxis;       // 0 flip about vertical axis, 1 horizontal
uniform float uHue;
uniform float uGap;
uniform vec3 uGapCol;
uniform float uHold;
void main(){
  vec2 A = vec2(1.0, uAspect);
  vec2 grid = vec2(uCols, floor(uCols * uAspect));
  vec2 id = floor(vUV * grid);
  vec2 f = fract(vUV * grid) - 0.5;
  vec2 cUV = (id + 0.5) / grid;
  float phaseOff;
  if (uWave < 0.5) phaseOff = length((cUV - uCentre) * A) * 3.0;
  else if (uWave < 1.5) phaseOff = (cUV.x + cUV.y) * 1.5;
  else phaseOff = hash12(id) * 4.0;
  // each tile turns half a revolution then rests
  float ph = fract((uTime * uSpeed - phaseOff) / (1.0 + uHold));
  float turn = smoothstep(0.0, 1.0 / (1.0 + uHold), ph);
  float ang = turn * PI;
  float cs = cos(ang);
  float back = step(cs, 0.0);
  cs = max(abs(cs), 1e-3);
  vec2 g = f;
  if (uAxis < 0.5) g.x = f.x / cs; else g.y = f.y / cs;
  float outside = step(0.5, max(abs(g.x), abs(g.y)));
  float gap = step(0.5 - uGap * 0.5, max(abs(f.x), abs(f.y)));
  if (back > 0.5) { if (uAxis < 0.5) g.x = -g.x; else g.y = -g.y; }
  vec2 suv = (id + 0.5 + g) / grid;
  vec3 col = pic(suv);
  if (back > 0.5) col = hueShift(col, uHue) * 1.05;
  // shading as the tile turns edge-on
  col *= 0.6 + 0.4 * abs(cos(ang));
  col = mix(col, uGapCol, max(outside, gap));
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const fliptiles = postEffect({
  type: 'fliptiles',
  label: 'Flip tiles',
  group: 'Trippy',
  hint: 'The picture cut into tiles that turn over in waves, showing a recoloured copy on their backs.',
  actions: [],
  params: [
    R('cols', 'Tiles across', 12, 2, 48, 1),
    R('speed', 'Speed', 0.6, 0, 4, 0.05),
    R('hold', 'Rest between flips', 1.5, 0, 6, 0.1),
    S('wave', 'Wave', 'radial', [['radial', 'From the centre'], ['diag', 'Diagonal'], ['random', 'Random']]),
    S('axis', 'Flip about', 'vertical', [['vertical', 'Vertical axis'], ['horizontal', 'Horizontal axis']]),
    R('hue', 'Back-side colour shift', 2.5, 0, 6.28, 0.05),
    R('gap', 'Gap', 0.06, 0, 0.3),
    C('gapCol', 'Gap colour', '#08080c'),
    ...CENTRE_PARAMS(0),
  ],
}, FLIP_FS, {
  centre: true,
  uniforms(gl, u, p, st, c, color) {
    gl.uniform1f(u.uCols, Math.round(p.cols));
    gl.uniform1f(u.uSpeed, p.speed);
    gl.uniform1f(u.uWave, { radial: 0, diag: 1, random: 2 }[p.wave] || 0);
    gl.uniform1f(u.uAxis, p.axis === 'horizontal' ? 1 : 0);
    gl.uniform1f(u.uHue, p.hue);
    gl.uniform1f(u.uGap, p.gap);
    color('uGapCol', p.gapCol);
    gl.uniform1f(u.uHold, p.hold);
  },
});

// --------------------------------------------------------------------- chrome
// Liquid metal: a slowly moving height field whose surface reflects the
// picture as if it were the room around a pool of mercury.
const CHROME_FS = `
uniform float uScale;
uniform float uSpeed;
uniform float uRelief;
uniform float uMetal;
uniform vec3 uTint;
uniform float uSharp;
uniform float uRipple;
float height(vec2 p){
  float h = fbm(p * uScale + vec2(uTime * uSpeed * 0.3, -uTime * uSpeed * 0.2), 4);
  h += uRipple * 0.08 * sin(length((p - uCentre) * vec2(1.0, uAspect)) * 40.0 - uTime * uSpeed * 6.0);
  return h;
}
void main(){
  vec2 e = vec2(2.0) / uSize;
  float h0 = height(vUV);
  float hx = height(vUV + vec2(e.x, 0.0)), hy = height(vUV + vec2(0.0, e.y));
  vec3 n = normalize(vec3(-(hx - h0) / e.x, -(hy - h0) / e.y, 1.0 / max(uRelief, 1e-3) * 60.0));
  vec3 v = vec3(0.0, 0.0, 1.0);
  vec3 r = reflect(-v, n);
  // the picture is the environment: look it up along the reflected direction
  vec2 env = vUV + r.xy * 0.35;
  vec3 refl = pic(env);
  // blur the reflection where the surface is rough
  refl = mix(refl, (pic(env + e * 3.0) + pic(env - e * 3.0) + pic(env + vec2(e.x, -e.y) * 3.0) + pic(env - vec2(e.x, -e.y) * 3.0)) * 0.25, 1.0 - uSharp);
  vec3 L1 = normalize(vec3(-0.6, 0.7, 0.5)), L2 = normalize(vec3(0.7, -0.3, 0.6));
  float spec = pow(max(dot(reflect(-L1, n), v), 0.0), 60.0) + 0.6 * pow(max(dot(reflect(-L2, n), v), 0.0), 30.0);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 metal = uTint * (0.25 + 0.75 * refl) + vec3(spec) * 1.2 + fres * 0.4 * uTint;
  vec3 col = mix(refl, metal, uMetal);
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const chrome = postEffect({
  type: 'chrome',
  label: 'Liquid metal',
  group: 'Trippy',
  hint: 'A pool of mercury on the wall, its slow swells reflecting the picture with hard highlights.',
  actions: [],
  params: [
    R('scale', 'Swell size', 3, 0.5, 12, 0.1),
    R('speed', 'Speed', 1, 0, 4),
    R('relief', 'Relief', 1, 0.1, 4),
    R('metal', 'Metal', 0.8, 0, 1),
    C('tint', 'Metal tint', '#dfe6f0'),
    R('sharp', 'Mirror sharpness', 0.7, 0, 1),
    R('ripple', 'Ripples from the centre', 0.4, 0, 2),
    ...CENTRE_PARAMS(0.3),
  ],
}, CHROME_FS, {
  centre: true,
  uniforms(gl, u, p, st, c, color) {
    gl.uniform1f(u.uScale, p.scale);
    gl.uniform1f(u.uSpeed, p.speed);
    gl.uniform1f(u.uRelief, p.relief);
    gl.uniform1f(u.uMetal, p.metal);
    color('uTint', p.tint);
    gl.uniform1f(u.uSharp, p.sharp);
    gl.uniform1f(u.uRipple, p.ripple);
  },
});
