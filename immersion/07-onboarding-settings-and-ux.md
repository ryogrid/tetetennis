# 07 — Onboarding, Settings & the UX Shell

Docs `01`–`06` raise *presence*. This doc covers the **UX shell** that makes that
presence usable: the settings home every other doc's toggles need but none of them owns,
a first-run onboarding ramp, the share/export payoff that a replay system begs for, and
the accessibility and performance-feel that adding audio + cinematics can otherwise
*hurt*. It also records what we deliberately scoped out, so a reader knows those were
considered, not forgotten.

## Why this doc exists

Every proposal in this folder ends with "ship it behind a setting with a conservative
default" (see `00`, principle 4: *"Group them under an 'Immersion / Presentation'
settings block"*). But **no doc actually specs that block** — so the toggles have no
home. And building a replay recorder (`04`) and a highlight reel (`06`) without ever
letting the player **save or share** a clip leaves the most obvious modern payoff on the
table. This doc fills those gaps.

---

## 7.1 The Immersion / Presentation settings panel *(the home for everything)*

**Problem.** Each feature promises a toggle, but there is no single surface that owns
them, and the existing menus only cover gameplay (surface / difficulty / assist /
players).

**Proposal.** One **Immersion / Presentation settings panel**, reached from the setup
flow, that owns every presentation toggle the other docs introduce, persisted exactly
like assist level (localStorage via `loadAssist`/`saveAssist`, `src/main.js:61-71`). It
should also expose a single **Graphics Quality tier** (Low / Med / High, auto-detected
default) that the heavy visual options key off (`00`, principle 6).

| Setting | Owned-by doc | Default |
|---------|-------------|---------|
| Crowd volume / ambient bed | 03 | On (low) |
| Player grunts | 03 | On |
| Footstep / slide SFX | 03 | On |
| Umpire voice (if samples present) | 03 | On if bundled, else hidden |
| Music | 03 | On (low) |
| 3D spatial audio (HRTF) | 03 | Off on mobile, on desktop |
| Camera: gameplay vs **broadcast** baseline | 04 | Gameplay (broadcast warned) |
| Instant replays on big points | 04 | On |
| Reactive camera (punch-in / push) | 04 | On |
| Graphics quality tier | 05 | Auto |
| Crowd density | 05 | tier-driven |
| Post-processing (bloom / AO) | 05 | Off (on = "High") |
| Lighting mood (day / dusk / night) | 05 | Day |
| Motion realism level (base / full articulation) | 01 | tier-driven |
| Haptics (rumble / vibrate) | 06 | On where supported |
| BREAK/SET/MATCH overlays | 06 | On |

**Implementation pointers.** Extend the setup UI (`host_show_setup`, `host.js.mbt:143`;
`src/ui.js`) with a presentation sub-screen; persist a small settings object alongside
the assist key (`main.js:61-71`). The MoonBit side only needs to *read* the few settings
that affect what it emits (e.g. whether to compute the tension signal); pure-visual
toggles stay entirely JS-side.

**Effort / Impact.** Med / High (it is the enabler that lets every other feature ship
non-default-breaking). **Risks.** Don't let the panel balloon — group by category and
hide options whose assets aren't present (e.g. umpire voice).

## 7.2 First-run onboarding & immersion ramp

**Problem.** New players are dropped straight into a match with no introduction to the
controls *or* the new presentation, and the richest defaults can overwhelm a first
session.

**Proposal.** A short, skippable **first-run** that (a) introduces movement + shot
controls inline (not a wall of text), (b) shows the new stadium/crowd once as a "welcome
to the court" beat (reuse the `06.5` walk-on), and (c) remembers it was seen so it never
repeats. Pair with conservative first-session defaults that the player can dial up.

**Implementation pointers.** A `firstRun` flag in localStorage (same pattern as
`main.js:61-71`); choreography in `src/ui.js` + the walk-on from `06.5`.

**Effort / Impact.** Med / Med–High (onboarding is the UX half the original request
named). **Risks.** Keep it skippable and short; never gate play behind it.

