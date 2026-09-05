// Smoke, fire and ink all come out of one Eulerian solver — the difference is
// which way buoyancy points, how fast the dye dissipates, and how the field is
// shaded. Obstacles are the same signed distance field everything else uses,
// so a plume genuinely rolls around a painting instead of through it.

import { prog, bindTex, BLEND, hexRgb, VS_SCREEN } from '../glu.mjs';
import { Fluid } from '../fluid.mjs';
import { R, B, C, S, PALETTE_OPTIONS } from './common.mjs';

const SMOKE_FS = `#version 300 es
precision highp float;
#include <common>
#include <hash>
#include <noise>
#include <bicubic>
in vec2 vUV;
uniform sampler2D uBg;
uniform sampler2D uDye;
uniform vec2 uTexel;
uniform vec3 uColor;
uniform vec3 uShadow;
uniform vec2 uLight;
uniform float uDensity;
uniform float uBlurAmt;
uniform float uDetail;
uniform float uTime;
uniform float uOpacity;
uniform float uAspect;
out vec4 o;

float dens(vec2 uv){ return texBicubic(uDye, uv, uTexel).a; }
float densCheap(vec2 uv){ return texture(uDye, uv).a; }

void main(){
  // Detail comes from warping the *lookup* rather than modulating the result,
  // so the fine structure travels with the plume instead of crawling across it.
  vec2 uv = vUV;
  if (uDetail > 0.0) {
    vec2 w1 = curl(vUV * vec2(9.0, 9.0 * uAspect) + vec2(0.0, -uTime * 0.25), 0.02);
    vec2 w2 = curl(vUV * vec2(22.0, 22.0 * uAspect) + vec2(3.7, -uTime * 0.6), 0.02);
    uv += (w1 * 0.9 + w2 * 0.35) * uDetail * 0.012;
  }
  float d = dens(uv);
  float a = 1.0 - exp(-d * uDensity);
  // fine wisps: the thin edge of the plume is eaten away by small-scale noise
  if (uDetail > 0.0) {
    float n = fbm(vUV * vec2(34.0, 34.0 * uAspect) + vec2(uTime * 0.2, -uTime * 0.45), 3);
    a *= smoothstep(0.0, 0.18 + 0.3 * uDetail, a + (n - 0.5) * 0.35 * uDetail);
  }
  // a 'post' layer owns every pixel of its target, so pass the picture through
  if (a < 0.003) { o = vec4(texture(uBg, vUV).rgb, 1.0); return; }

  // self-shadowing: march a few steps towards the light and accumulate density
  float occl = 0.0;
  vec2 stepv = normalize(uLight + 1e-5) * uTexel * 3.0;
  vec2 sp = uv;
  for (int i = 0; i < 6; i++) { sp += stepv; occl += densCheap(sp); }
  occl = 1.0 - exp(-occl * uDensity * 0.32);
  vec3 col = mix(uColor, uShadow, sat(occl));

  // the picture behind thick smoke goes soft
  vec3 bg = texture(uBg, vUV).rgb;
  if (uBlurAmt > 0.0) {
    vec2 e = uTexel * (2.0 + 8.0 * uBlurAmt) * a;
    vec3 s = bg;
    s += texture(uBg, vUV + vec2(e.x, 0.0)).rgb;
    s += texture(uBg, vUV - vec2(e.x, 0.0)).rgb;
    s += texture(uBg, vUV + vec2(0.0, e.y)).rgb;
    s += texture(uBg, vUV - vec2(0.0, e.y)).rgb;
    s += texture(uBg, vUV + e * 0.7).rgb;
    s += texture(uBg, vUV - e * 0.7).rgb;
    s += texture(uBg, vUV + vec2(e.x, -e.y) * 0.7).rgb;
    s += texture(uBg, vUV + vec2(-e.x, e.y) * 0.7).rgb;
    bg = mix(bg, s / 9.0, sat(a * 1.6));
  }
  vec3 outc = mix(bg, col, a * uOpacity);
  o = vec4(outc, 1.0);
}`;

