// A compact 2D rigid-body solver: circles and convex polygons against each
// other and against a static world of triangles (the blackout shapes, fanned
// out by the existing earcut triangulator, plus the frame walls).
//
// Sequential impulses with warm starting, so a heap of shards settles into a
// pile instead of quivering, and sleeping so a settled pile costs nothing.
//
// Units are output-normalized: x in 0..1, y in 0..aspect. Gravity is in the
// same units per second squared, which makes "a ball crosses the wall in a
// second" about 1.2.

import { triangulate } from '../earcut.mjs';

const SLOP = 0.0006;        // allowed penetration before position bias kicks in
const BIAS = 0.22;          // Baumgarte factor
const SLEEP_LIN = 0.006;
const SLEEP_ANG = 0.45;
const SLEEP_TIME = 0.7;

let NEXT_ID = 1;

export function circleBody(x, y, r, opts = {}) {
  const density = opts.density == null ? 1 : opts.density;
  const m = Math.PI * r * r * density;
  const I = 0.5 * m * r * r;
  return {
    id: NEXT_ID++, type: 0, x, y, r, angle: opts.angle || 0,
    vx: opts.vx || 0, vy: opts.vy || 0, w: opts.w || 0,
    im: opts.static ? 0 : 1 / m, ii: opts.static ? 0 : 1 / I,
    e: opts.e == null ? 0.35 : opts.e, mu: opts.mu == null ? 0.4 : opts.mu,
    drag: opts.drag || 0, verts: null, wv: null,
    sleepT: 0, awake: true, alive: true, data: opts.data || null,
  };
}

export function polyBody(x, y, verts, opts = {}) {
  // verts: local-space [[x,y],...] convex, centred by the caller. Wound so the
  // face normal (ey,-ex) points outward; shoelace > 0 in this y-down space.
  let sl = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    sl += a[0] * b[1] - b[0] * a[1];
  }
  if (sl < 0) verts = verts.slice().reverse();
  const n = verts.length;
  let area = 0, I = 0;
  for (let i = 0; i < n; i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    const cross = a[0] * b[1] - b[0] * a[1];
    area += cross;
    I += cross * (a[0] * a[0] + a[0] * b[0] + b[0] * b[0] + a[1] * a[1] + a[1] * b[1] + b[1] * b[1]);
  }
  area = Math.abs(area) * 0.5;
  const density = opts.density == null ? 1 : opts.density;
  const m = Math.max(1e-9, area * density);
  I = Math.abs(I) / 12 * density;
  let r = 0;
  const flat = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    flat[i * 2] = verts[i][0]; flat[i * 2 + 1] = verts[i][1];
    r = Math.max(r, Math.hypot(verts[i][0], verts[i][1]));
  }
  return {
    id: NEXT_ID++, type: 1, x, y, r, angle: opts.angle || 0,
    vx: opts.vx || 0, vy: opts.vy || 0, w: opts.w || 0,
    im: opts.static ? 0 : 1 / m, ii: opts.static ? 0 : 1 / Math.max(1e-9, I),
    e: opts.e == null ? 0.2 : opts.e, mu: opts.mu == null ? 0.5 : opts.mu,
    drag: opts.drag || 0, verts: flat, wv: new Float32Array(n * 2),
    sleepT: 0, awake: true, alive: true, data: opts.data || null,
  };
}

function updateWorldVerts(b) {
  if (b.type !== 1) return;
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  const v = b.verts, wv = b.wv;
  for (let i = 0; i < v.length; i += 2) {
    wv[i] = b.x + v[i] * c - v[i + 1] * s;
    wv[i + 1] = b.y + v[i] * s + v[i + 1] * c;
  }
}

// --------------------------------------------------------------- narrowphase
// A manifold is { nx, ny, count, px[2], py[2], depth[2], fid[2] } with the
// normal pointing from A to B.
const MF = { nx: 0, ny: 0, count: 0, px: [0, 0], py: [0, 0], depth: [0, 0], fid: [0, 0] };

