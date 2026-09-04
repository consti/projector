// 3x3 matrix helpers, column-major-agnostic: we store row-major [a b c d e f g h i]
// and convert to column-major only when uploading to GL.

export function mul(m, n) {
  const o = new Float64Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = m[r * 3] * n[c] + m[r * 3 + 1] * n[3 + c] + m[r * 3 + 2] * n[6 + c];
    }
  }
  return o;
}

export function invert(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  let det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) det = 1e-12;
  const id = 1 / det;
  return new Float64Array([
    A * id, -(b * i - c * h) * id, (b * f - c * e) * id,
    B * id, (a * i - c * g) * id, -(a * f - c * d) * id,
    C * id, -(a * h - b * g) * id, (a * e - b * d) * id,
  ]);
}

export function apply(m, x, y) {
  const px = m[0] * x + m[1] * y + m[2];
  const py = m[3] * x + m[4] * y + m[5];
  const pw = m[6] * x + m[7] * y + m[8];
  return [px / pw, py / pw];
}

export const identity = () => new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

// Heckbert: maps unit square corners (0,0),(1,0),(1,1),(0,1) -> p0,p1,p2,p3
export function squareToQuad(p0, p1, p2, p3) {
  const [x0, y0] = p0, [x1, y1] = p1, [x2, y2] = p2, [x3, y3] = p3;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) {
    // affine (parallelogram)
    return new Float64Array([
      x1 - x0, x3 - x0, x0,
      y1 - y0, y3 - y0, y0,
      0, 0, 1,
    ]);
  }
  const dx1 = x1 - x2, dy1 = y1 - y2;
  const dx2 = x3 - x2, dy2 = y3 - y2;
  let den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-12) den = 1e-12;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return new Float64Array([
    x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
    y1 - y0 + g * y1, y3 - y0 + h * y3, y0,
    g, h, 1,
  ]);
}

// row-major -> column-major Float32Array for gl.uniformMatrix3fv
export function toGL(m, out) {
  const o = out || new Float32Array(9);
  o[0] = m[0]; o[1] = m[3]; o[2] = m[6];
  o[3] = m[1]; o[4] = m[4]; o[5] = m[7];
  o[6] = m[2]; o[7] = m[5]; o[8] = m[8];
  return o;
}
