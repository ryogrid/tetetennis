# Camera Views — Design Doc

## 1. Motivation

The game ships with a single camera: a first-person view from the on-court player's
eyes, sitting just behind the player and looking down-court. Some players find it hard to
read the depth and lateral placement of the ball from eye level. This document adds a
second, **toggleable** camera: a **bird's-eye view from behind and above the player**
(俯瞰視点) — a high, over-the-shoulder angled view across the court — that the player can
switch to and from at any time during a match. The existing view is unchanged and remains
the default.

## 2. Current camera (for reference)

`src/camera.js` exposes `createCameraRig(camera, renderHost)` returning
`{ update(dt, mode), snap(mode), setServeLookX(x) }`. Each render frame the MoonBit logic
computes a **mode string** and calls `update`:

- `camera_mode()` in `logic/game/game.js.mbt` returns `"serve"` while the human is serving
  (point state `PreServe`/`Serving` and the human is the server) and `"rally"` otherwise.
- `frame_update` calls `host_camera_update(h, dt, mode)` → `cameraRig.update(dt, mode)`;
  `start_match` calls `host_camera_snap(h, mode)` once.

`update(dt, mode)` reads the human player's position (`renderHost.getPlayer(0)`) and the
ball (`renderHost.getBall()`), then:

- **position** (`desiredPos`): `x = player.x`, `y = EYE_H (1.62)`,
  `z = player.z + CAMERA_BACK (2.5)` — i.e. eye height, a touch behind the player.
- **look target** (`desiredLook`): for `"serve"`, a fixed gaze toward the service box; for
  `"rally"`, a small ball-relative offset (≤ ~6°) for awareness, else a neutral forward gaze.
- Both are eye-relative: the player strafes facing forward, so their own movement never
  rotates the view.
- Smoothing: `pos.lerp(desiredPos, kPos)` / `look.lerp(desiredLook, kLook)` with
  `kPos = 1 - 0.000001^dt` (≈ 0.2 per 60 fps frame — a tight but smooth glide) and a softer
  `kLook`. `snap(mode)` calls `update(10, mode)` for an effectively instant settle.

Key constants: `EYE_H = 1.62`, `EYE_BACK = 0.15`, `CAMERA_BACK = 2.5`,
`SERVICE_LINE = 6.40`. The Three.js `PerspectiveCamera` (FOV 70, near 0.1, far 200) is
created in `src/main.js` and wired into the host as `host.camera = cameraRig`.

## 3. The overhead view

### Behaviour

A new mode value `"overhead"` overrides the serve/rally framing entirely with a single,
consistent high view:

- **position**: directly behind and above the player — `x = player.x`,
  `y = OVER_H (≈ 8.5 m)`, `z = player.z + OVER_BACK (≈ 5.5 m)`.
- **look target**: a point down-court ahead of the player so the camera pitches down across
  the net — `x = player.x * 0.4`, `y = 0`, `z = player.z - 16` (roughly the opponent's
  mid-court). This yields an over-the-shoulder bird's-eye angle (not a straight top-down).
- It **follows the player** horizontally and in depth (anchored to `player.pos`), exactly as
  the user asked ("behind and above the player"). It does not track the ball directly; the
  high vantage already frames the whole rally.
- Reuses the existing `pos.lerp`/`look.lerp` smoothing, so **toggling glides** the camera up
  to / down from the overhead position over ~10–15 frames with no special transition code.
- The overhead branch **ignores `serveLookX`** (the serve-box gaze used by `"serve"`): when
  overhead is on, the human's serve is framed by the same high view as a rally, not the
  forward serve gaze. `setServeLookX` keeps being called and stored as today; it is simply
  unused while overhead is active.

`OVER_H`, `OVER_BACK`, and the look-`z` are first estimates and will be nudged during the
smoke test so the full court is framed without the player becoming too small.

### Mode flow / toggle

The overhead choice is orthogonal to serve/rally and lives in MoonBit as a sticky,
session-level flag (not reset per point or per match):

- `Game` gains `mut camera_overhead : Bool` (default `false`, set in `game_init`).
- `camera_mode()` returns `"overhead"` when the flag is set, otherwise the existing
  `"serve"`/`"rally"` result.
- The flag toggles on a key press inside `handle_match_input` (active-play path, after the
  Esc→pause check): pressing **B** flips it. This works during both serve and rally; HUD
  overlays (gauges, charge bar, scoreboard) are screen-space DOM and are unaffected.

No new FFI binding is needed — the `"overhead"` string flows through the existing
`host_camera_update` / `host_camera_snap` plumbing.

### On-screen control

A camera button (`🎥`, id `#tc-cam`) is added to the top-right `#tc-bar` next to the
existing touch-toggle and quit buttons. The bar is shown whenever the HUD is up (for both
keyboard and touch sessions), so the button is available to everyone. On pointer-down it
fires the same edge press as the keyboard (`onKey('KeyB', true); onKey('KeyB', false)`),
reusing the existing `setVirtualKey` path — no `src/input.js` change is required (a plain
`KeyB` is already captured by the keydown handler).

## 4. Why this is safe

The overhead camera is purely presentational. All world-space cues — the landing ring,
trajectory trail, sweet-spot marker, and open-court highlight — are scene objects and render
correctly from any camera, so no extra work is needed there. There is no change to physics,
shots, AI, or scoring, so the existing test suite is unaffected.

## 5. Implementation map

| Concern                          | Location                                            |
|----------------------------------|-----------------------------------------------------|
| Overhead positioning + constants | `src/camera.js` (`update`, `OVER_H`/`OVER_BACK`)    |
| Mode flag + toggle + `camera_mode` | `logic/game/game.js.mbt` (`Game`, `handle_match_input`) |
| On-screen 🎥 button + CSS         | `src/ui.js` (`#tc-bar`, `#tc-cam`)                  |
| Controls documentation           | `README.md`                                         |

## 6. Verification

- `moon check --target js` (0 errors); `moon test` + `moon test --target js` (existing 37
  tests stay green — no logic change); `npm run build` succeeds.
- Manual smoke (`npm run dev`): in a match, press **B** / tap 🎥 to toggle the overhead
  view; confirm it sits high and behind the player looking down-court, follows the player,
  glides back to the normal view smoothly, and that movement / charge-swing / serve power
  meter still work in the overhead view. Check both serve and rally, and a phone-sized
  viewport for the on-screen button.
