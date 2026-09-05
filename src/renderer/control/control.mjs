import { Stage } from '/renderer/control/stage.mjs';
import { CameraPanel } from '/renderer/control/camera.mjs';
import { Player, targetTime } from '/shared/player.mjs';
import { makePattern } from '/shared/patterns.mjs';
import { defaultProject, defaultSurface, defaultMask, ensureFx, uid, defaultFxLayer } from '/shared/schema.mjs';
import * as Mesh from '/shared/mesh.mjs';
import { FxHost } from '/shared/fx/host.mjs';
import { buildFxSection, buildFxWorldSections, buildFxBrowser, SCENES, applyScene } from '/renderer/control/fxpanel.mjs';
import { MotionTracker } from '/renderer/control/motion.mjs';
import { RemotePanel } from '/renderer/control/remote.mjs';
import { LibraryView } from '/renderer/control/library.mjs';
import { REGISTRY as FX_REGISTRY, QUALITY, withDefaults, PALETTE_MODES } from '/shared/fx/system.mjs';

const QUALITY_KEYS = Object.keys(QUALITY);

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c) n.appendChild(c);
  return n;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sourceBadge = (it) => {
  const from = it.from || (it.kind === 'file' ? 'file' : it.kind === 'library' ? 'library' : 'stream');
  return from === 'library' ? 'lib' : from === 'file' ? 'file' : from === 'stream' ? 'stream' : from;
};
const fmtTime = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  const h = Math.floor(m / 60);
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
           : `${m}:${String(sec).padStart(2, '0')}`;
};

// ------------------------------------------------------------------- state --
let S = null;                       // full state from main
let project = defaultProject();     // locally-owned, authoritative while editing
let displays = [];
let audioDevices = [];   // Mac audio output devices (incl. AirPlay), for the sink selector
let mappings = { items: [], current: null };
let mappingName = '';
let epoch = -1;
let scrubbing = false;
let patternCanvas = null, patternKind = 'off';

const player = new Player();
player.onmeta = (m) => api.report({ duration: m.duration });
player.onResync = (t) => { if (S && S.clockOwner === 'control') api.cmd('resync', { t, role: 'control' }); };
player.onFrame = () => stage.engine.markSourceDirty();
// Only the window that carries the clock says when a track is over; when no
// output window is open that is this one, and without this the playlist never
// advanced.
player.onended = () => { if (S && (S.clockOwner || 'control') === 'control') api.ended(); };

// ------------------------------------------------------------------- stage --
const stage = new Stage({
  view: $('#view'), frame: $('#frame'), glc: $('#glc'), ovc: $('#ovc'),
  camLayer: $('#camLayer'), info: $('#stageInfo'),
}, {
  project: () => project,
  outputSize: () => outputSize(),
  onChange: (commit) => pushProject(commit),
  onSelect: () => buildInspector(),
  fxPoints: () => fxPoints(),
});

// The selected effect layer's draggable points: any effect with both an `x`
// and a `y` parameter gets a handle on the stage (a lamp, a vanishing point,
// the centre of a kaleidoscope), so it can be placed by dragging rather than
// by two sliders.
function fxPoints() {
  if (currentView !== 'effects') return null;
  const fx = project.fx;
  if (!fx || !fx.enabled || !fxLayerSel) return null;
  const L = (fx.layers || []).find((l) => l.id === fxLayerSel);
  if (!L || L.enabled === false) return null;
  const spec = FX_REGISTRY.get(L.type);
  if (!spec) return null;
  const px = (spec.params || []).find((q) => q.key === 'x' && q.type === 'range');
  const py = (spec.params || []).find((q) => q.key === 'y' && q.type === 'range');
  if (!px || !py) return null;
  const P = L.params || (L.params = {});
  const label = px.label.replace(/\s*x$/i, '') || spec.label;
  return [{
    id: L.id, label, color: '#ffd60a',
    x: P.x == null ? px.def : P.x,
    y: P.y == null ? py.def : P.y,
    set: (x, y) => {
      P.x = Math.round(Math.max(px.min, Math.min(px.max, x)) * 1000) / 1000;
      P.y = Math.round(Math.max(py.min, Math.min(py.max, y)) * 1000) / 1000;
      if (P.followPointer) P.followPointer = false;   // dragging the handle takes over
      pushProject();
    },
    done: () => { pushProject(true); },
  }];
}

// ---------------------------------------------------------------- effects --
const fxHost = new FxHost(stage.engine, 'control');
let fxLayerSel = null;
const pointer = { x: 0.5, y: 0.5, px: 0.5, py: 0.5, inside: false, down: false, moved: 0 };

function fxAspect() {
  const [w, h] = outputSize();
  return h / w;
}

$('#frame').addEventListener('pointermove', (e) => {
  const [nx, ny] = stage.toNorm(e);
  pointer.x = nx; pointer.y = ny * fxAspect();
  pointer.inside = nx >= -0.05 && nx <= 1.05 && ny >= -0.05 && ny <= 1.05;
  pointer.moved = 6;
});
$('#frame').addEventListener('pointerdown', () => { pointer.down = true; });
window.addEventListener('pointerup', () => { pointer.down = false; });
$('#frame').addEventListener('pointerleave', () => { pointer.inside = false; });

let fxSendAt = 0;
let lastAudioSend = 0;
let motion = null;
let motionActive = 0;
let phonePeople = 0;
function pumpInteractors() {
  const fx = ensureFx(project);
  const on = fx.enabled && fx.interact.pointer !== false;
  let list = [];
  if (on && (pointer.inside || pointer.down)) {
    const vx = (pointer.x - pointer.px) * 60;
    const vy = (pointer.y - pointer.py) * 60;
    list = [{
      x: pointer.x, y: pointer.y, vx, vy,
      r: (fx.interact.radius || 0.07),
      strength: fx.interact.strength == null ? 1 : fx.interact.strength,
      down: pointer.down,
    }];
  }
  pointer.px = pointer.x; pointer.py = pointer.y;
  if (pointer.moved > 0) pointer.moved--;

  // camera: whoever is moving in front of the wall pushes the simulation
  if (fx.enabled && fx.interact && fx.interact.camera && camera.live && camera.homography) {
    if (!motion) motion = new MotionTracker($('#camVideo'));
    const blobs = motion.update(camera.homography, fxAspect(), {
      sensitivity: fx.interact.cameraSensitivity == null ? 1 : fx.interact.cameraSensitivity,
      radius: fx.interact.radius || 0.09,
      strength: (fx.interact.strength == null ? 1 : fx.interact.strength) *
                (fx.interact.cameraForce == null ? 1 : fx.interact.cameraForce),
    });
    if (blobs.length) list = list.concat(blobs);
    motionActive = blobs.length;
  } else {
    motionActive = 0;
  }

  // phone: bodies tracked on a phone camera, aligned to the wall the same way
  phonePeople = 0;
  if (fx.enabled && fx.interact && fx.interact.camera && remote.tracker.calibrated) {
    const blobs = remote.tracker.interactors({
      aspect: fxAspect(),
      radius: fx.interact.radius || 0.07,
      strength: (fx.interact.strength == null ? 1 : fx.interact.strength) *
                (fx.interact.cameraForce == null ? 1 : fx.interact.cameraForce),
      parts: fx.interact.phoneParts || 'body',
    });
    if (blobs.length) { list = list.concat(blobs); phonePeople = remote.tracker.people.length; }
  }

  fxHost.setInteractors(list);
  // relay to the output windows, but not at full frame rate
  const now = performance.now();
  if ((on || list.length) && now - fxSendAt > 33) {
    fxSendAt = now;
    api.fxInteract(list);
  }
}

function fxAction(layerId, name, arg) {
  fxHost.action(layerId, name, arg);
  api.fxAction(layerId, name, arg);
}

// The preview only has to look right in a panel a few hundred pixels wide.
// While a projector or TV window is up, fetching and decoding a second 1080p
// copy for it takes bandwidth the output needs.
function usePreviewStream() {
  const q = (S && S.settings && S.settings.previewQuality) || 'auto';
  if (q === 'full') return false;
  if (q === 'low') return true;
  return !!(S && S.outputs && (S.outputs.projector.enabled || S.outputs.tv.enabled));
}

function outputSize() {
  if (previewWall === 'tv') {
    const t = displays.find((x) => x.id === S?.outputs?.tv?.displayId);
    if (t) return [t.size.width, t.size.height];
  }
  const d = displays.find((x) => x.id === S?.outputs?.projector?.displayId);
  if (d) return [d.size.width, d.size.height];
  return [project.global.refW || 1920, project.global.refH || 1080];
}

// ------------------------------------------------------------ preview wall --
// The live preview can show either wall: the projector's mapped picture (where
// the areas and masks are edited) or the TV's plain picture with its effects.
let previewWall = 'projector';
function setPreviewWall(w) {
  if (previewWall === w) return;
  previewWall = w;
  stage.plain = w === 'tv';
  stage.select(null, null);
  for (const b of document.querySelectorAll('.wallSeg button')) b.classList.toggle('on', b.dataset.wall === w);
  stage.layout(); stage.draw();
}
function buildPreviewHeads() {
  for (const head of document.querySelectorAll('.previewHead')) {
    if (head.querySelector('.wallSeg')) continue;
    const seg = el('div', { class: 'wallSeg', title: 'Which wall the preview shows' }, [
      el('button', { 'data-wall': 'projector', class: 'on', text: 'Projector', onclick: () => setPreviewWall('projector') }),
      el('button', { 'data-wall': 'tv', text: 'TV', onclick: () => setPreviewWall('tv') }),
    ]);
    head.appendChild(seg);
  }
}
buildPreviewHeads();

