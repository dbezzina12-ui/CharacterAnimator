// Draw order from real 3D occlusion. Every slot's 3D geometry is rendered from the art camera into a
// slot-ID buffer, then once more keeping only fragments of a different slot than the first layer (a slot-aware depth peel). Each pixel
// where slot A is the first layer and slot B the second is one vote "A over B". The per-frame order is
// the previous order, re-sorted only where the votes clearly disagree (hysteresis), so contacts such as
// fingers wrapped around a grip sort correctly and near-ties never flicker.
import * as THREE from 'three';

const N = 128;
const VS = `#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
uniform float uSlot[${N}]; uniform float uFixed;
flat varying float vId;
void main(){
#include <morphinstance_vertex>
#include <skinbase_vertex>
#include <begin_vertex>
#include <morphtarget_vertex>
#include <skinning_vertex>
#include <project_vertex>
 vId = uFixed;
#ifdef USE_SKINNING
 float bw = 0.0;
 for (int k = 0; k < 4; k++) { float w = skinWeight[k]; float s = uSlot[int(skinIndex[k])]; if (s > 0.0 && w > bw) { bw = w; vId = s; } }
#endif
}`;
// second pass: the nearest fragment of a DIFFERENT slot than the first layer (so stacked plates of one
// slot never hide which other slot lies underneath)
const FS = `uniform sampler2D uFirst; uniform vec2 uRes; uniform float uPeel;
flat varying float vId;
void main(){
 if (uPeel > 0.5) { float first = floor(texture2D(uFirst, gl_FragCoord.xy / uRes).r * 255.0 + 0.5); if (abs(first - vId) < 0.5) discard; }
 gl_FragColor = vec4(vId / 255.0, 0.0, 0.0, 1.0);
}`;

export class Occlusion {
  /** rect: project-px rectangle [x0, y0, x1, y1] to analyse; scale: analysis px per project px. */
  constructor(renderer, artCam, rect, scale = 0.4) {
    this.r = renderer; this.rect = rect;
    this.w = Math.ceil((rect[2] - rect[0]) * scale); this.h = Math.ceil((rect[3] - rect[1]) * scale);
    this.cam = artCam.threeCamera(rect[0], rect[1], rect[2], rect[3]);
    const opt = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, samples: 0, depthBuffer: true };
    this.rt1 = new THREE.WebGLRenderTarget(this.w, this.h, opt);
    this.rt2 = new THREE.WebGLRenderTarget(this.w, this.h, { ...opt, depthBuffer: true });
    this.buf1 = new Uint8Array(this.w * this.h * 4); this.buf2 = new Uint8Array(this.w * this.h * 4);
    this.entries = new Map();          // mesh -> {mat, fixed}
    this.slotIds = [];                 // index-1 -> slot id
  }

  _code(slot) { let i = this.slotIds.indexOf(slot); if (i < 0) { this.slotIds.push(slot); i = this.slotIds.length - 1; } return i + 1; }

  /** Register a mesh: `fixed` = its slot; `boneSlots` (skinned) = {boneName: slot} overriding per vertex. */
  add(mesh, fixed, boneSlots = null) {
    const arr = new Float32Array(N);
    if (mesh.isSkinnedMesh && boneSlots) mesh.skeleton.bones.forEach((b, i) => { if (i < N && boneSlots[b.name]) arr[i] = this._code(boneSlots[b.name]); });
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSlot: { value: arr }, uFixed: { value: this._code(fixed) }, uFirst: { value: null },
        uRes: { value: new THREE.Vector2(this.w, this.h) }, uPeel: { value: 0 } },
      vertexShader: VS, fragmentShader: FS, blending: THREE.NoBlending, side: mesh.material?.side ?? THREE.FrontSide,
    });
    const old = this.entries.get(mesh); if (old) old.mat.dispose();
    this.entries.set(mesh, { mat });
  }
  remove(mesh) { const e = this.entries.get(mesh); if (e) { e.mat.dispose(); this.entries.delete(mesh); } }

  /** Votes for the current pose of `root`: Map "a|b" -> pixels where slot a is directly over slot b. */
  votes(root) {
    const r = this.r, saved = [];
    root.traverse((o) => {
      if (!o.isMesh && !o.isLine && !o.isPoints) return;
      const e = this.entries.get(o);
      saved.push([o, o.visible, o.material]);
      if (e && o.visible !== false && isShown(o)) { o.material = e.mat; o.visible = true; } else o.visible = false;
    });
    const prevRT = r.getRenderTarget(), cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
    const scene = new THREE.Scene(), parent = root.parent;
    scene.add(root);
    try {
      r.setClearColor(0x000000, 0);
      for (const e of this.entries.values()) { e.mat.uniforms.uPeel.value = 0; e.mat.uniforms.uFirst.value = null; }
      r.setRenderTarget(this.rt1); r.clear(); r.render(scene, this.cam);
      r.readRenderTargetPixels(this.rt1, 0, 0, this.w, this.h, this.buf1);
      for (const e of this.entries.values()) { e.mat.uniforms.uPeel.value = 1; e.mat.uniforms.uFirst.value = this.rt1.texture; }
      r.setRenderTarget(this.rt2); r.clear(); r.render(scene, this.cam);
      r.readRenderTargetPixels(this.rt2, 0, 0, this.w, this.h, this.buf2);
    } finally {
      if (parent) parent.add(root); else scene.remove(root);
      r.setRenderTarget(prevRT); r.setClearColor(cc, ca);
      for (const [o, v, m] of saved) { o.visible = v; o.material = m; }
    }
    const out = new Map(), b1 = this.buf1, b2 = this.buf2, ids = this.slotIds;
    for (let i = 0; i < b1.length; i += 4) {
      const a = b1[i], b = b2[i];
      if (!a || !b || a === b) continue;
      const k = ids[a - 1] + '|' + ids[b - 1];
      out.set(k, (out.get(k) || 0) + 1);
    }
    this.lastCoverage = coverage(b1, ids);
    return out;
  }

  dispose() { this.rt1.dispose(); this.rt2.dispose(); for (const e of this.entries.values()) e.mat.dispose(); this.entries.clear(); }
}

