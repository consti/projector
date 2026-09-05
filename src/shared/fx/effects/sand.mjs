// Sand as a falling-sand automaton on the GPU: half a million cells, each
// either empty, a grain, or part of one of your shapes. Every substep a grain
// drops one cell if it can, otherwise slides diagonally with a probability
// that sets the angle of repose. Grains are two output pixels wide, so a heap
// reads as sand rather than as a pile of balls.
//
// A heap can only shed grains from the edge of its top, one per side per
// substep, so the source has to be a thin trickle — an hourglass neck, not a
// bucket — or the sand simply stacks into a pillar the width of the stream.
// Emission therefore places a handful of individual grains per substep and
// the fall runs at eight or more substeps a frame so the trickle still reads
// as a steady pour.

import { prog, bindTex, BLEND, hexRgb, PingPong, VS_SCREEN } from '../glu.mjs';
import { R, C, S, B } from './common.mjs';

const MAX_INTER = 8;
const MAX_EMIT = 24;

// The state texture: r = 1 for a grain, g = the grain's tone (fixed at birth so
// the colour travels with it), b = its age (rises once it has come to rest).
const CA_FS = `#version 300 es
precision highp float;
#include <hash>
in vec2 vUV;
uniform sampler2D uState;
uniform sampler2D uSdf;
uniform vec2 uTexel;
uniform ivec2 uSize;
uniform float uBias;        // share of grains that slide to the right (wind)
uniform float uSeed;
uniform float uSlide;       // probability a blocked grain slides
uniform vec4 uInter[${MAX_INTER}];   // x, y (uv), radius, unused
uniform int uNInter;
uniform float uAspect;
uniform int uDrain;         // 1: the floor is open and grains fall out
out vec4 o;

bool inHand(vec2 uv){
  for (int i = 0; i < ${MAX_INTER}; i++) {
    if (i >= uNInter) break;
    vec2 d = (uv - uInter[i].xy) * vec2(1.0, uAspect);
    if (dot(d, d) < uInter[i].z * uInter[i].z) return true;
  }
  return false;
}
// 0 empty, 1 grain, 2 solid (shape, outside the frame, or an empty cell a hand
// is covering — a grain already under the hand stays a grain, so hands push
// sand about instead of deleting it)
int typeAt(ivec2 c){
  if (c.x < 0 || c.x >= uSize.x) return 2;
  if (c.y < 0) return uDrain > 0 ? 0 : 2;     // the floor, or a drain
  if (c.y >= uSize.y) return 0;               // open sky above the frame
  vec2 uv = (vec2(c) + 0.5) * uTexel;
  if (texture(uSdf, uv).r < 0.0) return 2;
  if (texelFetch(uState, c, 0).r > 0.5) return 1;
  return inHand(uv) ? 2 : 0;
}
bool slideGeom(ivec2 g, int d){
  // a blocked grain can slide to the diagonal if that cell and the one beside
  // it are free (the cell beside is where a falling grain would come from)
  if (typeAt(g + ivec2(0, -1)) == 0) return false;
  if (typeAt(g + ivec2(d, -1)) != 0) return false;
  if (typeAt(g + ivec2(d, 0)) != 0) return false;
  return true;
}
// Which way a grain slides this substep: -1, +1, or 0 to stay. A grain that is
// already moving (age 0) keeps rolling, so an avalanche runs down the whole
// slope instead of stopping after one cell; the dice only decide when a
// resting grain starts to move, which is what sets the angle of repose. Every
// grain picks its own side, so both flanks of a heap shed at once.
int pickRaw(ivec2 g){
  bool moving = texelFetch(uState, g, 0).b < 0.002;
  if (!moving && hash12(vec2(g) + uSeed) >= uSlide) return 0;
  int d = hash12(vec2(g) * 1.37 + uSeed + 7.0) < uBias ? 1 : -1;
  if (!slideGeom(g, d)) d = -d;
  if (!slideGeom(g, d)) return 0;
  return d;
}
// the left-hand candidate wins a contested cell, so a right-mover yields to it
int pick(ivec2 g){
  int d = pickRaw(g);
  if (d == -1) {
    ivec2 other = g + ivec2(-2, 0);
    if (typeAt(other) == 1 && pickRaw(other) == 1) return 0;
  }
  return d;
}
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  int me = typeAt(c);
  if (me == 2) { o = vec4(0.0); return; }
  vec4 cur = texelFetch(uState, c, 0);
  if (me == 1) {
    if (typeAt(c + ivec2(0, -1)) == 0) { o = vec4(0.0); return; }   // falls
    if (pick(c) != 0) { o = vec4(0.0); return; }                    // slides away
    o = vec4(1.0, cur.g, min(cur.b + 0.004, 1.0), 1.0);            // at rest: age
    return;
  }
  // empty: does a grain arrive from above, or slide in from an upper diagonal?
  ivec2 up = c + ivec2(0, 1);
  if (typeAt(up) == 1) { vec4 s = texelFetch(uState, up, 0); o = vec4(1.0, s.g, 0.0, 1.0); return; }
  ivec2 ul = c + ivec2(-1, 1);
  if (typeAt(ul) == 1 && pick(ul) == 1) { vec4 s = texelFetch(uState, ul, 0); o = vec4(1.0, s.g, 0.0, 1.0); return; }
  ivec2 ur = c + ivec2(1, 1);
  if (typeAt(ur) == 1 && pick(ur) == -1) { vec4 s = texelFetch(uState, ur, 0); o = vec4(1.0, s.g, 0.0, 1.0); return; }
  o = vec4(0.0);
}`;

