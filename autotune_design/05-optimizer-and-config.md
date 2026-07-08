# Optimizer and User Config

## Files

- `scripts/autotune/tune.py` — CLI entry: `python tune.py --config
  autotune.config.json [--resume]`.
- `scripts/autotune/metrics.py` — pure metric/loss functions (unit-tested).
- `scripts/autotune/registry.json` — machine copy of the doc-02 registry
  (name → default, file, symbol, bounds); used for validation and the
  apply-back artifact.
- `scripts/autotune/config.example.json` — annotated starting point.
- `scripts/autotune/requirements.txt` — `optuna`, `numpy`.

Environment: `python3 -m venv .venv-autotune && .venv-autotune/bin/pip
install -r scripts/autotune/requirements.txt`. One-time; after that a study
is a single unattended command.

## User config — numbers only

Everything the designer edits is a number (bounds, targets, weights, counts).
Changing the objective never touches Python/Node/MoonBit code.

```jsonc
{
  // which parameters to search, and where (names from doc 02 / registry.json)
  "search_space": {
    "stroke_err_x":    { "min": 0.15, "max": 0.60 },
    "stroke_err_z":    { "min": 0.25, "max": 1.00 },
    "mishit_prob":     { "min": 0.10, "max": 0.60 },
    "run_speed_scale": { "min": 0.80, "max": 1.25 },
    "ai_react_scale":  { "min": 0.70, "max": 1.50 },
    "jam_threshold":   { "min": 20.0, "max": 34.0 }
  },

  // fixed (non-searched) overrides applied to every trial — optional
  "fixed_params": {},

  // what a good match looks like
  "fitness": [
    { "metric": "avg_rally_shots",    "min": 5,   "max": 10,  "weight": 1.0, "scale": 2.0 },
    { "metric": "winner_pct",         "target": 20,           "weight": 1.0, "scale": 5.0 },
    { "metric": "unforced_pct",       "min": 25,  "max": 40,  "weight": 0.8, "scale": 5.0 },
    { "metric": "double_fault_pct",   "min": 2,   "max": 8,   "weight": 0.5, "scale": 2.0 },
    { "metric": "first_serve_in_pct", "min": 55,  "max": 70,  "weight": 0.5, "scale": 5.0 },
    { "metric": "service_hold_pct",   "min": 55,  "max": 85,  "weight": 0.8, "scale": 5.0 },
    { "metric": "match_duration_s",   "min": 240, "max": 600, "weight": 0.6, "scale": 60 },
    { "metric": "win_balance_pct",    "target": 50,           "weight": 0.4, "scale": 5.0 }
  ],

  "run": {
    "n_trials": 500,
    "matches_per_trial": 8,        // per matchup; seeds seed_base .. seed_base+7
    "seed_base": 1000,
    "workers": 4,                  // parallel Node subprocesses
    "games": 4,
    "max_steps_per_match": 600000, // ≈ 41.7 simulated minutes at dt=1/240
    "sampler_seed": 42,
    "timeout_weight": 50.0,        // per-term-scale timeout penalty (see Loss)
    "max_consecutive_failures": 5, // infrastructure failures before aborting
    "matchups": [
      { "you": 0, "opp": 0, "surface": "hard", "difficulty": "hard" },
      { "you": 1, "opp": 3, "surface": "hard", "difficulty": "hard" },
      { "you": 2, "opp": 4, "surface": "clay", "difficulty": "normal" }
    ]
  },

  // held-out validation of the study's top trials (see "Validation")
  "validation": {
    "top_k": 5,
    "seed_base": 100000,           // disjoint from run.seed_base
    "matches_per_matchup": 24
  },

  "output_dir": "autotune_out"
}
```

Validation at startup (fail fast, before any simulation):
- every `search_space` / `fixed_params` name must exist in `registry.json`;
- each fitness term must name a known metric and have either `target` or
  `min`/`max`;
- `win_balance_pct` in the fitness list requires at least one mirror matchup
  (`you == opp`) — it is computed **only over mirror matchups** (on
  asymmetric pairings a 50% target would push parameters to erase character
  differences);
- more than 12 search dimensions → warning (TPE degrades in high dimensions;
  prefer staged sub-space studies);
