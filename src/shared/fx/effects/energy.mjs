// Three "no simulation, all shader" effects that still respect the geometry:
// lightning that earths itself on your shapes, an aurora that is occluded by
// them, and a gravitational lens that bends the video around a moving point.

import { prog, bindTex, BLEND, hexRgb, VS_SCREEN } from '../glu.mjs';
import { R, B, C, S, PALETTE_OPTIONS } from './common.mjs';

// ------------------------------------------------------------------ lightning
const SEG_VS = `#version 300 es
in vec2 iA;        // segment start (world)
in vec2 iB;        // segment end
in vec4 iCol;      // rgb + intensity
in vec2 iAttr;     // thickness, seed
out vec2 vLocal;
out vec4 vCol;
out vec2 vAttr;
uniform float uAspect;
void main(){
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vLocal = corner;
  vCol = iCol; vAttr = iAttr;
  vec2 d = iB - iA;
  float len = max(length(d), 1e-5);
  vec2 t = d / len;
  vec2 n = vec2(-t.y, t.x);
  vec2 mid = (iA + iB) * 0.5;
  vec2 p = mid + t * corner.x * (len * 0.5 + iAttr.x) + n * corner.y * iAttr.x;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - (p.y / uAspect) * 2.0, 0.0, 1.0);
}`;

const SEG_FS = `#version 300 es
precision highp float;
#include <common>
in vec2 vLocal; in vec4 vCol; in vec2 vAttr;
out vec4 o;
uniform float uOpacity;
void main(){
  float d = abs(vLocal.y);
  float core = pow(sat(1.0 - d * 3.4), 6.0);
  float glow = pow(sat(1.0 - d), 2.4) * 0.45;
  float cap = 1.0 - smoothstep(0.86, 1.0, abs(vLocal.x));
  float a = (core * 1.6 + glow) * vCol.a * cap * uOpacity;
  vec3 c = mix(vCol.rgb, vec3(1.0), core);
  o = vec4(c * a * (1.0 + core * 3.0), a);
}`;

