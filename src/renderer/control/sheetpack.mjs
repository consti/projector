// Sheets the way the image model returns them: several rows of figures on
// magenta, spaced however it felt like. Rather than demand a strict grid, key
// the magenta, find the sprites, cluster them into rows by height, sort each
// row left to right, and pack them into a regular grid the game can slice —
// then stitch every animation of a character into one sheet, one row each,
// with a manifest. A port of pixel-it's rowsheet.js and combine.js onto canvas.

export function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image failed')); i.src = src; });
}

/** Draw a source at its own size into fresh ImageData. */
function imageDataOf(img, w = img.width || img.naturalWidth, h = img.height || img.naturalHeight) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const x = cv.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = false;
  x.drawImage(img, 0, 0, w, h);
  return x.getImageData(0, 0, w, h);
}

/**
 * Magenta → transparent (alpha 0/255), colour under transparent pixels zeroed
 * so nothing bleeds at the edges; specks dropped. Returns ImageData.
 */
export function chromaKey(img) {
  const id = imageDataOf(img);
  const { width: W, height: H, data: d } = id;
  for (let p = 0; p < W * H; p++) {
    const r = d[p * 4], g = d[p * 4 + 1], b = d[p * 4 + 2];
    const magenta = (r > 140 && b > 140 && g < Math.min(r, b) - 50) || (r - g > 70 && b - g > 70);
    if (magenta) { d[p * 4] = 0; d[p * 4 + 1] = 0; d[p * 4 + 2] = 0; d[p * 4 + 3] = 0; } else d[p * 4 + 3] = 255;
  }
  // specks: components under 250 px
  const seen = new Uint8Array(W * H), stack = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (seen[i] || !d[i * 4 + 3]) continue;
    let top = 0; const comp = [];
    stack[top++] = i; seen[i] = 1;
    while (top) {
      const p = stack[--top]; comp.push(p);
      const px = p % W, py = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (!seen[n] && d[n * 4 + 3]) { seen[n] = 1; stack[top++] = n; }
      }
    }
    if (comp.length < 250) for (const p of comp) { d[p * 4 + 3] = 0; d[p * 4] = 0; d[p * 4 + 1] = 0; d[p * 4 + 2] = 0; }
  }
  return id;
}

/** Connected components (8-conn) over opaque pixels, merged when they nearly touch, specks dropped. */
export function findSprites(id, { gap = 3, minArea } = {}) {
  const { width: W, height: H, data } = id;
  const seen = new Uint8Array(W * H), stack = new Int32Array(W * H);
  let blobs = [];
  for (let i = 0; i < W * H; i++) {
    if (seen[i] || !data[i * 4 + 3]) continue;
    let top = 0, count = 0; stack[top++] = i; seen[i] = 1;
    const b = { minX: W, minY: H, maxX: 0, maxY: 0 };
    while (top) {
      const p = stack[--top], px = p % W, py = (p / W) | 0; count++;
      if (px < b.minX) b.minX = px; if (px > b.maxX) b.maxX = px; if (py < b.minY) b.minY = py; if (py > b.maxY) b.maxY = py;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (!seen[n] && data[n * 4 + 3]) { seen[n] = 1; stack[top++] = n; }
      }
    }
    blobs.push({ ...b, count });
  }
  const near = (a, b) => a.minX < b.maxX + gap && b.minX < a.maxX + gap && a.minY < b.maxY + gap && b.minY < a.maxY + gap;
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let i = 0; i < blobs.length; i++) for (let j = i + 1; j < blobs.length; j++) if (near(blobs[i], blobs[j])) {
      blobs[i] = { minX: Math.min(blobs[i].minX, blobs[j].minX), minY: Math.min(blobs[i].minY, blobs[j].minY), maxX: Math.max(blobs[i].maxX, blobs[j].maxX), maxY: Math.max(blobs[i].maxY, blobs[j].maxY), count: blobs[i].count + blobs[j].count };
      blobs.splice(j, 1); merged = true; break outer;
    }
  }
  const min = minArea == null ? W * H * 0.0015 : minArea;      // a sprite, not a stray speck or a dropped hat
  return blobs.filter((b) => b.count > min);
}

/**
 * Group sprites into rows. Sorted by top edge, a sprite joins the current row
 * while it overlaps that row's vertical span (an airborne jump frame stays with
 * its grounded neighbours); a gap with no overlap starts the next row.
 */
