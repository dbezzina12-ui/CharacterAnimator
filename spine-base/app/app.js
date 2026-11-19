// Character Kit: shape a character with sliders, watch it run in the real Spine 4.2 runtime, swap in painted art, export the kit.
// Nothing here decides game outcomes; the exported skeleton only reports animation events (impact, fire, hit, land) to the game.
import { buildKit, kitFiles, paintSheet, sliceSheet, templateSheet, brief, PRESETS, LIMITS, PIECE_INFO, SHEET_ORDER } from '../generator/kit.js';
import { SlotCharacter } from '../runtime/slot-character.js';
import { zip, unzip } from './zip.js';

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const STORE = 'character-kit-settings';
const SLIDERS = [
  ['height', 'Height', (v) => `${v} units`],
  ['head', 'Head size', (v) => `${(1 / v).toFixed(1)} heads tall`],
  ['headWidth', 'Head width', (v) => `${Math.round(v * 100)}% of its height`],
  ['legs', 'Leg length', (v) => `hips at ${Math.round(v * 100)}%`],
  ['arms', 'Arm length', (v) => `${Math.round(v * 100)}% of height`],
  ['shoulders', 'Shoulder width', (v) => `${Math.round(v * 100)}% of height`],
  ['build', 'Build', (v) => `${v.toFixed(2)}× thickness`],
  ['hands', 'Hand size', (v) => `${(v * 100).toFixed(1)}% of height`],
  ['stance', 'Stance width', (v) => `${(v * 100).toFixed(1)}% of height`],
];
const ACTIONS = { staff: [['staff/slam', 'Slam', 'impact'], ['hit', 'Hit'], ['win', 'Win']], gun: [['gun/fire', 'Fire', 'fire'], ['hit', 'Hit'], ['win', 'Win']], none: [['hit', 'Hit'], ['win', 'Win']] };

const state = { settings: { ...PRESETS.human }, art: {}, weapon: 'staff', bones: false, speed: 1, selected: 'head', tab: 'shape' };
try { const saved = JSON.parse(localStorage.getItem(STORE) || 'null'); if (saved && typeof saved === 'object') state.settings = { ...PRESETS.human, ...saved }; } catch { /* storage unavailable: start from the human preset */ }
let kit = null, view = null, sheet = null;

// ---------------------------------------------------------------- messages, saving, copying
let toastTimer = 0;
function say(msg, kind = '') { const t = $('#toast'); t.textContent = msg; t.className = kind; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, kind ? 6000 : 2600); }
const inViewer = !!(window.claude && typeof window.claude.use === 'function');   // inside the claude.ai artifact viewer, saves go through its downloads capability
let downloads = null;
async function saveFile(filename, blob) {
  if (!inViewer) { const a = el('a', { href: URL.createObjectURL(blob), download: filename }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); return say(`Saved ${filename}`); }
  downloads ||= window.claude.use('downloads'); const dl = await downloads;
  if (!dl) return manual(filename, blob);
  try { await dl.save({ filename, data: blob }); say(`Saved ${filename}`); } catch (e) {
    if (e && e.code === 'declined') return;
    if (e && e.code === 'rate_limited') return say('Another save is still waiting for your answer. Finish that one, then try again.', 'warn');
    manual(filename, blob);
  }
}
function manual(filename, blob) {
  setTab('export'); $('#manual').hidden = false; const img = $('#manual-img');
  if (/\.png$/.test(filename)) { img.src = URL.createObjectURL(blob); img.hidden = false; $('#manual-msg').textContent = `This view cannot save ${filename} for you. Press and hold (or right-click) the image below to save it.`; }
  else { img.hidden = true; $('#manual-msg').textContent = `This view cannot save ${filename}. Open the app in a browser to save the full kit; the skeleton and atlas text are below to copy.`; }
  $('#manual-json').value = JSON.stringify(kit.json); $('#manual-atlas').value = kit.atlas.text; $('#manual').scrollIntoView({ block: 'nearest' });
  say('Saving is not available in this view. See "Save by hand".', 'warn');
}
async function copy(text, field) {
  try { await navigator.clipboard.writeText(text); say('Copied'); } catch { if (field) { field.focus(); field.select(); say('Press Ctrl+C or ⌘C to copy the selected text.', 'warn'); } else say('Copying is blocked in this view.', 'warn'); }
}
const canvasBlob = (c) => new Promise((res) => c.toBlob(res, 'image/png'));
async function imageFromBlob(blob) { const bmp = await createImageBitmap(blob); const c = el('canvas', { width: bmp.width, height: bmp.height }); c.getContext('2d').drawImage(bmp, 0, 0); bmp.close?.(); return c; }

