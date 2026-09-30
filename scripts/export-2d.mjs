// Game exports of a 2D project, headless:
//   node scripts/export-2d.mjs [--project=characters2d/aureate_knight/character.json] [--sheets=idle,walk_in_place|all]
//        [--scale=0.5] [--out=exports/<id>]
// Writes: <out>/runtime/ (unpacked runtime package, also copied to runtime/example/package for the knight),
//         <out>/<id>.runtime.zip, <out>/spritesheets/ (+ .zip), <out>/frame.png
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, CHROME, CHROME_ARGS } from './serve.mjs';
import { readZip } from '../viewer/js/art2d/zip.js';

const arg = (k, d = null) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const projectPath = arg('project', 'characters2d/aureate_knight/character.json');
const sheets = arg('sheets', 'idle,hover_sword_vigil,walk_in_place,sword_2h_idle,sword_2h_slash,knight_salute,finger_tests_2d,contact_detonator_2d');
const scale = +arg('scale', '0.5');
const server = await startServer(0);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [...CHROME_ARGS, '--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/viewer/art2d-sheet.html?bind=1&project=../${projectPath}`);
await page.waitForFunction(() => window.sheetReady, null, { timeout: 60000 });
const t0 = Date.now();
const res = await page.evaluate(async ({ projectPath, sheets, scale }) => {
  const io = await import('./js/art2d/project-io.js'), ex = await import('./js/art2d/exporters.js');
  const { project, store, report } = await io.loadProjectURL('../' + projectPath);
  if (report.errors.length) throw new Error(report.errors.join('; '));
  const player = {};
  for (const f of ['gamboligy-character2d.js', 'README.md']) { const r = await fetch('../runtime/' + f); if (r.ok) player['player/' + f] = await r.text(); }
  const rt = await ex.exportRuntimePackage(project, store, { player });
  const clips = sheets === 'all' ? null : sheets.split(',').filter((n) => project.clips.some((c) => c.name === n));
  const t1 = performance.now();
  const sp = await ex.exportSpriteSheets(project, store, { clips, scale });
  const sheetMs = performance.now() - t1;
  const { Rig } = await import('./js/art2d/core.js');
  const rig = new Rig(project), frame = await ex.exportFramePNG(project, store, rig, rig.evaluate('hover_sword_vigil', 0), { scale: 1 });
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  return { id: project.characterId, runtime: b64(rt.zip), sheets: b64(sp.zip), frame: b64(frame), frames: Object.values(sp.manifest.clips).reduce((s, c) => s + c.frameCount, 0), sheetMs, pages: rt.pkg.atlas.pages.length };
}, { projectPath, sheets, scale });
const out = path.resolve(arg('out', `exports/${res.id}`));
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const unpack = async (zipBytes, dir) => { fs.rmSync(dir, { recursive: true, force: true }); for (const [p, b] of await readZip(zipBytes)) { const f = path.join(dir, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, b); } };
const rtZip = Buffer.from(res.runtime, 'base64'), spZip = Buffer.from(res.sheets, 'base64');
fs.writeFileSync(path.join(out, `${res.id}.runtime.zip`), rtZip);
fs.writeFileSync(path.join(out, `${res.id}.spritesheets.zip`), spZip);
fs.writeFileSync(path.join(out, 'frame.png'), Buffer.from(res.frame, 'base64'));
await unpack(new Uint8Array(rtZip), path.join(out, 'runtime'));
await unpack(new Uint8Array(spZip), path.join(out, 'spritesheets'));
if (res.id === 'aureate_knight_2d' && !arg('out')) {
  const dst = 'runtime/example/package';
  await unpack(new Uint8Array(rtZip), dst);
  fs.rmSync(path.join(dst, 'player'), { recursive: true, force: true });   // the example uses ../gamboligy-character2d.js
}
console.log(`runtime package: ${(rtZip.length / 1024).toFixed(0)} KB, ${res.pages} atlas page(s); sprite sheets: ${res.frames} frames in ${(res.sheetMs / 1000).toFixed(1)} s, ${(spZip.length / 1024).toFixed(0)} KB; total ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${out}`);
await browser.close(); server.close();
