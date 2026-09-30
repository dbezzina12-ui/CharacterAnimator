// Character runtime for the test viewer and the headless render/validation scripts.
// Loads a character GLB (no session state needed), exposes parts, bones, sockets and clips,
// and provides posing helpers that follow the same rules the Blender pipeline bakes:
//   * rotations only (bone lengths never change), translation on root/pelvis only
//   * driven helper joints (half rotation / half twist) recomputed after every manual pose
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const PART_ORDER = ['Head', 'Neck', 'Torso', 'Pelvis', 'UpperArm_L', 'UpperArm_R', 'Forearm_L', 'Forearm_R',
  'Hand_L', 'Hand_R', 'Thigh_L', 'Thigh_R', 'Shin_L', 'Shin_R', 'Foot_L', 'Foot_R'];
export const FINGERS = ['index', 'middle', 'ring', 'pinky'];

// driven joints (mirrors tools/cbase/skeleton.py DRIVERS)
export const DRIVERS = {};
for (const s of ['L', 'R']) {
  DRIVERS[`shoulder_helper_${s}`] = [`upperarm_${s}`, 'half'];
  DRIVERS[`elbow_helper_${s}`] = [`forearm_${s}`, 'half'];
  DRIVERS[`hip_helper_${s}`] = [`thigh_${s}`, 'half'];
  DRIVERS[`knee_helper_${s}`] = [`shin_${s}`, 'half'];
  DRIVERS[`forearm_twist_${s}`] = [`hand_${s}`, 'twist_half'];
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const IDQ = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);

export function partColor(name, sat = 0.85, val = 0.95) {
  // same golden-ratio hue scheme as tools/cbase/textures.py (PART_ID_COLORS)
  const i = PART_ORDER.indexOf(name);
  const h = (i * 0.618034) % 1.0;
  const c = new THREE.Color();
  const f = (n) => { const k = (n + h * 6) % 6; return val - val * sat * Math.max(0, Math.min(k, 4 - k, 1)); };
  c.setRGB(f(5), f(3), f(1), THREE.SRGBColorSpace);
  return c;
}

export function partColorBytes(name) {
  const i = PART_ORDER.indexOf(name);
  const h = (i * 0.618034) % 1.0;
  const sat = 0.85, val = 0.95;
  const f = (n) => { const k = (n + h * 6) % 6; return val - val * sat * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)].map((x) => Math.floor(x * 255));
}

export async function loadGLB(src) {
  const loader = new GLTFLoader();
  if (src instanceof ArrayBuffer) return await loader.parseAsync(src, '');
  return await loader.loadAsync(src);
}

export class Character {
  constructor(gltf, config = null) {
    this.gltf = gltf;
    this.config = config;
    this.root = gltf.scene;
    this.clips = gltf.animations || [];
    this.parts = {};
    this.bones = {};
    this.sockets = {};
    this.root.traverse((o) => {
      if (o.isSkinnedMesh) this.parts[o.name] = o;
      if (o.isBone) this.bones[o.name] = o;
      if (o.name && o.name.startsWith('socket_')) this.sockets[o.name] = o;
    });
    const first = Object.values(this.parts)[0];
    this.skeleton = first ? first.skeleton : null;
    this.rest = {};
    for (const [n, b] of Object.entries(this.bones)) {
      this.rest[n] = { q: b.quaternion.clone(), p: b.position.clone() };
    }
    this.mixer = new THREE.AnimationMixer(this.root);
    this.originalMaterials = {};
    for (const [n, m] of Object.entries(this.parts)) {
      this.originalMaterials[n] = m.material;
      m.frustumCulled = false;
    }
    this._installExplode();
    this.root.updateMatrixWorld(true);
    this.restCentroids = this._partCentroids();
  }

  // ---------------------------------------------------------------- pose ----------
  resetPose() {
    this.mixer.stopAllAction();
    for (const [n, r] of Object.entries(this.rest)) {
      this.bones[n].quaternion.copy(r.q);
      this.bones[n].position.copy(r.p);
    }
    this.root.updateMatrixWorld(true);
  }

  basis(name) {
    // Blender-style basis rotation: rest^-1 * current (bone-local)
    return _q.copy(this.rest[name].q).invert().multiply(this.bones[name].quaternion).clone();
  }