function circleCircle(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const rr = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return null;
  const d = Math.sqrt(d2);
  if (d < 1e-9) { MF.nx = 0; MF.ny = 1; } else { MF.nx = dx / d; MF.ny = dy / d; }
  MF.count = 1;
  MF.depth[0] = rr - d;
  MF.px[0] = a.x + MF.nx * (a.r - MF.depth[0] * 0.5);
  MF.py[0] = a.y + MF.ny * (a.r - MF.depth[0] * 0.5);
  MF.fid[0] = 0;
  return MF;
}

// circle a vs polygon b; normal points a -> b
function circlePoly(a, b) {
  const wv = b.wv, n = wv.length / 2;
  let best = -Infinity, bi = -1, bnx = 0, bny = 0;
  for (let i = 0; i < n; i++) {
    const x0 = wv[i * 2], y0 = wv[i * 2 + 1];
    const x1 = wv[((i + 1) % n) * 2], y1 = wv[((i + 1) % n) * 2 + 1];
    let ex = x1 - x0, ey = y1 - y0;
    const el = Math.hypot(ex, ey) || 1;
    // polygons are wound so that (ey, -ex)/len is the outward normal
    const nx = ey / el, ny = -ex / el;
    const s = nx * (a.x - x0) + ny * (a.y - y0);
    if (s > a.r) return null;
    if (s > best) { best = s; bi = i; bnx = nx; bny = ny; }
  }
  if (bi < 0) return null;
  const x0 = wv[bi * 2], y0 = wv[bi * 2 + 1];
  const x1 = wv[((bi + 1) % n) * 2], y1 = wv[((bi + 1) % n) * 2 + 1];
  let cx, cy;
  if (best < 1e-9) {            // centre inside: use the face normal directly
    cx = a.x - bnx * best; cy = a.y - bny * best;
  } else {
    const ex = x1 - x0, ey = y1 - y0;
    let t = ((a.x - x0) * ex + (a.y - y0) * ey) / (ex * ex + ey * ey);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    cx = x0 + ex * t; cy = y0 + ey * t;
    const dx = cx - a.x, dy = cy - a.y;
    const d = Math.hypot(dx, dy);
    if (d > a.r) return null;
    if (d > 1e-9) { bnx = dx / d; bny = dy / d; }
    best = d;
  }
  MF.nx = bnx; MF.ny = bny;      // from circle towards polygon
  MF.count = 1;
  MF.depth[0] = a.r - best;
  MF.px[0] = cx; MF.py[0] = cy;
  MF.fid[0] = bi + 1;
  return MF;
}

const CLIP_A = [0, 0, 0, 0], CLIP_B = [0, 0, 0, 0];

function faceSeparation(a, b) {
  // max over a's faces of the signed distance of b's support point
  const av = a.wv, an = av.length / 2, bv = b.wv, bn = bv.length / 2;
  let best = -Infinity, bi = 0;
  for (let i = 0; i < an; i++) {
    const x0 = av[i * 2], y0 = av[i * 2 + 1];
    const x1 = av[((i + 1) % an) * 2], y1 = av[((i + 1) % an) * 2 + 1];
    const ex = x1 - x0, ey = y1 - y0;
    const el = Math.hypot(ex, ey) || 1;
    const nx = ey / el, ny = -ex / el;
    let sup = Infinity;
    for (let j = 0; j < bn; j++) {
      const s = nx * (bv[j * 2] - x0) + ny * (bv[j * 2 + 1] - y0);
      if (s < sup) sup = s;
    }
    if (sup > best) { best = sup; bi = i; }
  }
  return [best, bi];
}

