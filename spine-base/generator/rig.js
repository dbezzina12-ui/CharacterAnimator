// Base 2D character rig for Spine 4.2 — human and dwarf on one bone/slot/constraint/animation naming.
// Three-quarter view facing +x. Spine conventions: y up, rotation CCW in degrees, bone local +x along the bone.
// Everything is authored in WORLD setup-pose coordinates (joints table) and converted to local bone values,
// so proportions are data: change a joint, rebuild, and pieces, grips and animations follow.

const D2R = Math.PI / 180;
const r2 = (v) => Math.round(v * 100) / 100;
const hyp = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const norm = (d) => { while (d > 180) d -= 360; while (d <= -180) d += 360; return d; };

/** Proportion presets. Every value except height is a ratio, so height alone scales the whole character.
 *  head: head height / height · headWidth: head width / head height · legs: hip height / height · arms: shoulder-to-wrist / height
 *  shoulders: shoulder joint span / height · build: limb and trunk thickness (1 = average adult) · hands: fist length / height
 *  stance: half the distance between the ankles / height
 *  cape: 'none' | 'back' (hangs down the back) | 'wrap' (vampire cape: high collar, mantle over the shoulders, front panels) */
export const PRESETS = {
  human: { name: 'Human', height: 722, head: 0.172, headWidth: 0.8, legs: 0.5235, arms: 0.313, shoulders: 0.14, build: 1, hands: 0.061, stance: 0.061, cape: 'none' },
  dwarf: { name: 'Dwarf', height: 468, head: 0.3, headWidth: 0.94, legs: 0.3675, arms: 0.327, shoulders: 0.245, build: 1.9, hands: 0.107, stance: 0.09, cape: 'none' },
};
export const LIMITS = {
  height: [300, 1000, 1], head: [0.12, 0.36, 0.002], headWidth: [0.65, 1.1, 0.01], legs: [0.3, 0.58, 0.0025], arms: [0.24, 0.4, 0.001],
  shoulders: [0.1, 0.3, 0.001], build: [0.7, 2.4, 0.01], hands: [0.045, 0.13, 0.001], stance: [0.03, 0.14, 0.001],
};
const clampTo = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const pascal = (s) => String(s).replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('') || 'Character';

