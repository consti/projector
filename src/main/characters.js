'use strict';
// The pixel people: a roster of characters made from photos. Each is a 4x2
// sprite sheet (idle, idle, walk x4, panic, sit — the pixel-it contract) with
// a second 4x2 sheet of dance moves stacked under it (4x4 in all), kept
// as a PNG next to an index in the app's data folder. Generation asks OpenAI's
// image model to redraw the person in the photo as a sprite sheet on a flat
// magenta field; the control window keys the magenta out and re-packs the
// frames (it has a canvas; this process does not) and saves the result here.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROMPT = `Turn the person in image 1 into a 2D retro pixel-art video game character sprite sheet. Generate ONLY that one person — a single character, ignore everyone else in the photo. Image 2 shows the exact pixel-art style to match (chunky pixels, clean outlines, SNES-era platformer look).

Produce EXACTLY 8 sprites of the SAME character arranged in a strict 4-column by 2-row grid: exactly 4 sprites in the top row, exactly 4 in the bottom row, 8 total — no extras, no duplicates. Each grid cell is 384x512 pixels. Every sprite must sit strictly INSIDE its own cell with generous empty margin on all sides — sprites must NEVER touch or cross a cell boundary and must never touch each other. Draw the character at the SAME scale in every cell (roughly 380px tall). Full body, always in profile facing RIGHT.

Grid contents, left to right:
Top row: (1) idle standing pose, (2) idle pose with a subtle breathing bob, (3) walk frame - right leg forward mid-stride, (4) walk frame - legs passing, upright.
Bottom row: (5) walk frame - left leg forward mid-stride, (6) walk frame - legs passing, arms swinging, (7) PANICKED FALLING pose - both arms stretched straight up waving, legs kicking, mouth wide open screaming in comic panic, (8) SITTING on the ground - knees bent up in front, hands resting on the knees, relaxed, still in profile facing right.

Faithfully keep this person's real hairstyle, face, skin tone, clothing and shoes from image 1.

