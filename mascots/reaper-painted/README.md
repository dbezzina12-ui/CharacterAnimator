# Painted Reaper — your artwork on the code reaper's rig

The exploded parts sheet (`assets/parts.png`: hood with skull, mantle, torso robe, two upper sleeves,
two lower sleeves, two gripping hands, two boots, scythe, on a transparent background) mounted on the
skeleton, solver and clips of `../reaper`. Nothing is repainted: the pieces are cut from the sheet and
posed by the rig.

- `src/puppet.js` — keys any remaining white, takes the largest opaque blob inside each part's sheet
  rectangle, and places it on its bone (anchor point → bone rest head, 0.377 rig px per sheet px).
  Skull, mantle, sleeves, hands, boots and scythe are rigid pieces (one transform each). The robe and the
  hood are skinned triangle meshes (bones: chest / spine / pelvis / robe flaps / tassels; head / hood point)
  so they bend along their bones; triangles are drawn with an affine map and a 2.5 px overlapping clip
  to avoid seams.
- `src/skeleton.js` — the reaper skeleton with arm and leg lengths matched to the painted sleeves and
  boots (same bone names, so the clips carry over). `src/clips.js` lifts the clips' foot targets to the
  painted ankle height.
- `src/solver.js` — the reaper solver with the wrist placed 58 px back along the hand's direction, so
  the painted hand's grip ring lands on the scythe's grip marker; the reach-slide measures that wrist.
- `viewer.html`, `scripts/` — same viewer, sheets, previews, validation (88 checks) and game export.

```bash
node mascots/reaper-painted/scripts/validate.mjs
node mascots/reaper-painted/scripts/sheets.mjs
node mascots/reaper-painted/scripts/export-game.mjs   # per clip: alpha PNG sequence zip, alpha WebM, green MP4
```

Known limits: the hands are the painted grip pose, so the shaft shows through the ring rather than
fingers wrapping; strong bends stretch pixels at the elbow seam between the two sleeve pieces.
