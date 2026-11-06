// The widgets every panel of the control window is built from: the element
// helper, collapsible sections with a "?" that explains them on hover,
// sliders, switches, selects and text rows that read a value, write it back
// and refresh on every commit. Bound once per window with widgets(); the
// panels get the bound set through their ui context, so none of them knows
// how a change is pushed.

export const $ = (s) => document.querySelector(s);

export const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c) n.appendChild(c);
  return n;
};

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;
export const pc = (v) => Math.round(v * 100) + '%';
export const fmtTime = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  const h = Math.floor(m / 60);
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
           : `${m}:${String(sec).padStart(2, '0')}`;
};

/** A small "?" that explains something on hover; the explanation stays out of the way until asked for. */
export const help = (text) => el('span', { class: 'help', title: text, text: '?', 'aria-label': text });

/** One short line of status or guidance under a control. */
export const note = (text, cls = '') => el('div', { class: 'hint' + (cls ? ' ' + cls : ''), text });

/** A sub-heading inside a section body, with an optional explanation on hover. */
export const head = (text, tip) => el('div', { class: 'fxhead', text, title: tip || null });

/**
 * The widget set for one window. `push(commit)` sends the project after an
 * edit (a commit also refreshes every panel); `updaters.push(fn)` registers a
 * refresher that runs on every commit; `openSections` remembers which
 * sections are unfolded, by title.
 */
export function widgets({ push, updaters, openSections }) {
  const ctl = (kids, cls, tip) => el('div', { class: 'ctl' + (cls ? ' ' + cls : ''), title: tip || null }, kids);

  function section(title, kids, opts = {}) {
    const open = openSections.has(title);
    const body = el('div', { class: 'body' }, kids);
    const chev = el('span', { class: 'chev', text: open ? '▾' : '▸' });
    const h = el('h3', {}, [chev, el('span', { class: 'ttl', text: title }), opts.help ? help(opts.help) : null]);
    const s = el('div', { class: 'sec' + (open ? '' : ' closed') }, [h, body]);
    h.onclick = (e) => {
      if (e.target.classList.contains('help')) return;
      const closed = s.classList.toggle('closed');
      closed ? openSections.delete(title) : openSections.add(title);
      chev.textContent = closed ? '▸' : '▾';
    };
    return s;
  }

  function slider(label, get, set, { min = 0, max = 1, step = 0.01, fmt, push: live = true, tip } = {}) {
    const inp = el('input', { type: 'range', min, max, step });
    const val = el('span', { class: 'val' });
    const show = () => {
      inp.value = get();
      val.textContent = fmt ? fmt(get()) : Number(get()).toFixed(step < 0.1 ? 2 : 0);
    };
    // settings sliders (push: false) apply on release, so a drag is one write
    inp.oninput = () => { if (live) { set(Number(inp.value)); show(); push(); } else { val.textContent = fmt ? fmt(Number(inp.value)) : inp.value; } };
    if (!live) inp.onchange = () => { set(Number(inp.value)); };
    updaters.push(show); show();
    return ctl([el('label', { text: label }), inp, val], '', tip);
  }

  function numberRow(label, get, set, { step = 0.001, min, max, tip } = {}) {
    const inp = el('input', { type: 'number', step, min, max });
    const show = () => { if (document.activeElement !== inp) inp.value = round(get(), 4); };
    inp.onchange = () => { set(Number(inp.value)); push(true); };
    updaters.push(show); show();
    return ctl([el('label', { text: label }), inp], 'wide', tip);
  }

  // A boolean is a switch. `opts.push === false` for settings that live outside
  // the project (outputs, app settings) and are pushed by their own setter.
  function toggle(label, get, set, opts = {}) {
    const inp = el('input', { type: 'checkbox' });
    const lab = el('label', { class: 'tog' + (opts.danger ? ' danger' : '') + (opts.grow ? ' grow' : ''), title: opts.tip || opts.title || null },
      [inp, el('span', { class: 'sw' }), el('span', { class: 'tl', text: label })]);
    const show = () => { inp.checked = !!get(); };
    inp.onchange = () => { set(inp.checked); if (opts.push !== false) push(true); show(); };
    updaters.push(show); show();
    return lab;
  }

  function textRow(label, get, set, { tip } = {}) {
    const inp = el('input', { type: 'text' });
    const show = () => { if (document.activeElement !== inp) inp.value = get() || ''; };
    inp.oninput = () => { set(inp.value); push(); };
    updaters.push(show); show();
    return ctl([el('label', { text: label }), inp], 'wide', tip);
  }

  function colorRow(label, get, set, { tip } = {}) {
    const inp = el('input', { type: 'color' });
    const show = () => { if (document.activeElement !== inp) inp.value = get() || '#ffffff'; };
    inp.oninput = () => { set(inp.value); push(); };
    updaters.push(show); show();
    return ctl([el('label', { text: label }), inp], 'wide', tip);
  }

  function selectRow(label, options, get, set, { tip } = {}) {
    const sel = el('select', {});
    for (const [v, t] of options) sel.appendChild(el('option', { value: v, text: t }));
    const show = () => { sel.value = String(get()); };
    sel.onchange = () => { set(sel.value); };
    updaters.push(show); show();
    return ctl([el('label', { text: label }), sel], 'wide', tip);
  }

  return { el, section, slider, numberRow, toggle, textRow, colorRow, selectRow, help, note, head };
}
