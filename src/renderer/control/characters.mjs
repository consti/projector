// The pixel people on the Mac: turning the image model's sheets into a
// character (the main process has no canvas), the People view where the
// roster is managed, and the bridge for phones that pixelate themselves.
//
// A character is drawn the way pixel-it draws them: a hero sprite from the
// photo first (the identity, locked once; on the wall within a minute, standing
// there), then every animation sheet of Base — the house template — copied
// row for row "like Base, but this person", all at once, and stitched into one
// sheet with one animation per row and a manifest (see sheetpack.mjs).

import { readRows, combine, framesOf, chromaKey, findSprites, loadImage } from '/renderer/control/sheetpack.mjs';
import { legacyManifest } from '/shared/sprites.mjs';

// made-up names with no gender to them: a verb and a fruit
const VERBS = ['Juggling', 'Dancing', 'Wobbling', 'Bouncing', 'Sneaking', 'Whistling', 'Napping', 'Spinning', 'Humming', 'Skipping', 'Yawning', 'Zooming', 'Tiptoeing', 'Giggling', 'Floating', 'Marching', 'Snoring', 'Waddling', 'Twirling', 'Grooving'];
const FRUITS = ['Papaya', 'Kumquat', 'Mango', 'Plum', 'Lychee', 'Banana', 'Durian', 'Fig', 'Guava', 'Pomelo', 'Melon', 'Cherry', 'Kiwi', 'Tangerine', 'Quince', 'Rambutan', 'Apricot', 'Persimmon', 'Coconut', 'Pear'];
export const funnyName = () => VERBS[Math.floor(Math.random() * VERBS.length)] + ' ' + FRUITS[Math.floor(Math.random() * FRUITS.length)];

/** Downscale a photo (data URL or File) for upload: longest edge 768, JPEG. */
export async function preparePhoto(input) {
  const src = typeof input === 'string' ? input : await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(input); });
  const img = await loadImage(src);
  const s = Math.min(1, 768 / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.9);
}

const idToCanvas = (id) => { const cv = document.createElement('canvas'); cv.width = id.width; cv.height = id.height; cv.getContext('2d').putImageData(id, 0, 0); return cv; };
/** A keyed ImageData flattened onto magenta, as the model wants its inputs. */
const onMagenta = (id) => {
  const c = new ImageData(new Uint8ClampedArray(id.data), id.width, id.height);
  const d = c.data;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] < 128) { d[i] = 255; d[i + 1] = 0; d[i + 2] = 255; d[i + 3] = 255; } else d[i + 3] = 255;
  return idToCanvas(c).toDataURL('image/png');
};
/** The hero's frames from its keyed image: the biggest blob as a one-frame idle. */
const heroFrames = (id) => {
  const big = findSprites(id).sort((a, b) => b.count - a.count)[0];
  if (!big) throw new Error('no figure in the hero');
  return [{ key: 'idle', fps: 1, loop: true, frames: [{ id, blob: big }] }];
};

// ------------------------------------------------------------------ view ----
/**
 * The People view: the roster as cards with an animated preview, a name to
 * edit, on/off, which effect sets they belong to, delete; a way to add one
 * from a photo on the Mac; and the queue of characters being drawn.
 */
export class PeopleView {
  constructor(root, hooks) {
    this.root = root;
    this.h = hooks;             // { el, toast, settings(), state(), ai() }
    this.jobs = [];             // [{ id, name, from, status, error, steps, done }]
    this.previews = [];
    this.timer = null;
    this.base = null;
    api.charactersBase().then((b) => { this.base = b; });
  }

  get list() { return (this.h.state() && this.h.state().characters) || []; }
  models() {
    const a = this.h.settings().ai || {};
    return { sprite: a.spriteModel || 'gpt-image-2', vision: a.visionModel || 'gpt-5.4-mini' };
  }
  job(name, from, status) {
    const job = { id: 'job' + Date.now() + Math.random(), name, from, status, error: null, usd: 0 };
    this.jobs.unshift(job); this.render();
    return job;
  }

