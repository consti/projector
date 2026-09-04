// The effects stack. Owns the shared world (occluder field, clock, interaction
// points), steps every layer on a fixed timestep so the control preview and the
// projector output stay in lockstep, and composites the layers into the picture
// before the blackout masks are applied.
//
// The chain runs in RGBA16F, so an ember or a specular glint can be brighter
// than white and pick up bloom on the way out.

import { Screen, Target, prog, bindTex, VS_SCREEN, BLEND } from './glu.mjs';
import { Field, collectOccluders, occluderKey } from './field.mjs';
import { Rng, hashStr } from './rng.mjs';
import { EFFECTS } from './effects/index.mjs';
import { EMPTY as AUDIO_EMPTY, modulate } from './audio.mjs';

export const REGISTRY = new Map(EFFECTS.map((e) => [e.type, e]));

export const QUALITY = {
  low:    { sim: 0.55, grid: 192, sdf: 320, particles: 0.4,  pressure: 14, chain: 1280 },
  medium: { sim: 0.75, grid: 256, sdf: 384, particles: 0.7,  pressure: 20, chain: 1600 },
  high:   { sim: 1.0,  grid: 384, sdf: 512, particles: 1.0,  pressure: 26, chain: 1920 },
  ultra:  { sim: 1.0,  grid: 560, sdf: 640, particles: 1.6,  pressure: 40, chain: 2560 },
};

const FS_RESOLVE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uComp;    // premultiplied surfaces
uniform vec3 uBg;
out vec4 o;
void main(){
  vec4 c = texture(uComp, vUV);
  o = vec4(c.rgb + uBg * (1.0 - c.a), 1.0);
}`;

const FS_BRIGHT = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uTex; uniform float uThresh; uniform float uKnee; out vec4 o;
void main(){
  vec3 c = texture(uTex, vUV).rgb;
  float l = max(max(c.r, c.g), c.b);
  float s = clamp((l - uThresh) / max(1e-4, uKnee), 0.0, 1.0);
  o = vec4(c * s * s, 1.0);
}`;

