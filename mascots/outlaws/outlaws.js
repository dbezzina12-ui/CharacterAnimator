// Idle animation for two painted characters: each cutout becomes a skinned deformation mesh
// (Three.js SkinnedMesh, weights from distance to hand-placed bones) driven by layered procedural
// motion. Everything is a function of time: deterministic, scrubbable, no simulation state.
import * as THREE from 'three';
import { RANGER, GUNSLINGER } from './rigs.js';

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const deg = (d) => d * Math.PI / 180;
/** Smooth organic noise in [-1,1]: a few incommensurate sines, seeded by phase. */
const noise = (t, s = 0) => (Math.sin(t * 1.0 + s) * 0.5 + Math.sin(t * 2.3 + s * 1.7 + 1.3) * 0.3 + Math.sin(t * 0.47 + s * 0.9 + 2.1) * 0.2);
/** Loop-safe noise: harmonics of the loop length L, so the signal repeats exactly every L seconds. */
const lnoise = (t, s, L, ks = [1, 2, 3]) => ks.reduce((acc, k, i) => acc + Math.sin(2 * Math.PI * k * t / L + s * (1.3 + i) + i * 1.7) / (i + 1), 0) / ks.reduce((a, _, i) => a + 1 / (i + 1), 0);
/** A periodic "event" envelope: 1 during a short window every `period` seconds, eased. */
const pulse = (t, period, width, offset = 0) => { const u = ((t + offset) % period + period) % period; return u < width ? Math.sin(Math.PI * u / width) : 0; };

const PX = 100;   // pixels per scene unit

// ---------------------------------------------------------------- puppet construction
async function loadTexture(url) {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.anisotropy = 4;
  return tex;
}
function alphaMap(image, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0, w, h); return g.getImageData(0, 0, w, h).data;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

