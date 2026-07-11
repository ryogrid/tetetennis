# Ball Control and Aiming: Discrete 9-Target System

Status: approved design, pre-implementation. Supersedes the continuous
`aim_x`/`aim_depth` placement model for every shot in the game.

## 1. Goal & scope

Replace continuous aiming with **nine discrete targets** selected by the
direction input (arrow keys; the virtual joystick on mobile) held at the
moment of the shot. The system applies to **all shots** — groundstrokes,
volleys, smashes, and serves — and to **both the human player and the CPU**
(the AI chooses among the same nine targets).

Length (depth) aiming is *internal power modulation* by the hitter, so the
**degree to which the intended depth is achieved scales with contact
quality** (strokes: `q` from `contact_quality`; serves: the power-meter
accuracy `acc`).

Out of scope (deliberately): an on-screen aim reticle/preview, assist-mode
cell hints, retuning of `stroke_err_*` dispersions, per-character control
stats beyond the existing `ctl`.

## 2. The nine cells

All directions are in the **hitter's frame** (right = the hitter's right,
regardless of which end they play from, including the CPU). The "area" is the
region the shot must land in: the opponent's singles court for rally shots,
the active service box for serves.

| input | lateral | depth | risk |
|---|---|---|---|
| none | center | safe deep-ish | low |
| Up | center | deepest, line ギリギリ | depth risk |
| Down | center | physically-possible shortest | net/short risk |
| Right / Left | edge, safe side margin | safe deep-ish | low-mid |
| Up+Right / Up+Left | deep corner ギリギリ | line ギリギリ | high |
| Down+Right / Down+Left | short corner ギリギリ | shortest | high |

### Input quantization

- `aim_cells(ax, az)` quantizes the aim PAIR by **radial gate + angle
  sector** (review finding: a per-axis threshold would make partial joystick
  pushes silently aim center). If `hypot(ax, az) < 0.35` → (0,0); otherwise
  each axis registers when its magnitude exceeds `sin(22.5°) ≈ 0.383` of the
  radial magnitude, giving eight even 45° sectors. Keyboard singles (1,0)
  and diagonals (0.707,0.707) classify exactly; any joystick push past 35%
  deflection aims at full cell strength regardless of how hard it is pushed.
  Quantization happens **inside the shot layer** (`compute_stroke` /
  `compute_serve`) so every existing `Double` aim parameter, struct field,
  and test harness keeps its shape.
- Aim is sampled **live at the contact frame** for strokes (unchanged
  behavior) and at the serve release for serves. While charging, the d-pad
  moves the aim only (movement is already suppressed).

## 3. Rally geometry

Court constants: `court_half_len = 11.885`, singles `court_half_width =
4.115`, `court_service_line = 6.40`.

Cell coordinates come from new tunables (registry-tracked):

| tunable | default | derived target |
|---|---|---|
| `aim_deep_margin` | 0.90 | up-row depth z = 11.885 − 0.90 = **10.99** |
| `aim_safe_depth` | 9.20 | none/left/right row depth |
| `aim_short_depth` | 3.20 | down-row depth |
| `aim_side_safe_margin` | 0.80 | side cells x = ±(4.115 − 0.80) = **±3.315** |
| `aim_short_speed_drop` | 0.28 | see §4 (max speed cut at the shortest depth) |

**Diagonal (corner) cells** get their own, looser depth and width than the
straight rows (they combine both extremes, so at the raw ギリギリ lines they
were ~50% out — too punishing). `rally_cell_target` branches on
`is_corner = cell_x ≠ 0 ∧ cell_z ≠ 0`:

| tunable | default | corner target |
|---|---|---|
| `aim_corner_margin` | 0.75 | corner x = ±(4.115 − 0.75) = **±3.365** (≈ the side cell; distinguished by depth, not by hugging the line) |
| `aim_corner_deep_margin` | 2.05 | up-corner depth = 11.885 − 2.05 = **9.84** (vs straight-up 10.99) |
| `aim_corner_short_depth` | 4.60 | down-corner depth = **4.60** (vs straight-down 3.20) |