// ---------------------------------------------------------------- Spine runtime
const canvas = $('#gl'); let gl, mctx, renderer;
function fatal(msg) { const f = $('#fatal'); f.hidden = false; f.textContent = msg; window.AppError = msg; }
try {
  if (!window.spine) throw new Error('The Spine runtime did not load. Check the network connection and reload.');
  gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true }); if (!gl) throw new Error('WebGL is not available on this device.');
  mctx = new spine.ManagedWebGLRenderingContext(gl); renderer = new spine.SceneRenderer(canvas, mctx);
} catch (e) { fatal(e.message); }

/** Load a freshly built kit into the runtime straight from memory (no files). */
function mount(k) {
  const atlas = new spine.TextureAtlas(k.atlas.text); const tex = new spine.GLTexture(mctx, k.atlas.canvas); atlas.pages[0].setTexture(tex);
  const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(k.json);
  const ch = new SlotCharacter(data); ch.setWeapon(state.weapon); ch.setCape(!!k.P.cape);
  const log = []; ch.onEvent((ev, anim, t) => { log.unshift(`<b>◆</b> ${anim}  ${ev}  ${t.toFixed(2)}s`); log.length = Math.min(log.length, 5); $('#log').innerHTML = log.join('\n'); });
  if (view) view.tex.dispose(); view = { char: ch, tex, data };
}
/** Play the weapon animations on a second, invisible skeleton and measure what matters: do the hands stay on the grips? */
function selfCheck(data) {
  const d = (a, b) => Math.hypot(a.worldX - b.worldX, a.worldY - b.worldY); const ch = new SlotCharacter(data, { blink: false }); const B = (n) => ch.skeleton.findBone(n); const out = [];
  const run = (weapon, anim, frames, each) => { ch.setWeapon(weapon); for (let i = 0; i < 20; i++) ch.update(1 / 60); if (anim) ch.state.setAnimation(0, anim, false); for (let i = 0; i < frames; i++) { ch.update(1 / 60); each(i); } };
  let far = 0, near = 0, feet = 0, foot = 1e9, lift = 0, nearOn = 0; const ikNear = () => ch.skeleton.ikConstraints.find((c) => c.data.name === 'staff/near-arm-ik');
  run('staff', 'staff/slam', 78, (i) => { far = Math.max(far, d(B('hand-far'), B('staff-grip-far'))); feet = Math.max(feet, d(B('foot-near'), B('foot-near-target')), d(B('foot-far'), B('foot-far-target'))); lift = Math.max(lift, B('staff-foot').worldY); if (i >= 32 && i <= 36) foot = Math.min(foot, Math.abs(B('staff-foot').worldY)); if (ikNear().mix > 0.99) { nearOn++; near = Math.max(near, d(B('hand-near'), B('staff-grip-near'))); } });
  out.push(far < 1.5 ? ['ok', 'Staff stays in the far hand'] : ['bad', 'Far hand cannot reach the staff', 'lengthen the arms or narrow the stance']);
  out.push(nearOn > 10 && near < 1.5 ? ['ok', 'Two-handed slam connects'] : ['warn', 'Near hand cannot reach the staff in the slam', 'lengthen the arms or narrow the shoulders']);
  out.push(foot < 2 && lift > 20 ? ['ok', 'Staff lands on the ground at impact'] : ['warn', 'Staff does not land cleanly']);
  let gun = 0; run('gun', 'gun/fire', 60, () => { gun = Math.max(gun, d(B('hand-near'), B('gun-grip-near'))); feet = Math.max(feet, d(B('foot-near'), B('foot-near-target'))); });
  out.push(gun < 1.5 ? ['ok', 'Gun stays in the near hand'] : ['bad', 'Near hand cannot hold the gun on target']);
  out.push(feet < 1.5 ? ['ok', 'Feet stay planted'] : ['warn', 'Feet slide', 'the legs are too short for this stance']);
  return out;
}
function showChecks(list) {   // one quiet line while everything holds; each problem spelled out when something does not
  const bad = list.filter((c) => c[0] !== 'ok'); const chip = ([kind, text, tip]) => el('div', { className: `chip ${kind === 'ok' ? '' : kind}`, title: list.map((c) => `${c[0] === 'ok' ? '✓' : '!'} ${c[1]}`).join('\n') }, text, ...(tip ? [el('span', {}, tip)] : []));
  $('#checks').replaceChildren(...(bad.length ? bad.map(chip) : [chip(['ok', `Rig checks pass`, `${list.length} of ${list.length}: grips, slam, feet`])])); window.AppChecks = list;
}

