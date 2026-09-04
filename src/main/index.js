'use strict';
const { app, BrowserWindow, ipcMain, protocol, screen, dialog, net, globalShortcut,
        powerSaveBlocker, Menu, shell, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const ytdlp = require('./ytdlp');

const ROOT = path.join(__dirname, '..');           // .../src
const isDev = process.argv.includes('--dev');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'local', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
};
const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

// ---------------------------------------------------------------- state -----
let state = null;
const outputs = new Map();     // role -> BrowserWindow
let control = null;
let psbId = null;
const resolveCache = new Map();

// ------------------------------------------------------------- persistence -
function sessionFile() { return path.join(app.getPath('userData'), 'session.json'); }

let saveTimer = null;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(app.getPath('userData'), { recursive: true });
      fs.writeFileSync(sessionFile(), JSON.stringify({
        project: state.project,
        projectPath: state.projectPath,
        mappingName: state.mappingName || null,
        outputs: state.outputs,
        settings: state.settings,
        playlist: state.playlist,
        prefs: {
          repeat: state.transport.repeat,
          shuffle: state.playlist.shuffle,
          volume: state.transport.volume,
          muted: state.transport.muted,
          rate: state.transport.rate,
        },
      }, null, 2));
    } catch (e) { console.log('autosave failed:', e.message); }
  }, 800);
}

function restoreSession(base) {
  try {
    const j = JSON.parse(fs.readFileSync(sessionFile(), 'utf8'));
    if (j.project && Array.isArray(j.project.surfaces)) base.project = j.project;
    if (j.projectPath) base.projectPath = j.projectPath;
    if (j.mappingName) base.mappingName = j.mappingName;
    if (j.outputs) base.outputs = { ...base.outputs, ...j.outputs };
    if (j.settings) base.settings = { ...base.settings, ...j.settings };
    if (j.playlist) base.playlist = { ...base.playlist, ...j.playlist, index: -1 };
    if (j.prefs) {
      const p = j.prefs;
      if (p.repeat) base.transport.repeat = p.repeat;
      if (p.volume != null) base.transport.volume = p.volume;
      if (p.muted != null) base.transport.muted = !!p.muted;
      if (p.rate) base.transport.rate = p.rate;
      if (p.shuffle != null) base.playlist.shuffle = !!p.shuffle;
    }
    console.log('restored session from', sessionFile());
  } catch {}
  // If the session is missing or unreadable, fall back to the mapping that was
  // last saved by name, so a wall survives a wiped session.
  if ((!base.project || !Array.isArray(base.project.surfaces) || !base.project.surfaces.length)) {
    const last = newestMapping();
    if (last) {
      try {
        base.project = JSON.parse(fs.readFileSync(last.file, 'utf8'));
        base.mappingName = last.name;
        console.log('restored mapping', last.name);
      } catch {}
    }
  }
  return base;
}

// ----------------------------------------------------------- mapping library
// Named wall setups live as plain JSON next to the session, so they survive a
// reinstall and can be copied between machines.
function mappingDir() {
  const d = path.join(app.getPath('userData'), 'mappings');
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}

const safeMappingName = (n) =>
  String(n || '').trim().replace(/[^\w \-().]+/g, '_').slice(0, 60) || 'Untitled';

function mappingFile(name) { return path.join(mappingDir(), safeMappingName(name) + '.json'); }

function listMappings() {
  let files = [];
  try { files = fs.readdirSync(mappingDir()).filter((f) => f.endsWith('.json')); } catch {}
  return files.map((f) => {
    const file = path.join(mappingDir(), f);
    let st = null;
    try { st = fs.statSync(file); } catch {}
    return { name: f.replace(/\.json$/, ''), file, saved: st ? st.mtimeMs : 0 };
  }).sort((a, b) => b.saved - a.saved);
}

function newestMapping() { return listMappings()[0] || null; }

async function loadDefaults() {
  const { pathToFileURL } = require('url');
  const m = await import(pathToFileURL(path.join(ROOT, 'shared', 'schema.mjs')).href);
  return m.defaultState();
}

function broadcast(channel, payload) {
  for (const w of [control, ...outputs.values()]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

// Resolve which window should carry the audio. A fixed target that is not open
// (the default 'tv' with no TV window) would otherwise mean silence.
function resolveAudio() {
  const want = state.settings.audioTarget || 'auto';
  if (want === 'none') return 'none';
  const open = (r) => outputs.has(r) && !outputs.get(r).isDestroyed();
  if (want === 'control') return 'control';
  if (want !== 'auto' && open(want)) return want;
  if (open('tv')) return 'tv';
  if (open('projector')) return 'projector';
  return 'control';
}

// Exactly one window may pull the shared clock back. If every window could,
// two of them oscillate: one drags the clock back, the other is then ahead,
// seeks backwards, loses its buffer, stalls, and drags the clock back again.
function resolveClockOwner() {
  const open = (r) => outputs.has(r) && !outputs.get(r).isDestroyed();
  const a = state.audioOut;
  if (a && a !== 'control' && a !== 'none' && open(a)) return a;
  if (open('projector')) return 'projector';
  if (open('tv')) return 'tv';
  return 'control';
}

function pushState() {
  state.audioOut = resolveAudio();
  state.clockOwner = resolveClockOwner();
  broadcast('state', state);
  autosave();
}

function patchState(patch) {
  for (const k of Object.keys(patch)) {
    if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) && state[k] && typeof state[k] === 'object') {
      state[k] = { ...state[k], ...patch[k] };
    } else {
      state[k] = patch[k];
    }
  }
  pushState();
}

