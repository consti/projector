// Rain: streaks fall at an angle, break into splash crowns wherever they hit a
// shape or the floor, and leave a fading wet sheen behind.

import { prog, bindTex, Target, BLEND, hexRgb, VS_SCREEN } from '../glu.mjs';
import { Particles, SpriteBatch, SPRITE_VS } from '../particles.mjs';
import { R, B, C, S, Emitter } from './common.mjs';

const STREAK_VS = `#version 300 es
in vec2 iPos; in vec4 iCol; in vec4 iAttr;   // size(len), angle, width, seed
out vec2 vLocal; out vec4 vCol; out vec4 vAttr;
uniform float uAspect;
void main(){
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vLocal = corner; vCol = iCol; vAttr = iAttr;
  float c = cos(iAttr.y), s = sin(iAttr.y);
  vec2 off = vec2(corner.x * iAttr.z, corner.y * iAttr.x);
  vec2 rot = vec2(off.x * c - off.y * s, off.x * s + off.y * c);
  vec2 p = iPos + rot;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - (p.y / uAspect) * 2.0, 0.0, 1.0);
}`;

const STREAK_FS = `#version 300 es
precision highp float;
#include <common>
in vec2 vLocal; in vec4 vCol; in vec4 vAttr;
out vec4 o;
uniform float uOpacity;
void main(){
  float across = 1.0 - abs(vLocal.x);
  float along = 1.0 - abs(vLocal.y);
  float a = pow(across, 1.6) * smoothstep(0.0, 0.5, along) * vCol.a * uOpacity;
  o = vec4(vCol.rgb * a * 1.5, a);
}`;

const SPLASH_FS = `#version 300 es
precision highp float;
#include <common>
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec2 vUV; in vec2 vCenter;
out vec4 o;
uniform float uOpacity;
void main(){
  float r = length(vLocal);
  // an expanding ring, thinning as it grows
  float age = 1.0 - vAttr.z;
  float ring = exp(-pow((r - age) / max(0.08, 0.32 * (1.0 - age)), 2.0));
  float a = ring * vAttr.z * vCol.a * uOpacity;
  o = vec4(vCol.rgb * a * 1.4, a);
}`;

const WET_FS = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uBg; uniform sampler2D uWet; uniform float uAmt; uniform vec2 uTexel;
out vec4 o;
void main(){
  float w = texture(uWet, vUV).r;
  vec3 bg = texture(uBg, vUV).rgb;
  if (w < 0.003) { o = vec4(bg, 1.0); return; }
  float l = texture(uWet, vUV - vec2(uTexel.x, 0.0)).r;
  float r = texture(uWet, vUV + vec2(uTexel.x, 0.0)).r;
  float d = texture(uWet, vUV - vec2(0.0, uTexel.y)).r;
  float u = texture(uWet, vUV + vec2(0.0, uTexel.y)).r;
  vec2 g = vec2(r - l, u - d) * 3.0;
  vec3 c = texture(uBg, clamp(vUV + g * 0.01 * uAmt, vec2(0.0), vec2(1.0))).rgb;
  // wet surfaces read darker and shinier
  c *= mix(1.0, 0.82, min(1.0, w) * uAmt);
  c += pow(max(0.0, -g.y), 2.0) * 0.25 * uAmt;
  o = vec4(mix(bg, c, min(1.0, w * 2.0)), 1.0);
}`;

const DECAY_FS = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uTex; uniform float uK; out vec4 o;
void main(){ o = vec4(max(0.0, texture(uTex, vUV).r - uK), 0.0, 0.0, 1.0); }`;

const WET_SPLAT_VS = `#version 300 es
in vec2 iPos; in vec4 iCol; in vec4 iAttr;
out vec2 vLocal; out float vAmt;
uniform float uAspect;
void main(){
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vLocal = corner; vAmt = iCol.a;
  vec2 p = iPos + corner * iAttr.x;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - (p.y / uAspect) * 2.0, 0.0, 1.0);
}`;
const WET_SPLAT_FS = `#version 300 es
precision highp float;
in vec2 vLocal; in float vAmt; out vec4 o;
void main(){
  float r2 = dot(vLocal, vLocal);
  if (r2 > 1.0) discard;
  o = vec4(vAmt * (1.0 - r2), 0.0, 0.0, 0.0);
}`;

