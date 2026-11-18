// Skeleton for the PAINTED reaper: the code reaper's rig with arm and leg lengths matched to the
// painted sleeves, hands and boots (sheet scale 0.377 px per sheet px). Same bone names, so the
// code reaper's clips drive it unchanged.
import { angleOf, rot, sub, dist } from './math.js';
export { CHANNEL_DEFAULTS, IK_CHAINS } from '../../reaper/src/skeleton.js';
const B = (name, parent, head, tail, extra = {}) => ({ name, parent, head: { x: head[0], y: head[1] }, tail: { x: tail[0], y: tail[1] }, ...extra });
export const PROP = { length: 420, gripTop: 0.13, gripLow: -0.13, butt: -0.5, blade: 0.44, restAngle: -0.95 };
export const BONE_DEFS = [
  B('root', null, [0, 0], [0, -40]),
  B('pelvis', 'root', [0, -190], [0, -220]),
  B('spine', 'pelvis', [0, -220], [0, -270]),
  B('chest', 'spine', [0, -270], [0, -335]),
  B('neck', 'chest', [0, -335], [0, -352]),
  B('head', 'neck', [0, -352], [0, -470]),
  B('hood_01', 'head', [-40, -470], [-70, -500]),
  B('hood_02', 'hood_01', [-70, -500], [-110, -520]),
  B('mantle', 'chest', [0, -335], [0, -260]),
  B('clavicle_R', 'chest', [0, -322], [-62, -316]),
  B('upperarm_R', 'clavicle_R', [-62, -316], [-80, -250]),
  B('forearm_R', 'upperarm_R', [-80, -250], [-90, -176]),
  B('hand_R', 'forearm_R', [-90, -176], [-92, -126]),
  B('clavicle_L', 'chest', [0, -322], [62, -316]),
  B('upperarm_L', 'clavicle_L', [62, -316], [80, -250]),
  B('forearm_L', 'upperarm_L', [80, -250], [90, -176]),
  B('hand_L', 'forearm_L', [90, -176], [92, -126]),
  B('skirt_F', 'pelvis', [0, -200], [0, -40]),
  B('skirt_R', 'pelvis', [-44, -200], [-70, -50]),
  B('skirt_L', 'pelvis', [44, -200], [70, -50]),
  B('tassel_01', 'pelvis', [34, -196], [40, -150]),
  B('tassel_02', 'tassel_01', [40, -150], [44, -100]),
  B('thigh_R', 'pelvis', [-30, -190], [-44, -118]),
  B('shin_R', 'thigh_R', [-44, -118], [-38, -52]),
  B('foot_R', 'shin_R', [-38, -52], [-60, -8]),
  B('thigh_L', 'pelvis', [30, -190], [44, -118]),
  B('shin_L', 'thigh_L', [44, -118], [38, -52]),
  B('foot_L', 'shin_L', [38, -52], [62, -8]),
  B('scythe', 'chest', [-36, -225], [-36 + 420 * Math.cos(-0.95), -225 + 420 * Math.sin(-0.95)], { lengthOverride: 420 }),
];
export function buildSkeleton(defs = BONE_DEFS) {
  const bones = new Map(); const order = [];
  for (const d of defs) {
    const parent = d.parent ? bones.get(d.parent) : null;
    const dir = sub(d.tail, d.head); const restWorldAngle = angleOf(dir); const length = d.lengthOverride ?? dist(d.head, d.tail);
    const parentAngle = parent ? parent.restWorldAngle : 0;
    const localOffset = parent ? rot(sub(d.head, parent.restHead), -parentAngle) : { ...d.head };
    const bone = { name: d.name, parent: parent ? parent.name : null, children: [], restHead: { ...d.head }, restTail: { ...d.tail }, restWorldAngle, length, localOffset, localRestAngle: restWorldAngle - parentAngle };
    if (parent) parent.children.push(d.name); bones.set(d.name, bone); order.push(d.name);
  }
  return { bones, order };
}
export const SKELETON = buildSkeleton();
export const BONE_NAMES = SKELETON.order;
