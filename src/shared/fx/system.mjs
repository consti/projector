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
    this.subFields = new Map();     // layers that see only some shapes get their own field
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
  /**
   * Reconcile the live effect instances with `project.fx`.
   * `opts.wall` names the wall this system draws ('projector' or 'tv'), which
   * decides which layers take part; `opts.aspect` overrides the picture aspect
   * (a TV showing plain video has its own); `opts.shapes === false` builds a
   * world with no masked shapes in it, just the frame walls.
   */
  sync(project, fx, opts = {}) {
    this.fx = fx;
    this.wall = opts.wall || 'projector';
    this.error = null;      // stale failures must not outlive the layer that caused them
    const refW = project.global?.refW || 1920;
    const refH = project.global?.refH || 1080;
    this.aspect = opts.aspect || refH / refW;
    const shapes = opts.shapes !== false;

    if (this.quality !== (fx.quality || 'high')) {
      this.quality = fx.quality || 'high';
      this.qual = QUALITY[this.quality] || QUALITY.high;
      for (const l of this.layers) l.dirtyRes = true;
    }

    // occluder field
    const key = occluderKey(project, fx) + '|' + this.wall + '|' + this.aspect.toFixed(4) + '|' + (shapes ? 1 : 0);
    if (key !== this.fieldKey) {
      this.fieldKey = key;
      const polys = shapes ? collectOccluders(project, fx).polys : [];
      const w = fx.walls || {};
      this.field.res = this.qual.sdf;
      this.field.build(polys, this.aspect, {
        l: w.l !== false, r: w.r !== false, t: !!w.t, b: w.b !== false,
      });
      for (const l of this.layers) if (l.inst.onWorldChanged) l.inst.onWorldChanged(this.world());
    }

    // per-layer worlds: a layer may be told to see only some of the shapes
    const used = new Set();
    for (const def of fx.layers || []) {
      if (!Array.isArray(def.shapes) || !REGISTRY.has(def.type) || !layerOnWall(def, this.wall)) continue;
      const k = def.shapes.slice().sort().join(',');
      used.add(k);
      let sub = this.subFields.get(k);
      if (!sub) { sub = { field: new Field(this.gl, 512), base: null }; this.subFields.set(k, sub); }
      if (sub.base !== key) {
        sub.base = key;
        const polys = shapes ? collectOccluders(project, fx, new Set(def.shapes)).polys : [];
        const w = fx.walls || {};
        sub.field.res = this.qual.sdf;
        sub.field.build(polys, this.aspect, { l: w.l !== false, r: w.r !== false, t: !!w.t, b: w.b !== false });
        for (const l of this.layers) if (l.id === def.id && l.inst.onWorldChanged) l.inst.onWorldChanged(this._layerWorld(l, this.world()));
      }
    }
    for (const [k, sub] of this.subFields) if (!used.has(k)) { sub.field.dispose(); this.subFields.delete(k); }

    // layer reconciliation by id
    const wall = this.wall;
    const want = (fx.layers || []).filter((l) => REGISTRY.has(l.type) && layerOnWall(l, wall));
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
      live.field = Array.isArray(def.shapes) ? this.subFields.get(def.shapes.slice().sort().join(','))?.field || this.field : this.field;
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

  /** The world as one layer sees it: the shared field, or its own subset of shapes. */
  _layerWorld(l, w) {
    const f = l.field || this.field;
    if (f === this.field) return w;
    return { ...w, field: f, sdfTex: f.tex, sdfTexel: f.texel };
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
      let p = listening ? modulate(l.spec, l.base, l.def.mod, this.audio) : l.base;
      if (l.def.palette && l.def.palette !== 'fixed') p = applyPalette(l.spec, p, l.def.palette, this.palette);
      l.params = p;
    }
    if (listening && this.audio.onset) {
      this.beatCount++;
      for (const l of this.layers) {
        const t = l.def.trig;
        if (!t || !t.action || l.def.enabled === false) continue;
        const every = Math.max(1, Math.round(t.every || 1));
        if (this.beatCount % every) continue;
        try { l.inst.action?.(t.action, t.arg, this._layerWorld(l, this.world(STEP)), l.params); } catch (e) { console.error('[fx beat]', e); }
      }
    }

    // drain actions before stepping so a burst lands on this frame
    if (this.pendingActions.length) {
      for (const [id, name, arg] of this.pendingActions) {
        for (const l of this.layers) {
          if (id && l.id !== id) continue;
          try { l.inst.action?.(name, arg, this._layerWorld(l, this.world(STEP)), l.params); } catch (e) { console.error('[fx action]', e); }
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
        try { l.inst.step(STEP, this._layerWorld(l, w), l.params); } catch (e) { this.error = l.type + ': ' + e.message; console.error('[fx step]', l.type, e); }
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
    this._samplePalette(compTex);

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
          l.inst.draw({ ...this._layerWorld(l, w), src: cur.tex, dst: other, opacity, params: l.params });
          const t = cur; cur = other; other = t;
        } else {
          cur.bind();
          BLEND[mode === 'add' ? 'add' : 'over'](gl);
          // reading the target it is drawing into would be undefined, so an
          // overlay layer gets no background texture; effects that need to
          // sample the picture declare blend 'post' instead.
          l.inst.draw({ ...this._layerWorld(l, w), src: null, dst: cur, opacity, params: l.params });
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

  // ------------------------------------------------------------- palette
  /**
   * A few colours read off the current picture, so a layer can take its
   * colours from the video instead of from fixed swatches: the dominant hue,
   * a second one, the average, and their complements and inverses. 256 point
   * samples every few frames are plenty for a dominant colour.
   */
  _samplePalette(compTex) {
    const gl = this.gl;
    this.palFrame = (this.palFrame || 0) + 1;
    if (this.palFrame % 4 !== 1) return;
    if (!this.palTarget) {
      this.palTarget = new Target(gl, 16, 16, 'rgba8');
      this.palBuf = new Uint8Array(16 * 16 * 4);
      this.palette = defaultPalette();
    }
    this.screen.copy(compTex, this.palTarget, 1);
    gl.readPixels(0, 0, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, this.palBuf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.palette = analysePalette(this.palBuf, this.palette);
  }

  dispose() {
    for (const l of this.layers) l.inst.dispose?.();
    for (const sub of this.subFields.values()) sub.field.dispose();
    this.subFields.clear();
    if (this.palTarget) { this.palTarget.dispose(); this.palTarget = null; }
    this.layers.length = 0;
    for (const k of ['tA', 'tB', 'bloomA', 'bloomB']) if (this[k]) { this[k].dispose(); this[k] = null; }
    this.field.dispose();
    this.chainW = this.chainH = 0;
  }
}

// --------------------------------------------------------------- palette ----
export const PALETTE_MODES = [
  ['fixed', 'Fixed colours'],
  ['video', 'From the video'],
  ['complement', 'Complement the video'],
  ['invert', 'Invert the video'],
  ['tone', 'Match the video\u2019s tone'],
];

function defaultPalette() {
  return { dominant: [0.4, 0.7, 1], second: [1, 0.5, 0.3], average: [0.5, 0.5, 0.5],
    complement: [1, 0.6, 0.4], complement2: [0.3, 0.8, 1], invert: [0.5, 0.5, 0.5], light: [0.8, 0.8, 0.8] };
}

function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h /= 6; if (h < 0) h += 1;
  }
  return [h, mx > 1e-6 ? d / mx : 0, mx];
}
function hsv2rgb(h, s, v) {
  const f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}

function analysePalette(buf, prev) {
  const bins = 24;
  const hw = new Float64Array(bins), hr = new Float64Array(bins), hg = new Float64Array(bins), hb = new Float64Array(bins);
  let ar = 0, ag = 0, ab = 0, n = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i] / 255, g = buf[i + 1] / 255, b = buf[i + 2] / 255;
    ar += r; ag += g; ab += b; n++;
    const [h, s, v] = rgb2hsv(r, g, b);
    const w = s * s * v + 1e-4;          // saturated, bright pixels decide the hue
    const k = Math.min(bins - 1, Math.floor(h * bins));
    hw[k] += w; hr[k] += r * w; hg[k] += g * w; hb[k] += b * w;
  }
  if (!n) return prev;
  const avg = [ar / n, ag / n, ab / n];
  // dominant hue bin (with its neighbours), then the best bin far from it
  const score = (k) => hw[k] + 0.5 * (hw[(k + 1) % bins] + hw[(k + bins - 1) % bins]);
  let k1 = 0; for (let k = 1; k < bins; k++) if (score(k) > score(k1)) k1 = k;
  let k2 = -1; for (let k = 0; k < bins; k++) { const dist = Math.min(Math.abs(k - k1), bins - Math.abs(k - k1)); if (dist >= 5 && (k2 < 0 || score(k) > score(k2))) k2 = k; }
  const col = (k) => {
    if (k < 0 || hw[k] < 1e-3) return null;
    const c = [hr[k] / hw[k], hg[k] / hw[k], hb[k] / hw[k]];
    const [h, s, v] = rgb2hsv(c[0], c[1], c[2]);
    return hsv2rgb(h, Math.min(1, s * 1.35 + 0.15), Math.min(1, v * 1.1 + 0.15));   // a swatch, not a smear
  };
  const dom = col(k1) || prev.dominant;
  const sec = col(k2) || hsv2rgb((rgb2hsv(...dom)[0] + 1 / 3) % 1, 0.8, 0.9);
  const comp = (c) => { const [h, s, v] = rgb2hsv(c[0], c[1], c[2]); return hsv2rgb((h + 0.5) % 1, Math.max(0.6, s), Math.max(0.7, v)); };
  const [ah, as, av] = rgb2hsv(avg[0], avg[1], avg[2]);
  // ease towards the new reading so a cut does not flash the colours
  const ease = (a, b) => a ? [a[0] + (b[0] - a[0]) * 0.25, a[1] + (b[1] - a[1]) * 0.25, a[2] + (b[2] - a[2]) * 0.25] : b;
  return {
    dominant: ease(prev.dominant, dom),
    second: ease(prev.second, sec),
    average: ease(prev.average, avg),
    complement: ease(prev.complement, comp(dom)),
    complement2: ease(prev.complement2, comp(sec)),
    invert: ease(prev.invert, [1 - avg[0], 1 - avg[1], 1 - avg[2]]),
    light: ease(prev.light, hsv2rgb(ah, Math.min(0.5, as), Math.min(1, av * 0.6 + 0.5))),
  };
}

const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');

/** Replace a layer's colour parameters according to its palette mode. */
export function applyPalette(spec, params, mode, pal) {
  if (!pal) return params;
  const colours = (spec.params || []).filter((p) => p.type === 'color');
  if (!colours.length) return params;
  let list;
  switch (mode) {
    case 'video': list = [pal.dominant, pal.second, pal.light, pal.average]; break;
    case 'complement': list = [pal.complement, pal.complement2, pal.light, pal.invert]; break;
    case 'invert': list = [pal.invert, [1 - pal.dominant[0], 1 - pal.dominant[1], 1 - pal.dominant[2]], [1 - pal.second[0], 1 - pal.second[1], 1 - pal.second[2]], pal.light]; break;
    case 'tone': list = [pal.average, pal.light, pal.dominant, pal.second]; break;
    default: return params;
  }
  const out = { ...params };
  colours.forEach((p, i) => { out[p.key] = hex(list[i % list.length]); });
  return out;
}

/** Does this layer show on the given wall ('projector' | 'tv')? Missing means yes. */
export function layerOnWall(l, wall) {
  return !l.show || l.show[wall] !== false;
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