const FS_BLUR = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uTex; uniform vec2 uDir; out vec4 o;
void main(){
  vec3 s = texture(uTex, vUV).rgb * 0.227027;
  s += (texture(uTex, vUV + uDir * 1.3846).rgb + texture(uTex, vUV - uDir * 1.3846).rgb) * 0.316216;
  s += (texture(uTex, vUV + uDir * 3.2308).rgb + texture(uTex, vUV - uDir * 3.2308).rgb) * 0.070270;
  o = vec4(s, 1.0);
}`;

const FS_OUT = `#version 300 es
precision highp float;
#include <common>
#include <tonemap>
in vec2 vUV;
uniform sampler2D uTex;
uniform sampler2D uBloom;
uniform float uBloomAmt;
uniform float uExposure;
uniform float uTonemap;
out vec4 o;
void main(){
  vec3 c = texture(uTex, vUV).rgb * uExposure;
  c += texture(uBloom, vUV).rgb * uBloomAmt;
  vec3 t = acesFilm(c);
  o = vec4(mix(min(c, vec3(1.0)), t, uTonemap), 1.0);
}`;

export class FxSystem {
  constructor(gl, opts = {}) {
    this.gl = gl;
    this.role = opts.role || 'output';
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    gl.getExtension('EXT_float_blend');
    this.screen = new Screen(gl);
    this.pResolve = prog(gl, VS_SCREEN, FS_RESOLVE);
    this.pBright = prog(gl, VS_SCREEN, FS_BRIGHT);
    this.pBlur = prog(gl, VS_SCREEN, FS_BLUR);
    this.pOut = prog(gl, VS_SCREEN, FS_OUT);

    this.field = new Field(gl, 512);
    this.fieldKey = null;
    this.layers = [];               // live effect instances
    this.configKey = '';
    this.aspect = 9 / 16;
    this.quality = 'high';
    this.qual = QUALITY.high;
    this.time = 0;
    this.acc = 0;
    this.lastClock = null;
    this.interactors = [];
    this.stats = { steps: 0, ms: 0, bodies: 0, particles: 0 };
    this.chainW = 0; this.chainH = 0;
    this.error = null;
    this.pendingActions = [];
    this.audio = AUDIO_EMPTY;
    this.beatCount = 0;
  }

  // -------------------------------------------------------------- config
  /** Reconcile the live effect instances with `project.fx`. */
  sync(project, fx) {
    this.fx = fx;
    this.error = null;      // stale failures must not outlive the layer that caused them
    const refW = project.global?.refW || 1920;
    const refH = project.global?.refH || 1080;
    this.aspect = refH / refW;

    if (this.quality !== (fx.quality || 'high')) {
      this.quality = fx.quality || 'high';
      this.qual = QUALITY[this.quality] || QUALITY.high;
      for (const l of this.layers) l.dirtyRes = true;
    }

    // occluder field
    const key = occluderKey(project, fx);
    if (key !== this.fieldKey) {
      this.fieldKey = key;
      const { polys } = collectOccluders(project, fx);
      const w = fx.walls || {};
      this.field.res = this.qual.sdf;
      this.field.build(polys, this.aspect, {
        l: w.l !== false, r: w.r !== false, t: !!w.t, b: w.b !== false,
      });
      for (const l of this.layers) if (l.inst.onWorldChanged) l.inst.onWorldChanged(this.world());
    }

    // layer reconciliation by id
    const want = (fx.layers || []).filter((l) => REGISTRY.has(l.type));
    const byId = new Map(this.layers.map((l) => [l.id, l]));
    const next = [];
    for (const def of want) {
      let live = byId.get(def.id);
      if (live && live.type !== def.type) { live.inst.dispose?.(); live = null; }
      if (!live) {
        const spec = REGISTRY.get(def.type);
        try {
          const inst = spec.create(this._ctx(def));
          live = { id: def.id, type: def.type, inst, spec, def, dirtyRes: true };
        } catch (e) {
          this.error = def.type + ': ' + e.message;
          console.error('[fx] failed to create', def.type, e);
          continue;
        }
      }
      live.def = def;
      live.base = withDefaults(live.spec, def.params);
      live.params = live.base;
      byId.delete(def.id);
      next.push(live);
    }
    for (const dead of byId.values()) dead.inst.dispose?.();
    this.layers = next;
  }

  _ctx(def) {
    return {
      gl: this.gl,
      screen: this.screen,
      aspect: this.aspect,
      field: this.field,
      quality: this.qual,
      rng: new Rng(hashStr(def.id) ^ 0x9e3779b9),
      id: def.id,
    };
  }

  world(dt = 0) {
    const fx = this.fx || {};
    return {
      dt,
      time: this.time,
      field: this.field,
      sdfTex: this.field.tex,
      sdfTexel: this.field.texel,
      aspect: this.aspect,
      gx: (fx.windX || 0) * 1.0,
      gy: (fx.gravity == null ? 1.2 : fx.gravity) * this._audioGain('gravity'),
      wind: [(fx.windX || 0) * this._audioGain('wind'), fx.windY || 0],
      interactors: this.interactors,
      audio: this.audio,
      quality: this.qual,
      size: [this.chainW, this.chainH],
      screen: this.screen,
    };
  }

  setInteractors(list) { this.interactors = list || []; }

  /** Latest audio analysis, from this window or relayed from the audio owner. */
  setAudio(f) { this.audio = f || AUDIO_EMPTY; }

  /** Queue a one-shot action ("burst", "strike", "fill") for one layer. */
  action(layerId, name, arg) { this.pendingActions.push([layerId, name, arg]); }

  // ---------------------------------------------------------------- update
  /**
   * Advance the simulation. `clock` is the shared transport-derived time in
   * seconds; using it rather than the local frame time is what keeps the
   * preview and the projector showing the same splash.
   */
  /** 1 + amount * source, for the handful of world values audio can drive. */
  _audioGain(key) {
    const a = this.fx && this.fx.audio;
    if (!a || !a.enabled || !a.globals) return 1;
    const amt = a.globals[key] || 0;
    if (!amt) return 1;
    const v = this.audio[a.globalSrc || 'level'] || 0;
    return Math.max(0, 1 + amt * v);
  }

  update(clock) {
    if (!this.layers.length) return;
    const t0 = performance.now();
    const STEP = 1 / 60;
    if (this.lastClock == null) this.lastClock = clock;
    let delta = clock - this.lastClock;
    this.lastClock = clock;
    if (!isFinite(delta) || delta < 0 || delta > 0.5) delta = STEP;   // seek / stall
    this.acc = Math.min(this.acc + delta * (this.fx?.timeScale || 1) * this._audioGain('timeScale'), STEP * 4);

    // audio -> parameters, and audio -> one-shot actions
    const aud = this.fx?.audio;
    const listening = !!(aud && aud.enabled && this.audio.live);
    for (const l of this.layers) {
      l.params = listening ? modulate(l.spec, l.base, l.def.mod, this.audio) : l.base;
    }
    if (listening && this.audio.onset) {
      this.beatCount++;
      for (const l of this.layers) {
        const t = l.def.trig;
        if (!t || !t.action || l.def.enabled === false) continue;
        const every = Math.max(1, Math.round(t.every || 1));
        if (this.beatCount % every) continue;
        try { l.inst.action?.(t.action, t.arg, this.world(STEP), l.params); } catch (e) { console.error('[fx beat]', e); }
      }
    }

    // drain actions before stepping so a burst lands on this frame
    if (this.pendingActions.length) {
      for (const [id, name, arg] of this.pendingActions) {
        for (const l of this.layers) {
          if (id && l.id !== id) continue;
          try { l.inst.action?.(name, arg, this.world(STEP), l.params); } catch (e) { console.error('[fx action]', e); }
        }
      }
      this.pendingActions.length = 0;
    }

    let steps = 0;
    while (this.acc >= STEP && steps < 4) {
      this.acc -= STEP;
      this.time += STEP;
      const w = this.world(STEP);
      for (const l of this.layers) {
        if (l.def.enabled === false) continue;
        try { l.inst.step(STEP, w, l.params); } catch (e) { this.error = l.type + ': ' + e.message; console.error('[fx step]', l.type, e); }
      }
      steps++;
    }
    this.stats.steps = steps;
    this.stats.ms = performance.now() - t0;
  }

  // ---------------------------------------------------------------- render
  _targets(W, H) {
    if (this.chainW === W && this.chainH === H) return;
    for (const k of ['tA', 'tB', 'bloomA', 'bloomB']) if (this[k]) this[k].dispose();
    this.chainW = W; this.chainH = H;
    this.tA = new Target(this.gl, W, H, 'rgba16f');
    this.tB = new Target(this.gl, W, H, 'rgba16f');
    const bw = Math.max(8, W >> 2), bh = Math.max(8, H >> 2);
    this.bloomA = new Target(this.gl, bw, bh, 'rgba16f');
    this.bloomB = new Target(this.gl, bw, bh, 'rgba16f');
    for (const l of this.layers) l.dirtyRes = true;
  }

  active() { return this.layers.some((l) => l.def.enabled !== false); }

  /**
   * Composite the effect stack over the mapped picture.
   * `compTex` is the premultiplied surface composite; returns a texture with
   * the effects applied, still in output space.
   */
  render(compTex, W, H, bgColor) {
    const gl = this.gl;
    const cap = this.qual.chain;
    const scale = Math.min(1, cap / Math.max(W, 1));
    const cw = Math.max(16, Math.round(W * scale)), ch = Math.max(16, Math.round(H * scale));
    this._targets(cw, ch);

    // resolve premultiplied surfaces + background colour into an opaque image
    gl.disable(gl.BLEND);
    this.pResolve.use();
    bindTex(gl, 0, compTex, this.pResolve.u.uComp);
    gl.uniform3f(this.pResolve.u.uBg, bgColor[0], bgColor[1], bgColor[2]);
    this.tA.bind();
    this.screen.draw();

    let cur = this.tA, other = this.tB;
    const w = this.world(0);
    w.size = [cw, ch];

    for (const l of this.layers) {
      if (l.def.enabled === false) continue;
      if (l.dirtyRes) { l.dirtyRes = false; try { l.inst.resize?.(cw, ch, this.aspect, this.qual); } catch (e) { console.error(e); } }
      const mode = l.spec.blend || 'over';
      const opacity = l.def.opacity == null ? 1 : l.def.opacity;
      try {
        if (mode === 'post') {
          // A 'post' layer reads `src` and owns every pixel of `dst`; it must
          // pass the picture through where it contributes nothing.
          other.bind();
          gl.disable(gl.BLEND);
          l.inst.draw({ ...w, src: cur.tex, dst: other, opacity, params: l.params });
          const t = cur; cur = other; other = t;
        } else {
          cur.bind();
          BLEND[mode === 'add' ? 'add' : 'over'](gl);
          // reading the target it is drawing into would be undefined, so an
          // overlay layer gets no background texture; effects that need to
          // sample the picture declare blend 'post' instead.
          l.inst.draw({ ...w, src: null, dst: cur, opacity, params: l.params });
          gl.disable(gl.BLEND);
        }
      } catch (e) {
        this.error = l.type + ': ' + e.message;
        console.error('[fx draw]', l.type, e);
      }
    }

    // bloom
    const amt = (this.fx?.bloom == null ? 0.6 : this.fx.bloom) * this._audioGain('bloom');
    if (amt > 0.001) {
      gl.disable(gl.BLEND);
      this.pBright.use();
      bindTex(gl, 0, cur.tex, this.pBright.u.uTex);
      gl.uniform1f(this.pBright.u.uThresh, this.fx?.bloomThreshold == null ? 0.9 : this.fx.bloomThreshold);
      gl.uniform1f(this.pBright.u.uKnee, 0.55);
      this.bloomA.bind();
      this.screen.draw();
      this.pBlur.use();
      for (let i = 0; i < 3; i++) {
        const rad = 1 + i * 1.7;
        bindTex(gl, 0, this.bloomA.tex, this.pBlur.u.uTex);
        gl.uniform2f(this.pBlur.u.uDir, rad / this.bloomA.w, 0);
        this.bloomB.bind(); this.screen.draw();
        bindTex(gl, 0, this.bloomB.tex, this.pBlur.u.uTex);
        gl.uniform2f(this.pBlur.u.uDir, 0, rad / this.bloomA.h);
        this.bloomA.bind(); this.screen.draw();
      }
    }

    // exposure / tonemap into the final chain slot
    other.bind();
    gl.disable(gl.BLEND);
    this.pOut.use();
    bindTex(gl, 0, cur.tex, this.pOut.u.uTex);
    bindTex(gl, 1, amt > 0.001 ? this.bloomA.tex : cur.tex, this.pOut.u.uBloom);
    gl.uniform1f(this.pOut.u.uBloomAmt, amt > 0.001 ? amt : 0);
    gl.uniform1f(this.pOut.u.uExposure, (this.fx?.exposure == null ? 1 : this.fx.exposure) * this._audioGain('exposure'));
    gl.uniform1f(this.pOut.u.uTonemap, this.fx?.tonemap === false ? 0 : 1);
    this.screen.draw();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return other.tex;
  }

  dispose() {
    for (const l of this.layers) l.inst.dispose?.();
    this.layers.length = 0;
    for (const k of ['tA', 'tB', 'bloomA', 'bloomB']) if (this[k]) { this[k].dispose(); this[k] = null; }
    this.field.dispose();
    this.chainW = this.chainH = 0;
  }
}

export function withDefaults(spec, params) {
  const out = {};
  for (const p of spec.params || []) out[p.key] = params && params[p.key] != null ? params[p.key] : p.def;
  return out;
}

export function defaultParams(type) {
  const spec = REGISTRY.get(type);
  return spec ? withDefaults(spec, null) : {};
}