function draw() {
  if (!view) return; const r = canvas.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1); const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  const H = kit.P.height, cam = renderer.camera; cam.zoom = Math.max(H * 1.34 / h, H * 0.95 / w); cam.position.set(H * 0.04, H * 0.56, 0); cam.setViewport(w, h);
  renderer.begin(); renderer.drawSkeleton(view.char.skeleton, false); if (state.bones) renderer.drawSkeletonDebug(view.char.skeleton, false); renderer.end();
}
let last = performance.now(); const loop = { paused: false };
function tick(now) { const dt = Math.min(0.05, (now - last) / 1000) * state.speed; last = now; if (view && !loop.paused) { view.char.update(dt); draw(); } requestAnimationFrame(tick); }

// ---------------------------------------------------------------- build
let pending = 0;
function rebuild() {
  if (!renderer) return;
  try {
    kit = buildKit(state.settings, { scale: 2, art: state.art }); sheet = null; state.settings = { ...kit.P.params };
    mount(kit); showChecks(selfCheck(view.data)); syncUI();
    try { localStorage.setItem(STORE, JSON.stringify(state.settings)); } catch { /* fine without it */ }
  } catch (e) { console.error(e); say(`Could not build the character: ${e.message}`, 'warn'); }
}
function queue() { cancelAnimationFrame(pending); pending = requestAnimationFrame(rebuild); }
const getSheet = () => (sheet ||= paintSheet(kit));

