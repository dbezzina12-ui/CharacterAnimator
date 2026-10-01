// Minimal WebGL renderer for gamboligy 2D characters. No dependencies: shared by the editor and the
// standalone runtime player. Draws each visible attachment as a deformed textured triangle mesh in the
// evaluated draw order, premultiplied alpha, blend modes normal/additive/multiply/screen.
//
// Images: project.images[id] = { path, w, h } (one PNG per attachment) or, in runtime packages,
// { page, x, y, w, h } (a rectangle of an atlas page; project.atlas.pages[page] = { path, w, h }).

const VS = `attribute vec2 aPos; attribute vec2 aUV; uniform vec4 uView; varying vec2 vUV;
void main(){ vUV = aUV; gl_Position = vec4((aPos.x - uView.x) * uView.z, (aPos.y - uView.y) * uView.w, 0.0, 1.0); }`;
const FS = `precision mediump float; uniform sampler2D uTex; uniform vec4 uColor; uniform float uFlat; varying vec2 vUV;
void main(){ vec4 c = texture2D(uTex, vUV); if (uFlat > 0.5) c = vec4(c.a); gl_FragColor = c * uColor; }`;

export class Renderer2D {
  constructor(canvas, { background = null } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl; this.background = background;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    this.prog = p;
    this.loc = { pos: gl.getAttribLocation(p, 'aPos'), uv: gl.getAttribLocation(p, 'aUV'), view: gl.getUniformLocation(p, 'uView'),
      color: gl.getUniformLocation(p, 'uColor'), tex: gl.getUniformLocation(p, 'uTex'), flat: gl.getUniformLocation(p, 'uFlat') };
    this.posBuf = gl.createBuffer(); this.uvBuf = gl.createBuffer(); this.idxBuf = gl.createBuffer();
    this.textures = new Map();          // key (image id or atlas page) -> {tex, w, h}
    this.uvCache = new Map();           // attachment id -> Float32Array
    this.scratch = new Float32Array(1024);
    this.view = { x: 0, y: 500, zoom: 1 };
  }

  /** Upload an image source (HTMLImageElement / ImageBitmap / canvas) under `key`. */
  setTexture(key, source) {
    const gl = this.gl, old = this.textures.get(key);
    if (old) gl.deleteTexture(old.tex);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textures.set(key, { tex, w: source.width, h: source.height });
    for (const k of [...this.uvCache.keys()]) this.uvCache.delete(k);
  }

