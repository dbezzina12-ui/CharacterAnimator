// Acceptance checks for the 2D artwork mode (brief §16). node scripts/check-2d.mjs
// Writes validation/2d/report.json, validation/2d/REPORT.md and screenshots. Exits non-zero on failure.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { startServer, CHROME, CHROME_ARGS } from './serve.mjs';

const OUT = 'validation/2d';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
// info rows are measurements, not proof: they never count as passed and never fail the run
const info = (id, title, details) => { results.push({ id, title, pass: null, info: true, details }); console.log(`INFO ${id} ${title}${details ? ' — ' + JSON.stringify(details).slice(0, 300) : ''}`); };
const check = (id, title, pass, details) => { results.push({ id, title, pass: !!pass, details }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${title}${details ? ' — ' + (typeof details === 'string' ? details : JSON.stringify(details)).slice(0, 300) : ''}`); };

// ---- 1-2: the 3D pipeline still works and frozen/3D data was not rewritten
let knight3d = null;
try { execSync('node scripts/knight-check.mjs', { stdio: 'pipe', timeout: 240000 }); knight3d = JSON.parse(fs.readFileSync('validation/knight/checks.json', 'utf8')); } catch (e) { knight3d = { error: String(e.stdout || e.message).slice(-400) }; }
const knightClips = JSON.parse(fs.readFileSync('characters/aureate_knight/aureate_knight.character.json', 'utf8')).animations.length;
check('3d-works', '3D knight still loads, exports, reloads (scripts/knight-check.mjs)', knight3d && !knight3d.error && knight3d.checks?.countAfter === knightClips && knightClips === 27, knight3d?.checks ? { bones: knight3d.checks.bones, clips: knight3d.checks.countAfter, loopMax: knight3d.checks.loopMax } : knight3d);
// The only 3D changes since the 2D work began are the knight's golf_swing and sword_raise_2h/1h clips (tools/cbase/golf.py, baked by
// tools/knight_motion.py): those files may change, and the knight GLB must be ADDITIVE — every animation channel of
// 03cf633 byte-identical, same meshes/nodes/skins, only golf_swing added. Anything else under characters/ props/
// tools/ blender/ textures/ fails.
const GOLF_FILES = new Set(['characters/aureate_knight/aureate_knight.glb', 'characters/aureate_knight/aureate_knight.character.json',
  'characters/aureate_knight/knight-motion.json', 'tools/knight_motion.py', 'tools/cbase/golf.py', 'tools/cbase/sword_raise.py']);
const changed3d = execSync('git diff --name-only 03cf633 -- characters props tools blender textures 2>/dev/null || true').toString().trim().split('\n').filter(Boolean);
const untracked3d = execSync('git ls-files --others --exclude-standard -- characters props tools blender textures 2>/dev/null || true').toString().trim().split('\n').filter(Boolean);
const unexpected3d = [...changed3d, ...untracked3d].filter((f) => !GOLF_FILES.has(f));
function glbParts(buf) { const jl = buf.readUInt32LE(12); return { j: JSON.parse(buf.slice(20, 20 + jl).toString()), bin: buf.slice(20 + jl + 8) }; }
function accBytes(G, i) { const a = G.j.accessors[i], bv = G.j.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type], o = (bv.byteOffset || 0) + (a.byteOffset || 0); return G.bin.slice(o, o + a.count * n * 4); }
let glbAdditive = { ok: true };
try {
  const A = glbParts(execSync('git show 03cf633:characters/aureate_knight/aureate_knight.glb', { maxBuffer: 1 << 30 })), B = glbParts(fs.readFileSync('characters/aureate_knight/aureate_knight.glb'));
  const added = B.j.animations.map((a) => a.name).filter((n) => !A.j.animations.some((x) => x.name === n));
  let same = 0, diff = 0;
  for (const an of A.j.animations) {
    const bn = B.j.animations.find((x) => x.name === an.name); if (!bn) { diff++; continue; }
    an.channels.forEach((ch, i) => { const sa = an.samplers[ch.sampler], sb = bn.samplers[bn.channels[i].sampler];
      if (accBytes(A, sa.input).equals(accBytes(B, sb.input)) && accBytes(A, sa.output).equals(accBytes(B, sb.output))) same++; else diff++; });
  }
  const struct = A.j.meshes.length === B.j.meshes.length && A.j.nodes.length === B.j.nodes.length && JSON.stringify(A.j.skins) === JSON.stringify(B.j.skins);
  glbAdditive = { ok: diff === 0 && struct && JSON.stringify(added) === JSON.stringify(['golf_swing', 'sword_raise_2h', 'sword_raise_1h']), existingChannelsIdentical: same, changedChannels: diff, added, structureSame: struct };
} catch (e) { glbAdditive = { ok: false, error: String(e.message).slice(0, 200) }; }
check('frozen-untouched', '3D character data, props and frozen builds are not rewritten (only the knight\'s golf swing and sword raises are added, additively)',
  unexpected3d.length === 0 && glbAdditive.ok, { unexpected: unexpected3d, glb: glbAdditive });

const server = await startServer(0);
const port = server.address().port, base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [...CHROME_ARGS, '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`HTTP ${r.status()} ${r.url()}`); });

// 3D mode is still the default and unaffected
await page.goto(`${base}/viewer/knight.html`);
await page.waitForFunction(() => window.viewer?.ready2d, null, { timeout: 120000 });
const mode0 = await page.evaluate(() => ({ body: document.body.className, clip: viewer.state.clipAction?.getClip().name, switch: !!document.querySelector('.modeSwitch') }));
check('3d-default', 'Viewer opens in 3D mode with the mode selector added', !/mode2d/.test(mode0.body) && mode0.clip === 'hover_sword_vigil' && mode0.switch, mode0);
await page.evaluate(() => viewer.art2d.setMode('2d'));
await page.waitForFunction(() => window.art2d?.project && window.art2d.editor.ready, null, { timeout: 60000 });
await page.evaluate(() => art2d.editor.ready);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/editor_2d_mode.png` });

