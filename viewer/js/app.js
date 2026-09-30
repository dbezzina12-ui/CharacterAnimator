import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Character, FINGERS, PART_ORDER, loadGLB, partColor } from './character.js';
import { CoverageProbe } from './coverage.js';
import { REF_VIEWS, makeRefCamera } from './refcams.js';

const $ = (id) => document.getElementById(id);
const ASSET_BASE = window.__CB_BASE ?? '../';   // '../' locally; '' in the hosted build
const params = new URLSearchParams(location.search);
if (params.get('hideui')) document.body.classList.add('hideui');

// ---------------------------------------------------------------- scene ----------
const main = $('main');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
main.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x30333a);
const camera = new THREE.PerspectiveCamera(30, 1, 0.02, 100);
camera.position.set(0, 1.0, 4.5);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0.9, 0);
orbit.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6b6b, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(1.5, 3, 3);
scene.add(key);
const rim = new THREE.DirectionalLight(0xffffff, 0.5);
rim.position.set(-2, 2, -3);
scene.add(rim);
const grid = new THREE.GridHelper(4, 16, 0x555a66, 0x3b3f48);
scene.add(grid);

const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setSize(0.7);
gizmo.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });
scene.add(gizmo.getHelper());

// ---------------------------------------------------------------- state ----------
const state = {
  ch: null, cfg: null, props: null, skel: null, clipAction: null, playing: false, selected: null,
  hidden: new Set(), matMode: 'original', upload: null, checker: null, sockets: [], handProps: {},
  ik: { L: null, R: null }, exportUrl: null, exportCfgUrl: null, captured: 0, charDir: null,
};
const clock = new THREE.Clock();

function status(msg) { $('status').textContent = msg; }

function resize() {
  const w = main.clientWidth, h = main.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- loading --------
async function fetchJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }

// hosted build: GLBs are published as base64 text (<file>.glb.b64.txt) because the host only serves web types
async function fetchB64(url) {
  const r = await fetch(url + '.b64.txt');
  if (!r.ok) throw new Error(url + ' ' + r.status);
  const bin = atob((await r.text()).trim());
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

async function loadCharacter(glbSrc, cfg = null, propsUrl = null) {
  if (state.ch) {
    state.ch.mixer.stopAllAction();
    scene.remove(state.ch.root);
    if (state.props) scene.remove(state.props);
    if (state.skel) { scene.remove(state.skel); state.skel = null; }
    gizmo.detach();
  }
  if (window.__CB_HOSTED && typeof glbSrc === 'string') glbSrc = await fetchB64(glbSrc);
  const gltf = await loadGLB(glbSrc);
  const ch = new Character(gltf, cfg);
  state.ch = ch; state.cfg = cfg; state.selected = null; state.hidden.clear(); state.handProps = {};
  state.ik = { L: null, R: null };
  scene.add(ch.root);
  state.props = null;
  if (propsUrl) {
    try { state.props = (await loadGLB(window.__CB_HOSTED ? await fetchB64(propsUrl) : propsUrl)).scene; state.props.visible = $('chkProps').checked; scene.add(state.props); } catch (e) { /* optional */ }
  }
  buildPartsUI();
  buildClipUI();
  applyMaterial();
  applySockets();
  applySkeleton();
  const h = ch.height();
  const tris = Object.values(ch.parts).reduce((a, m) => a + m.geometry.index.count / 3, 0);
  $('charInfo').innerHTML = `${cfg ? `<b>${cfg.displayName}</b> (${cfg.characterId}) · ${cfg.status}${cfg.frozen ? ' · frozen' : ''}<br>` : ''}` +
    `${Object.keys(ch.parts).length} parts · ${tris} tris · ${ch.skeleton ? ch.skeleton.bones.length : 0} joints · ` +
    `${ch.clips.length} clips · ${Object.keys(ch.sockets).length} sockets · height ${h.toFixed(3)} m` +
    (cfg ? `<br>UV ${cfg.uvLayout.id} v${cfg.uvLayout.version} · material: ${cfg.material.mode}` : '');
  setView('front_three_quarter');
  window.viewer.character = ch;
  return ch;
}

async function loadFromIndex(id) {
  const idx = await fetchJSON(`${ASSET_BASE}characters/index.json`);
  const e = idx.characters.find((c) => c.id === id) || idx.characters[0];
  state.charDir = `${ASSET_BASE}characters/${e.id}/`;
  const cfg = await fetchJSON(state.charDir + e.config).catch(() => null);
  return loadCharacter(state.charDir + e.glb, cfg, state.charDir + (e.props || 'test_props.glb'));
}

// ---------------------------------------------------------------- materials ------
function checkerTex() {
  if (!state.checker) {
    state.checker = new THREE.TextureLoader().load(`${ASSET_BASE}textures/uv_checker_2048.png`);
    state.checker.flipY = false;
    state.checker.colorSpace = THREE.SRGBColorSpace;
    state.checker.anisotropy = 8;
  }
  return state.checker;
}

let coverage = null;
function applyMaterial() {
  const ch = state.ch;
  if (!ch) return;
  const wire = $('chkWire').checked;
  const mode = state.matMode;
  $('legend').style.display = mode === 'coverage' ? 'block' : 'none';
  if (mode === 'checker') ch.setMaterial('texture', { map: checkerTex(), wireframe: wire });
  else if (mode === 'texture') {
    if (!state.upload) { status('Load a base-colour texture first (Material → file)'); ch.setMaterial('blank', { wireframe: wire }); return; }
    ch.setMaterial('texture', { map: state.upload, wireframe: wire });
  } else if (mode === 'coverage') {
    stopAnim();
    ch.resetPose(); ch.applyDrivers();
    const h = ch.height();
    coverage = coverage || new CoverageProbe(renderer, 1024);
    ch.setMaterial('blank');
    coverage.capture(ch.root, REF_VIEWS.map((v) => makeRefCamera(v, h)));
    ch.setMaterial('custom', { factory: () => coverage.material() });
    $('legend').innerHTML = '<b>Reference-view coverage</b><br><i style="background:#26bf40"></i>2+ good views<br>' +
      '<i style="background:#ebd933"></i>1 good view<br><i style="background:#ff801a"></i>grazing only<br>' +
      '<i style="background:#f0f"></i>NOT seen by any reference view';
  } else if (mode === 'original') {
    ch.setMaterial('original');
    for (const m of Object.values(ch.parts)) m.material.wireframe = wire;
  } else ch.setMaterial(mode, { wireframe: wire });
  highlight();
}

function highlight() {
  for (const [n, m] of Object.entries(state.ch.parts)) {
    if (m.material.emissive) m.material.emissive.setHex(n === state.selected ? 0x2a4f8a : 0x000000);
    m.visible = !state.hidden.has(n);
  }
}

// ---------------------------------------------------------------- UI: parts ------
function buildPartsUI() {
  const box = $('parts');
  box.innerHTML = '';
  const names = PART_ORDER.filter((n) => state.ch.parts[n]).concat(Object.keys(state.ch.parts).filter((n) => !PART_ORDER.includes(n)));
  for (const n of names) {
    const d = document.createElement('div');
    d.className = 'p' + (state.selected === n ? ' sel' : '');
    const c = partColor(n, 0.55, 0.92);
    d.innerHTML = `<input type="checkbox" ${state.hidden.has(n) ? '' : 'checked'}><span class="sw" style="background:#${c.getHexString()}"></span><span class="n">${n}</span>`;
    d.querySelector('input').onchange = (e) => { e.target.checked ? state.hidden.delete(n) : state.hidden.add(n); highlight(); };
    d.querySelector('.n').onclick = () => selectPart(n);
    box.appendChild(d);
  }
}
function selectPart(n) { state.selected = state.selected === n ? null : n; buildPartsUI(); highlight(); status(n ? `selected ${n}` : ''); }
$('btnIsolate').onclick = () => { if (!state.selected) return; state.hidden = new Set(Object.keys(state.ch.parts).filter((n) => n !== state.selected)); buildPartsUI(); highlight(); };
$('btnShowAll').onclick = () => { state.hidden.clear(); buildPartsUI(); highlight(); };
$('explode').oninput = (e) => state.ch.setExplode(Number(e.target.value));
$('btnAssemble').onclick = () => { $('explode').value = 0; state.ch.setExplode(0); };

const ray = new THREE.Raycaster();
renderer.domElement.addEventListener('pointerdown', (e) => { renderer.domElement._down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  const d = renderer.domElement._down;
  if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 4 || gizmo.dragging) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hits = ray.intersectObjects(Object.values(state.ch.parts).filter((m) => m.visible), false);
  if (hits.length) selectPart(hits[0].object.name);
});

