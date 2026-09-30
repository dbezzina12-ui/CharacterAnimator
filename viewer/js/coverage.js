// Projection-coverage diagnostic: which parts of the surface are seen (and how squarely) by
// the reference cameras. Magenta = seen by NO reference view (must be painted/filled some
// other way); orange = only grazing views; yellow = one good view; green = two or more.
import * as THREE from 'three';

const MAXV = 6;

export class CoverageProbe {
  constructor(renderer, size = 1024) {
    this.renderer = renderer;
    this.size = size;
    this.targets = [];
    this.cams = [];
  }

  capture(object, cams) {
    this.cams = cams;
    for (const t of this.targets) t.dispose();
    this.targets = cams.map(() => {
      const rt = new THREE.WebGLRenderTarget(this.size, this.size);
      rt.depthTexture = new THREE.DepthTexture(this.size, this.size);
      rt.depthTexture.type = THREE.FloatType;
      return rt;
    });
    const prevRT = this.renderer.getRenderTarget();
    const prevClear = this.renderer.getClearColor(new THREE.Color());
    cams.forEach((cam, i) => {
      const c = cam.clone();
      c.aspect = 1;
      c.updateProjectionMatrix();
      this.cams[i] = c;
      this.renderer.setRenderTarget(this.targets[i]);
      this.renderer.clear();
      this.renderer.render(object, c);
    });
    this.renderer.setRenderTarget(prevRT);
    this.renderer.setClearColor(prevClear);
  }

  // uvSpace: rasterise into texture space (glTF convention: image row 0 = v 0), for baking
  material({ uvSpace = false, minFacing = 0.35, only = null } = {}) {
    const n = this.cams.length;
    const uniforms = {
      depthTex: { value: this.targets.map((t) => t.depthTexture) },
      viewProj: { value: this.cams.map((c) => new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse)) },
      camPos: { value: this.cams.map((c) => c.getWorldPosition(new THREE.Vector3())) },
      nearFar: { value: this.cams.map((c) => new THREE.Vector2(c.near, c.far)) },
      minFacing: { value: minFacing },
    };
    while (uniforms.depthTex.value.length < MAXV) {
      uniforms.depthTex.value.push(uniforms.depthTex.value[0]);
      uniforms.viewProj.value.push(new THREE.Matrix4());
      uniforms.camPos.value.push(new THREE.Vector3());
      uniforms.nearFar.value.push(new THREE.Vector2(0.05, 50));
    }
    return new THREE.ShaderMaterial({
      uniforms,
      side: THREE.DoubleSide,
      vertexShader: `
        #include <common>
        #include <skinning_pars_vertex>
        varying vec3 vW; varying vec3 vN;
        void main(){
          #include <skinbase_vertex>
          #include <beginnormal_vertex>
          #include <skinnormal_vertex>
          #include <begin_vertex>
          #include <skinning_vertex>
          vec4 w = modelMatrix * vec4(transformed, 1.0);
          vW = w.xyz; vN = normalize(mat3(modelMatrix) * objectNormal);
          ${uvSpace ? 'gl_Position = vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);' : 'gl_Position = projectionMatrix * viewMatrix * w;'}
        }`,
      fragmentShader: `
        uniform sampler2D depthTex[${MAXV}];
        uniform mat4 viewProj[${MAXV}];
        uniform vec3 camPos[${MAXV}];
        uniform vec2 nearFar[${MAXV}];
        uniform float minFacing;
        varying vec3 vW; varying vec3 vN;
        float lin(float d, vec2 nf){ float z = d * 2.0 - 1.0; return 2.0 * nf.x * nf.y / (nf.y + nf.x - z * (nf.y - nf.x)); }
        float vis(int i, sampler2D tex){
          vec4 c = viewProj[i] * vec4(vW, 1.0);
          vec3 ndc = c.xyz / c.w;
          if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0 || ndc.z > 1.0) return 0.0;
          float dt = texture2D(tex, ndc.xy * 0.5 + 0.5).r;
          float zf = lin(ndc.z * 0.5 + 0.5, nearFar[i]);
          float zt = lin(dt, nearFar[i]);
          if (zf - zt > 0.012) return 0.0;
          float facing = dot(normalize(vN), normalize(camPos[i] - vW));
          if (facing <= 0.0) return 0.0;
          return facing >= minFacing ? 1.0 : 0.5;
        }
        void main(){
          float good = 0.0, graze = 0.0;
          ${Array.from({ length: n }, (_, i) => i).filter((i) => only === null || only.includes(i)).map((i) => `{ float v = vis(${i}, depthTex[${i}]); good += step(0.75, v); graze += step(0.25, v) * (1.0 - step(0.75, v)); }`).join('\n          ')}
          vec3 col = vec3(1.0, 0.0, 1.0);                    // not seen by any reference view
          if (good >= 2.0) col = vec3(0.15, 0.75, 0.25);
          else if (good >= 1.0) col = vec3(0.92, 0.85, 0.2);
          else if (graze >= 1.0) col = vec3(1.0, 0.5, 0.1);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
  }
}
