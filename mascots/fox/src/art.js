// Vector artwork for Birdie the Fox, drawn with Canvas 2D in the rig's root space.
//
// Limbs, torso, tail and ears are LOFTED along their bones (a smooth outline swept along the joint
// chain), so they bend instead of hinging like paper cut-outs. Rigid pieces (head, paws, shoes,
// visor, club) are drawn in their bone's upright frame: origin at the joint, rotated by the bone's
// deviation from rest. All shading is gradients + a thin soft outline to read at small sizes.

import { smoothPolyline, catmullRomPath, clamp, mix, hash, rot, add, sub, scale, len } from './math.js';
import { CLUB } from './skeleton.js';

export const PALETTE = {
  fur: '#F08A2E', furLight: '#FBB55A', furDark: '#C8601D', furDeep: '#8F3E12',
  cream: '#FFF7EA', creamShade: '#EBD3B2',
  sock: '#3B2418', sockLight: '#5C3A27',
  nose: '#2A1B14', eyeWhite: '#FFFFFF', iris: '#E9A63D', irisDark: '#7E4310', pupil: '#17100C',
  shirt: '#2F62B8', shirtLight: '#5587DF', shirtDark: '#1E4486', collar: '#F7F4EE', collarShade: '#D9D3C8',
  shorts: '#D9BC8A', shortsDark: '#B59561',
  shoe: '#F7F3EC', shoeShade: '#D8D1C4', saddle: '#7B4A2C', sole: '#C9C8C2',
  visor: '#F7F3EC', visorBand: '#2E7D4F', visorShade: '#D7D1C5',
  mouth: '#5A1E24', tongue: '#E8667A', tongueDark: '#C04458',
  shaft: '#D2D6DC', shaftDark: '#7B828B', grip: '#242424', clubHead: '#B9BFC7',
  line: 'rgba(70,32,10,0.42)',
};

// ------------------------------------------------------------------ drawing helpers
export function outlineStyle(ctx, width = 2, color = PALETTE.line) {
  ctx.lineWidth = width; ctx.strokeStyle = color; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
}

/**
 * Build the closed outline of a tube swept along `pts` with half-widths `widths` (per point).
 * Returns { left, right } polylines (already smoothed) and the centre polyline.
 * fur: { amp, step } adds deterministic jagged tufts to the outline.
 */
export function loftOutline(pts, widths, opts = {}) {
  const per = opts.per || 5;
  const c = smoothPolyline(pts, per);
  const n = c.length;
  const wAt = (i) => {
    const u = (i / (n - 1)) * (widths.length - 1);
    const k = Math.min(widths.length - 2, Math.floor(u)); const f = u - k;
    return mix(widths[k], widths[k + 1], f * f * (3 - 2 * f));
  };
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(n - 1, i + 1)];
    let nx = -(b.y - a.y), ny = (b.x - a.x); const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    let w = wAt(i);
    if (opts.fur && i > 0 && i < n - 1) w += opts.fur.amp * (hash(i, opts.fur.seed || 1) - 0.3) * ((i % (opts.fur.step || 2)) ? 1 : -0.4);
    left.push({ x: c[i].x + nx * w, y: c[i].y + ny * w });
    right.push({ x: c[i].x - nx * w, y: c[i].y - ny * w });
  }
  return { centre: c, left, right, capStart: wAt(0), capEnd: wAt(n - 1) };
}

export function loftPath(ctx, outline, caps = 'round') {
  const { left, right, centre, capStart, capEnd } = outline;
  const n = left.length;
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
  const endDir = sub(centre[n - 1], centre[n - 2]); const ea = Math.atan2(endDir.y, endDir.x);
  if (caps === 'round' || caps === 'end') ctx.arc(centre[n - 1].x, centre[n - 1].y, capEnd, ea - Math.PI / 2, ea + Math.PI / 2, false);
  else ctx.lineTo(right[n - 1].x, right[n - 1].y);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  const sDir = sub(centre[1], centre[0]); const sa = Math.atan2(sDir.y, sDir.x);
  if (caps === 'round' || caps === 'start') ctx.arc(centre[0].x, centre[0].y, capStart, sa + Math.PI / 2, sa + Math.PI * 1.5, false);
  ctx.closePath();
}

/** Gradient across the tube (light on the upper-left side) for the loft at its mid point. */
export function acrossGradient(ctx, outline, light, dark, mid = null) {
  const n = outline.centre.length;
  const i = Math.floor(n / 2);
  const l = outline.left[i], r = outline.right[i];
  // decide which side faces the light (upper-left)
  const lightSide = (l.x + l.y) < (r.x + r.y) ? [l, r] : [r, l];
  const g = ctx.createLinearGradient(lightSide[0].x, lightSide[0].y, lightSide[1].x, lightSide[1].y);
  g.addColorStop(0, light); if (mid) g.addColorStop(0.5, mid); g.addColorStop(1, dark);
  return g;
}

