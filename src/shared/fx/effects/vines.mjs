// Growth. A space-colonisation algorithm seeds attractors over the open wall,
// then grows branches towards them — so the plant fills the space between your
// masked shapes and creeps around their edges rather than over them.

import { prog, bindTex, BLEND, hexRgb } from '../glu.mjs';
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
  vec2 p = mix(iA, iB, corner.x * 0.5 + 0.5) + n * corner.y * halfW;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - (p.y / uAspect) * 2.0, 0.0, 1.0);
}`;

const SEG_FS = `#version 300 es
precision highp float;
#include <common>
in vec2 vLocal; in vec4 vCol; in vec2 vAttr;
out vec4 o;
uniform float uOpacity;
uniform vec2 uLight;
void main(){
  float across = vLocal.y;
  // shade the stem like a cylinder
  float z = sqrt(max(0.0, 1.0 - across * across));
  vec3 n = normalize(vec3(across, 0.0, z));
  vec3 L = normalize(vec3(uLight, 0.7));
  float diff = 0.3 + 0.8 * max(dot(n, L), 0.0);
  float a = smoothstep(1.0, 0.86, abs(across)) * vCol.a * uOpacity;
  vec3 c = vCol.rgb * diff + pow(max(dot(n, L), 0.0), 24.0) * 0.35;
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
  // a pointed leaf: two circular arcs meeting at the tips
  vec2 q = vLocal;
  float d = length(vec2(q.x * 1.9, q.y)) - 0.92 + 0.35 * abs(q.x);
  if (d > 0.0) discard;
  float grow = sat(vAttr.z);
  if (length(q) > grow * 1.05) discard;
  float vein = smoothstep(0.06, 0.0, abs(q.y) - 0.02 * abs(q.x));
  vec3 c = vCol.rgb * (0.65 + 0.5 * (1.0 - abs(q.y)));
  c = mix(c, c * 1.35, vein);
  float a = sat(-d * 8.0) * vCol.a * uOpacity;
  o = vec4(c * a, a);
}`;

export default {
  type: 'vines',
  label: 'Vines',
  group: 'Growth',
  blend: 'over',
  hint: 'Creepers grow across the open wall, filling the gaps between your shapes.',
  actions: [{ name: 'grow', label: 'Grow' }, { name: 'reset', label: 'Reset' }],
  params: [
    R('speed', 'Growth speed', 1, 0.05, 6),
    R('density', 'Density', 500, 40, 2500, 10),
    R('reach', 'Reach', 0.16, 0.03, 0.5),
    R('kill', 'Fill in', 0.03, 0.005, 0.15, 0.001),
    R('step', 'Segment length', 0.012, 0.003, 0.05, 0.001),
    R('thick', 'Stem thickness', 0.0022, 0.0004, 0.01, 0.0001),
    R('taper', 'Taper', 0.7, 0, 1),
    R('gravitropism', 'Climb', 0.25, -1, 1),
    C('stem', 'Stem', '#2f7d3a'),
    C('leaf', 'Leaf', '#5fc75a'),
    R('leaves', 'Leaves', 0.5, 0, 1),
    R('leafSize', 'Leaf size', 0.012, 0.003, 0.05, 0.001),
    R('lightAngle', 'Light angle', 240, 0, 360, 1),
    S('root', 'Roots at', 'bottom', [['bottom', 'The floor'], ['top', 'The ceiling'], ['edges', 'Both sides'], ['shapes', 'Around the shapes']]),
    B('regrow', 'Start over when finished', true),
  ],

  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const CAP = 9000;
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
    const leafBatch = new SpriteBatch(gl, 4000);
    const prLeaf = prog(gl, SPRITE_VS, LEAF_FS);

    let nodes = [];        // { x, y, parent, depth, order, grow }
    let attractors = null; // Float32Array pairs
    let live = null;       // Uint8Array
    let leaves = [];
    let acc = 0, built = false, finished = false;
    const cStem = [0, 0, 0], cLeaf = [0, 0, 0];

    const seed = (p, w) => {
      nodes = []; leaves = []; finished = false;
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
      if (p.root === 'bottom') for (let i = 0; i < 5; i++) roots.push([0.1 + 0.2 * i + rng.gauss() * 0.02, A - 0.004]);
      else if (p.root === 'top') for (let i = 0; i < 5; i++) roots.push([0.1 + 0.2 * i + rng.gauss() * 0.02, 0.004]);
      else if (p.root === 'edges') for (let i = 0; i < 4; i++) { roots.push([0.004, A * (0.2 + 0.22 * i)]); roots.push([0.996, A * (0.2 + 0.22 * i)]); }
      else {
        for (const poly of w.field.polys) {
          for (let i = 0; i < poly.length; i += Math.max(1, Math.floor(poly.length / 3))) roots.push([poly[i][0], poly[i][1]]);
        }
        if (!roots.length) roots.push([0.5, A - 0.004]);
      }
      for (const r of roots) nodes.push({ x: r[0], y: r[1], parent: -1, depth: 0, grow: 0 });
      built = true;
    };

    const grow = (p, w) => {
      if (!attractors || finished) return;
      const reach = p.reach, killR = p.kill, step = p.step;
      const dirs = new Float64Array(nodes.length * 2);
      const cnt = new Int32Array(nodes.length);
      const na = attractors.length / 2;
      let remaining = 0;
      for (let a = 0; a < na; a++) {
        if (!live[a]) continue;
        remaining++;
        const ax = attractors[a * 2], ay = attractors[a * 2 + 1];
        let best = -1, bestD = reach * reach;
        for (let i = 0; i < nodes.length; i++) {
          const dx = ax - nodes[i].x, dy = ay - nodes[i].y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD) { bestD = d2; best = i; }
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
      for (let i = 0; i < N; i++) {
        if (!cnt[i]) continue;
        let dx = dirs[i * 2], dy = dirs[i * 2 + 1];
        dy -= p.gravitropism * cnt[i] * 0.6;             // climb towards the light
        const l = Math.hypot(dx, dy) || 1e-6;
        dx /= l; dy /= l;
        const nx = nodes[i].x + dx * step, ny = nodes[i].y + dy * step;
        if (w.field.sample(nx, ny) < 0.004) continue;    // do not grow into a shape
        if (nx < -0.02 || nx > 1.02 || ny < -0.02 || ny > w.aspect + 0.02) continue;
        added.push({ x: nx, y: ny, parent: i, depth: nodes[i].depth + 1, grow: 0 });
      }
      for (const nd of added) {
        nodes.push(nd);
        if (rng.next() < p.leaves * 0.45) {
          leaves.push({ x: nd.x, y: nd.y, rot: rng.range(0, 6.28), grow: 0, seed: rng.next(), size: p.leafSize * rng.range(0.6, 1.4) });
        }
      }
      if (!added.length) finished = true;
      if (nodes.length > CAP) finished = true;
    };

    return {
      resize() {},
      onWorldChanged() { built = false; },
      action(name, arg, w, p) {
        if (name === 'reset') { nodes = []; leaves = []; attractors = null; built = false; return; }
        if (!built) seed(p, w);
        for (let i = 0; i < 40; i++) grow(p, w);
      },
      step(dt, w, p) {
        if (!built) seed(p, w);
        if (finished && p.regrow) { acc += dt; if (acc > 4) { acc = 0; seed(p, w); } return; }
        acc += dt * p.speed * 26;
        let guard = 0;
        while (acc >= 1 && guard++ < 8) { acc -= 1; grow(p, w); }
        for (const nd of nodes) if (nd.grow < 1) nd.grow = Math.min(1, nd.grow + dt * 4);
        for (const lf of leaves) if (lf.grow < 1) lf.grow = Math.min(1, lf.grow + dt * 1.6);
      },
      draw(c) {
        const p = c.params;
        if (nodes.length < 2) return;
        hexRgb(p.stem, cStem); hexRgb(p.leaf, cLeaf);
        c.dst.bind();
        BLEND.over(gl);

        // thickness falls off with depth, so trunks are fat and tips are thin
        let maxDepth = 1;
        for (const n of nodes) if (n.depth > maxDepth) maxDepth = n.depth;
        let k = 0;
        for (let i = 0; i < nodes.length && k < CAP; i++) {
          const nd = nodes[i];
          if (nd.parent < 0) continue;
          const pa = nodes[nd.parent];
          const t = 1 - nd.depth / maxDepth;
          const wA = p.thick * (1 - p.taper + p.taper * (0.25 + t));
          const wB = wA * 0.88;
          const g = nd.grow;
          const o = k * STRIDE;
          data[o] = pa.x; data[o + 1] = pa.y;
          data[o + 2] = pa.x + (nd.x - pa.x) * g; data[o + 3] = pa.y + (nd.y - pa.y) * g;
          const shade = 0.7 + 0.5 * t;
          data[o + 4] = cStem[0] * shade; data[o + 5] = cStem[1] * shade; data[o + 6] = cStem[2] * shade;
          data[o + 7] = 1;
          data[o + 8] = wA; data[o + 9] = wB;
          k++;
        }
        if (k) {
          gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, k * STRIDE));
          pr.use();
          gl.uniform1f(pr.u.uAspect, c.aspect);
          gl.uniform1f(pr.u.uOpacity, c.opacity);
          gl.uniform2f(pr.u.uLight, Math.cos(p.lightAngle * Math.PI / 180), -Math.sin(p.lightAngle * Math.PI / 180));
          gl.bindVertexArray(vao);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, k);
          gl.bindVertexArray(null);
        }

        if (p.leaves > 0 && leaves.length) {
          const m = leafBatch.fillFrom(Math.min(leaves.length, 4000), (i, d, o) => {
            const lf = leaves[i];
            d[o] = lf.x; d[o + 1] = lf.y;
            d[o + 2] = cLeaf[0]; d[o + 3] = cLeaf[1]; d[o + 4] = cLeaf[2]; d[o + 5] = 1;
            d[o + 6] = lf.size * lf.grow; d[o + 7] = lf.rot; d[o + 8] = lf.grow; d[o + 9] = lf.seed;
          });
          if (m) {
            prLeaf.use();
            gl.uniform1f(prLeaf.u.uAspect, c.aspect);
            gl.uniform1f(prLeaf.u.uSizeScale, 1);
            gl.uniform1f(prLeaf.u.uOpacity, c.opacity);
            gl.uniform2f(prLeaf.u.uLight, Math.cos(p.lightAngle * Math.PI / 180), -Math.sin(p.lightAngle * Math.PI / 180));
            leafBatch.draw(prLeaf);
          }
        }
        gl.disable(gl.BLEND);
      },
      dispose() { gl.deleteBuffer(vbo); gl.deleteVertexArray(vao); leafBatch.dispose(); },
    };
  },
};
