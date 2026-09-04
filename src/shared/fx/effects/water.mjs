// Real liquid: a few thousand particles under Clavet double-density
// relaxation, so it is genuinely incompressible — it fills the room from the
// floor up, finds a level, sloshes, splashes off a couch and pours off the
// bottom edge of a painting. The surface is reconstructed from a density
// splat, which gives a smooth metaball meniscus rather than visible blobs, and
// the video behind it is refracted, tinted and blurred with depth.

import { prog, bindTex, Target, BLEND, hexRgb, VS_SCREEN } from '../glu.mjs';
import { Particles, SpriteBatch } from '../particles.mjs';
import { R, B, C, S, Emitter } from './common.mjs';

const SPLAT_VS = `#version 300 es
in vec2 iPos; in vec4 iCol; in vec4 iAttr;
out vec2 vLocal; out float vSpeed;
uniform float uAspect;
void main(){
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vLocal = corner;
  vSpeed = iAttr.z;
  vec2 p = iPos + corner * iAttr.x;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - (p.y / uAspect) * 2.0, 0.0, 1.0);
}`;

const SPLAT_FS = `#version 300 es
precision highp float;
in vec2 vLocal; in float vSpeed;
out vec4 o;
void main(){
  float r2 = dot(vLocal, vLocal);
  if (r2 > 1.0) discard;
  float w = exp(-r2 * 3.2) * (1.0 - r2);
  o = vec4(w, w * vSpeed, 0.0, 0.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uTex; uniform vec2 uDir; out vec4 o;
void main(){
  vec4 s = texture(uTex, vUV) * 0.38774;
  s += (texture(uTex, vUV + uDir) + texture(uTex, vUV - uDir)) * 0.24477;
  s += (texture(uTex, vUV + uDir * 2.0) + texture(uTex, vUV - uDir * 2.0)) * 0.06136;
  o = s;
}`;

const FS = `#version 300 es
precision highp float;
#include <common>
#include <refract>
#include <hash>
#include <noise>
in vec2 vUV;
uniform sampler2D uBg;
uniform sampler2D uDen;
uniform sampler2D uSdf;
uniform vec2 uTexel;
uniform vec3 uColor;
uniform vec3 uDeep;
uniform float uThreshold;
uniform float uRefract;
uniform float uThickness;
uniform float uFoam;
uniform float uSpec;
uniform float uOpacity;
uniform float uTime;
uniform float uAspect;
out vec4 o;

float dens(vec2 uv){ return texture(uDen, uv).r; }

void main(){
  vec2 t = uTexel;
  float d = dens(vUV);
  float surf = smoothstep(uThreshold * 0.55, uThreshold, d);
  if (surf <= 0.002) { o = vec4(0.0); return; }

  // surface normal from the density gradient, with a little high-frequency
  // chop so a still pool is not mirror-flat
  float l = dens(vUV - vec2(t.x, 0.0)), r = dens(vUV + vec2(t.x, 0.0));
  float dn = dens(vUV - vec2(0.0, t.y)), up = dens(vUV + vec2(0.0, t.y));
  vec2 g = vec2(r - l, up - dn) * 6.0;
  float chop = 0.06 * (fbm(vUV * vec2(90.0, 90.0 * uAspect) + vec2(0.0, uTime * 0.6), 2) - 0.5);
  g += vec2(chop, chop * 0.6);
  vec3 n = normalize(vec3(-g, 0.55));

  float depth = sat((d - uThreshold) * uThickness);
  vec3 bg = refractBg(uBg, vUV, n.xy, uRefract * (0.35 + depth), 1.33, vec2(0.3, 0.22));

  // Beer-Lambert style tint: the deeper the column, the more of the water's
  // own colour survives
  vec3 tint = mix(uColor, uDeep, sat(depth * 1.4));
  vec3 col = bg * mix(vec3(1.0), tint, sat(0.25 + depth * 0.9));
  col = mix(col, tint * (0.35 + 0.5 * luma(bg)), sat(depth * 0.55));
  // ambient body: over a dark picture the water would otherwise be invisible
  // except for its highlights
  col += tint * (0.10 + 0.25 * depth) * surf;

  vec3 L = normalize(vec3(-0.5, -0.8, 0.7));
  float spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 70.0);
  col += vec3(spec) * uSpec * 2.2;
  float fres = fresnel(n, vec3(0.0, 0.0, 1.0), 0.02);
  col += fres * 0.35 * vec3(0.7, 0.85, 1.0);

  // Foam belongs to the surface, not the bulk: it needs both a thin column and
  // real motion, otherwise settled water fizzes with speckle.
  float speed = texture(uDen, vUV).g / max(1e-4, d);
  float rim = 1.0 - smoothstep(uThreshold, uThreshold * 2.4, d);
  float shallow = 1.0 - smoothstep(uThreshold * 1.2, uThreshold * 3.5, d);
  float foam = (sat(speed * 0.32 - 0.30) * shallow + rim * 0.55) * uFoam;
  col = mix(col, vec3(1.0), sat(foam) * 0.8);

  float a = surf * uOpacity;
  o = vec4(col * a, a);
}`;

