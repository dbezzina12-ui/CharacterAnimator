// Builds a complete character kit in the browser: pieces -> atlas -> Spine 4.2 JSON, plus the sheets artists paint on.
// The app and the command-line build (generator/build.mjs, through headless Chromium) both call this, so they produce the same files.
import { PIECES, PIECE_INFO, C } from './pieces.js';
import { buildRig, proportions, PRESETS, LIMITS } from './rig.js';
export { PRESETS, LIMITS, PIECE_INFO, proportions };

const D2R = Math.PI / 180;
const r2 = (v) => Math.round(v * 100) / 100;
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
export const PIECE_NAMES = Object.keys(PIECE_INFO);
/** Order used on the sheets: body from the top down, then the extras. */
export const SHEET_ORDER = ['head', 'torso', 'pelvis', 'upper-near', 'forearm-near', 'hand-near', 'upper-far', 'forearm-far', 'hand-far-back', 'hand-far-front', 'thigh-near', 'shin-near', 'foot-near', 'thigh-far', 'shin-far', 'foot-far', 'eyes-closed', 'gun', 'muzzle-flash', 'cape', 'staff'];

function alphaBounds(c, min = 0) {
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data; const W = c.width, H = c.height;
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0, i = 3; y < H; y++) for (let x = 0; x < W; x++, i += 4) if (d[i] > min) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}
/** Render one placeholder piece, crop it to its pixels, return the image and its rect in rig units (y up).
 *  A quarter-scale pass finds roughly where the piece is, so the full-scale pass only draws and scans a small canvas. */
