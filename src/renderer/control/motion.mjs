// Turn the aligned camera into something the physics can feel.
//
// The camera-to-projector homography is already solved for the mapping
// workflow, so a frame can be resampled straight into output space. Successive
// frames are differenced there, the moving regions are clustered, and each
// cluster becomes an interactor — a moving blob with a velocity that shoves
// balls, stirs water and fans smoke exactly where a person is standing in
// front of the wall.

import * as M from '/shared/mat3.mjs';

const CAM_W = 192;         // luminance sample of the camera frame
const GRID_W = 84;         // output-space analysis grid
const MAX_BLOBS = 4;

export class MotionTracker {
  constructor(video) {
    this.video = video;
    this.cam = document.createElement('canvas');
    this.camCtx = this.cam.getContext('2d', { willReadFrequently: true });
    this.gw = GRID_W; this.gh = Math.round(GRID_W * 9 / 16);
    this.cur = new Float32Array(this.gw * this.gh);
    this.prev = new Float32Array(this.gw * this.gh);
    this.acc = new Float32Array(this.gw * this.gh);
    this.map = null;         // grid cell -> camera pixel index
    this.mapKey = '';
    this.blobs = [];
    this.warm = 0;
    this.lastT = 0;
  }

  _buildMap(H, aspect) {
    const key = H.join(',') + '|' + aspect + '|' + this.camW + 'x' + this.camH;
    if (key === this.mapKey) return;
    this.mapKey = key;
    const Hi = M.invert(H);                 // output-normalized -> camera-normalized
    const gw = this.gw, gh = this.gh;
    const map = new Int32Array(gw * gh).fill(-1);
    for (let j = 0; j < gh; j++) {
      const oy = (j + 0.5) / gh;            // output-normalized y (0..1)
      for (let i = 0; i < gw; i++) {
        const ox = (i + 0.5) / gw;
        const p = M.apply(Hi, ox, oy);
        const cx = Math.round(p[0] * this.camW), cy = Math.round(p[1] * this.camH);
        if (cx < 0 || cy < 0 || cx >= this.camW || cy >= this.camH) continue;
        map[j * gw + i] = cy * this.camW + cx;
      }
    }
    this.map = map;
  }

