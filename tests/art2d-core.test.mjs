// node tests/art2d-core.test.mjs — unit tests for the pure 2D core (no browser needed).
import assert from 'node:assert/strict';
import { Rig, Player, SCHEMA, resolveOrder, frameTimes, setKey, sampleField, affCompose, affMul, affInv, easeU, meshSamples, remapDeformKeys, sampleDeform } from '../viewer/js/art2d/core.js';
import { planFit, canvasFit, footprintFit } from '../viewer/js/art2d/fitting.js';
import { gridMesh, checkMesh, addVertex, deleteVertex, autoWeights, smoothWeights, paintWeights, normalizeWeights } from '../viewer/js/art2d/mesh.js';
import { writeZip, readZip, textOf } from '../viewer/js/art2d/zip.js';
import { validateProject, computeInverseBinds, runtimeSubset, stringifyProject } from '../viewer/js/art2d/schema.js';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

function toyProject() {
  // arm: shoulder at (0,100) pointing right, elbow at (100,100), hand at (180,100)
  const w = 200, h = 40;
  const alpha = new Uint8Array(w * h).fill(255);
  const mesh = gridMesh(alpha, w, h, { cell: 20 });
  const p = {
    schema: SCHEMA, characterId: 'toy', axes: { x: 'right', y: 'up', units: 'px' }, referenceHeightPx: 200,
    bones: [
      { id: 'root', parent: null, setup: { x: 0, y: 0, rotation: 0 } },
      { id: 'upper', parent: 'root', setup: { x: 0, y: 100, rotation: 0 }, length: 100 },
      { id: 'lower', parent: 'upper', setup: { x: 100, y: 0, rotation: 0 }, length: 80 },
      { id: 'hand', parent: 'lower', setup: { x: 80, y: 0, rotation: 0 }, length: 20 },
      { id: 'sock', parent: 'hand', setup: { x: 10, y: 0, rotation: 0 } },
      { id: 'target', parent: 'root', setup: { x: 150, y: 150, rotation: 0 } },
    ],
    slots: [{ id: 'arm', bone: 'upper', attachment: 'arm.default' }, { id: 'hand', bone: 'hand', attachment: 'hand.default' }],
    images: { img_arm: { path: 'images/arm.png', w, h }, img_hand: { path: 'images/hand.png', w: 20, h: 20 } },
    attachments: {
      'arm.default': { id: 'arm.default', slot: 'arm', bone: 'upper', image: 'img_arm', imageScale: 1, pivot: [0, 20],
        transform: { x: 0, y: 0, rotation: 0 }, vertices: mesh.vertices, triangles: mesh.triangles, weights: null },
      'hand.default': { id: 'hand.default', slot: 'hand', bone: 'hand', image: 'img_hand', imageScale: 1, pivot: [0, 10],
        transform: { x: 0, y: 0, rotation: 0 }, vertices: [0, 0, 20, 0, 20, 20, 0, 20], triangles: [0, 1, 2, 0, 2, 3], weights: null },
    },
    constraints: [{ id: 'ik', type: 'ik2', order: 1, bones: ['upper', 'lower'], end: 'hand', effector: 'sock', target: { bone: 'target', point: [0, 0] }, mix: 0 }],
    clips: [{ name: 'bend', duration: 1, loop: true, fps: 30,
      tracks: { bones: { lower: { rotate: { t: [0, 0.5, 1], v: [0, 90, 0] } } }, slots: {}, drawOrder: { t: [0.5], v: [['hand', 'arm']] }, deform: {},
        events: [{ t: 0, name: 'start' }, { t: 0.5, name: 'mid' }] },
      corrections: { bones: {}, slots: {}, drawOrder: { t: [], v: [] }, deform: {}, events: [] } }],
  };
  // weights: blend across the elbow (x in 80..120 image px)
  const pts = [];
  for (let v = 0; v < mesh.vertices.length / 2; v++) pts.push(mesh.vertices[v * 2], 100 + 20 - mesh.vertices[v * 2 + 1]);
  p.attachments['arm.default'].weights = autoWeights(pts, [{ id: 'upper', head: [0, 100], tail: [100, 100] }, { id: 'lower', head: [100, 100], tail: [180, 100] }]);
  return computeInverseBinds(p);
}

