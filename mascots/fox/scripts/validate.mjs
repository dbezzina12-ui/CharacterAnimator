// Structural validation of the fox rig: pure Node, no browser. Writes validation/report.json.
// Checks are per frame at 60 Hz over every clip (plus the exact marker times).
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { solvePose, sampleClip } from '../src/solver.js';
import { CLIPS, BALL } from '../src/clips.js';
import { SKELETON, CLUB, CHANNEL_DEFAULTS } from '../src/skeleton.js';
import { createRig } from '../src/rig.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const results = []; let failures = 0;
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const poseKey = (p) => JSON.stringify([...p.bones.values()].map((b) => [b.name, +b.head.x.toFixed(6), +b.head.y.toFixed(6), +b.angle.toFixed(8)]).concat([Object.entries(p.channels), [p.rootScale.x, p.rootScale.y]]));

const HZ = 60;
const summary = {};
for (const [name, clip] of Object.entries(CLIPS)) {
  const times = []; for (let i = 0; i <= Math.round(clip.duration * HZ); i++) times.push(i / HZ);
  for (const t of Object.values(clip.markers || {})) times.push(t);
  let maxLenErr = 0, nan = 0, maxReach = 0, maxGripReach = 0, maxFootDrift = 0, minToe = Infinity, maxGripDist = 0, badLayer = 0;
  let maxLag = 0;
  const restAnkle = { L: SKELETON.bones.get('foot_L').restHead, R: SKELETON.bones.get('foot_R').restHead };
  const keysFoot = { L: !!clip.tracks['ik:foot_L'], R: !!clip.tracks['ik:foot_R'] };
  for (const t of times) {
    const p = solvePose(clip, t);
    const root = p.bones.get('root');
    for (const b of p.bones.values()) {
      const L = Math.hypot(b.tail.x - b.head.x, b.tail.y - b.head.y);
      maxLenErr = Math.max(maxLenErr, Math.abs(L - SKELETON.bones.get(b.name).length));
      if (![b.head.x, b.head.y, b.angle].every(Number.isFinite)) nan++;
    }
    for (const [k, e] of Object.entries(p.ikErrors)) { maxReach = Math.max(maxReach, e); if (k.startsWith('arm') && p.gripSides?.includes(k.slice(-1))) maxGripReach = Math.max(maxGripReach, e); }
    for (const side of ['L', 'R']) {
      const ankle = p.bones.get(`foot_${side}`).head;
      if (clip.plant !== false && !keysFoot[side]) maxFootDrift = Math.max(maxFootDrift, Math.hypot(ankle.x - root.head.x - restAnkle[side].x, ankle.y - root.head.y - restAnkle[side].y));
      minToe = Math.min(minToe, -(p.bones.get(`foot_${side}`).tail.y - root.head.y));
      if (p.gripSides?.includes(side)) {
        const g = p.clubPoint(side === 'L' ? CLUB.gripTop : CLUB.gripLow);
        const wrist = p.bones.get(`hand_${side}`).head;
        maxGripDist = Math.max(maxGripDist, Math.hypot(g.x - wrist.x, g.y - wrist.y));
      }
    }
    for (const k of ['armLFront', 'armRFront', 'clubBehind', 'clubVisible']) if (p.channels[k] !== 0 && p.channels[k] !== 1) badLayer++;
    // follow-through magnitude (difference from the primary FK angle of tail/ear bones) stays bounded by the clamp
    const s = sampleClip(clip, t);
    for (const n of ['tail_01', 'tail_02', 'tail_03', 'tail_04', 'tail_05', 'ear_L_02', 'ear_R_02']) {
      const b = p.bones.get(n), parent = p.bones.get(SKELETON.bones.get(n).parent);
      const fk = parent.angle + SKELETON.bones.get(n).localRestAngle + (s.rot[n] || 0);
      let d = b.angle - fk; d = Math.atan2(Math.sin(d), Math.cos(d));
      maxLag = Math.max(maxLag, Math.abs(d) * 180 / Math.PI);
    }
  }
  summary[name] = { frames: times.length, maxBoneLengthError: maxLenErr, nonFinite: nan, maxIkReachError: maxReach, maxGripReachError: maxGripReach, maxPlantedFootDrift: maxFootDrift, minToeHeightAboveGround: minToe, maxWristToGripDistance: maxGripDist, maxFollowThroughDeg: maxLag };
  check(`${name}: bone lengths constant`, maxLenErr < 1e-6, `max error ${maxLenErr.toExponential(2)} px over ${times.length} frames`);
  check(`${name}: all transforms finite`, nan === 0);
  check(`${name}: planted feet stay on their spots`, maxFootDrift < 1e-6, `max drift ${maxFootDrift.toExponential(2)} px`);
  check(`${name}: feet never below the ground`, minToe > -0.5, `lowest toe ${minToe.toFixed(2)} px above ground`);
  check(`${name}: hands reach the club grip`, maxGripReach < 0.5 && (maxGripDist === 0 || maxGripDist < 18.6), `reach error ${maxGripReach.toFixed(3)} px, wrist→grip ≤ ${maxGripDist.toFixed(2)} px (fist radius 18)`);
  check(`${name}: draw-order channels are stepped 0/1`, badLayer === 0);
  check(`${name}: follow-through bounded`, maxLag <= 38.01, `max ${maxLag.toFixed(1)}°`);
  // determinism: same time -> identical pose, regardless of evaluation order
  const a = poseKey(solvePose(clip, clip.duration * 0.37)); solvePose(clip, 0.1); solvePose(clip, clip.duration);
  check(`${name}: deterministic (same time → same pose)`, a === poseKey(solvePose(clip, clip.duration * 0.37)));
  if (clip.loop) {
    const d = [...solvePose(clip, 0).bones.values()].map((b, i) => { const c = [...solvePose(clip, clip.duration).bones.values()][i]; return Math.hypot(b.head.x - c.head.x, b.head.y - c.head.y); });
    check(`${name}: seamless loop (pose at 0 == pose at duration)`, Math.max(...d) < 1e-6, `max joint gap ${Math.max(...d).toExponential(2)} px`);
  }
}