  /** Draw every Base sheet for a keyed hero (data URL on magenta), in parallel; returns animations for combine(). */
  async drawSheets(heroUrl, wardrobe, keys, onEach) {
    const base = this.base || (this.base = await api.charactersBase());
    const { sprite } = this.models();
    let usd = 0;
    const results = await Promise.all(keys.map(async (k) => {
      const S = base.sheets[k];
      const r = await api.charactersDraw({ kind: 'sheet', image: heroUrl, sheet: k, wardrobe, model: sprite });
      if (r.error) { onEach(k, null, r.error); return []; }
      usd += r.usd || 0;
      const img = await loadImage(r.dataUrl);
      const { id, rows } = readRows(img, S.rows.map((x) => x.n));
      const anims = [];
      rows.forEach((row, i) => { const spec = S.rows[i]; if (spec && row.length) anims.push({ key: spec.key, fps: spec.fps, loop: spec.loop !== false, frames: row.map((blob) => ({ id, blob })) }); });
      onEach(k, anims, null);
      return anims;
    }));
    return { anims: results.flat(), usd };
  }
  /** Stitch, in Base's order, with Base's trims (a 9-key walk keeps frames 2..8). */
  stitch(anims) {
    const base = this.base;
    const order = base ? base.order : [];
    for (const [k, [a, b]] of Object.entries((base && base.trims) || {})) { const an = anims.find((x) => x.key === k); if (an && an.frames.length >= b) an.frames = an.frames.slice(a - 1, b); }
    anims.sort((x, y) => (order.indexOf(x.key) + 1 || 99) - (order.indexOf(y.key) + 1 || 99));
    return combine(anims);
  }

  /** Make a character from a photo (data URL). Used by the file picker and the phones. */
  async make(photo, name, from = 'photo', onStatus) {
    const job = this.job(name, from, 'Drawing the hero…');
    const say = (s) => { job.status = s; onStatus && onStatus(s); this.render(); };
    try {
      const { sprite, vision } = this.models();
      const raw = await api.charactersDraw({ kind: 'hero', image: await preparePhoto(photo), model: sprite });
      if (raw.error) throw new Error(raw.error);
      job.usd += raw.usd || 0;
      const heroImg = await loadImage(raw.dataUrl);
      const heroId = chromaKey(heroImg);
      const heroPng = idToCanvas(heroId).toDataURL('image/png');
      // the hero alone goes in first, so the person is on the wall within a minute
      const first = this.stitch(heroFrames(heroId));
      const c = await api.charactersSave({ name, png: first.canvas.toDataURL('image/png'), from, anims: first.manifest, hero: heroPng, usd: job.usd });
      if (c && c.error) throw new Error(c.error);
      say('Hero drawn — now the moves');
      const wardrobe = await api.charactersWardrobe(raw.dataUrl, vision);
      const keys = Object.keys((this.base || await api.charactersBase()).sheets);
      const landed = [];
      const { anims, usd } = await this.drawSheets(onMagenta(heroId), wardrobe, keys, (k, a, err) => {
        landed.push(k + (err ? ' failed' : ''));
        say(`${landed.length} of ${keys.length} sheets: ${landed.join(', ')}`);
      });
      job.usd += usd;
      const walk = anims.find((a) => a.key === 'walk');
      if (!walk) throw new Error('no walk came back');
      // the hero is drawn much larger than the sheet figures, so once the sheets are in it
      // is only the card art: idle comes from the rest sheet, or failing that a walk frame
      if (!anims.some((a) => a.key === 'idle')) anims.push({ key: 'idle', fps: 1, loop: true, frames: [walk.frames[1] || walk.frames[0]] });
      const all = this.stitch(anims);
      const c2 = await api.charactersSave({ id: c.id, png: all.canvas.toDataURL('image/png'), from, anims: all.manifest, wardrobe, usd });
      if (c2 && c2.error) throw new Error(c2.error);
      say('Done');
      this.jobs = this.jobs.filter((j) => j !== job);
      this.h.toast(`${name} is in the room`);
      this.render();
      return c2;
    } catch (e) {
      job.error = e.message || String(e); job.status = 'Failed';
      onStatus && onStatus('Failed: ' + job.error);
      this.render();
      throw e;
    }
  }

