// Dev: screenshot the viewer with URL params.
import { chromium } from 'playwright-core';
import { startServer, CHROME, CHROME_ARGS } from '../../scripts/serve.mjs';
const [query, out, w = '1400', h = '900', js = ''] = process.argv.slice(2);
const server = await startServer(0);
const browser = await chromium.launch({ executablePath: CHROME, args: CHROME_ARGS });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/viewer/index.html?${query}`);
await page.waitForFunction(() => window.viewer && (window.viewer.ready || window.viewer.error), null, { timeout: 60000 });
if (js) console.log(await page.evaluate(js));
await page.waitForTimeout(500);
await page.screenshot({ path: out });
await browser.close(); server.close();
