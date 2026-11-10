// Colour taken apart and put back wrong: the picture split into a spectrum
// through a prism, its channels sent orbiting each other, folded back on
// themselves like a solarised print, glazed with the interference rainbows of
// an oil film, and smeared into trails whose colours fade at different speeds.
// All pure shaders over the mapped picture.

import { PingPong, bindTex } from '../glu.mjs';
import { R, B, S } from './common.mjs';
import { postEffect } from './post.mjs';

const CENTRE_PARAMS = (drift = 0.3) => [
  R('x', 'Centre x', 0.5, -0.2, 1.2),
  R('y', 'Centre y', 0.5, -0.2, 1.2),
  R('drift', 'Drift', drift, 0, 2),
  B('followPointer', 'Follow the pointer', false),
];

// pure hue 0..1 -> rgb, smoothed so a sum of copies spread evenly round the
// wheel adds back to grey (each channel averages 0.5)
export const GLSL_HUE = `
vec3 hue2rgb(float h){
  vec3 c = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c * c * (3.0 - 2.0 * c);
}`;

// ---------------------------------------------------------------------- prism
// Chromatic dispersion: the picture is sampled many times along a line, each
// sample tinted with one slice of the spectrum. Flat colour adds back to
// itself; every edge splits into a rainbow, like light through cheap glass.
const PRISM_FS = `
uniform float uBands;
uniform float uSpread;
uniform float uTangent;   // 0 radial dispersion, 1 swirling round the centre
uniform float uLinear;    // 0 lens-like (grows with radius), 1 the same everywhere
uniform float uAngle;
uniform float uBreath;
uniform float uHueSpin;
uniform float uSat;
uniform float uGain;
uniform float uWobble;
${GLSL_HUE}
void main(){
  vec2 p = toLocal(vUV);
  float r = length(p);
  vec2 rad = r > 1e-4 ? p / r : vec2(1.0, 0.0);
  vec2 tan = vec2(-rad.y, rad.x);
  vec2 lin = vec2(cos(uAngle), sin(uAngle));
  vec2 dir = normalize(mix(mix(rad, tan, uTangent), lin, uLinear) + vec2(1e-5));
  float breathe = 1.0 + uBreath * 0.6 * sin(uTime * 1.1 + r * 7.0);
  float amt = uSpread * 0.25 * breathe * mix(r * 2.2, 1.0, uLinear);
  // a slow wobble of the dispersion line so the fringes crawl
  amt *= 1.0 + uWobble * 0.5 * sin(uTime * 0.7 + atan(p.y, p.x) * 3.0);
  int n = int(uBands);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 32; i++) {
    if (i >= n) break;
    float f = (float(i) + 0.5) / float(n);
    vec2 q = p + dir * (f - 0.5) * amt;
    acc += pic(fromLocal(q)) * hue2rgb(f + uHueSpin);
  }
  vec3 col = acc * 2.0 / float(n);
  col = satur(col, uSat) * uGain;
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const prism = postEffect({
  type: 'prism',
  label: 'Prism',
  group: 'Trippy',
  hint: 'The picture pulled apart into a spectrum: flat colour stays put while every edge splits into a breathing rainbow.',
  actions: [],
  params: [
    R('bands', 'Spectrum slices', 12, 3, 32, 1),
    R('spread', 'Spread', 1.2, 0, 3),
    R('tangent', 'Swirl', 0.4, 0, 1),
    R('linear', 'Same everywhere', 0, 0, 1),
    R('angle', 'Line angle (°)', 0, 0, 360, 1),
    R('breath', 'Breathe', 0.5, 0, 2),
    R('wobble', 'Wobble', 0.5, 0, 2),
    R('hueSpin', 'Spectrum spin', 0.15, -1, 1),
    R('sat', 'Saturation', 2, 0, 4),
    R('gain', 'Brightness', 1.15, 0.5, 2),
    ...CENTRE_PARAMS(0.3),
  ],
}, PRISM_FS, {
  centre: true,
  uniforms(gl, u, p, st) {
    gl.uniform1f(u.uBands, Math.round(p.bands));
    gl.uniform1f(u.uSpread, p.spread);
    gl.uniform1f(u.uTangent, p.tangent);
    gl.uniform1f(u.uLinear, p.linear);
    gl.uniform1f(u.uAngle, (p.angle * Math.PI) / 180);
    gl.uniform1f(u.uBreath, p.breath);
    gl.uniform1f(u.uHueSpin, st.t * p.hueSpin);
    gl.uniform1f(u.uSat, p.sat);
    gl.uniform1f(u.uGain, p.gain);
    gl.uniform1f(u.uWobble, p.wobble);
  },
});

// ---------------------------------------------------------------------- orbit
// Several copies of the picture, each tinted one hue, circle each other round
// the centre. Where they line up the picture is itself; where they part it
// splits into coloured ghosts that dance in a ring.
const ORBIT_FS = `
uniform float uCopies;
uniform float uRadius;
uniform float uPhase;     // orbit position
uniform float uSpin;      // each copy's own rotation
uniform float uZoomSpread;
uniform float uHueSpin;
uniform float uSat;
uniform float uGain;
uniform float uWave;      // the orbit radius swells with distance from centre
${GLSL_HUE}
void main(){
  vec2 p = toLocal(vUV);
  float r = length(p);
  int n = int(uCopies);
  float rad = uRadius * 0.1 * (1.0 + uWave * 2.0 * r);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    if (i >= n) break;
    float f = float(i) / float(n);
    float ang = uPhase + f * TAU;
    vec2 off = vec2(cos(ang), sin(ang)) * rad;
    float z = 1.0 + (f - 0.5) * uZoomSpread * 0.3;
    vec2 q = rot2(uSpin * (f - 0.5)) * p * z + off;
    acc += pic(fromLocal(q)) * hue2rgb(f + uHueSpin);
  }
  vec3 col = acc * 2.0 / float(n);
  col = satur(col, uSat) * uGain;
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const orbit = postEffect({
  type: 'orbit',
  label: 'Colour orbit',
  group: 'Trippy',
  hint: 'Tinted copies of the picture circle each other: where they meet it is whole, where they part it splits into coloured ghosts.',
  actions: [],
  params: [
    R('copies', 'Copies', 3, 2, 12, 1),
    R('radius', 'Orbit size', 0.4, 0, 2),
    R('speed', 'Orbit speed', 0.5, -3, 3, 0.05),
    R('spin', 'Copy spin', 0.1, -2, 2),
    R('zoomSpread', 'Zoom spread', 0.3, 0, 2),
    R('wave', 'Wider at the edges', 0.5, 0, 2),
    R('hueSpin', 'Colour spin', 0.1, -1, 1),
    R('sat', 'Saturation', 1.5, 0, 3),
    R('gain', 'Brightness', 1.1, 0.5, 2),
    ...CENTRE_PARAMS(0.3),
  ],
}, ORBIT_FS, {
  centre: true,
  uniforms(gl, u, p, st) {
    gl.uniform1f(u.uCopies, Math.round(p.copies));
    gl.uniform1f(u.uRadius, p.radius);
    gl.uniform1f(u.uPhase, st.t * p.speed);
    gl.uniform1f(u.uSpin, Math.sin(st.t * 0.6) * p.spin);
    gl.uniform1f(u.uZoomSpread, p.zoomSpread);
    gl.uniform1f(u.uHueSpin, st.t * p.hueSpin);
    gl.uniform1f(u.uSat, p.sat);
    gl.uniform1f(u.uGain, p.gain);
    gl.uniform1f(u.uWave, p.wave);
  },
});

