// PWA smoke test against the PRODUCTION build served at the GitHub Pages
// base path. Verifies the manifest, the service worker reaching "activated",
// and that a fully offline reload still loads the app (offline play).
//   npm run build -- --base=/tetetennis/
//   vite preview --base=/tetetennis/ --port 4180 &
//   node scripts/pwa-check.mjs
import { chromium } from 'playwright';

const BASE = process.env.PWA_BASE || 'http://localhost:4180/tetetennis/';
let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failures++;
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(BASE, { waitUntil: 'load' });

// --- manifest is linked, fetchable, and well-formed ---
const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
check('manifest is linked', manifestHref === 'manifest.webmanifest', manifestHref);
const manifestUrl = new URL(manifestHref, page.url()).href;
const manifest = await page.evaluate(async (u) => {
  const r = await fetch(u);
  return r.ok ? r.json() : null;
}, manifestUrl);
check('manifest fetches and parses', !!manifest);
if (manifest) {
  check('manifest resolves under the base path',
    manifestUrl.endsWith('/tetetennis/manifest.webmanifest'), manifestUrl);
  check('manifest has name + start_url + display', !!manifest.name &&
    !!manifest.start_url && !!manifest.display,
    `${manifest.name} / ${manifest.start_url} / ${manifest.display}`);
  check('manifest declares a maskable icon',
    manifest.icons.some((i) => (i.purpose || '').includes('maskable')));
  // every icon must actually be reachable at the base path
  const iconStatuses = await page.evaluate(async (icons) => {
    const out = [];
    for (const i of icons) out.push((await fetch(i.src)).status);
    return out;
  }, manifest.icons.map((i) => ({ src: new URL(i.src, manifestUrl).href })));
  check('all manifest icons load (200)', iconStatuses.every((s) => s === 200),
    iconStatuses.join(','));
}

// --- service worker registers and activates ---
const swState = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  const sw = reg.active;
  return { scope: reg.scope, state: sw && sw.state };
});
check('service worker is activated', swState.state === 'activated', swState.state);
check('service worker scope is the base path',
  swState.scope.endsWith('/tetetennis/'), swState.scope);

// Give the SW a moment to cache the assets it just served, then prime the
// app shell + entry chunk by visiting once more online.
await page.waitForTimeout(500);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

// --- the real test: go fully offline and reload ---
await context.setOffline(true);
let offlineOk = true, offlineDetail = '';
try {
  await page.reload({ waitUntil: 'load' });
  const ready = await page.evaluate(() =>
    !!document.getElementById('app') &&
    !!document.querySelector('#app canvas'));
  offlineOk = ready;
  offlineDetail = ready ? 'app + canvas rendered offline' : 'app shell missing';
} catch (err) {
  offlineOk = false;
  offlineDetail = String(err).split('\n')[0];
}
check('app reloads and renders while fully offline', offlineOk, offlineDetail);
await context.setOffline(false);

check('no page errors', pageErrors.length === 0, pageErrors[0]);

await browser.close();
console.log(failures === 0 ? '\nPWA checks passed.' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