function renderPiece(name, R, S) {
  const info = PIECE_INFO[name]; const local = info.frame === 'bone'; const H = R.P.height, m = Math.max(60, H * 0.12);
  const xs = Object.values(R.J).map((p) => p[0]);
  const X0 = local ? -H * 0.3 : Math.min(...xs) - H * 0.45, X1 = local ? H * 0.45 : Math.max(...xs) + H * 0.3, Y0 = local ? -H * 0.3 : -m, Y1 = local ? H * 0.3 : H * 1.12 + m;
  const draw = (x0, y1, w, h, s) => { const c = mk(w * s, h * s); const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.setTransform(s, 0, 0, -s, -x0 * s, y1 * s); PIECES[name](ctx, R); return c; };
  const s0 = 0.25, b0 = alphaBounds(draw(X0, Y1, X1 - X0, Y1 - Y0, s0)) || { x0: 0, y0: 0, x1: 1, y1: 1 }, pad0 = 8;
  const fx = X0 + b0.x0 / s0 - pad0, fy = Y1 - b0.y0 / s0 + pad0; const c = draw(fx, fy, (b0.x1 - b0.x0 + 1) / s0 + 2 * pad0, (b0.y1 - b0.y0 + 1) / s0 + 2 * pad0, S);
  const b = alphaBounds(c) || { x0: 0, y0: 0, x1: 1, y1: 1 }; const pad = 2;
  const x0 = Math.max(0, b.x0 - pad), y0 = Math.max(0, b.y0 - pad), x1 = Math.min(c.width - 1, b.x1 + pad), y1 = Math.min(c.height - 1, b.y1 + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1; const o = mk(w, h); o.getContext('2d').drawImage(c, x0, y0, w, h, 0, 0, w, h);
  return { name, canvas: o, px: [w, h], rect: { x: fx + x0 / S, y: fy - (y1 + 1) / S, w: w / S, h: h / S }, rot: 0 };
}
/** Where a replacement image sits: `rel` is its box relative to the placeholder's box (omitted = fit inside it), then nudge, scale, rotate. */
function placeArt(ph, a) {
  const iw = a.image.width, ih = a.image.height; let r;
  if (a.rel) r = { x: ph.rect.x + a.rel.x * ph.rect.w, y: ph.rect.y + a.rel.y * ph.rect.h, w: a.rel.w * ph.rect.w, h: a.rel.h * ph.rect.h };
  else { const k = Math.min(ph.rect.w / iw, ph.rect.h / ih); r = { w: iw * k, h: ih * k }; r.x = ph.rect.x + (ph.rect.w - r.w) / 2; r.y = ph.rect.y + (ph.rect.h - r.h) / 2; }
  const sc = a.scale ?? 1, cx = r.x + r.w / 2 + (a.dx || 0), cy = r.y + r.h / 2 + (a.dy || 0);
  return { x: cx - r.w * sc / 2, y: cy - r.h * sc / 2, w: r.w * sc, h: r.h * sc };
}

/** Build everything for one character. config = proportion params (see rig.js PRESETS) or a full joint table.
 *  art = { pieceName: { image, rel?, dx?, dy?, scale?, rot? } } replaces placeholder pieces with real art. */
export function buildKit(config = {}, { scale = 2, art = {} } = {}) {
  const P = config.J ? config : proportions(config); const R = buildRig(structuredClone(P)); R.J = R.P.J; const S = scale;
  const pieces = PIECE_NAMES.map((name) => {
    const ph = renderPiece(name, R, S); const a = art[name];
    // a painted head has its own eyes, so the placeholder eyelids would not match: blink with nothing until real eyelids are supplied
    if (name === 'eyes-closed' && !a?.image && art.head?.image) { const c = mk(2, 2); return { name, canvas: c, px: [2, 2], rect: { x: ph.rect.x, y: ph.rect.y, w: 2 / S, h: 2 / S }, rot: 0, blank: true, ph: { rect: ph.rect, px: ph.px, canvas: ph.canvas } }; }
    if (!a || !a.image) return { ...ph, ph: { rect: ph.rect, px: ph.px, canvas: ph.canvas } };
    const rect = placeArt(ph, a); const c = mk(rect.w * S, rect.h * S); const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(a.image, 0, 0, c.width, c.height);
    return { name, canvas: c, px: [c.width, c.height], rect, rot: a.rot || 0, custom: true, ph: { rect: ph.rect, px: ph.px, canvas: ph.canvas } };
  });
  const by = Object.fromEntries(pieces.map((p) => [p.name, p]));
  // ---- atlas: shelf pack, tallest first
  const W = Math.max(1024, 2 ** Math.ceil(Math.log2(Math.max(...pieces.map((p) => p.px[0])) + 4)), Math.round(1024 * S)); let x = 2, y = 2, rowH = 0;
  for (const p of [...pieces].sort((a, b) => b.px[1] - a.px[1])) { if (x + p.px[0] + 2 > W) { x = 2; y += rowH + 2; rowH = 0; } p.atlas = [x, y]; x += p.px[0] + 2; rowH = Math.max(rowH, p.px[1]); }
  const AH = y + rowH + 2; const atlasCanvas = mk(W, AH); const ag = atlasCanvas.getContext('2d'); for (const p of pieces) ag.drawImage(p.canvas, p.atlas[0], p.atlas[1]);
  const atlasText = [`${P.file}.png`, `size: ${W},${AH}`, 'filter: Linear,Linear', 'pma: false', ...pieces.flatMap((p) => [p.name, `bounds: ${p.atlas[0]},${p.atlas[1]},${p.px[0]},${p.px[1]}`]), ''].join('\n');
  // ---- attachments. Body pieces are drawn upright in world space, so the attachment undoes the bone's setup rotation.
  const skins = { default: {}, staff: {}, gun: {} }; const parts = []; const boneIndex = Object.fromEntries(R.bones.map((b, i) => [b.name, i]));
  for (const p of pieces) {
    const info = PIECE_INFO[p.name]; const w = R.world[info.bone]; const cx = p.rect.x + p.rect.w / 2, cy = p.rect.y + p.rect.h / 2; let att;
    if (info.mesh) att = meshAttachment(p, R.geo[info.mesh], R.world, boneIndex);
    else if (info.frame === 'bone') att = { x: r2(cx), y: r2(cy), ...(p.rot ? { rotation: r2(p.rot) } : {}), width: r2(p.rect.w), height: r2(p.rect.h) };
    else { const dx = cx - w.x, dy = cy - w.y, c = Math.cos(-w.rot * D2R), s = Math.sin(-w.rot * D2R); att = { x: r2(dx * c - dy * s), y: r2(dx * s + dy * c), rotation: r2(-w.rot + p.rot), width: r2(p.rect.w), height: r2(p.rect.h) }; }
    const slot = info.slot || p.name, skin = info.skin || 'default'; (skins[skin][slot] ||= {})[p.name] = att;
    const pivot = info.frame === 'bone' ? [(0 - p.rect.x) * S, (p.rect.y + p.rect.h) * S] : [(w.x - p.rect.x) * S, (p.rect.y + p.rect.h - w.y) * S];
    parts.push({ piece: p.name, slot, bone: info.bone, skin, image: `images/${p.name}.png`, sizePx: p.px, sizeUnits: [r2(p.rect.w), r2(p.rect.h)], pivotPx: pivot.map(r2), art: p.custom ? 'custom' : 'placeholder',
      drawnIn: info.frame === 'bone' ? 'bone frame (barrel along +x)' : info.mesh ? 'setup pose (upright); the rig bends it as a mesh across the cape bones' : 'setup pose (upright, as assembled)' });
  }
  const bx = pieces.filter((p) => PIECE_INFO[p.name].frame !== 'bone'); const minX = Math.min(...bx.map((p) => p.rect.x)), maxX = Math.max(...bx.map((p) => p.rect.x + p.rect.w)), maxY = Math.max(...bx.map((p) => p.rect.y + p.rect.h));
  const json = {
    skeleton: { spine: '4.2.40', x: Math.floor(minX - 20), y: -10, width: Math.ceil(maxX - minX + 40), height: Math.ceil(maxY + 20), images: './images/', fps: 30 },
    bones: R.bones, slots: R.slots, ik: R.ik, transform: R.transform, physics: R.physics,
    skins: [
      { name: 'default', attachments: skins.default },
      { name: 'staff', ik: ['staff/far-arm-ik', 'staff/near-arm-ik'], transform: ['staff/far-hand-rot', 'staff/near-hand-rot'], attachments: skins.staff },
      { name: 'gun', ik: ['gun/near-arm-ik'], transform: ['gun/near-hand-rot'], attachments: skins.gun },
    ],
    events: R.events, animations: R.animations,
  };
  return { P: R.P, R, scale: S, file: P.file, pieces, by, atlas: { canvas: atlasCanvas, w: W, h: AH, text: atlasText }, json, parts,
    partsDoc: { character: P.file, unitsToPixels: S, heightUnits: P.height, hand: P.hand, cape: !!P.cape, drawOrderBackToFront: R.slots.map((s) => s.name), parts } };
}

/** One image, weighted across a bone chain so it bends smoothly. Vertices run down the left edge and back up the right (all on the hull). */
function meshAttachment(p, chain, world, boneIndex) {
  const nb = chain.bones.length, rows = nb * 2 + 1; const top = chain.top, ax = chain.end[0] - top[0], ay = chain.end[1] - top[1], L2 = ax * ax + ay * ay;
  const cx = p.rect.x + p.rect.w / 2, cy = p.rect.y + p.rect.h / 2, cr = Math.cos(p.rot * D2R), sr = Math.sin(p.rot * D2R);
  const uv = []; for (let r = 0; r < rows; r++) uv.push([0, r / (rows - 1)]); for (let r = rows - 1; r >= 0; r--) uv.push([1, r / (rows - 1)]);
  const uvs = [], vertices = [];
  for (const [u, v] of uv) {
    const lx = (u - 0.5) * p.rect.w, ly = (0.5 - v) * p.rect.h; const wx = cx + lx * cr - ly * sr, wy = cy + lx * sr + ly * cr;
    const s = Math.min(1, Math.max(0, ((wx - top[0]) * ax + (wy - top[1]) * ay) / L2)), f = s * nb - 0.5;
    const i0 = Math.min(nb - 1, Math.max(0, Math.floor(f))), i1 = Math.min(nb - 1, i0 + 1), w1 = i1 === i0 ? 0 : Math.min(1, Math.max(0, f - i0));
    const inf = w1 > 0.001 && w1 < 0.999 ? [[i0, 1 - w1], [i1, w1]] : [[w1 >= 0.999 ? i1 : i0, 1]];
    uvs.push(r2(u), Math.round(v * 10000) / 10000); vertices.push(inf.length);
    for (const [bi, wt] of inf) { const b = world[chain.bones[bi]]; const dx = wx - b.x, dy = wy - b.y, c = Math.cos(-b.rot * D2R), sn = Math.sin(-b.rot * D2R); vertices.push(boneIndex[chain.bones[bi]], r2(dx * c - dy * sn), r2(dx * sn + dy * c), Math.round(wt * 1000) / 1000); }
  }
  const triangles = []; for (let r = 0; r < rows - 1; r++) { const lt = r, lb = r + 1, rt = 2 * rows - 1 - r, rb = 2 * rows - 2 - r; triangles.push(lt, rt, rb, lt, rb, lb); }
  return { type: 'mesh', uvs, triangles, vertices, hull: uv.length, width: r2(p.rect.w), height: r2(p.rect.h) };
}

/** Annotated template: the assembled setup pose with its skeleton, and every piece at export size with its pivot marked. */
export function templateSheet(kit) {
  const { R, scale: S, by } = kit; const H = R.P.height; const z = Math.min(1.6, 1150 / (H * 1.12));
  const Wc = 2600, Hc = Math.max(1500, Math.round(H * 1.25 * z) + 200); const c = mk(Wc, Hc); const g = c.getContext('2d');
  g.fillStyle = '#eef1f5'; g.fillRect(0, 0, Wc, Hc);
  g.fillStyle = C.line; g.font = '700 34px system-ui, sans-serif'; g.fillText(`${kit.file} — template sheet`, 40, 56);
  g.font = '18px system-ui, sans-serif'; g.fillStyle = '#44506a'; g.fillText('Left: setup pose (three-quarter, facing right) with the skeleton. Right: every piece at export size with its pivot (the bone it hangs on) marked. Paint over each piece without moving it.', 40, 88);
  const ox = 440, oy = Hc - 110; const X = (x) => ox + x * z, Y = (y) => oy - y * z;
  g.strokeStyle = '#b8c0cc'; g.lineWidth = 2; g.beginPath(); g.moveTo(60, oy); g.lineTo(840, oy); g.stroke();
  const order = [...(R.P.cape ? ['cape'] : []), 'upper-far', 'forearm-far', 'hand-far-back', 'staff', 'hand-far-front', 'thigh-far', 'shin-far', 'foot-far', 'pelvis', 'thigh-near', 'shin-near', 'foot-near', 'torso', 'head', 'upper-near', 'forearm-near', 'hand-near'];
  for (const n of order) { const p = by[n]; g.save(); g.translate(X(p.rect.x + p.rect.w / 2), Y(p.rect.y + p.rect.h / 2)); g.rotate(-p.rot * D2R); g.drawImage(p.canvas, -p.rect.w * z / 2, -p.rect.h * z / 2, p.rect.w * z, p.rect.h * z); g.restore(); }
  for (const [name, w] of Object.entries(R.world)) {
    if (name === 'root' || name.startsWith('gun') || (name.startsWith('cape') && !R.P.cape)) continue; const len = w.len || 0; const ex = w.x + Math.cos(w.rot * D2R) * len, ey = w.y + Math.sin(w.rot * D2R) * len;
    g.strokeStyle = name.includes('target') || name.startsWith('staff') ? '#e2463f' : name.startsWith('cape') ? '#9a4ff0' : '#1fae6b'; g.lineWidth = 3; g.beginPath(); g.moveTo(X(w.x), Y(w.y)); g.lineTo(X(ex), Y(ey)); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(X(w.x), Y(w.y), 4.5, 0, 7); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 1.5; g.stroke();
  }
  g.fillStyle = '#44506a'; g.font = '16px system-ui, sans-serif'; g.fillText(`height ${H} units · green = bones · red = IK targets and staff grips · purple = cape chain`, 60, oy + 40);
  let x = 920, y = 140, rowH = 0; const k = 0.62 * (2 / S); const staffH = Hc - 220;
  for (const n of SHEET_ORDER) {
    const p = by[n]; const kk = n === 'staff' ? Math.min(k, staffH / p.px[1]) : k; const w = p.px[0] * kk, h = p.px[1] * kk; if (n !== 'staff' && x + Math.max(w, 150) + 180 > Wc) { x = 920; y += rowH + 70; rowH = 0; }
    if (n === 'staff') { x = Wc - 150; y = 140; }
    g.fillStyle = '#fff'; g.fillRect(x - 6, y - 6, w + 12, h + 12); g.strokeStyle = '#c3cad6'; g.lineWidth = 1; g.strokeRect(x - 6, y - 6, w + 12, h + 12);
    g.drawImage(p.canvas, x, y, w, h);
    const info = PIECE_INFO[n]; const bw = R.world[info.bone]; const px = ((info.frame === 'bone' ? 0 : bw.x) - p.rect.x) * S * kk, py = (p.rect.y + p.rect.h - (info.frame === 'bone' ? 0 : bw.y)) * S * kk;
    if (px > -40 && px < w + 40 && py > -40 && py < h + 40) { g.strokeStyle = '#e2463f'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + px - 9, y + py); g.lineTo(x + px + 9, y + py); g.moveTo(x + px, y + py - 9); g.lineTo(x + px, y + py + 9); g.stroke(); }
    g.fillStyle = C.line; g.font = '600 15px system-ui, sans-serif'; g.fillText(n, x - 6, y + h + 26); g.font = '13px system-ui, sans-serif'; g.fillStyle = '#5b6780'; g.fillText(`${p.px[0]}×${p.px[1]} px · ${info.bone}`, x - 6, y + h + 44);
    x += Math.max(w, 150) + 36; rowH = Math.max(rowH, h);
  }
  return c;
}