export default {
  type: 'water',
  label: 'Water',
  group: 'Fluid',
  blend: 'post',
  hint: 'Incompressible liquid. It pours in, finds a level, and flows around every masked shape.',
  actions: [
    { name: 'fill', label: 'Fill the room' },
    { name: 'splash', label: 'Splash' },
    { name: 'drain', label: 'Drain' },
    { name: 'clear', label: 'Empty' },
  ],
  params: [
    R('volume', 'Volume', 0.45, 0.05, 1),
    R('pour', 'Pour rate', 20, 0, 400, 1),
    R('pourX', 'Pour at', 0.5, 0, 1),
    R('pourSpread', 'Pour width', 0.06, 0, 0.5),
    R('viscosity', 'Viscosity', 0.25, 0, 1),
    R('stiffness', 'Stiffness', 0.5, 0.1, 1),
    R('gravity', 'Gravity', 1, -1, 2),
    C('color', 'Shallow', '#4fc3f7'),
    C('deep', 'Deep', '#0b3d6b'),
    R('refract', 'Refraction', 0.5, 0, 1.5),
    R('thickness', 'Depth tint', 1, 0, 3),
    R('foam', 'Foam', 0.6, 0, 2),
    R('spec', 'Highlights', 0.8, 0, 2),
    R('threshold', 'Surface', 0.55, 0.15, 1.4),
    R('blur', 'Smoothness', 1, 0, 3),
  ],

  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const cap = Math.round(9000 * (ctx.quality.particles || 1));
    const P = new Particles(cap);
    const batch = new SpriteBatch(gl, cap);
    const prSplat = prog(gl, SPLAT_VS, SPLAT_FS);
    const prBlur = prog(gl, VS_SCREEN, BLUR_FS);
    const prMain = prog(gl, VS_SCREEN, FS);
    const emitter = new Emitter();
    let den = null, tmp = null, dw = 0, dh = 0;
    const c1 = [0, 0, 0], c2 = [0, 0, 0];
    let drainT = 0;

    const targetCount = (p) => Math.max(200, Math.round(cap * p.volume));
    const H = () => 0.026;

    const addAt = (x, y, vx, vy) => P.spawn({ x, y, vx, vy, size: 0.011, seed: rng.next() });

    return {
      resize(w, h) {
        const sw = Math.max(64, Math.round(w * 0.5)), sh = Math.max(36, Math.round(h * 0.5));
        if (sw === dw && sh === dh) return;
        if (den) { den.dispose(); tmp.dispose(); }
        dw = sw; dh = sh;
        den = new Target(gl, sw, sh, 'rgba16f');
        tmp = new Target(gl, sw, sh, 'rgba16f');
      },

      action(name, arg, w, p) {
        if (name === 'clear') { P.reset(); return; }
        if (name === 'drain') { drainT = 2.5; return; }
        if (name === 'splash') {
          for (let i = 0; i < 220; i++) {
            const a = rng.range(0, Math.PI * 2), s = rng.range(0.2, 1.4);
            addAt(0.5 + rng.gauss() * 0.03, w.aspect * 0.4 + rng.gauss() * 0.03,
              Math.cos(a) * s, Math.sin(a) * s - 0.6);
          }
          return;
        }
        if (name === 'fill') {
          const n = targetCount(p) - P.count;
          const h = H();
          const cols = Math.max(1, Math.floor(1 / (h * 0.62)));
          for (let i = 0; i < n; i++) {
            const cx = (i % cols + 0.5) / cols;
            const row = Math.floor(i / cols);
            addAt(cx + rng.gauss() * 0.002, w.aspect - 0.01 - row * h * 0.6, 0, 0);
          }
        }
      },

      step(dt, w, p) {
        const want = targetCount(p);
        if (drainT > 0) {
          drainT -= dt;
          let killed = 0;
          for (let i = 0; i < P.n && killed < 400; i++) {
            if (P.alive[i] && P.y[i] > w.aspect - 0.05) { P.kill(i); killed++; }
          }
        } else if (p.pour > 0 && P.count < want) {
          const n = emitter.tick(dt, p.pour);
          for (let i = 0; i < n && P.count < want; i++) {
            addAt(p.pourX + (rng.next() - 0.5) * p.pourSpread, -0.02,
              rng.gauss() * 0.05, 0.35 + rng.next() * 0.2);
          }
        }
        // pointer / camera stirs the liquid
        for (const it of w.interactors) {
          const r = it.r || 0.07, r2 = r * r;
          for (let i = 0; i < P.n; i++) {
            if (!P.alive[i]) continue;
            const dx = P.x[i] - it.x, dy = P.y[i] - it.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;
            const d = Math.sqrt(d2) || 1e-6;
            const f = (1 - d / r) * (it.strength == null ? 1 : it.strength);
            P.vx[i] += (dx / d) * f * 1.6 * dt * 30 + (it.vx || 0) * f;
            P.vy[i] += (dy / d) * f * 1.6 * dt * 30 + (it.vy || 0) * f;
          }
        }
        const h = H();
        P.relax(dt, {
          h,
          rest: 5.6,
          k: 0.16 + 0.5 * p.stiffness,
          kNear: 1.6 + 3.5 * p.stiffness,
          viscSigma: p.viscosity * 0.6,
          viscBeta: p.viscosity * 0.9,
          gy: w.gy * p.gravity,
          gx: w.wind[0] * 0.4,
          field: w.field,
          aspect: w.aspect,
          radius: 0.0035,
        });
      },

      draw(c) {
        const p = c.params;
        if (!den) return;
        // 1. splat particles into a density + speed field
        den.bind([0, 0, 0, 0]);
        BLEND.add(gl);
        const n = batch.fillFrom(P.n, (i, d, o) => {
          if (!P.alive[i]) { d[o + 6] = 0; d[o] = -9; return; }
          d[o] = P.x[i]; d[o + 1] = P.y[i];
          d[o + 2] = 1; d[o + 3] = 1; d[o + 4] = 1; d[o + 5] = 1;
          d[o + 6] = 0.020;
          d[o + 7] = 0;
          d[o + 8] = Math.min(3, Math.hypot(P.vx[i], P.vy[i]));
          d[o + 9] = P.seed[i];
        });
        if (n) {
          prSplat.use();
          gl.uniform1f(prSplat.u.uAspect, c.aspect);
          batch.draw(prSplat);
        }
        gl.disable(gl.BLEND);

        // 2. smooth it so the surface reads as one body of water
        const passes = Math.round(p.blur);
        prBlur.use();
        for (let i = 0; i < passes; i++) {
          bindTex(gl, 0, den.tex, prBlur.u.uTex);
          gl.uniform2f(prBlur.u.uDir, 1.2 / dw, 0);
          tmp.bind(); ctx.screen.draw();
          bindTex(gl, 0, tmp.tex, prBlur.u.uTex);
          gl.uniform2f(prBlur.u.uDir, 0, 1.2 / dh);
          den.bind(); ctx.screen.draw();
        }

        // 3. shade the surface over the picture
        ctx.screen.copy(c.src, c.dst);
        c.dst.bind();
        prMain.use();
        bindTex(gl, 0, c.src, prMain.u.uBg);
        bindTex(gl, 1, den.tex, prMain.u.uDen);
        bindTex(gl, 2, c.sdfTex, prMain.u.uSdf);
        gl.uniform2f(prMain.u.uTexel, 1 / dw, 1 / dh);
        hexRgb(p.color, c1); hexRgb(p.deep, c2);
        gl.uniform3f(prMain.u.uColor, c1[0], c1[1], c1[2]);
        gl.uniform3f(prMain.u.uDeep, c2[0], c2[1], c2[2]);
        gl.uniform1f(prMain.u.uThreshold, p.threshold);
        gl.uniform1f(prMain.u.uRefract, p.refract * 0.06);
        gl.uniform1f(prMain.u.uThickness, p.thickness);
        gl.uniform1f(prMain.u.uFoam, p.foam);
        gl.uniform1f(prMain.u.uSpec, p.spec);
        gl.uniform1f(prMain.u.uOpacity, c.opacity);
        gl.uniform1f(prMain.u.uTime, c.time);
        gl.uniform1f(prMain.u.uAspect, c.aspect);
        BLEND.over(gl);
        ctx.screen.draw();
        gl.disable(gl.BLEND);
      },

      dispose() { batch.dispose(); if (den) { den.dispose(); tmp.dispose(); } },
    };
  },
};
