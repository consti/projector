import balls from './balls.mjs';
import water from './water.mjs';
import { smoke, fire, ink } from './gas.mjs';
import snow from './snow.mjs';
import sand from './sand.mjs';
import ripples from './ripples.mjs';
import shatter from './shatter.mjs';
import { confetti, fireflies } from './sparkle.mjs';
import { lightning, aurora, blackhole } from './energy.mjs';
import { bubbles, goo } from './blobs.mjs';
import rain from './rain.mjs';
import vines from './vines.mjs';
import { shapes, emoji } from './objects.mjs';
import { kaleido, droste, feedback, tessellate, hyperbolic, tunnel, acid, fliptiles, chrome } from './trippy.mjs';
import { synthwave, vhs, glitch } from './retro.mjs';
import { mirror, room, burn } from './illusion.mjs';
import { shadows, extrude, aura, stagelights, neon, fieldlines, shockwave, glassrim, plasma, frost, contour } from './shapes.mjs';
import { halftone, ascii, eightbit, painterly, thermal, stainedglass } from './look.mjs';
import tetris from './tetris.mjs';
import { reaction, life, rule, coral, symmetry, sprawl, aleph, pointcloud, plexus, digits, treemap, quasicrystal,
  interference, weave, flowlines, moire, joyplot, parallax, circular, dust, bars, etching, polyhedra } from './generative.mjs';

export const EFFECTS = [
  balls, shapes, emoji, water, smoke, fire, ink, snow, rain, sand, ripples,
  shatter, bubbles, goo, confetti, fireflies, lightning, aurora, blackhole, vines,
  tetris, burn,
  kaleido, droste, feedback, tessellate, hyperbolic, tunnel, acid, mirror, room, fliptiles, chrome,
  synthwave, vhs, glitch,
  halftone, ascii, eightbit, painterly, thermal, stainedglass,
  reaction, life, rule, coral, symmetry, sprawl, aleph, pointcloud, plexus, digits, treemap, quasicrystal,
  interference, weave, flowlines, moire, joyplot, parallax, circular, dust, bars, etching, polyhedra,
  shadows, extrude, aura, fieldlines, shockwave, glassrim, plasma, frost, contour, stagelights, neon,
];
