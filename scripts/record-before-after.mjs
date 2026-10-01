// Before/after animation previews from two RUNTIME packages (what the player plays), side by side, recorded
// to WebM with MediaRecorder. Frames are stepped deterministically (seek per frame) and paced at ~30 fps of wall time;
// the clip time shown in the overlay is exact for every frame.
//   node scripts/record-before-after.mjs --before=<dir with *.runtime.json> --after=<dir> --out=<dir>
//     [--shots=name:clip:view;...]  view = full | follow:<bone>:<radius px> | rect:x0,y0,x1,y1
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, CHROME, CHROME_ARGS } from './serve.mjs';
const arg = (k, d = null) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const pkgOf = (dir) => path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.runtime.json')));
const before = pkgOf(arg('before')), after = pkgOf(arg('after')), OUT = arg('out');
const shots = (arg('shots') || 'idle:idle:full;hover:hover_sword_vigil:full;hover-feet:hover_sword_vigil:rect=-170,90,170,330;sword-slash:sword_2h_slash:full;salute:knight_salute:full;salute-wrist:knight_salute:rect=-360,470,60,820;detonator:press_detonator:full;detonator-hand:press_detonator:follow=hand_R=75')
  .split(';').map((s) => { const [name, clip, view] = s.split(':'); return { name, clip, view }; });
fs.mkdirSync(OUT, { recursive: true });
const server = await startServer(0), base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [...CHROME_ARGS, '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`${base}/runtime/example/?package=${encodeURIComponent('/' + before)}`);
await page.waitForFunction(() => window.runtimeReady, null, { timeout: 60000 });
const results = [];
for (const s of shots) {
  const r = await page.evaluate(async ({ s, before, after }) => {
    const { Character2D } = await import('/runtime/gamboligy-character2d.js');
    const W = 420, H = 560, mine = [], mk = () => { const c = document.createElement('canvas'); c.style.width = W + 'px'; c.style.height = H + 'px'; c.width = W; c.height = H; document.body.appendChild(c); mine.push(c); return c; };
    const A = await Character2D.load('/' + before, { canvas: mk(), background: [0.13, 0.14, 0.17, 1] }), B = await Character2D.load('/' + after, { canvas: mk(), background: [0.13, 0.14, 0.17, 1] });
    for (const ch of [A, B]) { ch.setSkin('painted'); ch.play(s.clip, { loop: false }); ch.pause(); }
    const out = document.createElement('canvas'); out.width = W * 2 + 12; out.height = H + 34; document.body.appendChild(out); mine.push(out); const g = out.getContext('2d');
    const stream = out.captureStream(30);
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 3e6 }), chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data); rec.start(250);
    const dur = A.clips.find((c) => c.name === s.clip).duration, n = Math.round(dur * 30) + 1, Href = A.pkg.referenceHeightPx || 1024;
    const viewFor = (ch) => {
      if (s.view === 'full') return { x: 0, y: Href * 0.53, zoom: H / (Href * 1.12) };
      if (s.view.startsWith('rect=')) { const [x0, y0, x1, y1] = s.view.slice(5).split(',').map(Number); return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: Math.min(W / (x1 - x0), H / (y1 - y0)) }; }
      const [, bone, rad] = s.view.split('='); ch.rig.evaluate(s.clip, ch.time); const p = ch.rig.worldPoint(bone); return { x: p[0], y: p[1], zoom: H / (2 * +rad) };
    };
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      const t = Math.min(dur, i / 30);
      g.fillStyle = '#0d0e11'; g.fillRect(0, 0, out.width, out.height);
      [A, B].forEach((ch, k) => { ch.seek(t); ch.draw(viewFor(ch), { dpr: 1 }); g.drawImage(ch.renderer.canvas, k * (W + 12), 34); });
      g.fillStyle = '#ffb86b'; g.font = '15px sans-serif'; g.fillText(`BEFORE — ${s.clip}  ${t.toFixed(2)} s`, 8, 22); g.fillStyle = '#7fdc8a'; g.fillText('AFTER (fixed project)', W + 20, 22);
      await new Promise((res) => setTimeout(res, 34));        // real-time pacing of the recorded frames
    }
    rec.stop(); await new Promise((res) => (rec.onstop = res));
    const buf = new Uint8Array(await new Blob(chunks, { type }).arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); const b64 = btoa(bin);
    mine.forEach((c) => c.remove());
    return { frames: n, seconds: +((performance.now() - t0) / 1000).toFixed(1), b64, type, chunks: chunks.length, state: rec.state, outW: out.width };
  }, { s, before, after });
  fs.writeFileSync(path.join(OUT, `${s.name}.webm`), Buffer.from(r.b64, 'base64'));
  results.push({ name: s.name, clip: s.clip, view: s.view, frames: r.frames, wallSeconds: r.seconds, bytes: fs.statSync(path.join(OUT, `${s.name}.webm`)).size });
  console.log(`${s.name}: ${r.frames} frames (${s.clip}), ${(results.at(-1).bytes / 1024).toFixed(0)} KB`, r.chunks, r.type, r.state);
}
fs.writeFileSync(path.join(OUT, 'previews.json'), JSON.stringify({ before, after, note: 'Side by side, same clip time per frame, rendered by the standalone runtime from each runtime package (painted skin).', results }, null, 1));
await browser.close(); server.close();