await test('bind pose reproduces the mesh exactly', () => {
  const p = toyProject(), rig = new Rig(p), pose = rig.evaluate(null, 0);
  const out = rig.skinAttachment('arm.default', pose), r = rig.attachments.get('arm.default');
  let err = 0; for (let i = 0; i < out.length; i++) err = Math.max(err, Math.abs(out[i] - r.bind[i]));
  assert.ok(err < 1e-4, `bind error ${err}`);
});
await test('inverse binds and weights validate', () => {
  const p = toyProject();
  const v = validateProject(p, { images: new Set(['images/arm.png', 'images/hand.png']) });
  assert.deepEqual(v.errors, []);
  for (const l of p.attachments['arm.default'].weights) {
    const s = l.filter((_, i) => i % 2).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(s - 1) < 1e-5 && l.length <= 8);
  }
});
await test('validation reports missing images and wrong version', () => {
  const p = toyProject();
  assert.ok(validateProject(p, { images: new Set() }).errors.some((e) => e.includes('missing image file images/arm.png')));
  const q = { ...p, schema: 'gamboligy.character2d/2.0' };
  assert.ok(validateProject(q).errors.some((e) => e.includes('unsupported schema version 2.0')));
});
await test('bending the elbow rotates the hand and deforms the blend region', () => {
  const rig = new Rig(toyProject());
  rig.evaluate('bend', 0.5);
  const hand = rig.worldPoint('hand');
  assert.ok(Math.abs(hand[0] - 100) < 1e-6 && Math.abs(hand[1] - 180) < 1e-6, `hand at ${hand}`);
});
await test('evaluation is deterministic (seek == play) and finite', () => {
  const rig = new Rig(toyProject());
  const a = Array.from(rig.skinAttachment('arm.default', rig.evaluate('bend', 0.37)));
  rig.evaluate('bend', 0.9);
  const b = Array.from(rig.skinAttachment('arm.default', rig.evaluate('bend', 0.37)));
  assert.deepEqual(a, b);
  assert.ok(a.every(Number.isFinite));
});
await test('planar IK reaches a reachable target and keeps lengths; reports unreachable', () => {
  const rig = new Rig(toyProject());
  const pose = rig.evaluate(null, 0, { constraints: { ik: 1 } });
  assert.ok(pose.contacts[0].error < 1e-6, `error ${pose.contacts[0].error}`);
  const A = rig.worldPoint('upper'), B = rig.worldPoint('lower'), C = rig.worldPoint('hand');
  assert.ok(Math.abs(Math.hypot(B[0] - A[0], B[1] - A[1]) - 100) < 1e-6 && Math.abs(Math.hypot(C[0] - B[0], C[1] - B[1]) - 80) < 1e-6);
  const p = toyProject(); p.bones.find((b) => b.id === 'target').setup = { x: 900, y: 0, rotation: 0 };
  const far = new Rig(p).evaluate(null, 0, { constraints: { ik: 1 } });
  assert.equal(far.contacts[0].reachable, false);
});
await test('draw order keys and completion of stale orders', () => {
  const rig = new Rig(toyProject());
  assert.deepEqual(rig.evaluate('bend', 0.2).drawOrder, [0, 1]);
  assert.deepEqual(rig.evaluate('bend', 0.6).drawOrder, [1, 0]);
  assert.deepEqual(resolveOrder(['c', 'a'], ['a', 'b', 'c']), ['c', 'a', 'b']);
});
await test('events fire on crossing, wrap on loop, never on seek', () => {
  const rig = new Rig(toyProject()), pl = new Player(rig), got = [];
  pl.on((e) => got.push(e.name));
  pl.play('bend');                      // 'start' at t=0
  pl.update(0.4); pl.update(0.2);       // crosses 0.5 -> 'mid'
  pl.seek(0.1); pl.update(0.3);         // no event in (0.1, 0.4]
  pl.update(0.8);                       // 0.4 -> 1.2: mid, wrap (start), then nothing
  assert.deepEqual(got, ['start', 'mid', 'mid', 'start']);
});
await test('frame times never duplicate a loop endpoint', () => {
  assert.equal(frameTimes(1, 30, true).length, 30);
  assert.equal(frameTimes(1, 30, false).length, 31);
});
await test('keys insert, replace and sample', () => {
  const tr = { t: [], v: [] };
  setKey(tr, 0, { v: 0 }); setKey(tr, 1, { v: 10 }); setKey(tr, 0.5, { v: 2 }); setKey(tr, 0.5, { v: 4 });
  assert.deepEqual(tr.t, [0, 0.5, 1]); assert.equal(sampleField(tr, 'v', 0.25), 2);
});
await test('grid mesh covers concave alpha without transparent blocks or flipped triangles', () => {
  const w = 100, h = 100, a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 30 || y > 70) a[y * w + x] = 255;   // L shape
  const m = gridMesh(a, w, h, { cell: 10, margin: 0 });
  assert.ok(checkMesh(m.vertices, m.triangles).ok);
  // no triangle may cover the empty corner (x>40, y<60)
  for (let i = 0; i < m.triangles.length; i += 3) {
    const cx = (m.vertices[m.triangles[i] * 2] + m.vertices[m.triangles[i + 1] * 2] + m.vertices[m.triangles[i + 2] * 2]) / 3;
    const cy = (m.vertices[m.triangles[i] * 2 + 1] + m.vertices[m.triangles[i + 1] * 2 + 1] + m.vertices[m.triangles[i + 2] * 2 + 1]) / 3;
    assert.ok(!(cx > 40 && cy < 60), 'triangle over transparent corner');
  }
});
await test('mesh edits keep a valid mesh and weights', () => {
  const alpha = new Uint8Array(60 * 60).fill(255);
  const m = gridMesh(alpha, 60, 60, { cell: 20 });
  m.weights = m.vertices.filter((_, i) => i % 2 === 0).map(() => ['a', 0.5, 'b', 0.5]);
  const v = addVertex(m, 25, 25);
  assert.ok(v >= 0 && checkMesh(m.vertices, m.triangles).ok && m.weights.length === m.vertices.length / 2);
  assert.ok(deleteVertex(m, v) && checkMesh(m.vertices, m.triangles).ok && m.weights.length === m.vertices.length / 2);
  const changed = paintWeights(m, 'a', 30, 30, 25, 0.5, 'add', new Set([0]));
  assert.ok(changed.length > 0 && !changed.includes(0));
  const n = normalizeWeights(smoothWeights(m.weights, m.triangles));
  for (const l of n) assert.ok(Math.abs(l.filter((_, i) => i % 2).reduce((s, x) => s + x, 0) - 1) < 1e-4);
});
await test('zip round-trip keeps names and bytes', async () => {
  const files = [{ name: 'character.json', data: '{"a":1}' }, { name: 'images/x.png', data: new Uint8Array([1, 2, 3, 250]) }];
  const back = await readZip(writeZip(files));
  assert.equal(textOf(back.get('character.json')), '{"a":1}');
  assert.deepEqual(Array.from(back.get('images/x.png')), [1, 2, 3, 250]);
});
await test('runtime subset validates as a runtime package', () => {
  const r = runtimeSubset(toyProject());
  assert.deepEqual(validateProject(r, { runtime: true }).errors, []);
});
await test('hand view sets swap palm + fingers together; corrections win; skins still apply', () => {
  const p = toyProject();
  p.images.img_hand_palm = { path: 'images/hand_palm.png', w: 20, h: 20 };
  p.attachments['hand.palm'] = { ...p.attachments['hand.default'], id: 'hand.palm', image: 'img_hand_palm' };
  p.attachments['hand.painted'] = { ...p.attachments['hand.default'], id: 'hand.painted' };
  p.handViews = { L: { sets: { open_back: { view: 'back', pose: 'open', slots: { hand: 'hand.default' } }, open_palm: { view: 'palm', pose: 'open', slots: { hand: 'hand.palm' } } } } };
  p.clips[0].tracks.handSets = { L: { t: [0, 0.6], v: ['open_back', 'open_palm'] } };
  const rig = new Rig(p), at = (t, o) => rig.evaluate('bend', t, o).slotAttachment[rig.slotIndex.get('hand')];
  assert.equal(at(0.2), 'hand.default');
  assert.equal(at(0.7), 'hand.palm');
  p.clips[0].corrections.handSets = { L: { t: [0.65], v: ['open_back'] } };
  assert.equal(at(0.7), 'hand.default', 'correction key overrides the baked set');
  assert.equal(at(0.7, { handSets: { L: 'open_palm' } }), 'hand.palm', 'explicit override wins');
  p.skins = [{ id: 'default' }, { id: 'painted', replace: { 'hand.default': 'hand.painted' } }]; rig.rebuild(); rig.setSkin('painted');
  assert.equal(at(0.2), 'hand.painted', 'skin replacement applies to the set attachment');
  assert.deepEqual(validateProject(p).errors, []);
  p.clips[0].tracks.handSets.L.v[1] = 'nope';
  assert.ok(validateProject(p).errors.some((e) => /hand set nope/.test(e)));
});
await test('easing per key (step keeps impacts crisp) and disabled corrections', () => {
  const tr = { t: [0, 1], v: [0, 10], ease: ['smooth', 'linear'] };
  assert.equal(sampleField(tr, 'v', 0.5), 5);
  assert.ok(Math.abs(sampleField(tr, 'v', 0.25) - 10 * easeU(tr, 0, 0.25)) < 1e-9 && sampleField(tr, 'v', 0.25) < 2.5);
  tr.ease[0] = 'step'; assert.equal(sampleField(tr, 'v', 0.99), 0); assert.equal(sampleField(tr, 'v', 1), 10);
  setKey(tr, 0.5, { v: 3 }); assert.equal(tr.ease.length, tr.t.length);
  const p = toyProject(), rig = new Rig(p);
  p.clips[0].corrections.bones.lower = { rotate: { t: [0], v: [30] } };
  rig.evaluate('bend', 0); const on = rig.worldRot[rig.boneIndex.get('lower')];
  p.clips[0].corrections.bones.lower.disabled = true;
  rig.evaluate('bend', 0); const off = rig.worldRot[rig.boneIndex.get('lower')];
  assert.ok(Math.abs(on - off - 30) < 1e-9, 'disabled correction is ignored, data kept');
  p.clips[0].corrections.deform = { 'arm.default': { t: [0], v: [[1, 2]] } };
  assert.ok(validateProject(p).errors.some((e) => /deform key 0 of arm.default/.test(e)), 'deform keys that no longer match the mesh are reported');
});