// ---------------------------------------------------------------- UI
function setTab(tab) { state.tab = tab; for (const b of document.querySelectorAll('.tabs button')) { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', on); $(`#pane-${b.dataset.tab}`).hidden = !on; } if (tab === 'art') drawPieces(); }
function setWeapon(w) {
  state.weapon = w; view?.char.setWeapon(w);
  for (const b of document.querySelectorAll('[data-weapon]')) b.setAttribute('aria-pressed', b.dataset.weapon === w);
  $('#actions').replaceChildren(...ACTIONS[w].map(([anim, label, until]) => el('button', { className: 'btn', textContent: label, onclick: () => view?.char.play(anim, { until }) })));
}
function buildControls() {
  $('#presets').replaceChildren(...Object.entries(PRESETS).map(([id, p]) => el('button', { className: 'btn', textContent: p.name, onclick: () => { state.settings = { ...p }; state.art = {}; rebuild(); say(`${p.name} proportions loaded`); } })));
  $('#sliders').replaceChildren(...SLIDERS.map(([key, label]) => { const [min, max, step] = LIMITS[key];
    return el('div', { className: 'slider' }, el('label', { htmlFor: `s-${key}`, textContent: label }), el('output', { id: `o-${key}`, htmlFor: `s-${key}` }),
      el('input', { type: 'range', id: `s-${key}`, min, max, step, oninput: (e) => { state.settings[key] = +e.target.value; queue(); } })); }));
  $('#name').oninput = (e) => { state.settings.name = e.target.value; queue(); };
  $('#cape').onchange = (e) => { state.settings.cape = e.target.checked; rebuild(); };
  $('#bones').onchange = (e) => { state.bones = e.target.checked; };
  $('#slow').onchange = (e) => { state.speed = e.target.checked ? 0.25 : 1; };
  for (const b of document.querySelectorAll('[data-weapon]')) b.onclick = () => setWeapon(b.dataset.weapon);
  for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => setTab(b.dataset.tab);
}
function syncUI() {
  const s = state.settings;
  for (const [key, , fmt] of SLIDERS) { const i = $(`#s-${key}`); if (document.activeElement !== i) i.value = s[key]; $(`#o-${key}`).textContent = fmt(+s[key]); }
  if (document.activeElement !== $('#name')) $('#name').value = s.name || ''; $('#cape').checked = !!s.cape;
  if (document.activeElement !== $('#settings')) $('#settings').value = JSON.stringify(s, null, 1);
  if (state.tab === 'art' && !(document.activeElement?.id || '').startsWith('a-')) drawPieces();   // never rebuild the editor under a slider that is being dragged
}
function thumb(c, p) { const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); const k = Math.min((c.width - 8) / p.px[0], (c.height - 8) / p.px[1]); g.imageSmoothingQuality = 'high'; g.drawImage(p.canvas, (c.width - p.px[0] * k) / 2, (c.height - p.px[1] * k) / 2, p.px[0] * k, p.px[1] * k); }
function drawPieces() {
  if (!kit) return; const box = $('#pieces');
  box.replaceChildren(...SHEET_ORDER.map((name) => { const c = el('canvas', { width: 112, height: 112 }); thumb(c, kit.by[name].blank ? { ...kit.by[name].ph, canvas: kit.by[name].ph.canvas } : kit.by[name]);
    return el('button', { className: `piece${state.art[name] ? ' custom' : ''}`, onclick: () => { state.selected = name; drawPieces(); } }, c, name); }));
  [...box.children].forEach((b, i) => b.setAttribute('aria-pressed', SHEET_ORDER[i] === state.selected));
  const name = state.selected, p = kit.by[name], a = state.art[name], info = PIECE_INFO[name]; const ed = $('#editor');
  const slider = (key, label, min, max, step, fmt) => el('div', { className: 'slider' }, el('label', { htmlFor: `a-${key}`, textContent: label }), el('output', { textContent: fmt(a[key] ?? (key === 'scale' ? 1 : 0)) }),
    el('input', { type: 'range', id: `a-${key}`, min, max, step, value: a[key] ?? (key === 'scale' ? 1 : 0), oninput: (e) => { a[key] = +e.target.value; e.target.previousSibling.textContent = fmt(a[key]); queue(); }, onchange: (e) => { e.target.blur(); drawPieces(); } }));
  ed.replaceChildren(el('h3', { textContent: name }), el('div', { className: 'meta', textContent: `${p.ph.px[0]}×${p.ph.px[1]} px · ${Math.round(p.ph.rect.w)}×${Math.round(p.ph.rect.h)} units · bone ${info.bone}${info.skin ? ` · ${info.skin} only` : ''}` }),
    el('div', { className: 'row' }, el('span', { className: 'btn file' }, a ? 'Replace image' : 'Load image for this part', el('input', { type: 'file', id: 'up-piece', accept: 'image/png,image/webp', onchange: (e) => loadPiece(name, e.target.files[0]) })),
      el('button', { className: 'btn', textContent: 'Save placeholder', onclick: async () => saveFile(`${name}.png`, await canvasBlob(p.ph.canvas)) }), ...(a ? [el('button', { className: 'btn', textContent: 'Use placeholder', onclick: () => { delete state.art[name]; rebuild(); } })] : [])),
    ...(a ? [slider('dx', 'Move sideways', -80, 80, 0.5, (v) => `${v} units`), slider('dy', 'Move up or down', -80, 80, 0.5, (v) => `${v} units`), slider('scale', 'Size', 0.5, 1.8, 0.01, (v) => `${Math.round(v * 100)}%`), slider('rot', 'Turn', -45, 45, 0.5, (v) => `${v}°`)]
      : [el('p', { textContent: 'Paint on the saved placeholder at the same canvas size and the art lands exactly where the placeholder was. Any other size is fitted inside the same box; nudge it with the sliders that appear.' })]));
}
async function loadPiece(name, file) {
  if (!file) return;
  try { state.art[name] = { image: await imageFromBlob(file), dx: 0, dy: 0, scale: 1, rot: 0 }; rebuild(); say(`${name} replaced`); } catch { say('That file could not be read as an image. Use a PNG with a transparent background.', 'warn'); }
}
async function loadSheet(file) {
  if (!file) return;
  try {
    const img = await imageFromBlob(file); const res = sliceSheet(img, getSheet(), kit); const n = Object.keys(res.art).length;
    if (!n) return say('No parts were found on that sheet. Keep the layout of the saved paint sheet and a flat background.', 'warn');
    for (const [name, a] of Object.entries(res.art)) state.art[name] = { ...a, dx: 0, dy: 0, scale: 1, rot: 0 };
    rebuild(); say(`${n} parts placed from the sheet${res.skipped.length ? `; ${res.skipped.length} empty boxes kept their placeholder` : ''}.`);
  } catch (e) { console.error(e); say('That file could not be read as an image.', 'warn'); }
}
async function openKit(file) {
  if (!file) return;
  try {
    const files = await unzip(await file.arrayBuffer()); const doc = files.find((f) => f.name.endsWith('character.json')); if (!doc) throw new Error('No character.json inside. Choose a kit saved from this app.');
    const data = JSON.parse(new TextDecoder().decode(doc.bytes)); const dir = doc.name.slice(0, -'character.json'.length); const art = {};
    for (const [name, a] of Object.entries(data.art || {})) { const f = files.find((x) => x.name === dir + a.file); if (f && PIECE_INFO[name]) art[name] = { image: await imageFromBlob(new Blob([f.bytes], { type: 'image/png' })), rel: a.rel, dx: a.dx || 0, dy: a.dy || 0, scale: a.scale ?? 1, rot: a.rot || 0 }; }
    if (!data.settings) throw new Error('This kit has no settings to reopen.');
    state.settings = { ...PRESETS.human, ...data.settings }; state.art = art; rebuild(); say(`Opened ${state.settings.name}`);
  } catch (e) { say(e.message || 'That kit could not be opened.', 'warn'); }
}
function applySettings() {
  try { const s = JSON.parse($('#settings').value); if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error(); state.settings = { ...PRESETS.human, ...(s.settings || s) }; $('#settings').blur(); rebuild(); say('Settings applied'); }
  catch { say('Those settings are not valid JSON. Copy the block again, including the first { and last }.', 'warn'); }
}
function wire() {
  $('#dl-kit').onclick = async (e) => { e.target.disabled = true; try { rebuild(); const files = await kitFiles(kit, { art: state.art }); await saveFile(`${kit.file}-kit.zip`, zip(files)); } finally { e.target.disabled = false; } };
  $('#dl-sheet').onclick = async () => saveFile(`${kit.file}-paint-sheet.png`, await canvasBlob(getSheet().canvas));
  $('#dl-template').onclick = async () => saveFile(`${kit.file}-template.png`, await canvasBlob(templateSheet(kit)));
  $('#up-sheet').onchange = (e) => { loadSheet(e.target.files[0]); e.target.value = ''; };
  $('#up-kit').onchange = (e) => { openKit(e.target.files[0]); e.target.value = ''; };
  $('#clear-art').onclick = () => { state.art = {}; rebuild(); say('Placeholder art restored'); };
  $('#copy-brief').onclick = () => copy(brief(kit, getSheet()));
  $('#dl-brief').onclick = () => saveFile(`${kit.file}-art-brief.md`, new Blob([brief(kit, getSheet())], { type: 'text/markdown' }));
  $('#apply-settings').onclick = applySettings; $('#copy-settings').onclick = () => copy($('#settings').value, $('#settings'));
}

if (renderer) { buildControls(); wire(); rebuild(); setWeapon(state.weapon); requestAnimationFrame(tick); }
// hooks for automated checks
window.App = { state, loop, get kit() { return kit; }, get view() { return view; }, rebuild, setWeapon, setTab, draw, getSheet, loadSheet, loadPiece, openKit, kitFiles: () => kitFiles(kit, { art: state.art }), zip, unzip, step(dt) { view.char.update(dt); } };
