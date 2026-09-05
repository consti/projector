// The pixel people: everyone who took a selfie on the phone, dropped into the
// room. They fall out of the sky — screaming, tumbling, shot in from the side
// or spun in through a time warp — bounce, land on
// the masked shapes and the floor, wander along ledges, turn at the edges (or
// forget to and fall off), sit down when it is quiet, dance when there is a
// beat, and get knocked flying by a hand. Sprite sheets follow the pixel-it
// contract: 4x2 cells — idle, idle, walk x4, panic, sit — facing right, and
// below it a second 4x2 sheet of eight dance moves drawn from the first.
//
// The roster comes in through the world (`w.characters`, set by the host from
// the app state); a character that appears in the list falls in, one that
// leaves it walks off.

import { prog, bindTex, BLEND } from '../glu.mjs';
import { SpriteBatch, SPRITE_VS } from '../particles.mjs';
import { R, B, S } from './common.mjs';

const IDLE = [0, 1], WALK = [2, 3, 4, 5], PANIC = 6, SIT = 7;   // the 4x2 base sheet
const DANCE = [8, 9, 10, 11, 12, 13, 14, 15];                    // a second 4x2 sheet of moves, below it (4x4 in all)

const FS = `#version 300 es
precision highp float;
#include <common>
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec2 vUV; in vec2 vCenter;
out vec4 o;
uniform sampler2D uSheet;
uniform float uOpacity;
uniform float uCols;        // sheet columns
uniform float uRows;        // sheet rows (2, or 4 with the dance sheet)
uniform float uCellAspect;  // cell width / height
void main(){
  // the quad is a square of side 2; the cell is narrower than tall
  vec2 q = vLocal;
  float flip = vAttr.w > 0.5 ? -1.0 : 1.0;      // face left by mirroring
  q.x *= flip;
  vec2 f = vec2(q.x / uCellAspect, q.y) * 0.5 + 0.5;    // cell uv (the quad's y runs down the screen, like the image)
  if (f.x < 0.0 || f.x > 1.0 || f.y < 0.0 || f.y > 1.0) discard;
  float fr = floor(vAttr.z * 16.0 + 0.5);
  vec2 cell = vec2(mod(fr, uCols), floor(fr / uCols));
  vec2 uv = (cell + f) / vec2(uCols, uRows);
  vec4 c = texture(uSheet, uv);
  if (c.a < 0.2) discard;
  vec3 rgb = c.rgb * vCol.rgb;
  float a = vCol.a * uOpacity;
  o = vec4(rgb * a, a);
}`;

const WARP_FS = `#version 300 es
precision highp float;
#include <common>
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec2 vUV; in vec2 vCenter;
out vec4 o;
uniform float uOpacity;
void main(){
  float r = length(vLocal);
  float ang = atan(vLocal.y, vLocal.x);
  // a broken ring with a spiral twist
  float ring = 1.0 - smoothstep(0.06, 0.14, abs(r - 0.8));
  float gaps = 0.5 + 0.5 * sin(ang * 3.0 + r * 12.0);
  float a = ring * smoothstep(0.2, 0.7, gaps) * vCol.a * uOpacity;
  if (a < 0.02) discard;
  o = vec4(vCol.rgb * a, a);
}`;

const SHADOW_FS = `#version 300 es
precision highp float;
#include <common>
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec2 vUV; in vec2 vCenter;
out vec4 o;
uniform float uOpacity;
void main(){
  float r = length(vLocal * vec2(1.0, 3.0));
  float a = (1.0 - smoothstep(0.5, 1.0, r)) * vCol.a * uOpacity;
  o = vec4(0.0, 0.0, 0.0, a);
}`;

const TAG_FS = `#version 300 es
precision highp float;
#include <common>
in vec2 vLocal; in vec4 vCol; in vec4 vAttr; in vec2 vUV; in vec2 vCenter;
out vec4 o;
uniform sampler2D uTag;
uniform float uOpacity;
uniform float uTagAspect;
void main(){
  // the quad is square; the tag is a strip uTagAspect times wider than tall across its middle
  vec2 f = vec2(vLocal.x * 0.5 + 0.5, vLocal.y * uTagAspect * 0.5 + 0.5);
  if (f.x < 0.0 || f.x > 1.0 || f.y < 0.0 || f.y > 1.0) discard;
  vec4 c = texture(uTag, f);
  float a = c.a * vCol.a * uOpacity;
  o = vec4(c.rgb * a, a);
}`;

