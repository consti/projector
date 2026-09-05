import { Engine } from '/shared/gl-engine.mjs';
import * as Mesh from '/shared/mesh.mjs';
import { defaultSurface, defaultMask } from '/shared/schema.mjs';

const HIT = 9;          // px hit radius for handles
const SNAP = 6;         // px snap distance
const MAX_PREVIEW_W = 1400;   // cap for the preview render target

export class Stage {
  constructor(els, hooks) {
    this.view = els.view;
    this.frame = els.frame;
    this.glc = els.glc;
    this.ovc = els.ovc;
    this.camLayer = els.camLayer;
    this.info = els.info;
    this.hooks = hooks;                    // { onChange, onSelect, project(), outputSize() }
    this.engine = new Engine(this.glc);
    this.tool = 'select';
    this.sel = null;                       // { type:'surface'|'mask', id }
    this.selPoint = null;                   // index into mesh.pts / mask.points
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.drag = null;
    this.pending = null;                    // in-progress polygon/rect
    this.showHandles = true;
    this.plain = false;                    // previewing the TV: no areas, masks or handles to edit
    this.previewDim = 1;
    this.fxDrag = null;                    // dragging an effect's point (light, centre...)

    this._bind();
    new ResizeObserver(() => this.layout()).observe(this.view);
  }

  // ---------------------------------------------------------------- layout
  layout() {
    const [ow, oh] = this.hooks.outputSize();
    const vw = this.view.clientWidth, vh = this.view.clientHeight;
    if (!vw || !vh) return;
    const pad = 26;
    const s = Math.min((vw - pad) / ow, (vh - pad) / oh) * this.zoom;
    const w = Math.round(ow * s), h = Math.round(oh * s);
    this.frame.style.width = w + 'px';
    this.frame.style.height = h + 'px';
    this.frame.style.transform = `translate(${this.pan.x}px,${this.pan.y}px)`;
    // Cap the preview's backing store: on a 2x display this otherwise renders
    // the whole mapped composite at ~2K twice over, for no visible benefit.
    const dpr = window.devicePixelRatio || 1;
    const glScale = Math.min(dpr, MAX_PREVIEW_W / Math.max(1, w));
    const sizes = [[this.glc, glScale], [this.ovc, dpr]];
    for (const [c, sc] of sizes) {
      const cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    }
    this.engine.invalidateMasks();
    this.frameSize = [w, h];
  }

  setTool(t) {
    this.tool = t;
    this.pending = null;
    this.frame.style.cursor = t === 'select' ? 'default' : 'crosshair';
    this.draw();
  }

  select(type, id, point = null) {
    this.sel = type ? { type, id } : null;
    this.selPoint = point;
    this.hooks.onSelect(this.sel);
    this.draw();
  }

  selected() {
    const p = this.hooks.project();
    if (!this.sel) return null;
    const list = this.sel.type === 'surface' ? p.surfaces : p.masks;
    return list.find((o) => o.id === this.sel.id) || null;
  }

  zoomBy(f, center) {
    const prev = this.zoom;
    this.zoom = Math.max(0.35, Math.min(6, this.zoom * f));
    if (center && this.frameSize) {
      const k = this.zoom / prev - 1;
      this.pan.x -= (center.x - this.frameSize[0] / 2) * k;
      this.pan.y -= (center.y - this.frameSize[1] / 2) * k;
    }
    this.layout(); this.draw();
  }

  resetView() { this.zoom = 1; this.pan = { x: 0, y: 0 }; this.layout(); this.draw(); }

  // ------------------------------------------------------------ coordinates
  toNorm(e) {
    const r = this.frame.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }
  pxPerNorm() {
    const r = this.frame.getBoundingClientRect();
    return [r.width, r.height];
  }

  // ------------------------------------------------------------- rendering
  render() {
    const p = this.hooks.project();
    this.engine.render(p, { mode: 'mapped', previewDim: this.previewDim });
    this.draw();
  }

