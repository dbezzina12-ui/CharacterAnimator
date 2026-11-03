// Pose solver for the mech octopus: track sampling, FK, CCD tentacle IK, a travelling ripple wave,
// stateless follow-through for every tentacle link, root squash & stretch.
// Pure function of (clip, time): scrubbing, frame skips, turbo and reloads give identical poses.

import { SKELETON, TENTACLE_NAMES, tentBones, CHANNEL_DEFAULTS, LINKS } from './skeleton.js';
import { EASE, clamp, deg, rot, add, sub, len, angleOf, normAngle, mixAngle, hash } from './math.js';

const { bones: REST, order: ORDER } = SKELETON;
export const CURL_WEIGHTS = [0.12, 0.17, 0.21, 0.24, 0.26];

// ---------------------------------------------------------------- track sampling (shared format with the fox rig)
function lerpValue(a, b, f, angular) {
  if (typeof a === 'number') return angular ? mixAngle(a, b, f) : a + (b - a) * f;
  if (a && typeof a === 'object') { const out = {}; for (const k of Object.keys(a)) out[k] = typeof a[k] === 'number' ? a[k] + ((b?.[k] ?? a[k]) - a[k]) * f : a[k]; return out; }
  return f < 1 ? a : b;
}
export function sampleTrack(keys, t, clip, angular = false) {
  if (!keys || keys.length === 0) return undefined;
  if (keys.length === 1) return keys[0][1];
  const dur = clip.duration;
  if (clip.loop) t = ((t % dur) + dur) % dur;
  const wrap = (tt) => { const last = keys[keys.length - 1]; const span = (dur - last[0]) + keys[0][0]; if (span <= 1e-9) return keys[0][1]; const f = (EASE[keys[0][2] || 'smooth'])(clamp((tt - last[0]) / span)); return lerpValue(last[1], keys[0][1], f, angular); };
  if (t <= keys[0][0]) return clip.loop ? wrap(t + dur) : keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= a[0] && t <= b[0]) { const span = b[0] - a[0]; const f = span <= 1e-9 ? 1 : (EASE[b[2] || 'smooth'])(clamp((t - a[0]) / span)); return lerpValue(a[1], b[1], f, angular); }
  }
  return clip.loop ? wrap(t) : keys[keys.length - 1][1];
}
export function autoBlink(t, period = 4.2, seed = 3) {
  const cycle = Math.floor(t / period), local = t - cycle * period;
  const start = 0.9 + hash(cycle, seed) * (period - 1.4);
  const dbl = hash(cycle, seed + 1) < 0.2;
  const one = (s) => { const u = (local - s) / 0.14; if (u < 0 || u > 1) return 0; return Math.sin(Math.PI * u) ** 0.7; };
  return clamp(Math.max(one(start), dbl ? one(start + 0.22) : 0));
}
export function sampleClip(clip, t) {
  const out = { rot: {}, pos: {}, ik: {}, ch: { ...CHANNEL_DEFAULTS }, rootScale: { x: 1, y: 1 } };
  for (const [key, keys] of Object.entries(clip.tracks || {})) {
    const [kind, name] = key.includes(':') ? key.split(':') : ['rot', key];
    if (kind === 'rot') out.rot[name] = deg(sampleTrack(keys, t, clip));
    else if (kind === 'pos') out.pos[name] = sampleTrack(keys, t, clip);
    else if (kind === 'ik') out.ik[name] = sampleTrack(keys, t, clip);
    else if (kind === 'ch') out.ch[name] = sampleTrack(keys, t, clip);
    else if (kind === 'scale') out.rootScale = sampleTrack(keys, t, clip);
    else if (kind === 'tent') { // whole-tentacle curl: the TOTAL bend in degrees, distributed tip-biased over the links
      const v = deg(sampleTrack(keys, t, clip));
      tentBones(name).forEach((b, i) => { out.rot[b] = (out.rot[b] || 0) + v * CURL_WEIGHTS[i]; });
    } else throw new Error(`unknown track kind ${kind} in clip ${clip.name}`);
  }
  if (!clip.tracks?.['ch:blink_L'] && clip.autoBlink !== false) {
    const b = autoBlink(t, clip.blinkPeriod || 4.2, clip.blinkSeed || 3);
    out.ch.blink_L = Math.max(out.ch.blink_L, b); out.ch.blink_R = Math.max(out.ch.blink_R, b);
  }
  // travelling ripple: integer cycles per loop so loops stay seamless; phase runs base -> tip
  const ripple = clip.ripple;
  if (ripple && (out.ch.ripple || ripple.amp)) {
    const amp = deg(out.ch.ripple || ripple.amp);
    const w = (2 * Math.PI * (ripple.cycles || 1)) / clip.duration;
    TENTACLE_NAMES.forEach((n, k) => {
      const ph = (ripple.stagger ?? 0.6) * k;
      tentBones(n).forEach((b, i) => { out.rot[b] = (out.rot[b] || 0) + amp * Math.sin(w * t - i * (ripple.linkPhase ?? 0.9) - ph) * (0.5 + 0.15 * i); });
    });
  }
  return out;
}

