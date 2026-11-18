// Game export: every clip at 24 fps, 512-px frames with true alpha -> per clip a PNG sequence zip,
// a VP9 WebM with alpha and an MP4 on pure green (#00FF00). Loop clips are seamless by construction.
// usage: node mascots/reaper-painted/scripts/export-game.mjs [outDir] [clip ...]
import path from 'node:path'; import fs from 'node:fs'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startServer } from '../../../scripts/serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2); const out = path.resolve(args[0] || path.join(here, '..', 'output', 'export')); const only = args.slice(1);
fs.mkdirSync(out, { recursive: true });
const FPS = 24, SIZE = 512;
const server = await startServer(0); const port = server.address().port;
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
page.on('pageerror', (e) => console.error('PAGE ERROR', e));
await page.goto(`http://127.0.0.1:${port}/mascots/reaper-painted/render.html`); await page.waitForFunction(() => window.PaintedRender?.ready);
const clips = await page.evaluate(() => Object.fromEntries(Object.entries(window.PaintedRender.CLIPS).map(([k, c]) => [k, { duration: c.duration, loop: !!c.loop }])));
for (const [name, c] of Object.entries(clips)) {
  if (only.length && !only.includes(name)) continue;
  const dir = path.join(out, `${name}-png`); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  const n = Math.round(c.duration * FPS) + (c.loop ? 0 : 1);
  for (let i = 0; i < n; i++) {
    const url = await page.evaluate(({ name, t }) => window.PaintedRender.frame(name, t, { size: 512, scale: 0.6, groundY: 0.92 }), { name, t: i / FPS });
    fs.writeFileSync(path.join(dir, `${name}_${String(i).padStart(3, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, `${name}_%03d.png`), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '24', '-auto-alt-ref', '0', path.join(out, `${name}-alpha.webm`)]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x00FF00:s=${SIZE}x${SIZE}:r=${FPS}`, '-framerate', String(FPS), '-i', path.join(dir, `${name}_%03d.png`), '-filter_complex', '[0:v][1:v]overlay=shortest=1,format=yuv420p', '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', path.join(out, `${name}-green.mp4`)]);
  execFileSync('zip', ['-q', '-r', '-9', path.join(out, `${name}-png.zip`), path.basename(dir)], { cwd: out });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${name}: ${n} frames`);
}
await browser.close(); server.close();
