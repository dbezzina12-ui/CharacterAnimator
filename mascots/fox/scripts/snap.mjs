// Quick look: render one clip at given times to PNGs (development aid).
// usage: node scripts/snap.mjs <clip> <t1,t2,...> [out.png] [--skeleton]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { startServer } from '../../../scripts/serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [clip = 'idle', timesArg = '0', out = path.join(here, '..', 'output', 'snap.png')] = process.argv.slice(2);
const skeleton = process.argv.includes('--skeleton');
const times = timesArg.split(',').map(Number);
const server = await startServer(0);
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420 * times.length, height: 760 } });
page.on('pageerror', (e) => { console.error('PAGE ERROR', e); });
await page.goto(`http://127.0.0.1:${port}/mascots/fox/render.html`);
await page.waitForFunction(() => window.FoxRender?.ready);
await page.evaluate(({ clip, times, skeleton }) => window.FoxRender.sheet(clip, times, { cell: 420, height: 760, skeleton }), { clip, times, skeleton });
await page.screenshot({ path: out, omitBackground: false });
await browser.close(); server.close();
console.log('wrote', out);
