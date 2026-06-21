# 02 — Motion Data: Obtaining Pro Tennis Motion & Reflecting It In-Game

`01-player-motion-articulation.md` makes the rig *able* to move realistically. This
document answers the two questions the user asked directly: **how do we obtain real
professional-tennis body-movement data, and how do we reflect it into the in-game
motion?** It is deliberately pragmatic about a project that ships as a tiny,
all-procedural, offline PWA.

The short version: **distill real-motion *numbers* into the keyframe pose functions we
already have** (`player.js`'s `fhTopspinPose` etc.), using biomechanics literature as a
zero-risk backbone and your own slow-motion video where literature isn't enough. Do
*not* ship mocap clips and a skinned character — that breaks the offline-PWA property
for fidelity the viewing distance can't show.

---

## Part A — Obtaining the data

Five acquisition options, rated on effort, licensing/legal risk, fidelity, and PWA
asset-size impact. The recommended mix is **D1 + (D3 or D4 on your own footage)**.

### D1 — Biomechanics & sports-science literature (the backbone)

Published studies quantify exactly what the keyframe system needs: joint-angle and
angular-velocity time-series, segment **peak-velocity sequencing** (proximal→distal
timing), **hip–shoulder separation (X-factor)** in degrees, knee-flexion at the serve
trophy, racket-arm pronation timing, and contact timing relative to the swing. You read
the numbers and hand-author them into `kf()` arrays.

- **Effort:** Low–Med (reading + transcribing).
- **Legal risk:** **None meaningful.** Measurements and timings are *facts*, not
  copyrightable expression.
- **Fidelity:** Med–High for *timing/angles* (you supply the styling).
- **PWA asset cost:** **Zero** — the output is just numbers baked into JS source.

This alone gets the kinetic-chain sequencing in `01` from "plausible" to "correct," at
no legal or download cost. Make it the backbone.

### D2 — Public motion-capture datasets

Reality check on what actually exists and is usable:

- **CMU Graphics Lab Motion Capture Database** — free for any use (permissive). Contains
  some racquet-sport / swing motions, but **little clean tennis**. The one "free mocap"
  you can lean on, mainly for generic athletic movement (split-step, run, recovery).
- **AMASS / SMPL** — aggregates many datasets into a common body model, but the **SMPL
  body model carries a research-only / non-commercial license**. For a *shipped* game
  this is a real risk — **treat AMASS/SMPL as blocked** unless you separately clear it.
  (Per-dataset licenses *inside* AMASS also vary.)
- **Tennis-specific academic mocap** — exists mostly behind papers and is generally
  **not redistributable**.

- **Effort:** Med (find, retarget). **Risk:** mixed — CMU low, AMASS/SMPL
  commercial-use risk. **Fidelity:** High (real human motion). **Asset cost:** zero if
  used *offline* to author keyframes (Path 1 below); non-zero if shipped as a clip.

### D3 — Markerless pose estimation from video (offline authoring only)

Run pose estimation over slow-motion tennis footage to extract 3D joint trajectories,
then clean and transcribe them. **This is an authoring-time pipeline, never a runtime
dependency.** The **default input should be your own footage** — film a local club
player (or yourself) hitting in slow-motion on a phone. That is the only fully-clean
source and it changes who does what: *someone has to go shoot tennis video*. Broadcast or
YouTube clips of pros are copyrighted footage and are exactly the risk this option's
caveat warns about — treat them as reference for *timing*, not as a frame-by-frame source.

- **2D keypoints:** MediaPipe Pose, OpenPose.
- **3D / monocular human-mesh recovery:** HMR2.0 / 4D-Humans, VIBE, MotionBERT, WHAM.
- Pipeline: shoot your own slow-mo → run estimator → clean (foot-skate, jitter, depth
  ambiguity) → retarget → sample at the key phases → fill the pose arrays.

- **Effort:** Med–High (filming + pipeline setup + cleanup). **Risk:** *the source
  footage matters, not the tool* — own footage = clean; pro broadcast footage = risk.
  **Fidelity:** High but noisy. **Asset cost:** zero (authoring only).

### D4 — Manual rotoscoping from slow-motion reference

Animate by hand against frame-stepped reference video. Tedious but simple and reliable,
and at our viewing distance a careful eye is "good enough."

- **Effort:** Med. **Risk:** same footage caveat as D3 (own footage = safest).
  **Fidelity:** Med (as good as the author). **Asset cost:** zero.

### D5 — Paid / own mocap capture *(de-scoped)*

Renting a mocap suit/studio yields the cleanest, fully-owned data, but the cost is
disproportionate for a stick figure seen at 12–24 m. Mention and de-scope.

### Licensing caveat (put this verbatim-in-intent in any task that touches footage)

> Generic biomechanical timing and joint angles — how fast a trunk rotates, when the
> wrist snaps relative to contact, how many degrees of hip–shoulder separation — are
> **facts and free to use**. A **specific broadcast clip**, or a **mocap/recognizable
> likeness of a named player's signature motion**, is **protected**. Do not copy a clip
> frame-for-frame or reproduce an identifiable player's signature motion. The safe path
> is to **extract the numbers/timing and re-author them in our own stylized rig.** Use
> your own slow-motion video to eliminate the question entirely.

**Recommended acquisition mix:** D1 for the whole skeleton of timings/angles (zero
risk, zero asset cost) + D3/D4 on your own or clearly-licensed slow-mo for the few
signature motions (serve, FH topspin) where literature numbers run out. **Avoid
AMASS/SMPL for anything shipped.** Lean on CMU only if you choose Path 2 below.

---

## Part B — Reflecting the data into motion

Two paths. The recommendation is **Path 1** for this project.

### Path 1 — Distill into the existing `kf()` pose functions *(recommended)*

Sample the captured/literature motion at the key phases the rig already keys on —
**takeback, the trough/slot, contact at `n=0.4`, follow-through** — read each joint's
angle at those phases, and write them into the pose-function arrays in
`src/entities/player.js` (`fhTopspinPose`, `servePose`, …, `player.js:143-469`).

- **No new runtime dependencies, zero asset bloat, keeps the all-procedural property**
  that makes the PWA tiny and offline.
- Reuses the *entire* existing pipeline: `kf()`, the pose dispatch (`getSwingPose`,
  `player.js:473`), the smoothing and stride in `updateVisual`.
- It pairs naturally with the new joints from `01` (richer data → richer keys).

**The real work is retargeting.** Source skeletons report joint orientations in their
own convention — SMPL axis-angle, BVH ZXY Euler, MediaPipe world landmarks — while our
rig wants **local Euler `[pitch, yaw, roll]` in each Group's parent frame**, with our
specific rest pose (limbs hang along `-y`, the body faces `-z`; CPU is rotated `PI`,
`player.js:500`). So the retarget step per joint is: convert the source orientation into
our local frame, subtract the rest-pose offset, and **possibly sign-flip** for our
facing/handedness. For a stick figure at distance you can transcribe **by eye against
reference frames** rather than build a perfect mathematical retargeter — cheaper and
visually sufficient. (Reserve a real retargeter for Path 2.)

### Path 2 — Skinned glTF character + `AnimationMixer` + retargeted clips

Replace the procedural rig with a rigged glTF mesh, play retargeted mocap clips through
Three.js's `AnimationMixer`, and blend with foot-plant IK plus the contact IK from `01`.

- **Costs that conflict with this project:** a skinned glTF mesh + skeleton + several
  clips is **hundreds of KB to several MB** — directly against the "all-procedural, no
  large assets, tiny offline PWA" property. Runtime adds skinning + mixer + blend-tree
  cost (fine on desktop, a real consideration on low-end mobile). And you **lose the
  all-procedural property** — character art, rigging, and a retargeting toolchain
  (Three.js ships a `SkeletonUtils.retargetClip` helper in its **examples/addons** — so
  it's *doable*, but note it is **not part of the core `three` import this project uses**;
  adopting it adds a dependency, which is itself a cost against the no-large-asset ethos)
  all become permanent maintenance surface.
- Worth it **only if photoreal characters become a product goal** — which conflicts with
  the current design ethos.

### Recommendation

**Path 1, phased.** It honors every stated constraint (MoonBit/JS split, offline, tiny
download, mobile perf) and reuses the whole pose pipeline. Use the **contact-point IK**
from `01` (§1.4) to get the "the racket reaches the real ball" benefit **without** Path
2's asset and complexity cost. Keep Path 2 documented as the escape hatch if the project
ever pivots to high-fidelity characters.

---

## A concrete authoring loop (Path 1)

1. Pick one motion (start with the **serve** — highest visible payoff).
2. Gather data: D1 numbers for trophy knee-flexion, X-factor, pronation timing; D3/D4
   on your own slow-mo for the shape between key phases.
3. Identify the rig's phase times for that motion (`servePose` keys at
   `n = 0, 0.30, 0.50, 0.62, 0.85, 1`, `player.js:362-399`).
4. Retarget each source joint angle into our local Euler frame at those phases.
5. Write the values into the pose function's `kf()` arrays — and, for joints whose
   *timing* is the point (the sequenced shoulder/elbow/wrist chain), express them through
   `01`'s `peakAt(n, peak, rest, amp)` helper so the proximal→distal lag stays explicit
   rather than hand-aligned. Fill the new `wristR`/`chest` keys from `01` here too.
6. Verify against the verification checklist in `01` (§1.5): orbit-camera side view,
   practice-mode repeat loop, slow-mo side-by-side with the reference.
7. Repeat for FH topspin, BH topspin, then the rest.

This keeps the data pipeline entirely **offline and asset-free**: the shipped game still
contains only JS source with better numbers in it.
