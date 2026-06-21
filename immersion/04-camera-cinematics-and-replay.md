# 04 — Camera, Cinematics & Instant Replay

A great point currently gets the same flat eye-level treatment as a netted return.
Broadcast tennis sells drama through the *camera* — the slow-motion replay of a winner,
the push-in on match point, the celebration framing. This document adds those without
disturbing the live-rally camera that the `kaizen/` depth-reading work depends on.

## What exists today

`src/camera.js` is a single rig with three modes selected by a `mode` string —
`'rally'` (eye-level behind the player), `'serve'` (look at the service box), and
`'overhead'` (bird's-eye) — driven by `host_camera_update(h, dt, mode)`
(`logic/ffi/host.js.mbt:124`) and `host_camera_snap` (`:128`). The rig already reads the
latest player/ball positions the render host stores (`renderHost.getPlayer/getBall`,
`camera.js:35-36`; `render-host.js:108-113`). There are **no replays, no broadcast
framing, and no reactive moments.**

> **Kaizen tension, resolved.** `kaizen/` deliberately freezes the *gameplay* camera
> because depth-reading depends on it. **Resolution: every cinematic idea here fires
> only BETWEEN points (point-over, serve setup, changeover) or as an explicit opt-in
> alternate baseline — never altering the live-rally camera.**

---

## 4.1 Instant replay on the big points (headline feature)

**Problem.** The most dramatic moments — a passing-shot winner, a saved break point,
match point — flash by once and are gone. Broadcast tennis would replay them.

**Proposal — and it is cheap because the sim is deterministic and the data is already
flowing.** You do **not** re-run the simulation. Record a rolling **ring buffer** (last
~6 s) of the lightweight render state the host already receives every frame — ball
position/spin and both players' `x/z/vel`, i.e. exactly the arguments of `setBall`
(`render-host.js:63`) and `setPlayer` (`render-host.js:74`). On a flagged big point,
freeze input, swap to a cinematic camera path, and **play the buffer back through the
same `render.setBall` / `render.setPlayer` calls** at variable (slow-motion) speed.

> **Do NOT implement replay by re-simulating.** Even though the sim is deterministic,
> replaying the input stream risks float divergence and is far more fragile than
> replaying the already-emitted render state. The state buffer is simple and exact.

**Recorder schema.** A fixed-stride `Float32Array` ring buffer, one row per render frame.
A minimal row is **13 floats**: `t` (frame time) · ball `active,px,py,pz,sx,sy,sz` (the 7
`setBall` args, `render-host.js:63`) · for each of 2 players `x,z` (3 floats incl. side is
unnecessary since order is fixed) — i.e. `[t, active, px,py,pz, sx,sy,sz, p0x,p0z, p1x,p1z]`.
At 60 fps × 6 s that is ~360 rows × 13 × 4 B ≈ **19 KB** — trivial. Velocity can be
re-derived from consecutive rows for the camera, so it need not be stored. Optionally add
the active swing/serve state per side to replay the rig pose exactly.

**Trigger signal (shared).** Replay fires off the shared `host_point_highlight(...)` signal
— **specified canonically in `06` §6.0** (do not re-declare it here). It carries
*why* a point is notable (break/set/match, rally length, winner vs. error) and is the same
signal the drama overlays (`06`) and tension audio (`03`) consume.

**Control flow (against the real loop).** The frame loop in `main.js:84-104` advances the
sim via the accumulator `while (acc >= DT) logic.fixedUpdate(DT)` (line 95). For replay:
on a highlight at the `PointOver` boundary, set a JS `replaying` flag that **skips the
`logic.handleInput()` + accumulator block entirely** (the sim is frozen — its own
`state_timer` for `PointOver` simply doesn't advance) and instead, each frame, advances a
**replay cursor** through the ring buffer at a chosen rate (e.g. `0.35×` for slow-mo) and
pushes that row straight into `render.setBall(...)` / `render.setPlayer(...)`. `render.tick`
+ `renderer.render` still run, so the rigs animate. On buffer end, clear the flag and let
the normal loop resume into the next serve.

**Marker suppression.** The on-court markers are driven per-frame by the sim via
`showLanding/setSweet/showTrail` (`render-host.js:66-72`) and the reach/open-court overlays.
Because replay **freezes the sim**, those calls stop firing — but the *last* markers remain
visible. Add a `render.setReplayMode(on)` that hides the landing ring, sweet-spot/countdown,
trail, reach circle, and open-court patch (and the HUD via `ui.hideHUD()`, `host.js.mbt:200`)
for the duration, restoring them on exit. This is one explicit toggle, not a per-marker hunt.

**Implementation pointers.** A new `replay-buffer.js` in the JS render layer taps the same
per-frame data `render-host.js` already stores; the `replaying` gate + cursor live in
`main.js:84-104`; the cinematic camera path in `camera.js`; `render.setReplayMode` in
`render-host.js`. One new extern (`host_point_highlight`) per `06` §6.0.

**Effort / Impact.** Med–High / **Very High**. **Risks.** Sequence the freeze strictly
inside the `PointOver` window so the sim's state machine resumes cleanly. The ~19 KB buffer
is negligible, no assets, fully offline.

## 4.2 Opt-in broadcast baseline camera

**Problem.** The eye-level rig is great for *playing* but doesn't read as TV tennis.

**Proposal.** A higher, side-offset "broadcast" framing as an **alternate** to the
eye-level cam, selectable in setup. The rig already takes a `mode` string, so this is a
new mode plus its framing math. **Ship it OFF by default and warn it changes
depth-reading** (kaizen-respecting).

**Implementation pointers.** New `'broadcast'` branch in `camera.js:update` (alongside
`'overhead'`, `:39`); expose the choice in the setup menu (`host_show_setup`,
`host.js.mbt:143`) and persist it like assist level (`main.js:61-71`).

**Effort / Impact.** Low–Med / Med–High. **Risks.** The depth-reading regression is real
— gate it as opt-in and warned, never the default during a scored match.

## 4.3 Reactive framing on key moments (non-live only)

**Problem.** The camera never punctuates a moment.

**Proposal.** Short scripted camera tweens, **gated to non-live phases**:

- **Smash punch-in** — a brief FOV/zoom on a smash. Note the smash does **not** flow
  through `host_flash_shot` (that only ever carries flat/topspin/slice/drop); a smash
  surfaces via the `r.smash` branch and its `host_toast("SMASH!", …)` (`game.js.mbt:1057-1058`).
  Hook the punch-in there, or add a small dedicated highlight flag.
- **Match-point slow push-in** during serve setup (from the `point_situation` signal).
- **Celebration framing** after the winning point (pairs with the celebration in `01`/`06`).

**Implementation pointers.** Scripted tweens in `camera.js`, triggered by the shared
`host_point_highlight` / `host_point_situation` signals; only run in `PointOver` / serve
setup / changeover.

**Effort / Impact.** Med / Med–High. **Risks.** Must yield to the next-serve timer; never
run during a live rally.

## 4.4 Serve & changeover cams

**Problem.** Transitions are abrupt cuts with no production value.

**Proposal.** A low net-level serve-cam option and a changeover pan. Note: there is no
discrete "changeover" event today — it is the inline condition `(games_p+games_c) % 2 == 1`
baked into the GAME toast string (`game.js.mbt:1174`); a consumer either recomputes that
parity or it gets promoted to a small signal. Between-point only.

**Implementation pointers.** Additional `camera.js` modes/tweens; trigger off the
existing changeover string / event.

**Effort / Impact.** Low–Med / Med. **Risks.** Keep them skippable; don't slow the pace
of a quick match.

---

## Dependencies & sequencing

The **replay recorder (4.1)** and the **shared highlight/point-situation signal** are
foundations: the Hawk-Eye close-call review and the end-of-match highlight reel (both in
`06`) reuse the recorder, and the tension audio (`03`) and drama overlays (`06`) reuse
the signal. Build 4.1's recorder and the signal early in the second wave (`00`), then the
consumers fall out cheaply.

## Determinism note

The one nuance specific to this doc: replay is **recorded-state playback, not
re-simulation**, so it cannot diverge from the original point. Everything else follows the
standard contract (see `00`, principles 1–2): output-only, offline, no assets.
