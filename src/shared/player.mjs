// Wall-clock-driven media playback. Every window derives its own target time
// from the shared transport anchor, so multiple outputs stay in sync without
// a master/slave relationship.

export function targetTime(t) {
  if (!t) return 0;
  const base = t.playing ? t.position + ((Date.now() - t.anchorTime) * t.rate) / 1000 : t.position;
  if (t.repeat === 'one' && t.duration > 0.2) return base % t.duration;
  return base;
}

export class Player {
  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.crossOrigin = 'anonymous';
    this.video.muted = true;
    this.video.style.display = 'none';
    document.body.appendChild(this.video);

    this.audio = document.createElement('audio');
    this.audio.preload = 'auto';
    this.audio.crossOrigin = 'anonymous';
    this.audio.style.display = 'none';
    document.body.appendChild(this.audio);

    this.srcKey = null;
    this.wantAudio = false;
    this._urls = { video: null, audio: null };
    this._stall = {};
    this.recoveries = 0;
    this.onended = null;
    this.onmeta = null;
    this.onResync = null;      // ask the shared clock to come back to the media
    this.onFrame = null;       // fires once per presented video frame
    this.frameId = 0;
    this._rvfc = false;
    this._frameInterval = 0;   // seconds between decoded frames (from rVFC mediaTime)
    this._lastFrameMedia = 0;
    this.status = 'idle';
    this._lastSeek = 0;
    this._lastResync = 0;

