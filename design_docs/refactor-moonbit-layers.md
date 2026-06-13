# Design Doc: Split tetetetennis into a MoonBit game-logic layer + a JS render/sound layer

Status: Reviewed (agent review incorporated — see §0)
Author: refactor working session
Scope: Large architectural refactor. No gameplay/balance changes intended.

## 0. Agent review outcomes (incorporated)

An adversarial agent review compiled the doc's FFI/export/RNG/math snippets against
`moon 0.1.20260608`. Verified-OK: the `extern "js"` one-liner + multi-line `#|`
syntax, the dynamic `h.audio[name]()` dispatch, `#external pub type Host`,
`format:"esm"` + `"fn:alias"` exports, `Array[Double]`/primitive marshaling, the
mulberry32 RNG lowering, and — importantly — **no FFI lifetime annotations are
required** for `extern "js"` in this version. Corrections folded into this doc:

- **B1 — `init` is reserved.** MoonBit auto-invokes `fn init` (no args/return), so the
  export entry is renamed `game_init` and aliased: `"game_init:init"` (§5.3).
- **B2 — a package with `extern "js"` cannot build on the native/wasm backend.** So
  `logic/ffi` (host externs) and `logic/game` (calls them) are **JS-target-only**;
  the pure packages (`vec/physics/rng/rules/shots/ai`) carry no externs and are tested
  on native **and** JS. `moon test` (native) covers the pure packages; `moon test
  --target js` covers everything (§3.3, §8.2, §9).
- **B3 — artifact path.** Default target dir is `_build` and the path includes the full
  package path: `_build/js/release/build/logic/game/game.js` (§8.1).
- **S1 — float parity.** Bit-exact vs the old JS only on `--target js` (JS backend binds
  `Math.*`); native uses software libm and differs in ULPs. Parity comparison vs `old/`
  runs on `--target js`; native tests use inequality bands (§9, §12).
- **S2 — `Math.hypot`.** Reproduce the 3-arg call as nested `@math.hypot(@math.hypot(a,
  b), c)` (matches JS `Math.hypot` semantics) — used consistently on parity paths (§6).
- **S3 — missing UI calls** added to Appendix A (surface/difficulty/assist menus carry
  card payloads; move-hint; concurrent name-keyed gauges).
- **S4 — aim** is read mid-`fixed_update`; the move axis is level-state (survives
  `endFrame`), so MoonBit computes aim from `host_move_x/move_z` at the contact instant
  (§4).
- **S5 — menu/character data** duplication resolved with MoonBit as source of truth +
  an index/order parity check (§5.5).

## 1. Motivation

The game is currently a single JavaScript codebase where simulation, rules, AI, and
the state machine are interleaved with Three.js rendering, Web Audio, and DOM UI —
most visibly in the 861-line `src/game.js` orchestrator. This couples pure logic to
the browser, makes the logic hard to test in isolation, and prevents reuse.

We split the program into two layers with a hard boundary:

- **Game-logic layer (upper), implemented in MoonBit**, compiled to JavaScript with
  `moon build --target js`. It owns *all* game state and the simulation, and it has
  no knowledge of Three.js, the DOM, or Web Audio.
- **Render/sound layer (lower), implemented in JavaScript.** It keeps Three.js
  rendering, Web Audio synthesis, the DOM HUD/menus, keyboard/touch input, and the
  PWA shell. It exposes a flat API that the logic layer drives via FFI.

Non-goals: changing gameplay, camera, art, or audio design; rewriting the render
layer beyond what the boundary requires.

## 2. Confirmed decisions

- **Full logic in MoonBit** — physics, shots, serve, scoring, AI, *and* the
  orchestrator/state machine + fixed-step simulation. JS is purely render/sound/input.
- **Hybrid build** — `moon` builds the logic to an ESM module; **Vite** keeps
  bundling the web app (Three.js, PWA, assets, GitHub Pages `dist`) and imports the
  moon output. No mandatory third-party Vite plugin.
- **Source-only snapshot** — `old/` holds a frozen copy of the previous
  implementation (`src/`, `scripts/`, `tests/`, `public/`, `index.html`); root
  tooling (`package.json`, `.github`, `README`) is kept and evolved in place.
- Toolchain: `moon 0.1.20260608` (installed). MoonBit coding conventions per
  `AGENT.md` (snake_case, blocks separated by `///|`).

