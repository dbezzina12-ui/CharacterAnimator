# 2D artwork mode

CharacterAnimator now has two modes, chosen at the top of the side panel: **3D character** (unchanged)
and **2D artwork**. 2D mode edits and plays characters made of separately addressable images on a
2D skeleton, with deformable weighted meshes. It is not an orthographic camera, cel shading or a
flattened screenshot of the 3D model: every slot is its own PNG with its own mesh, pivot and weights.

The Aureate Knight is the first demo. Its **starter skin is rendered from the 3D model** (labelled as
such in the project) to prove the system end to end. It is not the hand-painted concept art. Replace any
image (or import a layered painting) and the new art keeps the binding, clips and constraints.

## Run

```bash
npm install                      # esbuild + playwright-core (already used by the 3D tools)
npm run viewer                   # http://localhost:8765/viewer/knight.html  → "2D artwork"
                                 # http://localhost:8765/viewer/knight.html?art=2d opens straight in 2D
                                 # http://localhost:8765/viewer/index.html   → other characters (dwarf 2D variant)
                                 # http://localhost:8765/runtime/example/    → standalone runtime player
node scripts/build-2d-knight.mjs                     # rebuild the knight 2D project from the 3D knight (~5 min)
node scripts/build-2d-knight.mjs --clips=idle,walk_in_place   # quick partial rebuild
node scripts/build-2d-knight.mjs --demos-only        # re-apply the native 2D demo clips/poses only
node scripts/build-2d-knight.mjs --character=dwarf_blank      # proportion variant → characters2d/dwarf
node scripts/export-2d.mjs [--sheets=all] [--scale=0.5]       # runtime package + sprite sheets + PNG frame → exports/
node scripts/build-runtime.mjs                       # re-bundle runtime/gamboligy-character2d.js
node scripts/check-2d.mjs                            # acceptance checks → validation/2d/REPORT.md
node tests/art2d-core.test.mjs                       # unit tests of the 2D core
node scripts/compare-2d.mjs out.png hover_sword_vigil:0,idle:1   # 3D | 2D side by side at the same time
node scripts/sheet-2d.mjs "clips=idle,walk_in_place&n=6" out.png # 2D contact sheet
```

## File map

| path | role |
|---|---|
| `viewer/js/art2d/core.js` | **Rig/pose evaluation + playback.** Pure JS, deterministic. Bones, slots, attachments, skinning, hand controls, skins, 2-bone IK constraints, draw order, events (`Player`). Shared by editor and runtime. |
| `viewer/js/art2d/render2d.js` | Dependency-free WebGL renderer (premultiplied alpha, blend modes) + hit testing on deformed meshes. Shared by editor and runtime. |
| `viewer/js/art2d/mesh.js` | Auto mesh from alpha, add/delete vertex, auto weights, weight paint/smooth/normalize/lock, edge bleed. |
| `viewer/js/art2d/schema.js` | `gamboligy.character2d/1.0` validation (readable errors), inverse binds, runtime subset, JSON writer. |
| `viewer/js/art2d/zip.js` | ZIP read/write (no dependencies). |
| `viewer/js/art2d/project-io.js` | **File boundary**: asset store, open folder/ZIP, save ZIP, layered PNG import, replace image with binding transfer. |
| `viewer/js/art2d/editor.js` | **Editor operations + UI** (2D mode panel, tools, undo/redo, 3D compare). The only file that touches the DOM. |
| `viewer/js/art2d/exporters.js` | Runtime package (atlas packing), PNG frame, sprite sheets + manifest. |
| `viewer/js/art2d/bridge3d.js` | **Character3D adapter**: fixed orthographic art camera, projection policy, key reduction. Reads the 3D rig; never modifies it. |
| `viewer/js/art2d/occlusion.js` | Draw order from real 3D occlusion (slot-ID buffer + slot-aware depth peel, hysteresis). |
| `viewer/js/art2d/starter.js` | **Character2D adapter / starter-skin builder**: renders each slot from the 3D model, meshes + weights it, captures pose-specific hands, bakes every clip through the bridge. |
| `viewer/js/art2d/specs.js` | Which 3D parts form which slot, `above` rules, hand captures (knight spec + plain template for variants). |
| `viewer/js/art2d/demos.js` | Native 2D authoring demos (finger tests, thumb-button contact, hover palm constraint, named poses). |
| `characters2d/aureate_knight/` | Editable knight project: `character.json`, `images/`, `reference/` (editor-only concept art). |
| `characters2d/dwarf/` | Proportion variant built from the same template. |
| `runtime/` | Standalone runtime `gamboligy-character2d.js`, API docs (`runtime/README.md`), example page + package. |
| `scripts/*-2d*.mjs`, `scripts/build-runtime.mjs` | Build, export, compare, contact-sheet and acceptance scripts. |

The 3D pipeline (`viewer/js/app.js`, `character.js`, `characters/`, `props/`, `tools/`) is untouched apart
from two hooks in `app.js`: the render loop can be suspended while 2D mode owns the renderer, and the
2D module is loaded after boot.

## Project format: `gamboligy.character2d/1.0`

