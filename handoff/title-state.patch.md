# Title screen — option (b): a real MoonBit `MenuTitle` state

This implements the branded entry screen as a **first-class menu state owned by
MoonBit**, exactly like `MenuSetup` / `MenuPlayers`. The logic stays the state
owner; the JS layer only draws what it is told and forwards the tap. Six small,
additive edits — no existing behavior changes.

Verified against `logic/game/game.js.mbt`, `logic/ffi/host.js.mbt`,
`logic/game/moon.pkg.json`, and `src/ui.js` at `ryogrid/tetetennis@master`.

Flow: **MenuTitle** → (Enter / Space / tap PLAY) → **MenuSetup** → … (unchanged).

---

## Apply it as a git patch

`handoff/title-state.patch` is a unified diff against `master` HEAD. It now
contains **all 7 edits** anchored to the exact current source
(`host.js.mbt` ×1, `game.js.mbt` ×5: enum + helpers + `handle_input` +
`menu_cmd` + `game_init`, `src/ui.js` ×3: CSS + `showTitle` + the return list).
Copy that file into the repo root and:

```bash
# from the repo root, on a clean working tree
git checkout master && git pull          # be on current HEAD
git switch -c feat/title-screen          # a topic branch

# context-based apply (most forgiving — locates hunks by surrounding lines,
# not line numbers, so it survives small drift in the real files)
git apply --recount --reject handoff/title-state.patch

# any hunk that didn't match its context lands as a *.orig/*.rej next to the
# file; open the .rej and place those few lines by hand, then delete the .rej.
```

If `git apply` is fussy, GNU `patch` is even more tolerant of line drift:

```bash
patch -p1 --fuzz=3 < handoff/title-state.patch
```

Then build and commit:

```bash
moon build               # confirm the MoonBit side compiles
git add -A && git commit -m "feat: branded title (MenuTitle) screen"
```

> The `game_init` and `menu_cmd` hunks were generated from the verbatim source
> you provided, so the whole change applies in one shot. §2 below documents each
> edit for review; the patch is the source of truth.

---


## 1 · `logic/ffi/host.js.mbt` — add the UI extern  *(in the patch)*

Next to `host_show_setup`, add:

```moonbit
///|
// Title / brand entry screen (option b). No args — the JS UI owns the markup.
pub extern "js" fn host_show_title(h : Host) -> Unit = "(h)=>h.ui.showTitle()"
```

## 2 · `logic/game/game.js.mbt` — add the state

**2a. Extend the `AppState` enum** (add `MenuTitle` as the first variant so the
app opens on it):

```moonbit
///|
enum AppState {
  MenuTitle  // NEW: branded entry screen, before setup
  MenuSetup
  MenuPlayers
  Match
  Results
} derive(Eq)
```

**2b. Add two helpers** next to `fn show_setup` / `fn back_to_home`:

```moonbit
///|
fn show_title(self : Game) -> Unit {
  @ffi.host_show_title(self.host)
}

///|
// Title → Setup. Reused by both the keyboard (handle_input) and the tap
// (menu_cmd) paths so the transition lives in one place.
fn title_to_setup(self : Game) -> Unit {
  self.state = MenuSetup
  self.setup_row = 0
  @ffi.host_sfx(self.host, "sfxConfirm")
  self.show_setup()
}
```

**2c. Open on the title.**  *(in the patch)*  In `game_init` (exported as
`init`): the initial `state: MenuSetup,` becomes `state: MenuTitle,`, and the
final `self.show_setup()` becomes `self.show_title()`. Everything else in
`game_init` (RNG seed, assist load, `the_game.val = Some(...)`) stays as-is.

**2d. Handle the keyboard in `handle_input`.** Add a `MenuTitle` arm to the
`match self.state { … }` (mirrors the other menu arms):

```moonbit
    MenuTitle =>
      if self.confirm_pressed() {
        self.title_to_setup()
      }
```

(`confirm_pressed` already returns true for Enter or Space.)

**2e. Handle the tap in `menu_cmd`**  *(in the patch)*  (exported as `menuCmd`,
called by the JS menu tap handler as `menuCmd(action, a, b)`). A `MenuTitle` arm
is added to the `match self.state` so a PLAY tap (`data-cmd="play"`) advances:

```moonbit
  match self.state {
    MenuTitle =>
      if action == "play" {
        self.title_to_setup()
      }
    Results => self.back_to_home()
    // … MenuSetup / MenuPlayers / Match unchanged …
```

