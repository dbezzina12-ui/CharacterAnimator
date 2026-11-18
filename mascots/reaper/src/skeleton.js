// Grim Reaper — 2D skeleton (cut-out / puppet rig), Brawlhalla-style chibi proportions.
// Rest pose in "upright world" coordinates: origin on the ground between the boots, x right, y DOWN.
// Sides from the CHARACTER's perspective: `_L` on screen +x. Three-quarter view turned to screen-right,
// so the right side (screen-left) is nearer. Bones: head -> tail; local +x runs along the bone.
import { angleOf, rot, sub, dist } from './math.js';

const B = (name, parent, head, tail, extra = {}) => ({ name, parent, head: { x: head[0], y: head[1] }, tail: { x: tail[0], y: tail[1] }, ...extra });

export const PROP = { length: 420, gripTop: 0.13, gripLow: -0.13, butt: -0.5, blade: 0.44, restAngle: -0.95 };   // fractions along the shaft from the pivot between the hands

export const BONE_DEFS = [
  B('root', null, [0, 0], [0, -40]),
  B('pelvis', 'root', [0, -170], [0, -200]),
  B('spine', 'pelvis', [0, -200], [0, -260]),
  B('chest', 'spine', [0, -260], [0, -330]),
  B('neck', 'chest', [0, -330], [0, -350]),
  B('head', 'neck', [0, -350], [0, -470]),
  B('hood_01', 'head', [10, -470], [-20, -530]),       // hood point, two links so it can flop
  B('hood_02', 'hood_01', [-20, -530], [-70, -560]),
  B('mantle', 'chest', [0, -330], [0, -250]),           // shoulder cape
  B('clavicle_R', 'chest', [0, -318], [-58, -312]),
  B('upperarm_R', 'clavicle_R', [-58, -312], [-82, -236]),
  B('forearm_R', 'upperarm_R', [-82, -236], [-92, -168]),
  B('hand_R', 'forearm_R', [-92, -168], [-96, -128]),
  B('clavicle_L', 'chest', [0, -318], [58, -312]),
  B('upperarm_L', 'clavicle_L', [58, -312], [82, -236]),
  B('forearm_L', 'upperarm_L', [82, -236], [92, -168]),
  B('hand_L', 'forearm_L', [92, -168], [96, -128]),
  B('skirt_F', 'pelvis', [0, -180], [0, -66]),          // robe front panel
  B('skirt_R', 'pelvis', [-40, -180], [-66, -66]),
  B('skirt_L', 'pelvis', [40, -180], [66, -66]),
  B('tassel_01', 'pelvis', [34, -176], [40, -120]),
  B('tassel_02', 'tassel_01', [40, -120], [44, -70]),
  B('thigh_R', 'pelvis', [-26, -170], [-40, -92]),
  B('shin_R', 'thigh_R', [-40, -92], [-32, -24]),
  B('foot_R', 'shin_R', [-32, -24], [-52, -6]),
  B('thigh_L', 'pelvis', [26, -170], [40, -92]),
  B('shin_L', 'thigh_L', [40, -92], [32, -24]),
  B('foot_L', 'shin_L', [32, -24], [54, -6]),
  // scythe: parented to the chest; both bony hands IK onto its grip markers
  B('scythe', 'chest', [-36, -220], [-36 + 420 * Math.cos(-0.95), -220 + 420 * Math.sin(-0.95)], { lengthOverride: 420 }),
];

export const IK_CHAINS = {
  arm_L: { root: 'upperarm_L', mid: 'forearm_L', end: 'hand_L', bend: -1 },
  arm_R: { root: 'upperarm_R', mid: 'forearm_R', end: 'hand_R', bend: +1 },
  leg_L: { root: 'thigh_L', mid: 'shin_L', end: 'foot_L', bend: -1 },
  leg_R: { root: 'thigh_R', mid: 'shin_R', end: 'foot_R', bend: +1 },
};

export function buildSkeleton(defs = BONE_DEFS) {
  const bones = new Map(); const order = [];
  for (const d of defs) {
    const parent = d.parent ? bones.get(d.parent) : null;
    if (d.parent && !parent) throw new Error(`bone ${d.name}: parent ${d.parent} must be defined first`);
    const dir = sub(d.tail, d.head); const restWorldAngle = angleOf(dir);
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

export const CHANNEL_DEFAULTS = {
  eyeGlow: 0.8,                 // amber glints in the sockets
  eyeSize: 1,                   // glint size (anger = bigger)
  jaw: 0,                       // 0 closed grin .. 1 jaw dropped
  brow: 0,                      // -1 .. 1 socket tilt (anger)
  hand_L: 0.35, hand_R: 0.35,   // bony fingers 0 open .. 1 gripping
  hourglassSpin: 0,
  trail: 0,                     // blade motion trail intensity
  armLFront: 0, armRFront: 1, propBehind: 0, propVisible: 1,
  tailFollow: 1, earFollow: 1,  // follow-through gains (hood / tassel)
  hoverShadow: 1,
};