export function buildPuppet(def, texture, { cols = 48, rows = 88, blend = 0.09 } = {}) {
  const W = def.width, H = def.height;
  const alpha = alphaMap(texture.image, W, H);
  const cellW = W / cols, cellH = H / rows;
  // keep cells that contain any visible pixel (plus one neighbour for the soft edge)
  const cellUsed = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let used = false;
    for (let y = Math.floor(r * cellH); y < Math.min(H, (r + 1) * cellH) && !used; y += 2) for (let x = Math.floor(c * cellW); x < Math.min(W, (c + 1) * cellW); x += 2) if (alpha[(y * W + x) * 4 + 3] > 4) { used = true; break; }
    cellUsed[r * cols + c] = used ? 1 : 0;
  }
  const dil = cellUsed.slice();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (cellUsed[r * cols + c]) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) dil[rr * cols + cc] = 1; }
  // vertices
  const nv = (cols + 1) * (rows + 1);
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), sIdx = new Uint16Array(nv * 4), sW = new Float32Array(nv * 4);
  const bones = def.bones;
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
    const i = r * (cols + 1) + c; const px = c * cellW, py = r * cellH;
    pos[i * 3] = (px - W / 2) / PX; pos[i * 3 + 1] = (H - py) / PX; pos[i * 3 + 2] = 0;
    uv[i * 2] = px / W; uv[i * 2 + 1] = 1 - py / H;
    // weights: each bone owns the region where it is the nearest (distance normalised by its radius);
    // a softmax with a small temperature gives a narrow blend seam, so plates, mask and gauntlets stay rigid
    const scores = bones.map((b, bi) => [-segDist(px, py, b[2], b[3], b[4], b[5]) / b[6], bi]).sort((a, b) => b[0] - a[0]).slice(0, 4);
    const best = scores[0][0];
    const ws = scores.map(([sc, bi]) => [Math.exp((sc - best) / blend), bi]);
    const sum = ws.reduce((s, w) => s + w[0], 0);
    for (let k = 0; k < 4; k++) { sIdx[i * 4 + k] = ws[k][1]; sW[i * 4 + k] = ws[k][0] / sum; }
  }
  const idx = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (dil[r * cols + c]) { const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1; idx.push(a, d, b, b, d, e); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(sIdx, 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(sW, 4));
  geo.setIndex(idx);
  // skeleton: bones at their heads, parented
  const boneObjs = bones.map((b) => { const bone = new THREE.Bone(); bone.name = b[0]; return bone; });
  const toScene = (x, y) => new THREE.Vector3((x - W / 2) / PX, (H - y) / PX, 0);
  bones.forEach((b, i) => {
    const head = toScene(b[2], b[3]);
    if (b[1] === null) boneObjs[i].position.copy(head);
    else { const p = bones.findIndex((q) => q[0] === b[1]); boneObjs[p].add(boneObjs[i]); boneObjs[i].position.copy(head).sub(toScene(bones[p][2], bones[p][3])); }
    boneObjs[i].userData.rest = boneObjs[i].position.clone();
  });
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.02, side: THREE.DoubleSide });
  const eye = def.eyes;
  mat.onBeforeCompile = (shader) => {   // mesh-squash blink: vertices near the eyes collapse toward the eye line
    shader.uniforms.uBlink = { value: 0 };
    shader.uniforms.uEyeC = { value: eye ? toScene(eye.center[0], eye.center[1]) : new THREE.Vector3(99, 99, 0) };
    shader.uniforms.uEyeR = { value: eye ? new THREE.Vector2(eye.radius[0] / PX, eye.radius[1] / PX) : new THREE.Vector2(1, 1) };
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec2 q = (transformed.xy - uEyeC.xy) / uEyeR; float m = 1.0 - smoothstep(0.35, 1.0, length(q));
        transformed.y = mix(transformed.y, uEyeC.y + (transformed.y - uEyeC.y) * 0.08, uBlink * m); }`);
    shader.vertexShader = 'uniform float uBlink; uniform vec3 uEyeC; uniform vec2 uEyeR;\n' + shader.vertexShader;
    mat.userData.shader = shader;
  };
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.add(boneObjs[0]); mesh.bind(new THREE.Skeleton(boneObjs));
  mesh.frustumCulled = false;
  const byName = Object.fromEntries(boneObjs.map((b) => [b.name, b]));
  // glowing lights attached to the head/body: additive sprites in bone space
  const lights = [];
  for (const l of def.lights || []) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(l.color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
    const bone = l.at[1] < 300 ? byName.head : (l.at[0] < W / 2 ? byName.hand_L : byName.hand_R);
    // place in bone-local space (bones have identity rotation at bind)
    const world = toScene(l.at[0], l.at[1]); const bw = new THREE.Vector3(); bone.getWorldPosition(bw);
    mesh.updateMatrixWorld(true); bone.getWorldPosition(bw);
    sp.position.copy(world).sub(bw); sp.scale.set(l.size / PX * 3, l.size / PX * 3, 1); bone.add(sp); lights.push(sp);
  }
  return { def, mesh, bones: byName, boneList: boneObjs, lights, W, H, toScene };
}
function glowTexture(color) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64); grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.2, color); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- idle motion
/** Pose a puppet for time t. amount scales everything (0 = still). */
export function idle(p, t, amount = 1, seed = 0, L = 0) {
  const B = p.bones; const s = seed;
  if (L) return idleLoop(p, t, amount, seed, L);
  const set = (name, { rot = 0, x = 0, y = 0, sx = 1, sy = 1 } = {}) => {
    const b = B[name]; if (!b) return;
    b.rotation.z = rot * amount; b.position.set(b.userData.rest.x + x * amount / PX, b.userData.rest.y + y * amount / PX, 0); b.scale.set(mix(1, sx, amount), mix(1, sy, amount), 1);
  };
  const breath = Math.sin(t * 2 * Math.PI / 4.2 + s);                     // 4.2 s breath cycle
  const breathIn = (breath + 1) / 2;
  const shift = noise(t * 0.18, s + 3);                                  // slow weight shift
  const glance = pulse(t, 9.5, 2.6, s * 2) * (seed ? -1 : 1);            // an occasional look to the side
  const gust = Math.max(0, noise(t * 0.5, s + 7)) ** 2;                  // wind gusts on the coat
  set('root', { x: shift * 6 });
  set('pelvis', { rot: deg(-0.6) * shift, y: Math.abs(shift) * -3 + breathIn * -1.5 });
  set('spine', { rot: deg(0.8) * shift + deg(0.4) * breath, sy: 1 + 0.012 * breathIn });
  set('chest', { rot: deg(0.6) * breath - deg(0.4) * shift, y: 4 * breathIn, sx: 1 + 0.018 * breathIn, sy: 1 + 0.02 * breathIn });
  set('neck', { rot: deg(-1.2) * breath });
  set('head', { rot: deg(2.2) * noise(t * 0.35, s + 1) + deg(4.5) * glance - deg(0.8) * breath, y: -2 * breathIn });
  set('hair', { rot: deg(3) * noise(t * 1.6, s + 11) + deg(4) * gust * noise(t * 4, s + 12) });
  set('hat', { rot: deg(0.6) * noise(t * 0.5, s + 13), y: 1.5 * breathIn });
  set('scarf', { rot: deg(2.5) * noise(t * 1.1, s + 5) + deg(5) * gust * noise(t * 3.2, s + 6) });
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1, k = side === 'L' ? 21 : 31;
    set(`shoulder_${side}`, { y: -5 * breathIn, rot: deg(0.6) * breath * sg });
    set(`upperarm_${side}`, { rot: deg(1.4) * noise(t * 0.25, s + k) * sg + deg(1.0) * breath * sg });
    set(`forearm_${side}`, { rot: deg(1.0) * noise(t * 0.3, s + k + 1) * sg });
    set(`hand_${side}`, { rot: deg(2.0) * noise(t * 0.4, s + k + 2) * sg, sy: 1 - 0.05 * Math.max(0, noise(t * 0.9, s + k + 3)) });   // fingers flex
    set(`thigh_${side}`, { rot: deg(-0.5) * shift * sg });
    set(`coat_${side}1`, { rot: (deg(1.6) * noise(t * 0.7, s + k + 4) + deg(3.5) * gust * noise(t * 2.1, s + k + 5)) * sg });
    set(`coat_${side}2`, { rot: (deg(2.6) * noise(t * 0.9, s + k + 6) + deg(6) * gust * noise(t * 2.6, s + k + 7)) * sg });
  }
  // blink: quick double-blink every ~5 s (ranger only; the gunslinger has no eyelids)
  const blink = p.def.eyes ? Math.max(pulse(t, 5.3, 0.22, s), pulse(t, 5.3, 0.22, s + 0.3) * (pulse(t, 21, 1, s) > 0 ? 1 : 0)) : 0;
  const sh = p.mesh.material.userData.shader; if (sh) sh.uniforms.uBlink.value = blink * amount;
  // lights: a slow pulse with a flicker
  p.lights.forEach((l, i) => { l.material.opacity = 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2.4 + i)) + 0.15 * noise(t * 9, s + i) ; });
}

/** Perfectly looping idle: every term is a whole number of cycles over L seconds (two breaths, one
 *  weight shift, one glance, blinks on fixed beats), so frame 0 and frame L are identical. */
export function idleLoop(p, t, amount, seed, L) {
  const B = p.bones; const s = seed; const u = ((t % L) + L) % L; const ph = u / L;
  const set = (name, { rot = 0, x = 0, y = 0 } = {}) => {
    const b = B[name]; if (!b) return;
    b.rotation.z = rot * amount; b.position.set(b.userData.rest.x + x * amount / PX, b.userData.rest.y + y * amount / PX, 0);
  };
  const breath = Math.sin(2 * Math.PI * 2 * ph + s);                    // two breaths per loop
  const breathIn = (breath + 1) / 2;
  const late = (Math.sin(2 * Math.PI * 2 * ph + s - 0.6) + 1) / 2;      // the head follows the chest a beat later
  const shift = Math.sin(2 * Math.PI * ph + s + 0.4);                   // one weight shift per loop
  const glance = pulse(u, L, 2.4, -L * 0.55) * (seed ? -1 : 1);
  const gust = Math.max(0, lnoise(u, s + 7, L, [2, 3, 5])) ** 2;
  const n = (sd, ks) => lnoise(u, s + sd, L, ks);
  // feet stay planted; the hips drift a few pixels and the torso counters, like a person standing still
  set('pelvis', { x: 3 * shift, rot: deg(-0.35) * shift });
  set('spine', { rot: deg(0.45) * shift, y: 1.5 * breathIn });
  set('chest', { rot: deg(-0.3) * shift, y: 3 * breathIn });
  set('neck', { y: 1 * late });
  set('head', { rot: deg(1.2) * n(1, [1, 2]) + deg(3) * glance, y: 2 * late });
  set('hair', { rot: deg(3) * n(11, [3, 5, 7]) + deg(5) * gust * n(12, [7, 11]) });
  set('hat', { rot: deg(0.4) * n(13, [1, 2]) });
  set('scarf', { rot: deg(2) * n(5, [2, 3, 5]) + deg(4) * gust * n(6, [7, 9]) });
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1, k = side === 'L' ? 21 : 31;
    set(`shoulder_${side}`, { y: 3 * breathIn });
    set(`upperarm_${side}`, { rot: deg(0.9) * n(k, [1, 2]) * sg + deg(0.5) * breath * sg, y: 3 * breathIn });
    set(`forearm_${side}`, { rot: deg(0.7) * n(k + 1, [1, 3]) * sg });
    set(`hand_${side}`, { rot: deg(1.4) * n(k + 2, [1, 2]) * sg });
    set(`thigh_${side}`, { rot: deg(-0.25) * shift * sg });
    set(`coat_${side}1`, { rot: (deg(1.0) * n(k + 4, [2, 3]) + deg(2.0) * gust * n(k + 5, [5, 7])) * sg });
    set(`coat_${side}2`, { rot: (deg(1.6) * n(k + 6, [2, 3, 5]) + deg(3.5) * gust * n(k + 7, [7, 9])) * sg });
  }
  const sh = p.mesh.material.userData.shader; if (sh) sh.uniforms.uBlink.value = 0;
  p.lights.forEach((l, i) => { l.material.opacity = 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * ph + i)) + 0.15 * lnoise(u, s + i, L, [11, 13, 17]); });
}

// ---------------------------------------------------------------- scene
export async function createScene(canvas, defs = [RANGER, GUNSLINGER], { loop = 8, exportMode = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50); camera.position.z = 10;
  const puppets = [];
  const textures = await Promise.all(defs.map((d) => loadTexture(new URL(d.image, import.meta.url).href)));
  defs.forEach((d, i) => {
    const p = buildPuppet(d, textures[i]); scene.add(p.mesh); puppets.push(p);
    // backdrop glow behind each character
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(d.glow.color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35 }));
    glow.scale.set(9, 11, 1); glow.position.set(0, d.height / PX * 0.5, -1); p.glow = glow; scene.add(glow);
  });
  // dust motes
  const N = 140; const dpos = new Float32Array(N * 3); for (let i = 0; i < N; i++) { dpos.set([(Math.random() - 0.5) * 20, Math.random() * 11, 0.5], i * 3); }
  const dust = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(dpos, 3)), new THREE.PointsMaterial({ color: 0xffd9a0, size: 0.05, transparent: true, opacity: 0.55, depthWrite: false }));
  scene.add(dust);
  // bone overlay
  const overlay = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x4dff9a, depthTest: false, transparent: true, opacity: 0.9 })); overlay.renderOrder = 10; overlay.visible = false; scene.add(overlay);
  const wire = puppets.map((p) => { const w = new THREE.Mesh(p.mesh.geometry, new THREE.MeshBasicMaterial({ color: 0x66ccff, wireframe: true, transparent: true, opacity: 0.35, depthTest: false })); return w; });

  const state = { time: 0, playing: true, amount: 1, speed: 1, showBones: false, showMesh: false, layout: 'both', loop, exportMode };
  if (exportMode) { dust.visible = false; puppets.forEach((p) => { p.glow.visible = false; }); }
  function layout() {
    const w = canvas.clientWidth, h = canvas.clientHeight; const aspect = w / h;
    const shown = puppets.filter((p) => state.layout === 'both' || p.def.name === state.layout);
    puppets.forEach((p) => { p.mesh.visible = shown.includes(p); p.glow.visible = p.mesh.visible && !state.exportMode; });
    const charH = Math.max(...puppets.map((p) => p.H)) / PX; const gap = state.exportMode ? 0 : 1.2;
    if (state.exportMode && shown.length === 1) { const p = shown[0]; const padX = 0.6, padY = 0.35; const vw = p.W / PX + 2 * padX, vh = p.H / PX + padY; camera.left = -vw / 2; camera.right = vw / 2; camera.top = vh; camera.bottom = -0.02; camera.updateProjectionMatrix(); p.mesh.position.x = 0; renderer.setSize(w, h, false); return; }
    const totalW = shown.reduce((s, p) => s + p.W / PX, 0) + gap * (shown.length - 1);
    const viewH = charH * 1.12, viewW = Math.max(viewH * aspect, totalW * 1.1);
    const scale = Math.min(1, viewH * aspect / (totalW * 1.08));
    camera.left = -viewW / 2 / scale; camera.right = viewW / 2 / scale; camera.top = viewH / scale - charH * 0.06 / scale; camera.bottom = -charH * 0.06 / scale; camera.updateProjectionMatrix();
    let x = -totalW / 2;
    for (const p of shown) { const cx = x + p.W / PX / 2; p.mesh.position.x = cx; p.glow.position.x = cx; x += p.W / PX + gap; }
    renderer.setSize(w, h, false);
  }
  new ResizeObserver(layout).observe(canvas); layout();

  function render() {
    puppets.forEach((p, i) => { idle(p, state.time, state.amount, i * 1.37, state.loop); p.glow.material.opacity = 0.3 + 0.1 * Math.sin(state.time * 0.8 + i); });
    const dp = dust.geometry.attributes.position; for (let i = 0; i < N; i++) { dp.setY(i, (dpos[i * 3 + 1] + state.time * 0.08 + Math.sin(state.time * 0.3 + i) * 0.1) % 11); dp.setX(i, dpos[i * 3] + Math.sin(state.time * 0.2 + i * 1.3) * 0.3); } dp.needsUpdate = true;
    if (state.showBones) {
      const pts = []; const a = new THREE.Vector3(), b = new THREE.Vector3();
      for (const p of puppets) if (p.mesh.visible) for (const bone of p.boneList) { if (!bone.parent || !(bone.parent instanceof THREE.Bone)) continue; bone.getWorldPosition(a); bone.parent.getWorldPosition(b); pts.push(b.x, b.y, 2, a.x, a.y, 2); }
      overlay.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); overlay.visible = true;
    } else overlay.visible = false;
    wire.forEach((w, i) => { w.visible = state.showMesh && puppets[i].mesh.visible; if (w.visible) { w.position.copy(puppets[i].mesh.position); w.position.z = 1; } });
    renderer.render(scene, camera);
  }
  wire.forEach((w) => scene.add(w));
  let last = performance.now();
  function tick(now) { const dt = Math.min(0.1, (now - last) / 1000); last = now; if (state.playing) { state.time += dt * state.speed; if (state.loop) state.time %= state.loop; } render(); requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
  const api = { state, puppets, layout, seek(t) { state.time = t; state.playing = false; render(); }, render };
  window.Outlaws = api; return api;
}
