// Add baked clips (and only what they need) from one 2D project to another, without rebuilding or rebasing the
// target: e.g. golf_swing baked with `build-2d-knight.mjs --clips=golf_swing --out=<dir>` merged into the committed
// starter or into a saved painted project.
//   node scripts/merge-2d-clip.mjs --from=<dir|zip> --to=<dir|zip> --clips=golf_swing [--out=<zip>] [--report=<json>]
// Copied: the clips; the new attachments they use (their prop, pose-specific captures whose source pose is one of
// the clips) with their images; the new hand-view sets made of those attachments; the prop entry. Refused: a target
// whose bones or slots differ from the source (different rig), a clip the target already has, or any existing
// attachment/image/hand set/prop that would change. Nothing already in the target is modified.
import fs from 'node:fs';
import path from 'node:path';
import { readZip, writeZip, textOf } from '../viewer/js/art2d/zip.js';
import { validateProject, stringifyProject } from '../viewer/js/art2d/schema.js';

const arg = (k, d = null) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const FROM = arg('from'), TO = arg('to'), OUT = arg('out'), clips = (arg('clips') || '').split(',').filter(Boolean);
if (!FROM || !TO || !clips.length) throw new Error('--from, --to and --clips are required');
const J = JSON.stringify;

async function open(p) {
  if (fs.statSync(p).isDirectory()) {
    const project = JSON.parse(fs.readFileSync(path.join(p, 'character.json'), 'utf8'));
    return { kind: 'dir', root: p, project, read: (rel) => fs.readFileSync(path.join(p, rel)), files: null };
  }
  const entries = await readZip(new Uint8Array(fs.readFileSync(p)));
  const jsonPath = [...entries.keys()].find((k) => /(^|\/)character\.json$/.test(k));
  const prefix = jsonPath.slice(0, jsonPath.lastIndexOf('/') + 1);
  return { kind: 'zip', root: p, prefix, entries, project: JSON.parse(textOf(entries.get(jsonPath))), read: (rel) => Buffer.from(entries.get(prefix + rel)) };
}
const src = await open(FROM), dst = await open(TO);
const S = src.project, T = dst.project;
if (J(S.bones) !== J(T.bones)) throw new Error('bones differ between source and target: not the same rig — refusing');
if (J(S.slots.map((s) => [s.id, s.bone, s.attachment])) !== J(T.slots.map((s) => [s.id, s.bone, s.attachment]))) throw new Error('slots differ between source and target — refusing');

const report = { from: FROM, to: TO, clips, attachments: [], images: [], handSets: [], props: [], skipped: [] };
const added = new Set();
for (const name of clips) {
  const c = S.clips.find((x) => x.name === name);
  if (!c) throw new Error(`source has no clip ${name}`);
  if (T.clips.some((x) => x.name === name)) throw new Error(`target already has clip ${name} — refusing to replace saved work`);
  const prop = c.meta?.prop || null;
  // attachments made for this clip: its prop and the captures rendered at one of its poses
  for (const [id, a] of Object.entries(S.attachments)) {
    const forClip = (a.source?.pose || '').startsWith(`${name} @`) || (prop && id === `prop_R.${prop}`);
    if (!forClip) continue;
    if (T.attachments[id]) { if (J(T.attachments[id]) !== J(a)) report.skipped.push(`${id}: target has a different attachment with this id (kept)`); continue; }
    T.attachments[id] = a; added.add(id); report.attachments.push(id);
    const img = S.images[a.image];
    if (!T.images[a.image]) { T.images[a.image] = img; report.images.push(img.path); }
    else if (J(T.images[a.image]) !== J(img)) throw new Error(`image ${a.image} differs in the target — refusing`);
  }
  if (prop && S.props?.[prop] && !T.props?.[prop]) { (T.props ||= {})[prop] = S.props[prop]; report.props.push(prop); }
  // every attachment the clip keys must now exist in the target
  for (const [sl, tr] of Object.entries(c.tracks.slots || {})) for (const v of tr.attachment?.v || []) if (v && !T.attachments[v]) throw new Error(`clip ${name}: ${sl} keys ${v}, which the target lacks`);
  T.clips.push(c);
}
// hand-view sets made only of attachments added here
for (const side of Object.keys(S.handViews || {})) for (const [setName, set] of Object.entries(S.handViews[side].sets || {})) {
  if (T.handViews?.[side]?.sets?.[setName]) continue;
  const ids = Object.values(set.slots || {});
  if (ids.length && ids.every((id) => added.has(id) || (T.attachments[id] && !S.attachments[id]?.source?.pose?.match?.(/@/)))) {
    if (!ids.some((id) => added.has(id))) continue;
    ((T.handViews ||= {})[side] ||= { sets: {} }).sets[setName] = set; report.handSets.push(`${side}:${setName}`);
  }
}
// write
const newFiles = report.images.map((p) => [p, src.read(p)]);
const imgSet = dst.kind === 'dir' ? null : new Set([...dst.entries.keys()].map((k) => k.slice(dst.prefix.length)).concat(newFiles.map(([p]) => p)));
const rep = validateProject(T, { images: dst.kind === 'dir' ? null : imgSet });
if (rep.errors.length) { console.log(rep.errors.slice(0, 20).join('\n')); throw new Error(`${rep.errors.length} validation errors — nothing written`); }
if (dst.kind === 'dir') {
  for (const [p, b] of newFiles) { fs.mkdirSync(path.dirname(path.join(dst.root, p)), { recursive: true }); fs.writeFileSync(path.join(dst.root, p), b); }
  fs.writeFileSync(path.join(dst.root, 'character.json'), stringifyProject(T));
} else {
  const files = [{ path: 'character.json', data: stringifyProject(T) }];
  const all = new Map([...dst.entries].filter(([k]) => k !== dst.prefix + 'character.json' && !k.endsWith('/')).map(([k, v]) => [k.slice(dst.prefix.length), v]));
  for (const [p, b] of newFiles) all.set(p, new Uint8Array(b));
  for (const p of [...all.keys()].sort()) files.push({ path: p, data: all.get(p) });
  fs.writeFileSync(OUT || TO, writeZip(files));
}
report.warnings = rep.warnings.length;
if (arg('report')) fs.writeFileSync(arg('report'), JSON.stringify(report, null, 1));
console.log(`merged ${clips.join(', ')}: ${report.attachments.length} attachments, ${report.images.length} images, ${report.handSets.length} hand sets, props ${report.props.join(', ') || '—'}; ${report.skipped.length} skipped; ${rep.warnings.length} warnings`);
