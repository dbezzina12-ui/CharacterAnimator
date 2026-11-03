// Animation clips for Krakenbot. Same track format as the fox rig, plus:
//   'tent:tent_XX'   whole-tentacle curl in degrees, spread over the five links (tip-biased)
//   'ik:tent_XX'     CCD tip target {x, y, curl?, limit?, space?}; the tentacle is pinned (no follow-through) while keyed
//   clip.ripple      { amp, cycles, linkPhase, stagger }: travelling wave along every tentacle, integer cycles per loop
// Root space: ground y = 0, body ring at (0,-232), dome centre ≈ (0,-338), pods at (±138,-316).
// Rotations are clockwise-positive on screen. Character-left tentacles (screen +x) raise with NEGATIVE values.

const K = (...keys) => keys;
const step = (t, v) => [t, v, 'step'];
/** Symmetric tentacle-pair CURL keys (total bend, degrees): `_L` gets the values, `_R` the negated values. */
function pair(base, keys) {
  return { [`tent:${base}L`]: keys, [`tent:${base}R`]: keys.map(([t, v, e]) => [t, -v, e]) };
}
/** Symmetric RAISE keys: rotate the base link of both tentacles (negative lifts the character-left one). */
function raise(base, keys) {
  return { [`${base}L_01`]: keys, [`${base}R_01`]: keys.map(([t, v, e]) => [t, -v, e]) };
}
const REST_TIP_FL = { x: 2, y: -34 };

export const idle = {
  name: 'idle', duration: 6, loop: true, autoBlink: false,
  description: 'Stationary hover; only the armoured eye shutters blink (single blink at 1.4 s, double at 4.3 s).',
  tracks: {
    'ch:blink_L': K([0, 0], [1.4, 0], [1.48, 1, 'out'], [1.6, 0, 'in'], [4.3, 0], [4.38, 1, 'out'], [4.5, 0, 'in'], [4.58, 1, 'out'], [4.72, 0, 'in']),
    'ch:blink_R': K([0, 0], [1.4, 0], [1.48, 1, 'out'], [1.6, 0, 'in'], [4.3, 0], [4.38, 1, 'out'], [4.5, 0, 'in'], [4.58, 1, 'out'], [4.72, 0, 'in']),
    'ch:tentFollow': K([0, 0]),
  },
};

export const hover = {
  name: 'hover', duration: 4, loop: true, ripple: { amp: 3.5, cycles: 1, linkPhase: 0.8, stagger: 0.7 },
  description: 'Floating bob with drifting tentacles, a travelling ripple, pulsing lights and spinning pod rings.',
  tracks: {
    'pos:body': K([0, { x: 0, y: 0 }], [1, { x: 3, y: -12 }], [2, { x: 0, y: 0 }], [3, { x: -3, y: -12 }]),
    'head': K([0, 0], [1, 1.5], [2, 0], [3, -1.5]),
    'ch:glow': K([0, 0.75], [1, 1], [2, 0.75], [3, 1]),
    'ch:podSpin': K([0, 0], [4, 1, 'linear']),
    'ch:pupil_x': K([0, 0], [1.6, 0], [1.9, 0.6, 'out'], [2.9, 0.6], [3.2, 0]),
    ...pair('tent_U', K([0, 0], [2, -14], [4, 0])),
    ...pair('tent_M', K([0, 0], [2, 12], [4, 0])),
    ...pair('tent_F', K([0, 8], [2, -8], [4, 8])),
  },
};

export const wave = {
  name: 'wave', duration: 2.8, loop: false,
  description: 'The upper-left tentacle rises and waves its tip three times; brows lift, mouth plate opens a little.',
  markers: { raised: 0.5 },
  tracks: {
    'tent_UL_01': K([0, 0], [0.5, -48, 'back'], [2.2, -48], [2.8, 0]),
    'tent:tent_UL': K([0, 0], [0.5, -40, 'back'], [2.2, -40], [2.8, 0]),
    'tent_UL_04': K([0, 0], [0.5, 0], [0.75, -30], [1.0, 30], [1.25, -30], [1.5, 30], [1.75, -30], [2.0, 10], [2.4, 0]),
    'tent_UL_05': K([0, 0], [0.55, 0], [0.8, -40], [1.05, 40], [1.3, -40], [1.55, 40], [1.8, -40], [2.05, 10], [2.45, 0]),
    'head': K([0, 0], [0.5, -5], [2.2, -5], [2.8, 0]),
    'ch:brow': K([0, 0.45], [0.5, -0.5], [2.2, -0.5], [2.8, 0.45]),
    'ch:mouth': K([0, 0], [0.5, 0.35], [2.2, 0.35], [2.7, 0]),
    'ch:glow': K([0, 0.8], [0.5, 1.1], [2.2, 1.1], [2.8, 0.8]),
    'ch:pupil_x': K([0, 0], [0.5, 0.5], [2.2, 0.5], [2.8, 0]),
  },
};

