// Guided artwork fitting. Extends the layered-PNG importer (layers.json + PNGs, or a ZIP of them): every
// painted layer is mapped to a slot/attachment, registered against the setup skeleton and installed into
// a separate skin (default "painted") as a replacement for the attachment it paints, so the starter skin
// stays selectable for comparison. A fit session works on a PREVIEW copy of the project; the editor
// commits it as one undoable step. Fit settings are stored in the project as a reusable template.
//
// Registration modes per layer:
//   replace     – new texture for an existing piece: keeps the displayed footprint, pivot, rotation and
//                 contact markers (a 2x PNG does not make the body or the weapon larger).
//   proportion  – the painted piece intentionally has new proportions: the art keeps its painted scale,
//                 its first joint anchor snaps onto the rig, and the rig's next joint moves to the
//                 art's second anchor (child bones and their art follow).
// Mesh per layer: rigid (armour plates, props), weighted (inherits the replaced piece's weights by
// barycentric transfer, or automatic weights when the piece was rigid).
import { Rig, affApply, affInv, affMul, affCompose, affDecompose, meshSamples, remapDeformKeys } from './core.js';
import { gridMesh, bleedEdges, pruneWeights, findTriangle, autoWeights } from './mesh.js';
import { decodeImage, encodePNG, meshCell } from './project-io.js';
import { readZip, textOf, toBytes } from './zip.js';
import { computeInverseBinds } from './schema.js';

export const FIT_SCHEMA = 'gamboligy.fit-template/1.0';
const R2D = 180 / Math.PI;

// ------------------------------------------------------------------ joints ----------
const JOINT_OF = { head: 'neck', neck: 'neck_base', chest: 'chest', spine_01: 'waist', pelvis: 'pelvis', upperarm: 'shoulder', forearm: 'elbow',
  hand: 'wrist', thigh: 'hip', shin: 'knee', foot: 'ankle', toe: 'toe', clavicle: 'clavicle', prop: 'grip' };
const NEXT = { upperarm: 'forearm', forearm: 'hand', hand: 'middle_01', thigh: 'shin', shin: 'foot', foot: 'toe', chest: 'neck', neck: 'head', spine_01: 'chest', pelvis: 'spine_01' };
const sideOf = (id) => (/_L$/.test(id) ? '_L' : /_R$/.test(id) ? '_R' : '');
const baseOf = (id) => id.replace(/_(L|R)$/, '');
/** Human name of a joint at the origin of bone `id` (shoulder_L, elbow_R, neck, …). */
export function jointName(id) { const b = baseOf(id), s = sideOf(id); return (JOINT_OF[b] || b) + s; }

/**
 * Two anchors for a slot: the joint at its bone's origin and the next joint down the chain (or the
 * bone tip when there is none). World positions are taken from the setup pose of `rig`.
 */
export function slotAnchors(project, rig, slotId) {
  const slot = project.slots.find((s) => s.id === slotId); if (!slot) return null;
  const b = slot.bone, s = sideOf(b), i = rig.boneIndex.get(b), W = rig.bindWorld[i];
  const nextId = NEXT[baseOf(b)] ? (NEXT[baseOf(b)].startsWith('middle') ? `middle_01${s}` : NEXT[baseOf(b)] + s) : null;
  const A = { name: jointName(b), bone: b, world: [W[4], W[5]] };
  if (nextId && rig.boneIndex.has(nextId)) { const N = rig.bindWorld[rig.boneIndex.get(nextId)]; return [A, { name: jointName(nextId), bone: nextId, world: [N[4], N[5]] }]; }
  const len = project.bones.find((x) => x.id === b)?.length || 40, tip = affApply(W, len, 0);
  return [A, { name: `${jointName(b)}_tip`, bone: null, world: tip }];
}

