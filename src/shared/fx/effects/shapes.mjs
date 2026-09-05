// Effects that act on the shapes you masked rather than on the picture: a
// light that makes them cast shadows on the wall, an extrusion that turns them
// into blocks standing off the wall, and an aura of contour waves that ripples
// out from their outlines. All of them read the occluder distance field, so
// "select a shape" simply means letting the effects see it.

import { R, B, C, S } from './common.mjs';
import { postEffect } from './post.mjs';

const LIGHT_PARAMS = [
  R('x', 'Light x', 0.5, -0.5, 1.5),
  R('y', 'Light y', -0.2, -0.8, 1.5),
  R('drift', 'Drift', 0, 0, 2),
  B('followPointer', 'Light at the pointer', false),
];

// -------------------------------------------------------------------- shadows
// The shapes are treated as slabs of height h in front of the wall; a point
// light at (L, Lz) projects them onto the wall. For every pixel we march the
// slab heights and ask whether the projected point lands inside a shape.
const SHADOW_FS = `
uniform float uHeight;
uniform float uLz;
uniform float uSoft;
uniform float uDark;
uniform float uLamp;
uniform vec3 uLampCol;
uniform float uAmbient;
uniform float uSpread;
uniform float uContact;
void main(){
  vec2 uv = vUV;
  vec2 L = uCentre;
  vec2 A = vec2(1.0, uAspect);
  float smax = uHeight / max(uLz - uHeight, 0.05);
  // P(s) = (uv + L s) / (1 + s) is the slab point at height parameter
  // s = z / (Lz - z) that casts onto uv. Rather than a union of hard cut-outs
  // (which bands), take the signed distance to the nearest caster over the
  // whole slab, in wall units, and soften that once: the penumbra of a lamp of
  // radius R at height z is R z / (Lz - z) = R s wide, so it is soft far from
  // the caster and razor sharp where the shape meets the wall.
  float dmin = 1e3, sHit = 0.0;
  for (int i = 0; i < 32; i++) {
    float s = smax * (float(i) + 0.5) / 32.0;
    vec2 P = (uv + L * s) / (1.0 + s);
    float d = shapeD(P) * (1.0 + s);
    if (d < dmin) { dmin = d; sHit = s; }
  }
  float pen = 0.0015 + uSoft * 0.05 * sHit;
  float sh = 1.0 - smoothstep(-pen, pen, dmin);
  // light creeps in from around the caster the further the shadow is thrown
  sh *= 1.0 - 0.35 * uSoft * sat(sHit / max(smax, 1e-4));
  // the shape itself never shadows itself; that pixel is black anyway
  float d0 = shapeD(uv);
  float self = 1.0 - smoothstep(-0.002, 0.002, d0);
  sh *= 1.0 - self;
  vec3 col = texture(uBg, uv).rgb;
  // the lamp: a warm pool of light on the wall, falling off with distance
  vec2 dl = (uv - L) * A;
  float dist2 = dot(dl, dl) + uLz * uLz * 0.25;
  float lamp = uLamp * 0.12 / (dist2 * uSpread + 0.01);
  vec3 lit = col * (uAmbient + lamp * uLampCol * 2.0);
  // a little contact darkening right against the base of every shape
  float ao = uContact * exp(-max(d0, 0.0) * 40.0) * (1.0 - self);
  lit = mix(lit, lit * (1.0 - uDark), max(sh, ao * 0.6));
  o = vec4(mix(col, lit, uOpacity), 1.0);
}`;

export const shadows = postEffect({
  type: 'shadows',
  label: 'Shadows',
  group: 'Shapes',
  hint: 'A lamp in front of the wall makes every masked shape cast a shadow. Move the pointer and the shadows swing with it.',
  actions: [],
  params: [
    R('height', 'Shape thickness', 0.25, 0.02, 1),
    R('lz', 'Lamp distance', 1.4, 0.3, 4),
    R('soft', 'Penumbra', 0.6, 0, 2),
    R('dark', 'Shadow darkness', 0.85, 0, 1),
    R('contact', 'Contact shadow', 0.5, 0, 1),
    R('lamp', 'Lamp brightness', 0.8, 0, 3),
    R('spread', 'Lamp focus', 1, 0.2, 4),
    R('ambient', 'Ambient light', 0.55, 0, 1.5),
    C('lampCol', 'Lamp colour', '#ffd9a8'),
    ...LIGHT_PARAMS,
  ],
}, SHADOW_FS, {
  centre: true,
  uniforms(gl, u, p, st, c, color) {
    gl.uniform1f(u.uHeight, p.height);
    gl.uniform1f(u.uLz, Math.max(p.lz, p.height + 0.1));
    gl.uniform1f(u.uSoft, p.soft);
    gl.uniform1f(u.uDark, p.dark);
    gl.uniform1f(u.uLamp, p.lamp);
    gl.uniform1f(u.uSpread, p.spread);
    gl.uniform1f(u.uAmbient, p.ambient);
    gl.uniform1f(u.uContact, p.contact == null ? 0.5 : p.contact);
    color('uLampCol', p.lampCol);
  },
});

