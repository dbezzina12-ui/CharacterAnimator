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
const times = timesArg.split(',').map(Number);
const zi = process.argv.indexOf('--scale'); const scale = zi >= 0 ? Number(process.argv[zi + 1]) : 1;
const server = await startServer(0);
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Math.round(520 * scale) * times.length, height: Math.round(700 * scale) + 60 } });
page.on('pageerror', (e) => { console.error('PAGE ERROR', e); });
await page.goto(`http://127.0.0.1:${port}/mascots/reaper/render.html`);
await page.waitForFunction(() => window.ReaperRender?.ready);
await page.evaluate(({ clip, times, skeleton, scale }) => window.ReaperRender.sheet(clip, times, { cell: Math.round(520 * scale), height: Math.round(700 * scale) + 60, skeleton, scale }), { clip, times, skeleton, scale });
await page.screenshot({ path: out, omitBackground: false });
await browser.close(); server.close();
console.log('wrote', out);
