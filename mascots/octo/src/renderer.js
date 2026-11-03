// Draw order for the mech octopus. Back and upper tentacles sit behind the body and head; mid and
// front tentacles come forward over the chin (switchable per clip through stepped channels).
import * as art from './art.js';

export function partOrder(pose) {
  const ch = pose.channels;
  const parts = [['shadow', (c) => art.drawShadow(c, pose)]];
  const T = (n) => [n, (c) => art.drawTentacle(c, pose, n)];
  parts.push(T('tent_BL'), T('tent_BR'), T('tent_UR'), T('tent_UL'));
  parts.push(['body', (c) => art.drawBody(c, pose)]);
  if (ch.midOverHead < 0.5) parts.push(T('tent_MR'), T('tent_ML'));
  if (ch.frontOverHead < 0.5) parts.push(T('tent_FR'), T('tent_FL'));
  parts.push(['head', (c) => art.drawHead(c, pose)]);
  if (ch.midOverHead >= 0.5) parts.push(T('tent_MR'), T('tent_ML'));
  if (ch.frontOverHead >= 0.5) parts.push(T('tent_FR'), T('tent_FL'));
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
    const ik = pose.ikSet?.some((n) => b.name.startsWith(n));
    ctx.fillStyle = b.name === selected ? 'rgba(255,230,0,0.9)' : ik ? 'rgba(255,80,160,0.8)' : b.name.startsWith('tent') ? 'rgba(90,200,255,0.75)' : 'rgba(0,220,120,0.7)'; ctx.fill();
    ctx.beginPath(); ctx.arc(b.head.x, b.head.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.restore();
}
