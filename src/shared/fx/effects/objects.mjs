// Solid objects with real geometry: polygons that stack on their flat sides,
// and emoji that tumble down the wall. Both are rigid bodies in the same
// solver as the balls, so they pile on your masked shapes the same way.

import { prog, bindTex, BLEND, hexRgb } from '../glu.mjs';
import { SpriteBatch } from '../particles.mjs';
import { World, circleBody, polyBody } from '../bodies.mjs';
import { R, B, C, S, T, Emitter, PALETTE_OPTIONS, paletteColor, ZONES, spawnPoint } from './common.mjs';

// ---------------------------------------------------------------- shapes ---
const SHAPE_VS = `#version 300 es
in vec2 iPos; in vec4 iCol; in vec4 iAttr;   // size, angle, sides, seed
out vec2 vLocal; out vec4 vCol; out vec4 vAttr; out vec2 vUV; out vec2 vCenter;
uniform float uAspect;
void main(){
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vLocal = corner; vCol = iCol; vAttr = iAttr;
  vec2 p = iPos + corner * iAttr.x;
  vUV = vec2(p.x, 1.0 - p.y / uAspect);
  vCenter = vec2(iPos.x, 1.0 - iPos.y / uAspect);
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - (p.y / uAspect) * 2.0, 0.0, 1.0);
}`;

const SHAPE_FS = `#version 300 es
precision highp float;
#include <common>
#include <hash>
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec2 vUV; in vec2 vCenter;
out vec4 o;
uniform sampler2D uBg;
uniform vec2 uLight;
uniform float uOpacity;
uniform float uBevel;
uniform float uGloss;
uniform float uVideoTint;

// distance to a regular n-gon of circumradius r, or to a star when n is negative
float sdShape(vec2 p, float r, float n){
  float a = atan(p.y, p.x);
  if (n < 0.0) {
    // negative side count means a radial shape: whole = points, .5 = petals
    float k = floor(-n + 0.001);
    float soft = step(0.25, -n - k);
    float w = 0.5 + 0.5 * cos(k * a);
    float m = mix(pow(w, 3.0), w, soft);
    return length(p) - r * (0.42 + 0.58 * m);
  }
  if (n < 2.5) return length(p) - r;               // disc
  float seg = TAU / n;
  return cos(floor(0.5 + a / seg) * seg - a) * length(p) - r * cos(seg * 0.5);
}

void main(){
  float spin = vAttr.y;
  float cs = cos(-spin), ss = sin(-spin);
  vec2 p = vec2(vLocal.x * cs - vLocal.y * ss, vLocal.x * ss + vLocal.y * cs);
  float d = sdShape(p, 0.86, vAttr.z);
  if (d > 0.0) discard;

  // an extruded face: the bevel band around the rim gets a normal that leans
  // outwards, which is enough to read as a solid slab under a moving light
  float bev = max(0.02, uBevel * 0.35);
  float e = sat(-d / bev);
  vec2 g = normalize(vec2(dFdx(d), dFdy(d)) + 1e-6);
  vec3 n = normalize(vec3(g * (1.0 - e) * 1.6, 0.35 + e));
  // back into screen space
  float c2 = cos(spin), s2 = sin(spin);
  n.xy = vec2(n.x * c2 - n.y * s2, n.x * s2 + n.y * c2);

  vec3 albedo = vCol.rgb;
  if (uVideoTint > 0.0) albedo = mix(albedo, texture(uBg, vCenter).rgb * 1.15 + 0.05, uVideoTint);

  vec3 L = normalize(vec3(uLight, 0.8));
  float diff = 0.35 + 0.75 * max(dot(n, L), 0.0);
  vec3 col = albedo * diff;
  col += pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), mix(6.0, 90.0, uGloss)) * uGloss * 1.3;
  col *= mix(0.72, 1.0, e);                        // darken into the bevel
  float a = sat(-d * 220.0) * uOpacity;            // one-pixel antialiased edge
  o = vec4(col * a, a);
}`;

const SHAPE_SHADOW_FS = `#version 300 es
precision highp float;
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec2 vUV; in vec2 vCenter;
out vec4 o;
void main(){
  float r = length(vLocal);
  o = vec4(0.0, 0.0, 0.0, (1.0 - smoothstep(0.2, 1.0, r)) * vCol.a);
}`;

