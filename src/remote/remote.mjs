// The phone. It opens its own camera, runs MediaPipe's pose tracker on the
// frames right here (a phone's GPU is closer to the pixels than the Mac is),
// and sends only the landmarks over a WebSocket to the app, which maps them
// into the projection through the alignment solved in "Align" mode.

import { BONES, PERSON_COLORS } from '/shared/pose.mjs';

const $ = (s) => document.querySelector(s);
const video = $('#v'), ov = $('#ov'), ctx = ov.getContext('2d');
const MP_VERSION = '0.10.21';
const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VERSION;
const MODEL_URL = (q) => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${q}/float16/latest/pose_landmarker_${q}.task`;
const MARK_COLORS = ['#ff3b30', '#34c759', '#0a84ff', '#ffd60a'];
const SEND_HZ = 30;

// ------------------------------------------------------------- prefs ------
const prefs = {
  get: (k, d) => { try { const v = localStorage.getItem('pj.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('pj.' + k, JSON.stringify(v)); } catch {} },
};
const st = {
  ws: null, connected: false, retry: 0,
  stream: null, facing: prefs.get('facing', 'environment'), deviceId: prefs.get('deviceId', null),
  landmarker: null, modelQ: prefs.get('model', 'lite'), maxPoses: prefs.get('people', 2), loading: false, delegate: 'GPU',
  tracking: false, lastVT: -1, lastSend: 0, poses: [], fpsN: 0, fpsT: 0, fps: 0, latency: null,
  skeleton: prefs.get('skeleton', true), mirror: prefs.get('mirror', false),
  name: prefs.get('name', ''),
  cfg: { aspect: 9 / 16, calibrated: false, enabled: false, parts: 'body' },
  aligning: false, handles: null, drag: null,
  info: { models: false },
  wake: null,
  view: prefs.get('view', 'stage'),   // stage (camera) | control (effects deck) | queue
  deck: null, catalog: null, library: [], libFilter: '',
};

// ---------------------------------------------------------- websocket ----
function connect() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws;
  try { ws = new WebSocket(`${scheme}://${location.host}/ws`); } catch { return scheduleReconnect(); }
  st.ws = ws;
  ws.onopen = () => {
    st.connected = true; st.retry = 0;
    send({ t: 'hello', name: st.name || deviceName(), ua: navigator.userAgent, w: video.videoWidth || 0, h: video.videoHeight || 0 });
    st._liveOn = false; syncLiveSub();      // (re)subscribe to the live preview if on a panel
    ui();
  };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
  ws.onclose = () => { st.connected = false; st.ws = null; st._liveOn = false; ui(); scheduleReconnect(); };
  ws.onerror = () => { try { ws.close(); } catch {} };
}
function scheduleReconnect() {
  const wait = Math.min(8000, 500 * Math.pow(2, st.retry++));
  setTimeout(connect, wait);
}
function send(m) { if (st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify(m)); }

function onMessage(m) {
  switch (m.t) {
    case 'config': Object.assign(st.cfg, m); ui(); break;
    case 'catalog': st.catalog = m; renderDeck(); break;
    case 'deck': st.deck = m; renderDeck(); renderQueue(); if (st.view === 'queue' && st.deck) updateDeck(); break;
    case 'frame': onLiveFrame(m); break;
    case 'library': st.library = m.items || []; renderQueue(); break;
    case 'calibOk': leaveAlign(false); toast('Aligned. Now press Track.'); break;
    case 'toast': toast(m.text); break;
    case 'pong': st.latency = Math.round(performance.now() - m.ts); break;
    case 'track': if (m.on && !st.tracking) startTracking(); else if (!m.on && st.tracking) stopTracking(); break;
    case 'align': if (!st.aligning) { if (!st.stream) toast('Start the camera, then press Align'); else enterAlign(); } break;
  }
}
setInterval(() => send({ t: 'ping', ts: performance.now() }), 2000);

// ------------------------------------------------------------ camera -----
async function startCamera() {
  stopCamera();
  const base = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  const tries = [];
  if (st.deviceId) tries.push({ deviceId: { exact: st.deviceId }, ...base });
  tries.push({ facingMode: { ideal: st.facing }, ...base });
  tries.push({ ...base });
  tries.push(true);
  let err = null;
  for (const c of tries) {
    try {
      st.stream = await navigator.mediaDevices.getUserMedia({ video: c, audio: false });
      break;
    } catch (e) { err = e; }
  }
  if (!st.stream) {
    showMsg('Camera unavailable', (err && err.message) + (location.protocol === 'http:' ? ' — the page must be opened over https for the camera to work.' : ''));
    return false;
  }
  video.srcObject = st.stream;
  document.body.classList.add('streaming');
  try { await video.play(); } catch {}
  const track = st.stream.getVideoTracks()[0];
  const s = track.getSettings ? track.getSettings() : {};
  if (s.deviceId) st.deviceId = s.deviceId;
  if (s.facingMode) st.facing = s.facingMode;
  prefs.set('deviceId', st.deviceId); prefs.set('facing', st.facing);
  await refreshDevices();
  keepAwake();
  hideMsg();
  // the tracker takes a few seconds to load, so start on the camera's heels
  loadModel();
  ui();
  return true;
}
function stopCamera() {
  if (st.stream) st.stream.getTracks().forEach((t) => t.stop());
  st.stream = null; video.srcObject = null;
  document.body.classList.remove('streaming');
}
async function flipCamera() {
  st.facing = st.facing === 'environment' ? 'user' : 'environment';
  st.deviceId = null;
  await startCamera();
}
async function refreshDevices() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const sel = $('#camSel');
    sel.innerHTML = '';
    devs.forEach((d, i) => sel.appendChild(Object.assign(document.createElement('option'), { value: d.deviceId, textContent: d.label || 'Camera ' + (i + 1) })));
    if (st.deviceId) sel.value = st.deviceId;
  } catch {}
}
async function keepAwake() {
  try { if (!st.wake && navigator.wakeLock) st.wake = await navigator.wakeLock.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { st.wake = null; keepAwake(); } });

