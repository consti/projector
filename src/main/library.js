'use strict';
// The Library: a local collection of downloaded music videos with editable
// metadata and non-destructive edits (trim / letterbox crop / SponsorBlock
// skips). yt-dlp downloads and probes; ffmpeg makes the poster, the hover
// storyboard and detects letterbox. Everything lives under userData/library,
// indexed by library.json, so it survives reinstalls and can be exported to
// and re-created on another machine from a small manifest.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const ytdlp = require('./ytdlp');

const YTDLP = ytdlpBin();
const FFMPEG = firstOf(['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'], 'ffmpeg');
const FFPROBE = firstOf(['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe'], 'ffprobe');
const SB_CATEGORIES = ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'music_offtopic', 'preview'];
const SB_SKIP_DEFAULT = ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'music_offtopic'];
const STORY_COLS = 5, STORY_ROWS = 5, STORY_TW = 240;

function ytdlpBin() {
  for (const c of ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp']) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return 'yt-dlp';
}
function firstOf(list, fallback) {
  for (const c of list) { try { if (fs.existsSync(c)) return c; } catch {} }
  return fallback;
}
const PATH_ENV = { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:' + (process.env.PATH || '') };

function run(bin, args, { timeout = 0, onLine = null, capture = true } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { env: PATH_ENV });
    let out = '', err = '', buf = '';
    const timer = timeout ? setTimeout(() => { p.kill('SIGKILL'); reject(new Error(bin + ' timed out')); }, timeout) : null;
    p.stdout.on('data', (d) => {
      if (capture) out += d;
      if (onLine) { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } }
    });
    p.stderr.on('data', (d) => { err += d; if (onLine) onLine(String(d)); });
    p.on('error', (e) => { if (timer) clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error((err.trim().split('\n').slice(-3).join(' ')) || (bin + ' exited ' + code)));
    });
    p._proc = p;
  });
}

function httpJSON(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'Projector' } }, (r) => {
      if (r.statusCode === 404) { r.resume(); resolve(null); return; }
      if (r.statusCode !== 200) { r.resume(); reject(new Error('http ' + r.statusCode)); return; }
      let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
  });
}

// "Artist - Song (Official Video)" is the near-universal shape. Pull the two
// halves out, stripping the noise in brackets and the boilerplate suffixes.
function parseArtistTitle(raw, uploader) {
  let t = String(raw || '').trim();
  t = t.replace(/\s*[\(\[][^)\]]*\b(official|lyric|audio|video|visualizer|hd|4k|mv|m\/v|music\s*video|out\s*now)\b[^)\]]*[\)\]]/gi, '');
  t = t.replace(/\s*[\(\[][^)\]]*[\)\]]\s*$/g, (m) => (/feat|ft\.|remix|edit|version|mix/i.test(m) ? m : ''));
  t = t.replace(/\s*[-–—|]\s*(official\s*(music\s*)?video|lyric video|visualizer|audio)\s*$/i, '');
  t = t.trim();
  const sep = t.match(/^(.{1,80}?)\s*[-–—]\s*(.+)$/);
  let artist = '', title = t;
  if (sep) { artist = sep[1].trim(); title = sep[2].trim(); }
  else if (uploader) { artist = uploader.replace(/\s*-?\s*topic$/i, '').trim(); }
  title = title.replace(/\s*[\(\[]\s*[\)\]]\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return { artist, title: title || t };
}

class Library extends EventEmitter {
  constructor(userDataDir) {
    super();
    this.dir = path.join(userDataDir, 'library');
    this.mediaDir = path.join(this.dir, 'media');
    this.thumbDir = path.join(this.dir, 'thumbs');
    this.indexFile = path.join(this.dir, 'library.json');
    for (const d of [this.dir, this.mediaDir, this.thumbDir]) { try { fs.mkdirSync(d, { recursive: true }); } catch {} }
    this.items = new Map();          // id -> entry
    this.queue = [];                 // ids waiting to download
    this.active = new Set();         // ids downloading
    this.procs = new Map();          // id -> child process (to cancel)
    this.concurrency = 2;
    this._saveTimer = null;
    this._load();
  }

