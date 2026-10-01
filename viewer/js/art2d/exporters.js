// Game exports.
//  A) runtime package: gamboligy.character2d-runtime/1.0 JSON + atlas pages (+ the standalone player)
//  B) transparent PNG frame and sprite sheets with a manifest (stable registration, trim offsets,
//     split pages, padding + edge extrusion, looping clips never repeat their first frame at the end)
import { Rig, frameTimes } from './core.js';
import { Renderer2D } from './render2d.js';
import { runtimeSubset, validateProject, SCHEMA } from './schema.js';
import { writeZip, toBytes } from './zip.js';
import { decodeImage, encodePNG } from './project-io.js';

export const SHEET_SCHEMA = 'gamboligy.spritesheet/1.0';

// ------------------------------------------------------------------ packing ---------
/** Shelf packer: rects [{w,h,...}] -> pages [{w,h,items:[{...,x,y}]}]; each rect gets pad+extrude around it. */
export function packRects(rects, { maxSize = 2048, pad = 2, extrude = 1 } = {}) {
  const border = pad + extrude, order = rects.map((r, i) => i).sort((a, b) => rects[b].h - rects[a].h || rects[b].w - rects[a].w);
  const pages = [];
  let page = null, x = 0, y = 0, rowH = 0;
  const newPage = () => { page = { w: 0, h: 0, items: [] }; pages.push(page); x = 0; y = 0; rowH = 0; };
  for (const i of order) {
    const r = rects[i], W = r.w + 2 * border, H = r.h + 2 * border;
    if (W > maxSize || H > maxSize) {                 // larger than a page: its own page
      pages.push({ w: W, h: H, items: [{ ...r, index: i, x: border, y: border }], oversize: true });
      continue;
    }
    if (!page) newPage();
    if (x + W > maxSize) { x = 0; y += rowH; rowH = 0; }
    if (y + H > maxSize) { newPage(); }
    page.items.push({ ...r, index: i, x: x + border, y: y + border });
    x += W; rowH = Math.max(rowH, H);
    page.w = Math.max(page.w, x); page.h = Math.max(page.h, y + rowH);
  }
  for (const p of pages) { p.w = pow2ish(p.w); p.h = pow2ish(p.h); }
  return pages;
}
const pow2ish = (n) => Math.ceil(n / 4) * 4;

/** Blit ImageData src into dst at (x, y), repeating the edge pixels `extrude` times outward. */
function blit(dst, src, x, y, extrude) {
  const W = dst.width, s = src.data, d = dst.data;
  for (let j = -extrude; j < src.height + extrude; j++) {
    const sy = Math.min(src.height - 1, Math.max(0, j));
    for (let i = -extrude; i < src.width + extrude; i++) {
      const sx = Math.min(src.width - 1, Math.max(0, i)), si = (sy * src.width + sx) * 4, di = ((y + j) * W + (x + i)) * 4;
      d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = s[si + 3];
    }
  }
}

// ------------------------------------------------------------------ runtime package -
/**
 * Runtime package ZIP. Only playback data: no reference images, editor state or undo history.
 * `player`: optional { 'gamboligy-character2d.js': text, 'README.md': text, 'index.html': text } copied in.
 */
export async function exportRuntimePackage(project, store, { maxPage = 2048, pad = 2, extrude = 1, player = null, name = null } = {}) {
  const used = [...new Set(Object.values(project.attachments).map((a) => a.image))].filter((id) => project.images[id]);
  const imgs = [];
  for (const id of used) {
    const bytes = store.bytes(project.images[id].path);
    if (!bytes) throw new Error(`image file ${project.images[id].path} is missing`);
    imgs.push({ id, data: await decodeImage(bytes) });
  }
  const pages = packRects(imgs.map((im) => ({ w: im.data.width, h: im.data.height, id: im.id })), { maxSize: maxPage, pad, extrude });
  const files = [], atlas = { pages: [], pad, extrude, premultipliedAlpha: false }, images = {};
  for (let p = 0; p < pages.length; p++) {
    const pg = pages[p], out = new ImageData(pg.w, pg.h);
    for (const it of pg.items) { blit(out, imgs[it.index].data, it.x, it.y, extrude); images[it.id] = { page: p, x: it.x, y: it.y, w: it.w, h: it.h }; }
    const path = `atlas_${p}.png`;
    files.push({ path, data: await encodePNG(out) });
    atlas.pages.push({ path, w: pg.w, h: pg.h });
  }
  const pkg = runtimeSubset(project, { atlas });
  pkg.images = images;
  const report = validateProject(pkg, { runtime: true, images: new Set(files.map((f) => f.path)) });
  if (report.errors.length) throw new Error('runtime package failed validation: ' + report.errors.slice(0, 5).join('; '));
  const base = name || project.characterId;
  files.unshift({ path: `${base}.runtime.json`, data: JSON.stringify(pkg) });
  if (player) for (const [p, text] of Object.entries(player)) files.push({ path: p, data: text });
  return { zip: writeZip(files), pkg, files, report };
}

// ------------------------------------------------------------------ frames ----------
/** Project-space bounds of a pose (deformed meshes of the visible attachments). */
export function poseBounds(rig, pose) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of rig.drawList(pose)) {
    const p = rig.skinAttachment(d.attachment, pose);
    for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
  }
  return [x0, y0, x1, y1];
}

