import * as M from '/shared/mat3.mjs';

// The four corner-marker centres of the 'corners' calibration pattern,
// in output-normalized coordinates (marker size is 16% of the short side).
export const MARKERS = [[0.045, 0.08], [0.955, 0.08], [0.955, 0.92], [0.045, 0.92]];
const MARK_NAMES = ['red (top-left)', 'green (top-right)', 'blue (bottom-right)', 'yellow (bottom-left)'];
const LOCAL = 1000;   // element-local coordinate span for the warped layer

export class CameraPanel {
  constructor(els, hooks) {
    this.els = els;                    // { select, video, pick, warpVideo, layer, status }
    this.hooks = hooks;                // { toast, setPattern, frameSize, onChange }
    this.stream = null;
    this.homography = null;            // camera-normalized -> output-normalized
    this.aligning = null;
    this.opacity = 0.5;
    this.mirror = false;

    els.pick.addEventListener('click', (e) => this._pick(e));
    els.select.addEventListener('change', () => this.start(els.select.value));
  }

  async refreshDevices() {
    try {
      await api.mediaAccess('camera');
      // a permission-granted getUserMedia call is needed before labels appear
      if (!this.stream) {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ video: true });
          s.getTracks().forEach((t) => t.stop());
        } catch {}
      }
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      const sel = this.els.select;
      const prev = sel.value;
      sel.innerHTML = '';
      sel.appendChild(opt('', devs.length ? 'Select camera' + (devs.length ? ' (' + devs.length + ')' : '') : 'No cameras found'));
      for (const d of devs) sel.appendChild(opt(d.deviceId, d.label || 'Camera'));
      if (prev && devs.some((d) => d.deviceId === prev)) sel.value = prev;
      return devs;
    } catch (e) {
      this.els.status.textContent = 'Camera error: ' + e.message;
      return [];
    }
  }

  async start(deviceId) {
    this.stop();
    if (!deviceId) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      for (const v of [this.els.video, this.els.warpVideo]) {
        v.srcObject = this.stream;
        v.muted = true;
        v.playsInline = true;
        await v.play().catch(() => {});
      }
      this.els.status.textContent = 'Live';
      this.applyWarp();
    } catch (e) {
      this.els.status.textContent = 'Could not open camera: ' + e.message;
    }
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    for (const v of [this.els.video, this.els.warpVideo]) v.srcObject = null;
    this.els.status.textContent = 'Off';
  }

  get live() { return !!this.stream; }

  beginAlign() {
    if (!this.stream) { this.hooks.toast('Start a camera first'); return; }
    this.hooks.setPattern('corners');
    this.aligning = [];
    this.hooks.toast('Click the centre of the ' + MARK_NAMES[0] + ' marker in the camera view');
    this.els.pick.style.pointerEvents = 'auto';
    this.render();
  }

  clearAlign() {
    this.homography = null;
    this.aligning = null;
    this.applyWarp();
    this.render();
  }

  _pick(e) {
    if (!this.aligning) return;
    const r = this.els.pick.getBoundingClientRect();
    // the small preview uses object-fit:cover -> undo the crop to get true frame coords
    const v = this.els.video;
    const vw = v.videoWidth || 16, vh = v.videoHeight || 9;
    const boxA = r.width / r.height, srcA = vw / vh;
    let u = (e.clientX - r.left) / r.width, w = (e.clientY - r.top) / r.height;
    if (srcA > boxA) { const s = boxA / srcA; u = 0.5 + (u - 0.5) * s; }
    else { const s = srcA / boxA; w = 0.5 + (w - 0.5) * s; }
    this.aligning.push([u, w]);
    if (this.aligning.length < 4) {
      this.hooks.toast('Now the ' + MARK_NAMES[this.aligning.length] + ' marker');
      this.render();
      return;
    }
    const src = M.squareToQuad(this.aligning[0], this.aligning[1], this.aligning[2], this.aligning[3]);
    const dst = M.squareToQuad(MARKERS[0], MARKERS[1], MARKERS[2], MARKERS[3]);
    this.homography = M.mul(dst, M.invert(src));
    this.aligning = null;
    this.els.pick.style.pointerEvents = 'none';
    this.hooks.toast('Camera aligned. Trace over what you see in the stage.');
    this.hooks.setPattern('off');
    this.applyWarp();
    this.render();
  }

  // Warp the camera feed into projector-output space with a CSS 3D matrix.
  applyWarp() {
    const el = this.els.warpVideo;
    const [fw, fh] = this.hooks.frameSize();
    if (!this.homography || !this.stream || !fw) {
      this.els.layer.style.display = 'none';
      return;
    }
    this.els.layer.style.display = 'block';
    el.style.width = LOCAL + 'px';
    el.style.height = LOCAL + 'px';
    el.style.opacity = String(this.opacity);
    // element-local px -> camera-normalized -> output-normalized -> stage px
    const toNorm = new Float64Array([1 / LOCAL, 0, 0, 0, 1 / LOCAL, 0, 0, 0, 1]);
    const toPx = new Float64Array([fw, 0, 0, 0, fh, 0, 0, 0, 1]);
    const T = M.mul(toPx, M.mul(this.homography, toNorm));
    const [a, b, c, d, e, f, g, h, i] = T;
    el.style.transform =
      `matrix3d(${a},${d},0,${g}, ${b},${e},0,${h}, 0,0,1,0, ${c},${f},0,${i})`;
    el.style.filter = this.mirror ? 'none' : 'none';
  }

  render() {
    const c = this.els.pickCanvas;
    if (!c) return;
    const r = this.els.pick.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(r.width * dpr));
    c.height = Math.max(1, Math.round(r.height * dpr));
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, r.width, r.height);
    if (!this.aligning) return;
    const cols = ['#ff3b30', '#34c759', '#0a84ff', '#ffd60a'];
    this.aligning.forEach((p, idx) => {
      const px = p[0] * r.width, py = p[1] * r.height;
      x.strokeStyle = cols[idx]; x.lineWidth = 2;
      x.beginPath(); x.arc(px, py, 7, 0, 7); x.stroke();
      x.beginPath(); x.moveTo(px - 11, py); x.lineTo(px + 11, py);
      x.moveTo(px, py - 11); x.lineTo(px, py + 11); x.stroke();
    });
    x.fillStyle = '#fff';
    x.font = '600 11px -apple-system,sans-serif';
    x.fillText('click marker ' + (this.aligning.length + 1) + '/4', 6, 14);
  }
}

function opt(v, t) { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; }
