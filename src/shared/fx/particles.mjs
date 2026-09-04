// CPU particle pool (structure-of-arrays) with a GPU sprite batch.
//
// The pool covers three jobs that would otherwise be three systems:
//   * plain ballistic particles - snow, embers, rain, confetti, fireflies
//   * Clavet-style double-density relaxation - water, goo, wet sand
//   * granular relaxation with friction - dry sand piling on a ledge
//
// Collision is against the occluder Field's signed distance function, which
// means particles slide along the outline of a painting or a couch exactly the
// way the fluid and the rigid bodies do.

import { prog, bindTex, VS_SCREEN } from './glu.mjs';

export class Particles {
  constructor(capacity) {
    this.cap = capacity;
    this.n = 0;
    const F = (k = 1) => new Float32Array(capacity * k);
    this.x = F(); this.y = F(); this.vx = F(); this.vy = F();
    this.px = F(); this.py = F();                 // previous position
    this.life = F(); this.maxLife = F();
    this.size = F(); this.rot = F(); this.vrot = F();
    this.r = F(); this.g = F(); this.b = F(); this.a = F();
    this.seed = F(); this.aux = F();              // free per-effect scalar
    this.free = [];
    this.alive = new Uint8Array(capacity);
    // spatial hash
    this._cellStart = null; this._order = null; this._cellOf = null;
  }

  reset() {
    this.n = 0; this.free.length = 0;
    this.alive.fill(0);
  }

  spawn(p) {
    let i;
    if (this.free.length) i = this.free.pop();
    else if (this.n < this.cap) i = this.n++;
    else return -1;
    this.alive[i] = 1;
    this.x[i] = p.x; this.y[i] = p.y;
    this.px[i] = p.x; this.py[i] = p.y;
    this.vx[i] = p.vx || 0; this.vy[i] = p.vy || 0;
    this.life[i] = this.maxLife[i] = p.life == null ? 1e9 : p.life;
    this.size[i] = p.size == null ? 0.006 : p.size;
    this.rot[i] = p.rot || 0; this.vrot[i] = p.vrot || 0;
    this.r[i] = p.r == null ? 1 : p.r; this.g[i] = p.g == null ? 1 : p.g;
    this.b[i] = p.b == null ? 1 : p.b; this.a[i] = p.a == null ? 1 : p.a;
    this.seed[i] = p.seed == null ? Math.random() : p.seed;
    this.aux[i] = p.aux || 0;
    return i;
  }

