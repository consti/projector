// Growth. A space-colonisation algorithm seeds attractors over the open wall,
// then grows branches towards them — so the plant fills the space between your
// masked shapes and creeps around their edges rather than over them.
//
// The roots look for open wall: a root asked to start at the floor climbs out
// of a couch that has been masked across the bottom, so the creeper grows out
// of the top of the couch instead of dying inside it (which is what the first
// version did, silently). Stem thickness follows the pipe model — a stem is as
// thick as the square root of the growth it carries — so trunks are fat and
// tips are thin without a depth heuristic.

import { prog, BLEND, hexRgb } from '../glu.mjs';
import { SpriteBatch, SPRITE_VS } from '../particles.mjs';
import { R, B, C, S } from './common.mjs';

const SEG_VS = `#version 300 es
in vec2 iA; in vec2 iB; in vec4 iCol; in vec2 iAttr;   // wA, wB
out vec2 vLocal; out vec4 vCol; out vec2 vAttr;
uniform float uAspect;
void main(){
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vLocal = corner; vCol = iCol; vAttr = iAttr;
  vec2 d = iB - iA;
  float len = max(length(d), 1e-5);
  vec2 t = d / len, n = vec2(-t.y, t.x);
  float halfW = mix(iAttr.x, iAttr.y, corner.x * 0.5 + 0.5);
  // overlap the joints slightly so a chain of segments reads as one stem
  vec2 p = mix(iA - t * iAttr.x * 0.6, iB + t * iAttr.y * 0.6, corner.x * 0.5 + 0.5) + n * corner.y * halfW;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - (p.y / uAspect) * 2.0, 0.0, 1.0);
}`;

const SEG_FS = `#version 300 es
precision highp float;
#include <common>
#include <hash>
in vec2 vLocal; in vec4 vCol; in vec2 vAttr;
out vec4 o;
uniform float uOpacity;
uniform vec2 uLight;
void main(){
  float across = vLocal.y;
  // shade the stem like a cylinder, with a little bark grain
  float z = sqrt(max(0.0, 1.0 - across * across));
  vec3 n = normalize(vec3(across, 0.0, z));
  vec3 L = normalize(vec3(uLight, 0.7));
  float diff = 0.35 + 0.75 * max(dot(n, L), 0.0);
  float bark = 0.92 + 0.16 * hash12(floor(gl_FragCoord.xy * vec2(0.5, 0.11)));
  float a = smoothstep(1.0, 0.8, abs(across)) * vCol.a * uOpacity;
  vec3 c = vCol.rgb * diff * bark + pow(max(dot(n, L), 0.0), 24.0) * 0.25;
  o = vec4(c * a, a);
}`;

const LEAF_FS = `#version 300 es
precision highp float;
#include <common>
#include <hash>
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec2 vUV; in vec2 vCenter;
out vec4 o;
uniform float uOpacity;
uniform vec2 uLight;
void main(){
  // a pointed leaf: the stalk end at -x, the tip at +x
  vec2 q = vLocal;
  float w = 0.55 * (1.0 - q.x * q.x) * (1.0 + 0.25 * q.x);       // widest just past the middle
  float d = abs(q.y) - w;
  if (d > 0.0 || abs(q.x) > 1.0) discard;
  float grow = sat(vAttr.z);
  if (q.x > grow * 2.0 - 1.0) discard;                          // unfurls from the stalk
  float vein = smoothstep(0.05, 0.0, abs(q.y)) * 0.6;
  float side = smoothstep(0.0, 0.5, abs(q.y) / max(w, 1e-3));
  float shade = 0.7 + 0.5 * (1.0 - side) + 0.25 * dot(normalize(vec2(q.y, 0.6)), uLight);
  vec3 c = vCol.rgb * shade;
  c = mix(c, c * 1.3, vein);
  float a = sat(-d * 10.0) * vCol.a * uOpacity;
  o = vec4(c * a, a);
}`;

