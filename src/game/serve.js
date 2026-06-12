// Serve model: types, targets, fault detection.
import { STATS_MAP, RPM_TO_RADS, COURT, LINE_GRACE, SURFACES } from '../physics/constants.js';
import { solveShot } from '../physics/shotSolver.js';
import { predictLanding } from '../physics/ball.js';
import { gauss } from './shots.js';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// Serve target presets within the receiving box. courtSide 'deuce'|'ad',
// servingSide 'P'|'C'. Box x-sign is opposite the server's stance x.
export function serveBox(servingSide, courtSide) {
  const zSign = servingSide === 'P' ? -1 : 1; // receiver side
  // P deuce -> box x in [-W, 0]; P ad -> [0, W]; C mirrored.
  const deuceXSign = servingSide === 'P' ? -1 : 1;
  const xSign = courtSide === 'deuce' ? deuceXSign : -deuceXSign;
  return {
    xMin: Math.min(0, xSign * COURT.halfWidth),
    xMax: Math.max(0, xSign * COURT.halfWidth),
    zMin: Math.min(0, zSign * COURT.serviceLine),
    zMax: Math.max(0, zSign * COURT.serviceLine),
    xSign, zSign,
  };
}

export function isServeBoxIn(pos, servingSide, courtSide) {
  const b = serveBox(servingSide, courtSide);
  return pos.x >= b.xMin - LINE_GRACE && pos.x <= b.xMax + LINE_GRACE &&
         pos.z >= b.zMin - LINE_GRACE && pos.z <= b.zMax + LINE_GRACE;
}

// Stance x for the server (small offset from center mark, correct half).
export function serveStanceX(servingSide, courtSide) {
  const deuceXSign = servingSide === 'P' ? 1 : -1; // server's own right
  return (courtSide === 'deuce' ? deuceXSign : -deuceXSign) * 0.35;
}

export const SERVE_TYPES = {
  flat:  { speedMul: 1.00, thetaMin: -6, thetaMax: 4 },
  kick:  { speedMul: 0.70, thetaMin: 0,  thetaMax: 10 },
  slice: { speedMul: 0.84, thetaMin: -4, thetaMax: 6 },
};

// targetPreset: 'wide' | 'body' | 'T'.
// aimAdjust -1..1 lateral aim in WORLD x (press left -> lands further left),
// spanning the box from T to wide around the preset.
// aimDepth -1..1 (+1 deep near the service line, -1 short).
// qServe in [0.4, 1] from toss timing. Returns {vel, spin}.
export function computeServe({ stats, type, from, servingSide, courtSide,
                               targetPreset, aimAdjust = 0, aimDepth = 0, qServe }) {
  const box = serveBox(servingSide, courtSide);
  const def = SERVE_TYPES[type];

  // target points 0.5m inside box lines
  const xInner = box.xSign > 0 ? 0.45 : -0.45;          // near center line (T)
  const xOuter = box.xSign * (COURT.halfWidth - 0.55);  // near sideline (wide)
  const depth = clamp(aimDepth, -1, 1);
  const zInset = depth >= 0 ? 0.55 - 0.25 * depth : 0.55 - 1.05 * depth;
  const zDeep = box.zSign * (COURT.serviceLine - zInset);
  let tx;
  if (targetPreset === 'T') tx = xInner;
  else if (targetPreset === 'wide') tx = xOuter;
  else tx = (xInner + xOuter) / 2;
  tx += clamp(aimAdjust, -1, 1) * 1.6;
  tx = clamp(tx, Math.min(xInner, xOuter), Math.max(xInner, xOuter));

  const target = { x: tx, z: zDeep };

  let speed = STATS_MAP.serveFlatSpeed(stats.SRV) * (0.68 + 0.32 * qServe) * def.speedMul;

  // spin: rpm and axis split between lateral (top/back) and vertical (side)
  let spinRpm = 0, ySpinFrac = 0;
  if (type === 'flat') {
    spinRpm = 400; ySpinFrac = 0;
  } else if (type === 'kick') {
    spinRpm = 2600 + 1400 * stats.SPN / 100; ySpinFrac = 0.4; // topspin + side
  } else { // slice serve
    spinRpm = -(1800 + 900 * stats.SRV / 100); ySpinFrac = 0.7; // mostly side
  }

  // error model (same shape as strokes)
  const errMul = STATS_MAP.errMulBase(stats.CTL) * (1 + 2.2 * (1 - qServe));
  target.x += gauss() * 0.30 * errMul;
  target.z += box.zSign * gauss() * 0.35 * errMul;
  speed *= 1 + gauss() * 0.025 * errMul;

  const wTotal = Math.abs(spinRpm) * RPM_TO_RADS;
  const lateral = spinRpm * RPM_TO_RADS * (1 - ySpinFrac);
  // side spin curves the ball; sign chosen so slice curves toward the wide side
  const ySpin = wTotal * ySpinFrac * (box.xSign > 0 ? -1 : 1);

  const solveArgs = {
    from,
    target: { ...target },
    speed,
    spinRadS: lateral,
    ySpinRadS: ySpin,
    thetaMinDeg: def.thetaMin,
    thetaMaxDeg: def.thetaMax,
  };
  let solved = solveShot(solveArgs);

  // Side spin curves the ball laterally, which the 2D solver cannot see.
  // One correction pass: simulate the real 3D landing, shift the aim by the
  // observed drift, and re-solve. (Surface choice is irrelevant: we only
  // need the first contact point.)
  if (ySpinFrac > 0) {
    const landing = predictLanding(
      { pos: { ...from }, vel: solved.vel, spin: { ...solved.spin }, active: true },
      SURFACES.hard,
    );
    if (landing) {
      solveArgs.target.x = target.x - clamp(landing.pos.x - target.x, -2.5, 2.5);
      const zCorr = clamp(landing.pos.z - target.z, -2.5, 2.5);
      const newZ = target.z - zCorr;
      if (Math.sign(newZ) === Math.sign(target.z)) solveArgs.target.z = newZ;
      solved = solveShot(solveArgs);
    }
  }
  return { vel: solved.vel, spin: solved.spin };
}
