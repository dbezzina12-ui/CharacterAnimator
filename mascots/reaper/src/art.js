// Vector artwork for the Grim Reaper, drawn with Canvas 2D in the rig's root space in a flat,
// cel-shaded style: one base colour, one shadow colour, a thick ink line. Cloth pieces are swept
// along their bones; the skull, hands, boots, hourglass and scythe are rigid pieces in bone frames.
import { smoothPolyline, catmullRomPath, clamp, mix, rot, add, sub, scale, len, hash } from './math.js';
import { PROP } from './skeleton.js';

export const PALETTE = {
  ink: '#241a22',
  hood: '#3a2433', hoodShade: '#2a1823', hoodLight: '#4a3042', hoodInside: '#140d12',
  robe: '#5c2548', robeShade: '#431a36', robeLight: '#6e2d58',
  rope: '#c6a16a', ropeShade: '#96763f', ropeLight: '#e0c08a',
  bone: '#eadfca', boneShade: '#c8b797', socket: '#120c10', glint: '#ffb347',
  boot: '#2a2226', bootLight: '#3d3338', bootSole: '#1a1417',
  brass: '#b58a3c', brassLight: '#e0b65c', brassShade: '#7d5a24', sand: '#e6c87a', glass: 'rgba(200,230,240,0.35)',
  wood: '#6e4a2c', woodShade: '#4e3220', woodLight: '#8a6038', wrap: '#bca57a', wrapShade: '#8f7a52',
  steel: '#c9ced3', steelShade: '#8c949b', steelLight: '#eef1f3', steelSpot: '#6f7780',
};
const P = PALETTE;
const INK_W = 3;

export function ink(ctx, w = INK_W) { ctx.lineWidth = w; ctx.strokeStyle = P.ink; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; }
function fillStroke(ctx, color, w = INK_W) { ctx.fillStyle = color; ctx.fill(); if (w) { ink(ctx, w); ctx.stroke(); } }
function poly(ctx, pts, close = true) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); if (close) ctx.closePath(); }
function spline(ctx, pts, close = true) { ctx.beginPath(); catmullRomPath(ctx, pts.map(([x, y]) => ({ x, y })), close, 0.5); }
export function enterBone(ctx, pose, name) { const b = pose.bones.get(name); ctx.translate(b.head.x, b.head.y); ctx.rotate(b.angle - b.restAngle); }
const V = (p) => [p.x, p.y];

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
/** Flat tube with a shadow band on its right side (light comes from the upper left). */
function tube(ctx, pts, widths, base, shade, { caps = 'round', shadow = 0.42, outline = true } = {}) {
  const o = loftOutline(pts, widths);
  loftPath(ctx, o, caps); ctx.fillStyle = base; ctx.fill();
  ctx.save(); loftPath(ctx, o, caps); ctx.clip();
  const n = o.centre.length; const inner = o.centre.map((c, i) => ({ x: mix(c.x, o.right[i].x, 1 - shadow), y: mix(c.y, o.right[i].y, 1 - shadow) }));
  ctx.beginPath(); ctx.moveTo(inner[0].x, inner[0].y); for (let i = 1; i < n; i++) ctx.lineTo(inner[i].x, inner[i].y);
  for (let i = n - 1; i >= 0; i--) { const q = add(o.right[i], scale(sub(o.right[i], o.centre[i]), 0.6)); ctx.lineTo(q.x, q.y); } ctx.closePath();
  ctx.fillStyle = shade; ctx.fill(); ctx.restore();
  if (outline) { loftPath(ctx, o, caps); ink(ctx); ctx.stroke(); }
  return o;
}
function chain(pose, names) { const pts = names.map((n) => pose.bones.get(n).head); pts.push(pose.bones.get(names[names.length - 1]).tail); return pts; }

