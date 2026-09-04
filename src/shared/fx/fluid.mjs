// Eulerian "stable fluids" solver on a MAC-less collocated grid, with the
// occluder field as a no-flux boundary. Drives smoke, fire, ink and mist.
//
// Grid space is the output rectangle: u in 0..1, v in 0..1 (the shader works in
// texture space, forces arrive in world units and are converted here).

import { prog, Target, PingPong, Screen, bindTex, VS_SCREEN } from './glu.mjs';

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUV;
uniform sampler2D uSdf;
uniform vec2 uTexel;
uniform vec2 uGrid;        // grid size in cells
uniform float uAspect;
float solid(vec2 uv){ return texture(uSdf, uv).r < 0.0 ? 1.0 : 0.0; }
`;

const FS_ADVECT = HEAD + `
uniform sampler2D uVel;
uniform sampler2D uSrc;
uniform float uDt;
uniform vec4 uDissipate;   // per-channel survival factor for this step
uniform float uSharpen;    // 0 = plain semi-Lagrangian, 1 = MacCormack correction
out vec4 o;
vec2 backtrace(vec2 uv, float dt){
  vec2 v = texture(uVel, uv).xy;
  return uv - dt * v * vec2(1.0, 1.0 / uAspect);
}
void main(){
  if (solid(vUV) > 0.5) { o = vec4(0.0); return; }
  vec2 p = backtrace(vUV, uDt);
  vec4 a = texture(uSrc, clamp(p, vec2(0.0), vec2(1.0)));
  if (uSharpen > 0.5) {
    vec2 q = backtrace(clamp(p, vec2(0.0), vec2(1.0)), -uDt);
    vec4 b = texture(uSrc, clamp(q, vec2(0.0), vec2(1.0)));
    vec4 c = texture(uSrc, vUV);
    vec4 corrected = a + 0.5 * (c - b);
    // limit to the neighbourhood of the semi-Lagrangian sample to stay stable
    vec4 n0 = texture(uSrc, clamp(p + vec2(uTexel.x, 0.0), vec2(0.0), vec2(1.0)));
    vec4 n1 = texture(uSrc, clamp(p - vec2(uTexel.x, 0.0), vec2(0.0), vec2(1.0)));
    vec4 n2 = texture(uSrc, clamp(p + vec2(0.0, uTexel.y), vec2(0.0), vec2(1.0)));
    vec4 n3 = texture(uSrc, clamp(p - vec2(0.0, uTexel.y), vec2(0.0), vec2(1.0)));
    vec4 lo = min(min(n0, n1), min(min(n2, n3), a));
    vec4 hi = max(max(n0, n1), max(max(n2, n3), a));
    a = clamp(corrected, lo, hi);
  }
  o = a * uDissipate;
}`;

const FS_DIVERGENCE = HEAD + `
uniform sampler2D uVel;
out vec4 o;
void main(){
  vec2 t = uTexel;
  vec2 vl = texture(uVel, vUV - vec2(t.x, 0.0)).xy;
  vec2 vr = texture(uVel, vUV + vec2(t.x, 0.0)).xy;
  vec2 vd = texture(uVel, vUV - vec2(0.0, t.y)).xy;
  vec2 vu = texture(uVel, vUV + vec2(0.0, t.y)).xy;
  vec2 vc = texture(uVel, vUV).xy;
  // no flux through a solid face: mirror the centre cell's tangential flow
  if (solid(vUV - vec2(t.x, 0.0)) > 0.5) vl = vec2(-vc.x, vc.y);
  if (solid(vUV + vec2(t.x, 0.0)) > 0.5) vr = vec2(-vc.x, vc.y);
  if (solid(vUV - vec2(0.0, t.y)) > 0.5) vd = vec2(vc.x, -vc.y);
  if (solid(vUV + vec2(0.0, t.y)) > 0.5) vu = vec2(vc.x, -vc.y);
  float div = 0.5 * ((vr.x - vl.x) + (vu.y - vd.y));
  o = vec4(div, 0.0, 0.0, 1.0);
}`;

const FS_JACOBI = HEAD + `
uniform sampler2D uPrs;
uniform sampler2D uDiv;
out vec4 o;
void main(){
  vec2 t = uTexel;
  float c = texture(uPrs, vUV).r;
  float l = solid(vUV - vec2(t.x, 0.0)) > 0.5 ? c : texture(uPrs, vUV - vec2(t.x, 0.0)).r;
  float r = solid(vUV + vec2(t.x, 0.0)) > 0.5 ? c : texture(uPrs, vUV + vec2(t.x, 0.0)).r;
  float d = solid(vUV - vec2(0.0, t.y)) > 0.5 ? c : texture(uPrs, vUV - vec2(0.0, t.y)).r;
  float u = solid(vUV + vec2(0.0, t.y)) > 0.5 ? c : texture(uPrs, vUV + vec2(0.0, t.y)).r;
  float div = texture(uDiv, vUV).r;
  o = vec4((l + r + d + u - div) * 0.25, 0.0, 0.0, 1.0);
}`;

const FS_GRADIENT = HEAD + `
uniform sampler2D uPrs;
uniform sampler2D uVel;
out vec4 o;
void main(){
  if (solid(vUV) > 0.5) { o = vec4(0.0); return; }
  vec2 t = uTexel;
  float c = texture(uPrs, vUV).r;
  float l = solid(vUV - vec2(t.x, 0.0)) > 0.5 ? c : texture(uPrs, vUV - vec2(t.x, 0.0)).r;
  float r = solid(vUV + vec2(t.x, 0.0)) > 0.5 ? c : texture(uPrs, vUV + vec2(t.x, 0.0)).r;
  float d = solid(vUV - vec2(0.0, t.y)) > 0.5 ? c : texture(uPrs, vUV - vec2(0.0, t.y)).r;
  float u = solid(vUV + vec2(0.0, t.y)) > 0.5 ? c : texture(uPrs, vUV + vec2(0.0, t.y)).r;
  vec2 v = texture(uVel, vUV).xy - 0.5 * vec2(r - l, u - d);
  // slide along a nearby surface rather than sticking to it
  float sd = texture(uSdf, vUV).r;
  if (sd < 0.0) v = vec2(0.0);
  o = vec4(v, 0.0, 1.0);
}`;

const FS_VORTICITY = HEAD + `
uniform sampler2D uVel;
uniform float uCurl;
uniform float uDt;
out vec4 o;
float curlAt(vec2 uv){
  vec2 t = uTexel;
  float r = texture(uVel, uv + vec2(t.x, 0.0)).y;
  float l = texture(uVel, uv - vec2(t.x, 0.0)).y;
  float u = texture(uVel, uv + vec2(0.0, t.y)).x;
  float d = texture(uVel, uv - vec2(0.0, t.y)).x;
  return 0.5 * ((r - l) - (u - d));
}
void main(){
  vec2 t = uTexel;
  float c = curlAt(vUV);
  float gx = abs(curlAt(vUV + vec2(t.x, 0.0))) - abs(curlAt(vUV - vec2(t.x, 0.0)));
  float gy = abs(curlAt(vUV + vec2(0.0, t.y))) - abs(curlAt(vUV - vec2(0.0, t.y)));
  vec2 g = vec2(gx, gy) * 0.5;
  float m = length(g);
  vec2 n = m > 1e-6 ? g / m : vec2(0.0);
  vec2 f = uCurl * c * vec2(n.y, -n.x);
  o = vec4(texture(uVel, vUV).xy + f * uDt, 0.0, 1.0);
}`;

// Gravity/buoyancy from the dye channel plus an optional global wind and a
// swirl of low-frequency noise so plumes never look canned.
const FS_FORCES = HEAD + `
#include <hash>
#include <noise>
uniform sampler2D uVel;
uniform sampler2D uDye;
uniform float uDt;
uniform float uTime;
uniform float uBuoy;       // >0 rises with density (smoke), <0 falls (ink)
uniform float uWeight;     // pulls dense fluid down
uniform vec2 uWind;
uniform float uTurb;
uniform float uTurbScale;
out vec4 o;
void main(){
  if (solid(vUV) > 0.5) { o = vec4(0.0); return; }
  vec2 v = texture(uVel, vUV).xy;
  vec4 dye = texture(uDye, vUV);
  float dens = dye.a;
  float heat = dye.b;
  // uv space: +y is up the picture, so buoyancy adds and weight subtracts
  v.y += (uBuoy * heat - uWeight * dens) * uDt;
  v += uWind * uDt;
  if (uTurb > 0.0) {
    vec2 c = curl(vUV * uTurbScale + vec2(0.0, uTime * 0.15), 0.01);
    v += c * uTurb * uDt * (0.35 + dens);
  }
  o = vec4(v, 0.0, 1.0);
}`;

// A soft round splat used for emitters and for pointer/camera interaction.
const FS_SPLAT = HEAD + `
uniform sampler2D uSrc;
uniform vec3 uColor;
uniform vec4 uPoint;      // xy centre (uv), z radius (uv-x units), w strength
uniform float uAdditive;
uniform float uAlpha;     // how much of the strength lands in the density channel
out vec4 o;
void main(){
  vec2 d = (vUV - uPoint.xy) * vec2(1.0, uAspect);
  float f = exp(-dot(d, d) / max(1e-6, uPoint.z * uPoint.z));
  vec4 base = texture(uSrc, vUV);
  vec4 add = vec4(uColor, uAlpha) * f * uPoint.w;
  o = mix(max(base, add), base + add, uAdditive);
}`;

const FS_SPLAT_VEL = HEAD + `
uniform sampler2D uSrc;
uniform vec4 uPoint;
uniform vec2 uForce;
out vec4 o;
void main(){
  vec2 d = (vUV - uPoint.xy) * vec2(1.0, uAspect);
  float f = exp(-dot(d, d) / max(1e-6, uPoint.z * uPoint.z));
  o = vec4(texture(uSrc, vUV).xy + uForce * f, 0.0, 1.0);
}`;

const FS_CLEAR = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uSrc; uniform float uK; out vec4 o;
void main(){ o = texture(uSrc, vUV) * uK; }`;