// ------------------------------------------------------------- transport ----
let lastResync = 0;

function nowTime() {
  const t = state.transport;
  if (!t.playing) return t.position;
  return t.position + ((Date.now() - t.anchorTime) * t.rate) / 1000;
}

function setTransport(p) {
  state.transport = { ...state.transport, ...p };
  pushState();
}

function seek(sec) {
  const d = state.transport.duration || 0;
  const clamped = Math.max(0, d ? Math.min(sec, d - 0.05) : sec);
  setTransport({ position: clamped, anchorTime: Date.now() });
}

function play() { setTransport({ playing: true, anchorTime: Date.now(), position: nowTime() }); }
function pause() { setTransport({ position: nowTime(), playing: false, anchorTime: Date.now() }); }

function cacheKey(item) {
  return item.url + '@' + (state.settings.maxHeight || 1080);
}

function cachePut(key, r) {
  resolveCache.set(key, r);
  if (resolveCache.size > 80) resolveCache.delete(resolveCache.keys().next().value);
}

async function resolveItem(item) {
  const key = cacheKey(item);
  const hit = resolveCache.get(key);
  if (hit && hit.expires > Date.now() + 60000) return hit;
  const r = await ytdlp.resolve(item.url, state.settings.maxHeight || 1080);
  cachePut(key, r);
  return r;
}

// Warm the next track's stream URLs so playlist changeovers are not a stall.
function prefetch(i) {
  const pl = state.playlist;
  const n = pl.items.length;
  if (!n) return;
  const item = pl.items[((i % n) + n) % n];
  if (!item || item.kind !== 'youtube') return;
  const hit = resolveCache.get(cacheKey(item));
  if (hit && hit.expires > Date.now() + 60000) return;
  ytdlp.resolve(item.url, state.settings.maxHeight || 1080)
    .then((r) => cachePut(cacheKey(item), r))
    .catch(() => {});
}