export const taunt = {
  name: 'taunt', duration: 2.6, loop: false, ripple: { amp: 0, cycles: 2, linkPhase: 1.0, stagger: 0.4 },
  description: 'Furious flare: tentacles spread wide, brows slam down, eyes go white-hot, pods spin up, visor flashes.',
  markers: { flash: 0.35 },
  tracks: {
    'ch:brow': K([0, 0.45], [0.3, 1, 'snap'], [2.1, 1], [2.6, 0.45]),
    'ch:eyeHeat': K([0, 0], [0.4, 0.9, 'snap'], [2.0, 0.9], [2.6, 0]),
    'ch:glow': K([0, 0.8], [0.35, 1.4, 'snap'], [2.0, 1.3], [2.6, 0.8]),
    'ch:visorFlash': K([0, 0], [0.3, 0], [0.35, 0.9, 'snap'], [0.6, 0, 'out']),
    'ch:mouth': K([0, 0], [0.4, 0.8, 'snap'], [2.0, 0.8], [2.5, 0]),
    'ch:podSpin': K([0, 0], [2.6, 3, 'linear']),
    'ch:ripple': K([0, 0], [0.4, 7], [2.0, 7], [2.6, 0]),
    'pos:body': K([0, { x: 0, y: 0 }], [0.4, { x: 0, y: -22 }, 'back'], [2.0, { x: 0, y: -22 }], [2.6, { x: 0, y: 0 }]),
    'scale:root': K([0, { x: 1, y: 1 }], [0.4, { x: 1.06, y: 1.06 }, 'back'], [2.0, { x: 1.06, y: 1.06 }], [2.6, { x: 1, y: 1 }]),
    ...raise('tent_U', K([0, 0], [0.4, -22, 'back'], [2.0, -22], [2.6, 0])),
    ...pair('tent_U', K([0, 0], [0.4, 60, 'back'], [2.0, 60], [2.6, 0])),
    ...raise('tent_M', K([0, 0], [0.4, -34, 'back'], [2.0, -34], [2.6, 0])),
    ...pair('tent_M', K([0, 0], [0.4, -60, 'back'], [2.0, -60], [2.6, 0])),
    ...raise('tent_B', K([0, 0], [0.4, -16, 'back'], [2.0, -16], [2.6, 0])),
    ...pair('tent_B', K([0, 0], [0.4, -30, 'back'], [2.0, -30], [2.6, 0])),
    ...raise('tent_F', K([0, 0], [0.4, -34, 'back'], [2.0, -34], [2.6, 0])),
    ...pair('tent_F', K([0, 0], [0.4, -50, 'back'], [2.0, -50], [2.6, 0])),
  },
};

