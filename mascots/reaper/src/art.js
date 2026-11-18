// Vector artwork for the Grim Reaper, drawn with Canvas 2D in the rig's root space, in the sheet's
// flat cel-shaded style: base colour, shadow colour, a thin light rim, and a thick ink line.
// Cloth is swept along bones; skull, hands, boots, hourglass and scythe are rigid pieces in bone frames.
// Gripping hands are drawn in the SCYTHE's frame around its grip markers (palm behind the shaft,
// fingers and thumb over it) so the shaft always passes through the fist.
import { smoothPolyline, catmullRomPath, clamp, mix, rot, add, sub, scale, len, hash } from './math.js';
import { PROP } from './skeleton.js';

export const PALETTE = {
  ink: '#241a22',
  hood: '#3a2433', hoodShade: '#27171f', hoodLight: '#4d3244', hoodInside: '#120b0f', hoodInner: '#1f1219',
  robe: '#5c2548', robeShade: '#421a35', robeLight: '#73305e', robeRim: '#8a3d72',
  rope: '#c6a16a', ropeShade: '#8f6f3c', ropeLight: '#e6cc96',
  bone: '#eadfca', boneShade: '#c4b18f', boneLight: '#f7f0e2', socket: '#120c10', socketRim: '#3a2a26', glint: '#ffb347',
  boot: '#2a2226', bootLight: '#453a40', bootSole: '#17121a', buckle: '#b58a3c',
  brass: '#b58a3c', brassLight: '#e3bb62', brassShade: '#775520', sand: '#e6c87a', glass: 'rgba(205,232,240,0.38)',
  wood: '#6e4a2c', woodShade: '#4a3020', woodLight: '#8d6239', wrap: '#bca57a', wrapShade: '#8a7550',
  steel: '#c7ccd1', steelShade: '#848c94', steelDark: '#5f666e', steelLight: '#eff2f4', steelSpot: '#6a727a',
};
const P = PALETTE;
const INK_W = 3;

export function ink(ctx, w = INK_W, c = P.ink) { ctx.lineWidth = w; ctx.strokeStyle = c; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; }
function fillStroke(ctx, color, w = INK_W) { ctx.fillStyle = color; ctx.fill(); if (w) { ink(ctx, w); ctx.stroke(); } }
function poly(ctx, pts, close = true) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); if (close) ctx.closePath(); }
function spline(ctx, pts, close = true, tension = 0.5) { ctx.beginPath(); catmullRomPath(ctx, pts.map(([x, y]) => ({ x, y })), close, tension); }
export function enterBone(ctx, pose, name) { const b = pose.bones.get(name); ctx.translate(b.head.x, b.head.y); ctx.rotate(b.angle - b.restAngle); }
const V = (p) => [p.x, p.y];
function line(ctx, pts, w = 2, c = P.ink) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ink(ctx, w, c); ctx.stroke(); }
function curve(ctx, a, c, b, w = 2, col = P.ink) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(c[0], c[1], b[0], b[1]); ink(ctx, w, col); ctx.stroke(); }

// ------------------------------------------------------------------ loft helpers (flat shaded)
export function loftOutline(pts, widths, per = 5) {
  const c = smoothPolyline(pts, per); const n = c.length;
  const wAt = (i) => { const u = (i / (n - 1)) * (widths.length - 1); const k = Math.min(widths.length - 2, Math.floor(u)); const f = u - k; return mix(widths[k], widths[k + 1], f * f * (3 - 2 * f)); };
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(n - 1, i + 1)];
    let nx = -(b.y - a.y), ny = (b.x - a.x); const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L; const w = wAt(i);
    left.push({ x: c[i].x + nx * w, y: c[i].y + ny * w }); right.push({ x: c[i].x - nx * w, y: c[i].y - ny * w });
  }
  return { centre: c, left, right, capStart: wAt(0), capEnd: wAt(n - 1) };
}
export function loftPath(ctx, o, caps = 'round') {
  const { left, right, centre, capStart, capEnd } = o; const n = left.length;
  ctx.beginPath(); ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
  const ed = sub(centre[n - 1], centre[n - 2]); const ea = Math.atan2(ed.y, ed.x);
  if (caps === 'round' || caps === 'end') ctx.arc(centre[n - 1].x, centre[n - 1].y, capEnd, ea - Math.PI / 2, ea + Math.PI / 2, false); else ctx.lineTo(right[n - 1].x, right[n - 1].y);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  const sd = sub(centre[1], centre[0]); const sa = Math.atan2(sd.y, sd.x);
  if (caps === 'round' || caps === 'start') ctx.arc(centre[0].x, centre[0].y, capStart, sa + Math.PI / 2, sa + Math.PI * 1.5, false);
  ctx.closePath();
}
/** Flat tube: base, a shadow band on the right side, a light rim on the left, ink outline. */
function tube(ctx, pts, widths, base, shade, { caps = 'round', shadow = 0.42, outline = true, light = null } = {}) {
  const o = loftOutline(pts, widths);
  loftPath(ctx, o, caps); ctx.fillStyle = base; ctx.fill();
  ctx.save(); loftPath(ctx, o, caps); ctx.clip();
  const n = o.centre.length;
  const band = (side, frac, col) => { ctx.beginPath(); for (let i = 0; i < n; i++) { const q = add(o.centre[i], scale(sub(side[i], o.centre[i]), 1 - frac)); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); } for (let i = n - 1; i >= 0; i--) { const q = add(side[i], scale(sub(side[i], o.centre[i]), 0.8)); ctx.lineTo(q.x, q.y); } ctx.closePath(); ctx.fillStyle = col; ctx.fill(); };
  band(o.right, shadow, shade);
  if (light) band(o.left, 0.12, light);
  ctx.restore();
  if (outline) { loftPath(ctx, o, caps); ink(ctx); ctx.stroke(); }
  return o;
}

