// usage: node mascots/outlaws/scripts/export-loop.mjs [outDir]   (needs ffmpeg + zip)
// Export each character's 8 s idle loop: true-alpha PNG frames, a VP9 WebM with alpha, an MP4 on pure green,
// and a half-size 12 fps PNG sequence zip. Also verifies the loop closes (frame 0 == frame L).
import path from 'node:path'; import fs from 'node:fs'; import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { startServer } from '../../../scripts/serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = path.resolve(process.argv[2] || 'mascots/outlaws/export'); fs.mkdirSync(out, { recursive: true });
const L = 8, FPS = 24, N = L * FPS;
const server = await startServer(0); const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const name of ['ranger', 'gunslinger']) {
  const W = 620, H = 1080;
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/mascots/outlaws/index.html?export=${name}&loop=${L}&bg=none`);
  await page.waitForFunction(() => window.Outlaws); await page.waitForTimeout(600);
  const dir = path.join(out, `${name}-frames`); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  for (let i = 0; i <= N; i++) {   // one extra frame at t = L to prove the loop closes
    await page.evaluate((t) => window.Outlaws.seek(t), i / FPS);
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.png`), omitBackground: true });
  }
  const a = fs.readFileSync(path.join(dir, 'f0000.png')), b = fs.readFileSync(path.join(dir, `f${String(N).padStart(4, '0')}.png`));
  console.log(`${name}: frame 0 vs frame ${N} (t=${L}s) identical bytes: ${a.equals(b)}`);
  fs.rmSync(path.join(dir, `f${String(N).padStart(4, '0')}.png`));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '24', '-auto-alt-ref', '0', path.join(out, `${name}-idle-alpha.webm`)]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x00FF00:s=${W}x${H}:r=${FPS}`, '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'), '-filter_complex', '[0:v][1:v]overlay=shortest=1,format=yuv420p', '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', path.join(out, `${name}-idle-green.mp4`)]);
  // half-size 12 fps PNG sequence (true alpha) zipped
  const half = path.join(out, `${name}-png-12fps-half`); fs.rmSync(half, { recursive: true, force: true }); fs.mkdirSync(half);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'), '-vf', `fps=12,scale=${W / 2}:-1:flags=lanczos`, '-pix_fmt', 'rgba', path.join(half, `${name}_%03d.png`)]);
  execFileSync('zip', ['-q', '-r', '-9', path.join(out, `${name}-idle-png-half-12fps.zip`), path.basename(half)], { cwd: out });
  fs.rmSync(half, { recursive: true, force: true });
  if (errors.length) console.log('page errors', errors);
  await page.close();
}
await browser.close(); server.close();
for (const f of fs.readdirSync(out)) { const st = fs.statSync(path.join(out, f)); if (st.isFile()) console.log(f, (st.size / 1048576).toFixed(1) + ' MB'); }
