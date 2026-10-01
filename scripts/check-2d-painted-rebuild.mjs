// Deliverables are rebuilt from a SAVED painted project (the editable ZIP is the source of truth).
// A painted project with two fitted pieces (the kit's painted helmet = finished, a resampled + hue-shifted
// starter cape = provisional TEST FIXTURE, not a painting) is saved from the editor; then
// build-painted-knight.mjs rebuilds every deliverable from that ZIP (rebased onto the current starter, and as
// saved), and the outputs are checked: same pieces, statuses, placement, cape animation, runtime package.
//   node scripts/check-2d-painted-rebuild.mjs   → validation/painted-rebuild/{checks.json,REPORT.md}
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { startServer, CHROME, CHROME_ARGS } from './serve.mjs';
import { readZip, textOf } from '../viewer/js/art2d/zip.js';

const OUT = 'validation/painted-rebuild', TMP = `${OUT}/_tmp`;
fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
const results = [];
const check = (id, title, pass, details) => { results.push({ id, title, pass: !!pass, details }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${title} — ${JSON.stringify(details).slice(0, 300)}`); };
const server = await startServer(0), base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [...CHROME_ARGS, '--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
const projectOf = async (zipPath) => { for (const [p, b] of await readZip(new Uint8Array(fs.readFileSync(zipPath)))) if (p === 'character.json') return JSON.parse(textOf(b)); return null; };
const runtimeOf = async (zipPath) => { for (const [p, b] of await readZip(new Uint8Array(fs.readFileSync(zipPath)))) if (p.endsWith('.runtime.json')) return JSON.parse(textOf(b)); return null; };
const build = (args) => execFileSync('node', ['scripts/build-painted-knight.mjs', ...args], { encoding: 'utf8', stdio: 'pipe', timeout: 600000 });
try {
  // ---- 1) author a painted project in the editor and save it (Save button)
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/viewer/knight.html?art=2d`);
  await page.waitForFunction(() => window.art2d?.editor?.ready, null, { timeout: 120000 }); await page.evaluate(() => art2d.editor.ready);
  const authored = await page.evaluate(async (helmetB64) => {
    const io = await import('./js/art2d/project-io.js'), zip = await import('./js/art2d/zip.js');
    const P = art2d.project, u8 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
    const pack = await art2d.paintPack('painted'), lj = JSON.parse(zip.textOf(pack.files.find((f) => f.path === 'layers.json').data));
    // fixture cape: the starter cape resampled 1.5x and hue-shifted (labelled provisional; NOT painted art)
    const a = P.attachments['mantle.default'], d = await io.decodeImage(art2d.store.bytes(P.images[a.image].path));
    const s = document.createElement('canvas'); s.width = d.width; s.height = d.height; s.getContext('2d').putImageData(d, 0, 0);
    const c = document.createElement('canvas'); c.width = Math.round(d.width * 1.5); c.height = Math.round(d.height * 1.5); const g = c.getContext('2d'); g.filter = 'hue-rotate(40deg)'; g.drawImage(s, 0, 0, c.width, c.height);
    const cape = await io.encodePNG(g.getImageData(0, 0, c.width, c.height));
    const H = lj.layers.find((l) => l.target === 'helmet.default'), M = lj.layers.find((l) => l.target === 'mantle.default');
    const files = new Map([[H.file, u8(helmetB64)], [M.file, cape], ['layers.json', new TextEncoder().encode(JSON.stringify({ ...lj, layers: [H, M] }))]]);
    const sess = await art2d.startFit(files, { skin: 'painted' });
    sess.layers.find((l) => l.target === 'mantle.default').status = 'provisional';
    await art2d.acceptFit();
    const sk = art2d.project.skins.find((x) => x.id === 'painted');
    return { replace: sk.replace, status: sk.status };
  }, fs.readFileSync('validation/workflow/art/painted-helmet.png').toString('base64'));
  const dl = page.waitForEvent('download'); await page.locator('#p2Save').click(); await (await dl).saveAs(`${TMP}/saved.character2d.zip`);
  await page.close();
  const saved = await projectOf(`${TMP}/saved.character2d.zip`);
  check('saved-project', 'Painted project authored in the editor (helmet finished + fixture cape provisional) and saved with the Save button',
    saved?.skins.find((s) => s.id === 'painted')?.replace?.['mantle.default'] && authored.status['mantle.default'] === 'provisional' && saved.fitting?.templates?.painted?.layers?.length === 2, authored);

  // ---- 2) rebuild every deliverable from that ZIP, rebased onto the current starter
  const log1 = build([`--from=${TMP}/saved.character2d.zip`, `--out=${TMP}/rebased`]);
  const st1 = JSON.parse(fs.readFileSync(`${TMP}/rebased/skin-status.json`, 'utf8')), p1 = await projectOf(`${TMP}/rebased/aureate-knight-painted.character2d.zip`), rt1 = await runtimeOf(`${TMP}/rebased/aureate-knight-painted.runtime.zip`);
  const files = ['aureate-knight-painted.character2d.zip', 'aureate-knight-painted.runtime.zip', 'Aureate-Knight-2D-Player.html', 'paint-template-pack.zip', 'ART-REQUESTS.txt', 'skin-status.json'];
  const sk1 = p1.skins.find((s) => s.id === 'painted');
  check('rebuild-rebased', 'Rebuilt from the saved ZIP onto the current starter: same pieces, statuses kept, each piece at its saved placement (setup bind ≤ 0.01 px), all deliverables written',
    st1.builtFrom.mode === 'rebased' && Object.keys(sk1.replace).sort().join() === 'helmet.default,mantle.default' && sk1.status['mantle.default'] === 'provisional' && sk1.status['helmet.default'] === 'finished'
      && Object.values(st1.builtFrom.placement).every((d) => d <= 0.01) && files.every((f) => fs.existsSync(`${TMP}/rebased/${f}`)) && st1.finished.includes('helmet.default') && st1.provisional.includes('mantle.default'),
    { builtFrom: st1.builtFrom, finished: st1.finished, provisional: st1.provisional, missing: st1.missing.length, log: log1.trim().split('\n')[0] });
  const art = fs.readFileSync(`${TMP}/rebased/ART-REQUESTS.txt`, 'utf8');
  check('rebuild-outputs', 'Rebuilt outputs carry the painted cape animation (deformFrom in project and runtime package), the painted skin opens by default, and ART-REQUESTS lists the provisional cape',
    p1.attachments['mantle.default@painted']?.deformFrom === 'mantle.default' && rt1.attachments['mantle.default@painted']?.deformFrom === 'mantle.default' && rt1.defaultSkin === 'painted'
      && /provisional: 1/.test(art) && fs.readFileSync(`${TMP}/rebased/Aureate-Knight-2D-Player.html`, 'utf8').includes('mantle.default@painted'),
    { deformFrom: p1.attachments['mantle.default@painted']?.deformFrom, runtimeDefaultSkin: rt1.defaultSkin, artRequestsStatus: art.split('\n').filter((l) => /^ {2}(finished|provisional|missing):/.test(l)) });

  // ---- 3) as saved (no rebase) from the rebuilt ZIP, and a second rebase: identical painted placement
  build([`--from=${TMP}/rebased/aureate-knight-painted.character2d.zip`, '--no-rebase', `--out=${TMP}/as-saved`]);
  build([`--from=${TMP}/rebased/aureate-knight-painted.character2d.zip`, `--out=${TMP}/rebased2`]);
  const st2 = JSON.parse(fs.readFileSync(`${TMP}/as-saved/skin-status.json`, 'utf8')), p2 = await projectOf(`${TMP}/as-saved/aureate-knight-painted.character2d.zip`), p3 = await projectOf(`${TMP}/rebased2/aureate-knight-painted.character2d.zip`);
  const pick = (p) => JSON.stringify(['helmet.default@painted', 'mantle.default@painted'].map((id) => [p.attachments[id].transform, p.attachments[id].imageScale, p.attachments[id].pivot, p.attachments[id].vertices.length]));
  check('rebuild-stable', 'Rebuilding again — as saved (--no-rebase) and rebased a second time — reproduces the same painted pieces exactly',
    st2.builtFrom.mode === 'as saved' && pick(p2) === pick(p1) && pick(p3) === pick(p1), { asSaved: st2.builtFrom.mode, identicalAsSaved: pick(p2) === pick(p1), identicalRebasedTwice: pick(p3) === pick(p1) });
  // ---- 4) a saved project that cannot be carried over fails loudly instead of silently dropping art
  const broken = structuredClone(saved); broken.fitting.templates.painted.layers = broken.fitting.templates.painted.layers.filter((l) => l.target !== 'mantle.default');
  const { writeZip } = await import('../viewer/js/art2d/zip.js');
  const entries = []; for (const [p, b] of await readZip(new Uint8Array(fs.readFileSync(`${TMP}/saved.character2d.zip`)))) entries.push({ path: p, data: p === 'character.json' ? JSON.stringify(broken) : b });
  fs.writeFileSync(`${TMP}/broken.character2d.zip`, writeZip(entries));
  let failMsg = null; try { build([`--from=${TMP}/broken.character2d.zip`, `--out=${TMP}/broken`]); } catch (e) { failMsg = String(e.stdout || '') + String(e.stderr || ''); }
  check('rebuild-refuses-loss', 'A saved painted piece without a fit template stops the rebuild with a message (never silently dropped)', failMsg && /cannot be carried over/.test(failMsg) && /mantle.default/.test(failMsg), { message: (failMsg || '').split('\n').find((l) => /carried over/.test(l))?.slice(0, 200) });
  check('no-errors', 'No page errors', errors.length === 0, errors.slice(0, 5));
} finally {
  await browser.close(); server.close(); fs.rmSync(TMP, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(`${OUT}/checks.json`, JSON.stringify({ date: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 1));
fs.writeFileSync(`${OUT}/REPORT.md`, ['# Rebuilding deliverables from a saved painted project', '', `Generated by \`node scripts/check-2d-painted-rebuild.mjs\`. ${results.length - failed.length} passed, ${failed.length} failed.`,
  'The cape used here is the starter cape resampled and hue-shifted — a test fixture marked provisional, not painted art.', '',
  '| | check | measured |', '|---|---|---|', ...results.map((r) => `| ${r.pass ? '✅' : '❌'} | ${r.title} | ${JSON.stringify(r.details).replace(/\|/g, '/').slice(0, 320)} |`), ''].join('\n'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
