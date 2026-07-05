# Serve Motion Import Scaffold

This directory is for offline motion-authoring helpers only. Nothing here is
loaded by the game at runtime.

## Current scope

`extract-serve-keyframes.mjs` takes a cleaned joint-track JSON file for a single
serve clip and emits a summary JSON aligned to the repo's existing serve phases.

`extract_joint_track.py` is the front-end extractor: it reads an mp4, runs
MediaPipe Pose, interpolates/smooths the required joints, and writes a
`cleaned joint track` JSON that the serve sampler can consume.

`extract-stroke-keyframes.mjs` does the same job for forehand/backhand rally
strokes. It is intended for flat/topspin replacement only. Slice, drop, and
volley should remain on the existing authored motions unless you film those
motions separately.

The intended workflow is:

1. Capture or obtain a serve clip.
2. Run `extract_joint_track.py` to create a first cleaned track.
3. Trim that track down to the active serve motion window.
4. Review / lightly fix the trimmed track if needed.
5. Run `extract-serve-keyframes.mjs` to sample the clip at the same key phases used by
   `src/entities/player.js`'s `servePose`.
6. Use the output as an authoring aid while replacing the serve keyframe values.

For forehand/backhand strokes, replace step 5 with `extract-stroke-keyframes.mjs`.

## Install Python dependencies

```bash
python3 -m pip install -r scripts/mocap/requirements.txt
```

## Extract from mp4

```bash
npm run mocap:extract -- --input path/to/serve.mp4
```

Useful flags:

- `--output path/to/serve.cleaned.json`
- `--frame-step 2`
- `--visibility-threshold 0.45`
- `--smooth-window 5`
- `--name "rear-flat-serve-01"`

The extractor writes a JSON already shaped for the next step, with a
`suggestedContactFrame` field you can use as the first contact guess.

## Trim a cleaned track

```bash
npm run mocap:trim -- --input path/to/serve.cleaned.json
```

Useful flags:

- `--output path/to/serve.trimmed.json`
- `--contact-frame 426`
- `--padding-before 24`
- `--padding-after 18`

The trimmer reindexes frames so the output can go straight into
`mocap:serve`, and it rewrites `suggestedContactFrame` for the trimmed clip.

## Input schema

The input must be JSON shaped like this:

```json
{
  "fps": 120,
  "frames": [
    {
      "index": 0,
      "joints": {
        "hips": { "x": 0.0, "y": 1.00, "z": 0.0 },
        "shoulderR": { "x": 0.20, "y": 1.35, "z": -0.08 },
        "elbowR": { "x": 0.42, "y": 1.28, "z": -0.15 },
        "wristR": { "x": 0.62, "y": 1.08, "z": -0.22 },
        "shoulderL": { "x": -0.18, "y": 1.36, "z": -0.06 },
        "elbowL": { "x": -0.30, "y": 1.18, "z": -0.10 },
        "kneeR": { "x": 0.09, "y": 0.55, "z": -0.01 },
        "kneeL": { "x": -0.09, "y": 0.55, "z": -0.01 }
      }
    }
  ]
}
```

Required joints per frame:

- `hips`
- `shoulderR`, `elbowR`, `wristR`
- `shoulderL`, `elbowL`
- `kneeR`, `kneeL`

## Usage

```bash
npm run mocap:serve -- --input path/to/cleaned-serve.json
```

For a forehand or backhand rally stroke:

```bash
npm run mocap:stroke -- --input path/to/cleaned-stroke.json --side forehand --emit-js
```

Using the output of the extractor:

```bash
npm run mocap:extract -- --input path/to/serve.mp4 --output path/to/serve.cleaned.json
npm run mocap:trim -- --input path/to/serve.cleaned.json --contact-frame 72
npm run mocap:serve -- --input path/to/serve.cleaned.trimmed.json --emit-js
```

Try the committed sample:

```bash
npm run mocap:serve -- --input scripts/mocap/examples/serve-flat-sample.cleaned.json
```

Useful flags:

- `--output path/to/out.json`
- `--fps 120`
- `--contact-frame 72`
- `--left-handed`
- `--name "practice-flat-serve-01"`
- `--emit-js`
- `--emit-js-path path/to/snippet.js`

For `mocap:stroke`, pass `--side forehand` or `--side backhand`.

## Output

The output JSON contains:

- sampled frame indices for `start`, `coil`, `trophy`, `drive`, `follow`, `finish`
- per-phase joint-vector summaries
- `servePoseHints`, which point directly at the authored channels you will need
  to update in `src/entities/player.js`
- `servePoseTemplate`, a coarse first-pass set of arrays aligned to the existing
  `servePose` phase times

If you pass `--emit-js`, the script also writes a `.serve-pose-snippet.js` file
next to the JSON output. That snippet now matches the `SERVE_POSE_TEMPLATE`
shape in `src/entities/player.js`, so you can swap data without rewriting the
serve evaluator.

## Try the imported serve in-game

The tuned imported serve template from `movie/serve.mp4` is the default now.
To force that setting again in the browser console:

```js
localStorage.setItem('servePoseTemplate', 'rear-serve-01-trimmed')
location.reload()
```

To compare the untuned raw extraction instead:

```js
localStorage.setItem('servePoseTemplate', 'rear-serve-01-raw')
location.reload()
```

Forehand and backhand flat/topspin now default to the tuned imported templates.
To force that setting again in the browser console:

```js
localStorage.setItem('forehandStrokeTemplate', 'forehand-tuned')
localStorage.setItem('backhandStrokeTemplate', 'backhand-tuned')
location.reload()
```

To compare the raw extracted stroke templates:

```js
localStorage.setItem('forehandStrokeTemplate', 'forehand-raw')
localStorage.setItem('backhandStrokeTemplate', 'backhand-raw')
location.reload()
```

To return stroke motions to the original authored defaults while keeping the
imported serve setting unchanged:

```js
localStorage.setItem('forehandStrokeTemplate', 'legacy-default')
localStorage.setItem('backhandStrokeTemplate', 'legacy-default')
location.reload()
```

To switch back to the original authored serve:

```js
localStorage.setItem('servePoseTemplate', 'legacy-default')
location.reload()
```

This is intentionally a scaffold. It gives you consistent sampling and a stable
schema so the next step can focus on local-rotation fitting, not file wrangling.