export const slam = {
  name: 'slam', duration: 2.3, loop: false,
  description: 'Both side tentacles rear up beside the head, then whip down into the ground (marker `slam`) with a squash and a shake.',
  markers: { windup: 0.6, slam: 1.0, recover: 1.6 },
  tracks: {
    ...raise('tent_M', K([0, 0], [0.6, -128, 'out'], [1.0, 52, 'snap'], [1.35, 40], [1.7, 10], [2.3, 0])),
    ...pair('tent_M', K([0, 0], [0.6, -120, 'out'], [1.0, -70, 'snap'], [1.35, -40], [1.7, -10], [2.3, 0])),
    ...raise('tent_F', K([0, 0], [0.6, -30, 'out'], [1.0, 20, 'snap'], [1.7, 4], [2.3, 0])),
    ...pair('tent_F', K([0, 0], [0.6, -30, 'out'], [1.0, 50, 'snap'], [1.7, 10], [2.3, 0])),
    'pos:body': K([0, { x: 0, y: 0 }], [0.6, { x: 0, y: -40 }, 'out'], [1.0, { x: 0, y: 26 }, 'snap'], [1.3, { x: 0, y: 10 }], [2.3, { x: 0, y: 0 }]),
    'pos:root': K([1.0, { x: 0, y: 0 }], [1.05, { x: -7, y: 0 }, 'step'], [1.1, { x: 6, y: 0 }, 'step'], [1.15, { x: -4, y: 0 }, 'step'], [1.2, { x: 3, y: 0 }, 'step'], [1.25, { x: 0, y: 0 }, 'step']),
    'scale:root': K([0, { x: 1, y: 1 }], [0.6, { x: 0.95, y: 1.08 }], [1.0, { x: 1.14, y: 0.88 }, 'snap'], [1.5, { x: 1, y: 1 }, 'back']),
    'head': K([0, 0], [0.6, 0], [1.0, 0]),
    'ch:brow': K([0, 0.45], [0.5, 1], [1.8, 1], [2.3, 0.45]),
    'ch:mouth': K([0, 0], [0.6, 0.3], [1.0, 0.9, 'snap'], [1.6, 0.6], [2.3, 0]),
    'ch:eyeHeat': K([0, 0], [0.6, 0.5], [1.0, 1, 'snap'], [1.8, 0.4], [2.3, 0]),
    'ch:glow': K([0, 0.8], [1.0, 1.4, 'snap'], [2.3, 0.8]),
    'ch:visorFlash': K([0, 0], [0.98, 0], [1.0, 0.7, 'snap'], [1.2, 0]),
    'ch:squint': K([0, 0], [1.0, 0.5, 'snap'], [1.5, 0]),
    ...raise('tent_U', K([0, 0], [0.6, -24], [1.0, 8, 'snap'], [2.3, 0])),
    ...raise('tent_B', K([0, 0], [0.6, -10], [1.0, 10, 'snap'], [2.3, 0])),
    'ch:midOverHead': K(step(0, 1), step(0.22, 0), step(0.93, 1)),
    'ch:tentFollow': K([0, 1.3]),
  },
};

export const grab = {
  name: 'grab', duration: 3.2, loop: false,
  description: 'The front-left tentacle reaches out (CCD IK), wraps around an object at (190,-40), lifts it to the visor, then puts it back.',
  markers: { reach: 1.0, wrap: 1.4, lift: 2.0, release: 2.7 },
  tracks: {
    'ik:tent_FL': K([0, { ...REST_TIP_FL, curl: 0 }], [0.2, { ...REST_TIP_FL, curl: 0 }], [1.0, { x: 196, y: -46, curl: 0 }, 'out'], [1.4, { x: 182, y: -50, curl: 150 }],
      [2.0, { x: 80, y: -280, curl: 150 }, 'back'], [2.4, { x: 80, y: -280, curl: 150 }], [2.7, { x: 190, y: -46, curl: 30 }, 'in'], [3.2, { ...REST_TIP_FL, curl: 0 }]),
    'head': K([0, 0], [1.0, 6], [1.4, 6], [2.0, -4], [2.4, -4], [2.7, 4], [3.2, 0]),
    'ch:pupil_x': K([0, 0], [0.6, 1], [1.4, 1], [2.0, 0.2], [2.4, 0.2], [2.7, 1], [3.2, 0]),
    'ch:pupil_y': K([0, 0], [0.6, 0.9], [1.4, 0.9], [2.0, -0.2], [2.4, -0.2], [2.7, 0.9], [3.2, 0]),
    'ch:brow': K([0, 0.45], [1.0, 0.2], [2.0, -0.3], [2.4, -0.3], [3.2, 0.45]),
    'ch:mouth': K([0, 0], [2.0, 0.4], [2.4, 0.4], [2.8, 0]),
    'pos:body': K([0, { x: 0, y: 0 }], [1.0, { x: 18, y: 10 }], [1.4, { x: 18, y: 10 }], [2.0, { x: 0, y: -8 }], [2.4, { x: 0, y: -8 }], [3.2, { x: 0, y: 0 }]),
    'tent:tent_FR': K([0, 0], [1.0, -30], [2.0, -16], [3.2, 0]),
  },
};

