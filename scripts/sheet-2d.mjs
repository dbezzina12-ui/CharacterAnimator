// Renders a contact sheet of a 2D project: node scripts/sheet-2d.mjs "clips=idle,walk_in_place&n=6" out.png
import { chromium } from 'playwright-core';
import { startServer, CHROME, CHROME_ARGS } from './serve.mjs';
const [q, out] = process.argv.slice(2);
const server = await startServer(0);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [...CHROME_ARGS, '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message)); page.on('console', (m) => console.log(m.text()));
await page.goto(`http://127.0.0.1:${server.address().port}/viewer/art2d-sheet.html?${q}`);
await page.waitForFunction(() => window.sheetReady, null, { timeout: 60000 });
await page.locator('body').screenshot({ path: out });
await browser.close(); server.close();