// ---- importer regressions: re-meshed art, replacement art, proportion placement
const field = (x, y) => [0.1 * x - 3, 0.05 * y + 2];               // linear offset field: barycentric remap is exact
const fieldKey = (rig, id) => { const b = rig.attachments.get(id).bind, v = []; for (let i = 0; i < b.length; i += 2) v.push(...field(b[i], b[i + 1]).map((x) => +x.toFixed(3))); return v; };
const finite = (rig, id, pose) => Array.from(rig.skinAttachment(id, pose)).every(Number.isFinite);

await test('re-meshing an animated mesh remaps every deformation key (no stale vertex counts), through save and runtime', () => {
  const p = toyProject(), id = 'arm.default';
  const rig0 = new Rig(p), old = { bind: Float64Array.from(rig0.attachments.get(id).bind), tris: p.attachments[id].triangles.slice() };
  p.clips[0].tracks.deform = { [id]: { t: [0, 1], v: [fieldKey(rig0, id), fieldKey(rig0, id).map((x) => x * 2)] } };
  p.clips[0].corrections.deform = { [id]: { t: [0.5], v: [fieldKey(rig0, id).map((x) => -x)], ease: ['smooth'] } };
  const n0 = p.attachments[id].vertices.length / 2;
  const fine = gridMesh(new Uint8Array(200 * 40).fill(255), 200, 40, { cell: 7 });     // the same art at a higher mesh density
  p.attachments[id].vertices = fine.vertices; p.attachments[id].triangles = fine.triangles; p.attachments[id].weights = null;
  const rig1 = new Rig(p), n1 = p.attachments[id].vertices.length / 2;
  assert.ok(n1 > n0 * 2, `denser mesh (${n0} → ${n1} vertices)`);
  assert.ok(validateProject(p).errors.some((e) => /mesh edited without remapping keys/.test(e)), 'stale keys are detected before the remap');
  assert.equal(remapDeformKeys(p, id, meshSamples(old.bind, old.tris, rig1.attachments.get(id).bind)), 2, 'bake and correction tracks remapped');
  const want = fieldKey(rig1, id), got = p.clips[0].tracks.deform[id].v[0];
  assert.equal(got.length, n1 * 2);
  for (let i = 0; i < got.length; i++) assert.ok(Math.abs(got[i] - want[i]) < 2e-3, 'linear offsets are reproduced exactly at the new vertices');
  assert.deepEqual(p.clips[0].corrections.deform[id].ease, ['smooth'], 'easing kept');
  assert.equal(validateProject(p).errors.length, 0);
  // save (project JSON) and runtime subset keep the remapped keys; poses are identical and finite
  const saved = JSON.parse(stringifyProject(p)), rt = JSON.parse(JSON.stringify(runtimeSubset(p)));
  for (const q of [saved, rt]) {
    const r = new Rig(q), a = r.evaluate('bend', 0.3), b = rig1.evaluate('bend', 0.3);
    assert.ok(finite(r, id, a));
    assert.deepEqual(Array.from(r.skinAttachment(id, a)), Array.from(rig1.skinAttachment(id, b)));
  }
});