export class Fluid {
  constructor(gl, screen, w, h, aspect) {
    this.gl = gl;
    this.screen = screen || new Screen(gl);
    this.resize(w, h, aspect);
    const P = (fs) => prog(gl, VS_SCREEN, fs);
    this.pAdvect = P(FS_ADVECT);
    this.pDiv = P(FS_DIVERGENCE);
    this.pJacobi = P(FS_JACOBI);
    this.pGrad = P(FS_GRADIENT);
    this.pVort = P(FS_VORTICITY);
    this.pForce = P(FS_FORCES);
    this.pSplat = P(FS_SPLAT);
    this.pSplatVel = P(FS_SPLAT_VEL);
    this.pClear = P(FS_CLEAR);
    this.time = 0;
  }

  resize(w, h, aspect) {
    const gl = this.gl;
    if (this.w === w && this.h === h) { this.aspect = aspect; return; }
    this.dispose();
    this.w = w; this.h = h; this.aspect = aspect;
    this.vel = new PingPong(gl, w, h, 'rg16f');
    this.dye = new PingPong(gl, w, h, 'rgba16f');
    this.prs = new PingPong(gl, w, h, 'r16f');
    this.div = new Target(gl, w, h, 'r16f');
    this.texel = [1 / w, 1 / h];
  }

