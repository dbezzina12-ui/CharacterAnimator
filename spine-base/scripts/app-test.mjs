// Drives the Character Kit app in headless Chromium: loads it, moves sliders, round-trips the kit zip and the paint sheet,
// and takes desktop and phone screenshots into validation/.
// usage: node spine-base/scripts/app-test.mjs   (SPINE_WEBGL=<path to spine-webgl.js> to use a local runtime copy)
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
import { startServer } from '../../scripts/serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const here = path.dirname(fileURLToPath(import.meta.url)); const outDir = path.join(here, '..', 'validation'); fs.mkdirSync(outDir, { recursive: true });
let failures = 0; const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const server = await startServer(0); const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ viewport, ...extra }); const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_/.test(m.text())) errors.push(m.text()); });
  if (process.env.SPINE_WEBGL) await page.route('**/spine-webgl.js', (r) => r.fulfill({ path: process.env.SPINE_WEBGL, contentType: 'text/javascript' }));
  await page.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.goto(`http://127.0.0.1:${port}/spine-base/app.html`); await page.waitForFunction(() => (window.App && window.App.kit) || window.AppError, null, { timeout: 60000 });
  return page;
}
const page = await open({ width: 1360, height: 860 });
check('app starts and builds the human in the Spine runtime', !(await page.evaluate(() => window.AppError)), (await page.evaluate(() => window.AppError)) || '');
const first = await page.evaluate(() => ({ checks: window.AppChecks, bones: App.kit.json.bones.length, t: (() => { const t0 = performance.now(); App.rebuild(); return performance.now() - t0; })() }));
check('in-app checks all pass for the human', first.checks.every((c) => c[0] === 'ok'), first.checks.map((c) => c[1]).join(' · '));
check('a full rebuild is fast enough to follow a slider', first.t < 400, `${first.t.toFixed(0)} ms`);
await page.waitForTimeout(600); await page.screenshot({ path: path.join(outDir, 'app-desktop.png') });