- `validation.seed_base` ranges must not overlap `run.seed_base` ranges.

## Metric vocabulary (`metrics.py`)

Computed per matchup from that matchup's **finished** match reports
(`finished: true`), then averaged across matchups with equal weight
(`win_balance_pct`: mirror matchups only). Timed-out matches carry a partial
report (`finished: false`) that is excluded from metric computation — their
cost enters through the timeout penalty (below).

**The default parameters are a timeout regime**: two frame-perfect AIs
rally practically forever (see doc 04), so a search space that cannot raise
error rates (`stroke_err_*`, `run_speed_scale`, `ai_*_scale`) will time out
every trial and give the optimizer nothing to learn from. The example
config includes such dimensions deliberately.
If a matchup has zero completed matches its metrics are undefined and the
trial's loss is the timeout penalty alone. Percentages are 0–100.

| metric | definition |
| --- | --- |
| `avg_rally_shots` | mean of `points[].rally_shots` (strokes after the serve; an unreturned serve is 0) |
| `rally_p50`, `rally_p90` | percentiles of `points[].rally_shots` |
| `winner_pct` | % of points with `end_kind == "winner"` |
| `unforced_pct` | % of points with `end_kind == "unforced"` |
| `double_fault_pct` | % of points with `end_kind == "double_fault"` |
| `ace_pct` | % of points with `rally_shots == 0 && end_kind == "winner" && winner == server` |
| `first_serve_in_pct` | `100 * (p.first_in + c.first_in) / (p.first_serves + c.first_serves)` — **per serve attempt** (lets replay first serves; doc 03) |
| `second_serve_win_pct` | % of `serve_number == 2` points won by the server |
| `service_hold_pct` | % of service games won by the server (games reconstructed from server runs in the point log; tiebreak excluded) |
| `break_rate` | breaks per match (service games lost by the server) |
| `net_approach_rate` | `(p.net_pts + c.net_pts) / points_played × 100` — approaches per 100 points; a both-players-at-net point counts twice, so this can exceed 100 |
| `net_point_win_pct` | `100 * net_won / net_pts`, both sides pooled (0 if no net points) — of points *played* at net, % *won* at net |
| `match_duration_s` | mean `duration_s` |
| `points_per_match` | mean `points_played` |
| `game_margin` | mean `abs(games_p - games_c)` — competitiveness of the set score |
| `run_m_per_point` | `(p.run_m + c.run_m) / points_played`, averaged |
| `win_balance_pct` | % of points won by side P — **mirror matchups only** |
| `timeout_rate` | fraction of matches (all matchups) with `timed_out == true` |

Adding a metric = one function in `metrics.py` + a row here; the config
schema doesn't change.

## Loss function

Per term, a **hinge-squared** penalty — zero inside the acceptable region,
quadratic outside:

```
range term  {min, max}:  d = max(0, min - m, m - max)
target term {target}:    d = |m - target|
penalty = weight * (d / scale)^2

loss = Σ penalties  +  timeout_weight * timeout_rate
```