export function tube(ctx, pts, widths, light, dark, opts = {}) {
  const o = loftOutline(pts, widths, opts);
  loftPath(ctx, o, opts.caps);
  ctx.fillStyle = opts.flat ? light : acrossGradient(ctx, o, light, dark, opts.mid);
  ctx.fill();
  if (opts.outline !== false) { outlineStyle(ctx, opts.lineWidth || 2); ctx.stroke(); }
  return o;
}

export function ellipse(ctx, x, y, rx, ry, rotation = 0) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2); ctx.closePath();
}

export function radial(ctx, x, y, r, stops, x2 = x, y2 = y, r0 = 0) {
  const g = ctx.createRadialGradient(x2, y2, r0, x, y, r);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

/** Points along a bone chain: heads of all bones plus the last tail. */
export function chainPoints(pose, names) {
  const pts = names.map((n) => pose.bones.get(n).head);
  pts.push(pose.bones.get(names[names.length - 1]).tail);
  return pts;
}

/** ctx transform into a rigid bone's upright frame (origin at the joint). */
export function enterBone(ctx, pose, name) {
  const b = pose.bones.get(name);
  ctx.translate(b.head.x, b.head.y);
  ctx.rotate(b.angle - b.restAngle);
}

const P = PALETTE;

// ------------------------------------------------------------------ parts
export function drawTail(ctx, pose) {
  const pts = chainPoints(pose, ['tail_01', 'tail_02', 'tail_03', 'tail_04', 'tail_05']);
  const widths = [24, 34, 42, 41, 32, 9];
  // body of the tail (fluffy outline)
  const o = loftOutline(pts, widths, { fur: { amp: 7, step: 3, seed: 11 }, per: 6 });
  loftPath(ctx, o);
  ctx.fillStyle = acrossGradient(ctx, o, P.furLight, P.furDark, P.fur);
  ctx.fill();
  // white tip: clip to the tail path and paint the last third
  ctx.save(); ctx.clip();
  const n = o.centre.length, k = Math.floor(n * 0.62);
  const tipPts = o.centre.slice(k);
  const tip = loftOutline(tipPts, [widths[3] + 12, widths[4] + 10, 20], { fur: { amp: 6, step: 2, seed: 5 }, per: 4 });
  loftPath(ctx, tip);
  ctx.fillStyle = acrossGradient(ctx, tip, P.cream, P.creamShade);
  ctx.fill();
  // darker underside streak
  const under = loftOutline(o.centre.slice(2, k + 2), [4, 12, 10, 5], { per: 3 });
  loftPath(ctx, under);
  ctx.globalAlpha = 0.18; ctx.fillStyle = P.furDeep; ctx.fill(); ctx.globalAlpha = 1;
  ctx.restore();
  loftPath(ctx, o); outlineStyle(ctx, 2); ctx.stroke();
}

export function drawEar(ctx, pose, side) {
  const b1 = pose.bones.get(`ear_${side}_01`), b2 = pose.bones.get(`ear_${side}_02`);
  const pts = [b1.head, b2.head, b2.tail];
  const o = tube(ctx, pts, [26, 17, 3], P.furLight, P.furDark, { caps: 'start', per: 6, mid: P.fur });
  // dark tip
  ctx.save(); loftPath(ctx, o); ctx.clip();
  const tipO = loftOutline([b2.head, b2.tail], [22, 4], { per: 3 });
  const tipPath = () => { loftPath(ctx, tipO, 'none'); };
  tipPath(); ctx.fillStyle = P.sock; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
  ctx.restore();
  // inner ear: cream cavity with a darker centre, inset
  const dir = sub(b2.tail, b1.head); const L = len(dir); const u = scale(dir, 1 / L);
  const nrm = { x: -u.y, y: u.x };
  const inset = (f, w) => add(add(b1.head, scale(u, L * f)), scale(nrm, w * (side === 'L' ? 1 : -1)));
  const inner = [inset(0.08, 2), inset(0.5, 1), inset(0.86, 0)];
  const io = loftOutline(inner, [14, 9, 1], { per: 4 });
  loftPath(ctx, io, 'start');
  ctx.fillStyle = acrossGradient(ctx, io, P.cream, P.creamShade); ctx.fill();
  const io2 = loftOutline([inset(0.18, 2), inset(0.48, 1), inset(0.72, 0)], [6, 4, 1], { per: 3 });
  loftPath(ctx, io2, 'start'); ctx.fillStyle = 'rgba(150,80,50,0.45)'; ctx.fill();
}

export function drawLegBack(ctx, pose, side) {
  const hip = pose.bones.get(`thigh_${side}`), shin = pose.bones.get(`shin_${side}`), foot = pose.bones.get(`foot_${side}`);
  // thigh (fur) -> shin (fur) -> ankle. Dark fox "stocking" on the lower shin.
  tube(ctx, [hip.head, shin.head, shin.tail], [27, 22, 15], P.furLight, P.furDark, { mid: P.fur, per: 5 });
  // stocking: lower 45% of the shin
  const d = sub(shin.tail, shin.head);
  const s0 = add(shin.head, scale(d, 0.52));
  const so = loftOutline([s0, shin.tail], [18, 15], { per: 3 });
  loftPath(ctx, so, 'end');
  ctx.fillStyle = acrossGradient(ctx, so, P.sockLight, P.sock); ctx.fill();
  // ragged top edge of the stocking
  ctx.beginPath();
  const n = { x: -d.y, y: d.x }; const L = len(d) || 1; const nx = n.x / L, ny = n.y / L;
  for (let i = -1; i <= 1; i += 0.5) {
    const p = add(s0, scale({ x: nx, y: ny }, i * 17)); const q = add(p, scale(d, -0.07 * (i % 1 ? 1 : 0.3)));
    if (i === -1) ctx.moveTo(p.x, p.y); else ctx.lineTo(q.x, q.y);
  }
  ctx.strokeStyle = 'rgba(59,36,24,0.0)'; ctx.stroke();
  // shoe
  drawShoe(ctx, pose, side);
}

export function drawShoe(ctx, pose, side) {
  const foot = pose.bones.get(`foot_${side}`);
  const sgn = side === 'L' ? 1 : -1;
  ctx.save();
  // the shoe is rigid in the foot bone's upright frame; its heel sits behind the ankle
  enterBone(ctx, pose, `foot_${side}`);
  ctx.scale(sgn, 1);
  // sole
  ctx.beginPath();
  ctx.moveTo(-26, 26); ctx.lineTo(44, 26); ctx.quadraticCurveTo(52, 26, 50, 19); ctx.lineTo(-24, 19); ctx.quadraticCurveTo(-30, 19, -26, 26);
  ctx.closePath(); ctx.fillStyle = P.sole; ctx.fill(); outlineStyle(ctx, 1.6); ctx.stroke();
  // cleats
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.rect(-18 + i * 14, 26, 5, 3); ctx.fillStyle = '#8B8F96'; ctx.fill(); }
  // upper
  ctx.beginPath();
  ctx.moveTo(-24, 20); ctx.quadraticCurveTo(-30, -2, -14, -8); ctx.quadraticCurveTo(0, -14, 12, -6);
  ctx.quadraticCurveTo(26, 2, 42, 8); ctx.quadraticCurveTo(54, 13, 50, 20); ctx.closePath();
  ctx.fillStyle = radial(ctx, 6, 2, 46, [[0, P.shoe], [0.7, P.shoe], [1, P.shoeShade]]);
  ctx.fill(); outlineStyle(ctx, 2); ctx.stroke();
  // brown saddle + toe cap
  ctx.save(); ctx.clip();
  ctx.beginPath(); ctx.moveTo(-6, -12); ctx.quadraticCurveTo(10, -2, 6, 22); ctx.lineTo(-14, 22); ctx.quadraticCurveTo(-14, 0, -6, -12); ctx.closePath();
  ctx.fillStyle = P.saddle; ctx.fill();
  ctx.beginPath(); ctx.moveTo(30, 0); ctx.quadraticCurveTo(38, 10, 36, 24); ctx.lineTo(56, 24); ctx.lineTo(56, 0); ctx.closePath();
  ctx.fillStyle = P.saddle; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
  ctx.restore();
  // laces
  outlineStyle(ctx, 1.5, 'rgba(90,60,40,0.7)');
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(8 + i * 7, -4 + i * 2); ctx.lineTo(14 + i * 7, 2 + i * 3); ctx.stroke(); }
  ctx.restore();
}

