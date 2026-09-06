// The pixel people: everyone who took a selfie on the phone, dropped into the
// room. They fall out of the sky — screaming, tumbling, shot in from the side
// or spun in through a time warp — bounce, land on the masked shapes and the
// floor, wander and run along the tops, climb the sides of shapes up and down,
// hop, jump for joy, peer over edges (and sometimes step off), sneak, sit,
// nap, shout at the room, dance to the beat with their own moves, and get
// knocked flying by a hand.
//
// Sprite sheets follow pixel-it's Base layout: one animation per row (idle,
// walk, run, jump, fall, climb, crouch, sit, sleep, shout, dance, dance2) with
// a manifest saying which cells are which; the old flat 4x2 / 4x4 sheets still
// work through the fallback chain in sprites.mjs. Every cell's ink box is
// measured once so each frame is drawn at its own natural height with the feet
// exactly on the ground, and the walk cycle advances with the ground covered
// rather than with time, so the legs never skate.
//
// The roster comes in through the world (`w.characters`, set by the host from
// the app state); a character that appears in the list falls in, one that
// leaves it is gone.

import { prog, bindTex, BLEND } from '../glu.mjs';
import { R, B, S } from './common.mjs';
import { SpriteSet, legacyManifest } from '../../sprites.mjs';

// one instanced quad per sprite: feet position, half size, rotation, flip, tint, and the sheet rect
const VS = `#version 300 es
in vec2 iPos;       // feet, world (x 0..1, y 0..aspect)
in vec2 iSize;      // half width, half height (world x units)
in vec2 iRot;       // rotation, flip (1 = face left)
in vec4 iCol;
in vec4 iRect;      // sheet uv rect: x, y, w, h
out vec2 vLocal; out vec4 vCol; out vec4 vRect; out float vFlip;
uniform float uAspect;
void main(){
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vLocal = corner; vCol = iCol; vRect = iRect; vFlip = iRot.y;
  // the quad hangs from the feet: y runs down the screen
  vec2 q = vec2(corner.x * iSize.x, (corner.y - 1.0) * iSize.y);
  float c = cos(iRot.x), s = sin(iRot.x);
  vec2 p = iPos + vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - (p.y / uAspect) * 2.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vLocal; in vec4 vCol; in vec4 vRect; in float vFlip;
out vec4 o;
uniform sampler2D uSheet;   // premultiplied, mipmapped
uniform float uOpacity;
void main(){
  vec2 f = vec2(vFlip > 0.5 ? -vLocal.x : vLocal.x, vLocal.y) * 0.5 + 0.5;
  vec4 c = texture(uSheet, vRect.xy + f * vRect.zw);
  if (c.a < 0.02) discard;
  float a = vCol.a * uOpacity;
  o = vec4(c.rgb * vCol.rgb * a, c.a * a);
}`;

// soft flat things drawn with the same quad: a shadow, a name tag, warp rings, dust, stars
const FLAT_FS = `#version 300 es
precision highp float;
#include <common>
in vec2 vLocal; in vec4 vCol; in vec4 vRect; in float vFlip;
out vec4 o;
uniform sampler2D uTag;
uniform float uOpacity;
uniform int uKind;          // 0 shadow, 1 tag texture, 2 warp ring, 3 dust square, 4 star
void main(){
  vec2 q = vLocal;
  float a = 0.0; vec3 rgb = vCol.rgb;
  if (uKind == 0) { a = 1.0 - smoothstep(0.35, 1.0, length(q)); }
  else if (uKind == 1) { vec4 c = texture(uTag, q * 0.5 + 0.5); a = c.a; rgb = c.rgb; }
  else if (uKind == 2) {
    float r = length(q), ang = atan(q.y, q.x);
    float ring = 1.0 - smoothstep(0.05, 0.14, abs(r - 0.8));
    a = ring * smoothstep(0.2, 0.7, 0.5 + 0.5 * sin(ang * 3.0 + r * 12.0 + vRect.x));
  }
  else if (uKind == 4) {
    // a four-point star
    float r = length(q), ang = atan(q.y, q.x);
    float star = 0.35 + 0.65 * pow(abs(cos(ang * 2.0)), 6.0);
    a = 1.0 - smoothstep(star * 0.8, star, r);
  }
  else { a = step(abs(q.x), 0.8) * step(abs(q.y), 0.8); }
  a *= vCol.a * uOpacity;
  if (a < 0.01) discard;
  o = vec4(rgb * a, a);
}`;