const FIRE_FS = `#version 300 es
precision highp float;
#include <common>
#include <hash>
#include <noise>
#include <bicubic>
in vec2 vUV;
uniform sampler2D uBg;
uniform sampler2D uDye;
uniform vec2 uTexel;
uniform float uDensity;
uniform float uSoot;
uniform float uDetail;
uniform float uTime;
uniform float uOpacity;
uniform float uAspect;
uniform float uSpill;
uniform vec3 uCool;
uniform vec3 uHot;
out vec4 o;
void main(){
  vec2 uv = vUV;
  if (uDetail > 0.0) {
    vec2 w1 = curl(vUV * vec2(11.0, 11.0 * uAspect) + vec2(0.0, -uTime * 0.9), 0.02);
    vec2 w2 = curl(vUV * vec2(26.0, 26.0 * uAspect) + vec2(2.3, -uTime * 1.7), 0.02);
    uv += (w1 * 0.8 + w2 * 0.4) * uDetail * 0.014;
  }
  vec4 dye = texBicubic(uDye, uv, uTexel);
  float heat = dye.b;
  float soot = dye.a;
  // flame tongues: fine noise licks at the cooler edge
  if (uDetail > 0.0) {
    float n = fbm(vUV * vec2(30.0, 30.0 * uAspect) - vec2(0.0, uTime * 2.2), 3);
    heat *= 0.85 + 0.45 * (n - 0.5) * uDetail + 0.15 * uDetail;
  }
  float t = sat(heat * uDensity);
  // blackbody-ish ramp: deep red -> orange -> yellow -> white
  vec3 fire = mix(vec3(0.0), uCool, smoothstep(0.02, 0.30, t));
  fire = mix(fire, uHot, smoothstep(0.28, 0.72, t));
  fire = mix(fire, vec3(1.35, 1.25, 1.05), smoothstep(0.7, 1.0, t));
  fire *= 1.0 + t * 2.2;

  float smokeA = 1.0 - exp(-soot * uSoot);
  vec3 bg = texture(uBg, vUV).rgb;
  // firelight spills onto the wall around the flame
  bg += fire * uSpill * 0.035;
  vec3 col = mix(bg, vec3(0.06, 0.055, 0.05), smokeA * 0.85);
  col += fire * uOpacity;
  o = vec4(col, 1.0);
}`;

const INK_FS = `#version 300 es
precision highp float;
#include <common>
#include <hash>
#include <noise>
#include <bicubic>
in vec2 vUV;
uniform sampler2D uBg;
uniform sampler2D uDye;
uniform vec2 uTexel;
uniform float uDensity;
uniform float uOpacity;
uniform float uGlow;
uniform float uDetail;
uniform float uTime;
uniform float uAspect;
out vec4 o;
void main(){
  vec4 dye = texBicubic(uDye, vUV, uTexel);
  float a = 1.0 - exp(-dye.a * uDensity);
  // pigment edges: a fine granular fringe where the ink thins out
  if (uDetail > 0.0) {
    float n = fbm(vUV * vec2(60.0, 60.0 * uAspect), 3);
    a = smoothstep(0.0, 0.5, a + (n - 0.5) * 0.45 * uDetail) * sat(a * 3.0);
  }
  vec3 c = dye.a > 1e-4 ? dye.rgb / max(dye.a, 1e-4) : vec3(0.0);
  vec3 bg = texture(uBg, vUV).rgb;
  // pigment absorbs: multiply, then a touch of emission so it stays readable
  vec3 col = bg * mix(vec3(1.0), c, a * uOpacity) + c * a * uGlow;
  o = vec4(col, 1.0);
}`;

