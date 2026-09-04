// Dry granular material. Each grain is a real rigid disc with Coulomb
// friction, which is what makes a heap hold a slope, avalanche when you add to
// the top, and settle in the crook where a masked shape meets the wall.

import { prog, bindTex, BLEND, hexRgb } from '../glu.mjs';
import { SpriteBatch, SPRITE_VS } from '../particles.mjs';
import { World, circleBody } from '../bodies.mjs';
import { R, B, C, S, Emitter, PALETTE_OPTIONS, paletteColor, ZONES, spawnPoint } from './common.mjs';

const FS = `#version 300 es
precision highp float;
#include <common>
#include <hash>
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec2 vUV; in vec2 vCenter;
out vec4 o;
uniform vec2 uLight;
uniform float uOpacity;
void main(){
  float r2 = dot(vLocal, vLocal);
  if (r2 > 1.0) discard;
  float z = sqrt(max(0.0, 1.0 - r2));
  vec3 n = vec3(vLocal, z);
  vec3 L = normalize(vec3(uLight, 0.8));
  float diff = 0.35 + 0.75 * max(dot(n, L), 0.0);
  // per-grain tone jitter so a heap reads as thousands of grains, not dots
  float j = 0.75 + 0.5 * hash11(vAttr.w * 91.7);
  vec3 c = vCol.rgb * diff * j;
  c += pow(max(dot(n, L), 0.0), 30.0) * 0.35;
  float a = (1.0 - smoothstep(0.86, 1.0, r2)) * uOpacity;
  o = vec4(c * a, a);
}`;

export default {
  type: 'sand',
  label: 'Sand',
  group: 'Physics',
  blend: 'over',
  hint: 'Grains pour, avalanche and pile at a real angle of repose.',
  actions: [{ name: 'pour', label: 'Pour a scoop' }, { name: 'clear', label: 'Clear' }, { name: 'quake', label: 'Shake' }],
  params: [
    R('count', 'Grains', 700, 50, 2500, 10),
    R('rate', 'Per second', 90, 0, 600, 5),
    S('from', 'Pours from', 'top', ZONES),
    R('spread', 'Stream width', 0.03, 0, 0.6),
    R('x', 'Stream position', 0.5, 0, 1),
    R('size', 'Grain size', 0.006, 0.002, 0.02, 0.0005),
    C('color', 'Colour', '#e0c081'),
    C('color2', 'Second colour', '#a9793f'),
    R('mix', 'Colour mix', 0.4, 0, 1),
    R('friction', 'Friction', 0.9, 0.1, 1),
    R('bounce', 'Bounce', 0.05, 0, 0.6),
    R('gravity', 'Gravity', 1, 0, 3),
    R('lightAngle', 'Light angle', 235, 0, 360, 1),
  ],

  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const cap = 2600;
    const batch = new SpriteBatch(gl, cap);
    const pr = prog(gl, SPRITE_VS, FS);
    const world = new World();
    world.iterations = 6;
    world.cellSize = 0.02;
    const emitter = new Emitter();
    const c1 = [0, 0, 0], c2 = [0, 0, 0];

    const spawn = (p, w, x, y) => {
      if (world.bodies.length >= Math.min(cap, p.count)) return;
      const t = rng.next() < p.mix ? 1 : 0;
      world.add(circleBody(x, y, p.size * rng.range(0.75, 1.25), {
        e: p.bounce, mu: p.friction, density: 1,
        vx: rng.gauss() * 0.03, vy: 0.05,
        data: { t, seed: rng.next() },
      }));
    };

    return {
      resize() {},
      action(name, arg, w, p) {
        if (name === 'clear') { world.clear(); return; }
        if (name === 'quake') {
          world.wakeAll();
          for (const b of world.bodies) { b.vx += rng.gauss() * 0.5; b.vy -= rng.next() * 0.35; }
          return;
        }
        const pt = [0, 0];
        for (let i = 0; i < (arg || 200); i++) {
          spawnPoint(rng, p.from, w.aspect, pt);
          spawn(p, w, p.from === 'top' ? p.x + rng.gauss() * p.spread : pt[0], pt[1]);
        }
      },
      step(dt, w, p) {
        world.setStatics(w.field);
        const n = emitter.tick(dt, p.rate);
        const pt = [0, 0];
        for (let i = 0; i < n; i++) {
          spawnPoint(rng, p.from, w.aspect, pt);
          spawn(p, w, p.from === 'top' ? p.x + rng.gauss() * p.spread : pt[0], pt[1]);
        }
        for (const it of w.interactors) {
          world.wake(it.x, it.y, (it.r || 0.07) * 1.6);
          const r = it.r || 0.07, r2 = r * r;
          for (const b of world.bodies) {
            const dx = b.x - it.x, dy = b.y - it.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;
            const d = Math.sqrt(d2) || 1e-6;
            const f = (1 - d / r) * (it.strength == null ? 1 : it.strength);
            b.vx += (dx / d) * f * 0.9 + (it.vx || 0) * f * 0.8;
            b.vy += (dy / d) * f * 0.9 + (it.vy || 0) * f * 0.8;
          }
        }
        world.step(dt, { gy: w.gy * p.gravity, gx: w.wind[0] * 0.15 });
        let dead = false;
        for (const b of world.bodies) {
          if (b.y > w.aspect + 0.3 || b.x < -0.3 || b.x > 1.3) { b.alive = false; dead = true; }
        }
        if (dead) world.remove((b) => !b.alive);
        while (world.bodies.length > p.count) world.bodies.shift();
      },
      draw(c) {
        const p = c.params;
        hexRgb(p.color, c1); hexRgb(p.color2, c2);
        const bodies = world.bodies;
        const n = batch.fillFrom(bodies.length, (i, d, o) => {
          const b = bodies[i];
          const t = b.data.t ? c2 : c1;
          d[o] = b.x; d[o + 1] = b.y;
          d[o + 2] = t[0]; d[o + 3] = t[1]; d[o + 4] = t[2]; d[o + 5] = 1;
          d[o + 6] = b.r * 1.15; d[o + 7] = b.angle; d[o + 8] = 1; d[o + 9] = b.data.seed;
        });
        if (!n) return;
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
