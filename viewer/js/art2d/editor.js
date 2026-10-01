// 2D artwork mode of the CharacterAnimator viewer: editor UI on top of the shared 2D core.
// Setup mode edits the bind pose (bones, pivots, meshes, weights, layer order); Animate mode keys the
// current clip (bridged clips: the identifiable `corrections` layer; native 2D clips: their tracks).
import { Rig, Player, setKey, deleteKey, sampleField, sampleStep, sampleVector, keyIndex, ensureLayer, affApply, affInv, affMul, affCompose, affDecompose, wrapDeg, resolveOrder, meshSamples, remapDeformKeys, sampleDeform } from './core.js';
import { Renderer2D, hitTest } from './render2d.js';
import { AssetStore, loadProjectURL, loadProjectZip, saveProjectZip, importLayers, replaceImage, autoWeightAttachment, meshCell } from './project-io.js';
import { validateProject, computeInverseBinds } from './schema.js';
import { gridMesh, addVertex, deleteVertex, smoothWeights, normalizeWeights, paintWeights } from './mesh.js';
import { exportRuntimePackage, exportFramePNG, exportSpriteSheets, download, poseBounds, offscreenRenderer } from './exporters.js';
import { readFitSource, planFit, installFit, resetFit, snapToJoints, slotAnchors, imageToWorld, worldToImage, templateOf, FIT_SCHEMA } from './fitting.js';
import { jointCoverage, paintTemplatePack } from './paintpack.js';
import { suggestHandSets, missingHandArt, setsUsed } from './handviews.js';
import { analyzeClip, sheetTimes, contactSheet, clipStatus } from './visualqa.js';

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const HAND_PRESETS = {
  open: { curl: -0.15, thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
  relaxed: { curl: 0.3, thumb: 0, index: -0.05, middle: 0, ring: 0.05, pinky: 0.1 },
  fist: { curl: 1, thumb: 0.1, index: 0, middle: 0, ring: 0, pinky: 0 },
  grip: { curl: 0.8, thumb: -0.2, index: -0.1, middle: 0, ring: 0.05, pinky: 0.1 },
};
const clone = (x) => (x === undefined ? undefined : structuredClone(x));
const res = (o) => (typeof o === 'function' ? o() : o);
const $ = (root, sel) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
.modeSwitch{display:flex;gap:4px;margin:0 0 12px}.modeSwitch button{flex:1}
body.mode2d #side>details,body.mode2d #side>.knight-only{display:none}
#side2d{display:none}body.mode2d #side2d{display:block}
#stage2d{position:absolute;inset:0;display:none;background:#171b22;touch-action:none;overflow:hidden}body.mode2d #stage2d{display:block}
body.mode2d #main>.viewport-label,body.mode2d #legend{display:none}
#stage2d canvas{position:absolute;inset:0;width:100%;height:100%}
#stage2d .badge{position:absolute;left:10px;top:10px;max-width:calc(100% - 150px);padding:4px 10px;border-radius:12px;font:600 11px system-ui;letter-spacing:1px;pointer-events:none}
#stage2d .badge.setup{background:#7a4b12;color:#ffe2b0}#stage2d .badge.fitting{background:#5a2a7a;color:#f0d8ff}#stage2d .badge.animate{background:#1f5a3a;color:#c8f5dc}
#stage2d .hud{position:absolute;right:10px;bottom:10px;background:#000a;padding:4px 8px;border-radius:4px;font:11px ui-monospace,monospace;pointer-events:none;white-space:pre;max-width:60%;overflow:hidden;text-overflow:ellipsis}
#stage2d .zoom{position:absolute;right:10px;top:10px;display:flex;gap:4px}
body.mode2d.compare-inset #main>canvas{position:absolute;left:10px;bottom:10px;width:30%!important;height:34%!important;border:1px solid #cfb078;border-radius:4px;z-index:3;pointer-events:none}
body.mode2d.compare-overlay #main>canvas{position:absolute;inset:0;opacity:.45;z-index:3;pointer-events:none}
body.mode2d:not(.compare-inset):not(.compare-overlay) #main>canvas{display:none}
#side2d .sec{border-top:1px solid var(--line);padding:9px 0}#side2d h3{font-size:12px;margin:0 0 6px;letter-spacing:.5px}
#side2d .grid2{display:grid;grid-template-columns:1fr 1fr;gap:4px}#side2d .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}
#side2d input[type=number]{width:100%;background:#202b3b;color:var(--fg);border:1px solid #334054;border-radius:4px;padding:3px}
#side2d .layers{max-height:240px;overflow-y:auto;border:1px solid var(--line);border-radius:4px}
#side2d .layer{display:flex;gap:6px;align-items:center;padding:2px 6px;cursor:grab;font-size:12px}
#side2d .layer.sel{background:#2f4a75}#side2d .layer.drop{box-shadow:inset 0 2px 0 #cfb078}#side2d .layer .n{flex:1}#side2d .layer .a{color:var(--muted);font-size:11px}
#side2d .layer .eye{cursor:pointer;width:16px;text-align:center}
#side2d .status-ok{color:#8fd19e}#side2d .status-attention{color:#e8c46a}#side2d .status-needs-art{color:#f08a7a}
#side2d .notes{font-size:11px;color:var(--muted);max-height:120px;overflow-y:auto}
#side2d canvas.timeline{width:100%;height:64px;background:#10151e;border-radius:4px;cursor:pointer;display:block}
#side2d .report{font:11px ui-monospace,monospace;white-space:pre-wrap;max-height:150px;overflow-y:auto;color:var(--muted)}
#side2d .tools button.on,#side2d .mode button.on{background:#2f4a75;border-color:#cfb078}
#side2d .small{font-size:11px;color:var(--muted)}
`;

export function installModeSwitch(viewer, hooks = {}) {
  if (document.getElementById('side2d')) return viewer.art2d;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const side = document.getElementById('side'), main = document.getElementById('main');
  const sw = document.createElement('div'); sw.className = 'modeSwitch';
  sw.innerHTML = '<button data-m="3d" class="on">3D character</button><button data-m="2d">2D artwork</button>';
  const anchor = side.querySelector('details') || side.firstChild;
  side.insertBefore(sw, anchor);
  const panel = document.createElement('div'); panel.id = 'side2d'; side.insertBefore(panel, anchor);
  const stage = document.createElement('div'); stage.id = 'stage2d'; main.appendChild(stage);
  let editor = null, initializing = null, requestedMode = '3d';
  const api = viewer.art2d = {
    get editor() { return editor; },
    async setMode(m) {
      requestedMode = m;
      sw.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
      if (m === '2d') {
        if (editor?.active) return m;
        const a = viewer.state.clipAction, carry = a ? { clip: a.getClip().name, time: a.time } : null;
        document.body.classList.add('mode2d');
        viewer.state.suspendLoop = true; viewer.state.playing = false;
        if (!editor) { editor = new Editor2D(viewer, hooks, panel, stage); initializing = editor.init(); }
        await initializing;
        if (requestedMode === '2d' && !editor.active) editor.activate(carry);
      } else {
        const carry = editor?.active ? editor.deactivate() : null;
        document.body.classList.remove('mode2d', 'compare-inset', 'compare-overlay');
        viewer.state.suspendLoop = false;
        hooks.resize?.();
        if (carry?.clip && viewer.state.ch?.clip(carry.clip)) hooks.playClip?.(carry.clip, carry.time, false);
      }
      return m;
    },
  };
  sw.onclick = (e) => { const m = e.target.dataset?.m; if (m) api.setMode(m); };
  return api;
}

// ======================================================================================
class Editor2D {
  constructor(viewer, hooks, panel, stage) {
    this.v = viewer; this.hooks = hooks; this.panel = panel; this.stage = stage;
    this.mode = 'animate'; this.tool = 'select'; this.bend = 'keep';
    this.sel = { bone: null, slot: null, attachment: null, vertex: -1 };
    this.overlay = { bones: true, mesh: false, weights: false, pivots: false, markers: false, contacts: true, alphaPick: true };
    this.hidden = new Set(); this.isolate = null;
    this.preview = { hands: { L: { ...HAND_PRESETS.open, curl: 0 }, R: { ...HAND_PRESETS.open, curl: 0 } }, pose: null, props: {} };
    this.brush = { radius: 24, strength: 0.25, mode: 'add', locked: new Set() };
    this.undoStack = []; this.redoStack = [];
    this.events = []; this.compare = 'off'; this.active = false;
    this.onion = { on: false, n: 2, step: 3 }; this.previewCorrections = true;
    this.alphaCache = new Map();
  }

  // ---------------------------------------------------------------- lifecycle ------
  async init() {
    this.stage.innerHTML = `<canvas class="ref"></canvas><canvas class="gl"></canvas><canvas class="ov"></canvas>
      <div class="badge"></div><div class="zoom"><button data-z="in">+</button><button data-z="out">−</button><button data-z="fit">Fit</button></div><div class="hud"></div>`;
    this.refCanvas = $(this.stage, 'canvas.ref'); this.glCanvas = $(this.stage, 'canvas.gl'); this.ovCanvas = $(this.stage, 'canvas.ov');
    this.renderer = new Renderer2D(this.glCanvas);
    this.ov = this.ovCanvas.getContext('2d'); this.refCtx = this.refCanvas.getContext('2d');
    this.buildPanel();
    this.bindStage();
    const base = window.__CB_BASE ?? '../';
    this.base = base;
    try { this.index = await (await fetch(`${base}characters2d/index.json`)).json(); } catch { this.index = { projects: [] }; }
    const sel = $(this.panel, '#p2Project');
    sel.innerHTML = this.index.projects.map((p) => `<option value="${esc(p.path)}">${esc(p.displayName)}</option>`).join('');
    const id3 = this.v.state.cfg?.characterId;
    const pick = this.index.projects.find((p) => p.source3d === id3) || this.index.projects[0];
    if (pick) { sel.value = pick.path; await this.openURL(`${base}${pick.path}`); }
    window.art2d = this.api();
  }

  activate(carry) {
    if (this.active) return;
    this.active = true;
    const generation = this.loopGeneration = (this.loopGeneration || 0) + 1;
    if (carry && this.rig?.clips.has(carry.clip)) { this.selectClip(carry.clip); this.player.seek(carry.time); }
    this.setCompare(this.compare);
    requestAnimationFrame(() => this.fitView(true));
    this.last = performance.now();
    const loop = (now) => {
      if (!this.active || generation !== this.loopGeneration) return;
      this.frameRequest = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
      this.frame(dt);
    };
    this.frameRequest = requestAnimationFrame(loop);
  }
  deactivate() { this.active = false; this.loopGeneration = (this.loopGeneration || 0) + 1; cancelAnimationFrame(this.frameRequest); this.player?.pause(); return { clip: this.player?.clip?.name, time: this.player?.time || 0 }; }

  // ---------------------------------------------------------------- project -------
  async openURL(url) { const r = await loadProjectURL(url); this.setProject(r.project, r.store, r.report, url); }
  async openZip(bytes, label = 'ZIP') { const r = await loadProjectZip(bytes); this.setProject(r.project, r.store, r.report, label); }

  setProject(project, store, report, from) {
    this.store?.dispose();
    this.project = project; this.store = store; this.from = from;
    this.rig = new Rig(project);
    this.player = new Player(this.rig);
    this.player.on((e) => { this.events.unshift(`${e.time.toFixed(2)}s ${e.name}`); this.events.length = Math.min(this.events.length, 6); });
    this.undoStack = []; this.redoStack = [];
    this.sel = { bone: null, slot: null, attachment: null, vertex: -1 };
    this.renderer.textures.forEach((t) => this.renderer.gl.deleteTexture(t.tex)); this.renderer.textures.clear(); this.renderer.invalidate();
    this.ready = this.renderer.loadImages(project, (p) => store.url(p)).then(() => this.loadReference());
    const clips = $(this.panel, '#p2Clip');
    clips.innerHTML = project.clips.map((c) => `<option value="${esc(c.name)}">${c.status?.level === 'ok' ? '●' : c.status?.level === 'needs-art' ? '▲' : '◆'} ${esc(c.name)}${c.source?.type === 'native2d' ? ' (2D)' : ''}</option>`).join('');
    const first = project.clips.find((c) => c.name === 'hover_sword_vigil') || project.clips[0];
    if (first) this.selectClip(first.name);
    $(this.panel, '#p2Skin').innerHTML = (project.skins || [{ id: 'default' }]).map((s) => `<option>${esc(s.id)}</option>`).join('');
    // a project may name the skin it opens in (e.g. the painted skin); the starter skin stays selectable
    if (project.defaultSkin && (project.skins || []).some((s) => s.id === project.defaultSkin)) $(this.panel, '#p2Skin').value = this.rig.setSkin(project.defaultSkin);
    this.showReport(report, from);
    this.refreshPanel();
    this.fitView(false);
  }

  showReport(report, from) {
    const lines = [`${from}`, report.errors.length ? `✗ ${report.errors.length} error(s)` : '✓ valid gamboligy.character2d project'];
    for (const e of report.errors.slice(0, 20)) lines.push('  error: ' + e);
    if (report.warnings.length) lines.push(`${report.warnings.length} warning(s)`, ...report.warnings.slice(0, 5).map((w) => '  ' + w));
    $(this.panel, '#p2Report').textContent = lines.join('\n');
  }

  async loadReference() {
    const r = this.project.editor?.reference;
    this.refImage = null;
    if (!r?.path || !this.store.has(r.path)) return;
    const im = new Image(); im.src = this.store.url(r.path); await im.decode().catch(() => null);
    this.refImage = im;
    if (!r.scale || r.scale === 1 && !r.fitted) {                // first use: fit the concept's height to the character
      r.scale = (this.project.referenceHeightPx * 1.08) / im.height; r.x = 0; r.y = -this.project.referenceHeightPx * 0.02; r.fitted = true;
    }
    this.syncRefInputs();
  }

  rebuild(attId = null) {
    if (attId) { this.rig.rebuildAttachment(attId); this.renderer.invalidate(attId); return; }
    const skin = this.rig.skinId;
    this.rig.rebuild(); this.rig.setSkin(skin);
    if (this.player.clip) this.player.clip = this.rig.clips.get(this.player.clip.name) || null;
    this.renderer.invalidate();
  }

  // ---------------------------------------------------------------- history -------
  /** Record an edit of obj[key] for each target; fn mutates. Returns fn's result. */
  // targets: [container, key]; a container may be a function resolved at apply time (containers that an
  // undo can replace, e.g. project.attachments or a clip, must be looked up again, never held)
  record(label, targets, fn, attId = null) {
    const before = targets.map(([o, k]) => clone(res(o)[k]));
    const out = fn();
    this.push(label, targets, before, attId);
    return out;
  }
  begin(label, targets, attId = null) { this.pending = { label, targets, before: targets.map(([o, k]) => clone(res(o)[k])), attId }; }
  end() { const p = this.pending; this.pending = null; if (p) this.push(p.label, p.targets, p.before, p.attId); }
  push(label, targets, before, attId) {
    if (targets.some(([, k]) => k === 'bones')) computeInverseBinds(this.project);   // stored inverse binds follow the setup pose
    const after = targets.map(([o, k]) => clone(res(o)[k]));
    if (JSON.stringify(after) === JSON.stringify(before)) return;
    this.undoStack.push({ label, targets, before, after, attId }); this.redoStack = [];
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.dirty = true; this.refreshPanel();
  }
  undo() { const h = this.undoStack.pop(); if (!h) return null; h.targets.forEach(([o, k], i) => { res(o)[k] = clone(h.before[i]); }); this.redoStack.push(h); this.afterHistory(h); return h.label; }
  redo() { const h = this.redoStack.pop(); if (!h) return null; h.targets.forEach(([o, k], i) => { res(o)[k] = clone(h.after[i]); }); this.undoStack.push(h); this.afterHistory(h); return h.label; }
  afterHistory(h) { if (h.attId) this.rebuild(h.attId); else this.rebuild(); this.alphaCache.clear(); this.syncTextures(); this.refreshPanel(); }
  // (inverse binds are part of every bones snapshot, so undo/redo restore them together with the setup pose)

  // ---------------------------------------------------------------- clips & keys --
  get clip() { return this.player?.clip || null; }
  selectClip(name) {
    const loop = $(this.panel, '#p2Loop').checked;
    this.player.play(name, { loop: loop && !!this.rig.clips.get(name)?.loop ? true : loop });
    if (!this.playing) this.player.pause();
    $(this.panel, '#p2Clip').value = name;
    $(this.panel, '#p2Time').max = this.player.duration;
    this.events = [];
    this.refreshPanel();
  }
  /** Layer edited in Animate mode: native 2D clips edit their tracks; bridged clips the corrections layer. */
  editLayer(clip = this.clip) {
    if (!clip) return null;
    if (clip.source?.type === 'native2d') return ensureLayer(clip.tracks ||= {});
    return ensureLayer(clip.corrections ||= {});
  }
  clipRef(clip) { const name = clip.name; return () => this.project.clips.find((c) => c.name === name); }
  editKey() { return this.clip?.source?.type === 'native2d' ? 'tracks' : 'corrections'; }
  keyTime() { const fps = this.clip?.fps || 30; return Math.round(this.player.time * fps) / fps; }
  layerValue(tr, f) { return tr ? (sampleField(tr, f, this.player.time) ?? 0) : 0; }

  keyBone(id, field, fnValues, label) {
    const clip = this.clip; if (!clip) return;
    const L = this.editLayer(clip), k = this.editKey();
    this.record(label || `key ${field} ${id}`, [[this.clipRef(clip), k]], () => {
      const LL = this.editLayer(clip);
      const tr = (LL.bones[id] ||= {}); tr[field] ||= { t: [] };
      setKey(tr[field], this.keyTime(), fnValues(tr[field]));
    });
    void L;
    this.rebuild();
  }

  // ---------------------------------------------------------------- evaluation ----
  evalOpts() {
    const o = {};
    if (this.mode === 'setup' || !this.clip) {
      o.hands = this.preview.hands; o.override = this.preview.pose || undefined;
      o.props = this.preview.props; if (this.preview.handSets) o.handSets = this.preview.handSets;
    } else if (this.preview.pose) o.override = this.preview.pose;
    if (this.previewCorrections === false) o.corrections = false;
    return o;
  }
  evaluate(rig = this.fit?.rig || this.rig) {
    if (this.mode === 'setup' || !this.clip) return rig.evaluate(null, 0, this.evalOpts());
    return rig.evaluate(this.clip.name, this.player.time, this.evalOpts());
  }

  frame(dt) {
    if (!this.project) return;
    if (this.playing && this.mode === 'animate') this.player.update(dt * this.speed());
    this.renderer.fit();
    const dpr = window.devicePixelRatio || 1;
    const only = this.isolate || null;
    if (this.fit?.rig) {                              // fitting preview: starter ghost under the proposed painted skin
      const F = this.fit, skip = this.hidden.size ? this.hidden : null;
      if (F.ghost > 0) this.renderer.draw(this.rig, this.evaluate(this.rig), { dpr, only, skip, alpha: F.ghost });
      else this.renderer.clear();
      this.pose = this.evaluate(F.rig);
      this.drawn = F.painted > 0 ? this.renderer.draw(F.rig, this.pose, { dpr, only, skip, alpha: F.painted, clear: false }) : [];
    } else {
      const skip = this.hidden.size ? this.hidden : null;
      let cleared = false;
      if (this.onion.on && this.mode === 'animate' && this.clip) {      // ghost frames: past blue, future orange
        const fps = this.clip.fps || 30, t0 = this.player.time, D = this.clip.duration;
        for (let k = -this.onion.n; k <= this.onion.n; k++) {
          if (!k) continue;
          let t = t0 + k * this.onion.step / fps; if (this.clip.loop) t = ((t % D) + D) % D; else if (t < 0 || t > D) continue;
          const g = this.rig.evaluate(this.clip.name, t, this.evalOpts());
          this.renderer.draw(this.rig, g, { dpr, only, skip, clear: !cleared, flat: k < 0 ? [0.35, 0.6, 1, 1] : [1, 0.55, 0.25, 1], alpha: 0.22 * (1 - Math.abs(k) / (this.onion.n + 1)) });
          cleared = true;
        }
      }
      this.pose = this.evaluate();
      this.drawn = this.renderer.draw(this.rig, this.pose, { dpr, only, skip, clear: !cleared });
    }
    this.drawReference(dpr);
    this.drawOverlay(dpr);
    this.syncTimeUI();
    if (this.compare !== 'off') this.render3D();
  }
  speed() { return +$(this.panel, '#p2Speed').value || 1; }

  // ---------------------------------------------------------------- view ----------
  fitView(force = true) {
    if (!this.project) return;
    const r = this.glCanvas.getBoundingClientRect(), H = this.project.referenceHeightPx;
    if (!force && this.viewSet) return;
    const w = r.width || 800, h = r.height || 600;
    let b = [-H * 0.4, 0, H * 0.4, H];
    try { const pb = poseBounds(this.rig, this.evaluate()); if (pb.every(Number.isFinite)) b = [Math.min(b[0], pb[0]), Math.min(b[1], pb[1]), Math.max(b[2], pb[2]), Math.max(b[3], pb[3])]; } catch { /* keep default */ }
    this.renderer.view = { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, zoom: 0.9 * Math.min(h / (b[3] - b[1]), w / (b[2] - b[0])) };
    this.viewSet = true;
  }
  s2w(e) { const r = this.ovCanvas.getBoundingClientRect(); return this.renderer.screenToWorld(e.clientX - r.left, e.clientY - r.top, window.devicePixelRatio || 1); }
  w2s(x, y) { return this.renderer.worldToScreen(x, y, window.devicePixelRatio || 1); }

  drawReference(dpr) {
    const c = this.refCanvas, r = this.project.editor?.reference;
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = this.refCtx; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
    if (!r?.visible || !this.refImage) return;
    const im = this.refImage, s = r.scale || 1;
    const [sx, sy] = this.w2s((r.x || 0) - im.width * s / 2, (r.y || 0) + im.height * s);
    const z = this.renderer.view.zoom;
    g.globalAlpha = r.opacity ?? 0.5; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(im, sx, sy, im.width * s * z, im.height * s * z); g.globalAlpha = 1;
  }

  drawOverlay(dpr) {
    const c = this.ovCanvas, w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = this.ov; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rig = this.fit?.rig || this.rig, W = rig.world, P = (x, y) => this.w2s(x, y);
    if (!this.pose) return;
    // mesh of the selected attachment (deformed)
    const d = this.drawn?.find((x) => x.attachment === this.sel.attachment);
    if (d && (this.overlay.mesh || this.tool === 'mesh' || this.tool === 'weights' || this.overlay.weights)) {
      const a = this.project.attachments[d.attachment], wt = a.weights, bone = this.sel.bone;
      const wOf = (v) => { if (!wt || !bone) return a.bone === bone ? 1 : 0; const l = wt[v]; for (let j = 0; j < l.length; j += 2) if (l[j] === bone) return l[j + 1]; return 0; };
      if (this.overlay.weights || this.tool === 'weights') {
        for (let i = 0; i < d.tris.length; i += 3) {
          const vs = [d.tris[i], d.tris[i + 1], d.tris[i + 2]], k = (wOf(vs[0]) + wOf(vs[1]) + wOf(vs[2])) / 3;
          g.fillStyle = heat(k, 0.45); g.beginPath();
          vs.forEach((v, j) => { const [x, y] = P(d.pos[v * 2], d.pos[v * 2 + 1]); j ? g.lineTo(x, y) : g.moveTo(x, y); }); g.fill();
        }
      }
      g.strokeStyle = '#7fd3ffaa'; g.lineWidth = 0.7; g.beginPath();
      for (let i = 0; i < d.tris.length; i += 3) for (let j = 0; j < 3; j++) {
        const u = d.tris[i + j], v = d.tris[i + (j + 1) % 3];
        const [x0, y0] = P(d.pos[u * 2], d.pos[u * 2 + 1]), [x1, y1] = P(d.pos[v * 2], d.pos[v * 2 + 1]); g.moveTo(x0, y0); g.lineTo(x1, y1);
      }
      g.stroke();
      for (let v = 0; v < d.pos.length / 2; v++) {
        const [x, y] = P(d.pos[v * 2], d.pos[v * 2 + 1]);
        g.fillStyle = v === this.sel.vertex ? '#ffdd55' : (this.overlay.weights || this.tool === 'weights') ? heat(wOf(v), 1) : '#7fd3ff';
        g.fillRect(x - 2, y - 2, 4, 4);
      }
    }
    // bones
    if ((this.overlay.bones || this.tool !== 'select') && (!this.fit || this.fit.bones)) {
      for (let i = 0; i < rig.bones.length; i++) {
        const b = rig.bones[i]; if (b.kind === 'helper') continue;
        const m = W[i], [x0, y0] = P(m[4], m[5]), tip = affApply(m, b.length || 8, 0), [x1, y1] = P(tip[0], tip[1]);
        const selB = b.id === this.sel.bone;
        g.strokeStyle = selB ? '#ffdd55' : b.kind === 'socket' ? '#c78bffaa' : b.kind === 'prop' ? '#ff9e5eaa' : '#e8eef8aa';
        g.lineWidth = selB ? 3 : 1.4;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        g.fillStyle = g.strokeStyle; g.beginPath(); g.arc(x0, y0, selB ? 4 : 2.2, 0, 7); g.fill();
      }
    }
    if (this.overlay.pivots || this.tool === 'pivot') {
      g.strokeStyle = '#ffdd55'; g.lineWidth = 1;
      for (let i = 0; i < rig.bones.length; i++) { const m = W[i], [x, y] = P(m[4], m[5]); g.beginPath(); g.moveTo(x - 5, y); g.lineTo(x + 5, y); g.moveTo(x, y - 5); g.lineTo(x, y + 5); g.stroke(); }
    }
    // markers of whatever the prop slots show + contact debug
    if (this.overlay.markers) {
      for (const s of this.rig.slots) {
        const si = this.rig.slotIndex.get(s.id), att = this.pose.slotAttachment[si], a = att && this.project.attachments[att];
        if (!a?.markers) continue;
        for (const [n, _] of Object.entries(a.markers)) {
          const p = this.rig.markerWorld(att, n); if (!p) continue;
          const [x, y] = P(p[0], p[1]); g.fillStyle = '#ff9e5e'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
          g.font = '10px system-ui'; g.fillText(n, x + 5, y - 4);
        }
      }
    }
    if (this.overlay.contacts) {
      for (const ct of this.pose.contacts || []) {
        if (!(ct.mix > 0)) continue;
        const c = this.project.constraints.find((x) => x.id === ct.id);
        const e = this.rig.worldPoint(c.effector || c.end);
        const [x, y] = P(e[0], e[1]);
        g.strokeStyle = ct.reachable ? '#6fe39a' : '#ff6b6b'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 7, 0, 7); g.stroke();
        g.fillStyle = g.strokeStyle; g.font = '11px system-ui'; g.fillText(`${ct.id} ${ct.error.toFixed(2)}px${ct.reachable ? '' : ' UNREACHABLE'}`, x + 9, y + 4);
      }
    }
    if (this.fit?.rig) this.drawFitHandles(g);
    if (this.brushAt && this.tool === 'weights') {
      g.strokeStyle = '#fff8'; g.beginPath(); g.arc(this.brushAt[0], this.brushAt[1], this.brush.radius, 0, 7); g.stroke();
    }
    // badge + hud
    const badge = $(this.stage, '.badge');
    const layerName = this.clip?.source?.type === 'native2d' ? 'clip tracks' : 'corrections layer';
    badge.className = 'badge ' + this.mode;
    badge.textContent = this.fit ? `FITTING · ${this.fit.session.layers.filter((l) => l.include).length} layer(s) → skin "${this.fit.session.skin}" · nothing committed yet` :
      this.mode === 'setup' ? 'SETUP · editing the bind pose' : `ANIMATE · keys → ${layerName} of ${this.clip?.name ?? '—'}`;
    if (this.fit) badge.className = 'badge fitting';
    const ct = (this.pose.contacts || []).filter((x) => x.mix > 0).map((x) => `${x.id}: ${x.error.toFixed(2)}px`).join('  ');
    $(this.stage, '.hud').textContent = `${this.clip?.name ?? ''} ${this.player?.time.toFixed(3)}s  zoom ${this.renderer.view.zoom.toFixed(2)}\n` +
      `${this.sel.bone ? 'bone ' + this.sel.bone : ''}${this.sel.slot ? '  slot ' + this.sel.slot + ' [' + (this.sel.attachment || '') + ']' : ''}${ct ? '\n' + ct : ''}` +
      (this.events.length ? '\nevents: ' + this.events.slice(0, 3).join(' · ') : '');
  }

  // ---------------------------------------------------------------- 3D compare ----
  setCompare(mode) {
    this.compare = mode;
    document.body.classList.toggle('compare-inset', mode === 'inset');
    document.body.classList.toggle('compare-overlay', mode === 'overlay');
    const ok = this.v.state.ch && this.project?.source3d?.character && (this.v.state.cfg?.characterId || '') === this.project.source3d.character;
    $(this.panel, '#p2CompareNote').textContent = mode !== 'off' && !ok ? 'The loaded 3D character is not this project\'s source; comparison shows whatever 3D model is loaded.' : '';
  }
  async render3D() {
    const v = this.v, ch = v.state.ch, clip = this.clip; if (!ch || !this.project.artView) return;
    if (!this.artCam) { const { ArtCamera } = await import('./bridge3d.js'); this.artCam = new ArtCamera({ ...this.project.artView, pixelsPerMeter: this.project.artView.pixelsPerMeter }); }
    const name = this.mode === 'setup' ? null : clip?.name, t = this.player.time;
    if (name && ch.clip(name)) {
      const a = v.state.clipAction;
      if (!a || a.getClip().name !== name || !a.isScheduled()) this.hooks.playClip?.(name, t, false);
      v.state.clipAction.time = t; ch.mixer.update(0);
    } else { ch.resetPose(); }
    v.illustration?.update?.();
    const cnv = v.renderer.domElement, dpr = window.devicePixelRatio || 1, cw = Math.max(2, cnv.clientWidth), chh = Math.max(2, cnv.clientHeight);
    if (cnv.width !== Math.round(cw * dpr) || cnv.height !== Math.round(chh * dpr)) v.renderer.setSize(cw, chh, false);
    // same framing as the 2D view (inset: scaled down; overlay: identical)
    const r = this.glCanvas.getBoundingClientRect(), z = this.renderer.view.zoom, vx = this.renderer.view.x, vy = this.renderer.view.y;
    const hw = r.width / z / 2, hh = r.height / z / 2;
    const cam = this.artCam.threeCamera(vx - hw, vy - hh, vx + hw, vy + hh);
    v.renderer.render(v.scene, cam);
  }

  // ---------------------------------------------------------------- interaction ---
  bindStage() {
    const el = this.ovCanvas;
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.s2w(e), k = Math.exp(-e.deltaY * 0.0015); this.renderer.view.zoom *= k;
      const after = this.s2w(e); this.renderer.view.x += before[0] - after[0]; this.renderer.view.y += before[1] - after[1];
    }, { passive: false });
    this.stage.querySelector('.zoom').onclick = (e) => {
      const z = e.target.dataset.z; if (!z) return;
      if (z === 'fit') this.fitView(true); else this.renderer.view.zoom *= z === 'in' ? 1.25 : 0.8;
    };
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    window.addEventListener('keydown', (e) => {
      if (!this.active || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
      else if (e.key === ' ') { e.preventDefault(); this.togglePlay(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (this.tool === 'mesh' && this.sel.vertex >= 0) this.deleteSelectedVertex(); }
    });
  }

  pickBone(e) {
    const r = this.ovCanvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bd = 7;
    this.rig.bones.forEach((b, i) => {
      if (b.kind === 'helper') return;
      const m = this.rig.world[i], [x0, y0] = this.w2s(m[4], m[5]), tip = affApply(m, b.length || 8, 0), [x1, y1] = this.w2s(tip[0], tip[1]);
      const dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy, u = L ? Math.max(0, Math.min(1, ((mx - x0) * dx + (my - y0) * dy) / L)) : 0;
      const d = Math.hypot(mx - x0 - u * dx, my - y0 - u * dy);
      if (d < bd) { bd = d; best = b.id; }
    });
    return best;
  }
  pickSlot(wx, wy) {
    const alpha = this.overlay.alphaPick ? (d, i0, i1, i2, l0, l1, l2) => this.alphaAt(d.attachment, i0, i1, i2, l0, l1, l2) : null;
    return hitTest(this.drawn || [], wx, wy, alpha);
  }
  alphaAt(attId, i0, i1, i2, l0, l1, l2) {
    const a = this.project.attachments[attId], im = this.project.images[a.image];
    let al = this.alphaCache.get(a.image);
    if (al === undefined) {
      this.alphaCache.set(a.image, null);
      const img = new Image(); img.src = this.store.url(im.path);
      img.decode().then(() => {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, img.width, img.height).data, A = new Uint8Array(img.width * img.height);
        for (let i = 0; i < A.length; i++) A[i] = d[i * 4 + 3];
        this.alphaCache.set(a.image, { w: img.width, h: img.height, A });
      }).catch(() => {});
      return 1;
    }
    if (!al) return 1;
    const V = a.vertices, x = V[i0 * 2] * l0 + V[i1 * 2] * l1 + V[i2 * 2] * l2, y = V[i0 * 2 + 1] * l0 + V[i1 * 2 + 1] * l1 + V[i2 * 2 + 1] * l2;
    const X = Math.round(x), Y = Math.round(y);
    if (X < 0 || Y < 0 || X >= al.w || Y >= al.h) return 0;
    return al.A[Y * al.w + X] / 255;
  }

  /** World -> image px of an attachment at the setup pose. */
  toImage(attId, wx, wy) {
    const a = this.project.attachments[attId], rec = this.rig.attachments.get(attId), inv = affInv(rec.place);
    const [lx, ly] = affApply(inv, wx, wy), s = a.imageScale ?? 1, mir = a.transform?.mirror ? -1 : 1;
    return [lx / s * mir + a.pivot[0], a.pivot[1] - ly / s];
  }

  onDown(e) {
    this.ovCanvas.setPointerCapture(e.pointerId);
    const [wx, wy] = this.s2w(e);
    this.drag = { x: e.clientX, y: e.clientY, wx, wy, button: e.button, moved: false };
    if (e.button === 1 || e.button === 2 || e.altKey) { this.drag.pan = { ...this.renderer.view }; return; }
    if (this.fit) { this.fitDown(e, wx, wy); return; }
    const t = this.tool;
    if (t === 'select') {
      const b = this.overlay.bones ? this.pickBone(e) : null;
      if (b) this.selectBone(b);
      else { const h = this.pickSlot(wx, wy); if (h) this.selectSlot(h.slot, h.attachment); else this.selectBone(null); }
      this.drag.pan = { ...this.renderer.view }; this.drag.panOnly = true;
      return;
    }
    if (!this.sel.bone && ['rotate', 'move', 'ik', 'pivot'].includes(t)) { const b = this.pickBone(e); if (b) this.selectBone(b); else return; }
    if (t === 'rotate' || t === 'move' || t === 'ik') {
      if (this.mode === 'animate' && !this.clip) return;
      const targets = this.mode === 'setup' ? [[this.project, 'bones'], [this.project, 'attachments']] : [[this.clipRef(this.clip), this.editKey()]];
      this.begin(`${t} ${this.sel.bone}`, targets);
      const i = this.rig.boneIndex.get(this.sel.bone), m = this.rig.world[i];
      this.drag.origin = [m[4], m[5]]; this.drag.a0 = Math.atan2(wy - m[5], wx - m[4]);
      this.drag.start = clone(this.mode === 'setup' ? this.project.bones : this.clip[this.editKey()]);
    } else if (t === 'pivot' && this.mode === 'setup') {
      this.begin(`move pivot ${this.sel.bone}`, [[this.project, 'bones'], [this.project, 'attachments']]);
    } else if (t === 'mesh' && this.mode === 'setup' && this.sel.attachment) {
      const d = this.drawn.find((x) => x.attachment === this.sel.attachment); if (!d) return;
      let hit = -1, bd = 8;
      for (let v = 0; v < d.pos.length / 2; v++) { const [x, y] = this.w2s(d.pos[v * 2], d.pos[v * 2 + 1]); const dd = Math.hypot(x - (e.clientX - this.ovCanvas.getBoundingClientRect().left), y - (e.clientY - this.ovCanvas.getBoundingClientRect().top)); if (dd < bd) { bd = dd; hit = v; } }
      const a = this.project.attachments[this.sel.attachment];
      this.begin('edit mesh', [[() => this.project.attachments, a.id], [this.project, 'clips']], a.id);
      if (hit < 0) {
        const [ix, iy] = this.toImage(a.id, wx, wy), old = this.meshSnapshot(a.id);
        const mesh = { vertices: a.vertices, triangles: a.triangles, weights: a.weights };
        hit = addVertex(mesh, ix, iy);
        a.weights = mesh.weights;
        if (hit < 0) { this.pending = null; return; }
        this.rebuild(a.id); this.remapDeformKeys(a.id, old);
      }
      this.sel.vertex = hit; this.drag.vertex = hit;
    } else if (t === 'deform' && this.mode === 'animate' && this.clip && this.sel.attachment) {
      this.deformDown(e, wx, wy);
    } else if (t === 'weights' && this.mode === 'setup' && this.sel.attachment && this.sel.bone) {
      const a = this.project.attachments[this.sel.attachment];
      if (!a.weights) { a.weights = a.vertices.map(() => [a.bone, 1]).filter((_, i) => i % 2 === 0); }
      this.begin(`paint weights ${this.sel.bone}`, [[() => this.project.attachments, a.id]], a.id);
      this.paintAt(e);
    }
  }

  onMove(e) {
    const r = this.ovCanvas.getBoundingClientRect();
    this.brushAt = [e.clientX - r.left, e.clientY - r.top];
    const d = this.drag; if (!d) return;
    const [wx, wy] = this.s2w(e);
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) d.moved = true;
    if (d.pan) { if (!d.moved) return; const z = this.renderer.view.zoom; this.renderer.view.x = d.pan.x - (e.clientX - d.x) / z; this.renderer.view.y = d.pan.y + (e.clientY - d.y) / z; return; }
    if (this.fit && d.fit) { this.fitMove(e, wx, wy); return; }
    const t = this.tool, id = this.sel.bone;
    if ((t === 'rotate' || t === 'move' || t === 'ik') && this.pending) {
      const i = this.rig.boneIndex.get(id);
      if (this.mode === 'setup') this.project.bones = clone(d.start); else this.clip[this.editKey()] = clone(d.start);
      this.rebuild();
      if (t === 'rotate') {
        const da = wrapDeg((Math.atan2(wy - d.origin[1], wx - d.origin[0]) - d.a0) * 180 / Math.PI);
        if (this.mode === 'setup') { this.project.bones.find((b) => b.id === id).setup.rotation += da; this.rebuild(); }
        else { const LL = this.editLayer(); const tr = (LL.bones[id] ||= {}); tr.rotate ||= { t: [] }; setKey(tr.rotate, this.keyTime(), { v: this.layerValue(tr.rotate, 'v') + da }); this.rebuild(); }
      } else if (t === 'move') {
        const p = this.rig.parent[i], pm = p >= 0 ? this.rig.world[p] : [1, 0, 0, 1, 0, 0];
        const a = affApply(affInv(pm), d.wx, d.wy), b = affApply(affInv(pm), wx, wy), dx = b[0] - a[0], dy = b[1] - a[1];
        if (this.mode === 'setup') { const s = this.project.bones.find((x) => x.id === id).setup; s.x += dx; s.y += dy; this.rebuild(); }
        else { const LL = this.editLayer(); const tr = (LL.bones[id] ||= {}); tr.translate ||= { t: [] }; setKey(tr.translate, this.keyTime(), { x: this.layerValue(tr.translate, 'x') + dx, y: this.layerValue(tr.translate, 'y') + dy }); this.rebuild(); }
      } else this.ikDrag(id, wx, wy);
    } else if (t === 'pivot' && this.pending) this.movePivot(id, wx, wy);
    else if (t === 'mesh' && this.pending && d.vertex >= 0) {
      const a = this.project.attachments[this.sel.attachment], [ix, iy] = this.toImage(a.id, wx, wy);
      a.vertices[d.vertex * 2] = +ix.toFixed(2); a.vertices[d.vertex * 2 + 1] = +iy.toFixed(2); this.rebuild(a.id);
    } else if (t === 'weights' && this.pending) this.paintAt(e);
    else if (t === 'deform' && this.pending && d.deform) this.deformMove(wx, wy);
  }

  onUp(e) {
    const d = this.drag; this.drag = null;
    if (!d) return;
    if (this.fit && d.fit) { this.refreshFit(); return; }
    if (this.pending) this.end();
    void e;
  }

  /** Planar two-bone IK drag on the selected bone's chain (parent = lower, grandparent = upper). */
  ikDrag(id, wx, wy) {
    const b = this.rig.bone(id), lower = b.parent, upper = lower && this.rig.bone(lower).parent;
    if (!upper) return;
    const pose0 = this.evaluate();
    const before = new Float64Array(this.rig.local);
    const root = this.rig.bones[0].id, rootInv = affInv(this.rig.world[0]);
    const c = { id: 'drag', type: 'ik2', bones: [upper, lower], end: id, effector: id, target: { bone: root, point: affApply(rootInv, wx, wy) },
      bend: this.bend === 'keep' ? 'keep' : this.bend === 'pos' ? 1 : -1, keepEndRotation: true };
    this.rig.solveConstraint(c, 1, pose0.slotAttachment);
    const deltas = [upper, lower, id].map((bid) => { const i = this.rig.boneIndex.get(bid); return [bid, wrapDeg(this.rig.local[i * 5 + 2] - before[i * 5 + 2])]; });
    if (this.mode === 'setup') { for (const [bid, dd] of deltas) this.project.bones.find((x) => x.id === bid).setup.rotation += dd; }
    else {
      const LL = this.editLayer();
      for (const [bid, dd] of deltas) { const tr = (LL.bones[bid] ||= {}); tr.rotate ||= { t: [] }; setKey(tr.rotate, this.keyTime(), { v: this.layerValue(tr.rotate, 'v') + dd }); }
    }
    this.rebuild();
  }

  /** Setup: move a joint without moving the art or the child joints. */
  movePivot(id, wx, wy) {
    const rig = this.rig, i = rig.boneIndex.get(id), bone = this.project.bones.find((b) => b.id === id);
    const oldBind = rig.bindWorld.map((m) => m.slice());
    const p = rig.parent[i], pm = p >= 0 ? rig.bindWorld[p] : [1, 0, 0, 1, 0, 0];
    const lp = affApply(affInv(pm), wx, wy); bone.setup.x = +lp[0].toFixed(3); bone.setup.y = +lp[1].toFixed(3);
    const tmp = new Rig(this.project);
    // children keep their world position
    for (const c of this.project.bones.filter((b) => b.parent === id)) {
      const ci = rig.boneIndex.get(c.id), w = oldBind[ci], nl = affApply(affInv(tmp.bindWorld[i]), w[4], w[5]);
      c.setup.x = +nl[0].toFixed(3); c.setup.y = +nl[1].toFixed(3);
    }
    // attachments on this bone keep their placement
    const tmp2 = new Rig(this.project);
    for (const a of Object.values(this.project.attachments)) if (a.bone === id) {
      const T = a.transform, place = affMul(oldBind[i], affCompose(T.x, T.y, T.rotation, T.scaleX ?? 1, T.scaleY ?? 1));
      const n = affDecompose(affMul(affInv(tmp2.bindWorld[i]), place));
      T.x = +n.x.toFixed(4); T.y = +n.y.toFixed(4); T.rotation = +n.rotation.toFixed(4);
    }
    this.rebuild();
  }

  paintAt(e) {
    const a = this.project.attachments[this.sel.attachment]; if (!a) return;
    const [wx, wy] = this.s2w(e), [ix, iy] = this.toImage(a.id, wx, wy);
    const rad = this.brush.radius / this.renderer.view.zoom / (a.imageScale ?? 1);
    const mesh = { vertices: a.vertices, triangles: a.triangles, weights: a.weights };
    paintWeights(mesh, this.sel.bone, ix, iy, rad, this.brush.strength * 0.35, this.brush.mode, this.lockedVertices(a));
    a.weights = mesh.weights; a.type = 'mesh';
    this.rebuild(a.id);
  }
  lockedVertices(a) {
    const L = new Set(); if (!this.brush.locked.size || !a.weights) return L;
    a.weights.forEach((l, v) => { for (let j = 0; j < l.length; j += 2) if (this.brush.locked.has(l[j])) L.add(v); });
    return L;
  }
  deleteSelectedVertex() {
    const a = this.project.attachments[this.sel.attachment]; if (!a) return;
    const old = this.meshSnapshot(a.id);
    this.record('delete vertex', [[() => this.project.attachments, a.id], [this.project, 'clips']], () => {
      const mesh = { vertices: a.vertices, triangles: a.triangles, weights: a.weights };
      if (deleteVertex(mesh, this.sel.vertex) !== false) { a.vertices = mesh.vertices; a.triangles = mesh.triangles; a.weights = mesh.weights; }
      this.rebuild(a.id); this.remapDeformKeys(a.id, old);
    }, a.id);
    this.sel.vertex = -1; this.rebuild(a.id);
  }
  // ---- deformation keys (corrections layer of bridged clips; tracks of native clips)
  deformDown(e, wx, wy) {
    const id = this.sel.attachment, d = this.drawn.find((x) => x.attachment === id); if (!d) return;
    const rec = this.rig.attachments.get(id), clip = this.clip, L = this.editLayer(clip), nv = rec.nv;
    const tr = L.deform?.[id], smp = tr && sampleDeform(tr, this.player.time, nv * 2);
    if (smp?.bad) { $(this.panel, '#p2Report').textContent = `${id}: deformation key(s) ${smp.bad.map((k) => `#${k} (${(tr.v[k]?.length ?? 0) / 2} vertices)`).join(', ')} do not fit this ${nv}-vertex mesh; fix the project before keying (see validation)`; return; }
    const keyed = smp?.v;
    const base = keyed || new Array(nv * 2).fill(0);
    const r = this.ovCanvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, R = this.brush.radius;
    const fall = new Float64Array(nv), inv = [];
    for (let v = 0; v < nv; v++) {
      const [x, y] = this.w2s(d.pos[v * 2], d.pos[v * 2 + 1]), dist = Math.hypot(x - mx, y - my);
      fall[v] = dist < R ? 0.5 + 0.5 * Math.cos(Math.PI * dist / R) : 0;
      // linear part of this vertex's blended skinning matrix → world deltas become bind-space offsets
      let a = 0, b = 0, c = 0, dd = 0;
      for (let k = 0; k < 4; k++) { const w = rec.ww[v * 4 + k]; if (!w) continue; const m = (rec.def.followScale === false && this.rig.skinMatsU ? this.rig.skinMatsU : this.rig.skinMats)[rec.wb[v * 4 + k]]; a += w * m[0]; b += w * m[1]; c += w * m[2]; dd += w * m[3]; }
      const det = a * dd - b * c || 1; inv.push([dd / det, -b / det, -c / det, a / det]);
    }
    this.begin(`deform ${id} @${this.keyTime().toFixed(2)}s`, [[this.clipRef(clip), this.editKey()]]);
    this.drag.deform = { id, base: Array.from(base), fall, inv, nv };
  }
  deformMove(wx, wy) {
    const D = this.drag.deform, dx = wx - this.drag.wx, dy = wy - this.drag.wy, out = D.base.slice();
    for (let v = 0; v < D.nv; v++) { const f = D.fall[v]; if (!f) continue; const m = D.inv[v]; out[v * 2] = +(D.base[v * 2] + f * (m[0] * dx + m[2] * dy)).toFixed(3); out[v * 2 + 1] = +(D.base[v * 2 + 1] + f * (m[1] * dx + m[3] * dy)).toFixed(3); }
    const L = this.editLayer(), tr = ((L.deform ||= {})[D.id] ||= { t: [], v: [] });
    setKey(tr, this.keyTime(), { v: out });
  }
  /** Bind-space vertices + triangles of an attachment before a topology edit. */
  meshSnapshot(attId) { const r = this.rig.attachments.get(attId); return { bind: Float64Array.from(r.bind), tris: this.project.attachments[attId].triangles.slice() }; }
  /**
   * Keep deformation keys valid after the mesh topology changed: every key of this attachment, in every
   * clip and layer, is resampled onto the new vertices (barycentric in the old mesh). Never silently
   * leaves keys with the wrong vertex count.
   */
  remapDeformKeys(attId, old) {
    return remapDeformKeys(this.project, attId, meshSamples(old.bind, old.tris, this.rig.attachments.get(attId).bind));
  }

  selectBone(id) { this.sel.bone = id; if (id) this.sel.vertex = -1; this.refreshPanel(); }
  selectSlot(slot, att) {
    this.sel.slot = slot; this.sel.attachment = att; this.sel.vertex = -1;
    const a = att && this.project.attachments[att]; if (a && !this.sel.bone) this.sel.bone = a.bone;
    if (a) this.sel.bone = a.bone;
    this.refreshPanel();
  }

  togglePlay() { this.playing = !this.playing; if (this.playing) { if (this.mode === 'setup') this.setMode('animate'); this.player.resume(); } else this.player.pause(); this.refreshPanel(); }
  setMode(m) { this.mode = m; if (m === 'setup') { this.playing = false; this.player.pause(); } this.refreshPanel(); }

  // ---------------------------------------------------------------- panel ---------
  buildPanel() {
    const p = this.panel;
    p.innerHTML = `
<div class="sec"><h3>2D project</h3>
  <select id="p2Project"></select>
  <div class="grid2" style="margin-top:6px"><select id="p2Skin" title="Skin"></select><select id="p2View" disabled title="Art view"><option>front34 view</option></select></div>
  <div class="row mode"><button id="p2Setup">Setup</button><button id="p2Animate" class="on">Animate</button><button id="p2Undo" title="Ctrl+Z">Undo</button><button id="p2Redo" title="Ctrl+Shift+Z">Redo</button></div>
  <div class="small" id="p2History"></div>
</div>
<div class="sec" id="p2FitSec"><h3>Fit artwork <span class="small">(painted PNG layers → skin)</span></h3>
  <label class="small">Painted layers: PNGs + layers.json, or a .zip <input type="file" id="p2FitOpen" accept=".png,.json,.zip" multiple></label>
  <label class="small">Re-fit re-painted PNGs with the saved template <input type="file" id="p2FitTemplate" accept=".png,.zip" multiple></label>
  <div class="row"><input id="p2FitSkin" value="painted" style="flex:1" title="skin that receives the painted pieces"><button id="p2PaintPack" title="Per-piece canvases, separate guide layers, layers.json, clean preview">Paint-template pack</button></div>
  <div id="p2FitPanel"></div>
</div>
<div class="sec"><h3>Animation</h3>
  <select id="p2Clip"></select>
  <div class="row"><button id="p2Play">Play</button><button id="p2Pause">Pause</button><label><input type="checkbox" id="p2Loop" checked> loop</label><span class="small" id="p2Clock"></span></div>
  <label>Time <input type="range" id="p2Time" min="0" max="1" step="0.001" value="0"></label>
  <label>Speed <input type="range" id="p2Speed" min="0.1" max="2" step="0.05" value="1"></label>
  <canvas class="timeline" id="p2Timeline"></canvas>
  <div class="grid2"><label class="small"><input type="checkbox" id="p2Onion"> onion skin ±<input type="number" id="p2OnionN" value="2" min="1" max="6" style="width:42px"> fr ×<input type="number" id="p2OnionStep" value="3" min="1" max="15" style="width:42px"></label>
  <label class="small"><input type="checkbox" id="p2CorrOn" checked> show corrections</label></div>
  <div class="grid3"><select id="p2Ease" title="Easing of the selected bone's correction keys from the key at the playhead"><option value="linear">ease: linear</option><option value="smooth">ease: smooth</option><option value="in">ease: in</option><option value="out">ease: out</option><option value="step">ease: step (crisp)</option></select>
  <button id="p2CorrToggle" title="Disable/enable (not delete) the selected bone's correction">Disable bone corr.</button><button id="p2CorrDeform" title="Disable/enable the selected attachment's deformation correction">Toggle deform corr.</button></div>
  <div class="row"><button id="p2KeyDel" title="Remove the selected bone's key at this time from the edit layer">Delete key</button><button id="p2KeyClear" title="Remove every key of the selected bone from the edit layer">Clear bone</button><button id="p2NewClip">New 2D clip</button></div>
  <div class="row"><input id="p2EventName" placeholder="event name" style="flex:1"><button id="p2EventAdd">Add event</button></div>
  <div id="p2Status" class="notes"></div>
</div>
<div class="sec"><h3>Tools</h3>
  <div class="grid3 tools"><button data-tool="select" class="on">Select</button><button data-tool="rotate">Rotate</button><button data-tool="move">Move</button>
  <button data-tool="ik">IK drag</button><button data-tool="pivot">Pivot</button><button data-tool="mesh">Mesh</button><button data-tool="weights">Weights</button><button data-tool="deform" title="Animate: pull mesh vertices into a deformation key (corrections layer)">Deform</button>
  <button id="p2Bend" title="Elbow/knee bend used by IK drag">Bend: keep</button><button id="p2Fit">Fit view</button></div>
  <div class="small">Drag empty space to pan (right/middle drag or Alt anywhere), wheel to zoom. Pivot, Mesh and Weights work in Setup; Deform keys a mesh correction in Animate (brush radius from Mesh & weights).</div>
</div>
<div class="sec"><h3>Selection</h3><div id="p2Inspect" class="small">Click a bone or a layer.</div></div>
<div class="sec"><h3>Mesh & weights</h3>
  <div class="row"><button id="p2AutoMesh">Auto mesh</button><button id="p2AutoWeights">Auto weights</button><button id="p2Smooth">Smooth</button><button id="p2Normalize">Normalize</button></div>
  <div class="grid3"><select id="p2BrushMode"><option value="add">add</option><option value="subtract">subtract</option><option value="replace">replace</option><option value="smooth">smooth</option></select>
  <label class="small">r <input type="number" id="p2BrushR" value="24" min="2" max="200"></label><label class="small">str <input type="number" id="p2BrushS" value="0.25" step="0.05" min="0.01" max="1"></label></div>
  <label><input type="checkbox" id="p2Lock"> lock selected bone's weights</label>
  <label class="small">Replace image <input type="file" id="p2Replace" accept="image/png"></label>
</div>
<div class="sec"><h3>Layers <span class="small">(front at top · drag to reorder)</span></h3>
  <div class="layers" id="p2Layers"></div>
  <div class="row"><button id="p2Isolate">Isolate selected</button><button id="p2ShowAll">Show all</button><button id="p2OrderClear" title="Remove the draw-order correction key at this time">Clear order key</button></div>
</div>
<div class="sec"><h3>Hands</h3><div id="p2Hands"></div></div>
<div class="sec"><h3>Props & contacts</h3><div id="p2Props"></div></div>
<div class="sec"><h3>Poses</h3>
  <div class="row"><input id="p2PoseName" placeholder="pose name" style="flex:1"><button id="p2PoseCapture">Capture pose</button></div>
  <div id="p2Poses"></div>
  <div class="row"><button id="p2Reset">Reset to setup pose</button></div>
</div>
<div class="sec"><h3>Visual QA <span class="small">(heuristics, not verdicts)</span></h3>
  <div class="row"><button id="p2QaRun">Analyse this clip</button><button id="p2QaSheet">Contact sheet</button></div>
  <div class="grid2"><select id="p2QaReview"><option value="unreviewed">review: unreviewed</option><option value="approved">review: approved</option><option value="needs-work">review: needs work</option></select><input id="p2QaNote" placeholder="review note"></div>
  <div id="p2QaStatus" class="small"></div>
  <div id="p2QaFlags" class="report" style="max-height:200px"></div>
</div>
<div class="sec"><h3>Overlays & compare</h3>
  <div class="grid2">${['bones', 'mesh', 'weights', 'pivots', 'markers', 'contacts', 'alphaPick'].map((k) => `<label><input type="checkbox" data-ov="${k}" ${this.overlay[k] ? 'checked' : ''}> ${k === 'alphaPick' ? 'pixel picking' : k}</label>`).join('')}</div>
  <label>3D compare <select id="p2Compare"><option value="off">off</option><option value="inset">inset (same time)</option><option value="overlay">overlay 45%</option></select></label>
  <div class="small" id="p2CompareNote"></div>
  <label><input type="checkbox" id="p2Ref"> reference image (editor only)</label>
  <div class="grid2"><label class="small">opacity <input type="number" id="p2RefO" step="0.05" min="0" max="1"></label><label class="small">scale <input type="number" id="p2RefS" step="0.01"></label>
  <label class="small">x <input type="number" id="p2RefX" step="1"></label><label class="small">y <input type="number" id="p2RefY" step="1"></label></div>
</div>
<div class="sec"><h3>Open · import · save · export</h3>
  <label class="small">Open project (.zip) <input type="file" id="p2Open" accept=".zip"></label>
  <label class="small">Import layered PNG (layers.json + PNGs, or .zip) <input type="file" id="p2Import" accept=".png,.json,.zip" multiple></label>
  <div class="row"><button id="p2Save">Save project ZIP</button><button id="p2Reload">Reopen saved copy</button></div>
  <div class="row"><button id="p2Runtime">Export runtime package</button><button id="p2Frame">PNG frame</button></div>
  <div class="row"><button id="p2Sheets">Sprite sheets (this clip)</button><button id="p2SheetsAll">Sprite sheets (all)</button></div>
  <div class="report" id="p2Report"></div>
</div>`;
    const on = (id, ev, fn) => $(p, '#' + id).addEventListener(ev, fn);
    on('p2Project', 'change', (e) => this.openURL(this.base + e.target.value));
    on('p2Skin', 'change', (e) => { this.rig.setSkin(e.target.value); });
    on('p2Setup', 'click', () => this.setMode('setup'));
    on('p2Animate', 'click', () => this.setMode('animate'));
    on('p2Undo', 'click', () => this.undo()); on('p2Redo', 'click', () => this.redo());
    on('p2Clip', 'change', (e) => this.selectClip(e.target.value));
    on('p2Play', 'click', () => { if (!this.playing) this.togglePlay(); });
    on('p2Pause', 'click', () => { if (this.playing) this.togglePlay(); });
    on('p2Loop', 'change', (e) => { if (this.player) this.player.loop = e.target.checked; });
    on('p2Time', 'input', (e) => { this.player.seek(+e.target.value); if (this.mode === 'setup') this.setMode('animate'); });
    on('p2Fit', 'click', () => this.fitView(true));
    on('p2Bend', 'click', (e) => { this.bend = { keep: 'pos', pos: 'neg', neg: 'keep' }[this.bend]; e.target.textContent = `Bend: ${this.bend === 'pos' ? '+1' : this.bend === 'neg' ? '−1' : 'keep'}`; });
    p.querySelector('.tools').addEventListener('click', (e) => { const t = e.target.dataset.tool; if (!t) return; this.tool = t; p.querySelectorAll('.tools button[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t)); });
    p.querySelectorAll('[data-ov]').forEach((c) => c.addEventListener('change', (e) => { this.overlay[e.target.dataset.ov] = e.target.checked; }));
    on('p2Compare', 'change', (e) => this.setCompare(e.target.value));
    on('p2KeyDel', 'click', () => this.deleteBoneKey());
    on('p2QaRun', 'click', () => this.runQA());
    on('p2QaSheet', 'click', async () => { const png = await this.qaSheet(); download(png, `${this.project.characterId}_${this.clip?.name}_sheet.png`, 'image/png'); });
    on('p2QaReview', 'change', (e) => this.setReview(e.target.value, $(p, '#p2QaNote').value));
    on('p2QaNote', 'change', (e) => this.setReview($(p, '#p2QaReview').value, e.target.value));
    on('p2Onion', 'change', (e) => { this.onion.on = e.target.checked; });
    on('p2OnionN', 'change', (e) => { this.onion.n = +e.target.value || 2; });
    on('p2OnionStep', 'change', (e) => { this.onion.step = +e.target.value || 3; });
    on('p2CorrOn', 'change', (e) => { this.previewCorrections = e.target.checked; });
    on('p2Ease', 'change', (e) => this.setCorrectionEase(e.target.value));
    on('p2CorrToggle', 'click', () => this.toggleCorrection('bone'));
    on('p2CorrDeform', 'click', () => this.toggleCorrection('deform'));
    on('p2KeyClear', 'click', () => this.clearBone());
    on('p2NewClip', 'click', () => this.newClip());
    on('p2EventAdd', 'click', () => this.addEvent($(p, '#p2EventName').value.trim()));
    on('p2Timeline', 'pointerdown', (e) => { const r = e.target.getBoundingClientRect(); this.player.seek((e.clientX - r.left) / r.width * this.player.duration); if (this.mode === 'setup') this.setMode('animate'); });
    on('p2AutoMesh', 'click', () => this.autoMesh());
    on('p2AutoWeights', 'click', () => this.withAttachment('auto weights', (a) => autoWeightAttachment(this.project, a.id)));
    on('p2Smooth', 'click', () => this.withAttachment('smooth weights', (a) => { if (a.weights) a.weights = smoothWeights(a.weights, a.triangles, { iterations: 2, amount: 0.5, locked: this.lockedVertices(a) }); }));
    on('p2Normalize', 'click', () => this.withAttachment('normalize weights', (a) => { if (a.weights) a.weights = normalizeWeights(a.weights, this.lockedVertices(a)); }));
    on('p2BrushMode', 'change', (e) => { this.brush.mode = e.target.value; });
    on('p2BrushR', 'change', (e) => { this.brush.radius = +e.target.value; });
    on('p2BrushS', 'change', (e) => { this.brush.strength = +e.target.value; });
    on('p2Lock', 'change', (e) => { if (!this.sel.bone) return; e.target.checked ? this.brush.locked.add(this.sel.bone) : this.brush.locked.delete(this.sel.bone); });
    on('p2Replace', 'change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { await this.replaceSelected(new Uint8Array(await f.arrayBuffer())); } catch (err) { $(p, '#p2Report').textContent = `replace failed, nothing changed: ${err.message}`; } });
    on('p2Isolate', 'click', () => { this.isolate = this.sel.slot ? new Set([this.sel.slot]) : null; });
    on('p2ShowAll', 'click', () => { this.isolate = null; this.hidden.clear(); this.refreshPanel(); });
    on('p2OrderClear', 'click', () => this.clearOrderKey());
    on('p2PoseCapture', 'click', () => this.capturePose($(p, '#p2PoseName').value.trim() || `pose_${(this.project.poses || []).length + 1}`));
    on('p2Reset', 'click', () => { this.preview.pose = null; this.preview.hands = { L: { ...HAND_PRESETS.open, curl: 0 }, R: { ...HAND_PRESETS.open, curl: 0 } }; this.preview.props = {}; this.refreshPanel(); });
    on('p2Ref', 'change', (e) => { const r = this.project.editor.reference; if (r) r.visible = e.target.checked; });
    for (const k of ['O', 'S', 'X', 'Y']) on('p2Ref' + k, 'input', (e) => { const r = this.project.editor.reference; if (!r) return; r[{ O: 'opacity', S: 'scale', X: 'x', Y: 'y' }[k]] = +e.target.value; });
    on('p2Open', 'change', async (e) => { const f = e.target.files[0]; if (f) await this.openZip(new Uint8Array(await f.arrayBuffer()), f.name); e.target.value = ''; });
    on('p2Import', 'change', async (e) => { const m = new Map(); for (const f of e.target.files) m.set(f.name, new Uint8Array(await f.arrayBuffer())); e.target.value = ''; try { await this.importLayered(m); } catch { /* reported in the panel; project unchanged */ } });
    on('p2Save', 'click', () => download(saveProjectZip(this.project, this.store), `${this.project.characterId}.character2d.zip`, 'application/zip'));
    on('p2Reload', 'click', () => this.reopenSaved());
    on('p2Runtime', 'click', () => this.exportRuntime());
    on('p2Frame', 'click', async () => download(await exportFramePNG(this.project, this.store, this.rig, this.pose, { scale: 1 }), `${this.project.characterId}_${this.clip?.name ?? 'setup'}_${this.player.time.toFixed(2)}.png`, 'image/png'));
    on('p2Sheets', 'click', () => this.exportSheets([this.clip.name]));
    on('p2SheetsAll', 'click', () => this.exportSheets(null));
    this.bindLayersDnD();
    on('p2FitOpen', 'change', async (e) => { const m = new Map(); for (const f of e.target.files) m.set(f.name, new Uint8Array(await f.arrayBuffer())); e.target.value = ''; try { await this.startFit(m); } catch (err) { $(p, '#p2Report').textContent = `fitting: ${err.message}`; } });
    on('p2FitTemplate', 'change', async (e) => { const m = new Map(); for (const f of e.target.files) m.set(f.name, new Uint8Array(await f.arrayBuffer())); e.target.value = ''; try { await this.startFit(m, { useTemplate: true }); } catch (err) { $(p, '#p2Report').textContent = `fitting: ${err.message}`; } });
    on('p2PaintPack', 'click', async () => { const r = await this.paintPack(); download(r.zip, `${this.project.characterId}.paint-template.zip`, 'application/zip'); });
  }

  syncRefInputs() {
    const r = this.project.editor?.reference, p = this.panel;
    $(p, '#p2Ref').disabled = !r; $(p, '#p2Ref').checked = !!r?.visible;
    if (r) { $(p, '#p2RefO').value = r.opacity ?? 0.5; $(p, '#p2RefS').value = (+r.scale).toFixed(3); $(p, '#p2RefX').value = Math.round(r.x || 0); $(p, '#p2RefY').value = Math.round(r.y || 0); }
  }

  syncTimeUI() {
    const p = this.panel, t = this.player?.time ?? 0;
    if (document.activeElement !== $(p, '#p2Time')) $(p, '#p2Time').value = t;
    $(p, '#p2Clock').textContent = `${t.toFixed(2)} / ${(this.player?.duration ?? 0).toFixed(2)} s`;
    this.drawTimeline();
  }

  drawTimeline() {
    const c = $(this.panel, '#p2Timeline'), dpr = window.devicePixelRatio || 1, w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (!w) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); const W = c.clientWidth, H = c.clientHeight;
    g.clearRect(0, 0, W, H);
    const clip = this.clip; if (!clip) return;
    const X = (t) => 4 + (W - 8) * t / clip.duration;
    const rows = [['baked', clip.tracks, '#8894a8', 10], [clip.source?.type === 'native2d' ? 'tracks' : 'corrections', clip.corrections, '#cfb078', 26]];
    g.font = '9px system-ui';
    for (const [label, L, col, y] of rows) {
      g.fillStyle = '#ffffff55'; g.fillText(label, 4, y - 2);
      const tr = L?.bones?.[this.sel.bone];
      if (tr) for (const f of ['rotate', 'translate', 'scale']) for (const t of tr[f]?.t || []) { g.fillStyle = col; g.fillRect(X(t) - 1, y, 2, 7); }
    }
    g.fillStyle = '#ffffff55'; g.fillText('order · events', 4, 44);
    for (const t of clip.tracks?.drawOrder?.t || []) { g.fillStyle = '#6aa7ff'; g.fillRect(X(t) - 1, 46, 2, 6); }
    for (const t of clip.corrections?.drawOrder?.t || []) { g.fillStyle = '#ff9e5e'; g.fillRect(X(t) - 1, 46, 2, 6); }
    for (const L of [clip.tracks, clip.corrections]) for (const tr of Object.values(L?.handSets || {})) for (const t of tr.t || []) { g.fillStyle = L === clip.tracks ? '#b48cff' : '#ff6fd8'; g.fillRect(X(t) - 1, 38, 2, 5); }
    const dtr = this.sel.attachment && clip.corrections?.deform?.[this.sel.attachment];
    for (const t of dtr?.t || []) { g.fillStyle = dtr.disabled ? '#666' : '#3fe0d0'; g.beginPath(); g.arc(X(t), 31, 2.5, 0, 7); g.fill(); }
    for (const e of [...(clip.tracks?.events || []), ...(clip.corrections?.events || [])]) { g.fillStyle = '#6fe39a'; g.beginPath(); g.moveTo(X(e.t), 53); g.lineTo(X(e.t) - 3, 60); g.lineTo(X(e.t) + 3, 60); g.fill(); }
    g.fillStyle = '#ff5b5b'; g.fillRect(X(this.player.time) - 0.5, 0, 1.5, H);
  }

  refreshPanel() {
    if (!this.project) return;
    const p = this.panel;
    $(p, '#p2Setup').classList.toggle('on', this.mode === 'setup'); $(p, '#p2Animate').classList.toggle('on', this.mode === 'animate');
    $(p, '#p2Undo').disabled = !this.undoStack.length; $(p, '#p2Redo').disabled = !this.redoStack.length;
    $(p, '#p2History').textContent = this.undoStack.length ? `last edit: ${this.undoStack[this.undoStack.length - 1].label}` : '';
    $(p, '#p2Play').classList.toggle('on', !!this.playing);
    const st = this.clip?.status;
    $(p, '#p2Status').innerHTML = st ? `<div class="status-${st.level}">bridge status: ${st.level}</div>` + (st.notes || []).map((n) => `<div>• ${esc(n)}</div>`).join('') : '';
    this.syncRefInputs();
    this.renderInspector(); this.renderLayers(); this.renderHands(); this.renderProps(); this.renderPoses();
  }

  renderInspector() {
    const box = $(this.panel, '#p2Inspect'), b = this.sel.bone && this.project.bones.find((x) => x.id === this.sel.bone);
    let html = '';
    if (b) {
      const tr = this.clip && this.editLayer()?.bones?.[b.id];
      html += `<div><b>${esc(b.id)}</b> <span class="small">${b.kind}${b.parent ? ' · parent ' + esc(b.parent) : ''}${b.source3d ? ' · 3D axis ' + b.source3d.axis : ''}</span></div>`;
      if (this.mode === 'setup') html += `<div class="grid3"><label class="small">x <input type="number" data-bs="x" value="${b.setup.x}" step="0.5"></label><label class="small">y <input type="number" data-bs="y" value="${b.setup.y}" step="0.5"></label><label class="small">rot <input type="number" data-bs="rotation" value="${(+b.setup.rotation).toFixed(2)}" step="1"></label></div>`;
      else if (this.clip) html += `<div class="grid3"><label class="small">Δrot <input type="number" data-bk="rotate" value="${this.layerValue(tr?.rotate, 'v').toFixed(2)}" step="1"></label><label class="small">Δx <input type="number" data-bk="x" value="${this.layerValue(tr?.translate, 'x').toFixed(2)}" step="0.5"></label><label class="small">Δy <input type="number" data-bk="y" value="${this.layerValue(tr?.translate, 'y').toFixed(2)}" step="0.5"></label></div>`;
    }
    const s = this.sel.slot && this.project.slots.find((x) => x.id === this.sel.slot);
    if (s) {
      const atts = Object.values(this.project.attachments).filter((a) => a.slot === s.id);
      const a = this.sel.attachment && this.project.attachments[this.sel.attachment];
      html += `<div style="margin-top:6px"><b>slot ${esc(s.id)}</b> <span class="small">bone ${esc(s.bone)}</span></div>
        <label class="small">attachment <select data-sa>${['', ...atts.map((x) => x.id)].map((id) => `<option value="${esc(id)}" ${id === (this.pose?.slotAttachment?.[this.rig.slotIndex.get(s.id)] || '') ? 'selected' : ''}>${esc(id || '(none)')}</option>`).join('')}</select></label>`;
      if (a) html += `<div class="small">${a.weights ? 'weighted mesh' : 'rigid mesh'} · ${a.vertices.length / 2} vertices · ${a.triangles.length / 3} triangles · image ${esc(a.image)} (${this.project.images[a.image]?.w}×${this.project.images[a.image]?.h})<br>${esc(a.source?.note || '')}</div>
        <div class="grid3"><label class="small">opacity <input type="number" data-ap="opacity" value="${a.opacity ?? 1}" step="0.05" min="0" max="1"></label>
        <label class="small">blend <select data-ap="blend">${['normal', 'additive', 'multiply', 'screen'].map((m) => `<option ${m === (a.blend || 'normal') ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="small">tint <input type="color" data-ap="tint" value="#${(a.tint || [1, 1, 1]).map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}"></label></div>
        <div class="grid3"><label class="small">x <input type="number" data-at="x" value="${a.transform.x}" step="0.5"></label><label class="small">y <input type="number" data-at="y" value="${a.transform.y}" step="0.5"></label><label class="small">rot <input type="number" data-at="rotation" value="${a.transform.rotation}" step="1"></label>
        <label class="small">pivot x <input type="number" data-pv="0" value="${a.pivot[0]}" step="1"></label><label class="small">pivot y <input type="number" data-pv="1" value="${a.pivot[1]}" step="1"></label><label class="small"><input type="checkbox" data-at="mirror" ${a.transform.mirror ? 'checked' : ''}> mirror</label></div>`;
    }
    box.innerHTML = html || 'Click a bone or a layer.';
    box.querySelectorAll('[data-bs]').forEach((i) => i.onchange = () => { this.record(`setup ${b.id}.${i.dataset.bs}`, [[this.project, 'bones']], () => { b.setup[i.dataset.bs] = +i.value; }); this.rebuild(); });
    box.querySelectorAll('[data-bk]').forEach((i) => i.onchange = () => {
      const f = i.dataset.bk, tr = this.editLayer()?.bones?.[b.id];
      if (f === 'rotate') { const cur = this.layerValue(tr?.rotate, 'v'); this.keyBone(b.id, 'rotate', () => ({ v: +(cur + wrapDeg(+i.value - cur)).toFixed(3) })); }
      else { const x = f === 'x' ? +i.value : this.layerValue(tr?.translate, 'x'), y = f === 'y' ? +i.value : this.layerValue(tr?.translate, 'y'); this.keyBone(b.id, 'translate', () => ({ x, y })); }
    });
    const sa = box.querySelector('[data-sa]'); if (sa) sa.onchange = () => this.setSlotAttachment(s.id, sa.value || null);
    const a = this.sel.attachment && this.project.attachments[this.sel.attachment];
    box.querySelectorAll('[data-ap]').forEach((i) => i.onchange = () => { this.record(`${i.dataset.ap} ${a.id}`, [[() => this.project.attachments, a.id]], () => { a[i.dataset.ap] = i.dataset.ap === 'tint' ? [1, 3, 5].map((k) => parseInt(i.value.slice(k, k + 2), 16) / 255) : i.dataset.ap === 'opacity' ? +i.value : i.value; }, a.id); });
    box.querySelectorAll('[data-at]').forEach((i) => i.onchange = () => { this.record(`transform ${a.id}`, [[() => this.project.attachments, a.id]], () => { a.transform[i.dataset.at] = i.type === 'checkbox' ? i.checked : +i.value; }, a.id); this.rebuild(a.id); });
    box.querySelectorAll('[data-pv]').forEach((i) => i.onchange = () => { this.record(`pivot ${a.id}`, [[() => this.project.attachments, a.id]], () => this.setAttachmentPivot(a, +i.dataset.pv, +i.value), a.id); this.rebuild(a.id); });
  }

  /** Move an attachment's pivot (image px) while keeping the art where it is. */
  setAttachmentPivot(a, axis, value) {
    const T = a.transform, s = a.imageScale ?? 1, mir = T.mirror ? -1 : 1;
    const M = affCompose(T.x, T.y, T.rotation, T.scaleX ?? 1, T.scaleY ?? 1);
    const np = a.pivot.slice(); np[axis] = value;
    const d = [(np[0] - a.pivot[0]) * s * mir, (a.pivot[1] - np[1]) * s];     // new pivot in old attachment-local space
    const o = affApply(M, d[0], d[1]); T.x = +o[0].toFixed(4); T.y = +o[1].toFixed(4); a.pivot = np;
  }

  setSlotAttachment(slot, att) {
    if (this.mode === 'setup' || !this.clip) {
      const s = this.project.slots.find((x) => x.id === slot);
      this.record(`setup attachment ${slot}`, [[this.project, 'slots']], () => { s.attachment = att; });
    } else {
      const clip = this.clip;
      this.record(`key attachment ${slot}`, [[this.clipRef(clip), this.editKey()]], () => { const L = this.editLayer(clip); const tr = (L.slots[slot] ||= {}); tr.attachment ||= { t: [], v: [] }; setKey(tr.attachment, this.keyTime(), { v: att }); });
    }
    this.rebuild(); this.refreshPanel();
  }

  currentOrder() { const pose = this.evaluate(); return pose.drawOrder.map((i) => this.rig.slots[i].id); }
  renderLayers() {
    const box = $(this.panel, '#p2Layers'), order = this.currentOrder().slice().reverse();
    box.innerHTML = order.map((id) => {
      const si = this.rig.slotIndex.get(id), att = this.pose?.slotAttachment?.[si];
      return `<div class="layer ${id === this.sel.slot ? 'sel' : ''}" draggable="true" data-slot="${esc(id)}"><span class="eye" data-eye="${esc(id)}">${this.hidden.has(id) ? '◌' : '●'}</span><span class="n">${esc(id)}</span><span class="a">${esc((att || '—').split('.').pop())}</span></div>`;
    }).join('');
  }
  bindLayersDnD() {
    const box = $(this.panel, '#p2Layers');
    box.addEventListener('click', (e) => {
      const eye = e.target.dataset.eye; if (eye) { this.hidden.has(eye) ? this.hidden.delete(eye) : this.hidden.add(eye); this.renderLayers(); return; }
      const row = e.target.closest('.layer'); if (row) { const si = this.rig.slotIndex.get(row.dataset.slot); this.selectSlot(row.dataset.slot, this.pose?.slotAttachment?.[si] || null); }
    });
    box.addEventListener('dragstart', (e) => { this.dragSlot = e.target.closest('.layer')?.dataset.slot; e.dataTransfer.effectAllowed = 'move'; });
    box.addEventListener('dragover', (e) => { e.preventDefault(); box.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop')); e.target.closest('.layer')?.classList.add('drop'); });
    box.addEventListener('drop', (e) => { e.preventDefault(); const to = e.target.closest('.layer')?.dataset.slot; if (this.dragSlot && to) this.moveLayer(this.dragSlot, to); });
  }
  /** Move slot `id` so it is drawn directly in front of... the row it was dropped on (list is front-first). */
  moveLayer(id, onto) {
    if (id === onto) return;
    const order = this.currentOrder().filter((x) => x !== id);
    order.splice(order.indexOf(onto) + 1, 0, id);                  // one step in front of the drop target
    this.applyOrder(order, `reorder ${id}`);
  }
  applyOrder(order, label) {
    if (this.mode === 'setup' || !this.clip) {
      this.record(label + ' (setup)', [[this.project, 'slots']], () => { this.project.slots = order.map((sid) => this.project.slots.find((s) => s.id === sid)); });
    } else {
      const clip = this.clip;
      this.record(label + ` @${this.keyTime().toFixed(2)}s`, [[this.clipRef(clip), this.editKey()]], () => { const L = this.editLayer(clip); setKey(L.drawOrder, this.keyTime(), { v: order }); });
    }
    this.rebuild(); this.refreshPanel();
  }
  clearOrderKey() {
    const clip = this.clip; if (!clip) return;
    this.record('clear order key', [[this.clipRef(clip), this.editKey()]], () => deleteKey(this.editLayer(clip).drawOrder, this.keyTime()));
    this.rebuild(); this.refreshPanel();
  }

  handValue(side) {
    if (this.mode === 'setup' || !this.clip) return this.preview.hands[side];
    const tr = this.editLayer()?.hands?.[side], o = {};
    for (const f of ['curl', ...FINGERS]) o[f] = tr ? (sampleField(tr, f, this.player.time) ?? 0) : 0;
    return o;
  }
  setHand(side, values, label) {
    if (this.mode === 'setup' || !this.clip) { Object.assign(this.preview.hands[side], values); this.renderHands(); return; }
    const clip = this.clip, cur = this.handValue(side);
    this.record(label || `hand ${side}`, [[this.clipRef(clip), this.editKey()]], () => { const L = this.editLayer(clip); const tr = (L.hands[side] ||= { t: [] }); setKey(tr, this.keyTime(), { ...cur, ...values }); });
    this.rebuild(); this.renderHands();
  }
  renderHands() {
    const box = $(this.panel, '#p2Hands'); if (!this.project.hands) { box.textContent = 'No hand controls in this project.'; return; }
    const captures = (side) => [...new Set(Object.values(this.project.attachments).filter((a) => a.slot === `hand_${side}`).map((a) => a.id.split('.').pop()))];
    box.innerHTML = ['L', 'R'].filter((s) => this.project.hands[s]).map((s) => {
      const v = this.handValue(s);
      return `<div style="margin-bottom:8px"><b>${s === 'L' ? 'Left' : 'Right'} hand</b> <span class="small">${this.mode === 'setup' ? 'preview' : 'keys at ' + this.keyTime().toFixed(2) + 's'}</span>
      <label class="small">whole hand <input type="range" data-h="${s}" data-f="curl" min="-0.25" max="1.2" step="0.01" value="${v.curl}"></label>
      <div class="grid2">${FINGERS.map((f) => `<label class="small">${f} <input type="range" data-h="${s}" data-f="${f}" min="-1" max="1" step="0.01" value="${v[f]}"></label>`).join('')}</div>
      <div class="row">${Object.keys(HAND_PRESETS).map((k) => `<button data-hp="${s}" data-p="${k}">${k === 'open' ? 'open palm' : k === 'grip' ? 'weapon grip' : k}</button>`).join('')}</div>
      <div class="grid2"><select data-hart="${s}">${captures(s).map((c) => `<option>${esc(c)}</option>`).join('')}</select><button data-hfb="${s}">fingers front/back</button></div>
      ${this.handSetUI(s)}</div>`;
    }).join('');
    this.bindHandSetUI(box);
    box.querySelectorAll('[data-h]').forEach((i) => i.onchange = () => this.setHand(i.dataset.h, { [i.dataset.f]: +i.value }, `hand ${i.dataset.h} ${i.dataset.f}`));
    box.querySelectorAll('[data-hp]').forEach((b) => b.onclick = () => this.setHand(b.dataset.hp, HAND_PRESETS[b.dataset.p], `hand ${b.dataset.hp} ${b.dataset.p}`));
    box.querySelectorAll('[data-hart]').forEach((sel) => {
      const s = sel.dataset.hart, cur = this.pose?.slotAttachment?.[this.rig.slotIndex.get(`hand_${s}`)];
      if (cur) sel.value = cur.split('.').pop();
      sel.onchange = () => this.swapHandArt(s, sel.value);
    });
    box.querySelectorAll('[data-hfb]').forEach((b) => b.onclick = () => this.toggleFingerOrder(b.dataset.hfb));
  }
  // ---- hand view sets (palm + finger layers together; see handviews.js for the suggestion rule)
  handSetUI(side) {
    const hv = this.project.handViews?.[side]; if (!hv) return '';
    const shown = this.pose?.handSets?.[side] || null, L = this.clip && this.editLayer(), corr = L?.handSets?.[side];
    const baked = this.clip?.tracks?.handSets?.[side];
    const miss = missingHandArt(this.project, this.rig.skinId).filter((m) => m.side === side);
    const src = !this.clip || this.mode === 'setup' ? 'setup preview' : corr?.t?.length ? `${this.editKey()} key` : baked?.t?.length ? 'source bake' : 'slot keys / setup';
    return `<div class="small" style="margin-top:4px">view set <b>${esc(shown || '—')}</b> <span class="small">(${src})</span></div>
      <div class="grid2"><select data-hset="${side}"><option value="">(follow clip)</option>${Object.entries(hv.sets).map(([k, v]) => `<option value="${esc(k)}" ${k === shown ? 'selected' : ''}>${esc(k)} · ${esc(v.view)}</option>`).join('')}</select>
      <label class="small">threshold <input type="number" data-hthr="${side}" value="0.3" step="0.05" min="0.05" max="0.9"></label></div>
      <div class="row"><button data-hsug="${side}" title="Recompute from the clip's recorded 3D hand orientation/curl into the edit layer">Suggest from source</button><button data-hclr="${side}">Clear set keys</button></div>
      ${miss.length ? `<div class="small status-attention">skin "${esc(this.rig.skinId)}" lacks: ${miss.map((m) => esc(m.set)).join(', ')}</div>` : ''}`;
  }
  bindHandSetUI(box) {
    box.querySelectorAll('[data-hset]').forEach((sel) => sel.onchange = () => this.setHandSet(sel.dataset.hset, sel.value || null));
    box.querySelectorAll('[data-hsug]').forEach((b) => b.onclick = () => { const side = b.dataset.hsug, thr = +box.querySelector(`[data-hthr="${side}"]`).value || 0.3; this.suggestHandSetKeys(side, { threshold: thr }); });
    box.querySelectorAll('[data-hclr]').forEach((b) => b.onclick = () => this.clearHandSetKeys(b.dataset.hclr));
  }
  /** Setup: preview; Animate: key the set at the playhead in the edit layer (null = remove that key). */
  setHandSet(side, name) {
    if (this.mode === 'setup' || !this.clip) { (this.preview.handSets ||= {})[side] = name || undefined; this.renderHands(); return; }
    const clip = this.clip;
    this.record(`hand set ${side} ${name || '(follow clip)'}`, [[this.clipRef(clip), this.editKey()]], () => {
      const L = this.editLayer(clip), tr = (L.handSets ||= {})[side] ||= { t: [], v: [] };
      if (name) setKey(tr, this.keyTime(), { v: name }); else deleteKey(tr, this.keyTime());
    });
    this.rebuild(); this.renderHands();
  }
  suggestHandSetKeys(side, opts = {}) {
    const clip = this.clip; if (!clip) return null;
    const r = suggestHandSets(this.project, clip, side, opts);
    if (!r.keys) { $(this.panel, '#p2Report').textContent = `hand ${side}: ${r.reason}`; return r; }
    this.record(`suggest hand sets ${side}`, [[this.clipRef(clip), this.editKey()]], () => { (this.editLayer(clip).handSets ||= {})[side] = r.keys; });
    this.rebuild(); this.renderHands();
    $(this.panel, '#p2Report').textContent = `hand ${side}: ${r.keys.v.map((v, i) => `${r.keys.t[i]}s ${v}`).join(' → ')}${r.missing.length ? `\nmissing art (fell back): ${r.missing.join(', ')}` : ''}`;
    return r;
  }
  clearHandSetKeys(side) {
    const clip = this.clip; if (!clip) return;
    this.record(`clear hand sets ${side}`, [[this.clipRef(clip), this.editKey()]], () => { const L = this.editLayer(clip); if (L.handSets) delete L.handSets[side]; });
    this.rebuild(); this.renderHands();
  }
  /** Swap the whole hand (palm + five finger layers) to one captured art set, keyed in Animate. */
  swapHandArt(side, name) {
    const slots = ['hand', ...FINGERS].map((g) => `${g}_${side}`).filter((s) => this.rig.slotIndex.has(s));
    const target = this.mode === 'setup' || !this.clip ? [this.project, 'slots'] : [this.clipRef(this.clip), this.editKey()];
    this.record(`hand ${side} art ${name}`, [target], () => {
      for (const s of slots) {
        const id = `${s}.${name}`; const att = this.project.attachments[id] ? id : null;
        if (target[1] === 'slots') this.project.slots.find((x) => x.id === s).attachment = att;
        else { const L = this.editLayer(); const tr = (L.slots[s] ||= {}); tr.attachment ||= { t: [], v: [] }; setKey(tr.attachment, this.keyTime(), { v: att }); }
      }
    });
    this.rebuild(); this.refreshPanel();
  }
  /** Put the four fingers of a hand behind or in front of its palm (keyed draw order in Animate). */
  toggleFingerOrder(side) {
    const order = this.currentOrder(), palm = `hand_${side}`, fingers = FINGERS.filter((f) => f !== 'thumb').map((f) => `${f}_${side}`).filter((s) => order.includes(s));
    const pi = order.indexOf(palm), front = fingers.every((f) => order.indexOf(f) > pi);
    const rest = order.filter((s) => !fingers.includes(s)), at = rest.indexOf(palm);
    rest.splice(front ? at : at + 1, 0, ...fingers);
    this.applyOrder(rest, `fingers ${front ? 'behind' : 'in front of'} palm ${side}`);
  }

  renderProps() {
    const box = $(this.panel, '#p2Props'), P = this.project;
    const propSlots = P.slots.filter((s) => s.group === 'props');
    let html = propSlots.map((s) => {
      const atts = Object.values(P.attachments).filter((a) => a.slot === s.id), cur = this.pose?.slotAttachment?.[this.rig.slotIndex.get(s.id)] || '';
      return `<label class="small">${esc(s.id)} <select data-prop="${esc(s.id)}">${['', ...atts.map((a) => a.id)].map((id) => `<option value="${esc(id)}" ${id === cur ? 'selected' : ''}>${esc(id ? id.split('.').pop() : '(none)')}</option>`).join('')}</select></label>`;
    }).join('');
    html += (P.constraints || []).map((c) => {
      const ct = this.pose?.contacts?.find((x) => x.id === c.id);
      return `<div class="small" style="margin-top:6px"><b>${esc(c.id)}</b> ${esc(c.bones.join(' → '))} → ${esc(c.target.marker ? c.target.slot + ':' + c.target.marker : c.target.bone)}<br>
        mix <input type="range" data-cm="${esc(c.id)}" min="0" max="1" step="0.05" value="${ct?.mix ?? 0}" style="width:40%"> bend <select data-cb="${esc(c.id)}">${['keep', '1', '-1'].map((b) => `<option ${String(c.bend) === b ? 'selected' : ''}>${b}</option>`).join('')}</select>
        ${ct && ct.mix > 0 ? `<br>error ${ct.error.toFixed(2)} px · ${ct.reachable ? 'reachable' : '<span class="status-needs-art">UNREACHABLE (reach ' + ct.reach?.toFixed(1) + ' < ' + ct.distance?.toFixed(1) + ' px)</span>'}` : ''}${c.note ? `<br><i>${esc(c.note)}</i>` : ''}</div>`;
    }).join('');
    box.innerHTML = html + '<div class="small">Order: bone tracks → corrections → hand controls → constraints by `order` (the right hand + prop drive, the support hand follows).</div>';
    box.querySelectorAll('[data-prop]').forEach((sel) => sel.onchange = () => this.setSlotAttachment(sel.dataset.prop, sel.value || null));
    box.querySelectorAll('[data-cm]').forEach((i) => i.onchange = () => {
      const id = i.dataset.cm;
      if (this.mode === 'setup' || !this.clip) { this.record(`constraint ${id} mix`, [[this.project, 'constraints']], () => { this.project.constraints.find((c) => c.id === id).mix = +i.value; }); }
      else { const clip = this.clip; this.record(`key ${id} mix`, [[this.clipRef(clip), this.editKey()]], () => { const L = this.editLayer(clip); const tr = (L.constraints[id] ||= { t: [], v: [] }); setKey(tr, this.keyTime(), { v: +i.value }); }); }
      this.rebuild();
    });
    box.querySelectorAll('[data-cb]').forEach((sel) => sel.onchange = () => { this.record(`constraint bend`, [[this.project, 'constraints']], () => { const c = this.project.constraints.find((x) => x.id === sel.dataset.cb); c.bend = sel.value === 'keep' ? 'keep' : +sel.value; }); this.rebuild(); });
  }

  renderPoses() {
    const box = $(this.panel, '#p2Poses'), poses = this.project.poses || [];
    box.innerHTML = poses.map((p, i) => `<div class="row"><span style="flex:1">${esc(p.name)}</span><button data-pa="${i}">${this.mode === 'setup' ? 'preview' : 'key at t'}</button><button data-pd="${i}">✕</button></div>`).join('') || '<div class="small">No named poses yet.</div>';
    box.querySelectorAll('[data-pa]').forEach((b) => b.onclick = () => this.applyPose(poses[+b.dataset.pa]));
    box.querySelectorAll('[data-pd]').forEach((b) => b.onclick = () => { this.record('delete pose', [[this.project, 'poses']], () => this.project.poses.splice(+b.dataset.pd, 1)); this.refreshPanel(); });
  }
  capturePose(name) {
    this.evaluate();
    const bones = {}, L = this.rig.local, S = this.rig.setup;
    this.rig.bones.forEach((b, i) => {
      const r = wrapDeg(L[i * 5 + 2] - S[i * 5 + 2]), x = L[i * 5] - S[i * 5], y = L[i * 5 + 1] - S[i * 5 + 1];
      if (Math.abs(r) > 0.01 || Math.abs(x) > 0.01 || Math.abs(y) > 0.01) bones[b.id] = { rotate: +r.toFixed(3), x: +x.toFixed(3), y: +y.toFixed(3) };
    });
    this.record(`capture pose ${name}`, [[this.project, 'poses']], () => { (this.project.poses ||= []).push({ name, bones, note: 'offsets from the setup pose (local rotate/x/y; hand controls already applied)' }); });
    this.refreshPanel();
  }
  applyPose(pose) {
    if (this.mode === 'setup' || !this.clip) { this.preview.pose = pose.bones; return; }
    // key the edit layer so the evaluated pose equals the named pose at this time
    const clip = this.clip, t = this.player.time;
    this.rig.evaluate(clip, t, { corrections: false });
    const base = new Float64Array(this.rig.local), S = this.rig.setup;
    this.record(`key pose ${pose.name}`, [[this.clipRef(clip), this.editKey()]], () => {
      const Lr = this.editLayer(clip);
      this.rig.bones.forEach((b, i) => {
        const want = pose.bones[b.id] || { rotate: 0, x: 0, y: 0 };
        const dr = wrapDeg(S[i * 5 + 2] + want.rotate - base[i * 5 + 2]), dx = S[i * 5] + want.x - base[i * 5], dy = S[i * 5 + 1] + want.y - base[i * 5 + 1];
        if (Math.abs(dr) < 0.01 && Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 && !Lr.bones[b.id]) return;
        const tr = (Lr.bones[b.id] ||= {});
        tr.rotate ||= { t: [] }; setKey(tr.rotate, this.keyTime(), { v: +dr.toFixed(4) });
        tr.translate ||= { t: [] }; setKey(tr.translate, this.keyTime(), { x: +dx.toFixed(4), y: +dy.toFixed(4) });
      });
    });
    this.rebuild();
  }

  /** Easing of the selected bone's correction keys (all fields) from the key at the playhead. */
  setCorrectionEase(ease) {
    const clip = this.clip, id = this.sel.bone; if (!clip || !id) return;
    this.record(`ease ${ease} ${id}`, [[this.clipRef(clip), this.editKey()]], () => {
      const tr = this.editLayer(clip).bones[id]; if (!tr) return;
      for (const f of ['rotate', 'translate', 'scale']) {
        const T = tr[f]; if (!T?.t?.length) continue;
        const i = Math.max(0, keyIndex(T.t, this.player.time + 1e-6));
        T.ease ||= T.t.map(() => 'linear'); T.ease[i] = ease;
      }
    });
    this.rebuild();
  }
  /** Disable / re-enable (never delete) the selected bone's or attachment's correction; undoable. */
  toggleCorrection(kind) {
    const clip = this.clip; if (!clip) return;
    const L = this.editLayer(clip), id = kind === 'bone' ? this.sel.bone : this.sel.attachment;
    const tr = kind === 'bone' ? L.bones?.[id] : L.deform?.[id]; if (!tr) { $(this.panel, '#p2Report').textContent = `no ${kind} correction for ${id || '(nothing selected)'} in ${clip.name}`; return; }
    this.record(`${tr.disabled ? 'enable' : 'disable'} ${kind} correction ${id}`, [[this.clipRef(clip), this.editKey()]], () => {
      const t2 = kind === 'bone' ? this.editLayer(clip).bones[id] : this.editLayer(clip).deform[id];
      if (t2.disabled) delete t2.disabled; else t2.disabled = true;
    });
    this.rebuild(); this.refreshPanel();
  }
  // ---- visual QA
  async runQA(clipName = this.clip?.name) {
    if (!clipName) return null;
    const box = $(this.panel, '#p2QaFlags'); box.textContent = 'analysing…';
    this.qaRenderer ||= await offscreenRenderer(this.project, this.store);
    for (const [id, im] of Object.entries(this.project.images)) if (!this.qaRenderer.textures.has(id) && this.store.has(im.path)) { const img = new Image(); img.src = this.store.url(im.path); await img.decode(); this.qaRenderer.setTexture(id, img); }
    const a = await analyzeClip(this.project, clipName, { skin: this.rig.skinId, renderer: this.qaRenderer });
    this.qa = a; this.renderQA(); return a;
  }
  renderQA() {
    const a = this.qa, box = $(this.panel, '#p2QaFlags'); if (!a) return;
    const st = clipStatus(this.project, a.clip, a, { skin: this.rig.skinId });
    $(this.panel, '#p2QaStatus').innerHTML = `math: <b>${st.math}</b> · art: <b>${st.missingArt}</b> (bridge ${esc(st.bridge)}) · auto-flags: <b>${st.autoFlags}</b>${st.excepted ? ` (+${st.excepted} excepted)` : ''}${st.info ? ` · info ${st.info}` : ''} · review: <b>${esc(st.visualReview)}</b>`;
    $(this.panel, '#p2QaReview').value = st.visualReview; $(this.panel, '#p2QaNote').value = st.reviewNote;
    // ranged flags (consecutive frames collapsed): open ones by severity, then excepted, then info
    const rank = (f) => (f.info ? 2 : f.exception ? 1 : 0);
    const list = this.qaList = [...a.flags].sort((x, y) => rank(x) - rank(y) || y.severity - x.severity).slice(0, 40);
    const when = (f) => (f.to > f.from ? `${f.from.toFixed(2)}–${f.to.toFixed(2)}s (worst ${f.t.toFixed(2)})` : `${f.t.toFixed(2)}s`);
    box.innerHTML = list.length ? list.map((f, i) => `<div>${f.info ? 'ℹ' : f.exception ? '✓' : '⚠'} ${when(f)} <b>${esc(f.kind)}</b> ${esc(f.target)} = ${f.value} ${esc(f.unit)} (limit ${f.threshold})${f.exception ? ` — exception: ${esc(f.exception.reason)}` : ''}${f.info ? ` — ${esc(f.info)}` : ''} <button data-qgo="${i}">Go</button>${f.exception || f.info ? '' : `<button data-qex="${i}">Except…</button>`}</div>`).join('') : 'no flags';
    box.querySelectorAll('[data-qgo]').forEach((b) => b.onclick = () => this.gotoFlag(list[+b.dataset.qgo]));
    box.querySelectorAll('[data-qex]').forEach((b) => b.onclick = () => { const f = list[+b.dataset.qex], reason = prompt(`Why is this ${f.kind} on ${f.target} intentional?`); if (reason) this.addException(a.clip, f, reason); });
  }
  gotoFlag(f) {
    if (this.clip?.name !== this.qa.clip) this.selectClip(this.qa.clip);
    this.setMode('animate'); this.player.pause(); this.playing = false; this.player.seek(f.t);
    const tgt = String(f.target).split(' ')[0];
    if (this.project.attachments[tgt]) this.selectSlot(this.project.attachments[tgt].slot, tgt); else if (this.rig.boneIndex.has(tgt)) this.selectBone(tgt); else if (this.rig.slotIndex.has(tgt)) this.selectSlot(tgt, null);
    this.refreshPanel();
  }
  addException(clip, f, reason, { from = f.from ?? f.t, to = f.to ?? f.t } = {}) {
    this.record(`QA exception ${f.kind} ${f.target}`, [[this.project, 'visualQA']], () => { const q = this.project.visualQA ||= {}; (q.exceptions ||= []).push({ clip, kind: f.kind, target: f.target, from, to, reason, date: new Date().toISOString().slice(0, 10) }); });
    for (const x of this.qa?.flags || []) if (x.kind === f.kind && x.target === f.target && (x.from ?? x.t) >= from - 1e-6 && (x.to ?? x.t) <= to + 1e-6) x.exception = { reason };
    this.renderQA();
  }
  setReview(status, note) {
    const clip = this.qa?.clip || this.clip?.name; if (!clip) return;
    this.record(`review ${clip}: ${status}`, [[this.project, 'visualQA']], () => { const q = this.project.visualQA ||= {}; (q.review ||= {})[clip] = { status, note, date: new Date().toISOString().slice(0, 10) }; });
    this.renderQA();
  }
  async qaSheet(clipName = this.clip?.name) {
    const a = this.qa?.clip === clipName ? this.qa : await this.runQA(clipName);
    return contactSheet(this.project, this.store, clipName, sheetTimes(this.project, clipName, a), { skin: this.rig.skinId, renderer: this.qaRenderer });
  }
  deleteBoneKey() {
    const clip = this.clip, id = this.sel.bone; if (!clip || !id) return;
    this.record(`delete key ${id}`, [[this.clipRef(clip), this.editKey()]], () => { const tr = this.editLayer(clip).bones[id]; if (tr) for (const f of ['rotate', 'translate', 'scale']) if (tr[f]) deleteKey(tr[f], this.keyTime()); });
    this.rebuild();
  }
  clearBone() {
    const clip = this.clip, id = this.sel.bone; if (!clip || !id) return;
    this.record(`clear ${id}`, [[this.clipRef(clip), this.editKey()]], () => { delete this.editLayer(clip).bones[id]; });
    this.rebuild();
  }
  newClip() {
    const name = prompt('Name of the new 2D clip', `new_clip_${this.project.clips.length + 1}`); if (!name) return;
    if (this.project.clips.some((c) => c.name === name)) { alert('A clip with that name exists.'); return; }
    const dur = +prompt('Duration in seconds', '2') || 2;
    this.record(`new clip ${name}`, [[this.project, 'clips']], () => this.project.clips.push({ name, duration: dur, loop: true, fps: 30,
      source: { type: 'native2d', note: 'authored in the 2D editor' }, tracks: ensureLayer({}), corrections: ensureLayer({}), status: { level: 'ok', notes: ['native 2D clip'] } }));
    this.rebuild();
    $(this.panel, '#p2Clip').insertAdjacentHTML('beforeend', `<option value="${esc(name)}">● ${esc(name)} (2D)</option>`);
    this.selectClip(name); this.setMode('animate');
  }
  addEvent(name) {
    const clip = this.clip; if (!clip || !name) return;
    this.record(`event ${name}`, [[this.clipRef(clip), this.editKey()]], () => { const L = this.editLayer(clip); L.events.push({ t: this.keyTime(), name }); L.events.sort((a, b) => a.t - b.t); });
    this.rebuild();
  }

  withAttachment(label, fn, extraTargets = []) {
    const a = this.sel.attachment && this.project.attachments[this.sel.attachment];
    if (!a) { alert('Select a layer (attachment) first.'); return; }
    this.record(label, [[() => this.project.attachments, a.id], ...extraTargets], () => fn(a), a.id);
    this.rebuild(a.id); this.refreshPanel();
  }
  async autoMesh() {
    const a = this.sel.attachment && this.project.attachments[this.sel.attachment]; if (!a) return;
    const im = this.project.images[a.image], img = new Image(); img.src = this.store.url(im.path); await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data, A = new Uint8Array(img.width * img.height); for (let i = 0; i < A.length; i++) A[i] = d[i * 4 + 3];
    const cell = +(prompt('Mesh cell size (image px); smaller = more vertices', String(meshCell(img.width, img.height)))) || meshCell(img.width, img.height);
    const old = this.meshSnapshot(a.id);
    this.withAttachment('auto mesh', (att) => {
      const m = gridMesh(A, img.width, img.height, { cell, threshold: 6, margin: 2 });
      const hadWeights = !!att.weights; att.vertices = m.vertices; att.triangles = m.triangles; att.weights = null;
      this.rig.rebuildAttachment(att.id);
      if (hadWeights) autoWeightAttachment(this.project, att.id);
      this.rig.rebuildAttachment(att.id); this.remapDeformKeys(att.id, old);
    }, [[this.project, 'clips']]);
  }
  /**
   * One undoable step around an async project change (image replacement, layered import, fitting).
   * If anything throws, every target is restored to its prior state and no history entry is left behind.
   */
  async transact(label, targets, fn, attId = null) {
    this.begin(label, targets, attId);
    const pending = this.pending;
    try {
      const out = await fn();
      this.end();
      return out;
    } catch (e) {
      pending.targets.forEach(([o, k], i) => { res(o)[k] = clone(pending.before[i]); });
      this.pending = null;
      this.rebuild();
      throw e;
    } finally { await this.syncTextures(); this.refreshPanel(); }
  }
  /** Upload any image the renderer has not seen yet (new revisions, imports, reopened projects). */
  async syncTextures() {
    for (const [id, im] of Object.entries(this.project.images)) {
      if (this.renderer.textures.has(id) || !this.store.has(im.path)) continue;
      const img = new Image(); img.src = this.store.url(im.path); await img.decode(); this.renderer.setTexture(id, img);
    }
    this.rebuild(); this.renderer.invalidate();
  }
  allTargets() { return [[this.project, 'attachments'], [this.project, 'images'], [this.project, 'slots'], [this.project, 'bones'], [this.project, 'clips'], [this.project, 'skins']]; }

  async replaceSelected(bytes) {
    const a = this.sel.attachment && this.project.attachments[this.sel.attachment]; if (!a) { alert('Select a layer first.'); return; }
    await this.transact(`replace image ${a.id}`, this.allTargets(), () => replaceImage(this.project, this.store, a.id, bytes));
    this.alphaCache.clear();
  }
  async importLayered(files) {
    let res;
    try { res = await this.transact('import layered art', this.allTargets(), () => importLayers(this.project, this.store, files)); }
    catch (e) { $(this.panel, '#p2Report').textContent = `import failed, nothing changed: ${e.message}`; throw e; }
    $(this.panel, '#p2Report').textContent = `imported ${res.added.length} layer(s): ${res.added.join(', ')}` + (res.skipped.length ? `\nskipped:\n  ${res.skipped.join('\n  ')}` : '');
    return res;
  }
  async reopenSaved() {
    const bytes = saveProjectZip(this.project, this.store), keep = { clip: this.clip?.name, t: this.player.time };
    await this.openZip(bytes, `reopened from a fresh save (${(bytes.length / 1024).toFixed(0)} KB)`);
    if (keep.clip) { this.selectClip(keep.clip); this.player.seek(keep.t); }
    return bytes.length;
  }
  async playerFiles() {
    const out = {};
    for (const f of ['gamboligy-character2d.js', 'README.md']) {
      try { const r = await fetch(`${this.base}runtime/${f}`); if (r.ok) out[`player/${f}`] = await r.text(); } catch { /* optional */ }
    }
    return out;
  }
  async exportRuntime() {
    const { zip, pkg } = await exportRuntimePackage(this.project, this.store, { player: await this.playerFiles() });
    download(zip, `${this.project.characterId}.runtime.zip`, 'application/zip');
    $(this.panel, '#p2Report').textContent = `runtime package: ${pkg.atlas.pages.length} atlas page(s), ${pkg.clips.length} clips, ${(zip.length / 1024).toFixed(0)} KB`;
  }
  async exportSheets(clips) {
    $(this.panel, '#p2Report').textContent = 'rendering sprite sheets…';
    const { zip, manifest } = await exportSpriteSheets(this.project, this.store, { clips, skin: this.rig.skinId, scale: 0.5 });
    download(zip, `${this.project.characterId}.spritesheets.zip`, 'application/zip');
    $(this.panel, '#p2Report').textContent = `sprite sheets: ${manifest.sheets.length} sheet(s), ${Object.keys(manifest.clips).length} clip(s), ${(zip.length / 1024).toFixed(0)} KB`;
  }

  // ---------------------------------------------------------------- fitting -------
  /** Open painted layers into a fitting session (nothing in the project changes until Accept). */
  async startFit(files, { useTemplate = false, skin = null, template = null } = {}) {
    if (this.fit) this.cancelFit();
    const skinId = skin || $(this.panel, '#p2FitSkin').value.trim() || 'painted';
    // `template`: a fit template from another (saved) project, e.g. to carry a painted skin onto a rebuilt starter
    const tpl = template || (useTemplate ? (this.project.fitting?.templates?.[skinId] || this.project.fitting?.templates?.[this.project.fitting?.last]) : null);
    if (useTemplate && !tpl) throw new Error('this project has no saved fitting template yet');
    const source = await readFitSource(files, tpl);
    if (!source.layers.length) throw new Error(`no readable layers${source.problems.length ? ': ' + source.problems.join('; ') : ''}`);
    const session = planFit(this.project, source, { template: tpl, skin: skinId });
    this.fit = { session, sel: 0, ghost: 0.35, painted: 1, bones: true, coverage: null };
    this.wasMode = this.mode; this.setMode('setup');
    await this.refreshFit();
    this.renderFitPanel();
    return session;
  }
  /** Rebuild the preview project from the live project + the session (live project untouched). */
  /** Queued: every caller gets a promise for a preview that includes its change. */
  refreshFit() { this._fitChain = (this._fitChain || Promise.resolve()).then(() => this.refreshFitNow()).catch((e) => { $(this.panel, '#p2Report').textContent = `fitting preview: ${e.message}`; }); return this._fitChain; }
  async refreshFitNow() {
    const F = this.fit; if (!F) return;
    try {
      const { project: P, installed } = await installFit(this.project, F.session, this.store);
      F.preview = P; F.installed = installed;
      F.rig = new Rig(P); F.rig.setSkin(F.session.skin);
      for (const [id, im] of Object.entries(P.images)) if (!this.renderer.textures.has(id) && this.store.has(im.path)) { const img = new Image(); img.src = this.store.url(im.path); await img.decode(); this.renderer.setTexture(id, img); }
      this.renderer.invalidate();
    } finally { /* next queued refresh runs */ }
  }
  /** Commit the whole session as ONE undoable step; the painted skin becomes active. */
  async acceptFit() {
    const F = this.fit; if (!F) return;
    await this.refreshFit();
    const P = F.preview, targets = [...this.allTargets(), [this.project, 'fitting']];
    await this.transact(`fit artwork → skin ${F.session.skin}`, targets, () => { for (const k of ['attachments', 'images', 'slots', 'bones', 'skins', 'fitting', 'clips']) this.project[k] = structuredClone(P[k]); });
    this.fit = null; this.rig.setSkin(F.session.skin);
    $(this.panel, '#p2Skin').innerHTML = (this.project.skins || []).map((x) => `<option ${x.id === F.session.skin ? 'selected' : ''}>${esc(x.id)}</option>`).join('');
    this.setMode(this.wasMode || 'animate'); this.renderFitPanel(); this.refreshPanel();
    return F.installed;
  }
  cancelFit() { this.fit = null; this.renderer.invalidate(); this.setMode(this.wasMode || 'animate'); this.renderFitPanel(); }
  fitLayer() { return this.fit?.session.layers[this.fit.sel]; }
  fitAnchors(L) { return L?.slot ? slotAnchors(this.fit.preview || this.project, new Rig(this.project), L.slot) : null; }
  updateFitLayer(fn, { refresh = true } = {}) { const L = this.fitLayer(); if (!L) return; fn(L); if (refresh) this.refreshFit(); this.renderFitPanel(); }

  drawFitHandles(g) {
    const L = this.fitLayer(); if (!L) return;
    const P = (x, y) => this.w2s(x, y), an = this.fitAnchors(L);
    // the layer's canvas rectangle
    g.strokeStyle = '#d8a6ff'; g.setLineDash([5, 4]); g.lineWidth = 1.2; g.beginPath();
    [[0, 0], [L.w, 0], [L.w, L.h], [0, L.h]].forEach(([ix, iy], k) => { const [x, y] = P(...imageToWorld(L, ix, iy)); k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.stroke(); g.setLineDash([]);
    const pv = P(...imageToWorld(L, ...L.fit.pivot)); g.strokeStyle = '#ffd400'; g.beginPath(); g.moveTo(pv[0] - 7, pv[1]); g.lineTo(pv[0] + 7, pv[1]); g.moveTo(pv[0], pv[1] - 7); g.lineTo(pv[0], pv[1] + 7); g.stroke();
    if (!an || !L.anchors) return;
    g.font = '11px system-ui';
    ['A', 'B'].forEach((k, i) => {
      const j = P(...an[i].world), a = P(...imageToWorld(L, ...L.anchors[k]));
      g.strokeStyle = '#00e5ff'; g.lineWidth = 2; g.beginPath(); g.arc(j[0], j[1], 6, 0, 7); g.stroke();
      g.fillStyle = '#00e5ff'; g.fillText(`rig ${an[i].name}`, j[0] + 8, j[1] - 8);
      g.strokeStyle = '#ff7a2f'; g.beginPath(); g.arc(a[0], a[1], 8, 0, 7); g.stroke(); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(j[0], j[1]); g.stroke();
      g.fillStyle = '#ff7a2f'; g.fillText(`art ${an[i].name}`, a[0] + 10, a[1] + 14);
    });
  }
  fitDown(e, wx, wy) {
    const F = this.fit, L = this.fitLayer(), r = this.ovCanvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    if (L?.anchors) for (const k of ['A', 'B']) { const [x, y] = this.w2s(...imageToWorld(L, ...L.anchors[k])); if (Math.hypot(x - mx, y - my) < 10) { this.drag.fit = { anchor: k }; return; } }
    const hit = this.pickSlot(wx, wy), att = hit?.attachment;
    const idx = att ? F.session.layers.findIndex((l) => att === `${l.target}@${F.session.skin}`) : -1;
    if (idx >= 0) F.sel = idx;
    const cur = this.fitLayer(); if (!cur) return;
    this.drag.fit = { move: true, start: { ...cur.fit }, rotate: e.shiftKey, a0: Math.atan2(wy - cur.fit.y, wx - cur.fit.x) };
    this.renderFitPanel();
  }
  fitMove(e, wx, wy) {
    const d = this.drag, L = this.fitLayer(); if (!L) return;
    if (d.fit.anchor) { L.anchors[d.fit.anchor] = worldToImage(L, wx, wy).map((v) => +v.toFixed(1)); this.renderFitPanel(); return; }
    if (d.fit.rotate) L.fit = { ...d.fit.start, rotation: d.fit.start.rotation + (Math.atan2(wy - d.fit.start.y, wx - d.fit.start.x) - d.fit.a0) * 180 / Math.PI };
    else L.fit = { ...d.fit.start, x: d.fit.start.x + wx - d.wx, y: d.fit.start.y + wy - d.wy };
    if (!this.fitThrottle) { this.fitThrottle = true; requestAnimationFrame(() => { this.fitThrottle = false; this.refreshFit(); }); }
    this.renderFitPanel();
  }

  renderFitPanel() {
    const box = $(this.panel, "#p2FitPanel"), F = this.fit;
    if (!F) { box.innerHTML = this.project?.skins?.some((s) => s.id !== 'default') ? `<div class="small">skins: ${this.project.skins.map((s) => `${esc(s.id)}${s.status ? ` (${Object.values(s.status).filter((v) => v === 'finished').length} finished, ${Object.values(s.status).filter((v) => v === 'provisional').length} provisional)` : ''}`).join(' · ')}</div>` : ''; return; }
    const S = F.session, L = this.fitLayer(), atts = Object.keys(this.project.attachments).filter((id) => !id.includes('@'));
    const an = L && this.fitAnchors(L), badge = (st) => st === 'ok' ? '<span class="status-ok">●</span>' : st === 'ambiguous' ? '<span class="status-attention">◆ ambiguous</span>' : st === 'duplicate' ? '<span class="status-attention">◆ duplicate target</span>' : '<span class="status-needs-art">▲ unmapped</span>';
    box.innerHTML = `${S.problems.length ? `<div class="status-needs-art small">${S.problems.map(esc).join('<br>')}</div>` : ''}
      <div class="layers" style="max-height:170px">${S.layers.map((l, i) => `<div class="layer ${i === F.sel ? 'sel' : ''}" data-fl="${i}"><input type="checkbox" data-fi="${i}" ${l.include ? 'checked' : ''}><span class="n">${esc(l.file)}</span><span class="a">${badge(l.slot ? l.mapping.status : 'unresolved')} ${esc(l.target || '—')}</span></div>`).join('')}</div>
      ${L ? `<div class="small" style="margin-top:6px"><b>${esc(L.file)}</b> ${L.w}×${L.h}px${L.mapping.candidates?.length > 1 ? ` · suggestions: ${L.mapping.candidates.slice(0, 3).map((c) => `${esc(c.target)} (${c.score})`).join(', ')}` : ''}</div>
      <label class="small">paints <select id="p2FTarget"><option value="">(choose attachment)</option>${atts.map((id) => `<option ${id === L.target ? 'selected' : ''}>${esc(id)}</option>`).join('')}</select></label>
      <div class="grid2"><label class="small">mode <select id="p2FMode"><option value="replace" ${L.mode === 'replace' ? 'selected' : ''}>replace texture (same displayed size)</option><option value="proportion" ${L.mode === 'proportion' ? 'selected' : ''}>change proportions (rig follows art)</option></select></label>
      <label class="small">mesh <select id="p2FMesh">${['auto', 'rigid', 'weighted'].map((m) => `<option ${m === L.mesh ? 'selected' : ''}>${m}</option>`).join('')}</select></label></div>
      ${L.placementNote ? `<div class="small" style="color:#ffb86b">${esc(L.placementNote)}</div>` : ''}
      <div class="grid3">${['x', 'y', 'rotation', 'scale'].map((k) => `<label class="small">${k} <input type="number" data-ff="${k}" value="${(+L.fit[k]).toFixed(k === 'scale' ? 4 : 2)}" step="${k === 'scale' ? 0.005 : k === 'rotation' ? 0.5 : 0.5}"></label>`).join('')}
      <label class="small">pivot x <input type="number" data-fp="0" value="${L.fit.pivot[0].toFixed(1)}" step="1"></label><label class="small">pivot y <input type="number" data-fp="1" value="${L.fit.pivot[1].toFixed(1)}" step="1"></label>
      <label class="small"><input type="checkbox" id="p2FMirror" ${L.fit.mirror ? 'checked' : ''}> mirror (L/R)</label></div>
      <div class="small">${an ? `joint anchors: <span style="color:#00e5ff">rig</span> vs <span style="color:#ff7a2f">art</span> — ${esc(an[0].name)} → ${esc(an[1].name)}. Drag the orange art anchors onto the painted joints, then snap.` : 'no joint anchors for this slot'}</div>
      <div class="row"><button id="p2FSnap">Snap to joints</button><button id="p2FReset">Reset registration</button><select id="p2FStatus">${['finished', 'provisional'].map((x) => `<option ${x === (L.status || 'finished') ? 'selected' : ''}>${x}</option>`).join('')}</select></div>` : ''}
      <div class="grid2"><label class="small">starter ghost <input type="range" id="p2FGhost" min="0" max="1" step="0.05" value="${F.ghost}"></label><label class="small">painted <input type="range" id="p2FPaint" min="0" max="1" step="0.05" value="${F.painted}"></label></div>
      <label class="small"><input type="checkbox" id="p2FBones" ${F.bones ? 'checked' : ''}> source rig overlay</label>
      <div class="row"><select id="p2FClip">${['(setup pose)', 'idle', 'hover_sword_vigil', 'sword_2h_idle', 'sword_2h_slash', 'knight_salute', 'walk_in_place'].filter((c) => c === '(setup pose)' || this.rig.clips.has(c)).map((c) => `<option ${this.mode === 'animate' && this.clip?.name === c ? 'selected' : ''}>${c}</option>`).join('')}</select><button id="p2FPlay">${this.playing ? 'Pause' : 'Play'}</button></div>
      <div class="row"><button id="p2FCover">Check joint coverage</button><button id="p2FSaveTpl">Download template</button></div>
      <div class="report" id="p2FCoverOut">${F.coverage ? F.coverage.map((c) => `${c.flagged ? '⚠' : '✓'} ${c.joint}: ${c.gapPct}% open at ${c.worstAngle}° (limit ${c.thresholdPct}%)${c.flagged ? ' — ' + c.hint : ''}`).join('\n') : ''}</div>
      <div class="row"><button id="p2FAccept" class="on">Accept (one undo step)</button><button id="p2FCancel">Cancel</button></div>`;
    const q = (sel) => box.querySelector(sel);
    box.querySelectorAll('[data-fl]').forEach((row) => row.onclick = (e) => { if (e.target.dataset.fi) return; F.sel = +row.dataset.fl; this.renderFitPanel(); });
    box.querySelectorAll('[data-fi]').forEach((c) => c.onchange = () => { S.layers[+c.dataset.fi].include = c.checked; this.refreshFit(); });
    if (L) {
      q('#p2FTarget').onchange = (e) => this.updateFitLayer((l) => { l.target = e.target.value || null; l.slot = l.target ? this.project.attachments[l.target].slot : null; l.mapping = { ...l.mapping, status: l.target ? 'ok' : 'unresolved' }; l.include = !!l.target; if (l.target) resetFit(this.project, new Rig(this.project), l, S.registration); });
      // switching mode re-registers a layer that was not adjusted yet (proportion uses the layers.json placement)
      q('#p2FMode').onchange = (e) => this.updateFitLayer((l) => { const untouched = JSON.stringify(l.fit) === l.initialFit; l.mode = e.target.value; if (untouched) { resetFit(this.project, new Rig(this.project), l, S.registration); l.initialFit = JSON.stringify(l.fit); } });
      q('#p2FMesh').onchange = (e) => this.updateFitLayer((l) => { l.mesh = e.target.value; });
      box.querySelectorAll('[data-ff]').forEach((i) => i.onchange = () => this.updateFitLayer((l) => { l.fit = { ...l.fit, [i.dataset.ff]: +i.value }; }));
      box.querySelectorAll('[data-fp]').forEach((i) => i.onchange = () => this.updateFitLayer((l) => { const k = +i.dataset.fp, np = l.fit.pivot.slice(); const w0 = imageToWorld(l, 0, 0); np[k] = +i.value; l.fit = { ...l.fit, pivot: np }; const w1 = imageToWorld(l, 0, 0); l.fit.x += w0[0] - w1[0]; l.fit.y += w0[1] - w1[1]; }));
      q('#p2FMirror').onchange = (e) => this.updateFitLayer((l) => { l.fit = { ...l.fit, mirror: e.target.checked }; });
      q('#p2FSnap').onclick = () => this.updateFitLayer((l) => { const a = this.fitAnchors(l); if (a && l.anchors) snapToJoints(l, a); });
      q('#p2FReset').onclick = () => this.updateFitLayer((l) => resetFit(this.project, new Rig(this.project), l, S.registration));
      q('#p2FStatus').onchange = (e) => this.updateFitLayer((l) => { l.status = e.target.value; });
    }
    q('#p2FGhost').oninput = (e) => { F.ghost = +e.target.value; };
    q('#p2FPaint').oninput = (e) => { F.painted = +e.target.value; };
    q('#p2FBones').onchange = (e) => { F.bones = e.target.checked; };
    q('#p2FClip').onchange = (e) => { const c = e.target.value; if (c === '(setup pose)') this.setMode('setup'); else { this.mode = 'animate'; this.selectClip(c); } };
    q('#p2FPlay').onclick = () => { if (this.mode === 'setup') { this.mode = 'animate'; this.selectClip(q('#p2FClip').value === '(setup pose)' ? 'idle' : q('#p2FClip').value); } this.togglePlay(); this.renderFitPanel(); };
    q('#p2FCover').onclick = async () => { q('#p2FCoverOut').textContent = 'measuring…'; await this.refreshFit(); F.coverage = await jointCoverage(F.preview, this.store, { skin: S.skin }); this.renderFitPanel(); };
    q('#p2FSaveTpl').onclick = () => download(new TextEncoder().encode(JSON.stringify(templateOf(this.project, S), null, 1)), `${this.project.characterId}.${S.skin}.fit-template.json`, 'application/json');
    q('#p2FAccept').onclick = () => this.acceptFit();
    q('#p2FCancel').onclick = () => this.cancelFit();
  }
  async paintPack(skin = $(this.panel, '#p2FitSkin').value.trim() || 'painted') {
    const coverage = await jointCoverage(this.project, this.store, { skin });
    return paintTemplatePack(this.project, this.store, { skin, coverage });
  }

  api() {
    const ed = this;
    return {
      editor: ed, get project() { return ed.project; }, get rig() { return ed.rig; }, get player() { return ed.player; }, get store() { return ed.store; },
      setMode: (m) => ed.setMode(m), selectClip: (n) => ed.selectClip(n), seek: (t) => ed.player.seek(t), undo: () => ed.undo(), redo: () => ed.redo(),
      evaluate: () => ed.evaluate(), openURL: (u) => ed.openURL(u), openZip: (b) => ed.openZip(b), reopenSaved: () => ed.reopenSaved(),
      importLayered: (m) => ed.importLayered(m), replaceSelected: (b) => ed.replaceSelected(b), selectSlot: (s, a) => ed.selectSlot(s, a), selectBone: (b) => ed.selectBone(b),
      applyOrder: (o, l) => ed.applyOrder(o, l), keyBone: (id, f, v) => ed.keyBone(id, f, () => v), setTool: (t) => { ed.tool = t; }, setCompare: (m) => ed.setCompare(m),
      movePivot: (id, x, y) => { ed.begin(`move pivot ${id}`, [[ed.project, 'bones'], [ed.project, 'attachments']]); ed.movePivot(id, x, y); ed.end(); },
      paintWeights: (att, bone, ix, iy, r, s, mode = 'add') => { ed.sel.attachment = att; ed.sel.bone = bone; const a = ed.project.attachments[att]; ed.record(`paint weights ${bone}`, [[() => ed.project.attachments, att]], () => { const m = { vertices: a.vertices, triangles: a.triangles, weights: a.weights }; paintWeights(m, bone, ix, iy, r, s, mode); a.weights = m.weights; }, att); ed.rebuild(att); },
      setHand: (s, v) => ed.setHand(s, v), swapHandArt: (s, n) => ed.swapHandArt(s, n), validate: () => validateProject(ed.project, { images: new Set(ed.store.paths()) }),
      history: () => ed.undoStack.map((h) => h.label),
      startFit: (files, o) => ed.startFit(files, o), refreshFit: () => ed.refreshFit(), acceptFit: () => ed.acceptFit(), cancelFit: () => ed.cancelFit(),
      get fit() { return ed.fit; }, fitSelect: (i) => { ed.fit.sel = i; ed.renderFitPanel(); }, fitUpdate: (fn) => ed.updateFitLayer(fn), snapLayer: (i) => { const l = ed.fit.session.layers[i]; snapToJoints(l, ed.fitAnchors(l)); return ed.refreshFit(); },
      runQA: (c) => ed.runQA(c), qaSheet: (c) => ed.qaSheet(c), addException: (clip, f, reason, o) => ed.addException(clip, f, reason, o), setReview: (st, note) => ed.setReview(st, note),
      setEase: (e) => ed.setCorrectionEase(e), toggleCorrection: (k) => ed.toggleCorrection(k), setOnion: (o) => Object.assign(ed.onion, o),
      deformDrag: (att, fromW, toW, radiusPx = 40) => { ed.sel.attachment = att; ed.tool = 'deform'; ed.frame(0); const sp = ed.w2s(...fromW), r = ed.ovCanvas.getBoundingClientRect(); ed.brush.radius = radiusPx;
        ed.drag = { x: r.left + sp[0], y: r.top + sp[1], wx: fromW[0], wy: fromW[1], moved: true }; ed.deformDown({ clientX: r.left + sp[0], clientY: r.top + sp[1] }, ...fromW); ed.deformMove(...toW); ed.end(); ed.drag = null; ed.tool = 'select'; },
      remapDeformTest: (att) => { const old = ed.meshSnapshot(att); return { old, remap: () => ed.remapDeformKeys(att, old) }; },
      setHandSet: (side, name) => ed.setHandSet(side, name), suggestHandSets: (side, o) => ed.suggestHandSetKeys(side, o), handSetsUsed: (clip, side) => setsUsed(ed.rig, ed.rig.clips.get(clip), side),
      setSkin: (id) => { const r = ed.rig.setSkin(id); $(ed.panel, '#p2Skin').value = r; return r; }, paintPack: (skin) => ed.paintPack(skin), coverage: (skin) => jointCoverage(ed.project, ed.store, { skin }),
    };
  }
}

function heat(k, a) { const r = Math.round(255 * Math.min(1, k * 2)), gg = Math.round(255 * Math.min(1, 2 - k * 2) * 0.6 + 40 * (1 - k)), b = Math.round(255 * (1 - k)); return `rgba(${r},${gg},${b},${a})`; }