function polyPoly(a, b) {
  const [sa, fa] = faceSeparation(a, b);
  if (sa > 0) return null;
  const [sb, fb] = faceSeparation(b, a);
  if (sb > 0) return null;

  let ref = a, inc = b, refFace = fa, flip = false;
  if (sb > sa + 1e-9) { ref = b; inc = a; refFace = fb; flip = true; }

  const rv = ref.wv, rn = rv.length / 2;
  const rx0 = rv[refFace * 2], ry0 = rv[refFace * 2 + 1];
  const rx1 = rv[((refFace + 1) % rn) * 2], ry1 = rv[((refFace + 1) % rn) * 2 + 1];
  let ex = rx1 - rx0, ey = ry1 - ry0;
  const el = Math.hypot(ex, ey) || 1;
  const tx = ex / el, ty = ey / el;
  const nx = ty, ny = -tx;

  // incident face = the one most anti-parallel to the reference normal
  const iv = inc.wv, inn = iv.length / 2;
  let bestDot = Infinity, ifIdx = 0;
  for (let i = 0; i < inn; i++) {
    const x0 = iv[i * 2], y0 = iv[i * 2 + 1];
    const x1 = iv[((i + 1) % inn) * 2], y1 = iv[((i + 1) % inn) * 2 + 1];
    let fx = x1 - x0, fy = y1 - y0;
    const fl = Math.hypot(fx, fy) || 1;
    const fnx = fy / fl, fny = -fx / fl;
    const d = fnx * nx + fny * ny;
    if (d < bestDot) { bestDot = d; ifIdx = i; }
  }
  CLIP_A[0] = iv[ifIdx * 2]; CLIP_A[1] = iv[ifIdx * 2 + 1];
  CLIP_A[2] = iv[((ifIdx + 1) % inn) * 2]; CLIP_A[3] = iv[((ifIdx + 1) % inn) * 2 + 1];

  // clip the incident edge to the reference face's side planes
  if (!clipSeg(CLIP_A, CLIP_B, -tx, -ty, -(tx * rx0 + ty * ry0))) return null;
  CLIP_A[0] = CLIP_B[0]; CLIP_A[1] = CLIP_B[1]; CLIP_A[2] = CLIP_B[2]; CLIP_A[3] = CLIP_B[3];
  if (!clipSeg(CLIP_A, CLIP_B, tx, ty, tx * rx1 + ty * ry1)) return null;

  MF.count = 0;
  const off = nx * rx0 + ny * ry0;
  for (let i = 0; i < 2; i++) {
    const px = CLIP_B[i * 2], py = CLIP_B[i * 2 + 1];
    const sep = nx * px + ny * py - off;
    if (sep <= 0) {
      MF.px[MF.count] = px; MF.py[MF.count] = py;
      MF.depth[MF.count] = -sep;
      MF.fid[MF.count] = (refFace + 1) * 64 + ifIdx * 2 + i + (flip ? 4096 : 0);
      MF.count++;
    }
  }
  if (!MF.count) return null;
  // normal must point from A to B
  MF.nx = flip ? -nx : nx;
  MF.ny = flip ? -ny : ny;
  return MF;
}

// keep the part of segment `s` on the negative side of  n.p <= d
function clipSeg(s, out, nx, ny, d) {
  const d0 = nx * s[0] + ny * s[1] - d;
  const d1 = nx * s[2] + ny * s[3] - d;
  let n = 0;
  if (d0 <= 0) { out[n * 2] = s[0]; out[n * 2 + 1] = s[1]; n++; }
  if (d1 <= 0) { out[n * 2] = s[2]; out[n * 2 + 1] = s[3]; n++; }
  if (n < 2 && d0 * d1 < 0) {
    const t = d0 / (d0 - d1);
    out[n * 2] = s[0] + (s[2] - s[0]) * t;
    out[n * 2 + 1] = s[1] + (s[3] - s[1]) * t;
    n++;
  }
  return n === 2;
}

function collide(a, b) {
  if (a.type === 0 && b.type === 0) return circleCircle(a, b);
  if (a.type === 0) return circlePoly(a, b);
  if (b.type === 0) {
    const m = circlePoly(b, a);
    if (!m) return null;
    m.nx = -m.nx; m.ny = -m.ny;      // circlePoly gives circle -> poly; we need A -> B
    return m;
  }
  return polyPoly(a, b);
}

// ------------------------------------------------------------------- world
export class World {
  constructor() {
    this.bodies = [];
    this.statics = [];
    this.cache = new Map();
    this.cacheNext = new Map();
    this.cellSize = 0.04;
    this.buckets = new Map();
    this.gravity = [0, 1.2];
    this.iterations = 8;
    this.staticVersion = -1;
  }