  kill(i) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.free.push(i);
  }

  get count() { return this.n - this.free.length; }

  // ------------------------------------------------------------ integration
  /**
   * Ballistic step with SDF collision.
   * opts: { gx, gy, drag, bounce, friction, field, curl, curlScale, curlTime,
   *         wind, killOutside, aspect, onHit(i, nx, ny, speed) }
   */
  step(dt, o) {
    const f = o.field;
    const gx = o.gx || 0, gy = o.gy == null ? 1.2 : o.gy;
    const drag = o.drag || 0;
    const bounce = o.bounce == null ? 0.25 : o.bounce;
    const fric = o.friction == null ? 0.6 : o.friction;
    const curl = o.curl || 0;
    const cs = o.curlScale || 7;
    const ct = o.curlTime || 0;
    const wx = (o.wind && o.wind[0]) || 0, wy = (o.wind && o.wind[1]) || 0;
    const aspect = o.aspect || 0.5625;
    const n = this.n;
    const nrm = [0, 0];
    for (let i = 0; i < n; i++) {
      if (!this.alive[i]) continue;
      if (this.maxLife[i] < 1e8) {
        this.life[i] -= dt;
        if (this.life[i] <= 0) { this.kill(i); continue; }
      }
      let vx = this.vx[i], vy = this.vy[i];
      vx += gx * dt; vy += gy * dt;
      if (curl) {
        const c = curl2(this.x[i] * cs, this.y[i] * cs + ct, this.seed[i]);
        vx += c[0] * curl * dt; vy += c[1] * curl * dt;
      }
      if (wx || wy) { vx += wx * dt; vy += wy * dt; }
      if (drag) { const k = Math.max(0, 1 - drag * dt); vx *= k; vy *= k; }

      this.px[i] = this.x[i]; this.py[i] = this.y[i];
      let x = this.x[i] + vx * dt, y = this.y[i] + vy * dt;

      if (f) {
        const rad = o.useRadius ? this.size[i] * 0.5 : 0;
        const d = f.sample(x, y) - rad;
        if (d < 0) {
          f.grad(x, y, nrm);
          x -= nrm[0] * d; y -= nrm[1] * d;
          const vn = vx * nrm[0] + vy * nrm[1];
          if (vn < 0) {
            const tvx = vx - nrm[0] * vn, tvy = vy - nrm[1] * vn;
            vx = tvx * (1 - fric * dt * 12) - nrm[0] * vn * bounce;
            vy = tvy * (1 - fric * dt * 12) - nrm[1] * vn * bounce;
            if (o.onHit) o.onHit(i, nrm[0], nrm[1], -vn);
          }
        }
      }
      this.x[i] = x; this.y[i] = y;
      this.vx[i] = vx; this.vy[i] = vy;
      this.rot[i] += this.vrot[i] * dt;
      if (o.killOutside !== false) {
        if (x < -0.15 || x > 1.15 || y > aspect + 0.3 || y < -1.5) this.kill(i);
      }
    }
  }

  // -------------------------------------------------------------- neighbours
  buildHash(h, aspect) {
    const n = this.n;
    const cols = Math.max(1, Math.ceil(1.6 / h)), rows = Math.max(1, Math.ceil((aspect + 1.0) / h));
    const cells = cols * rows;
    if (!this._cellStart || this._cellStart.length !== cells + 1) this._cellStart = new Int32Array(cells + 1);
    if (!this._order || this._order.length < n) { this._order = new Int32Array(Math.max(16, n * 2)); this._cellOf = new Int32Array(Math.max(16, n * 2)); }
    const start = this._cellStart, order = this._order, cellOf = this._cellOf;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      if (!this.alive[i]) { cellOf[i] = -1; continue; }
      const c = Math.min(cols - 1, Math.max(0, ((this.x[i] + 0.3) / h) | 0));
      const r = Math.min(rows - 1, Math.max(0, ((this.y[i] + 0.5) / h) | 0));
      const k = r * cols + c;
      cellOf[i] = k;
      start[k + 1]++;
    }
    for (let k = 0; k < cells; k++) start[k + 1] += start[k];
    const cursor = this._cursor && this._cursor.length === cells ? this._cursor : (this._cursor = new Int32Array(cells));
    cursor.set(start.subarray(0, cells));
    for (let i = 0; i < n; i++) {
      const k = cellOf[i];
      if (k < 0) continue;
      order[cursor[k]++] = i;
    }
    this._hash = { cols, rows, h, cells };
  }

  /** Calls cb(j) for every live particle within `h` of cell(x,y). */
  forEachNeighbor(x, y, cb) {
    const H = this._hash;
    if (!H) return;
    const c = Math.min(H.cols - 1, Math.max(0, ((x + 0.3) / H.h) | 0));
    const r = Math.min(H.rows - 1, Math.max(0, ((y + 0.5) / H.h) | 0));
    const start = this._cellStart, order = this._order;
    for (let rr = Math.max(0, r - 1); rr <= Math.min(H.rows - 1, r + 1); rr++) {
      for (let cc = Math.max(0, c - 1); cc <= Math.min(H.cols - 1, c + 1); cc++) {
        const k = rr * H.cols + cc;
        for (let t = start[k], e = start[k + 1]; t < e; t++) cb(order[t]);
      }
    }
  }

  /**
   * Clavet double-density relaxation. Produces a genuine incompressible 2-D
   * liquid: it fills a basin, forms a flat surface, splashes and sticks
   * together, all with one pass over the neighbour list.
   *
   * opts: { h, rest, k, kNear, viscSigma, viscBeta, gx, gy, field, aspect,
   *         surfaceTension }
   */
  relax(dt, o) {
    const n = this.n;
    if (!n) return;
    const h = o.h, k = o.k, kNear = o.kNear, rest = o.rest;
    const h2 = h * h;
    const gx = o.gx || 0, gy = o.gy == null ? 1.2 : o.gy;
    const f = o.field;
    const x = this.x, y = this.y, vx = this.vx, vy = this.vy, px = this.px, py = this.py;
    const alive = this.alive;
    const aspect = o.aspect || 0.5625;

    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      vx[i] += gx * dt; vy[i] += gy * dt;
    }

    this.buildHash(h, aspect);
    const H = this._hash, start = this._cellStart, order = this._order;
    const cols = H.cols, rows = H.rows;

    // Neighbour iteration is inlined below rather than going through a
    // callback: at ten thousand particles the closure per particle per pass
    // was the single largest cost in the frame.
    const sigma = o.viscSigma || 0, beta = o.viscBeta || 0, fric = o.friction || 0;
    if (sigma || beta || fric) {
      for (let i = 0; i < n; i++) {
        if (!alive[i]) continue;
        const xi = x[i], yi = y[i];
        const c = ((xi + 0.3) / h) | 0, r = ((yi + 0.5) / h) | 0;
        const c0 = c > 0 ? c - 1 : 0, c1 = c < cols - 1 ? c + 1 : cols - 1;
        const r0 = r > 0 ? r - 1 : 0, r1 = r < rows - 1 ? r + 1 : rows - 1;
        for (let rr = r0; rr <= r1; rr++) {
          const base = rr * cols;
          for (let cc = c0; cc <= c1; cc++) {
            const kk = base + cc;
            for (let t = start[kk], e = start[kk + 1]; t < e; t++) {
              const j = order[t];
              if (j <= i) continue;
              let dx = x[j] - xi, dy = y[j] - yi;
              const r2 = dx * dx + dy * dy;
              if (r2 >= h2 || r2 < 1e-12) continue;
              const rl = Math.sqrt(r2);
              dx /= rl; dy /= rl;
              const q = 1 - rl / h;
              const u = (vx[i] - vx[j]) * dx + (vy[i] - vy[j]) * dy;
              if (u > 0) {
                const imp = dt * q * (sigma * u + beta * u * u) * 0.5;
                vx[i] -= imp * dx; vy[i] -= imp * dy;
                vx[j] += imp * dx; vy[j] += imp * dy;
              }
              if (fric > 0) {
                // Tangential damping is what separates sand from water: grains
                // resist sliding past each other, so a heap holds its slope.
                const tx = -dy, ty = dx;
                const ut = (vx[i] - vx[j]) * tx + (vy[i] - vy[j]) * ty;
                const impT = Math.min(1, fric * q) * ut * 0.5;
                vx[i] -= impT * tx; vy[i] -= impT * ty;
                vx[j] += impT * tx; vy[j] += impT * ty;
              }
            }
          }
        }
      }
    }

    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      px[i] = x[i]; py[i] = y[i];
      x[i] += vx[i] * dt; y[i] += vy[i] * dt;
    }
    this.buildHash(h, aspect);
    const start2 = this._cellStart, order2 = this._order;

    const nb = this._nb || (this._nb = {
      idx: new Int32Array(192), q: new Float32Array(192),
      dx: new Float32Array(192), dy: new Float32Array(192),
    });
    const s2 = dt * dt;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      const xi = x[i], yi = y[i];
      let cnt = 0, rho = 0, rhoNear = 0;
      const c = ((xi + 0.3) / h) | 0, r = ((yi + 0.5) / h) | 0;
      const c0 = c > 0 ? c - 1 : 0, c1 = c < cols - 1 ? c + 1 : cols - 1;
      const r0 = r > 0 ? r - 1 : 0, r1 = r < rows - 1 ? r + 1 : rows - 1;
      for (let rr = r0; rr <= r1; rr++) {
        const base = rr * cols;
        for (let cc = c0; cc <= c1; cc++) {
          const kk = base + cc;
          for (let t = start2[kk], e = start2[kk + 1]; t < e; t++) {
            const j = order2[t];
            if (j === i || cnt >= 192) continue;
            const dx = x[j] - xi, dy = y[j] - yi;
            const r2 = dx * dx + dy * dy;
            if (r2 >= h2) continue;
            const rl = Math.sqrt(r2);
            const q = 1 - rl / h;
            rho += q * q; rhoNear += q * q * q;
            const inv = rl > 1e-9 ? 1 / rl : 0;
            nb.idx[cnt] = j; nb.q[cnt] = q;
            nb.dx[cnt] = dx * inv; nb.dy[cnt] = dy * inv;
            cnt++;
          }
        }
      }
      const P = k * (rho - rest);
      const PN = kNear * rhoNear;
      let ddx = 0, ddy = 0;
      for (let t = 0; t < cnt; t++) {
        const q = nb.q[t];
        const D = s2 * (P * q + PN * q * q) * 0.5;
        const j = nb.idx[t];
        x[j] += nb.dx[t] * D; y[j] += nb.dy[t] * D;
        ddx -= nb.dx[t] * D; ddy -= nb.dy[t] * D;
      }
      x[i] += ddx; y[i] += ddy;
    }

    const nrm = [0, 0];
    const rad = o.radius || 0;
    const invDt = 1 / dt;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      if (f) {
        const d = f.sample(x[i], y[i]) - rad;
        if (d < 0) {
          f.grad(x[i], y[i], nrm);
          x[i] -= nrm[0] * d;
          y[i] -= nrm[1] * d;
        }
      }
      vx[i] = (x[i] - px[i]) * invDt;
      vy[i] = (y[i] - py[i]) * invDt;
      const sp = Math.hypot(vx[i], vy[i]);
      if (sp > 6) { vx[i] *= 6 / sp; vy[i] *= 6 / sp; }
      if (x[i] < -0.2 || x[i] > 1.2 || y[i] > aspect + 0.4 || y[i] < -1.2) { this.kill(i); continue; }
      if (this.maxLife[i] < 1e8) { this.life[i] -= dt; if (this.life[i] <= 0) this.kill(i); }
    }
  }
}

