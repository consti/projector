// The wall behaves like the surface of a pool: a damped wave equation whose
// height field refracts the video, reflects off every masked shape, and throws
// caustic-like highlights. Drops come from rain, from your pointer, or from
// whatever the camera sees moving.

import { prog, bindTex, VS_SCREEN } from '../glu.mjs';
import { Waves } from '../wave.mjs';
import { R, B, C, S } from './common.mjs';

const FS = `#version 300 es
precision highp float;
#include <common>
#include <refract>
in vec2 vUV;
uniform sampler2D uBg;
uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uRefract;
uniform float uSpec;
uniform float uCaustic;
uniform float uTint;
uniform vec3 uColor;
uniform float uOpacity;
out vec4 o;
void main(){
  vec2 t = uTexel;
  float l = texture(uState, vUV - vec2(t.x, 0.0)).r;
  float r = texture(uState, vUV + vec2(t.x, 0.0)).r;
  float d = texture(uState, vUV - vec2(0.0, t.y)).r;
  float u = texture(uState, vUV + vec2(0.0, t.y)).r;
  vec2 g = vec2(r - l, u - d);
  vec3 n = normalize(vec3(-g * 6.0, 1.0));

  vec3 col = refractBg(uBg, vUV, n.xy, uRefract, 1.33, vec2(0.35, 0.25));
  vec3 L = normalize(vec3(-0.4, -0.7, 0.6));
  float spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 60.0);
  col += vec3(0.8, 0.9, 1.0) * spec * uSpec * 2.0;

  // convergence of the surface normal focuses light the way a pool floor does
  float lap = (l + r + u + d - 4.0 * texture(uState, vUV).r);
  col *= 1.0 + clamp(-lap * 14.0, -0.5, 1.2) * uCaustic;
  col = mix(col, col * uColor, uTint);

  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export default {
  type: 'ripples',
  label: 'Ripples',
  group: 'Water',
  blend: 'post',
  hint: 'Waves travel across the wall and bounce off your shapes, bending the picture as they pass.',
  actions: [{ name: 'drop', label: 'Drop' }, { name: 'calm', label: 'Calm' }],
  params: [
    R('rain', 'Drops per second', 3, 0, 120, 1),
    R('dropSize', 'Drop size', 0.012, 0.002, 0.08, 0.001),
    R('amp', 'Drop strength', 0.22, 0.02, 2),
    R('speed', 'Wave speed', 0.42, 0.05, 0.49),
    R('damp', 'Damping', 0.996, 0.95, 1, 0.001),
    R('refract', 'Refraction', 0.35, 0, 2),
    R('spec', 'Highlights', 0.5, 0, 2),
    R('caustic', 'Caustics', 0.3, 0, 2),
    C('color', 'Tint', '#9fd8ff'),
    R('tint', 'Tint amount', 0.15, 0, 1),
    R('substeps', 'Solver steps', 2, 1, 4, 1),
  ],

  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    let waves = null;
    const pr = prog(gl, VS_SCREEN, FS);
    const col = [0, 0, 0];
    let acc = 0;
    const res = Math.max(192, Math.round(ctx.quality.grid * 1.4));

    const ensure = (aspect) => {
      const h = Math.max(16, Math.round(res * aspect));
      if (!waves) waves = new Waves(gl, ctx.screen, res, h, aspect);
      else waves.resize(res, h, aspect);
      return waves;
    };

    return {
      resize(w, h, aspect) { ensure(aspect); },
      action(name, arg, w, p) {
        const W = ensure(w.aspect);
        if (name === 'calm') { W.clearAll(); return; }
        for (let i = 0; i < 6; i++) {
          W.drop(rng.next(), rng.next(), p.dropSize * rng.range(0.7, 2), p.amp * rng.range(0.6, 1.6));
        }
      },
      step(dt, w, p) {
        const W = ensure(w.aspect);
        acc += dt * p.rain;
        while (acc >= 1) {
          acc -= 1;
          W.drop(rng.next(), rng.next(), p.dropSize * rng.range(0.6, 1.8), p.amp * rng.range(0.5, 1.4));
        }
        for (const it of w.interactors) {
          const s = Math.min(2, Math.hypot(it.vx || 0, it.vy || 0) * 1.5 + (it.down ? 1 : 0.15));
          if (s > 0.05) W.drop(it.x, 1 - it.y / w.aspect, (it.r || 0.05) * 0.8, p.amp * s * 0.5);
        }
        const n = Math.max(1, Math.round(p.substeps));
        for (let i = 0; i < n; i++) W.step({ sdfTex: w.sdfTex, speed: p.speed, damp: p.damp });
      },
      draw(c) {
        if (!waves) return;
        const p = c.params;
        c.dst.bind();
        gl.disable(gl.BLEND);
        pr.use();
        bindTex(gl, 0, c.src, pr.u.uBg);
        bindTex(gl, 1, waves.state.read.tex, pr.u.uState);
        gl.uniform2f(pr.u.uTexel, 1 / waves.w, 1 / waves.h);
        gl.uniform1f(pr.u.uRefract, p.refract * 0.05);
        gl.uniform1f(pr.u.uSpec, p.spec);
        gl.uniform1f(pr.u.uCaustic, p.caustic);
        hexRgbInto(p.color, col);
        gl.uniform3f(pr.u.uColor, col[0], col[1], col[2]);
        gl.uniform1f(pr.u.uTint, p.tint);
        gl.uniform1f(pr.u.uOpacity, c.opacity);
        ctx.screen.draw();
      },
      dispose() { if (waves) waves.dispose(); },
    };
  },
};

function hexRgbInto(h, out) {
  const s = String(h || '#ffffff').replace('#', '');
  const n = parseInt(s, 16) || 0;
  out[0] = ((n >> 16) & 255) / 255; out[1] = ((n >> 8) & 255) / 255; out[2] = (n & 255) / 255;
  return out;
}
