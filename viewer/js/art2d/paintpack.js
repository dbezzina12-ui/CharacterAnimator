// Paint-template pack + joint-coverage analysis for painting replacement skins.
//  * jointCoverage(): bends each joint (neck, shoulders, elbows, wrists, hips, knees, ankles) and measures
//    how much of the joint's body region opens up (lost coverage) between the neighbouring pieces. A gap
//    means a piece needs hidden material painted beneath its neighbour.
//  * paintTemplatePack(): per-piece canvases with SEPARATE guide layers (silhouette, joints/pivot/markers,
//    underlap zones), a layers.json the fitting workflow re-imports directly, a clean preview without
//    guides and a manifest of what exists / is still missing.
import { Rig, affApply, affInv } from './core.js';
import { offscreenRenderer, renderPose, poseBounds } from './exporters.js';
import { decodeImage, encodePNG } from './project-io.js';
import { slotAnchors, jointName } from './fitting.js';
import { writeZip } from './zip.js';

const JOINT_TESTS = [['head', [-25, 25]], ['upperarm', [-60, 75]], ['forearm', [-100, 100]], ['hand', [-40, 40]], ['thigh', [-50, 50]], ['shin', [-95, 95]], ['foot', [-30, 30]]];

/** Slots touching the joint at bone B's origin: art on B or its parent, or weighted to either. */
function jointPieces(P, B) {
  const parent = P.bones.find((b) => b.id === B)?.parent, set = new Set([B, parent]), out = { parent: [], child: [], all: [] };
  for (const s of P.slots) {
    const a = s.attachment && P.attachments[s.attachment]; if (!a) continue;
    const w = a.weights ? new Set(a.weights.flatMap((l) => l.filter((_, i) => i % 2 === 0))) : null;
    const touches = set.has(a.bone) || (w && (w.has(B) || w.has(parent)));
    if (!touches) continue;
    out.all.push(s.id);
    if (a.bone === B || (w && w.has(B) && a.bone !== parent)) out.child.push(s.id); else out.parent.push(s.id);
  }
  return out;
}

export async function jointCoverage(project, store, { skin = 'default', scale = 0.5, threshold = 0.03, renderer = null } = {}) {
  const P = project, rig = new Rig(P); rig.setSkin(skin);
  const r = renderer || await offscreenRenderer(P, store), out = [];
  for (const [base, angles] of JOINT_TESTS) for (const side of ['', '_L', '_R']) {
    const B = base + side; if (!rig.boneIndex.has(B) || (base !== 'head' && !side)) continue;
    const pieces = jointPieces(P, B); if (pieces.all.length < 2) continue;
    const only = new Set(pieces.all), Wb = rig.bindWorld[rig.boneIndex.get(B)], J = [Wb[4], Wb[5]];
    const R = 90, rect = [J[0] - R, J[1] - R, J[0] + R, J[1] + R], N = Math.round(2 * R * scale);
    const mask = (img) => { const m = new Uint8Array(N * N); for (let i = 0; i < m.length; i++) m[i] = img.data[i * 4 + 3] > 40 ? 1 : 0; return m; };
    const M0 = mask(renderPose(r, rig, rig.evaluate(null, 0), rect, scale, { only }));
    // limb half-width at the joint: distance to the silhouette edge across the bone, both sides
    const dir = [Wb[0], Wb[1]], nrm = [-dir[1] / Math.hypot(...dir), dir[0] / Math.hypot(...dir)];
    const at = (m, x, y) => { const px = Math.round((x - rect[0]) * scale), py = Math.round((rect[3] - y) * scale); return px >= 0 && py >= 0 && px < N && py < N ? m[py * N + px] : 0; };
    let left = 0, right = 0; while (left < R - 2 && at(M0, J[0] + nrm[0] * left, J[1] + nrm[1] * left)) left += 1; while (right < R - 2 && at(M0, J[0] - nrm[0] * right, J[1] - nrm[1] * right)) right += 1;
    const rad = Math.max(4, Math.min(left, right) * 0.85);
    let worst = { gap: 0, angle: 0 };
    for (const ang of angles) {
      const M1 = mask(renderPose(r, rig, rig.evaluate(null, 0, { override: { [B]: { rotate: ang } } }), rect, scale, { only }));
      let inDisk = 0, lost = 0;
      for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
        const x = rect[0] + px / scale, y = rect[3] - py / scale; if (Math.hypot(x - J[0], y - J[1]) > rad) continue;
        if (!M0[py * N + px]) continue; inDisk++; if (!M1[py * N + px]) lost++;
      }
      const gap = inDisk ? lost / inDisk : 0; if (gap > worst.gap) worst = { gap, angle: ang };
    }
    const flagged = worst.gap > threshold;
    out.push({ joint: jointName(B), bone: B, worstAngle: worst.angle, gapPct: +(worst.gap * 100).toFixed(1), thresholdPct: threshold * 100, radiusPx: +rad.toFixed(1), pieces, flagged,
      hint: flagged ? `at ${worst.angle}° the joint opens ${(worst.gap * 100).toFixed(1)}% of its area: paint hidden material on ${pieces.child.join('/') || '(child piece)'} extending under ${pieces.parent.join('/') || '(parent piece)'} (or extend the parent piece under the child)` : 'covered' });
  }
  return out;
}

