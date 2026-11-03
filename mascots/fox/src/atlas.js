// Sprite-atlas export for the Canvas 2D game pipeline (same shape as Olaf's painted-swing manifest):
// frames rendered on a fixed source canvas, trimmed to their alpha bounds, de-duplicated by pixel
// hash (a stationary idle collapses to a handful of frames), shelf-packed onto PNG pages.
import { solvePose } from './solver.js';
import { drawPose } from './renderer.js';
import { BALL } from './clips.js';
import { CLUB } from './skeleton.js';

function hashPixels(data) {
  let h = 2166136261;
  for (let i = 0; i < data.length; i += 4) { h ^= data[i] + (data[i + 1] << 8) + (data[i + 2] << 16) + (data[i + 3] << 24); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16) + ':' + data.length;
}

function trimBounds(img, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > 2) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Render `clipNames` to an atlas. Returns { manifest, pages: [dataURL] }.
 * Options: fps, cell (source canvas size), scale, groundY (fraction of cell), pageWidth, pageMaxHeight, padding, mirror.
 */
export function exportAtlas(clipNames, { clips, fps = 30, cell = 512, scale = 0.58, groundY = 0.92, pageWidth = 2048, pageMaxHeight = 2048, padding = 3, mirror = false, createCanvas = null } = {}) {
  const mk = createCanvas || ((w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; });
  const src = mk(cell, cell); const sctx = src.getContext('2d', { willReadFrequently: true });
  const view = { x: cell / 2, y: cell * groundY, scale, mirror };
  const frames = [], unique = new Map(), clipFrames = {}, markers = {};
  for (const name of clipNames) {
    const clip = clips[name];
    const n = Math.round(clip.duration * fps) + (clip.loop ? 0 : 1);
    clipFrames[name] = [];
    for (let i = 0; i < n; i++) {
      const t = i / fps;
      sctx.clearRect(0, 0, cell, cell);
      drawPose(sctx, solvePose(clip, t), view);
      const img = sctx.getImageData(0, 0, cell, cell);
      const b = trimBounds(img, cell, cell);
      const cut = sctx.getImageData(b.x, b.y, b.w, b.h);
      const key = hashPixels(cut.data);
      let idx = unique.get(key);
      if (idx === undefined) { idx = frames.length; unique.set(key, idx); frames.push({ img: cut, w: b.w, h: b.h, offsetX: b.x, offsetY: b.y }); }
      clipFrames[name].push(idx);
    }
    markers[name] = Object.fromEntries(Object.entries(clip.markers || {}).map(([m, t]) => [m, Math.round(t * fps)]));
  }
  // shelf packing (frames in order; rows of decreasing height would pack tighter but order keeps clips contiguous)
  const pages = []; let page = null;
  const newPage = () => { page = { canvas: mk(pageWidth, pageMaxHeight), ctx: null, x: padding, y: padding, rowH: 0, used: 0 }; page.ctx = page.canvas.getContext('2d'); pages.push(page); };
  newPage();
  for (const f of frames) {
    if (page.x + f.w + padding > pageWidth) { page.x = padding; page.y += page.rowH + padding; page.rowH = 0; }
    if (page.y + f.h + padding > pageMaxHeight) { newPage(); }
    page.ctx.putImageData(f.img, page.x, page.y);
    f.page = pages.length - 1; f.x = page.x; f.y = page.y;
    page.x += f.w + padding; page.rowH = Math.max(page.rowH, f.h); page.used = Math.max(page.used, page.y + f.h + padding);
  }
  const pageOut = pages.map((p) => {
    const h = Math.max(1, p.used);
    const c = mk(pageWidth, h); c.getContext('2d').drawImage(p.canvas, 0, 0, pageWidth, h, 0, 0, pageWidth, h);
    return { dataURL: c.toDataURL('image/png'), width: pageWidth, height: h };
  });
  const bodyHeight = Math.round(540 * scale);
  const footY = cell * groundY;
  const manifest = {
    name: 'Birdie the Fox — rig render', rig: 'mascots/fox', fps,
    frameWidth: cell, frameHeight: cell, frameCount: frames.length,
    pages: pageOut.map((p, i) => ({ image: `fox-packed-${i + 1}.png`, width: p.width, height: p.height })),
    frames: frames.map((f) => ({ page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, offsetX: f.offsetX, offsetY: f.offsetY })),
    clips: Object.fromEntries(Object.entries(clipFrames).map(([k, v]) => [k, { frames: v, loop: !!clips[k].loop, markers: markers[k], durationMs: Math.round(clips[k].duration * 1000) }])),
    anchors: { footX: cell / 2, footY, bodyHeight, contactX: cell / 2 + (mirror ? -1 : 1) * BALL.x * scale, contactY: footY + BALL.y * scale, unit: scale },
    notes: 'Frames rendered from the deterministic rig at fixed fps, trimmed to alpha bounds (offsetX/offsetY restore registration on the source canvas), identical frames de-duplicated. Markers are frame indices into clips.<name>.frames.',
    decodedAtlasBytes: pageOut.reduce((s, p) => s + p.width * p.height * 4, 0),
  };
  return { manifest, pages: pageOut.map((p) => p.dataURL) };
}