// Hovering the small docked preview blows it up over the view so you can see
// what is happening on the wall without leaving the panel you are in.
let previewShrink = null;
(function hoverPreview() {
  const stageEl = $('#stage');
  let timer = null;
  const grow = () => {
    if (!stageEl.classList.contains('docked')) return;
    const slot = stageEl.parentElement;
    const r = slot.getBoundingClientRect();
    const m = $('#main').getBoundingClientRect();
    if (!r.width) return;
    const ar = r.height / r.width;
    let w = Math.min(r.right - m.left - 24, r.width * 2.6, (m.height - 24) / ar);
    const h = w * ar;
    const left = r.right - w;
    const top = Math.max(m.top + 12, Math.min(r.top, m.bottom - h - 12));
    stageEl.classList.add('big');
    Object.assign(stageEl.style, { left: left + 'px', top: top + 'px', width: w + 'px', height: h + 'px' });
    requestAnimationFrame(() => { stage.layout(); stage.draw(); });
  };
  const shrink = () => {
    clearTimeout(timer); timer = null;
    if (!stageEl.classList.contains('big')) return;
    stageEl.classList.remove('big');
    stageEl.style.left = stageEl.style.top = stageEl.style.width = stageEl.style.height = '';
    requestAnimationFrame(() => { stage.layout(); stage.draw(); });
  };
  stageEl.addEventListener('pointerenter', () => {
    if (!stageEl.classList.contains('docked')) return;
    clearTimeout(timer); timer = setTimeout(grow, 220);
  });
  stageEl.addEventListener('pointerleave', shrink);
  window.addEventListener('blur', shrink);
  previewShrink = shrink;
})();

let pushTimer = null;
function pushProject(commit) {
  if (pushTimer) return;
  pushTimer = requestAnimationFrame(() => {
    pushTimer = null;
    api.setProject(project);
  });
  if (commit) syncInspector();
}

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), ms);
}

// ------------------------------------------------------------------ camera --
const camera = new CameraPanel({
  select: $('#camSelect'), video: $('#camVideo'), pick: $('#camPick'),
  pickCanvas: $('#camPickCanvas'), warpVideo: $('#camWarp'), layer: $('#camLayer'),
  status: $('#camStatus'),
}, {
  toast,
  setPattern: (p) => { project.global.testPattern = p; pushProject(true); $('#patSelect').value = p; },
  frameSize: () => stage.frameSize || [0, 0],
});
camera.refreshDevices();
async function refreshAudioOutputs() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
    audioDevices = devs.map((d) => ({ id: d.deviceId, label: d.label || 'Output' }));
    remote.pushDeck(true);
    syncInspector();
  } catch {}
}
refreshAudioOutputs();
setTimeout(refreshAudioOutputs, 2500);   // labels appear once the camera panel has unlocked device access
navigator.mediaDevices?.addEventListener?.('devicechange', () => { camera.refreshDevices(); refreshAudioOutputs(); });

$('#camAlign').onclick = () => camera.beginAlign();
$('#camOff').onclick = () => { camera.stop(); camera.applyWarp(); };
$('#camOpacity').oninput = (e) => {
  camera.opacity = e.target.value / 100;
  $('#camOpacityV').textContent = e.target.value + '%';
  camera.applyWarp();
};
$('#camShot').onclick = async () => {
  const v = $('#camVideo');
  if (!v.videoWidth) return toast('No camera running');
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  const f = await api.saveCapture(c.toDataURL('image/png'), 'camera');
  toast('Saved ' + f);
};

// -------------------------------------------------------------------- phone --
const remote = new RemotePanel({
  status: $('#phStatus'), toggle: $('#phToggle'), align: $('#phAlign'), clear: $('#phClear'),
  qrWrap: $('#phQrWrap'), qr: $('#phQr'), url: $('#phUrl'), clients: $('#phClients'), hint: $('#phHint'),
}, {
  toast,
  setPattern: (p) => { project.global.testPattern = p; pushProject(true); $('#patSelect').value = p; },
  settings: () => (S && S.settings) || {},
  patchSettings: (p) => api.patchState({ settings: p }),
  aspect: () => fxAspect(),
  fx: () => project && project.fx,
  // the phone's Control tab drives the same effects the desktop panel does
  deck: () => deckState(),
  catalog: () => deckCatalog(),
  control: (op, a) => remoteControl(op, a),
});

// A compact snapshot of everything the phone deck can control.
function deckState() {
  const fx = ensureFx(project);
  const t = (S && S.transport) || {};
  return {
    transport: {
      playing: !!t.playing, title: (t.source && t.source.title) || '',
      has: !!(t.source), muted: !!t.muted, volume: t.volume == null ? 1 : t.volume,
    },
    fx: {
      enabled: !!fx.enabled,
      quality: fx.quality || 'high',
      gravity: fx.gravity == null ? 1.2 : fx.gravity,
      wind: fx.windX || 0,
      timeScale: fx.timeScale == null ? 1 : fx.timeScale,
      layers: (fx.layers || []).map((L) => {
        const s = FX_REGISTRY.get(L.type) || {};
        return {
          id: L.id, type: L.type, name: L.name || s.label || L.type,
          opacity: L.opacity == null ? 1 : L.opacity, on: L.enabled !== false,
          show: { projector: !L.show || L.show.projector !== false, tv: !L.show || L.show.tv !== false },
          palette: L.palette || 'fixed',
          params: s.params ? withDefaults(s, L.params) : {},
          actions: (s.actions || []).map((x) => ({ name: x.name, label: x.label })),
        };
      }),
    },
    blackout: !!project.global.blackout,
    outputs: {
      projector: !!(S && S.outputs && S.outputs.projector.enabled),
      tv: !!(S && S.outputs && S.outputs.tv.enabled),
      tvFx: !!(S && S.outputs && S.outputs.tv.fx !== false),
      projectorLabel: (S && S.outputs && S.outputs.projector.displayLabel) || null,
      tvLabel: (S && S.outputs && S.outputs.tv.displayLabel) || null,
    },
    audio: {
      target: (S && S.settings && S.settings.audioTarget) || 'auto',
      out: (S && S.audioOut) || 'control',
      sinkId: (S && S.settings && S.settings.audioSinkId) || '',
      sinkLabel: (S && S.settings && S.settings.audioSinkLabel) || 'System default',
      devices: audioDevices,
    },
    queue: queueState(),
  };
}

// The now-playing item plus a window of what's coming up, for the phone queue.
function queueState() {
  const pl = (S && S.playlist) || { items: [], index: -1 };
  const idx = pl.index;
  const items = pl.items.map((it, i) => ({
    i, title: it.title || '', artist: it.artist || null,
    from: it.from || (it.kind === 'file' ? 'file' : it.kind === 'library' ? 'library' : 'stream'),
    cur: i === idx, discovered: !!it.discovered,
  }));
  // keep the payload small: current item and the next 30
  const start = Math.max(0, idx);
  return { index: idx, total: pl.items.length, name: pl.name || null, autoDiscover: !!pl.autoDiscover,
    items: items.slice(start, start + 31) };
}