// ------------------------------------------------------------------ ground shadow + boots
export function drawShadow(ctx, pose) {
  const r = pose.bones.get('root').head; const k = pose.channels.hoverShadow;
  ctx.save(); ctx.globalAlpha = 0.28 * k; ctx.beginPath(); ctx.ellipse(r.x + 4, r.y + 6, 92, 16, 0, 0, Math.PI * 2); ctx.fillStyle = '#1a1016'; ctx.fill(); ctx.restore();
}
export function drawBoot(ctx, pose, side) {
  ctx.save(); enterBone(ctx, pose, `foot_${side}`); const sg = side === 'L' ? 1 : -1; ctx.scale(sg, 1);
  ctx.beginPath(); ctx.moveTo(-22, -36); ctx.lineTo(16, -36); ctx.quadraticCurveTo(30, -30, 38, -12); ctx.quadraticCurveTo(44, 2, 34, 6); ctx.lineTo(-20, 6); ctx.quadraticCurveTo(-30, 0, -26, -16); ctx.closePath();
  fillStroke(ctx, P.boot);
  ctx.save(); ctx.clip(); ctx.beginPath(); ctx.ellipse(18, -12, 16, 10, 0.3, 0, Math.PI * 2); ctx.fillStyle = P.bootLight; ctx.fill(); ctx.beginPath(); ctx.rect(-30, 0, 80, 8); ctx.fillStyle = P.bootSole; ctx.fill(); ctx.restore();
  ctx.beginPath(); ctx.moveTo(-22, -36); ctx.lineTo(16, -36); ink(ctx, 2); ctx.stroke();
  ctx.restore();
}

