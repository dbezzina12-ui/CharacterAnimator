// Gamboligy 2D character core — shared by the 2D editor (viewer/js/art2d) and the standalone runtime.
// Pure JavaScript, no dependencies, deterministic: evaluate(clip, t) depends only on the project data,
// the clip, the time and explicit options — never on the previously evaluated frame.
//
// Coordinates: project pixels, +x right, +y up, origin = ground point under the character.
// Angles: degrees, counter-clockwise. Affine 2D matrices: [a, b, c, d, tx, ty] mapping
// (x, y) -> (a*x + c*y + tx, b*x + d*y + ty).

export const SCHEMA = 'gamboligy.character2d/1.0';
export const RUNTIME_SCHEMA = 'gamboligy.character2d-runtime/1.0';
export const MAX_INFLUENCES = 4;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// ------------------------------------------------------------------ 2D affine ------
export function affCompose(x, y, rotDeg, sx = 1, sy = 1) {
  const c = Math.cos(rotDeg * D2R), s = Math.sin(rotDeg * D2R);
  return [c * sx, s * sx, -s * sy, c * sy, x, y];
}
export function affMul(m, n) {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
export function affInv(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error('singular 2D transform');
  const i = 1 / det;
  return [m[3] * i, -m[1] * i, -m[2] * i, m[0] * i,
    (m[2] * m[5] - m[3] * m[4]) * i, (m[1] * m[4] - m[0] * m[5]) * i];
}
export function affApply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
export function affRot(m) { return Math.atan2(m[1], m[0]) * R2D; }
/** Decompose into {x, y, rotation, scaleX, scaleY} (scaleY negative when mirrored). */
export function affDecompose(m) {
  const sx = Math.hypot(m[0], m[1]);
  const rot = Math.atan2(m[1], m[0]);
  const det = m[0] * m[3] - m[1] * m[2];
  const sy = det / (sx || 1);
  return { x: m[4], y: m[5], rotation: rot * R2D, scaleX: sx, scaleY: sy };
}
export function wrapDeg(a) { a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : a; }

// ------------------------------------------------------------------ tracks ----------
// Tracks are columnar: { t: [times...], <field>: [values...] }. Numeric fields interpolate linearly;
// `v` of step tracks (attachment, drawOrder) holds the value from its key until the next key.
export function keyIndex(times, t) {
  let lo = 0, hi = times.length - 1;
  if (hi < 0 || t < times[0]) return -1;
  if (t >= times[hi]) return hi;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
  return lo;
}
/**
 * Per-key easing of the segment that starts at key i: tr.ease = ['linear'|'smooth'|'in'|'out'|'step', ...]
 * (missing = linear). 'step' holds the value until the next key (crisp impacts).
 */
export function easeU(tr, i, u) {
  const e = tr.ease?.[i];
  if (!e || e === 'linear') return u;
  if (e === 'step') return 0;
  if (e === 'smooth') return u * u * (3 - 2 * u);
  if (e === 'in') return u * u;
  if (e === 'out') return 1 - (1 - u) * (1 - u);
  return u;
}
/** Sample of numeric field `f` (linear unless eased); undefined when the track has no keys. */
export function sampleField(tr, f, t) {
  const T = tr.t, V = tr[f];
  if (!T || !T.length || !V) return undefined;
  const i = keyIndex(T, t);
  if (i < 0) return V[0];
  if (i >= T.length - 1) return V[T.length - 1];
  const u = easeU(tr, i, (t - T[i]) / (T[i + 1] - T[i]));
  return V[i] + (V[i + 1] - V[i]) * u;
}
/** Linear sample of vector values (arrays of equal length) in field `v`. */
export function sampleVector(tr, t) {
  const T = tr.t, V = tr.v;
  if (!T || !T.length) return undefined;
  const i = keyIndex(T, t);
  if (i < 0) return V[0];
  if (i >= T.length - 1) return V[T.length - 1];
  const u = easeU(tr, i, (t - T[i]) / (T[i + 1] - T[i])), a = V[i], b = V[i + 1];
  if (a == null || b == null) return u < 1 ? a : b;
  const out = new Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = a[k] + (b[k] - a[k]) * u;
  return out;
}
export function sampleStep(tr, t) {
  if (!tr || !tr.t || !tr.t.length) return undefined;
  const i = keyIndex(tr.t, t);
  return i < 0 ? undefined : tr.v[i];
}
/** Insert or replace a key at time t (within 1e-4 s). `values` maps field -> value. */
export function setKey(tr, t, values) {
  tr.t ||= [];
  const eps = 1e-4;
  let i = tr.t.findIndex((x) => Math.abs(x - t) < eps);
  if (i < 0) {
    i = tr.t.findIndex((x) => x > t);
    if (i < 0) i = tr.t.length;
    tr.t.splice(i, 0, t);
    for (const f of Object.keys(values)) { tr[f] ||= []; tr[f].splice(i, 0, values[f]); }
    for (const f of Object.keys(tr)) if (f !== 't' && !(f in values) && Array.isArray(tr[f]) && tr[f].length < tr.t.length) {
      tr[f].splice(i, 0, f === 'ease' ? (tr[f][Math.max(0, i - 1)] ?? 'linear') : (tr[f][Math.max(0, i - 1)] ?? 0));
    }
  } else {
    for (const f of Object.keys(values)) { tr[f] ||= []; tr[f][i] = values[f]; }
  }
  return i;
}
export function deleteKey(tr, t) {
  const i = (tr.t || []).findIndex((x) => Math.abs(x - t) < 1e-4);
  if (i < 0) return false;
  for (const f of Object.keys(tr)) if (Array.isArray(tr[f])) tr[f].splice(i, 1);
  return true;
}
/**
 * Barycentric samples of the points `dst` inside the mesh (`src` vertices, `srcTris`), all in the same space
 * (bind space): per point [[srcVertex, weight], ...]. Points outside the source mesh take the nearest source
 * vertex. Used to carry weights and deformation keys across a re-mesh, and to let replacement art play the
 * deformation of the piece it replaces.
 */
export function meshSamples(src, srcTris, dst) {
  const out = [];
  for (let v = 0; v < dst.length; v += 2) {
    const x = dst[v], y = dst[v + 1];
    let hit = null;
    for (let i = 0; i < srcTris.length && !hit; i += 3) {
      const a = srcTris[i], b = srcTris[i + 1], c = srcTris[i + 2];
      const ax = src[a * 2], ay = src[a * 2 + 1], bx = src[b * 2], by = src[b * 2 + 1], cx = src[c * 2], cy = src[c * 2 + 1];
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(d) < 1e-12) continue;
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, l3 = 1 - l1 - l2;
      if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) hit = [[a, l1], [b, l2], [c, l3]].filter(([, w]) => w > 1e-9);
    }
    if (!hit) { let bi = 0, bd = Infinity; for (let u = 0; u < src.length; u += 2) { const dd = (src[u] - x) ** 2 + (src[u + 1] - y) ** 2; if (dd < bd) { bd = dd; bi = u / 2; } } hit = [[bi, 1]]; }
    out.push(hit);
  }
  return out;
}

