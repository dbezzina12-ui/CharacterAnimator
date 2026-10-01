// Loading / saving 2D projects and importing layered artwork. Every file of a project lives in an
// AssetStore (project-relative path -> bytes) so a project opened from a folder URL, a ZIP or a fresh
// import saves identically, and nothing ever references blob:/absolute paths.
import { SCHEMA, Rig, affInv, affMul, affApply, affCompose, affDecompose } from './core.js';
import { readZip, writeZip, textOf, toBytes } from './zip.js';
import { validateProject, computeInverseBinds, stringifyProject } from './schema.js';
import { gridMesh, bleedEdges, autoWeights, pruneWeights } from './mesh.js';

export class AssetStore {
  constructor() { this.files = new Map(); this.urls = new Map(); }
  set(path, bytes, type = mimeOf(path)) {
    const old = this.urls.get(path); if (old) URL.revokeObjectURL(old);
    this.urls.delete(path);
    this.files.set(path, { bytes: toBytes(bytes), type });
  }
  has(path) { return this.files.has(path); }
  bytes(path) { return this.files.get(path)?.bytes || null; }
  url(path) {
    if (!this.files.has(path)) return null;
    let u = this.urls.get(path);
    if (!u) { const f = this.files.get(path); u = URL.createObjectURL(new Blob([f.bytes], { type: f.type })); this.urls.set(path, u); }
    return u;
  }
  paths() { return [...this.files.keys()]; }
  dispose() { for (const u of this.urls.values()) URL.revokeObjectURL(u); this.urls.clear(); }
}
const mimeOf = (p) => (/\.png$/i.test(p) ? 'image/png' : /\.jpe?g$/i.test(p) ? 'image/jpeg' : /\.webp$/i.test(p) ? 'image/webp' : /\.json$/i.test(p) ? 'application/json' : 'application/octet-stream');

