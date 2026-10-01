// Starter skin: builds an editable gamboligy.character2d project from a loaded 3D character.
// Every slot is rendered on its own (hidden portions included) from the fixed art camera, registered
// against the projected bind pose, meshed from its alpha and weighted from the 3D skin weights. Pose-
// specific hand art is captured for prop clips, and every 3D clip is baked through the bridge.
// The result is LABELLED as derived from the 3D model; painted replacement layers inherit its binding.
import * as THREE from 'three';
import { SCHEMA, Rig, affCompose, affInv, affMul, affDecompose, wrapDeg } from './core.js';
import { ArtCamera, Bridge, reduceKeys, axisOf } from './bridge3d.js';
import { Occlusion, solveOrder } from './occlusion.js';
import { gridMesh, bleedEdges, pruneWeights } from './mesh.js';
import { computeInverseBinds } from './schema.js';
import { PROP_AXES, SUPPORT_CLIPS } from './specs.js';
import { suggestHandSets } from './handviews.js';

const FPS = 30;
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const POSES_2D = ['open', 'relaxed', 'fist'];
/**
 * How much of the PALM faces the camera: +1 palm, -1 back of the hand. The palm normal is
 * (wrist→middle knuckle) × (pinky→index knuckle), signed so that in the bind A-pose it points toward the
 * body midline (palms face the thighs).
 */
function palmFacing(ch, cam, s, signs) {
  const P = (n) => ch.bones[n] && new THREE.Vector3().setFromMatrixPosition(ch.bones[n].matrixWorld);
  const H = P(`hand_${s}`), M = P(`middle_01_${s}`), I = P(`index_01_${s}`), K = P(`pinky_01_${s}`); if (!H || !M || !I || !K) return 0;
  const n = M.clone().sub(H).cross(I.clone().sub(K)).normalize();
  if (signs[s] === undefined) { const mid = new THREE.Vector3(-Math.sign(H.x || 1), 0, 0); signs[s] = n.dot(mid) >= 0 ? 1 : -1; return null; }
  const toCam = cam.f.clone().negate();
  return n.multiplyScalar(signs[s]).dot(toCam);
}
const r3 = (x) => +(+x).toFixed(3), r4 = (x) => +(+x).toFixed(4);

// ------------------------------------------------------------------ materials -------
const MASK_N = 128;
function boneMask(mesh, names) {
  const arr = new Float32Array(MASK_N);
  mesh.skeleton.bones.forEach((b, i) => { if (names.includes(b.name) && i < MASK_N) arr[i] = 1; });
  return arr;
}
/** Clone of a skinned mesh's material that discards fragments whose weight on `mask` bones < thr. */
function maskedMaterial(base, mask, thr) {
  const m = base.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGroup = { value: mask }; sh.uniforms.uThr = { value: thr };
    sh.vertexShader = `uniform float uGroup[${MASK_N}];\nvarying float vGroupW;\n` + sh.vertexShader.replace('#include <skinbase_vertex>',
      '#include <skinbase_vertex>\n vGroupW = uGroup[int(skinIndex.x)]*skinWeight.x + uGroup[int(skinIndex.y)]*skinWeight.y + uGroup[int(skinIndex.z)]*skinWeight.z + uGroup[int(skinIndex.w)]*skinWeight.w;');
    sh.fragmentShader = 'uniform float uThr;\nvarying float vGroupW;\n' + sh.fragmentShader.replace(/void main\(\)\s*\{/, 'void main() {\n if (vGroupW < uThr) discard;');
  };
  m.customProgramCacheKey = () => 'art2d-mask';
  return m;
}
/** Skin-weight map material: RGB = weight on the bones flagged in uR/uG/uB (group-masked like the art). */
function weightMaterial(skinned, r, g, b, mask, thr) {
  if (!skinned) return new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Vector3(r, g, b) } },
    vertexShader: '#include <common>\nvoid main(){\n#include <begin_vertex>\n#include <project_vertex>\n}',
    fragmentShader: 'uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0); }', blending: THREE.NoBlending });
  return new THREE.ShaderMaterial({
    uniforms: { uR: { value: r }, uG: { value: g }, uB: { value: b }, uGroup: { value: mask }, uThr: { value: thr } },
    vertexShader: `#include <common>
#include <skinning_pars_vertex>
uniform float uR[${MASK_N}]; uniform float uG[${MASK_N}]; uniform float uB[${MASK_N}]; uniform float uGroup[${MASK_N}];
varying vec3 vW; varying float vGroupW;
void main(){
#include <skinbase_vertex>
#include <begin_vertex>
#include <skinning_vertex>
#include <project_vertex>
 ivec4 i = ivec4(skinIndex);
 vW = vec3(dot(vec4(uR[i.x],uR[i.y],uR[i.z],uR[i.w]), skinWeight), dot(vec4(uG[i.x],uG[i.y],uG[i.z],uG[i.w]), skinWeight), dot(vec4(uB[i.x],uB[i.y],uB[i.z],uB[i.w]), skinWeight));
 vGroupW = dot(vec4(uGroup[i.x],uGroup[i.y],uGroup[i.z],uGroup[i.w]), skinWeight);
}`,
    fragmentShader: 'uniform float uThr; varying vec3 vW; varying float vGroupW; void main(){ if (vGroupW < uThr) discard; gl_FragColor = vec4(vW, 1.0); }',
    blending: THREE.NoBlending,
  });
}

// ------------------------------------------------------------------ stage -----------
/** Copies of the viewer's scene lights (lit materials render black without them; painted ones ignore them). */
function sceneLights(viewer) {
  const out = [];
  viewer.scene.traverse((o) => { if (o.isLight) { const c = o.clone(); o.updateMatrixWorld(true); c.position.setFromMatrixPosition(o.matrixWorld); if (o.target) { c.target = o.target.clone(); c.target.position.setFromMatrixPosition(o.target.matrixWorld); out.push(c.target); } c.castShadow = false; out.push(c); } });
  if (!out.some((o) => o.isLight)) out.push(new THREE.HemisphereLight(0xffffff, 0x404858, 2.2));
  return out;
}

class Stage {
  constructor(viewer) {
    this.v = viewer; this.r = viewer.renderer; this.scene = new THREE.Scene();
    for (const l of sceneLights(viewer)) this.scene.add(l);
    this.canvas = document.createElement('canvas'); this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }
  begin() {
    const ch = this.v.state.ch, r = this.r;
    this.saved = { parent: ch.root.parent, size: r.getSize(new THREE.Vector2()), pr: r.getPixelRatio(), cc: r.getClearColor(new THREE.Color()), ca: r.getClearAlpha(),
      vis: new Map() };
    ch.root.traverse((o) => { if (o.isMesh || o.isLine || o.isPoints) this.saved.vis.set(o, o.visible); });
    this.scene.add(ch.root);
  }
  end() {
    const ch = this.v.state.ch, r = this.r, s = this.saved;
    for (const [o, v] of s.vis) o.visible = v;
    s.parent.add(ch.root);
    r.setRenderTarget(null); r.setPixelRatio(s.pr); r.setSize(s.size.x, s.size.y, false); r.setClearColor(s.cc, s.ca);
  }
  /** Only these objects are drawn (plus nothing else in the character). */
  only(set) {
    this.v.state.ch.root.traverse((o) => {
      if (!o.isMesh && !o.isLine && !o.isPoints) return;
      if (!this.saved.vis.has(o)) this.saved.vis.set(o, o.visible);   // e.g. a prop attached after begin()
      o.visible = set.has(o);
    });
  }
  renderColor(cam, w, h) {
    const r = this.r;
    r.setRenderTarget(null); r.setPixelRatio(1); r.setSize(w, h, false); r.setClearColor(0x000000, 0);
    r.render(this.scene, cam);
    this.canvas.width = w; this.canvas.height = h;
    this.ctx.clearRect(0, 0, w, h); this.ctx.drawImage(r.domElement, 0, 0);
    return this.ctx.getImageData(0, 0, w, h);
  }
  renderRaw(cam, w, h) {
    const r = this.r, rt = new THREE.WebGLRenderTarget(w, h, { samples: 0, depthBuffer: true });
    r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.render(this.scene, cam);
    const buf = new Uint8Array(w * h * 4); r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    r.setRenderTarget(null); rt.dispose();
    const out = new Uint8Array(w * h * 4);                  // flip to top-down rows
    for (let y = 0; y < h; y++) out.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    return out;
  }
}

