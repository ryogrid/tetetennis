# GAME_DESIGN — 3D Tennis Game : tetetennis

> **Scope of this document.** Sections 1–13 describe the game **as it is actually
> implemented** today, with parameters taken from the source of truth (the MoonBit
> logic layer under `logic/` and the JS render/sound layer under `src/`). A short
> source pointer (e.g. `logic/physics/constants.mbt`) follows the figures that come
> from a specific file. **Appendix A** collects design ideas from the original draft
> that are **not yet implemented**, preserved so the broader vision isn't lost — none
> of it is in the build.

## 1. Concept

A physically-grounded 3D tennis game played in the browser: one human vs. the CPU,
with real ball flight (aerodynamic drag + Magnus lift) and surface-dependent bounces.
The emphasis is on positioning and shot quality rather than twitch reflexes — *where*
and *how high* you meet the ball matters more than mashing a button.

## 2. Architecture

The game is split into two layers (see `design_docs/refactor-moonbit-layers.md`):

- **Game-logic layer — MoonBit (`logic/`)**, compiled to a JS ES module via
  `moon build --target js`. It owns all state and simulation: ball physics, bounce,
  stroke/serve models, scoring, the CPU AI, and the point/rally/menu state machines.
- **Render/sound layer — JavaScript + Three.js (`src/`)**, bundled by Vite. It draws
  the court, plays Web Audio, renders the DOM HUD/menus, reads input, and exposes a
  flat FFI API the logic layer drives.

**Determinism.** All randomness flows through a seeded RNG (`logic/rng/`,
mulberry32 + Box–Muller gauss) rather than `Math.random`, so a given seed and input
stream reproduce a match exactly. Physics is bit-exact between the native and JS
backends (`moon test --target js`).

## 3. Rules & Match Settings

A simplified but faithful subset of real tennis (`logic/rules/rules.mbt`).

- **Points**: 0 → 15 → 30 → 40 → Game. 40–40 is **Deuce**, then **Advantage → Game**
  (traditional advantage scoring; no No-Ad).
- **Match**: a single set. First to **6 games with a 2-game lead**; at **6–6** a
  **tiebreak** is played (first to **7 points, win by 2**). The number of games to win
  is **fixed** — there is no "games-to-win" selector.
- **Serve right** alternates every game; the human serves first.
- **Serve side**: Deuce (right) when the game's point count is even, Ad (left) when
  odd. The serve must land in the diagonally opposite service box. **Two faults =
  double fault** (point lost).
- **Lets**: if a serve clips the net but still lands in the correct box, it is a
  **let and is replayed** (`game.js.mbt:let_serve`) — i.e. traditional lets, not
  "play-on".
- **No court changes**: the human always occupies the near (+z) side; the CPU the
  far (−z) side.
- **In/Out**: a point is lost if a struck ball's first bounce is outside the singles
  court, or if it fails to cross the net (bounces on the hitter's own side). A second
  bounce on the receiver's side ends the point. On-the-line is **in** — judged with a
  grace equal to the ball radius (`line_grace = 0.033 m`).

## 4. Court & Surfaces

Court geometry (SI units, Y-up, net plane at z = 0; `logic/physics/constants.mbt`):

| Quantity | Value |
|---|---|
| Court half-length (baseline) | 11.885 m |
| Singles half-width | 4.115 m |
| Doubles half-width | 5.485 m |
| Service line (from net) | 6.40 m |
| Net height — centre / post | 0.914 m / 1.07 m |

Three surfaces set the bounce. `ey` is the vertical restitution at the ITF drop-test
impact speed; `μ` is the sliding-friction coefficient applied as a Coulomb impulse:

| Surface | `ey` | `μ` | Feel |
|---|---|---|---|
| **Clay** | 0.81 | 0.80 | slow, high bounce; topspin kicks, slices check |
| **Hard** | 0.75 | 0.56 | medium pace, true bounce |
| **Grass** | 0.66 | 0.38 | fast, low; slices skid, big serves dominate |

Restitution falls with impact speed
(`eyEff = ey · clamp(1 − 0.012·(|vy_in| − 7.1), 0.65, 1)`), so hard-hit balls rebound
proportionally lower — a non-rigid-ball effect anchored to the ITF test.

## 5. Ball Physics

Per-frame flight integrates gravity, aerodynamic drag, and Magnus lift at a fixed
`dt = 1/240 s` (`logic/physics/`):

| Quantity | Value |
|---|---|
| Gravity `g` | 9.81 m/s² |
| Ball mass / radius | 0.057 kg / 0.033 m |
| Air density `ρ` | 1.21 kg/m³ |
| Drag coefficient `Cd` | 0.55 |
| Max lift coefficient `Cl_max` | 0.40 |
| Spin-decay time constant `τ` | 7.0 s |

**Global pace.** Every shot's base launch speed is scaled by `pace = 0.64` (slower balls
leave more time to read and position). A runtime `pace_factor` multiplies
this; it is **0.85 while the Assist axis is On/Full** (§8) and 1.0 otherwise, so the
effective pace is `eff_pace = 0.64 × pace_factor`.

