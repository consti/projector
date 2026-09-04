// Two light-weight sprite effects that share the particle pool: confetti that
// tumbles and settles, and fireflies that flock, dodge your shapes and pool
// light on the wall around them.

import { prog, bindTex, BLEND, hexRgb } from '../glu.mjs';
import { Particles, SpriteBatch, SPRITE_VS } from '../particles.mjs';
import { R, B, C, S, Emitter, PALETTE_OPTIONS, paletteColor, ZONES, spawnPoint } from './common.mjs';

const CONFETTI_FS = `#version 300 es
precision highp float;
#include <common>
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec2 vUV; in vec2 vCenter;
out vec4 o;
uniform float uOpacity;
uniform vec2 uLight;
void main(){
  // vAttr.z carries the tumble phase: the card foreshortens and flips face
  float phase = vAttr.z;
  float fold = cos(phase);
  if (abs(vLocal.y) > abs(fold) + 0.02) discard;
  float ny = sign(fold) * sqrt(max(0.0, 1.0 - fold * fold));
  vec3 n = normalize(vec3(0.0, ny, abs(fold)));
  vec3 L = normalize(vec3(uLight, 0.8));
  float d = 0.35 + 0.85 * abs(dot(n, L));
  vec3 c = vCol.rgb * d;
  // the back of the card is darker, which is what sells the tumble
  if (fold < 0.0) c *= 0.55;
  c += pow(max(dot(n, L), 0.0), 40.0) * 0.8;
  float a = vCol.a * uOpacity;
  o = vec4(c * a, a);
}`;

const FIREFLY_FS = `#version 300 es
precision highp float;
#include <common>
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec2 vUV; in vec2 vCenter;
out vec4 o;
uniform float uOpacity;
uniform float uTime;
void main(){
  float r = length(vLocal);
  if (r > 1.0) discard;
  float pulse = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(uTime * 2.4 + vAttr.w * 40.0), 2.5);
  float core = pow(sat(1.0 - r * 3.2), 2.0);
  float halo = pow(sat(1.0 - r), 3.0) * 0.5;
  float a = (core + halo) * vCol.a * pulse * uOpacity;
  o = vec4(vCol.rgb * a * (1.0 + core * 2.5), a);
}`;

