import { Engine } from '/shared/gl-engine.mjs';
import { Player, targetTime } from '/shared/player.mjs';
import { makePattern } from '/shared/patterns.mjs';
import { drawGuides } from '/shared/guides.mjs';
import { defaultProject, activeCharacters } from '/shared/schema.mjs';
import { FxHost } from '/shared/fx/host.mjs';

const role = new URLSearchParams(location.search).get('role') || 'projector';
const canvas = document.getElementById('c');
const ident = document.getElementById('ident');
const msgEl = document.getElementById('msg');

const engine = new Engine(canvas);
const player = new Player();
const fx = new FxHost(engine, role);

let state = { project: defaultProject(), transport: {}, settings: {}, outputs: {} };
let patternCanvas = null, patternKind = 'off';
let guidesCanvas = null, guidesKey = '';

player.onmeta = (m) => api.report({ duration: m.duration });
player.onResync = (t) => { if (state.clockOwner === role) api.cmd('resync', { t, role }); };
player.onFrame = () => engine.markSourceDirty();
window.__engine = engine;
window.__player = player;
window.__fx = fx;

// the control window relays pointer / camera interaction and one-shot actions
api.onFxInteract((pts) => fx.setInteractors(pts));
api.onFxAction((a) => fx.action(a.layerId, a.name, a.arg));
api.onFxAudio((f) => fx.setRemoteAudio(f));
player.onended = () => { if ((state.clockOwner || 'control') === role) api.ended(); };

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    engine.invalidateMasks();
    guidesKey = '';
  }
}
window.addEventListener('resize', resize);

api.getState().then(apply);
api.onState(apply);
api.onIdentify((info) => {
  // older payloads were just the role string
  const r = typeof info === 'string' ? info : info && info.role;
  if (r !== role) return;
  const label = typeof info === 'object' && info ? info.label : '';
  ident.innerHTML = '';
  ident.appendChild(Object.assign(document.createElement('div'), { textContent: role }));
  if (label) {
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = label;
    ident.appendChild(sub);
  }
  ident.classList.add('on');
  setTimeout(() => ident.classList.remove('on'), 2600);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.setOutput(role, { enabled: false });
});

// tell the operator how to get out of a frameless full-screen window
const hint = document.createElement('div');
hint.id = 'hint';
hint.textContent = role.toUpperCase() + ' output  \u00b7  Esc or Cmd+Alt+P closes it';
document.body.appendChild(hint);
setTimeout(() => hint.classList.add('gone'), 4000);

function apply(s) {
  state = s;
  player.setSource(s.transport.source);
}

let lastAudioSend = 0;

function frame() {
  resize();
  const p = state.project || defaultProject();
  const g = p.global || {};
  const cfg = (state.outputs && state.outputs[role]) || { mode: role === 'tv' ? 'fill' : 'mapped' };

  // source: calibration pattern overrides the video
  if (g.testPattern && g.testPattern !== 'off') {
    if (patternKind !== g.testPattern) {
      patternKind = g.testPattern;
      patternCanvas = makePattern(patternKind, 1920, 1080);
      engine.setSource(patternCanvas, { static: true });
      engine.setSourceCrop(null);
    }
  } else {
    if (patternKind !== 'off') { patternKind = 'off'; patternCanvas = null; }
    engine.setSource(player.video, { gated: player.frameGated });
    engine.setSourceCrop(state.transport.source && state.transport.source.crop);
    if (state.audioOut === role) player.setSink(state.settings && state.settings.audioSinkId || '');
    player.update(state.transport || {}, { audible: state.audioOut === role });
  }

  // guides overlay (projector-space outlines) – rebuilt only when it changes
  if (cfg.mode === 'mapped' && g.showGuides) {
    const key = JSON.stringify([p.surfaces.map((s) => [s.mesh, s.name, s.enabled]), p.masks.map((m) => [m.points, m.invert, m.enabled]), canvas.width, canvas.height]);
    if (key !== guidesKey) {
      guidesKey = key;
      if (!guidesCanvas) guidesCanvas = document.createElement('canvas');
      guidesCanvas.width = canvas.width; guidesCanvas.height = canvas.height;
      drawGuides(guidesCanvas.getContext('2d'), canvas.width, canvas.height, p);
      engine.setOverlay(guidesCanvas);
    }
  } else if (engine.hasOverlay) {
    engine.setOverlay(null);
    guidesKey = '';
  }

  const ownsAudio = state.audioOut === role;
  // The TV is its own wall: plain video with the effects running over it (no
  // shapes in that world, and its own aspect), unless its effects are off.
  const wall = role === 'tv' ? 'tv' : 'projector';
  const fill = cfg.mode !== 'mapped';
  fx.frame(p, {
    playing: !!(state.transport && state.transport.playing),
    audioEl: player.separateAudio ? player.audio : player.video,
    ownsAudio,
    wall,
    off: fill && cfg.fx === false,
    aspect: fill ? canvas.height / Math.max(1, canvas.width) : undefined,
    shapes: !fill,
    characters: activeCharacters(state),
  });
  if (fx.outgoingAudio && (performance.now() - lastAudioSend) > 33) {
    lastAudioSend = performance.now();
    api.fxAudio(fx.outgoingAudio);
  }

  engine.render(p, { mode: cfg.mode, fit: state.settings?.fitMode || 'contain', blend: player.blendFactor(g.smoothMotion) });

  const t = state.transport || {};
  let msg = '';
  if (t.loading) msg = 'Loading…';
  else if (t.error) msg = t.error;
  else if (!t.source) msg = 'No source loaded';
  else if (player.status === 'buffering') msg = 'Buffering…';
  else if (String(player.status).startsWith('error')) msg = player.status;
  if (msgEl.textContent !== msg) msgEl.textContent = msg;

  requestAnimationFrame(frame);
}
resize();
requestAnimationFrame(frame);