  draw() {
    const c = this.ovc, x = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = c.width / dpr, H = c.height / dpr;
    x.clearRect(0, 0, W, H);
    this._drawFxPoints(x, W, H);
    if (!this.showHandles || this.plain) { this._info(); return; }
    const p = this.hooks.project();
    const X = (q) => q[0] * W, Y = (q) => q[1] * H;

    // masks
    for (const m of p.masks || []) {
      const on = this.sel?.type === 'mask' && this.sel.id === m.id;
      x.beginPath();
      m.points.forEach((q, i) => (i ? x.lineTo(X(q), Y(q)) : x.moveTo(X(q), Y(q))));
      x.closePath();
      x.fillStyle = m.invert
        ? (on ? 'rgba(255,214,10,.20)' : 'rgba(255,214,10,.10)')
        : (on ? 'rgba(255,55,95,.30)' : 'rgba(255,55,95,.16)');
      x.fill();
      x.strokeStyle = m.enabled ? (m.invert ? '#ffd60a' : '#ff375f') : '#666';
      x.lineWidth = on ? 2 : 1.2;
      x.setLineDash(m.enabled ? [] : [4, 3]);
      x.stroke();
      x.setLineDash([]);
      if (on) m.points.forEach((q, i) => this._handle(x, X(q), Y(q), i === this.selPoint, '#ff375f'));
    }

    // surfaces
    (p.surfaces || []).forEach((s, si) => {
      const on = this.sel?.type === 'surface' && this.sel.id === s.id;
      const m = s.mesh;
      const cor = Mesh.corners(m);
      x.strokeStyle = s.enabled ? (on ? '#00d4ff' : 'rgba(0,212,255,.5)') : '#5a6068';
      x.lineWidth = on ? 2 : 1.2;
      x.setLineDash(s.enabled ? [] : [4, 3]);
      x.beginPath();
      x.moveTo(X(cor[0]), Y(cor[0]));
      for (let i = 1; i < 4; i++) x.lineTo(X(cor[i]), Y(cor[i]));
      x.closePath(); x.stroke();
      x.setLineDash([]);

      if (m.cols > 1 || m.rows > 1) {
        x.strokeStyle = on ? 'rgba(0,212,255,.35)' : 'rgba(0,212,255,.16)';
        x.lineWidth = 1;
        x.beginPath();
        for (let j = 1; j < m.rows; j++)
          for (let i = 0; i <= m.cols; i++) {
            const q = Mesh.at(m, i, j); i ? x.lineTo(X(q), Y(q)) : x.moveTo(X(q), Y(q));
          }
        for (let i = 1; i < m.cols; i++)
          for (let j = 0; j <= m.rows; j++) {
            const q = Mesh.at(m, i, j); j ? x.lineTo(X(q), Y(q)) : x.moveTo(X(q), Y(q));
          }
        x.stroke();
      }

      const cen = Mesh.evalMesh(m, 0.5, 0.5);
      x.fillStyle = on ? '#00d4ff' : 'rgba(160,190,205,.75)';
      x.font = (on ? '600 ' : '') + '11px -apple-system,sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText((si + 1) + '. ' + (s.name || 'Surface'), cen[0] * W, cen[1] * H);

      if (on) m.pts.forEach((q, i) => this._handle(x, X(q), Y(q), i === this.selPoint, '#00d4ff'));
    });

    // in-progress shape
    if (this.pending) {
      const pts = this.pending.points;
      x.strokeStyle = '#ffd60a'; x.lineWidth = 1.5; x.setLineDash([5, 3]);
      x.beginPath();
      pts.forEach((q, i) => (i ? x.lineTo(X(q), Y(q)) : x.moveTo(X(q), Y(q))));
      if (this.pending.cursor) x.lineTo(X(this.pending.cursor), Y(this.pending.cursor));
      x.stroke(); x.setLineDash([]);
      pts.forEach((q) => this._handle(x, X(q), Y(q), false, '#ffd60a'));
    }
    this._info();
  }

  // Effect points: a lamp, a vanishing point, the centre of a kaleidoscope.
  // Drawn as a ringed crosshair with the label of what it is.
  _drawFxPoints(x, W, H) {
    const pts = this.hooks.fxPoints ? this.hooks.fxPoints() : null;
    if (!pts || !pts.length) return;
    for (const pt of pts) {
      // a lamp above the frame still needs a handle: pin it to the edge, dashed
      const cx = Math.max(0.02, Math.min(0.98, pt.x)), cy = Math.max(0.03, Math.min(0.97, pt.y));
      const outside = cx !== pt.x || cy !== pt.y;
      const px = cx * W, py = cy * H;
      const active = this.fxDrag && this.fxDrag.pt.id === pt.id;
      const col = pt.color || '#ffd60a';
      x.save();
      x.shadowColor = 'rgba(0,0,0,.7)'; x.shadowBlur = 4;
      x.strokeStyle = col; x.lineWidth = active ? 2.2 : 1.6;
      if (outside) x.setLineDash([3, 3]);
      x.beginPath(); x.arc(px, py, active ? 11 : 9, 0, Math.PI * 2); x.stroke();
      x.setLineDash([]);
      if (outside) {
        // an arrow towards where the point really is
        const ax = pt.x - cx, ay = pt.y - cy, m = Math.hypot(ax, ay) || 1;
        x.beginPath(); x.moveTo(px + (ax / m) * 12, py + (ay / m) * 12); x.lineTo(px + (ax / m) * 22, py + (ay / m) * 22); x.stroke();
      }
      x.beginPath();
      x.moveTo(px - 15, py); x.lineTo(px - 5, py); x.moveTo(px + 5, py); x.lineTo(px + 15, py);
      x.moveTo(px, py - 15); x.lineTo(px, py - 5); x.moveTo(px, py + 5); x.lineTo(px, py + 15);
      x.stroke();
      x.fillStyle = col;
      x.beginPath(); x.arc(px, py, 2.2, 0, Math.PI * 2); x.fill();
      x.font = '600 11px -apple-system,sans-serif';
      x.textAlign = 'left'; x.textBaseline = 'middle';
      x.fillText(pt.label, px + 14, py - 12);
      x.restore();
    }
  }

