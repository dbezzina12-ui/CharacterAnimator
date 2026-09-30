// Starter-skin definitions: which 3D pieces become which 2D slot, how deep slots sort, which
// pose-specific hand art to capture. Bone/slot names are the shared humanoid template; everything
// character-specific (art, pivots, fitting) is produced per character by starter.js.

const SIDES = ['L', 'R'];
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

/** Hand slots for one side: palm + five articulated finger layers (fingers overlap the palm). */
function handSlots(s) {
  const out = [{ id: `hand_${s}`, group: `hand_${s}`, kind: 'skinned', parts: [`Hand_${s}`], bone: `hand_${s}`,
    mask: [`hand_${s}`, `forearm_twist_${s}`, `forearm_${s}`], thr: 0.35 }];
  for (const f of FINGERS) out.push({ id: `${f}_${s}`, group: `hand_${s}`, kind: 'skinned', parts: [`Hand_${s}`], bone: `${f}_01_${s}`,
    mask: [1, 2, 3].map((k) => `${f}_0${k}_${s}`), thr: 0.35, plates: true });
  return out;
}

export const SWORD_AXES = { x: [0, 1, 0], y: [-1, 0, 0] };
export const PROP_AXES = {
  Sword2H: SWORD_AXES, Staff: SWORD_AXES, Detonator: SWORD_AXES,
  Pistol: { x: [-1, 0, 0], y: [0, 1, 0] }, Rifle: { x: [-1, 0, 0], y: [0, 1, 0] },
};

/** Clips whose props need the support hand on a named marker (IK keeps it there after edits). */
export const SUPPORT_CLIPS = { sword_2h_idle: 'grip_L', sword_2h_slash: 'grip_L', rifle_aim: 'grip_L', rifle_fire: 'grip_L',
  pistol_aim_2h: 'grip_L_2h', pistol_fire_2h: 'grip_L_2h' };