Our own JSON (not a Spine export). Project-relative asset paths only. Main fields:

* `axes`: project pixels, +x right, **+y up**, origin = ground point under the character; degrees CCW.
* `referenceHeightPx` (1024), `pixelsPerMeter`, `artView` (the saved art camera, see below).
* `bones[]`: `id, parent, kind (bone|helper|socket|prop|tip), setup {x,y,rotation,scaleX,scaleY}, length,
  inverseBind, source3d {axis, fallbackAxis, fallbackOffsetDeg, bindProjectedRatio, foreshorten}`.
  Positions are transformed by the parent; rotation adds; scale is **not inherited**.
* `slots[]` in setup draw order (back → front): `id, bone, attachment, group, color`.
* `attachments{}`: `id, name, slot, bone, image, imageScale, pivot [image px], transform {x,y,rotation,scaleX,scaleY,mirror},
  vertices [image px, y down], triangles, weights [[bone, w, …] ≤ 4 per vertex, normalised] | null (rigid),
  visible, opacity, tint, blend, view, markers {name: [image px]}, registration, source`.
* `images{}`: `{path, w, h}` (runtime packages: `{page, x, y, w, h}` rectangles of `atlas.pages`).
* `skins[]`: `{id, replace: {attachmentId: replacementId}}`, applied to setup and keyed attachments.
* `hands`: per side, five finger chains (`thumb/index/middle/ring/pinky _01.._03`), curl sign/maxima fitted per character.
* `constraints[]`: planar two-bone IK (`ik2`) with target bone point or prop marker, `bend keep|±1`, `order`, `mix`.
* `props{}`, `sockets[]` (`socket_hand_L_prop`, `socket_hand_R_prop`, `socket_head_accessory`, `socket_back_accessory`).
* `clips[]`: `name, duration, loop, fps, source (bridge3d | native2d), meta, tracks, corrections, status`.
  `tracks` and `corrections` are layers: `bones {rotate, translate, scale}`, `slots {attachment, color}`,
  `drawOrder`, `deform`, `hands`, `constraints`, `events`. Tracks are offsets from the setup pose.
* `poses[]` (named poses), `editor` (camera, reference image — never exported), `starterSkin` (provenance label).

Validation reports human-readable errors (unknown schema/newer version, missing image files, bad parents,
weights, flipped/degenerate triangles, stale inverse binds, clip keys to missing attachments).

## Evaluation (deterministic) and event rules

Per frame: setup → clip tracks (baked) → **corrections** (artist layer, additive; draw-order and
attachment keys override) → hand controls → overrides → slot attachments (+ skin) → world transforms →
constraints by `order` → draw order → mesh skinning (`world · inverseBind`, ≤ 4 weights).
A pose depends only on project, clip, time and explicit options.

Events: during `update(dt)` an event fires when playback crosses it, `previous < t ≤ now`. A wrapping
loop fires the tail events, then events at exactly `t = 0`, then the events after the wrap; `play()` from 0
fires events at 0; **`seek()` never fires events**. Exports never duplicate a loop's first frame at its end.

## 3D clip bridge (fixed orthographic art camera)

* The saved art camera (`artView`: position, target, basis, pixels per metre) is fixed per skin view.
  The knight's is front-three-quarter (character's left toward the camera), 1024 px reference height.
* Joint and socket positions are **exact orthographic projections**, so contacts stay contacts.
* 2D bone angle = projected direction of the bone's primary axis (its length axis). **Short-segment
  policy**: when that axis points at the camera (projected length < 35 %), the angle blends (smoothstep
  20–35 %) to a fallback axis plus its bind-time offset, so nothing spins or divides by zero.
* **Foreshortening is explicit**: limbs get `scaleX = projected / bind projected length`, clamped
  [0.4, 1.15]; props get scaleX [0.25, 1] and scaleY [0.5, 1] (negative scaleY = mirrored side).
  The 3D bone lengths are never modified; the policy is stored per bone (`source3d`).
* Clips are baked at 30 fps into offset tracks, then reduced with stated tolerances (0.05°, 0.05 px,
  0.002 scale). Cape flutter (3D morph targets) becomes mesh deform keys (≤ 0.3 px).
* **Draw order** comes from real occlusion: every slot's 3D geometry is rendered into a slot-ID buffer
  and a second, slot-aware peel ("nearest fragment of a different slot"); each pixel votes "A over B".
  The previous frame's order is kept unless votes clearly disagree (hysteresis), authored `above` rules
  always hold (armour over its under-layer, pauldrons over the breastplate, fingers over the palm).
  So a sword is ordered against the actual hand and forearm pixels, not by centroid depth.
* Every clip keeps its name and gets a **status** with notes (torso/head turning away from the art view,
  foreshortening, the wrong side of a hand facing the camera, props going edge-on, order changes).
  See `validation/2d/REPORT.md` for the table.
* Native 2D authoring is independent: planar rotation, 2-bone IK drag with bend control, hand curls,
  keyed attachments/draw order/events. On bridged clips those edits go to the identifiable
  `corrections` layer (the badge says where keys go); native clips edit their own tracks.

## Editor

