// Animated previews: renders every clip at 24 fps and encodes GIFs (ffmpeg) -> output/previews/<clip>.gif
// usage: node scripts/preview.mjs [clip ...] [--mp4]
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startServer } from '../../../scripts/serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'output', 'previews'); fs.mkdirSync(outDir, { recursive: true });
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const mp4 = process.argv.includes('--mp4');
const FPS = 24, SIZE = 512;
const server = await startServer(0); const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
page.on('pageerror', (e) => console.error('PAGE ERROR', e));
await page.goto(`http://127.0.0.1:${port}/mascots/octo/render.html`);
await page.waitForFunction(() => window.OctoRender?.ready);
const clips = await page.evaluate(() => Object.fromEntries(Object.entries(window.OctoRender.CLIPS).map(([k, c]) => [k, { duration: c.duration, loop: c.loop }])));
for (const [name, c] of Object.entries(clips)) {
  if (only.length && !only.includes(name)) continue;
  const dir = path.join(outDir, `_frames_${name}`); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  const n = Math.round(c.duration * FPS) + (c.loop ? 0 : 1);
  for (let i = 0; i < n; i++) {
    const url = await page.evaluate(({ name, t }) => window.OctoRender.frame(name, t, { size: 512, scale: 0.5, groundY: 0.94, background: '#20232a' }), { name, t: i / FPS });
    fs.writeFileSync(path.join(dir, `f${String(i).padStart(4, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  const gif = path.join(outDir, `${name}.gif`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'),
    '-vf', 'scale=360:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4', '-loop', '0', gif]);
  if (mp4) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'), '-pix_fmt', 'yuv420p', '-crf', '20', path.join(outDir, `${name}.mp4`)]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('wrote', gif, `(${n} frames)`);
}
await browser.close(); server.close();
