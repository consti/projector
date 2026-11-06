// Visuals in place of the picture. createVisualsMode() holds the choice
// (for every track, for particular tracks, or off) and the shared settings,
// and is made early because the top bar, the playlist and the keys use it;
// createVisualsPanel() builds the Visuals view's panel and catalogue from it.
import { Visuals, visualsOn, videoKey, VISUAL_SCENES, VISUAL_SCENE_HINTS, VISUAL_PALETTE_NAMES, VISUAL_CITIES, VISUAL_DAYTIMES, DEFAULT_VISUAL_EMOJI, defaultVisualsCfg } from '/shared/visuals.mjs';
import { targetTime } from '/shared/player.mjs';
import { visualsCfgFor, hasVisualsOverride } from '/shared/visuals-cfg.mjs';
import { $, el, pc, help, note, head } from '/renderer/control/ui.mjs';

export function createVisualsMode(ctx) {
  const { toast, isMusicSource } = ctx;
  const S = ctx.state;

  // Visuals in place of the picture: for every track (settings.visuals), or for
  // particular videos that are not worth watching (settings.visualsFor).
  const visualsCfg = () => visualsCfgFor(S());

  // A change goes to the track's own settings while it has some, otherwise to
  // the settings every track shares.
  function patchVisualsCfg(p) {
    const key = videoKey(S().transport.source);
    if (key && hasVisualsOverride(S())) {
      const by = { ...(S().settings.visualsByKey || {}) };
      by[key] = { ...by[key], ...p };
      api.patchState({ settings: { visualsByKey: by } });
    } else {
      api.patchState({ settings: { visualsCfg: { ...defaultVisualsCfg(), ...(S().settings.visualsCfg || {}), ...p } } });
    }
  }

  function setVisualsOverride(on) {
    const key = videoKey(S().transport.source);
    if (!key) { toast('Nothing is playing to remember'); return; }
    const by = { ...(S().settings.visualsByKey || {}) };
    if (on) by[key] = { ...visualsCfg() };      // start from what shows now
    else delete by[key];
    api.patchState({ settings: { visualsByKey: by } });
    toast(on ? 'This track keeps its own visuals settings' : 'This track uses the shared settings again', 1600);
  }

  const hidesVideo = (key) => !!key && !!S() && (S().settings.visualsFor || []).includes(key);

  function setHidesVideo(key, on) {
    if (!key) return;
    const list = (S().settings.visualsFor || []).filter((k) => k !== key);
    if (on) list.push(key);
    api.patchState({ settings: { visualsFor: list } });
  }

  // What the wall shows, as one choice made in one place: the video, visuals for
  // this track only (remembered for it), or visuals for every track. An Apple
  // Music song has no picture, so it always gets visuals.
  const VIS_MODES = [
    ['video', 'Video', 'The video shows on the wall'],
    ['track', 'Visuals \u00b7 track', 'Visuals instead of this video, every time it plays (H)'],
    ['always', 'Visuals \u00b7 all', 'Visuals instead of every video'],
  ];

  function visualsMode() {
    if (!S()) return 'video';
    if (isMusicSource()) return 'music';
    if (S().settings.visuals) return 'always';
    return hidesVideo(videoKey(S().transport.source)) ? 'track' : 'video';
  }

  function setVisualsMode(m) {
    if (!S() || visualsMode() === 'music') return;
    const key = videoKey(S().transport.source);
    const list = (S().settings.visualsFor || []).filter((k) => k !== key);
    if (m === 'track') {
      if (!key) { toast('Nothing is playing to remember'); return; }
      list.push(key);
    }
    api.patchState({ settings: { visuals: m === 'always', visualsFor: list } });
    toast(m === 'always' ? 'Visuals instead of every video' : m === 'track' ? 'Visuals instead of this video, every time it plays' : 'Showing the video', 1600);
  }

  function visModeSeg() {
    const seg = el('div', { class: 'seg visSeg' }, VIS_MODES.map(([m, label, title]) =>
      el('button', { class: 'btn sm', 'data-mode': m, text: label, title, onclick: () => setVisualsMode(m) })));
    syncVisSeg(seg);
    return seg;
  }

  function syncVisSeg(seg) {
    const mode = visualsMode();
    const music = mode === 'music';
    seg.classList.toggle('forced', music);
    seg.title = music ? 'An Apple Music song is playing: it has no picture, so visuals stand in for it' : 'What the wall shows (Visuals view)';
    for (const b of seg.querySelectorAll('button')) {
      const m = b.dataset.mode;
      b.classList.toggle('on', m === mode || (music && m === 'always'));
      b.disabled = music;
    }
  }

  const syncVisSegs = () => { for (const seg of document.querySelectorAll('.visSeg')) syncVisSeg(seg); };

  return { visualsCfg, patchVisualsCfg, setVisualsOverride, hidesVideo, setHidesVideo, VIS_MODES, visualsMode, setVisualsMode, visModeSeg, syncVisSeg, syncVisSegs };
}

