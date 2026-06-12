// FPV-update checks: first-person camera, toss gauge, sweet-spot marker,
// serve aim at the hit instant.
// Requires the dev server: npm run dev -- --port 5199
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
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });

await page.goto(URL);
await page.waitForTimeout(1000);

async function press(key) {
  await page.keyboard.press(key);
  await page.waitForTimeout(60);
}
// menus: Ace (idx 4) vs Dash (idx 2), hard court
for (let i = 0; i < 4; i++) await press('ArrowRight');
await press('Enter');
for (let i = 0; i < 2; i++) await press('ArrowRight');
await press('Enter');
await press('Enter'); // hard surface
await press('Enter'); // normal difficulty
await page.waitForTimeout(400);

const st = await page.evaluate(() => window.__game.state);
check('match started', st === 'match', st);

// --- FPV camera: at the player's eyes, looking toward the CPU court ---
const cam = await page.evaluate(() => ({
  cam: { ...window.__cam.position },
  player: { ...window.__game.human.pos },
}));
check('camera at eye height (~1.62)', Math.abs(cam.cam.y - 1.62) < 0.05,
  `y=${cam.cam.y.toFixed(2)}`);
check('camera at the player position',
  Math.abs(cam.cam.x - cam.player.x) < 0.3 &&
  Math.abs(cam.cam.z - (cam.player.z + 0.15)) < 0.4,
  `cam=(${cam.cam.x.toFixed(2)},${cam.cam.z.toFixed(2)}) player=(${cam.player.x.toFixed(2)},${cam.player.z.toFixed(2)})`);
check('own rig hidden in FPV', await page.evaluate(() => !window.__game.human.root.visible));
await page.screenshot({ path: 'scripts/shots/20-fpv-preserve.png' });

// --- toss gauge: appears during the toss, hides after the hit ---
await page.keyboard.press('Space'); // toss
await page.waitForTimeout(300);
const duringToss = await page.evaluate(() => ({
  gauge: getComputedStyle(document.getElementById('tossgauge')).display,
  camY: window.__cam.position.y,
  ps: window.__game.pointState,
}));
check('toss gauge visible while serving',
  duringToss.ps === 'serving' && duringToss.gauge === 'block', JSON.stringify(duringToss));
check('camera stays at eye height during toss (no tilt-up follow)',
  Math.abs(duringToss.camY - 1.62) < 0.05, `y=${duringToss.camY.toFixed(2)}`);
await page.screenshot({ path: 'scripts/shots/21-fpv-toss-gauge.png' });
await page.waitForTimeout(220); // near apex
await page.keyboard.press('KeyZ'); // flat serve
await page.waitForTimeout(250);
const afterHit = await page.evaluate(() => ({
  gauge: getComputedStyle(document.getElementById('tossgauge')).display,
  ps: window.__game.pointState,
  active: window.__game.ball.state.active,
}));
check('serve fired', afterHit.ps === 'rally' && afterHit.active, JSON.stringify(afterHit));
check('toss gauge hidden after the hit', afterHit.gauge === 'none', afterHit.gauge);

// --- sweet-spot marker: shows after a CPU shot heading to our side ---
let sawSweet = false;
let sweetPos = null;
let sawMoveHint = false;
let trailCount = 0;
for (let t = 0; t < 40 && !sawSweet; t++) {
  const s = await page.evaluate(() => ({
    vis: window.__game.ball.sweetMarker.visible,
    pos: { x: window.__game.ball.sweetMarker.position.x, z: window.__game.ball.sweetMarker.position.z },
    trailVis: window.__game.ball.trailMarker.visible,
    trailCount: window.__game.ball.trailMarker.count,
    hint: getComputedStyle(document.getElementById('movehint')).display,
    lastHitBy: window.__game.rally ? window.__game.rally.lastHitBy : null,
    ps: window.__game.pointState,
  }));
  if (s.vis) {
    sawSweet = true;
    sweetPos = s.pos;
    sawMoveHint = s.hint === 'block';
    if (s.trailVis) trailCount = s.trailCount;
    await page.screenshot({ path: 'scripts/shots/24-fpv-trail.png' });
  }
  if (s.ps === 'pre_serve') {
    // next point started without a CPU return; serve again
    await page.keyboard.press('Space');
    await page.waitForTimeout(520);
    await page.keyboard.press('KeyZ');
  }
  await page.waitForTimeout(250);
}
check('sweet-spot marker appeared for an incoming ball', sawSweet,
  sweetPos ? `at (${sweetPos.x.toFixed(1)}, ${sweetPos.z.toFixed(1)})` : 'never seen');
if (sweetPos) {
  check('sweet-spot marker is on the human side', sweetPos.z > 0,
    `z=${sweetPos.z.toFixed(1)}`);
  check('move hint shown with the marker', sawMoveHint);
  check('trajectory trail shown with the marker (>5 dots)', trailCount > 5,
    `${trailCount} dots`);
}
await page.screenshot({ path: 'scripts/shots/22-fpv-rally.png' });