// ------------------------------------------------------------------ name mapping ----
const SYN = {
  helmet: ['helmet', 'helm', 'head', 'visor', 'casque'], cuirass: ['cuirass', 'breastplate', 'chest', 'chestplate', 'torso', 'body'],
  mantle: ['mantle', 'cape', 'cloak'], belt: ['belt', 'waist'], abdomen: ['abdomen', 'faulds', 'stomach', 'belly'],
  under_torso: ['undertorso', 'under_torso', 'undersuit', 'tunic'], upperarm: ['upperarm', 'pauldron', 'shoulder', 'rerebrace', 'upper_arm', 'arm_upper'],
  forearm: ['forearm', 'vambrace', 'bracer', 'lowerarm', 'lower_arm', 'arm_lower', 'couter'], hand: ['hand', 'gauntlet', 'palm', 'fist'],
  under_arm: ['underarm', 'under_arm', 'sleeve'], thigh: ['thigh', 'cuisse', 'upperleg', 'upper_leg', 'leg_upper'], shin: ['shin', 'greave', 'lowerleg', 'lower_leg', 'leg_lower', 'calf'],
  foot: ['foot', 'sabaton', 'boot', 'shoe'], tabard: ['tabard', 'skirt', 'loincloth'], under_leg: ['underleg', 'under_leg', 'legging', 'trousers'], under_foot: ['underfoot', 'under_foot', 'sock'],
  thumb: ['thumb'], index: ['index', 'pointer'], middle: ['middle'], ring: ['ring'], pinky: ['pinky', 'little'], head: ['head', 'face'],
  prop_R: ['sword', 'blade', 'staff', 'pistol', 'rifle', 'detonator', 'prop', 'weapon'],
};
const tokens = (s) => s.replace(/\.png$/i, '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Suggested target for a layer name: exact slot/attachment ids win; otherwise synonyms + side tokens.
 * Returns {slot, target, confidence, candidates:[{slot, target, score}], status: 'ok'|'ambiguous'|'unresolved'}.
 */
export function suggestMapping(project, layerName) {
  const raw = layerName.replace(/\.png$/i, ''), atts = project.attachments, slots = project.slots.map((s) => s.id);
  const asAtt = raw.replace(/__/g, '.').replace(/@.*$/, '');
  if (atts[asAtt]) return { slot: atts[asAtt].slot, target: asAtt, confidence: 1, candidates: [{ slot: atts[asAtt].slot, target: asAtt, score: 1 }], status: 'ok' };
  if (slots.includes(raw)) { const t = project.slots.find((s) => s.id === raw).attachment; return { slot: raw, target: t, confidence: 1, candidates: [{ slot: raw, target: t, score: 1 }], status: 'ok' }; }
  const tk = tokens(raw), side = tk.some((t) => t === 'l' || t === 'left') ? '_L' : tk.some((t) => t === 'r' || t === 'right') ? '_R' : null;
  const joined = tk.join('_'), cands = [];
  for (const slotId of slots) {
    const base = baseOf(slotId), s = sideOf(slotId), syn = SYN[base] || SYN[slotId] || [base];
    let score = 0;
    for (const w of syn) if (tk.includes(w) || joined.includes(w)) score = Math.max(score, w === base ? 0.9 : 0.75);
    if (!score) continue;
    if (s && side && s !== side) continue;
    if (s && !side) score -= 0.3;                           // a sided slot without a side token is ambiguous
    const variant = Object.keys(atts).find((id) => atts[id].slot === slotId && tk.includes(id.split('.')[1]));
    const slotAtt = project.slots.find((x) => x.id === slotId).attachment;
    const target = variant || (slotId === 'prop_R' ? Object.keys(atts).find((id) => atts[id].slot === 'prop_R' && tk.includes(id.split('.')[1].toLowerCase())) : slotAtt) || slotAtt;
    cands.push({ slot: slotId, target, score: +score.toFixed(2) });
  }
  cands.sort((a, b) => b.score - a.score);
  if (!cands.length) return { slot: null, target: null, confidence: 0, candidates: [], status: 'unresolved' };
  const top = cands[0], second = cands[1];
  const ambiguous = top.score < 0.6 || (second && top.score - second.score < 0.1);
  return { slot: top.slot, target: top.target, confidence: top.score, candidates: cands.slice(0, 6), status: ambiguous ? 'ambiguous' : 'ok' };
}

// ------------------------------------------------------------------ placement --------
/** World matrix of a layer's art space (x right, y up, origin at the pivot) from its fit. */
export function fitMatrix(fit) { return affCompose(fit.x, fit.y, fit.rotation, fit.scale * (fit.scaleX ?? 1), fit.scale * (fit.scaleY ?? 1)); }
const artPoint = (layer, ix, iy) => [(ix - layer.fit.pivot[0]) * (layer.fit.mirror ? -1 : 1), layer.fit.pivot[1] - iy];
export function imageToWorld(layer, ix, iy) { const p = artPoint(layer, ix, iy); return affApply(fitMatrix(layer.fit), p[0], p[1]); }
export function worldToImage(layer, wx, wy) {
  const p = affApply(affInv(fitMatrix(layer.fit)), wx, wy);
  return [p[0] * (layer.fit.mirror ? -1 : 1) + layer.fit.pivot[0], layer.fit.pivot[1] - p[1]];
}

/** Fit that reproduces an existing attachment's displayed footprint with an image of size w x h. */
export function footprintFit(project, rig, attId, w, h) {
  const a = project.attachments[attId], im = project.images[a.image], rec = rig.attachments.get(attId);
  const rx = w / im.w, ry = h / im.h, T = a.transform || {};
  const d = affDecompose(rec.place);                      // includes the bone's setup scale (e.g. a foreshortened prop)
  return { x: d.x, y: d.y, rotation: d.rotation, scale: (a.imageScale ?? 1), scaleX: d.scaleX / rx, scaleY: d.scaleY / ry,
    mirror: !!T.mirror, pivot: [a.pivot[0] * rx, a.pivot[1] * ry] };
}

/**
 * Fit from layers.json canvas coordinates: x, y = top-left of the layer's displayed footprint (canvas px),
 * optional rotation (degrees, about the layer centre), mirror, and per-layer scale = project px per layer px
 * (default: the canvas scale) with optional scaleX/scaleY. A PNG of another resolution than the listed w keeps
 * the listed displayed size.
 */
export function canvasFit(reg, L, w, h) {
  const s = reg.scale || 1, [ox, oy] = reg.origin, ls = (L.scale ?? s) * (L.w ? L.w / w : 1), sx = L.scaleX ?? 1, sy = L.scaleY ?? 1;
  const wc = w * ls * Math.abs(sx) / s, hc = h * ls * Math.abs(sy) / s;
  const cx = (L.x + wc / 2 - ox) * s, cy = (oy - (L.y + hc / 2)) * s;
  return { x: cx, y: cy, rotation: L.rotation || 0, scale: ls, scaleX: sx, scaleY: sy, mirror: !!L.mirror, pivot: [w / 2, h / 2] };
}

/**
 * Snap a layer onto the rig with its two anchors: anchor A lands on joint A, the A→B direction matches
 * the rig. replace mode also matches the A→B length (uniform scale); proportion mode keeps the scale.
 */
export function snapToJoints(layer, anchors) {
  const [JA, JB] = anchors, aA = artPoint(layer, ...layer.anchors.A), aB = artPoint(layer, ...layer.anchors.B);
  const u = [aB[0] - aA[0], aB[1] - aA[1]], v = [JB.world[0] - JA.world[0], JB.world[1] - JA.world[1]];
  const lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]); if (lu < 1e-6 || lv < 1e-6) return layer.fit;
  const f = layer.fit, sx = f.scaleX ?? 1, sy = f.scaleY ?? 1;
  const scale = layer.mode === 'proportion' ? f.scale : lv / Math.hypot(u[0] * sx, u[1] * sy);
  const rot = (Math.atan2(v[1], v[0]) - Math.atan2(u[1] * sy, u[0] * sx)) * R2D;
  const M = affCompose(0, 0, rot, scale * sx, scale * sy), pA = affApply(M, aA[0], aA[1]);
  layer.fit = { ...f, scale, rotation: rot, x: JA.world[0] - pA[0], y: JA.world[1] - pA[1] };
  return layer.fit;
}

