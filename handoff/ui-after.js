// ui-after.js — drop-in presentational builders for the AFTER (improved) UI.
//
// ── Architecture note ────────────────────────────────────────────────────────
// tetetennis keeps game STATE + RULES in the MoonBit logic layer (logic/, .mbt)
// and DRAWING + SOUND in the JS layer (src/, three.js + DOM). The MoonBit logic
// drives the DOM overlay only through the `host.ui` method surface built by
// createUI() in src/ui.js (showSetup / showPlayers / showResults / updateScore /
// gauge / charge …). src/ui.js holds NO game state.
//
// Every function below is PURE PRESENTATION — it returns markup (or patches an
// element) from data the logic ALREADY passes today. So they slot into the
// existing src/ui.js with the SAME method signatures: the MoonBit ↔ JS boundary
// is untouched. The only element that needs a new FFI hook is the optional
// Title screen (it introduces a new menu state) — see TITLE below.
//
// These mirror, 1:1, the React components in this design system
// (components/game/StatRadar, StatBar, Scoreboard, CharacterCard) so the look is
// identical whether you prototype in the DS or ship in the game.
//
// Integration: paste the functions you want into src/ui.js (it is a single
// factory module), append CSS_AFTER to its `css` string, and swap the marked
// lines. Each block lists exactly what to change. No build-tool change needed.
//
// DEPENDENCIES (already imported at the top of src/ui.js — nothing to add):
//   import { SURFACE_THEMES } from './court.js';
//   import { CHARACTERS }     from './characters.js';
// These functions assume those two symbols are in scope, exactly as they are
// inside src/ui.js today. (That is why this file declares no imports of its
// own — it is snippet source for ui.js, not a standalone module.)
// ─────────────────────────────────────────────────────────────────────────────

// helper: MoonBit character colors are numbers (e.g. 0xd84a3a) → "#rrggbb"
function hex(n) {
  return '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);
}

/* ===========================================================================
 * 1. TINTED PERSONA RADAR    (replaces statBars() in src/ui.js)
 * MoonBit impact: NONE. charCard already has the character's color in scope.
 * Change in charCard():  ${statBars(c.stats)}  →  ${statRadar(c.stats, hex(c.color))}
 * =========================================================================== */
