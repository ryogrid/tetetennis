# Immersion & Presentation: Making the Court Come Alive

## Goal

Make the game **feel more alive, dramatic, and broadcast-real (臨場感)** without
making it easier or harder to *win*. Where the `kaizen/` folder tunes **difficulty**
(reaction time, depth reading, contact forgiveness), this folder tunes **presence** —
how the player *characters move*, how the *crowd and court sound*, how the *camera
frames a great point*, how the *stadium looks*, and how the *match dramatizes its own
score*. None of these proposals change the physics, the AI, or the rules.

These are **proposals**, not as-built specs. `design_docs/` describes what already
ships; `kaizen/` describes accessibility ideas (some already shipped — e.g. the court
**depth ladder** is live at `src/court.js:98-102`, approach slow-motion at
`src/main.js:90-97`). This folder is a third, orthogonal axis.

## What we mean by "immersion" (and what is out of scope)

In scope — the seven axes that read as "this is a real tennis match," each its own doc:

1. **Player motion realism** — the body moves like a tennis player, not a stick that
   waves a racket (the user's explicitly-flagged issue). Doc `01`.
2. **Obtaining & applying real motion data** — *how* to get pro-tennis movement data and
   reflect it into the rig (the other half of the user's named ask). Doc `02`.
3. **Audio & crowd** — a living acoustic space, not silence between points. Doc `03`.
4. **Camera & cinematics** — replays and broadcast framing for the big moments. Doc `04`.
5. **Environment & VFX** — a stadium that reacts: crowd, dust, marks, light. Doc `05`.
6. **Match drama & game feel** — the score *performs* (break/set/match-point moments,
   momentum, celebrations, haptics). Doc `06`.
7. **Onboarding, settings & the UX shell** — the home for every toggle, first-run
   onboarding, replay export/share, accessibility, and perf feel. Doc `07`.

Axes 1–2 together answer the user's three named sub-asks (more articulation; how to
obtain pro data; how to reflect it). Axes 3–6 are the broadcast-presentation layer; axis
7 is the UX half that makes all of it usable.

Out of scope (recorded in `07` as considered, not forgotten): difficulty/assist changes
(that is `kaizen/`), gameplay-rule changes, online multiplayer/social, a full tutorial
campaign, and anything that ships large binary assets or breaks offline play.

## Where the "flatness" comes from today

The game is mechanically rich but presentationally quiet. Concretely:

- **The athlete is a primitive stick rig.** `src/entities/player.js` builds the body
  from cylinders/spheres with **10 joints and no wrist, no spine, no ankles, no neck**
  (`buildRig`, `player.js:23-117`). Strokes are hand-keyframed pose functions
  (`fhTopspinPose` etc.) with the racket rigidly bolted to the elbow — so there is no
  hip–shoulder separation, no racket-head lag, and the swing meets a *fixed pose*
  rather than the *actual ball*. Feet skate because the stride is a free-running sine
  (`runPhase`, `player.js:544`) not locked to ground distance.
- **The court is acoustically dead between points.** `src/audio.js` only fires a
  1.8 s crowd swell at point end (`sfxCrowd`, `audio.js:275`; called once at
  `game.js.mbt:1165`). No ambient bed, no mid-rally reaction, no footsteps, no grunts,
  no umpire calls.
- **One camera, no replays.** `src/camera.js` is a single eye-level rig with an
  overhead toggle. A great winner gets the same flat treatment as a netted return.
- **The stadium is empty boxes.** `src/court.js:127-140` builds unlit stand boxes with
  **no spectators, officials, sponsor boards, dust, or marks**, under one static sun.
- **The score is plain text.** Break point, set point, and match point all surface as
  the same `#banner`/`#toast` string. The drama lives in `logic/rules/rules.mbt` but
  is never *performed*.

## Design principles (apply to every proposal here)

1. **Preserve the MoonBit/JS split.** The MoonBit logic owns *truth* (who won, the
   score situation, rally length); the JS layer owns *presentation* (pixels, sound,
   camera, haptics). Any new cross-boundary data is a new **output-only** `extern "js"`
   in `logic/ffi/host.js.mbt` — logic → host, never read back.
2. **Determinism is sacred.** All animation and presentation is cosmetic and JS-side;
   it must never feed back into the simulation. New sim-side signals must be *pure
   functions of existing deterministic match state* — they add derivable data, not new
   randomness. (Confirmed: the JS swing clock only *mirrors* MoonBit's by construction,
   `0.18/0.45 = 0.40`, and is never read back — see `01`.)
3. **PWA / offline / procedural-first.** Default to synthesized audio, canvas textures,
   and generated geometry — no large downloads. Any *optional* recorded asset (umpire
   voice, mocap-derived art) must follow the existing **optional-manifest + silent
   fallback** pattern (`loadSamples`, `audio.js:88-101`; bundled `tennis-racket1.mp3`)
   and be a deliberate service-worker precache decision, never a hard dependency.
4. **Additive & toggleable.** Every feature ships behind a setting with a conservative
   default, mirroring the assist-level persistence already in `src/main.js:61-71`
   (`loadAssist`/`saveAssist`, localStorage). Group them under an
   "Immersion / Presentation" settings block.
5. **Don't regress kaizen depth-reading.** The **live-rally gameplay camera stays
   frozen.** Cinematics, replays, and celebrations fire only in non-live phases
   (point-over, serve setup, changeover). A broadcast camera is opt-in and warned.
   Overlays stay out of the depth-cue zone and fade during a live rally.
6. **Performance budget.** The renderer already caps pixel ratio at 2 and uses PCF
   soft shadows (`main.js:24-27`). Heavy visuals (crowd density, post-processing,
   decals, HRTF panning) go behind a quality tier with mobile-safe defaults; one
   `InstancedMesh` per crowd/particle/decal system; respect the existing `dispose()`
   discipline across match teardown.

## The shared backbone: one "point-situation / tension" signal

Three otherwise-separate features — tension-aware crowd audio (`03`), a match-point
camera push-in / replay trigger (`04`), and BREAK/SET/MATCH-POINT overlays (`06`) — all
need the same fact: *how important and how tense is the current moment?* Build it **once**
as a pure evaluator in `logic/rules/rules.mbt` (derivable from `Match` state,
`rules.mbt:27-41`, `add_point` at `:123`) and **fan it out** over a tiny output-only FFI
(`host_point_situation`, `host_tension`, `host_point_highlight`).

**The full signature, emit points, and consumer table are specified once, canonically,
in `06` §6.0 — that is the single source of truth.** Build this signal first: it unblocks
the highest-impact items in three docs at once.

## Proposal map

| File | Theme | Primary owner | Headline ideas |
|------|-------|---------------|----------------|
| `01-player-motion-articulation.md` | Player motion realism | `src/entities/player.js` | Add wrist/chest/neck/ankle joints; kinetic-chain sequencing; split-step & footwork; contact-point IK |
| `02-motion-capture-data-pipeline.md` | Getting & using real motion | authoring pipeline | How to obtain pro motion data (biomechanics, public mocap, markerless video); how to reflect it (distill-to-keyframes vs glTF+Mixer) |
| `03-audio-and-crowd.md` | Audio & crowd | `src/audio.js` | Living crowd bed; mid-rally swell/gasp/groan; grunts; footsteps/slide; umpire calls; spatial panning |
| `04-camera-cinematics-and-replay.md` | Camera & cinematics | `src/camera.js` + replay buffer | Instant replay (state-buffer playback); broadcast cam; reactive framing |
| `05-environment-and-vfx.md` | Environment & VFX | `src/court.js`, `src/entities/*` | Crowd sprites; clay dust & ball marks; lighting moods; post-processing; cosmetics |
| `06-match-drama-and-presentation.md` | Match drama & feel | `src/ui.js` + `rules.mbt` | Broadcast score bug; break/set/match overlays; momentum system; celebrations; haptics; highlight reel |
| `07-onboarding-settings-and-ux.md` | Onboarding & UX shell | `src/ui.js` + settings | Immersion settings panel; first-run onboarding; replay export/share; accessibility; perf feel; deferred scope |

## Priority matrix (impact × effort × wave)

Impact = how much it raises felt presence. Effort = rough implementation cost. Wave =
which of the three rollout waves below it belongs to.

| Idea | Impact | Effort | Wave | File |
|------|:------:|:------:|:----:|------|
| Living ambient crowd bed | High | Low | 1 | 03 |
| Crowd billboard sprites | High | Med | 1 | 05 |
| Floodlit-night lighting mood | Med–High | Low–Med | 1 | 05 |
| Clay-dust puff + skid marks | High | Med | 1 | 05 |
| Footstep / clay-slide SFX | Med | Med | 1 | 03 |
| Player effort grunts | Med–High | Low–Med | 1 | 03 |
| Haptics (rumble / vibrate) | Med | Low | 1 | 06 |
| Broadcast animated score bug | Med–High | Med | 1 | 06 |
| Split-step + base footwork | Med–High | Med | 1 | 01 |
| Contact-point IK | High | Med | 1 | 01 |
| Wrist + chest joints (X-factor, racket lag) | High | Med | 1 | 01 |
| Immersion / Presentation settings panel | High (enabler) | Med | 1 | 07 |
| **Shared point-situation / tension signal** | High (enabler) | Med | 2 | 06 |
| Instant-replay buffer | Very High | Med–High | 2 | 04 |
| BREAK/SET/MATCH-POINT overlays | High | Med | 2 | 06 |
| Mid-rally crowd swell + gasp/groan | High | Med | 2 | 03 |
| Celebrations between points | Med–High | Med | 2 | 01/06 |
| Hawk-Eye close-call review | Med–High | Med–High | 2 | 06 |
| End-of-match highlight reel | High | Med | 2 | 06 |
| Replay export / share | Med–High | Med | 2 | 07 |
| First-run onboarding + accessibility | Med–High | Low–Med | 2 | 07 |
| Opt-in broadcast camera | Med–High | Low–Med | 3 | 04 |
| Full articulation (ankles, clay slide, re-timing) | Med–High | Med–High | 3 | 01 |
| Motion data infusion (keyframes) | Med–High | Med–High | 3 | 02 |
| Post-processing (bloom/AO) | Med | Med | 3 | 05 |

## Recommended waves

**First wave** — high presence-per-effort, mostly pure-JS, no determinism risk, can
ship piecemeal:

1. **Living ambient crowd bed** (03) — kills the dead silence; pure `audio.js`.
2. **Crowd billboard sprites + floodlit-night mood** (05) — the single biggest visual
   jump; the night mood multiplies the crowd payoff.
3. **Clay-dust + skid marks** (05) — reuses the existing bounce event + instanced-mesh
   pattern; transforms clay especially.
4. **Player effort grunts + footstep/slide SFX** (03) — small, no new FFI.
5. **Broadcast score bug + haptics** (06) — pure DOM / pure JS; `updateScore` and
   `host_hit_quality` already cross the boundary.
6. **Wrist + chest joints, split-step, base footwork, and contact-point IK** (01) — the
   foundational motion-realism wins (the joints unlock X-factor + racket lag), all
   JS-side, no new assets.
7. **The Immersion / Presentation settings panel** (07) — the enabler that gives every
   other toggle a home so nothing changes the default experience.

**Second wave (build the backbone, then its consumers):** the **point-situation /
tension signal** (06 §6.0) and the **replay recorder** (04) are dependencies for several
later features — build them early. Then BREAK/SET/MATCH overlays (06), mid-rally crowd
reactions (03), celebrations (01/06), Hawk-Eye review (06), the highlight reel (06), and
the UX payoffs that ride on the recorder — replay export/share, first-run onboarding, and
the immersion-layer accessibility pass (07).

**Third wave (polish & fidelity):** full articulation — ankles, clay slide, kinetic-chain
re-timing (01); motion-data infusion (02); opt-in broadcast camera (04); post-processing,
officials/sponsor boards, walk-on intro, music, 3D spatial panning, player cosmetics,
umpire voice samples.

## How to read each proposal

Every idea uses the same template, written as **run-in bold lead-ins** (rather than
`kaizen/`'s `###` subheadings — the ideas here are denser and read better inline):

- **Problem** — the specific flatness it removes.
- **Proposal** — what to add or change.
- **Implementation pointers** — concrete `file:line` anchors to start from, and which
  side of the MoonBit/JS boundary the work lives on.
- **Effort / Impact** — rough sizing.
- **Risks** — perf, determinism, offline, or kaizen-depth caveats to watch.

The determinism / offline contract (principles 1–3) holds for **every** proposal; the
per-doc closing summaries restate it only where a feature has a specific nuance.
