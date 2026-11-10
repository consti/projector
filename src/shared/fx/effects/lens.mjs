// The picture seen through glass that is not quite good enough: a lens with
// chromatic aberration, a fisheye, an anamorphic with its oval bokeh and blue
// streaks, a tilt-shift miniature, a swirly Petzval portrait lens and the
// ghosts of a lens flare. All pure shaders over the mapped picture.

import { R, B, C, S } from './common.mjs';
import { postEffect } from './post.mjs';
import { GLSL_HUE } from './colour.mjs';

const CENTRE_PARAMS = (drift = 0.3) => [
  R('x', 'Optical axis x', 0.5, -0.2, 1.2),
  R('y', 'Optical axis y', 0.5, -0.2, 1.2),
  R('drift', 'Drift', drift, 0, 2),
  B('followPointer', 'Follow the pointer', false),
];

// A 24-tap Vogel-spiral blur. M maps the unit disc (in centre-relative local
// units, x spanning the picture) to the sample offsets, so an ellipse or a
// rotated streak is just a different matrix. Bright taps can be weighted up so
// highlights swell into bokeh discs; the spiral is turned per pixel to trade
// banding for grain.
const GLSL_BLUR = `
vec3 blurM(vec2 uv, mat2 M, float bokeh){
  vec3 acc = vec3(0.0); float wsum = 0.0;
  float j = hash12(uv * uSize) * TAU;
  for (int i = 0; i < 24; i++) {
    float fi = float(i) + 0.5;
    float rr = sqrt(fi / 24.0);
    float a = fi * 2.39996 + j;
    vec2 d = M * (rr * vec2(cos(a), sin(a)));
    vec3 c = pic(uv + d / vec2(1.0, uAspect));
    float w = 1.0 + bokeh * pow(luma(c), 4.0) * 8.0;
    acc += c * w; wsum += w;
  }
  return acc / wsum;
}
float vignette(vec2 p, float amount){
  return 1.0 - amount * smoothstep(0.15, 0.9, dot(p, p) * 2.5);
}`;

