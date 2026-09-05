// Small WebGL2 helper layer shared by every effect: program compilation with
// a chunk-based #include, render targets (including half-float), ping-pong
// pairs and a fullscreen triangle. Everything here is context-scoped, so the
// control preview and each output window get their own instance.

export const CHUNKS = {};

CHUNKS.common = `
const float PI = 3.14159265359;
const float TAU = 6.28318530718;
float sat(float x){ return clamp(x, 0.0, 1.0); }
vec2  sat(vec2 x){ return clamp(x, 0.0, 1.0); }
vec3  sat(vec3 x){ return clamp(x, 0.0, 1.0); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
mat2 rot2(float a){ float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }
`;

CHUNKS.hash = `
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2  hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3  hash33(vec3 p3){ p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
`;

// value + simplex-ish gradient noise, fbm and curl. Cheap, tileable enough for
// wind fields and volumetric shading.
CHUNKS.noise = `
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0));
  float c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n = 0.0;
  for (int k = 0; k < 2; k++) {
    float z = float(k);
    float a = hash12(i.xy + vec2(0, 0) + (i.z + z) * 57.0);
    float b = hash12(i.xy + vec2(1, 0) + (i.z + z) * 57.0);
    float c = hash12(i.xy + vec2(0, 1) + (i.z + z) * 57.0);
    float d = hash12(i.xy + vec2(1, 1) + (i.z + z) * 57.0);
    float v = mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    n += mix(v * (1.0 - u.z), v * u.z, z);
  }
  return n;
}
float fbm(vec2 p, int oct){
  float s = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * vnoise(p); p = m * p; a *= 0.5; }
  return s;
}
float fbm3(vec3 p, int oct){
  // rotate between octaves so the lattice never lines up; kept inline so this
  // chunk does not depend on <common>
  const mat2 R = mat2(0.7648, -0.6442, 0.6442, 0.7648);
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * vnoise3(p); p *= 1.93; p.xy = R * p.xy; a *= 0.5; }
  return s;
}
vec2 curl(vec2 p, float e){
  float n1 = fbm(p + vec2(0.0, e), 3), n2 = fbm(p - vec2(0.0, e), 3);
  float n3 = fbm(p + vec2(e, 0.0), 3), n4 = fbm(p - vec2(e, 0.0), 3);
  return vec2(n1 - n2, n4 - n3) / (2.0 * e);
}
`;

// The occluder field: R = signed distance in normalized-x units (negative
// inside a shape), sampled with hardware bilinear. Gradient by central
// difference gives the surface normal for collisions and shading.
CHUNKS.sdf = `
uniform sampler2D uSdf;
uniform vec2 uSdfTexel;
float sdfAt(vec2 uv){ return texture(uSdf, uv).r; }
vec2 sdfGrad(vec2 uv){
  float l = sdfAt(uv - vec2(uSdfTexel.x, 0.0)), r = sdfAt(uv + vec2(uSdfTexel.x, 0.0));
  float d = sdfAt(uv - vec2(0.0, uSdfTexel.y)), u = sdfAt(uv + vec2(0.0, uSdfTexel.y));
  vec2 g = vec2(r - l, u - d);
  float m = length(g);
  return m > 1e-6 ? g / m : vec2(0.0, -1.0);
}
float sdfSolid(vec2 uv, float soft){ return 1.0 - smoothstep(0.0, soft, sdfAt(uv)); }
`;

// Physically-flavoured water/glass shading shared by water, bubbles, goo and
// the ball impostors.
CHUNKS.refract = `
vec3 refractBg(sampler2D bg, vec2 uv, vec2 normal, float thickness, float ior, vec2 aberr){
  // thin-surface approximation: bend the lookup by the tangential normal
  float k = thickness * (ior - 1.0);
  vec2 off = normal * k;
  vec3 c;
  c.r = texture(bg, sat(uv + off * (1.0 + aberr.x))).r;
  c.g = texture(bg, sat(uv + off)).g;
  c.b = texture(bg, sat(uv + off * (1.0 - aberr.y))).b;
  return c;
}
float fresnel(vec3 n, vec3 v, float f0){
  float c = 1.0 - sat(dot(n, v));
  float c2 = c * c;
  return f0 + (1.0 - f0) * c2 * c2 * c;
}
`;

// Catmull-Rom bicubic reconstruction with 9 bilinear taps: a simulation grid a
// fifth of the output resolution comes out with smooth, curved edges instead of
// the staircase bilinear filtering leaves. Slight negative ringing is clamped.
CHUNKS.bicubic = `
vec4 texBicubic(sampler2D t, vec2 uv, vec2 texel){
  vec2 pos = uv / texel - 0.5;
  vec2 f = fract(pos);
  vec2 c = pos - f;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 tc0 = (c - 0.5) * texel;
  vec2 tc12 = (c + 0.5 + w2 / w12) * texel;
  vec2 tc3 = (c + 2.5) * texel;
  vec4 r = texture(t, vec2(tc0.x, tc0.y)) * (w0.x * w0.y)
         + texture(t, vec2(tc12.x, tc0.y)) * (w12.x * w0.y)
         + texture(t, vec2(tc3.x, tc0.y)) * (w3.x * w0.y)
         + texture(t, vec2(tc0.x, tc12.y)) * (w0.x * w12.y)
         + texture(t, vec2(tc12.x, tc12.y)) * (w12.x * w12.y)
         + texture(t, vec2(tc3.x, tc12.y)) * (w3.x * w12.y)
         + texture(t, vec2(tc0.x, tc3.y)) * (w0.x * w3.y)
         + texture(t, vec2(tc12.x, tc3.y)) * (w12.x * w3.y)
         + texture(t, vec2(tc3.x, tc3.y)) * (w3.x * w3.y);
  return max(r, vec4(0.0));
}
`;

