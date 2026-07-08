# CPU-vs-CPU Match Mode

## Problem

The game hardwires side `P` (`@rules.P`, positive-z half) to host input and
side `C` (`@rules.C`, negative-z half) to the AI:

- `fixed_update` pulls P movement from `host_move_x/z`
  (`logic/game/game.js.mbt:1564`), P strokes from the charge/timing model
  (`update_human_charge`, `:1337`), and P serves from `host_was_pressed`.
- Only side C runs `@ai.update_ai` (`:1611`).
- `start_match` creates the P player with `speed_mul = 1.0`
  (`:647`) while C gets `ai.diff.speed_mul`.
- The serve auto-fire in the `Serving` branch triggers only for
  `sv == @rules.C` (`:1751`).
- `contact_quality` grants side P an unconditional `reach_grace = 0.2`
  (`logic/shots/shots.mbt:151-152`), independent of assist.

For tuning we need both sides driven by the *same* AI brain so results are
symmetric and reflect the shipped CPU behavior.

## Design: mirrored AI context, real game loop

We run the **real** match loop (`fixed_update`, serving state machine,
scoring, `MatchStats`) and add a second `@ai.Ai` for side P. We do **not**
build a separate simulation package: the tuned quantities (error draws, jam,
double faults, net points, scoring flow) live in `attempt_contact` /
`execute_serve` / `point_end` orchestration that a standalone harness would
have to duplicate and would inevitably diverge from.

`update_ai` itself is hardcoded to the negative-z side (`home_z = -12.3`,
`on_side = dsign(z) < 0`, stand-z clamps, `sample_hit_points(..., -1.0, ...)`,
targets in +z space). Rather than refactor it, we feed the P-side AI a
**mirrored world** — a 180° rotation about the y axis:

| Quantity | Mirror map |
| --- | --- |
| ball `px, pz, vx, vz, sx, sz` (spin fields are `sx/sy/sz`) | negate |
| ball `py, vy, sy`, `active` | unchanged (copy) |
| own position (P player) | negate x, z |
| opponent position (C player → ctx `human_x/z`) | negate x, z |
| ctx `can_hit` | `ball.active && last_hit_by == Some(@rules.C)` (flipped side test) |
| ctx `cpu_swinging` | the **P** player's `swinging` |
| ctx `bounced`, `ball_stamp`, `game_time`, `surface` | pass-through |
| returned `AiMove.x`, `AiMove.z` | negate |
| returned `swing_aim_x` | negate |
| returned `swing_aim_depth`, `swing_type` | unchanged (`compute_stroke` handles side via `z_sign`) |

This leaves `logic/ai/ai.mbt` essentially untouched, so the brain used
during tuning matches the shipped one, and the AI's RNG-draw ordering
comments ("keep the rng stream stable") stay valid. Exactly two
default-neutral touches to `ai.mbt` are permitted by the registry (doc 02):
the `ai_tactical_scale` multiplier inside `tactical_shot_type`, and reading
`aim_x_scale` at the `plan_x = best_tx / 2.8` inverse (`ai.mbt:325`) so the
AI's aim stays coupled to the stroke model's deflection scale. Both default
to today's values.

The mirrored ball is a scratch `@physics.Ball` stored on `MatchState`
(`p_view_ball`), overwritten each step to avoid per-step allocation.

## New surface

New file `logic/game/autotune.js.mbt` (same package as `game.js.mbt`, so it
sees `Game`/`MatchState`; `.js.mbt` because those types are JS-backend-only):

```moonbit
pub fn set_cpu_mode(on : Int) -> Unit      // export: setCpuMode
pub fn get_match_stats() -> String         // export: getMatchStats ("" if none)
fn build_report(...) -> String             // see 03-match-report-schema.md
fn p_ai_ctx(ms : MatchState) -> @ai.AiCtx  // mirrored view
```

`moon.pkg.json` gains the two exports. `set_cpu_mode` must be called after
`init` and **before** `menuCmd("play", ...)`; it sets `Game.cpu_vs_cpu` and
`@tuning.t.cpu_p` (see below).

## State additions

- `Game`: `mut cpu_vs_cpu : Bool` (default `false`),
  `mut last_report : String` (default `""`).
- `MatchState`: `ai_p : @ai.Ai?`, `mut p_serve_plan : @ai.ServePlan?`,
  `p_view_ball : @physics.Ball`, `point_log : Array[PointRecord]`,
  `mut last_end_kind : Int`, `mut point_start_t : Double` (see 03).
  `point_start_t` is stamped when the point enters `Serving` (first serve
  attempt of the point, not per let/second serve); a point's `duration_s` is
  `ms.time - point_start_t` at `point_end`, so inter-point dead time
  (`point_over_dur`) is excluded.

