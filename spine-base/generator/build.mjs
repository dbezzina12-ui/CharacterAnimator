// Build character kits from the command line (the same code the app runs, in headless Chromium).
//   node spine-base/generator/build.mjs                       -> the two base characters into spine-base/export/ and reference/
//   node spine-base/generator/build.mjs --config my.json --out some/dir
// A config is either the settings object ({ "name": "Brute", "height": 800, "build": 1.5, ... }; see PRESETS in rig.js)
// or a character.json saved by the app (settings plus art placements; its art/*.png files are read from beside it).
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
import { startServer } from '../../scripts/serve.mjs';
import { PRESETS } from './rig.js';
const { chromium } = createRequire(import.meta.url)('playwright');
const here = path.dirname(fileURLToPath(import.meta.url)); const base = path.join(here, '..');
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; };

const jobs = [];
if (arg('config')) {
  const file = path.resolve(arg('config')); const doc = JSON.parse(fs.readFileSync(file, 'utf8')); const art = {};
  for (const [n, a] of Object.entries(doc.art || {})) { const p = path.join(path.dirname(file), a.file); if (fs.existsSync(p)) art[n] = { ...a, dataUrl: 'data:image/png;base64,' + fs.readFileSync(p).toString('base64') }; else console.warn(`art for ${n} not found at ${p}; using the placeholder`); }
  jobs.push({ config: doc.settings || doc.joints || doc, art, out: path.resolve(arg('out') || 'character-kit'), flat: true });
} else for (const id of ['human', 'dwarf']) jobs.push({ config: PRESETS[id], art: {}, out: path.join(base, 'export', id), reference: id });

const server = await startServer(0); const port = server.address().port;
const browser = await chromium.launch(); const page = await browser.newPage();
page.on('pageerror', (e) => { console.error('PAGE ERROR', e.message); process.exitCode = 1; });
await page.goto(`http://127.0.0.1:${port}/spine-base/generator/draw.html`); await page.waitForFunction(() => window.ready);
for (const job of jobs) {
  const res = await page.evaluate(({ config, art, scale }) => window.buildFiles(config, scale, art), { config: job.config, art: job.art, scale: +(arg('scale') || 2) });
  fs.rmSync(job.out, { recursive: true, force: true });
  for (const f of res.files) {
    // the base characters keep their sheets in reference/ so export/ holds only what a game loads
    const sheet = ['template.png', 'paint-sheet.png', 'paint-sheet.json', 'parts.json', 'ART-BRIEF.md'].includes(f.name);
    const dest = job.reference && sheet ? path.join(base, 'reference', `${job.reference}-${f.name}`) : path.join(job.out, f.name);
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, Buffer.from(f.b64, 'base64'));
  }
  const s = res.summary; console.log(`${res.file}: ${s.bones} bones, ${s.slots} slots, ${s.pieces} pieces, atlas ${s.atlas[0]}x${s.atlas[1]}, ${s.animations} animations -> ${path.relative(process.cwd(), job.out) || '.'}`);
}
await browser.close(); server.close();
