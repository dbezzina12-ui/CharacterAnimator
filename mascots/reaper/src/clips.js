// Animation clips for the Grim Reaper. Same track format as the fox rig:
//   'bone' rotation in degrees (clockwise +), 'pos:bone' {x,y} in the parent's upright frame,
//   'scale:root', 'ik:hand_*' / 'ik:foot_*' targets (root space), 'ch:name' channels,
//   'grip' 1 = both hands on the scythe, 2 = left only, 3 = right only. Key = [time, value, ease].
// Scythe rest: butt at (-150,-60) in front of the hips, shaft up-right at -54°, blade above the right shoulder.
const K = (...keys) => keys; const step = (t, v) => [t, v, 'step'];

export const idle = {
  name: 'idle', duration: 6, loop: true, plant: true, autoBlink: false,
  description: 'Stationary stance with the scythe; only the socket glints pulse.',
  tracks: { grip: K(step(0, 1)), 'ch:eyeGlow': K([0, 0.6], [1.5, 1], [3, 0.6], [4.5, 1]), 'ch:tailFollow': K([0, 0]), 'ch:earFollow': K([0, 0]) },
};
export const hover = {
  name: 'hover', duration: 4, loop: true, plant: true,
  description: 'Floating idle: a slow bob with the robe and hood drifting, the scythe easing, tassels swinging.',
  tracks: {
    grip: K(step(0, 1)),
    'pos:root': K([0, { x: 0, y: -4 }], [2, { x: 0, y: -16 }], [4, { x: 0, y: -4 }]),
    'ch:hoverShadow': K([0, 0.9], [2, 0.6], [4, 0.9]),
    'spine': K([0, 0], [2, 1.2], [4, 0]), 'chest': K([0, 0], [2, -1], [4, 0]),
    'head': K([0, 0], [1, 1.5], [2, 0], [3, -1.5]),
    'skirt_R': K([0, 2], [2, -3], [4, 2]), 'skirt_L': K([0, -2], [2, 3], [4, -2]), 'skirt_F': K([0, 0], [2, 1.5], [4, 0]),
    'hood_01': K([0, 0], [2, -4], [4, 0]), 'hood_02': K([0, 0], [1, -5], [3, 5], [4, 0]),
    'scythe': K([0, 0], [2, -1.5], [4, 0]),
    'ch:eyeGlow': K([0, 0.7], [2, 1], [4, 0.7]),
  },
};
export const walk = {
  name: 'walk', duration: 0.9, loop: true, plant: true, inPlace: true,
  description: 'Treadmill shuffle with the scythe held across the body, robe swinging with each step.',
  tracks: {
    grip: K(step(0, 1)),
    'ik:foot_L': K([0, { x: 32, y: -24 }], [0.45, { x: 32, y: -24 }], [0.6, { x: 44, y: -70 }, 'out'], [0.8, { x: 34, y: -46 }], [0.9, { x: 32, y: -24 }, 'in']),
    'ik:foot_R': K([0, { x: -32, y: -24 }], [0.15, { x: -44, y: -70 }, 'out'], [0.35, { x: -34, y: -46 }], [0.45, { x: -32, y: -24 }, 'in'], [0.9, { x: -32, y: -24 }]),
    'pos:pelvis': K([0, { x: 0, y: 2 }], [0.22, { x: 5, y: -6 }], [0.45, { x: 0, y: 2 }], [0.67, { x: -5, y: -6 }]),
    'pelvis': K([0, 0], [0.22, 2], [0.45, 0], [0.67, -2]), 'chest': K([0, 0], [0.22, -2.5], [0.45, 0], [0.67, 2.5]),
    'head': K([0, 1], [0.22, -1.5], [0.45, 1], [0.67, -1.5]),
    'skirt_R': K([0, -6], [0.45, 6], [0.9, -6]), 'skirt_L': K([0, 6], [0.45, -6], [0.9, 6]), 'skirt_F': K([0, 2], [0.45, -2], [0.9, 2]),
    'scythe': K([0, 1], [0.45, -1], [0.9, 1]),
  },
};
export const slash = {
  name: 'slash', duration: 1.7, loop: false, plant: true,
  description: 'Wind-up over the right shoulder, then a sweeping scythe cut across the front (marker `hit`), follow-through and recover.',
  markers: { windup: 0.42, hit: 0.62, recover: 1.1 },
  tracks: {
    grip: K(step(0, 1)),
    'scythe': K([0, 0], [0.42, -70, 'out'], [0.62, 125, 'snap'], [0.8, 140], [1.1, 100], [1.7, 0]),
    'pos:scythe': K([0, { x: 0, y: 0 }], [0.42, { x: 30, y: -50 }, 'out'], [0.62, { x: 46, y: 10 }, 'snap'], [0.8, { x: 40, y: 20 }], [1.1, { x: 20, y: 6 }], [1.7, { x: 0, y: 0 }]),
    'ch:propBehind': K(step(0, 0), step(0.3, 1), step(0.58, 0)),
    'ch:trail': K([0, 0], [0.56, 0], [0.62, 1, 'snap'], [0.85, 0, 'out']),
    'pos:pelvis': K([0, { x: 0, y: 0 }], [0.42, { x: -14, y: 6 }], [0.62, { x: 16, y: 10 }, 'snap'], [1.1, { x: 8, y: 6 }], [1.7, { x: 0, y: 0 }]),
    'pelvis': K([0, 0], [0.42, 4], [0.62, -5, 'snap'], [1.7, 0]),
    'spine': K([0, 0], [0.42, 6], [0.62, -8, 'snap'], [1.1, -5], [1.7, 0]),
    'chest': K([0, 0], [0.42, 10], [0.62, -12, 'snap'], [1.1, -8], [1.7, 0]),
    'head': K([0, 0], [0.42, -6], [0.62, 8, 'snap'], [1.1, 4], [1.7, 0]),
    'scale:root': K([0, { x: 1, y: 1 }], [0.42, { x: 0.97, y: 1.03 }], [0.62, { x: 1.06, y: 0.95 }, 'snap'], [1.0, { x: 1, y: 1 }]),
    'ch:brow': K([0, 0], [0.3, 1], [1.2, 1], [1.7, 0]), 'ch:jaw': K([0, 0], [0.5, 0.2], [0.62, 0.8, 'snap'], [1.0, 0.3], [1.5, 0]),
    'ch:eyeGlow': K([0, 0.8], [0.42, 1.1], [0.62, 1.5, 'snap'], [1.2, 0.9], [1.7, 0.8]), 'ch:eyeSize': K([0, 1], [0.42, 1.3], [1.2, 1.3], [1.7, 1]),
    'skirt_R': K([0, 0], [0.42, -8], [0.62, 10, 'snap'], [1.7, 0]), 'skirt_L': K([0, 0], [0.42, -6], [0.62, 12, 'snap'], [1.7, 0]),
    'ch:tailFollow': K([0, 1.4]), 'ch:earFollow': K([0, 1.4]),
  },
};
export const spin = {
  name: 'spin', duration: 1.5, loop: false, plant: true,
  description: 'Twirls the scythe a full turn in front of the body with a motion trail (markers `hit`, `hit2`).',
  markers: { hit: 0.55, hit2: 0.95 },
  tracks: {
    grip: K(step(0, 1)),
    'scythe': K([0, 0], [0.3, -30, 'in'], [1.1, 330, 'linear'], [1.5, 360]),
    'pos:scythe': K([0, { x: 0, y: 0 }], [0.3, { x: 30, y: -40 }], [1.2, { x: 30, y: -40 }], [1.5, { x: 0, y: 0 }]),
    'ch:trail': K([0, 0], [0.35, 1], [1.1, 1], [1.3, 0]),
    'ch:propBehind': K(step(0, 0), step(0.62, 1), step(0.9, 0)),
    'chest': K([0, 0], [0.5, -6], [1.0, 6], [1.5, 0]), 'head': K([0, 0], [0.5, 4], [1.0, -4], [1.5, 0]),
    'ch:brow': K([0, 0], [0.3, 0.8], [1.3, 0.8], [1.5, 0]), 'ch:eyeGlow': K([0, 0.8], [0.4, 1.3], [1.2, 1.3], [1.5, 0.8]),
    'ch:tailFollow': K([0, 1.3]),
  },
};
export const hurt = {
  name: 'hurt', duration: 1.2, loop: false, plant: true,
  description: 'Takes a hit from the right: knocked back, jaw drops, glints flicker, robe whips.',
  markers: { hit: 0.04 },
  tracks: {
    grip: K(step(0, 1)),
    'pos:pelvis': K([0, { x: 0, y: 0 }], [0.1, { x: -22, y: 10 }, 'snap'], [0.4, { x: 8, y: 4 }], [0.7, { x: -3, y: 2 }], [1.2, { x: 0, y: 0 }]),
    'spine': K([0, 0], [0.1, -10, 'snap'], [0.4, 4], [1.2, 0]), 'chest': K([0, 0], [0.1, -12, 'snap'], [0.4, 5], [1.2, 0]),
    'head': K([0, 0], [0.1, -16, 'snap'], [0.4, 6], [0.7, -2], [1.2, 0]),
    'scythe': K([0, 0], [0.1, 18, 'snap'], [0.5, -6], [1.2, 0]),
    'ch:jaw': K([0, 0], [0.08, 1, 'snap'], [0.6, 0.5], [1.2, 0]), 'ch:brow': K([0, 0], [0.08, -0.8, 'snap'], [1.2, 0]),
    'ch:eyeGlow': K([0, 0.8], step(0.08, 0.1), step(0.18, 1.2), step(0.28, 0.2), step(0.4, 0.9), [1.2, 0.8]),
    'scale:root': K([0, { x: 1, y: 1 }], [0.1, { x: 1.08, y: 0.94 }, 'snap'], [0.5, { x: 1, y: 1 }, 'back']),
    'ch:tailFollow': K([0, 1.5]), 'ch:earFollow': K([0, 1.5]),
  },
};
export const taunt = {
  name: 'taunt', duration: 2.2, loop: false, plant: true,
  description: 'Lifts the scythe, tips the skull back and cackles: jaw chatters, hourglass spins, glints flare.',
  markers: { laugh: 0.6 },
  tracks: {
    grip: K(step(0, 1)),
    'scythe': K([0, 0], [0.5, -40, 'back'], [1.8, -40], [2.2, 0]),
    'pos:scythe': K([0, { x: 0, y: 0 }], [0.5, { x: 20, y: -50 }, 'back'], [1.8, { x: 20, y: -50 }], [2.2, { x: 0, y: 0 }]),
    'chest': K([0, 0], [0.5, -6], [1.8, -6], [2.2, 0]), 'head': K([0, 0], [0.5, -14, 'back'], [1.8, -12], [2.2, 0]),
    'ch:jaw': K([0, 0], [0.6, 0.9], [0.75, 0.3], [0.9, 0.9], [1.05, 0.3], [1.2, 0.9], [1.35, 0.3], [1.5, 0.8], [1.9, 0]),
    'ch:brow': K([0, 0], [0.5, 0.6], [1.8, 0.6], [2.2, 0]), 'ch:eyeGlow': K([0, 0.8], [0.5, 1.4], [1.8, 1.4], [2.2, 0.8]), 'ch:eyeSize': K([0, 1], [0.5, 1.4], [1.8, 1.4], [2.2, 1]),
    'ch:hourglassSpin': K([0, 0], [0.4, 0], [1.6, 2, 'out']),
    'pos:pelvis': K([0, { x: 0, y: 0 }], [0.6, { x: 0, y: 0 }], [0.75, { x: 0, y: 6 }], [0.9, { x: 0, y: 0 }], [1.05, { x: 0, y: 6 }], [1.2, { x: 0, y: 0 }], [1.35, { x: 0, y: 6 }], [1.6, { x: 0, y: 0 }]),
  },
};
export const jump = {
  name: 'jump', duration: 1.5, loop: false, plant: true,
  description: 'Crouch, leap with the robe billowing, land with a squash.',
  markers: { takeoff: 0.36, apex: 0.7, land: 1.02 },
  tracks: {
    grip: K(step(0, 1)),
    'pos:pelvis': K([0, { x: 0, y: 0 }], [0.28, { x: 0, y: 34 }, 'out'], [0.36, { x: 0, y: 0 }, 'snap'], [0.95, { x: 0, y: 0 }], [1.02, { x: 0, y: 32 }, 'snap'], [1.4, { x: 0, y: 0 }, 'back']),
    'pos:root': K([0, { x: 0, y: 0 }], [0.36, { x: 0, y: 0 }], [0.7, { x: 0, y: -170 }, 'outQuad'], [1.02, { x: 0, y: 0 }, 'inQuad']),
    'scale:root': K([0, { x: 1, y: 1 }], [0.28, { x: 1.08, y: 0.92 }], [0.4, { x: 0.92, y: 1.12 }, 'snap'], [0.7, { x: 1, y: 1 }], [1.02, { x: 1.14, y: 0.88 }, 'snap'], [1.4, { x: 1, y: 1 }, 'back']),
    'ik:foot_L': K([0.36, { x: 32, y: -24 }], [0.6, { x: 44, y: -80 }, 'out'], [0.9, { x: 40, y: -70 }], [1.02, { x: 32, y: -24 }, 'in']),
    'ik:foot_R': K([0.36, { x: -32, y: -24 }], [0.6, { x: -44, y: -80 }, 'out'], [0.9, { x: -40, y: -70 }], [1.02, { x: -32, y: -24 }, 'in']),
    'skirt_R': K([0, 0], [0.28, 6], [0.5, -26, 'snap'], [0.85, -20], [1.02, 12, 'snap'], [1.5, 0]), 'skirt_L': K([0, 0], [0.28, -6], [0.5, 26, 'snap'], [0.85, 20], [1.02, -12, 'snap'], [1.5, 0]),
    'skirt_F': K([0, 0], [0.5, -6], [0.85, -4], [1.5, 0]),
    'ch:hoverShadow': K([0, 1], [0.36, 1], [0.7, 0.4], [1.02, 1]),
    'head': K([0, 0], [0.28, 4], [0.5, -4], [1.02, 3], [1.5, 0]), 'ch:brow': K([0, 0], [0.28, 0.6], [0.5, -0.4], [1.02, 0.6], [1.5, 0]),
    'ch:tailFollow': K([0, 1.3]), 'ch:earFollow': K([0, 1.3]),
  },
};
export const death = {
  name: 'death', duration: 2.0, loop: false, plant: true,
  description: 'Collapses: the scythe falls, the robe folds down onto the boots, the skull tips and the glints go out.',
  markers: { drop: 0.5, down: 1.3 },
  tracks: {
    grip: K(step(0, 1), step(0.3, 2), step(0.5, 0)),
    'scythe': K([0, 0], [0.3, 10], [0.5, 30, 'in'], [0.9, 6, 'bounce']),
    'pos:scythe': K([0, { x: 0, y: 0 }], [0.5, { x: -30, y: 70 }, 'in'], [0.9, { x: -30, y: 150 }, 'bounce']),
    'ch:propBehind': K(step(0, 0), step(0.55, 1)),
    'ik:hand_R': K([0.5, { x: -110, y: -150 }], [1.3, { x: -90, y: -30 }, 'in']), 'ik:hand_L': K([0.5, { x: 70, y: -200 }], [1.3, { x: 80, y: -50 }, 'in']),
    'pos:pelvis': K([0, { x: 0, y: 0 }], [0.5, { x: 0, y: 10 }], [1.3, { x: 0, y: 110 }, 'in']),
    'spine': K([0, 0], [0.5, 4], [1.3, 16, 'in']), 'chest': K([0, 0], [0.5, 6], [1.3, 24, 'in']),
    'head': K([0, 0], [0.5, 8], [1.3, 34, 'in'], [1.6, 30]),
    'skirt_R': K([0, 0], [1.3, -34, 'in']), 'skirt_L': K([0, 0], [1.3, 34, 'in']), 'skirt_F': K([0, 0], [1.3, 8]),
    'scale:root': K([0, { x: 1, y: 1 }], [1.3, { x: 1.12, y: 0.78 }, 'in'], [1.45, { x: 1.16, y: 0.74 }], [2.0, { x: 1.16, y: 0.74 }]),
    'ch:jaw': K([0, 0], [0.3, 1], [1.3, 0.6], [2, 0.6]), 'ch:brow': K([0, 0], [0.3, -0.9], [2, -0.9]),
    'ch:eyeGlow': K([0, 0.8], [0.3, 1.2], [1.3, 0.4], [1.7, 0, 'out']),
    'ch:tailFollow': K([0, 1.2]), 'ch:earFollow': K([0, 1.2]),
  },
};
export const CLIPS = { idle, hover, walk, slash, spin, hurt, taunt, jump, death };
export const CLIP_LIST = Object.keys(CLIPS);