Calibration: at clean contact this puts the flat up-corner at ~24% out and
the flat down-corner ~15% (topspin corners lower, since the control solver
undershoots) — aggressive but no longer a near-certain out. Levers:
`aim_corner_margin` (width) and `aim_corner_deep_margin` / `aim_corner_short_depth`
(depth). The straight up row keeps its ~28% long ギリギリ risk on the centre
line via `aim_deep_margin` 0.90.

Special cases:
- **Drop** keeps its identity (a Drop must stay short even with no input):
  depth rows up/none/down = **3.8 / 2.4 / 1.8** (constants in shots.mbt, not
  tunables). Lateral columns are shared.
- **Lob** uses the standard table (a down-lob is a legitimate touch lob).
- **Smash / volley** use the standard table; the volley's existing 0.4×
  aim-error multiplier keeps its corners precise.
- **Practice stroke feeds** (deliberate drill redesign, review finding):
  the "deep" feed maps to the **none** row (a line-ギリギリ feed would fault
  ~30% of reps) and the "shallow" feed to the **down** row (3.2 m — a true
  short ball, vs the old ~7.0 m clamped feed).

### Hitter frame and mirror invariance

Inside `compute_stroke`, the hitter's right in world +x terms is
`-z_sign` (side P hits toward −z and faces −z, so their right is +x; side C
is the mirror). Because the cell is interpreted in the hitter's frame at the
sink, aim values become **mirror-invariant**: the CPU-vs-CPU un-mirroring of
side P's aim (`pending_aim_x = -mv.swing_aim_x`) is deleted.

### Removed mechanisms

- Tunables `aim_x_scale`, `rally_depth_min`, `rally_depth_max` are removed
  (struct, defaults, set/get, registry). Cells are absolute coordinates; the
  old pre-error depth clamp `[rally_depth_min, rally_depth_max]` is deleted
  (cells are in-range by construction). The post-error safety clamp
  `[2.0, court_half_len + 2.5]` stays.
- Autotune study configs that searched `rally_depth_min/max`
  (root autotune.*.config.json, the tracked example configs) must have
  those search dimensions removed — the runner exits on unknown parameter
  names, so a stale config would fail loudly at startup. Historical
  `best_params.json` artifacts no longer apply back cleanly; accepted.

## 4. Quality-gated length control

The previous implicit rule (`base_z = type_z − (1−q)·1.5`, plus depth clamp)
is replaced by one coherent mechanism:

```
natural_z  = per-type: Flat 7.0 | Topspin 7.5 | Slice 6.5 | Lob 7.5 | Drop 2.4
len_ctrl   = clamp((q − 0.30) / 0.60, 0, 1)      // 0 at mishit-zone q, 1 at Perfect q
achieved_z = natural_z + (cell_z − natural_z) · len_ctrl
```

- Clean contact (q ≥ 0.90) reaches the exact cell depth; poor contact
  collapses toward the shot's natural depth **from both sides** — a
  stretched deep aim lands shorter *and* a stretched drop-volley attempt
  floats deeper. `q` here is the post-forgiveness human-lifted value, so the
  human keeps their existing 20% contact forgiveness.
- **Depth-dependent speed** (the "internal power modulation"): applied to
  **drive shots only — Flat (including flat volleys; not smash, whose power
  identity is fixed)**. Review finding: the control solver
  (`solve_control`, used by Topspin/Slice/Lob/Drop) derives launch velocity
  purely from apex + target geometry and ignores the requested speed, so a
  speed multiplier is a no-op there — spin shots modulate pace
  *intrinsically* through the solver when given a short target. Flat uses
  the drive solver (speed-priority, sweeps −32°..+34° ignoring theta
  windows), so Flat needs the explicit cut to sink short targets:

