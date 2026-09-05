// The Effects panel: master controls, the layer stack, and a generated
// parameter editor driven by each effect's own schema, so adding an effect
// never means touching the UI.

import { REGISTRY, QUALITY, PALETTE_MODES } from '/shared/fx/system.mjs';
import { SOURCES } from '/shared/fx/audio.mjs';
import { defaultFxLayer } from '/shared/schema.mjs';
import { EFFECTS } from '/shared/fx/effects/index.mjs';
import { PART_OPTIONS } from '/shared/pose.mjs';

// Apply a scene preset to an fx config in place; returns the id of the first
// layer (for selection). Shared by the desktop panel and the phone deck.
export function applyScene(fx, s) {
  fx.layers = s.layers.map(([type, params, extra]) => defaultFxLayer(type, { ...params }, extra ? {
    mod: (extra.mod || []).map((m) => ({ ...m })),
    trig: extra.trig ? { ...extra.trig } : null,
  } : {}));
  fx.enabled = true;
  if (s.audio) {
    fx.audio.enabled = true;
    if (s.audio.globalSrc) fx.audio.globalSrc = s.audio.globalSrc;
    if (s.audio.globals) Object.assign(fx.audio.globals, s.audio.globals);
  }
  return fx.layers[0] ? fx.layers[0].id : null;
}

