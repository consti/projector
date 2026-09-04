// Listening to the film.
//
// One AnalyserNode sits in the audio path of whichever window is actually
// carrying the sound. From it we derive a small set of normalised, smoothed
// signals — five frequency bands, a spectral-flux onset detector, a decaying
// beat pulse and a tempo-locked phase — which the effect stack uses to
// modulate any parameter of any layer, or to fire an action on the beat.
//
// Every value is 0..1 and adaptively gained, so a quiet film and a loud one
// both drive the effects over their full range.

export const SOURCES = [
  ['none', '—'],
  ['level', 'Loudness'],
  ['bass', 'Bass'],
  ['low', 'Low mid'],
  ['mid', 'Mid'],
  ['high', 'High'],
  ['air', 'Air'],
  ['beat', 'Beat pulse'],
  ['phase', 'Beat ramp'],
  ['sine', 'Beat wave'],
  ['flux', 'Attack'],
];

export const EMPTY = Object.freeze({
  level: 0, bass: 0, low: 0, mid: 0, high: 0, air: 0,
  beat: 0, phase: 0, sine: 0.5, flux: 0, onset: false, bpm: 0, live: false,
});

// Hz ranges. Bass is deliberately narrow: it is what a kick actually occupies.
const BANDS = [
  ['bass', 25, 140],
  ['low', 140, 420],
  ['mid', 420, 2000],
  ['high', 2000, 6000],
  ['air', 6000, 15000],
];

