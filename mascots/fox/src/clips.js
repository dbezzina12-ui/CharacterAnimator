// Animation clips for Birdie the Fox. Authored as sparse keyframes per track; the solver interpolates.
//
// Track keys:  'bone'            rotation delta from rest in DEGREES (clockwise positive on screen)
//              'pos:bone'        position offset {x,y} in the parent's upright frame (px, y down)
//              'scale:root'      squash & stretch {x,y} about the ground origin
//              'ik:hand_L' ...   two-bone IK target {x,y[,space]} relative to the root (or a bone's upright frame)
//              'ik:foot_L' ...   foot target; feet are planted at their rest spots when absent (plant:true)
//              'ch:name'         face/body channel (see CHANNEL_DEFAULTS)
//              'grip'            1 = both hands on the club, 2 = left (lead) hand only, 3 = right hand only
// Key = [time, value, ease] where ease is the curve used to ARRIVE at that key ('smooth' default).
// Markers are times in seconds; the playback controller fires them once per live pass, never on scrub.
//
// Root-space landmarks: ground y = 0, shoulders (±56,-322), arm reach 159 px, hips (±30,-212),
// rest ankles (±36,-30), head joint (0,-372). The tee/ball anchor for golf clips is BALL.

export const BALL = { x: 105, y: -8 };   // ball centre on the tee, root space
const K = (...keys) => keys;
const step = (t, v) => [t, v, 'step'];
const ADDRESS_CLUB = { pos: { x: -16, y: 0 }, rot: -24 };   // shaft from the hands to the ball (fitted: hosel at (86,-12) in the address body pose)
const CONTACT_CLUB = { pos: { x: 14, y: -24 }, rot: -3 };    // fitted for the contact body pose: hosel at (92,-10), face on the ball

/** Stationary idle: nothing moves but the eyelids. */
export const idle = {
  name: 'idle', duration: 6, loop: true, plant: true, autoBlink: false,
  description: 'Stationary standing pose leaning on the club; only the eyes blink (single blink at 1.2 s, double blink at 4.1 s).',
  tracks: {
    'ch:blink_L': K([0, 0], [1.2, 0], [1.28, 1, 'out'], [1.42, 0, 'in'], [4.1, 0], [4.18, 1, 'out'], [4.3, 0, 'in'], [4.38, 1, 'out'], [4.52, 0, 'in']),
    'ch:blink_R': K([0, 0], [1.2, 0], [1.28, 1, 'out'], [1.42, 0, 'in'], [4.1, 0], [4.18, 1, 'out'], [4.3, 0, 'in'], [4.38, 1, 'out'], [4.52, 0, 'in']),
    'ch:smile': K([0, 0.45]),
    'ch:tailFollow': K([0, 0]), 'ch:earFollow': K([0, 0]),
    'grip': K(step(0, 1)),
  },
};

/** Alternate "alive" idle: breathing, slow tail wave, an ear flick, a glance to the side. */
export const idle_breathe = {
  name: 'idle_breathe', duration: 4.8, loop: true, plant: true,
  description: 'Soft breathing, weight on the club, slow tail wave, ear flick at 2.6 s, glance toward the tee at 3.4 s.',
  tracks: {
    'pos:chest': K([0, { x: 0, y: 0 }], [1.2, { x: 0, y: -3 }], [2.4, { x: 0, y: 0 }], [3.6, { x: 0, y: -3 }]),
    'spine_01': K([0, 0], [1.2, -1.5], [2.4, 0], [3.6, -1.5]),
    'head': K([0, 0], [1.2, 1.2], [2.4, 0], [3.3, 0], [3.7, -4], [4.3, 0]),
    'ch:pupil_x': K([0, 0], [3.3, 0], [3.6, 0.9, 'out'], [4.2, 0.9], [4.6, 0]),
    'ch:pupil_y': K([0, 0], [3.3, 0], [3.6, 0.5, 'out'], [4.2, 0.5], [4.6, 0]),
    'ear_R_01': K([0, 0], [2.5, 0], [2.6, -16, 'snap'], [2.75, 4], [2.95, 0]),
    'ear_R_02': K([0, 0], [2.55, 0], [2.65, -12, 'snap'], [2.85, 3], [3.0, 0]),
    'tail_01': K([0, -4], [1.2, 6], [2.4, -4], [3.6, 6]),
    'tail_02': K([0, -5], [1.2, 7], [2.4, -5], [3.6, 7]),
    'tail_03': K([0, -6], [1.2, 8], [2.4, -6], [3.6, 8]),
    'tail_04': K([0, -5], [1.2, 9], [2.4, -5], [3.6, 9]),
    'tail_05': K([0, -4], [1.2, 10], [2.4, -4], [3.6, 10]),
    'ch:smile': K([0, 0.45]),
    'grip': K(step(0, 1)),
  },
};

