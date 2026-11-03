// Vector artwork for Krakenbot, the mech octopus. Drawn with Canvas 2D in the rig's root space.
// Tentacles are lofted tubes along their five-bone chains (orange armour top, dark underside with
// cream suckers, white plates on the first links); the dome, visor, pods and chin are rigid pieces in
// the head's upright frame. Lights are radial-gradient halos so they glow without shadowBlur.

import { smoothPolyline, clamp, mix, hash, rot, add, sub, scale, len } from './math.js';
import { TENTACLES, TENTACLE_NAMES, tentBones } from './skeleton.js';

export const PALETTE = {
  orange: '#F28A1E', orangeLight: '#FFB347', orangeDark: '#C4620E', orangeDeep: '#8E4208',
  white: '#F4F4F6', whiteShade: '#C8CBD3', whiteDark: '#9DA2AC',
  metal: '#33353B', metalLight: '#5A5D66', metalDark: '#1C1D21',
  glow: '#FFD23F', glowCore: '#FFF4C2', glowDeep: '#FF8A00',
  sucker: '#F3EFE8', suckerShade: '#CFC8BC', suckerHole: '#B8AFA2',
  eye: '#FFC21A', eyeDark: '#E06A00', pupil: '#2B1600',
  line: 'rgba(20,16,12,0.55)',
};
const P = PALETTE;

export function outline(ctx, w = 2, c = P.line) { ctx.lineWidth = w; ctx.strokeStyle = c; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; }
export function radial(ctx, x, y, r, stops, x2 = x, y2 = y, r0 = 0) { const g = ctx.createRadialGradient(x2, y2, r0, x, y, r); for (const [o, c] of stops) g.addColorStop(o, c); return g; }
export function linear(ctx, x1, y1, x2, y2, stops) { const g = ctx.createLinearGradient(x1, y1, x2, y2); for (const [o, c] of stops) g.addColorStop(o, c); return g; }
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.closePath(); }
/** Light with halo. */
function lamp(ctx, x, y, w, h, glow, { r = 4, halo = 2.2, core = P.glowCore, color = P.glow, deep = P.glowDeep } = {}) {
  const g = clamp(glow);
  if (g > 0.02) {
    ctx.save(); ctx.globalAlpha = 0.55 * g;
    const R = Math.max(w, h) * halo;
    ctx.fillStyle = radial(ctx, x + w / 2, y + h / 2, R, [[0, deep], [0.45, 'rgba(255,138,0,0.35)'], [1, 'rgba(255,138,0,0)']]); ctx.fillRect(x + w / 2 - R, y + h / 2 - R, 2 * R, 2 * R);
    ctx.restore();
  }
  rrect(ctx, x, y, w, h, r);
  ctx.fillStyle = g > 0.02 ? linear(ctx, x, y, x, y + h, [[0, core], [0.5, color], [1, deep]]) : P.metalDark; ctx.fill();
  outline(ctx, 1.2, 'rgba(60,30,0,0.6)'); ctx.stroke();
}

// ------------------------------------------------------------------ loft helpers
export function loftOutline(pts, widths, per = 5) {
  const c = smoothPolyline(pts, per); const n = c.length;
  const wAt = (i) => { const u = (i / (n - 1)) * (widths.length - 1); const k = Math.min(widths.length - 2, Math.floor(u)); const f = u - k; return mix(widths[k], widths[k + 1], f * f * (3 - 2 * f)); };
  const left = [], right = [], normals = [];
  for (let i = 0; i < n; i++) {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(n - 1, i + 1)];
    let nx = -(b.y - a.y), ny = (b.x - a.x); const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    const w = wAt(i); normals.push({ x: nx, y: ny, w });
    left.push({ x: c[i].x + nx * w, y: c[i].y + ny * w }); right.push({ x: c[i].x - nx * w, y: c[i].y - ny * w });
  }
  return { centre: c, left, right, normals, capStart: wAt(0), capEnd: wAt(n - 1) };
}
export function loftPath(ctx, o) {
  const { left, right, centre, capStart, capEnd } = o; const n = left.length;
  ctx.beginPath(); ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
  const ed = sub(centre[n - 1], centre[n - 2]); const ea = Math.atan2(ed.y, ed.x);
  ctx.arc(centre[n - 1].x, centre[n - 1].y, capEnd, ea - Math.PI / 2, ea + Math.PI / 2, false);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  const sd = sub(centre[1], centre[0]); const sa = Math.atan2(sd.y, sd.x);
  ctx.arc(centre[0].x, centre[0].y, capStart, sa + Math.PI / 2, sa + Math.PI * 1.5, false);
  ctx.closePath();
}

