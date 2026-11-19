# Character Kit: a rigged 2D base for Spine 4.2

A production base for slot-game characters, and an app that builds new ones from it. Every character shares one
skeleton layout (bones, slots, skins, constraints, animations, events) in a three-quarter view facing right, with a
staff, a gun and an optional cape. The placeholder art is a plain figure in a T-shirt and trousers. Each part is its
own image drawn upright in the setup pose, so real art replaces it one PNG at a time without touching the rig.

## The app

`app.html` is a static page (no build step). `npm run viewer`, then open `/spine-base/app.html`.

- **Shape**: start from Human or Dwarf and move nine sliders (height, head, legs, arms, shoulders, build, hands,
  stance). The skeleton, grips and animations rebuild live in the real Spine 4.2 runtime, and the app replays the
  weapon animations on a hidden copy after every change to confirm the hands stay on the grips and the feet stay planted.
- **Art**: save the paint sheet (every part in its own box on a flat magenta background), paint over it, load it
  back; the parts are cut out by position and placed on the rig. Or replace one part at a time and nudge it.
- **Export**: one zip with `<Name>.json`, `.atlas`, `.png` for the runtime, `images/` for Import Data in the Spine
  editor, `template.png`, `paint-sheet.png`, `parts.json`, `ART-BRIEF.md` and `character.json`. The zip reopens in the app.

### Using it from another AI (ChatGPT, Codex) or a script

- **Art**: give the AI `paint-sheet.png` and `ART-BRIEF.md` from a kit. The brief states the layout, the
  near/far convention and the fist rules. Load what comes back with "Load painted sheet".
- **Shape**: the whole character is the small settings object shown in the Export tab and explained in the brief.
  An AI can write one; paste it into the app, or build it without the app:

```bash
node spine-base/generator/build.mjs --config my-character.json --out out/my-character
```

  `my-character.json` is either the settings object or a `character.json` from a saved kit (its `art/*.png` are read
  from beside it). Settings: `name`, `height` (units; 1 unit = 2 px at export) and ratios `head`, `headWidth`, `legs`,
  `arms`, `shoulders`, `build`, `hands`, `stance`, plus `cape` (true/false). Ranges are in `LIMITS` in `generator/rig.js`.

| | |
|---|---|
| App | `app.html`, `app/app.js`, `app/app.css`, `app/zip.js` |
| Kit builder shared by the app and the command line | `generator/kit.js` (atlas, Spine JSON, cape mesh, sheets, brief), `generator/rig.js` (proportions, bones, constraints, animations), `generator/pieces.js` (placeholder art) |
| Prebuilt base characters | `export/human/Base-Human.{json,atlas,png}`, `export/dwarf/Base-Dwarf.{json,atlas,png}` (+ `images/`, `character.json`) |
| Sheets and part lists for the base characters | `reference/<id>-template.png`, `-paint-sheet.png`, `-parts.json`, `-ART-BRIEF.md` |
| JS adapter for the game | `runtime/slot-character.js` |
| Side-by-side viewer | `runtime/viewer.html` |
| Checks | `scripts/validate.mjs` (rig, 60 checks), `scripts/app-test.mjs` (app, 16 checks) → `validation/` |

```bash
npm run base:build        # rebuild the two base characters
npm run base:validate     # load them in the Spine 4.2 web runtime and check everything
npm run base:app-test     # drive the app headlessly: sliders, zip round trip, paint-sheet round trip, screenshots
```

## The rig

**31 bones.** `root → hip → waist → chest → head`; per side `upper → forearm → hand` (on the chest) and
`thigh → shin → foot` (on the hip). "near" is the side toward the camera, "far" the side away from it.
Controllers: `foot-near-target`, `foot-far-target` (move these to step or jump; the legs follow and the
feet keep their angle), `staff` with `staff-grip-far`, `staff-grip-near`, `staff-foot`, `staff-head`, and
`gun` with `gun-grip-near`, `gun-muzzle`. The cape hangs on `cape-1 → cape-2 → cape-3 → cape-4` from the chest.

**16 body pieces**, back to front (the `cape` slot sits behind all of them): `upper-far`, `forearm-far`, `hand-far-back`, *(weapon-far)*,
`hand-far-front`, `thigh-far`, `shin-far`, `foot-far`, `pelvis`, `thigh-near`, `shin-near`, `foot-near`,
`torso`, `head`, *(eyelids)*, `upper-near`, `forearm-near`, *(weapon-near, muzzle-flash)*, `hand-near`.

**Hands.** A hand is a closed fist. Its bone starts at the wrist and points at the knuckles; the grip
axis is perpendicular to the bone and the grip point is `hand.grip` units from the wrist (24 human,
27 dwarf). The far hand is two pieces, palm behind the weapon and fingers in front, so a shaft sits
inside the fist. The near hand is one piece, because from the camera its back covers what it holds.

