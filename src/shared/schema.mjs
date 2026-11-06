export const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9);

export function defaultSurface(over = {}) {
  return {
    id: uid('surf'),
    name: 'Surface',
    enabled: true,
    // which part of the video feeds this surface (normalized video coords)
    src: { x: 0, y: 0, w: 1, h: 1 },
    // destination geometry in output-normalized coords: a (cols+1)x(rows+1) grid.
    // cols=rows=1 -> plain 4-corner perspective quad (TL,TR,BR,BL order row-major)
    mesh: { cols: 1, rows: 1, pts: [[0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95]] },
    feather: { l: 0, r: 0, t: 0, b: 0 },   // 0..0.5 in surface-normalized units
    fx: { brightness: 0, contrast: 1, saturation: 1, gamma: 1, hue: 0, opacity: 1, flipH: false, flipV: false, rot: 0 },
    ...over,
  };
}

export function defaultMask(over = {}) {
  return {
    id: uid('mask'),
    name: 'Mask',
    enabled: true,
    invert: false,       // false = black out inside; true = black out everything outside
    feather: 4,          // px in output space
    grow: 0,             // px, expand (+) or shrink (-)
    opacity: 1,          // 1 = fully black, <1 = dim only
    fxCollide: true,     // effects (balls, water, smoke...) collide with it
    points: [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]],
    ...over,
  };
}

const clone = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

// What a surface shows. 'video' takes its `src` region of the film (or of the
// visuals when they stand in for it); 'visuals' runs its own generated scene;
// 'colour' is a flat colour; 'off' lights nothing.
export const CONTENT_KINDS = [
  ['video', 'The video'],
  ['visuals', 'Visuals (own scene)'],
  ['colour', 'A colour'],
  ['off', 'Nothing'],
];
export function defaultContent(over = {}) {
  return { kind: 'video', scene: 'auto', colour: '#303030', ...over };
}

/**
 * A map: one arrangement of surfaces and shapes for one wall. A project holds
 * several, and each output picks the one it shows.
 */
export function defaultMap(over = {}) {
  return {
    id: uid('map'),
    name: 'Wall',
    surfaces: [defaultSurface({ name: 'Main wall', mesh: { cols: 1, rows: 1, pts: [[0, 0], [1, 0], [0, 1], [1, 1]] } })],
    masks: [],
    ...over,
  };
}

/**
 * Make sure the project has its maps, and that `project.surfaces` /
 * `project.masks` are the arrays of the map being edited (`project.mapId`), so
 * the editor and the renderers keep binding to those two names. Projects
 * saved before maps existed carry their surfaces at the top level; they become
 * the first map.
 */
export function ensureMaps(project) {
  if (!Array.isArray(project.maps) || !project.maps.length) {
    project.maps = [defaultMap({
      name: 'Wall',
      surfaces: Array.isArray(project.surfaces) ? project.surfaces : [],
      masks: Array.isArray(project.masks) ? project.masks : [],
    })];
  }
  for (const m of project.maps) {
    if (!m.id) m.id = uid('map');
    if (!m.name) m.name = 'Map';
    if (!Array.isArray(m.surfaces)) m.surfaces = [];
    if (!Array.isArray(m.masks)) m.masks = [];
    for (const s of m.surfaces) if (!s.content || typeof s.content !== 'object') s.content = defaultContent();
  }
  const cur = project.maps.find((m) => m.id === project.mapId) || project.maps[0];
  project.mapId = cur.id;
  project.surfaces = cur.surfaces;
  project.masks = cur.masks;
  return project.maps;
}

export function ensureProject(project) {
  ensureFx(project);
  ensureMaps(project);
  return project;
}

/**
 * Which map an output shows: its `mapId`, 'fill' for the plain full-screen
 * picture, or the first map when nothing was chosen (the TV used to say
 * `mode: 'fill' | 'mapped'`; that is honoured).
 */
export function mapIdFor(project, outputs, role) {
  const o = (outputs && outputs[role]) || {};
  const maps = project.maps || [];
  if (o.mapId === 'fill') return null;
  if (o.mapId && maps.some((m) => m.id === o.mapId)) return o.mapId;
  if (role === 'tv' && o.mode !== 'mapped' && !o.mapId) return null;
  return maps.length ? maps[0].id : null;
}

/**
 * The project as one wall sees it: the same project with the surfaces and
 * shapes of the map that wall shows. `mapped` is false for the plain
 * full-screen picture (no surfaces, no shapes, just the frame).
 */