export function drawShorts(ctx, pose) {
  const pel = pose.bones.get('pelvis'), hipL = pose.bones.get('thigh_L'), hipR = pose.bones.get('thigh_R');
  // each leg of the shorts: a short loft over the top 55% of the thigh
  for (const side of ['L', 'R']) {
    const th = pose.bones.get(`thigh_${side}`);
    const d = sub(th.tail, th.head);
    const o = loftOutline([add(th.head, scale(d, -0.08)), add(th.head, scale(d, 0.3)), add(th.head, scale(d, 0.58))], [31, 31, 30], { per: 3 });
    loftPath(ctx, o, 'end'); ctx.fillStyle = acrossGradient(ctx, o, P.shorts, P.shortsDark); ctx.fill();
    outlineStyle(ctx, 2); ctx.stroke();
    // hem crease
    const h0 = add(th.head, scale(d, 0.5)); const n = { x: -d.y, y: d.x }; const L = len(d) || 1;
    ctx.beginPath(); ctx.moveTo(h0.x + n.x / L * 26, h0.y + n.y / L * 26); ctx.lineTo(h0.x - n.x / L * 26, h0.y - n.y / L * 26);
    outlineStyle(ctx, 1.2, 'rgba(90,60,30,0.3)'); ctx.stroke();
  }
  // seat: pelvis block in its upright frame
  ctx.save(); enterBone(ctx, pose, 'pelvis');
  ctx.beginPath(); ctx.moveTo(-60, -4); ctx.quadraticCurveTo(-64, 30, -40, 44); ctx.lineTo(40, 44); ctx.quadraticCurveTo(64, 30, 60, -4); ctx.closePath();
  const g = ctx.createLinearGradient(-60, 0, 60, 0); g.addColorStop(0, P.shorts); g.addColorStop(1, P.shortsDark);
  ctx.fillStyle = g; ctx.fill(); outlineStyle(ctx, 2); ctx.stroke();
  // belt
  ctx.beginPath(); ctx.rect(-58, -10, 116, 11); ctx.fillStyle = '#6F4428'; ctx.fill();
  ctx.beginPath(); ctx.rect(-10, -13, 20, 17); ctx.fillStyle = '#D9B24C'; ctx.fill(); outlineStyle(ctx, 1.5); ctx.stroke();
  // fly line
  ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, 40); outlineStyle(ctx, 1.2, 'rgba(90,60,30,0.35)'); ctx.stroke();
  ctx.restore();
}