export function clusterRows(sprites) {
  const s = sprites.map((b) => ({ ...b, h: b.maxY - b.minY + 1 })).sort((a, b) => a.minY - b.minY);
  const rows = [];
  let row = null, bottom = 0;
  for (const b of s) {
    if (row && b.minY < bottom - b.h * 0.25) { row.push(b); bottom = Math.max(bottom, b.maxY); continue; }
    row = [b]; rows.push(row); bottom = b.maxY;
  }
  return rows.map((r) => r.sort((a, b) => a.minX - b.minX));
}

/**
 * Two figures drawn touching come out as one blob. A straight column cut goes
 * through whichever limb is thinnest, so instead the blob's mask is eroded
 * until the thin contact breaks, the pieces are labelled, and the labels are
 * grown back over every original pixel; each part gets its own pixel mask.
 */
export function splitBlobByErosion(b, id, k = 2) {
  const { width: W, data } = id;
  const bw = b.maxX - b.minX + 1, bh = b.maxY - b.minY + 1, N = bw * bh;
  const mask = new Uint8Array(N);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) mask[y * bw + x] = data[((b.minY + y) * W + b.minX + x) * 4 + 3] ? 1 : 0;
  const at = (m, x, y) => (x < 0 || y < 0 || x >= bw || y >= bh) ? 0 : m[y * bw + x];
  for (const r of [2, 3, 4, 6, 8]) {
    const er = new Uint8Array(N);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      if (!mask[y * bw + x]) continue;
      let ok = 1;
      for (let dy = -r; dy <= r && ok; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r && !at(mask, x + dx, y + dy)) { ok = 0; break; }
      er[y * bw + x] = ok;
    }
    const label = new Int32Array(N).fill(-1); const sizes = [];
    for (let i = 0; i < N; i++) {
      if (!er[i] || label[i] >= 0) continue;
      const idn = sizes.length; let size = 0; const st = [i]; label[i] = idn;
      while (st.length) {
        const p = st.pop(); size++; const px = p % bw, py = (p / bw) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = px + dx, ny = py + dy; if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue; const n = ny * bw + nx; if (er[n] && label[n] < 0) { label[n] = idn; st.push(n); } }
      }
      sizes.push(size);
    }
    const big = sizes.map((sz, idn) => ({ sz, id: idn })).filter((c) => c.sz > b.count * 0.04).sort((a, c) => c.sz - a.sz);
    if (big.length < k) continue;
    const keep = new Map(big.slice(0, k).map((c, i) => [c.id, i]));
    const out = new Int32Array(N).fill(-1); const q = [];
    for (let i = 0; i < N; i++) if (label[i] >= 0 && keep.has(label[i])) { out[i] = keep.get(label[i]); q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const p = q[h], px = p % bw, py = (p / bw) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = px + dx, ny = py + dy; if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue; const n = ny * bw + nx; if (mask[n] && out[n] < 0) { out[n] = out[p]; q.push(n); } }
    }
    const parts = [];
    for (let j = 0; j < k; j++) {
      let minX = bw, minY = bh, maxX = -1, maxY = -1, count = 0;
      for (let i = 0; i < N; i++) if (out[i] === j) { count++; const x = i % bw, y = (i / bw) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      if (maxX < 0) continue;
      const pw = maxX - minX + 1, ph = maxY - minY + 1, pm = new Uint8Array(pw * ph);
      for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) pm[y * pw + x] = out[(minY + y) * bw + minX + x] === j ? 1 : 0;
      parts.push({ minX: b.minX + minX, minY: b.minY + minY, maxX: b.minX + maxX, maxY: b.minY + maxY, count, mask: pm });
    }
    if (parts.length === k) return parts.sort((a, c) => a.minX - c.minX);
  }
  return null;
}

/** A row with fewer sprites than asked for almost always has two figures touching: split the widest until it has enough. */
export function splitToCount(row, n, id) {
  row = row.slice();
  while (row.length < n) {
    const widths = row.map((b) => b.maxX - b.minX + 1), med = widths.slice().sort((a, b) => a - b)[widths.length >> 1];
    let wi = 0; widths.forEach((w, i) => { if (w > widths[wi]) wi = i; });
    const b = row[wi], bw = widths[wi];
    if (bw < med * 1.4) break;
    const k = Math.min(n - row.length + 1, Math.max(2, Math.round(bw / med)));
    const parts = splitBlobByErosion(b, id, k);
    if (!parts) break;
    row.splice(wi, 1, ...parts);
    row.sort((a, c) => a.minX - c.minX);
  }
  return row;
}