## 3. Layer boundary

### 3.1 What lives where

| Concern | Layer | Source today | Destination |
|---|---|---|---|
| Constants/units, court geometry | Logic | `physics/constants.js` | `logic/physics`, `logic/vec` |
| Ball flight, bounce, predictions | Logic | `physics/{ball,bounce,shotSolver}.js` | `logic/physics` |
| Stroke/serve model, contact quality, error | Logic | `game/{shots,serve}.js` | `logic/shots` |
| Match scoring | Logic | `match.js` | `logic/rules` |
| CPU AI | Logic | `ai.js` | `logic/ai` |
| Character stats | Logic | `characters.js` | `logic/shots` (or `logic/rules`) |
| Assist level/flags | Logic | `assist.js` | `logic/game` (state); localStorage stays JS |
| App + point + menu state machines, sim loop | Logic | `game.js` | `logic/game` |
| RNG | Logic | `gauss()` in `shots.js` | `logic/rng` (seeded) |
| Three.js scene/court/rigs/markers/camera | Render | `court.js`, `camera.js`, `entities/*` | JS `src/` |
| Web Audio synthesis | Sound | `audio.js` | JS `src/` |
| DOM HUD/menus/touch | Render | `ui.js` | JS `src/` |
| Keyboard/touch capture | Input | `input.js` | JS `src/` |
| RAF loop, renderer, bootstrap | Render | `main.js` | JS `src/` |
| PWA service worker | Render | `pwa.js` | JS `src/` |

### 3.2 Entity split (important)

Today `entities/player.js` and `entities/ball.js` mix **numeric simulation state**
(`pos`, `vel`, `swing.t`, ball `state.pos/vel/spin/active`) with **Three.js rigs**.
The refactor splits each:

- Numeric state → MoonBit (`logic/game`, `logic/physics`).
- Three.js rig → JS, driven each render frame by the logic layer via
  `setBall(...)`, `setPlayerPos(side, ...)`, `startSwing(side, type, fh)`,
  `showTrail(...)`, `setSweet(...)`, `setReachColor(...)`.

Swing **timing/contact** (the `SWING_CONTACT_T ± SWING_WINDOW` window, `contactDone`)
is game logic and lives in MoonBit. The procedural keyframe pose (the `kf()` lerps in
the rig) stays in JS as a cosmetic animation triggered by `startSwing`.

### 3.3 Backend split (forced by `extern "js"`)

`extern "js"` only compiles on the JS backend. Therefore:

- **Pure packages** `vec`, `physics`, `rng`, `rules`, `shots`, `ai` contain **no**
  `extern "js"` and build/test on **both** the native (default) backend and `--target
  js`. All the heavy numeric/scoring/AI logic lives here and is unit-tested fast on
  native.
- **JS-only packages** `ffi` (host externs) and `game` (the state machine that calls
  the host) are **`--target js` only**. Their files use the `.js.mbt` suffix (or
  `moon.pkg.json` `"targets": { "<file>": ["js"] }`), so on a native build they
  contribute nothing and don't break `moon test`. Their tests run only under
  `--target js` (plus the integrated Playwright e2e).

This keeps `moon test` (native) green over the pure logic while the FFI/orchestration
is validated on the JS backend where it actually runs.

## 4. Control flow & ownership

The browser owns `requestAnimationFrame`, so **JS owns the loop**; **MoonBit owns all
state**. The JS bootstrap calls MoonBit exports each frame; inside them MoonBit calls
back into the JS render/sound API.

```js
// src/main.js (new bootstrap, structurally identical to today's loop)
import * as logic from '<moon artifact>/game.js';
const host = { render, audio, ui, camera, input };  // closes over Three.js scene + rigs
logic.init(host, seed);
ui.setMenuTapHandler(idx => logic.menuTap(idx));

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  logic.handleInput();
  const sdt = dt * logic.getTimeScale(dt);   // slow-mo, state in MoonBit
  acc += sdt;
  while (acc >= DT) { logic.fixedUpdate(DT); acc -= DT; }
  logic.frameUpdate(sdt);
  input.endFrame();
  renderer.render(scene, camera);
}
```