async function loadIndex(i, autoplay = true, attempt = 0) {
  const pl = state.playlist;
  const n = pl.items.length;
  if (!n) return;
  const idx = ((i % n) + n) % n;
  const item = pl.items[idx];
  state.playlist = { ...pl, index: idx };
  setTransport({ loading: true, error: null });

  let source;
  try {
    if (item.kind === 'file') {
      source = { kind: 'file', url: 'local://' + encodeURI(item.path).replace(/#/g, '%23'), title: item.title, audioUrl: null };
    } else {
      const r = await resolveItem(item);
      const px = (v) => (v ? 'app://ui/__stream?u=' + encodeURIComponent(v) : null);
      source = {
        kind: 'stream', url: px(r.videoUrl), audioUrl: px(r.audioUrl),
        previewUrl: px(r.previewUrl),      // small copy for the control window
        title: r.title || item.title,
      };
      item.duration = item.duration || r.duration;
    }
  } catch (e) {
    // a dead entry in a long playlist should not stop the show
    item.error = String(e.message || e);
    if (n > 1 && attempt < 4) return loadIndex(idx + 1, autoplay, attempt + 1);
    setTransport({ loading: false, error: String(e.message || e) });
    return;
  }
  setTransport({
    source, loading: false, error: null,
    position: 0, anchorTime: Date.now(), playing: autoplay,
    duration: item.duration || 0,
  });
  if (n > 1) setTimeout(() => prefetch(idx + 1), 1200);
}

let shuffleRecent = [];

function pickShuffle() {
  const n = state.playlist.items.length;
  if (n <= 1) return 0;
  const cur = state.playlist.index;
  let i = cur, guard = 0;
  do { i = Math.floor(Math.random() * n); }
  while ((i === cur || shuffleRecent.includes(i)) && guard++ < n * 4);
  shuffleRecent.push(i);
  while (shuffleRecent.length > Math.max(1, Math.floor(n / 2))) shuffleRecent.shift();
  return i;
}

// Explicit next/prev: always moves, and wraps around the ends.
function advance(dir = 1) {
  const pl = state.playlist;
  const n = pl.items.length;
  if (!n) return;
  if (n === 1) { seek(0); play(); return; }
  if (pl.shuffle && dir > 0) return loadIndex(pickShuffle(), true);
  loadIndex(pl.index + dir, true);
}

// A track finished on its own.
function onEnded() {
  const pl = state.playlist;
  const n = pl.items.length;
  const rep = state.transport.repeat || 'all';
  if (!n) return pause();
  if (rep === 'one' || n === 1) {
    if (rep === 'off' && n === 1) { seek(0); return pause(); }
    seek(0); return play();
  }
  if (pl.shuffle) return loadIndex(pickShuffle(), true);
  const next = pl.index + 1;
  if (next >= n) {
    if (rep === 'all') return loadIndex(0, true);
    seek(0); return pause();
  }
  loadIndex(next, true);
}

// --------------------------------------------------------------- windows ----
function displayById(id) {
  return screen.getAllDisplays().find((d) => String(d.id) === String(id)) || null;
}

// Display ids are not stable across reconnects or rearrangement, so an
// assignment also remembers the label and falls back to it. Without this,
// "projector" can silently start pointing at the TV.
function resolveDisplay(cfg) {
  if (!cfg) return null;
  const ds = screen.getAllDisplays();
  if (cfg.displayId) {
    const m = ds.find((d) => String(d.id) === String(cfg.displayId));
    if (m && (!cfg.displayLabel || m.label === cfg.displayLabel)) return m;
  }
  if (cfg.displayLabel) {
    const m = ds.find((d) => d.label === cfg.displayLabel);
    if (m) return m;
  }
  return null;
}

// Screens rarely announce what they are, but their EDID name usually gives it
// away. These only seed a first guess; the operator can always override.
const TV_HINT = /\b(tv|lg|samsung|sony|hisense|tcl|philips|vizio|panasonic tv)\b/i;
const PROJECTOR_HINT = /\b(sanyo|epson|benq|optoma|nec|viewsonic|acer|infocus|christie|barco|projector|beamer|pj)\b/i;
// Screen sharing, Sidecar and AirPlay all add displays that are never the
// thing pointed at the wall; they are a last resort, not a first guess.
const VIRTUAL_HINT = /(virtual|screen sharing|sidecar|airplay|displaylink|dummy|capture)/i;

/** First-run guess: the projector should never land on the TV, or vice versa. */
function guessDisplays() {
  const ds = screen.getAllDisplays();
  if (!ds.length) return;
  const real = ds.filter((d) => !d.internal && !VIRTUAL_HINT.test(d.label || ''));
  const external = real.length ? real : ds.filter((d) => !d.internal);
  const pool = external.length ? external : ds;
  let proj = pool.find((d) => PROJECTOR_HINT.test(d.label || ''));
  let tv = pool.find((d) => TV_HINT.test(d.label || '') && (!proj || d.id !== proj.id));
  if (!proj) proj = pool.find((d) => !tv || d.id !== tv.id) || pool[0];
  if (!tv) tv = pool.find((d) => d.id !== proj.id) || null;
  state.outputs.projector.displayId = String(proj.id);
  state.outputs.projector.displayLabel = proj.label;
  if (tv) { state.outputs.tv.displayId = String(tv.id); state.outputs.tv.displayLabel = tv.label; }
  else { state.outputs.tv.displayId = null; state.outputs.tv.displayLabel = null; }
}

/**
 * Keep the two output roles on separate screens and drop assignments whose
 * display has gone away. `keep` is the role that was just set by hand and so
 * wins any conflict.
 */
function normalizeOutputs(keep) {
  const ds = screen.getAllDisplays();
  for (const role of ['projector', 'tv']) {
    const cfg = state.outputs[role];
    if (!cfg.displayId) continue;
    if (!resolveDisplay(cfg)) {
      // Keep the name. A projector that has been switched off comes back with
      // a different id, and remembering what it was called is what lets the
      // output reopen on it by itself instead of landing on the TV.
      cfg.displayId = null;
      closeOutput(role);
    } else stampDisplay(role);
  }
  const p = state.outputs.projector, t = state.outputs.tv;
  if (p.displayId && t.displayId && p.displayId === t.displayId) {
    // Two full-screen windows stacked on one screen look like a single broken
    // output. If the operator just chose one of them, move the other; if we
    // found the clash on our own, start again from the screen names.
    if (!keep) { guessDisplays(); return; }
    const move = keep === 'projector' ? 'tv' : 'projector';
    const other = ds.find((d) => String(d.id) !== p.displayId);
    const cfg = state.outputs[move];
    if (other) { cfg.displayId = String(other.id); cfg.displayLabel = other.label; }
    else { cfg.displayId = null; cfg.displayLabel = null; cfg.enabled = false; closeOutput(move); }
  }
}

/**
 * A screen-sharing or Sidecar display is a fine fallback when it is all there
 * is, but the moment a real monitor appears the outputs belong on that.
 */
function preferRealDisplays() {
  const ds = screen.getAllDisplays();
  if (!ds.some((d) => !VIRTUAL_HINT.test(d.label || ''))) return false;
  let moved = false;
  for (const role of ['projector', 'tv']) {
    const cfg = state.outputs[role];
    const d = resolveDisplay(cfg);
    if (d && VIRTUAL_HINT.test(d.label || '')) {
      cfg.displayId = null; cfg.displayLabel = null;
      closeOutput(role);
      moved = true;
    }
  }
  return moved;
}

/** Exchange the two roles' screens — one click when the guess came out backwards. */
function swapOutputDisplays() {
  const p = state.outputs.projector, t = state.outputs.tv;
  const pd = { id: p.displayId, label: p.displayLabel };
  p.displayId = t.displayId; p.displayLabel = t.displayLabel;
  t.displayId = pd.id; t.displayLabel = pd.label;
  pushState(); syncOutputs();
}

function stampDisplay(role) {
  const cfg = state.outputs[role];
  const d = resolveDisplay(cfg);
  if (d) { cfg.displayId = String(d.id); cfg.displayLabel = d.label; }
  return d;
}

function controlDisplay() {
  if (!control || control.isDestroyed()) return null;
  try { return screen.getDisplayMatching(control.getBounds()); } catch { return null; }
}

function moveControlTo(d) {
  if (!control || control.isDestroyed() || !d) return;
  const wa = d.workArea;
  const w = Math.min(1560, wa.width - 60), h = Math.min(1000, wa.height - 60);
  control.setBounds({
    x: Math.round(wa.x + (wa.width - w) / 2),
    y: Math.round(wa.y + (wa.height - h) / 2),
    width: w, height: h,
  });
}

// macOS: setVisibleOnAllWorkspaces() switches the process to
// NSApplicationActivationPolicyAccessory, which removes the Dock icon and the
// menu bar, leaving no way back to the control window once it loses focus.
function keepRegularApp() {
  if (process.platform !== 'darwin') return;
  try { app.setActivationPolicy('regular'); } catch {}
  try { if (app.dock && !app.dock.isVisible()) app.dock.show(); } catch {}
}

function closeAllOutputs() {
  for (const role of [...outputs.keys()]) closeOutput(role);
  for (const role of ['projector', 'tv']) if (state.outputs[role]) state.outputs[role].enabled = false;
  pushState();
}

function serializeDisplays() {
  const all = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  return all.map((d) => ({
    id: String(d.id),
    label: d.label || ('Display ' + d.id),
    bounds: d.bounds,
    size: d.size,
    scaleFactor: d.scaleFactor,
    rotation: d.rotation,
    internal: d.internal,
    isPrimary: d.id === primary.id,
  }));
}

function createControl() {
  const displays = screen.getAllDisplays();
  // put the control UI on a screen that is not the projector, if we can tell
  const projId = state.outputs.projector.displayId;
  const host = displays.find((d) => String(d.id) !== String(projId)) || displays[0];
  const b = host.bounds;
  control = new BrowserWindow({
    x: b.x + 40, y: b.y + 40,
    width: Math.min(1560, b.width - 80), height: Math.min(1000, b.height - 80),
    minWidth: 1100, minHeight: 700,
    title: 'Projector',
    backgroundColor: '#111214',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false,
    },
  });
  control.loadURL('app://ui/renderer/control/index.html');
  control.on('closed', () => { control = null; app.quit(); });
  control.on('hide', () => console.log('[control] hide event'));
  control.on('minimize', () => console.log('[control] minimize event'));
  control.on('move', () => console.log('[control] moved to', JSON.stringify(control.getBounds())));
  control.webContents.on('render-process-gone', (e, d) =>
    console.log('[control] renderer gone:', JSON.stringify(d)));
  control.webContents.on('console-message', (e, lvl, msg) => {
    if (lvl >= 2) console.log('[control console]', msg);
  });
  if (isDev) control.webContents.openDevTools({ mode: 'detach' });
}

function createOutput(role) {
  const cfg = state.outputs[role];
  const d = stampDisplay(role);
  if (!d) return;
  closeOutput(role);

  const b = d.bounds;
  const win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    show: false,
    frame: false, transparent: false, backgroundColor: '#000000',
    hasShadow: false, resizable: false, movable: false, fullscreenable: true,
    roundedCorners: false, thickFrame: false, enableLargerThanScreen: true,
    title: 'Projector output (' + role + ')',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false,
    },
  });
  try { win.setWindowButtonVisibility(false); } catch {}
  win.loadURL('app://ui/renderer/output/index.html?role=' + role);
  // show without taking focus, then make sure the control window is still front
  // macOS does not reliably honour the constructor position when the target
  // screen has a different scale factor from the primary one, so the bounds
  // are re-applied once the window exists and again after it is shown.
  const place = () => {
    const dd = resolveDisplay(cfg) || d;
    if (!dd || win.isDestroyed()) return;
    try { win.setBounds(dd.bounds); } catch {}
  };
  place();
  win.once('ready-to-show', () => {
    place();
    win.showInactive();
    place();
    setTimeout(place, 120);
    if (control && !control.isDestroyed()) {
      control.show();
      control.moveTop();
      control.focus();
    }
  });
  win.on('closed', () => {
    if (outputs.get(role) === win) outputs.delete(role);
    if (state.outputs[role]) { state.outputs[role].enabled = false; pushState(); }
    updatePowerBlocker();
    arrangeWindows();
  });
  win.webContents.on('render-process-gone', (e, d) =>
    console.log('[output ' + role + '] renderer gone:', JSON.stringify(d)));
  win.webContents.on('did-fail-load', (e, code, desc, url) =>
    console.log('[output ' + role + '] did-fail-load', code, desc, url));
  win.webContents.on('console-message', (e, lvl, msg) => {
    if (lvl >= 2) console.log('[output ' + role + ' console]', msg);
  });
  outputs.set(role, win);
  updatePowerBlocker();
  arrangeWindows();
  pushState();
}