// -------------------------------------------------------------------- extrude
// The shapes become blocks standing off the wall. Seen from an eye at
// distance E in front of the vanishing point V, a point at height z appears
// scaled about V by 1/(1 - z/E); the side faces join the outline on the wall
// to the outline at the top. For each pixel we march z from the top down and
// see whether the wall point that would project here lies inside a shape.
const EXTRUDE_FS = `
uniform float uHeight;
uniform float uEye;
uniform vec3 uSideCol;
uniform float uPicture;
uniform float uGrain;
uniform vec2 uLight;
uniform float uAO;
uniform float uEdge;
uniform float uTopShade;
void main(){
  vec2 uv = vUV;
  vec2 V = uCentre;
  vec2 A = vec2(1.0, uAspect);
  vec3 col = texture(uBg, uv).rgb;
  float h = uHeight;
  float dTop = shapeD(V + (uv - V) * (1.0 - h / uEye));
  float dBase = shapeD(uv);
  float hitZ = -1.0;
  vec2 hitP = uv;
  if (dTop >= 0.0 && dBase >= 0.0) {
    // side face candidate: find the height whose projection lands in the shape
    for (int i = 0; i < 40; i++) {
      float z = h * (1.0 - (float(i) + 0.5) / 40.0);
      vec2 P = V + (uv - V) * (1.0 - z / uEye);
      if (shapeD(P) < 0.0) { hitZ = z; hitP = P; break; }
    }
  }
  vec3 outCol = col;
  if (dTop < 0.0) {
    // the top face: the picture carried up with the block, or a slab colour
    vec2 P = V + (uv - V) * (1.0 - h / uEye);
    vec3 top = mix(uSideCol * 1.25, texture(uBg, P).rgb, uPicture);
    outCol = top * uTopShade;
    // a bright lip along the top edge
    outCol += vec3(0.6) * uEdge * (1.0 - smoothstep(0.0, 0.006, -dTop));
  } else if (hitZ >= 0.0) {
    vec2 n = shapeN(hitP);
    float diff = max(dot(n, uLight), 0.0);
    float wrap = 0.5 + 0.5 * dot(n, uLight);
    vec3 base = mix(uSideCol, texture(uBg, hitP).rgb, uPicture * 0.6);
    float grain = 1.0 - uGrain * 0.35 * fbm(vec2(hitZ * 60.0, dot(hitP, vec2(37.0, 91.0))), 3);
    float depth = 1.0 - 0.45 * (1.0 - hitZ / max(h, 1e-4));   // darker towards the wall
    outCol = base * (0.25 + 0.9 * mix(diff, wrap, 0.5)) * grain * depth;
    // the edge where the side meets the top catches the light
    outCol += vec3(0.5) * uEdge * smoothstep(h * 0.9, h, hitZ) * (0.4 + 0.6 * diff);
  } else {
    // contact shadow on the wall around the base
    float ao = exp(-max(dBase, 0.0) * 22.0 / (0.3 + h)) * uAO;
    outCol = col * (1.0 - ao * 0.75);
  }
  o = vec4(mix(col, outCol, uOpacity), 1.0);
}`;

export const extrude = postEffect({
  type: 'extrude',
  label: 'Blocks',
  group: 'Shapes',
  hint: 'The masked shapes stand off the wall as solid blocks, in perspective from wherever the vanishing point is.',
  actions: [],
  params: [
    R('height', 'Height', 0.35, 0.02, 1.5),
    R('eye', 'Eye distance', 3, 1.2, 8),
    R('picture', 'Picture on the block', 0.3, 0, 1),
    C('sideCol', 'Block colour', '#8d8fa3'),
    R('grain', 'Grain', 0.5, 0, 1),
    R('lightAngle', 'Light angle', 225, 0, 360, 1),
    R('ao', 'Contact shadow', 0.7, 0, 1.5),
    R('edge', 'Edge highlight', 0.5, 0, 1),
    R('topShade', 'Top brightness', 0.9, 0.2, 1.6),
    R('x', 'Vanishing point x', 0.5, -0.5, 1.5),
    R('y', 'Vanishing point y', 0.5, -0.5, 1.5),
    R('drift', 'Drift', 0.4, 0, 2),
    B('followPointer', 'Vanishing point at the pointer', false),
  ],
}, EXTRUDE_FS, {
  centre: true,
  uniforms(gl, u, p, st, c, color) {
    gl.uniform1f(u.uHeight, p.height);
    gl.uniform1f(u.uEye, Math.max(p.eye, p.height + 0.3));
    color('uSideCol', p.sideCol);
    gl.uniform1f(u.uPicture, p.picture);
    gl.uniform1f(u.uGrain, p.grain);
    const a = (p.lightAngle * Math.PI) / 180;
    gl.uniform2f(u.uLight, Math.cos(a), -Math.sin(a));
    gl.uniform1f(u.uAO, p.ao);
    gl.uniform1f(u.uEdge, p.edge);
    gl.uniform1f(u.uTopShade, p.topShade);
  },
});

