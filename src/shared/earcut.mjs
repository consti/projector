// Minimal ear-clipping triangulator for simple polygons (no holes).
// pts: array of [x,y]. Returns flat array of triangle indices.
export function triangulate(pts) {
  const n = pts.length;
  if (n < 3) return [];
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  if (signedArea(pts) < 0) idx.reverse();

  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n + 32) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      if (isEar(pts, idx, a, b, c)) {
        tris.push(a, b, c);
        idx.splice(i, 1);
        clipped = true;
        break;
      }
    }
    if (!clipped) break; // degenerate: bail with a fan for the remainder
  }
  if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
  else if (idx.length > 3) for (let i = 1; i < idx.length - 1; i++) tris.push(idx[0], idx[i], idx[i + 1]);
  return tris;
}

function signedArea(p) {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    s += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1]);
  }
  return s / 2;
}

function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function isEar(pts, idx, ai, bi, ci) {
  const a = pts[ai], b = pts[bi], c = pts[ci];
  if (cross(a, b, c) >= -1e-12) return false; // needs to be convex for CW ordering
  for (const k of idx) {
    if (k === ai || k === bi || k === ci) continue;
    if (pointInTri(pts[k], a, b, c)) return false;
  }
  return true;
}

function pointInTri(p, a, b, c) {
  const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
  const neg = d1 <= 0 && d2 <= 0 && d3 <= 0;
  const pos = d1 >= 0 && d2 >= 0 && d3 >= 0;
  return neg || pos;
}
