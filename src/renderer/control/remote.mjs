// Phones as cameras. The app serves a page on the LAN (main/remote.js); a phone
// opens it, runs pose tracking on its own camera and streams landmarks back.
// This module owns the desktop half: the panel with the address and QR code,
// the alignment (four marker centres tapped on the phone → camera-to-output
// homography, persisted in settings) and the PoseTracker that turns each
// tracked body into the interactors the effects already understand.

import * as M from '/shared/mat3.mjs';
import { PARTS, BONES, LM, PERSON_COLORS, unpackPose } from '/shared/pose.mjs';
import { MARKERS } from '/renderer/control/camera.mjs';
import { drawQR } from '/renderer/control/qr.mjs';

const VIS_MIN = 0.45;         // landmark visibility below this is ignored
const STALE_MS = 600;         // no packet for this long → people fade out
const TORSO_REF = 0.17;       // torso length (output-normalized) of a "unit" person

export class PoseTracker {
  constructor() {
    this.H = null;              // camera-normalized -> output-normalized
    this.calibW = 0; this.calibH = 0;
    this.people = [];           // [{ pts: [[x,y,vis,vx,vy]...33], cx, cy, scale, ts }]
    this.lastTs = 0;            // phone clock of the last packet
    this.at = 0;                // our clock of the last packet
    this.warn = null;
    this.packets = 0;
  }

  setCalib(c) {
    if (!c || !c.H) { this.H = null; return; }
    this.H = Float64Array.from(c.H);
    this.calibW = c.w || 0; this.calibH = c.h || 0;
  }

  get calibrated() { return !!this.H; }
  get live() { return this.people.length > 0 && performance.now() - this.at < STALE_MS; }

  /** Take a `pose` packet from the phone. */
  feed(msg) {
    if (!this.H) return;
    const now = performance.now();
    const dt = this.lastTs ? Math.min(0.25, Math.max(0.016, (msg.ts - this.lastTs) / 1000)) : 0.05;
    this.lastTs = msg.ts; this.at = now; this.packets++;

    // a rotated phone changes what "camera-normalized" means
    if (this.calibW && msg.w && msg.h) {
      const a = this.calibW / this.calibH, b = msg.w / msg.h;
      this.warn = Math.abs(a - b) > 0.05 ? 'The phone camera changed orientation since it was aligned — align again.' : null;
    }

    const H = this.H;
    const found = [];
    for (const raw of msg.poses || []) {
      const lm = unpackPose(raw);
      const pts = new Array(lm.length);
      let sx = 0, sy = 0, n = 0;
      for (let i = 0; i < lm.length; i++) {
        const [u, v, vis] = lm[i];
        if (vis < VIS_MIN) { pts[i] = null; continue; }
        const p = M.apply(H, u, v);
        if (!isFinite(p[0]) || !isFinite(p[1]) || p[0] < -0.3 || p[0] > 1.3 || p[1] < -0.3 || p[1] > 1.3) { pts[i] = null; continue; }
        pts[i] = [p[0], p[1], vis, 0, 0];
        if (i === LM.leftShoulder || i === LM.rightShoulder || i === LM.leftHip || i === LM.rightHip) { sx += p[0]; sy += p[1]; n++; }
      }
      if (!n) { for (const p of pts) if (p) { sx += p[0]; sy += p[1]; n++; } }
      if (!n) continue;
      found.push({ pts, cx: sx / n, cy: sy / n, scale: bodyScale(pts), ts: now });
    }

    // match to last frame's people (nearest centroid) to carry velocities over
    const prev = this.people.slice();
    for (const f of found) {
      let best = 0.2 * 0.2, match = null, mi = -1;
      prev.forEach((p, i) => {
        const dx = p.cx - f.cx, dy = p.cy - f.cy, d2 = dx * dx + dy * dy;
        if (d2 < best) { best = d2; match = p; mi = i; }
      });
      if (match) {
        prev.splice(mi, 1);
        f.color = match.color;
        for (let i = 0; i < f.pts.length; i++) {
          const a = f.pts[i], b = match.pts[i];
          if (!a || !b) continue;
          const vx = (a[0] - b[0]) / dt, vy = (a[1] - b[1]) / dt;
          a[3] = clampV(b[3] * 0.5 + vx * 0.5);
          a[4] = clampV(b[4] * 0.5 + vy * 0.5);
        }
      }
    }
    // hand out colours that are not in use
    const used = new Set(found.map((f) => f.color).filter((c) => c != null));
    for (const f of found) if (f.color == null) { for (let c = 0; c < 32; c++) if (!used.has(c)) { f.color = c; used.add(c); break; } }
    this.people = found;
  }