export const jump = {
  name: 'jump', duration: 1.8, loop: false,
  description: 'Tentacles coil for the launch, the body stretches upward, tentacles trail, then a heavy squash landing.',
  markers: { takeoff: 0.45, apex: 0.85, land: 1.2 },
  tracks: {
    'pos:body': K([0, { x: 0, y: 0 }], [0.35, { x: 0, y: 30 }, 'out'], [0.45, { x: 0, y: -10 }, 'snap'], [1.2, { x: 0, y: 28 }, 'snap'], [1.6, { x: 0, y: 0 }, 'back']),
    'pos:root': K([0, { x: 0, y: 0 }], [0.45, { x: 0, y: 0 }], [0.85, { x: 0, y: -210 }, 'outQuad'], [1.2, { x: 0, y: 0 }, 'inQuad']),
    'scale:root': K([0, { x: 1, y: 1 }], [0.35, { x: 1.1, y: 0.9 }], [0.5, { x: 0.9, y: 1.14 }, 'snap'], [0.85, { x: 1, y: 1 }], [1.2, { x: 1.16, y: 0.86 }, 'snap'], [1.6, { x: 1, y: 1 }, 'back']),
    ...raise('tent_F', K([0, 0], [0.35, -30], [0.55, 24, 'snap'], [0.95, 20], [1.2, -34, 'snap'], [1.8, 0])),
    ...pair('tent_F', K([0, 0], [0.35, -50], [0.55, 30, 'snap'], [0.95, 30], [1.2, -50, 'snap'], [1.8, 0])),
    ...raise('tent_M', K([0, 0], [0.35, -20], [0.55, 40, 'snap'], [0.95, 36], [1.2, -24, 'snap'], [1.8, 0])),
    ...pair('tent_M', K([0, 0], [0.35, -50], [0.55, 20, 'snap'], [0.95, 20], [1.2, -50, 'snap'], [1.8, 0])),
    ...raise('tent_U', K([0, 0], [0.35, 10], [0.55, 70, 'snap'], [0.95, 60], [1.2, 10, 'snap'], [1.8, 0])),
    ...pair('tent_U', K([0, 0], [0.35, 50], [0.55, 70, 'snap'], [0.95, 60], [1.2, 50, 'snap'], [1.8, 0])),
    ...raise('tent_B', K([0, 0], [0.35, -10], [0.55, 30, 'snap'], [0.95, 26], [1.2, -14, 'snap'], [1.8, 0])),
    'ch:brow': K([0, 0.45], [0.35, 0.8], [0.55, -0.6], [1.1, -0.6], [1.2, 0.9, 'snap'], [1.8, 0.45]),
    'ch:mouth': K([0, 0], [0.5, 0.7], [1.1, 0.7], [1.2, 0.2], [1.8, 0]),
    'ch:squint': K([0, 0], [0.35, 0.6], [0.55, 0], [1.2, 0.7, 'snap'], [1.6, 0]),
    'ch:glow': K([0, 0.8], [0.5, 1.3, 'snap'], [1.2, 0.8]),
    'ch:tentFollow': K([0, 1.2]),
  },
};

export const celebrate = {
  name: 'celebrate', duration: 3.0, loop: false, ripple: { amp: 0, cycles: 3, linkPhase: 0.9, stagger: 0.5 },
  description: 'Victory bounce: upper tentacles pump, front tentacles clap, lights blaze, pods spin.',
  markers: { pump: 0.5, pump2: 1.1 },
  tracks: {
    'pos:root': K([0, { x: 0, y: 0 }], [0.3, { x: 0, y: 0 }], [0.5, { x: 0, y: -40 }, 'outQuad'], [0.7, { x: 0, y: 0 }, 'inQuad'], [0.9, { x: 0, y: 0 }], [1.1, { x: 0, y: -40 }, 'outQuad'], [1.3, { x: 0, y: 0 }, 'inQuad'], [1.5, { x: 0, y: 0 }], [1.7, { x: 0, y: -28 }, 'outQuad'], [1.9, { x: 0, y: 0 }, 'inQuad']),
    'scale:root': K([0, { x: 1, y: 1 }], [0.3, { x: 1.08, y: 0.93 }], [0.5, { x: 0.94, y: 1.08 }, 'snap'], [0.7, { x: 1.08, y: 0.93 }], [0.9, { x: 1, y: 1 }], [1.1, { x: 0.94, y: 1.08 }, 'snap'], [1.3, { x: 1.08, y: 0.93 }], [1.6, { x: 1, y: 1 }]),
    ...raise('tent_U', K([0, 0], [0.5, -56, 'back'], [0.8, -30], [1.1, -60, 'back'], [1.4, -30], [1.7, -54, 'back'], [2.3, -44], [3.0, 0])),
    ...pair('tent_U', K([0, 0], [0.5, -40, 'back'], [0.8, -20], [1.1, -44, 'back'], [1.4, -20], [1.7, -40, 'back'], [2.3, -30], [3.0, 0])),
    ...raise('tent_F', K([0, 0], [0.5, -40], [0.8, -10], [1.1, -40], [1.4, -10], [1.7, -36], [2.3, -12], [3.0, 0])),
    ...pair('tent_F', K([0, 0], [0.5, 50], [0.8, -10], [1.1, 50], [1.4, -10], [1.7, 44], [2.3, 16], [3.0, 0])),
    ...raise('tent_M', K([0, 0], [0.5, -20], [1.1, -20], [2.3, -12], [3.0, 0])),
    'ch:brow': K([0, 0.45], [0.4, -0.6], [2.4, -0.6], [3.0, 0.45]),
    'ch:mouth': K([0, 0], [0.4, 0.9], [2.3, 0.7], [2.9, 0]),
    'ch:squint': K([0, 0], [0.5, 0.6], [2.4, 0.6], [2.9, 0]),
    'ch:glow': K([0, 0.8], [0.5, 1.4, 'snap'], [2.4, 1.3], [3.0, 0.8]),
    'ch:eyeHeat': K([0, 0], [0.5, 0.6], [2.4, 0.6], [3.0, 0]),
    'ch:podSpin': K([0, 0], [3.0, 4, 'linear']),
    'ch:ripple': K([0, 0], [0.4, 8], [2.4, 8], [3.0, 0]),
    'head': K([0, 0], [0.5, -6], [0.8, 4], [1.1, -6], [1.4, 4], [1.7, -4], [2.3, 0]),
  },
};