// The static menus (effect types, scene names, qualities), sent once on hello.
let DECK_CATALOG = null;
function deckCatalog() {
  if (DECK_CATALOG) return DECK_CATALOG;
  const effects = [...FX_REGISTRY.values()]
    .map((s) => ({
      type: s.type, label: s.label || s.type, group: s.group || 'Other', hint: s.hint || '',
      // the parameter schema, so the phone can build sliders for a layer
      params: (s.params || []).map((p) => ({ key: p.key, label: p.label, type: p.type, def: p.def, min: p.min, max: p.max, step: p.step, options: p.options })),
    }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  DECK_CATALOG = {
    effects,
    scenes: SCENES.map((s) => s.name),
    qualities: [...QUALITY_KEYS],
    palettes: PALETTE_MODES,
  };
  return DECK_CATALOG;
}

// Apply one control intent from a phone against the live project.
function remoteControl(op, a = {}) {
  const fx = ensureFx(project);
  const layer = (id) => (fx.layers || []).find((L) => L.id === id);
  switch (op) {
    case 'transport': api.cmd(a.cmd, a.arg); return;
    case 'fxEnabled': fx.enabled = !!a.on; pushProject(true); buildInspector(); return;
    case 'triggerAll':
      if (fx.enabled) for (const L of fx.layers || []) {
        const s = FX_REGISTRY.get(L.type);
        if (s && s.actions && s.actions[0]) fxAction(L.id, s.actions[0].name);
      }
      return;
    case 'triggerLayer': {
      const L = layer(a.id); if (!L) return;
      const s = FX_REGISTRY.get(L.type);
      if (s && s.actions && s.actions[0]) fxAction(L.id, s.actions[0].name);
      return;
    }
    case 'layerAction': if (layer(a.id)) fxAction(a.id, a.name); return;
    case 'layerOpacity': { const L = layer(a.id); if (L) { L.opacity = Math.max(0, Math.min(1, a.value)); pushProject(); } return; }
    case 'layerOn': { const L = layer(a.id); if (L) { L.enabled = !!a.on; pushProject(true); buildInspector(); } return; }
    case 'layerPalette': { const L = layer(a.id); if (L && PALETTE_MODES.some((m) => m[0] === a.value)) { L.palette = a.value; pushProject(true); buildInspector(); } return; }
    case 'removeLayer': fx.layers = (fx.layers || []).filter((L) => L.id !== a.id); pushProject(true); buildInspector(); return;
    case 'addLayer':
      if (!FX_REGISTRY.get(a.type)) return;
      fx.layers = fx.layers || []; fx.layers.push(defaultFxLayer(a.type)); fx.enabled = true;
      pushProject(true); buildInspector(); return;
    case 'scene': {
      const s = SCENES.find((x) => x.name === a.name); if (!s) return;
      applyScene(fx, s); pushProject(true); buildInspector(); toast(s.note || s.name, 1500); return;
    }
    case 'clearLayers': fx.layers = []; pushProject(true); buildInspector(); return;
    case 'world':
      if (a.key === 'gravity') fx.gravity = a.value;
      else if (a.key === 'wind') fx.windX = a.value;
      else if (a.key === 'timeScale') fx.timeScale = a.value;
      pushProject(); return;
    case 'quality': if (QUALITY_KEYS.includes(a.value)) { fx.quality = a.value; pushProject(true); buildInspector(); } return;
    case 'blackout': project.global.blackout = !project.global.blackout; pushProject(true); return;

    // --- transport / queue / outputs / audio, for the phone ---
    case 'output': api.setOutput(a.role, { enabled: !!a.enabled }); return;
    case 'tvFx': api.setOutput('tv', { fx: !!a.on }); return;
    case 'layerShow': { const L = layer(a.id); if (L) { (L.show || (L.show = { projector: true, tv: true }))[a.wall] = !!a.on; pushProject(true); buildInspector(); } return; }
    case 'layerParam': {
      const L = layer(a.id); if (!L) return;
      const spec = FX_REGISTRY.get(L.type); const P = spec && (spec.params || []).find((q) => q.key === a.key);
      if (!P) return;
      let v = a.value;
      if (P.type === 'range') v = Math.max(P.min, Math.min(P.max, Number(v)));
      else if (P.type === 'bool') v = !!v;
      else if (P.type === 'select') { if (!P.options.some((o) => o[0] === v)) return; }
      (L.params || (L.params = {}))[a.key] = v;
      pushProject(true);
      return;
    }
    case 'playIndex': api.cmd('load', a.index); return;
    case 'removeIndex': {
      const items = S.playlist.items.slice(); if (a.index < 0 || a.index >= items.length) return;
      items.splice(a.index, 1);
      api.setPlaylist(items, S.playlist.index > a.index ? S.playlist.index - 1 : S.playlist.index);
      return;
    }
    case 'addUrl': if (a.url) api.addUrl(a.url).then((r) => toast('Queued ' + ((r && r.count) || 1) + ' from YouTube')).catch((e) => toast('Could not add: ' + e.message)); return;
    case 'addLibrary': api.libraryPlay([a.id], { play: !!a.play }); return;
    case 'addLibraryToLibrary': if (a.url) api.libraryAdd([a.url], {}); return;
    case 'audioTarget': api.patchState({ settings: { audioTarget: a.value } }); return;
    case 'audioSink': {
      const d = audioDevices.find((x) => x.id === a.id);
      api.patchState({ settings: { audioSinkId: a.id || null, audioSinkLabel: d ? d.label : (a.id ? a.label : null) } });
      return;
    }
    case 'autoDiscover': api.setAutoDiscover(!!a.on); syncPlaylistTools(); return;
    case 'libSub': remote.setLibrarySub(true); remote.sendLibrary(libraryView.items); return;
  }
}

// --------------------------------------------------------------- library ----
const libraryView = new LibraryView($('#libraryView'), {
  toast,
  play: (ids, opts) => api.libraryPlay(ids, opts),
  toggleDiscover: () => toggleDiscover(),
});
api.library().then((items) => libraryView.setItems(items));
api.onLibrary((items) => { libraryView.setItems(items); remote.sendLibrary(items); });
api.onLibraryProgress(({ id, progress }) => libraryView.setProgress(id, progress));
api.onLibraryToast((m) => toast(m));
for (const b of document.querySelectorAll('#rail .railBtn')) b.onclick = () => showView(b.dataset.view);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && currentView === 'library' && libraryView.editing) return;   // editor handles its own Esc
});
// the Library "Close" button now goes back to the Playlist view
libraryView.hooks.onClose = () => showView('playlist');

function toggleDiscover() {
  const on = !(S && S.playlist && S.playlist.autoDiscover);
  api.setAutoDiscover(on);
  syncPlaylistTools();
  toast(on ? 'Auto-discover on — related videos will keep the show going' : 'Auto-discover off', 1800);
}

// saved playlists
async function refreshPlaylists() {
  const { items, current } = await api.playlistsList();
  const sel = $('#plLoad');
  sel.innerHTML = '<option value="">Playlists…</option>';
  for (const pl of items) sel.appendChild(el('option', { value: pl.name, text: `${pl.name} (${pl.count})` }));
  if (current) sel.value = current;
}
$('#plSave').onclick = async () => {
  const name = await promptModal('Name this playlist');
  if (!name) return;
  await api.playlistsSave(name);
  await refreshPlaylists();
  toast('Saved playlist ' + name);
};
$('#plLoad').onchange = async (e) => {
  const name = e.target.value;
  if (!name) return;
  const n = await api.playlistsLoad(name);
  toast('Loaded ' + name + ' (' + n + ')');
};
$('#plDiscover input').onchange = () => toggleDiscover();
function syncPlaylistTools() {
  const on = !!(S && S.playlist && S.playlist.autoDiscover);
  $('#plDiscover input').checked = on;
  libraryView.setDiscover(on);
}
refreshPlaylists();

// -------------------------------------------------------------- transport ---
$('#tPlay').onclick = () => api.cmd('toggle');
$('#tNext').onclick = () => api.cmd('next');
$('#tPrev').onclick = () => api.cmd('prev');
const REPEAT_ORDER = ['all', 'one', 'off'];
$('#tRepeat').onclick = () => {
  const cur = S.transport.repeat || 'all';
  const next = REPEAT_ORDER[(REPEAT_ORDER.indexOf(cur) + 1) % REPEAT_ORDER.length];
  api.cmd('repeat', next);
  toast({ all: 'Repeat playlist', one: 'Repeat one', off: 'Repeat off' }[next], 1400);
};
$('#tShuffle').onclick = () => api.cmd('shuffle', !S.playlist.shuffle);
$('#tMute').onclick = () => api.cmd('muted', !S.transport.muted);
$('#tVol').oninput = (e) => api.cmd('volume', e.target.value / 100);
$('#tRate').onchange = (e) => api.cmd('rate', Number(e.target.value));
$('#scrub').addEventListener('pointerdown', () => (scrubbing = true));
$('#scrub').addEventListener('pointerup', () => (scrubbing = false));
$('#scrub').oninput = (e) => {
  const d = S.transport.duration || 0;
  if (d) api.cmd('seek', (e.target.value / 1000) * d);
};
$('#gBlack input').onchange = () => { project.global.blackout = !project.global.blackout; pushProject(true); syncTopSideButtons(); };
$('#oProj input').onchange = () => toggleOutput('projector').then(syncTopSideButtons);
$('#oTv input').onchange = () => toggleOutput('tv').then(syncTopSideButtons);

async function toggleOutput(role) {
  const cur = S.outputs[role];
  if (!cur.displayId) return toast('Assign a display to ' + role + ' first (right panel)');
  await api.setOutput(role, { enabled: !cur.enabled });
}

// --------------------------------------------------------------- playlist ---
$('#addFiles').onclick = () => api.addFiles();
$('#addUrl').onclick = async () => {
  const url = await promptModal('YouTube video, playlist or channel URL');
  if (!url) return;
  toast('Reading URL… playlists and channels can take a moment', 60000);
  try {
    const r = await api.addUrl(url.trim());
    toast(r.playlist
      ? `Added ${r.count} videos from "${r.playlist}"` + (r.truncated ? ' (capped at 500)' : '')
      : 'Added 1 video');
  } catch (e) { toast('Could not read that URL: ' + e.message, 7000); }
};
$('#plClear').onclick = () => { api.patchState({ playlist: { name: null } }); api.setPlaylist([], -1); };

let plKey = '';
function renderPlaylist(force) {
  const items = S.playlist.items;
  const key = items.length + '|' + S.playlist.index + '|' + (S.playlist.name || '') + '|' +
    items.map((i) => i.id).join(',');
  if (key === plKey && !force) return;
  plKey = key;

  const info = $('#plInfo');
  if (S.playlist.name && items.length > 1) {
    info.textContent = S.playlist.name + '  \u00b7  ' + items.length + ' videos';
    info.classList.add('on');
  } else info.classList.remove('on');

  const list = $('#pl');
  $('#plEmpty').style.display = items.length ? 'none' : 'block';
  list.innerHTML = '';
  let curRow = null;
  items.forEach((it, i) => {
    const cur = i === S.playlist.index;
    const row = el('div', { class: 'pit' + (cur ? ' cur' : '') + (it.error ? ' err' : '') }, [
      el('span', { class: 'n', text: String(i + 1) }),
      el('span', {
        class: 't', text: it.title,
        title: (it.uploader ? it.uploader + ' \u2014 ' : '') + it.title + (it.error ? '\n' + it.error : ''),
      }),
      it.duration ? el('span', { class: 'd', text: fmtTime(it.duration) }) : null,
      el('span', { class: 'k ' + (it.from || it.kind), text: sourceBadge(it) }),
      el('span', {
        class: 'x', text: '\u2715', title: 'Remove', onclick: (e) => {
          e.stopPropagation();
          const next = items.slice();
          next.splice(i, 1);
          api.setPlaylist(next, S.playlist.index > i ? S.playlist.index - 1 : S.playlist.index);
        },
      }),
    ]);
    row.onclick = () => api.cmd('load', i);
    if (cur) curRow = row;
    list.appendChild(row);
  });
  if (curRow) curRow.scrollIntoView({ block: 'nearest' });
}

