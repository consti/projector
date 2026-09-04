// Bubbles and goo. Both are discs in the rigid solver — bubbles float up and
// burst, goo sticks to itself and creeps — but goo is drawn as a metaball
// surface so neighbouring blobs merge into one body of slime.

import { prog, bindTex, Target, BLEND, hexRgb, VS_SCREEN } from '../glu.mjs';
import { SpriteBatch, SPRITE_VS } from '../particles.mjs';
import { World, circleBody } from '../bodies.mjs';
import { R, B, C, S, Emitter, GLSL_SPHERE } from './common.mjs';

// ------------------------------------------------------------------ bubbles
const BUBBLE_FS = `#version 300 es
precision highp float;
#include <common>
#include <refract>
#include <hash>
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec2 vUV; in vec2 vCenter;
out vec4 o;
uniform sampler2D uBg;
uniform float uOpacity;
uniform float uIrid;
uniform vec2 uLight;
void main(){
  float r2 = dot(vLocal, vLocal);
  if (r2 > 1.0) discard;
  float z = sqrt(max(0.0, 1.0 - r2));
  vec3 n = vec3(vLocal, z);
  float f = fresnel(n, vec3(0.0, 0.0, 1.0), 0.03);

  // a soap film is mostly transparent in the middle and mirror-like at the rim
  vec3 bg = refractBg(uBg, vUV, n.xy, 0.05 * vAttr.x * 8.0, 1.05, vec2(0.5, 0.4));
  // thin-film interference: phase depends on the viewing angle through the film
  float phase = (1.0 - z) * 9.0 + vAttr.w * 6.0;
  vec3 film = 0.5 + 0.5 * cos(vec3(phase, phase + 2.1, phase + 4.2));
  vec3 col = bg + film * f * uIrid * 1.6;
  vec3 L = normalize(vec3(uLight, 0.8));
  col += pow(max(dot(n, L), 0.0), 120.0) * 2.2;
  col += pow(max(dot(n, normalize(vec3(-uLight, 0.6))), 0.0), 60.0) * 0.5;

  float a = (f * 0.9 + 0.10) * uOpacity * vCol.a * (1.0 - smoothstep(0.94, 1.0, r2));
  o = vec4(col * a, a);
}`;