/** Turn a handful of proportion ratios into the full joint table the rig is built from. */
export function proportions(params = {}) {
  const base = PRESETS[String(params.preset || '').toLowerCase()] || PRESETS.human; const q = { ...base, ...params };
  for (const k of Object.keys(LIMITS)) q[k] = clampTo(Number.isFinite(+q[k]) ? +q[k] : base[k], LIMITS[k]);
  q.cape = q.cape === true ? 'back' : q.cape === 'back' || q.cape === 'wrap' ? q.cape : 'none'; q.name = String(q.name || 'Character').slice(0, 40);
  const H = q.height, s = H / 722, bs = q.build * s, e = Math.min(0.5, Math.max(-0.15, (q.build - 1) * 0.31));
  const pol = (o, deg, len) => [o[0] + Math.cos(deg * D2R) * len, o[1] + Math.sin(deg * D2R) * len];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const headH = q.head * H, hipY = q.legs * H, neckY = H - headH * 0.985, T = neckY - hipY;
  const hip = [0, hipY], waist = [0.02 * T, hipY + 0.336 * T], neck = [0.075 * T, neckY], headTop = [neck[0] + 0.08 * headH, H];
  const span = q.shoulders * H, drop = 0.11 * T + 4 * bs;
  const shoulderN = [neck[0] - 0.62 * span, neckY - drop], shoulderF = [neck[0] + 0.38 * span, neckY - drop + 4 * s];
  const A = q.arms * H;
  const elbowN = pol(shoulderN, -97 - 16 * e, 0.525 * A), wristN = pol(elbowN, -82 + 5 * e, 0.475 * A);
  const elbowF = pol(shoulderF, -85 + 19 * e, 0.525 * A), wristF = pol(elbowF, -79 + 13 * e, 0.475 * A);
  const handLen = q.hands * H, foot = 0.9 * handLen + 0.055 * H, ankleY = 0.028 * H + 0.3 * foot;
  const legLen = hipY - ankleY, thighLen = legLen * 0.5;
  const thighR = Math.min(26 * bs, 0.45 * thighLen), kneeR = Math.min(21 * bs, thighR * 0.86, 0.38 * thighLen), ankleR = Math.min(14.5 * bs, kneeR * 0.84);
  const chestHalf = 0.5 * span, waistHalf = span * (0.335 + 0.085 * q.build), hipHalf = Math.max(0.47 * span * (0.92 + 0.08 * q.build), thighR * 1.55);
  const hipN = [-(hipHalf - thighR), hipY - 6 * s], hipF = [hipHalf - thighR + 4 * s, hipY - 4 * s];
  const back = 0.028 * H;   // the feet sit a little behind the hips' ground point so the weight reads as centred, not leaning back
  const ankleN = [-q.stance * H - back, ankleY], ankleF = [q.stance * H + 6 * s - back, ankleY + 2 * s];
  const mN = mid(hipN, ankleN), mF = mid(hipF, ankleF);
  const kneeN = [mN[0] + 0.07 * legLen, mN[1] - 0.006 * legLen], kneeF = [mF[0] + 0.04 * legLen, mF[1]];
  const toeN = [ankleN[0] + foot, 8 * s], toeF = [ankleF[0] + foot * 0.95, 10 * s];
  const r1 = (p) => p.map((v) => Math.round(v * 10) / 10);
  const J = Object.fromEntries(Object.entries({ hip, waist, neck, headTop, shoulderN, elbowN, wristN, shoulderF, elbowF, wristF, hipN, kneeN, ankleN, toeN, hipF, kneeF, ankleF, toeF }).map(([k, v]) => [k, r1(v)]));
  const id = String(q.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';
  return {
    id, file: params.file || (PRESETS[id] ? 'Base-' + pascal(q.name) : pascal(q.name)), height: H, cape: q.cape === 'none' ? '' : q.cape, params: q, J,
    hand: { len: r2(handLen), w: r2(0.92 * handLen), grip: r2(0.545 * handLen) },
    limb: { upperArm: [38 * bs, 32 * bs].map(r2), forearm: [32 * bs, 25 * bs].map(r2), thigh: [2 * thighR, 2 * kneeR].map(r2), shin: [2 * kneeR, 2 * ankleR].map(r2) },
    torso: { chestHalf: r2(chestHalf), waistHalf: r2(waistHalf), hipHalf: r2(hipHalf), neckW: r2(32 * bs) },
    head: { w: r2(q.headWidth * headH), h: r2(headH) },
  };
}
export const HUMAN = proportions(PRESETS.human);
export const DWARF = proportions(PRESETS.dwarf);

// ---- curves: CSS-style cubic bezier per segment -> Spine absolute control points
const EASE = { ease: [0.4, 0, 0.6, 1], in: [0.5, 0, 0.9, 0.55], out: [0.1, 0.5, 0.4, 1], snap: [0.05, 0.75, 0.25, 1], soft: [0.3, 0, 0.7, 1] };
function curveFor(t0, v0, t1, v1, ease) {
  const e = EASE[ease]; const dt = t1 - t0, dv = v1 - v0;
  return [r2(t0 + e[0] * dt), r2(v0 + e[1] * dv), r2(t0 + e[2] * dt), r2(v0 + e[3] * dv)];
}
/** rotate timeline: keys [[t, value, ease?]] (ease describes the segment AFTER the key; default 'ease') */
function rot(keys) {
  return keys.map(([t, v, ease = 'ease'], i) => {
    const k = { time: r2(t), value: r2(v) }; const n = keys[i + 1];
    if (n && ease === 'step') k.curve = 'stepped'; else if (n && ease !== 'linear') k.curve = curveFor(t, v, n[0], n[1], ease);
    return k;
  });
}
/** translate timeline: keys [[t, x, y, ease?]] */
function tr(keys) {
  return keys.map(([t, x, y, ease = 'ease'], i) => {
    const k = { time: r2(t), x: r2(x), y: r2(y) }; const n = keys[i + 1];
    if (n && ease === 'step') k.curve = 'stepped'; else if (n && ease !== 'linear') k.curve = [...curveFor(t, x, n[0], n[1], ease), ...curveFor(t, y, n[0], n[2], ease)];
    return k;
  });
}
const ikMix = (keys) => keys.map(([t, mix]) => ({ time: r2(t), mix: r2(mix) }));
const rotMix = (keys) => keys.map(([t, m]) => ({ time: r2(t), mixRotate: r2(m), mixX: 0, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 }));

export function buildRig(P) {
  const J = P.J; const bones = []; const world = {};
  function bone(name, parent, from, to, opt = {}) {
    const rotW = to ? Math.atan2(to[1] - from[1], to[0] - from[0]) / D2R : (opt.rot ?? 0);
    const len = to ? hyp(from, to) : (opt.length ?? 0);
    const p = parent ? world[parent] : { x: 0, y: 0, rot: 0 };
    const dx = from[0] - p.x, dy = from[1] - p.y, c = Math.cos(-p.rot * D2R), s = Math.sin(-p.rot * D2R);
    const b = { name }; if (parent) b.parent = parent;
    const lx = dx * c - dy * s, ly = dx * s + dy * c, lr = norm(rotW - p.rot);
    if (Math.abs(lx) > 1e-6) b.x = r2(lx); if (Math.abs(ly) > 1e-6) b.y = r2(ly); if (Math.abs(lr) > 1e-6) b.rotation = r2(lr);
    if (len) b.length = r2(len); if (opt.color) b.color = opt.color;
    bones.push(b); world[name] = { x: from[0], y: from[1], rot: rotW, len };
  }
  const along = (a, b, d) => { const L = hyp(a, b); return [a[0] + (b[0] - a[0]) / L * d, a[1] + (b[1] - a[1]) / L * d]; };
  const handTip = (elbow, wrist, lean) => { const d = [wrist[0] - elbow[0], wrist[1] - elbow[1]]; const L = Math.hypot(...d); const a = Math.atan2(d[1], d[0]) + lean * D2R; void L; return [wrist[0] + Math.cos(a) * P.hand.len, wrist[1] + Math.sin(a) * P.hand.len]; };
  J.handTipN = handTip(J.elbowN, J.wristN, 6); J.handTipF = handTip(J.elbowF, J.wristF, 4);

  // ---- body
  bone('root', null, [0, 0]);
  bone('hip', 'root', J.hip, null, { color: 'ffd23fff' });
  bone('waist', 'hip', J.hip, J.waist);
  bone('chest', 'waist', J.waist, J.neck);
  bone('head', 'chest', J.neck, J.headTop);
  for (const [s, S] of [['near', 'N'], ['far', 'F']]) {
    bone(`upper-${s}`, 'chest', J['shoulder' + S], J['elbow' + S]);
    bone(`forearm-${s}`, `upper-${s}`, J['elbow' + S], J['wrist' + S]);
    bone(`hand-${s}`, `forearm-${s}`, J['wrist' + S], J['handTip' + S]);
  }
  for (const [s, S] of [['near', 'N'], ['far', 'F']]) {
    bone(`thigh-${s}`, 'hip', J['hip' + S], J['knee' + S]);
    bone(`shin-${s}`, `thigh-${s}`, J['knee' + S], J['ankle' + S]);
    bone(`foot-${s}`, `shin-${s}`, J['ankle' + S], J['toe' + S]);
  }
  // foot controllers: move these to step or jump; the legs follow (IK) and the feet keep their angle
  for (const [s, S] of [['near', 'N'], ['far', 'F']]) bone(`foot-${s}-target`, 'root', J['ankle' + S], null, { rot: world[`foot-${s}`].rot, length: 24, color: 'ff3f3fff' });

  // ---- weapons: free bones with grip targets. A grip target is where the WRIST goes; its rotation is the hand's.
  // Convention: hand local +x = toward the knuckles, +y = the grip axis (the shaft runs along it), grip point = hand.grip px from the wrist.
  const RN = hyp(J.shoulderN, J.elbowN) + hyp(J.elbowN, J.wristN), RF = hyp(J.shoulderF, J.elbowF) + hyp(J.elbowF, J.wristF);
  const g = P.hand.grip;
  // the staff stands just behind the far toe, pulled in when the arms are too short to reach it there with either hand
  const staff = { x: Math.min(J.toeF[0] - 20, J.shoulderF[0] + g + 0.55 * RF, J.shoulderN[0] + g + 0.72 * RN), gripY: J.shoulderF[1] - 0.72 * RF, nearUp: 0.26 * RN, lift: 0.33 * RF, top: 1.07 * P.height };
  bone('staff', 'root', [staff.x, staff.gripY], null, { length: 60, rot: 90, color: '3fd0ffff' });   // +x up the shaft
  // staff bone points UP the shaft, so its local frame is rotated 90°: hand +y (grip axis) = staff +x. The grip targets undo that.
  bone('staff-grip-far', 'staff', [staff.x - g, staff.gripY], null, { rot: 0, length: 14, color: '3fd0ffff' });
  bone('staff-grip-near', 'staff', [staff.x - g, staff.gripY + staff.nearUp], null, { rot: 0, length: 14, color: '3fd0ffff' });
  bone('staff-foot', 'staff', [staff.x, 0], null, { rot: 0, color: '3fd0ffff' });
  bone('staff-head', 'staff', [staff.x, staff.top - 30], null, { rot: 0, color: '3fd0ffff' });
  const gunRest = { wrist: [J.shoulderN[0] + 0.52 * RN, J.shoulderN[1] - 0.66 * RN], rot: -32 };
  const gunAim = { wrist: [J.shoulderN[0] + 0.86 * RN, J.shoulderN[1] - 0.06 * RN], rot: 0 };
  const gripOf = (w) => [w.wrist[0] + Math.cos(w.rot * D2R) * g, w.wrist[1] + Math.sin(w.rot * D2R) * g];
  const k = P.hand.len / 44;   // gun size follows the hand
  bone('gun', 'hip', gripOf(gunRest), null, { rot: gunRest.rot, length: 50, color: 'ff9f3fff' });      // +x along the barrel, origin = grip point
  bone('gun-grip-near', 'gun', gunRest.wrist, null, { rot: gunRest.rot, length: 14, color: 'ff9f3fff' });
  { const a = gunRest.rot * D2R, o = gripOf(gunRest), mx = 74 * k, my = 20 * k; bone('gun-muzzle', 'gun', [o[0] + Math.cos(a) * mx - Math.sin(a) * my, o[1] + Math.sin(a) * mx + Math.cos(a) * my], null, { rot: gunRest.rot, color: 'ff9f3fff' }); }

  // ---- cape: bone chains hanging from the chest. Each cape image is a mesh weighted across its chain; physics makes it sway.
  // 'back' uses only the back chain. 'wrap' (vampire cape) is longer and adds a panel over each shoulder; its collar and mantle are rigid on the chest.
  const wrap = P.cape === 'wrap', T = J.neck[1] - J.hip[1], rs = P.limb.upperArm[0] / 2 + 1.5;
  const chain = (prefix, top, end, n) => { const pt = (i) => [top[0] + (end[0] - top[0]) * i / n, top[1] + (end[1] - top[1]) * i / n]; const names = [];
    for (let i = 0; i < n; i++) { names.push(`${prefix}-${i + 1}`); bone(names[i], i ? names[i - 1] : 'chest', pt(i), pt(i + 1), { color: 'c77dffff' }); } return { top, end, bones: names }; };
  const capeTop = [J.neck[0] - 0.3 * (J.neck[0] - J.shoulderN[0]), J.neck[1] - 0.05 * T];
  const capeEndY = J.ankleN[1] + (wrap ? 0.12 : 0.4) * (J.kneeN[1] - J.ankleN[1]);
  const cape = chain('cape', capeTop, [capeTop[0] - (wrap ? 0.06 : 0.1) * (capeTop[1] - capeEndY), capeEndY], 4);
  const panelY = J.kneeN[1] - 0.35 * (J.kneeN[1] - J.ankleN[1]);
  const nTop = [J.shoulderN[0] - rs * 0.1, J.shoulderN[1] + rs * 0.9], fTop = [J.shoulderF[0] + rs * 0.3, J.shoulderF[1] + rs * 0.8];
  const capeNear = chain('cape-near', nTop, [nTop[0] - 0.05 * (nTop[1] - panelY), panelY], 3);
  const capeFar = chain('cape-far', fTop, [fTop[0] + 0.05 * (fTop[1] - panelY), panelY], 3);

  // ---- slots, back to front
  const slots = [
    ['cape', 'cape-1', P.cape ? 'cape' : null], ['cape-collar', 'chest', wrap ? 'cape-collar' : null],
    ['upper-far', 'upper-far'], ['cape-far', 'cape-far-1', wrap ? 'cape-far' : null], ['forearm-far', 'forearm-far'], ['hand-far-back', 'hand-far'], ['weapon-far', 'staff', 'staff'], ['hand-far-front', 'hand-far'],
    ['thigh-far', 'thigh-far'], ['shin-far', 'shin-far'], ['foot-far', 'foot-far'], ['pelvis', 'hip'],
    ['thigh-near', 'thigh-near'], ['shin-near', 'shin-near'], ['foot-near', 'foot-near'], ['torso', 'chest'], ['cape-mantle', 'chest', wrap ? 'cape-mantle' : null], ['head', 'head'], ['eyelids', 'head', null],
    ['upper-near', 'upper-near'], ['cape-near', 'cape-near-1', wrap ? 'cape-near' : null], ['forearm-near', 'forearm-near'], ['weapon-near', 'gun', 'gun'], ['muzzle-flash', 'gun-muzzle', null, 'additive'], ['hand-near', 'hand-near'],
  ].map(([name, b, att, blend]) => { const s = { name, bone: b }; if (att !== null) s.attachment = att === undefined ? name : att; if (blend) s.blend = blend; return s; });

  // ---- constraints. `order` is global and unique; skin constraints only run while their skin is active.
  const T0 = { mixX: 0, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 };
  const ik = [
    { name: 'leg-near-ik', order: 0, bones: ['thigh-near', 'shin-near'], target: 'foot-near-target', bendPositive: false, stretch: true },
    { name: 'leg-far-ik', order: 1, bones: ['thigh-far', 'shin-far'], target: 'foot-far-target', bendPositive: false, stretch: true },
    { name: 'staff/far-arm-ik', order: 4, skin: true, bones: ['upper-far', 'forearm-far'], target: 'staff-grip-far', bendPositive: true },
    { name: 'staff/near-arm-ik', order: 6, skin: true, bones: ['upper-near', 'forearm-near'], target: 'staff-grip-near', bendPositive: true, mix: 0 },
    { name: 'gun/near-arm-ik', order: 8, skin: true, bones: ['upper-near', 'forearm-near'], target: 'gun-grip-near', bendPositive: true },
  ];
  const transform = [
    { name: 'foot-near-rot', order: 2, bones: ['foot-near'], target: 'foot-near-target', mixRotate: 1, ...T0 },
    { name: 'foot-far-rot', order: 3, bones: ['foot-far'], target: 'foot-far-target', mixRotate: 1, ...T0 },
    { name: 'staff/far-hand-rot', order: 5, skin: true, bones: ['hand-far'], target: 'staff-grip-far', mixRotate: 1, ...T0 },
    { name: 'staff/near-hand-rot', order: 7, skin: true, bones: ['hand-near'], target: 'staff-grip-near', mixRotate: 0, ...T0 },
    { name: 'gun/near-hand-rot', order: 9, skin: true, bones: ['hand-near'], target: 'gun-grip-near', mixRotate: 1, ...T0 },
  ];

  // Spine 4.2 physics: each cape bone lags behind the body, swings past and settles; lower bones are looser and heavier under gravity.
  // The shoulder panels are draped over the arms, so they are a little stiffer than the free-hanging back.
  let order = 10; const phys = (bone2, o) => ({ name: bone2.replace(/-(\d)$/, '/$1'), order: order++, bone: bone2, rotate: 1, mass: 1, wind: 0, mix: 1, ...o });
  const physics = [
    phys('cape-1', { inertia: 0.45, strength: 70, damping: 0.55, gravity: 8 }),
    phys('cape-2', { inertia: 0.6, strength: 50, damping: 0.45, gravity: 16 }),
    phys('cape-3', { inertia: 0.75, strength: 36, damping: 0.4, gravity: 24, mass: 0.8 }),
    phys('cape-4', { inertia: 0.85, strength: 28, damping: 0.35, gravity: 30, mass: 0.6 }),
    ...['cape-near', 'cape-far'].flatMap((p) => [
      phys(`${p}-1`, { inertia: 0.35, strength: 90, damping: 0.6, gravity: 6 }),
      phys(`${p}-2`, { inertia: 0.55, strength: 56, damping: 0.5, gravity: 16 }),
      phys(`${p}-3`, { inertia: 0.75, strength: 36, damping: 0.42, gravity: 26, mass: 0.7 }),
    ]),
  ];

  // ---- animations (values are offsets from the setup pose). u scales body moves with the character's size.
  // body moves scale with LEG length (a short-legged character crouches less in absolute terms), reach moves with arm length
  const u = (J.hip[1] - J.ankleN[1]) / 334; const L = staff.lift;
  const breathe = (d = 2) => ({
    hip: { translate: tr([[0, 0, 0], [d / 2, 0, -3 * u], [d, 0, 0]]) },
    chest: { rotate: rot([[0, 0], [d / 2, -1.2], [d, 0]]) },
    head: { rotate: rot([[0, 0], [d / 2, 1.4], [d, 0]]) },
    // a slow breeze through the cape; physics adds the reaction to body movement on top
    'cape-2': { rotate: rot([[0, 0], [d / 2, 1.6], [d, 0]]) },
    'cape-3': { rotate: rot([[0, 1.2], [d / 2, -1.8], [d, 1.2]]) },
    'cape-4': { rotate: rot([[0, -2], [d / 2, 2.4], [d, -2]]) },
    'cape-near-2': { rotate: rot([[0, 0.8], [d / 2, -1], [d, 0.8]]) }, 'cape-near-3': { rotate: rot([[0, -1.4], [d / 2, 1.6], [d, -1.4]]) },
    'cape-far-2': { rotate: rot([[0, -0.8], [d / 2, 1], [d, -0.8]]) }, 'cape-far-3': { rotate: rot([[0, 1.2], [d / 2, -1.6], [d, 1.2]]) },
  });
  const animations = {};
  animations.idle = { bones: { ...breathe(), 'upper-near': { rotate: rot([[0, 0], [1, 2.5], [2, 0]]) }, 'upper-far': { rotate: rot([[0, 0], [1, -2], [2, 0]]) } } };
  animations['staff/idle'] = { bones: { ...breathe(), 'upper-near': { rotate: rot([[0, 0], [1, 2.5], [2, 0]]) }, 'forearm-near': { rotate: rot([[0, 0], [1, 2], [2, 0]]) } } };
  animations['staff/slam'] = {
    bones: {
      staff: { translate: tr([[0, 0, 0], [0.12, 0, 0], [0.36, 0, L, 'soft'], [0.46, 0, L * 0.97, 'in'], [0.56, 0, 0, 'linear'], [0.62, 0, 0, 'out'], [0.68, 0, 5 * u, 'ease'], [0.76, 0, 0], [0.9, 0, 0]]),
        rotate: rot([[0, 0], [0.36, 3, 'soft'], [0.46, 3, 'in'], [0.56, -2, 'out'], [0.76, 0], [0.9, 0]]) },
      hip: { translate: tr([[0, 0, 0], [0.12, 0, -4 * u], [0.36, -3 * u, 5 * u, 'soft'], [0.46, -3 * u, 5 * u, 'in'], [0.56, 6 * u, -16 * u, 'out'], [0.66, 4 * u, -12 * u], [0.9, 0, 0]]) },
      waist: { rotate: rot([[0, 0], [0.36, 3, 'soft'], [0.46, 3, 'in'], [0.56, -6, 'out'], [0.66, -4], [0.9, 0]]) },
      chest: { rotate: rot([[0, 0], [0.36, 5, 'soft'], [0.46, 5, 'in'], [0.56, -9, 'out'], [0.66, -6], [0.9, 0]]) },
      head: { rotate: rot([[0, 0], [0.36, 6, 'soft'], [0.46, 5, 'in'], [0.56, -10, 'out'], [0.68, -4], [0.9, 0]]) },
    },
    ik: { 'staff/near-arm-ik': ikMix([[0, 0], [0.12, 1], [0.72, 1], [0.9, 0]]) },
    transform: { 'staff/near-hand-rot': rotMix([[0, 0], [0.12, 1], [0.72, 1], [0.9, 0]]) },
    events: [{ time: 0.56, name: 'impact' }],
  };
  const aimD = [gripOf(gunAim)[0] - gripOf(gunRest)[0], gripOf(gunAim)[1] - gripOf(gunRest)[1]], aimR = gunAim.rot - gunRest.rot;
  animations['gun/idle'] = { bones: { ...breathe(), gun: { translate: tr([[0, 0, 0], [1, 1.5 * u, 2 * u], [2, 0, 0]]), rotate: rot([[0, 0], [1, 1.5], [2, 0]]) }, 'upper-far': { rotate: rot([[0, 0], [1, -2], [2, 0]]) } } };
  animations['gun/fire'] = {
    bones: {
      gun: { translate: tr([[0, 0, 0, 'out'], [0.16, aimD[0], aimD[1]], [0.24, aimD[0], aimD[1], 'snap'], [0.29, aimD[0] - 16 * u, aimD[1] + 8 * u, 'ease'], [0.44, aimD[0], aimD[1]], [0.54, aimD[0], aimD[1], 'soft'], [0.8, 0, 0]]),
        rotate: rot([[0, 0, 'out'], [0.16, aimR], [0.24, aimR, 'snap'], [0.29, aimR + 16, 'ease'], [0.44, aimR], [0.54, aimR, 'soft'], [0.8, 0]]) },
      hip: { translate: tr([[0, 0, 0], [0.16, 2 * u, -3 * u], [0.24, 2 * u, -3 * u, 'snap'], [0.29, -5 * u, -5 * u, 'ease'], [0.44, 2 * u, -3 * u], [0.8, 0, 0]]) },
      chest: { rotate: rot([[0, 0], [0.16, -3], [0.24, -3, 'snap'], [0.29, 4, 'ease'], [0.44, -2], [0.8, 0]]) },
      head: { rotate: rot([[0, 0], [0.16, 2], [0.24, 2, 'snap'], [0.29, 5, 'ease'], [0.44, 2], [0.8, 0]]) },
      'upper-far': { rotate: rot([[0, 0], [0.16, -8], [0.29, -14], [0.8, 0]]) },
    },
    slots: { 'muzzle-flash': { attachment: [{ time: 0.24, name: 'muzzle-flash' }, { time: 0.3, name: null }] } },
    events: [{ time: 0.24, name: 'fire' }],
  };
  animations.hit = {
    bones: {
      hip: { translate: tr([[0, 0, 0, 'snap'], [0.08, -14 * u, -5 * u, 'ease'], [0.3, 2 * u, 0], [0.5, 0, 0]]) },
      waist: { rotate: rot([[0, 0, 'snap'], [0.08, 6, 'ease'], [0.3, -1.5], [0.5, 0]]) },
      chest: { rotate: rot([[0, 0, 'snap'], [0.08, 9, 'ease'], [0.32, -2], [0.5, 0]]) },
      head: { rotate: rot([[0, 0, 'snap'], [0.1, 13, 'ease'], [0.34, -3], [0.5, 0]]) },
    },
    events: [{ time: 0.02, name: 'hit' }],
  };
  const jump = 26 * u;
  animations.win = {
    bones: {
      hip: { translate: tr([[0, 0, 0], [0.15, 0, -12 * u, 'out'], [0.38, 0, jump + 6 * u, 'in'], [0.56, 0, -10 * u, 'out'], [0.74, 0, 0], [1.2, 0, 0]]) },
      'foot-near-target': { translate: tr([[0, 0, 0], [0.17, 0, 0, 'out'], [0.38, 0, jump, 'in'], [0.54, 0, 0], [1.2, 0, 0]]), rotate: rot([[0, 0], [0.17, 0], [0.38, -14], [0.54, 0], [1.2, 0]]) },
      'foot-far-target': { translate: tr([[0, 0, 0], [0.17, 0, 0, 'out'], [0.38, 0, jump, 'in'], [0.54, 0, 0], [1.2, 0, 0]]), rotate: rot([[0, 0], [0.17, 0], [0.38, -14], [0.54, 0], [1.2, 0]]) },
      chest: { rotate: rot([[0, 0], [0.15, -4], [0.38, 5], [0.56, -3], [0.8, 2], [1.2, 0]]) },
      head: { rotate: rot([[0, 0], [0.15, -3], [0.38, 10], [0.6, 4], [0.9, 6], [1.2, 0]]) },
      // fist pump on whichever arm is free: the arm that holds the weapon is driven by IK and ignores these keys
      'upper-near': { rotate: rot([[0, 0], [0.15, -10], [0.38, 150, 'out'], [0.6, 138], [0.8, 150], [1.0, 140], [1.2, 0]]) },
      'forearm-near': { rotate: rot([[0, 0], [0.38, 50], [0.6, 70], [0.8, 46], [1.2, 0]]) },
      'upper-far': { rotate: rot([[0, 0], [0.15, -10], [0.38, 140, 'out'], [0.6, 128], [0.8, 140], [1.0, 130], [1.2, 0]]) },
      'forearm-far': { rotate: rot([[0, 0], [0.38, 50], [0.6, 70], [0.8, 46], [1.2, 0]]) },
    },
    events: [{ time: 0.54, name: 'land' }],
  };
  animations.blink = { slots: { eyelids: { attachment: [{ time: 0, name: null }, { time: 2.2, name: 'eyes-closed' }, { time: 2.32, name: null }, { time: 3.6, name: null }] } } };

  return {
    P, bones, world, slots, ik, transform, physics, animations,
    events: { impact: {}, fire: {}, hit: {}, land: {} },
    geo: { staff, gunRest, gunAim, RN, RF, k, grip: g, cape, capeNear, capeFar },
  };
}
