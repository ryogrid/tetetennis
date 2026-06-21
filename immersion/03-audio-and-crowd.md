# 03 — Audio & Crowd: A Living Acoustic Space

Audio is the highest immersion-per-effort lever in the whole game, because the pipeline
already exists and is well factored: `src/audio.js` synthesizes every SFX with Web Audio
behind a flat `host.audio` surface, with a procedural reverb send and an optional
recorded-sample path. The problem is not the synthesis quality — it is that the court is
**acoustically dead between hits**. Everything below is output-only and never touches the
simulation, so determinism is untouched.

## What exists today

- A 5-layer synth racket hit (`sfxHit`, `audio.js:127`) that actually plays the bundled
  **`tennis-racket1.mp3`** (`racketUrl`, `audio.js:8`; `loadHitSample`, `audio.js:106`)
  with the synth as fallback, panned by contact-x via a `StereoPanner`.
- Surface-dependent bounce (`sfxBounce`, `audio.js:223`), net rattle (`sfxNet`:247),
  beeps for out/fault/menu/confirm/reach, and a Perfect-Hit bell (`sfxPerfect`:366).
- A single **point-end** crowd swell: `sfxCrowd(intensity)` (`audio.js:275`) — a 1.8 s
  pink-noise burst, fired once at point end and biased to `1.0` when the human wins,
  `0.55` otherwise (`game.js.mbt:1165`).
- An **optional-sample loader** with silent fallback (`loadSamples`, `audio.js:88-101`)
  reading `audio/samples/manifest.json` — the precedent for shipping optional recorded
  audio without breaking offline.
- A generic no-arg cue dispatcher: `host_sfx(h, name)` → `h.audio[name]()`
  (`logic/ffi/host.js.mbt:14`), so a new no-arg cue only needs adding to the audio
  surface + a MoonBit call site.

There is **no continuous ambience, no mid-rally reaction, no human/effort sound, no
footsteps, no umpire voice, and no spatialization beyond the one hit panner.**

---

## 3.1 Living ambient crowd bed (continuous)

**Problem.** Between points the court is silent, which instantly reads as "tech demo,"
not "stadium." The only crowd sound is the 1.8 s point-end swell.

**Proposal.** A persistent, low-level looped crowd murmur running the whole match — the
existing `pinkBuf` through a slow LFO-modulated lowpass at ~`0.04` gain — so there is
always a room tone. Start/stop it with match start/teardown.

**Implementation pointers.** New `ambientCrowd(on)` in `src/audio.js` reusing `pinkBuf`
(`audio.js:57-66`); start on `host_start_match` / stop on `host_teardown_match`
(`host.js.mbt:37,41`). No new per-frame FFI.

**Effort / Impact.** Low / High. **Risks.** Must sit low and possibly duck under hits or
it muddies the mix; keep it on a dedicated gain node.

## 3.2 Mid-rally crowd swell + reactions

**Problem.** A 30-shot rally and a 2-shot rally sound identical. The crowd never reacts
to tension, near-misses, or errors *as they happen*.

**Proposal.** Drive crowd gain from rally length / ball speed so a long rally audibly
builds; fire a short **"ooh/gasp"** (bandpassed rising pink burst) on near-misses and a
**"groan"** (descending lowpass) on errors. The sim already distinguishes winner vs.
error (`record_winner`/`record_error`, `game.js.mbt:1104,1113`) and can supply the
`tension` value from the shared backbone (canonical spec in `06` §6.0).

**Implementation pointers.** New `host_sfx_crowd_react(kind, intensity)` extern in
`logic/ffi/host.js.mbt` (mirror `host_sfx_crowd`, `:31`) → new `crowdReact()` in
`audio.js`. Drive sustained gain from the shared `host_tension(value)` signal.

**Effort / Impact.** Med / High. **Risks.** Voice-stacking under fast rallies can leak
Web Audio nodes — pool/cap the reaction voices.

## 3.3 Player effort grunts

**Problem.** Pro tennis is *loud with effort*; our players hit in total silence. A grunt
scaled to shot power is one of the strongest "this is real tennis" cues.

**Proposal.** A synthesized formant-ish grunt — two detuned sawtooths through a bandpass
vowel filter, pitched per character — gated on contact speed/charge, kept as a separate
toggleable `sfxGrunt(speed, charPitch)` so it can be turned off.

