# tetetetennis

A browser 3D tennis game. One-set match, you vs the CPU, with physically-based
ball flight (drag + Magnus effect) and surface-dependent bounces.

The game is split into two layers:

- **Game-logic layer — [MoonBit](https://www.moonbitlang.com/)**, compiled to a
  JavaScript ES module (`moon build --target js`). It owns all state and the
  simulation (ball flight, bounce, shot solver, contact/serve models, scoring,
  CPU AI, the point/rally/menu state machines) and is unit-tested with
  `moon test`. Lives under `logic/`.
- **Render/sound layer — JavaScript + Three.js**, bundled by Vite. It handles
  rendering, Web Audio, the DOM HUD/menus, touch/keyboard input and the PWA
  shell, exposing a flat API the logic layer drives via FFI. Lives under `src/`.

The previous all-JavaScript implementation (the codebase before the MoonBit
refactoring) is preserved on the **`old_master0613`** branch for reference; the
refactor itself is documented in `design_docs/refactor-moonbit-layers.md`.

## Run

```bash
npm install
npm run dev      # open the printed URL
```

## Install (PWA)

The game is an installable Progressive Web App: open the deployed site and
use your browser's **Install** / **Add to Home Screen** action to run it
full-screen, landscape, with its own icon. After the first online visit a
service worker caches the app, so it **plays fully offline** (all graphics
are procedural and the audio is synthesized, so there are no extra downloads).

The app icons are drawn procedurally, not stored as art; the generated PNGs and
manifest icons live in `public/` (the generator script lives on the
`old_master0613` branch).

## Game modes

The home screen offers two modes:

- **Match** — a scored singles set against the CPU (pick player, opponent, surface,
  difficulty, set length, assist). This is the classic game.
- **Practice** — the CPU acts as a ball machine: it feeds you balls on your terms and
  **no points are counted**, so you can groove a return. You choose your player, the CPU's
  player, the surface, whether it feeds a **stroke or a serve**, the **shot type**
  (strokes: flat / topspin / slice / lob / drop; serves: flat / slice / kick), and — for
  stroke feeds — the **depth** (shallow forecourt / deep backcourt / random). Feeds vary
  side-to-side so you have to move. Esc → Quit returns to the home screen. See
  [`design/practice-mode/practice-mode.md`](design/practice-mode/practice-mode.md).

## How to play

### Keyboard

| Action | Keys |
|---|---|
| Move | Arrow keys — you strafe facing forward; diagonals combine (e.g. up+left); movement has real acceleration and braking |
| Stroke | **Hold** Z/J (flat), X/K (topspin), C/L (slice), V (drop) to charge, then **release** to hit. Release in the sweet spot for a **Perfect Hit**; a full charge **overcharges** (more power, more risk) |
| Serve | Space to toss, then Z/X/C (flat / kick / slice) when the **power meter** is in the green band; overpowering it is fast but wild |
| Aim | hold a direction **at the moment you release** — works for strokes and serves (left/right = sides, up = deep, down = short) |
| Pause | Esc opens a Resume/Quit pause menu (P or Esc resumes) |
| Menus | Arrows + Enter, Esc = back |

### Touch / on-screen controls

The game is playable on phones and tablets (hold the device in landscape
with both hands):

- Menus: tap a card to select it, tap it again to confirm.
- On the court, an on-screen pad appears:
  - **Left thumb** — analog stick (bottom-left): drag to move; it works like a
    console thumbstick — push further to move faster, and the knob springs back
    to centre when you let go. Hold a direction while swinging to aim.
  - **Right thumb** — one **SHOT** button (bottom-right): it tosses and serves,
    and hits your strokes during a rally. **Hold** it to charge and **release** to
    hit; the shot type is chosen **at random** each time, so just focus on timing
    and position.
  - **Top-right**: `⌨` / `🎮` toggles the on-screen controls on/off (the
    choice is remembered), `✕` quits to the menu.

### Reading the screen

- The camera sits just behind your player (third-person), so you see your own
  player from behind; it stays facing the court and never looks up.
- **Yellow ring** — where the incoming ball will land.
- **Trajectory dots** — the incoming ball's predicted path from just before
  the bounce: yellow dots down to the bounce, cyan dots for the arc after
  it, so you can read where the ball is going before it gets there. The
  **big orange dot** marks the waist-height point of the arc — the ideal
  place to meet the ball.
- **Cyan ring + arrow** — where to stand for a clean contact: the ring marks
  the spot on the court, the on-screen arrow points the way (it turns into a
  green ◎ when you are on the spot).
- **Charge bar** — while you hold a stroke, a bar fills; it turns red in the
  **overcharge** zone (max power, but risky). Release in the sweet spot for a
  Perfect Hit.
- **Serve power meter** (during your serve) — a horizontal meter oscillates;
  hit when it is in the green band for a fast, accurate serve. Overpowering it
  serves harder but sprays.
- **Open-court highlight** — a translucent patch marks the side the CPU has
  vacated; aim there for a winner.

- Shot quality depends on your position: the ideal contact is the ball at
  **waist height, an arm-plus-racket length to your side** (forehand or
  backhand). Stretching for it or getting jammed against the body produces
  weak, short, error-prone balls.
- A **blue circle** on the court shows your horizontal reach area. It turns
  **pink** and a subtle rising tone plays when the incoming ball enters your
  striking range — a quick cue that it's time to swing.
- Serve power/accuracy depends on locking the power meter in the green band.

## Shot types

- **Flat** — fastest ball on a low line; shallow, skidding bounce.
- **Topspin** — slower off the racket but arcs high over the net and dips
  sharply (Magnus effect: the same launch without spin would fly ~2.8 m
  deeper), then kicks up off the bounce.
- **Slice** — clearly slower floater whose backspin carries it on a
  straighter, stretched line (~3.1 m deeper than the same launch without
  spin); it stays low and robs the bounce of pace, especially on grass.
- **Drop** — the slowest stroke: a backspin touch that floats just over the net
  and dies short, to pull a baseline-hugging opponent forward.
- **Lob** (automatic) — when you're stretched out of position you'll loft a
  defensive lob instead of a normal stroke. Against a net-rusher the CPU lobs too.

Holding a stroke **charges** it (more power, plus shot-specific extras: topspin
gains a sharp short-angle attack, slice digs deeper). A **Perfect Hit** (release
in the sweet spot) adds a little speed, spin and accuracy. Fast incoming balls
can **jam** a full swing into a weak sitter — block them with slice or charge
early — while a clean flat/slice **counters** the pace back faster.

Ball pace is globally scaled (`pace` in `logic/physics/constants.mbt`, 0.64) to
80 % of the original speed — rallies leave plenty of time to position.

Serves: **flat** is the cannonball; **kick** clears the net high and dives
into the box (the safe second serve); **slice** curves visibly toward the
receiver's right. The CPU serves like a player: flat (sometimes slice) on
first serve, kick on second.

## Surfaces

- **Clay** — slow and high-bouncing; topspin kicks up, slices check.
- **Grass** — fast and low; slices skid, big serves dominate.
- **Hard** — medium pace, true bounce.

Bounces are physical: vertical restitution plus a Coulomb friction impulse.
The restitution is anchored to the ITF ball test (a 2.54 m drop on hard
court rebounds ~1.35-1.47 m) and — because a tennis ball is not rigid —
falls with impact speed, so hard-hit balls rebound proportionally lower.
Flat and slice balls lose horizontal speed at the bounce, with the loss
driven by each surface's friction coefficient (clay μ=0.80 robs a slice of
~7.3 m/s, hard μ=0.56 of ~5.0, grass μ=0.38 of ~3.2); a heavily overspun
topspin ball can even kick forward — all verified by `moon test` (the physics
checks are ported into `logic/physics`).

