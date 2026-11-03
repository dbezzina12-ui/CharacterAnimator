// Krakenbot — 2D mech-octopus skeleton (cut-out / puppet rig).
//
// Rest pose in "upright world" coordinates: origin on the ground under the body, x right, y DOWN.
// Sides are from the CHARACTER's perspective: `_L` on screen +x, `_R` on screen -x.
// Eight tentacles, five bones each, named by position: F = front centre, M = mid (side, in front of
// the body), U = upper (raised, behind the head), B = back (behind the body).

import { angleOf, rot, sub, dist } from './math.js';

const B = (name, parent, head, tail, extra = {}) => ({ name, parent, head: { x: head[0], y: head[1] }, tail: { x: tail[0], y: tail[1] }, ...extra });

/** A bone chain through a polyline. */
function chain(prefix, parent, pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) out.push(B(`${prefix}_${String(i + 1).padStart(2, '0')}`, i === 0 ? parent : `${prefix}_${String(i).padStart(2, '0')}`, pts[i], pts[i + 1]));
  return out;
}
const mirror = (pts) => pts.map(([x, y]) => [-x, y]);

// tentacle rest curves (character's left side; right side mirrored)
const FRONT = [[38, -178], [58, -124], [66, -70], [50, -26], [20, -12], [2, -34]];
const MID = [[118, -198], [176, -162], [208, -104], [190, -50], [150, -26], [118, -46]];
const UPPER = [[150, -262], [226, -288], [288, -328], [310, -396], [272, -438], [232, -420]];
const BACK = [[100, -236], [170, -226], [238, -196], [280, -150], [262, -98], [220, -86]];

export const TENTACLES = {
  tent_FL: { pts: FRONT, layer: 'front', suckerSide: -1 },
  tent_FR: { pts: mirror(FRONT), layer: 'front', suckerSide: 1 },
  tent_ML: { pts: MID, layer: 'mid', suckerSide: -1 },
  tent_MR: { pts: mirror(MID), layer: 'mid', suckerSide: 1 },
  tent_UL: { pts: UPPER, layer: 'upper', suckerSide: 1 },
  tent_UR: { pts: mirror(UPPER), layer: 'upper', suckerSide: -1 },
  tent_BL: { pts: BACK, layer: 'back', suckerSide: -1 },
  tent_BR: { pts: mirror(BACK), layer: 'back', suckerSide: 1 },
};
export const TENTACLE_NAMES = Object.keys(TENTACLES);
export const LINKS = 5;
export const tentBones = (name) => Array.from({ length: LINKS }, (_, i) => `${name}_${String(i + 1).padStart(2, '0')}`);

export const BONE_DEFS = [
  B('root', null, [0, 0], [0, -40]),
  B('body', 'root', [0, -232], [0, -268]),      // mantle / neck ring
  B('head', 'body', [0, -268], [0, -440]),      // the armoured dome (rigid), pods and visor live here
  B('pod_L', 'head', [138, -316], [184, -316]),
  B('pod_R', 'head', [-138, -316], [-184, -316]),
  B('crest', 'head', [0, -418], [0, -470]),     // top plate (can pop up)
  ...TENTACLE_NAMES.flatMap((n) => chain(n, 'body', TENTACLES[n].pts)),
];

export function buildSkeleton(defs = BONE_DEFS) {
  const bones = new Map(); const order = [];
  for (const d of defs) {
    const parent = d.parent ? bones.get(d.parent) : null;
    if (d.parent && !parent) throw new Error(`bone ${d.name}: parent ${d.parent} must be defined first`);
    const dir = sub(d.tail, d.head);
    const restWorldAngle = angleOf(dir);
    const length = d.lengthOverride ?? dist(d.head, d.tail);
    const parentAngle = parent ? parent.restWorldAngle : 0;
    const localOffset = parent ? rot(sub(d.head, parent.restHead), -parentAngle) : { ...d.head };
    const bone = { name: d.name, parent: parent ? parent.name : null, children: [], restHead: { ...d.head }, restTail: { ...d.tail }, restWorldAngle, length, localOffset, localRestAngle: restWorldAngle - parentAngle };
    if (parent) parent.children.push(d.name);
    bones.set(d.name, bone); order.push(d.name);
  }
  return { bones, order };
}

export const SKELETON = buildSkeleton();
export const BONE_NAMES = SKELETON.order;

/** Control channels that are not bones (0..1 unless stated). */
export const CHANNEL_DEFAULTS = {
  blink_L: 0, blink_R: 0,     // armoured eye shutters, 1 = closed
  squint: 0,                  // lower shutter rises
  brow: 0.45,                  // -1 surprised (brows up) .. +1 furious (brows slammed down)
  pupil_x: 0, pupil_y: 0, pupilSize: 1,
  glow: 0.8,                  // intensity of every light (eyes, pods, slits)
  eyeHeat: 0,                 // 0 amber .. 1 white-hot core
  mouth: 0,                   // chin plate drops to reveal the dark mouth / intake
  podSpin: 0,                 // pod ring rotation (turns)
  visorFlash: 0,              // bright flash across the visor (hit / charge)
  ripple: 0,                  // travelling wave amplitude along the tentacles (degrees)
  tentFollow: 1,              // follow-through gain for all tentacles
  // draw-order switches (stepped)
  frontOverHead: 1,           // front tentacles drawn over the chin plate
  midOverHead: 1,
};