- `DT = 1/240` accumulator stays in JS; `fixedUpdate(DT)` is called N times/frame.
- `getTimeScale(dt)` returns the eased slow-mo factor and mutates its eased state
  inside MoonBit (the old `g._timeScale`). MoonBit reads no wall clock — fully
  deterministic given the dt sequence.
- **Menus:** the app state machine (`MenuChar → MenuOpp → MenuSurface →
  MenuDifficulty → MenuAssist → Match → Results`), `menuIdx`, and `sel{player, opp,
  surface, difficulty}` live in MoonBit. Navigation (`handleMenuNav`, the
  confirm/escape transitions, `menu_tap(idx)`) is in MoonBit `handle_input`/
  `menu_tap`. MoonBit calls `host_show_*` to render the screens; the JS UI keeps the
  visual card list keyed by index.
- **Input:** pull-model. JS `input.js` captures DOM events and keeps the
  held/pressed sets; MoonBit pulls via `host_was_pressed/move_x/move_z/shot_key`.
  JS `input.endFrame()` clears the **edge-triggered** `pressed` set after
  `frameUpdate`, preserving today's exact semantics. Touch buttons and the analog
  stick continue writing into the JS input state (no MoonBit→JS callbacks).
- **Aim is read mid-fixed-step.** The old code reads `aimVec()` at the swing-contact
  instant inside `fixedUpdate` (any of the 240Hz substeps) and in `doServe`. `aimVec`
  derives from the **held move axis** — *level* state that survives `endFrame` — so it
  is safe to pull at any substep. MoonBit computes aim from `host_move_x/host_move_z`
  at the contact instant (`aim = {x: move_x, depth: -move_z}`), so no separate
  edge-buffered aim is needed.

## 5. FFI boundary

### 5.1 One opaque Host handle

Rather than bind ~40 individual functions as top-level externs (which would force JS
global singletons), JS builds a single `host` object and passes it to `init`. MoonBit
treats it as opaque and calls methods on it through thin `extern "js"` one-liners.

```moonbit
// logic/ffi/host.mbt — JS backend only
#external
pub type Host
```

### 5.2 Representative bindings (MoonBit → JS)

Doubles/Ints/Strings/Bool/`Array[Double]` marshal zero-cost. Examples (full table in
the appendix):

```moonbit
extern "js" fn host_sfx_hit(h : Host, speed : Double) -> Unit =
  "(h,s)=>h.audio.sfxHit(s)"
extern "js" fn host_sfx(h : Host, name : String) -> Unit =
  "(h,n)=>h.audio[n]()"   // sfxNet/sfxToss/sfxFault/sfxOut/sfxMenu/sfxConfirm/sfxReachAlert
extern "js" fn host_sfx_bounce(h : Host, speed : Double, surface : String) -> Unit =
  "(h,sp,id)=>h.audio.sfxBounce(sp,id)"

extern "js" fn host_set_ball(h : Host, active : Bool,
    px : Double, py : Double, pz : Double,
    sx : Double, sy : Double, sz : Double) -> Unit =
  "(h,a,px,py,pz,sx,sy,sz)=>h.render.setBall(a,px,py,pz,sx,sy,sz)"
extern "js" fn host_set_player(h : Host, side : Int,
    x : Double, z : Double, vx : Double, vz : Double) -> Unit =
  "(h,s,x,z,vx,vz)=>h.render.setPlayerPos(s,x,z,vx,vz)"
extern "js" fn host_start_swing(h : Host, side : Int, ty : String, fh : Bool) -> Unit =
  "(h,s,t,fh)=>h.render.startSwing(s,t,fh)"
extern "js" fn host_show_trail(h : Host, pts : Array[Double], ideal_idx : Int) -> Unit =
  "(h,a,i)=>h.render.showTrailFlat(a,i)"   // pts = [x,y,z,afterBounce, ...]
extern "js" fn host_set_sweet(h : Host, show : Bool, x : Double, y : Double, z : Double,
    cd_frac : Double, cd_good : Bool) -> Unit =
  "(h,s,x,y,z,f,g)=>h.render.setSweet(s,x,y,z,f,g)"
extern "js" fn host_reach_color(h : Host, in_reach : Bool) -> Unit =
  "(h,r)=>h.render.setReachColor(r)"

extern "js" fn host_camera_update(h : Host, dt : Double, mode : String) -> Unit =
  "(h,dt,m)=>h.camera.update(dt,m)"   // camera reads positions the logic already pushed
extern "js" fn host_update_score(h : Host, games : String, points : String,
    p : String, c : String, serve_no : Int) -> Unit =
  "(h,g,pt,p,c,n)=>h.ui.updateScore(g,pt,p,c,n)"
extern "js" fn host_show_menu(h : Host, screen : String, idx : Int, subtitle : String) -> Unit =
  "(h,sc,i,sub)=>h.ui.showMenu(sc,i,sub)"
extern "js" fn host_gauge(h : Host, name : String, frac : Double, lo : Double,
    hi : Double, good : Bool) -> Unit = "(h,n,f,lo,hi,g)=>h.ui.gauge(n,f,lo,hi,g)"

// input (pull)
extern "js" fn host_move_x(h : Host) -> Double = "(h)=>h.input.moveX()"
extern "js" fn host_was_pressed(h : Host, code : String) -> Bool = "(h,c)=>h.input.wasPressed(c)"
extern "js" fn host_shot_key(h : Host) -> String = "(h)=>h.input.shotKey()??''"
```

