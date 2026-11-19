// SlotCharacter: a thin wrapper around a Spine 4.2 skeleton built from the base rig.
// Requires the global `spine` (spine-webgl / spine-canvas / spine-pixi all expose the same core API).
//
//   const mage = new SlotCharacter(skeletonData);
//   mage.setWeapon('staff');                       // 'staff' | 'gun' | 'none'  -> switches skin, constraints and idle
//   await mage.play('staff/slam', { until: 'impact' });   // resolves when the event fires (or at the end if it never does)
//   each frame: mage.update(dt); then draw mage.skeleton with your renderer
//
// Game outcomes never depend on this: play() only reports when the presentation reached a marker.
export class SlotCharacter {
  constructor(skeletonData, { defaultMix = 0.12, blink = true } = {}) {
    this.skeleton = new spine.Skeleton(skeletonData);
    const sd = new spine.AnimationStateData(skeletonData); sd.defaultMix = defaultMix;
    this.state = new spine.AnimationState(sd);
    this.weapon = 'none'; this.listeners = new Set();
    this.state.addListener({ event: (entry, ev) => { for (const fn of this.listeners) fn(ev.data.name, entry.animation.name, entry.trackTime); } });
    this.skeleton.setToSetupPose();
    this.state.setAnimation(0, 'idle', true);
    if (blink && skeletonData.findAnimation('blink')) this.state.setAnimation(1, 'blink', true);
    this.update(0);
  }
  /** Name of the looping idle for the current weapon. */
  get idle() { return this.weapon === 'none' ? 'idle' : `${this.weapon}/idle`; }
  onEvent(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  setWeapon(weapon) {
    this.weapon = weapon;
    this.skeleton.setSkinByName(weapon === 'none' ? 'default' : weapon);
    // reset bones, slots AND constraint mixes: a skin change switches constraints off mid-blend, and an
    // inactive constraint cannot be mixed back to its setup value by the outgoing animation
    this.skeleton.setToSetupPose();
    this.state.setAnimation(0, this.idle, true);
  }
  /** Play a one-shot, then return to idle. Resolves at the `until` event, or when the clip completes. */
  play(name, { until = null, speed = 1 } = {}) {
    return new Promise((resolve) => {
      const entry = this.state.setAnimation(0, name, false); entry.timeScale = speed;
      let done = false; const finish = (why) => { if (done) return; done = true; off(); resolve({ animation: name, reason: why, time: entry.trackTime }); };
      const off = this.onEvent((ev, anim) => { if (anim === name && ev === until) finish(ev); });
      entry.listener = { complete: () => finish('complete'), interrupt: () => finish('interrupt') };
      this.state.addAnimation(0, this.idle, true, 0);
    });
  }
  update(dt) {
    this.state.update(dt); this.state.apply(this.skeleton);
    this.skeleton.update(dt); this.skeleton.updateWorldTransform(spine.Physics.update);
  }
}
