# Hit-sound samples (optional)

The game's audio is **fully synthesized** at runtime (`src/audio.js`) and ships with no
audio files, so it stays download-free and offline-capable. The hit sound is a 5-layer
procedural synth (Body / Crack / Shimmer / String Ring / Brush) shaped per shot type,
panned by contact position, with a procedural-IR reverb.

`src/audio.js` also has an **optional sample-loading hook** (`loadSamples`). If you want
to use recorded racket-impact samples instead of the synth, drop them here and add a
manifest — the loader will pick them up, and if anything is missing it silently falls
back to the synth.

## How to enable

1. Add audio files in this directory, e.g. `flat.mp3`, `topspin.mp3`, `slice.mp3`,
   `lob.mp3`, `drop.mp3`, `serve.mp3`.
2. Add `manifest.json` mapping shot type → filename:

   ```json
   { "flat": "flat.mp3", "topspin": "topspin.mp3", "slice": "slice.mp3",
     "lob": "lob.mp3", "drop": "drop.mp3", "serve": "serve.mp3" }
   ```

3. Ensure the files are served under `audio/samples/` (Vite copies `public/`; for a
   bundled build, place the files + manifest under `public/audio/samples/`).

Loaded samples are played through the same panner + reverb bus as the synth, with a
per-shot playback-rate tweak and a pitch jitter per hit.

## Credits

No samples are bundled. If you add your own, record their source and licence here
(e.g. Sound Effect Lab — "Hitting with a Tennis Racket").
