// The picture breaks. A Voronoi crack pattern cuts the frame into convex
// shards; each shard becomes a rigid body but keeps the texture coordinates it
// had at rest, so it carries its piece of the *live* video down with it,
// tumbling and piling on the floor and on whatever you have masked.

import { prog, bindTex, BLEND, VS_SCREEN } from '../glu.mjs';
import { World, polyBody, updateWorldVerts } from '../bodies.mjs';
import { R, B, C, S } from './common.mjs';

const VS = `#version 300 es
in vec2 aPos;       // world position
in vec2 aUV;        // source uv (frozen at rest)
in vec3 aShade;     // x = inset 0..1, y = shard tilt, z = shard seed
out vec2 vUV; out vec3 vShade;
uniform float uAspect;
void main(){
  vUV = aUV; vShade = aShade;
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - (aPos.y / uAspect) * 2.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
#include <common>
#include <hash>
in vec2 vUV; in vec3 vShade;
out vec4 o;
uniform sampler2D uBg;
uniform float uOpacity;
uniform float uEdge;
uniform float uGlint;
uniform vec2 uLight;
void main(){
  vec3 c = texture(uBg, clamp(vUV, vec2(0.0), vec2(1.0))).rgb;
  // bevel: darken towards the cut edge, then a bright lip right on it
  float e = sat(vShade.x);
  float bevel = mix(1.0 - uEdge, 1.0, smoothstep(0.0, 0.28, e));
  float lip = (1.0 - smoothstep(0.0, 0.06, e)) * uEdge;
  vec3 col = c * bevel + vec3(lip) * 0.55;
  // the shard catches the light as it tumbles
  float tilt = vShade.y;
  float glint = pow(max(0.0, sin(tilt * 2.0 + hash11(vShade.z) * 6.28)), 12.0);
  col += glint * uGlint * vec3(1.0, 0.97, 0.9);
  o = vec4(col * uOpacity, uOpacity);
}`;

// How the picture comes back behind the falling shards.
const REVEAL_FS = `#version 300 es
precision highp float;
#include <common>
in vec2 vUV;
uniform sampler2D uBg;
uniform float uAmt;      // 0..1 through the transition
uniform float uBase;     // ghost of the picture left behind while broken
uniform float uStyle;
uniform float uAspect;
out vec4 o;
void main(){
  float a = 0.0;
  float t = sat(uAmt);
  if (uStyle < 0.5) {                       // fade
    a = t;
  } else if (uStyle < 1.5) {                // doors opening from the middle
    float d = abs(vUV.x - 0.5) * 2.0;
    a = smoothstep(1.0 - t - 0.06, 1.0 - t + 0.06, 1.0 - d);
  } else if (uStyle < 2.5) {                // wipe across
    a = smoothstep(vUV.x - 0.10, vUV.x + 0.02, t);
  } else if (uStyle < 3.5) {                // iris
    vec2 d = (vUV - 0.5) * vec2(1.0, uAspect);
    float r = length(d) / 0.58;
    a = smoothstep(r - 0.12, r + 0.02, t);
  } else {                                  // shards fly home, picture behind
    a = smoothstep(0.55, 1.0, t);
  }
  a = max(a, uBase);
  o = vec4(texture(uBg, vUV).rgb * a, 1.0);
}`;

const SHADOW_FS = `#version 300 es
precision highp float;
in vec2 vUV; in vec3 vShade; out vec4 o;
uniform float uOpacity;
void main(){ o = vec4(0.0, 0.0, 0.0, uOpacity); }`;