export const bubbles = {
  type: 'bubbles',
  label: 'Bubbles',
  group: 'Physics',
  blend: 'post',
  hint: 'Soap bubbles rise, roll along the underside of your shapes and pop.',
  actions: [{ name: 'burst', label: 'Blow a stream' }, { name: 'popAll', label: 'Pop them all' }],
  params: [
    R('rate', 'Per second', 12, 0, 120, 1),
    R('count', 'Max bubbles', 90, 5, 400, 1),
    R('x', 'Source x', 0.5, 0, 1),
    R('spread', 'Source width', 0.35, 0, 1),
    R('size', 'Size', 0.028, 0.005, 0.12, 0.001),
    R('sizeVar', 'Size spread', 0.6, 0, 1),
    R('rise', 'Rise speed', 1, 0.1, 3),
    R('wobble', 'Wobble', 0.6, 0, 3),
    R('irid', 'Iridescence', 1, 0, 3),
    R('popChance', 'Fragility', 0.25, 0, 1),
    R('lightAngle', 'Light angle', 235, 0, 360, 1),
  ],
  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const cap = 420;
    const batch = new SpriteBatch(gl, cap);
    const pr = prog(gl, SPRITE_VS, BUBBLE_FS);
    const world = new World();
    world.iterations = 5;
    const emitter = new Emitter();

    const add = (p, w) => {
      if (world.bodies.length >= p.count) return;
      const r = p.size * (1 + (rng.next() - 0.5) * p.sizeVar);
      // just above the floor, not inside it
      world.add(circleBody(p.x + (rng.next() - 0.5) * p.spread, w.aspect - r * 1.2, Math.max(0.004, r), {
        e: 0.25, mu: 0.05, density: 0.25,
        vy: -0.2 * p.rise, vx: rng.gauss() * 0.03,
        data: { seed: rng.next(), phase: rng.range(0, 6.28), age: 0 },
      }));
    };

    return {
      resize() {},
      action(name, arg, w, p) {
        if (name === 'popAll') { world.clear(); return; }
        for (let i = 0; i < (arg || 40); i++) add(p, w);
      },
      step(dt, w, p) {
        world.setStatics(w.field);
        const n = emitter.tick(dt, p.rate);
        for (let i = 0; i < n; i++) add(p, w);
        for (const b of world.bodies) {
          b.data.age += dt;
          b.data.phase += dt * (1.5 + b.data.seed);
          // buoyancy plus a lazy sideways wobble
          b.vy -= w.gy * 1.35 * p.rise * dt;
          b.vx += Math.sin(b.data.phase) * p.wobble * 0.12 * dt * 10;
          b.vx *= 1 - 1.6 * dt; b.vy *= 1 - 1.2 * dt;
          b.awake = true;
        }
        for (const it of w.interactors) {
          const r = (it.r || 0.08) * 1.4, r2 = r * r;
          for (const b of world.bodies) {
            const dx = b.x - it.x, dy = b.y - it.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;
            if (it.down || rng.next() < p.popChance * 0.4) { b.alive = false; continue; }
            b.vx += (it.vx || 0) * 1.5 + dx * 4 * dt;
            b.vy += (it.vy || 0) * 1.5 + dy * 4 * dt;
          }
        }
        world.step(dt, { gy: 0, gx: w.wind[0] * 0.2 });
        let dead = false;
        for (const b of world.bodies) {
          const grazed = w.field.sample(b.x, b.y) < b.r * 1.02;
          const fragile = p.popChance * (grazed ? 1.6 : 0.12) * dt;
          if (b.y < -0.05 || b.data.age > 26 || rng.next() < fragile) { b.alive = false; dead = true; }
        }
        if (dead) world.remove((b) => !b.alive);
      },
      draw(c) {
        const p = c.params;
        ctx.screen.copy(c.src, c.dst);
        const bodies = world.bodies;
        const n = batch.fillFrom(bodies.length, (i, d, o) => {
          const b = bodies[i];
          d[o] = b.x; d[o + 1] = b.y;
          d[o + 2] = 1; d[o + 3] = 1; d[o + 4] = 1;
          d[o + 5] = Math.min(1, b.data.age * 3);
          d[o + 6] = b.r * 1.04; d[o + 7] = 0; d[o + 8] = 1; d[o + 9] = b.data.seed;
        });
        if (!n) return;
        c.dst.bind();
        pr.use();
        gl.uniform1f(pr.u.uAspect, c.aspect);
        gl.uniform1f(pr.u.uSizeScale, 1);
        gl.uniform1f(pr.u.uOpacity, c.opacity);
        gl.uniform1f(pr.u.uIrid, p.irid);
        gl.uniform2f(pr.u.uLight, Math.cos(p.lightAngle * Math.PI / 180), -Math.sin(p.lightAngle * Math.PI / 180));
        bindTex(gl, 0, c.src, pr.u.uBg);
        BLEND.over(gl);
        batch.draw(pr);
        gl.disable(gl.BLEND);
      },
      dispose() { batch.dispose(); },
    };
  },
};

// ---------------------------------------------------------------------- goo
const SPLAT_VS = `#version 300 es
in vec2 iPos; in vec4 iCol; in vec4 iAttr;
out vec2 vLocal; out vec3 vTint;
uniform float uAspect;
void main(){
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vLocal = corner; vTint = iCol.rgb;
  vec2 p = iPos + corner * iAttr.x;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - (p.y / uAspect) * 2.0, 0.0, 1.0);
}`;
const SPLAT_FS = `#version 300 es
precision highp float;
in vec2 vLocal; in vec3 vTint; out vec4 o;
void main(){
  float r2 = dot(vLocal, vLocal);
  if (r2 > 1.0) discard;
  float w = pow(1.0 - r2, 3.0);
  o = vec4(vTint * w, w);
}`;