  _hitFxPoint(n) {
    const pts = this.hooks.fxPoints ? this.hooks.fxPoints() : null;
    if (!pts || !pts.length) return null;
    const [pw, ph] = this.pxPerNorm();
    for (const pt of pts) {
      const cx = Math.max(0.02, Math.min(0.98, pt.x)), cy = Math.max(0.03, Math.min(0.97, pt.y));
      if (Math.hypot((cx - n[0]) * pw, (cy - n[1]) * ph) <= HIT + 4) return pt;
    }
    return null;
  }

  _handle(x, px, py, active, col) {
    const r = active ? 5.5 : 4;
    x.beginPath(); x.rect(px - r, py - r, r * 2, r * 2);
    x.fillStyle = active ? col : '#0e0f11';
    x.strokeStyle = col; x.lineWidth = 1.6;
    x.fill(); x.stroke();
  }

  _info() {
    const [ow, oh] = this.hooks.outputSize();
    const s = this.selected();
    let t = `${ow}x${oh}  ${Math.round(this.zoom * 100)}%`;
    if (s) t += `   ${this.sel.type} "${s.name}"` + (this.selPoint != null ? `  pt ${this.selPoint}` : '');
    if (this.hover) t += `   ${(this.hover[0] * ow).toFixed(0)},${(this.hover[1] * oh).toFixed(0)}`;
    this.info.textContent = t;
  }

  // ------------------------------------------------------------ hit testing
  _hitPoint(n) {
    const p = this.hooks.project();
    const [pw, ph] = this.pxPerNorm();
    const near = (q) => Math.hypot((q[0] - n[0]) * pw, (q[1] - n[1]) * ph) <= HIT;
    // prefer the current selection so overlapping objects stay editable
    const order = [];
    if (this.sel) order.push(this.sel);
    for (const s of p.surfaces) order.push({ type: 'surface', id: s.id });
    for (const m of p.masks) order.push({ type: 'mask', id: m.id });
    for (const o of order) {
      const obj = (o.type === 'surface' ? p.surfaces : p.masks).find((z) => z.id === o.id);
      if (!obj) continue;
      const pts = o.type === 'surface' ? obj.mesh.pts : obj.points;
      for (let i = 0; i < pts.length; i++) if (near(pts[i])) return { ...o, point: i };
    }
    return null;
  }

  _hitBody(n) {
    const p = this.hooks.project();
    for (let i = p.masks.length - 1; i >= 0; i--)
      if (inPoly(n, p.masks[i].points)) return { type: 'mask', id: p.masks[i].id };
    for (let i = p.surfaces.length - 1; i >= 0; i--) {
      const c = Mesh.corners(p.surfaces[i].mesh);
      if (inPoly(n, c)) return { type: 'surface', id: p.surfaces[i].id };
    }
    return null;
  }

  // -------------------------------------------------------------- snapping
  _snap(n, exclude) {
    const [pw, ph] = this.pxPerNorm();
    const cand = { x: [0, 0.5, 1], y: [0, 0.5, 1] };
    const p = this.hooks.project();
    for (const s of p.surfaces) {
      for (const q of s.mesh.pts) { if (q === exclude) continue; cand.x.push(q[0]); cand.y.push(q[1]); }
    }
    for (const m of p.masks) for (const q of m.points) { if (q === exclude) continue; cand.x.push(q[0]); cand.y.push(q[1]); }
    let out = [n[0], n[1]];
    let bx = SNAP, by = SNAP;
    for (const v of cand.x) { const d = Math.abs(v - n[0]) * pw; if (d < bx) { bx = d; out[0] = v; } }
    for (const v of cand.y) { const d = Math.abs(v - n[1]) * ph; if (d < by) { by = d; out[1] = v; } }
    return out;
  }

