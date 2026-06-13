# Kaizen: Easing Play Difficulty (Camera Fixed)

## Goal

Make the game **easier and more pleasant to play** without touching the camera
position or angle. The camera is a fixed third-person rig
(`src/camera.js`: `CAMERA_BACK = 2.5`, `EYE_H = 1.62`) and stays exactly as-is for
every proposal in this folder. All improvements come from **ball-speed tuning, new
gauges/indicators/buttons, contact-model forgiveness, and assist toggles**.

## Where the difficulty actually comes from

The game already does a lot to *telegraph* what is happening — landing ring,
sweet-spot ring, move-hint arrow, reach-zone circle, toss gauge, and audio cues.
What it does **not** do is give any *mechanical assistance*. Three concrete pain
points remain:

1. **Depth judgment against a fixed camera.** With a single fixed viewpoint, the
   player cannot easily tell how far away the ball is or *when* it will arrive. The
   only depth cues are a fading shadow blob and ball-size scaling
   (`src/entities/ball.js`).

2. **Swing timing has no window.** Contact auto-fires at a fixed 18% of the swing
   animation (`SWING_CONTACT_T = 0.18`, `src/entities/player.js:8`). There is no
   "early / good / late" feedback during a rally, so the player has no learnable
   timing signal — they either happen to be in range when they press, or they whiff.

3. **Positioning must be precise.** Contact quality `q` depends on standing an
   arm-plus-racket length from the ball at waist height (`contactQuality()`,
   `src/game/shots.js:35`). Off-center contact silently drops power, spin, and
   depth, which reads as "my shots randomly got weak."

Note what has *already* been tuned for ease: `PACE = 0.64` (ball at ~80% speed),
`1.5×` player move speed, and `1.5×` reach zone
(`src/physics/constants.js:75-87`). The proposals below pick up where that tuning
left off, focusing on **feedback and assistance** rather than only more speed cuts.

## Design principles

- **Camera untouched.** Every idea works within the existing fixed view.
- **Prefer toggles over forced changes.** Bundle human-side aids behind an
  opt-in "Assist Mode" so the current balance is still available to advanced
  players (see `05-ui-buttons-and-assist-mode.md`).
- **Decouple player difficulty from CPU difficulty.** Today `Easy/Normal/Hard`
  only weakens the *CPU* (`src/ai.js`). Player-side ease should be a separate axis.
- **Additive first.** Favor changes that add a gauge/indicator or a tunable
  constant over invasive rewrites.

## Proposal map

| File | Theme | Headline ideas |
|------|-------|----------------|
| `01-ball-speed-and-time.md` | Ball speed & time | Difficulty-linked PACE; approach slow-motion; incoming-speed cap |
| `02-swing-timing-aids.md` | Timing gauges | Swing timing meter; contact-quality reticle; auto-swing assist |
| `03-positioning-and-depth-cues.md` | Depth/position displays | Time-to-contact countdown; court depth ladder; enhanced shadow; incoming-height bar; positioning magnetism |
| `04-contact-forgiveness.md` | Contact model | Widen quality bands; soften mishit & velocity penalty; assist-scaled reach |
| `05-ui-buttons-and-assist-mode.md` | UI / buttons / mode | Recommended-shot highlight; touch ergonomics; "Auto" shot button; unified Assist Mode |

## Priority matrix (impact × effort)

Impact = how much it reduces felt difficulty. Effort = rough implementation cost.

| Idea | Impact | Effort | File |
|------|:------:|:------:|------|
| Approach slow-motion | High | Low–Med | 01 |
| Swing timing meter | High | Med | 02 |
| Court depth ladder | High | Low | 03 |
| Recommended-shot highlight | Med–High | Low | 05 |
| Time-to-contact countdown | High | Med | 03 |
| Difficulty-linked PACE | Med | Low | 01 |
| Enhanced ball shadow | Med | Low | 03 |
| Widen contact quality bands | Med | Low | 04 |
| Incoming-height bar | Med | Med | 03 |
| Auto-swing assist | High | Med–High | 02 |
| Positioning magnetism | Med–High | Med–High | 03 |
| Unified Assist Mode toggle | Med (enabler) | Med | 05 |
| Touch-control ergonomics | Med | Low–Med | 05 |
| Soften mishit / velocity penalty | Med | Low | 04 |

## Recommended first wave

A high-impact, mostly-additive, camera-safe starter set that can ship without
rebalancing the whole game:

1. **Approach slow-motion** (01) — directly buys reaction time, the single biggest
   relief for a fixed-camera game.
2. **Swing timing meter** (02) — turns timing from invisible into a learnable
   signal, reusing the existing toss-gauge pattern.
3. **Court depth ladder** (03) — cheap, static, dramatically improves depth
   reading.
4. **Recommended-shot highlight** (05) — cheap, reduces decision load for new
   players.

Wrap the player-affecting ones behind the **Assist Mode** toggle (05) so the
default experience can stay as tuned today while beginners opt into help.

## How to read each proposal

Every idea uses the same template:

- **Problem** — the specific friction it removes.
- **Proposal** — what to add/change.
- **Implementation pointers** — concrete `file:line` anchors to start from.
- **Effort / Impact** — rough sizing.
- **Risks** — balance or UX caveats to watch.