## 6. Shot System

### 6.1 Shot types

Five shot types exist (`logic/shots/shots.mbt`, `ShotType`). Each defines a speed
multiplier and a launch-angle band `(speed_mul, θ_min°, θ_max°)`:

| Type | speed_mul | θ band | Role |
|---|---|---|---|
| **Flat** | 1.00 | 0°–16° | fastest, lowest line; finishing shot, highest net/out risk |
| **Topspin** | 0.85 | 10°–32° | arcs over the net and dips; reliable rally staple |
| **Slice** | 0.76 | 1°–16° | slow floater, stays low and skids; buys time |
| **Lob** | 1.00 | 28°–55° | high, deep defensive ball |
| **Drop** | — | 26°–50° | slowest; a backspin touch that floats just over the net and dies short, to pull a baseline-hugger forward |

The human selects **Flat / Topspin / Slice / Drop** directly. **Lob is not directly
selectable**: it is auto-substituted as a forced defensive ball when the player is
*stretched* (reaching at the edge of range) and not already slicing
(`shots.mbt`, `cq.stretched && typ != Slice → Lob`). The CPU may also produce lobs.

Spin RPM is stat- and quality-scaled: Flat `300 + 400·q`; Topspin
`(2200 + 2600·spn/100)·(0.5 + 0.5·q)`; Slice `−(1500 + 1800·slc/100)·(0.5 + 0.5·q)`;
Lob a light `500`; Drop a heavy backspin `−slice_rpm·(0.55 + 0.45·q)·0.9`. Slice also
gets a touch of vertical-axis spin so it drifts toward the contact side. Drop and Lob
use an absolute touch speed (Drop `(12 + 4·slc/100)·eff_pace`, the slowest stroke;
Lob `(15 + 4·pow/100)·eff_pace`) rather than the flat-speed model, and Drop targets a
short `~2.2 m` past the net instead of the rally depth floor.

### 6.2 Input & the charge / Perfect-Hit mechanic

Rally strokes are **hold-to-charge** (`logic/game/game.js.mbt:update_human_charge`,
`src/input.js`):

- **Keyboard**: move with the Arrow keys; **hold** **Z/J = Flat, X/K = Topspin,
  C/L = Slice, V = Drop** to build charge, and **release** to swing; **Space** tosses/serves.
- **Touch**: an analog thumbstick (left) to move; **hold** the single **SHOT** button
  (right) to charge and release to hit — the shot type is chosen **at random** at the
  start of each charge.

**Charge.** While a shot key is held, charge `c` builds 0→1.0 over
`charge_time = 0.8 s` and can be pushed into **Overcharge** up to `charge_max = 1.25`. The
launch speed is multiplied by `power = 0.85 + 0.40·min(c, 1)` — a quick tap is weak
(0.85×), a full charge is strong (1.25×). Overcharge (`c > 1`) adds aim error
`∝ (c − 1)·2.8 m` and shrinks the safety margin, so going for maximum power raises out/net
faults. After contact, movement is nearly halted (`stiff_factor = 0.12`) for
`stiff_dur = 0.35 s` (post-impact stiffness).

