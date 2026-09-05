// Tetris played by the wall. Tetrominoes drop into a grid laid over the
// picture, steer themselves towards the best fit, lock, and clear full rows.
// Cells that fall inside a masked shape are solid, so the pieces stack on your
// paintings and the couch. Each block is a bevelled glass tile with the video
// showing through.

import { prog, bindTex, BLEND, hexRgb } from '../glu.mjs';
import { SpriteBatch } from '../particles.mjs';
import { R, B, S } from './common.mjs';

const PIECES = {
  I: { cells: [[0, 1], [1, 1], [2, 1], [3, 1]], col: '#33d5ff' },
  O: { cells: [[1, 0], [2, 0], [1, 1], [2, 1]], col: '#ffe14d' },
  T: { cells: [[1, 0], [0, 1], [1, 1], [2, 1]], col: '#c05bff' },
  S: { cells: [[1, 0], [2, 0], [0, 1], [1, 1]], col: '#5cff6e' },
  Z: { cells: [[0, 0], [1, 0], [1, 1], [2, 1]], col: '#ff4d5e' },
  J: { cells: [[0, 0], [0, 1], [1, 1], [2, 1]], col: '#4d7bff' },
  L: { cells: [[2, 0], [0, 1], [1, 1], [2, 1]], col: '#ff9a3d' },
};
const KINDS = Object.keys(PIECES);

function rotateCells(cells, r) {
  let out = cells.map((c) => [c[0], c[1]]);
  for (let i = 0; i < r; i++) out = out.map(([x, y]) => [-y, x]);
  // normalise to the top-left
  const mx = Math.min(...out.map((c) => c[0])), my = Math.min(...out.map((c) => c[1]));
  return out.map(([x, y]) => [x - mx, y - my]);
}

const VS = `#version 300 es
in vec2 iPos; in vec4 iCol; in vec4 iAttr;   // size, flash, seed, kind
out vec2 vLocal; out vec4 vCol; out vec4 vAttr; out vec2 vUV;
uniform float uAspect;
void main(){
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vLocal = corner; vCol = iCol; vAttr = iAttr;
  vec2 p = iPos + corner * iAttr.x;
  vUV = vec2(p.x, 1.0 - p.y / uAspect);
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - (p.y / uAspect) * 2.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
#include <common>
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec2 vUV;
out vec4 o;
uniform sampler2D uBg;
uniform float uOpacity;
uniform float uGlass;
uniform float uBevel;
uniform float uGap;
void main(){
  vec2 p = vLocal;
  float e = max(abs(p.x), abs(p.y));
  float inner = 1.0 - uGap;
  if (e > inner) discard;
  // a bevelled tile: normal leans outwards in the rim band
  float rim = smoothstep(inner - uBevel * 0.6, inner, e);
  vec2 dir = abs(p.x) > abs(p.y) ? vec2(sign(p.x), 0.0) : vec2(0.0, sign(p.y));
  vec3 n = normalize(vec3(dir * rim * 0.9, 1.0 - rim * 0.6));
  vec3 L = normalize(vec3(-0.5, 0.7, 0.7));
  float diff = 0.55 + 0.45 * max(dot(n, L), 0.0);
  vec3 h = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, h), 0.0), 40.0);
  // the video through the glass, bent by the bevel
  vec3 vid = texture(uBg, clamp(vUV + n.xy * 0.01, 0.0, 1.0)).rgb;
  vec3 tint = vCol.rgb;
  vec3 base = mix(tint, vid * (0.4 + tint * 1.2), uGlass);
  vec3 col = base * diff + vec3(spec) * 0.5 + tint * rim * 0.25;
  // a lighter face on top of a raised tile
  col += tint * 0.15 * (1.0 - rim);
  col = mix(col, vec3(1.0), vAttr.y);        // row-clear flash
  float a = vCol.a * uOpacity;
  o = vec4(col * a, a);
}`;