/** Paint sheet: every piece in its own box on a flat key colour, 3:2, with the label under the box. Paint inside the boxes and
 *  upload the sheet again; the boxes map straight back onto the rig. The layout depends only on the proportions. */
export function paintSheet(kit, { key = '#ff00ff', width = 2400 } = {}) {
  const Hmax = Math.round(width * 2 / 3); const pad = 26, label = 30; let z = 2.2, cells;
  // the tall parts (staff, cape) stand in a column block on the left; everything else is shelved in rows beside them
  const layout = (zz) => {
    const out = []; const cellOf = (name) => { const r = kit.by[name].ph.rect; const m = Math.max(10, 0.12 * Math.min(r.w, r.h)); const box = { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m }; return { name, w: Math.round(box.w * zz), h: Math.round(box.h * zz), box }; };
    const all = SHEET_ORDER.map(cellOf).sort((p, q) => q.h - p.h); const tall = all.filter((c2) => c2.h > Hmax * 0.4), rest = all.filter((c2) => c2.h <= Hmax * 0.4);
    let left = pad, bottom = 0; for (const c2 of tall) { out.push({ ...c2, x: left, y: pad }); left += Math.max(c2.w, 70) + pad; bottom = Math.max(bottom, pad + c2.h + label + pad); }
    let x = left, y = pad, rowH = 0;
    for (const c2 of rest) { if (x + c2.w + pad > width) { x = left; y += rowH + label + pad; rowH = 0; } out.push({ ...c2, x, y }); x += Math.max(c2.w, 110) + pad; rowH = Math.max(rowH, c2.h); }
    return { out, height: Math.max(bottom, y + rowH + label + pad) };
  };
  for (; z > 0.3; z -= 0.04) { const l = layout(z); cells = l.out; if (l.height <= Hmax) break; }
  const c = mk(width, Hmax); const g = c.getContext('2d'); g.fillStyle = key; g.fillRect(0, 0, width, Hmax);
  for (const cell of cells) {
    const p = kit.by[cell.name]; const X = (x) => cell.x + (x - cell.box.x) * z, Y = (y) => cell.y + (cell.box.y + cell.box.h - y) * z;
    g.save(); g.beginPath(); g.rect(cell.x, cell.y, cell.w, cell.h); g.clip(); g.translate(X(p.rect.x + p.rect.w / 2), Y(p.rect.y + p.rect.h / 2)); g.rotate(-p.rot * D2R); g.drawImage(p.canvas, -p.rect.w * z / 2, -p.rect.h * z / 2, p.rect.w * z, p.rect.h * z); g.restore();
    g.font = '600 16px system-ui, sans-serif'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff'; g.fillRect(cell.x, cell.y + cell.h + 6, g.measureText(cell.name).width + 10, label - 10); g.fillStyle = '#111'; g.fillText(cell.name, cell.x + 5, cell.y + cell.h + 6 + (label - 10) / 2);
  }
  return { canvas: c, key, width, height: Hmax, pxPerUnit: r2(z), cells: cells.map((c2) => ({ name: c2.name, x: c2.x, y: c2.y, w: c2.w, h: c2.h, box: { x: r2(c2.box.x), y: r2(c2.box.y), w: r2(c2.box.w), h: r2(c2.box.h) } })) };
}

