# Aureate Knight — painted-skin deliverable

Built by `node scripts/build-painted-knight.mjs` (+ `node scripts/record-player-videos.mjs` for the videos).
**The saved editable project is the source of truth:** the build reads `aureate-knight-painted.character2d.zip`
(or `--from=<your saved ZIP>`), takes its painted PNGs, fit template, statuses and notes, and re-applies them to
the current starter project, so improvements to the rig and animation carry over without re-painting
(`--no-rebase` rebuilds exactly as saved). A painted piece that cannot be carried over stops the build with a
message. Tested by `node scripts/check-2d-painted-rebuild.mjs`.

**Status, plainly:** the target of a *fully painted* knight is **not met**. Only the helmet has painted
art (the painted helmet from the upgrade kit). The other 212 pieces have no painted version yet and show
the starter art, which is rendered from the 3D model — it is not hand-painted. No painting or
image-generation tool was available, and the starter art was **not** restyled to look painted. The final-art
milestone is blocked on the paintings listed in `ART-REQUESTS.txt`. The rig, animation, hand views,
corrections, fitting workflow, QA and exports are finished and tested. The painted skin is ready to receive
the art.

| file | what it is |
|---|---|
| `aureate-knight-painted.character2d.zip` | Editable project (`gamboligy.character2d/1.0`): starter skin `default` + skin `painted` (opens in `painted`; the starter stays selectable from the skin menu). Includes the fit template, visual review and QA exceptions. |
| `aureate-knight-painted.runtime.zip` | Runtime-only package (`gamboligy.character2d-runtime/1.0`, our own JSON format, **not** Spine): JSON + transparent atlas pages. |
| `Aureate-Knight-2D-Player.html` | Single-file offline player that embeds the runtime and the package. Double-click it to open. It makes no network requests. |
| `videos/*.webm` | Hero clips recorded from that offline player's canvas, with all network blocked (`videos.json` lists the settings). |
| `paint-template-pack.zip` | One canvas per piece: `current.png`, guide layers kept separate (silhouette, joints/pivot/markers, underlap), `layers.json` with canvas coordinates, clean and joint previews, `manifest.json`. |
| `ART-REQUESTS.txt` | Every missing painting with exact size, pivot, joint positions, markers, mesh type and the clips that use it, in priority order. |
| `skin-status.json` | finished / provisional / missing per piece, missing hand-view sets, joint-coverage bend test. |
| `preview-starter-skin.png`, `preview-painted-skin.png` | Same pose in both skins. The only difference is the helmet. |

## Open and edit

```bash
npm install && npm run viewer
# http://localhost:8765/viewer/knight.html?art=2d  → "Open · import · save · export" → Open project (.zip) → aureate-knight-painted.character2d.zip
```

To install new paintings: 2D mode → **Fit artwork** → choose the PNGs (named as in `layers.json`; once the
template is in the project, `layers.json` is optional) → check the mapping, joint anchors and clip preview →
**Accept (one undo step)** → **Save** over `aureate-knight-painted.character2d.zip` (or anywhere, then pass
`--from=`). Then `node scripts/build-painted-knight.mjs` rebuilds the runtime package, offline player, template
pack, art requests and status from that saved project, and `node scripts/record-player-videos.mjs` re-records
the videos. The editor's Runtime package / Sprite sheets buttons export directly too.

## Hero clips — visual status (starter art, reviewed against the 3D source)

| clip | review | open auto-flags | notes |
|---|---|---|---|
| idle | approved | 0 | — |
| hover_sword_vigil | approved | 0 | both palms on the sword the whole loop (contact art 100 %) |
| sword_2h_idle (guard) | approved | 0 | pose-specific pauldrons and vambraces; both hands on the hilt |
| sword_2h_slash | approved | 0 (4 excepted with reasons) | wind-up/strike/guard captures match 3D; the blade is very short at 1.77–1.83 s, exactly as in the 3D view |
| knight_salute | approved | 0 | open palm → fist on chest → open palm; the mid-raise (forearm toward the camera) shows the cuff ring under the open hand as in 3D. Residual: the hand at ~0.43 s reads slightly more closed than in 3D |

The reviews were made by Claude from contact sheets and 3D-vs-2D comparisons, so they are an AI's
judgement. Please re-review them. Evidence: `validation/qa/QA-REPORT.md`, `validation/qa/<clip>.png`,
`validation/qa/compare-*.png`.

## Known limitations

1. **Painted art:** 1 of 213 pieces is painted (the helmet). The 36 priority-1 setup pieces, the 59
   pose-specific hero pieces and all 28 hand-view sets still need painting (`ART-REQUESTS.txt`). No
   painting or image tool was available in this session; nothing was restyled to look painted.
2. **One view:** the art is front-three-quarter. Turned poses use pose-specific captures (salute, guard,
   wind-up, strike, hover, walk swing) and hand-view sets. These are static drawings swapped in at set
   times; nothing here produces arbitrary 360° motion from one drawing.
3. **Salute:** fixed — captures no longer stretch with the bone's foreshortening, and a mid-raise capture
   covers the forearm-toward-camera frames. Residual: the hand at ~0.43 s reads slightly more closed than in 3D;
   the turned gold cuff ring is thinner than in 3D.
4. **Fingers:** curls now shorten toward the palm on denser meshes with wider knuckle blends. The worst fold in
   the deepest per-finger curls is 3.3 % of a pinky (was 9.1 %), so `finger_tests_2d` still has flags above the
   2 % threshold and stays needs-work. The detonator thumb folds 2.85 % (was 9.45 %); the walk pinky no longer folds.
5. **Joint coverage:** the bend test now measures cracks that open *between* pieces. With the starter art no
   joint exceeds 1.5 % at the extreme test angles. The previous 7–11 % figures were silhouette change, not gaps.
   A version without underlap layers is flagged, which proves the test can detect a real crack. Painted pieces
   still need underlap material at every bending joint (`guide-underlap.png`).
6. **QA flags are heuristics.** The 10 px joint probe reports edge-on wrists as gaps. Those cases are
   excepted with a reason after a visual check, never silently.
7. **Performance is not verified on desktop or mobile hardware.** Every number here comes from headless
   Chromium with CPU-emulated WebGL (SwiftShader) in a cloud container. The videos' frame rates are in
   `videos/videos.json`: motion is real-time, but the frame count reflects that CPU renderer. They are WebM
   (VP9); no MP4 encoder was available. Desktop GPU and phone frame rates still have to be measured on those
   devices.
8. PSD import is not supported; use PNG layers plus `layers.json`.
