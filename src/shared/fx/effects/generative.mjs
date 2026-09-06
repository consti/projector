// Generative: the picture run through the kind of systems that drive Max
// Cooper's videos — reaction-diffusion and cellular automata (Order From Chaos,
// Origins, Emergence), circle symmetry operations (Symmetry), duplicated built
// form receding forever (Repetition), the infinite zoom (Aleph 2), crowds as
// geometry, transcendental digits and aperiodic tilings (Perpetual Motion),
// dividing cellular forms, wave interference, weaving, tree maps. Most are one
// full-screen shader over the picture; the automata carry a small state texture
// that is stepped inside draw(), where the picture is available to seed it.

import { prog, bindTex, VS_SCREEN, PingPong, hexRgb } from '../glu.mjs';
import { R, B, C, S } from './common.mjs';
import { postEffect, GLSL_POST } from './post.mjs';

const GLSL_HSV = `
vec3 hsv(float h, float s, float v){
  vec3 k = abs(fract(vec3(h) + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0;
  return v * mix(vec3(1.0), sat(k), s);
}`;

const FS_HEAD = `#version 300 es
precision highp float;
#include <common>
#include <hash>
#include <noise>
in vec2 vUV;
out vec4 o;
`;

// ------------------------------------------------------------ automata ----
/**
 * A cellular automaton / reaction-diffusion effect: an RGBA16F state texture
 * at a fraction of the output resolution, a step shader that reads the state
 * and the picture, and a draw shader that paints state + picture. `hooks.n`
 * gives the substeps per frame; `hooks.reset(st, p)` decides when to reseed.
 */
function caEffect(spec, stepFs, drawFs, hooks) {
  return {
    ...spec,
    blend: 'post',
    create(ctx) {
      const gl = ctx.gl;
      const prStep = prog(gl, VS_SCREEN, FS_HEAD + GLSL_POST + `uniform sampler2D uState; uniform vec2 uTexel; uniform float uSeed; uniform int uInit; uniform vec4 uP; uniform vec4 uQ;\n` + stepFs);
      const prDraw = prog(gl, VS_SCREEN, FS_HEAD + GLSL_POST + GLSL_HSV + `uniform sampler2D uState; uniform vec2 uTexel; uniform vec4 uP; uniform vec4 uQ; uniform vec3 uC1; uniform vec3 uC2;\n` + drawFs);
      const st = { t: 0, acc: 0, state: null, W: 0, H: 0, init: true, frame: 0, rng: ctx.rng, c1: [0, 0, 0], c2: [0, 0, 0] };
      const ensure = (W, H, p) => {
        const scale = typeof hooks.scale === 'function' ? hooks.scale(p) : (hooks.scale || 0.5);
        const w = Math.max(32, Math.round(W * scale)), h = Math.max(32, Math.round(H * scale));
        if (st.state && st.W === w && st.H === h) return;
        if (st.state) st.state.dispose();
        st.state = new PingPong(gl, w, h, 'rgba16f', { nearest: !!hooks.nearest });
        st.W = w; st.H = h; st.init = true;
      };
      const setCommon = (pr, c, p) => {
        gl.uniform2f(pr.u.uTexel, 1 / st.W, 1 / st.H);
        gl.uniform1f(pr.u.uTime, st.t);
        gl.uniform1f(pr.u.uAspect, c.aspect);
        gl.uniform1f(pr.u.uOpacity, c.opacity);
        gl.uniform2f(pr.u.uSize, c.size[0], c.size[1]);
        gl.uniform2f(pr.u.uCentre, 0.5, 0.5);
        gl.uniform2f(pr.u.uSdfTexel, c.sdfTexel[0], c.sdfTexel[1]);
        const P = hooks.uP ? hooks.uP(p, st) : [0, 0, 0, 0];
        const Q = hooks.uQ ? hooks.uQ(p, st) : [0, 0, 0, 0];
        gl.uniform4f(pr.u.uP, P[0], P[1], P[2], P[3]);
        gl.uniform4f(pr.u.uQ, Q[0], Q[1], Q[2], Q[3]);
      };
      return {
        st,
        resize() {},
        step(dt, w, p) { st.t += dt; st.acc += dt; hooks.step?.(st, dt, w, p); },
        action(name, arg, w, p) { if (name === 'reset') st.init = true; hooks.action?.(st, name, arg, w, p); },
        draw(c) {
          const p = c.params;
          ensure(c.size[0], c.size[1], p);
          if (hooks.reset && hooks.reset(st, p)) st.init = true;
          const n = st.init ? 1 : Math.max(0, Math.min(6, Math.round((hooks.n ? hooks.n(p) : 1) * Math.min(1, st.acc * 60))));
          st.acc = 0;
          gl.disable(gl.BLEND);
          for (let i = 0; i < Math.max(n, st.init ? 1 : 0); i++) {
            prStep.use();
            bindTex(gl, 0, st.state.read.tex, prStep.u.uState);
            bindTex(gl, 1, c.src, prStep.u.uBg);
            bindTex(gl, 2, c.sdfTex, prStep.u.uSdf);
            setCommon(prStep, c, p);
            gl.uniform1f(prStep.u.uSeed, (st.frame++ % 1000) * 0.618);
            gl.uniform1i(prStep.u.uInit, st.init ? 1 : 0);
            st.state.write.bind();
            ctx.screen.draw();
            st.state.swap();
            st.init = false;
          }
          c.dst.bind();
          prDraw.use();
          bindTex(gl, 0, st.state.read.tex, prDraw.u.uState);
          bindTex(gl, 1, c.src, prDraw.u.uBg);
          bindTex(gl, 2, c.sdfTex, prDraw.u.uSdf);
          setCommon(prDraw, c, p);
          if (hooks.colours) {
            const [a, b] = hooks.colours(p);
            hexRgb(a, st.c1); hexRgb(b, st.c2);
            gl.uniform3f(prDraw.u.uC1, st.c1[0], st.c1[1], st.c1[2]);
            gl.uniform3f(prDraw.u.uC2, st.c2[0], st.c2[1], st.c2[2]);
          }
          ctx.screen.draw();
        },
        dispose() { if (st.state) st.state.dispose(); },
      };
    },
  };
}

// ----------------------------------------------------- reaction diffusion --
// Gray–Scott. The picture feeds the system: bright areas add the catalyst, so
// the patterns grow out of the film's own highlights. (Order From Chaos, Origins)
export const reaction = caEffect({
  type: 'reaction',
  label: 'Reaction diffusion',
  group: 'Generative',
  hint: 'Gray–Scott reaction-diffusion seeded by the picture’s highlights: spots, worms and coral grow over the film and eat into it.',
  actions: [{ name: 'reset', label: 'Reseed' }],
  params: [
    S('kind', 'Pattern', 'coral', [['coral', 'Coral'], ['spots', 'Spots'], ['worms', 'Worms'], ['waves', 'Waves'], ['mitosis', 'Mitosis']]),
    R('speed', 'Speed', 1, 0.1, 3),
    R('feed', 'Picture feeds it', 0.5, 0, 1),
    R('scale', 'Scale', 1, 0.5, 2),
    S('look', 'Look', 'tint', [['tint', 'Tinted membrane'], ['picture', 'The picture through it'], ['emboss', 'Embossed']]),
    C('col', 'Colour', '#ffb347'),
    C('col2', 'Second colour', '#2a0f5e'),
    R('mix', 'Mix', 0.8, 0, 1),
  ],
}, `
// state: r = U, g = V
void main(){
  vec2 uv = vUV;
  if (uInit == 1) {
    float l = luma(texture(uBg, uv).rgb);
    // a sprinkling of seeds in the highlights
    float seed = step(0.55, l) * step(0.97, hash12(gl_FragCoord.xy + uSeed));
    o = vec4(1.0, seed, 0.0, 1.0); return;
  }
  vec2 e = uTexel * uP.z;
  vec4 c = texture(uState, uv);
  // the usual 9-point Laplacian: 0.2 on the sides, 0.05 on the corners, -1 in the middle
  vec4 lap = 0.2 * (texture(uState, uv + vec2(e.x, 0.0)) + texture(uState, uv - vec2(e.x, 0.0))
           + texture(uState, uv + vec2(0.0, e.y)) + texture(uState, uv - vec2(0.0, e.y)))
           + 0.05 * (texture(uState, uv + e) + texture(uState, uv - e) + texture(uState, uv + vec2(e.x, -e.y)) + texture(uState, uv - vec2(e.x, -e.y)))
           - c;
  float f = uP.x, k = uP.y;
  float U = c.r, V = c.g;
  float uvv = U * V * V;
  float l = luma(texture(uBg, uv).rgb);
  float dU = 1.0 * lap.r - uvv + f * (1.0 - U);
  float dV = 0.5 * lap.g + uvv - (f + k) * V + uQ.x * 0.004 * smoothstep(0.6, 0.95, l) * (1.0 - V) * step(hash12(gl_FragCoord.xy + uSeed), 0.3);
  if (shapeD(uv) < 0.0) { U = 1.0; V = 0.0; dU = 0.0; dV = 0.0; }
  o = vec4(sat(U + dU * 1.0), sat(V + dV * 1.0), 0.0, 1.0);
}`, `
void main(){
  vec2 uv = vUV;
  vec2 s = texture(uState, uv).rg;
  vec3 pic = texture(uBg, uv).rgb;
  float V = sat(s.g * 2.2);
  float edge = smoothstep(0.15, 0.35, V) * (1.0 - smoothstep(0.55, 0.9, V));
  vec3 col;
  if (uQ.y < 0.5) {
    col = mix(pic, mix(uC2, uC1, V), V * 0.95);
    col += uC1 * edge * 0.4;
  } else if (uQ.y < 1.5) {
    vec2 e = uTexel;
    vec2 g = vec2(texture(uState, uv + vec2(e.x, 0.0)).g - texture(uState, uv - vec2(e.x, 0.0)).g,
                  texture(uState, uv + vec2(0.0, e.y)).g - texture(uState, uv - vec2(0.0, e.y)).g);
    col = texture(uBg, uv + g * 0.08).rgb * (1.0 - 0.5 * V) + edge * 0.6;
  } else {
    vec2 e = uTexel;
    float hl = texture(uState, uv + vec2(-e.x, e.y)).g - texture(uState, uv + vec2(e.x, -e.y)).g;
    col = pic * (0.7 + 0.6 * V) + hl * 2.5 + edge * uC1 * 0.3;
  }
  o = vec4(mix(pic, col, uOpacity * uP.w), 1.0);
}`, {
  scale: 0.5,
  n: (p) => Math.round(4 * p.speed),
  uP: (p) => {
    const K = { coral: [0.0545, 0.062], spots: [0.03, 0.062], worms: [0.078, 0.061], waves: [0.014, 0.045], mitosis: [0.0367, 0.0649] }[p.kind] || [0.0545, 0.062];
    return [K[0], K[1], p.scale, p.mix];
  },
  uQ: (p) => [p.feed, p.look === 'tint' ? 0 : p.look === 'picture' ? 1 : 2, 0, 0],
  colours: (p) => [p.col, p.col2],
  reset: (st, p) => { const k = p.kind; if (st.kind !== k) { st.kind = k; return true; } return false; },
});

