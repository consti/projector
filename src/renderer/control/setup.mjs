// The Setup view's cards (outputs, sound, preview, streams, snapshots, the
// keys) plus the two small sections that show beside other views: the
// picture (brightness, blackout, guides, smooth motion) and the depth model.
// Built from the window's panel context; see createMapInspector.
import { el, pc, note, head } from '/renderer/control/ui.mjs';

export function createSetupPanel(ctx) {
  const { stage, toast, toggleOutput, refreshMappings, mapSelectRow, depth, updaters, frameUpdaters } = ctx;
  const { section, slider, toggle, selectRow } = ctx.W;
  const project = ctx.project, S = ctx.state, displays = ctx.displays, audioDevices = ctx.audioDevices, mappings = ctx.mappings;
  let mappingName = '';          // the name typed into the snapshot field

  function outputSection() {
    const rows = [];
    for (const role of ['projector', 'tv']) {
      const cfg = S().outputs[role];
      const sel = el('select', {});
      sel.appendChild(el('option', { value: '', text: '— none —' }));
      for (const d of displays()) {
        sel.appendChild(el('option', {
          value: d.id,
          text: `${d.label} ${d.size.width}x${d.size.height}${d.isPrimary ? ' (main)' : ''}`,
        }));
      }
      sel.value = cfg.displayId || '';
      sel.onchange = () => api.setOutput(role, { displayId: sel.value || null });
      const on = toggle('On', () => S().outputs[role].enabled, () => toggleOutput(role), { push: false });
      rows.push(el('div', { class: 'ctl wide' }, [
        el('label', { text: role === 'projector' ? 'Projector' : 'TV' }),
        el('div', { class: 'row nowrap' }, [sel, on]),
      ]));
      rows.push(mapSelectRow(role));
      if (role === 'tv') {
        rows.push(selectRow('Fit', [['contain', 'Contain (letterbox)'], ['cover', 'Cover (crop)'], ['stretch', 'Stretch']],
          () => S().settings.fitMode, (v) => api.patchState({ settings: { fitMode: v } })));
        rows.push(el('div', { class: 'row' }, [
          toggle('Effects on the TV', () => S().outputs.tv.fx !== false, (v) => api.setOutput('tv', { fx: v }),
            { push: false, tip: 'With the plain picture the TV is a second wall: the same video full-screen, the effects running over it, no shapes in their world. Give it a map and it is mapped like the projector.' }),
        ]));
      }
    }
    const pd = S().outputs.projector.displayId, td = S().outputs.tv.displayId;
    if (pd && td && pd === td) {
      rows.push(el('div', { class: 'hint', style: 'color:var(--mask)',
        text: 'Projector and TV are both set to the same screen, so one covers the other. Pick different screens, or swap them.' }));
    }
    rows.push(el('div', { class: 'row' }, [
      displays().length > 1 ? el('button', {
        class: 'btn sm grow', text: 'Swap the two screens',
        title: 'Send the projector to the TV\u2019s screen and vice versa',
        onclick: () => api.swapOutputs().then(() => toast('Swapped')),
      }) : null,
      el('button', {
        class: 'btn sm grow', text: 'Identify',
        title: 'Flash the role and the screen name on each output window',
        onclick: () => { api.identifyOutputs(); toast('Each open output names itself and its screen for a moment.'); },
      }),
      el('button', { class: 'btn sm', text: 'Reload', onclick: () => api.reloadAll() }),
      el('button', { class: 'btn sm', text: 'Close all', title: 'Close every output window. Esc on an output window, or Cmd+Alt+P from anywhere, does the same.', onclick: () => api.closeAllOutputs() }),
    ]));
    return section('Outputs', rows, { help: 'Each output is a screen and a map: which surfaces and shapes it shows (Map view), or the plain full-screen picture. Output windows open without taking focus.' });
  }

  function soundSetupSection() {
    const rows = [];
    rows.push(selectRow('Audio from',
      [['auto', 'Auto (first open output)'], ['tv', 'TV'], ['projector', 'Projector'],
       ['control', 'This window'], ['none', 'Muted']],
      () => S().settings.audioTarget || 'auto', (v) => api.patchState({ settings: { audioTarget: v } })));
    rows.push(note('Playing from: ' + (S().audioOut || 'control') +
      (S().settings.audioTarget !== 'auto' && S().settings.audioTarget !== S().audioOut && S().settings.audioTarget !== 'none'
        ? '  (the ' + S().settings.audioTarget + ' window is not open)' : '')));
    rows.push(selectRow('Device',
      [['', 'System default'], ...audioDevices().map((d) => [d.id, d.label])],
      () => S().settings.audioSinkId || '',
      (v) => { const d = audioDevices().find((x) => x.id === v); api.patchState({ settings: { audioSinkId: v || null, audioSinkLabel: d ? d.label : null } }); },
      { tip: 'Send the sound to a specific output (e.g. an AirPlay receiver) without changing the Mac\u2019s system default.' }));
    return section('Sound', rows, { help: 'Which window plays the sound. The beat is read in that window and shared with every wall; how the effects react to it is under Effects \u2192 Sound.' });
  }

  function previewSection() {
    const rows = [];
    rows.push(selectRow('Quality',
      [['auto', 'Small while an output is open'], ['low', 'Always small'], ['full', 'Always full size']],
      () => S().settings.previewQuality || 'auto', (v) => api.patchState({ settings: { previewQuality: v } }),
      { tip: 'The preview pulls its own copy of the video and draws every other frame while a wall is up. Keeping it small leaves the bandwidth and the GPU to the projector.' }));
    rows.push(el('div', { class: 'row' }, [
      toggle('Effects in the preview', () => project().fx.preview !== false, (v) => { project().fx.preview = v; }, { title: 'Simulate the effects in this window too. Off saves this Mac\u2019s GPU for the walls.' }),
    ]));
    return section('Preview', rows);
  }

  function streamsSection() {
    const rows = [];
    rows.push(selectRow('YouTube max', [['720', '720p'], ['1080', '1080p'], ['1440', '1440p'], ['2160', '4K']],
      () => S().settings.maxHeight || 1080, (v) => api.patchState({ settings: { maxHeight: Number(v) } })));
    rows.push(el('div', { class: 'row' }, [
      toggle('Pre-download streams', () => S().settings.preDownload !== false, (v) => api.patchState({ settings: { preDownload: v } }),
        { push: false, tip: 'Every streamed track is pulled down as it plays and played from disk next time. The last 25 stay in a cache (Library \u2192 Streamed lately); \u2605 Keep on a playlist item makes it part of the library.' }),
    ]));
    return section('Streams', rows);
  }

  // Named wall setups: save the geometry you spent an evening aligning, and get
  // it back by name. The live state is restored automatically anyway; this is
  // for keeping more than one of them.
  function mappingSection() {
    const rows = [];
    const cur = mappings().current;
    const head = el('div', { class: 'hint' });
    const showHead = () => {
      const name = S() && S().mappingName;
      head.innerHTML = '';
      head.appendChild(el('span', { text: name ? 'Loaded: ' : 'Not saved under a name yet' }));
      if (name) head.appendChild(el('b', { text: name }));
      if (S() && S().dirty) head.appendChild(el('span', { class: 'tag', text: 'unsaved changes' }));
    };
    updaters.push(showHead); showHead();
    rows.push(head);

    const sel = el('select', {});
    sel.appendChild(el('option', { value: '', text: mappings().items.length ? '— load a saved setup —' : '— nothing saved yet —' }));
    for (const m of mappings().items) {
      sel.appendChild(el('option', { value: m.name, text: m.name + (m.name === cur ? '  (current)' : '') }));
    }
    sel.value = '';
    sel.onchange = () => {
      const n = sel.value;
      if (!n) return;
      api.loadMapping(n)
        .then(() => { stage.select(null, null); refreshMappings(); toast('Loaded ' + n); })
        .catch((e) => toast('Could not load: ' + e.message));
    };
    rows.push(el('div', { class: 'ctl wide' }, [el('label', { text: 'Setups' }), sel]));

    const name = el('input', { type: 'text', id: 'mapName', placeholder: 'Name this wall setup' });
    name.value = mappingName || cur || '';
    name.oninput = () => { mappingName = name.value; };
    name.onkeydown = (e) => { if (e.key === 'Enter') save(); };
    const save = () => {
      const n = (name.value || '').trim();
      if (!n) { toast('Give the setup a name first'); name.focus(); return; }
      api.saveMapping(n).then((saved) => { mappingName = saved; refreshMappings(); toast('Saved ' + saved); });
    };
    rows.push(el('div', { class: 'ctl wide' }, [el('label', { text: 'Name' }), name]));
    rows.push(el('div', { class: 'row' }, [
      el('button', { class: 'btn grow', text: 'Save', title: 'Save the current walls, masks and effects under this name', onclick: save }),
      el('button', {
        class: 'btn danger', text: 'Delete', disabled: !cur ? '' : null,
        onclick: () => {
          if (!cur) return;
          api.deleteMapping(cur).then(() => { mappingName = ''; refreshMappings(); toast('Deleted ' + cur); });
        },
      }),
      el('button', { class: 'btn', text: '\u2026', title: 'Show the files in Finder', onclick: () => api.revealMappings() }),
    ]));
    return section('Snapshots', rows, { help: 'A snapshot of everything: every map, the effects and the settings. Whatever you last had on screen comes back by itself when you reopen the app; snapshots are for keeping whole evenings and going back to them.' });
  }

  function helpSection() {
    return section('Keys', [el('div', {
      class: 'hint', html: `
        <b>V</b> select &nbsp; <b>S</b> new surface &nbsp; <b>M</b> shape (rectangle) &nbsp; <b>P</b> shape (draw)<br>
        <b>Space</b> play/pause &nbsp; <b>B</b> blackout &nbsp; <b>G</b> wall guides<br>
        <b>Arrows</b> nudge 1px, <b>Shift</b> 10px &nbsp; <b>Backspace</b> delete<br>
        <b>Cmd+scroll</b> zoom &nbsp; <b>Alt+drag</b> pan &nbsp; <b>Cmd+drag</b> ignore snapping<br>
        <b>Shift+drag</b> constrain to one axis &nbsp; <b>Double-click</b> edge adds a point`,
    })]);
  }

  function lookSection() {
    const motion = el('div', { class: 'hint' });
    const showMotion = () => {
      const fps = stage.engine.sourceFps;
      const rate = fps ? fps.toFixed(0) + ' fps' : 'unknown';
      const txt = (project().global.smoothMotion ? 'Cross-fading between frames. ' : '') + 'Source is ' + rate + '.';
      if (motion.textContent !== txt) motion.textContent = txt;
    };
    frameUpdaters.push(showMotion); showMotion();
    return section('Picture', [
      slider('Brightness', () => project().global.brightness, (v) => (project().global.brightness = v), { min: 0, max: 1, fmt: pc }),
      el('div', { class: 'row' }, [
        toggle('Blackout', () => project().global.blackout, (v) => (project().global.blackout = v), { tip: 'Kills the projector output instantly (B)' }),
        toggle('Wall guides', () => project().global.showGuides, (v) => (project().global.showGuides = v), { tip: 'Draws the surface outlines onto the wall itself (G)' }),
      ]),
      el('div', { class: 'row' }, [
        toggle('Smooth motion', () => project().global.smoothMotion, (v) => (project().global.smoothMotion = v),
          { tip: 'Film at 24 or 25 fps on a 60 Hz projector lands on an uneven 3:2 cadence, which reads as judder on slow pans. Smoothing cross-fades between frames to even it out, at the cost of a little motion blur.' }),
      ]),
      motion,
    ]);
  }

  function depthSection() {
    const rows = [];
    const status = el('div', { class: 'hint' });
    const show = () => {
      const st = depth.status;
      status.textContent = st === 'ready' ? `Depth Anything V2 small is loaded on ${depth.device}${depth.fps ? ` · about ${depth.fps} frames/s` : ''}. It runs while a Parallax camera layer is in the stack.`
        : st === 'loading' ? `Loading the depth model${depth.progress ? ` (${depth.progress}%)` : '…'}`
        : st === 'error' ? 'The depth model failed: ' + depth.error
        : 'Not loaded. It loads on its own the first time a Parallax camera layer asks for it (about 50 MB, fetched once and kept).';
    };
    frameUpdaters.push(show); show();
    rows.push(status);
    rows.push(el('div', { class: 'row' }, [
      el('button', { class: 'btn sm', text: 'Load now', onclick: () => depth.load() }),
    ]));
    return section('Depth (local model)', rows, { help: 'A second copy of the video runs a little ahead of the playhead; each frame\u2019s depth is read by the model and handed to the parallax layers when the film reaches it, on every wall. Nothing leaves this Mac.' });
  }

  return {
    outputSection, soundSetupSection, previewSection, streamsSection, mappingSection, helpSection, lookSection, depthSection,
    /** The saved name arrived from main; keep what is being typed. */
    syncMappingName: (cur) => { if (document.activeElement?.id !== 'mapName') mappingName = cur || mappingName; },
  };
}
