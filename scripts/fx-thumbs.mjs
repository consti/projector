#!/usr/bin/env node
// Capture a thumbnail of every effect from the running app, for the Effects
// catalogue. Start the app with a video playing and remote debugging on:
//
//   npx electron . --remote-debugging-port=9222
//   node scripts/fx-thumbs.mjs            # all effects
//   node scripts/fx-thumbs.mjs sand vhs   # just these
//
// Each effect is put on the stack alone, given a few seconds to develop, and
// the control preview is captured with the mapping handles hidden. Output goes
// to src/renderer/control/fx-thumbs/<type>.jpg (720 px wide) via `sips`.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'renderer', 'control', 'fx-thumbs');
const PORT = process.env.CDP_PORT || 9222;
const only = process.argv.slice(2);

// effects that need time to build up before they look like anything
const WAIT = { tetris: 9000, burn: 7000, feedback: 4000, shatter: 4000, water: 5000, snow: 5000, sand: 14000, vines: 12000,
  goo: 4000, balls: 4000, shapes: 4000, emoji: 4000, confetti: 3500, ink: 5000, smoke: 5000, fire: 5000, frost: 7000, shockwave: 2600 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Page {
  static async connect(title) {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const t = list.find((x) => x.title === title);
    if (!t) throw new Error(`no window titled "${title}" on port ${PORT}; is the app running with --remote-debugging-port?`);
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const p = new Page(); p.ws = ws; p.id = 0; p.pending = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      const w = d.id && p.pending.get(d.id);
      if (w) { p.pending.delete(d.id); d.error ? w.rej(new Error(JSON.stringify(d.error))) : w.res(d.result); }
    };
    return p;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

const c = await Page.connect('Projector');
const reg = await c.eval(`import('/shared/fx/system.mjs').then((m) => [...m.REGISTRY.keys()])`);
const list = only.length ? reg.filter((t) => only.includes(t)) : reg;
fs.mkdirSync(OUT, { recursive: true });

// remember what was on the stack, hide the handles
const saved = await c.eval(`(() => { const d = window.__dev; const fx = d.project.fx;
  const s = { layers: fx.layers, enabled: fx.enabled, handles: d.stage.showHandles, view: d.currentView };
  d.stage.showHandles = false; d.stage.draw(); return JSON.stringify({ layers: s.layers, enabled: s.enabled, handles: s.handles }); })()`);

for (const type of list) {
  await c.eval(`import('/shared/schema.mjs').then((m) => { const d = window.__dev; const fx = d.project.fx;
    fx.layers = [m.defaultFxLayer(${JSON.stringify(type)})]; fx.enabled = true; fx.preview = true; d.push(true); d.rebuild(); return true; })`);
  await sleep(WAIT[type] || 3000);
  const err = await c.eval(`(() => { const s = window.__dev.fxHost.stats(); return s && s.error || null; })()`);
  const clip = await c.eval(`(() => { const r = document.querySelector('#frame').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 }; })()`);
  const shot = await c.send('Page.captureScreenshot', { format: 'png', clip });
  const png = path.join(OUT, type + '.png');
  fs.writeFileSync(png, Buffer.from(shot.data, 'base64'));
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '74', '-Z', '720', png, '--out', path.join(OUT, type + '.jpg')], { stdio: 'ignore' });
  fs.unlinkSync(png);
  console.log(type.padEnd(14), err ? 'ERROR ' + err.split('\n')[0] : 'ok');
}

// put things back
await c.eval(`(() => { const d = window.__dev; const s = ${JSON.stringify(saved)}; const o = JSON.parse(s);
  d.project.fx.layers = o.layers; d.project.fx.enabled = o.enabled; d.stage.showHandles = o.handles; d.push(true); d.rebuild(); d.stage.draw(); return true; })()`);
c.ws.close();
