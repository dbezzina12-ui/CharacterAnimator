// Visual QA: heuristics that catch bad-looking animation, contact sheets that cover a whole clip, and
// per-clip review status kept SEPARATE from mathematical validity and missing-art status.
//
// Flags (each carries clip, time, target bone/slot/attachment, measured value, threshold, message):
//   foldover      weighted mesh area that turns inside-out (fraction of the attachment's area)
//   foreshorten   a bone squashed below 45 % while it still shows its setup (front-view) art
//   order         an overlapping pair that swaps depth and swaps back within 3 frames, or one key that swaps
//                 more than 6 overlapping pairs at once
//   contact       engaged constraint error above 2 px, or unreachable target
//   joint-gap     coverage of a 10 px disk centred on a joint below 92 % of its setup coverage (a hole at the joint)
//   hand-flicker  a hand appearance shown for a single frame
// Consecutive frames are collapsed into one ranged flag (from/to, frames, worst value). Findings in places
// that are not visible by construction (hidden underlap layers) carry `info` and are reported, not counted.
// Flags are heuristics, not verdicts: intentional overlaps and poses can be marked as exceptions with a
// reason (project.visualQA.exceptions); the review status is a human decision (project.visualQA.review).
import { Rig, keyIndex, affApply } from './core.js';
import { offscreenRenderer, renderPose } from './exporters.js';

export const THRESHOLDS = { foldoverPct: 2, foreshorten: 0.45, orderMinFrames: 3, orderMaxMoves: 6, contactPx: 2, jointCoverage: 0.92 };
const JOINTS = ['neck', 'upperarm_L', 'upperarm_R', 'forearm_L', 'forearm_R', 'hand_L', 'hand_R', 'thigh_L', 'thigh_R', 'shin_L', 'shin_R'];

function sampleTimes(clip, fps) { const n = Math.max(1, Math.round(clip.duration * fps)); return Array.from({ length: n + 1 }, (_, i) => +Math.min(clip.duration, i / fps).toFixed(4)); }

/** Region-aware fold-over: fraction of the attachment's bind area whose triangles flipped. */
function foldovers(rig, pose) {
  const out = [];
  for (const d of rig.drawList(pose)) {
    const a = rig.project.attachments[d.attachment]; if (!a.weights) continue;
    const r = rig.attachments.get(d.attachment), p = rig.skinAttachment(d.attachment, pose), b = r.bind, T = a.triangles;
    let area = 0, flipped = 0;
    for (let i = 0; i < T.length; i += 3) {
      const [u, v, w] = [T[i] * 2, T[i + 1] * 2, T[i + 2] * 2];
      const s0 = (b[v] - b[u]) * (b[w + 1] - b[u + 1]) - (b[v + 1] - b[u + 1]) * (b[w] - b[u]);
      const s1 = (p[v] - p[u]) * (p[w + 1] - p[u + 1]) - (p[v + 1] - p[u + 1]) * (p[w] - p[u]);
      area += Math.abs(s0); if (Math.abs(s0) > 1e-6 && Math.sign(s0) !== Math.sign(s1)) flipped += Math.abs(s0);
    }
    if (area > 0) out.push({ slot: d.slot, attachment: d.attachment, pct: 100 * flipped / area });
  }
  return out;
}

/**
 * Analyse one clip. `render` (optional): {renderer} for the render-based joint-gap check (browser only).
 * Returns {clip, flags, stats}.
 */
