// Layers that show what a model made of the film. They hold no model calls
// themselves — the control window's AI director reads frames ahead of the
// playhead, asks OpenAI, and when the playhead reaches the frame it sends the
// result to these layers through the ordinary action relay (so the projector
// and TV windows get it too).
//
//   aitext:  a caption typeset on the wall — set({ text, hold })
//   aidream: a dreamed re-painting of the frame, cross-faded in — set({ image })

import { prog, bindTex, BLEND, VS_SCREEN, hexRgb } from '../glu.mjs';
import { R, B, C, S } from './common.mjs';

const TEXT_FS = `#version 300 es
precision highp float;
#include <common>
in vec2 vUV;
out vec4 o;
uniform sampler2D uTex;
uniform float uAlpha;
uniform vec2 uOff;        // uv offset (slide-in)
uniform float uReveal;    // 0..1 typewriter / wipe
uniform float uOpacity;
void main(){
  vec2 uv = vUV - uOff;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) { o = vec4(0.0); return; }
  vec4 c = texture(uTex, vec2(uv.x, 1.0 - uv.y));   // canvas rows run top-down
  float wipe = smoothstep(uReveal + 0.02, uReveal - 0.02, uv.x);
  float a = c.a * uAlpha * uOpacity * wipe;
  o = vec4(c.rgb * a, a);
}`;

const FONTS = {
  editorial: '500 {s}px "Iowan Old Style","Palatino","Georgia",serif',
  poster: '800 {s}px "Avenir Next Condensed","Helvetica Neue",Impact,sans-serif',
  mono: '500 {s}px "SF Mono",Menlo,Consolas,monospace',
  hand: '400 {s}px "Bradley Hand","Segoe Script","Comic Sans MS",cursive',
  typewriter: '400 {s}px "American Typewriter","Courier New",monospace',
  modern: '300 {s}px "Helvetica Neue","Inter",system-ui,sans-serif',
  gothic: '700 {s}px "Didot","Bodoni 72","Times New Roman",serif',
};

// word-wrap onto at most `maxLines` lines that fit `maxW`
function wrap(x, text, maxW, maxLines) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '…');
  return lines;
}

