// Loads both skeletons in the official Spine 4.2 web runtime (headless Chromium) and checks the rig:
// constraints, grips, planted feet, events, loops. Also renders pose strips to validation/.
// usage: node spine-base/scripts/validate.mjs   (SPINE_WEBGL=<path to spine-webgl.js> to use a local runtime copy)
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
import { startServer } from '../../scripts/serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const here = path.dirname(fileURLToPath(import.meta.url)); const outDir = path.join(here, '..', 'validation'); fs.mkdirSync(outDir, { recursive: true });
const localRuntime = process.env.SPINE_WEBGL;
const results = []; let failures = 0;
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const server = await startServer(0); const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
if (localRuntime) await page.route('**/spine-webgl.js', (r) => r.fulfill({ path: localRuntime, contentType: 'text/javascript' }));
await page.goto(`http://127.0.0.1:${port}/spine-base/runtime/viewer.html`);
await page.waitForFunction(() => window.Viewer || window.ViewerError, null, { timeout: 60000 });
const loadErr = await page.evaluate(() => window.ViewerError || null);
check('skeletons load in the Spine 4.2 runtime', !loadErr, loadErr || '');
if (loadErr) { console.log(errors.join('\n')); await browser.close(); server.close(); process.exit(1); }
await page.evaluate(() => { window.Viewer.state.paused = true; document.getElementById('title').hidden = true; document.getElementById('log').hidden = true; });

const HANDS = { human: 24, dwarf: 27 };
/** Run an animation with fixed 1/60 s steps and sample bones each frame. */
async function run(weapon, anim, seconds, opts = {}) {
  return page.evaluate(async ({ weapon, anim, seconds, opts }) => {
    const V = window.Viewer;
    if (opts.dirty) { V.setWeapon('staff'); V.chars.forEach((ch) => ch.state.setAnimation(0, 'staff/slam', false)); for (let i = 0; i < 24; i++) V.step(1 / 60); V.setWeapon('gun'); for (let i = 0; i < 10; i++) V.step(1 / 60); }
    V.setWeapon(weapon); for (let i = 0; i < 30; i++) V.step(1 / 60);     // settle into idle
    const events = []; const offs = V.chars.map((ch) => ch.onEvent((ev, a, t) => events.push({ id: ch.id, ev, anim: a, t })));
    if (anim) V.chars.forEach((ch) => { const e = ch.state.setAnimation(0, anim, !!opts.loop); if (!opts.loop) ch.state.addAnimation(0, ch.idle, true, 0); void e; });
    const names = ['cape-1', 'cape-4', 'chest', 'hand-near', 'hand-far', 'staff', 'staff-grip-far', 'staff-grip-near', 'staff-foot', 'gun', 'gun-grip-near', 'foot-near', 'foot-far', 'foot-near-target', 'foot-far-target', 'hip', 'head', 'forearm-near', 'forearm-far', 'shin-near', 'shin-far'];
    const frames = [];
    for (let i = 0; i <= Math.round(seconds * 60); i++) {
      const f = { t: i / 60 }; for (const ch of V.chars) { f[ch.id] = {}; for (const n of names) f[ch.id][n] = V.bone(ch.id, n);
        f[ch.id].ikNear = ch.skeleton.ikConstraints.filter((c) => c.active && c.data.name.includes('near-arm')).map((c) => c.mix)[0] ?? 0; }
      frames.push(f); V.step(1 / 60);
    }
    offs.forEach((o) => o()); return { frames, events };
  }, { weapon, anim, seconds, opts });
}
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angDiff = (a, b) => { let x = a - b; while (x > 180) x -= 360; while (x < -180) x += 360; return Math.abs(x); };

const info = await page.evaluate(() => ({ human: window.Viewer.info('human'), dwarf: window.Viewer.info('dwarf') }));
check('human and dwarf share bones, slots, skins, constraints, animations and events', JSON.stringify({ ...info.human, animations: info.human.animations.map((a) => a[0]) }) === JSON.stringify({ ...info.dwarf, animations: info.dwarf.animations.map((a) => a[0]) }),
  `${info.human.bones} bones, ${info.human.slots} slots, skins ${info.human.skins.join('/')}, ${info.human.animations.length} animations`);

