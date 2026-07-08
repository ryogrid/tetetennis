# Match Report Schema

## Source

`getMatchStats()` (exported from `logic/game/autotune.js.mbt`) returns the
JSON report of the current match as a string. **During a match it is a live
partial snapshot** (`finished: false`, `winner: ""`); after completion it is
the final report built by `build_report` in `point_over_step` immediately
**before** `teardown_match()` destroys the `MatchState` (see doc 01), stored
in `Game.last_report`; `""` if no match has started since `init`.

The live path is essential: badly-tuned parameter sets (including, it turns
out, the **current defaults** — two frame-perfect AIs rally practically
forever) never finish a match, and the runner still needs deterministic
partial stats at its step cap for timeout penalties and for goldens.

JSON is produced by MoonBit string interpolation (no JSON library needed);
all numbers are plain decimals, all keys fixed. The Node runner parses it
with `JSON.parse` and attaches runner metadata (`seed`, `steps`, `wall_ms`,
`timed_out`).

## Sides

`"p"` is the side configured as `you` in the runner job, `"c"` is `opp`.
In CPU-vs-CPU mode both are AI-driven; the P/C naming just follows the
engine's internal side labels.

## Schema

```jsonc
{
  "schema": 1,                 // bump on breaking change
  "finished": true,            // false = live/partial snapshot (step cap hit)
  "winner": "p",               // "p" | "c" | "" (unfinished)
  "games_p": 4, "games_c": 2,  // final game score
  "tb_points_p": 0, "tb_points_c": 0,   // 0/0 unless a tiebreak was played
  "duration_s": 412.5,         // simulated match time (sum of fixed steps)
  "points_played": 58,
  "total_rally_shots": 361,    // includes serves, summed over points

  // aggregate MatchStats (game.js.mbt:155), key-mapped per side
  // (p_winners → p.winners, p_run → p.run_m, etc.; the transient
  // p_came_net/c_came_net flags are not exported)
  "p": {
    "winners": 11, "unforced": 15, "double_faults": 2,
    "first_serves": 30, "first_in": 19,
    "run_m": 812.4,
    "net_pts": 6, "net_won": 4
  },
  "c": { /* same fields */ },

  // per-point log, in play order
  "points": [
    {
      "server": "p",           // who served this point
      "serve_number": 1,       // 1 = first serve in, 2 = second serve (or DF)
      "winner": "c",           // who won the point
      "rally_shots": 7,        // strokes AFTER the serve (0 = unreturned
                               // serve; the engine's rally counter never
                               // counts the serve itself, and changing that
                               // would alter the shipped stats display)
      "end_kind": "unforced",  // see below
      "duration_s": 9.4        // sim seconds from first serve attempt to
                               // point decided (excludes inter-point pause;
                               // needs MatchState.point_start_t, doc 01)
    }
  ]
}
```

### `end_kind`

Recorded via a new `MatchState.last_end_kind` set at the existing attribution
sites and consumed by `point_end` (`game.js.mbt:1134`), which already knows
`winner` and `rally_shots`:

| value | set at | meaning |
| --- | --- | --- |
| `"winner"` | `record_winner` (:1108) | clean winner / double bounce |
| `"unforced"` | `record_error` (:1117) | hitter's error (out / net) |
| `"double_fault"` | the DF site near :1100 | second serve fault |
| `"other"` | fallback | should not occur; presence signals a logic gap |

The engine's attribution is coarse (no forced-error class); the Python
metric layer works with these four kinds. `ace` is *derived*, not stored:
`rally_shots == 0 && end_kind == "winner" && winner == server` (an
unreturned serve that double-bounced; `rally_shots` excludes the serve).

### `PointRecord`

```moonbit
struct PointRecord {
  server : Int        // 0 = P, 1 = C
  serve_number : Int  // 1 | 2
  winner : Int        // 0 = P, 1 = C
  rally_shots : Int
  end_kind : Int      // 0 winner, 1 unforced, 2 double_fault, 3 other
  duration : Double
}
```

Pushed onto `MatchState.point_log` in `point_end`. Ints are mapped to the
string enums by `build_report`.

## Invariants (checked by the runner's sanity pass and Stage-A verification)

- `points.length == points_played`
- `sum(points[].rally_shots) == total_rally_shots` (both exclude serves)
- points won per side sum consistently with the game score progression
- `p.first_serves + c.first_serves >= points_played`. **Per-attempt
  semantics**: `first_serves` increments on every `execute_serve` with
  `serve_number == 1` (`game.js.mbt:873-877`), and a let (`let_serve`,
  `:1126`) replays the serve without advancing `serve_number` — so one
  point can contribute multiple first-serve attempts. `first_serve_in_pct`
  (doc 05) is therefore a per-attempt rate, matching how the stat is shown
  on the results screen.
- `serve_number == 2` whenever the point followed a first-serve fault;
  `end_kind == "double_fault"` implies `serve_number == 2`
- server alternates by game (and by point pair within a tiebreak) per
  `logic/rules/rules.mbt`
- `duration_s > 0`, every `points[].duration_s > 0`

## Extension: bounce heatmap (deferred)

A coarse court-zone histogram of landing positions (e.g. 3×4 zones per half)
was considered and deferred: current fitness metrics don't consume it, and it
can be added later as `"bounce_zones": [[...]]` without a schema break
(additive field, `schema` stays 1 until a field changes meaning).