  clear() { this.bodies.length = 0; this.cache.clear(); this.cacheNext.clear(); }

  add(b) { this.bodies.push(b); return b; }

  /** Rebuild the static world from a Field (its polygons + walls). */
  setStatics(field) {
    if (this.staticVersion === field.version) return;
    this.staticVersion = field.version;
    this.statics.length = 0;
    for (const poly of field.polys) {
      const tris = triangulate(poly);
      for (let i = 0; i < tris.length; i += 3) {
        const p = [poly[tris[i]], poly[tris[i + 1]], poly[tris[i + 2]]];
        this._addStaticTri(p);
      }
    }
    const A = field.aspect, W = field.walls, T = 0.25, M = 0.4;
    if (W.b) this._addStaticRect(-M, A, 1 + M, A + T);
    if (W.t) this._addStaticRect(-M, -T, 1 + M, 0);
    if (W.l) this._addStaticRect(-T, -M, 0, A + M);
    if (W.r) this._addStaticRect(1, -M, 1 + T, A + M);
    this._indexStatics();
  }

  _addStaticTri(p) {
    // ensure counter-clockwise in y-down space so face normals point outward
    const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
    const q = area > 0 ? p : [p[0], p[2], p[1]];
    const cx = (q[0][0] + q[1][0] + q[2][0]) / 3, cy = (q[0][1] + q[1][1] + q[2][1]) / 3;
    const local = q.map((v) => [v[0] - cx, v[1] - cy]);
    if (Math.abs(area) < 1e-9) return;
    const b = polyBody(cx, cy, local, { static: true, e: 0.15, mu: 0.55 });
    updateWorldVerts(b);
    this.statics.push(b);
  }

