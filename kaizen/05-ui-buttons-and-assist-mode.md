# Kaizen 05 — UI, Buttons & Assist Mode

This file covers control-surface improvements (shot buttons, touch controls) and
the **organizing toggle** that ties the human-side aids from `01`–`04` together
without forcing them on advanced players.

---

## 5.1 Recommended-shot highlight

### Problem
New players face a choice every ball — flat (Z), topspin (X), or slice (C) — with no
guidance, on top of timing and positioning. That's three simultaneous decisions.

### Proposal
When the ball is in reach, **highlight the recommended shot button** (in the
keyboard shot bar and the touch shot buttons) — e.g. light up "Topspin" when a
safe topspin is the high-percentage play. The player can follow the hint or ignore
it; it offloads shot *selection* so they can focus on timing and movement.

A simple heuristic is enough: pick based on contact height/quality and court
position (low/stretched → slice or lob; comfortable → topspin; short ball → flat).

### Implementation pointers
- The shot bar (Z/X/C with flash animation) and touch shot buttons are built and
  flashed in `src/ui.js` (shot bar updates and `buildTouchControls`). Add a
  `setRecommendedShot(type)` that applies a distinct "suggested" highlight (separate
  from the existing yellow press/flash state).
- The recommendation can reuse signals already computed each frame: predicted
  contact height/quality (`predictHitPoint()`, `contactQuality()`), `stretched`
  flag (`src/game/shots.js:55`), and the lob auto-substitution rule
  (`shots.js:67`).
- Drive it from `src/game.js` where the sweet-spot/move-hint are already updated
  per frame.

### Effort / Impact
Low effort, medium–high impact. Removes one of the three decision axes for newcomers.

### Risks
- Keep the "suggested" style visually distinct from "pressed" so it doesn't look
  like a phantom input.
- Make sure a wrong-but-deliberate shot is never blocked — this is advice, not a
  rail.

---

## 5.2 Touch-control ergonomics

### Problem
Touch is the hardest input here: the D-pad needs `|n| > 0.42` to register a
direction, and the shot/serve buttons are small and arc-packed
(`buildTouchControls`, `src/ui.js`). Mis-taps and missed directions add difficulty
that has nothing to do with tennis.

### Proposal
- **Larger, better-spaced** shot and serve buttons with bigger tap targets.
- **More forgiving D-pad**: lower the direction threshold (`0.42` → ~`0.30`) and/or
  add a small dead zone + hysteresis so diagonals are stable.
- Optional **haptic/visual press confirmation** so the player trusts the input
  landed.

### Implementation pointers
- Touch UI and the `0.42` sensitivity live in `buildTouchControls` (`src/ui.js`,
  ~lines 189-293). Adjust thresholds and button geometry there.
- Buttons synthesize the same key codes as the keyboard (`src/input.js` virtual
  keys), so no game-logic change is needed — purely a control-surface tune.

### Effort / Impact
Low–medium effort, medium impact (high specifically for touch/mobile players).

### Risks
- Bigger buttons can crowd the small screen; balance against view occlusion.
- Lowering the D-pad threshold too far makes neutral hard to hold; tune with a dead
  zone.

---

## 5.3 Single "Auto" shot button

### Problem
Even three shot buttons is a lot on touch, and shot choice is the least intuitive
part for beginners.

### Proposal
Offer a single **"Auto" shot button** that swings with an automatically chosen shot
type (using the same heuristic as the recommended-shot highlight, `5.1`). One
button to "just hit it back." Pairs well with auto-swing (`02.3`) for a true
beginner mode.

### Implementation pointers
- Add a virtual key in `src/input.js` and a button in `buildTouchControls`
  (`src/ui.js`) that resolves to a chosen shot type at contact, routed through the
  existing `attemptContact` path (`src/game.js:251-280`).
- Reuse the `5.1` recommendation heuristic so "Auto" and the highlight agree.

### Effort / Impact
Medium effort, medium impact. Most valuable as part of the Assist bundle.

### Risks
- Removes shot-type expression; keep the three explicit buttons available too
  (Auto is additive, not a replacement).

---

## 5.4 Unified "Assist Mode" toggle

### Problem
Today's `Easy/Normal/Hard` only weakens the **CPU** (`src/ai.js`): `posErr`,
`react`, `speedMul`, `serveQ`, `choiceNoise`. There is **no axis that makes the
human's own controls easier** — yet most of the ideas in `01`–`04` are exactly
that. Without a home, they'd either be always-on (bad for advanced players) or
scattered.

### Proposal
Add a separate **Assist Mode** setting (Off / On, or Light / Full) that bundles the
human-side aids and is **independent of CPU difficulty**, so a player can face a
Normal CPU while still getting reaction help. Assist Mode gates, at minimum:

- Approach slow-motion (`01.2`) and/or lower effective pace (`01.1`)
- Swing timing meter / reticle (`02.1`, `02.2`)
- Auto-swing (`02.3`) — Full only
- Time-to-contact countdown, depth ladder always-on; height bar (`03.1`, `03.2`,
  `03.4`)
- Positioning magnetism (`03.5`) — Full only
- Contact forgiveness (`04.1`–`04.3`)
- Recommended-shot highlight & Auto button (`5.1`, `5.3`)

Decoupling player-side and CPU-side difficulty is the key structural improvement —
it lets the game scale assistance to the *player's* needs, not just the opponent's
strength.

### Implementation pointers
- Difficulty is chosen in the `menu_difficulty` state of the game flow
  (`src/game.js`) with the menu rendered in `src/ui.js`. Add an Assist selection to
  that screen (or a new screen) and store it on the game/match state alongside the
  existing difficulty.
- Expose the flag where the gated features read it: pace/reach setters
  (`src/physics/constants.js` per `01.1`/`04.3`), the slow-mo decision in
  `src/main.js`/`src/game.js` (`01.2`), the HUD updaters in `src/ui.js` (`02`/`03`),
  the contact model in `src/game/shots.js` (`04`), and the contact/movement path in
  `src/game.js` for auto-swing/magnetism (`02.3`/`03.5`).
- Keep CPU difficulty (`src/ai.js`) entirely separate — do not couple the two.

### Effort / Impact
Medium effort, medium impact directly — but **high as an enabler**: it's the clean
home that lets every other player-side aid ship without changing the default
experience.

### Risks
- Two difficulty axes can confuse the menu; label clearly ("Opponent strength" vs
  "Assist for you").
- Decide defaults deliberately — e.g. Assist On for first-time players, Off once
  they've won a match — and make the toggle easy to find/change mid-session.