CHUNKS.tonemap = `
vec3 acesFilm(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return sat((x * (a * x + b)) / (x * (c * x + d) + e));
}
`;

const INCLUDE = /^[ \t]*#include[ \t]+<([a-zA-Z0-9_]+)>[ \t]*$/gm;

export function resolve(src) {
  let out = src, guard = 0;
  while (INCLUDE.test(out) && guard++ < 8) {
    INCLUDE.lastIndex = 0;
    out = out.replace(INCLUDE, (_, name) => {
      const c = CHUNKS[name];
      if (c == null) throw new Error('unknown shader chunk <' + name + '>');
      return c;
    });
  }
  INCLUDE.lastIndex = 0;
  return out;
}

function shader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) || '';
    const numbered = src.split('\n').map((l, i) => String(i + 1).padStart(4) + ' | ' + l).join('\n');
    throw new Error('shader compile failed: ' + log + '\n' + numbered);
  }
  return s;
}

/**
 * Compile and link. `opts.feedback` names transform-feedback varyings.
 * Returns { p, u, a, use() } where `u` maps uniform names to locations and `a`
 * maps attribute names to indices.
 */
export function prog(gl, vsSrc, fsSrc, opts = {}) {
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, resolve(vsSrc)));
  gl.attachShader(p, shader(gl, gl.FRAGMENT_SHADER, resolve(fsSrc)));
  if (opts.feedback) gl.transformFeedbackVaryings(p, opts.feedback, gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link failed: ' + gl.getProgramInfoLog(p));
  const u = {}, a = {};
  const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nu; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, name);
  }
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) {
    const info = gl.getActiveAttrib(p, i);
    a[info.name] = gl.getAttribLocation(p, info.name);
  }
  return { p, u, a, use: () => gl.useProgram(p) };
}

export const FMT = {
  rgba8: (gl) => ({ internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }),
  rgba16f: (gl) => ({ internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }),
  rgba32f: (gl) => ({ internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT }),
  rg16f: (gl) => ({ internal: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT }),
  rg32f: (gl) => ({ internal: gl.RG32F, format: gl.RG, type: gl.FLOAT }),
  r16f: (gl) => ({ internal: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT }),
  r32f: (gl) => ({ internal: gl.R32F, format: gl.RED, type: gl.FLOAT }),
  r8: (gl) => ({ internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE }),
};

export class Target {
  constructor(gl, w, h, kind = 'rgba8', opts = {}) {
    this.gl = gl; this.w = w | 0; this.h = h | 0; this.kind = kind;
    const f = FMT[kind](gl);
    const filter = opts.nearest ? gl.NEAREST : gl.LINEAR;
    const wrap = opts.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, this.w, this.h, 0, f.format, f.type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  bind(clear) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.w, this.h);
    if (clear) { gl.clearColor(clear[0], clear[1], clear[2], clear[3]); gl.clear(gl.COLOR_BUFFER_BIT); }
    return this;
  }
  dispose() { this.gl.deleteTexture(this.tex); this.gl.deleteFramebuffer(this.fbo); }
}

export class PingPong {
  constructor(gl, w, h, kind, opts) {
    this.a = new Target(gl, w, h, kind, opts);
    this.b = new Target(gl, w, h, kind, opts);
    this.w = this.a.w; this.h = this.a.h;
  }
  get read() { return this.a; }
  get write() { return this.b; }
  swap() { const t = this.a; this.a = this.b; this.b = t; }
  dispose() { this.a.dispose(); this.b.dispose(); }
}

// A fullscreen pass driven by a single triangle; no VBO churn, no per-effect
// quad bookkeeping.
export const VS_SCREEN = `#version 300 es
out vec2 vUV;
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export class Screen {
  constructor(gl) {
    this.gl = gl;
    this.vao = gl.createVertexArray();
    this.copyProg = prog(gl, VS_SCREEN, `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uTex; uniform float uScale; out vec4 o;
void main(){ o = texture(uTex, vUV) * uScale; }`);
  }
  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
  copy(srcTex, dst, scale = 1) {
    const gl = this.gl;
    dst.bind();
    this.copyProg.use();
    bindTex(gl, 0, srcTex, this.copyProg.u.uTex);
    gl.uniform1f(this.copyProg.u.uScale, scale);
    gl.disable(gl.BLEND);
    this.draw();
  }
}

export function bindTex(gl, unit, tex, loc) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (loc != null) gl.uniform1i(loc, unit);
}

export function texFromData(gl, w, h, kind, data, opts = {}) {
  const f = FMT[kind](gl);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, w, h, 0, f.format, f.type, data);
  const filter = opts.nearest ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

// Additive / alpha blend presets, so effects never leave the pipeline in a
// surprising state.
export const BLEND = {
  none: (gl) => gl.disable(gl.BLEND),
  add: (gl) => { gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE); },
  over: (gl) => { gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); },
  max: (gl) => { gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE); },
};

export function hexRgb(h, out = [0, 0, 0]) {
  const s = String(h || '#ffffff').replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16) || 0;
  out[0] = ((n >> 16) & 255) / 255; out[1] = ((n >> 8) & 255) / 255; out[2] = (n & 255) / 255;
  return out;
}
