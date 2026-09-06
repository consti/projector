// Real depth for the parallax camera: Depth Anything V2 (small) running in
// this window through transformers.js on WebGPU (WASM if that fails). A second
// copy of the video runs a little ahead of the playhead; frames are read at a
// few per second, the depth map (relative disparity: near is high) comes back
// as a small greyscale image, and it is handed to every parallax layer through
// the ordinary action relay when the film reaches that frame — so the projector
// and TV windows get it too, without running a model each.
//
// The model (~50 MB) is fetched from the Hugging Face hub on first use and kept
// in the browser cache; the ONNX runtime's wasm comes from node_modules through
// the app's own protocol.

const MODEL = 'onnx-community/depth-anything-v2-small';
const LEAD = 0.6;          // seconds ahead of the playhead frames are read
const OUT_W = 160;         // the depth map handed to the layers (16:9)

export class DepthSource {
  constructor(hooks) {
    this.h = hooks;             // { state(), project(), fxAction(id, name, arg), toast(), note(text) }
    this.status = 'idle';       // idle | loading | ready | error
    this.device = null;
    this.error = null;
    this.pipe = null;
    this.busy = false;
    this.look = null; this.lookKey = null;
    this.pending = [];          // [{ at, payload }]
    this.lastGrab = 0;
    this.fps = 0; this._n = 0; this._t = 0;
    this.every = 200;           // ms between frames read
  }

  /** The parallax layers that want a model depth map. */
  layers(P) {
    return ((P.fx && P.fx.layers) || []).filter((L) => L.type === 'parallax' && L.enabled !== false && (!L.params || L.params.depth !== 'guess'));
  }

  async load() {
    if (this.pipe || this.status === 'loading') return;
    this.status = 'loading'; this.error = null;
    this.h.note && this.h.note('Loading the depth model…');
    try {
      const tf = await import('/node_modules/@huggingface/transformers/dist/transformers.min.js');
      tf.env.allowLocalModels = false;
      tf.env.backends.onnx.wasm.wasmPaths = 'app://ui/node_modules/onnxruntime-web/dist/';
      const make = async (device, dtype) => tf.pipeline('depth-estimation', MODEL, {
        device, dtype,
        progress_callback: (p) => { if (p.status === 'progress' && p.file && /onnx/.test(p.file)) this.progress = Math.round(p.progress || 0); },
      });
      try { this.pipe = await make('webgpu', 'fp16'); this.device = 'webgpu'; }
      catch (e) { console.warn('[depth] webgpu failed, using wasm', e); this.pipe = await make('wasm', 'q8'); this.device = 'wasm'; }
      this.RawImage = tf.RawImage;
      this.status = 'ready';
      this.h.note && this.h.note(`Depth model ready on ${this.device}`);
    } catch (e) {
      this.status = 'error'; this.error = e.message || String(e);
      this.h.note && this.h.note('Depth model failed: ' + this.error);
      this.h.toast && this.h.toast('Depth model failed: ' + this.error, 6000);
    }
  }

  ensureLook(S) {
    const src = S.transport && S.transport.source;
    const url = src ? (src.previewUrl || src.url) : null;
    if (!url) { this.stopLook(); return null; }
    if (this.lookKey === url && this.look) return this.look;
    this.stopLook();
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.playsInline = true;
    v.style.display = 'none';
    v.src = url;
    document.body.appendChild(v);
    this.look = v; this.lookKey = url;
    return v;
  }
  stopLook() {
    if (this.look) { try { this.look.pause(); this.look.removeAttribute('src'); this.look.load(); } catch {} this.look.remove(); }
    this.look = null; this.lookKey = null;
  }

  /** Read a frame at transport time `at` into a small canvas. */
  grab(S, at, w = 392) {
    const v = this.ensureLook(S);
    if (!v || v.readyState < 1) return Promise.resolve(null);
    return new Promise((res) => {
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        v.removeEventListener('seeked', finish);
        if (!v.videoWidth) return res(null);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = Math.round(w * v.videoHeight / v.videoWidth);
        try { cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height); res(cv); } catch { res(null); }
      };
      v.addEventListener('seeked', finish);
      try { v.currentTime = Math.max(0, at); } catch { finish(); }
      setTimeout(finish, 1500);
    });
  }

  /** Once per frame from the control window's loop. */
  frame() {
    const S = this.h.state();
    const P = this.h.project();
    if (!S) return;
    const want = this.layers(P);
    if (!want.length || !(P.fx && P.fx.enabled)) { this.stopLook(); this.pending.length = 0; return; }
    if (!this.pipe) { if (this.status === 'idle') this.load(); return; }
    const t = S.transport || {};
    if (!t.source) return;
    const pos = t.playing ? t.position + (Date.now() - t.anchorTime) / 1000 * (t.rate || 1) : t.position;
    // deliver what is due
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (pos >= p.at - 0.05) {
        this.pending.splice(i, 1);
        if (pos - p.at > 2) continue;
        for (const L of want) this.h.fxAction(L.id, 'depth', p.payload);
      }
    }
    const now = performance.now();
    if (this.busy || now - this.lastGrab < this.every) return;
    this.lastGrab = now;
    this.run(S, t.playing ? pos + LEAD : pos);
  }

  async run(S, at) {
    this.busy = true;
    try {
      const cv = await this.grab(S, at);
      if (!cv) return;
      const t0 = performance.now();
      const img = await this.RawImage.fromCanvas(cv);
      const out = await this.pipe(img);
      const d = out.depth;                 // RawImage, 1 channel, 0..255, near = bright
      const w = OUT_W, h = Math.round(OUT_W * d.height / d.width);
      const small = await d.resize(w, h);
      const src = small.data;              // Uint8ClampedArray, channels = 1
      const ch = small.channels || 1;
      const bytes = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) bytes[i] = src[i * ch];
      const payload = { w, h, data: btoa(String.fromCharCode(...bytes)) };
      this.pending.push({ at, payload });
      const ms = performance.now() - t0;
      this._n++; this._t += ms;
      if (this._n >= 10) { this.fps = Math.round(10000 / this._t); this._n = 0; this._t = 0; }
      // pace the reads to what the model manages, with a little headroom
      this.every = Math.max(120, Math.min(600, ms * 1.3));
    } catch (e) {
      console.warn('[depth]', e);
      this.error = e.message || String(e);
    } finally { this.busy = false; }
  }
}
