// Auditioning an effect: hover a card in the catalogue and the effect runs
// live, small, over the picture that is playing right now — to the music that
// is playing, with the shapes you have masked as its world — without touching
// the stack on the wall.
//
// One offscreen WebGL2 canvas holds a second, low-quality FxSystem. The
// current frame is drawn into a 16:9 canvas (letterboxed like the TV), fed in
// as the picture, and the result is copied into a canvas laid over the card's
// thumbnail. Leaving the card tears the layers down; the system itself stays
// warm for a while so the next hover starts instantly.

import { FxSystem } from '/shared/fx/system.mjs';
import { bindTex } from '/shared/fx/glu.mjs';

const IDLE_MS = 20000;

export class FxAudition {
  /**
   * hooks: project() → the live project; source() → the element holding the
   * current picture (video or canvas) or null; crop() → active-picture crop in
   * video uv or null; audio() → live analysis; characters() → pixel people.
   */
  constructor(hooks, w = 384, h = 216) {
    this.h = hooks;
    this.W = w; this.H = h;
    this.gl = null; this.glc = null;
    this.sys = null;
    this.srcTex = null;
    this.pic = null;                // 2D canvas the picture is letterboxed into
    this.active = null;
    this.idleAt = 0;
    this.unavailable = false;       // no WebGL2 here: callers fall back to the recorded clips
    this.lastStamp = null;
  }

  _ensure() {
    if (this.unavailable) return false;
    if (!this.gl) {
      this.glc = document.createElement('canvas');
      this.glc.width = this.W; this.glc.height = this.H;
      this.gl = this.glc.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
      if (!this.gl) { this.unavailable = true; return false; }
      this.pic = document.createElement('canvas');
      this.pic.width = this.W; this.pic.height = this.H;
    }
    if (!this.sys) {
      try { this.sys = new FxSystem(this.gl, { role: 'control' }); }
      catch (e) { console.error('[audition]', e); this.unavailable = true; return false; }
    }
    return true;
  }

  /**
   * Start auditioning in `thumb`. `build(fx)` fills `fx.layers` (and may set
   * `fx.audio`) on a copy of the live config; `onFail()` is called if the
   * effect cannot be shown live, so the caller can show its recorded clip.
   * Returns false when live previews are not available at all.
   */
  start(thumb, build, onFail) {
    this.stop();
    if (!this._ensure()) return false;
    const cv = document.createElement('canvas');
    cv.width = this.W; cv.height = this.H;
    cv.className = 'fxClip live';
    thumb.appendChild(cv);
    this.active = { thumb, cv, build, onFail, layers: null, audio: null, frames: 0, pointer: null };
    this.lastStamp = null;
    const onMove = (e) => {
      const r = thumb.getBoundingClientRect();
      if (!r.width) return;
      const a = this.active; if (!a || a.thumb !== thumb) return;
      a.pointer = { x: (e.clientX - r.left) / r.width, y: ((e.clientY - r.top) / r.height) * (this.H / this.W) };
    };
    thumb.addEventListener('pointermove', onMove);
    this.active.off = () => thumb.removeEventListener('pointermove', onMove);
    return true;
  }

  stop() {
    const a = this.active;
    if (!a) return;
    a.off && a.off();
    a.cv.remove();
    this.active = null;
    this.idleAt = performance.now();
    // tear the layer instances down now; the system waits for the next hover
    if (this.sys) {
      try {
        const fx = this.h.project().fx;
        this.sys.sync(this.h.project(), { ...fx, layers: [] }, { wall: 'projector' });
      } catch {}
    }
  }

  /** The thumbnail currently being auditioned, if any. */
  get thumb() { return this.active ? this.active.thumb : null; }

  _fail(why) {
    const a = this.active;
    if (!a) return;
    if (why) console.warn('[audition]', why);
    this.stop();
    a.onFail && a.onFail();
  }

  _uploadPicture() {
    const gl = this.gl;
    if (!this.srcTex) {
      this.srcTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(16));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    const src = this.h.source();
    const sw = src ? (src.videoWidth || src.width || 0) : 0;
    const sh = src ? (src.videoHeight || src.height || 0) : 0;
    // a video re-uploads only when it has decoded a new frame; a canvas every frame
    const stamp = !src || !sw ? 'none' : src.currentTime != null ? src.currentTime : performance.now();
    if (stamp === this.lastStamp) return;
    this.lastStamp = stamp;
    const x = this.pic.getContext('2d');
    x.fillStyle = '#000';
    x.fillRect(0, 0, this.W, this.H);
    if (sw && sh) {
      const c = (this.h.crop && this.h.crop()) || null;
      const cx = c ? c.x * sw : 0, cy = c ? c.y * sh : 0, cw = c ? c.w * sw : sw, ch = c ? c.h * sh : sh;
      const sa = cw / ch, da = this.W / this.H;
      let dw = this.W, dh = this.H;
      if (sa > da) dh = this.W / sa; else dw = this.H * sa;
      try { x.drawImage(src, cx, cy, cw, ch, (this.W - dw) / 2, (this.H - dh) / 2, dw, dh); } catch {}
    }
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);     // the chain keeps the top of the picture at v = 1
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.pic); } catch {}
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  /** Once per frame, after the main stage has rendered. */
  frame() {
    const a = this.active;
    if (!a) {
      if (this.sys && this.idleAt && performance.now() - this.idleAt > IDLE_MS) {
        this.sys.dispose(); this.sys = null; this.idleAt = 0;
      }
      return;
    }
    const gl = this.gl, sys = this.sys;
    const P = this.h.project();
    const fx = P.fx;
    // the live world (gravity, wind, walls, look) with the auditioned layers in it
    const copy = { ...fx, enabled: true, preview: true, quality: 'low', layers: [] };
    if (!a.layers) {
      copy.audio = { ...(fx.audio || {}), enabled: true, globals: { ...((fx.audio && fx.audio.globals) || {}) } };
      try { a.build(copy); } catch (e) { this._fail(e.message); return; }
      a.layers = copy.layers; a.audio = copy.audio;
    }
    copy.layers = a.layers; copy.audio = a.audio;
    try {
      this._uploadPicture();
      sys.sync(P, copy, { wall: 'projector' });
      sys.characters = this.h.characters ? this.h.characters() : [];
      const p = a.pointer;
      sys.setInteractors(p ? [{ x: p.x, y: p.y, vx: 0, vy: 0, r: fx.interact?.radius || 0.07, strength: 1, down: false }] : []);
      sys.setAudio(this.h.audio());
      sys.update(Date.now() / 1000);
      if (sys.error) { this._fail(sys.error); return; }
      const tex = sys.render(this.srcTex, this.W, this.H, [0, 0, 0]);
      if (sys.error) { this._fail(sys.error); return; }
      // the chain is 16-bit float; a blit into the 8-bit canvas is not allowed, so copy with a pass
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.W, this.H);
      gl.disable(gl.BLEND);
      const cp = sys.screen.copyProg;
      cp.use();
      bindTex(gl, 0, tex, cp.u.uTex);
      gl.uniform1f(cp.u.uScale, 1);
      sys.screen.draw();
      a.cv.getContext('2d').drawImage(this.glc, 0, 0);
      // a few frames in, the simulation has something to show
      if (++a.frames === 3) a.cv.classList.add('on');
    } catch (e) {
      this._fail(e.message);
    }
  }
}
