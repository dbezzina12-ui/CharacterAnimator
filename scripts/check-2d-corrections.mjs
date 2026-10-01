// Corrections, hand views, colour and determinism checks (build brief §8 E, F, H, I). Real UI where a control
// exists; every check compares measured values, none passes unconditionally.
//   node scripts/check-2d-corrections.mjs   → validation/corrections/{checks.json,REPORT.md,*.png}
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer, CHROME, CHROME_ARGS } from './serve.mjs';

const OUT = 'validation/corrections'; fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (id, title, pass, details) => { results.push({ id, title, pass: !!pass, details }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${title} — ${JSON.stringify(details).slice(0, 280)}`); };
const server = await startServer(0), base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [...CHROME_ARGS, '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const CLIP = 'knight_salute', T = [1.0, 1.25, 1.5, 2.0, 2.6];
// pose fingerprint shared by editor, reopened project and runtime: every drawn attachment's skinned vertices
const FP = `(rig, clip, t, opts = {}) => { const ps = rig.evaluate(clip, t, opts); const out = []; for (const d of rig.drawList(ps)) { const v = rig.skinAttachment(d.attachment, ps); out.push(d.slot + ':' + d.attachment); for (let i = 0; i < v.length; i += 7) out.push(+v[i].toFixed(3)); } return out; }`;
const maxDiff = (a, b) => { if (a.length !== b.length) return Infinity; let m = 0; for (let i = 0; i < a.length; i++) { if (typeof a[i] === 'string' ? a[i] !== b[i] : false) return Infinity; if (typeof a[i] === 'number') m = Math.max(m, Math.abs(a[i] - b[i])); } return m; };
try {
  await page.goto(`${base}/viewer/knight.html?art=2d`);
  await page.waitForFunction(() => window.art2d?.editor?.ready, null, { timeout: 120000 });
  await page.evaluate(() => art2d.editor.ready);
  await page.locator('#p2Pause').click();
  await page.evaluate(`window.__fp = ${FP}`);

  // ---- F: author a correction through the inspector (two keys, smooth easing), bake unchanged
  await page.locator('#p2Clip').selectOption(CLIP);
  const before = await page.evaluate(({ CLIP, T }) => {
    const c = art2d.project.clips.find((x) => x.name === CLIP);
    return { tracks: JSON.stringify(c.tracks), corr: JSON.stringify(c.corrections || null), bake: T.map((t) => __fp(art2d.rig, CLIP, t, { corrections: false })) };
  }, { CLIP, T });
  const key = async (t, v) => { await page.evaluate((t) => { art2d.seek(t); art2d.selectBone('forearm_R'); }, t); const f = page.locator('[data-bk="rotate"]'); await f.fill(String(v)); await f.press('Tab'); };
  await key(1.0, 2); await key(2.0, 10);
  await page.evaluate(() => art2d.seek(1.0)); await page.locator('#p2Ease').selectOption('smooth');
  const authored = await page.evaluate(({ CLIP, T }) => {
    const c = art2d.project.clips.find((x) => x.name === CLIP), tr = c.corrections?.bones?.forearm_R?.rotate || { t: [] }, rig = art2d.rig;
    const rot = (t) => { rig.evaluate(CLIP, t); return rig.local[rig.boneIndex.get('forearm_R') * 5 + 2]; };
    const rotBake = (t) => { rig.evaluate(CLIP, t, { corrections: false }); return rig.local[rig.boneIndex.get('forearm_R') * 5 + 2]; };
    const d = (t) => +(rot(t) - rotBake(t)).toFixed(4);
    return { key: tr, tracks: JSON.stringify(c.tracks), deltas: { 1: d(1), 1.25: d(1.25), 1.5: d(1.5), 2: d(2) }, corrected: T.map((t) => __fp(rig, CLIP, t)), history: art2d.history().slice(-3) };
  }, { CLIP, T });
  // the inspector value is degrees; core stores the delta in the same unit the inspector shows — compare relative shape
  const d1 = authored.deltas;
  const ratio = (t) => (d1[t] - d1[1]) / (d1[2] - d1[1]);
  const smoothOk = Math.abs(d1[2] - d1[1]) > 1e-3 && Math.abs(ratio(1.25) - 0.15625) < 0.01 && Math.abs(ratio(1.5) - 0.5) < 0.01;
  check('correction-authored', 'Correction keys authored in the inspector (forearm_R +2 → +10 over 1.0–2.0 s) with smooth easing from the ease menu', authored.key.t.length === 2 && smoothOk, { key: authored.key, progressAt1_25: +ratio(1.25).toFixed(4), expectedSmooth: 0.15625, linearWouldBe: 0.25 });
  check('bake-unchanged', 'The baked source track is byte-identical after authoring corrections (corrections are a separate layer)', authored.tracks === before.tracks, { tracksEqual: authored.tracks === before.tracks });
  const corrDiff = Math.max(...authored.corrected.map((c, i) => maxDiff(c, before.bake[i])));
  check('correction-visible', 'Corrected pose differs from the bake inside the keyed range', corrDiff > 1, { maxVertexDeltaPx: +corrDiff.toFixed(2) });
  // disable / enable / undo / redo through the UI
  await page.locator('#p2CorrToggle').click();
  const disabled = await page.evaluate(({ CLIP, T }) => T.map((t) => __fp(art2d.rig, CLIP, t)), { CLIP, T });
  await page.locator('#p2Undo').click();
  const reenabled = await page.evaluate(({ CLIP, T }) => T.map((t) => __fp(art2d.rig, CLIP, t)), { CLIP, T });
  await page.locator('#p2Redo').click(); await page.locator('#p2Undo').click();
  const offDiff = Math.max(...disabled.map((c, i) => maxDiff(c, before.bake[i]))), onDiff = Math.max(...reenabled.map((c, i) => maxDiff(c, authored.corrected[i])));
  check('correction-disable-undo', 'Disable button restores the bake exactly; undo re-enables the same corrected pose', offDiff < 1e-9 && onDiff < 1e-9, { disabledVsBake: offDiff, undoneVsCorrected: onDiff });

  // ---- save through the Save button, reopen in a fresh page from the ZIP only
  const dl = async (btn, p) => { const w = page.waitForEvent('download'); await page.locator(btn).click(); const d = await w; await d.saveAs(p); };
  await dl('#p2Save', `${OUT}/corrected.character2d.zip`);
  await dl('#p2Runtime', `${OUT}/corrected.runtime.zip`);
  const page2 = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page2.on('pageerror', (e) => errors.push('fresh page: ' + e.message));
  await page2.goto(`${base}/viewer/knight.html?art=2d`);
  await page2.waitForFunction(() => window.art2d?.editor?.ready, null, { timeout: 120000 });
  await page2.locator('#p2Open').setInputFiles(`${OUT}/corrected.character2d.zip`);
  await page2.waitForFunction(() => art2d.editor.from === 'corrected.character2d.zip', null, { timeout: 60000 }); await page2.evaluate(() => art2d.editor.ready);
  await page2.evaluate(`window.__fp = ${FP}`);
  const reopened = await page2.evaluate(({ CLIP, T }) => ({ fp: T.map((t) => __fp(art2d.rig, CLIP, t)), tracks: JSON.stringify(art2d.project.clips.find((x) => x.name === CLIP).tracks), valid: art2d.validate().errors.length }), { CLIP, T });
  const reDiff = Math.max(...reopened.fp.map((c, i) => maxDiff(c, authored.corrected[i])));
  check('correction-save-reopen', 'Saved ZIP reopened in a fresh page: same corrected pose, bake still unchanged, valid', reDiff < 1e-9 && reopened.tracks === before.tracks && reopened.valid === 0, { maxDiff: reDiff, errors: reopened.valid });
  await page2.close();

  // ---- runtime package (exported with the Runtime button) consumed by the standalone runtime alone
  const { readZip } = await import('../viewer/js/art2d/zip.js');
  const scratch = `${OUT}/_pkg`; fs.rmSync(scratch, { recursive: true, force: true }); fs.mkdirSync(scratch, { recursive: true });
  let pkgName = null;
  for (const [p, b] of await readZip(new Uint8Array(fs.readFileSync(`${OUT}/corrected.runtime.zip`)))) { fs.mkdirSync(`${scratch}/${p.split('/').slice(0, -1).join('/')}`, { recursive: true }); fs.writeFileSync(`${scratch}/${p}`, b); if (p.endsWith('.runtime.json')) pkgName = p; }
  const page3 = await browser.newPage({ viewport: { width: 600, height: 600 } });
  page3.on('pageerror', (e) => errors.push('runtime: ' + e.message));
  await page3.goto(`${base}/runtime/example/?package=${encodeURIComponent('/' + scratch + '/' + pkgName)}&clip=${CLIP}`);
  await page3.waitForFunction(() => window.runtimeReady, null, { timeout: 60000 });
  await page3.evaluate(`window.__fp = ${FP}`);
  const rt = await page3.evaluate(({ CLIP, T }) => { character.pause(); return T.map((t) => __fp(character.rig, CLIP, t)); }, { CLIP, T });
  const rtDiff = Math.max(...rt.map((c, i) => maxDiff(c, authored.corrected[i])));
  check('correction-runtime', 'Standalone runtime (exported package only) shows the same corrected pose as the editor', rtDiff < 1e-3, { maxDiffPx: rtDiff });

  // ---- H: colour/alpha — editor offscreen render vs runtime canvas (atlas pages) vs sprite-sheet frame
  const RECT = [-330, 300, -30, 700], SC = 1, BG = [0.07, 0.08, 0.11, 1], TT = 1.2;
  const edImg = await page.evaluate(async ({ CLIP, RECT, SC, BG, TT }) => {
    const ex = await import('./js/art2d/exporters.js'), r = await ex.offscreenRenderer(art2d.project, art2d.store);
    const img = ex.renderPose(r, art2d.rig, art2d.rig.evaluate(CLIP, TT), RECT, SC, { background: BG });
    const tr = ex.renderPose(r, art2d.rig, art2d.rig.evaluate(CLIP, TT), RECT, SC);
    const sp = await ex.exportSpriteSheets(art2d.project, art2d.store, { clips: [CLIP], scale: SC });
    const m = sp.manifest.clips[CLIP], f = m.frames.reduce((a, x) => (Math.abs(x.t - TT) < Math.abs(a.t - TT) ? x : a));
    const io = await import('./js/art2d/project-io.js'), sheet = await io.decodeImage(sp.files.find((x) => x.path === sp.manifest.sheets[f.sheet].path).data);
    // compare the sprite frame against a direct transparent render in the sprite's own registration
    const x0 = -m.registration[0] / SC, y1 = m.registration[1] / SC, rect = [x0, y1 - m.frameSize[1] / SC, x0 + m.frameSize[0] / SC, y1];
    const direct = ex.renderPose(r, art2d.rig, art2d.rig.evaluate(CLIP, f.t), rect, SC);
    let dA = 0, dC = 0, n = 0, nc = 0;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const si = ((f.y + y) * sheet.width + f.x + x) * 4, di = ((f.offset[1] + y) * direct.width + f.offset[0] + x) * 4;
      dA += Math.abs(sheet.data[si + 3] - direct.data[di + 3]); n++;
      if (sheet.data[si + 3] > 250 && direct.data[di + 3] > 250) { for (let k = 0; k < 3; k++) dC += Math.abs(sheet.data[si + k] - direct.data[di + k]); nc += 3; }
    }
    const transparentCorner = tr.data[3] === 0;
    return { w: img.width, h: img.height, data: Array.from(img.data), sprite: { alpha: dA / n, rgb: dC / nc, opaquePx: nc / 3 }, transparentCorner };
  }, { CLIP, RECT, SC, BG, TT });
  const rtImg = await page3.evaluate(({ CLIP, RECT, SC, TT, w, h }) => {
    const c = document.getElementById('c'); c.style.width = w + 'px'; c.style.height = h + 'px'; c.parentElement.style.flex = 'none';
    character.play(CLIP, { time: TT }); character.pause();
    character.draw({ x: (RECT[0] + RECT[2]) / 2, y: (RECT[1] + RECT[3]) / 2, zoom: SC }, { dpr: 1 });
    const g = document.createElement('canvas'); g.width = c.width; g.height = c.height; const x = g.getContext('2d'); x.drawImage(c, 0, 0);
    return { w: c.width, h: c.height, data: Array.from(x.getImageData(0, 0, c.width, c.height).data) };
  }, { CLIP, RECT, SC, TT, w: edImg.w, h: edImg.h });
  let cd = 0, cn = 0, big = 0, fg = 0;
  const bg = BG.slice(0, 3).map((x) => Math.round(x * 255));
  if (rtImg.w === edImg.w && rtImg.h === edImg.h) for (let i = 0; i < edImg.data.length; i += 4) {
    const d = Math.max(...[0, 1, 2].map((k) => Math.abs(edImg.data[i + k] - rtImg.data[i + k]))); cd += d; cn++; if (d > 24) big++;
    if (Math.max(...[0, 1, 2].map((k) => Math.abs(edImg.data[i + k] - bg[k]))) > 12) fg++;      // character pixels (not background)
  }
  check('colour-runtime-vs-editor', 'Runtime canvas (atlas pages) vs editor render, same pose and background: mean / >24-level pixel share (≥20% of the frame is character pixels)', cn && fg / cn > 0.2 && cd / cn < 2 && big / cn < 0.01, { size: [rtImg.w, rtImg.h], characterPixels: +(100 * fg / cn).toFixed(1) + '%', meanMaxChannelDiff: cn ? +(cd / cn).toFixed(3) : null, pixelsOver24: cn ? +(100 * big / cn).toFixed(3) + '%' : null });
  check('colour-sprite-vs-editor', 'Sprite-sheet frame vs editor render: alpha and premultiplication-safe RGB (opaque pixels); transparent background', edImg.sprite.alpha < 2 && edImg.sprite.rgb < 2 && edImg.transparentCorner, { meanAlphaDiff: +edImg.sprite.alpha.toFixed(3), meanRgbDiff: +edImg.sprite.rgb.toFixed(3), opaquePx: edImg.sprite.opaquePx, transparentCorner: edImg.transparentCorner });
  await page3.close(); fs.rmSync(scratch, { recursive: true, force: true });

  // ---- deterministic seek: same pose and pixels whatever was played or seeked before
  const det = await page.evaluate(async ({ CLIP }) => {
    const ed = art2d.editor, snap = () => JSON.stringify(__fp(art2d.rig, CLIP, ed.player.time));
    art2d.selectClip(CLIP); art2d.seek(1.7); ed.frame(0); const a = snap(), pa = ed.glCanvas.toDataURL();
    art2d.seek(3.9); ed.player.resume?.(); for (let i = 0; i < 20; i++) ed.player.update?.(1 / 30); art2d.selectClip('idle'); art2d.seek(0.3); art2d.selectClip(CLIP);
    ed.player.pause?.(); art2d.seek(1.7); ed.frame(0); const b = snap(), pb = ed.glCanvas.toDataURL();
    art2d.seek(0.3); ed.frame(0); const pc = ed.glCanvas.toDataURL(); art2d.seek(1.7); ed.frame(0);
    return { poseSame: a === b, pixelsSame: pa === pb, otherTimeDiffers: pc !== pa, t: ed.player.time };
  }, { CLIP });
  check('deterministic-seek', 'Seeking to a time gives the identical pose and identical editor pixels regardless of prior playback/seeks', det.poseSame && det.pixelsSame && det.otherTimeDiffers, det);

  // ---- I: rapid mode switching (3D ↔ 2D ↔ setup/animate) leaves one render loop and no errors
  const rapid = await page.evaluate(async () => {
    const old = window.requestAnimationFrame; let cb = new Set();
    window.requestAnimationFrame = (fn) => { if (fn.toString().includes('this.frame(dt)')) cb.add(fn); return old.call(window, fn); };
    const measure = () => new Promise((res) => { cb = new Set(); setTimeout(() => res(cb.size), 400); });
    for (let i = 0; i < 12; i++) { viewer.art2d.setMode(i % 2 ? '2d' : '3d'); art2d.setMode(i % 3 ? 'animate' : 'setup'); }
    await viewer.art2d.setMode('2d'); art2d.setMode('animate');
    await new Promise((r) => setTimeout(r, 300)); const loops = await measure(); window.requestAnimationFrame = old;
    return { loops, body: document.body.className.includes('mode2d'), editorMode: art2d.editor.mode };
  });
  check('rapid-mode-switch', '12 rapid 3D/2D + setup/animate switches: one 2D render loop, 2D mode active, no page errors', rapid.loops === 1 && rapid.body && errors.length === 0, { ...rapid, pageErrors: errors.length });

  // ---- the "Fit view" button (its id once collided with the fit panel container)
  await page.evaluate(() => { art2d.editor.renderer.view = { ...art2d.editor.renderer.view, zoom: 7, x: 5000 }; });
  await page.locator('#p2Fit').click();
  const fitBtn = await page.evaluate(() => ({ zoom: art2d.editor.renderer.view.zoom, x: art2d.editor.renderer.view.x, ids: document.querySelectorAll('#p2Fit').length }));
  check('fit-view-button', '"Fit view" button re-frames the character (unique element id)', fitBtn.ids === 1 && fitBtn.zoom < 7 && Math.abs(fitBtn.x) < 1000, fitBtn);

  // ---- E: hand views — appearances used per hero clip, no one-frame swaps, wrist continuity, missing variants
  const hv = await page.evaluate(async () => {
    const h = await import('./js/art2d/handviews.js'), io = await import('./js/art2d/project-io.js'), { Rig } = await import('./js/art2d/core.js');
    const P = art2d.project, rig = new Rig(P), out = { clips: {}, wrist: {}, missing: {} };
    for (const c of ['idle', 'hover_sword_vigil', 'sword_2h_idle', 'sword_2h_slash', 'knight_salute', 'walk_in_place', 'contact_detonator_2d']) {
      const clip = rig.clips.get(c); if (!clip) continue;
      out.clips[c] = Object.fromEntries(['L', 'R'].map((s) => { const u = h.setsUsed(rig, clip, s); return [s, { appearances: u.map((r) => `${r.set || r.palmAttachment} ${r.from}-${r.to}`), minHoldFrames: Number.isFinite(h.minHoldSeconds(u)) ? Math.round(h.minHoldSeconds(u) * 30) : null }]; }));
    }
    const alpha = new Map();
    for (const im of Object.values(P.images)) { if (!art2d.store.has(im.path)) continue; const d = await io.decodeImage(art2d.store.bytes(im.path)); const A = new Uint8Array(d.width * d.height); for (let i = 0; i < A.length; i++) A[i] = d.data[i * 4 + 3]; alpha.set(im.id ?? im.path, { w: d.width, h: d.height, A }); }
    const alphaOf = (id) => alpha.get(id) || alpha.get(P.images[id]?.path);
    for (const s of ['L', 'R']) out.wrist[s] = h.wristContinuity(P, s, alphaOf);
    for (const sk of (P.skins || []).map((x) => x.id)) out.missing[sk] = h.missingHandArt(P, sk).map((m) => `${m.side} ${m.set}`);
    out.sets = Object.fromEntries(['L', 'R'].map((s) => [s, Object.entries(P.handViews?.[s]?.sets || {}).map(([n, v]) => `${n} (${v.view}/${v.pose})`)]));
    return out;
  });
  const holds = Object.values(hv.clips).flatMap((c) => Object.values(c).map((x) => x.minHoldFrames)).filter((x) => x !== null);
  check('hand-no-flicker', 'No hand appearance (set or keyed palm art) is shown for fewer than 4 frames in hero/regression clips', holds.every((x) => x >= 4), { minHoldFrames: Math.min(...holds, Infinity), clips: Object.fromEntries(Object.entries(hv.clips).map(([k, v]) => [k, { L: v.L.appearances.length, R: v.R.appearances.length }])) });
  const wr = [...hv.wrist.L, ...hv.wrist.R];
  check('hand-wrist-continuity', 'Every hand-set palm has art at the wrist joint (≤6 px), so set swaps never open a cuff gap', wr.length > 0 && wr.every((w) => w.ok), { sets: wr.length, worst: wr.reduce((m, w) => Math.max(m, w.wristGapPx ?? 99), 0), failing: wr.filter((w) => !w.ok).map((w) => `${w.set}:${w.wristGapPx}`) });
  fs.writeFileSync(`${OUT}/hand-views.json`, JSON.stringify(hv, null, 1));
  check('no-errors', 'No page errors in editor, fresh page or runtime', errors.length === 0, errors.slice(0, 5));
} finally {
  await browser.close(); server.close();
}
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(`${OUT}/checks.json`, JSON.stringify({ date: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 1));
fs.writeFileSync(`${OUT}/REPORT.md`, ['# Corrections, hand views, colour and determinism', '', `Generated by \`node scripts/check-2d-corrections.mjs\`. ${results.length - failed.length} passed, ${failed.length} failed. Hand appearances per clip: \`hand-views.json\`.`, '',
  '| | check | measured |', '|---|---|---|', ...results.map((r) => `| ${r.pass ? '✅' : '❌'} | ${r.title} | ${JSON.stringify(r.details).replace(/\|/g, '/').slice(0, 300)} |`), ''].join('\n'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
