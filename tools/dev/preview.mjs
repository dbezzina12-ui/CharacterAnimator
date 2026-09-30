// Dev: render a mesh dump (from dump_mesh.py) from several angles into one PNG contact sheet.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, CHROME, CHROME_ARGS } from '../../scripts/serve.mjs';

const [meshJson, outPng, mode = 'body'] = process.argv.slice(2);
const dir = path.dirname(path.resolve(meshJson));
const server = await startServer(0, { '/dump/': dir + '/' });
const port = server.address().port;
const browser = await chromium.launch({ executablePath: CHROME, args: CHROME_ARGS });
const vp = (process.env.PV_SIZE || '1800x1200').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: vp[0], height: vp[1] } });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/tools/dev/preview.html?mesh=/dump/${path.basename(meshJson)}&mode=${mode}${process.env.PV_EXTRA || ''}&w=${vp[0]}&h=${vp[1]}`);
await page.waitForFunction(() => window.__done === true, null, { timeout: 120000 });
await page.screenshot({ path: outPng });
await browser.close();
server.close();
