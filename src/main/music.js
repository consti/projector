// Apple Music, through the Music app on this Mac.
//
// There is no way to play full Apple Music tracks inside an Electron app (the
// streams are DRM-protected and the decrypted sound is walled off from Web
// Audio), so the Music app does the playing: it has the subscription, the
// library and the playlists. This module drives it over Apple Events (JXA via
// osascript): lists playlists and songs, plays a given song, pauses, seeks and
// reports where it is, so the shared transport clock can follow it. For the
// visuals and the effects to hear the music, bin/audiotap (native/audiotap)
// taps the Music process's output and streams mono float32 samples back here,
// which are forwarded to the control window's analyser.
//
// While a Music song is the source, Music's own repeat is set to "one" and its
// shuffle off, so it never wanders on to something else by itself: the
// transport decides what comes next. The previous values are put back when
// the source changes to anything else, and on quit.

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');            // the project / packaged app root
const TAP_BIN = path.join(ROOT, 'bin', 'audiotap');
const TAP_BUILD = path.join(ROOT, 'scripts', 'build-audiotap.sh');

// A quirk worth knowing: a property read in the same script as a write to it
// (songRepeat, shuffleEnabled) returns the old value; the write does land.
// Nothing here relies on reading back what it just set.
function jxa(body, timeout = 30000) {
  const src = `(() => { const M = Application('Music'); ${body} })()`;
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', src], { timeout, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const m = String(stderr || err.message).trim().replace(/^execution error:\s*/i, '').replace(/\s*\(-?\d+\)\s*$/, '');
        return reject(new Error(m || 'Music did not answer'));
      }
      const out = String(stdout).trim();
      if (!out) return resolve(null);
      try { resolve(JSON.parse(out)); } catch { resolve(out); }
    });
  });
}

const str = (v) => JSON.stringify(String(v == null ? '' : v));

class Music {
  constructor(opts = {}) {
    this.log = opts.log || ((...a) => console.log('[music]', ...a));
    this.onPcm = opts.onPcm || null;        // (Float32Array samples, sampleRate)
    this.onTapState = opts.onTapState || null;
    this.saved = null;                      // Music's repeat/shuffle before we touched them
    this.driving = false;                   // a Music song is the transport source
    this.busy = false;                      // a play command is in flight
    this.tap = null;
    this.tapWanted = false;
    this.tapPid = 0;
    this.tapError = null;
    this.tapRetry = 0;
    this._songs = null;                     // the whole library, cached for the session
  }

  // ---------------------------------------------------------------- browsing

  /** Is the Music app there, and are we allowed to talk to it? */
  async status() {
    try {
      const r = await jxa(`return JSON.stringify({ running: M.running() });`, 8000);
      return { available: true, running: !!(r && r.running), error: null, tapError: this.tapError };
    } catch (e) {
      return { available: false, running: false, error: e.message, tapError: this.tapError };
    }
  }

  async playlists() {
    const r = await jxa(`
      const out = [];
      for (const p of M.userPlaylists()) {
        let cls = ''; try { cls = p.class(); } catch (e) {}
        if (cls === 'folderPlaylist') continue;
        let special = 'none'; try { special = p.specialKind(); } catch (e) {}
        if (special && special !== 'none') continue;          // Music's own lists: Music, Music Videos, Genius…
        let n = 0; try { n = p.tracks.length; } catch (e) {}
        if (!n) continue;
        let smart = false; try { smart = !!p.smart(); } catch (e) {}
        out.push({ id: String(p.id()), name: p.name(), count: n, smart });
      }
      let songs = 0; try { songs = M.libraryPlaylists[0].tracks.length; } catch (e) {}
      return JSON.stringify({ songs, playlists: out });`, 60000);
    return r || { songs: 0, playlists: [] };
  }