export async function analyzeClip(project, clipName, { fps = 30, skin = 'default', thresholds = THRESHOLDS, renderer = null, jointFps = 10 } = {}) {
  const rig = new Rig(project); rig.setSkin(skin);
  const clip = rig.clips.get(clipName), flags = [], th = { ...THRESHOLDS, ...thresholds };
  if (!clip) throw new Error(`unknown clip ${clipName}`);
  const times = sampleTimes(clip, fps), worst = new Map();
  const add = (f) => { const k = `${f.kind}|${f.target}`; const w = worst.get(k); if (!w || f.severity > w.severity) worst.set(k, f); flags.push(f); };
  let prevHand = {}, handRuns = { L: [], R: [] };
  for (const t of times) {
    const pose = rig.evaluate(clip, t);
    for (const f of foldovers(rig, pose)) if (f.pct > th.foldoverPct) {
      // hidden underlap layers sit beneath the armour piece they back; a fold there is reported, not flagged
      const hidden = /^under_/.test(f.slot);
      add({ kind: 'foldover', t, target: f.attachment, value: +f.pct.toFixed(2), threshold: th.foldoverPct, unit: '% of area', severity: f.pct / th.foldoverPct, ...(hidden ? { info: 'hidden underlap layer (drawn beneath the armour piece it backs)' } : {}), message: `${f.attachment}: ${f.pct.toFixed(1)}% of the mesh folds over` });
    }
    // squashed bones that still show front-view setup art (pose-specific captures are drawn for the pose)
    for (const s of rig.slots) {
      const att = pose.slotAttachment[rig.slotIndex.get(s.id)]; if (!att) continue;
      const a = project.attachments[att]; if (!a || a.weights || isPoseSpecific(project, att)) continue;
      const bi = rig.boneIndex.get(a.bone), sx = rig.local[bi * 5 + 3];
      if (sx < th.foreshorten) add({ kind: 'foreshorten', t, target: `${s.id} (${a.bone})`, value: +sx.toFixed(3), threshold: th.foreshorten, unit: 'scale', severity: th.foreshorten / Math.max(0.05, sx), message: `${a.bone} squashed to ${(sx * 100).toFixed(0)}% while ${att} shows setup-view art` });
    }
    for (const c of pose.contacts) if (c.mix >= 0.999 && (c.error > th.contactPx || !c.reachable)) add({ kind: 'contact', t, target: c.id, value: +c.error.toFixed(3), threshold: th.contactPx, unit: 'px', severity: c.reachable ? c.error / th.contactPx : 10, message: c.reachable ? `${c.id} misses its target by ${c.error.toFixed(2)} px` : `${c.id} target unreachable (reach ${c.reach?.toFixed(1)} < ${c.distance?.toFixed(1)} px)` });
    for (const side of ['L', 'R']) {
      const a = pose.slotAttachment[rig.slotIndex.get(`hand_${side}`)], runs = handRuns[side];
      if (!runs.length || runs[runs.length - 1].att !== a) runs.push({ att: a, from: t, n: 1 }); else runs[runs.length - 1].n++;
    }
  }
  for (const side of ['L', 'R']) handRuns[side].slice(1, -1).forEach((r) => { if (r.n < 2) add({ kind: 'hand-flicker', t: r.from, target: `hand_${side}`, value: r.n, threshold: 2, unit: 'frames', severity: 3, message: `hand_${side} shows ${r.att} for a single frame` }); });
  // draw order: only swaps between pieces that overlap on screen are visible. Flag a visible pair that swaps
  // back within orderMinFrames (flip-flop pop) and a single key that swaps more than orderMaxMoves visible
  // pairs at once. The first key against the setup order is info (it applies as the clip starts).
  const ord = clip.tracks?.drawOrder, T = ord?.t || [], lastSwap = new Map();
  for (let i = 0; i < T.length; i++) {
    const prev = i ? ord.v[i - 1] : rig.setupOrder, cur = ord.v[i], pose = rig.evaluate(clip, T[i]);
    const vis = visibleSwaps(rig, pose, prev, cur);
    if (vis.length > th.orderMaxMoves) add({ kind: 'order', t: T[i], target: 'draw order', value: vis.length, threshold: th.orderMaxMoves, unit: 'overlapping pairs swap', severity: vis.length / th.orderMaxMoves,
      ...(i === 0 ? { info: 'clip start: its depth order replaces the setup order as the clip begins' } : {}), message: `${vis.length} overlapping pairs change depth at once (${vis.slice(0, 4).join(', ')}…)` });
    for (const pr of vis) {
      const last = lastSwap.get(pr);
      if (i && last !== undefined && (T[i] - last) * fps < th.orderMinFrames - 1e-6) add({ kind: 'order', t: T[i], target: pr, value: +((T[i] - last) * fps).toFixed(1), threshold: th.orderMinFrames, unit: 'frames between swaps', severity: 1.5, message: `${pr} swap depth and swap back after ${((T[i] - last) * fps).toFixed(1)} frames` });
      lastSwap.set(pr, T[i]);
    }
  }
  // joint gaps (render-based; browser only)
  if (renderer) {
    const jt = sampleTimes(clip, jointFps), setupPose = rig.evaluate(null, 0), base = {};
    for (const B of JOINTS) {
      const bi = rig.boneIndex.get(B); if (bi === undefined) continue;
      const parent = project.bones.find((b) => b.id === B).parent, set = new Set([B, parent]);
      const only = new Set(rig.slots.filter((s) => { const a = project.attachments[s.attachment]; return a && (set.has(a.bone) || (a.weights && a.weights.some((l) => l.some((x, j) => j % 2 === 0 && set.has(x))))); }).map((s) => s.id));
      if (only.size < 2) continue;
      base[B] = { only, cov: coverageAt(renderer, rig, setupPose, B, only) };
    }
    for (const t of jt) {
      const pose = rig.evaluate(clip, t);
      for (const [B, info] of Object.entries(base)) {
        if (!(info.cov > 0)) continue;
        const c = coverageAt(renderer, rig, pose, B, info.only) / info.cov;
        if (c < th.jointCoverage) add({ kind: 'joint-gap', t, target: B, value: +c.toFixed(3), threshold: th.jointCoverage, unit: 'coverage vs setup', severity: (1 - c) / (1 - th.jointCoverage), message: `coverage around the ${B} joint drops to ${(c * 100).toFixed(0)}% of its setup coverage` });
      }
    }
  }
  const exc = project.visualQA?.exceptions || [];
  for (const f of flags) {
    const e = exc.find((x) => x.clip === clipName && x.kind === f.kind && (x.target === f.target || x.target === '*') && f.t >= (x.from ?? 0) - 1e-6 && f.t <= (x.to ?? Infinity) + 1e-6);
    if (e) f.exception = { reason: e.reason, author: e.author || null };
  }
  const ranged = collapse(flags, Math.max(1 / fps, 1 / jointFps) * 1.5);
  const open = ranged.filter((f) => !f.exception && !f.info);
  const wv = [...worst.values()].filter((f) => !f.info);
  return { clip: clipName, skin, fps, thresholds: th, flags: ranged, frameFlags: flags.length, summary: summarize(open), info: summarize(ranged.filter((f) => f.info && !f.exception)),
    worst: wv.sort((a, b) => b.severity - a.severity).slice(0, 12) };
}

