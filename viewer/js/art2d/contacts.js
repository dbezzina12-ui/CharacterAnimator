// Fitting contact markers after a 3D bake (pure 2D). A prop drawn flat can only rotate and scale in
// 2D, while its projected 3D frame can also skew, so a marker measured in 3D prop space does not land
// exactly on the baked hand once the prop turns toward the camera. Here each constraint's marker is
// measured in the 2D prop frame from the baked pose itself, and the constraint is only engaged on clips
// where pinning the hand to that marker stays within `tolerancePx` of the baked (3D-faithful) contact.
import { Rig, affInv, affApply, affCompose } from './core.js';

/** Image-px position of a bone-local point for attachment `a` (inverse of Rig.markerLocal). */
function localToImage(a, q) {
  const T = a.transform || {}, s = a.imageScale ?? 1, mir = T.mirror ? -1 : 1;
  const u = affApply(affInv(affCompose(T.x || 0, T.y || 0, T.rotation || 0, T.scaleX ?? 1, T.scaleY ?? 1)), q[0], q[1]);
  return [u[0] / (s * mir) + (a.pivot?.[0] ?? 0), (a.pivot?.[1] ?? 0) - u[1] / s];
}

export function fitContactMarkers(project, { tolerancePx = 1.5, fps = 30, log = () => {} } = {}) {
  const report = [];
  for (const c of project.constraints || []) {
    if (!c.target?.marker || !c.target.slot) continue;
    const layerOf = (clip) => (clip.tracks?.constraints?.[c.id] ? 'tracks' : clip.corrections?.constraints?.[c.id] ? 'corrections' : null);
    const clips = project.clips.filter((k) => k.source?.type === 'bridge3d' && layerOf(k) && Math.max(...(k[layerOf(k)].constraints[c.id].v || [0])) > 0);
    if (!clips.length) continue;
    const rig = new Rig(project), ti = rig.boneIndex.get(c.target.bone), si = rig.slotIndex.get(c.target.slot);
    // per clip: baked effector positions in the target bone frame, per attachment shown in the slot
    const samples = clips.map((clip) => {
      const pts = [];
      for (let t = 0; t <= clip.duration + 1e-9; t += 1 / fps) {
        const pose = rig.evaluate(clip, t, { constraints: { [c.id]: 0 } });
        const att = pose.slotAttachment[si]; if (!att) continue;
        const e = rig.worldPoint(c.effector || c.end), q = affApply(affInv(rig.world[ti]), e[0], e[1]);
        pts.push({ t, att, img: localToImage(project.attachments[att], q), world: e });
      }
      return { clip, pts };
    });
    // one marker per attachment: the mean over the most stable clip that shows it
    const byAtt = new Map();
    for (const s of samples) for (const p of s.pts) { const l = byAtt.get(p.att) || new Map(); (l.get(s) || l.set(s, []).get(s)).push(p.img); byAtt.set(p.att, l); }
    for (const [att, per] of byAtt) {
      let best = null;
      for (const [s, imgs] of per) {
        const m = imgs.reduce((a, p) => [a[0] + p[0] / imgs.length, a[1] + p[1] / imgs.length], [0, 0]);
        const spread = Math.max(...imgs.map((p) => Math.hypot(p[0] - m[0], p[1] - m[1])));
        if (!best || spread < best.spread) best = { m, spread, clip: s.clip.name };
      }
      const a = project.attachments[att]; a.markers ||= {};
      a.markers[c.target.marker] = best.m.map((x) => +x.toFixed(2));
      log(`${c.id}: ${att} marker "${c.target.marker}" fitted from ${best.clip}`);
    }
    // engage the constraint only where pinning stays faithful to the baked contact
    const rig2 = new Rig(project);
    for (const s of samples) {
      let err = 0;
      for (const p of s.pts) { rig2.evaluate(s.clip, p.t, { constraints: { [c.id]: 0 } }); const m = rig2.markerWorld(p.att, c.target.marker); err = Math.max(err, Math.hypot(m[0] - p.world[0], m[1] - p.world[1])); }
      const layer = s.clip[layerOf(s.clip)], ok = err <= tolerancePx;
      if (!ok) {
        layer.constraints[c.id] = { t: [0], v: [0] };
        s.clip.status ||= { level: 'ok', notes: [] };
        s.clip.status.notes.push(`${c.id} contact follows the 3D bake (constraint off: the prop turns toward the camera, so a flat marker would move the hand up to ${err.toFixed(1)} px)`);
        if (s.clip.status.level === 'ok') s.clip.status.level = 'attention';
      }
      report.push({ constraint: c.id, clip: s.clip.name, maxMarkerErrorPx: +err.toFixed(2), engaged: ok });
    }
  }
  return report;
}
