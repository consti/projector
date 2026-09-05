// Retro looks: a synthwave horizon with a neon grid floor and a striped sun,
// a worn VHS tape, and a digital glitch that can fire on the beat.

import { R, B, C, S } from './common.mjs';
import { postEffect } from './post.mjs';

// ------------------------------------------------------------------ synthwave
const SYNTH_FS = `
uniform float uHorizon;
uniform float uSunR;
uniform float uSunX;
uniform float uSunY;
uniform vec3 uGrid1; uniform vec3 uGrid2;
uniform vec3 uSunA; uniform vec3 uSunB;
uniform vec3 uTintA; uniform vec3 uTintB;
uniform float uSpeed;
uniform float uReflect;
uniform float uTint;
uniform float uScan;
uniform float uStars;
uniform float uGlow;
uniform float uFitSky;
uniform float uDensity;
uniform float uSunStripes;
vec3 grade(vec3 c){
  float l = luma(c);
  vec3 duo = mix(uTintA, uTintB, smoothstep(0.0, 1.0, l));
  return mix(c, duo * (0.35 + 1.3 * l), uTint);
}
void main(){
  vec2 uv = vUV;
  float hz = uHorizon;
  vec3 col;
  // sky picture, squeezed to sit above the horizon if asked
  vec2 skyUV = uFitSky > 0.5 ? vec2(uv.x, (uv.y - hz) / (1.0 - hz)) : uv;
  if (uv.y < hz) {
    float dy = hz - uv.y;
    float z = 0.04 / (dy + 0.0015);
    float x = (uv.x - 0.5) * z * 1.8 * uDensity;
    float zz = z * uDensity + uTime * uSpeed;
    vec2 g = abs(fract(vec2(x, zz)) - 0.5);
    float w = 0.02 + 0.06 * sat(dy * 3.0);
    float line = max(smoothstep(0.5 - w, 0.5, g.x), smoothstep(0.5 - w * 0.6, 0.5, g.y));
    line *= smoothstep(0.0, 0.04, dy);
    // the picture mirrored in the floor
    vec2 ruv = uFitSky > 0.5 ? vec2(uv.x, dy / hz * 0.9) : vec2(uv.x, hz + dy * 0.8);
    vec3 refl = grade(picClamp(ruv)) * uReflect * (0.15 + 0.5 * smoothstep(0.0, 0.3, dy));
    vec3 floorCol = mix(uTintA * 0.25, vec3(0.02, 0.0, 0.05), smoothstep(0.0, 0.5, dy)) + refl;
    vec3 gridCol = mix(uGrid1, uGrid2, sat(dy * 2.5));
    col = floorCol + gridCol * line * (1.4 + uGlow);
    col += gridCol * exp(-dy * 22.0) * uGlow * 0.8;     // horizon glow
  } else {
    vec3 vid = grade(picClamp(skyUV));
    // sun
    // aspect-correct so the disc stays round
    vec2 p = uv - vec2(uSunX, hz + uSunY * uSunR); p.y *= uAspect;
    float r = length(p);
    float sun = 1.0 - smoothstep(uSunR * 0.98, uSunR * 1.02, r);
    float sy = sat((p.y + uSunR) / (2.0 * uSunR));
    float stripes = smoothstep(0.25, 0.3, fract((p.y + uSunR) / uSunR * 7.0)) ;
    stripes = mix(1.0, stripes, uSunStripes * (1.0 - sy));
    vec3 sunCol = mix(uSunA, uSunB, sy) * sun * stripes;
    float halo = exp(-max(r - uSunR, 0.0) * 14.0) * uGlow * 0.5;
    // stars
    float st = 0.0;
    if (uStars > 0.0) {
      vec2 sc = uv * vec2(160.0, 90.0);
      vec2 id = floor(sc);
      float h = hash12(id);
      float tw = 0.5 + 0.5 * sin(uTime * (1.0 + h * 3.0) + h * 40.0);
      st = smoothstep(1.0 - uStars * 0.08, 1.0, h) * tw * (1.0 - smoothstep(0.35, 0.5, length(fract(sc) - 0.5)));
      st *= smoothstep(hz, hz + 0.3, uv.y);
    }
    // the picture sits over the sun where it is bright, and lets the sun through where dark
    float k = smoothstep(0.05, 0.6, luma(vid));
    col = mix(sunCol + uSunA * halo, vid, mix(0.45, 1.0, k));
    col += vid * 0.35 * (1.0 - k);
    col += vec3(st) * 0.9;
    // horizon haze
    col += uTintA * exp(-(uv.y - hz) * 18.0) * uGlow * 0.6;
  }
  // scanlines
  col *= 1.0 - uScan * 0.35 * (0.5 + 0.5 * sin(uv.y * uSize.y * 3.1416));
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const synthwave = postEffect({
  type: 'synthwave',
  label: 'Synthwave',
  group: 'Retro',
  hint: 'Neon grid floor rushing to a horizon, a striped sun behind the picture, pink and cyan everywhere.',
  actions: [],
  params: [
    R('horizon', 'Horizon', 0.42, 0.1, 0.8),
    R('sunSize', 'Sun size', 0.17, 0.03, 0.5),
    R('sunX', 'Sun x', 0.5, 0, 1),
    R('sunY', 'Sun height', 0.85, 0, 2),
    R('sunStripes', 'Sun stripes', 1, 0, 1),
    R('speed', 'Grid speed', 0.8, -3, 3, 0.05),
    R('density', 'Grid density', 1, 0.3, 3),
    R('reflect', 'Floor reflection', 0.7, 0, 1.5),
    R('tint', 'Colour grade', 0.55, 0, 1),
    R('glow', 'Glow', 0.8, 0, 2),
    R('scan', 'Scanlines', 0.35, 0, 1),
    R('stars', 'Stars', 0.6, 0, 1),
    B('fitSky', 'Whole picture above the horizon', true),
    C('grid1', 'Grid near', '#ff2bd6'),
    C('grid2', 'Grid far', '#2be0ff'),
    C('sunA', 'Sun bottom', '#ff2b8f'),
    C('sunB', 'Sun top', '#ffd23f'),
    C('tintA', 'Shadows', '#3a0a6e'),
    C('tintB', 'Highlights', '#ff8ad8'),
  ],
}, SYNTH_FS, {
  uniforms(gl, u, p, st, c, color) {
    gl.uniform1f(u.uHorizon, p.horizon);
    gl.uniform1f(u.uSunR, p.sunSize);
    gl.uniform1f(u.uSunX, p.sunX);
    gl.uniform1f(u.uSunY, p.sunY);
    gl.uniform1f(u.uSunStripes, p.sunStripes);
    gl.uniform1f(u.uSpeed, p.speed);
    gl.uniform1f(u.uDensity, p.density);
    gl.uniform1f(u.uReflect, p.reflect);
    gl.uniform1f(u.uTint, p.tint);
    gl.uniform1f(u.uGlow, p.glow);
    gl.uniform1f(u.uScan, p.scan);
    gl.uniform1f(u.uStars, p.stars);
    gl.uniform1f(u.uFitSky, p.fitSky ? 1 : 0);
    color('uGrid1', p.grid1); color('uGrid2', p.grid2);
    color('uSunA', p.sunA); color('uSunB', p.sunB);
    color('uTintA', p.tintA); color('uTintB', p.tintB);
  },
});

// ------------------------------------------------------------------------ vhs
const VHS_FS = `
uniform float uTracking;
uniform float uJitter;
uniform float uBleed;
uniform float uNoise;
uniform float uScan;
uniform float uWobble;
uniform float uCurve;
uniform float uWear;
uniform float uSoft;
uniform float uDropouts;
uniform float uHead;
vec3 rgb2yiq(vec3 c){ return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(0.596, -0.274, -0.322)), dot(c, vec3(0.211, -0.523, 0.312))); }
vec3 yiq2rgb(vec3 c){ return vec3(c.x + 0.956 * c.y + 0.621 * c.z, c.x - 0.272 * c.y - 0.647 * c.z, c.x - 1.106 * c.y + 1.703 * c.z); }
void main(){
  vec2 uv = vUV;
  float t = uTime;
  // slight tube curvature
  vec2 cc = uv - 0.5;
  uv = 0.5 + cc * (1.0 + uCurve * 0.12 * dot(cc, cc));
  float rows = uSize.y * 0.5;
  float row = floor(uv.y * rows);
  // tracking band creeping up the screen
  float band = fract(t * 0.13 * uTracking);
  float db = abs(uv.y - band);
  float inBand = (1.0 - smoothstep(0.0, 0.05 + 0.04 * uTracking, db)) * step(0.01, uTracking);
  // per-line horizontal jitter, wild inside the band
  float jit = (hash12(vec2(row, floor(t * 24.0))) - 0.5) * uJitter * 0.004;
  jit += inBand * (hash12(vec2(row, floor(t * 60.0))) - 0.5) * 0.06 * uTracking;
  // slow wobble
  float wob = sin(uv.y * 9.0 + t * 1.7) * sin(t * 0.7) * uWobble * 0.004;
  // head switching noise at the bottom
  float head = smoothstep(0.04, 0.0, uv.y) * uHead;
  jit += head * (hash11(floor(t * 30.0)) - 0.3) * 0.08;
  vec2 q = vec2(uv.x + jit + wob, uv.y);
  // luma sharp-ish, chroma smeared and delayed
  float px = 1.0 / uSize.x;
  float bl = uBleed * 8.0 * px;
  vec3 yiq = rgb2yiq(picClamp(q));
  vec3 y0 = rgb2yiq(picClamp(q + vec2(px * uSoft * 1.5, 0.0)));
  vec3 y1 = rgb2yiq(picClamp(q - vec2(px * uSoft * 1.5, 0.0)));
  yiq.x = (yiq.x * 2.0 + y0.x + y1.x) * 0.25;
  vec3 c1 = rgb2yiq(picClamp(q + vec2(bl, 0.0)));
  vec3 c2 = rgb2yiq(picClamp(q + vec2(bl * 2.0, 0.0)));
  vec3 c3 = rgb2yiq(picClamp(q - vec2(bl, 0.0)));
  yiq.yz = (yiq.yz + c1.yz + c2.yz + c3.yz) * 0.25;
  yiq.yz *= 1.0 - uWear * 0.35;                 // faded chroma
  yiq.x = yiq.x * (1.0 - uWear * 0.15) + uWear * 0.06;   // lifted blacks
  vec3 col = yiq2rgb(yiq);
  // noise: fine grain everywhere, streaks in the band
  float grain = hash12(uv * uSize + vec2(t * 131.0, t * 17.0)) - 0.5;
  col += grain * uNoise * 0.18;
  float streak = hash12(vec2(row, floor(t * 45.0)));
  col = mix(col, vec3(0.6 + 0.4 * streak) * step(0.4, streak), inBand * 0.8);
  col = mix(col, vec3(streak), head * 0.7);
  // dropouts: bright dashes on random lines
  float dh = hash12(vec2(row, floor(t * 12.0)));
  float dl = step(1.0 - uDropouts * 0.02, dh) * step(hash12(vec2(row * 3.1, floor(t * 12.0))), fract(uv.x * 3.0 + dh * 7.0) * 0.4);
  col = mix(col, vec3(0.95), dl);
  // scanlines and a soft vignette
  col *= 1.0 - uScan * 0.35 * (0.5 + 0.5 * sin(uv.y * uSize.y * 3.1416));
  col *= 1.0 - uCurve * 0.5 * pow(dot(cc, cc) * 2.5, 1.5);
  // out of frame after the curvature = black
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  col *= inside;
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const vhs = postEffect({
  type: 'vhs',
  label: 'VHS tape',
  group: 'Retro',
  hint: 'A worn tape: tracking bands, colour bleed, jitter, grain and a curved tube.',
  actions: [],
  params: [
    R('tracking', 'Tracking noise', 0.6, 0, 2),
    R('jitter', 'Line jitter', 0.6, 0, 3),
    R('bleed', 'Colour bleed', 1, 0, 3),
    R('soft', 'Softness', 1, 0, 3),
    R('noise', 'Grain', 0.6, 0, 2),
    R('dropouts', 'Dropouts', 0.5, 0, 2),
    R('head', 'Head switching', 0.6, 0, 1),
    R('wobble', 'Wobble', 0.5, 0, 2),
    R('wear', 'Tape wear', 0.6, 0, 1),
    R('scan', 'Scanlines', 0.4, 0, 1),
    R('curve', 'Tube curve', 0.6, 0, 1),
  ],
}, VHS_FS, {
  uniforms(gl, u, p) {
    gl.uniform1f(u.uTracking, p.tracking);
    gl.uniform1f(u.uJitter, p.jitter);
    gl.uniform1f(u.uBleed, p.bleed);
    gl.uniform1f(u.uSoft, p.soft);
    gl.uniform1f(u.uNoise, p.noise);
    gl.uniform1f(u.uDropouts, p.dropouts);
    gl.uniform1f(u.uHead, p.head);
    gl.uniform1f(u.uWobble, p.wobble);
    gl.uniform1f(u.uWear, p.wear);
    gl.uniform1f(u.uScan, p.scan);
    gl.uniform1f(u.uCurve, p.curve);
  },
});

// --------------------------------------------------------------------- glitch
const GLITCH_FS = `
uniform float uAmt;       // overall intensity this frame (base + burst)
uniform float uSeed;
uniform float uSlices;
uniform float uBlocks;
uniform float uShift;
uniform float uSplit;
uniform float uPixel;
uniform float uInvert;
uniform float uScan;
uniform float uNoise;
void main(){
  vec2 uv = vUV;
  float s = uSeed;
  // horizontal slices sliding sideways
  float row = floor(uv.y * uSlices + hash11(s) * 10.0);
  float hr = hash12(vec2(row, s));
  float on = step(1.0 - uAmt * 0.45, hr);
  uv.x += on * (hash12(vec2(row, s + 1.0)) - 0.5) * uShift * 0.4;
  // rectangular blocks torn out and moved
  vec2 bcell = floor(uv * vec2(uBlocks * 1.78, uBlocks) + hash22(vec2(s, 3.0)) * 4.0);
  float hb = hash12(bcell + s * 0.37);
  float bon = step(1.0 - uAmt * 0.25, hb);
  vec2 boff = (hash22(bcell + s) - 0.5) * uShift * 0.3;
  uv += bon * boff;
  // some blocks drop to a coarse pixel grid
  float pon = bon * step(0.5, hash12(bcell + s * 1.3)) * step(0.01, uPixel);
  vec2 pg = vec2(uPixel * 1.78, uPixel);
  vec2 puv = (floor(uv * pg) + 0.5) / pg;
  uv = mix(uv, puv, pon);
  // channel split, strongest inside the torn regions
  float sp = uSplit * 0.02 * (0.3 + on + bon) * uAmt;
  vec3 col;
  col.r = picClamp(uv + vec2(sp, 0.0)).r;
  col.g = picClamp(uv).g;
  col.b = picClamp(uv - vec2(sp, 0.0)).b;
  // inverted / channel-swapped blocks
  float inv = bon * step(1.0 - uInvert, hash12(bcell + s * 2.1));
  col = mix(col, 1.0 - col.gbr, inv);
  // line noise and a rolling scanline
  float n = hash12(uv * uSize + s * 100.0);
  col += (n - 0.5) * uNoise * uAmt * 0.6 * (on + bon * 0.5 + 0.04);
  float roll = smoothstep(0.02, 0.0, abs(fract(uTime * 0.4) - vUV.y)) * uScan;
  col += roll * 0.25;
  col *= 1.0 - uScan * 0.25 * (0.5 + 0.5 * sin(vUV.y * uSize.y * 3.1416));
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const glitch = postEffect({
  type: 'glitch',
  label: 'Glitch',
  group: 'Retro',
  hint: 'Torn slices, displaced blocks and split colour channels, in bursts or on the beat.',
  actions: [{ name: 'burst', label: 'Glitch now' }],
  params: [
    R('amount', 'Constant glitch', 0.35, 0, 1),
    R('bursts', 'Bursts per second', 0.5, 0, 6, 0.1),
    R('burstSize', 'Burst strength', 1, 0, 2),
    R('rate', 'Changes per second', 12, 1, 60, 1),
    R('slices', 'Slices', 24, 4, 120, 1),
    R('blocks', 'Blocks', 8, 2, 40, 1),
    R('shift', 'Displacement', 0.5, 0, 2),
    R('split', 'Colour split', 0.6, 0, 3),
    R('pixel', 'Pixelation', 40, 0, 200, 1),
    R('invert', 'Inverted blocks', 0.3, 0, 1),
    R('noise', 'Noise', 0.5, 0, 2),
    R('scan', 'Scanlines', 0.3, 0, 1),
  ],
}, GLITCH_FS, {
  init() { return { burst: 0, acc: 0, seed: 0, lastQ: -1 }; },
  action(st, name, arg, w, p) { if (name === 'burst') st.burst = Math.max(st.burst, p.burstSize); },
  step(st, dt, w, p) {
    st.burst *= Math.exp(-dt * 5);
    st.acc += dt * p.bursts;
    if (st.acc >= 1) { st.acc -= 1; st.burst = Math.max(st.burst, p.burstSize * (0.6 + 0.4 * Math.random())); }
    const q = Math.floor(st.t * p.rate);
    if (q !== st.lastQ) { st.lastQ = q; st.seed = (q * 7.31) % 1000; }
  },
  uniforms(gl, u, p, st) {
    gl.uniform1f(u.uAmt, Math.min(1.5, p.amount + st.burst));
    gl.uniform1f(u.uSeed, st.seed);
    gl.uniform1f(u.uSlices, Math.round(p.slices));
    gl.uniform1f(u.uBlocks, Math.round(p.blocks));
    gl.uniform1f(u.uShift, p.shift);
    gl.uniform1f(u.uSplit, p.split);
    gl.uniform1f(u.uPixel, Math.round(p.pixel));
    gl.uniform1f(u.uInvert, p.invert);
    gl.uniform1f(u.uScan, p.scan);
    gl.uniform1f(u.uNoise, p.noise);
  },
});