  /** The songs of one playlist, or of the whole library (playlistId null). */
  async tracks(playlistId) {
    if (!playlistId && this._songs) return this._songs;
    const r = await jxa(`
      const p = ${playlistId ? `M.playlists.byId(${JSON.stringify(Number(playlistId))})` : 'M.libraryPlaylists[0]'};
      const t = p.tracks;
      const n = t.length;
      if (!n) return '[]';
      // one Apple Event per property for the whole list, not one per song
      const names = t.name(), artists = t.artist(), albums = t.album(), durs = t.duration(), pids = t.persistentID(), dbs = t.databaseID();
      let kinds = null; try { kinds = t.videoKind(); } catch (e) {}
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push({ id: pids[i], db: dbs[i], title: names[i] || '', artist: artists[i] || '', album: albums[i] || '',
          duration: durs[i] || 0, video: !!(kinds && kinds[i] && kinds[i] !== 'none') });
      }
      return JSON.stringify(out);`, 120000);
    const list = Array.isArray(r) ? r : [];
    if (!playlistId) this._songs = list;
    return list;
  }

  forget() { this._songs = null; }

  // ----------------------------------------------------------------- playing

  /** Where Music is: state, position, the track it is on. */
  async now() {
    return jxa(`
      if (!M.running()) return JSON.stringify({ running: false });
      let track = null;
      try { const c = M.currentTrack; track = { id: c.persistentID(), db: c.databaseID(), title: c.name(), artist: c.artist(), album: c.album(), duration: c.duration() }; } catch (e) {}
      let pos = 0; try { pos = M.playerPosition(); } catch (e) {}
      return JSON.stringify({ running: true, state: M.playerState(), pos, track });`, 8000);
  }

  /** Start one song. Remembers Music's repeat/shuffle the first time. */
  async play(item) {
    this.busy = true;
    try {
      const r = await jxa(`
        const r = M.libraryPlaylists[0].tracks.whose({ persistentID: ${str(item.musicId)} })();
        const t = r[0] || null;
        if (!t) throw new Error('That song is no longer in the Music library');
        const saved = { repeat: M.songRepeat(), shuffle: M.shuffleEnabled(), volume: M.soundVolume(), mute: M.mute() };
        M.songRepeat = 'one';
        M.shuffleEnabled = false;
        ${item.volume != null ? `M.soundVolume = ${Math.round(Math.max(0, Math.min(1, +item.volume)) * 100)}; M.mute = ${item.muted ? 'true' : 'false'};` : ''}
        M.play(t);
        return JSON.stringify({ saved, duration: t.duration(), db: t.databaseID() });`, 30000);
      if (!this.saved && r && r.saved) this.saved = r.saved;
      this.driving = true;
      this.tapWanted = true;
      this._tapEnsure();
      return r;
    } finally {
      this.busy = false;
    }
  }

  pause() { return jxa(`if (M.running()) M.pause(); return '1';`, 8000).catch((e) => this.log(e.message)); }
  resume() { return jxa(`M.play(); return '1';`, 8000).catch((e) => this.log(e.message)); }
  seek(sec) { return jxa(`if (M.running()) M.playerPosition = ${JSON.stringify(Math.max(0, +sec || 0))}; return '1';`, 8000).catch((e) => this.log(e.message)); }
  /** The transport's volume (0..1) and mute, applied to Music while we drive it; put back by leave(). */
  volume(v, muted) {
    const pct = Math.round(Math.max(0, Math.min(1, +v || 0)) * 100);
    return jxa(`if (M.running()) { M.soundVolume = ${pct}; M.mute = ${muted ? 'true' : 'false'}; } return '1';`, 8000).catch((e) => this.log(e.message));
  }

  /** The source is no longer a Music song: stop Music, give its settings back, stop listening. */
  async leave() {
    this.tapWanted = false;
    this._tapStop();
    if (!this.driving) return;
    this.driving = false;
    const saved = this.saved; this.saved = null;
    try {
      await jxa(`
        if (!M.running()) return '0';
        try { M.stop(); } catch (e) {}
        ${saved ? `M.songRepeat = ${str(saved.repeat)}; M.shuffleEnabled = ${saved.shuffle ? 'true' : 'false'};
          ${saved.volume != null ? `M.soundVolume = ${Math.round(+saved.volume) || 0}; M.mute = ${saved.mute ? 'true' : 'false'};` : ''}` : ''}
        return '1';`, 8000);
    } catch (e) { this.log('leave:', e.message); }
  }

