# Painted-workflow follow-up — automated results

Branch `knight-2d-painted-workflow` (from `knight-2d-artwork` @ 2757b07). Every row compares measured
values. Rows that only report a measurement are marked info and are not counted as passes.

| suite | command | result | output |
|---|---|---|---|
| 2D core unit tests | `node tests/art2d-core.test.mjs` | 16 / 16 pass | console |
| Acceptance (original brief) | `node scripts/check-2d.mjs` | 26 pass, 0 fail, 3 info (unreachable report, pose stress, CPU performance) | `validation/2d/REPORT.md` |
| Upgrade-kit UI regression | `node scripts/check-2d-workflow.mjs` | pass (artwork undo/redo pixel hashes, inspector joint + hand corrections, save/reopen, resized prop landmarks 0 px drift, one render loop) | `validation/workflow/checks.json` |
| Art replacement edge cases | `node scripts/check-2d-replace.mjs` | 8 / 8 pass | console |
| Fitting workflow | `node scripts/check-2d-fitting.mjs` | 13 / 13 pass | `validation/fitting/checks.json` |
| Corrections, hand views, colour, determinism | `node scripts/check-2d-corrections.mjs` | 14 / 14 pass | `validation/corrections/REPORT.md` |
| Visual QA (heuristics + human review) | `node scripts/qa-2d.mjs` | hero clips: 0 open flags except salute (2: brief vambrace squash); finger_tests_2d needs-work | `validation/qa/QA-REPORT.md`, `validation/qa/*.png` |

Fitting check footage: the painted helmet is the only real painted art. The other pieces in
`validation/fitting/` are **hue-shifted copies of the starter art used as test fixtures**, not painted art.

Deliverables: `deliverables/painted-knight/README.md`.