## Characters

Boom (big server) · Rojo (spin grinder) · Dash (counterpuncher) ·
Sly (slice specialist) · Ace (all-rounder). The CPU plays with the same
stat-driven physics and shot-selection personality.

## Difficulty

Pick **Easy / Normal / Hard** after choosing the surface. Difficulty changes
only the CPU's brain — reaction time, read accuracy, swing timing, shot
selection risk, serve toss quality, and a touch of foot speed — never the
character's stats, so every opponent keeps their identity at every level.

## Development

Requires the [MoonBit toolchain](https://www.moonbitlang.com/download)
(`moon`) on your `PATH` in addition to Node.

```bash
moon test               # logic-layer tests on the native backend (fast)
moon test --target js   # same tests on the JS backend (bit-exact physics parity)
moon build --target js --release   # compile the logic layer to JS

npm run dev             # dev server (the `predev` hook compiles the logic first)
npm run build           # production build (the `prebuild` hook compiles the logic)
npm run preview         # preview the production build
```

The build is **hybrid**: `moon` compiles the MoonBit logic to
`_build/js/release/build/logic/game/game.js` (an ES module), and Vite bundles
the web app importing it. The `predev`/`prebuild` npm hooks run `moon build`
automatically, so `npm run dev` / `npm run build` are all you normally need.

CI (`.github/workflows/test.yml`) installs MoonBit, runs `moon test` on both
backends, then `moon build` + the Vite build.

All graphics are procedural and sound effects are synthesized at runtime with
the Web Audio API — no asset downloads.