// ---- 3-5: separated attachments, weighted meshes, bind reassembly, inverse binds, weights, finiteness
const struct = await page.evaluate(async () => {
  const { validateProject } = await import('./js/art2d/schema.js');
  const P = art2d.project, rep = validateProject(P, { images: new Set(art2d.store.paths()) });
  const atts = Object.values(P.attachments), weighted = atts.filter((a) => a.weights);
  let maxInf = 0, worstSum = 0;
  for (const a of weighted) for (const l of a.weights) { maxInf = Math.max(maxInf, l.length / 2); let s = 0; for (let j = 1; j < l.length; j += 2) s += l[j]; worstSum = Math.max(worstSum, Math.abs(s - 1)); }
  // inverse binds: world(setup) * invBind = identity for every bone
  const { Rig, affMul } = await import('./js/art2d/core.js');
  const rig = new Rig(P); let invErr = 0;
  P.bones.forEach((b) => { const m = affMul(rig.bindWorld[rig.boneIndex.get(b.id)], b.inverseBind); invErr = Math.max(invErr, Math.abs(m[0] - 1) + Math.abs(m[3] - 1) + Math.abs(m[1]) + Math.abs(m[2]) + Math.abs(m[4]) + Math.abs(m[5])); });
  // setup pose: skinned vertices equal bind vertices exactly
  const pose = rig.evaluate(null, 0); let bindErr = 0;
  for (const [id, r] of rig.attachments) { const p = rig.skinAttachment(id, pose); for (let i = 0; i < p.length; i++) bindErr = Math.max(bindErr, Math.abs(p[i] - r.bind[i])); }
  // every clip, every frame at 30 fps: all vertices finite
  let frames = 0, nonFinite = 0;
  for (const c of P.clips) for (let t = 0; t <= c.duration + 1e-9; t += 1 / 30) {
    const ps = rig.evaluate(c, t); frames++;
    for (const d of rig.drawList(ps)) { const p = rig.skinAttachment(d.attachment, ps); for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) { nonFinite++; break; } }
  }
  return { errors: rep.errors, warnings: rep.warnings.length, slots: P.slots.length, attachments: atts.length, images: Object.keys(P.images).length, weighted: weighted.length,
    maxInf, worstSum, invErr, bindErr, frames, nonFinite, clips: P.clips.length, starter: P.starterSkin?.note };
});
check('separate-art', 'Character is separately addressable images on slots (not a flattened render)', struct.attachments >= 30 && struct.images === struct.attachments, { slots: struct.slots, attachments: struct.attachments, images: struct.images });
check('weighted-meshes', 'Deformable weighted meshes: ≤4 influences, normalised weights', struct.weighted >= 10 && struct.maxInf <= 4 && struct.worstSum < 1e-3, { weighted: struct.weighted, maxInfluences: struct.maxInf, worstSumError: struct.worstSum });
check('valid', 'Project validates (schema gamboligy.character2d/1.0)', !struct.errors.length, struct.errors.slice(0, 5).join('; ') || `0 errors, ${struct.warnings} warnings`);
check('inverse-binds', 'Stored inverse binds invert the setup pose; setup pose reproduces the bind mesh (float32 output)', struct.invErr < 1e-5 && struct.bindErr < 1e-3, { invErr: struct.invErr, bindVertexErr: struct.bindErr });
check('finite', `All ${struct.clips} clips evaluate to finite meshes at 30 fps`, struct.nonFinite === 0, { frames: struct.frames, nonFinite: struct.nonFinite });