### 5.3 Exports (JS → MoonBit), in `logic/game/moon.pkg.json`

```json
{ "link": { "js": { "format": "esm",
  "exports": ["game_init:init","handle_input:handleInput","fixed_update:fixedUpdate",
              "frame_update:frameUpdate","get_time_scale:getTimeScale","menu_tap:menuTap"] } } }
```

`game_init` (not `init` — that name is reserved for MoonBit's auto-run package
initializer, which takes no args/return). The JS side still imports `init` (the alias).
Exported functions are `pub`. No `is-main` needed (this is an exporting library).

```moonbit
pub fn game_init(h : Host, seed : Int) -> Unit     // store host, seed RNG, show char menu
pub fn handle_input() -> Unit                       // edge-triggered; pulls input
pub fn fixed_update(dt : Double) -> Unit            // one fixed step
pub fn frame_update(dt : Double) -> Unit            // visuals/camera/hud push
pub fn get_time_scale(dt : Double) -> Double        // slow-mo factor
pub fn menu_tap(idx : Int) -> Unit                  // tap to select/confirm (idx, or sentinel)
```

### 5.4 Per-frame call budget

- The 240 Hz `fixed_update` loop makes **no** FFI calls except discrete events
  (bounce/net/hit sound, score/banner change). State is updated in MoonBit only.
- `frame_update` pushes visuals **once**: one `host_set_ball`, one `host_set_player`
  per side, `host_camera_update`, and the HUD gauges. The trajectory trail is one
  flat `Array[Double]` call, throttled by ball-stamp change (as today at
  `game.js` line ~696).

### 5.5 Shared menu/character data (single source of truth)

`CHARACTERS`, `DIFFICULTIES`, and `ASSIST_OPTIONS` straddle the boundary: the logic
layer needs ids + numeric tuning (stats, posErr/react/speedMul, assist level); the
render layer needs display strings (name/color/desc/archetype, stat-bar values).

**MoonBit is the source of truth** for the canonical *ordered list* (ids + tuning).
The JS UI keeps a parallel display table **keyed by the same index/order**. To prevent
silent drift, the menu FFI passes the *selected index + a subtitle/payload*, and a JS
smoke check (in the carried-forward `scripts/`) asserts the JS display tables match
the MoonBit lists in **count and id/order**. Where practical, push display strings out
through `host_show_menu(screen, idx, payloadJson)` so the cards render from
MoonBit-provided data rather than a duplicated JS list; the duplicated-table-with-
parity-check is the fallback for the rich character cards (stat bars/colors).

## 6. State representation in MoonBit

To mirror the in-place integrator and avoid per-step allocation, model hot state as
flat structs of `mut Double` rather than nested `Vec3` records:

```moonbit
pub struct Ball {
  mut px : Double; mut py : Double; mut pz : Double
  mut vx : Double; mut vy : Double; mut vz : Double
  mut sx : Double; mut sy : Double; mut sz : Double   // spin (rad/s)
  mut active : Bool
}
```

`Vec3` (a small immutable record) is used for pure helpers (targets, predictions)
where clarity beats allocation. The whole game is one `Game` struct held in a
module-level `Ref[Game?]` set by `game_init`. Step events (bounce/net) use a reused
`Array[Event]` cleared each step (mirrors the JS `g.events.length = 0`).