for (const id of ['human', 'dwarf']) {
  // ---- staff
  for (const [anim, secs] of [[null, 2.0], ['staff/slam', 1.3]]) {
    const { frames, events } = await run('staff', anim, secs, { dirty: !anim }); const label = `${id} staff ${anim || 'idle'}`;
    const wrist = Math.max(...frames.map((f) => d(f[id]['hand-far'], f[id]['staff-grip-far'])));
    const rotE = Math.max(...frames.map((f) => angDiff(f[id]['hand-far'].rot, f[id]['staff-grip-far'].rot)));
    check(`${label}: far hand stays on the grip`, wrist < 1 && rotE < 1, `wrist off by ≤ ${wrist.toFixed(2)} units, angle ≤ ${rotE.toFixed(2)}°`);
    const feet = Math.max(...frames.flatMap((f) => ['near', 'far'].map((s) => d(f[id][`foot-${s}`], f[id][`foot-${s}-target`]))));
    const footRot = Math.max(...frames.flatMap((f) => ['near', 'far'].map((s) => angDiff(f[id][`foot-${s}`].rot, f[id][`foot-${s}-target`].rot))));
    check(`${label}: feet planted`, feet < 1 && footRot < 0.5, `ankle off by ≤ ${feet.toFixed(2)} units, foot angle ≤ ${footRot.toFixed(2)}°`);
    if (anim) {
      const ev = events.filter((e) => e.id === id && e.ev === 'impact'); const hitF = frames[Math.round(0.56 * 60) + 1];
      check(`${label}: impact event fires once at 0.56 s`, ev.length === 1 && Math.abs(ev[0].t - 0.56) < 0.03, JSON.stringify(ev.map((e) => +e.t.toFixed(3))));
      check(`${label}: staff foot is on the ground at impact`, Math.abs(hitF[id]['staff-foot'].y) < 2, `y = ${hitF[id]['staff-foot'].y.toFixed(2)}`);
      const peak = Math.max(...frames.map((f) => f[id]['staff-foot'].y)); check(`${label}: staff lifts clear before the slam`, peak > 30, `peak lift ${peak.toFixed(0)} units`);
      const on = frames.filter((f) => f[id].ikNear > 0.99); const two = Math.max(...on.map((f) => d(f[id]['hand-near'], f[id]['staff-grip-near'])));
      check(`${label}: near hand joins for a two-handed grip`, on.length > 20 && two < 1, `${on.length} frames gripping, wrist off by ≤ ${two.toFixed(2)} units`);
      const endF = frames[frames.length - 1]; check(`${label}: near hand is released again at the end`, endF[id].ikNear < 0.01, `mix ${endF[id].ikNear.toFixed(2)}`);
    } else {
      const free = Math.min(...frames.map((f) => d(f[id]['hand-near'], f[id]['staff-grip-near']))); const mixMax = Math.max(...frames.map((f) => f[id].ikNear));
      check(`${label}: near hand is free (also after switching weapons mid-slam)`, mixMax < 0.01 && free > 25, `IK mix ${mixMax.toFixed(2)}, wrist ${free.toFixed(0)} units from the staff`);
      check(`${label}: staff foot rests on the ground`, Math.max(...frames.map((f) => Math.abs(f[id]['staff-foot'].y))) < 0.5);
      check(`${label}: loops seamlessly`, d(frames[0][id].head, frames[120][id].head) < 0.05 && d(frames[0][id].hip, frames[120][id].hip) < 0.05);
    }
  }
  // ---- gun
  for (const [anim, secs] of [[null, 2.0], ['gun/fire', 1.2]]) {
    const { frames, events } = await run('gun', anim, secs); const label = `${id} gun ${anim || 'idle'}`;
    const wrist = Math.max(...frames.map((f) => d(f[id]['hand-near'], f[id]['gun-grip-near']))); const rotE = Math.max(...frames.map((f) => angDiff(f[id]['hand-near'].rot, f[id]['gun-grip-near'].rot)));
    check(`${label}: hand stays on the gun grip`, wrist < 1 && rotE < 1, `wrist off by ≤ ${wrist.toFixed(2)} units, angle ≤ ${rotE.toFixed(2)}°`);
    const gripPt = Math.max(...frames.map((f) => { const h = f[id]['hand-near']; const g = { x: h.x + Math.cos(h.rot * Math.PI / 180) * HANDS[id], y: h.y + Math.sin(h.rot * Math.PI / 180) * HANDS[id] }; return d(g, f[id].gun); }));
    check(`${label}: fist centre sits on the gun's grip point`, gripPt < 1.5, `≤ ${gripPt.toFixed(2)} units`);
    const feet = Math.max(...frames.flatMap((f) => ['near', 'far'].map((s) => d(f[id][`foot-${s}`], f[id][`foot-${s}-target`])))); check(`${label}: feet planted`, feet < 1, `≤ ${feet.toFixed(2)} units`);
    if (anim) {
      const ev = events.filter((e) => e.id === id && e.ev === 'fire'); check(`${label}: fire event fires once at 0.24 s`, ev.length === 1 && Math.abs(ev[0].t - 0.24) < 0.03, JSON.stringify(ev.map((e) => +e.t.toFixed(3))));
      const aim = frames[Math.round(0.22 * 60)][id].gun; check(`${label}: barrel is level when the shot fires`, angDiff(aim.rot, 0) < 4, `${aim.rot.toFixed(1)}°`);
      const kick = Math.max(...frames.map((f) => f[id].gun.rot)); check(`${label}: recoil kicks the muzzle up`, kick > 8, `${kick.toFixed(1)}°`);
    }
  }
  // ---- shared
  for (const w of ['staff', 'gun', 'none']) {
    const { frames, events } = await run(w, 'hit', 0.9); const back = Math.min(...frames.map((f) => f[id].hip.x)) - frames[0][id].hip.x;
    check(`${id} ${w} hit: knocked back and recovers`, back < -5 && d(frames[frames.length - 1][id].hip, frames[0][id].hip) < 1.5 && events.some((e) => e.id === id && e.ev === 'hit'), `hip pushed ${back.toFixed(1)} units`);
  }
  { const { frames, events } = await run('none', 'win', 1.6); const up = Math.max(...frames.map((f) => f[id]['foot-near'].y)) - frames[0][id]['foot-near'].y;
    check(`${id} win: jumps and lands`, up > 8 && Math.abs(frames[frames.length - 1][id]['foot-near'].y - frames[0][id]['foot-near'].y) < 0.5 && events.some((e) => e.id === id && e.ev === 'land'), `feet leave the ground by ${up.toFixed(0)} units`); }
}

