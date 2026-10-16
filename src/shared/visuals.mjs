// Visuals instead of the video.
//
// Some music videos are not worth looking at. With visuals on, the engine's
// source picture is not the decoded video but a generated, audio-reactive
// scene rendered straight into a texture every frame. Everything downstream —
// the wall mapping, masks, the TV, the whole effects stack — treats it exactly
// like a video frame, so water still refracts it and the kaleidoscope still
// folds it. The video keeps playing (hidden) because it carries the sound and
// the clock.
//
// Scene choice runs off the media clock and the track, not off anything local,
// so the projector, the TV and the control preview all change scene at the
// same moment.

import { prog, VS_SCREEN, Target } from './fx/glu.mjs';
import { SPECTRUM_N } from './fx/audio.mjs';

export const VISUAL_SCENES = [
  ['tunnel', 'Neon tunnel'],
  ['liquid', 'Liquid marble'],
  ['kaleido', 'Fractal kaleidoscope'],
  ['spectrum', 'Spectrum ring'],
  ['warp', 'Warp speed'],
  ['cells', 'Pulse cells'],
  ['horizon', 'Synthwave horizon'],
  ['lava', 'Lava lamp'],
  ['lasers', 'Laser show'],
  ['moire', 'Op-art moiré'],
  ['mandelbrot', 'Mandelbrot zoom'],
  ['julia', 'Julia set'],
  ['newton', 'Newton fractal'],
  ['mandelbox', 'Mandelbox zoom (3D)'],
  ['mandelbulb', 'Mandelbulb flight (3D)'],
  ['menger', 'Menger flythrough (3D)'],
  ['shaft', 'Grid shaft'],
  ['nebula', 'Fractal nebula (3D)'],
  ['gyroid', 'Gyroid tunnel (3D)'],
  ['cathedral', 'Fractal cathedral (3D)'],
  ['sierpinski', 'Sierpinski zoom (3D)'],
  ['train', 'Train through the city (3D)'],
  ['apollonian', 'Apollonian gasket'],
  ['burningship', 'Burning Ship'],
  ['lyapunov', 'Lyapunov space'],
  ['quasicrystal', 'Quasicrystal'],
  ['hypno', 'Hypno spiral'],
  ['acid', 'Acid plasma'],
  ['emoji', 'Emoji vortex'],
  ['emojiwall', 'Emoji wall'],
];

// one line per scene, for the catalogue cards
export const VISUAL_SCENE_HINTS = {
  tunnel: 'A tube morphing between round and hexagonal, rings flaring on the beat.',
  liquid: 'Domain-warped noise, warped harder by the bass.',
  kaleido: 'A folded fractal drawn by its orbit traps.',
  spectrum: 'The spectrum as mirrored bars around a pulsing ring.',
  warp: 'Star streaks that stretch with the loudness.',
  cells: 'Voronoi cells; a different set lights on every beat.',
  horizon: 'Sliced sun, mountains that follow the spectrum, a scrolling grid.',
  lava: 'Metaballs with glowing rims.',
  lasers: 'Sweeping beams through haze, strobing on the beat.',
  moire: 'Two interfering ring sets, black and colour.',
  mandelbrot: 'Dives into famous spots of the set, a new one each time.',
  julia: 'The Julia set as its constant circles the main cardioid.',
  newton: 'Relaxed Newton\u2019s method on z\u00b3 \u2212 1, the relaxation wobbling.',
  mandelbox: 'The golden box: an exponential zoom into its surface.',
  mandelbulb: 'The 3-D Mandelbrot, the camera skimming its surface as the power morphs.',
  menger: 'An endless flight down the tunnel of a twisted Menger sponge.',
  shaft: 'Falling down a square shaft of grid walls with Menger-carpet windows.',
  nebula: 'A volumetric Kali fractal drifted through.',
  gyroid: 'A tunnel bored through a gyroid, neon contours racing along it.',
  cathedral: 'A kaleidoscopic IFS with rotations the music keeps turning.',
  sierpinski: 'Self-similar at 2\u00d7, so the zoom never restarts.',
  train: 'The front of a train through a city that never ends. City, hour, haze and height are yours.',
  apollonian: 'Circles packed in circles by repeated inversion.',
  burningship: 'The same dive into the Burning Ship\u2019s armada.',
  lyapunov: 'Where the logistic map settles and where it goes chaotic.',
  quasicrystal: 'Seven plane waves: a pattern that never repeats.',
  hypno: 'A logarithmic spiral whose stripes flip on the beat.',
  acid: 'Posterised, bass-warped plasma.',
  emoji: 'Rings of emoji streaming out of the centre.',
  emojiwall: 'A grid of emoji that bob to their column of the spectrum.',
};

export const DEFAULT_VISUAL_EMOJI = '🎉🔥💃🕺🎶🌈⭐🍕🦄👽🎸🍉🌸💎🚀😎🪩🍒🐙🌵🍩🎈👾🦋';

// iq's cosine palettes: colour(t) = a + b·cos(2π(c·t + d))
export const VISUAL_PALETTES = {
  neon: [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1.0, 1.0, 1.0], [0.0, 0.33, 0.67]],
  sunset: [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1.0, 1.0, 0.5], [0.8, 0.9, 0.3]],
  ice: [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1.0, 0.7, 0.4], [0.0, 0.15, 0.2]],
  acid: [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [2.0, 1.0, 0.0], [0.5, 0.2, 0.25]],
  fire: [[0.8, 0.5, 0.4], [0.2, 0.4, 0.2], [2.0, 1.0, 1.0], [0.0, 0.25, 0.25]],
  ocean: [[0.2, 0.5, 0.7], [0.2, 0.4, 0.3], [1.0, 1.0, 1.0], [0.55, 0.6, 0.65]],
  candy: [[0.8, 0.5, 0.7], [0.3, 0.4, 0.3], [1.0, 1.0, 1.0], [0.0, 0.1, 0.2]],
  mono: [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]],
};

export const VISUAL_PALETTE_NAMES = [
  ['auto', 'Per track'], ['neon', 'Neon'], ['sunset', 'Sunset'], ['ice', 'Ice'], ['acid', 'Acid'],
  ['fire', 'Fire'], ['ocean', 'Ocean'], ['candy', 'Candy'], ['mono', 'Black & white'],
];

// The train ride: which city it runs through and at what hour. 'auto' picks per
// track, like the palette; 'cycle' lets the day go by as the music plays.
export const VISUAL_CITIES = [
  ['auto', 'Per track'], ['towers', 'Glass towers'], ['lowrise', 'Low-rise blocks'], ['neon', 'Neon megacity'], ['wire', 'Wireframe'],
];
export const VISUAL_DAYTIMES = [
  ['auto', 'Per track'], ['cycle', 'Round the clock'], ['dawn', 'Dawn'], ['day', 'Day'], ['sunset', 'Sunset'], ['dusk', 'Dusk'], ['night', 'Night'],
];
const CITY_ID = { towers: 0, lowrise: 1, neon: 2, wire: 3 };
// as a fraction of the day: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset
const DAY_AT = { dawn: 0.262, day: 0.45, sunset: 0.735, dusk: 0.775, night: 0 };
const AUTO_DAYTIMES = ['night', 'dusk', 'sunset', 'night', 'day', 'dawn'];

export function defaultVisualsCfg() {
  return { scene: 'auto', every: 30, speed: 1, react: 1, palette: 'auto', emoji: DEFAULT_VISUAL_EMOJI,
    city: 'auto', daytime: 'auto', haze: 0.35, ride: 0.3 };
}

/** A stable identity for "this video", shared by playlist items, library entries and sources. */
export function videoKey(it) {
  if (!it) return null;
  if (it.key) return it.key;
  if (it.libId) return String(it.libId);
  if (it.id) return String(it.id).replace(/^lib:/, '');
  return it.path || it.url || null;
}

/** Is the picture being replaced by visuals right now: globally, or for this video? */
export function visualsOn(state) {
  const s = (state && state.settings) || {};
  if (s.visuals) return true;
  const src = state && state.transport && state.transport.source;
  if (src && src.kind === 'music') return true;      // an Apple Music song: sound only, the visuals are its picture
  const k = videoKey(state && state.transport && state.transport.source);
  return !!(k && Array.isArray(s.visualsFor) && s.visualsFor.includes(k));
}

// ---------------------------------------------------------------- shaders --