// ------------------------------------------------------------------ robe, belt, tassels
export function drawRobe(ctx, pose) {
  const B = (n) => pose.bones.get(n);
  const sp = B('spine'), ch = B('chest'), pel = B('pelvis');
  const hemR = B('skirt_R').tail, hemF = B('skirt_F').tail, hemL = B('skirt_L').tail;
  const shR = add(ch.tail, { x: -54, y: 10 }), shL = add(ch.tail, { x: 54, y: 10 });
  const waistR = add(sp.head, { x: -40, y: 0 }), waistL = add(sp.head, { x: 40, y: 0 });
  // body: shoulders -> narrow waist -> wide flaring hem (the hem follows the three skirt bones so it sways)
  const body = [V(shR), V(add(ch.head, { x: -50, y: 0 })), V(waistR), V(add(hemR, { x: -28, y: -12 })), V(add(hemR, { x: -6, y: 4 })), V(add(hemF, { x: -34, y: 8 })), V(add(hemF, { x: 0, y: 10 })), V(add(hemF, { x: 34, y: 8 })), V(add(hemL, { x: 6, y: 4 })), V(add(hemL, { x: 28, y: -12 })), V(waistL), V(add(ch.head, { x: 50, y: 0 })), V(shL)];
  spline(ctx, body); fillStroke(ctx, P.robe);
  ctx.save(); spline(ctx, body); ctx.clip();
  // shadow side (screen-right) and fold shadows falling from the belt
  spline(ctx, [V(add(ch.head, { x: 20, y: 0 })), V(add(sp.head, { x: 12, y: 0 })), V(add(hemF, { x: 14, y: 0 })), V(add(hemL, { x: 30, y: 10 })), V(waistL), V(shL)]); ctx.fillStyle = P.robeShade; ctx.fill();
  for (const [x0, x1] of [[-30, -22], [-6, 2], [18, 26]]) { ctx.beginPath(); ctx.moveTo(pel.head.x + x0, pel.head.y - 10); ctx.lineTo(hemF.x + x0 * 1.6, hemF.y); ctx.lineTo(hemF.x + x1 * 1.6, hemF.y); ctx.lineTo(pel.head.x + x1, pel.head.y - 10); ctx.closePath(); ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fill(); }
  // highlight on the near side
  spline(ctx, [V(add(ch.head, { x: -52, y: 0 })), V(add(waistR, { x: 10, y: 0 })), V(add(hemR, { x: 16, y: 0 })), V(add(hemR, { x: -4, y: 0 })), V(add(waistR, { x: -2, y: 0 }))]); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
  ctx.restore();
  // layered pointed panels over the hem
  const panel = (top, tip, w, col) => { ctx.beginPath(); ctx.moveTo(top.x - w * 0.55, top.y); ctx.lineTo(top.x + w * 0.55, top.y); ctx.lineTo(tip.x + w, tip.y - 30); ctx.lineTo(tip.x, tip.y + 6); ctx.lineTo(tip.x - w, tip.y - 30); ctx.closePath(); fillStroke(ctx, col); ctx.save(); ctx.clip(); ctx.beginPath(); ctx.moveTo(tip.x + 6, top.y - 10); ctx.lineTo(tip.x + w + 10, top.y - 10); ctx.lineTo(tip.x + w + 10, tip.y + 10); ctx.lineTo(tip.x, tip.y + 10); ctx.closePath(); ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fill(); ctx.restore(); };
  panel(add(pel.head, { x: -30, y: 10 }), add(hemR, { x: 10, y: 0 }), 36, P.robeShade); panel(add(pel.head, { x: 30, y: 10 }), add(hemL, { x: -10, y: 0 }), 36, P.robeShade); panel(add(pel.head, { x: 0, y: 6 }), add(hemF, { x: 0, y: 8 }), 42, P.robe);
  // belt: twisted rope across the waist, knot on the character's left with hanging tassels
  ctx.save(); enterBone(ctx, pose, 'pelvis'); ctx.translate(0, -22);
  ctx.beginPath(); ctx.moveTo(-46, -2); ctx.quadraticCurveTo(0, 8, 46, -2); ctx.lineTo(46, 10); ctx.quadraticCurveTo(0, 20, -46, 10); ctx.closePath(); fillStroke(ctx, P.rope, 2.5);
  ink(ctx, 1.6); for (let x = -40; x < 44; x += 9) { ctx.beginPath(); ctx.moveTo(x, 0 + Math.abs(x) * -0.02); ctx.lineTo(x + 5, 10); ctx.stroke(); }
  ctx.beginPath(); ctx.ellipse(32, 6, 11, 9, 0, 0, Math.PI * 2); fillStroke(ctx, P.ropeLight, 2.5);
  ctx.beginPath(); ctx.ellipse(32, 6, 5, 4, 0, 0, Math.PI * 2); ctx.fillStyle = P.ropeShade; ctx.fill();
  ctx.restore();
  const t1 = pose.bones.get('tassel_01'), t2 = pose.bones.get('tassel_02');
  tube(ctx, [t1.head, t2.head, t2.tail], [5, 5, 4], P.rope, P.ropeShade, { shadow: 0.5 });
  const tip = t2.tail, d = sub(t2.tail, t2.head), L = len(d) || 1, u = scale(d, 1 / L);
  poly(ctx, [V(add(tip, scale({ x: -u.y, y: u.x }, 9))), V(add(tip, scale({ x: u.y, y: -u.x }, 9))), V(add(tip, scale(u, 26)))]); fillStroke(ctx, P.ropeLight, 2.5);
  ctx.beginPath(); ctx.arc(tip.x, tip.y, 6, 0, Math.PI * 2); fillStroke(ctx, P.rope, 2);
}

