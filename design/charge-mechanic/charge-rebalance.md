# Charge Rebalance — no-charge is a full shot, overcharge is the risk

## 1. Motivation

The hold-to-charge groundstroke (see `design_docs/charge-and-perfect-hit.md`) currently
maps charge to launch speed as `power_mul = 0.85 + 0.40·min(charge, 1)`
(`logic/game/game.js.mbt`). So a **no-charge** tap is only **0.85×** power; combined with the
contact-quality factor (`flat_speed = max_flat_speed(pow) × (0.52 + 0.48·q)`), a weak or
hurried stroke can fall short of the net. Players experience this as *"if you don't charge
enough, the ball doesn't even reach the net."*

This change makes charge a **bonus**, not a tax:

1. **No-charge is a complete, reliable shot** — it clears the net and lands in (like the CPU,
   which already plays at `power_mul = 1.0`).
2. **Charge adds bonus** pace on top, plus the existing topspin/slice identity and Perfect-Hit.
3. **Over-charging raises the risk of BOTH going OUT and netting it.**

## 2. Background (current code)

- Launch speed: `compute_stroke` does `speed = speed × eff_power` where
  `eff_power = power_mul` (`logic/shots/shots.mbt`).
- The solver `solve_shot` (`logic/physics/solver.mbt`) bisects the launch angle to land at the
  target and even grows the speed up to ~×1.4 if the input is too slow — but there is **no net
  clearance guarantee**, so a too-weak base speed can still clip the net.
- Overcharge today only scatters the **target** (`tx`, `tz`) by `rng.draw()·overcharge·2.8`.
  Scattering `tz` mostly produces *out-long* errors; it gives little **net** risk, because the
  solver simply re-lofts to the (now shorter) target.
- The CPU passes `power_mul = 0.85 + 0.40·min(0.375,1) = 1.0`; serves use a different path.

## 3. Design

### A. No-charge baseline = 1.0 (charge is a bonus)
Human swing power becomes:

```
power_mul = 1.0 + CHARGE_BONUS · min(swing_charge, 1)      // CHARGE_BONUS = 0.25
```

- No charge → **1.0** (the calibrated baseline the CPU already uses → clears the net, lands in).
- Full charge → **1.25** (unchanged peak; only the weak floor is lifted from 0.85 to 1.0).
- `charge_time = 0.8 s` and `charge_max = 1.25` are unchanged, so the overcharge window
  (charge 1.0 → 1.25, held 0.8–1.0 s) is unchanged.

The CPU keeps `power_mul = 1.0` (passed directly; the `cpu_charge` constant is removed).
`compute_stroke` is unchanged for speed — it already multiplies by `power_mul`, so passing
1.0 is the neutral baseline.

### B. Overcharge = out **and** net risk
Two effects, both scaling with `eff_overcharge = max(0, charge − 1)` (0 … 0.25):

- **Wide / long (OUT):** keep the existing `tx` and `tz` target scatter
  (`rng.draw()·eff_overcharge·2.8`). Spraying the target wide or deep sends balls out.
- **Net (NEW):** after `solve_shot`, jitter the solved **launch loft** (vertical velocity):

  ```
  if eff_overcharge > 0:
      vy_out = solved.vy · (1 + rng.draw() · eff_overcharge · LOFT_K)   // LOFT_K ≈ 1.3
  ```

  - jitter **up** → loftier → carries past the target → **OUT (long)**;
  - jitter **down** → flatter → fails to clear the net → **NET** (or short).

  Net risk is naturally largest on flat / low-clearance drives and smallest on lobs — which is
  realistic, so the overcharge net-risk test uses a flat drive. Volleys pass
  `eff_overcharge = 0`, so they are unaffected. Scaling only `vy` (not `vx`/`vz`) changes both
  the launch **angle** and slightly the total **speed** — intended: an over-swing that flattens
  the ball also takes a touch of pace off it, which reinforces (not distorts) the net outcome.

**Determinism note (important):** we **do NOT remove or change** the existing `tx`/`tz`
overcharge scatter — those `rng.draw()` calls stay exactly where they are (they already run
unconditionally today, contributing 0 when `eff_overcharge = 0`). We only **add** the loft-jitter
`rng.draw()`, and it is **guarded by `eff_overcharge > 0`**. Therefore the `eff_overcharge = 0`
path draws the **identical sequence** it does today:
- the **CPU** calls `attempt_contact` with no `overcharge` arg (defaults to 0) → no new draw;
- a **no-charge** human stroke has `eff_overcharge = 0` → no new draw;
- **serves** don't go through `compute_stroke` at all (`compute_serve` calls `solve_shot`
  directly) → unaffected.
So the shared seeded RNG stream and the float-parity tests are preserved bit-for-bit; only a
deliberately over-charged human shot consumes the extra draw (new behaviour, nothing to match).

### C. Charge bonus (unchanged)
The topspin/slice charge identity (`charge_cc`: heavier spin, wider cross-court angle,
short-angle attack, deeper slice — `logic/shots/shots.mbt`) and **Perfect-Hit** (sweet-spot
release: speed ×1.08, spin ×1.12, aim ×0.6) are untouched. They stay the reward for charging,
now layered on a full-strength baseline.

### D. Charge-bar risk-zone cue (UI)
So the new risk is manageable, the charge bar marks the overcharge zone: a divider at the
full-power line (`1.0 / 1.25 = 80 %` of the bar) and a warning tint on the fill once it passes
that line. (The current bar has no such cue, despite an out-of-date note claiming it does.)
Implemented in `src/ui.js` (`charge()` / the `#chargebar` element + CSS); no FFI change.

## 4. Files

| Concern | Location |
|---|---|
| `power_mul` baseline + CPU power | `logic/game/game.js.mbt` (human swing block, CPU block) |
| Overcharge loft jitter + `LOFT_K` | `logic/shots/shots.mbt` (after `solve_shot`) |
| Charge-bar risk zone | `src/ui.js` |
| Tests | `logic/shots/shots_test.mbt` |
| Doc reconcile | `design_docs/charge-and-perfect-hit.md`, `design_docs/game-design.md` §6.2, `README.md` |

## 5. Tests (`logic/shots/shots_test.mbt`)

- **No-charge is reliable** — Monte-Carlo in-rate for a demanding deep stroke: `power_mul = 1.0`
  lands IN at a high rate (≥ 0.9) and clearly higher than the old `power_mul = 0.85` (which
  undershoots), demonstrating the fix.
- **Charge is a bonus** — full charge (1.25) is faster than no-charge (1.0) by a bonus margin
  (`hi > lo·1.15`), replacing the old ×1.4 assertion.
- **Overcharge adds OUT and NET risk** — at `overcharge = 0.25`, in-rate drops clearly below
  `overcharge = 0`, and a landing classifier confirms **both** out-long and net (came-back /
  short) failures occur (net demonstrated on a flat, low-clearance drive).
- Slice-depth and topspin short-angle-attack tests (driven by `charge_cc`) are unchanged.

Both backends (`moon test` native + `--target js`) must stay green; `moon check --target js`
and `npm run build` clean.

## 6. Out of scope / risks
- `CHARGE_BONUS`, `LOFT_K`, and test thresholds are first estimates — tuned so no-charge is
  dependable and overcharge is risky-but-usable.
- The shared `solve_shot` solver is **not** modified (it also drives serves and the CPU); all
  changes are in the human charge mapping, the overcharge handling, and the UI.