export class AudioReactor {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.sources = new WeakMap();     // element -> MediaElementAudioSourceNode
    this.el = null;
    this.bins = null;
    this.prevBins = null;
    this.peaks = { level: 0.15, bass: 0.15, low: 0.15, mid: 0.15, high: 0.15, air: 0.15, flux: 0.02 };
    this.smooth = { level: 0, bass: 0, low: 0, mid: 0, high: 0, air: 0, flux: 0 };
    this.f = { ...EMPTY };
    this.onsets = [];
    this.fluxHist = new Float32Array(48);
    this.fluxAt = 0;
    this.lastOnset = 0;
    this.phase = 0;
    this.period = 0.5;
    this.beat = 0;
    this.failed = null;
  }

  /** Route `el` through the analyser. Safe to call every frame. */
  attach(el) {
    if (!el || this.el === el) return !!this.analyser;
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.55;
        this.analyser.minDecibels = -95;
        this.analyser.maxDecibels = -12;
        this.analyser.connect(this.ctx.destination);
        this.bins = new Uint8Array(this.analyser.frequencyBinCount);
        this.prevBins = new Float32Array(this.analyser.frequencyBinCount);
      }
      let src = this.sources.get(el);
      if (!src) {
        // createMediaElementSource may only be called once per element and it
        // takes the element out of the default output, so the graph below is
        // the only path its sound has to the speakers from now on. Nothing is
        // ever disconnected again: pulling the node out would silence the
        // element permanently, and a muted element already contributes
        // nothing to the analyser.
        src = this.ctx.createMediaElementSource(el);
        src.connect(this.analyser);
        this.sources.set(el, src);
      }
      this.el = el;
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      this.failed = null;
      return true;
    } catch (e) {
      this.failed = e.message;
      return false;
    }
  }

  /** Stop reading. The audio graph stays wired — see attach(). */
  detach() {
    this.el = null;
    this.f = { ...EMPTY };
  }

  get ready() { return !!this.analyser && !!this.el; }

  /**
   * @param {number} dt seconds
   * @param {object} o { sensitivity, attack, release }
   */
  update(dt, o = {}) {
    if (!this.ready) { this.f = { ...EMPTY }; return this.f; }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    const a = this.analyser;
    a.getByteFrequencyData(this.bins);
    const n = this.bins.length;
    const nyquist = this.ctx.sampleRate / 2;
    const perBin = nyquist / n;

    const gain = o.sensitivity == null ? 1 : o.sensitivity;
    const attack = 1 - Math.exp(-dt / Math.max(0.002, o.attack == null ? 0.02 : o.attack));
    const release = 1 - Math.exp(-dt / Math.max(0.01, o.release == null ? 0.16 : o.release));

    // raw band energies, wideband spectral flux, and a low-band flux that is
    // what actually tracks a beat: a kick lives under 250 Hz and a cymbal
    // wash does not
    const lowCut = Math.min(n - 1, Math.ceil(250 / perBin));
    let total = 0, flux = 0, fluxLow = 0;
    const raw = {};
    for (const [name, lo, hi] of BANDS) {
      const i0 = Math.max(1, Math.floor(lo / perBin));
      const i1 = Math.min(n - 1, Math.ceil(hi / perBin));
      let s = 0;
      for (let i = i0; i <= i1; i++) s += this.bins[i];
      raw[name] = s / Math.max(1, i1 - i0 + 1) / 255;
    }
    for (let i = 1; i < n; i++) {
      const v = this.bins[i] / 255;
      total += v;
      const d = v - this.prevBins[i];
      if (d > 0) { flux += d; if (i <= lowCut) fluxLow += d; }
      this.prevBins[i] = v;
    }
    raw.level = total / (n - 1);
    raw.flux = flux / Math.sqrt(n);
    const beatFlux = fluxLow / Math.sqrt(Math.max(1, lowCut));

    // adaptive gain: track a slowly decaying peak per signal
    const f = this.f;
    for (const k of ['level', 'bass', 'low', 'mid', 'high', 'air', 'flux']) {
      const v = raw[k] * gain;
      this.peaks[k] = Math.max(v, this.peaks[k] * (1 - dt * 0.10));
      const norm = Math.min(1, v / Math.max(k === 'flux' ? 0.01 : 0.05, this.peaks[k]));
      const k2 = norm > this.smooth[k] ? attack : release;
      this.smooth[k] += (norm - this.smooth[k]) * k2;
      f[k] = this.smooth[k];
    }

    // onset: spectral flux above a running mean + deviation, rate limited
    const hist = this.fluxHist;
    hist[this.fluxAt = (this.fluxAt + 1) % hist.length] = beatFlux;
    let mean = 0;
    for (let i = 0; i < hist.length; i++) mean += hist[i];
    mean /= hist.length;
    let varr = 0;
    for (let i = 0; i < hist.length; i++) { const d = hist[i] - mean; varr += d * d; }
    const sd = Math.sqrt(varr / hist.length);
    const now = (this.ctx.currentTime || 0);
    const thresh = mean + sd * (o.beatThreshold == null ? 1.5 : o.beatThreshold) + 1e-4;
    let onset = false;
    if (beatFlux > thresh && now - this.lastOnset > 0.19) {
      onset = true;
      if (this.lastOnset) {
        const gap = now - this.lastOnset;
        if (gap > 0.25 && gap < 1.4) {
          this.onsets.push(gap);
          if (this.onsets.length > 12) this.onsets.shift();
        }
      }
      this.lastOnset = now;
      this.beat = 1;
      this.phase = 0;
    }
    this.beat = Math.max(0, this.beat - dt / Math.max(0.05, o.beatHold == null ? 0.22 : o.beatHold));

    if (this.onsets.length >= 4) {
      const s = [...this.onsets].sort((x, y) => x - y);
      let period = s[s.length >> 1];
      // fold into a musical range: detectors happily lock onto half or double
      while (period < 0.34) period *= 2;
      while (period > 1.15) period /= 2;
      this.period = period;
    }
    this.phase = (this.phase + dt / Math.max(0.2, this.period)) % 1;

    f.beat = this.beat;
    f.phase = this.phase;
    f.sine = 0.5 + 0.5 * Math.cos(this.phase * Math.PI * 2);
    f.onset = onset;
    f.bpm = this.period > 0 ? Math.round(60 / this.period) : 0;
    f.live = true;
    return f;
  }

  /** Compact wire form for the IPC relay to the output windows. */
  packet() {
    const f = this.f;
    return {
      level: r3(f.level), bass: r3(f.bass), low: r3(f.low), mid: r3(f.mid),
      high: r3(f.high), air: r3(f.air), beat: r3(f.beat), phase: r3(f.phase),
      sine: r3(f.sine), flux: r3(f.flux), onset: f.onset, bpm: f.bpm, live: f.live,
    };
  }
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Apply a layer's modulation list to its parameters.
 * `base` is the unmodulated set; the result is a fresh object so the editor
 * always reads and writes the value the operator dialled in.
 */
export function modulate(spec, base, mods, audio) {
  if (!mods || !mods.length || !audio) return base;
  const byKey = spec._byKey || (spec._byKey = new Map((spec.params || []).map((p) => [p.key, p])));
  let out = null;
  for (const m of mods) {
    if (!m || !m.p || !m.src || m.src === 'none') continue;
    const p = byKey.get(m.p);
    if (!p || p.type === 'color' || p.type === 'select') continue;
    const v = audio[m.src];
    if (v == null) continue;
    if (!out) out = { ...base };
    const amt = m.amt == null ? 1 : m.amt;
    if (p.type === 'bool') { out[m.p] = v * amt > 0.5 ? true : base[m.p]; continue; }
    const span = (p.max - p.min);
    let val;
    if (m.mode === 'mul') val = base[m.p] * (1 + amt * v);
    else if (m.mode === 'set') val = p.min + span * Math.min(1, Math.max(0, v * amt));
    else val = base[m.p] + amt * span * v;
    out[m.p] = Math.min(p.max, Math.max(p.min, val));
  }
  return out || base;
}