  /** Load every image of a project/package. `resolve(path)` -> URL. */
  async loadImages(project, resolve) {
    const load = (url) => new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error(`image ${url} failed to load`)); im.src = url; });
    const jobs = [];
    if (project.atlas?.pages) project.atlas.pages.forEach((pg, i) => jobs.push(load(resolve(pg.path)).then((im) => this.setTexture(`page:${i}`, im))));
    for (const [id, im] of Object.entries(project.images || {})) if (im.path) jobs.push(load(resolve(im.path)).then((img) => this.setTexture(id, img)));
    await Promise.all(jobs);
  }

  _texFor(project, imgId) {
    const im = project.images[imgId];
    if (!im) return null;
    return im.page !== undefined ? this.textures.get(`page:${im.page}`) : this.textures.get(imgId);
  }

  _uvs(project, att) {
    let uv = this.uvCache.get(att.id);
    if (uv && uv.length === att.vertices.length) return uv;
    const im = project.images[att.image], t = this._texFor(project, att.image);
    uv = new Float32Array(att.vertices.length);
    const ox = im.page !== undefined ? im.x : 0, oy = im.page !== undefined ? im.y : 0;
    const W = t ? t.w : im.w, H = t ? t.h : im.h;
    for (let i = 0; i < att.vertices.length; i += 2) { uv[i] = (ox + att.vertices[i]) / W; uv[i + 1] = (oy + att.vertices[i + 1]) / H; }
    this.uvCache.set(att.id, uv);
    return uv;
  }
  invalidate(attId) { if (attId) this.uvCache.delete(attId); else this.uvCache.clear(); }

  /** Pixel size of the canvas drawing buffer following its CSS size. */
  fit(dpr = (globalThis.devicePixelRatio || 1)) {
    const c = this.canvas, w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  /** view: {x, y} = world point at the canvas centre, zoom = screen px per project px (CSS px). */
  worldToScreen(x, y, dpr = 1) {
    const v = this.view, c = this.canvas;
    return [c.width / dpr / 2 + (x - v.x) * v.zoom, c.height / dpr / 2 - (y - v.y) * v.zoom];
  }
  screenToWorld(sx, sy, dpr = 1) {
    const v = this.view, c = this.canvas;
    return [v.x + (sx - c.width / dpr / 2) / v.zoom, v.y - (sy - c.height / dpr / 2) / v.zoom];
  }

  clear() {
    const gl = this.gl, b = this.background;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (b) gl.clearColor(b[0] * b[3], b[1] * b[3], b[2] * b[3], b[3]); else gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * Draw one evaluated pose. opts: { clear=true, dpr, only:Set(slotIds), dim:Set(slotIds) (drawn faded),
   *   flat: [r,g,b,a] silhouette colour, skip:Set(slotIds), viewport:[x,y,w,h] device px, view:{x,y,zoom},
   *   alpha: overall opacity (overlays such as a starter-art ghost under painted art) }
   * Returns the draw list with world-space vertices (reused by hit testing).
   */
  draw(rig, pose, opts = {}) {
    const gl = this.gl, P = rig.project, dpr = opts.dpr ?? (globalThis.devicePixelRatio || 1);
    if (opts.clear !== false) this.clear();
    const vp = opts.viewport || [0, 0, this.canvas.width, this.canvas.height];   // device px, origin bottom-left
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    gl.useProgram(this.prog);
    const v = opts.view || this.view, sx = 2 * v.zoom * dpr / vp[2], sy = 2 * v.zoom * dpr / vp[3];
    gl.uniform4f(this.loc.view, v.x, v.y, sx, sy);
    gl.uniform1i(this.loc.tex, 0);
    gl.enable(gl.BLEND);
    const list = rig.drawList(pose), drawn = [];
    for (const d of list) {
      if (opts.only && !opts.only.has(d.slot)) continue;
      if (opts.skip && opts.skip.has(d.slot)) continue;
      const att = P.attachments[d.attachment], t = this._texFor(P, att.image);
      if (!t) continue;
      const pos = rig.skinAttachment(d.attachment, pose, new Float32Array(att.vertices.length));
      drawn.push({ ...d, pos, tris: att.triangles });
      const c = opts.flat || d.color;
      const a = (opts.dim && opts.dim.has(d.slot) ? 0.25 : 1) * c[3] * (opts.alpha ?? 1);
      gl.uniform4f(this.loc.color, c[0] * a, c[1] * a, c[2] * a, a);
      gl.uniform1f(this.loc.flat, opts.flat ? 1 : 0);
      switch (d.blend) {
        case 'additive': gl.blendFunc(gl.ONE, gl.ONE); break;
        case 'multiply': gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA); break;
        case 'screen': gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); break;
        default: gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(this.loc.pos); gl.vertexAttribPointer(this.loc.pos, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf); gl.bufferData(gl.ARRAY_BUFFER, this._uvs(P, att), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(this.loc.uv); gl.vertexAttribPointer(this.loc.uv, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(att.triangles), gl.DYNAMIC_DRAW);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.drawElements(gl.TRIANGLES, att.triangles.length, gl.UNSIGNED_SHORT, 0);
    }
    return drawn;
  }
}

/**
 * Topmost slot under world point (x, y) using the DEFORMED meshes of the last draw (back-to-front list).
 * alphaTest(att, u, v) -> alpha 0..1 is optional (pixel-accurate picking); without it triangles decide.
 */
export function hitTest(drawn, x, y, alphaTest = null) {
  for (let k = drawn.length - 1; k >= 0; k--) {
    const d = drawn[k], p = d.pos, T = d.tris;
    for (let i = 0; i < T.length; i += 3) {
      const a = T[i] * 2, b = T[i + 1] * 2, c = T[i + 2] * 2;
      const x0 = p[a], y0 = p[a + 1], x1 = p[b], y1 = p[b + 1], x2 = p[c], y2 = p[c + 1];
      const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (Math.abs(den) < 1e-9) continue;
      const l0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / den, l1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / den, l2 = 1 - l0 - l1;
      if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
      if (alphaTest && alphaTest(d, T[i], T[i + 1], T[i + 2], l0, l1, l2) < 0.1) continue;
      return { slot: d.slot, attachment: d.attachment, tri: i / 3, bary: [l0, l1, l2] };
    }
  }
  return null;
}
