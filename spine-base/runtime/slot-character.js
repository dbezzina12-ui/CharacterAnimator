// SlotCharacter: a thin wrapper around a Spine 4.2 skeleton built from the base rig.
// Requires the global `spine` (spine-webgl / spine-canvas / spine-pixi all expose the same core API).
//
//   const mage = new SlotCharacter(skeletonData);
//   mage.setWeapon('staff');                       // 'staff' | 'gun' | 'none'  -> switches skin, constraints and idle
//   mage.setCape(true);                            // true | false | 'back' | 'wrap'  (capes sway with Spine physics)
//   await mage.play('staff/slam', { until: 'impact' });   // resolves when the event fires (or at the end if it never does)
//   each frame: mage.update(dt); then draw mage.skeleton with your renderer
//
// Game outcomes never depend on this: play() only reports when the presentation reached a marker.
const CAPE_SLOTS = ['cape', 'cape-collar', 'cape-far', 'cape-mantle', 'cape-near'];   // 'back' uses the first, 'wrap' (vampire cape) all five
export class SlotCharacter {
  constructor(skeletonData, { defaultMix = 0.12, blink = true } = {}) {
    this.skeleton = new spine.Skeleton(skeletonData);
    const sd = new spine.AnimationStateData(skeletonData); sd.defaultMix = defaultMix;
    this.state = new spine.AnimationState(sd);
    this.weapon = 'none'; this.listeners = new Set();
    const worn = CAPE_SLOTS.filter((n) => skeletonData.findSlot(n)?.attachmentName);   // the kit decides which cape, if any, starts on
    this.capeStyle = worn.length > 1 ? 'wrap' : 'back'; this.cape = worn.length ? this.capeStyle : false;
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
    this.skeleton.setToSetupPose(); this.setCape(this.cape);
    this.state.setAnimation(0, this.idle, true);
  }
  /** Show or hide the cape: true = the style this character was built with, or name one ('back', 'wrap'). Works with any weapon. */
  setCape(on) {
    this.cape = on === true ? this.capeStyle : on === 'back' || on === 'wrap' ? on : false;
    for (const name of CAPE_SLOTS) { const slot = this.skeleton.findSlot(name); if (slot) slot.setAttachment(this.cape && (name === 'cape' || this.cape === 'wrap') ? this.skeleton.getAttachmentByName(name, name) : null); }
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