const HEAD = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform vec2 uRes;
uniform float uFlow;       // audio-driven time: runs faster when the music is loud
uniform float uBeats;      // beats counted so far
uniform float uLevel, uBass, uMid, uHigh, uBeat;
uniform float uSpec[${SPECTRUM_N}];
uniform vec3 uPa, uPb, uPc, uPd;
uniform float uSeed;
uniform float uAlpha;
uniform vec3 uFrom, uTarget; // Mandelbox dive: where it starts and the surface point it zooms into
uniform sampler2D uAtlas;  // emoji, 8x8 cells, row 0 at the top
uniform float uEmojiN;
#include <common>
#include <hash>
#include <noise>
vec3 pal(float t) { return uPa + uPb * cos(TAU * (uPc * t + uPd)); }
float spec(float x) {
  float f = clamp(x, 0.0, 1.0) * ${SPECTRUM_N - 1}.0;
  int i = int(floor(f));
  return mix(uSpec[i], uSpec[min(i + 1, ${SPECTRUM_N - 1})], fract(f));
}
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cdiv(vec2 a, vec2 b) { return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / max(dot(b, b), 1e-12); }
// one emoji from the atlas; q is 0..1 across its cell with y up, premultiplied
vec4 emoji(float idx, vec2 q) {
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || uEmojiN < 1.0) return vec4(0.0);
  idx = mod(floor(idx), uEmojiN);
  vec2 cell = vec2(mod(idx, 8.0), floor(idx / 8.0));
  // the emoji sit well inside their cells; fading the rim keeps the
  // neighbours from bleeding in through the smaller mip levels
  vec2 rim = smoothstep(0.0, 0.07, q) * smoothstep(1.0, 0.93, q);
  return texture(uAtlas, (cell + vec2(q.x, 1.0 - q.y)) / 8.0) * rim.x * rim.y;
}
`;

const MAIN = `
void main() {
  // the engine samples row 0 as the top of the picture, so y is flipped here
  // to make +y point up the wall
  vec2 frag = vec2(vUV.x, 1.0 - vUV.y) * uRes;
  vec2 p = (frag - 0.5 * uRes) / uRes.y;
  vec3 c = max(scene(p), 0.0);
  c = c * (1.0 + c / 4.0) / (1.0 + c);           // soft shoulder, white at 2
  c += (hash12(frag + fract(uFlow) * 91.0) - 0.5) / 255.0;   // dither the gradients
  o = vec4(c, uAlpha);
}
`;

const SCENES = {};

SCENES.tunnel = `
vec3 scene(vec2 p) {
  float r = length(p);
  float a = atan(p.y, p.x);
  // morph between a round tube and a hexagonal one
  float sides = 6.0;
  float hex = r * cos(PI / sides) / cos(mod(a + uFlow * 0.05, TAU / sides) - PI / sides);
  float rr = mix(r, hex, 0.5 + 0.5 * sin(uFlow * 0.07));
  float z = 0.3 / max(rr, 1e-3) + uFlow * 0.9;
  float u = a / TAU + z * 0.015 + uFlow * 0.01;
  float dz = abs(fract(z + 0.5) - 0.5);
  float du = abs(fract(u * sides * 2.0 + 0.5) - 0.5);
  float w = 0.03 + 0.05 * uBass;
  float g = w / (dz + w) * 0.7 + 0.015 / (du + 0.015) * 0.3;
  g *= g;
  float fade = smoothstep(0.02, 0.3, rr);
  float ring = floor(z);
  vec3 col = pal(ring * 0.07 + 0.12 * sin(a * 3.0) + uSeed) * g * fade;
  // every beat a different ring flares
  float lit = step(0.8, fract(ring * 0.37 + uBeats * 0.618));
  col *= 1.0 + lit * (0.6 + 2.5 * uBeat) * exp(-dz * 14.0);
  col += pal(uFlow * 0.02 + 0.5) * 0.03 / (r + 0.03) * (0.3 + 1.2 * uBass);
  return col * 1.2;
}`;

SCENES.liquid = `
vec3 scene(vec2 p) {
  vec2 q0 = p * 1.7;
  float t = uFlow * 0.07;
  vec2 q = vec2(fbm(q0 + vec2(0.0, t), 5), fbm(q0 + vec2(5.2, 1.3 - t), 5));
  float k = 3.0 + 2.5 * uBass;
  vec2 r = vec2(fbm(q0 + k * q + vec2(1.7, 9.2) + 0.6 * t, 5), fbm(q0 + k * q + vec2(8.3, 2.8) - 0.5 * t, 5));
  float f = fbm(q0 + k * r, 5);
  vec3 col = pal(f * 1.3 + length(q) * 0.4 + uSeed);
  col *= 0.15 + 1.6 * f * f;
  col += pal(r.x + 0.5) * pow(sat(r.y * 1.2), 4.0) * (0.4 + 0.8 * uHigh);
  float ridge = sat(1.0 - abs(f - 0.55) * 7.0);
  col += ridge * (0.15 + 0.5 * uMid) * pal(f + 0.25);
  return col;
}`;

SCENES.kaleido = `
vec3 scene(vec2 p) {
  float t = uFlow * 0.05;
  vec2 z = p * (1.5 - 0.3 * uBass);
  z = rot2(t) * z;
  float n = 6.0 + 2.0 * floor(mod(uSeed * 7.0, 3.0));
  float a = atan(z.y, z.x), r = length(z);
  float s = TAU / n;
  a = mod(a, s); a = abs(a - s * 0.5);
  z = r * vec2(cos(a), sin(a));
  vec2 c = vec2(0.82 + 0.1 * sin(t * 1.3), 0.55 + 0.1 * cos(t * 0.9)) + 0.05 * uMid;
  float trap = 1e9, trap2 = 1e9;
  float acc = 0.0;
  for (int i = 0; i < 9; i++) {
    z = abs(z) / max(dot(z, z), 0.03) - c;
    trap = min(trap, abs(length(z) - 0.4));
    trap2 = min(trap2, abs(z.y));
    acc += exp(-length(z) * 2.0);
  }
  vec3 col = pal(trap * 1.5 + t + uSeed) * (0.012 / (trap + 0.012));
  col += pal(trap2 * 2.0 + 0.4 + uSeed) * (0.006 / (trap2 + 0.006)) * 0.6;
  col += pal(acc * 0.1 + 0.6) * acc * 0.04;
  col *= 0.8 + 0.8 * uBeat;
  return col * smoothstep(1.3, 0.2, r);
}`;

SCENES.spectrum = `
vec3 scene(vec2 p) {
  float r = length(p);
  float a = atan(p.x, p.y);                // 0 at the top
  float m = abs(a) / PI;                   // mirrored left and right
  float N = ${SPECTRUM_N}.0;
  float cell = m * N;
  float id = min(floor(cell), N - 1.0);
  float s = uSpec[int(id)];
  float gap = smoothstep(0.1, 0.25, fract(cell)) * smoothstep(0.9, 0.75, fract(cell));
  float R = 0.19 + 0.05 * uBass;
  float len = 0.012 + s * 0.28;
  float d = r - R;
  vec3 bc = pal(id / N * 0.7 + uFlow * 0.01 + uSeed);
  float bar = gap * smoothstep(-0.002, 0.002, d) * (1.0 - smoothstep(len - 0.003, len + 0.003, d));
  vec3 col = bc * bar * (0.7 + 1.2 * s);
  col += bc * gap * step(0.0, d) * 0.015 / (abs(d - len) + 0.015) * s * 0.7;
  // the bars reflected into the ring, fainter
  float di = R - r - 0.012;
  col += bc * gap * 0.3 * smoothstep(0.0, 0.003, di) * (1.0 - smoothstep(len * 0.45, len * 0.45 + 0.004, di));
  col += pal(0.5 + uFlow * 0.01) * 0.003 / (abs(d + 0.006) + 0.003) * (0.5 + 1.5 * uBeat);
  col += pal(0.15 + uSeed) * smoothstep(R * 0.6, 0.0, r) * (0.05 + 0.5 * uBass);
  // dust orbiting outside
  vec2 g = rot2(uFlow * 0.04) * p * 16.0;
  vec2 gi = floor(g);
  float h = hash12(gi);
  vec2 off = (hash22(gi + 7.0) - 0.5) * 0.6;
  float dust = smoothstep(0.09, 0.0, length(fract(g) - 0.5 - off)) * step(0.82, h);
  col += pal(h + uSeed) * dust * (0.25 + 1.2 * uHigh) * smoothstep(R + 0.12, R + 0.4, r);
  return col;
}`;

SCENES.warp = `
vec3 scene(vec2 p) {
  float a = atan(p.y, p.x) / TAU + 0.5;
  float r = length(p);
  vec3 col = vec3(0.0);
  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    float N = 110.0 + fl * 80.0;
    float x = a * N + fl * 0.37;
    float id = mod(floor(x), N);
    float fa = fract(x);
    float h = hash11(id * 1.37 + fl * 113.0 + uSeed * 17.0);
    float z = fract(h * 7.0 + uFlow * (0.18 + h * 0.22));
    float rp = z * z * 1.3;
    float len = 0.01 + z * z * (0.15 + 0.35 * uLevel);
    float along = smoothstep(rp - len, rp, r) * (1.0 - smoothstep(rp, rp + 0.006, r));
    float across = pow(max(0.0, 1.0 - abs(fa - 0.5) * 2.0), 6.0);
    col += mix(vec3(1.0), pal(h + uSeed), 0.6) * along * across * z * 2.2;
  }
  col += pal(uSeed + 0.3) * 0.02 / (r + 0.02) * (0.4 + uBass);
  col *= 0.8 + 0.8 * uBeat;
  return col;
}`;

SCENES.cells = `
vec3 scene(vec2 p) {
  vec2 q = p * 4.0 + vec2(uFlow * 0.06, uFlow * 0.02);
  vec2 gi = floor(q), gf = fract(q);
  float f1 = 8.0, f2 = 8.0;
  vec2 id1 = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 h = hash22(gi + g);
    vec2 pt = g + 0.5 + 0.4 * sin(uFlow * 0.3 + TAU * h);
    float d = length(pt - gf);
    if (d < f1) { f2 = f1; f1 = d; id1 = gi + g; } else if (d < f2) f2 = d;
  }
  float e = f2 - f1;
  float h = hash12(id1);
  float lit = step(0.72, fract(h * 13.0 + uBeats * 0.618));
  vec3 base = pal(h * 0.5 + uSeed);
  vec3 col = base * (0.04 + lit * (0.25 + 0.9 * uBeat)) * (1.0 - f1 * 0.9);
  col += pal(h * 0.5 + 0.3 + uSeed) * 0.015 / (e + 0.015) * (0.4 + 1.0 * uMid);
  return col;
}`;

SCENES.horizon = `
vec3 scene(vec2 p) {
  float hz = -0.06;
  vec3 col;
  vec3 hot = mix(vec3(1.0, 0.25, 0.6), pal(0.9 + uSeed), 0.35);
  if (p.y > hz) {
    float y = p.y - hz;
    col = mix(hot * 0.8, vec3(0.06, 0.01, 0.16), sat(pow(y * 2.6, 0.7)));
    // stars
    vec2 sg = p * 60.0;
    float sh = hash12(floor(sg));
    col += step(0.985, sh) * smoothstep(0.3, 0.0, length(fract(sg) - 0.5)) * sat(y * 3.0) * (0.5 + 0.5 * sin(uFlow + sh * 50.0));
    // the sun, sliced
    vec2 sc = vec2(0.0, hz + 0.19);
    float R = 0.18 + 0.02 * uBass;
    float sd = length(p - sc);
    vec3 sunc = mix(vec3(1.0, 0.9, 0.3), vec3(1.0, 0.2, 0.55), sat((sc.y + R - p.y) / (2.0 * R)));
    float below = sat((sc.y - p.y) / R);
    float band = step(below * 0.55, fract((p.y - hz) * 22.0 - uFlow * 0.3));
    float sun = smoothstep(R, R - 0.004, sd) * mix(1.0, band, step(0.001, below));
    col = mix(col, sunc, sun);
    col += sunc * 0.3 * exp(-max(sd - R, 0.0) * 7.0) * (0.5 + uBass);
    // mountains that answer the spectrum
    float mh = 0.06 * fbm(vec2(p.x * 3.0 + 3.0, uSeed * 9.0), 4) + 0.03 + spec(abs(p.x) * 1.1) * 0.08;
    float inM = step(y, mh);
    vec3 mc = mix(vec3(0.02, 0.0, 0.06), hot * 0.15, sat(y / mh));
    col = mix(col, mc, inM);
    col += hot * 0.9 * exp(-abs(y - mh) * 260.0) * inM;
  } else {
    float y = hz - p.y;
    float z = 0.1 / y;
    vec2 g = vec2(p.x * z * 1.6, z + uFlow * 0.6);
    vec2 fw = fwidth(g);
    vec2 d = abs(fract(g + 0.5) - 0.5) / max(fw, 1e-4);
    float l = min(d.x, d.y);
    float line = 1.0 - min(l, 1.0);
    float fog = exp(-z * 0.18);
    vec3 gc = mix(hot, pal(g.y * 0.02 + uSeed), 0.3);
    col = vec3(0.03, 0.0, 0.07) + gc * (line * 1.3 + 0.35 * exp(-l * 0.25)) * fog * (0.6 + 0.9 * uBass);
    col += hot * 0.5 * exp(-y * 30.0);
  }
  return col;
}`;

SCENES.lava = `
vec3 scene(vec2 p) {
  float f = 0.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    vec2 c = vec2(sin(uFlow * 0.11 * (1.0 + fi * 0.13) + fi * 2.1) * 0.7,
                  cos(uFlow * 0.09 * (1.0 + fi * 0.17) + fi * 1.3) * 0.38);
    float r = 0.08 + 0.05 * hash11(fi + uSeed * 10.0) + 0.035 * uBass;
    vec2 v = p - c;
    float w = r * r / (dot(v, v) + 1e-4);
    f += w;
    acc += pal(fi * 0.11 + uSeed) * w;
  }
  vec3 base = acc / max(f, 1e-4);
  float inside = smoothstep(0.92, 1.08, f);
  float rim = exp(-abs(f - 1.0) * 5.0);
  vec3 col = base * inside * (0.35 + 0.35 * sat((f - 1.0) * 0.4));
  col += base * rim * (0.5 + 1.0 * uMid);
  col += base * 0.05 * sat(f);
  col *= 0.85 + 0.6 * uBeat;
  return col;
}`;

SCENES.lasers = `
vec3 scene(vec2 p) {
  vec3 col = vec3(0.0);
  float haze = fbm(p * 2.5 + vec2(uFlow * 0.05, -uFlow * 0.03), 4);
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    vec2 o = vec2((fi - 3.0) * 0.24, -0.56);
    float ang = sin(uFlow * 0.23 * (1.0 + 0.21 * fi) + fi * 1.7 + uSeed * 6.0) * 0.8;
    vec2 dir = vec2(sin(ang), cos(ang));
    vec2 v = p - o;
    float t = max(dot(v, dir), 0.0);
    float d = length(v - dir * t);
    float beam = 0.0012 / (d + 0.0012) + 0.25 * exp(-d * 90.0);
    beam *= exp(-t * 0.4);
    col += pal(fi * 0.13 + uSeed) * beam * (0.25 + 1.1 * haze);
  }
  col *= 0.55 + 1.3 * uBeat + 0.4 * uLevel;
  col += pal(uSeed + 0.2) * 0.12 * exp(-(p.y + 0.56) * 6.0) * (0.4 + uBass);
  return col;
}`;

SCENES.moire = `
vec3 scene(vec2 p) {
  vec2 c1 = vec2(sin(uFlow * 0.13), cos(uFlow * 0.11)) * 0.3;
  vec2 c2 = vec2(sin(uFlow * 0.07 + 2.0), cos(uFlow * 0.17 + 1.0)) * 0.3;
  float k = 55.0 + 12.0 * uBass;
  float w = sin(length(p - c1) * k - uFlow * 1.5) * sin(length(p - c2) * k + uFlow * 1.2);
  float b = sat(w / max(fwidth(w), 1e-4) * 0.5 + 0.5);
  vec3 col = pal(length(p) * 0.6 + uFlow * 0.02 + uSeed) * b;
  return col * (0.65 + 0.6 * uBeat);
}`;

// A continuous zoom towards one of a handful of famous spots, a new one each
// dive. float32 runs out of precision around 1e-4, so each dive stops there
// and dips to black before the next begins.
SCENES.mandelbrot = `
vec3 scene(vec2 p) {
  const float DEPTH = 8.5;
  float z0 = uFlow * 0.22;
  float dive = floor(z0 / DEPTH);
  float ph = z0 - dive * DEPTH;
  float k = mod(dive + floor(uSeed * 6.0), 6.0);
  vec2 target = k < 1.0 ? vec2(-0.743643887, 0.131825904)
              : k < 2.0 ? vec2(-0.1011, 0.9563)
              : k < 3.0 ? vec2(-1.2505, 0.02)
              : k < 4.0 ? vec2(0.2549, 0.0005)
              : k < 5.0 ? vec2(-0.7453, 0.1127)
              :           vec2(-1.7687, 0.0017);
  float scale = 1.6 * exp(-ph) * (1.0 - 0.06 * uBass);
  vec2 c = target + rot2(ph * 0.35 + dive) * p * scale;
  vec2 z = vec2(0.0);
  float n = 0.0;
  const float MAXI = 320.0;
  for (int i = 0; i < 320; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 256.0) break;
    n += 1.0;
  }
  vec3 col;
  if (n >= MAXI) {
    col = pal(uSeed + 0.5) * 0.04 * (0.3 + uBass);
  } else {
    float sn = n - log2(log2(dot(z, z))) + 4.0;
    col = pal(sqrt(sn) * 0.35 + uFlow * 0.03 + uSeed);
    col *= 0.55 + 0.45 * sin(sn * 0.35 - uFlow * 2.0);
    col *= 1.0 + 0.6 * uBeat;
  }
  float fade = smoothstep(0.0, 0.5, ph) * smoothstep(DEPTH, DEPTH - 0.5, ph);
  return col * fade;
}`;

SCENES.julia = `
vec3 scene(vec2 p) {
  float t = uFlow * 0.07;
  vec2 cc = 0.7885 * vec2(cos(t + uSeed * 6.0), sin(t * 1.13 + uSeed * 6.0));
  vec2 z = rot2(t * 0.5) * p * (1.8 - 0.3 * uBass);
  float n = 0.0, trap = 1e9;
  for (int i = 0; i < 200; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + cc;
    trap = min(trap, abs(dot(z, z) - 0.25));
    if (dot(z, z) > 256.0) break;
    n += 1.0;
  }
  vec3 col;
  if (n >= 200.0) col = pal(trap * 3.0 + uSeed) * 0.25;
  else {
    float sn = n - log2(log2(dot(z, z))) + 4.0;
    col = pal(sn * 0.045 + t + uSeed) * (0.12 + 0.88 * sat(sn / 28.0));
  }
  col += pal(trap + 0.5 + uSeed) * 0.01 / (trap + 0.01) * (0.4 + 0.8 * uMid);
  return col * (0.9 + 0.5 * uBeat);
}`;

// relaxed Newton's method on z^3 - 1: each pixel is coloured by the root it
// falls into and how long it takes; the relaxation wobbles with the music
SCENES.newton = `
vec3 scene(vec2 p) {
  float t = uFlow * 0.05;
  vec2 z = rot2(t) * p * (2.2 - 0.3 * uBass);
  vec2 a = vec2(1.0 + 0.35 * sin(t * 1.7), 0.25 * sin(t * 1.1 + uSeed * 6.0));
  float n = 0.0;
  for (int i = 0; i < 40; i++) {
    vec2 z2 = cmul(z, z);
    vec2 step_ = cmul(a, cdiv(cmul(z2, z) - vec2(1.0, 0.0), 3.0 * z2));
    z -= step_;
    if (dot(step_, step_) < 1e-6) break;
    n += 1.0;
  }
  float root = atan(z.y, z.x) / TAU + 0.5;
  float shade = exp(-n * 0.07);
  vec3 col = pal(floor(root * 3.0 + 0.5) / 3.0 + n * 0.015 + uSeed) * (0.2 + 0.9 * shade);
  col += pal(n * 0.05 + 0.5) * 0.25 * (1.0 - shade) * (0.4 + uHigh);
  return col * (0.85 + 0.5 * uBeat);
}`;

// emoji on a log-polar grid: rings of them stream out of the centre, each
// one standing upright with respect to the circle it rides on
SCENES.emoji = `
vec3 scene(vec2 p) {
  float r = length(p), a = atan(p.y, p.x);
  const float N = 11.0;
  vec2 lp = vec2(a / TAU * N, log(max(r, 1e-4)) * N / TAU);
  lp.y -= uFlow * 0.35;
  lp.x += lp.y * 0.35 + uFlow * 0.05;
  vec2 id = floor(lp);
  vec2 q = fract(lp) - 0.5;
  float h = hash12(vec2(mod(id.x, N), id.y));
  float pulse = 0.78 + 0.22 * step(0.6, h) * uBeat + 0.1 * uBass;
  q = rot2(sin(uFlow * 0.5 + h * TAU) * 0.25) * q / pulse;
  vec4 e = emoji(h * 97.0 + floor(uBeats / 8.0 + h) * 7.0, q + 0.5);
  vec3 bg = pal(lp.y * 0.05 + uSeed) * (0.05 + 0.05 * sin(lp.y * PI * 2.0));
  bg += pal(uSeed + 0.5) * 0.04 / (r + 0.04) * (0.3 + uBass);
  vec3 col = bg * (1.0 - e.a) + e.rgb * (0.9 + 0.3 * uBeat);
  return col * smoothstep(0.0, 0.06, r);
}`;

SCENES.emojiwall = `
vec3 scene(vec2 p) {
  vec2 g = p * 6.0 + vec2(uFlow * 0.25, uFlow * 0.12);
  vec2 id = floor(g);
  vec2 q = fract(g) - 0.5;
  float h = hash12(id);
  float col_ = abs(mod(id.x, 24.0) - 12.0) / 12.0;
  float s = spec(col_);
  float scale = 0.5 + 0.35 * s + 0.2 * uBeat * step(0.5, h);
  q = rot2(sin(uFlow * 0.8 + h * TAU) * 0.35) * q / scale;
  q.y -= 0.08 * sin(uFlow * 2.0 + id.x * 0.7);
  float idx = h * 61.0 + floor(uBeats * 0.25 + h * 4.0) * 3.0;
  vec4 e = emoji(idx, q + 0.5);
  // one smooth field behind them all, with a round glow under each emoji, so
  // nothing draws the grid of cells
  vec3 bg = pal(p.x * 0.35 + p.y * 0.2 + uFlow * 0.02 + uSeed) * (0.06 + 0.16 * spec(abs(p.x)));
  vec2 qc = fract(g) - 0.5;
  bg += pal(h * 0.3 + uSeed) * smoothstep(0.5, 0.0, length(qc)) * (0.05 + 0.3 * s);
  return bg * (1.0 - e.a) + e.rgb * (0.9 + 0.3 * uBeat);
}`;

// The 3-D fractals are raymarched, so they draw at a fraction of the size and
// the engine's linear filter scales them up; a soft picture reads fine on a wall.
const SCENE_SCALE = { mandelbulb: 0.5, menger: 0.6, mandelbox: 0.55, nebula: 0.5, gyroid: 0.6, cathedral: 0.5, sierpinski: 0.6, train: 0.6 };

// Mandelbox constants, shared by the shader and the CPU copy that finds
// somewhere on the surface to dive into. Detail grows with depth: the formula
// runs 8 iterations at the start of a dive and 1.5 more per e-fold of zoom, so
// there is always new structure coming into view instead of blobs.
const boxIters = (ph) => Math.min(BOX_ITERS, Math.floor(8 + 1.5 * ph));
const BOX_SCALE = -1.5, BOX_ITERS = 22, BOX_DEPTH = 9, BOX_RATE = 0.3;

const RAY = `
mat3 lookAt(vec3 ro, vec3 ta, float roll) {
  vec3 f = normalize(ta - ro);
  vec3 up = vec3(sin(roll), cos(roll), 0.0);
  vec3 r = normalize(cross(f, up));
  return mat3(r, cross(r, f), f);
}
`;

// The 3-D Mandelbrot. The camera swings round it, now wide, now skimming the
// surface, while the power of the formula slowly morphs the whole shape.
SCENES.mandelbulb = RAY + `
float gTrap;
float power;
float bulb(vec3 p) {
  vec3 z = p;
  float dr = 1.0, r = 0.0;
  gTrap = 1e9;
  for (int i = 0; i < 7; i++) {
    r = length(z);
    if (r > 2.0) break;
    float th = acos(clamp(z.z / r, -1.0, 1.0)) * power;
    float ph = atan(z.y, z.x) * power;
    dr = pow(r, power - 1.0) * power * dr + 1.0;
    z = pow(r, power) * vec3(sin(th) * cos(ph), sin(th) * sin(ph), cos(th)) + p;
    gTrap = min(gTrap, dot(z, z));
  }
  return 0.5 * log(r) * r / dr;
}
vec3 scene(vec2 p) {
  float t = uFlow * 0.06;
  power = 8.0 + 2.0 * sin(t * 0.7);
  float dist = 1.45 + 0.85 * (0.5 + 0.5 * cos(t * 0.9));
  vec3 ro = dist * normalize(vec3(sin(t), 0.45 * sin(t * 0.6 + 1.0), cos(t)));
  vec3 ta = 0.35 * vec3(sin(t * 1.3), cos(t * 0.8), 0.0);
  vec3 rd = lookAt(ro, ta, 0.2 * sin(t * 0.5)) * normalize(vec3(p, 1.6));
  float d = 0.0, glow = 0.0, steps = 0.0;
  bool hit = false;
  for (int i = 0; i < 110; i++) {
    float h = bulb(ro + rd * d);
    glow += 0.012 / (0.02 + h * h * 30.0);
    if (h < 0.0007 * d) { hit = true; break; }
    d += h * 0.9;
    steps += 1.0;
    if (d > 6.0) break;
  }
  vec3 bg = pal(uSeed + 0.6 + p.y * 0.2) * 0.05;
  vec3 col = bg;
  if (hit) {
    vec3 pos = ro + rd * d;
    float trap = gTrap;
    vec2 e = vec2(0.0008 * d, -0.0008 * d);
    vec3 n = normalize(e.xyy * bulb(pos + e.xyy) + e.yyx * bulb(pos + e.yyx) + e.yxy * bulb(pos + e.yxy) + e.xxx * bulb(pos + e.xxx));
    vec3 L = normalize(vec3(0.6, 0.7, -0.4));
    float dif = max(dot(n, L), 0.0);
    float ao = 1.0 - steps / 110.0;
    vec3 base = pal(sqrt(trap) * 0.7 + uSeed + t * 0.2);
    col = base * (0.15 + 0.9 * dif) * ao * ao;
    col += pal(uSeed + 0.3) * pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * (0.3 + 0.9 * uBass);
    col += vec3(1.0) * pow(max(dot(reflect(rd, n), L), 0.0), 24.0) * 0.4;
  }
  col += pal(uSeed + 0.8) * glow * 0.02 * (0.5 + 1.5 * uBass);
  return col * (0.9 + 0.5 * uBeat);
}`;

// The golden box: an exponential zoom towards a point on the Mandelbox's
// surface, along a line of sight known to be clear. Each dive goes about four
// orders of magnitude deep, which is as far as float32 goes, then a new one
// starts somewhere else.
SCENES.mandelbox = RAY + `
float gTrap;
int gIters;
float mbox(vec3 p) {
  vec3 z = p;
  float dr = 1.0;
  gTrap = 1e9;
  for (int i = 0; i < ${BOX_ITERS}; i++) {
    if (i >= gIters) break;
    z = clamp(z, -1.0, 1.0) * 2.0 - z;
    float r2 = dot(z, z);
    if (r2 < 0.25) { z *= 4.0; dr *= 4.0; }
    else if (r2 < 1.0) { z /= r2; dr /= r2; }
    z = z * (${BOX_SCALE.toFixed(2)}) + p;
    dr = dr * ${Math.abs(BOX_SCALE).toFixed(1)} + 1.0;
    gTrap = min(gTrap, r2);
  }
  return length(z) / abs(dr);
}
vec3 scene(vec2 p) {
  float ph = mod(uFlow * ${BOX_RATE}, ${BOX_DEPTH.toFixed(1)});
  gIters = min(${BOX_ITERS}, int(8.0 + 1.5 * ph));
  vec3 ro = uTarget + (uFrom - uTarget) * exp(-ph);
  float scale = length(ro - uTarget);
  vec3 ta = uTarget;
  vec3 rd = lookAt(ro, ta, ph * 0.3) * normalize(vec3(p, 1.3));
  float d = 0.0, steps = 0.0;
  bool hit = false;
  for (int i = 0; i < 120; i++) {
    float h = mbox(ro + rd * d);
    if (h < 0.003 * d) { hit = true; break; }
    d += h * 0.9;
    steps += 1.0;
    if (d > scale * 12.0) break;
  }
  vec3 gold = mix(vec3(1.0, 0.72, 0.25), pal(uSeed), 0.2);
  vec3 col = gold * 0.04 * (0.5 + uBass);
  if (hit) {
    vec3 pos = ro + rd * d;
    float trap = gTrap;
    vec2 e = vec2(0.004 * d, -0.004 * d);
    vec3 n = normalize(e.xyy * mbox(pos + e.xyy) + e.yyx * mbox(pos + e.yyx) + e.yxy * mbox(pos + e.yxy) + e.xxx * mbox(pos + e.xxx));
    vec3 L = normalize(vec3(0.5, 0.8, -0.3));
    float dif = 0.55 * max(dot(n, L), 0.0) + 0.6 * max(dot(n, -rd), 0.0);   // sun and headlamp
    float ao = pow(1.0 - steps / 120.0, 1.5);
    vec3 base = mix(gold, pal(sat(trap) * 0.4 + uSeed), 0.15);
    col = base * (0.15 + 1.1 * dif) * ao * 1.4;
    col += gold * pow(max(dot(reflect(rd, n), L), 0.0), 20.0) * 0.8;
    col += gold * pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * 0.5 * (0.4 + uMid);
    col = mix(col, gold * 0.04, 1.0 - exp(-d / scale * 0.15));
  }
  float fade = smoothstep(0.0, 0.6, ph) * smoothstep(${BOX_DEPTH.toFixed(1)}, ${(BOX_DEPTH - 0.6).toFixed(1)}, ph);
  return col * fade * (0.9 + 0.4 * uBeat);
}`;

// A volumetric fractal: Kali's "abs(p)/dot(p,p) - c" fold sampled through a
// slab of space the camera drifts through, glowing where the orbit settles.
SCENES.nebula = `
vec3 scene(vec2 p) {
  float t = uFlow * 0.03;
  vec3 dir = normalize(vec3(p, 1.0));
  dir.xz = rot2(t * 0.7) * dir.xz;
  dir.xy = rot2(t * 0.4) * dir.xy;
  vec3 from = vec3(1.0, 0.5, 0.5) + vec3(t * 2.0, t, -2.0);
  float c = 0.53 + 0.02 * sin(t * 3.0) + 0.012 * uBass;
  float sdist = 0.1, fade = 1.0;
  vec3 v = vec3(0.0);
  for (int r = 0; r < 18; r++) {
    vec3 q = from + sdist * dir * 0.5;
    q = abs(vec3(0.85) - mod(q, vec3(1.7)));
    float pa = 0.0, a = 0.0;
    for (int i = 0; i < 16; i++) {
      q = abs(q) / dot(q, q) - c;
      float l = length(q);
      a += abs(l - pa);
      pa = l;
    }
    a *= a * a;
    float dm = max(0.0, 0.3 - a * a * 0.001);
    if (r > 6) fade *= 1.0 - dm;
    v += fade;
    v += pal(sdist * 0.25 + uSeed + t) * a * 0.0012 * fade * (0.6 + 0.8 * uMid);
    fade *= 0.73;
    sdist += 0.1;
  }
  vec3 col = mix(vec3(length(v)), v, 0.85) * 0.012;
  return col * (0.85 + 0.6 * uBeat);
}`;

// Flying down a tunnel bored through a gyroid, the minimal surface that
// divides space into two interlocking labyrinths
SCENES.gyroid = RAY + `
vec2 path(float z) { return vec2(sin(z * 0.23) * 1.2, cos(z * 0.17) * 0.9); }
float gyroidDE(vec3 p) {
  float g = abs(dot(sin(p * 2.0), cos(p.zxy * 2.0))) / 2.0 - 0.05 - 0.04 * uBass;
  float tunnel = 0.9 - length(p.xy - path(p.z));
  return max(g * 0.7, tunnel);
}
vec3 scene(vec2 p) {
  float z = uFlow * 0.8;
  vec3 ro = vec3(path(z), z);
  vec3 ta = vec3(path(z + 1.5), z + 1.5);
  vec3 rd = lookAt(ro, ta, sin(z * 0.11) * 0.6) * normalize(vec3(p, 1.0));
  float d = 0.0, steps = 0.0;
  bool hit = false;
  for (int i = 0; i < 80; i++) {
    float h = gyroidDE(ro + rd * d);
    if (h < 0.001 * d) { hit = true; break; }
    d += h;
    steps += 1.0;
    if (d > 16.0) break;
  }
  vec3 col = vec3(0.0);
  if (hit) {
    vec3 pos = ro + rd * d;
    vec2 e = vec2(0.002, -0.002);
    vec3 n = normalize(e.xyy * gyroidDE(pos + e.xyy) + e.yyx * gyroidDE(pos + e.yyx) + e.yxy * gyroidDE(pos + e.yxy) + e.xxx * gyroidDE(pos + e.xxx));
    float ao = 1.0 - steps / 80.0;
    vec3 base = pal(pos.z * 0.04 + uSeed);
    col = base * (0.2 + 0.8 * max(dot(n, -rd), 0.0)) * ao;
    // neon contour lines that race along the walls with the beat
    float lines = abs(fract(pos.z * 0.5 - uFlow * 0.5) - 0.5);
    col += pal(uSeed + 0.5) * smoothstep(0.04, 0.0, lines) * (0.5 + 2.0 * uBeat);
    col /= 1.0 + d * d * 0.02;
  }
  return col * 1.3;
}`;

// A kaleidoscopic IFS: fold into one octant, sort, scale and offset, with two
// rotations between steps that the music keeps turning — a structure that is
// part cathedral, part crystal.
SCENES.cathedral = RAY + `
float gTrap;
mat2 R1, R2;
float kifs(vec3 p) {
  float s = 1.0;
  gTrap = 1e9;
  // Knighty's Menger-type fold (scale 3, offset 1) with two turns per step
  for (int i = 0; i < 6; i++) {
    p = abs(p);
    if (p.x < p.y) p.xy = p.yx;
    if (p.x < p.z) p.xz = p.zx;
    if (p.y < p.z) p.yz = p.zy;
    p.xy = R1 * p.xy;
    p.yz = R2 * p.yz;
    p.xy = p.xy * 3.0 - 2.0;
    p.z *= 3.0;
    if (p.z > 1.0) p.z -= 2.0;
    s *= 3.0;
    gTrap = min(gTrap, dot(p, p));
  }
  vec3 b = abs(p) - vec3(1.0);
  return (min(max(b.x, max(b.y, b.z)), 0.0) + length(max(b, 0.0))) / s;
}
vec3 scene(vec2 p) {
  float t = uFlow * 0.05;
  R1 = rot2(0.14 + 0.12 * sin(t * 0.9) + 0.04 * uBass);
  R2 = rot2(0.08 + 0.1 * cos(t * 0.7));
  float dist = 2.3 + 0.5 * sin(t * 0.4);
  vec3 ro = vec3(dist * sin(t), 0.9 * sin(t * 0.6), dist * cos(t));
  vec3 rd = lookAt(ro, vec3(0.0), 0.0) * normalize(vec3(p, 1.5));
  float d = 0.0, steps = 0.0, glow = 0.0;
  bool hit = false;
  for (int i = 0; i < 100; i++) {
    float h = kifs(ro + rd * d);
    glow += 0.01 / (0.01 + h * h * 200.0);
    if (h < 0.0008 * d) { hit = true; break; }
    d += h;
    steps += 1.0;
    if (d > 9.0) break;
  }
  vec3 col = pal(uSeed + 0.7) * 0.03;
  if (hit) {
    vec3 pos = ro + rd * d;
    float trap = gTrap;
    vec2 e = vec2(0.001 * d, -0.001 * d);
    vec3 n = normalize(e.xyy * kifs(pos + e.xyy) + e.yyx * kifs(pos + e.yyx) + e.yxy * kifs(pos + e.yxy) + e.xxx * kifs(pos + e.xxx));
    float ao = pow(1.0 - steps / 100.0, 2.0);
    vec3 base = pal(sqrt(trap) * 0.3 + uSeed);
    vec3 L = normalize(vec3(0.4, 0.8, -0.3));
    col = base * (0.2 + 0.8 * max(dot(n, L), 0.0) + 0.6 * max(dot(n, -rd), 0.0)) * ao * 2.0;
    col += pal(uSeed + 0.5 + trap * 0.1) * pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * (0.5 + uMid);
  }
  col += pal(uSeed + 0.3) * glow * 0.02 * (0.4 + 1.6 * uBeat);
  return col;
}`;

// The Sierpinski tetrahedron is exactly self-similar about each corner at a
// factor of two, so zooming into one by 2x lands on the same picture: an
// endless zoom with no restart, turning as it goes.
SCENES.sierpinski = RAY + `
float gTrap;
float tet(vec3 z) {
  float s = 1.0;
  gTrap = 1e9;
  for (int i = 0; i < 13; i++) {
    if (z.x + z.y < 0.0) z.xy = -z.yx;
    if (z.x + z.z < 0.0) z.xz = -z.zx;
    if (z.y + z.z < 0.0) z.zy = -z.yz;
    z = z * 2.0 - vec3(1.0);
    s *= 2.0;
    gTrap = min(gTrap, dot(z, z));
  }
  return (length(z) - 1.2) / s;
}
vec3 scene(vec2 p) {
  float ph = fract(uFlow * 0.12);
  float k = exp2(-ph);
  vec3 V = vec3(1.0);
  vec3 axis = normalize(vec3(1.0, 1.0, 1.0));
  vec3 off = normalize(vec3(1.0, -0.6, 0.2)) * 0.9 + axis * 0.8;
  vec3 ro = V + off * k;
  vec3 ta = V - axis * 0.6 * k;
  vec3 rd = lookAt(ro, ta, uFlow * 0.06) * normalize(vec3(p, 1.2));
  float d = 0.0, steps = 0.0;
  bool hit = false;
  for (int i = 0; i < 100; i++) {
    float h = tet(ro + rd * d);
    if (h < 0.0015 * d) { hit = true; break; }
    d += h;
    steps += 1.0;
    if (d > 6.0 * k) break;
  }
  vec3 col = pal(uSeed + 0.6) * 0.03;
  if (hit) {
    vec3 pos = ro + rd * d;
    float trap = gTrap;
    vec2 e = vec2(0.001 * d, -0.001 * d);
    vec3 n = normalize(e.xyy * tet(pos + e.xyy) + e.yyx * tet(pos + e.yyx) + e.yxy * tet(pos + e.yxy) + e.xxx * tet(pos + e.xxx));
    float ao = pow(1.0 - steps / 100.0, 2.5);
    // colour by depth in the hierarchy, which the zoom keeps cycling
    vec3 base = pal(log2(length(pos - V) / k + 1e-3) * 0.25 + uSeed + trap * 0.02);
    col = base * (0.2 + 0.9 * max(dot(n, -rd), 0.0)) * ao * 1.4;
    col += pal(uSeed + 0.5) * pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * (0.3 + uBeat);
  }
  return col;
}`;

// Circles packed inside circles forever, by repeated fold-and-invert
SCENES.apollonian = `
vec3 scene(vec2 p) {
  float t = uFlow * 0.04;
  float zoom = 1.2 + 0.6 * sin(t * 0.8);
  vec2 z = rot2(t * 0.3) * p * zoom * 2.0 + vec2(sin(t) * 0.3, cos(t * 0.7) * 0.3);
  float s = 1.0, trap = 1e9;
  float kk = 1.25 + 0.08 * sin(t * 1.3) + 0.03 * uBass;
  for (int i = 0; i < 9; i++) {
    z = -1.0 + 2.0 * fract(0.5 * z + 0.5);
    float r2 = dot(z, z);
    float k = kk / r2;
    z *= k;
    s *= k;
    trap = min(trap, r2);
  }
  float d = 0.25 * abs(z.y) / s;
  float line = 0.0025 / (d + 0.0025);
  vec3 col = pal(log(s) * 0.12 + t + uSeed) * line;
  col += pal(trap * 2.0 + uSeed + 0.5) * 0.15 * (0.3 + uMid);
  return col * (0.9 + 0.6 * uBeat);
}`;

// The Burning Ship: the Mandelbrot formula with absolute values, dived into
// its armada of little ships; drawn keel down
SCENES.burningship = `
vec3 scene(vec2 p) {
  const float DEPTH = 7.5;
  float z0 = uFlow * 0.2;
  float dive = floor(z0 / DEPTH);
  float ph = z0 - dive * DEPTH;
  float k = mod(dive + floor(uSeed * 4.0), 4.0);
  vec2 target = k < 1.0 ? vec2(-1.7621, -0.0281)
              : k < 2.0 ? vec2(-1.8617, -0.0015)
              : k < 3.0 ? vec2(-1.5755, -0.0355)
              :           vec2(-1.9408, -0.0008);
  float scale = 1.8 * exp(-ph);
  vec2 c = target + vec2(p.x, -p.y) * scale;
  vec2 z = vec2(0.0);
  float n = 0.0;
  for (int i = 0; i < 300; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * abs(z.x * z.y)) + c;
    if (dot(z, z) > 256.0) break;
    n += 1.0;
  }
  vec3 col = vec3(0.0);
  if (n < 300.0) {
    float sn = n - log2(log2(dot(z, z))) + 4.0;
    col = pal(sqrt(sn) * 0.4 + uFlow * 0.02 + uSeed) * (0.25 + 0.75 * sat(sn / 30.0));
  }
  float fade = smoothstep(0.0, 0.5, ph) * smoothstep(DEPTH, DEPTH - 0.5, ph);
  return col * fade * (0.9 + 0.5 * uBeat);
}`;

// Lyapunov fractal: the logistic map driven by two growth rates in turn; the
// exponent says where it settles (solid) and where it goes chaotic (glow)
SCENES.lyapunov = `
vec3 scene(vec2 p) {
  float t = uFlow * 0.03;
  vec2 ab = vec2(3.4, 3.4) + rot2(t * 0.2) * p * (0.9 + 0.3 * sin(t * 0.5)) + vec2(0.25 * sin(t), 0.25 * cos(t * 0.8));
  ab = clamp(ab, 2.0, 4.0);
  float x = 0.5, lam = 0.0;
  for (int i = 0; i < 120; i++) {
    int m = i % 6;
    float r = (m == 0 || m == 1 || m == 3) ? ab.x : ab.y;   // the sequence AABABB
    x = r * x * (1.0 - x);
    if (i > 20) lam += log(abs(r * (1.0 - 2.0 * x)) + 1e-6);
  }
  lam /= 100.0;
  vec3 col = lam < 0.0
    ? pal(-lam * 1.5 + uSeed) * (0.25 + 0.9 * sat(-lam * 2.0))
    : pal(uSeed + 0.5) * exp(-lam * 6.0) * 0.5;
  col += pal(uSeed + 0.2) * smoothstep(0.05, 0.0, abs(lam)) * (0.4 + 1.2 * uBeat);
  return col;
}`;

// Plane waves at 7-fold symmetry add up to a pattern that never repeats
SCENES.quasicrystal = `
vec3 scene(vec2 p) {
  float t = uFlow * 0.6;
  float n = 7.0;
  float freq = 28.0 + 6.0 * uBass;
  float v = 0.0;
  vec2 q = rot2(uFlow * 0.02) * p;
  for (int k = 0; k < 7; k++) {
    float a = float(k) * PI / n;
    v += cos(dot(q, vec2(cos(a), sin(a))) * freq + t);
  }
  v = v / n * 0.5 + 0.5;
  float bands = fract(v * 3.0 + uFlow * 0.05);
  vec3 col = pal(v + uFlow * 0.02 + uSeed) * (0.2 + 0.8 * smoothstep(0.0, 0.5, bands) * smoothstep(1.0, 0.5, bands));
  return col * (0.8 + 0.7 * uBeat);
}`;

SCENES.hypno = `
vec3 scene(vec2 p) {
  float r = length(p), a = atan(p.y, p.x);
  float arms = 3.0 + floor(mod(uSeed * 10.0, 4.0));
  float wob = 0.05 * sin(r * 20.0 - uFlow * 3.0) * (0.3 + uBass);
  float v = log(r + 1e-3) * 2.5 - a * arms / TAU - uFlow * 0.6 + wob;
  float band = fract(v);
  float edge = smoothstep(0.0, 0.03, band) * smoothstep(0.5, 0.47, band);
  // one colour per arm, so the stripe that wraps round meets itself
  vec3 col = pal(mod(floor(v), arms) / arms + log(r + 1e-3) * 0.08 + uSeed) * edge;
  col += pal(log(r + 1e-3) * 0.3 + uSeed + 0.5) * (1.0 - edge) * 0.08;
  // the beat flips the stripes
  col = mix(col, pal(uSeed + 0.3) * (1.0 - edge), step(0.85, uBeat) * 0.7);
  return col * smoothstep(0.0, 0.05, r) * 1.2;
}`;

SCENES.acid = `
vec3 scene(vec2 p) {
  float t = uFlow * 0.4;
  vec2 q = p * 3.0;
  for (int i = 1; i < 6; i++) {
    float fi = float(i);
    q += vec2(0.6 / fi * sin(fi * q.y + t + 0.3 * fi), 0.6 / fi * cos(fi * q.x + t * 0.8 + 0.3 * fi)) * (1.0 + 0.5 * uBass);
  }
  float v = 0.5 + 0.5 * sin(q.x + q.y);
  float lv = floor(v * 6.0) / 6.0;             // posterised, the acid look
  vec3 col = pal(mix(v, lv, 0.7) + uFlow * 0.03 + uSeed);
  col *= 0.4 + 0.6 * smoothstep(0.0, 0.3, fract(v * 6.0)) + 0.4 * uBeat;
  return col;
}`;

// Falling down a square shaft whose walls are a fine grid, with openings cut
// in a Menger-carpet pattern: windows, windows inside windows, and so on.
// Drawn analytically (each wall is a plane), so it stays razor sharp.
SCENES.shaft = `
float carpet(vec2 c) {
  // 1 inside a hole at any of four scales of the carpet
  for (int l = 0; l < 4; l++) {
    vec2 d = mod(floor(c), 3.0);
    if (d.x == 1.0 && d.y == 1.0) return 1.0;
    c /= 3.0;
  }
  return 0.0;
}
float gridLine(vec2 w, float width) {
  vec2 fw = fwidth(w);
  vec2 d = abs(fract(w + 0.5) - 0.5);
  vec2 l = 1.0 - smoothstep(width - fw, width + fw, d);
  // too fine to draw: settle to the average coverage instead of shimmering
  return mix(max(l.x, l.y), width * 3.0, smoothstep(0.25, 0.6, max(fw.x, fw.y)));
}
vec3 scene(vec2 p) {
  vec2 q = p / vec2(0.5 * uRes.x / uRes.y, 0.5);        // the frame is the shaft's cross-section
  q = rot2(0.08 * sin(uFlow * 0.05)) * q;
  float r = max(abs(q.x), abs(q.y));
  bool side = abs(q.x) > abs(q.y);
  float depth = 1.0 / max(r, 1e-3);
  float z = depth + uFlow * 0.35;
  float u = side ? q.y / abs(q.x) : q.x / abs(q.y);     // -1..1 across the wall
  vec2 w = vec2(u * 13.5, z * 13.5);                    // 27 cells across each wall
  float hole = carpet(vec2(w.x + 13.5, w.y) / 1.0);
  float fine = gridLine(w, 0.035 + 0.025 * uBass);
  // the openings get a heavier frame and a darker, deeper inside
  float frame = gridLine(w / 3.0, 0.025);
  vec3 cream = mix(vec3(1.0, 0.95, 0.72), pal(z * 0.02 + uSeed), 0.25);
  float face = side ? 0.55 : 1.0;                        // side walls in shade
  vec3 col = cream * face * mix(fine, frame * 0.8, hole);
  col += cream * 0.05 * face * (1.0 - hole);
  // lines light up in bands that race down the shaft on the beat
  float band = step(0.8, fract(floor(z * 1.5) * 0.37 + uBeats * 0.618));
  col *= 1.0 + band * uBeat * 1.5;
  col *= exp(-depth * 0.09);                              // far down is dark
  return col * 1.2;
}`;

function mboxDE(x, y, z, iters = BOX_ITERS) {
  let a = x, b = y, c = z, dr = 1;
  for (let i = 0; i < iters; i++) {
    a = Math.min(1, Math.max(-1, a)) * 2 - a;
    b = Math.min(1, Math.max(-1, b)) * 2 - b;
    c = Math.min(1, Math.max(-1, c)) * 2 - c;
    const r2 = a * a + b * b + c * c;
    if (r2 < 0.25) { a *= 4; b *= 4; c *= 4; dr *= 4; }
    else if (r2 < 1) { a /= r2; b /= r2; c /= r2; dr /= r2; }
    a = a * BOX_SCALE + x; b = b * BOX_SCALE + y; c = c * BOX_SCALE + z;
    dr = dr * Math.abs(BOX_SCALE) + 1;
  }
  return Math.hypot(a, b, c) / Math.abs(dr);
}

// Somewhere on the surface to dive into, and a clear place to start from.
// Of a few candidates, take the one with the most going on around it: a spot
// half inside and half outside the fractal at several scales is a crevice or
// a lattice, where a flat face would be all one or the other.
function boxDive(seed, dive) {
  const rnd = (i) => ihash(seed + dive * 7919, i) / 4294967296;
  let best = null, bestScore = -1;
  for (let attempt = 0; attempt < 40 && bestScore < 2.4; attempt++) {
    const d = boxRay(rnd, attempt);
    if (!d || !boxPathClear(d)) continue;
    const [hx, hy, hz] = d.target;
    let score = 0;
    for (const r of [0.3, 0.08, 0.02]) {
      let solid = 0;
      for (let i = 0; i < 14; i++) {
        const u = rnd(1000 + attempt * 64 + i * 3) * 2 - 1, v = rnd(1001 + attempt * 64 + i * 3) * 2 - 1, w = rnd(1002 + attempt * 64 + i * 3) * 2 - 1;
        if (mboxDE(hx + u * r, hy + v * r, hz + w * r) < r * 0.05) solid++;
      }
      score += 1 - Math.abs(solid / 14 - 0.5) * 2;
    }
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best || { from: [0, 0, 9], target: [0, 0, 6] };
}

// The camera must stay outside the fractal at every depth of the dive, with
// the detail it will have there.
function boxPathClear({ from, target }) {
  for (let ph = 0; ph <= BOX_DEPTH; ph += 0.25) {
    const k = Math.exp(-ph);
    const x = target[0] + (from[0] - target[0]) * k, y = target[1] + (from[1] - target[1]) * k, z = target[2] + (from[2] - target[2]) * k;
    const scale = Math.hypot(from[0] - target[0], from[1] - target[1], from[2] - target[2]) * k;
    if (mboxDE(x, y, z, boxIters(ph)) < scale * 0.15) return false;
  }
  return true;
}

function boxRay(rnd, attempt) {
  const k = attempt * 8;
  let dx = rnd(k) * 2 - 1, dy = (rnd(k + 1) * 2 - 1) * 0.7, dz = rnd(k + 2) * 2 - 1;
  const dl = Math.hypot(dx, dy, dz) || 1;
  const R = (2 * (Math.abs(BOX_SCALE) + 1)) / (Math.abs(BOX_SCALE) - 1) + 2;   // outside the whole box
  const sx = (dx / dl) * R, sy = (dy / dl) * R, sz = (dz / dl) * R;
  const ax = (rnd(k + 3) * 2 - 1) * 3, ay = (rnd(k + 4) * 2 - 1) * 3, az = (rnd(k + 5) * 2 - 1) * 3;
  let rx = ax - sx, ry = ay - sy, rz = az - sz;
  const rl = Math.hypot(rx, ry, rz); rx /= rl; ry /= rl; rz /= rl;
  let t = 0;
  for (let i = 0; i < 600 && t < 40; i++) {
    const h = mboxDE(sx + rx * t, sy + ry * t, sz + rz * t);
    if (h < 1e-5) {
      const hx = sx + rx * t, hy = sy + ry * t, hz = sz + rz * t;
      const back = Math.min(3, t * 0.6);
      return { from: [hx - rx * back, hy - ry * back, hz - rz * back], target: [hx, hy, hz] };
    }
    t += h * 0.9;
  }
  return null;
}

// An endless flight down the central tunnel of a Menger sponge lattice,
// twisted along its length and lit by a lamp that rides with the camera.
SCENES.menger = RAY + `
float sponge(vec3 p) {
  p.xy = rot2(p.z * 0.08) * p.xy;
  vec3 q = mod(p + 1.0, 2.0) - 1.0;
  vec3 b = abs(q) - 1.0;
  float d = min(max(b.x, max(b.y, b.z)), 0.0) + length(max(b, 0.0));
  float s = 1.0;
  for (int m = 0; m < 4; m++) {
    vec3 a = mod(q * s, 2.0) - 1.0;
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    float c = (min(max(r.x, r.y), min(max(r.y, r.z), max(r.z, r.x))) - 1.0) / s;
    d = max(d, c);
  }
  return d;
}
vec3 scene(vec2 p) {
  float z = uFlow * 0.35;
  vec3 ro = vec3(0.08 * sin(uFlow * 0.13), 0.08 * cos(uFlow * 0.11), z);
  vec3 ta = ro + vec3(0.1 * sin(uFlow * 0.07), 0.1 * cos(uFlow * 0.05), 1.0);
  vec3 rd = lookAt(ro, ta, uFlow * 0.04) * normalize(vec3(p, 1.1));
  float d = 0.0, steps = 0.0;
  bool hit = false;
  for (int i = 0; i < 90; i++) {
    float h = sponge(ro + rd * d);
    if (h < 0.0006 * d) { hit = true; break; }
    d += h * 0.8;
    steps += 1.0;
    if (d > 14.0) break;
  }
  vec3 col = vec3(0.0);
  if (hit) {
    vec3 pos = ro + rd * d;
    vec2 e = vec2(0.0008 * d, -0.0008 * d);
    vec3 n = normalize(e.xyy * sponge(pos + e.xyy) + e.yyx * sponge(pos + e.yyx) + e.yxy * sponge(pos + e.yxy) + e.xxx * sponge(pos + e.xxx));
    float dif = max(dot(n, -rd), 0.0);
    float ao = 1.0 - steps / 90.0;
    float band = floor(pos.z * 0.5);
    vec3 base = pal(band * 0.11 + uSeed);
    float lit = step(0.75, fract(band * 0.37 + uBeats * 0.618));
    col = base * dif * ao * (1.3 / (1.0 + d * d * 0.05));
    // neon seams where faces meet
    vec3 f = abs(fract(pos * 1.5) - 0.5);
    float edge = smoothstep(0.47, 0.5, max(f.x, max(f.y, f.z)));
    col += base * edge * (0.4 + 0.8 * uMid + lit * 2.0 * uBeat) / (1.0 + d * 0.3);
  }
  col = mix(col, pal(uSeed + 0.5) * 0.08 * (0.5 + uBass), 1.0 - exp(-d * 0.12));
  return col;
}`;

// The view from the front of a train on a viaduct, through a city that never
// ends (after the Vordhosbn video). The city is a grid of blocks, one building
// each, with one column of blocks left empty for the line. The line curves, so
// the whole world is sheared sideways by bend(z) and marched in the straightened
// space. Buildings, pylons, gantries and the train coming the other way are
// sphere-traced; the street and the top of the viaduct are planes seen nearly
// edge-on, where sphere tracing crawls, so those two are intersected exactly.
// Which city, what time of day, how hazy and how high the line runs are
// settings (cfg.city, .daytime, .haze, .ride).
SCENES.train = `
uniform float uCity;        // 0 glass towers, 1 low-rise blocks, 2 neon megacity, 3 wireframe
uniform float uDay;         // 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset
uniform float uHaze, uRide;
const float C = 6.0;        // a block and its share of the streets round it
const float GAP = 0.45;     // half a street: a building keeps this far inside its block
const float G = 12.0;       // a pylon and a gantry every two blocks
const float DW = 2.0;       // half the width of the viaduct
const float TX = 0.9;       // its two tracks sit this far either side of the middle
const float V = 9.0;        // our speed
const float FL = 1.05;
const float FAR = 230.0;
float gMat, gGid, gDeck, gHmax, gTrainZ, gElev, gNight, gDayK, gTw;
vec2 gCell;
vec3 gSun;