// ------------------------------------------------------------------ life --
// Conway's Life seeded from the picture's edges, with fading trails. (Emergence)
export const life = caEffect({
  type: 'life',
  label: 'Game of Life',
  group: 'Generative',
  hint: 'Conway’s Life running over the picture, seeded from its edges and re-fed by movement, with glowing trails where cells lived.',
  actions: [{ name: 'reset', label: 'Reseed' }],
  params: [
    R('speed', 'Generations / s', 12, 1, 60, 1),
    R('cell', 'Cell size (px)', 6, 2, 24, 1),
    R('feed', 'Movement seeds cells', 0.5, 0, 1),
    R('trail', 'Trail', 0.9, 0.5, 0.995, 0.005),
    C('col', 'Live cell', '#e8fff2'),
    C('col2', 'Trail colour', '#1f8f6a'),
    R('dim', 'Dim the picture', 0.5, 0, 1),
  ],
}, `
// state: r = alive, g = trail, b = last luma
void main(){
  vec2 uv = vUV;
  float l = luma(texture(uBg, uv).rgb);
  if (uInit == 1) {
    vec2 e = uTexel;
    float g = abs(luma(texture(uBg, uv + vec2(e.x, 0.0)).rgb) - l) + abs(luma(texture(uBg, uv + vec2(0.0, e.y)).rgb) - l);
    float alive = step(0.6, hash12(gl_FragCoord.xy + uSeed)) * step(0.15, g);
    o = vec4(alive, alive, l, 1.0); return;
  }
  vec4 c = texture(uState, uv);
  int n = 0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    if (i == 0 && j == 0) continue;
    n += texture(uState, uv + vec2(float(i), float(j)) * uTexel).r > 0.5 ? 1 : 0;
  }
  float alive = c.r > 0.5 ? ((n == 2 || n == 3) ? 1.0 : 0.0) : (n == 3 ? 1.0 : 0.0);
  // the film moving underneath seeds new cells
  float moved = abs(l - c.b);
  if (moved > 0.35 && hash12(gl_FragCoord.xy * 1.3 + uSeed) < uP.x * 0.12) alive = 1.0;
  if (shapeD(uv) < 0.0) alive = 0.0;
  float trail = max(alive, c.g * uP.y);
  o = vec4(alive, trail, mix(c.b, l, 0.3), 1.0);
}`, `
void main(){
  vec2 uv = vUV;
  vec3 pic = texture(uBg, uv).rgb;
  vec4 s = texture(uState, uv);
  vec3 col = pic * (1.0 - uP.z);
  col += uC2 * s.g * s.g * 0.9;
  col += uC1 * s.r * 1.2;
  o = vec4(mix(pic, col, uOpacity), 1.0);
}`, {
  scale: (p) => 1 / Math.max(1, p.cell), nearest: true,
  n: (p) => p.speed / 60,
  uP: (p) => [p.feed, p.trail, p.dim, 0],
  colours: (p) => [p.col, p.col2],
});

// ------------------------------------------------------------- rule 110 ----
// An elementary cellular automaton scrolling down the wall, its seed row read
// off the top of the picture every frame. (Chromos / Rule 110)
export const rule = caEffect({
  type: 'rule',
  label: 'Rule 110',
  group: 'Generative',
  hint: 'An elementary cellular automaton pours down the wall from a seed row read off the top of the picture: rule 110, 30, 90 or 184.',
  actions: [{ name: 'reset', label: 'Restart' }],
  params: [
    S('rule', 'Rule', '110', [['110', '110 (Turing complete)'], ['30', '30 (chaotic)'], ['90', '90 (Sierpinski)'], ['184', '184 (traffic)'], ['150', '150'], ['54', '54']]),
    R('speed', 'Rows / s', 60, 5, 240, 1),
    R('cell', 'Cell size (px)', 5, 2, 20, 1),
    C('col', 'On', '#ffffff'),
    C('col2', 'Off', '#101018'),
    R('picture', 'Picture through the cells', 0.6, 0, 1),
    R('dim', 'Dim the picture', 0.7, 0, 1),
  ],
}, `
int bitOf(float r, int idx){ return (int(r) >> idx) & 1; }
void main(){
  vec2 uv = vUV;
  vec2 e = uTexel;
  // the top row is the seed: thresholded picture luminance
  if (uInit == 1 || uv.y > 1.0 - e.y) {
    float l = luma(texture(uBg, vec2(uv.x, 0.995)).rgb);
    float v = step(0.5, l);
    if (hash12(gl_FragCoord.xy + uSeed) > 0.995) v = 1.0 - v;      // a rare flip keeps a flat row alive
    o = vec4(v, 0.0, 0.0, 1.0); return;
  }
  // everything else moves down one row per step and applies the rule
  vec2 up = uv + vec2(0.0, e.y);
  int a = texture(uState, up - vec2(e.x, 0.0)).r > 0.5 ? 1 : 0;
  int b = texture(uState, up).r > 0.5 ? 1 : 0;
  int c = texture(uState, up + vec2(e.x, 0.0)).r > 0.5 ? 1 : 0;
  int idx = a * 4 + b * 2 + c;
  float v = float(bitOf(uP.x, idx));
  o = vec4(v, 0.0, 0.0, 1.0);
}`, `
void main(){
  vec2 uv = vUV;
  vec3 pic = texture(uBg, uv).rgb;
  float v = texture(uState, uv).r;
  vec3 on = mix(uC1, pic * 1.4, uP.y);
  vec3 col = mix(mix(uC2, pic * (1.0 - uP.z), 0.6), on, v);
  o = vec4(mix(pic, col, uOpacity), 1.0);
}`, {
  scale: (p) => 1 / Math.max(1, p.cell), nearest: true,
  n: (p) => p.speed / 60,
  uP: (p) => [Number(p.rule), p.picture, p.dim, 0],
  colours: (p) => [p.col, p.col2],
  reset: (st, p) => { if (st.rule !== p.rule) { st.rule = p.rule; return true; } return false; },
});

// ------------------------------------------------------------------ coral --
// Eden growth: living cells spread into neighbours where the picture is dark,
// so the film's shadows fill with coral while its highlights stay clear.
export const coral = caEffect({
  type: 'coral',
  label: 'Coral growth',
  group: 'Generative',
  hint: 'Cells spread from the shapes and the floor into the picture’s shadows, so coral fills the dark of the film and leaves the light alone; then it dies back.',
  actions: [{ name: 'reset', label: 'Reseed' }],
  params: [
    R('speed', 'Growth speed', 1, 0.1, 4),
    R('threshold', 'Grows where darker than', 0.35, 0.05, 1),
    R('branch', 'Branchiness', 0.5, 0, 1),
    R('cycle', 'Die back after (s)', 20, 0, 120, 1),
    C('col', 'Young', '#ff8fb1'),
    C('col2', 'Old', '#5b1a3a'),
    R('dim', 'Dim the picture', 0.3, 0, 1),
  ],
}, `
void main(){
  vec2 uv = vUV;
  float l = luma(texture(uBg, uv).rgb);
  float d = shapeD(uv);
  if (uInit == 1) {
    // seeds: a ring just outside every shape, and the floor
    float seed = step(0.0, d) * (1.0 - smoothstep(0.004, 0.012, d)) + step(uv.y, 0.012);
    o = vec4(step(0.5, seed) * step(0.3, hash12(gl_FragCoord.xy + uSeed)), 0.0, 0.0, 1.0); return;
  }
  vec4 c = texture(uState, uv);
  if (c.r > 0.5) { o = vec4(1.0, min(c.g + uP.z, 1.0), 0.0, 1.0); return; }   // alive: age
  if (d < 0.0 || l > uP.x) { o = vec4(0.0); return; }                         // shapes and highlights stay clear
  float n = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    if (i == 0 && j == 0) continue;
    n += texture(uState, uv + vec2(float(i), float(j)) * uTexel).r;
  }
  // more neighbours make growth likelier; branchiness prefers lone tips
  float pr = uP.y * (n > 0.0 ? mix(0.35, 1.0, sat(n / 3.0)) * mix(1.0, step(n, 1.5) * 1.6 + 0.2, uP.w) : 0.0);
  float alive = step(1.0 - pr, hash12(gl_FragCoord.xy + uSeed));
  o = vec4(alive, 0.0, 0.0, 1.0);
}`, `
void main(){
  vec2 uv = vUV;
  vec3 pic = texture(uBg, uv).rgb;
  vec4 s = texture(uState, uv);
  vec2 e = uTexel;
  float around = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) around += texture(uState, uv + vec2(float(i), float(j)) * e).r;
  float body = sat(around / 6.0);
  vec3 col = pic * (1.0 - uQ.x * body);
  vec3 cc = mix(uC1, uC2, sat(s.g));
  // bevelled: lit from the top left
  float hl = texture(uState, uv + vec2(-e.x, e.y)).r - texture(uState, uv + vec2(e.x, -e.y)).r;
  col = mix(col, cc * (0.8 + 0.5 * hl) + 0.15 * pic, body);
  o = vec4(mix(pic, col, uOpacity), 1.0);
}`, {
  scale: 0.5, nearest: true,
  n: (p) => p.speed * 0.6,
  uP: (p, st) => [p.threshold, 0.05 * p.speed, 0.002, p.branch],
  uQ: (p) => [p.dim, 0, 0, 0],
  colours: (p) => [p.col, p.col2],
  step(st, dt, w, p) { st.age = (st.age || 0) + dt; },
  reset: (st, p) => { if (p.cycle > 0 && (st.age || 0) > p.cycle) { st.age = 0; return true; } return false; },
});