// ---------------------------------------------------------------- UI: view -------
for (const [label, name] of [['Front', 'front'], ['Back', 'back'], ['Left', 'left'], ['Right', 'right'], ['3/4', 'front_three_quarter']]) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => setView(name);
  $('camBtns').appendChild(b);
}
function setView(name) {
  const v = REF_VIEWS.find((x) => x.name === name);
  const h = state.ch ? state.ch.height() : 1.75;
  const c = makeRefCamera(v, h, camera.aspect);
  camera.position.copy(c.position);
  camera.fov = c.fov; camera.updateProjectionMatrix();
  orbit.target.copy(c.userData.target);
  orbit.update();
}
function applySkeleton() {
  if (state.skel) { scene.remove(state.skel); state.skel = null; }
  if ($('chkSkel').checked && state.ch) {
    state.skel = new THREE.SkeletonHelper(state.ch.root);
    state.skel.material.depthTest = false;
    state.skel.material.linewidth = 2;
    scene.add(state.skel);
  }
}
function applySockets() {
  for (const a of state.sockets) a.removeFromParent();
  state.sockets = [];
  if (!$('chkSockets').checked) return;
  for (const s of Object.values(state.ch.sockets)) { const a = new THREE.AxesHelper(0.08); a.userData.viewerOnly = true; s.add(a); state.sockets.push(a); }
}
$('chkSkel').onchange = applySkeleton;
$('chkWire').onchange = applyMaterial;
$('chkSockets').onchange = applySockets;
$('chkProps').onchange = (e) => { if (state.props) state.props.visible = e.target.checked && !state.clipProp; };
$('matSel').onchange = (e) => { state.matMode = e.target.value; applyMaterial(); };
$('texFile').onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  new THREE.TextureLoader().load(url, (t) => {
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.name = f.name;
    t.userData.mimeType = f.type;
    state.upload = t; state.matMode = 'texture'; $('matSel').value = 'texture'; applyMaterial();
    status(`texture ${f.name} ${t.image.width}x${t.image.height}`);
  });
};
$('glbFile').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  await loadCharacter(await f.arrayBuffer(), state.pendingCfg || null, null);
  state.pendingCfg = null;
};
$('cfgFile').onchange = async (e) => { const f = e.target.files[0]; if (f) state.pendingCfg = JSON.parse(await f.text()); status('config loaded; now load its GLB'); };
$('charSel').onchange = (e) => loadFromIndex(e.target.value);

// ---------------------------------------------------------------- animation ------
function buildClipUI() {
  const sel = $('clipSel');
  sel.innerHTML = '';
  for (const c of state.ch.clips) { const o = document.createElement('option'); o.value = c.name; o.textContent = `${c.name} (${c.duration.toFixed(2)} s)`; sel.appendChild(o); }
  const qa = $('qaSel');
  qa.innerHTML = '<option value="">Jump to QA test pose…</option>';
  const meta = state.cfg && state.cfg.animations ? state.cfg.animations.find((a) => a.name === '_qa_pose_cycle') : null;
  if (meta && meta.markers) for (const [n, f] of Object.entries(meta.markers)) { const o = document.createElement('option'); o.value = (f + 7) / 30; o.textContent = n; qa.appendChild(o); }
}
// ---- weapon props: clips that need one name it in the character JSON (animations[].prop / .attach)
async function loadWeapons() {
  if (state.weapons !== undefined) return state.weapons;
  state.weapons = null;
  try {
    const url = `${ASSET_BASE}props/weapons.glb`;
    state.weapons = (await loadGLB(window.__CB_HOSTED ? await fetchB64(url) : url)).scene;
  } catch (e) { /* weapons are optional */ }
  return state.weapons;
}
function clipMeta(name) { return state.cfg && state.cfg.animations ? state.cfg.animations.find((a) => a.name === name) : null; }
function attachClipProp(name) {
  if (state.clipProp) { state.clipProp.removeFromParent(); state.clipProp = null; }
  const meta = clipMeta(name);
  // the handle test prop belongs to reach_grip_handle; hide it while a hand-held prop clip plays
  const heldProp = meta && meta.prop && state.weapons ? state.weapons.getObjectByName(meta.prop) : null;
  if (state.props) state.props.visible = $('chkProps').checked && !heldProp;
  if (!meta || !meta.prop || !state.weapons || !state.ch) return;
  const src = state.weapons.getObjectByName(meta.prop);
  const sock = state.ch.sockets[meta.attach || 'socket_hand_R_prop'];
  if (!src || !sock) return;
  const w = src.clone(true);
  w.position.set(0, 0, 0); w.quaternion.identity(); w.scale.set(1, 1, 1);
  w.userData.viewerOnly = true;
  sock.add(w);
  state.clipProp = w;
}

