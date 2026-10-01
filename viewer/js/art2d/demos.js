// Native 2D authoring demos for a starter project (pure 2D: no 3D involved). They exercise the hand
// controls, keyed hand-art swaps, keyed draw order, prop swaps, contact constraints and events the
// same way an animator would in the editor, and give the project named poses.
import { Rig, ensureLayer, wrapDeg } from './core.js';

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const native = (name, duration, loop, note) => ({ name, duration, loop, fps: 30, source: { type: 'native2d', note },
  meta: {}, tracks: ensureLayer({}), corrections: ensureLayer({}), status: { level: 'ok', notes: ['native 2D clip: authored in 2D, no 3D source'] } });

/** Offsets (local - setup) of every bone of `clip` at time t, as constant keys. */
function holdPose(rig, clip, t, into, skip = () => false) {
  rig.evaluate(clip, t, { corrections: false });
  rig.bones.forEach((b, i) => {
    if (skip(b.id)) return;
    const r = wrapDeg(rig.local[i * 5 + 2] - rig.setup[i * 5 + 2]), x = rig.local[i * 5] - rig.setup[i * 5], y = rig.local[i * 5 + 1] - rig.setup[i * 5 + 1];
    const sx = rig.local[i * 5 + 3] / rig.setup[i * 5 + 3], sy = rig.local[i * 5 + 4] / rig.setup[i * 5 + 4];
    const tr = {};
    if (Math.abs(r) > 0.01) tr.rotate = { t: [0], v: [+r.toFixed(3)] };
    if (Math.abs(x) > 0.01 || Math.abs(y) > 0.01) tr.translate = { t: [0], x: [+x.toFixed(3)], y: [+y.toFixed(3)] };
    if (Math.abs(sx - 1) > 1e-3 || Math.abs(sy - 1) > 1e-3) tr.scale = { t: [0], x: [+sx.toFixed(4)], y: [+sy.toFixed(4)] };
    if (Object.keys(tr).length) into.bones[b.id] = tr;
  });
}
const handKeys = (keys) => {                       // [[t, {curl, thumb, ...}], ...] -> columnar hand track
  const tr = { t: [] }; for (const f of ['curl', ...FINGERS]) tr[f] = [];
  for (const [t, v] of keys) { tr.t.push(t); for (const f of ['curl', ...FINGERS]) tr[f].push(v[f] ?? 0); }
  return tr;
};

