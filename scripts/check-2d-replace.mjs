// Art-replacement edge cases (upgrade brief §2): same-size and 2x replacements, weighted meshes, deform-keyed
// meshes, mirrored/scaled props, repeated imports into one slot, failed replace/import. Undo/Redo is checked
// against the DISPLAYED pixels of the editor canvas, not only the JSON.   node scripts/check-2d-replace.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { startServer, CHROME, CHROME_ARGS } from './serve.mjs';

const server = await startServer(0);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [...CHROME_ARGS, '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/viewer/knight.html?art=2d`);
await page.waitForFunction(() => window.art2d?.editor?.ready, null, { timeout: 120000 });
await page.evaluate(() => art2d.editor.ready);

const res = await page.evaluate(async () => {
  const ed = art2d.editor, io = await import('./js/art2d/project-io.js'), { Rig } = await import('./js/art2d/core.js');
  const P = () => ed.project, out = {};
  // displayed pixels: fixed view, one evaluated frame, hash of the WebGL canvas
  const shot = async (clip = 'knight_salute', t = 1.8) => {
    ed.setMode('animate'); ed.selectClip(clip); ed.player.seek(t); ed.renderer.view = { x: 0, y: 560, zoom: 0.6 };
    await ed.syncTextures(); ed.frame(0);
    const c = document.createElement('canvas'); c.width = ed.glCanvas.width; c.height = ed.glCanvas.height;
    const g = c.getContext('2d'); g.drawImage(ed.glCanvas, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let h = 2166136261;
    for (let i = 0; i < d.length; i += 7) { h ^= d[i]; h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  const variant = async (imgId, { hue = 0, scale = 1, corrupt = false } = {}) => {
    if (corrupt) return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const d = await io.decodeImage(ed.store.bytes(P().images[imgId].path));
    const t = document.createElement('canvas'); t.width = d.width; t.height = d.height; t.getContext('2d').putImageData(d, 0, 0);
    const c = document.createElement('canvas'); c.width = Math.round(d.width * scale); c.height = Math.round(d.height * scale);
    const g = c.getContext('2d'); g.filter = `hue-rotate(${hue}deg) saturate(1.5)`; g.imageSmoothingQuality = 'high'; g.drawImage(t, 0, 0, c.width, c.height);
    return io.encodePNG(g.getImageData(0, 0, c.width, c.height));
  };
  const silhouetteIoU = (attId, before, after) => {     // deformed-vertex bounding geometry before/after (world px)
    const bb = (p) => { let a = [1e9, 1e9, -1e9, -1e9]; for (let i = 0; i < p.length; i += 2) a = [Math.min(a[0], p[i]), Math.min(a[1], p[i + 1]), Math.max(a[2], p[i]), Math.max(a[3], p[i + 1])]; return a; };
    const A = bb(before), B = bb(after), ix = Math.max(0, Math.min(A[2], B[2]) - Math.max(A[0], B[0])), iy = Math.max(0, Math.min(A[3], B[3]) - Math.max(A[1], B[1]));
    const area = (r) => (r[2] - r[0]) * (r[3] - r[1]); return ix * iy / (area(A) + area(B) - ix * iy);
  };
  const deformed = (attId, clip, t) => { const r = new Rig(P()); const pose = r.evaluate(clip, t); return Array.from(r.skinAttachment(attId, pose)); };

  // A. same-size replacement: pixels change, Undo restores the exact displayed pixels, Redo re-applies
  const h0 = await shot();
  ed.selectSlot('helmet', 'helmet.default');
  await ed.replaceSelected(await variant('helmet__default', { hue: 150 }));
  const h1 = await shot(); ed.undo(); const hu = await shot(); ed.redo(); const hr = await shot(); ed.undo();
  out.sameSize = { changed: h1 !== h0, undoPixels: hu === h0, redoPixels: hr === h1 };

  // rendered alpha of one slot alone in a posed frame (what the player actually sees)
  const slotAlpha = async (slot, clip, t) => {
    ed.isolate = new Set([slot]); await shot(clip, t); ed.isolate = null;
    const c = document.createElement('canvas'); c.width = ed.glCanvas.width; c.height = ed.glCanvas.height;
    const g = c.getContext('2d'); g.drawImage(ed.glCanvas, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data;
    const bg = [d[0], d[1], d[2]]; const m = new Uint8Array(d.length / 4);
    for (let i = 0; i < m.length; i++) m[i] = Math.abs(d[i * 4] - bg[0]) + Math.abs(d[i * 4 + 1] - bg[1]) + Math.abs(d[i * 4 + 2] - bg[2]) > 24 ? 1 : 0;
    return m;
  };
  const maskIoU = (A, B) => { let i = 0, u = 0; for (let k = 0; k < A.length; k++) { if (A[k] && B[k]) i++; if (A[k] || B[k]) u++; } return i / u; };
  // B. 2x weighted mesh: same rendered footprint in a bent pose, valid weights, Undo restores pixels
  const wBefore = await slotAlpha('under_arm_L', 'knight_salute', 1.8);
  ed.selectSlot('under_arm_L', 'under_arm_L.default');
  await ed.replaceSelected(await variant(P().attachments['under_arm_L.default'].image, { scale: 2 }));
  const a = P().attachments['under_arm_L.default'];
  const wOk = a.weights.length === a.vertices.length / 2 && a.weights.every((l) => { let s = 0; for (let j = 1; j < l.length; j += 2) s += l[j]; return l.length <= 8 && Math.abs(s - 1) < 1e-3; });
  out.weighted2x = { weightsValid: wOk, renderedIoU: +maskIoU(wBefore, await slotAlpha('under_arm_L', 'knight_salute', 1.8)).toFixed(4) };
  ed.undo(); out.weighted2x.undoPixels = (await shot()) === h0;

  // C. 2x mesh with deformation keys (cape flutter): keys follow the new topology
  const clipD = P().clips.find((c) => c.tracks.deform?.['mantle.default']);
  const tD = clipD ? clipD.tracks.deform['mantle.default'].t[Math.floor(clipD.tracks.deform['mantle.default'].t.length / 2)] : 0;
  const mBefore = clipD && await slotAlpha('mantle', clipD.name, tD);
  ed.selectSlot('mantle', 'mantle.default');
  await ed.replaceSelected(await variant(P().attachments['mantle.default'].image, { scale: 2 }));
  const m = P().attachments['mantle.default'], nv = m.vertices.length / 2;
  const keysOk = P().clips.every((c) => [c.tracks, c.corrections].every((L) => !L?.deform?.['mantle.default'] || L.deform['mantle.default'].v.every((v) => v == null || v.length === nv * 2)));
  const mAfter = clipD && await slotAlpha('mantle', clipD.name, tD), mVerts = clipD && deformed('mantle.default', clipD.name, tD);
  out.deform2x = { clip: clipD?.name, time: tD, keysMatchTopology: keysOk, finite: !mVerts || mVerts.every(Number.isFinite), renderedIoU: clipD ? +maskIoU(mBefore, mAfter).toFixed(4) : null };
  ed.undo(); out.deform2x.undoPixels = (await shot()) === h0;

  // D. mirrored + scaled prop, 2x replacement keeps world markers
  const staff = () => P().attachments['prop_R.Staff'];
  ed.record('mirror+scale staff', [[() => P().attachments, 'prop_R.Staff']], () => { Object.assign(staff().transform, { mirror: true, scaleX: 1.3, scaleY: 0.8, rotation: staff().transform.rotation + 12 }); });
  ed.rebuild();
  const markerWorld = () => { const r = new Rig(P()); r.evaluate('staff_idle', 0.5); return Object.keys(staff().markers).map((k) => r.markerWorld('prop_R.Staff', k)); };
  const mw0 = markerWorld();
  ed.selectSlot('prop_R', 'prop_R.Staff');
  await ed.replaceSelected(await variant(staff().image, { scale: 2, hue: 40 }));
  const mw1 = markerWorld();
  out.mirroredProp = { maxMarkerDriftPx: +Math.max(...mw0.map((p, i) => Math.hypot(p[0] - mw1[i][0], p[1] - mw1[i][1]))).toExponential(2), mirrorKept: staff().transform.mirror === true };
  ed.undo(); ed.undo(); out.mirroredProp.undoPixels = (await shot()) === h0;

  // E. repeated imports into one slot with the same layer name: Undo of the second restores the first's pixels
  const lay = async (hue) => { const r = new Rig(P()), at = P().attachments['forearm_L.default'], rec = r.attachments.get('forearm_L.default'), s = at.imageScale;
    const { affApply } = await import('./js/art2d/core.js'); const tl = affApply(rec.place, -at.pivot[0] * s, at.pivot[1] * s);
    const files = new Map([['forearm_L.png', await variant(at.image, { hue })], ['layers.json', new TextEncoder().encode(JSON.stringify({ canvas: { w: 4000, h: 4000 }, origin: [2000, 3000], scale: s, layers: [{ file: 'forearm_L.png', x: 2000 + tl[0] / s, y: 3000 - tl[1] / s, name: 'painted' }] }))]]);
    return ed.importLayered(files); };
  await lay(90); const hFirst = await shot();
  await lay(220); const hSecond = await shot();
  ed.undo(); const hBack = await shot();
  out.repeatedImport = { secondChanged: hSecond !== hFirst, undoRestoresFirstPixels: hBack === hFirst, revisions: Object.keys(P().images).filter((k) => k.startsWith('forearm_L__painted')).length };
  ed.undo(); out.repeatedImport.undoAll = (await shot()) === h0;

  // F/G. failed replace and failed import leave the project unchanged and usable
  const hist = ed.undoStack.length, json = JSON.stringify(P());
  ed.selectSlot('helmet', 'helmet.default');
  let threw = false; try { await ed.replaceSelected(await variant(null, { corrupt: true })); } catch { threw = true; }
  const bad = new Map([['layers.json', new TextEncoder().encode(JSON.stringify({ canvas: { w: 100, h: 100 }, origin: [50, 100], layers: [{ file: 'helmet.png', x: 0, y: 0, name: 'x' }, { file: 'shin_L.png', x: 0, y: 0, name: 'x' }] }))],
    ['helmet.png', await variant('helmet__default', { hue: 10 })], ['shin_L.png', await variant(null, { corrupt: true })]]);
  let threw2 = false; try { await ed.importLayered(bad); } catch { threw2 = true; }
  const unchanged = JSON.stringify(P()) === json && ed.undoStack.length === hist && !ed.pending;
  ed.selectClip('idle'); ed.player.seek(1); art2d.keyBone('head', 'rotate', { v: 5 }); const usable = ed.undoStack.length === hist + 1; ed.undo();
  out.failures = { replaceThrew: threw, importThrew: threw2, projectUnchanged: unchanged, stillUsable: usable, pixels: (await shot()) === h0 };
  const v = art2d.validate(); out.valid = v.errors.length === 0;
  return out;
});
const pass = (o) => Object.values(o).every((x) => (typeof x === 'object' && x !== null ? pass(x) : x !== false));
const checks = {
  sameSize: res.sameSize.changed && res.sameSize.undoPixels && res.sameSize.redoPixels,
  weighted2x: res.weighted2x.weightsValid && res.weighted2x.renderedIoU > 0.97 && res.weighted2x.undoPixels,
  deform2x: res.deform2x.keysMatchTopology && res.deform2x.finite && (res.deform2x.renderedIoU ?? 1) > 0.97 && res.deform2x.undoPixels,
  mirroredProp: +res.mirroredProp.maxMarkerDriftPx < 1e-3 && res.mirroredProp.mirrorKept && res.mirroredProp.undoPixels,
  repeatedImport: res.repeatedImport.secondChanged && res.repeatedImport.undoRestoresFirstPixels && res.repeatedImport.undoAll,
  failures: pass(res.failures), valid: res.valid, noPageErrors: errors.length === 0,
};
fs.mkdirSync('validation/workflow', { recursive: true });
fs.writeFileSync('validation/workflow/replace-checks.json', JSON.stringify({ checks, details: res, errors }, null, 2));
for (const [k, v] of Object.entries(checks)) console.log(`${v ? 'PASS' : 'FAIL'} ${k} ${JSON.stringify(res[k] ?? '')}`);
await browser.close(); server.close();
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