// setup reassembly vs the 3D render at the same art camera (silhouette IoU)
const reassembly = await page.evaluate(async () => {
  const { Renderer2D } = await import('./js/art2d/render2d.js');
  const { ArtCamera } = await import('./js/art2d/bridge3d.js');
  const P = art2d.project, rig = art2d.rig, W = 600, H = 800, rect = [-480, -40, 480, 1240], sc = W / (rect[2] - rect[0]);
  const alpha = (cnv) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(cnv, 0, 0, W, H); return g.getImageData(0, 0, W, H).data; };
  const c2 = document.createElement('canvas'); c2.width = W; c2.height = H; const r2 = new Renderer2D(c2);
  await r2.loadImages(P, (p) => art2d.store.url(p));
  r2.draw(rig, rig.evaluate(null, 0), { dpr: 1, view: { x: (rect[0] + rect[2]) / 2, y: (rect[1] + rect[3]) / 2, zoom: sc } });
  const a2 = alpha(c2);
  const v = viewer, R = v.renderer, cam = new ArtCamera({ ...P.artView }).threeCamera(rect[0], rect[1], rect[2], rect[3]);
  v.state.ch.resetPose(); if (v.state.clipProp) { v.state.clipProp.removeFromParent(); v.state.clipProp = null; }
  const bg = v.scene.background, size = R.getSize(new v.THREE.Vector2()), pr = R.getPixelRatio();
  const hidden = []; v.scene.children.forEach((o) => { if (o !== v.state.ch.root && !o.isLight) { hidden.push([o, o.visible]); o.visible = false; } });
  v.scene.background = null; R.setPixelRatio(1); R.setSize(W, H, false); R.setClearColor(0, 0); R.render(v.scene, cam);
  const a3 = alpha(R.domElement);
  v.scene.background = bg; R.setPixelRatio(pr); R.setSize(size.x, size.y, false); hidden.forEach(([o, vis]) => { o.visible = vis; });
  let inter = 0, uni = 0; for (let i = 3; i < a2.length; i += 4) { const x = a2[i] > 128, y = a3[i] > 128; if (x && y) inter++; if (x || y) uni++; }
  return { iou: inter / uni, px2d: a2.filter((_, i) => i % 4 === 3 && _ > 128).length };
});
check('bind-reassembly', 'Setup pose reassembles the character: 2D silhouette matches the 3D render at the art camera', reassembly.iou > 0.93, { silhouetteIoU: +reassembly.iou.toFixed(4) });

// ---- bridge fidelity: 2D joints vs projected 3D joints, every clip, every frame (brief: ≤2 px at 1024 px)
const drift = await page.evaluate(async () => {
  const { ArtCamera } = await import('./js/art2d/bridge3d.js');
  const P = art2d.project, rig = art2d.rig, v = viewer, ch = v.state.ch, cam = new ArtCamera({ ...P.artView });
  const out = {}; let worst = 0;
  const V = new v.THREE.Vector3();
  for (const c of P.clips.filter((x) => x.source?.type === 'bridge3d')) {
    let mx = 0, where = '';
    for (let t = 0; t <= c.duration + 1e-9; t += 1 / 30) {
      v.playClip(c.name, Math.min(t, c.duration), false); ch.mixer.update(0); ch.root.updateMatrixWorld(true);
      rig.evaluate(c, Math.min(t, c.duration), { corrections: false });
      for (const b of P.bones) {
        if (b.kind === 'tip' || b.kind === 'prop') continue;
        const o = ch.bones[b.id] || ch.sockets[b.id]; if (!o) continue;
        const p3 = cam.project(V.setFromMatrixPosition(o.matrixWorld)), p2 = rig.worldPoint(b.id);
        const d = Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
        if (d > mx) { mx = d; where = `${b.id}@${t.toFixed(2)}`; }
      }
    }
    out[c.name] = { max: +mx.toFixed(3), at: where }; worst = Math.max(worst, mx);
  }
  return { worst, out };
});
check('joint-drift', 'Every 2D joint/socket within 2 px of the projected 3D joint (1024 px reference height), all bridged clips', drift.worst <= 2, { worstPx: +drift.worst.toFixed(3) });

// ---- contacts: palms/grips/thumb
const contacts = await page.evaluate(() => {
  const P = art2d.project, rig = art2d.rig, out = {};
  for (const c of P.clips) {
    let mx = 0, un = 0, on = 0;
    for (let t = 0; t <= c.duration + 1e-9; t += 1 / 30) {
      const ps = rig.evaluate(c, t);
      for (const k of ps.contacts) if (k.mix >= 0.999) { on++; mx = Math.max(mx, k.error); if (!k.reachable) un++; }
    }
    if (on) out[c.name] = { frames: on, maxErrorPx: +mx.toFixed(4), unreachableFrames: un };
  }
  // hover: palm-to-blade drift with constraints fully on; the separate right-hand grip is rigid by construction
  return out;
});
const worstContact = Math.max(...Object.values(contacts).map((c) => c.maxErrorPx));
check('contacts', 'Support hand / hover palm / thumb-button contacts hold (≤2 px) wherever engaged', worstContact <= 2, contacts);
const unreachable = Object.entries(contacts).filter(([, c]) => c.unreachableFrames).map(([n, c]) => `${n}: ${c.unreachableFrames} frames`);
info('unreachable-reported', 'Unreachable targets are reported per frame (not hidden)', unreachable.length ? unreachable : 'no unreachable frames');