const SHAPE_KINDS = [
  ['mixed', 'A bit of everything'], ['box', 'Squares'], ['triangle', 'Triangles'],
  ['pentagon', 'Pentagons'], ['hexagon', 'Hexagons'], ['star', 'Stars'],
  ['flower', 'Flowers'], ['disc', 'Discs'],
];
const SIDES = { box: 4, triangle: 3, pentagon: 5, hexagon: 6, star: -5, flower: -5.5, disc: 0 };

function shapeVerts(sides, r) {
  const n = Math.abs(sides) < 3 ? 12 : Math.round(Math.abs(sides));
  const out = [];
  // A star's physics uses the hull through its points: concave bodies are not
  // something the solver supports, and nobody notices on a tumbling object.
  const off = n % 2 ? -Math.PI / 2 : Math.PI / n;
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

export const shapes = {
  type: 'shapes',
  label: 'Falling shapes',
  group: 'Physics',
  blend: 'post',
  hint: 'Squares, triangles, hexagons and stars that tumble, land on a flat side and stack.',
  actions: [{ name: 'burst', label: 'Drop a handful' }, { name: 'clear', label: 'Clear' }, { name: 'shake', label: 'Shake' }],
  params: [
    R('count', 'Max objects', 90, 5, 400, 1),
    R('rate', 'Per second', 5, 0, 60, 0.5),
    S('kind', 'Shape', 'mixed', SHAPE_KINDS),
    S('from', 'Falls from', 'top', ZONES),
    R('size', 'Size', 0.03, 0.006, 0.12, 0.001),
    R('sizeVar', 'Size spread', 0.4, 0, 1),
    S('palette', 'Palette', 'candy', PALETTE_OPTIONS),
    R('videoTint', 'Take colour from video', 0, 0, 1),
    R('gravity', 'Gravity', 1, -1, 3),
    R('bounce', 'Bounce', 0.25, 0, 1.2),
    R('friction', 'Friction', 0.6, 0, 1),
    R('spin', 'Tumble', 1, 0, 3),
    R('bevel', 'Bevel', 0.5, 0, 1),
    R('gloss', 'Gloss', 0.35, 0, 1),
    R('shadow', 'Contact shadow', 0.45, 0, 1),
    R('lightAngle', 'Light angle', 235, 0, 360, 1),
    R('life', 'Lifetime (s)', 20, 2, 120, 0.5),
  ],

  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const cap = 420;
    const batch = new SpriteBatch(gl, cap);
    const shadows = new SpriteBatch(gl, cap);
    const pr = prog(gl, SHAPE_VS, SHAPE_FS);
    const prShadow = prog(gl, SHAPE_VS, SHAPE_SHADOW_FS);
    const world = new World();
    world.iterations = 9;
    const emitter = new Emitter();
    const col = [0, 0, 0];
    const L = [0, 0];
    const KEYS = Object.keys(SIDES);

    const spawn = (p, w, x, y) => {
      if (world.bodies.length >= p.count) return;
      const kind = p.kind === 'mixed' ? KEYS[rng.int(KEYS.length)] : p.kind;
      const sides = SIDES[kind] == null ? 4 : SIDES[kind];
      const r = Math.max(0.005, p.size * (1 + (rng.next() - 0.5) * p.sizeVar));
      paletteColor(p.palette, rng, col);
      const data = { r: col[0], g: col[1], b: col[2], sides, seed: rng.next(), born: 0 };
      const opts = {
        e: p.bounce * 0.7, mu: p.friction, density: 1,
        vx: rng.gauss() * 0.05, w: rng.gauss() * 3 * p.spin,
        angle: rng.range(0, 6.28), data,
      };
      const b = sides === 0
        ? circleBody(x, y, r * 0.86, opts)
        : polyBody(x, y, shapeVerts(sides, r * 0.86), opts);
      b.data.draw = r;                      // the sprite is a touch larger than the hull
      world.add(b);
    };

    return {
      resize() {},
      action(name, arg, w, p) {
        if (name === 'clear') { world.clear(); return; }
        if (name === 'shake') {
          world.wakeAll();
          for (const b of world.bodies) { b.vx += rng.gauss() * 1.1; b.vy -= rng.next() * 0.8; b.w += rng.gauss() * 5; }
          return;
        }
        const pt = [0, 0];
        for (let i = 0; i < (arg || 16); i++) { spawnPoint(rng, p.from, w.aspect, pt); spawn(p, w, pt[0], pt[1]); }
      },
      step(dt, w, p) {
        world.setStatics(w.field);
        const n = emitter.tick(dt, p.rate);
        const pt = [0, 0];
        for (let i = 0; i < n; i++) { spawnPoint(rng, p.from, w.aspect, pt); spawn(p, w, pt[0], pt[1]); }
        for (const it of w.interactors) {
          const r = it.r || 0.08, r2 = r * r;
          world.wake(it.x, it.y, r * 1.5);
          for (const b of world.bodies) {
            const dx = b.x - it.x, dy = b.y - it.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;
            const d = Math.sqrt(d2) || 1e-6;
            const f = (1 - d / r) * (it.strength == null ? 1 : it.strength);
            b.vx += (dx / d) * f * 1.8 + (it.vx || 0) * f;
            b.vy += (dy / d) * f * 1.8 + (it.vy || 0) * f;
            b.w += (rng.next() - 0.5) * f * 8;
          }
        }
        world.step(dt, { gy: w.gy * p.gravity, gx: w.wind[0] * 0.3, damping: 0.05 });
        let dead = false;
        for (const b of world.bodies) {
          b.data.born += dt;
          if (b.data.born > p.life || b.y > w.aspect + 0.4 || b.x < -0.4 || b.x > 1.4) { b.alive = false; dead = true; }
        }
        if (dead) world.remove((b) => !b.alive);
        while (world.bodies.length > p.count) world.bodies.shift();
      },
      draw(c) {
        const p = c.params;
        ctx.screen.copy(c.src, c.dst);
        c.dst.bind();
        const a = (p.lightAngle * Math.PI) / 180;
        L[0] = Math.cos(a); L[1] = Math.sin(a);
        const bodies = world.bodies;
        if (!bodies.length) return;

        if (p.shadow > 0.001) {
          const field = c.field;
          const m = shadows.fillFrom(bodies.length, (i, d, o) => {
            const b = bodies[i];
            let sx = b.x, sy = b.y, hit = 0.35;
            for (let s = 0; s < 10; s++) {
              const dist = field.sample(sx, sy);
              if (dist < b.r * 0.6) { hit = s / 10; break; }
              const st = Math.min(dist, 0.035);
              sx += L[0] * st; sy += L[1] * st;
              if (s === 9) hit = 1;
            }
            d[o] = sx; d[o + 1] = sy;
            d[o + 2] = 0; d[o + 3] = 0; d[o + 4] = 0; d[o + 5] = p.shadow * (1 - hit);
            d[o + 6] = b.data.draw * (1 + hit * 2.6); d[o + 7] = 0; d[o + 8] = 0; d[o + 9] = 0;
          });
          if (m) {
            prShadow.use();
            gl.uniform1f(prShadow.u.uAspect, c.aspect);
            gl.enable(gl.BLEND);
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
            shadows.draw(prShadow);
          }
        }

        const n = batch.fillFrom(bodies.length, (i, d, o) => {
          const b = bodies[i];
          d[o] = b.x; d[o + 1] = b.y;
          d[o + 2] = b.data.r; d[o + 3] = b.data.g; d[o + 4] = b.data.b; d[o + 5] = 1;
          d[o + 6] = b.data.draw; d[o + 7] = b.angle; d[o + 8] = b.data.sides; d[o + 9] = b.data.seed;
        });
        if (!n) return;
        pr.use();
        gl.uniform1f(pr.u.uAspect, c.aspect);
        bindTex(gl, 0, c.src, pr.u.uBg);
        gl.uniform2f(pr.u.uLight, L[0], -L[1]);
        gl.uniform1f(pr.u.uOpacity, c.opacity);
        gl.uniform1f(pr.u.uBevel, p.bevel);
        gl.uniform1f(pr.u.uGloss, p.gloss);
        gl.uniform1f(pr.u.uVideoTint, p.videoTint);
        BLEND.over(gl);
        batch.draw(pr);
        gl.disable(gl.BLEND);
      },
      dispose() { batch.dispose(); shadows.dispose(); },
    };
  },
};

