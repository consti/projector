// The toy figurines on the wall: loads the models built by
// scripts/build-models.mjs (assets/models/*.glb), keeps them on the GPU, and
// draws any number of instances of each in one call — placed in wall
// coordinates, turned, leaned, squashed, posed through the little rig baked
// into every vertex (head, arms, legs, ears), lit and depth-tested into a
// target of their own, then composited over the layer's picture.
//
// Model space is y-up with the feet on y = 0 and the figure facing +z; the
// wall is x 0..1, y 0..aspect running down, z towards the viewer in the same
// units. A camera a few wall-widths in front of the wall's centre gives the
// toys a little perspective, so a toy standing out from the wall looms.

import { prog, bindTex, BLEND, Target } from './glu.mjs';
import { parseGlb } from './glb.mjs';

export const TOYS = ['alpaca', 'leopard', 'sumo'];
export const TOY_LABELS = { alpaca: 'Alpaca', leopard: 'Leopard', sumo: 'Sumo' };
export const TOY_CHOICES = [['all', 'All three'], ...TOYS.map((t) => [t, TOY_LABELS[t]])];

/** Floats per instance: pos3, size, rot3 (yaw, pitch, roll), squash2, pose4 (nod, swing, step, turn), tint4. */
export const STRIDE = 17;

const VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec3 aCol; in vec4 aBone;      // bone: id/255, weight, ao, -
in vec3 iPos; in float iSize; in vec3 iRot; in vec2 iSquash; in vec4 iPose; in vec4 iTint;
out vec3 vNrm; out vec3 vCol; out float vAo; out vec4 vTint; out vec3 vView; out vec2 vScreen; out float vH; out float vMirror;
uniform float uAspect;
uniform float uHeight;     // the model's height in its own units
uniform float uAnchor;     // which fraction of the height sits at iPos: 0 the feet, 0.5 the middle
uniform vec3 uPivot[8];
uniform vec3 uCam;         // x, y (y up, wall units), distance in front of the wall

mat3 rotX(float a){ float s = sin(a), c = cos(a); return mat3(1.0, 0.0, 0.0,  0.0, c, s,  0.0, -s, c); }
mat3 rotY(float a){ float s = sin(a), c = cos(a); return mat3(c, 0.0, -s,  0.0, 1.0, 0.0,  s, 0.0, c); }
mat3 rotZ(float a){ float s = sin(a), c = cos(a); return mat3(c, s, 0.0,  -s, c, 0.0,  0.0, 0.0, 1.0); }

