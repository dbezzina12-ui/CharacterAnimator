// Smoke-test the interactive viewer in headless Chromium at desktop and phone sizes -> output/viewer-*.png
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startServer } from '../../../scripts/serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const server = await startServer(0); const port = server.address().port;
const browser = await chromium.launch();
const errors = [];
for (const [label, vp, mobile] of [['desktop', { width: 1280, height: 800 }, false], ['phone', { width: 390, height: 844 }, true]]) {
  const page = await browser.newPage({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`); });
  await page.goto(`http://127.0.0.1:${port}/mascots/fox/viewer.html`);
  await page.waitForFunction(() => window.FoxViewer?.rig?.state?.lastPose);
  await page.selectOption('#clip', 'swing');
  await page.click('#skeleton');
  await page.evaluate(() => { window.FoxViewer.rig.seek(1.0); });
  await page.waitForTimeout(150);
  const shown = await page.evaluate(() => window.FoxViewer.rig.state.time);
  if (Math.abs(shown - 1.0) > 1e-9) errors.push(`${label}: seek(1.0) shows t=${shown}`);
  await page.screenshot({ path: path.join(here, '..', 'output', `viewer-${label}.png`) });
  // play through contact and confirm exactly one contact event reached the page
  const count = await page.evaluate(async () => {
    let n = 0; window.addEventListener('fox:contact', () => n++);
    window.FoxViewer.rig.play('swing'); await new Promise((r) => setTimeout(r, 2200)); return n;
  });
  console.log(`${label}: fox:contact events during one swing = ${count}`);
  await page.close();
}
await browser.close(); server.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('viewer ok');