CRITICAL: Fill the ENTIRE background with solid, uniform, pure magenta (#FF00FF). Every single pixel that is not part of the character's body must be exactly that flat magenta — including the gaps INSIDE each pose (between the legs, under the arms, inside elbow bends). The background must be perfectly flat: NO gradients, NO vignette, NO glow, NO soft light, NO drop shadows, NO scenery, NO ground line, NO panels or cards of any other color. The character must contain NO magenta anywhere. Hard-edged pixel art only. No text, no labels, no grid lines.`;

// The second sheet: the same character dancing, drawn from the first sheet so
// it is unmistakably the same person at the same size.
const DANCE_PROMPT = `Image 1 is an existing pixel-art sprite sheet of ONE character. Draw that EXACT SAME character — same face, same hair, same clothes, same colours, same art style and the same size — DANCING.

Produce EXACTLY 8 sprites arranged in a strict 4-column by 2-row grid (4 in the top row, 4 in the bottom row), no extras. Each cell is 384x512 pixels.

SIZE AND FRAMING — this matters more than anything else:
· Every sprite is a FULL BODY figure: the top of the head AND the feet are visible in every single cell. Never a close-up, never cropped.
· Draw the character at EXACTLY the same scale as in image 1 — roughly 380px from head to feet, the same as the reference sheet.
· All 8 frames are the same size as each other; the character must not grow, shrink or drift between frames — only the pose changes.
· Each sprite sits inside its own cell with empty margin all round, never touching a cell edge or another sprite. Feet rest on a common baseline near the bottom of the cell.
· Same viewpoint as image 1: full body, side-on profile facing RIGHT.

The 8 frames, in order, are dance moves that pair up (1+2, 3+4, 5+6, 7+8 alternate on the beat):
1. both arms up in the air, knees bent, hips swung left, big grin
2. both arms up, hips swung right, one foot lifted
3. mid-jump, both feet off the ground, arms out wide, mouth open cheering
4. landed in a crouch, arms swinging down, head bobbing
5. one arm pointing straight up disco-style, the other on the hip, weight on the back leg
6. same disco pose mirrored: the other arm up, weight on the front leg
7. spinning: seen from the back, arms out, hair swinging
8. a little kick: one leg kicked out forward, arms pumping

CRITICAL: fill the ENTIRE background with solid, uniform, pure magenta (#FF00FF) — every pixel that is not the character, including the gaps between the legs and under the arms. No gradients, no glow, no shadows, no ground line, no scenery, no panels. The character must contain no magenta. Hard-edged pixel art only. No text, no labels, no grid lines.`;

class Characters {
  /** @param {object} o { dir: data folder, ai: Ai instance, onChange() } */
  constructor(o) {
    this.dir = o.dir;
    this.ai = o.ai;
    this.onChange = o.onChange || (() => {});
    this.styleRef = path.join(__dirname, 'style-reference.png');
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
  file(id) { return path.join(this.dir, path.basename(id) + '.png'); }
  url(id) { return 'local://f' + encodeURI(this.file(id)).replace(/#/g, '%23'); }

  /** What the windows and phones see. */
  list() {
    return this.items.map((c) => ({
      id: c.id, name: c.name, created: c.created, enabled: c.enabled !== false, sets: c.sets || [],
      url: this.url(c.id) + '?v=' + (c.version || 1), from: c.from || 'photo',
      cols: c.cols || 4, rows: c.rows || 2,     // sheet grid; 4x2 sheets predate the dance frames
    }));
  }

  /**
   * Ask the image model for a magenta sheet: the base sheet from a photo (plus
   * the style reference), or the dance sheet from a cleaned base sheet when
   * `opts.dance` is set. Returns { dataUrl } of the raw 1536x1024 PNG; the
   * renderer cleans it and calls save().
   */
  async generate(imageDataUrl, opts = {}) {
    const m = String(imageDataUrl).match(/^data:(image\/[a-z]+);base64,(.*)$/s);
    if (!m) throw new Error('image must be a data URL');
    const { key } = this.ai.keyInfo();
    if (!key) throw new Error('No OpenAI API key (Setup → AI)');
    const model = opts.model || 'gpt-image-1.5';
    const fd = new FormData();
    fd.append('model', model);
    fd.append('prompt', opts.dance ? DANCE_PROMPT : PROMPT);
    fd.append('size', '1536x1024');
    fd.append('quality', opts.quality || 'medium');
    fd.append('background', 'opaque');
    fd.append('n', '1');
    fd.append('image[]', new Blob([Buffer.from(m[2], 'base64')], { type: m[1] }), (opts.dance ? 'character.' : 'photo.') + (m[1].split('/')[1] || 'jpg'));
    if (!opts.dance) fd.append('image[]', new Blob([fs.readFileSync(this.styleRef)], { type: 'image/png' }), 'style.png');
    const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { authorization: 'Bearer ' + key }, body: fd });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(json && json.error && json.error.message) || text.slice(0, 200)}`);
    const d = json.data && json.data[0];
    if (!d || !d.b64_json) throw new Error('no image returned');
    const usd = this.ai.record('sprite', model, json.usage);
    return { dataUrl: 'data:image/png;base64,' + d.b64_json, model, usage: json.usage || null, usd };
  }

  /** Store a cleaned sheet (PNG data URL) as a new character, or replace an existing one's sheet. */
  save({ id, name, png, from, cols, rows }) {
    const m = String(png).match(/^data:image\/png;base64,(.*)$/s);
    if (!m) throw new Error('sheet must be a PNG data URL');
    let c = id ? this.items.find((x) => x.id === id) : null;
    if (!c) {
      c = { id: 'ch_' + crypto.randomBytes(5).toString('hex'), name: String(name || 'Someone').slice(0, 40), created: Date.now(), enabled: true, sets: [], from: from || 'photo', version: 1, cols: cols || 4, rows: rows || 2 };
      this.items.push(c);
    } else {
      c.version = (c.version || 1) + 1;
      if (name) c.name = String(name).slice(0, 40);
      if (cols) c.cols = cols;
      if (rows) c.rows = rows;
    }
    fs.writeFileSync(this.file(c.id), Buffer.from(m[1], 'base64'));
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
    this.items.splice(i, 1);
    this._save();
    return true;
  }
}

module.exports = { Characters };
