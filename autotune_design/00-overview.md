# Automated Parameter Tuning — Overview

## Goal

Provide a fully unattended pipeline that tunes gameplay parameters (movement
speed, shot error model, ball/serve trajectories, AI skill scales) by playing
CPU-vs-CPU matches headlessly and searching parameter space with Bayesian
optimization. The designer expresses "what a good match looks like" purely as
numbers — target percentages, counts, ranges, and weights — in one config
file. No LLM/agent is involved while tuning runs; a human (optionally helped
by an agent) applies the winning parameters back into the MoonBit source
afterwards.

## Non-goals and known limitations

- No doubles, no multi-set matches (the game is single-set; `games` is
  configurable at 2/4/6).
- No tuning of human-only feel parameters (assist, timing window, charge,
  magnet, Perfect Hit bonuses) — CPU-vs-CPU cannot observe them.
- No online/human-in-the-loop evaluation. The pipeline narrows the space;
  final subjective feel is validated by manual playtesting.
- **Single shared difficulty selector**: both AIs play at the same
  difficulty (it is one global setup row), so the study only observes
  peer-level play; skill-asymmetric balance (a human of some effective
  skill vs the CPU) is extrapolated, not measured. Character stats provide
  the only asymmetry. A per-side difficulty override in the runner job is
  the obvious v2 extension (`ai_p` is created independently in
  `start_match`, so the plumbing is small).
- CPU behavior is not human behavior: no panic, misreads, or input latency.
  Automation weeds out unviable regions and lands near-balanced candidates;
  humans make the final call.

## Architecture

```
autotune.config.json          (user-editable, numbers only)
        │
scripts/autotune/tune.py      Python + Optuna (TPE), resumable journal storage
        │  per trial: job JSON ──▶ N worker subprocesses
scripts/autotune/run_match.mjs  Node ESM, imports the compiled logic bundle
        │  per match: init(mockHost, seed) → setParam()* → setCpuMode(1)
        │             → menuCmd bootstrap → fixedUpdate(1/240) loop
        │             → getMatchStats() JSON
        ▼
tune.py: metrics → weighted hinge loss → Optuna suggests next trial
        │
        ▼
autotune_out/best_params.json + top_k.csv + study_summary.md
        │
human/agent edits MoonBit defaults (see 06-apply-back-and-verification.md)
```

Four layers, each specified in its own document:

| Doc | Layer |
| --- | --- |
| [01-cpu-vs-cpu-mode.md](01-cpu-vs-cpu-mode.md) | MoonBit: CPU-vs-CPU match mode |
| [02-parameter-registry.md](02-parameter-registry.md) | MoonBit: runtime-tunable parameter registry |
| [03-match-report-schema.md](03-match-report-schema.md) | MoonBit: machine-readable match report |
| [04-headless-runner.md](04-headless-runner.md) | Node: headless match runner |
| [05-optimizer-and-config.md](05-optimizer-and-config.md) | Python: Optuna controller + user config |
| [06-apply-back-and-verification.md](06-apply-back-and-verification.md) | Apply-back procedure + verification matrix |

## Determinism contract

The compiled logic bundle (`_build/js/release/build/logic/game/game.js`) is a
self-contained ESM module with no DOM access and no ambient entropy
(`Math.random`, `Date`) — all randomness flows through one mulberry32 /
Box-Muller stream seeded via `init(host, seed)`.

The contract the implementation must preserve:

> Same bundle + same parameter set + same seed + same match setup
> ⇒ byte-identical match report, in any process, any number of times.

This enables **common random numbers** (a fixed seed list shared by all
trials), which dramatically reduces evaluation noise for the optimizer, and
makes every reported result reproducible after the fact.

A second contract protects the shipped game:

> With `cpu_vs_cpu` off and no `setParam` calls, gameplay behavior is
> bit-identical to the current build. Registry defaults equal the current
> source literals, and every CPU-mode branch keeps the existing code path in
> an unchanged `else`.

## Quickstart

```bash
# one-time setup
npm run logic:build
python3 -m venv .venv-autotune
.venv-autotune/bin/pip install -r scripts/autotune/requirements.txt

# copy + edit the numbers-only config (search space, fitness targets, run size)
cp scripts/autotune/config.example.json autotune.config.json

# run the study (unattended; kill + --resume any time)
.venv-autotune/bin/python scripts/autotune/tune.py --config autotune.config.json

# results
cat autotune_out/study_summary.md
cat autotune_out/best_params.json   # apply-back artifact (doc 06)
```

Useful checks:

```bash
node scripts/autotune/run_match.mjs --bench             # steps/sec
node scripts/autotune/run_match.mjs --golden DIR        # regenerate CPU goldens
node scripts/autotune/golden_human.mjs check scripts/autotune/goldens/human-mode.json
.venv-autotune/bin/python scripts/autotune/test_metrics.py
```

## Glossary

- **Trial** — one parameter set evaluated by Optuna.
- **Matchup** — a (you, opp, surface, difficulty, games) tuple; a trial is
  evaluated over one or more matchups.
- **Match** — one full single-set match simulated headlessly with one seed.
- **Seed** — the integer passed to `init`; trials share the same seed list
  (common random numbers).
- **Metric** — a number computed by Python from match reports (e.g.
  `winner_pct`).
- **Term** — one line of the fitness config: a metric plus target/range,
  weight, and scale.
- **Loss** — the weighted sum of hinge-squared term penalties; Optuna
  minimizes it.
- **Mirror matchup** — a matchup where `you == opp`; point share should be
  ~50%, used to validate that the CPU-vs-CPU mode is symmetric.