/**
 * Decide where the control window lives and which outputs float above
 * everything.
 *
 * An output is kept always-on-top so nothing can appear over the projection —
 * except on the screen the control window is using, where that would bury the
 * only way to operate the app. With two screens and two outputs there is no
 * free screen left, so the output sharing with the control window gives up its
 * top status instead; it is still full-screen, and nothing else is on that
 * display anyway.
 */
function arrangeWindows() {
  if (!control || control.isDestroyed()) return;
  const used = new Set();
  for (const role of outputs.keys()) {
    const d = resolveDisplay(state.outputs[role]);
    if (d) used.add(String(d.id));
  }
  const ds = screen.getAllDisplays();
  const free = ds.find((d) => !used.has(String(d.id)));
  const cd = controlDisplay();
  if (free && (!cd || used.has(String(cd.id)))) moveControlTo(free);

  const now = controlDisplay();
  for (const [role, w] of outputs) {
    if (w.isDestroyed()) continue;
    const d = resolveDisplay(state.outputs[role]);
    const shares = !!(now && d && now.id === d.id);
    try {
      w.setAlwaysOnTop(!shares, 'screen-saver');
      // setVisibleOnAllWorkspaces flips the process to an accessory app, which
      // costs the Dock icon and menu bar, so it is re-asserted afterwards
      w.setVisibleOnAllWorkspaces(!shares, { visibleOnFullScreen: true });
    } catch {}
  }
  keepRegularApp();
  try { control.moveTop(); } catch {}
}