await test('deformation keys made for another mesh are skipped and reported, never skinned into invalid coordinates', () => {
  const p = toyProject(), id = 'arm.default', rig = new Rig(p);
  const clean = Array.from(rig.skinAttachment(id, rig.evaluate('bend', 0.4)));
  p.clips[0].tracks.deform = { [id]: { t: [0], v: [new Array(213 * 2).fill(5)] } };   // 213-vertex keys on a different mesh
  const pose = rig.evaluate('bend', 0.4);
  assert.deepEqual(pose.deformSkipped, [id]);
  assert.ok(finite(rig, id, pose));
  assert.deepEqual(Array.from(rig.skinAttachment(id, pose)), clean, 'mesh drawn undeformed instead of with garbage offsets');
});

await test('replacement art plays the deformation of the piece it replaces (deformFrom): resampled, additive, chained, validated', () => {
  const p = toyProject(), A = 'arm.default';
  const fine = gridMesh(new Uint8Array(200 * 40).fill(255), 200, 40, { cell: 9 });
  p.attachments['arm.painted'] = { ...structuredClone(p.attachments[A]), id: 'arm.painted', vertices: fine.vertices, triangles: fine.triangles, weights: null, deformFrom: A };
  p.attachments['arm.v3'] = { ...structuredClone(p.attachments['arm.painted']), id: 'arm.v3', deformFrom: 'arm.painted' };
  p.skins = [{ id: 'default' }, { id: 'painted', replace: { [A]: 'arm.painted' } }];
  const rig = new Rig(p); rig.setSkin('painted');
  p.clips[0].tracks.deform = { [A]: { t: [0], v: [fieldKey(rig, A)] } };
  let pose = rig.evaluate('bend', 0.2);
  const want = fieldKey(rig, 'arm.painted'), got = Array.from(pose.deform.get('arm.painted'));
  assert.equal(got.length, want.length);
  for (let i = 0; i < got.length; i++) assert.ok(Math.abs(got[i] - want[i]) < 2e-3, 'painted mesh receives the starter offsets at its own vertices');
  assert.equal(pose.slotAttachment[rig.slotIndex.get('arm')], 'arm.painted');
  assert.ok(finite(rig, 'arm.painted', pose));
  // own keys on the replacement add on top; chains resolve source-first
  p.clips[0].corrections.deform = { 'arm.painted': { t: [0], v: [new Array(want.length).fill(1)] } };
  pose = rig.evaluate('bend', 0.2);
  const own = Array.from(pose.deform.get('arm.painted')), chained = Array.from(pose.deform.get('arm.v3'));
  for (let i = 0; i < own.length; i++) { assert.ok(Math.abs(own[i] - want[i] - 1) < 2e-3); assert.ok(Math.abs(chained[i] - own[i]) < 2e-3); }
  // survives save and runtime export (deformFrom is part of the attachment)
  const r2 = new Rig(JSON.parse(JSON.stringify(runtimeSubset(p)))); r2.setSkin('painted');
  assert.deepEqual(Array.from(r2.evaluate('bend', 0.2).deform.get('arm.painted')), own);
  assert.deepEqual(validateProject(p).errors, []);
  // validation: missing source, self reference, loops
  p.attachments['arm.v3'].deformFrom = 'arm.v3'; assert.ok(validateProject(p).errors.some((e) => /arm.v3: deformFrom/.test(e)));
  p.attachments['arm.v3'].deformFrom = 'nope'; assert.ok(validateProject(p).errors.some((e) => /arm.v3: deformFrom "nope"/.test(e)));
  p.attachments['arm.v3'].deformFrom = 'arm.painted'; p.attachments[A].deformFrom = 'arm.v3';
  assert.ok(validateProject(p).errors.some((e) => /chain loops/.test(e)));
});