// ------------------------------------------------------------------ mantle, hourglass, neck
export function drawMantle(ctx, pose) {
  ctx.save(); enterBone(ctx, pose, 'mantle');
  for (const [w, h, col, dy] of [[98, 92, P.hood, 0], [86, 62, P.hoodLight, -6]]) {
    const pts = [[-w, -12 + dy], [w, -12 + dy]];
    for (let i = 6; i >= 0; i--) pts.push([-w + (2 * w) * i / 6, h + dy - (i % 2 ? 0 : 30)]);
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.quadraticCurveTo(0, -28 + dy, pts[1][0], pts[1][1]);
    for (let i = 2; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); fillStroke(ctx, col);
    ctx.save(); ctx.clip(); ctx.beginPath(); ctx.moveTo(14, -30 + dy); ctx.lineTo(w, -30 + dy); ctx.lineTo(w, h + dy + 20); ctx.lineTo(24, h + dy + 20); ctx.closePath(); ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fill(); ctx.restore();
  }
  // hourglass pendant
  ctx.translate(4, 22); ctx.rotate(pose.channels.hourglassSpin * Math.PI * 2);
  ctx.beginPath(); ctx.rect(-12, -18, 24, 5); ctx.rect(-12, 13, 24, 5); fillStroke(ctx, P.brass, 2);
  ctx.beginPath(); ctx.moveTo(-9, -13); ctx.lineTo(9, -13); ctx.lineTo(1, 0); ctx.lineTo(9, 13); ctx.lineTo(-9, 13); ctx.lineTo(-1, 0); ctx.closePath(); ctx.fillStyle = P.glass; ctx.fill(); ink(ctx, 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-6, -11); ctx.lineTo(6, -11); ctx.lineTo(0, -2); ctx.closePath(); ctx.moveTo(-8, 12); ctx.lineTo(8, 12); ctx.lineTo(0, 6); ctx.closePath(); ctx.fillStyle = P.sand; ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(0, -18); ink(ctx, 2); ctx.stroke();
  ctx.restore();
}
export function drawNeck(ctx, pose) {
  const nk = pose.bones.get('neck');
  tube(ctx, [add(nk.head, { x: 2, y: 10 }), add(nk.tail, { x: 2, y: 6 })], [9, 9], P.bone, P.boneShade, { caps: 'round' });
  ink(ctx, 1.5); for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(nk.head.x - 5, nk.head.y + 2 - i * 6); ctx.lineTo(nk.head.x + 9, nk.head.y + 2 - i * 6); ctx.stroke(); }
}