// ----------------------------------------------------------------- emoji ---
const EMOJI_FS = `#version 300 es
precision highp float;
#include <common>
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec2 vUV; in vec2 vCenter;
out vec4 o;
uniform sampler2D uAtlas;
uniform vec2 uGrid;        // columns, rows
uniform float uOpacity;
void main(){
  float spin = vAttr.y;
  float cs = cos(-spin), ss = sin(-spin);
  vec2 p = vec2(vLocal.x * cs - vLocal.y * ss, vLocal.x * ss + vLocal.y * cs);
  vec2 cell = clamp(p * 0.5 + 0.5, 0.0, 1.0);
  float idx = vAttr.z;
  float cx = mod(idx, uGrid.x), cy = floor(idx / uGrid.x);
  vec2 uv = (vec2(cx, cy) + cell) / uGrid;
  vec4 t = texture(uAtlas, uv);          // premultiplied on upload
  if (t.a < 0.004) discard;
  o = t * uOpacity * vCol.a;
}`;

const EMOJI_SETS = [
  ['party', 'Party 🎉🎈🎂'], ['food', 'Food 🍕🍔🍩'], ['nature', 'Nature 🍁🌸🐝'],
  ['space', 'Space 🚀⭐️🪐'], ['sport', 'Sport ⚽️🏀🎾'], ['hearts', 'Hearts ❤️💜💛'],
  ['weather', 'Weather ☀️⛈❄️'], ['custom', 'Whatever you type'],
];
const SET_GLYPHS = {
  party: '🎉🎈🎂🥳🎊✨🍾🎁',
  food: '🍕🍔🍩🌮🍓🥑🍦🥨',
  nature: '🍁🌸🐝🍄🌻🦋🌿🐞',
  space: '🚀⭐️🪐🌙☄️👾🛸✨',
  sport: '⚽️🏀🎾🏈⚾️🏐🥏🎱',
  hearts: '❤️💜💛💚💙🧡🤍💖',
  weather: '☀️⛈❄️🌈⚡️🌪💧🌤',
};

