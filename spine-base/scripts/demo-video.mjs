// Renders a demo reel of both characters (staff idle/slam, gun idle/fire, hit, win) with the Spine runtime -> validation/demo.mp4
import path from 'node:path'; import fs from 'node:fs'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
import { startServer } from '../../scripts/serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const here = path.dirname(fileURLToPath(import.meta.url)); const outDir = path.join(here, '..', 'validation'); const frames = path.join(outDir, '_frames'); fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });
const server = await startServer(0); const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
if (process.env.SPINE_WEBGL) await page.route('**/spine-webgl.js', (r) => r.fulfill({ path: process.env.SPINE_WEBGL, contentType: 'text/javascript' }));
await page.goto(`http://127.0.0.1:${port}/spine-base/runtime/viewer.html`); await page.waitForFunction(() => window.Viewer || window.ViewerError, null, { timeout: 60000 });
await page.evaluate(() => { window.Viewer.state.paused = true; document.getElementById('title').hidden = true; window.Viewer.setCape(true); });
// script: [weapon, animation or null, seconds]
const reel = [['staff', null, 1.0], ['staff', 'staff/slam', 1.5], ['staff', 'hit', 0.9], ['gun', null, 1.0], ['gun', 'gun/fire', 1.3], ['gun', 'gun/fire', 1.3], ['gun', 'win', 1.6], ['staff', 'win', 1.6]];
let n = 0; let weapon = null; const FPS = 30;
for (const [w, anim, secs] of reel) {
  await page.evaluate(({ w, anim, change }) => { const V = window.Viewer; if (change) V.setWeapon(w); if (anim) V.chars.forEach((ch) => ch.play(anim)); }, { w, anim, change: w !== weapon }); weapon = w;
  for (let i = 0; i < Math.round(secs * FPS); i++) { await page.evaluate(() => { window.Viewer.step(1 / 60); window.Viewer.step(1 / 60); window.Viewer.draw(); }); await page.locator('#stage').screenshot({ path: path.join(frames, `f${String(n++).padStart(4, '0')}.png`) }); }
}
await browser.close(); server.close();
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f%04d.png'), '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-pix_fmt', 'yuv420p', '-crf', '20', path.join(outDir, 'demo.mp4')]);
fs.rmSync(frames, { recursive: true, force: true }); console.log('wrote', path.join(outDir, 'demo.mp4'), n, 'frames');