// --- CPU motion + ideal-point probes (rig actually animates; the trail
// highlights a waist-height hit point in orange) ---
let maxStride = 0, maxSwingTurn = 0, maxServeArm = 0, sawIdealDot = false;
for (let t = 0; t < 160; t++) {
  const s = await page.evaluate(() => {
    const g = window.__game; const c = g.cpu;
    const tr = g.ball.trailMarker;
    let ideal = false;
    if (tr.visible && tr.instanceColor) {
      const a = tr.instanceColor.array;
      for (let i = 0; i < tr.count; i++) {
        const r = a[3 * i], gg = a[3 * i + 1], b = a[3 * i + 2];
        if (r > 0.8 && gg < 0.6 && b < 0.3) { ideal = true; break; }
      }
    }
    return {
      ps: g.pointState, server: g.match.server,
      vel: Math.hypot(c.vel.x, c.vel.z),
      swing: !!c.swing, serveAnim: !!c.serveAnim,
      hipX: Math.abs(c.joints.hipR.rotation.x),
      shY: Math.abs(c.joints.shoulderR.rotation.y),
      shX: c.joints.shoulderR.rotation.x,
      ideal,
    };
  });
  if (s.vel > 2.5 && !s.swing) maxStride = Math.max(maxStride, s.hipX);
  if (s.swing) maxSwingTurn = Math.max(maxSwingTurn, s.shY);
  if (s.serveAnim) maxServeArm = Math.max(maxServeArm, s.shX);
  if (s.ideal) sawIdealDot = true;
  if (s.ps === 'pre_serve' && s.server === 'P') {
    await page.keyboard.press('Space');
    await page.waitForTimeout(520);
    await page.keyboard.press('KeyZ');
  }
  await page.waitForTimeout(60);
}
check('CPU run stride animates the legs (>0.35 rad)', maxStride > 0.35,
  `${maxStride.toFixed(2)} rad`);
check('CPU swing turns the hitting arm/body (>0.8 rad)', maxSwingTurn > 0.8,
  `${maxSwingTurn.toFixed(2)} rad`);
check('trail highlights a waist-height ideal hit point (orange dot)', sawIdealDot);

// --- serve aim: D-pad at the hit instant steers the serve ---
// Collect serve landing-x with left vs right held, on the same court side.
async function waitFor(cond, timeout = 12000) {
  for (let t = 0; t < timeout; t += 200) {
    if (await page.evaluate(cond)) return true;
    await page.waitForTimeout(200);
  }
  return false;
}
async function aimedServe(pickDir) {
  // a whole CPU service game may have to play out first (~25 s)
  const ok = await waitFor(() =>
    window.__game.pointState === 'pre_serve' && window.__game.match.server === 'P', 40000);
  if (!ok) return null;
  const side = await page.evaluate(() => window.__game.courtSide);
  const dirKey = pickDir(side);
  await page.keyboard.press('Space');
  await page.waitForTimeout(420);
  await page.keyboard.down(dirKey);
  await page.waitForTimeout(50);
  await page.keyboard.press('KeyZ');
  await page.waitForTimeout(80);
  const vx = await page.evaluate(() => window.__game.ball.state.vel.x);
  await page.keyboard.up(dirKey);
  // let the point play out
  await page.waitForTimeout(2500);
  await page.keyboard.press('KeyX');
  await page.waitForTimeout(2500);
  return { side, dir: dirKey, vx };
}
// vx must be compared within the same court side: the service box (and so
// the no-aim direction) flips between deuce and ad. Pick the direction that
// is still missing for the side we're about to serve from.
const samples = [];
function pickDir(side) {
  const have = (d) => samples.some((s) => s.side === side && s.dir === d);
  return have('ArrowLeft') ? 'ArrowRight' : 'ArrowLeft';
}
for (let i = 0; i < 8; i++) {
  const r = await aimedServe(pickDir);
  if (!r) break;
  samples.push(r);
  const done = ['deuce', 'ad'].some((side) =>
    samples.some((s) => s.side === side && s.dir === 'ArrowLeft') &&
    samples.some((s) => s.side === side && s.dir === 'ArrowRight'));
  if (done) break;
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
let aimOk = false, aimDetail = 'no side with both directions sampled';
for (const side of ['deuce', 'ad']) {
  const l = samples.filter((s) => s.side === side && s.dir === 'ArrowLeft').map((s) => s.vx);
  const r = samples.filter((s) => s.side === side && s.dir === 'ArrowRight').map((s) => s.vx);
  if (l.length && r.length) {
    aimDetail = `${side}: left vx=${mean(l).toFixed(2)} right vx=${mean(r).toFixed(2)}`;
    if (mean(l) < mean(r) - 1.0) { aimOk = true; break; }
  }
}
check('serve direction follows the held D-pad at the hit', aimOk, aimDetail);

check('no page errors', pageErrors.length === 0, pageErrors[0]);
await browser.close();
console.log(failures === 0 ? '\nFPV checks passed.' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