// ------------------------------------------------------------------ tentacle
const WIDTHS = [30, 27, 23, 18, 12, 6];
export function drawTentacle(ctx, pose, name) {
  const def = TENTACLES[name];
  const bones = tentBones(name).map((b) => pose.bones.get(b));
  const pts = bones.map((b) => b.head); pts.push(bones[bones.length - 1].tail);
  const o = loftOutline(pts, WIDTHS, 6);
  const n = o.centre.length;
  const side = def.suckerSide;                     // -1: suckers on the loft's right side (local -y), +1: left
  const sideLine = side > 0 ? o.left : o.right, outerLine = side > 0 ? o.right : o.left;
  // body of the tentacle
  loftPath(ctx, o);
  const mi = Math.floor(n / 2);
  ctx.fillStyle = linear(ctx, outerLine[mi].x, outerLine[mi].y, sideLine[mi].x, sideLine[mi].y, [[0, P.orangeLight], [0.45, P.orange], [1, P.orangeDark]]); ctx.fill();
  // dark underside band (sucker side)
  ctx.save(); ctx.clip();
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const c = o.centre[i], nn = o.normals[i]; const p = add(c, scale({ x: nn.x, y: nn.y }, side * nn.w * 0.35)); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
  for (let i = n - 1; i >= 0; i--) { const c = o.centre[i], nn = o.normals[i]; const p = add(c, scale({ x: nn.x, y: nn.y }, side * nn.w * 1.3)); ctx.lineTo(p.x, p.y); }
  ctx.closePath(); ctx.fillStyle = radial(ctx, o.centre[0].x, o.centre[0].y, 420, [[0, P.metal], [1, P.metalDark]]); ctx.fill();
  // suckers along the underside
  let acc = 0; let k = 0;
  for (let i = 2; i < n - 1; i++) {
    acc += len(sub(o.centre[i], o.centre[i - 1]));
    const nn = o.normals[i]; const r = mix(9.5, 3.2, i / (n - 1));
    if (acc < r * 2.3) continue; acc = 0; k++;
    const c = add(o.centre[i], scale({ x: nn.x, y: nn.y }, side * nn.w * 0.78));
    ctx.beginPath(); ctx.ellipse(c.x, c.y, r, r * 0.8, Math.atan2(nn.y, nn.x), 0, Math.PI * 2);
    ctx.fillStyle = radial(ctx, c.x, c.y, r, [[0, P.sucker], [0.75, P.sucker], [1, P.suckerShade]], c.x - r * 0.3, c.y - r * 0.3); ctx.fill();
    outline(ctx, 1, 'rgba(40,30,20,0.5)'); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(c.x, c.y, r * 0.45, r * 0.36, Math.atan2(nn.y, nn.x), 0, Math.PI * 2); ctx.fillStyle = P.suckerHole; ctx.fill();
  }
  ctx.restore();
  loftPath(ctx, o); outline(ctx, 2); ctx.stroke();
  // armour plates on the first three links (outer side): flat segmented shells with a light slit
  const plateW = [30, 26, 20];
  bones.slice(0, 3).forEach((b, i) => {
    ctx.save(); ctx.translate(b.head.x, b.head.y); ctx.rotate(b.angle);
    const L = b.length, s = -side, w = plateW[i];
    const shell = (inset, extra) => {
      ctx.beginPath();
      ctx.moveTo(inset, s * (w * 0.15));
      ctx.quadraticCurveTo(inset - 4, s * (w + extra), L * 0.25, s * (w + extra));
      ctx.lineTo(L * 0.75, s * (w + extra));
      ctx.quadraticCurveTo(L - inset + 4, s * (w + extra), L - inset, s * (w * 0.15));
      ctx.closePath();
    };
    shell(4, 14); ctx.fillStyle = P.orangeDark; ctx.fill(); outline(ctx, 1.6); ctx.stroke();
    shell(9, 9); ctx.fillStyle = linear(ctx, 0, s * (w * 0.2), 0, s * (w + 9), [[0, P.whiteShade], [0.35, P.white], [1, P.white]]); ctx.fill(); outline(ctx, 1.2, 'rgba(60,60,70,0.5)'); ctx.stroke();
    // seam + slit light on the middle link, twin bolts elsewhere
    if (i === 1) lamp(ctx, L / 2 - 11, s * (w * 0.62) - 2.5, 22, 5, pose.channels.glow, { r: 2.5, halo: 1.6 });
    else for (const bx of [L * 0.32, L * 0.68]) { ctx.beginPath(); ctx.arc(bx, s * (w * 0.62), 2.6, 0, Math.PI * 2); ctx.fillStyle = P.metalLight; ctx.fill(); outline(ctx, 0.9); ctx.stroke(); }
    ctx.restore();
  });
}