/** Joint-region coverage: fraction of a disk at the joint covered by the joint's pieces. */
function coverageAt(r, rig, pose, B, only) {
  const W = rig.world[rig.boneIndex.get(B)], J = [W[4], W[5]], R = 10, scale = 1;
  const img = renderPose(r, rig, pose, [J[0] - R, J[1] - R, J[0] + R, J[1] + R], scale, { only });
  let n = 0, c = 0; const N = img.width, M = img.height;
  for (let y = 0; y < M; y++) for (let x = 0; x < N; x++) { const dx = x - N / 2, dy = y - M / 2; if (dx * dx + dy * dy > (N / 2) * (N / 2)) continue; n++; if (img.data[(y * N + x) * 4 + 3] > 40) c++; }
  return n ? c / n : 0;
}

/** Art drawn for a particular pose (3D capture at clip@time, or a painted replacement of one). */
export function isPoseSpecific(project, attId) {
  const a = project.attachments[attId]; if (!a) return false;
  if (/ @ /.test(a.source?.pose || '')) return true;
  const base = attId.includes('@') ? attId.slice(0, attId.indexOf('@')) : null;
  return !!(base && project.attachments[base] && / @ /.test(project.attachments[base].source?.pose || ''));
}

/** PNG contact sheet of a clip at `times` ([[t, why], ...]) with labels; flags marked in red. */
export async function contactSheet(project, store, clipName, times, { skin = 'default', cell = 220, cols = 6, scale = null, renderer = null } = {}) {
  const rig = new Rig(project); rig.setSkin(skin);
  const r = renderer || await offscreenRenderer(project, store), clip = rig.clips.get(clipName);
  let U = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [t] of times) { const pose = rig.evaluate(clip, t); for (const d of rig.drawList(pose)) { const p = rig.skinAttachment(d.attachment, pose); for (let i = 0; i < p.length; i += 2) U = [Math.min(U[0], p[i]), Math.min(U[1], p[i + 1]), Math.max(U[2], p[i]), Math.max(U[3], p[i + 1])]; } }
  U = [U[0] - 20, U[1] - 20, U[2] + 20, U[3] + 20];
  const cellH = Math.round(cell * (U[3] - U[1]) / (U[2] - U[0])), sc = scale || cell / (U[2] - U[0]), rows = Math.ceil(times.length / cols);
  const c = document.createElement('canvas'); c.width = cols * cell; c.height = rows * (cellH + 30); const g = c.getContext('2d');
  g.fillStyle = '#1b1f27'; g.fillRect(0, 0, c.width, c.height); g.font = '11px sans-serif';
  times.forEach(([t, why], i) => {
    const x = (i % cols) * cell, y = Math.floor(i / cols) * (cellH + 30);
    const img = renderPose(r, rig, rig.evaluate(clip, t), U, sc);
    const tmp = document.createElement('canvas'); tmp.width = img.width; tmp.height = img.height; tmp.getContext('2d').putImageData(img, 0, 0);
    g.drawImage(tmp, x, y + 30, cell, cellH);
    g.fillStyle = /⚠/.test(why) ? '#ff7b6b' : '#cfd6e2'; g.fillText(`${t.toFixed(2)}s`, x + 4, y + 13); g.fillText(why.slice(0, 40), x + 4, y + 26);
    g.strokeStyle = '#333a46'; g.strokeRect(x + 0.5, y + 0.5, cell - 1, cellH + 29);
  });
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Pairs of slots whose relative depth differs between two orders AND whose posed art overlaps (bbox). */
export function visibleSwaps(rig, pose, prev, cur) {
  const box = new Map();
  for (const d of rig.drawList(pose)) { const p = rig.skinAttachment(d.attachment, pose); let b = [Infinity, Infinity, -Infinity, -Infinity]; for (let k = 0; k < p.length; k += 2) b = [Math.min(b[0], p[k]), Math.min(b[1], p[k + 1]), Math.max(b[2], p[k]), Math.max(b[3], p[k + 1])]; box.set(d.slot, b); }
  const ip = new Map(prev.map((id, k) => [id, k])), ids = cur.filter((id) => ip.has(id) && box.has(id)), out = [];
  for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
    if (ip.get(ids[a]) < ip.get(ids[b])) continue;
    const A = box.get(ids[a]), B = box.get(ids[b]), inset = 2;
    if (A[0] + inset < B[2] && B[0] + inset < A[2] && A[1] + inset < B[3] && B[1] + inset < A[3]) out.push([ids[a], ids[b]].sort().join(' / '));
  }
  return out;
}