* **Setup** edits the bind pose (bones, pivots, meshes, weights, layer order); playback pauses.
  **Animate** keys the current clip at the playhead. The badge on the canvas always says which.
* Tools: Select (click bones or art; picking uses the deformed mesh, optional pixel-accurate alpha),
  Rotate, Move, IK drag (bend keep/+1/−1), Pivot (moves a joint without moving art or child joints),
  Mesh (click inside to add a vertex, drag to move, Delete to remove), Weights (brush add/subtract/
  replace/smooth, lock a bone's weights). Buttons: Auto mesh, Auto weights, Smooth, Normalize, Replace image.
* Layers: front-first list; drag to reorder (Setup: setup order; Animate: keyed order), eye toggles,
  isolate/show all. Hands: whole-hand + per-finger curls, presets (open palm, relaxed, fist, weapon grip),
  hand art swap (captured sets), fingers front/back of palm. Props & contacts: prop per slot, constraint
  mix/bend with live error and **UNREACHABLE** reporting. Poses: capture/preview/key named poses.
* Overlays: bones, mesh, weights heat map, pivots, markers, contacts. **3D compare**: inset or 45 %
  overlay of the 3D model at the same clip time through the art camera. Reference image (editor only).
* Undo/redo: Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y); Space play/pause; wheel zoom; right/middle/Alt drag pans.
* Open/import/save/export: open project ZIP, layered PNG import, save project ZIP, reopen saved copy,
  runtime package, PNG frame, sprite sheets.

### Layered artwork import

Tested format: PNG layers + `layers.json` (or a ZIP containing them). PSD is **not supported**.

```json
{ "canvas": {"w": 4000, "h": 4000}, "origin": [2000, 3000], "scale": 0.5,
  "layers": [ { "file": "forearm_L.png", "x": 1830, "y": 1420, "slot": "forearm_L", "name": "painted" } ] }
```

`origin` = the ground point under the character in canvas pixels (y down); `scale` = project px per
canvas px; `x, y` = the layer's top-left in canvas pixels. Each layer becomes attachment `<slot>.<name>`,
set as the slot's setup attachment, meshed from its alpha and **weighted from the slot's current art**
(nearest bind-space vertices), so painted art inherits the rig. Unknown slots are listed, never guessed.

### Painting underlap art (read this before painting)

Parts that bend or overlap need hidden material under their neighbours: paint each part complete as if
the overlapping part were transparent — the upper arm continues under the pauldron, the thigh continues
under the tassets and tabard, the palm continues under the fingers, the torso continues under both
arms. The starter skin shows this: every layer (and the `under_*` layers) was rendered whole, including
the parts the 3D model hides. Keep a few pixels of bleed (the importer extends edge colour into
transparent pixels to avoid dark fringes).

## Hands, props, contacts

* Finger chains stay 3-bone per finger on both sides; 2D-only `<finger>_tip_<side>` bones mark the pads.
* Hand art has pose-specific captures (hover, sword/staff/pistol/rifle/detonator grips, fist, relaxed),
  keyed as attachment swaps on the clips that need them; `finger_tests_2d` shows curls, a per-finger
  wave, weapon grip, a keyed swap to fist art and a keyed fingers-behind-palm order.
* Props are attachments of the `prop_R` slot on the `prop_R` bone (child of `socket_hand_R_prop`),
  with pivots at the grip and markers (`grip_L`, `tip`, `muzzle`, `button`, `support`, `support_L_hover`).
* Two-hand constraint order: the **right hand and its prop are authoritative**; `support_L` then solves
  the left arm so `socket_hand_L_prop` lands on the prop marker (keeps the elbow bend, keeps the hand's
  world rotation). `support_L_hover` pins the left palm to the blade throughout the hover vigil (keyed in
  its corrections layer). `thumb_button_R` drives the thumb pad onto the detonator button in
  `contact_detonator_2d`. Errors and unreachable targets are shown live and in the report.

## Exports

* **Runtime package** (`gamboligy.character2d-runtime/1.0`): JSON + atlas pages (2 px padding, 1 px
  extrusion, pages ≤ 2048, split automatically) + optional player copy. Playback data only.
* **PNG frame**: current pose on transparency.
* **Sprite sheets**: `spritesheet.json` manifest (`gamboligy.spritesheet/1.0`) + `sheet_N.png`. Every frame
  of a clip shares frame size and registration point (the ground origin), frames are trimmed with
  offsets, packed with padding/extrusion, split across sheets, straight alpha, looping clips without a
  duplicated end frame.

## Views and what is not supported

* One drawing is one view. The knight's starter skin is front-three-quarter only; turning away from it
  (side walks, back views, a hand showing its other side) needs additional authored art, added as more
  attachments/skins. Nothing here claims arbitrary 360° motion from one drawing; clips that need other
  views are marked `needs-art`.
* PSD import is not supported (use PNG layers + `layers.json`).
* Free-form deformation keys are supported by the runtime (`deform`), but the editor has no
  per-vertex animation tool yet; the starter uses them for cape flutter only.
* Performance numbers in the report come from headless CPU-emulated WebGL (SwiftShader); a GPU is faster.
