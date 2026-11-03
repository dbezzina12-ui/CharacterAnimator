// Render clips to a packed sprite atlas (PNG pages + JSON manifest) with headless Chromium.
// usage: node scripts/export-atlas.mjs [clip ...] [--all] [--fps 30] [--out dir]
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startServer } from '../../../scripts/serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const fps = Number(flag('--fps', 30));
const outDir = path.resolve(flag('--out', path.join(here, '..', 'output', 'atlas')));
const all = args.includes('--all');
let names = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--fps' && args[i - 1] !== '--out');
fs.mkdirSync(outDir, { recursive: true });
const server = await startServer(0); const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR', e));
await page.goto(`http://127.0.0.1:${port}/mascots/fox/render.html`);
await page.waitForFunction(() => window.FoxRender?.ready);
if (!names.length) names = all ? await page.evaluate(() => Object.keys(window.FoxRender.CLIPS)) : ['idle', 'address', 'swing', 'celebrate', 'miss'];
const res = await page.evaluate(async ({ names, fps }) => {
  const { exportAtlas } = await import('./src/atlas.js');
  return exportAtlas(names, { clips: window.FoxRender.CLIPS, fps });
}, { names, fps });
res.pages.forEach((p, i) => fs.writeFileSync(path.join(outDir, `fox-packed-${i + 1}.png`), Buffer.from(p.split(',')[1], 'base64')));
fs.writeFileSync(path.join(outDir, 'fox-atlas.json'), JSON.stringify(res.manifest, null, 1));
const m = res.manifest;
console.log(`clips ${names.join(', ')}: ${Object.values(m.clips).reduce((s, c) => s + c.frames.length, 0)} frames, ${m.frameCount} unique, ${m.pages.length} page(s), ${(m.decodedAtlasBytes / 1048576).toFixed(1)} MiB decoded -> ${outDir}`);
await browser.close(); server.close();
