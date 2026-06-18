# Design — Ball Physics Rebalance

Status: **implemented**.
Ref: `design_docs/game-design.md` §6 (Charge), `logic/physics/`

## 1. Motivation

The original ball physics, while derived from first principles (drag from air density,
CL model for Magnus), produced shots that felt slow and had no natural speed/depth
trade-off. The core issues:

1. **Speed**: A global `pace = 0.64` made all shots ~64% of their nominal speed.
   A flat groundstroke that should travel at ~28 m/s was only ~21 m/s.
2. **Solver**: The bisection solver optimised launch angle to hit a precise target depth.
   This made every shot land near the same spot regardless of how hard it was hit.
3. **Bounce**: The spin-bounce model lacked the pronounced vertical "kick" that makes
   heavy topspin balls jump up on landing.

## 2. Design

### 2.A Speed — remove the global pace factor

Remove `pace = 0.64` and `eff_pace()`. Calibrate direct per-shot-type base speeds
to realistic values, scaled by quality and charge as before.

| Shot   | Old base (m/s, pow=70) | New base (m/s) |
|--------|------------------------|----------------|
| Flat   | 21.1                    | 23.0           |
| Topspin| 17.9                    | 19.5           |
| Slice  | 16.1                    | 17.5           |
| Lob    | 11.4                    | 12.8           |
| Drop   | 9.2                     | 9.5            |
| Smash  | 31.4                    | 39.6           |
| Serve flat | 34.3               | 50.4           |

New speed formulas use a simpler form:
```
max_flat_speed(pow) = BASE + BONUS * pow/100
```

### 2.B Shot solver — two-mode design

Replace the bisection-in-vertical-plane solver with two modes:

**`solve_control`** (for topspin/slice/lob/drop — convergence to target):
1. Analytic initial guess from drag-free parabola (apex → vy0 → flight time → vx, vz)
2. Forward-simulate with full physics (drag + Magnus + gravity), iteratively correct
   horizontal velocity to converge landing to target (up to 4 iterations, gain 0.7)
3. Net clearance check: if the simulated net-crossing height is below
   `net_height(x) + margin`, raise apex and re-solve (up to 6 retries)
4. Fallback: sweep elevation angles from 4° to 70°, pick the one that clears the
   net and lands closest to the target

**`solve_drive`** (for flat/smash/serve — speed-priority, natural speed/depth trade-off):
1. Keep the speed magnitude fixed — don't adjust to fit a target
2. Sweep elevation angles from -32° to +34° in 1° steps
3. For each angle, simulate through the net and to landing
4. Pick the angle that lands closest to the target depth while clearing the net
5. If no angle clears the net, pick the one that comes closest

This naturally produces realistic behaviour where:
- Harder-hit balls go deeper → risk of sailing OUT
- Lower contact + power increases net risk
- Fast serves that barely clear the net are rewarded with aces
- Touch shots (drop/lob) converge precisely to their targets

### 2.C Bounce — topspin vertical kick

Add a vertical velocity kick on bounce for topspin shots:

```
if proj > 0 (topspin, spin projected onto travel direction):
    vy += proj * SPIN_BOUNCE_VERTICAL
```

where `proj = (-ωz)·dx + (ωx)·dz` is the projection of the spin-induced surface force
onto the horizontal travel direction. This makes heavy topspin balls "jump up" after
bouncing, rising above the opponent's ideal strike zone.

### 2.D Constants changed

| Constant | Old | New |
|----------|-----|-----|
| `pace` | 0.64 | removed |
| `max_flat_speed` | (26 + 10·pow/100) · 0.64 | 18 + 7·pow/100 |
| `smash_speed` | (42 + 10·pow/100) · 0.64 | 34 + 8·pow/100 |
| `serve_flat_speed` | (40 + 16·srv/100) · 0.64 | 42 + 12·srv/100 |
| `serve_speed_min` | 42 | 30 |
| `serve_speed_max` | 78 | 54 |
| NEW `spin_bounce_vertical` | — | 0.004 |

### 2.E Charge system — unchanged

Per user request, the charge logic (power_mul, charge_cc, no overcharge penalty) stays
exactly as-is.

## 3. Files Changed

| File | Changes |
|------|---------|
| `logic/physics/constants.mbt` | Speed constants, remove pace, add spin_bounce_vertical |
| `logic/physics/solver.mbt` | New solve_control + solve_drive + fallback |
| `logic/physics/ball.mbt` / `bounce.mbt` | Vertical kick in apply_bounce |
| `logic/shots/shots.mbt` | Drive flag for flat shots |
| `logic/shots/serve.mbt` | Drive flag for serves |
| `logic/shots/shots_test.mbt` | Updated test thresholds |
| `logic/physics/physics_test.mbt` | Updated test thresholds |

## 4. Verification

1. `moon test` — 37/37 pass (native)
2. `moon test --target js` — 37/37 pass (JS)
3. `moon check --target js` — clean
4. `npm run build` — clean