float box2(vec2 d) { return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
float box3(vec3 p, vec3 b) { vec3 d = abs(p) - b; return min(max(d.x, max(d.y, d.z)), 0.0) + length(max(d, 0.0)); }
float bend(float z) { return 9.0 * sin(z * 0.017) + 3.0 * sin(z * 0.041 + 1.3); }
bool isCity(float k) { return abs(uCity - k) < 0.5; }
// an antialiased line at every whole number; w is one pixel in the same units
float line1(float x, float w) {
  float a = abs(fract(x + 0.5) - 0.5);
  return (1.0 - smoothstep(0.02, 0.02 + w * 1.5, a)) * min(1.0, 0.06 / (w * 1.5 + 0.02));
}

// one block: half its footprint in x and z, and its height (0 = an open square)
vec3 block(vec2 ci) {
  float h1 = hash12(ci * 1.31 + uSeed * 31.0), h2 = hash12(ci.yx * 1.17 + 17.3 + uSeed * 7.0), h3 = hash12(ci + 41.7);
  float h;
  if (isCity(1.0)) h = 1.3 + 2.2 * h1 + 3.5 * step(0.94, h2);
  else if (isCity(2.0)) h = 5.0 + 13.0 * h1 + 26.0 * h2 * h2;
  else h = 2.0 + 5.0 * h1 + 24.0 * h2 * h2 * h2 * (0.25 + 0.75 * smoothstep(0.35, 0.75, vnoise(ci * 0.13 + uSeed * 9.0)));
  h *= 1.0 + 0.08 * spec(h3);          // the skyline breathes with its band of the spectrum
  if (h3 < 0.06) h = 0.0;
  return vec3(C * 0.5 - GAP - 0.8 * h3, C * 0.5 - GAP - 0.8 * fract(h3 * 7.3), h);
}

float map(vec3 p) {
  vec3 q = vec3(p.x - bend(p.z), p.y, p.z);
  vec2 g = vec2(q.x / C + 0.5, q.z / C);
  vec2 ci = floor(g);
  vec2 l = (g - ci - 0.5) * C;
  vec2 w = 0.5 * C - abs(l);
  float d;
  if (abs(ci.x) < 0.5) {
    d = w.x + GAP;                     // the line's own avenue: buildings only beyond its two sides
  } else {
    d = min(w.x, w.y) + GAP;           // never further than the next block, whose building is not known here
    vec3 b = block(ci);
    if (b.z > 0.0) {
      float db = box3(vec3(l.x, q.y - 0.5 * b.z, l.y), vec3(b.x, 0.5 * b.z, b.y));
      if (b.z > 12.0) db = min(db, box3(vec3(l.x, q.y - 1.11 * b.z, l.y), vec3(b.x * 0.6, 0.11 * b.z, b.y * 0.6)));
      d = min(d, db);
    }
  }
  d = max(d, q.y - gHmax);
  gMat = 2.0; gCell = ci;
  float zr = mod(q.z, G) - 0.5 * G;
  // the viaduct from the side and from below, and the pylons under it
  if (q.y < gDeck) {
    float dk = box2(abs(vec2(q.x, q.y - gDeck + 0.25)) - vec2(DW, 0.25));
    dk = min(dk, box3(vec3(q.x, q.y - 0.5 * gDeck, zr), vec3(0.4, 0.5 * gDeck, 0.5)));
    if (dk < d) { d = dk; gMat = 3.0; }
  }
  // a gantry over the tracks: two posts and a beam
  float fr = min(box2(abs(vec2(abs(q.x) - DW + 0.08, q.y - gDeck - 1.45)) - vec2(0.05, 1.45)),
                 box2(abs(vec2(q.x, q.y - gDeck - 2.9)) - vec2(DW, 0.07)));
  float dg = box2(vec2(fr, abs(zr) - 0.05));
  if (dg < d) { d = dg; gMat = 4.0; gGid = floor(q.z / G); }
  // the train coming the other way
  float dt = box3(vec3(q.x + TX, q.y - gDeck - 0.78, q.z - gTrainZ), vec3(0.5, 0.6, 13.0)) - 0.05;
  if (dt < d) { d = dt; gMat = 5.0; }
  return d;
}

vec3 sunColour() { return mix(vec3(1.0, 0.42, 0.14), vec3(1.0, 0.95, 0.85), smoothstep(0.0, 0.45, gElev)); }

// the sky without anything fine in it: also the colour of the haze and of reflections
vec3 skyBase(vec3 rd) {
  float y = max(rd.y, 0.0);
  vec3 zen = mix(vec3(0.004, 0.007, 0.025), vec3(0.10, 0.27, 0.70), gDayK);
  vec3 hor = mix(vec3(0.025, 0.03, 0.06), vec3(0.55, 0.72, 0.95), gDayK);
  zen = mix(zen, vec3(0.14, 0.12, 0.34), gTw * 0.8);
  hor = mix(hor, vec3(1.0, 0.42, 0.15), gTw * 0.85);
  vec3 c = mix(hor, zen, pow(y, 0.45));
  c += vec3(0.22, 0.12, 0.07) * gNight * exp(-y * 8.0) * 0.5;       // a lit city under a night sky
  float sd = max(dot(rd, gSun), 0.0);
  c += sunColour() * smoothstep(-0.1, 0.03, gElev) * (pow(sd, 40.0) * 0.45 + pow(sd, 6.0) * 0.3 * gTw);
  return c;
}

vec3 sky(vec3 rd) {
  vec3 c = skyBase(rd);
  float y = max(rd.y, 0.0);
  float sd = max(dot(rd, gSun), 0.0);
  c += sunColour() * smoothstep(-0.1, 0.03, gElev) * smoothstep(0.9996, 0.9998, sd) * 6.0;
  // stars and a moon
  vec2 sp = rd.xz / (y + 0.25) * 55.0;
  vec2 si = floor(sp);
  float sh = hash12(si);
  c += step(0.965, sh) * smoothstep(0.35, 0.0, length(sp - si - 0.5)) * gNight * smoothstep(0.03, 0.3, rd.y)
     * (0.6 + 0.4 * sin(uFlow * 2.0 + sh * 60.0));
  float md = max(dot(rd, normalize(vec3(-0.42, 0.5, 0.75))), 0.0);
  c += vec3(0.9, 0.93, 1.0) * gNight * (smoothstep(0.9993, 0.9996, md) * 1.6 + pow(md, 60.0) * 0.12);
  // clouds on a flat ceiling, lit by whatever the hour gives them
  vec2 cp = rd.xz / (y + 0.14) * 0.8 + vec2(uFlow * 0.004, uFlow * 0.012);
  float cl = smoothstep(0.42, 0.8, fbm(cp, 5)) * smoothstep(0.0, 0.2, rd.y);
  vec3 cc = mix(vec3(0.05, 0.05, 0.07), vec3(1.0), gDayK);
  cc = mix(cc, vec3(1.0, 0.55, 0.35), gTw * 0.7) + sunColour() * pow(sd, 4.0) * gTw * 0.4;
  return mix(c, cc, cl * 0.75);
}

// lights sliding along one lane of a street: lane = distance from the lane's
// middle, s = position along it, dir = which way they drive
vec3 traffic(float lane, float s, float id, float dir, float gp) {
  float x = s * 0.085 - dir * uFlow * 0.5 + hash11(id * 3.1 + dir) * 9.0;
  float there = step(0.4, hash11(floor(x) * 1.7 + id * 13.0 + dir));
  float sg = 0.0055 + gp * gp * 0.5;
  float car = exp(-lane * lane / sg) * (0.0055 / sg) * exp(-pow((fract(x) - 0.5) / 0.035, 2.0)) * there;
  return (dir > 0.0 ? vec3(1.0, 0.08, 0.04) : vec3(1.0, 0.95, 0.8)) * car;
}

vec3 scene(vec2 p) {
  float ang = TAU * (uDay - 0.25);
  gElev = sin(ang);
  gSun = normalize(vec3(0.3, 0.9 * gElev, 0.6 + 0.2 * abs(cos(ang))));
  gDayK = smoothstep(-0.12, 0.3, gElev);
  gNight = 1.0 - smoothstep(-0.25, 0.1, gElev);
  gTw = exp(-abs(gElev) * 5.0);
  gDeck = mix(1.0, 16.0, uRide);
  bool low = isCity(1.0), neon = isCity(2.0), wire = isCity(3.0);
  gHmax = low ? 8.0 : neon ? 61.0 : 43.0;
  float z0 = uFlow * V;
  gTrainZ = z0 + 170.0 - mod(uFlow * 26.0 + uSeed * 400.0, 520.0);

  // the driver's eye: looking at the track a little way ahead, leaning into the curve
  vec3 ro = vec3(TX + bend(z0), gDeck + 0.95, z0);
  vec3 ta = vec3(TX + bend(z0 + 14.0), gDeck + 0.7, z0 + 14.0);
  float roll = 0.35 * (bend(z0 + 12.0) - 2.0 * bend(z0 + 6.0) + bend(z0));
  vec3 fw = normalize(ta - ro);
  vec3 rt = normalize(cross(vec3(sin(roll), cos(roll), 0.0), fw));
  vec3 rd = normalize(p.x * rt + p.y * cross(fw, rt) + (FL - 0.07 * uBass) * fw);

  // where the ray meets the top of the viaduct, or else the street
  float tEnd = FAR, endMat = 0.0, tChk = -1.0;
  if (rd.y < -1e-4) {
    tChk = (gDeck - ro.y) / rd.y;
    vec3 pd = ro + rd * tChk;
    if (abs(pd.x - bend(pd.z)) < DW) { if (tChk < FAR) { tEnd = tChk; endMat = 3.5; } }
    else { float tg = -ro.y / rd.y; if (tg < FAR) { tEnd = tg; endMat = 1.0; } }
  }

  float d = 0.0, mat = 0.0, gid = 0.0;
  vec2 cell = vec2(0.0);
  bool hit = false;
  for (int i = 0; i < 120; i++) {
    vec3 pos = ro + rd * d;
    float h = map(pos);
    if (h < 0.0011 * d) { hit = true; mat = gMat; cell = gCell; gid = gGid; break; }
    float st = h * 0.92;
    if (d < tChk) st = min(st, tChk - d + 0.02);   // the viaduct only exists below its top: do not step through that level
    d += st;
    if (d >= tEnd) break;
    if (rd.y > 0.0 && pos.y > max(gHmax, gDeck + 3.2)) { d = FAR; break; }
  }
  if (!hit && d >= tEnd && endMat > 0.0) { hit = true; d = tEnd; mat = endMat; }

  float dim = wire ? 0.16 : 1.0;                  // the wireframe city keeps its sky dark
  vec3 fogc = skyBase(normalize(vec3(rd.x, max(rd.y, 0.0) * 0.3 + 0.03, rd.z))) * dim;
  if (neon) fogc = mix(fogc, pal(uSeed + 0.6) * 0.3, 0.45 * gNight);
  vec3 col;
  if (!hit) {
    d = FAR;
    col = mix(sky(rd) * dim, fogc, 0.6 * exp(-max(rd.y, 0.0) * 14.0));
  } else {
    vec3 pos = ro + rd * d;
    vec3 q = vec3(pos.x - bend(pos.z), pos.y, pos.z);
    vec3 n = vec3(0.0, 1.0, 0.0);
    if (mat > 1.5 && (mat < 3.25 || mat > 3.75)) {
      vec2 e = vec2(1.0, -1.0) * (0.002 + 0.0006 * d);
      n = normalize(e.xyy * map(pos + e.xyy) + e.yyx * map(pos + e.yyx) + e.yxy * map(pos + e.yxy) + e.xxx * map(pos + e.xxx));
    }
    float px = d / (FL * uRes.y);                 // one pixel, in the world, at this distance
    float fp = px / max(dot(n, -rd), 0.08);       // and smeared over the surface it lands on
    vec3 alb = vec3(0.2), emi = vec3(0.0);

    if (mat < 1.5) {
      // ---- the street
      vec2 g = vec2(q.x / C + 0.5, q.z / C);
      vec2 ci = floor(g);
      vec2 l = (g - ci - 0.5) * C;
      vec2 w = 0.5 * C - abs(l);                  // to the middle of the street on either side
      float st = min(w.x, w.y);
      alb = mix(vec3(0.055), vec3(0.19, 0.19, 0.18), smoothstep(GAP - 0.04, GAP + 0.04, st));   // roadway, pavement
      if (abs(ci.x) > 0.5 && block(ci).z <= 0.0) alb = mix(alb, vec3(0.06, 0.16, 0.05), smoothstep(GAP + 0.2, GAP + 0.4, st));
      if (abs(q.x) < DW) alb *= 0.55;             // under the viaduct
      float ln = (1.0 - smoothstep(0.025, 0.025 + fp, st)) * min(1.0, 0.05 / (fp + 1e-3));
      ln *= mix(step(0.5, fract((w.x < w.y ? q.z : q.x) * 0.7)), 0.5, smoothstep(0.2, 0.7, fp));
      alb = mix(alb, vec3(0.5), ln * 0.8);
      vec3 cars = traffic(w.x - 0.2, q.z, ci.x + step(0.0, l.x), -sign(l.x), fp)
                + traffic(w.y - 0.2, q.x, ci.y + step(0.0, l.y) + 100.0, -sign(l.y), fp);
      emi = cars * (0.35 + 1.4 * gNight);
      emi += vec3(1.0, 0.6, 0.28) * 0.2 * gNight * exp(-dot(w, w) * 0.5);       // lamps at the crossings
      if (wire) {
        alb = vec3(0.0);
        emi = cars + pal(uSeed + 0.55) * 0.3 * max(line1(q.x / 3.0, fp / 3.0), line1(q.z / 3.0, fp / 3.0));
      }
    } else if (mat < 2.5) {
      // ---- a building
      vec3 b = block(cell);
      float hc = hash12(cell + 3.7);
      vec2 l = q.xz - vec2(cell.x * C, (cell.y + 0.5) * C);
      // the building as a level meter for its band: floors below the level light up
      float below = step(q.y, 0.4 + spec(hash12(cell + 41.7)) * b.z * 1.15);
      bool roof = n.y > 0.5;
      bool xface = abs(n.x) > abs(n.z);
      float u = xface ? l.y : l.x;
      if (roof) {
        alb = vec3(0.11, 0.11, 0.12) + 0.05 * hash12(floor(l * 2.0) + cell);
        if (b.z > 14.0) emi = vec3(1.0, 0.05, 0.03) * smoothstep(0.22, 0.1, length(l)) * (0.6 + 1.4 * step(0.5, fract(uFlow * 0.4 + hc)));
      } else {
        vec2 wv = vec2(u / 0.3, q.y / 0.36);
        vec2 wi = floor(wv), wf = wv - wi;
        float e = fp * 3.5;
        float farf = smoothstep(0.1, 0.35, e);
        float win = smoothstep(0.14 - e, 0.14 + e, wf.x) * smoothstep(0.86 + e, 0.86 - e, wf.x)
                  * smoothstep(0.24 - e, 0.24 + e, wf.y) * smoothstep(0.82 + e, 0.82 - e, wf.y);
        win = mix(win, 0.42, farf);
        float prob = 0.06 + 0.34 * gNight + 0.38 * below * (0.3 + 0.7 * gNight);
        float lit = mix(step(hash12(wi * 1.37 + cell * 7.1 + hc * 91.0), prob), prob, farf);
        vec3 wc = mix(vec3(1.0, 0.72, 0.4), vec3(0.62, 0.8, 1.0), step(0.72, hash12(wi.yx + hc * 37.0)));
        vec3 wall = mix(vec3(0.3, 0.32, 0.36), vec3(0.5, 0.47, 0.43), hc);
        if (low) wall = hc < 0.35 ? vec3(0.48, 0.25, 0.17) : hc < 0.7 ? vec3(0.7, 0.62, 0.48) : vec3(0.42, 0.43, 0.46);
        if (neon) { wall = vec3(0.04, 0.045, 0.065); wc = mix(wc, pal(hc * 0.7 + floor(wi.y / 4.0) * 0.09 + uSeed), 0.75); }
        alb = mix(wall, vec3(0.03, 0.04, 0.06), win);
        emi = skyBase(reflect(rd, n)) * 0.4 * win * (1.0 - lit);                 // glass holds the sky
        emi += wc * win * lit * (0.25 + 1.0 * gNight) * (0.85 + 1.6 * below * uBeat);
        if (neon) {
          // a sign down the side, in something like letters, and a strip round the roof
          float su = (hash12(cell + 9.1) - 0.5) * 2.4;
          float sy = b.z * (0.25 + 0.3 * hash12(cell + 5.5));
          float inS = step(abs(u - su), 0.3) * step(sy, q.y) * step(q.y, sy + 2.0 + 4.0 * hash12(cell + 6.6));
          float gly = step(0.35, hash12(floor(vec2(u * 7.0, q.y * 2.2)) + cell));
          alb = mix(alb, vec3(0.02), inS);
          emi = mix(emi, pal(hc * 1.7 + 0.3 + uSeed) * (0.35 + gly) * (0.7 + 1.5 * uBeat) * (0.5 + 0.5 * gNight), inS * (1.0 - farf * 0.5));
          emi += pal(hc + uSeed) * smoothstep(b.z - 0.16, b.z - 0.1, q.y) * step(q.y, b.z + 0.02) * 1.2;
        }
      }
      if (wire) {
        float top = q.y > b.z + 0.01 ? 1.22 * b.z : b.z;
        float hw = (xface ? b.y : b.x) * (q.y > b.z + 0.01 ? 0.6 : 1.0);
        float ln = roof ? max(line1(l.x, fp), line1(l.y, fp)) : max(line1(q.y, fp), line1(u, fp));
        float edge = roof ? min(b.x - abs(l.x), b.y - abs(l.y)) : min(hw - abs(u), top - q.y);
        ln = max(ln * 0.6, (1.0 - smoothstep(0.04, 0.04 + fp * 1.5, abs(edge))) * min(1.0, 0.12 / (fp * 1.5 + 0.04)));
        alb = vec3(0.0);
        emi = pal(hc * 0.3 + uSeed) * ln * (0.3 + 1.3 * below * (0.5 + uBeat));
      }
    } else if (mat < 3.25) {
      // ---- concrete: the viaduct's flank and underside, the pylons
      alb = vec3(0.3, 0.3, 0.29);
      if (wire) { alb = vec3(0.0); emi = pal(uSeed + 0.5) * 0.35 * max(line1(q.y, fp), line1(q.z * 0.5, fp * 0.5)); }
    } else if (mat < 3.75) {
      // ---- the top of the viaduct: ballast, sleepers, rails
      float x1 = abs(abs(q.x) - TX);              // from the middle of the nearer track
      float farf = smoothstep(0.15, 0.6, fp);
      float sl = mix(step(fract(q.z * 2.2), 0.42), 0.42, farf) * step(x1, 0.52);
      alb = mix(vec3(0.2, 0.185, 0.17), vec3(0.1, 0.085, 0.075), sl);
      alb *= 0.85 + 0.3 * mix(hash12(floor(q.xz * 12.0)), 0.5, smoothstep(0.02, 0.1, fp));
      alb = mix(alb, vec3(0.36), smoothstep(DW - 0.2, DW - 0.16, abs(q.x)));
      float rw = px * 1.5;
      float rail = clamp((0.03 + rw - abs(x1 - 0.3)) / rw, 0.0, 1.0) * min(1.0, 0.09 / (0.06 + rw));
      // a pulse of light runs ahead down the rails, brighter on the beat
      vec3 pulse = pal(uSeed + 0.5) * smoothstep(0.9, 1.0, fract(q.z * 0.012 - uFlow * 0.35)) * (0.3 + 1.7 * uBeat);
      vec3 steel = skyBase(reflect(rd, n)) * 0.9 + 0.04 + vec3(1.0, 0.9, 0.75) * gNight * (0.2 + 0.9 * exp(-d * 0.04));
      alb = mix(alb, vec3(0.1), rail);
      emi = (steel + pulse) * rail;
      if (wire) { alb = vec3(0.0); emi = (pal(uSeed + 0.5) * 1.3 + pulse) * rail + pal(uSeed + 0.5) * 0.12 * sl * step(fract(q.z * 2.2), 0.1); }
    } else if (mat < 4.5) {
      // ---- a gantry: on each beat a different set of them flares
      alb = vec3(0.09, 0.095, 0.1);
      float lit = step(0.62, fract(gid * 0.37 + uBeats * 0.618));
      emi = pal(gid * 0.13 + uSeed) * (0.08 + lit * (0.3 + 1.8 * uBeat)) * (0.45 + 0.55 * gNight);
      if (wire) alb = vec3(0.0);
    } else {
      // ---- the other train
      vec3 tl = vec3(q.x + TX, q.y - gDeck - 0.78, q.z - gTrainZ);
      alb = tl.y < -0.25 ? vec3(0.12) : mix(vec3(0.8), pal(uSeed + 0.15), 0.55);
      if (abs(n.x) > 0.6) {
        float win = smoothstep(0.02, 0.06, tl.y) * smoothstep(0.42, 0.38, tl.y) * smoothstep(0.1, 0.14, abs(fract(tl.z * 0.75) - 0.5));
        alb = mix(alb, vec3(0.03), win);
        emi = vec3(1.0, 0.88, 0.62) * win * (0.25 + 1.3 * gNight);
      } else if (n.z < -0.6) {
        alb = mix(alb, vec3(0.02), step(abs(tl.x), 0.38) * step(0.0, tl.y) * step(tl.y, 0.42));
        emi = vec3(1.0, 0.95, 0.85) * smoothstep(0.1, 0.06, length(vec2(abs(tl.x) - 0.3, tl.y + 0.3))) * 8.0;
        emi += pal(uSeed + 0.4) * step(abs(tl.x), 0.3) * step(0.46, tl.y) * step(tl.y, 0.56) * 1.5;
      } else if (n.z > 0.6) {
        emi = vec3(1.0, 0.05, 0.03) * smoothstep(0.09, 0.05, length(vec2(abs(tl.x) - 0.3, tl.y + 0.3))) * 5.0;
      }
      if (wire) { alb = vec3(0.0); emi += pal(uSeed + 0.15) * 0.8 * max(line1(tl.z * 0.75, fp), line1(tl.y * 2.0 + 0.5, fp * 2.0)); }
    }

    vec3 sunc = sunColour() * smoothstep(-0.05, 0.08, gElev) * 1.25;
    vec3 amb = mix(vec3(0.012, 0.016, 0.035), vec3(0.3, 0.38, 0.52), gDayK) + vec3(0.22, 0.1, 0.08) * gTw * 0.6;
    col = alb * (amb * (0.6 + 0.4 * n.y) + sunc * max(dot(n, gSun), 0.0)) + emi;
    col += alb * vec3(1.0, 0.62, 0.3) * 0.5 * gNight * exp(-max(q.y, 0.0) * 0.45);                       // street lamps on the lower floors
    col += alb * vec3(1.0, 0.93, 0.8) * 1.5 * gNight * exp(-d * 0.06) * step(gDeck - 0.01, q.y);       // our own headlight
    float fog = 1.0 - exp(-d * mix(0.0022, 0.03, uHaze * uHaze));
    col = mix(col, fogc, max(fog, smoothstep(0.7 * FAR, FAR, d)));
  }

  // the other train's headlights carry through the haze long before it has a shape
  vec3 hp = vec3(-TX + bend(gTrainZ - 13.0), gDeck + 0.48, gTrainZ - 13.05);
  float th = dot(hp - ro, rd);
  if (th > 0.0 && th < d + 0.5) {
    float a = length(ro + rd * th - hp) / th;
    col += vec3(1.0, 0.93, 0.8) * (0.00003 / (a * a + 0.00003) + 0.0006 / (a * a + 0.004))
         * (0.25 + 0.75 * gNight) * exp(-th * 0.012) * smoothstep(240.0, 150.0, th);
  }
  return col * 1.7 * (0.95 + 0.2 * uBeat);
}`;

// ------------------------------------------------------------------- host --

// a small integer hash, so every window derives the same sequence
function ihash(a, b) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x632be5ab, 0x85ebca77)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
  return h >>> 0;
}
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// The scene list is walked as one shuffled pass after another, so every scene
// comes round before any repeats, and two passes never meet on the same scene.
function perm(ids, seed, cycle) {
  const a = ids.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = ihash(seed + cycle, i) % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function sceneAt(ids, seed, slot) {
  const n = ids.length;
  if (n === 1) return ids[0];
  const cycle = Math.floor(slot / n), k = slot - cycle * n;
  const cur = perm(ids, seed, cycle);
  if (k < 2 && cur[0] === perm(ids, seed, cycle - 1)[n - 1]) [cur[0], cur[1]] = [cur[1], cur[0]];
  return cur[k];
}

const FADE = 3;   // seconds of cross-fade between scenes

export class Visuals {
  constructor(gl) {
    this.gl = gl;
    this.progs = {};
    this.vao = gl.createVertexArray();
    this.target = null;
    this.flow = 0;
    this.beats = 0;
    this._beatHi = false;
    this._t = 0;
    this.spec = new Float32Array(SPECTRUM_N);
    this.error = null;
    this.scene = null;
    this.atlas = null;
    this.atlasKey = null;
    this.emojiN = 0;
  }

  // up to 64 emoji drawn into an 8x8 atlas; rebuilt only when the list changes
  _atlas(str) {
    const key = String(str || DEFAULT_VISUAL_EMOJI);
    if (this.atlas && key === this.atlasKey) return this.atlas;
    this.atlasKey = key;
    const gl = this.gl;
    const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
    let list = seg ? [...seg.segment(key)].map((x) => x.segment) : Array.from(key);
    list = list.filter((c) => c.trim()).slice(0, 64);
    if (!list.length) list = Array.from(DEFAULT_VISUAL_EMOJI);
    this.emojiN = list.length;
    const C = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = C * 8;
    const x = cv.getContext('2d');
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `${Math.round(C * 0.78)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    list.forEach((e, i) => x.fillText(e, (i % 8) * C + C / 2, Math.floor(i / 8) * C + C * 0.54));
    if (!this.atlas) this.atlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return this.atlas;
  }

  _prog(id) {
    if (id in this.progs) return this.progs[id];
    let p = null;
    try { p = prog(this.gl, VS_SCREEN, HEAD + SCENES[id] + MAIN); }
    catch (e) { this.error = 'visuals ' + id + ': ' + e.message.split('\n')[0]; console.error('[visuals]', e); }
    return (this.progs[id] = p);
  }

  /**
   * Which scene shows at media time `t`, and which one it is fading from.
   * Pure: depends only on the settings, the track and the clock.
   */
  pick(cfg, key, t) {
    const ids = cfg.scene && cfg.scene !== 'auto' && SCENES[cfg.scene] ? [cfg.scene] : Object.keys(SCENES);
    const seed = strHash(String(key || ''));
    if (ids.length === 1) return { cur: ids[0], prev: null, alpha: 1, seed };
    const every = Math.max(5, cfg.every || 30);
    const slot = Math.floor(Math.max(0, t) / every);
    const local = Math.max(0, t) - slot * every;
    const cur = sceneAt(ids, seed, slot);
    if (slot === 0 || local >= FADE) return { cur, prev: null, alpha: 1, seed };
    const a = local / FADE;
    return { cur, prev: sceneAt(ids, seed, slot - 1), alpha: a * a * (3 - 2 * a), seed };
  }

  /**
   * Draw the picture into this object's own texture. Returns { tex, w, h }.
   * opts: w, h, time (media seconds), audio (features), cfg, key, playing
   */
  render(opts) {
    const gl = this.gl;
    const cfg = { ...defaultVisualsCfg(), ...(opts.cfg || {}) };
    const pick = this.pick(cfg, opts.key, opts.time || 0);
    const k = Math.min(SCENE_SCALE[pick.cur] || 1, pick.prev ? SCENE_SCALE[pick.prev] || 1 : 1);
    const w = Math.max(16, Math.round((opts.w | 0) * k)), h = Math.max(16, Math.round((opts.h | 0) * k));
    if (!this.target || this.target.w !== w || this.target.h !== h) {
      if (this.target) this.target.dispose();
      this.target = new Target(gl, w, h, 'rgba8');
    }
    const a = opts.audio || {};
    const react = cfg.react == null ? 1 : cfg.react;
    const now = performance.now();
    const dt = this._t ? Math.min(0.1, (now - this._t) / 1000) : 0;
    this._t = now;
    const lv = (v) => Math.min(1.5, (v || 0) * react);
    const level = lv(a.level), bass = lv(a.bass), beat = lv(a.beat);
    if (opts.playing !== false) {
      // loud passages push the picture along, quiet ones let it drift
      this.flow += dt * (cfg.speed || 1) * (0.55 + 0.8 * level + 0.5 * beat);
      if (this.flow > 1e4) this.flow -= 1e4;
    }
    const hi = (a.beat || 0) > 0.7;
    if (hi && !this._beatHi) this.beats = (this.beats + 1) % 1000;
    this._beatHi = hi;
    const sp = a.spectrum || [];
    for (let i = 0; i < SPECTRUM_N; i++) this.spec[i] = Math.min(1.5, (sp[i] || 0) * react);

    this.scene = pick.cur;
    const palName = cfg.palette && cfg.palette !== 'auto' && VISUAL_PALETTES[cfg.palette]
      ? cfg.palette
      : Object.keys(VISUAL_PALETTES)[pick.seed % 7];   // per track, never the black & white one
    const pal = VISUAL_PALETTES[palName];
    const seed = (pick.seed % 1000) / 1000;

    this.target.bind([0, 0, 0, 1]);
    gl.bindVertexArray(this.vao);
    const draws = pick.prev ? [[pick.prev, 1], [pick.cur, pick.alpha]] : [[pick.cur, 1]];
    for (const [id, alpha] of draws) {
      const p = this._prog(id);
      if (!p) continue;
      p.use();
      const U = p.u;
      gl.uniform2f(U.uRes, w, h);
      gl.uniform1f(U.uFlow, this.flow);
      gl.uniform1f(U.uBeats, this.beats);
      gl.uniform1f(U.uLevel, level);
      gl.uniform1f(U.uBass, bass);
      gl.uniform1f(U.uMid, lv(a.mid));
      gl.uniform1f(U.uHigh, lv(a.high));
      gl.uniform1f(U.uBeat, beat);
      if (U.uSpec) gl.uniform1fv(U.uSpec, this.spec);
      gl.uniform3fv(U.uPa, pal[0]); gl.uniform3fv(U.uPb, pal[1]);
      gl.uniform3fv(U.uPc, pal[2]); gl.uniform3fv(U.uPd, pal[3]);
      gl.uniform1f(U.uSeed, seed);
      gl.uniform1f(U.uAlpha, alpha);
      if (U.uTarget) {
        const dive = Math.floor((this.flow * BOX_RATE) / BOX_DEPTH);
        const dk = pick.seed + ':' + dive;
        if (this._diveKey !== dk) { this._diveKey = dk; this._dive = boxDive(pick.seed, dive); }
        gl.uniform3fv(U.uFrom, this._dive.from);
        gl.uniform3fv(U.uTarget, this._dive.target);
      }
      if (U.uCity) {
        const num = (v, d) => (Number.isFinite(+v) ? Math.min(1, Math.max(0, +v)) : d);
        const time = DAY_AT[cfg.daytime] != null ? cfg.daytime : AUTO_DAYTIMES[(pick.seed >>> 7) % AUTO_DAYTIMES.length];
        const day = cfg.daytime === 'cycle' ? (this.flow / 220 + seed) % 1 : DAY_AT[time];
        gl.uniform1f(U.uCity, CITY_ID[cfg.city] != null ? CITY_ID[cfg.city] : (pick.seed >>> 4) % 4);
        gl.uniform1f(U.uDay, day);
        gl.uniform1f(U.uHaze, num(cfg.haze, 0.35));
        gl.uniform1f(U.uRide, num(cfg.ride, 0.3));
      }
      if (U.uAtlas) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._atlas(cfg.emoji));
        gl.uniform1i(U.uAtlas, 0);
        gl.uniform1f(U.uEmojiN, this.emojiN);
      }
      if (alpha < 1) {
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      } else {
        gl.disable(gl.BLEND);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // compile the next scene well before its cross-fade needs it
    if (!this._warm || now - this._warm > 1000) {
      this._warm = now;
      const ahead = this.pick(cfg, opts.key, (opts.time || 0) + 4);
      this._prog(ahead.cur);
    }
    return { tex: this.target.tex, w, h };
  }

  dispose() {
    const gl = this.gl;
    for (const k in this.progs) if (this.progs[k]) gl.deleteProgram(this.progs[k].p);
    this.progs = {};
    if (this.target) { this.target.dispose(); this.target = null; }
    if (this.atlas) { gl.deleteTexture(this.atlas); this.atlas = null; }
    gl.deleteVertexArray(this.vao);
  }
}

