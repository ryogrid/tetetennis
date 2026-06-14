# GAME_DESIGN — 3D Tennis Game : tetetennis

## 1. Concept

Focus on real ball behavior and tactics. Not casual game.

## 2. Rules & Match Settings

Adopts a simplified version of real-world tennis.

- **Points**: 0 → 15 → 30 → 40 → Game. 40-40 is Deuce. 
  After Deuce, it goes to Advantage → Game (No "No-Ad" scoring).
- **Match**: 1 set match ( including tiebreak)
- **Serve Right**: Alternates every game. The player serves first.
- **Serve Position**: Deuce side (right) if the total point count is even, Ad side (left) if odd. 
  Must land in the diagonally opposite service box. 2 consecutive faults result in a double fault (point lost).
- **No Court Changes** (The player is always positioned on the near side for simplicity).
- **No Lets (Net-in Serves)**: If the ball touches the net but lands in the correct box, it remains in play.
- **In/Out Judgment**: A point is lost if the struck ball does not land inside the opponent's court (within the singles lines; on the line is IN) on its first bounce. A point is also lost if the ball bounces on your own side (fails to cross the net). Allowing the ball to bounce twice results in a point lost for the receiver.

## 4. Shot System

### 4.1 Properties of the 5 Shot Types

| Type | Trajectory | Speed | Spin | After Bounce | Primary Use / Risk |
|---|---|---|---|---|---|
| Flat | Low | Fastest | None | Normal | Finishing shot. Highest risk of hitting the net or going out. |
| Topspin | High | Medium | Topspin (Dips) | High and fast | Reliable staple for rallies. Low risk. |
| Slice | Low | Slow | Backspin (Floats) | Low and skids | Buys time / disrupts rhythm. If hit too high, it gets crushed. |
| Lob | Very High | Slow | Light Topspin | Drops deep | Used to pass an opponent rushing the net. |
| Drop | Low | Slowest | Backspin | Barely bounces | Forces a baseline-hugging opponent to run forward. Easily countered if not placed well. |


### 4.3 Shot Placement

The default landing point is defined per shot type (middle-to-deep opponent court), which is then offset by the movement keys pressed at the time of impact:

- A / D: $\pm2.6m$ left/right (towards the singles lines)
- W: $2.0m$ deeper (towards baseline) / S: $2.0m$ shorter
- Target points are clamped to a 0.3m inner margin of the court lines, but quality noise can push the ball out (= higher risk when aiming for lines).

### 4.4 Charge Shot (Release Mechanism)

**Hold the shot key to build power, and hit the ball the moment you release it:**

- Charge amount $c$ builds from 0 to 1.0 over 0.8 seconds, and can increase up to a maximum of 1.25 (**Overcharge**). Power is determined by the charge amount **at the moment of release**.
- **Hit Timing**: The moment you release the charge key, you hit the ball if it is within reach. **If the ball is in the core (sweet spot) when released, it triggers a Perfect Hit** (§4.4.1). If you don't release it, a **Safety Hit** (no perfect bonus) triggers right before the ball escapes your reach so the rally continues. "Right before escaping" is evaluated on 2 axes: **moving away horizontally** (normal passing balls) or **dropping too low** (`SAFETY_DROP_Y` or lower, for lobs/smashes dropping straight down). However, **while the ball is still clearly approaching horizontally** (`closingRate > SAFETY_APPROACH_RATE`), the vertical safety won't trigger, leaving room to aim for a perfect hit (prevents premature safety hits at the edge of your reach when rushing in to take a low ball early).
  Releasing outside of reach results in a **Whiff** (0.25s charge cooldown).
- **Power**: Ball initial velocity is multiplied by `0.85 + 0.40 × min(c, 1)` (Stacks with the quality power coefficient).
- **Overcharge Risk**: If $c > 1$, an aim error of `(c − 1) × 2.8m` is added, and the net clearance margin shrinks. Going for maximum power increases out/net faults.
- **Post-Impact Stiffness**: Movement is nearly halted (12%) for 0.35 seconds immediately after hitting. You cannot unnaturally sprint smoothly through a hit.

