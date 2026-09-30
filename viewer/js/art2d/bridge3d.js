// 3D clip bridge: evaluates the ORIGINAL 3D skeleton (bones, helpers, sockets, props) unchanged and
// projects it through a saved, fixed orthographic art camera into the 2D character plane.
//
//  * joint/socket positions: exact orthographic projection (linear, so contacts stay contacts)
//  * 2D bone angle: projected direction of the bone's primary axis (its +Y, the bone direction).
//    When that axis points at the camera (projected length < 35 % of its true length) the angle blends
//    to a fallback axis with a bind-time offset, so short segments never spin or divide by zero.
//  * foreshortening: optional per-bone scaleX = projected/bind projected length, clamped (policy stored
//    on the bone as source3d.foreshorten). Source 3D bone lengths are never modified.
//  * everything is baked at a declared rate into offset tracks relative to the 2D setup pose, then
//    reduced with a stated tolerance; evaluation of the baked tracks is deterministic.
import * as THREE from 'three';
import { affCompose, affInv, affApply, wrapDeg } from './core.js';

const R2D = 180 / Math.PI;
const V3 = (a) => new THREE.Vector3(...a);

export class ArtCamera {
  constructor(o) {
    this.id = o.id || 'front34';
    this.position = V3(o.position); this.target = V3(o.target); this.up = V3(o.up || [0, 1, 0]);
    this.origin = V3(o.origin || [0, 0, 0]);
    this.ppm = o.pixelsPerMeter;
    this.f = this.target.clone().sub(this.position).normalize();
    this.r = this.f.clone().cross(this.up).normalize();
    this.u = this.r.clone().cross(this.f).normalize();
  }
  project(v) { const d = v.clone().sub(this.origin); return [d.dot(this.r) * this.ppm, d.dot(this.u) * this.ppm]; }
  depth(v) { return v.clone().sub(this.origin).dot(this.f); }
  dir(d) { return [d.dot(this.r) * this.ppm, d.dot(this.u) * this.ppm]; }
  /** Orthographic camera framing the project-pixel rectangle [x0,x1] x [y0,y1]. */
  threeCamera(x0, y0, x1, y1) {
    const cam = new THREE.OrthographicCamera(x0 / this.ppm, x1 / this.ppm, y1 / this.ppm, y0 / this.ppm, 0.01, 60);
    cam.position.copy(this.origin).addScaledVector(this.f, -25);
    cam.up.copy(this.u); cam.lookAt(this.origin); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
    return cam;
  }
  toJSON() {
    return { id: this.id, projection: 'orthographic', position: this.position.toArray(), target: this.target.toArray(),
      up: this.up.toArray(), origin: this.origin.toArray(), pixelsPerMeter: this.ppm,
      axes: { right: this.r.toArray().map((x) => +x.toFixed(6)), up: this.u.toArray().map((x) => +x.toFixed(6)), forward: this.f.toArray().map((x) => +x.toFixed(6)) } };
  }
}