```
achieved_z ≥ aim_safe_depth:  mul = 1.0 + 0.05 · (achieved_z − safe)/(deep − safe)
achieved_z <  aim_safe_depth: mul = 1.0 − aim_short_speed_drop · (safe − achieved_z)/(safe − short)
speed *= clamp(mul, 0.6, 1.05)        // Flat / flat volley only
```

  At the shortest depth this is ×0.72. Because the modulation reads
  **achieved_z**, poor contact also collapses the power adjustment
  coherently. Multiplier stacking order in `compute_stroke` (documented for
  clarity): per-type base speed → charge/perfect/jam/counter → depth mul →
  shallow-contact boost (`shallow_speed_mul`: 1.0 at the baseline →
  `shallow_speed_mid` 1.20 at the service line → `shallow_speed_net` 1.70 at
  the net) → `ball_speed_scale`. The boost is deliberately strong so a short
  ball can be put away for a stroke winner: a clean forecourt (z≈5) flat
  drive comes back ~1.3× faster than the same shot from the baseline. For
  **Flat** the boost multiplies requested speed (drive solver). For
  **Topspin/Slice** the control solver ignores requested speed, so the boost
  is delivered as arc-flattening instead (`shallow_spin_flatten` lowers
  `def_theta_max` ∝ the boost excess → a flatter, faster path to the same
  landing; net clearance self-limits it). Topspin gains ~+26% at a forecourt
  contact; Slice, low and floaty, is near its geometric ceiling (~+8%). A
  down-cell Flat from the forecourt combines the ×0.72 short-target cut with
  the shallow boost (net ~1.2×) — still a controllable put-away angle.
- **Lateral control has no quality collapse.** Rationale: (a) the Gaussian
  error model already scales lateral scatter by `1 + err_quality_gain·(1−q)`
  — that *is* the lateral quality mechanism; (b) pulling the target toward
  the center on bad contact would *reduce* side-out risk, i.e. reward bad
  contact; (c) the spec calls out length specifically.

## 5. Serve cells

`compute_serve` drops `target_preset : Preset` and `aim_adjust`; it takes
hitter-frame `aim_x` and `aim_depth` (quantized by `aim_cell`).

- **Lateral (box frame)**: with `serve_box` giving `x_sign`/`z_sign`,
  `x_T = x_sign·0.45` (near the center line), `x_wide = x_sign·(4.115 −
  0.55)`, `x_mid` their midpoint, and the hitter's right in +x terms being
  `−z_sign`:

```
t_lat = aim_cell(aim_x) · (−box.z_sign)
tx    = clamp(x_mid + t_lat · |x_wide − x_T|/2, [x_T .. x_wide])
```

  Deuce/ad and both server ends come out automatically correct (e.g. P
  serving deuce: right = +x = toward the center line = a T serve; on ad the
  same key is wide).