/** Cut a painted sheet back into pieces. Uses the image's own transparency when it has any; otherwise removes the background
 *  colour found in the sheet's corners. Returns { pieceName: { image, rel } } ready for buildKit's `art`. */
export function sliceSheet(image, sheet, kit) {
  const kx = image.width / sheet.width, ky = image.height / sheet.height; const full = mk(image.width, image.height); const fg = full.getContext('2d', { willReadFrequently: true }); fg.drawImage(image, 0, 0);
  const corner = (x, y) => fg.getImageData(Math.min(image.width - 1, Math.max(0, x)), Math.min(image.height - 1, Math.max(0, y)), 1, 1).data;
  const cs = [corner(3, 3), corner(image.width - 4, 3), corner(3, image.height - 4), corner(image.width - 4, image.height - 4)];
  const hasAlpha = cs.some((p) => p[3] < 200); const kc = [0, 1, 2].map((i) => cs.map((p) => p[i]).sort((a, b) => a - b)[1]);
  const out = {}; const skipped = [];
  for (const cell of sheet.cells) {
    const sx = Math.round(cell.x * kx), sy = Math.round(cell.y * ky), sw = Math.round(cell.w * kx), sh = Math.round(cell.h * ky); if (sw < 2 || sh < 2) continue;
    const c = mk(sw, sh); const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
    if (!hasAlpha) { const im = g.getImageData(0, 0, sw, sh), d = im.data; for (let i = 0; i < d.length; i += 4) { const dist = Math.hypot(d[i] - kc[0], d[i + 1] - kc[1], d[i + 2] - kc[2]); const a = Math.min(1, Math.max(0, (dist - 70) / 70));
      if (a > 0 && a < 1) for (let j = 0; j < 3; j++) d[i + j] = Math.min(255, Math.max(0, (d[i + j] - (1 - a) * kc[j]) / a));   // take the background colour back out of the soft edge
      d[i + 3] = Math.round(d[i + 3] * a); } g.putImageData(im, 0, 0); }
    const b = alphaBounds(c, 24); if (!b || (b.x1 - b.x0) * (b.y1 - b.y0) < sw * sh * 0.004) { skipped.push(cell.name); continue; }
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1; const t = mk(w, h); t.getContext('2d').drawImage(c, b.x0, b.y0, w, h, 0, 0, w, h);
    const ph = kit.by[cell.name].ph.rect; const ux = cell.box.x + b.x0 / sw * cell.box.w, uw = w / sw * cell.box.w, uh = h / sh * cell.box.h, uy = cell.box.y + cell.box.h - (b.y1 + 1) / sh * cell.box.h;
    out[cell.name] = { image: t, rel: { x: (ux - ph.x) / ph.w, y: (uy - ph.y) / ph.h, w: uw / ph.w, h: uh / ph.h } };
  }
  return { art: out, skipped, usedAlpha: hasAlpha };
}