/** Project from a folder URL (…/character.json): the JSON plus every image and the reference image. */
export async function loadProjectURL(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url} (${res.status})`);
  const project = await res.json();
  const store = new AssetStore(), base = new URL(url, location.href);
  const paths = new Set(Object.values(project.images || {}).map((i) => i.path).filter(Boolean));
  if (project.editor?.reference?.path) paths.add(project.editor.reference.path);
  for (const pg of project.atlas?.pages || []) paths.add(pg.path);
  await Promise.all([...paths].map(async (p) => {
    const r = await fetch(new URL(p, base));
    if (r.ok) store.set(p, new Uint8Array(await r.arrayBuffer()));
  }));
  return finishLoad(project, store);
}

/** Project from ZIP bytes (character.json at the root or inside one folder). */
export async function loadProjectZip(bytes) {
  const entries = await readZip(toBytes(bytes));
  let jsonPath = [...entries.keys()].find((p) => /(^|\/)character\.json$/.test(p)) || [...entries.keys()].find((p) => /\.json$/.test(p) && !/layers\.json$/.test(p));
  if (!jsonPath) throw new Error('the ZIP has no character.json');
  const prefix = jsonPath.slice(0, jsonPath.lastIndexOf('/') + 1);
  const project = JSON.parse(textOf(entries.get(jsonPath)));
  const store = new AssetStore();
  for (const [p, b] of entries) if (p !== jsonPath && p.startsWith(prefix) && !p.endsWith('/')) store.set(p.slice(prefix.length), b);
  return finishLoad(project, store);
}

function finishLoad(project, store) {
  const report = validateProject(project, { images: new Set(store.paths()), runtime: project.schema?.includes('runtime') });
  return { project, store, report };
}

/** ZIP of the editable project: character.json + images + reference (reference stays editor-only). */
export function saveProjectZip(project, store) {
  const files = [{ path: 'character.json', data: stringifyProject(project) }];
  const used = new Set(Object.values(project.images).map((i) => i.path));
  if (project.editor?.reference?.path) used.add(project.editor.reference.path);
  for (const p of [...used].sort()) { const b = store.bytes(p); if (b) files.push({ path: p, data: b }); }
  return writeZip(files);
}

// ------------------------------------------------------------------ images ----------
export async function decodeImage(bytes, type = 'image/png') {
  const bmp = await createImageBitmap(new Blob([toBytes(bytes)], { type }));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
  return g.getImageData(0, 0, bmp.width, bmp.height);
}
export async function encodePNG(imgData) {
  const c = document.createElement('canvas'); c.width = imgData.width; c.height = imgData.height;
  c.getContext('2d').putImageData(imgData, 0, 0);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
const alphaOf = (img) => { const a = new Uint8Array(img.width * img.height); for (let i = 0; i < a.length; i++) a[i] = img.data[i * 4 + 3]; return a; };
export const meshCell = (w, h) => Math.max(12, Math.min(48, Math.round(Math.max(w, h) / 9)));

/**
 * Bind (setup-world) positions of an attachment's vertices as the rig currently places them.
 */
function bindPoints(rig, attId) { const r = rig.attachments.get(attId); return r ? r.bind : null; }

/**
 * Put new artwork into a slot so that it inherits that slot's binding. `place` gives the image position:
 *   { worldX, worldY } = project point of the image's top-left pixel (setup pose), scale = project px per image px.
 * Weights are transferred from the slot's current attachment (nearest bind-space vertex, blended over the
 * 3 nearest), or created automatically from nearby bones when the slot is rigid/empty.
 */
export async function addArtToSlot(project, store, { slotId, name, bytes, imgData = null, worldX, worldY, scale = 1, bone = null, weights = 'inherit', setDefault = true }) {
  let rig = new Rig(project);
  const slot = project.slots.find((s) => s.id === slotId);
  if (!slot) throw new Error(`unknown slot ${slotId}`);
  imgData ||= await decodeImage(bytes);
  bleedEdges(imgData.data, imgData.width, imgData.height, 2);
  const png = await encodePNG(imgData);
  const imgId = `${slotId}__${name}`.replace(/[^\w.-]+/g, '_'), path = `images/${imgId}.png`;
  store.set(path, png);
  project.images[imgId] = { path, w: imgData.width, h: imgData.height, bytes: png.length };
  const w = imgData.width, h = imgData.height;
  const mesh = gridMesh(alphaOf(imgData), w, h, { cell: meshCell(w, h), threshold: 6, margin: 2 });
  const boneId = bone || slot.bone, bi = rig.boneIndex.get(boneId);
  const pivot = [w / 2, h / 2], pw = [worldX + w / 2 * scale, worldY - h / 2 * scale];
  const T = affDecompose(affMul(affInv(rig.bindWorld[bi]), affCompose(pw[0], pw[1], 0, 1, 1)));
  const id = `${slotId}.${name}`;
  const prev = slot.attachment && project.attachments[slot.attachment];
  const att = { id, name: `${slotId} (${name})`, slot: slotId, type: 'region', bone: boneId, image: imgId, imageScale: scale, pivot,
    transform: { x: +T.x.toFixed(4), y: +T.y.toFixed(4), rotation: +T.rotation.toFixed(4), scaleX: 1, scaleY: 1, mirror: false },
    vertices: mesh.vertices, triangles: mesh.triangles, weights: null, visible: true, opacity: 1, tint: [1, 1, 1], blend: 'normal',
    view: prev?.view || project.artView?.id || 'front', markers: null, source: { kind: 'imported', note: 'artist artwork' } };
  project.attachments[id] = att;
  rig = new Rig(project);
  const rec = rig.attachments.get(id);
  if (weights === 'inherit' && prev?.weights) {
    const src = bindPoints(rig, prev.id), sw = prev.weights;
    att.weights = [];
    for (let v = 0; v < rec.nv; v++) {
      const x = rec.bind[v * 2], y = rec.bind[v * 2 + 1], best = [];
      for (let u = 0; u < sw.length; u++) {
        const d = Math.hypot(src[u * 2] - x, src[u * 2 + 1] - y);
        if (best.length < 3 || d < best[2][0]) { best.push([d, u]); best.sort((a, b) => a[0] - b[0]); if (best.length > 3) best.pop(); }
      }
      const acc = new Map();
      for (const [d, u] of best) { const k = 1 / (d + 1) ** 2; for (let j = 0; j < sw[u].length; j += 2) acc.set(sw[u][j], (acc.get(sw[u][j]) || 0) + sw[u][j + 1] * k); }
      att.weights.push(pruneWeights(acc));
    }
    att.type = 'mesh';
  } else if (weights === 'auto') {
    autoWeightAttachment(project, id);
  }
  if (setDefault) slot.attachment = id;
  computeInverseBinds(project);
  return id;
}

/** Automatic weights from the bones near the attachment (the slot bone, its parent and children). */
export function autoWeightAttachment(project, attId, { bones = null } = {}) {
  const rig = new Rig(project), att = project.attachments[attId], rec = rig.attachments.get(attId);
  const b0 = project.bones.find((b) => b.id === att.bone);
  const ids = bones || [b0.id, b0.parent, ...project.bones.filter((b) => b.parent === b0.id).map((b) => b.id)].filter(Boolean)
    .filter((id) => !/^socket_|_tip_|prop_R/.test(id));
  const list = ids.map((id) => {
    const i = rig.boneIndex.get(id), m = rig.bindWorld[i], len = project.bones.find((b) => b.id === id).length || 10;
    return { id, head: [m[4], m[5]], tail: affApply(m, len, 0) };
  });
  const pts = []; for (let v = 0; v < rec.nv; v++) pts.push([rec.bind[v * 2], rec.bind[v * 2 + 1]]);
  att.weights = autoWeights(pts, list).map((l) => l);
  att.type = 'mesh';
  return att.weights;
}

/** New image bytes get a new path, so history can restore the actual artwork as well as its metadata. */
function imageRevision(project, store, attachment, img, png) {
  const stem = attachment.id.replace(/[^\w.-]+/g, '_');
  let n = 1, id, path;
  do { id = `${stem}__r${n++}`; path = `images/${id}.png`; } while (project.images[id] || store.has(path));
  store.set(path, png);
  project.images[id] = { path, w: img.width, h: img.height, bytes: png.length };
  return id;
}

/** Nearest bind-space samples used to transfer both weights and existing deformation keys. */
function replacementSamples(source, target) {
  const result = [];
  for (let v = 0; v < target.length; v += 2) {
    const best = [];
    for (let u = 0; u < source.length; u += 2) {
      const d = Math.hypot(source[u] - target[v], source[u + 1] - target[v + 1]);
      if (best.length < 3 || d < best[2][0]) { best.push([d, u / 2]); best.sort((a, b) => a[0] - b[0]); if (best.length > 3) best.pop(); }
    }
    if (best[0]?.[0] < 1e-6) result.push([[best[0][1], 1]]);
    else { const sum = best.reduce((s, [d]) => s + 1 / (d + 1) ** 2, 0); result.push(best.map(([d, i]) => [i, 1 / (d + 1) ** 2 / sum])); }
  }
  return result;
}

/** Replace art while preserving its canvas footprint, pivot, transform and marker positions. */
export async function replaceImage(project, store, attId, bytes) {
  const a = project.attachments[attId]; if (!a) throw new Error(`unknown attachment ${attId}`);
  const img = await decodeImage(bytes);
  const old = project.images[a.image];
  if (!old) throw new Error(`missing image metadata for ${attId}`);
  bleedEdges(img.data, img.width, img.height, 2);
  const png = await encodePNG(img), oldImage = a.image;
  if (old && old.w === img.width && old.h === img.height) {
    a.image = imageRevision(project, store, a, img, png);
    a.source = { kind: 'imported', note: 'artist artwork (replaced in place, mesh and weights kept)' };
  } else {
    const oldRig = new Rig(project), source = oldRig.attachments.get(attId).bind;
    const rx = img.width / old.w, ry = img.height / old.h;
    const mesh = gridMesh(alphaOf(img), img.width, img.height, { cell: meshCell(img.width, img.height), threshold: 6, margin: 2 });
    const moved = structuredClone(a);
    moved.image = imageRevision(project, store, a, img, png);
    moved.pivot = [a.pivot[0] * rx, a.pivot[1] * ry];
    moved.transform = { ...a.transform, scaleX: (a.transform.scaleX ?? 1) / rx, scaleY: (a.transform.scaleY ?? 1) / ry };
    moved.markers = a.markers && Object.fromEntries(Object.entries(a.markers).map(([k, p]) => [k, [p[0] * rx, p[1] * ry]]));
    moved.vertices = mesh.vertices; moved.triangles = mesh.triangles; moved.weights = null;
    moved.source = { kind: 'imported', note: 'artist artwork (re-meshed, footprint and contact markers preserved)' };
    project.attachments[attId] = moved;
    const target = new Rig(project).attachments.get(attId).bind, samples = replacementSamples(source, target);
    if (a.weights) moved.weights = samples.map((near) => {
      const weights = new Map();
      for (const [i, k] of near) for (let j = 0; j < a.weights[i].length; j += 2) {
        const b = a.weights[i][j]; weights.set(b, (weights.get(b) || 0) + a.weights[i][j + 1] * k);
      }
      return pruneWeights(weights);
    });
    // A different mesh has different vertex indices; keep cape/deformation animation valid too.
    for (const clip of project.clips || []) for (const layer of [clip.tracks, clip.corrections]) {
      const tr = layer?.deform?.[attId]; if (!tr) continue;
      tr.v = tr.v.map((offsets) => offsets == null ? offsets : samples.flatMap((near) =>
        [0, 1].map((axis) => near.reduce((sum, [i, k]) => sum + (offsets[i * 2 + axis] || 0) * k, 0))));
    }
  }
  if (!Object.values(project.attachments).some((att) => att.image === oldImage)) delete project.images[oldImage];
  computeInverseBinds(project);
  return attId;
}

/**
 * Layered artwork import (tested formats: PNG layers + layers.json, or a ZIP of the same).
 * layers.json: { "canvas": {"w","h"}, "origin": [x, y] (ground point under the character, canvas px, y down),
 *   "scale": project px per canvas px (default 1), "layers": [{ "file": "forearm_L.png", "x": 10, "y": 20,
 *   "slot": "forearm_L" (default: file name), "name": "painted" (attachment name), "bone": optional }] }
 * Layers whose slot does not exist are reported, not guessed. Returns {added:[ids], skipped:[msg]}.
 */
export async function importLayers(project, store, files) {
  // files: Map name -> bytes (a ZIP is expanded first)
  const all = new Map();
  for (const [n, b] of files) {
    if (/\.zip$/i.test(n)) for (const [p, x] of await readZip(toBytes(b))) all.set(p.split('/').pop(), x);
    else all.set(n.split('/').pop(), b);
  }
  const manifestBytes = all.get('layers.json');
  if (!manifestBytes) throw new Error('layered import needs a layers.json next to the PNG layers (see ART2D.md)');
  const m = JSON.parse(textOf(manifestBytes)), scale = m.scale || 1, [ox, oy] = m.origin || [m.canvas.w / 2, m.canvas.h];
  const added = [], skipped = [];
  for (const L of m.layers || []) {
    const bytes = all.get(L.file);
    if (!bytes) { skipped.push(`${L.file}: file missing`); continue; }
    const slotId = L.slot || L.file.replace(/\.png$/i, '');
    if (!project.slots.some((s) => s.id === slotId)) { skipped.push(`${L.file}: no slot "${slotId}" in this character`); continue; }
    const id = await addArtToSlot(project, store, { slotId, name: L.name || 'painted', bytes, worldX: (L.x - ox) * scale, worldY: (oy - L.y) * scale, scale, bone: L.bone || null });
    added.push(id);
  }
  return { added, skipped };
}

export function newProjectSkeleton(fromProject, id, displayName) {
  return { schema: SCHEMA, characterId: id, displayName, axes: fromProject.axes, referenceHeightPx: fromProject.referenceHeightPx,
    pixelsPerMeter: fromProject.pixelsPerMeter, bones: JSON.parse(JSON.stringify(fromProject.bones)), slots: [], attachments: {}, images: {},
    skins: [{ id: 'default' }], hands: fromProject.hands, constraints: [], props: {}, clips: [], poses: [], editor: { mode: 'setup' } };
}