    this.video.addEventListener('ended', () => this.onended && this.onended());
    this.video.addEventListener('loadedmetadata', () => {
      this.status = 'ready';
      this.onmeta && this.onmeta({ duration: this.video.duration, width: this.video.videoWidth, height: this.video.videoHeight });
    });
    this.video.addEventListener('error', () => { this.status = 'error: ' + (this.video.error?.message || this.video.error?.code || '?'); });
    this.video.addEventListener('waiting', () => { if (this.status === 'ready') this.status = 'buffering'; });
    this.video.addEventListener('playing', () => { this.status = 'ready'; });
  }

  // One callback per presented frame, so the renderer can upload a texture only
  // when there is genuinely a new frame instead of on every animation frame.
  _startFrameLoop() {
    if (this._rvfc || !this.video.requestVideoFrameCallback) return;
    this._rvfc = true;
    const step = (now, metadata) => {
      this.frameId++;
      // The frame's own media timestamp is exact, unlike the wall-clock gap
      // between uploads (which jitters by a whole refresh on a 24 fps source
      // shown at 60 Hz). Use it to know the true source frame rate and where
      // the display sits between two decoded frames, so the smooth-motion
      // cross-fade is timed correctly instead of guessing.
      if (metadata && typeof metadata.mediaTime === 'number') {
        const dt = metadata.mediaTime - this._lastFrameMedia;
        this._lastFrameMedia = metadata.mediaTime;
        if (dt > 0.005 && dt < 0.2) {
          this._frameInterval = this._frameInterval ? this._frameInterval * 0.8 + dt * 0.2 : dt;
        } else if (dt < 0 || dt > 0.5) {
          this._frameInterval = 0;   // a seek or a stall: forget the cadence
        }
      }
      if (this.onFrame) this.onFrame();
      this.video.requestVideoFrameCallback(step);
    };
    this.video.requestVideoFrameCallback(step);
  }

  get frameGated() { return this._rvfc; }
  get sourceFps() { return this._frameInterval > 0 ? 1 / this._frameInterval : 0; }

  /**
   * How far the display is through the interval between the two most recent
   * decoded frames, 0..1, for cross-fading them. 1 (show the newest outright)
   * when smoothing is off, the cadence is unknown, or the source is already
   * ≥48 fps (even enough that blending would only soften the picture).
   */
  blendFactor(on) {
    if (!on || !this._frameInterval || this._frameInterval < 1 / 48) return 1;
    const phase = (this.video.currentTime - this._lastFrameMedia) / this._frameInterval;
    return Math.min(1, Math.max(0, phase));
  }

  /**
   * @param source transport source, or null
   * @param opts.preview prefer the low-resolution copy if the source has one.
   *        The control window's preview is a few hundred pixels wide; pulling
   *        and decoding a second 1080p stream for it doubles the bandwidth and
   *        is what makes the projector run out of buffer.
   */
  setSource(source, opts = {}) {
    const videoUrl = source ? ((opts.preview && source.previewUrl) || source.url) : null;
    const key = source ? videoUrl + '|' + (source.audioUrl || '') : null;
    if (key === this.srcKey) return;
    this.srcKey = key;
    this.status = source ? 'loading' : 'idle';
    this._urls = { video: videoUrl, audio: (source && source.audioUrl) || null };
    this._stall = {};
    this.recoveries = 0;
    this._frameInterval = 0;
    this._lastFrameMedia = 0;
    if (!source) {
      this.video.removeAttribute('src'); this.video.load();
      this.audio.removeAttribute('src'); this.audio.load();
      return;
    }
    this.video.src = videoUrl;
    this.video.load();
    this._startFrameLoop();
    if (source.audioUrl) { this.audio.src = source.audioUrl; this.audio.load(); }
    else { this.audio.removeAttribute('src'); this.audio.load(); }
  }

  /**
   * Chromium abandons a media resource for good once one of its range requests
   * fails: the element sits at readyState 2 and never asks the network for
   * anything again, which shows up as playback frozen on "Buffering...". The
   * only way back is to re-open the source, so anything that stops making
   * progress while it is supposed to be playing gets re-armed here.
   */
  _watch(el, key, want, t) {
    if (!t.playing || !el.getAttribute('src')) { this._stall[key] = null; return; }
    const s = this._stall[key] || (this._stall[key] = { ct: -1, since: 0, last: 0, ran: false });
    if (el.readyState >= 3) s.ran = true;
    const ct = el.currentTime;
    if (el.seeking || Math.abs(ct - s.ct) > 0.001) { s.ct = ct; s.since = 0; return; }
    const now = performance.now();
    if (!s.since) { s.since = now; return; }
    // A track that has never started is still opening; give the initial load
    // far longer than a stream that was playing a moment ago and died.
    if (now - s.since < (s.ran ? 3000 : 14000)) return;
    if (now - s.last < 8000) return;           // do not thrash
    s.last = now; s.since = 0;
    const url = this._urls && this._urls[key];
    if (!url) return;
    this.recoveries = (this.recoveries || 0) + 1;
    this.status = 'buffering';
    const at = Math.max(0, want);
    try {
      el.src = url;
      el.load();
      const onMeta = () => {
        el.removeEventListener('loadedmetadata', onMeta);
        try { el.currentTime = at; } catch {}
        if (t.playing) el.play().catch(() => {});
      };
      el.addEventListener('loadedmetadata', onMeta);
    } catch {}
  }

  get separateAudio() { return !!this.audio.getAttribute('src'); }

  // Route this window's audio to a specific output device (e.g. an AirPlay
  // receiver) via setSinkId, without touching the Mac's system default.
  setSink(id) {
    id = id || '';
    if (this._sinkId === id) return;
    this._sinkId = id;
    for (const el of [this.audio, this.video]) {
      if (el.setSinkId) el.setSinkId(id).catch(() => {});
    }
  }

  // Nudge both tracks toward the shared clock. Called every animation frame.
  update(t, opts = {}) {
    const audible = !!opts.audible && !t.muted;
    const vol = t.volume == null ? 1 : t.volume;
    if (this.separateAudio) {
      this.video.muted = true;
      this.audio.muted = !audible;
      this.audio.volume = vol;
    } else {
      this.video.muted = !audible;
      this.video.volume = vol;
    }

    const want = targetTime(t);
    // Whichever element is actually producing sound gets the gentle rate
    // treatment: a combined mp4 carries its audio on the video element, and
    // nudging that element's rate makes Chromium time-stretch the audio
    // (preservesPitch), which crackles. A muted element can be nudged hard for
    // tight visual sync without any audible cost.
    const videoAudible = !this.separateAudio && audible;
    this._sync(this.video, want, t, videoAudible);
    if (this.separateAudio) this._sync(this.audio, want, t, audible);
    this._watch(this.video, 'video', want, t);
    if (this.separateAudio) this._watch(this.audio, 'audio', want, t);
  }

  // Is `t` inside data the element already holds? Seeking outside it throws
  // away the buffer and forces a fresh network round trip.
  _hasData(el, t) {
    const b = el.buffered;
    for (let i = 0; i < b.length; i++) {
      if (t >= b.start(i) - 0.25 && t <= b.end(i) - 0.05) return true;
    }
    return false;
  }

  _requestResync(mediaTime) {
    const now = performance.now();
    if (now - this._lastResync < 500) return;
    this._lastResync = now;
    if (this.onResync) this.onResync(mediaTime);
  }

  _sync(el, want, t, gentle = false) {
    if (!el.getAttribute('src')) return;
    if (el.readyState < 1) return;
    const dur = el.duration;
    let target = want;
    if (isFinite(dur) && dur > 0.2) target = Math.min(Math.max(0, want), dur - 0.03);

    if (t.playing) {
      if (el.paused) el.play().catch(() => {});
    } else if (!el.paused) {
      el.pause();
    }

    // Still filling up: hold the shared clock here rather than letting it run
    // ahead of the media, which would force a seek past the buffer.
    if (el.readyState < 3) {
      if (t.playing) this._requestResync(el.currentTime);
      el.playbackRate = t.rate;
      return;
    }

    // A rate change is invisible on video but *audible* on the element that
    // carries the sound — a few percent makes Chromium time-stretch the audio,
    // which crackles. So the audible element gets a wide deadband (a small
    // steady offset from the clock is imperceptible, well inside A/V tolerance)
    // and, when it does correct, a gentle cap instead of the muted video's ±6%.
    // This keeps its rate at exactly 1x almost always.
    const dead = gentle ? 0.22 : 0.04;
    const maxDev = gentle ? 0.015 : 0.06;
    const gain = gentle ? 0.15 : 0.5;

    const drift = el.currentTime - target;
    const a = Math.abs(drift);
    if (a > 0.35) {
      if (drift < 0 && !this._hasData(el, target)) {
        // The clock has run ahead of what we can actually play. Pull the clock
        // back to the media instead of seeking into unbuffered territory.
        this._requestResync(el.currentTime);
        el.playbackRate = t.rate;
        return;
      }
      const now = performance.now();
      if (now - this._lastSeek > 700) {
        this._lastSeek = now;
        el.currentTime = target;
      }
      el.playbackRate = t.rate;
    } else if (t.playing && a > dead) {
      // trim playback speed slightly instead of jumping
      el.playbackRate = Math.max(t.rate * (1 - maxDev), Math.min(t.rate * (1 + maxDev), t.rate * (1 - drift * gain)));
    } else {
      el.playbackRate = t.rate;
    }
  }
}