await test('proportion fitting keeps the layers.json position and rotation (replace mode reports a disagreeing placement)', () => {
  const p = toyProject(), rig = new Rig(p);
  const reg = { origin: [1000, 1000], scale: 0.5, canvas: { w: 2000, h: 2000 } };
  const def = { file: 'arm.png', target: 'arm.default', x: 1040, y: 760, rotation: 12, mode: 'proportion' };
  const img = { width: 200, height: 40, data: new Uint8ClampedArray(200 * 40 * 4) };
  const s1 = planFit(p, { registration: reg, layers: [{ file: 'arm.png', def, bytes: null, image: img }] }, { skin: 'painted' });
  const L = s1.layers[0], want = canvasFit(reg, def, 200, 40);
  assert.equal(L.mode, 'proportion');
  for (const k of ['x', 'y', 'rotation', 'scale']) assert.ok(Math.abs(L.fit[k] - want[k]) < 1e-9, `proportion keeps layers.json ${k}`);
  assert.ok(Math.abs(L.fit.rotation - 12) < 1e-9 && L.fit.x !== footprintFit(p, rig, 'arm.default', 200, 40).x);
  const s2 = planFit(p, { registration: reg, layers: [{ file: 'arm.png', def: { ...def, mode: 'replace' }, bytes: null, image: img }] }, { skin: 'painted' });
  const fp = footprintFit(p, rig, 'arm.default', 200, 40);
  assert.ok(Math.abs(s2.layers[0].fit.x - fp.x) < 1e-9, 'replace mode keeps the replaced footprint');
  assert.match(s2.layers[0].placementNote || '', /choose proportion to keep the layers.json placement/);
});