→ Strategy: In addition to deciding between "setting up early to hit hard" and "moving till the last second for a safe return", you must read the **release timing** to catch the sweet spot. Holding it too long (Overcharge) leads to self-destruction.

#### 4.4.1 Perfect Hit / "Just Meet" (Release Timing Bonus)

**If the ball is in the core (sweet spot = hit point distance `JUST_SWEET_DIST` $\le 1.0m$) at the exact moment of release, it triggers a "Perfect Hit"**, granting a modest bonus (IMPROVEMENTS §6.1.1). Missing the sweet spot simply results in a normal hit with **no penalty** (an optional mechanic to raise the skill ceiling).

- **Input**: Charge (Hold) → **Release** the moment the ball enters the sweet spot. You can aim for it as long as the ball is in the core, but **faster balls pass through the sweet spot quicker**, naturally making it harder (aligns with §4.6 difficulty of handling fast balls). If held too long, it triggers a safety hit once it leaves the sweet spot.
- **Bonus** (Modest): Initial Speed $\times1.08$ / Aim Error $\times0.6$ (more accurate) / Spin $\times1.12$.
- **Visual/Audio**: A glowing gold-white ring and sparks appear at the contact point, the ball gets a gold halo/trail during flight, and the hit sound includes a clear bell harmonic (Audio §10 `just`). Determinism is maintained (timing-dependent only, no RNG).
- **Timing Hint**: A **Convergence Ring** is displayed at the player's feet. As the ball approaches, the outer ring shrinks, **turning gold and pulsating when in the sweet spot to indicate "Release Now"**. Time to impact is calculated via forward simulation (`BallSim.predictReach`), appearing approx. 0.6 seconds before contact.

#### 4.4.2 Topspin/Slice Charge Enhancements (Amplifying Traits)

In proportion to the normalized charge amount `cc = min(charge/CHARGE_MAX, 1)`, the defining characteristics of Topspin and Slice are amplified (effect maxes out at full charge; overcharge caps at cc=1. Flat only boosts speed). This replicates how "heavy topspin" or "deep slice" works in real tennis.

**Topspin (Charge boosts "Dipping, Sharp Angles, and Short-Angle Attacks")**
- **Spin ↑**: `spinScalar = 260 × (1 + TOPSPIN_CHARGE_SPIN_GAIN·cc)` (Gain=0.6, $\times1.6$ at full charge). Stronger Magnus effect causes extreme dipping, landing shorter for the same net clearance.
- **Lateral Angle ↑**: Lateral offset of landing target expands by `×(1 + TOPSPIN_CHARGE_ANGLE·cc)` (Gain=0.7), clamped at sidelines. Depth (z) is unchanged. More charge allows for extreme cross-court angles.
- **"Short-Angle Attack" pulling the target to the center (only under good conditions)**:
  - Pull amount `pull = TOPSPIN_ATTACK_SHORTEN(5.5m) × cc × heightCond × paceOk × angleFrac`.
    - `heightCond`: 1 if hit point is high enough.
    - `paceOk`: 1 if not jammed by incoming pace.
    - `angleFrac`: 1 if aiming laterally.
  - Pulls `target.z` closer to the net by `pull` (landing near the service line). Clamped by `TOPSPIN_ATTACK_MIN_DEPTH` (4.0m from net) to avoid netting.
  - If conditions are bad (low point/jammed), hitting center, or uncharged, pull $\approx 0$, keeping the default deep target.
- **Triggers Low & Fast Drive only when Short-Angle Attack succeeds** (`pull >= 1.0m`):
  - Switches to the speed-prioritized drive solver (like Flat shots). Initial speed is scaled but not quite as fast as Flat.
  - Shaves net margin by `×(1 − TOPSPIN_CHARGE_NETLOW·cc)` (Gain=0.7) to keep the ball low.
  - If pull < 1.0m, uses standard converging solver for stable rally arcs, merely flattening the apex slightly.