export const SCENES = [
  { name: 'Flood the room', layers: [['water', {}]], note: 'Water pours in and finds its level around every masked shape.' },
  { name: 'Aquarium', layers: [['water', { volume: 0.7, pour: 60, foam: 0.3 }], ['bubbles', { rate: 8, size: 0.02 }], ['ripples', { rain: 2, refract: 0.3 }]] },
  { name: 'Ball pit', layers: [['balls', { rate: 10, count: 140, material: 'rubber' }]] },
  { name: 'Glass marbles', layers: [['balls', { material: 'glass', size: 0.03, rate: 4, count: 60, videoTint: 0.2 }]] },
  { name: 'Snowfall', layers: [['snow', {}]] },
  { name: 'Storm', layers: [['rain', {}], ['lightning', { rate: 0.5 }], ['ripples', { rain: 0, refract: 0.25 }]] },
  { name: 'Inferno', layers: [['fire', {}], ['smoke', { emit: 0.35, density: 1.4, color: '#4a4a52' }]] },
  { name: 'Smoke room', layers: [['smoke', { emit: 0.8, blurBehind: 0.9, density: 3 }]] },
  { name: 'Ink in water', layers: [['ink', { multicolour: true }]] },
  { name: 'Break the picture', layers: [['shatter', { auto: 12 }]] },
  { name: 'Hourglass', layers: [['sand', {}]] },
  { name: 'Slime', layers: [['goo', {}]] },
  { name: 'Overgrown', layers: [['vines', {}], ['fireflies', { count: 40, size: 0.012 }]] },
  { name: 'Night sky', layers: [['aurora', {}], ['fireflies', { count: 120 }]] },
  { name: 'Event horizon', layers: [['blackhole', {}]] },
  { name: 'Celebration', layers: [['confetti', {}], ['fireflies', { count: 30, palette: 'candy', multicolour: true }]] },
  { name: 'Emoji storm', layers: [['emoji', { rate: 8, count: 120 }]], note: 'Type your own emoji in the layer settings.' },
  { name: 'Building blocks', layers: [['shapes', { kind: 'box', rate: 6, count: 120, bounce: 0.1 }]] },

  // --- trippy / retro ---------------------------------------------------
  { name: 'Kaleidoscope', layers: [['kaleido', {}]] },
  { name: 'Falling into itself', layers: [['droste', {}]], note: 'The picture repeats inside itself and spirals inwards forever.' },
  { name: 'Infinity mirror', layers: [['feedback', {}]] },
  { name: 'Circle limit', layers: [['hyperbolic', {}]], note: 'Escher’s hyperbolic tiling of the picture.' },
  { name: 'Wormhole', layers: [['tunnel', { shape: 'round', twist: 1.2, hue: 0.4 }], ['fireflies', { count: 40, size: 0.01 }]] },
  { name: 'Acid trip', layers: [['acid', {}], ['kaleido', { segments: 8, spin: 0.05, pulse: 0.6 }]], note: 'Melting colours, folded eight ways.' },
  { name: 'Vaporwave', layers: [['synthwave', {}], ['vhs', { tracking: 0.3, jitter: 0.3, curve: 0.3, wear: 0.3, noise: 0.3, dropouts: 0.2 }]] },
  { name: 'Bad tape', layers: [['vhs', { tracking: 1.2, jitter: 1.4, dropouts: 1.2 }]] },
  { name: 'Datamosh', layers: [['glitch', { amount: 0.4, bursts: 1 }]] },
  { name: 'Hall of mirrors', layers: [['mirror', { mode: 'both', swirl: 0.8 }]] },
  { name: 'Into the room', layers: [['room', {}]], note: 'The wall opens into a box. Move the pointer to shift the view.' },
  { name: 'Tetris', layers: [['tetris', {}]], note: 'Plays itself; your shapes are solid.' },
  { name: 'Burn the film', layers: [['burn', {}], ['smoke', { emit: 0.25, density: 1.2, color: '#3a3a40' }]] },

  // --- the shapes on the wall ----------------------------------------------
  { name: 'Lamp on the wall', layers: [['shadows', {}]], note: 'Move the pointer: it is the lamp, and every shape casts a shadow.' },
  { name: 'Blocks', layers: [['extrude', {}]], note: 'The shapes stand off the wall as solid blocks.' },
  { name: 'Aura', layers: [['aura', {}]], note: 'Contour waves ripple out from every shape.' },
  { name: 'Haunted gallery', layers: [['shadows', { dark: 0.9, lamp: 0.5, lampCol: '#9fb8ff', ambient: 0.35 }], ['aura', { rings: 10, ringCol: '#7a5cff', bulge: 0.2, grow: 0.5, glow: 0.3 }], ['fireflies', { count: 25, size: 0.008 }]] },
  { name: 'Field lines', layers: [['fieldlines', {}]], note: 'Lines of force radiate from every shape.' },
  { name: 'Glass rim', layers: [['glassrim', {}]], note: 'Every shape set behind a thick bevel of glass.' },
  { name: 'Plasma', layers: [['plasma', {}], ['neon', { glow: 0.5, dim: 0, picEdges: 0, double: 0, width: 0.002 }]] },
  { name: 'Frost', layers: [['frost', {}]], note: 'Ice creeps out of every shape, then melts back.' },
  { name: 'Contour map', layers: [['contour', {}]] },
  { name: 'Subtitled by a poet', layers: [['aitext', {}]], note: 'Needs AI on in Setup: each frame is read ahead and captioned as it arrives.' },
  { name: 'Pixel party', layers: [['people', {}], ['confetti', { rate: 6 }]], note: 'The pixel people drop in and dance; pixelate yourself on the phone (F4 Me).' },
  { name: 'Dreamt in oils', layers: [['aidream', { mix: 0.85 }], ['aitext', { font: 'gothic', place: 'centre', align: 'centre', size: 0.05, box: 0 }]], note: 'Needs AI on: frames re-painted and captioned.' },

  // --- generative (after the Max Cooper videos) ---------------------------------
  { name: 'Order from chaos', layers: [['reaction', {}]], note: 'Reaction-diffusion grows out of the film’s highlights.' },
  { name: 'Emergence', layers: [['life', {}]] },
  { name: 'Repetition', layers: [['sprawl', {}]], note: 'The picture duplicates and recedes for ever.' },
  { name: 'Aleph', layers: [['aleph', {}]], note: 'The infinite zoom. Move the pointer to steer it.' },
  { name: 'Symmetry', layers: [['symmetry', {}]] },
  { name: 'Perpetual motion', layers: [['pointcloud', {}], ['plexus', { cells: 10, bgDim: 0, dot: 0.05, line: 0.02 }]] },
  { name: 'Transcendental', layers: [['digits', {}]] },
  { name: 'Tree map', layers: [['treemap', {}]] },
  { name: 'Quasicrystal', layers: [['quasicrystal', {}]] },
  { name: 'Woven', layers: [['weave', {}]] },
  { name: 'Parallax camera', layers: [['parallax', {}]], note: 'Depth guessed from the picture; the camera follows the pointer.' },
  { name: 'Coral', layers: [['coral', {}]] },
  {
    name: 'Unknown pleasures', note: 'The spectrum drawn as rows that recede; needs React to sound.',
    audio: { globals: { gravity: 0, timeScale: 0, bloom: 0.5, exposure: 0, wind: 0 }, globalSrc: 'level' },
    layers: [['joyplot', {}, { mod: [{ p: 'amp', src: 'level', amt: 0.6 }] }]],
  },
  {
    name: 'Sonar rings', note: 'Rings of sound pulsing out from the centre; needs React to sound.',
    audio: { globals: { gravity: 0, timeScale: 0, bloom: 0.7, exposure: 0, wind: 0 }, globalSrc: 'level' },
    layers: [['ringrows', {}, { mod: [{ p: 'amp', src: 'bass', amt: 0.5 }] }]],
  },
  {
    name: 'Equaliser wall', note: 'Bars of the picture that jump with the bass.',
    audio: { globals: { gravity: 0, timeScale: 0, bloom: 0.6, exposure: 0, wind: 0 }, globalSrc: 'level' },
    layers: [['bars', { gain: 1 }, { mod: [{ p: 'gain', src: 'bass', amt: 1.2 }] }]],
  },

  // --- audio reactive -------------------------------------------------
  {
    name: 'Beat drop', note: 'Balls fall on every beat and swell with the bass.',
    audio: { globals: { gravity: 0, timeScale: 0, bloom: 0.6, exposure: 0, wind: 0 }, globalSrc: 'beat' },
    layers: [['balls', { rate: 0, count: 160, material: 'rubber', size: 0.02 }, {
      trig: { src: 'beat', action: 'burst', every: 1 },
      mod: [{ p: 'size', src: 'bass', amt: 0.35 }, { p: 'bounce', src: 'level', amt: 0.4 }],
    }]],
  },
  {
    name: 'Equaliser fire', note: 'Flames driven by the low end, smoke by the mids.',
    audio: { globals: { gravity: 0, timeScale: 0, bloom: 1.2, exposure: 0.25, wind: 0 }, globalSrc: 'level' },
    layers: [
      ['fire', { emit: 0.35, sources: 6, spread: 0.4 }, { mod: [{ p: 'emit', src: 'bass', amt: 1.6 }, { p: 'turbulence', src: 'high', amt: 1.2 }] }],
      ['smoke', { emit: 0.2, density: 1.6, color: '#3d4148' }, { mod: [{ p: 'emit', src: 'mid', amt: 0.9 }] }],
    ],
  },
  {
    name: 'Sonar', note: 'Every beat throws a ring across the wall.',
    audio: { globals: { gravity: 0, timeScale: 0, bloom: 0.8, exposure: 0, wind: 0 }, globalSrc: 'beat' },
    layers: [['ripples', { rain: 0, amp: 0.5, dropSize: 0.02, caustic: 0.5, spec: 0.8 }, {
      trig: { src: 'beat', action: 'drop', every: 1 },
      mod: [{ p: 'refract', src: 'level', amt: 0.6 }],
    }]],
  },
  {
    name: 'Storm on the beat', note: 'Lightning strikes on the downbeat, rain follows the loudness.',
    audio: { globals: { gravity: 0, timeScale: 0, bloom: 0.7, exposure: 0.15, wind: 0 }, globalSrc: 'level' },
    layers: [
      ['rain', { rate: 150 }, { mod: [{ p: 'rate', src: 'level', amt: 0.5 }, { p: 'angle', src: 'sine', amt: 0.25 }] }],
      ['lightning', { rate: 0 }, { trig: { src: 'beat', action: 'strike', every: 4 } }],
    ],
  },
  {
    name: 'Breathing aurora', note: 'Curtains that swell and shift colour with the music.',
    audio: { globals: { gravity: 0, timeScale: 0.4, bloom: 1, exposure: 0.2, wind: 0 }, globalSrc: 'level' },
    layers: [['aurora', {}, { mod: [
      { p: 'intensity', src: 'level', amt: 1.2 }, { p: 'height', src: 'bass', amt: 0.8 },
      { p: 'bands', src: 'high', amt: 0.6 },
    ] }]],
  },
  {
    name: 'Glitch on the beat', note: 'The picture tears on every beat and mends between them.',
    audio: { globals: { gravity: 0, timeScale: 0, bloom: 0.5, exposure: 0, wind: 0 }, globalSrc: 'level' },
    layers: [['glitch', { amount: 0.05, bursts: 0 }, {
      trig: { src: 'beat', action: 'burst', every: 1 },
      mod: [{ p: 'split', src: 'high', amt: 1.5 }],
    }]],
  },
  {
    name: 'Shockwave on the beat', note: 'A ring bursts out of every shape on each beat.',
    audio: { globals: { gravity: 0, timeScale: 0, bloom: 0.8, exposure: 0, wind: 0 }, globalSrc: 'level' },
    layers: [['shockwave', { every: 0, speed: 0.4 }, {
      trig: { src: 'beat', action: 'pulse', every: 1 },
      mod: [{ p: 'amp', src: 'bass', amt: 0.6 }],
    }]],
  },
  {
    name: 'Shatter on the drop', note: 'The picture breaks every eighth beat and rebuilds itself.',
    audio: { globals: { gravity: 0, timeScale: 0, bloom: 0.5, exposure: 0, wind: 0 }, globalSrc: 'level' },
    layers: [['shatter', { pieces: 90, burst: 0.8, reveal: 0.15 }, {
      trig: { src: 'beat', action: 'break', every: 8 },
      mod: [{ p: 'glint', src: 'high', amt: 1.2 }],
    }]],
  },
];

