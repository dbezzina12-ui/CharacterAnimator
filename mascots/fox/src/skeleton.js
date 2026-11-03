// Birdie the Fox — 2D skeleton (cut-out / puppet rig).
//
// Rest pose is authored in "upright world" coordinates: origin on the ground between the feet,
// x right, y DOWN (canvas). Sides are from the CHARACTER's perspective: `_L` bones sit on screen +x,
// `_R` on screen -x. The character is drawn in a front three-quarter view turned slightly toward
// screen-right, so the right side (screen-left) is nearer to the camera.
//
// Each bone is a segment head -> tail. Local +x runs head->tail; the bone's own rotation is a
// delta from its rest angle in the PARENT's frame (plain FK). Bone lengths are constants: no clip
// can stretch a bone (IK moves joints, never scales them). Squash & stretch lives on `root` only.

import { angleOf, rot, sub, dist } from './math.js';

const B = (name, parent, head, tail, extra = {}) => ({ name, parent, head: { x: head[0], y: head[1] }, tail: { x: tail[0], y: tail[1] }, ...extra });

export const BONE_DEFS = [
  B('root', null, [0, 0], [0, -40]),
  B('pelvis', 'root', [0, -218], [0, -238]),
  B('spine_01', 'pelvis', [0, -238], [0, -282]),
  B('chest', 'spine_01', [0, -282], [0, -345]),
  B('neck', 'chest', [0, -345], [0, -372]),
  B('head', 'neck', [0, -372], [0, -540]),

  // ears: two bones each so the tips can flop / lag behind the head
  B('ear_R_01', 'head', [-46, -512], [-72, -570]),
  B('ear_R_02', 'ear_R_01', [-72, -570], [-92, -628]),
  B('ear_L_01', 'head', [50, -512], [78, -568]),
  B('ear_L_02', 'ear_L_01', [78, -568], [100, -626]),

  // arms. Rest: relaxed, hanging slightly away from the body
  B('clavicle_R', 'chest', [0, -330], [-56, -322]),
  B('upperarm_R', 'clavicle_R', [-56, -322], [-84, -244]),
  B('forearm_R', 'upperarm_R', [-84, -244], [-92, -168]),
  B('hand_R', 'forearm_R', [-92, -168], [-95, -132]),
  B('clavicle_L', 'chest', [0, -330], [56, -322]),
  B('upperarm_L', 'clavicle_L', [56, -322], [84, -244]),
  B('forearm_L', 'upperarm_L', [84, -244], [92, -168]),
  B('hand_L', 'forearm_L', [92, -168], [95, -132]),

  // legs. Feet are IK-planted on the ground by default.
  B('thigh_R', 'pelvis', [-30, -212], [-44, -120]),
  B('shin_R', 'thigh_R', [-44, -120], [-36, -30]),
  B('foot_R', 'shin_R', [-36, -30], [-60, -8]),
  B('thigh_L', 'pelvis', [30, -212], [44, -120]),
  B('shin_L', 'thigh_L', [44, -120], [36, -30]),
  B('foot_L', 'shin_L', [36, -30], [62, -8]),

  // tail: a 5-bone chain curling up behind the body on screen-left
  B('tail_01', 'pelvis', [-12, -206], [-48, -184]),
  B('tail_02', 'tail_01', [-48, -184], [-90, -176]),
  B('tail_03', 'tail_02', [-90, -176], [-128, -196]),
  B('tail_04', 'tail_03', [-128, -196], [-152, -236]),
  B('tail_05', 'tail_04', [-152, -236], [-160, -282]),

  // club: a free bone parented to the chest so it travels with the body; both hands IK onto its
  // grip markers (two-hand constraint). Head = butt of the grip, +x runs down the shaft.
  B('club', 'chest', [-10, -222], [-10 + 238 * Math.cos(1.274), -222 + 238 * Math.sin(1.274)], { lengthOverride: 238 }),
];

/** Markers along the club bone (0 = butt end, 1 = club-head end), in bone-local units of length. */
export const CLUB = {
  length: 238,
  gripTop: 0.045,     // upper hand (character's left, the lead hand) centre
  gripLow: 0.20,      // lower hand (right hand)
  shaftStart: 0.30,
  headStart: 0.955,
  restAngle: 1.274,   // rest shaft angle (rad); the iron's sole is flat on the ground at this angle
};

/** Parent-frame bend side for two-bone IK: +1 clockwise of root->target, -1 counter-clockwise. */
export const IK_CHAINS = {
  arm_L: { root: 'upperarm_L', mid: 'forearm_L', end: 'hand_L', bend: -1 },
  arm_R: { root: 'upperarm_R', mid: 'forearm_R', end: 'hand_R', bend: +1 },
  leg_L: { root: 'thigh_L', mid: 'shin_L', end: 'foot_L', bend: -1 },
  leg_R: { root: 'thigh_R', mid: 'shin_R', end: 'foot_R', bend: +1 },
};

/**
 * Build the rest skeleton: per bone the rest world angle, length, and local offset/angle relative
 * to its parent. Order is parent-first so a single forward pass can evaluate FK.
 */
export function buildSkeleton(defs = BONE_DEFS) {
  const bones = new Map();
  const order = [];
  for (const d of defs) {
    const parent = d.parent ? bones.get(d.parent) : null;
    if (d.parent && !parent) throw new Error(`bone ${d.name}: parent ${d.parent} must be defined first`);
    const dir = sub(d.tail, d.head);
    const restWorldAngle = angleOf(dir);
    const length = d.lengthOverride ?? dist(d.head, d.tail);
    const parentAngle = parent ? parent.restWorldAngle : 0;
    const localOffset = parent ? rot(sub(d.head, parent.restHead), -parentAngle) : { ...d.head };
    const bone = {
      name: d.name, parent: parent ? parent.name : null, children: [],
      restHead: { ...d.head }, restTail: { ...d.tail }, restWorldAngle, length,
      localOffset, localRestAngle: restWorldAngle - parentAngle,
    };
    if (parent) parent.children.push(d.name);
    bones.set(d.name, bone);
    order.push(d.name);
  }
  return { bones, order };
}

export const SKELETON = buildSkeleton();
export const BONE_NAMES = SKELETON.order;

/** Face / body control channels that are not bones (0..1 unless stated). */
export const CHANNEL_DEFAULTS = {
  blink_L: 0, blink_R: 0,           // 1 = fully closed
  squint: 0,                        // lower lids rise (happy / effort)
  brow_L: 0, brow_R: 0,             // -1 frown-down .. +1 raised
  browTilt: 0,                      // -1 angry (inner ends down) .. +1 worried (inner ends up)
  smile: 0.35,                      // -1 frown .. +1 wide grin
  mouthOpen: 0,                     // 0 closed .. 1 wide open
  tongue: 0,                        // 0 hidden .. 1 out (pant)
  pupil_x: 0, pupil_y: 0,           // -1..1 gaze offset
  pupilSize: 1,                     // relative pupil diameter
  hand_L: 0.35, hand_R: 0.35,       // 0 open paw .. 1 closed fist
  headTurn: 0,                      // -1..1 extra three-quarter turn of the face features
  cheekBlush: 0,
  // draw-order switches (0/1, stepped)
  armLFront: 0, armRFront: 1, clubBehind: 0, clubVisible: 1,
  // secondary-motion gains (so a clip can calm the tail / ears)
  tailFollow: 1, earFollow: 1,
};