const LINES = {
  land: ['HI!', 'MADE IT!', 'PHEW!', 'NICE LANDING', 'OOF', 'OK. WHERE AM I.'],
  edge: ['WHOA...', 'STEEP!', 'BIG DROP!', 'NOPE.'],
  dance: ['WHEE!', 'TUNE!', 'DROP IT!', '♪♪'],
  sit: ['SO COZY...', 'FIVE MINUTES', 'MMM'],
  sleep: ['*YAWN*', 'GOOD NAP', 'FIVE MORE MINUTES'],
  knocked: ['HEY!!', 'WATCH IT!', 'RUDE!', 'NOT COOL!'],
  climb: ['UP WE GO', 'HNNGH', 'CLIMB TIME'],
  down: ['DOWN WE GO', 'CAREFUL...', 'EASY DOES IT'],
  top: ['MADE IT!', 'TOP FLOOR!', 'NICE VIEW'],
  jump: ['GERONIMO!', 'HUP!', 'WHEEE'],
  shout: ['HEY GIANT!', 'WHO PAINTED THIS?', 'IS ANYONE LISTENING?', 'I LIVE HERE NOW', 'THE WALL IS MINE'],
  warp: ['WHERE AM I?!', 'WHAT YEAR IS IT?', 'THAT TICKLED', 'NEVER AGAIN'],
};
const pick = (rng, a) => a[Math.floor(rng.next() * a.length)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;

export const people = {
  type: 'people',
  label: 'Pixel people',
  group: 'People',
  blend: 'over',
  hint: 'Everyone who pixelated themselves on the phone tumbles into the room, lands on your shapes, walks and runs the tops, climbs the sides, naps, dances to the beat with their own moves and gets knocked flying by a hand. Manage the roster in People.',
  actions: [{ name: 'drop', label: 'Drop them again' }, { name: 'dance', label: 'Everybody dance' }, { name: 'sit', label: 'Sit down' }],
  params: [
    R('size', 'Height', 0.13, 0.05, 0.3, 0.005),
    S('entrance', 'Arrive by', 'random', [['random', 'Any which way'], ['scream', 'Screaming fall'], ['tumble', 'Tumbling'], ['cannon', 'Shot in from the side'], ['warp', 'Through a time warp']]),
    R('dance', 'Dance', 1, 0, 1),
    R('wander', 'Liveliness', 0.6, 0, 1),
    B('climb', 'Climb the shapes', true),
    R('clumsy', 'Fall off ledges', 0.3, 0, 1),
    R('knock', 'Hands knock them', 1, 0, 2),
    B('names', 'Name tags on landing', true),
    B('chatter', 'They talk', false),
    B('shadow', 'Ground shadow', true),
  ],

  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const pr = prog(gl, VS, FS);
    const prFlat = prog(gl, VS, FLAT_FS);
    // instance buffer: pos2 size2 rot2 col4 rect4 = 14 floats
    const STRIDE_F = 14;
    const data = new Float32Array(STRIDE_F);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    const vaoFor = (p) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      for (const [name, size, off] of [['iPos', 2, 0], ['iSize', 2, 8], ['iRot', 2, 16], ['iCol', 4, 24], ['iRect', 4, 40]]) {
        const loc = p.a[name];
        if (loc == null || loc < 0) continue;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE_F * 4, off);
        gl.vertexAttribDivisor(loc, 1);
      }
      gl.bindVertexArray(null);
      return vao;
    };
    const vao = vaoFor(pr), vaoFlat = vaoFor(prFlat);
    const one = (v, set) => {
      set(data, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      gl.bindVertexArray(v);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
      gl.bindVertexArray(null);
    };
    const put = (d, o, x, y, hw, hh, rot, flip, r, g, b, a, rect) => {
      d[o] = x; d[o + 1] = y; d[o + 2] = hw; d[o + 3] = hh; d[o + 4] = rot; d[o + 5] = flip;
      d[o + 6] = r; d[o + 7] = g; d[o + 8] = b; d[o + 9] = a;
      d[o + 10] = rect[0]; d[o + 11] = rect[1]; d[o + 12] = rect[2]; d[o + 13] = rect[3];
    };

    const sheets = new Map();          // id -> { tex, tag, set, url, name }
    const folk = new Map();            // id -> person
    let seen = '';
    let danceAll = 0, tglobal = 0;
    let beatN = 0, lastPhase = 0;      // beats counted off the audio phase
    let lastW = null;                  // the world as of the last step, for the draw
    const dust = [];                   // { x, y, vx, vy, life, ttl, col, s }

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
    // premultiplied on the way in (the fringe around a sprite was linear filtering
    // mixing edge pixels with the colour hidden under transparent ones), and
    // mipmapped: a sheet cell is ~800 px tall and drawn at ~100, and plain linear
    // minification of that shimmers with every step.
    const upload = (tex, img, mips) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      if (mips) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      }
    };
    const textTex = (text, big) => {
      const cv = document.createElement('canvas');
      cv.width = 512; cv.height = 128;
      const x = cv.getContext('2d');
      x.font = (big ? '700 64px' : '700 56px') + ' "SF Mono",Menlo,monospace';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      const w = Math.min(500, x.measureText(text).width + 44);
      x.fillStyle = big ? 'rgba(0,0,0,.8)' : 'rgba(255,255,255,.92)';
      x.beginPath(); x.roundRect(256 - w / 2, 14, w, 100, 14); x.fill();
      x.fillStyle = big ? '#fff' : '#111';
      x.fillText(text, 256, 66, 460);
      return cv;
    };
    const ensureSheet = (c) => {
      let s = sheets.get(c.id);
      if (s && s.url === c.url && s.name === c.name) return s;
      if (!s) { s = { tex: mkTex(), tag: mkTex(), set: null }; sheets.set(c.id, s); }
      s.url = c.url; s.name = c.name; s.set = null;
      const manifest = c.anims && c.anims.anims ? c.anims : legacyManifest(c.rows || 2);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { upload(s.tex, img, true); s.set = new SpriteSet(img, manifest); };
      img.onerror = () => { s.set = null; };
      img.src = c.url;
      upload(s.tag, textTex(c.name || '?', true), false);
      return s;
    };
    const bubbles = new Map();          // text -> texture, made on demand
    const bubbleTex = (text) => { let t = bubbles.get(text); if (!t) { t = mkTex(); upload(t, textTex(text, false), false); bubbles.set(text, t); } return t; };

    // ---- terrain from the distance field. Solid where the field is negative; the floor is the frame's bottom.
    const solid = (w, x, y) => (y >= w.aspect - 1e-4) || (x >= 0 && x <= 1 && y >= 0 && w.field.sample(x, y) < 0);
    /**
     * The surface under a point: scanning down from yFrom to yTo, the first solid sample,
     * refined up to its top. `blocked` when yFrom itself is inside something.
     */
    const surfaceBelow = (w, x, yFrom, yTo) => {
      if (solid(w, x, yFrom)) return { blocked: true };
      const step = 0.003;
      for (let yy = yFrom + step; yy <= yTo + 1e-6; yy += step) {
        if (solid(w, x, yy)) {
          let t = yy;
          for (let i = 0; i < 4 && t - 0.0008 > yFrom && solid(w, x, t - 0.0008); i++) t -= 0.0008;
          return { y: Math.min(t, w.aspect) };
        }
      }
      return null;
    };
    /** Top of the solid thing at (x, y): scan up until air. Null when it goes higher than maxUp. */
    const topOfSolid = (w, x, y, maxUp) => {
      let t = y;
      for (let i = 0; i < 400; i++) {
        if (!solid(w, x, t - 0.002)) return t;
        t -= 0.002;
        if (y - t > maxUp) return null;
      }
      return null;
    };
    /** The x where solid begins between x0 and x1 at height y (the face of a wall), so a climber hangs just outside it. */
    const wallX = (w, x0, x1, y) => {
      const n = 12;
      for (let i = 1; i <= n; i++) { const x = x0 + (x1 - x0) * i / n; if (solid(w, x, y)) return x; }
      return x1;
    };
    const puff = (x, y, n, col = [0.8, 0.75, 0.65]) => {
      for (let i = 0; i < n; i++) dust.push({ x, y, vx: rng.range(-0.06, 0.06), vy: rng.range(-0.12, -0.02), life: 0, ttl: rng.range(0.3, 0.7), col, s: rng.range(0.002, 0.005) });
    };
    const zzz = (b, h) => { dust.push({ x: b.x + b.dir * h * 0.15, y: b.y - h * 0.5, vx: 0.01, vy: -0.03, life: 0, ttl: 1.4, col: [0.62, 0.7, 0.85], s: h * 0.02, z: true }); };
    const say = (b, p, what, hold = 1.6) => { if (!p.chatter || !what) return; b.say = what; b.sayT = hold; b.sayForce = false; };
    const driven = (b) => b.drive && tglobal < b.drive.until;
    const go = (b, state, t = 0) => { b.state = state; b.t = t; b.anim = 0; };

    const spawn = (c, p, w, how) => {
      const kinds = ['scream', 'tumble', 'cannon', 'warp'];
      const kind = how === 'random' ? kinds[Math.floor(rng.next() * kinds.length)] : how;
      const fromLeft = rng.next() < 0.5;
      const b = {
        id: c.id, x: rng.range(0.1, 0.9), y: -0.05 - rng.next() * 0.2, vx: rng.range(-0.02, 0.02), vy: 0,
        state: 'fall', tumble: kind === 'tumble' ? (rng.next() < 0.5 ? -1 : 1) * rng.range(6, 12) : 0,
        t: 0, wanderT: 0, dir: rng.next() < 0.5 ? -1 : 1, bounces: 0, anim: 0, spin: 0, tagT: 99, hue: rng.next(),
        squash: 0, energy: 0.3 + rng.next() * 0.5, say: null, sayT: 0, warp: 0, calm: 0, fallFrom: null,
        climb: null, climbCd: 0, jumpCd: 0, pushCd: 0, dist: 0, stars: 0, move: 'dance', beatAt: 0, hold: 0,
        drive: null, sayForce: false,
      };
      if (kind === 'cannon') { b.x = fromLeft ? -0.05 : 1.05; b.y = rng.range(0.05, 0.3); b.vx = (fromLeft ? 1 : -1) * rng.range(0.35, 0.55); b.vy = -0.15; b.tumble = (fromLeft ? 1 : -1) * 10; }
      if (kind === 'warp') { b.state = 'warp'; b.y = rng.range(0.1, 0.3); b.vx = 0; b.warp = 0; }
      b.fallFrom = b.y;
      folk.set(c.id, b);
    };

    const beatOf = (w) => {
      // the music if it is there, a steady 120 otherwise
      const live = w.audio && w.audio.live;
      return { live, beat: live ? (w.audio.beat || 0) : Math.max(0, 1 - ((tglobal * 2) % 1) * 3), phase: live ? (w.audio.phase || 0) : (tglobal * 2) % 1, level: live ? (w.audio.level || 0) : 0.5 };
    };

    // ---- the state machine. Sizes are relative to the character's height h so a small crowd and a giant behave alike.
    const K = {
      G: 1.25,                // fall, in world units/s²
      walk: 0.05, run: 0.115, sneak: 0.022,     // widths/s
      jumpVy: 0.32, jumpVx: 0.11,
      climbSpeed: 0.1,        // world units/s up a wall
    };
    const land = (b, p, w, h, dist) => {
      const was = b.state;
      b.vy = 0; b.vx = 0; b.spin = 0; b.tumble = 0; b.bounces = 0; b.calm = 0; b.climb = null;
      if (was === 'jump') { go(b, 'idle'); b.wanderT = 0.4 + rng.next(); puff(b.x, b.y, 3); return; }
      if (was === 'knocked') {
        puff(b.x, b.y, 6); b.squash = 0.5;
        go(b, 'idle'); b.wanderT = 1; return;
      }
      puff(b.x, b.y, clamp(Math.round(dist / h * 8), 4, 22));
      b.squash = clamp(dist / h * 0.8, 0.25, 0.7);
      b.tagT = 0;
      if (dist > h * 2.5) { go(b, 'ko'); b.hold = 2.6; b.stars = 2.6; say(b, p, 'OUCH...', 1.8); }
      else { go(b, 'idle'); b.wanderT = 0.8 + rng.next(); say(b, p, pick(rng, LINES.land)); }
    };
    const startFall = (b, p, vx = rng.range(-0.015, 0.015)) => {
      go(b, 'fall'); b.fallFrom = b.y; b.vx = vx; b.vy = 0.02; b.calm = 0; b.climb = null; b.screamed = false;
    };
    const jump = (b, p, h, forward) => {
      go(b, 'jump'); b.jumpCd = 2; b.calm = 0;
      b.vy = -K.jumpVy * (forward ? 1 : 0.8) * Math.sqrt(h / 0.13);
      b.vx = b.dir * K.jumpVx * (forward ? 1 : 0.25);
      puff(b.x, b.y, 3);
      if (forward && rng.next() < 0.5) say(b, p, pick(rng, LINES.jump), 1);
    };
    const startClimb = (b, p, x, to, dir, quick) => {
      go(b, 'climb');
      const dur = quick ? 0.45 : Math.max(0.5, Math.abs(to - b.y) / K.climbSpeed);
      b.climb = { x: clamp(x, 0.02, 0.98), from: b.y, to, dir, t: 0, dur, quick, face: b.dir };
      b.calm = 0;
      if (!quick && rng.next() < 0.5) say(b, p, pick(rng, dir === 'up' ? LINES.climb : LINES.down), 1.2);
    };
    // on the ground: follow it; false when it fell away and we are now falling
    const stick = (b, p, w, h, dt, disturb = 0) => {
      const g = surfaceBelow(w, b.x, b.y - h * 0.16, b.y + h * 0.5);
      if (!g || g.blocked) {
        if (g && g.blocked) {                       // a shape rose into us: ride it up
          const top = topOfSolid(w, b.x, b.y - h * 0.16, h * 0.8);
          if (top != null) { b.y = top; return true; }
        }
        if (b.state === 'sit' || b.state === 'sleep') say(b, p, 'HEY!!', 1.2);
        startFall(b, p); return false;
      }
      if (g.y - b.y > h * 0.2) { if (b.state === 'sit' || b.state === 'sleep') say(b, p, 'HEY!!', 1.2); startFall(b, p); return false; }
      if (disturb && Math.abs(g.y - b.y) > disturb) { say(b, p, 'HEY!!', 1.2); go(b, 'idle'); b.calm = 0; }
      b.y = g.y < b.y ? lerp(b.y, g.y, Math.min(1, 18 * dt)) : lerp(b.y, g.y, Math.min(1, 12 * dt));
      return true;
    };
    // walking or running: watch for walls (climb), drops (climb down / jump / step off / turn), the frame edge
    const wanderStep = (b, p, w, h, dt) => {
      const speed = b.state === 'run' ? K.run : K.walk;
      const nx = clamp(b.x + b.dir * speed * dt, 0.02, 0.98);
      const lookX = b.x + b.dir * h * 0.28;
      const can = p.climb && b.climbCd <= 0;
      if (lookX <= 0.01 || lookX >= 0.99) { b.dir = -b.dir; return; }
      // something solid at knee height ahead: a wall
      if (solid(w, lookX, b.y - h * 0.5)) {
        const top = topOfSolid(w, lookX, b.y - h * 0.5, w.aspect);
        const up = top == null ? 99 : b.y - top;
        const face = wallX(w, b.x, lookX, b.y - h * 0.5);
        if (top != null && up <= h * 0.75 && can) { startClimb(b, p, face + b.dir * h * 0.1, top, 'up', true); return; }
        if (top != null && up <= h * 4.5 && can && (driven(b) || rng.next() < 0.9)) { startClimb(b, p, face - b.dir * h * 0.12, top, 'up', false); return; }
        if (driven(b)) { go(b, 'idle'); return; }
        b.dir = -b.dir; b.climbCd = 1.2; return;
      }
      // a shape hanging just overhead (a picture above the couch): reach up and climb its side, sometimes
      if (can && !solid(w, lookX, b.y - h * 0.5) && solid(w, lookX, b.y - h * 1.05)) {
        const top = topOfSolid(w, lookX, b.y - h * 1.05, h * 4.5);
        if (top != null && (driven(b) || rng.next() < 0.35)) { startClimb(b, p, wallX(w, b.x, lookX, b.y - h * 1.05) - b.dir * h * 0.12, top, 'up', false); return; }
        b.climbCd = 1.5;
      }
      const g = surfaceBelow(w, lookX, b.y - h * 0.5, b.y + h * 4);
      if (!g || g.blocked || g.y - b.y > h * 0.2) {
        // a drop ahead
        const depth = g && !g.blocked ? g.y - b.y : 9;
        if (driven(b)) {                                                   // a player at the controls: climb down if there is a side, else walk off
          if (can && depth > h * 0.6 && solid(w, b.x, b.y + h * 0.15)) {
            const below = surfaceBelow(w, lookX, b.y + 0.002, w.aspect);
            if (below && !below.blocked) { startClimb(b, p, lookX + b.dir * h * 0.04, below.y, 'down', false); return; }
          }
          b.x = nx; return;
        }
        // the shape we stand on continues below the edge: climb down its side
        if (can && depth > h * 0.6 && solid(w, b.x, b.y + h * 0.15) && rng.next() < 0.85) {
          const below = surfaceBelow(w, lookX, b.y + 0.002, w.aspect);
          if (below && !below.blocked) { startClimb(b, p, lookX + b.dir * h * 0.04, below.y, 'down', false); return; }
        }
        if (depth < h * 1.0 && rng.next() < 0.6) { b.x = nx; return; }                              // small: just step off
        if (depth < h * 2.2 && b.jumpCd <= 0 && rng.next() < 0.4) { jump(b, p, h, true); return; }  // medium: leap
        if (rng.next() < p.clumsy * 0.5) { b.x = nx; return; }                                      // clumsy: walks right off
        b.dir = -b.dir; b.climbCd = 0.8;
        if (rng.next() < 0.4) say(b, p, pick(rng, LINES.edge), 1.1);
        go(b, 'peer'); return;
      }
      if (b.y - g.y > h * 0.1) {                                       // a low step up: clamber
        if (can) { startClimb(b, p, lookX, g.y, 'up', true); return; }
        b.dir = -b.dir; return;
      }
      if (b.state === 'run' && b.jumpCd <= 0 && rng.next() < dt * 0.35) { jump(b, p, h, false); return; }
      b.dist += Math.abs(nx - b.x) / (h / 0.13);                      // ground covered, in default-height strides
      b.x = nx;
      if (b.wanderT <= 0) { go(b, 'idle'); b.wanderT = 1 + rng.next() * 4; }
    };
    // idle and the timer ran out: what next?
    const decide = (b, p, w, h, set) => {
      b.t = 0; b.anim = 0;
      const lively = 0.35 + p.wander * 0.65;
      if (rng.next() > b.energy * lively * 1.4) { b.wanderT = 2 + rng.next() * 8 * (1.2 - p.wander); if (rng.next() < 0.3) b.dir = -b.dir; return; }
      const r = rng.next();
      const has = (k) => set && set.has(k);
      if (r < 0.08 && b.calm > 6) { go(b, 'sit'); b.hold = 6 + rng.next() * 14; b.dir = b.x > 0.5 ? -1 : 1; say(b, p, pick(rng, LINES.sit)); return; }
      if (r < 0.12 && b.calm > 12 && has('sleep')) { go(b, 'sleep'); b.hold = 10 + rng.next() * 20; return; }
      if (r < 0.18 && has('crouch')) { go(b, 'crouch'); b.hold = 3 + rng.next() * 3; if (rng.next() < 0.5) b.dir = -b.dir; return; }
      if (r < 0.23 && has('shout')) { go(b, 'shout'); b.hold = 1.6; say(b, p, pick(rng, LINES.shout), 1.7); return; }
      if (r < 0.30 && has('jump') && b.jumpCd <= 0) { jump(b, p, h, false); return; }
      if (r < 0.45 && has('run')) { go(b, 'run'); b.wanderT = 0.8 + rng.next() * 1.5; if (rng.next() < 0.5) b.dir = -b.dir; return; }
      if (r < 0.85) { go(b, 'walk'); b.wanderT = 1.2 + rng.next() * 3; if (rng.next() < 0.45) b.dir = -b.dir; return; }
      b.wanderT = 2 + rng.next() * 6; if (rng.next() < 0.4) b.dir = -b.dir;
    };

    const update = (b, p, w, dt) => {
      const h = p.size;
      const sh = sheets.get(b.id);
      const set = sh && sh.set;
      b.tagT += dt; b.calm += dt; b.t += dt;
      b.squash = Math.max(0, b.squash - dt * 4);
      b.climbCd = Math.max(0, b.climbCd - dt); b.jumpCd = Math.max(0, b.jumpCd - dt); b.pushCd = Math.max(0, b.pushCd - dt);
      if (b.stars > 0) b.stars -= dt;
      if (b.sayT > 0) { b.sayT -= dt; if (b.sayT <= 0) b.say = null; }
      const bt = beatOf(w);
      switch (b.state) {
        // ---- a time warp: spun in from nothing, then dropped
        case 'warp': {
          b.warp += dt / 1.6;
          b.spin += dt * 22 * (1.2 - b.warp);
          if (b.warp >= 1) { startFall(b, p, rng.range(-0.05, 0.05)); b.spin = 0; b.warp = 0; b.squash = 0.4; puff(b.x, b.y - h * 0.5, 10, [0.6, 0.7, 1]); say(b, p, pick(rng, LINES.warp), 2); }
          return;
        }
        // ---- airborne
        case 'fall': case 'knocked': case 'jump': {
          b.vy += K.G * dt;
          b.y += b.vy * dt;
          const nx = clamp(b.x + b.vx * dt, 0.02, 0.98);
          if (nx === 0.02 || nx === 0.98) b.vx = -b.vx * 0.5;
          // walls stop you sideways
          if (!solid(w, nx, b.y - h * 0.5)) b.x = nx; else b.vx *= -0.3;
          if (b.state !== 'jump') b.spin += dt * (b.tumble || (b.state === 'knocked' ? 9 * (b.vx >= 0 ? 1 : -1) : Math.sin(tglobal * 9 + b.hue * 6) * 2.5));
          else b.spin = 0;
          if (b.state === 'fall' && !b.screamed && b.y - b.fallFrom > h * 0.9) { b.screamed = true; say(b, p, 'WAAAHHH!!', 1.4); }
          if (b.y > w.aspect + 0.4) { b.y = -0.2; b.vy = 0; b.spin = 0; b.x = rng.range(0.1, 0.9); startFall(b, p); return; }
          if (b.vy <= 0) return;
          const g = surfaceBelow(w, b.x, b.y - h * 0.12, b.y + 0.002);
          if (g && !g.blocked) {
            const dist = b.state === 'fall' ? b.y - (b.fallFrom == null ? b.y : b.fallFrom) : 0;
            if (b.state === 'fall' && dist > h * 1.6 && b.bounces < 2) {           // a hard landing bounces first
              b.y = g.y - 0.001; b.vy = -b.vy * 0.35; b.vx *= 0.6; b.bounces++; b.squash = 1; b.spin = 0;
              puff(b.x, g.y, 8);
              return;
            }
            b.y = g.y;
            land(b, p, w, h, dist * Math.pow(0.5, b.bounces));       // the bounces took most of it
          } else if (g && g.blocked) {                                              // fell into a shape: pop out on top
            const top = topOfSolid(w, b.x, b.y, h);
            if (top != null) { b.y = top; land(b, p, w, h, 0); } else b.x += b.vx > 0 ? -0.01 : 0.01;
          }
          return;
        }
        // ---- climbing the side of a shape
        case 'climb': {
          const c = b.climb;
          if (!c) { go(b, 'idle'); return; }
          c.t += dt;
          const k = clamp(c.t / c.dur, 0, 1);
          b.x = c.x;
          b.y = lerp(c.from, c.to, c.quick ? k * k * (3 - 2 * k) : k);
          b.dir = c.face;
          b.calm = 0;
          if (k >= 1) {
            b.climb = null; b.climbCd = c.quick ? 0.4 : 2;
            if (c.dir === 'up') { b.x = clamp(c.x + c.face * h * 0.3, 0.02, 0.98); b.y = c.to; puff(b.x, b.y, 4); if (!c.quick && rng.next() < 0.4) say(b, p, pick(rng, LINES.top), 1.3); }
            else { b.y = c.to; puff(b.x, b.y, 3); }
            go(b, 'idle'); b.wanderT = c.quick ? 0.1 : 0.6 + rng.next();
          }
          return;
        }
        case 'crouch': {
          if (!stick(b, p, w, h, dt)) return;
          if (driven(b)) { if (b.drive.dir) b.dir = b.drive.dir; else { b.t = 0; } b.hold = 99; }
          const nx = clamp(b.x + b.dir * K.sneak * dt, 0.02, 0.98);
          const g = surfaceBelow(w, nx, b.y - h * 0.3, b.y + h);
          if (!g || g.blocked || g.y - b.y > h * 0.2 || nx <= 0.02 || nx >= 0.98) b.dir = -b.dir; else { b.dist += Math.abs(nx - b.x) / (h / 0.13); b.x = nx; }
          if (b.t > b.hold) { go(b, 'idle'); b.wanderT = 1; }
          return;
        }
        case 'peer': {
          // stopped at an edge, looking down; then turn back, or (clumsy) step off it
          if (!stick(b, p, w, h, dt)) return;
          if (b.t > 1.1) {
            if (rng.next() < p.clumsy * 0.6) { b.dir = -b.dir; startFall(b, p, b.dir * 0.05); say(b, p, 'WAAAH'); }
            else { go(b, 'idle'); b.wanderT = 0.6; }
          }
          return;
        }
        case 'sit': {
          if (!stick(b, p, w, h, dt, h * 0.25)) return;
          if (driven(b) && b.drive.dir) { go(b, 'idle'); break; }
          if (b.t > b.hold || danceAll > 0) { go(b, 'idle'); b.wanderT = 1; }
          return;
        }
        case 'sleep': {
          if (!stick(b, p, w, h, dt, h * 0.25)) return;
          if (driven(b) && b.drive.dir) { go(b, 'idle'); break; }
          if (rng.next() < dt * 1.1) zzz(b, h);
          if (b.t > b.hold || danceAll > 0) { go(b, 'idle'); b.wanderT = 1; say(b, p, pick(rng, LINES.sleep), 1.5); }
          return;
        }
        case 'ko': {
          if (!stick(b, p, w, h, dt, h * 0.35)) return;
          if (b.t > b.hold) { go(b, 'idle'); b.stars = 0; b.wanderT = 1; }
          return;
        }
        case 'shout': {
          if (!stick(b, p, w, h, dt)) return;
          if (b.t > b.hold) { go(b, 'idle'); b.wanderT = 1.5; }
          return;
        }
        case 'dance': {
          if (!stick(b, p, w, h, dt)) return;
          if (driven(b) && b.drive.dir) { go(b, 'idle'); break; }
          b.squash = Math.max(b.squash, bt.beat * 0.3);
          if (Math.floor(b.t * 0.5) !== Math.floor((b.t - dt) * 0.5) && rng.next() < 0.3) b.dir = -b.dir;
          // every ~8 s a new move
          if (Math.floor(b.t / 8) !== Math.floor((b.t - dt) / 8) && set) b.move = set.has('dance2') && rng.next() < 0.5 ? 'dance2' : 'dance';
          const on = danceAll > 0 || !bt.live || bt.level > 0.12 || driven(b);
          if (!on || (!driven(b) && b.t > 10 && rng.next() < dt * 0.25)) { go(b, 'idle'); b.wanderT = 1.5 + rng.next() * 3; }
          break;
        }
        case 'walk': case 'run': {
          if (!stick(b, p, w, h, dt)) return;
          if (driven(b)) {
            if (!b.drive.dir) { go(b, 'idle'); b.wanderT = 99; break; }
            b.dir = b.drive.dir; b.state = b.drive.run ? 'run' : 'walk'; b.wanderT = 99;
          } else b.wanderT -= dt;
          wanderStep(b, p, w, h, dt);
          break;
        }
        default: {   // idle: mostly just stand there; sometimes do something
          if (!stick(b, p, w, h, dt)) return;
          if (driven(b)) { if (b.drive.dir) { go(b, b.drive.run ? 'run' : 'walk'); b.dir = b.drive.dir; } b.wanderT = 99; break; }
          if (b.wanderT > 50) b.wanderT = 1 + rng.next() * 2;       // the player let go: back to a life of its own
          b.wanderT -= dt;
          const music = (bt.live && bt.level > 0.25) || !bt.live;
          if (danceAll > 0 || (music && p.dance > 0 && rng.next() < dt * 0.25 * p.dance * (0.5 + b.energy))) {
            go(b, 'dance'); b.move = set && set.has('dance2') && rng.next() < 0.5 ? 'dance2' : 'dance'; say(b, p, pick(rng, LINES.dance)); break;
          }
          if (b.wanderT <= 0) decide(b, p, w, h, set);
        }
      }
      // hands knock them flying
      if (p.knock > 0 && b.pushCd <= 0 && b.state !== 'warp' && b.state !== 'climb') for (const it of w.interactors) {
        const dx = b.x - it.x, dy = (b.y - h * 0.5) - it.y;
        const r = (it.r || 0.06) + h * 0.35;
        const speed = Math.hypot(it.vx || 0, it.vy || 0);
        if (dx * dx + dy * dy < r * r && speed > 0.15) {
          go(b, 'knocked'); b.pushCd = 1.2;
          b.vx = (it.vx || 0) * 0.6 * p.knock + dx * 2; b.vy = -Math.max(0.3, speed * 0.5) * p.knock;
          b.y -= 0.01; b.calm = 0; b.climb = null; b.dir = b.vx > 0 ? -1 : 1;
          say(b, p, pick(rng, LINES.knocked), 1.2);
        }
      }
    };

    // ---- which cell to show for a person right now
    const pose = (b, set, p, bt) => {
      let key = 'idle', t = b.t;
      switch (b.state) {
        case 'warp': case 'fall': case 'knocked': key = 'fall'; break;
        case 'jump': return set.frameAtPhase('jump', clamp(b.t / 0.95, 0, 0.999));
        case 'climb': key = 'climb'; t = b.climb && b.climb.quick ? b.t * 2 : b.t; break;
        case 'crouch': key = 'crouch'; break;
        case 'sit': key = 'sit'; break;
        case 'sleep': case 'ko': key = 'sleep'; break;
        case 'shout': key = 'shout'; break;
        case 'peer': key = 'idle'; break;
        case 'walk': case 'run': {
          // legs keep pace with the ground: one cycle per stride length at the nominal speed
          const a = set.anim(b.state);
          const speed = b.state === 'run' ? K.run : K.walk;
          const cycle = a.frames.length / a.fps * speed;
          return set.frameAtPhase(b.state, b.dist / cycle);
        }
        case 'dance': {
          // two frames per beat, the pair advancing with the beat count
          const a = set.anim(b.move || 'dance');
          if (a.key === 'idle') return set.frameAt(bt.phase < 0.5 ? 'walk' : 'idle', 0);
          const i = (beatN * 2 + (bt.phase < 0.5 ? 0 : 1)) % a.frames.length;
          return { cell: a.frames[i], key: a.key };
        }
      }
      return set.frameAt(key, t);
    };

    return {
      folk, sheets,
      resize() {},
      onWorldChanged() {},
      action(name, arg, w, p) {
        // a phone at the controls of one person: walk/run left or right (held), a move, a line
        if (name === 'drive' && arg) { const b = folk.get(arg.id); if (b) { b.drive = { dir: Math.sign(arg.dir || 0), run: !!arg.run, until: tglobal + (arg.dir ? 1.2 : 0.3) }; b.calm = 0; } return; }
        if (name === 'act' && arg) {
          const b = folk.get(arg.id); if (!b) return;
          const h = p.size;
          const grounded = !['fall', 'knocked', 'warp', 'climb', 'jump', 'ko'].includes(b.state);
          b.drive = { dir: 0, run: false, until: tglobal + 12 }; b.calm = 0;
          switch (arg.move) {
            case 'jump': if (grounded && b.jumpCd <= 0) jump(b, p, h, true); break;
            case 'sit': if (grounded) { go(b, 'sit'); b.hold = 30; } break;
            case 'sleep': if (grounded) { go(b, 'sleep'); b.hold = 40; } break;
            case 'dance': if (grounded) { go(b, 'dance'); b.move = arg.which || (rng.next() < 0.5 ? 'dance2' : 'dance'); danceAll = Math.max(danceAll, 0.01); } break;
            case 'shout': if (grounded) { go(b, 'shout'); b.hold = 2; } break;
            case 'crouch': if (grounded) { go(b, 'crouch'); b.hold = 99; } break;
            case 'turn': b.dir = -b.dir; break;
            case 'stop': if (grounded) go(b, 'idle'); break;
          }
          return;
        }
        if (name === 'say' && arg) { const b = folk.get(arg.id); if (b) { b.say = String(arg.text || '').toUpperCase().slice(0, 40); b.sayT = 2 + b.say.length * 0.06; b.sayForce = true; } return; }
        if (name === 'drop') { for (const id of [...folk.keys()]) { const c = (w.characters || []).find((x) => x.id === id); if (c) spawn(c, p, w, p.entrance); } }
        if (name === 'dance') danceAll = 12;
        if (name === 'sit') for (const b of folk.values()) if (['idle', 'walk', 'run', 'dance', 'peer', 'crouch'].includes(b.state)) { go(b, 'sit'); b.hold = 8 + rng.next() * 8; }
      },
      step(dt, w, p) {
        dt = Math.min(dt, 0.05);
        lastW = w;
        tglobal += dt;
        danceAll = Math.max(0, danceAll - dt);
        const bt = beatOf(w);
        if (bt.phase < lastPhase) beatN++;
        lastPhase = bt.phase;
        const list = w.characters || [];
        const key = list.map((c) => c.id + ':' + c.url + ':' + c.name).join(',');
        if (key !== seen) {
          seen = key;
          for (const c of list) { ensureSheet(c); if (!folk.has(c.id)) spawn(c, p, w, p.entrance); }
          for (const id of [...folk.keys()]) if (!list.some((c) => c.id === id)) folk.delete(id);
          for (const id of [...sheets.keys()]) if (!list.some((c) => c.id === id)) { const s = sheets.get(id); gl.deleteTexture(s.tex); gl.deleteTexture(s.tag); sheets.delete(id); }
        }
        for (const b of folk.values()) update(b, p, w, dt);
        for (const d of dust) { d.life += dt; if (!d.z) d.vy += 0.5 * dt; d.x += d.vx * dt; d.y += d.vy * dt; }
        for (let i = dust.length - 1; i >= 0; i--) if (dust[i].life > dust[i].ttl) dust.splice(i, 1);
      },
      draw(c) {
        const p = c.params;
        if (!folk.size && !dust.length) return;
        const h = p.size;
        c.dst.bind();
        BLEND.over(gl);
        const flat = (kind, tex, set) => {
          prFlat.use();
          gl.uniform1f(prFlat.u.uAspect, c.aspect);
          gl.uniform1f(prFlat.u.uOpacity, c.opacity);
          gl.uniform1i(prFlat.u.uKind, kind);
          if (tex) bindTex(gl, 0, tex, prFlat.u.uTag);
          one(vaoFlat, set);
        };
        // dust and Zs
        for (const d of dust) {
          const a = 1 - d.life / d.ttl;
          if (d.z) flat(1, bubbleTex('z'), (dd, o) => put(dd, o, d.x, d.y, d.s * 2, d.s * 0.6, 0, 0, 1, 1, 1, a * 0.9, [0, 0, 0, 0]));
          else flat(3, null, (dd, o) => put(dd, o, d.x, d.y, d.s, d.s, 0, 0, d.col[0], d.col[1], d.col[2], a * 0.8, [0, 0, 0, 0]));
        }
        const bt = beatOf(lastW || { audio: null });
        const order = [...folk.values()].sort((a, b) => a.y - b.y);
        for (const b of order) {
          const s = sheets.get(b.id);
          if (!s || !s.set) continue;
          const set = s.set;
          const airborne = b.state === 'fall' || b.state === 'knocked' || b.state === 'warp' || b.state === 'jump';
          const fr = pose(b, set, p, bt);
          const f = set.frame(fr.cell);
          const warpScale = b.state === 'warp' ? Math.max(0.02, Math.min(1, b.warp * 1.15)) : 1;
          // the frame at its own natural height, feet on the ground; a dance bobs on the beat
          let bob = 0;
          if (b.state === 'dance') bob = -bt.beat * h * 0.05;
          const hh = h * f.hRel * (1 - b.squash * 0.3) * warpScale;         // full height
          const hw = hh * f.aspect * (1 + b.squash * 0.25);
          if (p.shadow && !airborne) flat(0, null, (d, o) => put(d, o, b.x, b.y + h * 0.01, hw * 0.55, h * 0.03, 0, 0, 0, 0, 0, 0.45, [0, 0, 0, 0]));
          if (b.state === 'warp') {
            for (let k = 0; k < 3; k++) {
              const ph = (b.warp * 2 + k / 3) % 1;
              const hue = b.hue * 6.28 + k;
              flat(2, null, (d, o) => put(d, o, b.x, b.y - h * 0.5 + h * (0.4 + ph * 0.7), h * (0.35 + ph * 0.7), h * (0.35 + ph * 0.7), b.spin * 0.3 + k, 0,
                0.5 + 0.5 * Math.sin(hue), 0.6, 1, (1 - ph) * 0.8 * (1 - b.warp * 0.5), [k * 2, 0, 0, 0]));
            }
          }
          pr.use();
          gl.uniform1f(pr.u.uAspect, c.aspect);
          gl.uniform1f(pr.u.uOpacity, c.opacity);
          bindTex(gl, 0, s.tex, pr.u.uSheet);
          let rot = airborne ? b.spin : 0;
          if (b.state === 'knocked') rot = -b.dir * Math.min(0.5, b.t * 1.2) * (b.vx > 0 ? -1 : 1);
          // a lying frame (sleep) is drawn from the sheet as it is; the feet anchor becomes the bottom edge
          const lift = airborne ? 0 : f.lift * h;                            // a jump frame floats above the feet line
          one(vao, (d, o) => put(d, o, b.x, b.y + bob - lift, hw / 2, hh / 2, rot, b.dir < 0 ? 1 : 0, 1, 1, 1, 1, [f.u, f.v, f.uw, f.vh]));
          if (b.stars > 0) {
            for (let k = 0; k < 3; k++) {
              const ang = tglobal * 4 + k * 2.094;
              flat(4, null, (d, o) => put(d, o, b.x + Math.cos(ang) * h * 0.22, b.y - hh - h * 0.06 + Math.sin(ang) * h * 0.05, h * 0.05, h * 0.05, ang, 0, 1, 0.85, 0.3, 0.9, [0, 0, 0, 0]));
            }
          }
          if (p.names && b.tagT < 4 && !airborne) {
            const a = Math.min(1, b.tagT * 3) * Math.min(1, (4 - b.tagT) * 2);
            flat(1, s.tag, (d, o) => put(d, o, b.x, Math.max(h * 0.27, b.y - hh - h * 0.05), h * 0.5, h * 0.125, 0, 0, 1, 1, 1, a, [0, 0, 0, 0]));
          }
          if (b.say && (p.chatter || b.sayForce)) {
            const a = Math.min(1, b.sayT * 3);
            // kept inside the frame: someone on top of a high shape still gets a readable bubble
            flat(1, bubbleTex(b.say), (d, o) => put(d, o, clamp(b.x + b.dir * h * 0.15, h * 0.45, 1 - h * 0.45), Math.max(h * 0.24, b.y - hh - h * 0.06), h * 0.45, h * 0.11, 0, 0, 1, 1, 1, a, [0, 0, 0, 0]));
          }
        }
        gl.disable(gl.BLEND);
      },
      dispose() {
        gl.deleteBuffer(vbo); gl.deleteVertexArray(vao); gl.deleteVertexArray(vaoFlat);
        for (const s of sheets.values()) { gl.deleteTexture(s.tex); gl.deleteTexture(s.tag); }
        for (const t of bubbles.values()) gl.deleteTexture(t);
        sheets.clear(); bubbles.clear();
      },
    };
  },
};
