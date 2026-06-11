// DOM overlay: HUD + menu screens. Holds no game state; game.js drives it.
import { SURFACE_THEMES } from './court.js';

const css = `
#hud * { box-sizing: border-box; }
.screen {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 24px;
  background: rgba(8, 8, 16, 0.88); pointer-events: none;
}
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
`;

let els = {};
let bannerTimer = null;
let toastTimer = null;
const flashTimers = {};

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

export function initUI() {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  const hud = document.getElementById('hud');
  hud.innerHTML = '';
  els.menu = div('menu', hud, 'screen');
  els.scoreboard = div('scoreboard', hud);
  els.banner = div('banner', hud);
  els.toast = div('toast', hud);
  els.shotbar = div('shotbar', hud);
  els.controls = div('controls', hud);
  els.shotbar.innerHTML =
    '<div id="sb-flat">Z Flat</div><div id="sb-topspin">X Topspin</div><div id="sb-slice">C Slice</div>';
  els.controls.innerHTML =
    'Move: WASD / Arrows<br>Shots: Z flat &middot; X topspin &middot; C slice<br>' +
    'Serve: Space toss, then Z/X/C<br>Aim: hold a direction while swinging';
  hideHUD();
}

export function showCharSelect(title, chars, idx, subtitle) {
  els.menu.style.display = 'flex';
  els.menu.innerHTML =
    `<div class="title">${title}</div>` +
    (subtitle ? `<div class="subtitle">${subtitle}</div>` : '') +
    `<div class="cards">` +
    chars.map((c, i) =>
      `<div class="card${i === idx ? ' sel' : ''}" id="card${i}">
        <h3 style="color:#${c.color.toString(16).padStart(6, '0')}">${c.name}</h3>
        <div class="arch">${c.archetype}</div>
        <div class="desc">${c.desc}</div>
        ${statBars(c.stats)}
      </div>`).join('') +
    `</div><div class="hint">&larr; &rarr; select &middot; Enter confirm</div>`;
}

export function showSurfaceSelect(idx) {
  const surfaces = ['clay', 'grass', 'hard'];
  els.menu.style.display = 'flex';
  els.menu.innerHTML =
    `<div class="title">SELECT SURFACE</div><div class="cards">` +
    surfaces.map((s, i) => {
      const t = SURFACE_THEMES[s];
      return `<div class="card${i === idx ? ' sel' : ''}">
        <div class="swatch" style="background:#${t.court.toString(16).padStart(6, '0')}"></div>
        <div class="swatch-label">${t.label}</div>
      </div>`;
    }).join('') +
    `</div><div class="hint">&larr; &rarr; select &middot; Enter confirm &middot; Esc back</div>`;
}

export function showResults(winnerName, loserName, games, playerWon) {
  els.menu.style.display = 'flex';
  els.menu.innerHTML =
    `<div class="title">${playerWon ? 'YOU WIN!' : 'YOU LOSE'}</div>` +
    `<div class="subtitle">${winnerName} d. ${loserName} &nbsp; ${games}</div>` +
    `<div class="hint">Enter: back to menu</div>`;
}

export function hideMenu() {
  els.menu.style.display = 'none';
}

export function showHUD() {
  els.scoreboard.style.display = 'block';
  els.shotbar.style.display = 'flex';
  els.controls.style.display = 'block';
}

export function hideHUD() {
  els.scoreboard.style.display = 'none';
  els.shotbar.style.display = 'none';
  els.controls.style.display = 'none';
  els.banner.style.opacity = 0;
  els.toast.style.opacity = 0;
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

export function flashShot(type) {
  const el = document.getElementById('sb-' + type);
  if (!el) return;
  el.classList.add('flash');
  if (flashTimers[type]) clearTimeout(flashTimers[type]);
  flashTimers[type] = setTimeout(() => el.classList.remove('flash'), 350);
}

export function serveSpeedToast(kmh) {
  toast(`Serve: ${Math.round(kmh)} km/h`, 1600);
}