// ---- cape: one mesh on a four-bone chain with Spine physics
{
  const cape = await page.evaluate(() => window.Viewer.chars.map((ch) => { const sl = ch.skeleton.findSlot('cape'); const off = !sl.getAttachment(); ch.setCape(true); const a = sl.getAttachment(); ch.setWeapon('gun'); const kept = !!sl.getAttachment(); ch.setCape(false); const hidden = !sl.getAttachment(); return { id: ch.id, off, type: a && a.constructor.name, bonesUsed: a && a.bones ? new Set(a.bones.filter((_, i, arr) => { let k = 0, j = 0; while (j < i) { j += arr[j] + 1; k = j; } return i !== k && false; })).size : 0, verts: a ? a.worldVerticesLength / 2 : 0, kept, hidden, physics: ch.skeleton.physicsConstraints.length }; }));
  for (const c of cape) check(`${c.id} cape: hidden by default, shows as a weighted mesh, survives a weapon change, hides again`, c.off && c.type === 'MeshAttachment' && c.verts >= 10 && c.kept && c.hidden && c.physics === 4, `${c.type}, ${c.verts} vertices, ${c.physics} physics constraints`);
  await page.evaluate(() => window.Viewer.setCape(true));
  const REST = { human: null, dwarf: null };   // angles are measured from the first sample so they never straddle the ±180° seam
  const rel = (f, id) => { let x = f[id]['cape-4'].rot - f[id].chest.rot; REST[id] ??= x; x -= REST[id]; while (x > 180) x -= 360; while (x < -180) x += 360; return x; };
  for (const id of ['human', 'dwarf']) {
    const slam = await run('staff', 'staff/slam', 1.3); const a = slam.frames.map((f) => rel(f, id)); const swing = Math.max(...a) - Math.min(...a);
    const settle = await run('staff', null, 4.0); const s0 = settle.frames.slice(120, 240).map((f) => rel(f, id)), s1 = settle.frames.slice(120).map((f) => f[id]['cape-4']);
    check(`${id} cape: swings during the slam`, swing > 6 && swing < 120, `cape tip sweeps ${swing.toFixed(1)}° relative to the chest`);
    check(`${id} cape: settles into a small idle sway and stays finite`, Math.max(...s0) - Math.min(...s0) < 14 && s1.every((b) => Number.isFinite(b.x) && Number.isFinite(b.rot)), `idle sway ${(Math.max(...s0) - Math.min(...s0)).toFixed(1)}°`);
    const win = await run('none', 'win', 1.6); const w = win.frames.map((f) => rel(f, id)); check(`${id} cape: reacts to the jump`, Math.max(...w) - Math.min(...w) > 4, `${(Math.max(...w) - Math.min(...w)).toFixed(1)}°`);
  }
  await page.evaluate(() => window.Viewer.setCape(false));
}

