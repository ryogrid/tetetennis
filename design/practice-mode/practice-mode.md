# Practice Mode — Design Doc

## 1. Motivation

Until now the game offered a single experience: a scored singles match against the
CPU. This document specifies a second top-level mode, **PRACTICE**, sitting beside the
existing scored game (now called **MATCH**). In PRACTICE the CPU does not play a match
— it acts as a *ball machine*, feeding the human balls under conditions the player
chooses, so the player can groove a return. **No points are ever counted.** The loop
runs indefinitely until the player quits via the pause menu.

The existing scored game is preserved unchanged and is selected as MATCH.

## 2. Player-facing flow

A new top-level **mode-select** screen is the game's home screen:

```
HOME (mode)        MATCH  |  PRACTICE
```

### MATCH (unchanged, with a mode prefix)

```
Mode → Player → Opponent → Surface → Difficulty → Set length → Assist → play
```

### PRACTICE

```
Mode → Player → Opponent → Surface → Feed → Shot → Depth* → Assist → play
                                                     (*stroke feeds only)
```

PRACTICE-configurable options:

| Option   | Choices                                                        |
|----------|---------------------------------------------------------------|
| Player   | the human's character (reuses MATCH char-select)              |
| Opponent | the CPU's character — its stats shape the fed ball            |
| Surface  | clay / grass / hard (reuses MATCH surface-select)            |
| Feed     | **Stroke** or **Serve**                                       |
| Shot     | Stroke: Flat / Topspin / Slice / Lob / Drop. Serve: Flat / Slice / Kick |
| Depth    | (stroke only) Shallow / Deep / Random                         |
| Assist   | Off / On / Full (reuses MATCH assist-select)                  |

Difficulty and Set-length are **not** asked in PRACTICE: the CPU never rallies, so AI
difficulty is irrelevant, and there is no set to win.

Every menu supports ←/→ + Enter (or tap, tap-again-to-confirm) and Esc to step back,
exactly like the existing screens.

## 3. The feed loop

PRACTICE reuses the existing `Match` app-state and the whole rally/physics/contact
pipeline. The only differences are encoded behind an `is_practice` guard:

1. The match is created with the **CPU as the permanent server/feeder**
   (`create_match(@rules.C, …)`). Because points are never added, the serving side
   never alternates.
2. On each rep the CPU initiates:
   - **Serve feed** — a forced `ServePlan` (the chosen serve type, a standard power in
     the meter's sweet band, and a *randomized* Wide/Body/T placement) is run through
     the normal toss → serve path. The human receives.
   - **Stroke feed** — `start_feed` skips the toss: the ball is placed at the CPU's
     racket and launched with `compute_stroke` using the **chosen shot type**, a
     **forced depth** (`aim_depth`), and a **randomized lateral aim** (`aim_x`). It
     enters play as a live groundstroke (no service-box validation).
3. The CPU's rallying brain and contact are **suppressed** in practice — after feeding
   it just stands. It never returns the human's shot.
4. When the ball goes dead (the human misses, hits out, or returns it and it bounces
   out on the far side), the rep ends with **no scoring, no stats, no banners** — just
   the existing short cool-down — and the next feed begins.

### Depth → `aim_depth`

`compute_stroke` already takes `aim_depth ∈ [-1, +1]` (negative = shorter/forecourt,
positive = deeper/backcourt). Practice maps the depth choice to it:

| Depth   | aim_depth                          |
|---------|------------------------------------|
| Shallow | −0.8 (bounces in the forecourt)    |
| Deep    | +0.8 (bounces deep / backcourt)    |
| Random  | per-rep coin flip of the above two |

Depth is meaningful for the basic three strokes; Lob and Drop have their own fixed
shape (`compute_stroke` clamps/over-rides their target), so the depth choice has little
effect there — which is why the depth screen is offered but its strongest effect is on
Flat/Topspin/Slice.

### Lateral variation

Each feed picks a fresh lateral target with the seeded RNG (`aim_x ≈ U(−0.85, +0.85)`)
so the player must move and set up rather than stand still.

## 4. HUD

The scoreboard is replaced in PRACTICE by a static read-out of the current feed
settings, e.g. `PRACTICE — Stroke · Topspin · Deep`. The results screen is never
reached (there is no match end).

## 5. Quitting

Esc opens the existing pause modal; **Quit** returns to the home (mode-select) screen.

## 6. Implementation map

| Concern                         | Location                                              |
|--------------------------------|-------------------------------------------------------|
| App states + config fields      | `logic/game/game.js.mbt` (`AppState`, `Game`)        |
| Practice record on the match    | `logic/game/game.js.mbt` (`MatchState.practice`)     |
| Menu routing (confirm/Esc/tap)  | `logic/game/game.js.mbt`                              |
| Feed loop (`start_feed`, gating)| `logic/game/game.js.mbt` (`fixed_update`, `point_end`, `fault`) |
| Pure feed mappings (testable)   | `logic/shots/shots.mbt`, `logic/shots/serve.mbt`     |
| Screen FFI bindings             | `logic/ffi/host.js.mbt`                               |
| Screen renderers + HUD          | `src/ui.js`                                           |

The pure mapping helpers (`practice_stroke_type`, `practice_depth_aim`,
`practice_serve_type`) live in `logic/shots` so they are covered by native `moon test`
(the `game`/`ffi` packages are JS-backend-only and are checked with
`moon check --target js`).

## 7. Determinism

The feed uses the existing seeded `rng` for lateral aim, depth coin-flips, and serve
placement, so a given seed replays identically — consistent with the rest of the engine.
No new RNG source is introduced.
