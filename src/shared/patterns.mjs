// Procedural calibration sources, generated once into a canvas and used in
// place of the video so the mapping can be aligned against the real wall.
export const PATTERNS = ['off', 'grid', 'bars', 'corners', 'circles', 'checker', 'greyramp'];

export function makePattern(kind, w = 1920, h = 1080) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, w, h);

  if (kind === 'grid') {
    const step = Math.round(w / 24);
    x.strokeStyle = '#2f6fff'; x.lineWidth = 1.5;
    x.beginPath();
    for (let i = 0; i <= w; i += step) { x.moveTo(i + 0.5, 0); x.lineTo(i + 0.5, h); }
    for (let j = 0; j <= h; j += step) { x.moveTo(0, j + 0.5); x.lineTo(w, j + 0.5); }
    x.stroke();
    x.strokeStyle = '#ffffff'; x.lineWidth = 3;
    x.beginPath();
    for (let i = 0; i <= w; i += step * 4) { x.moveTo(i, 0); x.lineTo(i, h); }
    for (let j = 0; j <= h; j += step * 4) { x.moveTo(0, j); x.lineTo(w, j); }
    x.stroke();
    x.strokeStyle = '#ff3b30'; x.lineWidth = 6;
    x.strokeRect(3, 3, w - 6, h - 6);
    x.strokeStyle = '#34c759'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(0, 0); x.lineTo(w, h); x.moveTo(w, 0); x.lineTo(0, h); x.stroke();
    label(x, w, h);
  } else if (kind === 'bars') {
    const cols = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff', '#000000'];
    cols.forEach((col, i) => { x.fillStyle = col; x.fillRect((i * w) / cols.length, 0, w / cols.length + 1, h * 0.75); });
    for (let i = 0; i < 16; i++) {
      const v = Math.round((i / 15) * 255);
      x.fillStyle = `rgb(${v},${v},${v})`;
      x.fillRect((i * w) / 16, h * 0.75, w / 16 + 1, h * 0.25);
    }
  } else if (kind === 'corners') {
    const s = Math.round(Math.min(w, h) * 0.16);
    const pts = [[0, 0], [w - s, 0], [w - s, h - s], [0, h - s]];
    const cols = ['#ff3b30', '#34c759', '#0a84ff', '#ffd60a'];
    pts.forEach((p, i) => {
      x.fillStyle = cols[i]; x.fillRect(p[0], p[1], s, s);
      x.fillStyle = '#000'; x.font = `bold ${Math.round(s * 0.5)}px -apple-system, sans-serif`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(String(i + 1), p[0] + s / 2, p[1] + s / 2);
    });
    x.strokeStyle = '#fff'; x.lineWidth = 4;
    x.beginPath();
    x.moveTo(w / 2, h / 2 - s / 2); x.lineTo(w / 2, h / 2 + s / 2);
    x.moveTo(w / 2 - s / 2, h / 2); x.lineTo(w / 2 + s / 2, h / 2);
    x.stroke();
    x.strokeRect(2, 2, w - 4, h - 4);
    label(x, w, h);
  } else if (kind === 'circles') {
    x.strokeStyle = '#fff'; x.lineWidth = 3;
    const r0 = Math.min(w, h) / 2;
    for (let i = 1; i <= 10; i++) {
      x.beginPath(); x.arc(w / 2, h / 2, (r0 * i) / 10, 0, Math.PI * 2); x.stroke();
    }
    x.strokeStyle = '#0a84ff';
    x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.moveTo(w / 2, 0); x.lineTo(w / 2, h); x.stroke();
  } else if (kind === 'checker') {
    const n = 16, sw = w / n, sh = h / (n * (h / w) * (w / h) * 9 / 16 * (16 / 9)) || h / 9;
    const rows = 9;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < n; i++) {
        x.fillStyle = (i + j) % 2 ? '#ffffff' : '#101010';
        x.fillRect(i * sw, (j * h) / rows, sw + 1, h / rows + 1);
      }
    }
  } else if (kind === 'greyramp') {
    const g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#000'); g.addColorStop(1, '#fff');
    x.fillStyle = g; x.fillRect(0, 0, w, h * 0.5);
    for (let i = 0; i < 11; i++) {
      const v = Math.round((i / 10) * 255);
      x.fillStyle = `rgb(${v},${v},${v})`;
      x.fillRect((i * w) / 11, h * 0.5, w / 11 + 1, h * 0.5);
    }
  }
  return c;
}

function label(x, w, h) {
  x.fillStyle = '#fff';
  x.font = `bold ${Math.round(h * 0.06)}px -apple-system, sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(`${w} x ${h}`, w / 2, h * 0.34);
  x.font = `${Math.round(h * 0.035)}px -apple-system, sans-serif`;
  x.fillText('TOP', w / 2, h * 0.08);
  x.fillText('BOTTOM', w / 2, h * 0.92);
}