export const aitext = {
  type: 'aitext',
  label: 'AI caption',
  group: 'AI',
  blend: 'over',
  hint: 'The film read by a model and written back over itself: a caption in the style, language and type you choose, arriving as the frame it describes arrives. Needs AI on in Setup.',
  actions: [{ name: 'set', label: 'Show sample' }, { name: 'clear', label: 'Clear' }],
  params: [
    S('font', 'Type', 'editorial', [['editorial', 'Editorial serif'], ['poster', 'Poster'], ['mono', 'Terminal'], ['hand', 'Handwritten'], ['typewriter', 'Typewriter'], ['modern', 'Modern light'], ['gothic', 'Didone']]),
    R('size', 'Size', 0.06, 0.02, 0.2, 0.005),
    S('place', 'Place', 'lower', [['lower', 'Lower third'], ['centre', 'Centre'], ['upper', 'Top'], ['random', 'Anywhere']]),
    S('align', 'Align', 'left', [['left', 'Left'], ['centre', 'Centre'], ['right', 'Right']]),
    C('col', 'Colour', '#ffffff'),
    R('box', 'Backdrop', 0.35, 0, 1),
    R('shadow', 'Shadow', 0.6, 0, 1),
    S('anim', 'Arrives', 'type', [['fade', 'Fades in'], ['type', 'Types itself'], ['slide', 'Slides up'], ['wipe', 'Wipes on']]),
    R('hold', 'Stays for (s)', 9, 2, 40, 0.5),
    B('upper', 'UPPERCASE', false),
    R('width', 'Width', 0.7, 0.3, 1),
  ],
  create(ctx) {
    const gl = ctx.gl;
    const pr = prog(gl, VS_SCREEN, TEXT_FS);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const cv = document.createElement('canvas');
    const st = { text: '', t: 0, age: 1e9, hold: 9, key: '', place: [0.5, 0.75], seed: 0, len: 0, aspect: 9 / 16 };
    const col = [0, 0, 0];

    const render = (p, W, H) => {
      const key = JSON.stringify([st.text, p.font, p.size, p.place, p.align, p.col, p.box, p.shadow, p.upper, p.width, W, H, st.seed]);
      if (key === st.key) return;
      st.key = key;
      cv.width = W; cv.height = H;
      const x = cv.getContext('2d');
      x.clearRect(0, 0, W, H);
      if (!st.text) return;
      const size = Math.round(p.size * H);
      x.font = (FONTS[p.font] || FONTS.editorial).replace('{s}', size);
      const maxW = W * p.width;
      const text = p.upper ? st.text.toUpperCase() : st.text;
      const lines = wrap(x, text, maxW, 5);
      const lh = size * 1.22;
      const blockH = lines.length * lh;
      let cy;
      if (p.place === 'upper') cy = H * 0.12;
      else if (p.place === 'centre') cy = H * 0.5 - blockH / 2;
      else if (p.place === 'random') cy = H * (0.1 + 0.6 * st.place[1]);
      else cy = H * 0.86 - blockH;
      const pad = size * 0.5;
      let cx = W * 0.08;
      if (p.align === 'centre') cx = W / 2; else if (p.align === 'right') cx = W * 0.92;
      if (p.place === 'random') cx = W * (0.1 + 0.8 * st.place[0]) * (p.align === 'left' ? 0.6 : 1);
      x.textAlign = p.align === 'centre' ? 'center' : p.align;
      x.textBaseline = 'top';
      if (p.box > 0) {
        let wmax = 0;
        for (const l of lines) wmax = Math.max(wmax, x.measureText(l).width);
        const bx = p.align === 'centre' ? cx - wmax / 2 : p.align === 'right' ? cx - wmax : cx;
        x.fillStyle = `rgba(0,0,0,${p.box * 0.85})`;
        x.beginPath();
        x.roundRect(bx - pad, cy - pad * 0.6, wmax + pad * 2, blockH + pad * 1.2, size * 0.18);
        x.fill();
      }
      hexRgb(p.col, col);
      x.fillStyle = `rgb(${Math.round(col[0] * 255)},${Math.round(col[1] * 255)},${Math.round(col[2] * 255)})`;
      x.shadowColor = `rgba(0,0,0,${p.shadow})`; x.shadowBlur = size * 0.35; x.shadowOffsetY = size * 0.06;
      st.len = 0;
      lines.forEach((l, i) => { x.fillText(l, cx, cy + i * lh); st.len += l.length; });
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    };

    return {
      st,
      resize() {},
      action(name, arg, w, p) {
        if (name === 'clear') { st.text = ''; st.age = 1e9; return; }
        if (name === 'set') {
          st.text = (arg && arg.text) || 'A room full of slow light, and someone about to speak.';
          st.hold = (arg && arg.hold) || p.hold;
          st.age = 0; st.seed++;
          st.place = [ctx.rng.next(), ctx.rng.next()];
        }
      },
      step(dt) { st.age += dt; },
      draw(c) {
        const p = c.params;
        if (!st.text) return;
        const hold = st.hold || p.hold;
        if (st.age > hold + 1.2) return;
        render(p, c.size[0], c.size[1]);
        // in, hold, out
        const tin = p.anim === 'type' ? Math.min(2.2, Math.max(0.8, st.len * 0.045)) : 0.8;
        const a = Math.min(1, st.age / (p.anim === 'type' ? 0.3 : tin)) * (1 - Math.max(0, Math.min(1, (st.age - hold) / 1.2)));
        const prog_ = Math.min(1, st.age / tin);
        const ease = 1 - Math.pow(1 - prog_, 3);
        let off = [0, 0], reveal = 1.1;
        if (p.anim === 'slide') off = [0, (1 - ease) * 0.06];
        if (p.anim === 'wipe' || p.anim === 'type') reveal = ease * 1.05;
        c.dst.bind();
        BLEND.over(gl);
        pr.use();
        bindTex(gl, 0, tex, pr.u.uTex);
        gl.uniform1f(pr.u.uAlpha, a);
        gl.uniform2f(pr.u.uOff, off[0], off[1]);
        gl.uniform1f(pr.u.uReveal, reveal);
        gl.uniform1f(pr.u.uOpacity, c.opacity);
        ctx.screen.draw();
        gl.disable(gl.BLEND);
      },
      dispose() { gl.deleteTexture(tex); },
    };
  },
};

