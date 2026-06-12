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

## Realism pass (8th task)

Plan: /home/ryo/.claude/plans/3d-1-mighty-ember.md

- [x] 1. Speed-dependent bounce restitution (ITF-anchored ey, eyEff falls
      with impact speed) + physics-check drop-test/COR assertions + retune
- [x] 4. Stroke shape contrast (topspin dips / slice floats): spin maps up,
      clMax 0.40, slice speed 0.68; shape-metric assertions
- [x] 5. Serves: handedness-fixed side spin (slice curves to receiver's
      right), kick dips after net; AI 1st=flat/sometimes slice, 2nd=kick
- [x] 3. Waist-height sweet spot (radial arm+racket band), marker/AI stand
      offset, trail ideal-point highlight
- [x] 2. CPU motion readability: thicker rig, undamped stride + arm swing,
      amplified swing/serve keyframes, ready stance, serveAnim cancel fix
- [x] Verify: physcheck, vitest, rally, ai-check, fpv (+joint probes), e2e,
      touch, build; README + review notes

### Review

- **Bounce height**: ey was constant per surface; real balls lose
  proportionally more energy on faster impacts. Now
  `eyEff = ey * clamp(1 - 0.012*(|vyIn| - 7.1), 0.65, 1)` with ITF-anchored
  surface values (clay .81 / hard .75 / grass .66). ITF drop test asserted
  (2.54 m -> 1.33 m on hard); fast flat drives bounce ~15-20% lower than
  before (hard flat-drive apex 0.86 -> 0.80, clay topspin 1.44 -> 1.37).
- **Trajectory shapes**: spin maps raised (topspin 2200+2600, slice
  1500+1800 rpm), clMax 0.40, slice speedMul 0.62 -> 0.68. New physics-check
  block proves the Magnus effect directly: the same launch without spin
  lands 7.1 m deeper than the topspin ball, and 4.8 m shorter than the
  slice (backspin "stretches" the flight). Topspin descends 22deg vs flat
  14deg.
- **Serve types**: the side-spin sign was per-box, so the slice curve
  FLIPPED direction between deuce/ad. Now handedness-fixed (spin.y > 0):
  curves to the receiver's right from both ends (latDev +0.83 m, asserted
  both for CPU and human serves). Kick: 3200+1600 rpm, theta 2-14deg,
  speedMul 0.64 -> clears the net 1.14 m vs flat 0.33 m and dives 23 vs
  13 deg. AI: 1st = flat (slice 15-35% by style), 2nd = always kick.
- **Sweet spot**: ideal contact = waist height (0.85 m) at an arm+racket
  radial band (0.3-0.9 m, side-agnostic); cramped contacts near the body
  penalized, vertical cap from body+arm+racket. The stand-here marker and
  the AI's stand position now offset to the forehand side so contact lands
  in the band. Trail gets a 2.2x orange dot at the post-bounce waist-height
  point (asserted in fpv-check via instance colors).
- **CPU motion**: animations existed but were illegible (~30 px rig, 1 px
  limbs, 80 ms pose low-pass halving the 3 Hz stride). Fixed by thickening
  limbs (~1.4x), an athletic ready stance, amplified swing/serve keyframes
  (lunge, knee load, deeper trophy), and applying the stride additively
  AFTER the smoothing (filter state moved to a side table `_sm`).
  fpv-check now asserts stride >0.35 rad and swing turn >0.8 rad on the
  live rig. Bug found during the rewrite: smoothed-height init read its own
  undefined value -> NaN hips (rig invisible); also a lingering serve
  follow-through could block startSwing for up to 1.4 s — now cancelled.
- All suites green: vitest 8/8, physcheck, rally, ai-check, fpv, e2e,
  touch, build. AI contact rates unchanged on normal/hard (99/100 mixed);
  easy dropped to 84% mixed / 28% pressing (lateral stand offset costs the
  slowest setting most) — accepted, easy should be beatable.

## PWA (9th task)

Make the app an installable, offline-capable Progressive Web App.

- [x] public/manifest.webmanifest: name/short_name, fullscreen + landscape,
      theme/background #0d0d14, relative start_url/scope "." (base-agnostic),
      192/512 + maskable-512 icons
- [x] public/sw.js: zero-dependency runtime caching — network-first for
      navigations (app shell), cache-first for hashed assets/icons; versioned
      cache cleaned on activate; skipWaiting + clients.claim
- [x] scripts/gen-icons.mjs (npm run icons): draws the tennis-ball mark on a
      canvas and writes the PNGs — keeps the repo asset-free in spirit
- [x] src/pwa.js: registers the SW at `${BASE_URL}sw.js` (works at "/" and
      "/tetetennis/"); PROD-gated so it never interferes with dev HMR
- [x] index.html: manifest link, theme-color, apple-touch-icon + iOS
      standalone metas, viewport-fit=cover (all relative hrefs)
- [x] scripts/pwa-check.mjs: manifest/SW/offline-reload smoke against the
      production build at the GitHub Pages base path
- [x] README: Install (PWA) section + dev commands

### Review

- **Approach**: hand-rolled (no vite-plugin-pwa) to match the project's
  zero-runtime-dep, asset-free style and avoid churning the lockfile that
  CI's `npm ci` depends on. Workbox would have pulled ~dozens of transitive
  deps for what a 40-line runtime-caching worker does here.
- **Base path was the crux**: the site deploys under `/tetetennis/` (base
  injected at build time). Solved with manifest-relative URLs (`start_url`,
  `scope`, icon `src` all `"."`/relative) and `import.meta.env.BASE_URL`
  for SW registration, so the identical code works at the dev root and the
  Pages subpath. Verified both builds.
- **Hashed assets**: runtime caching (not a precache manifest) means new
  deploys' content-hashed filenames are fetched fresh and cached on the
  next online visit — no stale-asset trap, no build-time manifest to keep
  in sync.
- pwa-check (10 assertions) confirms manifest parses + resolves under the
  base, all icons 200, the SW reaches "activated" with the base scope, and
  a **fully-offline reload still renders the game** (app + canvas). e2e and
  touch still report zero page errors with the SW registration added.
- CI needs no change: icons are committed and `public/` is copied by the
  build; the PWA ships in the existing deploy artifact.