export const hurt = {
  name: 'hurt', duration: 2.2, loop: false,
  description: 'Takes a hit: visor flash, knocked sideways, lights flicker, tentacles go limp, then reboots.',
  markers: { hit: 0.05, reboot: 1.5 },
  tracks: {
    'ch:visorFlash': K([0, 0], [0.05, 1, 'snap'], [0.3, 0, 'out']),
    'pos:body': K([0, { x: 0, y: 0 }], [0.15, { x: -34, y: 16 }, 'snap'], [0.45, { x: 18, y: 6 }], [0.75, { x: -10, y: 10 }], [1.05, { x: 4, y: 12 }], [1.5, { x: 0, y: 12 }], [2.2, { x: 0, y: 0 }]),
    'head': K([0, 0], [0.15, -14, 'snap'], [0.45, 8], [0.75, -5], [1.05, 2], [1.5, 0]),
    'ch:glow': K([0, 0.8], step(0.1, 0.1), step(0.2, 0.9), step(0.3, 0.15), step(0.45, 0.8), step(0.6, 0.2), step(0.9, 0.5), step(1.2, 0.1), [1.5, 0.1], [1.8, 1.1, 'snap'], [2.2, 0.8]),
    'ch:brow': K([0, 0.45], [0.15, -0.8, 'snap'], [1.5, -0.8], [1.8, 0.9, 'snap'], [2.2, 0.45]),
    'ch:pupilSize': K([0, 1], [0.15, 0.5, 'snap'], [1.5, 0.5], [1.8, 1.2, 'snap'], [2.2, 1]),
    'ch:pupil_y': K([0, 0], [0.4, 0.6], [1.5, 0.8], [1.8, 0]),
    'ch:blink_L': K([0, 0], [1.1, 0], [1.3, 1], [1.5, 1], [1.8, 0, 'snap']),
    'ch:blink_R': K([0, 0], [1.2, 0], [1.4, 1], [1.5, 1], [1.8, 0, 'snap']),
    'ch:mouth': K([0, 0], [0.15, 0.6, 'snap'], [1.5, 0.3], [2.2, 0]),
    ...raise('tent_U', K([0, 0], [0.3, 40], [1.5, 60], [1.9, -8, 'back'], [2.2, 0])),
    ...pair('tent_U', K([0, 0], [0.3, 40], [1.5, 60], [1.9, -8, 'back'], [2.2, 0])),
    ...raise('tent_M', K([0, 0], [0.3, 20], [1.5, 34], [1.9, -4, 'back'], [2.2, 0])),
    ...pair('tent_M', K([0, 0], [0.3, 30], [1.5, 40], [1.9, -6, 'back'], [2.2, 0])),
    ...pair('tent_F', K([0, 0], [0.3, -24], [1.5, -30], [1.9, 6, 'back'], [2.2, 0])),
    'ch:tentFollow': K([0, 1.5]),
  },
};

