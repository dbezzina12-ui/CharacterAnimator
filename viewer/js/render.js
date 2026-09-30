// Headless reference renderer (driven by scripts/render-references.mjs). Loads a character GLB
// in a fresh page and renders the projection reference passes with the shared cameras.
import * as THREE from 'three';
import { Character, PART_ORDER, loadGLB, partColorBytes } from './character.js';
import { CoverageProbe } from './coverage.js';
import { REF_IMAGE, REF_VIEWS, cameraRecord, makeRefCamera } from './refcams.js';

const W = REF_IMAGE.width, H = REF_IMAGE.height;
const aa = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
const raw = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
for (const r of [aa, raw]) { r.setPixelRatio(1); r.setSize(W, H); r.outputColorSpace = THREE.SRGBColorSpace; document.body.appendChild(r.domElement); }
let ch = null, height = 1.75;

const skinVS = (body) => `#include <common>\n#include <skinning_pars_vertex>\n${body.decl || ''}\nvoid main(){\n#include <skinbase_vertex>\n#include <beginnormal_vertex>\n#include <skinnormal_vertex>\n#include <begin_vertex>\n#include <skinning_vertex>\n#include <project_vertex>\n${body.main || ''}\n}`;

window.R = {
  async load(url) {
    ch = new Character(await loadGLB(url));
    ch.resetPose(); ch.applyDrivers();
    height = ch.height();
    return { height, parts: Object.keys(ch.parts).length, joints: ch.skeleton.bones.length };
  },
  cameras() { return REF_VIEWS.map((v) => cameraRecord(v, makeRefCamera(v, height), height)); },
  render(viewName, pass) {
    const v = REF_VIEWS.find((x) => x.name === viewName);
    const cam = makeRefCamera(v, height);
    let renderer = raw;
    const scene = new THREE.Scene();
    scene.add(ch.root);
    let extra = {};
    if (pass === 'beauty') {
      renderer = aa;
      ch.setMaterial('original');
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.9));
      const head = new THREE.DirectionalLight(0xffffff, 1.2);   // camera-aligned "headlight": identical lighting per view
      head.position.copy(cam.position).add(new THREE.Vector3(0, height * 0.6, 0));
      head.target.position.copy(cam.userData.target);
      scene.add(head, head.target);
    } else if (pass === 'partid') {
      ch.setMaterial('partid');
    } else if (pass === 'depth') {
      const d = cam.position.distanceTo(cam.userData.target);
      const zmin = d - height * 0.2, zmax = d + height * 0.2;
      extra = { depthNear: zmin, depthFar: zmax, encoding: 'value = 1 - (viewDepth - near)/(far - near), 8-bit; background 0' };
      ch.setMaterial('custom', { factory: () => new THREE.ShaderMaterial({
        uniforms: { zr: { value: new THREE.Vector2(zmin, zmax) } },
        vertexShader: skinVS({ decl: 'varying float vz;', main: 'vz = -mvPosition.z;' }),
        fragmentShader: 'uniform vec2 zr; varying float vz; void main(){ float t = clamp((vz - zr.x)/(zr.y - zr.x), 0.0, 1.0); gl_FragColor = vec4(vec3(1.0 - t), 1.0); }' }) });
    } else if (pass === 'normal') {
      extra = { encoding: 'camera-space normal (x right, y up, z toward camera) * 0.5 + 0.5' };
      ch.setMaterial('custom', { factory: () => new THREE.ShaderMaterial({
        vertexShader: skinVS({ decl: 'varying vec3 vn;', main: 'vn = normalize(normalMatrix * objectNormal);' }),
        fragmentShader: 'varying vec3 vn; void main(){ gl_FragColor = vec4(normalize(vn) * 0.5 + 0.5, 1.0); }' }) });
    }
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, cam);
    ch.setMaterial('original');
    return { png: renderer.domElement.toDataURL('image/png'), ...extra };
  },
  coverage() {
    // texture-space bakes: part-ID map and reference-view coverage (all views + each view alone)
    const size = 1024;
    raw.setSize(size, size);
    const cams = REF_VIEWS.map((v) => makeRefCamera(v, height));
    const probe = new CoverageProbe(raw, 1024);
    ch.setMaterial('blank');
    probe.capture(ch.root, cams);
    const bake = (factory) => {
      ch.setMaterial('custom', { factory });
      const sc = new THREE.Scene(); sc.add(ch.root);
      raw.setClearColor(0x000000, 0); raw.render(sc, new THREE.OrthographicCamera());
      const png = raw.domElement.toDataURL('image/png');
      const px = new Uint8Array(size * size * 4);
      const gl = raw.getContext(); gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { png, px };
    };
    const partMat = (n) => new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { idc: { value: new THREE.Vector3(...partColorBytes(n).map((x) => x / 255)) } },
      vertexShader: 'void main(){ gl_Position = vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0); }',
      fragmentShader: 'uniform vec3 idc; void main(){ gl_FragColor = vec4(idc, 1.0); }' });
    const parts = bake(partMat);
    const all = bake(() => probe.material({ uvSpace: true }));
    const colorKey = (p, i) => `${p[i]},${p[i + 1]},${p[i + 2]}`;
    const partOf = {};
    for (const n of PART_ORDER) partOf[partColorBytes(n).join(',')] = n;
    const classify = (px, i) => {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      if (r > 200 && g < 60 && b > 200) return 'none';
      if (r > 200 && g > 100 && g < 160) return 'grazing';
      if (r > 200 && g > 180) return 'one';
      if (g > 150 && r < 80) return 'multi';
      return 'none';
    };
    const stats = {};
    for (const n of PART_ORDER) stats[n] = { texels: 0, none: 0, grazing: 0, one: 0, multi: 0 };
    for (let i = 0; i < parts.px.length; i += 4) {
      if (parts.px[i + 3] === 0) continue;
      const n = partOf[colorKey(parts.px, i)];
      if (!n) continue;
      stats[n].texels++;
      stats[n][classify(all.px, i)]++;
    }
    const single = {};
    cams.forEach((c, k) => {
      const one = bake(() => probe.material({ uvSpace: true, only: [k] }));
      let seen = 0, tot = 0;
      for (let i = 0; i < parts.px.length; i += 4) { if (parts.px[i + 3] === 0) continue; tot++; if (classify(one.px, i) !== 'none') seen++; }
      single[REF_VIEWS[k].name] = +(seen / tot).toFixed(4);
    });
    // 3D previews of the coverage diagnostic (rest pose) from angles NOT in the reference set
    const views3d = [];
    raw.setSize(768, 1024);
    ch.setMaterial('custom', { factory: () => probe.material() });
    for (const [az, el] of [[140, -25], [220, -25], [0, 70], [0, -60]]) {
      const cam = makeRefCamera({ name: 'diag', azimuth: az, elevation: el }, height, 768 / 1024);
      const sc = new THREE.Scene(); sc.add(ch.root);
      raw.setClearColor(0x202020, 1); raw.render(sc, cam);
      views3d.push({ azimuth: az, elevation: el, png: raw.domElement.toDataURL('image/png') });
    }
    raw.setSize(W, H);
    ch.setMaterial('original');
    return { partsUV: parts.png, coverageUV: all.png, stats, singleViewTexelCoverage: single, views3d, size };
  },
};
window.__ready = true;
