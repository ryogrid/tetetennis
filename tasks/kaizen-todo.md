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
- [ ] 7. Enhanced ball shadow — always-readable shadow in `ball.js`
- [ ] 8. Widen contact quality bands — assist-gated tolerances in `shots.js`
- [ ] 9. Incoming-height bar — rally height gauge in `ui.js`
- [ ] 10. Auto-swing assist — assistFull-gated auto contact timing
- [ ] 11. Positioning magnetism — assistFull-gated nudge toward sweet spot
- [ ] 12. Unified Assist Mode toggle — Off/On/Full menu screen, persisted
- [ ] 13. Touch-control ergonomics — bigger buttons, more forgiving D-pad
- [ ] 14. Soften mishit / velocity penalty — assist-gated in `shots.js`

## Review

(to be filled in as items complete)