// ------------------------------------------------------------------ tools ---
document.querySelectorAll('[data-tool]').forEach((b) => {
  b.onclick = () => {
    stage.setTool(b.dataset.tool);
    document.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x === b));
  };
});
document.querySelector('[data-tool=select]').classList.add('on');

$('#handlesBtn input').onchange = (e) => { stage.showHandles = e.target.checked; stage.draw(); };
$('#guidesBtn input').onchange = (e) => { project.global.showGuides = e.target.checked; pushProject(true); };
$('#patSelect').onchange = (e) => { project.global.testPattern = e.target.value; pushProject(true); };
$('#fitBtn').onclick = () => stage.resetView();
$('#dupBtn').onclick = duplicateSelected;
$('#delBtn').onclick = deleteSelected;
$('#shotBtn').onclick = async () => {
  const f = await api.captureOutput('projector');
  if (f) { toast('Captured ' + f); api.reveal(f); } else toast('Projector output is not open');
};

function duplicateSelected() {
  const o = stage.selected();
  if (!o) return toast('Nothing selected');
  const copy = JSON.parse(JSON.stringify(o));
  copy.id = uid(stage.sel.type === 'surface' ? 'surf' : 'mask');
  copy.name = o.name + ' copy';
  const shift = (pts) => pts.forEach((q) => { q[0] += 0.02; q[1] += 0.02; });
  if (stage.sel.type === 'surface') { shift(copy.mesh.pts); project.surfaces.push(copy); }
  else { shift(copy.points); project.masks.push(copy); }
  stage.select(stage.sel.type, copy.id);
  pushProject(true);
}

function deleteSelected() {
  const o = stage.selected();
  if (!o) return;
  const list = stage.sel.type === 'surface' ? project.surfaces : project.masks;
  const i = list.findIndex((z) => z.id === o.id);
  if (i >= 0) list.splice(i, 1);
  stage.select(null, null);
  pushProject(true);
}

// -------------------------------------------------------------- inspector ---
const updaters = [];
// things that need to move every frame rather than on commit (audio meters)
const frameUpdaters = [];
const openSections = new Set(['Output', 'Wall setups', 'Layers', 'Selection', 'Effects', 'Look', 'Presets']);

function section(title, kids) {
  const body = el('div', { class: 'body' }, kids);
  const head = el('h3', {}, [el('span', { class: 'chev', text: '▾' }), el('span', { text: title })]);
  const s = el('div', { class: 'sec' + (openSections.has(title) ? '' : ' closed') }, [head, body]);
  head.onclick = () => {
    const closed = s.classList.toggle('closed');
    closed ? openSections.delete(title) : openSections.add(title);
    s.querySelector('.chev').textContent = closed ? '▸' : '▾';
  };
  if (!openSections.has(title)) s.querySelector('.chev').textContent = '▸';
  return s;
}

function slider(label, get, set, { min = 0, max = 1, step = 0.01, fmt } = {}) {
  const inp = el('input', { type: 'range', min, max, step });
  const val = el('span', { class: 'val' });
  const show = () => {
    inp.value = get();
    val.textContent = fmt ? fmt(get()) : Number(get()).toFixed(step < 0.1 ? 2 : 0);
  };
  inp.oninput = () => { set(Number(inp.value)); show(); pushProject(); };
  inp.ondblclick = () => { };
  updaters.push(show); show();
  return el('div', { class: 'ctl' }, [el('label', { text: label }), inp, val]);
}

function numberRow(label, get, set, { step = 0.001, min, max } = {}) {
  const inp = el('input', { type: 'number', step, min, max });
  const show = () => { if (document.activeElement !== inp) inp.value = round(get(), 4); };
  inp.onchange = () => { set(Number(inp.value)); pushProject(true); };
  updaters.push(show); show();
  return el('div', { class: 'ctl wide' }, [el('label', { text: label }), inp]);
}

// A boolean is a switch. `opts.push === false` for settings that live outside
// the project (outputs, app settings) and are pushed by their own setter.
function toggle(label, get, set, opts = {}) {
  const inp = el('input', { type: 'checkbox' });
  const lab = el('label', { class: 'tog' + (opts.danger ? ' danger' : '') + (opts.grow ? ' grow' : ''), title: opts.title || null },
    [inp, el('span', { class: 'sw' }), el('span', { class: 'tl', text: label })]);
  const show = () => { inp.checked = !!get(); };
  inp.onchange = () => { set(inp.checked); if (opts.push !== false) pushProject(true); show(); };
  updaters.push(show); show();
  return lab;
}

function textRow(label, get, set) {
  const inp = el('input', { type: 'text' });
  const show = () => { if (document.activeElement !== inp) inp.value = get() || ''; };
  inp.oninput = () => { set(inp.value); pushProject(); };
  updaters.push(show); show();
  return el('div', { class: 'ctl wide' }, [el('label', { text: label }), inp]);
}

function colorRow(label, get, set) {
  const inp = el('input', { type: 'color' });
  const show = () => { if (document.activeElement !== inp) inp.value = get() || '#ffffff'; };
  inp.oninput = () => { set(inp.value); pushProject(); };
  updaters.push(show); show();
  return el('div', { class: 'ctl wide' }, [el('label', { text: label }), inp]);
}

function selectRow(label, options, get, set) {
  const sel = el('select', {});
  for (const [v, t] of options) sel.appendChild(el('option', { value: v, text: t }));
  const show = () => { sel.value = String(get()); };
  sel.onchange = () => { set(sel.value); };
  updaters.push(show); show();
  return el('div', { class: 'ctl wide' }, [el('label', { text: label }), sel]);
}

const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;

// what the source-region widget should show: the calibration pattern when one
// is up, otherwise the live video frame
const previewSource = () => (patternKind !== 'off' && patternCanvas ? patternCanvas : player.video);
const sourceReady = (el) => !!el && !!(el.videoWidth || el.width);

// The inspector is split across views: mapping (Map), effects (Effects),
// outputs/setup (Setup). All sections are (re)built here so their live
// updaters keep working regardless of which view is showing; only the stage
// element moves and views hide via CSS.
function buildInspector() {
  updaters.length = 0;
  frameUpdaters.length = 0;
  const hosts = { fx: $('#fxHost'), look: $('#lookHost'), mapInspector: $('#stageInspector'), out: $('#outHost') };
  const scroll = {};
  for (const k in hosts) if (hosts[k]) scroll[k] = hosts[k].scrollTop;

  hosts.mapInspector.innerHTML = '';
  hosts.mapInspector.appendChild(layersSection());
  hosts.mapInspector.appendChild(selectionSection());

  hosts.fx.innerHTML = '';
  hosts.fx.appendChild(fxSection());

  const browser = $('#fxBrowser');
  if (browser && !browser.firstChild) browser.appendChild(buildFxBrowser(fxUi()));
  else if (browser) buildFxBrowser(fxUi());      // refresh the badges

  hosts.look.innerHTML = '';
  for (const sec of buildFxWorldSections(fxUi())) hosts.look.appendChild(sec);
  hosts.look.appendChild(lookSection());

  hosts.out.innerHTML = '';
  hosts.out.appendChild(outputSection());
  hosts.out.appendChild(mappingSection());
  hosts.out.appendChild(presetSection());
  hosts.out.appendChild(helpSection());

  // restore scroll so touching a layer doesn't jump the panel to the top
  for (const k in hosts) if (hosts[k]) hosts[k].scrollTop = Math.min(scroll[k] || 0, Math.max(0, hosts[k].scrollHeight - hosts[k].clientHeight));
}

// --- view switching + moving the single stage between views ---
let currentView = 'stage';
function showView(name) {
  currentView = name;
  if (previewShrink) previewShrink();
  for (const b of document.querySelectorAll('#rail .railBtn')) b.classList.toggle('on', b.dataset.view === name);
  for (const v of document.querySelectorAll('#main .view')) v.hidden = v.id !== 'v' + name[0].toUpperCase() + name.slice(1);
  const view = $('#v' + name[0].toUpperCase() + name.slice(1));
  const stageEl = $('#stage');
  const slot = view && view.querySelector('.stageSlot');
  if (slot) { stageEl.classList.toggle('docked', name !== 'stage'); slot.appendChild(stageEl); }
  else { stageEl.classList.add('docked'); $('#stagePark').appendChild(stageEl); }
  if (name === 'library') libraryView.show(); else libraryView.hide();
  // the stage changed size — relayout on the next frame
  requestAnimationFrame(() => { stage.layout(); stage.draw && stage.draw(); });
}

function fxSection() { ensureFx(project); return buildFxSection(fxUi()); }

