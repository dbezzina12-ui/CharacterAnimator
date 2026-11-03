// Structural validation of the mech-octopus rig: pure Node, no browser. Writes validation/report.json.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { solvePose, sampleClip } from '../src/solver.js';
import { CLIPS } from '../src/clips.js';
import { SKELETON, TENTACLE_NAMES, tentBones } from '../src/skeleton.js';
import { createRig } from '../src/rig.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const results = []; let failures = 0;
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }
const poseKey = (p) => JSON.stringify([...p.bones.values()].map((b) => [b.name, +b.head.x.toFixed(6), +b.head.y.toFixed(6), +b.angle.toFixed(8)]).concat([Object.entries(p.channels), [p.rootScale.x, p.rootScale.y]]));
const HZ = 60; const summary = {};

for (const [name, clip] of Object.entries(CLIPS)) {
  const times = []; for (let i = 0; i <= Math.round(clip.duration * HZ); i++) times.push(i / HZ);
  for (const t of Object.values(clip.markers || {})) times.push(t);
  let maxLenErr = 0, nan = 0, maxLag = 0, badLayer = 0, maxIk = 0, maxLinkBend = 0, maxLinkBendIk = 0, lowest = -Infinity;
  for (const t of times) {
    const p = solvePose(clip, t); const root = p.bones.get('root');
    for (const b of p.bones.values()) {
      maxLenErr = Math.max(maxLenErr, Math.abs(Math.hypot(b.tail.x - b.head.x, b.tail.y - b.head.y) - SKELETON.bones.get(b.name).length));
      if (![b.head.x, b.head.y, b.angle].every(Number.isFinite)) nan++;
    }
    for (const [k, v] of Object.entries(p.ikErrors)) maxIk = Math.max(maxIk, v);
    for (const k of ['midOverHead', 'frontOverHead']) if (p.channels[k] !== 0 && p.channels[k] !== 1) badLayer++;
    const s = sampleClip(clip, t);
    for (const n of TENTACLE_NAMES) {
      const bones = tentBones(n);
      bones.forEach((bn, i) => {
        const b = p.bones.get(bn); const parent = p.bones.get(SKELETON.bones.get(bn).parent);
        // follow-through magnitude: actual angle vs the clip's own FK angle for the link
        if (!p.ikSet.includes(n) && !p.floorSet.includes(n)) { const fk = parent.angle + SKELETON.bones.get(bn).localRestAngle + (s.rot[bn] || 0); let d = b.angle - fk; d = Math.atan2(Math.sin(d), Math.cos(d)); maxLag = Math.max(maxLag, Math.abs(d) * 180 / Math.PI); }
        // joint bend of each link relative to the previous link stays plausible (no broken-back kinks)
        if (i > 0) { let d = b.angle - parent.angle; d = Math.atan2(Math.sin(d), Math.cos(d)); if (p.ikSet.includes(n)) maxLinkBendIk = Math.max(maxLinkBendIk, Math.abs(d) * 180 / Math.PI); else maxLinkBend = Math.max(maxLinkBend, Math.abs(d) * 180 / Math.PI); }
      });
      if (!p.ikSet.includes(n)) lowest = Math.max(lowest, p.bones.get(bones[4]).tail.y - root.head.y);   // authored IK tentacles are the clip's responsibility
    }
  }
  summary[name] = { frames: times.length, maxBoneLengthError: maxLenErr, nonFinite: nan, maxFollowThroughDeg: maxLag, maxLinkBendDeg: maxLinkBend, maxCoilBendDeg: maxLinkBendIk, maxIkTipError: maxIk, lowestTipRelRoot: lowest };
  check(`${name}: bone lengths constant`, maxLenErr < 1e-6, `max error ${maxLenErr.toExponential(2)} px over ${times.length} frames`);
  check(`${name}: all transforms finite`, nan === 0);
  check(`${name}: follow-through bounded`, maxLag <= 30.01, `max ${maxLag.toFixed(1)}°`);
  check(`${name}: tentacle links never kink past 140°`, maxLinkBend <= 140, `max link bend ${maxLinkBend.toFixed(1)}°`);
  if (maxLinkBendIk > 0) check(`${name}: IK-coiled tentacle never folds flat`, maxLinkBendIk <= 176, `max coil bend ${maxLinkBendIk.toFixed(1)}°`);
  check(`${name}: tentacle tips stay above the ground`, lowest <= 6, `lowest tip ${lowest.toFixed(1)} px (positive = below ground)`);
  check(`${name}: draw-order channels are stepped 0/1`, badLayer === 0);
  const a = poseKey(solvePose(clip, clip.duration * 0.37)); solvePose(clip, 0.1); solvePose(clip, clip.duration);
  check(`${name}: deterministic (same time → same pose)`, a === poseKey(solvePose(clip, clip.duration * 0.37)));
  if (clip.loop) {
    const A = [...solvePose(clip, 0).bones.values()], B = [...solvePose(clip, clip.duration).bones.values()];
    const gap = Math.max(...A.map((b, i) => Math.hypot(b.head.x - B[i].head.x, b.head.y - B[i].head.y)));
    check(`${name}: seamless loop`, gap < 1e-6, `max joint gap ${gap.toExponential(2)} px`);
  }
}

