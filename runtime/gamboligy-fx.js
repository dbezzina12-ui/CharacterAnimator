// Gamboligy character FX — procedural 2D effects (lightning, fire) driven by a Character2D's clip and time.
//
//   import { CharacterFX } from './gamboligy-fx.js';
//   const fx = new CharacterFX(character, overlayCanvas, effectsJson);   // overlay sits on top of the character canvas
//   // every frame, right after character.draw(view):
//   fx.draw(view, { dpr });
//
// Effects are listed per clip in the effects JSON (characters2d/<id>/effects.json) and anchored to markers of the
// attachment shown in a slot (e.g. the sword's `tip`, the staff's `butt` and `tip`), so they follow whichever art is
// shown (starter or painted). Timing comes from the clip's named events (`raised`, `lower`, `impact` …). Everything is
// a pure function of (clip, time): scrubbing, frame-stepping and looping show exactly the same frames.
// No dependencies; Canvas 2D only.

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a || 1e-9)); return t * t * (3 - 2 * t); };
function hash(...n) { let h = 2166136261; for (const x of n) { h ^= Math.round(x * 1000) | 0; h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hexRGB(hex) { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

/** Jagged lightning polyline from a to b (midpoint displacement), in screen px. */
function boltPath(ax, ay, bx, by, r, rough = 0.2, depth = 6) {
  let pts = [[ax, ay], [bx, by]], d = Math.hypot(bx - ax, by - ay) * rough;
  for (let k = 0; k < depth; k++) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, o = (r() * 2 - 1) * d;
      out.push([(x0 + x1) / 2 - (dy / L) * o, (y0 + y1) / 2 + (dx / L) * o], [x1, y1]);
    }
    pts = out; d *= 0.55;
  }
  return pts;
}

export class CharacterFX {
  constructor(character, canvas, effects) {
    this.ch = character; this.canvas = canvas; this.g = canvas.getContext('2d');
    this.effects = effects?.clips || {};
    this.enabled = true;
    this.sprites = {};
  }

  /** Clips that have effects. */
  get clips() { return Object.keys(this.effects); }

  // ---------------------------------------------------------------- helpers
  _sprite(hex) {                       // soft round particle, cached per colour
    if (this.sprites[hex]) return this.sprites[hex];
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), [r, gg, b] = hexRGB(hex), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, `rgba(${r},${gg},${b},1)`); grd.addColorStop(0.35, `rgba(${r},${gg},${b},0.55)`); grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return (this.sprites[hex] = c);
  }
  _eventTime(clip, name, fallback) {
    if (typeof name === 'number') return name;
    const e = (clip.tracks?.events || []).concat(clip.corrections?.events || []).find((x) => x.name === name);
    return e ? e.t : fallback;
  }
  /** World point of a named marker (or 'origin' = the attachment's pivot) of the attachment shown in `slot`. */
  _anchor(pose, slot, marker) {
    const rig = this.ch.rig, si = rig.slotIndex.get(slot); if (si === undefined) return null;
    const id = pose.slotAttachment[si], a = id && rig.project.attachments[id]; if (!a) return null;
    if (marker === 'origin') { const T = a.transform || {}; return rig.worldPoint(a.bone, T.x || 0, T.y || 0); }
    return rig.markerWorld(id, marker);
  }
  _glow(x, y, rad, hex, alpha) {
    const g = this.g, [r, gg, b] = hexRGB(hex), grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(${r},${gg},${b},${alpha})`); grd.addColorStop(0.4, `rgba(${r},${gg},${b},${alpha * 0.35})`); grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
  }
  _bolt(pts, w, hex, alpha) {
    const g = this.g; g.lineJoin = 'round'; g.lineCap = 'round';
    const pass = (lw, c, a) => { g.globalAlpha = clamp01(a); g.strokeStyle = c; g.lineWidth = lw; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
    pass(w * 7, hex, alpha * 0.12); pass(w * 2.6, hex, alpha * 0.45); pass(w, '#ffffff', alpha);
    g.globalAlpha = 1;
  }
  _flash(hex, alpha) {
    if (alpha <= 0.002) return;
    const g = this.g; g.save(); g.globalCompositeOperation = 'source-over'; g.globalAlpha = clamp01(alpha); g.fillStyle = hex;
    g.fillRect(0, 0, this.W, this.H); g.restore();
  }

  // ---------------------------------------------------------------- frame
  draw(view, { dpr = globalThis.devicePixelRatio || 1 } = {}) {
    const c = this.canvas, W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = this.g; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
    const name = this.ch.clip, list = this.enabled && name ? this.effects[name] : null;
    if (!list?.length) return;
    const clip = this.ch.pkg.clips.find((x) => x.name === name), t = this.ch.time, pose = this.ch.pose();
    this.W = W; this.H = H; this.zoom = view.zoom;
    this.toScreen = (p) => [W / 2 + (p[0] - view.x) * view.zoom, H / 2 - (p[1] - view.y) * view.zoom];
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'lighter';
    for (const fx of list) {
      const fn = this['_' + fx.type]; if (!fn) continue;
      g.save(); fn.call(this, fx, clip, t, pose); g.restore();
    }
    g.globalCompositeOperation = 'source-over';
  }

  // ---------------------------------------------------------------- effects
  /** Two-handed raise: charge at the tip, then lightning from the sky strikes the raised sword; arcs crawl the blade. */
  _skyLightning(fx, clip, t, pose) {
    const on = this._eventTime(clip, fx.on, 1), off = this._eventTime(clip, fx.off, clip.duration), col = fx.color || '#8fd3ff';
    const charge = fx.charge ?? 0.6, fade = fx.fadeOut ?? 0.35;
    if (t < on - charge || t > off + fade) return;
    const o = this._anchor(pose, fx.slot || 'prop_R', 'origin'), tip = this._anchor(pose, fx.slot || 'prop_R', fx.to || 'tip'); if (!o || !tip) return;
    const z = this.zoom, [ox, oy] = this.toScreen(o), [tx, ty] = this.toScreen(tip), gs = fx.guard ?? 0.08;
    const gx = ox + (tx - ox) * gs, gy = oy + (ty - oy) * gs;
    const live = smooth(on - 0.05, on + 0.05, t) * (1 - smooth(off, off + fade, t));
    const frame = Math.floor(t * 24);                                    // lightning re-forms 24 times a second
    // charge: sparks drawn in toward the tip and a growing glow
    const ch = smooth(on - charge, on, t) * (1 - smooth(on, on + 0.1, t));
    if (ch > 0) {
      this._glow(tx, ty, 70 * z * (0.4 + ch), col, 0.55 * ch);
      const r = rng(hash(frame, 7));
      for (let i = 0; i < 6; i++) { const a = r() * TAU, d = (40 + 80 * r()) * z * (1 - ch * 0.6); this._bolt(boltPath(tx + Math.cos(a) * d, ty + Math.sin(a) * d, tx, ty, r, 0.25, 3), 1.2 * z * 2, col, 0.5 * ch); }
    }
    if (live <= 0) return;
    // blade glow and crawling arcs
    this._bolt([[gx, gy], [tx, ty]], 3 * z * 2, col, 0.35 * live);
    const ra = rng(hash(frame, 11));
    for (let k = 0; k < 3; k++) {
      const s0 = ra() * 0.7, s1 = Math.min(1, s0 + 0.15 + ra() * 0.3);
      const p0 = [gx + (tx - gx) * s0, gy + (ty - gy) * s0], p1 = [gx + (tx - gx) * s1, gy + (ty - gy) * s1];
      this._bolt(boltPath(p0[0], p0[1], p1[0], p1[1], ra, 0.35, 4), 1.1 * z * 2, col, 0.85 * live);
    }
    this._glow(tx, ty, (90 + 25 * Math.sin(t * 31)) * z, col, 0.5 * live);
    // strikes from the sky: the first at `on`, then on a fixed pseudo-random schedule until `off`
    const rs = rng(hash(clip.duration, 3)), strikes = [on], [a, b] = fx.strikeEvery || [0.35, 0.75];
    while (strikes[strikes.length - 1] < off - 0.1) strikes.push(strikes[strikes.length - 1] + a + rs() * (b - a));
    const dur = fx.strikeLength ?? 0.16;
    for (const [i, s] of strikes.entries()) {
      if (t < s || t > s + dur) continue;
      const k = 1 - (t - s) / dur, big = i === 0 ? 1.6 : 1, r = rng(hash(i, Math.floor(t * 40)));
      const sx = tx + (r() * 2 - 1) * 260 * z, sy = -40;
      const main = boltPath(sx, sy, tx, ty, r, 0.18, 7);
      this._bolt(main, 2.2 * z * 2 * big, col, k);
      for (let j = 0; j < 3; j++) {                                      // branches off the main bolt
        const p = main[Math.floor(main.length * (0.2 + 0.5 * r()))], ang = Math.atan2(ty - sy, tx - sx) + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.6), L = (60 + 140 * r()) * z;
        this._bolt(boltPath(p[0], p[1], p[0] + Math.cos(ang) * L, p[1] + Math.sin(ang) * L, r, 0.3, 4), 1.1 * z * 2, col, 0.7 * k);
      }
      this._glow(tx, ty, 160 * z * big, '#ffffff', 0.35 * k);
      this._flash(col, (i === 0 ? 0.28 : 0.1) * k);
    }
  }

  /** One-handed raise: the blade catches fire from the guard to the tip and burns; embers rise. */
  _bladeFire(fx, clip, t, pose) {
    const on = this._eventTime(clip, fx.on, 1), off = this._eventTime(clip, fx.off, clip.duration);
    const ignite = fx.ignite ?? 0.35, fade = fx.fadeOut ?? 0.4, heat = fx.heat ?? 0.5;
    if (t < on - heat || t > off + fade) return;
    const o = this._anchor(pose, fx.slot || 'prop_R', 'origin'), tip = this._anchor(pose, fx.slot || 'prop_R', fx.to || 'tip'); if (!o || !tip) return;
    const z = this.zoom, [ox, oy] = this.toScreen(o), [tx, ty] = this.toScreen(tip), gs = fx.guard ?? 0.08;
    const gx = ox + (tx - ox) * gs, gy = oy + (ty - oy) * gs, bx = tx - gx, by = ty - gy, BL = Math.hypot(bx, by) || 1, nx = -by / BL, ny = bx / BL;
    // heat: the blade glows orange before it ignites
    const hot = smooth(on - heat, on, t) * (1 - smooth(off, off + fade, t));
    if (hot > 0) this._bolt([[gx, gy], [tx, ty]], 4 * z * 2, '#ff7a1a', 0.45 * hot);
    const lit = smooth(on, on + ignite, t), out = smooth(off, off + fade, t);
    const sMax = lit * (1 - out * 0.9);                                  // ignites guard → tip, dies back toward the guard
    if (sMax <= 0.01) return;
    const N = fx.particles ?? 150, cols = fx.colors || ['#fff4c2', '#ffc23a', '#ff6a1c', '#c8260f'], rise = (fx.rise ?? 170) * z, spread = (fx.spread ?? 46) * z;
    const sprites = cols.map((h) => this._sprite(h));
    for (let i = 0; i < N; i++) {
      const r = rng(hash(i, 5)), s = r() * sMax, phase = r(), life = 0.35 + 0.35 * r(), age = (t / life + phase) % 1;
      const side = (r() - 0.5) * spread * (1 - 0.5 * age), sway = Math.sin(t * 9 + phase * TAU) * 16 * z * age;
      const x = gx + bx * s + nx * side + sway, y = gy + by * s + ny * side - rise * age * (0.6 + 0.6 * r());
      const size = (fx.size ?? 58) * z * (1 - age) ** 0.7 * (0.6 + 0.8 * r()) * (0.75 + 0.25 * lit);
      const ci = Math.min(cols.length - 1, Math.floor((0.12 + age * 0.75 + 0.13 * r()) * cols.length));   // young = white-hot, old = red
      this.g.globalAlpha = clamp01((1 - age) * 0.55 * (1 - out));
      this.g.drawImage(sprites[ci], x - size, y - size, size * 2, size * 2);
    }
    for (let i = 0; i < (fx.embers ?? 28); i++) {                       // embers drift up and away
      const r = rng(hash(i, 9)), life = 1 + r(), age = (t / life + r()) % 1, s = r() * sMax;
      const x = gx + bx * s + Math.sin(t * 3 + i) * 20 * z * age + (r() - 0.5) * 30 * z, y = gy + by * s - (180 + 120 * r()) * z * age;
      this.g.globalAlpha = clamp01((1 - age) * (1 - out)); this.g.fillStyle = age < 0.5 ? '#ffd27a' : '#ff7a2a';
      this.g.fillRect(x, y, 2.2 * z * 2, 2.2 * z * 2);
    }
    this.g.globalAlpha = 1;
    this._glow(gx + bx * sMax * 0.6, gy + by * sMax * 0.6, 220 * z * sMax, '#ff8a2a', 0.22 * (1 - out));
  }

  /** Staff pounded: a bolt bursts from the butt and coils up the staff like a snake; ground cracks, a shockwave, a burst at the tip. */
  _groundSnake(fx, clip, t, pose) {
    const on = this._eventTime(clip, fx.on, 0.6), climb = fx.climb ?? 0.3, fade = fx.fadeOut ?? 0.45, col = fx.color || '#a7e4ff';
    const pre = this._eventTime(clip, fx.charge ?? 'lift', on - 0.25), end = Math.min(clip.duration, on + climb + (fx.hold ?? 0.25) + fade);
    if (t < pre || t > end + 1e-6) return;
    const base = this._anchor(pose, fx.slot || 'prop_R', fx.base || 'butt'), top = this._anchor(pose, fx.slot || 'prop_R', fx.top || 'tip'); if (!base || !top) return;
    const z = this.zoom, [ax, ay] = this.toScreen(base), [bx, by] = this.toScreen(top), frame = Math.floor(t * 30);
    // wind-up: the staff head crackles while it is lifted
    if (t < on) { const k = smooth(pre, on, t); this._glow(bx, by, 60 * z * k, col, 0.6 * k); const r = rng(hash(frame, 2)); for (let i = 0; i < 3; i++) { const a = r() * TAU, d = 50 * z; this._bolt(boltPath(bx, by, bx + Math.cos(a) * d, by + Math.sin(a) * d, r, 0.3, 3), 1 * z * 2, col, 0.6 * k); } return; }
    const u = t - on, fadeK = 1 - smooth(end - fade, end, t);
    // impact: ground cracks, shockwave ring, flash
    const ring = smooth(0, 0.4, u), rr = (40 + 260 * ring) * z;
    this.g.globalAlpha = clamp01(0.8 * (1 - ring)); this.g.strokeStyle = col; this.g.lineWidth = 6 * z * 2 * (1 - ring) + 1;
    this.g.beginPath(); this.g.ellipse(ax, ay, rr, rr * 0.22, 0, 0, TAU); this.g.stroke(); this.g.globalAlpha = 1;
    if (u < 0.32) {
      const r = rng(hash(frame, 4)), k = 1 - u / 0.32;
      for (let i = 0; i < 5; i++) { const dir = i % 2 ? 1 : -1, L = (90 + 160 * r()) * z; this._bolt(boltPath(ax, ay, ax + dir * L, ay + (r() - 0.3) * 30 * z, r, 0.22, 5), 1.4 * z * 2, col, k); }
      this._flash(col, 0.3 * k * k);
    }
    // the snake: a helix around the staff, head climbing butt → tip, crackling as it goes
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    const head = smooth(0, climb, u), turns = fx.turns ?? 3, R = (fx.radius ?? 55) * z, spin = 12, segs = 120;
    const r = rng(hash(frame, 6)), runs = [];                            // runs of points in front of / behind the staff
    let last = null;
    for (let i = 0; i <= segs; i++) {
      const s = (i / segs) * head, ang = turns * TAU * s - spin * u, rad = R * (1 - 0.35 * s) * (0.6 + 0.4 * smooth(0, 0.06, s));
      const x = ax + dx * s + nx * Math.sin(ang) * rad + (r() - 0.5) * 7 * z, y = ay + dy * s + ny * Math.sin(ang) * rad + (r() - 0.5) * 7 * z;
      const f = Math.cos(ang) > 0, run = runs[runs.length - 1];
      if (!run || run.f !== f) runs.push({ f, pts: last ? [last, [x, y]] : [[x, y]] }); else run.pts.push([x, y]);
      last = [x, y];
    }
    for (const run of runs) if (!run.f && run.pts.length > 1) this._bolt(run.pts, 1.4 * z * 2, col, 0.4 * fadeK);
    for (const run of runs) if (run.f && run.pts.length > 1) this._bolt(run.pts, 2.8 * z * 2, col, fadeK);
    this._bolt([[ax, ay], [ax + dx * head, ay + dy * head]], 3 * z * 2, col, 0.25 * fadeK);    // the staff itself glows where the coil has passed
    const prev = last && { x: last[0], y: last[1] };
    if (prev) this._glow(prev.x, prev.y, 55 * z, '#ffffff', 0.6 * fadeK * (head < 1 ? 1 : 0.5));
    // burst at the tip when the snake arrives
    const bu = u - climb;
    if (bu >= 0) {
      const k = 1 - smooth(0, 0.35, bu), rb = rng(hash(frame, 8));
      this._glow(bx, by, (90 + 140 * (1 - k)) * z, col, 0.8 * k * fadeK + 0.25 * fadeK);
      for (let i = 0; i < 7; i++) { const a = rb() * TAU, d = (70 + 120 * rb()) * z * (0.5 + (1 - k)); this._bolt(boltPath(bx, by, bx + Math.cos(a) * d, by + Math.sin(a) * d, rb, 0.3, 4), 1.2 * z * 2, col, 0.9 * k); }
      this._flash(col, 0.18 * k * k);
    }
  }
}
