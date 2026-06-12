// DOM overlay: HUD + menu screens. Holds no game state; game.js drives it.
import { SURFACE_THEMES } from './court.js';

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
#controls {
  position: absolute; bottom: 14px; right: 14px; font-size: 12px; color: #888;
  background: rgba(10,10,18,.7); padding: 8px 12px; border-radius: 6px; text-align: right;
}
#touchui { position: absolute; inset: 0; pointer-events: none; display: none; }
#dpad {
  position: absolute; left: 16px; bottom: 16px; width: 176px; height: 176px;
  border-radius: 50%; background: rgba(18,18,28,.35);
  border: 1px solid rgba(255,255,255,.18);
  pointer-events: auto; touch-action: none;
}
#dpad span {
  position: absolute; font-size: 26px; color: rgba(255,255,255,.55);
  transform: translate(-50%,-50%);
}
#dpad span.lit { color: #e8f24b; }
#dpad .du { left: 50%; top: 17%; }
#dpad .dd { left: 50%; top: 83%; }
#dpad .dl { left: 17%; top: 50%; }
#dpad .dr { left: 83%; top: 50%; }
.tbtn {
  position: absolute; pointer-events: auto; touch-action: none;
  width: 74px; height: 74px; border-radius: 50%;
  background: rgba(18,18,28,.55); border: 2px solid rgba(255,255,255,.3);
  color: #eee; font-weight: 700; font-size: 13px; letter-spacing: 1px;
  display: flex; align-items: center; justify-content: center;
}
.tbtn.pressed, .tbtn.flash { background: #e8f24b; color: #111; border-color: #e8f24b; }
#tb-flat  { right: 140px; bottom: 16px; }
#tb-top   { right: 104px; bottom: 96px; }
#tb-slice { right: 24px;  bottom: 148px; }
#tb-serve {
  right: 34px; bottom: 30px; width: 62px; height: 62px; font-size: 11px;
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
#movehint {
  position: absolute; bottom: 24%; left: 50%; transform: translateX(-50%);
  font-size: 38px; font-weight: 800; color: #39d7ff; display: none;
  text-shadow: 0 2px 10px #000;
}
#movehint.here { color: #50e678; }
#tc-bar { position: absolute; top: 12px; right: 12px; display: none; gap: 8px; }
#tc-bar button {
  pointer-events: auto; width: 44px; height: 38px; border-radius: 8px;
  background: rgba(18,18,28,.6); color: #ccc;
  border: 1px solid rgba(255,255,255,.25); font-size: 17px;
}
`;

let els = {};
let bannerTimer = null;
let toastTimer = null;
const flashTimers = {};
let menuTapHandler = null;
let hudShown = false;
let touchVisible = false;

export function setMenuTapHandler(fn) { menuTapHandler = fn; }

function div(id, parent, cls) {
  const d = document.createElement('div');
  if (id) d.id = id;
  if (cls) d.className = cls;
  (parent || document.getElementById('hud')).appendChild(d);
  return d;
}

function statBars(stats) {
  const order = ['POW', 'SPN', 'SLC', 'SRV', 'SPD', 'CTL'];
  return order.map((k) =>
    `<div class="statrow"><span>${k}</span><div class="statbar"><i style="width:${stats[k]}%"></i></div></div>`
  ).join('');
}

export function initUI({ onVirtualKey } = {}) {
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
  els.movehint = div('movehint', hud);
  els.shotbar.innerHTML =
    '<div id="sb-flat">Z Flat</div><div id="sb-topspin">X Topspin</div><div id="sb-slice">C Slice</div>';
  els.controls.innerHTML =
    'Move: WASD / Arrows<br>Shots: Z flat &middot; X topspin &middot; C slice<br>' +
    'Serve: Space toss, then Z/X/C<br>Aim: hold a direction while swinging';

  // menu tap support (tap a card to select it, tap again to confirm)
  els.menu.addEventListener('pointerdown', (e) => {
    if (!menuTapHandler) return;
    const card = e.target.closest('[data-idx]');
    if (card) menuTapHandler(parseInt(card.dataset.idx, 10));
    else if (els.menu.dataset.screen === 'results') menuTapHandler('confirm');
  });

  buildTouchControls(hud, onVirtualKey || (() => {}));
  hideHUD();
}

// ---------- on-screen controls (two-handed phone grip) ----------

function buildTouchControls(hud, onKey) {
  els.touchui = div('touchui', hud);

  // D-pad, bottom-left (left thumb): 8-way, position based, slideable
  const dpad = div('dpad', els.touchui);
  dpad.innerHTML =
    '<span class="du">&#9650;</span><span class="dd">&#9660;</span>' +
    '<span class="dl">&#9664;</span><span class="dr">&#9654;</span>';
  const arrows = {
    ArrowUp: dpad.querySelector('.du'),
    ArrowDown: dpad.querySelector('.dd'),
    ArrowLeft: dpad.querySelector('.dl'),
    ArrowRight: dpad.querySelector('.dr'),
  };
  const DIRS = Object.keys(arrows);
  let dpadPointer = null;
  const held = new Set();
  function applyDirs(want) {
    for (const k of DIRS) {
      const w = want.has(k);
      if (w && !held.has(k)) { held.add(k); onKey(k, true); arrows[k].classList.add('lit'); }
      if (!w && held.has(k)) { held.delete(k); onKey(k, false); arrows[k].classList.remove('lit'); }
    }
  }
  function dirsFromEvent(e) {
    const r = dpad.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    const want = new Set();
    if (d > r.width * 0.12) {
      const nx = dx / d, ny = dy / d;
      if (nx < -0.42) want.add('ArrowLeft');
      if (nx > 0.42) want.add('ArrowRight');
      if (ny < -0.42) want.add('ArrowUp');
      if (ny > 0.42) want.add('ArrowDown');
    }
    return want;
  }
  dpad.addEventListener('pointerdown', (e) => {
    if (dpadPointer !== null) return;
    dpadPointer = e.pointerId;
    try { dpad.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
    applyDirs(dirsFromEvent(e));
    e.preventDefault();
  });
  dpad.addEventListener('pointermove', (e) => {
    if (e.pointerId === dpadPointer) applyDirs(dirsFromEvent(e));
  });
  const dpadRelease = (e) => {
    if (e.pointerId !== dpadPointer) return;
    dpadPointer = null;
    applyDirs(new Set());
  };
  dpad.addEventListener('pointerup', dpadRelease);
  dpad.addEventListener('pointercancel', dpadRelease);

  // shot + serve buttons, bottom-right (right thumb), arced for reach
  const BUTTONS = [
    ['tb-flat', 'FLAT', 'KeyZ'],
    ['tb-top', 'TOP', 'KeyX'],
    ['tb-slice', 'SLICE', 'KeyC'],
    ['tb-serve', 'SERVE', 'Space'],
  ];
  for (const [id, label, code] of BUTTONS) {
    const b = div(id, els.touchui, 'tbtn');
    b.textContent = label;
    b.addEventListener('pointerdown', (e) => {
      try { b.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
      b.classList.add('pressed');
      onKey(code, true);
      e.preventDefault();
    });
    const up = () => { b.classList.remove('pressed'); onKey(code, false); };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  }

  // toggle + quit, top-right
  els.tcBar = div('tc-bar', hud);
  const toggle = document.createElement('button');
  toggle.id = 'tc-toggle';
  const quit = document.createElement('button');
  quit.id = 'tc-quit';
  quit.innerHTML = '&#10005;';
  els.tcBar.append(toggle, quit);
  els.tcToggle = toggle;

  const stored = localStorage.getItem('touchControls');
  touchVisible = stored !== null
    ? stored === 'on'
    : window.matchMedia('(pointer: coarse)').matches;

  toggle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    touchVisible = !touchVisible;
    localStorage.setItem('touchControls', touchVisible ? 'on' : 'off');
    applyTouchVisibility();
  });
  quit.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onKey('Escape', true);
    onKey('Escape', false);
  });
}

function applyTouchVisibility() {
  els.touchui.style.display = hudShown && touchVisible ? 'block' : 'none';
  els.tcBar.style.display = hudShown ? 'flex' : 'none';
  // keyboard-oriented HUD boxes collide with the touch buttons; swap them
  els.shotbar.style.display = hudShown && !touchVisible ? 'flex' : 'none';
  els.controls.style.display = hudShown && !touchVisible ? 'block' : 'none';
  if (els.tcToggle) els.tcToggle.innerHTML = touchVisible ? '&#9000;' : '&#127918;';
}

export function showCharSelect(title, chars, idx, subtitle) {
  els.menu.style.display = 'flex';
  els.menu.dataset.screen = 'select';
  els.menu.innerHTML =
    `<div class="title">${title}</div>` +
    (subtitle ? `<div class="subtitle">${subtitle}</div>` : '') +
    `<div class="cards">` +
    chars.map((c, i) =>
      `<div class="card${i === idx ? ' sel' : ''}" id="card${i}" data-idx="${i}">
        <h3 style="color:#${c.color.toString(16).padStart(6, '0')}">${c.name}</h3>
        <div class="arch">${c.archetype}</div>
        <div class="desc">${c.desc}</div>
        ${statBars(c.stats)}
      </div>`).join('') +
    `</div><div class="hint">&larr; &rarr; select &middot; Enter confirm &middot; or tap (tap again to confirm)</div>`;
}

export function showSurfaceSelect(idx) {
  const surfaces = ['clay', 'grass', 'hard'];
  els.menu.style.display = 'flex';
  els.menu.dataset.screen = 'select';
  els.menu.innerHTML =
    `<div class="title">SELECT SURFACE</div><div class="cards">` +
    surfaces.map((s, i) => {
      const t = SURFACE_THEMES[s];
      return `<div class="card${i === idx ? ' sel' : ''}" data-idx="${i}">
        <div class="swatch" style="background:#${t.court.toString(16).padStart(6, '0')}"></div>
        <div class="swatch-label">${t.label}</div>
      </div>`;
    }).join('') +
    `</div><div class="hint">&larr; &rarr; select &middot; Enter confirm &middot; Esc back &middot; or tap (tap again to confirm)</div>`;
}

export function showResults(winnerName, loserName, games, playerWon) {
  els.menu.style.display = 'flex';
  els.menu.dataset.screen = 'results';
  els.menu.innerHTML =
    `<div class="title">${playerWon ? 'YOU WIN!' : 'YOU LOSE'}</div>` +
    `<div class="subtitle">${winnerName} d. ${loserName} &nbsp; ${games}</div>` +
    `<div class="hint">Enter or tap: back to menu</div>`;
}

export function hideMenu() {
  els.menu.style.display = 'none';
}

export function showHUD() {
  hudShown = true;
  els.scoreboard.style.display = 'block';
  applyTouchVisibility();
}

export function hideHUD() {
  hudShown = false;
  els.scoreboard.style.display = 'none';
  els.banner.style.opacity = 0;
  els.toast.style.opacity = 0;
  hideTossGauge();
  hideMoveHint();
  applyTouchVisibility();
}

export function updateScore(s, pName, cName, serveNumber) {
  const dotP = s.server === 'P' ? ' <span class="serve">&bull;</span>' : '';
  const dotC = s.server === 'C' ? ' <span class="serve">&bull;</span>' : '';
  const [gp, gc] = s.games.split('-');
  let pp = '', pc = '';
  if (s.points === 'Deuce') { pp = '40'; pc = '40'; }
  else if (s.points === 'Ad P') { pp = 'Ad'; pc = '40'; }
  else if (s.points === 'Ad C') { pp = '40'; pc = 'Ad'; }
  else if (s.points.startsWith('TB')) { [pp, pc] = s.points.slice(3).split('-'); }
  else { [pp, pc] = s.points.split('-'); }
  els.scoreboard.innerHTML =
    `<div class="row"><b>${pName}${dotP}</b><span>${gp} &nbsp; ${pp}</span></div>` +
    `<div class="row"><b>${cName}${dotC}</b><span>${gc} &nbsp; ${pc}</span></div>` +
    (serveNumber === 2 ? '<div class="row" style="color:#e8a04b;font-size:12px">2nd serve</div>' : '') +
    (s.points.startsWith('TB') ? '<div class="row" style="color:#e8f24b;font-size:12px">Tiebreak</div>' : '');
}

export function banner(text, ms = 1300) {
  els.banner.textContent = text;
  els.banner.style.opacity = 1;
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { els.banner.style.opacity = 0; }, ms);
}

export function toast(text, ms = 1600) {
  els.toast.textContent = text;
  els.toast.style.opacity = 1;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.style.opacity = 0; }, ms);
}

const TOUCH_FLASH_IDS = { flat: 'tb-flat', topspin: 'tb-top', slice: 'tb-slice' };
export function flashShot(type) {
  const ids = ['sb-' + type, TOUCH_FLASH_IDS[type]];
  for (const id of ids) {
    const el = id && document.getElementById(id);
    if (!el) continue;
    el.classList.add('flash');
    if (flashTimers[id]) clearTimeout(flashTimers[id]);
    flashTimers[id] = setTimeout(() => el.classList.remove('flash'), 350);
  }
}

export function serveSpeedToast(kmh) {
  toast(`Serve: ${Math.round(kmh)} km/h`, 1600);
}

// ---------- toss gauge (serve timing aid for the fixed FPV camera) ----------

let tossGaugeShown = false;

// frac/bandLo/bandHi in [0,1], measured from the bottom of the gauge.
export function updateTossGauge(frac, bandLo, bandHi, inSweet) {
  if (!tossGaugeShown) {
    els.tossgauge.style.display = 'block';
    tossGaugeShown = true;
  }
  els.tgBand.style.bottom = `${(bandLo * 100).toFixed(1)}%`;
  els.tgBand.style.height = `${((bandHi - bandLo) * 100).toFixed(1)}%`;
  els.tgDot.style.bottom = `${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%`;
  els.tgDot.classList.toggle('sweet', !!inSweet);
}

export function hideTossGauge() {
  if (!tossGaugeShown) return;
  els.tossgauge.style.display = 'none';
  tossGaugeShown = false;
}

// ---------- move hint (FPV can't see a sweet spot behind the camera) ----------

let moveHintShown = false;

// dx/dz: vector from the player to the sweet spot, court coords
// (+x screen right, +z toward the camera = backward).
export function updateMoveHint(dx, dz) {
  const ux = Math.abs(dx) > 0.45 ? Math.sign(dx) : 0;
  const uz = Math.abs(dz) > 0.45 ? Math.sign(dz) : 0;
  const ARROWS = {
    '-1,-1': '↖', '0,-1': '↑', '1,-1': '↗',
    '-1,0': '←', '1,0': '→',
    '-1,1': '↙', '0,1': '↓', '1,1': '↘',
  };
  const a = ARROWS[`${ux},${uz}`];
  els.movehint.textContent = a || '◎'; // on the spot
  els.movehint.classList.toggle('here', !a);
  if (!moveHintShown) {
    els.movehint.style.display = 'block';
    moveHintShown = true;
  }
}

export function hideMoveHint() {
  if (!moveHintShown) return;
  els.movehint.style.display = 'none';
  moveHintShown = false;
}
