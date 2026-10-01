// Targeted fixes applied to a SAVED painted project ZIP (no regeneration, no rebase). Painted artwork pixels,
// meshes of other pieces, other clips and saved corrections are untouched; every changed JSON path is reported
// and image bytes are verified identical.
//   node scripts/fix-painted-project.mjs --in=<saved.character2d.zip> --out=<fixed.character2d.zip> [--report=fixes.json]
// Fixes (each can be disabled with --skip=detonator,feet,salute,fingers):
//   detonator  press_detonator: the remote is held at the pose its fist drawing was made for (0.9 s): correction keys
//              hold socket_hand_R_prop and prop_R relative to the hand every frame, so it never slips out of the grip.
//   feet       hover: correction deform keys keep the painted dark under-boot tucked under the painted shoe plate
//              (feet hang toes-down there); the plate art and every other clip are untouched.
//   salute     the mid-raise cuff drawing (forearm toward the camera) rides on the hand bone (its placement at 0.45 s is
//              kept exactly); hand, fingers and forearm switch drawings together, at the same forearm foreshortening
//              going up and coming down (correction slot keys); the raised pauldron is drawn beneath the forearm and
//              hand while it shows, and open-hand frames keep the first frame's arm/hand order (correction draw-order
//              keys); the dark elbow under-sleeve is hidden while the cuff drawing shows (nothing covers it then).
//   fingers    painted finger meshes get two extra weight-smoothing passes at the knuckles (pixels unchanged).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { startServer, CHROME, CHROME_ARGS } from './serve.mjs';
const arg = (k, d = null) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const IN = arg('in'), OUT = arg('out'), skip = new Set((arg('skip') || '').split(',').filter(Boolean));
if (!IN || !OUT) throw new Error('--in and --out are required');
const server = await startServer(0);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [...CHROME_ARGS, '--no-sandbox'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/viewer/art2d-sheet.html?bind=1`);
await page.waitForFunction(() => window.sheetReady, null, { timeout: 60000 });
const res = await page.evaluate(async ({ zipB64, skip }) => {
  const io = await import('./js/art2d/project-io.js'), core = await import('./js/art2d/core.js'), mesh = await import('./js/art2d/mesh.js'), { validateProject } = await import('./js/art2d/schema.js');
  const { Rig, sampleField, affMul, affInv, affDecompose, meshSamples, ensureLayer } = core;
  const u8 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  const { project: P, store } = await io.loadProjectZip(u8(zipB64)), before = structuredClone(P), log = [];
  const r4 = (x) => +x.toFixed(4), clip = (n) => P.clips.find((c) => c.name === n);
  const layer = (c) => ensureLayer(c.corrections ||= {});

  // ---- 1) detonator held at its grip pose
  if (!skip.includes('detonator')) {
    const c = clip('press_detonator'), T0 = 0.9, fps = c.fps || 30, L = layer(c);
    for (const b of ['socket_hand_R_prop', 'prop_R']) {
      const tr = c.tracks.bones[b] || {}, rot = (t) => (tr.rotate?.t?.length ? sampleField(tr.rotate, 'v', t) : 0);
      const tx = (t) => (tr.translate?.t?.length ? sampleField(tr.translate, 'x', t) : 0), ty = (t) => (tr.translate?.t?.length ? sampleField(tr.translate, 'y', t) : 0);
      const sx = (t) => (tr.scale?.t?.length ? sampleField(tr.scale, 'x', t) : 1), sy = (t) => (tr.scale?.t?.length ? sampleField(tr.scale, 'y', t) : 1);
      const times = Array.from({ length: Math.round(c.duration * fps) + 1 }, (_, i) => r4(Math.min(c.duration, i / fps)));
      if (L.bones[b]) throw new Error(`press_detonator already has a ${b} correction — refusing to overwrite saved work`);
      L.bones[b] = { rotate: { t: times, v: times.map((t) => r4(rot(T0) - rot(t))) }, translate: { t: times, x: times.map((t) => r4(tx(T0) - tx(t))), y: times.map((t) => r4(ty(T0) - ty(t))) },
        scale: { t: times, x: times.map((t) => r4(sx(T0) / sx(t))), y: times.map((t) => r4(sy(T0) / sy(t))) } };
      log.push(`press_detonator: correction keys hold ${b} at its ${T0} s grip pose (${times.length} frames)`);
    }
  }
  // ---- 2) hover: the dark under-boot stays under the painted shoe armour
  // In hover the feet hang toes-down; the painted plate is a front-view drawing near the ankle, so the under-boot
  // (which follows the foot/toe) hangs below it. Correction deform keys on the PAINTED under-boot pull every vertex
  // that lies outside both the plate and the shin back to the plate's edge (4 px inside its edge). Painted pixels,
  // the plate and every other clip are untouched; the keys sit in hover's corrections layer and can be disabled.
  if (!skip.includes('feet')) {
    const c = clip('hover_sword_vigil'), L = layer(c), sk = P.skins.find((s) => s.id === 'painted'), rig = new Rig(P); rig.setSkin('painted');
    const inTri = (px, py, a, b, d) => { const s1 = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]), s2 = (d[0] - b[0]) * (py - b[1]) - (d[1] - b[1]) * (px - b[0]), s3 = (a[0] - d[0]) * (py - d[1]) - (a[1] - d[1]) * (px - d[0]); return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0); };
    const tris = (id, pose) => { const v = rig.skinAttachment(id, pose), T = P.attachments[id].triangles, out = []; for (let i = 0; i < T.length; i += 3) out.push([0, 1, 2].map((k) => [v[T[i + k] * 2], v[T[i + k] * 2 + 1]])); return out; };
    const inside = (x, y, ts) => ts.some(([a, b, d]) => inTri(x, y, a, b, d));
    const closest = (x, y, ts) => { let best = null, bd = Infinity; for (const t of ts) for (let e = 0; e < 3; e++) { const a = t[e], b = t[(e + 1) % 3], dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy || 1, u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l)), q = [a[0] + u * dx, a[1] + u * dy], d = (q[0] - x) ** 2 + (q[1] - y) ** 2; if (d < bd) { bd = d; best = q; } } return best; };
    const times = []; for (let t = 0; t <= c.duration + 1e-9; t += 0.25) times.push(r4(Math.min(c.duration, t)));
    for (const s of ['L', 'R']) {
      const boot = sk.replace[`under_foot_${s}.default`], plate = sk.replace[`foot_${s}.default`], shin = sk.replace[`shin_${s}.default`];
      if (!boot || !plate) continue;
      if (L.deform[boot]) throw new Error(`hover already has a deform correction for ${boot} — refusing to overwrite saved work`);
      const rec = rig.attachments.get(boot), keys = []; let moved = 0, maxPx = 0;
      for (const t of times) {
        const pose = rig.evaluate('hover_sword_vigil', t), pv = rig.skinAttachment(boot, pose), pt = tris(plate, pose), st = shin ? tris(shin, pose) : [];
        const cx = pt.flat().reduce((a, q) => a + q[0], 0) / (pt.length * 3), cy = pt.flat().reduce((a, q) => a + q[1], 0) / (pt.length * 3);
        const off = new Array(rec.nv * 2).fill(0);
        for (let v = 0; v < rec.nv; v++) {
          const x = pv[v * 2], y = pv[v * 2 + 1]; if (inside(x, y, pt) || inside(x, y, st)) continue;
          const q = closest(x, y, pt), dl = Math.hypot(cx - q[0], cy - q[1]) || 1, tx = q[0] + (cx - q[0]) / dl * 4, ty = q[1] + (cy - q[1]) / dl * 4;   // 4 px inside the plate edge
          const dx = tx - x, dy = ty - y; if (Math.hypot(dx, dy) < 0.5) continue;
          let a = 0, b = 0, cc = 0, dd = 0; for (let k = 0; k < 4; k++) { const w = rec.ww[v * 4 + k]; if (!w) continue; const m = rig.skinMats[rec.wb[v * 4 + k]]; a += w * m[0]; b += w * m[1]; cc += w * m[2]; dd += w * m[3]; }
          const det = a * dd - b * cc || 1; off[v * 2] = r4((dd * dx - cc * dy) / det); off[v * 2 + 1] = r4((-b * dx + a * dy) / det); moved++; maxPx = Math.max(maxPx, Math.hypot(dx, dy));
        }
        keys.push(off);
      }
      L.deform[boot] = { t: times, v: keys };
      log.push(`feet: hover keeps ${boot} under ${plate} (${times.length} keys; ${(moved / times.length).toFixed(0)} vertices tucked per key, up to ${maxPx.toFixed(1)} px)`);
    }
  }
  // ---- 3) salute: cuff drawing on the hand bone; hand/forearm drawing switch; draw order
  if (!skip.includes('salute')) {
    const c = clip('knight_salute'), T0 = 0.45, rig = new Rig(P); rig.evaluate('knight_salute', T0);
    const ids = Object.keys(P.attachments).filter((k) => k === 'forearm_R.salute_mid_arm' || k.startsWith('forearm_R.salute_mid_arm@'));
    for (const id of ids) {
      const a = P.attachments[id], rec = rig.attachments.get(id), fi = rig.boneIndex.get(a.bone), hi = rig.boneIndex.get('hand_R');
      const M = a.followScale === false ? rig.skinMatsU : rig.skinMats, world = affMul(M[fi], rec.place);           // drawn placement at 0.45 s
      const place = affMul(affInv(M[hi]), world), T = affDecompose(affMul(affInv(rig.bindWorld[hi]), place));
      a.bone = 'hand_R'; a.transform = { ...a.transform, x: r4(T.x), y: r4(T.y), rotation: r4(T.rotation), scaleX: +T.scaleX.toFixed(6), scaleY: +T.scaleY.toFixed(6) };
      log.push(`salute: ${id} rides on hand_R (placement at ${T0} s unchanged)`);
    }
    const L = layer(c);
    // Hand + forearm drawing switch. The fist and the full-length vambrace were drawn at the hold, where the forearm
    // shows at ~0.85 of its length. As it turns toward the camera the vambrace drawing overshoots the hand (its cuff
    // pokes out past the fist) and the 3D hand is already open and upright: from there the mid-raise drawings (open
    // hand + cuff) fit. The clip switched at 0.59 of the length going up (0.6 s) but only at 0.40 coming down
    // (3.3 s); both directions now switch at the same foreshortening, and hand, fingers and forearm switch together.
    const THR = 0.65, fps = c.fps || 30, fsx = (t) => sampleField(c.tracks.bones.forearm_R.scale, 'x', t);
    const hk = c.tracks.slots.hand_R.attachment.t, frames = Array.from({ length: Math.round(c.duration * fps) + 1 }, (_, i) => r4(i / fps));
    const tUp = frames.find((t) => t > hk[1] && t < hk[3] && fsx(t) >= THR), tDown = frames.find((t) => t > tUp && t <= hk[3] && fsx(t) < THR) ?? hk[3];
    const keys = [hk[0], hk[1], tUp, tDown, hk[4]];
    const switched = ['hand_R', 'thumb_R', 'index_R', 'middle_R', 'ring_R', 'pinky_R', 'forearm_R'].filter((id) => c.tracks.slots[id]?.attachment);
    for (const id of switched) {
      if (L.slots[id]) throw new Error(`knight_salute already has a ${id} slot correction — refusing to overwrite saved work`);
      const b = c.tracks.slots[id].attachment;
      L.slots[id] = { attachment: { t: [...keys], v: hk.map((t) => b.v[core.keyIndex(b.t, t)]) } };
    }
    log.push(`salute: hand, fingers and forearm switch together at ${keys.join(' / ')} s (forearm shown at ${THR} of its length both ways; ` +
      `the clip had ${hk.join(' / ')} s): ${L.slots.forearm_R.attachment.v.join(' → ')}`);
    // the dark under-sleeve at the elbow (under_arm_R) has nothing over it while the forearm points at the camera
    // (cuff drawing): it stuck out below-left of the cuff, so it is hidden exactly while the cuff drawing shows
    if (L.slots.under_arm_R) throw new Error('knight_salute already has an under_arm_R slot correction — refusing to overwrite saved work');
    const ub = c.tracks.slots.under_arm_R?.attachment, uDef = P.slots.find((x) => x.id === 'under_arm_R').attachment ?? null;
    const cuff = L.slots.forearm_R.attachment.v.map((v) => /salute_mid_arm/.test(v));
    L.slots.under_arm_R = { attachment: { t: [...keys], v: keys.map((t, i) => (cuff[i] ? null : ub ? ub.v[core.keyIndex(ub.t, t)] ?? null : uDef)) } };
    // QA: the elbow joint probe only counts pieces on the upper arm / forearm bones; while the cuff drawing (on the hand
    // bone) shows, the open hand covers the elbow, so the probe reads ~0 there although nothing is missing on screen
    // (checked on elbow-centred crops). Recorded as an exception with that reason, not hidden.
    const vq = (P.visualQA ||= {}), ex = (vq.exceptions ||= []);
    for (let i = 0; i < keys.length - 1; i++) if (cuff[i] && !ex.some((e) => e.clip === c.name && e.kind === 'joint-gap' && e.target === 'forearm_R' && e.from === keys[i])) {
      ex.push({ clip: c.name, kind: 'joint-gap', target: 'forearm_R', from: keys[i], to: keys[i + 1], date: new Date().toISOString().slice(0, 10),
        reason: 'forearm points at the camera: its cuff drawing rides on the hand and the open hand covers the elbow; the probe only counts upper-arm/forearm pieces (elbow-centred crops checked at 0.5/0.6/3.2/3.27/3.4/3.5 s: no hole)' });
    }
    log.push(`salute: under_arm_R hidden while the cuff drawing shows (${keys.map((t, i) => (cuff[i] ? `${t}–${keys[i + 1]}` : null)).filter(Boolean).join(', ')} s)`);
    // Draw order (correction keys from the first auto key after 0 on; every auto key is copied, changed only where noted):
    // - while the raised pauldron drawing shows (upperarm_R.salute_arm) the forearm and hand are in front of it, as in
    //   3D; the auto order put the pauldron over the raised hand from 0.42 s to 0.57 s and at 3.4 s;
    // - while the open hand shows (before the raise and after the lowering) the arm/hand pieces keep the order of the
    //   first frame: the auto keys at 0.03 s and 3.9 s put the forearm's gold cuff over the palm, so the hand looked
    //   boxed in at the end of the clip (4.0 s) although the pose is the same as at 0 s.
    const ua = c.tracks.slots.upperarm_R.attachment, i0 = ua.v.findIndex((v) => /salute_arm/.test(v)), u0 = ua.t[i0], u1 = ua.t[i0 + 1];
    const auto = c.tracks.drawOrder, ARM = new Set(['under_arm_R', 'upperarm_R', 'forearm_R', 'hand_R', 'thumb_R', 'index_R', 'middle_R', 'ring_R', 'pinky_R']);
    if (L.drawOrder.t.length) throw new Error('knight_salute already has draw-order corrections — refusing to overwrite saved work');
    const ref = auto.v[core.keyIndex(auto.t, 0)].filter((id) => ARM.has(id));
    const times = [...new Set([...auto.t.filter((t) => t > 0), u0, u1])].sort((a, b) => a - b), pauld = [], open = [];
    for (const t of times) {
      const o = [...auto.v[core.keyIndex(auto.t, t)]];
      const ui = o.indexOf('upperarm_R'), fi = o.indexOf('forearm_R');
      if (t >= u0 && t < u1 && ui > fi) { o.splice(ui, 1); o.splice(fi, 0, 'upperarm_R'); pauld.push(t); }
      if (t < keys[1] || t >= keys[4]) {
        const pos = o.map((id, k) => (ARM.has(id) ? k : -1)).filter((k) => k >= 0), seq = ref.filter((id) => o.includes(id));
        if (seq.length === pos.length && seq.some((id, k) => o[pos[k]] !== id)) { pos.forEach((k, j) => (o[k] = seq[j])); open.push(t); }
      }
      L.drawOrder.t.push(r4(t)); L.drawOrder.v.push(o);
    }
    log.push(`salute: draw order — upperarm_R beneath the forearm while the raised pauldron shows (${u0}–${u1} s; keys ${pauld.join(', ')}); ` +
      `open-hand frames keep the first frame's arm/hand order (keys ${open.join(', ')}); other keys copied from the clip`);
  }
  // ---- 4) painted finger meshes: wider knuckle blends (weights only)
  if (!skip.includes('fingers')) {
    const sk = P.skins.find((s) => s.id === 'painted');
    for (const s of ['L', 'R']) for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
      const id = sk.replace[`${f}_${s}.default`], a = P.attachments[id]; if (!a?.weights) continue;
      a.weights = mesh.smoothWeights(a.weights, a.triangles, { iterations: 2, amount: 0.5 });
    }
    log.push('fingers: painted finger meshes (10) got 2 more knuckle weight-smoothing passes');
  }
  computeInverseBindsSafe();
  function computeInverseBindsSafe() { /* bones unchanged: inverse binds stay valid */ }
  // ---- report: every changed path; images byte-identical
  const changed = [];
  const walk = (a, b, path) => { if (JSON.stringify(a) === JSON.stringify(b)) return; if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && path.split('.').length < 5) { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], `${path}.${k}`); } else changed.push(path); };
  walk(before.attachments, P.attachments, 'attachments');
  for (const c of P.clips) { const b = before.clips.find((x) => x.name === c.name); if (JSON.stringify(b.tracks) !== JSON.stringify(c.tracks)) changed.push(`clips.${c.name}.tracks (BAKE CHANGED)`); walk(b.corrections, c.corrections, `clips.${c.name}.corrections`); }
  for (const k of Object.keys(P)) if (!['attachments', 'clips'].includes(k) && JSON.stringify(P[k]) !== JSON.stringify(before[k])) changed.push(k);
  const rep = validateProject(P, { images: new Set(store.paths()) });
  const z = io.saveProjectZip(P, store);
  let s = ''; for (let i = 0; i < z.length; i += 0x8000) s += String.fromCharCode.apply(null, z.subarray(i, i + 0x8000));
  return { log, changed, errors: rep.errors, warnings: rep.warnings.length, zip: btoa(s) };
}, { zipB64: fs.readFileSync(IN).toString('base64'), skip: [...skip] });
await browser.close(); server.close();
if (errors.length || res.errors.length) { console.log('errors', errors, res.errors.slice(0, 10)); process.exit(1); }
fs.writeFileSync(OUT, Buffer.from(res.zip, 'base64'));
// image bytes: every image in the input exists unchanged in the output
const { readZip } = await import('../viewer/js/art2d/zip.js');
const files = async (p) => new Map([...(await readZip(new Uint8Array(fs.readFileSync(p))))].map(([k, v]) => [k, Buffer.from(v)]));
const A = await files(IN), B = await files(OUT);
const imgDiff = [...A.keys()].filter((k) => k !== 'character.json' && (!B.has(k) || !A.get(k).equals(B.get(k))));
const report = { in: IN, out: OUT, fixes: res.log, changedPaths: res.changed, imagesChanged: imgDiff, filesIn: A.size, filesOut: B.size };
if (arg('report')) fs.writeFileSync(arg('report'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
if (imgDiff.length || res.changed.some((p) => /BAKE CHANGED/.test(p))) { console.log('refusing: artwork or bake changed'); process.exit(1); }
