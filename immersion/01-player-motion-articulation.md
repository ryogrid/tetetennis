# 01 — Player Motion: Articulation, Kinetic Chain & Footwork

The player character is the thing the eye watches most, and right now it reads as a
stick that waves a racket rather than an athlete hitting a ball. This is the user's
explicitly-flagged issue. This document covers making the *body itself* move like a
tennis player; the companion `02-motion-capture-data-pipeline.md` covers where the
reference motion comes from and how to fold it in.

## The current rig, precisely

`src/entities/player.js` is a 100% procedural rig — no glTF, no skinned mesh, no
`AnimationMixer`, no mocap:

- `buildRig(color)` (`player.js:23-117`) assembles cylinders/spheres into **10 joint
  Groups**: `hips`, `shoulderR/L`, `elbowR/L`, `racket`, `hipR/L`, `kneeR/L`. The
  racket is a **rigid child of `elbowR`** (`player.js:74`); the torso, head, and both
  shoulders are **rigid children of `hips`**. **Missing: wrist, spine/chest, neck,
  ankles, feet.**
- Each stroke is a hand-authored pose function — `fhFlatPose`, `fhTopspinPose`,
  `bhSlicePose`, `servePose`, `smashPose`, `volleyPose` (`player.js:143-469`) — returning
  per-joint Euler triples plus `kneeBend` and `baseY`, interpolated by `kf()`
  (`player.js:120`). Contact is at a **fixed** normalized time `n=0.4` for strokes
  (`n≈0.62` for the serve).
- `updateVisual(dt)` (`player.js:548-640`) builds a base ready stance, overlays the
  active pose, low-pass smooths into `this._sm` (τ≈54 ms), then **adds** a running
  stride: `Math.sin(runPhase)` hip/knee pump with `runPhase += dt*(4 + sp*2.2)`
  (`player.js:544,631-639`).

Three structural consequences read as "not real tennis": (a) `hips.yaw` rotates the
*entire* upper body as one rigid block, so there is **zero hip–shoulder separation**;
(b) the racket can never **lag and whip** because it is welded to the elbow; (c) the
swing animates toward a *canned pose*, so the racket visibly misses the actual ball
when the player is even slightly out of position. And the feet **skate**, because the
stride is driven by time, not by distance travelled.

> **Determinism note (verified).** This entire system is cosmetic. MoonBit runs its own
> swing clock (`swing_contact_t = 0.18`, `swing_dur = 0.45` in `logic/game/game.js.mbt`);
> the JS rig runs an independent clock that *agrees by construction* (`0.18/0.45 = 0.40`)
> and is **never read back into logic**. Everything in this document flows logic → render
> only, so none of it can affect simulation determinism.

---

## 1.1 Add the missing joints (richer articulation)

**Problem.** With no wrist, spine, neck, or ankles, the rig physically cannot express
the motions that define tennis: the trunk coil, the racket-head lag, eyes-on-contact,
and a planted foot.

**Proposal.** Add four joints, in priority order. Keep the change **backward-compatible**:
new pose keys are optional with sensible defaults, so the existing 8 pose functions keep
rendering unchanged until they are individually re-tuned.

| Joint | Where in `buildRig` | New pose key | Why it matters | Cost |
|-------|---------------------|--------------|----------------|------|
| **`wristR`** | a Group between `elbowR` and `racket`; reparent the racket onto it (`player.js:72-89`) | `wristR:[p,y,r]` | Enables **racket-head lag** and the **serve pronation snap** — the single most "pro" detail. Also the end-effector the IK (1.4) drives. | Low: one Group, reparent racket (1 line) |
| **`chest`** | a Group between `hips` and the upper body; reparent torso/head/shoulders/neck onto it | `chest:[p,y,r]` | Unlocks **hip–shoulder separation (X-factor)** — today impossible because `hips.yaw` turns everything rigidly. | Med: reparenting + split the coil values |
| **`neck`** | a Group above `chest`; reparent the head | (auto) | Head **tracks the ball** (`getBall()`) and chin-tucks on the serve — strong realism cue for *zero* per-stroke authoring. | Low: one Group, auto-aimed |
| **`ankleR/L`** + foot meshes | below each `knee` (`player.js:98-104`) | `ankleR/L:[p,..]` | Believable split-step/plant and, critically, **kills foot-slide** (the shin angles while the foot stays flat). | Med: 2 Groups + 2 foot meshes |

**Skip** scapula/clavicle and finger/grip joints: at the 12–24 m viewing distance the
rig is always seen from (the comment at `player.js:55-56` notes this), they cost
authoring for no visible gain.

**Schema/defaulting.** Extend the `t` target map and the swing-overlay block in
`updateVisual` (`player.js:560-596`); the existing smoothing loop already iterates
`Object.keys(t)` (`player.js:618`), so new joints are smoothed automatically once added
to `t`. Default behavior when a pose omits a key:

- `chest` omitted → **derive it by splitting the existing coil**: `chest.yaw =
  hips.yaw * 0.45` (shoulders lead the hips) and scale `hips.yaw` down proportionally.
  Every existing stroke instantly gains X-factor from one shared default; then hand-tune
  the high-value strokes (serve, FH topspin, BH topspin).
