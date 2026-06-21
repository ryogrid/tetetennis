// DOM overlay: HUD + menu screens. Holds no game state; the MoonBit logic
// drives it via the host.ui surface. Adapted from old/src/ui.js into a factory.
//
// Two contract changes from the old module:
//  - Menus now receive only a selected INDEX; the display data (cards) lives
//    here, keyed by index in the same order as the MoonBit lists.
//  - The three separate gauges (toss / timing / height) are unified behind a
//    single name-keyed gauge(name, frac, lo, hi, good) / hideGauge(name).
import { SURFACE_THEMES } from './court.js';
import { CHARACTERS } from './characters.js';

// Difficulty display table (order: easy, normal, hard). From old ai.js.
const DIFFICULTIES = [
  { id: 'easy', name: 'Easy', desc: 'Slow reads, late reactions, soft serves.' },
  { id: 'normal', name: 'Normal', desc: 'A solid club player. Fair fight.' },
  { id: 'hard', name: 'Hard', desc: 'Sharp anticipation, big serves, few gifts.' },
];

// Player-side assist axis (order: off, on, full). From old game.js.
const ASSIST_OPTIONS = [
  { id: 'off',  name: 'Off',  desc: 'Classic challenge. No player-side help.' },
  { id: 'on',   name: 'On',   desc: 'Slow-motion approach, easier pace, forgiving contact.' },
  { id: 'full', name: 'Full', desc: 'Everything in On, plus auto-swing and auto-positioning.' },
];
// must match games_options in logic/game/game.js.mbt
const GAMES_OPTIONS = [
  { name: '2 Games', desc: 'Quick set: first to 2 games (win by 2, tiebreak at 2-2).' },
  { name: '4 Games', desc: 'Short set: first to 4 games (win by 2, tiebreak at 4-4).' },
  { name: '6 Games', desc: 'Full set: first to 6 games (win by 2, tiebreak at 6-6).' },
];

// Surface display order: clay, grass, hard.
const SURFACE_IDS = ['clay', 'grass', 'hard'];

// Practice-mode option tables (design/practice-mode). Order must match the
// MoonBit index mappings in logic/game/game.js.mbt + logic/shots.
const MODE_OPTIONS = [
  { name: 'Match', desc: 'A scored singles match vs. the CPU. Win the set.' },
  { name: 'Practice', desc: 'The CPU feeds you balls on your terms. No score — just rally.' },
];
const FEED_OPTIONS = [
  { name: 'Stroke', desc: 'The CPU feeds groundstrokes from the baseline.' },
  { name: 'Serve', desc: 'The CPU serves to you; practice your return.' },
];
// must match @shots.practice_stroke_type (0..4)
const STROKE_SHOTS = [
  { name: 'Flat', desc: 'Driving, low-spin pace.' },
  { name: 'Topspin', desc: 'Heavy, dipping, kicks up.' },
  { name: 'Slice', desc: 'Floating backspin, stays low.' },
  { name: 'Lob', desc: 'High and deep over your head.' },
  { name: 'Drop', desc: 'Soft touch that dies near the net.' },
];
// must match @shots.practice_serve_type (0..2)
const SERVE_SHOTS = [
  { name: 'Flat', desc: 'Fast, flat first serve.' },
  { name: 'Slice', desc: 'Curving slice that pulls you wide.' },
  { name: 'Kick', desc: 'Topspin kick that jumps up high.' },
];
// must match Practice.depth (0 shallow, 1 deep, 2 random)
const DEPTH_OPTIONS = [
  { name: 'Shallow', desc: 'Bounces in the forecourt — move up.' },
  { name: 'Deep', desc: 'Bounces near the baseline — back up.' },
  { name: 'Random', desc: 'Mixes shallow and deep each feed.' },
];

