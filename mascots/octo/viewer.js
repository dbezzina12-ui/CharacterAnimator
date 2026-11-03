import { createRig, animate } from './src/rig.js';
import { CLIPS } from './src/clips.js';
import { BONE_NAMES } from './src/skeleton.js';
import { partOrder, drawPose, drawSkeleton } from './src/renderer.js';
import { solvePose } from './src/solver.js';

const $ = (id) => document.getElementById(id);
const canvas = $('c'), ctx = canvas.getContext('2d');
const events = $('events');
const rig = createRig({ onMarker: (d) => { const line = document.createElement('div'); line.textContent = `${d.clip}:${d.marker} @ ${d.time.toFixed(3)}s`; events.prepend(line); } });
const hidden = new Set();
let selectedBone = null, poseOffset = {}, onion = false, showSkeleton = false, mirror = false, showGround = true;

// ---- controls
const clipSel = $('clip');
for (const [name, c] of Object.entries(CLIPS)) { const o = document.createElement('option'); o.value = name; o.textContent = `${name} (${c.duration}s${c.loop ? ', loop' : ''})`; clipSel.append(o); }
const boneSel = $('bone');
for (const n of BONE_NAMES) { const o = document.createElement('option'); o.value = n; o.textContent = n; boneSel.append(o); }
const partsBox = $('parts');
for (const [id] of partOrder(solvePose(CLIPS.idle, 0))) {
  if (partsBox.querySelector(`[data-part="${id}"]`)) continue;
  const l = document.createElement('label'); l.className = 'chk'; l.innerHTML = `<input type="checkbox" checked data-part="${id}"> ${id}`;
  l.querySelector('input').onchange = (e) => { e.target.checked ? hidden.delete(id) : hidden.add(id); loop.invalidate(); };
  partsBox.append(l);
}
function selectClip(name) {
  rig.play(name); rig.pause(); rig.seek(0);
  $('loop').checked = !!CLIPS[name].loop; rig.state.loop = null;
  $('desc').textContent = CLIPS[name].description || '';
  $('scrub').max = CLIPS[name].duration;
  const marks = $('marks'); marks.innerHTML = '';
  for (const [m, t] of Object.entries(CLIPS[name].markers || {})) { const s = document.createElement('span'); s.style.left = `${(t / CLIPS[name].duration) * 100}%`; s.textContent = `${m} ${t.toFixed(2)}`; marks.append(s); }
  loop.invalidate();
}
clipSel.onchange = () => selectClip(clipSel.value);
$('playBtn').onclick = () => { if (rig.state.playing) rig.pause(); else rig.resume(); loop.invalidate(); };
$('restart').onclick = () => { rig.seek(0); rig.resume(); };
$('loop').onchange = (e) => { rig.state.loop = e.target.checked; };
$('mirror').onchange = (e) => { mirror = e.target.checked; loop.invalidate(); };
$('light').onchange = (e) => { $('stage').classList.toggle('light', e.target.checked); loop.invalidate(); };
$('speed').oninput = (e) => { rig.setSpeed(+e.target.value); $('speedv').textContent = `${(+e.target.value).toFixed(2)}×`; };
$('skeleton').onchange = (e) => { showSkeleton = e.target.checked; loop.invalidate(); };
$('onion').onchange = (e) => { onion = e.target.checked; loop.invalidate(); };
$('ground').onchange = (e) => { showGround = e.target.checked; loop.invalidate(); };
$('scrub').oninput = (e) => { rig.pause(); rig.seek(+e.target.value); loop.invalidate(); };
$('prev').onclick = () => { rig.pause(); rig.seek(rig.state.time - 1 / 30); loop.invalidate(); };
$('next').onclick = () => { rig.pause(); rig.seek(rig.state.time + 1 / 30); loop.invalidate(); };
boneSel.onchange = () => { selectedBone = boneSel.value; $('boneRot').value = poseOffset[selectedBone] || 0; $('boneRotv').textContent = `${$('boneRot').value}°`; loop.invalidate(); };
$('boneRot').oninput = (e) => { if (!selectedBone) return; poseOffset[selectedBone] = +e.target.value; $('boneRotv').textContent = `${e.target.value}°`; loop.invalidate(); };
$('boneReset').onclick = () => { poseOffset = {}; $('boneRot').value = 0; $('boneRotv').textContent = '0°'; loop.invalidate(); };
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); $('playBtn').click(); }
  if (e.key === 'ArrowLeft') $('prev').click(); if (e.key === 'ArrowRight') $('next').click();
});

// ---- pose layer: apply additive FK offsets by wrapping the clip
function clipWithOffsets(clip) {
  const names = Object.keys(poseOffset).filter((k) => poseOffset[k]);
  if (!names.length) return clip;
  const tracks = { ...clip.tracks };
  for (const n of names) {
    const base = tracks[n];
    tracks[n] = base ? base.map(([t, v, e]) => [t, v + poseOffset[n], e]) : [[0, poseOffset[n]]];
  }
  return { ...clip, tracks };
}