// idle: stationary except the eyelids
{
  const base = solvePose(CLIPS.idle, 0); let moved = 0, changedCh = new Set(), blinks = 0, prev = 0;
  for (let i = 0; i <= 6 * HZ; i++) {
    const p = solvePose(CLIPS.idle, i / HZ);
    for (const b of p.bones.values()) { const q = base.bones.get(b.name); if (Math.hypot(b.head.x - q.head.x, b.head.y - q.head.y) > 1e-9 || Math.abs(b.angle - q.angle) > 1e-9) moved++; }
    for (const k of Object.keys(p.channels)) if (p.channels[k] !== base.channels[k]) changedCh.add(k);
    if (p.channels.blink_L > 0.5 && prev <= 0.5) blinks++; prev = p.channels.blink_L;
  }
  check('idle: no bone moves (stationary pose)', moved === 0, `${moved} moved samples`);
  check('idle: only the eyelid channels change', [...changedCh].every((k) => k === 'blink_L' || k === 'blink_R'), `changed: ${[...changedCh].join(', ')}`);
  check('idle: blinks per 6 s loop', blinks === 3, `${blinks} eyelid closures (one single + one double blink)`);
}

// golf contact: at the contact marker the club head is at the ball and travelling toward the target (+x)
for (const name of ['swing', 'drive']) {
  const clip = CLIPS[name], tc = clip.markers.contact;
  const head = (t) => solvePose(clip, t).clubPoint(CLUB.headStart);
  const h = head(tc), before = head(tc - 1 / 60), after = head(tc + 1 / 60);
  const dist = Math.hypot(h.x - BALL.x, h.y - BALL.y);
  check(`${name}: club head at the ball on the contact marker`, dist < 24, `${dist.toFixed(1)} px from the ball at t=${tc}s`);
  check(`${name}: club head moving toward the target at contact`, after.x > before.x && (after.x - before.x) * 30 > 300, `${((after.x - before.x) * 30).toFixed(0)} px/s`);
  const top = solvePose(clip, clip.markers.top).clubPoint(1);
  check(`${name}: club head behind the head at the top of the backswing`, top.x < -40 && top.y < -480, `(${top.x.toFixed(0)}, ${top.y.toFixed(0)})`);
}

// address ends with the club head behind the ball
{
  const h = solvePose(CLIPS.address, CLIPS.address.duration).clubPoint(CLUB.headStart);
  check('address: club head rests behind the ball', Math.abs(h.y - BALL.y) < 14 && h.x < BALL.x && h.x > BALL.x - 30, `(${h.x.toFixed(0)}, ${h.y.toFixed(0)}) vs ball (${BALL.x}, ${BALL.y})`);
}

// playback controller: markers fire once per live pass whatever the frame step, never on seek
{
  const run = (dt, speed) => { const fired = []; const rig = createRig({ eventTarget: null, onMarker: (d) => fired.push(d.marker) }); rig.play('swing', { speed }); for (let i = 0; i < 400 && rig.state.playing; i++) rig.advance(dt); return fired; };
  const smooth = run(1 / 60, 1), choppy = run(0.45, 1), turbo = run(1 / 60, 3);
  check('player: markers fire exactly once at 60 fps', smooth.join() === 'top,contact,finish,end', smooth.join());
  check('player: skipped frames (0.45 s steps) still fire every marker once', choppy.join() === smooth.join(), choppy.join());
  check('player: turbo (3×) fires the same markers once', turbo.join() === smooth.join(), turbo.join());
  const fired = []; const rig = createRig({ eventTarget: null, onMarker: (d) => fired.push(d.marker) }); rig.play('swing'); rig.pause();
  for (let i = 0; i <= 100; i++) rig.seek(3.4 * i / 100); rig.seek(0); rig.seek(1.42); rig.seek(3.4);
  check('player: scrubbing never fires markers', fired.length === 0, `${fired.length} fired`);
  const rig2 = createRig({ eventTarget: null }); let resolved = null; rig2.play('swing', { resolveAt: 'contact' }).then((d) => { resolved = d; });
  for (let i = 0; i < 100; i++) rig2.advance(0.02);
  await Promise.resolve();
  check('player: play("swing") resolves at the contact marker', resolved?.marker === 'contact' && near(resolved.time, 1.42, 1e-9), JSON.stringify(resolved));
}

const outDir = path.join(here, '..', 'validation'); fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ generated: new Date().toISOString(), failures, checks: results, perClip: summary }, null, 1));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
if (failures) process.exit(1);