- **Bounce ↑**: Spin component in the forward direction adds to vertical velocity upon bounce. Heavy balls kick up high, forcing high hit points for opponents (Real tennis "kick"). Does not affect slices.

**Slice (Charge boosts "Deep floating and Low skidding")**
- **Backspin ↑**: `spinScalar = -180 × (1 + 0.6·cc)` ($\times1.6$ at full charge). Hang time increases, flying deeper, then stalling and skidding low upon bouncing.
- **Depth ↑**: Extends target towards baseline by `2.0m × cc` (clamped inside court). Keeps the opponent pinned to the baseline to buy time for repositioning.

→ Strategic Breadth: No charge or light charge yields neutral balls (connecting/repositioning), while full charge maximizes each shot's strengths for high-quality plays.

### 4.5 Impact of Hit Point, Court Position, and Ball Pace (Core Strategy)

"Where, how high, and with what pace you hit" drastically alters the shot. Contextual modifiers apply to the base shots (§4.1), meaning **just hitting the ball back won't be stable; contextual decision-making is required**.

Leverage `lev = clamp((h−0.9)/0.9, −1, +1)` is derived from hit point height `h` (Low=negative, Normal=0, High=positive). Position is depth from net `depth = |hitPos.z|`, "Forecourt" is `< service line (6.4m)`. Incoming ball pace is `vIn`.

- **Smash (High Point × Forecourt × Flat)**: Hitting Flat at a high point ($\ge 1.7m$) in the forecourt (within 8.5m of net) becomes a **Smash**. Massive speed boost (Base 42 m/s, up to +45% via charge) to slam it downward. Less affected by low quality. → A finisher for high bounces or short lobs. Deep at the baseline, it's just a high flat shot.
- **Power at Low Hit Points risks Out/Net**: Strongly hitting a low ball (lev < 0) means you must lift it, but the added power pushes it **too deep, highly risking an Out**, or if Flat, catching the Net. Amplified in the forecourt (less court behind). → Safe returns with Topspin/Slice are correct for low balls.
- **Topspin at High Hit Points can create Sharp Angles**: Topspin on high balls (lev > 0) widens lateral aim by up to +85% and adds spin to dip it, enabling **sharp cross-court angle shots**.
- **Forecourt Flat Depth Risk**: Smashing a Flat shot from low-mid heights while rushed forward easily goes Out due to the short court length left. Requires hitting high (smashing), angling, or easing pace to attack safely.
- **Incoming Ball Pace**:
  - **Counter/Redirect**: Meeting fast balls with Flat/Slice uses the opponent's pace, returning faster than your own effort (approx +30% speed boost. Topspin gets ~12%).
  - **Fast Ball Control Difficulty**: If `vIn` exceeds 17 m/s, poor posture (low quality) severely disrupts aiming. Running and swinging hard at fast balls causes self-destruction.
  - **Pace Absorption Difficulty**: Touch shots (Drop/Lob) are hard to execute from fast balls (higher error) and succeed best against slow balls.

→ Design Intent: These stack smoothly, so normal baseline rallies (mid height, mid pace) remain stable, but **extreme situations (near net, high/low points, fast pace, on the run) yield drastically different results**. You must constantly judge "when to rush the net," "how to use high balls," and "whether to counter or absorb fast balls."

### 4.6 Returning Fast Balls (Jammed / Mishit)

Fast balls, such as smashes, are **hard to catch in the core and hit cleanly**, even if you reach them. If preparation (charge) is low, you get **jammed**, resulting in a **weak, looping return (a sitter or chance ball)**. This gives tactical value to smashes (hitting harder forces weaker returns).

Based on real tennis theory, shot types handle fast pace differently:

