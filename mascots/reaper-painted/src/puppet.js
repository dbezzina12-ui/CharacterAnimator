// Painted puppet: the parts sheet (exploded character on white) keyed out, split into pieces and
// attached to the reaper skeleton. Rigid pieces draw with one transform; the robe and the hood draw
// as skinned triangle meshes so they bend along their bones. Pose comes from the shared solver.
import { SKELETON } from './skeleton.js';
import { clamp } from './math.js';

const S = 0.377;   // sheet px -> rig px
// Each part: a sheet rectangle (the largest opaque blob inside it is the part), an anchor in sheet
// px that lands on `bone`'s rest head (+ offset), and the bones that may deform it.
export const PARTS = [
  { name: 'boot_R', rect: [170, 1345, 360, 1510], anchor: [265, 1370], bone: 'foot_R', bones: ['foot_R'], offset: [0, -6] },
  { name: 'boot_L', rect: [410, 1345, 600, 1510], anchor: [505, 1370], bone: 'foot_L', bones: ['foot_L'], offset: [0, -6] },
  { name: 'torso', rect: [185, 540, 630, 1370], anchor: [405, 560], bone: 'chest', bones: ['chest', 'spine', 'pelvis', 'skirt_F', 'skirt_R', 'skirt_L', 'tassel_01', 'tassel_02'], offset: [0, -6], mesh: [10, 18], blend: 0.1 },
  { name: 'mantle', rect: [180, 330, 625, 548], anchor: [400, 342], bone: 'mantle', bones: ['mantle'], offset: [0, -6] },
  { name: 'head', rect: [175, 5, 595, 340], anchor: [405, 328], bone: 'head', bones: ['head', 'hood_01', 'hood_02'], offset: [0, 0], mesh: [8, 7], blend: 0.12 },
  { name: 'upper_L', rect: [565, 510, 725, 700], anchor: [645, 525], bone: 'upperarm_L', bones: ['upperarm_L'], offset: [0, -4] },
  { name: 'upper_R', rect: [85, 510, 245, 700], anchor: [165, 525], bone: 'upperarm_R', bones: ['upperarm_R'], offset: [0, -4] },
  { name: 'lower_L', rect: [565, 698, 760, 910], anchor: [660, 710], bone: 'forearm_L', bones: ['forearm_L'], offset: [0, -8] },
  { name: 'lower_R', rect: [30, 698, 240, 910], anchor: [135, 710], bone: 'forearm_R', bones: ['forearm_R'], offset: [0, -8] },
  { name: 'scythe', rect: [690, 245, 1024, 1435], anchor: [810, 850], bone: 'scythe', bones: ['scythe'], offset: [0, 0], alongBone: true },
  // hands: the wrist (top of the carpals) sits on the hand bone's head; the grip ring is GRIP_OFFSET px further along
  { name: 'hand_L', rect: [610, 875, 765, 1190], anchor: [690, 900], bone: 'hand_L', bones: ['hand_L'], offset: [0, 0], scale: 0.82 },
  { name: 'hand_R', rect: [40, 875, 190, 1190], anchor: [115, 900], bone: 'hand_R', bones: ['hand_R'], offset: [0, 0], scale: 0.82 },
];

function keyWhite(data, n) {   // white background -> alpha, with a soft edge
  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const lum = (r + g + b) / 3, sat = Math.max(r, g, b) - Math.min(r, g, b);
    const bg = clamp((lum - 225) / 22) * clamp((18 - sat) / 10);
    data[i * 4 + 3] = Math.min(data[i * 4 + 3], Math.round(255 * (1 - bg)));
  }
}
function largestBlob(alpha, w, h) {
  const seen = new Uint8Array(w * h); let best = null;
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || alpha[s] < 40) continue;
    const stack = [s]; seen[s] = 1; const px = []; let minx = w, maxx = 0, miny = h, maxy = 0;
    while (stack.length) { const i = stack.pop(); px.push(i); const x = i % w, y = (i / w) | 0; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      for (const j of [i - 1, i + 1, i - w, i + w]) { if (j < 0 || j >= w * h || seen[j] || alpha[j] < 40) continue; if ((j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue; seen[j] = 1; stack.push(j); } }
    if (!best || px.length > best.px.length) best = { px, minx, maxx, miny, maxy };
  }
  return best;
}
function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy || 1; const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2); return Math.hypot(px - (ax + dx * t), py - (ay + dy * t)); }