**Weapons are free bones; hands follow them.** A grip target marks where the wrist goes and which
way the hand points. Arms reach it with two-bone IK and a transform constraint locks the wrist angle,
so a hand cannot drift off a grip (validated to 0.00 units in every frame). You animate the weapon;
the arms take care of themselves.

**Weapons are skins.** `staff` (far hand; the near hand's IK mix is keyed 0 → 1 → 0 for the two-handed
slam), `gun` (near hand) and `default` (unarmed). Each skin switches on only its own constraints.
`staff` hangs on `root`, so it stays planted while the body moves; `gun` hangs on `hip`, so it travels
with the body.

**Joints.** A part that sits in front of its parent has no outline at its root end, and the torso carries the cap
of the near shoulder, so limbs read as continuous and a raised arm still has a shoulder.

**Cape.** One image on the `cape` slot, a weighted mesh across the four cape bones so it bends smoothly. Each bone
has a Spine 4.2 physics constraint (looser and heavier toward the hem), so the cape lags, swings and settles with
whatever the body does, and the idles add a slow breeze. It is hidden unless the character's settings turn it on;
`setCape(true/false)` toggles it at runtime with any weapon.

**Feet** are planted by leg IK (with stretch, so a rise never pops the knee) and their angle is locked
to the foot targets.

## Animations and events

| animation | skin | what happens | event |
|---|---|---|---|
| `idle`, `staff/idle`, `gun/idle` | matching | 2 s breathing loops | |
| `staff/slam` | staff | near hand joins, lift, drive down, crouch, recoil, release (0.9 s) | `impact` at 0.56 s |
| `gun/fire` | gun | raise to level, shot with muzzle flash, recoil, lower (0.8 s) | `fire` at 0.24 s |
| `hit` | any | knocked back and recover (0.5 s) | `hit` |
| `win` | any | crouch, jump, land, fist pump on whichever arm is free (1.2 s) | `land` at 0.54 s |
| `blink` | any | eyelid swap; loop it on track 1 | |

Body moves scale with leg length and reach moves with arm length, so the same clip is authored once
and built for both sizes.

## In the game (JavaScript)

```js
import { SlotCharacter } from './slot-character.js';      // needs the global `spine` from spine-webgl, spine-canvas or spine-pixi
const hero = new SlotCharacter(skeletonData);
hero.setWeapon('staff');                                   // 'staff' | 'gun' | 'none'
hero.setCape(true);                                        // optional; sways with Spine physics
await hero.play('staff/slam', { until: 'impact' });        // resolves when the staff hits; trigger the reel effect here
// every frame:
hero.update(dt);                                           // advances animation and physics; then draw hero.skeleton
```

`setWeapon` resets the skeleton to its setup pose before switching skins. That matters: a skin change
turns constraints off mid-blend, and an inactive constraint cannot be mixed back by the outgoing
animation (the validation covers switching weapons in the middle of a slam).

## Swapping in real art

Use the app's Art tab (paint sheet or one part at a time). What the artist needs to know is in `ART-BRIEF.md`:

1. Keep every part in its box at the same position, size and angle; the boxes are cut out by position.
2. Joints overlap. Paint each part complete, including the area hidden under its neighbour (the top of the thigh
   under the trousers, the shoulder under the torso, the neck under the head).
3. Hands are closed fists with the grip running across the hand. The far hand is painted twice, palm and fingers.
4. A painted head brings its own eyes, so the placeholder eyelids are dropped until an `eyes-closed` part is painted too.
5. Art can be any resolution; attachments are sized in skeleton units and the kit resamples to 2 px per unit.
6. Hair, robes and beards are extra slots on the existing bones; give long ones a bone and a physics constraint the
   way the cape has. A long robe replaces the leg parts with one skirt part on `hip` plus a hem bone.

## Verified

`scripts/validate.mjs` loads both base skeletons in the official Spine 4.2 web runtime and steps every animation at
60 Hz: identical structure on human and dwarf; hands on grips in every frame (wrist and angle); the fist centre on
the gun's grip point; feet planted; staff foot on the ground in idle and at the impact event; two-handed grip during
the slam and release after; barrel level at the shot, recoil after; events once at the right time; seamless idle
loops; weapon switching mid-animation; the cape hidden by default, shown as a weighted mesh, kept across a weapon
change, swinging during the slam and the jump and settling afterwards. 60 checks, all passing.

`scripts/app-test.mjs` drives the app: the five in-app rig checks pass for both presets and four extreme shapes, a
rebuild takes about 60 ms, the zip reads back byte for byte and reopens to the same skeleton, and the paint sheet
cut back into parts lands within one unit of the placeholders (also when returned at 1536×1024). 16 checks, all passing.

Not checked here: the Spine editor's own import of the files, frame rate on real devices, and a sheet actually
repainted by an image model (those drift from the boxes; the per-part nudge sliders are there for that).