await test('a valid deformation key followed by a shorter one: both keys are validated before interpolating (213 + 212 vertex keys)', () => {
  const p = toyProject();
  // a 213-vertex cape: 71 × 3 vertex strip on the upper bone
  const V = [], T = []; for (let i = 0; i < 71; i++) for (let j = 0; j < 3; j++) V.push(i * 2, j * 10);
  for (let i = 0; i < 70; i++) for (let j = 0; j < 2; j++) { const a = i * 3 + j, b = a + 3; T.push(a, b, a + 1, b, b + 1, a + 1); }
  p.images.img_cape = { path: 'images/cape.png', w: 142, h: 21 };
  p.attachments['cape.default'] = { id: 'cape.default', slot: 'cape', bone: 'upper', image: 'img_cape', imageScale: 1, pivot: [0, 0], transform: { x: 0, y: 0, rotation: 0 }, vertices: V, triangles: T, weights: null };
  p.slots.push({ id: 'cape', bone: 'upper', attachment: 'cape.default' });
  const n = 213 * 2, good = new Array(n).fill(2), short = new Array(212 * 2).fill(2), nan = good.map((x, i) => (i === 7 ? NaN : x));
  assert.equal(V.length, n);
  const rig = new Rig(p), clean = Array.from(rig.skinAttachment('cape.default', rig.evaluate('bend', 0.5)));
  const at = (t, keys, times) => { p.clips[0].tracks.deform = { 'cape.default': { t: times, v: keys } }; return rig.evaluate('bend', t); };
  // the reported case: halfway between a 213- and a 212-vertex key
  let pose = at(0.5, [good, short], [0, 1]);
  assert.deepEqual(pose.deformSkipped, ['cape.default']);
  assert.deepEqual(pose.deformIssues[0].keys.map((k) => [k.index, k.floats / 2]), [[1, 212]], 'the malformed key is named with its vertex count');
  assert.equal(pose.deformIssues[0].expected, n);
  let v = Array.from(rig.skinAttachment('cape.default', pose));
  assert.ok(v.every(Number.isFinite), 'no invalid coordinates');
  assert.deepEqual(v, clean, 'malformed segment skipped: mesh drawn undeformed');
  // malformed first key, non-numeric offsets, and clamped single keys are all caught
  for (const [keys, times, t] of [[[short, good], [0, 1], 0.5], [[good, nan], [0, 1], 0.5], [[short], [0], 0.5], [[good, short], [0, 1], 2]]) {
    pose = at(t, keys, times); assert.ok(pose.deformSkipped?.includes('cape.default')); assert.ok(Array.from(rig.skinAttachment('cape.default', pose)).every(Number.isFinite));
  }
  // a valid segment next to a malformed one still plays; only the malformed segment is skipped
  pose = at(0.25, [good, good.map((x) => x * 3), short], [0, 0.5, 1]);
  assert.equal(pose.deformSkipped, undefined);
  assert.ok(Math.abs(pose.deform.get('cape.default')[0] - 4) < 1e-9, 'interpolated halfway between 2 and 6');
  assert.ok(at(0.75, [good, good.map((x) => x * 3), short], [0, 0.5, 1]).deformSkipped.includes('cape.default'));
  // the sampler reports without interpolating; validation names the bad keys
  assert.deepEqual(sampleDeform({ t: [0, 1], v: [good, short] }, 0.5, n), { bad: [1] });
  p.clips[0].tracks.deform = { 'cape.default': { t: [0, 1, 2], v: [good, short, nan] } };
  const errs = validateProject(p).errors.join('\n');
  assert.match(errs, /deform key 1 of cape.default has 212 vertices but the mesh has 213/);
  assert.match(errs, /deform key 2 of cape.default contains non-numeric offsets/);
});
console.log(`${passed} tests passed`);