// One pass drops up to MAX_EMIT small clusters of grains at once.
const EMIT_FS = `#version 300 es
precision highp float;
#include <hash>
in vec2 vUV;
uniform sampler2D uState;
uniform sampler2D uSdf;
uniform vec4 uPts[${MAX_EMIT}];   // x, y (uv), radius (uv x units), density
uniform int uN;
uniform float uSeed;
uniform float uAspect;
uniform float uMixTone;
out vec4 o;
void main(){
  vec4 cur = texture(uState, vUV);
  o = cur;
  if (cur.r > 0.5 || texture(uSdf, vUV).r < 0.0) return;
  for (int i = 0; i < ${MAX_EMIT}; i++) {
    if (i >= uN) break;
    vec2 d = (vUV - uPts[i].xy) * vec2(1.0, uAspect);
    if (dot(d, d) > uPts[i].z * uPts[i].z) continue;
    if (hash12(gl_FragCoord.xy + uSeed + float(i) * 7.1) > uPts[i].w) continue;
    float tone = hash12(gl_FragCoord.yx * 1.7 + uSeed);
    // two-colour sand: most grains near one colour, a share near the other
    tone = hash12(gl_FragCoord.xy * 0.37 + uSeed * 3.0) < uMixTone ? 0.75 + 0.25 * tone : 0.25 * tone;
    o = vec4(1.0, tone, 0.0, 1.0);
    return;
  }
}`;

const DRAW_FS = `#version 300 es
precision highp float;
#include <common>
#include <hash>
in vec2 vUV;
uniform sampler2D uState;
uniform vec2 uTexel;
uniform vec3 uC1; uniform vec3 uC2;
uniform vec2 uLight;
uniform float uOpacity;
uniform float uWet;
out vec4 o;
float grain(vec2 uv){ return texture(uState, uv).r; }
void main(){
  vec4 s = texture(uState, vUV);
  if (s.r < 0.5) { o = vec4(0.0); return; }
  vec3 base = mix(uC1, uC2, s.g);
  // the exposed surface of a heap is lit, buried grains sit in shade
  float upE = 1.0 - grain(vUV + vec2(0.0, uTexel.y));
  float lE = 1.0 - grain(vUV - vec2(uTexel.x, 0.0));
  float rE = 1.0 - grain(vUV + vec2(uTexel.x, 0.0));
  float dnE = 1.0 - grain(vUV - vec2(0.0, uTexel.y));
  float up2 = 1.0 - grain(vUV + vec2(0.0, 2.0 * uTexel.y));
  vec2 n = normalize(vec2(rE - lE, upE - dnE) + vec2(0.0, 1e-3));
  float exposed = max(max(upE, lE), rE);
  float surface = max(exposed, up2 * 0.5);
  // grains in flight are lighter and sharper than the settled heap
  float flying = 1.0 - sat(s.b * 40.0);
  float lit = 0.55 + 0.3 * surface + 0.3 * surface * max(dot(n, uLight), 0.0) + 0.15 * flying;
  // buried sand darkens a little, as if damp
  lit *= 1.0 - uWet * 0.35 * (1.0 - surface) * sat(s.b * 3.0);
  // per-grain sparkle and tone jitter so a heap reads as thousands of grains
  float j = 0.82 + 0.36 * hash12(floor(vUV / uTexel));
  vec3 col = base * lit * j;
  col += vec3(1.0, 0.95, 0.8) * pow(max(dot(n, uLight), 0.0), 8.0) * exposed * 0.3;
  o = vec4(col * uOpacity, uOpacity);
}`;