/** Friendly wave with the near (right) paw; the club stays grounded in the left paw. */
export const wave = {
  name: 'wave', duration: 2.8, loop: false, plant: true,
  description: 'Right paw leaves the club, waves three times with a big smile and raised brows, returns to the grip.',
  markers: { raised: 0.5 },
  tracks: {
    'grip': K(step(0, 1), step(0.12, 2), step(2.55, 1)),
    'ik:hand_R': K([0.12, { x: -8, y: -175 }], [0.5, { x: -128, y: -392 }, 'back'], [0.75, { x: -162, y: -400 }], [1.0, { x: -118, y: -404 }],
      [1.25, { x: -162, y: -400 }], [1.5, { x: -118, y: -404 }], [1.75, { x: -162, y: -400 }], [2.0, { x: -130, y: -395 }], [2.55, { x: -8, y: -175 }, 'in']),
    'ch:hand_R': K([0, 1], [0.12, 1], [0.45, 0, 'out'], [2.2, 0], [2.55, 1]),
    'head': K([0, 0], [0.5, -7], [2.1, -7], [2.6, 0]),
    'chest': K([0, 0], [0.5, -3], [2.1, -3], [2.6, 0]),
    'ch:smile': K([0, 0.45], [0.5, 1], [2.2, 1], [2.7, 0.45]),
    'ch:mouthOpen': K([0, 0], [0.5, 0.45], [2.1, 0.45], [2.5, 0]),
    'ch:brow_L': K([0, 0], [0.5, 1], [2.1, 1], [2.6, 0]), 'ch:brow_R': K([0, 0], [0.5, 1], [2.1, 1], [2.6, 0]),
    'ch:squint': K([0, 0], [0.5, 0.35], [2.1, 0.35], [2.6, 0]),
    'ear_L_01': K([0, 0], [0.5, 6], [2.2, 6], [2.7, 0]), 'ear_R_01': K([0, 0], [0.5, -6], [2.2, -6], [2.7, 0]),
    'tail_02': K([0, 0], [0.6, 10], [1.0, -8], [1.4, 10], [1.8, -8], [2.2, 6], [2.8, 0]),
    'tail_04': K([0, 0], [0.7, 12], [1.1, -10], [1.5, 12], [1.9, -10], [2.3, 6], [2.8, 0]),
  },
};

/** In-place strut with the club over the right shoulder. Cycle 0.9 s. */
export const walk = {
  name: 'walk', duration: 0.9, loop: true, plant: true, inPlace: true,
  description: 'Treadmill strut, club carried over the right shoulder, free left arm swings, tail wags.',
  tracks: {
    'ik:foot_L': K([0, { x: 36, y: -30 }], [0.45, { x: 36, y: -30 }], [0.6, { x: 50, y: -92 }, 'out'], [0.8, { x: 38, y: -60 }], [0.9, { x: 36, y: -30 }, 'in']),
    'ik:foot_R': K([0, { x: -36, y: -30 }], [0.15, { x: -50, y: -92 }, 'out'], [0.35, { x: -38, y: -60 }], [0.45, { x: -36, y: -30 }, 'in'], [0.9, { x: -36, y: -30 }]),
    'pos:pelvis': K([0, { x: 0, y: 2 }], [0.22, { x: 8, y: -7 }], [0.45, { x: 0, y: 2 }], [0.67, { x: -8, y: -7 }]),
    'pelvis': K([0, 0], [0.22, 3], [0.45, 0], [0.67, -3]),
    'chest': K([0, 0], [0.22, -4], [0.45, 0], [0.67, 4]),
    'head': K([0, 1], [0.22, -2], [0.45, 1], [0.67, -2]),
    // club over the right shoulder: butt in front of the chest, shaft going up-left behind the head
    'pos:club': K([0, { x: -30, y: -100 }]), 'club': K([0, -200]),
    'ch:clubBehind': K(step(0, 1)),
    'grip': K(step(0, 3)),
    // free left arm swings, elbow pumping
    'upperarm_L': K([0, 24], [0.45, -28], [0.9, 24]),
    'forearm_L': K([0, -18], [0.45, -46], [0.9, -18]),
    'ch:hand_L': K([0, 0.5]),
    'ch:smile': K([0, 0.7]), 'ch:mouthOpen': K([0, 0.15]),
    'tail_01': K([0, -8], [0.45, 8], [0.9, -8]), 'tail_02': K([0, -8], [0.45, 8], [0.9, -8]),
    'tail_03': K([0, -8], [0.45, 8], [0.9, -8]), 'tail_04': K([0, -6], [0.45, 6], [0.9, -6]),
  },
};