**Magnitudes:** the source uses 3-arg `Math.hypot(x,y,z)` throughout. MoonBit's
`@math.hypot` is 2-arg, so on parity-sensitive paths reproduce it as nested
`@math.hypot(@math.hypot(x, y), z)` (which lowers to `Math.hypot` semantics on the JS
backend). Use this form consistently for ball speed, contact distance, and the solver
so the JS-backend results match the old code bit-for-bit.

## 7. Determinism / RNG

Today the only randomness is `Math.random()` inside `gauss()` (`shots.js`), reused by
`serve.js` and `ai.js`, plus a few bare `Math.random()` calls (mishit roll, AI choice
noise, serve type/preset, reaction jitter). All become draws from one **seeded PRNG**
in `logic/rng`:

```moonbit
pub struct Rng { mut s : UInt }                  // mulberry32
pub fn Rng::next_f64(self : Rng) -> Double { ... } // [0,1)
pub struct Gauss { rng : Rng; mut spare : Double; mut has : Bool }
pub fn Gauss::draw(self : Gauss) -> Double { ... } // Box-Muller, clamped to [-2.5, 2.5]
```

The seed is generated in JS and passed to `init(host, seed)`. A single `Gauss`/`Rng`
lives in the `Game` struct and is threaded into `shots`/`serve`/`ai` as a parameter
(no global). Distributions, clamps, and multipliers are identical to today, so
balance is unchanged; only the exact sequence differs (and is now reproducible).

## 8. Build & CI

### 8.1 Hybrid build

`moon build --target js --release` emits (default target dir is `_build`, and the
path includes the full package path `logic/game`):
`_build/js/release/build/logic/game/game.js`.
`src/main.js` imports it as a normal ESM file. Vite bundles everything for the
browser. npm lifecycle hooks guarantee ordering:

```jsonc
{ "scripts": {
  "logic:build": "moon build --target js --release",
  "logic:test":  "moon test",
  "prebuild":    "npm run logic:build",
  "predev":      "npm run logic:build",
  "dev":   "vite",
  "build": "vite build",
  "test":  "moon test",
  "preview": "vite preview"
} }
```

The moon build output is git-ignored; CI/prod always build it before Vite. The
optional `vite-plugin-moonbit` may be used for local dev watch only; the prebuild is
the robust CI/prod path (one risk: the artifact path can change across moon versions
— mitigated by pinning the toolchain and asserting the file exists in `prebuild`).

### 8.2 CI `.github/workflows/test.yml` (new)

```yaml
name: test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - name: Install MoonBit
        run: |
          curl -fsSL https://cli.moonbitlang.com/install/unix.sh | bash
          echo "$HOME/.moon/bin" >> "$GITHUB_PATH"
      - run: moon version
      - run: npm ci
      - run: moon test
      - run: moon test --target js     # float-parity sanity on the JS backend
      - run: moon build --target js --release
      - run: npm run build
```

`deploy-pages.yml` gains the Install-MoonBit + `moon build`/`moon test` steps before
the Vite build, replacing the old `npm test`/`npm run physcheck`.

### 8.3 README / AGENT.md

Update the README tech-stack section to describe the two layers (MoonBit logic
compiled via `moon`, JS/Three.js render layer bundled by Vite), the `moon test` CI,
and the build flow. Keep `AGENT.md` (MoonBit conventions) authoritative for the logic
layer.

## 9. Testing strategy

- `match.test.js` → `logic/rules` inline `test {}` blocks, 1:1 with the old asserts.
- `physics-check.mjs` → `logic/physics` + `logic/shots` tests with the same numeric
  thresholds (rebound bands, retention orderings, descent-angle deltas, latDev signs,
  solver no-reinflation, contact-quality sensitivity, stretched-contact). Monte-Carlo
  checks use a fixed seed. Performance checks become non-gating (native backend timing
  differs from the old JS numbers).
- **Parity is exact only on `--target js`** (the JS backend binds `Math.*`). The
  native backend uses software libm and differs in the last ULPs, which compounds in
  the per-step `exp` (spin decay) and `hypot`. So: native tests assert **inequality
  bands** (the thresholds the old checks already use); the **exact** comparison vs
  `old/scripts/physics-check.mjs` is run once on `--target js` before deleting the JS
  logic. `logic/game`/`logic/ffi` tests run on `--target js` only (per §3.3).