/** World direction of a local axis ('+y', '-x', ...) or a local vector [x, y, z] of matrix m. */
export function axisOf(m, a) {
  const e = m.elements;
  if (Array.isArray(a)) {
    return new THREE.Vector3(e[0] * a[0] + e[4] * a[1] + e[8] * a[2], e[1] * a[0] + e[5] * a[1] + e[9] * a[2],
      e[2] * a[0] + e[6] * a[1] + e[10] * a[2]).normalize();
  }
  const i = { x: 0, y: 4, z: 8 }[a[a.length - 1]], s = a[0] === '-' ? -1 : 1;
  return new THREE.Vector3(e[i] * s, e[i + 1] * s, e[i + 2] * s).normalize();
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function lerpAngle(a, b, w) { return a + wrapDeg(b - a) * w; }

/**
 * The bridge between a loaded 3D Character (viewer/js/character.js) and a 2D rig.
 * viewer: window.viewer of the playground (THREE, state.ch, state.cfg, playClip, state.clipProp).
 */
export class Bridge {
  constructor(viewer, cam, { props = {} } = {}) {
    this.v = viewer; this.cam = cam; this.props = props;
  }

  get ch() { return this.v.state.ch; }

  /** 2D bone definitions (parents first) for every 3D joint, socket and the right-hand prop root. */
  defineBones() {
    const ch = this.ch, cfg = this.v.state.cfg;
    ch.resetPose(); this._clearProp(); ch.root.updateMatrixWorld(true);
    const len3 = new Map((cfg.skeleton?.bones || []).map((b) => [b.name, b.length]));
    const list = [];
    const add = (id, obj, parent, kind, length) => list.push({ id, obj, parent, kind, length3d: length });
    const walk = (o, parentId) => {
      for (const c of o.children) {
        if (c.isBone) {
          const kind = /_helper_|forearm_twist/.test(c.name) ? 'helper' : 'bone';
          add(c.name, c, parentId, kind, len3.get(c.name) ?? 0.05);
          walk(c, c.name);
        } else if (c.name?.startsWith('socket_')) {
          add(c.name, c, parentId, 'socket', 0.06);
        }
      }
    };
    const rootBone = Object.values(ch.bones).find((b) => !b.parent?.isBone);
    add(rootBone.name, rootBone, null, 'bone', len3.get(rootBone.name) ?? 0.2);
    walk(rootBone, rootBone.name);
    list.push({ id: 'prop_R', obj: null, parent: 'socket_hand_R_prop', kind: 'prop', length3d: 0.25 });
    const defs = [];
    for (const d of list) {
      const m = d.obj ? d.obj.matrixWorld : ch.sockets.socket_hand_R_prop.matrixWorld;
      if (d.kind === 'prop') { defs.push({ ...d, axis1: '+y', axis2: '+x', offset: 0, r1bind: 1, foreshorten: { min: 0.25, max: 1, minY: 0.5 } }); continue; }
      const r = {};
      for (const a of ['y', 'x', 'z']) { const p = this.cam.dir(axisOf(m, a)); r[a] = Math.hypot(p[0], p[1]) / this.cam.ppm; }
      let axis1 = 'y';
      if (r.y < 0.5) axis1 = r.x >= r.z ? 'x' : 'z';
      const rest = ['y', 'x', 'z'].filter((a) => a !== axis1).sort((a, b) => r[b] - r[a]);
      const axis2 = rest[0];
      const p1 = this.cam.dir(axisOf(m, axis1)), p2 = this.cam.dir(axisOf(m, axis2));
      const offset = wrapDeg(Math.atan2(p1[1], p1[0]) * R2D - Math.atan2(p2[1], p2[0]) * R2D);
      const limb = /^(upperarm|forearm|thigh|shin|hand|foot|clavicle)_[LR]$/.test(d.id);
      defs.push({ ...d, axis1: '+' + axis1, axis2: '+' + axis2, offset, r1bind: r[axis1],
        foreshorten: limb && axis1 === 'y' && r.y >= 0.5 ? { min: 0.4, max: 1.15 } : null });
    }
    this.defs = defs;
    this.index = new Map(defs.map((d, i) => [d.id, i]));
    return defs;
  }

  _clearProp() { if (this.v.state.clipProp) { this.v.state.clipProp.removeFromParent(); this.v.state.clipProp = null; } }

  /** Prop root world matrix: the attached clip prop, else the right-hand socket (identity prop transform). */
  propMatrix() {
    const p = this.v.state.clipProp;
    if (p) { p.updateMatrixWorld(true); return p.matrixWorld; }
    return this.ch.sockets.socket_hand_R_prop.matrixWorld;
  }

  /** 2D world transforms of every defined bone for the CURRENT 3D pose. */
  sampleWorld(propAxes = null) {
    const cam = this.cam, out = new Array(this.defs.length);
    const hv = new THREE.Vector3();
    this.defs.forEach((d, i) => {
      const m = d.kind === 'prop' ? this.propMatrix() : d.obj.matrixWorld;
      hv.setFromMatrixPosition(m);
      const pos = cam.project(hv);
      let a1 = d.axis1, a2 = d.axis2;
      if (d.kind === 'prop' && propAxes) { a1 = propAxes.x; a2 = propAxes.y; }
      const p1 = cam.dir(axisOf(m, a1)), r1 = Math.hypot(p1[0], p1[1]) / cam.ppm;
      let rot = Math.atan2(p1[1], p1[0]) * R2D, sx = 1, sy = 1;
      if (d.kind === 'prop') {
        const p2 = cam.dir(axisOf(m, a2)), r2 = Math.hypot(p2[0], p2[1]) / cam.ppm;
        const flip = p1[0] * p2[1] - p1[1] * p2[0] < 0 ? -1 : 1;
        sx = Math.min(1, Math.max(0.25, r1));
        sy = flip * Math.min(1, Math.max(0.5, r2));          // round grips never flatten below half
        if (r1 < 0.2) {                                       // blade/barrel at the camera: keep a stable angle
          const q = cam.dir(axisOf(m, a2)); rot = Math.atan2(q[1], q[0]) * R2D - 90 * flip;
        }
      } else {
        if (r1 < 0.35) {
          const p2 = cam.dir(axisOf(m, a2));
          rot = lerpAngle(Math.atan2(p2[1], p2[0]) * R2D + d.offset, rot, smooth(0.2, 0.35, r1));
        }
        if (d.foreshorten) sx = Math.min(d.foreshorten.max, Math.max(d.foreshorten.min, r1 / d.r1bind));
      }
      out[i] = { pos, rot, sx, sy, r1 };
    });
    return out;
  }

  /** World samples -> local transforms (same composition as core.Rig.updateWorld). */
  toLocal(samples) {
    const W = new Array(this.defs.length), rotW = new Float64Array(this.defs.length), local = new Array(this.defs.length);
    this.defs.forEach((d, i) => {
      const s = samples[i];
      W[i] = affCompose(s.pos[0], s.pos[1], s.rot, s.sx, s.sy); rotW[i] = s.rot;
      if (!d.parent) { local[i] = { x: s.pos[0], y: s.pos[1], rotation: s.rot, scaleX: s.sx, scaleY: s.sy }; return; }
      const p = this.index.get(d.parent);
      const lp = affApply(affInv(W[p]), s.pos[0], s.pos[1]);
      local[i] = { x: lp[0], y: lp[1], rotation: wrapDeg(s.rot - rotW[p]), scaleX: s.sx, scaleY: s.sy };
    });
    return local;
  }

  /** Setup (bind) pose of the 2D rig = projected 3D rest pose. */
  bindLocal(propAxes) {
    this.ch.resetPose(); this._clearProp(); this.ch.root.updateMatrixWorld(true);
    const s = this.sampleWorld(propAxes);
    this.bindSamples = s;
    return this.toLocal(s);
  }

  /** Put the 3D character at clip time t (prop attached like the playground). */
  pose3D(clip, t) {
    const v = this.v;
    const a = v.state.clipAction, meta = v.state.cfg?.animations?.find((m) => m.name === clip);
    if (!a || a.getClip().name !== clip || !a.isScheduled() || (meta?.prop && !v.state.clipProp)) v.playClip(clip, t, false);
    v.state.clipAction.paused = true; v.state.clipAction.time = t;
    v.state.ch.mixer.update(0);
    v.state.ch.root.updateMatrixWorld(true);
  }
}

// ------------------------------------------------------------------ key reduction ---
/** Ramer–Douglas–Peucker on (t, channels...): keeps keys whose removal would err more than tol. */
export function reduceKeys(times, chans, tol) {
  const n = times.length;
  if (n <= 2) return times.map((_, i) => i);
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1, wi = -1;
    for (let i = a + 1; i < b; i++) {
      const u = (times[i] - times[a]) / (times[b] - times[a]);
      let e = 0;
      for (const c of chans) e = Math.max(e, Math.abs(c[a] + (c[b] - c[a]) * u - c[i]));
      if (e > worst) { worst = e; wi = i; }
    }
    if (worst > tol && wi > 0) { keep[wi] = 1; stack.push([a, wi], [wi, b]); }
  }
  const idx = []; for (let i = 0; i < n; i++) if (keep[i]) idx.push(i);
  return idx;
}
