// The Effects panel: master controls, the layer stack, and a generated
// parameter editor driven by each effect's own schema, so adding an effect
// never means touching the UI.

import { REGISTRY, QUALITY } from '/shared/fx/system.mjs';
import { SOURCES } from '/shared/fx/audio.mjs';
import { defaultFxLayer } from '/shared/schema.mjs';
import { EFFECTS } from '/shared/fx/effects/index.mjs';

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
    name: 'Shatter on the drop', note: 'The picture breaks every eighth beat and rebuilds itself.',
    audio: { globals: { gravity: 0, timeScale: 0, bloom: 0.5, exposure: 0, wind: 0 }, globalSrc: 'level' },
    layers: [['shatter', { pieces: 90, burst: 0.8, reveal: 0.15 }, {
      trig: { src: 'beat', action: 'break', every: 8 },
      mod: [{ p: 'glint', src: 'high', amt: 1.2 }],
    }]],
  },
];

const GROUP_ORDER = ['Fluid', 'Water', 'Physics', 'Weather', 'Particles', 'Energy', 'Growth'];

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
  if (!fx.enabled) {
    rows.push(el('div', { class: 'hint', text: 'Physics and simulation layers drawn over the mapped video, in projector space. Everything collides with the shapes you have masked.' }));
  }

  rows.push(ui.selectRow('Quality', Object.keys(QUALITY).map((k) => [k, k[0].toUpperCase() + k.slice(1)]),
    () => fx.quality || 'high', (v) => { fx.quality = v; }));

  // ---------------------------------------------------------- layer stack
  const list = el('div', { style: 'display:flex;flex-direction:column;gap:2px' });
  const layers = fx.layers || (fx.layers = []);
  if (!layers.length) list.appendChild(el('div', { class: 'hint', text: 'No effects yet — add one below, or pick a scene.' }));
  layers.forEach((L, i) => {
    const spec = REGISTRY.get(L.type);
    const on = ui.selectedLayer() === L.id;
    const row = el('div', { class: 'lay' + (on ? ' on' : '') + (L.enabled === false ? '' : ' vis') }, [
      el('span', { class: 'eye', text: L.enabled === false ? '○' : '●',
        title: 'Show / hide',
        onclick: (e) => { e.stopPropagation(); L.enabled = L.enabled === false; ui.push(true); ui.rebuild(); } }),
      el('span', { class: 'nm', text: L.name || (spec ? spec.label : L.type) }),
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

  // add menu
  const addSel = el('select', {});
  addSel.appendChild(el('option', { value: '', text: '+ Add an effect…' }));
  const byGroup = new Map();
  for (const e of EFFECTS) {
    const g = e.group || 'Other';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(e);
  }
  const groups = [...byGroup.keys()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  for (const g of groups) {
    const og = el('optgroup', { label: g });
    for (const e of byGroup.get(g)) og.appendChild(el('option', { value: e.type, text: e.label }));
    addSel.appendChild(og);
  }
  addSel.onchange = () => {
    const t = addSel.value;
    addSel.value = '';
    if (!t) return;
    const L = defaultFxLayer(t);
    layers.push(L);
    fx.enabled = true;
    ui.selectLayer(L.id);
    ui.push(true);
    ui.rebuild();
  };
  rows.push(el('div', { class: 'row nowrap' }, [addSel]));

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
      const get = (k, d) => (sel.params && sel.params[k] != null ? sel.params[k] : d);
      const set = (k, v) => { (sel.params || (sel.params = {}))[k] = v; };
      for (const spc of spec.params || []) {
        rows.push(paramControl(ui, spc, () => get(spc.key, spc.def), (v) => set(spc.key, v)));
      }
      rows.push(...soundLinks(ui, fx, sel, spec));
      rows.push(el('button', {
        class: 'btn sm', text: 'Reset this effect',
        onclick: () => { sel.params = {}; sel.mod = []; sel.trig = null; ui.push(true); ui.rebuild(); },
      }));
    }
  }

  // ------------------------------------------------------------- world
  rows.push(el('div', { class: 'fxhead', text: 'World' }));
  rows.push(ui.slider('Gravity', () => fx.gravity, (v) => (fx.gravity = v), { min: -2, max: 4, fmt: (v) => v.toFixed(2) }));
  rows.push(ui.slider('Wind', () => fx.windX, (v) => (fx.windX = v), { min: -2, max: 2, fmt: (v) => v.toFixed(2) }));
  rows.push(ui.slider('Time scale', () => fx.timeScale, (v) => (fx.timeScale = v), { min: 0, max: 3, fmt: (v) => v.toFixed(2) + 'x' }));
  rows.push(el('div', { class: 'row' }, [
    ui.toggle('Masks are solid', () => fx.collideMasks !== false, (v) => (fx.collideMasks = v)),
    ui.toggle('Area edges solid', () => !!fx.collideSurfaceEdges, (v) => (fx.collideSurfaceEdges = v)),
  ]));
  const walls = fx.walls || (fx.walls = { l: true, r: true, t: false, b: true });
  rows.push(el('div', { class: 'row' }, [
    el('span', { class: 'hint', text: 'Walls' }),
    ui.toggle('Floor', () => walls.b, (v) => (walls.b = v)),
    ui.toggle('Ceiling', () => walls.t, (v) => (walls.t = v)),
    ui.toggle('Sides', () => walls.l && walls.r, (v) => { walls.l = v; walls.r = v; }),
  ]));
  rows.push(el('div', { class: 'row' }, [
    ui.toggle('Pointer interacts', () => fx.interact.pointer !== false, (v) => (fx.interact.pointer = v)),
    ui.toggle('Pause with video', () => !!fx.pauseWithVideo, (v) => (fx.pauseWithVideo = v)),
  ]));
  rows.push(ui.slider('Pointer reach', () => fx.interact.radius, (v) => (fx.interact.radius = v), { min: 0.01, max: 0.4, fmt: (v) => v.toFixed(2) }));

  // ------------------------------------------------------------ camera
  rows.push(el('div', { class: 'fxhead', text: 'Camera interaction' }));
  const ready = ui.cameraReady();
  rows.push(el('div', { class: 'row' }, [
    ui.toggle('People push things', () => !!fx.interact.camera, (v) => (fx.interact.camera = v)),
    ui.toggle('Show tracking', () => !!fx.interact.cameraDebug, (v) => (fx.interact.cameraDebug = v)),
  ]));
  rows.push(ui.slider('Sensitivity', () => fx.interact.cameraSensitivity,
    (v) => (fx.interact.cameraSensitivity = v), { min: 0.2, max: 4, fmt: (v) => v.toFixed(2) }));
  rows.push(ui.slider('Push strength', () => fx.interact.cameraForce,
    (v) => (fx.interact.cameraForce = v), { min: 0, max: 4, fmt: (v) => v.toFixed(2) }));
  const camState = el('div', { class: 'hint' });
  ui.live(() => {
    const r = ui.cameraReady();
    camState.textContent = r
      ? (fx.interact.camera ? `Tracking ${ui.motionBlobs()} moving region${ui.motionBlobs() === 1 ? '' : 's'}.`
                            : 'Camera is aligned and ready.')
      : 'Start a camera and press "Align to wall" first — the tracker reuses that alignment to know where in the projected picture each movement is.';
    camState.style.color = r ? '' : 'var(--dim2)';
  });
  rows.push(camState);

  rows.push(el('div', { class: 'fxhead', text: 'Look' }));
  rows.push(ui.slider('Bloom', () => fx.bloom, (v) => (fx.bloom = v), { min: 0, max: 2 }));
  rows.push(ui.slider('Bloom threshold', () => fx.bloomThreshold, (v) => (fx.bloomThreshold = v), { min: 0.2, max: 2 }));
  rows.push(ui.slider('Exposure', () => fx.exposure, (v) => (fx.exposure = v), { min: 0.2, max: 3 }));
  rows.push(ui.toggle('Filmic tonemap', () => fx.tonemap !== false, (v) => (fx.tonemap = v)));

  rows.push(...soundSection(ui, fx));

  // ----------------------------------------------------------- scenes
  rows.push(el('div', { class: 'fxhead', text: 'Scenes' }));
  const grid = el('div', { class: 'quad' });
  for (const s of SCENES) {
    grid.appendChild(el('button', {
      class: 'btn sm', text: s.name, title: s.note || '',
      onclick: () => {
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
        ui.selectLayer(fx.layers[0] ? fx.layers[0].id : null);
        ui.push(true);
        ui.rebuild();
        ui.toast(s.note || s.name);
      },
    }));
  }
  rows.push(grid);
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