  /**
   * The bodies as interactors, in world units (x 0..1, y 0..aspect).
   * @param {object} o { aspect, radius, strength, parts: 'hands'|'arms'|'body' }
   */
  interactors(o) {
    if (!this.live) return [];
    const list = PARTS[o.parts] || PARTS.body;
    const aspect = o.aspect, base = o.radius || 0.07, gain = o.strength == null ? 1 : o.strength;
    const out = [];
    const push = (p, r, s) => out.push({
      x: p[0], y: p[1] * aspect, vx: p[3], vy: p[4] * aspect,
      r, strength: s, down: false, source: 'phone',
    });
    for (const person of this.people) {
      const pts = person.pts, sc = person.scale;
      for (const part of list) {
        if (Array.isArray(part)) {
          const p = pts[part[0]];
          if (p) push(p, base * part[1] * sc, gain * part[2]);
        } else if (part.seg) {
          const a = pts[part.seg[0]], b = pts[part.seg[1]];
          if (!a || !b) { if (a || b) push(a || b, base * part.radiusScale * sc, gain * part.strength); continue; }
          // a limb is a chain of circles, close enough together to leave no gap
          const len = Math.hypot(b[0] - a[0], (b[1] - a[1]) * aspect);
          const r = base * part.radiusScale * sc;
          const n = Math.max(2, Math.min(6, Math.ceil(len / (r * 0.9)) + 1));
          for (let k = 0; k < n; k++) {
            const t = k / (n - 1);
            push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 1,
              a[3] + (b[3] - a[3]) * t, a[4] + (b[4] - a[4]) * t], r, gain * part.strength);
          }
        } else if (part.torso) {
          const s = mid(pts[LM.leftShoulder], pts[LM.rightShoulder]), h = mid(pts[LM.leftHip], pts[LM.rightHip]);
          if (s && h) {
            for (const t of [0.15, 0.5, 0.85]) {
              push([s[0] + (h[0] - s[0]) * t, s[1] + (h[1] - s[1]) * t, 1, s[3] + (h[3] - s[3]) * t, s[4] + (h[4] - s[4]) * t],
                base * part.radiusScale * sc, gain * part.strength);
            }
          } else if (s || h) push(s || h, base * part.radiusScale * sc, gain * part.strength);
        }
      }
    }
    return out;
  }

  /** Skeletons in output space, for the stage overlay. */
  drawDebugOver(ctx, w, h, aspect, inter) {
    if (!this.live) return;
    for (const person of this.people) {
      const col = PERSON_COLORS[(person.color || 0) % PERSON_COLORS.length];
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath();
      for (const [a, b] of BONES) {
        const A = person.pts[a], B = person.pts[b];
        if (!A || !B) continue;
        ctx.moveTo(A[0] * w, A[1] * h); ctx.lineTo(B[0] * w, B[1] * h);
      }
      ctx.stroke();
      const nose = person.pts[LM.nose];
      if (nose) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(nose[0] * w, nose[1] * h, 5, 0, Math.PI * 2); ctx.fill(); }
    }
    if (inter) {
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1;
      for (const it of inter) {
        if (it.source !== 'phone') continue;
        ctx.beginPath(); ctx.arc(it.x * w, (it.y / aspect) * h, Math.max(2, it.r * w), 0, Math.PI * 2); ctx.stroke();
      }
    }
  }
}

const clampV = (v) => Math.max(-4, Math.min(4, v));
function mid(a, b) {
  if (!a || !b) return a || b || null;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 1, (a[3] + b[3]) / 2, (a[4] + b[4]) / 2];
}
/** How big this person looks on the wall, relative to a typical one. */
function bodyScale(pts) {
  const s = mid(pts[LM.leftShoulder], pts[LM.rightShoulder]), h = mid(pts[LM.leftHip], pts[LM.rightHip]);
  if (s && h) return Math.max(0.5, Math.min(2.2, Math.hypot(h[0] - s[0], h[1] - s[1]) / TORSO_REF));
  const l = pts[LM.leftShoulder], r = pts[LM.rightShoulder];
  if (l && r) return Math.max(0.5, Math.min(2.2, Math.hypot(r[0] - l[0], r[1] - l[1]) / (TORSO_REF * 0.8)));
  return 1;
}

