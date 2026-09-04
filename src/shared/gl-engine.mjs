import * as M from './mat3.mjs';
import * as Mesh from './mesh.mjs';
import { triangulate } from './earcut.mjs';

const VS_QUAD = `#version 300 es
in vec2 aUnit;
uniform mat3 uH;         // unit square -> output-normalized destination
out vec2 vOut;
void main() {
  vec3 p = uH * vec3(aUnit, 1.0);
  vec2 d = p.xy / p.z;
  vOut = d;
  gl_Position = vec4(d.x * 2.0 - 1.0, 1.0 - d.y * 2.0, 0.0, 1.0);
}`;

const FS_SURFACE = `#version 300 es
precision highp float;
in vec2 vOut;
uniform sampler2D uTex;
uniform sampler2D uPrev;
uniform float uBlend;     // 1 = show the newest frame only
uniform mat3 uHinv;       // output-normalized -> cell-local unit
uniform vec4 uCellST;     // xy = st offset, zw = st scale (cell-unit -> surface st)
uniform vec4 uSrcRect;    // xy = origin, zw = size, in video uv
uniform vec4 uCrop;       // active-picture crop in video uv (letterbox removal)
uniform vec4 uFeather;    // l, r, t, b in surface-st units
uniform vec4 uAdj;        // brightness, contrast, saturation, gamma
uniform float uHue;
uniform float uOpacity;
uniform vec2 uFlip;
uniform int uRot;
out vec4 fragColor;

vec3 hueRotate(vec3 c, float a) {
  if (abs(a) < 1e-5) return c;
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

float edge(float x, float f) { return f > 1e-5 ? smoothstep(0.0, f, x) : 1.0; }

void main() {
  vec3 p = uHinv * vec3(vOut, 1.0);
  if (abs(p.z) < 1e-7) discard;
  vec2 lu = p.xy / p.z;
  if (lu.x < -0.002 || lu.x > 1.002 || lu.y < -0.002 || lu.y > 1.002) discard;
  vec2 st = uCellST.xy + clamp(lu, 0.0, 1.0) * uCellST.zw;
  vec2 sf = st;
  if (uRot == 1) sf = vec2(sf.y, 1.0 - sf.x);
  else if (uRot == 2) sf = vec2(1.0 - sf.x, 1.0 - sf.y);
  else if (uRot == 3) sf = vec2(1.0 - sf.y, sf.x);
  if (uFlip.x > 0.5) sf.x = 1.0 - sf.x;
  if (uFlip.y > 0.5) sf.y = 1.0 - sf.y;
  vec2 uv = uSrcRect.xy + sf * uSrcRect.zw;
  uv = uCrop.xy + uv * uCrop.zw;   // sample only the un-letterboxed region

  vec2 cuv = clamp(uv, vec2(0.0005), vec2(0.9995));
  vec4 c = texture(uTex, cuv);
  if (uBlend < 0.999) c = mix(texture(uPrev, cuv), c, uBlend);

  float a = uOpacity;
  a *= edge(st.x, uFeather.x) * edge(1.0 - st.x, uFeather.y);
  a *= edge(st.y, uFeather.z) * edge(1.0 - st.y, uFeather.w);

  vec3 rgb = pow(max(c.rgb, 0.0), vec3(uAdj.w));
  rgb = (rgb - 0.5) * uAdj.y + 0.5 + uAdj.x;
  float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(vec3(l), rgb, uAdj.z);
  rgb = hueRotate(rgb, uHue);

  fragColor = vec4(clamp(rgb, 0.0, 1.0) * a, a);   // premultiplied
}`;

// ---- simple fullscreen-triangle passes -------------------------------------
const VS_FULL = `#version 300 es
in vec2 aUnit;
out vec2 vUV;
void main() { vUV = aUnit; gl_Position = vec4(aUnit * 2.0 - 1.0, 0.0, 1.0); }`;

const FS_FILL_POLY = `#version 300 es
precision highp float;
out vec4 fragColor;
void main() { fragColor = vec4(1.0); }`;

const VS_POLY = `#version 300 es
in vec2 aPos;            // output-normalized
void main() { gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0); }`;