const G = 1.6;            // fall, in widths/s²
const WALK_VX = 0.055;    // walk speed
const STEP = 0.02;        // a step this high is still the ground
const CLIMB = 0.06;       // clamber up onto a ledge this high
const DROP = 0.02;        // ground fell this far below the feet → airborne

export const people = {
  type: 'people',
  label: 'Pixel people',
  group: 'People',
  blend: 'over',
  hint: 'Everyone who pixelated themselves on the phone tumbles into the room screaming, bounces, lands on your shapes, wanders the ledges, dances to the beat and gets knocked flying by a hand. Manage the roster in People.',
  actions: [{ name: 'drop', label: 'Drop them again' }, { name: 'dance', label: 'Everybody dance' }, { name: 'sit', label: 'Sit down' }],
  params: [
    R('size', 'Height', 0.13, 0.05, 0.3, 0.005),
    S('entrance', 'Arrive by', 'random', [['random', 'Any which way'], ['scream', 'Screaming fall'], ['tumble', 'Tumbling'], ['cannon', 'Shot in from the side'], ['warp', 'Through a time warp']]),
    R('dance', 'Dance on the beat', 1, 0, 1),
    R('wander', 'Wander', 0.6, 0, 1),
    R('clumsy', 'Fall off ledges', 0.3, 0, 1),
    B('names', 'Name tags', true),
    R('knock', 'Hands knock them', 1, 0, 2),
    B('shadow', 'Ground shadow', true),
  ],

  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const pr = prog(gl, SPRITE_VS, FS);
    const prTag = prog(gl, SPRITE_VS, TAG_FS);
    const prShadow = prog(gl, SPRITE_VS, SHADOW_FS);
    const prWarp = prog(gl, SPRITE_VS, WARP_FS);
    const batch = new SpriteBatch(gl, 8);
    const sheets = new Map();          // id -> { tex, ready, img, tag, tagAspect, name }
    const folk = new Map();            // id -> person state
    let seen = '';
    let lastBeat = 0, danceAll = 0, tglobal = 0;

    const mkTex = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
      return t;
    };
    const upload = (tex, img, flipY = false) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    };
    const nameTag = (name) => {
      const cv = document.createElement('canvas');
      cv.width = 512; cv.height = 128;
      const x = cv.getContext('2d');
      x.font = '700 64px "SF Mono",Menlo,monospace';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      const w = Math.min(500, x.measureText(name).width + 40);
      x.fillStyle = 'rgba(0,0,0,.8)';
      x.beginPath(); x.roundRect(256 - w / 2, 16, w, 96, 10); x.fill();
      x.fillStyle = '#fff';
      x.fillText(name, 256, 66, 460);
      return cv;
    };
    const ensureSheet = (c) => {
      let s = sheets.get(c.id);
      if (s && s.url === c.url && s.name === c.name) return s;
      if (!s) { s = { tex: mkTex(), tag: mkTex(), ready: false }; sheets.set(c.id, s); }
      s.url = c.url; s.name = c.name;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { upload(s.tex, img); s.ready = true; };
      img.onerror = () => { s.ready = false; };
      img.src = c.url;
      upload(s.tag, nameTag(c.name || '?'));
      return s;
    };

    // ---- terrain from the distance field: where is the ground under x, at or below y?
    const groundBelow = (w, x, y, maxDrop = 0.6) => {
      const f = w.field;
      let yy = y;
      for (let i = 0; i < 160; i++) {
        yy += 0.004;
        if (yy > w.aspect - 0.002) return w.aspect;              // the floor (frame wall)
        if (yy > y + maxDrop) return null;
        if (f.sample(x, yy) < 0) return yy;
      }
      return null;
    };
    const solidAt = (w, x, y) => w.field.sample(x, y) < 0;

    const spawn = (c, p, w, how) => {
      const kinds = ['scream', 'tumble', 'cannon', 'warp'];
      const kind = how === 'random' ? kinds[Math.floor(rng.next() * kinds.length)] : how;
      const fromLeft = rng.next() < 0.5;
      const b = {
        id: c.id, cols: c.cols || 4, rows: c.rows || 2, x: rng.range(0.1, 0.9), y: -0.05 - rng.next() * 0.2, vx: rng.range(-0.02, 0.02), vy: 0,
        state: 'scream', tumble: kind === 'tumble' ? (rng.next() < 0.5 ? -1 : 1) * rng.range(6, 12) : 0,
        t: 0, dir: rng.next() < 0.5 ? -1 : 1, bounces: 0,
        frame: IDLE[0], anim: 0, spin: 0, tagT: 0, hue: rng.next(), squash: 0, mood: rng.next(),
      };
      if (kind === 'cannon') { b.x = fromLeft ? -0.05 : 1.05; b.y = rng.range(0.05, 0.3); b.vx = (fromLeft ? 1 : -1) * rng.range(0.35, 0.55); b.vy = -0.15; b.tumble = (fromLeft ? 1 : -1) * 10; }
      if (kind === 'warp') { b.state = 'warp'; b.y = rng.range(0.08, 0.3); b.vx = 0; b.warp = 0; }
      folk.set(c.id, b);
    };

    const think = (b, p, w, dt) => {
      // idle: after a while, walk, sit or dance
      if (b.state === 'idle') {
        b.t += dt;
        const beat = w.audio && w.audio.live && (w.audio.level || 0) > 0.25 && p.dance > 0;
        if ((beat && rng.next() < dt * 0.6 * p.dance) || danceAll > 0) { b.state = 'dance'; b.t = 0; return; }
        if (b.t > rng.range(1.5, 4) && rng.next() < p.wander) { b.state = 'walk'; b.dir = rng.next() < 0.5 ? -1 : 1; b.t = 0; return; }
        if (b.t > 8 && rng.next() < 0.2) { b.state = 'sit'; b.t = 0; }
      }
    };

    const update = (b, p, w, dt) => {
      const h = p.size;                    // character height in width units
      b.tagT += dt;
      // ---- a time warp: spun in from nothing, then dropped
      if (b.state === 'warp') {
        b.warp += dt / 1.6;
        b.spin += dt * 22 * (1.2 - b.warp);
        b.frame = PANIC;
        if (b.warp >= 1) { b.state = 'scream'; b.spin = 0; b.vy = 0; b.vx = rng.range(-0.05, 0.05); b.warp = 0; }
        return;
      }
      // ---- airborne
      if (b.state === 'scream' || b.state === 'knocked') {
        b.vy += G * dt;
        b.x += b.vx * dt;
        // screaming falls flail upright; tumbles and knocks spin
        b.spin += dt * (b.tumble || (b.state === 'knocked' ? 9 * (b.vx >= 0 ? 1 : -1) : Math.sin(tglobal * 9 + b.hue * 6) * 2.5));
        b.y += b.vy * dt;
        b.frame = PANIC;
        if (b.x < 0.02 || b.x > 0.98) { b.x = Math.max(0.02, Math.min(0.98, b.x)); b.vx = -b.vx * 0.5; }
        // landing: the feet reach solid ground (or the floor); a hard landing bounces first
        const g = groundBelow(w, b.x, b.y - 0.01, 0.03);
        if (g != null && b.vy > 0) {
          if (b.vy > 0.5 && b.bounces < 2) {
            b.y = g - 0.002; b.vy = -b.vy * 0.35; b.vx *= 0.6; b.bounces++;
            b.squash = 1; b.spin = 0;
            return;
          }
          const hard = b.vy > 0.3;
          b.y = g; b.vy = 0; b.spin = 0; b.tumble = 0; b.bounces = 0;
          b.state = hard ? 'splat' : 'idle';
          b.squash = hard ? 1 : 0.4;
          b.t = 0; b.tagT = 0;
          if (b.state === 'idle') b.vx = 0;
        }
        if (b.y > w.aspect + 0.4) { b.y = -0.2; b.vy = 0; b.spin = 0; b.x = rng.range(0.1, 0.9); }   // fell out of the world: back in from the top
        return;
      }
      // ---- on the ground: does it still hold?
      const under = groundBelow(w, b.x, b.y - 0.006, 0.05);
      if (under == null || under > b.y + DROP) {
        b.state = 'scream'; b.vy = 0.05; b.vx = b.dir * 0.05; b.t = 0; return;
      }
      b.y = under;
      b.squash = Math.max(0, b.squash - dt * 3);
      switch (b.state) {
        case 'splat': b.t += dt; b.frame = SIT; if (b.t > 1.6) { b.state = 'idle'; b.t = 0; } break;
        case 'idle': b.frame = IDLE[Math.floor(tglobal * 1.5 + b.hue * 4) % 2]; think(b, p, w, dt); break;
        case 'sit': b.frame = SIT; b.t += dt; if (b.t > rng.range(6, 14) || danceAll > 0) { b.state = 'idle'; b.t = 0; } break;
        case 'dance': {
          b.t += dt;
          const beat = w.audio && w.audio.live ? (w.audio.beat || 0) : 0.5 + 0.5 * Math.sin(tglobal * 6);
          const ph = w.audio && w.audio.live ? (w.audio.phase || 0) : (tglobal * 2) % 1;
          if (b.rows >= 4) {
            // a routine: pairs of moves alternate on the beat, the routine changes every few bars
            const move = Math.floor(b.t / 4 + b.hue * 4) % 4;
            const pairs = [[0, 1], [2, 3], [4, 5], [6, 7]];
            const pr_ = pairs[move];
            b.frame = DANCE[ph < 0.5 ? pr_[0] : pr_[1]];
            if (beat > 0.75 && ph < 0.15) b.frame = DANCE[2];        // the jump lands on the strongest beats
          } else b.frame = ph < 0.5 ? WALK[1] : WALK[3];
          b.squash = Math.max(b.squash, beat * 0.5);
          if (beat > 0.6 && Math.floor(tglobal * 4) !== lastBeat) b.dir = -b.dir;
          const on = danceAll > 0 || (w.audio && w.audio.live && (w.audio.level || 0) > 0.15);
          if (!on || (b.t > 12 && rng.next() < dt * 0.3)) { b.state = 'idle'; b.t = 0; }
          break;
        }
        case 'walk': {
          b.t += dt;
          b.anim += dt * 7;
          b.frame = WALK[Math.floor(b.anim) % 4];
          const nx = b.x + b.dir * WALK_VX * dt;
          // look one step ahead: a wall, a ledge to climb, an edge to turn at or fall off
          const ahead = nx + b.dir * h * 0.25;
          if (ahead < 0.02 || ahead > 0.98 || solidAt(w, ahead, b.y - h * 0.5)) { b.dir = -b.dir; break; }
          const gAhead = groundBelow(w, ahead, b.y - CLIMB - 0.004, CLIMB + 0.3);
          if (gAhead == null || gAhead > b.y + STEP) {
            // an edge: usually turn, sometimes step off it (whoops)
            if (rng.next() < p.clumsy * 0.5) { b.x = nx; b.state = 'scream'; b.vy = 0.02; b.vx = b.dir * 0.06; b.t = 0; }
            else b.dir = -b.dir;
            break;
          }
          if (gAhead < b.y - STEP) { b.y = gAhead; }        // clamber up a small ledge
          b.x = nx;
          if (b.t > rng.range(3, 9) && rng.next() < dt * 0.5) { b.state = 'idle'; b.t = 0; }
          break;
        }
      }
      // hands knock them flying
      if (p.knock > 0) for (const it of w.interactors) {
        const dx = b.x - it.x, dy = (b.y - h * 0.5) - it.y;
        const r = (it.r || 0.06) + h * 0.35;
        const speed = Math.hypot(it.vx || 0, it.vy || 0);
        if (dx * dx + dy * dy < r * r && speed > 0.15) {
          b.state = 'knocked'; b.t = 0;
          b.vx = (it.vx || 0) * 0.6 * p.knock + dx * 2; b.vy = -Math.max(0.3, speed * 0.5) * p.knock;
          b.y -= 0.01;
        }
      }
    };

    return {
      folk, sheets,
      resize() {},
      onWorldChanged() { /* the ground may have moved; the next update sorts it out */ },
      action(name, arg, w, p) {
        if (name === 'drop') { for (const [id, b] of folk) { const c = (w.characters || []).find((x) => x.id === id); if (c) spawn(c, p, w, p.entrance); } }
        if (name === 'dance') danceAll = 12;
        if (name === 'sit') for (const b of folk.values()) if (b.state === 'idle' || b.state === 'walk' || b.state === 'dance') { b.state = 'sit'; b.t = 0; }
      },
      step(dt, w, p) {
        tglobal += dt;
        danceAll = Math.max(0, danceAll - dt);
        const list = w.characters || [];
        const key = list.map((c) => c.id + ':' + c.url).join(',');
        if (key !== seen) {
          seen = key;
          for (const c of list) { ensureSheet(c); if (!folk.has(c.id)) spawn(c, p, w, p.entrance); }
          for (const id of [...folk.keys()]) if (!list.some((c) => c.id === id)) folk.delete(id);
          for (const id of [...sheets.keys()]) if (!list.some((c) => c.id === id)) { const s = sheets.get(id); gl.deleteTexture(s.tex); gl.deleteTexture(s.tag); sheets.delete(id); }
        }
        for (const b of folk.values()) update(b, p, w, dt);
        lastBeat = Math.floor(tglobal * 4);
      },
      draw(c) {
        const p = c.params;
        if (!folk.size) return;
        const h = p.size;
        c.dst.bind();
        BLEND.over(gl);
        const order = [...folk.values()].sort((a, b) => a.y - b.y);    // further down draws in front
        for (const b of order) {
          const s = sheets.get(b.id);
          if (!s || !s.ready) continue;
          const airborne = b.state === 'scream' || b.state === 'knocked' || b.state === 'warp';
          const cols = b.cols || 4;
          const warpScale = b.state === 'warp' ? Math.max(0.02, Math.min(1, b.warp * 1.15)) : 1;
          const sy = (1 - b.squash * 0.25) * warpScale, sx = (1 + b.squash * 0.2) * warpScale;
          // the sprite quad: a square of half-size h/2 centred at the middle of the body
          const cy = b.y - h * 0.5 * sy;
          // a ground shadow
          if (p.shadow && !airborne) {
            batch.fillFrom(1, (i, d, o) => { d[o] = b.x; d[o + 1] = b.y; d[o + 2] = 0; d[o + 3] = 0; d[o + 4] = 0; d[o + 5] = 0.5; d[o + 6] = h * 0.3; d[o + 7] = 0; d[o + 8] = 0; d[o + 9] = 0; });
            prShadow.use();
            gl.uniform1f(prShadow.u.uAspect, c.aspect);
            gl.uniform1f(prShadow.u.uSizeScale, 1);
            gl.uniform1f(prShadow.u.uOpacity, c.opacity);
            batch.draw(prShadow);
          }
          batch.fillFrom(1, (i, d, o) => {
            d[o] = b.x; d[o + 1] = cy;
            d[o + 2] = 1; d[o + 3] = 1; d[o + 4] = 1; d[o + 5] = 1;
            d[o + 6] = h * 0.5 * (b.state === 'knocked' ? 1 : sy);
            d[o + 7] = airborne ? b.spin : 0;
            d[o + 8] = Math.min(b.frame, cols * (b.rows || 2) - 1) / 16; d[o + 9] = b.dir < 0 ? 1 : 0;
          });
          pr.use();
          gl.uniform1f(pr.u.uAspect, c.aspect);
          gl.uniform1f(pr.u.uSizeScale, sx);
          gl.uniform1f(pr.u.uOpacity, c.opacity);
          gl.uniform1f(pr.u.uCols, cols);
          gl.uniform1f(pr.u.uRows, b.rows || 2);
          gl.uniform1f(pr.u.uCellAspect, (1536 / cols) / 512);
          bindTex(gl, 0, s.tex, pr.u.uSheet);
          batch.draw(pr);
          if (b.state === 'warp') {
            // the vortex: three spinning rings closing in on the arrival point
            for (let k = 0; k < 3; k++) {
              const ph = (b.warp * 2 + k / 3) % 1;
              batch.fillFrom(1, (i, d, o) => {
                d[o] = b.x; d[o + 1] = cy;
                d[o + 2] = 0.5 + 0.5 * Math.sin(b.hue * 6 + k); d[o + 3] = 0.6; d[o + 4] = 1; d[o + 5] = (1 - ph) * 0.8 * (1 - b.warp * 0.5);
                d[o + 6] = h * (0.3 + ph * 1.4); d[o + 7] = b.spin * 0.3 + k; d[o + 8] = 0; d[o + 9] = 0;
              });
              prWarp.use();
              gl.uniform1f(prWarp.u.uAspect, c.aspect);
              gl.uniform1f(prWarp.u.uSizeScale, 1);
              gl.uniform1f(prWarp.u.uOpacity, c.opacity);
              batch.draw(prWarp);
            }
          }
          if (p.names && b.tagT < 4 && !airborne) {
            const a = Math.min(1, b.tagT * 3) * Math.min(1, (4 - b.tagT) * 2);
            batch.fillFrom(1, (i, d, o) => {
              d[o] = b.x; d[o + 1] = cy - h * 0.75;
              d[o + 2] = 1; d[o + 3] = 1; d[o + 4] = 1; d[o + 5] = a;
              d[o + 6] = h * 0.55; d[o + 7] = 0; d[o + 8] = 0; d[o + 9] = 0;
            });
            prTag.use();
            gl.uniform1f(prTag.u.uAspect, c.aspect);
            gl.uniform1f(prTag.u.uSizeScale, 1);
            gl.uniform1f(prTag.u.uOpacity, c.opacity);
            gl.uniform1f(prTag.u.uTagAspect, 4);
            bindTex(gl, 0, s.tag, prTag.u.uTag);
            batch.draw(prTag);
          }
        }
        gl.disable(gl.BLEND);
      },
      dispose() {
        batch.dispose();
        for (const s of sheets.values()) { gl.deleteTexture(s.tex); gl.deleteTexture(s.tag); }
        sheets.clear();
      },
    };
  },
};
