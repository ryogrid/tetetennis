// Touch-controls smoke test: emulates a mobile device (coarse pointer,
// touch) and drives the game entirely without a keyboard.
// Requires the dev server: npm run dev -- --port 5199
import { chromium } from 'playwright';

const URL = process.env.GAME_URL || 'http://localhost:5199/';
let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failures++;
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 844, height: 390 }, // landscape phone
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });

await page.goto(URL);
await page.waitForTimeout(1000);

// --- menus by tap: select (1st tap) then confirm (2nd tap) ---
await page.tap('[data-idx="1"]'); // select Rojo
await page.waitForTimeout(150);
let sel = await page.evaluate(() => window.__game.menuIdx);
check('tap selects card', sel === 1, `menuIdx=${sel}`);
await page.tap('[data-idx="1"]'); // confirm Rojo
await page.waitForTimeout(150);
let st = await page.evaluate(() => window.__game.state);
check('second tap confirms player', st === 'menu_opp', st);
await page.tap('[data-idx="2"]'); // select Dash
await page.waitForTimeout(150);
await page.tap('[data-idx="2"]'); // confirm
await page.waitForTimeout(150);
st = await page.evaluate(() => window.__game.state);
check('opponent confirmed by tap', st === 'menu_surface', st);
await page.tap('[data-idx="2"]'); // hard already selected -> confirm
await page.waitForTimeout(400);
st = await page.evaluate(() => ({ state: window.__game.state, ps: window.__game.pointState }));
check('match started by tap', st.state === 'match', JSON.stringify(st));

// --- touch overlay should be on by default (coarse pointer) ---
const overlayVisible = await page.evaluate(() =>
  getComputedStyle(document.getElementById('touchui')).display !== 'none');
check('touch overlay visible on mobile', overlayVisible);
await page.screenshot({ path: 'scripts/shots/10-touch-overlay.png' });

// --- serve by buttons: SERVE (toss) then FLAT near apex ---
await page.tap('#tb-serve');
await page.waitForTimeout(500);
await page.tap('#tb-flat');
await page.waitForTimeout(300);
const serve = await page.evaluate(() => ({
  ps: window.__game.pointState,
  active: window.__game.ball.state.active,
  phase: window.__game.rally ? window.__game.rally.phase : null,
}));
check('serve fired via touch buttons', serve.ps === 'rally' && serve.active,
  JSON.stringify(serve));
await page.waitForTimeout(3500); // let the point resolve

// --- D-pad: hold left region, player.x must decrease ---
async function waitPreServe() {
  for (let i = 0; i < 20; i++) {
    const s = await page.evaluate(() => ({ ps: window.__game.pointState, sv: window.__game.match.server }));
    if (s.ps === 'pre_serve') return s;
    await page.waitForTimeout(400);
  }
  return null;
}
await waitPreServe();
const x0 = await page.evaluate(() => window.__game.human.pos.x);
const dpadBox = await page.locator('#dpad').boundingBox();
const cx = dpadBox.x + dpadBox.width / 2, cy = dpadBox.y + dpadBox.height / 2;
await page.dispatchEvent('#dpad', 'pointerdown', {
  pointerId: 7, pointerType: 'touch', isPrimary: true,
  clientX: cx - dpadBox.width * 0.38, clientY: cy,
});
await page.waitForTimeout(400);
await page.dispatchEvent('#dpad', 'pointerup', {
  pointerId: 7, pointerType: 'touch', isPrimary: true,
  clientX: cx - dpadBox.width * 0.38, clientY: cy,
});
const x1 = await page.evaluate(() => window.__game.human.pos.x);
check('D-pad left moves the player left', x1 < x0 - 0.2,
  `x ${x0.toFixed(2)} -> ${x1.toFixed(2)}`);

// --- toggle hides the overlay and restores keyboard HUD ---
await page.tap('#tc-toggle');
await page.waitForTimeout(150);
const afterToggle = await page.evaluate(() => ({
  overlay: getComputedStyle(document.getElementById('touchui')).display,
  shotbar: getComputedStyle(document.getElementById('shotbar')).display,
  stored: localStorage.getItem('touchControls'),
}));
check('toggle hides overlay, shows shotbar',
  afterToggle.overlay === 'none' && afterToggle.shotbar === 'flex',
  JSON.stringify(afterToggle));
check('preference persisted', afterToggle.stored === 'off', afterToggle.stored);
await page.screenshot({ path: 'scripts/shots/11-touch-hidden.png' });
await page.tap('#tc-toggle');
await page.waitForTimeout(150);
const reShown = await page.evaluate(() =>
  getComputedStyle(document.getElementById('touchui')).display !== 'none');
check('toggle shows overlay again', reShown);

// --- quit button returns to menu ---
await page.tap('#tc-quit');
await page.waitForTimeout(300);
st = await page.evaluate(() => window.__game.state);
check('quit button exits to char select', st === 'menu_char', st);

// --- results screen tap (force a quick match end) ---
check('no page errors', pageErrors.length === 0, pageErrors[0]);

await browser.close();
console.log(failures === 0 ? '\nTouch smoke passed.' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