/** A written brief for whoever paints the art (a person or another AI), specific to this character. */
export function brief(kit, sheet) {
  const P = kit.P; const q = P.params || {};
  return `# Art brief — ${kit.file}

You are painting the parts of a 2D game character that is animated as a cut-out rig in Spine 4.2.
The attached paint sheet (${sheet ? `${sheet.width}×${sheet.height} px` : '3:2'}) shows every part in its own box on a flat ${sheet ? sheet.key : 'magenta'} background.

## Rules
1. Keep every part inside its box, at the same position, size and angle as the placeholder. The boxes are cut out by position, so a part that drifts into another box or across the gap is lost.
2. The character faces RIGHT in a three-quarter view. "near" parts are on the viewer's side; "far" parts are on the other side and are usually a little darker.
3. Paint each part complete, including the area hidden under its neighbour. Joints overlap: the top of a forearm continues under the upper arm, the top of a thigh continues under the trousers, the neck continues under the head.
4. Keep the background flat ${sheet ? sheet.key : 'magenta'} (or fully transparent). No shadows, glow or texture on the background, and do not paint over the labels.
5. Return one image with the same aspect ratio (3:2) and the same layout. Do not add, remove, mirror or rearrange parts.

## Hands (the part that most often goes wrong)
- Both hands are CLOSED FISTS seen from the side, knuckles pointing along the forearm, with an empty channel through the fist where a weapon shaft passes.
- hand-near is one piece: the back of the hand and fingers, drawn in front of the weapon.
- The far hand is two pieces: hand-far-back is the palm (drawn behind the weapon); hand-far-front is the four fingers and thumb (drawn in front of it). Together they wrap the shaft.
- Do not paint open hands, pointing fingers or a hand at a different angle. The rig rotates the fist to match the weapon.

## Parts
${SHEET_ORDER.map((n) => { const p = kit.by[n]; return `- ${n}: ${Math.round(p.ph.rect.w)}×${Math.round(p.ph.rect.h)} units${PART_NOTES[n] ? ' — ' + PART_NOTES[n] : ''}`; }).join('\n')}

## This character
Name: ${q.name || kit.file}. Height ${P.height} units (${Math.round(P.height / (P.head.h || 1) * 10) / 10} heads tall). ${P.cape ? 'Wears a cape.' : 'No cape (the cape part can stay as it is).'}

## Changing the body shape instead of the art
The shape is a small JSON object. Edit the numbers and paste it into the Character Kit app (Export → Character settings → Apply), or save it as a file and run \`node spine-base/generator/build.mjs --config file.json --out outdir\`.
\`\`\`json
${JSON.stringify(q, null, 1)}
\`\`\`
height is in units (1 unit = ${kit.scale} px at export). Everything else is a ratio: head = head height ÷ height, headWidth = head width ÷ head height, legs = hip height ÷ height, arms = shoulder-to-wrist ÷ height, shoulders = shoulder span ÷ height, build = thickness (1 = average adult, about 1.9 = stocky dwarf), hands = fist length ÷ height, stance = half the gap between the ankles ÷ height, cape = true or false.
`;
}
const PART_NOTES = {
  head: 'whole head with hair and open eyes; hats, beards and horns can extend past the box edge a little',
  'eyes-closed': 'only the closed eyelids, to cover the open eyes during a blink',
  torso: 'chest, belly, neck and the cap of the near shoulder',
  pelvis: 'hips; both thighs tuck into it',
  'upper-near': 'near upper arm, shoulder to elbow', 'forearm-near': 'near forearm, elbow to wrist', 'hand-near': 'near fist, one piece',
  'upper-far': 'far upper arm', 'forearm-far': 'far forearm', 'hand-far-back': 'far fist: palm only', 'hand-far-front': 'far fist: fingers and thumb only',
  'thigh-near': 'near thigh, hip to knee', 'shin-near': 'near shin, knee to ankle', 'foot-near': 'near foot, flat on the ground, toe to the right',
  'thigh-far': 'far thigh', 'shin-far': 'far shin', 'foot-far': 'far foot',
  staff: 'upright; the hands hold it between the two dark bands', gun: 'barrel pointing right; the fist closes around the grip', 'muzzle-flash': 'flash pointing right, bright on transparent',
  cape: 'hangs straight down from the shoulders; the rig bends and sways it',
};