const GOO_FS = `#version 300 es
precision highp float;
#include <common>
#include <refract>
#include <hash>
#include <noise>
in vec2 vUV;
uniform sampler2D uBg;
uniform sampler2D uDen;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uOpacity;
uniform float uGloss;
uniform float uTranslucency;
uniform float uRefract;
uniform vec2 uLight;
uniform float uTime;
out vec4 o;
void main(){
  vec4 s = texture(uDen, vUV);
  float d = s.a;
  float a = smoothstep(uThreshold * 0.7, uThreshold, d);
  vec3 bg = texture(uBg, vUV).rgb;
  if (a < 0.003) { o = vec4(bg, 1.0); return; }
  vec2 t = uTexel;
  float l = texture(uDen, vUV - vec2(t.x, 0.0)).a, r = texture(uDen, vUV + vec2(t.x, 0.0)).a;
  float dn = texture(uDen, vUV - vec2(0.0, t.y)).a, up = texture(uDen, vUV + vec2(0.0, t.y)).a;
  vec3 n = normalize(vec3(-(r - l) * 8.0, -(up - dn) * 8.0, 0.7));
  vec3 tint = s.a > 1e-4 ? s.rgb / s.a : vec3(0.5);
  vec3 L = normalize(vec3(uLight, 0.8));
  vec3 refr = refractBg(uBg, vUV, n.xy, uRefract, 1.4, vec2(0.25, 0.2));
  vec3 body = mix(tint * (0.25 + 0.85 * max(dot(n, L), 0.0)), refr * tint * 1.4, uTranslucency);
  float spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), mix(8.0, 150.0, uGloss));
  body += vec3(spec) * uGloss * 1.8;
  body += fresnel(n, vec3(0.0, 0.0, 1.0), 0.03) * 0.4 * tint;
  o = vec4(mix(bg, body, a * uOpacity), 1.0);
}`;

