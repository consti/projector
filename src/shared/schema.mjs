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
    ...over,
  };
}

export function defaultProject() {
  const full = defaultSurface({
    name: 'Main wall',
    mesh: { cols: 1, rows: 1, pts: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  });
  return {
    version: 1,
    name: 'Untitled',
    surfaces: [full],
    masks: [],
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
      // role -> { displayId, enabled, mode }
      projector: { displayId: null, displayLabel: null, enabled: false, mode: 'mapped' },
      tv: { displayId: null, displayLabel: null, enabled: false, mode: 'fill' },
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
    },
    remote: { running: false, port: 9223, secure: false, urls: [], clients: [], error: null, models: false },
  };
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