// ------------------------------------------------------------------ template pack ----
const id2file = (id) => `${id.replace(/[^\w.-]+/g, '_')}.png`;
function canvas2d(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; }
async function canvasPNG(c) { const b = await new Promise((res) => c.toBlob(res, 'image/png')); return new Uint8Array(await b.arrayBuffer()); }

/**
 * Pieces to paint for a skin: every attachment of the starter (no "@skin" ids), with its status in `skin`.
 * Returns the zip bytes plus the manifest.
 */
export async function paintTemplatePack(project, store, { skin = 'painted', canvasScale = 0.5, margin = 60, coverage = null } = {}) {
  const P = project, rig = new Rig(P), sk = (P.skins || []).find((s) => s.id === skin) || { replace: {}, status: {} };
  rig.setSkin('default');
  const setup = rig.evaluate(null, 0), [bx0, by0, bx1, by1] = poseBounds(rig, setup);
  const x0 = bx0 - margin, y0 = Math.min(0, by0) - margin, x1 = bx1 + margin, y1 = by1 + margin;
  const cs = canvasScale, CW = Math.ceil((x1 - x0) / cs), CH = Math.ceil((y1 - y0) / cs), origin = [+(-x0 / cs).toFixed(2), +(y1 / cs).toFixed(2)];
  const files = [], layers = [], pieces = [];
  const r = await offscreenRenderer(P, store);
  const order = rig.setupOrder;
  for (const a of Object.values(P.attachments)) {
    if (a.id.includes('@')) continue;
    const im = P.images[a.image], rec = rig.attachments.get(a.id), s = a.imageScale ?? 1, mir = a.transform?.mirror ? -1 : 1;
    const toWorld = (ix, iy) => affApply(rec.place, (ix - a.pivot[0]) * s * mir, (a.pivot[1] - iy) * s);
    const toImg = (wx, wy) => { const p = affApply(affInv(rec.place), wx, wy); return [p[0] / (s * mir) + a.pivot[0], a.pivot[1] - p[1] / s]; };
    const centre = toWorld(im.w / 2, im.h / 2), rot = Math.atan2(rec.place[1], rec.place[0]) * 180 / Math.PI;
    const isDefault = P.slots.find((x) => x.id === a.slot)?.attachment === a.id;
    const W = im.w, H = im.h, dir = `pieces/${a.id}`;
    const cur = await decodeImage(store.bytes(im.path));
    // guide 1: flat silhouette of the current piece (paint over it; keep the outline)
    const [c1, g1] = canvas2d(W, H), sil = g1.createImageData(W, H);
    for (let i = 0; i < W * H; i++) if (cur.data[i * 4 + 3] > 8) { sil.data[i * 4] = 128; sil.data[i * 4 + 1] = 136; sil.data[i * 4 + 2] = 150; sil.data[i * 4 + 3] = 110; }
    g1.putImageData(sil, 0, 0);
    // guide 2: joints, pivot, contact markers, bone direction
    const [c2, g2] = canvas2d(W, H); g2.font = `${Math.max(10, Math.round(W / 22))}px sans-serif`; g2.lineWidth = 2;
    const mark = (p, col, label, rr = 7) => { g2.strokeStyle = col; g2.fillStyle = col; g2.beginPath(); g2.arc(p[0], p[1], rr, 0, 7); g2.stroke(); g2.beginPath(); g2.moveTo(p[0] - rr - 4, p[1]); g2.lineTo(p[0] + rr + 4, p[1]); g2.moveTo(p[0], p[1] - rr - 4); g2.lineTo(p[0], p[1] + rr + 4); g2.stroke(); g2.fillText(label, p[0] + rr + 5, p[1] - rr); };
    const anchors = a.slot && slotAnchors(P, rig, a.slot);
    const anchorImg = anchors ? anchors.map((j) => ({ name: j.name, image: toImg(...j.world).map((v) => +v.toFixed(1)) })) : [];
    anchorImg.forEach((j) => mark(j.image, '#00e5ff', j.name, 9));
    mark(a.pivot, '#ffd400', 'pivot', 5);
    for (const [k, m] of Object.entries(a.markers || {})) mark(m, '#ff5a1f', k, 5);
    // guide 3: underlap — (a) parts hidden under pieces drawn in front at setup (keep fully painted),
    // (b) around joints, the neighbours' area the piece should extend into (paint hidden material there)
    const [c3, g3] = canvas2d(W, H), ul = g3.createImageData(W, H);
    const front = new Set(order.slice(order.indexOf(a.slot) + 1)), neighbours = new Set();
    const tl = toWorld(0, 0), br = toWorld(W, H), axisAligned = Math.abs(rot) < 0.5 && mir === 1;
    if (axisAligned && order.includes(a.slot)) {
      const rect = [tl[0], br[1], br[0], tl[1]];
      const fr = renderPose(r, rig, setup, rect, 1 / s, { only: front });
      const others = renderPose(r, rig, setup, rect, 1 / s, { only: new Set(order.filter((x) => x !== a.slot)) });
      const rad = anchors ? Math.max(14, Math.min(W, H) * 0.22) : 0;
      for (let y = 0; y < Math.min(H, fr.height); y++) for (let x = 0; x < Math.min(W, fr.width); x++) {
        const i = y * W + x, j = y * fr.width + x, mine = cur.data[i * 4 + 3] > 8;
        if (mine && fr.data[j * 4 + 3] > 40) { ul.data[i * 4] = 255; ul.data[i * 4 + 1] = 64; ul.data[i * 4 + 2] = 160; ul.data[i * 4 + 3] = ((x + y) % 8 < 3) ? 150 : 40; }
        else if (!mine && others.data[j * 4 + 3] > 40 && anchorImg.some((an) => Math.hypot(x - an.image[0], y - an.image[1]) < rad)) { ul.data[i * 4] = 40; ul.data[i * 4 + 1] = 220; ul.data[i * 4 + 2] = 120; ul.data[i * 4 + 3] = ((x - y + 64) % 8 < 3) ? 170 : 50; }
      }
      for (const sid of front) neighbours.add(sid);
    }
    g3.putImageData(ul, 0, 0);
    files.push({ path: `${dir}/current.png`, data: store.bytes(im.path) }, { path: `${dir}/guide-silhouette.png`, data: await canvasPNG(c1) },
      { path: `${dir}/guide-joints.png`, data: await canvasPNG(c2) }, { path: `${dir}/guide-underlap.png`, data: await canvasPNG(c3) });
    const cx = (centre[0] - x0) / cs, cy = (y1 - centre[1]) / cs;
    const status = sk.replace?.[a.id] ? (sk.status?.[a.id] || 'finished') : 'missing';
    layers.push({ file: id2file(a.id), target: a.id, slot: a.slot, name: skin, x: +(cx - W / 2).toFixed(2), y: +(cy - H / 2).toFixed(2), rotation: +rot.toFixed(3), w: W, h: H,
      mode: 'replace', mesh: a.weights ? 'weighted' : 'rigid' });
    pieces.push({ attachment: a.id, slot: a.slot, bone: a.bone, setupArt: isDefault, file: id2file(a.id), size: [W, H], displayScale: s, pivot: a.pivot, joints: anchorImg,
      markers: a.markers || null, mesh: a.weights ? 'weighted (bends: paint underlap at the joints)' : 'rigid (keep plates solid)', view: a.view, status,
      variantOf: isDefault ? null : P.slots.find((x) => x.id === a.slot)?.attachment, guides: [`${dir}/guide-silhouette.png`, `${dir}/guide-joints.png`, `${dir}/guide-underlap.png`] });
  }
  // clean preview (no guides) and a guide overview
  const prev = renderPose(r, rig, setup, [x0, y0, x1, y1], 1 / cs);
  const [pc, pg] = canvas2d(prev.width, prev.height); pg.putImageData(prev, 0, 0);
  files.push({ path: 'preview-clean.png', data: await canvasPNG(pc) });
  pg.font = '14px sans-serif'; pg.lineWidth = 2;
  for (const b of rig.bones) { if (!/^(head|neck|chest|upperarm|forearm|hand|thigh|shin|foot)(_[LR])?$/.test(b.id)) continue; const m = rig.bindWorld[rig.boneIndex.get(b.id)], X = (m[4] - x0) / cs, Y = (y1 - m[5]) / cs; pg.strokeStyle = '#00e5ff'; pg.beginPath(); pg.arc(X, Y, 8, 0, 7); pg.stroke(); pg.fillStyle = '#00e5ff'; pg.fillText(jointName(b.id), X + 10, Y - 8); }
  files.push({ path: 'preview-joints.png', data: await canvasPNG(pc) });
  const manifest = { schema: 'gamboligy.paint-template/1.0', character: P.characterId, skin, canvas: { w: CW, h: CH }, origin, scale: cs,
    note: 'Paint each piece on its own transparent PNG at exactly the listed size, named as in layers.json. Guides are separate layers: do not bake them into the art.',
    counts: { pieces: pieces.length, finished: pieces.filter((p) => p.status === 'finished').length, missing: pieces.filter((p) => p.status === 'missing').length },
    coverage, pieces };
  files.push({ path: 'layers.json', data: JSON.stringify({ canvas: { w: CW, h: CH }, origin, scale: cs, skin, layers }, null, 1) });
  files.push({ path: 'manifest.json', data: JSON.stringify(manifest, null, 1) });
  return { zip: writeZip(files), manifest, layers, files };
}