- **Depth rows** (insets from the service line; new tunables):
  `serve_deep_inset 0.35` (up — ギリギリ), `serve_safe_inset 1.20` (none —
  deliberately safer than the old 0.55 default), `serve_short_inset 2.30`
  (down, z ≈ 4.10). Quality collapse uses the meter accuracy:
  `serve_len_ctrl = clamp((acc − 0.40)/0.60, 0, 1)`, natural inset = the
  none row. The down row additionally applies a **per-type speed cut**
  (review finding: ×0.85 is not slow enough for flat pace to land ~4.1 m
  from the net): Flat ×0.68, Slice ×0.72, Kick ×0.85 (kick's loft already
  drops it short). Constants in serve.mbt. A short **kick** serve may still
  land somewhat long of the row (the drift re-solve is best-effort at
  kick's high loft) — accepted; the serve test asserts the short row lands
  ≥0.8 m shorter than the none row.
- **Lateral deviation from the rally table** (accepted, documented): serve
  columns use fixed insets (T 0.45 / wide 0.55) for all rows — diagonals
  differ from single presses in **depth only**. In a 6.4 m box a separate
  "corner ギリギリ" lateral tier adds risk without meaningful placement
  difference.
- **CPU**: `ServePlan` keeps the tactical `Preset` (Wide/Body/T — box-frame
  is the natural tactical language) and gains `row : Int ∈ {-1,0,1}`.
  A new `preset_aim_x(preset, serving_side, court_side)` converts the preset
  to hitter-frame `aim_x` at the execution sites. First serves aim deep
  (row = 1) with probability 0.5 hard / 0.3 normal / 0.1 easy, else row 0;
  second serves always row 0. Practice serve feeds keep the random preset
  with row 0.

## 6. CPU stroke aim

`choose_stroke` enumerates the **9 cells** instead of its former 6
hard-coded targets. For utility scoring, each cell is converted to absolute
court coordinates via the same `rally_cell_target` + hitter-frame flip the
shot layer uses — the AI's divergent `base_z` table (10.6/9.8/9.2) and the
`/aim_x_scale` inversion are deleted; the plan stores the cell directly
(`aim_x`, `aim_depth` ∈ {−1, 0, 1} as Doubles).

Scoring carries over unchanged: open-court distance from the opponent,
`aggr`/`cons` stat biases, the stretch penalty, style bias, and
difficulty-scaled choice noise. Flags become: `corner` = the 4 diagonals,
`short_` = the down row. One addition — a **rally-deep-by-default** penalty
on the short row, `short_ · (0.5 + 0.25 · clamp((|pred_z| − 9.0)/3.0, 0, 1))`:
without it the open-court term rewards short balls against a baseline camper,
and the removal of the old `rally_depth_min` floor let the CPU float
everything short (deep-first-bounce rate fell to ~24% before the term, ~59%
with it). A short ball is thus a tactical exception (the drop override
handles the deliberate case), not a reflex. Tactical overrides map to cells:
**Lob → none row** (`aim_depth = 0.0` — review finding: the up row would turn
a defensive lob into a ~30% gift out; 9.2 m clears a net-rusher fine),
Drop → down row (−1.0).

## 7. Preserved interactions

Layered on top of the cell target, unchanged except two guards:

- **Topspin charge** (angle widen + short-angle attack): kept; the attack
  pull applies only when `|tz| > topspin_attack_min_depth` so it can never
  *deepen* a down-cell aim, and the widen clamp is capped at
  `half_width − aim_corner_margin` (review finding: the old ±3.815 clamp
  would let a charged safe-side aim end up riskier than a corner aim).
- **Slice charge deepen**: kept; capped at the up-row line
  (`court_half_len − aim_deep_margin`) instead of `court_half_len`, so
  charging never pushes the pre-error target past the ギリギリ line.
- **Jam shortening**: kept as-is (an involuntary quality event — consistent
  with quality-gated depth control).
- **Error model**: completely unchanged (`stroke_err_x 0.584 / stroke_err_z
  1.181` scaled by `err_mul_base(ctl) · (1 + err_quality_gain·(1−q))`,
  volley 0.4×, perfect 0.6×; serve errors with `acc`). Corner cells plus
  this scatter *are* the intended risk model: at high ctl and clean contact
  a corner aim carries a real but controlled out chance that grows sharply
  with bad contact. Calibration lever if corners prove too wild:
  `aim_corner_margin` 0.35 → 0.45.

## 8. Tunables & registry changes

Removed: `aim_x_scale`, `rally_depth_min`, `rally_depth_max`.
Added: `aim_deep_margin`, `aim_safe_depth`, `aim_short_depth`,
`aim_side_safe_margin`, `aim_corner_margin`, `aim_short_speed_drop`,
`serve_deep_inset`, `serve_safe_inset`, `serve_short_inset` — all in
`logic/tuning/tuning.mbt` (5 hookup points each) and
`scripts/autotune/registry.json`, so future CPU-vs-CPU studies can search
them.

## 9. Verification plan

- `moon test` (native + js): existing suite with deliberate re-thresholds
  (practice-feed aim mapping, deep-reliability moves to the none cell, serve
  helper signatures), plus new tests: 9-cell depth ordering, corner-vs-side
  width ordering, quality-collapse of length control (both directions),
  serve rows/lateral correctness on (P, Deuce) and (C, Ad) with in-box
  rates, and a **quantitative up-row out-rate band** (clean-contact topspin
  up-aim long-rate within [0.05, 0.40] over seeds — catches both a broken
  ギリギリ and a silently-safe regression).
- Golden regeneration (all 27 CPU reports + the human input tape, whose
  {−1,0,1} moves already produce exact cells); determinism double-run;
  manual sanity of report deltas (fault rates, winner rates).
- Manual play checklist: all 9 regions reachable with arrows during charge;
  serve arrows correct on deuce and ad; CPU visibly uses corners and short
  balls; mobile joystick diagonals register.