// ------------------------------------------------------------------ body + head
export function drawBody(ctx, pose) {
  const b = pose.bones.get('body');
  ctx.save(); ctx.translate(b.head.x, b.head.y); ctx.rotate(b.angle - b.restAngle);
  ctx.beginPath(); ctx.ellipse(0, -10, 130, 52, 0, 0, Math.PI * 2);
  ctx.fillStyle = radial(ctx, -30, -40, 150, [[0, P.metalLight], [0.6, P.metal], [1, P.metalDark]]); ctx.fill(); outline(ctx, 2); ctx.stroke();
  // orange rim ring
  ctx.beginPath(); ctx.ellipse(0, -2, 118, 30, 0, 0, Math.PI); ctx.strokeStyle = P.orangeDark; ctx.lineWidth = 6; ctx.stroke();
  ctx.restore();
}

function eye(ctx, cx, cy, sgn, ch) {
  // sgn = +1 for the character's left eye (screen right): the brow slants down toward the centre
  const w = 54, h = 36;
  const brow = ch.brow;                          // -1 raised .. +1 furious
  ctx.save(); ctx.translate(cx, cy); ctx.scale(sgn, 1);
  const almond = () => {
    ctx.beginPath();
    ctx.moveTo(-w, -14 + brow * 4);                                   // outer corner (high)
    ctx.quadraticCurveTo(-4, -h - 6 + brow * 8, w, 4 + brow * 14);    // upper edge slants down to the inner corner
    ctx.quadraticCurveTo(34, h + 6, -6, h);
    ctx.quadraticCurveTo(-40, h - 2, -w, -14 + brow * 4);
    ctx.closePath();
  };
  // socket
  almond(); ctx.fillStyle = P.metalDark; ctx.fill();
  // glowing iris
  ctx.save(); almond(); ctx.clip();
  const g = clamp(ch.glow), heat = clamp(ch.eyeHeat);
  const px = ch.pupil_x * 14 * sgn + 10, py = ch.pupil_y * 8 + 4;
  ctx.fillStyle = radial(ctx, px, py, 48, [[0, heat > 0 ? `rgba(255,${Math.round(244 - 60 * (1 - heat))},${Math.round(194 * heat + 40)},1)` : P.eye], [0.55, P.eye], [1, P.eyeDark]]); ctx.fillRect(-w - 4, -h - 4, 2 * w + 8, 2 * h + 8);
  const pr = 12 * ch.pupilSize;
  ctx.beginPath(); ctx.ellipse(px, py, pr, pr * 1.2, 0, 0, Math.PI * 2); ctx.fillStyle = P.pupil; ctx.fill();
  ctx.beginPath(); ctx.ellipse(px - 6, py - 7, 4.5, 3, -0.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
  // glow haze
  ctx.globalAlpha = 0.35 * g; ctx.fillStyle = radial(ctx, px, py, 40, [[0, P.glowCore], [1, 'rgba(255,200,0,0)']]); ctx.fillRect(-w, -h, 2 * w, 2 * h); ctx.globalAlpha = 1;
  // visor flash
  if (ch.visorFlash > 0) { ctx.globalAlpha = ch.visorFlash; ctx.fillStyle = '#fff'; ctx.fillRect(-w - 4, -h - 4, 2 * w + 8, 2 * h + 8); ctx.globalAlpha = 1; }
  // armoured shutters: upper slides down with blink, lower rises with squint
  const blink = clamp(sgn > 0 ? ch.blink_L : ch.blink_R), squint = clamp(ch.squint);
  if (blink > 0) { ctx.fillStyle = P.metal; ctx.fillRect(-w - 4, -h - 6, 2 * w + 8, (2 * h + 10) * blink); ctx.strokeStyle = P.orangeDark; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-w - 4, -h - 6 + (2 * h + 10) * blink); ctx.lineTo(w + 4, -h - 6 + (2 * h + 10) * blink); ctx.stroke(); }
  if (squint > 0) { ctx.fillStyle = P.metal; ctx.fillRect(-w - 4, h + 6 - (h + 8) * squint, 2 * w + 8, h + 8); }
  ctx.restore();
  almond(); outline(ctx, 2.2, P.metalDark); ctx.stroke();
  // brow ridge: a thick wedge that gets heavier toward the centre
  ctx.beginPath(); ctx.moveTo(-w - 6, -18 + brow * 4); ctx.quadraticCurveTo(-4, -h - 20 + brow * 6, w + 8, -8 + brow * 14);
  ctx.lineTo(w + 8, 10 + brow * 14); ctx.quadraticCurveTo(-2, -h - 2 + brow * 8, -w - 6, -10 + brow * 4); ctx.closePath();
  ctx.fillStyle = linear(ctx, 0, -h - 20, 0, 0, [[0, P.metalLight], [1, P.metalDark]]); ctx.fill(); outline(ctx, 1.5, P.metalDark); ctx.stroke();
  ctx.restore();
}