`scale` is the normalizer ("how many metric units count as one unit of
bad"); `weight` is relative importance. Mathematically one degree of freedom
(`weight·(d/scale)² = (d/(scale/√weight))²`) — set `scale` once to the
metric's natural tolerance and use `weight` for prioritization; don't tune
both against each other.

The timeout penalty is **graded, not a cliff**, in two ways. First,
`timeout_weight` defaults to 50 (same order as a few strongly-violated
terms), so TPE's surrogate stays informative near regions where match length
brushes the step cap. Second — essential given that the default-parameter
region times out at 0 points — each timed-out match contributes
`1 - 0.5 * min(1, points_played / (12 * games))` rather than a flat 1: the
partial report's point progress turns the otherwise perfectly flat
all-timeout plateau into a slope toward match-completing regions (verified:
without this, every early trial scores an identical `timeout_weight` and
TPE has nothing to learn from). A stalling parameter set still loses
decisively. Per-term breakdowns are stored as Optuna `user_attrs` so
`study_summary.md` can show *why* a trial scored what it scored.

## Optuna setup

- `TPESampler(seed=cfg.run.sampler_seed, multivariate=True)`.
- All parameters via `trial.suggest_float(name, min, max)`.
- Storage: `optuna.storages.JournalStorage` (journal file under
  `output_dir/journal.log`) — append-only, safe to kill. `--resume` reopens
  the study (`load_if_exists=True`) and runs enough additional trials that
  `COMPLETE + FAIL` reaches `n_trials`; trials left in RUNNING state by a
  kill are ignored (never resumed, never counted). Caveat: the TPE sampler's
  RNG state is *not* persisted in the journal, so a killed+resumed study
  explores a different trajectory than an uninterrupted one — exact study
  reproducibility holds only for uninterrupted runs with the same config.
- Sequential trials (`n_jobs=1`); **parallelism lives inside a trial**: the
  `matchups × seeds` match list is split into `workers` job files and run as
  `workers` concurrent Node subprocesses. This keeps TPE fully informed
  (no stale suggestions) while saturating cores.
- **Runner failures**: a worker exiting non-zero (infrastructure error:
  missing bundle, unknown param, bad job) marks the trial
  `TrialState.FAIL` with the stderr tail in `user_attrs`, and the study
  continues; `max_consecutive_failures` consecutive failures abort the study
  (the error is systemic, not per-trial).
- **Common random numbers**: the seed list is
  `seed_base .. seed_base + matches_per_trial - 1`, identical for every
  trial, so loss differences between trials come from parameters, not luck.
  Re-evaluating the same params reproduces the same loss exactly.

## Validation (held-out seeds)

CRN makes trial *comparisons* clean but the study still selects on one fixed
24-match sample — over 500 trials TPE partially fits those seeds'
idiosyncrasies, so the winning loss is optimistically biased. After the
study, tune.py automatically re-evaluates the **top `validation.top_k`
trials** on the disjoint seed list `validation.seed_base ..` with
`validation.matches_per_matchup` matches per matchup (larger sample; runs
once, so it's cheap), and:

- reports study loss vs validation loss side by side in `study_summary.md`;
- selects `best_params.json` by **validation loss**;
- warns if the best validation loss exceeds its study loss by more than 50%
  — the signal to increase `matches_per_trial` and rerun.

## Noise & robustness notes

- `matches_per_trial × matchups` is the real sample size per trial: 8
  matches × 3 matchups at games=4 ≈ 1300+ points pooled, but only ~400–500
  points *per matchup* — a point-level percentage carries ≈±2 pt binomial
  standard error per matchup. Weight match-level metrics (duration,
  game_margin) accordingly; the held-out validation pass is the backstop.
- Multiple matchups (contrasting styles + one mirror) prevent overfitting
  parameters to one character pairing.
- If best trials pin a parameter at a search bound, widen the bound and
  rerun (flagged automatically in `study_summary.md`).

## Wall-clock budget

At the doc-04 acceptance floor (24k steps/s) a 240–600 sim-second match is
58k–144k steps ≈ 2.4–6 s; 24 matches ÷ 4 workers ≈ 15–36 s per trial:

| | floor (100×) | expected (500×+) |
| --- | --- | --- |
| one trial (24 matches, 4 workers) | 15–36 s | 3–7 s |
| 500-trial study | 2–5 h | 25–60 min |

Plus ~2,000 Node process spawns (≈0.2–0.3 s each) ≈ 10–15 min overhead. This
is acceptable for overnight/lunch runs; if spawn overhead ever dominates,
the escape hatch is a persistent worker mode (one Node process serving many
jobs over stdin) — noted, not designed. Stage B records the measured
steps/s, and `study_summary.md`'s config echo includes a predicted study
duration derived from it.

## Outputs (`output_dir/`)

- `journal.log` — Optuna storage (resume).
- `best_params.json` — apply-back artifact (format in doc 06), selected by
  validation loss.
- `top_k.csv` — top 10 trials: study loss, validation loss (where computed),
  per-term penalties, all params.
- `study_summary.md` — best trial's metric table vs targets (study and
  validation), loss curve (text sparkline), bound-pinning warnings,
  predicted-vs-actual duration, config echo.
- `trials/trial-<n>/` — job files + raw runner stdout for the best and
  most recent trials (debugging aid; older ones pruned).
