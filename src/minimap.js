// 2D top-down court minimap: shows ball and player positions on a plan view
// of the singles court. Visible only in the default behind-player camera mode
// (not the overhead/bird's-eye view), so the player can see where their shots
// are landing.

const COURT_HALF_LEN = 11.885;   // half-length (m) — net is at z=0
const COURT_HALF_WIDTH = 4.115;  // half-width (m) — singles
const SERVICE_LINE = 6.40;       // distance from net to service line (m)

const W = 140;   // canvas pixel width
const H = 378;   // canvas pixel height (W adjusted to court aspect)
const PAD = 8;   // padding inside the canvas

const DRAW_W = W - 2 * PAD;
const DRAW_H = H - 2 * PAD;
const SX = DRAW_W / (2 * COURT_HALF_WIDTH);   // pixels per meter (x)
const SZ = DRAW_H / (2 * COURT_HALF_LEN);      // pixels per meter (z)

// Map court (x, z) → canvas pixel (x, y).  Top of canvas = far court (−z).
function cx(cx) { return PAD + (cx + COURT_HALF_WIDTH) * SX; }
function cy(cz) { return PAD + (COURT_HALF_LEN + cz) * SZ; }

export function createMinimap() {
  const canvas = document.createElement('canvas');
  canvas.id = 'minimap';
  canvas.width = W;
  canvas.height = H;
  Object.assign(canvas.style, {
    position: 'fixed',
    top: '108px',     // below the tc-bar's second row (top-right buttons)
    right: '12px',
    zIndex: '10',
    borderRadius: '6px',
    opacity: '0.80',
    display: 'none',
  });
  document.getElementById('hud').appendChild(canvas);
  const ctx = canvas.getContext('2d');

  // ---- helpers ----

  function fillCourt(color) {
    ctx.fillStyle = color;
    ctx.fillRect(cx(-COURT_HALF_WIDTH), cy(-COURT_HALF_LEN), DRAW_W, DRAW_H);
  }

  function strokeLine(x1, z1, x2, z2, color, width, dash) {
    ctx.save();
    if (dash) ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 1;
    ctx.beginPath();
    ctx.moveTo(cx(x1), cy(z1));
    ctx.lineTo(cx(x2), cy(z2));
    ctx.stroke();
    ctx.restore();
  }

  function dot(courtX, courtZ, color, radius) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx(courtX), cy(courtZ), radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCourt() {
    // background
    ctx.fillStyle = '#0d1a0d';
    ctx.fillRect(0, 0, W, H);

    // court surface
    fillCourt('#1e3d1e');

    // court boundary
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx(-COURT_HALF_WIDTH), cy(-COURT_HALF_LEN), DRAW_W, DRAW_H);

    // net
    strokeLine(-COURT_HALF_WIDTH, 0, COURT_HALF_WIDTH, 0, 'rgba(255,255,255,0.4)', 1, [3, 4]);

    // service lines
    const slColor = 'rgba(255,255,255,0.28)';
    strokeLine(-COURT_HALF_WIDTH, SERVICE_LINE, COURT_HALF_WIDTH, SERVICE_LINE, slColor);
    strokeLine(-COURT_HALF_WIDTH, -SERVICE_LINE, COURT_HALF_WIDTH, -SERVICE_LINE, slColor);
    // centre service line
    strokeLine(0, 0, 0, SERVICE_LINE, slColor);
    strokeLine(0, 0, 0, -SERVICE_LINE, slColor);

    // near-side / far-side labels
    ctx.font = '9px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.textAlign = 'center';
    ctx.fillText('YOU', cx(0), cy(COURT_HALF_LEN) - 2);
    ctx.fillText('OPP', cx(0), cy(-COURT_HALF_LEN) + 11);
  }

  // ---- public API ----

  function update(ball, p0, p1, show) {
    canvas.style.display = show ? 'block' : 'none';
    if (!show) return;

    ctx.clearRect(0, 0, W, H);
    drawCourt();

    // Both players in light blue (水色); the YOU/OPP labels + court halves keep
    // them distinguishable, and the user's dot is drawn slightly larger.
    const AQUA = '#5fd3ff';
    if (p1 && p1.pos) {
      dot(p1.pos.x, p1.pos.z, AQUA, 3.5);
    }
    if (p0 && p0.pos) {
      dot(p0.pos.x, p0.pos.z, AQUA, 4.5);
    }

    // Ball (bright yellow — topmost, only when active)
    if (ball && ball.active) {
      dot(ball.pos.x, ball.pos.z, '#ffe040', 4.5);
    }
  }

  return { update };
}
