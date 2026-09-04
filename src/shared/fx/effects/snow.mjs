// Snow that actually settles. Flakes drift on a curl-noise wind, collide with
// the distance field, and where they land on an up-facing surface they are
// baked into a persistent depth texture — so the top edge of every painting
// and the back of the couch slowly grow a white crust that thickens while the
// film plays, and melts back if you ask it to.

import { prog, bindTex, Target, PingPong, BLEND, hexRgb, VS_SCREEN } from '../glu.mjs';
import { Particles, SpriteBatch, SPRITE_VS } from '../particles.mjs';
import { R, B, C, S, Emitter } from './common.mjs';

const ACC_VS = `#version 300 es
in vec2 iPos; in vec4 iCol; in vec4 iAttr;
out vec2 vLocal; out float vAmt;
uniform float uAspect;
void main(){
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vLocal = corner; vAmt = iCol.a;
  vec2 p = iPos + corner * iAttr.x;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - (p.y / uAspect) * 2.0, 0.0, 1.0);
}`;
const ACC_FS = `#version 300 es
precision highp float;
in vec2 vLocal; in float vAmt; out vec4 o;
void main(){
  float r2 = dot(vLocal, vLocal);
  if (r2 > 1.0) discard;
  o = vec4(vAmt * (1.0 - r2) * (1.0 - r2), 0.0, 0.0, 0.0);
}`;