export function drawTorso(ctx, pose) {
  const pel = pose.bones.get('pelvis'), sp = pose.bones.get('spine_01'), ch = pose.bones.get('chest'), nk = pose.bones.get('neck');
  const pts = [add(pel.head, { x: 0, y: 6 }), sp.head, add(sp.head, scale(sub(ch.head, sp.head), 0.5)), ch.head, add(ch.head, scale(sub(ch.tail, ch.head), 0.6)), ch.tail];
  const widths = [60, 61, 62, 66, 70, 58];
  // shirt body
  const o = loftOutline(pts, widths, { per: 5 });
  loftPath(ctx, o, 'none');
  ctx.fillStyle = acrossGradient(ctx, o, P.shirtLight, P.shirtDark, P.shirt); ctx.fill();
  // belly sheen + chest stripe
  ctx.save(); ctx.clip();
  const mid = o.centre[Math.floor(o.centre.length * 0.55)];
  ctx.fillStyle = radial(ctx, mid.x - 10, mid.y - 10, 70, [[0, 'rgba(255,255,255,0.22)'], [1, 'rgba(255,255,255,0)']]); ctx.fillRect(mid.x - 90, mid.y - 90, 180, 180);
  const si = Math.floor(o.centre.length * 0.68);
  const stripe = loftOutline([o.centre[si - 2], o.centre[si + 2]], [80, 80], { per: 2 });
  loftPath(ctx, stripe, 'none'); ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fill();
  loftPath(ctx, loftOutline([o.centre[si - 1], o.centre[si + 1]], [80, 80], { per: 2 }), 'none'); ctx.fillStyle = P.collar; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
  ctx.restore();
  loftPath(ctx, o, 'none'); outlineStyle(ctx, 2); ctx.stroke();
  // collar + placket in the chest's upright frame
  ctx.save(); enterBone(ctx, pose, 'chest'); ctx.translate(0, -63);
  ctx.beginPath(); ctx.moveTo(-34, 2); ctx.quadraticCurveTo(-30, -14, -4, -14); ctx.lineTo(0, 24); ctx.lineTo(-30, 20); ctx.closePath();
  ctx.fillStyle = P.collar; ctx.fill(); outlineStyle(ctx, 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(34, 2); ctx.quadraticCurveTo(30, -14, 4, -14); ctx.lineTo(0, 24); ctx.lineTo(30, 20); ctx.closePath();
  ctx.fillStyle = P.collarShade; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 22); ctx.lineTo(0, 54); outlineStyle(ctx, 1.4, 'rgba(20,40,90,0.5)'); ctx.stroke();
  for (const y of [30, 44]) { ctx.beginPath(); ctx.arc(0, y, 3, 0, Math.PI * 2); ctx.fillStyle = P.collar; ctx.fill(); outlineStyle(ctx, 1); ctx.stroke(); }
  ctx.restore();
}

export function drawNeck(ctx, pose) {
  const nk = pose.bones.get('neck');
  tube(ctx, [add(nk.head, { x: 2, y: 14 }), add(nk.tail, { x: 2, y: 4 })], [19, 21], P.cream, P.creamShade, { caps: 'round', per: 3 });
}

export function drawArm(ctx, pose, side) {
  const ua = pose.bones.get(`upperarm_${side}`), fa = pose.bones.get(`forearm_${side}`), hd = pose.bones.get(`hand_${side}`);
  const d = sub(ua.tail, ua.head);
  // whole arm fur
  tube(ctx, [ua.head, ua.tail, fa.tail], [23, 18, 15], P.furLight, P.furDark, { mid: P.fur, per: 5 });
  // sleeve over the upper 48% of the upper arm
  const so = loftOutline([add(ua.head, scale(d, -0.12)), add(ua.head, scale(d, 0.2)), add(ua.head, scale(d, 0.48))], [27, 27, 25], { per: 3 });
  loftPath(ctx, so, 'end'); ctx.fillStyle = acrossGradient(ctx, so, P.shirtLight, P.shirtDark, P.shirt); ctx.fill(); outlineStyle(ctx, 2); ctx.stroke();
  // cuff
  const c0 = add(ua.head, scale(d, 0.42)), n = { x: -d.y, y: d.x }, L = len(d) || 1;
  loftPath(ctx, loftOutline([c0, add(ua.head, scale(d, 0.48))], [25, 25], { per: 2 }), 'none'); ctx.fillStyle = P.collar; ctx.fill();
  // dark paw "glove" over the lower forearm
  const fd = sub(fa.tail, fa.head);
  const po = loftOutline([add(fa.head, scale(fd, 0.6)), fa.tail], [16, 15], { per: 3 });
  loftPath(ctx, po, 'none'); ctx.fillStyle = acrossGradient(ctx, po, P.sockLight, P.sock); ctx.fill();
  drawPaw(ctx, pose, side);
}