  // --------------------------------------------------------------- the tap --

  _pid(cb) {
    execFile('pgrep', ['-x', 'Music'], (err, out) => cb(err ? 0 : (parseInt(String(out).trim().split('\n')[0], 10) || 0)));
  }

  _tapEnsure() {
    if (!this.tapWanted || this.tap) return;
    if (!fs.existsSync(TAP_BIN)) {
      if (!this._building) {
        this._building = true;
        this.log('building the audio tap helper…');
        execFile('sh', [TAP_BUILD], { timeout: 180000 }, (err, out, serr) => {
          this._building = false;
          if (err) { this.tapError = 'could not build the audio tap: ' + String(serr || err.message).split('\n')[0]; this.log(this.tapError); this._tapState(); return; }
          this._tapEnsure();
        });
      }
      return;
    }
    this._pid((pid) => {
      if (!this.tapWanted || this.tap) return;
      if (!pid) { this.tapError = 'Music is not running'; this._tapState(); return this._tapLater(); }
      this.tapPid = pid;
      const child = spawn(TAP_BIN, [String(pid)], { stdio: ['pipe', 'pipe', 'pipe'] });
      this.tap = child;
      this.tapError = null;
      let head = null, carry = Buffer.alloc(0), rate = 48000, pending = [];
      let pendingN = 0;
      const flush = () => {
        if (!pendingN) return;
        const all = Buffer.concat(pending);
        pending = []; pendingN = 0;
        const samples = new Float32Array(all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength));
        if (this.onPcm) this.onPcm(samples, rate);
      };
      child.stdout.on('data', (buf) => {
        if (!head) {
          carry = Buffer.concat([carry, buf]);
          if (carry.length < 16) return;
          if (carry.toString('latin1', 0, 4) !== 'PTAP') { this.tapError = 'bad tap header'; child.kill(); return; }
          rate = carry.readUInt32LE(4) || 48000;
          head = { rate };
          this.tapRetry = 0;
          this.log('tap: hearing Music at ' + rate + ' Hz');
          this._tapState();
          buf = carry.subarray(16); carry = Buffer.alloc(0);
        }
        // whole samples only; ship roughly every 2048
        const all = carry.length ? Buffer.concat([carry, buf]) : buf;
        const whole = all.length - (all.length % 4);
        carry = Buffer.from(all.subarray(whole));
        if (whole) { pending.push(Buffer.from(all.subarray(0, whole))); pendingN += whole / 4; }
        if (pendingN >= 2048) flush();
      });
      let errText = '';
      child.stderr.on('data', (d) => { errText += String(d); });
      child.on('exit', (code) => {
        this.log('tap: exited' + (code ? ' with ' + code : ''));
        if (this.tap === child) this.tap = null;
        if (code && errText.trim()) { this.tapError = errText.trim().split('\n').pop(); this.log('tap:', this.tapError); }
        this._tapState();
        this._tapLater();
      });
      child.on('error', (e) => { this.tapError = e.message; this._tapState(); });
    });
  }

  _tapLater() {
    if (!this.tapWanted) return;
    const wait = Math.min(15000, 1000 * Math.pow(2, this.tapRetry++));
    clearTimeout(this._tapTimer);
    this._tapTimer = setTimeout(() => this._tapEnsure(), wait);
  }

  _tapStop() {
    clearTimeout(this._tapTimer);
    this.tapRetry = 0;
    if (this.tap) { try { this.tap.stdin.end(); } catch {} const t = this.tap; setTimeout(() => { try { t.kill(); } catch {} }, 800); this.tap = null; }
    this._tapState();
  }

  _tapState() { if (this.onTapState) this.onTapState({ live: !!this.tap, error: this.tapError }); }

  /** Music was restarted: the tap follows the new process. */
  checkTap() {
    if (!this.tapWanted || !this.tap) return;
    this._pid((pid) => { if (pid && pid !== this.tapPid) { this._tapStop(); this._tapEnsure(); } });
  }

  dispose() { this.tapWanted = false; this._tapStop(); }
}

module.exports = { Music };