/**
 * After the mesh of `attId` changed topology, resample every deformation key of it (all clips, bake and
 * corrections) through `samples` = meshSamples(old bind, old triangles, new bind). Easing/disabled flags are
 * kept. Returns the number of tracks remapped. Keys are never left with another mesh's vertex count.
 */
export function remapDeformKeys(project, attId, samples) {
  let n = 0;
  for (const clip of project.clips || []) for (const layer of [clip.tracks, clip.corrections]) {
    const tr = layer?.deform?.[attId]; if (!tr) continue;
    tr.v = tr.v.map((off) => (off == null ? off : samples.flatMap((near) => [0, 1].map((ax) => +near.reduce((sum, [i, k]) => sum + (off[i * 2 + ax] || 0) * k, 0).toFixed(3)))));
    n++;
  }
  return n;
}

/** Does any clip (bake or corrections) key deformation of `attId`? */
export function hasDeformKeys(project, attId) {
  return (project.clips || []).some((c) => !!(c.tracks?.deform?.[attId] || c.corrections?.deform?.[attId]));
}

/** Frame times for baking/export at `fps`: a looping clip never repeats its first frame at the end. */
export function frameTimes(duration, fps, loop) {
  const n = Math.max(1, Math.round(duration * fps));
  const out = [];
  for (let i = 0; i < (loop ? n : n + 1); i++) out.push(Math.min(duration, i / fps));
  return out;
}

