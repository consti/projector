'use strict';
// OpenAI from the main process, so the key never reaches a renderer and there
// is no CORS to argue with. Three calls are enough for everything the app does
// with a model: list what is available, get a response (text, vision, tools)
// through the Responses API, and make or edit an image.
//
// The key comes from settings (typed into the app), else the environment, else
// a `.env` file at the repository root — a one-line `OPENAI_API_KEY=sk-…`.

const fs = require('fs');
const path = require('path');

const API = 'https://api.openai.com/v1';

// List prices per 1M tokens (USD), as published; anything not listed is priced
// like its family's default. Image models bill text-in, image-in and image-out
// tokens separately. Treat the totals as estimates, not an invoice.
const RATES = {
  'gpt-5.4': { in: 2.5, out: 15 }, 'gpt-5.4-mini': { in: 0.4, out: 3.2 }, 'gpt-5.4-nano': { in: 0.1, out: 0.8 }, 'gpt-5.4-pro': { in: 15, out: 120 },
  'gpt-5.5': { in: 2.5, out: 15 }, 'gpt-5.5-pro': { in: 15, out: 120 },
  'gpt-5.2': { in: 1.75, out: 14 }, 'gpt-5.2-pro': { in: 15, out: 120 }, 'gpt-5.1': { in: 1.25, out: 10 },
  'gpt-5': { in: 1.25, out: 10 }, 'gpt-5-mini': { in: 0.25, out: 2 }, 'gpt-5-nano': { in: 0.05, out: 0.4 }, 'gpt-5-pro': { in: 15, out: 120 },
  'gpt-4.1': { in: 2, out: 8 }, 'gpt-4.1-mini': { in: 0.4, out: 1.6 }, 'gpt-4.1-nano': { in: 0.1, out: 0.4 },
  'gpt-4o': { in: 2.5, out: 10 }, 'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'o3': { in: 2, out: 8 }, 'o3-pro': { in: 20, out: 80 }, 'o4-mini': { in: 1.1, out: 4.4 }, 'o1': { in: 15, out: 60 }, 'o1-pro': { in: 150, out: 600 }, 'o3-mini': { in: 1.1, out: 4.4 },
  'gpt-image-1': { textIn: 5, imageIn: 10, imageOut: 40 }, 'gpt-image-1-mini': { textIn: 2, imageIn: 2.5, imageOut: 8 },
  'gpt-image-1.5': { textIn: 5, imageIn: 8, imageOut: 32 }, 'gpt-image-2': { textIn: 5, imageIn: 8, imageOut: 30 }, 'chatgpt-image-latest': { textIn: 5, imageIn: 8, imageOut: 30 },
};
function rateFor(model) {
  if (!model) return null;
  const m = String(model).replace(/-\d{4}-\d{2}-\d{2}$/, '');
  if (RATES[m]) return RATES[m];
  const fam = Object.keys(RATES).filter((k) => m.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  if (fam) return RATES[fam];
  if (/image/.test(m)) return RATES['gpt-image-1.5'];
  if (/mini/.test(m)) return RATES['gpt-5.4-mini'];
  return RATES['gpt-5.4'];
}
/** USD for one call's usage block. */
function priceOf(usage, model) {
  const r = rateFor(model);
  if (!usage || !r) return 0;
  if (r.imageOut != null) {
    const textIn = (usage.input_tokens_details && usage.input_tokens_details.text_tokens) || 0;
    const imageIn = (usage.input_tokens_details && usage.input_tokens_details.image_tokens) != null
      ? usage.input_tokens_details.image_tokens : Math.max(0, (usage.input_tokens || 0) - textIn);
    return (textIn * r.textIn + imageIn * r.imageIn + (usage.output_tokens || 0) * r.imageOut) / 1e6;
  }
  const cached = (usage.input_tokens_details && usage.input_tokens_details.cached_tokens) || 0;
  const fresh = Math.max(0, (usage.input_tokens || 0) - cached);
  return (fresh * r.in + cached * r.in * 0.1 + (usage.output_tokens || 0) * r.out) / 1e6;
}
const dayKey = (t = Date.now()) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

class Ai {
  constructor(o) {
    this.root = o.root;               // the src dir; .env sits one up
    this.getSettings = o.settings;    // () => state.settings.ai
    this.spendFile = o.spendFile;     // where the ledger lives (userData)
    this._env = null;
    this._models = null;
    this._modelsAt = 0;
    this.ledger = this._loadLedger();
    this.onSpend = o.onSpend || (() => {});
  }

  // ---------------------------------------------------------------- spend --
  _loadLedger() {
    try { const j = JSON.parse(fs.readFileSync(this.spendFile, 'utf8')); if (j && j.days) return j; } catch {}
    return { days: {}, recent: [] };
  }
  _saveLedger() {
    clearTimeout(this._ledgerT);
    this._ledgerT = setTimeout(() => { try { fs.writeFileSync(this.spendFile, JSON.stringify(this.ledger)); } catch {} }, 500);
  }
  /** Book one call: what it was for, which model, its usage block. */
  record(kind, model, usage) {
    const usd = priceOf(usage, model);
    const day = dayKey();
    const d = this.ledger.days[day] || (this.ledger.days[day] = { usd: 0, calls: 0, kinds: {} });
    d.usd += usd; d.calls++;
    const k = d.kinds[kind] || (d.kinds[kind] = { usd: 0, calls: 0, in: 0, out: 0 });
    k.usd += usd; k.calls++; k.in += (usage && usage.input_tokens) || 0; k.out += (usage && usage.output_tokens) || 0;
    this.ledger.recent.unshift({ at: Date.now(), kind, model, usd, in: (usage && usage.input_tokens) || 0, out: (usage && usage.output_tokens) || 0 });
    if (this.ledger.recent.length > 60) this.ledger.recent.length = 60;
    this._saveLedger();
    this.onSpend(this.spend());
    return usd;
  }
  /** The ledger summarised for the UI. */
  spend() {
    const days = this.ledger.days;
    const today = dayKey();
    const sum = (from) => Object.entries(days).filter(([k]) => k >= from).reduce((n, [, v]) => n + v.usd, 0);
    const d7 = dayKey(Date.now() - 6 * 86400000);
    const month = today.slice(0, 8) + '01';
    const list = Object.keys(days).sort().reverse().slice(0, 14).map((k) => ({ day: k, usd: days[k].usd, calls: days[k].calls, kinds: days[k].kinds }));
    return {
      today: (days[today] || { usd: 0 }).usd, week: sum(d7), month: sum(month),
      total: Object.values(days).reduce((n, v) => n + v.usd, 0),
      todayKinds: (days[today] || { kinds: {} }).kinds,
      days: list, recent: this.ledger.recent.slice(0, 12),
    };
  }

  _dotenv() {
    if (this._env) return this._env;
    this._env = {};
    for (const f of [path.join(this.root, '..', '.env'), path.join(process.cwd(), '.env')]) {
      try {
        for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
          const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
          if (m) this._env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
        }
      } catch {}
    }
    return this._env;
  }

  /** The key and where it came from. */
  keyInfo() {
    const s = this.getSettings() || {};
    if (s.apiKey && String(s.apiKey).trim()) return { key: String(s.apiKey).trim(), source: 'settings' };
    if (process.env.OPENAI_API_KEY) return { key: process.env.OPENAI_API_KEY, source: 'environment' };
    const e = this._dotenv();
    if (e.OPENAI_API_KEY) return { key: e.OPENAI_API_KEY, source: '.env' };
    return { key: null, source: null };
  }

  status() {
    const k = this.keyInfo();
    return { hasKey: !!k.key, source: k.source, hint: k.key ? k.key.slice(0, 7) + '…' + k.key.slice(-4) : null };
  }

  async _fetch(pathname, init = {}) {
    const { key } = this.keyInfo();
    if (!key) throw new Error('No OpenAI API key: paste one in Setup → AI, or put OPENAI_API_KEY in .env');
    const headers = { authorization: 'Bearer ' + key, ...(init.headers || {}) };
    const res = await fetch(API + pathname, { ...init, headers });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (!res.ok) {
      const msg = (json && json.error && json.error.message) || text.slice(0, 300) || res.statusText;
      throw new Error(`OpenAI ${res.status}: ${msg}`);
    }
    return json;
  }

  /**
   * Every model id the key can use, sorted into the families the app picks
   * from. Cached for ten minutes.
   */
  async models(force = false) {
    if (!force && this._models && Date.now() - this._modelsAt < 600000) return this._models;
    const r = await this._fetch('/models');
    const ids = (r.data || []).map((m) => m.id).sort();
    const isDated = (id) => /-\d{4}-\d{2}-\d{2}$/.test(id) || /-\d{4}$/.test(id);
    const chat = ids.filter((id) => /^(gpt-|o\d|chatgpt-|chat-latest)/.test(id)
      && !/(transcribe|tts|realtime|audio|search|embedding|moderation|image|instruct|codex|deep-research|whisper|live)/.test(id)
      && !isDated(id) && !/^gpt-3\.5|^gpt-4-|^gpt-4$|davinci|babbage/.test(id));
    const image = ids.filter((id) => /image/.test(id) && !isDated(id) && !/dall-e-2/.test(id));
    this._models = { all: ids, chat, image, at: Date.now() };
    this._modelsAt = Date.now();
    return this._models;
  }

  /**
   * One turn through the Responses API.
   * @param {object} req { model, instructions, input, tools, toolChoice, reasoning, maxOutputTokens, json }
   *   input: string, or an array of content parts / messages in Responses format
   *   json: true asks for a JSON object back (text.format json_object)
   * Returns { text, toolCalls: [{ name, arguments(object), id }], usage, raw }.
   */
  async respond(req) {
    const body = {
      model: req.model,
      input: req.input,
      max_output_tokens: req.maxOutputTokens || 2000,
    };
    if (req.instructions) body.instructions = req.instructions;
    if (req.tools && req.tools.length) {
      body.tools = req.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false }));
      if (req.toolChoice) body.tool_choice = req.toolChoice;
    }
    if (req.reasoning) body.reasoning = { effort: req.reasoning };
    if (req.json) body.text = { format: { type: 'json_object' } };
    const r = await this._fetch('/responses', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const out = { text: '', toolCalls: [], usage: r.usage || null, model: r.model, id: r.id };
    for (const item of r.output || []) {
      if (item.type === 'message') {
        for (const c of item.content || []) if (c.type === 'output_text') out.text += c.text;
      } else if (item.type === 'function_call') {
        let args = {};
        try { args = JSON.parse(item.arguments || '{}'); } catch { args = { _raw: item.arguments }; }
        out.toolCalls.push({ id: item.call_id, name: item.name, arguments: args });
      }
    }
    if (r.status && r.status !== 'completed') out.incomplete = r.status + (r.incomplete_details ? ': ' + r.incomplete_details.reason : '');
    out.usd = this.record(req.kind || 'chat', r.model || req.model, r.usage);
    return out;
  }

  /**
   * Make an image, or re-make one from an input frame (a data URL) with a
   * prompt. Returns { dataUrl, model, usage }.
   */
  async image(req) {
    const model = req.model || 'gpt-image-1.5';
    const size = req.size || '1536x1024';
    if (req.image) {
      const m = String(req.image).match(/^data:(image\/[a-z]+);base64,(.*)$/s);
      if (!m) throw new Error('image must be a data URL');
      const fd = new FormData();
      fd.append('model', model);
      fd.append('prompt', req.prompt);
      fd.append('size', size);
      fd.append('quality', req.quality || 'low');
      fd.append('n', '1');
      fd.append('image', new Blob([Buffer.from(m[2], 'base64')], { type: m[1] }), 'frame.' + (m[1].split('/')[1] || 'png'));
      const r = await this._fetch('/images/edits', { method: 'POST', body: fd });
      const out = imageOut(r, model);
      out.usd = this.record(req.kind || 'image', model, r.usage);
      return out;
    }
    const r = await this._fetch('/images/generations', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: req.prompt, size, quality: req.quality || 'low', n: 1 }),
    });
    const out = imageOut(r, model);
    out.usd = this.record(req.kind || 'image', model, r.usage);
    return out;
  }
}

function imageOut(r, model) {
  const d = (r.data || [])[0];
  if (!d) throw new Error('no image returned');
  const b64 = d.b64_json;
  if (!b64) throw new Error('image came back as a URL; expected base64');
  return { dataUrl: 'data:image/png;base64,' + b64, model, usage: r.usage || null };
}

module.exports.priceOf = priceOf;

module.exports = { Ai };