const css = `
#hud * { box-sizing: border-box; }
.screen {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 24px;
  background: rgba(8, 8, 16, 0.88); pointer-events: auto;
}
.card { cursor: pointer; }
.title { font-size: 44px; font-weight: 800; letter-spacing: 4px; color: #e8f24b; }
.subtitle { font-size: 18px; color: #aaa; letter-spacing: 2px; }
.cards { display: flex; gap: 16px; }
.card {
  width: 170px; padding: 14px; border-radius: 10px; border: 3px solid #333;
  background: #15151f; transition: transform .12s, border-color .12s;
}
.card.sel { border-color: #e8f24b; transform: translateY(-8px) scale(1.05); }
.card h3 { margin: 2px 0 1px; font-size: 20px; }
.card .arch { font-size: 12px; color: #e8f24b; margin-bottom: 6px; }
.card .desc { font-size: 11px; color: #999; min-height: 44px; margin-bottom: 8px; }
.statrow { display: flex; align-items: center; font-size: 10px; margin: 2px 0; }
.statrow span { width: 30px; color: #888; }
.statbar { flex: 1; height: 5px; background: #2a2a36; border-radius: 3px; }
.statbar i { display: block; height: 100%; border-radius: 3px; background: #e8f24b; }
.swatch { width: 150px; height: 100px; border-radius: 10px; border: 3px solid #333; }
.swatch-label { text-align: center; margin-top: 8px; font-size: 16px; }
.hint { font-size: 13px; color: #777; }
/* screen 1: setup rows */
/* width reserved for the PRACTICE layout's widest row (BALL TYPE, 5 chips) so
   the box and its buttons don't resize when toggling MATCH/PRACTICE */
.setup { display: flex; flex-direction: column; gap: 8px; width: 660px; max-width: 94vw; }
.srow {
  display: grid; grid-template-columns: 120px 1fr; align-items: center;
  column-gap: 14px; padding: 8px 14px; border-radius: 10px;
  border: 3px solid #333; background: #15151f; cursor: pointer;
  transition: border-color .12s, background .12s;
}
.srow.sel { border-color: #e8f24b; background: #1d1d2a; }
.srow-label { font-size: 13px; font-weight: 700; letter-spacing: 1px; color: #aab; }
.srow-val {
  display: flex; align-items: center; justify-content: center; gap: 12px;
  font-size: 17px; font-weight: 700; color: #fff;
}
.srow-desc { grid-column: 2; font-size: 11px; color: #999; min-height: 13px; text-align: center; }
.sarrow { color: #888; font-size: 14px; cursor: pointer; padding: 0 4px; user-select: none; }
.srow.sel .sarrow { color: #e8f24b; }
.sval { min-width: 150px; text-align: center; }
/* desktop: lay a row's options out horizontally */
.srow.chips { grid-template-columns: 120px 1fr; }
.srow.chips .srow-val { flex-wrap: wrap; gap: 8px; }
.dot { display: inline-block; width: 11px; height: 11px; border-radius: 50%; margin-right: 7px; vertical-align: middle; }
.mchip {
  padding: 3px 14px; border-radius: 7px; border: 2px solid #333; color: #888;
  font-size: 14px; cursor: pointer;
}
.mchip.on { border-color: #50e678; background: rgba(80,230,120,.18); color: #e8ffe8; }
.startbtn {
  pointer-events: auto; margin-top: 4px; padding: 9px 26px; border-radius: 8px;
  background: rgba(80,230,120,.18); border: 1px solid rgba(80,230,120,.7);
  color: #e8ffe8; font-size: 15px; letter-spacing: 1px; cursor: pointer;
}
.startrow { display: flex; gap: 14px; }
.startbtn.back { background: rgba(255,255,255,.06); border-color: #555; color: #bbb; }
/* screen 2: player sections */
.screen[data-screen="players"] { gap: 12px; }
.psection {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 8px 12px; border-radius: 12px; border: 2px solid transparent;
}
.psection.focused { border-color: #e8f24b; background: rgba(232,242,75,.05); }
.psection-label { font-size: 13px; font-weight: 700; letter-spacing: 2px; color: #aab; }
.cards.compact .card { width: 132px; padding: 9px; }
.cards.compact .card .desc { min-height: 30px; font-size: 10px; }
.cards.compact .statradar { width: 120px; height: 110px; }
/* phones: compact both setup screens so everything (incl. START) fits with no
   vertical scroll, and let the character rows scroll horizontally if needed */
@media (pointer: coarse) {
  .screen { justify-content: flex-start; gap: 8px; padding: 10px 0; overflow-y: auto; }
  .title { font-size: 26px; letter-spacing: 2px; }
  .setup { gap: 6px; min-width: 0; width: 92vw; max-width: 460px; }
  .srow { padding: 6px 12px; }
  .srow-desc { min-height: 0; }
  .psection { padding: 4px 8px; gap: 2px; max-width: 100vw; }
  .psection .cards { overflow-x: auto; max-width: 100vw; padding: 6px 0; }
  .cards.compact .card { width: 108px; padding: 7px; flex: 0 0 auto; }
  .cards.compact .card h3 { font-size: 16px; }
  .cards.compact .card .desc { display: none; }
  .cards.compact .statradar { width: 92px; height: 86px; }
  .startbtn { margin-top: 0; padding: 8px 22px; }
}
.matchstats { border-collapse: collapse; margin: 6px 0; font-size: 14px; color: #cdd; }
.matchstats th, .matchstats td { padding: 3px 14px; text-align: center; }
.matchstats th { color: #888; font-weight: 600; font-size: 12px; }
.matchstats td:first-child { text-align: left; color: #9aa; }
.menubtn {
  pointer-events: auto; margin: 8px 0 4px; padding: 8px 22px; border-radius: 8px;
  background: rgba(80,230,120,.18); border: 1px solid rgba(80,230,120,.7);
  color: #e8ffe8; font-size: 15px; letter-spacing: 1px; cursor: pointer;
}
.menubtn.quit { background: rgba(230,90,90,.16); border-color: rgba(230,90,90,.7); color: #ffecec; }
#scoreboard {
  position: absolute; top: 14px; left: 14px; background: rgba(10,10,18,.78);
  border-radius: 8px; padding: 10px 14px; font-size: 15px; min-width: 170px;
}
#scoreboard .row { display: flex; justify-content: space-between; gap: 14px; padding: 2px 0; }
#scoreboard .serve { color: #e8f24b; }
#banner {
  position: absolute; top: 32%; left: 0; right: 0; text-align: center;
  font-size: 46px; font-weight: 800; letter-spacing: 6px; color: #fff;
  text-shadow: 0 2px 12px #000; opacity: 0; transition: opacity .15s;
}
#toast {
  position: absolute; top: 14px; left: 0; right: 0; text-align: center;
  font-size: 20px; color: #e8f24b; opacity: 0; transition: opacity .3s;
}
#shotbar {
  position: absolute; bottom: 14px; left: 14px; display: flex; gap: 8px;
  font-size: 13px;
}
#shotbar div {
  padding: 6px 10px; border-radius: 6px; background: rgba(10,10,18,.7);
  border: 1px solid #333;
}
#shotbar div.flash { background: #e8f24b; color: #111; }
#shotbar div.recommend { border-color: #50e678; box-shadow: 0 0 8px rgba(80,230,120,.85); }
#controls {
  position: absolute; bottom: 44px; right: 14px; font-size: 12px; color: #888;
  background: rgba(10,10,18,.7); padding: 8px 12px; border-radius: 6px; text-align: right;
}
/* source-code link: sits just below the controls box, right-aligned so its
   text's right edge meets the controls box's right edge. Muted teal on a faint
   bluish panel so it reads as distinct from the (grey) instructions. */
#src-link {
  position: absolute; bottom: 14px; right: 6px; font-size: 11px; color: #6fb6cf;
  background: rgba(14,22,36,.5); padding: 4px 8px; border-radius: 4px;
  text-decoration: none; pointer-events: auto; transition: color .2s; letter-spacing: .3px;
}
#src-link:hover { color: #aee6ff; }
#touchui { position: absolute; inset: 0; pointer-events: none; display: none; }
#stick {
  position: absolute; left: 22px; bottom: 22px; width: 176px; height: 176px;
  border-radius: 50%; background: rgba(18,18,28,.32);
  border: 1px solid rgba(255,255,255,.18);
  pointer-events: auto; touch-action: none;
}
#stick-knob {
  position: absolute; left: 50%; top: 50%; width: 76px; height: 76px;
  margin-left: -38px; margin-top: -38px; border-radius: 50%;
  background: rgba(92,92,124,.55); border: 2px solid rgba(255,255,255,.4);
  transform: translate(0,0); transition: transform .04s linear;
  box-shadow: 0 2px 8px rgba(0,0,0,.4);
}
#stick-knob.active { background: rgba(126,126,168,.7); transition: none; }
.tbtn {
  position: absolute; pointer-events: auto; touch-action: none;
  width: 86px; height: 86px; border-radius: 50%;
  background: rgba(18,18,28,.55); border: 2px solid rgba(255,255,255,.3);
  color: #eee; font-weight: 700; font-size: 14px; letter-spacing: 1px;
  display: flex; align-items: center; justify-content: center;
}
.tbtn.pressed, .tbtn.flash { background: #e8f24b; color: #111; border-color: #e8f24b; }
.tbtn.recommend { box-shadow: 0 0 12px 2px rgba(80,230,120,.9); border-color: #50e678; }
#tb-shot {
  right: 40px; bottom: 40px; width: 124px; height: 124px; font-size: 16px;
  background: rgba(44,64,30,.6);
}
#tossgauge {
  position: absolute; right: 22%; top: 50%; transform: translateY(-50%);
  width: 26px; height: 190px; display: none;
  background: rgba(10,10,18,.55); border: 1px solid rgba(255,255,255,.3);
  border-radius: 13px;
}
#tossgauge .tg-band {
  position: absolute; left: 0; right: 0;
  background: rgba(80,230,120,.30);
  border-top: 1px solid rgba(80,230,120,.9);
  border-bottom: 1px solid rgba(80,230,120,.9);
}
#tossgauge .tg-dot {
  position: absolute; left: 50%; width: 16px; height: 16px;
  margin-left: -8px; margin-bottom: -8px; border-radius: 50%;
  background: #d8f24b; box-shadow: 0 0 6px rgba(0,0,0,.5);
}
#tossgauge .tg-dot.sweet { background: #50e678; box-shadow: 0 0 12px #50e678; }
#tossgauge .tg-label {
  position: absolute; top: -22px; left: 50%; transform: translateX(-50%);
  font-size: 11px; color: #aaa; letter-spacing: 1px; white-space: nowrap;
}
#timingmeter {
  position: absolute; bottom: 15%; left: 50%; transform: translateX(-50%);
  width: 210px; height: 16px; display: none;
  background: rgba(10,10,18,.55); border: 1px solid rgba(255,255,255,.3);
  border-radius: 8px;
}
#timingmeter .tm-band {
  position: absolute; top: 0; bottom: 0;
  background: rgba(80,230,120,.30);
  border-left: 1px solid rgba(80,230,120,.9);
  border-right: 1px solid rgba(80,230,120,.9);
}
#timingmeter .tm-dot {
  position: absolute; top: 50%; width: 14px; height: 14px;
  margin-top: -7px; margin-left: -7px; border-radius: 50%;
  background: #d8f24b; box-shadow: 0 0 6px rgba(0,0,0,.5);
}
#timingmeter .tm-dot.good { background: #50e678; box-shadow: 0 0 12px #50e678; }
#timingmeter .tm-label {
  position: absolute; top: -20px; left: 50%; transform: translateX(-50%);
  font-size: 11px; color: #aaa; letter-spacing: 1px; white-space: nowrap;
}
#powermeter {
  position: absolute; bottom: 26%; left: 50%; transform: translateX(-50%);
  width: 230px; height: 18px; display: none;
  background: rgba(10,10,18,.55); border: 1px solid rgba(255,255,255,.3);
  border-radius: 9px;
}
#powermeter .pm-band {
  position: absolute; top: 0; bottom: 0;
  background: rgba(80,230,120,.30);
  border-left: 1px solid rgba(80,230,120,.9);
  border-right: 1px solid rgba(80,230,120,.9);
}
#powermeter .pm-dot {
  position: absolute; top: 50%; width: 16px; height: 16px;
  margin-top: -8px; margin-left: -8px; border-radius: 50%;
  background: #d8f24b; box-shadow: 0 0 6px rgba(0,0,0,.5);
}
#powermeter .pm-dot.good { background: #50e678; box-shadow: 0 0 12px #50e678; }
#powermeter .pm-label {
  position: absolute; top: -20px; left: 50%; transform: translateX(-50%);
  font-size: 11px; color: #aaa; letter-spacing: 1px; white-space: nowrap;
}
#chargebar {
  position: absolute; bottom: 19%; left: 50%; transform: translateX(-50%);
  width: 210px; height: 15px; display: none;
  background: rgba(10,10,18,.55); border: 1px solid rgba(255,255,255,.4);
  border-radius: 8px; overflow: hidden;
  box-shadow: 0 0 16px rgba(190,70,255,.6);
  animation: cb-glow 0.7s ease-in-out infinite alternate;
}
#chargebar .cb-fill {
  position: absolute; left: 0; top: 0; bottom: 0; width: 0%;
  background: linear-gradient(90deg, #9b3bff, #ff3bd0, #ffd24a, #ff3bd0, #9b3bff);
  background-size: 220% 100%;
  animation: cb-sheen 0.55s linear infinite;
  box-shadow: 0 0 12px rgba(255,90,225,.95);
}
@keyframes cb-glow {
  from { box-shadow: 0 0 10px rgba(160,60,255,.45); }
  to   { box-shadow: 0 0 24px rgba(255,80,225,.9); }
}
@keyframes cb-sheen {
  from { background-position: 0% 0; }
  to   { background-position: 220% 0; }
}
#tc-bar { position: absolute; top: 12px; right: 12px; display: none; gap: 8px; }
#tc-bar button {
  pointer-events: auto; width: 44px; height: 38px; border-radius: 8px;
  background: rgba(18,18,28,.6); color: #ccc;
  border: 1px solid rgba(255,255,255,.25); font-size: 17px;
}
/* the camera/view button carries a visible caption + a one-time attract pulse
   so its role is discoverable */
#tc-cam {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 44px; line-height: 1; gap: 1px; padding: 2px 0; font-size: 16px;
}
#tc-cam .tc-cap { font-size: 8px; letter-spacing: 1px; color: #bcd; font-weight: 700; }
#tc-cam.attract {
  border-color: #50e678; color: #eaffea;
  animation: cam-pulse 1s ease-in-out infinite;
}
@keyframes cam-pulse {
  from { box-shadow: 0 0 4px rgba(80,230,120,.4); }
  to   { box-shadow: 0 0 16px 3px rgba(80,230,120,.9); }
}
/* hitting-point quality (0..100) — vertical gauge on the left, non-serve hits */
#hitquality {
  position: absolute; left: 18px; top: 50%; transform: translateY(-50%);
  width: 56px; display: flex; flex-direction: column; align-items: center; gap: 4px;
  opacity: 0; transition: opacity .25s; text-align: center;
}
#hitquality .hq-label { font-size: 10px; letter-spacing: 1px; color: #9aa; }
#hitquality .hq-num { font-size: 26px; font-weight: 800; color: #fff; line-height: 1; }
#hitquality .hq-bar {
  width: 12px; height: 90px; border-radius: 6px; overflow: hidden; position: relative;
  background: rgba(10,10,18,.55); border: 1px solid rgba(255,255,255,.35);
}
#hitquality .hq-fill {
  position: absolute; left: 0; right: 0; bottom: 0; height: 0%;
  background: #50e678; transition: height .2s, background .2s;
}
/* desktop: anchor the setup screen to the top so PRACTICE's extra rows extend
   downward (scrolling if the window is short) instead of recentering/overflowing */
@media (hover: hover) and (pointer: fine) {
  .screen[data-screen="setup"] {
    justify-content: flex-start; padding-top: 6vh; overflow-y: auto;
  }
}
/* ---- AFTER improvements: scoreboard card · results bars · court preview · practice ---- */
#scoreboard { border: 1px solid rgba(255,255,255,.18); box-shadow: 0 4px 16px rgba(0,0,0,.4); }
#scoreboard .sb-head { display:flex; justify-content:flex-end; gap:14px; padding:0 0 4px; margin-bottom:4px;
  border-bottom:1px solid rgba(255,255,255,.08); font:700 10px sans-serif; letter-spacing:1px; color:#888; }
#scoreboard .sb-head span:first-child { width:18px; text-align:center; }
#scoreboard .sb-head span:last-child  { width:24px; text-align:center; }
#scoreboard .sb-g { display:inline-block; width:18px; text-align:center; }
#scoreboard .sb-p { display:inline-block; width:24px; text-align:center; font-weight:700; }
/* broadcast-style score-change animations (immersion 06 §6.1) */
#scoreboard .sb-pop { animation: sbPop .45s ease; }
#scoreboard .sb-flash { animation: sbFlash .85s ease; }
@keyframes sbPop {
  0% { transform: scale(1); color:#fff; }
  28% { transform: scale(1.55); color:#e8f24b; }
  100% { transform: scale(1); }
}
@keyframes sbFlash {
  0% { transform: scale(1); color:#fff; text-shadow:none; }
  22% { transform: scale(1.7); color:#ffd33b; text-shadow:0 0 10px rgba(255,211,59,.9); }
  100% { transform: scale(1); text-shadow:none; }
}
/* results: diverging head-to-head stat bars */
.sbar-head { display:flex; justify-content:space-between; width:540px; max-width:92vw; margin:4px auto 6px; font:700 12px sans-serif; letter-spacing:1px; }
.sbars { display:flex; flex-direction:column; gap:9px; margin:6px 0; }
.sbar { display:grid; grid-template-columns:54px 1fr 130px 1fr 54px; align-items:center; gap:10px; width:540px; max-width:92vw; }
.sbar-n { font:700 15px sans-serif; color:#888; }
.sbar-n.l { text-align:right; } .sbar-n.r { text-align:left; }
.sbar-t { height:12px; position:relative; background:#2a2a36; border-radius:3px; }
.sbar-t i { position:absolute; top:0; bottom:0; right:0; border-radius:3px; }
.sbar-t.r i { right:auto; left:0; }
.sbar-k { text-align:center; font:600 12px sans-serif; letter-spacing:.5px; color:#9aa; }
/* setup: live court preview of the chosen surface */
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
/* practice: distinct "no score" header badge */
.practice-badge { display:inline-flex; align-items:center; gap:8px; padding:4px 14px; border-radius:999px;
  background:rgba(80,230,120,.12); border:1px solid rgba(80,230,120,.5); color:#50e678; font:600 12px sans-serif; letter-spacing:1px; }
.practice-badge i { width:7px; height:7px; border-radius:50%; background:#50e678; }
@media (pointer: coarse) { .setup-wrap { flex-direction:column; align-items:center; } .court-preview { padding-top:0; } .sbar, .sbar-head { width:92vw; } }
/* title screen (option b) */
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
`;