// ------------------------------------------------------------------ rig -------------
const HAND_FIELDS = ['curl', 'thumb', 'index', 'middle', 'ring', 'pinky'];
function emptyLayer() { return { bones: {}, slots: {}, drawOrder: { t: [], v: [] }, deform: {}, hands: {}, handSets: {}, constraints: {}, events: [] }; }
export function ensureLayer(l) {
  const e = emptyLayer();
  for (const k of Object.keys(e)) if (l[k] == null) l[k] = e[k];
  return l;
}

/**
 * Runtime/editor representation built from a project (gamboligy.character2d/1.0) or a runtime package.
 * The project JSON stays the source of truth; call rebuild() (or rebuildAttachment) after edits.
 */
export class Rig {
  constructor(project) { this.project = project; this.rebuild(); }

  rebuild() {
    const P = this.project;
    // ---- bones (parents first)
    const src = P.bones, byId = new Map(src.map((b) => [b.id, b]));
    const order = [], seen = new Set();
    const visit = (b) => {
      if (seen.has(b.id)) return;
      if (b.parent) { const p = byId.get(b.parent); if (!p) throw new Error(`bone ${b.id}: unknown parent ${b.parent}`); visit(p); }
      seen.add(b.id); order.push(b);
    };
    src.forEach(visit);
    this.bones = order;
    this.boneIndex = new Map(order.map((b, i) => [b.id, i]));
    const n = order.length;
    this.parent = new Int32Array(n);
    this.setup = new Float64Array(n * 5);
    order.forEach((b, i) => {
      this.parent[i] = b.parent ? this.boneIndex.get(b.parent) : -1;
      const s = b.setup;
      this.setup.set([s.x, s.y, s.rotation, s.scaleX ?? 1, s.scaleY ?? 1], i * 5);
    });
    this.local = new Float64Array(this.setup);
    this.world = order.map(() => [1, 0, 0, 1, 0, 0]);
    this.worldRot = new Float64Array(n);
    this.updateWorld();
    this.bindWorld = this.world.map((m) => m.slice());
    this.invBind = this.bindWorld.map(affInv);
    this.skinMats = order.map(() => [1, 0, 0, 1, 0, 0]);
    // ---- slots & attachments
    this.slots = P.slots.slice();
    this.slotIndex = new Map(this.slots.map((s, i) => [s.id, i]));
    this.setupOrder = this.slots.map((s) => s.id);
    this.attachments = new Map(); this.deformFromIds = new Set();
    for (const a of Object.values(P.attachments)) this.rebuildAttachment(a.id);
    this.constraints = (P.constraints || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    this.hands = P.hands || {};
    // hand view sets: { L: { sets: { open_back: { view, pose, slots: { hand_L: attId, thumb_L: attId, ... } } } } }
    this.handViews = P.handViews || {};
    this.handSlotSide = new Map();
    for (const [side, hv] of Object.entries(this.handViews)) for (const set of Object.values(hv.sets || {})) for (const sl of Object.keys(set.slots || {})) this.handSlotSide.set(sl, side);
    this.clips = new Map((P.clips || []).map((c) => [c.name, c]));
    this.setSkin(this.skinId || 'default');
  }

  /**
   * Skins are attachment replacement maps: { id, replace: { attachmentId: replacementId } }. They apply to
   * setup AND keyed attachments, so a repainted skin inherits every clip's hand/prop swaps.
   */
  setSkin(id) {
    const sk = (this.project.skins || []).find((s) => s.id === id);
    this.skinId = sk ? id : 'default';
    this.skinMap = sk?.replace || {};
    return this.skinId;
  }

  bone(id) { return this.bones[this.boneIndex.get(id)]; }

  updateWorld() {
    const L = this.local, W = this.world, WR = this.worldRot, par = this.parent;
    for (let i = 0; i < this.bones.length; i++) {
      const o = i * 5, p = par[i];
      let x = L[o], y = L[o + 1], r = L[o + 2];
      if (p >= 0) { const m = W[p]; const px = m[0] * x + m[2] * y + m[4], py = m[1] * x + m[3] * y + m[5]; x = px; y = py; r += WR[p]; }
      WR[i] = r;
      const c = Math.cos(r * D2R), s = Math.sin(r * D2R), sx = L[o + 3], sy = L[o + 4], m = W[i];
      m[0] = c * sx; m[1] = s * sx; m[2] = -s * sy; m[3] = c * sy; m[4] = x; m[5] = y;
    }
  }

  /** Bind-space (setup world) vertices of an attachment, weights resolved to bone indices. */
  rebuildAttachment(id) {
    const a = this.project.attachments[id];
    if (!a) { this.attachments.delete(id); return null; }
    const nv = a.vertices.length / 2;
    const bi = this.boneIndex.get(a.bone);
    if (bi === undefined) throw new Error(`attachment ${id}: unknown bone ${a.bone}`);
    const T = a.transform || {};
    const place = affMul(this.bindWorld[bi], affCompose(T.x || 0, T.y || 0, T.rotation || 0, T.scaleX ?? 1, T.scaleY ?? 1));
    const s = a.imageScale ?? 1, px = a.pivot?.[0] ?? 0, py = a.pivot?.[1] ?? 0, mir = T.mirror ? -1 : 1;
    const bind = new Float64Array(nv * 2);
    for (let v = 0; v < nv; v++) {
      const lx = (a.vertices[v * 2] - px) * s * mir, ly = (py - a.vertices[v * 2 + 1]) * s;
      bind[v * 2] = place[0] * lx + place[2] * ly + place[4];
      bind[v * 2 + 1] = place[1] * lx + place[3] * ly + place[5];
    }
    const wb = new Int16Array(nv * MAX_INFLUENCES).fill(-1), ww = new Float32Array(nv * MAX_INFLUENCES);
    for (let v = 0; v < nv; v++) {
      const list = a.weights ? a.weights[v] : null;
      if (!list || !list.length) { wb[v * MAX_INFLUENCES] = bi; ww[v * MAX_INFLUENCES] = 1; continue; }
      let k = 0, sum = 0;
      for (let j = 0; j < list.length && k < MAX_INFLUENCES; j += 2) {
        const b = this.boneIndex.get(list[j]);
        if (b === undefined) throw new Error(`attachment ${id}: weight bone ${list[j]} not in skeleton`);
        wb[v * MAX_INFLUENCES + k] = b; ww[v * MAX_INFLUENCES + k] = list[j + 1]; sum += list[j + 1]; k++;
      }
      if (!(sum > 0)) { wb[v * MAX_INFLUENCES] = bi; ww[v * MAX_INFLUENCES] = 1; continue; }
      for (let j = 0; j < k; j++) ww[v * MAX_INFLUENCES + j] /= sum;
    }
    const rec = { def: a, bind, uvs: null, tris: a.triangles.slice(), wb, ww, place, nv };
    this.attachments.set(id, rec);
    (this.deformFromIds ||= new Set());
    if (a.deformFrom && a.deformFrom !== id) this.deformFromIds.add(id); else this.deformFromIds.delete(id);
    return rec;
  }

  // ---------------------------------------------------------------- evaluation -----
  /**
   * Evaluate the pose at time t of `clip` (object or name, or null for the setup/bind pose).
   * Layers, in order: setup -> clip.tracks (offsets) -> clip.corrections (additive) -> opts.override.
   * Then world transforms, then constraints in their declared order.
   * opts: { corrections=true, override:{bone:{rotate,x,y,scaleX,scaleY}}, hands:{L:{curl,...}},
   *         slotAttachments:{slot:att|null}, drawOrder:[slotIds], constraints:{id:mix}, props:{slot:att|null} }
   */
  evaluate(clip, t = 0, opts = {}) {
    if (typeof clip === 'string') clip = this.clips.get(clip) || null;
    const L = this.local;
    L.set(this.setup);
    const layers = [];
    if (clip) {
      if (clip.tracks) layers.push(clip.tracks);
      if (opts.corrections !== false && clip.corrections) layers.push(clip.corrections);
    }
    for (const layer of layers) this._applyBones(layer.bones, t);
    // hand controls (semantic finger curls) — additive rotations on the finger chains
    const hands = {};
    for (const side of Object.keys(this.hands)) {
      const hv = { curl: 0, thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
      for (const layer of layers) {
        const tr = layer.hands?.[side];
        if (tr && tr.t?.length && !tr.disabled) for (const f of HAND_FIELDS) { const v = sampleField(tr, f, t); if (v !== undefined) hv[f] += v; }
      }
      const o = opts.hands?.[side];
      if (o) for (const f of HAND_FIELDS) if (o[f] !== undefined) hv[f] += o[f];
      hands[side] = hv;
      this._applyHand(side, hv);
    }
    if (opts.override) for (const [id, o] of Object.entries(opts.override)) {
      const i = this.boneIndex.get(id); if (i === undefined) continue;
      const k = i * 5;
      if (o.x) L[k] += o.x; if (o.y) L[k + 1] += o.y; if (o.rotate) L[k + 2] += o.rotate;
      if (o.scaleX) L[k + 3] *= o.scaleX; if (o.scaleY) L[k + 4] *= o.scaleY;
    }
    // slots: attachment + colour
    const nS = this.slots.length;
    const slotAttachment = new Array(nS), slotColor = new Array(nS);
    // hand view sets (palm + finger layers swapped together): per layer, a keyed set overrides that layer's
    // slot keys for the slots it names; later layers (corrections) win; opts.handSets wins over all
    const handSets = {};
    for (const side of Object.keys(this.handViews)) {
      let set; for (const layer of layers) { if (layer.handSets?.[side]?.disabled) continue; const v = sampleStep(layer.handSets?.[side], t); if (v !== undefined) set = v; }
      if (opts.handSets?.[side] !== undefined) set = opts.handSets[side];
      if (set != null && this.handViews[side].sets?.[set]) handSets[side] = set;
    }
    for (let i = 0; i < nS; i++) {
      const s = this.slots[i];
      let att = s.attachment ?? null, col = s.color || [1, 1, 1, 1];
      const hs = this.handSlotSide.get(s.id);
      for (const layer of layers) {
        const st = layer.slots?.[s.id];
        if (st && !st.disabled) {
          const a = sampleStep(st.attachment, t); if (a !== undefined) att = a;
          if (st.color?.t?.length) col = sampleVector(st.color, t);
        }
        if (hs && !layer.handSets?.[hs]?.disabled) { const v = sampleStep(layer.handSets?.[hs], t), m = v != null && this.handViews[hs].sets?.[v]?.slots; if (m && s.id in m) att = m[s.id]; }
      }
      if (hs && opts.handSets?.[hs] != null) { const m = this.handViews[hs].sets?.[opts.handSets[hs]]?.slots; if (m && s.id in m) att = m[s.id]; }
      if (opts.props && s.id in opts.props) att = opts.props[s.id];
      if (opts.slotAttachments && s.id in opts.slotAttachments) att = opts.slotAttachments[s.id];
      if (att && this.skinMap[att]) att = this.skinMap[att];
      slotAttachment[i] = att; slotColor[i] = col;
    }
    this.updateWorld();
    // constraints
    const contacts = [];
    for (const c of this.constraints) {
      let mix = c.mix ?? 1;
      for (const layer of layers) { const tr = layer.constraints?.[c.id]; if (tr && tr.t?.length && !tr.disabled) mix = sampleField(tr, 'v', t); }
      if (opts.constraints && opts.constraints[c.id] !== undefined) mix = opts.constraints[c.id];
      if (c.enabled === false) mix = 0;
      contacts.push(this.solveConstraint(c, mix, slotAttachment));
    }
    // draw order: auto keys (clip.tracks) unless a correction key is active
    let order = this.setupOrder;
    const auto = clip?.tracks?.drawOrder ? sampleStep(clip.tracks.drawOrder, t) : undefined;
    if (auto) order = auto;
    if (opts.corrections !== false && clip?.corrections?.drawOrder && !clip.corrections.drawOrder.disabled) {
      const manual = sampleStep(clip.corrections.drawOrder, t);
      if (manual) order = manual;
    }
    if (opts.drawOrder) order = opts.drawOrder;
    const drawOrder = resolveOrder(order, this.setupOrder).map((id) => this.slotIndex.get(id));
    // deform offsets (bind space), additive across layers
    const deform = new Map();
    let deformSkipped = null;
    for (const layer of layers) for (const [attId, tr] of Object.entries(layer.deform || {})) {
      if (tr.disabled) continue;
      const v = sampleVector(tr, t); if (!v) continue;
      // keys made for another mesh (wrong vertex count) are skipped and reported, never skinned into garbage
      const rec = this.attachments.get(attId);
      if (!rec || v.length !== rec.nv * 2) { (deformSkipped ||= new Set()).add(attId); continue; }
      const prev = deform.get(attId);
      if (!prev) deform.set(attId, Float64Array.from(v));
      else for (let k = 0; k < v.length; k++) prev[k] += v[k];
    }
    // replacement art (painted skin pieces, re-imported layers) plays the deformation of the piece it
    // replaces (`deformFrom`), resampled onto its own mesh; its own keys, if any, add on top
    if (this.deformFromIds?.size) {
      const done = new Set();
      for (let pass = 0; pass < 4; pass++) for (const id of this.deformFromIds) {
        if (done.has(id)) continue;
        const from = this.attachments.get(id)?.def.deformFrom;
        if (this.deformFromIds.has(from) && !done.has(from)) continue;          // chains: source first
        done.add(id);
        const src = deform.get(from), S = src && this.deformSamples(id, from); if (!S) continue;
        const own = deform.get(id), out = own || new Float64Array(S.length * 2);
        for (let v = 0; v < S.length; v++) { let x = 0, y = 0; for (const [i, k] of S[v]) { x += src[i * 2] * k; y += src[i * 2 + 1] * k; } out[v * 2] += x; out[v * 2 + 1] += y; }
        if (!own) deform.set(id, out);
      }
    }
    for (let i = 0; i < this.bones.length; i++) {
      const w = this.world[i], b = this.invBind[i], m = this.skinMats[i];
      m[0] = w[0] * b[0] + w[2] * b[1]; m[1] = w[1] * b[0] + w[3] * b[1];
      m[2] = w[0] * b[2] + w[2] * b[3]; m[3] = w[1] * b[2] + w[3] * b[3];
      m[4] = w[0] * b[4] + w[2] * b[5] + w[4]; m[5] = w[1] * b[4] + w[3] * b[5] + w[5];
    }
    return { t, clip: clip?.name ?? null, slotAttachment, slotColor, drawOrder, deform, contacts, hands, handSets, ...(deformSkipped ? { deformSkipped: [...deformSkipped] } : {}) };
  }

  _applyBones(bones, t) {
    if (!bones) return;
    const L = this.local;
    for (const [id, tr] of Object.entries(bones)) {
      const i = this.boneIndex.get(id); if (i === undefined || tr.disabled) continue;
      const k = i * 5;
      if (tr.rotate?.t?.length) L[k + 2] += sampleField(tr.rotate, 'v', t);
      if (tr.translate?.t?.length) { L[k] += sampleField(tr.translate, 'x', t); L[k + 1] += sampleField(tr.translate, 'y', t); }
      if (tr.scale?.t?.length) { L[k + 3] *= sampleField(tr.scale, 'x', t); L[k + 4] *= sampleField(tr.scale, 'y', t); }
    }
  }

  _applyHand(side, hv) {
    const def = this.hands[side]; if (!def) return;
    for (const [finger, f] of Object.entries(def.fingers || {})) {
      const c = Math.max(-0.25, Math.min(1.2, hv.curl * (f.curlShare ?? 1) + (hv[finger] || 0)));
      if (!c) continue;
      f.bones.forEach((id, k) => {
        const i = this.boneIndex.get(id); if (i === undefined) return;
        this.local[i * 5 + 2] += (f.sign ?? 1) * (f.maxDeg?.[k] ?? 60) * c;
      });
    }
  }

  /** Marker of an attachment (image px) in its bone's local space. */
  markerLocal(attId, name) {
    const a = this.project.attachments[attId], m = a?.markers?.[name];
    if (!m) return null;
    const T = a.transform || {}, s = a.imageScale ?? 1, mir = T.mirror ? -1 : 1;
    const lx = (m[0] - (a.pivot?.[0] ?? 0)) * s * mir, ly = ((a.pivot?.[1] ?? 0) - m[1]) * s;
    return affApply(affCompose(T.x || 0, T.y || 0, T.rotation || 0, T.scaleX ?? 1, T.scaleY ?? 1), lx, ly);
  }

  /** World position of an attachment marker for the current pose. */
  markerWorld(attId, name) {
    const a = this.project.attachments[attId]; if (!a) return null;
    const lp = this.markerLocal(attId, name); if (!lp) return null;
    return affApply(this.world[this.boneIndex.get(a.bone)], lp[0], lp[1]);
  }

  worldPoint(boneId, x = 0, y = 0) { return affApply(this.world[this.boneIndex.get(boneId)], x, y); }

  /**
   * Planar two-bone IK (e.g. a support hand onto a prop marker). The chain end keeps its world
   * rotation, so an effector offset from it (a hand socket) lands on the target. Bone lengths are the
   * current (possibly foreshortened) lengths: no stretch. Bend direction is kept unless c.bend = +1/-1.
   */
  solveConstraint(c, mix, slotAttachment = null) {
    const out = { id: c.id, mix, error: 0, reachable: true };
    if (c.type !== 'ik2' || !(mix > 0)) return out;
    const I = (id) => this.boneIndex.get(id);
    const ui = I(c.bones[0]), li = I(c.bones[1]), ei = I(c.end), fi = I(c.effector || c.end), ti = I(c.target.bone);
    if ([ui, li, ei, fi, ti].some((x) => x === undefined)) { out.error = NaN; out.reachable = false; return out; }
    const W = this.world, pos = (i) => [W[i][4], W[i][5]];
    let tp = c.target.point || [0, 0];
    if (c.target.marker) {                    // a named marker on whatever the target slot currently shows
      const si = this.slotIndex.get(c.target.slot);
      const att = si !== undefined && slotAttachment ? slotAttachment[si] : null;
      const lp = att ? this.markerLocal(att, c.target.marker) : null;
      if (!lp) { out.mix = 0; out.error = 0; out.note = 'no marker'; return out; }
      tp = lp;
    }
    const T = affApply(W[ti], tp[0], tp[1]);
    const E0 = pos(fi), C0 = pos(ei);
    const Tc = [T[0] - (E0[0] - C0[0]), T[1] - (E0[1] - C0[1])];      // where the chain end must go
    const A = pos(ui), B = pos(li);
    const l1 = Math.hypot(B[0] - A[0], B[1] - A[1]), l2 = Math.hypot(C0[0] - B[0], C0[1] - B[1]);
    const dx = Tc[0] - A[0], dy = Tc[1] - A[1], d = Math.hypot(dx, dy);
    out.reach = l1 + l2; out.distance = d;
    out.reachable = d <= (l1 + l2) * (1 + 1e-6) && d >= Math.abs(l1 - l2) * (1 - 1e-6);
    const dc = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6);
    let bend = c.bend;
    if (bend !== 1 && bend !== -1) {
      const cr = (B[0] - A[0]) * (C0[1] - B[1]) - (B[1] - A[1]) * (C0[0] - B[0]);
      bend = cr >= 0 ? -1 : 1;   // keep the current side of the elbow/knee
    }
    const alpha = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc))));
    const phi = Math.atan2(dy, dx);
    const th1 = (phi + bend * alpha) * R2D, g1 = Math.atan2(B[1] - A[1], B[0] - A[0]) * R2D;
    const d1 = wrapDeg(th1 - g1) * mix;
    const keepEnd = this.worldRot[ei];
    this.local[ui * 5 + 2] += d1;
    this.updateWorld();
    const B2 = pos(li), C2 = pos(ei);
    const th2 = Math.atan2(Tc[1] - B2[1], Tc[0] - B2[0]) * R2D, g2 = Math.atan2(C2[1] - B2[1], C2[0] - B2[0]) * R2D;
    const d2 = wrapDeg(th2 - g2) * mix;
    this.local[li * 5 + 2] += d2;
    this.updateWorld();
    if (c.keepEndRotation !== false) { this.local[ei * 5 + 2] += keepEnd - this.worldRot[ei]; this.updateWorld(); }
    const E = pos(fi);
    out.error = Math.hypot(E[0] - T[0], E[1] - T[1]);
    return out;
  }

  /** Samples of attachment `id`'s bind vertices in the bind mesh of `from` (cached per mesh pair). */
  deformSamples(id, from) {
    const dst = this.attachments.get(id), src = this.attachments.get(from); if (!dst || !src) return null;
    const c = (this._deformSamples ||= new Map()).get(id);
    if (c && c.dst === dst && c.src === src) return c.S;
    const S = meshSamples(src.bind, src.tris, dst.bind);
    this._deformSamples.set(id, { dst, src, S });
    return S;
  }

  /** Deformed vertex positions (world px) of attachment `id` for the last evaluate(). */
  skinAttachment(id, pose, out) {
    const r = this.attachments.get(id); if (!r) return null;
    const nv = r.nv, bind = r.bind, wb = r.wb, ww = r.ww, M = this.skinMats;
    const def = pose?.deform?.get(id);
    out ||= new Float32Array(nv * 2);
    for (let v = 0; v < nv; v++) {
      const x = bind[v * 2] + (def ? def[v * 2] : 0), y = bind[v * 2 + 1] + (def ? def[v * 2 + 1] : 0);
      let px = 0, py = 0;
      for (let k = 0; k < MAX_INFLUENCES; k++) {
        const w = ww[v * MAX_INFLUENCES + k]; if (!w) continue;
        const m = M[wb[v * MAX_INFLUENCES + k]];
        px += w * (m[0] * x + m[2] * y + m[4]); py += w * (m[1] * x + m[3] * y + m[5]);
      }
      out[v * 2] = px; out[v * 2 + 1] = py;
    }
    return out;
  }

  /** Visible draw list for a pose: [{slot, slotIndex, attachment, color, blend}] back to front. */
  drawList(pose) {
    const list = [];
    for (const si of pose.drawOrder) {
      const s = this.slots[si], att = pose.slotAttachment[si];
      if (!att || s.visible === false) continue;
      const a = this.project.attachments[att];
      if (!a || a.visible === false) continue;
      const c = pose.slotColor[si], tint = a.tint || [1, 1, 1];
      list.push({ slot: s.id, slotIndex: si, attachment: att,
        color: [c[0] * tint[0], c[1] * tint[1], c[2] * tint[2], c[3] * (a.opacity ?? 1)], blend: a.blend || s.blend || 'normal' });
    }
    return list;
  }
}

