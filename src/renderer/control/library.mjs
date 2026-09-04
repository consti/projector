// The Library manager: a full-window overlay in the control app for adding,
// organising, previewing and editing downloaded music videos. Everything the
// user changes here (artist/title, tags, trim, letterbox crop, SponsorBlock)
// is non-destructive metadata stored in the main-process library; playback and
// export read it back.

const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};
const fmtTime = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), h = Math.floor(m / 60);
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
const qualityLabel = (h) => (!h ? '' : h >= 2160 ? '4K' : h >= 1440 ? '1440p' : h >= 1080 ? '1080p' : h >= 720 ? '720p' : h + 'p');
const fmtSize = (b) => (!b ? '' : b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB');

export class LibraryView {
  constructor(root, hooks) {
    this.root = root;                 // #libraryView
    this.hooks = hooks;               // { toast }
    this.items = [];
    this.sel = new Set();
    this.filter = '';
    this.tagFilter = null;
    this.editing = null;
    this.open = false;
    this._build();
  }

  // ------------------------------------------------------------- scaffolding
  _build() {
    const r = this.root;
    r.innerHTML = '';
    this.addInput = el('input', { type: 'text', id: 'libAdd', placeholder: 'Paste YouTube video / playlist / channel URLs (one per line)…' });
    this.addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) this._add(); });
    this.search = el('input', { type: 'search', class: 'libSearch', placeholder: 'Search' });
    this.search.addEventListener('input', () => { this.filter = this.search.value.toLowerCase(); this._renderGrid(); });

    this.countEl = el('span', { class: 'libCount hint' });
    this.discoverBtn = el('button', { class: 'btn', text: 'Auto-discover: off', onclick: () => this.hooks.toggleDiscover() });

    const bar = el('div', { class: 'libBar' }, [
      el('div', { class: 'libTitle' }, ['Library', this.countEl]),
      el('span', { class: 'grow' }),
      this.search,
      el('button', { class: 'btn', text: 'Import', onclick: () => this._import() }),
      el('button', { class: 'btn', text: 'Export', onclick: () => api.libraryExport().then((p) => p && this.hooks.toast('Exported ' + p)) }),
      el('button', { class: 'btn', text: 'Close', onclick: () => this.hide() }),
    ]);

    const addRow = el('div', { class: 'libAddRow' }, [
      this.addInput,
      el('button', { class: 'btn on', text: 'Add', onclick: () => this._add() }),
    ]);

    this.tagsRow = el('div', { class: 'libTags' });
    this.batchBar = el('div', { class: 'libBatch', hidden: true });
    this.grid = el('div', { class: 'libGrid' });

    r.append(bar, addRow, this.tagsRow, this.batchBar, this.grid);
    this.editorRoot = el('div', { class: 'libEditor', hidden: true });
    r.append(this.editorRoot);
  }

  show() { this.open = true; this.root.hidden = false; this.search.focus(); this._renderGrid(); }
  hide() { this.open = false; this.root.hidden = true; this._closeEditor(); }
  toggle() { this.open ? this.hide() : this.show(); }

  // --------------------------------------------------------------- data in
  setItems(items) {
    this.items = items || [];
    // drop selections/edit target that no longer exist
    const ids = new Set(this.items.map((i) => i.id));
    for (const id of [...this.sel]) if (!ids.has(id)) this.sel.delete(id);
    if (this.open) this._renderGrid();
    if (this.editing) {
      const cur = this.items.find((i) => i.id === this.editing.id);
      if (cur) { this.editing = { ...cur, trim: cur.trim, crop: cur.crop }; }
    }
  }
  setProgress(id, pct) {
    const card = this.grid.querySelector(`[data-id="${cssEsc(id)}"] .libProg span`);
    if (card) card.style.width = Math.round(pct * 100) + '%';
    const it = this.items.find((i) => i.id === id);
    if (it) it.progress = pct;
  }
  setDiscover(on) { this.discoverBtn.textContent = 'Auto-discover: ' + (on ? 'on' : 'off'); this.discoverBtn.classList.toggle('on', !!on); }

  // ---------------------------------------------------------------- actions
  async _add() {
    const urls = this.addInput.value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (!urls.length) return;
    this.addInput.value = '';
    this.hooks.toast('Reading ' + urls.length + ' link' + (urls.length === 1 ? '' : 's') + '…');
    const n = await api.libraryAdd(urls, {});
    this.hooks.toast(n ? 'Queued ' + n + ' video' + (n === 1 ? '' : 's') : 'Nothing new to add');
  }
  async _import() {
    const n = await api.libraryImport();
    if (n) this.hooks.toast('Importing ' + n + ' video' + (n === 1 ? '' : 's') + '…');
  }

  _filtered() {
    let list = this.items;
    if (this.tagFilter) list = list.filter((i) => (i.tags || []).includes(this.tagFilter));
    if (this.filter) {
      const q = this.filter;
      list = list.filter((i) => (i.artist + ' ' + i.title + ' ' + (i.tags || []).join(' ') + ' ' + i.rawTitle).toLowerCase().includes(q));
    }
    return list;
  }

  _renderGrid() {
    if (!this.open) return;
    const list = this._filtered();
    this.countEl.textContent = this.items.length ? `${list.length}${list.length !== this.items.length ? ' / ' + this.items.length : ''}` : '';
    // tag chips
    const tags = [...new Set(this.items.flatMap((i) => i.tags || []))].sort();
    this.tagsRow.innerHTML = '';
    if (tags.length) {
      this.tagsRow.append(el('button', { class: 'tagChip' + (this.tagFilter ? '' : ' on'), text: 'All', onclick: () => { this.tagFilter = null; this._renderGrid(); } }));
      for (const t of tags) this.tagsRow.append(el('button', { class: 'tagChip' + (this.tagFilter === t ? ' on' : ''), text: t, onclick: () => { this.tagFilter = this.tagFilter === t ? null : t; this._renderGrid(); } }));
    }
    this._renderBatch();

    this.grid.innerHTML = '';
    if (!list.length) {
      this.grid.append(el('div', { class: 'libEmpty hint', text: this.items.length ? 'No matches.' : 'Your library is empty. Paste a YouTube link above to download a music video.' }));
      return;
    }
    for (const it of list) this.grid.append(this._card(it));
  }

  _renderBatch() {
    const n = this.sel.size;
    this.batchBar.hidden = !n;
    if (!n) return;
    this.batchBar.innerHTML = '';
    this.batchBar.append(
      el('span', { class: 'hint', text: n + ' selected' }),
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', text: 'Play', onclick: () => { this.hooks.play([...this.sel], { play: true, replace: true }); } }),
      el('button', { class: 'btn', text: 'Queue', onclick: () => { this.hooks.play([...this.sel], { play: false }); this.hooks.toast('Queued ' + n); } }),
      el('button', { class: 'btn', text: 'Detect letterbox', onclick: () => this._detectCrop([...this.sel]) }),
      el('button', { class: 'btn', text: 'Remove crop', onclick: () => api.libraryClearCrop([...this.sel]) }),
      el('button', { class: 'btn', text: 'Tag…', onclick: () => this._tagMany([...this.sel]) }),
      el('button', { class: 'btn danger', text: 'Delete', onclick: () => this._deleteMany([...this.sel]) }),
      el('button', { class: 'btn', text: 'Clear', onclick: () => { this.sel.clear(); this._renderGrid(); } }),
    );
  }

  async _detectCrop(ids) {
    const ready = ids.filter((id) => (this.items.find((i) => i.id === id) || {}).status === 'ready');
    if (!ready.length) return this.hooks.toast('Only downloaded videos can be analysed');
    this.hooks.toast('Detecting letterbox on ' + ready.length + '…');
    const n = await api.libraryDetectCrop(ready);
    this.hooks.toast(n ? 'Cropped ' + n + ' video' + (n === 1 ? '' : 's') : 'No letterbox found');
  }
  _tagMany(ids) {
    const tag = prompt('Add tag to ' + ids.length + ' video(s):');
    if (!tag) return;
    for (const id of ids) {
      const it = this.items.find((i) => i.id === id);
      const tags = new Set(it.tags || []); tags.add(tag.trim());
      api.libraryUpdate(id, { tags: [...tags] });
    }
  }
  _deleteMany(ids) {
    if (!confirm('Delete ' + ids.length + ' video(s) from the library and disk?')) return;
    for (const id of ids) api.libraryRemove(id);
    this.sel.clear();
  }

  // ------------------------------------------------------------------- card
  _card(it) {
    const selected = this.sel.has(it.id);
    const check = el('button', { class: 'libCheck' + (selected ? ' on' : ''), text: selected ? '✓' : '',
      onclick: (e) => { e.stopPropagation(); selected ? this.sel.delete(it.id) : this.sel.add(it.id); this._renderGrid(); } });

    const thumb = el('div', { class: 'libThumb' });
    if (it.thumbUrl) thumb.append(el('img', { src: it.thumbUrl, loading: 'lazy' }));
    else if (it.thumbnail) thumb.append(el('img', { src: it.thumbnail, loading: 'lazy' }));
    if (it.crop) thumb.append(el('span', { class: 'libCropBadge', title: 'Letterbox cropped', text: '⛶' }));

    // hover / long-press storyboard scrub
    if (it.storyUrl && it.story) this._attachScrub(thumb, it);

    // status / progress
    if (it.status !== 'ready') {
      const ov = el('div', { class: 'libStatus' });
      if (it.status === 'downloading') {
        ov.append(el('div', { class: 'libProg' }, [el('span', { style: `width:${Math.round((it.progress || 0) * 100)}%` })]),
          el('div', { class: 'libStatusT', text: 'Downloading ' + Math.round((it.progress || 0) * 100) + '%' }));
      } else if (it.status === 'processing') ov.append(el('div', { class: 'libStatusT', text: 'Processing…' }));
      else if (it.status === 'queued') ov.append(el('div', { class: 'libStatusT', text: 'Queued' }));
      else if (it.status === 'error') ov.append(el('div', { class: 'libStatusT err', text: 'Error' }),
        el('button', { class: 'btn sm', text: 'Retry', onclick: (e) => { e.stopPropagation(); api.libraryRetry(it.id); } }));
      thumb.append(ov);
    } else {
      const play = el('button', { class: 'libPlay', text: '▶', title: 'Play now',
        onclick: (e) => { e.stopPropagation(); this.hooks.play([it.id], { play: true }); } });
      thumb.append(play);
    }
    if (it.duration) thumb.append(el('span', { class: 'libDur', text: fmtTime((it.trim && it.trim.end ? it.trim.end : it.duration) - (it.trim && it.trim.start ? it.trim.start : 0)) }));

    const badges = el('div', { class: 'libMeta' });
    if (it.height) badges.append(el('span', { class: 'badge', text: qualityLabel(it.height) }));
    badges.append(el('span', { class: 'badge lib', text: 'library' }));
    if (it.trim) badges.append(el('span', { class: 'badge', text: 'trimmed' }));
    if (it.sponsorSkips && it.sponsorSkips.length) badges.append(el('span', { class: 'badge', title: 'SponsorBlock', text: 'SB' }));

    const tagline = el('div', { class: 'libTagline' }, (it.tags || []).map((t) => el('span', { class: 'miniTag', text: t })));

    const card = el('div', { class: 'libCard' + (selected ? ' sel' : ''), 'data-id': it.id }, [
      check, thumb,
      el('div', { class: 'libInfo' }, [
        el('div', { class: 'libArtist', text: it.artist || (it.uploader || ''), title: it.artist || '' }),
        el('div', { class: 'libSong', text: it.title, title: it.title }),
        badges,
        tagline,
      ]),
      el('div', { class: 'libActions' }, [
        it.status === 'ready' ? el('button', { class: 'btn sm', text: 'Queue', onclick: () => { this.hooks.play([it.id], { play: false }); this.hooks.toast('Queued'); } }) : null,
        it.status === 'ready' ? el('button', { class: 'btn sm', text: 'Edit', onclick: () => this._openEditor(it) }) : null,
        el('button', { class: 'btn sm', text: '⋯', onclick: (e) => this._menu(e, it) }),
      ]),
    ]);
    return card;
  }

  _attachScrub(thumb, it) {
    const s = it.story;
    const board = el('div', { class: 'libScrub' });
    board.style.backgroundImage = `url("${it.storyUrl}")`;
    board.style.backgroundSize = `${s.cols * 100}% ${s.rows * 100}%`;
    thumb.append(board);
    const to = (frac) => {
      const k = Math.max(0, Math.min(s.count - 1, Math.floor(frac * s.count)));
      const col = k % s.cols, row = Math.floor(k / s.cols);
      board.style.backgroundPosition = `${(col / (s.cols - 1)) * 100}% ${(row / (s.rows - 1)) * 100}%`;
      board.classList.add('on');
    };
    const off = () => board.classList.remove('on');
    thumb.addEventListener('mousemove', (e) => { const r = thumb.getBoundingClientRect(); to((e.clientX - r.left) / r.width); });
    thumb.addEventListener('mouseleave', off);
    // long-press to enter scrub on touch
    let lp = null, scrubbing = false;
    thumb.addEventListener('touchstart', (e) => { lp = setTimeout(() => { scrubbing = true; const r = thumb.getBoundingClientRect(); to((e.touches[0].clientX - r.left) / r.width); }, 320); }, { passive: true });
    thumb.addEventListener('touchmove', (e) => { if (scrubbing) { const r = thumb.getBoundingClientRect(); to((e.touches[0].clientX - r.left) / r.width); e.preventDefault(); } }, { passive: false });
    thumb.addEventListener('touchend', () => { clearTimeout(lp); scrubbing = false; off(); });
  }

  _menu(e, it) {
    e.stopPropagation();
    const old = document.querySelector('.libMenu'); if (old) old.remove();
    const m = el('div', { class: 'libMenu' }, [
      it.status === 'ready' ? el('button', { text: 'Play now', onclick: () => this.hooks.play([it.id], { play: true }) }) : null,
      it.status === 'ready' ? el('button', { text: 'Edit…', onclick: () => this._openEditor(it) }) : null,
      el('button', { text: 'Reveal file', onclick: () => api.libraryReveal(it.id) }),
      it.status === 'error' ? el('button', { text: 'Retry download', onclick: () => api.libraryRetry(it.id) }) : null,
      el('button', { class: 'danger', text: 'Delete', onclick: () => { if (confirm('Delete "' + it.title + '"?')) api.libraryRemove(it.id); } }),
    ]);
    const r = e.target.getBoundingClientRect();
    m.style.left = Math.min(r.left, window.innerWidth - 190) + 'px';
    m.style.top = r.bottom + 4 + 'px';
    document.body.append(m);
    const close = (ev) => { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('mousedown', close); } };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
    m.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => m.remove()));
  }

  // ----------------------------------------------------------------- editor
  _openEditor(it) { this.editing = { ...it }; this._renderEditor(); }
  _closeEditor() { this.editing = null; this.editorRoot.hidden = true; this.editorRoot.innerHTML = ''; }

  _renderEditor() {
    const it = this.editing;
    const root = this.editorRoot;
    root.hidden = false;
    root.innerHTML = '';

    const video = el('video', { src: it.mediaUrl, controls: false, playsinline: true, muted: true });
    video.crossOrigin = 'anonymous';
    const cropLayer = el('div', { class: 'cropLayer' });
    const stage = el('div', { class: 'edStage' }, [video, cropLayer]);

    // crop rectangle state (normalized)
    let crop = it.crop ? { ...it.crop } : null;
    const drawCrop = () => {
      cropLayer.innerHTML = '';
      if (!crop) { cropLayer.classList.remove('on'); return; }
      cropLayer.classList.add('on');
      const box = el('div', { class: 'cropBox' });
      box.style.left = crop.x * 100 + '%'; box.style.top = crop.y * 100 + '%';
      box.style.width = crop.w * 100 + '%'; box.style.height = crop.h * 100 + '%';
      for (const pos of ['nw', 'ne', 'sw', 'se']) box.append(el('span', { class: 'ch ' + pos, 'data-h': pos }));
      cropLayer.append(box);
      this._cropDrag(box, cropLayer, crop, (c) => { crop = c; });
    };

    // trim state
    let inT = (it.trim && it.trim.start) || 0;
    let outT = (it.trim && it.trim.end) || it.duration || 0;
    const trimLabel = el('span', { class: 'hint' });
    const updTrim = () => { trimLabel.textContent = `In ${fmtTime(inT)} · Out ${fmtTime(outT)} · ${fmtTime(Math.max(0, outT - inT))} long`; };

    const artist = el('input', { type: 'text', value: it.artist || '', placeholder: 'Artist' });
    const title = el('input', { type: 'text', value: it.title || '', placeholder: 'Song title' });
    const sponsor = el('input', { type: 'checkbox' }); sponsor.checked = it.sponsor !== false;

    // tags
    const tagWrap = el('div', { class: 'edTags' });
    let tags = [...(it.tags || [])];
    const drawTags = () => {
      tagWrap.innerHTML = '';
      for (const t of tags) tagWrap.append(el('span', { class: 'edTag' }, [t, el('b', { text: '✕', onclick: () => { tags = tags.filter((x) => x !== t); drawTags(); } })]));
      const add = el('input', { type: 'text', class: 'edTagAdd', placeholder: '+ tag' });
      add.addEventListener('keydown', (e) => { if (e.key === 'Enter' && add.value.trim()) { tags.push(add.value.trim()); drawTags(); } });
      tagWrap.append(add);
    };
    drawTags();

    const scrub = el('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'edScrub' });
    scrub.addEventListener('input', () => { if (video.duration) video.currentTime = (scrub.value / 1000) * video.duration; });
    video.addEventListener('timeupdate', () => { if (video.duration && document.activeElement !== scrub) scrub.value = Math.round((video.currentTime / video.duration) * 1000); });
    video.addEventListener('loadedmetadata', () => { if (!outT) outT = video.duration; updTrim(); });

    const controls = el('div', { class: 'edCtl' }, [
      el('button', { class: 'btn', text: '⏯', onclick: () => (video.paused ? video.play() : video.pause()) }),
      scrub,
    ]);

    const cropToggle = el('button', { class: 'btn' + (crop ? ' on' : ''), text: 'Crop', onclick: () => {
      crop = crop ? null : { x: 0.06, y: 0.12, w: 0.88, h: 0.76 }; drawCrop(); cropToggle.classList.toggle('on', !!crop);
    } });

    const panel = el('div', { class: 'edPanel' }, [
      el('div', { class: 'edHead' }, [el('b', { text: 'Edit video' }), el('span', { class: 'grow' }),
        el('button', { class: 'btn', text: 'Cancel', onclick: () => this._closeEditor() }),
        el('button', { class: 'btn on', text: 'Save', onclick: async () => {
          await api.libraryUpdate(it.id, {
            artist: artist.value.trim(), title: title.value.trim(), tags,
            trim: (inT > 0.05 || (outT && it.duration && outT < it.duration - 0.05)) ? { start: inT, end: outT } : null,
            crop: crop ? { x: +crop.x.toFixed(4), y: +crop.y.toFixed(4), w: +crop.w.toFixed(4), h: +crop.h.toFixed(4) } : null,
            sponsor: sponsor.checked,
          });
          this.hooks.toast('Saved');
          this._closeEditor();
        } }),
      ]),
      el('label', { class: 'edField' }, ['Artist', artist]),
      el('label', { class: 'edField' }, ['Title', title]),
      el('div', { class: 'edField' }, ['Tags', tagWrap]),

      el('div', { class: 'edSub', text: 'Letterbox / crop' }),
      el('div', { class: 'row' }, [
        cropToggle,
        el('button', { class: 'btn', text: 'Auto-detect', onclick: async () => {
          this.hooks.toast('Detecting…');
          const c = await api.libraryDetectCrop([it.id]);
          const fresh = this.items.find((i) => i.id === it.id);
          crop = fresh && fresh.crop ? { ...fresh.crop } : null; drawCrop(); cropToggle.classList.toggle('on', !!crop);
          this.hooks.toast(crop ? 'Letterbox found' : 'No letterbox');
        } }),
        el('button', { class: 'btn', text: 'Reset', onclick: () => { crop = null; drawCrop(); cropToggle.classList.remove('on'); } }),
      ]),

      el('div', { class: 'edSub', text: 'Trim' }),
      trimLabel,
      el('div', { class: 'row' }, [
        el('button', { class: 'btn', text: 'Set in', onclick: () => { inT = video.currentTime; updTrim(); } }),
        el('button', { class: 'btn', text: 'Set out', onclick: () => { outT = video.currentTime; updTrim(); } }),
        el('button', { class: 'btn', text: 'Reset', onclick: () => { inT = 0; outT = it.duration || video.duration; updTrim(); } }),
      ]),

      el('label', { class: 'edField row', style: 'align-items:center' }, [sponsor, el('span', { text: 'Skip sponsor / non-music segments (SponsorBlock)' })]),
    ]);

    root.append(el('div', { class: 'edBack', onclick: (e) => { if (e.target.classList.contains('edBack')) this._closeEditor(); } }, [
      el('div', { class: 'edModal' }, [
        el('div', { class: 'edLeft' }, [stage, controls]),
        panel,
      ]),
    ]));
    drawCrop(); updTrim();
    video.play().catch(() => {});
  }

  // drag/resize the crop box within its layer
  _cropDrag(box, layer, crop, onChange) {
    const rectOf = () => layer.getBoundingClientRect();
    const start = (e, handle) => {
      e.preventDefault(); e.stopPropagation();
      const r = rectOf();
      const sx = e.clientX, sy = e.clientY;
      const s = { ...crop };
      const move = (ev) => {
        const dx = (ev.clientX - sx) / r.width, dy = (ev.clientY - sy) / r.height;
        let { x, y, w, h } = s;
        if (!handle) { x = clamp(s.x + dx, 0, 1 - s.w); y = clamp(s.y + dy, 0, 1 - s.h); }
        else {
          if (handle.includes('w')) { x = clamp(s.x + dx, 0, s.x + s.w - 0.05); w = s.w + (s.x - x); }
          if (handle.includes('e')) { w = clamp(s.w + dx, 0.05, 1 - s.x); }
          if (handle.includes('n')) { y = clamp(s.y + dy, 0, s.y + s.h - 0.05); h = s.h + (s.y - y); }
          if (handle.includes('s')) { h = clamp(s.h + dy, 0.05, 1 - s.y); }
        }
        crop = { x, y, w, h }; onChange(crop);
        box.style.left = x * 100 + '%'; box.style.top = y * 100 + '%'; box.style.width = w * 100 + '%'; box.style.height = h * 100 + '%';
      };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    };
    box.addEventListener('mousedown', (e) => { if (!e.target.classList.contains('ch')) start(e, null); });
    box.querySelectorAll('.ch').forEach((h) => h.addEventListener('mousedown', (e) => start(e, h.dataset.h)));
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cssEsc = (s) => String(s).replace(/["\\]/g, '\\$&');