// ---- pose strips for eyeballing
async function strip(file, weapon, anim, times, bones = false) {
  const shots = [];
  for (const t of times) {
    await page.evaluate(({ weapon, anim, t, bones }) => { const V = window.Viewer; V.state.bones = bones; V.setWeapon(weapon); for (let i = 0; i < 30; i++) V.step(1 / 60); if (anim) V.chars.forEach((ch) => ch.state.setAnimation(0, anim, false)); for (let i = 0; i < Math.round(t * 60); i++) V.step(1 / 60); V.draw(); }, { weapon, anim, t, bones });
    shots.push(await page.locator('#stage').screenshot());
  }
  const b64 = shots.map((s) => s.toString('base64'));
  const png = await page.evaluate(async ({ b64, times, anim, weapon }) => { const imgs = await Promise.all(b64.map((b) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b; }))); const w = imgs[0].width > 1200 ? 1300 : 520, h = Math.round(w * imgs[0].height / imgs[0].width); const c = document.createElement('canvas'); c.width = w * imgs.length; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#12151c'; g.fillRect(0, 0, c.width, c.height); imgs.forEach((im, i) => { g.drawImage(im, i * w, 0, w, h); g.fillStyle = '#93a0b5'; g.font = '14px sans-serif'; g.fillText(`${weapon} · ${anim || 'idle'} · t=${times[i].toFixed(2)}s`, i * w + 10, 20); }); return c.toDataURL('image/png'); }, { b64, times, anim, weapon });
  fs.writeFileSync(path.join(outDir, file), Buffer.from(png.split(',')[1], 'base64'));
}
await strip('staff-slam.png', 'staff', 'staff/slam', [0, 0.2, 0.4, 0.56, 0.7]);
await strip('gun-fire.png', 'gun', 'gun/fire', [0, 0.2, 0.27, 0.4, 0.7]);
await strip('poses.png', 'none', null, [0]);
await strip('bones.png', 'staff', null, [0], true);
await strip('win-hit.png', 'gun', 'win', [0.15, 0.38, 0.7]);
await page.setViewportSize({ width: 1500, height: 1000 });
await strip('closeup-staff.png', 'staff', 'staff/slam', [0.02, 0.4, 0.57]);
await strip('closeup-gun.png', 'gun', 'gun/fire', [0, 0.22]);
await page.setViewportSize({ width: 1100, height: 760 }); await page.evaluate(() => window.Viewer.setCape(true));
await strip('cape-slam.png', 'staff', 'staff/slam', [0, 0.4, 0.58, 0.8, 1.2]);
await strip('cape-win.png', 'none', 'win', [0.3, 0.45, 0.7]);
await browser.close(); server.close();
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ generated: new Date().toISOString(), failures, checks: results, pageErrors: errors }, null, 1));
console.log(`\n${results.length - failures}/${results.length} checks passed${errors.length ? '\npage errors: ' + errors.join(' | ') : ''}`);
if (failures) process.exit(1);
