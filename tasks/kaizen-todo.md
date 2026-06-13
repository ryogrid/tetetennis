# Kaizen Implementation TODO

Implementing the `kaizen/` proposals in the priority-matrix order from
`kaizen/00-overview.md`. One item per commit; each is `npm test` + `npm run build`
green (plus `npm run physcheck` for physics/shot tuning) before commit + push.

Gating (confirmed: "tiered default-on"):
- Info-only aids → always on for everyone.
- Feel/balance aids (slow-mo, pace, forgiveness) → default ON (separate Assist axis).
- Control-model aids (auto-swing, magnetism) → default OFF.
- Task 12 adds the Assist Mode toggle (Off / On / Full) driving all of the above.

Camera position/angle stay untouched in every commit.

## Tasks (priority order)

- [x] 1. Approach slow-motion — `assist.js` (new) + `main.js` time-scale + `game.js getTimeScale`
- [x] 2. Swing timing meter — contact-time clock + `ui.js` timing gauge
- [x] 3. Court depth ladder — faint floor reference lines in `court.js`
- [x] 4. Recommended-shot highlight — `ui.js setRecommendedShot` + `game.js` heuristic
- [x] 5. Time-to-contact countdown — shrinking ring on sweet-spot marker in `ball.js`
- [x] 6. Difficulty-linked PACE — runtime `paceFactor` in `constants.js`, set from assist
- [x] 7. Enhanced ball shadow — always-readable shadow in `ball.js`
- [x] 8. Widen contact quality bands — assist-gated tolerances in `shots.js`
- [x] 9. Incoming-height bar — rally height gauge in `ui.js`
- [x] 10. Auto-swing assist — assistFull-gated auto contact timing
- [x] 11. Positioning magnetism — assistFull-gated nudge toward sweet spot
- [x] 12. Unified Assist Mode toggle — Off/On/Full menu screen, persisted
- [x] 13. Touch-control ergonomics — bigger buttons, more forgiving D-pad
- [x] 14. Soften mishit / velocity penalty — assist-gated in `shots.js`

## Review

All 14 items implemented in priority order, one commit each, every commit green
on `npm test` + `npm run build` (+ `npm run physcheck` for tuning items).

Architecture:
- `src/assist.js` is the single assist axis (`off`/`on`/`full`), persisted to
  localStorage, restored on load, and chosen on the new ASSIST (FOR YOU) menu
  screen (task 12). Every feature reads `assistOn()`/`assistFull()`.
- A shared contact-time clock (`game.timeToContact()`) drives the timing meter,
  countdown ring, height-bar window, and auto-swing timing from one prediction.

Gating outcome (as agreed — "tiered default-on"):
- Always on (info only): swing timing meter, court depth ladder, recommended-shot
  highlight, time-to-contact countdown, always-readable shadow, incoming-height bar.
- Default on (`on`): approach slow-motion, assist pace (0.85x), widened contact
  bands, softened mishit/velocity penalty — all human-only where balance-relevant.
- Default off (`full` only): auto-swing, positioning magnetism.

Notes:
- Camera untouched in every commit (`src/camera.js` and `main.js` camera setup
  unchanged).
- Contact-model easing is gated to `side === 'P'` so the CPU is never helped.
- `scripts/physics-check.mjs` pinned to assist-off to validate the canonical
  balance; browser e2e scripts updated to pass through the new assist screen.

Suggested manual verification: `npm run dev`, start a match, confirm the new HUD
elements render, slow-mo engages on incoming balls, and the Assist screen toggles
Off/On/Full (Full enabling auto-swing + magnetism).