**Release & Perfect Hit.** Releasing fires the swing, which makes contact in the existing
forgiving window (`swing_contact_t = 0.18 s ± swing_window = 0.09 s`; the CPU is exact).
If the contact lands in the core (quality `q ≥ 0.90`), it is a **Perfect Hit**: speed
×1.08, spin ×1.12, and aim error ×0.6, plus a gold cue and a bell (`sfxPerfect`). A
**Safety Hit** auto-fires if you hold too long and the ball is about to escape (it has
passed you horizontally, or dropped below `safety_drop_y = 0.7 m` while no longer closing
faster than `safety_approach_rate = 3 m/s`) — it forgoes the Perfect bonus but keeps the
rally alive. Releasing with the ball out of reach **whiffs** (a `0.25 s` cooldown).

A **charge bar** (`host_charge`) shows the build-up and turns red in the overcharge zone.
The CPU swings at neutral power (`cpu_charge` → `power = 1.0`); **Assist=Full** auto-charges
and auto-releases at the sweet spot.

**Charge enhancements** (scaled by `cc = min(charge, 1)`, so overcharge caps the effect)
amplify each shot's identity (`shots.mbt`):

- **Topspin** — spin ×`(1 + 0.6·cc)` and the cross-court target widens ×`(1 + 0.7·cc)`
  (clamped to the sideline). A **short-angle attack** triggers when the contact is high
  (≥1 m), angled (aiming sideways), and not jammed (incoming `< 22 m/s`): the landing is
  pulled toward the service line by up to `5.5·cc m` (floored at 4 m from the net) and the
  ball is driven lower and faster — a sharp dipping winner.
- **Slice** — backspin ×`(1 + 0.6·cc)` and the target extends up to `2·cc m` deeper toward
  the baseline, pinning the opponent back.

### 6.3 Contact quality (core mechanic)

Where you meet the ball determines shot quality `q ∈ [0,1]`, the product of three factors
(`shots.mbt:contact_quality`); `q` also gates the **Perfect Hit** (§6.2, `q ≥ 0.90`). The
ideal contact is the ball at **waist height (0.85 m)**, an **arm-plus-racket length to the
side (0.65 m)** (`constants.mbt:ideal_contact_h/_r`):

- **`q_dist`** — distance from that ideal side-offset. A flat "1.0" band runs from
  0.30 m out to **0.90 m** (0.65 + 0.25), then falls off to the reach limit; jamming the
  ball against the body (closer than 0.30 m) caps quality below 1.
- **`q_height`** — penalty for meeting the ball away from waist height (tolerance band
  ±0.30 m, then a falloff capped at 0.55).
- **`q_speed`** — fast incoming balls are harder: `clamp(1 − (v_in − 18)/55, 0.65, 1)`.
  Above ~18 m/s of incoming pace, poor posture starts to bite.

Reach scales with the `rea` stat — `(1.25 + 0.25·rea/100)·1.5`, i.e. **≈ 2.08–2.21 m**
across the roster (theoretical 1.875–2.25 m); the human gets +0.2 m grace.
A **whiff** (no contact, ball plays on) occurs when the ball is out of reach
(`d > reach`) or above the overhead limit (`h > 1.15 + reach`).

Low `q` widens the error model: lateral/depth aim noise and a small speed/spin jitter
all scale with `(1 + 2.2·(1 − q))`, so "hitting hard from a bad position" sprays the
ball. This is the central risk/reward dial.

### 6.4 Shot placement & aim

A per-type default landing depth (Flat 6.5 m, Topspin 8.0 m, Slice/Lob 5.5 m, pulled
slightly shorter at low `q`) is offset by the movement keys held at contact
(`shots.mbt`):

- **Left/Right** (A/D, or aim direction): up to **±2.8 m** laterally.
- **Deep/Short** (W/S): up to **±2.4 m** in depth.
- The target depth is clamped to the court (≈ 4.5–11.2 m from the net before error),
  and aim error can still push a line-seeking ball out — aiming the lines is riskier.

