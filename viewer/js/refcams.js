// Projection reference cameras. Shared by the viewer (camera buttons, coverage diagnostic)
// and scripts/render-references.mjs, so interactive and saved views are identical.
// glTF/three.js space: +Y up, character faces +Z, character's left is +X.
import * as THREE from 'three';

export const REF_IMAGE = { width: 1536, height: 1536 };
export const REF_FOV_Y = 24;                // degrees, vertical
export const REF_DISTANCE_FACTOR = 2.75;    // camera distance = factor * character height
export const REF_TARGET_FACTOR = 0.5;       // look-at height = factor * character height

// azimuth measured from +Z (front) toward +X (character's left)
export const REF_VIEWS = [
  { name: 'front', azimuth: 0, elevation: 0 },
  { name: 'back', azimuth: 180, elevation: 0 },
  { name: 'left', azimuth: 90, elevation: 0, note: "camera on the character's LEFT side (+X)" },
  { name: 'right', azimuth: 270, elevation: 0, note: "camera on the character's RIGHT side (-X)" },
  { name: 'front_three_quarter', azimuth: 40, elevation: 8, note: "front, rotated toward the character's left" },
];

export function makeRefCamera(view, height, aspect = REF_IMAGE.width / REF_IMAGE.height) {
  const cam = new THREE.PerspectiveCamera(REF_FOV_Y, aspect, 0.05, 50);
  const target = new THREE.Vector3(0, height * REF_TARGET_FACTOR, 0);
  const d = height * REF_DISTANCE_FACTOR;
  const az = THREE.MathUtils.degToRad(view.azimuth), el = THREE.MathUtils.degToRad(view.elevation);
  cam.position.set(Math.sin(az) * Math.cos(el) * d, target.y + Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
  cam.up.set(0, 1, 0);
  cam.lookAt(target);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  cam.userData.target = target;
  return cam;
}

export function cameraRecord(view, cam, height) {
  const t = cam.userData.target;
  const gl2bl = (v) => [v.x, -v.z, v.y];
  return {
    name: view.name,
    note: view.note || '',
    type: 'perspective',
    imageSize: [REF_IMAGE.width, REF_IMAGE.height],
    fovYDeg: REF_FOV_Y,
    aspect: cam.aspect,
    near: cam.near,
    far: cam.far,
    azimuthDeg: view.azimuth,
    elevationDeg: view.elevation,
    position: cam.position.toArray(),
    target: t.toArray(),
    up: [0, 1, 0],
    quaternion: cam.quaternion.toArray(),
    matrixWorld: cam.matrixWorld.toArray(),
    viewMatrix: cam.matrixWorldInverse.toArray(),
    projectionMatrix: cam.projectionMatrix.toArray(),
    matrixConvention: 'column-major 4x4 (three.js/glTF); camera looks down its local -Z; NDC y up, image row 0 at the top',
    blender: {
      location: gl2bl(cam.position), target: gl2bl(t), sensorFit: 'VERTICAL', angleYDeg: REF_FOV_Y,
      resolution: [REF_IMAGE.width, REF_IMAGE.height],
      note: 'Blender world coords (Z up); aim the camera at target with a Track To constraint (up = Z)',
    },
    framing: { characterHeight: height, distanceFactor: REF_DISTANCE_FACTOR, targetFactor: REF_TARGET_FACTOR },
  };
}
