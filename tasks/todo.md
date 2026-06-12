# 3D Tennis Game — Todo

Plan: /home/ryo/.claude/plans/3d-1-mighty-ember.md

- [x] M0 Scaffold: package.json, index.html, main.js loop, lit scene
- [x] M1 Court + ball physics (flight/bounce/net) + shadow blob + landing ring + chase camera
- [x] M2 Human player: rig, movement, swing/contact quality/aim, shot solver, hit+bounce SFX
- [x] M3 CPU AI: interception + utility shot picker
- [x] M4 Rules: match.js scoring + vitest, serve/faults/lets, point state machine, HUD
- [x] M5 Menus: char select (player & opponent), surface select, 5 characters wired in
- [x] M6 Polish: crowd/call SFX, serve speed toast, stands/fog, results screen, tuning
- [x] Verify: npm test, npm run build, headless physics sanity script, browser e2e

## Review

Implemented per plan with these notable deviations/findings:

1. **Spin-serve lateral drift** (found by `scripts/rally-check.mjs`): the 2D
   shot solver cannot see vertical-axis (side) spin, so kick/slice serves
   drifted out of the box (2nd-serve in-rate 57–73%). Fixed with a one-pass
   correction in `src/game/serve.js`: simulate the 3D landing once, shift the
   aim by the observed drift, re-solve. In-rates rose to 80–96%.
2. **Grass restitution** tuned 0.70 → 0.66 so slices stay below 0.7 m apex
   (plan's "felt difference" goal).
3. **Error model** strengthened (σx 0.25→0.30, σz 0.45→0.55, mishit threshold
   q<0.3) after rally-check showed stretched shots were 95% in.
4. **Camera** needed two iterations (verified via Playwright screenshots) so
   the near player is fully framed; final: rally cam y=6.8 z=+7.5 looking at
   (ball.x·0.3, 0.2, 3.0), serve cam y=3.2 z=+4.2.
5. Test infra beyond plan: `scripts/rally-check.mjs` (gameplay in-rates) and
   `scripts/e2e-check.mjs` + helpers (Playwright browser smoke: menus → match
   → points scored → scoreboard → Esc; match-end → results screen).

Verification status: vitest 8/8 pass, physics checks all pass, rally checks
all pass, e2e smoke passes with zero page errors, `vite build` clean.

## Touch controls (2nd task)

- [x] input.js: setVirtualKey + pointerdown counts as first input (audio)
- [x] ui.js: touch overlay (8-way slideable D-pad left, FLAT/TOP/SLICE arc +
      SERVE right, toggle + quit top-right), localStorage persistence,
      default ON for coarse pointers, menu tap delegation
- [x] game.js: menu confirm logic extracted, shared by keyboard and tap
- [x] index.html: viewport/touch hardening (no zoom, no callout)
- [x] README.md: touch controls section
- [x] Verify: scripts/touch-check.mjs (12 checks, mobile emulation) +
      keyboard e2e regression + vitest + build all pass

Lesson applied: synthetic pointer events lack active pointers, so
setPointerCapture must be try/catch-wrapped (also more robust on quirky
browsers).
