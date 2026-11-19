# Base 2D character rig (Spine 4.2) — human and dwarf

A production base for slot-game characters: two Spine 4.2 skeletons with the same bones, slots,
skins, constraints, animations and events, in a three-quarter view facing right. The art is a neutral
mannequin. Every piece is a plain region attachment drawn upright in the setup pose, so real art
replaces it one PNG at a time without touching the rig.

| | |
|---|---|
| Spine data | `export/human/Base-Human.{json,atlas,png}`, `export/dwarf/Base-Dwarf.{json,atlas,png}` (+ loose `images/` for Import Data in the editor) |
| Template sheets for artists | `reference/human-template.png`, `reference/dwarf-template.png` |
| Piece list (size, pivot, bone, slot) | `reference/<id>-parts.json` |
| JS adapter | `runtime/slot-character.js` |
| Viewer / test harness | `runtime/viewer.html` (`npm run viewer`, open `/spine-base/runtime/viewer.html`) |
| Generator (proportions are data) | `generator/rig.mjs`, `generator/pieces.js`, `generator/build.mjs` |
| Runtime validation (52 checks) | `scripts/validate.mjs` → `validation/report.json`, pose strips, `validation/demo.mp4` |

```bash
node spine-base/generator/build.mjs      # rebuild both characters after changing proportions
node spine-base/scripts/validate.mjs     # load in the Spine 4.2 web runtime and check everything
```

## The rig

**27 bones.** `root → hip → waist → chest → head`; per side `upper → forearm → hand` (on the chest) and
`thigh → shin → foot` (on the hip). "near" is the side toward the camera, "far" the side away from it.
Controllers: `foot-near-target`, `foot-far-target` (move these to step or jump; the legs follow and the
feet keep their angle), `staff` with `staff-grip-far`, `staff-grip-near`, `staff-foot`, `staff-head`, and
`gun` with `gun-grip-near`, `gun-muzzle`.

**16 body pieces**, back to front: `upper-far`, `forearm-far`, `hand-far-back`, *(weapon-far)*,
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
await hero.play('staff/slam', { until: 'impact' });        // resolves when the staff hits; trigger the reel effect here
// every frame:
hero.update(dt);                                           // then draw hero.skeleton with your Spine renderer
```

`setWeapon` resets the skeleton to its setup pose before switching skins. That matters: a skin change
turns constraints off mid-blend, and an inactive constraint cannot be mixed back by the outgoing
animation (the validation covers switching weapons in the middle of a slam).

## Swapping in real art

1. Paint over the template sheet for the size you need. Keep every piece where it is and the same
   canvas size, upright as assembled; the red cross is the pivot and must stay under the joint.
2. Joints overlap. Give each limb piece a rounded end that covers the joint circle, and paint the area
   hidden under the neighbouring piece (the top of the thigh under the pelvis, the shoulder under the torso).
3. Hands: paint closed fists with the grip running across the hand. Paint the far hand twice, palm and
   fingers, as on the sheet.
4. Export each piece with the same file name into `images/`, at any resolution. Attachments are sized in
   skeleton units, so 2x or 4x art needs no rig change. Repack the atlas.
5. Hair, capes, robes and beards are extra slots on the existing bones; give them a bone and a Spine
   physics constraint as in the Night Fall mage. A long robe replaces the leg pieces with one skirt piece
   on `hip` plus a `hem` bone.

Different proportions (a taller hero, a stockier dwarf) are a change to the joints table in
`generator/rig.mjs` and a rebuild; grips, pieces and animations follow.

## Verified

`scripts/validate.mjs` loads both skeletons in the official Spine 4.2 web runtime and steps every
animation at 60 Hz: identical structure on human and dwarf; hands on grips in every frame (wrist and
angle); the fist centre on the gun's grip point; feet planted; staff foot on the ground in idle and at
the impact event; two-handed grip during the slam and release after; barrel level at the shot, recoil
after; events once at the right time; seamless idle loops; weapon switching mid-animation. 52 checks,
all passing. Not checked here: the Spine editor's own view of the files, and frame rate on devices.
