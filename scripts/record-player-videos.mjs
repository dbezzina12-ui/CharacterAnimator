// Short videos recorded from the ACTUAL export: the single-file offline player is opened from file:// with all
// network requests blocked, and its canvas is recorded with MediaRecorder (WebM). No ffmpeg needed.
//   node scripts/record-player-videos.mjs [--player=deliverables/painted-knight/Aureate-Knight-2D-Player.html]
//     [--out=deliverables/painted-knight/videos] [--clips=idle,hover_sword_vigil,...] [--skin=painted]
// Note: headless Chromium renders WebGL on the CPU (SwiftShader); frame pacing in the recording reflects that.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { CHROME, CHROME_ARGS } from './serve.mjs';

const arg = (k, d = null) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const player = path.resolve(arg('player', 'deliverables/painted-knight/Aureate-Knight-2D-Player.html'));
const OUT = arg('out', 'deliverables/painted-knight/videos');
const clips = (arg('clips', 'idle,hover_sword_vigil,sword_2h_idle,sword_2h_slash,knight_salute')).split(',');
const skin = arg('skin', null);
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [...CHROME_ARGS, '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 760, height: 760 } });
const blocked = []; await page.route('**/*', (r) => (r.request().url().startsWith('file:') || r.request().url().startsWith('data:') ? r.continue() : (blocked.push(r.request().url()), r.abort())));
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + player);
await page.waitForFunction(() => window.runtimeReady, null, { timeout: 60000 });
// player layout for recording: hide the side panel so the canvas fills the frame
await page.addStyleTag({ content: '#ui{display:none!important} #view{position:fixed;inset:0}' });
const out = [];
for (const clip of clips) {
  const r = await page.evaluate(async ({ clip, skin }) => {
    const ch = window.character; if (!ch.clips.some((c) => c.name === clip)) return { clip, missing: true };
    if (skin) ch.setSkin(skin);
    const dur = ch.clips.find((c) => c.name === clip).duration, ms = Math.max(3000, Math.min(8000, dur * 2000));
    const sel = document.getElementById('clip'); sel.value = clip; sel.dispatchEvent(new Event('change'));
    await new Promise((res) => setTimeout(res, 300));
    ch.seek(0); ch.resume();
    const canvas = document.getElementById('c'), stream = canvas.captureStream(30);
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2.5e6 }), chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const t0 = performance.now(); let frames = 0; const count = () => { frames++; if (performance.now() - t0 < ms) requestAnimationFrame(count); }; requestAnimationFrame(count);
    rec.start(250); await new Promise((res) => setTimeout(res, ms)); rec.stop(); await new Promise((res) => (rec.onstop = res));
    const buf = new Uint8Array(await new Blob(chunks, { type }).arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { clip, type, seconds: ms / 1000, renderFps: +(frames / (ms / 1000)).toFixed(1), skin: ch.rig.skinId, b64: btoa(s) };
  }, { clip, skin });
  if (r.missing) { console.log(`${clip}: not in package`); continue; }
  const f = path.join(OUT, `${clip}.webm`); fs.writeFileSync(f, Buffer.from(r.b64, 'base64')); delete r.b64;
  out.push({ ...r, file: f, bytes: fs.statSync(f).size });
  console.log(`${clip}: ${r.seconds}s ${r.type} skin ${r.skin}, ${r.renderFps} fps rendered (CPU WebGL), ${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'videos.json'), JSON.stringify({ player: path.relative(process.cwd(), player), offline: true, blockedRequests: blocked, errors, renderer: 'headless Chromium + SwiftShader (CPU WebGL)', videos: out }, null, 1));
if (errors.length || blocked.length) { console.log('errors/blocked', errors, blocked); process.exit(1); }
