# tetetetennis

A browser 3D tennis game (Three.js). One-set match, you vs the CPU, with
physically-based ball flight (drag + Magnus effect) and surface-dependent
bounces, rendered first-person from your player's eyes.

## Run

```bash
npm install
npm run dev      # open the printed URL
```

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
- **Cyan ring + arrow** — where to stand for a clean contact: the ring marks
  the spot on the court, the on-screen arrow points the way (it turns into a
  green ◎ when you are on the spot).
- **Toss gauge** (during your serve) — the camera keeps facing the court, so
  the toss height is shown as a vertical gauge; hit when the dot is in the
  green band for full power and accuracy.

- Shot quality depends on your position: hit the ball in the sweet spot
  (close, waist height) for clean power; stretching or getting jammed
  produces weak, short, error-prone balls.
- Serve power/accuracy depends on hitting near the top of the toss.

## Shot types

- **Flat** — fastest ball on a low line; shallow, skidding bounce.
- **Topspin** — slower off the racket but arcs high over the net, dips
  sharply (Magnus effect) and kicks up off the bounce.
- **Slice** — clearly slower floater with backspin: it stays low and robs
  the bounce of pace, especially on grass.

## Surfaces

- **Clay** — slow and high-bouncing; topspin kicks up, slices check.
- **Grass** — fast and low; slices skid, big serves dominate.
- **Hard** — medium pace, true bounce.

Bounces are physical: vertical restitution plus a Coulomb friction impulse.
The ball always loses horizontal speed at the bounce, and the loss is driven
by each surface's friction coefficient (clay μ=0.80 slows a flat drive by
~7.6 m/s, hard μ=0.56 by ~5.5, grass μ=0.38 by ~3.5) — verified by
`npm run physcheck`.

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
npm run build        # production build
```

All sound effects are synthesized at runtime with the Web Audio API — no
audio assets.