// ---- timing, loops, endpoints, draw-order flicker
const timing = await page.evaluate(async () => {
  const { ArtCamera } = await import('./js/art2d/bridge3d.js');
  const P = art2d.project, rig = art2d.rig, ch = viewer.state.ch, out = {}, cam = new ArtCamera({ ...P.artView });
  let worstLoop = 0, durErr = 0, flicker = 0;
  for (const c of P.clips) {
    const c3 = ch.clip(c.name);
    if (c3 && c.source?.type === 'bridge3d') durErr = Math.max(durErr, Math.abs(c3.duration - c.duration));
    if (c.loop) {
      rig.evaluate(c, 0); const a = rig.world.map((m) => m.slice()); rig.evaluate(c, c.duration);
      let d = 0; rig.world.forEach((m, i) => { d = Math.max(d, Math.hypot(m[4] - a[i][4], m[5] - a[i][5])); });
      // the 3D clip's own endpoint jump, projected the same way (the 2D clip cannot be more closed than its source)
      let d3 = 0;
      if (c3 && c.source?.type === 'bridge3d') {
        const V = new viewer.THREE.Vector3(), pos = (t) => { viewer.playClip(c.name, t, false); ch.mixer.update(0); ch.root.updateMatrixWorld(true); return Object.values(ch.bones).map((b) => cam.project(V.setFromMatrixPosition(b.matrixWorld))); };
        const p0 = pos(0), p1 = pos(c.duration); p0.forEach((p, i) => { d3 = Math.max(d3, Math.hypot(p[0] - p1[i][0], p[1] - p1[i][1])); });
      }
      worstLoop = Math.max(worstLoop, d - d3); out[c.name] = { jump2d: +d.toFixed(3), jump3d: +d3.toFixed(3) };
    }
    // flicker = an order that holds for a single frame and then returns to the previous order (A → B → A)
    const T = c.tracks?.drawOrder?.t || [], V = (c.tracks?.drawOrder?.v || []).map((o) => o.join(',')), setupKey = P.slots.map((s) => s.id).join(',');
    for (let i = 0; i + 1 < T.length; i++) if (T[i + 1] - T[i] < 1.5 / 30 && V[i + 1] === (i ? V[i - 1] : setupKey)) flicker++;
  }
  return { worstLoop, durErr, flicker, loops: out };
});
check('timing', 'Clip durations equal the 3D clips; looping clips add no endpoint jump beyond their 3D source (joint px)', timing.durErr < 1e-3 && timing.worstLoop < 0.5, { durationErr: timing.durErr, worstExtraJumpPx: +timing.worstLoop.toFixed(3), loops: timing.loops });
check('no-flicker', 'Draw order never flips for a single frame', timing.flicker === 0, { singleFrameFlips: timing.flicker });

