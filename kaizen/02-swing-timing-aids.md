# Kaizen 02 — Swing Timing Aids

Today, rally contact auto-fires at a fixed 18% of the swing animation
(`SWING_CONTACT_T = 0.18`, `src/entities/player.js:8`) and there is **no in-rally
timing feedback at all**. The player gets a sweet-spot *position* marker but no
sweet-spot *moment*. The serve, by contrast, has an excellent toss gauge
(`updateTossGauge` in `src/ui.js`) that teaches timing. These proposals bring that
same teachable timing signal to the rally.

---

## 2.1 Swing timing meter

### Problem
The player has no way to learn *when* to press a shot key during a rally. Timing is
invisible: you press, and either the ball was in range (hit) or it wasn't (whiff),
with no "you were early/late" signal in between.

### Proposal
Add a rally-time **timing meter** that fills toward a peak as the ball reaches the
ideal contact instant, mirroring the serve toss gauge. A bright "now!" band marks
the moment when contact quality `q` is highest; pressing a shot key inside the band
yields the best shot. Over a few points the player internalizes the rhythm.

Visual: reuse the toss-gauge styling (vertical or horizontal bar, green "good"
band, moving dot). Show it only while the human is the receiver and the ball is
approaching.

### Implementation pointers
- The ideal contact instant is already computed: `predictHitPoint()` in
  `src/physics/ball.js` finds the first descending point at/just above waist
  height (~0.85 m) after the bounce. The time-to-that-point drives the meter.
- Model the gauge on the existing `updateTossGauge` and `updateMoveHint` HUD
  updaters in `src/ui.js` (lines ~380-476) — add an `updateTimingMeter(t, good)`
  alongside them.
- Drive it each frame from `src/game.js` (same place the sweet-spot ring and move
  hint are updated, around the predicted-hit-point logic near `game.js:586-590`).
- The "good" band should align with the same waist-height window that
  `contactQuality()` rewards (`src/game/shots.js:50-51`).

### Effort / Impact
Medium effort, high impact. Converts the game's biggest invisible mechanic into a
learnable one, and reuses an existing, proven gauge pattern.

### Risks
- Don't overload the screen — it already has a move-hint arrow and reach circle.
  Consider showing the timing meter only when the ball is within ~0.6 s of contact.
- Keep it informational; it should *teach* timing, not auto-correct it (that's 2.3).

---

## 2.2 Contact-quality reticle (in-world timing)

### Problem
A side gauge (2.1) pulls the eye away from the ball. For a fixed-camera game, an
in-world cue that lives *at the contact point* keeps the player's focus where the
action is.

### Proposal
Add a **shrinking reticle** ring around the sweet-spot marker that contracts toward
its center as the ideal-contact instant approaches and is tightest exactly at peak
`q`. The player presses when the shrinking ring snaps to the inner circle — a
classic, intuitive "ring timing" cue read entirely in the play space.

### Implementation pointers
- The sweet-spot marker (cyan ring + dot) already exists and pulses:
  `src/entities/ball.js:131-144`. Add a second concentric ring whose radius is a
  function of time-to-ideal-contact rather than a sine pulse.
- Time-to-contact comes from the same `predictHitPoint()` source as 2.1.
- Color the inner ring green at the optimal instant (reuse the green used by the
  reach-zone-hit and toss "good" states).

### Effort / Impact
Medium effort, medium–high impact. Can ship instead of, or alongside, 2.1.

### Risks
- Reticle and timing meter together may be redundant; pick one as primary based on
  playtest, or gate the second behind a "more help" setting.
- Must stay legible at the marker's on-ground perspective scale.

---

## 2.3 Auto-swing / charge assist (toggleable)

### Problem
Some players (very new, or on touch) will never master timing and just want to
rally. For them, manual timing is a wall, not a skill curve.

### Proposal
An assist where the player **holds** a shot key (or taps once and the system waits)
and contact fires **automatically at the best-quality instant** while the ball is
in reach. The player still chooses *shot type* (flat/topspin/slice) and *aim*
(movement direction at contact); only the precise timing is automated. Strictly an
opt-in Assist Mode feature.

### Implementation pointers
- The contact gate currently fires at a fixed point in the swing:
  `src/entities/player.js:222` (contact when swing time ≥ `SWING_CONTACT_T`), with
  the shot resolved in `attemptContact` (`src/game.js:251-280`).
- For auto-swing, when a shot key is held and the ball enters reach
  (`game.js:640-645`), trigger the swing so that its contact frame coincides with
  peak `q` (use `predictHitPoint()` to schedule the swing start).
- Keep aim sampling identical to today (movement vector at contact, `aimVec()` in
  `src/input.js`) so the player retains directional control.

### Effort / Impact
Medium–high effort, high impact for the target audience.

### Risks
- This meaningfully changes the skill model — must be off by default and clearly
  labeled, behind Assist Mode (`05`).
- Edge cases: ball barely reachable, double-press, ball leaving the zone — define
  clear fallbacks (e.g. fire at zone-exit with whatever `q` is available, or whiff
  as today).
- Risk of feeling "the game plays itself"; tune so positioning still matters
  (off-position still yields low `q`).
