'use strict';
// The pixel people: a roster of characters made from photos, drawn the way
// pixel-it draws them. A hero sprite is drawn first from the photo (the
// identity, locked once), then every animation sheet of Base — the house
// template in ./base — is copied row for row "like Base, but this person":
// walk; run, jump, fall; idle, sit, sleep; crouch, shout, climb; dance. The
// control window (which has a canvas; this process does not) keys the magenta
// out, finds the sprites, packs the rows and stitches one sheet with one
// animation per row, and saves it here with its manifest. The old flat 4x2 /
// 4x4 sheets are still served and still work.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_DIR = path.join(__dirname, 'base');
const BASE = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'base.json'), 'utf8'));

// ---- the prompts, pixel-it's, one place
const STYLE = 'chunky pixels, clean dark outlines, flat shading with two or three tones per colour, SNES-era platformer look';
const MAGENTA = `CRITICAL: fill the ENTIRE background with solid, uniform, pure magenta (#FF00FF). Every single pixel that is not part of the character must be exactly that flat magenta — including the gaps INSIDE each pose (between the legs, under the arms, inside elbow bends). The background must be perfectly flat: NO gradients, NO vignette, NO glow, NO soft light, NO drop shadows, NO scenery, NO ground line, NO panels or cards of any other colour. The character must contain NO magenta anywhere. Hard-edged pixel art only. No text, no labels, no grid lines.`;

const HERO = () => `Turn the person in image 1 into a SINGLE full-body 2D retro pixel-art video game character sprite, in the exact pixel-art style of image 2 (${STYLE}). ONE character only — ignore everyone and everything else in the photo. Faithfully keep this person's real hairstyle, face, skin tone, facial hair, clothing and shoes; if the photo only shows the upper body, invent plain trousers and shoes that suit the outfit.

Pose: standing upright, relaxed idle, arms hanging at the sides, both feet flat on the floor. Seen in THREE-QUARTER view facing RIGHT: the body turned about 45 degrees towards the right so the face and the front of the body are visible, like a platformer hero.
Full body from the top of the head to the soles of the shoes, centred, filling about 85% of the image height, with empty margin all round. Nothing else in the image.

${MAGENTA}`;

const WARDROBE = (w) => (w ? `\nWARDROBE — identical in every single frame, no exceptions: ${w} Image 2's character wears different clothes; never copy any garment, length or colour from image 2.` : '');

const REF_SHEET = ({ rows, example, extra = '' }) => `Image 1 is a pixel-art game character. Image 2 is an example sprite sheet of a DIFFERENT character — ${example}.
Draw the character from image 1 as a sprite sheet that matches image 2 in every way except who it shows: the same pixel-art style (pixel size, outlines, shading), the same viewing angle, the same body proportions and figure size, and the SAME KIND of animations, pose for pose. Keep the exact face, hair, clothes and colours of image 1. Do NOT draw the character from image 2 and do not borrow its hair, face, clothes or belongings — only its poses and its style. ONE character only, always facing RIGHT.

${rows.length} rows of sprites, top to bottom, all at the SAME scale, each row spaced evenly left to right with clear magenta gaps between figures and between rows; no figure touches another figure or the image edge:
${rows.map((r, i) => `ROW ${i + 1} — ${r.key.toUpperCase()}, ${r.n} frame${r.n > 1 ? 's' : ''}: ${r.desc}`).join('\n')}
Every row stands on its own common floor line — feet flat on it in every grounded frame, and airborne frames rise above it. Frames within a row are evenly spaced and in order, left to right.${extra ? '\n' + extra : ''}

${MAGENTA}`;

class Characters {
  /** @param {object} o { dir: data folder, ai: Ai instance, onChange() } */
  constructor(o) {
    this.dir = o.dir;
    this.ai = o.ai;
    this.onChange = o.onChange || (() => {});
    fs.mkdirSync(this.dir, { recursive: true });
    this.items = this._load();
  }