// ------------------------------------------------------------------ ground shadow + boots
export function drawShadow(ctx, pose) {
  const r = pose.bones.get('root').head; const k = pose.channels.hoverShadow;
  ctx.save(); ctx.globalAlpha = 0.28 * k; ctx.beginPath(); ctx.ellipse(r.x + 4, r.y + 6, 92, 16, 0, 0, Math.PI * 2); ctx.fillStyle = '#1a1016'; ctx.fill(); ctx.restore();
}
export function drawBoot(ctx, pose, side) {
  ctx.save(); enterBone(ctx, pose, `foot_${side}`); const sg = side === 'L' ? 1 : -1; ctx.scale(sg, 1);
  ctx.beginPath(); ctx.moveTo(-22, -40); ctx.lineTo(16, -40); ctx.quadraticCurveTo(30, -32, 38, -12); ctx.quadraticCurveTo(44, 2, 34, 6); ctx.lineTo(-20, 6); ctx.quadraticCurveTo(-30, 0, -26, -16); ctx.closePath();
  fillStroke(ctx, P.boot);
  ctx.save(); ctx.clip();
  ctx.beginPath(); ctx.ellipse(16, -14, 18, 11, 0.3, 0, Math.PI * 2); ctx.fillStyle = P.bootLight; ctx.fill();
  ctx.beginPath(); ctx.rect(-30, -1, 80, 10); ctx.fillStyle = P.bootSole; ctx.fill();
  ctx.beginPath(); ctx.rect(-26, -30, 60, 7); ctx.fillStyle = P.bootSole; ctx.fill();          // strap
  ctx.restore();
  ctx.beginPath(); ctx.rect(-2, -32, 9, 10); fillStroke(ctx, P.buckle, 1.6);                     // buckle
  line(ctx, [[-22, -40], [16, -40]], 2); line(ctx, [[-26, -30], [34, -30]], 1.6); line(ctx, [[-26, -23], [34, -23]], 1.6);
  curve(ctx, [-22, -1], [8, -4], [36, -1], 2);
  ctx.restore();
}

