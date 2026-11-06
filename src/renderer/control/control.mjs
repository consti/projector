import { Stage } from '/renderer/control/stage.mjs';
import { defaultPicture } from '/shared/default-picture.mjs';
import { CameraPanel } from '/renderer/control/camera.mjs';
import { Player, targetTime } from '/shared/player.mjs';
import { makePattern } from '/shared/patterns.mjs';
import { defaultProject, ensureFx, ensureProject, wallProject, uid, defaultFxLayer, activeCharacters } from '/shared/schema.mjs';
import { SurfaceVisuals } from '/shared/surface-visuals.mjs';
import { PeopleView, funnyName } from '/renderer/control/characters.mjs';
import * as Mesh from '/shared/mesh.mjs';
import { FxHost } from '/shared/fx/host.mjs';
import { PcmFeed } from '/shared/fx/audio.mjs';
import { MusicView } from './music.mjs';
import { VisualsHost, Visuals, visualsOn, videoKey } from '/shared/visuals.mjs';
import { buildFxSection, buildFxWorldSections, buildFxBrowser, SCENES, applyScene } from '/renderer/control/fxpanel.mjs';
import { MotionTracker } from '/renderer/control/motion.mjs';
import { RemotePanel } from '/renderer/control/remote.mjs';
import { LibraryView } from '/renderer/control/library.mjs';
import { AiDirector } from '/renderer/control/ai.mjs';
import { DepthSource } from '/renderer/control/depth.mjs';
import { FxAudition } from '/renderer/control/audition.mjs';
import { REGISTRY as FX_REGISTRY, QUALITY, withDefaults, PALETTE_MODES } from '/shared/fx/system.mjs';
import { $, el, fmtTime, help, note, head, widgets } from '/renderer/control/ui.mjs';
import { createMapInspector } from '/renderer/control/mapinspector.mjs';
import { createSetupPanel } from '/renderer/control/setup.mjs';
import { createVisualsMode, createVisualsPanel } from '/renderer/control/visualspanel.mjs';

const QUALITY_KEYS = Object.keys(QUALITY);

const sourceBadge = (it) => {
  if (it.kind === 'music') return 'Apple Music';
  const from = it.from || (it.kind === 'file' ? 'file' : it.kind === 'library' ? 'library' : 'stream');
  return from === 'library' ? 'lib' : from === 'file' ? 'file' : from === 'stream' ? 'stream' : from;
};
// the library entry a playlist item corresponds to, if one is on disk
const libEntryFor = (it) => {
  const items = (typeof libraryView !== 'undefined' && libraryView) ? libraryView.items : [];
  return items.find((e) => e.id === it.libId || e.id === it.id || (it.url && e.url === it.url)) || null;
};
// ------------------------------------------------------------------- state --
let S = null;                       // full state from main
let project = defaultProject();     // locally-owned, authoritative while editing
let displays = [];
let audioDevices = [];   // Mac audio output devices (incl. AirPlay), for the sink selector
let mappings = { items: [], current: null };
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
  project: () => stageProject(),
  outputSize: () => outputSize(),
  onChange: (commit) => pushProject(commit),
  onSelect: () => buildInspector(),
  fxPoints: () => fxPoints(),
});

// What the stage shows: in the Map view the map being edited; everywhere else
// the wall the preview is switched to, with that wall's map (or the plain
// full-screen picture when the output shows no map).
function stageWall() {
  if (!S || currentView === 'stage') return { project, mapped: true, map: null };
  return wallProject(project, S.outputs, previewWall);
}
function stageProject() { return stageWall().project; }

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
const visualsHost = new VisualsHost(stage.engine);
// surfaces that run their own generated scene
const surfaceVisuals = new SurfaceVisuals(stage.engine.gl);
stage.engine.surfaceGenerator = (sf, W, H) => surfaceVisuals.render(sf, W, H);
// hovering a catalogue card runs that effect live over the current picture
stage.engine.setFallback(defaultPicture());
const audition = new FxAudition({
  project: () => project,
  // the plain picture: the video (or test pattern); when visuals have replaced
  // it, the stage's own canvas, which was just drawn this frame; with nothing
  // playing, the still the wall shows
  source: () => {
    const src = previewSource();
    if (visualsOn(S)) return stage.glc.width ? stage.glc : null;
    return sourceReady(src) ? src : defaultPicture();
  },
  crop: () => (S && S.transport.source && !visualsOn(S) ? S.transport.source.crop : null),
  audio: () => fxHost.features(),
  characters: () => activeCharacters(S),
});

