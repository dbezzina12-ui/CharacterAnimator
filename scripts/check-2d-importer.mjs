// Importer regressions (reported bugs): (1) re-imported / re-meshed animated art kept deformation keys for the
// old vertex count → invalid coordinates; (2) a fitted painted cape lost its deformation animation; (3)
// proportion fitting discarded the layers.json position/rotation. Each is checked through the real UI where a
// control exists, then through save → fresh reopen, the runtime package and sprite export.
//   node scripts/check-2d-importer.mjs   → validation/importer/{checks.json,REPORT.md}
// Test art: the starter cape resampled to other resolutions (and hue-shifted where noted) — fixtures, not paintings.
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer, CHROME, CHROME_ARGS } from './serve.mjs';

const OUT = 'validation/importer', TMP = `${OUT}/_tmp`;
fs.mkdirSync(TMP, { recursive: true });
const results = [];
const check = (id, title, pass, details) => { results.push({ id, title, pass: !!pass, details }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${title} — ${JSON.stringify(details).slice(0, 300)}`); };
const server = await startServer(0), base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [...CHROME_ARGS, '--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
const CAPE = 'mantle.default', CLIPS = [['idle', 0.6], ['idle', 1.4], ['hover_sword_vigil', 2.1], ['walk_in_place', 0.5], ['sword_2h_slash', 1.1]];
// helpers evaluated in every page
const HELPERS = `window.H = {
  b64: (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); },
  resample: async (attId, k = 2, hue = 0) => { const io = await import('./js/art2d/project-io.js'), P = art2d.project, a = P.attachments[attId];
    const d = await io.decodeImage(art2d.store.bytes(P.images[a.image].path)), s = document.createElement('canvas'); s.width = d.width; s.height = d.height; s.getContext('2d').putImageData(d, 0, 0);
    const c = document.createElement('canvas'); c.width = Math.round(d.width * k); c.height = Math.round(d.height * k); const g = c.getContext('2d'); if (hue) g.filter = 'hue-rotate(' + hue + 'deg)'; g.drawImage(s, 0, 0, c.width, c.height);
    return io.encodePNG(g.getImageData(0, 0, c.width, c.height)); },
  keys: (P, attId) => { const n = P.attachments[attId]?.vertices.length, lens = new Set(); let bad = 0;
    for (const c of P.clips) for (const L of ['tracks', 'corrections']) { const tr = c[L]?.deform?.[attId]; if (!tr) continue; for (const v of tr.v) { lens.add(v.length / 2); if (v.length !== n) bad++; } }
    return { meshVerts: n / 2, keyVerts: [...lens], mismatched: bad }; },
  // world vertices of an attachment in clip poses (skin), + whether every coordinate is finite
  pose: async (P, attId, skin, clips) => { const { Rig } = await import('./js/art2d/core.js'); const r = new Rig(P); r.setSkin(skin); const out = []; let finite = true;
    for (const [c, t] of clips) { const v = Array.from(r.skinAttachment(attId, r.evaluate(c, t))); if (!v.every(Number.isFinite)) finite = false; out.push(v.map((x) => +x.toFixed(3))); } return { out, finite }; },
  // max deformation displacement (px) the clip applies to an attachment
  motion: async (P, attId, skin, clips) => { const { Rig } = await import('./js/art2d/core.js'); const r = new Rig(P); r.setSkin(skin); let m = 0;
    for (const [c, t] of clips) { const p1 = r.evaluate(c, t), a = Array.from(r.skinAttachment(attId, p1)); p1.deform.delete(attId); const b = r.skinAttachment(attId, p1); for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); } return +m.toFixed(3); },
  // rendered silhouette IoU of one slot between two skins (or two projects) over the clip times
  slotIoU: async (PA, skinA, PB, skinB, slot, clips) => { const ex = await import('./js/art2d/exporters.js'), { Rig } = await import('./js/art2d/core.js');
    const ra = await ex.offscreenRenderer(PA, art2d.store), rb = PB === PA ? ra : await ex.offscreenRenderer(PB, art2d.store), A = new Rig(PA), B = new Rig(PB); A.setSkin(skinA); B.setSkin(skinB); const res = [];
    for (const [c, t] of clips) { const rect = [-420, 300, 420, 1100], ia = ex.renderPose(ra, A, A.evaluate(c, t), rect, 0.5, { only: new Set([slot]) }), ib = ex.renderPose(rb, B, B.evaluate(c, t), rect, 0.5, { only: new Set([slot]) });
      let i = 0, u = 0; for (let k = 3; k < ia.data.length; k += 4) { const x = ia.data[k] > 60, y = ib.data[k] > 60; if (x && y) i++; if (x || y) u++; } res.push(u ? i / u : 1); } return res.map((x) => +x.toFixed(4)); },
};`;
const openEditor = async (page) => {
  await page.goto(`${base}/viewer/knight.html?art=2d`);
  await page.waitForFunction(() => window.art2d?.editor?.ready, null, { timeout: 120000 });
  await page.evaluate(() => art2d.editor.ready); await page.evaluate(HELPERS); await page.locator('#p2Pause').click();
};
const save = async (page, btn, file) => { const w = page.waitForEvent('download'); await page.locator(btn).click(); const d = await w; await d.saveAs(file); return file; };
const reopenFresh = async (file, fn, arg) => {           // a brand-new page that only sees the saved ZIP
  const p2 = await browser.newPage({ viewport: { width: 1200, height: 900 }, acceptDownloads: true }); p2.on('pageerror', (e) => errors.push('fresh: ' + e.message));
  await openEditor(p2); await p2.locator('#p2Open').setInputFiles(file);
  await p2.waitForFunction((n) => art2d.editor.from === n, file.split('/').pop(), { timeout: 60000 }); await p2.evaluate(() => art2d.editor.ready);
  const r = await p2.evaluate(fn, arg); await p2.close(); return r;
};
const runtimePose = async (zipFile, attId, skin, clips) => {  // the exported runtime package alone, in the standalone runtime
  const { readZip } = await import('../viewer/js/art2d/zip.js'); const dir = `${TMP}/rt_${Date.now()}`; fs.mkdirSync(dir, { recursive: true }); let pkg = null;
  for (const [p, b] of await readZip(new Uint8Array(fs.readFileSync(zipFile)))) { fs.mkdirSync(`${dir}/${p}`.replace(/\/[^/]*$/, ''), { recursive: true }); fs.writeFileSync(`${dir}/${p}`, b); if (p.endsWith('.runtime.json')) pkg = p; }
  const p3 = await browser.newPage(); p3.on('pageerror', (e) => errors.push('runtime: ' + e.message));
  await p3.goto(`${base}/runtime/example/?package=${encodeURIComponent('/' + dir + '/' + pkg)}`); await p3.waitForFunction(() => window.runtimeReady, null, { timeout: 60000 });
  const r = await p3.evaluate(({ attId, skin, clips }) => { character.pause(); const rig = character.rig; rig.setSkin(skin); return clips.map(([c, t]) => Array.from(rig.skinAttachment(attId, rig.evaluate(c, t))).map((x) => +x.toFixed(3))); }, { attId, skin, clips });
  await p3.close(); fs.rmSync(dir, { recursive: true, force: true }); return r;
};
const maxDiff = (A, B) => { let m = 0; if (A.length !== B.length) return Infinity; for (let i = 0; i < A.length; i++) { if (A[i].length !== B[i].length) return Infinity; for (let k = 0; k < A[i].length; k++) m = Math.max(m, Math.abs(A[i][k] - B[i][k])); } return +m.toFixed(4); };
// sprite frame of the painted/default skin vs a direct editor render (alpha); export refuses broken keys
const spriteCheck = (page, skin, clip) => page.evaluate(async ({ skin, clip }) => {
  const ex = await import('./js/art2d/exporters.js'), io = await import('./js/art2d/project-io.js'), { Rig } = await import('./js/art2d/core.js');
  const sp = await ex.exportSpriteSheets(art2d.project, art2d.store, { clips: [clip], scale: 0.5, skin }), m = sp.manifest.clips[clip], f = m.frames[Math.floor(m.frames.length / 2)];
  const sheet = await io.decodeImage(sp.files.find((x) => x.path === sp.manifest.sheets[f.sheet].path).data), r = await ex.offscreenRenderer(art2d.project, art2d.store), rig = new Rig(art2d.project); rig.setSkin(skin);
  const x0 = -m.registration[0] / 0.5, y1 = m.registration[1] / 0.5, direct = ex.renderPose(r, rig, rig.evaluate(clip, f.t), [x0, y1 - m.frameSize[1] / 0.5, x0 + m.frameSize[0] / 0.5, y1], 0.5);
  let d = 0, n = 0; for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) { d += Math.abs(sheet.data[((f.y + y) * sheet.width + f.x + x) * 4 + 3] - direct.data[((f.offset[1] + y) * direct.width + f.offset[0] + x) * 4 + 3]); n++; }
  return { meanAlphaDiff: +(d / n).toFixed(3), t: f.t };
}, { skin, clip });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
  page.on('pageerror', (e) => errors.push(e.message));

  // ================= (1) re-imported higher-resolution animated art keeps valid deformation keys =================
  await openEditor(page);
  const before = await page.evaluate(async ({ CAPE, CLIPS }) => { window.REF = structuredClone(art2d.project); return { keys: H.keys(art2d.project, CAPE), motion: await H.motion(art2d.project, CAPE, 'default', CLIPS) }; }, { CAPE, CLIPS });
  // 1a: layered import of the cape at 2x onto the SAME attachment (layers.json name "default") — the reported case
  fs.writeFileSync(`${TMP}/mantle.png`, Buffer.from(await page.evaluate(async (CAPE) => H.b64(await H.resample(CAPE, 2)), CAPE), 'base64'));
  const lj = await page.evaluate(async (CAPE) => { const zip = await import('./js/art2d/zip.js'); const pack = await art2d.paintPack('painted');
    const j = JSON.parse(zip.textOf(pack.files.find((f) => f.path === 'layers.json').data)), L = j.layers.find((l) => l.target === CAPE);
    return { ...j, layers: [{ file: 'mantle.png', slot: 'mantle', name: 'default', x: L.x, y: L.y, w: L.w, h: L.h, scale: L.scale, rotation: L.rotation }] }; }, CAPE);
  fs.writeFileSync(`${TMP}/layers.json`, JSON.stringify(lj));
  await page.locator('#p2Import').setInputFiles([`${TMP}/mantle.png`, `${TMP}/layers.json`]);
  await page.waitForFunction((CAPE) => art2d.project.attachments[CAPE].vertices.length / 2 > 300, CAPE, { timeout: 60000 });
  const reimport = await page.evaluate(async ({ CAPE, CLIPS }) => { const P = art2d.project;
    return { keys: H.keys(P, CAPE), pose: await H.pose(P, CAPE, 'default', CLIPS), motion: await H.motion(P, CAPE, 'default', CLIPS), errors: art2d.validate().errors.filter((e) => /deform/.test(e)) }; }, { CAPE, CLIPS });
  const silhouette = await page.evaluate(async ({ CLIPS }) => H.slotIoU(window.REF, 'default', art2d.project, 'default', 'mantle', CLIPS), { CLIPS });
  check('reimport-keys-remapped', `Layered re-import of the cape at 2× onto the same attachment: every deformation key follows the new mesh (${before.keys.meshVerts} → ${reimport.keys.meshVerts} vertices), coordinates finite`,
    reimport.keys.meshVerts > before.keys.meshVerts * 2 && reimport.keys.mismatched === 0 && reimport.keys.keyVerts.length === 1 && reimport.keys.keyVerts[0] === reimport.keys.meshVerts && reimport.pose.finite && !reimport.errors.length,
    { before: before.keys, after: reimport.keys, finite: reimport.pose.finite, validation: reimport.errors.slice(0, 2) });
  check('reimport-animation-kept', 'The re-imported cape still animates like before: same deformation amount, same deformed silhouette in idle / hover / walk / slash',
    Math.abs(reimport.motion - before.motion) < 0.15 * before.motion && Math.min(...silhouette) > 0.97, { motionBeforePx: before.motion, motionAfterPx: reimport.motion, silhouetteIoU: silhouette });
  // 1b: save through the Save button → fresh page; runtime package through the Runtime button; sprite export
  await save(page, '#p2Save', `${TMP}/reimport.character2d.zip`); await save(page, '#p2Runtime', `${TMP}/reimport.runtime.zip`);
  const reopened = await reopenFresh(`${TMP}/reimport.character2d.zip`, async ({ CAPE, CLIPS }) => ({ keys: H.keys(art2d.project, CAPE), pose: await H.pose(art2d.project, CAPE, 'default', CLIPS) }), { CAPE, CLIPS });
  const rtRe = await runtimePose(`${TMP}/reimport.runtime.zip`, CAPE, 'default', CLIPS);
  const spRe = await spriteCheck(page, 'default', 'idle');
  check('reimport-save-export', 'Re-imported cape: fresh reopen of the saved ZIP, the runtime package and a sprite frame all show the same deformed cape as the editor',
    reopened.keys.mismatched === 0 && maxDiff(reopened.pose.out, reimport.pose.out) < 1e-3 && maxDiff(rtRe, reimport.pose.out) < 1e-2 && spRe.meanAlphaDiff < 2,
    { reopenedKeys: reopened.keys, reopenVsEditorPx: maxDiff(reopened.pose.out, reimport.pose.out), runtimeVsEditorPx: maxDiff(rtRe, reimport.pose.out), sprite: spRe });
  // 1c: the Replace button at 2x, then Undo / Redo — keys and mesh always agree
  await openEditor(page);
  await page.evaluate(() => art2d.selectSlot('mantle', 'mantle.default'));
  await page.locator('#p2Replace').setInputFiles(`${TMP}/mantle.png`);
  await page.waitForFunction((CAPE) => art2d.project.attachments[CAPE].source.kind === 'imported', CAPE, { timeout: 60000 });
  const steps = { replaced: await page.evaluate((CAPE) => H.keys(art2d.project, CAPE), CAPE) };
  await page.locator('#p2Undo').click(); steps.undo = await page.evaluate((CAPE) => H.keys(art2d.project, CAPE), CAPE);
  await page.locator('#p2Redo').click(); steps.redo = await page.evaluate((CAPE) => H.keys(art2d.project, CAPE), CAPE);
  check('replace-undo-redo', 'Replace button at 2×, Undo, Redo: the cape keys match the mesh at every step', Object.values(steps).every((k) => k.mismatched === 0) && steps.undo.meshVerts === before.keys.meshVerts && steps.redo.meshVerts > before.keys.meshVerts, steps);
  // 1d: guard — keys that do not match the mesh are never skinned or exported
  const guard = await page.evaluate(async ({ CAPE }) => { const { Rig } = await import('./js/art2d/core.js'), ex = await import('./js/art2d/exporters.js');
    const P = structuredClone(art2d.project), c = P.clips.find((x) => x.name === 'idle'); c.tracks.deform[CAPE] = { t: [0], v: [new Array(213 * 2).fill(4)] };
    const r = new Rig(P), ps = r.evaluate('idle', 0.5), finite = Array.from(r.skinAttachment(CAPE, ps)).every(Number.isFinite);
    let sprite = 'exported', runtime = 'exported';
    try { await ex.exportSpriteSheets(P, art2d.store, { clips: ['idle'], scale: 0.25 }); } catch (e) { sprite = e.message.slice(0, 120); }
    try { await ex.exportRuntimePackage(P, art2d.store, {}); } catch (e) { runtime = e.message.slice(0, 120); }
    return { skipped: ps.deformSkipped, finite, sprite, runtime }; }, { CAPE });
  check('stale-keys-guard', 'Keys made for another mesh: core skips + reports them (finite coordinates); sprite and runtime export refuse the project',
    guard.finite && guard.skipped?.includes(CAPE) && /refused/.test(guard.sprite) && /failed validation/.test(guard.runtime), guard);

  // 1e: a valid key followed by a SHORTER key (213 → 212 vertices) on the real cape, evaluated halfway between them
  const seg = await page.evaluate(async ({ CAPE }) => { const { Rig } = await import('./js/art2d/core.js'), ex = await import('./js/art2d/exporters.js');
    const io = await import('./js/art2d/project-io.js'), { project: P, store } = await io.loadProjectURL('../characters2d/aureate_knight/character.json'), n = P.attachments[CAPE].vertices.length, c = P.clips.find((x) => x.name === 'idle');
    const good = c.tracks.deform[CAPE].v[0]; c.tracks.deform[CAPE] = { t: [0, 1], v: [good, good.slice(0, n - 2)] };
    const r = new Rig(P), ps = r.evaluate('idle', 0.5), v = Array.from(r.skinAttachment(CAPE, ps));
    let sprite = 'exported', runtime = 'exported';
    try { await ex.exportSpriteSheets(P, store, { clips: ['idle'], scale: 0.25 }); } catch (e) { sprite = e.message.slice(0, 140); }
    try { await ex.exportRuntimePackage(P, store, {}); } catch (e) { runtime = e.message.slice(0, 140); }
    return { meshVerts: n / 2, keyVerts: [good.length / 2, (n - 2) / 2], nonFinite: v.filter((x) => !Number.isFinite(x)).length, issues: ps.deformIssues, sprite, runtime }; }, { CAPE });
  check('malformed-segment', 'Cape with a 213-vertex key followed by a 212-vertex key, evaluated halfway: both keys validated before interpolating — segment skipped and reported, no invalid coordinates, exports refuse it',
    seg.nonFinite === 0 && seg.issues?.[0]?.keys?.[0]?.floats === 424 && /212 vertices but the mesh has 213/.test(seg.sprite) && /failed validation/.test(seg.runtime), seg);

  // ================= (2) a fitted painted cape keeps the cape's deformation animation =================
  await openEditor(page);
  fs.writeFileSync(`${TMP}/mantle.default.png`, Buffer.from(await page.evaluate(async (CAPE) => H.b64(await H.resample(CAPE, 1.5, 40)), CAPE), 'base64'));
  await page.locator('#p2FitOpen').setInputFiles(`${TMP}/mantle.default.png`);
  await page.waitForFunction(() => art2d.fit?.session?.layers?.length === 1 && document.querySelector('#p2FAccept'), null, { timeout: 60000 });
  await page.locator('#p2FAccept').click();
  await page.waitForFunction(() => !!art2d.project.attachments['mantle.default@painted'] && !art2d.fit, null, { timeout: 60000 });
  const PC = 'mantle.default@painted';
  const fitted = await page.evaluate(async ({ CAPE, PC, CLIPS }) => { const P = art2d.project;
    return { deformFrom: P.attachments[PC].deformFrom, verts: [P.attachments[CAPE].vertices.length / 2, P.attachments[PC].vertices.length / 2],
      starterMotion: await H.motion(P, CAPE, 'default', CLIPS), paintedMotion: await H.motion(P, PC, 'painted', CLIPS), pose: await H.pose(P, PC, 'painted', CLIPS),
      iou: await H.slotIoU(P, 'default', P, 'painted', 'mantle', CLIPS), history: art2d.history().slice(-1) }; }, { CAPE, PC, CLIPS });
  check('fitted-cape-animates', `Painted cape fitted through Fit artwork → Accept (different mesh: ${fitted.verts[1]} vs ${fitted.verts[0]} vertices) plays the cape's deformation: same amount, same deformed silhouette`,
    fitted.deformFrom === CAPE && fitted.paintedMotion > 0.5 && Math.abs(fitted.paintedMotion - fitted.starterMotion) < 0.15 * fitted.starterMotion && Math.min(...fitted.iou) > 0.95 && fitted.pose.finite,
    { deformFrom: fitted.deformFrom, starterMotionPx: fitted.starterMotion, paintedMotionPx: fitted.paintedMotion, silhouetteIoU: fitted.iou });
  // a deformation correction authored later on the starter cape flows to the painted cape (Deform tool, real drag)
  const corr = await page.evaluate(async ({ CAPE, PC }) => { art2d.setSkin('default'); art2d.selectClip('idle'); art2d.seek(1); art2d.setMode('animate'); art2d.editor.frame(0);
    const { Rig } = await import('./js/art2d/core.js'); const r0 = new Rig(art2d.project); r0.setSkin('painted'); const before = Array.from(r0.skinAttachment(PC, r0.evaluate('idle', 1)));
    const b = r0.attachments.get(CAPE).bind; let cx = 0, cy = 0; for (let i = 0; i < b.length; i += 2) { cx += b[i]; cy += b[i + 1]; } cx /= b.length / 2; cy /= b.length / 2;
    art2d.editor.rig.evaluate('idle', 1); art2d.deformDrag(CAPE, [cx, cy - 120], [cx + 25, cy - 120], 120);
    const r1 = new Rig(art2d.project); r1.setSkin('painted'); const after = Array.from(r1.skinAttachment(PC, r1.evaluate('idle', 1)));
    let m = 0; for (let i = 0; i < after.length; i++) m = Math.max(m, Math.abs(after[i] - before[i]));
    return { keyed: !!art2d.project.clips.find((c) => c.name === 'idle').corrections?.deform?.[CAPE], paintedMovedPx: +m.toFixed(2) }; }, { CAPE, PC });
  check('starter-correction-flows', 'A deformation correction authored on the starter cape with the Deform tool also moves the painted cape', corr.keyed && corr.paintedMovedPx > 2, corr);
  await page.evaluate(() => art2d.setSkin('painted'));
  const paintedRef = await page.evaluate(async ({ PC, CLIPS }) => (await H.pose(art2d.project, PC, 'painted', CLIPS)).out, { PC, CLIPS });
  await save(page, '#p2Save', `${TMP}/painted.character2d.zip`); await save(page, '#p2Runtime', `${TMP}/painted.runtime.zip`);
  const reP = await reopenFresh(`${TMP}/painted.character2d.zip`, async ({ PC, CLIPS }) => ({ deformFrom: art2d.project.attachments[PC].deformFrom, pose: await H.pose(art2d.project, PC, 'painted', CLIPS) }), { PC, CLIPS });
  const rtP = await runtimePose(`${TMP}/painted.runtime.zip`, PC, 'painted', CLIPS);
  const spP = await spriteCheck(page, 'painted', 'hover_sword_vigil');
  check('fitted-cape-save-export', 'Painted cape animation survives Save → fresh reopen, the runtime package (standalone runtime) and sprite export',
    reP.deformFrom === CAPE && maxDiff(reP.pose.out, paintedRef) < 1e-3 && maxDiff(rtP, paintedRef) < 1e-2 && spP.meanAlphaDiff < 2,
    { reopenVsEditorPx: maxDiff(reP.pose.out, paintedRef), runtimeVsEditorPx: maxDiff(rtP, paintedRef), sprite: spP });
  // re-fitting the (now keyed) painted cape at 2x remaps its own keys too
  const refit = await page.evaluate(async ({ CAPE, PC }) => { const P = art2d.project, n = P.attachments[PC].vertices.length, c = P.clips.find((x) => x.name === 'idle');
    c.corrections.deform[PC] = { t: [0, 2], v: [new Array(n).fill(3), new Array(n).fill(3)] };
    await art2d.startFit(new Map([['mantle.default.png', await H.resample(CAPE, 2, 40)]]), { skin: 'painted' }); await art2d.acceptFit();
    const k = H.keys(art2d.project, PC), v = art2d.project.clips.find((x) => x.name === 'idle').corrections.deform[PC].v[0];
    return { before: n / 2, keys: k, constantKept: v.every((x) => Math.abs(x - 3) < 1e-6), deformErrors: art2d.validate().errors.filter((e) => /deform/.test(e)).length }; }, { CAPE, PC });
  check('refit-keys-remapped', 'Re-fitting the painted cape at 2× after it has its own keys: those keys follow the new mesh (values kept)',
    refit.keys.mismatched === 0 && refit.keys.meshVerts > refit.before && refit.constantKept && refit.deformErrors === 0, refit);

  // ================= (3) proportion fitting keeps the layers.json placement =================
  await openEditor(page);
  const prop = await page.evaluate(async () => { const zip = await import('./js/art2d/zip.js'), fit = await import('./js/art2d/fitting.js'), { Rig, affDecompose } = await import('./js/art2d/core.js');
    const pack = await art2d.paintPack('painted'), lj = JSON.parse(zip.textOf(pack.files.find((f) => f.path === 'layers.json').data)), P = art2d.project, reg = { origin: lj.origin, scale: lj.scale, canvas: lj.canvas };
    // every piece: the pack's layers.json placement IS the piece's footprint (centre, rotation, displayed scale)
    let worst = { px: 0, deg: 0, scale: 0 }; const rig = new Rig(P);
    for (const L of lj.layers) { const c = fit.canvasFit(reg, L, L.w, L.h), f = fit.footprintFit(P, rig, L.target, L.w, L.h), wc = fit.imageToWorld({ fit: c }, L.w / 2, L.h / 2), wf = fit.imageToWorld({ fit: f }, L.w / 2, L.h / 2);
      worst = { px: Math.max(worst.px, Math.hypot(wc[0] - wf[0], wc[1] - wf[1])), deg: Math.max(worst.deg, Math.abs(((c.rotation - f.rotation + 540) % 360) - 180)), scale: Math.max(worst.scale, Math.abs(c.scale * c.scaleX - f.scale * f.scaleX) / f.scale) }; }
    // a proportion layer moved +40/+10 canvas px and rotated +12° in layers.json: the session and the installed piece keep that placement
    const L = lj.layers.find((l) => l.target === 'forearm_L.default'), a = P.attachments[L.target], moved = { ...L, mode: 'proportion', x: L.x + 40, y: L.y + 10, rotation: (L.rotation || 0) + 12 };
    const s = await art2d.startFit(new Map([[L.file, art2d.store.bytes(P.images[a.image].path)], ['layers.json', new TextEncoder().encode(JSON.stringify({ ...lj, layers: [moved] }))]]), { skin: 'painted' });
    const want = fit.canvasFit(s.registration, moved, s.layers[0].w, s.layers[0].h), wantC = fit.imageToWorld({ fit: want }, s.layers[0].w / 2, s.layers[0].h / 2), sess = s.layers[0].fit;
    await art2d.acceptFit(); const r = new Rig(art2d.project); r.setSkin('painted'); r.evaluate(null, 0);
    const rec = r.attachments.get('forearm_L.default@painted'), d = affDecompose(rec.place), att = art2d.project.attachments['forearm_L.default@painted'];
    const centre = (() => { const s2 = att.imageScale, px = att.pivot[0], py = att.pivot[1], lx = (s.layers[0].w / 2 - px) * s2, ly = (py - s.layers[0].h / 2) * s2, p = rec.place; return [p[0] * lx + p[2] * ly + p[4], p[1] * lx + p[3] * ly + p[5]]; })();
    return { pack: { pieces: lj.layers.length, worst }, mode: s.layers[0].mode, sessionVsLayersJson: { px: +Math.hypot(sess.x - want.x, sess.y - want.y).toFixed(4), deg: +Math.abs(sess.rotation - want.rotation).toFixed(4) },
      installedVsLayersJson: { px: +Math.hypot(centre[0] - wantC[0], centre[1] - wantC[1]).toFixed(3), deg: +Math.abs(((d.rotation - want.rotation + 540) % 360) - 180).toFixed(4) }, wantRotation: +want.rotation.toFixed(3) }; });
  check('pack-placement-roundtrip', `Template-pack layers.json placement equals the piece footprint for all ${prop.pack.pieces} pieces (centre, rotation, displayed scale incl. props and hand captures)`,
    prop.pack.worst.px < 0.05 && prop.pack.worst.deg < 0.01 && prop.pack.worst.scale < 1e-6, prop.pack);
  check('proportion-keeps-placement', 'Proportion fit of a layer moved +40/+10 px and rotated +12° in layers.json: the session and the installed piece keep that position and rotation',
    prop.mode === 'proportion' && prop.sessionVsLayersJson.px < 1e-3 && prop.sessionVsLayersJson.deg < 1e-3 && prop.installedVsLayersJson.px < 0.05 && prop.installedVsLayersJson.deg < 0.01, prop);
  // UI: a replace layer whose layers.json placement disagrees shows the note; switching it to proportion (untouched) re-registers to layers.json
  const ui = await page.evaluate(async () => { const zip = await import('./js/art2d/zip.js'), fit = await import('./js/art2d/fitting.js');
    const pack = await art2d.paintPack('painted'), lj = JSON.parse(zip.textOf(pack.files.find((f) => f.path === 'layers.json').data)), P = art2d.project;
    const L = lj.layers.find((l) => l.target === 'helmet.default'), a = P.attachments[L.target], moved = { ...L, x: L.x + 30, rotation: 8 };
    const s = await art2d.startFit(new Map([[L.file, art2d.store.bytes(P.images[a.image].path)], ['layers.json', new TextEncoder().encode(JSON.stringify({ ...lj, layers: [moved] }))]]), { skin: 'painted' });
    const note = document.querySelector('#p2FitPanel')?.textContent.includes('choose proportion to keep the layers.json placement');
    const replaceRot = s.layers[0].fit.rotation; return { note, replaceRot, want: fit.canvasFit(s.registration, moved, s.layers[0].w, s.layers[0].h).rotation }; });
  await page.locator('#p2FMode').selectOption('proportion'); await page.evaluate(() => art2d.refreshFit());
  const ui2 = await page.evaluate(() => ({ mode: art2d.fit.session.layers[0].mode, rotation: art2d.fit.session.layers[0].fit.rotation }));
  // a layer the user already adjusted is NOT moved by a mode switch
  await page.locator('#p2FMode').selectOption('replace'); await page.evaluate(() => art2d.fitUpdate((l) => { l.fit = { ...l.fit, x: l.fit.x + 5 }; }));
  const touchedX = await page.evaluate(() => art2d.fit.session.layers[0].fit.x); await page.locator('#p2FMode').selectOption('proportion');
  const ui3 = await page.evaluate(() => art2d.fit.session.layers[0].fit.x); await page.evaluate(() => art2d.cancelFit());
  check('fit-mode-ui', 'Fit artwork panel: replace mode explains a disagreeing layers.json placement; switching an untouched layer to proportion applies the layers.json rotation; an adjusted layer is not moved',
    ui.note && Math.abs(ui.replaceRot - 8) > 1 && ui2.mode === 'proportion' && Math.abs(ui2.rotation - ui.want) < 1e-6 && Math.abs(ui3 - touchedX) < 1e-9, { ...ui, afterSwitch: ui2, adjustedKept: Math.abs(ui3 - touchedX) < 1e-9 });
  // layered importer honours per-layer scale / rotation (a prop at -175°, 1/3 bone scale)
  const imp = await page.evaluate(async () => { const zip = await import('./js/art2d/zip.js'), io = await import('./js/art2d/project-io.js'), { Rig, affDecompose } = await import('./js/art2d/core.js');
    const pack = await art2d.paintPack('painted'), lj = JSON.parse(zip.textOf(pack.files.find((f) => f.path === 'layers.json').data)), P = art2d.project, out = {};
    const pick = ['prop_R.Sword2H', 'hand_L.hover'], files = new Map(), layers = [];
    for (const t of pick) { const L = lj.layers.find((l) => l.target === t), a = P.attachments[t]; files.set(L.file, art2d.store.bytes(P.images[a.image].path)); layers.push({ ...L, slot: a.slot, name: 'reimp' }); }
    files.set('layers.json', new TextEncoder().encode(JSON.stringify({ ...lj, layers }))); await io.importLayers(P, art2d.store, files);
    const r = new Rig(P), bb = (b) => { let q = [1e9, 1e9, -1e9, -1e9]; for (let i = 0; i < b.length; i += 2) q = [Math.min(q[0], b[i]), Math.min(q[1], b[i + 1]), Math.max(q[2], b[i]), Math.max(q[3], b[i + 1])]; return q; };
    for (const t of pick) { const A = r.attachments.get(t), B = r.attachments.get(`${P.attachments[t].slot}.reimp`), ba = bb(A.bind), b2 = bb(B.bind);
      out[t] = { bboxPx: +Math.max(...ba.map((v, i) => Math.abs(v - b2[i]))).toFixed(2), rotation: [+affDecompose(A.place).rotation.toFixed(2), +affDecompose(B.place).rotation.toFixed(2)] }; }
    return out; });
  check('layered-import-placement', 'Layered import of template-pack layers keeps each piece\'s rotation and displayed size (prop at -175° on a scaled bone, rotated hover hand)',
    Object.values(imp).every((x) => x.bboxPx < 4 && Math.abs(x.rotation[0] - x.rotation[1]) < 0.01), imp);
  check('no-errors', 'No page errors (editor, fresh pages, runtime)', errors.length === 0, errors.slice(0, 5));
} finally {
  await browser.close(); server.close(); fs.rmSync(TMP, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(`${OUT}/checks.json`, JSON.stringify({ date: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 1));
fs.writeFileSync(`${OUT}/REPORT.md`, ['# Importer regressions', '', `Generated by \`node scripts/check-2d-importer.mjs\`. ${results.length - failed.length} passed, ${failed.length} failed.`,
  'Test art is the starter cape resampled to other resolutions (hue-shifted for the fitted cape): fixtures, not paintings.', '',
  '| | check | measured |', '|---|---|---|', ...results.map((r) => `| ${r.pass ? '✅' : '❌'} | ${r.title} | ${JSON.stringify(r.details).replace(/\|/g, '/').slice(0, 320)} |`), ''].join('\n'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