// ---------------------------------------------------------------- symmetry --
// The picture cut into a grid of circles; every circle carries a rotated,
// reflected copy, and the operations sweep across the grid. (Symmetry)
const SYMMETRY_FS = `
uniform float uCells;
uniform float uSpin;
uniform float uWave;
uniform float uReflect;
uniform float uGap;
uniform float uZoom;
uniform float uDark;
void main(){
  vec2 uv = vUV;
  vec2 A = vec2(1.0, uAspect);
  vec2 g = uv * A * uCells;
  vec2 cell = floor(g), f = fract(g) - 0.5;
  float r = length(f);
  float phase = (cell.x + cell.y) * 0.7 + uTime * uWave;
  // rotation and reflection travel across the grid as waves
  float ang = uTime * uSpin + sin(phase) * 1.2;
  vec2 q = rot2(ang) * f;
  if (sin(phase * 0.5 + 1.0) * uReflect > 0.3) q.x = -q.x;
  if (cos(phase * 0.5) * uReflect > 0.3) q.y = -q.y;
  vec2 centre = (cell + 0.5) / (A * uCells);
  vec2 src = centre + q / (A * uCells) * uZoom;
  vec3 bg = texture(uBg, uv).rgb;
  vec3 col = pic(src);
  float disc = 1.0 - smoothstep(0.5 - uGap - 0.02, 0.5 - uGap, r);
  vec3 out3 = mix(bg * (1.0 - uDark), col, disc);
  // a thin rim
  out3 += vec3(0.3) * (smoothstep(0.5 - uGap - 0.03, 0.5 - uGap - 0.01, r) - smoothstep(0.5 - uGap - 0.01, 0.5 - uGap, r)) * 0.8;
  o = vec4(mix(bg, out3, uOpacity), 1.0);
}`;
export const symmetry = postEffect({
  type: 'symmetry', label: 'Symmetry', group: 'Generative',
  hint: 'The picture cut into a grid of circles; each carries a rotated, reflected copy and the operations sweep across the grid in waves.',
  actions: [],
  params: [
    R('cells', 'Circles across', 8, 2, 30, 1),
    R('spin', 'Rotation', 0.3, -3, 3, 0.05),
    R('wave', 'Wave speed', 1, 0, 5),
    R('reflect', 'Reflections', 0.6, 0, 1),
    R('gap', 'Gap', 0.04, 0, 0.3),
    R('zoom', 'Zoom into the circle', 1, 0.3, 3),
    R('dark', 'Darken between', 0.8, 0, 1),
  ],
}, SYMMETRY_FS, {
  uniforms(gl, u, p) {
    gl.uniform1f(u.uCells, Math.round(p.cells)); gl.uniform1f(u.uSpin, p.spin); gl.uniform1f(u.uWave, p.wave);
    gl.uniform1f(u.uReflect, p.reflect); gl.uniform1f(u.uGap, p.gap); gl.uniform1f(u.uZoom, p.zoom); gl.uniform1f(u.uDark, p.dark);
  },
});

