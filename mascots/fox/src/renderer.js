// Draws a solved pose. Draw order is data-driven: a few clip channels flip the arms and club between
// the front and back of the body, so a backswing can cross the chest without a second rig.
import * as art from './art.js';

/** Ordered part list for a pose (names are stable ids for the viewer's part toggles). */
export function partOrder(pose) {
  const ch = pose.channels;
  const clubBehind = ch.clubBehind >= 0.5;
  const parts = [
    ['shadow', (c) => art.drawShadow(c, pose)],
    ['tail', (c) => art.drawTail(c, pose)],
    ['ear_L', (c) => art.drawEar(c, pose, 'L')],
    ['ear_R', (c) => art.drawEar(c, pose, 'R')],
  ];
  if (clubBehind) parts.push(['club', (c) => art.drawClub(c, pose)]);
  if (ch.armLFront < 0.5) parts.push(['arm_L', (c) => art.drawArm(c, pose, 'L')]);
  if (ch.armRFront < 0.5) parts.push(['arm_R', (c) => art.drawArm(c, pose, 'R')]);
  parts.push(
    ['leg_L', (c) => art.drawLegBack(c, pose, 'L')],
    ['leg_R', (c) => art.drawLegBack(c, pose, 'R')],
    ['shorts', (c) => art.drawShorts(c, pose)],
    ['torso', (c) => art.drawTorso(c, pose)],
    ['neck', (c) => art.drawNeck(c, pose)],
    ['head', (c) => art.drawHead(c, pose)],
  );
  if (!clubBehind) parts.push(['club', (c) => art.drawClub(c, pose)]);
  else parts.push(['club_grip', (c) => art.drawClub(c, pose, 'grip')]);
  if (ch.armLFront >= 0.5) parts.push(['arm_L', (c) => art.drawArm(c, pose, 'L')]);
  if (ch.armRFront >= 0.5) parts.push(['arm_R', (c) => art.drawArm(c, pose, 'R')]);
  return parts;
}

/**
 * Render a pose. `view`: { x, y, scale, mirror } places the character's ground origin on the canvas.
 * `hidden`: Set of part ids to skip. The root squash/stretch is applied about the ground origin.
 */
export function drawPose(ctx, pose, view = { x: 0, y: 0, scale: 1 }, hidden = null) {
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale((view.mirror ? -1 : 1) * view.scale, view.scale);
  ctx.scale(pose.rootScale.x, pose.rootScale.y);
  for (const [id, fn] of partOrder(pose)) {
    if (hidden && hidden.has(id)) continue;
    ctx.save(); fn(ctx); ctx.restore();
  }
  ctx.restore();
}

/** Skeleton overlay: bones as tapered lines, joints as dots, IK targets and club markers. */
export function drawSkeleton(ctx, pose, view, selected = null) {
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale((view.mirror ? -1 : 1) * view.scale, view.scale);
  ctx.scale(pose.rootScale.x, pose.rootScale.y);
  ctx.lineCap = 'round';
  for (const b of pose.bones.values()) {
    const d = { x: b.tail.x - b.head.x, y: b.tail.y - b.head.y };
    const n = { x: -d.y, y: d.x }; const L = Math.hypot(d.x, d.y) || 1;
    const w = Math.min(7, L * 0.12);
    ctx.beginPath();
    ctx.moveTo(b.head.x + n.x / L * w, b.head.y + n.y / L * w);
    ctx.lineTo(b.tail.x, b.tail.y);
    ctx.lineTo(b.head.x - n.x / L * w, b.head.y - n.y / L * w);
    ctx.closePath();
    ctx.fillStyle = b.name === selected ? 'rgba(255,230,0,0.85)' : (b.name.startsWith('tail') ? 'rgba(90,200,255,0.75)' : b.name.startsWith('ear') ? 'rgba(200,120,255,0.75)' : 'rgba(0,220,120,0.7)');
    ctx.fill();
    ctx.beginPath(); ctx.arc(b.head.x, b.head.y, 3.2, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
  }
  if (pose.grip) {
    for (const f of [0.045, 0.165]) { const p = pose.clubPoint(f); ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.strokeStyle = '#ff3366'; ctx.lineWidth = 2; ctx.stroke(); }
  }
  ctx.restore();
}