## Gating checklist

Every gate has the shape `if self.cpu_vs_cpu { new } else { existing }` with
the `else` branch textually identical to current code. The complete list of
P-side human blocks to gate:

1. **`handle_input`** (`game.js.mbt:1424`) — early-return in CPU mode
   (menu keys are irrelevant headless; menuCmd drives menus directly).
2. **`start_match`** (`:641`) — in CPU mode:
   `ai_p = Some(@ai.create_ai(char_p, difficulties[sel_difficulty].id))` and
   `create_player(@rules.P, char_p, ai_p.diff.speed_mul)`; assist is forced
   `Off` (the runner also sets it via the menu, this is belt-and-braces).
3. **Serve meter / P serve trigger** (`PreServe`/`Serving` branches) — in CPU
   mode, when `server == @rules.P` and the pre-serve timer has elapsed
   (reuse the same delay the C branch uses):
   `p_serve_plan = Some(@ai.choose_serve(ai_p, second_serve, rng))`, then
   start the toss; pin the P server's stance the same way the C branch pins
   C's. The plan-fire condition at `:1751` generalizes from `sv == @rules.C`
   to "sv is AI-controlled", consuming `p_serve_plan` or the C plan
   respectively and using that side's stats for `serve_contact_h`.
4. **Movement input pull** (`:1564`) — replace `host_move_x/z` with the
   mirrored `update_ai` output for P; apply the same acceleration/clamp
   model as the human path (it is the same `Player` integrator).
5. **Magnet / slow-mo assist** — inert once assist is Off (verify; if any
   branch is reachable with assist Off, gate it).
6. **`update_human_charge`** (`:1655` call site) — skip in CPU mode.
7. **P contact** — instead of the timing-window/charge contact, mirror the
   side-C exact-contact block (swing scheduled by `AiMove.swing`, contact at
   `swing_t >= swing_contact_t`, `power_mul = 1.0`, aim from mirrored
   `swing_aim_x` / `swing_aim_depth`, `fh = b.px - pos_x >= 0.0`).
8. **`reach_grace`** (`logic/shots/shots.mbt:151`) — gate:
   `let human = side == @rules.P && !@tuning.cpu_p_active()`. This is the
   one change outside `logic/game/`; it lives behind a tiny flag accessor in
   the new `logic/tuning` package so `shots` does not import `game`.
9. **`frame_update` / `get_time_scale`** — not called headless; no gating
   needed. Sweet-spot bookkeeping happens in `fixed_update` and stays as-is.
10. **Receiver positioning** (`position_for_serve`, `game.js.mbt:791`) —
   `let shift = if rc == @rules.C { @ai.return_shift_factor(ms.ai) } else
   { 1.4 }` gives the C receiver a difficulty-dependent shift (1.05/1.4/1.7)
   while P always gets the human-neutral 1.4. In CPU mode both receivers use
   `return_shift_factor` of their own AI, else the return game is
   systematically asymmetric on easy/hard.

## Report snapshot

`teardown_match()` runs *before* `host_show_results` in `point_over_step`
(`game.js.mbt:1870-1871`), so the report must be built first: in
`point_over_step`, when the match has a winner, set
`self.last_report = build_report(ms, winner)` immediately **before**
`teardown_match()`.

## RNG policy

Both AIs and all stroke/serve noise share the single per-`Game` Gauss stream,
seeded by `init(host, seed)`. Draw *order* therefore differs from the
human-vs-CPU game (P now draws too) — that is fine; determinism only requires
a fixed order per mode, which the fixed-step loop guarantees.

## Symmetry validation

Raw point share is **confounded by serve advantage**: `start_match` fixes
`first_server = @rules.P` (`game.js.mbt:655`) and the runner cannot change
it, so in short sets P serves more games and a healthy serve advantage skews
pooled point share away from 50% with zero implementation asymmetry.

The symmetry check therefore compares **side-conditional serve statistics**
on a mirror matchup (`you == opp`, ≥50 seeds): P's serve-point win rate vs
C's serve-point win rate (computable from the per-point `server`/`winner`
log) must agree within the binomial 95% band, and the same for
double-fault and first-serve-in rates. A systematic gap indicates a missed
asymmetry (serve handling, receiver shift, reach_grace, speed_mul, aim
mirroring). This check is part of the Stage verification matrix (doc 06).
