# Apply-Back Procedure and Verification Matrix

## Apply-back artifact

`tune.py` writes `output_dir/best_params.json` with everything needed to
apply the result mechanically (a human or an agent can do it without
consulting the study):

```jsonc
{
  "schema": 1,
  "study": "autotune-2026-07-08",       // study name
  "trial": 317,                          // best trial number
  "loss": 0.42,
  "metrics": { "avg_rally_shots": 6.8, "winner_pct": 21.3, ... },
  "params": {
    "stroke_err_x": {
      "value": 0.41,
      "default": 0.30,
      "file": "logic/shots/shots.mbt",
      "symbol": "compute_stroke aim-noise draw",
      "kind": "absolute"
    },
    "run_speed_scale": {
      "value": 1.12,
      "default": 1.0,
      "file": "logic/physics/constants.mbt",
      "symbol": "run_speed",
      "kind": "scale"
    }
  }
}
```

`file`/`symbol`/`kind`/`default` come from `scripts/autotune/registry.json`.

## Apply-back procedure

Applying means changing the **defaults in `logic/tuning/tuning.mbt`** — the
single place every registry value lives after Stage C. Source files outside
`logic/tuning` never contain registry literals again, so apply-back is a
one-file edit:

1. For each entry in `params`: set the field's default in `defaults()` to
   `value` — **including scale fields ≠ 1.0**. This is the only supported
   primary path: it reproduces the exact code path the winning trial ran,
   so the confirmation check below is bit-exact by construction.
2. Update the corresponding `default` values in
   `scripts/autotune/registry.json` and the doc-02 table.
3. Rebuild and verify (below), including a **confirmation study**: rerun
   tune.py with an empty `search_space` (or a single dummy run) and the same
   fitness config — the loss with the new defaults and zero `setParam` calls
   must match the winning trial's **study** loss exactly (common random
   numbers + identical float evaluation make this exact).
4. *Optional cosmetic follow-up*: fold a drifted scale into the underlying
   formula (e.g. bake `run_speed_scale 1.12` into `run_speed`'s
   coefficients, reset the scale default to 1.0). Folding changes
   floating-point evaluation order (`(a·b)·s` vs pre-multiplied
   coefficients), is **not bit-exact**, and can shift RNG-consuming
   trajectories — after folding, rerun the confirmation with a tolerance
   (loss within a few %) and regenerate the goldens in the same change.
   Note some scales fold into multiple literals (`ai_pos_err_scale` touches
   all three difficulty presets). Sync any UI copies of tuned constants —
   notably the serve sweet band duplicated for the meter display at
   `game.js.mbt:91-94` (doc 02).
5. Manual playtest for feel (the pipeline optimizes CPU-vs-CPU statistics;
   human feel is validated by humans — see "Limitations" in doc 00).

This step is where an agent *may* assist (editing defaults, updating docs,
running verification); the tuning run itself never involves one.

## Verification matrix

Each implementation stage lands only when its checks pass.

**Goldens** come in two kinds, both captured at Stage B with default params
and checked in under `scripts/autotune/goldens/` (small files that pin
behavior in CI):

- **CPU-mode goldens** — the `--golden` matrix from doc 04 (3 surfaces × 3
  character pairs × 3 seeds), covering all registry use sites.
- **Human-mode golden** — one scripted-input replay: a canned input tape
  (a deterministic `input` mock returning pre-recorded per-step values)
  drives `handleInput`/`fixedUpdate` through a few points with `setCpuMode`
  **never called**; the resulting stats string is the golden. This is the
  automated proof that the flag-off/human path survived the registry
  rewrite — registry edits touch human-only code (charge, timing window,
  `reach_grace`) that CPU-mode goldens never execute, and "diff review +
  manual play" alone silently passes exactly this class of typo.

| Stage | Checks |
| --- | --- |
| A. CPU mode + stats (MoonBit) | `moon test` green (38 tests). `moon build --target js --release` clean. Ad-hoc Node drive: one match to completion, report parses, doc-03 invariants hold (points sum, per-attempt first-serve counts both sides, court-side alternation, score consistent with `games` target). Flag-off safety: diff review — every gate keeps the existing code in an unchanged `else`; manual browser play unchanged. |
| B. Node runner | Determinism: same seed, two fresh processes → identical `getMatchStats()` strings. Symmetry: mirror matchup ≥50 seeds → P vs C serve-point win rates within the 95% binomial band (doc 01). Bench (after warm-up): ≥100× realtime; record the measured number. 20-match batch, `games=4`, zero step-cap hits. Capture both golden kinds. |
| C. Tuning registry | `moon test` green. **Both** golden kinds byte-identical with **zero** `setParam` calls (defaults bit-identical proof for CPU and human paths). Effect smoke: `setParam("run_speed_scale", 0.5)` changes the report; `resetParams()` restores the golden. `setParam("nope", 1)` → `false` → runner exits non-zero. |
| D. Optuna controller | `metrics.py` unit tests pass against a canned report. Smoke study `n_trials=5, matches_per_trial=2, workers=2` finishes in minutes, unattended, one command. Kill mid-study + `--resume` → trial count continues (COMPLETE+FAIL accounting). Same params re-evaluated → identical loss (CRN). Non-zero worker exit → trial FAILED, study continues. Artifacts written, including validation re-evaluation. |
| E. Pilot + apply-back | 200-trial pilot: loss decreases; top-K params not pinned at bounds (else widen + rerun); validation loss within 50% of study loss (else raise `matches_per_trial`). Apply-back dry run: edit defaults from `best_params.json`, `moon test` green, confirmation study reproduces the winning study loss exactly, revert. |

## Regression protection (post-merge)

- Goldens + a tiny runner-determinism check can be added to CI after Stage C
  (Node is already in the workflow); any change to logic that alters default
  gameplay then fails visibly instead of silently invalidating past studies.
- **Any** change to report serialization — additive fields included — and
  any intentional gameplay change must regenerate all goldens in the same
  PR (a byte-diff check cannot distinguish "additive" from "breaking").
