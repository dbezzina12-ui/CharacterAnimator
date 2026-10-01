// Hand view sets: deliberately authored palm / back-of-hand × open / relaxed / fist / grip appearances.
// A set swaps the palm and its five finger layers together (core: project.handViews + `handSets` tracks).
//
// Suggestion rule (documented, deterministic): the bake stores a per-clip source signal per hand —
// `palm` (+1 palm toward the camera … -1 back of the hand toward the camera; measured from the palm
// normal of the 3D hand) and `curl` (0 open … 1 fist) at 10 Hz. View: symmetric hysteresis around
// edge-on — switch to PALM only when palm > +threshold, to BACK only when palm < -threshold (default
// 0.30); in between the current view is kept. A clip starts in the setup art's view unless its first
// sample is decisively the other side, so near-edge-on hands keep the articulated setup art. Pose: open < 0.25 ≤ relaxed < 0.65 ≤ fist, with a
// ±0.05 band. Any set must hold for at least `minHold` seconds (default 4 frames at 30 fps); shorter
// runs merge into the previous set, so there is never a one-frame swap. Missing variants fall back to
// the same pose seen from the back (then open_back) and are reported, never silently invented.
import { Rig, affApply, affInv } from './core.js';

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
export const POSES = ['open', 'relaxed', 'fist'];

export function suggestHandSets(project, clip, side, { threshold = 0.3, open = 0.25, fist = 0.65, band = 0.05, minHold = 4 / 30 } = {}) {
  const sig = clip.source?.handSignal?.[side], sets = project.handViews?.[side]?.sets || {};
  if (!sig?.t?.length) return { keys: null, missing: [], reason: 'no source signal (native 2D clip or old bake)' };
  const fallbackView = project.handViews?.[side]?.setupView || 'back';
  let view = sig.palm[0] > threshold ? 'palm' : sig.palm[0] < -threshold ? 'back' : (fallbackView === 'side' ? 'back' : fallbackView), pose = 'open';
  const raw = [], missing = new Set();
  for (let i = 0; i < sig.t.length; i++) {
    const f = sig.palm[i], c = sig.curl[i];
    if (f > threshold) view = 'palm'; else if (f < -threshold) view = 'back';
    if (pose === 'open' && c > open + band) pose = c > fist + band ? 'fist' : 'relaxed';
    else if (pose === 'relaxed') { if (c < open - band) pose = 'open'; else if (c > fist + band) pose = 'fist'; }
    else if (pose === 'fist' && c < fist - band) pose = c < open - band ? 'open' : 'relaxed';
    let name = `${pose}_${view}`;
    if (!sets[name]) { missing.add(name); name = sets[`${pose}_${fallbackView}`] ? `${pose}_${fallbackView}` : `open_${fallbackView}`; }
    raw.push([sig.t[i], name]);
  }
  // looping clips must end on the set they start with (no pop at the seam): return to it at the last time
  // the signal is back inside the hysteresis band, if that leaves a long enough hold
  if (clip.loop && raw.length && raw[raw.length - 1][1] !== raw[0][1]) {
    let k = sig.t.length - 1; while (k > 0 && Math.abs(sig.palm[k]) < threshold && raw[k][1] !== raw[0][1]) k--;
    const at = k + 1 < sig.t.length ? k + 1 : null;
    if (at !== null && clip.duration - sig.t[at] >= minHold) for (let i = at; i < raw.length; i++) raw[i][1] = raw[0][1];
  }
  // minimum hold: a run shorter than minHold takes the previous run's set (the first run is never dropped);
  // repeat until every run holds long enough
  let runs = [];
  for (const [t, v] of raw) if (!runs.length || runs[runs.length - 1][1] !== v) runs.push([t, v]);
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 1; i < runs.length; i++) {
      const end = i + 1 < runs.length ? runs[i + 1][0] : clip.duration;
      if (end - runs[i][0] < minHold - 1e-9) { runs[i][1] = runs[i - 1][1]; changed = true; }
    }
    const m = []; for (const r of runs) if (!m.length || m[m.length - 1][1] !== r[1]) m.push(r); runs = m;
  }
  const merged = runs;
  return { keys: { t: merged.map(([t]) => +t.toFixed(4)), v: merged.map(([, v]) => v) }, missing: [...missing] };
}

