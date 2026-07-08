# Headless Match Runner (Node)

## Files

- `scripts/autotune/host-mock.mjs` — the mock `Host` object.
- `scripts/autotune/run_match.mjs` — CLI entry; runs a batch of matches and
  prints one JSON document to stdout.

Both are plain Node ESM (Node ≥ 20, repo has v24); no npm dependencies.

## Bundle import

```js
import * as logic from '../../_build/js/release/build/logic/game/game.js';
```

The bundle is produced by `npm run logic:build` (`moon build --target js
--release`). The runner does **not** build; it fails fast with a clear error
if the bundle file is missing or lacks the autotune exports (`setCpuMode`,
`getMatchStats`, `setParam`, `resetParams`), telling the user to rebuild.

Exports used: `init`, `fixedUpdate`, `menuCmd`, `setCpuMode`,
`getMatchStats`, `setParam`, `resetParams`. Not used headless:
`handleInput` (CPU mode ignores host input), `frameUpdate` and
`getTimeScale` (render/presentation only; sweet-spot and scoring bookkeeping
all happen inside `fixedUpdate`).

## Mock host (`host-mock.mjs`)

The full host surface is defined by `logic/ffi/host.js.mbt`: method calls on
`host.render / audio / ui / camera / input` plus a few top-level methods.
Two details shape the design:

- `host_sfx` dispatches **dynamically** (`h.audio[n]()`), so enumerating
  method names is fragile → use a `Proxy` returning a no-op function for any
  property.
- Match completion is signaled to JS via `host_show_results` → `ui`; the mock
  intercepts it to stop the step loop.

```js
export function makeHost(state) {
  const noop = new Proxy({}, { get: () => () => 0 });
  return {
    render: noop,
    audio: noop,
    camera: noop,
    ui: new Proxy({}, {
      get: (_, name) =>
        name === 'showResults'
          ? (...args) => { state.done = true; }
          : () => 0,
    }),
    input: {
      moveX: () => 0, moveZ: () => 0,
      shotKey: () => '', shotHeld: () => '',
      wasPressed: () => false, isDown: () => false,
      touchStroke: () => '', touchServe: () => '',   // String externs, not Bool
      haptic: () => {},
    },
    loadAssist: () => 'off',
    saveAssist: () => {},
    onMatchStart: () => {}, onPointHighlight: () => {},
    onTension: () => {}, onPointSituation: () => {},
    onCrowdReact: () => {},
  };
}
```

The `input` object is written out explicitly (zeroed) rather than proxied, as
documentation of the pull surface; in CPU mode the logic never consults it
anyway. Implementation must reconcile this method list against
`host.js.mbt` (source wins).

## Job format

`run_match.mjs --job path.json` (or the job JSON on stdin):

```jsonc
{
  "params": { "stroke_err_x": 0.42, "run_speed_scale": 1.1 },  // may be {}
  "matches": [
    { "seed": 1000, "you": 4, "opp": 4, "surface": "hard",
      "difficulty": "hard", "games": 4 }
  ],
  "max_steps": 400000        // per match; 400k steps ≈ 27.8 min simulated
}
```

- `you` / `opp`: character indices 0–4 (Boom, Rojo, Dash, Sly, Ace — order
  of `@shots.characters`).
- `surface`: `"clay" | "grass" | "hard"` → setup index 0/1/2
  (`surface_ids`, game.js.mbt:8).
- `difficulty`: `"easy" | "normal" | "hard"` → index 0/1/2. Both AIs use the
  same difficulty (it is a single global selector).
- `games`: 2 | 4 | 6 → games-row value index 0/1/2 (`games_options`).

## Per-match sequence

