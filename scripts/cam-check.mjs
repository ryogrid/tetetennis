import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://localhost:5199/');
await page.waitForTimeout(800);
async function press(k){ await page.keyboard.press(k); await page.waitForTimeout(60); }
await press('Enter'); await press('Enter'); await press('Enter'); // char, opp, hard surface
await press('Enter'); // difficulty (normal)
await press('ArrowLeft'); await press('Enter'); // assist Off -> start match
await page.waitForTimeout(1500); // let camera settle
const cam = await page.evaluate(() => {
  const g = window.__game;
  return { ps: g.pointState, server: g.match.server };
});
console.log('pre-serve state:', JSON.stringify(cam));
await page.screenshot({ path: 'scripts/shots/05-servecam.png' });
// serve and catch ball mid-flight
await page.keyboard.press('Space');
await page.waitForTimeout(500);
await page.keyboard.press('KeyX'); // kick serve
await page.waitForTimeout(450);
const mid = await page.evaluate(() => {
  const g = window.__game;
  const b = g.ball.state;
  return { ps: g.pointState, active: b.active, pos: { x: +b.pos.x.toFixed(2), y: +b.pos.y.toFixed(2), z: +b.pos.z.toFixed(2) } };
});
console.log('mid-flight:', JSON.stringify(mid));
await page.screenshot({ path: 'scripts/shots/06-serveflight.png' });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'scripts/shots/07-return.png' });
console.log('errors:', errs.length ? errs : 'none');
await browser.close();
