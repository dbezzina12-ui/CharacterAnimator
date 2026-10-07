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
  Sword2H: SWORD_AXES, Staff: SWORD_AXES, Detonator: SWORD_AXES, GolfClub: SWORD_AXES,
  Pistol: { x: [-1, 0, 0], y: [0, 1, 0] }, Rifle: { x: [-1, 0, 0], y: [0, 1, 0] },
};

/** Clips whose props need the support hand on a named marker (IK keeps it there after edits). */
export const SUPPORT_CLIPS = { sword_2h_idle: 'grip_L', sword_2h_slash: 'grip_L', rifle_aim: 'grip_L', rifle_fire: 'grip_L',
  pistol_aim_2h: 'grip_L_2h', pistol_fire_2h: 'grip_L_2h', golf_swing: 'grip_L', sword_raise_2h: 'grip_L' };

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
  props: ['Sword2H', 'Staff', 'Pistol', 'Rifle', 'Detonator', 'GolfClub'],
  // draw-order hold per clip: by default a whole order must hold 3 frames; 'swing' holds each pair of slots instead
  // (the golf club and arms pass across the whole body in ~8 frames)
  orderHold: { golf_swing: 'swing' },
  // pose-specific hand art (view-specific attachments) keyed onto the listed clips
  captures: [
    { name: 'hover', clip: 'hover_sword_vigil', t: 0, sides: ['L', 'R'], clips: ['hover_sword_vigil'], limbs: ['forearm_L', 'forearm_R'],
      propMarker: { marker: 'support_L_hover', socket: 'socket_hand_L_prop' } },
    { name: 'grip_sword', clip: 'sword_2h_idle', t: 0, sides: ['L', 'R'], clips: ['sword_2h_idle', 'sword_2h_slash'] },
    // sword raises (2D effects: lightning on the two-handed raise, fire on the one-handed raise): both hands on the
    // hilt overhead; for the one-handed thrust the right hand's grip as seen with the arm up
    { name: 'grip_sword_up', clip: 'sword_raise_2h', t: 1.5, sides: ['L', 'R'], clips: ['sword_raise_2h'], range: [0.7, 2.7] },
    { name: 'grip_sword_1h', clip: 'sword_raise_1h', t: 1.5, sides: ['R'], clips: ['sword_raise_1h'], range: [0.7, 2.7] },
    { name: 'grip_staff', clip: 'staff_idle', t: 0, sides: ['R'], clips: ['staff_idle', 'staff_stomp'] },
    { name: 'grip_pistol', clip: 'pistol_aim', t: 0, sides: ['R'], clips: ['pistol_aim', 'pistol_fire'] },
    { name: 'grip_pistol_2h', clip: 'pistol_aim_2h', t: 0, sides: ['L', 'R'], clips: ['pistol_aim_2h', 'pistol_fire_2h'] },
    { name: 'grip_rifle', clip: 'rifle_aim', t: 0, sides: ['L', 'R'], clips: ['rifle_aim', 'rifle_fire'] },
    // the thumb stays articulated so it can travel to the button
    { name: 'grip_detonator', clip: 'press_detonator', t: 0.9, sides: ['R'], clips: ['press_detonator'], groups: ['hand', 'index', 'middle', 'ring', 'pinky'] },
    // salute: fist on the chest with the right arm raised toward the camera — hand, pauldron and vambrace as
    // seen in that pose, keyed only while the arm is up
    // guard and slash: upper arms point forward, so the pauldrons/vambraces need the pose-specific view
    { name: 'guard', clip: 'sword_2h_idle', t: 0, sides: [], groups: [], limbs: ['upperarm_L', 'upperarm_R', 'forearm_L', 'forearm_R'], clips: ['sword_2h_idle', 'sword_2h_slash'],
      clipRanges: { sword_2h_slash: [[0, 0.15], [1.55, 2]] } },
    { name: 'windup', clip: 'sword_2h_slash', t: 0.5, sides: [], groups: [], limbs: ['upperarm_L', 'upperarm_R', 'forearm_L', 'forearm_R'], clips: ['sword_2h_slash'], range: [0.15, 0.75] },
    { name: 'strike', clip: 'sword_2h_slash', t: 1.1, sides: [], groups: [], limbs: ['upperarm_L', 'upperarm_R', 'forearm_L', 'forearm_R'], clips: ['sword_2h_slash'], range: [0.75, 1.55] },
    { name: 'salute', clip: 'knight_salute', t: 1.6, sides: ['R'], clips: ['knight_salute'], range: [0.6, 3.3] },
    // the raised pauldron reads correctly from 0.42 s; the vambrace only once the forearm is upright (0.55 s)
    { name: 'salute_arm', clip: 'knight_salute', t: 1.6, sides: [], groups: [], limbs: ['upperarm_R'], clips: ['knight_salute'], range: [0.42, 3.42] },
    { name: 'salute_farm', clip: 'knight_salute', t: 1.6, sides: [], groups: [], limbs: ['forearm_R'], clips: ['knight_salute'], range: [0.55, 3.3] },
    // mid-raise: the forearm points at the camera — only the cuff ring shows under the open hand (as in 3D)
    { name: 'salute_mid', clip: 'knight_salute', t: 0.45, sides: ['R'], clips: ['knight_salute'], range: [[0.33, 0.6], [3.3, 3.53]] },
    { name: 'salute_mid_arm', clip: 'knight_salute', t: 0.45, sides: [], groups: [], limbs: ['forearm_R'], clips: ['knight_salute'], range: [[0.33, 0.55], [3.3, 3.53]] },
    // the open hand as the arm swings out and back (palm toward the camera, wrist turned): the setup hand mesh
    // would fold over here
    { name: 'salute_open', clip: 'knight_salute', t: 0.15, sides: ['R'], clips: ['knight_salute'], range: [[0, 0.33], [3.53, 4]] },
    // walk: the swinging hands turn palm-back at the ends of the swing; the setup hand mesh folds there
    { name: 'walk_swing_L', clip: 'walk_in_place', t: 0.57, sides: ['L'], clips: ['walk_in_place'], range: [0.38, 0.76] },
    { name: 'walk_swing_R', clip: 'walk_in_place', t: 0.03, sides: ['R'], clips: ['walk_in_place'], range: [[0, 0.24], [0.92, 2]] },
    // golf: both hands on the club grip (left above right), as seen at address
    { name: 'grip_golf', clip: 'golf_swing', t: 0, sides: ['L', 'R'], clips: ['golf_swing'] },
    // golf top of the backswing and finish: the shoulders are turned ~90°, the arms cross the chest — arms,
    // hands and breastplate as seen in those poses (one view per pose; in between the setup pieces turn in 2D)
    { name: 'golf_top', clip: 'golf_swing', t: 1.5, sides: ['L', 'R'], limbs: ['upperarm_L', 'upperarm_R', 'forearm_L', 'forearm_R', 'cuirass'],
      clips: ['golf_swing'], range: [1.25, 1.75] },
    // release (hands rolled over after impact) and the way back to address: the address grip / setup arms no
    // longer match the turned hands there
    { name: 'golf_release', clip: 'golf_swing', t: 2.13, sides: ['L', 'R'], limbs: ['forearm_L', 'forearm_R'],
      clips: ['golf_swing'], range: [1.97, 2.25] },
    { name: 'golf_return', clip: 'golf_swing', t: 3.4, sides: ['L', 'R'], limbs: ['forearm_L', 'forearm_R'],
      clips: ['golf_swing'], range: [3.2, 3.53] },
    { name: 'golf_return_low', clip: 'golf_swing', t: 3.62, sides: ['L', 'R'], limbs: ['forearm_L', 'forearm_R'],
      clips: ['golf_swing'], range: [3.53, 3.8] },
    { name: 'golf_finish', clip: 'golf_swing', t: 2.47, sides: ['L', 'R'], limbs: ['upperarm_L', 'upperarm_R', 'forearm_L', 'forearm_R', 'cuirass'],
      clips: ['golf_swing'], range: [2.25, 3.2] },
    // the right foot pivots onto its toe through the finish (heel up, turned toward the target): the setup foot
    // would squash to a sliver there
    { name: 'golf_pivot', clip: 'golf_swing', t: 2.47, sides: [], groups: [], limbs: ['foot_R', 'under_foot_R'], clips: ['golf_swing'], range: [2.03, 3.6] },
    { name: 'fist', curl: 0.95, sides: ['L', 'R'] },
    { name: 'relaxed', curl: 0.3, sides: ['L', 'R'] },
    // the other side of each hand (turned 180° about its length axis); set names come from the measured view
    { name: 'open_turned', curl: 0, twist: 180, sides: ['L', 'R'] },
    { name: 'relaxed_turned', curl: 0.3, twist: 180, sides: ['L', 'R'] },
    { name: 'fist_turned', curl: 0.95, twist: 180, sides: ['L', 'R'] },
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