function closeOutput(role) {
  const w = outputs.get(role);
  outputs.delete(role);
  if (w && !w.isDestroyed()) w.destroy();
  updatePowerBlocker();
}

function syncOutputs() {
  for (const role of ['projector', 'tv']) {
    const cfg = state.outputs[role];
    const win = outputs.get(role);
    if (cfg.enabled && resolveDisplay(cfg)) {
      if (!win) createOutput(role);
      else {
        const d = resolveDisplay(cfg);
        if (d) win.setBounds(d.bounds);
      }
    } else if (win) closeOutput(role);
  }
  arrangeWindows();
  pushState();
}

function updatePowerBlocker() {
  const want = outputs.size > 0;
  if (want && psbId == null) psbId = powerSaveBlocker.start('prevent-display-sleep');
  if (!want && psbId != null) { powerSaveBlocker.stop(psbId); psbId = null; }
}

// --------------------------------------------------------------- protocol ---
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
           '(KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const PROXY_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges',
                       'last-modified', 'etag'];

// Streams a remote media URL through the app's own origin. This keeps the
// media same-origin (so it can be uploaded into a WebGL texture) and lets us
// send the headers the CDN expects.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Hand a remote media URL to Chromium through this app's own origin.
 *
 * The upstream response object is returned as-is: copying it into a new
 * Response pumps every chunk through this process's JS and measured ~1.4 MB/s,
 * which starves a 1080p stream. Handing the response straight back lets
 * Chromium pipe it natively.
 *
 * A media element treats any failed range request as a dead source — the
 * symptom is "FFmpegDemuxer: open context failed" and a track that will not
 * play — so a transient socket error or a 5xx from the CDN is retried here
 * rather than surfaced. Genuine aborts (the element seeking away, or the track
 * changing) are not retried: those are supposed to fail.
 */
async function proxyStream(req, remote) {
  if (!/^https?:\/\//.test(remote || '')) return new Response('bad url', { status: 400 });
  const headers = { 'user-agent': UA, origin: 'https://www.youtube.com', referer: 'https://www.youtube.com/' };
  const range = req.headers.get('range');
  if (range) headers.range = range;
  const method = req.method === 'HEAD' ? 'HEAD' : 'GET';

  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (req.signal && req.signal.aborted) return new Response(null, { status: 499 });
    try {
      const res = await net.fetch(remote, {
        method,
        headers,
        signal: req.signal,        // release the upstream socket when media aborts a range
        bypassCustomProtocolHandlers: true,
      });
      if (res.status >= 500 && attempt < 2) {
        last = new Error('upstream ' + res.status);
        try { res.body && res.body.cancel(); } catch {}
        await sleep(120 * (attempt + 1));
        continue;
      }
      if (attempt) console.log('[proxy] recovered after', attempt, 'retr' + (attempt === 1 ? 'y' : 'ies'));
      return res;
    } catch (e) {
      if ((e && e.name === 'AbortError') || (req.signal && req.signal.aborted)) {
        return new Response(null, { status: 499 });
      }
      last = e;
      if (attempt < 2) await sleep(120 * (attempt + 1));
    }
  }
  console.log('[proxy] gave up:', last && (last.name + ': ' + last.message), '|', String(remote).slice(0, 90));
  return new Response('proxy error: ' + (last && last.message), { status: 502 });
}

function handleProtocols() {
  protocol.handle('app', async (req) => {
    const u = new URL(req.url);
    if (u.pathname === '/__stream') return proxyStream(req, u.searchParams.get('u'));
    let rel = decodeURIComponent(u.pathname);
    if (rel === '/' || rel === '') rel = '/renderer/control/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) return new Response('forbidden', { status: 403 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { 'content-type': mimeOf(file) } });
    } catch {
      return new Response('not found: ' + rel, { status: 404 });
    }
  });

  // Local media with proper HTTP range support so seeking works.
  protocol.handle('local', async (req) => {
    const u = new URL(req.url);
    const file = decodeURIComponent(u.pathname);
    let stat;
    try { stat = await fs.promises.stat(file); } catch { return new Response('not found', { status: 404 }); }
    const type = mimeOf(file);
    const range = req.headers.get('range');
    const m = range && /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] === '' ? null : parseInt(m[1], 10);
      let end = m[2] === '' ? null : parseInt(m[2], 10);
      if (start == null) { start = Math.max(0, stat.size - (end || 0)); end = stat.size - 1; }
      if (end == null || end >= stat.size) end = stat.size - 1;
      if (start > end) return new Response(null, { status: 416, headers: { 'content-range': 'bytes */' + stat.size } });
      const stream = fs.createReadStream(file, { start, end });
      return new Response(Readable.toWeb(stream), {
        status: 206,
        headers: {
          'content-type': type,
          'content-length': String(end - start + 1),
          'content-range': 'bytes ' + start + '-' + end + '/' + stat.size,
          'accept-ranges': 'bytes',
          // local: is a different origin from the page, so without this the
          // media element loads CORS-tainted and the Web Audio analyser --
          // which drives the audio-reactive effects -- only ever sees silence
          'access-control-allow-origin': '*',
        },
      });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)), {
      headers: {
        'content-type': type,
        'content-length': String(stat.size),
        'accept-ranges': 'bytes',
        'access-control-allow-origin': '*',
      },
    });
  });
}