// ---- deformation stress: elbows/knees 0/45/90/120, crossed/raised arms
const stress = await page.evaluate(async () => {
  const { Rig } = await import('./js/art2d/core.js');
  const P = art2d.project, rig = new Rig(P), out = {};
  const flips = (pose) => { let n = 0, tot = 0; for (const d of rig.drawList(pose)) { const a = P.attachments[d.attachment]; if (!a.weights) continue; const p = rig.skinAttachment(d.attachment, pose), r = rig.attachments.get(d.attachment);
    for (let i = 0; i < a.triangles.length; i += 3) { const [u, v, w] = [a.triangles[i], a.triangles[i + 1], a.triangles[i + 2]]; const s0 = (r.bind[v * 2] - r.bind[u * 2]) * (r.bind[w * 2 + 1] - r.bind[u * 2 + 1]) - (r.bind[v * 2 + 1] - r.bind[u * 2 + 1]) * (r.bind[w * 2] - r.bind[u * 2]); const s1 = (p[v * 2] - p[u * 2]) * (p[w * 2 + 1] - p[u * 2 + 1]) - (p[v * 2 + 1] - p[u * 2 + 1]) * (p[w * 2] - p[u * 2]); tot++; if (Math.sign(s0) !== Math.sign(s1) && Math.abs(s0) > 1e-6) n++; } } return { n, tot }; };
  for (const deg of [0, 45, 90, 120]) {
    const f = flips(rig.evaluate(null, 0, { override: { forearm_L: { rotate: deg }, forearm_R: { rotate: -deg }, shin_L: { rotate: -deg }, shin_R: { rotate: -deg } } }));
    out[`bend_${deg}`] = +(100 * f.n / f.tot).toFixed(2);
  }
  for (const [n, clip, t] of [['arms_raised', 'cheer', 0.9], ['arms_crossed_legs', 'float_monk', 2.5], ['salute', 'knight_salute', 1.8], ['slash_windup', 'sword_2h_slash', 0.45]]) {
    const f = flips(rig.evaluate(clip, t)); out[n] = +(100 * f.n / f.tot).toFixed(2);
  }
  return out;
});
const bends = Object.fromEntries(Object.entries(stress).filter(([k]) => k.startsWith('bend_'))), poses = Object.fromEntries(Object.entries(stress).filter(([k]) => !k.startsWith('bend_')));
check('bend-stress', 'Elbows/knees at 0/45/90/120°: % of weighted-mesh triangles that fold over (< 2 %)', Object.values(bends).every((x) => x < 2), bends);
info('pose-stress', 'Raised / crossed / salute / wind-up poses measured (fold-over % per pose; judged in the visual QA, not here)', poses);
// visual evidence
await page.evaluate(() => { art2d.setMode('setup'); });
for (const deg of [0, 45, 90, 120]) {
  await page.evaluate((deg) => { art2d.editor.preview.pose = { forearm_L: { rotate: deg }, forearm_R: { rotate: -deg }, shin_L: { rotate: -deg }, shin_R: { rotate: -deg } }; art2d.editor.fitView(true); }, deg);
  await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/bend_${deg}.png`, clip: { x: 310, y: 0, width: 1130, height: 950 } });
}
await page.evaluate(() => { art2d.editor.preview.pose = null; art2d.setMode('animate'); });

// ---- hit testing on the deformed mesh
const hit = await page.evaluate(async () => {
  const { hitTest } = await import('./js/art2d/render2d.js');
  art2d.selectClip('knight_salute'); art2d.seek(1.8); art2d.editor.frame(0);
  const d = art2d.editor.drawn.find((x) => x.slot === 'forearm_R'); const a = art2d.project.attachments[d.attachment];
  const i = a.triangles[Math.floor(a.triangles.length / 6) * 3]; const x = d.pos[i * 2], y = d.pos[i * 2 + 1];
  const t = [a.triangles[Math.floor(a.triangles.length / 6) * 3], a.triangles[Math.floor(a.triangles.length / 6) * 3 + 1], a.triangles[Math.floor(a.triangles.length / 6) * 3 + 2]];
  const cx = (d.pos[t[0] * 2] + d.pos[t[1] * 2] + d.pos[t[2] * 2]) / 3, cy = (d.pos[t[0] * 2 + 1] + d.pos[t[1] * 2 + 1] + d.pos[t[2] * 2 + 1]) / 3;
  const h = hitTest(art2d.editor.drawn, cx, cy); void x; void y;
  return { expect: 'forearm_R or a slot drawn over it', got: h?.slot, topmostAtPoint: h?.slot };
});
check('hit-test', 'Clicking picks slots on the deformed (animated) mesh', !!hit.got, hit);

// ---- undo/redo: pivot, weight, keyframe, layer order
const undo = await page.evaluate(() => {
  const P = () => art2d.project, snap = () => JSON.stringify([P().bones, P().attachments['under_arm_L.default'].weights, P().clips.find((c) => c.name === 'idle').corrections, P().slots.map((s) => s.id)]);
  const s0 = snap(), out = {};
  art2d.setMode('setup');
  const i = art2d.rig.boneIndex.get('forearm_L'), w = art2d.rig.bindWorld[i];
  art2d.movePivot('forearm_L', w[4] + 12, w[5] - 8);
  const a = P().attachments['under_arm_L.default'];
  art2d.paintWeights('under_arm_L.default', 'forearm_L', a.vertices[20], a.vertices[21], 40, 0.6);
  art2d.setMode('animate'); art2d.selectClip('idle'); art2d.seek(1);
  art2d.keyBone('upperarm_R', 'rotate', { v: 25 });
  art2d.setMode('setup'); const o = art2d.editor.currentOrder(); art2d.applyOrder([o[o.length - 1], ...o.slice(0, -1)], 'test reorder');
  const s1 = snap(), labels = art2d.history().slice(-4);
  for (let k = 0; k < 4; k++) art2d.undo();
  out.undoRestores = snap() === s0;
  for (let k = 0; k < 4; k++) art2d.redo();
  out.redoReapplies = snap() === s1;
  for (let k = 0; k < 4; k++) art2d.undo();
  out.labels = labels; out.clean = snap() === s0;
  art2d.setMode('animate');
  return out;
});
check('undo-redo', 'Undo/redo of pivot, weight paint, keyframe and layer order', undo.undoRestores && undo.redoReapplies && undo.clean, undo);

// ---- replace one art piece and one prop; layered import
const replace = await page.evaluate(async () => {
  const io = await import('./js/art2d/project-io.js');
  const P = art2d.project, st = art2d.store;
  const recolor = async (imgId, hue, grow = 1) => {
    const d = await io.decodeImage(st.bytes(P.images[imgId].path));
    const W = Math.round(d.width * grow), H = Math.round(d.height * grow), c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const t = document.createElement('canvas'); t.width = d.width; t.height = d.height; t.getContext('2d').putImageData(d, 0, 0);
    g.filter = `hue-rotate(${hue}deg) saturate(1.6)`; g.drawImage(t, 0, 0, W, H);
    return io.encodePNG(g.getImageData(0, 0, W, H));
  };
  art2d.selectSlot('helmet', 'helmet.default');
  const before = JSON.stringify(P.attachments['helmet.default'].vertices);
  await art2d.replaceSelected(await recolor('helmet__default', 140));
  const meshKept = JSON.stringify(P.attachments['helmet.default'].vertices) === before;
  art2d.selectSlot('prop_R', 'prop_R.Staff');
  await art2d.replaceSelected(await recolor('prop__Staff', 200, 1.15));
  const staff = P.attachments['prop_R.Staff'];
  // layered import: two painted layers + one layer for a slot that does not exist
  const lay = async (slot) => { const a = P.attachments[`${slot}.default`], d = await io.decodeImage(st.bytes(P.images[a.image].path)); const c = document.createElement('canvas'); c.width = d.width; c.height = d.height; const g = c.getContext('2d'); g.putImageData(d, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(200,40,40,0.35)'; g.fillRect(0, 0, d.width, d.height); return io.encodePNG(g.getImageData(0, 0, d.width, d.height)); };
  const { Rig, affApply } = await import('./js/art2d/core.js');
  const rig = new Rig(P), topLeft = (slot) => { const r = rig.attachments.get(`${slot}.default`), a = P.attachments[`${slot}.default`], s = a.imageScale; return affApply(r.place, -a.pivot[0] * s, a.pivot[1] * s); };
  const files = new Map(), scale = P.attachments['forearm_L.default'].imageScale, origin = [2000, 3000], L = [];
  for (const slot of ['forearm_L', 'shin_R']) { files.set(`${slot}.png`, await lay(slot)); const tl = topLeft(slot); L.push({ file: `${slot}.png`, x: origin[0] + tl[0] / scale, y: origin[1] - tl[1] / scale, name: 'painted' }); }
  files.set('tail.png', await lay('forearm_L')); L.push({ file: 'tail.png', slot: 'tail', x: 0, y: 0 });
  files.set('layers.json', new TextEncoder().encode(JSON.stringify({ canvas: { w: 4000, h: 4000 }, origin, scale, layers: L })));
  const res = await art2d.importLayered(files);
  const v = art2d.validate();
  return { meshKept, staffSize: [P.images[staff.image].w, P.images[staff.image].h], staffVerts: staff.vertices.length / 2, imported: res.added, skipped: res.skipped, errors: v.errors };
});
check('replace-art', 'Replace one art piece (helmet, mesh + binding kept) and one prop (staff, new size re-meshed)', replace.meshKept && replace.staffVerts > 3 && !replace.errors.length, replace);
check('layered-import', 'Layered PNG + layers.json import binds painted layers to existing slots; unknown slots reported', replace.imported.length === 2 && replace.skipped.length === 1, { added: replace.imported, skipped: replace.skipped });
await page.evaluate(() => { art2d.selectClip('knight_salute'); art2d.seek(1.8); art2d.editor.fitView(true); });
await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/replaced_helmet_staff_import.png` });

