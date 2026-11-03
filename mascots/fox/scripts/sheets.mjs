// Contact sheets: every clip at evenly spaced times -> output/sheets/<clip>.png
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startServer } from '../../../scripts/serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'output', 'sheets'); fs.mkdirSync(outDir, { recursive: true });
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const skeleton = process.argv.includes('--skeleton');
const server = await startServer(0); const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 560 } });
page.on('pageerror', (e) => console.error('PAGE ERROR', e));
await page.goto(`http://127.0.0.1:${port}/mascots/fox/render.html`);
await page.waitForFunction(() => window.FoxRender?.ready);
const clips = await page.evaluate(() => Object.fromEntries(Object.entries(window.FoxRender.CLIPS).map(([k, c]) => [k, c.duration])));
for (const [name, duration] of Object.entries(clips)) {
  if (only.length && !only.includes(name)) continue;
  const n = 8, cell = 300, height = 560;
  const times = Array.from({ length: n }, (_, i) => +(duration * i / (n - 1)).toFixed(3));
  await page.setViewportSize({ width: cell * n, height });
  await page.evaluate(({ name, times, cell, height, skeleton }) => window.FoxRender.sheet(name, times, { cell, height, scale: 0.68, skeleton }), { name, times, cell, height, skeleton });
  const file = path.join(outDir, `${name}${skeleton ? '-skeleton' : ''}.png`);
  await page.screenshot({ path: file });
  console.log('wrote', file);
}
await browser.close(); server.close();