export function createUI({ onVirtualKey, onMoveAxis } = {}) {
  const els = {};
  let bannerTimer = null;
  let toastTimer = null;
  const flashTimers = {};
  let menuTapHandler = null;
  let hudShown = false;
  let touchVisible = false;
  // Mouse-class device? Used to pick the setup-screen layout: desktops lay every
  // option out horizontally (click to pick); phones keep the ◂ value ▸ toggle.
  const isDesktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  // per-name gauge "shown" state (toss / timing / height)
  const gaugeShown = { toss: false, timing: false };
  let recommendedShot = '';

  function div(id, parent, cls) {
    const d = document.createElement('div');
    if (id) d.id = id;
    if (cls) d.className = cls;
    (parent || document.getElementById('hud')).appendChild(d);
    return d;
  }

  // Radar chart of the eight 0-100 persona stats, drawn as inline SVG.
  function statBars(stats, color = '#50e678') {
    const axes = ['POW', 'SPN', 'SLC', 'SRV', 'SPD', 'CTL', 'REA', 'NET'];
    const n = axes.length;
    const cx = 90, cy = 80, R = 60;
    const pt = (i, r) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    };
    // concentric grid rings + axis spokes
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
    return `<svg class="statradar" viewBox="0 0 180 165" width="180" height="165">${grid}${spokes}` +
      `<polygon points="${poly}" fill="${color}" fill-opacity="0.26" stroke="${color}" stroke-width="1.5"/>${labels}</svg>`;
  }

  // ---------- init ----------

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  const hud = document.getElementById('hud');
  hud.innerHTML = '';
  hud.addEventListener('contextmenu', (e) => e.preventDefault());
  els.menu = div('menu', hud, 'screen');
  els.scoreboard = div('scoreboard', hud);
  els.banner = div('banner', hud);
  els.toast = div('toast', hud);
  els.shotbar = div('shotbar', hud);
  els.controls = div('controls', hud);
  els.tossgauge = div('tossgauge', hud);
  els.tossgauge.innerHTML =
    '<div class="tg-label">TOSS</div><div class="tg-band"></div><div class="tg-dot"></div>';
  els.tgBand = els.tossgauge.querySelector('.tg-band');
  els.tgDot = els.tossgauge.querySelector('.tg-dot');
  els.timingmeter = div('timingmeter', hud);
  els.timingmeter.innerHTML =
    '<div class="tm-label">HIT</div><div class="tm-band"></div><div class="tm-dot"></div>';
  els.tmBand = els.timingmeter.querySelector('.tm-band');
  els.tmDot = els.timingmeter.querySelector('.tm-dot');
  els.powermeter = div('powermeter', hud);
  els.powermeter.innerHTML =
    '<span class="pm-label">SERVE POWER</span><div class="pm-band"></div><div class="pm-dot"></div>';
  els.pmBand = els.powermeter.querySelector('.pm-band');
  els.pmDot = els.powermeter.querySelector('.pm-dot');
  els.chargebar = div('chargebar', hud);
  els.chargebar.innerHTML = '<i class="cb-fill"></i>';
  els.cbFill = els.chargebar.querySelector('.cb-fill');
  els.hitquality = div('hitquality', hud);
  els.hitquality.innerHTML =
    '<div class="hq-label">CONTACT</div><div class="hq-num">0</div>' +
    '<div class="hq-bar"><i class="hq-fill"></i></div>';
  els.hqNum = els.hitquality.querySelector('.hq-num');
  els.hqFill = els.hitquality.querySelector('.hq-fill');
  els.shotbar.innerHTML =
    '<div id="sb-flat">Z Flat</div><div id="sb-topspin">X Topspin</div>' +
    '<div id="sb-slice">C Slice</div><div id="sb-drop">V Drop</div>';
  els.controls.innerHTML =
    'Move: Arrow keys<br>Shots: <b>hold</b> Z/X/C/V to charge, <b>release</b> to hit ' +
    '(Z flat &middot; X topspin &middot; C slice &middot; V drop)<br>' +
    'Release in the sweet spot for a Perfect Hit; longer charge = more power<br>' +
    'Serve: Space toss, then Z/X/C when the power meter is in the green band<br>' +
    'Aim: hold a direction at the moment you release';

  // source-code link (bottom-right, just below the controls box)
  const srcLink = document.createElement('a');
  srcLink.id = 'src-link';
  srcLink.href = 'https://github.com/ryogrid/tetetennis';
  srcLink.target = '_blank';
  srcLink.rel = 'noopener';
  srcLink.textContent = 'source code';
  hud.appendChild(srcLink);

  // menu tap support: each interactive element carries a string `data-cmd` and
  // an integer `data-arg` (a row/character index, or 0). The logic layer (via
  // menu_cmd) decides what each command does per screen. Results screen taps
  // send a no-arg command to dismiss.
  els.menu.addEventListener('pointerdown', (e) => {
    if (!menuTapHandler) return;
    const el = e.target.closest('[data-cmd]');
    if (el) menuTapHandler(el.dataset.cmd, parseInt(el.dataset.arg || '0', 10), parseInt(el.dataset.arg2 || '0', 10));
    else if (els.menu.dataset.screen === 'results') menuTapHandler('results', 0, 0);
  });

  // ---------- on-screen controls (two-handed phone grip) ----------

  const onKey = onVirtualKey || (() => {});
  const onAxis = onMoveAxis || (() => {});
  els.touchui = div('touchui', hud);

  // analog stick, bottom-left (left thumb): PS-style, knob follows the thumb
  // and returns to centre, feeding a continuous movement vector
  const stick = div('stick', els.touchui);
  const knob = document.createElement('div');
  knob.id = 'stick-knob';
  stick.appendChild(knob);
  let stickPointer = null;
  function stickFromEvent(e) {
    const r = stick.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const maxR = r.width / 2 - 10;
    const d = Math.hypot(dx, dy);
    if (d > maxR) { dx = dx / d * maxR; dy = dy / d * maxR; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const dead = maxR * 0.12;
    if (d <= dead) { onAxis(0, 0); return; }
    // +x = screen right, +z = screen down (= backward), matching the old D-pad
    onAxis(dx / maxR, dy / maxR);
  }
  function stickRecenter() {
    knob.style.transform = 'translate(0,0)';
    knob.classList.remove('active');
    onAxis(0, 0);
  }
  stick.addEventListener('pointerdown', (e) => {
    if (stickPointer !== null) return;
    stickPointer = e.pointerId;
    try { stick.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
    knob.classList.add('active');
    stickFromEvent(e);
    e.preventDefault();
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickPointer) stickFromEvent(e);
  });
  const stickRelease = (e) => {
    if (e.pointerId !== stickPointer) return;
    stickPointer = null;
    stickRecenter();
  };
  stick.addEventListener('pointerup', stickRelease);
  stick.addEventListener('pointercancel', stickRelease);

  // single shot button, bottom-right (right thumb): tosses + serves and hits;
  // shot type is chosen by the logic on each press
  const shotBtn = div('tb-shot', els.touchui, 'tbtn');
  shotBtn.textContent = 'SHOT';
  shotBtn.addEventListener('pointerdown', (e) => {
    try { shotBtn.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
    shotBtn.classList.add('pressed');
    onKey('TouchShot', true);
    e.preventDefault();
  });
  const shotUp = () => { shotBtn.classList.remove('pressed'); onKey('TouchShot', false); };
  shotBtn.addEventListener('pointerup', shotUp);
  shotBtn.addEventListener('pointercancel', shotUp);

  // camera + toggle + quit, top-right
  els.tcBar = div('tc-bar', hud);
  const cam = document.createElement('button');
  cam.id = 'tc-cam';
  cam.title = 'Toggle camera view (B)';
  cam.innerHTML = '<span class="tc-ico">&#127909;</span><span class="tc-cap">VIEW</span>'; // 🎥
  els.cam = cam;
  const toggle = document.createElement('button');
  toggle.id = 'tc-toggle';
  const quit = document.createElement('button');
  quit.id = 'tc-quit';
  quit.innerHTML = '&#10005;';
  els.tcBar.append(cam, toggle, quit);
  els.tcToggle = toggle;

  const stored = localStorage.getItem('touchControls');
  touchVisible = stored !== null
    ? stored === 'on'
    : window.matchMedia('(pointer: coarse)').matches;

  function applyTouchVisibility() {
    els.touchui.style.display = hudShown && touchVisible ? 'block' : 'none';
    els.tcBar.style.display = hudShown ? 'flex' : 'none';
    // keyboard-oriented HUD boxes collide with the touch buttons; swap them
    els.shotbar.style.display = hudShown && !touchVisible ? 'flex' : 'none';
    els.controls.style.display = hudShown && !touchVisible ? 'block' : 'none';
    if (els.tcToggle) els.tcToggle.innerHTML = touchVisible ? '&#9000;' : '&#127918;';
  }

  toggle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    touchVisible = !touchVisible;
    localStorage.setItem('touchControls', touchVisible ? 'on' : 'off');
    applyTouchVisibility();
  });
  cam.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dismissCamHint();
    onKey('KeyB', true);
    onKey('KeyB', false);
  });
  quit.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onKey('Escape', true);
    onKey('Escape', false);
  });

  // ---------- menus ----------

  // one character card (name + archetype + desc + radar). `cmd` is the tap
  // action ("you"/"opp") tagged on the element with the character index.
  function charCard(c, i, selected, cmd) {
    return `<div class="card${selected ? ' sel' : ''}" data-cmd="${cmd}" data-arg="${i}">
      <h3 style="color:#${c.color.toString(16).padStart(6, '0')}">${c.name}</h3>
      <div class="arch">${c.archetype}</div>
      <div class="desc">${c.desc}</div>
      ${statBars(c.stats, '#' + c.color.toString(16).padStart(6, '0'))}
    </div>`;
  }

  // ----- screen 1: consolidated setup (mode + mode-dependent settings) -----
  // Row indices below MUST match Game::setup_rows in logic/game/game.js.mbt.

  function surfaceLabel(idx) {
    const t = SURFACE_THEMES[SURFACE_IDS[idx]];
    return `<span class="dot" style="background:#${t.court.toString(16).padStart(6, '0')}"></span>${t.label}`;
  }

  // top-down court swatch for the chosen surface (review: setup preview)
  function courtPreview(idx) {
    const t = SURFACE_THEMES[SURFACE_IDS[idx]];
    const col = '#' + t.court.toString(16).padStart(6, '0');
    return `<div class="court-preview"><div class="cp-label">COURT</div>` +
      `<div class="cp-court" style="background:${col};box-shadow:0 0 0 1px rgba(255,255,255,.12),0 6px 18px ${col}44">` +
      `<i class="cp-line cp-top"></i><i class="cp-line cp-bot"></i><i class="cp-line cp-left"></i>` +
      `<i class="cp-line cp-right"></i><i class="cp-line cp-mid"></i><i class="cp-line cp-net"></i></div>` +
      `<div class="cp-name" style="color:${col}">${t.label}</div></div>`;
  }

  // one selectable option chip (desktop layout / the MODE row): tapping it sets
  // row `rowIdx` to value `optIdx` directly.
  function optChip(rowIdx, optIdx, label, active) {
    return `<span class="mchip${active ? ' on' : ''}" data-cmd="set" data-arg="${rowIdx}" data-arg2="${optIdx}">${label}</span>`;
  }

  // a setup row. `options` is [{name, desc}] (name may be HTML). When `chips`,
  // every option is laid out horizontally (click to pick); otherwise the value
  // is shown between ◂ ▸ arrows that step through the options.
  function optRow(label, rowIdx, focusedRow, options, sel, chips) {
    const selRow = rowIdx === focusedRow;
    const desc = options[sel] ? (options[sel].desc || '') : '';
    const val = chips
      ? options.map((o, i) => optChip(rowIdx, i, o.name, i === sel)).join('')
      : `<span class="sarrow" data-cmd="dec" data-arg="${rowIdx}">&#9666;</span>` +
        `<span class="sval">${options[sel].name}</span>` +
        `<span class="sarrow" data-cmd="inc" data-arg="${rowIdx}">&#9656;</span>`;
    return `<div class="srow${selRow ? ' sel' : ''}${chips ? ' chips' : ''}" data-cmd="row" data-arg="${rowIdx}">
      <div class="srow-label">${label}</div>
      <div class="srow-val">${val}</div>
      <div class="srow-desc">${selRow ? desc : ''}</div>
    </div>`;
  }

  // ----- title screen (option b): branded entry, driven by the MoonBit
  // MenuTitle state. PLAY taps route through the existing menu pointerdown
  // handler (data-cmd="play" -> menuCmd); Enter/Space go through host.input. -----
  function showTitle() {
    els.menu.style.display = 'flex';
    els.menu.dataset.screen = 'title';
    els.menu.innerHTML =
      `<div class="title-screen">` +
      `<div class="ts-court"></div>` +
      `<img class="ts-logo" src="icon-192.png" alt="" width="108" height="108"/>` +
      `<div class="ts-word">tetetennis</div>` +
      `<div class="ts-tag">ARCADE TENNIS</div>` +
      `<div class="startbtn" data-cmd="play" data-arg="0">&#9654; PLAY</div>` +
      `<div class="ts-hint">PRESS ENTER OR TAP</div>` +
      `</div>`;
  }

  function showSetup(isPractice, row, surface, difficulty, gamesIdx, assist, feed, shot, depth) {
    els.menu.style.display = 'flex';
    els.menu.dataset.screen = 'setup';
    const surfaceOpts = SURFACE_IDS.map((id, i) => ({ name: surfaceLabel(i), desc: '' }));
    // Rows common to both modes come first in the same order (MODE, SURFACE,
    // ASSIST) so toggling MATCH/PRACTICE doesn't move them; mode-specific rows
    // follow. Indices must match the MoonBit setup_rows() order exactly.
    const rows = [
      // MODE is always chips (binary, reads as a clear toggle on any device)
      optRow('MODE', 0, row, MODE_OPTIONS, isPractice ? 1 : 0, true),
      optRow('SURFACE', 1, row, surfaceOpts, surface, isDesktop),
      optRow('ASSIST', 2, row, ASSIST_OPTIONS, assist, isDesktop),
    ];
    if (isPractice) {
      rows.push(optRow('FEED', 3, row, FEED_OPTIONS, feed, isDesktop));
      rows.push(optRow('BALL TYPE', 4, row, feed === 1 ? SERVE_SHOTS : STROKE_SHOTS, shot, isDesktop));
      if (feed === 0) {
        rows.push(optRow('FEED DEPTH', 5, row, DEPTH_OPTIONS, depth, isDesktop));
      }
    } else {
      rows.push(optRow('DIFFICULTY', 3, row, DIFFICULTIES, difficulty, isDesktop));
      rows.push(optRow('GAMES', 4, row, GAMES_OPTIONS, gamesIdx, isDesktop));
    }
    const nav = isDesktop
      ? '&uarr;/&darr; row &middot; &larr;/&rarr; or click an option &middot; Enter &rarr; players'
      : '&uarr;/&darr; row &middot; &larr;/&rarr; change &middot; Enter &rarr; players &middot; or tap';
    const badge = isPractice
      ? `<div class="practice-badge"><i></i>NO SCORE &middot; ENDLESS FEED &middot; QUIT ANYTIME</div>`
      : '';
    els.menu.innerHTML =
      `<div class="title">GAME SETUP</div>` + badge +
      `<div class="setup-wrap"><div class="setup">${rows.join('')}</div>` +
      courtPreview(surface) +
      `</div>` +
      `<div class="startbtn" data-cmd="go" data-arg="0">ENTER &rarr; PLAYERS</div>` +
      `<div class="hint">${nav}</div>`;
  }

  // ----- screen 2: pick your player + opponent (rich cards) -----

  function playerSection(label, cmd, selIdx, focused) {
    return `<div class="psection${focused ? ' focused' : ''}">
      <div class="psection-label">${label}</div>
      <div class="cards compact">` +
      CHARACTERS.map((c, i) => charCard(c, i, i === selIdx, cmd)).join('') +
      `</div></div>`;
  }

  function showPlayers(sel, player, opp) {
    els.menu.style.display = 'flex';
    els.menu.dataset.screen = 'players';
    els.menu.innerHTML =
      `<div class="title">SELECT PLAYERS</div>` +
      playerSection('YOU', 'you', player, sel === 0) +
      playerSection('OPPONENT', 'opp', opp, sel === 1) +
      `<div class="startrow">` +
      `<div class="startbtn back" data-cmd="back" data-arg="0">&larr; BACK</div>` +
      `<div class="startbtn" data-cmd="go" data-arg="0">START &#9654;</div>` +
      `</div>` +
      `<div class="hint">&uarr;/&darr; you/opp &middot; &larr;/&rarr; pick &middot; Enter start &middot; Esc back &middot; or tap</div>`;
    // keep the focused section's chosen card in view when the card row scrolls
    // horizontally (narrow screens). No-op when nothing overflows (desktop).
    const active = els.menu.querySelector('.psection.focused .card.sel');
    if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  function showResults(win, lose, games, playerWon, difficulty, stats) {
    els.menu.style.display = 'flex';
    els.menu.dataset.screen = 'results';
    // stats: ';'-separated "Label\tYou\tOpp" rows → diverging head-to-head bars
    const youCol = '#e8f24b', oppCol = '#50e678';
    const youName = (win.includes('(You)') ? win : lose.includes('(You)') ? lose : 'You').replace(' (You)', '');
    const oppName = win.includes('(You)') ? lose : win;
    const bars = (stats || '').split(';').filter(Boolean).map((r) => {
      const [label, youRaw, oppRaw] = r.split('\t');
      const yn = parseFloat(youRaw), on = parseFloat(oppRaw);
      const valid = isFinite(yn) && isFinite(on);
      const pct = /%/.test(youRaw + oppRaw);
      const lower = /error|fault/i.test(label);
      const youWins = valid && (lower ? yn < on : yn > on);
      const oppWins = valid && (lower ? on < yn : on > yn);
      const scale = pct ? 100 : Math.max(isFinite(yn) ? yn : 0, isFinite(on) ? on : 0, 1) * 1.15;
      const lw = isFinite(yn) ? Math.min(100, yn / scale * 100) : 0;
      const rw = isFinite(on) ? Math.min(100, on / scale * 100) : 0;
      return `<div class="sbar">` +
        `<div class="sbar-n l${youWins ? ' win' : ''}" style="${youWins ? `color:${youCol}` : ''}">${youRaw}</div>` +
        `<div class="sbar-t"><i style="width:${lw}%;background:${youCol};opacity:${youWins ? 1 : .45}"></i></div>` +
        `<div class="sbar-k">${label}</div>` +
        `<div class="sbar-t r"><i style="width:${rw}%;background:${oppCol};opacity:${oppWins ? 1 : .45}"></i></div>` +
        `<div class="sbar-n r${oppWins ? ' win' : ''}" style="${oppWins ? `color:${oppCol}` : ''}">${oppRaw}</div>` +
      `</div>`;
    }).join('');
    const table = bars
      ? `<div class="sbar-head"><span style="color:${youCol}">${youName} (you)</span>` +
        `<span style="color:${oppCol}">${oppName}</span></div><div class="sbars">${bars}</div>`
      : '';
    els.menu.innerHTML =
      `<div class="title">${playerWon ? 'YOU WIN!' : 'YOU LOSE'}</div>` +
      `<div class="subtitle">${win} d. ${lose} &nbsp; ${games}` +
      `${difficulty ? ` &middot; ${difficulty}` : ''}</div>` +
      table +
      `<button id="rematch-btn" class="menubtn">Rematch (R)</button>` +
      `<div class="hint">Enter or tap: back to menu</div>`;
    const rb = document.getElementById('rematch-btn');
    if (rb) {
      const fire = (e) => {
        e.stopPropagation();
        if (onVirtualKey) { onVirtualKey('KeyR', true); onVirtualKey('KeyR', false); }
      };
      rb.addEventListener('pointerdown', fire);
    }
  }

  function hideMenu() {
    els.menu.style.display = 'none';
  }

  function fireKey(code) {
    if (onVirtualKey) { onVirtualKey(code, true); onVirtualKey(code, false); }
  }

  function showPause() {
    els.menu.style.display = 'flex';
    els.menu.dataset.screen = 'pause';
    els.menu.innerHTML =
      `<div class="title">PAUSED</div>` +
      `<button id="resume-btn" class="menubtn">Resume (Esc)</button>` +
      `<button id="quit-btn" class="menubtn quit">Quit match (Q)</button>` +
      `<div class="hint">Esc or P to resume &middot; Q to quit</div>`;
    const rb = document.getElementById('resume-btn');
    if (rb) rb.addEventListener('pointerdown', (e) => { e.stopPropagation(); fireKey('Escape'); });
    const qb = document.getElementById('quit-btn');
    let armed = false; // require a confirming second click to avoid mis-quits
    if (qb) qb.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (!armed) { armed = true; qb.textContent = 'Click again to quit'; return; }
      fireKey('KeyQ');
    });
  }

  function hidePause() {
    els.menu.style.display = 'none';
  }

  // ---------- hud ----------

  // one-time discoverability nudge for the camera/view button: a pulse + a
  // short toast on the first match, until the user finds it (persisted).
  let camHintTimer = null;
  function dismissCamHint() {
    if (els.cam) els.cam.classList.remove('attract');
    if (camHintTimer) { clearTimeout(camHintTimer); camHintTimer = null; }
    try { localStorage.setItem('camHintSeen', '1'); } catch { /* ignore */ }
  }
  function maybeShowCamHint() {
    let seen = false;
    try { seen = localStorage.getItem('camHintSeen') === '1'; } catch { /* ignore */ }
    if (seen || !els.cam) return;
    els.cam.classList.add('attract');
    toast('🎥 VIEW (B): change camera angle', 2600);
    camHintTimer = setTimeout(dismissCamHint, 6000);
  }

  function showHUD() {
    hudShown = true;
    prevScore.shown = false; // don't animate the opening 0-0 of a new match
    els.scoreboard.style.display = 'block';
    applyTouchVisibility();
    maybeShowCamHint();
  }

  function hideHUD() {
    hudShown = false;
    els.scoreboard.style.display = 'none';
    els.banner.style.opacity = 0;
    els.toast.style.opacity = 0;
    hideGauge('toss');
    hideGauge('timing');
    hideGauge('height');
    hideHitQuality();
    hideMoveHint();
    setRecommendedShot('');
    applyTouchVisibility();
  }

  // games/points are preformatted COMBINED strings from the logic
  // (games "2-1", points "40-0" | "Deuce" | "Ad P" | "TB 3-2"); p/c are the
  // player/cpu names. serveNo is 1 or 2. The logic owns all score formatting,
  // so we split the combined "a-b" strings back onto the two name rows for the
  // familiar two-line scoreboard (deuce/ad/tiebreak fold into both columns).
  // previous split score values, for the broadcast change-animation
  let prevScore = { gp: '', gc: '', pp: '', pc: '', shown: false };

  function splitPair(s) {
    let body = s, prefix = '';
    if (s === 'Deuce') return ['40', '40'];
    if (s === 'Ad P') return ['Ad', '40'];
    if (s === 'Ad C') return ['40', 'Ad'];
    if (s.startsWith('TB ')) { prefix = 'TB'; body = s.slice(3); }
    const [a, b] = body.split('-');
    return [a, b, prefix];
  }
  function updateScore(games, points, p, c, serveNo) {
    const [gp, gc] = splitPair(games);
    const [pp, pc, tb] = splitPair(points);
    els.scoreboard.innerHTML =
      `<div class="sb-head"><span>GMS</span><span>PTS</span></div>` +
      `<div class="row"><b>${p}</b><span><i class="sb-g">${gp}</i><i class="sb-p">${pp}</i></span></div>` +
      `<div class="row"><b>${c}</b><span><i class="sb-g">${gc}</i><i class="sb-p">${pc}</i></span></div>` +
      (serveNo === 2 ? '<div class="row" style="color:#e8a04b;font-size:12px">2nd serve</div>' : '') +
      (tb === 'TB' ? '<div class="row" style="color:#e8f24b;font-size:12px">Tiebreak</div>' : '');
    // broadcast feel: pop the changed point, flash a won game
    if (prevScore.shown) {
      const gEls = els.scoreboard.querySelectorAll('.sb-g');
      const pEls = els.scoreboard.querySelectorAll('.sb-p');
      if (gp !== prevScore.gp && gEls[0]) gEls[0].classList.add('sb-flash');
      if (gc !== prevScore.gc && gEls[1]) gEls[1].classList.add('sb-flash');
      if (pp !== prevScore.pp && pEls[0]) pEls[0].classList.add('sb-pop');
      if (pc !== prevScore.pc && pEls[1]) pEls[1].classList.add('sb-pop');
    }
    prevScore = { gp, gc, pp, pc, shown: true };
  }

  // practice HUD: replace the scoreboard with a single feed-settings read-out
  function practiceHud(label) {
    els.scoreboard.innerHTML =
      `<div class="row"><b>PRACTICE</b></div>` +
      `<div class="row" style="color:#e8f24b;font-size:13px">${label}</div>`;
  }

  function banner(text) {
    const ms = 1300;
    els.banner.textContent = text;
    els.banner.style.opacity = 1;
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { els.banner.style.opacity = 0; }, ms);
  }

  function toast(text, ms = 1600) {
    els.toast.textContent = text;
    els.toast.style.opacity = 1;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.style.opacity = 0; }, ms);
  }

  function flashShot(type) {
    // keyboard shot bar shows the type; touch has a single shot button
    const ids = ['sb-' + type, 'tb-shot'];
    for (const id of ids) {
      const el = id && document.getElementById(id);
      if (!el) continue;
      el.classList.add('flash');
      if (flashTimers[id]) clearTimeout(flashTimers[id]);
      flashTimers[id] = setTimeout(() => el.classList.remove('flash'), 350);
    }
  }

  // Highlight the suggested shot on the keyboard shot bar. type '' clears.
  const RECOMMEND_IDS = {
    flat: ['sb-flat'],
    topspin: ['sb-topspin'],
    slice: ['sb-slice'],
    drop: ['sb-drop'],
  };
  function setRecommendedShot(type) {
    if (type === recommendedShot) return;
    recommendedShot = type;
    for (const key of Object.keys(RECOMMEND_IDS)) {
      const on = key === type;
      for (const id of RECOMMEND_IDS[key]) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('recommend', on);
      }
    }
  }

  function serveSpeedToast(kmh) {
    toast(`Serve: ${Math.round(kmh)} km/h`, 1600);
  }

  // serve type + speed combined, shown when the user serves
  function serveInfo(ty, kmh) {
    toast(`${ty} SERVE · ${Math.round(kmh)} km/h`, 1700);
  }

  // hitting-point quality 0..100 on the left, on non-serve hits. Colour ramps
  // red → amber → green; auto-hides shortly after the hit.
  let hqTimer = null;
  function hitQuality(q) {
    const v = Math.max(0, Math.min(100, Math.round(q)));
    const hue = 120 * (v / 100); // 0 = red, 120 = green
    const col = `hsl(${hue}, 85%, 55%)`;
    els.hqNum.textContent = v;
    els.hqNum.style.color = col;
    els.hqFill.style.height = `${v}%`;
    els.hqFill.style.background = col;
    els.hitquality.style.opacity = 1;
    if (hqTimer) clearTimeout(hqTimer);
    hqTimer = setTimeout(() => { els.hitquality.style.opacity = 0; }, 1100);
  }
  function hideHitQuality() {
    if (hqTimer) clearTimeout(hqTimer);
    els.hitquality.style.opacity = 0;
  }

  // ---------- unified gauges (toss / timing / height) ----------
  // frac/lo/hi in [0,1]. toss + height are VERTICAL (measured from the bottom);
  // timing is the HORIZONTAL meter (left-to-right). good => the dot snaps green.

  function gauge(name, frac, lo, hi, good) {
    const f = Math.max(0, Math.min(1, frac));
    if (name === 'toss') {
      if (!gaugeShown.toss) { els.tossgauge.style.display = 'block'; gaugeShown.toss = true; }
      els.tgBand.style.bottom = `${(lo * 100).toFixed(1)}%`;
      els.tgBand.style.height = `${((hi - lo) * 100).toFixed(1)}%`;
      els.tgDot.style.bottom = `${(f * 100).toFixed(1)}%`;
      els.tgDot.classList.toggle('sweet', !!good);
    } else if (name === 'timing') {
      if (!gaugeShown.timing) { els.timingmeter.style.display = 'block'; gaugeShown.timing = true; }
      els.tmBand.style.left = `${(lo * 100).toFixed(1)}%`;
      els.tmBand.style.width = `${((hi - lo) * 100).toFixed(1)}%`;
      els.tmDot.style.left = `${(f * 100).toFixed(1)}%`;
      els.tmDot.classList.toggle('good', !!good);
    } else if (name === 'power') {
      if (!gaugeShown.power) { els.powermeter.style.display = 'block'; gaugeShown.power = true; }
      els.pmBand.style.left = `${(lo * 100).toFixed(1)}%`;
      els.pmBand.style.width = `${((hi - lo) * 100).toFixed(1)}%`;
      els.pmDot.style.left = `${(f * 100).toFixed(1)}%`;
      els.pmDot.classList.toggle('good', !!good);
    }
  }

  function hideGauge(name) {
    if (!gaugeShown[name]) return;
    gaugeShown[name] = false;
    if (name === 'toss') els.tossgauge.style.display = 'none';
    else if (name === 'timing') els.timingmeter.style.display = 'none';
    else if (name === 'power') els.powermeter.style.display = 'none';
  }

  // hold-to-charge bar. frac is the elapsed press time over the charge ceiling
  // [0,1]. The bar fills smoothly; more charge = more power, no penalty.
  let chargeShown = false;
  function charge(frac) {
    const f = Math.max(0, Math.min(1, frac));
    if (!chargeShown) { els.chargebar.style.display = 'block'; chargeShown = true; }
    els.cbFill.style.width = `${f * 100}%`;

  }
  function hideCharge() {
    if (!chargeShown) return;
    chargeShown = false;
    els.chargebar.style.display = 'none';
  }

  // The on-screen move-assist arrow has been removed; keep no-op stubs so any
  // stale FFI binding stays harmless.
  function moveHint() {}
  function hideMoveHint() {}

  applyTouchVisibility();
  hideHUD();

  return {
    setMenuTapHandler(fn) { menuTapHandler = fn; },
    showTitle,
    showSetup, showPlayers,
    showPause, hidePause,
    showResults, hideMenu,
    showHUD, hideHUD, updateScore, practiceHud,
    banner, toast, flashShot, serveSpeedToast, serveInfo, setRecommendedShot,
    gauge, hideGauge, charge, hideCharge,
    hitQuality, hideHitQuality,
    moveHint, hideMoveHint,
  };
}
