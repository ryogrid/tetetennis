// Stroke model: shot type table, contact quality, error model.
// Where character stats meet physics.
import { STATS_MAP, RPM_TO_RADS, COURT, IDEAL_CONTACT_H, IDEAL_CONTACT_R } from '../physics/constants.js';
import { solveShot } from '../physics/shotSolver.js';

// Three distinct physical regimes: flat = fast low liner, topspin = slower
// but heavily arced (high clearance, dips, kicks off the bounce), slice =
// clearly slow floater that stays low and checks.
export const SHOT_TYPES = {
  flat:    { speedMul: 1.00, thetaMin: 0,  thetaMax: 10 },
  topspin: { speedMul: 0.85, thetaMin: 10, thetaMax: 32 },
  slice:   { speedMul: 0.68, thetaMin: 1,  thetaMax: 10 },
  lob:     { speedMul: 1.00, thetaMin: 28, thetaMax: 55 },
};

let _spare = null;
export function gauss() {
  if (_spare !== null) { const v = _spare; _spare = null; return v; }
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const m = Math.sqrt(-2 * Math.log(u));
  _spare = m * Math.sin(2 * Math.PI * v);
  return Math.max(-2.5, Math.min(2.5, m * Math.cos(2 * Math.PI * v)));
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// Contact quality q in [0,1] from player/ball geometry at the contact instant.
// The ideal stroke contact is the ball at WAIST height, an arm-plus-racket
// length from the body — radial, so forehand and backhand are equivalent.
// Returns {q, whiff, d, stretched}.
export function contactQuality({ playerPos, ballPos, ballVel, stats }) {
  const d = Math.hypot(ballPos.x - playerPos.x, ballPos.z - playerPos.z);
  const h = ballPos.y;
  const reach = STATS_MAP.reach(stats.REA);
  // vertical ceiling: shoulder + arm + racket (scales with the reach stat)
  const hMax = 1.15 + reach;
  if (d > reach || h > hMax) return { q: 0, whiff: true, d, stretched: true };

  // radial: best in a band around IDEAL_CONTACT_R; jammed near the body,
  // stretched toward the limit of the reach
  const lo = IDEAL_CONTACT_R - 0.35, hi = IDEAL_CONTACT_R + 0.25;
  let qDist;
  if (d < lo) qDist = 0.55 + 0.45 * (d / lo); // cramped against the body
  else if (d <= hi) qDist = 1;
  else qDist = clamp(1 - (d - hi) / (reach - hi), 0, 1);
  // best at waist height, degrading toward the shoelaces / over the shoulder
  const qHeight = 1 - clamp((Math.abs(h - IDEAL_CONTACT_H) - 0.3) / 0.9, 0, 0.55);
  const vIn = Math.hypot(ballVel.x, ballVel.y, ballVel.z);
  const qSpeed = clamp(1 - (vIn - 18) / 55, 0.65, 1);
  const q = qDist * qHeight * qSpeed;
  return { q, whiff: false, d, stretched: d > hi && qDist < 0.35 };
}

// Compute a stroke. side: 'P' hits toward -z, 'C' toward +z.
// aim: {x: -1..1, depth: -1..1} (depth +1 deep, -1 short).
// Returns {vel, spin, q, mishit, type} or null on whiff.
export function computeStroke({ playerPos, ballPos, ballVel, stats, shotType, aim, side }) {
  const cq = contactQuality({ playerPos, ballPos, ballVel, stats });
  if (cq.whiff) return null;
  const { q, stretched } = cq;

  let type = shotType;
  if (stretched && type !== 'slice') type = 'lob'; // forced defensive ball

  const zSign = side === 'P' ? -1 : 1;
  const def = SHOT_TYPES[type];

  // --- nominal target: poor contacts land shorter, not just wilder ---
  // per-type depth consistent with the type's natural speed (the solver must
  // not have to inflate a slow slice to reach a flat-drive depth)
  const typeZ = type === 'flat' ? 10.6 : type === 'topspin' ? 9.8
    : type === 'slice' ? 9.0 : 9.0;
  const baseZ = typeZ - (1 - q) * 1.5;
  const target = {
    x: clamp(aim.x, -1, 1) * 2.8,
    z: zSign * clamp(baseZ + clamp(aim.depth, -1, 1) * 2.4, 4.5, 11.2),
  };

  // --- speed & spin from stats and quality ---
  const flatSpeed = STATS_MAP.maxFlatSpeed(stats.POW) * (0.52 + 0.48 * q);
  let speed, spinRpm;
  if (type === 'flat') {
    speed = flatSpeed;
    spinRpm = 300 + 400 * q;
  } else if (type === 'topspin') {
    speed = flatSpeed * def.speedMul;
    spinRpm = STATS_MAP.topspinRpm(stats.SPN) * (0.5 + 0.5 * q);
  } else if (type === 'slice') {
    speed = flatSpeed * def.speedMul;
    spinRpm = -STATS_MAP.sliceRpm(stats.SLC) * (0.5 + 0.5 * q);
  } else { // lob
    speed = 15 + 4 * stats.POW / 100;
    spinRpm = 500;
  }

  // --- error model ---
  const errMul = STATS_MAP.errMulBase(stats.CTL) * (1 + 2.2 * (1 - q));
  target.x += gauss() * 0.30 * errMul;
  target.z += zSign * gauss() * 0.55 * errMul;
  // keep the target on the opponent half so the solver geometry stays sane
  target.z = zSign * clamp(Math.abs(target.z), 2.0, COURT.halfLen + 2.5);
  spinRpm *= 1 + gauss() * 0.06 * errMul;
  speed *= 1 + gauss() * 0.03 * errMul;

  let mishit = false;
  let yawErr = 0;
  if (q < 0.3 && Math.random() < 0.35) {
    mishit = true;
    yawErr = (Math.random() - 0.5) * 0.5;
    speed *= 0.55;
    spinRpm *= 0.3;
  }

  // slice drifts: a touch of vertical-axis spin (sign by court side of contact)
  const ySpin = type === 'slice'
    ? Math.abs(spinRpm) * 0.27 * RPM_TO_RADS * (ballPos.x >= playerPos.x ? 1 : -1)
    : 0;

  const solved = solveShot({
    from: { x: ballPos.x, y: Math.max(ballPos.y, 0.15), z: ballPos.z },
    target,
    speed,
    spinRadS: spinRpm * RPM_TO_RADS,
    ySpinRadS: ySpin,
    thetaMinDeg: def.thetaMin,
    thetaMaxDeg: def.thetaMax,
  });

  if (yawErr !== 0) {
    const c = Math.cos(yawErr), s = Math.sin(yawErr);
    const vx = solved.vel.x * c - solved.vel.z * s;
    const vz = solved.vel.x * s + solved.vel.z * c;
    solved.vel.x = vx; solved.vel.z = vz;
  }

  return { vel: solved.vel, spin: solved.spin, q, mishit, type };
}