export default {
  type: 'sand',
  label: 'Sand',
  group: 'Physics',
  blend: 'over',
  hint: 'A thin trickle of sand pours, slides and heaps at a real angle of repose on the floor and on every shape.',
  actions: [{ name: 'pour', label: 'Pour a scoop' }, { name: 'clear', label: 'Clear' }],
  params: [
    R('rate', 'Flow', 1.5, 0, 5, 0.05),
    S('from', 'Pours from', 'stream', [['stream', 'One stream'], ['streams', 'Three streams'], ['rain', 'Everywhere along the top'], ['pointer', 'The pointer']]),
    R('x', 'Stream position', 0.5, 0, 1),
    R('spread', 'Stream width', 0.014, 0.002, 0.08, 0.001),
    C('color', 'Colour', '#e3c48a'),
    C('color2', 'Second colour', '#a8783f'),
    R('mix', 'Colour mix', 0.35, 0, 1),
    R('repose', 'Steepness', 0.55, 0.05, 1),
    R('speed', 'Fall speed', 12, 2, 24, 1),
    R('wet', 'Damp look', 0.5, 0, 1),
    R('lightAngle', 'Light angle', 235, 0, 360, 1),
    B('drain', 'Drain through the floor', false),
  ],

  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const prCA = prog(gl, VS_SCREEN, CA_FS);
    const prEmit = prog(gl, VS_SCREEN, EMIT_FS);
    const prDraw = prog(gl, VS_SCREEN, DRAW_FS);
    const cols = Math.round(ctx.quality.grid * 2.5);
    let state = null, W = 0, H = 0, aspect = 0;
    const inter = new Float32Array(MAX_INTER * 4);
    const pts = new Float32Array(MAX_EMIT * 4);
    const c1 = [0, 0, 0], c2 = [0, 0, 0];
    let frame = 0, pending = [], emitAcc = 0;

    const ensure = (a) => {
      const h = Math.max(16, Math.round(cols * a));
      if (state && W === cols && H === h) return;
      if (state) state.dispose();
      state = new PingPong(gl, cols, h, 'rgba8', { nearest: true });
      state.a.bind([0, 0, 0, 0]); state.b.bind([0, 0, 0, 0]);
      W = cols; H = h; aspect = a;
    };

    // one emission pass for a list of {x, y, r, d}
    const emit = (list, sdfTex, mixTone) => {
      const n = Math.min(list.length, MAX_EMIT);
      if (!n) return;
      for (let i = 0; i < n; i++) {
        const e = list[i];
        pts[i * 4] = e.x; pts[i * 4 + 1] = e.y; pts[i * 4 + 2] = e.r; pts[i * 4 + 3] = e.d;
      }
      prEmit.use();
      bindTex(gl, 0, state.read.tex, prEmit.u.uState);
      bindTex(gl, 1, sdfTex, prEmit.u.uSdf);
      gl.uniform4fv(prEmit.u.uPts, pts);
      gl.uniform1i(prEmit.u.uN, n);
      gl.uniform1f(prEmit.u.uSeed, rng.next() * 100);
      gl.uniform1f(prEmit.u.uAspect, aspect);
      gl.uniform1f(prEmit.u.uMixTone, mixTone);
      gl.disable(gl.BLEND);
      state.write.bind();
      ctx.screen.draw();
      state.swap();
    };

    const cell = () => 1 / W;       // one cell in uv x units

    return {
      resize() {},
      action(name, arg, w, p) {
        ensure(w.aspect);
        if (name === 'clear') { state.a.bind([0, 0, 0, 0]); state.b.bind([0, 0, 0, 0]); return; }
        // a scoop: a compact cluster that spreads into a heap as it lands
        const x = p.from === 'rain' || p.from === 'streams' ? rng.range(0.1, 0.9) : p.x;
        pending.push({ x: x + rng.gauss() * 0.01, y: 0.96, r: 0.012, d: 0.75 });
      },
      step(dt, w, p) {
        ensure(w.aspect);
        const sdf = w.sdfTex;
        if (!sdf) return;
        const sub = Math.max(1, Math.round(p.speed));
        // interactors are solid hands the sand has to flow around
        let ni = 0;
        for (const it of w.interactors) {
          if (ni >= MAX_INTER) break;
          inter[ni * 4] = it.x; inter[ni * 4 + 1] = 1 - it.y / w.aspect; inter[ni * 4 + 2] = (it.r || 0.05) * 0.8; ni++;
        }
        if (pending.length) { emit(pending, sdf, p.mix); pending.length = 0; }
        const list = [];
        for (let k = 0; k < sub; k++) {
          // emission: a few grains per substep, so the heap can keep up
          list.length = 0;
          if (p.rate > 0) {
            // a thin trickle: a heap can only carry away so much per substep
            emitAcc += p.rate * 0.12;
            let n = Math.floor(emitAcc); emitAcc -= n;
            const g = cell() * 1.2;                  // a grain and a bit
            if (p.from === 'stream') {
              for (let i = 0; i < n; i++) list.push({ x: p.x + rng.gauss() * p.spread * 0.5, y: 0.99, r: g, d: 1 });
            } else if (p.from === 'streams') {
              for (let i = 0; i < n; i++) {
                const s = (i + (frame % 3)) % 3;
                list.push({ x: 0.25 + 0.25 * s + rng.gauss() * p.spread * 0.5, y: 0.99, r: g, d: 1 });
              }
            } else if (p.from === 'rain') {
              n = Math.min(MAX_EMIT, n * 3);
              for (let i = 0; i < n; i++) list.push({ x: rng.next(), y: 0.99, r: g, d: 1 });
            } else {
              for (const it of w.interactors) if (it.down) {
                for (let i = 0; i < n; i++) list.push({ x: it.x + rng.gauss() * p.spread, y: 1 - it.y / w.aspect, r: g, d: 1 });
              }
            }
            if (list.length) emit(list, sdf, p.mix);
          }
          prCA.use();
          bindTex(gl, 0, state.read.tex, prCA.u.uState);
          bindTex(gl, 1, sdf, prCA.u.uSdf);
          gl.uniform2f(prCA.u.uTexel, 1 / W, 1 / H);
          gl.uniform2i(prCA.u.uSize, W, H);
          gl.uniform1i(prCA.u.uDrain, p.drain ? 1 : 0);
          // the wind leans the slides one way
          gl.uniform1f(prCA.u.uBias, Math.max(0.05, Math.min(0.95, 0.5 + (w.wind[0] || 0) * 0.4)));
          gl.uniform1f(prCA.u.uSeed, (frame % 1000) * 0.731);
          gl.uniform1f(prCA.u.uSlide, 1.05 - p.repose);
          gl.uniform4fv(prCA.u.uInter, inter);
          gl.uniform1i(prCA.u.uNInter, ni);
          gl.uniform1f(prCA.u.uAspect, w.aspect);
          gl.disable(gl.BLEND);
          state.write.bind();
          ctx.screen.draw();
          state.swap();
          frame++;
        }
      },
      draw(c) {
        if (!state) return;
        const p = c.params;
        hexRgb(p.color, c1); hexRgb(p.color2, c2);
        c.dst.bind();
        prDraw.use();
        bindTex(gl, 0, state.read.tex, prDraw.u.uState);
        gl.uniform2f(prDraw.u.uTexel, 1 / W, 1 / H);
        gl.uniform3f(prDraw.u.uC1, c1[0], c1[1], c1[2]);
        gl.uniform3f(prDraw.u.uC2, c2[0], c2[1], c2[2]);
        const a = (p.lightAngle * Math.PI) / 180;
        gl.uniform2f(prDraw.u.uLight, Math.cos(a), -Math.sin(a));
        gl.uniform1f(prDraw.u.uOpacity, c.opacity);
        gl.uniform1f(prDraw.u.uWet, p.wet);
        BLEND.over(gl);
        ctx.screen.draw();
        gl.disable(gl.BLEND);
      },
      dispose() { if (state) state.dispose(); },
    };
  },
};
