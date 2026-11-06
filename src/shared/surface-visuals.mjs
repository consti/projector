// A surface can run its own generated scene instead of a region of the film
// (surface.content.kind === 'visuals'). Each such surface gets a Visuals
// instance of its own, so two surfaces can show two different scenes to the
// same music; instances that stop being drawn are dropped after a moment.
import { Visuals } from './visuals.mjs';

const KEEP_MS = 5000;

export class SurfaceVisuals {
  constructor(gl) {
    this.gl = gl;
    this.inst = new Map();     // surface id -> { vis, at }
    this.opts = null;
  }

  /** Once per frame, before the engine renders: the clock, the music, the settings. */
  frame(opts) {
    this.opts = opts;
    const now = performance.now();
    for (const [id, v] of this.inst) {
      if (now - v.at > KEEP_MS) { v.vis.dispose(); this.inst.delete(id); }
    }
  }

  /** Called by the engine for every visuals surface it draws. Returns { tex, w, h }. */
  render(surface, W, H) {
    let v = this.inst.get(surface.id);
    if (!v) {
      try { v = { vis: new Visuals(this.gl), at: 0 }; } catch (e) { console.error('[surface visuals]', e); return null; }
      this.inst.set(surface.id, v);
    }
    v.at = performance.now();
    const w = Math.min(W, 1280), h = Math.round((w * 9) / 16);
    const o = this.opts || {};
    const c = surface.content || {};
    const cfg = { ...(o.cfg || {}), scene: c.scene || 'auto' };
    const r = v.vis.render({ w, h, time: o.time, audio: o.audio, cfg, key: (o.key || '') + '|' + surface.id, playing: o.playing });
    return v.vis.error ? null : r;
  }

  dispose() {
    for (const v of this.inst.values()) v.vis.dispose();
    this.inst.clear();
  }
}