// ------------------------------------------------------------------ robe, belt, tassels
export function drawRobe(ctx, pose) {
  const B = (n) => pose.bones.get(n);
  const sp = B('spine'), ch = B('chest'), pel = B('pelvis');
  const hemR = B('skirt_R').tail, hemF = B('skirt_F').tail, hemL = B('skirt_L').tail;
  const shR = add(ch.tail, { x: -54, y: 10 }), shL = add(ch.tail, { x: 54, y: 10 });
  const waistR = add(sp.head, { x: -40, y: 0 }), waistL = add(sp.head, { x: 40, y: 0 });
  const body = [V(shR), V(add(ch.head, { x: -50, y: 0 })), V(waistR), V(add(hemR, { x: -28, y: -12 })), V(add(hemR, { x: -6, y: 4 })), V(add(hemF, { x: -34, y: 8 })), V(add(hemF, { x: 0, y: 10 })), V(add(hemF, { x: 34, y: 8 })), V(add(hemL, { x: 6, y: 4 })), V(add(hemL, { x: 28, y: -12 })), V(waistL), V(add(ch.head, { x: 50, y: 0 })), V(shL)];
  spline(ctx, body); fillStroke(ctx, P.robe);
  ctx.save(); spline(ctx, body); ctx.clip();
  // shadow side (screen-right), light rim on the near side
  spline(ctx, [V(add(ch.head, { x: 18, y: 0 })), V(add(sp.head, { x: 10, y: 0 })), V(add(hemF, { x: 12, y: 0 })), V(add(hemL, { x: 30, y: 10 })), V(waistL), V(shL)]); ctx.fillStyle = P.robeShade; ctx.fill();
  spline(ctx, [V(add(ch.head, { x: -50, y: 0 })), V(add(waistR, { x: 0, y: 0 })), V(add(hemR, { x: -28, y: -12 })), V(add(hemR, { x: -16, y: -12 })), V(add(waistR, { x: 9, y: 0 })), V(add(ch.head, { x: -41, y: 0 }))]); ctx.fillStyle = P.robeLight; ctx.fill();
  // long vertical folds falling from the belt: alternating dark panels and ink creases
  for (let i = -3; i <= 3; i++) {
    const x0 = pel.head.x + i * 11, x1 = hemF.x + i * 19; const dark = i % 2 === 0;
    if (dark) { ctx.beginPath(); ctx.moveTo(x0 - 4, pel.head.y - 6); ctx.lineTo(x1 - 7, hemF.y + 12); ctx.lineTo(x1 + 7, hemF.y + 12); ctx.lineTo(x0 + 4, pel.head.y - 6); ctx.closePath(); ctx.fillStyle = 'rgba(0,0,0,0.13)'; ctx.fill(); }
    curve(ctx, [x0, pel.head.y - 4], [mix(x0, x1, 0.5) + (dark ? 3 : -3), mix(pel.head.y, hemF.y, 0.5)], [x1, hemF.y + 8], 1.6, 'rgba(36,26,34,0.75)');
  }
  // chest fold lines under the mantle
  curve(ctx, [ch.head.x - 30, ch.head.y + 10], [ch.head.x - 20, sp.head.y - 10], [waistR[0] + 12, waistR[1] - 4], 1.6, 'rgba(36,26,34,0.6)');
  curve(ctx, [ch.head.x + 30, ch.head.y + 10], [ch.head.x + 22, sp.head.y - 10], [waistL[0] - 12, waistL[1] - 4], 1.6, 'rgba(36,26,34,0.6)');
  ctx.restore();
  // tiered pointed hem panels (back row darker, front row lighter), like the sheet's layered skirt
  const panel = (top, tip, w, col, rim) => {
    ctx.beginPath(); ctx.moveTo(top.x - w * 0.55, top.y); ctx.lineTo(top.x + w * 0.55, top.y); ctx.lineTo(tip.x + w, tip.y - 30); ctx.lineTo(tip.x, tip.y + 6); ctx.lineTo(tip.x - w, tip.y - 30); ctx.closePath(); fillStroke(ctx, col);
    ctx.save(); ctx.clip(); ctx.beginPath(); ctx.moveTo(tip.x + 6, top.y - 10); ctx.lineTo(tip.x + w + 10, top.y - 10); ctx.lineTo(tip.x + w + 10, tip.y + 10); ctx.lineTo(tip.x, tip.y + 10); ctx.closePath(); ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fill();
    line(ctx, [[tip.x - w + 4, tip.y - 28], [tip.x, tip.y + 2]], 1.6, rim); ctx.restore();
  };
  panel(add(pel.head, { x: -34, y: 10 }), add(hemR, { x: 14, y: -6 }), 34, P.robeShade, P.robe);
  panel(add(pel.head, { x: 34, y: 10 }), add(hemL, { x: -14, y: -6 }), 34, P.robeShade, P.robe);
  panel(add(pel.head, { x: -16, y: 6 }), add(hemF, { x: -30, y: 2 }), 36, P.robe, P.robeLight);
  panel(add(pel.head, { x: 16, y: 6 }), add(hemF, { x: 30, y: 2 }), 36, P.robe, P.robeLight);
  panel(add(pel.head, { x: 0, y: 4 }), add(hemF, { x: 0, y: 8 }), 40, P.robeLight, P.robeRim);
  // belt: braided rope across the waist, knot on the character's left with hanging tassels
  ctx.save(); enterBone(ctx, pose, 'pelvis'); ctx.translate(0, -22);
  ctx.beginPath(); ctx.moveTo(-48, -3); ctx.quadraticCurveTo(0, 9, 48, -3); ctx.lineTo(48, 11); ctx.quadraticCurveTo(0, 23, -48, 11); ctx.closePath(); fillStroke(ctx, P.rope, 2.5);
  ctx.save(); ctx.clip(); for (let x = -48; x < 48; x += 8) { ctx.beginPath(); ctx.moveTo(x, -4); ctx.lineTo(x + 4, -4); ctx.lineTo(x + 10, 24); ctx.lineTo(x + 6, 24); ctx.closePath(); ctx.fillStyle = P.ropeShade; ctx.fill(); ctx.beginPath(); ctx.moveTo(x + 4, -4); ctx.lineTo(x + 7, -4); ctx.lineTo(x + 13, 24); ctx.lineTo(x + 10, 24); ctx.closePath(); ctx.fillStyle = P.ropeLight; ctx.fill(); } ctx.restore();
  ctx.beginPath(); ctx.ellipse(32, 6, 13, 10, 0, 0, Math.PI * 2); fillStroke(ctx, P.ropeLight, 2.5);
  ctx.beginPath(); ctx.ellipse(24, 10, 7, 6, 0.4, 0, Math.PI * 2); fillStroke(ctx, P.rope, 2);
  ctx.beginPath(); ctx.ellipse(34, 5, 5, 4, 0, 0, Math.PI * 2); ctx.fillStyle = P.ropeShade; ctx.fill();
  ctx.restore();
  const t1 = pose.bones.get('tassel_01'), t2 = pose.bones.get('tassel_02');
  tube(ctx, [t1.head, t2.head, t2.tail], [5.5, 5.5, 4.5], P.rope, P.ropeShade, { shadow: 0.5, light: P.ropeLight });
  const tip = t2.tail, d = sub(t2.tail, t2.head), L = len(d) || 1, u = scale(d, 1 / L), nrm = { x: -u.y, y: u.x };
  poly(ctx, [V(add(tip, scale(nrm, 10))), V(add(tip, scale(nrm, -10))), V(add(add(tip, scale(u, 30)), scale(nrm, -4))), V(add(add(tip, scale(u, 30)), scale(nrm, 4)))]); fillStroke(ctx, P.ropeLight, 2.5);
  for (const k of [-6, -2, 2, 6]) line(ctx, [V(add(add(tip, scale(u, 6)), scale(nrm, k))), V(add(add(tip, scale(u, 26)), scale(nrm, k * 0.6)))], 1.2, P.ropeShade);
  ctx.beginPath(); ctx.arc(tip.x, tip.y, 6.5, 0, Math.PI * 2); fillStroke(ctx, P.rope, 2);
}

