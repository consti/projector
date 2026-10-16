// Apple Music, browsed from the Music app's library: its playlists down the
// side, their songs in the middle, and buttons that put a song (or all of
// them) into the transport playlist. The Music app plays them; Projector shows
// visuals to them and follows the clock (see src/main/music.js).

// kids may be nodes or strings
const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};

export class MusicView {
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks;             // { toast, fmtTime }
    this.playlists = [];            // [{ id, name, count, smart }]
    this.songs = 0;                 // size of the whole library
    this.sel = null;                // playlist id, or null for all songs
    this.cache = new Map();         // playlist id ('' = all) -> tracks
    this.tracks = [];
    this.filter = '';
    this.loaded = false;
    this.loading = null;
    this.open = false;
    this.status = null;
    this.tap = { live: false, error: null };
    this._build();
  }

  _build() {
    const r = this.root;
    r.innerHTML = '';
    this.countEl = el('span', { class: 'libCount hint' });
    this.search = el('input', { type: 'search', class: 'libSearch', placeholder: 'Search song, artist, album' });
    this.search.addEventListener('input', () => { this.filter = this.search.value.trim().toLowerCase(); this._renderList(); });
    this.search.addEventListener('keydown', (e) => e.stopPropagation());
    this.stateEl = el('span', { class: 'hint musicState' });
    r.appendChild(el('div', { class: 'libBar' }, [
      el('div', { class: 'libTitle' }, ['Apple Music', this.countEl]),
      this.search,
      this.stateEl,
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', text: 'Refresh', title: 'Read the Music library again', onclick: () => this.refresh(true) }),
    ]));
    this.side = el('div', { class: 'musicSide' });
    this.head = el('div', { class: 'musicHead' });
    this.list = el('div', { class: 'musicList' });
    this.main = el('div', { class: 'musicMain' }, [this.head, this.list]);
    r.appendChild(el('div', { class: 'musicBody' }, [this.side, this.main]));
  }

  show() { this.open = true; this.root.hidden = false; if (!this.loaded) this.refresh(); this.search.focus(); }
  hide() { this.open = false; this.root.hidden = true; }

  tapState(st) { this.tap = st || this.tap; this._renderState(); }

  _renderState() {
    const s = this.status;
    let txt = '';
    if (s && !s.available) txt = 'Music is not reachable: ' + (s.error || 'unknown');
    else if (this.tap.error) txt = 'Not hearing Music: ' + this.tap.error;
    else if (this.tap.live) txt = 'Listening to the Music app';
    this.stateEl.textContent = txt;
    this.stateEl.classList.toggle('bad', !!(s && !s.available) || !!this.tap.error);
  }

  async refresh(force) {
    const { toast } = this.hooks;
    if (force) { this.cache.clear(); await api.musicForget(); }
    this.head.textContent = 'Reading the Music library…';
    this.list.innerHTML = '';
    try {
      this.status = await api.musicStatus();
      this._renderState();
      if (!this.status.available) {
        this.head.textContent = '';
        this.list.appendChild(el('div', { class: 'libEmpty hint', text: 'Projector could not talk to the Music app. ' + (this.status.error || '') +
          ' If macOS asked whether Projector may control Music, allow it in System Settings → Privacy & Security → Automation.' }));
        return;
      }
      const r = await api.musicPlaylists();
      this.playlists = r.playlists || [];
      this.songs = r.songs || 0;
      this.loaded = true;
      this.countEl.textContent = this.songs ? `${this.songs} songs · ${this.playlists.length} playlists` : '';
      this._renderSide();
      await this.select(this.sel, true);
    } catch (e) {
      this.head.textContent = '';
      this.list.appendChild(el('div', { class: 'libEmpty hint', text: 'Could not read the Music library: ' + e.message }));
      toast('Apple Music: ' + e.message, 6000);
    }
  }

  _renderSide() {
    this.side.innerHTML = '';
    const row = (id, name, count, smart) => {
      const r = el('div', { class: 'musicPl' + ((id || null) === this.sel ? ' on' : ''), onclick: () => this.select(id) }, [
        el('span', { class: 't', text: name }),
        el('span', { class: 'c', text: count ? String(count) : '' }),
      ]);
      if (smart) r.title = 'Smart playlist';
      return r;
    };
    this.side.appendChild(el('div', { class: 'hint musicSideHead', text: 'Library' }));
    this.side.appendChild(row(null, 'All songs', this.songs));
    this.side.appendChild(el('div', { class: 'hint musicSideHead', text: 'Playlists' }));
    for (const p of this.playlists) this.side.appendChild(row(p.id, p.name, p.count, p.smart));
    if (!this.playlists.length) this.side.appendChild(el('div', { class: 'hint', style: 'padding:8px 12px', text: 'No playlists in Music.' }));
  }

  async select(id, keep) {
    this.sel = id || null;
    this._renderSide();
    const key = this.sel || '';
    if (!keep) { this.filter = ''; this.search.value = ''; }
    const pl = this.playlists.find((p) => p.id === this.sel);
    if (this.cache.has(key)) { this.tracks = this.cache.get(key); this._renderList(); return; }
    this.tracks = [];
    this.head.textContent = `Reading ${pl ? pl.name : 'all songs'}…`;
    this.list.innerHTML = '';
    const token = (this.loading = {});
    try {
      const t = await api.musicTracks(this.sel);
      if (this.loading !== token) return;
      this.cache.set(key, t);
      this.tracks = t;
      this._renderList();
    } catch (e) {
      if (this.loading !== token) return;
      this.head.textContent = '';
      this.list.appendChild(el('div', { class: 'libEmpty hint', text: 'Could not read it: ' + e.message }));
    }
  }

  _shown() {
    const f = this.filter;
    if (!f) return this.tracks;
    const words = f.split(/\s+/).filter(Boolean);
    return this.tracks.filter((t) => {
      const hay = (t.title + ' ' + t.artist + ' ' + t.album).toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }

  _renderList() {
    const { fmtTime, toast } = this.hooks;
    const pl = this.playlists.find((p) => p.id === this.sel);
    const shown = this._shown();
    const CAP = 500;
    this.head.innerHTML = '';
    this.head.appendChild(el('div', { class: 'musicHeadTitle' }, [
      el('span', { class: 'name', text: pl ? pl.name : 'All songs' }),
      el('span', { class: 'hint', text: shown.length === this.tracks.length ? `${this.tracks.length} songs` : `${shown.length} of ${this.tracks.length} songs` }),
    ]));
    this.head.appendChild(el('span', { class: 'grow' }));
    const addAll = async (playNow) => {
      if (!shown.length) return;
      const r = await api.musicAdd(shown, { playNow, name: pl ? pl.name : null });
      toast((playNow ? 'Playing ' : 'Added ') + r.count + ' song' + (r.count === 1 ? '' : 's') + (pl ? ' from "' + pl.name + '"' : ''));
    };
    this.head.appendChild(el('button', { class: 'btn', text: this.filter ? 'Add these' : 'Add all', title: 'Add every song listed to the playlist', onclick: () => addAll(false) }));
    this.head.appendChild(el('button', { class: 'btn on', text: this.filter ? 'Play these' : 'Play all', title: 'Add them and start with the first', onclick: () => addAll(true) }));

    this.list.innerHTML = '';
    if (!shown.length) {
      this.list.appendChild(el('div', { class: 'libEmpty hint', text: this.tracks.length ? 'Nothing matches.' : 'No songs here.' }));
      return;
    }
    const frag = document.createDocumentFragment();
    shown.slice(0, CAP).forEach((t, i) => {
      const add = async (playNow) => {
        const r = await api.musicAdd([t], { playNow });
        toast((playNow ? 'Playing ' : 'Added ') + t.title);
      };
      const row = el('div', { class: 'musicRow', title: t.video ? 'A music video in Apple Music: the Music app will show it; Projector shows visuals' : '' }, [
        el('span', { class: 'n', text: String(i + 1) }),
        el('span', { class: 'tt' }, [el('span', { class: 't', text: t.title }), el('span', { class: 'a', text: t.artist + (t.album ? ' · ' + t.album : '') })]),
        el('span', { class: 'd', text: fmtTime(t.duration) }),
        el('button', { class: 'btn sm', text: '+', title: 'Add to the playlist', onclick: (e) => { e.stopPropagation(); add(false); } }),
        el('button', { class: 'btn sm', text: '▶', title: 'Play now', onclick: (e) => { e.stopPropagation(); add(true); } }),
      ]);
      row.ondblclick = () => add(true);
      frag.appendChild(row);
    });
    if (shown.length > CAP) frag.appendChild(el('div', { class: 'hint', style: 'padding:10px 14px', text: `…and ${shown.length - CAP} more. Search to narrow it down; "Add all" takes every one of them.` }));
    this.list.appendChild(frag);
  }
}