// ------------------------------------------------------------------ session ---------
/**
 * Read a fitting source: PNG layers + layers.json, or a ZIP of them, or PNGs that match a saved
 * template (no layers.json needed). Returns {registration, layers:[{file, name, bytes, image, def}]}.
 */
export async function readFitSource(files, template = null) {
  const all = new Map();
  for (const [n, b] of files) {
    if (/\.zip$/i.test(n)) for (const [p, x] of await readZip(toBytes(b))) all.set(p.split('/').pop(), x);
    else all.set(n.split('/').pop(), toBytes(b));
  }
  let manifest = all.get('layers.json') ? JSON.parse(textOf(all.get('layers.json'))) : null;
  if (!manifest && template) {                             // re-fit: the template's files that were supplied, plus any new PNGs
    const known = template.layers.filter((l) => all.has(l.file)).map((l) => ({ file: l.file }));
    const extra = [...all.keys()].filter((n) => /\.png$/i.test(n) && !template.layers.some((l) => l.file === n)).map((file) => ({ file }));
    manifest = { canvas: template.canvas, origin: template.registration.origin, scale: template.registration.scale, layers: [...known, ...extra] };
  }
  if (!manifest) {                                          // loose PNGs only: placed on the slot by name
    manifest = { origin: [0, 0], scale: 1, layers: [...all.keys()].filter((n) => /\.png$/i.test(n)).map((file) => ({ file })) };
  }
  const reg = { origin: manifest.origin || [manifest.canvas?.w / 2 || 0, manifest.canvas?.h || 0], scale: manifest.scale || 1, canvas: manifest.canvas || null };
  const layers = [], problems = [];
  for (const L of manifest.layers || []) {
    const bytes = all.get(L.file);
    if (!bytes) { problems.push(`${L.file}: listed in layers.json but missing`); continue; }
    try { layers.push({ file: L.file, def: L, bytes, image: await decodeImage(bytes) }); }
    catch (e) { problems.push(`${L.file}: not a readable PNG (${e.message})`); }
  }
  return { registration: reg, layers, problems };
}

