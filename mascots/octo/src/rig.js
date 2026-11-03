// Playback controller: owns the clock, fires clip markers exactly once per live pass, and exposes
// the same adapter shape as the Olaf game (`play(name)` resolves at the clip's `resolveAt` marker,
// e.g. 'contact' for a swing). Seeking/scrubbing never fires markers; outcomes stay elsewhere.
import { solvePose } from './solver.js';
import { drawPose, drawSkeleton } from './renderer.js';
import { CLIPS } from './clips.js';

export function createRig({ clips = CLIPS, onMarker = null, eventTarget = (typeof window !== 'undefined' ? window : null), eventPrefix = 'octo' } = {}) {
  const state = {
    clip: 'idle', time: 0, playing: false, speed: 1, loop: null,  // loop: null = clip default
    lastPose: null,
  };
  let pending = null;   // { resolve, marker } for play() promises

  function clip() { return clips[state.clip]; }
  function loops() { return state.loop ?? clip().loop; }

  function fire(name, t) {
    const detail = { clip: state.clip, marker: name, time: t };
    if (onMarker) onMarker(detail);
    if (eventTarget?.dispatchEvent) eventTarget.dispatchEvent(new CustomEvent(`${eventPrefix}:${name}`, { detail }));
    if (pending && pending.marker === name) { const p = pending; pending = null; p.resolve(detail); }
  }

  /** Advance the clock by dt seconds (already scaled by speed). Skipped frames still fire every marker. */
  function advance(dt) {
    if (!state.playing || dt <= 0) return;
    const c = clip(); const dur = c.duration;
    const from = state.time; let to = from + dt * state.speed;
    const markers = Object.entries(c.markers || {});
    const fireBetween = (a, b, offset = 0) => {
      for (const [name, mt] of markers) if (mt > a && mt <= b) fire(name, mt + offset);
    };
    if (loops()) {
      let a = from, remaining = to - from;
      while (remaining > 0) {
        const b = Math.min(dur, a + remaining);
        fireBetween(a, b);
        remaining -= (b - a);
        if (b >= dur) { fire('loop', dur); a = 0; } else a = b;
      }
      state.time = ((to % dur) + dur) % dur;
    } else {
      fireBetween(from, Math.min(to, dur));
      if (to >= dur) { state.time = dur; state.playing = false; fire('end', dur); }
      else state.time = to;
    }
  }

  return {
    state, clips,
    /** Start a clip from 0. Resolves at `resolveAt` (a marker name) or at the end of the clip. */
    play(name, { resolveAt = null, speed = null, loop = null } = {}) {
      if (!clips[name]) throw new Error(`unknown clip ${name}`);
      if (pending) { const p = pending; pending = null; p.resolve({ clip: state.clip, marker: 'interrupted', time: state.time }); }
      state.clip = name; state.time = 0; state.playing = true; state.loop = loop;
      if (speed != null) state.speed = speed;
      const marker = resolveAt || (clips[name].loop ? 'loop' : 'end');
      return new Promise((resolve) => { pending = { resolve, marker }; });
    },
    pause() { state.playing = false; },
    resume() { if (state.time >= clip().duration && !loops()) state.time = 0; state.playing = true; },
    /** Scrub: sets the time without firing any marker. */
    seek(t) { const dur = clip().duration; state.time = loops() ? ((t % dur) + dur) % dur : Math.max(0, Math.min(dur, t)); },
    setSpeed(s) { state.speed = Math.max(0, s); },
    advance,
    pose(t = state.time) { state.lastPose = solvePose(clip(), t); return state.lastPose; },
    draw(ctx, view, { skeleton = false, hidden = null, time = state.time } = {}) {
      const pose = this.pose(time);
      drawPose(ctx, pose, view, hidden);
      if (skeleton) drawSkeleton(ctx, pose, view);
      return pose;
    },
  };
}

/** Browser helper: drives a rig from requestAnimationFrame and redraws only while playing/dirty. */
export function animate(rig, render, { clock = () => performance.now() / 1000 } = {}) {
  let last = clock(); let dirty = true; let raf = 0; let shownT = -1, shownClip = null;
  function frame() {
    const now = clock(); const dt = Math.min(0.25, now - last); last = now;   // clamp long tab-away gaps
    if (rig.state.playing) rig.advance(dt);
    if (rig.state.time !== shownT || rig.state.clip !== shownClip) dirty = true;   // seek()/play() from anywhere redraws
    if (dirty) { render(); dirty = false; shownT = rig.state.time; shownClip = rig.state.clip; }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return { invalidate() { dirty = true; }, stop() { cancelAnimationFrame(raf); } };
}
