# Aureate — Knight of the Dawn

A fitted steel-and-gold knight built on CharacterAnimator's existing master rig.
The model keeps all 63 joints and the original articulated fingers. Armor is
bone-parented geometry; the indigo mantle has two portable morph targets.

## Open the playground

Run `npm install`, then `npm run viewer`, and open:

`http://localhost:8765/viewer/knight.html`

The knight starts in **Hovering sword vigil**. The featured buttons also select
Sword guard, Sword slash, Walk cycle, and Knight salute. The full dropdown exposes
all 24 clips. Camera orbit, scrubbing, playback speed, hand IK, finger curl, and
GLB/config export use the original playground controls.

The generated **Aureate-Knight-Playground.html** is a standalone offline copy:
open it in Chrome or Edge. It embeds the character, dependencies, and props, so no
local server or external connection is needed. GLB/config export still works.

## Assets and authoring

- `characters/aureate_knight/aureate_knight.glb`: finished rig, armor, and 24 clips.
- `characters/aureate_knight/aureate_knight.character.json`: rig and clip metadata.
- `props/aureate-sword.glb`: matching ornamental sword, in the original Sword2H socket frame.
- `viewer/js/knight.js`: reproducible armor/sword geometry and cape morphs.
- `tools/knight_motion.py`: two new baked IK recipes using the existing rig helpers.
- `viewer/knight.html`: knight-focused view of the original playground.

**New clips:** `hover_sword_vigil` is a seamless five-second hover with open palms
supporting a horizontal blade; `knight_salute` is a four-second hand-to-chest salute.
The other 22 clips come from the existing library. The ornate sword replaces the
test sword in the knight playground while retaining its grip dimensions.

The hover clip's `propTransform` in the config is applied after parenting the sword
to `socket_hand_R_prop`. Other sword clips use the original identity socket transform.
Game integrations should load the sword separately and apply this metadata just as
the playground does. The sword is not permanently fused into the character GLB.

## Rebuild and check

```bash
CHROME_PATH=/path/to/chromium npm run build:knight
CHROME_PATH=/path/to/chromium npm run check:knight -- dist-knight
```

`build:knight` uses the original master GLB, the existing IK solver, and the viewer's
GLTF exporter; Blender is not needed for this armor layer. It writes the portable
character and sword assets plus `dist-knight/Aureate-Knight-Playground.html`.

Checks cover fresh loading, all featured poses, 63 joints, seamless hover endpoints,
stable hand spacing, airborne feet, GLB export/reload with all 24 clips, and narrow
screen layout. Cape motion is authored deformation, not a cloth simulation. This is
a character demo; extreme poses outside the featured motions may need armor fitting.

## Illustrated game view

The playground now opens with portable painted ramp textures, dark ink shells,
and an orthographic game camera. The original skeleton and 24 motions are intact.
Use **Illustrated / Original 3D** to compare, or turn off **Flat game camera** to
inspect perspective. **Save transparent PNG frame** captures the current pose.

`viewer/js/illustrated.js` creates the material treatment on the real meshes.
It bakes directional shading into texture coordinates rather than relying on a
screen filter. Export includes KHR_materials_unlit ramp textures and reversed
ink geometry. Open double-sided cape geometry uses its existing perimeter trim
instead of an inverted hull. The illustration is an NPR rendering treatment;
it is not a projection/bake of the generated concept image or a 2D puppet rig.

`node scripts/package-knight.mjs <output-directory>` updates the offline HTML
without reauthoring the geometry or animations. The original sword builder's
blade winding is corrected for consistent visible surfaces and ink outlines.