/** Split a string into what a reader would call individual emoji. */
function glyphsOf(str) {
  const s = String(str || '').replace(/\s+/g, '');
  if (!s) return [];
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return [...seg.segment(s)].map((x) => x.segment).slice(0, 24);
  } catch {
    return [...s].slice(0, 24);
  }
}

export const emoji = {
  type: 'emoji',
  label: 'Emoji rain',
  group: 'Physics',
  blend: 'over',
  hint: 'Drops whatever emoji you like into the room. They bounce, tumble and pile up like anything else.',
  actions: [{ name: 'burst', label: 'Dump a load' }, { name: 'clear', label: 'Clear' }, { name: 'shake', label: 'Shake' }],
  params: [
    R('count', 'Max on screen', 80, 5, 300, 1),
    R('rate', 'Per second', 4, 0, 60, 0.5),
    S('set', 'Which', 'party', EMOJI_SETS),
    T('custom', 'Your emoji', '🍕🦆🌵'),
    S('from', 'Falls from', 'top', ZONES),
    R('size', 'Size', 0.045, 0.01, 0.2, 0.001),
    R('sizeVar', 'Size spread', 0.35, 0, 1),
    R('gravity', 'Gravity', 1, -1, 3),
    R('bounce', 'Bounce', 0.35, 0, 1.2),
    R('friction', 'Friction', 0.5, 0, 1),
    R('spin', 'Tumble', 1, 0, 4),
    R('life', 'Lifetime (s)', 20, 2, 120, 0.5),
  ],

  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const cap = 320;
    const batch = new SpriteBatch(gl, cap);
    const pr = prog(gl, SHAPE_VS, EMOJI_FS);
    const world = new World();
    world.iterations = 8;
    const emitter = new Emitter();
    let atlas = null, atlasKey = '', cols = 1, rows = 1, count = 1;

    const buildAtlas = (p) => {
      const glyphs = glyphsOf(p.set === 'custom' ? p.custom : SET_GLYPHS[p.set]);
      const key = glyphs.join('');
      if (!glyphs.length) return false;
      if (key === atlasKey && atlas) return true;
      atlasKey = key;
      count = glyphs.length;
      cols = Math.min(6, count);
      rows = Math.ceil(count / cols);
      const cell = 128;
      const cv = document.createElement('canvas');
      cv.width = cols * cell; cv.height = rows * cell;
      const x = cv.getContext('2d');
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.font = `${Math.round(cell * 0.78)}px "Apple Color Emoji","Segoe UI Emoji",system-ui,sans-serif`;
      glyphs.forEach((g, i) => {
        const cx = (i % cols) * cell + cell / 2;
        const cy = Math.floor(i / cols) * cell + cell / 2;
        x.fillText(g, cx, cy + cell * 0.04);
      });
      if (atlas) gl.deleteTexture(atlas);
      atlas = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return true;
    };

    const spawn = (p, w, x, y) => {
      if (world.bodies.length >= p.count) return;
      const r = Math.max(0.006, p.size * (1 + (rng.next() - 0.5) * p.sizeVar)) * 0.5;
      world.add(circleBody(x, y, r * 0.82, {
        e: p.bounce * 0.7, mu: p.friction, density: 1,
        vx: rng.gauss() * 0.05, w: rng.gauss() * 4 * p.spin,
        angle: rng.range(0, 6.28),
        data: { idx: rng.int(Math.max(1, count)), draw: r, born: 0 },
      }));
    };

    return {
      resize() {},
      action(name, arg, w, p) {
        if (name === 'clear') { world.clear(); return; }
        if (name === 'shake') {
          world.wakeAll();
          for (const b of world.bodies) { b.vx += rng.gauss() * 1.1; b.vy -= rng.next() * 0.8; b.w += rng.gauss() * 6; }
          return;
        }
        buildAtlas(p);
        const pt = [0, 0];
        for (let i = 0; i < (arg || 20); i++) { spawnPoint(rng, p.from, w.aspect, pt); spawn(p, w, pt[0], pt[1]); }
      },
      step(dt, w, p) {
        if (!buildAtlas(p)) return;
        world.setStatics(w.field);
        const n = emitter.tick(dt, p.rate);
        const pt = [0, 0];
        for (let i = 0; i < n; i++) { spawnPoint(rng, p.from, w.aspect, pt); spawn(p, w, pt[0], pt[1]); }
        for (const it of w.interactors) {
          const r = it.r || 0.08, r2 = r * r;
          world.wake(it.x, it.y, r * 1.5);
          for (const b of world.bodies) {
            const dx = b.x - it.x, dy = b.y - it.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;
            const d = Math.sqrt(d2) || 1e-6;
            const f = (1 - d / r) * (it.strength == null ? 1 : it.strength);
            b.vx += (dx / d) * f * 1.8 + (it.vx || 0) * f;
            b.vy += (dy / d) * f * 1.8 + (it.vy || 0) * f;
            b.w += (rng.next() - 0.5) * f * 9;
          }
        }
        world.step(dt, { gy: w.gy * p.gravity, gx: w.wind[0] * 0.3, damping: 0.05 });
        let dead = false;
        for (const b of world.bodies) {
          b.data.born += dt;
          if (b.data.born > p.life || b.y > w.aspect + 0.4 || b.x < -0.4 || b.x > 1.4) { b.alive = false; dead = true; }
        }
        if (dead) world.remove((b) => !b.alive);
        while (world.bodies.length > p.count) world.bodies.shift();
      },
      draw(c) {
        if (!atlas) return;
        const bodies = world.bodies;
        const n = batch.fillFrom(bodies.length, (i, d, o) => {
          const b = bodies[i];
          d[o] = b.x; d[o + 1] = b.y;
          d[o + 2] = 1; d[o + 3] = 1; d[o + 4] = 1;
          d[o + 5] = Math.min(1, b.data.born * 6);
          d[o + 6] = b.data.draw; d[o + 7] = b.angle;
          d[o + 8] = b.data.idx % count; d[o + 9] = 0;
        });
        if (!n) return;
        c.dst.bind();
        pr.use();
        gl.uniform1f(pr.u.uAspect, c.aspect);
        bindTex(gl, 0, atlas, pr.u.uAtlas);
        gl.uniform2f(pr.u.uGrid, cols, rows);
        gl.uniform1f(pr.u.uOpacity, c.opacity);
        BLEND.over(gl);
        batch.draw(pr);
        gl.disable(gl.BLEND);
      },
      dispose() { batch.dispose(); if (atlas) gl.deleteTexture(atlas); },
    };
  },
};