function octoLogo(ctx, x, y, s) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = P.white;
  ctx.beginPath(); ctx.ellipse(0, -9, 12, 13, 0, 0, Math.PI * 2); ctx.fill();
  ctx.lineCap = 'round'; ctx.strokeStyle = P.white;
  for (const sgn of [-1, 1]) for (let i = 0; i < 3; i++) {
    const x0 = sgn * (3 + i * 4), y0 = 2 + i * 1.5, reach = 10 + i * 8;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(sgn * (reach * 0.6), 10 + i * 2, sgn * (reach + 6), 16 + i * 3, sgn * (reach), 22 + i * 2);
    ctx.quadraticCurveTo(sgn * (reach - 5), 25 + i * 2, sgn * (reach - 2), 19 + i * 2);
    ctx.lineWidth = 3.4 - i * 0.4; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(-4, -9, 2, 0, Math.PI * 2); ctx.arc(4, -9, 2, 0, Math.PI * 2); ctx.fillStyle = P.orange; ctx.fill();
  ctx.restore();
}

export function drawHead(ctx, pose) {
  const ch = pose.channels; const g = ch.glow;
  ctx.save(); const hb = pose.bones.get('head'); ctx.translate(hb.head.x, hb.head.y); ctx.rotate(hb.angle - hb.restAngle);
  // dome silhouette
  const dome = () => {
    ctx.beginPath();
    ctx.moveTo(-152, -40);
    ctx.bezierCurveTo(-156, -130, -110, -196, 0, -198);
    ctx.bezierCurveTo(110, -196, 156, -130, 152, -40);
    ctx.bezierCurveTo(150, 10, 130, 40, 100, 58);
    ctx.quadraticCurveTo(50, 80, 0, 92 + ch.mouth * 0);
    ctx.quadraticCurveTo(-50, 80, -100, 58);
    ctx.bezierCurveTo(-130, 40, -150, 10, -152, -40);
    ctx.closePath();
  };
  // side pod mounts (dark) behind the dome edge
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * 138, -48, 34, 60, 0, 0, Math.PI * 2); ctx.fillStyle = P.metal; ctx.fill(); outline(ctx, 2); ctx.stroke(); }
  dome(); ctx.fillStyle = radial(ctx, -50, -120, 260, [[0, '#FFFFFF'], [0.5, P.white], [1, P.whiteShade]]); ctx.fill();
  ctx.save(); dome(); ctx.clip();
  // orange centre panel
  ctx.beginPath(); ctx.moveTo(-52, -200); ctx.lineTo(52, -200); ctx.quadraticCurveTo(80, -120, 84, -50); ctx.lineTo(70, -38); ctx.lineTo(-70, -38); ctx.lineTo(-84, -50); ctx.quadraticCurveTo(-80, -120, -52, -200); ctx.closePath();
  ctx.fillStyle = linear(ctx, -80, 0, 80, 0, [[0, P.orangeDark], [0.3, P.orange], [0.6, P.orangeLight], [1, P.orangeDark]]); ctx.fill(); outline(ctx, 2); ctx.stroke();
  octoLogo(ctx, 0, -118, 1.25);
  // side plate seams + bolts
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(s * 100, -175); ctx.quadraticCurveTo(s * 128, -120, s * 118, -40); outline(ctx, 2, 'rgba(60,60,70,0.45)'); ctx.stroke();
    for (const [bx, by] of [[s * 96, -96], [s * 112, -62], [s * 104, -130]]) { ctx.beginPath(); ctx.arc(bx, by, 4.5, 0, Math.PI * 2); ctx.fillStyle = P.metalLight; ctx.fill(); outline(ctx, 1.2); ctx.stroke(); ctx.beginPath(); ctx.arc(bx - 1, by - 1, 1.6, 0, Math.PI * 2); ctx.fillStyle = '#9aa'; ctx.fill(); }
  }
  // top crest plate with two light bars
  ctx.beginPath(); ctx.moveTo(-74, -198); ctx.lineTo(74, -198); ctx.lineTo(60, -150); ctx.lineTo(-60, -150); ctx.closePath();
  ctx.fillStyle = linear(ctx, 0, -200, 0, -150, [[0, P.metalLight], [1, P.metalDark]]); ctx.fill(); outline(ctx, 2); ctx.stroke();
  lamp(ctx, -22, -190, 44, 8, g, { r: 3 }); lamp(ctx, -22, -175, 44, 8, g, { r: 3 });
  // visor band shading
  ctx.beginPath(); ctx.moveTo(-152, -44); ctx.lineTo(152, -44); ctx.lineTo(140, 30); ctx.lineTo(-140, 30); ctx.closePath(); ctx.fillStyle = 'rgba(40,40,50,0.08)'; ctx.fill();
  ctx.restore();
  dome(); outline(ctx, 2.4); ctx.stroke();
  // eyes
  eye(ctx, -64, -16, -1, ch); eye(ctx, 64, -16, 1, ch);
  // nose plate: white ridge with two slits
  ctx.beginPath(); ctx.moveTo(-14, -40); ctx.lineTo(14, -40); ctx.lineTo(20, 30); ctx.lineTo(-20, 30); ctx.closePath();
  ctx.fillStyle = linear(ctx, -20, 0, 20, 0, [[0, P.whiteShade], [0.5, P.white], [1, P.whiteShade]]); ctx.fill(); outline(ctx, 1.8); ctx.stroke();
  lamp(ctx, -11, -2, 22, 6, g, { r: 2.5, halo: 1.8 }); lamp(ctx, -11, 9, 22, 6, g, { r: 2.5, halo: 1.8 });
  // mouth / chin plate (drops with `mouth`)
  const drop = ch.mouth * 26;
  ctx.beginPath(); ctx.moveTo(-96, 40); ctx.quadraticCurveTo(-40, 50, 0, 56); ctx.quadraticCurveTo(40, 50, 96, 40); ctx.quadraticCurveTo(60, 70 + drop, 0, 82 + drop); ctx.quadraticCurveTo(-60, 70 + drop, -96, 40); ctx.closePath();
  ctx.fillStyle = P.metalDark; ctx.fill();
  if (ch.mouth > 0.05) { ctx.save(); ctx.clip(); ctx.beginPath(); ctx.ellipse(0, 62 + drop * 0.6, 50, 10 + drop * 0.5, 0, 0, Math.PI * 2); ctx.fillStyle = radial(ctx, 0, 62 + drop * 0.6, 50, [[0, P.glowDeep], [1, 'rgba(255,138,0,0)']]); ctx.globalAlpha = 0.8 * g; ctx.fill(); ctx.restore(); }
  ctx.beginPath(); ctx.moveTo(-100, 36 + drop); ctx.quadraticCurveTo(-40, 48 + drop, 0, 52 + drop); ctx.quadraticCurveTo(40, 48 + drop, 100, 36 + drop); ctx.quadraticCurveTo(60, 78 + drop, 0, 96 + drop); ctx.quadraticCurveTo(-60, 78 + drop, -100, 36 + drop); ctx.closePath();
  ctx.fillStyle = linear(ctx, 0, 40 + drop, 0, 96 + drop, [[0, P.white], [1, P.whiteShade]]); ctx.fill(); outline(ctx, 2.2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-70, 56 + drop); ctx.quadraticCurveTo(0, 70 + drop, 70, 56 + drop); outline(ctx, 2, 'rgba(60,60,70,0.4)'); ctx.stroke();
  ctx.restore();
  drawCrest(ctx, pose);
  drawPod(ctx, pose, 'L'); drawPod(ctx, pose, 'R');
}

