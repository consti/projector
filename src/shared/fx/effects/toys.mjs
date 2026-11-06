// The toys: three figurines from the coffee table — the alpaca, the leopard
// and the sumo — as real 3D models on the wall (assets/models, built by
// scripts/build-models.mjs). They tumble into the room as rigid bodies and
// pile on your shapes, parade along the floor and the tops of the shapes and
// hop to the beat, or stand on a turntable as big as the wall with the
// picture reflected in their paint.

import { R, B, C, S, Emitter, ZONES, spawnPoint } from './common.mjs';
import { World, polyBody } from '../bodies.mjs';
import { hexRgb } from '../glu.mjs';
import { toyRenderer, ToyBatches, TOYS, TOY_CHOICES, toyList, lightFromAngle, STRIDE } from '../mesh3d.mjs';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;
const wrapPi = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const FOOTPRINT = { alpaca: 0.6, leopard: 0.78, sumo: 0.8 };   // width over height, until the models are in

/** Fill one instance record: position, height, rotation, squash, pose, tint. */
function inst(o, x, y, z, size, yaw, pitch, roll, sx, sy, nod, swing, step, turn, r, g, b, a) {
  o[0] = x; o[1] = y; o[2] = z; o[3] = size; o[4] = yaw; o[5] = pitch; o[6] = roll;
  o[7] = sx; o[8] = sy; o[9] = nod; o[10] = swing; o[11] = step; o[12] = turn;
  o[13] = r; o[14] = g; o[15] = b; o[16] = a;
  return o;
}

/** A convex, slightly rounded box for the solver: a toy lands on a side, not a point. */
function hull(w, h) {
  const c = Math.min(w, h) * 0.3, hw = w / 2, hh = h / 2;
  return [[-hw + c, -hh], [hw - c, -hh], [hw, -hh + c], [hw, hh - c], [hw - c, hh], [-hw + c, hh], [-hw, hh - c], [-hw, -hh + c]];
}

const light = (p, over = {}) => ({
  light: lightFromAngle(p.lightAngle), lightCol: [1, 0.98, 0.95], ambient: [0.3, 0.31, 0.36],
  gloss: p.gloss, cam: null, ...over,
});

/** The terrain every walker reads: solid where the field is negative, plus the floor. */
const solid = (w, x, y) => (y >= w.aspect - 1e-4) || (x >= 0 && x <= 1 && y >= 0 && w.field.sample(x, y) < 0);
function surfaceBelow(w, x, yFrom, yTo) {
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
}
function topOfSolid(w, x, y, maxUp) {
  let t = y;
  for (let i = 0; i < 400; i++) {
    if (!solid(w, x, t - 0.002)) return t;
    t -= 0.002;
    if (y - t > maxUp) return null;
  }
  return null;
}

