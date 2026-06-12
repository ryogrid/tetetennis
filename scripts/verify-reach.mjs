// Verify reach zone arcs are visible around the human player
import { chromium } from 'playwright';

const URL = process.env.GAME_URL || 'http://localhost:5174/';
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

// Navigate: Ace, Ace, hard, normal
await press('Enter'); await press('Enter'); await press('Enter'); await press('Enter');
await page.waitForTimeout(500);

// Check reach arcs exist on human player
const arcInfo = await page.evaluate(() => {
  const human = window.__game.human;
  const reach = human.reach;
  const arcs = human._reachArcs;
  return {
    isHuman: human.isHuman,
    reach,
    hasArcs: !!arcs,
    arcCount: arcs ? arcs.length : 0,
    rightVisible: arcs ? arcs[0].visible : false,
    leftVisible: arcs ? arcs[1].visible : false,
    arcRadius: arcs ? arcs[0].geometry.parameters.outerRadius : 0,
    arcColor: arcs ? '#' + arcs[0].material.color.getHexString() : 'none',
    rootVisible: human.root.visible,
  };
});
console.log('  arc info:', JSON.stringify(arcInfo, null, 2));

check('player is human', arcInfo.isHuman);
check('reach arcs exist', arcInfo.hasArcs, `count: ${arcInfo.arcCount}`);
check('right arc visible', arcInfo.rightVisible);
check('left arc visible', arcInfo.leftVisible);
check('arc radius matches player reach', Math.abs(arcInfo.arcRadius - arcInfo.reach) < 0.04,
  `radius=${arcInfo.arcRadius.toFixed(2)} reach=${arcInfo.reach.toFixed(2)}`);
check('arc color is green', arcInfo.arcColor === '#50e678', arcInfo.arcColor);
check('player root visible', arcInfo.rootVisible);

// Check CPU player does NOT have reach arcs
const cpuInfo = await page.evaluate(() => {
  const cpu = window.__game.cpu;
  return {
    isHuman: cpu.isHuman,
    hasArcs: !!cpu._reachArcs,
  };
});
console.log('  cpu info:', JSON.stringify(cpuInfo));
check('CPU has no reach arcs', !cpuInfo.hasArcs);

// Screenshot
await page.screenshot({ path: 'scripts/shots/verify-reach-01.png' });
console.log('  screenshot: scripts/shots/verify-reach-01.png');

// Move player and verify arcs follow
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(400);
await page.keyboard.up('ArrowRight');
await page.waitForTimeout(100);

// Arcs are children of root — they inherit root.position automatically.
// Verify the root position tracks the player.
const afterMove = await page.evaluate(() => {
  const h = window.__game.human;
  return {
    px: h.pos.x,
    rootX: h.root.position.x,
    match: Math.abs(h.root.position.x - h.pos.x) < 0.01,
  };
});
console.log('  after move:', JSON.stringify(afterMove));
check('arcs follow player (root tracks pos)', afterMove.match,
  `pos.x=${afterMove.px.toFixed(2)} root.x=${afterMove.rootX.toFixed(2)}`);

check('no page errors', pageErrors.length === 0, pageErrors[0]);

await browser.close();

console.log(failures === 0 ? '\nReach arcs verification PASSED.' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