/** Load the sheet and build every part (canvas + placement + optional mesh). */
export async function buildPuppet(sheetUrl) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = sheetUrl; });
  const W = img.naturalWidth, H = img.naturalHeight;
  const full = document.createElement('canvas'); full.width = W; full.height = H; const fg = full.getContext('2d', { willReadFrequently: true });
  fg.drawImage(img, 0, 0); const id = fg.getImageData(0, 0, W, H); keyWhite(id.data, W * H); fg.putImageData(id, 0, 0);
  const parts = [];
  for (const def of PARTS) {
    const [x0, y0, x1, y1] = def.rect; const w = x1 - x0, h = y1 - y0;
    const sub = fg.getImageData(x0, y0, w, h); const alpha = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) alpha[i] = sub.data[i * 4 + 3];
    const blob = largestBlob(alpha, w, h); if (!blob) throw new Error(`no pixels for ${def.name}`);
    const keep = new Uint8Array(w * h); for (const i of blob.px) keep[i] = 1;
    for (let i = 0; i < w * h; i++) if (!keep[i]) sub.data[i * 4 + 3] = 0;
    // soften: keep neighbours of the blob so the ink edge's antialiasing survives
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(sub, 0, 0);
    const bone = SKELETON.bones.get(def.bone);
    const part = { ...def, canvas: c, w, h, ox: x0, oy: y0, bboxSheet: [x0 + blob.minx, y0 + blob.miny, x0 + blob.maxx, y0 + blob.maxy] };
    // placement: sheet px -> root space.  p_root = boneRestHead + offset + (p_sheet - anchor) * S
    const ps = S * (def.scale || 1);
    part.toRoot = (sx, sy) => ({ x: bone.restHead.x + def.offset[0] + (sx - def.anchor[0]) * ps, y: bone.restHead.y + def.offset[1] + (sy - def.anchor[1]) * ps });
    if (def.alongBone) {
      // the scythe sheet is vertical (blade up); the bone runs butt -> blade along +x at restAngle.
      // Map sheet y (down) onto -x along the shaft and sheet x onto +y across it, then rotate by the rest angle.
      const ang = bone.restWorldAngle;
      part.toRoot = (sx, sy) => { const along = -(sy - def.anchor[1]) * S, across = (sx - def.anchor[0]) * S; return { x: bone.restHead.x + along * Math.cos(ang) - across * Math.sin(ang), y: bone.restHead.y + along * Math.sin(ang) + across * Math.cos(ang) }; };
    }
    if (def.mesh) {
      const [cols, rows] = def.mesh; const verts = [], uvs = [], weights = [], tris = [];
      const cw = w / cols, chh = h / rows;
      const bones = def.bones.map((n) => SKELETON.bones.get(n));
      for (let r = 0; r <= rows; r++) for (let cc = 0; cc <= cols; cc++) {
        const sx = x0 + cc * cw, sy = y0 + r * chh; const p = part.toRoot(sx, sy);
        verts.push(p); uvs.push([cc * cw, r * chh]);
        const scores = bones.map((b, bi) => [-segDist(p.x, p.y, b.restHead.x, b.restHead.y, b.restTail.x, b.restTail.y) / (b.length * 0.5 + 30), bi]).sort((a, b) => b[0] - a[0]);
        const best = scores[0][0]; const ws = scores.slice(0, 4).map(([sc, bi]) => [Math.exp((sc - best) / (def.blend || 0.1)), bi]); const sum = ws.reduce((s, q) => s + q[0], 0);
        weights.push(ws.map(([q, bi]) => [bones[bi].name, q / sum]));
      }
      for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols; cc++) {
        const a = r * (cols + 1) + cc, b = a + 1, d = a + cols + 1, e = d + 1;
        // skip cells with no pixels
        let any = false; for (let y = Math.floor(r * chh); y < Math.min(h, (r + 1) * chh) && !any; y += 2) for (let x = Math.floor(cc * cw); x < Math.min(w, (cc + 1) * cw); x += 2) if (sub.data[(y * w + x) * 4 + 3] > 8) { any = true; break; }
        if (any) tris.push([a, d, b], [b, d, e]);
      }
      part.meshData = { verts, uvs, weights, tris };
    }
    parts.push(part);
  }
  return { parts, sheet: full, W, H };
}