// ---------------------------------------------------------------- FK
function fkBone(name, world, s, overrides) {
  const b = REST.get(name);
  const parent = b.parent ? world.get(b.parent) : null;
  const posOff = s.pos[name] || { x: 0, y: 0 };
  const angle = overrides && overrides.has(name) ? overrides.get(name) : (parent ? parent.angle : 0) + b.localRestAngle + (s.rot[name] || 0);
  const head = parent ? add(add(parent.head, rot(b.localOffset, parent.angle)), rot(posOff, parent.angle - parent.restAngle)) : add(b.localOffset, posOff);
  const tail = add(head, rot({ x: b.length, y: 0 }, angle));
  world.set(name, { name, head, tail, angle, length: b.length, restAngle: b.restWorldAngle, x: head.x, y: head.y });
}
function fkSubtree(name, world, s, overrides) { fkBone(name, world, s, overrides); for (const c of REST.get(name).children) fkSubtree(c, world, s, overrides); }

function resolveTarget(spec, world) {
  const b = world.get(spec.space || 'root');
  if (!b) throw new Error(`ik target space ${spec.space} is not a bone`);
  return add(b.head, rot({ x: spec.x, y: spec.y }, b.angle - b.restAngle));
}

/**
 * CCD IK for a tentacle: the tip (tail of the last link) reaches `target`. Starts from the clip's FK
 * pose (so keys act as a bias), 16 sweeps from the tip to the base, each link limited to ±`limit`
 * from its parent so the tentacle keeps a smooth curve. `curl` (degrees) adds extra bend on the last
 * two links after reaching, for wrapping around an object. Returns the remaining tip error.
 */
const LINK_LIMITS = [140, 100, 80, 70, 70].map(deg);   // per-link joint limits (base links can swing wide, tips stay smooth)
export function ccdIK(tentName, target, world, s, overrides, { limit = null, iterations = 24, curl = 0, tipBias = 0.35 } = {}) {
  const bones = tentBones(tentName);
  const effLink = curl ? bones.length - 2 : bones.length - 1;   // wrapping: the fourth link's end reaches, the tip stays coiled
  const effector = () => world.get(bones[effLink]).tail;
  const angles = bones.map((b) => world.get(b).angle);
  const rel = (i) => angles[i] - (i === 0 ? world.get('body').angle + REST.get(bones[0]).localRestAngle : angles[i - 1]);
  const setFrom = (i) => { for (let k = i; k < bones.length; k++) overrides.set(bones[k], angles[k]); fkSubtree(bones[i], world, s, overrides); };
  if (curl) { // pre-bias: wrap the last two links before reaching, so the solved shape keeps the curl
    const c = deg(curl); angles[bones.length - 2] += c * 0.35; angles[bones.length - 1] += c * 0.9; setFrom(bones.length - 2);
  }
  for (let it = 0; it < iterations; it++) {
    for (let i = effLink; i >= 0; i--) {
      const tip = effector(), j = world.get(bones[i]).head;
      const a = angleOf(sub(tip, j)), b = angleOf(sub(target, j));
      let d = normAngle(b - a) * (i === effLink ? tipBias + 0.65 : 0.7);
      // joint limit: keep the link within ±limit of its parent direction
      const parentAngle = i === 0 ? world.get('body').angle + REST.get(bones[0]).localRestAngle : angles[i - 1];
      const rels = bones.map((_, k) => rel(k));           // capture BEFORE moving this link
      const want = normAngle(angles[i] + d - parentAngle);
      const lim = limit ?? LINK_LIMITS[i];
      angles[i] = parentAngle + clamp(want, -lim, lim);
      for (let k = i + 1; k < bones.length; k++) angles[k] = angles[k - 1] + rels[k];   // children keep their relative angles
      setFrom(i);
    }
  }
  return len(sub(target, effector()));
}