// presets and extreme sliders keep the hands on the weapons
for (const [label, s] of [['dwarf preset', null], ['tall and lean', { name: 'Tall', height: 900, head: 0.13, legs: 0.56, arms: 0.36, shoulders: 0.12, build: 0.8, hands: 0.05, stance: 0.05, headWidth: 0.78 }], ['short and broad', { name: 'Squat', height: 380, head: 0.34, legs: 0.32, arms: 0.3, shoulders: 0.29, build: 2.3, hands: 0.12, stance: 0.12, headWidth: 1 }], ['long arms, wide stance', { name: 'Ape', height: 700, head: 0.2, legs: 0.42, arms: 0.4, shoulders: 0.2, build: 1.4, hands: 0.09, stance: 0.14, headWidth: 0.9 }], ['short arms, wide stance', { name: 'Stub', height: 600, head: 0.22, legs: 0.5, arms: 0.24, shoulders: 0.14, build: 1, hands: 0.06, stance: 0.14, headWidth: 0.85 }]]) {
  const r = await page.evaluate((s) => { if (s) { App.state.settings = { ...App.state.settings, ...s }; App.rebuild(); } else document.querySelectorAll('#presets button')[1].click(); return { checks: window.AppChecks, file: App.kit.file }; }, s);
  check(`${label}: grips and feet hold`, r.checks.filter((c) => c[0] === 'bad').length === 0, `${r.file}: ${r.checks.filter((c) => c[0] !== 'ok').map((c) => c[1]).join(' · ') || 'all five checks pass'}`);
  await page.evaluate(() => { App.setWeapon('staff'); }); await page.waitForTimeout(250); await page.locator('.view').screenshot({ path: path.join(outDir, `app-shape-${label.replace(/[^a-z]+/g, '-')}.png`) });
}
// kit zip round trip
await page.evaluate(() => document.querySelectorAll('#presets button')[0].click());
const rt = await page.evaluate(async () => {
  App.state.settings.cape = true; App.state.settings.name = 'Round Trip'; App.rebuild();
  const files = await App.kitFiles(); const blob = App.zip(files); const back = await App.unzip(await blob.arrayBuffer());
  const same = files.length === back.length && files.every((f, i) => f.name === back[i].name && f.bytes.length === back[i].bytes.length && f.bytes.every((b, j) => b === back[i].bytes[j]));
  const before = JSON.stringify(App.kit.json); App.state.settings = { name: 'x' }; App.rebuild(); await App.openKit(new File([blob], 'k.zip')); 
  return { names: files.map((f) => f.name), size: blob.size, same, reopened: JSON.stringify(App.kit.json) === before, file: App.kit.file };
});
check('kit zip contains the Spine files, part images, sheets, brief and settings', ['RoundTrip.json', 'RoundTrip.atlas', 'RoundTrip.png', 'images/torso.png', 'images/cape.png', 'character.json', 'parts.json', 'paint-sheet.png', 'paint-sheet.json', 'template.png', 'ART-BRIEF.md'].every((n) => rt.names.includes(n)), `${rt.names.length} files, ${(rt.size / 1024).toFixed(0)} KB`);
check('zip written by the app reads back byte for byte', rt.same);
check('opening a saved kit restores the same skeleton', rt.reopened, rt.file);
// paint sheet round trip: slicing the unpainted sheet must put every part back where the placeholder was
const sh = await page.evaluate(async () => {
  document.querySelectorAll('#presets button')[0].click(); const ph = Object.fromEntries(App.kit.pieces.map((p) => [p.name, p.rect]));
  const sheet = App.getSheet(); const blob = await new Promise((r) => sheet.canvas.toBlob(r, 'image/png')); await App.loadSheet(new File([blob], 's.png'));
  const worst = App.kit.pieces.filter((p) => p.custom).map((p) => ({ name: p.name, off: Math.hypot(p.rect.x + p.rect.w / 2 - ph[p.name].x - ph[p.name].w / 2, p.rect.y + p.rect.h / 2 - ph[p.name].y - ph[p.name].h / 2), size: Math.max(Math.abs(p.rect.w - ph[p.name].w), Math.abs(p.rect.h - ph[p.name].h)) })).sort((a, b) => b.off - a.off);
  // and at half resolution, the way an image model returns it
  const small = document.createElement('canvas'); small.width = 1536; small.height = 1024; small.getContext('2d').drawImage(sheet.canvas, 0, 0, 1536, 1024); App.state.art = {}; App.rebuild();
  await App.loadSheet(new File([await new Promise((r) => small.toBlob(r, 'image/png'))], 's2.png'));
  const worst2 = App.kit.pieces.filter((p) => p.custom).map((p) => ({ name: p.name, off: Math.hypot(p.rect.x + p.rect.w / 2 - ph[p.name].x - ph[p.name].w / 2, p.rect.y + p.rect.h / 2 - ph[p.name].y - ph[p.name].h / 2), size: Math.max(Math.abs(p.rect.w - ph[p.name].w), Math.abs(p.rect.h - ph[p.name].h)) })).sort((a, b) => b.off - a.off);
  return { n: worst.length, worst: worst[0], n2: worst2.length, worst2: worst2[0], checks: window.AppChecks, sheet: [sheet.width, sheet.height, sheet.pxPerUnit] };
});
check('paint sheet: every part is cut out and lands on its placeholder', sh.n === 21 && sh.worst.off < 1 && sh.worst.size < 4, `${sh.n} parts, worst centre offset ${sh.worst.off.toFixed(2)} units (${sh.worst.name}); sheet ${sh.sheet[0]}×${sh.sheet[1]} at ${sh.sheet[2]} px/unit`);
check('paint sheet returned at 1536×1024 still lands on the placeholders', sh.n2 === 21 && sh.worst2.off < 1.5 && sh.worst2.size < 5, `${sh.n2} parts, worst centre offset ${sh.worst2.off.toFixed(2)} units (${sh.worst2.name})`);
check('rig checks still pass with art from the sheet', sh.checks.every((c) => c[0] === 'ok'));
await page.evaluate(() => { App.setTab('art'); }); await page.waitForTimeout(300); await page.screenshot({ path: path.join(outDir, 'app-art-tab.png') });
const sheetPng = await page.evaluate(async () => { const b = await new Promise((r) => App.getSheet().canvas.toBlob(r, 'image/png')); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); });
fs.writeFileSync(path.join(outDir, 'app-paint-sheet.png'), Buffer.from(sheetPng, 'base64'));
await page.evaluate(() => { App.state.art = {}; App.state.settings.cape = true; App.rebuild(); App.setTab('export'); }); await page.waitForTimeout(300); await page.screenshot({ path: path.join(outDir, 'app-export-tab.png') });
// phone, light and dark
const phone = await open({ width: 400, height: 800 }, { deviceScaleFactor: 2, colorScheme: 'dark' }); await phone.waitForTimeout(500);
const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); check('phone width: no sideways scroll', over <= 0, `${over}px`);
await phone.screenshot({ path: path.join(outDir, 'app-phone.png'), fullPage: true });
await browser.close(); server.close();
check('no page errors', errors.length === 0, errors.join(' | '));
fs.writeFileSync(path.join(outDir, 'app-report.json'), JSON.stringify({ generated: new Date().toISOString(), failures, checks: results }, null, 1));
console.log(`\n${results.length - failures}/${results.length} app checks passed`); if (failures) process.exit(1);