const pngBytes = (canvas) => new Promise((res) => canvas.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), 'image/png'));
const enc = (s) => new TextEncoder().encode(s);
/** Every file of the kit as { name, bytes }. `art` (the same object given to buildKit) is saved so the kit can be reopened and edited. */
export async function kitFiles(kit, { art = {}, key = '#ff00ff' } = {}) {
  const f = kit.file; const sheet = paintSheet(kit, { key }); const files = [];
  files.push({ name: `${f}.json`, bytes: enc(JSON.stringify(kit.json)) }, { name: `${f}.atlas`, bytes: enc(kit.atlas.text) }, { name: `${f}.png`, bytes: await pngBytes(kit.atlas.canvas) });
  for (const p of kit.pieces) files.push({ name: `images/${p.name}.png`, bytes: await pngBytes(p.canvas) });
  const artDoc = {}; for (const [n, a] of Object.entries(art)) { if (!a?.image) continue; artDoc[n] = { file: `art/${n}.png`, ...(a.rel ? { rel: a.rel } : {}), dx: a.dx || 0, dy: a.dy || 0, scale: a.scale ?? 1, rot: a.rot || 0 }; files.push({ name: `art/${n}.png`, bytes: await pngBytes(a.image) }); }
  files.push({ name: 'character.json', bytes: enc(JSON.stringify({ format: 'slot-character-kit/1', settings: kit.P.params || null, joints: kit.P.params ? undefined : kit.P, art: artDoc }, null, 1)) });
  files.push({ name: 'parts.json', bytes: enc(JSON.stringify(kit.partsDoc, null, 1)) });
  files.push({ name: 'paint-sheet.png', bytes: await pngBytes(sheet.canvas) }, { name: 'paint-sheet.json', bytes: enc(JSON.stringify({ key: sheet.key, width: sheet.width, height: sheet.height, pxPerUnit: sheet.pxPerUnit, cells: sheet.cells }, null, 1)) });
  files.push({ name: 'template.png', bytes: await pngBytes(templateSheet(kit)) }, { name: 'ART-BRIEF.md', bytes: enc(brief(kit, sheet)) });
  return files;
}