// cheap divergence-free-ish noise for wind; matches the GLSL curl closely
// enough that CPU and GPU driven effects feel like the same wind.
const _c = [0, 0];
function curl2(x, y, seed) {
  const e = 0.35;
  const n1 = vnoise(x, y + e, seed), n2 = vnoise(x, y - e, seed);
  const n3 = vnoise(x + e, y, seed), n4 = vnoise(x - e, y, seed);
  _c[0] = (n1 - n2) / (2 * e); _c[1] = (n4 - n3) / (2 * e);
  return _c;
}
function fract(v) { return v - Math.floor(v); }
function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return fract(h);
}
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy + s), b = hash2(ix + 1, iy + s);
  const c = hash2(ix, iy + 1 + s), d = hash2(ix + 1, iy + 1 + s);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

// ---------------------------------------------------------------- rendering
// One interleaved instance buffer, quad corners generated from gl_VertexID.
// Effects supply the fragment shader body, so a snowflake, an ember and a
// confetti card all share the same upload path.
export const SPRITE_VS = `#version 300 es
in vec2 iPos;      // world (x 0..1, y 0..aspect)
in vec4 iCol;      // rgba
in vec4 iAttr;     // size, rot, lifeFrac, seed
out vec2 vLocal;
out vec4 vCol;
out vec4 vAttr;
out vec2 vUV;
out vec2 vCenter;
uniform float uAspect;
uniform float uSizeScale;
void main(){
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vLocal = corner;
  vCol = iCol;
  vAttr = iAttr;
  float s = iAttr.x * uSizeScale;
  float c = cos(iAttr.y), sn = sin(iAttr.y);
  vec2 off = vec2(corner.x * c - corner.y * sn, corner.x * sn + corner.y * c) * s;
  vec2 p = iPos + off;
  // vUV / vCenter are framebuffer uv (v = 0 at the bottom of the picture) so
  // that sampling the background texture lines up with what is on screen; the
  // position itself still comes from the world coordinate, which runs y-down.
  vUV = vec2(p.x, 1.0 - p.y / uAspect);
  vCenter = vec2(iPos.x, 1.0 - iPos.y / uAspect);
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - (p.y / uAspect) * 2.0, 0.0, 1.0);
}`;

