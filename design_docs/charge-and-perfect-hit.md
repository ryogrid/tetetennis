# Design — Charge & Perfect-Hit groundstrokes

Status: **implemented** (Appendix A.2 of `game-design.md`). This note records the
mechanic and where it lives in the code.

## Goal

Replace instant-press groundstrokes with a skill mechanic: **hold to charge, release to
hit**, with a release-timing **Perfect Hit** bonus. This adds a
power dial and a timing skill on top of the existing position-based contact-quality
model, for every player (the CPU swings at neutral power; Assist=Full automates it).

## Model

Charge state lives on `Player` (`logic/game/player.js.mbt`): `charging`, `charge`,
`charge_type`, `swing_charge`, `swing_no_perfect`, `stiff_t`, `whiff_cd`. The per-frame
state machine is `Game::update_human_charge` in `logic/game/game.js.mbt`, driven by the
pull inputs `host_shot_held` (keyboard hold) and `host_is_down("TouchShot")` (touch hold).

| Constant (`game.js.mbt`) | Value | Meaning |
|---|---|---|
| `charge_time` | 0.8 s | hold time to reach `c = 1.0` |
| `charge_max` | 1.25 | maximum charge |
| `charge_power_bonus` | 0.25 | full charge adds +25% pace over the 1.0 baseline |
| `full_assist_charge` | 0.7 | auto-charge level under Assist=Full |
| `safety_drop_y` | 0.7 m | low-ball trigger for a Safety Hit |
| `safety_approach_rate` | 3 m/s | vertical safety suppressed while closing faster |
| `whiff_cd_dur` | 0.25 s | cooldown after a release out of reach |
| `stiff_dur` / `stiff_factor` | 0.35 s / 0.12 | post-impact movement stiffness |

Flow:
1. **Hold** a shot key (or the touch SHOT button) → start charging; `charge_type` is the
   held key, or a random type for touch. `charge` ramps to `charge_max`; the charge bar
   (`host_charge`) shows it — the bar fills smoothly; longer charge = more power.
2. **Release** → `fire_charged_swing(safety=false)`: capture `swing_charge`, start the
   swing. Contact is attempted in the existing window (`swing_contact_t ± swing_window`).
3. **Safety Hit** — `should_safety_hit` auto-fires (`safety=true`) when the ball is in
   reach but escaping (passed the player horizontally, or dropped below `safety_drop_y`
   while no longer closing fast). No Perfect bonus.
4. **Whiff** — the swing completes with no contact → `whiff_cd` blocks re-charging briefly.

## Power / Perfect in the stroke

Threaded into `@shots.compute_stroke` via two optional args (defaults keep the function
neutral, so the CPU path and serves are unchanged). **Charge is a bonus, never a tax**
(see `design/charge-mechanic/charge-rebalance.md`):

- `power_mul = 1.0 + 0.25·charge` scales the launch speed linearly. **No-charge = 1.0** — the
  same full baseline the CPU uses, so an un-charged stroke clears the net and lands in.
  **Full charge = 1.3125** (a +31% pace bonus at max). Longer charge always means more power
  with no penalty.
- `perfect_eligible` + the contact quality decide `perfect = q ≥ 0.90`. A Perfect Hit
  multiplies speed ×1.08 and spin ×1.12 and tightens aim (error ×0.6); `Stroke.perfect`
  is returned so the game layer plays the bell (`sfxPerfect`) and a gold cue.

## Tests

`logic/shots/shots_test.mbt`:
- a no-charge stroke reliably lands in **and** is clearly faster than the old 0.85 floor.
- full charge is a bonus (~+31% at max) over no-charge; a Perfect Hit on an ideal contact
  adds ~8 %.

Both pass bit-exactly on the native and JS backends.
