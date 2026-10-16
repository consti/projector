// Capture a screenshot of every Visuals scene (the generated pictures that
// replace a video, src/shared/visuals.mjs) for the README.
//
//   npx electron scripts/visual-thumbs.mjs                # every scene
//   npx electron scripts/visual-thumbs.mjs lasers julia   # just these
//   npx electron scripts/visual-thumbs.mjs julia --flow=80 --key=x --out=/tmp/try   # try another moment
//
// Unlike fx-thumbs.mjs this does not need the app running or a video playing:
// it opens its own hidden window, renders each scene's shader once at 1080p
// with the real Visuals class, and feeds it one fixed, made-up moment of music
// (a loud bar on the beat), so the pictures come out the same every run.
// Output goes to src/renderer/control/visual-thumbs/<scene>.jpg (720 px wide) via `sips`.

import { app, BrowserWindow, protocol } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const flag = (name) => { const a = process.argv.find((x) => x.startsWith('--' + name + '=')); return a ? a.slice(name.length + 3) : null; };
const OUT = flag('out') ? path.resolve(flag('out')) : path.join(ROOT, 'src', 'renderer', 'control', 'visual-thumbs');
const only = process.argv.slice(2).filter((a) => !a.startsWith('-') && !/\.mjs$/.test(a) && a !== '.');
const over = {};                              // --flow= and --key= override every shot in this run
if (flag('flow') != null) over.flow = +flag('flow');
if (flag('key') != null) over.key = flag('key');

// Where in its run each scene is caught, and for which "track": the track's
// name seeds the palette and the scene's variations, exactly as in the app.
// `flow` is the scene's own audio-driven time in seconds.
const DEFAULT_SHOT = { flow: 40, beats: 3 };
const SHOTS = {
  tunnel: { flow: 200 },
  mandelbrot: { flow: 130 },
  mandelbox: { flow: 70 },
  sierpinski: { flow: 70 },
  cathedral: { flow: 70 },
  burningship: { flow: 70 },
  lyapunov: { flow: 130 },
  train: { cfg: { city: 'towers', daytime: 'night' } },
};
// a few more of the train ride, one per city and hour, for the README
const VARIANTS = [
  ['train-lowrise-day', 'train', { flow: 40, key: 'readme:train:2', cfg: { city: 'lowrise', daytime: 'day' } }],
  ['train-neon-dusk', 'train', { flow: 40, key: 'readme:train:3', cfg: { city: 'neon', daytime: 'dusk' } }],
  ['train-towers-sunset', 'train', { flow: 40, key: 'readme:train:4', cfg: { city: 'towers', daytime: 'sunset' } }],
  ['train-wire-night', 'train', { flow: 40, key: 'readme:train:5', cfg: { city: 'wire', daytime: 'night' } }],
];

// its own profile, so it never touches the real app's session (which may be running)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'projector-visual-thumbs-'));
app.setPath('userData', profile);
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
if (app.dock) app.dock.hide();

// runs in the page: one frame of one scene, read back as a PNG data URL
const RENDER = async (id, shot) => {
  const { Visuals } = await import('/shared/visuals.mjs');
  const st = (window.__thumbs ||= {});
  if (!st.gl) {
    st.gl = document.createElement('canvas').getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!st.gl) throw new Error('no WebGL2');
  }
  const gl = st.gl;
  // a loud moment on the beat: bass-heavy, a couple of peaks further up
  const spectrum = Array.from({ length: 48 }, (_, b) =>
    Math.min(1, 0.18 + 0.7 * Math.exp(-b / 12) + 0.35 * Math.pow(Math.abs(Math.sin(b * 0.83 + 1.1)), 3) * (1 - b / 70)));
  const audio = { level: 0.65, bass: 0.75, low: 0.6, mid: 0.5, high: 0.4, air: 0.3, beat: 0.55, spectrum, ...(shot.audio || {}) };
  const v = new Visuals(gl);     // fresh each time: nothing carries over between scenes
  v.flow = shot.flow; v.beats = shot.beats;
  const r = v.render({ w: 1920, h: 1080, time: 0, audio, key: shot.key || 'readme:' + id, playing: true,
    cfg: { scene: id, ...(shot.cfg || {}) } });
  if (v.error) throw new Error(v.error);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, r.tex, 0);
  const px = new Uint8ClampedArray(r.w * r.h * 4);
  gl.readPixels(0, 0, r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  v.dispose();
  // the scenes draw row 0 as the top of the picture, which is ImageData's order too
  const cv = document.createElement('canvas'); cv.width = r.w; cv.height = r.h;
  cv.getContext('2d').putImageData(new ImageData(px, r.w, r.h), 0, 0);
  return { url: cv.toDataURL('image/png'), w: r.w, h: r.h };
};

let failed = 0;
// not a top-level await: Electron holds back `ready` until this module has finished loading
app.whenReady().then(async () => {
try {
  protocol.handle('app', async (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname);
    if (rel === '/__thumbs') return new Response('<!doctype html><title>visual thumbs</title>', { headers: { 'content-type': 'text/html' } });
    const file = path.normalize(path.join(SRC, rel));
    if (!file.startsWith(SRC + path.sep)) return new Response('forbidden', { status: 403 });
    try { return new Response(await fs.promises.readFile(file), { headers: { 'content-type': 'text/javascript' } }); }
    catch { return new Response('not found: ' + rel, { status: 404 }); }
  });
  const win = new BrowserWindow({ show: false, width: 640, height: 360, webPreferences: { backgroundThrottling: false } });
  await win.loadURL('app://ui/__thumbs');

  const { VISUAL_SCENES } = await import(path.join(SRC, 'shared', 'visuals.mjs'));
  // every scene, then the variants; a scene named on the command line brings its variants along
  const jobs = VISUAL_SCENES.map(([id, label]) => [id, id, label, { ...DEFAULT_SHOT, ...(SHOTS[id] || {}), ...over }])
    .concat(VARIANTS.map(([file, id, shot]) => [file, id, file, { ...DEFAULT_SHOT, ...shot, ...over }]));
  const unknown = only.filter((a) => !jobs.some(([file, id]) => id === a || file === a));
  if (unknown.length) throw new Error('no such scene: ' + unknown.join(', '));
  const list = only.length ? jobs.filter(([file, id]) => only.includes(id) || only.includes(file)) : jobs;
  fs.mkdirSync(OUT, { recursive: true });

  for (const [file, id, label, shot] of list) {
    try {
      const t0 = Date.now();
      const r = await win.webContents.executeJavaScript(`(${RENDER})(${JSON.stringify(id)}, ${JSON.stringify(shot)})`);
      const png = path.join(OUT, file + '.png');
      fs.writeFileSync(png, Buffer.from(r.url.split(',')[1], 'base64'));
      execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-Z', '720', png, '--out', path.join(OUT, file + '.jpg')], { stdio: 'ignore' });
      fs.unlinkSync(png);
      console.log(file.padEnd(22), 'ok', `${r.w}x${r.h}`.padEnd(10), (Date.now() - t0) + ' ms', ' ' + label);
    } catch (e) {
      failed++;
      console.log(file.padEnd(22), 'ERROR ' + String(e.message || e).split('\n')[0]);
    }
  }
} catch (e) {
  failed++;
  console.error(e.message || e);
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(failed ? 1 : 0);
}
});
