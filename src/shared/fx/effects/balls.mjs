// Rigid spheres that fall into the room, bounce off the shapes you have
// blacked out and roll off their ledges. Rendered as screen-space impostors so
// they stay perfectly round at any size, with a real refraction of the video
// behind them in glass mode and a contact shadow that tightens as a ball
// approaches a surface.

import { prog, bindTex, BLEND, hexRgb } from '../glu.mjs';
import { SpriteBatch } from '../particles.mjs';
import { World, circleBody } from '../bodies.mjs';
import { R, B, C, S, Emitter, PALETTE_OPTIONS, paletteColor, ZONES, spawnPoint, lightDir, GLSL_SPHERE } from './common.mjs';

const VS = `#version 300 es
in vec2 iPos;
in vec4 iCol;
in vec4 iAttr;     // size, streak angle, stretch, seed
in vec4 iAttr2;    // spin (physics rotation), pattern id, unused, unused
out vec2 vLocal;
out vec4 vCol;
out vec4 vAttr;
out vec4 vAttr2;
out vec2 vUV;
out vec2 vCenter;
uniform float uAspect;
void main(){
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vLocal = corner;
  vCol = iCol; vAttr = iAttr; vAttr2 = iAttr2;
  float s = iAttr.x;
  // the quad is stretched along the direction of travel to fake motion blur,
  // so it is rotated into that direction here and the shading rotates back
  vec2 stretched = corner * vec2(iAttr.z, 1.0);
  float c = cos(iAttr.y), sn = sin(iAttr.y);
  vec2 off = vec2(stretched.x * c - stretched.y * sn, stretched.x * sn + stretched.y * c) * s;
  vec2 p = iPos + off;
  // framebuffer uv for background lookups; the picture's y runs the other way
  vUV = vec2(p.x, 1.0 - p.y / uAspect);
  vCenter = vec2(iPos.x, 1.0 - iPos.y / uAspect);
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - (p.y / uAspect) * 2.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
#include <common>
#include <hash>
#include <refract>
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec4 vAttr2; in vec2 vUV; in vec2 vCenter;
out vec4 o;
uniform sampler2D uBg;
uniform vec2 uLight;
uniform float uRough;
uniform float uGlass;
uniform float uMetal;
uniform float uVideoTint;
uniform float uOpacity;
${GLSL_SPHERE}

// Surface markings, drawn in the disc's own frame so they turn with it — this
// is what makes a ball read as rolling rather than sliding.
vec3 markings(vec2 d, vec3 albedo, float pattern, float seed){
  if (pattern < 0.5) return albedo;
  if (pattern < 1.5) {                       // bands across the ball
    float b = step(0.5, fract(d.y * 2.5 + 0.25));
    return mix(albedo, albedo * 0.38 + 0.04, b);
  }
  if (pattern < 2.5) {                       // spots
    vec2 g = d * 3.2;
    vec2 c = floor(g) + 0.5;
    float on = step(0.45, hash12(c + seed * 7.0));
    return mix(albedo, vec3(1.0) - albedo * 0.75, on * smoothstep(0.44, 0.30, length(g - c)));
  }
  if (pattern < 3.5) {                       // beach ball wedges
    float a = atan(d.y, d.x);
    float w = floor(fract(a / TAU + 1.0) * 6.0);
    vec3 tint = 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + w * 1.05);
    return mix(albedo, tint, 0.72);
  }
  float pole = smoothstep(0.34, 0.24, length(d));   // football
  float band = smoothstep(0.05, 0.0, abs(fract(atan(d.y, d.x) / TAU * 5.0) - 0.5) - 0.36);
  return mix(albedo, vec3(0.06), max(pole, band * 0.75));
}

void main(){
  // undo the motion stretch so the sphere stays round
  vec2 local = vec2(vLocal.x / max(0.001, vAttr.z), vLocal.y);
  Sphere sp = sphereAt(local);
  if (sp.mask <= 0.001) discard;

  // The quad is rotated into the direction of travel, so the impostor normal
  // comes out in quad space. Rotating it back into screen space is what keeps
  // the highlight in one place instead of swinging round as the ball moves.
  float ca = cos(vAttr.y), sa = sin(vAttr.y);
  vec3 n = vec3(sp.n.x * ca - sp.n.y * sa, sp.n.x * sa + sp.n.y * ca, sp.n.z);

  vec3 L = normalize(vec3(uLight, 0.75));
  vec3 albedo = vCol.rgb;
  if (uVideoTint > 0.0) {
    vec3 vid = texture(uBg, vCenter).rgb;
    albedo = mix(albedo, vid * 1.15 + 0.05, uVideoTint);
  }
  // markings live in the disc's frame, turned by the solver's rotation
  float spin = vAttr2.x;
  float cs = cos(-spin), ss = sin(-spin);
  vec2 discSpace = vec2(n.x * cs - n.y * ss, n.x * ss + n.y * cs);
  albedo = markings(discSpace, albedo, vAttr2.y, vAttr.w);

  vec3 col = shadeSolid(n, albedo, L, uRough, 0.22);
  if (uMetal > 0.0) {
    // a cheap studio environment reflected off the normal reads as chrome
    vec2 e = n.xy * 0.5 + 0.5;
    float bands = smoothstep(0.42, 0.58, fract(e.y * 3.0 + 0.15)) * 0.7 + 0.15;
    vec3 env = mix(vec3(0.05, 0.06, 0.09), vec3(1.0), bands);
    env += pow(max(dot(n, L), 0.0), 64.0) * 2.0;
    col = mix(col, env * albedo * 1.6, uMetal);
  }
  if (uGlass > 0.0) {
    vec3 bg = refractBg(uBg, vUV, n.xy, 0.055 * vAttr.x * 6.0, 1.34, vec2(0.22, 0.18));
    float f = fresnel(n, vec3(0.0, 0.0, 1.0), 0.06);
    vec3 tint = mix(vec3(1.0), albedo, 0.55);
    vec3 glass = bg * tint + vec3(f) * 0.5;
    glass += pow(max(dot(normalize(vec3(uLight, 0.75)), n), 0.0), 90.0) * 2.4;
    col = mix(col, glass, uGlass);
  }
  float a = sp.mask * uOpacity * vCol.a;
  o = vec4(col * a, a);
}`;