export function addNativeDemos(project) {
  const rig = new Rig(project), has = (n) => project.clips.some((c) => c.name === n);
  const att = (id) => (project.attachments[id] ? id : null);

  // ---- finger tests: whole-hand and per-finger curls, then a keyed swap to captured fist art
  if (!has('finger_tests_2d')) {
    const c = native('finger_tests_2d', 7, true, 'hand controls: open palm, relaxed, per-finger wave, weapon grip, keyed swap to fist art and back');
    const seq = [[0, { curl: -0.15 }], [1, { curl: 0.3, index: -0.05, ring: 0.05, pinky: 0.1 }], [1.6, { curl: 0, index: 1 }], [2.0, { curl: 0, middle: 1 }],
      [2.4, { curl: 0, ring: 1 }], [2.8, { curl: 0, pinky: 1 }], [3.2, { curl: 0, thumb: 1 }], [3.8, { curl: 0.8, thumb: -0.2, index: -0.1, ring: 0.05, pinky: 0.1 }],
      [4.6, { curl: 1 }], [5.8, { curl: 1 }], [6.5, { curl: -0.15 }], [7, { curl: -0.15 }]];
    for (const s of ['L', 'R']) if (project.hands?.[s]) c.tracks.hands[s] = handKeys(seq);
    for (const s of ['L', 'R']) for (const g of ['hand', ...FINGERS]) {
      const slot = `${g}_${s}`; if (!project.slots.some((x) => x.id === slot)) continue;
      const fist = att(`${slot}.fist`), def = project.slots.find((x) => x.id === slot).attachment;
      if (fist) c.tracks.slots[slot] = { attachment: { t: [0, 4.9, 5.8], v: [def, fist, def] } };
    }
    // keyed layer order: the right hand's four fingers go behind the palm while it shows the back of the hand
    const setup = project.slots.map((s) => s.id), fingersR = ['index_R', 'middle_R', 'ring_R', 'pinky_R'].filter((x) => setup.includes(x));
    if (fingersR.length && setup.includes('hand_R')) {
      const behind = setup.filter((x) => !fingersR.includes(x)); behind.splice(behind.indexOf('hand_R'), 0, ...fingersR);
      c.tracks.drawOrder = { t: [2.0, 2.8], v: [behind, setup] };
    }
    c.tracks.events = [{ t: 0, name: 'open_palm' }, { t: 1, name: 'relaxed' }, { t: 1.6, name: 'finger_wave' }, { t: 3.8, name: 'weapon_grip' }, { t: 4.9, name: 'fist_art' }, { t: 6.5, name: 'open_palm' }];
    project.clips.push(c);
  }

  // ---- contact fixture: detonator held in the right hand, thumb pad driven onto the button marker
  if (!has('contact_detonator_2d') && project.attachments['prop_R.Detonator'] && has('press_detonator')) {
    const c = native('contact_detonator_2d', 3, true, 'thumb-to-button contact: arm pose held from press_detonator, thumb solved onto the Detonator "button" marker by constraint thumb_button_R');
    holdPose(rig, 'press_detonator', 0.9, c.tracks, (id) => /^thumb_0[23]_R$/.test(id));
    c.tracks.slots.prop_R = { attachment: { t: [0], v: ['prop_R.Detonator'] } };
    for (const g of ['hand', 'index', 'middle', 'ring', 'pinky']) { const a = att(`${g}_R.grip_detonator`); if (a) c.tracks.slots[`${g}_R`] = { attachment: { t: [0], v: [a] } }; }
    // the thumb presses the button on top of the remote: draw it in front of the prop so it stays visible
    const setup = project.slots.map((s) => s.id);
    if (setup.includes('thumb_R') && setup.includes('prop_R')) { const o = setup.filter((x) => x !== 'thumb_R'); o.splice(o.indexOf('prop_R') + 1, 0, 'thumb_R'); c.tracks.drawOrder = { t: [0], v: [o] }; }
    c.tracks.constraints.thumb_button_R = { t: [0, 0.9, 1.1, 1.9, 2.3, 3], v: [0, 0, 1, 1, 0, 0] };
    c.tracks.events = [{ t: 1.1, name: 'button_down' }, { t: 1.9, name: 'button_up' }];
    project.clips.push(c);
  }

  // ---- hover vigil: the left palm stays on the blade throughout the loop. The bridged clip already
  // projects the 3D contact exactly at joints; this correction-layer constraint pins the palm socket to
  // the recorded blade marker so later edits to the right hand cannot separate them.
  const sword = project.attachments['prop_R.Sword2H'];
  if (sword?.markers?.support_L_hover && has('hover_sword_vigil') && !project.constraints.some((c) => c.id === 'support_L_hover')) {
    const base = project.constraints.find((c) => c.id === 'support_L');
    project.constraints.push({ ...base, id: 'support_L_hover', order: 1, target: { slot: 'prop_R', bone: 'prop_R', marker: 'support_L_hover' },
      note: 'Hover vigil: left palm on the blade (marker recorded from the 3D hover pose). Driver: right hand + sword.' });
    const clip = project.clips.find((c) => c.name === 'hover_sword_vigil');
    ensureLayer(clip.corrections ||= {}).constraints.support_L_hover = { t: [0], v: [1] };
  }

  // ---- named poses (offsets from the setup pose)
  project.poses ||= [];
  const pose = (name, clip, t) => {
    if (!has(clip) || project.poses.some((p) => p.name === name)) return;
    const tmp = { bones: {} }; holdPose(new Rig(project), clip, t, tmp);
    const bones = {}; for (const [id, tr] of Object.entries(tmp.bones)) bones[id] = { rotate: tr.rotate?.v[0] ?? 0, x: tr.translate?.x[0] ?? 0, y: tr.translate?.y[0] ?? 0 };
    project.poses.push({ name, bones, from: `${clip} @ ${t}s` });
  };
  pose('vigil', 'hover_sword_vigil', 0); pose('guard', 'sword_2h_idle', 0); pose('salute', 'knight_salute', 1.8); pose('contrapposto', 'idle', 1);
  return project;
}
