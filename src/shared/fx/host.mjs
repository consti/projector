// Glue between a window's renderer and the effects stack: builds the system on
// first use, keeps it in step with the project, and drives it off the wall
// clock so the control preview and the projector show the same weather.

import { FxSystem, layerOnWall } from './system.mjs';
import { AudioReactor, EMPTY as AUDIO_EMPTY } from './audio.mjs';
import { defaultFx, ensureFx } from '../schema.mjs';

export function fxConfig(project) {
  if (!project) return defaultFx();
  return ensureFx(project);
}

export class FxHost {
  constructor(engine, role) {
    this.engine = engine;
    this.role = role;
    this.system = null;
    this.enabled = false;
    this.interactors = [];
    this.error = null;
    this.idle = 0;
    this.reactor = null;        // only in the window that carries the sound
    this.audio = AUDIO_EMPTY;
    this.remoteAudio = null;    // relayed from the audio-carrying window
    this.remoteAt = 0;
    this._lastAudioT = 0;
  }

  /** Features relayed from whichever window is playing the sound. */
  setRemoteAudio(f) { this.remoteAudio = f; this.remoteAt = performance.now(); }

  /**
   * Analyse if this window owns the audio, otherwise fall back to the relay.
   * Returns a packet to broadcast, or null.
   */
  _audio(fx, opts) {
    if (!fx.audio || !fx.audio.enabled) {
      if (this.reactor) { this.reactor.detach(); }
      this.audio = AUDIO_EMPTY;
      return null;
    }
    const now = performance.now();
    const dt = Math.min(0.2, (now - this._lastAudioT) / 1000) || 1 / 60;
    this._lastAudioT = now;

    if (opts.audioEl && opts.ownsAudio) {
      if (!this.reactor) this.reactor = new AudioReactor();
      if (this.reactor.attach(opts.audioEl)) {
        this.audio = this.reactor.update(dt, fx.audio);
        return this.reactor.packet();
      }
      this.error = this.reactor.failed ? 'audio: ' + this.reactor.failed : this.error;
    } else if (this.reactor) {
      this.reactor.detach();
    }
    // relayed features go stale quickly if the owner stops sending
    this.audio = (this.remoteAudio && now - this.remoteAt < 400) ? this.remoteAudio : AUDIO_EMPTY;
    return null;
  }

  /**
   * Call once per frame, before engine.render(). The audio analysis runs even
   * when this window is not drawing effects, because the window that carries
   * the sound is often not the one showing them.
   */
  frame(project, opts = {}) {
    const fx = fxConfig(project);
    this.outgoingAudio = this._audio(fx, opts);

    // opts.wall: which wall this window draws ('projector' by default, 'tv'
    // for the TV output or the TV preview); opts.off: this wall has effects
    // switched off; opts.aspect / opts.shapes are passed to the system.
    const wall = opts.wall || 'projector';
    const wanted = !!fx.enabled && !opts.off
      && (fx.layers || []).some((l) => l.enabled !== false && layerOnWall(l, wall))
      && (this.role !== 'control' || fx.preview !== false);

    if (!wanted) {
      this.enabled = false;
      this.engine.setFx(null);
      // release the GPU memory if the stack stays off for a while
      if (this.system) {
        this.idle += 1;
        if (this.idle > 600) { this.system.dispose(); this.system = null; this.idle = 0; }
      }
      return;
    }
    this.idle = 0;

    if (!this.system) {
      try {
        this.system = new FxSystem(this.engine.gl, { role: this.role });
      } catch (e) {
        this.error = 'effects unavailable: ' + e.message;
        console.error('[fx]', e);
        return;
      }
    }
    try {
      this.system.sync(project, fx, { wall, aspect: opts.aspect, shapes: opts.shapes });
      this.system.setInteractors(this.interactors);
      this.system.setAudio(this.audio);
      const paused = fx.pauseWithVideo && opts.playing === false;
      if (!paused) this.system.update(Date.now() / 1000);
      this.engine.setFx(this.system);
      this.enabled = true;
      this.error = this.system.error;
    } catch (e) {
      this.error = e.message;
      console.error('[fx]', e);
      this.engine.setFx(null);
    }
  }

  setInteractors(list) { this.interactors = list || []; }

  action(layerId, name, arg) { if (this.system) this.system.action(layerId, name, arg); }

  stats() {
    if (!this.system) return null;
    const s = this.system;
    return {
      ms: s.stats.ms, steps: s.stats.steps, layers: s.layers.length,
      error: s.error || this.error, audio: this.audio,
    };
  }

  /** Live analysis for meters, whether local or relayed. */
  features() { return this.audio; }
}
