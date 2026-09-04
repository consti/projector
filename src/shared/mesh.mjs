import * as M from './mat3.mjs';

export const at = (mesh, i, j) => mesh.pts[j * (mesh.cols + 1) + i];

export function corners(mesh) {
  const { cols, rows } = mesh;
  return [at(mesh, 0, 0), at(mesh, cols, 0), at(mesh, cols, rows), at(mesh, 0, rows)];
}

// Homography for one cell: unit square -> that cell's destination quad.
export function cellHomography(mesh, i, j) {
  return M.squareToQuad(at(mesh, i, j), at(mesh, i + 1, j), at(mesh, i + 1, j + 1), at(mesh, i, j + 1));
}

// Evaluate the surface at (u,v) in 0..1 surface space, consistent with rendering.
export function evalMesh(mesh, u, v) {
  const { cols, rows } = mesh;
  let i = Math.min(cols - 1, Math.max(0, Math.floor(u * cols)));
  let j = Math.min(rows - 1, Math.max(0, Math.floor(v * rows)));
  const lu = u * cols - i, lv = v * rows - j;
  return M.apply(cellHomography(mesh, i, j), lu, lv);
}

export function resample(mesh, cols, rows) {
  const pts = [];
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++)
      pts.push(evalMesh(mesh, i / cols, j / rows));
  return { cols, rows, pts };
}

// Offset a closed polygon along vertex bisectors by d (miter-clamped).
export function offsetPolygon(pts, d) {
  if (!d) return pts.map((p) => [p[0], p[1]]);
  const n = pts.length;
  if (n < 3) return pts.map((p) => [p[0], p[1]]);
  // orientation: positive shoelace = counter-clockwise in y-down space
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  const sign = area > 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    const n1 = normal(a, p, sign), n2 = normal(p, b, sign);
    let bx = n1[0] + n2[0], by = n1[1] + n2[1];
    const len = Math.hypot(bx, by);
    if (len < 1e-9) { out.push([p[0], p[1]]); continue; }
    bx /= len; by /= len;
    const cosHalf = Math.max(0.25, bx * n2[0] + by * n2[1]); // miter clamp at 4x
    out.push([p[0] + (bx * d) / cosHalf, p[1] + (by * d) / cosHalf]);
  }
  return out;
}

function normal(a, b, sign) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [(sign * dy) / l, (-sign * dx) / l];
}
