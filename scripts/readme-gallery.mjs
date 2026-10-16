#!/usr/bin/env node
// Rewrite the galleries in README.md: the effects between the gallery markers,
// from the effects registered in src/shared/fx/effects/index.mjs and the
// thumbnails captured by scripts/fx-thumbs.mjs; and the visuals scenes between
// the visuals markers, from VISUAL_SCENES and the frames rendered by
// scripts/visual-thumbs.mjs. Run after adding an effect or a scene.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VISUAL_SCENES } from '../src/shared/visuals.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FX = path.join(ROOT, 'src', 'shared', 'fx', 'effects');
const index = fs.readFileSync(path.join(FX, 'index.mjs'), 'utf8');
const order = index.match(/export const EFFECTS = \[([\s\S]*?)\];/)[1].split(/[\s,]+/).filter(Boolean);

// type -> { label, group } by scanning every effect module
const meta = {};
for (const f of fs.readdirSync(FX)) {
  if (!f.endsWith('.mjs') || f === 'index.mjs') continue;
  const src = fs.readFileSync(path.join(FX, f), 'utf8');
  const re = /type:\s*'([a-z0-9]+)',\s*\n\s*label:\s*'([^']+)',\s*\n\s*group:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src))) meta[m[1]] = { label: m[2], group: m[3] };
}

const groups = new Map();
for (const t of order) {
  const m = meta[t]; if (!m) continue;
  if (!groups.has(m.group)) groups.set(m.group, []);
  groups.get(m.group).push({ type: t, label: m.label });
}

let out = '';
for (const [g, list] of groups) {
  out += `\n**${g}**\n\n<table><tr>\n`;
  list.forEach((e, i) => {
    if (i && i % 4 === 0) out += '</tr><tr>\n';
    const img = fs.existsSync(path.join(ROOT, 'src/renderer/control/fx-thumbs', e.type + '.jpg'))
      ? `<img src="src/renderer/control/fx-thumbs/${e.type}.jpg" width="220" alt="${e.label}"><br>` : '';
    out += `<td align="center" valign="top">${img}<sub>${e.label}</sub></td>\n`;
  });
  out += '</tr></table>\n';
}

// the visuals: one table, four to a row, in the order of the scene menu
let vis = '\n<table><tr>\n';
VISUAL_SCENES.forEach(([id, label], i) => {
  if (i && i % 4 === 0) vis += '</tr><tr>\n';
  const img = fs.existsSync(path.join(ROOT, 'src/renderer/control/visual-thumbs', id + '.jpg'))
    ? `<img src="src/renderer/control/visual-thumbs/${id}.jpg" width="220" alt="${label}"><br>` : '';
  vis += `<td align="center" valign="top">${img}<sub>${label}</sub></td>\n`;
});
vis += '</tr></table>\n';

const readme = path.join(ROOT, 'README.md');
let md = fs.readFileSync(readme, 'utf8');
function splice(start, end, body) {
  if (!md.includes(start) || !md.includes(end)) throw new Error('README has no ' + start + ' markers');
  md = md.slice(0, md.indexOf(start) + start.length) + '\n' + body + '\n' + md.slice(md.indexOf(end));
}
splice('<!-- gallery:start -->', '<!-- gallery:end -->', out);
splice('<!-- visuals:start -->', '<!-- visuals:end -->', vis);
fs.writeFileSync(readme, md);
console.log('gallery:', order.length, 'effects in', groups.size, 'groups;', VISUAL_SCENES.length, 'visuals scenes');
