// The pixel people on the Mac: cleaning up generated sheets (the main process
// has no canvas), the People view where the roster is managed, and the bridge
// for phones that pixelate themselves.

// made-up names with no gender to them: a verb and a fruit
const VERBS = ['Juggling', 'Dancing', 'Wobbling', 'Bouncing', 'Sneaking', 'Whistling', 'Napping', 'Spinning', 'Humming', 'Skipping', 'Yawning', 'Zooming', 'Tiptoeing', 'Giggling', 'Floating', 'Marching', 'Snoring', 'Waddling', 'Twirling', 'Grooving'];
const FRUITS = ['Papaya', 'Kumquat', 'Mango', 'Plum', 'Lychee', 'Banana', 'Durian', 'Fig', 'Guava', 'Pomelo', 'Melon', 'Cherry', 'Kiwi', 'Tangerine', 'Quince', 'Rambutan', 'Apricot', 'Persimmon', 'Coconut', 'Pear'];
export const funnyName = () => VERBS[Math.floor(Math.random() * VERBS.length)] + ' ' + FRUITS[Math.floor(Math.random() * FRUITS.length)];

const SHEET = { w: 1536, h: 1024, cols: 4, rows: 2 };   // idle x2, walk x2 | walk x2, panic, sit — and the dance sheet uses the same grid

/**
 * Magenta background → transparency, blobs found and re-packed into the 4x2
 * grid on a common baseline (a port of pixel-it's chromaKey + normalizeSheet).
 * Returns a PNG data URL.
 */
export async function cleanSheet(dataUrl) {
  const img = await loadImage(dataUrl);
  const W = SHEET.w, H = SHEET.h;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = false;
  x.drawImage(img, 0, 0, W, H);
  const id = x.getImageData(0, 0, W, H);
  const d = id.data;
  // key the magenta (and magenta-tinted edge blends)
  for (let p = 0; p < W * H; p++) {
    const r = d[p * 4], g = d[p * 4 + 1], b = d[p * 4 + 2];
    const magenta = (r > 140 && b > 140 && g < Math.min(r, b) - 50) || (r - g > 70 && b - g > 70);
    d[p * 4 + 3] = magenta ? 0 : 255;
  }
  // connected components (8-conn) of opaque pixels; drop specks
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const blobs = [];
  for (let i = 0; i < W * H; i++) {
    if (seen[i] || !d[i * 4 + 3]) continue;
    let top = 0, count = 0;
    stack[top++] = i; seen[i] = 1;
    const box = { minX: W, minY: H, maxX: 0, maxY: 0, px: [] };
    while (top) {
      const p = stack[--top];
      const px = p % W, py = (p / W) | 0;
      count++;
      if (count < 260) box.px.push(p);          // small enough to be a speck: remember it, to clear
      if (px < box.minX) box.minX = px; if (px > box.maxX) box.maxX = px;
      if (py < box.minY) box.minY = py; if (py > box.maxY) box.maxY = py;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (!seen[n] && d[n * 4 + 3]) { seen[n] = 1; stack[top++] = n; }
      }
    }
    box.count = count;
    if (count < 250) {
      // speck: clear it
      clearBox(d, W, box);
    } else blobs.push(box);
  }
  // merge blobs that nearly touch (a sprite split at a thin joint)
  let merged = true;
  const near = (a, b, gap = 12) => a.minX < b.maxX + gap && b.minX < a.maxX + gap && a.minY < b.maxY + gap && b.minY < a.maxY + gap;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < blobs.length; i++) for (let j = i + 1; j < blobs.length; j++) {
      if (near(blobs[i], blobs[j])) {
        blobs[i] = { minX: Math.min(blobs[i].minX, blobs[j].minX), minY: Math.min(blobs[i].minY, blobs[j].minY),
          maxX: Math.max(blobs[i].maxX, blobs[j].maxX), maxY: Math.max(blobs[i].maxY, blobs[j].maxY), count: blobs[i].count + blobs[j].count };
        blobs.splice(j, 1); merged = true; break outer;
      }
    }
  }
  const cw = W / SHEET.cols, ch = H / SHEET.rows;
  const big = blobs.filter((b) => b.count > cw * ch * 0.02);
  const src = cv;                                   // keyed source
  x.putImageData(id, 0, 0);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const ox = out.getContext('2d');
  ox.imageSmoothingEnabled = false;
  const place = (box, idx) => {
    const bw = box.maxX - box.minX + 1, bh = box.maxY - box.minY + 1;
    const x0 = (idx % SHEET.cols) * cw, y0 = Math.floor(idx / SHEET.cols) * ch;
    const scale = Math.min(1, (cw - 16) / bw, (ch - 40) / bh);
    const dw = Math.round(bw * scale), dh = Math.round(bh * scale);
    ox.drawImage(src, box.minX, box.minY, bw, bh, Math.round(x0 + (cw - dw) / 2), Math.round(y0 + ch - dh - 24), dw, dh);
  };
  if (big.length === SHEET.cols * SHEET.rows) {
    big.sort((a, b) => (a.minY + a.maxY) - (b.minY + b.maxY));
    const rows = [];
    for (let r = 0; r < SHEET.rows; r++) rows.push(big.slice(r * SHEET.cols, (r + 1) * SHEET.cols).sort((a, b) => a.minX - b.minX));
    rows.flat().forEach((b, i) => place(b, i));
  } else {
    // fall back to per-cell cropping
    for (let row = 0; row < SHEET.rows; row++) for (let col = 0; col < SHEET.cols; col++) {
      const x0 = col * cw, y0 = row * ch;
      let minX = W, minY = H, maxX = -1, maxY = -1;
      for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) {
        if (d[((y0 + yy) * W + x0 + xx) * 4 + 3]) { minX = Math.min(minX, x0 + xx); maxX = Math.max(maxX, x0 + xx); minY = Math.min(minY, y0 + yy); maxY = Math.max(maxY, y0 + yy); }
      }
      if (maxX >= 0) place({ minX, minY, maxX, maxY }, row * SHEET.cols + col);
    }
  }
  return out.toDataURL('image/png');
}

