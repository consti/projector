// Optical tricks on the picture: a mirror through the middle with a swirl, a
// room that recedes into the wall, and a film that burns away in holes.

import { R, B, C, S } from './common.mjs';
import { postEffect } from './post.mjs';

// --------------------------------------------------------------------- mirror
const MIRROR_FS = `
uniform float uMode;      // 0 none, 1 vertical axis, 2 horizontal axis, 3 both
uniform float uSide;      // which half is the source
uniform float uAxis;      // axis position 0..1
uniform float uSwirl;
uniform float uSwirlR;
uniform float uWave;
uniform float uWaveFreq;
uniform float uHue;
void main(){
  vec2 uv = vUV;
  // swirl about the centre, strongest in the middle, fading out by uSwirlR
  vec2 p = toLocal(uv);
  float r = length(p);
  float k = uSwirl * (1.0 - smoothstep(0.0, uSwirlR, r));
  p = rot2(k) * p;
  uv = fromLocal(p);
  // gentle waves
  uv += vec2(sin(uv.y * uWaveFreq + uTime * 1.3), sin(uv.x * uWaveFreq * 0.8 - uTime * 1.1)) * uWave * 0.01;
  // the mirror
  vec2 m = uv;
  if (uMode == 1.0 || uMode == 3.0) {
    float ax = uAxis;
    float dx = m.x - ax;
    m.x = uSide > 0.5 ? ax + abs(dx) : ax - abs(dx);
  }
  if (uMode == 2.0 || uMode == 3.0) {
    float ay = 1.0 - uAxis;
    float dy = m.y - ay;
    m.y = uSide > 0.5 ? ay - abs(dy) : ay + abs(dy);
  }
  vec3 col = pic(m);
  col = hueShift(col, uHue * k);
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const mirror = postEffect({
  type: 'mirror',
  label: 'Mirror & swirl',
  group: 'Trippy',
  hint: 'The picture reflected through the middle, left onto right or top onto bottom, with a swirl and waves on top.',
  actions: [],
  params: [
    S('mode', 'Mirror', 'vertical', [['vertical', 'Left / right'], ['horizontal', 'Top / bottom'], ['both', 'Four ways'], ['none', 'No mirror, just swirl']]),
    B('side', 'Use the other half', false),
    R('axis', 'Axis position', 0.5, 0, 1),
    R('swirl', 'Swirl', 1.2, -8, 8, 0.05),
    R('swirlSpeed', 'Swirl sway', 0.5, 0, 3),
    R('swirlR', 'Swirl radius', 0.45, 0.05, 1.2),
    R('wave', 'Waves', 0.3, 0, 3),
    R('waveFreq', 'Wave count', 12, 1, 60, 1),
    R('hue', 'Colour in the swirl', 0, 0, 2),
    ...[R('x', 'Centre x', 0.5, -0.2, 1.2), R('y', 'Centre y', 0.5, -0.2, 1.2), R('drift', 'Drift', 0, 0, 2), B('followPointer', 'Swirl at the pointer', false)],
  ],
}, MIRROR_FS, {
  centre: true,
  uniforms(gl, u, p, st) {
    gl.uniform1f(u.uMode, { none: 0, vertical: 1, horizontal: 2, both: 3 }[p.mode] ?? 1);
    gl.uniform1f(u.uSide, p.side ? 1 : 0);
    gl.uniform1f(u.uAxis, p.axis);
    gl.uniform1f(u.uSwirl, p.swirl * (p.swirlSpeed > 0 ? Math.sin(st.t * p.swirlSpeed) : 1));
    gl.uniform1f(u.uSwirlR, p.swirlR);
    gl.uniform1f(u.uWave, p.wave);
    gl.uniform1f(u.uWaveFreq, p.waveFreq);
    gl.uniform1f(u.uHue, p.hue);
  },
});

// ----------------------------------------------------------------------- room
// The wall opens into a box: an eye in front of the vanishing point looks
// through the frame at a floor, ceiling, two side walls and a back wall, each
// carrying the picture in perspective.
const ROOM_FS = `
uniform float uDepth;
uniform float uEyeZ;
uniform float uFaces;     // 0 picture on every face, 1 back wall only + grid sides, 2 picture back + tiled sides
uniform vec3 uLineCol;
uniform float uLines;
uniform float uFog;
uniform float uTiles;
uniform float uScroll;
uniform float uSideShade;
void main(){
  vec2 A = vec2(1.0, uAspect);
  vec2 S = vUV * A;                  // screen point, aspect-correct
  vec2 E = uCentre * A;              // eye foot on the wall
  // ray from eye (E, -uEyeZ) through S (z = 0): X(t) = E + (S - E) t, z = -uEyeZ + uEyeZ t
  vec2 dir = S - E;
  float tBack = 1.0 + uDepth / uEyeZ;
  float t = tBack; int face = 4;      // back wall
  // side walls x = 0 / x = 1, floor / ceiling y = 0 / y = A
  if (dir.x < -1e-6) { float tx = (0.0 - E.x) / dir.x; if (tx > 1.0 && tx < t) { t = tx; face = 0; } }
  if (dir.x >  1e-6) { float tx = (1.0 - E.x) / dir.x; if (tx > 1.0 && tx < t) { t = tx; face = 1; } }
  if (dir.y < -1e-6) { float ty = (0.0 - E.y) / dir.y; if (ty > 1.0 && ty < t) { t = ty; face = 2; } }
  if (dir.y >  1e-6) { float ty = (A.y - E.y) / dir.y; if (ty > 1.0 && ty < t) { t = ty; face = 3; } }
  vec2 X = E + dir * t;
  float z = (t - 1.0) * uEyeZ;        // depth into the wall, 0..uDepth
  float zf = z / uDepth;
  vec2 fuv; vec2 edge;
  if (face == 4) { fuv = X / A; edge = min(fuv, 1.0 - fuv); }
  else if (face < 2) { fuv = vec2(face == 0 ? zf : 1.0 - zf, X.y / A.y); edge = vec2(min(zf, 1.0 - zf), min(fuv.y, 1.0 - fuv.y)); }
  else { fuv = vec2(X.x, face == 2 ? zf : 1.0 - zf); edge = vec2(min(fuv.x, 1.0 - fuv.x), min(zf, 1.0 - zf)); }
  vec3 col;
  if (face == 4 || uFaces < 0.5) {
    col = pic(fuv);
  } else if (uFaces < 1.5) {
    // bare walls with a glowing grid
    vec2 g = face < 2 ? vec2(zf * uTiles + uTime * uScroll, fuv.y * uTiles * uAspect) : vec2(fuv.x * uTiles, zf * uTiles + uTime * uScroll);
    vec2 gg = abs(fract(g) - 0.5);
    float line = smoothstep(0.46, 0.5, max(gg.x, gg.y));
    col = pic(fuv) * 0.15 + uLineCol * line * 1.5;
  } else {
    vec2 g = face < 2 ? vec2(zf * uTiles + uTime * uScroll, fuv.y * uTiles * uAspect) : vec2(fuv.x * uTiles, zf * uTiles + uTime * uScroll);
    col = pic(fract(g));
  }
  if (face != 4) col *= uSideShade;
  // glowing seams where the faces meet
  float e = min(edge.x, edge.y);
  col += uLineCol * uLines * (1.0 - smoothstep(0.0, 0.012, e));
  // fog deep in the room
  col *= exp(-zf * uFog);
  vec3 bg = texture(uBg, vUV).rgb;
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const room = postEffect({
  type: 'room',
  label: 'Room',
  group: 'Trippy',
  hint: 'The wall opens into a box: floor, ceiling, side walls and a back wall in perspective, all carrying the picture. Move the pointer to shift the vanishing point.',
  actions: [],
  params: [
    R('depth', 'Depth', 1.2, 0.1, 4),
    R('eye', 'Eye distance', 1.2, 0.4, 4),
    S('faces', 'Side walls', 'picture', [['picture', 'The picture'], ['grid', 'Neon grid'], ['tiles', 'Tiled picture']]),
    R('tiles', 'Tiles', 4, 1, 16, 1),
    R('scroll', 'Fly forward', 0.3, -3, 3, 0.05),
    R('sideShade', 'Side brightness', 0.75, 0.1, 1.5),
    R('lines', 'Seams', 0.6, 0, 2),
    C('lineCol', 'Seam colour', '#ff4fd8'),
    R('fog', 'Fog', 1, 0, 4),
    R('x', 'Vanishing point x', 0.5, 0.05, 0.95),
    R('y', 'Vanishing point y', 0.5, 0.05, 0.95),
    R('drift', 'Drift', 0.5, 0, 2),
    B('followPointer', 'Vanishing point at the pointer', true),
  ],
}, ROOM_FS, {
  centre: true,
  uniforms(gl, u, p, st, c, color) {
    gl.uniform1f(u.uDepth, p.depth);
    gl.uniform1f(u.uEyeZ, p.eye);
    gl.uniform1f(u.uFaces, { picture: 0, grid: 1, tiles: 2 }[p.faces] || 0);
    gl.uniform1f(u.uTiles, Math.round(p.tiles));
    gl.uniform1f(u.uScroll, p.scroll);
    gl.uniform1f(u.uSideShade, p.sideShade);
    gl.uniform1f(u.uLines, p.lines);
    color('uLineCol', p.lineCol);
    gl.uniform1f(u.uFog, p.fog);
  },
});

// ----------------------------------------------------------------------- burn
// Holes catch and spread like a film frame in a hot projector: a charred rim,
// a glowing front, embers, and behind it whatever you choose - black, ash, or
// the bare wall. When everything has gone the picture comes back.
const MAX_HOLES = 16;
const BURN_FS = `
uniform vec4 uHoles[${MAX_HOLES}];   // x, y (uv), radius, seed
uniform int uCount;
uniform float uEdge;
uniform float uChar;
uniform float uRough;
uniform vec3 uGlowCol;
uniform float uEmbers;
uniform float uBehind;    // 0 black, 1 ash
uniform float uHeal;      // 0..1 picture coming back
uniform float uShimmer;
void main(){
  vec2 uv = vUV;
  vec2 A = vec2(1.0, uAspect);
  float front = -1.0;      // how far past the burning front this pixel is (>0 = burnt)
  float nearest = 1e9;
  for (int i = 0; i < ${MAX_HOLES}; i++) {
    if (i >= uCount) break;
    vec4 h = uHoles[i];
    if (h.z <= 0.0) continue;
    vec2 d = (uv - h.xy) * A;
    float n = fbm(uv * 9.0 + h.w * 13.7, 4) - 0.5;
    float dist = length(d) * (1.0 + uRough * n * 1.6) + uRough * 0.03 * n;
    front = max(front, h.z - dist);
    nearest = min(nearest, dist - h.z);
  }
  vec3 bg = texture(uBg, uv).rgb;
  // heat shimmer just ahead of the front
  float ahead = sat(1.0 - abs(min(nearest, 0.2)) / 0.08) * uShimmer;
  vec2 warp = vec2(fbm(uv * 30.0 + uTime * 3.0, 2) - 0.5, fbm(uv * 30.0 - uTime * 2.3, 2) - 0.5) * ahead * 0.02;
  vec3 col = texture(uBg, clamp(uv + warp, 0.0, 1.0)).rgb;
  float flick = 0.7 + 0.3 * fbm(uv * 40.0 + vec2(uTime * 6.0, -uTime * 4.0), 3);
  // charring: the picture browns and darkens before it goes
  float charB = uEdge * (1.0 + uChar);
  float ch = smoothstep(-charB, 0.0, front);
  col = mix(col, col * vec3(0.35, 0.18, 0.08), ch * 0.9);
  // the burning front: a bright ring fading inwards
  float ring = smoothstep(-uEdge * 0.2, 0.0, front) * (1.0 - smoothstep(0.0, uEdge, front));
  vec3 fire = mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.85, 0.3), sat(front / uEdge * 3.0)) * uGlowCol;
  float burnt = smoothstep(uEdge * 0.3, uEdge, front);
  vec3 behind = mix(vec3(0.0), vec3(0.08, 0.075, 0.07) * (0.6 + 0.8 * fbm(uv * 25.0, 3)), uBehind);
  col = mix(col, behind, burnt);
  col += fire * ring * flick * 2.2;
  // embers drifting off the edge
  if (uEmbers > 0.0) {
    vec2 g = uv * vec2(90.0, 50.0) + vec2(0.0, -uTime * 3.0);
    vec2 id = floor(g);
    float hh = hash12(id);
    float em = smoothstep(0.92, 1.0, hh) * (1.0 - smoothstep(0.1, 0.3, length(fract(g) - 0.5 - (hash22(id) - 0.5) * 0.4)));
    em *= smoothstep(-uEdge, 0.0, front) * (1.0 - smoothstep(0.0, uEdge * 4.0, front)) * (0.5 + 0.5 * sin(uTime * 9.0 + hh * 60.0));
    col += vec3(1.0, 0.5, 0.1) * em * uEmbers * 3.0;
  }
  col = mix(col, bg, uHeal);
  o = vec4(mix(bg, col, uOpacity), 1.0);
}`;

export const burn = postEffect({
  type: 'burn',
  label: 'Burn',
  group: 'Energy',
  hint: 'Holes catch and spread until the whole picture has burnt away, then it comes back.',
  actions: [{ name: 'burn', label: 'Light a hole' }, { name: 'restore', label: 'Put it back' }],
  params: [
    R('rate', 'Holes per second', 0.25, 0, 4, 0.05),
    R('speed', 'Spread speed', 0.06, 0.005, 0.5, 0.005),
    R('edge', 'Front width', 0.04, 0.005, 0.2, 0.001),
    R('char', 'Charring', 1, 0, 3),
    R('rough', 'Raggedness', 0.6, 0, 1.5),
    R('embers', 'Embers', 1, 0, 3),
    C('glowCol', 'Flame colour', '#ffffff'),
    S('behind', 'Behind the film', 'black', [['black', 'Darkness'], ['ash', 'Ash']]),
    R('restoreAfter', 'Come back after (s)', 4, 0, 30, 0.5),
    R('healTime', 'Come back over (s)', 2, 0.2, 10, 0.1),
    R('shimmer', 'Heat shimmer', 0.6, 0, 2),
    B('atPointer', 'Pointer lights holes', true),
  ],
}, BURN_FS, {
  init(ctx) {
    return { holes: [], acc: 0, rng: ctx.rng, gone: -1, heal: 0, healing: false, data: new Float32Array(MAX_HOLES * 4) };
  },
  action(st, name, arg, w, p) {
    if (name === 'restore') { st.healing = true; return; }
    st.holes.push({ x: st.rng.range(0.1, 0.9), y: st.rng.range(0.1, 0.9), r: 0, seed: st.rng.next() * 10, born: st.t });
  },
  step(st, dt, w, p) {
    const light = (x, y) => {
      if (st.healing || st.holes.length >= MAX_HOLES) return;
      st.holes.push({ x, y, r: 0, seed: st.rng.next() * 10, born: st.t });
    };
    if (!st.healing) {
      st.acc += dt * p.rate;
      while (st.acc >= 1) { st.acc -= 1; light(st.rng.range(0.1, 0.9), st.rng.range(0.1, 0.9)); }
      if (p.atPointer) for (const it of w.interactors) if (it.down) light(it.x, 1 - it.y / w.aspect);
    }
    for (const h of st.holes) h.r += dt * p.speed * (0.8 + 0.4 * Math.sin(h.seed));
    // the whole picture has gone when the largest hole covers the frame
    const covered = st.holes.some((h) => h.r > 1.6);
    if (covered && st.gone < 0) st.gone = st.t;
    if (st.gone >= 0 && p.restoreAfter >= 0 && st.t - st.gone > p.restoreAfter) st.healing = true;
    if (st.healing) {
      st.heal = Math.min(1, st.heal + dt / Math.max(0.2, p.healTime));
      if (st.heal >= 1) { st.holes.length = 0; st.gone = -1; st.healing = false; st.heal = 0; st.acc = 0; }
    }
    // keep the list short: a hole swallowed by a bigger one can go
    if (st.holes.length > 10) st.holes.sort((a, b) => b.r - a.r).splice(10);
  },
  uniforms(gl, u, p, st, c, color) {
    const d = st.data;
    const n = Math.min(MAX_HOLES, st.holes.length);
    for (let i = 0; i < n; i++) {
      const h = st.holes[i];
      d[i * 4] = h.x; d[i * 4 + 1] = h.y; d[i * 4 + 2] = h.r; d[i * 4 + 3] = h.seed;
    }
    gl.uniform4fv(u.uHoles, d);
    gl.uniform1i(u.uCount, n);
    gl.uniform1f(u.uEdge, p.edge);
    gl.uniform1f(u.uChar, p.char);
    gl.uniform1f(u.uRough, p.rough);
    color('uGlowCol', p.glowCol);
    gl.uniform1f(u.uEmbers, p.embers);
    gl.uniform1f(u.uBehind, p.behind === 'ash' ? 1 : 0);
    gl.uniform1f(u.uHeal, st.healing ? st.heal : 0);
    gl.uniform1f(u.uShimmer, p.shimmer);
  },
});