const GROUP_ORDER = ['Fluid', 'Water', 'Physics', 'Weather', 'Particles', 'Energy', 'Growth', 'Shapes', 'People', 'Generative', 'Trippy', 'Retro', 'Look', 'AI'];

export function buildFxSection(ui) {
  const P = ui.project();
  const fx = P.fx;
  const el = ui.el;
  const rows = [];

  // ---------------------------------------------------------- master row
  rows.push(el('div', { class: 'row' }, [
    ui.toggle('Effects on', () => fx.enabled, (v) => { fx.enabled = v; }),
    ui.toggle('In preview', () => fx.preview !== false, (v) => { fx.preview = v; }),
  ]));
  if (ui.ai) {
    const a = ui.ai;
    const ready = a.status && a.status.hasKey && a.ai.enabled;
    rows.push(el('div', { class: 'row' }, [
      ui.toggle('AI steers the effects', () => !!a.ai.steer, (v) => { a.patch({ steer: v }); if (v) a.lastTrack = null; }, { push: false, title: 'The director picks and tunes the stack for each track (Setup → AI)' }),
      el('button', { class: 'btn sm', text: a.busy ? 'Planning…' : 'Steer now', disabled: a.busy || !ready ? '' : null, onclick: () => a.plan('asked for') }),
    ]));
    if (!ready) rows.push(el('div', { class: 'hint', text: 'Turn AI on in Setup (and give it a key) to let the director steer.' }));
    else if (a.log.length && a.log[0].kind === 'plan') rows.push(el('div', { class: 'hint', text: 'AI: ' + a.log[0].text.split(' — ')[0] }));
  }
  rows.push(el('div', { class: 'hint', text: 'The stack runs on both walls: the projector (with your shapes) and the TV (plain video, no shapes). Each layer below can be limited to one of them.' }));
  if (!fx.enabled) {
    rows.push(el('div', { class: 'hint', text: 'Physics and simulation layers drawn over the mapped video, in projector space. Everything collides with the shapes you have masked.' }));
  }

  rows.push(ui.selectRow('Quality', Object.keys(QUALITY).map((k) => [k, k[0].toUpperCase() + k.slice(1)]),
    () => fx.quality || 'high', (v) => { fx.quality = v; }));

  // ---------------------------------------------------------- layer stack
  const list = el('div', { style: 'display:flex;flex-direction:column;gap:2px' });
  const layers = fx.layers || (fx.layers = []);
  if (!layers.length) list.appendChild(el('div', { class: 'hint', text: 'No effects yet. Pick one from the catalogue, or start from a scene.' }));
  layers.forEach((L, i) => {
    const spec = REGISTRY.get(L.type);
    const on = ui.selectedLayer() === L.id;
    const chk = el('input', { type: 'checkbox', title: 'Show / hide' });
    chk.checked = L.enabled !== false;
    chk.onclick = (e) => e.stopPropagation();
    chk.onchange = () => { L.enabled = chk.checked; ui.push(true); ui.rebuild(); };
    const sh = L.show || {};
    const wallTag = sh.projector === false && sh.tv === false ? 'off' : sh.tv === false ? 'projector' : sh.projector === false ? 'TV' : '';
    const row = el('div', { class: 'lay' + (on ? ' on' : '') + (L.enabled === false ? '' : ' vis') }, [
      chk,
      el('img', { class: 'th', src: thumbUrl(L.type), alt: '' }),
      el('span', { class: 'nm', text: L.name || (spec ? spec.label : L.type) }),
      wallTag ? el('span', { class: 'tag', text: wallTag, title: 'Shows on this wall only' }) : null,
      el('span', { class: 'ar', text: '▲', title: 'Move up',
        onclick: (e) => { e.stopPropagation(); if (i > 0) { layers.splice(i - 1, 0, layers.splice(i, 1)[0]); ui.push(true); ui.rebuild(); } } }),
      el('span', { class: 'ar', text: '▼', title: 'Move down',
        onclick: (e) => { e.stopPropagation(); if (i < layers.length - 1) { layers.splice(i + 1, 0, layers.splice(i, 1)[0]); ui.push(true); ui.rebuild(); } } }),
      el('span', { class: 'ar', text: '✕', title: 'Remove',
        onclick: (e) => { e.stopPropagation(); layers.splice(i, 1); ui.selectLayer(null); ui.push(true); ui.rebuild(); } }),
    ]);
    row.onclick = () => { ui.selectLayer(on ? null : L.id); ui.rebuild(); };
    list.appendChild(row);
  });
  rows.push(list);

  // ---------------------------------------------------- selected layer
  const sel = layers.find((L) => L.id === ui.selectedLayer());
  if (sel) {
    const spec = REGISTRY.get(sel.type);
    if (spec) {
      rows.push(el('div', { class: 'fxhead', text: spec.label }));
      if (spec.hint) rows.push(el('div', { class: 'hint', text: spec.hint }));
      if (spec.actions && spec.actions.length) {
        // two per row, so the labels are never clipped
        rows.push(el('div', { class: spec.actions.length > 2 ? 'quad' : 'row' }, spec.actions.map((a) =>
          el('button', { class: 'btn sm' + (spec.actions.length > 2 ? '' : ' grow'), text: a.label,
            onclick: () => ui.sendAction(sel.id, a.name) }))));
      }
      rows.push(ui.slider('Opacity', () => (sel.opacity == null ? 1 : sel.opacity),
        (v) => (sel.opacity = v), { min: 0, max: 1, fmt: (v) => Math.round(v * 100) + '%' }));
      // which walls carry this layer
      const show = sel.show || (sel.show = { projector: true, tv: true });
      rows.push(el('div', { class: 'row' }, [
        el('span', { class: 'hint', text: 'Show on' }),
        ui.toggle('Projector', () => show.projector !== false, (v) => { show.projector = v; }),
        ui.toggle('TV', () => show.tv !== false, (v) => { show.tv = v; }),
      ]));
      // colours from the picture instead of the swatches
      if ((spec.params || []).some((q) => q.type === 'color')) {
        rows.push(ui.selectRow('Colours', PALETTE_MODES, () => sel.palette || 'fixed', (v) => { sel.palette = v; ui.push(true); ui.rebuild(); }));
      }
      // which shapes this layer sees
      const seen = (P.masks || []).filter((m) => m.enabled && m.fxCollide !== false);
      if (seen.length) {
        const all = !Array.isArray(sel.shapes);
        const list = el('div', { class: 'row' }, [
          el('span', { class: 'hint', text: 'Shapes' }),
          ui.toggle('All', () => !Array.isArray(sel.shapes), (v) => { sel.shapes = v ? null : seen.map((m) => m.id); ui.rebuild(); }),
          ...seen.map((m) => ui.toggle(m.name || 'Mask', () => all || sel.shapes.includes(m.id), (v) => {
            const cur = new Set(Array.isArray(sel.shapes) ? sel.shapes : seen.map((x) => x.id));
            if (v) cur.add(m.id); else cur.delete(m.id);
            sel.shapes = cur.size === seen.length ? null : [...cur];
            ui.rebuild();
          })),
        ]);
        rows.push(list);
      }
      const get = (k, d) => (sel.params && sel.params[k] != null ? sel.params[k] : d);
      const set = (k, v) => { (sel.params || (sel.params = {}))[k] = v; };
      for (const spc of spec.params || []) {
        rows.push(paramControl(ui, spc, () => get(spc.key, spc.def), (v) => set(spc.key, v)));
      }
      rows.push(...soundLinks(ui, fx, sel, spec));
      rows.push(el('button', {
        class: 'btn sm', text: 'Reset this effect',
        onclick: () => { sel.params = {}; sel.mod = []; sel.trig = null; sel.palette = 'fixed'; sel.shapes = null; ui.push(true); ui.rebuild(); },
      }));
    }
  }

  rows.push(el('div', { class: 'row' }, [
    el('button', { class: 'btn sm grow', text: 'Clear all layers', onclick: () => { fx.layers = []; ui.selectLayer(null); ui.push(true); ui.rebuild(); } }),
  ]));

  const stats = el('div', { class: 'hint mono' });
  ui.live(() => {
    const s = ui.stats();
    stats.textContent = s
      ? `${s.layers} layer${s.layers === 1 ? '' : 's'} · sim ${s.ms.toFixed(1)} ms/frame` + (s.error ? ' · ' + s.error : '')
      : (fx.enabled ? 'idle' : '');
    stats.style.color = s && s.error ? 'var(--mask)' : '';
  });
  rows.push(stats);

  return ui.section('Effects', rows);
}


