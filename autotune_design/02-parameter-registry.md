# Tunable Parameter Registry

## Mechanism

All gameplay constants are compile-time MoonBit `let`s today. We introduce a
new leaf package `logic/tuning` holding one global mutable struct whose
defaults equal the current source literals:

```moonbit
pub(all) struct Tuning {
  mut aero_cd : Double
  mut aero_cl_max : Double
  // ... every row of the registry table ...
  mut cpu_p : Bool          // not a tunable; set by setCpuMode (see doc 01)
}

pub let t : Tuning = defaults()

pub fn set_param(name : String, v : Double) -> Bool  // false = unknown name
pub fn get_param(name : String) -> Double            // NaN for unknown name
pub fn reset_params() -> Unit                        // restore defaults()
pub fn cpu_p_active() -> Bool
```

`logic/game/autotune.js.mbt` re-exports these to JS as `setParam`,
`getParam`, `resetParams` (see `moon.pkg.json`). The Node runner loops over
the trial's params object calling `setParam` once per entry, **after `init`
and before `menuCmd("play", ...)`** — parameters must not change mid-match.

Consumption sites replace only the registry literals with `@tuning.t.<field>`
reads (e.g. `speed = speed * (1.0 + rng.draw() * @tuning.t.stroke_err_speed
* err_mul)`). Because defaults equal the old literals — and scale factors
default to exactly `1.0`, and `x * 1.0 == x` in IEEE754 — behavior with no
`setParam` calls is bit-identical to today.

**AI difficulty scales** are applied once, in `@ai.create_ai`, by
snapshotting `diff` with each field multiplied by its scale. `setParam`
always precedes `start_match`, so the snapshot sees the final values; reading
scales at every use site would work too but risks disturbing hot paths, and
snapshotting keeps the RNG stream layout unchanged.

## Parameter kinds

- **absolute** — the field *is* the constant (e.g. `jam_threshold`).
- **scale** — multiplies a derived quantity; default `1.0` (e.g.
  `run_speed_scale`).
- **base+slope** — a linear stat mapping `base + slope * stat/100` split into
  two fields so both intercept and sensitivity are tunable.