- **Slice (Block) is the strongest**: Short backswing uses the incoming pace. Pro staple for fast serve returns. Skids low on return.
- **Flat is intermediate**: Can counter the pace but requires strict timing.
- **Topspin is the weakest**: Requires a full swing and precise timing, making it the most prone to breaking down against fast balls (unless **adequately prepared via charging**, allowing for fierce returns).
- Touch shots (Lob/Drop) are the hardest against fast balls.

The Jammed/Mishit degree `mishit` (0 to 1) is determined by "how much the ball exceeds the threshold (26 m/s) × Shot type weakness × (1 − preparation from charging) × Posture (Quality)". Higher `mishit` means the return is **slower, higher, and shorter** (a sitter) with lost spin. Charging and blocking with Slice handles pace, while lazily tapping Topspin results in a floating perfect setup for the opponent.

→ Tactics: Hitting smashes from the front will likely jam the opponent into a weak return, setting up a winning shot. Conversely, when facing hard shots, **charging early and blocking with Slice** is safe. Normal rally speeds (up to ~25 m/s) do not trigger mishits.

### 4.7 Net Play (Volley)

Hitting the ball before it bounces near the net (forecourt) with Flat/Slice results in a **Volley**. 
It is a **block/punch** without a full follow-through, meaning power is restrained but **aim is highly accurate**, and charging has little effect. It is a means to **accurately finish** weak balls by rushing forward, separate from baseline power shots.
- High hit point ($\ge 1.7m$) forecourt Flats prioritize **Smashes** (§4.5).
- Against a volleyer, **Lobs** (over the head) or **Passing Shots** (down the line/sharp cross) are effective — it becomes a mind game of risk vs reward for rushing the net. AI Personas also dictate net rushing (§7.1).

## 5. Serve

### 5.1 Serve Types

Besides direction (A/D), you can **select the serve type** (J/K/L before serving. Default: Flat). Replicates the 3 major serves in tennis:

| Type     | Speed   | Spin             | Bounce                     | Characteristics & Tactics                                                                 |
| -------- | ------- | ---------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| Flat     | Fastest | Almost None      | Low, Straight              | Fastest but minimal margin of error. Primary 1st serve weapon.                            |
| Slice    | Medium  | Sidespin         | Skids low, curves sideways | Forces opponent wide to open the court. Safer.                                            |
| Top Spon | Slow    | Heavy Top + Side | High, kicking up           | High net clearance, very safe. Kicks high to push opponent back/up. Staple for 2nd serve. |

→ Tactics: Go aggressive on the 1st serve (Flat/Slice), and if faulted, play it safe on the 2nd serve (Kick). Because Kick serves bounce high, opponents are forced to hit at a high point, potentially jamming them or ruining their posture.

### 5.2 Serve Controls & Power

1. After being placed at the default serve position, **you can move laterally within the serve side's boundaries** ($x$: $\pm0.25m$ from center mark to singles line, $z$: 0.2 to 2.5m behind baseline). Allows mind games like shifting wide for angles. Pressing `Space` starts the oscillating power meter (0→1→0, 1.2s period triangle wave). Cannot move while meter is active.
2. The value $p$ exactly at the moment of release determines power. A/D selects left/right within the service box.
3. Judgment:
   - `p ∈ [0.70, 0.88]` — Sweet spot. Fast and accurate.
   - `p > 0.88` — Overpower. Fast but highly inaccurate, high fault rate.
   - `p < 0.70` — Speed and error scale proportionally (safe but slow).
4. Controls are identical for the 2nd serve after a fault. Double fault loses the point.

**Ball Speed**: Initial speed maps `SERVE_SPEED_MIN (30)` to `MAX (56)` based on power, multiplied by shot type modifier (Flat=1.0 / Slice=0.9 / Kick=0.8) and Persona's `serveSpeedMul` (max ~1.12). A Big Server's top serve hits ~62 m/s ($\approx 226$ km/h), **making returns extremely difficult if the direction isn't read**.