export function wallProject(project, outputs, role) {
  ensureMaps(project);
  const id = mapIdFor(project, outputs, role);
  const m = id ? project.maps.find((x) => x.id === id) : null;
  if (!m) return { project, map: null, mapped: false };
  if (m.id === project.mapId) return { project, map: m, mapped: true };
  return { project: { ...project, surfaces: m.surfaces, masks: m.masks, mapId: m.id }, map: m, mapped: true };
}

export function defaultFx() {
  return {
    enabled: false,
    quality: 'high',         // low | medium | high | ultra
    gravity: 1.2,            // output widths per second squared
    windX: 0, windY: 0,
    timeScale: 1,
    bloom: 0.6, bloomThreshold: 0.9, exposure: 1, tonemap: true,
    collideMasks: true,      // blackout shapes are solid
    collideSurfaceEdges: false,
    walls: { l: true, r: true, t: false, b: true },
    pauseWithVideo: false,
    preview: true,           // simulate in the control window too
    audio: {
      enabled: false,
      sensitivity: 1.4,
      attack: 0.02,          // seconds to rise
      release: 0.16,         // seconds to fall
      beatThreshold: 1.5,    // standard deviations of spectral flux
      beatHold: 0.22,
      globalSrc: 'level',
      globals: { gravity: 0, timeScale: 0, bloom: 0, exposure: 0, wind: 0 },
    },
    interact: {
      pointer: true, strength: 1, radius: 0.07,
      camera: false,            // let camera movement push the simulation
      cameraSensitivity: 1,
      cameraForce: 1,
      cameraDebug: false,
      phoneParts: 'body',       // which joints a phone-tracked person pushes with: hands | arms | body
    },
    layers: [],
  };
}

/**
 * Fill in anything a project saved by an older build is missing, in place, so
 * the editor can bind straight to `project.fx` without every control having to
 * defend itself.
 */
let FX_DEFAULTS = null;

export function ensureFx(project) {
  const fx = project.fx && typeof project.fx === 'object' ? project.fx : (project.fx = {});
  // No version stamp on purpose: a stamp only works if every future field
  // addition remembers to bump it, and one that is forgotten silently ships a
  // half-migrated project. Filling the gaps every call costs a dozen property
  // checks and can never be stale.
  const d = FX_DEFAULTS || (FX_DEFAULTS = defaultFx());
  for (const k in d) {
    const v = d[k];
    if (fx[k] == null) fx[k] = clone(v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k2 in v) {
        if (fx[k][k2] == null) fx[k][k2] = clone(v[k2]);
        else if (v[k2] && typeof v[k2] === 'object' && !Array.isArray(v[k2])) {
          for (const k3 in v[k2]) if (fx[k][k2][k3] == null) fx[k][k2][k3] = v[k2][k3];
        }
      }
    }
  }
  if (!Array.isArray(fx.layers)) fx.layers = [];
  for (const l of fx.layers) {
    if (!l.id) l.id = uid('fx');
    if (l.enabled == null) l.enabled = true;
    if (l.opacity == null) l.opacity = 1;
    if (!l.params || typeof l.params !== 'object') l.params = {};
    if (!Array.isArray(l.mod)) l.mod = [];
    // which walls the layer shows on; missing means both
    if (!l.show || typeof l.show !== 'object') l.show = { projector: true, tv: true };
    if (l.show.projector == null) l.show.projector = true;
    if (l.show.tv == null) l.show.tv = true;
  }
  return fx;
}

export function defaultFxLayer(type, params, over = {}) {
  return {
    id: uid('fx'),
    type,
    name: null,
    enabled: true,
    opacity: 1,
    params: params || {},
    mod: [],               // [{ p, src, amt, mode }] audio -> parameter
    trig: null,            // { src, action, every } fire an action on the beat
    show: { projector: true, tv: true },   // which walls carry this layer
    ...over,
  };
}

