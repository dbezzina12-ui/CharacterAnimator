// Deliverables are rebuilt from a SAVED painted project (the editable ZIP is the source of truth). By default the
// saved project is used as saved (custom clips and corrections kept); --rebase re-applies it to the current starter
// and must carry the saved animation work across or stop with a message.
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
    // the user's own animation work: a custom native clip (bone keys, a painted-cape deform key, a hand set,
    // an event) and a correction on a bridged clip
    const Pp = art2d.project, n = Pp.attachments['mantle.default'].vertices.length, setR = Object.keys(Pp.handViews?.R?.sets || {})[0];
    const layer = () => ({ bones: {}, slots: {}, drawOrder: { t: [], v: [] }, deform: {}, hands: {}, handSets: {}, constraints: {}, events: [] });
    const custom = { name: 'victory_custom', duration: 1.5, loop: true, fps: 30, source: { type: 'native2d', note: 'user clip (test fixture)' }, tracks: layer(), corrections: layer() };
    custom.tracks.bones.upperarm_R = { rotate: { t: [0, 0.75, 1.5], v: [0, -40, 0] } };
    custom.tracks.deform['mantle.default'] = { t: [0, 1.5], v: [new Array(n).fill(0), new Array(n).fill(2.5)] };
    if (setR) custom.tracks.handSets.R = { t: [0], v: [setR] };
    custom.tracks.events = [{ t: 0.75, name: 'cheer' }];
    Pp.clips.push(custom);
    const idle = Pp.clips.find((c) => c.name === 'idle'); idle.corrections ||= layer(); idle.corrections.bones.head = { rotate: { t: [0, 1], v: [0, 6] } };
    art2d.editor.rebuild();
    return { replace: sk.replace, status: sk.status, customClip: true, valid: art2d.validate().errors.length };
  }, fs.readFileSync('validation/workflow/art/painted-helmet.png').toString('base64'));
  const dl = page.waitForEvent('download'); await page.locator('#p2Save').click(); await (await dl).saveAs(`${TMP}/saved.character2d.zip`);
  await page.close();
  const saved = await projectOf(`${TMP}/saved.character2d.zip`);
  const clipOf = (p, n) => JSON.stringify(p.clips.find((c) => c.name === n) || null), corrOf = (p) => JSON.stringify(p.clips.find((c) => c.name === 'idle').corrections.bones.head || null);
  check('saved-project', 'Painted project authored in the editor (helmet finished + fixture cape provisional, a custom clip, an idle correction) and saved with the Save button',
    saved?.skins.find((s) => s.id === 'painted')?.replace?.['mantle.default'] && authored.status['mantle.default'] === 'provisional' && saved.fitting?.templates?.painted?.layers?.length === 2
      && clipOf(saved, 'victory_custom') !== 'null' && corrOf(saved) !== 'null' && authored.valid === 0, { ...authored, clips: saved.clips.length });
  const files = ['aureate-knight-painted.character2d.zip', 'aureate-knight-painted.runtime.zip', 'Aureate-Knight-2D-Player.html', 'paint-template-pack.zip', 'ART-REQUESTS.txt', 'skin-status.json'];
  const pick = (p) => JSON.stringify(['helmet.default@painted', 'mantle.default@painted'].map((id) => [p.attachments[id].transform, p.attachments[id].imageScale, p.attachments[id].pivot, p.attachments[id].vertices.length]));

  // ---- 2) DEFAULT rebuild (no flags): the saved project exactly as saved — custom clip and correction kept
  const log0 = build([`--from=${TMP}/saved.character2d.zip`, `--out=${TMP}/default`]);
  const st0 = JSON.parse(fs.readFileSync(`${TMP}/default/skin-status.json`, 'utf8')), p0 = await projectOf(`${TMP}/default/aureate-knight-painted.character2d.zip`), rt0 = await runtimeOf(`${TMP}/default/aureate-knight-painted.runtime.zip`);
  check('default-keeps-saved', 'Default rebuild uses the saved project as saved: the custom clip (incl. its cape deform key, hand set, event) and the idle correction are kept byte-for-byte, in the project and the runtime package',
    st0.builtFrom.mode === 'as saved' && clipOf(p0, 'victory_custom') === clipOf(saved, 'victory_custom') && corrOf(p0) === corrOf(saved) && p0.clips.length === saved.clips.length
      && rt0.clips.some((c) => c.name === 'victory_custom') && pick(p0) === pick(saved) && files.every((f) => fs.existsSync(`${TMP}/default/${f}`)),
    { mode: st0.builtFrom.mode, clips: [saved.clips.length, p0.clips.length], customKept: clipOf(p0, 'victory_custom') === clipOf(saved, 'victory_custom'), correctionKept: corrOf(p0) === corrOf(saved), log: log0.trim().split('\n')[0] });

  // ---- 3) explicit --rebase: painted skin onto the current starter AND the saved animation work carried across
  const log1 = build([`--from=${TMP}/saved.character2d.zip`, '--rebase', `--out=${TMP}/rebased`]);
  const st1 = JSON.parse(fs.readFileSync(`${TMP}/rebased/skin-status.json`, 'utf8')), p1 = await projectOf(`${TMP}/rebased/aureate-knight-painted.character2d.zip`), rt1 = await runtimeOf(`${TMP}/rebased/aureate-knight-painted.runtime.zip`);
  const sk1 = p1.skins.find((s) => s.id === 'painted');
  check('rebase-keeps-work', '--rebase: same painted pieces, statuses and placement (≤ 0.01 px) on the current starter, and the custom clip + idle correction carried across unchanged (reported)',
    st1.builtFrom.mode === 'rebased' && Object.keys(sk1.replace).sort().join() === 'helmet.default,mantle.default' && sk1.status['mantle.default'] === 'provisional' && sk1.status['helmet.default'] === 'finished'
      && Object.values(st1.builtFrom.placement).every((d) => d <= 0.01) && st1.builtFrom.carried.clips.includes('victory_custom') && st1.builtFrom.carried.corrections.includes('idle')
      && clipOf(p1, 'victory_custom') === clipOf(saved, 'victory_custom') && corrOf(p1) === corrOf(saved) && rt1.clips.some((c) => c.name === 'victory_custom') && files.every((f) => fs.existsSync(`${TMP}/rebased/${f}`)),
    { builtFrom: st1.builtFrom, log: log1.trim().split('\n')[0] });
  const art = fs.readFileSync(`${TMP}/rebased/ART-REQUESTS.txt`, 'utf8');
  check('rebuild-outputs', 'Rebuilt outputs carry the painted cape animation (deformFrom in project and runtime package), the painted skin opens by default, and ART-REQUESTS lists the provisional cape',
    p1.attachments['mantle.default@painted']?.deformFrom === 'mantle.default' && rt1.attachments['mantle.default@painted']?.deformFrom === 'mantle.default' && rt1.defaultSkin === 'painted'
      && /provisional: 1/.test(art) && fs.readFileSync(`${TMP}/rebased/Aureate-Knight-2D-Player.html`, 'utf8').includes('mantle.default@painted'),
    { deformFrom: p1.attachments['mantle.default@painted']?.deformFrom, runtimeDefaultSkin: rt1.defaultSkin, artRequestsStatus: art.split('\n').filter((l) => /^ {2}(finished|provisional|missing):/.test(l)) });

  // ---- 4) stability: default rebuild of the rebased output, and a second --rebase, reproduce it exactly
  build([`--from=${TMP}/rebased/aureate-knight-painted.character2d.zip`, `--out=${TMP}/as-saved`]);
  build([`--from=${TMP}/rebased/aureate-knight-painted.character2d.zip`, '--rebase', `--out=${TMP}/rebased2`]);
  const st2 = JSON.parse(fs.readFileSync(`${TMP}/as-saved/skin-status.json`, 'utf8')), p2 = await projectOf(`${TMP}/as-saved/aureate-knight-painted.character2d.zip`), p3 = await projectOf(`${TMP}/rebased2/aureate-knight-painted.character2d.zip`);
  check('rebuild-stable', 'Rebuilding again — default (as saved) and --rebase a second time — reproduces the same painted pieces and clips exactly',
    st2.builtFrom.mode === 'as saved' && pick(p2) === pick(p1) && pick(p3) === pick(p1) && clipOf(p2, 'victory_custom') === clipOf(saved, 'victory_custom') && clipOf(p3, 'victory_custom') === clipOf(saved, 'victory_custom') && p3.clips.length === p1.clips.length,
    { asSaved: st2.builtFrom.mode, identicalAsSaved: pick(p2) === pick(p1), identicalRebasedTwice: pick(p3) === pick(p1), clips: [p1.clips.length, p2.clips.length, p3.clips.length] });

  // ---- 5) --rebase refuses instead of dropping: (a) a painted piece without a fit template, (b) a custom clip that
  // uses art the starter does not have. The default as-saved rebuild keeps (b) intact.
  const { writeZip } = await import('../viewer/js/art2d/zip.js');
  const variant = async (name, mutate) => { const j = structuredClone(saved); mutate(j); const entries = []; for (const [p, b] of await readZip(new Uint8Array(fs.readFileSync(`${TMP}/saved.character2d.zip`)))) entries.push({ path: p, data: p === 'character.json' ? JSON.stringify(j) : b }); fs.writeFileSync(`${TMP}/${name}.character2d.zip`, writeZip(entries)); return `${TMP}/${name}.character2d.zip`; };
  const tryBuild = (args) => { try { build(args); return null; } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); } };
  const noTpl = await variant('no-template', (j) => { j.fitting.templates.painted.layers = j.fitting.templates.painted.layers.filter((l) => l.target !== 'mantle.default'); });
  const msgA = tryBuild([`--from=${noTpl}`, '--rebase', `--out=${TMP}/nt`]);
  const extra = await variant('extra-art', (j) => { j.attachments['mantle.extra'] = { ...structuredClone(j.attachments['mantle.default']), id: 'mantle.extra', name: 'mantle (extra)' };
    const c = structuredClone(j.clips.find((x) => x.name === 'victory_custom')); c.name = 'extra_clip'; c.tracks.slots = { mantle: { attachment: { t: [0], v: ['mantle.extra'] } } }; j.clips.push(c); });
  const msgB = tryBuild([`--from=${extra}`, '--rebase', `--out=${TMP}/ea`]);
  const okB = tryBuild([`--from=${extra}`, `--out=${TMP}/ea-default`]), pB = okB ? null : await projectOf(`${TMP}/ea-default/aureate-knight-painted.character2d.zip`);
  check('rebase-refuses-loss', '--rebase never drops work silently: a painted piece without a fit template, or a custom clip using art the starter lacks, stops the build with a message; the default as-saved rebuild keeps that clip',
    /cannot be carried over/.test(msgA || '') && /mantle.default/.test(msgA || '') && /cannot be carried onto the current starter/.test(msgB || '') && /extra_clip/.test(msgB || '') && !okB && pB?.clips.some((c) => c.name === 'extra_clip'),
    { template: (msgA || '').split('\n').find((l) => /carried over/.test(l))?.slice(0, 160), customArt: (msgB || '').split('\n').find((l) => /carried onto/.test(l))?.slice(0, 220), asSavedKeepsIt: !!pB?.clips.some((c) => c.name === 'extra_clip') });
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