/** Build session layers with mapping suggestions and initial registration. */
export function planFit(project, source, { template = null, skin = 'painted' } = {}) {
  const rig = new Rig(project), byFile = new Map((template?.layers || []).map((l) => [l.file, l]));
  const layers = source.layers.map((src) => {
    const t = byFile.get(src.file), d = src.def, w = src.image.width, h = src.image.height;
    const sug = d.slot || d.target ? { slot: d.slot || project.attachments[d.target]?.slot, target: d.target || project.slots.find((s) => s.id === d.slot)?.attachment, confidence: 1, candidates: [], status: 'ok' }
      : t ? { slot: t.slot, target: t.target, confidence: 1, candidates: [], status: 'ok' } : suggestMapping(project, d.name ? `${d.slot || ''}_${d.name}` : src.file);
    const L = { file: src.file, bytes: src.bytes, image: src.image, w, h, slot: sug.slot, target: sug.target, mapping: sug, def: d,
      mode: t?.mode || d.mode || 'replace', mesh: t?.mesh || d.mesh || 'auto', fit: null, anchors: null, include: sug.status !== 'unresolved' };
    if (t?.fit) {                                            // template: same footprint for a re-painted file of any resolution
      const rx = w / (t.w || w), ry = h / (t.h || h);
      L.fit = { ...t.fit, scaleX: (t.fit.scaleX ?? 1) / rx, scaleY: (t.fit.scaleY ?? 1) / ry, pivot: [t.fit.pivot[0] * rx, t.fit.pivot[1] * ry] };
      L.anchors = t.anchors && { A: [t.anchors.A[0] * rx, t.anchors.A[1] * ry], B: [t.anchors.B[0] * rx, t.anchors.B[1] * ry] };
    } else resetFit(project, rig, L, source.registration);
    L.initialFit = JSON.stringify(L.fit);
    return L;
  });
  markDuplicates(layers);
  return { skin, registration: source.registration, layers, problems: source.problems || [] };
}

/** Two layers painting the same attachment: the best-matching one stays included, the others are flagged. */
export function markDuplicates(layers) {
  const by = new Map();
  for (const L of layers) if (L.target && L.include) {
    const prev = by.get(L.target);
    if (!prev) { by.set(L.target, L); continue; }
    const loser = (L.mapping.confidence ?? 0) > (prev.mapping.confidence ?? 0) ? prev : L;
    if (loser === prev) by.set(L.target, L);
    loser.include = false; loser.mapping = { ...loser.mapping, suggested: loser.mapping.status, status: 'duplicate' };
  }
  return layers;
}

/**
 * Initial registration: footprint of the replaced piece (replace mode), or the layers.json canvas placement
 * (position, rotation, mirror) when given — always in proportion mode — else the slot bone.
 */
