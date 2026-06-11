# tetetetennis

A browser 3D tennis game (Three.js). One-set match, you vs the CPU, with
physically-based ball flight (drag + Magnus effect) and surface-dependent
bounces.

## Run

```bash
npm install
npm run dev      # open the printed URL
```

## How to play

| Action | Keys |
|---|---|
| Move | WASD / Arrow keys |
| Flat shot | Z (or J) |
| Topspin shot | X (or K) |
| Slice shot | C (or L) |
| Serve | Space to toss, then Z/X/C near the top of the toss (Z flat / X kick / C slice) |
| Aim | hold a direction while swinging (left/right = sides, up = deep, down = short) |
| Menus | Arrows + Enter, Esc = back / quit match |

- Shot quality depends on your position: hit the ball in the sweet spot
  (close, waist height) for clean power; stretching or getting jammed
  produces weak, error-prone balls.
- Serve power/accuracy depends on hitting near the top of the toss.

## Surfaces

- **Clay** — slow and high-bouncing; topspin kicks up, slices check.
- **Grass** — fast and low; slices skid, big serves dominate.
- **Hard** — medium pace, true bounce.

## Characters

Boom (big server) · Rojo (spin grinder) · Dash (counterpuncher) ·
Sly (slice specialist) · Ace (all-rounder). The CPU plays with the same
stat-driven physics and shot-selection personality.

## Development

```bash
npm test             # scoring logic unit tests (vitest)
npm run physcheck    # headless ball-physics sanity checks
node scripts/rally-check.mjs   # serve/stroke in-rate sanity
npm run dev -- --port 5199 & node scripts/e2e-check.mjs  # browser smoke test (playwright)
npm run build        # production build
```

All sound effects are synthesized at runtime with the Web Audio API — no
audio assets.