// ------------------------------------------------------------------ panel --
export class RemotePanel {
  /**
   * @param els { status, toggle, align, clear, qrWrap, qr, url, clients, hint }
   * @param hooks { toast, setPattern, settings, patchSettings, aspect, fx }
   */
  constructor(els, hooks) {
    this.els = els; this.hooks = hooks;
    this.tracker = new PoseTracker();
    this.info = { running: false, urls: [], clients: [] };
    this.qrFor = '';
    this.cfgKey = '';
    this.aligningId = null;

    els.toggle.onclick = () => (this.info.running ? api.remoteStop() : this.start());
    els.align.onclick = () => this.beginAlign();
    els.clear.onclick = () => this.clearAlign();
    els.url.onclick = () => {
      const u = this.primaryUrl();
      if (!u) return;
      navigator.clipboard?.writeText(u).then(() => hooks.toast('Address copied'), () => {});
    };
    api.onRemoteMsg(({ id, msg }) => this.onMsg(id, msg));
  }

  async start() {
    const info = await api.remoteStart();
    if (info && info.error) this.hooks.toast(info.error, 5000);
  }

  primaryUrl() { return (this.info.urls && this.info.urls[0]) || ''; }

  /** Called with every state broadcast. */
  applyState(S) {
    this.info = S.remote || this.info;
    const calib = S.settings && S.settings.remoteCalib;
    const key = calib ? JSON.stringify(calib.H) : '';
    if (key !== this.calibKey) { this.calibKey = key; this.tracker.setCalib(calib); }
    this.render();
  }