  setBasis(name, q) {
    this.bones[name].quaternion.copy(this.rest[name].q).multiply(q);
  }

  applyDrivers() {
    for (const [h, [src, mode]] of Object.entries(DRIVERS)) {
      if (!this.bones[h] || !this.bones[src]) continue;
      const b = this.basis(src);
      let q;
      if (mode === 'half') q = IDQ.clone().slerp(b, 0.5);
      else {
        const ang = 2 * Math.atan2(b.y, b.w);   // swing-twist about local +Y
        q = new THREE.Quaternion().setFromAxisAngle(Y, ang * 0.5);
      }
      this.setBasis(h, q);
    }
    this.root.updateMatrixWorld(true);
  }

  curlFinger(side, finger, amount) {
    const deg = [78, 95, 62];
    for (let i = 0; i < 3; i++) {
      const n = `${finger}_0${i + 1}_${side}`;
      if (!this.bones[n]) continue;
      this.setBasis(n, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(deg[i] * amount)));
    }
  }

  curlThumb(side, amount) {
    const deg = [20, 35, 45];
    for (let i = 0; i < 3; i++) {
      const n = `thumb_0${i + 1}_${side}`;
      this.setBasis(n, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(deg[i] * amount)));
    }
  }

  worldRot(b) { return b.getWorldQuaternion(new THREE.Quaternion()); }
  worldPos(b) { return b.getWorldPosition(new THREE.Vector3()); }

  setWorldRotation(name, qWorld) {
    const b = this.bones[name];
    const pq = b.parent.getWorldQuaternion(new THREE.Quaternion());
    b.quaternion.copy(pq.invert().multiply(qWorld));
    b.updateMatrixWorld(true);
  }

  /** Two-bone IK (same algorithm as tools/cbase/poses.py): keeps each bone's roll relative to
   *  its rest bend plane, rotation only. `pole` is a world direction the elbow/knee points to. */
  twoBoneIK(upper, lower, end, target, pole) {
    const U = this.bones[upper], Lb = this.bones[lower], E = this.bones[end];
    // rest-relative frames with identity basis for upper & lower
    const saveU = U.quaternion.clone(), saveL = Lb.quaternion.clone();
    U.quaternion.copy(this.rest[upper].q); Lb.quaternion.copy(this.rest[lower].q);
    U.updateMatrixWorld(true);
    const S = this.worldPos(U), Ep0 = this.worldPos(Lb), T0 = this.worldPos(E);
    const a = S.distanceTo(Ep0), bl = Ep0.distanceTo(T0);
    const yu0 = Ep0.clone().sub(S).normalize(), yl0 = T0.clone().sub(Ep0).normalize();
    const nb0 = yu0.clone().cross(yl0).normalize();
    const Qu0 = this.worldRot(U), Ql0 = this.worldRot(Lb);
    U.quaternion.copy(saveU); Lb.quaternion.copy(saveL);
    const D = target.clone().sub(S); const dist = D.length(); const u = D.clone().divideScalar(dist);
    const d = THREE.MathUtils.clamp(dist, Math.abs(a - bl) + 1e-4, a + bl - 1e-4);
    const p = pole.clone().sub(u.clone().multiplyScalar(pole.dot(u))).normalize();
    const ca = THREE.MathUtils.clamp((a * a + d * d - bl * bl) / (2 * a * d), -1, 1);
    const El = S.clone().add(u.clone().multiplyScalar(a * ca)).add(p.clone().multiplyScalar(a * Math.sqrt(1 - ca * ca)));
    const Tt = S.clone().add(u.clone().multiplyScalar(d));
    const y1 = El.clone().sub(S).normalize(), y2 = Tt.clone().sub(El).normalize();
    let nb = y1.clone().cross(y2);
    nb = nb.lengthSq() > 1e-12 ? nb.normalize() : p.clone().cross(u).normalize();
    const frame = (y, n) => {
      const nn = n.clone().sub(y.clone().multiplyScalar(n.dot(y))).normalize();
      return new THREE.Matrix4().makeBasis(y, nn, y.clone().cross(nn));
    };
    const rot = (yTo, yFrom) => new THREE.Quaternion().setFromRotationMatrix(frame(yTo, nb).multiply(frame(yFrom, nb0).transpose()));
    this.setWorldRotation(upper, rot(y1, yu0).multiply(Qu0));
    this.setWorldRotation(lower, rot(y2, yl0).multiply(Ql0));
    return dist - d;
  }

  // ------------------------------------------------------------ materials --------
  setMaterial(mode, opts = {}) {
    for (const [n, mesh] of Object.entries(this.parts)) {
      let mat;
      if (mode === 'original') mat = this.originalMaterials[n];
      else if (mode === 'blank') mat = new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 0.85, metalness: 0 });
      else if (mode === 'parts') mat = new THREE.MeshStandardMaterial({ color: partColor(n, 0.55, 0.92), roughness: 0.8 });
      else if (mode === 'partid') mat = new THREE.ShaderMaterial({
        uniforms: { idc: { value: new THREE.Vector3(...partColorBytes(n).map((x) => x / 255)) } },
        vertexShader: `#include <common>\n#include <skinning_pars_vertex>\nvoid main(){\n#include <skinbase_vertex>\n#include <begin_vertex>\n#include <skinning_vertex>\n#include <project_vertex>\n}`,
        fragmentShader: 'uniform vec3 idc; void main(){ gl_FragColor = vec4(idc, 1.0); }',
      });
      else if (mode === 'texture') mat = new THREE.MeshStandardMaterial({ map: opts.map, roughness: 0.85, metalness: 0 });
      else if (mode === 'custom') mat = opts.factory(n, mesh);
      else throw new Error('unknown material mode ' + mode);
      if (opts.wireframe !== undefined && 'wireframe' in mat) mat.wireframe = opts.wireframe;
      this._patchExplode(mat, n);
      mesh.material = mat;
    }
  }

  // ------------------------------------------------------------ exploded view ----
  // A per-part offset added in the vertex shader after skinning. It never touches the
  // bind pose, bones, weights or exported data, so reassembly is exact.
  _installExplode() {
    this.explode = {};
    for (const n of Object.keys(this.parts)) this.explode[n] = { value: new THREE.Vector3() };
    for (const [n, m] of Object.entries(this.parts)) this._patchExplode(m.material, n);
  }

  _patchExplode(mat, n) {
    if (!mat || mat.userData.explodePatched) return;
    mat.userData.explodePatched = true;
    const uni = this.explode[n];
    if (mat.isShaderMaterial) {
      mat.uniforms.explodeOffset = uni;
      mat.vertexShader = mat.vertexShader.replace('void main(){', 'uniform vec3 explodeOffset;\nvoid main(){')
        .replace('#include <project_vertex>', 'transformed += explodeOffset;\n#include <project_vertex>');
      return;
    }
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      sh.uniforms.explodeOffset = uni;
      sh.vertexShader = 'uniform vec3 explodeOffset;\n' + sh.vertexShader.replace('#include <project_vertex>',
        'transformed += explodeOffset;\n#include <project_vertex>');
    };
    mat.customProgramCacheKey = () => 'explode-' + (mat.type) + (mat.map ? '-map' : '');
    mat.needsUpdate = true;
  }

  _partCentroids() {
    const out = {};
    for (const [n, m] of Object.entries(this.parts)) {
      const pos = m.geometry.attributes.position;
      const c = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) c.add(_v.fromBufferAttribute(pos, i));
      out[n] = c.divideScalar(pos.count);
    }
    return out;
  }

  setExplode(amount) {
    const body = new THREE.Vector3(0, this.restCentroids.Torso ? this.restCentroids.Torso.y : 1.0, 0);
    for (const [n, c] of Object.entries(this.restCentroids)) {
      const dir = c.clone().sub(body);
      this.explode[n].value.copy(dir.multiplyScalar(amount * 0.6));
    }
  }

  // ------------------------------------------------------------ queries ---------
  skinnedPosition(part, i, target = new THREE.Vector3()) {
    const m = this.parts[part];
    m.getVertexPosition(i, target);
    return target.applyMatrix4(m.matrixWorld);
  }

  height() {
    const b = new THREE.Box3();
    for (const m of Object.values(this.parts)) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox); }
    return b.max.y - Math.min(b.min.y, 0);
  }

  clip(name) { return this.clips.find((c) => c.name === name); }

  poseAtClip(name, t) {
    const c = this.clip(name);
    this.mixer.stopAllAction();
    const a = this.mixer.clipAction(c);
    a.reset().play();
    a.paused = true;
    a.time = t;
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    return a;
  }
}