// World, camera, look and sound: the right-hand dock under the preview.
export function buildFxWorldSections(ui) {
  const P = ui.project();
  const fx = P.fx;
  const el = ui.el;
  const world = [], cam = [], look = [];
  world.push(ui.slider('Gravity', () => fx.gravity, (v) => (fx.gravity = v), { min: -2, max: 4, fmt: (v) => v.toFixed(2) }));
  world.push(ui.slider('Wind', () => fx.windX, (v) => (fx.windX = v), { min: -2, max: 2, fmt: (v) => v.toFixed(2) }));
  world.push(ui.slider('Time scale', () => fx.timeScale, (v) => (fx.timeScale = v), { min: 0, max: 3, fmt: (v) => v.toFixed(2) + 'x' }));
  world.push(el('div', { class: 'row' }, [
    ui.toggle('Masks are solid', () => fx.collideMasks !== false, (v) => (fx.collideMasks = v)),
    ui.toggle('Area edges solid', () => !!fx.collideSurfaceEdges, (v) => (fx.collideSurfaceEdges = v)),
  ]));
  const walls = fx.walls || (fx.walls = { l: true, r: true, t: false, b: true });
  world.push(el('div', { class: 'row' }, [
    el('span', { class: 'hint', text: 'Walls' }),
    ui.toggle('Floor', () => walls.b, (v) => (walls.b = v)),
    ui.toggle('Ceiling', () => walls.t, (v) => (walls.t = v)),
    ui.toggle('Sides', () => walls.l && walls.r, (v) => { walls.l = v; walls.r = v; }),
  ]));
  world.push(el('div', { class: 'row' }, [
    ui.toggle('Pointer interacts', () => fx.interact.pointer !== false, (v) => (fx.interact.pointer = v)),
    ui.toggle('Pause with video', () => !!fx.pauseWithVideo, (v) => (fx.pauseWithVideo = v)),
  ]));
  world.push(ui.slider('Pointer reach', () => fx.interact.radius, (v) => (fx.interact.radius = v), { min: 0.01, max: 0.4, fmt: (v) => v.toFixed(2) }));

  // camera
  cam.push(el('div', { class: 'row' }, [
    ui.toggle('People push things', () => !!fx.interact.camera, (v) => (fx.interact.camera = v)),
    ui.toggle('Show tracking', () => !!fx.interact.cameraDebug, (v) => (fx.interact.cameraDebug = v)),
  ]));
  cam.push(ui.slider('Sensitivity', () => fx.interact.cameraSensitivity,
    (v) => (fx.interact.cameraSensitivity = v), { min: 0.2, max: 4, fmt: (v) => v.toFixed(2) }));
  cam.push(ui.slider('Push strength', () => fx.interact.cameraForce,
    (v) => (fx.interact.cameraForce = v), { min: 0, max: 4, fmt: (v) => v.toFixed(2) }));
  cam.push(ui.selectRow('Phone pushes with', PART_OPTIONS, () => fx.interact.phoneParts || 'body',
    (v) => { fx.interact.phoneParts = v; ui.push(true); }));
  const camState = el('div', { class: 'hint' });
  ui.live(() => {
    const r = ui.cameraReady();
    const ph = ui.phoneState ? ui.phoneState() : { ready: false };
    let txt;
    if (fx.interact.camera && (r || ph.ready)) {
      const bits = [];
      if (r) bits.push(`${ui.motionBlobs()} moving region${ui.motionBlobs() === 1 ? '' : 's'} on the Mac camera`);
      if (ph.ready) bits.push(ph.live ? `${ph.people} ${ph.people === 1 ? 'person' : 'people'} via the phone` : 'phone aligned, nobody in view');
      txt = 'Tracking ' + bits.join(', ') + '.';
    } else if (r || ph.ready) {
      txt = (r && ph.ready ? 'Camera and phone are' : r ? 'Camera is' : 'Phone is') + ' aligned and ready.';
    } else {
      txt = 'Align a camera first: pick a Mac camera and press "Align to wall", or share on Wi-Fi and align a phone (both in the left panel). The alignment tells the tracker where in the picture each person is.';
    }
    camState.textContent = txt;
    camState.style.color = r || ph.ready ? '' : 'var(--dim2)';
  });
  cam.push(camState);

  // look
  look.push(ui.slider('Bloom', () => fx.bloom, (v) => (fx.bloom = v), { min: 0, max: 2 }));
  look.push(ui.slider('Bloom threshold', () => fx.bloomThreshold, (v) => (fx.bloomThreshold = v), { min: 0.2, max: 2 }));
  look.push(ui.slider('Exposure', () => fx.exposure, (v) => (fx.exposure = v), { min: 0.2, max: 3 }));
  look.push(ui.toggle('Filmic tonemap', () => fx.tonemap !== false, (v) => (fx.tonemap = v)));


  return [
    ui.section('World', world),
    ui.section('Camera interaction', cam),
    ui.section('Effects look', look),
    ui.section('Sound', soundSection(ui, fx)),
  ];
}

