// The Map view's inspector: the maps, the surfaces and shapes of the one
// being edited, the selected surface or shape (its region of the picture,
// geometry, edge blend and colour; a shape's softness and growth) and the
// presets. Built from the window's panel context, so it owns no state: the
// project and the app state come through getters, every change goes out
// through push().
import * as Mesh from '/shared/mesh.mjs';
import { defaultSurface, defaultMask, defaultMap, defaultContent, uid, ensureMaps, mapIdFor, CONTENT_KINDS } from '/shared/schema.mjs';
import { VISUAL_SCENES } from '/shared/visuals.mjs';
import { el, clamp, pc, note, head } from '/renderer/control/ui.mjs';

export function createMapInspector(ctx) {
  const { stage, player, toast, pushProject, buildInspector, promptModal, outputSize, previewSource, sourceReady,
    duplicateSelected, deleteSelected, updaters, frameUpdaters } = ctx;
  const { section, slider, toggle, textRow, selectRow, numberRow, colorRow } = ctx.W;
  const project = ctx.project, S = ctx.state;

  // which map an output shows; the plain full-screen picture is the other choice
  function mapSelectRow(role) {
    const opts = [['fill', 'Plain picture, full screen'], ...project().maps.map((m) => [m.id, 'Map: ' + m.name])];
    return selectRow('Shows', opts,
      () => mapIdFor(project(), S().outputs, role) || 'fill',
      (v) => api.setOutput(role, { mapId: v }));
  }

  function selectionSection() {
    const o = stage.selected();
    if (!o) return section('Selection', [note('Click a surface or a shape on the stage to edit it.')]);
    const isSurf = stage.sel.type === 'surface';
    const rows = [textRow('Name', () => o.name, (v) => (o.name = v))];
    rows.push(el('div', { class: 'row' }, [
      toggle('Enabled', () => o.enabled, (v) => (o.enabled = v)),
      el('button', { class: 'btn', text: 'Duplicate', onclick: duplicateSelected }),
      el('button', { class: 'btn danger', text: 'Delete', onclick: deleteSelected }),
    ]));

    if (isSurf) {
      const content = o.content || (o.content = defaultContent());
      rows.push(el('div', { class: 'fxhead', text: 'Shows' }));
      rows.push(selectRow('Content', CONTENT_KINDS, () => content.kind || 'video', (v) => { content.kind = v; pushProject(true); buildInspector(); }));
      if (content.kind === 'visuals') {
        rows.push(selectRow('Scene', [['auto', 'Mix (every scene in turn)'], ...VISUAL_SCENES], () => content.scene || 'auto', (v) => { content.scene = v; pushProject(true); },
          { tip: 'This surface runs its own generated scene to the music, whatever the others show. Its speed, colours and tempo follow the Visuals settings.' }));
      } else if (content.kind === 'colour') {
        rows.push(colorRow('Colour', () => content.colour || '#303030', (v) => { content.colour = v; }));
      } else if (content.kind === 'off') {
        rows.push(note('Nothing is drawn here; the surface stays dark but keeps its place.'));
      }
      rows.push(el('div', { class: 'row' }, [
        el('button', { class: 'btn sm grow', text: 'Turn into a shape', title: 'The same outline, but black: a painting or a piece of furniture the projector must not light', onclick: () => surfaceToShape(o) }),
      ]));
      if (content.kind === 'video') {
      rows.push(head('Region of the picture', 'Which part of the video lands on this surface. Drag the box; several surfaces can share one picture by taking neighbouring regions (see Presets).'));
      rows.push(srcMapWidget(o));
      rows.push(el('div', { class: 'quad' }, [
        numberRow('x', () => o.src.x, (v) => (o.src.x = v)),
        numberRow('y', () => o.src.y, (v) => (o.src.y = v)),
        numberRow('w', () => o.src.w, (v) => (o.src.w = v)),
        numberRow('h', () => o.src.h, (v) => (o.src.h = v)),
      ]));
      rows.push(el('div', { class: 'row' }, ['Full', 'Left', 'Right', 'Top', 'Bottom'].map((k) =>
        el('button', {
          class: 'btn sm grow', text: k, onclick: () => {
            const r = { Full: [0, 0, 1, 1], Left: [0, 0, 0.5, 1], Right: [0.5, 0, 0.5, 1], Top: [0, 0, 1, 0.5], Bottom: [0, 0.5, 1, 0.5] }[k];
            o.src = { x: r[0], y: r[1], w: r[2], h: r[3] };
            pushProject(true);
          },
        }))));
      }

      rows.push(head('Geometry', 'The warp grid: raise it for curved or uneven walls, then drag the inner points.'));
      const meshRow = el('div', { class: 'row' }, [
        el('label', { class: 'grow hint', text: `Grid ${o.mesh.cols} x ${o.mesh.rows}`, title: 'Raise the grid for curved or uneven walls' }),
        el('button', { class: 'btn icon', text: '−', onclick: () => setMesh(o, -1) }),
        el('button', { class: 'btn icon', text: '+', onclick: () => setMesh(o, 1) }),
        el('button', { class: 'btn', text: 'Flat', onclick: () => setMesh(o, 0) }),
      ]);
      rows.push(meshRow);
      rows.push(el('div', { class: 'row' }, [
        el('button', { class: 'btn grow', text: 'Fill output', onclick: () => { o.mesh = { cols: 1, rows: 1, pts: [[0, 0], [1, 0], [0, 1], [1, 1]] }; pushProject(true); } }),
        el('button', { class: 'btn grow', text: 'Keep aspect', onclick: () => fitAspect(o) }),
      ]));

      rows.push(head('Edge blend', 'Soften an edge to hide the seam between two walls.'));
      rows.push(slider('Left', () => o.feather.l, (v) => (o.feather.l = v), { max: 0.5, fmt: pc }));
      rows.push(slider('Right', () => o.feather.r, (v) => (o.feather.r = v), { max: 0.5, fmt: pc }));
      rows.push(slider('Top', () => o.feather.t, (v) => (o.feather.t = v), { max: 0.5, fmt: pc }));
      rows.push(slider('Bottom', () => o.feather.b, (v) => (o.feather.b = v), { max: 0.5, fmt: pc }));

      rows.push(el('div', { class: 'row' }, [
        toggle('Flip H', () => o.fx.flipH, (v) => (o.fx.flipH = v)),
        toggle('Flip V', () => o.fx.flipV, (v) => (o.fx.flipV = v)),
        el('button', {
          class: 'btn sm', text: 'Rotate 90', onclick: () => { o.fx.rot = ((o.fx.rot | 0) + 1) % 4; pushProject(true); },
        }),
      ]));
      rows.push(head('Colour', 'Match brightness and colour between walls.'));
      rows.push(slider('Opacity', () => o.fx.opacity, (v) => (o.fx.opacity = v), { max: 1, fmt: pc }));
      rows.push(slider('Brightness', () => o.fx.brightness, (v) => (o.fx.brightness = v), { min: -0.5, max: 0.5 }));
      rows.push(slider('Contrast', () => o.fx.contrast, (v) => (o.fx.contrast = v), { min: 0.2, max: 2.5 }));
      rows.push(slider('Saturation', () => o.fx.saturation, (v) => (o.fx.saturation = v), { min: 0, max: 3 }));
      rows.push(slider('Gamma', () => o.fx.gamma, (v) => (o.fx.gamma = v), { min: 0.3, max: 3 }));
      rows.push(slider('Hue', () => o.fx.hue, (v) => (o.fx.hue = v), { min: -3.14, max: 3.14 }));
    } else {
      rows.push(el('div', { class: 'row' }, [
        toggle('Effects see this shape', () => o.fxCollide !== false, (v) => { o.fxCollide = v; pushProject(true); }),
        toggle('Invert: light only inside', () => o.invert, (v) => (o.invert = v), { title: 'Black out everything except this shape' }),
      ]));
      rows.push(el('div', { class: 'row' }, [
        el('button', { class: 'btn sm grow', text: 'Turn into a surface', title: 'The same outline, but lit: the picture goes there', onclick: () => shapeToSurface(o) }),
      ]));
      rows.push(slider('Softness', () => o.feather, (v) => (o.feather = v), { min: 0, max: 120, step: 1, fmt: (v) => v + 'px' }));
      rows.push(slider('Grow', () => o.grow, (v) => (o.grow = v), { min: -60, max: 60, step: 1, fmt: (v) => v + 'px' }));
      rows.push(slider('Strength', () => o.opacity, (v) => (o.opacity = v), { max: 1, fmt: pc }));
      rows.push(note(`${o.points.length} points \u2014 double-click an edge to add one, Backspace on a point to remove it.`));
    }
    return section('Selection', rows, { help: isSurf
      ? 'A surface is where the picture goes: drag its corners onto the wall.'
      : 'A shape is something on the wall the projector must not light. It stays black, and the effects treat it as solid: balls land on it, water flows round it, the Shapes effects act on it.' });
  }

  function setMesh(o, d) {
    let c = o.mesh.cols, r = o.mesh.rows;
    if (d === 0) { c = 1; r = 1; }
    else { c = clamp(c + d, 1, 12); r = clamp(r + d, 1, 12); }
    o.mesh = Mesh.resample(o.mesh, c, r);
    pushProject(true);
    buildInspector();
  }

  function fitAspect(o) {
    const [ow, oh] = outputSize();
    const [vw, vh] = player.video.videoWidth ? [player.video.videoWidth, player.video.videoHeight] : [16, 9];
    const srcA = (vw * o.src.w) / (vh * o.src.h);
    const c = Mesh.corners(o.mesh);
    const cx = (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4;
    const cy = (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4;
    const wN = Math.max(...c.map((p) => p[0])) - Math.min(...c.map((p) => p[0]));
    const hN = Math.max(...c.map((p) => p[1])) - Math.min(...c.map((p) => p[1]));
    let w = wN, h = (wN * ow) / srcA / oh;
    if (h > hN) { h = hN; w = (hN * oh * srcA) / ow; }
    o.mesh = { cols: 1, rows: 1, pts: [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx - w / 2, cy + h / 2], [cx + w / 2, cy + h / 2]] };
    pushProject(true);
  }

  // small draggable view of the video frame showing this surface's source region
  function srcMapWidget(o) {
    const wrap = el('div', { style: 'position:relative;width:100%;aspect-ratio:16/9;background:#000;border:1px solid var(--line);border-radius:5px;overflow:hidden' });
    const cv = el('canvas', { style: 'position:absolute;inset:0;width:100%;height:100%' });
    wrap.appendChild(cv);
    const draw = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr);
      const x = cv.getContext('2d');
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.clearRect(0, 0, r.width, r.height);
      const src = previewSource();
      if (sourceReady(src)) {
        try { x.drawImage(src, 0, 0, r.width, r.height); } catch {}
        x.globalAlpha = 0.55; x.fillStyle = '#000';
        x.fillRect(0, 0, r.width, r.height);
        x.globalAlpha = 1;
        try {
          x.save();
          x.beginPath();
          x.rect(o.src.x * r.width, o.src.y * r.height, o.src.w * r.width, o.src.h * r.height);
          x.clip();
          x.drawImage(src, 0, 0, r.width, r.height);
          x.restore();
        } catch {}
      }
      for (const s of project().surfaces) {
        const cur = s.id === o.id;
        x.strokeStyle = cur ? '#00d4ff' : 'rgba(255,255,255,.25)';
        x.lineWidth = cur ? 2 : 1;
        x.strokeRect(s.src.x * r.width, s.src.y * r.height, s.src.w * r.width, s.src.h * r.height);
      }
      const hx = (o.src.x + o.src.w) * r.width, hy = (o.src.y + o.src.h) * r.height;
      x.fillStyle = '#00d4ff';
      x.fillRect(hx - 4, hy - 4, 8, 8);
    };
    updaters.push(draw);
    requestAnimationFrame(draw);
    srcMapWidget.redraw = draw;

    let mode = null, st = null;
    wrap.addEventListener('pointerdown', (e) => {
      const r = wrap.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
      const nearHandle = Math.hypot(u - (o.src.x + o.src.w), v - (o.src.y + o.src.h)) < 0.05;
      mode = nearHandle ? 'size' : 'move';
      st = { u, v, src: { ...o.src } };
      wrap.setPointerCapture(e.pointerId);
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!mode) return;
      const r = wrap.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
      if (mode === 'move') {
        o.src.x = clamp(st.src.x + (u - st.u), 0, 1 - o.src.w);
        o.src.y = clamp(st.src.y + (v - st.v), 0, 1 - o.src.h);
      } else {
        o.src.w = clamp(st.src.w + (u - st.u), 0.02, 1 - o.src.x);
        o.src.h = clamp(st.src.h + (v - st.v), 0.02, 1 - o.src.y);
      }
      pushProject();
      draw();
    });
    wrap.addEventListener('pointerup', () => { mode = null; pushProject(true); });
    return wrap;
  }

  function layerRow(o, kind, i, list) {
    const on = stage.sel?.id === o.id;
    const chk = el('input', { type: 'checkbox', title: 'Show / hide' });
    chk.checked = !!o.enabled;
    chk.onclick = (e) => e.stopPropagation();
    chk.onchange = () => { o.enabled = chk.checked; pushProject(true); buildInspector(); };
    const kindTxt = kind === 'surface' && o.content && o.content.kind !== 'video'
      ? (CONTENT_KINDS.find((k) => k[0] === o.content.kind) || [])[1] : null;
    const row = el('div', { class: 'lay' + (on ? ' on' : '') + (o.enabled ? ' vis' : '') + (kind === 'mask' ? ' mk' : '') }, [
      chk,
      el('span', { class: 'nm', title: o.name }, [
        el('span', { text: (kind === 'surface' ? (i + 1) + '. ' : '') + (o.name || kind) }),
        kindTxt ? el('span', { class: 'cn', text: kindTxt.toLowerCase() }) : null,
      ]),
      el('span', { class: 'ar', text: '\u25B2', title: 'Move up',
        onclick: (e) => { e.stopPropagation(); if (i > 0) { list.splice(i - 1, 0, list.splice(i, 1)[0]); pushProject(true); buildInspector(); } } }),
      el('span', { class: 'ar', text: '\u25BC', title: 'Move down',
        onclick: (e) => { e.stopPropagation(); if (i < list.length - 1) { list.splice(i + 1, 0, list.splice(i, 1)[0]); pushProject(true); buildInspector(); } } }),
    ]);
    row.onclick = () => { stage.select(kind, o.id); buildInspector(); };
    return row;
  }

  function layersSection() {
    const rows = [];
    rows.push(head('Surfaces'));
    if (!project().surfaces.length) rows.push(el('div', { class: 'hint', text: 'none \u2014 press + Surface' }));
    project().surfaces.forEach((o, i) => rows.push(layerRow(o, 'surface', i, project().surfaces)));
    rows.push(el('div', { class: 'fxhead', text: 'Shapes' }));
    if (!project().masks.length) rows.push(el('div', { class: 'hint', text: 'none \u2014 press + Shape, or turn a surface into one' }));
    project().masks.forEach((o, i) => rows.push(layerRow(o, 'mask', i, project().masks)));
    if (project().masks.length) rows.push(el('div', { class: 'row', style: 'margin-top:4px' }, [
      el('button', { class: 'btn sm grow', text: 'All shapes on', onclick: () => { project().masks.forEach((m) => (m.enabled = true)); pushProject(true); buildInspector(); } }),
      el('button', { class: 'btn sm grow', text: 'All off', onclick: () => { project().masks.forEach((m) => (m.enabled = false)); pushProject(true); buildInspector(); } }),
    ]));
    return section('Surfaces & shapes', rows, { help: 'Surfaces are where the picture goes: quads you drag onto the wall. Shapes are things the projector must not light \u2014 a painting, the plant, the couch; they stay black and the effects treat them as solid.' });
  }

  // A project holds several maps; each output shows one of them.
  function editMap(id) {
    project().mapId = id;
    ensureMaps(project());
    stage.select(null, null);
    pushProject(true);
    buildInspector();
  }

  function freshIds(map) {
    for (const sf of map.surfaces) sf.id = uid('surf');
    for (const m of map.masks) m.id = uid('mask');
    return map;
  }

  function mapsSection() {
    const maps = project().maps;
    const rows = [];
    const list = el('div', { style: 'display:flex;flex-direction:column;gap:2px' });
    const pid = mapIdFor(project(), S().outputs, 'projector'), tid = mapIdFor(project(), S().outputs, 'tv');
    maps.forEach((m, i) => {
      const on = m.id === project().mapId;
      const tags = [];
      if (m.id === pid) tags.push('projector');
      if (m.id === tid) tags.push('TV');
      const row = el('div', { class: 'mapRow' + (on ? ' on' : ''), title: `${m.surfaces.length} surface${m.surfaces.length === 1 ? '' : 's'}, ${m.masks.length} shape${m.masks.length === 1 ? '' : 's'}` }, [
        el('span', { class: 'nm', text: m.name }),
        ...tags.map((t) => el('span', { class: 'tag', text: t, title: 'Shown on the ' + t })),
        el('span', { class: 'ar', text: '\u270E', title: 'Rename', onclick: async (e) => {
          e.stopPropagation();
          const n = await promptModal('Name this map', m.name);
          if (n && n.trim()) { m.name = n.trim(); pushProject(true); buildInspector(); }
        } }),
        el('span', { class: 'ar', text: '\u2398', title: 'Duplicate', onclick: (e) => {
          e.stopPropagation();
          const copy = freshIds(JSON.parse(JSON.stringify(m)));
          copy.id = uid('map'); copy.name = m.name + ' copy';
          maps.splice(i + 1, 0, copy);
          editMap(copy.id);
        } }),
        el('span', { class: 'ar', text: '\u2715', title: 'Delete', onclick: (e) => {
          e.stopPropagation();
          if (maps.length < 2) { toast('Keep at least one map'); return; }
          maps.splice(i, 1);
          editMap(maps[Math.max(0, i - 1)].id);
        } }),
      ]);
      row.onclick = () => editMap(m.id);
      list.appendChild(row);
    });
    rows.push(list);
    rows.push(el('div', { class: 'row' }, [
      el('button', { class: 'btn sm grow', text: '+ New map', onclick: () => {
        const m = defaultMap({ name: 'Map ' + (maps.length + 1) });
        maps.push(m); editMap(m.id);
      } }),
      el('button', { class: 'btn sm grow', text: '+ Empty map', onclick: () => {
        const m = defaultMap({ name: 'Map ' + (maps.length + 1), surfaces: [] });
        maps.push(m); editMap(m.id);
      } }),
    ]));
    rows.push(head('Shown on', 'Which map each wall shows. The preview beside the other views shows the wall it is switched to; here you edit the map selected above, whichever wall it is on.'));
    rows.push(el('div', { class: 'ctl wide' }, [el('label', { text: 'Projector' }), mapSelectRow('projector').lastChild]));
    rows.push(el('div', { class: 'ctl wide' }, [el('label', { text: 'TV' }), mapSelectRow('tv').lastChild]));
    return section('Maps', rows, { help: 'A map is one arrangement of surfaces and shapes: one per wall, or several versions of the same wall. Each output shows the map you give it.' });
  }

  // a surface becomes a shape of the same outline, and back
  function surfaceToShape(o) {
    const i = project().surfaces.indexOf(o);
    if (i < 0) return;
    const c = Mesh.corners(o.mesh);
    const m = defaultMask({ name: o.name, points: c.map((q) => [q[0], q[1]]) });
    project().masks.push(m);
    project().surfaces.splice(i, 1);
    stage.select('mask', m.id);
    pushProject(true); buildInspector();
    toast(o.name + ' is now a shape: it stays black and the effects treat it as solid', 2200);
  }

  function shapeToSurface(m) {
    const i = project().masks.indexOf(m);
    if (i < 0) return;
    let pts;
    if (m.points.length === 4) pts = [m.points[0], m.points[1], m.points[3], m.points[2]];
    else {
      const xs = m.points.map((q) => q[0]), ys = m.points.map((q) => q[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
    }
    const sf = defaultSurface({ name: m.name, mesh: { cols: 1, rows: 1, pts: pts.map((q) => [q[0], q[1]]) } });
    project().surfaces.push(sf);
    project().masks.splice(i, 1);
    stage.select('surface', sf.id);
    pushProject(true); buildInspector();
    toast(m.name + ' is now a surface: the picture goes there', 2200);
  }

  function presetSection() {
    const two = twoWallControls() || [];
    return section('Presets', [
      ...two,
      el('button', { class: 'btn', text: 'Set up two walls', title: 'The video split across a main wall and a side wall, each warped on its own, with a soft seam', onclick: twoWallPreset }),
      el('button', { class: 'btn', text: 'One wall, full output', onclick: () => {
        project().surfaces = [defaultSurface({ name: 'Wall', mesh: { cols: 1, rows: 1, pts: [[0, 0], [1, 0], [0, 1], [1, 1]] } })];
        stage.select('surface', project().surfaces[0].id);
        pushProject(true); buildInspector();
      } }),
      head('Several surfaces, one picture'),
      el('button', { class: 'btn', text: 'Spread the video across all surfaces', onclick: spreadAcrossAreas }),
      el('button', { class: 'btn', text: 'Whole video on every surface', onclick: () => {
        project().surfaces.forEach((s) => (s.src = { x: 0, y: 0, w: 1, h: 1 }));
        pushProject(true); buildInspector();
        toast('Every surface now shows the whole video.');
      } }),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn grow', text: 'Save mapping', onclick: () => api.saveProject(false).then((p) => p && toast('Saved ' + p)) }),
        el('button', { class: 'btn grow', text: 'Open…', onclick: () => api.openProject() }),
      ]),
    ], { help: 'Starting points for this map, and the mapping as a file you can keep per setup.' });
  }

  const SEAM_OVERLAP = 0.004;   // hairline overlap so no black line shows at the corner

  function twoWallPreset() {
    const split = 0.6;
    const main = defaultSurface({
      name: 'Main wall',
      src: { x: 0, y: 0, w: split, h: 1 },
      mesh: { cols: 1, rows: 1, pts: [[0, 0], [split + SEAM_OVERLAP, 0], [0, 1], [split + SEAM_OVERLAP, 1]] },
    });
    const side = defaultSurface({
      name: 'Side wall',
      src: { x: split, y: 0, w: 1 - split, h: 1 },
      mesh: { cols: 1, rows: 1, pts: [[split, 0.06], [1, 0.16], [split, 0.94], [1, 0.84]] },
    });
    project().surfaces = [main, side];
    stage.select('surface', side.id);
    pushProject(true);
    buildInspector();
    toast('Drag the side wall corners onto the real wall corner, then use Content split so shapes stay undistorted.');
  }

  // Two-wall helpers: move the seam, and change how much video each wall gets.
  function twoWallControls() {
    if (project().surfaces.length !== 2) return null;
    const [a, b] = project().surfaces;
    const seamAt = () => a.mesh.pts[1][0] - SEAM_OVERLAP;
    const setSeam = (v) => {
      v = clamp(v, 0.05, 0.95);
      a.mesh.pts[1][0] = v + SEAM_OVERLAP;
      a.mesh.pts[3][0] = v + SEAM_OVERLAP;
      b.mesh.pts[0][0] = v;
      b.mesh.pts[2][0] = v;
    };
    const setContent = (v) => {
      v = clamp(v, 0.05, 0.95);
      a.src.x = 0; a.src.w = v;
      b.src.x = v; b.src.w = 1 - v;
    };
    return [
      slider('Corner at', seamAt, setSeam, { min: 0.05, max: 0.95, fmt: pc, tip: 'The seam: where the wall corner falls on the projector output' }),
      slider('Split', () => a.src.w, setContent, { min: 0.05, max: 0.95, fmt: pc, tip: 'The share of the video given to the main wall. Tune until circles stay round across the corner.' }),
    ];
  }

  // Give each area a slice of the video proportional to how wide it is on the
  // output, left to right - the starting point for one picture across many walls.
  function spreadAcrossAreas() {
    const list = project().surfaces.filter((s) => s.enabled);
    if (list.length < 2) return toast('Draw at least two surfaces first');
    const info = list.map((s) => {
      const c = Mesh.corners(s.mesh);
      const w = Math.abs(((c[1][0] - c[0][0]) + (c[2][0] - c[3][0])) / 2);
      const cx = (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4;
      return { s, w, cx };
    }).sort((a, b) => a.cx - b.cx);
    const total = info.reduce((n, i) => n + i.w, 0) || 1;
    let x = 0;
    for (const it of info) {
      const w = it.w / total;
      it.s.src = { x, y: 0, w, h: 1 };
      x += w;
    }
    pushProject(true);
    buildInspector();
    toast('Video spread across ' + info.length + ' surfaces by width. Fine-tune each surface\'s region of the picture.');
  }

  return {
    mapsSection, layersSection, selectionSection, presetSection, mapSelectRow,
    /** Redraw the source-region widget while a surface is selected (called every frame). */
    redrawSrcMap: () => { if (srcMapWidget.redraw) srcMapWidget.redraw(); },
  };
}
