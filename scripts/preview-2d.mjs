// Contact sheets of clips from a saved project ZIP (any skin), optionally side by side with a second ZIP.
//   node scripts/preview-2d.mjs --zip=a.character2d.zip [--zip2=b.character2d.zip] [--skin=painted]
//     --shots=clip:t,clip:t,... [--rect=x0,y0,x1,y1] [--scale=0.4] [--cols=6] --out=sheet.png [--labels=before,after]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { startServer, CHROME, CHROME_ARGS } from './serve.mjs';
const arg = (k, d = null) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const zips = [arg('zip'), arg('zip2')].filter(Boolean).map((z) => fs.readFileSync(z).toString('base64'));
const shots = arg('shots').split(',').map((s) => { const [c, t] = s.split(':'); return [c, +t]; });
const opts = { skin: arg('skin', 'painted'), rect: (arg('rect') || '-420,-20,420,1080').split(',').map(Number), scale: +(arg('scale') || 0.35), cols: +(arg('cols') || 6), labels: (arg('labels') || 'before,after').split(','), follow: arg('follow'), radius: +(arg('radius') || 90) };
const server = await startServer(0);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [...CHROME_ARGS, '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/viewer/art2d-sheet.html?bind=1`);
await page.waitForFunction(() => window.sheetReady, null, { timeout: 60000 });
const png = await page.evaluate(async ({ zips, shots, opts }) => {
  const io = await import('./js/art2d/project-io.js'), ex = await import('./js/art2d/exporters.js'), { Rig } = await import('./js/art2d/core.js');
  const u8 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  const P = []; for (const z of zips) { const { project, store } = await io.loadProjectZip(u8(z)); const rig = new Rig(project); rig.setSkin(opts.skin); P.push({ project, rig, r: await ex.offscreenRenderer(project, store) }); }
  const [x0, y0, x1, y1] = opts.rect, W = Math.round((x1 - x0) * opts.scale), H = Math.round((y1 - y0) * opts.scale), n = P.length;
  const cols = opts.cols, rows = Math.ceil(shots.length / cols), cw = W * n + (n - 1) * 4, ch = H + 18;
  const c = document.createElement('canvas'); c.width = cols * (cw + 8); c.height = rows * (ch + 8); const g = c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height); g.font = '11px sans-serif';
  shots.forEach(([clip, t], i) => { const X = (i % cols) * (cw + 8), Y = Math.floor(i / cols) * (ch + 8);
    g.fillStyle = '#ddd'; g.fillText(`${clip} ${t.toFixed(2)}s`, X + 2, Y + 12);
    P.forEach((p, k) => { const pose = p.rig.evaluate(clip, t); let R = [x0, y0, x1, y1];
      if (opts.follow) { const w = p.rig.worldPoint(opts.follow), rr = opts.radius; R = [w[0] - rr * (x1 - x0) / (y1 - y0), w[1] - rr, w[0] + rr * (x1 - x0) / (y1 - y0), w[1] + rr]; }
      const img = ex.renderPose(p.r, p.rig, pose, R, opts.follow ? W / (R[2] - R[0]) : opts.scale, { background: [0.16, 0.17, 0.21, 1] }); const tc = document.createElement('canvas'); tc.width = img.width; tc.height = img.height; tc.getContext('2d').putImageData(img, 0, 0); g.drawImage(tc, X + k * (W + 4), Y + 18); if (n > 1) { g.fillStyle = k ? '#7fdc8a' : '#ffb86b'; g.fillText(opts.labels[k], X + k * (W + 4) + 2, Y + ch - 2); } }); });
  return c.toDataURL('image/png');
}, { zips, shots, opts });
fs.writeFileSync(arg('out'), Buffer.from(png.split(',')[1], 'base64'));
await browser.close(); server.close();
