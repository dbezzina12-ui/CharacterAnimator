// Painted knight deliverables, rebuilt from a SAVED painted project (the editable ZIP is the source of truth):
//   node scripts/build-painted-knight.mjs [--from=<saved .character2d.zip>] [--rebase] [--bootstrap] [--out=deliverables/painted-knight]
// --from (default: <out>/aureate-knight-painted.character2d.zip when it exists): by DEFAULT the saved project is used
//   exactly as saved — every clip, correction, pose and painted piece is kept.
// --rebase (explicit): re-apply the saved painted skin (PNGs + fit template + statuses) to the CURRENT starter project
//   (characters2d/aureate_knight) so starter rig/animation improvements carry over, AND carry the saved project's own
//   animation work across: clips the starter does not have, corrections of shared clips, edited native 2D clips,
//   named poses and the visual review. Anything that cannot play on the new starter stops the build with a message.
// --bootstrap (or no saved project): start a painted skin from the kit's painted helmet (the only painted art).
// Pieces without painted art stay "missing" and fall back to the starter art; nothing is restyled or invented.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, CHROME, CHROME_ARGS } from './serve.mjs';

const arg = (k, d = null) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const OUT = arg('out', 'deliverables/painted-knight');
const HELMET = 'validation/workflow/art/painted-helmet.png';
const SAVED = process.argv.includes('--bootstrap') ? null : arg('from', fs.existsSync(path.join(OUT, 'aureate-knight-painted.character2d.zip')) ? path.join(OUT, 'aureate-knight-painted.character2d.zip') : null);
const REBASE = process.argv.includes('--rebase');               // --no-rebase is accepted (the default)
console.log(SAVED ? `rebuilding from saved project ${SAVED}${REBASE ? ' (rebased onto the current starter)' : ' (as saved)'}` : 'bootstrapping the painted skin from the kit helmet');
fs.mkdirSync(OUT, { recursive: true });
const server = await startServer(0);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [...CHROME_ARGS, '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/viewer/knight.html?art=2d`);
await page.waitForFunction(() => window.art2d?.editor?.ready, null, { timeout: 120000 });
await page.evaluate(() => art2d.editor.ready);

const res = await page.evaluate(async ({ helmetB64, savedB64, rebase }) => {
  const io = await import('./js/art2d/project-io.js'), zip = await import('./js/art2d/zip.js'), ex = await import('./js/art2d/exporters.js'), hv = await import('./js/art2d/handviews.js');
  const { Rig } = await import('./js/art2d/core.js');
  const ed = art2d.editor, P = () => ed.project, u8 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const b64 = (z) => { let s = ''; for (let i = 0; i < z.length; i += 0x8000) s += String.fromCharCode.apply(null, z.subarray(i, i + 0x8000)); return btoa(s); };
  const SKIN = 'painted', source = {}; let mapped = [];
  if (savedB64 && !rebase) {
    // the saved project exactly as saved
    await art2d.openZip(u8(savedB64)); await ed.ready;
    source.mode = 'as saved';
  } else if (savedB64) {
    // rebase: re-apply the saved painted skin (its PNGs + fit template) onto the current starter project
    const { project: S, store: SS } = await io.loadProjectZip(u8(savedB64));
    const tpl = S.fitting?.templates?.[SKIN], sk = (S.skins || []).find((x) => x.id === SKIN);
    if (!tpl || !sk) throw new Error('saved project has no painted skin with a fit template');
    const files = new Map(), missingFiles = [];
    for (const L of tpl.layers) { const a = S.attachments[sk.replace?.[L.target]]; const bytes = a && SS.bytes(S.images[a.image]?.path); if (bytes) files.set(L.file, bytes); else missingFiles.push(L.file); }
    const notInTemplate = Object.keys(sk.replace || {}).filter((t) => !tpl.layers.some((l) => l.target === t));
    if (missingFiles.length || notInTemplate.length) throw new Error(`saved painted skin cannot be carried over: missing images ${missingFiles.join(', ') || '—'}; pieces without a fit template ${notInTemplate.join(', ') || '—'}`);
    const sess = await art2d.startFit(files, { skin: SKIN, template: tpl });
    mapped = sess.layers.map((l) => `${l.file} → ${l.target} (${l.mapping.status})`);
    await art2d.acceptFit();
    const nsk = P().skins.find((x) => x.id === SKIN);
    for (const [t, st] of Object.entries(sk.status || {})) if (nsk.replace[t]) nsk.status[t] = st;   // finished / provisional as saved
    // every carried piece must sit where it sat in the saved project (setup pose, world bind positions)
    const rs = new Rig(S), rn = new Rig(P()); source.placement = {};
    for (const t of Object.keys(sk.replace)) { const a = rs.attachments.get(sk.replace[t]), b = rn.attachments.get(nsk.replace[t]); let m = a.bind.length === b.bind.length ? 0 : Infinity; for (let i = 0; i < a.bind.length && m < Infinity; i++) m = Math.max(m, Math.abs(a.bind[i] - b.bind[i])); source.placement[t] = +m.toFixed(4); }
    // the saved project's own animation work comes along: a rebase must never drop clips or edits
    const NP = P(), starterNames = new Set(NP.clips.map((c) => c.name)), carried = { clips: [], corrections: [], nativeClips: [], poses: [] };
    const empty = (L) => !L || ['bones', 'slots', 'deform', 'hands', 'handSets', 'constraints'].every((k) => !Object.keys(L[k] || {}).length) && !(L.drawOrder?.t?.length) && !(L.events?.length);
    for (const c of S.clips || []) {
      if (!starterNames.has(c.name)) { NP.clips.push(structuredClone(c)); carried.clips.push(c.name); continue; }
      const n = NP.clips.find((x) => x.name === c.name);
      if (c.source?.type === 'native2d') { if (JSON.stringify(c.tracks) !== JSON.stringify(n.tracks) || !empty(c.corrections)) { Object.assign(n, structuredClone(c)); carried.nativeClips.push(c.name); } continue; }
      if (!empty(c.corrections)) { n.corrections = structuredClone(c.corrections); carried.corrections.push(c.name); }
    }
    for (const pz of S.poses || []) if (!(NP.poses || []).some((x) => x.name === pz.name)) { (NP.poses ||= []).push(structuredClone(pz)); carried.poses.push(pz.name); }
    if (S.visualQA) NP.visualQA = structuredClone(S.visualQA);
    ed.rebuild();
    const bad = art2d.validate().errors.filter((e) => [...carried.clips, ...carried.corrections, ...carried.nativeClips].some((n) => e.includes(`clip ${n}:`)) || /pose/.test(e));
    if (bad.length) throw new Error(`saved animation work cannot be carried onto the current starter (use the default as-saved rebuild, or fix these): ${bad.slice(0, 6).join('; ')}`);
    source.mode = 'rebased'; source.pieces = Object.keys(sk.replace); source.savedStatus = sk.status; source.carried = carried;
  } else {
    // bootstrap: the template pack defines canvas coordinates; fit ONLY the helmet (real painted art)
    const pack0 = await art2d.paintPack(SKIN);
    const L0 = JSON.parse(zip.textOf(pack0.files.find((f) => f.path === 'layers.json').data));
    const helmetLayer = L0.layers.find((l) => l.target === 'helmet.default');
    const files = new Map([[helmetLayer.file, u8(helmetB64)], ['layers.json', new TextEncoder().encode(JSON.stringify({ ...L0, layers: [helmetLayer] }))]]);
    const sess = await art2d.startFit(files, { skin: SKIN });
    mapped = sess.layers.map((l) => `${l.file} → ${l.target} (${l.mapping.status})`);
    await art2d.acceptFit();
    source.mode = 'bootstrap';
  }
  const sk = P().skins.find((s) => s.id === SKIN);
  const finished = Object.entries(sk.status || {}).filter(([t, v]) => sk.replace[t] && v === 'finished').map(([t]) => t), provisional = Object.entries(sk.status || {}).filter(([t, v]) => sk.replace[t] && v === 'provisional').map(([t]) => t);
  sk.note = `Painted skin. Finished: ${finished.join(', ') || 'none'}. Provisional: ${provisional.join(', ') || 'none'}. Every other piece has no painted art yet and falls back to the starter (3D-captured) art — see ART-REQUESTS.txt.`;
  const def = P().skins.find((s) => s.id === 'default'); if (def) def.note = 'Starter skin: art captured from the 3D knight through the fixed art camera (not hand-painted).';
  P().defaultSkin = SKIN;
  art2d.setSkin(SKIN);
  // 2) template pack after the fit (helmet = finished, the rest = missing) + joint coverage
  const pack = await art2d.paintPack('painted');
  const missingHands = hv.missingHandArt(P(), 'painted');
  // 3) editable project + runtime package (runtime subset only)
  const proj = io.saveProjectZip(P(), ed.store);
  const rt = await ex.exportRuntimePackage(P(), ed.store, { name: 'aureate_knight_painted' });
  // previews: setup pose, starter vs painted
  const r = await ex.offscreenRenderer(P(), ed.store);
  const shot = async (skin) => { const rig = new Rig(P()); rig.setSkin(skin); const img = ex.renderPose(r, rig, rig.evaluate('idle', 1), [-420, -20, 420, 1080], 0.5, { background: [0.11, 0.12, 0.15, 1] }); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(img, 0, 0); return (await (await new Promise((res) => c.toBlob(res, 'image/png'))).arrayBuffer()); };
  const prevStarter = new Uint8Array(await shot('default')), prevPainted = new Uint8Array(await shot('painted'));
  return { mapped, source, status: sk.status, replace: sk.replace, manifest: pack.manifest, missingHands, valid: art2d.validate(), history: art2d.history().slice(-2),
    proj: b64(proj), runtime: b64(rt.zip), pack: b64(pack.zip), prevStarter: b64(prevStarter), prevPainted: b64(prevPainted) };
}, { helmetB64: fs.readFileSync(HELMET).toString('base64'), savedB64: SAVED ? fs.readFileSync(SAVED).toString('base64') : null, rebase: REBASE });
await browser.close(); server.close();
if (errors.length || res.valid.errors.length) { console.log('errors', errors, res.valid.errors); process.exit(1); }

const w = (f, b64) => fs.writeFileSync(path.join(OUT, f), Buffer.from(b64, 'base64'));
w('aureate-knight-painted.character2d.zip', res.proj);
w('aureate-knight-painted.runtime.zip', res.runtime);
w('paint-template-pack.zip', res.pack);
w('preview-starter-skin.png', res.prevStarter);
w('preview-painted-skin.png', res.prevPainted);

// runtime package unpacked → single-file offline player (painted skin selected by the package's defaultSkin)
const { readZip } = await import('../viewer/js/art2d/zip.js');
const rtDir = path.join(OUT, 'runtime-package'); fs.rmSync(rtDir, { recursive: true, force: true }); fs.mkdirSync(rtDir, { recursive: true });
let pkgFile = null;
for (const [p, b] of await readZip(new Uint8Array(fs.readFileSync(path.join(OUT, 'aureate-knight-painted.runtime.zip'))))) { fs.mkdirSync(path.join(rtDir, path.dirname(p)), { recursive: true }); fs.writeFileSync(path.join(rtDir, p), b); if (p.endsWith('.runtime.json')) pkgFile = p; }
execFileSync('node', ['scripts/build-standalone-player.mjs', `--package=${path.join(rtDir, pkgFile)}`, `--out=${path.join(OUT, 'Aureate-Knight-2D-Player.html')}`], { stdio: 'inherit' });
fs.rmSync(rtDir, { recursive: true, force: true });

// skin status + art requests (from the template manifest: exact sizes, pivots, joints, guides)
const m = res.manifest, pieces = m.pieces;
const status = { skin: 'painted', builtFrom: { saved: SAVED, ...res.source }, finished: pieces.filter((p) => p.status === 'finished').map((p) => p.attachment), provisional: pieces.filter((p) => p.status === 'provisional').map((p) => p.attachment),
  missing: pieces.filter((p) => p.status === 'missing').map((p) => p.attachment), missingHandSets: res.missingHands.map((h) => `${h.side} ${h.set}`), coverage: m.coverage, fitMapping: res.mapped };
fs.writeFileSync(path.join(OUT, 'skin-status.json'), JSON.stringify(status, null, 1));
const HERO = ['idle', 'hover_sword_vigil', 'sword_2h_idle', 'sword_2h_slash', 'knight_salute'];
const proj = JSON.parse(fs.readFileSync('characters2d/aureate_knight/character.json', 'utf8'));
const setsOf = (att) => Object.entries(proj.handViews || {}).flatMap(([side, h]) => Object.entries(h.sets || {}).filter(([, st]) => Object.values(st.slots || {}).includes(att)).map(([n]) => [side, n]));
const usedBy = (att) => proj.clips.filter((c) => JSON.stringify(c.tracks?.slots || {}).includes(`"${att}"`)
  || setsOf(att).some(([side, n]) => (c.tracks?.handSets?.[side]?.v || []).includes(n))).map((c) => c.name);
const tier = (p) => {
  if (/^prop_/.test(p.slot)) return /Sword2H/.test(p.attachment) ? 1 : 4;
  if (p.setupArt) return 1;
  return usedBy(p.attachment).some((c) => HERO.includes(c)) ? 2 : 3;
};
const groups = { 1: [], 2: [], 3: [], 4: [] };
for (const p of pieces.filter((x) => x.status !== 'finished')) groups[tier(p)].push(p);
const line = (p) => [`  ${p.file}`, `    attachment ${p.attachment} · slot ${p.slot} · bone ${p.bone} · canvas ${p.size[0]}×${p.size[1]} px (exact) · ${p.mesh}`,
  `    pivot (image px) ${p.pivot.map((x) => +x.toFixed(1)).join(', ')} · joints ${(p.joints || []).map((j) => `${j.name} @ ${j.image.map((x) => Math.round(x)).join(',')}`).join('; ') || '—'}${p.markers ? ' · markers ' + Object.keys(p.markers).join(', ') : ''}`,
  `    view ${p.view || 'front three-quarter'}${p.variantOf ? ` · variant of ${p.variantOf} (pose-specific / hand set)` : ''}${usedBy(p.attachment).length && !p.setupArt ? ` · used by ${usedBy(p.attachment).join(', ')}` : ''} · guides: ${p.guides[0].replace(/guide-silhouette.png$/, 'guide-*.png')}`].join('\n');
const txt = [`ART REQUESTS — Aureate Knight, painted skin`, `Generated by scripts/build-painted-knight.mjs from the paint-template pack manifest (${new Date().toISOString().slice(0, 10)}).`, '',
  'STATUS', `  finished: ${status.finished.length} (${status.finished.join(', ')})`, `  provisional: ${status.provisional.length}`, `  missing: ${status.missing.length} pieces — they currently show the starter (3D-captured) art`, '',
  'The final-art milestone is BLOCKED on these paintings: no image-generation or painting tool was available in this session,',
  'and the starter art must not be restyled and passed off as painted art.', '',
  'HOW TO PAINT', '  1. Unzip paint-template-pack.zip. Each piece has pieces/<attachment>/current.png (the starter art) and three guide layers',
  '     (silhouette, joints/pivot/markers, underlap). Guides are separate layers: never bake them into the art.',
  '  2. Paint each piece on its own transparent PNG at EXACTLY the listed canvas size, matching the style of',
  '     References/02-Olaf-Game-Style.png and the painted helmet (validation/workflow/art/painted-helmet.png).',
  '  3. Keep pivots/joints where the joints guide puts them. Weighted (bending) pieces need hidden material painted',
  '     past each joint (the underlap guide shows where) so bends never open a gap.',
  '  4. Name the files as in layers.json and drop them (with layers.json, or alone once a fit template exists) into',
  '     the editor: 2D mode → Fit artwork; review the mapping and joint anchors, Accept. One undo step, saved in the project.', '',
  ...[[1, 'PRIORITY 1 — setup pieces seen in every hero clip (body, armour, hands, two-handed sword)'], [2, 'PRIORITY 2 — pose-specific pieces used by the hero clips (salute, guard, wind-up, strike, hover grips; hand views)'],
    [3, 'PRIORITY 3 — pose-specific pieces and hand variants used only by other clips'], [4, 'PRIORITY 4 — other props']]
    .flatMap(([k, title]) => [title, `  (${groups[k].length} pieces)`, ...groups[k].map(line), '']),
  'HAND VIEWS STILL MISSING IN THE PAINTED SKIN', ...res.missingHands.map((h) => `  hand_${h.side} ${h.set} (${h.view}/${h.pose}): ${h.missing.join(', ')}`), '',
  'JOINT COVERAGE (bend test on the painted skin at the joint\'s extreme test angle; gap = a crack that opens BETWEEN the',
  'pieces, flagged above 3 %; silhouette change where a piece rotates away is listed separately and is not a gap)',
  ...(m.coverage || []).map((c) => `  ${c.joint}: crack ${c.gapPct}% (whole character ${c.fullCharacterGapPct}%), silhouette change ${c.silhouetteLossPct}%${c.gapPct || c.silhouetteLossPct ? ` at ${c.worstAngle}°` : ' at every test angle'}${c.flagged ? '  ← FLAGGED: ' + c.hint : ''}`),
  '  Every painted piece that bends still needs hidden material under its neighbour at each joint: follow pieces/<id>/guide-underlap.png.', ''].join('\n');
fs.writeFileSync(path.join(OUT, 'ART-REQUESTS.txt'), txt);
console.log(`painted skin: ${status.finished.length} finished, ${status.missing.length} missing; ${errors.length} page errors; fit: ${res.mapped.join('; ')}`);