**Post-Serve Stiffness (Risk)**: Immediately after serving, movement drops drastically (`SWING_LOCK_MOVE_FACTOR`) for a duration based on power (`SERVE_RECOVERY_MIN + SERVE_RECOVERY_GAIN·power`). **Harder serves entail longer stiffness** (~0.75s for top serve). Hitting the fastest serve from the absolute edge means **you cannot recover position, making good returns an easy Return Ace**.

→ Strategy: Risk/reward between 1st and 2nd serves, plus the risk that **serving "faster and wider" leaves you wide open**. Balance speed, placement, and recovery rather than always spamming top-speed wide serves.

### 6.3 Open Court

Making the AI run left and right out of the center works because the AI moves honestly to the predicted landing point. Hitting to the vacated side will score a winner. Total running distance is tracked in the post-match stats.
*Note: The floor highlight visual for open courts has been **disabled** for being too visually noisy (`OPEN_COURT_ENABLED` ).*

## 7. AI

### 7.1 Behavior Model

- During rallies, the AI moves to the ball's **predicted landing point** (after a reaction delay). When not hitting, it returns to a home position (near the center of the baseline).
- **Tactical Stance (Baseline / Net)**: Evaluates per incoming shot whether to "stay back (baseline)" or "rush the net (net)". **Defaults to baseline rallies. Only rushes forward on short (chance) balls.** The decision compares the **Chance Amount** (+ if landing near net, - if fast pace) against a **required threshold based on the Persona's Net Tendency**. Net-players rush on slight chances; Grinders stay back almost entirely.
  - **Baseline**: AI positions itself **deeper (further from the net) than the landing point**, hitting the ball as it rises or at its apex after bouncing. Prevents AI from standing exactly at the landing spot and hitting weak low-bounce returns.
  - **Net**: AI steps **forward (closer to the net) of the landing point**, attempting to hit it before it bounces (Volley). Taking the ball high in the front court leads to finishers (Smash/Power shot). After rushing, the AI stays forward rather than resetting to the baseline.
  - Net tendency is **tuned by Persona archetype** (Serve & Volley / All-Court rush often; Grinder / Counter hold the baseline). Matches feel entirely different based on persona, even on the same difficulty.
- **Letting Outs Pass**: If the predicted landing point is outside its own court, the AI lets it pass. Obvious outs (>0.6m outside line) are highly likely to be ignored; borderline outs are ignored based on probability. Higher difficulties judge outs more accurately (Hard will almost always ignore obvious outs). Balls landing inside are always played. The AI returns to the home position immediately upon deciding to let it pass.
- **Serve Return Positioning**: When receiving, the AI reads the player's serving stance and shifts to an optimal return spot (bisecting the angle between a Wide and Center-T serve). Higher difficulties shift dynamically and accurately; lower difficulties stay in a static default spot.
- Shot selection is evaluated via weighted scoring:
  - **Open Court**: Aim for the side furthest from the player (Core logic).
  - **Posture**: Play safe (Topspin/Slice/Lob) if forced on the run.
  - **Player rushes net**: Hit Lobs or Passing shots.
  - **Player drops deep**: Hit Drop shots.
- Quality systems also is also applied to AI

#### Timing Hint (Convergence Ring) Display

The Timing Hint (Convergence Ring) for Perfect Hits is **permanently displayed only on Easy / Normal**.

## 9. UI