  // ------------------------------------------------------------- storage
  _load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      for (const e of j.items || []) {
        // a download interrupted by a quit is resumed, not left half-done
        if (e.status === 'downloading') e.status = 'queued';
        this.items.set(e.id, e);
        if (e.status === 'queued') this.queue.push(e.id);
      }
    } catch {}
    if (this.queue.length) setTimeout(() => this._pump(), 500);
  }

  _save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(async () => {
      // async so a large index write never blocks the main event loop that is
      // also piping media bytes for the proxy
      let data;
      try { data = JSON.stringify({ version: 1, items: [...this.items.values()] }, null, 2); }
      catch (e) { console.log('[library] serialize failed', e.message); return; }
      try { await fs.promises.writeFile(this.indexFile, data); }
      catch (e) { console.log('[library] save failed', e.message); }
    }, 400);
  }

  list() { return [...this.items.values()].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)); }

  _changed(e) { if (e) e.updatedAt = Date.now(); this._save(); this.emit('change'); }

  // Media/thumb URLs the renderer can load through the local:// protocol.
  mediaUrl(e) { return e.file ? localUrl(path.join(this.mediaDir, e.file)) : null; }
  thumbUrl(e, kind) {
    const f = kind === 'story' ? e.storyFile : e.thumbFile;
    return f ? localUrl(path.join(this.thumbDir, f)) + '?v=' + (e.updatedAt || 0) : null;
  }

  serialize(e) {
    return {
      ...e, mediaUrl: this.mediaUrl(e), thumbUrl: this.thumbUrl(e, 'poster'), storyUrl: this.thumbUrl(e, 'story'),
    };
  }
  serializeAll() { return this.list().map((e) => this.serialize(e)); }

  get(id) { return this.items.get(id); }

  // -------------------------------------------------------------- adding
  /** Expand each url (video / playlist / channel) and enqueue new videos. */
  async add(urls, opts = {}) {
    const list = Array.isArray(urls) ? urls : [urls];
    let added = 0;
    for (const url of list) {
      let items = [];
      try { const r = await ytdlp.probe(url); items = r.items || []; }
      catch (e) { this.emit('toast', 'Could not read ' + short(url) + ': ' + e.message); continue; }
      for (const it of items) {
        const id = it.id || it.url;
        if (!id) continue;
        if (this.items.has(id)) continue;
        const { artist, title } = parseArtistTitle(it.title, it.uploader);
        const entry = {
          id, kind: 'youtube', url: it.url,
          rawTitle: it.title || '', artist, title, uploader: it.uploader || null,
          tags: opts.tags ? [...opts.tags] : [],
          duration: it.duration || 0, thumbnail: it.thumbnail || null,
          status: 'queued', progress: 0, error: null,
          file: null, width: 0, height: 0, fps: 0, vcodec: null, acodec: null, filesize: 0,
          trim: opts.trim || null, crop: opts.crop || null, sponsor: opts.sponsor !== false,
          sponsorSkips: null, addedAt: Date.now(),
        };
        this.items.set(id, entry);
        this.queue.push(id);
        added++;
      }
    }
    this._changed();
    this._pump();
    return added;
  }

  update(id, patch) {
    const e = this.items.get(id); if (!e) return null;
    // never let the renderer clobber download bookkeeping
    for (const k of ['id', 'file', 'status', 'progress', 'width', 'height', 'fps', 'vcodec', 'acodec', 'filesize']) delete patch[k];
    Object.assign(e, patch);
    this._changed(e);
    return this.serialize(e);
  }

  remove(id) {
    const e = this.items.get(id); if (!e) return;
    this.cancel(id);
    for (const f of [e.file && path.join(this.mediaDir, e.file), e.thumbFile && path.join(this.thumbDir, e.thumbFile), e.storyFile && path.join(this.thumbDir, e.storyFile)]) {
      if (f) try { fs.unlinkSync(f); } catch {}
    }
    this.items.delete(id);
    this._changed();
  }

  retry(id) {
    const e = this.items.get(id); if (!e || this.active.has(id)) return;
    e.status = 'queued'; e.error = null; e.progress = 0;
    if (!this.queue.includes(id)) this.queue.push(id);
    this._changed(e); this._pump();
  }

  cancel(id) {
    const p = this.procs.get(id);
    if (p) { try { p.kill('SIGKILL'); } catch {} this.procs.delete(id); }
    this.active.delete(id);
    this.queue = this.queue.filter((x) => x !== id);
  }

  // ------------------------------------------------------------ download
  _pump() {
    while (this.active.size < this.concurrency && this.queue.length) {
      const id = this.queue.shift();
      const e = this.items.get(id);
      if (!e || e.status === 'ready') continue;
      this.active.add(id);
      this._download(e).catch((err) => console.log('[library] download crash', err))
        .finally(() => { this.active.delete(id); this.procs.delete(id); this._pump(); });
    }
  }

  async _download(e) {
    e.status = 'downloading'; e.progress = 0; e.error = null; this._changed(e);
    const out = path.join(this.mediaDir, e.id + '.%(ext)s');
    const h = this.maxHeight || 1080;
    const fmt = `bv*[height<=${h}][vcodec^=avc1][ext=mp4]+ba[acodec^=mp4a][ext=m4a]/b[height<=${h}][ext=mp4]/b`;
    const args = ['-f', fmt, '--merge-output-format', 'mp4', '--no-playlist', '--newline',
      '--no-mtime', '--retries', '3', '--fragment-retries', '5', '-o', out, e.url];
    let lastPct = 0;
    try {
      await new Promise((resolve, reject) => {
        const p = spawn(YTDLP, args, { env: PATH_ENV });
        this.procs.set(e.id, p);
        let err = '';
        const handle = (line) => {
          const m = line.match(/\[download\]\s+([\d.]+)%/);
          if (m) {
            const pct = parseFloat(m[1]) / 100;
            if (pct - lastPct > 0.01) { lastPct = pct; e.progress = pct; this.emit('progress', e.id, pct); }
          }
        };
        let buf = '';
        p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); } });
        p.stderr.on('data', (d) => { err += d; });
        p.on('error', reject);
        p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').slice(-2).join(' ') || 'yt-dlp exited ' + code))));
      });
    } catch (err) {
      e.status = 'error'; e.error = String(err.message || err); e.progress = 0;
      this._changed(e);
      return;
    }

    // find the produced file
    const file = fs.readdirSync(this.mediaDir).find((f) => f.startsWith(e.id + '.') && !f.endsWith('.part'));
    if (!file) { e.status = 'error'; e.error = 'download produced no file'; this._changed(e); return; }
    e.file = file;
    e.progress = 1;
    e.status = 'processing';
    this._changed(e);

    try { await this._probeMedia(e); } catch (err) { console.log('[library] ffprobe', err.message); }
    try { await this._makeThumbs(e); } catch (err) { console.log('[library] thumbs', err.message); }
    try { if (e.sponsor) e.sponsorSkips = await this.fetchSponsor(e.id); } catch {}

    e.status = 'ready';
    e.downloadedAt = Date.now();
    this._changed(e);
    this.emit('ready', e.id);
  }

  async _probeMedia(e) {
    const j = JSON.parse(await run(FFPROBE, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', path.join(this.mediaDir, e.file)], { timeout: 20000 }));
    const v = (j.streams || []).find((s) => s.codec_type === 'video') || {};
    const a = (j.streams || []).find((s) => s.codec_type === 'audio') || {};
    e.width = v.width || 0; e.height = v.height || 0;
    e.vcodec = v.codec_name || null; e.acodec = a.codec_name || null;
    if (v.avg_frame_rate && v.avg_frame_rate !== '0/0') { const [n, d] = v.avg_frame_rate.split('/').map(Number); e.fps = d ? Math.round((n / d) * 100) / 100 : 0; }
    e.duration = Math.round((parseFloat(j.format?.duration) || e.duration || 0) * 100) / 100;
    e.filesize = parseInt(j.format?.size, 10) || 0;
  }

  async _makeThumbs(e) {
    const src = path.join(this.mediaDir, e.file);
    const dur = e.duration || 0;
    // poster: let ffmpeg pick the most representative frame from a 1 fps sweep
    // of the whole clip, so a dark intro doesn't become a black thumbnail
    const poster = e.id + '.poster.jpg';
    const n = Math.max(2, Math.min(400, Math.round(dur || 60)));
    await run(FFMPEG, ['-y', '-i', src, '-vf', `fps=1,thumbnail=n=${n},scale=480:-2`,
      '-frames:v', '1', '-q:v', '4', path.join(this.thumbDir, poster)], { timeout: 45000 });
    e.thumbFile = poster;
    // storyboard: STORY_COLS×STORY_ROWS frames spread across the whole clip
    const count = STORY_COLS * STORY_ROWS;
    if (dur > 2) {
      const story = e.id + '.story.jpg';
      const fps = count / dur;
      await run(FFMPEG, ['-y', '-i', src, '-frames:v', '1', '-an', '-sws_flags', 'fast_bilinear',
        '-vf', `fps=${fps.toFixed(6)},scale=${STORY_TW}:-2,tile=${STORY_COLS}x${STORY_ROWS}`,
        '-q:v', '5', path.join(this.thumbDir, story)], { timeout: 60000 });
      const th = e.width && e.height ? Math.round(STORY_TW * e.height / e.width) : Math.round(STORY_TW * 9 / 16);
      e.storyFile = story;
      e.story = { cols: STORY_COLS, rows: STORY_ROWS, count, tw: STORY_TW, th, interval: dur / count };
    }
  }

  // --------------------------------------------------------- letterbox
  /** Detect the active-picture rect (letterbox removal) with ffmpeg cropdetect. */
  async detectCrop(id) {
    const e = this.items.get(id);
    if (!e || !e.file) return null;
    const src = path.join(this.mediaDir, e.file);
    const dur = e.duration || 30;
    const rects = [];
    for (const frac of [0.2, 0.45, 0.7]) {
      try {
        const outErr = await runCaptureErr(FFMPEG, ['-ss', String(Math.max(0, dur * frac)), '-t', '3', '-i', src,
          '-vf', 'cropdetect=24:2:0', '-f', 'null', '-'], 40000);
        const m = [...outErr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].pop();
        if (m) rects.push(m.slice(1).map(Number));
      } catch {}
    }
    if (!rects.length || !e.width) return null;
    // take the most generous (largest area) detection, to avoid cropping content
    rects.sort((a, b) => b[0] * b[1] - a[0] * a[1]);
    const [w, hh, x, y] = rects[0];
    // ignore a detection that barely trims anything: real letterbox bars are a
    // sizeable fraction of the frame, a few stray dark rows are not
    if (w >= e.width * 0.97 && hh >= e.height * 0.97) { e.crop = null; this._changed(e); return null; }
    e.crop = { x: x / e.width, y: y / e.height, w: w / e.width, h: hh / e.height };
    this._changed(e);
    return e.crop;
  }

  async detectCropBatch(ids) {
    let n = 0;
    for (const id of ids) { const r = await this.detectCrop(id).catch(() => null); if (r) n++; }
    return n;
  }

  // -------------------------------------------------------- sponsorblock
  async fetchSponsor(videoId) {
    const url = `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=${encodeURIComponent(JSON.stringify(SB_CATEGORIES))}`;
    const j = await httpJSON(url).catch(() => null);
    if (!Array.isArray(j) || !j.length) return null;
    return j.filter((s) => SB_SKIP_DEFAULT.includes(s.category) && Array.isArray(s.segment))
      .map((s) => ({ start: s.segment[0], end: s.segment[1], category: s.category }))
      .sort((a, b) => a.start - b.start);
  }

  // -------------------------------------------------------- export/import
  exportManifest() {
    return {
      app: 'projector-library', version: 1, exportedAt: Date.now(),
      items: this.list().map((e) => ({
        url: e.url, id: e.id, artist: e.artist, title: e.title, rawTitle: e.rawTitle,
        tags: e.tags || [], trim: e.trim || null, crop: e.crop || null, sponsor: e.sponsor !== false,
      })),
    };
  }

  async importManifest(manifest) {
    const items = (manifest && manifest.items) || [];
    let added = 0;
    for (const m of items) {
      const id = m.id || m.url;
      if (!id || this.items.has(id)) {
        // update edits on an item we already have
        const ex = this.items.get(id);
        if (ex) { ex.artist = m.artist ?? ex.artist; ex.title = m.title ?? ex.title; ex.tags = m.tags || ex.tags; ex.trim = m.trim ?? ex.trim; ex.crop = m.crop ?? ex.crop; }
        continue;
      }
      const entry = {
        id, kind: 'youtube', url: m.url, rawTitle: m.rawTitle || '', artist: m.artist || '', title: m.title || m.rawTitle || id,
        uploader: null, tags: m.tags || [], duration: 0, thumbnail: null,
        status: 'queued', progress: 0, error: null, file: null, width: 0, height: 0, fps: 0,
        vcodec: null, acodec: null, filesize: 0, trim: m.trim || null, crop: m.crop || null,
        sponsor: m.sponsor !== false, sponsorSkips: null, addedAt: Date.now(),
      };
      this.items.set(id, entry); this.queue.push(id); added++;
    }
    this._changed(); this._pump();
    return added;
  }

  // ----------------------------------------------------------- discovery
  /**
   * Related videos, via YouTube's own auto-generated Mix (radio) playlist for a
   * seed track. Returns candidates not already in the library or `exclude`.
   */
  async discover(seedIds, exclude = [], limit = 20) {
    const seeds = (seedIds && seedIds.length ? seedIds : this.list().filter((e) => e.status === 'ready').map((e) => e.id));
    if (!seeds.length) return [];
    const skip = new Set([...exclude, ...this.items.keys()]);
    const out = [];
    const tried = new Set();
    // shuffle seeds so repeated calls explore different neighbourhoods
    for (const seed of shuffle(seeds).slice(0, 4)) {
      if (out.length >= limit) break;
      const mix = `https://www.youtube.com/watch?v=${seed}&list=RD${seed}`;
      let items = [];
      try { const r = await ytdlp.probe(mix); items = r.items || []; } catch { continue; }
      for (const it of items) {
        const id = it.id || it.url;
        if (!id || skip.has(id) || tried.has(id)) continue;
        tried.add(id); skip.add(id);
        const { artist, title } = parseArtistTitle(it.title, it.uploader);
        out.push({ id, url: it.url, title: it.title, artist, songTitle: title, duration: it.duration || 0, thumbnail: it.thumbnail || null, uploader: it.uploader || null });
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /** A transport source for playing a ready library item. */
  playSource(id) {
    const e = this.items.get(id);
    if (!e || e.status !== 'ready' || !e.file) return null;
    return {
      kind: 'file', from: 'library', libId: id,
      url: this.mediaUrl(e), audioUrl: null,
      title: e.artist ? `${e.artist} — ${e.title}` : e.title,
      artist: e.artist || null, song: e.title || null,
      duration: e.duration || 0, width: e.width, height: e.height, fps: e.fps,
      vcodec: e.vcodec, height2: e.height,
      crop: e.crop || null, trim: e.trim || null,
      sponsorSkips: e.sponsor !== false ? (e.sponsorSkips || null) : null,
    };
  }

  setMaxHeight(h) { this.maxHeight = h; }
}

function short(u) { return String(u).replace(/^https?:\/\/(www\.)?/, '').slice(0, 40); }
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

function runCaptureErr(bin, args, timeout) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { env: PATH_ENV });
    let err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('timed out')); }, timeout);
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', () => { clearTimeout(timer); resolve(err); });
  });
}

// A local:// URL that survives Chromium's standard-scheme parser: a fixed dummy
// host keeps the absolute path in the pathname (with its original case) instead
// of the first segment being swallowed as the host.
function localUrl(absPath) {
  return 'local://f' + encodeURI(absPath).replace(/#/g, '%23');
}

module.exports = { Library, parseArtistTitle };