**Implementation pointers.** Hook the existing hit call sites
(`host_sfx_hit`, `game.js.mbt:896,972,1045`); speed is already passed. Add `sfxGrunt` to
the audio surface (`audio.js:384-388`); optional new extern, or piggyback on the hit
call.

**Effort / Impact.** Low–Med / Med–High. **Risks.** Per-character pitch needs taste so it
doesn't sound comic; cap to one voice per hit.

## 3.4 Footstep, squeak & clay-slide SFX

**Problem.** Players glide silently. Footfalls and the clay slide are core tennis
texture.

**Proposal.** A filtered-noise "step" tick driven by player velocity, plus a
surface-specific slide: clay = a longer pink-noise scrape, hard = a rubber squeak chirp,
grass = soft. The render host already stores per-side velocity
(`setPlayer(side,x,z,vx,vz)`, `render-host.js:74`) and the surface id
(`render-host.js:19`).

**Implementation pointers.** Best done **JS-side, no new FFI**: trigger from the rig/host
tick (`render-host.js:101-105`, `player.js:534`) using speed thresholds; coordinate slide
timing with the footwork work in `01` (§1.3).

**Effort / Impact.** Med / Med. **Risks.** Step cadence must match the visible stride
(use the same `runPhase`) or it reads as foley out of sync.

## 3.5 Umpire score callouts

**Problem.** Every score change is silent or a UI beep. A chair-umpire voice
("Fifteen–love", "Fault", "Out", "Deuce", "Advantage", "Game") is the most
broadcast-defining audio in tennis.

**Proposal.** Two tiers, and a clear recommendation:

- (a) **Procedural/offline TTS is not realistic** — browser `SpeechSynthesis` voices are
  OS-dependent, often unavailable offline, and robotic. **Flag as unreliable.**
- (b) **Recommended: a small set of pre-rendered clips** (~20–30 short files, a few
  hundred KB) shipped via the **existing optional-manifest pattern**
  (`loadSamples`, `audio.js:88-101`) with a **silent no-op fallback** when absent — so
  the zero-asset PWA still works.

The sim already computes score strings (`score_strings`, `rules.mbt:182`) and fires the
point/game events (`PointEvent`, `rules.mbt:19`; call site `game.js.mbt:1163-1181`); add
`host_umpire_call(key)` keyed off the event + score state.

**Implementation pointers.** New extern `host_umpire_call(key)` in `host.js.mbt`; clip
playback in `audio.js` via the sample path; manifest under `audio/samples/`.

**Effort / Impact.** Med (samples) / High. **Risks.** Budget the clips deliberately into
the service-worker precache; keep them optional.

## 3.6 Menu / ambient / tension music

**Problem.** No music anywhere — menus and tense moments feel inert.

**Proposal.** Short **procedural** loops (oscillator chord beds) for the menu, and a
tension stinger that rises on break/set/match point driven by the shared
`host_tension`/`host_point_situation` signal (canonical spec in `06` §6.0). Pure synth keeps it
offline and tiny.

**Implementation pointers.** New music module in `audio.js`; gate menu loop on UI state,
stinger on the tension signal. **Effort / Impact.** Med / Med. **Risks.** Must duck under
SFX; give the user a music-volume / off toggle.

## 3.7 3D spatial panning upgrade

**Problem.** Only the hit is panned (one `StereoPanner`, `audio.js:134`); bounces and the
opponent's contact have no position.

**Proposal.** Use a `PannerNode` (equalpower or HRTF) positioned at the ball/opponent
with the listener at the camera, so bounces and opponent hits pan with court position.

**Implementation pointers.** Extend `audio.js` routing; feed positions from the data the
host already stores (`getBall()`, `getPlayer()`, `render-host.js:108-113`).

**Effort / Impact.** Med / Med. **Risks.** HRTF is more CPU than `StereoPanner` on
low-end mobile — gate behind the quality tier (`00`, principle 6); equalpower is the safe
default.

---

## Offline & performance notes

Every synth option here is fully offline. The only optional recorded assets (umpire
voice, future grunt samples) **must** use the optional-manifest + silent-fallback
pattern and be a deliberate precache choice. Pool and cap voices (grunts, crowd
reactions) to avoid Web Audio node leaks during fast rallies. (Audio is output-only;
determinism per `00`, principles 1–2.)
