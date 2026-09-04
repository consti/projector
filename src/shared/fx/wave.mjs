// Damped 2-D wave equation on a grid. Height and previous height live in the
// R and G channels of one target; obstacles clamp the surface to zero so
// ripples reflect off the shapes you drew rather than passing through them.

import { prog, PingPong, Screen, bindTex, VS_SCREEN } from './glu.mjs';

const FS_STEP = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uState;   // r = h(t), g = h(t-1)
uniform sampler2D uSdf;
uniform vec2 uTexel;
uniform float uSpeed;       // 0..0.5 CFL
uniform float uDamp;
out vec4 o;
float h(vec2 uv){
  if (texture(uSdf, uv).r < 0.0) return 0.0;
  return texture(uState, clamp(uv, vec2(0.0), vec2(1.0))).r;
}
void main(){
  if (texture(uSdf, vUV).r < 0.0) { o = vec4(0.0); return; }
  vec2 t = uTexel;
  float c = texture(uState, vUV).r;
  float p = texture(uState, vUV).g;
  float lap = h(vUV + vec2(t.x, 0.0)) + h(vUV - vec2(t.x, 0.0))
            + h(vUV + vec2(0.0, t.y)) + h(vUV - vec2(0.0, t.y)) - 4.0 * c;
  float n = (2.0 * c - p + uSpeed * lap) * uDamp;
  o = vec4(n, c, 0.0, 1.0);
}`;

const FS_DROP = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uState;
uniform vec4 uPoint;      // xy, radius, amplitude
uniform float uAspect;
out vec4 o;
void main(){
  vec2 s = texture(uState, vUV).rg;
  vec2 d = (vUV - uPoint.xy) * vec2(1.0, uAspect);   // round in world units
  float f = exp(-dot(d, d) / max(1e-7, uPoint.z * uPoint.z));
  s.r += uPoint.w * f;
  o = vec4(s, 0.0, 1.0);
}`;

export class Waves {
  constructor(gl, screen, w, h, aspect) {
    this.gl = gl;
    this.screen = screen || new Screen(gl);
    this.aspect = aspect;
    this.w = 0; this.h = 0;
    this.resize(w, h, aspect);
    this.pStep = prog(gl, VS_SCREEN, FS_STEP);
    this.pDrop = prog(gl, VS_SCREEN, FS_DROP);
  }
  resize(w, h, aspect) {
    this.aspect = aspect;
    if (this.w === w && this.h === h) return;
    if (this.state) this.state.dispose();
    this.state = new PingPong(this.gl, w, h, 'rg16f');
    this.w = w; this.h = h;
    this.texel = [1 / w, 1 / h];
  }
  clearAll() { this.state.a.bind([0, 0, 0, 0]); this.state.b.bind([0, 0, 0, 0]); }
  drop(x, y, radius, amp) {
    const gl = this.gl;
    this.pDrop.use();
    bindTex(gl, 0, this.state.read.tex, this.pDrop.u.uState);
    gl.uniform4f(this.pDrop.u.uPoint, x, y, radius, amp);
    gl.uniform1f(this.pDrop.u.uAspect, this.aspect);
    gl.disable(gl.BLEND);
    this.state.write.bind(); this.screen.draw(); this.state.swap();
  }
  step(o) {
    const gl = this.gl;
    this.pStep.use();
    bindTex(gl, 0, this.state.read.tex, this.pStep.u.uState);
    bindTex(gl, 1, o.sdfTex, this.pStep.u.uSdf);
    gl.uniform2f(this.pStep.u.uTexel, this.texel[0], this.texel[1]);
    gl.uniform1f(this.pStep.u.uSpeed, o.speed == null ? 0.42 : o.speed);
    gl.uniform1f(this.pStep.u.uDamp, o.damp == null ? 0.995 : o.damp);
    gl.disable(gl.BLEND);
    this.state.write.bind(); this.screen.draw(); this.state.swap();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  dispose() { if (this.state) this.state.dispose(); this.state = null; this.w = this.h = 0; }
}