/**
 * Key a raw sheet and read its rows of sprites. `expect` = frames per row asked for.
 * Returns { id (keyed ImageData), rows: [[blob…]…] } — blobs carry their own mask when split.
 */
export function readRows(img, expect) {
  const id = chromaKey(img);
  let rows = clusterRows(findSprites(id)).slice(0, expect.length);
  rows = rows.map((r, i) => (expect[i] ? splitToCount(r, expect[i], id).slice(0, expect[i]) : r));
  return { id, rows };
}

/**
 * Stitch animations into one sheet: one row per animation, cells sized to the
 * largest frame, feet on a common baseline per row (airborne frames keep their
 * lift above the row's floor). `anims` = [{ key, fps, loop, frames: [{ id, blob }] }].
 * Returns { canvas, manifest }.
 */
export function combine(anims, { baseline = 0.06 } = {}) {
  const rows = anims.filter((a) => a.frames.length);
  const frames = rows.flatMap((r) => r.frames.map((f) => ({ ...f, w: f.blob.maxX - f.blob.minX + 1, h: f.blob.maxY - f.blob.minY + 1, bottomGap: (f.blob.cellBottom != null ? f.blob.cellBottom : f.id.height - 1) - f.blob.maxY })));
  const cols = Math.max(...rows.map((r) => r.frames.length));
  const maxW = Math.max(...frames.map((f) => f.w)), maxH = Math.max(...frames.map((f) => f.h));
  const cw = maxW + 16, ch = Math.round((maxH + 8) / (1 - baseline));
  const out = document.createElement('canvas'); out.width = cw * cols; out.height = ch * rows.length;
  const ox = out.getContext('2d');
  const outId = ox.createImageData(out.width, out.height);
  const manifest = {};
  let fi = 0;
  rows.forEach((row, ri) => {
    const fr = row.frames.map(() => frames[fi++]);
    // the row's floor is its lowest sole; a frame higher than that keeps the difference as lift
    const maxGap = Math.min(...fr.map((f) => f.bottomGap));
    fr.forEach((f, ci) => {
      const lift = Math.min(f.bottomGap - maxGap, ch * 0.3);
      const x0 = Math.round(ci * cw + (cw - f.w) / 2), y0 = Math.round((ri + 1) * ch - ch * baseline - f.h - lift);
      const b = f.blob, src = f.id;
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
        if (b.mask && !b.mask[y * f.w + x]) continue;
        const si = ((b.minY + y) * src.width + b.minX + x) * 4, di = ((y0 + y) * out.width + x0 + x) * 4;
        if (!src.data[si + 3]) continue;
        outId.data[di] = src.data[si]; outId.data[di + 1] = src.data[si + 1]; outId.data[di + 2] = src.data[si + 2]; outId.data[di + 3] = src.data[si + 3];
      }
    });
    manifest[row.key] = { frames: row.frames.map((_, i) => ri * cols + i), fps: row.fps, loop: row.loop !== false };
  });
  ox.putImageData(outId, 0, 0);
  return { canvas: out, manifest: { cols, rows: rows.length, cell: { w: cw, h: ch }, baseline, anims: manifest } };
}

/** The frames of an existing sheet with a manifest, as { id, blob } per cell, for re-stitching with new rows. */
export function framesOf(img, manifest) {
  const id = imageDataOf(img);
  const { width: W, height: H, data } = id;
  const cw = W / manifest.cols, ch = H / manifest.rows;
  const cellBlob = (cell) => {
    const c = cell % manifest.cols, r = Math.floor(cell / manifest.cols);
    const x0 = Math.floor(c * cw), y0 = Math.floor(r * ch), x1 = Math.floor((c + 1) * cw), y1 = Math.floor((r + 1) * ch);
    let minX = W, minY = H, maxX = -1, maxY = -1, count = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (data[(y * W + x) * 4 + 3] > 40) { count++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    if (maxX < 0) return null;
    // the frame's floor is its own cell's floor: report bottomGap against the cell, not the sheet
    return { minX, minY, maxX, maxY, count, cellBottom: y1 - 1 };
  };
  const out = [];
  for (const [key, a] of Object.entries(manifest.anims || {})) {
    const frames = [];
    for (const cell of a.frames) { const b = cellBlob(cell); if (b) frames.push({ id, blob: b }); }
    if (frames.length) out.push({ key, fps: a.fps, loop: a.loop !== false, frames });
  }
  return out;
}