function fxUi() {
  return ({
    el, section, slider, toggle, selectRow, numberRow, colorRow, textRow, updaters,
    project: () => project,
    push: (commit) => pushProject(commit),
    rebuild: () => buildInspector(),
    toast,
    selectedLayer: () => fxLayerSel,
    selectLayer: (id) => { fxLayerSel = id; },
    sendAction: (id, name, arg) => fxAction(id, name, arg),
    stats: () => fxHost.stats(),
    cameraReady: () => !!(camera.live && camera.homography),
    phoneState: () => ({ running: remote.info.running, ready: remote.ready, live: remote.tracker.live, people: phonePeople }),
    audio: () => fxHost.features(),
    onFrame: (fn) => frameUpdaters.push(fn),
    // register an updater and run it now, so nothing shows blank until the
    // next commit happens to refresh the panel
    live: (fn) => { updaters.push(fn); try { fn(); } catch {} },
    motionBlobs: () => motionActive,
  });
}

function syncInspector() {
  for (const f of updaters) { try { f(); } catch {} }
}

function outputSection() {
  const rows = [];
  for (const role of ['projector', 'tv']) {
    const cfg = S.outputs[role];
    const sel = el('select', {});
    sel.appendChild(el('option', { value: '', text: '— none —' }));
    for (const d of displays) {
      sel.appendChild(el('option', {
        value: d.id,
        text: `${d.label} ${d.size.width}x${d.size.height}${d.isPrimary ? ' (main)' : ''}`,
      }));
    }
    sel.value = cfg.displayId || '';
    sel.onchange = () => api.setOutput(role, { displayId: sel.value || null });
    const on = toggle('On', () => S.outputs[role].enabled, () => toggleOutput(role), { push: false });
    rows.push(el('div', { class: 'ctl wide' }, [
      el('label', { text: role === 'projector' ? 'Projector' : 'TV' }),
      el('div', { class: 'row nowrap' }, [sel, on]),
    ]));
    if (role === 'tv') {
      rows.push(selectRow('TV shows', [['fill', 'Full video (fit)'], ['mapped', 'Same as projector']],
        () => S.outputs.tv.mode, (v) => api.setOutput('tv', { mode: v })));
      rows.push(selectRow('Fit', [['contain', 'Contain (letterbox)'], ['cover', 'Cover (crop)'], ['stretch', 'Stretch']],
        () => S.settings.fitMode, (v) => api.patchState({ settings: { fitMode: v } })));
      rows.push(el('div', { class: 'row' }, [
        toggle('Effects on the TV', () => S.outputs.tv.fx !== false, (v) => api.setOutput('tv', { fx: v }), { push: false }),
      ]));
      rows.push(el('div', { class: 'hint', text: 'The TV is a second wall: it plays the same video, plain and full-screen, and the effects run over it too. Each effect layer chooses which walls it shows on (Effects view). The TV has no masked shapes, only the edges of its frame.' }));
    rows.push(selectRow('Preview quality',
      [['auto', 'Small while an output is open'], ['low', 'Always small'], ['full', 'Always full size']],
      () => S.settings.previewQuality || 'auto', (v) => api.patchState({ settings: { previewQuality: v } })));
    rows.push(el('div', { class: 'hint', text: 'The control preview pulls its own copy of the video. Keeping it small leaves the bandwidth for the projector.' }));
    }
  }
  const pd = S.outputs.projector.displayId, td = S.outputs.tv.displayId;
  if (pd && td && pd === td) {
    rows.push(el('div', { class: 'hint', style: 'color:var(--mask)',
      text: 'Projector and TV are both set to the same screen, so one covers the other. Pick different screens, or swap them.' }));
  }
  if (displays.length > 1) {
    rows.push(el('div', { class: 'row' }, [
      el('button', {
        class: 'btn sm grow', text: 'Swap the two screens',
        title: 'Send the projector to the TV\u2019s screen and vice versa',
        onclick: () => api.swapOutputs().then(() => toast('Swapped')),
      }),
    ]));
  }
  rows.push(selectRow('Audio from',
    [['auto', 'Auto (first open output)'], ['tv', 'TV'], ['projector', 'Projector'],
     ['control', 'This window'], ['none', 'Muted']],
    () => S.settings.audioTarget || 'auto', (v) => api.patchState({ settings: { audioTarget: v } })));
  rows.push(el('div', { class: 'hint', text: 'Playing audio from: ' + (S.audioOut || 'control') +
    (S.settings.audioTarget !== 'auto' && S.settings.audioTarget !== S.audioOut && S.settings.audioTarget !== 'none'
      ? '  (the ' + S.settings.audioTarget + ' window is not open)' : '') }));
  rows.push(selectRow('Output device',
    [['', 'System default'], ...audioDevices.map((d) => [d.id, d.label])],
    () => S.settings.audioSinkId || '',
    (v) => { const d = audioDevices.find((x) => x.id === v); api.patchState({ settings: { audioSinkId: v || null, audioSinkLabel: d ? d.label : null } }); }));
  rows.push(el('div', { class: 'hint', text: 'Send the sound to a specific output (e.g. an AirPlay receiver) without changing the Mac’s system default.' }));
  rows.push(selectRow('YouTube max', [['720', '720p'], ['1080', '1080p'], ['1440', '1440p'], ['2160', '4K']],
    () => S.settings.maxHeight || 1080, (v) => api.patchState({ settings: { maxHeight: Number(v) } })));
  rows.push(el('div', { class: 'row' }, [
    el('button', {
      class: 'btn grow', text: 'Identify outputs',
      title: 'Flash the role and the screen name on each output window',
      onclick: () => { api.identifyOutputs(); toast('Each open output names itself and its screen for a moment.'); },
    }),
    el('button', { class: 'btn', text: 'Reload', onclick: () => api.reloadAll() }),
  ]));
  rows.push(el('button', { class: 'btn', text: 'Close all outputs  (Cmd+Alt+P)', onclick: () => api.closeAllOutputs() }));
  rows.push(el('div', { class: 'hint', text: 'Output windows open without taking focus. Esc on an output window, or Cmd+Alt+P from anywhere, closes them.' }));
  return section('Output', rows);
}

// Named wall setups: save the geometry you spent an evening aligning, and get
// it back by name. The live state is restored automatically anyway; this is
// for keeping more than one of them.
function mappingSection() {
  const rows = [];
  const cur = mappings.current;
  const head = el('div', { class: 'hint' });
  const showHead = () => {
    const name = S && S.mappingName;
    head.innerHTML = '';
    head.appendChild(el('span', { text: name ? 'Loaded: ' : 'Not saved under a name yet' }));
    if (name) head.appendChild(el('b', { text: name }));
    if (S && S.dirty) head.appendChild(el('span', { class: 'tag', text: 'unsaved changes' }));
  };
  updaters.push(showHead); showHead();
  rows.push(head);

  const sel = el('select', {});
  sel.appendChild(el('option', { value: '', text: mappings.items.length ? '— load a saved setup —' : '— nothing saved yet —' }));
  for (const m of mappings.items) {
    sel.appendChild(el('option', { value: m.name, text: m.name + (m.name === cur ? '  (current)' : '') }));
  }
  sel.value = '';
  sel.onchange = () => {
    const n = sel.value;
    if (!n) return;
    api.loadMapping(n)
      .then(() => { stage.select(null, null); refreshMappings(); toast('Loaded ' + n); })
      .catch((e) => toast('Could not load: ' + e.message));
  };
  rows.push(el('div', { class: 'ctl wide' }, [el('label', { text: 'Setups' }), sel]));

  const name = el('input', { type: 'text', id: 'mapName', placeholder: 'Name this wall setup' });
  name.value = mappingName || cur || '';
  name.oninput = () => { mappingName = name.value; };
  name.onkeydown = (e) => { if (e.key === 'Enter') save(); };
  const save = () => {
    const n = (name.value || '').trim();
    if (!n) { toast('Give the setup a name first'); name.focus(); return; }
    api.saveMapping(n).then((saved) => { mappingName = saved; refreshMappings(); toast('Saved ' + saved); });
  };
  rows.push(el('div', { class: 'ctl wide' }, [el('label', { text: 'Name' }), name]));
  rows.push(el('div', { class: 'row' }, [
    el('button', { class: 'btn grow', text: 'Save', title: 'Save the current walls, masks and effects under this name', onclick: save }),
    el('button', {
      class: 'btn danger', text: 'Delete', disabled: !cur ? '' : null,
      onclick: () => {
        if (!cur) return;
        api.deleteMapping(cur).then(() => { mappingName = ''; refreshMappings(); toast('Deleted ' + cur); });
      },
    }),
    el('button', { class: 'btn', text: '\u2026', title: 'Show the files in Finder', onclick: () => api.revealMappings() }),
  ]));
  rows.push(el('div', { class: 'hint', text: 'Whatever you last had on screen comes back by itself when you reopen the app — these named setups are for keeping several walls and switching between them.' }));
  return section('Wall setups', rows);
}