  _indexFile() { return path.join(this.dir, 'index.json'); }
  _load() {
    try {
      const list = JSON.parse(fs.readFileSync(this._indexFile(), 'utf8'));
      return Array.isArray(list) ? list.filter((c) => c && c.id && fs.existsSync(this.file(c.id))) : [];
    } catch { return []; }
  }
  _save() {
    fs.writeFileSync(this._indexFile(), JSON.stringify(this.items, null, 2));
    this.onChange(this.list());
  }
  file(id, name = '') { return path.join(this.dir, path.basename(id) + (name ? '.' + name : '') + '.png'); }
  url(id, name = '') { return 'local://f' + encodeURI(this.file(id, name)).replace(/#/g, '%23'); }

  /** The house template: which sheets there are and what their rows mean. */
  base() {
    return { order: BASE.order, trims: BASE.trims || {}, sheets: Object.fromEntries(Object.entries(BASE.sheets).map(([k, s]) => [k, { label: s.label, grid: s.grid, rows: s.rows }])) };
  }

  /** What the windows and phones see. */
  list() {
    return this.items.map((c) => ({
      id: c.id, name: c.name, created: c.created, enabled: c.enabled !== false, sets: c.sets || [],
      url: this.url(c.id) + '?v=' + (c.version || 1), from: c.from || 'photo',
      hero: c.hero ? this.url(c.id, 'hero') + '?v=' + (c.version || 1) : null,
      cols: c.cols || 4, rows: c.rows || 2,     // flat sheets: the grid; sheets with a manifest carry it in anims
      anims: c.anims || null,                   // { cols, rows, cell, baseline, anims: { walk: { frames, fps, loop } } }
      wardrobe: c.wardrobe || '',
      usd: c.usd || 0,
    }));
  }

  async _edit({ images, prompt, size, model, quality, kind }) {
    const { key } = this.ai.keyInfo();
    if (!key) throw new Error('No OpenAI API key (Setup → AI)');
    const fd = new FormData();
    fd.append('model', model);
    fd.append('prompt', prompt);
    fd.append('size', size);
    fd.append('quality', quality || 'high');
    fd.append('background', 'opaque');
    fd.append('n', '1');
    for (const im of images) fd.append('image[]', new Blob([im.buf], { type: im.type || 'image/png' }), im.name);
    const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { authorization: 'Bearer ' + key }, body: fd });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(json && json.error && json.error.message) || text.slice(0, 200)}`);
    const d = json.data && json.data[0];
    if (!d || !d.b64_json) throw new Error('no image returned');
    const usd = this.ai.record(kind || 'sprite', model, json.usage);
    return { dataUrl: 'data:image/png;base64,' + d.b64_json, model, usd };
  }

  /**
   * One drawing step. `req.kind`:
   *   'hero'  — image: the photo (data URL) → the hero sprite, 1024x1536 on magenta
   *   'sheet' — image: the keyed hero (data URL), sheet: a Base sheet key, wardrobe: text
   *             → that sheet copied row for row, 1536x1024 on magenta; `rows` says what came back
   * Returns { dataUrl, usd, rows? }.
   */
  async draw(req) {
    const m = String(req.image).match(/^data:(image\/[a-z]+);base64,(.*)$/s);
    if (!m) throw new Error('image must be a data URL');
    const model = req.model || 'gpt-image-2';
    const img = { buf: Buffer.from(m[2], 'base64'), type: m[1], name: 'image1.' + (m[1].split('/')[1] || 'png') };
    if (req.kind === 'hero') {
      const r = await this._edit({
        images: [{ ...img, name: 'photo.' + (m[1].split('/')[1] || 'jpg') }, { buf: fs.readFileSync(path.join(BASE_DIR, BASE.hero)), name: 'style.png' }],
        prompt: HERO(), size: '1024x1536', model, kind: 'sprite',
      });
      return r;
    }
    if (req.kind === 'sheet') {
      const S = BASE.sheets[req.sheet];
      if (!S) throw new Error('no such sheet: ' + req.sheet);
      const rows = S.rows.map((r) => ({ ...r, desc: `${r.desc} — the same ${r.n} poses as row ${S.rows.indexOf(r) + 1} of image 2, in the same order, with the same timing and the same feet on the floor.` }));
      const example = `the Base character's "${S.label}" sheet: ${S.rows.length} row${S.rows.length > 1 ? 's' : ''} of ${S.rows.map((r) => r.n).join('/')} frames`;
      const prompt = REF_SHEET({ rows, example, extra: 'Image 2 is the house style: match its pixel density, outline weight, shading and figure size exactly — this character must look like it belongs on the same sheet as Base.' + WARDROBE(req.wardrobe) });
      const r = await this._edit({
        images: [{ ...img, name: 'character.png' }, { buf: fs.readFileSync(path.join(BASE_DIR, S.file)), name: 'base-sheet.png' }],
        prompt, size: '1536x1024', model, kind: 'sprite',
      });
      return { ...r, rows: S.rows, grid: S.grid };
    }
    throw new Error('unknown draw kind');
  }

  /**
   * One sentence about what the hero wears, from a vision model. Pinned into
   * every sheet prompt: the example sheet shows Base in shorts and a T-shirt,
   * and in one-row sheets the model otherwise dresses the new character in them.
   */
  async wardrobe(heroDataUrl, model) {
    try {
      const r = await this.ai.respond({
        kind: 'sprite', model: model || 'gpt-5.4-mini', maxOutputTokens: 200,
        input: [{ role: 'user', content: [
          { type: 'input_text', text: "Describe this pixel-art character's clothing, hair and accessories in one precise sentence — garment types and lengths (e.g. long trousers vs shorts), colours, shoes, headwear, bag — for an artist who must redraw the character identically. No preamble." },
          { type: 'input_image', image_url: heroDataUrl, detail: 'low' },
        ] }],
      });
      return (r.text || '').trim().slice(0, 400);
    } catch (e) { return ''; }
  }

  /**
   * Store a finished sheet (PNG data URL) as a new character, or replace an
   * existing one's. `anims` is the manifest for row sheets; `cols`/`rows` the
   * grid of a flat one. `hero` (PNG data URL) is kept beside it for the cards.
   */
  save({ id, name, png, from, cols, rows, anims, hero, wardrobe, usd }) {
    const m = String(png).match(/^data:image\/png;base64,(.*)$/s);
    if (!m) throw new Error('sheet must be a PNG data URL');
    let c = id ? this.items.find((x) => x.id === id) : null;
    if (!c) {
      c = { id: 'ch_' + crypto.randomBytes(5).toString('hex'), name: String(name || 'Someone').slice(0, 40), created: Date.now(), enabled: true, sets: [], from: from || 'photo', version: 1 };
      this.items.push(c);
    } else {
      c.version = (c.version || 1) + 1;
      if (name) c.name = String(name).slice(0, 40);
    }
    if (anims) { c.anims = anims; delete c.cols; delete c.rows; }
    else { if (cols) c.cols = cols; if (rows) c.rows = rows; }
    if (wardrobe != null) c.wardrobe = String(wardrobe).slice(0, 400);
    if (usd) c.usd = (c.usd || 0) + usd;
    fs.writeFileSync(this.file(c.id), Buffer.from(m[1], 'base64'));
    if (hero) {
      const hm = String(hero).match(/^data:image\/png;base64,(.*)$/s);
      if (hm) { fs.writeFileSync(this.file(c.id, 'hero'), Buffer.from(hm[1], 'base64')); c.hero = true; }
    }
    this._save();
    return this.list().find((x) => x.id === c.id);
  }

  update(id, patch) {
    const c = this.items.find((x) => x.id === id);
    if (!c) return null;
    if (patch.name != null) c.name = String(patch.name).slice(0, 40);
    if (patch.enabled != null) c.enabled = !!patch.enabled;
    if (Array.isArray(patch.sets)) c.sets = patch.sets.map(String).slice(0, 20);
    this._save();
    return this.list().find((x) => x.id === id);
  }

  remove(id) {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return false;
    try { fs.unlinkSync(this.file(id)); } catch {}
    try { fs.unlinkSync(this.file(id, 'hero')); } catch {}
    this.items.splice(i, 1);
    this._save();
    return true;
  }
}

module.exports = { Characters };
