# Aureate Knight — painted-skin deliverable

Built by `node scripts/build-painted-knight.mjs` (+ `node scripts/record-player-videos.mjs` for the videos).

**Status, plainly:** the target of a *fully painted* knight is **not met**. Only the helmet has painted
art (the painted helmet from the upgrade kit). The other 205 pieces have no painted version yet and show
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
**Accept (one undo step)** → Save. Then rebuild the outputs with `node scripts/build-painted-knight.mjs`, or
use the editor's Runtime package / Sprite sheets buttons.

## Hero clips — visual status (starter art, reviewed against the 3D source)

| clip | review | open auto-flags | notes |
|---|---|---|---|
| idle | approved | 0 | — |
| hover_sword_vigil | approved | 0 | both palms on the sword the whole loop (contact art 100 %) |
| sword_2h_idle (guard) | approved | 0 | pose-specific pauldrons and vambraces; both hands on the hilt |
| sword_2h_slash | approved | 0 (4 excepted with reasons) | wind-up/strike/guard captures match 3D; the blade is very short at 1.77–1.83 s, exactly as in the 3D view |
| knight_salute | approved | 2 (4 excepted with reasons) | open palm → fist on chest → open palm. Residual: the vambrace is briefly squashed at 0.37–0.50 s and 3.35–3.50 s |

The reviews were made by Claude from contact sheets and 3D-vs-2D comparisons, so they are an AI's
judgement. Please re-review them. Evidence: `validation/qa/QA-REPORT.md`, `validation/qa/<clip>.png`,
`validation/qa/compare-*.png`.

## Known limitations

1. **Painted art:** 1 of 206 pieces is painted (the helmet). The 36 priority-1 setup pieces, the 52
   pose-specific hero pieces and all 27 hand-view sets still need painting (`ART-REQUESTS.txt`).
2. **One view:** the art is front-three-quarter. Turned poses use pose-specific captures (salute, guard,
   wind-up, strike, hover, walk swing) and hand-view sets. These are static drawings swapped in at set
   times; nothing here produces arbitrary 360° motion from one drawing.
3. **Salute transitions:** the forearm points at the camera at 0.37–0.50 s and 3.35–3.50 s. The setup
   vambrace is squashed there (2–3 frames), and the turned gold cuff ring is thinner than in 3D.
4. **Fingers:** finger meshes fold 4–9 % at the knuckles in deep per-finger curls (`finger_tests_2d`,
   marked needs-work). The detonator thumb folds 9 % at its knuckle while bent (it stays visible on the
   button). The walk pinky folds 2 %.
5. **Joint coverage:** at the bend-test extremes, gaps open at the shoulders (7.6–10.6 %), the left
   wrist (8.8 %) and the ankles (7–9 %). Painted pieces need underlap material there; the underlap
   guide marks where.
6. **QA flags are heuristics.** The 10 px joint probe reports edge-on wrists as gaps. Those cases are
   excepted with a reason after a visual check, never silently.
7. **Videos and performance** come from headless Chromium with CPU WebGL (SwiftShader), at about 36 fps
   rendered. They are WebM (VP9); no MP4 encoder was available. A GPU device plays at full rate.
8. PSD import is not supported; use PNG layers plus `layers.json`.