/** In-place run with a flight phase. Cycle 0.56 s. The club is stowed. */
export const run = {
  name: 'run', duration: 0.56, loop: true, plant: true, inPlace: true,
  description: 'Treadmill sprint with a flight phase, pumping arms, flattened ears and a streaming tail.',
  tracks: {
    'ch:clubVisible': K(step(0, 0)),
    'ik:foot_L': K([0, { x: 40, y: -30 }], [0.14, { x: 48, y: -70 }, 'out'], [0.28, { x: 54, y: -118 }], [0.42, { x: 44, y: -70 }], [0.56, { x: 40, y: -30 }, 'in']),
    'ik:foot_R': K([0, { x: -54, y: -118 }], [0.14, { x: -44, y: -70 }], [0.28, { x: -40, y: -30 }, 'in'], [0.42, { x: -48, y: -70 }, 'out'], [0.56, { x: -54, y: -118 }]),
    'pos:root': K([0, { x: 0, y: 0 }], [0.14, { x: 0, y: -26 }, 'out'], [0.28, { x: 0, y: 0 }, 'in'], [0.42, { x: 0, y: -26 }, 'out'], [0.56, { x: 0, y: 0 }, 'in']),
    'scale:root': K([0, { x: 1.05, y: 0.96 }], [0.14, { x: 0.97, y: 1.04 }], [0.28, { x: 1.05, y: 0.96 }], [0.42, { x: 0.97, y: 1.04 }], [0.56, { x: 1.05, y: 0.96 }]),
    'pos:pelvis': K([0, { x: 4, y: 0 }], [0.28, { x: -4, y: 0 }], [0.56, { x: 4, y: 0 }]),
    'chest': K([0, 5], [0.28, -5], [0.56, 5]),
    'head': K([0, -3], [0.28, 3], [0.56, -3]),
    'upperarm_L': K([0, 40], [0.28, -34], [0.56, 40]), 'forearm_L': K([0, -60], [0.28, -95], [0.56, -60]),
    'upperarm_R': K([0, 34], [0.28, -40], [0.56, 34]), 'forearm_R': K([0, 95], [0.28, 60], [0.56, 95]),
    'ch:hand_L': K([0, 0.9]), 'ch:hand_R': K([0, 0.9]),
    'ear_L_01': K([0, 28]), 'ear_R_01': K([0, -28]), 'ear_L_02': K([0, 18]), 'ear_R_02': K([0, -18]),
    'tail_01': K([0, 10]), 'tail_02': K([0, 14], [0.28, 6], [0.56, 14]), 'tail_03': K([0, 12], [0.28, 2], [0.56, 12]),
    'tail_04': K([0, 8], [0.28, -4], [0.56, 8]), 'tail_05': K([0, 4], [0.28, -8], [0.56, 4]),
    'ch:mouthOpen': K([0, 0.5]), 'ch:smile': K([0, 0.6]), 'ch:squint': K([0, 0.3]), 'ch:tongue': K([0, 0.6]),
  },
};

