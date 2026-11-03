// Quick look: render one clip at given times to PNGs (development aid).
// usage: node scripts/snap.mjs <clip> <t1,t2,...> [out.png] [--skeleton]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { startServer } from '../../../scripts/serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [clip = 'idle', timesArg = '0', out = path.join(here, '..', 'output', 'snap.png')] = process.argv.slice(2).filter((a, i, arr) => !a.startsWith('--') && arr[i - 1] !== '--scale');
const skeleton = process.argv.includes('--skeleton');
const zi = process.argv.indexOf('--scale'); const scale = zi >= 0 ? Number(process.argv[zi + 1]) : 0.5;
const cell = Math.round(760 * scale) + 80;
const times = timesArg.split(',').map(Number);
const server = await startServer(0);
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: cell * times.length, height: Math.round(540 * scale) + 80 } });
page.on('pageerror', (e) => { console.error('PAGE ERROR', e); });
await page.goto(`http://127.0.0.1:${port}/mascots/octo/render.html`);
await page.waitForFunction(() => window.OctoRender?.ready);
await page.evaluate(({ clip, times, skeleton, cell, scale }) => window.OctoRender.sheet(clip, times, { cell, height: Math.round(540 * scale) + 80, skeleton, scale }), { clip, times, skeleton, cell, scale });
await page.screenshot({ path: out, omitBackground: false });
await browser.close(); server.close();
console.log('wrote', out);
