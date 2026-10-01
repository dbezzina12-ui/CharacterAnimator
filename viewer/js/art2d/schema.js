// gamboligy.character2d/1.0 — validation and runtime extraction (pure JS).
import { SCHEMA, RUNTIME_SCHEMA, MAX_INFLUENCES, Rig, affMul, affInv } from './core.js';
import { checkMesh } from './mesh.js';

export { SCHEMA, RUNTIME_SCHEMA };

/**
 * Validate a project (or runtime package). `images`: optional Set/Map of available image paths.
 * Returns {errors: [...], warnings: [...]} with messages meant for people.
 */
export function validateProject(p, { images = null, runtime = false } = {}) {
  const errors = [], warnings = [];
  const E = (m) => errors.push(m), W = (m) => warnings.push(m);
  const expect = runtime ? RUNTIME_SCHEMA : SCHEMA;
  if (!p || typeof p !== 'object') return { errors: ['not a JSON object'], warnings };
  if (typeof p.schema !== 'string' || !p.schema.startsWith('gamboligy.character2d')) {
    E(`unknown file type: schema "${p.schema}" (expected ${expect})`);
    return { errors, warnings };
  }
  const [kind, ver] = p.schema.split('/');
  const major = Number((ver || '').split('.')[0]);
  if (kind !== expect.split('/')[0]) E(`this is a ${kind} file; expected ${expect.split('/')[0]}`);
  if (major !== 1) E(`unsupported schema version ${ver} (this tool reads 1.x); open it with a newer CharacterAnimator`);
  for (const k of ['characterId', 'bones', 'slots', 'attachments', 'images', 'clips']) if (p[k] == null) E(`missing "${k}"`);
  if (errors.length) return { errors, warnings };
  const bones = new Set();
  for (const b of p.bones) {
    if (!b.id) { E('bone without id'); continue; }
    if (bones.has(b.id)) E(`duplicate bone id ${b.id}`);
    bones.add(b.id);
    const s = b.setup || {};
    if (![s.x, s.y, s.rotation].every(Number.isFinite)) E(`bone ${b.id}: setup x/y/rotation must be numbers`);
  }
  for (const b of p.bones) if (b.parent && !bones.has(b.parent)) E(`bone ${b.id}: parent ${b.parent} does not exist`);
  const slots = new Set();
  for (const s of p.slots) {
    if (slots.has(s.id)) E(`duplicate slot id ${s.id}`);
    slots.add(s.id);
    if (!bones.has(s.bone)) E(`slot ${s.id}: bone ${s.bone} does not exist`);
    if (s.attachment && !p.attachments[s.attachment]) E(`slot ${s.id}: default attachment ${s.attachment} is missing`);
  }
  const imgIds = new Set(Object.keys(p.images));
  for (const [id, img] of Object.entries(p.images)) {
    if (img.page !== undefined) {                 // runtime package: a rectangle of an atlas page
      const pg = p.atlas?.pages?.[img.page];
      if (!pg) E(`image ${id}: atlas page ${img.page} is missing`);
      else if (images && !(images.has ? images.has(pg.path) : images[pg.path])) E(`missing atlas page file ${pg.path}`);
      else if (img.x < 0 || img.y < 0 || img.x + img.w > pg.w || img.y + img.h > pg.h) E(`image ${id}: rectangle lies outside atlas page ${img.page}`);
    } else if (!img.path) E(`image ${id}: no path`);
    else if (/^(blob:|data:|file:|[a-zA-Z]:\\|\/)/.test(img.path)) E(`image ${id}: "${img.path}" is not a project-relative path`);
    else if (images && !(images.has ? images.has(img.path) : images[img.path])) E(`missing image file ${img.path} (image ${id})`);
    if (!(img.w > 0 && img.h > 0)) E(`image ${id}: width/height missing`);
  }
  for (const [id, a] of Object.entries(p.attachments)) {
    if (a.id !== id) E(`attachment key ${id} does not match its id ${a.id}`);
    if (!slots.has(a.slot)) E(`attachment ${id}: slot ${a.slot} does not exist`);
    if (!bones.has(a.bone)) E(`attachment ${id}: bone ${a.bone} does not exist`);
    if (!imgIds.has(a.image)) E(`attachment ${id}: image ${a.image} is not listed in "images"`);
    const nv = (a.vertices || []).length / 2;
    if (!Number.isInteger(nv) || nv < 3) { E(`attachment ${id}: needs at least 3 vertices`); continue; }
    if (!a.triangles?.length || a.triangles.length % 3) E(`attachment ${id}: triangles must be a multiple of 3`);
    else {
      const m = checkMesh(a.vertices, a.triangles);
      if (!m.ok) E(`attachment ${id}: mesh has ${m.degenerate} degenerate and ${Math.min(m.positive, m.negative)} flipped triangles`);
    }
    if (a.weights) {
      if (a.weights.length !== nv) E(`attachment ${id}: ${a.weights.length} weight entries for ${nv} vertices`);
      a.weights.forEach((l, v) => {
        if (l.length / 2 > MAX_INFLUENCES) E(`attachment ${id} vertex ${v}: more than ${MAX_INFLUENCES} influences`);
        let sum = 0;
        for (let j = 0; j < l.length; j += 2) {
          if (!bones.has(l[j])) { E(`attachment ${id} vertex ${v}: weight bone ${l[j]} does not exist`); return; }
          if (!(l[j + 1] >= 0)) E(`attachment ${id} vertex ${v}: negative/invalid weight`);
          sum += l[j + 1];
        }
        if (Math.abs(sum - 1) > 1e-3) W(`attachment ${id} vertex ${v}: weights sum to ${sum.toFixed(4)} (normalised on load)`);
      });
    }
  }
  for (const c of p.clips) {
    if (!c.name) E('clip without name');
    if (!(c.duration > 0)) E(`clip ${c.name}: duration must be > 0`);
    for (const layer of [c.tracks, c.corrections]) {
      if (!layer) continue;
      for (const b of Object.keys(layer.bones || {})) if (!bones.has(b)) E(`clip ${c.name}: track for unknown bone ${b}`);
      for (const s of Object.keys(layer.slots || {})) if (!slots.has(s)) E(`clip ${c.name}: track for unknown slot ${s}`);
      for (const [s, tr] of Object.entries(layer.slots || {})) for (const a of tr.attachment?.v || []) if (a && !p.attachments[a]) E(`clip ${c.name}: slot ${s} keys missing attachment ${a}`);
      for (const [side, tr] of Object.entries(layer.handSets || {})) for (const v of tr.v || []) if (v != null && !p.handViews?.[side]?.sets?.[v]) E(`clip ${c.name}: hand set ${v} (${side}) is not defined in handViews`);
      for (const [attId, tr] of Object.entries(layer.deform || {})) {
        const a = p.attachments[attId];
        if (!a) { E(`clip ${c.name}: deform keys for missing attachment ${attId}`); continue; }
        const n = a.vertices.length;
        (tr.v || []).forEach((v, k) => { if (v && v.length !== n) E(`clip ${c.name}: deform key ${k} of ${attId} has ${v.length / 2} vertices but the mesh has ${n / 2} (mesh edited without remapping keys)`); });
        if (tr.ease && tr.ease.length !== tr.t.length) E(`clip ${c.name}: deform easing of ${attId} does not match its keys`);
      }
    }
  }
  // replacement art that plays another piece's deformation: the source must exist and the chain must end
  for (const a of Object.values(p.attachments || {})) {
    if (a.deformFrom === undefined || a.deformFrom === null) continue;
    if (a.deformFrom === a.id || !p.attachments[a.deformFrom]) { E(`attachment ${a.id}: deformFrom "${a.deformFrom}" is not another attachment`); continue; }
    const seen = new Set([a.id]); let cur = p.attachments[a.deformFrom];
    while (cur?.deformFrom) { if (seen.has(cur.id)) { E(`attachment ${a.id}: deformFrom chain loops (${[...seen].join(' → ')})`); break; } seen.add(cur.id); cur = p.attachments[cur.deformFrom]; }
  }
  for (const [side, hv] of Object.entries(p.handViews || {})) for (const [name, set] of Object.entries(hv.sets || {})) for (const [sl, a] of Object.entries(set.slots || {})) {
    if (!slots.has(sl)) E(`hand set ${side}/${name}: slot ${sl} does not exist`);
    if (a && !p.attachments[a]) E(`hand set ${side}/${name}: attachment ${a} is missing`);
  }
  if (p.defaultSkin !== undefined && !(p.skins || []).some((sk) => sk.id === p.defaultSkin)) E(`defaultSkin "${p.defaultSkin}" is not a skin of this project`);
  for (const sk of p.skins || []) for (const [a, b] of Object.entries(sk.replace || {})) {
    if (!p.attachments[a]) E(`skin ${sk.id}: replaces unknown attachment ${a}`);
    if (!p.attachments[b]) E(`skin ${sk.id}: replacement attachment ${b} is missing`);
  }
  for (const c of p.constraints || []) {
    for (const b of [...(c.bones || []), c.end, c.effector, c.target?.bone].filter(Boolean)) if (!bones.has(b)) E(`constraint ${c.id}: bone ${b} does not exist`);
  }
  if (!errors.length) {
    try {
      const rig = new Rig(p);
      rig.evaluate(null, 0);
      // stored inverse binds must match the setup pose they claim to invert
      for (const b of p.bones) if (b.inverseBind) {
        const i = rig.boneIndex.get(b.id), m = affMul(rig.bindWorld[i], b.inverseBind);
        if (Math.abs(m[0] - 1) + Math.abs(m[3] - 1) + Math.abs(m[1]) + Math.abs(m[2]) + Math.abs(m[4]) + Math.abs(m[5]) > 1e-4) {
          E(`bone ${b.id}: stored inverseBind does not invert its setup pose`);
        }
      }
    } catch (e) { E(`rig does not evaluate: ${e.message}`); }
  }
  return { errors, warnings };
}