// ---- save, reopen fresh (new page, from the ZIP bytes only)
const saved = await page.evaluate(async () => {
  const io = await import('./js/art2d/project-io.js'); const z = io.saveProjectZip(art2d.project, art2d.store);
  let s = ''; for (let i = 0; i < z.length; i += 0x8000) s += String.fromCharCode.apply(null, z.subarray(i, i + 0x8000));
  const r = art2d.rig, ref = []; for (const [c, t] of [['walk_in_place', 0.4], ['hover_sword_vigil', 2.2], ['knight_salute', 1.8]]) { const ps = r.evaluate(c, t); ref.push(Array.from(r.skinAttachment('helmet.default', ps).slice(0, 8)).map((x) => +x.toFixed(4))); }
  return { b64: btoa(s), ref, size: z.length };
});
fs.writeFileSync(`${OUT}/saved_project.zip.tmp`, Buffer.from(saved.b64, 'base64'));
const page2 = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page2.goto(`${base}/viewer/art2d-sheet.html?bind=1`);
await page2.waitForFunction(() => window.sheetReady);
const reopened = await page2.evaluate(async (b64) => {
  const io = await import('./js/art2d/project-io.js'), { Rig } = await import('./js/art2d/core.js');
  const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const { project, report } = await io.loadProjectZip(u8), r = new Rig(project), out = [];
  for (const [c, t] of [['walk_in_place', 0.4], ['hover_sword_vigil', 2.2], ['knight_salute', 1.8]]) { const ps = r.evaluate(c, t); out.push(Array.from(r.skinAttachment('helmet.default', ps).slice(0, 8)).map((x) => +x.toFixed(4))); }
  return { errors: report.errors, out, painted: Object.keys(project.attachments).filter((k) => k.endsWith('.painted')) };
}, saved.b64);
fs.rmSync(`${OUT}/saved_project.zip.tmp`);
check('save-reopen', 'Save → reopen in a fresh page from the ZIP alone: valid, identical poses, edits kept', !reopened.errors.length && JSON.stringify(reopened.out) === JSON.stringify(saved.ref) && reopened.painted.length === 2, { zipKB: Math.round(saved.size / 1024), errors: reopened.errors.length, painted: reopened.painted });
await page2.close();