export function resetFit(project, rig, L, reg) {
  const d = L.def || {};
  L.placementNote = null;
  if (L.target && project.attachments[L.target] && (L.mode === 'replace' || d.x == null)) {
    L.fit = footprintFit(project, rig, L.target, L.w, L.h);
    // replace mode keeps the displayed size of the piece it replaces; say so when layers.json placed it elsewhere
    if (d.x != null && reg) {
      const c = canvasFit(reg, d, L.w, L.h), dp = Math.hypot(c.x - L.fit.x, c.y - L.fit.y), dr = Math.abs(((c.rotation - L.fit.rotation + 540) % 360) - 180);
      if (dp > 1 || dr > 0.5) L.placementNote = `layers.json places this layer ${dp.toFixed(1)} px / ${dr.toFixed(1)}° away from the piece it replaces; replace mode uses the replaced piece's footprint — choose proportion to keep the layers.json placement`;
    }
  } else if (d.x != null && reg) L.fit = canvasFit(reg, d, L.w, L.h);
  else { const s = L.slot && project.slots.find((x) => x.id === L.slot), W = s ? rig.bindWorld[rig.boneIndex.get(s.bone)] : [1, 0, 0, 1, 0, 0]; L.fit = { x: W[4], y: W[5], rotation: 0, scale: reg?.scale || 1, scaleX: 1, scaleY: 1, mirror: false, pivot: [L.w / 2, L.h / 2] }; }
  const an = L.slot && slotAnchors(project, rig, L.slot);
  L.anchors = an ? { A: worldToImage(L, ...an[0].world), B: worldToImage(L, ...an[1].world) } : null;
  return L.fit;
}

/**
 * Install the session into a COPY of the project: one replacement attachment per layer in skin `skin`.
 * Returns {project, installed:[{layer, id}], store writes are done through `putImage(path, pngBytes)`}.
 */