/** Offscreen renderer with the project's images loaded (reused across frames). */
export async function offscreenRenderer(project, store) {
  const c = document.createElement('canvas');
  const r = new Renderer2D(c);
  await r.loadImages(project, (p) => store.url(p));
  return r;
}

/** Render a pose into ImageData covering project rect [x0,y0,x1,y1] at `scale` output px per project px. */
export function renderPose(r, rig, pose, rect, scale, { only = null, background = null } = {}) {
  const [x0, y0, x1, y1] = rect, W = Math.max(1, Math.round((x1 - x0) * scale)), H = Math.max(1, Math.round((y1 - y0) * scale));
  r.canvas.width = W; r.canvas.height = H;
  r.background = background;
  r.draw(rig, pose, { dpr: 1, only, view: { x: x0 + W / scale / 2, y: y0 + H / scale / 2, zoom: scale } });
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(r.canvas, 0, 0);
  return g.getImageData(0, 0, W, H);
}

function trim(img) {
  const { width: w, height: h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { img: new ImageData(1, 1), x: 0, y: 0 };
  const tw = x1 - x0 + 1, th = y1 - y0 + 1, out = new ImageData(tw, th);
  for (let y = 0; y < th; y++) out.data.set(data.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x1 + 1) * 4), y * tw * 4);
  return { img: out, x: x0, y: y0 };
}

/** Transparent PNG of one evaluated pose, tightly framed (+margin). */
export async function exportFramePNG(project, store, rig, pose, { scale = 1, margin = 4 } = {}) {
  const r = await offscreenRenderer(project, store);
  const b = poseBounds(rig, pose), m = margin / scale;
  const img = renderPose(r, rig, pose, [b[0] - m, b[1] - m, b[2] + m, b[3] + m], scale);
  return encodePNG(img);
}

/**
 * Sprite sheets for clips. Every frame of a clip shares one frame size and registration point (the
 * project origin = ground point under the character), frames are trimmed and packed with offsets.
 */
export async function exportSpriteSheets(project, store, { clips = null, fps = 30, scale = 0.5, maxSheet = 2048, pad = 2, extrude = 1, skin = 'default', onProgress = null } = {}) {
  // never bake frames from deformation keys that belong to another mesh (or a broken deformFrom chain)
  const bad = validateProject(project).errors.filter((e) => /deform/.test(e));
  if (bad.length) throw new Error('sprite export refused: ' + bad.slice(0, 3).join('; '));
  const rig = new Rig(project); rig.setSkin(skin);
  const r = await offscreenRenderer(project, store);
  const names = clips || project.clips.map((c) => c.name);
  const manifest = { schema: SHEET_SCHEMA, character: project.characterId, generatedFrom: SCHEMA, skin, scale, fps, pad, extrude,
    premultipliedAlpha: false, registration: 'project origin (ground point under the character)', sheets: [], clips: {} };
  const frames = [];
  for (const name of names) {
    const clip = rig.clips.get(name); if (!clip) continue;
    const times = frameTimes(clip.duration, fps, !!clip.loop);
    let U = [Infinity, Infinity, -Infinity, -Infinity];
    for (const t of times) { const b = poseBounds(rig, rig.evaluate(clip, t)); U = [Math.min(U[0], b[0]), Math.min(U[1], b[1]), Math.max(U[2], b[2]), Math.max(U[3], b[3])]; }
    const m = 2 / scale; U = [Math.floor(U[0] - m), Math.floor(U[1] - m), Math.ceil(U[2] + m), Math.ceil(U[3] + m)];
    const W = Math.round((U[2] - U[0]) * scale), H = Math.round((U[3] - U[1]) * scale);
    const entry = { loop: !!clip.loop, duration: clip.duration, frameCount: times.length, frameSize: [W, H],
      registration: [+((0 - U[0]) * scale).toFixed(2), +((U[3] - 0) * scale).toFixed(2)], events: clip.tracks?.events || [], frames: [] };
    manifest.clips[name] = entry;
    for (let i = 0; i < times.length; i++) {
      const img = renderPose(r, rig, rig.evaluate(clip, times[i]), U, scale);
      const tr = trim(img);
      frames.push({ clip: name, i, t: times[i], img: tr.img, offset: [tr.x, tr.y] });
      onProgress?.(name, i, times.length);
    }
  }
  const pages = packRects(frames.map((f, k) => ({ w: f.img.width, h: f.img.height, k })), { maxSize: maxSheet, pad, extrude });
  const files = [];
  for (let p = 0; p < pages.length; p++) {
    const pg = pages[p], out = new ImageData(pg.w, pg.h);
    for (const it of pg.items) { const f = frames[it.k]; blit(out, f.img, it.x, it.y, extrude); f.rect = [p, it.x, it.y, it.w, it.h]; }
    const path = `sheet_${p}.png`;
    files.push({ path, data: await encodePNG(out) });
    manifest.sheets.push({ path, w: pg.w, h: pg.h });
  }
  for (const f of frames) {
    const [sheet, x, y, w, h] = f.rect;
    manifest.clips[f.clip].frames[f.i] = { t: +f.t.toFixed(5), sheet, x, y, w, h, offset: f.offset };
  }
  files.unshift({ path: 'spritesheet.json', data: JSON.stringify(manifest, null, 1) });
  return { zip: writeZip(files), manifest, files };
}

export function download(bytes, filename, type = 'application/octet-stream') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([toBytes(bytes)], { type }));
  a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