/** Transform a rest-space point by a bone's current pose. */
function boneMap(bone, p) {
  const r = SKELETON.bones.get(bone.name); const dx = p.x - r.restHead.x, dy = p.y - r.restHead.y; const a = bone.angle - r.restWorldAngle;
  const c = Math.cos(a), s = Math.sin(a); return { x: bone.head.x + dx * c - dy * s, y: bone.head.y + dx * s + dy * c };
}
function drawTriangle(ctx, canvas, s0, s1, s2, d0, d1, d2) {
  // affine map (s -> d), clip to the destination triangle (slightly expanded to hide seams)
  // expand the clip ~2.5 px past the triangle so antialiased clip edges overlap instead of leaving seams
  const cx = (d0.x + d1.x + d2.x) / 3, cy = (d0.y + d1.y + d2.y) / 3; const g = (p) => { const dx = p.x - cx, dy = p.y - cy, l = Math.hypot(dx, dy) || 1; const k = 2.5 / l; return { x: p.x + dx * k, y: p.y + dy * k }; };
  const e0 = g(d0), e1 = g(d1), e2 = g(d2);
  ctx.save(); ctx.beginPath(); ctx.moveTo(e0.x, e0.y); ctx.lineTo(e1.x, e1.y); ctx.lineTo(e2.x, e2.y); ctx.closePath(); ctx.clip();
  const sx1 = s1[0] - s0[0], sy1 = s1[1] - s0[1], sx2 = s2[0] - s0[0], sy2 = s2[1] - s0[1];
  const dx1 = d1.x - d0.x, dy1 = d1.y - d0.y, dx2 = d2.x - d0.x, dy2 = d2.y - d0.y;
  const det = sx1 * sy2 - sx2 * sy1; if (Math.abs(det) < 1e-6) { ctx.restore(); return; }
  const a = (dx1 * sy2 - dx2 * sy1) / det, b = (dy1 * sy2 - dy2 * sy1) / det, c = (dx2 * sx1 - dx1 * sx2) / det, d = (dy2 * sx1 - dy1 * sx2) / det;
  const e = d0.x - a * s0[0] - c * s0[1], f = d0.y - b * s0[0] - d * s0[1];
  ctx.transform(a, b, c, d, e, f); ctx.drawImage(canvas, 0, 0); ctx.restore();
}
export function drawPart(ctx, pose, part) {
  if (part.meshData) {
    const { verts, uvs, weights, tris } = part.meshData;
    const moved = verts.map((v, i) => { let x = 0, y = 0; for (const [bn, wgt] of weights[i]) { const q = boneMap(pose.bones.get(bn), v); x += q.x * wgt; y += q.y * wgt; } return { x, y }; });
    for (const [a, b, c] of tris) drawTriangle(ctx, part.canvas, uvs[a], uvs[b], uvs[c], moved[a], moved[b], moved[c]);
    return;
  }
  // rigid: one transform. Map the part's top-left through the bone.
  const bone = pose.bones.get(part.bone); const r = SKELETON.bones.get(part.bone);
  const o = part.toRoot(part.ox, part.oy), ax = part.toRoot(part.ox + 1, part.oy), ay = part.toRoot(part.ox, part.oy + 1);
  const m = (p) => boneMap(bone, p); const O = m(o), X = m(ax), Y = m(ay);
  ctx.save(); ctx.transform(X.x - O.x, X.y - O.y, Y.x - O.x, Y.y - O.y, O.x, O.y); ctx.drawImage(part.canvas, 0, 0); ctx.restore();
}
export const ORDER = ['boot_R', 'boot_L', 'torso', 'mantle', 'head', 'upper_L', 'lower_L', 'upper_R', 'lower_R', 'scythe', 'hand_L', 'hand_R'];
export function drawPose(ctx, pose, puppet, view, hidden = null) {
  ctx.save(); ctx.translate(view.x, view.y); ctx.scale((view.mirror ? -1 : 1) * view.scale, view.scale); ctx.scale(pose.rootScale.x, pose.rootScale.y);
  const r = pose.bones.get('root').head; const k = pose.channels.hoverShadow;
  ctx.save(); ctx.globalAlpha = 0.25 * k; ctx.beginPath(); ctx.ellipse(r.x + 4, r.y + 6, 96, 16, 0, 0, Math.PI * 2); ctx.fillStyle = '#1a1016'; ctx.fill(); ctx.restore();
  const byName = Object.fromEntries(puppet.parts.map((p) => [p.name, p]));
  const behind = pose.channels.propBehind >= 0.5; const order = behind ? ['scythe', ...ORDER.filter((n) => n !== 'scythe')] : ORDER;
  for (const n of order) { if (hidden && hidden.has(n)) continue; if (pose.channels.propVisible < 0.5 && n === 'scythe') continue; drawPart(ctx, pose, byName[n]); }
  ctx.restore();
}