// ------------------------------------------------------------------- solarise
// The Sabattier effect taken too far: every channel's tone curve is a sine
// wave folded over several times, and the folds crawl through the picture,
// so a smooth gradient becomes a rolling rainbow and nothing holds its colour.
const SOLAR_FS = `
uniform float uFolds;
uniform float uSpeed;
uniform float uSplit;     // phase spread between channels
uniform float uTone;      // fold on brightness instead of per channel
uniform float uRipple;    // spatial phase: rings from the centre
uniform float uWarp;      // spatial phase: noise
uniform float uContours;
uniform float uSat;
uniform float uMix;
void main(){
  vec3 c = texture(uBg, vUV).rgb;
  float l = luma(c);
  vec2 p = toLocal(vUV);
  float t = uTime * uSpeed;
  float ph = t + uRipple * length(p) * 10.0 + uWarp * 6.0 * (fbm(p * 3.0 + vec2(t * 0.15, -t * 0.1), 3) - 0.5);
  vec3 phase = vec3(ph) + vec3(0.0, 2.094, 4.188) * uSplit;
  vec3 perChan = 0.5 + 0.5 * sin(TAU * uFolds * c + phase);
  vec3 onTone = 0.5 + 0.5 * sin(TAU * uFolds * l + phase);
  vec3 col = mix(perChan, onTone, uTone);
  if (uContours > 0.0) {
    float k = abs(fract(uFolds * l + ph / TAU) - 0.5);
    col *= 1.0 - uContours * (1.0 - smoothstep(0.0, 0.05, k));
  }
  col = satur(col, uSat);
  col = mix(c, col, uMix);
  vec3 bg = c;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const solarise = postEffect({
  type: 'solarise',
  label: 'Solarise',
  group: 'Trippy',
  hint: 'Every tone curve folded into a sine wave that keeps rolling, so a plain gradient turns into a crawling rainbow.',
  actions: [],
  params: [
    R('folds', 'Folds', 2, 0.5, 8, 0.1),
    R('speed', 'Crawl speed', 0.8, -4, 4, 0.05),
    R('split', 'Channel split', 0.5, 0, 1),
    R('tone', 'Fold brightness, not colour', 0.4, 0, 1),
    R('ripple', 'Rings from the centre', 0.4, 0, 2),
    R('warp', 'Noise', 0.5, 0, 2),
    R('contours', 'Dark contours', 0.3, 0, 1),
    R('sat', 'Saturation', 1.3, 0, 3),
    R('mix', 'Amount', 1, 0, 1),
    ...CENTRE_PARAMS(0.3),
  ],
}, SOLAR_FS, {
  centre: true,
  uniforms(gl, u, p) {
    gl.uniform1f(u.uFolds, p.folds);
    gl.uniform1f(u.uSpeed, p.speed);
    gl.uniform1f(u.uSplit, p.split);
    gl.uniform1f(u.uTone, p.tone);
    gl.uniform1f(u.uRipple, p.ripple);
    gl.uniform1f(u.uWarp, p.warp);
    gl.uniform1f(u.uContours, p.contours);
    gl.uniform1f(u.uSat, p.sat);
    gl.uniform1f(u.uMix, p.mix);
  },
});

// ------------------------------------------------------------------ oil slick
// Thin-film interference: a film of oil whose thickness is the picture's
// brightness plus a slow swirl. Each wavelength interferes with itself at a
// different thickness, so the surface shimmers with petrol-puddle rainbows.
const OIL_FS = `
uniform float uScale;
uniform float uSpeed;
uniform float uThickness;
uniform float uDepth;     // how much the picture's brightness thickens the film
uniform float uSwirl;
uniform float uSheen;     // how much of the rainbow lies over the picture
uniform float uSat;
uniform float uBlend;     // 0 overlay, 1 replace, 2 multiply
void main(){
  vec3 c = texture(uBg, vUV).rgb;
  vec2 p = toLocal(vUV);
  float t = uTime * uSpeed;
  // domain-warped noise swirl: the film is always being pushed around
  vec2 w = vec2(fbm(p * uScale + vec2(t * 0.2, 0.0), 3), fbm(p * uScale + vec2(3.3, -t * 0.17), 3)) - 0.5;
  float film = fbm(p * uScale * 0.7 + w * uSwirl * 2.0 + vec2(-t * 0.08, t * 0.05), 4);
  float d = uThickness * (0.4 + film) + uDepth * luma(c);
  // path difference 2d, three wavelengths: red interferes slowest
  vec3 k = vec3(1.0, 1.23, 1.41) * 12.0;
  vec3 iri = 0.5 + 0.5 * cos(d * k + vec3(0.0, 0.6, 1.2));
  iri = satur(iri, uSat);
  vec3 col;
  if (uBlend < 0.5) {
    // overlay: light picture tints, dark picture glows
    col = mix(2.0 * c * iri, 1.0 - 2.0 * (1.0 - c) * (1.0 - iri), step(0.5, luma(c)));
  } else if (uBlend < 1.5) {
    col = iri * (0.35 + 0.65 * (luma(c) + 0.4));
  } else {
    col = c * iri * 1.6;
  }
  col = mix(c, col, uSheen);
  vec3 bg = c;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const oilslick = postEffect({
  type: 'oilslick',
  label: 'Oil slick',
  group: 'Trippy',
  hint: 'A film of oil over the picture, its slow swirl throwing the interference rainbows of a petrol puddle.',
  actions: [],
  params: [
    R('scale', 'Swirl size', 2.5, 0.5, 10, 0.1),
    R('speed', 'Speed', 1, 0, 4),
    R('thickness', 'Film thickness', 1, 0, 3),
    R('depth', 'Picture thickens the film', 1.5, 0, 4),
    R('swirl', 'Swirl', 0.6, 0, 2),
    S('blend', 'Lay it on', 'overlay', [['overlay', 'Overlay'], ['replace', 'Replace the picture'], ['multiply', 'Multiply']]),
    R('sheen', 'Sheen', 0.9, 0, 1),
    R('sat', 'Saturation', 1.2, 0, 3),
    ...CENTRE_PARAMS(0.3),
  ],
}, OIL_FS, {
  centre: true,
  uniforms(gl, u, p) {
    gl.uniform1f(u.uScale, p.scale);
    gl.uniform1f(u.uSpeed, p.speed);
    gl.uniform1f(u.uThickness, p.thickness);
    gl.uniform1f(u.uDepth, p.depth);
    gl.uniform1f(u.uSwirl, p.swirl);
    gl.uniform1f(u.uSheen, p.sheen);
    gl.uniform1f(u.uSat, p.sat);
    gl.uniform1f(u.uBlend, { overlay: 0, replace: 1, multiply: 2 }[p.blend] || 0);
  },
});

// --------------------------------------------------------------------- trails
// Phosphor with a different memory for each colour: red lets go at once, blue
// hangs on, so anything that moves leaves a rainbow smear behind it. The
// smear is nudged and hue-turned each frame so even a still picture bleeds.
const TRAILS_FS = `
uniform sampler2D uPrev;
uniform vec3 uDecay;
uniform float uZoom;
uniform float uAngle;
uniform float uHue;
uniform vec2 uSlide;
uniform float uMode;      // 0 lighten, 1 mix, 2 screen
void main(){
  vec2 p = toLocal(vUV);
  p = rot2(uAngle) * p / uZoom + uSlide;
  vec2 q = fromLocal(p);
  float inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
  vec3 prev = texture(uPrev, clamp(q, vec2(0.0), vec2(1.0))).rgb * inside;
  // the hue turn overshoots 0..1 on saturated colour; clamp it or the
  // lighten blend keeps the overshoot forever and burns the buffer white
  prev = sat(hueShift(prev, uHue)) * uDecay;
  vec3 src = texture(uBg, vUV).rgb;
  vec3 col;
  if (uMode < 0.5) col = max(src, prev);
  else if (uMode < 1.5) col = mix(src, prev, uDecay);
  else col = 1.0 - (1.0 - src) * (1.0 - prev);
  // no saturation or gain here: anything applied to the output is fed back
  // next frame and runs away
  o = vec4(mix(src, col, uOpacity), 1.0);
}`;

export const trails = postEffect({
  type: 'trails',
  label: 'Colour trails',
  group: 'Trippy',
  hint: 'Each colour fades at its own speed, so anything that moves drags a rainbow smear behind it.',
  actions: [{ name: 'clear', label: 'Clear' }],
  params: [
    R('red', 'Red lingers', 0.85, 0, 1, 0.005),
    R('green', 'Green lingers', 0.93, 0, 1, 0.005),
    R('blue', 'Blue lingers', 0.98, 0, 1, 0.005),
    R('hue', 'Colour turn per frame', 0.04, -0.5, 0.5, 0.005),
    R('zoom', 'Zoom per frame', 1.01, 0.95, 1.05, 0.001),
    R('rotate', 'Turn per frame (°)', 0.8, -6, 6, 0.05),
    R('slideX', 'Slide x', 0, -0.02, 0.02, 0.0005),
    R('slideY', 'Slide y', 0.002, -0.02, 0.02, 0.0005),
    S('mode', 'Blend', 'lighten', [['lighten', 'Lighten'], ['mix', 'Mix'], ['screen', 'Screen']]),
    ...CENTRE_PARAMS(0.1),
  ],
}, TRAILS_FS, {
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
    gl.uniform3f(u.uDecay, p.red, p.green, p.blue);
    gl.uniform1f(u.uZoom, p.zoom);
    gl.uniform1f(u.uAngle, (p.rotate * Math.PI) / 180);
    gl.uniform1f(u.uHue, p.hue);
    gl.uniform2f(u.uSlide, p.slideX, -p.slideY);
    gl.uniform1f(u.uMode, { lighten: 0, mix: 1, screen: 2 }[p.mode] || 0);
  },
  after(st, c) {
    if (!st.pp) return;
    if (st.stepped !== false) c.screen.copy(c.dst.tex, st.pp.read);
    c.dst.bind();
  },
  dispose(st) { if (st.pp) st.pp.dispose(); },
});