export const KNIGHT = {
  id: 'aureate_knight_2d',
  displayName: 'Aureate · Knight of the Dawn — 2D starter skin',
  source3d: 'aureate_knight',
  view: { id: 'front34', label: 'Front three-quarter (character\'s left toward camera)', position: [1.4, 1.43, 5.8], target: [0, 1.2, 0] },
  referenceHeightPx: 1024,
  sourceScale: 2,
  illustrated: true,
  slots: [
    { id: 'mantle', group: 'body', kind: 'rigid', bones: ['chest'], name: /Mantle/, morph: true },
    ...SIDES.flatMap((s) => [
      { id: `under_leg_${s}`, group: `leg_${s}`, kind: 'skinned', parts: [`Thigh_${s}`, `Shin_${s}`], bone: `thigh_${s}` },
      { id: `under_foot_${s}`, group: `leg_${s}`, kind: 'skinned', parts: [`Foot_${s}`], bone: `foot_${s}` },
      { id: `thigh_${s}`, group: `leg_${s}`, kind: 'rigid', bones: [`thigh_${s}`], exclude: /Tabard/ },
      { id: `tabard_${s}`, group: `leg_${s}`, kind: 'rigid', bones: [`thigh_${s}`], name: /Tabard/ },
      { id: `shin_${s}`, group: `leg_${s}`, kind: 'rigid', bones: [`shin_${s}`] },
      { id: `foot_${s}`, group: `leg_${s}`, kind: 'rigid', bones: [`foot_${s}`] },
    ]),
    { id: 'under_torso', group: 'body', kind: 'skinned', parts: ['Torso', 'Pelvis', 'Neck'], bone: 'chest' },
    { id: 'belt', group: 'body', kind: 'rigid', bones: ['pelvis'] },
    { id: 'abdomen', group: 'body', kind: 'rigid', bones: ['spine_01'] },
    { id: 'cuirass', group: 'body', kind: 'rigid', bones: ['chest'], exclude: /Mantle/ },
    { id: 'helmet', group: 'body', kind: 'rigid', bones: ['head', 'neck'] },
    ...SIDES.flatMap((s) => [
      { id: `under_arm_${s}`, group: `arm_${s}`, kind: 'skinned', parts: [`UpperArm_${s}`, `Forearm_${s}`], bone: `upperarm_${s}` },
      { id: `upperarm_${s}`, group: `arm_${s}`, kind: 'rigid', bones: [`upperarm_${s}`] },
      { id: `forearm_${s}`, group: `arm_${s}`, kind: 'rigid', bones: [`forearm_${s}`] },
      ...handSlots(s),
    ]),
    { id: 'prop_R', group: 'props', kind: 'prop', bone: 'prop_R' },
  ],
  // slot a is always drawn over slot b (armour over its own under-layer, fingers over their palm)
  above: [
    ...SIDES.flatMap((s) => [[`upperarm_${s}`, `under_arm_${s}`], [`forearm_${s}`, `under_arm_${s}`], [`thigh_${s}`, `under_leg_${s}`],
      [`shin_${s}`, `under_leg_${s}`], [`foot_${s}`, `under_foot_${s}`], [`tabard_${s}`, `thigh_${s}`]]),
    ['belt', 'under_torso'], ['abdomen', 'under_torso'], ['cuirass', 'under_torso'], ['helmet', 'under_torso'], ['helmet', 'cuirass'],
    // armour logic where the plates interpenetrate in 3D: pauldrons are worn over the breastplate
    ['upperarm_L', 'cuirass'], ['upperarm_R', 'cuirass'],
  ],
  props: ['Sword2H', 'Staff', 'Pistol', 'Rifle', 'Detonator'],
  // pose-specific hand art (view-specific attachments) keyed onto the listed clips
  captures: [
    { name: 'hover', clip: 'hover_sword_vigil', t: 0, sides: ['L', 'R'], clips: ['hover_sword_vigil'],
      propMarker: { marker: 'support_L_hover', socket: 'socket_hand_L_prop' } },
    { name: 'grip_sword', clip: 'sword_2h_idle', t: 0, sides: ['L', 'R'], clips: ['sword_2h_idle', 'sword_2h_slash'] },
    { name: 'grip_staff', clip: 'staff_idle', t: 0, sides: ['R'], clips: ['staff_idle', 'staff_stomp'] },
    { name: 'grip_pistol', clip: 'pistol_aim', t: 0, sides: ['R'], clips: ['pistol_aim', 'pistol_fire'] },
    { name: 'grip_pistol_2h', clip: 'pistol_aim_2h', t: 0, sides: ['L', 'R'], clips: ['pistol_aim_2h', 'pistol_fire_2h'] },
    { name: 'grip_rifle', clip: 'rifle_aim', t: 0, sides: ['L', 'R'], clips: ['rifle_aim', 'rifle_fire'] },
    // the thumb stays articulated so it can travel to the button
    { name: 'grip_detonator', clip: 'press_detonator', t: 0.9, sides: ['R'], clips: ['press_detonator'], groups: ['hand', 'index', 'middle', 'ring', 'pinky'] },
    { name: 'fist', curl: 0.95, sides: ['L', 'R'] },
    { name: 'relaxed', curl: 0.3, sides: ['L', 'R'] },
  ],
};

/** A plain template body (no armour): the same slots minus armour, for proportion variants. */
export function plainSpec(id, displayName, source3d) {
  return {
    id, displayName, source3d,
    view: KNIGHT.view,
    referenceHeightPx: 1024, sourceScale: 2, illustrated: true,
    slots: [
      ...SIDES.flatMap((s) => [
        { id: `under_leg_${s}`, group: `leg_${s}`, kind: 'skinned', parts: [`Thigh_${s}`, `Shin_${s}`], bone: `thigh_${s}` },
        { id: `under_foot_${s}`, group: `leg_${s}`, kind: 'skinned', parts: [`Foot_${s}`], bone: `foot_${s}` },
      ]),
      { id: 'under_torso', group: 'body', kind: 'skinned', parts: ['Torso', 'Pelvis', 'Neck'], bone: 'chest' },
      { id: 'head', group: 'body', kind: 'skinned', parts: ['Head'], bone: 'head' },
      ...SIDES.flatMap((s) => [
        { id: `under_arm_${s}`, group: `arm_${s}`, kind: 'skinned', parts: [`UpperArm_${s}`, `Forearm_${s}`], bone: `upperarm_${s}` },
        ...handSlots(s),
      ]),
      { id: 'prop_R', group: 'props', kind: 'prop', bone: 'prop_R' },
    ],
    above: [['head', 'under_torso']],
    props: ['Sword2H'],
    captures: [{ name: 'grip_sword', clip: 'sword_2h_idle', t: 0, sides: ['L', 'R'], clips: ['sword_2h_idle', 'sword_2h_slash'] },
      { name: 'fist', curl: 0.95, sides: ['L', 'R'] }],
    clips: ['idle', 'walk_in_place', 'sword_2h_idle', 'sword_2h_slash', 'wave', 'cheer', 'float_idle'],
  };
}