  render() {
    const e = this.els, i = this.info;
    const phones = i.clients || [];
    const tracking = phones.filter((c) => c.tracking).length;
    e.status.textContent = !i.running ? 'Off' : phones.length ? `${phones.length} phone${phones.length === 1 ? '' : 's'}` : 'Waiting';
    e.status.style.color = i.running && phones.length ? 'var(--ok)' : '';
    e.toggle.textContent = i.running ? 'Stop sharing' : 'Share on Wi-Fi';
    e.toggle.classList.toggle('on', !!i.running);
    e.align.disabled = !phones.length;
    e.clear.hidden = !this.tracker.calibrated;
    e.qrWrap.hidden = !i.running;
    const url = this.primaryUrl();
    if (i.running && url && url !== this.qrFor) {
      this.qrFor = url;
      try { drawQR(e.qr, url, { px: 3, fg: '#000', bg: '#fff' }); } catch (err) { console.warn('qr', err); }
      e.url.textContent = url.replace(/^https?:\/\//, '');
      e.url.title = url + ' — click to copy';
    }
    if (i.running) {
      const who = phones.map((c) => (c.name || c.ua) + (c.tracking ? ' · tracking' : '')).join(', ');
      e.clients.textContent = who || (i.secure ? 'Scan the code with the phone, accept the certificate warning once.' : 'Served over http: phones will not open their camera.');
    }
    let hint;
    if (i.error && i.running) hint = i.error;
    else if (!i.running) hint = 'Turn this on and open the address on a phone on the same Wi-Fi. The phone runs the body tracker itself and only sends where people are.';
    else if (!this.tracker.calibrated) hint = phones.length ? 'Point the phone at the wall so the whole projection is in frame, then press Align.' : '';
    else if (this.tracker.warn) hint = this.tracker.warn;
    else if (!tracking) hint = 'Aligned. Press Track on the phone.';
    else {
      const fx = this.hooks.fx();
      const pushing = !!(fx && fx.enabled && fx.interact && fx.interact.camera);
      const n = this.tracker.people.length;
      hint = `Tracking${n ? ' ' + n + (n === 1 ? ' person' : ' people') : ' — nobody in view'}. `
        + (pushing ? 'They push the effects.' : 'Turn on Effects and "People push things" to let them push.');
    }
    e.hint.textContent = hint;
    e.hint.style.color = (i.error && i.running) || this.tracker.warn ? 'var(--warn)' : '';
  }

  // ------------------------------------------------------------ messages
  onMsg(id, msg) {
    switch (msg.t) {
      case 'hello': this.sendConfig(id); api.remoteSend(id, this.catalogMsg()); api.remoteSend(id, this.deckMsg()); break;
      case 'pattern': this.hooks.setPattern(msg.kind === 'corners' ? 'corners' : 'off'); break;
      case 'calib': this.solve(id, msg); break;
      case 'pose': this.tracker.feed(msg); break;
      case 'deckSub': api.remoteSend(id, this.catalogMsg()); api.remoteSend(id, this.deckMsg(true)); break;
      case 'ctl': if (this.hooks.control) this.hooks.control(msg.op, msg); break;
      case 'pixelate': if (this.hooks.pixelate) this.hooks.pixelate(id, msg); break;
      case 'close': if (this.aligningId === id) { this.aligningId = null; this.hooks.setPattern('off'); } break;
    }
  }

  beginAlign() {
    const phones = this.info.clients || [];
    if (!phones.length) { this.hooks.toast('No phone connected'); return; }
    // one phone: tell it to go into align mode; several: they all get the
    // request and the operator picks up whichever is on the tripod
    api.remoteSend(null, { t: 'align' });
    this.hooks.toast('Look at the phone: drag its four handles onto the coloured squares');
  }

  clearAlign() {
    this.hooks.patchSettings({ remoteCalib: null });
    this.tracker.setCalib(null);
    this.calibKey = '';
    this.render();
    this.pushConfig(true);
  }

  solve(id, msg) {
    const pts = msg.pts;
    if (!pts || pts.length !== 4) return;
    let H;
    try {
      const src = M.squareToQuad(pts[0], pts[1], pts[2], pts[3]);
      const dst = M.squareToQuad(MARKERS[0], MARKERS[1], MARKERS[2], MARKERS[3]);
      H = M.mul(dst, M.invert(src));
    } catch { H = null; }
    if (!H || [...H].some((v) => !isFinite(v))) {
      api.remoteSend(id, { t: 'toast', text: 'Those four points do not make a quadrilateral — try again.' });
      return;
    }
    const calib = { pts, w: msg.w, h: msg.h, facing: msg.facing || null, H: Array.from(H), at: Date.now() };
    this.hooks.patchSettings({ remoteCalib: calib });
    this.tracker.setCalib(calib);
    this.calibKey = JSON.stringify(calib.H);
    this.hooks.setPattern('off');
    api.remoteSend(id, { t: 'calibOk' });
    this.hooks.toast('Phone aligned to the wall');
    this.render();
    this.pushConfig(true);
  }

  config() {
    const fx = this.hooks.fx();
    return {
      t: 'config', aspect: this.hooks.aspect(), calibrated: this.tracker.calibrated,
      enabled: !!(fx && fx.enabled && fx.interact && fx.interact.camera),
      parts: (fx && fx.interact && fx.interact.phoneParts) || 'body',
    };
  }
  sendConfig(id) { api.remoteSend(id, this.config()); }

  catalogMsg() { return { t: 'catalog', ...(this.hooks.catalog ? this.hooks.catalog() : {}) }; }
  deckMsg(force) { return { t: 'deck', ...(this.hooks.deck ? this.hooks.deck() : {}) }; }

  setLibrarySub(on) { this.librarySub = !!on; }
  /** Send a compact library list to phones that opened the queue tab. */
  sendLibrary(items) {
    if (!this.librarySub || !this.info.running || !(this.info.clients || []).length) return;
    const lib = (items || []).map((e) => ({
      id: e.id, artist: e.artist || '', title: e.title || '', duration: e.duration || 0,
      status: e.status, height: e.height || 0,
    }));
    api.remoteSend(null, { t: 'library', items: lib });
  }

  /** Once per frame: keep the phones told about what changed. */
  pushConfig(force) {
    if (!this.info.running || !(this.info.clients || []).length) return;
    const c = this.config();
    const key = JSON.stringify(c);
    if (!force && key === this.cfgKey) return;
    this.cfgKey = key;
    api.remoteSend(null, c);
  }

  /** Broadcast the effects/transport deck to phones, only when it changes. */
  pushDeck(force) {
    if (!this.info.running || !(this.info.clients || []).length || !this.hooks.deck) return;
    const d = this.deckMsg();
    const key = JSON.stringify(d);
    if (!force && key === this.deckKey) return;
    this.deckKey = key;
    api.remoteSend(null, d);
  }

  frame() {
    this.pushConfig(false);
    this.pushDeck(false);
    // the hint line follows the tracker without waiting for a state push
    if (this.info.running && (performance.now() - (this._hintAt || 0)) > 500) { this._hintAt = performance.now(); this.render(); }
  }

  get ready() { return this.info.running && this.tracker.calibrated; }
}