function gasFactory(kind) {
  return (ctx) => {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const baseGrid = ctx.quality.grid;
    let grid = baseGrid;
    let fluid = null;
    const fsSrc = kind === 'fire' ? FIRE_FS : kind === 'ink' ? INK_FS : SMOKE_FS;
    const pr = prog(gl, VS_SCREEN, fsSrc);
    const c1 = [0, 0, 0], c2 = [0, 0, 0];
    let inkPhase = 0;

    const ensure = (aspect, res) => {
      if (res) grid = Math.round(baseGrid * res);
      const h = Math.max(16, Math.round(grid * aspect));
      if (!fluid) fluid = new Fluid(gl, ctx.screen, grid, h, aspect);
      else fluid.resize(grid, h, aspect);
      return fluid;
    };

    return {
      resize(w, h, aspect) { ensure(aspect); },

      action(name, arg, w, p) {
        const f = ensure(w.aspect);
        if (name === 'clear') { f.clearAll(); return; }
        if (name === 'puff' || name === 'blast') {
          const strength = name === 'blast' ? 3 : 1;
          for (let i = 0; i < 6; i++) {
            const x = rng.range(0.2, 0.8), y = rng.range(0.4, 0.9);
            hexRgb(p.color || '#dfe6ef', c1);
            f.splatDye(x, y, 0.05, {
              color: c1, amount: 1.2 * strength,
              heat: kind === 'fire' ? 1.4 * strength : 0,
              alpha: kind === 'fire' ? 0.3 : 1,
            }, w.sdfTex);
            f.splatVel(x, y, 0.07, rng.gauss() * 0.6 * strength, -1.6 * strength, w.sdfTex);
          }
        }
      },

      step(dt, w, p) {
        const f = ensure(w.aspect, p.res || 1);
        const sdf = w.sdfTex;
        if (!sdf) return;

        // emitters
        const rate = p.emit == null ? 1 : p.emit;
        if (rate > 0) {
          const n = Math.max(1, Math.round(p.sources || 1));
          for (let i = 0; i < n; i++) {
            const spread = p.spread == null ? 0.2 : p.spread;
            const cx = (p.x == null ? 0.5 : p.x) + (n > 1 ? (i / Math.max(1, n - 1) - 0.5) * spread * 4 : 0);
            const jitterX = Math.sin(w.time * (0.7 + i * 0.31) + i) * spread * 0.5;
            const x = Math.min(0.99, Math.max(0.01, cx + jitterX));
            // grid v runs bottom-up; the parameter reads top-down like the picture
            const y = 1 - (p.y == null ? 0.96 : p.y);
            if (kind === 'fire') {
              // fuel injects heat, and only a fraction of it as soot
              f.splatDye(x, y, (p.size || 0.05) * 0.6,
                { color: [0, 0, 1], amount: rate * dt * 3.2, heat: 1, alpha: 0.22 }, sdf);
              f.splatVel(x, y, (p.size || 0.05) * 0.8, Math.sin(w.time * 3.1 + i) * 1.6 * dt, 7.0 * rate * dt, sdf);
            } else if (kind === 'ink') {
              inkPhase += dt * 0.13;
              const pal = ['#ff2d95', '#00e5ff', '#ffe600', '#7cff00', '#b14bff'];
              hexRgb(p.multicolour ? pal[(i + Math.floor(inkPhase)) % pal.length] : p.color, c1);
              f.splatDye(x, y, (p.size || 0.05) * 0.7, { color: c1, amount: rate * dt * 3.5 }, sdf);
              f.splatVel(x, y, (p.size || 0.05), Math.sin(w.time * 1.7 + i) * 1.2 * dt, -3.0 * rate * dt, sdf);
            } else {
              hexRgb(p.color, c1);
              f.splatDye(x, y, (p.size || 0.06), { color: c1, amount: rate * dt * 2.2 }, sdf);
              f.splatVel(x, y, (p.size || 0.06) * 1.2, Math.sin(w.time * 1.3 + i * 2.1) * 2.0 * dt, 4.0 * rate * dt, sdf);
            }
          }
        }

        for (const it of w.interactors) {
          const s = (it.strength == null ? 1 : it.strength);
          f.splatVel(it.x, 1 - it.y / w.aspect, it.r || 0.06, (it.vx || 0) * 90 * s * dt, -(it.vy || 0) * 90 * s * dt, sdf);
          if (p.interactEmit) {
            hexRgb(p.color, c1);
            f.splatDye(it.x, 1 - it.y / w.aspect, (it.r || 0.06) * 0.7, {
              color: c1, amount: 0.6 * s,
              heat: kind === 'fire' ? 1.2 * s : 0,
              alpha: kind === 'fire' ? 0.25 : 1,
            }, sdf);
          }
        }

        f.step(dt, {
          sdfTex: sdf,
          buoyancy: kind === 'ink' ? 0 : (p.buoyancy == null ? 1.2 : p.buoyancy) * (kind === 'fire' ? 1.1 : 1),
          weight: kind === 'ink' ? (p.sink == null ? 0.6 : p.sink) * 2.2 : 0,
          wind: [w.wind[0] * 0.5 + (p.wind || 0), -w.wind[1] * 0.5],
          turbulence: p.turbulence || 0,
          turbScale: 5,
          curl: (p.curl == null ? 2.2 : p.curl) * (kind === 'fire' ? 1.5 : 1),
          dyeDissipate: kind === 'fire' ? (p.coolRate == null ? 5 : p.coolRate) : (p.dissipate == null ? 0.25 : p.dissipate),
          heatDissipate: kind === 'fire' ? (p.coolRate == null ? 5 : p.coolRate) : undefined,
          sootDissipate: kind === 'fire' ? (p.smokeFade == null ? 0.5 : p.smokeFade) : undefined,
          velDissipate: 0.06,
          pressureIters: ctx.quality.pressure,
          sharpen: kind !== 'smoke',
        });
      },

      draw(c) {
        if (!fluid) return;
        const p = c.params;
        c.dst.bind();
        gl.disable(gl.BLEND);
        pr.use();
        bindTex(gl, 0, c.src, pr.u.uBg);
        bindTex(gl, 1, fluid.dye.read.tex, pr.u.uDye);
        gl.uniform2f(pr.u.uTexel, 1 / fluid.w, 1 / fluid.h);
        gl.uniform1f(pr.u.uOpacity, c.opacity);
        gl.uniform1f(pr.u.uTime, c.time);
        gl.uniform1f(pr.u.uAspect, c.aspect);
        gl.uniform1f(pr.u.uDetail, p.detail || 0);
        if (kind === 'smoke') {
          hexRgb(p.color, c1); hexRgb(p.shadowColor, c2);
          gl.uniform3f(pr.u.uColor, c1[0], c1[1], c1[2]);
          gl.uniform3f(pr.u.uShadow, c2[0], c2[1], c2[2]);
          gl.uniform2f(pr.u.uLight, Math.cos(p.lightAngle * Math.PI / 180), -Math.sin(p.lightAngle * Math.PI / 180));
          gl.uniform1f(pr.u.uDensity, p.density);
          gl.uniform1f(pr.u.uBlurAmt, p.blurBehind);
        } else if (kind === 'fire') {
          hexRgb(p.cool, c1); hexRgb(p.hot, c2);
          gl.uniform3f(pr.u.uCool, c1[0], c1[1], c1[2]);
          gl.uniform3f(pr.u.uHot, c2[0], c2[1], c2[2]);
          gl.uniform1f(pr.u.uDensity, p.intensity);
          gl.uniform1f(pr.u.uSoot, p.soot);
          gl.uniform1f(pr.u.uSpill, p.spill);
        } else {
          gl.uniform1f(pr.u.uDensity, p.density);
          gl.uniform1f(pr.u.uGlow, p.glow);
        }
        ctx.screen.draw();
      },

      dispose() { if (fluid) fluid.dispose(); },
    };
  };
}

