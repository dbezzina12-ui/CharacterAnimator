// Pose solver: samples a clip at a time, runs FK, two-bone IK (planted feet, hand targets, the
// two-hand club grip), then stateless follow-through for the tail and ears.
//
// Everything is a pure function of (clip, time). There is no simulation state, so scrubbing,
// skipping frames, turbo playback and reloads all produce identical poses for the same time.

import { SKELETON, IK_CHAINS, CLUB, CHANNEL_DEFAULTS } from './skeleton.js';
import { EASE, clamp, deg, rot, add, sub, scale, len, angleOf, normAngle, mixAngle, twoBoneIK, hash } from './math.js';

const { bones: REST, order: ORDER } = SKELETON;

// ---------------------------------------------------------------- track sampling
function lerpValue(a, b, f, angular) {
  if (typeof a === 'number') return angular ? mixAngle(a, b, f) : a + (b - a) * f;
  if (a && typeof a === 'object') {
    const out = {};
    for (const k of Object.keys(a)) out[k] = typeof a[k] === 'number' ? a[k] + ((b?.[k] ?? a[k]) - a[k]) * f : a[k];
    return out;
  }
  return f < 1 ? a : b;
}

/**
 * Sample one track. Keys: [time, value, ease?]. `ease` names the curve used to arrive AT that key.
 * Looping clips interpolate from their last key back to their first key at t = duration.
 */
export function sampleTrack(keys, t, clip, angular = false) {
  if (!keys || keys.length === 0) return undefined;
  if (keys.length === 1) return keys[0][1];
  const dur = clip.duration;
  if (clip.loop) { t = ((t % dur) + dur) % dur; }
  if (t <= keys[0][0]) {
    if (!clip.loop) return keys[0][1];
    // wrap: between last key and first key (+duration)
    const last = keys[keys.length - 1];
    const span = (dur - last[0]) + keys[0][0];
    if (span <= 1e-9) return keys[0][1];
    const f = (EASE[keys[0][2] || 'smooth'])(clamp(((t + dur) - last[0]) / span));
    return lerpValue(last[1], keys[0][1], f, angular);
  }
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const span = b[0] - a[0];
      const f = span <= 1e-9 ? 1 : (EASE[b[2] || 'smooth'])(clamp((t - a[0]) / span));
      return lerpValue(a[1], b[1], f, angular);
    }
  }
  const last = keys[keys.length - 1];
  if (!clip.loop) return last[1];
  const span = (dur - last[0]) + keys[0][0];
  if (span <= 1e-9) return last[1];
  const f = (EASE[keys[0][2] || 'smooth'])(clamp((t - last[0]) / span));
  return lerpValue(last[1], keys[0][1], f, angular);
}

/** Deterministic default blink schedule (used when a clip does not key the eyelids). */
export function autoBlink(t, period = 3.6, seed = 7) {
  const cycle = Math.floor(t / period);
  const local = t - cycle * period;
  const start = 0.9 + hash(cycle, seed) * (period - 1.4);
  const dbl = hash(cycle, seed + 1) < 0.22; // occasional double blink
  const one = (s) => { const u = (local - s) / 0.17; if (u < 0 || u > 1) return 0; return Math.sin(Math.PI * u) ** 0.8; };
  return clamp(Math.max(one(start), dbl ? one(start + 0.24) : 0));
}

/** Sample every track of a clip at time t into { rot, pos, ik, ch, grip } (angles in radians). */
export function sampleClip(clip, t) {
  const out = { rot: {}, pos: {}, ik: {}, ch: { ...CHANNEL_DEFAULTS }, grip: 0, rootScale: { x: 1, y: 1 } };
  for (const [key, keys] of Object.entries(clip.tracks || {})) {
    const [kind, name] = key === 'grip' ? ['grip', ''] : key.includes(':') ? key.split(':') : ['rot', key];
    if (kind === 'rot') out.rot[name] = deg(sampleTrack(keys, t, clip));
    else if (kind === 'pos') out.pos[name] = sampleTrack(keys, t, clip);
    else if (kind === 'ik') out.ik[name] = sampleTrack(keys, t, clip);
    else if (kind === 'ch') out.ch[name] = sampleTrack(keys, t, clip);
    else if (kind === 'grip') out.grip = sampleTrack(keys, t, clip);
    else if (kind === 'scale') out.rootScale = sampleTrack(keys, t, clip);
    else throw new Error(`unknown track kind ${kind} in clip ${clip.name}`);
  }
  if (!clip.tracks?.['ch:blink_L'] && clip.autoBlink !== false) {
    const b = autoBlink(t, clip.blinkPeriod || 3.6, clip.blinkSeed || 7);
    out.ch.blink_L = Math.max(out.ch.blink_L, b);
    out.ch.blink_R = Math.max(out.ch.blink_R, b);
  }
  return out;
}