void main(){
  int b = int(aBone.x * 255.0 + 0.5);
  float w = aBone.y;
  vec3 p = aPos, n = aNrm;
  if (b != 0) {
    vec3 c = uPivot[b];
    mat3 R = mat3(1.0);
    if (b == 1) R = rotY(iPose.w * w) * rotX(-iPose.x * w);        // head: turn, nod
    else if (b == 2) R = rotX(iPose.y * w);                        // arms swing against each other
    else if (b == 3) R = rotX(-iPose.y * w);
    else if (b == 4) R = rotX(-iPose.z * w);                       // legs step
    else if (b == 5) R = rotX(iPose.z * w);
    else if (b == 6) R = rotZ(iPose.z * 0.7 * w);                  // ears flap with the step
    else R = rotZ(-iPose.z * 0.7 * w);
    p = c + R * (p - c); n = R * n;
  }
  vH = p.y / uHeight;
  p.xz *= iSquash.x; p.y *= iSquash.y;                             // squash and stretch about the feet
  vMirror = iSquash.y < 0.0 ? 1.0 : 0.0;                            // a mirrored copy (the floor reflection)
  if (vMirror > 0.5) n.y = -n.y;
  p.y -= uHeight * uAnchor;
  mat3 M = rotZ(iRot.z) * rotX(iRot.y) * rotY(iRot.x);
  p = M * p * (iSize / uHeight); n = M * n;
  vec3 W = vec3(iPos.x, uAspect - iPos.y, iPos.z) + p;
  float k = uCam.z / max(0.05, uCam.z - W.z);
  vec2 q = uCam.xy + (W.xy - uCam.xy) * k;
  vScreen = vec2(q.x, q.y / uAspect);
  gl_Position = vec4(q.x * 2.0 - 1.0, (q.y / uAspect) * 2.0 - 1.0, clamp(-W.z * 0.3, -0.99, 0.99), 1.0);
  vNrm = n; vCol = aCol; vAo = aBone.z; vTint = iTint;
  vView = vec3(uCam.xy, uCam.z) - W;
}`;

const FS = `#version 300 es
precision highp float;
#include <common>
in vec3 vNrm; in vec3 vCol; in float vAo; in vec4 vTint; in vec3 vView; in vec2 vScreen; in float vH; in float vMirror;
out vec4 o;
uniform vec3 uLight;       // towards the light, y up
uniform vec3 uLightCol;
uniform vec3 uAmbient;
uniform vec3 uRimCol;
uniform float uGloss;
uniform float uReflect;
uniform float uFade;       // > 0: the mirrored copies fade with height
uniform float uOpacity;
uniform sampler2D uBg;
void main(){
  vec3 n = normalize(vNrm);
  vec3 v = normalize(vView);
  float ao = vAo;
  float ndl = dot(n, uLight);
  float diff = mix(max(ndl, 0.0), max((ndl + 0.4) / 1.4, 0.0), 0.35);
  vec3 albedo = vCol * vTint.rgb;
  vec3 col = albedo * (uAmbient * ao + uLightCol * diff * (0.55 + 0.45 * ao));
  vec3 h = normalize(uLight + v);
  float spec = pow(max(dot(n, h), 0.0), mix(14.0, 150.0, uGloss)) * uGloss * (0.3 + 0.7 * ao);
  col += uLightCol * spec;
  float fr = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += uRimCol * fr * ao;
  if (uReflect > 0.0) {
    vec3 bg = texture(uBg, sat(vScreen + n.xy * 0.08)).rgb;
    col += bg * uReflect * (0.3 + 0.7 * fr) * ao;
  }
  float a = vTint.a * uOpacity;
  if (vMirror > 0.5 && uFade > 0.0) a *= sat(1.0 - vH * uFade);
  o = vec4(col * a, a);
}`;

// soft contact shadows: instanced quads multiplied into the picture
const SHADOW_VS = `#version 300 es
in vec2 iPos; in vec2 iSize; in float iAlpha;
out vec2 vLocal; out float vAlpha;
uniform float uAspect;
void main(){
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vLocal = corner; vAlpha = iAlpha;
  vec2 p = iPos + corner * iSize;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - (p.y / uAspect) * 2.0, 0.0, 1.0);
}`;
const SHADOW_FS = `#version 300 es
precision highp float;
in vec2 vLocal; in float vAlpha; out vec4 o;
void main(){
  float r = length(vLocal);
  o = vec4(0.0, 0.0, 0.0, (1.0 - smoothstep(0.2, 1.0, r)) * vAlpha);
}`;

class GpuMesh {
  constructor(gl, m) {
    this.gl = gl;
    this.count = m.indices.length;
    this.height = m.extras.height || 1;
    this.footprint = m.extras.footprint || 0.5;
    this.pivots = new Float32Array(24);
    (m.rig || []).forEach((r, i) => { if (i < 8) this.pivots.set(r.pivot, i * 3); });
    const buf = (data, target = gl.ARRAY_BUFFER) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b; };
    this.vPos = buf(m.positions);
    this.vNrm = buf(m.normals);
    this.vCol = buf(m.colors || new Uint8Array(m.count * 3).fill(200));
    this.vBone = buf(m.bones || new Uint8Array(m.count * 4).fill(255));
    this.vIdx = buf(m.indices, gl.ELEMENT_ARRAY_BUFFER);
    this.vaos = new Map();
  }
  vao(pr, instVbo) {
    let v = this.vaos.get(pr);
    if (v) return v;
    const gl = this.gl;
    v = gl.createVertexArray();
    gl.bindVertexArray(v);
    const attr = (name, vbo, size, type, norm) => {
      const loc = pr.a[name]; if (loc == null || loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, type, norm, 0, 0);
    };
    attr('aPos', this.vPos, 3, gl.FLOAT, false);
    attr('aNrm', this.vNrm, 3, gl.FLOAT, false);
    attr('aCol', this.vCol, 3, gl.UNSIGNED_BYTE, true);
    attr('aBone', this.vBone, 4, gl.UNSIGNED_BYTE, true);
    gl.bindBuffer(gl.ARRAY_BUFFER, instVbo);
    const S = STRIDE * 4;
    const inst = (name, size, off) => {
      const loc = pr.a[name]; if (loc == null || loc < 0) return;
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, S, off * 4); gl.vertexAttribDivisor(loc, 1);
    };
    inst('iPos', 3, 0); inst('iSize', 1, 3); inst('iRot', 3, 4); inst('iSquash', 2, 7); inst('iPose', 4, 9); inst('iTint', 4, 13);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.vIdx);
    gl.bindVertexArray(null);
    this.vaos.set(pr, v);
    return v;
  }
  dispose() {
    const gl = this.gl;
    for (const v of this.vaos.values()) gl.deleteVertexArray(v);
    for (const b of [this.vPos, this.vNrm, this.vCol, this.vBone, this.vIdx]) gl.deleteBuffer(b);
  }
}

/** Instances for every model, filled per frame by an effect. */
export class ToyBatches {
  constructor(cap = 512) {
    this.cap = cap;
    this.data = {};
    this.count = {};
    for (const t of TOYS) { this.data[t] = new Float32Array(cap * STRIDE); this.count[t] = 0; }
  }
  reset() { for (const t of TOYS) this.count[t] = 0; }
  /** Add one instance; `inst` is an array of STRIDE floats. */
  add(model, inst) {
    const n = this.count[model];
    if (n == null || n >= this.cap) return;
    this.data[model].set(inst, n * STRIDE);
    this.count[model] = n + 1;
  }
}

export class ToyRenderer {
  constructor(gl) {
    this.gl = gl;
    this.models = {};
    this.ready = false;
    this.error = null;
    this.pr = prog(gl, VS, FS);
    this.prShadow = prog(gl, SHADOW_VS, SHADOW_FS);
    this.instVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo);
    gl.bufferData(gl.ARRAY_BUFFER, 512 * STRIDE * 4, gl.DYNAMIC_DRAW);
    this.shadowVbo = gl.createBuffer();
    this.shadowVao = null;
    this.target = null;
    // a layer with no picture to reflect still needs something bound to the sampler:
    // the target itself would be a feedback loop and the draw would be dropped
    this.black = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.black);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.copy = prog(gl, `#version 300 es
