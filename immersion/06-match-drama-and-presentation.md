# 06 — Match Drama, Presentation & Game Feel

The tension of tennis lives in the *score* — break point, set point, match point, the
swing of momentum — but right now all of it surfaces as the same plain text toast. This
document makes the match **perform its own drama**: a broadcast score bug, decisive-point
overlays, a unifying momentum system, celebrations, haptics, and a highlight reel. It
also defines the **shared sim→host signal** that `03` (audio) and `04` (camera) consume.

## What exists today

- DOM presentation only: `#banner` / `#toast` (`src/ui.js:171-176`), a scoreboard fed by
  `host_update_score(games, points, p, c, serve_no)` (`logic/ffi/host.js.mbt:203`), a
  shot flash (`host_flash_shot`, `:221`), a hit-quality bar (`host_hit_quality`, `:234`),
  a results screen (`host_show_results`, `:183`), and a pause modal.
- The drama is fully *computed* in `logic/rules/rules.mbt` — `Match` (points/games/tiebreak,
  `:27-41`), `add_point` (`:123`), `win_game` (`:105`), `score_strings` (`:182`),
  `PointEvent` (declared `Point / Game / TiebreakStart / SetWon`, `:19-24`) — and point
  outcomes flow through `record_winner` / `record_error` (`game.js.mbt:1104,1113`) and the
  point-end event (`game.js.mbt:1163-1181`). Note "Changeover" is *not* a discrete event:
  it is the inline condition `(games_p+games_c) % 2 == 1` baked into the GAME toast string
  (`game.js.mbt:1174`).
- But **break/set/match-point status, the point-winner side, rally length, and a momentum
  value are not exported to JS**, and there are **no haptics**.

---

## 6.0 The shared backbone: `point_situation` + `tension` *(build this first)*

**Problem.** Three features in three docs — tension-aware crowd (`03`), match-point camera
push-in / replay trigger (`04`), and the overlays below — all need the same fact: how
important and how tense is *this* moment?

**Proposal.** One pure evaluator in `logic/rules/rules.mbt`, derived from `Match` state
(`points_p/points_c`, `games_p/games_c`, `server`, `target_games`, `tiebreak`), fanned
out over a tiny output-only FFI:

```
host_point_situation(kind)   // "break" | "set" | "match" | "deuce" | "normal"
host_tension(value)          // 0..1 : situation + rally length + recent point swings
host_point_highlight(winnerSide, isBreak, isSetPoint, isMatchPoint, rallyLen, wasWinner)
```