/** Two 1536x1024 sheets, one under the other: a 1536x2048 PNG data URL. */
async function stackSheets(topUrl, bottomUrl) {
  const [a, b] = await Promise.all([loadImage(topUrl), loadImage(bottomUrl)]);
  const cv = document.createElement('canvas'); cv.width = SHEET.w; cv.height = SHEET.h * 2;
  const x = cv.getContext('2d'); x.imageSmoothingEnabled = false;
  x.drawImage(a, 0, 0); x.drawImage(b, 0, SHEET.h);
  return cv.toDataURL('image/png');
}

function clearBox(d, W, box) {
  for (const p of box.px || []) d[p * 4 + 3] = 0;
}

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

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

// ------------------------------------------------------------------ view ----
/**
 * The People view: the roster as cards with an animated idle preview, a name
 * to edit, on/off, which effect sets they belong to, delete; a way to add one
 * from a photo on the Mac; and the queue of phones being pixelated.
 */
export class PeopleView {
  constructor(root, hooks) {
    this.root = root;
    this.h = hooks;             // { el, toast, settings(), state(), ai() }
    this.jobs = [];             // [{ id, name, from, status, error }]
    this.previews = [];
    this.timer = null;
  }

  get list() { return (this.h.state() && this.h.state().characters) || []; }