// ---------------------------------------------------------------- FK
function fkBone(name, world, s, overrides) {
  const b = REST.get(name);
  const parent = b.parent ? world.get(b.parent) : null;
  const posOff = s.pos[name] || { x: 0, y: 0 };
  let angle;
  if (overrides && overrides.has(name)) angle = overrides.get(name);
  else angle = (parent ? parent.angle : 0) + b.localRestAngle + (s.rot[name] || 0);
  // pos offsets are authored in the parent's UPRIGHT frame (its rest orientation), so {x:0,y:30}
  // always means "30 px down" when the parent is not rotated away from rest
  const head = parent
    ? add(add(parent.head, rot(b.localOffset, parent.angle)), rot(posOff, parent.angle - parent.restAngle))
    : add(b.localOffset, posOff);
  const tail = add(head, rot({ x: b.length, y: 0 }, angle));
  world.set(name, { name, head, tail, angle, length: b.length, restAngle: b.restWorldAngle, x: head.x, y: head.y });
}

function fkSubtree(name, world, s, overrides) {
  fkBone(name, world, s, overrides);
  for (const c of REST.get(name).children) fkSubtree(c, world, s, overrides);
}

/** Resolve an IK target spec {x, y, space?} to root space. */
function resolveTarget(spec, world) {
  if (!spec) return null;
  const b = world.get(spec.space || 'root');
  if (!b) throw new Error(`ik target space ${spec.space} is not a bone`);
  return add(b.head, rot({ x: spec.x, y: spec.y }, b.angle - b.restAngle));
}

function applyIK(chainName, target, world, s, overrides, endAngle = null) {
  const ch = IK_CHAINS[chainName];
  const rootB = world.get(ch.root), midB = REST.get(ch.mid), rootR = REST.get(ch.root);
  const res = twoBoneIK(rootB.head, target, rootR.length, midB.length, ch.bend);
  overrides.set(ch.root, angleOf(sub(res.joint, rootB.head)));
  overrides.set(ch.mid, angleOf(sub(res.end, res.joint)));
  if (endAngle !== null) overrides.set(ch.end, endAngle);
  fkSubtree(ch.root, world, s, overrides);
  return res.reachError;
}

/** Position along the club bone for a marker fraction (0 = butt, 1 = club-head end). */
export function clubPoint(world, f) {
  const c = world.get('club');
  return add(c.head, rot({ x: c.length * f, y: 0 }, c.angle));
}

/** Primary pose: FK + IK + grip, no follow-through. */
export function solvePrimary(clip, t) {
  const s = sampleClip(clip, t);
  const world = new Map();
  const overrides = new Map();
  for (const name of ORDER) fkBone(name, world, s, overrides);

  const ikErrors = {};
  // planted feet: targets are the rest ankle positions in root space unless the clip keys them
  const plant = clip.plant !== false;
  for (const side of ['L', 'R']) {
    const spec = s.ik[`foot_${side}`];
    const target = spec === null ? null : spec ? resolveTarget(spec, world) : (plant ? resolveTarget({ ...REST.get(`foot_${side}`).restHead }, world) : null);
    if (target) {
      // IK-driven feet stay flat on the ground; a lifted foot droops its toes with height (up to 28°)
      const root = world.get('root');
      const height = Math.max(0, (root.head.y + REST.get(`foot_${side}`).restHead.y) - target.y);
      const droop = deg(28) * clamp(height / 90);
      const flat = REST.get(`foot_${side}`).restWorldAngle + (root.angle - root.restAngle) + (s.rot[`foot_${side}`] || 0);
      ikErrors[`leg_${side}`] = applyIK(`leg_${side}`, target, world, s, overrides, flat + droop * (side === 'L' ? 1 : -1));
    }
  }
  // hands: explicit targets, or the club grip. grip: 1 = both hands, 2 = left (lead) hand only, 3 = right only
  const g = Math.round(s.grip || 0);
  const gripSides = s.ch.clubVisible < 0.5 ? [] : g === 1 ? ['L', 'R'] : g === 2 ? ['L'] : g === 3 ? ['R'] : [];
  const gripOn = gripSides.length > 0;
  for (const side of ['L', 'R']) {
    let target = s.ik[`hand_${side}`] ? resolveTarget(s.ik[`hand_${side}`], world) : null;
    if (gripSides.includes(side)) {
      const gripPt = clubPoint(world, side === 'L' ? CLUB.gripTop : CLUB.gripLow);
      const shoulder = world.get(`upperarm_${side}`).head;
      const d = sub(gripPt, shoulder); const L = Math.max(1e-6, len(d));
      // the fist centre sits ~18 px past the wrist along the arm, so pull the wrist back a little
      target = sub(gripPt, scale(d, 18 / L));
      s.ch[`hand_${side}`] = 1;
    }
    if (target) ikErrors[`arm_${side}`] = applyIK(`arm_${side}`, target, world, s, overrides);
  }
  if (gripOn) {
    // wrists follow the club: hand axis aligned with the shaft, slightly cocked
    for (const side of gripSides) {
      const c = world.get('club');
      overrides.set(`hand_${side}`, c.angle + (side === 'L' ? -0.15 : 0.1));
      fkSubtree(`hand_${side}`, world, s, overrides);
    }
  }
  return { world, sample: s, ikErrors, grip: gripOn, gripSides };
}