// ----------------------------------------------------------------- toy box ---
export const toydrop = {
  type: 'toydrop',
  label: 'Toy box',
  group: 'Toys',
  blend: 'over',
  hint: 'The alpaca, the leopard and the sumo tumble into the room as solid 3D toys, flail on the way down, land on your shapes and pile up.',
  actions: [{ name: 'burst', label: 'Tip the box' }, { name: 'clear', label: 'Clear' }, { name: 'shake', label: 'Shake' }],
  params: [
    R('count', 'Max toys', 40, 1, 200, 1),
    R('rate', 'Per second', 1.5, 0, 20, 0.1),
    S('toy', 'Which toy', 'all', TOY_CHOICES),
    S('from', 'Falls from', 'top', ZONES),
    R('size', 'Height', 0.12, 0.03, 0.4, 0.005),
    R('sizeVar', 'Size spread', 0.3, 0, 1),
    R('gravity', 'Gravity', 1, -1, 3),
    R('bounce', 'Bounce', 0.3, 0, 1.2),
    R('friction', 'Friction', 0.6, 0, 1),
    R('spin', 'Tumble', 1, 0, 3),
    R('flail', 'Flail in the air', 1, 0, 1),
    R('shadow', 'Contact shadow', 0.5, 0, 1),
    R('lightAngle', 'Light angle', 235, 0, 360, 1),
    R('gloss', 'Gloss', 0.35, 0, 1),
    R('life', 'Lifetime (s)', 40, 2, 180, 0.5),
  ],

  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const renderer = toyRenderer(gl);
    const batches = new ToyBatches(260);
    const shadows = new Float32Array(260 * 5);
    const rec = new Float32Array(STRIDE);
    const world = new World();
    world.iterations = 9;
    const emitter = new Emitter();
    const L = [0, 0];
    let time = 0;

    const spawn = (p, w, x, y) => {
      if (world.bodies.length >= p.count) return;
      const list = toyList(p.toy);
      const model = list[rng.int(list.length)];
      const h = Math.max(0.02, p.size * (1 + (rng.next() - 0.5) * p.sizeVar));
      const fp = renderer.models[model] ? renderer.models[model].footprint : FOOTPRINT[model];
      const data = { model, h, yaw: rng.range(-0.6, 0.6), wy: rng.gauss() * 1.5, face: rng.range(-0.5, 0.5), born: 0, seed: rng.next() * 100 };
      world.add(polyBody(x, y, hull(h * fp * 0.9, h * 0.92), {
        e: p.bounce * 0.6, mu: p.friction, density: 1,
        vx: rng.gauss() * 0.05, w: rng.gauss() * 2.5 * p.spin, angle: rng.range(-0.4, 0.4), data,
      }));
    };

    return {
      resize() {},
      action(name, arg, w, p) {
        if (name === 'clear') { world.clear(); return; }
        if (name === 'shake') {
          world.wakeAll();
          for (const b of world.bodies) { b.vx += rng.gauss() * 1.0; b.vy -= rng.next() * 0.9; b.w += rng.gauss() * 4; b.data.wy += rng.gauss() * 3; }
          return;
        }
        const pt = [0, 0];
        for (let i = 0; i < (arg || 10); i++) { spawnPoint(rng, p.from, w.aspect, pt); spawn(p, w, pt[0], pt[1]); }
      },
      step(dt, w, p) {
        time += dt;
        world.setStatics(w.field);
        const n = emitter.tick(dt, p.rate);
        const pt = [0, 0];
        for (let i = 0; i < n; i++) { spawnPoint(rng, p.from, w.aspect, pt); spawn(p, w, pt[0], pt[1]); }
        for (const it of w.interactors) {
          const r = it.r || 0.08, r2 = r * r;
          world.wake(it.x, it.y, r * 1.5);
          for (const b of world.bodies) {
            const dx = b.x - it.x, dy = b.y - it.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;
            const d = Math.sqrt(d2) || 1e-6;
            const f = (1 - d / r) * (it.strength == null ? 1 : it.strength);
            b.vx += (dx / d) * f * 1.8 + (it.vx || 0) * f;
            b.vy += (dy / d) * f * 1.8 + (it.vy || 0) * f;
            b.w += (rng.next() - 0.5) * f * 8;
            b.data.wy += rng.gauss() * f * 4;
          }
        }
        world.step(dt, { gy: w.gy * p.gravity, gx: w.wind[0] * 0.3, damping: 0.05 });
        let dead = false;
        for (const b of world.bodies) {
          const d = b.data;
          d.born += dt;
          const speed = Math.hypot(b.vx, b.vy);
          if (speed > 0.06 && b.awake) {
            d.yaw += d.wy * dt;
            d.wy *= 1 - dt * 0.6;
          } else {
            // at rest: settle to a presentable angle, the way a dropped toy ends up more or less facing out
            d.wy *= 1 - Math.min(1, dt * 5);
            const k = Math.round(d.yaw / TAU) * TAU + d.face;
            d.yaw = lerp(d.yaw, k, Math.min(1, dt * 2.5));
          }
          if (d.born > p.life || b.y > w.aspect + 0.4 || b.x < -0.4 || b.x > 1.4) { b.alive = false; dead = true; }
        }
        if (dead) world.remove((b) => !b.alive);
        while (world.bodies.length > p.count) world.bodies.shift();
      },
      draw(c) {
        const p = c.params;
        const bodies = world.bodies;
        if (renderer.error) throw new Error(renderer.error);
        if (!bodies.length || !renderer.ready) return;
        const a = (p.lightAngle * Math.PI) / 180;
        L[0] = Math.cos(a); L[1] = Math.sin(a);

        // contact shadows thrown along the light, tightening near a surface
        let ns = 0;
        if (p.shadow > 0.001) {
          const field = c.field;
          for (const b of bodies) {
            let sx = b.x, sy = b.y, hit = 0.35;
            for (let s = 0; s < 10; s++) {
              const dist = field.sample(sx, sy);
              if (dist < b.r * 0.6) { hit = s / 10; break; }
              const st = Math.min(dist, 0.035);
              sx += L[0] * st; sy += L[1] * st;
              if (s === 9) hit = 1;
            }
            const o = ns * 5;
            shadows[o] = sx; shadows[o + 1] = sy;
            shadows[o + 2] = b.r * (1 + hit * 2.6) * 0.9; shadows[o + 3] = b.r * (1 + hit * 2.6) * 0.7;
            shadows[o + 4] = p.shadow * (1 - hit) * Math.min(1, b.data.born * 4);
            ns++;
            if (ns >= 260) break;
          }
          renderer.shadows(c.dst, shadows, ns, c.aspect);
        }

        batches.reset();
        for (const b of bodies) {
          const d = b.data;
          const speed = Math.hypot(b.vx, b.vy);
          const air = clamp((speed - 0.08) / 0.3, 0, 1) * p.flail;
          const t = time * 1.0 + d.seed;
          const nod = air * Math.sin(t * 5.1) * 0.3;
          const swing = air * Math.sin(t * 9.3) * 0.9;
          const step = air * Math.sin(t * 7.7) * 0.7;
          const breathe = (1 - air) * Math.sin(t * 2.2) * 0.012;
          const fade = Math.min(1, d.born * 5);
          batches.add(d.model, inst(rec, b.x, b.y, (d.seed % 1) * 0.012, d.h, d.yaw, 0, -b.angle, 1 - breathe * 0.5, 1 + breathe, nod, swing, step, 0, 1, 1, 1, fade));
        }
        renderer.render(c.dst, batches, { ...light(p), aspect: c.aspect, opacity: c.opacity, screen: c.screen, anchor: 0.5 });
      },
      dispose() {},
    };
  },
};