  _addStaticRect(x0, y0, x1, y1) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = (x1 - x0) / 2, hh = (y1 - y0) / 2;
    const b = polyBody(cx, cy, [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]], { static: true, e: 0.1, mu: 0.5 });
    updateWorldVerts(b);
    this.statics.push(b);
  }

  _indexStatics() {
    this.sgrid = new Map();
    const cs = 0.06;
    this.sCell = cs;
    for (let i = 0; i < this.statics.length; i++) {
      const s = this.statics[i];
      const c0 = Math.floor((s.x - s.r) / cs), c1 = Math.floor((s.x + s.r) / cs);
      const r0 = Math.floor((s.y - s.r) / cs), r1 = Math.floor((s.y + s.r) / cs);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const k = r * 8192 + c;
        let arr = this.sgrid.get(k);
        if (!arr) this.sgrid.set(k, (arr = []));
        arr.push(i);
      }
    }
  }

  // ------------------------------------------------------------------ step
  step(dt, opts = {}) {
    const bodies = this.bodies;
    const gx = opts.gx == null ? this.gravity[0] : opts.gx;
    const gy = opts.gy == null ? this.gravity[1] : opts.gy;
    const linDamp = 1 - Math.min(0.9, (opts.damping || 0) * dt);

    // integrate velocities
    for (const b of bodies) {
      if (b.im === 0) continue;
      if (!b.awake) continue;
      b.vx += gx * dt; b.vy += gy * dt;
      if (b.drag) { const k = Math.max(0, 1 - b.drag * dt); b.vx *= k; b.vy *= k; }
      b.vx *= linDamp; b.vy *= linDamp;
      b.w *= 1 - Math.min(0.9, (opts.angularDamping || 0.4) * dt);
    }
    for (const b of bodies) if (b.type === 1) updateWorldVerts(b);

    // broadphase: uniform grid over dynamic bodies
    const cs = this.cellSize;
    const buckets = this.buckets;
    buckets.clear();
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      const c0 = Math.floor((b.x - b.r) / cs), c1 = Math.floor((b.x + b.r) / cs);
      const r0 = Math.floor((b.y - b.r) / cs), r1 = Math.floor((b.y + b.r) / cs);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const k = r * 8192 + c;
        let arr = buckets.get(k);
        if (!arr) buckets.set(k, (arr = []));
        arr.push(i);
      }
    }

    const contacts = this._contacts || (this._contacts = []);
    contacts.length = 0;
    this.cacheNext.clear();
    const pairSeen = this._pairSeen || (this._pairSeen = new Set());
    pairSeen.clear();

    for (const arr of buckets.values()) {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const ai = arr[i], bi = arr[j];
          const key = ai < bi ? ai * 1048576 + bi : bi * 1048576 + ai;
          if (pairSeen.has(key)) continue;
          pairSeen.add(key);
          const A = bodies[ai], B = bodies[bi];
          if (!A.awake && !B.awake) continue;
          if (A.im === 0 && B.im === 0) continue;
          const dx = B.x - A.x, dy = B.y - A.y, rr = A.r + B.r;
          if (dx * dx + dy * dy > rr * rr) continue;
          const m = collide(A, B);
          if (m) this._push(contacts, A, B, m);
        }
      }
    }

    // dynamic vs static
    if (this.sgrid) {
      const scs = this.sCell;
      for (const b of bodies) {
        if (!b.awake || b.im === 0) continue;
        const c0 = Math.floor((b.x - b.r) / scs), c1 = Math.floor((b.x + b.r) / scs);
        const r0 = Math.floor((b.y - b.r) / scs), r1 = Math.floor((b.y + b.r) / scs);
        const seen = this._sseen || (this._sseen = new Set());
        seen.clear();
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
          const arr = this.sgrid.get(r * 8192 + c);
          if (!arr) continue;
          for (const si of arr) {
            if (seen.has(si)) continue;
            seen.add(si);
            const S = this.statics[si];
            const dx = S.x - b.x, dy = S.y - b.y, rr = b.r + S.r;
            if (dx * dx + dy * dy > rr * rr) continue;
            const m = collide(b, S);
            if (m) this._push(contacts, b, S, m);
          }
        }
      }
    }

    // warm start
    for (const c of contacts) {
      const px = c.nx * c.pn + c.tx * c.pt;
      const py = c.ny * c.pn + c.ty * c.pt;
      applyImpulse(c.a, -px, -py, c.rax, c.ray);
      applyImpulse(c.b, px, py, c.rbx, c.rby);
    }

    const invDt = dt > 0 ? 1 / dt : 0;
    for (let it = 0; it < this.iterations; it++) {
      for (const c of contacts) solveContact(c, invDt);
    }

    // integrate positions
    for (const b of bodies) {
      if (b.im === 0 || !b.awake) continue;
      b.x += b.vx * dt; b.y += b.vy * dt; b.angle += b.w * dt;
    }

    // sleeping
    for (const b of bodies) {
      if (b.im === 0) continue;
      const speed = Math.abs(b.vx) + Math.abs(b.vy);
      if (speed < SLEEP_LIN && Math.abs(b.w) < SLEEP_ANG) {
        b.sleepT += dt;
        if (b.sleepT > SLEEP_TIME) { b.awake = false; b.vx = 0; b.vy = 0; b.w = 0; }
      } else { b.sleepT = 0; b.awake = true; }
    }

    // the impulse cache only keeps pairs that touched this step, so bodies that
    // are removed take their contact history with them
    const swap = this.cache; this.cache = this.cacheNext; this.cacheNext = swap;

    // prune dead / escaped bodies
    if (this._needPrune) {
      this._needPrune = false;
      let k = 0;
      for (let i = 0; i < bodies.length; i++) if (bodies[i].alive) bodies[k++] = bodies[i];
      bodies.length = k;
    }
  }

  wake(x, y, r) {
    const r2 = r * r;
    for (const b of this.bodies) {
      const dx = b.x - x, dy = b.y - y;
      if (dx * dx + dy * dy < r2) { b.awake = true; b.sleepT = 0; }
    }
  }

  wakeAll() { for (const b of this.bodies) { b.awake = true; b.sleepT = 0; } }

  remove(pred) {
    for (const b of this.bodies) if (pred(b)) b.alive = false;
    this._needPrune = true;
  }

  _push(list, A, B, m) {
    const pairKey = (A.id * 4194304 + B.id);
    const prevStore = this.cache.get(pairKey);
    let store = this.cacheNext.get(pairKey);
    if (!store) this.cacheNext.set(pairKey, (store = new Map()));
    const e = Math.max(A.e, B.e);
    const mu = Math.sqrt(A.mu * B.mu);
    for (let i = 0; i < m.count; i++) {
      const px = m.px[i], py = m.py[i];
      const rax = px - A.x, ray = py - A.y;
      const rbx = px - B.x, rby = py - B.y;
      const tx = -m.ny, ty = m.nx;
      const prev = prevStore ? prevStore.get(m.fid[i]) : null;
      const c = {
        a: A, b: B, nx: m.nx, ny: m.ny, tx, ty,
        rax, ray, rbx, rby, depth: m.depth[i], e, mu,
        pn: prev ? prev.pn : 0, pt: prev ? prev.pt : 0,
        fid: m.fid[i], store,
        kn: 0, kt: 0, bias: 0,
      };
      c.kn = 1 / effMass(A, B, rax, ray, rbx, rby, m.nx, m.ny);
      c.kt = 1 / effMass(A, B, rax, ray, rbx, rby, tx, ty);
      // restitution only above a threshold, otherwise resting contacts jitter
      const rvn = relNormal(c);
      c.bounce = rvn < -0.25 ? -e * rvn : 0;
      c.bias = BIAS * Math.max(0, c.depth - SLOP);
      list.push(c);
      // A resting contact must not keep resetting the sleep timer, or nothing
      // ever settles. Only a body that is actually moving wakes its neighbour.
      const va = Math.abs(A.vx) + Math.abs(A.vy), vb = Math.abs(B.vx) + Math.abs(B.vy);
      if (A.im > 0 && !A.awake && B.awake && vb > SLEEP_LIN) { A.awake = true; A.sleepT = 0; }
      if (B.im > 0 && !B.awake && A.awake && va > SLEEP_LIN) { B.awake = true; B.sleepT = 0; }
    }
  }
}

