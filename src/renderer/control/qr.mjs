// A small QR encoder: byte mode, error-correction level M, versions 1–10 (up
// to 213 bytes), full mask selection. Enough for a LAN URL, and it saves a
// dependency and a network round trip for a code that has to work offline.

const EC_M = {
  //   [total codewords, ec codewords per block, blocks in group 1, data per block g1, blocks g2, data per block g2]
  1: [26, 10, 1, 16, 0, 0], 2: [44, 16, 1, 28, 0, 0], 3: [70, 26, 1, 44, 0, 0],
  4: [100, 18, 2, 32, 0, 0], 5: [134, 24, 2, 43, 0, 0], 6: [172, 16, 4, 27, 0, 0],
  7: [196, 18, 4, 31, 0, 0], 8: [242, 22, 2, 38, 2, 39], 9: [292, 22, 3, 36, 2, 37],
  10: [346, 26, 4, 43, 1, 44],
};
const ALIGN = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38],
  8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

// GF(256) with the QR polynomial 0x11d
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const gmul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;

function rsGenerator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const ng = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= gmul(g[j], EXP[i]); }
    g = ng;
  }
  return g;
}

function rsEncode(data, n) {
  const gen = rsGenerator(n);
  const res = new Uint8Array(data.length + n);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const c = res[i];
    if (!c) continue;
    for (let j = 1; j < gen.length; j++) res[i + j] ^= gmul(gen[j], c);
  }
  return res.slice(data.length);
}

/** @returns {{ size:number, mask:number, get:(x:number,y:number)=>boolean }} */
export function encodeQR(text) {
  const bytes = new TextEncoder().encode(text);
  let ver = 0;
  for (let v = 1; v <= 10; v++) {
    const e = EC_M[v];
    const cap = e[2] * e[3] + e[4] * e[5];
    const lenBits = v < 10 ? 8 : 16;
    if (4 + lenBits + bytes.length * 8 <= cap * 8) { ver = v; break; }
  }
  if (!ver) throw new Error('text too long for QR');
  const e = EC_M[ver];
  const dataCw = e[2] * e[3] + e[4] * e[5];

  // ---- bit stream
  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, dataCw * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = new Uint8Array(dataCw);
  for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; data[i >> 3] = v; }
  for (let i = bits.length >> 3, k = 0; i < dataCw; i++, k++) data[i] = k & 1 ? 0x11 : 0xec;

  // ---- blocks + interleave
  const blocks = [], ecs = [];
  let off = 0;
  for (let b = 0; b < e[2]; b++) { const d = data.slice(off, off + e[3]); off += e[3]; blocks.push(d); ecs.push(rsEncode(d, e[1])); }
  for (let b = 0; b < e[4]; b++) { const d = data.slice(off, off + e[5]); off += e[5]; blocks.push(d); ecs.push(rsEncode(d, e[1])); }
  const seq = [];
  const maxD = Math.max(e[3], e[5]);
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.length) seq.push(b[i]);
  for (let i = 0; i < e[1]; i++) for (const b of ecs) seq.push(b[i]);

  // ---- matrix
  const N = ver * 4 + 17;
  const m = new Uint8Array(N * N);        // module value
  const fixed = new Uint8Array(N * N);    // function pattern (not maskable)
  const set = (x, y, v) => { m[y * N + x] = v ? 1 : 0; fixed[y * N + x] = 1; };
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d <= 1 || d === 3);
    }
  };
  finder(3, 3); finder(N - 4, 3); finder(3, N - 4);
  for (let i = 8; i < N - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
  const al = ALIGN[ver] || [];
  for (const ay of al) for (const ax of al) {
    if (fixed[ay * N + ax]) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(ax + dx, ay + dy, d !== 1);
    }
  }
  set(8, N - 8, 1);                      // dark module
  // reserve format areas
  for (let i = 0; i < 8; i++) { fixed[8 * N + i] = 1; fixed[i * N + 8] = 1; fixed[8 * N + (N - 1 - i)] = 1; fixed[(N - 1 - i) * N + 8] = 1; }
  fixed[8 * N + 8] = 1;

  // ---- place data (zig-zag, right to left, skipping column 6)
  let bi = 0;
  const total = seq.length * 8;
  for (let col = N - 1, up = true; col > 0; col -= 2, up = !up) {
    if (col === 6) col--;
    for (let k = 0; k < N; k++) {
      const y = up ? N - 1 - k : k;
      for (const x of [col, col - 1]) {
        if (fixed[y * N + x]) continue;
        const bit = bi < total ? (seq[bi >> 3] >> (7 - (bi & 7))) & 1 : 0;
        m[y * N + x] = bit;
        bi++;
      }
    }
  }

  // ---- mask + format
  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0, (x, y) => (((y / 2) | 0) + ((x / 3) | 0)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = (mi) => {
    const out = new Uint8Array(m);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!fixed[y * N + x] && MASKS[mi](x, y)) out[y * N + x] ^= 1;
    // format info: EC level M = 00, then mask
    let f = (0b00 << 3) | mi;
    let r = f << 10;
    for (let i = 14; i >= 10; i--) if ((r >> i) & 1) r ^= 0b10100110111 << (i - 10);
    f = ((f << 10) | r) ^ 0b101010000010010;
    for (let i = 0; i < 15; i++) {
      const b = (f >> i) & 1;
      // first copy: down column 8 beside the top-left finder, then left along row 8
      if (i < 6) out[i * N + 8] = b; else if (i === 6) out[7 * N + 8] = b; else if (i === 7) out[8 * N + 8] = b;
      else if (i === 8) out[8 * N + 7] = b; else out[8 * N + (14 - i)] = b;
      // second copy: along row 8 under the top-right finder, down column 8 beside the bottom-left one
      if (i < 8) out[8 * N + (N - 1 - i)] = b; else out[(N - 15 + i) * N + 8] = b;
    }
    return out;
  };
  const penalty = (g) => {
    let p = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < N; a++) {
        let run = 0, prev = -1;
        for (let b = 0; b < N; b++) {
          const v = pass ? g[b * N + a] : g[a * N + b];
          if (v === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else { prev = v; run = 1; }
        }
      }
    }
    for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++) {
      const v = g[y * N + x];
      if (v === g[y * N + x + 1] && v === g[(y + 1) * N + x] && v === g[(y + 1) * N + x + 1]) p += 3;
    }
    let dark = 0; for (let i = 0; i < N * N; i++) dark += g[i];
    p += Math.floor(Math.abs(dark * 100 / (N * N) - 50) / 5) * 10;
    return p;
  };
  let best = null, bestP = Infinity, bestMask = 0;
  for (let mi = 0; mi < 8; mi++) {
    const g = applyMask(mi);
    const p = penalty(g);
    if (p < bestP) { bestP = p; best = g; bestMask = mi; }
  }
  return { size: N, mask: bestMask, get: (x, y) => !!best[y * N + x] };
}

/** Draw a QR code into a canvas with a quiet zone, dark modules in `fg`. */
export function drawQR(canvas, text, { px = 4, fg = '#000', bg = '#fff' } = {}) {
  const q = encodeQR(text);
  const quiet = 3;
  const dim = (q.size + quiet * 2) * px;
  canvas.width = dim; canvas.height = dim;
  const x = canvas.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, dim, dim);
  x.fillStyle = fg;
  for (let j = 0; j < q.size; j++) for (let i = 0; i < q.size; i++) if (q.get(i, j)) x.fillRect((i + quiet) * px, (j + quiet) * px, px, px);
  return q.size;
}