**Pointwise validity rule**: every registry parameter's full `[min, max]`
box must be physically valid at *every* point — the optimizer samples the
box independently per dimension and cannot express cross-parameter
constraints. Where two raw engine constants are coupled (an interval's two
edges, a line's two endpoints), the registry stores an **independently
boxable reparameterization** and the engine derives the raw constants:

- error multiplier: the search space exposes `err_mul_lo` (value at ctl=100,
  must stay > 0) alongside `err_mul_hi`; **tune.py** derives the engine
  parameter `err_mul_slope = hi - lo` before emitting the job. The raw
  `hi/slope` box would admit negative error multipliers at high control.
- serve sweet band: the search space exposes `serve_sweet_width` (> 0)
  alongside `serve_sweet_lo`; tune.py derives `serve_sweet_hi = lo + width`.
  The raw `lo/hi` box would admit an inverted band.

The derivation lives in **Python, not MoonBit**, for bit-exactness: the
engine must store fields whose defaults are the original literals
(`err_mul_slope 1.2`, `serve_sweet_hi 0.88`) because the derived forms are
not float-identical (`1.6 - 0.4 = 1.2000000000000002 ≠ 1.2`,
`0.7 + 0.18 = 0.8799… ≠ 0.88`) and would break the defaults-bit-identical
golden proof. During tuning, bit-exactness is irrelevant — determinism per
parameter set is all that matters.

## Registry

Suggested min/max are search bounds for the optimizer config, not hard
clamps; `setParam` accepts any finite double. Defaults are the current
source literals (verify against source at implementation time — source wins).

### Ball physics (`logic/physics/constants.mbt`, use sites in the ball stepper / `bounce.mbt`)

| name | symbol | kind | default | min | max | unit | description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `aero_cd` | `aero_cd` | absolute | 0.55 | 0.40 | 0.70 | — | drag coefficient |
| `aero_cl_max` | `aero_cl_max` | absolute | 0.40 | 0.25 | 0.55 | — | max Magnus lift coefficient |
| `aero_spin_decay_tau` | `aero_spin_decay_tau` | absolute | 7.0 | 4.0 | 12.0 | s | spin decay time constant |
| `bounce_v_ref` | `bounce_v_ref` | absolute | 7.1 | 5.0 | 10.0 | m/s | restitution reference speed |
| `bounce_slope` | `bounce_slope` | absolute | 0.012 | 0.005 | 0.020 | — | speed-dependent restitution slope |
| `bounce_min_frac` | `bounce_min_frac` | absolute | 0.65 | 0.50 | 0.80 | — | restitution floor |
| `spin_bounce_vertical` | `spin_bounce_vertical` | absolute | 0.004 | 0.0 | 0.010 | — | topspin kick on bounce |

Note: `aero_k` is derived from mass/radius/air density only; it stays a
constant. Court geometry and net heights are **not** tunable (they are the
rules of tennis).

### Stat → physics mappings (`logic/physics/constants.mbt:131-197`)

| name | symbol | kind | default | min | max | unit | description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `flat_speed_base` | `max_flat_speed` | base+slope | 18.0 | 14.0 | 24.0 | m/s | flat groundstroke speed at pow=0 |
| `flat_speed_slope` | `max_flat_speed` | base+slope | 7.0 | 4.0 | 12.0 | m/s | added speed at pow=100 |
| `topspin_rpm_base` | `topspin_rpm` | base+slope | 2200 | 1500 | 3000 | rpm | topspin at spn=0 |
| `topspin_rpm_slope` | `topspin_rpm` | base+slope | 2600 | 1500 | 3500 | rpm | added topspin at spn=100 |
| `slice_rpm_base` | `slice_rpm` | base+slope | 1500 | 1000 | 2200 | rpm | slice backspin at slc=0 |
| `slice_rpm_slope` | `slice_rpm` | base+slope | 1800 | 1000 | 2600 | rpm | added backspin at slc=100 |
| `serve_stat_base` | `serve_power_speed` (:161) | base+slope | 0.82 | 0.70 | 0.95 | — | serve-speed stat factor at srv=0 |
| `serve_stat_slope` | `serve_power_speed` (:161) | base+slope | 0.36 | 0.20 | 0.50 | — | added stat factor at srv=100 |
| `err_mul_hi` | `err_mul_base` | base+slope | 1.6 | 1.2 | 2.2 | — | error multiplier at ctl=0 |
| `err_mul_slope` | `err_mul_base` | base+slope | 1.2 | — | — | — | engine field; search via `err_mul_lo` [0.2, 1.0], tune.py derives `slope = hi - lo` |
| `run_speed_scale` | `run_speed` | scale | 1.0 | 0.70 | 1.30 | — | player top speed multiplier |
| `run_accel_scale` | `run_accel` | scale | 1.0 | 0.70 | 1.30 | — | player acceleration multiplier |
| `reach_scale` | `reach` | scale | 1.0 | 0.85 | 1.15 | — | racket reach multiplier |

### Stroke model (`logic/shots/shots.mbt`)

| name | symbol | kind | default | min | max | unit | description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `stroke_err_x` | `compute_stroke` (:352) | absolute | 0.30 | 0.10 | 0.60 | m·σ | lateral aim noise per unit err_mul |
| `stroke_err_z` | `compute_stroke` (:353) | absolute | 0.55 | 0.20 | 1.00 | m·σ | depth aim noise per unit err_mul |
| `stroke_err_spin` | `compute_stroke` (:356) | absolute | 0.06 | 0.02 | 0.12 | frac·σ | spin noise |
| `stroke_err_speed` | `compute_stroke` (:357) | absolute | 0.03 | 0.01 | 0.08 | frac·σ | speed noise |
| `err_quality_gain` | `compute_stroke` (:351) | absolute | 2.2 | 1.0 | 4.0 | — | how strongly bad contact (`1-q`) inflates err_mul |
| `mishit_q_max` | `compute_stroke` (:359) | absolute | 0.30 | 0.15 | 0.50 | — | contact quality below which mishits can occur |
| `mishit_prob` | `compute_stroke` (:360) | absolute | 0.35 | 0.10 | 0.60 | — | mishit probability when eligible (non-assist path) |
| `q_speed_floor` | `contact_quality` (:179) | absolute | 0.65 | 0.50 | 0.90 | — | floor of the incoming-pace quality penalty (non-assist) |
| `jam_threshold` | `jam_threshold` (:121) | absolute | 26.0 | 20.0 | 34.0 | m/s | incoming pace where jamming starts |
| `jam_scale` | `jam_scale` (:124) | absolute | 14.0 | 8.0 | 22.0 | m/s | excess pace that saturates the jam term |
| `aim_x_scale` | `compute_stroke` (:254) **and** `choose_stroke` (`ai.mbt:325`) | absolute | 2.8 | 2.0 | 3.6 | m | full-deflection lateral aim (m from center). The AI divides its target x by the same constant (`plan_x = best_tx / 2.8`); both sites must read this field or AI aim silently rescales |
| `rally_depth_min` | `compute_stroke` (:253) | absolute | 4.5 | 3.5 | 6.0 | m | rally target-depth floor (non-Drop) |
| `rally_depth_max` | `compute_stroke` (:256) | absolute | 11.2 | 10.0 | 12.0 | m | target-depth ceiling |

### Serve model (`logic/shots/serve.mbt`, `logic/physics/constants.mbt`)

| name | symbol | kind | default | min | max | unit | description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `serve_err_x` | `compute_serve` (:190) | absolute | 0.30 | 0.10 | 0.60 | m·σ | serve lateral noise |
| `serve_err_z` | `compute_serve` (:191) | absolute | 0.35 | 0.15 | 0.70 | m·σ | serve depth noise |
| `serve_err_speed` | `compute_serve` (:192) | absolute | 0.025 | 0.010 | 0.060 | frac·σ | serve speed noise |
| `serve_speed_min` | `serve_speed_min` | absolute | 30.0 | 24.0 | 36.0 | m/s | power-meter speed floor |
| `serve_speed_max` | `serve_speed_max` | absolute | 54.0 | 46.0 | 62.0 | m/s | power-meter speed ceiling |
| `serve_sweet_lo` | `compute_serve` (:158-163) | absolute | 0.70 | 0.55 | 0.85 | — | sweet-band lower edge |
| `serve_sweet_hi` | `compute_serve` (:158-163) | absolute | 0.88 | — | — | — | engine field; search via `serve_sweet_width` [0.05, 0.30], tune.py derives `hi = lo + width` |

Sweet-band notes: the gameplay band lives inside `compute_serve`
(`serve.mbt:158-163`) including a **derived denominator** `(p - hi) /
(1.0 - hi)` (today literal `0.12 = 1.0 - 0.88`) that must be computed from
the fields, not left as a literal. A second, UI-only copy `serve_sweet_lo/hi`
exists in `game.js.mbt:91-94` for the human serve-meter highlight; it is not
consumed in CPU mode, but apply-back must sync it (doc 06) or the meter will
lie to human players. CPU serves do flow through the band: `choose_serve`
power → `execute_serve` → `compute_serve` accuracy.

### AI skill scales (`logic/ai/ai.mbt`, applied as a snapshot in `create_ai`)

Uniform scales across all three difficulty presets, preserving the
easy < normal < hard ordering.

| name | scales field | default | min | max | description |
| --- | --- | --- | --- | --- | --- |
| `ai_pos_err_scale` | `Difficulty.pos_err` | 1.0 | 0.5 | 2.0 | landing-prediction error |
| `ai_jitter_scale` | `Difficulty.jitter` | 1.0 | 0.5 | 2.0 | movement jitter |
| `ai_react_scale` | `Difficulty.react` | 1.0 | 0.5 | 2.0 | reaction delay |
| `ai_choice_noise_scale` | `Difficulty.choice_noise` | 1.0 | 0.5 | 2.0 | shot-selection noise |
| `ai_tactical_scale` | `tactical_shot_type` trigger prob | 1.0 | 0.0 | 2.0 | lob/drop tactical override frequency |

`ai_tactical_scale` is the exception to the snapshot mechanism: the trigger
probabilities are hardcoded per-difficulty inside `tactical_shot_type`
(`ai.mbt:236-240`, 0.8/0.35/0.6 matched on `diff_id`), not `Difficulty`
fields, so this one is a direct `@tuning.t.ai_tactical_scale` multiplier at
that site (one of the two permitted `ai.mbt` touches, see doc 01).

`Difficulty.speed_mul` and `serve_q` are deliberately not scaled: movement
speed is already covered by `run_speed_scale` (applied to both sides
identically), and `serve_q` interacts with the sweet band which is tunable
directly.

## Rules for adding a parameter

1. Add the `mut` field to `Tuning` with default = the current source literal,
   and a row here (name, symbol, kind, default, bounds, unit, description).
2. Add the name to `set_param` / `get_param` match arms.
3. Replace the literal at the use site with `@tuning.t.<field>`.
4. Add the row to `scripts/autotune/registry.json` (used for the apply-back
   artifact, doc 06).
5. Re-run the Stage-C verification: `moon test` green + golden reports
   byte-identical with no `setParam` calls.

Never tune: court/net geometry, `dt`, gravity, ball mass/radius (these are
either rules of tennis or determinism-critical).

Excluded as **unobservable in CPU-vs-CPU**: the Perfect Hit constants
(`perfect_q_min` 0.90, speed ×1.08, spin ×1.12 at `compute_stroke:341-346`)
— `attempt_contact` defaults `perfect_eligible = false` and the CPU contact
path never sets it, so no CPU stroke can be Perfect and the optimizer would
search a flat loss surface. Same for all human-feel constants (assist,
charge, timing window, magnet). These stay hand-tuned via playtesting.

Excluded as **dead code**: `serve_flat_speed` (`constants.mbt:146`) has no
call sites — actual serve speed is `serve_power_speed`; the registry tunes
that function's coefficients (`serve_stat_base/slope`) instead.