/**
 * Floor constraint: a tentacle whose tip would sink below the ground is bent back up with a short
 * CCD pass so the tip rests on the floor (y = groundY - margin). Returns the names it corrected.
 */
export function applyFloor(world, s, overrides, groundY = 0, margin = 6, skip = []) {
  const fixed = [];
  const root = world.get('root');
  for (const n of TENTACLE_NAMES) {
    if (skip.includes(n)) continue;
    const bones = tentBones(n); const tip = world.get(bones[LINKS - 1]).tail;
    const floor = root.head.y + groundY - margin;
    if (tip.y > floor) { ccdIK(n, { x: tip.x, y: floor }, world, s, overrides, { iterations: 12 }); fixed.push(n); }
  }
  return fixed;
}

export function solvePrimary(clip, t) {
  const s = sampleClip(clip, t);
  const world = new Map(); const overrides = new Map();
  for (const name of ORDER) fkBone(name, world, s, overrides);
  const ikErrors = {};
  for (const n of TENTACLE_NAMES) {
    const spec = s.ik[n];
    if (!spec) continue;
    ikErrors[n] = ccdIK(n, resolveTarget(spec, world), world, s, overrides, { curl: spec.curl || 0, limit: spec.limit ? deg(spec.limit) : undefined });
  }
  return { world, sample: s, ikErrors, ikSet: Object.keys(s.ik) };
}

// ---------------------------------------------------------------- follow-through
const LAG = { delay: 0.05, pos: 0.7, ang: 0.5, maxDeg: 30 };
const LAYER_GAIN = { front: 1.0, mid: 0.9, upper: 1.15, back: 0.8 };
function lagRotation(bone, delta, deltaAngle) {
  const dir = { x: Math.cos(bone.angle), y: Math.sin(bone.angle) };
  const cross = dir.x * delta.y - dir.y * delta.x;
  return LAG.pos * cross / bone.length + LAG.ang * normAngle(deltaAngle);
}
export function solvePose(clip, t) {
  const primary = solvePrimary(clip, t);
  const { world, sample: s } = primary;
  const gain = s.ch.tentFollow;
  const extra = {};
  if (gain > 0) {
    const body = world.get('body');
    for (let i = 1; i <= LINKS; i++) {
      const past = solvePrimary(clip, t - i * LAG.delay).world.get('body');
      for (const n of TENTACLE_NAMES) {
        if (primary.ikSet.includes(n)) continue;                 // an IK-driven tentacle is pinned, no lag
        const b = world.get(tentBones(n)[i - 1]);
        const layerGain = LAYER_GAIN[n.endsWith('L') || n.endsWith('R') ? ({ F: 'front', M: 'mid', U: 'upper', B: 'back' })[n[5]] : 'mid'];
        const r = gain * layerGain * lagRotation(b, sub(past.head, body.head), past.angle - body.angle);
        extra[b.name] = clamp(r, -deg(LAG.maxDeg), deg(LAG.maxDeg));
      }
    }
    const s2 = { ...s, rot: { ...s.rot } };
    for (const [k, v] of Object.entries(extra)) s2.rot[k] = (s2.rot[k] || 0) + v;
    const overrides = new Map();
    for (const n of TENTACLE_NAMES) if (!primary.ikSet.includes(n)) fkSubtree(tentBones(n)[0], world, s2, overrides);
  }
  const floorSet = clip.floor === false ? [] : applyFloor(world, s, new Map(), 0, 6, primary.ikSet);
  return { clip: clip.name, time: t, bones: world, channels: s.ch, rootScale: s.rootScale || { x: 1, y: 1 }, ikErrors: primary.ikErrors, ikSet: primary.ikSet, floorSet };
}