### 6.5 Mishit (jammed return)

A **mishit** is triggered by *poor contact quality*, not a fixed pace threshold
(`shots.mbt`): when `q < 0.3`, with probability **0.35** (0.15 with Assist on), the
return is **slowed (×0.55), stripped of spin (×0.3), and yaw-skewed** — a weak, looping
sitter. Setting up early (good posture) is how you avoid it.

### 6.6 Smash

Hitting **Flat** at a high contact (**≥ 1.7 m**) in the **forecourt** (within
`smash_forecourt = 8.5 m` of the net) becomes a **Smash** (`shots.mbt`): the launch speed
jumps to `smash_speed(pow) = (42 + 10·pow/100)·eff_pace` and is only lightly
quality-dependent (`×(0.8 + 0.2·q)`), with a flat/downward launch band (−14°…2°) to slam
the ball down — charge still adds up to +25 %. It is the finisher for high bounces and
short lobs; the same high ball at the baseline is just a weak high flat. `Stroke.smash`
drives a "SMASH!" cue.

## 7. Serve

### 7.1 Serve types

Three serves (`logic/shots/serve.mbt`, `ServeType`), each `(speed_mul, θ_min°, θ_max°)`:

| Type | speed_mul | θ band | Tactics |
|---|---|---|---|
| **Flat** | 1.00 | −6°–4° | fastest, lowest margin; primary 1st-serve weapon |
| **Slice** | 0.84 | −4°–6° | curves the receiver wide to open the court |
| **Kick** | 0.64 | 2°–14° | high net clearance, high bounce; the safe 2nd serve |

Serve type is chosen before the toss (the human can pick; the CPU plans Flat/Slice on
1st serve, Kick on 2nd). The launch speed is
`serve_flat_speed(srv) · (0.68 + 0.32·q_serve) · type_mul`, where
`serve_flat_speed = (40 + 16·srv/100) · eff_pace` (`constants.mbt`, `serve.mbt`), `q_serve`
is the toss-timing quality (§7.2), and `type_mul` is the table value above. In practice
serves land around **~15–35 m/s** — a well-tossed Boom flat (`srv = 96`, classic pace) tops
out at ≈ 35 m/s, while kick second serves and weaker servers sit much lower.

### 7.2 Serve control — the toss gauge

Serving is **toss-timing**, not a power meter (`game.js.mbt`, `host_gauge "toss"`):

1. After being placed, the server may shift laterally within the serve side for angle.
2. Press **Space** to toss. As the ball rises and falls, a **vertical toss gauge** shows
   its height; a **green band** marks the ideal contact height. You hit by timing the
   strike near the top of the toss.
3. Serve quality is `q_serve = 0.4 + 0.6·max(0, 1 − |y − contact_h| / 0.7)` — best when
   the ball is struck within **±0.15 m** of the ideal contact height (the green band),
   scaling smoothly to a 0.4 floor otherwise. (`contact_h ≈ 2.55–3.1 m`, stat-scaled.)
4. After serving, movement is briefly locked (post-serve recovery), longer for harder
   serves — fast wide serves leave you out of position.

### 7.3 Faults

A serve missing the box is a **fault**; the first fault drops you to a 2nd serve, a
second fault is a **double fault** and loses the point.

## 8. Assist System

A player-side **Assist axis**, decoupled from CPU difficulty and chosen at the title
(`logic/assist/`, default **On**):

- **Off** — classic balance.
- **On** (default) — slows the ball (`pace_factor = 0.85`, a "slow-mo approach" feel),
  and widens the human's forgiving bands: the `q_dist` outer band grows to 0.65 + 0.40 m,
  the height tolerance to ±0.45 m, the `q_speed` floor rises to 0.80, and the mishit
  chance halves (0.35 → 0.15).
- **Full** — On, plus auto-swing and gentle positioning magnetism toward the ideal
  contact spot.

The CPU is **never** eased by Assist.

## 9. AI

### 9.1 Behaviour (`logic/ai/ai.mbt`)

- The AI moves to the ball's **predicted landing point** after a reaction delay, then
  returns to a home position near the centre of its baseline when not hitting.