function isShown(o) { for (let p = o; p; p = p.parent) if (p.visible === false && p !== o) return false; return true; }
function coverage(buf, ids) { const c = new Map(); for (let i = 0; i < buf.length; i += 4) if (buf[i]) { const s = ids[buf[i] - 1]; c.set(s, (c.get(s) || 0) + 1); } return c; }

/**
 * New draw order (back -> front) from occlusion votes. A pair keeps its previous relative order unless the
 * opposite vote wins by a clear margin (minPx + share * total), `above` pairs [a, b] (a over b) always hold.
 * Ties and unrelated slots keep the previous order (stable topological sort).
 */
export function solveOrder(prev, votes, { above = [], minPx = 3, share = 0.2 } = {}) {
  const pos = new Map(prev.map((id, i) => [id, i]));
  const before = new Map(prev.map((id) => [id, new Set()]));   // id -> slots that must be drawn before it
  const seen = new Set();
  for (const key of votes.keys()) {
    const [a, b] = key.split('|');
    if (!pos.has(a) || !pos.has(b)) continue;
    const pk = a < b ? a + '|' + b : b + '|' + a; if (seen.has(pk)) continue; seen.add(pk);
    const vab = votes.get(a + '|' + b) || 0, vba = votes.get(b + '|' + a) || 0, T = minPx + share * (vab + vba);
    let aOver = pos.get(a) > pos.get(b);
    if (aOver && vba > vab + T) aOver = false; else if (!aOver && vab > vba + T) aOver = true;
    if (aOver) before.get(a).add(b); else before.get(b).add(a);
  }
  for (const [a, b] of above) if (pos.has(a) && pos.has(b)) { before.get(a).add(b); before.get(b).delete(a); }
  const out = [], placed = new Set(), rest = prev.slice();
  while (rest.length) {
    let k = rest.findIndex((id) => [...before.get(id)].every((x) => placed.has(x)));
    if (k < 0) k = 0;                                   // cycle: keep the earliest remaining slot's place
    const id = rest.splice(k, 1)[0]; out.push(id); placed.add(id);
  }
  return out;
}
