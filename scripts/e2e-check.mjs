// End-to-end smoke test: drives the real game in headless Chromium.
// Requires the dev server: npm run dev -- --port 5199
// Run: node scripts/e2e-check.mjs
import { chromium } from 'playwright';

const URL = process.env.GAME_URL || 'http://localhost:5199/';
let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failures++;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(m.text());
});

await page.goto(URL);
await page.waitForTimeout(1200);

check('page loads without errors', pageErrors.length === 0, pageErrors[0]);
const title = await page.textContent('.title').catch(() => null);
check('character select shown', title === 'SELECT YOUR PLAYER', title);
await page.screenshot({ path: 'scripts/shots/01-charselect.png' });

// pick Rojo (idx 1) as player, Dash as opponent, grass surface
// (keys need a frame between them: edge detection is per render frame)
async function press(key) {
  await page.keyboard.press(key);
  await page.waitForTimeout(60);
}
await press('ArrowRight');
await press('Enter'); // player = rojo
await press('ArrowRight');
await press('ArrowRight'); // opponent: dash (idx 2)
await press('Enter');
const surfTitle = await page.textContent('.title').catch(() => null);
check('surface select shown', surfTitle === 'SELECT SURFACE', surfTitle);
await press('ArrowLeft'); // hard(2) -> grass(1)
await press('Enter');
const diffTitle = await page.textContent('.title').catch(() => null);
check('difficulty select shown', diffTitle === 'SELECT DIFFICULTY', diffTitle);
await press('Enter'); // normal (default)
await page.waitForTimeout(400);

const state1 = await page.evaluate(() => ({
  state: window.__game.state,
  pointState: window.__game.pointState,
  surface: window.__game.sel.surfaceId,
  player: window.__game.sel.player.id,
  opp: window.__game.sel.opp.id,
  difficulty: window.__game.sel.difficulty,
}));
check('match started', state1.state === 'match', JSON.stringify(state1));
check('grass selected', state1.surface === 'grass', state1.surface);
check('normal difficulty selected', state1.difficulty === 'normal', state1.difficulty);
check('player is rojo, opp is dash', state1.player === 'rojo' && state1.opp === 'dash',
  `${state1.player} vs ${state1.opp}`);
check('waiting for serve', state1.pointState === 'pre_serve', state1.pointState);
await page.screenshot({ path: 'scripts/shots/02-preserve.png' });

// Play several points: toss + hit, then mash a groundstroke key with movement
// so the human sometimes returns. CPU plays for real.
async function playPoint(i) {
  const ps = await page.evaluate(() => window.__game.pointState);
  if (ps !== 'pre_serve') return;
  const server = await page.evaluate(() => window.__game.match.server);
  if (server === 'P') {
    await page.keyboard.press('Space'); // toss
    await page.waitForTimeout(520);     // near apex
    await page.keyboard.press(['KeyZ', 'KeyX', 'KeyC'][i % 3]);
  }
  // rally: hold a direction and swing periodically
  for (let t = 0; t < 24; t++) {
    const st = await page.evaluate(() => ({
      ps: window.__game.pointState,
      ballZ: window.__game.ball ? window.__game.ball.state.pos.z : 0,
      ballActive: window.__game.ball ? window.__game.ball.state.active : false,
    }));
    if (st.ps === 'point_over' || st.ps === 'pre_serve') break;
    if (st.ps === 'rally' && st.ballActive && st.ballZ > 7) {
      await page.keyboard.press('KeyX'); // try a topspin when ball is close
    }
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(2300); // let point_over elapse
}

let sawRally = false;
let sawServeSpeed = false;
for (let i = 0; i < 6; i++) {
  await playPoint(i);
  const snap = await page.evaluate(() => ({
    ps: window.__game.pointState,
    state: window.__game.state,
    points: window.__game.match ? { ...window.__game.match.points } : null,
    games: window.__game.match ? { ...window.__game.match.games } : null,
  }));
  if (i === 1) await page.screenshot({ path: 'scripts/shots/03-rally.png' });
  const toast = await page.textContent('#toast').catch(() => '');
  if (toast && toast.includes('km/h')) sawServeSpeed = true;
  if (snap.state !== 'match') break;
  const total = snap.points.P + snap.points.C + (snap.games.P + snap.games.C) * 4;
  if (total > 0) sawRally = true;
}

const finalSnap = await page.evaluate(() => ({
  state: window.__game.state,
  points: window.__game.match ? { ...window.__game.match.points } : null,
  games: window.__game.match ? { ...window.__game.match.games } : null,
  tb: window.__game.match ? window.__game.match.tiebreak : null,
}));
console.log('  final:', JSON.stringify(finalSnap));
check('points were scored across 6 serves', sawRally, JSON.stringify(finalSnap));
check('no page errors during play', pageErrors.length === 0, pageErrors[0]);
await page.screenshot({ path: 'scripts/shots/04-after-points.png' });

// scoreboard sanity
const sb = await page.textContent('#scoreboard');
check('scoreboard renders names', sb.includes('Rojo') && sb.includes('Dash'), sb.slice(0, 60));

// Esc back to menu
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const backTitle = await page.textContent('.title').catch(() => null);
check('Esc returns to menu', backTitle === 'SELECT YOUR PLAYER', backTitle);

await browser.close();
console.log(failures === 0 ? '\nE2E smoke passed.' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