```js
const state = { done: false };
const host = makeHost(state);
logic.init(host, seed);          // fresh Game per match — clean state per seed
logic.resetParams();
for (const [k, v] of Object.entries(params)) {
  if (!logic.setParam(k, v)) throw new Error(`unknown param: ${k}`);
}
logic.setCpuMode(1);
// menu bootstrap — MATCH-mode setup rows are [Mode, Surface, Assist, Difficulty, Games]
logic.menuCmd('play', 0, 0);          // title → setup
logic.menuCmd('set', 0, 0);           // Mode row → MATCH (never rely on default)
logic.menuCmd('set', 1, surfaceIdx);  // Surface row
logic.menuCmd('set', 2, 0);           // Assist row → Off
logic.menuCmd('set', 3, difficultyIdx);
logic.menuCmd('set', 4, gamesIdx);
logic.menuCmd('go', 0, 0);            // setup → players
logic.menuCmd('you', youIdx, 0);
logic.menuCmd('opp', oppIdx, 0);
logic.menuCmd('go', 0, 0);            // start_match()
// step loop
const DT = 1 / 240;
let steps = 0;
while (!state.done && steps < maxSteps) { logic.fixedUpdate(DT); steps++; }
const report = state.done ? JSON.parse(logic.getMatchStats()) : null;
```

Each result is wrapped as:

```jsonc
{ "seed": 1000, "steps": 123456, "wall_ms": 812, "timed_out": false,
  "report": { /* doc 03 */ } }
```

`timed_out: true` (step cap hit) carries the **live partial report**
(`finished: false` — `getMatchStats()` snapshots mid-match). The Python side
excludes unfinished reports from metric computation and penalizes them via
`timeout_rate`; the partial data is kept for diagnostics (e.g. "0 points in
41 sim-minutes" pinpoints the endless-rally regime).

**Important reality check**: with the current default parameters,
CPU-vs-CPU matches essentially never finish — both AIs retrieve everything
and the stroke error model almost never produces an out (verified: 0 points
in 10 sim-minutes on hard, ~2 points/5 min on easy). A tuning study's
search space must include error-increasing dimensions (`stroke_err_*`,
`run_speed_scale`, `ai_*_scale`) for matches to complete; goldens use
fixed-step partial reports, which don't require completion.

## Output & logging

stdout: exactly one JSON document
`{ "runner_version": 1, "results": [ ... ] }`.
All diagnostics go to stderr. Exit code 0 even with timeouts (they are
results); non-zero only for infrastructure errors (missing bundle, unknown
param, bad job).

A light sanity pass runs on each report (invariants from doc 03, plus one
end-to-end bootstrap check: the game score must be consistent with the
requested `games` target); violations are warnings on stderr, not fatal —
the tuning loop must not die mid-study because one report looks odd, but the
warning must be visible in the trial log.

## Modes

- `--job path | stdin` — batch run (the normal mode).
- `--bench` — run one **unmeasured warm-up match** (JIT/module-init), then
  one measured match (Ace vs Ace, hard court, hard difficulty, games=4,
  seed 1) and print steps/sec and ×realtime to stderr.
- `--golden dir` — run a small default-params matrix and write each report
  to `dir/<surface>-<you><opp>-<seed>.json` (used by the Stage-C byte-diff
  check). Each golden run uses a **fixed step count** (e.g. 240×300 = 5
  sim-minutes) and records the partial report — completion is not required
  (defaults rally forever) and the byte-diff is just as sensitive. The
  matrix covers all use sites a registry typo could hide in: 3 surfaces ×
  {Ace/Ace, Boom/Sly (serve+slice heavy), Rojo/Dash (topspin+speed heavy)}
  × seeds 1000–1002 — 27 small files, checked in under
  `scripts/autotune/goldens/`.

## Determinism & performance checks

1. **Determinism**: run the same seed in two fresh processes; compare the
   raw `getMatchStats()` strings — they must be byte-identical.
2. **Symmetry**: mirror matchup (`you === opp`) over ≥50 seeds → P's
   serve-point win rate vs C's within the binomial 95% band (see doc 01
   "Symmetry validation" — raw point share is confounded because P always
   serves first).
3. **Throughput**: acceptance floor 100× realtime (i.e. ≥24,000
   `fixedUpdate` steps/sec, single process, after warm-up). The measured
   number is recorded in the Stage-B verification notes and feeds the
   study-duration estimate in doc 05.

## npm script

`package.json` gains `"autotune:match": "node scripts/autotune/run_match.mjs"`
(convenience only; tune.py invokes the script path directly).