export function statRadar(stats, color = '#50e678') {
  const axes = ['POW', 'SPN', 'SLC', 'SRV', 'SPD', 'CTL', 'REA', 'NET'];
  const n = axes.length, cx = 90, cy = 80, R = 60;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  let grid = '';
  for (const f of [0.25, 0.5, 0.75, 1]) {
    grid += `<polygon points="${axes.map((_, i) => pt(i, R * f).map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="rgba(255,255,255,.12)"/>`;
  }
  let spokes = '', labels = '';
  axes.forEach((k, i) => {
    const [ex, ey] = pt(i, R);
    spokes += `<line x1="${cx}" y1="${cy}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="rgba(255,255,255,.12)"/>`;
    const [lx, ly] = pt(i, R + 12);
    labels += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="#9aa" font-size="9" text-anchor="middle" dominant-baseline="middle">${k}</text>`;
  });
  const poly = axes.map((k, i) => pt(i, R * (stats[k] || 0) / 100).map((v) => v.toFixed(1)).join(',')).join(' ');
  // only change vs the current statBars(): fill + stroke use `color` (the
  // character's signature color) instead of a fixed green.
  return `<svg class="statradar" viewBox="0 0 180 165" width="180" height="165">${grid}${spokes}` +
    `<polygon points="${poly}" fill="${color}" fill-opacity="0.26" stroke="${color}" stroke-width="1.5"/>${labels}</svg>`;
}

/* ===========================================================================
 * 2. SCOREBOARD CARD    (replaces the innerHTML in updateScore())
 * MoonBit impact: NONE. Same args the logic passes today.
 * gp/gc = games, pp/pc = points (already split by splitPair), serveNo, tb flag.
 * Adds: 1px hairline + GMS/PTS header + a glowing serve dot per row.
 * =========================================================================== */
export function scoreboardCardHTML(p, c, gp, gc, pp, pc, serveNo, tb, serverRow) {
  const row = (name, g, pts, serving) => `
    <div class="row">
      <b class="${serving ? 'serve' : ''}"><i class="sb-dot${serving ? ' on' : ''}"></i>${name}</b>
      <span><i class="sb-g">${g}</i><i class="sb-p">${pts}</i></span>
    </div>`;
  return `
    <div class="sb-head"><span>GMS</span><span>PTS</span></div>
    ${row(p, gp, pp, serverRow === 0)}
    ${row(c, gc, pc, serverRow === 1)}
    ${serveNo === 2 ? '<div class="sb-note amber">2nd serve</div>' : ''}
    ${tb === 'TB' ? '<div class="sb-note ball">Tiebreak</div>' : ''}`;
}

/* ===========================================================================
 * 3. RESULTS DIVERGING STAT BARS    (replaces the <table> in showResults())
 * MoonBit impact: NONE. Parses the SAME ';'-separated "Label\tYou\tOpp" string
 * the logic already sends. Percentage + "lower wins" are inferred from the
 * label, so no new FFI fields are required (see note for a cleaner option).
 * Colors look up the two players in CHARACTERS by name (fallback ball/signal).
 * =========================================================================== */
export function resultsStatBarsHTML(statsStr, youName, oppName) {
  const youColor = colorForName(youName, '#e8f24b');
  const oppColor = colorForName(oppName, '#50e678');
  const rows = (statsStr || '').split(';').filter(Boolean).map((r) => {
    const [label, youRaw, oppRaw] = r.split('\t');
    const pct = /%/.test(youRaw + oppRaw + label);
    const lowerWins = /error|fault|unforced/i.test(label);
    const you = parseFloat(youRaw), opp = parseFloat(oppRaw);
    const youWins = lowerWins ? you < opp : you > opp;
    const scale = pct ? 100 : Math.max(you, opp, 1) * 1.15;
    const lp = Math.min(100, (you / scale) * 100), rp = Math.min(100, (opp / scale) * 100);
    return `
      <div class="sbar">
        <div class="sbar-n l ${youWins ? 'win' : ''}" style="${youWins ? `color:${youColor}` : ''}">${youRaw}</div>
        <div class="sbar-t"><i style="width:${lp}%;background:${youColor};opacity:${youWins ? 1 : 0.45}"></i></div>
        <div class="sbar-k">${label}</div>
        <div class="sbar-t r"><i style="width:${rp}%;background:${oppColor};opacity:${youWins ? 0.45 : 1}"></i></div>
        <div class="sbar-n r ${youWins ? '' : 'win'}" style="${youWins ? '' : `color:${oppColor}`}">${oppRaw}</div>
      </div>`;
  }).join('');
  return `<div class="sbars">${rows}</div>`;
  // Cleaner option (small FFI touch, optional): have the logic tag each stat
  // with flags, e.g. "Label\tYou\tOpp\tpct\tlower", and read them here instead
  // of inferring from the label text. Not required for the look above.
}

function colorForName(name, fallback) {
  const c = CHARACTERS.find((ch) => ch.name === name);
  return c ? hex(c.color) : fallback;
}

/* ===========================================================================
 * 4. SETUP COURT PREVIEW    (append to the setup screen in showSetup())
 * MoonBit impact: NONE. Reads the surface index the logic already passes.
 * In showSetup(): wrap the existing `.setup` rows and this preview in a
 * flex container, e.g.
 *   `<div class="setup-wrap"><div class="setup">${rows.join('')}</div>
 *      ${courtPreviewHTML(surface)}</div>`
 * =========================================================================== */
export function courtPreviewHTML(surfaceIdx) {
  const ids = ['clay', 'grass', 'hard'];
  const t = SURFACE_THEMES[ids[surfaceIdx]] || SURFACE_THEMES.hard;
  const court = hex(t.court);
  return `
    <div class="court-preview">
      <div class="cp-label">COURT</div>
      <div class="cp-court" style="background:${court};box-shadow:0 0 0 1px rgba(255,255,255,.12),0 6px 18px ${court}44">
        <i class="cp-line cp-top"></i><i class="cp-line cp-bot"></i>
        <i class="cp-line cp-left"></i><i class="cp-line cp-right"></i>
        <i class="cp-line cp-mid"></i><i class="cp-line cp-net"></i>
      </div>
      <div class="cp-name" style="color:${court}">${t.label}</div>
    </div>`;
}

/* ===========================================================================
 * 5. PRACTICE HEADER + DESCRIPTIVE FEED    (tweak to the practice branch of
 * showSetup()). MoonBit impact: NONE. FEED_OPTIONS already carry `desc`.
 * Use practiceHeaderHTML() above the rows when isPractice, and render the FEED
 * row's chips with their description via feedOptionHTML().
 * =========================================================================== */
export function practiceHeaderHTML() {
  return `
    <div class="title">PRACTICE</div>
    <div class="practice-badge"><i></i>NO SCORE · ENDLESS FEED · QUIT ANYTIME</div>`;
}

// a single descriptive FEED option (drop into the FEED row instead of a bare
// chip). rowIdx/optIdx keep the existing data-cmd="set" tap contract intact.
export function feedOptionHTML(rowIdx, optIdx, name, desc, active) {
  return `<button class="feed-opt${active ? ' on' : ''}" data-cmd="set" data-arg="${rowIdx}" data-arg2="${optIdx}">
    <div class="feed-name">${name}</div><div class="feed-desc">${desc}</div>
  </button>`;
}

/* ===========================================================================
 * 6. TITLE SCREEN    (NEW — implemented as a real MoonBit `MenuTitle` state)
 * The game currently boots straight into GAME SETUP. A branded entry is a new
 * menu STATE, owned by MoonBit. The full, verified patch (enum variant, FFI
 * extern, two helpers, handle_input + menu_cmd arms, and the ui.js showTitle()
 * method) is in handoff/title-state.patch.md. This function is the view used by
 * that ui.js showTitle() builder.
 * =========================================================================== */
export function titleScreenHTML(logoSrc = 'icon-192.png') {
  return `
    <div class="title-screen">
      <div class="ts-court"></div>
      <img class="ts-logo" src="${logoSrc}" alt="" width="108" height="108"/>
      <div class="ts-word">tetetennis</div>
      <div class="ts-tag">ARCADE TENNIS</div>
      <div class="startbtn" data-cmd="play" data-arg="0">&#9654; PLAY</div>
      <div class="ts-hint">PRESS ENTER OR TAP</div>
    </div>`;
}

/* ===========================================================================
 * NOT in this file — the in-MATCH HUD ball glow (review fix #2) lives in the
 * THREE.js render layer, not the DOM overlay. Make the ball mesh readable on
 * the dark court by giving its material an emissive (e.g. emissive 0xe8f24b,
 * emissiveIntensity ~0.5) or adding an outline/sprite halo where the ball mesh
 * is built (src/entities/ + src/render-host.js). Still JS-only; MoonBit owns
 * the ball's POSITION, the render layer owns how it LOOKS.
 * =========================================================================== */

/* ===========================================================================
 * CSS — append this to the `css` template string in src/ui.js.
 * =========================================================================== */
export const CSS_AFTER = `
/* 2. scoreboard as a self-standing card */
#scoreboard { border: 1px solid rgba(255,255,255,.18); box-shadow: 0 4px 16px rgba(0,0,0,.4); }
#scoreboard .sb-head { display:flex; justify-content:flex-end; gap:14px; padding:0 0 4px; margin-bottom:4px;
  border-bottom:1px solid rgba(255,255,255,.08); font:700 10px sans-serif; letter-spacing:1px; color:#888; }
#scoreboard .sb-head span:first-child { width:18px; text-align:center; }
#scoreboard .sb-head span:last-child  { width:24px; text-align:center; }
#scoreboard .row b { display:flex; align-items:center; gap:7px; }
#scoreboard .sb-dot { width:8px; height:8px; border-radius:50%; background:transparent; flex:0 0 auto; }
#scoreboard .sb-dot.on { background:#e8f24b; box-shadow:0 0 6px #e8f24b; }
#scoreboard .sb-g { display:inline-block; width:18px; text-align:center; }
#scoreboard .sb-p { display:inline-block; width:24px; text-align:center; font-weight:700; }
#scoreboard .sb-note { font-size:12px; padding:2px 0; }
#scoreboard .sb-note.amber { color:#e8a04b; }
#scoreboard .sb-note.ball  { color:#e8f24b; }

/* 3. results diverging stat bars */
.sbars { display:flex; flex-direction:column; gap:9px; margin:6px 0; }
.sbar { display:grid; grid-template-columns:46px 1fr 130px 1fr 46px; align-items:center; gap:10px; width:540px; max-width:92vw; }
.sbar-n { font:700 15px sans-serif; color:#888; }
.sbar-n.l { text-align:right; } .sbar-n.r { text-align:left; }
.sbar-t { height:12px; position:relative; background:#2a2a36; border-radius:3px; }
.sbar-t i { position:absolute; top:0; bottom:0; right:0; border-radius:3px; }
.sbar-t.r i { right:auto; left:0; }
.sbar-k { text-align:center; font:600 12px sans-serif; letter-spacing:.5px; color:#9aa; }

/* 4. setup court preview */
.setup-wrap { display:flex; gap:18px; align-items:flex-start; }
.court-preview { display:flex; flex-direction:column; align-items:center; gap:8px; padding-top:30px; }
.cp-label { font:700 11px sans-serif; letter-spacing:2px; color:#888; }
.cp-court { width:132px; height:84px; position:relative; border-radius:8px; overflow:hidden; }
.cp-name { font:700 14px sans-serif; }
.cp-line { position:absolute; background:rgba(255,255,255,.85); }
.cp-top{left:8px;right:8px;top:8px;height:2px} .cp-bot{left:8px;right:8px;bottom:8px;height:2px}
.cp-left{left:8px;top:8px;bottom:8px;width:2px} .cp-right{right:8px;top:8px;bottom:8px;width:2px}
.cp-mid{left:50%;top:8px;bottom:8px;width:2px;margin-left:-1px}
.cp-net{left:8px;right:8px;top:50%;height:3px;margin-top:-1.5px;background:rgba(255,255,255,.95)}
@media (pointer: coarse) { .setup-wrap { flex-direction:column; align-items:center; } .court-preview { padding-top:0; } }

/* 5. practice header + descriptive feed */
.practice-badge { display:inline-flex; align-items:center; gap:8px; padding:4px 14px; border-radius:999px;
  background:rgba(80,230,120,.12); border:1px solid rgba(80,230,120,.5); color:#50e678;
  font:600 12px sans-serif; letter-spacing:1px; }
.practice-badge i { width:7px; height:7px; border-radius:50%; background:#50e678; }
.feed-opt { flex:1; text-align:left; cursor:pointer; padding:8px 12px; border-radius:8px;
  background:#15151f; border:2px solid #333; color:#fff; }
.feed-opt.on { background:rgba(232,242,75,.12); border-color:#e8f24b; }
.feed-name { font:700 15px sans-serif; } .feed-opt.on .feed-name { color:#e8f24b; }
.feed-desc { font:11px sans-serif; color:#999; margin-top:2px; line-height:1.35; }

/* 6. title screen */
.title-screen { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:16px; overflow:hidden;
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
`;