export const goo = {
  type: 'goo',
  label: 'Goo',
  group: 'Physics',
  blend: 'post',
  hint: 'Sticky blobs that merge into one another, ooze over ledges and hang in strands.',
  actions: [{ name: 'drop', label: 'Drop a blob' }, { name: 'clear', label: 'Clear' }],
  params: [
    R('rate', 'Per second', 5, 0, 60, 0.5),
    R('count', 'Max blobs', 120, 5, 500, 1),
    R('x', 'Source x', 0.5, 0, 1),
    R('spread', 'Source width', 0.2, 0, 1),
    R('size', 'Blob size', 0.022, 0.005, 0.08, 0.001),
    R('stick', 'Stickiness', 0.6, 0, 2),
    R('gravity', 'Gravity', 0.7, -1, 2),
    C('color', 'Colour', '#7cff4d'),
    C('color2', 'Second colour', '#00c2a8'),
    R('threshold', 'Surface', 0.5, 0.1, 1.5),
    R('gloss', 'Gloss', 0.7, 0, 1),
    R('translucency', 'Translucency', 0.5, 0, 1),
    R('refract', 'Refraction', 0.4, 0, 2),
    R('lightAngle', 'Light angle', 240, 0, 360, 1),
  ],
  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const cap = 520;
    const batch = new SpriteBatch(gl, cap);
    const prSplat = prog(gl, SPLAT_VS, SPLAT_FS);
    const prMain = prog(gl, VS_SCREEN, GOO_FS);
    const world = new World();
    world.iterations = 6;
    const emitter = new Emitter();
    let den = null, dw = 0, dh = 0;
    const c1 = [0, 0, 0], c2 = [0, 0, 0];

    const add = (p, w) => {
      if (world.bodies.length >= p.count) return;
      world.add(circleBody(p.x + (rng.next() - 0.5) * p.spread, -0.03,
        p.size * rng.range(0.7, 1.3), {
          e: 0.02, mu: 0.9, density: 1,
          data: { t: rng.next(), seed: rng.next() },
        }));
    };

    return {
      resize(w, h) {
        const sw = Math.max(64, Math.round(w * 0.5)), sh = Math.max(36, Math.round(h * 0.5));
        if (sw === dw && sh === dh) return;
        if (den) den.dispose();
        dw = sw; dh = sh;
        den = new Target(gl, sw, sh, 'rgba16f');
      },
      action(name, arg, w, p) {
        if (name === 'clear') { world.clear(); return; }
        for (let i = 0; i < (arg || 12); i++) add(p, w);
      },
      step(dt, w, p) {
        world.setStatics(w.field);
        const n = emitter.tick(dt, p.rate);
        for (let i = 0; i < n; i++) add(p, w);
        // cohesion: blobs within a couple of radii pull on each other, which
        // is what makes strands and drips instead of loose marbles
        const bodies = world.bodies;
        if (p.stick > 0) {
          for (let i = 0; i < bodies.length; i++) {
            const a = bodies[i];
            for (let j = i + 1; j < bodies.length; j++) {
              const b = bodies[j];
              const dx = b.x - a.x, dy = b.y - a.y;
              const d2 = dx * dx + dy * dy;
              const reach = (a.r + b.r) * 2.4;
              if (d2 > reach * reach || d2 < 1e-9) continue;
              const d = Math.sqrt(d2);
              const f = p.stick * (1 - d / reach) * dt * 2.4;
              a.vx += (dx / d) * f; a.vy += (dy / d) * f;
              b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
              a.awake = true; b.awake = true;
            }
          }
        }
        for (const it of w.interactors) {
          world.wake(it.x, it.y, (it.r || 0.08) * 2);
          for (const b of bodies) {
            const dx = b.x - it.x, dy = b.y - it.y;
            const r = it.r || 0.08;
            if (dx * dx + dy * dy > r * r) continue;
            b.vx += (it.vx || 0) * 1.2 + dx * 5 * dt;
            b.vy += (it.vy || 0) * 1.2 + dy * 5 * dt;
          }
        }
        world.step(dt, { gy: w.gy * p.gravity, gx: w.wind[0] * 0.2, damping: 0.4 });
        let dead = false;
        for (const b of bodies) if (b.y > w.aspect + 0.35) { b.alive = false; dead = true; }
        if (dead) world.remove((b) => !b.alive);
      },
      draw(c) {
        const p = c.params;
        if (!den) return;
        hexRgb(p.color, c1); hexRgb(p.color2, c2);
        den.bind([0, 0, 0, 0]);
        BLEND.add(gl);
        const bodies = world.bodies;
        const n = batch.fillFrom(bodies.length, (i, d, o) => {
          const b = bodies[i];
          const t = b.data.t;
          d[o] = b.x; d[o + 1] = b.y;
          d[o + 2] = c1[0] * (1 - t) + c2[0] * t;
          d[o + 3] = c1[1] * (1 - t) + c2[1] * t;
          d[o + 4] = c1[2] * (1 - t) + c2[2] * t;
          d[o + 5] = 1;
          d[o + 6] = b.r * 2.1; d[o + 7] = 0; d[o + 8] = 1; d[o + 9] = b.data.seed;
        });
        if (n) {
          prSplat.use();
          gl.uniform1f(prSplat.u.uAspect, c.aspect);
          batch.draw(prSplat);
        }
        gl.disable(gl.BLEND);

        c.dst.bind();
        prMain.use();
        bindTex(gl, 0, c.src, prMain.u.uBg);
        bindTex(gl, 1, den.tex, prMain.u.uDen);
        gl.uniform2f(prMain.u.uTexel, 1 / dw, 1 / dh);
        gl.uniform1f(prMain.u.uThreshold, p.threshold);
        gl.uniform1f(prMain.u.uOpacity, c.opacity);
        gl.uniform1f(prMain.u.uGloss, p.gloss);
        gl.uniform1f(prMain.u.uTranslucency, p.translucency);
        gl.uniform1f(prMain.u.uRefract, p.refract * 0.04);
        gl.uniform1f(prMain.u.uTime, c.time);
        gl.uniform2f(prMain.u.uLight, Math.cos(p.lightAngle * Math.PI / 180), -Math.sin(p.lightAngle * Math.PI / 180));
        ctx.screen.draw();
      },
      dispose() { batch.dispose(); if (den) den.dispose(); },
    };
  },
};