export const crawl = {
  name: 'crawl', duration: 1.0, loop: true, inPlace: true, ripple: { amp: 4, cycles: 1, linkPhase: 1.1, stagger: 0.8 },
  description: 'In-place crawl: mid and back tentacles push alternately while the body heaves up and down.',
  tracks: {
    'pos:body': K([0, { x: 0, y: 0 }], [0.25, { x: 6, y: -16 }], [0.5, { x: 0, y: 0 }], [0.75, { x: -6, y: -16 }]),
    'head': K([0, 0], [0.25, 3], [0.5, 0], [0.75, -3]),
    'tent_ML_01': K([0, 14], [0.5, -14], [1.0, 14]), 'tent_MR_01': K([0, 14], [0.5, -14], [1.0, 14]),
    'tent:tent_ML': K([0, 36], [0.5, -36], [1.0, 36]), 'tent:tent_MR': K([0, 36], [0.5, -36], [1.0, 36]),
    'tent_BL_01': K([0, -12], [0.5, 12], [1.0, -12]), 'tent_BR_01': K([0, -12], [0.5, 12], [1.0, -12]),
    'tent:tent_BL': K([0, -30], [0.5, 30], [1.0, -30]), 'tent:tent_BR': K([0, -30], [0.5, 30], [1.0, -30]),
    'tent:tent_FL': K([0, -20], [0.5, 30], [1.0, -20]), 'tent:tent_FR': K([0, 30], [0.5, -20], [1.0, 30]),
    'tent:tent_UL': K([0, -16], [0.5, 16], [1.0, -16]), 'tent:tent_UR': K([0, 16], [0.5, -16], [1.0, 16]),
    'ch:pupil_x': K([0, 0.3]), 'ch:brow': K([0, 0.6]),
  },
};

export const charge = {
  name: 'charge', duration: 2.6, loop: false,
  description: 'Power-up: crest plate pops, eyes heat to white, pods spin faster and faster, tentacles pull back, then a discharge flash (marker `fire`).',
  markers: { fire: 1.9 },
  tracks: {
    'pos:crest': K([0, { x: 0, y: 0 }], [0.5, { x: 0, y: -34 }, 'back'], [2.1, { x: 0, y: -34 }], [2.6, { x: 0, y: 0 }]),
    'ch:eyeHeat': K([0, 0], [1.9, 1, 'in'], [2.2, 1], [2.6, 0]),
    'ch:glow': K([0, 0.8], [1.9, 1.6, 'in'], [2.2, 1.6], [2.6, 0.8]),
    'ch:podSpin': K([0, 0], [1.9, 6, 'in'], [2.6, 7]),
    'ch:brow': K([0, 0.45], [0.6, 0.9], [2.1, 1], [2.6, 0.45]),
    'ch:squint': K([0, 0], [1.6, 0.5], [1.9, 0, 'snap'], [2.6, 0]),
    'ch:mouth': K([0, 0], [1.6, 0.2], [1.9, 1, 'snap'], [2.3, 0.3], [2.6, 0]),
    'ch:visorFlash': K([0, 0], [1.85, 0], [1.9, 1, 'snap'], [2.25, 0, 'out']),
    'scale:root': K([0, { x: 1, y: 1 }], [1.8, { x: 0.94, y: 1.06 }], [1.9, { x: 1.12, y: 0.9 }, 'snap'], [2.4, { x: 1, y: 1 }, 'back']),
    'pos:body': K([0, { x: 0, y: 0 }], [1.8, { x: 0, y: 16 }], [1.9, { x: 0, y: -24 }, 'snap'], [2.6, { x: 0, y: 0 }]),
    ...raise('tent_F', K([0, 0], [1.8, 30, 'in'], [1.9, -34, 'snap'], [2.6, 0])),
    ...pair('tent_F', K([0, 0], [1.8, 60, 'in'], [1.9, -40, 'snap'], [2.6, 0])),
    ...raise('tent_M', K([0, 0], [1.8, 24, 'in'], [1.9, -30, 'snap'], [2.6, 0])),
    ...pair('tent_M', K([0, 0], [1.8, 40, 'in'], [1.9, -40, 'snap'], [2.6, 0])),
    ...raise('tent_U', K([0, 0], [1.8, 30, 'in'], [1.9, -30, 'snap'], [2.6, 0])),
    ...pair('tent_U', K([0, 0], [1.8, -40, 'in'], [1.9, 60, 'snap'], [2.6, 0])),
    ...raise('tent_B', K([0, 0], [1.8, 16, 'in'], [1.9, -24, 'snap'], [2.6, 0])),
  },
};

export const CLIPS = { idle, hover, wave, taunt, slam, grab, jump, celebrate, hurt, crawl, charge };
export const CLIP_LIST = Object.keys(CLIPS);