/** Slots that must move to turn one draw order into another: n minus the longest common subsequence. */
export function slotsMoved(prev, cur) {
  const a = prev.filter((id) => cur.includes(id)), b = cur.filter((id) => prev.includes(id)), n = a.length;
  let row = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) { const next = new Array(n + 1).fill(0); for (let j = 1; j <= n; j++) next[j] = a[i - 1] === b[j - 1] ? row[j - 1] + 1 : Math.max(row[j], next[j - 1]); row = next; }
  return n - row[n];
}

/** Consecutive frames of the same kind/target/exception/info become one ranged flag (worst value kept). */
function collapse(flags, gap) {
  const groups = new Map(), out = [];
  for (const f of flags) { const k = `${f.kind}|${f.target}|${f.exception?.reason || ''}|${f.info || ''}`; (groups.get(k) || groups.set(k, []).get(k)).push(f); }
  for (const list of groups.values()) {
    list.sort((a, b) => a.t - b.t);
    let cur = null;
    for (const f of list) {
      if (cur && f.t - cur.to <= gap + 1e-9) { cur.to = f.t; cur.frames++; if (f.severity > cur.severity) Object.assign(cur, { t: f.t, value: f.value, severity: f.severity, message: f.message }); }
      else { cur = { ...f, from: f.t, to: f.t, frames: 1 }; out.push(cur); }
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

function summarize(flags) { const s = {}; for (const f of flags) s[f.kind] = (s[f.kind] || 0) + 1; return s; }

/** Times worth seeing in a contact sheet: start, end, even steps, every flag, every key change. */
export function sheetTimes(project, clipName, analysis, { steps = 10, max = 30 } = {}) {
  const c = project.clips.find((x) => x.name === clipName), set = new Map();
  const put = (t, why) => { const k = +t.toFixed(3); const e = set.get(k); set.set(k, e ? `${e}, ${why}` : why); };
  put(0, 'start'); put(c.duration, 'end');
  for (let i = 1; i < steps; i++) put(c.duration * i / steps, 'step');
  for (const L of [c.tracks, c.corrections]) {
    for (const ev of L?.events || []) put(ev.t, `event ${ev.name}`);
    for (const tr of Object.values(L?.constraints || {})) for (const t of tr.t || []) put(t, 'contact key');
    for (const tr of Object.values(L?.handSets || {})) for (const t of tr.t || []) put(t, 'hand set');
  }
  for (const f of (analysis?.worst || [])) put(f.t, `⚠ ${f.kind} ${f.target}`);
  return [...set.entries()].sort((a, b) => a[0] - b[0]).slice(0, max);
}

/** Per-clip status record: mathematical validity, missing art and visual review are separate fields. */
export function clipStatus(project, clipName, analysis, { mathOk = true, skin = 'default' } = {}) {
  const c = project.clips.find((x) => x.name === clipName), rev = project.visualQA?.review?.[clipName];
  const open = analysis ? analysis.flags.filter((f) => !f.exception && !f.info) : [];
  return { clip: clipName, math: mathOk ? 'valid' : 'invalid', missingArt: c?.status?.level === 'needs-art' ? 'needs-art' : 'complete-for-view',
    bridge: c?.status?.level || 'native', autoFlags: open.length, excepted: analysis ? analysis.flags.filter((f) => f.exception).length : 0,
    info: analysis ? analysis.flags.filter((f) => f.info && !f.exception).length : 0,
    visualReview: rev?.status || 'unreviewed', reviewNote: rev?.note || '', reviewer: rev?.reviewer || null };
}

/**
 * Does the ARTWORK touch at each contact (not only the markers)? For every engaged constraint and for the
 * right-hand grip on the prop, sample frames and check that hand art and prop art are both present within
 * `radius` px of the contact point. Returns per contact the fraction of frames where both are present.
 */
export async function contactArt(project, store, clipName, { skin = 'default', fps = 10, radius = 7, renderer = null } = {}) {
  const rig = new Rig(project); rig.setSkin(skin);
  const r = renderer || await offscreenRenderer(project, store), clip = rig.clips.get(clipName), out = new Map();
  const hand = (side) => new Set(['hand', 'thumb', 'index', 'middle', 'ring', 'pinky'].map((g) => `${g}_${side}`));
  const near = (pose, only, P) => {
    const img = renderPose(r, rig, pose, [P[0] - radius, P[1] - radius, P[0] + radius, P[1] + radius], 2, { only });
    const N = img.width; let hit = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const dx = x - N / 2, dy = y - N / 2; if (dx * dx + dy * dy <= N * N / 4 && img.data[(y * N + x) * 4 + 3] > 60) hit++; }
    return hit > 3;
  };
  for (let t = 0; t <= clip.duration + 1e-9; t += 1 / fps) {
    const pose = rig.evaluate(clip, t);
    const pairs = [];
    for (const c of project.constraints || []) {
      const k = pose.contacts.find((x) => x.id === c.id); if (!(k?.mix >= 0.999)) continue;
      const side = /_L$/.test(c.end) || /_L$/.test(c.effector || '') ? 'L' : 'R';
      const handSlots = c.id.startsWith('thumb') ? new Set([`thumb_${side}`]) : hand(side);
      pairs.push({ id: c.id, P: rig.worldPoint(c.effector || c.end), hand: handSlots, prop: new Set([c.target.slot]) });
    }
    // the right hand holds the prop at its socket (the palm grip point), not at the prop's image pivot
    const propAtt = pose.slotAttachment[rig.slotIndex.get('prop_R')];
    if (propAtt && rig.boneIndex.has('socket_hand_R_prop')) pairs.push({ id: 'grip_R (palm socket)', P: rig.worldPoint('socket_hand_R_prop'), hand: hand('R'), prop: new Set(['prop_R']) });
    for (const pr of pairs) {
      const e = out.get(pr.id) || { contact: pr.id, frames: 0, handOk: 0, propOk: 0, bothOk: 0, firstMiss: null };
      const h = near(pose, pr.hand, pr.P), p = near(pose, pr.prop, pr.P);
      e.frames++; if (h) e.handOk++; if (p) e.propOk++; if (h && p) e.bothOk++; else if (e.firstMiss === null) e.firstMiss = +t.toFixed(2);
      out.set(pr.id, e);
    }
  }
  return [...out.values()].map((e) => ({ ...e, bothPct: +(100 * e.bothOk / e.frames).toFixed(1) }));
}
