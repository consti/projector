// Image treatments: the picture re-rendered as a halftone print, as text, on an
// 8-bit machine, as an oil painting, through a thermal camera, or as stained
// glass. All are single-pass shaders over the picture.

import { texFromData, bindTex } from '../glu.mjs';
import { R, B, C, S } from './common.mjs';
import { postEffect } from './post.mjs';

// ------------------------------------------------------------------- halftone
const HALFTONE_FS = `
uniform float uCell;
uniform float uAngle;
uniform float uMode;      // 0 cmyk, 1 mono, 2 duotone
uniform vec3 uPaper;
uniform vec3 uInk;
uniform float uOutline;
uniform float uGain;
uniform float uRound;
// dot coverage for ink value v on a screen rotated by a
float screen(vec2 px, float a, float v){
  vec2 q = rot2(a) * px / uCell;
  vec2 f = fract(q) - 0.5;
  float d = mix(max(abs(f.x), abs(f.y)), length(f), uRound) * 2.0;   // 0 centre .. 1 edge
  float r = sqrt(sat(v * uGain)) * 1.08;
  float aa = 1.6 / uCell;
  return 1.0 - smoothstep(r - aa, r + aa, d);
}
void main(){
  vec2 px = vUV * uSize;
  // average the picture over the cell so a dot represents its area
  vec2 cellUV = (floor(px / uCell) + 0.5) * uCell / uSize;
  vec3 c = (picClamp(cellUV) + picClamp(cellUV + vec2(uCell * 0.25, 0.0) / uSize) + picClamp(cellUV - vec2(uCell * 0.25, 0.0) / uSize)
          + picClamp(cellUV + vec2(0.0, uCell * 0.25) / uSize) + picClamp(cellUV - vec2(0.0, uCell * 0.25) / uSize)) * 0.2;
  vec3 col = uPaper;
  if (uMode < 0.5) {
    // CMYK separation with the classic screen angles
    float k = 1.0 - max(max(c.r, c.g), c.b);
    vec3 cmy = (1.0 - c - k) / max(1.0 - k, 1e-3);
    col *= mix(vec3(1.0), vec3(0.0, 0.62, 0.89), screen(px, uAngle + 0.2618, cmy.x));
    col *= mix(vec3(1.0), vec3(0.93, 0.0, 0.55), screen(px, uAngle + 1.309, cmy.y));
    col *= mix(vec3(1.0), vec3(1.0, 0.93, 0.0), screen(px, uAngle, cmy.z));
    col *= mix(vec3(1.0), vec3(0.08), screen(px, uAngle + 0.7854, k));
  } else if (uMode < 1.5) {
    col *= mix(vec3(1.0), uInk, screen(px, uAngle + 0.7854, 1.0 - luma(c)));
  } else {
    float l = luma(c);
    col *= mix(vec3(1.0), uInk, screen(px, uAngle + 0.7854, 1.0 - l));
    col = mix(col, col * c * 1.4, 0.5);
  }
  // comic outlines from the sharp picture
  if (uOutline > 0.0) {
    vec2 e = 1.5 / uSize;
    float l0 = luma(picClamp(vUV));
    float g = abs(luma(picClamp(vUV + vec2(e.x, 0.0))) - l0) + abs(luma(picClamp(vUV + vec2(0.0, e.y))) - l0);
    col *= 1.0 - sat(g * 5.0) * uOutline;
  }
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const halftone = postEffect({
  type: 'halftone',
  label: 'Halftone print',
  group: 'Look',
  hint: 'The picture as a printed page: CMYK dot screens at their classic angles, or a one-ink comic with outlines.',
  actions: [],
  params: [
    R('cell', 'Dot size (px)', 9, 3, 40, 0.5),
    R('angle', 'Screen angle', 0, 0, 90, 1),
    S('mode', 'Inks', 'cmyk', [['cmyk', 'Four-colour'], ['mono', 'One ink'], ['duo', 'Ink over colour']]),
    C('paper', 'Paper', '#f4efe2'),
    C('ink', 'Ink', '#1a1a2e'),
    R('gain', 'Ink weight', 1, 0.4, 2),
    R('round', 'Round dots', 1, 0, 1),
    R('outline', 'Outlines', 0.5, 0, 1),
  ],
}, HALFTONE_FS, {
  uniforms(gl, u, p, st, c, color) {
    gl.uniform1f(u.uCell, p.cell * (c.size[0] / 1920));
    gl.uniform1f(u.uAngle, (p.angle * Math.PI) / 180);
    gl.uniform1f(u.uMode, { cmyk: 0, mono: 1, duo: 2 }[p.mode] || 0);
    color('uPaper', p.paper); color('uInk', p.ink);
    gl.uniform1f(u.uGain, p.gain);
    gl.uniform1f(u.uRound, p.round);
    gl.uniform1f(u.uOutline, p.outline);
  },
});

// ---------------------------------------------------------------------- ascii
// A glyph atlas is drawn once with the 2D canvas, sorted by how much ink each
// character puts down, so brightness maps onto density.
const GLYPHS = ' .`\'-,:;_"~^!|/\\()<>+=*il1tfrxzvcunjoaesyqpdbkhw%ZXYCLNVEMWKGHRBQ8O0#&$@';
const ATLAS_N = GLYPHS.length;
const CELL = 24;

