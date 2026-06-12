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

## FPV + realism update (3rd task)

Plan: /home/ryo/.claude/plans/3d-1-mighty-ember.md

- [x] camera.js: first-person view from the player's eyes (serve = fixed
      forward, rally = clamped ball tracking); main.js FOV 55→70; hide own rig
- [x] ui.js + game.js: toss-height gauge during the human serve
- [x] physics tuning: surface ey/mu, stroke/serve quality scaling, shot-type
      contrast; extended physics-check assertions
- [x] ball.js: VISUAL_R 0.075 → 0.05
- [x] sweet-spot "stand here" marker via predictHitPoint
- [x] serve aim: continuous lateral + depth from D-pad at the hit instant
- [x] Verify: vitest, physcheck, rally-check, fpv-check, e2e, touch, build
- [x] README.md update

### Review

- FPV implemented as planned; one addition beyond the plan: a screen-space
  **move hint arrow** (`#movehint`, driven from frameUpdate via g.sweetPos).
  Screenshots showed the floor sweet-spot decal often sits BEHIND the FPV
  camera (deep balls are met behind the baseline), so a court decal alone is
  invisible exactly when needed.
- fpv-check lesson: serve-direction A/B must be compared within the same
  court side — courtSide alternates per point exactly like a naive left/right
  alternation, so world-frame vel.x means cancel out. The check now picks the
  missing direction for whichever side comes up.
- Physics targets landed: flat-drive retention grass 0.80 / hard 0.67 /
  clay 0.63, bounce apex clay 0.98 > hard 0.86 > grass 0.59; stretched
  contact (q=0.45) is 16% slower and ~0.7 m shorter than clean (q=0.91).

## Smarter CPU + difficulty levels (4th task)

Plan: /home/ryo/.claude/plans/3d-1-mighty-ember.md

- [x] physics/ball.js: sampleHitPoints (candidate contacts between bounces)
- [x] ai.js: reachability-aware interception, periodic re-prediction with
      shrinking error, whiff retry, reaction delay, DIFFICULTIES table
- [x] entities/player.js: optional speedMul; game.js passes it for the CPU
- [x] ui.js + game.js: difficulty select screen (easy/normal/hard)
- [x] scripts/ai-check.mjs: headless CPU return-rate harness
- [x] update e2e/touch/fpv scripts for the extra menu step
- [x] Verify: vitest, physcheck, rally, ai-check, e2e, touch, fpv, build
- [x] README.md update

### Review

- The decisive "棒立ち" bug found by the new harness: any trajectory re-read
  AFTER the ball's first bounce made `predictLanding` return the (always
  out-of-court) SECOND bounce, so `landingOut` flipped true and the CPU
  "let it go". Fixed by passing `bounced: g.rally.bounces > 0` through ctx;
  out-ball judgment now only applies pre-bounce, and `sampleHitPoints` starts
  sampling immediately when already bounced. Contact rates went 33–42% →
  93–100% (mixed balls).
- ai-check results: mixed contact easy/normal/hard = 93/99/100%;
  corner-pressing returnIn = 62/98/97% — easy is beatable, hard is relentless.
  Hard's returnIn can sit ~1-3 pts under normal under pressure because its
  lower choiceNoise picks riskier corner targets — intended personality, so
  the ordering assertion uses contact rate.
- In-browser: CPU on hard returned 6/6 human serves (was: mostly aces).

## Shot contrast + strafe camera + movement physics (5th task)

Plan: /home/ryo/.claude/plans/3d-1-mighty-ember.md

- [x] shots.js/constants.js: distinct flat/topspin/slice regimes
      (speed, spin, theta band, depth) + physics-check contrast assertions
- [x] ball.js PREDICT_DT 1/240→1/120, shotSolver bisection 14→11
- [x] camera.js: eye-relative look targets (no yaw while strafing)
- [x] player.js: constant-force accel/brake movement; runAccel retune
- [x] ai.js: kinematic arrival estimate; ai-check movement mirror
- [x] e2e-check: velocity ramp + diagonal movement assertions
- [x] Verify all suites + build; README update

### Review

- Final type regimes (POW≈72, q=1, hard court): flat 21.2 m/s arrival /
  1.55 m arc / 0.68 m bounce; topspin 17.7 / 2.21 / 1.16 (kick); slice
  15.3 / low / 0.64 and only 10.8 m/s through the bounce. Slice needed two
  iterations: speedMul 0.55 + theta≤18 made it a moonball that bounced as
  high as topspin — flatter band (1–10°) + 0.62 speed + 9.0 m depth fixed it.
- Strafe verified by camera-quaternion probe: yaw drift while moving 2 m
  sideways is ~0.001 (pre-serve) / ~0.01 (rally, from the small ball-offset),
  vs ~0.08 before. Look targets are all eye-relative now.
- Movement: constant-force accel (9–15 m/s²) with 1.8x braking; e2e asserts
  the ramp (1.4 → 7.3 m/s over 0.5 s) and diagonal up+left motion. The AI
  arrival estimate switched to rest-to-distance kinematics so the CPU plans
  around its own acceleration; ai-check mirrors the new integrator.
- Easy difficulty under corner pressure dropped to ~30% returns (slower
  accel hurts the weakest setting most) — accepted: pressing corners SHOULD
  beat easy; its mixed-ball rate stays 87%.

## Bounce deceleration verification (6th task)

User asked to add mu-driven horizontal deceleration at the bounce if missing.
**Already modeled** in src/physics/bounce.js (Coulomb friction impulse:
slide dv_h = mu*Jn, grip dv_h = (2/5)*slip). Work done:

- [x] physics-check: new block asserts horizontal speed drops for every
      shot x surface (9 combos) and the loss orders clay > hard > grass
      (flat drive: -7.6 / -5.5 / -3.5 m/s)
- [x] bounce.js doc comment + README physics note (no behavior change)
- [x] All suites re-run green; build clean

## Trajectory trail (7th task)

- [x] physics/ball.js: predictTrajectory (sampled path + bounceT)
- [x] entities/ball.js: InstancedMesh dot trail (yellow pre-bounce /
      cyan post-bounce, capacity 64), exposed as trailMarker
- [x] game.js: shown per ballStamp with the sweet-spot lifecycle, window
      bounceT-0.45s -> 2nd bounce, human side only
- [x] Checks: physics-check sampling sanity, fpv-check trail assertion +
      24-fpv-trail.png (34 dots, reads well in FPV), all suites green
- [x] touch-check D-pad hold 400->700 ms (flaky once: accel ramp made the
      0.2 m threshold marginal)
- [x] README "Reading the screen" updated