async function pngBytes(imgData) {
  const c = document.createElement('canvas'); c.width = imgData.width; c.height = imgData.height;
  c.getContext('2d').putImageData(imgData, 0, 0);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }

function trimAlpha(img, pad) {
  const { width: w, height: h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const tw = x1 - x0 + 1, th = y1 - y0 + 1, out = new ImageData(tw, th);
  for (let y = 0; y < th; y++) out.data.set(data.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x1 + 1) * 4), y * tw * 4);
  return { img: out, x: x0, y: y0 };
}

// ------------------------------------------------------------------ builder ---------
export async function buildStarterProject(viewer, spec, { write, log = () => {}, clips: onlyClips = null, fps = FPS } = {}) {
  const ch = viewer.state.ch, cfg = viewer.state.cfg, S = spec.sourceScale || 2;
  const ill = viewer.illustration;
  if (ill) { ill.enabled = !!spec.illustrated; ill.ink = !!spec.illustrated; ill.apply(); }
  ch.resetPose();
  const morphMeshes = []; ch.root.traverse((o) => { if (o.morphTargetInfluences && !o.userData.illustrationInk) morphMeshes.push(o); });
  const zeroMorphs = () => { for (const m of morphMeshes) m.morphTargetInfluences.fill(0); };
  zeroMorphs(); ch.root.updateMatrixWorld(true);
  const heightM = ch.height();
  const ppm = spec.referenceHeightPx / heightM;
  const cam = new ArtCamera({ ...spec.view, pixelsPerMeter: ppm });
  const bridge = new Bridge(viewer, cam);
  const defs = bridge.defineBones();
  const setupLocal = bridge.bindLocal(PROP_AXES.Sword2H);
  log(`${defs.length} bones, ${heightM.toFixed(3)} m -> ${ppm.toFixed(2)} px/m`);

  // ---------------- bones (+ 2D-only fingertip bones for contact work)
  const bones = defs.map((d, i) => {
    const s = setupLocal[i];
    return { id: d.id, parent: d.parent, kind: d.kind,
      setup: { x: r4(s.x), y: r4(s.y), rotation: r4(s.rotation), scaleX: r4(s.scaleX), scaleY: r4(s.scaleY) },
      length: r3(Math.max(4, d.length3d * (d.kind === 'prop' ? 1 : bridge.bindSamples[i].r1) * ppm)),
      source3d: { node: d.kind === 'prop' ? 'clip prop root' : d.id, axis: d.axis1, fallbackAxis: d.axis2, fallbackOffsetDeg: r3(d.offset),
        lengthM: r4(d.length3d), bindProjectedRatio: r4(bridge.bindSamples[i].r1), foreshorten: d.foreshorten } };
  });
  for (const s of ['L', 'R']) for (const f of FINGERS) {
    const b3 = bones.find((b) => b.id === `${f}_03_${s}`);
    if (b3) bones.push({ id: `${f}_tip_${s}`, parent: b3.id, kind: 'tip', setup: { x: b3.length, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, length: 2,
      source3d: null, note: '2D-only marker at the pad of the fingertip (contact fixtures, IK end)' });
  }
  const tmpProject = () => ({ schema: SCHEMA, characterId: spec.id, bones, slots: [], attachments: {}, images: {}, clips: [] });
  let rig = new Rig(tmpProject());
  const bindW = (id) => rig.bindWorld[rig.boneIndex.get(id)];

  // ---------------- mesh inventory
  const meshes = [];
  ch.root.traverse((o) => {
    if (!o.isMesh || o.userData.illustrationInk) return;
    let p = o.parent; while (p && !p.isBone) p = p.parent;
    meshes.push({ o, bone: p?.name, skinned: !!o.isSkinnedMesh, ink: ill?.records?.get(o)?.ink || null });
  });
  const select = (sl) => {
    if (sl.kind === 'skinned') {
      const list = meshes.filter((m) => m.skinned && sl.parts.includes(m.o.name));
      if (sl.plates) list.push(...meshes.filter((m) => !m.skinned && sl.mask.includes(m.bone)));
      return list;
    }
    return meshes.filter((m) => !m.skinned && sl.bones.includes(m.bone) && (!sl.name || sl.name.test(m.o.name)) && !(sl.exclude && sl.exclude.test(m.o.name)));
  };

  const stage = new Stage(viewer);
  const images = {}, attachments = {}, slots = [], slotGeometry = new Map();
  const writeImage = async (id, imgData) => {
    bleedEdges(imgData.data, imgData.width, imgData.height, 3);
    const bytes = await pngBytes(imgData), path = `images/${id}.png`;
    await write(path, b64(bytes));
    images[id] = { path, w: imgData.width, h: imgData.height, bytes: bytes.length };
  };

  /** Posed world-space vertices (optionally only those weighted to the slot's mask). */
  function worldVerts(list, sl) {
    const pts = [], v = new THREE.Vector3();
    for (const m of list) {
      const pos = m.o.geometry.attributes.position, sw = m.o.geometry.attributes.skinWeight, si = m.o.geometry.attributes.skinIndex;
      const maskNames = m.skinned && sl?.mask ? new Set(sl.mask) : null;
      for (let i = 0; i < pos.count; i++) {
        if (maskNames) {
          let w = 0; for (let k = 0; k < 4; k++) if (maskNames.has(m.o.skeleton.bones[si.getComponent(i, k)]?.name)) w += sw.getComponent(i, k);
          if (w < (sl.thr ?? 0.35) - 0.1) continue;
        }
        if (m.skinned) m.o.getVertexPosition(i, v).applyMatrix4(m.o.matrixWorld);
        else v.fromBufferAttribute(pos, i).applyMatrix4(m.o.matrixWorld);
        pts.push(v.clone());
      }
    }
    return pts;
  }
  function bbox2D(pts, marginPx) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { const q = cam.project(p); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    return [Math.floor(x0 - marginPx), Math.floor(y0 - marginPx), Math.ceil(x1 + marginPx), Math.ceil(y1 + marginPx)];
  }
  function withMaterials(list, sl, fn) {
    const saved = [];
    for (const m of list) if (m.skinned && sl.mask) {
      const mask = boneMask(m.o, sl.mask);
      saved.push([m.o, m.o.material]); m.o.material = maskedMaterial(m.o.material, mask, sl.thr ?? 0.35);
      if (m.ink) { saved.push([m.ink, m.ink.material]); m.ink.material = maskedMaterial(m.ink.material, mask, sl.thr ?? 0.35); }
    }
    try { return fn(); } finally { for (const [o, mat] of saved) { if (o.material !== mat) o.material.dispose(); o.material = mat; } }
  }

  /** Render one layer: returns {img (trimmed ImageData), x0, yTop (project px of the trimmed image), full rect}. */
  function renderLayer(list, sl) {
    const pts = worldVerts(list, sl);
    if (!pts.length) return null;
    const [x0, y0, x1, y1] = bbox2D(pts, 0.012 * ppm + 3);
    const w = Math.ceil((x1 - x0) * S), h = Math.ceil((y1 - y0) * S);
    const cam3 = cam.threeCamera(x0, y1 - h / S, x0 + w / S, y1);
    const vis = new Set(); for (const m of list) { vis.add(m.o); if (m.ink && ill?.ink) vis.add(m.ink); }
    stage.only(vis);
    const full = withMaterials(list, sl, () => stage.renderColor(cam3, w, h));
    const tr = trimAlpha(full, 3);
    if (!tr) return null;
    return { img: tr.img, x0: x0 + tr.x / S, yTop: y1 - tr.y / S, rect: { x0, y1, w, h, tx: tr.x, ty: tr.y }, cam3, pts };
  }

  /** 3D skin weights sampled at the mesh vertices (image px of the trimmed image). */
  function sampleWeights(list, sl, layer, vertices, cell) {
    const names = new Set();
    for (const m of list) {
      if (!m.skinned) { names.add(m.bone); continue; }
      const si = m.o.geometry.attributes.skinIndex, sw = m.o.geometry.attributes.skinWeight;
      for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > 0.02) names.add(m.o.skeleton.bones[si.getComponent(i, k)].name);
    }
    const bonesList = [...names].filter((n) => rig.boneIndex.has(n));
    const { w, h, tx, ty } = layer.rect, cam3 = layer.cam3;
    const maps = [];
    for (let k = 0; k < bonesList.length; k += 3) {
      const trio = bonesList.slice(k, k + 3);
      const saved = [];
      for (const m of list) {
        saved.push([m.o, m.o.material]);
        if (m.skinned) {
          const arr = trio.map((n) => { const a = new Float32Array(MASK_N); m.o.skeleton.bones.forEach((b, i) => { if (b.name === n) a[i] = 1; }); return a; });
          while (arr.length < 3) arr.push(new Float32Array(MASK_N));
          const mask = sl.mask ? boneMask(m.o, sl.mask) : new Float32Array(MASK_N).fill(1);
          m.o.material = weightMaterial(true, arr[0], arr[1], arr[2], mask, sl.mask ? (sl.thr ?? 0.35) : -1);
        } else m.o.material = weightMaterial(false, ...trio.map((n) => (n === m.bone ? 1 : 0)).concat([0, 0, 0]).slice(0, 3));
      }
      stage.only(new Set(list.map((m) => m.o)));
      maps.push({ trio, px: stage.renderRaw(cam3, w, h) });
      for (const [o, mat] of saved) { o.material.dispose(); o.material = mat; }
    }
    const covered = (x, y) => maps.length && maps[0].px[(y * w + x) * 4 + 3] > 0;
    const weights = [];
    for (let v = 0; v < vertices.length / 2; v++) {
      let x = Math.min(w - 1, Math.max(0, Math.round(vertices[v * 2] + tx))), y = Math.min(h - 1, Math.max(0, Math.round(vertices[v * 2 + 1] + ty)));
      if (!covered(x, y)) {                               // nearest covered pixel (ring search)
        let found = null;
        for (let r = 1; r <= cell * 3 && !found; r++) for (let dy = -r; dy <= r && !found; dy++) for (const dx of [-r, r]) {
          const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && covered(X, Y)) { found = [X, Y]; break; }
        }
        if (!found) for (let r = 1; r <= cell * 3 && !found; r++) for (let dx = -r; dx <= r && !found; dx++) for (const dy of [-r, r]) {
          const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && covered(X, Y)) { found = [X, Y]; break; }
        }
        if (found) [x, y] = found;
      }
      const acc = new Map();
      for (const mp of maps) mp.trio.forEach((n, c) => { const val = mp.px[(y * w + x) * 4 + c] / 255; if (val > 0) acc.set(n, (acc.get(n) || 0) + val); });
      const l = pruneWeights(acc);
      weights.push(l.length ? l : [sl.bone, 1]);
    }
    return weights;
  }

  /** Attachment from a rendered layer; `frame` = 2D world transform of `bone` the art is registered to. */
  async function addAttachment({ slot, name, bone, layer, weighted = null, frame = null, source, markers = null, mesh = null }) {
    const id = `${slot}.${name}`, imgId = `${slot}__${name}`;
    await writeImage(imgId, layer.img);
    const w = layer.img.width, h = layer.img.height;
    const cell = Math.max(14, Math.min(48, Math.round(Math.max(w, h) / 9)));
    const alpha = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) alpha[i] = layer.img.data[i * 4 + 3];
    const m = mesh || gridMesh(alpha, w, h, { cell, threshold: 6, margin: 2 });
    const pivot = [w / 2, h / 2], pw = [layer.x0 + w / 2 / S, layer.yTop - h / 2 / S];
    const F = frame || bindW(bone);
    const T = affDecompose(affMul(affInv(F), affCompose(pw[0], pw[1], 0, 1, 1)));
    const weights = weighted ? weighted(m.vertices, cell) : null;
    attachments[id] = { id, name: `${slot} (${name})`, slot, type: weights ? 'mesh' : 'region', bone, image: imgId, imageScale: 1 / S,
      pivot, transform: { x: r4(T.x), y: r4(T.y), rotation: r4(T.rotation), scaleX: r4(T.scaleX), scaleY: r4(T.scaleY), mirror: false },
      registration: { sourceRect: [layer.rect.x0, layer.rect.y1, layer.rect.w, layer.rect.h], trim: [layer.rect.tx, layer.rect.ty], scale: S },
      vertices: m.vertices, triangles: m.triangles, weights, visible: true, opacity: 1, tint: [1, 1, 1], blend: 'normal',
      view: spec.view.id, markers, source };
    return id;
  }

  // ---------------- default skin (bind pose)
  stage.begin();
  try {
    ch.resetPose(); zeroMorphs(); ch.root.updateMatrixWorld(true);
    for (const sl of spec.slots) {
      sl.bone ||= sl.bones?.[0];
      if (sl.kind === 'prop') { slots.push({ id: sl.id, name: 'Right-hand prop', bone: sl.bone, attachment: null, group: sl.group, color: [1, 1, 1, 1] }); continue; }
      const list = select(sl);
      if (!list.length) { log(`slot ${sl.id}: no geometry, skipped`); continue; }
      const layer = renderLayer(list, sl);
      if (!layer) { log(`slot ${sl.id}: nothing visible, skipped`); continue; }
      const weighted = sl.kind === 'skinned' ? (verts, cell) => sampleWeights(list, sl, layer, verts, cell) : null;
      const id = await addAttachment({ slot: sl.id, name: 'default', bone: sl.bone, layer, weighted,
        source: { kind: 'render3d', character: spec.source3d, pose: 'bind', note: 'Starter art rendered from the 3D model at the art camera (not hand-painted).' } });
      slots.push({ id: sl.id, name: sl.id.replace(/_/g, ' '), bone: sl.bone, attachment: id, group: sl.group, color: [1, 1, 1, 1] });
      slotGeometry.set(sl.id, { sl, list });
      log(`slot ${sl.id}: ${layer.img.width}x${layer.img.height}${weighted ? ' weighted' : ''}`);
    }
    // mantle morph lookup (triangle id + barycentric per pixel) for baking cape flutter as deform keys
    var mantleLookup = null;
    const mantleSlot = spec.slots.find((s) => s.morph);
    if (mantleSlot && attachments[`${mantleSlot.id}.default`]) mantleLookup = buildMorphLookup(mantleSlot);
  } finally { stage.end(); }

  function buildMorphLookup(sl) {
    const mesh = morphMeshes.find((m) => select(sl).some((x) => x.o === m));
    if (!mesh) return null;
    const att = attachments[`${sl.id}.default`], { x0, y1, w, h } = { x0: att.registration.sourceRect[0], y1: att.registration.sourceRect[1], w: att.registration.sourceRect[2], h: att.registration.sourceRect[3] };
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    const n = g.attributes.position.count, tri = new Float32Array(n), bary = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { tri[i] = Math.floor(i / 3); bary[i * 3 + (i % 3)] = 1; }
    g.setAttribute('triId', new THREE.BufferAttribute(tri, 1)); g.setAttribute('bary', new THREE.BufferAttribute(bary, 3));
    g.morphAttributes = {};
    const mk = (frag) => new THREE.ShaderMaterial({ side: THREE.DoubleSide, blending: THREE.NoBlending,
      vertexShader: 'attribute float triId; attribute vec3 bary; varying float vT; varying vec3 vB; void main(){ vT = triId; vB = bary; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying float vT; varying vec3 vB; void main(){ ${frag} }` });
    const tmp = new THREE.Mesh(g, mk('float t = vT + 0.5; gl_FragColor = vec4(mod(t, 256.0) / 255.0, floor(t / 256.0) / 255.0, 1.0, 1.0);'));
    tmp.matrixAutoUpdate = false; tmp.matrix.copy(mesh.matrixWorld); tmp.matrixWorld.copy(mesh.matrixWorld);
    stage.scene.add(tmp); stage.only(new Set());
    const cam3 = cam.threeCamera(x0, y1 - h / S, x0 + w / S, y1);
    const ids = stage.renderRaw(cam3, w, h);
    tmp.material = mk('gl_FragColor = vec4(vB.x, vB.y, vB.z, 1.0);');
    const bc = stage.renderRaw(cam3, w, h);
    stage.scene.remove(tmp); g.dispose();
    // per mesh vertex: (triangle, barycentric) of the nearest covered pixel
    const [tx, ty] = att.registration.trim, map = [];
    for (let v = 0; v < att.vertices.length / 2; v++) {
      let x = Math.round(att.vertices[v * 2] + tx), y = Math.round(att.vertices[v * 2 + 1] + ty), found = null;
      for (let r = 0; r <= 40 && !found; r++) for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const i = (Y * w + X) * 4; if (ids[i + 2] > 128) { found = i; break; }
      }
      if (found === null) { map.push(null); continue; }
      const t = ids[found] + ids[found + 1] * 256, b1 = bc[found] / 255, b2 = bc[found + 1] / 255, b3 = bc[found + 2] / 255, s = b1 + b2 + b3 || 1;
      map.push([t, b1 / s, b2 / s, b3 / s]);
    }
    return { mesh, map, att: att.id };
  }

  // ---------------- props (flat views in their own frame)
  const propsOut = {};
  const weaponsJson = await (await fetch(`${window.__CB_BASE ?? '../'}props/weapons.json`)).json().catch(() => ({ props: {} }));
  for (const pid of spec.props || []) {
    const src = viewer.state.weapons?.getObjectByName(pid);
    if (!src) { log(`prop ${pid}: not found`); continue; }
    const axes = PROP_AXES[pid] || PROP_AXES.Sword2H;
    const X = new THREE.Vector3(...axes.x).normalize(), Y = new THREE.Vector3(...axes.y).normalize(), N = X.clone().cross(Y).normalize();
    const clone = src.clone(true); clone.position.set(0, 0, 0); clone.quaternion.identity(); clone.scale.set(1, 1, 1); clone.updateMatrixWorld(true);
    const holder = new THREE.Scene(); holder.add(clone);
    for (const l of sceneLights(viewer)) holder.add(l);
    if (ill && spec.illustrated) { ill.prepare(clone); ill.apply(); }
    const pts = []; const v = new THREE.Vector3();
    clone.traverse((o) => { if (o.isMesh && !o.userData.illustrationInk) { const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).clone()); } });
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { const a = p.dot(X) * ppm, b = p.dot(Y) * ppm; x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); }
    const mg = 0.012 * ppm + 3; x0 -= mg; x1 += mg; y0 -= mg; y1 += mg;
    const w = Math.ceil((x1 - x0) * S), h = Math.ceil((y1 - y0) * S);
    const c3 = new THREE.OrthographicCamera(x0 / ppm, (x0 + w / S) / ppm, y1 / ppm, (y1 - h / S) / ppm, 0.01, 20);
    c3.position.copy(N).multiplyScalar(5); c3.up.copy(Y); c3.lookAt(0, 0, 0); c3.updateMatrixWorld(true); c3.updateProjectionMatrix();
    const r = viewer.renderer, saved = { size: r.getSize(new THREE.Vector2()), pr: r.getPixelRatio() };
    r.setPixelRatio(1); r.setSize(w, h, false); r.setClearColor(0, 0); r.render(holder, c3);
    stage.canvas.width = w; stage.canvas.height = h; stage.ctx.clearRect(0, 0, w, h); stage.ctx.drawImage(r.domElement, 0, 0);
    const full = stage.ctx.getImageData(0, 0, w, h);
    r.setPixelRatio(saved.pr); r.setSize(saved.size.x, saved.size.y, false);
    if (ill && spec.illustrated) ill.release(clone);
    const tr = trimAlpha(full, 3);
    const originPx = [(-x0) * S - tr.x, (y1) * S - tr.y];      // image px of the prop origin (grip)
    const toImg = (m) => [+(originPx[0] + new THREE.Vector3(...m).dot(X) * ppm * S).toFixed(2), +(originPx[1] - new THREE.Vector3(...m).dot(Y) * ppm * S).toFixed(2)];
    const markers = {};
    for (const [k, M] of Object.entries(weaponsJson.props?.[pid]?.markers || {})) markers[k] = toImg([M[0][3], M[1][3], M[2][3]]);
    if (markers.grip_L) markers.support = markers.grip_L;
    const layer = { img: tr.img, x0: 0, yTop: 0, rect: { x0, y1, w, h, tx: tr.x, ty: tr.y } };
    const id = `prop_R.${pid}`, imgId = `prop__${pid}`;
    await writeImage(imgId, tr.img);
    const alpha = new Uint8Array(tr.img.width * tr.img.height); for (let i = 0; i < alpha.length; i++) alpha[i] = tr.img.data[i * 4 + 3];
    const mesh = gridMesh(alpha, tr.img.width, tr.img.height, { cell: Math.max(14, Math.round(Math.max(tr.img.width, tr.img.height) / 12)) });
    attachments[id] = { id, name: pid, slot: 'prop_R', type: 'region', bone: 'prop_R', image: imgId, imageScale: 1 / S, pivot: originPx.map((x) => +x.toFixed(2)),
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, mirror: false }, registration: { sourceRect: [x0, y1, w, h], trim: [tr.x, tr.y], scale: S },
      vertices: mesh.vertices, triangles: mesh.triangles, weights: null, visible: true, opacity: 1, tint: [1, 1, 1], blend: 'normal', view: 'flat',
      markers, source: { kind: 'render3d', prop: pid, note: 'Flat view of the 3D prop in its own frame (+x = main axis).' } };
    propsOut[pid] = { id: pid, attachment: id, axes3d: axes, markers: Object.keys(markers), source: pid === 'Sword2H' && spec.source3d === 'aureate_knight' ? 'viewer/js/knight.js knightSword()' : 'props/weapons.glb' };
    log(`prop ${pid}: ${tr.img.width}x${tr.img.height}`);
  }

  // ---------------- hand controls (semantic names, per-character fitting)
  const hands = {};
  for (const s of ['L', 'R']) {
    const fingers = {};
    for (const f of FINGERS) {
      const b1 = ch.bones[`${f}_01_${s}`]; if (!b1) continue;
      // which 2D rotation sign curls the finger toward the palm in this view: flex the 3D bone and look
      ch.resetPose(); ch.root.updateMatrixWorld(true);
      const i1 = bridge.index.get(`${f}_02_${s}`);
      const a0 = bridge.sampleWorld()[i1].rot;
      const q0 = b1.quaternion.clone(); b1.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.35));
      ch.root.updateMatrixWorld(true);
      const a1 = bridge.sampleWorld()[i1].rot; b1.quaternion.copy(q0); ch.root.updateMatrixWorld(true);
      const sign = wrapDeg(a1 - a0) >= 0 ? 1 : -1;
      fingers[f] = { bones: [1, 2, 3].map((k) => `${f}_0${k}_${s}`), sign, maxDeg: f === 'thumb' ? [20, 35, 45] : [70, 90, 60], curlShare: f === 'thumb' ? 0.6 : 1 };
    }
    hands[s] = { fingers, note: 'curl 0..1 (whole hand) plus per-finger -1..1; sign/max angles are this character\'s fitting' };
  }

  // ---------------- rig with the skin so far (for captures and baking)
  const setupOrderGuess = slots.map((s) => s.id);
  const project = {
    schema: SCHEMA, characterId: spec.id, displayName: spec.displayName,
    axes: { x: 'right', y: 'up', origin: 'ground point under the character (3D world origin)', units: 'project px', angles: 'degrees CCW' },
    referenceHeightPx: spec.referenceHeightPx, pixelsPerMeter: r4(ppm), sourceImageScale: S,
    artView: { ...cam.toJSON(), label: spec.view.label, note: 'Fixed art view. Other views need their own authored artwork/skins.' },
    source3d: { character: spec.source3d, bridge: 'viewer/js/art2d/bridge3d.js', bakeRate: fps,
      policy: 'joint/socket positions: exact orthographic projection; bone angle: projected primary axis with bind-offset fallback axis below 35% projected length; limb foreshortening scaleX clamped [0.4, 1.15]; props: scaleX from the projected main axis clamped [0.25, 1], scaleY from the projected second axis clamped [0.5, 1], negative scaleY = mirrored' },
    starterSkin: { derivedFrom3D: true, note: 'All default art is rendered from the 3D model (illustrated NPR treatment) to prove the 2D system; it is not the hand-drawn concept. Replace any image and it inherits the binding.' },
    bones, slots, attachments, images, skins: [{ id: 'default', view: spec.view.id, note: 'starter skin (3D-derived)' }],
    hands, props: propsOut,
    constraints: [
      { id: 'support_L', type: 'ik2', order: 1, bones: ['upperarm_L', 'forearm_L'], end: 'hand_L', effector: 'socket_hand_L_prop',
        target: { slot: 'prop_R', bone: 'prop_R', marker: 'support' }, mix: 0, bend: 'keep', keepEndRotation: true,
        note: 'Authoritative driver: the right hand and its prop. The left hand solves toward the prop marker after the right-hand chain; never the reverse.' },
      { id: 'thumb_button_R', type: 'ik2', order: 2, bones: ['thumb_02_R', 'thumb_03_R'], end: 'thumb_tip_R', effector: 'thumb_tip_R',
        target: { slot: 'prop_R', bone: 'prop_R', marker: 'button' }, mix: 0, bend: 'keep', keepEndRotation: true, note: 'Contact fixture: thumb pad to a button marker.' },
    ],
    sockets: ['socket_hand_L_prop', 'socket_hand_R_prop', 'socket_head_accessory', 'socket_back_accessory'].map((id) => ({ id, bone: id })),
    clips: [], poses: [],
    editor: { camera: { x: 0, y: spec.referenceHeightPx * 0.52, zoom: 1 }, reference: null, mode: 'setup' },
  };
  rig = new Rig(project);

  // ---------------- pose-specific hand art
  const captureKeys = [];                   // {clip, slot, attachment}
  // palm-normal sign per side, measured once at the bind pose; then the view of every capture
  const palmSigns = {}, captureView = {};
  ch.resetPose(); ch.root.updateMatrixWorld(true);
  for (const s of ['L', 'R']) palmFacing(ch, cam, s, palmSigns);
  const bindView = Object.fromEntries(['L', 'R'].map((s) => [s, palmFacing(ch, cam, s, palmSigns)]));
  const captureMarkers = [];
  stage.begin();
  try {
    for (const cap of spec.captures || []) {
      if (cap.clip) { bridge.pose3D(cap.clip, cap.t); zeroMorphsIfNone(); }
      else {
        ch.resetPose(); if (viewer.state.clipProp) { viewer.state.clipProp.removeFromParent(); viewer.state.clipProp = null; }
        for (const s of cap.sides) for (const f of FINGERS) [1, 2, 3].forEach((k) => {
          const b = ch.bones[`${f}_0${k}_${s}`]; if (!b) return;
          const deg = (f === 'thumb' ? [20, 35, 45] : [78, 95, 62])[k - 1] * cap.curl;
          b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), deg * Math.PI / 180));
        });
        // palm-side captures: the hand turned 180° about its own length axis shows its palm to the camera
        if (cap.twist) for (const s of cap.sides) ch.bones[`hand_${s}`]?.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cap.twist * Math.PI / 180));
      }
      ch.root.updateMatrixWorld(true);
      for (const s of cap.sides) (captureView[cap.name] ||= {})[s] = palmFacing(ch, cam, s, palmSigns);
      const samples = bridge.sampleWorld(cap.clip ? PROP_AXES[clipMeta(cap.clip)?.prop] : null);
      for (const s of cap.sides) {
        const hb = `hand_${s}`, hs = samples[bridge.index.get(hb)];
        const frame = affCompose(hs.pos[0], hs.pos[1], hs.rot, hs.sx, hs.sy);
        for (const g of cap.groups || ['hand', ...FINGERS]) {
          const sl = spec.slots.find((x) => x.id === `${g}_${s}`); if (!sl) continue;
          const layer = renderLayer(select(sl), sl); if (!layer) continue;
          const id = await addAttachment({ slot: sl.id, name: cap.name, bone: hb, layer, frame,
            source: { kind: 'render3d', character: spec.source3d, pose: cap.clip ? `${cap.clip} @ ${cap.t}s` : `bind + finger curl ${cap.curl}`,
              note: 'Pose-specific hand art rendered from the 3D model; rigid on the hand bone.' } });
          for (const c of cap.clips || []) captureKeys.push({ clip: c, slot: sl.id, attachment: id, range: cap.clipRanges?.[c] || cap.range || null });
        }
      }
      // pose-specific armour pieces (e.g. a raised pauldron, a forearm pointing at the camera): rigid on
      // their own bone, registered to that bone's 2D frame at the captured pose
      for (const slotId of cap.limbs || []) {
        const sl = spec.slots.find((x) => x.id === slotId); if (!sl) continue;
        const bs = samples[bridge.index.get(sl.bone)]; if (!bs) continue;
        const layer = renderLayer(select(sl), sl); if (!layer) continue;
        const id = await addAttachment({ slot: sl.id, name: cap.name, bone: sl.bone, layer, frame: affCompose(bs.pos[0], bs.pos[1], bs.rot, bs.sx, bs.sy),
          source: { kind: 'render3d', character: spec.source3d, pose: `${cap.clip} @ ${cap.t}s`, note: 'Pose-specific armour art rendered from the 3D model at this pose; rigid on its bone.' } });
        for (const c of cap.clips || []) captureKeys.push({ clip: c, slot: sl.id, attachment: id, range: cap.clipRanges?.[c] || cap.range || null });
      }
      if (cap.propMarker && viewer.state.clipProp) {
        const pm = viewer.state.clipProp.matrixWorld, sock = ch.sockets[cap.propMarker.socket];
        const local = new THREE.Vector3().setFromMatrixPosition(sock.matrixWorld).applyMatrix4(pm.clone().invert());
        captureMarkers.push({ prop: clipMeta(cap.clip).prop, marker: cap.propMarker.marker, local: local.toArray() });
      }
      log(`capture ${cap.name}`);
    }
  } finally { stage.end(); }
  function zeroMorphsIfNone() { /* morphs stay as animated; they do not affect hands */ }
  function clipMeta(name) { return cfg.animations?.find((a) => a.name === name) || null; }
  // hand view sets: palm + five finger layers that swap together (see handviews.js for the rule)
  project.handViews = {};
  for (const s of ['L', 'R']) {
    const groups = ['hand', ...FINGERS].map((g) => `${g}_${s}`).filter((sl) => slots.some((x) => x.id === sl));
    const setOf = (name) => (groups.every((sl) => attachments[`${sl}.${name}`]) ? Object.fromEntries(groups.map((sl) => [sl, `${sl}.${name}`])) : null);
    const sets = {}, viewOf = (f) => (f > 0.1 ? 'palm' : f < -0.1 ? 'back' : 'side');
    const def = Object.fromEntries(groups.map((sl) => [sl, slots.find((x) => x.id === sl).attachment]));
    const put = (pose, name, slotMap, f, source) => {
      const view = viewOf(f), key = `${pose}_${view}`;
      if (!sets[key]) sets[key] = { view, pose, slots: slotMap, source, measuredPalmFacing: f == null ? null : +f.toFixed(3) };
    };
    // setup art: articulated fingers, so it serves both open and relaxed in its own view
    put('open', 'default', def, bindView[s], 'setup art (articulated fingers)');
    put('relaxed', 'default', def, bindView[s], 'setup art; fingers curl through the finger bones');
    if (setOf('fist')) put('fist', 'fist', setOf('fist'), captureView.fist?.[s] ?? bindView[s], '3D capture');
    if (setOf('relaxed') && !sets[`relaxed_${viewOf(bindView[s])}`]) put('relaxed', 'relaxed', setOf('relaxed'), captureView.relaxed?.[s], '3D capture');
    for (const pose of POSES_2D) if (setOf(`${pose}_turned`)) put(pose, `${pose}_turned`, setOf(`${pose}_turned`), captureView[`${pose}_turned`]?.[s], '3D capture, hand turned 180° about its length axis');
    for (const cap of spec.captures || []) if (cap.clip && cap.sides.includes(s)) {
      const m = Object.fromEntries(groups.map((sl) => [sl, attachments[`${sl}.${cap.name}`] ? `${sl}.${cap.name}` : def[sl]]));
      const f = captureView[cap.name]?.[s];
      sets[cap.name] = { view: f > 0.1 ? 'palm' : f < -0.1 ? 'back' : 'side', pose: 'grip', slots: m, source: `3D capture of ${cap.clip} @ ${cap.t}s`, measuredPalmFacing: f == null ? null : +f.toFixed(3) };
    }
    if (groups.length) project.handViews[s] = { sets, setupView: viewOf(bindView[s]), note: 'palm + finger layers swap together; keys: tracks/corrections.handSets. view = measured palm facing (+palm / -back) at capture' };
  }
  for (const cm of captureMarkers) {            // e.g. where the left palm rests on the sword in the hover
    const a = attachments[`prop_R.${cm.prop}`]; if (!a) continue;
    const axes = PROP_AXES[cm.prop], X = new THREE.Vector3(...axes.x), Y = new THREE.Vector3(...axes.y), p = new THREE.Vector3(...cm.local);
    a.markers[cm.marker] = [+(a.pivot[0] + p.dot(X) * ppm * S).toFixed(2), +(a.pivot[1] - p.dot(Y) * ppm * S).toFixed(2)];
  }
  rig = new Rig(project);

  // ---------------- bake clips
  const clipList = ch.clips.map((c) => c.name).filter((n) => !onlyClips || onlyClips.includes(n));
  const slotIds = slots.map((s) => s.id);
  const above = (spec.above || []).filter(([a, b]) => slotIds.includes(a) && slotIds.includes(b));
  // occlusion analysis: every slot's 3D geometry tagged with its slot (skinned meshes split per bone)
  const occ = new Occlusion(viewer.renderer, cam, [-1100, -250, 1100, 1650].map((x) => x * spec.referenceHeightPx / 1024), 0.35);
  const perMesh = new Map();
  for (const { sl, list } of slotGeometry.values()) for (const m of list) {
    const e = perMesh.get(m.o) || { fixed: null, boneSlots: {} };
    if (!m.skinned || !sl.mask) e.fixed ||= sl.id; else for (const b of sl.mask) e.boneSlots[b] ||= sl.id;
    if (m.skinned && sl.mask && !e.firstMasked) e.firstMasked = sl.id;
    perMesh.set(m.o, e);
  }
  for (const [o, e] of perMesh) occ.add(o, e.fixed || e.firstMasked, o.isSkinnedMesh ? e.boneSlots : null);
  let propMeshes = [];
  const trackProp = () => {
    const p = viewer.state.clipProp, now = [];
    if (p) p.traverse((o) => { if (o.isMesh && !o.userData.illustrationInk) now.push(o); });
    for (const o of propMeshes) if (!now.includes(o)) occ.remove(o);
    for (const o of now) if (!propMeshes.includes(o)) occ.add(o, 'prop_R');
    propMeshes = now;
  };
  const occlusionOrder = (prev, opts) => solveOrder(prev, occ.votes(ch.root), { above, ...opts });
  // setup order: occlusion at the bind pose (no thresholds), authored `above` rules enforced
  ch.resetPose(); bridge._clearProp(); trackProp(); ch.root.updateMatrixWorld(true);
  let setupOrder = [...setupOrderGuess.filter((id) => id !== 'prop_R'), 'prop_R'];
  for (let it = 0; it < 3; it++) setupOrder = occlusionOrder(setupOrder, { minPx: 0, share: 0 });
  project.slots = setupOrder.map((id) => slots.find((s) => s.id === id));
  rig = new Rig(project);
  if (spec.debug) { const v = occ.votes(ch.root); log('setup order: ' + setupOrder.join(' ')); log('coverage: ' + JSON.stringify([...occ.lastCoverage])); log('votes: ' + JSON.stringify([...v].filter(([k]) => /cuirass|upperarm_R/.test(k)))); }

  const inRange = (r, t) => !r || (Array.isArray(r[0]) ? r : [r]).some(([a, b]) => t >= a - 1e-6 && t <= b + 1e-6);
  const capturedAt = (clip, slot, t) => captureKeys.some((c) => c.clip === clip && c.slot === slot && inRange(c.range, t));
  const supportAcc = {};                 // prop -> 3D contact of the left-hand socket in prop space
  for (const name of clipList) {
    const clip = ch.clip(name), meta = clipMeta(name) || {};
    const loop = !!meta.loop, dur = clip.duration;
    const n = Math.max(1, Math.round(dur * fps));
    const times = Array.from({ length: n + 1 }, (_, i) => Math.min(dur, i / fps));
    const propId = meta.prop && project.props[meta.prop] ? meta.prop : null;
    const axes = propId ? PROP_AXES[propId] : PROP_AXES.Sword2H;
    const frames = [], orders = [], deforms = [];
    const notes = new Set();
    const handSignal = {};
    let yawMax = 0, headYawMax = 0; const minRatio = {}; const flips = { L: false, R: false }; let edgeOn = false;
    const bindFacing = {}; const chestBind = new THREE.Quaternion(), headBind = new THREE.Quaternion();
    ch.resetPose(); ch.root.updateMatrixWorld(true);
    ch.bones.chest.getWorldQuaternion(chestBind); ch.bones.head.getWorldQuaternion(headBind);
    for (const s of ['L', 'R']) bindFacing[s] = -axisOf(ch.sockets[`socket_hand_${s}_prop`].matrixWorld, '+z').dot(cam.f);
    let prevOrder = setupOrder;
    const passes = loop ? 2 : 1;
    for (let pass = 0; pass < passes; pass++) {
      orders.length = 0;
      for (let fi = 0; fi < times.length; fi++) {
        bridge.pose3D(name, times[fi]);
        if (fi === 0) trackProp();
        const full = occlusionOrder(prevOrder);
        prevOrder = full;
        orders.push(full);
        if (pass < passes - 1) continue;
        const sm = bridge.sampleWorld(axes);
        if (SUPPORT_CLIPS[name] && propId && viewer.state.clipProp) {
          const inv = viewer.state.clipProp.matrixWorld.clone().invert();
          const p = new THREE.Vector3().setFromMatrixPosition(ch.sockets.socket_hand_L_prop.matrixWorld).applyMatrix4(inv);
          (supportAcc[propId] ||= []).push(p);
        }
        frames.push(bridge.toLocal(sm));
        // status analysis
        const q = new THREE.Quaternion(), fwd = new THREE.Vector3(0, 0, 1);
        const yawOf = (b, bind) => { b.getWorldQuaternion(q); const f = fwd.clone().applyQuaternion(q.multiply(bind.clone().invert())); return Math.abs(Math.atan2(f.x, f.z) * 180 / Math.PI); };
        yawMax = Math.max(yawMax, yawOf(ch.bones.chest, chestBind)); headYawMax = Math.max(headYawMax, yawOf(ch.bones.head, headBind));
        // squash only matters while the bone shows setup-view art (pose-specific captures are drawn for the pose)
        defs.forEach((d, i) => { if (d.foreshorten && (d.kind !== "prop" || propId) && !capturedAt(name, d.id, times[fi])) minRatio[d.id] = Math.min(minRatio[d.id] ?? 9, sm[i].r1 / d.r1bind); });
        for (const s of ['L', 'R']) {
          const f = -axisOf(ch.sockets[`socket_hand_${s}_prop`].matrixWorld, '+z').dot(cam.f);
          if (Math.abs(f) > 0.3 && Math.sign(f) !== Math.sign(bindFacing[s])) flips[s] = true;
          if (fi % 3 === 0) {                               // 10 Hz source signal for the hand-view rule
            const curl = ['index', 'middle', 'ring', 'pinky'].reduce((a, fg) => { const b = ch.bones[`${fg}_02_${s}`], r = ch.rest?.[`${fg}_02_${s}`]; return a + (b && r ? b.quaternion.angleTo(r.q) / (Math.PI / 2) : 0); }, 0) / 4;
            const sg = handSignal[s] ||= { t: [], palm: [], curl: [] };
            sg.t.push(+times[fi].toFixed(4)); sg.palm.push(+palmFacing(ch, cam, s, palmSigns).toFixed(3)); sg.curl.push(+Math.min(1, curl).toFixed(3));
          }
        }
        if (propId) { const ps = sm[bridge.index.get('prop_R')]; if (Math.abs(ps.sy) < 0.3) edgeOn = true; }
        // cape flutter from the 3D morph targets -> deform offsets (bind space of the chest-rigid mantle)
        if (mantleLookup && fi % 2 === 0) deforms.push([times[fi], mantleDeform(sm)]);
      }
    }
    // single-frame draw-order blips (A → B → A) are removed: an order must hold for at least 2 frames
    const okey = (o) => o.join(',');
    for (let i = 1; i < orders.length - 1; i++) if (okey(orders[i]) !== okey(orders[i - 1]) && okey(orders[i + 1]) === okey(orders[i - 1])) orders[i] = orders[i - 1];
    // minimum hold: a depth order shown for fewer than 3 frames (pieces flip-flopping while they cross) keeps the
    // previous order instead; the last run of the clip is kept so the final pose is drawn correctly
    for (let changed = true; changed;) {
      changed = false;
      const runs = []; orders.forEach((o, i) => { if (!runs.length || okey(o) !== okey(orders[runs[runs.length - 1]])) runs.push(i); });
      for (let r = 1; r < runs.length - 1; r++) if (runs[r + 1] - runs[r] < 3) { for (let i = runs[r]; i < runs[r + 1]; i++) orders[i] = orders[runs[r] - 1]; changed = true; break; }
    }
    // ---- tracks
    const tracks = { bones: {}, slots: {}, drawOrder: { t: [], v: [] }, deform: {}, hands: {}, constraints: {}, events: [] };
    defs.forEach((d, i) => {
      const s0 = setupLocal[i];
      let prev = 0;
      const rot = [], tx = [], ty = [], sx = [], sy = [];
      for (const f of frames) {
        const l = f[i];
        let r = wrapDeg(l.rotation - s0.rotation);
        r += 360 * Math.round((prev - r) / 360); prev = r;
        rot.push(r); tx.push(l.x - s0.x); ty.push(l.y - s0.y); sx.push(l.scaleX / s0.scaleX); sy.push(l.scaleY / s0.scaleY);
      }
      const tr = {};
      const put = (field, chans, tol, names, identity) => {
        if (chans.every((c) => c.every((x) => Math.abs(x - identity) <= tol))) return;
        const idx = reduceKeys(times, chans, tol);
        tr[field] = { t: idx.map((j) => +times[j].toFixed(4)) };
        names.forEach((nm, c) => { tr[field][nm] = idx.map((j) => +chans[c][j].toFixed(4)); });
      };
      put('rotate', [rot], 0.05, ['v'], 0);
      put('translate', [tx, ty], 0.05, ['x', 'y'], 0);
      put('scale', [sx, sy], 0.002, ['x', 'y'], 1);
      if (Object.keys(tr).length) tracks.bones[d.id] = tr;
    });
    let last = null;
    orders.forEach((o, fi) => {
      const key = o.join(',');
      if (key !== last && !(fi === 0 && key === setupOrder.join(','))) { tracks.drawOrder.t.push(+times[fi].toFixed(4)); tracks.drawOrder.v.push(o); }
      last = key;
    });
    if (propId) tracks.slots.prop_R = { attachment: { t: [0], v: [`prop_R.${propId}`] } };
    // capture keys per slot: whole-clip captures, or one or more [from, to] intervals (merged into one step track)
    const bySlot = new Map();
    for (const ck of captureKeys.filter((c) => c.clip === name)) (bySlot.get(ck.slot) || bySlot.set(ck.slot, []).get(ck.slot)).push(ck);
    for (const [slot, list] of bySlot) {
      const def = slots.find((x) => x.id === slot)?.attachment ?? null, whole = list.find((c) => !c.range);
      if (whole) { tracks.slots[slot] = { attachment: { t: [0], v: [whole.attachment] } }; continue; }
      const iv = list.flatMap((c) => (Array.isArray(c.range[0]) ? c.range : [c.range]).map(([a, b]) => [a, b, c.attachment])).sort((x, y) => x[0] - y[0]);
      const t = [0], v = [def];
      for (const [a, b, att] of iv) {
        if (Math.abs(t[t.length - 1] - a) < 1e-6) v[v.length - 1] = att; else { t.push(a); v.push(att); }
        if (b < dur - 1e-6) { t.push(b); v.push(def); }     // an interval reaching the clip end holds to the last frame
      }
      for (let i = t.length - 1; i > 0; i--) if (Math.abs(t[i] - t[i - 1]) < 1e-6) { t.splice(i - 1, 1); v.splice(i - 1, 1); }
      tracks.slots[slot] = { attachment: { t: t.map((x) => +x.toFixed(4)), v } };
    }
    if (SUPPORT_CLIPS[name]) tracks.constraints.support_L = { t: [0], v: [1] };
    if (deforms.length && mantleLookup && deforms.some(([, v]) => v.some((x) => Math.abs(x) > 0.05))) {
      // keep only the keys needed to stay within 0.3 px of the sampled flutter
      const dt = deforms.map(([t]) => t), chans = deforms[0][1].map((_, k) => deforms.map(([, v]) => v[k]));
      const idx = reduceKeys(dt, chans, 0.3);
      tracks.deform[mantleLookup.att] = { t: idx.map((j) => +dt[j].toFixed(4)), v: idx.map((j) => deforms[j][1]) };
    }
    for (const [k, val] of Object.entries(meta.markers || {})) {
      if (k === 'end') continue;
      for (const f of [].concat(val)) if (Number.isFinite(f)) tracks.events.push({ t: +(Math.min(dur, f / 30)).toFixed(4), name: k });
    }
    tracks.events.sort((a, b) => a.t - b.t);
    // ---- status
    const captured = new Set(captureKeys.filter((c) => c.clip === name && /^(hand|thumb|index|middle|ring|pinky)_/.test(c.slot)).map((c) => c.slot.split('_').pop()));
    if (yawMax > 30) notes.add(`torso turns up to ${yawMax.toFixed(0)}° from the art view: the front-three-quarter body art is shown rotated in-plane; a side/turned view skin would be needed for fidelity`);
    if (headYawMax > 35) notes.add(`head turns up to ${headYawMax.toFixed(0)}°: needs a turned-head view for accuracy`);
    for (const [b, r] of Object.entries(minRatio)) if (r < 0.45) notes.add(`${b} foreshortens to ${(r * 100).toFixed(0)}% of its length (points at/away from the camera) while it shows setup-view art: art is squashed along the bone`);
    // hand view sets suggested from the source signal (grip captures keyed above stay authoritative)
    tracks.handSets = {};
    const tmpClip = { name, duration: dur, source: { handSignal } };
    for (const s of ['L', 'R']) {
      if (captured.has(s) || !project.handViews[s]) continue;
      const sug = suggestHandSets(project, tmpClip, s), setup = `open_${project.handViews[s].setupView}`;
      if (sug.keys && sug.keys.v.some((v) => v !== setup)) tracks.handSets[s] = sug.keys;
      const other = sug.keys?.v.filter((v) => !v.endsWith(`_${project.handViews[s].setupView}`));
      if (other?.length) notes.add(`hand_${s} turns to show its other side: swapped to ${[...new Set(other)].join(', ')} by the hand-view rule`);
      if (sug.missing?.length) notes.add(`hand_${s}: missing hand art ${sug.missing.join(', ')} (fell back to the back-of-hand set)`);
    }
    if (edgeOn) notes.add(`prop ${propId} turns edge-on to the camera (blade/barrel narrows)`);
    if (tracks.drawOrder.t.length > 6) notes.add(`${tracks.drawOrder.t.length} draw-order changes (limbs cross in front of/behind each other)`);
    const lvl = [...notes].some((x) => /wrong side|turned-head|side\/turned view/.test(x)) ? 'needs-art' : notes.size ? 'attention' : 'ok';
    project.clips.push({ name, duration: +dur.toFixed(4), loop, fps,
      source: { type: 'bridge3d', character: spec.source3d, clip: name, artView: spec.view.id, bakeRate: fps, handSignal,
        tolerance: { rotateDeg: 0.05, translatePx: 0.05, scale: 0.002 }, note: 'Offsets relative to the 2D setup pose; artist corrections live in `corrections`.' },
      meta: { prop: meta.prop || null, attach: meta.attach || null, support: meta.support || null, markers: meta.markers || null, propTransform: meta.propTransform ? true : undefined },
      tracks, corrections: { bones: {}, slots: {}, drawOrder: { t: [], v: [] }, deform: {}, hands: {}, handSets: {}, constraints: {}, events: [] },
      status: { level: lvl, notes: [...notes] } });
    log(`clip ${name}: ${frames.length} frames, ${Object.keys(tracks.bones).length} bone tracks, ${tracks.drawOrder.t.length} order keys, ${lvl}`);
  }

  // the support-hand marker of each prop is where the 3D clips actually put the left-hand socket
  for (const [pid, pts] of Object.entries(supportAcc)) {
    const a = attachments[`prop_R.${pid}`]; if (!a) continue;
    const axes = PROP_AXES[pid], X = new THREE.Vector3(...axes.x), Y = new THREE.Vector3(...axes.y);
    const m = pts.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
    const toImg = (p) => [a.pivot[0] + p.dot(X) * ppm * S, a.pivot[1] - p.dot(Y) * ppm * S];
    const c = toImg(m), spread = Math.max(...pts.map((p) => { const q = toImg(p); return Math.hypot(q[0] - c[0], q[1] - c[1]) / S; }));
    a.markers.support = c.map((x) => +x.toFixed(2));
    project.props[pid].support = { marker: 'support', from: '3D clips', frames: pts.length, spreadPx: +spread.toFixed(2),
      note: 'mean position of socket_hand_L_prop in prop space over the support clips; spread = how far the 3D hand slides' };
    log(`prop ${pid}: support marker from 3D contact (spread ${spread.toFixed(2)} px)`);
  }

  function mantleDeform(sm) {
    const { mesh, map, att } = mantleLookup, a = rig.attachments.get(att);
    const g = mesh.geometry, idx = g.index, morph = g.morphAttributes.position || [], rel = g.morphTargetsRelative;
    const infl = mesh.morphTargetInfluences, pos = g.attributes.position;
    const chestI = bridge.index.get('chest'), chestBindRot = setupLocal && bridge.bindSamples[chestI].rot;
    const dRot = (sm[chestI].rot - chestBindRot) * Math.PI / 180, c = Math.cos(-dRot), s = Math.sin(-dRot);
    const e = mesh.matrixWorld.elements, out = new Array(a.nv * 2).fill(0);
    map.forEach((m, v) => {
      if (!m) return;
      const [t, b1, b2, b3] = m, vi = [0, 1, 2].map((k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k));
      let dx = 0, dy = 0, dz = 0;
      morph.forEach((attr, k) => {
        const w = infl[k]; if (!w) return;
        [b1, b2, b3].forEach((b, j) => {
          const i = vi[j];
          dx += w * b * (attr.getX(i) - (rel ? 0 : pos.getX(i))); dy += w * b * (attr.getY(i) - (rel ? 0 : pos.getY(i))); dz += w * b * (attr.getZ(i) - (rel ? 0 : pos.getZ(i)));
        });
      });
      const wx = e[0] * dx + e[4] * dy + e[8] * dz, wy = e[1] * dx + e[5] * dy + e[9] * dz, wz = e[2] * dx + e[6] * dy + e[10] * dz;
      const d2 = cam.dir(new THREE.Vector3(wx, wy, wz));
      out[v * 2] = +(c * d2[0] - s * d2[1]).toFixed(1); out[v * 2 + 1] = +(s * d2[0] + c * d2[1]).toFixed(1);
    });
    return out;
  }

  ch.resetPose(); if (viewer.state.clipProp) { viewer.state.clipProp.removeFromParent(); viewer.state.clipProp = null; }
  occ.dispose();
  computeInverseBinds(project);
  return project;
}
