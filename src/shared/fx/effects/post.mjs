// Scaffolding for the "whole-picture" shader effects (kaleidoscope, Droste,
// VHS ...): one fullscreen program that reads the picture and owns every pixel
// of the output. The helper wires the standard uniforms, the pointer-following
// centre, and the picture sampler with mirrored wrap so a lookup outside the
// frame never shows a hard edge.

import { prog, bindTex, VS_SCREEN, hexRgb } from '../glu.mjs';

// Every post shader gets these for free.
export const GLSL_POST = `
uniform sampler2D uBg;
uniform sampler2D uSdf;
uniform float uTime;
uniform float uAspect;
uniform float uOpacity;
uniform vec2 uSize;
uniform vec2 uCentre;
uniform vec2 uSdfTexel;

// the masked shapes only (the frame walls baked into the field are ignored):
// signed distance in normalised-x units, negative inside a shape
float shapeD(vec2 uv){
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
  return texture(uSdf, uv).r;
}
vec2 shapeN(vec2 uv){
  vec2 e = uSdfTexel;
  vec2 g = vec2(shapeD(uv + vec2(e.x, 0.0)) - shapeD(uv - vec2(e.x, 0.0)),
                shapeD(uv + vec2(0.0, e.y)) - shapeD(uv - vec2(0.0, e.y)));
  float m = length(g);
  return m > 1e-6 ? g / m : vec2(0.0, 1.0);
}

// mirrored repeat: 0..1..2 -> 0..1..0
vec2 mirrorUV(vec2 uv){ return 1.0 - abs(fract(uv * 0.5) * 2.0 - 1.0); }
vec3 pic(vec2 uv){ return texture(uBg, mirrorUV(uv)).rgb; }
vec3 picClamp(vec2 uv){ return texture(uBg, clamp(uv, vec2(0.0), vec2(1.0))).rgb; }

// centre-relative, aspect-correct coordinates: x spans -0.5..0.5
vec2 toLocal(vec2 uv){ return (uv - uCentre) * vec2(1.0, uAspect); }
vec2 fromLocal(vec2 p){ return uCentre + p / vec2(1.0, uAspect); }

vec3 hueShift(vec3 c, float h){
  const vec3 k = vec3(0.57735);
  float cs = cos(h), sn = sin(h);
  return c * cs + cross(k, c) * sn + k * dot(k, c) * (1.0 - cs);
}
vec3 satur(vec3 c, float s){ float l = luma(c); return mix(vec3(l), c, s); }
`;

const FS_HEAD = `#version 300 es
precision highp float;
#include <common>
#include <hash>
#include <noise>
in vec2 vUV;
out vec4 o;
`;

/**
 * Build a 'post' effect from a fragment body. `fs` is the shader after the
 * standard header; it must define main() and write `o`. Hooks:
 *   init(ctx) -> state, step(st, dt, world, params), action(st, name, arg, w, p),
 *   resize(st, w, h, aspect, ctx), uniforms(gl, u, params, st, c), dispose(st).
 * If `centre` is set, the state gets a smoothed centre that follows the pointer
 * when `params.followPointer` is on and drifts otherwise.
 */
export function postEffect(spec, fs, hooks = {}) {
  return {
    ...spec,
    blend: 'post',
    create(ctx) {
      const gl = ctx.gl;
      const pr = prog(gl, VS_SCREEN, FS_HEAD + GLSL_POST + fs);
      const st = hooks.init ? hooks.init(ctx) : {};
      st.cx = 0.5; st.cy = 0.5; st.t = 0;
      const col = [0, 0, 0];
      return {
        st,                      // exposed for scripted inspection
        resize(w, h, aspect) { hooks.resize?.(st, w, h, aspect, ctx); },
        step(dt, w, p) {
          st.t += dt;
          st.stepped = true;
          if (hooks.centre) {
            let tx = p.x == null ? 0.5 : p.x, ty = p.y == null ? 0.5 : p.y;
            if (p.followPointer && w.interactors.length) {
              tx = w.interactors[0].x; ty = w.interactors[0].y / w.aspect;
            } else if (p.drift) {
              tx += Math.sin(st.t * 0.27) * 0.08 * p.drift;
              ty += Math.cos(st.t * 0.19) * 0.06 * p.drift;
            }
            const k = Math.min(1, dt * 3);
            st.cx += (tx - st.cx) * k; st.cy += (ty - st.cy) * k;
          }
          hooks.step?.(st, dt, w, p);
        },
        action(name, arg, w, p) { hooks.action?.(st, name, arg, w, p); },
        draw(c) {
          const p = c.params;
          if (hooks.before) hooks.before(st, c, pr);
          c.dst.bind();
          gl.disable(gl.BLEND);
          pr.use();
          bindTex(gl, 0, c.src, pr.u.uBg);
          bindTex(gl, 1, c.sdfTex, pr.u.uSdf);
          gl.uniform1f(pr.u.uTime, c.time);
          gl.uniform1f(pr.u.uAspect, c.aspect);
          gl.uniform1f(pr.u.uOpacity, c.opacity);
          gl.uniform2f(pr.u.uSize, c.size[0], c.size[1]);
          gl.uniform2f(pr.u.uCentre, st.cx, 1 - st.cy);   // params are top-down, uv bottom-up
          gl.uniform2f(pr.u.uSdfTexel, c.sdfTexel[0], c.sdfTexel[1]);
          hooks.uniforms?.(gl, pr.u, p, st, c, (name, hex) => {
            hexRgb(hex, col); gl.uniform3f(pr.u[name], col[0], col[1], col[2]);
          });
          ctx.screen.draw();
          if (hooks.after) hooks.after(st, c, pr);
          st.stepped = false;
        },
        dispose() { hooks.dispose?.(st); },
      };
    },
  };
}