// ------------------------------------------------------------------- ipc ----
const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'mpg', 'mpeg', 'm2ts'];

function ipc() {
  ipcMain.handle('state:get', () => state);
  ipcMain.handle('state:patch', (e, patch) => { patchState(patch); return true; });
  ipcMain.handle('project:set', (e, project) => {
    state.project = project; state.dirty = true; pushState(); return true;
  });

  // Effects interaction and one-shot actions are relayed straight to the
  // output windows rather than going through state: they fire at pointer rate
  // and must not touch the autosave or the project epoch.
  const toOutputs = (channel, payload) => {
    for (const w of outputs.values()) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };
  ipcMain.handle('fx:interact', (e, pts) => { toOutputs('fx:interact', pts); return true; });
  // audio analysis flows from whichever window carries the sound to all the
  // others, so the projector can react to what the TV is playing
  ipcMain.handle('fx:audio', (e, pkt) => {
    for (const w of [control, ...outputs.values()]) {
      if (!w || w.isDestroyed() || w.webContents === e.sender) continue;
      w.webContents.send('fx:audio', pkt);
    }
    return true;
  });
  ipcMain.handle('fx:action', (e, layerId, name, arg) => {
    toOutputs('fx:action', { layerId, name, arg });
    return true;
  });

  ipcMain.handle('displays:get', () => serializeDisplays());
  ipcMain.handle('outputs:sync', () => { syncOutputs(); return true; });
  ipcMain.handle('outputs:set', (e, role, cfg) => {
    state.outputs[role] = { ...state.outputs[role], ...cfg };
    if (cfg.displayId !== undefined) {
      const d = displayById(cfg.displayId);
      state.outputs[role].displayLabel = d ? d.label : null;
      normalizeOutputs(role);
    }
    pushState(); syncOutputs(); return state.outputs;
  });
  ipcMain.handle('outputs:closeAll', () => { closeAllOutputs(); return true; });
  ipcMain.handle('outputs:swap', () => { swapOutputDisplays(); return state.outputs; });
  ipcMain.handle('outputs:identify', () => {
    for (const [role, w] of outputs) {
      if (w.isDestroyed()) continue;
      const d = resolveDisplay(state.outputs[role]);
      w.webContents.send('identify', { role, label: d ? d.label : '', bounds: d ? d.bounds : null });
    }
    return true;
  });

  ipcMain.handle('transport:cmd', async (e, cmd, arg) => {
    switch (cmd) {
      case 'play': play(); break;
      case 'pause': pause(); break;
      case 'toggle': state.transport.playing ? pause() : play(); break;
      case 'seek': seek(arg); break;
      case 'seekBy': seek(nowTime() + arg); break;
      case 'rate': setTransport({ position: nowTime(), anchorTime: Date.now(), rate: arg }); break;
      case 'volume': setTransport({ volume: arg }); break;
      case 'muted': setTransport({ muted: !!arg }); break;
      case 'repeat': setTransport({ repeat: arg }); break;
      case 'shuffle':
        state.playlist = { ...state.playlist, shuffle: !!arg };
        shuffleRecent = [];
        pushState();
        break;
      case 'next': advance(1); break;
      case 'prev': advance(-1); break;
      case 'load': await loadIndex(arg, true); break;
      case 'resync': {
        // Only the clock owner may move the clock, and only backwards.
        const t = arg && typeof arg === 'object' ? arg.t : arg;
        const from = arg && typeof arg === 'object' ? arg.role : null;
        if (from && from !== (state.clockOwner || 'control')) break;
        const cur = nowTime();
        if (typeof t === 'number' && isFinite(t) && t < cur - 0.12 &&
            Date.now() - lastResync > 400) {
          lastResync = Date.now();
          setTransport({ position: Math.max(0, t), anchorTime: Date.now() });
        }
        break;
      }
      case 'time': return nowTime();
    }
    return nowTime();
  });

  ipcMain.handle('transport:report', (e, info) => {
    if (info.duration && Math.abs((state.transport.duration || 0) - info.duration) > 0.5) {
      setTransport({ duration: info.duration });
    }
    return true;
  });
  let lastEnded = 0;
  ipcMain.handle('transport:ended', () => {
    if (Date.now() - lastEnded < 1500) return true;
    lastEnded = Date.now();
    onEnded();
    return true;
  });

  ipcMain.handle('playlist:addFiles', async () => {
    const r = await dialog.showOpenDialog(control, {
      title: 'Add video files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Video', extensions: VIDEO_EXT }, { name: 'All files', extensions: ['*'] }],
    });
    if (r.canceled) return state.playlist;
    return addPaths(r.filePaths);
  });

  ipcMain.handle('playlist:addPaths', (e, paths) => addPaths(paths));

  ipcMain.handle('playlist:addUrl', async (e, url) => {
    const r = await ytdlp.probe(url);
    if (!r.items.length) throw new Error('no playable videos found at that URL');
    const startAt = state.playlist.items.length;
    state.playlist.items = state.playlist.items.concat(r.items);
    if (r.playlist) state.playlist.name = r.playlist;
    pushState();
    if (!state.transport.source) await loadIndex(startAt, true);
    else if (r.items.length > 1) prefetch(startAt);
    return { count: r.items.length, playlist: r.playlist, truncated: r.truncated };
  });

  ipcMain.handle('playlist:set', (e, items, index) => {
    state.playlist.items = items;
    if (index != null) state.playlist.index = index;
    pushState(); return state.playlist;
  });

  ipcMain.handle('ytdlp:available', () => ytdlp.available());

  ipcMain.handle('project:save', async (e, asNew) => {
    let p = state.projectPath;
    if (!p || asNew) {
      const r = await dialog.showSaveDialog(control, {
        title: 'Save mapping', defaultPath: (state.project.name || 'mapping') + '.projector.json',
        filters: [{ name: 'Projector mapping', extensions: ['json'] }],
      });
      if (r.canceled) return null;
      p = r.filePath;
    }
    await fs.promises.writeFile(p, JSON.stringify(state.project, null, 2));
    state.projectPath = p; state.dirty = false; pushState();
    return p;
  });

  ipcMain.handle('mappings:list', () => ({
    items: listMappings().map((m) => ({ name: m.name, saved: m.saved })),
    current: state.mappingName || null,
    dirty: !!state.dirty,
  }));

  ipcMain.handle('mappings:save', async (e, name) => {
    const n = safeMappingName(name || state.mappingName || 'Untitled');
    await fs.promises.writeFile(mappingFile(n), JSON.stringify(state.project, null, 2));
    state.mappingName = n;
    state.dirty = false;
    pushState();
    return n;
  });

  ipcMain.handle('mappings:load', async (e, name) => {
    const f = mappingFile(name);
    const j = JSON.parse(await fs.promises.readFile(f, 'utf8'));
    if (!j || !Array.isArray(j.surfaces)) throw new Error('not a mapping file');
    state.project = j;
    state.mappingName = safeMappingName(name);
    state.dirty = false;
    state.projectEpoch = (state.projectEpoch || 0) + 1;
    pushState();
    return state.mappingName;
  });

  ipcMain.handle('mappings:delete', async (e, name) => {
    try { await fs.promises.unlink(mappingFile(name)); } catch {}
    if (state.mappingName === safeMappingName(name)) { state.mappingName = null; pushState(); }
    return true;
  });

  ipcMain.handle('mappings:reveal', () => { shell.showItemInFolder(mappingDir()); return true; });

  ipcMain.handle('project:open', async () => {
    const r = await dialog.showOpenDialog(control, {
      title: 'Open mapping', properties: ['openFile'],
      filters: [{ name: 'Projector mapping', extensions: ['json'] }],
    });
    if (r.canceled) return null;
    const j = JSON.parse(await fs.promises.readFile(r.filePaths[0], 'utf8'));
    state.project = j; state.projectPath = r.filePaths[0]; state.dirty = false;
    state.projectEpoch = (state.projectEpoch || 0) + 1;
    pushState();
    return r.filePaths[0];
  });

  ipcMain.handle('capture:output', async (e, role) => {
    const w = outputs.get(role) || control;
    if (!w || w.isDestroyed()) return null;
    const img = await w.webContents.capturePage();
    const dir = path.join(app.getPath('temp'), 'projector-captures');
    await fs.promises.mkdir(dir, { recursive: true });
    const f = path.join(dir, role + '-' + Date.now() + '.png');
    await fs.promises.writeFile(f, img.toPNG());
    return f;
  });

  ipcMain.handle('capture:save', async (e, dataUrl, name) => {
    const b64 = dataUrl.split(',')[1];
    const dir = path.join(app.getPath('temp'), 'projector-captures');
    await fs.promises.mkdir(dir, { recursive: true });
    const f = path.join(dir, (name || 'camera') + '-' + Date.now() + '.png');
    await fs.promises.writeFile(f, Buffer.from(b64, 'base64'));
    return f;
  });

  ipcMain.handle('media:access', async (e, kind) => {
    try {
      const st = systemPreferences.getMediaAccessStatus(kind);
      if (st === 'granted') return 'granted';
      const ok = await systemPreferences.askForMediaAccess(kind);
      return ok ? 'granted' : 'denied';
    } catch { return 'unknown'; }
  });

  ipcMain.handle('debug:windows', () => {
    const desc = (name, w) => {
      if (!w || w.isDestroyed()) return { name, destroyed: true };
      const b = w.getBounds();
      let d = null;
      try { d = screen.getDisplayMatching(b); } catch {}
      return {
        name, bounds: b,
        visible: w.isVisible(), minimized: w.isMinimized(), focused: w.isFocused(),
        alwaysOnTop: w.isAlwaysOnTop(), fullScreen: w.isFullScreen(),
        onDisplay: d ? d.label + ' (' + d.id + ')' : null,
        url: w.webContents.getURL().slice(0, 60),
      };
    };
    return {
      control: desc('control', control),
      outputs: [...outputs.entries()].map(([r, w]) => desc(r, w)),
      cfg: state.outputs,
      displays: screen.getAllDisplays().map((d) => ({ id: String(d.id), label: d.label, bounds: d.bounds })),
    };
  });

  ipcMain.handle('app:reveal', (e, p) => { shell.showItemInFolder(p); return true; });
  ipcMain.handle('app:reload', () => {
    for (const w of [control, ...outputs.values()]) if (w && !w.isDestroyed()) w.reload();
    return true;
  });
}