function buildAtlas(gl) {
  const cv = document.createElement('canvas');
  cv.width = CELL * ATLAS_N; cv.height = CELL;
  const x = cv.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, cv.width, cv.height);
  x.fillStyle = '#fff';
  x.font = `bold ${CELL * 0.95}px Menlo, "Courier New", monospace`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const cov = [];
  for (let i = 0; i < ATLAS_N; i++) {
    x.fillText(GLYPHS[i], i * CELL + CELL / 2, CELL / 2 + 1);
  }
  // sort by coverage so index = brightness
  const img = x.getImageData(0, 0, cv.width, cv.height).data;
  for (let i = 0; i < ATLAS_N; i++) {
    let s = 0;
    for (let yy = 0; yy < CELL; yy++) for (let xx = 0; xx < CELL; xx++) s += img[((yy * cv.width) + i * CELL + xx) * 4];
    cov.push([s, i]);
  }
  cov.sort((a, b) => a[0] - b[0]);
  const sorted = document.createElement('canvas');
  sorted.width = cv.width; sorted.height = CELL;
  const sx = sorted.getContext('2d');
  cov.forEach(([, i], k) => sx.drawImage(cv, i * CELL, 0, CELL, CELL, k * CELL, 0, CELL, CELL));
  const data = sx.getImageData(0, 0, sorted.width, CELL).data;
  const r8 = new Uint8Array(sorted.width * CELL);
  // canvas rows run top-down; the texture wants row 0 at the bottom
  for (let yy = 0; yy < CELL; yy++) for (let xx = 0; xx < sorted.width; xx++) r8[(CELL - 1 - yy) * sorted.width + xx] = data[(yy * sorted.width + xx) * 4];
  return texFromData(gl, sorted.width, CELL, 'r8', r8);
}