- **Title Screen**: Difficulty select, Games-to-win select, Player/Opponent Persona select (Radar charts), Start Button. Controls are not shown here, but permanently displayed on the screen edge during play.
- **Pause Screen**: Press Esc during play to trigger physical pause. Two buttons: "Resume" (or Esc) / "Quit Game" (Return to title). Includes a mouse-click confirmation to prevent accidental quitting.
- **Scoreboard**: Shows current games, points, both players' Persona names, and Difficulty.
- **HUD** (During Gameplay) — Uses large fonts for readability:
  - Top Center: Scoreboard (Games + Points, Serve indicator).
  - **Permanent Control Guide on Screen Edge** (Compact key list on a translucent panel that doesn't obstruct play).
  - Charge Bar (Only visible while charging. Overcharge zone is colored red for danger).
  - Serve Meter: Power meter with colored sweet spots.
  - Point Resolution Banner (Includes reason: "Winner!", "Out", "Net", "Double Fault").
- **Match End Screen**: Win/Loss result, expanded stats (Winners, Unforced Errors, Double Faults, Avg Rally Length, 1st Serve %, Net Point Win %, Running Distance), Rematch / Return to Title buttons.

## 10. Audio

Bounce sounds, net sounds, point-resolution crowd cheers (filtered noise), and UI clicks are synthesized via WebAudio (no external files). **Only the ball hit sound uses actual recorded audio samples.** The first user interaction resumes the AudioContext.

**Hit Sounds**:
- **Uses actual recorded audio samples** (Sound Effect Lab "Hitting with a Tennis Racket"). Sound files bundled with the build are loaded via `decodeAudioData` and played via `BufferSource`. Synthesized sounds couldn't capture the realistic "feel" of hitting, hence the switch to real samples (Sources/Licenses in `README.md` / `src/audio/samples/CREDITS.md`).
- Differentiates shot types using **playbackRate (pitch), volume, stereo panning, and filters** (Constants `HIT_SAMPLE_*`): Flat = Baseline, Slice = Higher pitch, Lob/Drop = Lower pitch, Serve = Heavy/low, Jammed (Mishit) = Rate drop + low-pass filter for a dull "thud". Harder hits are slightly higher and sharper. Panning based on hit coordinate `x`. Slight random pitch variation every hit to remove repetitiveness. Uses round-robin for multiple samples.
- **Falls back to WebAudio synthesis (`playHitSynth`) if samples fail to load or are missing** (5-layer synth below). The game remains fully playable without the audio assets.

**(Fallback) Synthesized Hit Sound Design** (Constants `HIT_SOUND_PARAMS`/`SFX_*`).
Replicates the acoustic properties of a real tennis hit (Research: Fundamental/Body at 100~1800Hz, Harmonics at 1800~2800Hz, extremely short/sharp impact. Depth = Lows / Crispness = Highs + Sharp attack = "POCK!") using 5-layer synthesis:
- **① Body (Pock)**: Triangle wave rapidly dropping from a high frequency down to `bodyHz`. Provides the tonal core/punch of the hit.
- **② Crack (Attack)**: Sharp bright high-pass noise for the initial crisp "pop".
- **③ Shimmer**: Bandpass noise in the 1.8~2.8kHz range for high-end sparkle (crispness).
- **④ String Ring**: High-Q bandpass noise at `bodyHz` for a short tail. Center frequency sweeps up for Topspin (brushing up) or down for Slice (cutting down).
- **⑤ Brush/Scrape Noise**: Adds a scraping feel for spin shots.
- Tonal changes per shot: Flat = Sharp "Thwack", Topspin = Brushed pop, Slice = Thin skidding sound, Lob = Soft, Drop = Barely touching.
- Shared satisfying elements: **Scales with intensity** (Brightens/sharpens Body/Shimmer/Crack frequencies), **Stereo Panning** via `x` pos, slight **Pitch Jitter** every hit, and **Procedural IR reverb** (ConvolverNode). Serves boost the Flat profile, Perfect Hits add a clear bell harmonic, and Jammed hits get a dull, noise-heavy "thud".

## 11. Strategic Design Intent (Summary)

1. **Shot Placement**: Combining 5 shot types with left/right/deep/short placement to move the opponent and open the court.
2. **Risk Management**: Due to the Quality system, "hitting hard from a bad posture" results in self-destruction. Players constantly weigh the risk of aiming for the lines versus returning safely.
3. **AI Vulnerabilities**: Because the AI honestly runs to the predicted landing point, real tennis theories—like running them side-to-side, catching them wrong-footed, or utilizing drop/lob combinations—function directly as winning strategies.
4. **Hitting Point** ( player position and shot button release timing ):shot quality depend on almost this!