/** Crouch, launch, tuck, land with squash, recover. Club stowed. */
export const jump = {
  name: 'jump', duration: 1.7, loop: false, plant: true,
  description: 'Anticipation squat, stretch at take-off, tucked knees at the apex, squash on landing, recovery.',
  markers: { takeoff: 0.42, apex: 0.78, land: 1.12 },
  tracks: {
    'ch:clubVisible': K(step(0, 0)),
    'pos:pelvis': K([0, { x: 0, y: 0 }], [0.32, { x: 0, y: 46 }, 'out'], [0.42, { x: 0, y: 0 }, 'snap'], [1.05, { x: 0, y: 0 }], [1.12, { x: 0, y: 44 }, 'snap'], [1.5, { x: 0, y: 0 }, 'back']),
    'pos:root': K([0, { x: 0, y: 0 }], [0.42, { x: 0, y: 0 }], [0.78, { x: 0, y: -170 }, 'outQuad'], [1.12, { x: 0, y: 0 }, 'inQuad']),
    'scale:root': K([0, { x: 1, y: 1 }], [0.32, { x: 1.08, y: 0.93 }], [0.46, { x: 0.92, y: 1.12 }, 'snap'], [0.7, { x: 1, y: 1 }], [1.12, { x: 1.14, y: 0.88 }, 'snap'], [1.5, { x: 1, y: 1 }, 'back']),
    'ik:foot_L': K([0.42, { x: 36, y: -30 }], [0.7, { x: 50, y: -100 }, 'out'], [0.95, { x: 48, y: -96 }], [1.12, { x: 36, y: -30 }, 'in']),
    'ik:foot_R': K([0.42, { x: -36, y: -30 }], [0.7, { x: -50, y: -100 }, 'out'], [0.95, { x: -48, y: -96 }], [1.12, { x: -36, y: -30 }, 'in']),
    'ik:hand_L': K([0, { x: 95, y: -168 }], [0.32, { x: 128, y: -260 }], [0.5, { x: 118, y: -452 }, 'snap'], [0.95, { x: 125, y: -445 }], [1.12, { x: 110, y: -230 }, 'in'], [1.55, { x: 95, y: -168 }]),
    'ik:hand_R': K([0, { x: -95, y: -168 }], [0.32, { x: -128, y: -260 }], [0.5, { x: -118, y: -452 }, 'snap'], [0.95, { x: -125, y: -445 }], [1.12, { x: -110, y: -230 }, 'in'], [1.55, { x: -95, y: -168 }]),
    'ch:hand_L': K([0, 0.35], [0.4, 0], [1.0, 0], [1.5, 0.35]), 'ch:hand_R': K([0, 0.35], [0.4, 0], [1.0, 0], [1.5, 0.35]),
    'chest': K([0, 0], [0.32, 0], [0.5, 0], [0.78, 0]),
    'head': K([0, 0], [0.32, 4], [0.6, -3], [1.12, 2], [1.5, 0]),
    'ch:mouthOpen': K([0, 0], [0.32, 0.2], [0.5, 0.8], [1.05, 0.8], [1.2, 0.1], [1.5, 0]),
    'ch:smile': K([0, 0.4], [0.5, 1], [1.3, 1], [1.7, 0.45]),
    'ch:brow_L': K([0, 0], [0.32, -0.6], [0.5, 1], [1.12, 1], [1.5, 0]), 'ch:brow_R': K([0, 0], [0.32, -0.6], [0.5, 1], [1.12, 1], [1.5, 0]),
    'ch:squint': K([0, 0], [0.5, 0.5], [1.05, 0.5], [1.3, 0]),
    'ear_L_01': K([0, 0], [0.32, 20], [0.55, -14], [1.12, 24], [1.5, 0]), 'ear_R_01': K([0, 0], [0.32, -20], [0.55, 14], [1.12, -24], [1.5, 0]),
  },
};

