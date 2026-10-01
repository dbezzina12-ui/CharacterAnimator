// node tests/art2d-core.test.mjs — unit tests for the pure 2D core (no browser needed).
import assert from 'node:assert/strict';
import { Rig, Player, SCHEMA, resolveOrder, frameTimes, setKey, sampleField, affCompose, affMul, affInv, easeU } from '../viewer/js/art2d/core.js';
import { gridMesh, checkMesh, addVertex, deleteVertex, autoWeights, smoothWeights, paintWeights, normalizeWeights } from '../viewer/js/art2d/mesh.js';
import { writeZip, readZip, textOf } from '../viewer/js/art2d/zip.js';
import { validateProject, computeInverseBinds, runtimeSubset } from '../viewer/js/art2d/schema.js';

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
console.log(`${passed} tests passed`);