export const confetti = {
  type: 'confetti',
  label: 'Confetti',
  group: 'Particles',
  blend: 'over',
  hint: 'Paper cards tumble down, catch the light and settle on your shapes.',
  actions: [{ name: 'burst', label: 'Pop' }, { name: 'clear', label: 'Clear' }],
  params: [
    R('rate', 'Per second', 40, 0, 400, 1),
    S('from', 'From', 'top', ZONES),
    R('size', 'Card size', 0.012, 0.003, 0.05, 0.001),
    R('fall', 'Fall speed', 0.7, 0.05, 3),
    R('flutter', 'Flutter', 1, 0, 3),
    R('tumble', 'Tumble speed', 1, 0, 4),
    S('palette', 'Palette', 'candy', PALETTE_OPTIONS),
    R('life', 'Lifetime (s)', 9, 1, 40, 0.5),
    B('settle', 'Come to rest', true),
    R('lightAngle', 'Light angle', 240, 0, 360, 1),
  ],
  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const cap = Math.round(2600 * (ctx.quality.particles || 1));
    const P = new Particles(cap);
    const batch = new SpriteBatch(gl, cap);
    const pr = prog(gl, SPRITE_VS, CONFETTI_FS);
    const emitter = new Emitter();
    const col = [0, 0, 0];
    const pt = [0, 0];

    const add = (p, w) => {
      spawnPoint(rng, p.from, w.aspect, pt);
      paletteColor(p.palette, rng, col);
      P.spawn({
        x: pt[0], y: pt[1],
        vx: rng.gauss() * 0.1, vy: rng.range(0.1, 0.4) * p.fall,
        size: p.size * rng.range(0.7, 1.3),
        rot: rng.range(0, 6.28), vrot: rng.gauss() * 3 * p.tumble,
        r: col[0], g: col[1], b: col[2], a: 1,
        life: p.life * rng.range(0.7, 1.3), seed: rng.next(),
        aux: rng.range(0, 6.28),
      });
    };

    return {
      resize() {},
      action(name, arg, w, p) {
        if (name === 'clear') { P.reset(); return; }
        for (let i = 0; i < (arg || 220); i++) add(p, w);
      },
      step(dt, w, p) {
        const n = emitter.tick(dt, p.rate);
        for (let i = 0; i < n; i++) add(p, w);
        // tumble phase lives in aux; flutter sways with it so the card
        // "catches air" on the flat of the stroke
        const gy = w.gy * 0.55 * p.fall;
        for (let i = 0; i < P.n; i++) {
          if (!P.alive[i]) continue;
          P.aux[i] += dt * (2.5 + P.seed[i] * 3) * p.tumble;
          const flap = Math.sin(P.aux[i]);
          P.vx[i] += flap * p.flutter * 1.2 * dt;
          // lift on the flat of the stroke, capped below gravity so a card
          // always comes down in the end
          P.vy[i] -= Math.abs(flap) * Math.min(0.6, p.flutter * 0.35) * gy * dt;
        }
        P.step(dt, {
          field: w.field, gy, gx: w.wind[0] * 0.5,
          drag: 1.5, bounce: p.settle ? 0.05 : 0.35, friction: p.settle ? 3 : 0.8,
          aspect: w.aspect, useRadius: true,
        });
        if (p.settle) {
          for (let i = 0; i < P.n; i++) {
            if (!P.alive[i]) continue;
            if (w.field.sample(P.x[i], P.y[i]) < P.size[i] * 0.8) {
              P.vrot[i] *= 0.82;
              P.vx[i] *= 0.86; P.vy[i] *= 0.9;
            }
          }
        }
        for (const it of w.interactors) {
          const r = it.r || 0.08, r2 = r * r;
          for (let i = 0; i < P.n; i++) {
            if (!P.alive[i]) continue;
            const dx = P.x[i] - it.x, dy = P.y[i] - it.y;
            if (dx * dx + dy * dy > r2) continue;
            P.vx[i] += (it.vx || 0) * 1.4 + dx * 6 * dt;
            P.vy[i] += (it.vy || 0) * 1.4 + dy * 6 * dt;
            P.vrot[i] += (rng.next() - 0.5) * 8 * dt * 10;
          }
        }
      },
      draw(c) {
        const p = c.params;
        const n = batch.fill(P, (i, d, o) => {
          d[o + 5] = Math.min(1, P.life[i] / 1.2);
          d[o + 8] = P.aux[i];             // tumble phase -> vAttr.z
          d[o + 9] = P.seed[i];
        });
        if (!n) return;
        c.dst.bind();
        pr.use();
        gl.uniform1f(pr.u.uAspect, c.aspect);
        gl.uniform1f(pr.u.uSizeScale, 1);
        gl.uniform1f(pr.u.uOpacity, c.opacity);
        gl.uniform2f(pr.u.uLight, Math.cos(p.lightAngle * Math.PI / 180), -Math.sin(p.lightAngle * Math.PI / 180));
        BLEND.over(gl);
        batch.draw(pr);
        gl.disable(gl.BLEND);
      },
      dispose() { batch.dispose(); },
    };
  },
};