Emit `point_situation` at serve setup, `tension` as it evolves, and `point_highlight` at
point end (this is the same signal `04`'s replay uses). Because these are **pure
functions of deterministic match state**, they *preserve* determinism — they add
derivable data, never randomness.

**Implementation pointers.** Evaluator + emit in `rules.mbt` / `game.js.mbt:1163-1181`;
externs in `host.js.mbt` (mirror the existing `host_update_score` shape, `:203`).

**Effort / Impact.** Med / High (enabler for four other features).

## 6.1 Broadcast-style animated score bug

**Problem.** The scoreboard is static text; score changes don't *land*.

**Proposal.** An animated lower-third that slides/flips on score change, in broadcast
style — **pure JS/DOM/CSS**, since `updateScore` already delivers everything needed
(`host.js.mbt:203`).

**Implementation pointers.** `src/ui.js` (the scoreboard render path); no new FFI.
**Effort / Impact.** Med / Med–High. **Risks.** Keep it out of the depth-cue zone and
fade it during a live rally (`00`, principle 5).

## 6.2 BREAK / SET / MATCH POINT moment overlays

**Problem.** The most decisive points in tennis arrive with no fanfare.

**Proposal.** A big animated overlay when the upcoming point is decisive, driven by
`host_point_situation(kind)` from §6.0. Pair it with the tension audio (`03`) and a
camera push-in (`04`) so the moment is multi-sensory.

**Implementation pointers.** `src/ui.js` overlay; trigger from the shared signal at serve
setup. **Effort / Impact.** Med / High. **Risks.** Don't occlude live cues; show at serve
setup, fade before the rally.

## 6.3 Unified momentum / tension system

**Problem.** Nothing ties the production together — crowd, music, camera, and overlays
each react (or don't) in isolation.

**Proposal.** Use the single normalized `tension` value (§6.0) to *simultaneously* drive
crowd gain (`03`), the music stinger (`03`), camera push-in (`04`), and overlay intensity
(`06`). This is the cross-cutting backbone that makes everything feel coherent rather than
bolted-on.

**Implementation pointers.** Compute in the sim (it owns score history); JS distributes
`host_tension(value)` to each subsystem. **Effort / Impact.** Med–High / High.
**Risks.** Derive from match state only, so it stays deterministic/reproducible.

## 6.4 Player celebrations & reactions between points

**Problem.** Winning a huge point and shanking an easy ball produce identical body
language: none.

**Proposal.** Fist pump on a winner, racket-tap on a missed sitter, walk-to-towel on the
changeover. This doc defines the **trigger** (`host_celebrate(side, kind)`, keyed off the
point winner + magnitude; the changeover beat is the derivable `(games_p+games_c) % 2 == 1`
condition, `game.js.mbt:1174`); the actual
**motion** is authored in the rig (`01`).

**Implementation pointers.** New extern `host_celebrate(side, kind)` in `host.js.mbt`;
motion in `player.js` (`01`). **Effort / Impact.** Low (signal) + handoff to `01` /
Med–High. **Risks.** Must yield to the next-serve timer; keep celebrations short.

## 6.5 Pre-match walk-on & coin toss

**Problem.** Matches start cold, straight into play.

**Proposal.** A short scripted intro — player names, the existing character cards
(`host_show_players`, `host.js.mbt:160`), a camera pan over the new stadium (`05`), a coin
toss — mostly JS choreography around `startMatch`.

**Implementation pointers.** `src/ui.js` + `camera.js` sequence at match start.
**Effort / Impact.** Med / Med. **Risks.** Make it skippable.

## 6.6 Hawk-Eye-style close-call review

**Problem.** Near-the-line bounces are resolved silently; the most suspenseful officiating
moment in tennis is invisible.

**Proposal.** On a near-line bounce, an optional animated ball-track review, **reusing the
deterministic bounce position and the replay buffer from `04`**. Auto-show on very close
calls, or offer a player challenge.

**Implementation pointers.** Reuse `04`'s replay recorder; the bounce point is exact in
the sim; optional `host_close_call(x, z, in)` or piggyback the bounce data.
**Effort / Impact.** Med–High / Med–High. **Risks.** Sequence *after* the replay buffer
exists (it depends on it).

## 6.7 Haptics (gamepad rumble + mobile vibration)

**Problem.** Contact has no physical feedback.

**Proposal.** Scale `navigator.vibrate` (mobile) and the Gamepad `vibrationActuator` /
`hapticActuators` (controller) by contact quality. **No new FFI** — hit quality already
crosses the boundary (`host_hit_quality(q)`, `host.js.mbt:234`; the `jammed` flag in
`host_sfx_hit`, `:17`).

**Implementation pointers.** Wire JS-side at the hit-quality / hit call sites in
`src/input.js` / `src/audio.js`. **Effort / Impact.** Low / Med (where supported).
**Risks.** `navigator.vibrate` is unsupported on iOS Safari — **degrade silently**, never
present it as universal. (Distinct from `kaizen/05.2`'s touch *press-confirmation* haptic,
which is input-feedback; this is contact-feel scaled by shot quality.)

## 6.8 End-of-match highlight reel

**Problem.** The match ends on a stats table; there's no payoff montage.

**Proposal.** Concatenate the top few recorded replay buffers (longest rallies / break /
set / match points, ranked by the `tension` value at capture) and play them on the results
screen. **Near-free once `04`'s recorder and §6.0's tension ranking exist.**

**Implementation pointers.** Results-screen host in `src/ui.js` (`host_show_results`,
`host.js.mbt:183`) driving `04`'s replay playback. **Effort / Impact.** Med (mostly
orchestration) / High. **Risks.** Depends on `04` + §6.0; cap the reel length.

---

## FFI contract summary (new, all output-only)

| Signal | Consumers | Notes |
|--------|-----------|-------|
| `host_point_situation(kind)` | overlays (6.2), tension music (03), camera (04) | emitted at serve setup |
| `host_tension(value)` | crowd gain (03), music (03), camera push (04), overlays (6.3) | 0..1, evolves during point |
| `host_point_highlight(...)` | replay trigger (04), highlight ranking (6.8), crowd react (03) | emitted at point end |
| `host_celebrate(side, kind)` | celebration motion (01) | trigger only; motion in `01` |
| `host_close_call(x,z,in)` *(optional)* | Hawk-Eye (6.6) | or piggyback bounce data |
| *(none — reuse `host_hit_quality`)* | haptics (6.7) | pure JS, no new FFI |

Every signal is a **pure function of deterministic match state**, computed in
`rules.mbt` / `game.js.mbt` and pushed logic → host only. They add derivable data, never
randomness — determinism is preserved. All presentation (DOM, haptics, replay) is
output-only and offline-safe; haptics degrade silently where unsupported.
