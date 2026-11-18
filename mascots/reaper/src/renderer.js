// Draw order for the reaper. The far (left) sleeve sits behind the robe, its hand in front of the
// scythe shaft; the near (right) arm is drawn last. Stepped channels flip the scythe behind the body.
import * as art from './art.js';

export function partOrder(pose) {
  const ch = pose.channels; const behind = ch.propBehind >= 0.5;
  const parts = [['shadow', (c) => art.drawShadow(c, pose)]];
  if (behind) parts.push(['scythe', (c) => art.drawScythe(c, pose)]);
  parts.push(['boot_L', (c) => art.drawBoot(c, pose, 'L')], ['boot_R', (c) => art.drawBoot(c, pose, 'R')]);
  if (ch.armLFront < 0.5) parts.push(['sleeve_L', (c) => art.drawSleeve(c, pose, 'L')]);
  if (ch.armRFront < 0.5) parts.push(['sleeve_R', (c) => art.drawSleeve(c, pose, 'R')]);
  parts.push(['robe', (c) => art.drawRobe(c, pose)], ['neck', (c) => art.drawNeck(c, pose)], ['hood_back', (c) => art.drawHoodBack(c, pose)], ['skull', (c) => art.drawSkull(c, pose)], ['hood', (c) => art.drawHoodFront(c, pose)], ['mantle', (c) => art.drawMantle(c, pose)]);
  if (ch.armLFront >= 0.5) parts.push(['sleeve_L', (c) => art.drawSleeve(c, pose, 'L')]);
  if (ch.armRFront >= 0.5) parts.push(['sleeve_R', (c) => art.drawSleeve(c, pose, 'R')]);
  // gripping hands: palms behind the shaft, fingers over it; free hands draw whole
  parts.push(['palm_L', (c) => art.drawGripHand(c, pose, 'L', 'back')], ['palm_R', (c) => art.drawGripHand(c, pose, 'R', 'back')]);
  if (!behind) parts.push(['scythe', (c) => art.drawScythe(c, pose)]);
  parts.push(['hand_L', (c) => { art.drawHand(c, pose, 'L'); art.drawGripHand(c, pose, 'L', 'front'); }], ['hand_R', (c) => { art.drawHand(c, pose, 'R'); art.drawGripHand(c, pose, 'R', 'front'); }]);
  return parts;
}
export function drawPose(ctx, pose, view = { x: 0, y: 0, scale: 1 }, hidden = null) {
  ctx.save(); ctx.translate(view.x, view.y); ctx.scale((view.mirror ? -1 : 1) * view.scale, view.scale); ctx.scale(pose.rootScale.x, pose.rootScale.y);
  for (const [id, fn] of partOrder(pose)) { if (hidden && hidden.has(id)) continue; ctx.save(); fn(ctx); ctx.restore(); }
  ctx.restore();
}
export function drawSkeleton(ctx, pose, view, selected = null) {
  ctx.save(); ctx.translate(view.x, view.y); ctx.scale((view.mirror ? -1 : 1) * view.scale, view.scale); ctx.scale(pose.rootScale.x, pose.rootScale.y);
  for (const b of pose.bones.values()) {
    const d = { x: b.tail.x - b.head.x, y: b.tail.y - b.head.y }; const n = { x: -d.y, y: d.x }; const L = Math.hypot(d.x, d.y) || 1; const w = Math.min(7, L * 0.12);
    ctx.beginPath(); ctx.moveTo(b.head.x + n.x / L * w, b.head.y + n.y / L * w); ctx.lineTo(b.tail.x, b.tail.y); ctx.lineTo(b.head.x - n.x / L * w, b.head.y - n.y / L * w); ctx.closePath();
    ctx.fillStyle = b.name === selected ? 'rgba(255,230,0,0.9)' : 'rgba(0,220,120,0.7)'; ctx.fill();
    ctx.beginPath(); ctx.arc(b.head.x, b.head.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
  }
  if (pose.grip) for (const f of [-0.13, 0.13]) { const p = pose.propPoint(f); ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.strokeStyle = '#ff3366'; ctx.lineWidth = 2; ctx.stroke(); }
  ctx.restore();
}
