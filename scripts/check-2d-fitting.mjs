// Fitting workflow regression (upgrade brief §3 and completion check D):
//   paint-template pack → painted layers (real painted helmet + labelled stand-ins) → fitting session →
//   accept (one undo) → save → fresh reopen; name suggestions (ok / ambiguous / unmapped); a deliberately
//   misaligned piece corrected with joint anchors + snap; bend preview; 2x-resolution layer keeps its
//   footprint; proportion fit on the dwarf moves the rig joint, not the art scale.
//   node scripts/check-2d-fitting.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { startServer, CHROME, CHROME_ARGS } from './serve.mjs';

const OUT = 'validation/fitting';
fs.mkdirSync(OUT, { recursive: true });
const server = await startServer(0);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [...CHROME_ARGS, '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const base = `http://127.0.0.1:${server.address().port}`;
await page.goto(`${base}/viewer/knight.html?art=2d`);
await page.waitForFunction(() => window.art2d?.editor?.ready, null, { timeout: 120000 });
await page.evaluate(() => art2d.editor.ready);
const helmetPNG = fs.readFileSync('validation/workflow/art/painted-helmet.png').toString('base64');

const res = await page.evaluate(async (helmetB64) => {
  const ed = art2d.editor, io = await import('./js/art2d/project-io.js'), core = await import('./js/art2d/core.js'), zip = await import('./js/art2d/zip.js');
  const out = {}, P = () => ed.project, u8 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const restyle = async (bytes, { hue = 0, scale = 1, dx = 0 } = {}) => {     // labelled stand-in "paint": hue shift (+ resample)
    const d = await io.decodeImage(bytes), t = document.createElement('canvas'); t.width = d.width; t.height = d.height; t.getContext('2d').putImageData(d, 0, 0);
    const c = document.createElement('canvas'); c.width = Math.round(d.width * scale); c.height = Math.round(d.height * scale);
    const g = c.getContext('2d'); g.filter = `hue-rotate(${hue}deg) saturate(1.4) brightness(1.05)`; g.drawImage(t, dx, 0, c.width, c.height);
    return io.encodePNG(g.getImageData(0, 0, c.width, c.height));
  };
  // rendered alpha of one slot alone (what the player sees)
  const slotMask = async (rig, slot, clip = null, t = 0, opts = {}) => {
    const ex = await import('./js/art2d/exporters.js'); const r = ed._probe ||= await ex.offscreenRenderer(P(), ed.store);
    for (const [id, im] of Object.entries(rig.project.images)) if (!r.textures.has(id) && ed.store.has(im.path)) { const img = new Image(); img.src = ed.store.url(im.path); await img.decode(); r.setTexture(id, img); }
    const pose = rig.evaluate(clip, t, opts), img = ex.renderPose(r, rig, pose, [-500, -50, 500, 1250], 0.5, { only: new Set([slot]) });
    const m = new Uint8Array(img.width * img.height); for (let i = 0; i < m.length; i++) m[i] = img.data[i * 4 + 3] > 40 ? 1 : 0; return m;
  };
  const iou = (A, B) => { let i = 0, un = 0; for (let k = 0; k < A.length; k++) { if (A[k] && B[k]) i++; if (A[k] || B[k]) un++; } return un ? i / un : 1; };

  // 1) paint-template pack → painted layers → fit → accept
  const pack = await art2d.paintPack('painted');
  const layersJson = JSON.parse(zip.textOf(pack.files.find((f) => f.path === 'layers.json').data));
  const chosen = ['helmet.default', 'cuirass.default', 'upperarm_L.default', 'forearm_L.default', 'hand_R.default', 'under_arm_R.default', 'mantle.default', 'prop_R.Sword2H'];
  const files = new Map(), painted = [];
  for (const L of layersJson.layers.filter((l) => chosen.includes(l.target))) {
    const a = P().attachments[L.target];
    const bytes = L.target === 'helmet.default' ? u8(helmetB64) : await restyle(ed.store.bytes(P().images[a.image].path), { hue: 35 });
    files.set(L.file, bytes); painted.push(L.target);
  }
  files.set('layers.json', new TextEncoder().encode(JSON.stringify({ ...layersJson, layers: layersJson.layers.filter((l) => chosen.includes(l.target)) })));
  const before = {}, rig0 = new core.Rig(P());
  for (const t of chosen) before[t] = await slotMask(rig0, P().attachments[t].slot, t === 'prop_R.Sword2H' ? 'hover_sword_vigil' : null, 0);
  const sess = await art2d.startFit(files, { skin: 'painted' });
  out.pack = { pieces: pack.manifest.counts.pieces, missingBefore: pack.manifest.counts.missing, layers: sess.layers.length, allMapped: sess.layers.every((l) => l.mapping.status === 'ok' && l.target) };
  const histBefore = art2d.history().length, jsonBefore = JSON.stringify(P().attachments);
  await art2d.acceptFit();
  const rig1 = new core.Rig(P()); rig1.setSkin('painted');
  // stand-ins are the same art restyled: silhouettes must match exactly; the real painted helmet is new art,
  // so it is compared by the bounding box of its painted alpha (same placement and size)
  const bbox = (m) => { const W = 500; let b = [1e9, 1e9, -1, -1]; for (let k = 0; k < m.length; k++) if (m[k]) { const x = k % W, y = (k / W) | 0; b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]; } return b; };
  const boxIoU = (A, B) => { const ix = Math.max(0, Math.min(A[2], B[2]) - Math.max(A[0], B[0])), iy = Math.max(0, Math.min(A[3], B[3]) - Math.max(A[1], B[1])), ar = (r) => (r[2] - r[0]) * (r[3] - r[1]); return ix * iy / (ar(A) + ar(B) - ix * iy); };
  out.footprint = {};
  for (const t of chosen) { const m = await slotMask(rig1, P().attachments[t].slot, t === 'prop_R.Sword2H' ? 'hover_sword_vigil' : null, 0); out.footprint[t] = t === 'helmet.default' ? { bboxIoU: +boxIoU(bbox(before[t]), bbox(m)).toFixed(4), silhouetteIoU: +iou(before[t], m).toFixed(4) } : +iou(before[t], m).toFixed(4); }
  const sk = P().skins.find((s) => s.id === 'painted');
  out.accept = { oneUndoStep: art2d.history().length === histBefore + 1, skinPieces: Object.keys(sk.replace).length, starterKept: !!P().attachments['helmet.default'] && JSON.parse(jsonBefore)['helmet.default'].image === P().attachments['helmet.default'].image,
    statusFinished: Object.values(sk.status).filter((v) => v === 'finished').length, templateSaved: !!P().fitting?.templates?.[P().fitting.last] };
  // sword markers follow the painted prop (support constraint still engages)
  rig1.evaluate('sword_2h_idle', 0.5); const mk0 = rig0.evaluate('sword_2h_idle', 0.5) && rig0.markerWorld('prop_R.Sword2H', 'support'), mk1 = rig1.markerWorld('prop_R.Sword2H@painted', 'support');
  out.markers = { driftPx: +Math.hypot(mk0[0] - mk1[0], mk0[1] - mk1[1]).toFixed(4), contacts: rig1.evaluate('sword_2h_idle', 0.5).contacts.filter((c) => c.mix > 0).map((c) => +c.error.toFixed(3)) };
  // Undo removes the whole fit in one step (pixels: the starter skin renders again), Redo restores it
  ed.undo(); out.undo = { skinGone: !P().skins.some((s) => s.id === 'painted'), attachmentsRestored: JSON.stringify(P().attachments) === jsonBefore };
  ed.redo(); out.undo.redoBack = !!P().skins.find((s) => s.id === 'painted')?.replace?.['helmet.default'];
  art2d.setSkin('painted');

  // 2) name suggestions + misaligned piece corrected with joint anchors; a 2x-resolution layer; bend preview
  const fa = P().attachments['forearm_R.default'], fb = await restyle(ed.store.bytes(P().images[fa.image].path), { hue: 200 });
  const sh = P().attachments['shin_L.default'], shb = await restyle(ed.store.bytes(P().images[sh.image].path), { hue: 120, scale: 2 });
  const files2 = new Map([['Right Forearm.png', fb], ['greave_left.png', shb], ['shin.png', fb], ['tail.png', fb]]);
  const s2 = await art2d.startFit(files2, { skin: 'painted' });
  out.suggestions = Object.fromEntries(s2.layers.map((l) => [l.file, `${l.mapping.status}${l.mapping.suggested ? '(' + l.mapping.suggested + ')' : ''}:${l.target || '-'}`]));
  const iF = s2.layers.findIndex((l) => l.file === 'Right Forearm.png'), fitF = { ...s2.layers[iF].fit };
  // misalign: +28 px, +9 degrees, then anchor the painted elbow/wrist and snap back
  art2d.fitSelect(iF); art2d.fitUpdate((l) => { l.fit = { ...l.fit, x: l.fit.x + 28, rotation: l.fit.rotation + 9 }; l.anchors = { A: l.anchors.A, B: l.anchors.B }; });
  const misX = s2.layers[iF].fit.x - fitF.x;
  // the art anchors are the painted joints: they were placed on the art before the misalignment
  await art2d.snapLayer(iF);
  const lf = s2.layers[iF].fit;
  out.misaligned = { introducedPx: +misX.toFixed(2), afterSnapPx: +Math.hypot(lf.x - fitF.x, lf.y - fitF.y).toFixed(3), afterSnapDeg: +Math.abs(lf.rotation - fitF.rotation).toFixed(3) };
  for (const l of s2.layers) if (l.file !== 'Right Forearm.png' && l.file !== 'greave_left.png') l.include = false;
  await art2d.refreshFit();
  const pv = new core.Rig(ed.fit.preview); pv.setSkin('painted');
  out.resolution2x = { footprintIoU: +iou(await slotMask(rig0, 'shin_L'), await slotMask(pv, 'shin_L')).toFixed(4) };
  const bend = { override: { forearm_R: { rotate: 90 } } };
  out.bendPreview = { forearmMoves: iou(await slotMask(pv, 'forearm_R'), await slotMask(pv, 'forearm_R', null, 0, bend)) < 0.6 };
  ed.mode = 'setup'; ed.preview.pose = bend.override; ed.frame(0);
  const shotBend = ed.glCanvas.toDataURL('image/png'); ed.preview.pose = null;
  await art2d.acceptFit();
  out.coverage = (await art2d.coverage('painted')).map((c) => ({ joint: c.joint, gapPct: c.gapPct, flagged: c.flagged }));

  // 3) save → reopen in a FRESH project object from the ZIP bytes alone
  const z = io.saveProjectZip(P(), ed.store), re = await io.loadProjectZip(z), rr = new core.Rig(re.project); rr.setSkin('painted');
  out.reopen = { errors: re.report.errors, skins: re.project.skins.map((s) => s.id), painted: Object.keys(re.project.skins.find((s) => s.id === 'painted').replace).length,
    template: !!re.project.fitting?.templates?.[re.project.fitting.last], helmetIsPainted: rr.evaluate(null, 0).slotAttachment[rr.slotIndex.get('helmet')] === 'helmet.default@painted' };
  // the saved template re-fits re-painted PNGs WITHOUT layers.json
  const tplFiles = new Map([[ 'helmet.default.png', u8(helmetB64) ]]);
  const s3 = await art2d.startFit(tplFiles, { useTemplate: true, skin: 'painted' });
  const tplH = P().fitting.templates.painted.layers.find((l) => l.file === 'helmet.default.png');
  out.template = { layersInTemplate: P().fitting.templates.painted.layers.length, mapped: s3.layers.map((l) => `${l.file}→${l.target}`), sameFit: s3.layers.length === 1 && JSON.stringify(s3.layers[0].fit) === JSON.stringify(tplH.fit) };
  art2d.cancelFit();
  return { out, shotBend, zipB64: btoa(Array.from(z, (c) => String.fromCharCode(c)).join('')) };
}, helmetPNG);
fs.writeFileSync(`${OUT}/bend-preview.png`, Buffer.from(res.shotBend.split(',')[1], 'base64'));
fs.writeFileSync(`${OUT}/painted-knight-fitted.character2d.zip`, Buffer.from(res.zipB64, 'base64'));
await page.evaluate(() => { art2d.setSkin('painted'); art2d.selectClip('hover_sword_vigil'); art2d.seek(1.5); art2d.editor.fitView(true); });
await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/fitted-hover.png`, clip: { x: 310, y: 0, width: 1130, height: 950 } });

// 3b) joint coverage measures cracks BETWEEN pieces (not silhouette change): the starter knight opens none at the
// test bends; the same knight without its underlap layers must be flagged (positive control)
await page.evaluate(() => art2d.openURL('../characters2d/aureate_knight/character.json')); await page.evaluate(() => art2d.editor.ready);
const joints = await page.evaluate(async () => {
  const pp = await import('./js/art2d/paintpack.js'), { computeInverseBinds } = await import('./js/art2d/schema.js');
  const starter = await pp.jointCoverage(art2d.project, art2d.store, { skin: 'default' });
  const P = structuredClone(art2d.project); for (const sl of P.slots) if (/^under_/.test(sl.id)) sl.attachment = null; computeInverseBinds(P);
  const noUnder = await pp.jointCoverage(P, art2d.store, { skin: 'default' });
  return { starter: starter.map((c) => ({ joint: c.joint, gapPct: c.gapPct, fullCharacterGapPct: c.fullCharacterGapPct, silhouetteLossPct: c.silhouetteLossPct, flagged: c.flagged })),
    withoutUnderlap: noUnder.filter((c) => c.flagged).map((c) => `${c.joint} ${c.gapPct}%`) };
});
fs.writeFileSync(`${OUT}/joint-coverage.json`, JSON.stringify(joints, null, 1));

// 4) dwarf: proportion fit moves the rig's next joint to the art anchor instead of resizing the art
await page.evaluate(() => art2d.openURL('../characters2d/dwarf/character.json'));
await page.evaluate(() => art2d.editor.ready);
const dwarf = await page.evaluate(async () => {
  const ed = art2d.editor, io = await import('./js/art2d/project-io.js'), core = await import('./js/art2d/core.js'), P = ed.project;
  const a = P.attachments['under_arm_L.default'], bytes = ed.store.bytes(P.images[a.image].path);
  const s = await art2d.startFit(new Map([['under_arm_L.png', bytes]]), { skin: 'painted' });
  const L = s.layers[0]; L.mode = 'proportion';
  const r0 = new core.Rig(P), elbow0 = r0.bindWorld[r0.boneIndex.get('forearm_L')].slice(4);
  // the painted arm is longer: move the art's elbow anchor 30 px further along the arm
  const dir = [L.anchors.B[0] - L.anchors.A[0], L.anchors.B[1] - L.anchors.A[1]], len = Math.hypot(...dir);
  L.anchors.B = [L.anchors.B[0] + dir[0] / len * 30 / L.fit.scale, L.anchors.B[1] + dir[1] / len * 30 / L.fit.scale];
  await art2d.acceptFit();
  const r1 = new core.Rig(ed.project), elbow1 = r1.bindWorld[r1.boneIndex.get('forearm_L')].slice(4), rs = ed.project.attachments['under_arm_L.default@painted'].imageScale;
  return { scaleKept: Math.abs(rs - a.imageScale) < 1e-9, elbowMovedPx: +Math.hypot(elbow1[0] - elbow0[0], elbow1[1] - elbow0[1]).toFixed(2), valid: art2d.validate().errors.length === 0 };
});
const o = res.out;
const checks = {
  jointCracksStarter: joints.starter.length >= 10 && joints.starter.every((c) => !c.flagged && c.fullCharacterGapPct <= 3),
  jointCracksDetected: joints.withoutUnderlap.length >= 1,
  packRoundTrip: o.pack.allMapped && o.pack.layers === 8,
  footprintsPreserved: Object.entries(o.footprint).every(([k, x]) => (k === 'helmet.default' ? x.bboxIoU > 0.95 : x > 0.98)),
  acceptIsOneUndo: o.accept.oneUndoStep && o.undo.skinGone && o.undo.attachmentsRestored && o.undo.redoBack,
  starterSkinKept: o.accept.starterKept && o.accept.templateSaved,
  markersFollowPaintedProp: o.markers.driftPx < 0.5 && o.markers.contacts.every((e) => e < 2),
  suggestions: /^ok:forearm_R/.test(o.suggestions['Right Forearm.png']) && /^ok:shin_L/.test(o.suggestions['greave_left.png']) && /^(ambiguous|duplicate)/.test(o.suggestions['shin.png']) && /^unresolved/.test(o.suggestions['tail.png']),
  misalignmentCorrected: o.misaligned.introducedPx > 20 && o.misaligned.afterSnapPx < 1 && o.misaligned.afterSnapDeg < 0.5,
  resolution2xKeepsFootprint: o.resolution2x.footprintIoU > 0.95,
  bendPreview: o.bendPreview.forearmMoves,
  saveReopenFresh: !o.reopen.errors.length && o.reopen.helmetIsPainted && o.reopen.template && o.reopen.skins.includes('default'),
  templateRefitWithoutLayersJson: o.template.sameFit && o.template.layersInTemplate === 10,
  dwarfProportionFit: dwarf.scaleKept && dwarf.elbowMovedPx > 20 && dwarf.valid,
  noPageErrors: errors.length === 0,
};
fs.writeFileSync(`${OUT}/checks.json`, JSON.stringify({ checks, details: o, dwarf, errors }, null, 2));
for (const [k, v] of Object.entries(checks)) console.log(`${v ? 'PASS' : 'FAIL'} ${k}`);
console.log(JSON.stringify({ errors: errors.slice(0, 5), resolution2x: o.resolution2x, bend: o.bendPreview, footprint: o.footprint, suggestions: o.suggestions, misaligned: o.misaligned, coverage: o.coverage.filter((c) => c.flagged), dwarf }, null, 0).slice(0, 1500));
await browser.close(); server.close();
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
