// Generate the PWA icons (no image assets in the repo — everything is drawn).
// Renders a tennis-ball-on-court mark on a canvas and writes PNGs to public/.
//   node scripts/gen-icons.mjs
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('public', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();

// `inset` is the fraction of the canvas kept clear around the ball: maskable
// icons get a larger safe-zone so platform masks never clip the mark.
async function render(size, inset) {
  return page.evaluate(({ size, inset }) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');

    // court-dark background with a subtle blue wash, full-bleed for maskable
    const bg = x.createLinearGradient(0, 0, 0, size);
    bg.addColorStop(0, '#141a2b');
    bg.addColorStop(1, '#0b0c12');
    x.fillStyle = bg;
    x.fillRect(0, 0, size, size);

    // faint court baseline marks for character
    x.strokeStyle = 'rgba(120,150,200,0.18)';
    x.lineWidth = Math.max(1, size * 0.012);
    x.beginPath();
    x.moveTo(size * 0.12, size * 0.8);
    x.lineTo(size * 0.88, size * 0.8);
    x.moveTo(size * 0.5, size * 0.8);
    x.lineTo(size * 0.5, size * 0.92);
    x.stroke();

    // tennis ball
    const cx = size / 2, cy = size * 0.46;
    const r = (size / 2) * (1 - inset);
    const grd = x.createRadialGradient(
      cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    grd.addColorStop(0, '#e9ff63');
    grd.addColorStop(1, '#b6d324');
    x.fillStyle = grd;
    x.beginPath();
    x.arc(cx, cy, r, 0, Math.PI * 2);
    x.fill();

    // curved seam arcs (white)
    x.strokeStyle = '#fbfff0';
    x.lineWidth = Math.max(2, r * 0.1);
    x.lineCap = 'round';
    x.beginPath();
    x.arc(cx - r * 1.15, cy, r * 1.55, -0.62, 0.62);
    x.stroke();
    x.beginPath();
    x.arc(cx + r * 1.15, cy, r * 1.55, Math.PI - 0.62, Math.PI + 0.62);
    x.stroke();

    return c.toDataURL('image/png');
  }, { size, inset });
}

const targets = [
  { name: 'icon-192.png', size: 192, inset: 0.14 },
  { name: 'icon-512.png', size: 512, inset: 0.14 },
  { name: 'icon-maskable-512.png', size: 512, inset: 0.26 }, // safe zone
  { name: 'apple-touch-icon.png', size: 180, inset: 0.1 },   // iOS, opaque
];

for (const t of targets) {
  const dataUrl = await render(t.size, t.inset);
  const b64 = dataUrl.split(',')[1];
  writeFileSync(`public/${t.name}`, Buffer.from(b64, 'base64'));
  console.log(`wrote public/${t.name} (${t.size}x${t.size})`);
}

await browser.close();