That is the **entire** MoonBit change: one enum variant, one extern, two
helpers, one initial-state flip, one `handle_input` arm, one `menu_cmd` guard.

---

## 3 · `src/ui.js` — draw the screen + expose `showTitle`  *(in the patch)*

`ui.js` already (a) injects the menu CSS, (b) routes `data-cmd` taps through
`menuTapHandler` → `menuCmd`, and (c) keyboard goes through `host.input`. So the
only additions are a `showTitle()` builder, its CSS, and exposing it on the
returned `ui` object.

**3a. Append to the `css` template string** (the title block from
`handoff/ui-after.js`'s `CSS_AFTER`):

```css
.title-screen { position:absolute; inset:0; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:16px; overflow:hidden;
  background:radial-gradient(130% 90% at 50% 12%, #1a2230 0%, #0d0d14 60%); }
.ts-court { position:absolute; left:50%; bottom:-8%; width:150%; height:60%;
  transform:translateX(-50%) perspective(620px) rotateX(60deg); transform-origin:bottom center; opacity:.22;
  background:
    linear-gradient(90deg, transparent calc(18% - 2px), rgba(255,255,255,.5) 18%, transparent calc(18% + 2px)),
    linear-gradient(90deg, transparent calc(82% - 2px), rgba(255,255,255,.5) 82%, transparent calc(82% + 2px)),
    linear-gradient(0deg,  transparent calc(50% - 2px), rgba(255,255,255,.6) 50%, transparent calc(50% + 2px)); }
.ts-logo { border-radius:24px; box-shadow:0 0 40px rgba(232,242,75,.35); position:relative; }
.ts-word { font:800 56px sans-serif; letter-spacing:2px; color:#e8f24b; text-shadow:0 0 30px rgba(232,242,75,.4); margin:2px 0 -4px; }
.ts-tag { font:600 13px sans-serif; letter-spacing:6px; color:#aaa; }
.ts-hint { font:600 12px sans-serif; letter-spacing:3px; color:#888; animation:ts-pulse 1.6s ease-in-out infinite; }
@keyframes ts-pulse { 0%,100%{opacity:.45} 50%{opacity:1} }
@media (pointer: coarse) { .ts-word { font-size:40px; } }
```

**3b. Add the builder** inside `createUI()` (near `showSetup`). It reuses the
existing `.startbtn` style and the `data-cmd="play"` tap contract:

```js
function showTitle() {
  els.menu.style.display = 'flex';
  els.menu.dataset.screen = 'title';
  els.menu.innerHTML = `
    <div class="title-screen">
      <div class="ts-court"></div>
      <img class="ts-logo" src="icon-192.png" alt="" width="108" height="108"/>
      <div class="ts-word">tetetennis</div>
      <div class="ts-tag">ARCADE TENNIS</div>
      <div class="startbtn" data-cmd="play" data-arg="0">&#9654; PLAY</div>
      <div class="ts-hint">PRESS ENTER OR TAP</div>
    </div>`;
}
```

**3c. Expose it** on the object `createUI` returns — add `showTitle,` to the
`return { … }` list (next to `showSetup, showPlayers`).

The existing `els.menu` `pointerdown` handler already turns the PLAY tap into
`menuTapHandler('play', 0, 0)` → `menuCmd('play', 0, 0)`, which 2e handles. No
input wiring changes.

---

## Why this keeps the architecture intact

- **State** (which screen we're on, the PLAY transition) lives in MoonBit —
  `MenuTitle`, `title_to_setup`, the `handle_input`/`menu_cmd` arms.
- **Rendering** (the logo, wordmark, court motif) lives in `src/ui.js` —
  `showTitle()` + CSS.
- They meet only at the existing seam: MoonBit calls `host_show_title` →
  `h.ui.showTitle()`, and the tap returns through the existing
  `menuCmd` channel. No new FFI shape, no game state in JS, no bundler change.

## Optional polish (not required)

- **Back to title from setup:** add `Escape` handling to the `MenuSetup` arm of
  `handle_input` (`self.state = MenuTitle; self.show_title()`) if you want the
  title reachable again without a reload.
- **Attract music / SFX:** `show_title` could call `@ffi.host_sfx(self.host, "sfxMenu")`
  or a dedicated cue when the title appears.