const FLASH_FS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform vec3 uColor; uniform float uAmt;
void main(){ o = vec4(uColor * uAmt, uAmt); }`;

export const lightning = {
  type: 'lightning',
  label: 'Lightning',
  group: 'Energy',
  blend: 'add',
  hint: 'Branching arcs that earth themselves on the nearest shape, with a flash on the wall.',
  actions: [{ name: 'strike', label: 'Strike' }],
  params: [
    R('rate', 'Strikes per second', 0.8, 0, 12, 0.1),
    R('branches', 'Branching', 0.5, 0, 1),
    R('jag', 'Jaggedness', 0.5, 0, 1.5),
    R('thickness', 'Thickness', 0.0022, 0.0005, 0.012, 0.0002),
    R('life', 'Hold (s)', 0.22, 0.05, 1.5, 0.01),
    C('color', 'Colour', '#a9d4ff'),
    R('flash', 'Screen flash', 0.35, 0, 1.5),
    R('flicker', 'Flicker', 0.7, 0, 1),
    B('toShapes', 'Earth on shapes', true),
    B('fromPointer', 'Strike at the pointer', false),
  ],
  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const CAP = 4000;
    const STRIDE = 10;                    // iA(2) iB(2) iCol(4) iAttr(2)
    const data = new Float32Array(CAP * STRIDE);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    const pr = prog(gl, SEG_VS, SEG_FS);
    const prFlash = prog(gl, VS_SCREEN, FLASH_FS);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    for (const [name, size, off] of [['iA', 2, 0], ['iB', 2, 8], ['iCol', 4, 16], ['iAttr', 2, 32]]) {
      const loc = pr.a[name];
      if (loc == null || loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);

    let bolts = [];      // { segs:[x0,y0,x1,y1,depth], t, life, flash }
    let acc = 0;
    const col = [0, 0, 0];

    const buildBolt = (p, w, ax, ay, bx, by, depth, out) => {
      const pts = [[ax, ay], [bx, by]];
      const len = Math.hypot(bx - ax, by - ay);
      let disp = len * 0.22 * p.jag;
      for (let it = 0; it < 6; it++) {
        const next = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const l = Math.hypot(dx, dy) || 1e-5;
          const nx = -dy / l, ny = dx / l;
          const o = rng.gauss() * disp;
          next.push([mx + nx * o, my + ny * o]);
          next.push(b);
        }
        pts.length = 0; pts.push(...next);
        disp *= 0.55;
        if (pts.length > 130) break;
      }
      for (let i = 0; i < pts.length - 1; i++) {
        out.push(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], depth);
        if (depth < 2 && rng.next() < p.branches * 0.13) {
          const a = pts[i];
          const ang = Math.atan2(by - ay, bx - ax) + rng.gauss() * 1.1;
          const bl = len * rng.range(0.15, 0.4);
          buildBolt(p, w, a[0], a[1], a[0] + Math.cos(ang) * bl, a[1] + Math.sin(ang) * bl, depth + 1, out);
        }
      }
    };

    const strike = (p, w, tx, ty) => {
      const A = w.aspect;
      let sx = rng.range(0.05, 0.95), sy = -0.02;
      let ex = tx, ey = ty;
      if (ex == null) {
        ex = sx + rng.gauss() * 0.25;
        ey = A * rng.range(0.5, 1.0);
        if (p.toShapes && w.field.polys.length) {
          const poly = w.field.polys[(rng.next() * w.field.polys.length) | 0];
          const v = poly[(rng.next() * poly.length) | 0];
          ex = v[0]; ey = v[1];
        }
      }
      const segs = [];
      buildBolt(p, w, sx, sy, ex, ey, 0, segs);
      bolts.push({ segs, t: 0, life: p.life * rng.range(0.7, 1.4) });
    };

    return {
      resize() {},
      action(name, arg, w, p) { strike(p, w); },
      step(dt, w, p) {
        acc += dt * p.rate;
        while (acc >= 1) { acc -= 1; strike(p, w); }
        if (p.fromPointer) {
          for (const it of w.interactors) if (it.down) strike(p, w, it.x, it.y);
        }
        for (const b of bolts) b.t += dt;
        bolts = bolts.filter((b) => b.t < b.life);
        if (bolts.length > 12) bolts.splice(0, bolts.length - 12);
      },
      draw(c) {
        const p = c.params;
        if (!bolts.length) return;
        hexRgb(p.color, col);
        c.dst.bind();
        BLEND.add(gl);

        let flash = 0, k = 0;
        for (const b of bolts) {
          const u = b.t / b.life;
          let inten = Math.pow(1 - u, 1.8);
          if (p.flicker > 0) inten *= 1 - p.flicker * 0.75 * (0.5 + 0.5 * Math.sin(b.t * 90 + b.segs.length));
          if (inten <= 0.001) continue;
          if (inten > flash) flash = inten;
          for (let i = 0; i < b.segs.length && k < CAP; i += 5) {
            const depth = b.segs[i + 4];
            const o = k * STRIDE;
            data[o] = b.segs[i]; data[o + 1] = b.segs[i + 1];
            data[o + 2] = b.segs[i + 2]; data[o + 3] = b.segs[i + 3];
            data[o + 4] = col[0]; data[o + 5] = col[1]; data[o + 6] = col[2];
            data[o + 7] = inten / (1 + depth * 0.9);
            data[o + 8] = p.thickness / (1 + depth * 0.55);
            data[o + 9] = i * 0.013;
            k++;
          }
        }
        if (!k) { gl.disable(gl.BLEND); return; }
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, k * STRIDE));
        pr.use();
        gl.uniform1f(pr.u.uAspect, c.aspect);
        gl.uniform1f(pr.u.uOpacity, c.opacity);
        gl.bindVertexArray(vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, k);
        gl.bindVertexArray(null);

        if (p.flash > 0.001 && flash > 0.001) {
          prFlash.use();
          gl.uniform3f(prFlash.u.uColor, col[0], col[1], col[2]);
          gl.uniform1f(prFlash.u.uAmt, flash * p.flash * 0.3 * c.opacity);
          ctx.screen.draw();
        }
        gl.disable(gl.BLEND);
      },
      dispose() { gl.deleteBuffer(vbo); if (vao) gl.deleteVertexArray(vao); },
    };
  },
};

// -------------------------------------------------------------------- aurora
const AURORA_FS = `#version 300 es
precision highp float;
#include <common>
#include <hash>
#include <noise>
in vec2 vUV;
uniform sampler2D uSdf;
uniform float uTime;
uniform float uAspect;
uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;
uniform float uOpacity;
uniform float uBands;
uniform float uSpeed;
uniform float uHeight;
uniform float uSharp;
uniform float uOcclude;
out vec4 o;
void main(){
  vec2 p = vec2(vUV.x, 1.0 - vUV.y);   // top-down, so the curtains hang from above
  float t = uTime * uSpeed;
  // domain warp: the curtain folds in on itself
  vec2 q = vec2(fbm(p * vec2(2.2, 1.1) + vec2(t * 0.12, 0.0), 4),
                fbm(p * vec2(2.6, 1.4) + vec2(5.2, t * 0.09), 4));
  float ridge = 0.0;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y0 = 0.18 + fi * 0.16 + 0.08 * sin(t * 0.4 + fi * 2.1);
    float w = mix(0.10, 0.34, hash11(fi + 3.0)) * uHeight;
    float x = p.x * uBands + q.x * 2.4 + t * (0.15 + fi * 0.05);
    float wob = fbm(vec2(x, fi * 7.3 + t * 0.2), 3);
    float yc = y0 + wob * 0.22 + q.y * 0.12;
    float d = abs(p.y - yc);
    float band = exp(-pow(d / w, mix(1.4, 3.2, uSharp)));
    // vertical striations, brighter at the bottom edge of the curtain
    float stri = 0.55 + 0.45 * fbm(vec2(x * 6.0, p.y * 3.0 + t * 0.5), 3);
    float foot = smoothstep(0.0, w * 1.6, p.y - yc + w);
    vec3 cc = i == 0 ? uC1 : (i == 1 ? uC2 : uC3);
    col += cc * band * stri * mix(0.35, 1.0, foot);
    ridge += band;
  }
  float occl = uOcclude > 0.5 ? step(0.0, texture(uSdf, vUV).r) : 1.0;
  float a = sat(ridge) * uOpacity * occl;
  o = vec4(col * uOpacity * occl * 1.5, a);
}`;

export const aurora = {
  type: 'aurora',
  label: 'Aurora',
  group: 'Energy',
  blend: 'add',
  hint: 'Slow folding curtains of light, hidden behind anything you have masked.',
  actions: [],
  params: [
    C('c1', 'Colour 1', '#2bff9e'),
    C('c2', 'Colour 2', '#3fa9ff'),
    C('c3', 'Colour 3', '#c86bff'),
    R('speed', 'Speed', 0.5, 0, 3),
    R('bands', 'Fold count', 2.2, 0.4, 8),
    R('height', 'Curtain height', 1, 0.2, 3),
    R('sharp', 'Edge', 0.5, 0, 1),
    R('intensity', 'Intensity', 0.9, 0, 3),
    B('occlude', 'Hidden by shapes', true),
  ],
  create(ctx) {
    const gl = ctx.gl;
    const pr = prog(gl, VS_SCREEN, AURORA_FS);
    const a = [0, 0, 0], b = [0, 0, 0], c3 = [0, 0, 0];
    return {
      resize() {}, step() {},
      draw(c) {
        const p = c.params;
        c.dst.bind();
        BLEND.add(gl);
        pr.use();
        bindTex(gl, 0, c.sdfTex, pr.u.uSdf);
        hexRgb(p.c1, a); hexRgb(p.c2, b); hexRgb(p.c3, c3);
        gl.uniform3f(pr.u.uC1, a[0], a[1], a[2]);
        gl.uniform3f(pr.u.uC2, b[0], b[1], b[2]);
        gl.uniform3f(pr.u.uC3, c3[0], c3[1], c3[2]);
        gl.uniform1f(pr.u.uTime, c.time);
        gl.uniform1f(pr.u.uAspect, c.aspect);
        gl.uniform1f(pr.u.uOpacity, c.opacity * p.intensity);
        gl.uniform1f(pr.u.uBands, p.bands);
        gl.uniform1f(pr.u.uSpeed, p.speed);
        gl.uniform1f(pr.u.uHeight, p.height * 0.25);
        gl.uniform1f(pr.u.uSharp, p.sharp);
        gl.uniform1f(pr.u.uOcclude, p.occlude ? 1 : 0);
        ctx.screen.draw();
        gl.disable(gl.BLEND);
      },
      dispose() {},
    };
  },
};

// ----------------------------------------------------------------- blackhole
const BH_FS = `#version 300 es
precision highp float;
#include <common>
#include <hash>
#include <noise>
in vec2 vUV;
uniform sampler2D uBg;
uniform sampler2D uSdf;
uniform vec2 uCentre;
uniform float uAspect;
uniform float uMass;
uniform float uRadius;
uniform float uSwirl;
uniform float uDisc;
uniform float uTime;
uniform float uOpacity;
uniform vec3 uHot;
out vec4 o;
void main(){
  vec2 d = (vUV - uCentre) * vec2(1.0, uAspect);
  float r = length(d);
  float a = atan(d.y, d.x);

  // deflection falls off like 1/r, twisted into a spiral by the swirl term
  float bend = uMass * 0.02 / max(r * r + 0.002, 1e-4);
  bend = min(bend, 1.6);
  float twist = uSwirl * bend * 1.4;
  vec2 dir = normalize(d + 1e-6);
  vec2 tang = vec2(-dir.y, dir.x);
  vec2 off = (-dir * bend * uRadius + tang * twist * uRadius) * vec2(1.0, 1.0 / uAspect);
  vec3 col = texture(uBg, clamp(vUV + off, vec2(0.0), vec2(1.0))).rgb;

  // event horizon
  float horizon = smoothstep(uRadius * 1.02, uRadius * 0.82, r);
  col *= 1.0 - horizon;

  // accretion disc: hot turbulent ring shear-rotating around the hole
  float ring = exp(-pow((r - uRadius * 1.55) / (uRadius * 0.75), 2.0));
  float turb = fbm(vec2(a * 2.4 + uTime * (0.7 + 1.4 / max(r, 0.05)), r * 26.0), 4);
  vec3 disc = uHot * ring * (0.35 + 1.5 * turb) * uDisc;
  disc *= 1.0 - horizon;
  col += disc;

  // a photon ring right at the edge
  col += uHot * exp(-pow((r - uRadius * 1.03) / (uRadius * 0.08), 2.0)) * uDisc * 1.4 * (1.0 - horizon);

  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const blackhole = {
  type: 'blackhole',
  label: 'Gravity well',
  group: 'Energy',
  blend: 'post',
  hint: 'Bends the picture around a point, with an accretion disc and a photon ring.',
  actions: [],
  params: [
    R('x', 'Position x', 0.5, -0.2, 1.2),
    R('y', 'Position y', 0.5, -0.2, 1.2),
    R('radius', 'Size', 0.09, 0.01, 0.4),
    R('mass', 'Lensing', 1, 0, 4),
    R('swirl', 'Frame drag', 0.6, -3, 3),
    R('disc', 'Accretion disc', 0.8, 0, 3),
    C('hot', 'Disc colour', '#ffb066'),
    R('drift', 'Drift', 0.15, 0, 2),
    B('followPointer', 'Follow the pointer', false),
  ],
  create(ctx) {
    const gl = ctx.gl;
    const pr = prog(gl, VS_SCREEN, BH_FS);
    const hot = [0, 0, 0];
    let cx = 0.5, cy = 0.5, t = 0;
    return {
      resize() {},
      step(dt, w, p) {
        t += dt;
        let tx = p.x, ty = p.y;
        if (p.followPointer && w.interactors.length) {
          tx = w.interactors[0].x;
          ty = w.interactors[0].y / w.aspect;
        } else {
          tx += Math.sin(t * 0.31) * 0.06 * p.drift;
          ty += Math.cos(t * 0.23) * 0.05 * p.drift;
        }
        cx += (tx - cx) * Math.min(1, dt * 4);
        cy += (ty - cy) * Math.min(1, dt * 4);
      },
      draw(c) {
        const p = c.params;
        c.dst.bind();
        gl.disable(gl.BLEND);
        pr.use();
        bindTex(gl, 0, c.src, pr.u.uBg);
        bindTex(gl, 1, c.sdfTex, pr.u.uSdf);
        gl.uniform2f(pr.u.uCentre, cx, 1 - cy);   // parameter is top-down, uv is bottom-up
        gl.uniform1f(pr.u.uAspect, c.aspect);
        gl.uniform1f(pr.u.uMass, p.mass);
        gl.uniform1f(pr.u.uRadius, p.radius);
        gl.uniform1f(pr.u.uSwirl, p.swirl);
        gl.uniform1f(pr.u.uDisc, p.disc);
        gl.uniform1f(pr.u.uTime, c.time);
        gl.uniform1f(pr.u.uOpacity, c.opacity);
        hexRgb(p.hot, hot);
        gl.uniform3f(pr.u.uHot, hot[0], hot[1], hot[2]);
        ctx.screen.draw();
      },
      dispose() {},
    };
  },
};