- It **re-reads** the prediction periodically with an error that **shrinks as the ball
  nears**, so it converges on the real landing spot.
- **Letting outs pass**: if the predicted landing is outside its own court, the AI lets
  the ball go (a hard filter on the prediction) and resets to home. *(The probabilistic,
  difficulty-scaled out-tolerance described in the original draft is not implemented — see
  Appendix A.)*
- **Shot selection** is weighted scoring over candidate targets: it favours the **open
  court** (distance from the human), penalises shots that force it to **run**, and applies
  a **per-persona style bias** (e.g. a grinder leans topspin, a slicer leans slice).

The AI does **not** currently model an explicit baseline-vs-net stance, rush the net /
volley, or run special serve-return positioning (Appendix A).

### 9.2 Difficulty

Difficulty changes **only the CPU brain**, never the character's stats
(`ai.mbt:difficulties`):

| | `pos_err` | `jitter` | `react` (s) | `speed_mul` | `serve_q` | `choice_noise` |
|---|---|---|---|---|---|---|
| **Easy** | 2.0 | 2.0 | 0.55 | 0.70 | −0.10 | 0.45 |
| **Normal** | 1.0 | 1.0 | 0.22 | 1.0 | 0.0 | 0.25 |
| **Hard** | 0.35 | 0.5 | 0.06 | 1.10 | 0.08 | 0.12 |

(`pos_err` = read accuracy, `jitter` = swing-timing variance, `react` = reaction delay,
`speed_mul` = foot speed, `serve_q` = serve-toss quality offset, `choice_noise` =
shot-selection randomness.)

### 9.3 Characters / personas

Five personas (`logic/shots/characters.mbt`), each with seven 0–100 stats
**pow / spn / slc / srv / spd / ctl / rea** (power, spin, slice, serve, speed, control,
reaction). The CPU plays with the same physics and a shot-selection bias from its
`style`. The JS UI shows these stats as bars on the persona cards.

| Persona | Archetype | pow | spn | slc | srv | spd | ctl | rea |
|---|---|---|---|---|---|---|---|---|
| **Boom** | Big Server | 85 | 45 | 50 | 96 | 55 | 58 | 88 |
| **Rojo** | Spin Grinder | 74 | 96 | 55 | 62 | 82 | 70 | 60 |
| **Dash** | Counterpuncher | 55 | 65 | 60 | 50 | 96 | 88 | 55 |
| **Sly** | Slice Specialist | 60 | 38 | 95 | 74 | 72 | 80 | 70 |
| **Ace** | All-Rounder | 74 | 72 | 70 | 74 | 74 | 74 | 70 |

## 10. Camera & Visual Hints

The camera sits just behind the human player (third-person), facing the court. Because
you can't see your own contact point from there, several on-court aids are rendered
(`src/entities/ball.js`, `src/render-host.js`, `src/ui.js`):

- **Yellow landing ring** — where the incoming ball will first bounce.
- **Trajectory dots** — the incoming path: **yellow** down to the bounce, **cyan** for
  the arc after it, with a **big orange dot** at the waist-height point of the arc (the
  ideal place to meet the ball).
- **Cyan sweet-spot ring** — the spot to stand for a clean contact.
- **Convergence / countdown ring** — shrinks as the ball approaches and turns **green**
  when your timing is right ("hit now").
- **Reach circle** — a circle on the court that is **blue** normally and turns **pink**
  (with a rising tone) when the ball enters your striking range.
- **Move-hint arrow** — points toward the sweet spot (turns into a green ◎ when you're on
  it), since it can sit behind the camera.
- **Gauges** — vertical **toss** and **height** gauges and a **timing** meter during the
  serve/strike, with coloured sweet-spot bands, plus a **charge bar** that fills while a
  stroke is held and turns red in the overcharge zone (§6.2).

## 11. UI

DOM-based, drawn by `src/ui.js`:

- **Title flow**: select **Difficulty**, **Surface** (Clay/Grass/Hard), **Persona**
  (stat-bar cards), and **Assist** level, then start.