/** Hole-in-one celebration: fist pumps with the right paw, hop, huge grin. Club stays in the left paw. */
export const celebrate = {
  name: 'celebrate', duration: 3.0, loop: false, plant: true,
  description: 'Two fist pumps with the right paw, a little hop, ears up, tail wagging; the club stays grounded in the left paw.',
  markers: { pump: 0.45, pump2: 1.05 },
  tracks: {
    'grip': K(step(0, 1), step(0.1, 2), step(2.7, 1)),
    'ik:hand_R': K([0.1, { x: -8, y: -175 }], [0.45, { x: -86, y: -470 }, 'back'], [0.75, { x: -98, y: -400 }], [1.05, { x: -82, y: -478 }, 'back'],
      [1.4, { x: -98, y: -400 }], [1.7, { x: -80, y: -480 }, 'back'], [2.2, { x: -84, y: -470 }], [2.7, { x: -8, y: -175 }, 'in']),
    'ch:hand_R': K([0, 1]),
    'pos:root': K([0, { x: 0, y: 0 }], [0.3, { x: 0, y: 0 }], [0.5, { x: 0, y: -34 }, 'outQuad'], [0.7, { x: 0, y: 0 }, 'inQuad'], [0.9, { x: 0, y: 0 }], [1.1, { x: 0, y: -34 }, 'outQuad'], [1.3, { x: 0, y: 0 }, 'inQuad']),
    'pos:pelvis': K([0, { x: 0, y: 0 }], [0.3, { x: 0, y: 22 }], [0.5, { x: 0, y: 0 }, 'snap'], [0.72, { x: 0, y: 20 }], [0.9, { x: 0, y: 14 }], [1.1, { x: 0, y: 0 }, 'snap'], [1.32, { x: 0, y: 20 }], [1.7, { x: 0, y: 4 }], [2.7, { x: 0, y: 0 }]),
    'scale:root': K([0, { x: 1, y: 1 }], [0.3, { x: 1.06, y: 0.95 }], [0.5, { x: 0.95, y: 1.07 }, 'snap'], [0.7, { x: 1.08, y: 0.93 }], [0.9, { x: 1, y: 1 }], [1.1, { x: 0.95, y: 1.07 }, 'snap'], [1.3, { x: 1.08, y: 0.93 }], [1.6, { x: 1, y: 1 }]),
    'chest': K([0, 0], [0.45, 6], [0.75, 2], [1.05, 7], [1.7, 5], [2.7, 0]),
    'head': K([0, 0], [0.45, -10], [0.75, -4], [1.05, -12], [1.7, -8], [2.7, 0]),
    'ch:smile': K([0, 0.45], [0.4, 1], [2.4, 1], [3.0, 0.5]),
    'ch:mouthOpen': K([0, 0], [0.45, 0.9], [0.75, 0.5], [1.05, 0.95], [2.2, 0.6], [2.7, 0]),
    'ch:squint': K([0, 0], [0.45, 0.8], [2.4, 0.8], [2.9, 0]),
    'ch:brow_L': K([0, 0], [0.45, 1], [2.4, 1], [2.9, 0]), 'ch:brow_R': K([0, 0], [0.45, 1], [2.4, 1], [2.9, 0]),
    'ch:cheekBlush': K([0, 0], [0.5, 1], [2.6, 1], [3.0, 0]),
    'ear_L_01': K([0, 0], [0.45, -8], [2.4, -8], [2.9, 0]), 'ear_R_01': K([0, 0], [0.45, 8], [2.4, 8], [2.9, 0]),
    'tail_01': K([0, 0], [0.4, 10], [0.7, -10], [1.0, 10], [1.3, -10], [1.6, 10], [1.9, -10], [2.2, 8], [2.5, -6], [3.0, 0]),
    'tail_03': K([0, 0], [0.45, 12], [0.75, -12], [1.05, 12], [1.35, -12], [1.65, 12], [1.95, -12], [2.25, 8], [2.55, -6], [3.0, 0]),
    'tail_05': K([0, 0], [0.5, 14], [0.8, -14], [1.1, 14], [1.4, -14], [1.7, 14], [2.0, -14], [2.3, 8], [2.6, -6], [3.0, 0]),
  },
};

/** From standing to the address pose over the ball (holds the end pose). */
export const address = {
  name: 'address', duration: 1.4, loop: false, plant: true,
  description: 'Eyes drop to the ball, knees bend, both paws take the grip and the club head settles behind the ball.',
  markers: { set: 1.1 },
  tracks: {
    'grip': K(step(0, 1)),
    'pos:club': K([0, { x: 0, y: 0 }], [1.1, ADDRESS_CLUB.pos]),
    'club': K([0, 0], [1.1, ADDRESS_CLUB.rot]),
    'pos:pelvis': K([0, { x: 0, y: 0 }], [1.1, { x: -4, y: 22 }]),
    'pelvis': K([0, 0], [1.1, 2]),
    'spine_01': K([0, 0], [1.1, 3]),
    'chest': K([0, 0], [1.1, 4]),
    'head': K([0, 0], [0.4, 2], [1.1, 9]),
    'ch:pupil_x': K([0, 0], [0.35, 0.8, 'out']), 'ch:pupil_y': K([0, 0], [0.35, 1, 'out']),
    'ch:brow_L': K([0, 0], [0.6, -0.5]), 'ch:brow_R': K([0, 0], [0.6, -0.5]),
    'ch:smile': K([0, 0.45], [0.8, 0.1]),
    'ch:mouthOpen': K([0, 0], [1.1, 0]),
    'ear_L_01': K([0, 0], [1.1, 4]), 'ear_R_01': K([0, 0], [1.1, -4]),
  },
};