// idle: stationary except the eye shutters
{
  const base = solvePose(CLIPS.idle, 0); let moved = 0; const changed = new Set(); let blinks = 0, prev = 0;
  for (let i = 0; i <= 6 * HZ; i++) {
    const p = solvePose(CLIPS.idle, i / HZ);
    for (const b of p.bones.values()) { const q = base.bones.get(b.name); if (Math.hypot(b.head.x - q.head.x, b.head.y - q.head.y) > 1e-9 || Math.abs(b.angle - q.angle) > 1e-9) moved++; }
    for (const k of Object.keys(p.channels)) if (p.channels[k] !== base.channels[k]) changed.add(k);
    if (p.channels.blink_L > 0.5 && prev <= 0.5) blinks++; prev = p.channels.blink_L;
  }
  check('idle: no bone moves (stationary pose)', moved === 0, `${moved} moved samples`);
  check('idle: only the shutter channels change', [...changed].every((k) => k === 'blink_L' || k === 'blink_R'), `changed: ${[...changed].join(', ')}`);
  check('idle: blinks per 6 s loop', blinks === 3, `${blinks} shutter closures`);
}
// grab: CCD IK reaches its targets at the markers, the tentacle is pinned (no follow-through) and wraps
{
  const c = CLIPS.grab;
  for (const [m, tol] of [['reach', 3], ['wrap', 4], ['lift', 4]]) {
    const p = solvePose(c, c.markers[m]);
    check(`grab: effector on target at '${m}'`, p.ikErrors.tent_FL <= tol, `error ${p.ikErrors.tent_FL.toFixed(2)} px (tolerance ${tol}; the wrapped tip coils around the object)`);
  }
  const pw = solvePose(c, c.markers.wrap); const bones = tentBones('tent_FL').map((b) => pw.bones.get(b));
  const bend = Math.abs(Math.atan2(Math.sin(bones[4].angle - bones[3].angle), Math.cos(bones[4].angle - bones[3].angle))) * 180 / Math.PI;
  check('grab: tip coils around the object (tip link bent > 70° at `wrap`)', bend > 70, `${bend.toFixed(0)}°`);
  const lifted = solvePose(c, c.markers.lift).bones.get('tent_FL_05').tail;
  check('grab: object lifted to visor height', lifted.y < -220, `tip at (${lifted.x.toFixed(0)}, ${lifted.y.toFixed(0)})`);
}
// slam: both side tentacle tips hit low and fast at the marker, ripple/shake stays in bounds
{
  const c = CLIPS.slam, ts = c.markers.slam;
  const tip = (t, n) => solvePose(c, t).bones.get(`${n}_05`).tail;
  for (const n of ['tent_ML', 'tent_MR']) {
    const b = tip(ts, n); let vmax = 0;
    for (let k = 0; k < 12; k++) { const t0 = ts - 0.36 + k * 0.03; vmax = Math.max(vmax, (tip(t0 + 0.03, n).y - tip(t0, n).y) / 0.03); }
    check(`slam: ${n} tip on the ground at the marker after a fast drop`, b.y > -30 && vmax > 600, `tip y ${b.y.toFixed(0)}, peak ${vmax.toFixed(0)} px/s downward in the 0.36 s before impact`);
  }
  const wind = solvePose(c, c.markers.windup).bones.get('tent_ML_05').tail;
  check('slam: tentacles raised above the dome at the windup', wind.y < -420, `tip y ${wind.y.toFixed(0)}`);
}
// player
{
  const run = (dt, speed) => { const f = []; const rig = createRig({ eventTarget: null, onMarker: (d) => f.push(d.marker) }); rig.play('slam', { speed }); for (let i = 0; i < 400 && rig.state.playing; i++) rig.advance(dt); return f; };
  const smooth = run(1 / 60, 1), choppy = run(0.45, 1), turbo = run(1 / 60, 3);
  check('player: markers fire exactly once at 60 fps', smooth.join() === 'windup,slam,recover,end', smooth.join());
  check('player: skipped frames (0.45 s steps) still fire every marker once', choppy.join() === smooth.join(), choppy.join());
  check('player: turbo (3×) fires the same markers once', turbo.join() === smooth.join(), turbo.join());
  const fired = []; const rig = createRig({ eventTarget: null, onMarker: (d) => fired.push(d.marker) }); rig.play('slam'); rig.pause();
  for (let i = 0; i <= 100; i++) rig.seek(2.3 * i / 100); rig.seek(1.0);
  check('player: scrubbing never fires markers', fired.length === 0, `${fired.length} fired`);
  const rig2 = createRig({ eventTarget: null }); let resolved = null; rig2.play('slam', { resolveAt: 'slam' }).then((d) => { resolved = d; });
  for (let i = 0; i < 100; i++) rig2.advance(0.02);
  await Promise.resolve();
  check('player: play("slam") resolves at the slam marker', resolved?.marker === 'slam' && Math.abs(resolved.time - 1.0) < 1e-9, JSON.stringify(resolved));
}
const outDir = path.join(here, '..', 'validation'); fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ generated: new Date().toISOString(), failures, checks: results, perClip: summary }, null, 1));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
if (failures) process.exit(1);