- The carried-forward Playwright `scripts/*-check.mjs` validate the integrated app.

## 10. Phasing

1. **Design Doc + agent review** (this document). Gated.
2. **Snapshot** into `old/`.
3. **Spike**: minimal `init`/`fixed_update` driving one `host_set_ball` + one
   `host_sfx`; confirm one MoonBit→JS round trip.
4. **Port** in dependency order, each `moon test`-verified: `vec`+`physics`+`rng` →
   `rules` → `shots`+`serve` → `ai` → `game` state machine (stub host).
5. **FFI + bootstrap wiring**: `render-host.js` adapter, entity-rig split, wire all
   `host_*`, rewrite `main.js`. Full game plays.
6. **CI + README**.

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Float parity (f64 vs JS Number; `Math.hypot` scaling; 11-iter bisection solver) | Bind `Math.hypot`/`Math.exp` as externs where strict; run physics tests on `--target js`; keep thresholds as inequalities; compare vs retained `old/` script before deleting JS. |
| Mutable nested state awkward in MoonBit | Flat `mut Double` structs for hot state; reuse event arrays. |
| Per-frame FFI volume | Batch setters once per render frame; events-only in the fixed loop. |
| Array marshaling for trails | Flat `Array[Double]` + `idealIdx`, decoded in `render-host`. |
| FFI closure lifetimes | No MoonBit→JS closures; pull-model input; only `Host` + primitives/arrays cross. |
| Toolchain drift (artifact path) | Pin moon version in CI; `prebuild` asserts artifact exists. |
| Determinism behavior change | Documented; seed is explicit and loggable; distributions unchanged. |

## 12. Acceptance criteria

- `moon test` (native) green on the pure packages with inequality-band asserts;
  `moon test --target js` green on everything and **bit-exact** vs `old/` for the
  physics/scoring checks before the JS logic is deleted.
- `npm run build` succeeds importing the moon artifact; `npm run dev` plays a full
  match (menus → serve → rally → scoring → HUD → sounds → slow-mo → trails) driven by
  MoonBit logic.
- CI `test.yml` green; Pages deploy produces a working build.
- Camera position/angle unchanged.

## Appendix A — Full FFI API surface (JS render/sound/input → exposed to MoonBit)

Audio: `sfxHit(speed)`, `sfxBounce(speed, surfaceId)`, `sfxNet()`, `sfxToss()`,
`sfxCrowd(intensity)`, `sfxOut()`, `sfxFault()`, `sfxMenu()`, `sfxConfirm()`,
`sfxReachAlert()`.

Render: `setBall(active, px,py,pz, sx,sy,sz)`, `setPlayerPos(side, x,z, vx,vz)`,
`startSwing(side, type, fh)`, `serveAnim(side, on)`, `setReachColor(inReach)`,
`showLanding(x,z)` / `hideLanding()`, `setSweet(show, x,y,z, frac, good)`,
`showTrailFlat(arr, idealIdx)` / `hideTrail()`.

Camera: `update(dt, mode)`, `snap(mode)`, `setServeLookX(x)`.

UI menus: `showCharSelect(title, idx, subtitle)`, `showSurfaceSelect(idx)`,
`showDifficultySelect(idx)`, `showAssistSelect(idx)` (the difficulty/assist/surface
cards carry typed list data — either dedicated calls as listed, or a single
`showMenu(screen, idx, payload)` where `payload` carries the card data), `hideMenu()`,
`showResults(win, lose, games, playerWon)`.

UI HUD: `showHUD()` / `hideHUD()`, `updateScore(games, points, p, c, serveNo)`,
`banner(text)`, `toast(text, ms)`, `flashShot(type)`, `setRecommendedShot(type|'')`,
`serveSpeedToast(kmh)`, `updateMoveHint(dx, dz)` / `hideMoveHint()` (the "where to
stand" arrow, driven each frame from the sweet-spot), and the gauges
`gauge(name, frac, lo, hi, good)` / `hideGauge(name)` where `name ∈ {toss, timing,
height}`. **All three gauges can be live simultaneously** (e.g. timing meter + height
bar during a serve return), so the host multiplexes them by name — not a single gauge.

Input (pull): `moveX()`, `moveZ()`, `wasPressed(code)`, `isDown(code)`, `shotKey()`.
