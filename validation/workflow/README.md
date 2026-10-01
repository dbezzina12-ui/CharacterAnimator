# 2D artwork workflow review

Reviewed from `knight-2d-artwork` commit `2757b0790d0d2ae3694537b766694a432d820575`.

The layered-art workflow works: the painted helmet was installed through the actual Replace image
file input, posed with the existing knight, saved through Save project ZIP, reopened from that ZIP,
and exported through Export runtime package. Joint corrections and finger controls were also used
through the editor UI. This is a one-part art-swap proof, not a finished painted character.

## Bugs reproduced and fixed

1. **Image replacement Undo restored metadata but kept the replacement pixels.** Same-size image
   replacements overwrote the original AssetStore entry. Replacements now use separate image revisions
   so Undo/Redo restores both image content and binding. Only referenced images are included in saves.
2. **Different-resolution prop replacements moved their contact markers.** A 2× copy of the same
   detonator moved its button by 7.577 project pixels. Replacement now preserves the canvas footprint,
   pivot, rotation, scale and mirroring, and rescales image-space marker coordinates. The same test has
   zero drift. Weighted meshes and existing deformation keys are transferred to the replacement mesh.
3. **Repeated clicks on 2D artwork started additional animation loops.** One loop became three after
   two clicks. Mode activation is now idempotent, initialization is shared, and a generation/cancel
   guard keeps quick 3D/2D switches from reviving old loops. The regression records one loop throughout.

`checks-before-fixes.json` records the original failures. `checks.json` records the fixed workflow.

## Verification

- `node tests/art2d-core.test.mjs`: 14 passed.
- `node scripts/check-2d.mjs`: 29 passed after the changes.
- `node scripts/check-2d-workflow.mjs`: painted-image Undo/Redo, joint and hand posing, save/reopen,
  resized prop markers, repeated mode clicks and rapid mode switching pass; no page errors.
- `node scripts/preview-2d-workflow.mjs`: opens the generated one-file player from `file://`, checks
  there are no external requests or page errors, and captures hover/salute frames for visual review.

Set `CHROME_PATH` to an installed Chromium executable if the repository default is unavailable.

To regenerate the standalone proof after running the workflow check:

```bash
unzip -o validation/workflow/painted-knight.runtime.zip -d validation/workflow/runtime
node scripts/build-standalone-player.mjs --package=validation/workflow/runtime/aureate_knight_2d.runtime.json --out=validation/workflow/Painted-Knight-2D-Demo.html
node scripts/preview-2d-workflow.mjs
ffmpeg -y -framerate 15 -i validation/workflow/frames/%04d.png -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart validation/workflow/Painted-Knight-2D-Preview.mp4
```

## Files

- `Painted-Knight-2D-Demo.html`: generated offline player, download and open in a browser.
- `painted-knight.character2d.zip`: editable project with the painted helmet.
- `painted-knight.runtime.zip`: exported game runtime package with the same artwork.
- `painted-salute.png`: real editor capture with the painted helmet on the knight.
- `Painted-Knight-2D-Preview.mp4`: captured playback from the standalone player.

The original knight project is left available as the starting point; this proof is a separate saved
project. A final game skin still needs the remaining painted parts, complete overlap material at the
joints, and alternate hand/turned views where the existing clip status says `needs-art`. The runtime
uses the project's own JSON format; it is not a Spine export. Target-game/mobile performance is not
established by headless tests.

## Art provenance and prompt

The built-in image generation tool repainted the existing helmet using the supplied knight concept
as the style reference. The transparent result is `art/painted-helmet-source.png`; the project import
fixture `art/painted-helmet.png` fits the existing 279×487 attachment canvas. The rig's body proportions
and all other artwork are unchanged in this proof.

Prompt:

> Use case: style-transfer. Asset type: one transparent PNG attachment for an existing 2D knight rig.
> Image 1 is the precise edit target: helmet and purple crest only. Image 2 is a style reference, NOT a
> composition to reproduce. Repaint only the helmet from image 1 in the polished hand-painted cartoon
> game-art style of image 2: confident dark outline, silver-blue steel, rich dimensional painted
> highlights and shadows, warm gold trim, indigo-purple plume, cyan slit eyes, restrained scuffs. Keep
> the exact silhouette, orientation, proportions, crest position, front-three-quarter angle and framing
> of image 1. Helmet fills the same narrow portrait canvas, no neck, no shoulders, no body, no sword,
> no extra objects, no lettering. Preserve transparent space, genuinely transparent background, no
> checkerboard baked into pixels. This is a replacement texture: preserve all placement landmarks and
> avoid changing the shape.