export const smoke = {
  type: 'smoke', label: 'Smoke', group: 'Fluid', blend: 'post',
  hint: 'A buoyant plume that rolls around your shapes and softens the picture behind it.',
  actions: [{ name: 'puff', label: 'Puff' }, { name: 'blast', label: 'Blast' }, { name: 'clear', label: 'Clear' }],
  params: [
    R('emit', 'Emission', 1, 0, 4),
    R('sources', 'Sources', 1, 1, 6, 1),
    R('x', 'Position', 0.5, 0, 1),
    R('y', 'Height', 0.96, 0, 1),
    R('spread', 'Spread', 0.2, 0, 1),
    R('size', 'Nozzle', 0.06, 0.01, 0.2),
    C('color', 'Colour', '#c9d4e2'),
    C('shadowColor', 'Shadow', '#1a2028'),
    R('density', 'Thickness', 2.4, 0.2, 8),
    R('buoyancy', 'Rise', 1.2, -1, 4),
    R('curl', 'Swirl', 2.2, 0, 8),
    R('turbulence', 'Turbulence', 0.6, 0, 4),
    R('dissipate', 'Fade', 0.45, 0, 2),
    R('res', 'Resolution', 1.25, 0.5, 2.5, 0.25),
    R('detail', 'Detail', 0.5, 0, 1),
    R('blurBehind', 'Blur the video', 0.6, 0, 1),
    R('lightAngle', 'Light angle', 250, 0, 360, 1),
    R('wind', 'Drift', 0, -2, 2),
    B('interactEmit', 'Pointer emits smoke', false),
  ],
  create: gasFactory('smoke'),
};