// ------------------------------------------------------------------ sprawl --
// The built form duplicated: the picture tiled 2x2, 4x4, 8x8 … receding for
// ever as the camera pulls back, the copies mirrored so the seams meet. (Repetition)
const SPRAWL_FS = `
uniform float uSpeed;
uniform float uLevels;
uniform float uTilt;
uniform float uFade;
uniform float uMirror;
void main(){
  vec2 uv = vUV;
  vec3 bg = texture(uBg, uv).rgb;
  vec2 p0 = (uv - 0.5) * vec2(1.0, uAspect);
  p0 = rot2(uTilt * sin(uTime * 0.13)) * p0;
  float t = uTime * uSpeed;
  float ft = fract(t);
  vec3 col = vec3(0.0); float wsum = 0.0;
  for (int i = 0; i < 6; i++) {
    if (float(i) >= uLevels) break;
    // level i is scaled by 2^(i + ft): the smallest copies keep arriving
    float s = pow(2.0, float(i) + ft);
    vec2 q = p0 * s;
    vec2 cell = floor(q + 0.5);
    vec2 f = q - cell;                       // -0.5..0.5 within the copy
    if (uMirror > 0.5) f *= vec2(mod(cell.x, 2.0) < 1.0 ? 1.0 : -1.0, mod(cell.y, 2.0) < 1.0 ? 1.0 : -1.0);
    vec2 suv = 0.5 + f / vec2(1.0, uAspect);
    float w = (i == 0 ? ft : 1.0) * (float(i) + 1.0 >= uLevels ? 1.0 - ft : 1.0);
    w *= pow(uFade, float(i));
    col += pic(suv) * w; wsum += w;
  }
  col /= max(wsum, 1e-4);
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const sprawl = postEffect({
  type: 'sprawl', label: 'Sprawl', group: 'Generative',
  hint: 'The picture duplicates into 2×2, 4×4, 8×8 … copies receding for ever as the camera pulls back, mirrored so the seams meet.',
  actions: [],
  params: [
    R('speed', 'Pull back speed', 0.25, -1, 1, 0.01),
    R('levels', 'Levels', 4, 1, 6, 1),
    R('tilt', 'Tilt', 0.15, 0, 1),
    R('fade', 'Fade the small copies', 0.7, 0.3, 1),
    B('mirror', 'Mirror the copies', true),
  ],
}, SPRAWL_FS, {
  uniforms(gl, u, p) { gl.uniform1f(u.uSpeed, p.speed); gl.uniform1f(u.uLevels, Math.round(p.levels)); gl.uniform1f(u.uTilt, p.tilt); gl.uniform1f(u.uFade, p.fade); gl.uniform1f(u.uMirror, p.mirror ? 1 : 0); },
});

// ------------------------------------------------------------------- aleph --
// The infinite zoom: the picture inside itself inside itself, each level
// turned a little, the camera falling in for ever. (Aleph 2)
const ALEPH_FS = `
uniform float uSpeed;
uniform float uTwist;
uniform float uRatio;
uniform float uFrame;
uniform float uDim;
void main(){
  vec2 uv = vUV;
  vec3 bg = texture(uBg, uv).rgb;
  vec2 c = uCentre;
  vec2 p = (uv - c) * vec2(1.0, uAspect);
  float t = uTime * uSpeed;
  float ft = fract(t);
  // each level is the picture scaled by ratio^n about the centre and twisted
  vec3 col = vec3(0.0); float wsum = 0.0; float shade = 1.0;
  for (int i = 0; i < 8; i++) {
    float n = float(i) - ft;
    float s = pow(uRatio, n);
    vec2 q = rot2(uTwist * n) * p / s;
    vec2 suv = q / vec2(1.0, uAspect) + 0.5;
    bool inside = all(greaterThan(suv, vec2(0.0))) && all(lessThan(suv, vec2(1.0)));
    if (!inside) continue;
    // a frame around each level, and a darkening as we go deeper
    float edge = min(min(suv.x, 1.0 - suv.x), min(suv.y, 1.0 - suv.y));
    float frame = 1.0 - smoothstep(0.0, uFrame, edge);
    float w = (i == 0 ? 1.0 - ft : 1.0);
    col = mix(col, texture(uBg, suv).rgb * (1.0 - uDim * float(i) * 0.12) * (1.0 - frame * 0.8), w * (1.0 - wsum));
    wsum = min(1.0, wsum + w);
    if (wsum >= 1.0) break;
  }
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const aleph = postEffect({
  type: 'aleph', label: 'Aleph', group: 'Generative',
  hint: 'The picture inside itself inside itself, each level turned a little, the camera falling inwards for ever. The centre follows the pointer if you let it.',
  actions: [],
  params: [
    R('speed', 'Fall speed', 0.3, -1.5, 1.5, 0.01),
    R('twist', 'Twist per level', 0.25, -1.5, 1.5, 0.01),
    R('ratio', 'Shrink per level', 2.2, 1.3, 5, 0.05),
    R('frame', 'Frame width', 0.02, 0, 0.1, 0.002),
    R('dim', 'Darken with depth', 0.5, 0, 1),
    R('x', 'Centre x', 0.5, 0, 1), R('y', 'Centre y', 0.5, 0, 1),
    R('drift', 'Drift', 0.3, 0, 2),
    B('followPointer', 'Centre at the pointer', false),
  ],
}, ALEPH_FS, {
  centre: true,
  uniforms(gl, u, p) { gl.uniform1f(u.uSpeed, p.speed); gl.uniform1f(u.uTwist, p.twist); gl.uniform1f(u.uRatio, p.ratio); gl.uniform1f(u.uFrame, p.frame); gl.uniform1f(u.uDim, p.dim); },
});

// -------------------------------------------------------------- pointcloud --
// The picture as a field of dots lifted off the wall by their brightness and
// seen from a slowly moving camera. (Perpetual Motion)
const CLOUD_FS = `
uniform float uCells;
uniform float uLift;
uniform float uDot;
uniform float uBgDim;
uniform float uGlow;
uniform float uDrift;
void main(){
  vec2 uv = vUV;
  vec2 A = vec2(1.0, uAspect);
  vec3 bg = texture(uBg, uv).rgb;
  vec2 cam = vec2(sin(uTime * 0.31), cos(uTime * 0.23)) * uDrift * 0.03;
  vec2 g = uv * A * uCells;
  vec3 col = bg * (1.0 - uBgDim);
  float acc = 0.0;
  // dots are displaced by their height, so look in the neighbouring cells too
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 cell = floor(g) + vec2(float(i), float(j));
    vec2 cuv = (cell + 0.5) / (A * uCells);
    if (any(lessThan(cuv, vec2(0.0))) || any(greaterThan(cuv, vec2(1.0)))) continue;
    vec3 pc = texture(uBg, cuv).rgb;
    float h = luma(pc);
    vec2 pos = (cell + 0.5) + cam * uCells * h * uLift * 10.0;    // parallax: higher dots move more
    float r = uDot * (0.35 + 0.65 * h);
    float d = length(g - pos);
    float a = 1.0 - smoothstep(r * 0.7, r, d);
    col = mix(col, pc * 1.6 + vec3(0.25) * h, a);
    acc += exp(-d * d / (r * r * 4.0)) * h * uGlow;
  }
  col += acc * 0.15;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const pointcloud = postEffect({
  type: 'pointcloud', label: 'Point cloud', group: 'Generative',
  hint: 'The picture as a field of dots lifted off the wall by their brightness, seen from a camera that drifts, so the bright dots slide over the dark ones.',
  actions: [],
  params: [
    R('cells', 'Dots across', 90, 20, 240, 1),
    R('lift', 'Lift', 0.6, 0, 2),
    R('dot', 'Dot size', 0.5, 0.1, 0.8),
    R('drift', 'Camera drift', 1, 0, 3),
    R('glow', 'Glow', 0.5, 0, 2),
    R('bgDim', 'Hide the picture', 0.9, 0, 1),
  ],
}, CLOUD_FS, {
  uniforms(gl, u, p) { gl.uniform1f(u.uCells, Math.round(p.cells)); gl.uniform1f(u.uLift, p.lift); gl.uniform1f(u.uDot, p.dot); gl.uniform1f(u.uBgDim, p.bgDim); gl.uniform1f(u.uGlow, p.glow); gl.uniform1f(u.uDrift, p.drift); },
});

// ------------------------------------------------------------------ plexus --
// Points that wander and join their neighbours with lines when they come
// close: the network diagram over the film. (Order From Chaos)
const PLEXUS_FS = `
uniform float uCells;
uniform float uSpeed;
uniform float uReach;
uniform float uDot;
uniform float uLine;
uniform float uBgDim;
uniform vec3 uCol;
uniform float uPicCol;
vec2 pointIn(vec2 cell){
  vec2 h = hash22(cell);
  vec2 h2 = hash22(cell + 17.3);
  return cell + 0.5 + 0.42 * vec2(sin(uTime * uSpeed * (0.5 + h.x) + h2.x * 6.28), cos(uTime * uSpeed * (0.5 + h.y) + h2.y * 6.28));
}
float segDist(vec2 p, vec2 a, vec2 b){
  vec2 ab = b - a; float t = sat(dot(p - a, ab) / max(dot(ab, ab), 1e-6));
  return length(p - (a + ab * t));
}
void main(){
  vec2 uv = vUV;
  vec2 A = vec2(1.0, uAspect);
  vec3 bg = texture(uBg, uv).rgb;
  vec2 g = uv * A * uCells;
  vec2 base = floor(g);
  vec3 col = bg * (1.0 - uBgDim);
  float dots = 0.0, lines = 0.0;
  vec3 lineCol = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 cell = base + vec2(float(i), float(j));
    vec2 p = pointIn(cell);
    float d = length(g - p);
    dots += 1.0 - smoothstep(uDot * 0.6, uDot, d);
    // links to the neighbours to the right, up, and both diagonals (each pair once)
    for (int k = 0; k < 4; k++) {
      vec2 off = k == 0 ? vec2(1.0, 0.0) : k == 1 ? vec2(0.0, 1.0) : k == 2 ? vec2(1.0, 1.0) : vec2(1.0, -1.0);
      vec2 q = pointIn(cell + off);
      float len = length(q - p);
      if (len > uReach) continue;
      float sd = segDist(g, p, q);
      float w = (1.0 - smoothstep(uLine * 0.5, uLine, sd)) * (1.0 - len / uReach);
      lines += w;
      lineCol += w * mix(uCol, texture(uBg, (p + q) * 0.5 / (A * uCells)).rgb * 1.3, uPicCol);
    }
  }
  vec3 pc = mix(uCol, bg * 1.5, uPicCol);
  col += lineCol * 0.9;
  col = mix(col, pc, sat(dots));
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const plexus = postEffect({
  type: 'plexus', label: 'Network', group: 'Generative',
  hint: 'Points wander over the wall and join their neighbours with lines when they come close: a living network diagram over the film.',
  actions: [],
  params: [
    R('cells', 'Density', 14, 4, 40, 1),
    R('speed', 'Wander speed', 0.4, 0, 3),
    R('reach', 'Link reach', 1.4, 0.5, 2.2),
    R('dot', 'Dot size', 0.08, 0.02, 0.3),
    R('line', 'Line weight', 0.03, 0.005, 0.15, 0.005),
    C('col', 'Colour', '#ffffff'),
    R('picCol', 'Colour from the picture', 0.5, 0, 1),
    R('bgDim', 'Dim the picture', 0.75, 0, 1),
  ],
}, PLEXUS_FS, {
  uniforms(gl, u, p, st, c, color) { gl.uniform1f(u.uCells, Math.round(p.cells)); gl.uniform1f(u.uSpeed, p.speed); gl.uniform1f(u.uReach, p.reach); gl.uniform1f(u.uDot, p.dot); gl.uniform1f(u.uLine, p.line); gl.uniform1f(u.uBgDim, p.bgDim); color('uCol', p.col); gl.uniform1f(u.uPicCol, p.picCol); },
});

// ------------------------------------------------------------------ digits --
// The picture typed as digits, seven-segment style, each cell's digit its
// brightness — the transcendental number look. (Perpetual Motion / Krzywinski)
const DIGITS_FS = GLSL_HSV + `
uniform float uCells;
uniform float uWeight;
uniform vec3 uCol;
uniform float uPicCol;
uniform float uBgDim;
uniform float uFlicker;
// seven segments: a top, b upper right, c lower right, d bottom, e lower left, f upper left, g middle
float segBox(vec2 p, vec2 c, vec2 h){ vec2 d = abs(p - c) - h; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float digitSDF(vec2 p, int n){
  // p in -1..1 (x) and -1.6..1.6 (y)
  int m = n == 0 ? 63 : n == 1 ? 6 : n == 2 ? 91 : n == 3 ? 79 : n == 4 ? 102 : n == 5 ? 109 : n == 6 ? 125 : n == 7 ? 7 : n == 8 ? 127 : 111;
  float d = 1e3; float w = 0.16;
  if ((m & 1) != 0) d = min(d, segBox(p, vec2(0.0, 1.4), vec2(0.6, w)));
  if ((m & 2) != 0) d = min(d, segBox(p, vec2(0.7, 0.7), vec2(w, 0.6)));
  if ((m & 4) != 0) d = min(d, segBox(p, vec2(0.7, -0.7), vec2(w, 0.6)));
  if ((m & 8) != 0) d = min(d, segBox(p, vec2(0.0, -1.4), vec2(0.6, w)));
  if ((m & 16) != 0) d = min(d, segBox(p, vec2(-0.7, -0.7), vec2(w, 0.6)));
  if ((m & 32) != 0) d = min(d, segBox(p, vec2(-0.7, 0.7), vec2(w, 0.6)));
  if ((m & 64) != 0) d = min(d, segBox(p, vec2(0.0, 0.0), vec2(0.6, w)));
  return d;
}
void main(){
  vec2 uv = vUV;
  vec2 A = vec2(1.0, uAspect);
  vec3 bg = texture(uBg, uv).rgb;
  vec2 g = uv * A * vec2(uCells, uCells * 0.62);
  vec2 cell = floor(g);
  vec2 f = fract(g);
  vec2 cuv = (cell + 0.5) / (A * vec2(uCells, uCells * 0.62));
  vec3 pc = texture(uBg, cuv).rgb;
  float l = luma(pc);
  float fl = uFlicker > 0.0 ? step(0.97, hash12(cell + floor(uTime * 8.0))) * uFlicker : 0.0;
  int n = int(clamp(floor(pow(l, 0.55) * 9.99 + fl * 3.0), 0.0, 9.0));
  vec2 p = (f - 0.5) * vec2(2.6, 3.9);
  float d = digitSDF(p, n) - (uWeight - 0.16);
  float ink = 1.0 - smoothstep(0.0, 0.12, d);
  vec3 dc = mix(uCol, pc * 1.6, uPicCol) * (0.5 + 0.7 * l);
  vec3 col = mix(bg * (1.0 - uBgDim), dc, ink);
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const digits = postEffect({
  type: 'digits', label: 'Digits', group: 'Generative',
  hint: 'The picture typed out as seven-segment digits, each cell’s digit its brightness: the wall as a transcendental number.',
  actions: [],
  params: [
    R('cells', 'Digits across', 48, 12, 140, 1),
    R('weight', 'Stroke weight', 0.16, 0.06, 0.4, 0.01),
    C('col', 'Colour', '#7dffb0'),
    R('picCol', 'Colour from the picture', 0.3, 0, 1),
    R('bgDim', 'Dim the picture', 0.85, 0, 1),
    R('flicker', 'Flicker', 0.5, 0, 1),
  ],
}, DIGITS_FS, {
  uniforms(gl, u, p, st, c, color) { gl.uniform1f(u.uCells, Math.round(p.cells)); gl.uniform1f(u.uWeight, p.weight); color('uCol', p.col); gl.uniform1f(u.uPicCol, p.picCol); gl.uniform1f(u.uBgDim, p.bgDim); gl.uniform1f(u.uFlicker, p.flicker); },
});

// ----------------------------------------------------------------- treemap --
// The wall subdivided into a tree map: every rectangle split again and again,
// the splits sliding, each leaf a zoomed tile of the picture. (Transcendental Tree Map)
const TREEMAP_FS = `
uniform float uDepth;
uniform float uSpeed;
uniform float uBorder;
uniform float uZoom;
uniform float uShade;
void main(){
  vec2 uv = vUV;
  vec3 bg = texture(uBg, uv).rgb;
  vec2 lo = vec2(0.0), hi = vec2(1.0);
  float id = 1.0;
  float minEdge = 1.0;
  for (int i = 0; i < 9; i++) {
    if (float(i) >= uDepth) break;
    vec2 size = hi - lo;
    // split the longer side (in screen terms) at a ratio that drifts
    bool horiz = size.x > size.y * uAspect;
    float r = 0.3 + 0.4 * (0.5 + 0.5 * sin(uTime * uSpeed * (0.3 + 0.2 * hash11(id)) + hash11(id * 3.1) * 6.28));
    if (horiz) { float m = lo.x + size.x * r; if (uv.x < m) { hi.x = m; id = id * 2.0; } else { lo.x = m; id = id * 2.0 + 1.0; } }
    else { float m = lo.y + size.y * r; if (uv.y < m) { hi.y = m; id = id * 2.0; } else { lo.y = m; id = id * 2.0 + 1.0; } }
  }
  vec2 size = hi - lo;
  vec2 f = (uv - lo) / size;
  // each leaf shows the picture around its own centre, zoomed
  vec2 centre = lo + size * 0.5;
  vec2 suv = centre + (f - 0.5) * size * uZoom;
  vec3 col = pic(suv);
  float edge = min(min(f.x, 1.0 - f.x) * size.x, min(f.y, 1.0 - f.y) * size.y * uAspect);
  float border = 1.0 - smoothstep(0.0, uBorder, edge);
  col *= 1.0 - border;
  col *= 1.0 - uShade * (0.5 + 0.5 * hash11(id * 7.7)) * 0.5;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const treemap = postEffect({
  type: 'treemap', label: 'Tree map', group: 'Generative',
  hint: 'The wall subdivided into a tree map: every rectangle split again and again, the splits sliding, each leaf a zoomed tile of the picture.',
  actions: [],
  params: [
    R('depth', 'Depth', 6, 1, 9, 1),
    R('speed', 'Split drift', 0.5, 0, 3),
    R('border', 'Border', 0.004, 0, 0.03, 0.001),
    R('zoom', 'Zoom in the leaves', 1.6, 0.5, 4),
    R('shade', 'Shade the leaves', 0.5, 0, 1),
  ],
}, TREEMAP_FS, {
  uniforms(gl, u, p) { gl.uniform1f(u.uDepth, Math.round(p.depth)); gl.uniform1f(u.uSpeed, p.speed); gl.uniform1f(u.uBorder, p.border); gl.uniform1f(u.uZoom, p.zoom); gl.uniform1f(u.uShade, p.shade); },
});

// ------------------------------------------------------------- quasicrystal --
// Five, seven or nine plane waves summed: a pattern that never repeats, the
// picture showing through its contours. (aperiodic tiling / Perpetual Motion)
const QUASI_FS = GLSL_HSV + `
uniform float uFolds;
uniform float uScale;
uniform float uSpeed;
uniform float uContours;
uniform float uPicture;
uniform vec3 uCol;
uniform float uRainbow;
void main(){
  vec2 uv = vUV;
  vec3 bg = texture(uBg, uv).rgb;
  vec2 p = (uv - uCentre) * vec2(1.0, uAspect) * uScale * 40.0;
  float s = 0.0;
  for (int i = 0; i < 9; i++) {
    if (float(i) >= uFolds) break;
    float a = float(i) * PI / uFolds;
    s += cos(dot(p, vec2(cos(a), sin(a))) + uTime * uSpeed * (1.0 + 0.1 * float(i)));
  }
  s = s / uFolds * 0.5 + 0.5;
  float bands = fract(s * uContours);
  float line = smoothstep(0.0, 0.08, bands) * smoothstep(1.0, 0.92, bands);
  vec3 tint = mix(uCol, hsv(fract(s * 1.5 + uTime * 0.03), 0.8, 1.0), uRainbow);
  vec3 col = mix(tint * s, bg, uPicture) * (0.55 + 0.6 * s);
  col *= mix(1.0, line, 0.8);
  col += tint * (1.0 - line) * 0.25;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const quasicrystal = postEffect({
  type: 'quasicrystal', label: 'Quasicrystal', group: 'Generative',
  hint: 'Five, seven or nine plane waves summed into an aperiodic pattern that never repeats, the picture showing through its drifting contours.',
  actions: [],
  params: [
    R('folds', 'Symmetry', 5, 3, 9, 1),
    R('scale', 'Scale', 1, 0.2, 4),
    R('speed', 'Drift', 0.6, -3, 3, 0.05),
    R('contours', 'Contours', 6, 1, 24, 1),
    R('picture', 'Picture', 0.6, 0, 1),
    C('col', 'Colour', '#ffd166'),
    R('rainbow', 'Rainbow', 0.3, 0, 1),
    R('x', 'Centre x', 0.5, 0, 1), R('y', 'Centre y', 0.5, 0, 1),
    R('drift', 'Centre drift', 0, 0, 2),
    B('followPointer', 'Centre at the pointer', false),
  ],
}, QUASI_FS, {
  centre: true,
  uniforms(gl, u, p, st, c, color) { gl.uniform1f(u.uFolds, Math.round(p.folds)); gl.uniform1f(u.uScale, p.scale); gl.uniform1f(u.uSpeed, p.speed); gl.uniform1f(u.uContours, Math.round(p.contours)); gl.uniform1f(u.uPicture, p.picture); color('uCol', p.col); gl.uniform1f(u.uRainbow, p.rainbow); },
});

// ------------------------------------------------------------ interference --
// Circular waves from moving sources add up across the wall and refract the
// picture; the wave heights are drawn as contours. (Waves)
const INTERF_FS = `
uniform float uSources;
uniform float uFreq;
uniform float uSpeed;
uniform float uRefract;
uniform float uLines;
uniform float uDrift;
uniform vec3 uCol;
void main(){
  vec2 uv = vUV;
  vec3 bg = texture(uBg, uv).rgb;
  vec2 A = vec2(1.0, uAspect);
  float h = 0.0; vec2 grad = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uSources) break;
    float fi = float(i);
    vec2 s = vec2(0.5 + 0.38 * sin(uTime * uDrift * (0.21 + 0.07 * fi) + fi * 2.1), 0.5 + 0.38 * cos(uTime * uDrift * (0.17 + 0.05 * fi) + fi * 1.3));
    vec2 d = (uv - s) * A;
    float r = length(d);
    float ph = r * uFreq * 40.0 - uTime * uSpeed * 4.0;
    h += sin(ph);
    grad += cos(ph) * d / max(r, 1e-4);
  }
  h /= uSources; grad /= uSources;
  vec3 col = texture(uBg, clamp(uv + grad * uRefract * 0.01, 0.0, 1.0)).rgb;
  float bands = fract((h * 0.5 + 0.5) * uLines);
  float line = 1.0 - (smoothstep(0.0, 0.05, bands) * smoothstep(1.0, 0.95, bands));
  col += uCol * line * 0.6 * step(0.01, uLines);
  col *= 0.85 + 0.3 * h;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const interference = postEffect({
  type: 'interference', label: 'Interference', group: 'Generative',
  hint: 'Circular waves from moving sources add up across the wall and refract the picture; their heights are drawn as contour lines.',
  actions: [],
  params: [
    R('sources', 'Sources', 4, 1, 8, 1),
    R('freq', 'Wavelength', 0.5, 0.1, 3),
    R('speed', 'Speed', 0.5, -3, 3, 0.05),
    R('refract', 'Refraction', 1, 0, 4),
    R('lines', 'Contour lines', 4, 0, 20, 1),
    R('drift', 'Source drift', 0.5, 0, 3),
    C('col', 'Line colour', '#9ad8ff'),
  ],
}, INTERF_FS, {
  uniforms(gl, u, p, st, c, color) { gl.uniform1f(u.uSources, Math.round(p.sources)); gl.uniform1f(u.uFreq, p.freq); gl.uniform1f(u.uSpeed, p.speed); gl.uniform1f(u.uRefract, p.refract); gl.uniform1f(u.uLines, Math.round(p.lines)); gl.uniform1f(u.uDrift, p.drift); color('uCol', p.col); },
});

// ------------------------------------------------------------------- weave --
// Warp and weft: the picture woven from threads that pass over and under. (Woven Ancestry)
const WEAVE_FS = `
uniform float uThreads;
uniform float uGap;
uniform float uShade;
uniform float uWobble;
uniform float uSpeed;
void main(){
  vec2 uv = vUV;
  vec3 bg = texture(uBg, uv).rgb;
  vec2 A = vec2(1.0, uAspect);
  vec2 g = uv * A * uThreads;
  g += uWobble * 0.3 * vec2(sin(g.y * 0.7 + uTime * uSpeed), sin(g.x * 0.6 - uTime * uSpeed * 0.8));
  vec2 cell = floor(g), f = fract(g);
  // checkerboard: which thread is on top in this cell
  bool warpTop = mod(cell.x + cell.y, 2.0) < 1.0;
  // thread profiles (cylinders) across each direction
  float ax = abs(f.x - 0.5) * 2.0, ay = abs(f.y - 0.5) * 2.0;
  float warpCore = sqrt(max(0.0, 1.0 - ax * ax));    // vertical thread
  float weftCore = sqrt(max(0.0, 1.0 - ay * ay));    // horizontal thread
  float warpMask = 1.0 - smoothstep(1.0 - uGap - 0.05, 1.0 - uGap, ax);
  float weftMask = 1.0 - smoothstep(1.0 - uGap - 0.05, 1.0 - uGap, ay);
  vec2 warpUV = vec2((cell.x + 0.5) / (A.x * uThreads), uv.y);
  vec2 weftUV = vec2(uv.x, (cell.y + 0.5) / (A.y * uThreads));
  vec3 warpCol = texture(uBg, warpUV).rgb * (0.55 + 0.6 * warpCore);
  vec3 weftCol = texture(uBg, weftUV).rgb * (0.55 + 0.6 * weftCore);
  vec3 col = vec3(0.02);
  if (warpTop) { col = mix(col, weftCol * (1.0 - uShade * 0.5), weftMask); col = mix(col, warpCol, warpMask); }
  else { col = mix(col, warpCol * (1.0 - uShade * 0.5), warpMask); col = mix(col, weftCol, weftMask); }
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const weave = postEffect({
  type: 'weave', label: 'Weave', group: 'Generative',
  hint: 'The picture woven from warp and weft threads that pass over and under each other, each thread carrying its strip of the film.',
  actions: [],
  params: [
    R('threads', 'Threads across', 60, 10, 200, 1),
    R('gap', 'Gap', 0.12, 0, 0.5),
    R('shade', 'Shade the under-thread', 0.8, 0, 1),
    R('wobble', 'Wobble', 0.3, 0, 1),
    R('speed', 'Speed', 0.5, 0, 3),
  ],
}, WEAVE_FS, {
  uniforms(gl, u, p) { gl.uniform1f(u.uThreads, Math.round(p.threads)); gl.uniform1f(u.uGap, p.gap); gl.uniform1f(u.uShade, p.shade); gl.uniform1f(u.uWobble, p.wobble); gl.uniform1f(u.uSpeed, p.speed); },
});

// --------------------------------------------------------------- flowlines --
// Line integral convolution: noise smeared along the picture's own contours,
// so the film turns into strands that follow its shapes. (Chromos)
const FLOW_FS = `
uniform float uLength;
uniform float uContrast;
uniform float uColour;
uniform float uSpeed;
uniform float uSwirl;
vec2 flowAt(vec2 uv){
  vec2 e = 2.0 / uSize;
  float l = luma(picClamp(uv));
  vec2 g = vec2(luma(picClamp(uv + vec2(e.x, 0.0))) - luma(picClamp(uv - vec2(e.x, 0.0))),
                luma(picClamp(uv + vec2(0.0, e.y))) - luma(picClamp(uv - vec2(0.0, e.y))));
  vec2 t = vec2(-g.y, g.x);                         // along the contour
  vec2 n = curl(uv * 3.0 + uTime * 0.05, 0.05) * 0.01 * uSwirl;
  vec2 f = t * 6.0 + n;
  float m = length(f);
  return m > 1e-5 ? f / m : vec2(1.0, 0.0);
}
void main(){
  vec2 uv = vUV;
  vec3 bg = texture(uBg, uv).rgb;
  float acc = 0.0, wsum = 0.0;
  vec2 p = uv; vec2 q = uv;
  float step_ = uLength * 0.002;
  for (int i = 0; i < 16; i++) {
    p += flowAt(p) * step_ / vec2(1.0, uAspect);
    q -= flowAt(q) * step_ / vec2(1.0, uAspect);
    float w = 1.0 - float(i) / 16.0;
    acc += (hash12(floor(p * uSize * 0.5) + floor(uTime * uSpeed)) + hash12(floor(q * uSize * 0.5) + floor(uTime * uSpeed))) * w;
    wsum += 2.0 * w;
  }
  float lic = acc / wsum;
  lic = 0.5 + (lic - 0.5) * uContrast * 2.5;
  vec3 col = mix(vec3(lic), bg * (0.4 + 1.2 * lic), uColour);
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const flowlines = postEffect({
  type: 'flowlines', label: 'Flow lines', group: 'Generative',
  hint: 'Noise smeared along the picture’s own contours (line integral convolution), so the film becomes strands that follow its shapes.',
  actions: [],
  params: [
    R('length', 'Stroke length', 1, 0.2, 4),
    R('contrast', 'Contrast', 0.8, 0.2, 2),
    R('colour', 'Colour from the picture', 0.8, 0, 1),
    R('speed', 'Shimmer', 4, 0, 30, 1),
    R('swirl', 'Swirl', 0.5, 0, 3),
  ],
}, FLOW_FS, {
  uniforms(gl, u, p) { gl.uniform1f(u.uLength, p.length); gl.uniform1f(u.uContrast, p.contrast); gl.uniform1f(u.uColour, p.colour); gl.uniform1f(u.uSpeed, p.speed); gl.uniform1f(u.uSwirl, p.swirl); },
});

// ------------------------------------------------------------------- moire --
// Two line gratings turning against each other, the picture modulating the
// third: interference you can see. (Micron / Spectrum)
const MOIRE_FS = `
uniform float uPitch;
uniform float uAngle;
uniform float uSpin;
uniform float uPicture;
uniform float uDark;
uniform vec3 uCol;
void main(){
  vec2 uv = vUV;
  vec3 bg = texture(uBg, uv).rgb;
  vec2 p = (uv - 0.5) * vec2(1.0, uAspect) * uPitch * 300.0;
  float a = uAngle + uTime * uSpin;
  float g1 = 0.5 + 0.5 * sin(dot(p, vec2(cos(a), sin(a))));
  float g2 = 0.5 + 0.5 * sin(dot(p, vec2(cos(-a), sin(-a))) + luma(bg) * uPicture * 12.0);
  float m = g1 * g2;
  float ink = smoothstep(0.2, 0.45, m);
  vec3 col = mix(bg * (1.0 - uDark), mix(bg, uCol, 0.5), ink);
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const moire = postEffect({
  type: 'moire', label: 'Moiré', group: 'Generative',
  hint: 'Two line gratings turning against each other, with the picture bending the second one: interference patterns that roll across the film.',
  actions: [],
  params: [
    R('pitch', 'Line pitch', 1, 0.2, 4),
    R('angle', 'Angle', 0.15, 0, 1.57, 0.01),
    R('spin', 'Spin', 0.03, -0.5, 0.5, 0.005),
    R('picture', 'Picture bends the lines', 0.6, 0, 2),
    R('dark', 'Darken', 0.6, 0, 1),
    C('col', 'Line colour', '#ffffff'),
  ],
}, MOIRE_FS, {
  uniforms(gl, u, p, st, c, color) { gl.uniform1f(u.uPitch, p.pitch); gl.uniform1f(u.uAngle, p.angle); gl.uniform1f(u.uSpin, p.spin); gl.uniform1f(u.uPicture, p.picture); gl.uniform1f(u.uDark, p.dark); color('uCol', p.col); },
});

// -------------------------------------------------------------- rows (sound) --
// The sound drawn as it happens: each frame the analyser's spectrum becomes a
// new row, older rows recede — an audio waterfall in the Unknown Pleasures
// manner. With no live audio the rows read the picture's brightness instead
// (or both: the spectrum rides on top of the picture).
function rowsEffect(spec, fs, hooks) {
  return {
    ...spec,
    blend: 'post',
    create(ctx) {
      const gl = ctx.gl;
      const pr = prog(gl, VS_SCREEN, FS_HEAD + GLSL_POST + `uniform sampler2D uHist; uniform float uHistRows; uniform float uHead; uniform float uLive; uniform vec4 uP; uniform vec4 uQ; uniform vec3 uC1;\n` + fs);
      const N = 48, ROWS = 128;
      const hist = new Uint8Array(N * ROWS);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, N, ROWS, 0, gl.RED, gl.UNSIGNED_BYTE, hist);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      const st = { head: 0, acc: 0, live: 0, t: 0, c1: [0, 0, 0], dirty: false };
      return {
        st,
        resize() {},
        step(dt, w, p) {
          st.t += dt;
          const au = w.audio || {};
          const spec = au.spectrum;
          st.live += (((au.live && spec) ? 1 : 0) - st.live) * Math.min(1, dt * 3);
          // one new row every `1/rate` seconds
          st.acc += dt * (p.rate || 20);
          while (st.acc >= 1) {
            st.acc -= 1;
            st.head = (st.head + 1) % ROWS;
            const o = st.head * N;
            for (let i = 0; i < N; i++) hist[o + i] = Math.round(255 * (spec ? (spec[i] || 0) : 0));
            st.dirty = true;
          }
        },
        draw(c) {
          const p = c.params;
          if (st.dirty) { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, ROWS, gl.RED, gl.UNSIGNED_BYTE, hist); st.dirty = false; }
          c.dst.bind();
          gl.disable(gl.BLEND);
          pr.use();
          bindTex(gl, 0, c.src, pr.u.uBg);
          bindTex(gl, 1, c.sdfTex, pr.u.uSdf);
          bindTex(gl, 2, tex, pr.u.uHist);
          gl.uniform1f(pr.u.uTime, st.t);
          gl.uniform1f(pr.u.uAspect, c.aspect);
          gl.uniform1f(pr.u.uOpacity, c.opacity);
          gl.uniform2f(pr.u.uSize, c.size[0], c.size[1]);
          gl.uniform2f(pr.u.uCentre, 0.5, 0.5);
          gl.uniform2f(pr.u.uSdfTexel, c.sdfTexel[0], c.sdfTexel[1]);
          gl.uniform1f(pr.u.uHistRows, ROWS);
          gl.uniform1f(pr.u.uHead, (st.head + 0.5) / ROWS);
          gl.uniform1f(pr.u.uLive, st.live);
          const P = hooks.uP(p, st), Q = hooks.uQ(p, st);
          gl.uniform4f(pr.u.uP, P[0], P[1], P[2], P[3]);
          gl.uniform4f(pr.u.uQ, Q[0], Q[1], Q[2], Q[3]);
          hexRgb(p.col, st.c1);
          gl.uniform3f(pr.u.uC1, st.c1[0], st.c1[1], st.c1[2]);
          ctx.screen.draw();
        },
        dispose() { gl.deleteTexture(tex); },
      };
    },
  };
}

// shared: sample the history `age` rows back (0 = newest) at bin position x 0..1
const GLSL_HIST = `
float histAt(float x, float age){
  float row = uHead - age / uHistRows;         // REPEAT wrap
  return texture(uHist, vec2(clamp(x, 0.01, 0.99), row)).r;
}
// the sound or the picture or both, per the source mode in uQ.x
float heightAt(float x, float age, vec2 picUV){
  float snd = histAt(x, age);
  float pic = luma(picClamp(picUV));
  float mode = uQ.x;                           // 0 sound, 1 picture, 2 both
  float s = mode < 0.5 ? snd : mode < 1.5 ? pic : max(snd * 1.1, pic * 0.7);
  // no live audio: fall back to the picture so the rows are never flat
  return mix(pic, s, mode < 1.5 ? (mode < 0.5 ? uLive : 1.0) : 1.0);
}`;

const JOY_FS = GLSL_HIST + `
void main(){
  vec2 uv = vUV;
  vec3 bg = texture(uBg, uv).rgb;
  float rows = uP.x, amp = uP.y, weight = uP.z, fill = uP.w;
  float mirror = uQ.y, bgDim = uQ.z, picCol = uQ.w;
  vec3 col = bg * (1.0 - bgDim);
  float r0 = floor(uv.y * rows);
  float lit = 0.0, covered = 0.0;
  // walk the rows from the front (bottom) that could cover this pixel
  for (int k = 0; k < 8; k++) {
    float r = r0 - float(k);
    if (r < 0.0) break;
    float y0 = (r + 0.5) / rows;
    // the front row is the newest sound; rows behind are older
    float age = (rows - 1.0 - r) * (uHistRows / rows) * 0.9;
    float x = mirror > 0.5 ? abs(uv.x - 0.5) * 2.0 : uv.x;
    // smooth across neighbouring bins so the line is a curve, not a staircase
    float h = 0.0;
    for (int i = -2; i <= 2; i++) h += heightAt(x + float(i) * 0.008, age, vec2(uv.x + float(i) * 0.004, y0)) * (3.0 - abs(float(i)));
    h /= 9.0;
    float y = y0 + h * amp / rows * 3.2;
    float dy = (uv.y - y) * uSize.y;
    if (uv.y < y && uv.y > y0 - 0.5 / rows) covered = max(covered, fill);
    lit = max(lit, 1.0 - smoothstep(0.0, weight, abs(dy)));
  }
  vec3 lc = mix(uC1, bg * 1.6, picCol);
  col = mix(col, vec3(0.0), covered * (1.0 - lit));
  col = mix(col, lc, lit);
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const joyplot = rowsEffect({
  type: 'joyplot', label: 'Waveform rows', group: 'Generative',
  hint: 'The sound drawn as rows of waveforms: each new row is the live spectrum, older rows recede behind it. Reads the picture instead (or as well) if you like. Needs "React to sound" for the sound.',
  actions: [],
  params: [
    S('source', 'Rows show', 'sound', [['sound', 'The sound (falls back to the picture when silent)'], ['picture', 'The picture'], ['both', 'Both']]),
    R('rows', 'Rows', 36, 6, 120, 1),
    R('rate', 'Rows per second', 18, 2, 60, 1),
    R('amp', 'Height', 1, 0, 3),
    R('weight', 'Line weight (px)', 2.5, 0.5, 8, 0.5),
    R('fill', 'Fill under the lines', 0.9, 0, 1),
    B('mirror', 'Mirror from the centre', true),
    C('col', 'Line colour', '#ffffff'),
    R('picCol', 'Colour from the picture', 0.3, 0, 1),
    R('bgDim', 'Dim the picture', 0.9, 0, 1),
  ],
}, JOY_FS, {
  uP: (p) => [Math.round(p.rows), p.amp, p.weight, p.fill],
  uQ: (p) => [p.source === 'sound' ? 0 : p.source === 'picture' ? 1 : 2, p.mirror ? 1 : 0, p.bgDim, p.picCol],
});

// rings pulsing out from the centre: the newest sound is the innermost ring,
// each older row one ring further out, so the music travels outwards like a
// sonar echo (or falls inwards, if you flip it)
const RING_FS = GLSL_HIST + `
void main(){
  vec2 uv = vUV;
  vec3 bg = texture(uBg, uv).rgb;
  float rings = uP.x, amp = uP.y, weight = uP.z, fill = uP.w;
  float inward = uQ.y, bgDim = uQ.z, picCol = uQ.w;
  vec2 cen = uCentre;
  vec2 d = (uv - cen) * vec2(1.0, uAspect);
  float r = length(d) / 0.62;                  // 0 at the centre, ~1 at the corners
  float ang = atan(d.y, d.x) / TAU + 0.5;      // 0..1 around
  vec3 col = bg * (1.0 - bgDim);
  float k0 = floor(r * rings);
  float lit = 0.0, covered = 0.0;
  // rings that could cover this pixel: this one and the ones just inside
  for (int k = 0; k < 6; k++) {
    float kk = k0 - float(k);
    if (kk < 0.0) break;
    float base = (kk + 0.5) / rings;
    float age = (inward > 0.5 ? (rings - 1.0 - kk) : kk) * (uHistRows / rings) * 0.9;
    // the spectrum wraps around the ring; mirror it so bass sits at the top and bottom
    float x = abs(fract(ang + 0.25) * 2.0 - 1.0);
    float h = 0.0;
    for (int i = -2; i <= 2; i++) h += heightAt(x + float(i) * 0.01, age, uv + vec2(float(i) * 0.004, 0.0)) * (3.0 - abs(float(i)));
    h /= 9.0;
    float rr = base + h * amp / rings * 2.6;
    float dr = (r - rr) * 0.62 * uSize.x;
    if (r < rr && r > base - 0.5 / rings) covered = max(covered, fill);
    lit = max(lit, 1.0 - smoothstep(0.0, weight, abs(dr)));
  }
  vec3 lc = mix(uC1, bg * 1.6, picCol);
  col = mix(col, vec3(0.0), covered * (1.0 - lit));
  col = mix(col, lc, lit);
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const ringrows = rowsEffect({
  type: 'ringrows', label: 'Sonar rings', group: 'Generative',
  hint: 'The sound as rings pulsing out from the centre: the newest beat is the innermost ring, each older one a ring further out, so the music travels across the wall like a sonar echo. Needs "React to sound".',
  actions: [],
  params: [
    S('source', 'Rings show', 'sound', [['sound', 'The sound (falls back to the picture when silent)'], ['picture', 'The picture'], ['both', 'Both']]),
    R('rings', 'Rings', 24, 4, 80, 1),
    R('rate', 'Rings per second', 12, 1, 60, 1),
    R('amp', 'Height', 1, 0, 3),
    R('weight', 'Line weight (px)', 2.5, 0.5, 8, 0.5),
    R('fill', 'Fill between', 0.85, 0, 1),
    B('inward', 'Fall inwards', false),
    C('col', 'Line colour', '#ffffff'),
    R('picCol', 'Colour from the picture', 0.3, 0, 1),
    R('bgDim', 'Dim the picture', 0.9, 0, 1),
    R('x', 'Centre x', 0.5, 0, 1), R('y', 'Centre y', 0.5, 0, 1),
  ],
}, RING_FS, {
  uP: (p) => [Math.round(p.rings), p.amp, p.weight, p.fill],
  uQ: (p) => [p.source === 'sound' ? 0 : p.source === 'picture' ? 1 : 2, p.inward ? 1 : 0, p.bgDim, p.picCol],
});
// the rings' centre comes from the x/y params (so the stage handle can place it)
ringrows.create = ((orig) => (ctx) => {
  const inst = orig(ctx);
  const draw = inst.draw;
  inst.draw = (c) => { c = { ...c }; const p = c.params; inst.st.cx = p.x; inst.st.cy = p.y; draw(c); };
  return inst;
})(ringrows.create);

// ---------------------------------------------------------------- parallax --
// The flat picture given depth and a camera that drifts. Depth is guessed
// from the picture itself — the bottom of a frame is nearer than the top,
// dark and hazy areas read as far, sharp bright detail as near — blurred into
// a plausible relief; the lookup then walks that relief a few steps so near
// things slide over far things instead of tearing.
const PARALLAX_FS = `
uniform float uAmount;
uniform float uSpeed;
uniform float uVertical;
uniform float uLumaDepth;
uniform float uZoom;
uniform float uFocus;
uniform sampler2D uDepth;   // Depth Anything, near = bright, when uHasDepth
uniform float uHasDepth;
uniform float uDepthMix;    // how much of the model's map to use against the guess
float guessDepth(vec2 uv){
  // 0 = far, 1 = near
  vec3 c = vec3(0.0);
  vec2 e = 6.0 / uSize;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) c += picClamp(uv + vec2(float(i), float(j)) * e);
  c /= 25.0;
  float l = luma(c);
  float sat_ = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
  float fromLuma = mix(0.5, l, uLumaDepth) * 0.6 + sat_ * 0.4;
  float fromY = (1.0 - uv.y) * uVertical;          // low in the frame is near
  return sat(fromY * 0.6 + fromLuma * 0.6);
}
float depthAt(vec2 uv){
  float g = guessDepth(uv);
  if (uHasDepth < 0.5) return g;
  // the map is small: a 4-tap blur keeps its edges from stepping
  vec2 e = vec2(1.0 / 160.0, 1.0 / 90.0) * 0.5;
  float m = (texture(uDepth, uv + e).r + texture(uDepth, uv - e).r + texture(uDepth, uv + vec2(e.x, -e.y)).r + texture(uDepth, uv - vec2(e.x, -e.y)).r) * 0.25;
  return mix(g, m, uDepthMix);
}
void main(){
  vec2 uv = vUV;
  vec3 bg = texture(uBg, uv).rgb;
  vec2 cam = uCentre - 0.5;                       // the camera offset: pointer or drift
  // the drift swings the camera a good way across (a fifth of the frame side to side, less up and down)
  cam += vec2(sin(uTime * uSpeed * 0.7), cos(uTime * uSpeed * 0.5)) * vec2(0.22, 0.12) * step(0.001, uSpeed);
  // near and far separate by this much of the frame at full camera offset: ~40 px on 1080p at the default
  vec2 shift = cam * uAmount * 0.16;
  // a hint of dolly: zoom in with the depth
  vec2 p = (uv - 0.5) * (1.0 - uZoom * 0.03 * (0.5 + 0.5 * sin(uTime * uSpeed * 0.3))) + 0.5;
  // parallax mapping: march the relief
  vec2 q = p - shift * 0.5;
  for (int i = 0; i < 8; i++) {
    float d = depthAt(q);
    q = p - shift * (d - 0.5);
  }
  vec3 col = picClamp(q);
  // a touch of depth of field: far things soften
  float d = depthAt(q);
  if (uFocus > 0.0) {
    vec2 e = uFocus * 3.0 * (1.0 - d) / uSize;
    col = (col + picClamp(q + vec2(e.x, 0.0)) + picClamp(q - vec2(e.x, 0.0)) + picClamp(q + vec2(0.0, e.y)) + picClamp(q - vec2(0.0, e.y))) / 5.0;
  }
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const parallax = postEffect({
  type: 'parallax', label: 'Parallax camera', group: 'Generative',
  hint: 'The flat picture given depth — read by Depth Anything running on this Mac, or guessed from the picture — and a camera that drifts around it so near things slide over far things. Follows the pointer if you let it.',
  actions: [],
  params: [
    S('depth', 'Depth from', 'model', [['model', 'Depth Anything (a model on this Mac)'], ['guess', 'A guess from the picture']]),
    R('amount', 'Depth', 0.8, 0, 3),
    R('speed', 'Camera drift', 0.6, 0, 3),
    R('vertical', 'Floor is near', 0.7, 0, 1),
    R('lumaDepth', 'Bright is near', 0.6, 0, 1),
    R('zoom', 'Dolly', 0.5, 0, 1),
    R('focus', 'Depth of field', 0.4, 0, 2),
    R('x', 'Camera x', 0.5, 0, 1), R('y', 'Camera y', 0.5, 0, 1),
    R('drift', 'Drift', 0, 0, 2),
    B('followPointer', 'Camera at the pointer', true),
  ],
}, PARALLAX_FS, {
  centre: true,
  init(ctx) {
    const gl = ctx.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { gl, depthTex: tex, hasDepth: false, depthAt: 0, mix: 0 };
  },
  // the control window's depth source sends maps as they come due
  action(st, name, arg) {
    if (name !== 'depth' || !arg || !arg.data) return;
    const gl = st.gl;
    const bin = atob(arg.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    gl.bindTexture(gl.TEXTURE_2D, st.depthTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);      // rows arrive top-down, uv runs up
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, arg.w, arg.h, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    st.hasDepth = true; st.depthAt = st.t;
  },
  step(st, dt, w, p) {
    // ease the map in when it starts arriving, and out if it stops (a cut, the model gone)
    const want = st.hasDepth && p.depth !== 'guess' && st.t - st.depthAt < 3 ? 1 : 0;
    st.mix += (want - st.mix) * Math.min(1, dt * 3);
  },
  uniforms(gl, u, p, st) {
    gl.uniform1f(u.uAmount, p.amount); gl.uniform1f(u.uSpeed, p.speed); gl.uniform1f(u.uVertical, p.vertical); gl.uniform1f(u.uLumaDepth, p.lumaDepth); gl.uniform1f(u.uZoom, p.zoom); gl.uniform1f(u.uFocus, p.focus);
    bindTex(gl, 2, st.depthTex, u.uDepth);
    gl.uniform1f(u.uHasDepth, st.hasDepth ? 1 : 0);
    gl.uniform1f(u.uDepthMix, st.mix);
  },
  dispose(st) { st.gl.deleteTexture(st.depthTex); },
});

// ---------------------------------------------------------------- circular --
// Circles packed over the wall, each turning its own copy of the picture,
// their sizes breathing with the film. (Circular)
const CIRCULAR_FS = `
uniform float uCells;
uniform float uSpin;
uniform float uJitter;
uniform float uDark;
uniform float uBreathe;
void main(){
  vec2 uv = vUV;
  vec3 bg = texture(uBg, uv).rgb;
  vec2 A = vec2(1.0, uAspect);
  vec2 g = uv * A * uCells;
  vec2 base = floor(g);
  vec3 col = bg * (1.0 - uDark);
  float best = 1e3; vec2 bestC = vec2(0.0); float bestR = 0.0; vec2 bestCell = vec2(0.0);
  // the nearest jittered centre, and its inscribed radius
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 cell = base + vec2(float(i), float(j));
    vec2 c = cell + 0.5 + (hash22(cell) - 0.5) * uJitter;
    float d = length(g - c);
    if (d < best) { best = d; bestC = c; bestCell = cell; }
  }
  // radius: half the distance to the nearest other centre, breathing with the picture
  float rr = 1e3;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    if (i == 0 && j == 0) continue;
    vec2 cell = bestCell + vec2(float(i), float(j));
    vec2 c = cell + 0.5 + (hash22(cell) - 0.5) * uJitter;
    rr = min(rr, length(c - bestC));
  }
  vec2 cuv = bestC / (A * uCells);
  float l = luma(texture(uBg, cuv).rgb);
  float r = rr * 0.5 * (0.7 + 0.3 * mix(1.0, l * 1.5, uBreathe));
  if (best < r) {
    vec2 f = rot2(uTime * uSpin * (hash11(dot(bestCell, vec2(1.0, 57.0))) - 0.5) * 2.0) * (g - bestC);
    vec3 pc = pic(cuv + f / (A * uCells));
    float rim = smoothstep(r - 0.06, r, best);
    col = mix(pc, pc * 0.4, rim);
  }
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const circular = postEffect({
  type: 'circular', label: 'Circular', group: 'Generative',
  hint: 'Circles packed over the wall, each turning its own copy of the picture at its own speed, their sizes breathing with the film.',
  actions: [],
  params: [
    R('cells', 'Circles across', 10, 3, 40, 1),
    R('spin', 'Spin', 0.5, -3, 3, 0.05),
    R('jitter', 'Irregularity', 0.6, 0, 1),
    R('breathe', 'Breathe with the picture', 0.6, 0, 1),
    R('dark', 'Darken between', 0.85, 0, 1),
  ],
}, CIRCULAR_FS, {
  uniforms(gl, u, p) { gl.uniform1f(u.uCells, Math.round(p.cells)); gl.uniform1f(u.uSpin, p.spin); gl.uniform1f(u.uJitter, p.jitter); gl.uniform1f(u.uDark, p.dark); gl.uniform1f(u.uBreathe, p.breathe); },
});

// -------------------------------------------------------------------- dust --
// The picture dissolves into grains that drift away, then gathers itself
// again. (Ascent / Impermanence)
const DUST_FS = `
uniform float uCycle;
uniform float uRise;
uniform float uGrain;
uniform float uSpread;
uniform float uHold;
void main(){
  vec2 uv = vUV;
  vec3 bg = texture(uBg, uv).rgb;
  float ph = fract(uTime / uCycle);
  // hold, dissolve, gone, gather
  float diss = ph < uHold ? 0.0 : ph < 0.5 + uHold * 0.5 ? (ph - uHold) / (0.5 - uHold * 0.5) : 1.0 - (ph - 0.5 - uHold * 0.5) / (0.5 - uHold * 0.5);
  diss = sat(diss);
  vec2 cell = floor(uv * uSize / uGrain);
  float h = hash12(cell);
  float n = fbm(uv * 4.0 + 3.0, 3);
  float gone = smoothstep(diss - 0.25, diss + 0.05, h * 0.6 + n * 0.4);   // this grain has left
  // where a leaving grain's colour comes from: further back along its flight
  vec2 flight = vec2((hash12(cell + 7.0) - 0.5) * uSpread, -uRise) * diss * diss * 0.35 * (0.5 + h);
  vec3 src = picClamp(uv - flight);
  vec3 col = mix(bg, vec3(0.0), gone);
  // the flying grain itself
  float flying = gone * (1.0 - smoothstep(0.4, 1.0, diss)) * (0.6 + 0.4 * hash12(cell + floor(uTime * 20.0)));
  col += src * flying * 0.9;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const dust = postEffect({
  type: 'dust', label: 'Dust', group: 'Generative',
  hint: 'The picture dissolves into grains that drift up and away, then gathers itself again, on a cycle.',
  actions: [],
  params: [
    R('cycle', 'Cycle (s)', 12, 2, 60, 0.5),
    R('hold', 'Hold', 0.2, 0, 0.45, 0.01),
    R('rise', 'Rise', 1, -2, 2, 0.05),
    R('spread', 'Spread', 0.6, 0, 2),
    R('grain', 'Grain (px)', 6, 1, 24, 1),
  ],
}, DUST_FS, {
  uniforms(gl, u, p) { gl.uniform1f(u.uCycle, p.cycle); gl.uniform1f(u.uRise, p.rise); gl.uniform1f(u.uGrain, p.grain); gl.uniform1f(u.uSpread, p.spread); gl.uniform1f(u.uHold, p.hold); },
});

// -------------------------------------------------------------------- bars --
// The picture as columns of bars, an equaliser that reads the film's
// brightness and, if you link it, the sound.
const BARS_FS = `
uniform float uCols;
uniform float uGap;
uniform float uGain;
uniform float uSegments;
uniform float uDark;
uniform vec3 uCol;
uniform float uPicCol;
void main(){
  vec2 uv = vUV;
  vec3 bg = texture(uBg, uv).rgb;
  float cx = floor(uv.x * uCols);
  float fx = fract(uv.x * uCols);
  // the column's height: mean brightness of the picture in that column
  float h = 0.0;
  for (int i = 0; i < 12; i++) h += luma(texture(uBg, vec2((cx + 0.5) / uCols, (float(i) + 0.5) / 12.0)).rgb);
  h = sat(h / 12.0 * uGain);
  float inBar = step(uGap * 0.5, fx) * step(fx, 1.0 - uGap * 0.5) * step(uv.y, h);
  float seg = uSegments > 0.0 ? step(0.15, fract(uv.y * uSegments)) : 1.0;
  vec3 bc = mix(uCol, texture(uBg, vec2((cx + 0.5) / uCols, uv.y)).rgb * 1.5, uPicCol);
  bc *= 0.6 + 0.6 * (uv.y / max(h, 1e-3));
  // a peak cap
  float cap = step(h - 0.012, uv.y) * step(uv.y, h) * step(uGap * 0.5, fx) * step(fx, 1.0 - uGap * 0.5);
  vec3 col = mix(bg * (1.0 - uDark), bc, inBar * seg);
  col += vec3(1.0) * cap * 0.8;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const bars = postEffect({
  type: 'bars', label: 'Bar field', group: 'Generative',
  hint: 'The picture as columns of bars whose heights read the film’s brightness: an equaliser made of the video. Link Gain to the sound.',
  actions: [],
  params: [
    R('cols', 'Columns', 48, 8, 160, 1),
    R('gap', 'Gap', 0.25, 0, 0.8),
    R('gain', 'Gain', 1.4, 0, 4),
    R('segments', 'Segments', 24, 0, 80, 1),
    R('dark', 'Darken', 0.85, 0, 1),
    C('col', 'Colour', '#4be3ff'),
    R('picCol', 'Colour from the picture', 0.6, 0, 1),
  ],
}, BARS_FS, {
  uniforms(gl, u, p, st, c, color) { gl.uniform1f(u.uCols, Math.round(p.cols)); gl.uniform1f(u.uGap, p.gap); gl.uniform1f(u.uGain, p.gain); gl.uniform1f(u.uSegments, Math.round(p.segments)); gl.uniform1f(u.uDark, p.dark); color('uCol', p.col); gl.uniform1f(u.uPicCol, p.picCol); },
});

// ----------------------------------------------------------------- etching --
// Cross-hatching by brightness: the film engraved, hatch directions turning
// with the picture's contours.
const ETCH_FS = `
uniform float uPitch;
uniform float uLevels;
uniform float uFollow;
uniform float uPaper;
uniform vec3 uInk;
void main(){
  vec2 uv = vUV;
  vec3 bg = texture(uBg, uv).rgb;
  // a smoothed brightness, so the hatch follows the big shapes, not the grain
  vec2 e = 24.0 / uSize;
  float l = 0.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) l += luma(picClamp(uv + vec2(float(i), float(j)) * e * 0.35));
  l /= 25.0;
  vec2 g = vec2(luma(picClamp(uv + vec2(e.x, 0.0))) - luma(picClamp(uv - vec2(e.x, 0.0))),
                luma(picClamp(uv + vec2(0.0, e.y))) - luma(picClamp(uv - vec2(0.0, e.y))));
  float ang = (length(g) > 0.02 ? atan(g.y, g.x) : 0.6) * uFollow;
  vec2 p = (uv - 0.5) * vec2(1.0, uAspect) * uPitch * 220.0;
  float ink = 0.0;
  // darker areas get more hatch directions
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uLevels) break;
    float thr = 1.0 - (float(i) + 1.0) / (uLevels + 1.0);
    if (l > thr) break;
    float a = ang + float(i) * 0.78 + 0.4;
    float line = 0.5 + 0.5 * sin(dot(p, vec2(cos(a), sin(a))));
    float w = sat((thr - l) * 4.0);
    ink = max(ink, smoothstep(0.6 - 0.4 * w, 0.75, line));
  }
  vec3 paper = mix(bg, vec3(0.93, 0.9, 0.84), uPaper);
  vec3 col = mix(paper, uInk, ink);
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const etching = postEffect({
  type: 'etching', label: 'Etching', group: 'Generative',
  hint: 'The film engraved: cross-hatching by brightness, the hatch turning with the picture’s contours, on paper or over the picture.',
  actions: [],
  params: [
    R('pitch', 'Line pitch', 1, 0.3, 3),
    R('levels', 'Hatch levels', 3, 1, 4, 1),
    R('follow', 'Follow the contours', 0.5, 0, 1),
    R('paper', 'Paper', 0.8, 0, 1),
    C('ink', 'Ink', '#1b1a26'),
  ],
}, ETCH_FS, {
  uniforms(gl, u, p, st, c, color) { gl.uniform1f(u.uPitch, p.pitch); gl.uniform1f(u.uLevels, Math.round(p.levels)); gl.uniform1f(u.uFollow, p.follow); gl.uniform1f(u.uPaper, p.paper); color('uInk', p.ink); },
});

// ------------------------------------------------------------- polyhedra --
// Platonic wireframes turning over the wall, their edges lit by the picture. (Platonic)
const POLY_FS = `
uniform float uSize_;
uniform float uSpin;
uniform float uCount;
uniform float uWeight;
uniform vec3 uCol;
uniform float uPicCol;
uniform float uDark;
uniform float uSolid;
vec3 rotv(vec3 v, float a, float b){ v.yz = rot2(a) * v.yz; v.xz = rot2(b) * v.xz; return v; }
float segD(vec2 p, vec2 a, vec2 b){ vec2 ab = b - a; float t = sat(dot(p - a, ab) / max(dot(ab, ab), 1e-6)); return length(p - (a + ab * t)); }
void main(){
  vec2 uv = vUV;
  vec3 bg = texture(uBg, uv).rgb;
  vec2 P = (uv - 0.5) * vec2(1.0, uAspect);
  vec3 col = bg * (1.0 - uDark);
  float edges = 0.0;
  int solid = int(uSolid);
  for (int k = 0; k < 3; k++) {
    if (float(k) >= uCount) break;
    float fk = float(k);
    vec2 c = uCount > 1.0 ? vec2(-0.3 + 0.3 * fk, 0.0) : vec2(0.0);
    float s = uSize_ * (0.14 - 0.02 * fk);
    float a = uTime * uSpin * (0.4 + 0.15 * fk) + fk, b = uTime * uSpin * (0.27 + 0.1 * fk) * 0.8;
    // vertices
    vec3 v[8];
    int n = 0;
    int kind = (solid + k) % 3;
    if (kind == 0) { for (int i = 0; i < 8; i++) v[i] = vec3(float(i & 1) * 2.0 - 1.0, float((i >> 1) & 1) * 2.0 - 1.0, float((i >> 2) & 1) * 2.0 - 1.0); n = 8; }
    else if (kind == 1) { v[0] = vec3(1, 0, 0); v[1] = vec3(-1, 0, 0); v[2] = vec3(0, 1, 0); v[3] = vec3(0, -1, 0); v[4] = vec3(0, 0, 1); v[5] = vec3(0, 0, -1); n = 6; }
    else { v[0] = vec3(1, 1, 1); v[1] = vec3(1, -1, -1); v[2] = vec3(-1, 1, -1); v[3] = vec3(-1, -1, 1); n = 4; }
    // project
    vec2 q[8];
    for (int i = 0; i < 8; i++) { if (i >= n) break; vec3 r = rotv(v[i], a, b); q[i] = c + r.xy * s / (1.0 + r.z * 0.25); }
    for (int i = 0; i < 8; i++) { if (i >= n) break;
      for (int j = i + 1; j < 8; j++) { if (j >= n) break;
        // an edge where two vertices are neighbours on the solid
        float dd = length(v[i] - v[j]);
        bool edge = (kind == 0 && abs(dd - 2.0) < 0.01) || (kind == 1 && abs(dd - 1.41421) < 0.01) || (kind == 2);
        if (!edge) continue;
        edges = max(edges, 1.0 - smoothstep(0.0, uWeight * 0.004, segD(P, q[i], q[j])));
      }
    }
  }
  vec3 lc = mix(uCol, bg * 2.0, uPicCol);
  col = mix(col, lc, edges);
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;
export const polyhedra = postEffect({
  type: 'polyhedra', label: 'Platonic', group: 'Generative',
  hint: 'Wireframe cube, octahedron and tetrahedron turning over the wall, their edges lit by the picture behind them.',
  actions: [],
  params: [
    R('size', 'Size', 2, 0.5, 5),
    R('spin', 'Spin', 0.5, -3, 3, 0.05),
    R('count', 'Solids', 1, 1, 3, 1),
    S('solid', 'First solid', '0', [['0', 'Cube'], ['1', 'Octahedron'], ['2', 'Tetrahedron']]),
    R('weight', 'Line weight', 1, 0.3, 4),
    C('col', 'Colour', '#ffffff'),
    R('picCol', 'Colour from the picture', 0.3, 0, 1),
    R('dark', 'Darken', 0.4, 0, 1),
  ],
}, POLY_FS, {
  uniforms(gl, u, p, st, c, color) { gl.uniform1f(u.uSize_, p.size); gl.uniform1f(u.uSpin, p.spin); gl.uniform1f(u.uCount, Math.round(p.count)); gl.uniform1f(u.uWeight, p.weight); color('uCol', p.col); gl.uniform1f(u.uPicCol, p.picCol); gl.uniform1f(u.uDark, p.dark); gl.uniform1f(u.uSolid, Number(p.solid)); },
});