function swingTracks({ contact, duration, big }) {
  const top = contact * 0.67, finish = contact + 0.55, hold = finish + 0.6;
  const topRot = big ? 164 : 152, finRot = big ? -126 : -118;
  const topPos = big ? { x: -58, y: -118 } : { x: -52, y: -108 };     // butt near the right shoulder
  const finPos = big ? { x: 36, y: -86 } : { x: 30, y: -78 };         // butt in front of the left shoulder
  const t = {
    'grip': K(step(0, 1)),
    'pos:club': K([0, ADDRESS_CLUB.pos], [contact * 0.18, ADDRESS_CLUB.pos], [top, topPos, 'out'], [contact, CONTACT_CLUB.pos, 'snap'],
      [finish, finPos, 'out'], [hold, finPos], [duration, { x: 0, y: 0 }]),
    'club': K([0, ADDRESS_CLUB.rot], [contact * 0.18, ADDRESS_CLUB.rot], [top, topRot, 'out'], [contact, CONTACT_CLUB.rot, 'snap'],
      [finish, finRot, 'out'], [hold, finRot], [duration, 0]),
    'ch:clubBehind': K(step(0, 0), step(top - 0.2, 1), step(top + 0.12, 0), step(finish - 0.22, 1), step(hold + 0.25, 0)),
    // body: weight shift and a small turn against the swing, knees stay bent, head stays on the ball
    'pos:pelvis': K([0, { x: -4, y: 22 }], [top, { x: -16, y: 20 }], [contact, { x: 8, y: 24 }, 'snap'], [finish, { x: 18, y: 18 }], [hold, { x: 16, y: 18 }], [duration, { x: 0, y: 0 }]),
    'pelvis': K([0, 2], [top, 4], [contact, -2, 'snap'], [finish, -5], [hold, -5], [duration, 0]),
    'spine_01': K([0, 3], [top, 6], [contact, 0, 'snap'], [finish, -6], [hold, -6], [duration, 0]),
    'chest': K([0, 4], [top, big ? 10 : 8], [contact, 1, 'snap'], [finish, big ? -12 : -9], [hold, -9], [duration, 0]),
    'head': K([0, 9], [top, 8], [contact, 7, 'snap'], [finish - 0.2, 4], [finish, -8, 'out'], [hold, -10], [duration, 0]),
    'ch:pupil_x': K([0, 0.8], [contact, 0.8], [contact + 0.15, 1, 'out'], [hold, 0.9], [duration, 0]),
    'ch:pupil_y': K([0, 1], [contact, 1], [contact + 0.15, -0.6, 'out'], [hold, -0.7], [duration, 0]),
    'ch:brow_L': K([0, -0.5], [top, -0.8], [contact + 0.2, 0.6], [hold, 0.8], [duration, 0]),
    'ch:brow_R': K([0, -0.5], [top, -0.8], [contact + 0.2, 0.6], [hold, 0.8], [duration, 0]),
    'ch:squint': K([0, 0], [top, 0.3], [contact, 0.6], [contact + 0.25, 0], [duration, 0]),
    'ch:mouthOpen': K([0, 0], [top, 0.1], [contact - 0.05, 0.45], [contact + 0.3, 0.6], [hold, 0.5], [duration, 0]),
    'ch:smile': K([0, 0.1], [contact + 0.3, 0.9], [hold, 0.9], [duration, 0.45]),
    'ear_L_01': K([0, 4], [top, 10], [contact, -6, 'snap'], [finish, -10], [hold, -4], [duration, 0]),
    'ear_R_01': K([0, -4], [top, -10], [contact, 6, 'snap'], [finish, 10], [hold, 4], [duration, 0]),
    'ch:tailFollow': K([0, 1.4]), 'ch:earFollow': K([0, 1.3]),
  };
  if (big) {
    // Long Drive: a hop at the finish and a lean to steer the rolling ball
    t['pos:root'] = K([finish, { x: 0, y: 0 }], [finish + 0.15, { x: 0, y: -24 }, 'outQuad'], [finish + 0.3, { x: 0, y: 0 }, 'inQuad']);
    t['scale:root'] = K([contact, { x: 1, y: 1 }], [finish + 0.1, { x: 0.96, y: 1.05 }], [finish + 0.32, { x: 1.06, y: 0.95 }], [finish + 0.6, { x: 1, y: 1 }]);
    t['pelvis'] = K([0, 2], [top, 4], [contact, -2, 'snap'], [finish, -5], [finish + 0.9, -12], [hold + 0.4, 4], [hold + 0.9, -4], [duration, 0]);
    t['spine_01'] = K([0, 3], [top, 6], [contact, 0, 'snap'], [finish, -6], [finish + 0.9, -10], [hold + 0.4, 4], [hold + 0.9, -3], [duration, 0]);
  }
  return t;
}