export function defaultProject() {
  const full = defaultSurface({
    name: 'Main wall',
    mesh: { cols: 1, rows: 1, pts: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  });
  const map = defaultMap({ name: 'Wall', surfaces: [full], masks: [] });
  return {
    version: 2,
    name: 'Untitled',
    maps: [map],
    mapId: map.id,
    surfaces: map.surfaces,
    masks: map.masks,
    fx: defaultFx(),
    global: {
      brightness: 1,
      blackout: false,
      testPattern: 'off',      // off | grid | bars | corners | circles | text
      showGuides: false,       // draw surface outlines on the projector itself
      smoothMotion: false,     // cross-fade decoded frames to hide 24/25fps judder
      background: '#000000',
      refW: 1920,
      refH: 1080,
    },
  };
}

export function defaultState() {
  return {
    project: defaultProject(),
    projectEpoch: 0,
    projectPath: null,
    mappingName: null,       // the named wall setup currently loaded
    dirty: false,
    transport: {
      source: null,            // { kind:'file'|'stream', url, title, audioUrl?, duration? }
      playing: false,
      position: 0,             // seconds at anchorTime
      anchorTime: Date.now(),  // wall-clock ms when position was set
      rate: 1,
      volume: 1,
      muted: false,
      repeat: 'all',          // off | all | one
      duration: 0,
    },
    playlist: { items: [], index: -1, shuffle: false, name: null },
    audioOut: 'control',       // resolved by main: which window actually plays audio
    clockOwner: 'control',     // resolved by main: the one window that may steer the clock
    outputs: {
      // role -> { displayId, enabled, mapId } — mapId names the map this
      // output shows, 'fill' the plain full-screen picture, null the first map
      projector: { displayId: null, displayLabel: null, enabled: false, mapId: null },
      // the TV is a second wall: the plain full-screen picture by default,
      // with the effects stack running over it (fx), or any map
      tv: { displayId: null, displayLabel: null, enabled: false, mapId: 'fill', fx: true },
    },
    settings: {
      audioTarget: 'auto',     // auto | tv | projector | control | none
      audioSinkId: null,       // Mac audio output device (setSinkId); null = system default
      audioSinkLabel: null,
      livePreview: true,
      cameraDeviceId: null,
      fitMode: 'contain',      // for 'fill' outputs: contain | cover | stretch
      previewQuality: 'auto',  // auto | low | full — the control window's copy
      maxHeight: 1080,         // cap for YouTube stream resolution
      remoteEnabled: false,    // serve the phone-camera page on the LAN
      remotePort: 9223,
      remoteCalib: null,       // { pts: 4 camera-normalized marker centres, w, h, H: camera->output homography }
      preDownload: true,       // pull a copy of every streamed track into the cache as it plays
      fxSets: [],              // named sets of effect types, to keep the catalogue short: [{ name, types }]
      fxSet: '',               // the active set's name, or '' for every effect
      visuals: false,          // replace the video with generated visuals, for every track
      visualsFor: [],          // videos (videoKey) that always get visuals instead of their picture
      visualsByKey: {},        // per-video overrides of visualsCfg, keyed by videoKey
      visualsCfg: { scene: 'auto', every: 30, speed: 1, react: 1, palette: 'auto', emoji: '',   // '' = the default emoji
        city: 'auto', daytime: 'auto', haze: 0.35, ride: 0.3 },                                 // the train ride's city, hour, haze and how high the line runs
      ai: {
        enabled: false,        // master switch for everything that talks to OpenAI
        apiKey: '',            // optional; otherwise OPENAI_API_KEY from the environment or .env
        textModel: 'gpt-5.4',          // planning the show (tool calls, reasoning)
        visionModel: 'gpt-5.4-mini',   // reading frames for captions (often, so cheap and quick)
        imageModel: 'gpt-image-1.5',   // dreaming frames
        steer: false,          // let the model choose and tune the effects
        steerMode: 'sections', // per track ('track'), at section changes in the music ('sections'), or on a timer ('timer')
        steerEvery: 90,        // for the timer: seconds between re-plans, give or take a third
        steerBrief: '',        // a standing direction for the director ("dark and slow", "kids' party")
        steerReasoning: 'low', // reasoning effort for the planner
        captionStyle: 'poetic',
        captionLanguage: 'English',
        captionEvery: 18,      // seconds between captions
        lookahead: 12,         // how far ahead of the playhead frames are read
        dreamEvery: 40,        // seconds between dreamed frames
        dreamStyle: 'oil painting',
        emoji: false,          // let the vision model choose the emoji rain's emoji
      },
    },
    remote: { running: false, port: 9223, secure: false, urls: [], clients: [], error: null, models: false },
    characters: [],            // the pixel people roster (main fills it): [{ id, name, url, enabled, sets }]
  };
}

/** The characters that take part: on, and in the active effect set (or in no set). */
export function activeCharacters(state) {
  if (!state) return [];
  const set = (state.settings && state.settings.fxSet) || '';
  return (state.characters || []).filter((c) => c.enabled !== false && (!set || !c.sets || !c.sets.length || c.sets.includes(set)));
}

// Rebuild a mesh at a new resolution while preserving the current shape.
export function resampleMesh(mesh, cols, rows, evalAt) {
  const pts = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      pts.push(evalAt(i / cols, j / rows));
    }
  }
  return { cols, rows, pts };
}