  /**
   * More moves for a character that exists: draw the given Base sheets from its
   * hero (or, for an old flat sheet, from its idle frame) and stitch them in.
   */
  async addSheets(c, keys, label) {
    const job = this.job(c.name, 'more', label + '…');
    try {
      const { vision } = this.models();
      const img = await loadImage(c.url);
      const manifest = c.anims || legacyManifest(c.rows || 2);
      const have = framesOf(img, manifest);
      let heroId;
      if (c.hero) heroId = chromaKey(await loadImage(c.hero));
      else {
        const idle = have.find((a) => a.key === 'idle');
        if (!idle) throw new Error('no idle frame to draw from');
        const b = idle.frames[0].blob, src = idle.frames[0].id;
        const cv = document.createElement('canvas'); cv.width = b.maxX - b.minX + 1 + 80; cv.height = b.maxY - b.minY + 1 + 80;
        cv.getContext('2d').drawImage(idToCanvas(src), b.minX, b.minY, cv.width - 80, cv.height - 80, 40, 40, cv.width - 80, cv.height - 80);
        heroId = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
      }
      const heroUrl = onMagenta(heroId);
      const wardrobe = c.wardrobe || await api.charactersWardrobe(heroUrl, vision);
      const landed = [];
      const { anims, usd } = await this.drawSheets(heroUrl, wardrobe, keys, (k, a, err) => { landed.push(k + (err ? ' failed' : '')); job.status = `${landed.join(', ')}`; this.render(); });
      if (!anims.length) throw new Error('nothing usable came back');
      const fresh = new Set(anims.map((a) => a.key));
      const all = this.stitch([...have.filter((a) => !fresh.has(a.key)), ...anims]);
      const r = await api.charactersSave({ id: c.id, png: all.canvas.toDataURL('image/png'), anims: all.manifest, wardrobe, usd, hero: c.hero ? null : idToCanvas(heroId).toDataURL('image/png') });
      if (r && r.error) throw new Error(r.error);
      this.jobs = this.jobs.filter((j) => j !== job);
      this.h.toast(`${c.name}: ${label.toLowerCase()} done`);
    } catch (e) {
      job.error = e.message || String(e); job.status = 'Failed';
    }
    this.render();
  }

  show() { this.root.hidden = false; this.render(); this.animate(); }
  hide() { this.root.hidden = true; if (this.timer) { cancelAnimationFrame(this.timer); this.timer = null; } }

  animate() {
    if (this.root.hidden) return;
    const t = performance.now() / 1000;
    for (const p of this.previews) p.draw(t);
    this.timer = requestAnimationFrame(() => this.animate());
  }

  /** A card's preview: the character cycling through its animations. */
  preview(c, cv) {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = c.url;
    const man = c.anims || legacyManifest(c.rows || 2);
    const keys = Object.keys(man.anims || {}).filter((k) => man.anims[k].frames.length);
    const show = ['idle', 'walk', 'dance', 'run', 'dance2', 'jump', 'sit', 'climb', 'sleep', 'shout', 'crouch'].filter((k) => keys.includes(k));
    let cw = 0, ch = 0;
    const draw = (t) => {
      const x = cv.getContext('2d'); x.imageSmoothingEnabled = false;
      x.clearRect(0, 0, cv.width, cv.height);
      if (!img.complete || !img.naturalWidth || !show.length) return;
      cw = img.naturalWidth / man.cols; ch = img.naturalHeight / man.rows;
      const key = show[Math.floor(t / 4) % show.length];
      const a = man.anims[key];
      const cell = a.frames[Math.floor(t * (a.fps || 4)) % a.frames.length];
      const s = Math.min(cv.width / cw, cv.height / ch);
      const dw = cw * s, dh = ch * s;
      x.drawImage(img, (cell % man.cols) * cw, Math.floor(cell / man.cols) * ch, cw, ch, (cv.width - dw) / 2, cv.height - dh, dw, dh);
    };
    img.onload = () => draw(0);
    return { draw };
  }