  dispose() {
    for (const k of ['vel', 'dye', 'prs', 'div']) if (this[k]) { this[k].dispose(); this[k] = null; }
    this.w = this.h = 0;
  }

  _common(pr, sdfTex) {
    const gl = this.gl;
    pr.use();
    gl.uniform2f(pr.u.uTexel, this.texel[0], this.texel[1]);
    gl.uniform2f(pr.u.uGrid, this.w, this.h);
    gl.uniform1f(pr.u.uAspect, this.aspect);
    bindTex(gl, 3, sdfTex, pr.u.uSdf);
  }

  clearAll() {
    const gl = this.gl;
    for (const t of [this.vel.a, this.vel.b, this.dye.a, this.dye.b, this.prs.a, this.prs.b, this.div]) {
      t.bind([0, 0, 0, 0]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Add colour / density / heat at a point.
   * o = { color:[r,g,b], amount, heat, alpha, additive } — `heat` overrides the
   * blue channel (the fire solver reads temperature from there) and `alpha`
   * scales how much soot the same splat deposits.
   */
  splatDye(x, y, radius, o, sdfTex) {
    const gl = this.gl;
    const color = o.color || [1, 1, 1];
    this._common(this.pSplat, sdfTex);
    bindTex(gl, 0, this.dye.read.tex, this.pSplat.u.uSrc);
    gl.uniform3f(this.pSplat.u.uColor, color[0], color[1], o.heat > 0 ? o.heat : color[2]);
    gl.uniform4f(this.pSplat.u.uPoint, x, y, radius, o.amount);
    gl.uniform1f(this.pSplat.u.uAlpha, o.alpha == null ? 1 : o.alpha);
    gl.uniform1f(this.pSplat.u.uAdditive, o.additive === false ? 0 : 1);
    gl.disable(gl.BLEND);
    this.dye.write.bind();
    this.screen.draw();
    this.dye.swap();
  }

  splatVel(x, y, radius, fx, fy, sdfTex) {
    const gl = this.gl;
    this._common(this.pSplatVel, sdfTex);
    bindTex(gl, 0, this.vel.read.tex, this.pSplatVel.u.uSrc);
    gl.uniform4f(this.pSplatVel.u.uPoint, x, y, radius, 1);
    gl.uniform2f(this.pSplatVel.u.uForce, fx, fy);
    gl.disable(gl.BLEND);
    this.vel.write.bind();
    this.screen.draw();
    this.vel.swap();
  }

  step(dt, o) {
    const gl = this.gl;
    const sdf = o.sdfTex;
    this.time += dt;
    gl.disable(gl.BLEND);

    // forces
    this._common(this.pForce, sdf);
    bindTex(gl, 0, this.vel.read.tex, this.pForce.u.uVel);
    bindTex(gl, 1, this.dye.read.tex, this.pForce.u.uDye);
    gl.uniform1f(this.pForce.u.uDt, dt);
    gl.uniform1f(this.pForce.u.uTime, this.time);
    gl.uniform1f(this.pForce.u.uBuoy, o.buoyancy || 0);
    gl.uniform1f(this.pForce.u.uWeight, o.weight || 0);
    gl.uniform2f(this.pForce.u.uWind, (o.wind && o.wind[0]) || 0, (o.wind && o.wind[1]) || 0);
    gl.uniform1f(this.pForce.u.uTurb, o.turbulence || 0);
    gl.uniform1f(this.pForce.u.uTurbScale, o.turbScale || 4);
    this.vel.write.bind(); this.screen.draw(); this.vel.swap();

    // vorticity confinement
    if (o.curl) {
      this._common(this.pVort, sdf);
      bindTex(gl, 0, this.vel.read.tex, this.pVort.u.uVel);
      gl.uniform1f(this.pVort.u.uCurl, o.curl);
      gl.uniform1f(this.pVort.u.uDt, dt);
      this.vel.write.bind(); this.screen.draw(); this.vel.swap();
    }

    // advect velocity
    this._common(this.pAdvect, sdf);
    bindTex(gl, 0, this.vel.read.tex, this.pAdvect.u.uVel);
    bindTex(gl, 1, this.vel.read.tex, this.pAdvect.u.uSrc);
    gl.uniform1f(this.pAdvect.u.uDt, dt);
    const vd = 1 - (o.velDissipate || 0.02) * dt;
    gl.uniform4f(this.pAdvect.u.uDissipate, vd, vd, vd, vd);
    gl.uniform1f(this.pAdvect.u.uSharpen, 0);
    this.vel.write.bind(); this.screen.draw(); this.vel.swap();

    // projection
    this._common(this.pDiv, sdf);
    bindTex(gl, 0, this.vel.read.tex, this.pDiv.u.uVel);
    this.div.bind(); this.screen.draw();

    // warm-started pressure decays a little so old solutions do not linger
    this._common(this.pClear, sdf);
    bindTex(gl, 0, this.prs.read.tex, this.pClear.u.uSrc);
    gl.uniform1f(this.pClear.u.uK, 0.8);
    this.prs.write.bind(); this.screen.draw(); this.prs.swap();

    const iters = o.pressureIters || 24;
    this._common(this.pJacobi, sdf);
    bindTex(gl, 1, this.div.tex, this.pJacobi.u.uDiv);
    for (let i = 0; i < iters; i++) {
      bindTex(gl, 0, this.prs.read.tex, this.pJacobi.u.uPrs);
      this.prs.write.bind(); this.screen.draw(); this.prs.swap();
    }

    this._common(this.pGrad, sdf);
    bindTex(gl, 0, this.prs.read.tex, this.pGrad.u.uPrs);
    bindTex(gl, 1, this.vel.read.tex, this.pGrad.u.uVel);
    this.vel.write.bind(); this.screen.draw(); this.vel.swap();

    // advect dye
    this._common(this.pAdvect, sdf);
    bindTex(gl, 0, this.vel.read.tex, this.pAdvect.u.uVel);
    bindTex(gl, 1, this.dye.read.tex, this.pAdvect.u.uSrc);
    gl.uniform1f(this.pAdvect.u.uDt, dt);
    // Heat and soot fade at different rates: a flame cools in a fraction of a
    // second while its smoke hangs around.
    const dd = Math.max(0, 1 - (o.dyeDissipate || 0.15) * dt);
    const hd = Math.max(0, 1 - (o.heatDissipate == null ? (o.dyeDissipate || 0.15) : o.heatDissipate) * dt);
    const ad = Math.max(0, 1 - (o.sootDissipate == null ? (o.dyeDissipate || 0.15) : o.sootDissipate) * dt);
    gl.uniform4f(this.pAdvect.u.uDissipate, dd, dd, hd, ad);
    gl.uniform1f(this.pAdvect.u.uSharpen, o.sharpen === false ? 0 : 1);
    this.dye.write.bind(); this.screen.draw(); this.dye.swap();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}
