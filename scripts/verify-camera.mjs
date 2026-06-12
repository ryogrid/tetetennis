// Verify camera is behind the player (third-person view)
// Requires dev server: npm run dev
import { chromium } from 'playwright';

const URL = process.env.GAME_URL || 'http://localhost:5173/';
let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failures++;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(URL);
await page.waitForTimeout(800);

async function press(key) {
  await page.keyboard.press(key);
  await page.waitForTimeout(60);
}

// Navigate menu: pick Ace (idx 0), Ace opponent (idx 0), hard court
await press('Enter'); // player = ace (default)
await press('Enter'); // opponent = ace (default)
await press('Enter'); // surface = hard (default)
await press('Enter'); // difficulty = normal (default)
await page.waitForTimeout(500);

// --- Check 1: Player model is visible ---
const playerVisible = await page.evaluate(() => {
  return window.__game.human.root.visible === true;
});
check('player model is visible', playerVisible,
  `root.visible = ${playerVisible}`);

// --- Check 2: Camera is behind the player (Z offset ~2.5m) ---
const camInfo = await page.evaluate(() => {
  const cam = window.__cam;
  const player = window.__game.human;
  return {
    camZ: cam.position.z,
    playerZ: player.pos.z,
    camY: cam.position.y,
    diffZ: cam.position.z - player.pos.z,
  };
});
console.log('  camera vs player:', JSON.stringify(camInfo));
check('camera is behind player (camZ > playerZ)',
  camInfo.camZ > camInfo.playerZ,
  `camZ=${camInfo.camZ.toFixed(2)} playerZ=${camInfo.playerZ.toFixed(2)} diff=${camInfo.diffZ.toFixed(2)}`);
check('camera Z offset ~2.5m behind player',
  Math.abs(camInfo.diffZ - 2.5) < 0.2,
  `diffZ=${camInfo.diffZ.toFixed(2)}`);

// --- Check 3: Camera height stays at eye level ---
check('camera height = eye level (1.62)',
  Math.abs(camInfo.camY - 1.62) < 0.1,
  `camY=${camInfo.camY.toFixed(2)}`);

// Screenshot: pre-serve, should see player from behind
await page.screenshot({ path: 'scripts/shots/verify-01-pre-serve.png' });
console.log('  screenshot: scripts/shots/verify-01-pre-serve.png');

// --- Check 4: Serve — camera looks toward service box ---
// Toss and hit a serve
await page.keyboard.press('Space'); // toss
await page.waitForTimeout(520);
await page.keyboard.press('KeyZ');  // flat serve
await page.waitForTimeout(800);

const serveCamDir = await page.evaluate(() => {
  const cam = window.__cam;
  // Get camera look direction (forward vector)
  const m = cam.matrixWorld;
  // In Three.js, camera looks down -Z in local space
  const forward = { x: -m.elements[8], y: -m.elements[9], z: -m.elements[10] };
  return forward;
});
console.log('  serve camera forward:', JSON.stringify(serveCamDir));
// Camera should be looking toward negative Z (toward opponent court)
check('serve: camera looks toward opponent (-Z)',
  serveCamDir.z < -0.5,
  `forward.z=${serveCamDir.z.toFixed(3)}`);

await page.screenshot({ path: 'scripts/shots/verify-02-serve.png' });

// --- Check 5: Rally — camera tracks the ball ---
// Play a few rally strokes
for (let t = 0; t < 40; t++) {
  const st = await page.evaluate(() => ({
    ps: window.__game.pointState,
    ballZ: window.__game.ball?.state.pos.z ?? 0,
    ballActive: window.__game.ball?.state.active ?? false,
  }));
  if (st.ps === 'point_over' || st.ps === 'pre_serve') break;
  if (st.ps === 'rally' && st.ballActive && st.ballZ > 7) {
    await page.keyboard.press('KeyX');
  }
  await page.waitForTimeout(250);
}
await page.waitForTimeout(500);
await page.screenshot({ path: 'scripts/shots/verify-03-rally.png' });
console.log('  screenshot: scripts/shots/verify-02-serve.png');
console.log('  screenshot: scripts/shots/verify-03-rally.png');

// --- Check 6: Movement — camera follows player at fixed offset ---
// Move left and check camera follows
await page.evaluate(() => {
  // Force to rally state if possible
});
const beforeMove = await page.evaluate(() => ({
  px: window.__game.human.pos.x,
  cx: window.__cam.position.x,
  diffX: window.__cam.position.x - window.__game.human.pos.x,
}));
await page.keyboard.down('ArrowLeft');
await page.waitForTimeout(600);
await page.keyboard.up('ArrowLeft');
await page.waitForTimeout(200);
const afterMove = await page.evaluate(() => ({
  px: window.__game.human.pos.x,
  cx: window.__cam.position.x,
  diffX: window.__cam.position.x - window.__game.human.pos.x,
}));
console.log('  before move:', JSON.stringify(beforeMove));
console.log('  after move:', JSON.stringify(afterMove));
check('camera follows player in X (diff stays near 0)',
  Math.abs(afterMove.diffX) < 0.2,
  `diffX before=${beforeMove.diffX.toFixed(2)} after=${afterMove.diffX.toFixed(2)}`);

// --- Final checks ---
check('no page errors', pageErrors.length === 0, pageErrors[0]);

await browser.close();

console.log(failures === 0 ? '\nCamera verification PASSED.' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