// ------------------------------------------------------------------ mantle, hourglass, neck
export function drawMantle(ctx, pose) {
  ctx.save(); enterBone(ctx, pose, 'mantle');
  for (const [w, h, col, dy, n] of [[84, 92, P.hood, 0, 7], [74, 70, P.hoodLight, -4, 7], [60, 48, P.hood, -8, 5]]) {
    const pts = [[-w, 6 + dy], [w, 6 + dy]];
    for (let i = n; i >= 0; i--) pts.push([-w + (2 * w) * i / n, h + dy - (i % 2 ? 0 : 30)]);
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.quadraticCurveTo(0, -34 + dy, pts[1][0], pts[1][1]);
    for (let i = 2; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); fillStroke(ctx, col);
    ctx.save(); ctx.clip(); ctx.beginPath(); ctx.moveTo(14, -40 + dy); ctx.lineTo(w, -40 + dy); ctx.lineTo(w, h + dy + 20); ctx.lineTo(24, h + dy + 20); ctx.closePath(); ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(-w, 6 + dy); ctx.quadraticCurveTo(0, -34 + dy, w, 6 + dy); ink(ctx, 3, P.hoodLight); ctx.stroke();
    for (let i = 1; i < n; i += 2) line(ctx, [[-w + (2 * w) * i / n, h + dy - 22], [-w + (2 * w) * i / n, -8 + dy]], 1.4, 'rgba(36,26,34,0.45)');
    ctx.restore();
  }
  // hourglass pendant on a cord
  line(ctx, [[-10, -24], [4, 4]], 1.6); line(ctx, [[18, -24], [4, 4]], 1.6);
  ctx.translate(4, 26); ctx.rotate(pose.channels.hourglassSpin * Math.PI * 2);
  ctx.beginPath(); ctx.rect(-13, -20, 26, 6); ctx.rect(-13, 14, 26, 6); fillStroke(ctx, P.brass, 2);
  ctx.beginPath(); ctx.rect(-11, -18, 5, 2); ctx.rect(-11, 16, 5, 2); ctx.fillStyle = P.brassLight; ctx.fill();
  ctx.beginPath(); ctx.moveTo(-10, -14); ctx.lineTo(10, -14); ctx.lineTo(1, 0); ctx.lineTo(10, 14); ctx.lineTo(-10, 14); ctx.lineTo(-1, 0); ctx.closePath(); ctx.fillStyle = P.glass; ctx.fill(); ink(ctx, 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-7, -12); ctx.lineTo(7, -12); ctx.lineTo(0, -3); ctx.closePath(); ctx.moveTo(-9, 13); ctx.lineTo(9, 13); ctx.lineTo(0, 5); ctx.closePath(); ctx.fillStyle = P.sand; ctx.fill();
  line(ctx, [[0, -3], [0, 6]], 1.2, P.sand);
  line(ctx, [[-13, -20], [-13, 14]], 2); line(ctx, [[13, -20], [13, 14]], 2);
  ctx.restore();
}
export function drawNeck(ctx, pose) {
  const nk = pose.bones.get('neck');
  tube(ctx, [add(nk.head, { x: 2, y: 10 }), add(nk.tail, { x: 2, y: 6 })], [9, 9], P.bone, P.boneShade, { caps: 'round' });
  for (let i = 0; i < 3; i++) line(ctx, [[nk.head.x - 5, nk.head.y + 2 - i * 6], [nk.head.x + 9, nk.head.y + 2 - i * 6]], 1.5);
}