const ASCII_FS = `
uniform sampler2D uAtlas;
uniform float uCell;
uniform float uMode;      // 0 picture colour, 1 phosphor, 2 amber
uniform vec3 uPhosphor;
uniform float uContrast;
uniform float uBgDim;
uniform float uInvert;
uniform float uGlow;
uniform float uScan;
void main(){
  vec2 px = vUV * uSize;
  vec2 cell = vec2(uCell, uCell * 1.15);
  vec2 id = floor(px / cell);
  vec2 cuv = (id + 0.5) * cell / uSize;
  vec3 c = (picClamp(cuv) + picClamp(cuv + vec2(cell.x * 0.3, 0.0) / uSize) + picClamp(cuv - vec2(cell.x * 0.3, 0.0) / uSize)
          + picClamp(cuv + vec2(0.0, cell.y * 0.3) / uSize) + picClamp(cuv - vec2(0.0, cell.y * 0.3) / uSize)) * 0.2;
  float l = sat((luma(c) - 0.5) * uContrast + 0.5);
  if (uInvert > 0.5) l = 1.0 - l;
  float g = floor(l * ${ATLAS_N - 1}.0 + 0.5);
  vec2 f = fract(px / cell);
  vec2 auv = vec2((g + f.x) / ${ATLAS_N}.0, f.y);
  float ink = texture(uAtlas, auv).r;
  vec3 inkCol = uMode < 0.5 ? c * 1.6 : uPhosphor * (0.55 + 0.75 * l);
  vec3 col = texture(uBg, vUV).rgb * uBgDim + inkCol * ink;
  // soft phosphor bloom around the glyph
  col += inkCol * uGlow * 0.25 * texture(uAtlas, vec2((g + 0.5) / ${ATLAS_N}.0, 0.5)).r * (0.5 + 0.5 * l);
  col *= 1.0 - uScan * 0.3 * (0.5 + 0.5 * sin(vUV.y * uSize.y * 3.1416));
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const ascii = postEffect({
  type: 'ascii',
  label: 'Text mode',
  group: 'Look',
  hint: 'The picture typed out in characters, brightest where the glyphs are densest, in the video’s own colours or on a green phosphor.',
  actions: [],
  params: [
    R('cell', 'Character size (px)', 14, 6, 48, 1),
    S('mode', 'Colour', 'phosphor', [['phosphor', 'Phosphor'], ['picture', 'Picture colours']]),
    C('phosphor', 'Phosphor colour', '#5dff6d'),
    R('contrast', 'Contrast', 1.3, 0.3, 3),
    R('bgDim', 'Picture behind', 0.08, 0, 1),
    B('invert', 'Invert', false),
    R('glow', 'Glow', 0.6, 0, 2),
    R('scan', 'Scanlines', 0.3, 0, 1),
  ],
}, ASCII_FS, {
  init(ctx) { return { gl: ctx.gl, atlas: buildAtlas(ctx.gl) }; },
  uniforms(gl, u, p, st, c, color) {
    bindTex(gl, 2, st.atlas, u.uAtlas);
    gl.uniform1f(u.uCell, Math.max(4, p.cell * (c.size[0] / 1920)));
    gl.uniform1f(u.uMode, p.mode === 'picture' ? 0 : 1);
    color('uPhosphor', p.phosphor);
    gl.uniform1f(u.uContrast, p.contrast);
    gl.uniform1f(u.uBgDim, p.bgDim);
    gl.uniform1f(u.uInvert, p.invert ? 1 : 0);
    gl.uniform1f(u.uGlow, p.glow);
    gl.uniform1f(u.uScan, p.scan);
  },
  dispose(st) { if (st.atlas) st.gl.deleteTexture(st.atlas); },
});

// -------------------------------------------------------------------- 8-bit
const PALETTES = {
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  cga: ['#000000', '#55ffff', '#ff55ff', '#ffffff'],
  c64: ['#000000', '#ffffff', '#880000', '#aaffee', '#cc44cc', '#00cc55', '#0000aa', '#eeee77', '#dd8855', '#664400', '#ff7777', '#333333', '#777777', '#aaff66', '#0088ff', '#bbbbbb'],
  nes: ['#000000', '#fcfcfc', '#f8f8f8', '#bcbcbc', '#7c7c7c', '#a4e4fc', '#3cbcfc', '#0078f8', '#0000fc', '#b8f818', '#00b800', '#f87858', '#f83800', '#a80020', '#f8b800', '#ac7c00'],
  pico8: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'],
  zx: ['#000000', '#0000d7', '#d70000', '#d700d7', '#00d700', '#00d7d7', '#d7d700', '#d7d7d7', '#0000ff', '#ff0000', '#ff00ff', '#00ff00', '#00ffff', '#ffff00', '#ffffff'],
};
const EIGHT_FS = `
uniform vec3 uPal[16];
uniform int uPalN;
uniform float uPixels;
uniform float uDither;
uniform float uScan;
uniform float uCurve;
uniform float uSat;
uniform float uGlow;
const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void main(){
  vec2 uv = vUV;
  vec2 cc = uv - 0.5;
  uv = 0.5 + cc * (1.0 + uCurve * 0.1 * dot(cc, cc));
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec2 grid = vec2(uPixels, floor(uPixels * uAspect));
  vec2 id = floor(uv * grid);
  vec2 puv = (id + 0.5) / grid;
  vec3 c = satur(picClamp(puv), uSat);
  // ordered dither before the palette snap
  int bi = int(mod(id.x, 4.0)) + int(mod(id.y, 4.0)) * 4;
  c += (BAYER[bi] / 16.0 - 0.5) * uDither * 0.25;
  vec3 best = uPal[0]; float bd = 1e9;
  for (int i = 0; i < 16; i++) {
    if (i >= uPalN) break;
    vec3 d = c - uPal[i];
    float dist = dot(d * vec3(0.3, 0.59, 0.11) * 3.0, d);
    if (dist < bd) { bd = dist; best = uPal[i]; }
  }
  vec3 col = best;
  // CRT: scanlines, a little glow between lines, the tube edge
  col *= 1.0 - uScan * 0.4 * (0.5 + 0.5 * sin(uv.y * grid.y * 6.2832));
  col += best * uGlow * 0.2;
  col *= 1.0 - uCurve * 0.6 * pow(dot(cc, cc) * 2.6, 1.6);
  col *= inside;
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const eightbit = postEffect({
  type: 'eightbit',
  label: '8-bit',
  group: 'Look',
  hint: 'Chunky pixels snapped to a Game Boy, C64, NES, PICO-8, CGA or Spectrum palette, dithered, on a curved tube.',
  actions: [],
  params: [
    S('palette', 'Machine', 'pico8', [['pico8', 'PICO-8'], ['nes', 'NES'], ['c64', 'Commodore 64'], ['gameboy', 'Game Boy'], ['zx', 'ZX Spectrum'], ['cga', 'CGA']]),
    R('pixels', 'Pixels across', 160, 32, 480, 1),
    R('dither', 'Dither', 0.6, 0, 1),
    R('sat', 'Saturation', 1.3, 0, 3),
    R('scan', 'Scanlines', 0.4, 0, 1),
    R('curve', 'Tube curve', 0.4, 0, 1),
    R('glow', 'Glow', 0.4, 0, 1),
  ],
}, EIGHT_FS, {
  init() { return { buf: new Float32Array(48), pal: null }; },
  uniforms(gl, u, p, st) {
    const pal = PALETTES[p.palette] || PALETTES.pico8;
    if (st.pal !== pal) {
      st.pal = pal;
      const tmp = [0, 0, 0];
      pal.forEach((h, i) => {
        const s = h.slice(1); const n = parseInt(s, 16);
        tmp[0] = ((n >> 16) & 255) / 255; tmp[1] = ((n >> 8) & 255) / 255; tmp[2] = (n & 255) / 255;
        st.buf[i * 3] = tmp[0]; st.buf[i * 3 + 1] = tmp[1]; st.buf[i * 3 + 2] = tmp[2];
      });
    }
    gl.uniform3fv(u.uPal, st.buf);
    gl.uniform1i(u.uPalN, pal.length);
    gl.uniform1f(u.uPixels, Math.round(p.pixels));
    gl.uniform1f(u.uDither, p.dither);
    gl.uniform1f(u.uScan, p.scan);
    gl.uniform1f(u.uCurve, p.curve);
    gl.uniform1f(u.uSat, p.sat);
    gl.uniform1f(u.uGlow, p.glow);
  },
});

// ------------------------------------------------------------------ painterly
// Kuwahara filter: four overlapping windows around each pixel, and the colour
// comes from the least varied one, which flattens texture into brush-like
// patches while keeping edges. Canvas grain and dark edges finish the look.
const PAINT_FS = `
uniform float uRadius;
uniform float uCanvas;
uniform float uEdge;
uniform float uSat;
uniform float uWarm;
void main(){
  vec2 px = 1.0 / uSize;
  int R = int(uRadius);
  vec3 bestMean = vec3(0.0); float bestVar = 1e9;
  for (int q = 0; q < 4; q++) {
    vec2 sgn = vec2(q == 1 || q == 3 ? -1.0 : 1.0, q >= 2 ? -1.0 : 1.0);
    vec3 m = vec3(0.0), s2 = vec3(0.0); float n = 0.0;
    for (int j = 0; j <= 6; j++) {
      if (j > R) break;
      for (int i = 0; i <= 6; i++) {
        if (i > R) break;
        vec3 c = picClamp(vUV + vec2(float(i), float(j)) * sgn * px * 1.5);
        m += c; s2 += c * c; n += 1.0;
      }
    }
    m /= n; s2 = s2 / n - m * m;
    float v = s2.r + s2.g + s2.b;
    if (v < bestVar) { bestVar = v; bestMean = m; }
  }
  vec3 col = satur(bestMean, uSat);
  col = mix(col, col * vec3(1.06, 1.0, 0.92), uWarm);
  // dark edges where the patches meet
  vec2 e = px * 2.0;
  float l0 = luma(bestMean);
  float g = abs(luma(picClamp(vUV + vec2(e.x, 0.0))) - luma(picClamp(vUV - vec2(e.x, 0.0))))
          + abs(luma(picClamp(vUV + vec2(0.0, e.y))) - luma(picClamp(vUV - vec2(0.0, e.y))));
  col *= 1.0 - sat(g * 2.5) * uEdge * 0.6;
  // woven canvas catching the light
  float w = sin(vUV.x * uSize.x * 0.9) * sin(vUV.y * uSize.y * 0.9);
  col *= 1.0 + w * 0.06 * uCanvas + (fbm(vUV * uSize * 0.15, 2) - 0.5) * 0.12 * uCanvas;
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const painterly = postEffect({
  type: 'painterly',
  label: 'Oil paint',
  group: 'Look',
  hint: 'Detail is flattened into brush-like patches that keep their edges, on a woven canvas.',
  actions: [],
  params: [
    R('radius', 'Brush size', 4, 1, 6, 1),
    R('sat', 'Saturation', 1.25, 0, 3),
    R('edge', 'Dark edges', 0.5, 0, 1),
    R('canvas', 'Canvas texture', 0.6, 0, 1),
    R('warm', 'Warm varnish', 0.4, 0, 1),
  ],
}, PAINT_FS, {
  uniforms(gl, u, p) {
    gl.uniform1f(u.uRadius, Math.round(p.radius));
    gl.uniform1f(u.uCanvas, p.canvas);
    gl.uniform1f(u.uEdge, p.edge);
    gl.uniform1f(u.uSat, p.sat);
    gl.uniform1f(u.uWarm, p.warm);
  },
});

// -------------------------------------------------------------------- thermal
const THERMAL_FS = `
uniform float uMode;      // 0 iron, 1 rainbow, 2 night vision, 3 predator
uniform float uBands;
uniform float uNoise;
uniform float uEdges;
uniform float uGain;
uniform float uVignette;
vec3 iron(float t){
  return mix(mix(mix(mix(vec3(0.0, 0.0, 0.05), vec3(0.25, 0.0, 0.5), sat(t * 4.0)), vec3(0.9, 0.1, 0.1), sat(t * 4.0 - 1.0)),
             vec3(1.0, 0.65, 0.0), sat(t * 4.0 - 2.0)), vec3(1.0, 1.0, 0.85), sat(t * 4.0 - 3.0));
}
vec3 rainbow(float t){ return 0.5 + 0.5 * cos(6.2832 * (t * 0.8 + vec3(0.0, 0.33, 0.67)) + 3.1); }
void main(){
  vec3 c = picClamp(vUV);
  float l = sat(pow(luma(c), 1.0 / uGain));
  float n = hash12(vUV * uSize + fract(uTime * 7.0) * 100.0) - 0.5;
  l = sat(l + n * uNoise * 0.12);
  if (uBands > 1.5) l = floor(l * uBands + 0.5) / uBands;
  vec2 e = 1.5 / uSize;
  float g = abs(luma(picClamp(vUV + vec2(e.x, 0.0))) - luma(picClamp(vUV - vec2(e.x, 0.0))))
          + abs(luma(picClamp(vUV + vec2(0.0, e.y))) - luma(picClamp(vUV - vec2(0.0, e.y))));
  vec3 col;
  if (uMode < 0.5) col = iron(l);
  else if (uMode < 1.5) col = rainbow(l);
  else if (uMode < 2.5) {
    col = vec3(0.1, 1.0, 0.25) * (0.15 + 0.9 * l);
    col *= 1.0 - 0.35 * (0.5 + 0.5 * sin(vUV.y * uSize.y * 3.1416)) * 0.5;
  } else {
    col = rainbow(l) * 0.35 + vec3(0.9, 0.2, 0.05) * sat(g * 6.0) * 1.2;
  }
  col += vec3(1.0) * sat(g * 4.0) * uEdges * 0.6;
  vec2 cc = vUV - 0.5;
  col *= 1.0 - uVignette * 0.9 * pow(dot(cc, cc) * 2.5, 1.4);
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const thermal = postEffect({
  type: 'thermal',
  label: 'Thermal camera',
  group: 'Look',
  hint: 'False colour by brightness: an iron heat palette, rainbow, green night vision or a Predator-style edge view.',
  actions: [],
  params: [
    S('mode', 'Camera', 'iron', [['iron', 'Thermal (iron)'], ['rainbow', 'Thermal (rainbow)'], ['night', 'Night vision'], ['predator', 'Predator']]),
    R('gain', 'Gain', 1, 0.3, 3),
    R('bands', 'Contour bands', 0, 0, 24, 1),
    R('noise', 'Sensor noise', 0.5, 0, 2),
    R('edges', 'Edges', 0.2, 0, 1),
    R('vignette', 'Vignette', 0.5, 0, 1),
  ],
}, THERMAL_FS, {
  uniforms(gl, u, p) {
    gl.uniform1f(u.uMode, { iron: 0, rainbow: 1, night: 2, predator: 3 }[p.mode] || 0);
    gl.uniform1f(u.uBands, Math.round(p.bands));
    gl.uniform1f(u.uNoise, p.noise);
    gl.uniform1f(u.uEdges, p.edges);
    gl.uniform1f(u.uGain, p.gain);
    gl.uniform1f(u.uVignette, p.vignette);
  },
});

// -------------------------------------------------------------- stained glass
const GLASS_FS = `
uniform float uCells;
uniform float uLead;
uniform vec3 uLeadCol;
uniform float uFlat;
uniform float uSat;
uniform float uDrift;
uniform float uLight;
uniform float uBevel;
void main(){
  vec2 A = vec2(1.0, uAspect);
  vec2 p = vUV * A * uCells;
  vec2 id = floor(p);
  float d1 = 1e9, d2 = 1e9; vec2 seed1 = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = id + vec2(float(i), float(j));
    vec2 h = hash22(g);
    vec2 s = g + 0.5 + (h - 0.5) * 0.8 + 0.12 * uDrift * vec2(sin(uTime * 0.7 + h.x * 9.0), cos(uTime * 0.6 + h.y * 9.0));
    float d = length(p - s);
    if (d < d1) { d2 = d1; d1 = d; seed1 = s; }
    else if (d < d2) d2 = d;
  }
  float edge = d2 - d1;                 // 0 on a cell border
  vec2 seedUV = seed1 / (A * uCells);
  vec3 paneCol = picClamp(clamp(seedUV, 0.0, 1.0));
  vec3 col = mix(picClamp(vUV), paneCol, uFlat);
  col = satur(col, uSat);
  // glass catches the light near its bevelled edge
  col *= 1.0 + uBevel * 0.5 * smoothstep(0.35, 0.0, edge) * (0.5 + 0.5 * sin(uTime * 1.5 + seed1.x * 3.0 + seed1.y * 5.0));
  col *= 0.85 + 0.3 * uLight * hash12(seed1);
  float lead = 1.0 - smoothstep(uLead * 0.5, uLead * 0.5 + 0.03, edge);
  col = mix(col, uLeadCol, lead);
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const stainedglass = postEffect({
  type: 'stainedglass',
  label: 'Stained glass',
  group: 'Look',
  hint: 'The picture leaded into glass panes, each pane one colour, the light shifting across the panes.',
  actions: [],
  params: [
    R('cells', 'Panes across', 14, 3, 60, 1),
    R('lead', 'Lead width', 0.12, 0, 0.5),
    C('leadCol', 'Lead colour', '#141216'),
    R('flat', 'Flat panes', 0.8, 0, 1),
    R('sat', 'Saturation', 1.5, 0, 3),
    R('light', 'Uneven light', 0.6, 0, 1),
    R('bevel', 'Bevel shine', 0.6, 0, 2),
    R('drift', 'Drift', 0.5, 0, 2),
  ],
}, GLASS_FS, {
  uniforms(gl, u, p, st, c, color) {
    gl.uniform1f(u.uCells, Math.round(p.cells));
    gl.uniform1f(u.uLead, p.lead);
    color('uLeadCol', p.leadCol);
    gl.uniform1f(u.uFlat, p.flat);
    gl.uniform1f(u.uSat, p.sat);
    gl.uniform1f(u.uDrift, p.drift);
    gl.uniform1f(u.uLight, p.light);
    gl.uniform1f(u.uBevel, p.bevel);
  },
});