export const fire = {
  type: 'fire', label: 'Fire', group: 'Fluid', blend: 'post',
  hint: 'Buoyant flame with soot, blackbody colour and light spill onto the wall.',
  actions: [{ name: 'blast', label: 'Flare' }, { name: 'clear', label: 'Clear' }],
  params: [
    R('emit', 'Fuel', 0.7, 0, 4),
    R('sources', 'Sources', 3, 1, 8, 1),
    R('x', 'Position', 0.5, 0, 1),
    R('y', 'Height', 0.98, 0, 1),
    R('spread', 'Spread', 0.12, 0, 1),
    R('size', 'Nozzle', 0.045, 0.01, 0.2),
    C('cool', 'Cool', '#b3300a'),
    C('hot', 'Hot', '#ffb52e'),
    R('intensity', 'Intensity', 1.6, 0.1, 6),
    R('soot', 'Smoke', 1.1, 0, 6),
    R('spill', 'Light spill', 1, 0, 4),
    R('curl', 'Swirl', 1.6, 0, 8),
    R('turbulence', 'Turbulence', 0.7, 0, 4),
    R('coolRate', 'Cooling', 5, 0.5, 14),
    R('smokeFade', 'Smoke fade', 0.5, 0.02, 4),
    R('res', 'Resolution', 1.25, 0.5, 2.5, 0.25),
    R('detail', 'Detail', 0.7, 0, 1),
    R('wind', 'Draught', 0, -2, 2),
    B('interactEmit', 'Pointer ignites', false),
  ],
  create: gasFactory('fire'),
};

export const ink = {
  type: 'ink', label: 'Ink / paint', group: 'Fluid', blend: 'post',
  hint: 'Heavy pigment that sinks, pools on ledges and stains the picture.',
  actions: [{ name: 'puff', label: 'Drop' }, { name: 'clear', label: 'Clear' }],
  params: [
    R('emit', 'Flow', 1, 0, 4),
    R('sources', 'Sources', 2, 1, 8, 1),
    R('x', 'Position', 0.5, 0, 1),
    R('y', 'Height', 0.04, 0, 1),
    R('spread', 'Spread', 0.25, 0, 1),
    R('size', 'Nozzle', 0.045, 0.01, 0.2),
    C('color', 'Colour', '#12224a'),
    B('multicolour', 'Multicolour', false),
    R('density', 'Opacity', 3.2, 0.2, 10),
    R('glow', 'Glow', 0.1, 0, 1),
    R('sink', 'Weight', 0.6, 0, 3),
    R('curl', 'Swirl', 1.2, 0, 8),
    R('turbulence', 'Turbulence', 0.35, 0, 4),
    R('res', 'Resolution', 1.75, 0.5, 2.5, 0.25),
    R('dissipate', 'Fade', 0.05, 0, 1),
    R('detail', 'Edge grain', 0.5, 0, 1),
    R('wind', 'Drift', 0, -2, 2),
    B('interactEmit', 'Pointer paints', false),
  ],
  create: gasFactory('ink'),
};