/** Complete a (possibly partial / stale) order with any setup slots it misses, in setup position. */
export function resolveOrder(order, setup) {
  if (order === setup) return setup.slice();
  const have = new Set(), out = [];
  const known = new Set(setup);
  for (const id of order) if (known.has(id) && !have.has(id)) { out.push(id); have.add(id); }
  for (let i = 0; i < setup.length; i++) {
    const id = setup[i]; if (have.has(id)) continue;
    let at = 0;                                   // after the nearest setup predecessor already placed
    for (let j = i - 1; j >= 0; j--) { const k = out.indexOf(setup[j]); if (k >= 0) { at = k + 1; break; } }
    out.splice(at, 0, id); have.add(id);
  }
  return out;
}

// ------------------------------------------------------------------ playback --------
/**
 * Clip playback with named events. Event rule (documented in ART2D.md): during update(dt) an event
 * fires when playback time crosses it, i.e. prev < eventTime <= now (a looping clip wraps and fires
 * the events of both sides of the loop point; an event at exactly 0 fires when a loop wraps or when
 * play() starts at 0). seek() never fires events; eventsBetween(a, b) lists them for tools.
 */
export class Player {
  constructor(rig) { this.rig = rig; this.clip = null; this.time = 0; this.speed = 1; this.loop = true; this.playing = false; this.listeners = []; }
  on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }
  get duration() { return this.clip ? this.clip.duration : 0; }
  play(name, { loop, time = 0 } = {}) {
    this.clip = this.rig.clips.get(name) || null;
    if (!this.clip) throw new Error(`unknown clip ${name}`);
    this.loop = loop ?? !!this.clip.loop; this.time = time; this.playing = true;
    if (time === 0) this._emit(this.clip.tracks?.events?.filter((e) => e.t === 0) || []);
    return this;
  }
  pause() { this.playing = false; }
  resume() { if (this.clip) this.playing = true; }
  seek(t) { if (this.clip) this.time = Math.max(0, Math.min(this.duration, t)); }
  eventsBetween(a, b) {
    const ev = (this.clip?.tracks?.events || []).concat(this.clip?.corrections?.events || []);
    return ev.filter((e) => e.t > a && e.t <= b).sort((x, y) => x.t - y.t);
  }
  update(dt) {
    if (!this.clip || !this.playing || !(dt > 0)) return [];
    const d = this.duration, prev = this.time;
    let now = prev + dt * this.speed, fired = [];
    if (now >= d) {
      if (this.loop && d > 0) {
        fired = this.eventsBetween(prev, d);
        const wraps = Math.floor(now / d);
        now -= wraps * d;
        const ev0 = (this.clip.tracks?.events || []).filter((e) => e.t === 0);
        fired = fired.concat(ev0, this.eventsBetween(0, now));
      } else { fired = this.eventsBetween(prev, d); now = d; this.playing = false; }
    } else fired = this.eventsBetween(prev, now);
    this.time = now;
    this._emit(fired);
    return fired;
  }
  _emit(list) { for (const e of list) for (const fn of this.listeners) fn({ name: e.name, time: e.t, data: e.data, clip: this.clip.name }); }
  evaluate(opts) { return this.rig.evaluate(this.clip, this.time, opts); }
}