export default {
  type: 'tetris',
  label: 'Tetris',
  group: 'Physics',
  blend: 'post',
  hint: 'Tetrominoes fall and stack over the picture, playing themselves; full rows clear. Your shapes are solid, so the pieces pile on the paintings.',
  actions: [{ name: 'clear', label: 'Clear board' }, { name: 'drop', label: 'Drop faster' }],
  params: [
    R('cols', 'Columns', 24, 8, 60, 1),
    R('speed', 'Rows per second', 6, 0.5, 40, 0.5),
    R('smart', 'Plays well', 0.8, 0, 1),
    R('glass', 'Glass', 0.6, 0, 1),
    R('bevel', 'Bevel', 0.5, 0, 1),
    R('gap', 'Gap', 0.08, 0, 0.3),
    R('alpha', 'Tile opacity', 0.92, 0.1, 1),
    B('clearRows', 'Clear full rows', true),
    S('onFull', 'When it fills up', 'clear', [['clear', 'Wipe and start over'], ['keep', 'Stay full']]),
  ],

  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const pr = prog(gl, VS, FS);
    const CAP = 4000;
    const batch = new SpriteBatch(gl, CAP);
    const col = [0, 0, 0];

    let cols = 0, rows = 0, cell = 0;
    let grid = null;          // Int8: -1 solid mask, 0 empty, 1..7 piece kind index + 1
    let fieldVersion = -1;
    let piece = null;         // { kind, rot, x, y, target: {x, rot} }
    let fallAcc = 0, fast = 0;
    let flashRows = [], flashT = 0;
    let wipe = 0;             // >0 while the board is being wiped
    let aspect = 9 / 16;

    const at = (x, y) => (x < 0 || x >= cols || y >= rows) ? -1 : (y < 0 ? 0 : grid[y * cols + x]);

    const rebuild = (w, p) => {
      const nc = Math.max(8, Math.round(p.cols));
      aspect = w.aspect;
      cell = 1 / nc;
      const nr = Math.max(4, Math.round(w.aspect / cell));
      const old = grid, oc = cols, orow = rows;
      cols = nc; rows = nr;
      grid = new Int8Array(cols * rows);
      // solid where the cell centre is inside a shape
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const cx = (x + 0.5) * cell, cy = (y + 0.5) * cell;
        if (cy > w.aspect) { grid[y * cols + x] = -1; continue; }
        // the field folds the frame walls in, but a boundary cell's centre is
        // still half a cell away from them, so only real shapes come out solid
        grid[y * cols + x] = w.field.sample(cx, cy) < cell * 0.25 ? -1 : 0;
      }
      // keep placed pieces where the geometry allows
      if (old && oc === cols && orow === rows) {
        for (let i = 0; i < grid.length; i++) if (grid[i] === 0 && old[i] > 0) grid[i] = old[i];
      }
      fieldVersion = w.field.version;
      piece = null;
    };

    const fits = (cells, px, py) => {
      for (const [cx, cy] of cells) if (at(px + cx, py + cy) !== 0) return false;
      return true;
    };

    // Score a landing: low is good. Height of the stack, holes made, bumpiness.
    const evaluate = (cells, px) => {
      let py = -4;
      while (fits(cells, px, py + 1)) py++;
      if (py < -3) return null;
      let score = 0;
      for (const [cx, cy] of cells) {
        const y = py + cy;
        score -= y * 1.0;                       // deeper is better (y grows downwards)
        // a hole below this cell?
        if (at(px + cx, y + 1) === 0) score += 3.5;
      }
      return { py, score };
    };

    const spawn = (p) => {
      const kind = KINDS[(rng.next() * KINDS.length) | 0];
      const rot = (rng.next() * 4) | 0;
      const cells = rotateCells(PIECES[kind].cells, rot);
      const wid = Math.max(...cells.map((c) => c[0])) + 1;
      const x = Math.max(0, Math.min(cols - wid, (rng.next() * cols) | 0));
      // choose a destination: best of a few candidates, or random when dumb
      let best = { x, rot, score: Infinity };
      const tries = 1 + Math.round(p.smart * 24);
      for (let i = 0; i < tries; i++) {
        const r = (rng.next() * 4) | 0;
        const cs = rotateCells(PIECES[kind].cells, r);
        const wdt = Math.max(...cs.map((c) => c[0])) + 1;
        const tx = (rng.next() * (cols - wdt + 1)) | 0;
        const ev = evaluate(cs, tx);
        if (!ev) continue;
        const s = ev.score + (rng.next() - 0.5) * 2 * (1 - p.smart);
        if (s < best.score) best = { x: tx, rot: r, score: s };
      }
      const startCells = rotateCells(PIECES[kind].cells, rot);
      if (!fits(startCells, x, -2)) return false;
      piece = { kind, rot, x, y: -2, cells: startCells, target: best };
      return true;
    };

    const lock = (p) => {
      const k = KINDS.indexOf(piece.kind) + 1;
      for (const [cx, cy] of piece.cells) {
        const x = piece.x + cx, y = piece.y + cy;
        if (y >= 0 && y < rows && x >= 0 && x < cols) grid[y * cols + x] = k;
      }
      piece = null;
      if (!p.clearRows) return;
      // full rows: every non-solid cell filled, and at least 3 real tiles
      const full = [];
      for (let y = 0; y < rows; y++) {
        let ok = true, n = 0;
        for (let x = 0; x < cols; x++) { const v = grid[y * cols + x]; if (v === 0) { ok = false; break; } if (v > 0) n++; }
        if (ok && n >= 3) full.push(y);
      }
      if (full.length) { flashRows = full; flashT = 0.35; }
    };

    const clearRows = () => {
      for (const y of flashRows) for (let x = 0; x < cols; x++) if (grid[y * cols + x] > 0) grid[y * cols + x] = 0;
      // column-wise gravity: tiles fall until they meet something
      for (let x = 0; x < cols; x++) {
        for (let y = rows - 2; y >= 0; y--) {
          const v = grid[y * cols + x];
          if (v <= 0) continue;
          let ny = y;
          while (ny + 1 < rows && grid[(ny + 1) * cols + x] === 0) ny++;
          if (ny !== y) { grid[ny * cols + x] = v; grid[y * cols + x] = 0; }
        }
      }
      flashRows = [];
    };

    const steer = () => {
      // one lateral step or rotation towards the chosen landing, if it fits
      const t = piece.target;
      if (piece.rot !== t.rot) {
        const nr = (piece.rot + 1) % 4;
        const cs = rotateCells(PIECES[piece.kind].cells, nr);
        if (fits(cs, piece.x, piece.y)) { piece.rot = nr; piece.cells = cs; return; }
      }
      if (piece.x !== t.x) {
        const dx = Math.sign(t.x - piece.x);
        if (fits(piece.cells, piece.x + dx, piece.y)) piece.x += dx;
      }
    };

    return {
      resize() {},
      action(name, arg, w, p) {
        if (name === 'clear') { wipe = 0.6; }
        if (name === 'drop') fast = 2;
      },
      step(dt, w, p) {
        if (!grid || fieldVersion !== w.field.version || cols !== Math.max(8, Math.round(p.cols)) || aspect !== w.aspect) rebuild(w, p);
        if (wipe > 0) {
          wipe -= dt;
          if (wipe <= 0) { for (let i = 0; i < grid.length; i++) if (grid[i] > 0) grid[i] = 0; piece = null; }
          return;
        }
        if (flashT > 0) { flashT -= dt; if (flashT <= 0) clearRows(); return; }
        fast = Math.max(0, fast - dt);
        if (!piece) {
          if (!spawn(p)) {
            if (p.onFull === 'clear') wipe = 0.8;
            return;
          }
        }
        const rate = p.speed * (fast > 0 ? 6 : 1);
        fallAcc += dt * rate;
        while (fallAcc >= 1 && piece) {
          fallAcc -= 1;
          steer();
          if (fits(piece.cells, piece.x, piece.y + 1)) piece.y++;
          else { lock(p); }
        }
      },
      draw(c) {
        const p = c.params;
        ctx.screen.copy(c.src, c.dst);
        if (!grid) return;
        c.dst.bind();
        const half = cell * 0.5;
        let k = 0;
        const d = batch.data, F = batch.floats;
        const put = (x, y, kind, flash) => {
          if (k >= CAP) return;
          const o = k * F;
          d[o] = (x + 0.5) * cell; d[o + 1] = (y + 0.5) * cell;
          hexRgb(PIECES[KINDS[kind - 1]].col, col);
          d[o + 2] = col[0]; d[o + 3] = col[1]; d[o + 4] = col[2]; d[o + 5] = p.alpha * (wipe > 0 ? wipe / 0.8 : 1);
          d[o + 6] = half; d[o + 7] = flash; d[o + 8] = 0; d[o + 9] = kind;
          k++;
        };
        for (let y = 0; y < rows; y++) {
          const fl = flashRows.includes(y) ? 0.5 + 0.5 * Math.sin(c.time * 40) : 0;
          for (let x = 0; x < cols; x++) { const v = grid[y * cols + x]; if (v > 0) put(x, y, v, fl); }
        }
        if (piece) {
          const kind = KINDS.indexOf(piece.kind) + 1;
          for (const [cx, cy] of piece.cells) if (piece.y + cy >= 0) put(piece.x + cx, piece.y + cy, kind, 0);
        }
        if (!k) return;
        batch.count = k;
        batch._upload(k);
        pr.use();
        gl.uniform1f(pr.u.uAspect, c.aspect);
        bindTex(gl, 0, c.src, pr.u.uBg);
        gl.uniform1f(pr.u.uOpacity, c.opacity);
        gl.uniform1f(pr.u.uGlass, p.glass);
        gl.uniform1f(pr.u.uBevel, p.bevel);
        gl.uniform1f(pr.u.uGap, p.gap);
        BLEND.over(gl);
        batch.draw(pr);
        gl.disable(gl.BLEND);
      },
      dispose() { batch.dispose(); },
    };
  },
};