// ------------------------------------------------------------- model -----
async function loadModel() {
  if (st.landmarker || st.loading) return;
  st.loading = true; ui();
  const local = st.info.models;
  const base = local ? '/models' : CDN;
  try {
    const vision = await import(base + '/vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks(base + '/wasm');
    const modelAssetPath = local ? `/models/pose_landmarker_${st.modelQ}.task` : MODEL_URL(st.modelQ);
    const make = (delegate) => vision.PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath, delegate },
      runningMode: 'VIDEO',
      numPoses: st.maxPoses,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });
    try { st.landmarker = await make('GPU'); st.delegate = 'GPU'; }
    catch (e) { console.warn('GPU delegate failed, using CPU', e); st.landmarker = await make('CPU'); st.delegate = 'CPU'; }
  } catch (e) {
    console.error(e);
    toast('Could not load the tracker: ' + (e.message || e) + (local ? '' : ' — does the phone have internet?'), 6000);
  }
  st.loading = false; ui();
}
async function reloadModel() {
  const was = st.tracking;
  if (st.landmarker) { try { st.landmarker.close(); } catch {} st.landmarker = null; }
  await loadModel();
  if (was && st.landmarker) startTracking();
}

// ---------------------------------------------------------- tracking -----
async function startTracking() {
  if (!st.stream && !(await startCamera())) return;
  if (!st.landmarker) { await loadModel(); if (!st.landmarker) return; }
  st.tracking = true; ui();
}
function stopTracking() { st.tracking = false; st.poses = []; ui(); }

function loop() {
  requestAnimationFrame(loop);
  const vw = video.videoWidth, vh = video.videoHeight;
  const now = performance.now();
  if (st.tracking && st.landmarker && vw && video.readyState >= 2 && video.currentTime !== st.lastVT) {
    st.lastVT = video.currentTime;
    let res = null;
    try { res = st.landmarker.detectForVideo(video, now); } catch (e) { console.warn(e); }
    if (res) {
      st.poses = res.landmarks || [];
      st.fpsN++;
      if (now - st.fpsT > 1000) { st.fps = Math.round(st.fpsN * 1000 / (now - st.fpsT)); st.fpsN = 0; st.fpsT = now; meter(); }
      if (now - st.lastSend >= 1000 / SEND_HZ) {
        st.lastSend = now;
        const flat = st.poses.map((lm) => {
          const a = new Array(lm.length * 3);
          for (let i = 0; i < lm.length; i++) {
            a[i * 3] = r3(lm[i].x); a[i * 3 + 1] = r3(lm[i].y); a[i * 3 + 2] = r2(lm[i].visibility == null ? 1 : lm[i].visibility);
          }
          return a;
        });
        send({ t: 'pose', ts: now, w: vw, h: vh, poses: flat });
      }
    }
  }
  draw();
}
const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;

// ----------------------------------------------------------- drawing -----
/** Where the (object-fit: contain) video actually sits on screen. */
function fit() {
  const W = window.innerWidth, H = window.innerHeight;
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
  const s = Math.min(W / vw, H / vh);
  const w = vw * s, h = vh * s;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}
function draw() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  if (ov.width !== Math.round(W * dpr) || ov.height !== Math.round(H * dpr)) { ov.width = Math.round(W * dpr); ov.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!video.videoWidth) return;
  const f = fit();
  const X = (u) => f.x + u * f.w, Y = (v) => f.y + v * f.h;

  if (st.tracking && st.skeleton) {
    st.poses.forEach((lm, pi) => {
      const col = PERSON_COLORS[pi % PERSON_COLORS.length];
      ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath();
      for (const [a, b] of BONES) {
        const A = lm[a], B = lm[b];
        if (!A || !B || (A.visibility != null && A.visibility < 0.5) || (B.visibility != null && B.visibility < 0.5)) continue;
        ctx.moveTo(X(A.x), Y(A.y)); ctx.lineTo(X(B.x), Y(B.y));
      }
      ctx.stroke();
      ctx.fillStyle = col;
      for (const i of [0, 15, 16]) {
        const p = lm[i]; if (!p || (p.visibility != null && p.visibility < 0.5)) continue;
        ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), i ? 7 : 10, 0, Math.PI * 2); ctx.fill();
      }
    });
  }

  if (st.aligning && st.handles) {
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    st.handles.forEach((p, i) => { const q = st.handles[(i + 1) % 4]; ctx.moveTo(X(p[0]), Y(p[1])); ctx.lineTo(X(q[0]), Y(q[1])); });
    ctx.stroke();
    st.handles.forEach((p, i) => {
      const px = X(p[0]), py = Y(p[1]);
      const active = st.drag && st.drag.i === i;
      ctx.strokeStyle = MARK_COLORS[i]; ctx.lineWidth = active ? 4 : 3;
      ctx.beginPath(); ctx.arc(px, py, active ? 26 : 22, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px - 12, py); ctx.lineTo(px + 12, py); ctx.moveTo(px, py - 12); ctx.lineTo(px, py + 12); ctx.stroke();
      ctx.fillStyle = MARK_COLORS[i]; ctx.font = '700 15px -apple-system,system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), px + 24, py - 24);
    });
    // a magnifier while dragging, so the marker centre can actually be hit
    if (st.drag) {
      const p = st.handles[st.drag.i];
      const R = 62, zoom = 3;
      const mx = W / 2, my = f.y + 90 + R;
      ctx.save();
      ctx.beginPath(); ctx.arc(mx, my, R, 0, Math.PI * 2); ctx.clip();
      const sw = (R * 2 / zoom) * (video.videoWidth / f.w), sh = (R * 2 / zoom) * (video.videoHeight / f.h);
      try { ctx.drawImage(video, p[0] * video.videoWidth - sw / 2, p[1] * video.videoHeight - sh / 2, sw, sh, mx - R, my - R, R * 2, R * 2); } catch {}
      ctx.restore();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(mx, my, R, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = MARK_COLORS[st.drag.i];
      ctx.beginPath(); ctx.moveTo(mx - 10, my); ctx.lineTo(mx + 10, my); ctx.moveTo(mx, my - 10); ctx.lineTo(mx, my + 10); ctx.stroke();
    }
  }
}