const FS_BLUR = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uStep;      // texel-space step direction * stride
out vec4 fragColor;
const float W[9] = float[9](0.0039,0.03125,0.10938,0.21875,0.27344,0.21875,0.10938,0.03125,0.0039);
void main() {
  float s = 0.0;
  for (int i = 0; i < 9; i++) s += W[i] * texture(uTex, vUV + uStep * float(i - 4)).r;
  fragColor = vec4(s, s, s, s);
}`;

const FS_MASK_ACC = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform float uInvert;
uniform float uOpacity;
uniform vec2 uFlip;
uniform int uRot;
out vec4 fragColor;
void main() {
  float b = texture(uTex, vUV).r;
  float m = mix(b, 1.0 - b, uInvert) * uOpacity;
  fragColor = vec4(m, m, m, m);
}`;

const FS_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uComp;
uniform sampler2D uMask;
uniform sampler2D uOverlay;
uniform float uHasMask;
uniform float uHasOverlay;
uniform float uDim;
uniform float uOpaque;      // 1 when the effects stack has already resolved alpha
uniform vec3 uBg;
out vec4 fragColor;
void main() {
  vec4 c = texture(uComp, vUV);            // premultiplied unless uOpaque
  vec3 rgb = uOpaque > 0.5 ? c.rgb : c.rgb + uBg * (1.0 - c.a);
  float m = uHasMask > 0.5 ? texture(uMask, vUV).r : 0.0;
  rgb *= (1.0 - clamp(m, 0.0, 1.0)) * uDim;
  if (uHasOverlay > 0.5) {
    vec4 o = texture(uOverlay, vUV);
    rgb = rgb * (1.0 - o.a) + o.rgb * o.a;
  }
  fragColor = vec4(rgb, 1.0);
}`;

const FS_DIRECT = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform sampler2D uPrev;
uniform float uBlend;
uniform vec4 uRect;       // xy offset, zw scale  (uv = (vUV - off) / scale)
uniform vec4 uCrop;       // active-picture crop in video uv
uniform float uDim;
out vec4 fragColor;
void main() {
  vec2 uv = (vUV - uRect.xy) / uRect.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 vuv = uCrop.xy + uv * uCrop.zw;
  vec3 c = texture(uTex, vuv).rgb;
  if (uBlend < 0.999) c = mix(texture(uPrev, vuv).rgb, c, uBlend);
  fragColor = vec4(c * uDim, 1.0);
}`;