function effMass(A, B, rax, ray, rbx, rby, nx, ny) {
  const ra = rax * ny - ray * nx;
  const rb = rbx * ny - rby * nx;
  return Math.max(1e-9, A.im + B.im + A.ii * ra * ra + B.ii * rb * rb);
}

function relNormal(c) {
  const a = c.a, b = c.b;
  const vax = a.vx - a.w * c.ray, vay = a.vy + a.w * c.rax;
  const vbx = b.vx - b.w * c.rby, vby = b.vy + b.w * c.rbx;
  return (vbx - vax) * c.nx + (vby - vay) * c.ny;
}

function applyImpulse(b, px, py, rx, ry) {
  if (b.im === 0) return;
  b.vx += px * b.im; b.vy += py * b.im;
  b.w += b.ii * (rx * py - ry * px);
}

function solveContact(c, invDt) {
  const a = c.a, b = c.b;
  // normal
  let vn = relNormal(c);
  let dpn = (-vn + c.bounce + c.bias * invDt * 0.35) * c.kn;
  const pn0 = c.pn;
  c.pn = Math.max(0, pn0 + dpn);
  dpn = c.pn - pn0;
  applyImpulse(a, -c.nx * dpn, -c.ny * dpn, c.rax, c.ray);
  applyImpulse(b, c.nx * dpn, c.ny * dpn, c.rbx, c.rby);

  // friction
  const vax = a.vx - a.w * c.ray, vay = a.vy + a.w * c.rax;
  const vbx = b.vx - b.w * c.rby, vby = b.vy + b.w * c.rbx;
  const vt = (vbx - vax) * c.tx + (vby - vay) * c.ty;
  let dpt = -vt * c.kt;
  const max = c.mu * c.pn;
  const pt0 = c.pt;
  c.pt = Math.max(-max, Math.min(max, pt0 + dpt));
  dpt = c.pt - pt0;
  applyImpulse(a, -c.tx * dpt, -c.ty * dpt, c.rax, c.ray);
  applyImpulse(b, c.tx * dpt, c.ty * dpt, c.rbx, c.rby);

  c.store.set(c.fid, c);   // warm-start seed for the next step
}

export { updateWorldVerts };