// --------------------------------------------------------- alignment -----
function enterAlign() {
  if (!st.stream) { toast('Start the camera first'); return; }
  st.aligning = true;
  st.handles = [[0.12, 0.14], [0.88, 0.14], [0.88, 0.86], [0.12, 0.86]];
  document.body.classList.add('aligning');
  $('#alignBar').hidden = false;
  $('#sheet').hidden = true;
  send({ t: 'pattern', kind: 'corners' });
  // give the projector a moment to put the markers up, then take a guess
  setTimeout(() => { if (st.aligning) findMarkers(true); }, 900);
  ui();
}
function leaveAlign(cancel) {
  if (!st.aligning) return;
  st.aligning = false; st.drag = null;
  document.body.classList.remove('aligning');
  $('#alignBar').hidden = true;
  if (cancel) send({ t: 'pattern', kind: 'off' });
  ui();
}
function finishAlign() {
  send({ t: 'calib', pts: st.handles.map((p) => [r3(p[0]), r3(p[1])]), w: video.videoWidth, h: video.videoHeight, facing: st.facing });
  toast('Aligning…');
}

/**
 * Look for the four saturated squares of the "corners" pattern in the camera
 * frame and drop the handles on them. A rough first guess; the operator
 * fine-tunes by dragging.
 */
function findMarkers(quiet) {
  if (!video.videoWidth) return;
  const c = findMarkers.c || (findMarkers.c = document.createElement('canvas'));
  const w = 160, h = Math.max(2, Math.round(160 * video.videoHeight / video.videoWidth));
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  try { x.drawImage(video, 0, 0, w, h); } catch { return; }
  const d = x.getImageData(0, 0, w, h).data;
  const acc = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const o = (j * w + i) * 4, r = d[o], g = d[o + 1], b = d[o + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 110 || mx - mn < 70) continue;            // dark or grey: not a marker
    let k = -1;
    if (r > 150 && g < 110 && b < 110) k = 0;                      // red
    else if (g > 130 && r < 130 && b < 130 && g > r + 40) k = 1;   // green
    else if (b > 170 && r < 120 && b > g + 30) k = 2;              // blue
    else if (r > 170 && g > 140 && b < 120) k = 3;                 // yellow
    if (k < 0) continue;
    acc[k][0] += i + 0.5; acc[k][1] += j + 0.5; acc[k][2]++;
  }
  let found = 0;
  acc.forEach((a, k) => {
    if (a[2] < 6) return;
    st.handles[k] = [a[0] / a[2] / w, a[1] / a[2] / h];
    found++;
  });
  if (!quiet || found) toast(found ? `Found ${found} of 4 markers — check and adjust` : 'No markers seen. Is the pattern on the wall in view?');
}

ov.addEventListener('pointerdown', (e) => {
  if (!st.aligning) return;
  const f = fit();
  let best = 40 * 40, bi = -1;
  st.handles.forEach((p, i) => {
    const dx = f.x + p[0] * f.w - e.clientX, dy = f.y + p[1] * f.h - e.clientY;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) { best = d2; bi = i; }
  });
  if (bi < 0) return;
  st.drag = { i: bi, ox: e.clientX, oy: e.clientY, sx: st.handles[bi][0], sy: st.handles[bi][1] };
  ov.setPointerCapture(e.pointerId);
});
ov.addEventListener('pointermove', (e) => {
  if (!st.drag) return;
  const f = fit();
  // half-speed drag for precision: a fingertip is a big thing on a small marker
  const k = e.shiftKey ? 0.25 : 0.5;
  st.handles[st.drag.i] = [
    Math.min(1, Math.max(0, st.drag.sx + (e.clientX - st.drag.ox) * k / f.w)),
    Math.min(1, Math.max(0, st.drag.sy + (e.clientY - st.drag.oy) * k / f.h)),
  ];
});
const endDrag = () => { st.drag = null; };
ov.addEventListener('pointerup', endDrag);
ov.addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------- ui -----
function ui() {
  const dot = $('#dot');
  dot.classList.toggle('bg-good', st.connected);
  dot.classList.toggle('bg-warn', !st.connected);
  dot.classList.remove('bg-bad');
  let s;
  if (!st.connected) s = 'Connecting to the app…';
  else if (!st.stream) s = 'Connected · camera off';
  else if (st.aligning) s = 'Aligning';
  else if (st.loading) s = 'Loading tracker…';
  else if (st.tracking) s = (st.poses.length ? `Tracking ${st.poses.length} ${st.poses.length === 1 ? 'person' : 'people'}` : 'Tracking · nobody in view')
    + (st.cfg.calibrated ? '' : ' · not aligned') + (st.cfg.enabled ? '' : ' · effects off in app');
  else s = st.cfg.calibrated ? 'Aligned · ready' : 'Not aligned yet';
  $('#status').textContent = s;
  const tb = $('#bTrack');
  tb.textContent = st.tracking ? 'Stop tracking' : 'Track';
  tb.classList.toggle('bg-bad', st.tracking);
  tb.classList.toggle('bg-brand', !st.tracking);
  tb.disabled = st.loading;
  $('#bAlign').disabled = !st.stream;
  document.body.classList.toggle('mirror', !!st.mirror);
  $('#sheetInfo').textContent = `Tracker ${st.landmarker ? `${st.modelQ} on ${st.delegate}` : 'not loaded'} · ${st.info.models ? 'from the app' : 'from the internet'} · ${location.host}`;
  meter();
}
function meter() {
  const bits = [];
  if (st.tracking && st.fps) bits.push(st.fps + ' fps');
  if (st.latency != null) bits.push(st.latency + ' ms');
  $('#meter').textContent = bits.join(' · ');
}
function showMsg(t, sub) { $('#msgText').textContent = t; $('#msgSub').textContent = sub || ''; if (st.view !== 'control') $('#msg').hidden = false; }
function hideMsg() { $('#msg').hidden = true; }
function toast(t, ms = 2600) {
  const el = $('#toast'); el.textContent = t; el.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('on'), ms);
}
function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) { const m = ua.match(/;\s*([^;)]+)\s+Build/); return m ? m[1] : 'Android'; }
  return 'Phone';
}