  render() {
    const el = this.h.el;
    const root = this.root;
    root.innerHTML = '';
    this.previews = [];
    const sets = (this.h.settings().fxSets || []).map((s) => s.name);
    const active = this.h.settings().fxSet || '';
    const bar = el('div', { class: 'libBar' }, [
      el('div', { class: 'libTitle' }, [el('span', { text: 'People' }), el('span', { class: 'libCount hint', text: `${this.list.length} in the roster` })]),
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', text: 'Add from photo…', onclick: () => this.pick() }),
    ]);
    root.appendChild(bar);
    root.appendChild(el('div', { class: 'libNote hint', text: 'Anyone on the phone can pixelate themselves (F4 Me). Characters that are on — and, when an effect set is active, in that set — appear in the Pixel people effect: they fall in, walk and climb your shapes, dance to the beat. A photo goes to OpenAI’s image model, which draws a hero and six sheets of moves (about a dollar and three minutes a person); nothing else leaves the room.' }));
    if (this.jobs.length) {
      root.appendChild(el('div', { class: 'libBatch' }, this.jobs.map((j) => el('span', { class: 'statChip' + (j.error ? ' bad' : ' busy on'), text: `${j.name}: ${j.status}${j.error ? ' — ' + j.error : ''}`,
        onclick: () => { if (j.error) { this.jobs = this.jobs.filter((x) => x !== j); this.render(); } } }))));
    }
    const grid = el('div', { class: 'libGrid people' });
    if (!this.list.length) grid.appendChild(el('div', { class: 'libEmpty hint', text: 'Nobody yet. Add a photo here, or open the phone page and press F4 Me.' }));
    const baseKeys = this.base ? Object.keys(this.base.sheets) : [];
    for (const c of this.list) {
      const cv = el('canvas', { width: 160, height: 220, class: 'peoplePrev' });
      this.previews.push(this.preview(c, cv));
      const man = c.anims || legacyManifest(c.rows || 2);
      const moves = Object.keys(man.anims || {}).filter((k) => man.anims[k].frames.length);
      const name = el('input', { type: 'text', value: c.name, class: 'peopleName' });
      name.onchange = () => api.charactersUpdate(c.id, { name: name.value.trim() || c.name });
      const on = el('label', { class: 'tog' }, [el('input', { type: 'checkbox' }), el('span', { class: 'sw' }), el('span', { class: 'tl', text: 'On' })]);
      on.querySelector('input').checked = c.enabled;
      on.querySelector('input').onchange = (e) => api.charactersUpdate(c.id, { enabled: e.target.checked });
      const setRow = el('div', { class: 'row peopleSets' });
      if (sets.length) {
        setRow.appendChild(el('span', { class: 'hint', text: 'In sets' }));
        const inAll = !c.sets || !c.sets.length;
        const mk = (label, get, set) => { const l = el('label', { class: 'tog' }, [el('input', { type: 'checkbox' }), el('span', { class: 'sw' }), el('span', { class: 'tl', text: label })]); l.querySelector('input').checked = get(); l.querySelector('input').onchange = (e) => set(e.target.checked); return l; };
        setRow.appendChild(mk('All', () => inAll, (v) => api.charactersUpdate(c.id, { sets: v ? [] : sets.slice() })));
        for (const s of sets) setRow.appendChild(mk(s, () => inAll || c.sets.includes(s), (v) => {
          const cur = new Set(inAll ? sets : c.sets); if (v) cur.add(s); else cur.delete(s);
          api.charactersUpdate(c.id, { sets: cur.size === sets.length ? [] : [...cur] });
        }));
      }
      const inActive = !active || !c.sets || !c.sets.length || c.sets.includes(active);
      const missing = baseKeys.filter((k) => !this.base.sheets[k].rows.every((r) => moves.includes(r.key)));
      const busy = this.jobs.some((j) => j.name === c.name && !j.error);
      const more = [];
      if (!busy && missing.includes('dance')) more.push(el('button', { class: 'btn sm', text: 'Teach to dance', title: 'Draw a sheet of dance moves for this character', onclick: () => this.addSheets(c, ['dance'], 'Learning to dance') }));
      if (!busy && missing.length > 1) more.push(el('button', { class: 'btn sm', text: 'All the moves', title: `Draw the sheets this character is missing: ${missing.join(', ')}`, onclick: () => this.addSheets(c, missing, 'Learning the moves') }));
      const card = el('div', { class: 'libCard peopleCard' + (c.enabled && inActive ? '' : ' off') }, [
        el('div', { class: 'peopleThumb' }, [cv]),
        el('div', { class: 'libInfo' }, [
          name,
          el('div', { class: 'hint', text: `${c.from === 'phone' ? 'From a phone' : 'From a photo'} · ${new Date(c.created).toLocaleDateString()} · ${moves.length} move${moves.length === 1 ? '' : 's'}${c.usd ? ` · $${c.usd.toFixed(2)}` : ''}${!inActive ? ' · not in the active set' : ''}` }),
          el('div', { class: 'libTagline' }, moves.map((m) => el('span', { class: 'miniTag', text: m }))),
          setRow,
        ]),
        el('div', { class: 'libActions' }, [
          on,
          el('span', { class: 'grow' }),
          ...more,
          el('button', { class: 'btn sm danger', text: 'Remove', onclick: () => { if (confirm(`Remove ${c.name}?`)) api.charactersRemove(c.id); } }),
        ]),
      ]);
      grid.appendChild(card);
    }
    root.appendChild(grid);
  }

  pick() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
    inp.onchange = async () => {
      for (const f of inp.files) {
        const name = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 30) || funnyName();
        this.make(f, name, 'photo').catch(() => {});
      }
    };
    inp.click();
  }
}
