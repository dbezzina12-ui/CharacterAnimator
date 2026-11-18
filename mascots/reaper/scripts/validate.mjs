// Structural validation of the reaper rig: pure Node. Writes validation/report.json.
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
import { solvePose, sampleClip } from '../src/solver.js';
import { CLIPS } from '../src/clips.js';
import { SKELETON, PROP } from '../src/skeleton.js';
import { createRig } from '../src/rig.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const results = []; let failures = 0;
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }
const poseKey = (p) => JSON.stringify([...p.bones.values()].map((b) => [b.name, +b.head.x.toFixed(6), +b.head.y.toFixed(6), +b.angle.toFixed(8)]).concat([Object.entries(p.channels), [p.rootScale.x, p.rootScale.y]]));
const HZ = 60; const summary = {};
const LAGGED = ['tassel_01', 'tassel_02', 'hood_01', 'hood_02', 'skirt_R', 'skirt_L', 'skirt_F', 'mantle'];
for (const [name, clip] of Object.entries(CLIPS)) {
  const times = []; for (let i = 0; i <= Math.round(clip.duration * HZ); i++) times.push(i / HZ);
  for (const t of Object.values(clip.markers || {})) times.push(t);
  let maxLenErr = 0, nan = 0, maxGripReach = 0, maxFootDrift = 0, minToe = Infinity, maxGripDist = 0, badLayer = 0, maxLag = 0;
  const restAnkle = { L: SKELETON.bones.get('foot_L').restHead, R: SKELETON.bones.get('foot_R').restHead };
  const keysFoot = { L: !!clip.tracks['ik:foot_L'], R: !!clip.tracks['ik:foot_R'] };
  for (const t of times) {
    const p = solvePose(clip, t); const root = p.bones.get('root');
    for (const b of p.bones.values()) { maxLenErr = Math.max(maxLenErr, Math.abs(Math.hypot(b.tail.x - b.head.x, b.tail.y - b.head.y) - SKELETON.bones.get(b.name).length)); if (![b.head.x, b.head.y, b.angle].every(Number.isFinite)) nan++; }
    for (const [k, e] of Object.entries(p.ikErrors)) if (k.startsWith('arm') && p.gripSides?.includes(k.slice(-1))) maxGripReach = Math.max(maxGripReach, e);
    for (const side of ['L', 'R']) {
      const ankle = p.bones.get(`foot_${side}`).head;
      if (clip.plant !== false && !keysFoot[side]) maxFootDrift = Math.max(maxFootDrift, Math.hypot(ankle.x - root.head.x - restAnkle[side].x, ankle.y - root.head.y - restAnkle[side].y));
      minToe = Math.min(minToe, -(p.bones.get(`foot_${side}`).tail.y - root.head.y));
      if (p.gripSides?.includes(side)) { const g = p.propPoint(side === 'L' ? PROP.gripTop : PROP.gripLow); const w = p.bones.get(`hand_${side}`).head; maxGripDist = Math.max(maxGripDist, Math.hypot(g.x - w.x, g.y - w.y)); }
    }
    for (const k of ['armLFront', 'armRFront', 'propBehind', 'propVisible']) if (p.channels[k] !== 0 && p.channels[k] !== 1) badLayer++;
    const s = sampleClip(clip, t);
    for (const n of LAGGED) { const b = p.bones.get(n), parent = p.bones.get(SKELETON.bones.get(n).parent); const fk = parent.angle + SKELETON.bones.get(n).localRestAngle + (s.rot[n] || 0); let d = b.angle - fk; d = Math.atan2(Math.sin(d), Math.cos(d)); maxLag = Math.max(maxLag, Math.abs(d) * 180 / Math.PI); }
  }
  summary[name] = { frames: times.length, maxBoneLengthError: maxLenErr, nonFinite: nan, maxGripReachError: maxGripReach, maxPlantedFootDrift: maxFootDrift, minToeHeightAboveGround: minToe, maxWristToGripDistance: maxGripDist, maxFollowThroughDeg: maxLag };
  check(`${name}: bone lengths constant`, maxLenErr < 1e-6, `max error ${maxLenErr.toExponential(2)} px over ${times.length} frames`);
  check(`${name}: all transforms finite`, nan === 0);
  check(`${name}: planted feet stay on their spots`, maxFootDrift < 1e-6, `max drift ${maxFootDrift.toExponential(2)} px`);
  check(`${name}: feet never below the ground`, minToe > -0.5, `lowest toe ${minToe.toFixed(2)} px above ground`);
  check(`${name}: hands stay on the scythe grip`, maxGripReach < 0.5 && (maxGripDist === 0 || maxGripDist < 18.6), `reach error ${maxGripReach.toFixed(3)} px, wrist→grip ≤ ${maxGripDist.toFixed(2)} px`);
  check(`${name}: draw-order channels are stepped 0/1`, badLayer === 0);
  check(`${name}: follow-through bounded`, maxLag <= 32.01, `max ${maxLag.toFixed(1)}°`);
  const a = poseKey(solvePose(clip, clip.duration * 0.37)); solvePose(clip, 0.1); solvePose(clip, clip.duration);
  check(`${name}: deterministic (same time → same pose)`, a === poseKey(solvePose(clip, clip.duration * 0.37)));
  if (clip.loop) { const A = [...solvePose(clip, 0).bones.values()], B = [...solvePose(clip, clip.duration).bones.values()]; const gap = Math.max(...A.map((b, i) => Math.hypot(b.head.x - B[i].head.x, b.head.y - B[i].head.y))); check(`${name}: seamless loop`, gap < 1e-6, `max joint gap ${gap.toExponential(2)} px`); }
}
{ // stationary idle: only the glints
  const base = solvePose(CLIPS.idle, 0); let moved = 0; const changed = new Set();
  for (let i = 0; i <= 6 * HZ; i++) { const p = solvePose(CLIPS.idle, i / HZ); for (const b of p.bones.values()) { const q = base.bones.get(b.name); if (Math.hypot(b.head.x - q.head.x, b.head.y - q.head.y) > 1e-9 || Math.abs(b.angle - q.angle) > 1e-9) moved++; } for (const k of Object.keys(p.channels)) if (p.channels[k] !== base.channels[k]) changed.add(k); }
  check('idle: no bone moves (stationary pose)', moved === 0, `${moved} moved samples`);
  check('idle: only the eye-glow channel changes', [...changed].every((k) => k === 'eyeGlow'), `changed: ${[...changed].join(', ')}`);
}
{ // slash: the blade tip sweeps low across the front at speed around the hit marker
  const c = CLIPS.slash, th = c.markers.hit; const tip = (t) => solvePose(c, t).propPoint(PROP.blade);
  let vmax = 0; for (let k = 0; k < 10; k++) { const t0 = th - 0.15 + k * 0.03; vmax = Math.max(vmax, Math.hypot(tip(t0 + 0.03).x - tip(t0).x, tip(t0 + 0.03).y - tip(t0).y) / 0.03); }
  const w = solvePose(c, c.markers.windup).propPoint(PROP.blade), h = tip(th);
  check('slash: blade high behind the shoulder at the wind-up', w.y < -380, `blade at (${w.x.toFixed(0)}, ${w.y.toFixed(0)})`);
  check('slash: blade sweeps low in front at the hit marker', h.y > -140 && h.x > 0, `blade at (${h.x.toFixed(0)}, ${h.y.toFixed(0)})`);
  check('slash: blade tip speed > 2000 px/s through the cut', vmax > 2000, `${vmax.toFixed(0)} px/s`);
}
{ // death: scythe released, glints out, body down
  const p = solvePose(CLIPS.death, CLIPS.death.duration);
  check('death: scythe released and on the ground', !p.grip && p.propPoint(PROP.butt).y > -80 && p.propPoint(PROP.blade).y > -200, `butt y ${p.propPoint(PROP.butt).y.toFixed(0)}, blade y ${p.propPoint(PROP.blade).y.toFixed(0)}`);
  check('death: glints out', p.channels.eyeGlow === 0);
  check('death: robe collapsed (pelvis dropped > 90 px)', p.bones.get('pelvis').head.y > SKELETON.bones.get('pelvis').restHead.y + 90);
}
{ // player
  const run = (dt, speed) => { const f = []; const rig = createRig({ eventTarget: null, onMarker: (d) => f.push(d.marker) }); rig.play('slash', { speed }); for (let i = 0; i < 400 && rig.state.playing; i++) rig.advance(dt); return f; };
  const smooth = run(1 / 60, 1), choppy = run(0.45, 1), turbo = run(1 / 60, 3);
  check('player: markers fire exactly once at 60 fps', smooth.join() === 'windup,hit,recover,end', smooth.join());
  check('player: skipped frames (0.45 s steps) still fire every marker once', choppy.join() === smooth.join(), choppy.join());
  check('player: turbo (3×) fires the same markers once', turbo.join() === smooth.join(), turbo.join());
  const fired = []; const rig = createRig({ eventTarget: null, onMarker: (d) => fired.push(d.marker) }); rig.play('slash'); rig.pause(); for (let i = 0; i <= 100; i++) rig.seek(1.7 * i / 100);
  check('player: scrubbing never fires markers', fired.length === 0, `${fired.length} fired`);
  const rig2 = createRig({ eventTarget: null }); let resolved = null; rig2.play('slash', { resolveAt: 'hit' }).then((d) => { resolved = d; }); for (let i = 0; i < 100; i++) rig2.advance(0.02); await Promise.resolve();
  check('player: play("slash") resolves at the hit marker', resolved?.marker === 'hit' && Math.abs(resolved.time - 0.62) < 1e-9, JSON.stringify(resolved));
}
const outDir = path.join(here, '..', 'validation'); fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ generated: new Date().toISOString(), failures, checks: results, perClip: summary }, null, 1));
console.log(`\n${results.length - failures}/${results.length} checks passed`); if (failures) process.exit(1);