export default {
  type: 'rain',
  label: 'Rain',
  group: 'Weather',
  blend: 'post',
  hint: 'Angled streaks, splash crowns where they land, and a wet sheen that fades.',
  actions: [{ name: 'downpour', label: 'Downpour' }],
  params: [
    R('rate', 'Drops per second', 320, 0, 2000, 10),
    R('speed', 'Fall speed', 1.6, 0.2, 6),
    R('angle', 'Slant', 0.12, -1, 1),
    R('length', 'Streak length', 0.03, 0.004, 0.15, 0.001),
    R('width', 'Streak width', 0.0011, 0.0003, 0.006, 0.0001),
    C('color', 'Colour', '#cfe4ff'),
    R('opacityDrop', 'Streak opacity', 0.35, 0, 1),
    B('splash', 'Splashes', true),
    R('splashSize', 'Splash size', 0.016, 0.004, 0.08, 0.001),
    B('wet', 'Wet the wall', true),
    R('wetAmount', 'Wetness', 0.7, 0, 2),
    R('dry', 'Drying speed', 0.4, 0.02, 3),
  ],

  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const cap = Math.round(5000 * (ctx.quality.particles || 1));
    const P = new Particles(cap);
    const S2 = new Particles(1400);
    const streaks = new SpriteBatch(gl, cap);
    const splashes = new SpriteBatch(gl, 1400);
    const wetBatch = new SpriteBatch(gl, 1400);
    const prStreak = prog(gl, STREAK_VS, STREAK_FS);
    const prSplash = prog(gl, SPRITE_VS, SPLASH_FS);
    const prWet = prog(gl, VS_SCREEN, WET_FS);
    const prDecay = prog(gl, VS_SCREEN, DECAY_FS);
    const prWetSplat = prog(gl, WET_SPLAT_VS, WET_SPLAT_FS);
    const emitter = new Emitter();
    const col = [0, 0, 0];
    let wetA = null, wetB = null, ww = 0, wh = 0;
    const hits = [];
    let surge = 0;

    return {
      resize(w, h) {
        const sw = Math.max(64, Math.round(w * 0.4)), sh = Math.max(36, Math.round(h * 0.4));
        if (sw === ww && sh === wh) return;
        if (wetA) { wetA.dispose(); wetB.dispose(); }
        ww = sw; wh = sh;
        wetA = new Target(gl, sw, sh, 'r16f');
        wetB = new Target(gl, sw, sh, 'r16f');
        wetA.bind([0, 0, 0, 0]); wetB.bind([0, 0, 0, 0]);
      },
      action(name) { if (name === 'downpour') surge = 3; },
      step(dt, w, p) {
        if (surge > 0) surge = Math.max(0, surge - dt);
        const n = emitter.tick(dt, p.rate * (1 + surge));
        for (let i = 0; i < n; i++) {
          const sp = p.speed * rng.range(0.85, 1.2);
          P.spawn({
            x: rng.range(-0.25, 1.25), y: -0.05 - rng.next() * 0.1,
            vx: p.angle * sp, vy: sp,
            size: p.length * rng.range(0.7, 1.4),
            a: rng.range(0.4, 1), seed: rng.next(),
          });
        }
        hits.length = 0;
        P.step(dt, {
          field: w.field, gy: 0.9, gx: w.wind[0] * 0.4, drag: 0,
          bounce: 0, friction: 0, aspect: w.aspect,
          onHit: (i) => { hits.push(P.x[i], P.y[i], P.a[i]); P.kill(i); },
        });
        if (p.splash) {
          for (let k = 0; k < hits.length; k += 3) {
            S2.spawn({
              x: hits[k], y: hits[k + 1], vx: 0, vy: 0,
              size: p.splashSize * rng.range(0.6, 1.5),
              life: 0.32 * rng.range(0.7, 1.3), a: hits[k + 2], seed: rng.next(),
            });
          }
        }
        S2.step(dt, { field: null, gy: 0, gx: 0, aspect: w.aspect, killOutside: false });
      },
      draw(c) {
        const p = c.params;
        hexRgb(p.color, col);

        // wet sheen where drops have landed
        if (p.wet && wetA) {
          if (hits.length) {
            wetA.bind();
            BLEND.add(gl);
            const k = wetBatch.fillFrom(hits.length / 3, (i, d, o) => {
              d[o] = hits[i * 3]; d[o + 1] = hits[i * 3 + 1];
              d[o + 2] = 1; d[o + 3] = 1; d[o + 4] = 1; d[o + 5] = 0.06 * p.wetAmount;
              d[o + 6] = p.splashSize * 1.6; d[o + 7] = 0; d[o + 8] = 1; d[o + 9] = 0;
            });
            prWetSplat.use();
            gl.uniform1f(prWetSplat.u.uAspect, c.aspect);
            wetBatch.draw(prWetSplat);
            gl.disable(gl.BLEND);
          }
          prDecay.use();
          bindTex(gl, 0, wetA.tex, prDecay.u.uTex);
          gl.uniform1f(prDecay.u.uK, p.dry * 0.004);
          wetB.bind(); ctx.screen.draw();
          const t = wetA; wetA = wetB; wetB = t;

          c.dst.bind();
          gl.disable(gl.BLEND);
          prWet.use();
          bindTex(gl, 0, c.src, prWet.u.uBg);
          bindTex(gl, 1, wetA.tex, prWet.u.uWet);
          gl.uniform1f(prWet.u.uAmt, p.wetAmount * c.opacity);
          gl.uniform2f(prWet.u.uTexel, 1 / ww, 1 / wh);
          ctx.screen.draw();
        } else {
          ctx.screen.copy(c.src, c.dst);
        }

        c.dst.bind();
        BLEND.add(gl);
        // streaks
        const n = streaks.fillFrom(P.n, (i, d, o) => {
          if (!P.alive[i]) { d[o] = -9; d[o + 6] = 0; return; }
          const vx = P.vx[i], vy = P.vy[i];
          d[o] = P.x[i]; d[o + 1] = P.y[i];
          d[o + 2] = col[0]; d[o + 3] = col[1]; d[o + 4] = col[2];
          d[o + 5] = P.a[i] * p.opacityDrop;
          d[o + 6] = P.size[i];
          d[o + 7] = Math.atan2(vx, -vy);        // align with travel
          d[o + 8] = p.width;
          d[o + 9] = P.seed[i];
        });
        if (n) {
          prStreak.use();
          gl.uniform1f(prStreak.u.uAspect, c.aspect);
          gl.uniform1f(prStreak.u.uOpacity, c.opacity);
          streaks.draw(prStreak);
        }
        // splash crowns
        if (p.splash) {
          const m = splashes.fill(S2, (i, d, o) => {
            d[o + 2] = col[0]; d[o + 3] = col[1]; d[o + 4] = col[2];
            d[o + 5] = S2.a[i] * 0.9;
            d[o + 6] = S2.size[i] * (2.2 - S2.life[i] / S2.maxLife[i]);
            d[o + 8] = S2.life[i] / S2.maxLife[i];
          });
          if (m) {
            prSplash.use();
            gl.uniform1f(prSplash.u.uAspect, c.aspect);
            gl.uniform1f(prSplash.u.uSizeScale, 1);
            gl.uniform1f(prSplash.u.uOpacity, c.opacity);
            splashes.draw(prSplash);
          }
        }
        gl.disable(gl.BLEND);
      },
      dispose() {
        streaks.dispose(); splashes.dispose(); wetBatch.dispose();
        if (wetA) { wetA.dispose(); wetB.dispose(); }
      },
    };
  },
};