// ---- stage
function view() {
  const w = canvas.width, h = canvas.height;
  const scale = Math.min(w / 760, h / 620) * 0.95;
  return { x: w / 2, y: h * 0.9, scale, mirror };
}
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = $('stage').getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  loop.invalidate();
}
window.addEventListener('resize', resize);
canvas.addEventListener('pointerdown', (e) => {
  const v = view(); const dpr = canvas.width / canvas.getBoundingClientRect().width;
  const px = e.offsetX * dpr, py = e.offsetY * dpr;
  const pose = rig.state.lastPose; if (!pose) return;
  let best = null, bd = 18 * dpr;
  for (const b of pose.bones.values()) {
    const sx = v.x + (v.mirror ? -1 : 1) * b.head.x * v.scale * pose.rootScale.x, sy = v.y + b.head.y * v.scale * pose.rootScale.y;
    const d = Math.hypot(sx - px, sy - py); if (d < bd) { bd = d; best = b.name; }
  }
  if (best) { selectedBone = best; boneSel.value = best; $('boneRot').value = poseOffset[best] || 0; $('boneRotv').textContent = `${$('boneRot').value}°`; loop.invalidate(); }
});


function render() {
  const t = rig.state.time, clip = clipWithOffsets(CLIPS[rig.state.clip]);
  const v = view();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // ground line
  if (showGround) { ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, v.y + 0.5); ctx.lineTo(canvas.width, v.y + 0.5); ctx.stroke(); ctx.restore(); }
  if (onion) {
    for (const dt of [-3 / 30, -2 / 30, -1 / 30]) {
      ctx.save(); ctx.globalAlpha = 0.18 + 0.1 * (dt * 30 + 3);
      drawPose(ctx, solvePose(clip, t + dt), v, hidden); ctx.restore();
    }
  }
  const pose = solvePose(clip, t); rig.state.lastPose = pose;
  drawPose(ctx, pose, v, hidden);
  if (showSkeleton) drawSkeleton(ctx, pose, v, selectedBone);
  // HUD
  $('playBtn').textContent = rig.state.playing ? 'Pause' : 'Play';
  if (!$('scrub').matches(':active')) $('scrub').value = t;
  $('time').textContent = `${t.toFixed(3)} s  ·  frame ${Math.round(t * 30)}  /  ${Math.round(clip.duration * 30)}`;
  const errs = Object.entries(pose.ikErrors).filter(([, e]) => e > 0.01).map(([k, e]) => `${k}:${e.toFixed(1)}px`).join(' ');
  const b = selectedBone ? pose.bones.get(selectedBone) : null;
  $('info').textContent = [
    `clip ${pose.clip}  squash ${pose.rootScale.x.toFixed(2)}×${pose.rootScale.y.toFixed(2)}  IK tentacles: ${pose.ikSet.length ? pose.ikSet.join(', ') : 'none'}`,
    `blink L ${pose.channels.blink_L.toFixed(2)} R ${pose.channels.blink_R.toFixed(2)}  brow ${pose.channels.brow.toFixed(2)}  mouth ${pose.channels.mouth.toFixed(2)}  glow ${pose.channels.glow.toFixed(2)}  heat ${pose.channels.eyeHeat.toFixed(2)}`,
    `layers mid ${pose.channels.midOverHead >= 0.5 ? 'over head' : 'behind'}  front ${pose.channels.frontOverHead >= 0.5 ? 'over head' : 'behind'}  ripple ${pose.channels.ripple.toFixed(1)}°`,
    errs ? `IK tip error: ${errs}` : 'IK: all targets reached',
    b ? `${b.name}: head (${b.head.x.toFixed(1)}, ${b.head.y.toFixed(1)}) angle ${(b.angle * 180 / Math.PI).toFixed(1)}° len ${b.length.toFixed(1)}` : 'click a joint to inspect a bone',
  ].join('\n');
}
const loop = animate(rig, render);

// ---- export
function download(name, url) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }
$('png').onclick = () => {
  const off = document.createElement('canvas'); off.width = 512; off.height = 512; const c2 = off.getContext('2d');
  drawPose(c2, solvePose(clipWithOffsets(CLIPS[rig.state.clip]), rig.state.time), { x: 256, y: 480, scale: 0.5, mirror }, hidden);
  download(`${rig.state.clip}-${rig.state.time.toFixed(2)}s.png`, off.toDataURL('image/png'));
};
$('json').onclick = () => download(`${rig.state.clip}.clip.json`, 'data:application/json,' + encodeURIComponent(JSON.stringify(CLIPS[rig.state.clip], null, 1)));
$('sheet').onclick = async () => {
  const { exportAtlas } = await import('./src/atlas.js');
  const res = exportAtlas([rig.state.clip], { clips: CLIPS, fps: 30, cell: 512, scale: 0.5, mirror });
  res.pages.forEach((p, i) => download(`${rig.state.clip}-page${i + 1}.png`, p));
  download(`${rig.state.clip}-atlas.json`, 'data:application/json,' + encodeURIComponent(JSON.stringify(res.manifest, null, 1)));
};

resize(); selectClip('idle'); rig.resume();
window.OctoViewer = { rig, CLIPS, solvePose, hidden, get poseOffset() { return poseOffset; } };
