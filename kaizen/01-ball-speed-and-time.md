# Kaizen 01 — Ball Speed & Time

The most direct way to make a fixed-camera game easier is to give the player more
*time* on the ball. The game already does this globally via `PACE = 0.64`
(`src/physics/constants.js:75`), which scales every launch speed to ~80%. These
proposals make "time on the ball" **adjustable and context-sensitive** rather than
a single hard-coded constant — and add ways to buy time *without* permanently
slowing the whole game.

---

## 1.1 Difficulty-linked PACE

### Problem
`PACE` is a single global constant. It is the same in Easy and Hard, so the only
thing the difficulty selector changes is the *CPU brain* (`src/ai.js`), not how
fast the ball comes at the human. A beginner on Easy still faces full-pace shots.

### Proposal
Make the *effective* pace a function of the selected difficulty / assist level.
Easy slows incoming ball speed further; Hard can restore (or exceed) full pace.
Suggested multipliers relative to the current `0.64`:

| Level | Pace factor | Effective vs. today |
|-------|:-----------:|:-------------------:|
| Easy / Assist | `0.85×` (→ ~`0.54`) | slower, more reaction time |
| Normal | `1.00×` (→ `0.64`) | unchanged |
| Hard | `1.15×` (→ ~`0.74`) | faster, for advanced players |

### Implementation pointers
- `PACE` is consumed inside `STATS_MAP.maxFlatSpeed` / `serveFlatSpeed`
  (`src/physics/constants.js:79-82`) and the lob branch in
  `computeStroke` (`src/game/shots.js:96`).
- Because `STATS_MAP` closes over the module-level `PACE`, the cleanest change is
  to add a small runtime-settable pace multiplier (e.g. `setPaceFactor(f)`) that
  these mappings read, set from the difficulty/assist selection in
  `src/game.js` when a match starts.
- Difficulty is already chosen in the `menu_difficulty` flow (`src/game.js`,
  `src/ui.js`) — hook the pace factor in there.

### Effort / Impact
Low effort, medium impact. One indirection plus a setter call.

### Risks
- Slower balls make the CPU's own shots easier *for the CPU to chase too*; keep
  the change to the human-facing perception by tuning alongside `04` forgiveness,
  or apply pace asymmetrically (see 1.3).
- Don't stack this too aggressively with approach slow-motion (1.2) or the game
  can feel sluggish.

---

## 1.2 Approach slow-motion ("reaction time")

### Problem
Even at reduced pace, the hardest instant is the last ~0.3 s before contact, when
the player must simultaneously read depth, position, and press a shot key. A fixed
camera makes that window feel especially short.

### Proposal
Briefly **slow the simulation's wall-clock rate** while the ball is inside the
player's reach zone and closing — a localized "bullet time." Physics, trajectories,
and the camera are unchanged; only how fast real time advances the fixed-step loop
changes, so the player gets more real milliseconds to react. Ease back to 1.0× the
instant contact resolves or the ball leaves the zone. Toggleable, and ideally tied
to Assist Mode.

A gentle factor (e.g. 0.6×–0.75× time rate for the final approach) is enough to be
felt without looking gimmicky.

### Implementation pointers
- The fixed-step accumulator lives in the main loop (`src/main.js:42-60`) with
  `DT = 1/240` (`src/physics/constants.js:6`). Scale the *frame delta* fed into the
  accumulator by a `timeScale` factor; do **not** change `DT` itself (that would
  alter physics integration).
- Reuse the existing reach test that already runs every frame to color the reach
  zone (`src/game.js:640-645`) to decide when to engage/disengage slow-motion.
- Only engage on the human's incoming ball (when `lastHitBy === 'C'` / it's the
  human's turn to hit) so it never triggers on the player's own outgoing shot.

### Effort / Impact
Low–medium effort, high impact. This is the single biggest reaction-time relief and
is fully camera-safe.

### Risks
- Must ramp in/out smoothly (lerp the time scale) or it feels jarring.
- Audio pitch: the synthesized SFX (`src/audio.js`) are event-based, not
  time-stretched, so they're unaffected — good. Just verify the toss/serve flow
  isn't accidentally slowed.
- In two-human play (if ever added) slow-mo would affect both sides; keep it a
  single-player assist.

---

## 1.3 Incoming-ball speed cap (Easy)

### Problem
The difficulty comes less from *average* pace than from the occasional very fast
shot — a flat drive or a hard serve return that arrives before the player can read
it. Average-pace tuning (1.1) doesn't tame these spikes.

### Proposal
On Easy / Assist, clamp the **effective closing speed of balls hit toward the
human** to a readable ceiling, so the fastest shots are softened while normal
rallies are untouched. This is a targeted version of 1.1 that only bites on the
hardest balls.

### Implementation pointers
- Stroke speed is produced in `computeStroke` (`src/game/shots.js:84-98`). The
  simplest hook is to clamp the launch `speed` when the striker is the CPU
  (`side === 'C'`) under Easy/Assist, e.g. `speed = min(speed, cap)`.
- Alternatively clamp at the point the ball is stamped into flight in
  `src/game.js` (`attemptContact` / serve execution), where the striker identity
  is known.

### Effort / Impact
Low effort, medium impact. Smooths the difficulty spikes that cause most whiffs.

### Risks
- A hard cap can make the CPU feel toothless; prefer a soft clamp (compress the top
  end) over a flat ceiling.
- Keep it Easy/Assist-only so Normal/Hard pace variety is preserved.