- **Scoreboard**: games, points, both player/opponent names, a 2nd-serve indicator, and
  a tiebreak indicator.
- **In-game HUD**: a permanent compact **control guide** on the screen edge, the serve/
  strike **gauges**, and a **point-resolution banner** (e.g. "FAULT", "DOUBLE FAULT",
  "LET").
- **Match end**: Win/Loss result with the final games score, and a prompt back to the
  menu.

## 12. Audio

All sound is **synthesized at runtime with the Web Audio API** — there are no audio
files to download (`src/audio.js`).

- **Hit sound**: a compact **two-layer** synth — band-pass-filtered white noise (the
  "crack") plus a short sine "body" — scaled by impact speed and panned by the contact's
  `x` position.
- **Other SFX**: bounce, net, crowd cheer (filtered noise), out, fault, toss, and a
  reach-alert tone, all procedurally generated. The first user interaction resumes the
  AudioContext.

## 13. Strategic Design Intent (summary)

1. **Placement** — combine the shot types with left/right/deep/short aim to move the
   opponent and open the court.
2. **Risk management** — the quality system means "hitting hard from bad posture"
   self-destructs; constantly weigh aiming the lines vs. returning safely.
3. **AI vulnerability** — because the CPU honestly runs to the predicted landing point,
   moving it side-to-side and wrong-footing it work as winning tactics.
4. **Hitting point** — player position + swing timing is what governs shot quality; it is
   the heart of the game.

---

## Appendix A — Future / Not-Yet-Implemented Ideas

The original design draft envisioned a richer system. **None of the following is in the
current build** — the figures here are *proposed*, not measured from code. They are kept
for reference and possible future work.

### A.3 Situational shots
- **Volley / net play** — pre-bounce block/punch near the net: restrained power, high
  accuracy, little charge effect; lobs and passing shots as counters.
- **Fast-ball jam model** — a pace-threshold (>26 m/s) mishit weighted by shot type
  (Slice block strongest, Topspin weakest), plus **counter/redirect** speed bonuses
  (+~30 % Flat/Slice, +~12 % Topspin) for redirecting incoming pace.

### A.4 Serve power meter
- An **oscillating power meter** (triangle wave, 0→1→0, ~1.2 s period) with a release
  sweet spot `p ∈ [0.70, 0.88]` and an overpower zone, replacing the current toss gauge.
- A higher serve-speed ceiling (proposed `SERVE_SPEED_MIN 30 → MAX 56`, big-server
  ~62 m/s) and a persona `serveSpeedMul`. *(Actual serves are ~20–36 m/s — §7.1.)*

### A.5 Smarter AI
- Explicit **baseline vs. net** tactical stance per incoming ball, tuned by a per-persona
  **Net Tendency** stat; net rushing and staying forward after the rush.
- **Serve-return positioning** that bisects the wide/centre-T angle, dynamic at higher
  difficulty.
- **Probabilistic, difficulty-scaled** out-tolerance (borderline outs occasionally
  played) instead of the current hard filter.
- Explicit "player rushes net → lob/passing" and "player drops deep → drop shot" rules.

### A.6 Stats, open court & richer UI
- **Match stats** — Winners, Unforced Errors, Double Faults, average rally length,
  1st-serve %, net-point win %, and running distance, shown on an expanded match-end
  screen, plus a **Rematch** button.
- **Open-court floor highlight** (an `OPEN_COURT_ENABLED`-style toggle) — not present.
- **Radar charts** for persona stats (currently bars), a **games-to-win selector**, a
  **pause modal** (Resume/Quit with confirm), a **charge bar**, and a difficulty readout
  on the scoreboard.

### A.7 Sampled / richer audio
- **Recorded hit samples** (loaded via `decodeAudioData`, played with `BufferSource`) with
  a **5-layer synth fallback** (Body/Pock, Crack, Shimmer, String Ring, Brush), per-shot
  pitch/pan/filtering, procedural **IR reverb** (`ConvolverNode`), and a perfect-hit bell.
  *(The shipped game uses a 2-layer synth and no reverb — §12.)*
