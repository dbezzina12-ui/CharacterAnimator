# Painted-workflow follow-up — automated results

Branch `knight-2d-painted-workflow` (from `knight-2d-artwork` @ 2757b07). Every row compares measured
values. Rows that only report a measurement are marked info and are not counted as passes.

| suite | command | result | output |
|---|---|---|---|
| 2D core unit tests | `node tests/art2d-core.test.mjs` | 21 / 21 pass (incl. exact key remap, stale-key guard, malformed segment validated before interpolation, `deformFrom`, proportion placement) | console |
| Acceptance (original brief) | `node scripts/check-2d.mjs` | 27 pass, 0 fail, 3 info (incl. runtime bundle freshness) (unreachable report, pose stress, CPU performance) | `validation/2d/REPORT.md` |
| Upgrade-kit UI regression | `node scripts/check-2d-workflow.mjs` | pass (artwork undo/redo pixel hashes, inspector joint + hand corrections, save/reopen, resized prop landmarks 0 px drift, one render loop) | `validation/workflow/checks.json` |
| Art replacement edge cases | `node scripts/check-2d-replace.mjs` | 8 / 8 pass | console |
| Fitting workflow | `node scripts/check-2d-fitting.mjs` | 15 / 15 pass (incl. joint cracks: none on the starter; detected when underlap layers are removed) | `validation/fitting/checks.json` |
| Corrections, hand views, colour, determinism | `node scripts/check-2d-corrections.mjs` | 14 / 14 pass | `validation/corrections/REPORT.md` |
| Importer regressions (reported bugs) | `node scripts/check-2d-importer.mjs` | 15 / 15 pass (incl. 213→212-vertex key segment skipped + reported, no invalid coordinates): 2× cape re-import keeps keys (213 → 753 vertices) and motion; fitted painted cape plays the cape animation through save, runtime and sprites; proportion fit keeps layers.json position/rotation; pack placement exact for 206 pieces. The same suite fails on the previous code. | `validation/importer/REPORT.md` |
| Deliverables rebuilt from a saved painted project | `node scripts/check-2d-painted-rebuild.mjs` | 7 / 7 pass: the default rebuild keeps the saved project as saved (custom clip + correction byte-identical; the previous default dropped them); `--rebase` keeps pieces, statuses, placement (0 px) and carries the custom clip + correction; repeat rebuilds identical; `--rebase` stops with a message rather than dropping a piece or clip | `validation/painted-rebuild/REPORT.md` |
| Visual QA (heuristics + human review) | `node scripts/qa-2d.mjs` | hero clips (idle, hover, guard, slash, salute): 0 open flags; walk and detonator regression clips 0 / 1; finger_tests_2d needs-work (worst fold 3.3 %, was 9.1 %) | `validation/qa/QA-REPORT.md`, `validation/qa/*.png` |

Fitting check footage: the painted helmet is the only real painted art. The other pieces in
`validation/fitting/` are **hue-shifted copies of the starter art used as test fixtures**, not painted art.

Deliverables: `deliverables/painted-knight/README.md`.

**Performance:** every timing here comes from headless Chromium with CPU-emulated WebGL in a cloud container.
Desktop-GPU and mobile performance have not been measured.