function drawCrest(ctx, pose) {
  const b = pose.bones.get('crest'); const lift = Math.max(0, (pose.bones.get('head').tail.y - 22) - b.head.y);
  if (lift < 2) return;   // flush with the dome unless popped
  ctx.save(); ctx.translate(b.head.x, b.head.y); ctx.rotate(b.angle - b.restAngle);
  rrect(ctx, -40, -8, 80, 22, 6); ctx.fillStyle = P.metal; ctx.fill(); outline(ctx, 2); ctx.stroke();
  lamp(ctx, -24, -2, 48, 7, pose.channels.glow, { r: 3 });
  ctx.restore();
}

export function drawPod(ctx, pose, side) {
  const b = pose.bones.get(`pod_${side}`); const ch = pose.channels; const sgn = side === 'L' ? 1 : -1;
  ctx.save(); ctx.translate(b.head.x, b.head.y); ctx.rotate(b.angle - b.restAngle); ctx.scale(sgn, 1);
  // cylinder body (seen from the front-three-quarter: an ellipse with a flat outer face)
  ctx.beginPath(); ctx.ellipse(22, 0, 44, 58, 0, 0, Math.PI * 2); ctx.fillStyle = radial(ctx, 0, -30, 90, [[0, P.metalLight], [0.6, P.metal], [1, P.metalDark]]); ctx.fill(); outline(ctx, 2.2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(34, 0, 30, 50, 0, 0, Math.PI * 2); ctx.fillStyle = P.metalDark; ctx.fill(); outline(ctx, 1.6); ctx.stroke();
  // glowing ring (rotates with podSpin: a notch travels around)
  const g = clamp(ch.glow);
  ctx.save(); ctx.translate(34, 0); ctx.scale(0.62, 1);
  if (g > 0.02) { ctx.globalAlpha = 0.5 * g; ctx.fillStyle = radial(ctx, 0, 0, 70, [[0, 'rgba(255,138,0,0.9)'], [1, 'rgba(255,138,0,0)']]); ctx.fillRect(-70, -70, 140, 140); ctx.globalAlpha = 1; }
  ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.arc(0, 0, 18, 0, Math.PI * 2, true); ctx.fillStyle = g > 0.02 ? radial(ctx, 0, 0, 34, [[0, P.glowDeep], [0.55, P.glowDeep], [0.75, P.glow], [1, P.glowDeep]], 0, 0, 18) : P.metal; ctx.fill('evenodd');
  ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.strokeStyle = g > 0.02 ? P.glowCore : P.metalLight; ctx.lineWidth = 3; ctx.stroke();
  const a = ch.podSpin * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.cos(a) * 26, Math.sin(a) * 26, 4, 0, Math.PI * 2); ctx.fillStyle = P.metalDark; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fillStyle = radial(ctx, -3, -3, 12, [[0, P.metalLight], [1, P.metalDark]]); ctx.fill();
  ctx.restore();
  // side light bar on the rim
  ctx.save(); ctx.translate(-12, 0); lamp(ctx, -4, -16, 8, 32, g, { r: 3, halo: 1.6 }); ctx.restore();
  ctx.restore();
}

/** Hover shadow on the ground, shrinking with height. */
export function drawShadow(ctx, pose, groundY = 0) {
  const lowest = Math.max(...TENTACLE_NAMES.map((n) => pose.bones.get(tentBones(n)[4]).tail.y));
  const height = Math.max(0, groundY - lowest);
  const k = clamp(1 - height / 220);
  const cx = pose.bones.get('body').head.x;
  ctx.save(); ctx.globalAlpha = 0.3 * (0.3 + 0.7 * k);
  ctx.beginPath(); ctx.ellipse(cx, groundY + 10, 200 * (0.55 + 0.45 * k), 26 * (0.55 + 0.45 * k), 0, 0, Math.PI * 2);
  ctx.fillStyle = radial(ctx, cx, groundY + 10, 200, [[0, 'rgba(20,16,12,0.95)'], [1, 'rgba(20,16,12,0)']]); ctx.fill(); ctx.restore();
}