function selectionSection() {
  const o = stage.selected();
  if (!o) {
    return section('Selection', [el('div', {
      class: 'hint',
      text: 'Nothing selected. Click an area or mask in the stage, or use + Area / + Mask to draw one.',
    })]);
  }
  const isSurf = stage.sel.type === 'surface';
  const rows = [textRow('Name', () => o.name, (v) => (o.name = v))];
  rows.push(el('div', { class: 'row' }, [
    toggle('Enabled', () => o.enabled, (v) => (o.enabled = v)),
    el('button', { class: 'btn', text: 'Duplicate', onclick: duplicateSelected }),
    el('button', { class: 'btn danger', text: 'Delete', onclick: deleteSelected }),
  ]));

  if (isSurf) {
    rows.push(el('div', { class: 'hint', text: 'Source region — which part of the video lands on this area.' }));
    rows.push(srcMapWidget(o));
    rows.push(el('div', { class: 'quad' }, [
      numberRow('x', () => o.src.x, (v) => (o.src.x = v)),
      numberRow('y', () => o.src.y, (v) => (o.src.y = v)),
      numberRow('w', () => o.src.w, (v) => (o.src.w = v)),
      numberRow('h', () => o.src.h, (v) => (o.src.h = v)),
    ]));
    rows.push(el('div', { class: 'row' }, ['Full', 'Left', 'Right', 'Top', 'Bottom'].map((k) =>
      el('button', {
        class: 'btn sm grow', text: k, onclick: () => {
          const r = { Full: [0, 0, 1, 1], Left: [0, 0, 0.5, 1], Right: [0.5, 0, 0.5, 1], Top: [0, 0, 1, 0.5], Bottom: [0, 0.5, 1, 0.5] }[k];
          o.src = { x: r[0], y: r[1], w: r[2], h: r[3] };
          pushProject(true);
        },
      }))));

    rows.push(el('div', { class: 'hint', text: 'Warp mesh — raise for curved or uneven walls.' }));
    const meshRow = el('div', { class: 'row' }, [
      el('label', { class: 'grow hint', text: `Grid ${o.mesh.cols} x ${o.mesh.rows}` }),
      el('button', { class: 'btn icon', text: '−', onclick: () => setMesh(o, -1) }),
      el('button', { class: 'btn icon', text: '+', onclick: () => setMesh(o, 1) }),
      el('button', { class: 'btn', text: 'Flat', onclick: () => setMesh(o, 0) }),
    ]);
    rows.push(meshRow);
    rows.push(el('div', { class: 'row' }, [
      el('button', { class: 'btn grow', text: 'Fill output', onclick: () => { o.mesh = { cols: 1, rows: 1, pts: [[0, 0], [1, 0], [0, 1], [1, 1]] }; pushProject(true); } }),
      el('button', { class: 'btn grow', text: 'Keep aspect', onclick: () => fitAspect(o) }),
    ]));

    rows.push(el('div', { class: 'hint', text: 'Edge blend — soften edges to hide the seam between two walls.' }));
    rows.push(slider('Left', () => o.feather.l, (v) => (o.feather.l = v), { max: 0.5, fmt: pc }));
    rows.push(slider('Right', () => o.feather.r, (v) => (o.feather.r = v), { max: 0.5, fmt: pc }));
    rows.push(slider('Top', () => o.feather.t, (v) => (o.feather.t = v), { max: 0.5, fmt: pc }));
    rows.push(slider('Bottom', () => o.feather.b, (v) => (o.feather.b = v), { max: 0.5, fmt: pc }));

    rows.push(el('div', { class: 'row' }, [
      toggle('Flip H', () => o.fx.flipH, (v) => (o.fx.flipH = v)),
      toggle('Flip V', () => o.fx.flipV, (v) => (o.fx.flipV = v)),
      el('button', {
        class: 'btn sm', text: 'Rotate 90', onclick: () => { o.fx.rot = ((o.fx.rot | 0) + 1) % 4; pushProject(true); },
      }),
    ]));
    rows.push(el('div', { class: 'hint', text: 'Colour - match brightness between walls.' }));
    rows.push(slider('Opacity', () => o.fx.opacity, (v) => (o.fx.opacity = v), { max: 1, fmt: pc }));
    rows.push(slider('Brightness', () => o.fx.brightness, (v) => (o.fx.brightness = v), { min: -0.5, max: 0.5 }));
    rows.push(slider('Contrast', () => o.fx.contrast, (v) => (o.fx.contrast = v), { min: 0.2, max: 2.5 }));
    rows.push(slider('Saturation', () => o.fx.saturation, (v) => (o.fx.saturation = v), { min: 0, max: 3 }));
    rows.push(slider('Gamma', () => o.fx.gamma, (v) => (o.fx.gamma = v), { min: 0.3, max: 3 }));
    rows.push(slider('Hue', () => o.fx.hue, (v) => (o.fx.hue = v), { min: -3.14, max: 3.14 }));
  } else {
    rows.push(el('div', { class: 'row' }, [
      toggle('Show only inside (invert)', () => o.invert, (v) => (o.invert = v)),
      toggle('Effects see this shape', () => o.fxCollide !== false, (v) => { o.fxCollide = v; pushProject(true); }),
    ]));
    rows.push(el('div', { class: 'hint', text: 'Shapes the effects can see are solid for balls and water, and are what the Shapes effects (shadows, blocks, aura) act on.' }));
    rows.push(slider('Softness', () => o.feather, (v) => (o.feather = v), { min: 0, max: 120, step: 1, fmt: (v) => v + 'px' }));
    rows.push(slider('Grow', () => o.grow, (v) => (o.grow = v), { min: -60, max: 60, step: 1, fmt: (v) => v + 'px' }));
    rows.push(slider('Strength', () => o.opacity, (v) => (o.opacity = v), { max: 1, fmt: pc }));
    rows.push(el('div', { class: 'hint', text: `${o.points.length} points — double-click an edge to add one, Backspace on a point to remove it.` }));
  }
  return section('Selection', rows);
}

const pc = (v) => Math.round(v * 100) + '%';

function setMesh(o, d) {
  let c = o.mesh.cols, r = o.mesh.rows;
  if (d === 0) { c = 1; r = 1; }
  else { c = clamp(c + d, 1, 12); r = clamp(r + d, 1, 12); }
  o.mesh = Mesh.resample(o.mesh, c, r);
  pushProject(true);
  buildInspector();
}

function fitAspect(o) {
  const [ow, oh] = outputSize();
  const [vw, vh] = player.video.videoWidth ? [player.video.videoWidth, player.video.videoHeight] : [16, 9];
  const srcA = (vw * o.src.w) / (vh * o.src.h);
  const c = Mesh.corners(o.mesh);
  const cx = (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4;
  const cy = (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4;
  const wN = Math.max(...c.map((p) => p[0])) - Math.min(...c.map((p) => p[0]));
  const hN = Math.max(...c.map((p) => p[1])) - Math.min(...c.map((p) => p[1]));
  let w = wN, h = (wN * ow) / srcA / oh;
  if (h > hN) { h = hN; w = (hN * oh * srcA) / ow; }
  o.mesh = { cols: 1, rows: 1, pts: [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx - w / 2, cy + h / 2], [cx + w / 2, cy + h / 2]] };
  pushProject(true);
}

// small draggable view of the video frame showing this surface's source region
function srcMapWidget(o) {
  const wrap = el('div', { style: 'position:relative;width:100%;aspect-ratio:16/9;background:#000;border:1px solid var(--line);border-radius:5px;overflow:hidden' });
  const cv = el('canvas', { style: 'position:absolute;inset:0;width:100%;height:100%' });
  wrap.appendChild(cv);
  const draw = () => {
    const r = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr);
    const x = cv.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, r.width, r.height);
    const src = previewSource();
    if (sourceReady(src)) {
      try { x.drawImage(src, 0, 0, r.width, r.height); } catch {}
      x.globalAlpha = 0.55; x.fillStyle = '#000';
      x.fillRect(0, 0, r.width, r.height);
      x.globalAlpha = 1;
      try {
        x.save();
        x.beginPath();
        x.rect(o.src.x * r.width, o.src.y * r.height, o.src.w * r.width, o.src.h * r.height);
        x.clip();
        x.drawImage(src, 0, 0, r.width, r.height);
        x.restore();
      } catch {}
    }
    for (const s of project.surfaces) {
      const cur = s.id === o.id;
      x.strokeStyle = cur ? '#00d4ff' : 'rgba(255,255,255,.25)';
      x.lineWidth = cur ? 2 : 1;
      x.strokeRect(s.src.x * r.width, s.src.y * r.height, s.src.w * r.width, s.src.h * r.height);
    }
    const hx = (o.src.x + o.src.w) * r.width, hy = (o.src.y + o.src.h) * r.height;
    x.fillStyle = '#00d4ff';
    x.fillRect(hx - 4, hy - 4, 8, 8);
  };
  updaters.push(draw);
  requestAnimationFrame(draw);
  srcMapWidget.redraw = draw;

  let mode = null, st = null;
  wrap.addEventListener('pointerdown', (e) => {
    const r = wrap.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
    const nearHandle = Math.hypot(u - (o.src.x + o.src.w), v - (o.src.y + o.src.h)) < 0.05;
    mode = nearHandle ? 'size' : 'move';
    st = { u, v, src: { ...o.src } };
    wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!mode) return;
    const r = wrap.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
    if (mode === 'move') {
      o.src.x = clamp(st.src.x + (u - st.u), 0, 1 - o.src.w);
      o.src.y = clamp(st.src.y + (v - st.v), 0, 1 - o.src.h);
    } else {
      o.src.w = clamp(st.src.w + (u - st.u), 0.02, 1 - o.src.x);
      o.src.h = clamp(st.src.h + (v - st.v), 0.02, 1 - o.src.y);
    }
    pushProject();
    draw();
  });
  wrap.addEventListener('pointerup', () => { mode = null; pushProject(true); });
  return wrap;
}

