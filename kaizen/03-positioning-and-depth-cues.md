# Kaizen 03 — Positioning & Depth Cues

A fixed camera's core weakness is **depth perception**: it is hard to tell how far
away the ball is, where it will land, and *when* it will get there. The game's only
current depth cues are a shadow blob that fades as the ball rises and ball-size
scaling (`src/entities/ball.js`). These proposals add explicit, camera-safe depth
and positioning displays so the player isn't guessing.

---

## 3.1 Time-to-contact countdown

### Problem
The landing ring and sweet-spot ring show *where* to be, but not *when* the ball
arrives. Depth-over-time is exactly what a fixed camera fails to convey.

### Proposal
Add a **countdown** to the landing / sweet-spot marker: either a small numeric
"0.8 → 0.4 → 0.1 s" readout or, better, a **sweeping ring that closes as contact
nears** (a clock-wipe or shrinking arc on the existing marker). The player reads
both *where* and *when* from one in-world element.

### Implementation pointers
- Markers live in `src/entities/ball.js`: landing ring (`showLanding`, lines
  ~101-108) and sweet-spot ring (lines ~131-144). Add the countdown as an extra
  ring/arc on the sweet-spot marker.
- Time-to-contact derives from `predictHitPoint()` (`src/physics/ball.js`), already
  used to place the sweet-spot marker.
- Pairs naturally with the contact-quality reticle (`02.2`) — they can be the same
  ring serving double duty (depth-time + swing-time).

### Effort / Impact
Medium effort, high impact. Directly attacks the fixed-camera depth problem.

### Risks
- A numeric readout can feel un-game-like; prefer the visual sweep.
- Avoid clutter if combined with 02's reticle — unify into one ring if both ship.

---

## 3.2 Court depth ladder / distance lines

### Problem
With no parallax (fixed camera) and a mostly flat court, the eye has few references
to gauge distance down-court.

### Proposal
Render **faint floor reference lines** across the court at regular depth intervals
(e.g. service line, mid-court, baseline ticks) — a subtle "depth ladder." Static
perspective references like these dramatically improve distance reading at almost
no runtime cost, and they fit a tennis court visually (they look like court
markings).

### Implementation pointers
- Court geometry and existing line markings are built in `src/court.js`. Add the
  extra reference lines there as thin, low-opacity meshes so they read as court
  detail, not UI.
- Keep them on the player's half (where depth judgment matters for receiving), or
  full-court if they read as natural tennis lines.

### Effort / Impact
Low effort, high impact. Cheap, static, and camera-safe — strong candidate for the
first wave.

### Risks
- Too many lines look noisy; keep them faint and few.
- Make sure they don't visually clash with the actual court lines or the
  reach-zone circle.

---

## 3.3 Enhanced ball shadow

### Problem
The shadow blob currently *fades out as the ball rises*
(`opacity = 0.48 * (1 - h*0.6)`, `src/entities/ball.js:93-99,167-171`), so high
balls — the ones hardest to read — have the *weakest* depth cue. That's backwards
for readability.

### Proposal
Make the shadow **always readable** and use it as a deliberate depth instrument:
keep it visible at height and **color/scale-code it by time-to-arrival** rather
than fading it. For example, the shadow tightens and brightens as the ball nears
the ground, giving a strong "it's landing *here*, *now*" cue.

### Implementation pointers
- Shadow opacity/scale math is in `src/entities/ball.js` (creation ~lines 93-99,
  per-frame update ~lines 167-171). Replace the height-fade with a floor-clamped
  opacity and a time-to-arrival-driven scale/tint.
- Keep the shadow projected straight down (as today) so its X/Z is the true
  ground position — that's the depth anchor.

### Effort / Impact
Low effort, medium impact. Turns an existing cue from counter-productive into
helpful.

### Risks
- A fully opaque shadow at height can look detached from the ball; tune so it still
  reads as a shadow.
- Don't double-encode the same info as the landing ring to the point of clutter.

---

## 3.4 Incoming-height bar

### Problem
The serve has a toss gauge showing ball height vs. the ideal contact band, but the
rally has no equivalent — so the player can't tell whether the incoming ball will
arrive at a comfortable waist height or an awkward high/low one until it's too late.

### Proposal
Add a rally **incoming-height bar**: a compact gauge showing the ball's predicted
height at the contact point versus the ideal waist band, so the player can decide
to move in/back to meet it at a good height. Essentially the toss gauge,
generalized to the rally.

### Implementation pointers
- Model on `updateTossGauge` (`src/ui.js`) — same green "good" band concept, fed by
  the predicted contact height from `predictHitPoint()` (`src/physics/ball.js`).
- The ideal band should match the waist-height window rewarded in
  `contactQuality()` (`src/game/shots.js:50-51`, `IDEAL_CONTACT_H`).
- Only show while receiving; hide on the player's own shot.

### Effort / Impact
Medium effort, medium impact. Most valuable once 3.1/3.2 have solved horizontal
depth — this closes the *vertical* read.

### Risks
- Another gauge on a busy HUD; consider merging into the timing meter (`02.1`) as a
  combined "where/when/how-high" cluster, or gating behind "more help."

---

## 3.5 Positioning magnetism (toggleable)

### Problem
Contact quality `q` punishes being even ~0.5 m off the ideal spot
(`contactQuality()`, `src/game/shots.js:45-49`). New players are constantly *almost*
in position, producing weak, confusing shots.

### Proposal
When the player is **nearly aligned** with the computed sweet-spot, apply a small
auto-step ("magnetism") that nudges them onto the spot at contact. It rewards
getting close without demanding pixel-perfect positioning. Opt-in via Assist Mode.

### Implementation pointers
- The sweet-spot target is already computed each frame with a body-offset
  (`src/game.js:586-590`: `x = hp.pos.x - 0.55`, `z = hp.pos.z + 0.15`).
- Apply a capped corrective velocity toward that target inside the player movement
  update (player movement integrates `runSpeed`/`runAccel`,
  `src/physics/constants.js:83-84`; movement applied in `src/entities/player.js` /
  `src/game.js`). Cap the assist so it only closes a small final gap and never
  overrides deliberate movement away from the ball.

### Effort / Impact
Medium–high effort, medium–high impact. Powerful but the most intrusive of this
set.

### Risks
- Overdone, it feels like loss of control or "the game grabs me." Keep the
  magnetism radius and force small.
- Interacts with auto-swing (`02.3`); together they approach "auto-rally," which is
  fine *only* as an explicit beginner Assist Mode, not a default.