// ------------------------------------------------------------- deck (control)
const h = (tag, props = {}, kids = []) => {
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
function ctl(op, extra = {}) { send({ t: 'ctl', op, ...extra }); }

// shared Tailwind class recipes (kept as literals so the CSS build can see them)
const CX = {
  card: 'rounded-2xl bg-surface-1 border border-line p-4',
  head: 'text-[11px] font-bold uppercase tracking-[0.13em] text-ink-dim',
  hint: 'text-[13px] text-ink-dim',
  btn: 'min-h-[48px] px-3 rounded-xl bg-surface-2 border border-line font-medium text-[14px] active:scale-[.98] transition-transform grid place-items-center text-center',
  btnPrimary: 'min-h-[48px] px-3 rounded-xl bg-brand text-white font-semibold active:scale-[.98] transition-transform grid place-items-center',
  btnOn: 'min-h-[48px] px-3 rounded-xl bg-brand text-white font-semibold grid place-items-center',
  ctlRow: 'grid grid-cols-[64px_1fr_46px] items-center gap-3',
  ctlLabel: 'text-[12.5px] text-ink-dim truncate',
  ctlVal: 'text-right text-[12px] text-ink-dim tabular-nums',
  input: 'w-full min-h-[46px] px-3.5 rounded-xl bg-surface-2 border border-line text-ink placeholder:text-ink-faint',
};

function setView(v) {
  st.view = v; prefs.set('view', v);
  const panel = v === 'control' || v === 'queue';
  document.body.classList.toggle('control', panel);   // hides camera chrome for either panel
  for (const b of document.querySelectorAll('#viewSeg button')) {
    const on = b.dataset.view === v;
    b.classList.toggle('text-brand', on);
    b.classList.toggle('bg-surface-2', on);
    b.classList.toggle('text-ink-faint', !on);
  }
  const showP = (id, on) => { const p = $(id); if (on) { p.hidden = false; p.classList.remove('panel-enter'); void p.offsetWidth; p.classList.add('panel-enter'); } else p.hidden = true; };
  showP('#deck', v === 'control');
  showP('#queue', v === 'queue');
  if (v === 'control') { send({ t: 'deckSub' }); renderDeck(); }
  if (v === 'queue') { send({ t: 'deckSub' }); send({ t: 'ctl', op: 'libSub' }); renderQueue(); }
  syncLiveSub();
  haptic(10);
  ui();
}

// Ask the Mac to stream the projection preview only while a panel is showing it.
function syncLiveSub() {
  const want = st.connected && (st.view === 'control' || st.view === 'queue');
  if (want === st._liveOn) return;
  st._liveOn = want;
  send({ t: 'ctl', op: 'liveSub', on: want });
  if (!want) { st.hasFrame = false; document.querySelectorAll('.livecard').forEach((c) => c.classList.remove('live')); }
}

function haptic(ms = 8) { try { navigator.vibrate && navigator.vibrate(ms); } catch {} }

let deckShape = '';
const refs = {};
function deckShapeKey() {
  const d = st.deck, c = st.catalog;
  if (!d || !c) return '';
  return (d.fx.layers || []).map((l) => l.id + '#' + l.actions.length).join(',') + '|s' + c.scenes.length + '|e' + c.effects.length;
}
function renderDeck() {
  if (st.view !== 'control') return;
  const root = $('#deck');
  if (!st.deck || !st.catalog) { root.textContent = ''; root.append(h('div', { class: 'pt-[5rem] px-6 text-center ' + CX.hint, text: 'Waiting for the app…' })); return; }
  const key = deckShapeKey();
  if (key !== deckShape) { deckShape = key; buildDeck(root); }
  updateDeck();
}

const SEL = 'min-h-[44px] px-3 rounded-xl bg-surface-2 border border-line text-ink appearance-none';
const BTN = 'min-h-[48px] px-3.5 rounded-xl border border-line bg-surface-2 text-ink font-medium text-[14.5px] flex items-center justify-center gap-1.5 active:scale-[.97] transition-transform';
function sec(headText, kids) {
  return h('div', { class: 'rounded-2xl bg-surface-1 border border-line p-4 flex flex-col gap-3' },
    [headText ? h('div', { class: CX.head, text: headText }) : null].concat(kids));
}
function setActive(btn, on) {
  if (!btn) return;
  btn.classList.toggle('bg-brand', on); btn.classList.toggle('border-transparent', on); btn.classList.toggle('text-white', on);
  btn.classList.toggle('bg-surface-2', !on); btn.classList.toggle('border-line', !on);
}

function slider(label, min, max, step, get, onInput) {
  const inp = h('input', { type: 'range', min, max, step });
  const val = h('span', { class: 'text-right text-[12px] text-ink-dim tabular-nums' });
  inp.value = get();
  inp.addEventListener('input', () => { val.textContent = onInput(Number(inp.value)); });
  inp._get = get; inp._val = val; inp._fmt = onInput;
  const row = h('div', { class: 'grid grid-cols-[64px_1fr_46px] items-center gap-3' },
    [h('label', { class: 'text-[12.5px] text-ink-dim truncate', text: label }), inp, val]);
  val.textContent = onInput(Number(inp.value));
  fillRange(inp);
  return { row, inp };
}

// A live preview of the projection (streamed from the Mac) with the title and
// transport. Shared by the Mixer and Queue tabs.
function liveHero() {
  const img = h('img', { class: 'liveImg absolute inset-0 w-full h-full object-contain hidden', alt: '', decoding: 'async' });
  const noSig = h('div', { class: 'liveNo absolute inset-0 flex flex-col items-center justify-center gap-2 text-ink-dim text-[13px]' },
    [h('div', { class: 'text-3xl text-brand/70', text: '◉' }), h('div', { text: 'Waiting for the projection…' })]);
  const title = h('div', { class: 'liveTitle absolute left-4 right-4 bottom-3 text-[16px] font-semibold truncate drop-shadow-[0_1px_6px_rgba(0,0,0,0.9)]' });
  const play = h('button', { class: 'liveBtn flex-[1.6] min-h-[50px] rounded-xl bg-brand text-white text-xl grid place-items-center active:scale-[.98] transition-transform', onclick: () => ctl('transport', { cmd: 'toggle' }) });
  const mute = h('button', { class: 'liveBtn flex-1 min-h-[50px] rounded-xl bg-surface-2 border border-line grid place-items-center active:scale-[.98] transition-transform', onclick: () => ctl('transport', { cmd: 'muted', arg: !(st.deck && st.deck.transport.muted) }) });
  refs.title = title; refs.play = play; refs.mute = mute;
  const tbtn = (t, cmd) => h('button', { class: 'liveBtn flex-1 min-h-[50px] rounded-xl bg-surface-2 border border-line grid place-items-center text-lg active:scale-[.98] transition-transform', text: t, onclick: () => ctl('transport', { cmd }) });
  return h('div', { class: 'livecard rounded-2xl overflow-hidden bg-black border border-line' + (st.hasFrame ? ' live' : '') }, [
    h('div', { class: 'relative aspect-video bg-black cursor-zoom-in', onclick: () => toggleLiveFull() }, [
      img, noSig,
      h('span', { class: 'liveBadge absolute top-3 left-3 hidden items-center gap-1.5 text-[10px] font-bold tracking-wider text-white bg-black/50 px-2.5 py-1 rounded-full' },
        [h('i', { class: 'w-1.5 h-1.5 rounded-full bg-bad' }), 'LIVE']),
      h('div', { class: 'absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/75 to-transparent pointer-events-none' }),
      title,
    ]),
    h('div', { class: 'flex gap-2 p-3' }, [tbtn('⏮', 'prev'), play, tbtn('⏭', 'next'), mute]),
  ]);
}
function onLiveFrame(m) {
  if (!m.data) return;
  st.hasFrame = true;
  const url = 'data:image/jpeg;base64,' + m.data;
  st.lastFrameUrl = url;
  document.querySelectorAll('.liveImg').forEach((im) => { im.src = url; im.classList.remove('hidden'); });
  document.querySelectorAll('.liveNo').forEach((n) => n.classList.add('hidden'));
  document.querySelectorAll('.liveBadge').forEach((b) => { b.classList.remove('hidden'); b.classList.add('flex'); });
  const full = $('#liveFull img'); if (full) full.src = url;
}
function toggleLiveFull() {
  let f = $('#liveFull');
  if (f) { f.remove(); return; }
  f = h('div', { id: 'liveFull', class: 'fixed inset-0 z-[100] bg-black/95 flex items-center justify-center cursor-zoom-out', onclick: () => f.remove() },
    [h('img', { class: 'max-w-full max-h-full object-contain', alt: '' }),
      h('div', { class: 'absolute bottom-8 inset-x-0 text-center text-ink-dim text-[13px]', text: 'Tap to close' })]);
  if (st.lastFrameUrl) f.querySelector('img').src = st.lastFrameUrl;
  document.body.append(f);
}

function buildDeck(root) {
  root.textContent = '';
  refs.layers = {};

  const wrap = h('div', { class: 'px-3.5 pt-[4.4rem] safe-pb-nav flex flex-col gap-3' });
  root.append(wrap);

  wrap.append(liveHero());

  // --- effects master
  refs.fxOn = h('button', { class: BTN + ' flex-1', text: 'Effects', onclick: () => ctl('fxEnabled', { on: !st.deck.fx.enabled }) });
  refs.black = h('button', { class: BTN + ' flex-1', text: 'Blackout', onclick: () => ctl('blackout') });
  wrap.append(sec(null, [
    h('div', { class: 'flex gap-2.5' }, [
      refs.fxOn,
      h('button', { class: BTN + ' flex-1 !bg-brand/15 !border-brand/40 !text-brand', text: '✳ Trigger', onclick: () => ctl('triggerAll') }),
      refs.black,
    ]),
  ]));

  // --- outputs & audio
  refs.projBtn = h('button', { class: BTN + ' flex-1', text: 'Projector', onclick: () => ctl('output', { role: 'projector', enabled: !(st.deck.outputs && st.deck.outputs.projector) }) });
  refs.tvBtn = h('button', { class: BTN + ' flex-1', text: 'TV', onclick: () => ctl('output', { role: 'tv', enabled: !(st.deck.outputs && st.deck.outputs.tv) }) });
  refs.audioTarget = h('select', { class: SEL }, [['auto', 'Auto'], ['tv', 'TV'], ['projector', 'Projector'], ['control', 'Mac window'], ['none', 'Muted']].map(([v, t]) => h('option', { value: v, text: t })));
  refs.audioTarget.addEventListener('change', () => ctl('audioTarget', { value: refs.audioTarget.value }));
  refs.audioSink = h('select', { class: SEL });
  refs.audioSink.addEventListener('change', () => { const o = refs.audioSink.selectedOptions[0]; ctl('audioSink', { id: refs.audioSink.value, label: o ? o.textContent : '' }); });
  wrap.append(sec('Output', [
    h('div', { class: 'flex gap-2.5' }, [refs.projBtn, refs.tvBtn]),
    h('div', { class: 'grid grid-cols-[64px_1fr] items-center gap-3' }, [h('label', { class: CX.ctlLabel, text: 'Audio' }), refs.audioTarget]),
    h('div', { class: 'grid grid-cols-[64px_1fr] items-center gap-3' }, [h('label', { class: CX.ctlLabel, text: 'Device' }), refs.audioSink]),
  ]));

  // --- scenes
  wrap.append(sec('Scenes', [
    h('div', { class: 'flex gap-2.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1' }, st.catalog.scenes.map((name) =>
      h('button', { class: 'shrink-0 min-h-[42px] px-4 rounded-xl bg-surface-2 border border-line text-[13.5px] font-medium active:bg-brand active:text-white active:border-transparent transition-colors', text: name, onclick: () => ctl('scene', { name }) }))),
  ]));

  // --- layers
  const layerBox = h('div', { class: 'flex flex-col gap-2.5' });
  refs.layerBox = layerBox;
  const layers = st.deck.fx.layers || [];
  if (!layers.length) layerBox.append(h('div', { class: CX.hint, text: 'No effects yet — add one below or pick a scene.' }));
  for (const L of layers) {
    const on = h('button', { class: 'w-10 h-10 rounded-lg border border-line grid place-items-center text-[15px] shrink-0', text: L.on ? '●' : '○', title: 'Show / hide',
      onclick: () => ctl('layerOn', { id: L.id, on: !refsLayerOn(L.id) }) });
    on._on = () => on;
    const op = slider('', 0, 1, 0.01, () => layerById(L.id).opacity,
      (v) => { ctl('layerOpacity', { id: L.id, value: v }); return Math.round(v * 100) + '%'; });
    const trig = L.actions.length
      ? h('button', { class: 'w-11 h-10 rounded-lg bg-brand/15 border border-brand/40 text-brand grid place-items-center shrink-0', text: '⚡', title: L.actions[0].label, onclick: () => ctl('triggerLayer', { id: L.id }) })
      : null;
    const del = h('button', { class: 'w-10 h-10 rounded-lg border border-bad/30 text-bad grid place-items-center shrink-0', text: '✕', onclick: () => ctl('removeLayer', { id: L.id }) });
    const row = h('div', { class: 'rounded-xl bg-surface-2/60 border border-line p-2.5 flex flex-col gap-2' }, [
      h('div', { class: 'flex items-center gap-2.5' }, [on, h('span', { class: 'flex-1 text-[14.5px] font-medium truncate', text: L.name }), trig, del]),
      op.row,
    ]);
    refs.layers[L.id] = { on, op: op.inp };
    layerBox.append(row);
    if (L.actions.length > 1) {
      layerBox.append(h('div', { class: 'flex flex-wrap gap-2 -mt-0.5' }, L.actions.slice(1).map((a) =>
        h('button', { class: 'flex-1 min-w-[calc(50%-0.5rem)] min-h-[38px] px-2.5 rounded-lg bg-surface-2 border border-line text-[12.5px]', text: a.label, onclick: () => ctl('layerAction', { id: L.id, name: a.name }) }))));
    }
  }
  wrap.append(sec('Layers', [layerBox]));

  // --- add effect + clear
  const sel = h('select', { class: SEL + ' flex-1' }, [h('option', { value: '', text: 'Add an effect…' }),
    ...st.catalog.effects.map((e) => h('option', { value: e.type, text: e.label }))]);
  sel.addEventListener('change', () => { if (sel.value) { ctl('addLayer', { type: sel.value }); sel.value = ''; } });
  wrap.append(sec(null, [h('div', { class: 'flex gap-2.5 items-center' }, [sel, h('button', { class: BTN + ' shrink-0 !text-bad', text: 'Clear', onclick: () => ctl('clearLayers') })])]));

  // --- world + quality
  const grav = slider('Gravity', -2, 4, 0.05, () => st.deck.fx.gravity, (v) => { ctl('world', { key: 'gravity', value: v }); return v.toFixed(2); });
  const wind = slider('Wind', -2, 2, 0.05, () => st.deck.fx.wind, (v) => { ctl('world', { key: 'wind', value: v }); return v.toFixed(2); });
  const time = slider('Time', 0, 3, 0.05, () => st.deck.fx.timeScale, (v) => { ctl('world', { key: 'timeScale', value: v }); return v.toFixed(2) + 'x'; });
  refs.grav = grav.inp; refs.wind = wind.inp; refs.time = time.inp;
  const qsel = h('select', { class: SEL }, st.catalog.qualities.map((q) => h('option', { value: q, text: q[0].toUpperCase() + q.slice(1) })));
  qsel.addEventListener('change', () => ctl('quality', { value: qsel.value }));
  refs.qsel = qsel;
  wrap.append(sec('World', [grav.row, wind.row, time.row,
    h('div', { class: 'grid grid-cols-[64px_1fr] items-center gap-3' }, [h('label', { class: CX.ctlLabel, text: 'Quality' }), qsel])]));
}

function layerById(id) { return (st.deck.fx.layers || []).find((l) => l.id === id) || { opacity: 1, on: true }; }
function refsLayerOn(id) { return layerById(id).on; }

// Refresh values without rebuilding, so a control under the finger is not
// yanked away mid-drag.
function updateDeck() {
  const d = st.deck; if (!d) return;
  const active = document.activeElement;
  const t = d.transport;
  if (refs.title) refs.title.textContent = t.title || (t.has ? '' : 'Nothing loaded');
  if (refs.play) refs.play.textContent = t.playing ? '⏸' : '▶';
  if (refs.mute) refs.mute.textContent = t.muted ? '🔇' : '🔊';
  setActive(refs.fxOn, !!d.fx.enabled);
  setActive(refs.black, !!d.blackout);
  for (const L of d.fx.layers || []) {
    const r = refs.layers[L.id]; if (!r) continue;
    r.on.textContent = L.on ? '●' : '○';
    r.on.classList.toggle('text-brand', L.on); r.on.classList.toggle('text-ink-faint', !L.on);
    if (r.op !== active) { r.op.value = L.opacity; r.op._val.textContent = Math.round(L.opacity * 100) + '%'; fillRange(r.op); }
  }
  const setS = (inp, v) => { if (inp && inp !== active) { inp.value = v; inp._val.textContent = inp._fmt(v); fillRange(inp); } };
  setS(refs.grav, d.fx.gravity); setS(refs.wind, d.fx.wind); setS(refs.time, d.fx.timeScale);
  if (refs.qsel && refs.qsel !== active) refs.qsel.value = d.fx.quality;
  // outputs + audio
  const o = d.outputs || {};
  setActive(refs.projBtn, !!o.projector);
  setActive(refs.tvBtn, !!o.tv);
  const au = d.audio || {};
  if (refs.audioTarget && refs.audioTarget !== active) refs.audioTarget.value = au.target || 'auto';
  if (refs.audioSink && refs.audioSink !== active) {
    const want = JSON.stringify([au.sinkId || '', (au.devices || []).map((x) => x.id)]);
    if (refs.audioSink._key !== want) {
      refs.audioSink._key = want;
      refs.audioSink.innerHTML = '';
      refs.audioSink.append(h('option', { value: '', text: 'System default' }));
      for (const dev of au.devices || []) refs.audioSink.append(h('option', { value: dev.id, text: dev.label }));
    }
    refs.audioSink.value = au.sinkId || '';
  }
}

// ------------------------------------------------------------- queue view ---
let queueShape = '';
function renderQueue() {
  if (st.view !== 'queue') return;
  const root = $('#queue');
  const d = st.deck;
  if (!d) { root.textContent = ''; root.append(h('div', { class: 'pt-[5rem] px-6 text-center ' + CX.hint, text: 'Waiting for the app…' })); return; }
  const q = d.queue || { items: [], index: -1 };
  const shape = JSON.stringify([q.items.map((i) => i.i + i.cur), st.library.map((l) => l.id + l.status), st.libFilter]);
  if (shape === queueShape) { return; }
  queueShape = shape;
  root.innerHTML = '';
  const wrap = h('div', { class: 'px-3.5 pt-[4.4rem] safe-pb-nav flex flex-col gap-3' });
  root.append(wrap);

  // now playing — the live projection preview + transport
  wrap.append(liveHero());
  updateDeck();

  // add from YouTube
  const urlInp = h('input', { type: 'text', placeholder: 'Paste a YouTube link', inputmode: 'url', class: CX.input });
  const addUrl = (toLib) => { const u = urlInp.value.trim(); if (!u) return; ctl(toLib ? 'addLibraryToLibrary' : 'addUrl', { url: u }); urlInp.value = ''; toast(toLib ? 'Downloading to library…' : 'Added to queue'); };
  urlInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') addUrl(false); });
  wrap.append(sec('Add from YouTube', [
    urlInp,
    h('div', { class: 'flex gap-2.5' }, [
      h('button', { class: BTN + ' flex-1 !bg-brand !border-transparent !text-white', text: 'Queue', onclick: () => addUrl(false) }),
      h('button', { class: BTN + ' flex-1', text: 'Save to library', onclick: () => addUrl(true) }),
    ]),
  ]));

  // up next
  const upNext = q.items.filter((i) => !i.cur && i.i > q.index);
  const nextBox = h('div', { class: 'flex flex-col gap-2' });
  if (!upNext.length) nextBox.append(h('div', { class: CX.hint, text: 'Nothing queued.' }));
  for (const it of upNext.slice(0, 40)) nextBox.append(qrow(it.title, it.from + (it.discovered ? ' · auto' : ''), [
    qbtn('▶', 'brand', () => ctl('playIndex', { index: it.i })),
    qbtn('✕', 'bad', () => ctl('removeIndex', { index: it.i })),
  ]));
  const disc = h('button', { class: 'shrink-0 min-h-[34px] px-3 rounded-lg border text-[12.5px] font-semibold ' + (q.autoDiscover ? 'bg-brand border-transparent text-white' : 'bg-surface-2 border-line text-ink'), text: 'Auto-discover', onclick: () => ctl('autoDiscover', { on: !q.autoDiscover }) });
  wrap.append(h('div', { class: 'rounded-2xl bg-surface-1 border border-line p-4 flex flex-col gap-3' }, [
    h('div', { class: 'flex items-center gap-2' }, [h('div', { class: CX.head + ' flex-1', text: 'Up next · ' + upNext.length }), disc]),
    nextBox,
  ]));

  // library browse
  const search = h('input', { type: 'search', placeholder: 'Search library', value: st.libFilter, class: CX.input });
  search.addEventListener('input', () => { st.libFilter = search.value; queueShape = ''; renderLibList(libBox); });
  const libBox = h('div', { class: 'flex flex-col gap-2' });
  renderLibList(libBox);
  wrap.append(sec('From library', [search, libBox]));
}

function qbtn(glyph, tone, onclick) {
  const t = tone === 'brand' ? 'bg-brand/15 border-brand/40 text-brand'
    : tone === 'good' ? 'bg-good/15 border-good/40 text-good' : 'bg-transparent border-bad/30 text-bad';
  return h('button', { class: 'w-11 h-11 shrink-0 rounded-xl border grid place-items-center ' + t, text: glyph, onclick });
}
function qrow(title, badge, buttons) {
  return h('div', { class: 'flex items-center gap-2.5 rounded-xl bg-surface-2/60 border border-line p-2.5' }, [
    h('div', { class: 'flex-1 min-w-0' }, [
      h('div', { class: 'text-[14.5px] font-medium truncate', text: title }),
      h('div', { class: 'text-[11px] text-ink-faint uppercase tracking-wider mt-0.5', text: badge }),
    ]),
    ...buttons,
  ]);
}
function renderLibList(box) {
  box.innerHTML = '';
  const q = st.libFilter.toLowerCase();
  const list = st.library.filter((l) => l.status === 'ready' && (!q || (l.artist + ' ' + l.title).toLowerCase().includes(q)));
  if (!st.library.length) { box.append(h('div', { class: CX.hint, text: 'Library is empty. Add YouTube links above or on the Mac.' })); return; }
  if (!list.length) { box.append(h('div', { class: CX.hint, text: 'No ready matches.' })); return; }
  for (const l of list.slice(0, 80)) box.append(qrow(
    l.artist ? l.artist + ' — ' + l.title : l.title,
    'library' + (l.height ? ' · ' + (l.height >= 2160 ? '4K' : l.height + 'p') : ''),
    [qbtn('▶', 'brand', () => ctl('addLibrary', { id: l.id, play: true })),
      qbtn('＋', 'good', () => { ctl('addLibrary', { id: l.id, play: false }); toast('Queued'); })]));
}

for (const b of document.querySelectorAll('#viewSeg button')) b.addEventListener('click', () => setView(b.dataset.view));

$('#msg').addEventListener('click', () => startCamera());
$('#bCam').onclick = () => (st.stream ? flipCamera() : startCamera());
$('#bAlign').onclick = () => (st.aligning ? leaveAlign(true) : enterAlign());
$('#bTrack').onclick = () => (st.tracking ? stopTracking() : startTracking());
$('#bMore').onclick = () => { $('#sheet').hidden = !$('#sheet').hidden; };
$('#bSheetClose').onclick = () => { $('#sheet').hidden = true; };
$('#bAuto').onclick = () => findMarkers(false);
$('#bAlignCancel').onclick = () => leaveAlign(true);
$('#bAlignDone').onclick = () => finishAlign();
$('#camSel').onchange = (e) => { st.deviceId = e.target.value; startCamera(); };
$('#modelSel').onchange = (e) => { st.modelQ = e.target.value; prefs.set('model', st.modelQ); reloadModel(); };
$('#peopleSel').onchange = (e) => { st.maxPoses = Number(e.target.value); prefs.set('people', st.maxPoses); reloadModel(); };
$('#skelChk').onchange = (e) => { st.skeleton = e.target.checked; prefs.set('skeleton', st.skeleton); };
$('#mirrorChk').onchange = (e) => { st.mirror = e.target.checked; prefs.set('mirror', st.mirror); ui(); };
$('#nameInp').onchange = (e) => { st.name = e.target.value.trim(); prefs.set('name', st.name); send({ t: 'hello', name: st.name || deviceName(), ua: navigator.userAgent }); };
$('#modelSel').value = st.modelQ; $('#peopleSel').value = String(st.maxPoses);
$('#skelChk').checked = st.skeleton; $('#mirrorChk').checked = st.mirror; $('#nameInp').value = st.name;
window.addEventListener('resize', () => { st.lastVT = -1; });

// gradient-fill on range sliders + a light haptic on every button
function fillRange(inp) {
  const min = +inp.min || 0, max = +inp.max || 100;
  const pct = max > min ? ((+inp.value - min) / (max - min)) * 100 : 50;
  inp.style.setProperty('--fill', pct.toFixed(1) + '%');
}
document.addEventListener('input', (e) => { if (e.target && e.target.type === 'range') fillRange(e.target); }, true);
document.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('button')) haptic(6); }, { passive: true });

// installable PWA (works offline enough to launch from the home screen)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

fetch('/info.json', { cache: 'no-store' }).then((r) => r.json()).then((i) => { st.info = i; ui(); }).catch(() => {});
if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  showMsg('No camera access', location.protocol === 'http:' ? 'Open this page over https — the app prints an https address.' : 'This browser does not allow camera access.');
}
connect();
setView(st.view);
requestAnimationFrame(() => positionNavGlow());
setTimeout(positionNavGlow, 300);
ui();
requestAnimationFrame(loop);