export async function installFit(project, session, store) {
  const P = structuredClone(project), rig0 = new Rig(P);
  let sk = (P.skins ||= [{ id: 'default' }]).find((s) => s.id === session.skin);
  if (!sk) { sk = { id: session.skin, replace: {}, status: {}, note: 'painted skin installed by the fitting workflow' }; P.skins.push(sk); }
  sk.replace ||= {}; sk.status ||= {};
  const installed = [], proportion = [];
  for (const L of session.layers) {
    if (!L.include || !L.slot || !L.target || !P.attachments[L.target]) continue;
    const old = P.attachments[L.target], id = `${L.target}@${session.skin}`;
    if (!L._imgId) {                                        // once per session layer: a never-reused image path + mesh
      const img = new ImageData(new Uint8ClampedArray(L.image.data), L.w, L.h); bleedEdges(img.data, L.w, L.h, 2);
      const stem = id.replace(/[^\w.-]+/g, '_'); let imgId = stem, n = 2;
      while (project.images[imgId] || P.images[imgId] || store.has(`images/${imgId}.png`)) imgId = `${stem}__r${n++}`;
      const png = await encodePNG(img); store.set(`images/${imgId}.png`, png);
      const alpha = new Uint8Array(L.w * L.h); for (let i = 0; i < alpha.length; i++) alpha[i] = L.image.data[i * 4 + 3];
      Object.assign(L, { _imgId: imgId, _bytes: png.length, _mesh: gridMesh(alpha, L.w, L.h, { cell: meshCell(L.w, L.h), threshold: 6, margin: 2 }) });
    }
    const imgId = L._imgId, mesh = L._mesh;
    // re-fitting a piece that is already in the skin replaces its mesh: its own deformation keys are remapped
    const before = P.attachments[id] && rig0.attachments.get(id) ? { bind: Float64Array.from(rig0.attachments.get(id).bind), tris: P.attachments[id].triangles.slice() } : null;
    P.images[imgId] = { path: `images/${imgId}.png`, w: L.w, h: L.h, bytes: L._bytes };
    const bone = old.bone, bi = rig0.boneIndex.get(bone), f = L.fit;
    const T = affDecompose(affMul(affInv(rig0.bindWorld[bi]), fitMatrix({ ...f, scale: 1 })));
    // contact markers keep their world position: re-express them in the new image
    const markers = old.markers ? Object.fromEntries(Object.keys(old.markers).map((k) => { const w = rig0.markerWorld(old.id, k); return [k, w ? worldToImage(L, ...w).map((x) => +x.toFixed(2)) : old.markers[k]]; })) : null;
    const att = { id, name: `${old.slot} (${session.skin})`, slot: old.slot, type: 'region', bone, image: imgId, imageScale: f.scale, pivot: f.pivot.slice(),
      transform: { x: +T.x.toFixed(4), y: +T.y.toFixed(4), rotation: +T.rotation.toFixed(4), scaleX: +T.scaleX.toFixed(6), scaleY: +T.scaleY.toFixed(6), mirror: !!f.mirror },
      vertices: mesh.vertices.slice(), triangles: mesh.triangles.slice(), weights: null, visible: true, opacity: 1, tint: [1, 1, 1], blend: old.blend || 'normal',
      view: old.view, markers, source: { kind: 'painted', file: L.file, note: `fitted by the artwork fitting workflow (${L.mode})` },
      deformFrom: old.id,                                   // plays the replaced piece's deformation (cape flutter), resampled
      fit: { file: L.file, mode: L.mode, mesh: L.mesh, fit: f, anchors: L.anchors, w: L.w, h: L.h } };
    P.attachments[id] = att;
    const rig1 = new Rig(P), rec = rig1.attachments.get(id);
    if (before) remapDeformKeys(P, id, meshSamples(before.bind, before.tris, rec.bind));
    const wantWeights = L.mesh === 'weighted' || (L.mesh === 'auto' && old.weights);
    if (wantWeights) {
      if (old.weights) {                                    // barycentric transfer from the replaced piece
        const src = rig1.attachments.get(old.id).bind;
        att.weights = [];
        for (let v = 0; v < rec.nv; v++) {
          const x = rec.bind[v * 2], y = rec.bind[v * 2 + 1], hit = findTriangle(src, old.triangles, x, y);
          const acc = new Map(), mix = (i, k) => { const l = old.weights[i]; for (let j = 0; j < l.length; j += 2) acc.set(l[j], (acc.get(l[j]) || 0) + l[j + 1] * k); };
          if (hit) [0, 1, 2].forEach((k) => mix(old.triangles[hit.tri * 3 + k], hit.bc[k]));
          else { let bi2 = 0, bd = Infinity; for (let u = 0; u < src.length; u += 2) { const d = Math.hypot(src[u] - x, src[u + 1] - y); if (d < bd) { bd = d; bi2 = u / 2; } } mix(bi2, 1); }
          att.weights.push(pruneWeights(acc));
        }
      } else {
        const b0 = P.bones.find((b) => b.id === bone), ids = [bone, b0.parent, ...P.bones.filter((b) => b.parent === bone && b.kind === 'bone').map((b) => b.id)].filter(Boolean);
        const list = ids.map((bid) => { const m = rig1.bindWorld[rig1.boneIndex.get(bid)], len = P.bones.find((b) => b.id === bid).length || 10; return { id: bid, head: [m[4], m[5]], tail: affApply(m, len, 0) }; });
        const pts = []; for (let v = 0; v < rec.nv; v++) pts.push([rec.bind[v * 2], rec.bind[v * 2 + 1]]);
        att.weights = autoWeights(pts, list);
      }
      att.type = 'mesh';
    }
    sk.replace[L.target] = id; sk.status[L.target] = L.status || 'finished';
    installed.push({ layer: L.file, target: L.target, id });
    if (L.mode === 'proportion' && L.anchors) proportion.push(L);
  }
  // proportion fits move the rig's next joint onto the art's second anchor (children and their art follow)
  for (const L of proportion) {
    const rig = new Rig(P), an = slotAnchors(P, rig, L.slot); if (!an?.[1]?.bone) continue;
    const child = P.bones.find((b) => b.id === an[1].bone), parent = rig.boneIndex.get(child.parent);
    const want = imageToWorld(L, ...L.anchors.B), lp = affApply(affInv(rig.bindWorld[parent]), want[0], want[1]);
    child.setup.x = +lp[0].toFixed(3); child.setup.y = +lp[1].toFixed(3);
  }
  for (const [k, v] of Object.entries(sk.status)) if (!sk.replace[k] && v === 'finished') delete sk.status[k];
  computeInverseBinds(P);
  // one template per skin, merged by target: re-fitting part of a skin keeps the rest of its mapping
  P.fitting ||= { templates: {} }; P.fitting.templates ||= {};
  const prev = P.fitting.templates[session.skin], cur = templateOf(P, session);
  if (prev) cur.layers = [...prev.layers.filter((l) => !cur.layers.some((c) => c.target === l.target)), ...cur.layers];
  P.fitting.templates[session.skin] = cur; P.fitting.last = session.skin;
  return { project: P, installed };
}
/** Reusable mapping + registration template (no pixels): reload with re-painted PNGs only. */
export function templateOf(project, session) {
  return { schema: FIT_SCHEMA, character: project.characterId, skin: session.skin, registration: { origin: session.registration?.origin || [0, 0], scale: session.registration?.scale || 1 },
    canvas: session.registration?.canvas || null,
    layers: session.layers.filter((L) => L.include && L.target).map((L) => ({ file: L.file, slot: L.slot, target: L.target, mode: L.mode, mesh: L.mesh, w: L.w, h: L.h, fit: L.fit, anchors: L.anchors, status: L.status || 'finished' })) };
}