const FLOWER_FS = `#version 300 es
precision highp float;
#include <common>
#include <hash>
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec2 vUV; in vec2 vCenter;
out vec4 o;
uniform float uOpacity;
void main(){
  vec2 q = vLocal;
  float r = length(q);
  float ang = atan(q.y, q.x);
  float petals = 5.0 + floor(vAttr.w * 3.0);
  float lobe = 0.62 + 0.38 * pow(abs(cos(ang * petals * 0.5)), 0.7);
  float grow = sat(vAttr.z);
  float edge = lobe * grow;
  if (r > edge) discard;
  float centre = smoothstep(0.32, 0.18, r);
  vec3 c = mix(vCol.rgb, vec3(1.0, 0.92, 0.45), centre);
  c *= 0.75 + 0.35 * (1.0 - r / max(edge, 1e-3)) + 0.15 * hash12(q * 40.0);
  float a = sat((edge - r) * 12.0) * vCol.a * uOpacity;
  o = vec4(c * a, a);
}`;

export default {
  type: 'vines',
  label: 'Vines',
  group: 'Growth',
  blend: 'over',
  hint: 'Creepers grow across the open wall, filling the gaps between your shapes and climbing out of the ones at the floor.',
  actions: [{ name: 'grow', label: 'Grow' }, { name: 'reset', label: 'Reset' }],
  params: [
    R('speed', 'Growth speed', 1, 0.05, 6),
    R('density', 'Density', 700, 40, 2500, 10),
    R('reach', 'Reach', 0.16, 0.03, 0.5),
    R('kill', 'Fill in', 0.03, 0.005, 0.15, 0.001),
    R('step', 'Segment length', 0.012, 0.003, 0.05, 0.001),
    R('thick', 'Stem thickness', 0.004, 0.0006, 0.015, 0.0001),
    R('wander', 'Wander', 0.35, 0, 1),
    R('gravitropism', 'Climb', 0.25, -1, 1),
    C('stem', 'Stem', '#4a6b2f'),
    C('leaf', 'Leaf', '#5fc75a'),
    C('leaf2', 'Second leaf colour', '#b8d64a'),
    R('leaves', 'Leaves', 0.7, 0, 1),
    R('leafSize', 'Leaf size', 0.016, 0.003, 0.05, 0.001),
    R('flowers', 'Flowers', 0.25, 0, 1),
    C('flower', 'Flower colour', '#ff6fb1'),
    R('lightAngle', 'Light angle', 240, 0, 360, 1),
    S('root', 'Roots at', 'bottom', [['bottom', 'The floor'], ['top', 'The ceiling'], ['edges', 'Both sides'], ['shapes', 'Around the shapes']]),
    B('regrow', 'Start over when finished', true),
  ],

  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const CAP = 12000;
    const STRIDE = 10;
    const data = new Float32Array(CAP * STRIDE);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    const pr = prog(gl, SEG_VS, SEG_FS);
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
    const leafBatch = new SpriteBatch(gl, 6000);
    const prLeaf = prog(gl, SPRITE_VS, LEAF_FS);
    const flowerBatch = new SpriteBatch(gl, 1500);
    const prFlower = prog(gl, SPRITE_VS, FLOWER_FS);

    let nodes = [];        // { x, y, parent, depth, grow, sub }
    let attractors = null; // Float32Array pairs
    let live = null;       // Uint8Array
    let leaves = [];
    let flowers = [];
    let acc = 0, built = false, finished = false, fade = 1, doneAt = 0;
    const cStem = [0, 0, 0], cLeaf = [0, 0, 0], cLeaf2 = [0, 0, 0], cFlower = [0, 0, 0];

    // uniform grid over the nodes so each attractor only looks nearby
    let grid = null, gcw = 0, gcols = 0, grows = 0;
    const gridReset = (reach, A) => {
      gcw = Math.max(reach, 0.02);
      gcols = Math.ceil(1.2 / gcw) + 2; grows = Math.ceil((A + 0.2) / gcw) + 2;
      grid = new Array(gcols * grows);
      for (let i = 0; i < nodes.length; i++) gridAdd(i);
    };
    const gcell = (x, y) => {
      const cx = Math.max(0, Math.min(gcols - 1, Math.floor((x + 0.1) / gcw)));
      const cy = Math.max(0, Math.min(grows - 1, Math.floor((y + 0.1) / gcw)));
      return cy * gcols + cx;
    };
    const gridAdd = (i) => { const c = gcell(nodes[i].x, nodes[i].y); (grid[c] || (grid[c] = [])).push(i); };

    // the nearest open point to (x, y), searched along the direction (dx, dy)
    const openPoint = (w, x, y, dx, dy) => {
      for (let k = 0; k < 60; k++) {
        const px = x + dx * k * 0.008, py = y + dy * k * 0.008;
        if (px < 0.003 || px > 0.997 || py < 0.003 || py > w.aspect - 0.003) break;
        if (w.field.sample(px, py) > 0.012) return [px, py];
      }
      return null;
    };

    const seed = (p, w) => {
      nodes = []; leaves = []; flowers = []; finished = false; fade = 1;
      const A = w.aspect;
      const n = Math.round(p.density);
      const pts = [];
      let guard = 0;
      while (pts.length < n && guard++ < n * 30) {
        const x = rng.next(), y = rng.next() * A;
        if (w.field.sample(x, y) < 0.012) continue;      // not inside a shape
        pts.push(x, y);
      }
      attractors = new Float32Array(pts);
      live = new Uint8Array(pts.length / 2).fill(1);

      const roots = [];
      const tryRoot = (x, y, dx, dy) => { const r = openPoint(w, x, y, dx, dy); if (r) roots.push(r); };
      if (p.root === 'bottom') for (let i = 0; i < 6; i++) tryRoot(0.08 + 0.168 * i + rng.gauss() * 0.02, A - 0.004, 0, -1);
      else if (p.root === 'top') for (let i = 0; i < 6; i++) tryRoot(0.08 + 0.168 * i + rng.gauss() * 0.02, 0.004, 0, 1);
      else if (p.root === 'edges') for (let i = 0; i < 4; i++) { tryRoot(0.004, A * (0.2 + 0.2 * i), 1, 0); tryRoot(0.996, A * (0.2 + 0.2 * i), -1, 0); }
      else {
        const g = [0, 0];
        for (const poly of w.field.polys) {
          const every = Math.max(1, Math.floor(poly.length / 4));
          for (let i = 0; i < poly.length; i += every) {
            const q = poly[i];
            w.field.grad(q[0], q[1], g);
            tryRoot(q[0] + g[0] * 0.01, q[1] + g[1] * 0.01, g[0], g[1]);
          }
        }
      }
      if (!roots.length) tryRoot(0.5, A - 0.004, 0, -1);
      if (!roots.length) roots.push([0.5, A * 0.5]);
      for (const r of roots) nodes.push({ x: r[0], y: r[1], parent: -1, depth: 0, grow: 1, sub: 1 });
      gridReset(p.reach, A);
      built = true;
    };

    const near = [];
    const grow = (p, w) => {
      if (!attractors || finished) return;
      const reach = p.reach, killR = p.kill, step = p.step;
      if (Math.abs(gcw - Math.max(reach, 0.02)) > 1e-6) gridReset(reach, w.aspect);
      const dirs = new Float64Array(nodes.length * 2);
      const cnt = new Int32Array(nodes.length);
      const na = attractors.length / 2;
      let remaining = 0;
      const r2 = reach * reach;
      for (let a = 0; a < na; a++) {
        if (!live[a]) continue;
        remaining++;
        const ax = attractors[a * 2], ay = attractors[a * 2 + 1];
        let best = -1, bestD = r2;
        const cx = Math.floor((ax + 0.1) / gcw), cy = Math.floor((ay + 0.1) / gcw);
        for (let j = cy - 1; j <= cy + 1; j++) {
          if (j < 0 || j >= grows) continue;
          for (let i = cx - 1; i <= cx + 1; i++) {
            if (i < 0 || i >= gcols) continue;
            const bucket = grid[j * gcols + i];
            if (!bucket) continue;
            for (const ni of bucket) {
              const dx = ax - nodes[ni].x, dy = ay - nodes[ni].y;
              const d2 = dx * dx + dy * dy;
              if (d2 < bestD) { bestD = d2; best = ni; }
            }
          }
        }
        if (best < 0) continue;
        if (bestD < killR * killR) { live[a] = 0; continue; }
        const d = Math.sqrt(bestD) || 1e-6;
        dirs[best * 2] += (ax - nodes[best].x) / d;
        dirs[best * 2 + 1] += (ay - nodes[best].y) / d;
        cnt[best]++;
      }
      if (!remaining) { finished = true; return; }
      const added = [];
      const N = nodes.length;
      const g = [0, 0];
      for (let i = 0; i < N; i++) {
        if (!cnt[i]) continue;
        let dx = dirs[i * 2], dy = dirs[i * 2 + 1];
        dy -= p.gravitropism * cnt[i] * 0.6;             // climb towards the light
        dx += rng.gauss() * p.wander * cnt[i] * 0.5;    // a creeper never goes straight
        dy += rng.gauss() * p.wander * cnt[i] * 0.5;
        const l = Math.hypot(dx, dy) || 1e-6;
        dx /= l; dy /= l;
        let nx = nodes[i].x + dx * step, ny = nodes[i].y + dy * step;
        if (w.field.sample(nx, ny) < 0.004) {
          // do not grow into a shape: slide along its edge instead
          w.field.grad(nx, ny, g);
          const t = dx * g[1] - dy * g[0] >= 0 ? [-g[1], g[0]] : [g[1], -g[0]];
          nx = nodes[i].x + t[0] * step; ny = nodes[i].y + t[1] * step;
          if (w.field.sample(nx, ny) < 0.004) continue;
        }
        if (nx < -0.02 || nx > 1.02 || ny < -0.02 || ny > w.aspect + 0.02) continue;
        added.push({ x: nx, y: ny, parent: i, depth: nodes[i].depth + 1, grow: 0, sub: 1 });
      }
      for (const nd of added) {
        nodes.push(nd);
        gridAdd(nodes.length - 1);
        const r = rng.next();
        if (r < p.leaves * 0.6) {
          const side = rng.next() < 0.5 ? -1 : 1;
          const dirA = Math.atan2(nd.y - nodes[nd.parent].y, nd.x - nodes[nd.parent].x);
          leaves.push({ x: nd.x, y: nd.y, rot: dirA + side * rng.range(0.6, 1.3), grow: 0, seed: rng.next(),
            size: p.leafSize * rng.range(0.6, 1.4), tint: rng.next() });
        } else if (r < p.leaves * 0.6 + p.flowers * 0.12) {
          flowers.push({ x: nd.x, y: nd.y, rot: rng.range(0, 6.28), grow: 0, seed: rng.next(), size: p.leafSize * rng.range(0.5, 0.9) });
        }
      }
      if (!added.length) finished = true;
      if (nodes.length > CAP) finished = true;
      if (finished) doneAt = 0;
    };

    // pipe model: every node carries the count of its descendants
    const subtree = () => {
      for (const nd of nodes) nd.sub = 1;
      for (let i = nodes.length - 1; i > 0; i--) {
        const pa = nodes[i].parent;
        if (pa >= 0) nodes[pa].sub += nodes[i].sub;
      }
    };

    return {
      resize() {},
      onWorldChanged() { built = false; },
      action(name, arg, w, p) {
        if (name === 'reset') { nodes = []; leaves = []; flowers = []; attractors = null; built = false; return; }
        if (!built) seed(p, w);
        for (let i = 0; i < 40; i++) grow(p, w);
      },
      step(dt, w, p) {
        if (!built) seed(p, w);
        if (finished) {
          if (p.regrow) {
            doneAt += dt;
            if (doneAt > 5) fade = Math.max(0, fade - dt * 0.7);       // wither, then start again
            if (fade <= 0) { acc = 0; seed(p, w); }
          }
        } else {
          acc += dt * p.speed * 26;
          let guard = 0;
          while (acc >= 1 && guard++ < 8) { acc -= 1; grow(p, w); }
        }
        for (const nd of nodes) if (nd.grow < 1) nd.grow = Math.min(1, nd.grow + dt * 4);
        for (const lf of leaves) if (lf.grow < 1) lf.grow = Math.min(1, lf.grow + dt * 1.4);
        for (const fl of flowers) if (fl.grow < 1) fl.grow = Math.min(1, fl.grow + dt * 0.8);
      },
      draw(c) {
        const p = c.params;
        if (nodes.length < 2) return;
        hexRgb(p.stem, cStem); hexRgb(p.leaf, cLeaf); hexRgb(p.leaf2, cLeaf2); hexRgb(p.flower, cFlower);
        c.dst.bind();
        BLEND.over(gl);
        const light = [Math.cos(p.lightAngle * Math.PI / 180), -Math.sin(p.lightAngle * Math.PI / 180)];
        const alpha = fade;

        subtree();
        let maxSub = 1;
        for (const n of nodes) if (n.parent < 0 && n.sub > maxSub) maxSub = n.sub;
        let k = 0;
        for (let i = 0; i < nodes.length && k < CAP; i++) {
          const nd = nodes[i];
          if (nd.parent < 0) continue;
          const pa = nodes[nd.parent];
          // thickness from the growth a stem carries, never thinner than a tendril
          const wA = p.thick * Math.max(0.16, Math.sqrt(pa.sub / maxSub));
          const wB = p.thick * Math.max(0.16, Math.sqrt(nd.sub / maxSub));
          const g = nd.grow;
          const o = k * STRIDE;
          data[o] = pa.x; data[o + 1] = pa.y;
          data[o + 2] = pa.x + (nd.x - pa.x) * g; data[o + 3] = pa.y + (nd.y - pa.y) * g;
          // young wood is greener, old wood browner
          const age = Math.min(1, Math.sqrt(nd.sub / maxSub) * 1.4);
          data[o + 4] = cStem[0] * (1.1 - 0.35 * age) + cLeaf[0] * 0.25 * (1 - age);
          data[o + 5] = cStem[1] * (1.1 - 0.35 * age) + cLeaf[1] * 0.25 * (1 - age);
          data[o + 6] = cStem[2] * (1.1 - 0.35 * age) + cLeaf[2] * 0.25 * (1 - age);
          data[o + 7] = alpha;
          data[o + 8] = wA; data[o + 9] = wB;
          k++;
        }
        if (k) {
          gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, k * STRIDE));
          pr.use();
          gl.uniform1f(pr.u.uAspect, c.aspect);
          gl.uniform1f(pr.u.uOpacity, c.opacity);
          gl.uniform2f(pr.u.uLight, light[0], light[1]);
          gl.bindVertexArray(vao);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, k);
          gl.bindVertexArray(null);
        }

        if (p.leaves > 0 && leaves.length) {
          const m = leafBatch.fillFrom(Math.min(leaves.length, 6000), (i, d, o) => {
            const lf = leaves[i];
            const t = lf.tint;
            d[o] = lf.x; d[o + 1] = lf.y;
            d[o + 2] = cLeaf[0] * (1 - t) + cLeaf2[0] * t; d[o + 3] = cLeaf[1] * (1 - t) + cLeaf2[1] * t; d[o + 4] = cLeaf[2] * (1 - t) + cLeaf2[2] * t; d[o + 5] = alpha;
            d[o + 6] = lf.size; d[o + 7] = lf.rot; d[o + 8] = lf.grow; d[o + 9] = lf.seed;
          });
          if (m) {
            prLeaf.use();
            gl.uniform1f(prLeaf.u.uAspect, c.aspect);
            gl.uniform1f(prLeaf.u.uSizeScale, 1);
            gl.uniform1f(prLeaf.u.uOpacity, c.opacity);
            gl.uniform2f(prLeaf.u.uLight, light[0], light[1]);
            leafBatch.draw(prLeaf);
          }
        }
        if (p.flowers > 0 && flowers.length) {
          const m = flowerBatch.fillFrom(Math.min(flowers.length, 1500), (i, d, o) => {
            const fl = flowers[i];
            d[o] = fl.x; d[o + 1] = fl.y;
            d[o + 2] = cFlower[0]; d[o + 3] = cFlower[1]; d[o + 4] = cFlower[2]; d[o + 5] = alpha;
            d[o + 6] = fl.size; d[o + 7] = fl.rot; d[o + 8] = fl.grow; d[o + 9] = fl.seed;
          });
          if (m) {
            prFlower.use();
            gl.uniform1f(prFlower.u.uAspect, c.aspect);
            gl.uniform1f(prFlower.u.uSizeScale, 1);
            gl.uniform1f(prFlower.u.uOpacity, c.opacity);
            flowerBatch.draw(prFlower);
          }
        }
        gl.disable(gl.BLEND);
      },
      dispose() { gl.deleteBuffer(vbo); gl.deleteVertexArray(vao); leafBatch.dispose(); flowerBatch.dispose(); },
    };
  },
};