function playClip(name, time = 0, play = true) {
  attachClipProp(name);
  const ch = state.ch;
  ch.mixer.stopAllAction();
  const clip = ch.clip(name);
  if (!clip) return;
  const a = ch.mixer.clipAction(clip);
  a.reset();
  a.setLoop($('chkLoop').checked ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  a.clampWhenFinished = true;
  a.play();
  a.time = time;
  a.paused = !play;
  ch.mixer.update(0);
  state.clipAction = a;
  state.playing = play;
  $('scrub').max = clip.duration;
}
function stopAnim() {
  if (state.ch) state.ch.mixer.stopAllAction();
  state.clipAction = null; state.playing = false;
  if (state.clipProp) { state.clipProp.removeFromParent(); state.clipProp = null; }
  if (state.props) state.props.visible = $('chkProps').checked;
}
$('btnPlay').onclick = () => { if (state.clipAction && state.clipAction.getClip().name === $('clipSel').value) { state.clipAction.paused = false; state.playing = true; } else playClip($('clipSel').value); };
$('btnPause').onclick = () => { if (state.clipAction) { state.clipAction.paused = true; state.playing = false; } };
$('scrub').oninput = (e) => {
  if (!state.clipAction || state.clipAction.getClip().name !== $('clipSel').value) playClip($('clipSel').value, 0, false);
  state.clipAction.paused = true; state.playing = false; state.clipAction.time = Number(e.target.value); state.ch.mixer.update(0);
};
$('speed').oninput = (e) => { state.ch.mixer.timeScale = Number(e.target.value); };
$('qaSel').onchange = (e) => { if (!e.target.value) return; $('clipSel').value = '_qa_pose_cycle'; playClip('_qa_pose_cycle', Number(e.target.value), false); $('scrub').value = e.target.value; };

// ---------------------------------------------------------------- posing ---------
$('btnReset').onclick = () => {
  stopAnim(); state.ch.resetPose();
  for (const s of ['L', 'R']) if (state.ik[s]) { scene.remove(state.ik[s]); state.ik[s] = null; }
  gizmo.detach(); $('curlL').value = 0; $('curlR').value = 0; $('headTurn').value = 0;
  status('rest A-pose (bind pose)');
};
function holdPose() {
  // freeze whatever the mixer shows into the bones so manual edits start from it
  if (state.clipAction) { state.ch.mixer.stopAllAction(); state.clipAction = null; state.playing = false; }
}
function ikTarget(side) {
  holdPose();
  const ch = state.ch;
  let t = state.ik[side];
  if (!t) {
    t = new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 12), new THREE.MeshBasicMaterial({ color: side === 'L' ? 0x4d7dff : 0xff5d5d, depthTest: false }));
    t.renderOrder = 10;
    ch.root.updateMatrixWorld(true);
    const hand = ch.bones[`hand_${side}`];
    hand.getWorldPosition(t.position);
    hand.getWorldQuaternion(t.quaternion);
    scene.add(t);
    state.ik[side] = t;
  }
  gizmo.attach(t);
  state.gizmoSide = side;
}
function solveIK(side) {
  const ch = state.ch;
  const t = state.ik[side];
  if (!t) return;
  const sx = side === 'L' ? 1 : -1;
  const pole = new THREE.Vector3(sx * 0.6, -0.2, -0.9).normalize().add(new THREE.Vector3(0, -0.5, 0.3)).normalize();
  ch.twoBoneIK(`upperarm_${side}`, `forearm_${side}`, `hand_${side}`, t.position, pole);
  ch.setWorldRotation(`hand_${side}`, t.quaternion);
  ch.applyDrivers();
}
gizmo.addEventListener('objectChange', () => { const s = state.gizmoSide; if (s) solveIK(s); });
$('btnIKL').onclick = () => ikTarget('L');
$('btnIKR').onclick = () => ikTarget('R');
$('btnGizMode').onclick = (e) => { const m = gizmo.getMode() === 'translate' ? 'rotate' : 'translate'; gizmo.setMode(m); e.target.textContent = 'Gizmo: ' + (m === 'translate' ? 'move' : 'rotate'); };
for (const s of ['L', 'R']) {
  $('curl' + s).oninput = (e) => { holdPose(); const a = Number(e.target.value); for (const f of FINGERS) state.ch.curlFinger(s, f, a); state.ch.curlThumb(s, a * 0.7); state.ch.applyDrivers(); };
}
$('headTurn').oninput = (e) => {
  holdPose();
  const a = THREE.MathUtils.degToRad(Number(e.target.value));
  state.ch.setBasis('neck', new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a * 0.4));
  state.ch.setBasis('head', new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a * 0.6));
  state.ch.root.updateMatrixWorld(true);
};
function toggleHandProp(side) {
  const s = state.ch.sockets[`socket_hand_${side}_prop`];
  if (state.handProps[side]) { state.handProps[side].removeFromParent(); delete state.handProps[side]; return; }
  // test stick: grip section centred on the socket origin, blade along +Y (exits the thumb side)
  const g = new THREE.Group();
  g.userData.viewerOnly = true;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.12, 20), new THREE.MeshStandardMaterial({ color: 0x8a5a2b }));
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.008), new THREE.MeshStandardMaterial({ color: 0xc9d2de, metalness: 0.3, roughness: 0.4 }));
  blade.position.y = 0.33;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.03), new THREE.MeshStandardMaterial({ color: 0x444444 }));
  guard.position.y = 0.07;
  g.add(grip, blade, guard);
  s.add(g);
  state.handProps[side] = g;
}
$('btnPropL').onclick = () => toggleHandProp('L');
$('btnPropR').onclick = () => toggleHandProp('R');
$('btnCapture').onclick = () => {
  const ch = state.ch;
  const tracks = [];
  for (const b of ch.skeleton.bones) {
    tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, [0, 1 / 30], [...b.quaternion.toArray(), ...b.quaternion.toArray()]));
    if (b.name === 'pelvis' || b.name === 'root') tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.position`, [0, 1 / 30], [...b.position.toArray(), ...b.position.toArray()]));
  }
  const clip = new THREE.AnimationClip(`pose_capture_${++state.captured}`, 1 / 30, tracks);
  ch.clips.push(clip);
  buildClipUI();
  status(`captured ${clip.name} (baked FK incl. driven helpers) – included in Export GLB`);
};

// ---------------------------------------------------------------- export ---------
async function exportGLB() {
  const ch = state.ch;
  stopAnim();
  // exporters must see the true bind/rest pose and portable materials only
  const saved = {};
  for (const [n, b] of Object.entries(ch.bones)) saved[n] = [b.quaternion.clone(), b.position.clone()];
  ch.resetPose();
  const prevMode = state.matMode;
  if (state.upload) ch.setMaterial('texture', { map: state.upload }); else ch.setMaterial('original');
  const viewerOnly = [];
  ch.root.traverse((o) => { if (o.userData.viewerOnly) viewerOnly.push([o, o.parent]); });
  for (const [o] of viewerOnly) o.removeFromParent();
  for (const m of Object.values(ch.parts)) m.visible = true;
  const buf = await new GLTFExporter().parseAsync(ch.root, { binary: true, animations: ch.clips, onlyVisible: false, maxTextureSize: 4096 });
  for (const [o, p] of viewerOnly) p.add(o);
  for (const [n, [q, p]] of Object.entries(saved)) { ch.bones[n].quaternion.copy(q); ch.bones[n].position.copy(p); }
  state.matMode = prevMode; applyMaterial();
  return buf;
}
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); return a.href; }
function exportConfig() {
  const base = state.cfg ? JSON.parse(JSON.stringify(state.cfg)) : { schema: 'gamboligy.character/1.0' };
  const id = (base.characterId || 'character') + (state.upload ? '_textured' : '_export');
  Object.assign(base, {
    characterId: id, status: state.upload ? 'textured' : (base.status || 'draft'), frozen: false,
    created: new Date().toISOString(), exportedBy: 'viewer (GLTFExporter)',
    derivedFrom: state.cfg ? { characterId: state.cfg.characterId, geometryHash: state.cfg.geometry && state.cfg.geometry.hash, operation: state.upload ? 'base-colour texture applied in viewer' : 're-export' } : null,
  });
  base.material = Object.assign({}, base.material || {}, state.upload ? {
    mode: 'texture', baseColorFactor: [1, 1, 1, 1],
    baseColorTexture: { uri: 'embedded in GLB', name: state.upload.name, size: [state.upload.image.width, state.upload.image.height], embeddedInGlb: true, texCoord: 0 },
  } : {});
  base.animations = state.ch.clips.map((c) => ({ ...((state.cfg && state.cfg.animations || []).find((a) => a.name === c.name) || {}), name: c.name, duration: c.duration }));
  base.files = { glb: `${id}.glb` };
  return base;
}
// HOSTED: the published web version cannot start downloads or open tabs, so it keeps the
// export in memory and reloads it in place (a brand-new Character built only from the bytes).
const HOSTED = !!window.__CB_HOSTED;
$('btnExportGLB').onclick = async () => {
  const buf = await exportGLB();
  const cfg = exportConfig();
  state.exportBuf = buf;
  state.exportCfg = cfg;
  if (HOSTED) { status(`exported ${cfg.files.glb} (${(buf.byteLength / 1e6).toFixed(2)} MB) in memory – use Reload`); return; }
  state.exportUrl = download(new Blob([buf], { type: 'model/gltf-binary' }), cfg.files.glb);
  state.exportCfgUrl = URL.createObjectURL(new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' }));
  status(`exported ${cfg.files.glb} (${(buf.byteLength / 1e6).toFixed(2)} MB)`);
};
$('btnExportCfg').onclick = () => {
  const cfg = exportConfig();
  if (HOSTED) { status('JSON downloads are available in the local viewer (npm run viewer)'); return; }
  download(new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' }), `${cfg.characterId}.character.json`);
};
$('btnReload').onclick = async () => {
  if (!state.exportBuf) { status('Export a GLB first'); return; }
  if (HOSTED) {
    await loadCharacter(state.exportBuf.slice(0), state.exportCfg, null);
    status(`reloaded ${state.exportCfg.files.glb} from the exported bytes only`);
    return;
  }
  window.open(`index.html?glb=${encodeURIComponent(state.exportUrl)}&config=${encodeURIComponent(state.exportCfgUrl)}`, '_blank');
};

// ---------------------------------------------------------------- loop -----------
let frames = 0, fpsT = 0, fps = 0;
function tick() {
  requestAnimationFrame(tick);
  const dt = clock.getDelta();
  if (state.ch) {
    if (state.playing) state.ch.mixer.update(dt);
    if (state.clipAction && state.playing) $('scrub').value = state.clipAction.time;
  }
  orbit.update();
  renderer.render(scene, camera);
  frames++; fpsT += dt;
  if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
  if (state.ch && !params.get('hideui')) {
    const a = state.clipAction;
    $('status').textContent = `${fps.toFixed(0)} fps · ${a ? `${a.getClip().name} ${a.time.toFixed(2)}s` : 'posed/rest'}` +
      `${state.selected ? ' · ' + state.selected : ''} · material ${state.matMode}`;
  }
}

// ---------------------------------------------------------------- boot -----------
window.viewer = { THREE, renderer, scene, camera, orbit, state, loadCharacter, loadFromIndex, setView, applyMaterial, ikTarget, solveIK,
  playClip, exportGLB, exportConfig, setMaterialMode: (m) => { state.matMode = m; $('matSel').value = m; applyMaterial(); } };

async function boot() {
  resize();
  tick();
  try {
    const idx = await fetchJSON(`${ASSET_BASE}characters/index.json`);
    for (const c of idx.characters) { const o = document.createElement('option'); o.value = c.id; o.textContent = `${c.displayName} (${c.id})`; $('charSel').appendChild(o); }
  } catch (e) { /* standalone use */ }
  if (params.get('glb')) {
    const cfg = params.get('config') ? await fetchJSON(params.get('config')).catch(() => null) : null;
    await loadCharacter(params.get('glb'), cfg, params.get('props'));
  } else {
    const id = params.get('char') || 'master_blank';
    $('charSel').value = id;
    await loadFromIndex(id);
  }
  await loadWeapons();
  if (params.get('clip')) {
    playClip(params.get('clip'), Number(params.get('t') || 0), !params.get('t'));
  }
  if (params.get('mode')) window.viewer.setMaterialMode(params.get('mode'));
  if (params.get('view')) setView(params.get('view'));
  window.viewer.ready = true;
}
boot().catch((e) => { status('ERROR: ' + e.message); console.error(e); window.viewer.error = String(e); });
