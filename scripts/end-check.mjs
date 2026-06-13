import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://localhost:5199/');
await page.waitForTimeout(800);
async function press(k){ await page.keyboard.press(k); await page.waitForTimeout(60); }
await press('Enter'); await press('Enter'); await press('Enter'); // char, opp, surface
await press('Enter'); // difficulty (normal)
await press('ArrowLeft'); await press('Enter'); // assist Off -> start match
await page.waitForTimeout(300);
// put CPU one point from the set, then serve and let CPU win the point
await page.evaluate(() => {
  const m = window.__game.match;
  m.games.C = 5; m.games.P = 0; m.points.C = 3; m.points.P = 0;
});
for (let i = 0; i < 8; i++) {
  const st = await page.evaluate(() => ({ state: window.__game.state, ps: window.__game.pointState }));
  if (st.state === 'results') break;
  if (st.state === 'match' && st.ps === 'pre_serve') {
    const server = await page.evaluate(() => window.__game.match.server);
    if (server === 'P') {
      await page.keyboard.press('Space');
      await page.waitForTimeout(520);
      await page.keyboard.press('KeyZ');
    }
  }
  await page.waitForTimeout(2500);
}
const fin = await page.evaluate(() => window.__game.state);
console.log('final state:', fin, '| errors:', errs.length ? errs : 'none');
await page.screenshot({ path: 'scripts/shots/08-results.png' });
// back to menu
await press('Enter');
const menu = await page.textContent('.title').catch(() => null);
console.log('after Enter:', menu);
await browser.close();
process.exit(fin === 'results' && menu === 'SELECT YOUR PLAYER' && errs.length === 0 ? 0 : 1);
