# tetetennis — AFTER elements, ready for the codebase

This folder turns the **AFTER** (improved) UI proposals from the review cards
(`ui_kits/tetetennis/*-review.html`) into **drop-in code for the real game** —
written in the same vanilla-JS idiom as `src/ui.js`, not React.

- **`ui-after.js`** — pure presentational builders + a `CSS_AFTER` block. Each
  function returns markup (or patches an element) from data the MoonBit logic
  *already* passes today.
- **`title-state.patch.md`** — the full **option (b)** implementation of the
  Title screen as a first-class MoonBit `MenuTitle` state (enum + FFI extern +
  `handle_input`/`menu_cmd` arms + the `ui.js` `showTitle()` method).

> The React components in this design system
> (`components/game/StatRadar.jsx`, `StatBar.jsx`, `Scoreboard.jsx`,
> `CharacterCard.jsx`) are the same designs for **prototyping inside the design
> system**. `ui-after.js` is the same designs for **shipping in the game**.

---

## Does this preserve the MoonBit-logic / JS-render split? — **Yes.**

tetetennis is layered:

| Layer | Owns | Files |
|---|---|---|
| **MoonBit logic** | game state, rules, scoring, physics, AI, all score/stat *formatting* | `logic/**.mbt` |
| **JS render + sound** | drawing (three.js), DOM overlay, audio | `src/**.js` |

The two meet at **one seam**: `createUI()` in `src/ui.js` returns a `host.ui`
object, and the MoonBit logic *drives* it by calling methods
(`showSetup`, `showPlayers`, `showResults`, `updateScore`, `gauge`, `charge`…).
`src/ui.js` holds **no game state** — it only renders what it is told.

Every AFTER element is a change to **how that DOM is drawn**, using data the
logic already sends. So:

- ✅ **MoonBit is untouched** for items 1–5 below — same method names, same
  arguments. You are only changing the HTML/CSS produced inside `src/ui.js`.
- ⚠️ **One small FFI hook** for item 6 (Title screen), because a title is a new
  *menu state* and MoonBit owns state. Even there, the view stays in JS; only a
  new `Title` state + `play` command join the existing `menuCmd` path.
- 🎾 The in-match **ball glow** is in the three.js render layer (not the DOM),
  so it changes `src/entities/` + `src/render-host.js`, again **JS-only** —
  MoonBit owns the ball's position, the render layer owns its look.

In short: the architecture is not just *preserved* — these improvements live
exactly where the architecture says rendering belongs.

---

## Per-element integration map

| # | AFTER element | `ui-after.js` export | Where in `src/ui.js` | MoonBit change |
|---|---|---|---|---|
| 1 | Persona radar tinted by character color | `statRadar(stats, color)` | swap the `statBars(c.stats)` call in `charCard()` for `statRadar(c.stats, hex(c.color))` | **none** |
| 2 | Scoreboard reads as a card (hairline, GMS/PTS header, serve dot) | `scoreboardCardHTML(...)` + CSS | replace the `innerHTML` in `updateScore()` | **none** |
| 3 | Results: diverging head-to-head stat bars | `resultsStatBarsHTML(stats, you, opp)` + CSS | replace the `<table class="matchstats">` in `showResults()` | **none** (label-inferred; optional richer FFI noted in code) |
| 4 | Setup: live court preview of the chosen surface | `courtPreviewHTML(surfaceIdx)` + CSS | wrap `.setup` + preview in `.setup-wrap` in `showSetup()` | **none** |
| 5 | Practice: distinct header + descriptive FEED options | `practiceHeaderHTML()`, `feedOptionHTML(...)` + CSS | the `isPractice` branch of `showSetup()` | **none** (`FEED_OPTIONS` already carry `desc`) |
| 6 | Title / brand entry screen | `titleScreenHTML(logoSrc)` + CSS | new `showTitle()` method, mirrors `showSetup()` | **implemented** — real MoonBit `MenuTitle` state, see `title-state.patch.md` |
| — | In-match ball glow | *(note in code)* | `src/entities/` + `src/render-host.js` | **none** (render layer) |

Also worth a look: **GAMES as chips.** `src/ui.js` already lays setup rows out
as chips on desktop (`isDesktop`) and as a `◂ value ▸` stepper on touch. If the
build you reviewed showed GAMES as a stepper on desktop, it's a one-line fix —
pass `isDesktop` (as the other rows do) for the GAMES `optRow`. Keep the stepper
on touch where it's the easier target.

---

## How to apply

1. Open `src/ui.js`.
2. Append the `CSS_AFTER` string to the module's existing `css` template.
3. Paste in the builder functions you want (and the tiny `hex()` / `colorForName()`
   helpers). They use the `SURFACE_THEMES` / `CHARACTERS` imports `ui.js` already has.
4. Swap the marked lines (see the table + the comment above each function).
5. For the Title screen, apply `title-state.patch.md` — it adds a real MoonBit
   `MenuTitle` state (six small additive edits) plus the `ui.js` `showTitle()`.

No build-tool, bundler, or dependency change is required — `src/ui.js` is plain
ES modules, same as today.

---

## Source

Built against `ryogrid/tetetennis` (`src/ui.js`, `src/main.js`, `src/court.js`,
`src/characters.js`). Explore that repo to extend these or match new screens:
<https://github.com/ryogrid/tetetennis>