function clipHalfPlane(poly, px, py, dx, dy) {
  // keep the side where dot(p - point, dir) <= 0
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const da = (a[0] - px) * dx + (a[1] - py) * dy;
    const db = (b[0] - px) * dx + (b[1] - py) * dy;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function voronoi(seeds, aspect) {
  const rect = [[0, 0], [1, 0], [1, aspect], [0, aspect]];
  const cells = [];
  for (let i = 0; i < seeds.length; i++) {
    let poly = rect;
    for (let j = 0; j < seeds.length && poly.length >= 3; j++) {
      if (i === j) continue;
      const mx = (seeds[i][0] + seeds[j][0]) / 2, my = (seeds[i][1] + seeds[j][1]) / 2;
      const dx = seeds[j][0] - seeds[i][0], dy = seeds[j][1] - seeds[i][1];
      poly = clipHalfPlane(poly, mx, my, dx, dy);
    }
    if (poly.length >= 3) cells.push(poly);
  }
  return cells;
}

export default {
  type: 'shatter',
  label: 'Shatter',
  group: 'Physics',
  blend: 'post',
  hint: 'Cracks the picture into shards that fall and pile up. Press Break, or let it break on a timer.',
  actions: [{ name: 'break', label: 'Break it' }, { name: 'reform', label: 'Put it back' }],
  params: [
    R('pieces', 'Pieces', 70, 8, 260, 1),
    S('pattern', 'Crack pattern', 'impact', [['impact', 'Impact'], ['even', 'Even'], ['shards', 'Long shards']]),
    R('impactX', 'Impact x', 0.5, 0, 1),
    R('impactY', 'Impact y', 0.45, 0, 1),
    R('burst', 'Burst force', 0.6, 0, 3),
    R('gravity', 'Gravity', 1, -0.5, 3),
    R('bounce', 'Bounce', 0.15, 0, 1),
    R('spin', 'Tumble', 1, 0, 3),
    R('edge', 'Edge bevel', 0.45, 0, 1),
    R('glint', 'Glint', 0.35, 0, 2),
    R('shadow', 'Shadow', 0.45, 0, 1),
    R('auto', 'Re-break every (s)', 0, 0, 60, 1),
    R('reveal', 'Picture left behind', 0, 0, 1),
    R('reformAfter', 'Put it back after (s)', 0, 0, 60, 0.5),
    S('reformStyle', 'Comes back as', 'fade', [['fade', 'Fade in'], ['doors', 'Doors'],
      ['wipe', 'Wipe'], ['iris', 'Iris'], ['rebuild', 'Shards fly home']]),
    R('reformTime', 'Return takes (s)', 1.2, 0.15, 8, 0.05),
  ],

  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const pr = prog(gl, VS, FS);
    const prShadow = prog(gl, VS, SHADOW_FS);
    const prReveal = prog(gl, VS_SCREEN, REVEAL_FS);
    const world = new World();
    world.iterations = 8;
    let shards = [];
    let vbo = null, vao = null, vaoShadow = null, data = null, vertCount = 0;
    let broken = false, autoT = 0;
    let brokenT = 0, reformU = 0, reforming = false;
    const REFORM_STYLES = ['fade', 'doors', 'wipe', 'iris', 'rebuild'];

    const build = (p, w) => {
      world.clear();
      shards = [];
      const A = w.aspect;
      const n = Math.max(4, Math.round(p.pieces));
      const seeds = [];
      const ix = p.impactX, iy = p.impactY * A;
      for (let i = 0; i < n; i++) {
        if (p.pattern === 'impact') {
          // dense near the impact, sparse at the rim
          const a = rng.next() * Math.PI * 2;
          const r = Math.pow(rng.next(), 1.9) * 0.85;
          seeds.push([ix + Math.cos(a) * r, iy + Math.sin(a) * r * A * 1.6]);
        } else if (p.pattern === 'shards') {
          seeds.push([rng.next(), iy + (rng.next() - 0.5) * A * 2.2]);
        } else {
          seeds.push([rng.next(), rng.next() * A]);
        }
      }
      const cells = voronoi(seeds, A);
      for (const cell of cells) {
        let cx = 0, cy = 0;
        for (const v of cell) { cx += v[0]; cy += v[1]; }
        cx /= cell.length; cy /= cell.length;
        const local = cell.map((v) => [v[0] - cx, v[1] - cy]);
        const b = polyBody(cx, cy, local, {
          e: p.bounce, mu: 0.55, density: 1,
          data: { rest: [cx, cy], seed: rng.next(), verts: null },
        });
        b.data.verts = b.verts;
        updateWorldVerts(b);
        world.add(b);
        shards.push(b);
      }
      // kick everything away from the impact point
      for (const b of shards) {
        const dx = b.x - ix, dy = b.y - iy;
        const d = Math.hypot(dx, dy) || 1e-4;
        const f = p.burst * Math.exp(-d * 2.2) * 3.2;
        b.vx = (dx / d) * f + rng.gauss() * 0.05;
        b.vy = (dy / d) * f + rng.gauss() * 0.05 - 0.15 * p.burst;
        b.w = rng.gauss() * 6 * p.spin;
      }
      broken = true;
      brokenT = 0; reforming = false; reformU = 0;
      allocate();
    };

    // Freeze the physics and remember where every shard is, so the return
    // animation has something to interpolate from.
    const startReform = () => {
      reforming = true;
      reformU = 0;
      for (const b of shards) {
        b.data.from = [b.x, b.y, b.angle];
        b.vx = 0; b.vy = 0; b.w = 0;
      }
    };

    const finishReform = () => {
      reforming = false;
      broken = false;
      reformU = 0;
      brokenT = 0;
      autoT = 0;
      world.clear();
      shards = [];
      vertCount = 0;
    };

    const allocate = () => {
      let tris = 0;
      for (const b of shards) tris += b.verts.length / 2;   // fan from the centroid
      vertCount = tris * 3;
      data = new Float32Array(vertCount * 7);
      if (!vbo) vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      const mk = (program) => {
        const v = gl.createVertexArray();
        gl.bindVertexArray(v);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        const S = 28;
        const set = (name, size, off) => {
          const loc = program.a[name];
          if (loc == null || loc < 0) return;
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, size, gl.FLOAT, false, S, off);
        };
        set('aPos', 2, 0); set('aUV', 2, 8); set('aShade', 3, 16);
        gl.bindVertexArray(null);
        return v;
      };
      if (vao) gl.deleteVertexArray(vao);
      if (vaoShadow) gl.deleteVertexArray(vaoShadow);
      vao = mk(pr); vaoShadow = mk(prShadow);
    };

    const fill = (aspect, ox, oy) => {
      let k = 0;
      const put = (x, y, u, v, inset, tilt, seed) => {
        const o = k * 7;
        data[o] = x + ox; data[o + 1] = y + oy;
        data[o + 2] = u; data[o + 3] = v;
        data[o + 4] = inset; data[o + 5] = tilt; data[o + 6] = seed;
        k++;
      };
      for (const b of shards) {
        const wv = b.wv, n = wv.length / 2;
        const rest = b.data.rest;
        // uv into the background render target: v = 0 is the bottom of the picture
        const cu = rest[0], cv = 1 - rest[1] / aspect;
        const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          // UV of a vertex is its rest position, i.e. where it came from
          const lx0 = b.verts[i * 2], ly0 = b.verts[i * 2 + 1];
          const lx1 = b.verts[j * 2], ly1 = b.verts[j * 2 + 1];
          put(b.x, b.y, cu, cv, 1, b.angle, b.data.seed);
          put(wv[i * 2], wv[i * 2 + 1], cu + lx0, cv - ly0 / aspect, 0, b.angle, b.data.seed);
          put(wv[j * 2], wv[j * 2 + 1], cu + lx1, cv - ly1 / aspect, 0, b.angle, b.data.seed);
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, k * 7));
      return k;
    };

    return {
      resize() {},
      action(name, arg, w, p) {
        if (name === 'reform') {
          if (broken && !reforming) startReform(); else finishReform();
          return;
        }
        build(p, w);
      },
      step(dt, w, p) {
        // `auto` counts from the moment the picture is whole again, so a break
        // / hold / return cycle repeats cleanly
        if (p.auto > 0 && !broken) {
          autoT += dt;
          if (autoT > p.auto) { autoT = 0; build(p, w); }
        } else if (p.auto > 0 && broken && p.reformAfter <= 0) {
          autoT += dt;
          if (autoT > p.auto) { autoT = 0; build(p, w); }
        }
        if (!broken) return;

        brokenT += dt;
        if (!reforming && p.reformAfter > 0 && brokenT > p.reformAfter) startReform();

        if (reforming) {
          reformU = Math.min(1, reformU + dt / Math.max(0.1, p.reformTime));
          if (p.reformStyle === 'rebuild') {
            // ease the shards back onto their rest position
            const e = reformU * reformU * (3 - 2 * reformU);
            for (const b of shards) {
              const f = b.data.from, rest = b.data.rest;
              if (!f) continue;
              b.x = f[0] + (rest[0] - f[0]) * e;
              b.y = f[1] + (rest[1] - f[1]) * e;
              b.angle = f[2] * (1 - e);
              updateWorldVerts(b);
            }
          }
          if (reformU >= 1) finishReform();
          return;
        }

        world.setStatics(w.field);
        for (const it of w.interactors) {
          const r = (it.r || 0.08) * 1.5, r2 = r * r;
          for (const b of shards) {
            const dx = b.x - it.x, dy = b.y - it.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;
            const d = Math.sqrt(d2) || 1e-6;
            const f = (1 - d / r) * (it.strength == null ? 1 : it.strength);
            b.awake = true; b.sleepT = 0;
            b.vx += (dx / d) * f * 1.6 + (it.vx || 0) * f;
            b.vy += (dy / d) * f * 1.6 + (it.vy || 0) * f;
            b.w += (rng.next() - 0.5) * f * 6;
          }
        }
        world.step(dt, { gy: w.gy * p.gravity, gx: w.wind[0] * 0.3, damping: 0.02 });
        let dead = false;
        for (const b of shards) if (b.y > w.aspect + 0.6) { b.alive = false; dead = true; }
        if (dead) {
          world.remove((b) => !b.alive);
          shards = shards.filter((b) => b.alive);
          if (shards.length) allocate(); else { vertCount = 0; }
        }
      },
      draw(c) {
        const p = c.params;
        // Once it breaks the wall behind goes dark and only the shards carry
        // the picture — `reveal` leaves a ghost of it, and the return
        // transition brings it back underneath them.
        if (!broken || !shards.length) {
          ctx.screen.copy(c.src, c.dst, 1);
          return;
        }
        c.dst.bind();
        gl.disable(gl.BLEND);
        prReveal.use();
        bindTex(gl, 0, c.src, prReveal.u.uBg);
        gl.uniform1f(prReveal.u.uAmt, reforming ? reformU : 0);
        gl.uniform1f(prReveal.u.uBase, p.reveal);
        gl.uniform1f(prReveal.u.uStyle, Math.max(0, REFORM_STYLES.indexOf(p.reformStyle)));
        gl.uniform1f(prReveal.u.uAspect, c.aspect);
        ctx.screen.draw();
        if (!vertCount) return;
        c.dst.bind();
        if (p.shadow > 0.001) {
          const k = fill(c.aspect, 0.012, 0.016);
          prShadow.use();
          gl.uniform1f(prShadow.u.uAspect, c.aspect);
          gl.uniform1f(prShadow.u.uOpacity, p.shadow * c.opacity *
            (reforming && p.reformStyle !== 'rebuild' ? 1 - reformU * reformU : 1));
          gl.enable(gl.BLEND);
          gl.blendEquation(gl.FUNC_ADD);
          gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
          gl.bindVertexArray(vaoShadow);
          gl.drawArrays(gl.TRIANGLES, 0, k);
          gl.bindVertexArray(null);
        }
        const k = fill(c.aspect, 0, 0);
        pr.use();
        gl.uniform1f(pr.u.uAspect, c.aspect);
        bindTex(gl, 0, c.src, pr.u.uBg);
        const fade = reforming && p.reformStyle !== 'rebuild' ? 1 - reformU * reformU : 1;
        gl.uniform1f(pr.u.uOpacity, c.opacity * fade);
        gl.uniform1f(pr.u.uEdge, p.edge);
        gl.uniform1f(pr.u.uGlint, p.glint);
        BLEND.over(gl);
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLES, 0, k);
        gl.bindVertexArray(null);
        gl.disable(gl.BLEND);
      },
      dispose() {
        if (vbo) gl.deleteBuffer(vbo);
        if (vao) gl.deleteVertexArray(vao);
        if (vaoShadow) gl.deleteVertexArray(vaoShadow);
      },
    };
  },
};