/** Full swing from the address pose. Contact (ball launch) is the `contact` marker. */
export const swing = {
  name: 'swing', duration: 3.4, loop: false, plant: true,
  description: 'Backswing over the right shoulder, downswing, club contact at 1.42 s, follow-through over the left shoulder, hold, return to standing.',
  markers: { top: 1.42 * 0.67, contact: 1.42, finish: 1.42 + 0.55 },
  tracks: swingTracks({ contact: 1.42, duration: 3.4, big: false }),
};

/** Long Drive: bigger swing, contact at 1.8 s, hop and lean after the finish to steer the ball. */
export const drive = {
  name: 'drive', duration: 4.2, loop: false, plant: true,
  description: 'Stronger drive with a fuller turn, club contact at 1.8 s, a hop at the finish and a lean to steer the rolling ball.',
  markers: { top: 1.8 * 0.67, contact: 1.8, finish: 1.8 + 0.55 },
  tracks: swingTracks({ contact: 1.8, duration: 4.2, big: true }),
};

/** A miss: ears droop, head shake, tail sinks. */
export const miss = {
  name: 'miss', duration: 3.0, loop: false, plant: true,
  description: 'Disappointed head shake: ears droop, worried brows, frown, tail drops; recovers to standing.',
  tracks: {
    'grip': K(step(0, 1)),
    'head': K([0, 0], [0.4, 10], [0.7, -10], [1.0, 9], [1.3, -8], [1.6, 6], [2.0, 4], [2.6, 0]),
    'chest': K([0, 0], [0.5, 3], [2.0, 4], [2.8, 0]),
    'pos:chest': K([0, { x: 0, y: 0 }], [0.5, { x: 0, y: 8 }], [2.2, { x: 0, y: 8 }], [2.9, { x: 0, y: 0 }]),
    'ear_L_01': K([0, 0], [0.45, 52, 'out'], [2.3, 52], [2.9, 0]), 'ear_L_02': K([0, 0], [0.5, 28, 'out'], [2.3, 28], [2.9, 0]),
    'ear_R_01': K([0, 0], [0.45, -52, 'out'], [2.3, -52], [2.9, 0]), 'ear_R_02': K([0, 0], [0.5, -28, 'out'], [2.3, -28], [2.9, 0]),
    'tail_01': K([0, 0], [0.6, 24], [2.3, 24], [2.9, 0]), 'tail_02': K([0, 0], [0.6, 26], [2.3, 26], [2.9, 0]),
    'tail_03': K([0, 0], [0.6, 24], [2.3, 24], [2.9, 0]), 'tail_04': K([0, 0], [0.6, 20], [2.3, 20], [2.9, 0]), 'tail_05': K([0, 0], [0.6, 10], [2.3, 10], [2.9, 0]),
    'ch:browTilt': K([0, 0], [0.4, 1], [2.3, 1], [2.9, 0]),
    'ch:brow_L': K([0, 0], [0.4, 0.4], [2.3, 0.4], [2.9, 0]), 'ch:brow_R': K([0, 0], [0.4, 0.4], [2.3, 0.4], [2.9, 0]),
    'ch:smile': K([0, 0.45], [0.4, -0.8], [2.3, -0.8], [3.0, 0.3]),
    'ch:mouthOpen': K([0, 0], [0.4, 0.25], [1.6, 0.25], [2.2, 0]),
    'ch:pupil_y': K([0, 0], [0.4, 0.7], [2.3, 0.7], [2.9, 0]),
    'ch:pupilSize': K([0, 1], [0.4, 0.8], [2.3, 0.8], [2.9, 1]),
    'ch:tailFollow': K([0, 0.5]),
  },
};

export const CLIPS = { idle, idle_breathe, wave, walk, run, jump, celebrate, address, swing, drive, miss };
export const CLIP_LIST = Object.keys(CLIPS);