// ---------------------------------------------------------------------------

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(s) + '\n' + src);
  }
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function makeTarget(gl, w, h, fmt) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, fmt.format, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: true, preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;

    this.progSurface = program(gl, VS_QUAD, FS_SURFACE);
    this.progPoly = program(gl, VS_POLY, FS_FILL_POLY);
    this.progBlur = program(gl, VS_FULL, FS_BLUR);
    this.progAcc = program(gl, VS_FULL, FS_MASK_ACC);
    this.progComp = program(gl, VS_FULL, FS_COMPOSITE);
    this.progDirect = program(gl, VS_FULL, FS_DIRECT);

    // static unit quad
    this.quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.quadIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 2, 1, 3]), gl.STATIC_DRAW);

    this.polyVBO = gl.createBuffer();
    this.polyIBO = gl.createBuffer();

    // Two source textures: the newest decoded frame and the one before it, so
    // 24 or 25 fps material can be cross-faded across a 60 Hz output instead
    // of juddering through a 3:2 cadence.
    const mkSrc = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      return t;
    };
    this.srcTex = mkSrc();
    this.prevTex = mkSrc();
    this._tCur = 0; this._tPrev = 0; this._frameGap = 0;

    this.overlayTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.targets = {};
    this.maskKey = '';
    this.maskValid = false;
    this.hasMask = false;
    this.overlayValid = false;
    this.hasOverlay = false;
    this.source = null;
    this.crop = [0, 0, 1, 1];   // active-picture rect in video uv; full frame by default
    this.sourceSize = [1, 1];
    this.fx = null;                 // optional FxSystem, set by the renderer
    this._m = new Float32Array(9);
  }

  /**
   * Point the engine at a video element, canvas or image.
   *
   * Safe to call every frame: the flags are refreshed but the upload state is
   * only reset when the element itself changes. That matters because `gated`
   * depends on requestVideoFrameCallback having started, which does not happen
   * until a track loads — latching the flag at the first call left the engine
   * re-uploading a 1080p texture on every animation frame instead of once per
   * decoded frame.
   */
  // Non-destructive crop: sample only this sub-rect of the video (letterbox
  // removal). rect is {x,y,w,h} in 0..1 video uv, or null for the full frame.
  setSourceCrop(rect) {
    this.crop = rect && rect.w > 0 && rect.h > 0
      ? [rect.x || 0, rect.y || 0, rect.w, rect.h]
      : [0, 0, 1, 1];
  }

  setSource(el, opts = {}) {
    const changed = el !== this.source;
    this.source = el;
    this.staticSource = !!opts.static;
    this.gated = !!opts.gated;      // only re-upload when markSourceDirty() is called
    if (changed) {
      this._uploaded = false;
      this._tCur = 0; this._tPrev = 0; this._frameGap = 0;
    }
  }

  markSourceDirty() { this._uploaded = false; }

  invalidateMasks() { this.maskValid = false; }

  /**
   * How far the display is through the interval between the last two decoded
   * frames, 0..1. Returns 1 (show the newest frame outright) unless smoothing
   * is on and the source is genuinely slower than the output: at 50 fps and
   * above the cadence is already even enough, and blending would only soften
   * the picture for nothing.
   */
  /** Measured decode rate of the current source, or 0 if not known yet. */
  get sourceFps() {
    return this._frameGap > 4 && this._frameGap < 500 ? 1000 / this._frameGap : 0;
  }

  _blendFactor(on) {
    if (!on || this.staticSource || !this._tPrev) return 1;
    const gap = this._frameGap;
    if (!(gap > 20 && gap < 200)) return 1;      // 5..50 fps, and not a seek
    return Math.min(1, Math.max(0, (performance.now() - this._tCur) / gap));
  }

  /** Attach (or detach) the physics/effects stack. */
  setFx(fx) { this.fx = fx; }

  setOverlay(canvasOrNull) {
    const gl = this.gl;
    if (!canvasOrNull) { this.hasOverlay = false; return; }
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    // A 2-D canvas has row 0 at the top; a render target has it at the bottom.
    // Without the flip the wall guides came out upside down.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvasOrNull);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.hasOverlay = true;
  }

  _target(name, w, h, single) {
    const t = this.targets[name];
    if (t && t.w === w && t.h === h) return t;
    if (t) { this.gl.deleteTexture(t.tex); this.gl.deleteFramebuffer(t.fbo); }
    const fmt = single
      ? { internal: this.gl.R8, format: this.gl.RED }
      : { internal: this.gl.RGBA8, format: this.gl.RGBA };
    return (this.targets[name] = makeTarget(this.gl, w, h, fmt));
  }

  _bindQuad(prog) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIBO);
    const loc = gl.getAttribLocation(prog.p, 'aUnit');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  _uploadSource() {
    const gl = this.gl;
    const el = this.source;
    if (!el) return false;
    const w = el.videoWidth || el.naturalWidth || el.width || 0;
    const h = el.videoHeight || el.naturalHeight || el.height || 0;
    if (!w || !h) return false;
    this.sourceSize = [w, h];
    if ((this.staticSource || this.gated) && this._uploaded) return true;
    // the frame that was current becomes the previous one
    const older = this.prevTex;
    this.prevTex = this.srcTex;
    this.srcTex = older;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
    } catch (e) {
      this.srcTex = this.prevTex; this.prevTex = older;   // put them back
      return false;
    }
    const now = performance.now();
    if (this._tCur) {
      const gap = now - this._tCur;
      // A running average: a single interval jitters by a whole refresh, which
      // would make both the cadence readout and the cross-fade unstable. A
      // seek or a stall resets it rather than dragging the average around.
      this._frameGap = (this._frameGap && Math.abs(gap - this._frameGap) < this._frameGap * 0.6)
        ? this._frameGap * 0.85 + gap * 0.15
        : gap;
    } else {
      this._frameGap = 0;
    }
    this._tPrev = this._tCur;
    this._tCur = now;
    this._uploaded = true;
    return true;
  }

  // ---- masks (cached; rebuilt only when the mask definitions change) ------
  _rebuildMasks(project, W, H) {
    const gl = this.gl;
    const masks = (project.masks || []).filter((m) => m.enabled && m.points.length >= 3);
    const acc = this._target('maskAcc', W, H, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.hasMask = masks.length > 0;
    if (!masks.length) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); this.maskValid = true; return; }

    const a = this._target('maskA', W, H, true);
    const b = this._target('maskB', W, H, true);
    const k = W / ((project.global && project.global.refW) || 1920);

    for (const mask of masks) {
      // 1. rasterize the (grown) polygon
      const px = mask.points.map((p) => [p[0] * W, p[1] * H]);
      const grown = Mesh.offsetPolygon(px, (mask.grow || 0) * k).map((p) => [p[0] / W, p[1] / H]);
      const tris = triangulate(grown);
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (tris.length) {
        gl.useProgram(this.progPoly.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.polyVBO);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(grown.flat()), gl.DYNAMIC_DRAW);
        const loc = gl.getAttribLocation(this.progPoly.p, 'aPos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.polyIBO);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(tris), gl.DYNAMIC_DRAW);
        gl.drawElements(gl.TRIANGLES, tris.length, gl.UNSIGNED_SHORT, 0);
      }

      // 2. feather via iterated separable blur
      const r = Math.max(0, (mask.feather || 0) * k);
      if (r > 0.5) {
        const iters = r > 24 ? 3 : r > 8 ? 2 : 1;
        const stride = r / (4 * Math.sqrt(iters));
        gl.useProgram(this.progBlur.p);
        this._bindQuad(this.progBlur);
        let from = a, to = b;
        for (let k = 0; k < iters; k++) {
          for (const dir of [[stride / W, 0], [0, stride / H]]) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, from.tex);
            gl.uniform1i(this.progBlur.u.uTex, 0);
            gl.uniform2f(this.progBlur.u.uStep, dir[0], dir[1]);
            gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
            const t = from; from = to; to = t;
          }
        }
        if (from !== a) { // ensure result lands in `a`
          gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
          gl.useProgram(this.progBlur.p);
          this._bindQuad(this.progBlur);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, from.tex);
          gl.uniform1i(this.progBlur.u.uTex, 0);
          gl.uniform2f(this.progBlur.u.uStep, 0, 0);
          gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        }
      }

      // 3. accumulate into the shared mask with MAX so overlaps don't stack
      gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fbo);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.progAcc.p);
      this._bindQuad(this.progAcc);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, a.tex);
      gl.uniform1i(this.progAcc.u.uTex, 0);
      gl.uniform1f(this.progAcc.u.uInvert, mask.invert ? 1 : 0);
      gl.uniform1f(this.progAcc.u.uOpacity, mask.opacity == null ? 1 : mask.opacity);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      gl.blendEquation(gl.FUNC_ADD);
      gl.disable(gl.BLEND);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.maskValid = true;
  }

  // ---- main entry ---------------------------------------------------------
  render(project, opts = {}) {
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    if (!W || !H) return;
    const mode = opts.mode || 'mapped';
    const g = project.global || {};
    const dim = opts.dimOverride != null ? opts.dimOverride
      : (g.blackout ? 0 : 1) * (g.brightness == null ? 1 : g.brightness);
    const hasSrc = this._uploadSource();
    const blend = opts.blend != null ? opts.blend : this._blendFactor(g.smoothMotion);

    if (mode === 'fill') {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!hasSrc) return;
      const cr = this.crop;
      const sw = this.sourceSize[0] * cr[2], sh = this.sourceSize[1] * cr[3];
      let rect = [0, 0, 1, 1];
      const fit = opts.fit || 'contain';
      if (fit !== 'stretch') {
        const sa = sw / sh, da = W / H;
        const wide = fit === 'contain' ? sa > da : sa < da;
        if (wide) { const s = da / sa; rect = [0, (1 - s) / 2, 1, s]; }
        else { const s = sa / da; rect = [(1 - s) / 2, 0, s, 1]; }
      }
      gl.useProgram(this.progDirect.p);
      this._bindQuad(this.progDirect);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.uniform1i(this.progDirect.u.uTex, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.prevTex);
      gl.uniform1i(this.progDirect.u.uPrev, 1);
      gl.uniform1f(this.progDirect.u.uBlend, blend);
      gl.uniform4f(this.progDirect.u.uRect, rect[0], rect[1], rect[2], rect[3]);
      gl.uniform4f(this.progDirect.u.uCrop, cr[0], cr[1], cr[2], cr[3]);
      gl.uniform1f(this.progDirect.u.uDim, dim);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      return;
    }

    // --- mapped mode: surfaces -> composite FBO
    const comp = this._target('comp', W, H, false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, comp.fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // premultiplied source-over

    if (hasSrc) {
      gl.useProgram(this.progSurface.p);
      this._bindQuad(this.progSurface);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.uniform1i(this.progSurface.u.uTex, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.prevTex);
      gl.uniform1i(this.progSurface.u.uPrev, 1);
      gl.uniform1f(this.progSurface.u.uBlend, blend);
      const U = this.progSurface.u;
      gl.uniform4f(U.uCrop, this.crop[0], this.crop[1], this.crop[2], this.crop[3]);

      for (const s of project.surfaces || []) {
        if (!s.enabled) continue;
        const mesh = s.mesh;
        const fx = s.fx || {};
        gl.uniform4f(U.uSrcRect, s.src.x, s.src.y, s.src.w, s.src.h);
        gl.uniform4f(U.uFeather, s.feather?.l || 0, s.feather?.r || 0, s.feather?.t || 0, s.feather?.b || 0);
        gl.uniform4f(U.uAdj, fx.brightness || 0, fx.contrast == null ? 1 : fx.contrast,
          fx.saturation == null ? 1 : fx.saturation, fx.gamma == null ? 1 : fx.gamma);
        gl.uniform1f(U.uHue, fx.hue || 0);
        gl.uniform1f(U.uOpacity, fx.opacity == null ? 1 : fx.opacity);
        gl.uniform2f(U.uFlip, fx.flipH ? 1 : 0, fx.flipV ? 1 : 0);
        gl.uniform1i(U.uRot, ((fx.rot | 0) % 4 + 4) % 4);
        for (let j = 0; j < mesh.rows; j++) {
          for (let i = 0; i < mesh.cols; i++) {
            const Hc = Mesh.cellHomography(mesh, i, j);
            gl.uniformMatrix3fv(U.uH, false, M.toGL(Hc, this._m));
            gl.uniformMatrix3fv(U.uHinv, false, M.toGL(M.invert(Hc), this._m));
            gl.uniform4f(U.uCellST, i / mesh.cols, j / mesh.rows, 1 / mesh.cols, 1 / mesh.rows);
            gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
          }
        }
      }
    }
    gl.disable(gl.BLEND);

    // --- effects stack: runs on the resolved picture, before the blackout
    // masks, so water flows around a painting but the painting stays black
    const bg = hexToRgb(g.background || '#000000');
    let sceneTex = comp.tex;
    let opaque = false;
    if (this.fx && this.fx.active()) {
      try {
        sceneTex = this.fx.render(comp.tex, W, H, bg);
        opaque = true;
      } catch (e) {
        console.error('[fx] render failed', e);
        sceneTex = comp.tex;
        opaque = false;
      }
      gl.viewport(0, 0, W, H);
      gl.disable(gl.BLEND);
    }

    // --- masks
    const key = JSON.stringify(project.masks) + '|' + W + 'x' + H;
    if (!this.maskValid || key !== this.maskKey) { this.maskKey = key; this._rebuildMasks(project, W, H); }

    // --- final composite to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.progComp.p);
    this._bindQuad(this.progComp);
    const C = this.progComp.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(C.uComp, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, (this.targets.maskAcc || comp).tex);
    gl.uniform1i(C.uMask, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    gl.uniform1i(C.uOverlay, 2);
    gl.uniform1f(C.uHasMask, this.hasMask ? 1 : 0);
    gl.uniform1f(C.uHasOverlay, this.hasOverlay ? 1 : 0);
    gl.uniform1f(C.uDim, dim);
    gl.uniform1f(C.uOpaque, opaque ? 1 : 0);
    gl.uniform3f(C.uBg, bg[0], bg[1], bg[2]);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }
}

function hexToRgb(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