- `wristR` omitted → neutral; migrate the existing `racket`-roll snap into `wristR` for
  the strokes where lag matters (serve pronation, FH topspin).
- `neck` → always the auto-track value; never authored per stroke.

**Implementation pointers.** `buildRig()` (`player.js:23-117`, ~25 new lines);
`updateVisual()` (`player.js:548-640`); optional incremental re-tuning of the 8 pose
functions.

**Effort / Impact.** Med / High — this is the foundation everything else in this doc
builds on.

**Risks.** Reparenting the racket onto a new `wristR` means the **two-handed backhand**
left hand must now track the *wrist*, not the elbow, or the grip visibly separates
(see 1.5). Keep the additive-default approach so a half-finished migration never breaks
rendering.

---

## 1.2 Kinetic-chain sequencing (ground-up, proximal → distal)

**Problem.** Real strokes fire as a sequenced chain — leg drive → hip rotation → trunk
rotation (unwinding the X-factor) → shoulder → elbow → wrist snap → racket-head whip,
each segment peaking *slightly after* the one below it. The current poses peak all
segments at roughly the same instant, which reads as a stiff, all-at-once swat.

**Proposal.** Encode the sequence as **per-joint peak-time offsets**, all anchored to
the existing contact at `n=0.4`:

```
legs/knee extension peak  ≈ n=0.30
hip yaw peak              ≈ n=0.34
chest yaw peak            ≈ n=0.37   (the lag behind the hips IS the X-factor)
shoulder peak             ≈ n=0.39
elbow extension           ≈ n=0.40
wrist / racket-head whip  ≈ n=0.42–0.45   (arrives AFTER the arm — racket-head lag)
```

Mechanically this is just choosing the inner `times[]` arrays of each joint's `kf()`
call so peak indices step in that order — **no new runtime machinery**, it is authoring
discipline over the data the system already consumes. Add a small helper so authors set
"peak time + amplitude" instead of hand-aligning raw arrays:

```js
// peak at time `peak`, resting at `rest`, reaching `amp` at the peak
function peakAt(n, peak, rest, amp) {
  return kf(n, [0, peak, 1], [rest, amp, rest]);
}
```

The **racket-head lag** specifically becomes *possible only once `wristR` exists* (1.1):
the wrist holds a laid-back angle through the backswing and snaps through just after the
arm's peak.

**Implementation pointers.** The pose functions in `player.js:143-469`; add `peakAt`
near `kf()` (`player.js:120`). Start with the serve, FH topspin, and BH topspin.

**Effort / Impact.** Med / High — turns a swat into a stroke.

**Risks.** Over-staggering looks rubbery; keep distal lags small (a few frames). The
low-pass smoothing (`player.js:616`) already softens transitions — don't double-smooth
the lag away.

---

## 1.3 Footwork: split-step, stance, recovery, slide

**Problem.** The player only ever runs (sinusoidal stride) or stands. Real tennis is
defined by its footwork — the split-step hop as the opponent strikes, loading into an
open or closed stance, recovery steps back to position, and the clay slide.

**Proposal.** All of this is cosmetic and reads only data the rig already has
(`this.vel`, `this.swing.fh`, opponent swing events, surface id):

| Element | Fit | Recommendation |
|---------|-----|----------------|
| **Split-step** on the opponent's contact | A short hop (small `baseY` dip-then-rise + knee load) triggered when the *other* side fires. The trigger already exists: `host_start_swing(side,…)` (`render-host.js:78`) is called for the opponent. | **Do first** — best value/cost in footwork; pure JS event fan-out |
| **Open / closed stance** | Pick stance from `fh` + lateral-velocity sign at swing start (data already in the rig). Adjust hip/foot yaw in the base stance. | **Do** — cheap |
| **Recovery steps** | Approximate via the existing stride as MoonBit drives the player back to center; a cross-step flourish is extra authoring. | Optional / later |
| **Clay slide** | Needs surface awareness (`surfaceId` is in `render-host.js:19`, pass it to the rig), deceleration detection (from `vel` delta), suppressing the stride, and planting a sliding foot. | Phase 3, **surface-gated** — high payoff on clay, trickiest to keep from looking janky |

**Implementation pointers.** Add a split-step listener where the opponent's swing is
dispatched (`render-host.js:78-81`); stance/slide logic in the rig's `tick`/`updateVisual`
(`player.js:534-640`); surface piped from `render-host.js`.

**Effort / Impact.** Med / Med–High — footwork is a large fraction of "looks like real
tennis."

**Risks.** All cosmetic, zero determinism impact. The slide must not desync from the
MoonBit-driven position — slide is a *visual* foot plant while `root.position` still
follows logic.

---

## 1.4 Contact-point IK (the racket meets the *real* ball)

**Problem.** The swing animates toward a fixed pose, so when the player is slightly out
of position the racket visibly swings through empty air while the ball is "hit" anyway.
This is both unrealistic and incoherent with the gameplay.

