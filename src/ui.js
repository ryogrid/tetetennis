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
  position: absolute; bottom: 14px; right: 14px; font-size: 12px; color: #888;
  background: rgba(10,10,18,.7); padding: 8px 12px; border-radius: 6px; text-align: right;
}
#src-link {
  position: absolute; bottom: 14px; left: 14px; font-size: 12px; color: #666;
  background: rgba(10,10,18,.6); padding: 5px 10px; border-radius: 5px;
  text-decoration: none; pointer-events: auto; transition: color .2s;
}
#src-link:hover { color: #e8f24b; }
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
`;

export function createUI({ onVirtualKey, onMoveAxis } = {}) {
  const els = {};
  let bannerTimer = null;
  let toastTimer = null;
  const flashTimers = {};
  let menuTapHandler = null;
  let hudShown = false;
  let touchVisible = false;
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
  function statBars(stats) {
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
      `<polygon points="${poly}" fill="rgba(80,230,120,.28)" stroke="#50e678" stroke-width="1.5"/>${labels}</svg>`;
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
  els.shotbar.innerHTML =
    '<div id="sb-flat">Z Flat</div><div id="sb-topspin">X Topspin</div>' +
    '<div id="sb-slice">C Slice</div><div id="sb-drop">V Drop</div>';
  els.controls.innerHTML =
    'Move: Arrow keys<br>Shots: <b>hold</b> Z/X/C/V to charge, <b>release</b> to hit ' +
    '(Z flat &middot; X topspin &middot; C slice &middot; V drop)<br>' +
    'Release in the sweet spot for a Perfect Hit; longer charge = more power<br>' +
    'Serve: Space toss, then Z/X/C when the power meter is in the green band<br>' +
    'Aim: hold a direction at the moment you release';

  // source-code link (bottom-left)
  const srcLink = document.createElement('a');
  srcLink.id = 'src-link';
  srcLink.href = 'https://github.com/ryogrid/tetetennis';
  srcLink.target = '_blank';
  srcLink.rel = 'noopener';
  srcLink.textContent = 'source code';
  hud.appendChild(srcLink);

  // menu tap support (tap a card to select it, tap again to confirm).
  // Results screen taps pass index 0; menu_tap ignores the value there.
  els.menu.addEventListener('pointerdown', (e) => {
    if (!menuTapHandler) return;
    const card = e.target.closest('[data-idx]');
    if (card) menuTapHandler(parseInt(card.dataset.idx, 10));
    else if (els.menu.dataset.screen === 'results') menuTapHandler(0);
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
  cam.innerHTML = '&#127909;'; // 🎥
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
    onKey('KeyB', true);
    onKey('KeyB', false);
  });
  quit.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onKey('Escape', true);
    onKey('Escape', false);
  });

  // ---------- menus ----------

  function showCharSelect(title, idx, subtitle) {
    els.menu.style.display = 'flex';
    els.menu.dataset.screen = 'select';
    els.menu.innerHTML =
      `<div class="title">${title}</div>` +
      (subtitle ? `<div class="subtitle">${subtitle}</div>` : '') +
      `<div class="cards">` +
      CHARACTERS.map((c, i) =>
        `<div class="card${i === idx ? ' sel' : ''}" id="card${i}" data-idx="${i}">
          <h3 style="color:#${c.color.toString(16).padStart(6, '0')}">${c.name}</h3>
          <div class="arch">${c.archetype}</div>
          <div class="desc">${c.desc}</div>
          ${statBars(c.stats)}
        </div>`).join('') +
      `</div><div class="hint">&larr; &rarr; select &middot; Enter confirm &middot; or tap (tap again to confirm)</div>`;
  }

  function showSurfaceSelect(idx) {
    els.menu.style.display = 'flex';
    els.menu.dataset.screen = 'select';
    els.menu.innerHTML =
      `<div class="title">SELECT SURFACE</div><div class="cards">` +
      SURFACE_IDS.map((s, i) => {
        const t = SURFACE_THEMES[s];
        return `<div class="card${i === idx ? ' sel' : ''}" data-idx="${i}">
          <div class="swatch" style="background:#${t.court.toString(16).padStart(6, '0')}"></div>
          <div class="swatch-label">${t.label}</div>
        </div>`;
      }).join('') +
      `</div><div class="hint">&larr; &rarr; select &middot; Enter confirm &middot; Esc back &middot; or tap (tap again to confirm)</div>`;
  }

  function showDifficultySelect(idx) {
    els.menu.style.display = 'flex';
    els.menu.dataset.screen = 'select';
    els.menu.innerHTML =
      `<div class="title">SELECT DIFFICULTY</div><div class="cards">` +
      DIFFICULTIES.map((l, i) =>
        `<div class="card${i === idx ? ' sel' : ''}" data-idx="${i}">
          <h3>${l.name.toUpperCase()}</h3>
          <div class="desc">${l.desc}</div>
        </div>`).join('') +
      `</div><div class="hint">&larr; &rarr; select &middot; Enter confirm &middot; Esc back &middot; or tap (tap again to confirm)</div>`;
  }

  function showGamesSelect(idx) {
    els.menu.style.display = 'flex';
    els.menu.dataset.screen = 'select';
    els.menu.innerHTML =
      `<div class="title">SET LENGTH</div><div class="cards">` +
      GAMES_OPTIONS.map((o, i) =>
        `<div class="card${i === idx ? ' sel' : ''}" data-idx="${i}">
          <h3>${o.name.toUpperCase()}</h3>
          <div class="desc">${o.desc}</div>
        </div>`).join('') +
      `</div><div class="hint">&larr; &rarr; select &middot; Enter confirm &middot; Esc back &middot; or tap (tap again to confirm)</div>`;
  }

  // generic card-list screen for the simple name/desc selectors
  function cardListScreen(title, options, idx, withEsc, subtitle) {
    els.menu.style.display = 'flex';
    els.menu.dataset.screen = 'select';
    const hint = withEsc
      ? '&larr; &rarr; select &middot; Enter confirm &middot; Esc back &middot; or tap (tap again to confirm)'
      : '&larr; &rarr; select &middot; Enter confirm &middot; or tap (tap again to confirm)';
    els.menu.innerHTML =
      `<div class="title">${title}</div>` +
      (subtitle ? `<div class="subtitle">${subtitle}</div>` : '') +
      `<div class="cards">` +
      options.map((o, i) =>
        `<div class="card${i === idx ? ' sel' : ''}" data-idx="${i}">
          <h3>${o.name.toUpperCase()}</h3>
          <div class="desc">${o.desc}</div>
        </div>`).join('') +
      `</div><div class="hint">${hint}</div>`;
  }

  function showModeSelect(idx) {
    cardListScreen('SELECT MODE', MODE_OPTIONS, idx, false);
  }

  function showPracticeFeed(idx) {
    cardListScreen('CPU FEEDS', FEED_OPTIONS, idx, true);
  }

  function showPracticeShot(idx, kind) {
    cardListScreen('BALL TYPE', kind === 1 ? SERVE_SHOTS : STROKE_SHOTS, idx, true);
  }

  function showPracticeDepth(idx) {
    cardListScreen('FEED DEPTH', DEPTH_OPTIONS, idx, true);
  }

  function showAssistSelect(idx) {
    els.menu.style.display = 'flex';
    els.menu.dataset.screen = 'select';
    els.menu.innerHTML =
      `<div class="title">ASSIST (FOR YOU)</div>` +
      `<div class="subtitle">Help for the player &mdash; independent of opponent strength</div>` +
      `<div class="cards">` +
      ASSIST_OPTIONS.map((o, i) =>
        `<div class="card${i === idx ? ' sel' : ''}" data-idx="${i}">
          <h3>${o.name.toUpperCase()}</h3>
          <div class="desc">${o.desc}</div>
        </div>`).join('') +
      `</div><div class="hint">&larr; &rarr; select &middot; Enter confirm &middot; Esc back &middot; or tap (tap again to confirm)</div>`;
  }

  function showResults(win, lose, games, playerWon, difficulty, stats) {
    els.menu.style.display = 'flex';
    els.menu.dataset.screen = 'results';
    // stats: ';'-separated "Label\tYou\tOpp" rows
    const rows = (stats || '').split(';').filter(Boolean).map((r) => {
      const [label, you, opp] = r.split('\t');
      return `<tr><td>${label}</td><td>${you}</td><td>${opp}</td></tr>`;
    }).join('');
    const table = rows
      ? `<table class="matchstats"><tr><th></th><th>You</th><th>${lose}</th></tr>${rows}</table>`
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

  function showHUD() {
    hudShown = true;
    els.scoreboard.style.display = 'block';
    applyTouchVisibility();
  }

  function hideHUD() {
    hudShown = false;
    els.scoreboard.style.display = 'none';
    els.banner.style.opacity = 0;
    els.toast.style.opacity = 0;
    hideGauge('toss');
    hideGauge('timing');
    hideGauge('height');
    hideMoveHint();
    setRecommendedShot('');
    applyTouchVisibility();
  }

  // games/points are preformatted COMBINED strings from the logic
  // (games "2-1", points "40-0" | "Deuce" | "Ad P" | "TB 3-2"); p/c are the
  // player/cpu names. serveNo is 1 or 2. The logic owns all score formatting,
  // so we split the combined "a-b" strings back onto the two name rows for the
  // familiar two-line scoreboard (deuce/ad/tiebreak fold into both columns).
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
      `<div class="row"><b>${p}</b><span>${gp} &nbsp; ${pp}</span></div>` +
      `<div class="row"><b>${c}</b><span>${gc} &nbsp; ${pc}</span></div>` +
      (serveNo === 2 ? '<div class="row" style="color:#e8a04b;font-size:12px">2nd serve</div>' : '') +
      (tb === 'TB' ? '<div class="row" style="color:#e8f24b;font-size:12px">Tiebreak</div>' : '');
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
    showCharSelect, showSurfaceSelect, showDifficultySelect, showGamesSelect, showAssistSelect,
    showModeSelect, showPracticeFeed, showPracticeShot, showPracticeDepth,
    showPause, hidePause,
    showResults, hideMenu,
    showHUD, hideHUD, updateScore, practiceHud,
    banner, toast, flashShot, serveSpeedToast, setRecommendedShot,
    gauge, hideGauge, charge, hideCharge,
    moveHint, hideMoveHint,
  };
}