export function createVisualsPanel(ctx) {
  const { toast, visualsHost, fxHost, updaters, frameUpdaters } = ctx;
  const { section, slider, toggle, selectRow } = ctx.W;
  const { visualsCfg, patchVisualsCfg, setVisualsOverride, visualsMode } = ctx.visuals;
  const project = ctx.project, S = ctx.state, currentView = ctx.currentView;

  // the emoji the two emoji scenes draw from; applied when the field is left
  function emojiRow() {
    const inp = el('input', { type: 'text', placeholder: DEFAULT_VISUAL_EMOJI });
    const show = () => { if (document.activeElement !== inp) inp.value = visualsCfg().emoji || ''; };
    inp.onchange = () => patchVisualsCfg({ emoji: inp.value.trim() || DEFAULT_VISUAL_EMOJI });
    inp.onkeydown = (e) => e.stopPropagation();
    updaters.push(show); show();
    return el('div', { class: 'ctl wide' }, [el('label', { text: 'Emoji' }), inp]);
  }

  function visualsSection() {
    const cfg = visualsCfg;
    const sceneName = (sc) => (VISUAL_SCENES.find((x) => x[0] === sc) || [sc, sc])[1];
    // what the wall shows right now, and why
    const nowLine = el('div', { class: 'visNow' });
    const why = el('div', { class: 'hint' });
    const showNow = () => {
      const mode = visualsMode();
      const pattern = !!(project().global.testPattern && project().global.testPattern !== 'off');
      const on = !pattern && visualsOn(S());
      const sc = visualsHost.scene;
      const txt = pattern ? 'A test pattern' : !on ? 'The video' : visualsHost.error ? 'Visuals failed' : 'Visuals \u00b7 ' + (sc ? sceneName(sc) : '\u2026');
      const reason = pattern ? 'A test pattern is up (Map view). Set it to Off to see the picture again.'
        : on && visualsHost.error ? visualsHost.error
        : mode === 'music' ? 'An Apple Music song has no picture, so visuals stand in for it.'
        : mode === 'always' ? 'Visuals replace every video.'
        : mode === 'track' ? 'This track is marked to play with visuals. Other tracks show their video.'
        : 'Visuals are off for this track.';
      if (nowLine.textContent !== txt) nowLine.textContent = txt;
      if (why.textContent !== reason) why.textContent = reason;
      nowLine.classList.toggle('vis', on);
    };
    frameUpdaters.push(showNow); showNow();

    // whose settings the controls below edit
    const scope = el('div', { class: 'hint' });
    const showScope = () => {
      const own = hasVisualsOverride(S());
      const t = S().transport.source && S().transport.source.title;
      scope.textContent = own ? 'These settings belong to this track' + (t ? ' (' + t + ')' : '') + '.' : 'These settings are shared by every track.';
    };
    updaters.push(showScope); showScope();

    const held = el('div', { class: 'hint' });
    const showHeld = () => {
      const c = cfg();
      const sc = c.scene;
      const when = c.changeOn === 'seconds' ? 'every ' + c.every + ' s' : 'every ' + (c.everyBars || 8) + ' bars';
      held.textContent = sc && sc !== 'auto'
        ? 'Holding ' + sceneName(sc) + '. Click Mix in the catalogue to let the scenes change again.'
        : 'Mixing every scene, a new one ' + when + '. Click a scene to hold it.';
    };
    updaters.push(showHeld); showHeld();

    // tempo: what the clock is locked to
    const tempoLine = el('div', { class: 'hint mono' });
    const showTempo = () => {
      const c = cfg();
      const v = visualsHost.visuals;
      const t = v && v.tempo ? v.tempo : null;
      const f = fxHost.features();
      let txt;
      if (c.bpm > 0) txt = 'Set by hand: ' + Math.round(c.bpm) + ' bpm';
      else if (t && t.source === 'auto' && t.bpm) txt = 'Detected ' + Math.round(t.bpm) + ' bpm' + (t.locked ? ', locked' : ', settling\u2026');
      else if (f.bpm) txt = 'Detected ' + f.bpm + ' bpm';
      else txt = 'No tempo yet \u2014 waiting for the beat';
      if (tempoLine.textContent !== txt) tempoLine.textContent = txt;
    };
    frameUpdaters.push(showTempo); showTempo();
    // a tempo set by hand: a number, or tapped in
    const bpmInp = el('input', { type: 'number', min: 40, max: 220, step: 1, placeholder: 'auto' });
    const showBpm = () => { if (document.activeElement !== bpmInp) bpmInp.value = cfg().bpm > 0 ? Math.round(cfg().bpm) : ''; };
    bpmInp.onchange = () => { const v = Number(bpmInp.value); patchVisualsCfg({ bpm: v >= 40 && v <= 220 ? v : 0 }); };
    bpmInp.onkeydown = (e) => e.stopPropagation();
    updaters.push(showBpm); showBpm();
    const taps = [];
    const tapBtn = el('button', { class: 'btn sm', text: 'Tap', title: 'Click along with the beat (four taps or more)', onclick: () => {
      const now = performance.now();
      if (taps.length && now - taps[taps.length - 1] > 2500) taps.length = 0;
      taps.push(now);
      while (taps.length > 12) taps.shift();
      if (taps.length < 4) { tapBtn.textContent = 'Tap ' + taps.length + '\u2026'; return; }
      const gaps = []; for (let i = 1; i < taps.length; i++) gaps.push(taps[i] - taps[i - 1]);
      gaps.sort((a, b) => a - b);
      const bpm = Math.round(60000 / gaps[gaps.length >> 1]);
      tapBtn.textContent = 'Tap';
      patchVisualsCfg({ bpm: Math.max(40, Math.min(220, bpm)) });
      toast('Tempo set to ' + bpm + ' bpm', 1400);
    } });
    const autoBtn = el('button', { class: 'btn sm', text: 'Auto', title: 'Follow the detected tempo again', onclick: () => { taps.length = 0; patchVisualsCfg({ bpm: 0 }); } });

    // settings that belong to one scene show only while that scene is chosen
    const forScene = (test, rows) => {
      const box = el('div', { class: 'visFor' }, rows);
      const show = () => { box.hidden = !test(cfg().scene); };
      updaters.push(show); show();
      return box;
    };
    const whenChange = (test, rows) => {
      const box = el('div', { class: 'visFor' }, rows);
      const show = () => { box.hidden = !test(cfg()); };
      updaters.push(show); show();
      return box;
    };
    const n2 = (v) => Number(v).toFixed(2);
    return section('Visuals', [
      note('On the wall now'),
      nowLine,
      why,

      head('Settings for'),
      el('div', { class: 'row' }, [
        toggle('Remember for this track', () => hasVisualsOverride(S()), (v) => setVisualsOverride(v), { push: false, title: 'Keep a separate set of the settings below for this track' }),
      ]),
      scope,

      head('Tempo'),
      tempoLine,
      el('div', { class: 'ctl wide' }, [el('label', { text: 'BPM' }), el('div', { class: 'row nowrap' }, [bpmInp, tapBtn, autoBtn])]),
      selectRow('Motion', [['beat', 'Locked to the beat'], ['free', 'Free, pushed by loudness']], () => cfg().sync || 'beat', (v) => patchVisualsCfg({ sync: v }),
        { tip: 'Locked, every scene steps with the beat and the tempo is read from the music; set the BPM by hand or tap it when the detector gets a track wrong.' }),

      head('Feel'),
      slider('Speed', () => cfg().speed, (v) => patchVisualsCfg({ speed: v }), { min: 0.2, max: 3, step: 0.05, fmt: (v) => n2(v) + 'x', push: false }),
      slider('Responds', () => cfg().react, (v) => patchVisualsCfg({ react: v }), { min: 0, max: 2, step: 0.05, fmt: pc, push: false, tip: 'How much the loudness and the bands drive the picture' }),
      slider('Beat kick', () => cfg().kick == null ? 1 : cfg().kick, (v) => patchVisualsCfg({ kick: v }), { min: 0, max: 2, step: 0.05, fmt: pc, push: false, tip: 'How hard each beat hits' }),
      slider('Smoothing', () => cfg().smooth == null ? 0.3 : cfg().smooth, (v) => patchVisualsCfg({ smooth: v }), { min: 0, max: 1, step: 0.05, fmt: pc, push: false, tip: 'Steadies a jittery track' }),
      slider('Brightness', () => cfg().gain == null ? 1 : cfg().gain, (v) => patchVisualsCfg({ gain: v }), { min: 0.3, max: 2, step: 0.05, fmt: pc, push: false }),

      head('Scenes'),
      held,
      selectRow('Change', [['bars', 'On the bar'], ['seconds', 'On a timer']], () => cfg().changeOn || 'bars', (v) => patchVisualsCfg({ changeOn: v })),
      whenChange((c) => (c.changeOn || 'bars') === 'bars', [
        selectRow('Every', [['4', '4 bars'], ['8', '8 bars'], ['16', '16 bars'], ['32', '32 bars']], () => String(cfg().everyBars || 8), (v) => patchVisualsCfg({ everyBars: Number(v) })),
      ]),
      whenChange((c) => c.changeOn === 'seconds', [
        slider('Every', () => cfg().every, (v) => patchVisualsCfg({ every: v }), { min: 10, max: 120, step: 5, fmt: (v) => v + ' s', push: false }),
      ]),
      selectRow('Colours', VISUAL_PALETTE_NAMES, () => cfg().palette, (v) => patchVisualsCfg({ palette: v })),
      forScene((sc) => sc === 'emoji' || sc === 'emojiwall', [emojiRow()]),
      forScene((sc) => sc === 'train', [
        selectRow('City', VISUAL_CITIES, () => cfg().city, (v) => patchVisualsCfg({ city: v })),
        selectRow('Time of day', VISUAL_DAYTIMES, () => cfg().daytime, (v) => patchVisualsCfg({ daytime: v })),
        slider('Haze', () => cfg().haze, (v) => patchVisualsCfg({ haze: v }), { min: 0, max: 1, step: 0.05, fmt: pc, push: false }),
        slider('Line height', () => cfg().ride, (v) => patchVisualsCfg({ ride: v }), { min: 0, max: 1, step: 0.05, fmt: pc, push: false }),
      ]),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn sm grow', text: 'Reset these settings', onclick: () => {
          const key = videoKey(S().transport.source);
          if (key && hasVisualsOverride(S())) { const by = { ...(S().settings.visualsByKey || {}) }; by[key] = {}; api.patchState({ settings: { visualsByKey: by } }); }
          else api.patchState({ settings: { visualsCfg: defaultVisualsCfg() } });
        } }),
      ]),
    ], { help: 'Generated scenes in place of the picture. Video / Visuals \u00b7 track / Visuals \u00b7 all in the top bar decides when they show: for this track only (H, or \u25D0 on a playlist item), or instead of every video. The mapping, the shapes, the TV and the effects all apply on top.' });
  }

  // The catalogue of scenes: a card per scene with its captured frame. Hovering
  // a card renders that scene live, small, to the current music, so you can
  // audition one without taking it to the wall. Built once; frame() keeps the
  // badges and the hovered card current.
  const visualsBrowser = (() => {
    const root = $('#visBrowser');
    const cards = new Map();
    let hover = null;              // scene id under the pointer
    let gl = null, live = null, glc = null;
    const W = 384, H = 216;
    const ensureLive = () => {
      if (gl) return !!live;
      glc = document.createElement('canvas'); glc.width = W; glc.height = H;
      gl = glc.getContext('webgl2', { antialias: false });
      if (!gl) return false;
      try { live = new Visuals(gl); } catch (e) { console.error('[visuals preview]', e); live = null; }
      return !!live;
    };
    const card = (id, label, hint) => {
      const cv = el('canvas', { class: 'visLive', width: W, height: H });
      const img = id === 'auto' ? el('div', { class: 'fxNoThumb', text: '\u2728' })
        : el('img', { src: '/renderer/control/visual-thumbs/' + id + '.jpg', alt: label, loading: 'lazy' });
      const c = el('button', { class: 'fxCard visScene', title: label }, [
        el('div', { class: 'fxThumb' }, [img, cv, el('span', { class: 'fxBadge now', text: 'on the wall' }), el('span', { class: 'fxBadge sel', text: id === 'auto' ? 'mixing' : 'held' })]),
        el('div', { class: 'fxCardBody' }, [el('div', { class: 'fxCardName', text: label }), hint ? el('div', { class: 'fxCardHint', text: hint }) : null]),
      ]);
      c.onclick = () => { patchVisualsCfg({ scene: id }); toast(id === 'auto' ? 'Mixing every scene' : 'Holding ' + label); };
      c.onmouseenter = () => { if (id !== 'auto') hover = id; };
      c.onmouseleave = () => { if (hover === id) { hover = null; cv.classList.remove('on'); } };
      cards.set(id, { el: c, cv });
      return c;
    };
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'fxGroupHead' }, [
      el('h2', { text: 'Visuals' }),
      help('Generated scenes that take the place of the picture and move with the sound. Click one to hold it; Mix walks through them all, changing every few seconds. Hover a card to see it live to the music that is playing. Whether they show at all is the Video / Visuals choice in the top bar.'),
      el('span', { class: 'count', text: VISUAL_SCENES.length + ' scenes' }),
    ]));
    const grid = el('div', { class: 'fxGrid' });
    grid.appendChild(card('auto', 'Mix', 'Every scene in turn, in a shuffled order, with a cross-fade between them.'));
    for (const [id, label] of VISUAL_SCENES) grid.appendChild(card(id, label, VISUAL_SCENE_HINTS[id]));
    root.appendChild(grid);

    const frame = () => {
      if (!S() || currentView() !== 'visuals') return;
      const sel = visualsCfg().scene, sc = visualsOn(S()) ? visualsHost.scene : null;
      for (const [id, c] of cards) {
        c.el.classList.toggle('on', id === sel);
        c.el.classList.toggle('now', !!sc && id === sc);
      }
      if (!hover || !ensureLive()) return;
      const c = cards.get(hover);
      const r = live.render({ w: W, h: H, time: targetTime(S().transport), audio: fxHost.features(), cfg: { ...visualsCfg(), scene: hover },
        key: S().transport.source && S().transport.source.key, playing: !!S().transport.playing });
      if (live.error) return;
      // the scene is in a texture, row 0 at the top; the canvas wants it the other way up
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, live.target.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, r.w, r.h, 0, H, W, 0, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      c.cv.getContext('2d').drawImage(glc, 0, 0);
      c.cv.classList.add('on');
    };
    return { frame };
  })();

  return { visualsSection, visualsBrowser };
}