const SHADOW_FS = `#version 300 es
precision highp float;
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec2 vUV; in vec2 vCenter;
out vec4 o;
void main(){
  float r = length(vLocal);
  float a = (1.0 - smoothstep(0.15, 1.0, r)) * vCol.a;
  o = vec4(0.0, 0.0, 0.0, a);
}`;

const PATTERNS = ['none', 'stripes', 'spots', 'beach', 'football'];

const MATERIALS = {
  rubber: { rough: 0.85, glass: 0, metal: 0, e: 0.62, mu: 0.55, density: 1 },
  glass: { rough: 0.06, glass: 0.9, metal: 0, e: 0.38, mu: 0.2, density: 1.4 },
  metal: { rough: 0.18, glass: 0, metal: 0.9, e: 0.3, mu: 0.35, density: 4 },
  marble: { rough: 0.42, glass: 0.12, metal: 0.12, e: 0.45, mu: 0.4, density: 2 },
  beach: { rough: 0.7, glass: 0, metal: 0, e: 0.8, mu: 0.45, density: 0.35 },
};

export default {
  type: 'balls',
  label: 'Falling balls',
  group: 'Physics',
  blend: 'post',
  hint: 'Spheres drop in and bounce off every shape you have masked. Click the picture to swat them.',
  actions: [
    { name: 'burst', label: 'Drop a handful' },
    { name: 'clear', label: 'Clear' },
    { name: 'shake', label: 'Shake' },
  ],
  params: [
    R('count', 'Max balls', 90, 5, 500, 1),
    R('rate', 'Per second', 6, 0, 60, 0.5),
    S('from', 'Falls from', 'top', ZONES),
    R('size', 'Size', 0.022, 0.004, 0.09, 0.001),
    R('sizeVar', 'Size spread', 0.5, 0, 1),
    S('material', 'Material', 'rubber', Object.keys(MATERIALS).map((k) => [k, k[0].toUpperCase() + k.slice(1)])),
    S('palette', 'Palette', 'neon', PALETTE_OPTIONS),
    S('pattern', 'Markings', 'none', [['none', 'Plain'], ['stripes', 'Stripes'],
      ['spots', 'Spots'], ['beach', 'Beach ball'], ['football', 'Football']]),
    R('videoTint', 'Take colour from video', 0, 0, 1),
    R('gravity', 'Gravity', 1, -1, 3),
    R('bounce', 'Bounce', 1, 0, 1.6),
    R('spin', 'Spin', 1, 0, 3),
    R('motionBlur', 'Motion streak', 0.35, 0, 1),
    R('lightAngle', 'Light angle', 235, 0, 360, 1),
    R('shadow', 'Contact shadow', 0.55, 0, 1),
    B('fadeOut', 'Vanish after landing', false),
    R('life', 'Lifetime (s)', 14, 2, 60, 0.5),
  ],

  create(ctx) {
    const gl = ctx.gl;
    const cap = 520;
    const batch = new SpriteBatch(gl, cap, 14);       // + iAttr2 (spin, pattern)
    const shadowBatch = new SpriteBatch(gl, cap);
    const pr = prog(gl, VS, FS);
    const shadowPr = prog(gl, VS, SHADOW_FS);
    const world = new World();
    world.iterations = 9;
    const emitter = new Emitter();
    const rng = ctx.rng;
    const col = [0, 0, 0];
    const L = [0, 0];

    const spawn = (p, w, x, y, vx, vy) => {
      if (world.bodies.length >= p.count) return;
      const m = MATERIALS[p.material] || MATERIALS.rubber;
      const r = p.size * (1 + (rng.next() - 0.5) * p.sizeVar);
      paletteColor(p.palette, rng, col);
      const b = circleBody(x, y, Math.max(0.003, r), {
        e: Math.min(0.95, m.e * p.bounce), mu: m.mu, density: m.density,
        vx: vx || rng.gauss() * 0.05, vy: vy || 0,
        w: rng.gauss() * 4 * p.spin,
        data: { r: col[0], g: col[1], b: col[2], born: 0, life: p.life, seed: rng.next() },
      });
      world.add(b);
    };

    return {
      world,
      resize() {},

      action(name, arg, w, p) {
        if (name === 'clear') { world.clear(); return; }
        if (name === 'shake') {
          world.wakeAll();
          for (const b of world.bodies) { b.vx += (rng.next() - 0.5) * 1.2; b.vy -= rng.next() * 0.9; }
          return;
        }
        const n = arg || 18;
        const pt = [0, 0];
        for (let i = 0; i < n; i++) {
          spawnPoint(rng, p.from, w.aspect, pt);
          spawn(p, w, pt[0], pt[1], 0, 0);
        }
      },

      step(dt, w, p) {
        world.setStatics(w.field);
        const need = emitter.tick(dt, p.rate);
        const pt = [0, 0];
        for (let i = 0; i < need; i++) {
          spawnPoint(rng, p.from, w.aspect, pt);
          spawn(p, w, pt[0], pt[1]);
        }

        // pointer / camera interaction: a moving blob shoves the pile
        for (const it of w.interactors) {
          const r = it.r || 0.06, r2 = r * r;
          for (const b of world.bodies) {
            const dx = b.x - it.x, dy = b.y - it.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;
            const d = Math.sqrt(d2) || 1e-6;
            const f = (1 - d / r) * (it.strength == null ? 1 : it.strength);
            b.awake = true; b.sleepT = 0;
            b.vx += (dx / d) * f * 2.2 * dt * 60 * 0.05 + (it.vx || 0) * f * 0.6;
            b.vy += (dy / d) * f * 2.2 * dt * 60 * 0.05 + (it.vy || 0) * f * 0.6;
          }
        }

        world.step(dt, { gy: w.gy * p.gravity, gx: w.wind[0] * 0.25, damping: 0.05 });

        let dead = false;
        for (const b of world.bodies) {
          const d = b.data;
          d.born += dt;
          if (d.born > d.life || b.y > w.aspect + 0.4 || b.x < -0.4 || b.x > 1.4) { b.alive = false; dead = true; }
        }
        if (dead) world.remove((b) => !b.alive);
        // trim to the current cap from the oldest end
        while (world.bodies.length > p.count) world.bodies.shift();
      },

      draw(c) {
        const gl = c.gl || ctx.gl;
        const p = c.params;
        ctx.screen.copy(c.src, c.dst);
        c.dst.bind();
        lightDir(p.lightAngle, L);
        const field = c.field;
        const bodies = world.bodies;

        // contact shadows: march the distance field along the light to find
        // where the ball's shadow lands, and soften it with the gap
        if (p.shadow > 0.001) {
          const n = shadowBatch.fillFrom(bodies.length, (i, d, o) => {
            const b = bodies[i];
            let sx = b.x, sy = b.y, hit = 0.35;
            for (let s = 0; s < 10; s++) {
              const dist = field.sample(sx, sy);
              if (dist < b.r * 0.6) { hit = s / 10; break; }
              const step = Math.min(dist, 0.035);
              sx += L[0] * step; sy += L[1] * step;
              if (s === 9) hit = 1;
            }
            const soft = 1 + hit * 3.2;
            d[o] = sx; d[o + 1] = sy;
            d[o + 2] = 0; d[o + 3] = 0; d[o + 4] = 0;
            d[o + 5] = p.shadow * (1 - hit) * (b.data.fade == null ? 1 : b.data.fade);
            d[o + 6] = b.r * soft; d[o + 7] = 0; d[o + 8] = 1; d[o + 9] = 0;
          });
          if (n) {
            shadowPr.use();
            gl.uniform1f(shadowPr.u.uAspect, c.aspect);
            gl.enable(gl.BLEND);
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
            shadowBatch.draw(shadowPr);
          }
        }

        const m = MATERIALS[p.material] || MATERIALS.rubber;
        const blur = p.motionBlur;
        const pattern = PATTERNS.indexOf(p.pattern);
        const n = batch.fillFrom(bodies.length, (i, d, o) => {
          const b = bodies[i];
          const sp = Math.hypot(b.vx, b.vy);
          const stretch = 1 + Math.min(2.5, sp * 0.55) * blur;
          d[o] = b.x; d[o + 1] = b.y;
          d[o + 2] = b.data.r; d[o + 3] = b.data.g; d[o + 4] = b.data.b; d[o + 5] = 1;
          d[o + 6] = b.r * 1.02 * stretch;
          // only steer the quad into the travel direction when it is actually
          // being stretched, otherwise a nearly still ball jitters
          d[o + 7] = stretch > 1.01 && sp > 1e-3 ? Math.atan2(b.vy, b.vx) : 0;
          d[o + 8] = stretch;
          d[o + 9] = b.data.seed;
          d[o + 10] = b.angle; d[o + 11] = pattern < 0 ? 0 : pattern;
          d[o + 12] = 0; d[o + 13] = 0;
        });
        if (!n) return;
        pr.use();
        gl.uniform1f(pr.u.uAspect, c.aspect);
        bindTex(gl, 0, c.src, pr.u.uBg);
        gl.uniform2f(pr.u.uLight, L[0], -L[1]);
        gl.uniform1f(pr.u.uRough, m.rough);
        gl.uniform1f(pr.u.uGlass, m.glass);
        gl.uniform1f(pr.u.uMetal, m.metal);
        gl.uniform1f(pr.u.uVideoTint, p.videoTint);
        gl.uniform1f(pr.u.uOpacity, c.opacity);
        BLEND.over(gl);
        batch.draw(pr);
        gl.disable(gl.BLEND);
      },

      dispose() { batch.dispose(); shadowBatch.dispose(); },
    };
  },
};