out vec2 vUV; void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`,
    `#version 300 es
precision highp float; in vec2 vUV; uniform sampler2D uTex; out vec4 o; void main(){ o = texture(uTex, vUV); }`);
    this._load();
  }

  async _load() {
    try {
      await Promise.all(TOYS.map(async (name) => {
        const res = await fetch('/assets/models/' + name + '.glb');
        if (!res.ok) throw new Error(name + '.glb: ' + res.status);
        const m = parseGlb(await res.arrayBuffer());
        this.models[name] = new GpuMesh(this.gl, m);
      }));
      this.ready = true;
    } catch (e) {
      this.error = 'toy models: ' + e.message;
      console.error('[toys]', e);
    }
  }

  _target(w, h) {
    if (this.target && this.target.w === w && this.target.h === h) return this.target;
    if (this.target) this.target.dispose();
    this.target = new Target(this.gl, w, h, 'rgba16f', { depth: true });
    return this.target;
  }

  /**
   * Draw the batches into `dst` (a Target). Options:
   *  aspect, light [x, y, z] (y up), lightCol, ambient, rimCol (rgb arrays),
   *  gloss 0..1, reflect 0..1 with bg (a texture), cam [x, y, dist], anchor,
   *  fade, opacity, screen (the fullscreen triangle helper).
   */
  render(dst, batches, o) {
    const gl = this.gl;
    if (!this.ready) return false;
    const T = this._target(dst.w, dst.h);
    T.bind([0, 0, 0, 0]);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    const pr = this.pr;
    pr.use();
    gl.uniform1f(pr.u.uAspect, o.aspect);
    gl.uniform1f(pr.u.uAnchor, o.anchor || 0);
    const cam = o.cam || [0.5, o.aspect * 0.5, 3];
    gl.uniform3f(pr.u.uCam, cam[0], cam[1], cam[2]);
    const L = o.light || [-0.5, 0.7, 0.8];
    const lm = Math.hypot(L[0], L[1], L[2]) || 1;
    gl.uniform3f(pr.u.uLight, L[0] / lm, L[1] / lm, L[2] / lm);
    gl.uniform3fv(pr.u.uLightCol, o.lightCol || [1, 1, 1]);
    gl.uniform3fv(pr.u.uAmbient, o.ambient || [0.3, 0.3, 0.34]);
    gl.uniform3fv(pr.u.uRimCol, o.rimCol || [0, 0, 0]);
    gl.uniform1f(pr.u.uGloss, o.gloss == null ? 0.4 : o.gloss);
    gl.uniform1f(pr.u.uReflect, o.bg ? (o.reflect || 0) : 0);
    gl.uniform1f(pr.u.uFade, o.fade || 0);
    gl.uniform1f(pr.u.uOpacity, o.opacity == null ? 1 : o.opacity);
    bindTex(gl, 0, o.bg || this.black, pr.u.uBg);
    let drew = false;
    for (const name of TOYS) {
      const m = this.models[name], n = batches.count[name];
      if (!m || !n) continue;
      gl.uniform1f(pr.u.uHeight, m.height);
      gl.uniform3fv(pr.u.uPivot, m.pivots);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, batches.data[name], 0, n * STRIDE);
      gl.bindVertexArray(m.vao(pr, this.instVbo));
      gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0, n);
      gl.bindVertexArray(null);
      drew = true;
    }
    gl.disable(gl.DEPTH_TEST);
    if (!drew) return false;
    // over the picture
    dst.bind();
    BLEND.over(gl);
    this.copy.use();
    bindTex(gl, 0, T.tex, this.copy.u.uTex);
    o.screen.draw();
    gl.disable(gl.BLEND);
    return true;
  }

  /** Multiply soft shadow discs into `dst`; `data` holds x, y, halfW, halfH, alpha per shadow. */
  shadows(dst, data, count, aspect) {
    const gl = this.gl;
    if (!count) return;
    const pr = this.prShadow;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowVbo);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 5), gl.DYNAMIC_DRAW);
    if (!this.shadowVao) {
      this.shadowVao = gl.createVertexArray();
      gl.bindVertexArray(this.shadowVao);
      const inst = (name, size, off) => { const loc = pr.a[name]; gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 20, off * 4); gl.vertexAttribDivisor(loc, 1); };
      inst('iPos', 2, 0); inst('iSize', 2, 2); inst('iAlpha', 1, 4);
      gl.bindVertexArray(null);
    }
    dst.bind();
    pr.use();
    gl.uniform1f(pr.u.uAspect, aspect);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.shadowVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  dispose() {
    const gl = this.gl;
    for (const m of Object.values(this.models)) m.dispose();
    this.models = {};
    gl.deleteBuffer(this.instVbo); gl.deleteBuffer(this.shadowVbo);
    if (this.shadowVao) gl.deleteVertexArray(this.shadowVao);
    if (this.target) this.target.dispose();
    gl.deleteTexture(this.black);
    gl.deleteProgram(this.pr.p); gl.deleteProgram(this.prShadow.p); gl.deleteProgram(this.copy.p);
  }
}

// One renderer per GL context, shared by every toy layer in that window.
const RENDERERS = new WeakMap();
export function toyRenderer(gl) {
  let r = RENDERERS.get(gl);
  if (!r) { r = new ToyRenderer(gl); RENDERERS.set(gl, r); }
  return r;
}

/** Which models a "toy" choice stands for. */
export function toyList(choice) {
  return choice === 'all' || !TOYS.includes(choice) ? TOYS : [choice];
}

/** Light direction from an angle in the picture plane (degrees, like the other effects) and an elevation off the wall. */
export function lightFromAngle(deg, out = [0, 0, 0]) {
  const a = (deg * Math.PI) / 180;
  out[0] = Math.cos(a); out[1] = -Math.sin(a); out[2] = 0.9;
  return out;
}