// ----------------------------------------------------------- chromatic aberration
// Lateral colour: each wavelength is magnified a little differently, so the
// picture is sampled once per slice of the spectrum at a slightly different
// zoom. Axial colour adds the purple fringe a cheap lens puts round every
// bright edge.
const CA_FS = `
uniform float uLateral;
uniform float uAxial;
uniform float uBands;
uniform float uBreath;
uniform float uDistort;
uniform float uVignette;
uniform float uShake;
uniform float uSoft;
${GLSL_HUE}
${GLSL_BLUR}
void main(){
  vec2 p = toLocal(vUV);
  float r2 = dot(p, p);
  // handheld: the axis trembles a touch
  p += uShake * 0.004 * vec2(sin(uTime * 7.3) + sin(uTime * 11.1), cos(uTime * 6.1) + sin(uTime * 9.7));
  vec2 pd = p * (1.0 + uDistort * r2);
  float breathe = 1.0 + uBreath * 0.5 * sin(uTime * 0.9);
  float k = uLateral * 0.06 * breathe * (0.3 + r2 * 2.5);
  int n = int(uBands);
  vec3 acc = vec3(0.0), wsum = vec3(1e-4);
  for (int i = 0; i < 16; i++) {
    if (i >= n) break;
    float f = (float(i) + 0.5) / float(n);
    // red bends least, blue most: the blue copy is the biggest. The slices
    // run red..blue only, so normalise each channel by the weight it got
    vec2 q = pd * (1.0 + (f - 0.15) * k);
    vec3 w = hue2rgb(f * 0.7);
    acc += pic(fromLocal(q)) * w; wsum += w;
  }
  vec3 col = acc / wsum;
  // axial colour: a soft purple halo where the picture is bright, green where dark
  if (uAxial > 0.0) {
    vec3 soft = blurM(fromLocal(pd), mat2(0.012, 0.0, 0.0, 0.012) * (1.0 + r2 * 2.0), 0.0);
    float fringe = luma(soft) - luma(col);
    col += uAxial * 1.5 * (max(fringe, 0.0) * vec3(0.9, 0.25, 1.0) + max(-fringe, 0.0) * vec3(0.2, 0.8, 0.3));
  }
  if (uSoft > 0.0) col = mix(col, blurM(fromLocal(pd), mat2(uSoft * 0.01, 0.0, 0.0, uSoft * 0.01) * (0.2 + r2 * 3.0), 0.5), smoothstep(0.1, 0.7, r2 * 2.0));
  col *= vignette(p, uVignette);
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const aberration = postEffect({
  type: 'aberration',
  label: 'Chromatic aberration',
  group: 'Lens',
  hint: 'A cheap lens: colours magnified a little differently split every edge into fringes, worst towards the corners.',
  actions: [],
  params: [
    R('lateral', 'Colour split', 1.6, 0, 4),
    R('axial', 'Purple fringing', 0.5, 0, 2),
    R('bands', 'Spectrum slices', 8, 3, 16, 1),
    R('breath', 'Breathe', 0.4, 0, 2),
    R('distort', 'Barrel distortion', 0.15, -1, 1),
    R('soft', 'Soft corners', 0.4, 0, 2),
    R('vignette', 'Vignette', 0.5, 0, 1),
    R('shake', 'Handheld shake', 0.3, 0, 2),
    ...CENTRE_PARAMS(0.15),
  ],
}, CA_FS, {
  centre: true,
  uniforms(gl, u, p) {
    gl.uniform1f(u.uLateral, p.lateral);
    gl.uniform1f(u.uAxial, p.axial);
    gl.uniform1f(u.uBands, Math.round(p.bands));
    gl.uniform1f(u.uBreath, p.breath);
    gl.uniform1f(u.uDistort, p.distort);
    gl.uniform1f(u.uVignette, p.vignette);
    gl.uniform1f(u.uShake, p.shake);
    gl.uniform1f(u.uSoft, p.soft);
  },
});

// -------------------------------------------------------------------- fisheye
// An equidistant fisheye: the angle off the axis grows linearly with distance
// from the centre, so a rectilinear picture is sampled at tan(theta) and the
// edges get crammed into the rim. Negative strength gives the pincushion of a
// bad telephoto instead.
const FISHEYE_FS = `
uniform float uStrength;
uniform float uZoom;
uniform float uCircle;
uniform float uCa;
uniform float uVignette;
uniform float uRoll;
uniform float uSway;
uniform float uRim;
${GLSL_BLUR}
vec2 warp(vec2 p){
  float r = length(p);
  if (r < 1e-5) return p;
  float s;
  if (uStrength >= 0.0) {
    float th = mix(0.05, 1.45, uStrength);
    s = tan(r * th) / tan(th);
  } else {
    float th = mix(0.05, 1.45, -uStrength);
    s = atan(r * tan(th)) / th;
  }
  return p * (s / r);
}
void main(){
  vec2 p = toLocal(vUV) * 2.0;
  p = rot2(uRoll) * p;
  p += uSway * 0.1 * vec2(sin(uTime * 0.6), cos(uTime * 0.43));
  float r = length(p);
  vec3 bg = texture(uBg, vUV).rgb;
  if (uCircle > 0.5 && r > 1.0) {
    o = vec4(mix(bg, vec3(0.0), uOpacity), 1.0);
    return;
  }
  float r2 = dot(p, p);
  vec3 col;
  // lateral colour grows with the rim
  float ca = uCa * 0.015 * r2;
  col.r = pic(fromLocal(warp(p * (1.0 - ca)) * 0.5 / uZoom)).r;
  col.g = pic(fromLocal(warp(p) * 0.5 / uZoom)).g;
  col.b = pic(fromLocal(warp(p * (1.0 + ca)) * 0.5 / uZoom)).b;
  col *= vignette(p * 0.5, uVignette);
  if (uCircle > 0.5) {
    // the dark rim of a circular fisheye, with a bright refracted edge
    col *= 1.0 - smoothstep(0.86, 1.0, r);
    col += uRim * smoothstep(0.9, 0.985, r) * (1.0 - smoothstep(0.985, 1.0, r)) * vec3(0.7, 0.85, 1.0) * 0.5;
  }
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const fisheye = postEffect({
  type: 'fisheye',
  label: 'Fisheye',
  group: 'Lens',
  hint: 'An ultra-wide fisheye that bulges the middle and crams the edges into the rim, or a telephoto’s pincushion the other way.',
  actions: [],
  params: [
    R('strength', 'Bulge', 0.8, -1, 1),
    R('zoom', 'Zoom', 1, 0.3, 3),
    B('circle', 'Circular image', false),
    R('rim', 'Bright rim', 0.6, 0, 2),
    R('ca', 'Colour fringing', 1, 0, 4),
    R('vignette', 'Vignette', 0.5, 0, 1),
    R('roll', 'Roll', 0, -1, 1),
    R('sway', 'Sway', 0.3, 0, 2),
    ...CENTRE_PARAMS(0.2),
  ],
}, FISHEYE_FS, {
  centre: true,
  uniforms(gl, u, p, st) {
    gl.uniform1f(u.uStrength, p.strength);
    gl.uniform1f(u.uZoom, p.zoom);
    gl.uniform1f(u.uCircle, p.circle ? 1 : 0);
    gl.uniform1f(u.uCa, p.ca);
    gl.uniform1f(u.uVignette, p.vignette);
    gl.uniform1f(u.uRoll, st.t * p.roll);
    gl.uniform1f(u.uSway, p.sway);
    gl.uniform1f(u.uRim, p.rim);
  },
});

// ----------------------------------------------------------------- anamorphic
// A cinema anamorphic: the picture is stretched wide, out-of-focus highlights
// become tall ovals, and every bright point throws a long blue horizontal
// streak across the frame.
const ANA_FS = `
uniform float uSqueeze;
uniform float uBlur;
uniform float uBokeh;
uniform float uStreak;
uniform float uStreakLen;
uniform vec3 uStreakCol;
uniform float uThreshold;
uniform float uLetterbox;
uniform float uBreath;
uniform float uFocusY;
${GLSL_BLUR}
void main(){
  vec2 p = toLocal(vUV);
  p.x /= uSqueeze;
  vec2 uv = fromLocal(p);
  // focus breathes slowly, and the out-of-focus band sits away from a focus line
  float breathe = 0.6 + 0.4 * sin(uTime * 0.5);
  float defocus = uBlur * 0.02 * mix(1.0, breathe, uBreath) * (0.25 + smoothstep(0.0, 0.35, abs(vUV.y - uFocusY)));
  // tall oval bokeh: squeezed in x
  vec3 col = blurM(uv, mat2(defocus * 0.45, 0.0, 0.0, defocus * 1.2), uBokeh);
  // horizontal streak from highlights
  if (uStreak > 0.0) {
    vec3 s = vec3(0.0); float wsum = 0.0;
    float j = (hash12(vUV * uSize) - 0.5) / 24.0;
    for (int i = 0; i < 24; i++) {
      float f = (float(i) + 0.5) / 24.0 + j;
      float x = (f - 0.5) * 2.0;
      float w = 1.0 - abs(x);
      w *= w;
      vec3 c = pic(uv + vec2(x * uStreakLen * 0.5, 0.0));
      float l = luma(c);
      s += c * w * smoothstep(uThreshold, uThreshold + 0.25, l);
      wsum += w;
    }
    col += s / wsum * uStreak * 1.5 * uStreakCol;
  }
  // letterbox bars
  float bar = uLetterbox * 0.5 * (1.0 - 1.0 / 1.4);
  float mask = step(bar, vUV.y) * step(vUV.y, 1.0 - bar);
  col *= mask;
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const anamorphic = postEffect({
  type: 'anamorphic',
  label: 'Anamorphic',
  group: 'Lens',
  hint: 'A cinema anamorphic: a wide stretch, tall oval bokeh and long blue streaks thrown from every bright point.',
  actions: [],
  params: [
    R('squeeze', 'Stretch', 1.33, 0.7, 2, 0.01),
    R('blur', 'Out of focus', 0.4, 0, 2),
    R('focusY', 'Focus line', 0.5, 0, 1),
    R('breath', 'Focus breathing', 0.5, 0, 1),
    R('bokeh', 'Highlight bokeh', 1, 0, 3),
    R('streak', 'Streaks', 1.6, 0, 3),
    R('streakLen', 'Streak length', 0.6, 0.05, 1.5),
    C('streakCol', 'Streak colour', '#4a8cff'),
    R('threshold', 'Streak from brighter than', 0.65, 0, 1),
    R('letterbox', 'Letterbox', 0, 0, 1),
    ...CENTRE_PARAMS(0),
  ],
}, ANA_FS, {
  centre: true,
  uniforms(gl, u, p, st, c, color) {
    gl.uniform1f(u.uSqueeze, p.squeeze);
    gl.uniform1f(u.uBlur, p.blur);
    gl.uniform1f(u.uBokeh, p.bokeh);
    gl.uniform1f(u.uStreak, p.streak);
    gl.uniform1f(u.uStreakLen, p.streakLen);
    color('uStreakCol', p.streakCol);
    gl.uniform1f(u.uThreshold, p.threshold);
    gl.uniform1f(u.uLetterbox, p.letterbox);
    gl.uniform1f(u.uBreath, p.breath);
    gl.uniform1f(u.uFocusY, 1 - p.focusY);
  },
});

// ----------------------------------------------------------------- tilt-shift
// A tilted lens plane: only a band across the picture is sharp and the blur
// grows away from it, which makes anything look like a model on a table.
// Pushed saturation and contrast finish the toy look.
const TILT_FS = `
uniform float uPos;
uniform float uBand;
uniform float uAngle;
uniform float uBlur;
uniform float uBokeh;
uniform float uSat;
uniform float uContrast;
uniform float uSlide;
uniform float uGrad;
${GLSL_BLUR}
void main(){
  vec2 A = vec2(1.0, uAspect);
  vec2 n = vec2(-sin(uAngle), cos(uAngle));
  float pos = uPos + uSlide * 0.2 * sin(uTime * 0.35);
  float d = dot((vUV - vec2(0.5, pos)) * A, n);
  float k = smoothstep(uBand * 0.5, uBand * 0.5 + uGrad, abs(d));
  float rad = uBlur * 0.025 * k;
  vec3 col = blurM(vUV, mat2(rad, 0.0, 0.0, rad), uBokeh);
  col = satur(col, uSat);
  col = (col - 0.5) * uContrast + 0.5;
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const tiltshift = postEffect({
  type: 'tiltshift',
  label: 'Tilt-shift',
  group: 'Lens',
  hint: 'Only one band of the picture is sharp and the rest melts away, so the wall looks like a model on a table.',
  actions: [],
  params: [
    R('pos', 'Focus line', 0.55, 0, 1),
    R('band', 'Sharp band', 0.2, 0.02, 1),
    R('grad', 'Falloff', 0.25, 0.02, 1),
    R('angle', 'Tilt (°)', 0, -90, 90, 1),
    R('blur', 'Blur', 1.5, 0, 3),
    R('bokeh', 'Highlight bokeh', 0.8, 0, 3),
    R('slide', 'Focus wanders', 0.4, 0, 2),
    R('sat', 'Saturation', 1.5, 0, 3),
    R('contrast', 'Contrast', 1.2, 0.5, 2),
  ],
}, TILT_FS, {
  uniforms(gl, u, p) {
    gl.uniform1f(u.uPos, 1 - p.pos);
    gl.uniform1f(u.uBand, p.band);
    gl.uniform1f(u.uAngle, (p.angle * Math.PI) / 180);
    gl.uniform1f(u.uBlur, p.blur);
    gl.uniform1f(u.uBokeh, p.bokeh);
    gl.uniform1f(u.uSat, p.sat);
    gl.uniform1f(u.uContrast, p.contrast);
    gl.uniform1f(u.uSlide, p.slide);
    gl.uniform1f(u.uGrad, p.grad);
  },
});

// -------------------------------------------------------------------- petzval
// An 1840s portrait lens: sharp in the middle, and towards the edges the
// out-of-focus discs stretch along the circle round the centre, so the whole
// background seems to swirl. With a warm glow and heavy fall-off.
const PETZVAL_FS = `
uniform float uSwirl;
uniform float uBlur;
uniform float uBokeh;
uniform float uSharp;
uniform float uGlow;
uniform float uVignette;
uniform vec3 uWarm;
uniform float uSpin;
${GLSL_BLUR}
void main(){
  vec2 p = toLocal(vUV);
  float r = length(p);
  vec2 rad = r > 1e-4 ? p / r : vec2(1.0, 0.0);
  vec2 tng = vec2(-rad.y, rad.x);
  float amt = uBlur * 0.03 * smoothstep(uSharp * 0.15, 0.6, r);
  // the ellipse: long along the tangent, short along the radius
  mat2 M = mat2(tng * amt * (0.6 + uSwirl * 1.4), rad * amt * 0.35);
  // a slow rotation of the picture itself sells the swirl
  vec2 uv = fromLocal(rot2(uSpin * r) * p);
  vec3 col = blurM(uv, M, uBokeh);
  if (uGlow > 0.0) {
    vec3 wide = blurM(uv, mat2(0.03, 0.0, 0.0, 0.03), 0.0);
    col = mix(col, max(col, wide), uGlow * 0.7) + wide * wide * uGlow * 0.4;
  }
  col *= mix(vec3(1.0), uWarm, 0.5);
  col *= vignette(p, uVignette);
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const petzval = postEffect({
  type: 'petzval',
  label: 'Petzval swirl',
  group: 'Lens',
  hint: 'An old portrait lens: sharp in the middle, and towards the edges the blur stretches round the centre until the picture swirls.',
  actions: [],
  params: [
    R('swirl', 'Swirl', 1.2, 0, 2),
    R('blur', 'Blur', 1.5, 0, 3),
    R('sharp', 'Sharp centre', 1, 0, 3),
    R('bokeh', 'Highlight bokeh', 1.2, 0, 3),
    R('glow', 'Glow', 0.5, 0, 2),
    C('warm', 'Cast', '#ffd9a8'),
    R('vignette', 'Vignette', 0.7, 0, 1),
    R('spin', 'Turn', 0.15, -1, 1),
    ...CENTRE_PARAMS(0.3),
  ],
}, PETZVAL_FS, {
  centre: true,
  uniforms(gl, u, p, st, c, color) {
    gl.uniform1f(u.uSwirl, p.swirl);
    gl.uniform1f(u.uBlur, p.blur);
    gl.uniform1f(u.uBokeh, p.bokeh);
    gl.uniform1f(u.uSharp, p.sharp);
    gl.uniform1f(u.uGlow, p.glow);
    gl.uniform1f(u.uVignette, p.vignette);
    color('uWarm', p.warm);
    gl.uniform1f(u.uSpin, Math.sin(st.t * 0.3) * p.spin);
  },
});

// ---------------------------------------------------------------------- flare
// Ghosts: every bright spot in the picture is reflected between the lens
// elements and lands again, flipped through the optical axis, as a chain of
// coloured discs along the line to the centre, plus a halo ring and an
// anamorphic streak. Added on top of the picture.
const FLARE_FS = `
uniform float uThreshold;
uniform float uGhosts;
uniform float uDispersal;
uniform float uHalo;
uniform float uHaloRad;
uniform float uStreak;
uniform float uChroma;
uniform float uIntensity;
uniform float uFlicker;
uniform float uSoft;
${GLSL_HUE}
vec3 bright(vec2 uv){
  // a little blur so the ghosts are soft discs, not hard-edged copies
  vec2 e = vec2(uSoft * 0.004) / vec2(1.0, uAspect);
  vec3 c = picClamp(uv) * 0.4 + 0.15 * (picClamp(uv + e) + picClamp(uv - e) + picClamp(uv + vec2(e.x, -e.y)) + picClamp(uv - vec2(e.x, -e.y)));
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return c * smoothstep(uThreshold, uThreshold + 0.25, luma(c)) * inside;
}
vec3 brightC(vec2 uv, vec2 dir, float amt){
  // chromatic spread along the ghost direction
  return vec3(bright(uv - dir * amt).r, bright(uv).g, bright(uv + dir * amt).b);
}
void main(){
  vec3 src = texture(uBg, vUV).rgb;
  // flip through the optical axis
  vec2 fuv = 2.0 * uCentre - vUV;
  vec2 gv = (uCentre - fuv) * uDispersal;
  vec2 dir = normalize(gv + vec2(1e-5));
  vec3 fl = vec3(0.0);
  int n = int(uGhosts);
  for (int i = 0; i < 8; i++) {
    if (i >= n) break;
    vec2 suv = fuv + gv * float(i + 1);
    float w = length((uCentre - suv) * vec2(1.0, uAspect)) / 0.7;
    w = pow(max(0.0, 1.0 - w), 6.0);
    vec3 tint = mix(vec3(1.0), hue2rgb(float(i) / 7.0 + 0.55) * 1.4, uChroma);
    fl += brightC(suv, dir, uChroma * 0.01 * float(i + 1)) * w * tint;
  }
  // halo: a ring at a fixed distance from the axis
  if (uHalo > 0.0) {
    vec2 hv = dir * uHaloRad;
    vec2 huv = fuv + hv;
    float w = length((uCentre - huv) * vec2(1.0, uAspect)) / 0.7;
    w = pow(max(0.0, 1.0 - w), 5.0);
    fl += brightC(huv, dir, uChroma * 0.02) * w * uHalo * hue2rgb(0.55 + 0.3 * w) * 1.6;
  }
  // anamorphic streak straight from the highlights
  if (uStreak > 0.0) {
    vec3 s = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      float x = (float(i) + 0.5) / 16.0 - 0.5;
      float w = 1.0 - abs(x) * 2.0;
      s += bright(vUV + vec2(x * 0.8, 0.0)) * w * w;
    }
    fl += s / 6.0 * uStreak * vec3(0.4, 0.6, 1.0);
  }
  float flick = 1.0 + uFlicker * 0.4 * (hash11(floor(uTime * 24.0)) - 0.5);
  vec3 col = src + fl * uIntensity * flick;
  o = vec4(mix(src, col, uOpacity), 1.0);
}`;

export const flare = postEffect({
  type: 'flare',
  label: 'Lens flare',
  group: 'Lens',
  hint: 'Every bright spot in the picture comes back as a chain of coloured ghosts through the optical axis, with a halo and a blue streak.',
  actions: [],
  params: [
    R('threshold', 'Flare from brighter than', 0.55, 0, 1),
    R('ghosts', 'Ghosts', 5, 0, 8, 1),
    R('dispersal', 'Ghost spacing', 0.35, 0.05, 1),
    R('halo', 'Halo', 0.8, 0, 3),
    R('haloRad', 'Halo size', 0.4, 0.1, 1),
    R('streak', 'Streak', 0.5, 0, 3),
    R('chroma', 'Colour', 0.8, 0, 1),
    R('soft', 'Softness', 1, 0, 4),
    R('intensity', 'Intensity', 1.3, 0, 4),
    R('flicker', 'Flicker', 0.3, 0, 1),
    ...CENTRE_PARAMS(0.4),
  ],
}, FLARE_FS, {
  centre: true,
  uniforms(gl, u, p) {
    gl.uniform1f(u.uThreshold, p.threshold);
    gl.uniform1f(u.uGhosts, Math.round(p.ghosts));
    gl.uniform1f(u.uDispersal, p.dispersal);
    gl.uniform1f(u.uHalo, p.halo);
    gl.uniform1f(u.uHaloRad, p.haloRad);
    gl.uniform1f(u.uStreak, p.streak);
    gl.uniform1f(u.uChroma, p.chroma);
    gl.uniform1f(u.uIntensity, p.intensity);
    gl.uniform1f(u.uFlicker, p.flicker);
    gl.uniform1f(u.uSoft, p.soft);
  },
});