export function drawPaw(ctx, pose, side) {
  const closed = clamp(pose.channels[`hand_${side}`]);
  const sgn = side === 'L' ? 1 : -1;
  ctx.save(); enterBone(ctx, pose, `hand_${side}`); ctx.scale(sgn, 1);
  // palm: a rounded mitten. 0 = open (fingers spread), 1 = fist (compact ball)
  const w = mix(17, 15, closed), h = mix(26, 21, closed);
  ellipse(ctx, 0, 14, w, h);
  ctx.fillStyle = radial(ctx, -4, 8, 28, [[0, P.sockLight], [1, P.sock]]); ctx.fill(); outlineStyle(ctx, 2); ctx.stroke();
  // fingers (three bumps) that fold down as the paw closes
  for (let i = 0; i < 3; i++) {
    const a = mix(-0.55 + i * 0.5, 0.3 + i * 0.25, closed);
    const r = mix(26, 16, closed);
    const x = Math.sin(a) * r, y = 14 + Math.cos(a) * r * mix(1, 0.6, closed);
    ellipse(ctx, x, y, mix(7.5, 7, closed), mix(9, 7, closed), a);
    ctx.fillStyle = P.sockLight; ctx.fill(); outlineStyle(ctx, 1.6); ctx.stroke();
  }
  // thumb
  ellipse(ctx, mix(-16, -12, closed), mix(6, 14, closed), 6.5, 8.5, mix(-0.6, 0.2, closed));
  ctx.fillStyle = P.sockLight; ctx.fill(); outlineStyle(ctx, 1.6); ctx.stroke();
  // paw-pad highlight
  ellipse(ctx, -3, 12, 6, 4); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
  ctx.restore();
}

export function drawClub(ctx, pose, part = 'all') {
  if (pose.channels.clubVisible < 0.5) return;
  const c = pose.bones.get('club');
  ctx.save(); ctx.translate(c.head.x, c.head.y); ctx.rotate(c.angle);
  const L = c.length;
  const from = part === 'grip' ? 0 : 0, to = part === 'grip' ? L * CLUB.shaftStart : L;
  if (part !== 'grip') {
    // shaft
    ctx.beginPath(); ctx.rect(L * CLUB.shaftStart - 2, -2.6, L * (CLUB.headStart - CLUB.shaftStart) + 4, 5.2);
    const g = ctx.createLinearGradient(0, -3, 0, 3); g.addColorStop(0, '#F4F6F8'); g.addColorStop(0.5, P.shaft); g.addColorStop(1, P.shaftDark);
    ctx.fillStyle = g; ctx.fill(); outlineStyle(ctx, 1.2, 'rgba(40,40,50,0.5)'); ctx.stroke();
    // iron head: hosel then blade angled down-right of the shaft axis
    // iron head, rigid to the shaft; rotated so its sole lies flat when the shaft is at its rest angle
    ctx.save(); ctx.translate(L * CLUB.headStart, 0); ctx.rotate(-CLUB.restAngle);
    ctx.beginPath(); ctx.moveTo(-6, -14); ctx.lineTo(4, -16); ctx.lineTo(10, -4); ctx.lineTo(50, -6); ctx.quadraticCurveTo(60, -6, 58, 2);
    ctx.lineTo(52, 8); ctx.quadraticCurveTo(14, 8, 0, 6); ctx.lineTo(-8, 0); ctx.closePath();
    const hg = ctx.createLinearGradient(0, -16, 40, 8); hg.addColorStop(0, '#EEF1F4'); hg.addColorStop(0.5, P.clubHead); hg.addColorStop(1, '#6D737B');
    ctx.fillStyle = hg; ctx.fill(); outlineStyle(ctx, 1.4, 'rgba(40,40,50,0.6)'); ctx.stroke();
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(14, -3 + i * 2.6); ctx.lineTo(48, -4 + i * 2.6); outlineStyle(ctx, 0.8, 'rgba(40,40,50,0.35)'); ctx.stroke(); }
    ctx.restore();
  }
  // grip (drawn in both passes so the hands can be sandwiched between shaft and grip)
  ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(L * CLUB.shaftStart, -3.6); ctx.lineTo(L * CLUB.shaftStart, 3.6); ctx.lineTo(0, 5); ctx.closePath();
  const gg = ctx.createLinearGradient(0, -5, 0, 5); gg.addColorStop(0, '#4A4A4A'); gg.addColorStop(0.5, P.grip); gg.addColorStop(1, '#0E0E0E');
  ctx.fillStyle = gg; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, 5, Math.PI / 2, Math.PI * 1.5); ctx.fillStyle = '#3A3A3A'; ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------------ head