function layerRow(o, kind, i, list) {
  const on = stage.sel?.id === o.id;
  const chk = el('input', { type: 'checkbox', title: 'Show / hide' });
  chk.checked = !!o.enabled;
  chk.onclick = (e) => e.stopPropagation();
  chk.onchange = () => { o.enabled = chk.checked; pushProject(true); buildInspector(); };
  const row = el('div', { class: 'lay' + (on ? ' on' : '') + (o.enabled ? ' vis' : '') + (kind === 'mask' ? ' mk' : '') }, [
    chk,
    el('span', { class: 'nm', text: (kind === 'surface' ? (i + 1) + '. ' : '') + (o.name || kind), title: o.name }),
    el('span', { class: 'ar', text: '\u25B2', title: 'Move up',
      onclick: (e) => { e.stopPropagation(); if (i > 0) { list.splice(i - 1, 0, list.splice(i, 1)[0]); pushProject(true); buildInspector(); } } }),
    el('span', { class: 'ar', text: '\u25BC', title: 'Move down',
      onclick: (e) => { e.stopPropagation(); if (i < list.length - 1) { list.splice(i + 1, 0, list.splice(i, 1)[0]); pushProject(true); buildInspector(); } } }),
  ]);
  row.onclick = () => { stage.select(kind, o.id); buildInspector(); };
  return row;
}

function layersSection() {
  const rows = [];
  rows.push(el('div', { class: 'hint', text: 'Projection areas (drawn bottom to top)' }));
  if (!project.surfaces.length) rows.push(el('div', { class: 'hint', text: 'none - press + Area' }));
  project.surfaces.forEach((o, i) => rows.push(layerRow(o, 'surface', i, project.surfaces)));
  rows.push(el('div', { class: 'hint', text: 'Blackout masks', style: 'margin-top:6px' }));
  if (!project.masks.length) rows.push(el('div', { class: 'hint', text: 'none - press + Mask or + Shape' }));
  project.masks.forEach((o, i) => rows.push(layerRow(o, 'mask', i, project.masks)));
  rows.push(el('div', { class: 'row', style: 'margin-top:4px' }, [
    el('button', { class: 'btn sm grow', text: 'All masks on', onclick: () => { project.masks.forEach((m) => (m.enabled = true)); pushProject(true); buildInspector(); } }),
    el('button', { class: 'btn sm grow', text: 'All off', onclick: () => { project.masks.forEach((m) => (m.enabled = false)); pushProject(true); buildInspector(); } }),
  ]));
  return section('Layers', rows);
}

function lookSection() {
  const motion = el('div', { class: 'hint' });
  const showMotion = () => {
    const fps = stage.engine.sourceFps;
    const rate = fps ? fps.toFixed(0) + ' fps' : 'unknown';
    const txt = project.global.smoothMotion
      ? `Cross-fading between decoded frames. Source is ${rate}.`
      : `Film at 24 or 25 fps on a 60 Hz projector lands on an uneven 3:2 cadence, which reads as judder on slow pans. Smoothing cross-fades between frames to even it out, at the cost of a little motion blur. Source is ${rate}.`;
    if (motion.textContent !== txt) motion.textContent = txt;
  };
  frameUpdaters.push(showMotion); showMotion();
  return section('Look', [
    slider('Brightness', () => project.global.brightness, (v) => (project.global.brightness = v), { min: 0, max: 1, fmt: pc }),
    el('div', { class: 'row' }, [
      toggle('Blackout', () => project.global.blackout, (v) => (project.global.blackout = v)),
      toggle('Wall guides', () => project.global.showGuides, (v) => (project.global.showGuides = v)),
    ]),
    el('div', { class: 'hint', text: 'Blackout kills the projector output instantly. Wall guides draw the area outlines onto the wall itself.' }),
    el('div', { class: 'row' }, [
      toggle('Smooth motion', () => project.global.smoothMotion, (v) => (project.global.smoothMotion = v)),
    ]),
    motion,
  ]);
}

function presetSection() {
  const two = twoWallControls() || [];
  return section('Presets', [
    ...two,
    el('div', { class: 'hint', text: 'Two-wall setup: splits the video across a main wall and a side wall, each independently warped, with a soft seam.' }),
    el('button', { class: 'btn', text: 'Set up two walls', onclick: twoWallPreset }),
    el('button', { class: 'btn', text: 'One wall, full output', onclick: () => {
      project.surfaces = [defaultSurface({ name: 'Wall', mesh: { cols: 1, rows: 1, pts: [[0, 0], [1, 0], [0, 1], [1, 1]] } })];
      stage.select('surface', project.surfaces[0].id);
      pushProject(true); buildInspector();
    } }),
    el('div', { class: 'hint', text: 'Multiple areas' }),
    el('button', { class: 'btn', text: 'Spread video across all areas', onclick: spreadAcrossAreas }),
    el('button', { class: 'btn', text: 'Same video in every area', onclick: () => {
      project.surfaces.forEach((s) => (s.src = { x: 0, y: 0, w: 1, h: 1 }));
      pushProject(true); buildInspector();
      toast('Every area now shows the whole video.');
    } }),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn grow', text: 'Save mapping', onclick: () => api.saveProject(false).then((p) => p && toast('Saved ' + p)) }),
      el('button', { class: 'btn grow', text: 'Open…', onclick: () => api.openProject() }),
    ]),
  ]);
}

const SEAM_OVERLAP = 0.004;   // hairline overlap so no black line shows at the corner

function twoWallPreset() {
  const split = 0.6;
  const main = defaultSurface({
    name: 'Main wall',
    src: { x: 0, y: 0, w: split, h: 1 },
    mesh: { cols: 1, rows: 1, pts: [[0, 0], [split + SEAM_OVERLAP, 0], [0, 1], [split + SEAM_OVERLAP, 1]] },
  });
  const side = defaultSurface({
    name: 'Side wall',
    src: { x: split, y: 0, w: 1 - split, h: 1 },
    mesh: { cols: 1, rows: 1, pts: [[split, 0.06], [1, 0.16], [split, 0.94], [1, 0.84]] },
  });
  project.surfaces = [main, side];
  stage.select('surface', side.id);
  pushProject(true);
  buildInspector();
  toast('Drag the side wall corners onto the real wall corner, then use Content split so shapes stay undistorted.');
}

// Two-wall helpers: move the seam, and change how much video each wall gets.
function twoWallControls() {
  if (project.surfaces.length !== 2) return null;
  const [a, b] = project.surfaces;
  const seamAt = () => a.mesh.pts[1][0] - SEAM_OVERLAP;
  const setSeam = (v) => {
    v = clamp(v, 0.05, 0.95);
    a.mesh.pts[1][0] = v + SEAM_OVERLAP;
    a.mesh.pts[3][0] = v + SEAM_OVERLAP;
    b.mesh.pts[0][0] = v;
    b.mesh.pts[2][0] = v;
  };
  const setContent = (v) => {
    v = clamp(v, 0.05, 0.95);
    a.src.x = 0; a.src.w = v;
    b.src.x = v; b.src.w = 1 - v;
  };
  return [
    el('div', { class: 'hint', text: 'Seam - where the wall corner falls on the projector output.' }),
    slider('Corner at', seamAt, setSeam, { min: 0.05, max: 0.95, fmt: pc }),
    el('div', { class: 'hint', text: 'Content split - share of the video given to the main wall. Tune until circles stay round across the corner.' }),
    slider('Split', () => a.src.w, setContent, { min: 0.05, max: 0.95, fmt: pc }),
  ];
}

// Give each area a slice of the video proportional to how wide it is on the
// output, left to right - the starting point for one picture across many walls.
function spreadAcrossAreas() {
  const list = project.surfaces.filter((s) => s.enabled);
  if (list.length < 2) return toast('Draw at least two areas first');
  const info = list.map((s) => {
    const c = Mesh.corners(s.mesh);
    const w = Math.abs(((c[1][0] - c[0][0]) + (c[2][0] - c[3][0])) / 2);
    const cx = (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4;
    return { s, w, cx };
  }).sort((a, b) => a.cx - b.cx);
  const total = info.reduce((n, i) => n + i.w, 0) || 1;
  let x = 0;
  for (const it of info) {
    const w = it.w / total;
    it.s.src = { x, y: 0, w, h: 1 };
    x += w;
  }
  pushProject(true);
  buildInspector();
  toast('Video spread across ' + info.length + ' areas by width. Fine-tune with each area\'s source region.');
}

function helpSection() {
  return section('Keys', [el('div', {
    class: 'hint', html: `
      <b>V</b> select &nbsp; <b>S</b> new area &nbsp; <b>M</b> mask rect &nbsp; <b>P</b> mask shape<br>
      <b>Space</b> play/pause &nbsp; <b>B</b> blackout &nbsp; <b>G</b> wall guides<br>
      <b>Arrows</b> nudge 1px, <b>Shift</b> 10px &nbsp; <b>Backspace</b> delete<br>
      <b>Cmd+scroll</b> zoom &nbsp; <b>Alt+drag</b> pan &nbsp; <b>Cmd+drag</b> ignore snapping<br>
      <b>Shift+drag</b> constrain to one axis &nbsp; <b>Double-click</b> edge adds a point`,
  })]);
}

// ------------------------------------------------------------------- modal --
function promptModal(label) {
  return new Promise((resolve) => {
    const inp = el('input', { type: 'text', placeholder: 'https://…', style: 'width:100%' });
    const back = el('div', {
      style: `position:fixed;inset:0;z-index:100;background:#000a;display:grid;place-items:center`,
    }, [el('div', {
      style: `background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;width:520px;display:flex;flex-direction:column;gap:10px`,
    }, [
      el('div', { text: label, style: 'font-weight:600' }),
      inp,
      el('div', { class: 'row', style: 'justify-content:flex-end' }, [
        el('button', { class: 'btn', text: 'Cancel', onclick: () => { back.remove(); resolve(null); } }),
        el('button', { class: 'btn on', text: 'Add', onclick: () => { back.remove(); resolve(inp.value); } }),
      ]),
    ])]);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { back.remove(); resolve(inp.value); }
      if (e.key === 'Escape') { back.remove(); resolve(null); }
      e.stopPropagation();
    });
    document.body.appendChild(back);
    inp.focus();
  });
}

