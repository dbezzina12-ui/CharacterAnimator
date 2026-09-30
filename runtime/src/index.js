// Gamboligy 2D character runtime: plays gamboligy.character2d-runtime/1.0 packages exported by the
// CharacterAnimator 2D editor. No editor, no three.js, no 3D data — just the package JSON + atlas pages.
import { Rig, Player, RUNTIME_SCHEMA, frameTimes } from '../../viewer/js/art2d/core.js';
import { Renderer2D } from '../../viewer/js/art2d/render2d.js';

export { RUNTIME_SCHEMA, frameTimes };

export class Character2D {
  /**
   * Load a package. `source`: URL of <id>.runtime.json (atlas pages resolve next to it) or
   * { json, resolve(path) -> URL }. `canvas`: the canvas to draw into (WebGL).
   */
  static async load(source, { canvas, background = null } = {}) {
    let json, resolve;
    if (typeof source === 'string') {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`could not load ${source} (${res.status})`);
      json = await res.json();
      const base = new URL(source, globalThis.location?.href);
      resolve = (p) => new URL(p, base).href;
    } else ({ json, resolve } = source);
    if (typeof json.schema !== 'string' || json.schema.split('/')[0] !== RUNTIME_SCHEMA.split('/')[0]) throw new Error(`not a runtime package (schema "${json.schema}")`);
    if (Number(json.schema.split('/')[1]) >= 2) throw new Error(`package schema ${json.schema} is newer than this runtime (${RUNTIME_SCHEMA})`);
    const ch = new Character2D(json, canvas, background);
    await ch.renderer.loadImages(json, resolve);
    return ch;
  }

  constructor(pkg, canvas, background) {
    this.pkg = pkg;
    this.rig = new Rig(pkg);
    this.player = new Player(this.rig);
    this.renderer = canvas ? new Renderer2D(canvas, { background }) : null;
    this.overrides = {};                 // slot -> attachment id | null (props, swaps)
    this.speed = 1;
    this.listeners = new Map();
    this.player.on((e) => { for (const fn of this.listeners.get(e.name) || []) fn(e); for (const fn of this.listeners.get('*') || []) fn(e); });
  }

  /** Clip names with duration/loop. */
  get clips() { return this.pkg.clips.map((c) => ({ name: c.name, duration: c.duration, loop: !!c.loop })); }
  get skins() { return (this.pkg.skins || [{ id: 'default' }]).map((s) => s.id); }
  get time() { return this.player.time; }
  get clip() { return this.player.clip?.name ?? null; }

  play(name, { loop, time = 0 } = {}) { this.player.play(name, { loop, time }); return this; }
  pause() { this.player.pause(); return this; }
  resume() { this.player.resume(); return this; }
  /** Jump to time t (seconds). Seeking never fires events (see README: event rules). */
  seek(t) { this.player.seek(t); return this; }
  setSpeed(s) { this.speed = s; return this; }
  setSkin(id) { return this.rig.setSkin(id); }
  /** Show an attachment in a slot (or null to hide it), overriding the clip; `undefined` restores the clip. */
  setAttachment(slot, attachmentId) { if (attachmentId === undefined) delete this.overrides[slot]; else this.overrides[slot] = attachmentId; return this; }
  /** Props are attachments of prop slots, e.g. setProp('prop_R', 'prop_R.Sword2H'). */
  setProp(slot, attachmentId) { return this.setAttachment(slot, attachmentId); }
  propsFor(slot) { return Object.values(this.pkg.attachments).filter((a) => a.slot === slot).map((a) => a.id); }
  /** on('footstep', fn) for one event name, on('*', fn) for all. Returns an unsubscribe function. */
  on(name, fn) { const l = this.listeners.get(name) || []; l.push(fn); this.listeners.set(name, l); return () => this.listeners.set(name, (this.listeners.get(name) || []).filter((f) => f !== fn)); }

  /** Advance playback by dt seconds (scaled by speed); returns the events fired. */
  update(dt) { return this.player.update(dt * this.speed); }
  /** Evaluate the current pose (deterministic: depends only on clip, time and overrides). */
  pose() { return this.player.clip ? this.player.evaluate({ slotAttachments: this.overrides }) : this.rig.evaluate(null, 0, { slotAttachments: this.overrides }); }
  /**
   * Draw the current pose. view: { x, y } = project point at the canvas centre, zoom = screen px per
   * project px. Project units: px, +y up, origin = ground point under the character.
   */
  draw(view = null, opts = {}) {
    if (!this.renderer) throw new Error('no canvas given to Character2D.load');
    if (view) this.renderer.view = view;
    this.renderer.fit(opts.dpr);
    return this.renderer.draw(this.rig, this.pose(), { dpr: opts.dpr, clear: opts.clear });
  }
}

/** Convenience loop: calls ch.update + ch.draw every animation frame until the returned stop() is called. */
export function run(ch, view) {
  let last = performance.now(), on = true;
  const tick = (now) => { if (!on) return; requestAnimationFrame(tick); ch.update(Math.min(0.1, (now - last) / 1000)); last = now; ch.draw(typeof view === 'function' ? view() : view); };
  requestAnimationFrame(tick);
  return () => { on = false; };
}
