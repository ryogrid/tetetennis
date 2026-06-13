// Player-side assist state — a single axis, decoupled from CPU difficulty.
//
//   'off'  — no player-side help (the classic balance)
//   'on'   — readability + feel aids: approach slow-motion, easier pace,
//            contact forgiveness  (DEFAULT)
//   'full' — everything in 'on' plus control-model aids: auto-swing and
//            positioning magnetism
//
// Every assist feature reads assistOn()/assistFull() so the Assist Mode menu
// (see ui.js / game.js) only has to set `assist.level`.
export const assist = { level: 'on' };

export const assistOn = () => assist.level !== 'off';
export const assistFull = () => assist.level === 'full';

const LEVELS = ['off', 'on', 'full'];

export function setAssistLevel(level) {
  if (LEVELS.includes(level)) assist.level = level;
}

// Load any persisted preference (called once at startup).
export function loadAssist() {
  try {
    const v = localStorage.getItem('assistLevel');
    if (v && LEVELS.includes(v)) assist.level = v;
  } catch { /* localStorage unavailable */ }
}

export function saveAssist() {
  try { localStorage.setItem('assistLevel', assist.level); } catch { /* ignore */ }
}