function paramControl(ui, spc, get, set) {
  const el = ui.el;
  switch (spc.type) {
    case 'bool':
      return el('div', { class: 'row' }, [ui.toggle(spc.label, get, set)]);
    case 'color':
      return ui.colorRow(spc.label, get, set);
    case 'select':
      return ui.selectRow(spc.label, spc.options, get, set);
    case 'text':
      return ui.textRow(spc.label, get, set);
    default: {
      const step = spc.step || 0.01;
      const dec = step >= 1 ? 0 : step >= 0.01 ? 2 : step >= 0.001 ? 3 : 4;
      return ui.slider(spc.label, get, set, {
        min: spc.min, max: spc.max, step,
        fmt: (v) => Number(v).toFixed(dec),
      });
    }
  }
}


// --------------------------------------------------------------- sound ----
const METERS = [['level', 'LVL'], ['bass', 'BAS'], ['low', 'LOW'], ['mid', 'MID'], ['high', 'HI'], ['air', 'AIR']];

function soundSection(ui, fx) {
  const el = ui.el;
  const a = fx.audio;
  const rows = [];
  rows.push(el('div', { class: 'fxhead', text: 'Sound' }));
  rows.push(el('div', { class: 'row' }, [
    ui.toggle('React to sound', () => !!a.enabled, (v) => (a.enabled = v)),
  ]));

  // live meter
  const bars = METERS.map(([k, label]) => {
    const fill = el('i', {});
    const bar = el('div', { class: 'bar' }, [fill, el('span', { class: 'lbl', text: label })]);
    return { k, bar, fill };
  });
  const dot = el('div', { class: 'beatdot', title: 'Beat' });
  rows.push(el('div', { class: 'meter' }, [...bars.map((b) => b.bar), dot]));
  const readout = el('div', { class: 'hint mono' });
  rows.push(readout);
  ui.onFrame(() => {
    const f = ui.audio();
    for (const b of bars) b.fill.style.height = Math.round((f[b.k] || 0) * 100) + '%';
    dot.classList.toggle('on', (f.beat || 0) > 0.35);
    readout.textContent = !a.enabled ? 'off'
      : f.live ? `listening · ${f.bpm || '--'} bpm`
      : 'no audio reaching the analyser — check "Audio from" in Output';
    readout.style.color = a.enabled && !f.live ? 'var(--warn)' : '';
  });

  rows.push(ui.slider('Sensitivity', () => a.sensitivity, (v) => (a.sensitivity = v), { min: 0.2, max: 5, fmt: (v) => v.toFixed(2) }));
  rows.push(ui.slider('Attack', () => a.attack, (v) => (a.attack = v), { min: 0.002, max: 0.3, step: 0.002, fmt: (v) => Math.round(v * 1000) + 'ms' }));
  rows.push(ui.slider('Release', () => a.release, (v) => (a.release = v), { min: 0.02, max: 1.2, step: 0.01, fmt: (v) => Math.round(v * 1000) + 'ms' }));
  rows.push(ui.slider('Beat sensitivity', () => a.beatThreshold, (v) => (a.beatThreshold = v), { min: 0.4, max: 4, fmt: (v) => v.toFixed(2) }));

  rows.push(el('div', { class: 'hint', text: 'Sound also drives the world. Amounts are relative: +1 doubles the value at full level.' }));
  rows.push(ui.selectRow('Driven by', SOURCES.filter((o) => o[0] !== 'none'),
    () => a.globalSrc || 'level', (v) => (a.globalSrc = v)));
  for (const [k, label] of [['gravity', 'Gravity'], ['timeScale', 'Speed'], ['wind', 'Wind'], ['bloom', 'Bloom'], ['exposure', 'Exposure']]) {
    rows.push(ui.slider(label, () => a.globals[k] || 0, (v) => (a.globals[k] = v), { min: -1, max: 3, fmt: (v) => v.toFixed(2) }));
  }
  return rows;
}