const DREAM_FS = `#version 300 es
precision highp float;
#include <common>
in vec2 vUV;
out vec4 o;
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uMix;       // 0 = A, 1 = B
uniform float uHasA; uniform float uHasB;
uniform vec2 uDrift;
uniform float uZoom;
uniform float uOpacity;
uniform float uVignette;
void main(){
  vec2 uv = (vUV - 0.5) / uZoom + 0.5 + uDrift;
  uv = vec2(uv.x, 1.0 - uv.y);
  vec4 a = texture(uA, clamp(uv, 0.0, 1.0)) * uHasA;
  vec4 b = texture(uB, clamp(uv, 0.0, 1.0)) * uHasB;
  vec4 c = mix(a, b, uMix);
  float v = 1.0 - uVignette * smoothstep(0.4, 0.95, length((vUV - 0.5) * vec2(1.2, 1.0)));
  float al = c.a * uOpacity;
  o = vec4(c.rgb * v * al, al);
}`;

export const aidream = {
  type: 'aidream',
  label: 'AI dream',
  group: 'AI',
  blend: 'over',
  hint: 'Frames read ahead of the playhead are re-painted by an image model in a style you name and cross-faded in when their moment comes. Slow and costly by nature; one frame every half minute or so. Needs AI on in Setup.',
  actions: [{ name: 'clear', label: 'Clear' }],
  params: [
    R('mix', 'Over the picture', 1, 0, 1),
    R('fade', 'Cross-fade (s)', 3, 0.2, 12, 0.1),
    R('drift', 'Camera drift', 0.5, 0, 2),
    R('zoom', 'Slow zoom', 0.5, 0, 2),
    R('vignette', 'Vignette', 0.4, 0, 1),
  ],
  create(ctx) {
    const gl = ctx.gl;
    const pr = prog(gl, VS_SCREEN, DREAM_FS);
    const mk = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
      return t;
    };
    const tex = [mk(), mk()];
    const st = { has: [false, false], cur: 0, mix: 1, since: 0, t: 0, pending: null };
    const upload = (slot, img) => {
      gl.bindTexture(gl.TEXTURE_2D, tex[slot]);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      st.has[slot] = true;
    };
    return {
      st,
      resize() {},
      action(name, arg) {
        if (name === 'clear') { st.has = [false, false]; st.mix = 1; return; }
        if (name === 'set' && arg && arg.image) {
          const img = new Image();
          img.onload = () => { st.pending = img; };
          img.src = arg.image;
        }
      },
      step(dt, w, p) {
        st.t += dt;
        if (st.pending) {
          const next = 1 - st.cur;
          upload(next, st.pending);
          st.pending = null;
          st.cur = next; st.mix = 0; st.since = 0;
        }
        st.since += dt;
        st.mix = Math.min(1, st.since / Math.max(0.05, p.fade));
      },
      draw(c) {
        const p = c.params;
        if (!st.has[0] && !st.has[1]) return;
        const from = 1 - st.cur, to = st.cur;
        c.dst.bind();
        BLEND.over(gl);
        pr.use();
        bindTex(gl, 0, tex[from], pr.u.uA);
        bindTex(gl, 1, tex[to], pr.u.uB);
        gl.uniform1f(pr.u.uMix, st.mix);
        gl.uniform1f(pr.u.uHasA, st.has[from] ? 1 : 0);
        gl.uniform1f(pr.u.uHasB, st.has[to] ? 1 : 0);
        gl.uniform2f(pr.u.uDrift, Math.sin(st.t * 0.11) * 0.012 * p.drift, Math.cos(st.t * 0.09) * 0.012 * p.drift);
        gl.uniform1f(pr.u.uZoom, 1 + p.zoom * 0.05 * (0.5 + 0.5 * Math.sin(st.t * 0.07)));
        gl.uniform1f(pr.u.uOpacity, c.opacity * p.mix);
        gl.uniform1f(pr.u.uVignette, p.vignette);
        ctx.screen.draw();
        gl.disable(gl.BLEND);
      },
      dispose() { for (const t of tex) gl.deleteTexture(t); },
    };
  },
};