  /** Make a character from a photo (data URL). Used by the file picker and the phones. */
  async make(photo, name, from = 'photo', onStatus) {
    const job = { id: 'job' + Date.now(), name, from, status: 'Drawing…', error: null };
    this.jobs.unshift(job); this.render();
    const say = (s) => { job.status = s; onStatus && onStatus(s); this.render(); };
    try {
      const a = this.h.settings().ai || {};
      const model = a.spriteModel || a.imageModel || 'gpt-image-1.5';
      const raw = await api.charactersGenerate(await preparePhoto(photo), { model });
      if (raw.error) throw new Error(raw.error);
      say('Cutting out…');
      const base = await cleanSheet(raw.dataUrl);
      // the base sheet goes in first so the person is on the wall within a minute;
      // the dance moves are drawn from it and stacked under it when they arrive
      const c = await api.charactersSave({ name, png: base, from, cols: SHEET.cols, rows: 2 });
      if (c && c.error) throw new Error(c.error);
      say('Learning to dance…');
      try {
        const rawDance = await api.charactersGenerate(base, { model, dance: true });
        if (rawDance.error) throw new Error(rawDance.error);
        const dance = await cleanSheet(rawDance.dataUrl);
        const png = await stackSheets(base, dance);
        const c2 = await api.charactersSave({ id: c.id, png, from, cols: SHEET.cols, rows: 4 });
        if (c2 && c2.error) throw new Error(c2.error);
      } catch (e) {
        this.h.toast(`${name} is in, but the dance sheet failed: ${e.message}`);
      }
      if (c && c.error) throw new Error(c.error);
      say('Done');
      this.jobs = this.jobs.filter((j) => j !== job);
      this.h.toast(`${name} is in the room`);
      this.render();
      return c;
    } catch (e) {
      job.error = e.message || String(e); job.status = 'Failed';
      onStatus && onStatus('Failed: ' + job.error);
      this.render();
      throw e;
    }
  }

  show() { this.root.hidden = false; this.render(); this.animate(); }
  hide() { this.root.hidden = true; if (this.timer) { cancelAnimationFrame(this.timer); this.timer = null; } }

  animate() {
    if (this.root.hidden) return;
    const f = Math.floor(performance.now() / 400) % 8;
    for (const p of this.previews) p.draw(f);
    this.timer = requestAnimationFrame(() => this.animate());
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
    root.appendChild(el('div', { class: 'hint', style: 'padding:8px 16px 0', text: 'Anyone on the phone can pixelate themselves (F4 Me). Characters that are on — and, when an effect set is active, in that set — appear in the Pixel people effect: they fall in, walk your shapes, dance to the beat. Photos go to OpenAI’s image model as a sprite sheet request; nothing else leaves the room.' }));
    if (this.jobs.length) {
      root.appendChild(el('div', { class: 'libBatch' }, this.jobs.map((j) => el('span', { class: 'statChip' + (j.error ? ' bad' : ' busy on'), text: `${j.name}: ${j.status}${j.error ? ' — ' + j.error : ''}`,
        onclick: () => { if (j.error) { this.jobs = this.jobs.filter((x) => x !== j); this.render(); } } }))));
    }
    const grid = el('div', { class: 'libGrid people' });
    if (!this.list.length) grid.appendChild(el('div', { class: 'libEmpty hint', text: 'Nobody yet. Add a photo here, or open the phone page and press F4 Me.' }));
    for (const c of this.list) {
      const cv = el('canvas', { width: 192, height: 256, class: 'peoplePrev' });
      const img = new Image(); img.crossOrigin = 'anonymous'; img.src = c.url;
      const cols = c.cols || 4, rows = c.rows || 2, cw = 1536 / cols;
      const draw = (frame) => {
        const x = cv.getContext('2d'); x.imageSmoothingEnabled = false;
        x.clearRect(0, 0, cv.width, cv.height);
        if (!img.complete || !img.naturalWidth) return;
        // idle frames, and the dance frames when the sheet has them
        const f = rows >= 4 ? (Math.floor(performance.now() / 3000) % 2 ? 8 + (frame % 8) : frame % 2) : frame % 2;
        const dw = 192 * (cw / 384);
        x.drawImage(img, (f % cols) * cw, Math.floor(f / cols) * 512, cw, 512, (192 - dw) / 2, 0, dw, 256);
      };
      img.onload = () => draw(0);
      this.previews.push({ draw });
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
      const card = el('div', { class: 'libCard peopleCard' + (c.enabled && inActive ? '' : ' off') }, [
        el('div', { class: 'peopleThumb' }, [cv]),
        el('div', { class: 'libInfo' }, [
          name,
          el('div', { class: 'hint', text: `${c.from === 'phone' ? 'From a phone' : 'From a photo'} · ${new Date(c.created).toLocaleDateString()}${(c.rows || 2) >= 4 ? ' · dances' : ' · no dance sheet'}${!inActive ? ' · not in the active set' : ''}` }),
          setRow,
        ]),
        el('div', { class: 'libActions' }, [
          on,
          el('span', { class: 'grow' }),
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