// -------------------------------------------------------------- toy parade ---
// gait: how fast each toy walks (wall widths per second at the default height), its stride, and its hop
const GAIT = {
  alpaca: { speed: 0.075, stride: 0.5, hop: 1.0, legs: 0.5, arms: 0, sway: 0.03, bob: 0.02 },
  leopard: { speed: 0.06, stride: 0.42, hop: 0.35, legs: 0.3, arms: 0.1, sway: 0.11, bob: 0.03 },
  sumo: { speed: 0.045, stride: 0.6, hop: 0.15, legs: 0.6, arms: 0.4, sway: 0.07, bob: 0.035 },
};

export const toyparade = {
  type: 'toyparade',
  label: 'Toy parade',
  group: 'Toys',
  blend: 'over',
  hint: 'The figurines walk the floor and the tops of your shapes — the alpaca hops, the sumo stomps, the leopard waddles — jump up onto ledges, step off edges, hop to the beat and get knocked flying by a hand.',
  actions: [{ name: 'jump', label: 'Everybody jump' }, { name: 'turn', label: 'About face' }, { name: 'drop', label: 'Drop them in again' }],
  params: [
    R('count', 'How many', 6, 1, 40, 1),
    S('toy', 'Which toy', 'all', TOY_CHOICES),
    R('size', 'Height', 0.11, 0.03, 0.35, 0.005),
    R('speed', 'Pace', 1, 0, 3, 0.05),
    R('dance', 'Hop to the beat', 1, 0, 1),
    R('hop', 'Hop about', 0.7, 0, 1),
    B('climb', 'Jump onto the shapes', true),
    R('clumsy', 'Walk off edges', 0.5, 0, 1),
    R('knock', 'Hands knock them', 1, 0, 2),
    S('facing', 'Face', 'threequarter', [['threequarter', 'Three-quarter'], ['profile', 'Side on']]),
    R('shadow', 'Ground shadow', 0.5, 0, 1),
    R('lightAngle', 'Light angle', 235, 0, 360, 1),
    R('gloss', 'Gloss', 0.35, 0, 1),
  ],

  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const renderer = toyRenderer(gl);
    const batches = new ToyBatches(64);
    const shadows = new Float32Array(64 * 5);
    const rec = new Float32Array(STRIDE);
    const walkers = [];
    let time = 0, lastBeats = -1, beatPulse = 0;

    const make = (p, w, fromTop) => {
      const list = toyList(p.toy);
      const model = list[rng.int(list.length)];
      const h = p.size * (0.9 + rng.next() * 0.2);
      const x = rng.range(0.08, 0.92);
      return {
        model, h, x, y: fromTop ? -h * (0.5 + rng.next() * 2) : w.aspect, vx: 0, vy: 0,
        dir: rng.next() < 0.5 ? -1 : 1, state: 'air', t: 0, phase: rng.next() * TAU, yaw: 0,
        sq: 0, sqv: 0, roll: 0, rollV: 0, knocked: false, hopT: 1 + rng.next() * 2, idleT: 0,
        edgeCd: 0, seed: rng.next() * 100, born: 0, turnT: 0,
      };
    };
    const land = (b) => {
      b.state = 'walk'; b.vy = 0; b.vx = 0; b.sqv -= 5.5; b.knocked = false; b.rollV = 0; b.t = 0;
    };
    const launch = (b, vx, vy) => { b.state = 'air'; b.vx = vx; b.vy = vy; b.t = 0; b.sqv += 3; };
    const hop = (b, w, p, k = 1) => {
      const g = w.gy || 1.2;
      launch(b, b.dir * GAIT[b.model].speed * p.speed * (b.h / 0.11) * 0.6, -Math.sqrt(2 * g * b.h * 0.5 * k));
    };

    return {
      resize() {},
      action(name, arg, w, p) {
        if (name === 'jump') { for (const b of walkers) if (b.state === 'walk') hop(b, w, p, 1.6); return; }
        if (name === 'turn') { for (const b of walkers) b.dir = -b.dir; return; }
        if (name === 'drop') { walkers.length = 0; }
      },
      step(dt, w, p) {
        time += dt;
        // the roster follows the count; newcomers drop in from the top
        while (walkers.length < p.count) walkers.push(make(p, w, true));
        while (walkers.length > p.count) walkers.pop();
        // the beat: a hop on a new beat, a pulse to bob to
        const live = w.audio.live;
        beatPulse = live ? (w.audio.beat || 0) : 0;
        let onBeat = false;
        if (live && w.audio.beats !== lastBeats) { if (lastBeats >= 0) onBeat = true; lastBeats = w.audio.beats; }
        const g = w.gy || 1.2;

        for (const b of walkers) {
          const h = b.h, gait = GAIT[b.model];
          b.born += dt; b.t += dt; b.edgeCd -= dt; b.hopT -= dt; b.turnT -= dt;
          // the squash spring and the tumble
          b.sqv += (-b.sq * 180 - b.sqv * 14) * dt; b.sq += b.sqv * dt;
          if (b.knocked) b.roll += b.rollV * dt; else b.roll = lerp(b.roll, 0, Math.min(1, dt * 8));
          // hands
          for (const it of w.interactors) {
            const r = (it.r || 0.08) + h * 0.3;
            const dx = b.x - it.x, dy = (b.y - h * 0.5) - it.y;
            const d = Math.hypot(dx, dy);
            if (d > r || p.knock <= 0) continue;
            const f = (1 - d / r) * (it.strength == null ? 1 : it.strength) * p.knock;
            if (f < 0.05) continue;
            launch(b, (dx / (d || 1e-6)) * f * 0.8 + (it.vx || 0) * f * 0.6, -0.5 * f - 0.35 + Math.min(0, (it.vy || 0) * f));
            b.knocked = true; b.rollV = (rng.next() < 0.5 ? -1 : 1) * (6 + rng.next() * 6) * f;
            b.dir = dx > 0 ? 1 : -1;
          }

          if (b.state === 'air') {
            b.vy += g * dt;
            b.x += b.vx * dt; b.y += b.vy * dt;
            if (b.x < 0.02) { b.x = 0.02; b.vx = Math.abs(b.vx) * 0.5; b.dir = 1; }
            if (b.x > 0.98) { b.x = 0.98; b.vx = -Math.abs(b.vx) * 0.5; b.dir = -1; }
            if (b.vy > 0) {
              const gnd = surfaceBelow(w, b.x, b.y - h * 0.25, b.y + 0.015);
              if (gnd && !gnd.blocked) { b.y = gnd.y; land(b); }
              else if (gnd && gnd.blocked) { const top = topOfSolid(w, b.x, b.y - h * 0.25, h); if (top != null) { b.y = top; land(b); } }
            }
            if (b.y > w.aspect + 0.5) Object.assign(b, make(p, w, true), { model: b.model, h: b.h });
            continue;
          }

          // on the ground: keep to it (a shape under us may move or vanish)
          const gnd = surfaceBelow(w, b.x, b.y - h * 0.2, b.y + h * 0.35);
          if (!gnd || gnd.blocked) {
            if (gnd && gnd.blocked) { const top = topOfSolid(w, b.x, b.y - h * 0.2, h); if (top != null) { b.y = top; } else { launch(b, 0, 0); continue; } }
            else { launch(b, b.dir * gait.speed * p.speed * 0.5, 0); continue; }
          } else if (gnd.y - b.y > h * 0.3) { launch(b, b.dir * gait.speed * p.speed * 0.5, 0); continue; }
          else b.y = lerp(b.y, gnd.y, Math.min(1, dt * 15));

          if (onBeat && p.dance > 0 && rng.next() < 0.45 + 0.5 * p.dance) { hop(b, w, p, 0.7 + p.dance * 0.9); continue; }
          if (b.state === 'idle') {
            b.idleT -= dt;
            if (b.idleT <= 0) { b.state = 'walk'; if (rng.next() < 0.4) b.dir = -b.dir; }
            continue;
          }

          // walking: the ground ahead
          const sp = gait.speed * p.speed * (h / 0.11);
          const lookX = b.x + b.dir * h * 0.35;
          if (lookX <= 0.015 || lookX >= 0.985) { b.dir = -b.dir; b.turnT = 0.5; }
          else if (solid(w, lookX, b.y - h * 0.3)) {
            // a wall: jump onto it if it is low enough, else turn
            const top = topOfSolid(w, lookX, b.y - h * 0.3, h * 2.2);
            if (p.climb && top != null && b.y - top <= h * 1.9 && b.turnT <= 0) {
              const up = b.y - top + h * 0.35;
              launch(b, b.dir * (sp * 1.2 + h * 0.6), -Math.sqrt(2 * g * up));
              continue;
            }
            b.dir = -b.dir; b.turnT = 0.8;
          } else {
            const ahead = surfaceBelow(w, lookX, b.y - h * 0.2, b.y + h * 4);
            const drop = !ahead || ahead.blocked || ahead.y - b.y > h * 0.3;
            if (drop && b.edgeCd <= 0) {
              const depth = ahead && !ahead.blocked ? ahead.y - b.y : 9;
              if (!(depth < h * 3 && rng.next() < p.clumsy) && !(depth < h * 1.2)) { b.dir = -b.dir; b.turnT = 0.8; }
              b.edgeCd = 0.6;
            }
          }
          b.x = clamp(b.x + b.dir * sp * dt, 0.02, 0.98);
          b.phase += (sp * dt) / (h * gait.stride) * TAU;
          // the alpaca mostly hops; the others now and then
          if (b.hopT <= 0) {
            b.hopT = (b.model === 'alpaca' ? 0.5 : 2) + rng.next() * 3;
            if (rng.next() < p.hop * gait.hop) { hop(b, w, p, b.model === 'alpaca' ? 1 : 0.7); continue; }
            if (rng.next() < 0.25) { b.state = 'idle'; b.idleT = 1 + rng.next() * 3; }
          }
        }
      },
      draw(c) {
        const p = c.params;
        if (renderer.error) throw new Error(renderer.error);
        if (!walkers.length || !renderer.ready) return;
        const faceA = p.facing === 'profile' ? 1.45 : 0.95;
        let ns = 0;
        batches.reset();
        for (const b of walkers) {
          const gait = GAIT[b.model];
          const h = b.h;
          const air = b.state === 'air' ? 1 : 0;
          // gait pose; in the air the legs tuck and the arms go up
          let step = Math.sin(b.phase) * gait.legs, swing = -Math.sin(b.phase) * gait.arms;
          let nod = Math.cos(b.phase * 2) * 0.04 + beatPulse * 0.12 * p.dance;
          let roll = Math.sin(b.phase) * gait.sway - b.dir * 0.05;
          if (air) { step = 0.45 + (b.knocked ? Math.sin(b.t * 20) * 0.4 : 0); swing = b.knocked ? Math.sin(b.t * 25) * 0.9 : 0.6; nod = b.knocked ? Math.sin(b.t * 15) * 0.3 : -0.25; roll = b.roll - b.vx * 0.3; }
          if (b.state === 'idle') { step = 0; swing = Math.sin(b.t * 2.5 + b.seed) * 0.12; nod = Math.sin(b.t * 1.7 + b.seed) * 0.08; roll = 0; }
          // a glance at the nearest hand
          let turn = 0;
          if (c.interactors.length) {
            const it = c.interactors[0];
            turn = clamp(wrapPi(Math.atan2(it.x - b.x, 0.3) - b.yaw), -1.1, 1.1);
          }
          const yawTarget = b.dir * faceA;
          b.yaw = lerp(b.yaw, yawTarget, Math.min(1, 0.12));
          const sq = b.sq + beatPulse * 0.06 * p.dance;
          const sy = clamp(1 + sq, 0.6, 1.5), sx = 1 / Math.sqrt(sy);
          const bob = air ? 0 : Math.abs(Math.sin(b.phase)) * gait.bob * h * (b.state === 'walk' ? 1 : 0);
          const fade = Math.min(1, b.born * 3);
          batches.add(b.model, inst(rec, b.x, b.y - bob, (b.seed % 1) * 0.012, h, b.yaw, 0, roll, sx, sy, nod, swing, step, turn, 1, 1, 1, fade));
          if (p.shadow > 0.001 && ns < 64) {
            // the shadow sits on the ground under the toy, even in the air
            let gy = b.y, lift = 0;
            if (air) { const g = surfaceBelow(c, b.x, b.y - h * 0.2, c.aspect + 0.01); gy = g && !g.blocked ? g.y : c.aspect; lift = clamp((gy - b.y) / (h * 2), 0, 1); }
            const o = ns * 5;
            shadows[o] = b.x; shadows[o + 1] = gy;
            shadows[o + 2] = h * (0.32 + lift * 0.3) * sx; shadows[o + 3] = h * (0.1 + lift * 0.1);
            shadows[o + 4] = p.shadow * (0.9 - lift * 0.6) * fade;
            ns++;
          }
        }
        if (ns) renderer.shadows(c.dst, shadows, ns, c.aspect);
        renderer.render(c.dst, batches, { ...light(p), aspect: c.aspect, opacity: c.opacity, screen: c.screen, anchor: 0 });
      },
      dispose() {},
    };
  },
};

