# tetetetennis

A browser 3D tennis game (Three.js). One-set match, you vs the CPU, with
physically-based ball flight (drag + Magnus effect) and surface-dependent
bounces, rendered first-person from your player's eyes.

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

The app icons are drawn, not stored as art — regenerate them with
`npm run icons` (writes the PNGs and manifest icons into `public/`).

## How to play

### Keyboard

| Action | Keys |
|---|---|
| Move | WASD / Arrow keys — you strafe facing forward; diagonals combine (e.g. up+left); movement has real acceleration and braking |
| Flat shot | Z (or J) |
| Topspin shot | X (or K) |
| Slice shot | C (or L) |
| Serve | Space to toss, then Z/X/C when the **toss gauge** dot is in the green band (Z flat / X kick / C slice) |
| Aim | hold a direction **at the moment of the hit** — works for strokes and serves (left/right = sides, up = deep, down = short) |
| Menus | Arrows + Enter, Esc = back / quit match |

### Touch / on-screen controls

The game is playable on phones and tablets (hold the device in landscape
with both hands):

- Menus: tap a card to select it, tap it again to confirm.
- On the court, an on-screen pad appears:
  - **Left thumb** — D-pad (bottom-left): move; slide your thumb to change
    direction (8-way). Hold a direction while swinging to aim.
  - **Right thumb** — shot buttons (bottom-right): **FLAT** / **TOP** /
    **SLICE**, plus **SERVE** for the toss (then hit a shot button near the
    top of the toss).
  - **Top-right**: `⌨` / `🎮` toggles the on-screen controls on/off (the
    choice is remembered), `✕` quits to the menu.

### Reading the screen (first-person view)

- The camera is your player's eyes; your own body is not drawn.
- **Yellow ring** — where the incoming ball will land.
- **Trajectory dots** — the incoming ball's predicted path from just before
  the bounce: yellow dots down to the bounce, cyan dots for the arc after
  it, so you can read where the ball is going before it gets there. The
  **big orange dot** marks the waist-height point of the arc — the ideal
  place to meet the ball.
- **Cyan ring + arrow** — where to stand for a clean contact: the ring marks
  the spot on the court, the on-screen arrow points the way (it turns into a
  green ◎ when you are on the spot).
- **Toss gauge** (during your serve) — the camera keeps facing the court, so
  the toss height is shown as a vertical gauge; hit when the dot is in the
  green band for full power and accuracy.

- Shot quality depends on your position: the ideal contact is the ball at
  **waist height, an arm-plus-racket length to your side** (forehand or
  backhand). Stretching for it or getting jammed against the body produces
  weak, short, error-prone balls.
- A **blue circle** on the court shows your horizontal reach area. It turns
  **pink** and a subtle rising tone plays when the incoming ball enters your
  striking range — a quick cue that it's time to swing.
- Serve power/accuracy depends on hitting near the top of the toss.

## Shot types

- **Flat** — fastest ball on a low line; shallow, skidding bounce.
- **Topspin** — slower off the racket but arcs high over the net and dips
  sharply (Magnus effect: the same launch without spin would fly ~2.8 m
  deeper), then kicks up off the bounce.
- **Slice** — clearly slower floater whose backspin carries it on a
  straighter, stretched line (~3.1 m deeper than the same launch without
  spin); it stays low and robs the bounce of pace, especially on grass.

Ball pace is globally scaled (`PACE` in `src/physics/constants.js`, 0.64) to
80 % of the original speed — rallies leave plenty of time to position.
Player movement speed is boosted 1.5× so you can still cover the court.

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
topspin ball can even kick forward — verified by `npm run physcheck`.

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

```bash
npm test             # scoring logic unit tests (vitest)
npm run physcheck    # headless ball-physics sanity checks
node scripts/rally-check.mjs   # serve/stroke in-rate sanity
node scripts/ai-check.mjs      # CPU return rates per difficulty
npm run dev -- --port 5199 & node scripts/e2e-check.mjs  # browser smoke test (playwright)
node scripts/fpv-check.mjs    # first-person camera / gauge / markers (needs the dev server)
npm run icons        # regenerate the PWA icons into public/
npm run build        # production build

# PWA check: manifest, service worker, and a fully-offline reload, against
# the production build served at the GitHub Pages base path
npm run build -- --base=/tetetennis/
npx vite preview --base=/tetetennis/ --port 4180 & node scripts/pwa-check.mjs
```

All sound effects are synthesized at runtime with the Web Audio API — no
audio assets.