const MELT_FS = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uTex; uniform float uMelt; uniform vec2 uTexel; uniform float uSettle;
out vec4 o;
void main(){
  float c = texture(uTex, vUV).r;
  // a touch of lateral diffusion so drifts round off instead of spiking
  float l = texture(uTex, vUV - vec2(uTexel.x, 0.0)).r;
  float r = texture(uTex, vUV + vec2(uTexel.x, 0.0)).r;
  float u = texture(uTex, vUV - vec2(0.0, uTexel.y)).r;
  float s = mix(c, (c * 2.0 + l + r + u) * 0.2, uSettle);
  o = vec4(max(0.0, s - uMelt), 0.0, 0.0, 1.0);
}`;

const FLAKE_FS = `#version 300 es
precision highp float;
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec2 vUV; in vec2 vCenter;
out vec4 o;
uniform float uOpacity;
void main(){
  float r = length(vLocal);
  if (r > 1.0) discard;
  // soft flake with a faint six-point sparkle
  float a = pow(1.0 - r, 1.6);
  float ang = atan(vLocal.y, vLocal.x);
  a += 0.35 * pow(max(0.0, cos(ang * 6.0)), 8.0) * (1.0 - r);
  a *= vCol.a * uOpacity;
  o = vec4(vCol.rgb * a, a);
}`;

const DRIFT_FS = `#version 300 es
precision highp float;
#include <common>
in vec2 vUV;
uniform sampler2D uBg;
uniform sampler2D uAcc;
uniform sampler2D uSdf;
uniform vec2 uTexel;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uHeight;
uniform vec2 uLight;
out vec4 o;
void main(){
  float d = texture(uAcc, vUV).r;
  float a = smoothstep(0.06, 0.45, d);
  vec3 bg = texture(uBg, vUV).rgb;
  if (a < 0.002) { o = vec4(bg, 1.0); return; }
  float l = texture(uAcc, vUV - vec2(uTexel.x, 0.0)).r;
  float r = texture(uAcc, vUV + vec2(uTexel.x, 0.0)).r;
  float dn = texture(uAcc, vUV - vec2(0.0, uTexel.y)).r;
  float up = texture(uAcc, vUV + vec2(0.0, uTexel.y)).r;
  vec3 n = normalize(vec3(-(r - l) * uHeight, -(up - dn) * uHeight, 0.35));
  vec3 L = normalize(vec3(uLight, 0.8));
  float diff = 0.55 + 0.45 * max(dot(n, L), 0.0);
  vec3 snow = uColor * diff + vec3(0.05, 0.07, 0.12) * (1.0 - diff);
  snow += pow(max(dot(n, L), 0.0), 24.0) * 0.5;
  o = vec4(mix(bg, snow, a * uOpacity), 1.0);
}`;

export default {
  type: 'snow',
  label: 'Snow',
  group: 'Weather',
  blend: 'post',
  hint: 'Flakes drift, collide and pile up on every up-facing edge.',
  actions: [{ name: 'clearSnow', label: 'Clear drifts' }, { name: 'blizzard', label: 'Gust' }],
  params: [
    R('rate', 'Flakes per second', 140, 0, 900, 5),
    R('size', 'Flake size', 0.0045, 0.001, 0.02, 0.0005),
    R('sizeVar', 'Size spread', 0.7, 0, 1),
    R('fall', 'Fall speed', 0.12, 0.01, 0.8),
    R('wind', 'Wind', 0.06, -1, 1),
    R('swirl', 'Swirl', 0.35, 0, 2),
    C('color', 'Colour', '#ffffff'),
    R('opacityFlake', 'Flake opacity', 0.9, 0, 1),
    B('accumulate', 'Let it settle', true),
    R('stick', 'Stickiness', 0.75, 0, 1),
    R('melt', 'Melt', 0.02, 0, 1),
    R('height', 'Drift relief', 1, 0, 3),
    R('lightAngle', 'Light angle', 240, 0, 360, 1),
  ],

  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const cap = Math.round(6000 * (ctx.quality.particles || 1));
    const P = new Particles(cap);
    const flakes = new SpriteBatch(gl, cap);
    const accBatch = new SpriteBatch(gl, 2048);
    const prFlake = prog(gl, SPRITE_VS, FLAKE_FS);
    const prAcc = prog(gl, ACC_VS, ACC_FS);
    const prMelt = prog(gl, VS_SCREEN, MELT_FS);
    const prDrift = prog(gl, VS_SCREEN, DRIFT_FS);
    let acc = null, accTmp = null, aw = 0, ah = 0;
    const emitter = new Emitter();
    const col = [1, 1, 1];
    const hits = [];
    let gust = 0;

    return {
      resize(w, h) {
        const sw = Math.max(64, Math.round(w * 0.5)), sh = Math.max(36, Math.round(h * 0.5));
        if (sw === aw && sh === ah) return;
        if (acc) { acc.dispose(); accTmp.dispose(); }
        aw = sw; ah = sh;
        acc = new Target(gl, sw, sh, 'r16f');
        accTmp = new Target(gl, sw, sh, 'r16f');
        acc.bind([0, 0, 0, 0]); accTmp.bind([0, 0, 0, 0]);
      },

      action(name) {
        if (name === 'clearSnow' && acc) { acc.bind([0, 0, 0, 0]); accTmp.bind([0, 0, 0, 0]); }
        if (name === 'blizzard') gust = 2.2;
      },

      step(dt, w, p) {
        if (gust > 0) gust = Math.max(0, gust - dt * 0.8);
        const n = emitter.tick(dt, p.rate);
        for (let i = 0; i < n; i++) {
          P.spawn({
            x: rng.range(-0.1, 1.1), y: -0.02 - rng.next() * 0.05,
            vx: rng.gauss() * 0.02, vy: p.fall * rng.range(0.6, 1.4),
            size: p.size * (1 + (rng.next() - 0.5) * p.sizeVar * 2),
            a: rng.range(0.5, 1), seed: rng.next(),
          });
        }
        hits.length = 0;
        P.step(dt, {
          field: w.field,
          gy: p.fall * 0.35,
          gx: (p.wind + gust * 0.5) * 0.6 + w.wind[0] * 0.3,
          drag: 2.6,
          bounce: 0.05,
          friction: 1.2,
          curl: p.swirl * (1 + gust),
          curlScale: 6,
          curlTime: w.time * 0.35,
          aspect: w.aspect,
          useRadius: true,
          onHit: (i, nx, ny) => {
            if (!p.accumulate) return;
            // only up-facing surfaces collect snow
            if (ny > -0.25) return;
            if (rng.next() > p.stick) return;
            hits.push(P.x[i], P.y[i], P.size[i]);
            P.kill(i);
          },
        });
        for (const it of w.interactors) {
          const r = it.r || 0.08, r2 = r * r;
          for (let i = 0; i < P.n; i++) {
            if (!P.alive[i]) continue;
            const dx = P.x[i] - it.x, dy = P.y[i] - it.y;
            if (dx * dx + dy * dy > r2) continue;
            P.vx[i] += (it.vx || 0) * 0.8 + dx * 3 * dt;
            P.vy[i] += (it.vy || 0) * 0.8 + dy * 3 * dt;
          }
        }
      },

      draw(c) {
        const p = c.params;
        if (!acc) return;
        hexRgb(p.color, col);

        // 1. bake new landings, then melt / settle the drift field
        if (p.accumulate) {
          if (hits.length) {
            acc.bind();
            BLEND.add(gl);
            const n = accBatch.fillFrom(hits.length / 3, (i, d, o) => {
              d[o] = hits[i * 3]; d[o + 1] = hits[i * 3 + 1];
              d[o + 2] = 1; d[o + 3] = 1; d[o + 4] = 1; d[o + 5] = 0.10;
              d[o + 6] = Math.max(0.006, hits[i * 3 + 2] * 2.4);
              d[o + 7] = 0; d[o + 8] = 1; d[o + 9] = 0;
            });
            prAcc.use();
            gl.uniform1f(prAcc.u.uAspect, c.aspect);
            accBatch.draw(prAcc);
            gl.disable(gl.BLEND);
            hits.length = 0;
          }
          prMelt.use();
          bindTex(gl, 0, acc.tex, prMelt.u.uTex);
          gl.uniform1f(prMelt.u.uMelt, p.melt * 0.002);
          gl.uniform1f(prMelt.u.uSettle, 0.22);
          gl.uniform2f(prMelt.u.uTexel, 1 / aw, 1 / ah);
          accTmp.bind(); ctx.screen.draw();
          const t = acc; acc = accTmp; accTmp = t;
        }

        // 2. drifts under the flakes
        c.dst.bind();
        gl.disable(gl.BLEND);
        prDrift.use();
        bindTex(gl, 0, c.src, prDrift.u.uBg);
        bindTex(gl, 1, acc.tex, prDrift.u.uAcc);
        bindTex(gl, 2, c.sdfTex, prDrift.u.uSdf);
        gl.uniform2f(prDrift.u.uTexel, 1 / aw, 1 / ah);
        gl.uniform3f(prDrift.u.uColor, col[0], col[1], col[2]);
        gl.uniform1f(prDrift.u.uOpacity, c.opacity);
        gl.uniform1f(prDrift.u.uHeight, p.height * 4);
        gl.uniform2f(prDrift.u.uLight, Math.cos(p.lightAngle * Math.PI / 180), -Math.sin(p.lightAngle * Math.PI / 180));
        ctx.screen.draw();

        // 3. the flakes themselves
        const n = flakes.fill(P, (i, d, o) => {
          d[o + 2] = col[0]; d[o + 3] = col[1]; d[o + 4] = col[2];
          d[o + 5] = P.a[i] * p.opacityFlake;
          d[o + 7] = P.seed[i] * 6.28;
        });
        if (!n) return;
        prFlake.use();
        gl.uniform1f(prFlake.u.uAspect, c.aspect);
        gl.uniform1f(prFlake.u.uSizeScale, 1);
        gl.uniform1f(prFlake.u.uOpacity, c.opacity);
        BLEND.over(gl);
        flakes.draw(prFlake);
        gl.disable(gl.BLEND);
      },

      dispose() { flakes.dispose(); accBatch.dispose(); if (acc) { acc.dispose(); accTmp.dispose(); } },
    };
  },
};