function soundLinks(ui, fx, sel, spec) {
  const el = ui.el;
  const rows = [];
  rows.push(el('div', { class: 'fxhead', text: 'Sound links' }));
  if (!fx.audio.enabled) {
    rows.push(el('div', { class: 'hint', text: 'Turn on "React to sound" below to use these.' }));
  }

  // beat trigger
  if (spec.actions && spec.actions.length) {
    const trig = sel.trig || (sel.trig = { src: 'beat', action: '', every: 1 });
    rows.push(ui.selectRow('On the beat',
      [['', '— nothing —'], ...spec.actions.map((x) => [x.name, x.label])],
      () => trig.action || '', (v) => { trig.action = v; }));
    if (trig.action) {
      rows.push(ui.slider('Every', () => trig.every || 1, (v) => (trig.every = Math.round(v)),
        { min: 1, max: 16, step: 1, fmt: (v) => Math.round(v) + (Math.round(v) === 1 ? ' beat' : ' beats') }));
    }
  }

  const mods = sel.mod || (sel.mod = []);
  const modParams = (spec.params || []).filter((p) => p.type === 'range' || p.type === 'bool');
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i];
    const pSel = el('select', { title: 'Parameter' });
    for (const p of modParams) pSel.appendChild(el('option', { value: p.key, text: p.label }));
    pSel.value = m.p || (modParams[0] && modParams[0].key) || '';
    if (!m.p) m.p = pSel.value;
    pSel.onchange = () => { m.p = pSel.value; ui.push(true); };

    const sSel = el('select', { title: 'Sound source' });
    for (const [v, t] of SOURCES) sSel.appendChild(el('option', { value: v, text: t }));
    sSel.value = m.src || 'level';
    sSel.onchange = () => { m.src = sSel.value; ui.push(true); };

    const amt = el('input', { type: 'range', min: -1, max: 2, step: 0.01, title: 'Amount' });
    amt.value = m.amt == null ? 1 : m.amt;
    amt.oninput = () => { m.amt = Number(amt.value); ui.push(); };

    rows.push(el('div', { class: 'modrow' }, [
      pSel, sSel, amt,
      el('span', { class: 'x', text: '\u2715', title: 'Remove',
        onclick: () => { mods.splice(i, 1); ui.push(true); ui.rebuild(); } }),
    ]));
  }
  rows.push(el('div', { class: 'row' }, [
    el('button', {
      class: 'btn sm grow', text: '+ Link a parameter to the sound',
      onclick: () => {
        mods.push({ p: modParams[0] ? modParams[0].key : '', src: 'bass', amt: 1, mode: 'add' });
        ui.push(true); ui.rebuild();
      },
    }),
  ]));
  return rows;
}


// ------------------------------------------------------------ catalogue ----
// The middle of the Effects view: every effect as a card with a captured
// thumbnail, searchable and filtered by group, with the scenes along the top.
// Built once; only the "in the stack" badges refresh on later rebuilds.

export const thumbUrl = (type) => '/renderer/control/fx-thumbs/' + type + '.jpg';
export const clipUrl = (type) => '/renderer/control/fx-thumbs/' + type + '.webm';

// A card shows its captured still; hovering it plays the recorded clip of the
// effect in motion (scripts/fx-thumbs.mjs records both). Clips that do not
// exist fail quietly and the still stays.
const noClip = new Set();
function hoverClip(thumbEl, type) {
  let vid = null, timer = null;
  const start = () => {
    if (vid || noClip.has(type)) return;
    vid = document.createElement('video');
    vid.className = 'fxClip'; vid.muted = true; vid.loop = true; vid.playsInline = true; vid.autoplay = true;
    vid.src = clipUrl(type);
    vid.onerror = () => { noClip.add(type); stop(); };
    vid.oncanplay = () => vid.classList.add('on');
    thumbEl.appendChild(vid);
    vid.play().catch(() => {});
  };
  const stop = () => {
    clearTimeout(timer); timer = null;
    if (vid) { try { vid.pause(); vid.removeAttribute('src'); vid.load(); } catch {} vid.remove(); vid = null; }
  };
  thumbEl.addEventListener('pointerenter', () => { clearTimeout(timer); timer = setTimeout(start, 120); });
  thumbEl.addEventListener('pointerleave', stop);
}