// what the Music app is playing, tapped by the main process; the analyser
// listens to this instead of a media element while an Apple Music song is on
const musicFeed = new PcmFeed();
api.onMusicPcm((pkt) => { if (pkt && pkt.samples) musicFeed.push(pkt.samples instanceof Float32Array ? pkt.samples : new Float32Array(pkt.samples.buffer || pkt.samples), pkt.rate); });
const isMusicSource = () => !!(S && S.transport.source && S.transport.source.kind === 'music');

// ---------------------------------------------------------------- visuals --
// Visuals in place of the picture: for every track (settings.visuals), or for
// particular videos that are not worth watching (settings.visualsFor).
const visuals = createVisualsMode({ state: () => S, toast, isMusicSource });
const { visualsCfg, patchVisualsCfg, setVisualsOverride, hidesVideo, setHidesVideo, visualsMode, setVisualsMode, visModeSeg, syncVisSegs } = visuals;

// ---------------------------------------------------------------- visuals --
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

  // phones: fingers on the live picture
  if (fx.enabled && (!S || !S.settings || S.settings.phoneTouch !== false)) {
    const blobs = remote.touchInteractors({
      aspect: fxAspect(),
      radius: fx.interact && fx.interact.radius || 0.07,
      strength: (fx.interact && fx.interact.strength == null ? 1 : fx.interact.strength),
    });
    if (blobs.length) list = list.concat(blobs);
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
  // a phone at the controls of a pixel person (Setup → Phone decides what it may do)
  play: (id, msg) => {
    const st = (S && S.settings) || {};
    if (st.phonePlay === false) return;
    if (msg.t === 'say' && !st.phoneSay) return;
    const c = (S && S.characters || []).find((x) => x.id === msg.id);
    if (!c) return;
    const arg = msg.t === 'drive' ? { id: c.id, dir: Number(msg.dir) || 0, run: !!msg.run }
      : msg.t === 'act' ? { id: c.id, move: String(msg.move || '').slice(0, 12), which: msg.which }
      : { id: c.id, text: String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, 40) };
    if (msg.t === 'say' && !arg.text) return;
    for (const L of (project.fx && project.fx.layers) || []) if (L.type === 'people' && L.enabled !== false) fxAction(L.id, msg.t, arg);
  },
  // a phone pixelating its owner: make the character, tell the phone how it goes
  pixelate: (id, msg) => {
    const name = (msg.name || '').trim().slice(0, 40) || funnyName();
    peopleView.make(msg.photo, name, 'phone', (status) => api.remoteSend(id, { t: 'pixelStatus', name, status }))
      .then((c) => api.remoteSend(id, { t: 'pixelDone', id: c && c.id, name }))
      .catch(() => {});
  },
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
    people: ((S && S.characters) || []).map((c) => ({ id: c.id, name: c.name, enabled: c.enabled, url: null })),
    peopleActive: activeCharacters(S).map((c) => c.id),
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
let DECK_CATALOG = null, DECK_CATALOG_KEY = '';
function deckCatalog() {
  // the phone sees the same set the Mac's catalogue is limited to
  const set = activeSet();
  const key = set ? set.name + ':' + set.types.join(',') : '';
  if (DECK_CATALOG && DECK_CATALOG_KEY === key) return DECK_CATALOG;
  DECK_CATALOG_KEY = key;
  const allowed = set ? new Set(set.types) : null;
  const effects = [...FX_REGISTRY.values()]
    .filter((s) => !allowed || allowed.has(s.type))
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

/** The effect set the catalogue is limited to, or null for all. */
function activeSet() {
  const st = S && S.settings;
  if (!st || !st.fxSet) return null;
  return (st.fxSets || []).find((x) => x.name === st.fxSet) || null;
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

// -------------------------------------------------------------------- AI ----
const ai = new AiDirector({
  project: () => project,
  state: () => S,
  push: (commit) => pushProject(commit),
  rebuild: () => buildInspector(),
  fxAction: (id, name, arg) => fxAction(id, name, arg),
  toast,
  features: () => fxHost.features(),
  palette: () => (fxHost.system && fxHost.system.palette) || null,
  patchSettings: (p) => api.patchState({ settings: p }),
});
ai.refresh(false);

// real depth for the parallax camera, read in this window and relayed to every wall
const depth = new DepthSource({
  state: () => S,
  project: () => project,
  fxAction: (id, name, arg) => fxAction(id, name, arg),
  toast,
  note: (t) => ai.note('depth', t),
});


// ---------------------------------------------------------------- people ----
const peopleView = new PeopleView($('#peopleView'), {
  el, toast,
  settings: () => (S && S.settings) || {},
  state: () => S,
});

// --------------------------------------------------------------- library ----
const libraryView = new LibraryView($('#libraryView'), {
  toast,
  play: (ids, opts) => api.libraryPlay(ids, opts),
  toggleDiscover: () => toggleDiscover(),
  hidesVideo: (id) => hidesVideo(id),
  setHidesVideo: (id, on) => setHidesVideo(id, on),
});
const musicView = new MusicView($('#musicView'), { toast, fmtTime });
api.onMusicTap((st) => musicView.tapState(st));
api.library().then((items) => libraryView.setItems(items));
api.onLibrary((items) => { libraryView.setItems(items); remote.sendLibrary(items); if (S) renderPlaylist(); });
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
  sel.innerHTML = '<option value="">Saved playlists…</option>';
  for (const pl of items) sel.appendChild(el('option', { value: pl.name, text: `${pl.name} (${pl.count})` }));
  if (current && !items.some((pl) => pl.name === current)) sel.appendChild(el('option', { value: current, text: current }));
  sel.value = current || '';
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
// what phones may do: push the effects with a finger, take over a pixel person, make it talk
for (const [id, key] of [['#phTouch', 'phoneTouch'], ['#phPlay', 'phonePlay'], ['#phSay', 'phoneSay']]) {
  const inp = $(id + ' input'); if (!inp) continue;
  inp.onchange = () => api.patchState({ settings: { [key]: inp.checked } });
}
function syncPhoneSwitches() {
  const st = (S && S.settings) || {};
  const set = (id, v) => { const inp = $(id + ' input'); if (inp && inp !== document.activeElement) inp.checked = v; };
  set('#phTouch', st.phoneTouch !== false); set('#phPlay', st.phonePlay !== false); set('#phSay', !!st.phoneSay);
}
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
$('#tVisSlot').appendChild(visModeSeg());
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
  const libKey = (typeof libraryView !== 'undefined' && libraryView) ? libraryView.items.map((e) => e.id + (e.cache ? 'c' : 'k') + (e.status || '')[0]).join('') : '';
  const key = items.length + '|' + S.playlist.index + '|' + (S.playlist.name || '') + '|' +
    items.map((i) => i.id).join(',') + '|' + libKey + '|' + (S.settings.visualsFor || []).join(',');
  if (key === plKey && !force) return;
  plKey = key;

  const info = $('#plInfo');
  info.textContent = items.length ? `${S.playlist.name ? S.playlist.name + ' \u00b7 ' : ''}${items.length} video${items.length === 1 ? '' : 's'}` : '';

  const list = $('#pl');
  $('#plEmpty').style.display = items.length ? 'none' : 'block';
  list.innerHTML = '';
  let curRow = null;
  items.forEach((it, i) => {
    const cur = i === S.playlist.index;
    const lib = it.kind === 'youtube' ? libEntryFor(it) : null;
    const cached = lib && lib.cache;
    const kept = lib && !lib.cache;
    const badge = kept ? 'lib' : cached ? (lib.status === 'ready' ? 'cached' : 'caching') : sourceBadge(it);
    const row = el('div', { class: 'pit' + (cur ? ' cur' : '') + (it.error ? ' err' : '') }, [
      el('span', { class: 'n', text: String(i + 1) }),
      el('span', {
        class: 't', text: it.title,
        title: (it.uploader ? it.uploader + ' \u2014 ' : '') + it.title + (it.error ? '\n' + it.error : ''),
      }),
      it.duration ? el('span', { class: 'd', text: fmtTime(it.duration) }) : null,
      el('span', { class: 'k ' + (kept ? 'library' : cached ? 'cached' : (it.from || it.kind)), text: badge }),
      it.kind === 'music' ? null : el('span', {
        class: 'vis' + (hidesVideo(videoKey(it)) ? ' on' : ''), text: '\u25D0',
        title: hidesVideo(videoKey(it)) ? 'Plays with visuals instead of its video. Click to show the video again' : 'Play visuals instead of this video',
        onclick: (e) => { e.stopPropagation(); setHidesVideo(videoKey(it), !hidesVideo(videoKey(it))); },
      }),
      it.kind === 'youtube' && !kept ? el('span', {
        class: 'keep', text: '\u2605', title: cached ? 'Keep this in the library' : 'Download this into the library',
        onclick: (e) => { e.stopPropagation(); api.playlistKeep(i).then(() => toast(cached ? 'Kept in the library' : 'Downloading into the library')); },
      }) : null,
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
// Panel updaters live in groups, one per view, so a change rebuilds only the
// panels that are showing and the rest are rebuilt when their view comes up.
// `updaters` run on every commit, `frameUpdaters` every frame (meters).
const GROUPS = {};
const group = (name) => GROUPS[name] || (GROUPS[name] = { up: [], fr: [], dirty: true, build: null });
group('misc').dirty = false;        // controls built once, outside any view
let building = null;
const updaters = { push: (f) => (building || group('misc')).up.push(f) };
const frameUpdaters = { push: (f) => (building || group('misc')).fr.push(f) };
function buildGroup(name, fn) {
  const g = group(name);
  if (fn) g.build = fn;
  if (!g.build) return;
  g.up.length = 0; g.fr.length = 0; g.dirty = false;
  const prev = building; building = g;
  try { g.build(); } finally { building = prev; }
}
const VIEW_GROUP = { stage: 'map', effects: 'fx', visuals: 'vis', output: 'out' };
const openSections = new Set(['Visuals', 'Outputs', 'Maps', 'Surfaces & shapes', 'Selection', 'Effects', 'Sound', 'World', 'Picture', 'AI', 'Preview']);

const W = widgets({ push: (commit) => pushProject(commit), updaters, openSections });
const { section, slider, numberRow, toggle, textRow, colorRow, selectRow } = W;

// what the source-region widget should show: the calibration pattern when one
// is up, otherwise the live video frame
const previewSource = () => (patternKind !== 'off' && patternCanvas ? patternCanvas : player.video);
const sourceReady = (el) => !!el && !!(el.videoWidth || el.width);

// The inspector is split across views: mapping (Map), effects (Effects),
// outputs/setup (Setup). All sections are (re)built here so their live
// updaters keep working regardless of which view is showing; only the stage
// element moves and views hide via CSS.
function buildInspector() {
  for (const k of Object.values(VIEW_GROUP)) group(k).dirty = true;
  buildVisible();
}
function buildVisible() {
  if (!S) return;
  const name = VIEW_GROUP[currentView];
  if (name && group(name).dirty) buildGroup(name);
}
// Refill a host, keeping its scroll position so touching a layer doesn't jump
// the panel to the top.
function refill(host, kids) {
  const st = host.scrollTop;
  host.innerHTML = '';
  for (const k of kids) if (k) host.appendChild(k);
  host.scrollTop = Math.min(st, Math.max(0, host.scrollHeight - host.clientHeight));
}
// ---- the panels, each built from this window's context: the widgets, the
// live project and state (through getters, since both are replaced on every
// update from main), and the few services they call back into
const panelCtx = {
  W, updaters, frameUpdaters, stage, player, toast, pushProject, buildInspector, promptModal, outputSize,
  previewSource, sourceReady, duplicateSelected, deleteSelected, toggleOutput, refreshMappings, depth,
  fxHost, visualsHost, visuals,
  project: () => project, state: () => S, displays: () => displays, audioDevices: () => audioDevices,
  mappings: () => mappings, currentView: () => currentView,
};
const mapInspector = createMapInspector(panelCtx);
const { mapsSection, layersSection, selectionSection, presetSection, mapSelectRow } = mapInspector;
const setup = createSetupPanel({ ...panelCtx, mapSelectRow });
const { outputSection, soundSetupSection, previewSection, streamsSection, mappingSection, helpSection, lookSection, depthSection } = setup;
const { visualsSection, visualsBrowser } = createVisualsPanel(panelCtx);

group('map').build = () => refill($('#stageInspector'), [mapsSection(), layersSection(), selectionSection(), presetSection()]);
group('fx').build = () => {
  refill($('#fxHost'), [fxSection()]);
  const browser = $('#fxBrowser');
  if (!browser.firstChild) browser.appendChild(buildFxBrowser(fxUi()));
  else buildFxBrowser(fxUi());      // refresh the badges
  refill($('#lookHost'), [...buildFxWorldSections(fxUi()), lookSection()]);
};
group('vis').build = () => refill($('#visHost'), [visualsSection()]);
// two columns of cards: the outputs, sound, preview and streams on the left; the models on the right
group('out').build = () => refill($('#outHost'), [
  el('div', { class: 'setupCol' }, [outputSection(), soundSetupSection(), previewSection(), streamsSection(), mappingSection()]),
  el('div', { class: 'setupCol' }, [ai.section(fxUi()), depthSection(), helpSection()]),
]);

// --- view switching + moving the single stage between views ---
let currentView = 'stage';
function showView(name) {
  currentView = name;
  if (previewShrink) previewShrink();
  for (const b of document.querySelectorAll('#rail .railBtn')) b.classList.toggle('on', b.dataset.view === name);
  for (const v of document.querySelectorAll('#main .view')) v.hidden = v.id !== 'v' + name[0].toUpperCase() + name.slice(1);
  const view = $('#v' + name[0].toUpperCase() + name.slice(1));
  const stageEl = $('#stage');
  // the stage is big in the Map view and docked in the side column everywhere else
  const big = name === 'stage';
  $('#sidePreview').hidden = big;
  for (const h of document.querySelectorAll('#side .sideHost')) h.hidden = h.dataset.for !== name;
  const slot = big ? view.querySelector('.stageSlot') : $('#sidePreview .stageSlot');
  stageEl.classList.toggle('docked', !big);
  stage.plain = !big;                      // handles and tools only where the map is edited
  slot.appendChild(stageEl);
  stage.select(null, null);
  if (name === 'library') libraryView.show(); else libraryView.hide();
  if (name === 'music') musicView.show(); else musicView.hide();
  if (name === 'people') peopleView.show(); else peopleView.hide();
  buildVisible();
  // the stage changed size — relayout on the next frame
  requestAnimationFrame(() => { stage.layout(); stage.draw && stage.draw(); });
}

function fxSection() { ensureFx(project); return buildFxSection(fxUi()); }

function fxUi() {
  return ({
    el, section, slider, toggle, selectRow, numberRow, colorRow, textRow, help, note, head, updaters,
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
    settings: () => (S && S.settings) || {},
    patchSettings: (p) => api.patchState({ settings: p }),
    prompt: (label) => promptModal(label),
    ai,
    audition,
  });
}

function syncInspector() {
  for (const g of Object.values(GROUPS)) if (!g.dirty) for (const f of g.up) { try { f(); } catch {} }
}













// ------------------------------------------------------------------- maps --











// ------------------------------------------------------------------- modal --
function promptModal(label, value) {
  return new Promise((resolve) => {
    const inp = el('input', { type: 'text', placeholder: value == null ? 'https://…' : '', style: 'width:100%' });
    if (value != null) inp.value = value;
    const back = el('div', {
      style: `position:fixed;inset:0;z-index:100;background:#000a;display:grid;place-items:center`,
    }, [el('div', {
      style: `background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;width:520px;display:flex;flex-direction:column;gap:10px`,
    }, [
      el('div', { text: label, style: 'font-weight:600' }),
      inp,
      el('div', { class: 'row', style: 'justify-content:flex-end' }, [
        el('button', { class: 'btn', text: 'Cancel', onclick: () => { back.remove(); resolve(null); } }),
        el('button', { class: 'btn on', text: value == null ? 'Add' : 'OK', onclick: () => { back.remove(); resolve(inp.value); } }),
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
  if (e.key === 'Escape') soundMeter.close();
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
  if (k === 'h') { setVisualsMode(visualsMode() === 'track' ? 'video' : 'track'); e.preventDefault(); return; }
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
  ensureProject(project);
  const setKey = JSON.stringify([s.settings && s.settings.fxSet, s.settings && s.settings.fxSets]);
  if (setKey !== applyState.setKey) { applyState.setKey = setKey; if (!first) { buildInspector(); api.remoteSend(null, remote.catalogMsg()); } }
  remote.applyState(s);
  const visKey = (s.settings.visualsFor || []).join(',');
  if (visKey !== applyState.visKey) { applyState.visKey = visKey; if (!first) libraryView.refresh(); }
  player.setSource(s.transport.source && s.transport.source.kind !== 'music' ? s.transport.source : null, { preview: usePreviewStream() });
  renderPlaylist();
  updateTop();
  syncPhoneSwitches();
  const peopleKey = JSON.stringify(s.characters || []);
  if (peopleKey !== applyState.peopleKey) { applyState.peopleKey = peopleKey; if (!first && currentView === 'people') peopleView.render(); }
  if (first) buildInspector(); else { syncTopSideButtons(); syncInspector(); }
}

function syncTopSideButtons() {
  syncVisSegs();
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
  const mp = project.maps.find((m) => m.id === project.mapId);
  $('#dragInfo').textContent = `${S.playlist.items.length} in playlist  |  map "${mp ? mp.name : ''}": ${project.surfaces.length} surfaces, ${project.masks.length} shapes`;
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
    setup.syncMappingName(m.current);
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
  stage, camera, remote, player, fxHost, ai, peopleView, depth, audition,
  fxAction,
  push: pushProject,
  rebuild: buildInspector,
  toast,
};

// ------------------------------------------------------------ visuals view --

// ------------------------------------------------------------------- sound --
// The beat meter in the top bar shows what the analyser hears right now, from
// whichever window (or the Music app) carries the sound, so it is plain at a
// glance that the effects are getting the beat. Click it for the full meter
// and the sound settings.
const soundMeter = (() => {
  const btn = $('#tSound');
  const bars = [...btn.querySelectorAll('.sBars i')];
  const dot = btn.querySelector('.sBeat');
  const txt = btn.querySelector('.sTxt');
  const KEYS = ['bass', 'low', 'mid', 'high', 'air'];
  const METERS = [['level', 'LVL'], ['bass', 'BAS'], ['low', 'LOW'], ['mid', 'MID'], ['high', 'HI'], ['air', 'AIR']];
  let pop = null, lastShort = '', signalAt = 0;
  const source = () => {
    if (isMusicSource()) return 'the Music app';
    const out = S.audioOut || 'control';
    return out === 'control' ? 'the video in this window' : out === 'none' ? 'nothing' : 'the ' + out + ' window';
  };
  const status = () => {
    const f = fxHost.features(), t = S.transport;
    const react = !!(project.fx && project.fx.audio && project.fx.audio.enabled);
    if (!t.source) return { short: 'no media', long: 'Nothing is playing.', live: false, react };
    if (!t.playing) return { short: 'paused', long: 'Paused. The meter moves while the sound plays.', live: false, react };
    // the analyser reports "live" as soon as it is wired up; a signal is sound actually arriving
    if (f.live && (f.level > 0.03 || f.bass > 0.03 || f.high > 0.03)) signalAt = performance.now();
    if (f.live && performance.now() - signalAt < 1500) {
      return { short: (f.bpm || '--') + ' bpm', live: true, react,
        long: `Listening to ${source()}: ${f.bpm || '--'} bpm.` + (react ? ' The effects react to it.' : ' The effects are not reacting yet: turn on "React to sound" below.') };
    }
    const why = S.audioOut === 'none' ? 'Sound is muted in Setup \u2192 Output \u2192 Audio from, so there is nothing to analyse.'
      : t.muted ? 'The player is muted, so nothing reaches the analyser.'
      : isMusicSource() ? 'Nothing is arriving from the Music app yet. The tap starts with the song.'
      : f.live ? `Silence from ${source()} right now.`
      : `No sound is reaching the analyser from ${source()}. Check Setup \u2192 Output \u2192 Audio from.`;
    return { short: f.live ? 'silent' : 'no signal', long: why, live: false, react };
  };
  const frame = () => {
    if (!S) return;
    const f = fxHost.features();
    const st = status();
    for (let i = 0; i < bars.length; i++) bars[i].style.height = Math.round(4 + (f[KEYS[i]] || 0) * 96) + '%';
    const b = f.beat || 0;
    dot.style.transform = 'scale(' + (0.55 + 0.55 * b).toFixed(3) + ')';
    dot.style.opacity = (0.3 + 0.7 * b).toFixed(3);
    btn.classList.toggle('live', st.live);
    btn.classList.toggle('react', st.react);
    if (st.short !== lastShort) { lastShort = st.short; txt.textContent = st.short; btn.title = st.long; }
  };
  const onDoc = (e) => { if (pop && !pop.contains(e.target) && !btn.contains(e.target)) close(); };
  const close = () => {
    if (!pop) return;
    pop.remove(); pop = null;
    group('pop').dirty = true;
    document.removeEventListener('pointerdown', onDoc);
  };
  const open = () => {
    if (pop) { close(); return; }
    const a = ensureFx(project).audio;
    buildGroup('pop', () => {
      const big = METERS.map(([k, label]) => {
        const fill = el('i', {});
        return { k, fill, bar: el('div', { class: 'bar' + (k === 'level' ? '' : '') }, [fill, el('span', { class: 'lbl', text: label })]) };
      });
      const bdot = el('div', { class: 'beatdot', title: 'Beat' });
      const long = el('div', { class: 'hint' });
      pop = el('div', { class: 'soundPop' }, [
        el('div', { class: 'soundPopHead' }, [el('b', { text: 'Sound' }), el('span', { class: 'grow' }), el('button', { class: 'btn icon sm', text: '\u2715', onclick: close })]),
        el('div', { class: 'meter big' }, [...big.map((m) => m.bar), bdot]),
        long,
        el('div', { class: 'row' }, [toggle('React to sound', () => !!a.enabled, (v) => (a.enabled = v), { title: 'Let the effect layers act on the sound (links are set per layer in the Effects view)' })]),
        slider('Sensitivity', () => a.sensitivity, (v) => (a.sensitivity = v), { min: 0.2, max: 5, fmt: (v) => Number(v).toFixed(2) }),
        slider('Beat', () => a.beatThreshold, (v) => (a.beatThreshold = v), { min: 0.4, max: 4, fmt: (v) => Number(v).toFixed(2) }),
        selectRow('Audio from',
          [['auto', 'Auto (first open output)'], ['tv', 'TV'], ['projector', 'Projector'], ['control', 'This window'], ['none', 'Muted']],
          () => S.settings.audioTarget || 'auto', (v) => api.patchState({ settings: { audioTarget: v } })),
        el('div', { class: 'hint', text: 'The beat is read in the window that plays the sound (or from the Music app for Apple Music) and shared with every wall. Lower Beat to catch softer beats; raise it if it fires on every hi-hat.' }),
      ]);
      frameUpdaters.push(() => {
        const f = fxHost.features(), st = status();
        for (const m of big) m.fill.style.height = Math.round((f[m.k] || 0) * 100) + '%';
        bdot.classList.toggle('on', (f.beat || 0) > 0.35);
        if (long.textContent !== st.long) long.textContent = st.long;
        long.style.color = st.live ? '' : 'var(--warn)';
      });
    });
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.style.top = (r.bottom + 6) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', onDoc), 0);
  };
  btn.onclick = open;
  return { frame, close };
})();

// -------------------------------------------------------------------- loop --
let lastTitleTime = -1;
let frameNo = 0;
function frame() {
  if (S) {
    frameNo++;
    const g = project.global;
    const pattern = !!(g.testPattern && g.testPattern !== 'off');
    const vis = !pattern && visualsOn(S);
    if (pattern) {
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
    const wall = stageWall();
    const wp = wall.project;
    const fill = !wall.mapped;
    const tvPreview = currentView !== 'stage' && previewWall === 'tv';
    fxHost.frame(wp, {
      playing: !!S.transport.playing,
      audioEl: player.separateAudio ? player.audio : player.video,
      ownsAudio: S.audioOut === 'control',
      feed: isMusicSource() ? musicFeed : null,
      wall: tvPreview ? 'tv' : 'projector',
      off: tvPreview && fill && S.outputs.tv.fx === false,
      aspect: fill ? stage.glc.height / Math.max(1, stage.glc.width) : undefined,
      shapes: !fill,
      characters: activeCharacters(S),
      sinkId: S.audioOut === 'control' ? S.settings.audioSinkId || '' : '',
    });
    const visOpts = {
      time: targetTime(S.transport),
      audio: fxHost.features(),
      cfg: visualsCfg(),
      key: S.transport.source && S.transport.source.key,
      playing: !!S.transport.playing,
    };
    // The preview is a courtesy: while a wall is up it draws every other
    // frame so the GPU goes to the projector, and not at all while this
    // window is hidden. The audio analysis above feeds the walls either way.
    const wallUp = S.outputs.projector.enabled || S.outputs.tv.enabled;
    const drawPreview = !document.hidden && !(wallUp && (S.settings.previewQuality || 'auto') !== 'full' && (frameNo & 1));
    if (drawPreview) {
      visualsHost.frame(vis, visOpts);
      surfaceVisuals.frame(visOpts);
    }
    if (fxHost.outgoingAudio && performance.now() - lastAudioSend > 33) {
      lastAudioSend = performance.now();
      api.fxAudio(fxHost.outgoingAudio);
    }
    if (drawPreview) {
      stage.engine.render(wp, { mode: fill ? 'fill' : 'mapped', fit: S.settings.fitMode || 'contain', dimOverride: 1, blend: player.blendFactor(project.global.smoothMotion) });
      stage.draw();
    }
    if (project.fx?.interact?.cameraDebug && project.fx.interact.camera) {
      const c = $('#ovc'), dpr = window.devicePixelRatio || 1;
      if (motion) motion.drawDebugOver(c.getContext('2d'), c.width / dpr, c.height / dpr, fxAspect());
      if (remote.tracker.live) remote.tracker.drawDebugOver(c.getContext('2d'), c.width / dpr, c.height / dpr, fxAspect(), fxHost.interactors);
    }
    remote.frame();
    ai.frame();
    depth.frame();
    visualsBrowser.frame();
    audition.frame();
    soundMeter.frame();

    const t = S.transport;
    const now = targetTime(t);
    if (Math.abs(now - lastTitleTime) > 0.2) {
      lastTitleTime = now;
      $('#tTime').textContent = `${fmtTime(now)} / ${fmtTime(t.duration)}`;
      if (!scrubbing && t.duration) $('#scrub').value = Math.round((now / t.duration) * 1000);
    }
    if (camera.live && camera.homography) camera.applyWarp();
    if (stage.sel?.type === 'surface') mapInspector.redrawSrcMap();
    for (const g of Object.values(GROUPS)) if (!g.dirty) for (const f of g.fr) { try { f(); } catch {} }
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

