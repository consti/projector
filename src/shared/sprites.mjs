// A character's sprite set: one sheet with one animation per row (the Base
// layout pixel-it draws), or the older flat 4x2 / 4x4 sheets. Frames are
// measured once — the ink bounding box of every cell — so each animation is
// drawn at a consistent height with the feet exactly where the actor's feet
// are. The image model draws every cell at a slightly different scale, and
// drawing cells raw is what made the old walk jitter.
//
// A manifest: { cols, rows, cell: {w, h}, baseline, anims: { walk: { frames: [cell…], fps, loop } } }
// `baseline` is where the feet of a grounded frame sit above the cell bottom,
// as a fraction of the cell height.

// what to play when a sheet lacks an animation (the flat sheets have only idle / walk / fall / sit)
export const FALLBACK = {
  run: 'walk', jump: 'fall', climb: 'walk', crouch: 'sit', sleep: 'sit', shout: 'idle',
  dance2: 'dance', dance: 'idle', fall: 'idle', sit: 'idle', walk: 'idle', idle: null,
};

/** The manifest of a flat pixel-it sheet: 4x2 base rows, plus 4x2 dance rows when there are four rows. */
export function legacyManifest(rows = 2) {
  const anims = {
    idle: { frames: [0, 1], fps: 2, loop: true },
    walk: { frames: [2, 3, 4, 5], fps: 8, loop: true },
    fall: { frames: [6], fps: 1, loop: true },
    sit: { frames: [7], fps: 1, loop: true },
  };
  if (rows >= 4) {
    anims.dance = { frames: [8, 9, 10, 11], fps: 6, loop: true };
    anims.dance2 = { frames: [12, 13, 14, 15], fps: 6, loop: true };
  }
  return { cols: 4, rows, cell: { w: 384, h: 512 }, baseline: 24 / 512, anims };
}

/** Ink bounding box of every cell, sampled at 1/S. Returns [{ sx, sy, sw, sh, area }] in image pixels. */
export function measureCells(img, cols, rows, S = 4) {
  const w = Math.max(1, Math.floor(img.width / S)), h = Math.max(1, Math.floor(img.height / S));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data;
  const cw = w / cols, ch = h / rows;
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x0 = Math.floor(c * cw), y0 = Math.floor(r * ch), x1 = Math.floor((c + 1) * cw), y1 = Math.floor((r + 1) * ch);
    let minX = w, minY = h, maxX = -1, maxY = -1, area = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (d[(y * w + x) * 4 + 3] > 40) { area++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    out.push(maxX < 0
      ? { sx: c * (img.width / cols), sy: r * (img.height / rows), sw: img.width / cols, sh: img.height / rows, area: 0 }
      : { sx: minX * S, sy: minY * S, sw: (maxX - minX + 1) * S, sh: (maxY - minY + 1) * S, area });
  }
  return out;
}

export class SpriteSet {
  /**
   * @param {HTMLImageElement|HTMLCanvasElement} img
   * @param {object} manifest  see above
   */
  constructor(img, manifest) {
    this.img = img;
    this.cols = manifest.cols; this.rows = manifest.rows;
    this.anims = manifest.anims || {};
    this.frames = measureCells(img, this.cols, this.rows);
    const idle = (this.anims.idle && this.anims.idle.frames && this.anims.idle.frames[0]) || 0;
    this.ref = this.frames[idle].area ? this.frames[idle] : this.frames.find((f) => f.area) || this.frames[0];
    // per frame: uv rect on the sheet, height against the idle frame, width/height,
    // and lift — how far an airborne frame floats above its row's floor
    const ch = img.height / this.rows;
    const baseline = manifest.baseline != null ? manifest.baseline * ch : 0;
    for (let i = 0; i < this.frames.length; i++) {
      const f = this.frames[i];
      f.u = f.sx / img.width; f.v = f.sy / img.height; f.uw = f.sw / img.width; f.vh = f.sh / img.height;
      f.hRel = f.area ? f.sh / Math.max(1, this.ref.sh) : 1;
      f.aspect = f.sw / Math.max(1, f.sh);
      const cellBottom = (Math.floor(i / this.cols) + 1) * ch;
      f.lift = f.area ? Math.max(0, (cellBottom - baseline) - (f.sy + f.sh)) / Math.max(1, this.ref.sh) : 0;
    }
  }
  has(key) { const a = this.anims[key]; return !!(a && a.frames && a.frames.length); }
  /** The animation to play for `key`, following the fallback chain. */
  anim(key) {
    let k = key;
    for (let i = 0; i < 6 && k; i++) {
      const a = this.anims[k];
      if (a && a.frames && a.frames.length) return { key: k, frames: a.frames, fps: a.fps || 6, loop: a.loop !== false, wanted: key };
      k = FALLBACK[k];
    }
    return { key: 'idle', frames: [0], fps: 1, loop: true, wanted: key };
  }
  /** Which cell shows at time t (seconds into the animation). */
  frameAt(key, t) {
    const a = this.anim(key);
    const n = a.frames.length;
    const i = Math.max(0, Math.floor(t * a.fps));
    const idx = a.loop === false ? Math.min(n - 1, i) : i % n;
    return { cell: a.frames[idx], i: idx, n, done: a.loop === false && i >= n, fps: a.fps, key: a.key };
  }
  /** The cell at a position 0..1 through the animation (a walk driven by ground covered, a one-shot jump). */
  frameAtPhase(key, k) {
    const a = this.anim(key);
    const n = a.frames.length;
    const i = Math.floor(((k % 1) + 1) % 1 * n);
    return { cell: a.frames[Math.min(n - 1, i)], i, n, key: a.key };
  }
  duration(key) { const a = this.anim(key); return a.frames.length / a.fps; }
  frame(cell) { const f = this.frames[cell]; return f && f.area ? f : this.ref; }
}