// ----------------------------------------------------------------------- aura
const AURA_FS = `
uniform float uRings;
uniform float uRingSpeed;
uniform float uRingWidth;
uniform float uReach;
uniform vec3 uRingCol;
uniform float uHue;
uniform float uGlow;
uniform float uBulge;
uniform float uBreathe;
uniform float uGrow;
uniform float uGrowSpeed;
void main(){
  vec2 uv = vUV;
  float d = shapeD(uv);
  vec2 n = shapeN(uv);
  float t = uTime;
  vec3 bg = texture(uBg, uv).rgb;
  // the picture is pushed away from every outline and breathes
  float push = uBulge * 0.06 * exp(-max(d, 0.0) / (uReach * 0.5)) * (uBreathe > 0.0 ? 0.6 + 0.4 * sin(t * uBreathe) : 1.0);
  vec3 col = texture(uBg, clamp(uv + n * push / vec2(1.0, uAspect), 0.0, 1.0)).rgb;
  float fall = exp(-max(d, 0.0) / uReach);
  // contour waves travelling outwards
  float ph = fract(d * uRings - t * uRingSpeed);
  float ring = smoothstep(uRingWidth, 0.0, min(ph, 1.0 - ph)) * fall * step(0.0, d);
  vec3 rc = hueShift(uRingCol, uHue * d * 8.0 + uHue * t * 0.3);
  col += rc * ring * 1.8;
  // a soft halo hugging the outline
  col += rc * uGlow * exp(-max(d, 0.0) * 30.0) * 0.8;
  // the silhouette itself swells and shrinks
  float g = uGrow * 0.08 * (0.5 + 0.5 * sin(t * uGrowSpeed));
  float grown = 1.0 - smoothstep(g - 0.004, g + 0.004, d);
  col *= 1.0 - grown * step(0.0001, uGrow);
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const aura = postEffect({
  type: 'aura',
  label: 'Aura',
  group: 'Shapes',
  hint: 'Neon contour waves ripple out from every masked shape; the picture bulges away from them and the silhouettes breathe.',
  actions: [],
  params: [
    R('rings', 'Wave count', 24, 2, 120, 1),
    R('ringSpeed', 'Wave speed', 0.6, -3, 3, 0.05),
    R('ringWidth', 'Wave width', 0.12, 0.01, 0.5),
    R('reach', 'Reach', 0.18, 0.02, 1),
    C('ringCol', 'Colour', '#4be3ff'),
    R('hue', 'Colour drift', 0.3, 0, 2),
    R('glow', 'Edge glow', 0.6, 0, 3),
    R('bulge', 'Push the picture', 0.5, 0, 2),
    R('breathe', 'Breathing speed', 0, 0, 6),
    R('grow', 'Silhouette growth', 0, 0, 2),
    R('growSpeed', 'Growth speed', 0.8, 0, 6),
  ],
}, AURA_FS, {
  uniforms(gl, u, p, st, c, color) {
    gl.uniform1f(u.uRings, Math.round(p.rings));
    gl.uniform1f(u.uRingSpeed, p.ringSpeed);
    gl.uniform1f(u.uRingWidth, p.ringWidth);
    gl.uniform1f(u.uReach, p.reach);
    color('uRingCol', p.ringCol);
    gl.uniform1f(u.uHue, p.hue);
    gl.uniform1f(u.uGlow, p.glow);
    gl.uniform1f(u.uBulge, p.bulge);
    gl.uniform1f(u.uBreathe, p.breathe);
    gl.uniform1f(u.uGrow, p.grow);
    gl.uniform1f(u.uGrowSpeed, p.growSpeed);
  },
});

// ---------------------------------------------------------------- stage lights
// Coloured spotlights on a rail above the wall sweep their beams across it.
// Each beam lights the picture in its colour and every shape throws a shadow
// from it, using the same slab projection as the Shadows effect.
const LIGHTS_FS = `
uniform int uCount;
uniform vec4 uL[4];       // x, y (uv), beam direction angle, unused
uniform vec3 uLC[4];
uniform float uBeam;
uniform float uHeight;
uniform float uLz;
uniform float uShadow;
uniform float uHaze;
uniform float uAmbient;
uniform float uGain;
float shadowFrom(vec2 uv, vec2 L){
  // nearest caster over the slab, softened once (see Shadows)
  float smax = uHeight / max(uLz - uHeight, 0.05);
  float dmin = 1e3, sHit = 0.0;
  for (int i = 0; i < 20; i++) {
    float s = smax * (float(i) + 0.5) / 20.0;
    vec2 P = (uv + L * s) / (1.0 + s);
    float d = shapeD(P) * (1.0 + s);
    if (d < dmin) { dmin = d; sHit = s; }
  }
  float pen = 0.002 + 0.06 * sHit;
  float sh = (1.0 - smoothstep(-pen, pen, dmin)) * (1.0 - 0.3 * sat(sHit / max(smax, 1e-4)));
  return sh * smoothstep(-0.002, 0.002, shapeD(uv));
}
void main(){
  vec2 uv = vUV;
  vec2 A = vec2(1.0, uAspect);
  vec3 pic = texture(uBg, uv).rgb;
  vec3 light = vec3(uAmbient);
  vec3 haze = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    if (i >= uCount) break;
    vec2 L = uL[i].xy;
    vec2 d = (uv - L) * A;
    float dist = length(d);
    vec2 dir = vec2(sin(uL[i].z), -cos(uL[i].z));      // pointing down from the rail, swung by the angle
    float cosA = dot(normalize(d + 1e-6), dir);
    float cone = smoothstep(cos(uBeam), cos(uBeam * 0.55), cosA);
    float fall = 1.0 / (1.0 + dist * dist * 2.5);
    float sh = uShadow * shadowFrom(uv, L);
    vec3 c = uLC[i] * cone * fall * uGain;
    light += c * (1.0 - sh);
    // the beam itself, hanging in the air, unshadowed
    haze += uLC[i] * cone * fall * 0.35 * (0.6 + 0.4 * fbm(uv * 6.0 + vec2(uTime * 0.3, 0.0), 3));
  }
  vec3 col = pic * light + haze * uHaze;
  o = vec4(mix(pic, col, uOpacity), 1.0);
}`;

export const stagelights = postEffect({
  type: 'stagelights',
  label: 'Stage lights',
  group: 'Shapes',
  hint: 'Coloured spotlights sweep the wall from a rail above; every shape throws a moving shadow from each of them.',
  actions: [],
  params: [
    R('count', 'Lights', 3, 1, 4, 1),
    R('speed', 'Sweep speed', 0.5, 0, 3),
    R('beam', 'Beam width', 22, 5, 70, 1),
    R('swing', 'Swing', 0.5, 0, 1.2),
    R('gain', 'Brightness', 1.6, 0, 5),
    R('ambient', 'Ambient', 0.18, 0, 1),
    R('haze', 'Beam haze', 0.5, 0, 2),
    R('shadow', 'Shadows', 0.9, 0, 1),
    R('height', 'Shape thickness', 0.2, 0.02, 1),
    R('lz', 'Rail distance', 1.4, 0.4, 4),
    C('c1', 'Light 1', '#ff3d6e'), C('c2', 'Light 2', '#31c8ff'), C('c3', 'Light 3', '#ffd24a'), C('c4', 'Light 4', '#9d4dff'),
    R('rail', 'Rail height', -0.15, -0.6, 1.2),
  ],
}, LIGHTS_FS, {
  init() { return { L: new Float32Array(16), C: new Float32Array(12), tmp: [0, 0, 0] }; },
  uniforms(gl, u, p, st, c, color) {
    const n = Math.max(1, Math.round(p.count));
    for (let i = 0; i < 4; i++) {
      const x = n === 1 ? 0.5 : 0.12 + (0.76 * i) / Math.max(1, n - 1);
      st.L[i * 4] = x;
      st.L[i * 4 + 1] = 1 - p.rail;
      st.L[i * 4 + 2] = Math.sin(st.t * p.speed * (0.8 + i * 0.17) + i * 1.9) * p.swing;
      const hex = p['c' + (i + 1)] || '#ffffff';
      const s = hex.slice(1); const v = parseInt(s, 16);
      st.C[i * 3] = ((v >> 16) & 255) / 255; st.C[i * 3 + 1] = ((v >> 8) & 255) / 255; st.C[i * 3 + 2] = (v & 255) / 255;
    }
    gl.uniform1i(u.uCount, n);
    gl.uniform4fv(u.uL, st.L);
    gl.uniform3fv(u.uLC, st.C);
    gl.uniform1f(u.uBeam, (p.beam * Math.PI) / 180);
    gl.uniform1f(u.uHeight, p.height);
    gl.uniform1f(u.uLz, Math.max(p.lz, p.height + 0.1));
    gl.uniform1f(u.uShadow, p.shadow);
    gl.uniform1f(u.uHaze, p.haze);
    gl.uniform1f(u.uAmbient, p.ambient);
    gl.uniform1f(u.uGain, p.gain);
  },
});

// ----------------------------------------------------------------------- neon
const NEON_FS = `
uniform vec3 uTube;
uniform vec3 uTube2;
uniform float uWidth;
uniform float uGlow;
uniform float uDim;
uniform float uChase;
uniform float uFlicker;
uniform float uPicEdges;
uniform float uDouble;
void main(){
  vec2 uv = vUV;
  float d = shapeD(uv);
  vec3 pic = texture(uBg, uv).rgb;
  vec3 col = pic * (1.0 - uDim);
  // a light travelling along the tube, and mains flicker
  float chase = 0.6 + 0.4 * sin((uv.x * 1.8 + uv.y) * 14.0 - uTime * uChase * 4.0);
  float fl = 1.0 - uFlicker * 0.5 * step(0.93, hash11(floor(uTime * 24.0))) * hash11(floor(uTime * 7.0));
  float ad = abs(d);
  float core = exp(-ad * ad / (uWidth * uWidth * 0.25));
  float halo = exp(-ad / (uWidth * 4.0)) * uGlow;
  vec3 tube = mix(uTube, uTube2, sat(uv.y + 0.2 * sin(uTime * 0.4)));
  vec3 neon = tube * (core * 2.5 + halo) * chase * fl;
  // a second inner tube, offset inside the shape
  if (uDouble > 0.0) {
    float d2 = abs(d + uWidth * 5.0);
    neon += tube.gbr * (exp(-d2 * d2 / (uWidth * uWidth * 0.25)) * 2.0 + exp(-d2 / (uWidth * 3.0)) * uGlow * 0.6) * uDouble * chase * fl;
  }
  col += neon;
  col += vec3(1.0) * core * 0.8 * fl;                    // white-hot core
  // the picture's own edges as thin tubes
  if (uPicEdges > 0.0) {
    vec2 e = 1.5 / uSize;
    float l0 = luma(pic);
    float g = abs(luma(picClamp(uv + vec2(e.x, 0.0))) - l0) + abs(luma(picClamp(uv + vec2(0.0, e.y))) - l0);
    col += tube.brg * sat(g * 6.0) * uPicEdges * 1.2 * fl;
  }
  o = vec4(mix(pic, col, uOpacity), 1.0);
}`;

export const neon = postEffect({
  type: 'neon',
  label: 'Neon outlines',
  group: 'Shapes',
  hint: 'Every masked shape is traced by a glowing neon tube, with a light chasing along it and a little mains flicker.',
  actions: [],
  params: [
    C('tube', 'Tube colour', '#ff2fd0'),
    C('tube2', 'Second colour', '#2fd7ff'),
    R('width', 'Tube width', 0.004, 0.001, 0.02, 0.0005),
    R('glow', 'Glow', 1, 0, 3),
    R('dim', 'Dim the picture', 0.6, 0, 1),
    R('chase', 'Chase speed', 0.6, 0, 3),
    R('flicker', 'Flicker', 0.5, 0, 1),
    R('double', 'Inner tube', 0.6, 0, 1),
    R('picEdges', 'Picture edges glow', 0.3, 0, 1),
  ],
}, NEON_FS, {
  uniforms(gl, u, p, st, c, color) {
    color('uTube', p.tube); color('uTube2', p.tube2);
    gl.uniform1f(u.uWidth, p.width);
    gl.uniform1f(u.uGlow, p.glow);
    gl.uniform1f(u.uDim, p.dim);
    gl.uniform1f(u.uChase, p.chase);
    gl.uniform1f(u.uFlicker, p.flicker);
    gl.uniform1f(u.uPicEdges, p.picEdges);
    gl.uniform1f(u.uDouble, p.double);
  },
});


// ----------------------------------------------------------- more auras ----
// Five more effects in the spirit of Aura: all read the shapes' distance field
// and paint something that hugs, radiates from, or grows out of the outlines.

const GLSL_HSV = `
vec3 hsv(float h, float s, float v){
  vec3 k = abs(fract(vec3(h) + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0;
  return v * mix(vec3(1.0), sat(k), s);
}`;

// ------------------------------------------------------------------ fieldlines
const FIELD_FS = GLSL_HSV + `
uniform float uCount;
uniform float uSharp;
uniform float uTwist;
uniform float uSpin;
uniform float uReach;
uniform float uWaves;
uniform float uSpeed;
uniform vec3 uCol;
uniform float uRainbow;
uniform float uDim;
uniform float uSwirl;
void main(){
  vec2 uv = vUV;
  float d = shapeD(uv);
  vec2 n = shapeN(uv);
  float t = uTime;
  vec3 bg = texture(uBg, uv).rgb;
  float fall = exp(-max(d, 0.0) / uReach) * step(0.0, d);
  // the picture is swept around the shapes along the contour direction
  vec2 tang = vec2(-n.y, n.x);
  vec3 col = texture(uBg, clamp(uv + tang * uSwirl * 0.04 * fall * sin(t * 0.7 + d * 20.0), 0.0, 1.0)).rgb;
  col *= 1.0 - uDim * fall;
  // lines along the gradient: constant angle of the normal gives a spoke,
  // twisted as it travels out
  float ang = atan(n.y, n.x);
  float spoke = pow(0.5 + 0.5 * sin(ang * uCount + d * uTwist * 40.0 + t * uSpin), uSharp);
  // pulses running out along the spokes
  float pulse = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(d * uWaves - t * uSpeed), 3.0);
  vec3 c = mix(uCol, hsv(fract(ang / TAU + t * 0.05), 0.85, 1.0), uRainbow);
  col += c * spoke * pulse * fall * 2.2;
  col += c * exp(-max(d, 0.0) * 60.0) * 0.5;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const fieldlines = postEffect({
  type: 'fieldlines',
  label: 'Field lines',
  group: 'Shapes',
  hint: 'Lines of force radiate from every shape like a magnetic field, with pulses of light running out along them.',
  actions: [],
  params: [
    R('count', 'Lines', 28, 4, 120, 1),
    R('sharp', 'Line sharpness', 8, 1, 40, 0.5),
    R('twist', 'Twist', 0.4, -2, 2, 0.05),
    R('spin', 'Rotation', 0.4, -3, 3, 0.05),
    R('reach', 'Reach', 0.28, 0.03, 1),
    R('waves', 'Pulse density', 40, 0, 200, 1),
    R('speed', 'Pulse speed', 3, -8, 8, 0.1),
    C('col', 'Colour', '#7cf3ff'),
    R('rainbow', 'Rainbow', 0, 0, 1),
    R('dim', 'Dim the picture', 0.4, 0, 1),
    R('swirl', 'Swirl the picture', 0.5, 0, 2),
  ],
}, FIELD_FS, {
  uniforms(gl, u, p, st, c, color) {
    gl.uniform1f(u.uCount, Math.round(p.count));
    gl.uniform1f(u.uSharp, p.sharp);
    gl.uniform1f(u.uTwist, p.twist);
    gl.uniform1f(u.uSpin, p.spin);
    gl.uniform1f(u.uReach, p.reach);
    gl.uniform1f(u.uWaves, p.waves);
    gl.uniform1f(u.uSpeed, p.speed);
    color('uCol', p.col);
    gl.uniform1f(u.uRainbow, p.rainbow);
    gl.uniform1f(u.uDim, p.dim);
    gl.uniform1f(u.uSwirl, p.swirl);
  },
});

// ------------------------------------------------------------------- shockwave
// A ring leaves every shape at once and runs across the wall, bending and
// splitting the picture as it passes. Fire it by hand, on a timer, or on the beat.
const PULSE_FS = `
uniform float uR[6];
uniform int uN;
uniform float uWidth;
uniform float uAmp;
uniform float uSplit;
uniform vec3 uCol;
uniform float uGlow;
uniform float uFade;
void main(){
  vec2 uv = vUV;
  float d = shapeD(uv);
  vec2 n = shapeN(uv);
  vec3 bg = texture(uBg, uv).rgb;
  float wave = 0.0, front = 0.0, tail = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= uN) break;
    float r = uR[i];
    float life = exp(-r * uFade);
    float x = (d - r) / uWidth;
    // a crest with a trough behind it, like a ripple in profile
    float w = exp(-x * x) * life;
    wave += w * (1.0 - 0.6 * smoothstep(0.0, -1.2, x));
    front += w * smoothstep(-0.2, 0.6, x);
    tail += exp(-abs(x + 1.5) * 1.5) * life * 0.5;
  }
  wave *= step(0.0, d);
  vec2 off = n * wave * uAmp * 0.08 / vec2(1.0, uAspect);
  vec3 col;
  col.r = texture(uBg, clamp(uv + off * (1.0 + uSplit), 0.0, 1.0)).r;
  col.g = texture(uBg, clamp(uv + off, 0.0, 1.0)).g;
  col.b = texture(uBg, clamp(uv + off * (1.0 - uSplit), 0.0, 1.0)).b;
  // the crest catches the light, the trough behind it falls into shade
  col *= 1.0 - 0.45 * sat(tail) * step(0.0, d);
  col += uCol * (front * uGlow * 1.6 + tail * uGlow * 0.2) * step(0.0, d);
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const shockwave = postEffect({
  type: 'shockwave',
  label: 'Shockwave',
  group: 'Shapes',
  hint: 'A ring bursts out of every shape and runs across the wall, bending and splitting the picture as it passes. Fire it on the beat.',
  actions: [{ name: 'pulse', label: 'Pulse' }],
  params: [
    R('every', 'Every (s)', 2.5, 0, 12, 0.1),
    R('speed', 'Speed', 0.25, 0.02, 2),
    R('width', 'Ring width', 0.035, 0.005, 0.3, 0.005),
    R('amp', 'Bend the picture', 1, 0, 3),
    R('split', 'Colour split', 0.4, 0, 1.5),
    C('col', 'Rim colour', '#8fe3ff'),
    R('glow', 'Rim glow', 0.8, 0, 3),
    R('fade', 'Fade with distance', 1.2, 0, 6),
  ],
}, PULSE_FS, {
  init() { return { waves: [], acc: 0, R: new Float32Array(6) }; },
  step(st, dt, w, p) {
    for (const wv of st.waves) wv.r += dt * p.speed;
    st.waves = st.waves.filter((wv) => wv.r < 1.5);
    if (p.every > 0) { st.acc += dt; if (st.acc >= p.every) { st.acc = 0; st.waves.push({ r: 0 }); } }
  },
  action(st, name) { if (name === 'pulse') { st.waves.push({ r: 0 }); if (st.waves.length > 6) st.waves.shift(); } },
  uniforms(gl, u, p, st, c, color) {
    const n = Math.min(6, st.waves.length);
    for (let i = 0; i < 6; i++) st.R[i] = i < n ? st.waves[st.waves.length - n + i].r : 0;
    gl.uniform1fv(u.uR, st.R);
    gl.uniform1i(u.uN, n);
    gl.uniform1f(u.uWidth, p.width);
    gl.uniform1f(u.uAmp, p.amp);
    gl.uniform1f(u.uSplit, p.split);
    color('uCol', p.col);
    gl.uniform1f(u.uGlow, p.glow);
    gl.uniform1f(u.uFade, p.fade);
  },
});

// -------------------------------------------------------------------- glassrim
// Every shape is set into the wall behind a thick bevelled pane of glass: the
// picture refracts through the bevel, the outer edge catches the light.
const GLASS_FS = `
uniform float uWidth;
uniform float uRefract;
uniform float uSplit;
uniform vec3 uTint;
uniform float uTintAmt;
uniform float uHighlight;
uniform float uFrost;
uniform float uCaustic;
uniform vec2 uLight;
void main(){
  vec2 uv = vUV;
  float d = shapeD(uv);
  vec3 bg = texture(uBg, uv).rgb;
  if (d <= 0.0 || d > uWidth) { o = vec4(bg, 1.0); return; }
  vec2 n = shapeN(uv);
  float t = d / uWidth;                    // 0 at the shape, 1 at the outer edge
  // a quarter-round bevel: steep against the shape, flat at the outer rim
  float h = sqrt(max(0.0, 1.0 - (1.0 - t) * (1.0 - t)));
  float slope = (1.0 - t) / max(h, 0.05);
  vec2 off = n * slope * uRefract * 0.04 / vec2(1.0, uAspect);
  // frosted glass blurs by scattering the lookup
  vec2 jit = (hash22(uv * uSize) - 0.5) * uFrost * 0.02;
  vec3 col;
  col.r = texture(uBg, clamp(uv + off * (1.0 + uSplit) + jit, 0.0, 1.0)).r;
  col.g = texture(uBg, clamp(uv + off + jit, 0.0, 1.0)).g;
  col.b = texture(uBg, clamp(uv + off * (1.0 - uSplit) + jit, 0.0, 1.0)).b;
  col = mix(col, col * uTint, uTintAmt);
  // lighting on the bevel: a broad highlight where the surface faces the light
  vec3 N = normalize(vec3(n * slope, 1.0));
  vec3 L = normalize(vec3(uLight, 0.8));
  float spec = pow(max(dot(N, L), 0.0), 40.0) * uHighlight;
  col += vec3(spec);
  // a bright caustic line where the glass meets the wall, and the rim itself
  col += uTint * uCaustic * exp(-t * 12.0) * 0.7;
  col += vec3(0.6) * uHighlight * smoothstep(0.9, 1.0, t) * (0.5 + 0.5 * max(dot(n, uLight), 0.0));
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const glassrim = postEffect({
  type: 'glassrim',
  label: 'Glass rim',
  group: 'Shapes',
  hint: 'A thick bevelled pane of glass around every shape: the picture refracts through the bevel and the edge catches the light.',
  actions: [],
  params: [
    R('width', 'Rim width', 0.08, 0.01, 0.4, 0.005),
    R('refract', 'Refraction', 1, 0, 3),
    R('split', 'Colour split', 0.15, 0, 1),
    C('tint', 'Glass tint', '#a8e6ff'),
    R('tintAmt', 'Tint amount', 0.35, 0, 1),
    R('highlight', 'Highlight', 0.8, 0, 2),
    R('frost', 'Frosted', 0, 0, 1),
    R('caustic', 'Caustic line', 0.6, 0, 2),
    R('lightAngle', 'Light angle', 230, 0, 360, 1),
  ],
}, GLASS_FS, {
  uniforms(gl, u, p, st, c, color) {
    gl.uniform1f(u.uWidth, p.width);
    gl.uniform1f(u.uRefract, p.refract);
    gl.uniform1f(u.uSplit, p.split);
    color('uTint', p.tint);
    gl.uniform1f(u.uTintAmt, p.tintAmt);
    gl.uniform1f(u.uHighlight, p.highlight);
    gl.uniform1f(u.uFrost, p.frost);
    gl.uniform1f(u.uCaustic, p.caustic);
    const a = (p.lightAngle * Math.PI) / 180;
    gl.uniform2f(u.uLight, Math.cos(a), Math.sin(a));
  },
});

// ---------------------------------------------------------------------- plasma
// Electric tendrils crawl along every outline: noise threaded along the
// contour, flickering, with a hot core and a coloured halo.
const PLASMA_FS = `
uniform float uReach;
uniform float uDensity;
uniform float uSpeed;
uniform float uFlicker;
uniform vec3 uCore;
uniform vec3 uHalo;
uniform float uHaloAmt;
uniform float uDim;
uniform float uArcs;
void main(){
  vec2 uv = vUV;
  float d = shapeD(uv);
  vec2 n = shapeN(uv);
  float t = uTime * uSpeed;
  vec3 bg = texture(uBg, uv).rgb;
  float fall = exp(-max(d, 0.0) / uReach) * step(0.0, d);
  vec3 col = bg * (1.0 - uDim * fall);
  // coordinates that run along the contour (angle) and out from it (d)
  float ang = atan(n.y, n.x);
  vec2 q = vec2(ang * uDensity * 0.8 + t * 0.6, d * 25.0 - t * 1.7);
  float f = fbm(q + fbm(q * 1.7 + t * 0.3, 3) * 1.5, 4);
  // tendrils: where the noise crosses the distance, an arc lives
  float arcPos = uReach * (0.15 + 0.85 * f);
  float dist = abs(d - arcPos);
  float arc = exp(-dist * dist * 9000.0 / (uReach * uReach + 1e-4));
  float haze = exp(-dist * 60.0 / (uReach * 30.0 + 1.0)) * 0.6;
  float fl = 1.0 - uFlicker * 0.6 * hash11(floor(uTime * 30.0) + floor(ang * 4.0));
  float halo = pow(fall, 1.5) * (0.25 + 0.75 * f);
  col += uHalo * halo * uHaloAmt * fl;
  col += mix(uHalo, uCore, arc) * (arc * 2.5 + haze) * uArcs * fl;
  col += uCore * exp(-max(d, 0.0) * 80.0) * 0.8 * fl;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const plasma = postEffect({
  type: 'plasma',
  label: 'Plasma edge',
  group: 'Shapes',
  hint: 'Electric tendrils crawl along every outline and reach out across the wall, flickering like a plasma globe.',
  actions: [],
  params: [
    R('reach', 'Reach', 0.16, 0.02, 0.8),
    R('density', 'Tendril density', 3, 0.5, 12, 0.1),
    R('speed', 'Speed', 1, 0, 4),
    R('flicker', 'Flicker', 0.5, 0, 1),
    C('core', 'Core', '#ffffff'),
    C('halo', 'Halo', '#8a5cff'),
    R('haloAmt', 'Halo', 0.3, 0, 3),
    R('arcs', 'Arcs', 1, 0, 3),
    R('dim', 'Dim the picture', 0.35, 0, 1),
  ],
}, PLASMA_FS, {
  uniforms(gl, u, p, st, c, color) {
    gl.uniform1f(u.uReach, p.reach);
    gl.uniform1f(u.uDensity, p.density);
    gl.uniform1f(u.uSpeed, p.speed);
    gl.uniform1f(u.uFlicker, p.flicker);
    color('uCore', p.core); color('uHalo', p.halo);
    gl.uniform1f(u.uHaloAmt, p.haloAmt);
    gl.uniform1f(u.uArcs, p.arcs);
    gl.uniform1f(u.uDim, p.dim);
  },
});

// ----------------------------------------------------------------------- frost
// Ice creeps out of every shape, feathered crystals growing along the normal,
// whitens and blurs the picture underneath, then melts back and starts again.
const FROST_FS = `
uniform float uReach;
uniform float uPhase;      // 0..1 growth of the current cycle
uniform float uMelt;       // 0..1 melting back
uniform float uScale;
uniform vec3 uTint;
uniform float uWhite;
uniform float uSparkle;
uniform float uBlur;
uniform float uFeather;
void main(){
  vec2 uv = vUV;
  float d = shapeD(uv);
  vec2 n = shapeN(uv);
  vec3 bg = texture(uBg, uv).rgb;
  if (d <= 0.0) { o = vec4(bg, 1.0); return; }
  float ang = atan(n.y, n.x);
  // crystal texture: fine noise stretched along the growth direction
  vec2 q = vec2(ang * 30.0, d * uScale * 60.0);
  float crystal = fbm(q, 4);
  float feathers = pow(0.5 + 0.5 * sin(ang * 90.0 + crystal * 8.0 + d * 30.0), 3.0) * uFeather;
  // the front: jagged, and it advances then retreats
  float extent = uReach * uPhase * (0.75 + 0.5 * crystal) * (1.0 - uMelt * 0.9);
  float front = extent - d;
  float ice = smoothstep(0.0, 0.006 + 0.03 * uReach, front);
  if (ice <= 0.001) { o = vec4(bg, 1.0); return; }
  // frosted glass: scatter the lookup, whiten, tint cold
  vec2 jit = (hash22(uv * uSize * 0.5) - 0.5) * uBlur * 0.03 * ice;
  vec3 col = texture(uBg, clamp(uv + jit + n * crystal * 0.01, 0.0, 1.0)).rgb;
  float thick = sat(front / max(extent, 1e-3));      // older ice is thicker
  col = mix(col, uTint * (0.75 + 0.35 * crystal), uWhite * (0.35 + 0.65 * thick) * ice);
  col += uTint * feathers * 0.35 * ice;
  // a bright rim where the ice is freshest
  col += vec3(1.0) * exp(-front * 120.0) * 0.5 * ice * (1.0 - uMelt);
  // sparkle
  float sp = hash12(floor(uv * uSize * 0.7)) ;
  col += vec3(1.0) * step(0.985, sp) * uSparkle * ice * (0.5 + 0.5 * sin(uTime * 6.0 + sp * 60.0));
  // meltwater glistens along the retreating edge
  col += uTint * uMelt * exp(-abs(front) * 60.0) * 0.6;
  o = vec4(mix(bg, col, uOpacity * ice), 1.0);
}`;

export const frost = postEffect({
  type: 'frost',
  label: 'Frost',
  group: 'Shapes',
  hint: 'Ice creeps out of every shape in feathered crystals, frosts the picture over, then melts back and grows again.',
  actions: [{ name: 'freeze', label: 'Freeze now' }, { name: 'melt', label: 'Melt' }],
  params: [
    R('reach', 'Reach', 0.3, 0.03, 1),
    R('grow', 'Growth time (s)', 12, 1, 60, 0.5),
    R('hold', 'Hold (s)', 6, 0, 60, 0.5),
    R('melt', 'Melt time (s)', 4, 0.5, 30, 0.5),
    R('scale', 'Crystal size', 1, 0.2, 4),
    C('tint', 'Ice colour', '#dff4ff'),
    R('white', 'Frosting', 0.8, 0, 1),
    R('blur', 'Blur', 0.6, 0, 2),
    R('feather', 'Feathering', 0.6, 0, 2),
    R('sparkle', 'Sparkle', 0.6, 0, 2),
    B('cycle', 'Melt and regrow', true),
  ],
}, FROST_FS, {
  init() { return { t: 0, phase: 0, melt: 0, mode: 'grow' }; },
  step(st, dt, w, p) {
    if (st.mode === 'grow') { st.phase = Math.min(1, st.phase + dt / p.grow); st.melt = 0; if (st.phase >= 1) { st.mode = 'hold'; st.t = 0; } }
    else if (st.mode === 'hold') { st.t += dt; if (p.cycle && st.t >= p.hold) st.mode = 'melt'; }
    else { st.melt = Math.min(1, st.melt + dt / p.melt); if (st.melt >= 1) { st.mode = 'grow'; st.phase = 0; st.melt = 0; } }
  },
  action(st, name) {
    if (name === 'freeze') { st.mode = 'grow'; st.phase = Math.max(st.phase, 0.05); st.melt = 0; }
    if (name === 'melt') { st.mode = 'melt'; }
  },
  uniforms(gl, u, p, st, c, color) {
    gl.uniform1f(u.uReach, p.reach);
    gl.uniform1f(u.uPhase, st.phase);
    gl.uniform1f(u.uMelt, st.melt);
    gl.uniform1f(u.uScale, p.scale);
    color('uTint', p.tint);
    gl.uniform1f(u.uWhite, p.white);
    gl.uniform1f(u.uSparkle, p.sparkle);
    gl.uniform1f(u.uBlur, p.blur);
    gl.uniform1f(u.uFeather, p.feather);
  },
});

// ---------------------------------------------------------------- contour map
// The wall as a height map with the shapes as its peaks: bands of colour by
// distance, contour lines between them, all drifting outwards.
const CONTOUR_FS = GLSL_HSV + `
uniform float uBands;
uniform float uSpeed;
uniform float uAmount;
uniform float uLines;
uniform float uHueSpan;
uniform float uHue0;
uniform float uReach;
uniform float uSat;
uniform float uPicture;
void main(){
  vec2 uv = vUV;
  float d = shapeD(uv);
  vec3 bg = texture(uBg, uv).rgb;
  float dd = max(d, 0.0);
  float band = dd * uBands - uTime * uSpeed;
  float k = floor(band);
  float fr = fract(band);
  float fall = uReach > 0.0 ? exp(-dd / uReach) : 1.0;
  vec3 c = hsv(fract(uHue0 + k * uHueSpan / uBands * 0.5), uSat, 0.9);
  // the picture shows through as the height map's shading
  float shade = mix(1.0, 0.5 + luma(bg), uPicture);
  vec3 col = c * shade;
  // a dark contour line at each band edge, thinner further out
  float line = smoothstep(0.0, 0.12, fr) * smoothstep(1.0, 0.88, fr);
  col *= mix(1.0, line, uLines);
  col = mix(bg, col, uAmount * fall * step(0.0, d));
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const contour = postEffect({
  type: 'contour',
  label: 'Contour map',
  group: 'Shapes',
  hint: 'The wall becomes a map with your shapes as the peaks: bands of colour by distance, contour lines between them, drifting outwards.',
  actions: [],
  params: [
    R('bands', 'Bands', 14, 2, 80, 1),
    R('speed', 'Drift', 0.6, -4, 4, 0.05),
    R('amount', 'Amount', 0.8, 0, 1),
    R('lines', 'Contour lines', 0.8, 0, 1),
    R('hue0', 'Start hue', 0.55, 0, 1),
    R('hueSpan', 'Hue span', 0.6, -2, 2, 0.05),
    R('sat', 'Saturation', 0.7, 0, 1),
    R('reach', 'Reach (0 = whole wall)', 0, 0, 1),
    R('picture', 'Picture shading', 0.7, 0, 1),
  ],
}, CONTOUR_FS, {
  uniforms(gl, u, p) {
    gl.uniform1f(u.uBands, Math.round(p.bands));
    gl.uniform1f(u.uSpeed, p.speed);
    gl.uniform1f(u.uAmount, p.amount);
    gl.uniform1f(u.uLines, p.lines);
    gl.uniform1f(u.uHue0, p.hue0);
    gl.uniform1f(u.uHueSpan, p.hueSpan);
    gl.uniform1f(u.uSat, p.sat);
    gl.uniform1f(u.uReach, p.reach);
    gl.uniform1f(u.uPicture, p.picture);
  },
});