function eye(ctx, cx, cy, rx, ry, blink, ch, far) {
  const squint = clamp(ch.squint);
  ctx.save(); ctx.translate(cx, cy);
  // white + iris + pupil clipped to the almond
  const almond = () => { ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, far ? -0.12 : 0.12, 0, Math.PI * 2); ctx.closePath(); };
  almond(); ctx.fillStyle = P.eyeWhite; ctx.fill();
  ctx.save(); almond(); ctx.clip();
  const px = ch.pupil_x * rx * 0.42 + (far ? -2 : 2), py = ch.pupil_y * ry * 0.35 + 1;
  const ir = ry * 0.86 * ch.pupilSize;
  ctx.beginPath(); ctx.arc(px, py, ir, 0, Math.PI * 2); ctx.fillStyle = radial(ctx, px, py, ir, [[0, P.iris], [0.75, P.iris], [1, P.irisDark]], px - ir * 0.3, py - ir * 0.3); ctx.fill();
  ctx.beginPath(); ctx.arc(px, py, ir * 0.58, 0, Math.PI * 2); ctx.fillStyle = P.pupil; ctx.fill();
  ctx.beginPath(); ctx.arc(px - ir * 0.35, py - ir * 0.4, ir * 0.24, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill();
  ctx.beginPath(); ctx.arc(px + ir * 0.3, py + ir * 0.35, ir * 0.1, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fill();
  // upper-lid shadow
  ctx.beginPath(); ctx.ellipse(0, -ry * 0.75, rx * 1.1, ry * 0.5, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(80,40,20,0.14)'; ctx.fill();
  // lids: upper lid comes down with blink, lower lid rises with squint
  const upper = ry * 2.05 * clamp(blink);
  ctx.beginPath(); ctx.rect(-rx * 1.3, -ry * 1.3, rx * 2.6, upper); ctx.fillStyle = P.fur; ctx.fill();
  if (squint > 0) { ctx.beginPath(); ctx.ellipse(0, ry * 1.25 - squint * ry * 0.9, rx * 1.25, ry * 0.9, 0, 0, Math.PI * 2); ctx.fillStyle = P.fur; ctx.fill(); }
  ctx.restore();
  // outline + lash line
  almond(); outlineStyle(ctx, 1.8, 'rgba(50,25,10,0.7)'); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, far ? -0.12 : 0.12, Math.PI * 1.1, Math.PI * 1.9); outlineStyle(ctx, 3, 'rgba(40,20,8,0.85)'); ctx.stroke();
  if (blink > 0.9) { ctx.beginPath(); ctx.moveTo(-rx, 2); ctx.quadraticCurveTo(0, ry * 0.9, rx, 2); outlineStyle(ctx, 2.6, 'rgba(40,20,8,0.9)'); ctx.stroke(); }
  ctx.restore();
}

function brow(ctx, cx, cy, raise, tilt, far) {
  ctx.save(); ctx.translate(cx, cy - raise * 9); ctx.rotate(tilt * (far ? -1 : 1) * 0.32);
  ctx.beginPath(); ctx.moveTo(-20, 4); ctx.quadraticCurveTo(-10, -11 - raise * 2, 6, -8); ctx.quadraticCurveTo(16, -6, 21, 2);
  ctx.quadraticCurveTo(13, 0, 4, 0); ctx.quadraticCurveTo(-6, 0, -17, 9); ctx.closePath();
  ctx.fillStyle = P.furDeep; ctx.fill();
  ctx.restore();
}

export function drawHead(ctx, pose) {
  const ch = pose.channels;
  const turn = ch.headTurn * 10;
  ctx.save(); enterBone(ctx, pose, 'head');
  const cx = 4 + turn * 0.4, cy = -74;
  // cheek ruffs (white fur spikes), behind the head
  for (const s of [-1, 1]) {
    ctx.save(); ctx.translate(cx + s * 60, cy + 28); ctx.scale(s, 1);
    ctx.beginPath(); ctx.moveTo(-30, -40);
    const spikes = [[8, -30], [26, -24], [16, -10], [34, 2], [16, 10], [30, 26], [8, 26], [10, 40], [-12, 34], [-30, 30]];
    for (const [x, y] of spikes) ctx.lineTo(x, y);
    ctx.closePath(); ctx.fillStyle = radial(ctx, 0, 0, 44, [[0, P.cream], [1, P.creamShade]]); ctx.fill(); outlineStyle(ctx, 2); ctx.stroke();
    ctx.restore();
  }
  // head base
  ctx.beginPath();
  ctx.moveTo(cx - 92, cy - 20);
  ctx.bezierCurveTo(cx - 96, cy - 85, cx - 50, cy - 108, cx, cy - 106);
  ctx.bezierCurveTo(cx + 54, cy - 108, cx + 96, cy - 82, cx + 92, cy - 20);
  ctx.bezierCurveTo(cx + 90, cy + 14, cx + 60, cy + 50, cx + 20, cy + 70);   // jaw to the muzzle tip
  ctx.bezierCurveTo(cx + 10, cy + 76, cx + 2, cy + 76, cx - 6, cy + 70);
  ctx.bezierCurveTo(cx - 50, cy + 50, cx - 90, cy + 14, cx - 92, cy - 20);
  ctx.closePath();
  ctx.fillStyle = radial(ctx, cx - 20, cy - 40, 150, [[0, P.furLight], [0.45, P.fur], [1, P.furDark]]); ctx.fill();
  ctx.save(); ctx.clip();
  // forehead darker cap of fur
  ctx.beginPath(); ctx.ellipse(cx, cy - 92, 70, 34, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(140,60,15,0.18)'; ctx.fill();
  // white muzzle / lower face mask
  ctx.beginPath();
  ctx.moveTo(cx - 70, cy + 10);
  ctx.bezierCurveTo(cx - 56, cy - 12, cx - 36, cy - 8, cx - 22, cy + 8);
  ctx.bezierCurveTo(cx - 10, cy + 22, cx + 14, cy + 22, cx + 28, cy + 6);
  ctx.bezierCurveTo(cx + 42, cy - 10, cx + 62, cy - 10, cx + 74, cy + 12);
  ctx.bezierCurveTo(cx + 70, cy + 50, cx + 40, cy + 82, cx + 6, cy + 86);
  ctx.bezierCurveTo(cx - 30, cy + 84, cx - 64, cy + 52, cx - 70, cy + 10);
  ctx.closePath();
  ctx.fillStyle = radial(ctx, cx, cy + 30, 90, [[0, P.cream], [0.7, P.cream], [1, P.creamShade]]); ctx.fill();
  // blush
  if (ch.cheekBlush > 0) { for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * 52, cy + 14, 14, 8, 0, 0, Math.PI * 2); ctx.fillStyle = `rgba(230,90,80,${0.35 * ch.cheekBlush})`; ctx.fill(); } }
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(cx - 92, cy - 20);
  ctx.bezierCurveTo(cx - 96, cy - 85, cx - 50, cy - 108, cx, cy - 106);
  ctx.bezierCurveTo(cx + 54, cy - 108, cx + 96, cy - 82, cx + 92, cy - 20);
  ctx.bezierCurveTo(cx + 90, cy + 14, cx + 60, cy + 50, cx + 20, cy + 70);
  ctx.bezierCurveTo(cx + 10, cy + 76, cx + 2, cy + 76, cx - 6, cy + 70);
  ctx.bezierCurveTo(cx - 50, cy + 50, cx - 90, cy + 14, cx - 92, cy - 20);
  ctx.closePath(); outlineStyle(ctx, 2.2); ctx.stroke();

  // mouth: smile curve under the nose; opens into a jaw with tongue
  const smile = ch.smile, open = clamp(ch.mouthOpen);
  const my = cy + 44;
  if (open > 0.05) {
    ctx.beginPath();
    ctx.moveTo(cx - 24, my - 2 + smile * -4);
    ctx.quadraticCurveTo(cx + 4, my - 6 + smile * 4, cx + 32, my - 2 + smile * -4);
    ctx.quadraticCurveTo(cx + 30, my + 14 + open * 26, cx + 4, my + 14 + open * 30);
    ctx.quadraticCurveTo(cx - 22, my + 14 + open * 26, cx - 24, my - 2 + smile * -4);
    ctx.closePath(); ctx.fillStyle = P.mouth; ctx.fill(); outlineStyle(ctx, 2, 'rgba(40,15,10,0.8)'); ctx.stroke();
    ctx.save(); ctx.clip();
    ctx.beginPath(); ctx.ellipse(cx + 6, my + 16 + open * 26, 16, 10 + ch.tongue * 8, 0, 0, Math.PI * 2); ctx.fillStyle = radial(ctx, cx + 6, my + 12 + open * 26, 18, [[0, P.tongue], [1, P.tongueDark]]); ctx.fill();
    // little fang
    ctx.beginPath(); ctx.moveTo(cx - 14, my - 2); ctx.lineTo(cx - 10, my + 7); ctx.lineTo(cx - 6, my - 2); ctx.closePath(); ctx.fillStyle = '#FFF'; ctx.fill();
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - 24, my - 2 - smile * 6); ctx.quadraticCurveTo(cx - 8, my + smile * 10, cx + 4, my + smile * 2);
    ctx.quadraticCurveTo(cx + 18, my + smile * 10, cx + 32, my - 2 - smile * 6);
    outlineStyle(ctx, 2.4, 'rgba(50,20,10,0.85)'); ctx.stroke();
    if (smile > 0.5) { ctx.beginPath(); ctx.moveTo(cx - 12, my + 2); ctx.lineTo(cx - 9, my + 8); ctx.lineTo(cx - 5, my + 2); ctx.closePath(); ctx.fillStyle = '#FFF'; ctx.fill(); }
  }
  // nose: upside-down rounded triangle at the muzzle tip
  ctx.beginPath(); ctx.moveTo(cx - 13, cy + 22); ctx.quadraticCurveTo(cx + 6, cy + 14, cx + 25, cy + 22);
  ctx.quadraticCurveTo(cx + 22, cy + 40, cx + 6, cy + 44); ctx.quadraticCurveTo(cx - 10, cy + 40, cx - 13, cy + 22); ctx.closePath();
  ctx.fillStyle = radial(ctx, cx + 2, cy + 24, 24, [[0, '#4A3028'], [1, P.nose]]); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx - 2, cy + 24, 6, 3, -0.3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill();
  // philtrum
  ctx.beginPath(); ctx.moveTo(cx + 6, cy + 44); ctx.lineTo(cx + 5, my - 4); outlineStyle(ctx, 1.6, 'rgba(50,20,10,0.5)'); ctx.stroke();
  // whisker dots
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(cx + 6 + s * (26 + i * 9), cy + 34 + (i % 2) * 6, 1.6, 0, Math.PI * 2); ctx.fillStyle = 'rgba(80,50,30,0.6)'; ctx.fill(); }

  // eyes + brows (the far eye is slightly narrower for the three-quarter turn)
  const ex = cx - 30 - turn * 0.3, fx = cx + 38 + turn * 0.3, ey = cy - 12;
  eye(ctx, ex, ey, 17, 14, ch.blink_R, ch, false);
  eye(ctx, fx, ey + 1, 15.5, 13.5, ch.blink_L, ch, true);
  brow(ctx, ex, ey - 26, ch.brow_R, ch.browTilt, false);
  brow(ctx, fx, ey - 25, ch.brow_L, ch.browTilt, true);
  drawVisor(ctx, cx, cy);
  ctx.restore();
}