function addPaths(paths) {
  const items = paths.filter(Boolean).map((p) => ({
    kind: 'file', id: p, path: p, title: path.basename(p), url: null, duration: 0,
  }));
  state.playlist.items = state.playlist.items.concat(items);
  pushState();
  return state.playlist;
}

// -------------------------------------------------------------- menu -------
function buildMenu() {
  const t = [
    {
      label: app.name,
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' },
        { type: 'separator' }, { role: 'hide' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit' }],
    },
    {
      label: 'File',
      submenu: [
        { label: 'Add Video Files…', accelerator: 'CmdOrCtrl+O', click: () => control?.webContents.send('menu', 'addFiles') },
        { label: 'Add YouTube URL…', accelerator: 'CmdOrCtrl+L', click: () => control?.webContents.send('menu', 'addUrl') },
        { type: 'separator' },
        { label: 'Open Mapping…', accelerator: 'CmdOrCtrl+Shift+O', click: () => control?.webContents.send('menu', 'openProject') },
        { label: 'Save Mapping', accelerator: 'CmdOrCtrl+S', click: () => control?.webContents.send('menu', 'saveProject') },
        { label: 'Save Mapping As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => control?.webContents.send('menu', 'saveProjectAs') },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'Playback',
      submenu: [
        { label: 'Play / Pause', accelerator: 'Space', click: () => control?.webContents.send('menu', 'toggle') },
        { label: 'Next', accelerator: 'CmdOrCtrl+Right', click: () => advance(1) },
        { label: 'Previous', accelerator: 'CmdOrCtrl+Left', click: () => advance(-1) },
        { type: 'separator' },
        { label: 'Blackout', accelerator: 'B', click: () => control?.webContents.send('menu', 'blackout') },
        { label: 'Close All Outputs', accelerator: 'CmdOrCtrl+Alt+P', click: () => closeAllOutputs() },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload Windows', accelerator: 'CmdOrCtrl+R', click: () => { for (const w of [control, ...outputs.values()]) w?.reload?.(); } },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Identify Outputs', click: () => { for (const [role, w] of outputs) w.webContents.send('identify', role); } },
      ],
    },
    { role: 'window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

// -------------------------------------------------------------- bootstrap --
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');
app.commandLine.appendSwitch('disable-background-timer-throttling');

app.on('child-process-gone', (e, d) => console.log('[child-process-gone]', JSON.stringify(d)));
app.on('gpu-process-crashed', () => console.log('[gpu-process-crashed]'));

app.whenReady().then(async () => {
  state = await loadDefaults();
  restoreSession(state);
  // The saved assignment wins, but only if it still makes sense: a screen that
  // has gone away, or both roles landing on one screen, falls back to a guess.
  normalizeOutputs();
  preferRealDisplays();
  const named = ['projector', 'tv'].filter((r) => state.outputs[r].displayId || state.outputs[r].displayLabel);
  if (!named.length) guessDisplays();
  normalizeOutputs();

  keepRegularApp();
  handleProtocols();
  ipc();
  buildMenu();

  const perms = (wc) => {
    wc.session.setPermissionRequestHandler((_wc, permission, cb) => {
      cb(['media', 'camera', 'audioCapture', 'videoCapture', 'fullscreen', 'pointerLock'].includes(permission));
    });
    wc.session.setPermissionCheckHandler(() => true);
  };
  createControl();
  perms(control.webContents);
  control.webContents.once('did-finish-load', () => syncOutputs());

  startShots();
  startEval();
  // works even when an output window has focus
  try { globalShortcut.register('CommandOrControl+Alt+P', () => closeAllOutputs()); } catch {}
  screen.on('display-added', onDisplays);
  screen.on('display-removed', onDisplays);
  screen.on('display-metrics-changed', onDisplays);
});

// --dev-shots=<dir>: periodically dump window contents so the UI can be
// inspected without screen-recording permission.
function startShots() {
  const arg = process.argv.find((a) => a.startsWith('--dev-shots='));
  if (!arg) return;
  const dir = arg.slice('--dev-shots='.length);
  fs.mkdirSync(dir, { recursive: true });
  setInterval(async () => {
    const targets = [['control', control], ...outputs.entries()];
    for (const [name, w] of targets) {
      if (!w || w.isDestroyed()) continue;
      try {
        const img = await w.webContents.capturePage();
        fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
      } catch {}
    }
  }, 2000);
}

// --dev-eval=<file>: run the file's contents in the control renderer whenever
// it changes. Development affordance for driving the UI.
function startEval() {
  const arg = process.argv.find((a) => a.startsWith('--dev-eval='));
  if (!arg) return;
  const file = arg.slice('--dev-eval='.length);
  let last = '';
  setInterval(async () => {
    let src = '';
    try { src = fs.readFileSync(file, 'utf8'); } catch { return; }
    if (src === last || !src.trim()) return;
    last = src;
    for (const [name, w] of [['control', control], ...outputs.entries()]) {
      if (!w || w.isDestroyed()) continue;
      if (!src.includes('// @' + name) && name !== 'control') continue;
      if (name === 'control' && src.includes('// @only-output')) continue;
      try {
        const r = await w.webContents.executeJavaScript(src, true);
        console.log('[eval:' + name + ']', JSON.stringify(r));
      } catch (e) { console.log('[eval:' + name + ' ERROR]', e.message); }
    }
  }, 500);
}

function onDisplays() {
  normalizeOutputs();
  if (preferRealDisplays()) {
    const named = ['projector', 'tv'].filter((r) => state.outputs[r].displayId || state.outputs[r].displayLabel);
    if (!named.length) guessDisplays();
  }
  for (const role of ['projector', 'tv']) stampDisplay(role);
  broadcast('displays', serializeDisplays());
  syncOutputs();
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (psbId != null) powerSaveBlocker.stop(psbId);
  globalShortcut.unregisterAll();
});