/** Inverse bind matrices for every bone from the setup pose (stored in projects for runtimes). */
export function computeInverseBinds(project) {
  const rig = new Rig(project);
  for (const b of project.bones) b.inverseBind = affInv(rig.bindWorld[rig.boneIndex.get(b.id)]).map((x) => +x.toFixed(9));
  return project;
}

/**
 * Playback-only package: drops editor state (reference images, editor camera, undo), authoring
 * provenance stays as metadata. Clips keep both layers (tracks + corrections) so artist corrections ship.
 */
export function runtimeSubset(project, { atlas = null } = {}) {
  const keep = ['characterId', 'displayName', 'axes', 'referenceHeightPx', 'pixelsPerMeter', 'artView', 'bones', 'slots',
    'attachments', 'images', 'skins', 'defaultSkin', 'hands', 'handViews', 'constraints', 'props', 'clips', 'sockets'];
  const out = { schema: RUNTIME_SCHEMA, generatedFrom: SCHEMA };
  for (const k of keep) if (project[k] !== undefined) out[k] = JSON.parse(JSON.stringify(project[k]));
  out.clips = out.clips.map((c) => ({ name: c.name, duration: c.duration, loop: !!c.loop, fps: c.fps, meta: c.meta, tracks: c.tracks, corrections: c.corrections, status: c.status }));
  if (atlas) out.atlas = atlas;
  if (out.artView) out.artView = { ...out.artView };          // metadata only; runtimes never need the 3D camera
  for (const c of out.clips) if (c.corrections) ensureEmptyDrop(c);
  return out;
}

function ensureEmptyDrop(c) {
  const k = c.corrections, empty = (o) => !o || (Array.isArray(o) ? !o.length : !Object.keys(o).length);
  if (empty(k.bones) && empty(k.slots) && empty(k.drawOrder?.t) && empty(k.deform) && empty(k.hands) && empty(k.handSets) && empty(k.constraints) && empty(k.events)) delete c.corrections;
}

/** Project JSON for files: objects indented, arrays of numbers/strings kept on one line (diff-friendly, compact). */
export function stringifyProject(value) {
  const walk = (v, ind) => {
    if (Array.isArray(v)) {
      if (v.every((x) => x === null || typeof x !== 'object')) return JSON.stringify(v);
      return '[\n' + v.map((x) => ind + ' ' + walk(x, ind + ' ')).join(',\n') + '\n' + ind + ']';
    }
    if (v && typeof v === 'object') {
      const keys = Object.keys(v).filter((k) => v[k] !== undefined);
      if (!keys.length) return '{}';
      return '{\n' + keys.map((k) => ind + ' ' + JSON.stringify(k) + ': ' + walk(v[k], ind + ' ')).join(',\n') + '\n' + ind + '}';
    }
    return JSON.stringify(v);
  };
  return walk(value, '') + '\n';
}
