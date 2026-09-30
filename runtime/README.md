# Gamboligy 2D character runtime

`gamboligy-character2d.js` is a single dependency-free ES module (≈34 KB) that plays
**gamboligy.character2d-runtime/1.0** packages exported by the CharacterAnimator 2D editor
(*Export runtime package*, or `node scripts/export-2d.mjs`). It needs WebGL and nothing else: no
editor, no three.js, no 3D model. Our JSON is its own format; it is not a Spine export.

## Package contents

```
<id>.runtime.json   bones, slots, attachments (meshes + weights), skins, hand controls, constraints,
                    props, clips (baked tracks + artist corrections), events, atlas rectangles
atlas_0.png …       atlas pages (straight alpha, 2 px padding, 1 px edge extrusion)
player/             a copy of this runtime + README (optional)
```

Reference images, editor camera/state and undo history are never exported.

## API

```js
import { Character2D, run } from './gamboligy-character2d.js';

const ch = await Character2D.load('package/aureate_knight_2d.runtime.json', { canvas });
ch.clips;                       // [{ name, duration, loop }]
ch.play('walk_in_place', { loop: true });
ch.pause(); ch.resume();
ch.seek(0.5);                   // seconds; never fires events
ch.setSpeed(1.5);
ch.setSkin('default');          // skins are attachment replacement maps
ch.setProp('prop_R', 'prop_R.Staff');     // or null to hide, undefined to let the clip decide
ch.setAttachment('hand_R', 'hand_R.fist');
const off = ch.on('button_down', (e) => console.log(e.clip, e.time)); // '*' = every event
ch.update(dt);                  // advance; returns the events fired
ch.draw({ x: 0, y: 560, zoom: 0.8 });   // project point at canvas centre, screen px per project px
const stop = run(ch, { x: 0, y: 560, zoom: 0.8 });   // or let run() drive update + draw
```

`ch.pose()` returns the evaluated pose (slot attachments, draw order, contacts) if you render
yourself; `ch.rig.skinAttachment(id, pose)` gives deformed vertex positions.

## Coordinates and evaluation

* Project pixels, +x right, **+y up**, origin = ground point under the character; angles in degrees CCW.
* Evaluation order per frame: setup pose → clip tracks (offsets) → corrections layer → hand controls →
  slot attachments (+ skin) → world transforms → constraints in their declared `order` →
  draw order (correction key if present, else baked key, else setup) → mesh skinning.
* Deterministic: a pose depends only on the package, the clip, the time and your overrides.

## Event rules

* During `update(dt)` an event fires when playback crosses it: `previous < t_event <= now`.
* A looping clip that wraps fires the events up to its end, then events at exactly `t = 0`, then the
  events after the wrap. `play()` from time 0 fires events at `t = 0`.
* `seek()` never fires events (scrubbing tools use `player.eventsBetween(a, b)`).

## Example

`example/index.html` loads `example/package/` (the knight). Serve the repository root
(`npm run viewer`) and open `http://localhost:8765/runtime/example/`.