**Proposal.** A lightweight **analytic 2-bone IK** (shoulder → elbow → wrist) blended
only over the contact window, so the stylized swing is preserved everywhere else but the
racket actually reaches the ball at contact:

1. When `swing` is active and `n ∈ [~0.30, ~0.50]`, take the desired contact point `P` =
   the ball's world position from `getBall()` (`render-host.js:111`), transformed into
   the rig's local frame and clamped to arm reach.
2. The shoulder world position `S` and limb lengths (`L1≈0.28` upper arm, `L2≈0.26+racket`
   forearm) are known from `buildRig`.
3. Law-of-cosines 2-bone IK: solve elbow flexion from `|P−S|`, aim the shoulder so the
   chain points at `P`, taking the **swing-plane normal from the stylized pose** (so a
   topspin still swings low-to-high, a slice high-to-low — IK corrects only the
   *endpoint*, not the *style*).
4. Blend `finalPose = lerp(stylizedPose, ikPose, w)` with `w = smoothstep` peaking at
   `n=0.4`, zero at the window edges. Away from contact, `w=0` → byte-identical to today.

**Crucially, this needs ZERO new FFI**: the rig already receives the live ball position
every frame via `setBall` → `getBall()`. Timing already aligns (contact at `n=0.4` both
sides). For *exact* endpoints on volleys/mishits you may optionally add one output-only
signal carrying the contact coordinates `attempt_contact` already computes:

```
host_contact_point(side, x, y, z)   // ~6 lines, mirrors host_start_swing
```

— read-only into the rig, latched for the contact window, never fed back to logic.
**Recommendation: ship the zero-FFI version first**; add the signal only if edge cases
look off.

**Implementation pointers.** New IK block in `updateVisual` (`player.js:573-596`); reads
`getBall()` from `render-host.js:111`. Optional FFI mirrors `host_start_swing`
(`logic/ffi/host.js.mbt:100`) + `render-host.js:78`.

**Effort / Impact.** Med / High — fixes realism *and* gameplay-visual coherence at once.

**Risks.** Clamp `P` to reach so the IK never over-extends into a broken pose. Keep a
regression check: with `w=0`, output must match today exactly.

---

## 1.5 Pitfalls & verification

- **Foot-slide is the #1 realism killer.** The stride is time-driven
  (`runPhase += dt*(4 + sp*2.2)`, `player.js:544`), not phase-locked to ground distance,
  so feet skate — and *more* articulation makes the skate *more* obvious, not less. Fix:
  drive the stride phase by **distance travelled** (`runPhase += distance / strideLength`)
  and add **ankle foot-plant** (pin the stance foot's world XZ while it is planted). This
  is the main reason to add ankles (1.1).
- **Handedness is hard-coded right.** The racket is on `elbowR` and the loops are
  `for (side of ['R','L'])` (`player.js:57,92`). All reference data must be normalized to
  right-handed before transcription, or add a mirror flag. Left-handed players are out of
  scope unless a mirror is added — state this explicitly.
- **Two-handed backhand.** Already modeled by tracking the left arm to the right
  (`bhFlatPose` etc., `player.js:245-299`). After 1.1, the left hand must track the new
  **wrist**, not the elbow, or the grip separates. Keep the one-handed slice (left arm
  releases) as-is (`bhSlicePose`, `player.js:301`).
- **Serve toss.** The toss is faked via `shoulderL` pitch (`servePose`, `player.js:370`);
  the physics ball is not the toss until contact. A left-hand release near the apex (and
  an optional cosmetic toss-ball visual) improves realism — keep it strictly cosmetic so
  it is never confused with the MoonBit ball. Serve contact height (2.55–3.1 m, from
  `logic/physics/constants.mbt`) is exactly where the IK should reach.

**Verification.**
1. A free-orbit debug camera to inspect the rig from the side — X-factor and racket lag
   are invisible in the default first-person framing.
2. A practice-mode loop firing each shot type repeatedly; eyeball foot-skate,
   contact-point reach, and sequencing.
3. Side-by-side slow-mo of the rig vs. the reference video used for authoring (`02`).
4. Confirm the racket visibly intersects the ball at contact across a range of ball
   heights/positions (the whole point of 1.4).
5. **Regression:** with the IK blend `w=0` and no new joints authored, output must be
   identical to today's poses.

---

## Phased roadmap

- **Phase 1 (no data needed, all upside):** add `wristR` + `chest` (+ auto `neck`);
  extend `updateVisual`; introduce `peakAt` and re-time the serve / FH-topspin /
  BH-topspin for explicit sequencing + wrist lag; split `hips.yaw` into hips+chest.
- **Phase 2 (coherence):** contact-point IK aiming at `getBall()` (zero FFI); optional
  `host_contact_point` for exact endpoints.
- **Phase 3 (polish):** split-step on the opponent's swing; open/closed stance; ankles +
  feet to kill the skate; surface-gated clay slide.
- **Phase 4 (fidelity):** infuse real motion data into the Phase-1 pose functions — see
  `02-motion-capture-data-pipeline.md`. (No code changes, just better keyframe values.)