// ------------------------------------------------------------------ skull + hood
function hoodPath(ctx, pose) {
  const h = pose.bones.get('head'), h1 = pose.bones.get('hood_01'), h2 = pose.bones.get('hood_02');
  const R = (x, y) => V(add(h.head, rot({ x, y }, h.angle - h.restAngle)));
  ctx.beginPath();
  const pts = [R(-74, -10), R(-82, -64), R(-60, -112), R(-16, -130), V(h1.head), V(h1.tail), V(h2.tail), V(add(h1.tail, { x: 26, y: -4 })), R(54, -120), R(86, -70), R(82, -10), R(64, 26), R(-60, 26)];
  catmullRomPath(ctx, pts.map(([x, y]) => ({ x, y })), true, 0.45);
}
const OPENING = [[-42, -4], [-44, -56], [-10, -86], [34, -86], [62, -52], [60, -6], [42, 18], [-28, 18]];
function openingPath(ctx, pose, inset = 0) {
  const h = pose.bones.get('head'); const R = (x, y) => add(h.head, rot({ x, y }, h.angle - h.restAngle));
  const o = OPENING.map(([x, y]) => R(x * (1 - inset), y * (1 - inset) + inset * 30));
  ctx.moveTo(o[0].x, o[0].y); catmullRomPath(ctx, o, true, 0.5);
}
export function drawHoodBack(ctx, pose) {
  hoodPath(ctx, pose); fillStroke(ctx, P.hoodInside);
  // a mid-tone ring just inside the opening gives the hood depth
  ctx.save(); ctx.beginPath(); openingPath(ctx, pose, 0); ctx.clip();
  ctx.beginPath(); openingPath(ctx, pose, 0); ctx.fillStyle = P.hoodInner; ctx.fill();
  ctx.beginPath(); openingPath(ctx, pose, 0.14); ctx.fillStyle = P.hoodInside; ctx.fill();
  ctx.restore();
}
export function drawSkull(ctx, pose) {
  const ch = pose.channels;
  ctx.save(); enterBone(ctx, pose, 'head'); ctx.translate(8, -56); ctx.scale(1.06, 1.06);
  const cranium = () => { ctx.beginPath(); ctx.moveTo(-44, -6); ctx.bezierCurveTo(-48, -54, -14, -66, 6, -64); ctx.bezierCurveTo(34, -64, 54, -44, 50, -8); ctx.bezierCurveTo(50, 10, 42, 20, 32, 24); ctx.lineTo(30, 44); ctx.quadraticCurveTo(10, 54, -14, 44); ctx.lineTo(-18, 24); ctx.bezierCurveTo(-34, 18, -44, 10, -44, -6); ctx.closePath(); };
  cranium(); fillStroke(ctx, P.bone);
  ctx.save(); cranium(); ctx.clip();
  ctx.beginPath(); ctx.moveTo(16, -66); ctx.lineTo(60, -66); ctx.lineTo(60, 60); ctx.lineTo(22, 60); ctx.quadraticCurveTo(28, 0, 16, -66); ctx.closePath(); ctx.fillStyle = P.boneShade; ctx.fill();   // far side
  ctx.beginPath(); ctx.moveTo(-50, 24); ctx.lineTo(60, 24); ctx.lineTo(60, 60); ctx.lineTo(-50, 60); ctx.closePath(); ctx.fillStyle = 'rgba(0,0,0,0.1)'; ctx.fill();                       // under the cheekbones
  ctx.beginPath(); ctx.ellipse(-14, -46, 18, 9, -0.3, 0, Math.PI * 2); ctx.fillStyle = P.boneLight; ctx.fill();                                                                             // forehead light
  ctx.restore();
  // brow ridge and cheekbones
  curve(ctx, [-38, -22], [-12, -36], [8, -30], 2); curve(ctx, [8, -30], [24, -34], [42, -24], 2);
  curve(ctx, [-40, 6], [-28, 16], [-16, 22], 1.6); curve(ctx, [46, 2], [40, 14], [32, 22], 1.6);
  curve(ctx, [-30, 14], [-18, 12], [-6, 18], 1.4, 'rgba(36,26,34,0.5)');
  // sockets with a lighter rim and the glint
  for (const [x, y, rx, ry, far] of [[-18, -16, 16, 14, false], [22, -16, 14, 13, true]]) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ch.brow * (far ? -0.35 : 0.35));
    const sock = () => { ctx.beginPath(); ctx.moveTo(-rx, -ry * 0.4); ctx.quadraticCurveTo(-rx * 0.6, -ry * 1.15 - ch.brow * 4, rx * 0.4, -ry * 0.95 + ch.brow * 5); ctx.quadraticCurveTo(rx * 1.15, -ry * 0.2, rx * 0.6, ry * 0.95); ctx.quadraticCurveTo(-rx * 0.6, ry * 1.25, -rx, -ry * 0.4); ctx.closePath(); };
    sock(); fillStroke(ctx, P.socketRim, 2); ctx.save(); sock(); ctx.clip(); ctx.beginPath(); ctx.ellipse(1, 2, rx * 0.85, ry * 0.85, 0, 0, Math.PI * 2); ctx.fillStyle = P.socket; ctx.fill(); ctx.restore();
    const g = clamp(ch.eyeGlow); const r = 3.8 * ch.eyeSize;
    if (g > 0) { ctx.beginPath(); ctx.arc(2, 1, r * 2.8, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,150,40,${0.28 * g})`; ctx.fill(); ctx.beginPath(); ctx.arc(2, 1, r, 0, Math.PI * 2); ctx.fillStyle = P.glint; ctx.globalAlpha = g; ctx.fill(); ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(1, 0, r * 0.4, 0, Math.PI * 2); ctx.fillStyle = '#fff2c8'; ctx.globalAlpha = g; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.restore();
  }
  // nasal cavity
  ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(11, 14); ctx.lineTo(4, 17); ctx.lineTo(-2, 14); ctx.closePath(); fillStroke(ctx, P.socket, 2);
  // teeth: upper row set in the maxilla, individual teeth with gaps; the jaw drops with `jaw`
  const drop = ch.jaw * 14;
  ctx.beginPath(); ctx.moveTo(-18, 24); ctx.quadraticCurveTo(8, 30, 32, 24); ctx.lineTo(32, 32 + drop); ctx.quadraticCurveTo(8, 42 + drop, -16, 32 + drop); ctx.closePath(); fillStroke(ctx, P.socket, 2);
  for (let i = 0; i < 8; i++) { const x = -15 + i * 6, h = 7 + (i % 2) * 1.5, yy = 25 + Math.abs(i - 3.5) * 0.5; ctx.beginPath(); ctx.roundRect(x, yy, 4.6, h, 1.4); fillStroke(ctx, i > 5 ? P.boneShade : P.bone, 1.3); }
  for (let i = 0; i < 7; i++) { const x = -13 + i * 6, yy = 32 + drop - 1; ctx.beginPath(); ctx.roundRect(x, yy - 5, 4.2, 6, 1.2); fillStroke(ctx, i > 4 ? P.boneShade : P.bone, 1.2); }
  curve(ctx, [-18, 24], [8, 30], [32, 24], 2);
  // cracks
  line(ctx, [[38, -4], [34, 8], [40, 14]], 1.5); line(ctx, [[-40, -40], [-32, -34], [-36, -26]], 1.3);
  ctx.restore();
}
export function drawHoodFront(ctx, pose) {
  const h = pose.bones.get('head'); const h1 = pose.bones.get('hood_01');
  const R = (x, y) => V(add(h.head, rot({ x, y }, h.angle - h.restAngle)));
  hoodPath(ctx, pose); openingPath(ctx, pose, 0); ctx.fillStyle = P.hood; ctx.fill('evenodd');
  ctx.save(); hoodPath(ctx, pose); openingPath(ctx, pose, 0); ctx.clip('evenodd');
  const s = [R(22, -134), R(124, -134), R(124, 40), R(62, 40), R(72, -40)]; ctx.beginPath(); catmullRomPath(ctx, s.map(([x, y]) => ({ x, y })), true, 0.4); ctx.fillStyle = P.hoodShade; ctx.fill();
  const l = [R(-92, -40), R(-78, -104), R(-50, -118), R(-56, -74), R(-68, -20)]; ctx.beginPath(); catmullRomPath(ctx, l.map(([x, y]) => ({ x, y })), true, 0.4); ctx.fillStyle = P.hoodLight; ctx.fill();
  // rim highlight along the opening, creases over the crown and toward the point
  ctx.beginPath(); openingPath(ctx, pose, -0.06); ink(ctx, 4, P.hoodLight); ctx.stroke();
  curve(ctx, R(-20, -112), R(-2, -126), [h1.head.x + 2, h1.head.y + 10], 1.8, 'rgba(36,26,34,0.7)');
  curve(ctx, R(-60, -70), R(-40, -100), R(-12, -112), 1.6, 'rgba(36,26,34,0.55)');
  curve(ctx, R(50, -108), R(64, -80), R(70, -40), 1.6, 'rgba(36,26,34,0.55)');
  ctx.restore();
  hoodPath(ctx, pose); ink(ctx); ctx.stroke();
  ctx.beginPath(); openingPath(ctx, pose, 0); ink(ctx); ctx.stroke();
  const h2 = pose.bones.get('hood_02'); curve(ctx, [h1.head.x - 6, h1.head.y + 10], [h1.tail.x, h1.tail.y + 10], [h2.tail.x + 6, h2.tail.y + 8], 1.6, 'rgba(36,26,34,0.5)');
}

// ------------------------------------------------------------------ sleeves + bony hands
export function drawSleeve(ctx, pose, side) {
  const ua = pose.bones.get(`upperarm_${side}`), fa = pose.bones.get(`forearm_${side}`);
  const end = add(fa.head, scale(sub(fa.tail, fa.head), 0.82));
  const o = tube(ctx, [add(ua.head, scale(sub(ua.tail, ua.head), 0.22)), ua.tail, end], [18, 26, 42], P.robe, P.robeShade, { caps: 'start', shadow: 0.4, outline: false, light: P.robeLight });
  const d = sub(fa.tail, fa.head), L = len(d) || 1, u = scale(d, 1 / L), n = { x: -u.y, y: u.x };
  loftPath(ctx, o, 'start'); ink(ctx); ctx.stroke();
  // elbow wrinkles
  const e = ua.tail; for (const k of [-6, 4]) curve(ctx, V(add(add(e, scale(n, 18)), scale(u, k))), V(add(e, scale(u, k + 4))), V(add(add(e, scale(n, -14)), scale(u, k + 2))), 1.5, 'rgba(36,26,34,0.55)');
  // bell cuff: dark opening with a lit lip
  const a = Math.atan2(u.y, u.x) + Math.PI / 2;
  ctx.beginPath(); ctx.ellipse(end.x, end.y, 42, 11, a, 0, Math.PI * 2); fillStroke(ctx, P.hoodInside, 2.5);
  ctx.beginPath(); ctx.ellipse(end.x, end.y, 42, 11, a, Math.PI, Math.PI * 2); ctx.fillStyle = P.robe; ctx.fill();
  ctx.beginPath(); ctx.ellipse(end.x, end.y, 42, 11, a, Math.PI + 0.3, Math.PI * 2 - 0.3); ink(ctx, 3, P.robeLight); ctx.stroke();
}
function finger(ctx, w, l1, l2, c1, c2) {
  ctx.save(); ctx.rotate(c1);
  ctx.beginPath(); ctx.roundRect(-w / 2, 0, w, l1, w / 2); fillStroke(ctx, P.bone, 1.6); ctx.beginPath(); ctx.arc(0, l1, w * 0.42, 0, Math.PI * 2); ctx.fillStyle = P.boneShade; ctx.fill();
  ctx.translate(0, l1); ctx.rotate(c2);
  ctx.beginPath(); ctx.roundRect(-w / 2 + 0.3, 0, w - 0.6, l2, w / 2); fillStroke(ctx, P.boneShade, 1.6);
  ctx.restore();
}
/** Free hand in the hand bone's frame (fingers hang; `hand_*` curls them). */
export function drawHand(ctx, pose, side) {
  if (pose.gripSides?.includes(side)) return;
  const grip = clamp(pose.channels[`hand_${side}`]); const sg = side === 'L' ? 1 : -1;
  ctx.save(); enterBone(ctx, pose, `hand_${side}`); ctx.scale(sg, 1);
  ctx.beginPath(); ctx.moveTo(-10, 2); ctx.lineTo(10, 2); ctx.quadraticCurveTo(15, 12, 12, 24); ctx.lineTo(-12, 24); ctx.quadraticCurveTo(-15, 12, -10, 2); ctx.closePath(); fillStroke(ctx, P.bone, 2.2);
  for (const x of [-5, 1, 7]) line(ctx, [[x, 6], [x - 1, 21]], 1.4, 'rgba(36,26,34,0.6)');
  for (let i = 0; i < 4; i++) { ctx.save(); ctx.translate(-9 + i * 6, 24); finger(ctx, 5, 12, 10, mix(0.1, 0.6, grip) * (i === 0 ? 1.2 : 1), mix(0.1, 1.1, grip)); ctx.restore(); }
  ctx.save(); ctx.translate(-11, 8); finger(ctx, 5, 11, 8, -0.9 + grip * 1.2, 0.5 + grip * 0.6); ctx.restore();
  ctx.restore();
}
/** Gripping hand drawn around the scythe's grip marker: `part` 'back' (palm, behind the shaft) or 'front' (fingers + thumb over it). */
export function drawGripHand(ctx, pose, side, part) {
  if (!pose.gripSides?.includes(side)) return;
  const b = pose.bones.get('scythe'); const f = side === 'L' ? PROP.gripTop : PROP.gripLow;
  const g = pose.propPoint(f); const wrist = pose.bones.get(`hand_${side}`).head;
  ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(b.angle);
  // which side of the shaft the wrist comes from decides where the palm sits
  const w = rot(sub(wrist, g), -b.angle); const sgn = w.y >= 0 ? 1 : -1;
  if (part === 'back') {
    // palm block behind the shaft, bridging to the wrist
    ctx.beginPath(); ctx.moveTo(-13, sgn * 2); ctx.lineTo(13, sgn * 2); ctx.lineTo(w.x + 9, w.y); ctx.lineTo(w.x - 9, w.y); ctx.closePath(); fillStroke(ctx, P.bone, 2.2);
    ctx.beginPath(); ctx.ellipse(0, sgn * 9, 14, 11, 0, 0, Math.PI * 2); fillStroke(ctx, P.bone, 2.2);
    for (const x of [-6, 0, 6]) line(ctx, [[x, sgn * 6], [x * 0.8 + w.x * 0.3, w.y * 0.6]], 1.3, 'rgba(36,26,34,0.55)');
  } else {
    // four fingers wrap over the shaft and curl under it; the thumb crosses from the other side
    for (let i = 0; i < 4; i++) { ctx.save(); ctx.translate(-9 + i * 6, -sgn * 7); ctx.rotate(sgn > 0 ? Math.PI : 0); finger(ctx, 5, 10, 9, sgn * -0.2, sgn * -1.25); ctx.restore(); }
    ctx.save(); ctx.translate(-14, sgn * 4); ctx.rotate(sgn > 0 ? -1.3 : 1.3); finger(ctx, 5.5, 10, 8, 0, sgn * -0.9); ctx.restore();
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(-9 + i * 6, -sgn * 7, 2.4, 0, Math.PI * 2); ctx.fillStyle = P.boneLight; ctx.fill(); }
  }
  ctx.restore();
}

// ------------------------------------------------------------------ scythe
export function drawScythe(ctx, pose, part = 'all') {
  if (pose.channels.propVisible < 0.5) return;
  const b = pose.bones.get('scythe'); const L = b.length;
  ctx.save(); ctx.translate(b.head.x, b.head.y); ctx.rotate(b.angle);
  const b0 = L * PROP.butt, b1 = L * PROP.blade;
  if (part !== 'blade') {
    const pts = [{ x: b0, y: 0 }, { x: mix(b0, b1, 0.24), y: 5 }, { x: mix(b0, b1, 0.52), y: -4 }, { x: mix(b0, b1, 0.8), y: 4 }, { x: b1, y: 0 }];
    const o = tube(ctx, pts, [7, 8, 8, 8, 7.5], P.wood, P.woodShade, { shadow: 0.5, light: P.woodLight });
    // grain and knots
    ctx.save(); loftPath(ctx, o); ctx.clip();
    for (const u of [0.08, 0.36, 0.62, 0.88]) curve(ctx, [mix(b0, b1, u), -3], [mix(b0, b1, u + 0.06), 1], [mix(b0, b1, u + 0.12), -2], 1.2, 'rgba(36,26,34,0.5)');
    for (const u of [0.42, 0.68]) { ctx.beginPath(); ctx.ellipse(mix(b0, b1, u), 2, 4, 2.5, 0, 0, Math.PI * 2); fillStroke(ctx, P.woodShade, 1.2); }
    ctx.restore();
    // cloth wraps: crossed bands
    for (const u of [0.22, 0.74]) { ctx.save(); ctx.translate(mix(b0, b1, u), 0); for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(i * 6 - 2, -9.5); ctx.lineTo(i * 6 + 5, 9.5); ctx.lineWidth = 5.5; ctx.strokeStyle = i % 2 ? P.wrapShade : P.wrap; ctx.lineCap = 'butt'; ctx.stroke(); } for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(i * 6 + 6, -9.5); ctx.lineTo(i * 6 - 1, 9.5); ctx.lineWidth = 1.2; ctx.strokeStyle = P.wrapShade; ctx.stroke(); } ctx.beginPath(); ctx.rect(-4, -9.5, 32, 19); ink(ctx, 2); ctx.stroke(); ctx.restore(); }
    ctx.beginPath(); ctx.arc(b0, 0, 9, 0, Math.PI * 2); fillStroke(ctx, P.woodShade, 2.5); ctx.beginPath(); ctx.arc(b0, 0, 4, 0, Math.PI * 2); ctx.fillStyle = P.wood; ctx.fill();
  }
  if (part !== 'shaft') {
    ctx.translate(b1, 0);
    // riveted brass collar, strap, tang
    ctx.beginPath(); ctx.rect(-16, -11, 26, 22); fillStroke(ctx, P.brass, 2.5); ctx.beginPath(); ctx.rect(-16, -11, 26, 7); ctx.fillStyle = P.brassLight; ctx.fill(); ctx.beginPath(); ctx.rect(-16, 5, 26, 6); ctx.fillStyle = P.brassShade; ctx.fill();
    for (const x of [-10, -3, 4]) { ctx.beginPath(); ctx.arc(x, 0, 2.2, 0, Math.PI * 2); fillStroke(ctx, P.brassShade, 1); }
    ctx.beginPath(); ctx.rect(-16, -11, 26, 22); ink(ctx, 2); ctx.stroke();
    // blade: thick dark spine, mid steel, bright edge; weathered pits, a chipped notch
    const blade = () => { ctx.beginPath(); ctx.moveTo(6, -10); ctx.quadraticCurveTo(90, -30, 150, -110); ctx.quadraticCurveTo(200, -175, 210, -250); ctx.quadraticCurveTo(170, -190, 110, -150); ctx.quadraticCurveTo(50, -110, 8, 12); ctx.closePath(); };
    blade(); fillStroke(ctx, P.steel);
    ctx.save(); blade(); ctx.clip();
    ctx.beginPath(); ctx.moveTo(6, -10); ctx.quadraticCurveTo(90, -30, 150, -110); ctx.quadraticCurveTo(200, -175, 210, -250); ctx.quadraticCurveTo(190, -185, 140, -128); ctx.quadraticCurveTo(84, -74, 34, -26); ctx.closePath(); ctx.fillStyle = P.steelShade; ctx.fill();
    ctx.beginPath(); ctx.moveTo(6, -10); ctx.quadraticCurveTo(90, -30, 150, -110); ctx.quadraticCurveTo(200, -175, 210, -250); ctx.quadraticCurveTo(196, -192, 160, -140); ctx.quadraticCurveTo(110, -70, 50, -30); ctx.closePath(); ctx.fillStyle = P.steelDark; ctx.fill();
    ctx.beginPath(); ctx.moveTo(10, 8); ctx.quadraticCurveTo(60, -100, 120, -148); ctx.quadraticCurveTo(170, -190, 205, -246); ctx.lineWidth = 5; ctx.strokeStyle = P.steelLight; ctx.lineCap = 'round'; ctx.stroke();
    for (let i = 0; i < 14; i++) { const u = 0.06 + i * 0.065; ctx.beginPath(); ctx.ellipse(mix(30, 190, u) + (hash(i, 2) - 0.5) * 34, mix(-30, -210, u) + (hash(i, 3) - 0.5) * 30, 2.5 + hash(i, 4) * 4, 1.8 + hash(i, 5) * 2.5, hash(i, 6) * 3, 0, Math.PI * 2); ctx.fillStyle = P.steelSpot; ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.beginPath(); ctx.moveTo(64, -86); ctx.lineTo(72, -70); ctx.lineTo(80, -92); ctx.closePath(); ctx.fillStyle = P.hoodInside; ctx.globalAlpha = 0.0; ctx.fill(); ctx.globalAlpha = 1;
    ctx.restore();
    line(ctx, [[26, -16], [36, -34], [42, -18]], 2);                   // heel notch
    line(ctx, [[96, -110], [104, -96], [112, -116]], 2);                 // chip on the edge
    // motion trail
    const tr = clamp(pose.channels.trail);
    if (tr > 0) { ctx.beginPath(); ctx.moveTo(210, -250); ctx.quadraticCurveTo(80, -330, -160, -260); ctx.quadraticCurveTo(60, -240, 150, -150); ctx.closePath(); ctx.fillStyle = `rgba(230,240,255,${0.45 * tr})`; ctx.fill(); }
  }
  ctx.restore();
}