/**
 * Per-window glue: switches the engine between the video and the visuals, and
 * feeds the visuals the clock, the track and the music. Call every frame.
 */
export class VisualsHost {
  constructor(engine) {
    this.engine = engine;
    this.visuals = null;
    this.on = false;
    this._opts = null;
    this._gen = (W, H, mode) => this._render(W, H, mode);
  }

  frame(on, opts) {
    this.on = !!on;
    this._opts = opts;
    if (!this.on) {
      if (this.engine.generator) this.engine.setGenerator(null);
      return;
    }
    if (!this.visuals) this.visuals = new Visuals(this.engine.gl);
    this.engine.setGenerator(this._gen);
  }

  _render(W, H, mode) {
    // A mapped wall takes its areas out of a 16:9 picture, like a video; the
    // plain full-screen TV gets one in its own shape so nothing is letterboxed.
    const cap = 1920;
    let w, h;
    if (mode === 'fill') { w = Math.min(W, cap); h = Math.round((w * H) / Math.max(1, W)); }
    else { w = Math.min(W, cap); h = Math.round((w * 9) / 16); }
    const o = this._opts || {};
    return this.visuals.render({ w, h, time: o.time, audio: o.audio, cfg: o.cfg, key: o.key, playing: o.playing });
  }

  get scene() { return this.on && this.visuals ? this.visuals.scene : null; }
  get error() { return this.visuals && this.visuals.error; }
}
