# Design — Charge & Perfect-Hit groundstrokes

Status: **implemented** (Appendix A.2 of `game-design.md`). This note records the
mechanic and where it lives in the code.

## Goal

Replace instant-press groundstrokes with a skill mechanic: **hold to charge, release to
hit**, with a release-timing **Perfect Hit** bonus and an **Overcharge** risk. This adds a
power/risk dial and a timing skill on top of the existing position-based contact-quality
model, for every player (the CPU swings at neutral power; Assist=Full automates it).

## Model

Charge state lives on `Player` (`logic/game/player.js.mbt`): `charging`, `charge`,
`charge_type`, `swing_charge`, `swing_no_perfect`, `stiff_t`, `whiff_cd`. The per-frame
state machine is `Game::update_human_charge` in `logic/game/game.js.mbt`, driven by the
pull inputs `host_shot_held` (keyboard hold) and `host_is_down("TouchShot")` (touch hold).

| Constant (`game.js.mbt`) | Value | Meaning |
|---|---|---|
| `charge_time` | 0.8 s | hold time to reach `c = 1.0` |
| `charge_max` | 1.25 | overcharge ceiling |
| `cpu_charge` | 0.375 | CPU power_mul = 0.85+0.40·0.375 = 1.0 (neutral) |
| `full_assist_charge` | 0.7 | auto-charge level under Assist=Full |
| `safety_drop_y` | 0.7 m | low-ball trigger for a Safety Hit |
| `safety_approach_rate` | 3 m/s | vertical safety suppressed while closing faster |
| `whiff_cd_dur` | 0.25 s | cooldown after a release out of reach |
| `stiff_dur` / `stiff_factor` | 0.35 s / 0.12 | post-impact movement stiffness |

Flow:
1. **Hold** a shot key (or the touch SHOT button) → start charging; `charge_type` is the
   held key, or a random type for touch. `charge` ramps to `charge_max`; the charge bar
   (`host_charge`) shows it (red past 1.0).
2. **Release** → `fire_charged_swing(safety=false)`: capture `swing_charge`, start the
   swing. Contact is attempted in the existing window (`swing_contact_t ± swing_window`).
3. **Safety Hit** — `should_safety_hit` auto-fires (`safety=true`) when the ball is in
   reach but escaping (passed the player horizontally, or dropped below `safety_drop_y`
   while no longer closing fast). No Perfect bonus.
4. **Whiff** — the swing completes with no contact → `whiff_cd` blocks re-charging briefly.

## Power / Perfect / Overcharge in the stroke

Threaded into `@shots.compute_stroke` via three optional args (defaults keep the function
neutral, so existing tests and the CPU path are unchanged):

- `power_mul = 0.85 + 0.40·min(charge, 1)` scales the launch speed.
- `perfect_eligible` + the contact quality decide `perfect = q ≥ 0.90`. A Perfect Hit
  multiplies speed ×1.08 and spin ×1.12 and tightens aim (error ×0.6); `Stroke.perfect`
  is returned so the game layer plays the bell (`sfxPerfect`) and a gold cue.
- `overcharge = max(0, charge − 1)` adds aim error `∝ overcharge·2.8 m` to both axes,
  spraying the ball — going for maximum power raises out/net faults.

## Tests

`logic/shots/shots_test.mbt`:
- full power is ~+47 % faster than a tap; a Perfect Hit on an ideal contact adds ~8 %.
- overcharge lowers the in-rate (more faults) vs a clean hit.

Both pass bit-exactly on the native and JS backends.