const browserState = { q: '', group: '', el: null, refresh: null, editing: false, setKey: '' };

// the active effect set, from settings: { name, types } or null for everything
function activeSet(ui) {
  const st = ui.settings ? ui.settings() : {};
  if (!st.fxSet) return null;
  return (st.fxSets || []).find((x) => x.name === st.fxSet) || null;
}

export function buildFxBrowser(ui) {
  if (browserState.el) { browserState.refresh(); return browserState.el; }
  const el = ui.el;
  const root = el('div', { class: 'fxBrowse' });

  // tools
  const search = el('input', { type: 'text', placeholder: 'Search effects…', class: 'fxSearch', value: browserState.q });
  const chips = el('div', { class: 'fxChips' });
  const byGroup = new Map();
  for (const e of EFFECTS) { const g = e.group || 'Other'; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(e); }
  const groups = [...byGroup.keys()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const chip = (label, value) => el('button', {
    class: 'chip' + (browserState.group === value ? ' on' : ''), text: label,
    onclick: () => { browserState.group = value; render(); },
  });
  // Sets: a named shortlist of effects so the catalogue shows only what you
  // picked for tonight. "Edit" shows every effect with a check box per card.
  const setsBar = el('div', { class: 'fxSets' });
  const renderSets = () => {
    setsBar.innerHTML = '';
    const st = ui.settings ? ui.settings() : {};
    const sets = st.fxSets || [];
    const cur = activeSet(ui);
    const sel = el('select', { title: 'Effect set' });
    sel.appendChild(el('option', { value: '', text: 'All effects' }));
    for (const s of sets) sel.appendChild(el('option', { value: s.name, text: s.name + ' (' + s.types.length + ')' }));
    sel.appendChild(el('option', { value: '__new', text: '+ New set…' }));
    sel.value = cur ? cur.name : '';
    sel.onchange = async () => {
      if (sel.value === '__new') {
        const name = await ui.prompt('Name the set');
        sel.value = cur ? cur.name : '';
        if (!name || !name.trim()) return;
        const n = name.trim();
        if (sets.some((s) => s.name === n)) { ui.toast('There is already a set called ' + n); return; }
        ui.patchSettings({ fxSets: [...sets, { name: n, types: [] }], fxSet: n });
        browserState.editing = true;
        return;
      }
      browserState.editing = false;
      ui.patchSettings({ fxSet: sel.value });
    };
    setsBar.appendChild(el('span', { class: 'hint', text: 'Set' }));
    setsBar.appendChild(sel);
    if (cur) {
      const edit = el('button', { class: 'btn sm' + (browserState.editing ? ' on' : ''), text: browserState.editing ? 'Done' : 'Edit set',
        title: 'Choose which effects belong to this set', onclick: () => { browserState.editing = !browserState.editing; render(); } });
      setsBar.appendChild(edit);
      if (browserState.editing) {
        setsBar.appendChild(el('button', { class: 'btn sm', text: 'Rename', onclick: async () => {
          const name = await ui.prompt('Rename the set');
          if (!name || !name.trim()) return;
          const n = name.trim();
          ui.patchSettings({ fxSets: sets.map((s) => (s.name === cur.name ? { ...s, name: n } : s)), fxSet: n });
        } }));
        setsBar.appendChild(el('button', { class: 'btn sm danger', text: 'Delete set', onclick: () => {
          browserState.editing = false;
          ui.patchSettings({ fxSets: sets.filter((s) => s.name !== cur.name), fxSet: '' });
        } }));
        setsBar.appendChild(el('span', { class: 'hint', text: 'Tick the effects that belong in this set. Scenes show when every effect they use is in it.' }));
      }
    }
  };
  root.appendChild(el('div', { class: 'fxTools' }, [search, chips, setsBar]));

  const body = el('div', { class: 'fxBody' });
  root.appendChild(body);

  const inStack = (type) => (ui.project().fx.layers || []).filter((L) => L.type === type).length;

  const addLayer = (type) => {
    const fx = ui.project().fx;
    const L = defaultFxLayer(type);
    (fx.layers || (fx.layers = [])).push(L);
    fx.enabled = true;
    ui.selectLayer(L.id);
    ui.push(true);
    ui.rebuild();
    ui.toast('Added ' + (REGISTRY.get(type)?.label || type));
  };

  const toggleInSet = (type, on) => {
    const st = ui.settings();
    const sets = st.fxSets || [];
    ui.patchSettings({ fxSets: sets.map((s) => {
      if (s.name !== st.fxSet) return s;
      const types = new Set(s.types);
      if (on) types.add(type); else types.delete(type);
      return { ...s, types: [...types] };
    }) });
  };

  const card = (e) => {
    const n = inStack(e.type);
    const cur = activeSet(ui);
    const inSet = !cur || cur.types.includes(e.type);
    const badge = el('span', { class: 'fxBadge' + (n ? ' on' : ''), text: n ? (n === 1 ? 'in the stack' : n + ' in the stack') : '' });
    const img = el('img', { src: thumbUrl(e.type), alt: '', loading: 'lazy' });
    img.onerror = () => { img.replaceWith(el('div', { class: 'fxNoThumb', text: e.label[0] })); };
    const kids = [img, badge, el('span', { class: 'fxAdd', text: '+' })];
    let pick = null;
    if (cur && browserState.editing) {
      pick = el('input', { type: 'checkbox', class: 'fxPick', title: 'In this set' });
      pick.checked = inSet;
      pick.onclick = (ev) => ev.stopPropagation();
      pick.onchange = () => toggleInSet(e.type, pick.checked);
      kids.push(pick);
    }
    const thumb = el('div', { class: 'fxThumb' }, kids);
    hoverClip(thumb, e.type);
    const c = el('button', { class: 'fxCard' + (cur && browserState.editing && !inSet ? ' dim' : ''), title: 'Add ' + e.label, 'data-type': e.type }, [
      thumb,
      el('div', { class: 'fxCardBody' }, [
        el('div', { class: 'fxCardName', text: e.label }),
        el('div', { class: 'fxCardHint', text: e.hint || '' }),
      ]),
    ]);
    c.onclick = () => addLayer(e.type);
    return c;
  };

  const sceneCard = (s) => {
    const first = s.layers[0] && s.layers[0][0];
    const img = el('img', { src: thumbUrl(first), alt: '', loading: 'lazy' });
    img.onerror = () => { img.replaceWith(el('div', { class: 'fxNoThumb', text: s.name[0] })); };
    const tags = el('div', { class: 'fxTags' }, s.layers.map(([t]) => el('span', { class: 'tag', text: REGISTRY.get(t)?.label || t })));
    const sthumb = el('div', { class: 'fxThumb' }, [img, s.audio ? el('span', { class: 'fxBadge on', text: '♪ reacts to sound' }) : null]);
    hoverClip(sthumb, first);
    const c = el('button', { class: 'fxCard scene', title: s.note || s.name }, [
      sthumb,
      el('div', { class: 'fxCardBody' }, [
        el('div', { class: 'fxCardName', text: s.name }),
        tags,
      ]),
    ]);
    c.onclick = () => {
      const fx = ui.project().fx;
      const firstId = applyScene(fx, s);
      ui.selectLayer(firstId);
      ui.push(true);
      ui.rebuild();
      ui.toast(s.note || s.name);
    };
    return c;
  };

  function render() {
    renderSets();
    chips.innerHTML = '';
    chips.appendChild(chip('All', ''));
    chips.appendChild(chip('Scenes', 'scenes'));
    for (const g of groups) chips.appendChild(chip(g, g));

    body.innerHTML = '';
    const q = browserState.q.trim().toLowerCase();
    const cur = activeSet(ui);
    const allowed = cur && !browserState.editing ? new Set(cur.types) : null;
    const match = (e) => (!allowed || allowed.has(e.type)) && (!q || (e.label + ' ' + e.type + ' ' + (e.hint || '') + ' ' + (e.group || '')).toLowerCase().includes(q));

    if (!browserState.group || browserState.group === 'scenes') {
      const list = SCENES.filter((s) => (!allowed || s.layers.every((l) => allowed.has(l[0])))
        && (!q || (s.name + ' ' + (s.note || '') + ' ' + s.layers.map((l) => l[0]).join(' ')).toLowerCase().includes(q)));
      if (list.length) {
        body.appendChild(el('div', { class: 'fxGroupHead' }, [
          el('h2', { text: 'Scenes' }),
          el('span', { class: 'hint', text: 'Ready-made stacks. Applying one replaces the current layers.' }),
        ]));
        body.appendChild(el('div', { class: 'fxGrid scenes' }, list.map(sceneCard)));
      }
    }
    if (browserState.group !== 'scenes') {
      for (const g of groups) {
        if (browserState.group && browserState.group !== g) continue;
        const list = byGroup.get(g).filter(match);
        if (!list.length) continue;
        body.appendChild(el('div', { class: 'fxGroupHead' }, [
          el('h2', { text: g }),
          el('span', { class: 'hint', text: GROUP_BLURB[g] || '' }),
          el('span', { class: 'count', text: list.length + (list.length === 1 ? ' effect' : ' effects') }),
        ]));
        body.appendChild(el('div', { class: 'fxGrid' }, list.map(card)));
      }
    }
    if (!body.children.length) {
      body.appendChild(el('div', { class: 'hint fxEmpty', text: allowed && !q
        ? 'This set is empty. Press "Edit set" and tick the effects you want in it.'
        : 'Nothing matches “' + browserState.q + '”.' }));
    }
    browserState.setKey = JSON.stringify([cur, browserState.editing]);
  }

  search.oninput = () => { browserState.q = search.value; render(); };
  search.onkeydown = (e) => { if (e.key === 'Escape') { search.value = ''; browserState.q = ''; render(); } e.stopPropagation(); };
  render();

  browserState.el = root;
  browserState.refresh = () => {
    // the set changed under us (settings arrived): draw the catalogue again
    const key = JSON.stringify([activeSet(ui), browserState.editing]);
    if (key !== browserState.setKey) { render(); return; }
    for (const c of root.querySelectorAll('.fxCard[data-type]')) {
      const n = inStack(c.dataset.type);
      const b = c.querySelector('.fxBadge');
      b.textContent = n ? (n === 1 ? 'in the stack' : n + ' in the stack') : '';
      b.classList.toggle('on', n > 0);
    }
  };
  return root;
}

const GROUP_BLURB = {
  Fluid: 'Gas solvers over the picture: smoke, fire and ink that roll around your shapes.',
  Water: 'Liquids and waves that refract the picture.',
  Physics: 'Rigid bodies, sand and a self-playing game that stack on your shapes.',
  Weather: 'Snow and rain that collide and settle.',
  Particles: 'Confetti and a flock that steers around the shapes.',
  Energy: 'Lightning, aurora, gravity and fire that burns the picture away.',
  Growth: 'Vines that grow into the open wall between your shapes.',
  Shapes: 'These act on the shapes you masked: shadows, blocks, lights and neon. Each mask has an “Effects see this shape” toggle.',
  Trippy: 'The picture folded, tiled, mirrored and fed back into itself.',
  Retro: 'Synthwave horizons, worn tape and digital tears.',
  Look: 'Image treatments: print, text, 8-bit, paint, thermal, glass.',
  Generative: 'The picture run through generative systems, after the Max Cooper videos: reaction-diffusion, automata, symmetry operations, infinite zooms, networks, tree maps, weaving.',
  AI: 'The film read by a model ahead of the playhead and written or painted back over itself. Turn AI on in Setup; the director there can also steer the whole stack.',
  People: 'Everyone who pixelated themselves on the phone, living on your wall. Manage the roster in People.',
};
