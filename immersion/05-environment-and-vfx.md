# 05 — Environment & Visual Atmosphere / VFX

The world is a court, a net, lines, a few empty stand boxes, and one static sun. It
plays well but it doesn't *feel* like a packed stadium. This document fills the world
with a reacting crowd, surface effects (the clay dust and ball marks that define the
sport's look), lighting moods, and optional post-processing — all procedural,
offline-safe, and gated behind a quality tier for mobile.

## What exists today

- `src/court.js` builds the court, lines, net, and a **kaizen depth ladder**
  (`faintLine`, `court.js:42-53,98-102`), plus **stepped dark stand boxes** with no
  occupants (`court.js:127-140`). One directional sun + ambient + fog (`buildLights`,
  `court.js:145-159`).
- `src/entities/ball.js` already uses the patterns we'll reuse: a procedural
  **`CanvasTexture`** (`ball.js:70`), an instanced **predicted-path trail**
  (`ball.js:127`), and an instanced **past-position motion trail** (`pastTrail`,
  `ball.js:146`), all with disciplined `dispose()` (`ball.js:349-368`).
- The renderer caps pixel ratio at 2 and uses PCF soft shadows (`main.js:24-27`).

There are **no spectators, no officials/sponsor boards, no surface VFX (dust/marks), no
day-night, and no post-processing.**

---

## 5.1 Crowd visuals via instanced billboard sprites *(biggest single visual win)*

**Problem.** The stands are empty boxes — the loudest "this is a tech demo" signal in the
scene.

**Proposal.** Replace the flat stand faces with thousands of camera-facing billboards:
one `InstancedMesh` + a procedurally drawn `CanvasTexture` atlas of a few blob
"spectators" (the same offscreen-canvas trick `ball.js:70` already uses). Per-instance
color variation + a cheap shared idle sway in the tick. Optionally bump the sway into a
stand-and-cheer on a won point via the `tension` signal (`00`).

**Implementation pointers.** Extend `src/court.js` where the stands are built
(`court.js:127-140`); one `InstancedMesh`, canvas-atlas texture; animate in the render
tick (`render-host.js:101`).

**Effort / Impact.** Med / High. **Risks.** Keep it a *single* `InstancedMesh` and cap
the count; fill-rate is the mobile risk. Tie density to the quality tier.

## 5.2 Officials, furniture & sponsor boards

**Problem.** A pro court has an umpire chair, line judges, ball kids, sponsor boards, and
an in-world scoreboard; ours has none, so it reads as a practice wall.

**Proposal.** Low-poly procedural meshes/billboards added to the court `Group`: umpire
chair, a few line-judge/ball-kid billboards, sponsor planes on the stand fronts, and an
**in-world scoreboard** that renders the existing score string to a `CanvasTexture`
updated on score change (`host_update_score`, `host.js.mbt:203`).

**Implementation pointers.** All in `src/court.js` (added to the returned `Group`);
scoreboard texture updated from the same data feeding the DOM scoreboard.

**Effort / Impact.** Med / Med–High. **Risks.** Keep poly counts trivial; these are set
dressing, not hero assets.

## 5.3 Surface VFX: clay-dust puff + ball-skid marks

**Problem.** Clay tennis is *visually* defined by the dust kicked up on a bounce and the
skid mark the ball leaves — we render neither, so all three surfaces look the same on
impact.

**Proposal.** On bounce, add a JS particle **dust puff** (a small instanced/points burst)
on clay, and a persistent **skid-mark decal** (a faded oriented quad pooled into a ring
buffer of ~16 marks) tinted per surface. The bounce event already fires
(`host_sfx_bounce(speed, surface)`, `host.js.mbt:27`; `process_bounce` in `game.js.mbt`).

**Implementation pointers.** Hook the bounce path; add the puff + decal in
`src/entities/ball.js` (it already owns instanced meshes + disposal,
`ball.js:127-162,349-368`). Either piggyback the existing bounce call or add
`host_bounce_fx(x,z,speed,surface)`.

**Effort / Impact.** Med / High (clay especially). **Risks.** Cap the decal pool;
respect `dispose()` across match teardown so marks don't leak.

## 5.4 Ball motion trail / speed blur

**Problem.** Fast shots don't *read* as fast.

**Proposal.** Extend the existing `pastTrail` (`ball.js:146`) so trail length/opacity
scale with ball speed, plus a subtle stretch-billboard "blur" on the fastest shots.

**Implementation pointers.** Tune `pastTrail` in `ball.js`; speed is already known per
frame. **Effort / Impact.** Low (extends existing) / Med. **Risks.** Don't overdo it —
the trail must not be mistaken for the predicted-path trail (`trail`, `ball.js:127`).

## 5.5 Net ripple on net-hits

**Problem.** A ball into the net produces sound (`sfxNet`) but the net doesn't move.

**Proposal.** A short vertex wobble or quick scale-jitter on the existing `netMesh`
(`court.js:105`) when the ball strikes it.

**Implementation pointers.** Animate `netMesh` on the net event; small JS tween.
**Effort / Impact.** Low / Low–Med. **Risks.** Minimal.

## 5.6 Day/night & lighting moods (esp. floodlit night)

**Problem.** One fixed daylight look; no atmosphere variety.

**Proposal.** Lighting presets swapping `buildLights` sun color/intensity, `scene.background`,
and `fog` — warm day, dusk, **floodlit night**. Floodlit night is the strongest "stadium"
mood and multiplies the crowd-sprite payoff (5.1).

**Implementation pointers.** Parameterize `buildLights` (`court.js:145-159`); choose the
preset in setup and persist it (`main.js:61-71`). **Effort / Impact.** Low–Med / Med–High.
**Risks.** Night needs the crowd/floodlight geometry to not look empty — pair with 5.1.

## 5.7 Optional post-processing (bloom / AO / color-grade)

**Problem.** The raw render looks a bit flat vs. a graded broadcast image.

**Proposal.** A Three.js `EffectComposer` chain with restrained bloom + a slight color
grade for a TV look. **Make it an opt-in "graphics quality: high" toggle** — flag
bloom/SSAO as a perf risk on low-end mobile.

**Implementation pointers.** Wire `EffectComposer` in `src/main.js` around the existing
`renderer.render` (`main.js:104`); gate on the quality tier.

**Effort / Impact.** Med / Med. **Risks.** Post-processing roughly doubles GPU cost — off
by default on mobile.

## 5.8 Player cosmetic detail

**Problem.** The athletes are untextured primitives in two flat colors.

**Proposal.** Procedural attachments on the existing rig — cap/visor, wristbands, simple
clothing color blocking — to add personality. **Mesh only: leave all skeletal/swing
motion to `01`.**

**Implementation pointers.** Add meshes in `buildRig` (`player.js:23-117`) / per-character
in `src/characters.js`. **Effort / Impact.** Low–Med / Med. **Risks.** Don't add cloth
simulation; static attachments are enough at viewing distance.

---

## Quality-tier & offline summary

Everything here is procedural (canvas textures, generated geometry) — fully offline, no
new downloads. Tie the heavy options (crowd density, post-processing, decal pools,
night-mode shadows) to a **graphics quality tier with mobile-safe defaults**. Use one
`InstancedMesh` per crowd/particle/decal system and respect the existing `dispose()`
discipline across `teardownMatch`/`startMatch` (`render-host.js:33-57`). Pure render
layer — zero determinism impact.