// ---------------------------------------------------------------- follow-through
const TAIL = ['tail_01', 'tail_02', 'tail_03', 'tail_04', 'tail_05'];
const EARS = [['ear_L_01', 'ear_L_02'], ['ear_R_01', 'ear_R_02']];
const LAG = { tailDelay: 0.055, tailPos: 0.55, tailAng: 0.45, earDelay: 0.05, earPos: 0.9, earAng: 0.6, maxDeg: 38 };

function lagRotation(dirBone, delta, deltaAngle, gainPos, gainAng) {
  const dir = { x: Math.cos(dirBone.angle), y: Math.sin(dirBone.angle) };
  const cross = dir.x * delta.y - dir.y * delta.x; // clockwise-positive on a y-down canvas
  const r = gainPos * cross / dirBone.length + gainAng * normAngle(deltaAngle);
  return r;
}
const clampLag = (r) => clamp(r, -deg(LAG.maxDeg), deg(LAG.maxDeg));

/**
 * Full pose with stateless follow-through: each tail/ear bone trails the motion of its driver
 * (pelvis / head) by a fixed delay per link, computed by re-sampling the primary pose at t - delay.
 */
export function solvePose(clip, t) {
  const primary = solvePrimary(clip, t);
  const { world, sample: s } = primary;
  const overrides = new Map();
  const tailGain = s.ch.tailFollow, earGain = s.ch.earFollow;
  const pelvis = world.get('pelvis'), head = world.get('head');
  const extraRot = {};
  const maxLinks = Math.max(TAIL.length, 2);
  for (let i = 1; i <= maxLinks; i++) {
    const past = solvePrimary(clip, t - i * LAG.tailDelay).world;
    if (tailGain > 0 && i <= TAIL.length) {
      const pp = past.get('pelvis');
      extraRot[TAIL[i - 1]] = clampLag(tailGain * lagRotation(world.get(TAIL[i - 1]), sub(pp.head, pelvis.head), pp.angle - pelvis.angle, LAG.tailPos, LAG.tailAng));
    }
    if (earGain > 0 && i <= 2) {
      const ph = past.get('head');
      for (const [a, b] of EARS) {
        const name = i === 1 ? a : b;
        extraRot[name] = clampLag(earGain * lagRotation(world.get(name), sub(ph.head, head.head), ph.angle - head.angle, LAG.earPos, LAG.earAng));
      }
    }
  }
  if (Object.keys(extraRot).length) {
    const s2 = { ...s, rot: { ...s.rot } };
    for (const [k, v] of Object.entries(extraRot)) s2.rot[k] = (s2.rot[k] || 0) + v;
    for (const name of [TAIL[0], EARS[0][0], EARS[1][0]]) fkSubtree(name, world, s2, overrides);
  }
  return {
    clip: clip.name, time: t, bones: world, channels: s.ch, rootScale: s.rootScale || { x: 1, y: 1 },
    grip: primary.grip, gripSides: primary.gripSides, ikErrors: primary.ikErrors,
    clubPoint: (f) => clubPoint(world, f),
  };
}