## 7.3 Replay export & share *(the payoff of building a recorder)*

**Problem.** `04` builds a replay recorder and `06` builds a highlight reel, but the
player can never **keep or share** a great point — the single most obvious modern
immersion-UX win of having replays at all.

**Proposal.** Let the player **export a clip** of a replay / highlight: render the replay
playback to a `MediaRecorder` capture of the WebGL canvas (or a GIF/WebM), offered on the
results screen and after a notable point. A "share" affordance can use the Web Share API
where available.

**Implementation pointers.** Hook `04`'s replay playback path; capture the canvas
(`renderer.domElement`, created in `main.js:23-28`) via `MediaRecorder`; surface the
button on the results screen (`host_show_results`, `host.js.mbt:183`).

**Effort / Impact.** Med / High. **Risks.** `MediaRecorder` codec support and the Web
Share API both **vary by browser and are limited/absent on parts of iOS** — feature-detect
and **degrade silently** (offer download where share is unavailable, hide entirely where
capture is unsupported). This is an *online/optional* affordance and must not become a
hard dependency for the offline PWA.

## 7.4 Accessibility of the new immersion layer

**Problem.** Adding audio cues, camera motion, and post-processing can *exclude* players —
the new umpire calls are audio-only, the camera push-ins and shake can trigger motion
sensitivity, and color-coded overlays can fail for colorblind users.

**Proposal.** Bake accessibility into the immersion layer from the start:

- **Captions / subtitles** for umpire calls and key audio events (the score is already a
  string, `score_strings`, `rules.mbt:182`).
- **Reduced-motion mode** that disables camera shake/push-in and post-processing (respect
  `prefers-reduced-motion`).
- **Colorblind-safe** overlays and a rule that no new cue is *only* color-coded.
- Ensure none of the new immersion audio is the *sole* carrier of essential information
  (the existing visual cues remain).

**Implementation pointers.** `src/ui.js` for captions; gate camera/VFX off the
reduced-motion setting (7.1) + the `prefers-reduced-motion` media query.

**Effort / Impact.** Low–Med / Med–High (and it protects the rest of the folder from
regressing usability). **Risks.** None — purely additive.

## 7.5 Performance & loading feel

**Problem.** Immersion features add GPU/CPU cost; if they make the game stutter or load
slowly, they *reduce* perceived quality. "Feel" is itself a UX dimension.

**Proposal.** An auto-detected **quality tier** (7.1) with mobile-safe defaults; lazy-init
of heavy systems (crowd instancing, post-processing) so first paint stays fast; keep the
existing renderer caps (`setPixelRatio ≤ 2`, PCF soft shadows, `main.js:24-27`). Surface a
quality toggle so users on weak hardware can recover smoothness.

**Implementation pointers.** Quality tier read in `main.js` / `render-host.js`; gate the
heavy options from docs `05` (crowd density, post-processing, decals) and `01` (full
articulation) behind it.

**Effort / Impact.** Med / Med. **Risks.** Don't auto-detect too aggressively; let the
user override.

---

## Deferred / explicitly out of scope

Considered and scoped out (recorded here so they're known decisions, not gaps):

- **Online / local multiplayer & social accounts / leaderboards** — a large architectural
  effort (networking, matchmaking, the deterministic sim would help but it's a separate
  project). Out of scope for a presentation pass.
- **A full tutorial campaign / coaching mode** — `kaizen/` owns the difficulty/assist axis;
  a deep skills-tutorial is a separate initiative. `7.2` covers only first-run onboarding.
- **Cloud highlight hosting** — `7.3` covers local export/share only; server-side hosting
  is out of scope for an offline-first PWA.
- **Real player likenesses / licensed branding** — out of scope; everything stays
  procedural (`02` licensing caveat).

---

## Offline / determinism summary

The settings panel, onboarding, accessibility, and performance work are pure JS/DOM and
fully offline. Replay export (`7.3`) is the one *optional, browser-dependent* feature —
feature-detect and degrade silently; never a hard dependency. Nothing here feeds the
simulation, so determinism is preserved (see `00`, principles 1–2).