  /**
   * @param {Float64Array} H camera-normalized -> output-normalized homography
   * @param {number} aspect output height / width
   * @param {object} opts { sensitivity, radius, strength }
   * @returns interactors in world coordinates, or []
   */
  update(H, aspect, opts = {}) {
    const v = this.video;
    if (!H || !v || !v.videoWidth) return [];
    const now = performance.now();
    if (now - this.lastT < 33) return this.blobs;      // ~30 Hz is plenty
    const dt = Math.min(0.25, (now - this.lastT) / 1000) || 0.033;
    this.lastT = now;

    const cw = CAM_W, ch = Math.max(2, Math.round((CAM_W * v.videoHeight) / v.videoWidth));
    if (this.cam.width !== cw || this.cam.height !== ch) {
      this.cam.width = cw; this.cam.height = ch;
      this.camW = cw; this.camH = ch;
      this.mapKey = '';
    }
    this.camW = cw; this.camH = ch;
    try { this.camCtx.drawImage(v, 0, 0, cw, ch); } catch { return []; }
    const px = this.camCtx.getImageData(0, 0, cw, ch).data;

    this._buildMap(H, aspect);
    const gw = this.gw, gh = this.gh;
    const cur = this.cur, prev = this.prev, acc = this.acc, map = this.map;
    const sens = opts.sensitivity == null ? 1 : opts.sensitivity;
    const thresh = 0.055 / Math.max(0.15, sens);

    let any = 0;
    for (let k = 0; k < gw * gh; k++) {
      const m = map[k];
      if (m < 0) { cur[k] = 0; continue; }
      const o = m * 4;
      // Rec.709 luma, cheap enough at this resolution
      cur[k] = (px[o] * 0.2126 + px[o + 1] * 0.7152 + px[o + 2] * 0.0722) / 255;
    }
    if (this.warm < 3) { this.warm++; prev.set(cur); return []; }

    for (let k = 0; k < gw * gh; k++) {
      const d = Math.abs(cur[k] - prev[k]);
      // a short trail keeps a slow-moving person from flickering in and out
      acc[k] = Math.max(acc[k] * 0.72, d > thresh ? d : 0);
      if (acc[k] > thresh) any++;
    }
    prev.set(cur);
    if (!any) { this.blobs = decay(this.blobs, dt); return this.blobs; }

    // greedy clustering: take the strongest cell, absorb its neighbourhood,
    // repeat. Cheap, stable, and good enough for "where are the people".
    const used = this._used || (this._used = new Uint8Array(gw * gh));
    used.fill(0);
    const found = [];
    for (let b = 0; b < MAX_BLOBS; b++) {
      let best = 0, bi = -1;
      for (let k = 0; k < gw * gh; k++) if (!used[k] && acc[k] > best) { best = acc[k]; bi = k; }
      if (bi < 0 || best < thresh) break;
      const bx = bi % gw, by = (bi / gw) | 0;
      const R = Math.round(gw * 0.11);
      let sx = 0, sy = 0, sw = 0, n = 0;
      for (let j = Math.max(0, by - R); j <= Math.min(gh - 1, by + R); j++) {
        for (let i = Math.max(0, bx - R); i <= Math.min(gw - 1, bx + R); i++) {
          const k = j * gw + i;
          if (used[k]) continue;
          used[k] = 1;
          const w = acc[k];
          if (w <= thresh) continue;
          sx += i * w; sy += j * w; sw += w; n++;
        }
      }
      if (sw <= 0 || n < 3) continue;
      found.push({
        x: (sx / sw + 0.5) / gw,
        y: ((sy / sw + 0.5) / gh) * aspect,
        w: sw / n,
        n,
      });
    }

    // match to the previous frame's blobs to get a velocity
    const radius = opts.radius == null ? 0.09 : opts.radius;
    const strength = opts.strength == null ? 1 : opts.strength;
    const out = [];
    for (const f of found) {
      let bestD = 0.16 * 0.16, match = null;
      for (const p of this.blobs) {
        const dx = p.x - f.x, dy = p.y - f.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) { bestD = d2; match = p; }
      }
      const vx = match ? (f.x - match.x) / dt : 0;
      const vy = match ? (f.y - match.y) / dt : 0;
      out.push({
        x: f.x, y: f.y,
        vx: clampV(match ? match.vx * 0.5 + vx * 0.5 : 0),
        vy: clampV(match ? match.vy * 0.5 + vy * 0.5 : 0),
        r: radius * (0.7 + Math.min(1.4, f.n / (gw * 0.9))),
        strength: strength * Math.min(1.6, f.w * 8),
        down: false,
        source: 'camera',
      });
    }
    this.blobs = out;
    return out;
  }

  /**
   * A coarse picture of what the tracker sees, drawn in output space so it can
   * be laid straight over the stage. `aspect` is output height / width.
   */
  drawDebugOver(ctx, w, h, aspect) {
    const gw = this.gw, gh = this.gh, acc = this.acc;
    const cw = w / gw, chh = h / gh;
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const a = Math.min(1, acc[j * gw + i] * 6);
        if (a < 0.05) continue;
        ctx.fillStyle = `rgba(0,212,255,${a * 0.65})`;
        ctx.fillRect(i * cw, j * chh, cw + 1, chh + 1);
      }
    }
    for (const b of this.blobs) {
      const px = b.x * w, py = (b.y / aspect) * h;
      ctx.strokeStyle = '#ff375f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(4, b.r * w), 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + b.vx * w * 0.12, py + (b.vy / aspect) * h * 0.12);
      ctx.stroke();
    }
  }
}

const clampV = (v) => Math.max(-4, Math.min(4, v));

function decay(blobs, dt) {
  const out = [];
  for (const b of blobs) {
    const s = b.strength * Math.max(0, 1 - dt * 3);
    if (s < 0.05) continue;
    out.push({ ...b, strength: s, vx: b.vx * 0.7, vy: b.vy * 0.7 });
  }
  return out;
}
