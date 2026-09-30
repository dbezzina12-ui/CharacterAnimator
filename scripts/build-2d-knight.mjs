// Builds the editable 2D knight project (gamboligy.character2d/1.0) from the 3D knight through the
// fixed art-camera bridge: node scripts/build-2d-knight.mjs [--clips=idle,hover_sword_vigil] [--out=dir]
//   [--character=knight|dwarf]
// Writes <out>/character.json + <out>/images/*.png (+ reference/ if the concept image is available).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, CHROME, CHROME_ARGS } from './serve.mjs';

const arg = (k, d = null) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const which = arg('character', 'knight');
const clips = arg('clips') ? arg('clips').split(',') : null;
const out = path.resolve(arg('out', which === 'knight' ? 'characters2d/aureate_knight' : `characters2d/${which}_2d`));
const pageUrl = which === 'knight' ? 'viewer/knight.html?hideui=1' : `viewer/index.html?hideui=1&character=${which}`;

fs.rmSync(path.join(out, 'images'), { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'images'), { recursive: true });
const server = await startServer(0);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [...CHROME_ARGS, '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
page.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[2d]')) console.log(m.text()); });
await page.exposeFunction('art2dWrite', (rel, b64) => {
  const p = path.join(out, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(b64, 'base64'));
});
await page.goto(`http://127.0.0.1:${server.address().port}/${pageUrl}`);
await page.waitForFunction(() => window.viewer?.ready || window.viewer?.error, null, { timeout: 60000 });
const t0 = Date.now();
const project = await page.evaluate(async ({ which, clips, debug }) => {
  const specs = await import('./js/art2d/specs.js');
  const { buildStarterProject } = await import('./js/art2d/starter.js');
  const spec = which === 'knight' ? specs.KNIGHT : specs.plainSpec(`${which}_2d`, `${which} — 2D starter skin`, which);
  viewer.state.suspendLoop = true;
  viewer.state.playing = false;
  if (debug) spec.debug = true;
  const p = await buildStarterProject(viewer, spec, { write: (a, b) => window.art2dWrite(a, b), log: (m) => console.log('[2d] ' + m), clips: clips || spec.clips || null });
  viewer.state.suspendLoop = false;
  return p;
}, { which, clips, debug: process.argv.includes('--debug') });
console.log(`built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const ref = '/tmp/claude-0/handoff/Reference/01-Knight-Target-Style.png';
if (which === 'knight' && fs.existsSync(ref) && !fs.existsSync(path.join(out, 'reference/knight-concept.png'))) {
  fs.mkdirSync(path.join(out, 'reference'), { recursive: true });
  fs.copyFileSync(ref, path.join(out, 'reference/knight-concept.png'));
}
if (which === 'knight' && fs.existsSync(path.join(out, 'reference/knight-concept.png'))) {
  project.editor.reference = { path: 'reference/knight-concept.png', visible: false, opacity: 0.45, x: 0, y: 0, scale: 1, exportable: false,
    note: 'Concept art shown behind the rig for tracing; excluded from every export by default.' };
}
fs.writeFileSync(path.join(out, 'character.json'), JSON.stringify(project, null, 1) + '\n');
console.log(`wrote ${path.join(out, 'character.json')}: ${project.bones.length} bones, ${project.slots.length} slots, ${Object.keys(project.attachments).length} attachments, ${project.clips.length} clips`);
await browser.close(); server.close();