export const fireflies = {
  type: 'fireflies',
  label: 'Fireflies',
  group: 'Particles',
  blend: 'add',
  hint: 'A flock of glowing points that steer around your shapes and follow the pointer.',
  actions: [{ name: 'scatter', label: 'Scatter' }],
  params: [
    R('count', 'Count', 90, 5, 600, 1),
    R('size', 'Glow size', 0.018, 0.004, 0.09, 0.001),
    R('speed', 'Speed', 0.13, 0.01, 0.8),
    R('cohesion', 'Cohesion', 0.5, 0, 2),
    R('separation', 'Separation', 0.7, 0, 2),
    R('alignment', 'Alignment', 0.5, 0, 2),
    R('wander', 'Wander', 0.6, 0, 3),
    R('avoid', 'Shape avoidance', 1, 0, 3),
    C('color', 'Colour', '#ffe08a'),
    S('palette', 'Palette', 'gold', PALETTE_OPTIONS),
    B('multicolour', 'Multicolour', false),
    R('brightness', 'Brightness', 1.2, 0.1, 4),
    R('attract', 'Follow the pointer', 1, -2, 3),
  ],
  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const cap = 640;
    const P = new Particles(cap);
    const batch = new SpriteBatch(gl, cap);
    const pr = prog(gl, SPRITE_VS, FIREFLY_FS);
    const col = [0, 0, 0];
    const nrm = [0, 0];

    const add = (p, w) => {
      if (p.multicolour) paletteColor(p.palette, rng, col); else hexRgb(p.color, col);
      P.spawn({
        x: rng.next(), y: rng.next() * w.aspect,
        vx: rng.gauss() * 0.05, vy: rng.gauss() * 0.05,
        size: p.size * rng.range(0.6, 1.5),
        r: col[0], g: col[1], b: col[2], a: rng.range(0.5, 1),
        seed: rng.next(),
      });
    };

    return {
      resize() {},
      action(name, arg, w, p) {
        for (let i = 0; i < P.n; i++) if (P.alive[i]) { P.vx[i] += rng.gauss() * 0.6; P.vy[i] += rng.gauss() * 0.6; }
      },
      step(dt, w, p) {
        const want = Math.min(cap, Math.round(p.count));
        while (P.count < want) add(p, w);
        while (P.count > want) { for (let i = P.n - 1; i >= 0; i--) if (P.alive[i]) { P.kill(i); break; } }

        P.buildHash(0.09, w.aspect);
        for (let i = 0; i < P.n; i++) {
          if (!P.alive[i]) continue;
          let cx = 0, cy = 0, sx = 0, sy = 0, ax = 0, ay = 0, cnt = 0;
          const xi = P.x[i], yi = P.y[i];
          P.forEachNeighbor(xi, yi, (j) => {
            if (j === i || !P.alive[j]) return;
            const dx = P.x[j] - xi, dy = P.y[j] - yi;
            const d2 = dx * dx + dy * dy;
            if (d2 > 0.0081) return;
            cnt++;
            cx += P.x[j]; cy += P.y[j];
            ax += P.vx[j]; ay += P.vy[j];
            const d = Math.sqrt(d2) || 1e-5;
            if (d < 0.035) { sx -= dx / d * (0.035 - d); sy -= dy / d * (0.035 - d); }
          });
          if (cnt) {
            P.vx[i] += ((cx / cnt) - xi) * p.cohesion * dt * 1.5;
            P.vy[i] += ((cy / cnt) - yi) * p.cohesion * dt * 1.5;
            P.vx[i] += ((ax / cnt) - P.vx[i]) * p.alignment * dt * 1.5;
            P.vy[i] += ((ay / cnt) - P.vy[i]) * p.alignment * dt * 1.5;
          }
          P.vx[i] += sx * p.separation * dt * 60;
          P.vy[i] += sy * p.separation * dt * 60;
          P.vx[i] += (rng.next() - 0.5) * p.wander * dt * 2;
          P.vy[i] += (rng.next() - 0.5) * p.wander * dt * 2;

          // steer away from solid geometry before we get there
          const d = w.field.sample(xi, yi);
          if (d < 0.06) {
            w.field.grad(xi, yi, nrm);
            const k = (0.06 - d) * p.avoid * dt * 22;
            P.vx[i] += nrm[0] * k; P.vy[i] += nrm[1] * k;
          }
          for (const it of w.interactors) {
            const dx = it.x - xi, dy = it.y - yi;
            const dd = Math.hypot(dx, dy) || 1e-5;
            if (dd < 0.4) {
              const k = p.attract * (0.4 - dd) * dt * 2.4 * (it.strength == null ? 1 : it.strength);
              P.vx[i] += (dx / dd) * k; P.vy[i] += (dy / dd) * k;
            }
          }
          // keep them inside the frame and at a steady cruising speed
          if (xi < 0.03) P.vx[i] += dt * 0.9;
          if (xi > 0.97) P.vx[i] -= dt * 0.9;
          if (yi < 0.03) P.vy[i] += dt * 0.9;
          if (yi > w.aspect - 0.03) P.vy[i] -= dt * 0.9;
          const sp = Math.hypot(P.vx[i], P.vy[i]) || 1e-6;
          const target = p.speed * (0.6 + P.seed[i] * 0.8);
          const f = 1 + (target - sp) / sp * Math.min(1, dt * 3);
          P.vx[i] *= f; P.vy[i] *= f;
        }
        P.step(dt, { field: null, gy: 0, gx: 0, aspect: w.aspect, killOutside: false });
      },
      draw(c) {
        const p = c.params;
        const n = batch.fill(P, (i, d, o) => {
          d[o + 5] = P.a[i] * p.brightness;
          d[o + 9] = P.seed[i];
        });
        if (!n) return;
        c.dst.bind();
        pr.use();
        gl.uniform1f(pr.u.uAspect, c.aspect);
        gl.uniform1f(pr.u.uSizeScale, 1);
        gl.uniform1f(pr.u.uOpacity, c.opacity);
        gl.uniform1f(pr.u.uTime, c.time);
        BLEND.add(gl);
        batch.draw(pr);
        gl.disable(gl.BLEND);
      },
      dispose() { batch.dispose(); },
    };
  },
};