// ---------------------------------------------------------------- keyboard --
window.addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (stage.key(e)) { e.preventDefault(); return; }
  const k = e.key.toLowerCase();
  if (e.metaKey && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
  if (e.metaKey) return;
  const tool = { v: 'select', s: 'addSurface', m: 'maskRect', p: 'maskPoly' }[k];
  if (tool) {
    document.querySelector(`[data-tool=${tool}]`).click();
    e.preventDefault(); return;
  }
  if (k === ' ') { api.cmd('toggle'); e.preventDefault(); return; }
  if (k === 'b') { project.global.blackout = !project.global.blackout; pushProject(true); e.preventDefault(); return; }
  if (k === 'g') { project.global.showGuides = !project.global.showGuides; pushProject(true); e.preventDefault(); return; }
  if (k === 'f' && !e.metaKey) {
    ensureFx(project);
    project.fx.enabled = !project.fx.enabled;
    pushProject(true); buildInspector();
    toast(project.fx.enabled ? 'Effects on' : 'Effects off', 1200);
    e.preventDefault(); return;
  }
  if (k === 'x') {                       // fire every layer's primary action
    const fx = project.fx;
    if (fx && fx.enabled) {
      for (const L of fx.layers || []) {
        const spec = FX_REGISTRY.get(L.type);
        if (spec && spec.actions && spec.actions[0]) fxAction(L.id, spec.actions[0].name);
      }
      e.preventDefault();
    }
    return;
  }
  if (k === 'arrowleft' && e.shiftKey) { api.cmd('seekBy', -5); e.preventDefault(); }
  if (k === 'arrowright' && e.shiftKey) { api.cmd('seekBy', 5); e.preventDefault(); }
});

api.onMenu((cmd) => {
  const map = {
    addFiles: () => api.addFiles(),
    addUrl: () => $('#addUrl').click(),
    openProject: () => api.openProject(),
    saveProject: () => api.saveProject(false).then((p) => p && toast('Saved ' + p)),
    saveProjectAs: () => api.saveProject(true).then((p) => p && toast('Saved ' + p)),
    toggle: () => api.cmd('toggle'),
    blackout: () => { project.global.blackout = !project.global.blackout; pushProject(true); },
  };
  map[cmd]?.();
});

// ------------------------------------------------------------- drag & drop --
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
  if (paths.length) api.addPaths(paths);
  else {
    const t = e.dataTransfer.getData('text');
    if (/^https?:/.test(t)) api.addUrl(t).then((r) => toast('Added ' + r.count)).catch((err) => toast(err.message));
  }
});

// ------------------------------------------------------------------- state --
function applyState(s) {
  const first = !S;
  S = s;
  if (s.projectEpoch != null && s.projectEpoch !== epoch) {
    epoch = s.projectEpoch;
    if (!first) { project = s.project; stage.select(null, null); }
  }
  if (first) {
    project = s.project;
    const [w, h] = outputSize();
    project.global.refW = w; project.global.refH = h;
  }
  ensureFx(project);
  remote.applyState(s);
  player.setSource(s.transport.source, { preview: usePreviewStream() });
  renderPlaylist();
  updateTop();
  if (first) buildInspector(); else { syncTopSideButtons(); syncInspector(); }
}

function syncTopSideButtons() {
  $('#oProj input').checked = !!S.outputs.projector.enabled;
  $('#oTv input').checked = !!S.outputs.tv.enabled;
  $('#gBlack input').checked = !!project.global.blackout;
  $('#guidesBtn input').checked = !!project.global.showGuides;
  const rep = S.transport.repeat || 'all';
  const rb = $('#tRepeat');
  rb.classList.toggle('on', rep !== 'off');
  rb.innerHTML = rep === 'one' ? '&#8635;<sub>1</sub>' : '&#8635;';
  rb.title = { all: 'Repeat playlist', one: 'Repeat one', off: 'Repeat off' }[rep];
  $('#tShuffle').classList.toggle('on', !!S.playlist.shuffle);
  $('#tMute').classList.toggle('on', !!S.transport.muted);
}

function updateTop() {
  const t = S.transport;
  $('#tPlay').innerHTML = t.playing ? '&#10073;&#10073;' : '&#9654;';
  const item = S.playlist.items[S.playlist.index];
  $('#nowTitle').textContent = t.error ? t.error : (t.source?.title || item?.title || '');
  $('#nowTitle').style.color = t.error ? 'var(--mask)' : '';
  $('#dragInfo').textContent = `${S.playlist.items.length} in playlist  |  ${project.surfaces.length} areas, ${project.masks.length} masks`;
  $('#tRate').value = String(t.rate);
  if (document.activeElement !== $('#tVol')) $('#tVol').value = Math.round((t.volume ?? 1) * 100);
  syncTopSideButtons();
}

api.getState().then((s) => { displays = []; applyState(s); api.displays().then((d) => { displays = d; buildInspector(); stage.layout(); }); });
api.onState(applyState);
api.onFxAudio((f) => fxHost.setRemoteAudio(f));
api.onDisplays((d) => { displays = d; buildInspector(); stage.layout(); });

function refreshMappings(rebuild = true) {
  return api.mappings().then((m) => {
    mappings = m;
    if (document.activeElement?.id !== 'mapName') mappingName = m.current || mappingName;
    if (rebuild && S) buildInspector();
  }).catch(() => {});
}
refreshMappings(true);

// debug handle (used for scripted testing and by the dev-eval hook)
window.__engine = stage.engine;
window.__player = player;
window.__dev = {
  get project() { return project; },
  get state() { return S; },
  stage, camera, remote, player, fxHost,
  fxAction,
  push: pushProject,
  rebuild: buildInspector,
  toast,
};

// -------------------------------------------------------------------- loop --
let lastTitleTime = -1;
function frame() {
  if (S) {
    const g = project.global;
    if (g.testPattern && g.testPattern !== 'off') {
      if (patternKind !== g.testPattern) {
        patternKind = g.testPattern;
        patternCanvas = makePattern(patternKind, 1920, 1080);
        stage.engine.setSource(patternCanvas, { static: true });
        stage.engine.setSourceCrop(null);
      }
    } else {
      if (patternKind !== 'off') { patternKind = 'off'; }
      stage.engine.setSource(player.video, { gated: player.frameGated });
      stage.engine.setSourceCrop(S.transport.source && S.transport.source.crop);
      if (S.settings.livePreview !== false) {
        if (S.audioOut === 'control') player.setSink(S.settings.audioSinkId || '');
        player.update(S.transport, { audible: S.audioOut === 'control' });
      } else if (!player.video.paused) {
        player.video.pause();     // don't leave it drifting behind the clock
      }
    }
    stage.previewDim = 1;
    pumpInteractors();
    const tvPreview = previewWall === 'tv';
    const tvFill = tvPreview && (S.outputs.tv.mode || 'fill') !== 'mapped';
    fxHost.frame(project, {
      playing: !!S.transport.playing,
      audioEl: player.separateAudio ? player.audio : player.video,
      ownsAudio: S.audioOut === 'control',
      wall: tvPreview ? 'tv' : 'projector',
      off: tvFill && S.outputs.tv.fx === false,
      aspect: tvFill ? stage.glc.height / Math.max(1, stage.glc.width) : undefined,
      shapes: !tvFill,
    });
    if (fxHost.outgoingAudio && performance.now() - lastAudioSend > 33) {
      lastAudioSend = performance.now();
      api.fxAudio(fxHost.outgoingAudio);
    }
    stage.engine.render(project, { mode: tvFill ? 'fill' : 'mapped', fit: S.settings.fitMode || 'contain', dimOverride: 1, blend: player.blendFactor(project.global.smoothMotion) });
    stage.draw();
    if (project.fx?.interact?.cameraDebug && project.fx.interact.camera) {
      const c = $('#ovc'), dpr = window.devicePixelRatio || 1;
      if (motion) motion.drawDebugOver(c.getContext('2d'), c.width / dpr, c.height / dpr, fxAspect());
      if (remote.tracker.live) remote.tracker.drawDebugOver(c.getContext('2d'), c.width / dpr, c.height / dpr, fxAspect(), fxHost.interactors);
    }
    remote.frame();

    const t = S.transport;
    const now = targetTime(t);
    if (Math.abs(now - lastTitleTime) > 0.2) {
      lastTitleTime = now;
      $('#tTime').textContent = `${fmtTime(now)} / ${fmtTime(t.duration)}`;
      if (!scrubbing && t.duration) $('#scrub').value = Math.round((now / t.duration) * 1000);
    }
    if (camera.live && camera.homography) camera.applyWarp();
    if (srcMapWidget.redraw && stage.sel?.type === 'surface') srcMapWidget.redraw();
    for (const f of frameUpdaters) { try { f(); } catch {} }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
showView('stage');
stage.layout();
// Report the stage (#frame) rect so the app can send phones a cropped live
// preview of the projection when no output window is open.
let _lastRectKey = '';
setInterval(() => {
  const f = $('#frame'); if (!f) return;
  const r = f.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return;
  const key = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
  if (key === _lastRectKey) return;
  _lastRectKey = key;
  api.reportStageRect({ x: r.left, y: r.top, w: r.width, h: r.height });
}, 500);

