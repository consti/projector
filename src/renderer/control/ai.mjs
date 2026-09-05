// The AI director. Two jobs, both optional and both off until AI is switched
// on in Setup:
//
//  * Steering — when a track starts (and, if asked, every so often during it)
//    the model is handed the show as it stands: what is playing and what is
//    next, the measured beat and spectrum, the colours on the wall, the shapes
//    that have been masked, which walls are on, and a compact catalogue of
//    every effect with its parameters. It answers by calling `set_effects`
//    with a full plan — layers, parameters, sound links, beat triggers, world
//    settings — which is validated against the real schemas and applied.
//
//  * Vision — while an AI caption or AI dream layer is in the stack, a second
//    <video> runs ahead of the playhead; frames are read, sent to the vision or
//    image model, and the result is held until the playhead reaches that frame,
//    then delivered to the layer through the ordinary action relay so every
//    wall shows it.

import { REGISTRY, PALETTE_MODES } from '/shared/fx/system.mjs';
import { SOURCES } from '/shared/fx/audio.mjs';
import { defaultFxLayer } from '/shared/schema.mjs';
import { SCENES } from '/renderer/control/fxpanel.mjs';

const CAPTION_STYLES = [
  ['poetic', 'Poetic — a line of verse'],
  ['haiku', 'Haiku'],
  ['noir', 'Film noir narration'],
  ['field', 'Field notes of a naturalist'],
  ['news', 'Breaking-news ticker'],
  ['dream', 'Dream journal'],
  ['tech', 'Technical manual'],
  ['gossip', 'Overheard gossip'],
  ['zen', 'Zen koan'],
  ['child', 'A child explaining it'],
  ['critic', 'Art critic, insufferable'],
  ['tarot', 'Tarot reading'],
];
const LANGUAGES = ['English', 'German', 'French', 'Spanish', 'Italian', 'Portuguese', 'Dutch', 'Japanese', 'Thai', 'Latin', 'the video’s own language'];
const DREAM_STYLES = ['oil painting', 'ink wash', 'woodcut print', 'stained glass', 'blueprint', 'watercolour', 'charcoal sketch', 'risograph poster', 'ukiyo-e', 'children’s book illustration', 'brutalist architecture render', 'cyanotype', 'pixel art', 'bas-relief in marble', 'thermal camera'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class AiDirector {
  constructor(hooks) {
    this.h = hooks;                 // { project(), state(), push(commit), rebuild(), fxAction(id,name,arg), toast(), features(), palette(), el, patchSettings() }
    this.status = null;             // { hasKey, source, hint }
    this.models = null;             // { chat, image, all }
    this.log = [];                  // [{ at, kind, text }]
    this.busy = false;
    this.lastTrack = null;
    this.lastPlan = 0;
    this.samples = [];              // audio feature samples for the planner
    this.look = null;               // lookahead <video>
    this.lookKey = null;
    this.pending = [];              // [{ at (transport s), kind, layerType, payload }]
    this.nextCaptionAt = 0;
    this.nextDreamAt = 0;
    this.inflight = 0;
    this.trackStart = 0;
    this.sceneCatalog = null;
    this.sub = [];
    this.recent = [];               // [{ track, types }] the last few plans, so the director varies
  }

  // ------------------------------------------------------------------ setup
  get ai() { return (this.h.state().settings || {}).ai || {}; }
  patch(p) { this.h.patchSettings({ ai: { ...this.ai, ...p } }); }

  async refresh(force) {
    try { this.status = await api.aiStatus(); } catch { this.status = null; }
    try { this.spendInfo = await api.aiSpend(); } catch {}
    if (!this._spendSub) { this._spendSub = true; api.onAiSpend((s) => { this.spendInfo = s; for (const f of this.sub) { try { f(); } catch {} } }); }
    if (this.status && this.status.hasKey) {
      const m = await api.aiModels(force);
      if (!m.error) this.models = m; else this.note('error', m.error);
    }
    this.h.rebuild();
  }

  note(kind, text) {
    this.log.unshift({ at: new Date(), kind, text: String(text).slice(0, 600) });
    if (this.log.length > 12) this.log.length = 12;
    for (const f of this.sub) { try { f(); } catch {} }
  }

  // the Setup section
  section(ui) {
    const el = ui.el;
    const a = this.ai;
    const rows = [];
    const on = a.enabled && this.status && this.status.hasKey;
    rows.push(el('div', { class: 'row' }, [
      ui.toggle('AI on', () => !!this.ai.enabled, (v) => this.patch({ enabled: v }), { push: false }),
      el('span', { class: 'hint grow', text: this.status
        ? (this.status.hasKey ? `Key from ${this.status.source} (${this.status.hint})` : 'No key found')
        : 'Checking…' }),
      el('button', { class: 'btn sm', text: 'Refresh', onclick: () => this.refresh(true) }),
    ]));
    const key = el('input', { type: 'password', placeholder: 'sk-… (or OPENAI_API_KEY in .env)' });
    key.value = a.apiKey || '';
    key.onchange = () => { this.patch({ apiKey: key.value.trim() }); setTimeout(() => this.refresh(true), 300); };
    rows.push(el('div', { class: 'ctl wide' }, [el('label', { text: 'API key' }), key]));

    const modelRow = (label, k, list, hint) => {
      const sel = el('select', {});
      const cur = a[k];
      const opts = (list && list.length) ? list.slice() : [];
      if (cur && !opts.includes(cur)) opts.unshift(cur);
      if (!opts.length) opts.push(cur || '');
      for (const id of opts) sel.appendChild(el('option', { value: id, text: id }));
      sel.value = cur || opts[0];
      sel.onchange = () => this.patch({ [k]: sel.value });
      return el('div', { class: 'ctl wide', title: hint }, [el('label', { text: label }), sel]);
    };
    rows.push(modelRow('Director', 'textModel', this.models && this.models.chat, 'Plans the show: tool calls and a little reasoning. gpt-5.4 by default.'));
    rows.push(modelRow('Reader', 'visionModel', this.models && this.models.chat, 'Reads frames for captions, every few seconds — quick and cheap. gpt-5.4-mini by default.'));
    rows.push(modelRow('Painter', 'imageModel', this.models && this.models.image, 'Re-paints frames for AI dream. gpt-image-1.5 by default.'));
    rows.push(el('div', { class: 'hint', text: this.models
      ? `${this.models.chat.length} chat and ${this.models.image.length} image models on this key.`
      : 'Models are listed from the API once a key is found.' }));

    // steering
    rows.push(el('div', { class: 'fxhead', text: 'Steering' }));
    rows.push(el('div', { class: 'row' }, [
      ui.toggle('AI steers the effects', () => !!this.ai.steer, (v) => { this.patch({ steer: v }); if (v) this.lastTrack = null; }, { push: false }),
      el('button', { class: 'btn sm', text: this.busy ? 'Planning…' : 'Steer now', disabled: this.busy || !on ? '' : null,
        onclick: () => this.plan('asked for') }),
    ]));
    const brief = el('input', { type: 'text', placeholder: 'e.g. dark and slow, no text, heavy on the shapes' });
    brief.value = a.steerBrief || '';
    brief.onchange = () => this.patch({ steerBrief: brief.value });
    rows.push(el('div', { class: 'ctl wide' }, [el('label', { text: 'Brief' }), brief]));
    rows.push(ui.selectRow('Re-plan', [['track', 'Once per track'], ['sections', 'When the music changes section'], ['timer', 'On a timer (give or take)']],
      () => a.steerMode || 'sections', (v) => this.patch({ steerMode: v })));
    if ((a.steerMode || 'sections') === 'timer') {
      rows.push(ui.slider('Every', () => a.steerEvery || 90, (v) => this.patch({ steerEvery: Math.round(v) }),
        { min: 30, max: 300, step: 15, fmt: (v) => '~' + Math.round(v) + ' s', push: false }));
    }
    if ((a.steerMode || 'sections') === 'sections') {
      rows.push(el('div', { class: 'hint', text: 'Sections are found locally, without a model: a sustained jump or drop in loudness and bass against the last half minute (a drop, a breakdown, a build) — then the director is asked again, usually, not always, and never within 40 s of the last plan.' }));
    }
    rows.push(ui.selectRow('Thinking', [['none', 'None'], ['low', 'A little'], ['medium', 'Some'], ['high', 'A lot']],
      () => a.steerReasoning || 'low', (v) => this.patch({ steerReasoning: v })));
    rows.push(el('div', { class: 'hint', text: 'When a track starts the director is told what is playing and what is next, the measured beat and spectrum, the colours on the wall, your shapes and walls, and every effect with its parameters. It picks the layers, tunes them, links them to the sound and sets the beat triggers. The brief is a standing direction it must respect.' }));

    // vision
    rows.push(el('div', { class: 'fxhead', text: 'Reading the film' }));
    rows.push(ui.selectRow('Caption style', CAPTION_STYLES, () => a.captionStyle || 'poetic', (v) => this.patch({ captionStyle: v })));
    rows.push(ui.selectRow('Language', LANGUAGES.map((l) => [l, l]), () => a.captionLanguage || 'English', (v) => this.patch({ captionLanguage: v })));
    rows.push(ui.slider('Caption every', () => a.captionEvery || 18, (v) => this.patch({ captionEvery: Math.round(v) }), { min: 6, max: 90, step: 1, fmt: (v) => Math.round(v) + ' s', push: false }));
    rows.push(ui.slider('Read ahead', () => a.lookahead || 12, (v) => this.patch({ lookahead: Math.round(v) }), { min: 4, max: 60, step: 1, fmt: (v) => Math.round(v) + ' s', push: false }));
    rows.push(ui.selectRow('Dream style', DREAM_STYLES.map((l) => [l, l]), () => a.dreamStyle || 'oil painting', (v) => this.patch({ dreamStyle: v })));
    rows.push(ui.slider('Dream every', () => a.dreamEvery || 40, (v) => this.patch({ dreamEvery: Math.round(v) }), { min: 20, max: 240, step: 5, fmt: (v) => Math.round(v) + ' s', push: false }));
    rows.push(el('div', { class: 'row' }, [
      ui.toggle('AI picks the emoji', () => !!this.ai.emoji, (v) => this.patch({ emoji: v }), { push: false }),
    ]));
    rows.push(el('div', { class: 'hint', text: 'These run only while an AI caption or AI dream layer is in the stack (or AI picks the emoji is on). A second copy of the video runs ahead of the playhead; each frame read is captioned or re-painted and shown when the film reaches it.' }));

    // spend
    const KIND_LABEL = { director: 'Director', caption: 'Captions', dream: 'Dreams', sprite: 'Pixel people', chat: 'Other', image: 'Images' };
    const usd = (n) => (n < 0.01 ? (n * 100).toFixed(2) + '¢' : '$' + n.toFixed(n < 1 ? 3 : 2));
    const spendEl = el('div', { class: 'aispend' });
    const drawSpend = () => {
      spendEl.innerHTML = '';
      const s = this.spendInfo;
      if (!s) { spendEl.appendChild(el('div', { class: 'hint', text: 'No spending recorded yet.' })); return; }
      spendEl.appendChild(el('div', { class: 'spendRow' }, [
        el('div', { class: 'spendCell' }, [el('b', { text: usd(s.today) }), el('span', { text: 'today' })]),
        el('div', { class: 'spendCell' }, [el('b', { text: usd(s.week) }), el('span', { text: '7 days' })]),
        el('div', { class: 'spendCell' }, [el('b', { text: usd(s.month) }), el('span', { text: 'this month' })]),
        el('div', { class: 'spendCell' }, [el('b', { text: usd(s.total) }), el('span', { text: 'all time' })]),
      ]));
      const kinds = Object.entries(s.todayKinds || {});
      if (kinds.length) spendEl.appendChild(el('div', { class: 'hint', text: 'Today: ' + kinds.map(([k, v]) => `${KIND_LABEL[k] || k} ${usd(v.usd)} (${v.calls})`).join(' · ') }));
      const tbl = el('table', { class: 'spendTable' });
      for (const d of (s.days || []).slice(0, 10)) {
        tbl.appendChild(el('tr', {}, [
          el('td', { class: 'mono', text: d.day }),
          el('td', { class: 'mono', text: d.calls + (d.calls === 1 ? ' call' : ' calls') }),
          el('td', { class: 'mono r', text: usd(d.usd) }),
          el('td', { class: 'hint', text: Object.entries(d.kinds || {}).map(([k, v]) => `${KIND_LABEL[k] || k} ${usd(v.usd)}`).join(', ') }),
        ]));
      }
      spendEl.appendChild(tbl);
      spendEl.appendChild(el('div', { class: 'hint', text: 'Estimated from the token counts each call reports, at list prices per model. Kept per day in the app’s data folder.' }));
    };
    rows.push(el('div', { class: 'fxhead', text: 'Spending' }));
    rows.push(spendEl);

    // log
    const logEl = el('div', { class: 'ailog' });
    const drawLog = () => {
      logEl.innerHTML = '';
      if (!this.log.length) logEl.appendChild(el('div', { class: 'hint', text: 'Nothing yet.' }));
      for (const e of this.log) {
        logEl.appendChild(el('div', { class: 'aient ' + e.kind }, [
          el('span', { class: 'mono', text: e.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }),
          el('span', { text: e.text }),
        ]));
      }
    };
    this.sub = [drawLog, drawSpend];
    drawLog(); drawSpend();
    rows.push(el('div', { class: 'fxhead', text: 'Log' }));
    rows.push(logEl);
    return ui.section('AI', rows);
  }

  // --------------------------------------------------------------- per frame
  frame() {
    const S = this.h.state();
    if (!S) return;
    const a = this.ai;
    const enabled = !!(a.enabled && this.status && this.status.hasKey);
    const t = S.transport || {};
    const src = t.source;
    const trackKey = src ? (src.url || '') + '|' + (src.title || '') : null;
    const now = performance.now();

    // audio feature samples for the planner (last ~8 s)
    const f = this.h.features();
    if (f && f.live) {
      this.samples.push({ at: now, level: f.level, bass: f.bass, low: f.low, mid: f.mid, high: f.high, air: f.air, bpm: f.bpm, flux: f.flux });
      while (this.samples.length && now - this.samples[0].at > 8000) this.samples.shift();
    }

    if (trackKey !== this.lastTrack) {
      this.lastTrack = trackKey;
      this.trackStart = now;
      this.pending.length = 0;
      this.nextCaptionAt = 0; this.nextDreamAt = 0;
      // let the analyser settle on the new track before the director listens
      if (enabled && a.steer && src && t.playing) this.planAt = now + 6000;
    }
    if (enabled && a.steer && this.planAt && now >= this.planAt && !this.busy) { this.planAt = 0; this.plan('new track'); }
    if (enabled && a.steer && src && t.playing && !this.busy && now - this.trackStart > 20000) this.resteer(a, now, f);

    if (enabled) this.vision(S, now); else this.stopLook();
  }

  /**
   * Re-planning during a track. 'timer' waits the chosen interval give or take
   * a third; 'sections' listens for the music changing section — the last few
   * seconds' loudness and bass against the half minute before — and then asks
   * again with a coin toss, so it never becomes a metronome.
   */
  resteer(a, now, f) {
    const mode = a.steerMode || 'sections';
    const since = now - this.lastPlan;
    if (mode === 'track') return;
    if (mode === 'timer') {
      if (!this.nextTimer || this.nextTimer < this.lastPlan) {
        const every = clamp(a.steerEvery || 90, 30, 600) * 1000;
        this.nextTimer = this.lastPlan + every * (0.7 + Math.random() * 0.6);
      }
      if (now >= this.nextTimer) { this.nextTimer = 0; this.plan('timer'); }
      return;
    }
    // sections: a rolling 1 s energy history
    if (!f || !f.live) return;
    if (!this.energy) this.energy = [];
    this.eAcc = (this.eAcc || 0) + 1; this.eSum = (this.eSum || 0) + (f.level * 0.6 + f.bass * 0.4);
    if (!this.eAt) this.eAt = now;
    if (now - this.eAt < 1000) return;
    this.energy.push(this.eSum / this.eAcc); this.eAcc = 0; this.eSum = 0; this.eAt = now;
    if (this.energy.length > 40) this.energy.shift();
    if (this.energy.length < 14 || since < 40000) return;
    const recent = this.energy.slice(-4), before = this.energy.slice(-34, -6);
    const avg = (arr) => arr.reduce((n, v) => n + v, 0) / Math.max(1, arr.length);
    const jump = avg(recent) - avg(before);
    if (Math.abs(jump) > 0.22 && Math.random() < 0.65) {
      this.energy.length = 0;
      this.plan(jump > 0 ? 'the music lifted (a drop or a build)' : 'the music fell away (a breakdown)');
    }
  }

  // ------------------------------------------------------------- steering --
  async plan(reason) {
    if (this.busy) return;
    const S = this.h.state();
    const P = this.h.project();
    const a = this.ai;
    if (!(a.enabled && this.status && this.status.hasKey)) { this.h.toast('AI is off or has no key (Setup → AI)'); return; }
    this.busy = true; this.lastPlan = performance.now();
    this.h.rebuild();
    try {
      const ctx = this.context(S, P);
      const res = await api.aiRespond({
        kind: 'director',
        model: a.textModel || 'gpt-5.4',
        instructions: DIRECTOR_INSTRUCTIONS,
        input: [{ role: 'user', content: [{ type: 'input_text', text: ctx + `\n\nReason for this call: ${reason}.` + (a.steerBrief ? `\n\nStanding brief from the operator (must be respected): ${a.steerBrief}` : '') }] }],
        tools: [SET_EFFECTS_TOOL],
        toolChoice: { type: 'function', name: 'set_effects' },
        reasoning: a.steerReasoning === 'none' ? undefined : (a.steerReasoning || 'low'),
        maxOutputTokens: 6000,
      });
      if (res.error) throw new Error(res.error);
      const call = (res.toolCalls || []).find((c) => c.name === 'set_effects');
      if (!call) { this.note('error', 'The director answered without a plan: ' + (res.text || res.incomplete || 'nothing')); return; }
      const report = this.apply(call.arguments, P);
      const cur = (S.playlist && S.playlist.items[S.playlist.index]) || {};
      this.recent.unshift({ track: cur.title || (S.transport.source && S.transport.source.title) || '?', types: (call.arguments.layers || []).map((l) => l.type).join('+') });
      if (this.recent.length > 5) this.recent.length = 5;
      const u = res.usage ? ` · ${res.usage.input_tokens}+${res.usage.output_tokens} tokens` : '';
      this.note('plan', `${call.arguments.note || 'Plan applied'} — ${report}${u}`);
      this.h.toast('AI: ' + (call.arguments.note || 'effects set').slice(0, 120), 4000);
    } catch (e) {
      this.note('error', e.message || String(e));
      this.h.toast('AI error: ' + (e.message || e), 5000);
    } finally {
      this.busy = false;
      this.h.rebuild();
    }
  }

  /** Everything the director needs to know, as text. */
  context(S, P) {
    const t = S.transport || {};
    const pl = S.playlist || { items: [], index: -1 };
    const cur = pl.items[pl.index];
    const next = pl.items.slice(pl.index + 1, pl.index + 4).map((i) => `${i.artist ? i.artist + ' — ' : ''}${i.title}`);
    const pos = t.playing ? t.position + (Date.now() - t.anchorTime) / 1000 * (t.rate || 1) : t.position;
    const dur = t.duration || (cur && cur.duration) || 0;
    // audio summary
    let audio = 'no live audio analysis (turn on "React to sound", or the audio plays in another window)';
    if (this.samples.length > 10) {
      const avg = (k) => (this.samples.reduce((n, s) => n + (s[k] || 0), 0) / this.samples.length).toFixed(2);
      const bpms = this.samples.map((s) => s.bpm).filter((b) => b > 0);
      const bpm = bpms.length ? Math.round(bpms.sort((x, y) => x - y)[bpms.length >> 1]) : 0;
      audio = `estimated ${bpm || '?'} BPM; average levels over the last 8 s — loudness ${avg('level')}, bass ${avg('bass')}, low-mid ${avg('low')}, mid ${avg('mid')}, high ${avg('high')}, air ${avg('air')}, attack/flux ${avg('flux')} (all 0..1, adaptively gained)`;
    }
    const pal = this.h.palette();
    const hex = (c) => c ? '#' + c.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('') : '?';
    const palette = pal ? `dominant ${hex(pal.dominant)}, second ${hex(pal.second)}, average ${hex(pal.average)}, complement ${hex(pal.complement)}` : 'unknown';
    const masks = (P.masks || []).filter((m) => m.enabled).map((m) => `"${m.name}"${m.fxCollide === false ? ' (not seen by effects)' : ''}`);
    const fx = P.fx || {};
    const layers = (fx.layers || []).map((L) => `${L.type}${L.enabled === false ? ' (hidden)' : ''} ${JSON.stringify(L.params || {})}`);
    const outs = S.outputs || {};
    const walls = `projector window ${outs.projector && outs.projector.enabled ? 'open' : 'closed'}; TV window ${outs.tv && outs.tv.enabled ? 'open' : 'closed'}${outs.tv && outs.tv.fx === false ? ' (effects off on TV)' : ''}. Layers show on both walls unless you set 'show'; the operator's preview shows the projector wall, so never drop the projector.`;
    return [
      `NOW PLAYING: ${cur ? (cur.artist ? cur.artist + ' — ' : '') + cur.title : (t.source && t.source.title) || 'nothing'}${dur ? ` (${Math.round(pos)}s of ${Math.round(dur)}s)` : ''}`,
      `UP NEXT: ${next.length ? next.join(' | ') : 'nothing queued'}`,
      `SOUND: ${audio}`,
      `WALL COLOURS RIGHT NOW: ${palette}`,
      `MASKED SHAPES (solid objects on the wall the effects collide with and the Shapes group acts on): ${masks.length ? masks.join(', ') : 'none'}`,
      `WALLS: ${walls}`,
      `CURRENT LAYERS: ${layers.length ? layers.join('; ') : 'none'}`,
      `QUALITY: ${fx.quality || 'high'}; sound reaction currently ${fx.audio && fx.audio.enabled ? 'on' : 'off'}`,
      `YOUR RECENT PLANS (vary from these — a new track deserves a different character): ${this.recent.length ? this.recent.map((r) => `${r.track}: ${r.types}`).join(' | ') : 'none yet'}`,
      '',
      'EFFECT CATALOGUE (type — label [group]: what it does. params key[min..max]=default; select keys list their options):',
      catalogText(),
      '',
      'SOUND SOURCES for mod/trig: ' + SOURCES.filter((s) => s[0] !== 'none').map((s) => `${s[0]} (${s[1]})`).join(', '),
      'SCENES you may use as inspiration (name: layer types): ' + SCENES.map((s) => `${s.name}: ${s.layers.map((l) => l[0]).join('+')}`).join('; '),
    ].join('\n');
  }

  /** Validate and apply a plan. Returns a one-line report. */
  apply(plan, P) {
    const fx = P.fx;
    const layers = [];
    const dropped = [];
    for (const L of (plan.layers || []).slice(0, 6)) {
      const spec = REGISTRY.get(L.type);
      if (!spec) { dropped.push(L.type); continue; }
      const params = {};
      for (const q of spec.params || []) {
        const v = L.params ? L.params[q.key] : undefined;
        if (v == null) continue;
        if (q.type === 'range') { const n = Number(v); if (isFinite(n)) params[q.key] = clamp(n, q.min, q.max); }
        else if (q.type === 'bool') params[q.key] = !!v;
        else if (q.type === 'select') { if (q.options.some((o) => o[0] === String(v))) params[q.key] = String(v); }
        else if (q.type === 'color') { if (/^#[0-9a-f]{6}$/i.test(String(v))) params[q.key] = String(v); }
        else if (q.type === 'text') params[q.key] = String(v).slice(0, 80);
      }
      const mod = [];
      for (const m of (L.mod || []).slice(0, 6)) {
        const q = (spec.params || []).find((x) => x.key === m.p && (x.type === 'range' || x.type === 'bool'));
        if (!q || !SOURCES.some((s) => s[0] === m.src) || m.src === 'none') continue;
        mod.push({ p: m.p, src: m.src, amt: clamp(Number(m.amt) || 0, -1, 2), mode: 'add' });
      }
      let trig = null;
      if (L.trig && L.trig.action && (spec.actions || []).some((x) => x.name === L.trig.action)) {
        trig = { src: 'beat', action: L.trig.action, every: clamp(Math.round(Number(L.trig.every) || 1), 1, 16) };
      }
      // a layer may be kept off one wall, never off both; the projector wall is what the operator previews
      const show = { projector: !(L.show && L.show.projector === false && L.show.tv !== false), tv: !(L.show && L.show.tv === false) };
      const layer = defaultFxLayer(L.type, params, { mod, trig, show });
      if (L.opacity != null) layer.opacity = clamp(Number(L.opacity), 0, 1);
      if (L.palette && PALETTE_MODES.some((m) => m[0] === L.palette)) layer.palette = L.palette;
      layers.push(layer);
    }
    if (!layers.length) return 'no valid layers in the plan' + (dropped.length ? ` (unknown: ${dropped.join(', ')})` : '');
    fx.layers = layers;
    fx.enabled = true;
    const w = plan.world || {};
    if (w.gravity != null) fx.gravity = clamp(Number(w.gravity), -2, 4);
    if (w.wind != null) fx.windX = clamp(Number(w.wind), -2, 2);
    if (w.timeScale != null) fx.timeScale = clamp(Number(w.timeScale), 0, 3);
    if (w.bloom != null) fx.bloom = clamp(Number(w.bloom), 0, 2);
    if (w.exposure != null) fx.exposure = clamp(Number(w.exposure), 0.2, 3);
    const anyAudio = layers.some((L) => (L.mod && L.mod.length) || L.trig);
    const au = plan.audio || {};
    fx.audio.enabled = au.enabled != null ? !!au.enabled : (anyAudio || fx.audio.enabled);
    if (au.globalSrc && SOURCES.some((s) => s[0] === au.globalSrc)) fx.audio.globalSrc = au.globalSrc;
    if (au.globals) for (const k of ['gravity', 'timeScale', 'wind', 'bloom', 'exposure']) if (au.globals[k] != null) fx.audio.globals[k] = clamp(Number(au.globals[k]), -1, 3);
    this.h.push(true);
    this.h.rebuild();
    return `${layers.map((L) => L.type).join(' + ')}${dropped.length ? ` (dropped unknown: ${dropped.join(', ')})` : ''}`;
  }

  // ---------------------------------------------------------------- vision --
  aiLayers(P) {
    const out = { text: [], dream: [], emoji: [] };
    for (const L of (P.fx && P.fx.layers) || []) {
      if (L.enabled === false) continue;
      if (L.type === 'aitext') out.text.push(L);
      else if (L.type === 'aidream') out.dream.push(L);
      else if (L.type === 'emoji') out.emoji.push(L);
    }
    return out;
  }

  ensureLook(S) {
    const src = S.transport && S.transport.source;
    const url = src ? (src.previewUrl || src.url) : null;
    if (!url) { this.stopLook(); return null; }
    if (this.lookKey === url && this.look) return this.look;
    this.stopLook();
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.playsInline = true;
    v.style.display = 'none';
    v.src = url;
    document.body.appendChild(v);
    this.look = v; this.lookKey = url;
    return v;
  }
  stopLook() {
    if (this.look) { try { this.look.pause(); this.look.removeAttribute('src'); this.look.load(); } catch {} this.look.remove(); }
    this.look = null; this.lookKey = null;
  }

  /** Read a frame at transport time `at` from the lookahead video as a JPEG data URL. */
  grab(S, at, w = 640) {
    const v = this.ensureLook(S);
    if (!v || v.readyState < 1) return Promise.resolve(null);
    return new Promise((res) => {
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        v.removeEventListener('seeked', finish);
        if (!v.videoWidth) return res(null);
        const cv = document.createElement('canvas');
        const h = Math.round(w * v.videoHeight / v.videoWidth);
        cv.width = w; cv.height = h;
        try { cv.getContext('2d').drawImage(v, 0, 0, w, h); res(cv.toDataURL('image/jpeg', 0.8)); } catch { res(null); }
      };
      v.addEventListener('seeked', finish);
      try { v.currentTime = Math.max(0, at); } catch { finish(); }
      setTimeout(finish, 4000);
    });
  }

  vision(S, now) {
    const P = this.h.project();
    const a = this.ai;
    const t = S.transport || {};
    const L = this.aiLayers(P);
    const wantText = L.text.length > 0 || (a.emoji && L.emoji.length > 0);
    const wantDream = L.dream.length > 0;
    if (!wantText && !wantDream) { this.stopLook(); this.pending.length = 0; return; }
    if (!t.source || !t.playing) return;
    const pos = t.position + (Date.now() - t.anchorTime) / 1000 * (t.rate || 1);

    // deliver what has come due
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (pos >= p.at - 0.2) {
        this.pending.splice(i, 1);
        if (pos - p.at > 8) continue;                       // too late, skip it
        if (p.kind === 'caption') {
          for (const lay of L.text) this.h.fxAction(lay.id, 'set', { text: p.text, hold: a.captionEvery ? Math.min(a.captionEvery * 0.8, 20) : undefined });
          if (a.emoji && p.emoji) for (const lay of L.emoji) { lay.params = { ...(lay.params || {}), set: 'custom', custom: p.emoji }; this.h.push(true); }
        } else if (p.kind === 'dream') {
          for (const lay of L.dream) this.h.fxAction(lay.id, 'set', { image: p.image });
        }
      }
    }
    if (this.inflight >= 2) return;
    const lead = clamp(a.lookahead || 12, 4, 60);
    if (wantText && now >= this.nextCaptionAt) {
      this.nextCaptionAt = now + clamp(a.captionEvery || 18, 6, 90) * 1000;
      this.caption(S, pos + lead);
    }
    if (wantDream && now >= this.nextDreamAt) {
      this.nextDreamAt = now + clamp(a.dreamEvery || 40, 20, 240) * 1000;
      this.dream(S, pos + Math.max(lead, 25));
    }
  }

  async caption(S, at) {
    const a = this.ai;
    this.inflight++;
    try {
      const frame = await this.grab(S, at, 640);
      if (!frame) return;
      const style = CAPTION_STYLES.find((s) => s[0] === a.captionStyle) || CAPTION_STYLES[0];
      const t = S.transport || {};
      const res = await api.aiRespond({
        kind: 'caption',
        model: a.visionModel || 'gpt-5.4-mini',
        instructions: `You caption frames of a music video projected on a living-room wall. Write ONE short caption (max 16 words, max 2 short lines) about what is in the frame, in this voice: ${style[1]}. Language: ${a.captionLanguage || 'English'}. Never mention that it is a video, a frame or an image; speak of the scene itself. No hashtags, no quotes around the text. Also pick 4 to 8 emoji that suit the scene. Reply as JSON: {"caption": "...", "emoji": "..."}.`,
        input: [{ role: 'user', content: [
          { type: 'input_text', text: `Track: ${(t.source && t.source.title) || 'unknown'}. Frame ${Math.round(at)} s in. Reply as JSON.` },
          { type: 'input_image', image_url: frame, detail: 'low' },
        ] }],
        json: true,
        maxOutputTokens: 300,
      });
      if (res.error) throw new Error(res.error);
      let j = null;
      try { j = JSON.parse(res.text); } catch { j = { caption: res.text.trim().slice(0, 120) }; }
      if (!j || !j.caption) return;
      this.pending.push({ at, kind: 'caption', text: j.caption, emoji: j.emoji || '' });
      this.note('caption', `${Math.round(at)}s: ${j.caption}${j.emoji ? '  ' + j.emoji : ''}`);
    } catch (e) {
      this.note('error', 'caption: ' + (e.message || e));
    } finally { this.inflight--; }
  }

  async dream(S, at) {
    const a = this.ai;
    this.inflight++;
    try {
      const frame = await this.grab(S, at, 768);
      if (!frame) return;
      const res = await api.aiImage({
        kind: 'dream',
        model: a.imageModel || 'gpt-image-1.5',
        image: frame,
        size: '1536x1024',
        quality: 'low',
        prompt: `Re-paint this exact scene as ${a.dreamStyle || 'an oil painting'}. Keep the composition, the placement of every large form and the overall light; change only the medium and its texture. No text, no borders, no frame.`,
      });
      if (res.error) throw new Error(res.error);
      this.pending.push({ at, kind: 'dream', image: res.dataUrl });
      this.note('dream', `${Math.round(at)}s: dreamed as ${a.dreamStyle}`);
    } catch (e) {
      this.note('error', 'dream: ' + (e.message || e));
    } finally { this.inflight--; }
  }
}

// ------------------------------------------------------------------ prompts --
const DIRECTOR_INSTRUCTIONS = `You are the visual director of a projection-mapped wall in a living room. A music video plays on the wall; over it runs a stack of real-time effect layers (physics, fluids, shaders) that can collide with the masked shapes (paintings, plants, a couch) and react to the music. A TV in the same room shows the same video with the same layers, minus the shapes.

Your job: choose and tune the layer stack for the track that is playing, so the wall fits the music — its tempo, energy, mood, era and imagery — and changes character from track to track. You know these artists and songs; use that knowledge (genre, tempo, structure, the video's look) together with the measured sound.

Rules of the room:
- 1 to 4 layers. More is a mess and costs frame rate; physics layers (water, balls, smoke, fire, sand, shatter, tetris) are heavy — at most two of those.
- Every plan should have at least one link to the sound: 'mod' entries map a source (bass, level, high, beat, flux…) to a range parameter with a signed amount (amt 0.3–1.5 is normal; negative shrinks on the beat); 'trig' fires one of the effect's actions every N beats. Set audio.enabled true when you use them.
- Slow music: few layers, slow speeds, low opacity, long fades. Fast, loud music: stronger, more layers, beat triggers. Ambient: drifting shaders (Trippy, Generative, Shapes) rather than falling things.
- Use the masked shapes: if there are shapes, the Shapes group (shadows, aura, glassrim, plasma, frost, fieldlines, shockwave, extrude, neon, stagelights) and the colliding physics look best.
- Colours: use the wall's dominant colours or their complements; set a layer's 'palette' to 'video', 'complement', 'invert' or 'tone' when the effect has colour parameters, or set colours explicitly.
- Text layers ('aitext') only if a brief asks for words or the track is lyrical/spoken; 'aidream' rarely (slow and costly).
- Only use parameter keys that exist for that effect; keep values inside their ranges. Do not invent effects.
- Leave 'show' out unless you deliberately want a layer on one wall only (e.g. text on the TV, physics on the projector). Whether an output window is open is not a reason to drop a wall.
- Keep it tasteful: it is a home, not a nightclub, unless the brief says otherwise.

Always answer by calling set_effects once, with a short 'note' (one sentence, in plain words) saying what you chose and why — the operator reads it.`;

const SET_EFFECTS_TOOL = {
  name: 'set_effects',
  description: 'Replace the effect stack and world settings with this plan.',
  parameters: {
    type: 'object',
    properties: {
      note: { type: 'string', description: 'One sentence for the operator: what you chose and why.' },
      layers: {
        type: 'array', minItems: 1, maxItems: 4,
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'effect type from the catalogue' },
            params: { type: 'object', description: 'parameter key -> value; only keys that exist for this effect', additionalProperties: true },
            opacity: { type: 'number', minimum: 0, maximum: 1 },
            palette: { type: 'string', enum: ['fixed', 'video', 'complement', 'invert', 'tone'] },
            show: { type: 'object', properties: { projector: { type: 'boolean' }, tv: { type: 'boolean' } } },
            mod: {
              type: 'array', maxItems: 4,
              items: { type: 'object', properties: { p: { type: 'string' }, src: { type: 'string' }, amt: { type: 'number' } }, required: ['p', 'src', 'amt'] },
              description: 'sound links: parameter p driven by source src by amount amt',
            },
            trig: { type: 'object', properties: { action: { type: 'string' }, every: { type: 'integer', minimum: 1, maximum: 16 } }, description: 'fire this action every N beats' },
          },
          required: ['type'],
        },
      },
      world: {
        type: 'object',
        properties: { gravity: { type: 'number' }, wind: { type: 'number' }, timeScale: { type: 'number' }, bloom: { type: 'number' }, exposure: { type: 'number' } },
      },
      audio: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          globalSrc: { type: 'string' },
          globals: { type: 'object', properties: { gravity: { type: 'number' }, timeScale: { type: 'number' }, wind: { type: 'number' }, bloom: { type: 'number' }, exposure: { type: 'number' } } },
        },
      },
    },
    required: ['note', 'layers'],
  },
};

let CATALOG_TEXT = null;
function catalogText() {
  if (CATALOG_TEXT) return CATALOG_TEXT;
  const lines = [];
  for (const s of REGISTRY.values()) {
    const ps = (s.params || []).map((p) => {
      if (p.type === 'range') return `${p.key}[${p.min}..${p.max}]=${p.def}`;
      if (p.type === 'bool') return `${p.key}(bool)=${p.def}`;
      if (p.type === 'select') return `${p.key}{${p.options.map((o) => o[0]).join('|')}}=${p.def}`;
      if (p.type === 'color') return `${p.key}(colour)=${p.def}`;
      if (p.type === 'text') return `${p.key}(text)`;
      return p.key;
    }).join(', ');
    const acts = (s.actions || []).map((x) => x.name).join('/');
    lines.push(`${s.type} — ${s.label} [${s.group}]: ${(s.hint || '').replace(/\s+/g, ' ')}${acts ? ` actions: ${acts}.` : ''} params: ${ps}`);
  }
  CATALOG_TEXT = lines.join('\n');
  return CATALOG_TEXT;
}