// ------------------------------------------------------------------ skull + hood
function hoodPath(ctx, pose) {
  const h = pose.bones.get('head'), h1 = pose.bones.get('hood_01'), h2 = pose.bones.get('hood_02');
  const c = add(h.head, rot({ x: 6, y: -62 }, h.angle - h.restAngle));   // skull centre
  const R = (x, y) => V(add(h.head, rot({ x, y }, h.angle - h.restAngle)));
  ctx.beginPath();
  const pts = [R(-74, -10), R(-82, -64), R(-60, -112), R(-16, -130), V(h1.head), V(h1.tail), V(h2.tail), V(add(h1.tail, { x: 26, y: -4 })), R(54, -120), R(86, -70), R(82, -10), R(64, 26), R(-60, 26)];
  catmullRomPath(ctx, pts.map(([x, y]) => ({ x, y })), true, 0.45);
  return c;
}
export function drawHoodBack(ctx, pose) {
  hoodPath(ctx, pose); fillStroke(ctx, P.hoodInside);
}
export function drawSkull(ctx, pose) {
  const ch = pose.channels;
  ctx.save(); enterBone(ctx, pose, 'head'); ctx.translate(8, -56); ctx.scale(1.06, 1.06);
  // cranium + jaw (slightly turned to screen-right)
  ctx.beginPath(); ctx.moveTo(-44, -6); ctx.bezierCurveTo(-48, -54, -14, -66, 6, -64); ctx.bezierCurveTo(34, -64, 54, -44, 50, -8);
  ctx.bezierCurveTo(50, 10, 42, 20, 32, 24); ctx.lineTo(30, 44); ctx.quadraticCurveTo(10, 54, -14, 44); ctx.lineTo(-18, 24); ctx.bezierCurveTo(-34, 18, -44, 10, -44, -6); ctx.closePath();
  fillStroke(ctx, P.bone);
  ctx.save(); ctx.clip();
  ctx.beginPath(); ctx.moveTo(14, -66); ctx.lineTo(60, -66); ctx.lineTo(60, 60); ctx.lineTo(20, 60); ctx.quadraticCurveTo(26, 0, 14, -66); ctx.closePath(); ctx.fillStyle = P.boneShade; ctx.fill();
  ctx.beginPath(); ctx.moveTo(-50, 22); ctx.lineTo(60, 22); ctx.lineTo(60, 60); ctx.lineTo(-50, 60); ctx.closePath(); ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fill();
  ctx.restore();
  // sockets, brow tilt for anger
  for (const [x, y, rx, ry, far] of [[-18, -18, 15, 13, false], [22, -18, 13, 12, true]]) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ch.brow * (far ? -0.35 : 0.35));
    ctx.beginPath(); ctx.moveTo(-rx, -ry * 0.4); ctx.quadraticCurveTo(-rx * 0.6, -ry * 1.1 - ch.brow * 4, rx * 0.4, -ry * 0.9 + ch.brow * 5); ctx.quadraticCurveTo(rx * 1.1, -ry * 0.2, rx * 0.6, ry * 0.9); ctx.quadraticCurveTo(-rx * 0.6, ry * 1.2, -rx, -ry * 0.4); ctx.closePath();
    fillStroke(ctx, P.socket, 2);
    const g = clamp(ch.eyeGlow); const r = 3.6 * ch.eyeSize;
    if (g > 0) { ctx.beginPath(); ctx.arc(2, 1, r * 2.6, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,150,40,${0.25 * g})`; ctx.fill(); ctx.beginPath(); ctx.arc(2, 1, r, 0, Math.PI * 2); ctx.fillStyle = P.glint; ctx.globalAlpha = g; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.restore();
  }
  // nasal cavity
  ctx.beginPath(); ctx.moveTo(4, 2); ctx.lineTo(10, 14); ctx.lineTo(-1, 16); ctx.closePath(); fillStroke(ctx, P.socket, 2);
  // teeth / grin, jaw drops with `jaw`
  const drop = ch.jaw * 14;
  ctx.beginPath(); ctx.moveTo(-16, 26); ctx.quadraticCurveTo(8, 36 + drop * 0.3, 30, 26); ctx.lineTo(30, 32 + drop); ctx.quadraticCurveTo(8, 42 + drop, -14, 32 + drop); ctx.closePath(); fillStroke(ctx, drop > 2 ? P.socket : P.bone, 2);
  ink(ctx, 1.8); for (let x = -12; x <= 26; x += 6) { ctx.beginPath(); ctx.moveTo(x, 27 + (x > 0 ? x * 0.1 : 0)); ctx.lineTo(x, 33 + drop * 0.9 + (x > 0 ? x * 0.1 : 0)); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(-16, 26); ctx.quadraticCurveTo(8, 36, 30, 26); ctx.stroke();
  // cheek crack
  ink(ctx, 1.5); ctx.beginPath(); ctx.moveTo(38, -2); ctx.lineTo(34, 8); ctx.lineTo(40, 14); ctx.stroke();
  ctx.restore();
}
export function drawHoodFront(ctx, pose) {
  const h = pose.bones.get('head');
  const R = (x, y) => add(h.head, rot({ x, y }, h.angle - h.restAngle));
  // hood with the face opening cut out (even-odd), then the rim highlight
  const c = hoodPath(ctx, pose);
  const o = [R(-42, -4), R(-44, -56), R(-10, -86), R(34, -86), R(62, -52), R(60, -6), R(42, 18), R(-28, 18)];
  ctx.moveTo(o[0].x, o[0].y); catmullRomPath(ctx, o, true, 0.5);
  ctx.fillStyle = P.hood; ctx.fill('evenodd');
  ctx.save(); hoodPath(ctx, pose); ctx.moveTo(o[0].x, o[0].y); catmullRomPath(ctx, o, true, 0.5); ctx.clip('evenodd');
  // shadow side of the hood (screen-right) and the fold along the top
  const s = [R(20, -130), R(120, -130), R(120, 40), R(60, 40), R(70, -40)]; ctx.beginPath(); catmullRomPath(ctx, s, true, 0.4); ctx.fillStyle = P.hoodShade; ctx.fill();
  const l = [R(-90, -40), R(-74, -100), R(-50, -112), R(-54, -70), R(-66, -20)]; ctx.beginPath(); catmullRomPath(ctx, l, true, 0.4); ctx.fillStyle = P.hoodLight; ctx.fill();
  ctx.restore();
  hoodPath(ctx, pose); ink(ctx); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(o[0].x, o[0].y); catmullRomPath(ctx, o, true, 0.5); ink(ctx); ctx.stroke();
  // crease lines
  const h1 = pose.bones.get('hood_01'); ink(ctx, 2);
  ctx.beginPath(); ctx.moveTo(R(-30, -96).x, R(-30, -96).y); ctx.quadraticCurveTo(R(-4, -118).x, R(-4, -118).y, h1.head.x + 4, h1.head.y + 14); ctx.stroke();
}

// ------------------------------------------------------------------ sleeves + bony hands
export function drawSleeve(ctx, pose, side) {
  const ua = pose.bones.get(`upperarm_${side}`), fa = pose.bones.get(`forearm_${side}`);
  const end = add(fa.head, scale(sub(fa.tail, fa.head), 0.78));
  const o = tube(ctx, [add(ua.head, scale(sub(ua.tail, ua.head), 0.25)), ua.tail, end], [18, 26, 42], P.robe, P.robeShade, { caps: 'start', shadow: 0.4, outline: false });
  // bell opening: the cuff edge is a dark inner ellipse
  const d = sub(fa.tail, fa.head), L = len(d) || 1, u = scale(d, 1 / L), n = { x: -u.y, y: u.x };
  loftPath(ctx, o, 'start'); ink(ctx); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(end.x, end.y, 40, 10, Math.atan2(u.y, u.x) + Math.PI / 2, 0, Math.PI * 2); fillStroke(ctx, P.hoodInside, 2.5);
  ctx.beginPath(); ctx.ellipse(end.x, end.y, 40, 10, Math.atan2(u.y, u.x) + Math.PI / 2, Math.PI, Math.PI * 2); ctx.fillStyle = P.robe; ctx.fill();
  void n;
}
export function drawHand(ctx, pose, side) {
  const grip = clamp(pose.channels[`hand_${side}`]); const sg = side === 'L' ? 1 : -1;
  ctx.save(); enterBone(ctx, pose, `hand_${side}`); ctx.scale(sg, 1);
  // palm
  ctx.beginPath(); ctx.moveTo(-9, 2); ctx.lineTo(9, 2); ctx.quadraticCurveTo(13, 12, 10, 22); ctx.lineTo(-10, 22); ctx.quadraticCurveTo(-13, 12, -9, 2); ctx.closePath(); fillStroke(ctx, P.bone, 2.2);
  ink(ctx, 1.4); for (const x of [-4, 2, 7]) { ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x - 1, 20); ctx.stroke(); }
  // four fingers, two bones each; curl with `grip`
  for (let i = 0; i < 4; i++) {
    const x = -8 + i * 5.3, curl = mix(0.15, 1.25, grip) * (1 - i * 0.06);
    ctx.save(); ctx.translate(x, 22); ctx.rotate(curl * 0.5 * (i === 0 ? 1.2 : 1));
    ctx.beginPath(); ctx.roundRect(-2.4, 0, 4.8, 12, 2.4); fillStroke(ctx, P.bone, 1.6);
    ctx.translate(0, 12); ctx.rotate(curl * 0.9);
    ctx.beginPath(); ctx.roundRect(-2.2, 0, 4.4, 10, 2.2); fillStroke(ctx, P.boneShade, 1.6);
    ctx.restore();
  }
  // thumb
  ctx.save(); ctx.translate(-10, 8); ctx.rotate(-0.9 + grip * 1.2);
  ctx.beginPath(); ctx.roundRect(-2.4, 0, 4.8, 11, 2.4); fillStroke(ctx, P.bone, 1.6);
  ctx.translate(0, 11); ctx.rotate(0.5 + grip * 0.6); ctx.beginPath(); ctx.roundRect(-2.2, 0, 4.4, 8, 2.2); fillStroke(ctx, P.boneShade, 1.6); ctx.restore();
  ctx.restore();
}

// ------------------------------------------------------------------ scythe
export function drawScythe(ctx, pose, part = 'all') {
  if (pose.channels.propVisible < 0.5) return;
  const b = pose.bones.get('scythe'); const L = b.length;
  ctx.save(); ctx.translate(b.head.x, b.head.y); ctx.rotate(b.angle);
  if (part !== 'blade') {
    // crooked wooden shaft, swept along a bent centreline
    const b0 = L * PROP.butt, b1 = L * PROP.blade;
    const pts = [{ x: b0, y: 0 }, { x: mix(b0, b1, 0.24), y: 5 }, { x: mix(b0, b1, 0.52), y: -4 }, { x: mix(b0, b1, 0.8), y: 4 }, { x: b1, y: 0 }];
    tube(ctx, pts, [7, 8, 8, 8, 7], P.wood, P.woodShade, { shadow: 0.5 });
    ink(ctx, 1.4); ctx.beginPath(); ctx.moveTo(mix(b0, b1, 0.1), -2); ctx.quadraticCurveTo(mix(b0, b1, 0.3), 1, mix(b0, b1, 0.45), -3); ctx.stroke();
    for (const u of [0.22, 0.74]) { ctx.save(); ctx.translate(mix(b0, b1, u), 0); for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(i * 6 - 2, -9); ctx.lineTo(i * 6 + 4, 9); ctx.lineWidth = 5; ctx.strokeStyle = i % 2 ? P.wrapShade : P.wrap; ctx.lineCap = 'butt'; ctx.stroke(); } ctx.beginPath(); ctx.rect(-4, -9, 32, 18); ink(ctx, 2); ctx.stroke(); ctx.restore(); }
    ctx.beginPath(); ctx.arc(L * PROP.butt, 0, 9, 0, Math.PI * 2); fillStroke(ctx, P.woodShade, 2.5);
  }
  if (part !== 'shaft') {
    ctx.translate(L * PROP.blade, 0);
    // brass ferrule and a short tang, then the crescent blade sweeping off to the -y side and curving back
    ctx.beginPath(); ctx.rect(-14, -11, 24, 22); fillStroke(ctx, P.brass, 2.5); ctx.beginPath(); ctx.arc(-4, 0, 3.5, 0, Math.PI * 2); ctx.fillStyle = P.brassShade; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(6, -10); ctx.quadraticCurveTo(90, -30, 150, -110); ctx.quadraticCurveTo(200, -175, 210, -250);   // thick spine out to the tip
    ctx.quadraticCurveTo(170, -190, 110, -150); ctx.quadraticCurveTo(50, -110, 8, 12); ctx.closePath();            // concave cutting edge back to the heel
    fillStroke(ctx, P.steel);
    ctx.save(); ctx.clip();
    ctx.beginPath(); ctx.moveTo(6, -10); ctx.quadraticCurveTo(90, -30, 150, -110); ctx.quadraticCurveTo(200, -175, 210, -250); ctx.quadraticCurveTo(185, -180, 135, -125); ctx.quadraticCurveTo(80, -70, 30, -20); ctx.closePath(); ctx.fillStyle = P.steelShade; ctx.fill();
    ctx.beginPath(); ctx.moveTo(30, -30); ctx.quadraticCurveTo(100, -70, 170, -170); ctx.lineWidth = 3; ctx.strokeStyle = P.steelLight; ctx.stroke();
    for (let i = 0; i < 10; i++) { const u = 0.1 + i * 0.09; ctx.beginPath(); ctx.ellipse(mix(30, 180, u) + (hash(i, 2) - 0.5) * 30, mix(-30, -200, u) + (hash(i, 3) - 0.5) * 26, 3 + hash(i, 4) * 5, 2 + hash(i, 5) * 3, hash(i, 6) * 3, 0, Math.PI * 2); ctx.fillStyle = P.steelSpot; ctx.globalAlpha = 0.45; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.restore();
    // notch at the heel
    ctx.beginPath(); ctx.moveTo(22, -14); ctx.lineTo(34, -30); ctx.lineTo(40, -16); ink(ctx, 2); ctx.stroke();
    // motion trail
    const tr = clamp(pose.channels.trail);
    if (tr > 0) { ctx.beginPath(); ctx.moveTo(210, -250); ctx.quadraticCurveTo(80, -330, -160, -260); ctx.quadraticCurveTo(60, -240, 150, -150); ctx.closePath(); ctx.fillStyle = `rgba(230,240,255,${0.45 * tr})`; ctx.fill(); }
  }
  ctx.restore();
}