function drawVisor(ctx, cx, cy) {
  ctx.save(); ctx.translate(cx, cy - 66);
  // band around the forehead
  ctx.beginPath(); ctx.moveTo(-84, 6); ctx.quadraticCurveTo(-80, -22, 0, -24); ctx.quadraticCurveTo(80, -22, 84, 6);
  ctx.quadraticCurveTo(80, -2, 0, -4); ctx.quadraticCurveTo(-80, -2, -84, 6); ctx.closePath();
  const g = ctx.createLinearGradient(-84, 0, 84, 0); g.addColorStop(0, P.visorShade); g.addColorStop(0.4, P.visor); g.addColorStop(1, P.visorShade);
  ctx.fillStyle = g; ctx.fill(); outlineStyle(ctx, 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-80, 2); ctx.quadraticCurveTo(0, -16, 80, 2); outlineStyle(ctx, 4, P.visorBand); ctx.stroke();
  // bill: pushed toward screen-right (the direction the fox is turned)
  ctx.beginPath(); ctx.moveTo(-70, -2); ctx.quadraticCurveTo(-10, 10, 70, 16); ctx.quadraticCurveTo(110, 20, 118, 2); ctx.quadraticCurveTo(100, -8, 60, -12);
  ctx.quadraticCurveTo(10, -16, -70, -2); ctx.closePath();
  const bg = ctx.createLinearGradient(0, -14, 0, 18); bg.addColorStop(0, P.visor); bg.addColorStop(1, P.visorShade);
  ctx.fillStyle = bg; ctx.fill(); outlineStyle(ctx, 2); ctx.stroke();
  // underside shadow line + logo
  ctx.beginPath(); ctx.moveTo(-60, 1); ctx.quadraticCurveTo(-10, 12, 70, 17); outlineStyle(ctx, 1.4, 'rgba(70,32,10,0.25)'); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-6, -17); ctx.lineTo(4, -8); ctx.lineTo(-6, -8); ctx.closePath(); ctx.fillStyle = P.visorBand; ctx.fill();
  ctx.beginPath(); ctx.moveTo(8, -17); ctx.lineTo(8, -8); ctx.lineTo(-2, -8); ctx.closePath(); ctx.fillStyle = P.fur; ctx.fill();
  ctx.restore();
}

/** Ground contact shadow under the feet (soft ellipse that scales with height above ground). */
export function drawShadow(ctx, pose, groundY = 0) {
  const fl = pose.bones.get('foot_L').tail, fr = pose.bones.get('foot_R').tail;
  const lift = clamp(1 - (Math.max(0, groundY - Math.max(fl.y, fr.y)) / 160));
  const cx = (fl.x + fr.x) / 2;
  ctx.save(); ctx.globalAlpha = 0.28 * lift;
  ctx.beginPath(); ctx.ellipse(cx, groundY + 8, 98 * (0.6 + 0.4 * lift), 18 * (0.6 + 0.4 * lift), 0, 0, Math.PI * 2);
  ctx.fillStyle = radial(ctx, cx, groundY + 8, 98, [[0, 'rgba(40,20,10,0.9)'], [1, 'rgba(40,20,10,0)']]); ctx.fill();
  ctx.restore();
}