/** Sets actually shown during a clip (from the evaluated pose) with their time ranges. */
export function setsUsed(rig, clip, side, fps = 30) {
  const out = []; let cur = null;
  for (let i = 0; i <= Math.round(clip.duration * fps); i++) {
    const t = Math.min(clip.duration, i / fps), hs = rig.evaluate(clip, t).handSets?.[side] || null;
    const att = rig.evaluate(clip, t).slotAttachment[rig.slotIndex.get(`hand_${side}`)];
    const key = `${hs || '(slot keys)'}|${att}`;
    if (!cur || cur.key !== key) { cur = { key, set: hs, palmAttachment: att, from: +t.toFixed(3), to: +t.toFixed(3) }; out.push(cur); } else cur.to = +t.toFixed(3);
  }
  return out.map(({ key, ...r }) => r);
}

/** Shortest hold of any shown hand appearance (seconds): < 2 frames means a flicker. */
export function minHoldSeconds(ranges, fps = 30) { return ranges.length < 2 ? Infinity : Math.min(...ranges.slice(1, -1).map((r) => r.to - r.from + 1 / fps), Infinity); }

/**
 * Wrist continuity: every palm attachment of every set must have art at the wrist joint (the hand bone
 * origin) so switching sets never opens a gap at the cuff. Measured as the distance from the wrist to the
 * nearest opaque pixel of the attachment (project px). Needs decoded alpha: alphaOf(imageId) -> {w,h,A}.
 */
export function wristContinuity(project, side, alphaOf, { limitPx = 6 } = {}) {
  const rig = new Rig(project), sets = project.handViews?.[side]?.sets || {}, out = [];
  const hb = `hand_${side}`, hi = rig.boneIndex.get(hb); if (hi === undefined) return out;
  const wrist = [rig.bindWorld[hi][4], rig.bindWorld[hi][5]];
  for (const [name, set] of Object.entries(sets)) {
    const id = set.slots?.[hb]; if (!id) continue;
    const a = project.attachments[id], rec = rig.attachments.get(id), al = alphaOf(a.image); if (!al || !rec) continue;
    // place the attachment as it is shown: rigid captures are registered to the hand bone frame
    const s = a.imageScale ?? 1, mir = a.transform?.mirror ? -1 : 1, p = affApply(affInv(rec.place), wrist[0], wrist[1]);
    const wx = p[0] / (s * mir) + a.pivot[0], wy = a.pivot[1] - p[1] / s;
    let best = Infinity;
    const R = Math.ceil(30 / s);
    for (let y = Math.max(0, Math.floor(wy - R)); y < Math.min(al.h, wy + R); y++) for (let x = Math.max(0, Math.floor(wx - R)); x < Math.min(al.w, wx + R); x++)
      if (al.A[y * al.w + x] > 64) best = Math.min(best, Math.hypot(x - wx, y - wy) * s);
    out.push({ set: name, attachment: id, wristGapPx: Number.isFinite(best) ? +best.toFixed(2) : null, ok: best <= limitPx });
  }
  return out;
}

/** Which hand-set appearances a skin still lacks (attachments not replaced by the skin). */
export function missingHandArt(project, skinId) {
  const sk = (project.skins || []).find((s) => s.id === skinId), out = [];
  for (const [side, hv] of Object.entries(project.handViews || {})) for (const [name, set] of Object.entries(hv.sets || {})) {
    const missing = Object.values(set.slots || {}).filter((a) => a && !(sk?.replace?.[a]));
    if (skinId !== 'default' && missing.length) out.push({ side, set: name, view: set.view, pose: set.pose, missing });
  }
  return out;
}