export class SpriteBatch {
  /** `floats` is the per-instance stride; 10 covers pos/colour/attr, effects
   *  that need a second attribute vector ask for more. */
  constructor(gl, capacity, floats = 10) {
    this.gl = gl;
    this.cap = capacity;
    this.floats = floats;
    this.data = new Float32Array(capacity * floats);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    this.vaos = new Map();
    this.count = 0;
  }

  /** Pack live particles; `map` may override colour/size per particle. */
  fill(P, map) {
    const d = this.data;
    const F = this.floats;
    let k = 0;
    for (let i = 0; i < P.n; i++) {
      if (!P.alive[i]) continue;
      if (k >= this.cap) break;
      const o = k * F;
      d[o] = P.x[i]; d[o + 1] = P.y[i];
      d[o + 2] = P.r[i]; d[o + 3] = P.g[i]; d[o + 4] = P.b[i]; d[o + 5] = P.a[i];
      d[o + 6] = P.size[i]; d[o + 7] = P.rot[i];
      d[o + 8] = P.maxLife[i] < 1e8 ? P.life[i] / P.maxLife[i] : 1;
      d[o + 9] = P.seed[i];
      if (map) map(i, d, o);
      k++;
    }
    this.count = k;
    this._upload(k);
    return k;
  }

  /** Pack `count` instances written by `cb(i, data, offset)`. */
  fillFrom(count, cb) {
    const d = this.data;
    const F = this.floats;
    const k = Math.min(count, this.cap);
    for (let i = 0; i < k; i++) cb(i, d, i * F);
    this.count = k;
    this._upload(k);
    return k;
  }

  _upload(k) {
    if (!k) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, k * this.floats));
  }

  _vao(pr) {
    let vao = this.vaos.get(pr.p);
    if (vao) return vao;
    const gl = this.gl;
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const S = this.floats * 4;
    const set = (name, size, off) => {
      const loc = pr.a[name];
      if (loc == null || loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, S, off);
      gl.vertexAttribDivisor(loc, 1);
    };
    set('iPos', 2, 0);
    set('iCol', 4, 8);
    set('iAttr', 4, 24);
    if (this.floats >= 14) set('iAttr2', 4, 40);
    gl.bindVertexArray(null);
    this.vaos.set(pr.p, vao);
    return vao;
  }

  draw(pr) {
    if (!this.count) return;
    const gl = this.gl;
    gl.bindVertexArray(this._vao(pr));
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteBuffer(this.vbo);
    for (const v of this.vaos.values()) gl.deleteVertexArray(v);
    this.vaos.clear();
  }
}

export function spriteProgram(gl, fsBody, extraUniforms = '') {
  return prog(gl, SPRITE_VS, `#version 300 es
precision highp float;
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec2 vUV; in vec2 vCenter;
out vec4 o;
uniform float uTime;
${extraUniforms}
${fsBody}
`);
}