// ---- runtime package consumed alone + runtime vs editor pose; sprite frames vs editor render
const pkgCheck = await page.evaluate(async () => {
  const io = await import('./js/art2d/project-io.js'), ex = await import('./js/art2d/exporters.js');
  const { project, store } = await io.loadProjectURL('../characters2d/aureate_knight/character.json');
  const rt = await ex.exportRuntimePackage(project, store, {});
  const sp = await ex.exportSpriteSheets(project, store, { clips: ['walk_in_place', 'hover_sword_vigil'], scale: 0.5 });
  // sprite frame vs direct render of the same pose (same registration)
  const { Rig } = await import('./js/art2d/core.js'); const rig = new Rig(project);
  const m = sp.manifest.clips.walk_in_place, f = m.frames[7];
  const sheetPng = sp.files.find((x) => x.path === sp.manifest.sheets[f.sheet].path).data;
  const sheet = await io.decodeImage(sheetPng);
  const r = await ex.offscreenRenderer(project, store), sc = sp.manifest.scale;
  const x0 = -m.registration[0] / sc, y1 = m.registration[1] / sc, rect = [x0, y1 - m.frameSize[1] / sc, x0 + m.frameSize[0] / sc, y1];
  const direct = ex.renderPose(r, rig, rig.evaluate('walk_in_place', f.t), rect, sc);
  let diff = 0, n = 0;
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const si = ((f.y + y) * sheet.width + f.x + x) * 4, di = ((f.offset[1] + y) * direct.width + f.offset[0] + x) * 4;
    diff += Math.abs(sheet.data[si + 3] - direct.data[di + 3]); n++;
  }
  let s = ''; for (let i = 0; i < rt.zip.length; i += 0x8000) s += String.fromCharCode.apply(null, rt.zip.subarray(i, i + 0x8000));
  const loopFrames = sp.manifest.clips.walk_in_place.frameCount, expect = Math.round(project.clips.find((c) => c.name === 'walk_in_place').duration * 30);
  return { pkg: btoa(s), pages: rt.pkg.atlas.pages.length, alphaDiff: diff / n, loopFrames, expect, sheets: sp.manifest.sheets.length };
});
check('sprite-vs-editor', 'Sprite-sheet frame equals the editor render of the same pose (stable registration + trim offsets; mean alpha diff of 255)', pkgCheck.alphaDiff < 2, { meanAlphaDiff: +pkgCheck.alphaDiff.toFixed(3) });
check('no-dup-endpoint', 'Looping sprite export has no duplicated loop endpoint frame', pkgCheck.loopFrames === pkgCheck.expect, { frames: pkgCheck.loopFrames, expected: pkgCheck.expect });
// unpack the package to a scratch folder served alone and load it with the standalone runtime
const { readZip } = await import('../viewer/js/art2d/zip.js');
const scratch = `${OUT}/_pkg`; fs.rmSync(scratch, { recursive: true, force: true }); fs.mkdirSync(scratch, { recursive: true });
for (const [p, b] of await readZip(new Uint8Array(Buffer.from(pkgCheck.pkg, 'base64')))) fs.writeFileSync(`${scratch}/${p}`, b);
const page3 = await browser.newPage({ viewport: { width: 1000, height: 760 } });
const reqs = []; page3.on('request', (r) => reqs.push(new URL(r.url()).pathname));
const evs = [];
await page3.goto(`${base}/runtime/example/?package=${encodeURIComponent('/' + scratch + '/aureate_knight_2d.runtime.json')}&clip=contact_detonator_2d`);
await page3.waitForFunction(() => window.runtimeReady, null, { timeout: 60000 });
await page3.waitForTimeout(2600);
const rtState = await page3.evaluate(() => ({ log: document.getElementById('log').textContent, clips: character.clips.length, helmet: (() => { character.pause(); character.play('knight_salute', { time: 1.8 }); character.pause(); const ps = character.pose(); return Array.from(character.rig.skinAttachment('helmet.default', ps).slice(0, 8)).map((x) => +x.toFixed(4)); })() }));
await page3.screenshot({ path: `${OUT}/runtime_example.png` });
const foreign = [...new Set(reqs)].filter((p) => !p.startsWith('/runtime/') && !p.startsWith('/' + scratch));
check('runtime-standalone', 'Standalone runtime plays the exported package alone (no editor/3D requests), events fire', foreign.length === 0 && /button_down/.test(rtState.log) && rtState.clips === struct.clips, { requests: [...new Set(reqs)], foreign, events: rtState.log.split('\n').slice(0, 3) });
const edHelmet = await page.evaluate(async () => { const io = await import('./js/art2d/project-io.js'), { Rig } = await import('./js/art2d/core.js'); const { project } = await io.loadProjectURL('../characters2d/aureate_knight/character.json'); const r = new Rig(project); const ps = r.evaluate('knight_salute', 1.8); return Array.from(r.skinAttachment('helmet.default', ps).slice(0, 8)).map((x) => +x.toFixed(4)); });
check('runtime-matches-editor', 'Runtime pose equals the editor pose for the same clip/time', JSON.stringify(edHelmet) === JSON.stringify(rtState.helmet), { editor: edHelmet.slice(0, 2), runtime: rtState.helmet.slice(0, 2) });
await page3.close(); fs.rmSync(scratch, { recursive: true, force: true });

// ---- second proportion variant
const dwarf = await page.evaluate(async () => {
  const io = await import('./js/art2d/project-io.js'), { Rig } = await import('./js/art2d/core.js');
  const { project, report } = await io.loadProjectURL('../characters2d/dwarf/character.json');
  const r = new Rig(project); let bad = 0; for (const c of project.clips) for (let t = 0; t <= c.duration; t += 0.1) { const ps = r.evaluate(c, t); for (const d of r.drawList(ps)) if (!r.skinAttachment(d.attachment, ps).every(Number.isFinite)) bad++; }
  return { errors: report.errors, clips: project.clips.length, slots: project.slots.length, height: project.pixelsPerMeter, bad };
});
check('variant', 'Second proportion variant (dwarf) uses the same rig template, validates and plays', !dwarf.errors.length && dwarf.bad === 0, dwarf);

