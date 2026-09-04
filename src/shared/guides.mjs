import * as Mesh from './mesh.mjs';

// Draws mapping guides in output space onto a 2D canvas (used as an overlay on
// the projector itself, so you can align to the wall without the control screen).
export function drawGuides(ctx, W, H, project, opts = {}) {
  ctx.clearRect(0, 0, W, H);
  const X = (p) => p[0] * W, Y = (p) => p[1] * H;
  ctx.lineJoin = 'round';

  (project.surfaces || []).forEach((s, si) => {
    if (!s.enabled && !opts.showDisabled) return;
    const m = s.mesh;
    ctx.strokeStyle = 'rgba(0,180,255,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let j = 1; j < m.rows; j++) {
      for (let i = 0; i <= m.cols; i++) {
        const p = Mesh.at(m, i, j);
        i === 0 ? ctx.moveTo(X(p), Y(p)) : ctx.lineTo(X(p), Y(p));
      }
    }
    for (let i = 1; i < m.cols; i++) {
      for (let j = 0; j <= m.rows; j++) {
        const p = Mesh.at(m, i, j);
        j === 0 ? ctx.moveTo(X(p), Y(p)) : ctx.lineTo(X(p), Y(p));
      }
    }
    ctx.stroke();

    const c = Mesh.corners(m);
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X(c[0]), Y(c[0]));
    for (let i = 1; i < 4; i++) ctx.lineTo(X(c[i]), Y(c[i]));
    ctx.closePath();
    ctx.stroke();

    const cen = Mesh.evalMesh(m, 0.5, 0.5);
    ctx.fillStyle = '#00d4ff';
    ctx.font = 'bold 22px -apple-system, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((si + 1) + '  ' + (s.name || ''), cen[0] * W, cen[1] * H);
  });

  (project.masks || []).forEach((mk) => {
    if (!mk.enabled && !opts.showDisabled) return;
    ctx.strokeStyle = mk.invert ? '#ffd60a' : '#ff375f';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    mk.points.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  });
}