  // ---------------------------------------------------------------- events
  _bind() {
    const f = this.frame;
    f.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._move(e));
    window.addEventListener('pointerup', (e) => this._up(e));
    f.addEventListener('dblclick', (e) => this._dbl(e));
    this.view.addEventListener('wheel', (e) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const r = this.frame.getBoundingClientRect();
        this.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, { x: e.clientX - r.left, y: e.clientY - r.top });
      } else if (e.shiftKey) {
        e.preventDefault();
        this.pan.x -= e.deltaX; this.pan.y -= e.deltaY; this.layout();
      }
    }, { passive: false });
  }

  _down(e) {
    if (e.button === 1 || (e.button === 0 && e.altKey && this.tool === 'select')) {
      this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: this.pan.x, py: this.pan.y };
      return;
    }
    if (e.button !== 0) return;
    const n = this.toNorm(e);
    const p = this.hooks.project();

    // an effect's point beats everything else: it only shows when that layer is selected
    const fp = this._hitFxPoint(n);
    if (fp) {
      this.fxDrag = { pt: fp, start: n };
      this.drag = { kind: 'fxpoint' };
      fp.set(n[0], n[1]);
      this.draw();
      return;
    }
    if (this.plain) return;

    if (this.tool === 'maskPoly') {
      if (!this.pending) this.pending = { kind: 'maskPoly', points: [] };
      const pts = this.pending.points;
      if (pts.length >= 3) {
        const [pw, ph] = this.pxPerNorm();
        if (Math.hypot((pts[0][0] - n[0]) * pw, (pts[0][1] - n[1]) * ph) < HIT + 3) return this._commitPending();
      }
      pts.push(this._snap(n));
      this.draw();
      return;
    }
    if (this.tool === 'maskRect' || this.tool === 'addSurface') {
      this.drag = { kind: 'rect', tool: this.tool, start: this._snap(n), cur: n };
      this.pending = { kind: this.tool, points: rectPts(this.drag.start, n) };
      this.draw();
      return;
    }

    // select tool
    const hp = this._hitPoint(n);
    if (hp) {
      this.select(hp.type, hp.id, hp.point);
      const obj = (hp.type === 'surface' ? p.surfaces : p.masks).find((o) => o.id === hp.id);
      const pts = hp.type === 'surface' ? obj.mesh.pts : obj.points;
      this.drag = { kind: 'point', obj, pts, i: hp.point, start: n, orig: [...pts[hp.point]], free: e.metaKey };
      return;
    }
    const hb = this._hitBody(n);
    if (hb) {
      this.select(hb.type, hb.id, null);
      const obj = (hb.type === 'surface' ? p.surfaces : p.masks).find((o) => o.id === hb.id);
      const pts = hb.type === 'surface' ? obj.mesh.pts : obj.points;
      this.drag = { kind: 'move', obj, pts, start: n, orig: pts.map((q) => [...q]) };
      return;
    }
    this.select(null, null);
  }

  _move(e) {
    this.hover = this.toNorm(e);
    const d = this.drag;
    if (!d) {
      if (this.pending && this.pending.kind === 'maskPoly') { this.pending.cursor = this.hover; this.draw(); }
      else this._info();
      return;
    }
    const n = this.hover;
    if (d.kind === 'fxpoint') {
      this.fxDrag.pt.set(n[0], n[1]);
      this.draw();
      return;
    }
    if (d.kind === 'pan') {
      this.pan.x = d.px + (e.clientX - d.sx);
      this.pan.y = d.py + (e.clientY - d.sy);
      this.layout();
      return;
    }
    if (d.kind === 'rect') {
      let cur = e.metaKey ? n : this._snap(n);
      if (e.shiftKey) {   // square-ish / keep 16:9
        const [ow, oh] = this.hooks.outputSize();
        const w = cur[0] - d.start[0];
        cur = [cur[0], d.start[1] + (w * ow) / oh * Math.sign((cur[1] - d.start[1]) || 1) * Math.sign(w || 1) * (9 / 16) * (16 / 9)];
        cur[1] = d.start[1] + Math.abs(w) * (ow / oh) * (cur[1] > d.start[1] ? 1 : -1) * (9 / 16);
      }
      d.cur = cur;
      this.pending.points = rectPts(d.start, cur);
      this.draw();
      return;
    }
    if (d.kind === 'point') {
      let t = d.free || e.metaKey ? n : this._snap(n, d.pts[d.i]);
      if (e.shiftKey) {
        const dx = Math.abs(t[0] - d.orig[0]), dy = Math.abs(t[1] - d.orig[1]);
        if (dx > dy) t = [t[0], d.orig[1]]; else t = [d.orig[0], t[1]];
      }
      d.pts[d.i][0] = t[0]; d.pts[d.i][1] = t[1];
      this._changed();
      return;
    }
    if (d.kind === 'move') {
      let dx = n[0] - d.start[0], dy = n[1] - d.start[1];
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      d.pts.forEach((q, i) => { q[0] = d.orig[i][0] + dx; q[1] = d.orig[i][1] + dy; });
      this._changed();
    }
  }

  _up() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'fxpoint') { const pt = this.fxDrag.pt; this.fxDrag = null; pt.done?.(); this.draw(); return; }
    if (d.kind === 'rect') {
      const a = d.start, b = d.cur;
      const w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
      this.pending = null;
      if (w < 0.01 || h < 0.01) { this.draw(); return; }
      const pts = rectPts(a, b);
      if (d.tool === 'maskRect') this._addMask(pts);
      else this._addSurface(pts);
      this.setTool('select');
      return;
    }
    if (d.kind === 'point' || d.kind === 'move') this._changed(true);
  }

  _dbl(e) {
    if (this.tool === 'maskPoly') { this._commitPending(); return; }
    // double-click a mask edge inserts a point there
    const n = this.toNorm(e);
    const o = this.selected();
    if (this.sel?.type === 'mask' && o) {
      const [pw, ph] = this.pxPerNorm();
      let best = -1, bestD = 10;
      for (let i = 0; i < o.points.length; i++) {
        const a = o.points[i], b = o.points[(i + 1) % o.points.length];
        const d = segDist(n, a, b, pw, ph);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) {
        o.points.splice(best + 1, 0, n);
        this.selPoint = best + 1;
        this._changed(true);
      }
    }
  }

  _commitPending() {
    if (!this.pending) return;
    const pts = this.pending.points;
    this.pending = null;
    if (pts.length >= 3) this._addMask(pts);
    this.setTool('select');
  }

  _addMask(points) {
    const p = this.hooks.project();
    const m = defaultMask({ name: 'Mask ' + (p.masks.length + 1), points: points.map((q) => [...q]) });
    p.masks.push(m);
    this.select('mask', m.id);
    this._changed(true);
  }

  _addSurface(pts) {
    const p = this.hooks.project();
    const s = defaultSurface({
      name: 'Surface ' + (p.surfaces.length + 1),
      mesh: { cols: 1, rows: 1, pts: [pts[0], pts[1], pts[3], pts[2]].map((q) => [...q]) },
    });
    p.surfaces.push(s);
    this.select('surface', s.id);
    this._changed(true);
  }

  _changed(commit) { this.hooks.onChange(commit); this.draw(); }

  // ------------------------------------------------------------- keyboard
  key(e) {
    const o = this.selected();
    if (e.key === 'Escape') { this.pending = null; this.setTool('select'); return true; }
    if (e.key === 'Enter' && this.pending) { this._commitPending(); return true; }
    if (!o) return false;
    const [ow, oh] = this.hooks.outputSize();
    const step = (e.shiftKey ? 10 : 1);
    const map = { ArrowLeft: [-step / ow, 0], ArrowRight: [step / ow, 0], ArrowUp: [0, -step / oh], ArrowDown: [0, step / oh] };
    if (map[e.key]) {
      const [dx, dy] = map[e.key];
      const pts = this.sel.type === 'surface' ? o.mesh.pts : o.points;
      if (this.selPoint != null && pts[this.selPoint]) {
        pts[this.selPoint][0] += dx; pts[this.selPoint][1] += dy;
      } else pts.forEach((q) => { q[0] += dx; q[1] += dy; });
      this._changed(true);
      return true;
    }
    if ((e.key === 'Backspace' || e.key === 'Delete')) {
      const p = this.hooks.project();
      if (this.sel.type === 'mask' && this.selPoint != null && o.points.length > 3) {
        o.points.splice(this.selPoint, 1); this.selPoint = null;
      } else {
        const list = this.sel.type === 'surface' ? p.surfaces : p.masks;
        const i = list.findIndex((z) => z.id === o.id);
        if (i >= 0) list.splice(i, 1);
        this.select(null, null);
      }
      this._changed(true);
      return true;
    }
    return false;
  }
}

// ------------------------------------------------------------------ helpers
function rectPts(a, b) {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

function inPoly(n, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > n[1] !== yj > n[1] && n[0] < ((xj - xi) * (n[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(n, a, b, pw, ph) {
  const ax = a[0] * pw, ay = a[1] * ph, bx = b[0] * pw, by = b[1] * ph;
  const px = n[0] * pw, py = n[1] * ph;
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / L;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