// ------------------------------------------------------------ toy showcase ---
export const toyshow = {
  type: 'toyshow',
  label: 'Toy showcase',
  group: 'Toys',
  blend: 'post',
  hint: 'One figurine as big as the wall on a turntable, lit like a product shot with the picture reflected in its paint, a mirror floor under it. It bounces on the beat, looks at the pointer, and the three take turns.',
  actions: [{ name: 'jump', label: 'Jump' }, { name: 'spin', label: 'Pirouette' }, { name: 'next', label: 'Next toy' }],
  params: [
    S('toy', 'Star', 'cycle', [['cycle', 'They take turns'], ['trio', 'All three'], ...TOYS.map((t) => [t, TOY_CHOICES.find((c) => c[0] === t)[1]])]),
    R('x', 'Position x', 0.5, 0, 1, 0.001),
    R('y', 'Position y', 0.86, 0, 1, 0.001),
    R('size', 'Height', 0.42, 0.05, 1.2, 0.005),
    R('spin', 'Turntable', 0.06, -0.6, 0.6, 0.005),
    R('every', 'Take turns every (s)', 12, 2, 60, 0.5),
    B('followPointer', 'Look at the pointer', true),
    R('bounce', 'Bounce on the beat', 1, 0, 1),
    R('fidget', 'Fidget', 0.6, 0, 1),
    C('keyColor', 'Key light', '#fff3dc'),
    C('rimColor', 'Rim light', '#45cfff'),
    R('lightAngle', 'Light angle', 215, 0, 360, 1),
    R('gloss', 'Gloss', 0.6, 0, 1),
    R('reflect', 'Reflect the picture', 0.35, 0, 1),
    R('mirror', 'Mirror floor', 0.45, 0, 1),
    R('shadow', 'Shadow', 0.6, 0, 1),
  ],

  create(ctx) {
    const gl = ctx.gl;
    const rng = ctx.rng;
    const renderer = toyRenderer(gl);
    const batches = new ToyBatches(8);
    const shadows = new Float32Array(8 * 5);
    const rec = new Float32Array(STRIDE);
    const keyCol = [1, 1, 1], rimCol = [0, 0, 0];
    // one spring set per slot: height off the floor, squash, scale (the grow-in), turn and nod towards the pointer
    const slots = TOYS.map((m, i) => ({ model: m, y: 0, vy: 0, sq: 0, sqv: 0, scale: 0, scaleV: 0, turn: 0, nod: 0, flourish: 0, seed: i * 37 }));
    let time = 0, which = 0, swapT = 0, lastBeats = -1, beatN = 0, turntable = -0.5, lastMode = '';
    const G = 3.2;      // the showcase has its own gravity: a toy this big needs a slower arc

    const jump = (s, k = 1) => { if (s.y >= -1e-4) { s.vy = -Math.sqrt(2 * G * 0.22 * k); s.sqv += 2.5; } };

    return {
      resize() {},
      action(name, arg, w, p) {
        if (name === 'jump') { for (const s of slots) jump(s, 1.3); return; }
        if (name === 'spin') { for (const s of slots) s.flourish += TAU; return; }
        if (name === 'next') { swapT = 1e9; }
      },
      step(dt, w, p) {
        time += dt;
        const mode = p.toy;
        if (mode !== lastMode) { lastMode = mode; if (TOYS.includes(mode)) which = TOYS.indexOf(mode); }
        // who is on: the trio, one fixed toy, or the next in turn
        const active = new Set(mode === 'trio' ? TOYS : [TOYS[which]]);
        if (mode === 'cycle') {
          swapT += dt;
          if (swapT >= p.every) { swapT = 0; which = (which + 1) % TOYS.length; slots[which].flourish += TAU * 0.5; }
        }
        turntable += p.spin * TAU * dt;
        // the beat
        const live = w.audio.live;
        let onBeat = false;
        if (live && w.audio.beats !== lastBeats) { if (lastBeats >= 0) onBeat = true; lastBeats = w.audio.beats; beatN++; }
        const ptr = p.followPointer && w.interactors.length ? w.interactors[0] : null;
        const size = p.size;
        slots.forEach((s, i) => {
          const on = active.has(s.model);
          // grow in, shrink out
          s.scaleV += ((on ? 1 : 0) - s.scale) * 90 * dt - s.scaleV * 11 * dt; s.scale += s.scaleV * dt;
          if (s.scale < 0.002 && !on) s.scale = 0;
          // bounce
          if (on && onBeat && p.bounce > 0) {
            const strong = (w.audio.bass || 0) > 0.55;
            if (mode !== 'trio' || strong || beatN % TOYS.length === i) jump(s, (0.6 + p.bounce * 0.7) * (strong ? 1.3 : 1));
          }
          if (s.y < 0 || s.vy < 0) {
            s.vy += G * dt * (size / 0.42); s.y += s.vy * dt;
            if (s.y >= 0) { s.y = 0; s.vy = 0; s.sqv -= 6; }
          }
          s.sqv += (-s.sq * 160 - s.sqv * 13) * dt; s.sq += s.sqv * dt;
          s.flourish = lerp(s.flourish, 0, Math.min(1, dt * 2.2));
          // a look at the pointer
          const x = p.x + (mode === 'trio' ? (i - 1) * size * 0.8 : 0);
          let turn = 0, nod = 0;
          if (ptr) {
            const yaw = turntable + s.flourish + (mode === 'trio' ? i * 0.5 : 0);
            turn = clamp(wrapPi(Math.atan2(ptr.x - x, 0.35) - yaw), -1.0, 1.0);
            nod = clamp(((p.y * w.aspect - size * 0.75) - ptr.y) / (size * 0.6), -0.45, 0.45);
          }
          s.turn = lerp(s.turn, turn, Math.min(1, dt * 6));
          s.nod = lerp(s.nod, nod, Math.min(1, dt * 6));
        });
      },
      draw(c) {
        const p = c.params;
        c.screen.copy(c.src, c.dst);
        if (renderer.error) throw new Error(renderer.error);
        if (!renderer.ready) return;
        hexRgb(p.keyColor, keyCol); hexRgb(p.rimColor, rimCol);
        const size = p.size;
        const y = p.y * c.aspect;
        const mode = p.toy;
        batches.reset();
        let ns = 0;
        slots.forEach((s, i) => {
          if (s.scale <= 0.001) return;
          const x = p.x + (mode === 'trio' ? (i - 1) * size * 0.8 : 0);
          const h = size * s.scale;
          const t = time + s.seed;
          const yaw = turntable + s.flourish + (mode === 'trio' ? i * 0.5 : 0);
          const f = p.fidget;
          const nod = s.nod + Math.sin(t * 1.1) * 0.06 * f;
          const swing = Math.sin(t * 1.7) * 0.14 * f;
          const step = Math.sin(t * 0.9) * 0.08 * f;
          const sy = clamp(1 + s.sq + Math.sin(t * 2.3) * 0.01 * f, 0.6, 1.5), sx = 1 / Math.sqrt(sy);
          const lift = -s.y * size;
          batches.add(s.model, inst(rec, x, y - lift, 0, h, yaw, 0, 0, sx, sy, nod, swing, step, s.turn, 1, 1, 1, 1));
          if (p.mirror > 0.001) batches.add(s.model, inst(rec, x, y + lift, 0, h, yaw, 0, 0, sx, -sy, nod, swing, step, s.turn, 0.75, 0.78, 0.85, p.mirror));
          if (p.shadow > 0.001 && ns < 8) {
            const up = clamp(-s.y / 0.3, 0, 1);
            const o = ns * 5;
            shadows[o] = x; shadows[o + 1] = y;
            shadows[o + 2] = h * (0.32 + up * 0.25) * sx; shadows[o + 3] = h * (0.07 + up * 0.05);
            shadows[o + 4] = p.shadow * (1 - up * 0.6);
            ns++;
          }
        });
        if (ns) renderer.shadows(c.dst, shadows, ns, c.aspect);
        renderer.render(c.dst, batches, {
          ...light(p, { lightCol: keyCol, rimCol, ambient: [0.22, 0.23, 0.28] }),
          aspect: c.aspect, opacity: c.opacity, screen: c.screen, anchor: 0,
          bg: c.src, reflect: p.reflect, fade: 1.6,
        });
      },
      dispose() {},
    };
  },
};