// ---- 3D vs 2D comparison at the same clip time (screenshot) + featured demos (the untouched knight again)
await page.evaluate(() => art2d.openURL('../characters2d/aureate_knight/character.json'));
await page.evaluate(() => art2d.editor.ready);
await page.evaluate(() => { art2d.setCompare('inset'); art2d.selectClip('hover_sword_vigil'); art2d.seek(1.5); art2d.editor.fitView(true); });
await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/compare_3d_inset_hover.png` });
await page.evaluate(() => { art2d.setCompare('off'); });
for (const [clip, t] of [['idle', 1], ['hover_sword_vigil', 0], ['sword_2h_idle', 1], ['sword_2h_slash', 0.8], ['walk_in_place', 0.3], ['knight_salute', 1.8], ['finger_tests_2d', 3.9], ['contact_detonator_2d', 1.5]]) {
  await page.evaluate(([c, t]) => { art2d.selectClip(c); art2d.seek(t); art2d.editor.fitView(true); }, [clip, t]);
  await page.waitForTimeout(250); await page.screenshot({ path: `${OUT}/demo_${clip}.png`, clip: { x: 310, y: 0, width: 1130, height: 950 } });
}

// ---- narrow viewport + honest performance numbers
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(600);
const narrow = await page.evaluate(() => {
  const over = []; document.querySelectorAll('body *').forEach((e) => { const r = e.getBoundingClientRect(); if ((r.right > innerWidth + 1 || (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible')) && r.width > 0 && getComputedStyle(e).display !== 'none') over.push(`${e.tagName.toLowerCase()}#${e.id}.${String(e.className).split(' ')[0]} r${Math.round(r.right)} sw${e.scrollWidth}/${e.clientWidth}`); });
  return { fits: document.documentElement.scrollWidth <= innerWidth, scrollWidth: document.documentElement.scrollWidth, stageW: document.getElementById('stage2d').clientWidth, stageH: document.getElementById('stage2d').clientHeight, overflowing: over.slice(0, 6) };
});
await page.screenshot({ path: `${OUT}/narrow_390.png` });
check('narrow', 'Narrow (390 px) viewport: no horizontal overflow, stage usable', narrow.fits && narrow.stageW >= 300 && narrow.stageH >= 200, narrow);
await page.setViewportSize({ width: 1440, height: 950 });
const perf = await page.evaluate(() => {
  const ed = art2d.editor, rig = art2d.rig; art2d.selectClip('walk_in_place');
  let t0 = performance.now(); for (let i = 0; i < 300; i++) rig.evaluate('walk_in_place', (i / 30) % 1.13); const evalMs = (performance.now() - t0) / 300;
  t0 = performance.now(); for (let i = 0; i < 120; i++) { ed.player.seek((i / 30) % 1.1); ed.frame(0); } const frameMs = (performance.now() - t0) / 120;
  const verts = Object.values(art2d.project.attachments).reduce((s, a) => s + a.vertices.length / 2, 0);
  return { evalMs: +evalMs.toFixed(3), editorFrameMs: +frameMs.toFixed(2), attachments: Object.keys(art2d.project.attachments).length, vertices: verts, renderer: 'headless Chromium + SwiftShader (CPU WebGL)' };
});
info('performance', 'Performance measured (CPU-emulated WebGL in headless Chromium: not representative of a GPU device)', perf);
let bundle = 'up to date'; try { execSync('node scripts/build-runtime.mjs --check', { stdio: 'pipe' }); } catch (e) { bundle = String(e.stdout || e.message).trim(); }
check('runtime-bundle-fresh', 'The committed standalone runtime bundle matches a fresh build of the core (no stale runtime)', bundle === 'up to date', bundle);
check('no-errors', 'No page errors during the whole run', errors.length === 0, errors.slice(0, 5));

const clipStatus = JSON.parse(fs.readFileSync('characters2d/aureate_knight/character.json', 'utf8')).clips.map((c) => ({ name: c.name + (c.source?.type === 'native2d' ? ' (native 2D)' : ''), level: c.status?.level, notes: c.status?.notes || [] }));
await browser.close(); server.close();
const failed = results.filter((r) => !r.info && !r.pass), infos = results.filter((r) => r.info);
const report = { date: new Date().toISOString(), passed: results.length - failed.length - infos.length, failed: failed.length, info: infos.length, results, drift: drift.out, contacts, timing: timing.loops, stress, perf };
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
const md = ['# 2D artwork mode — acceptance report', '', `Generated by \`node scripts/check-2d.mjs\`. ${report.passed} passed, ${report.failed} failed, ${report.info} info (measurements shown for transparency, not counted as passes).`, '',
  '| | check | details |', '|---|---|---|', ...results.map((r) => `| ${r.info ? 'ℹ️' : r.pass ? '✅' : '❌'} | ${r.title} | ${(typeof r.details === 'string' ? r.details : JSON.stringify(r.details)).replace(/\|/g, '/').slice(0, 260)} |`),
  '', '## Joint drift vs projected 3D (px, per bridged clip)', '', '| clip | max px | where |', '|---|---|---|', ...Object.entries(drift.out).map(([k, v]) => `| ${k} | ${v.max} | ${v.at} |`),
  '', '## Per-clip bridge status (limitations per motion)', '', 'Levels: **ok** = reads correctly from the front-three-quarter art; **attention** = works, with the listed compromises; **needs-art** = needs additional authored art (another view or the other side of a hand) for fidelity.', '',
  '| clip | status | notes |', '|---|---|---|', ...clipStatus.map((c) => `| ${c.name} | ${c.level} | ${(c.notes.join('; ') || '—').replace(/\|/g, '/')} |`),
  '', 'Screenshots: `validation/2d/*.png`.', ''];
fs.writeFileSync(`${OUT}/REPORT.md`, md.join('\n'));
console.log(`\n${report.passed} passed, ${report.failed} failed, ${report.info} info`);
process.exit(failed.length ? 1 : 0);
