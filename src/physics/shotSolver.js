// Target-based shot solver: given a launch point, a landing target, a launch
// speed and a spin rate, bisect on the elevation angle using a 2D
// drag+Magnus simulation in the vertical plane of the shot.
import { G, AERO, BALL } from './constants.js';

const SIM_DT = 1 / 120;
const SIM_MAX_T = 4.0;

// 2D sim in the shot's vertical plane. spinRadS > 0 = topspin (dips).
// Returns horizontal distance at which the ball reaches y = BALL.r descending.
function simulateRange2D(y0, v0, theta, spinRadS) {
  let s = 0, y = y0;
  let vs = v0 * Math.cos(theta), vy = v0 * Math.sin(theta);
  let w = Math.abs(spinRadS);
  const sgn = Math.sign(spinRadS) || 0;
  const decay = Math.exp(-SIM_DT / AERO.spinDecayTau);
  for (let t = 0; t < SIM_MAX_T; t += SIM_DT) {
    const speed = Math.hypot(vs, vy);
    let as = 0, ay = -G;
    if (speed > 1e-6) {
      const drag = AERO.kAero * AERO.cd * speed;
      as -= drag * vs; ay -= drag * vy;
      if (w > 1) {
        const S = BALL.r * w / speed;
        const cl = Math.min(1 / (2 + 1 / S), AERO.clMax);
        const m = AERO.kAero * cl * speed;
        // topspin (sgn=+1): accel = m*(vy, -vs) -> dips when moving forward
        as += m * sgn * vy;
        ay += m * sgn * -vs;
      }
    }
    vs += as * SIM_DT; vy += ay * SIM_DT;
    const prevY = y;
    s += vs * SIM_DT; y += vy * SIM_DT;
    w *= decay;
    if (y <= BALL.r && vy < 0) {
      // interpolate within the step
      const f = (prevY - BALL.r) / (prevY - y);
      return s - vs * SIM_DT * (1 - f);
    }
  }
  return s;
}

const DEG = Math.PI / 180;

// Solve a shot. from {x,y,z}, target {x,z} (landing point), speed m/s,
// spinRadS signed (+ topspin), ySpinRadS extra vertical-axis spin (curve),
// theta band in degrees. Returns {vel:{x,y,z}, spin:{x,y,z}, theta, speed}.
export function solveShot({ from, target, speed, spinRadS = 0, ySpinRadS = 0,
                            thetaMinDeg, thetaMaxDeg }) {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const D = Math.hypot(dx, dz);
  const dirX = dx / D, dirZ = dz / D;

  let v0 = speed;
  let lo = thetaMinDeg * DEG, hi = thetaMaxDeg * DEG;
  let theta;

  // Bracket: grow/shrink speed if the band can't reach / overshoots.
  for (let tries = 0; tries < 3; tries++) {
    const rMax = simulateRange2D(from.y, v0, hi, spinRadS);
    const rMin = simulateRange2D(from.y, v0, lo, spinRadS);
    if (rMax < D) { v0 *= 1.12; continue; }       // can't reach: hit harder
    if (rMin > D) { v0 *= 0.88; continue; }       // too hot even at min angle
    break;
  }

  // Bisection (range is monotonic in theta within the bands used).
  // 11 iterations: angle precision far below the shot error model's noise.
  for (let i = 0; i < 11; i++) {
    theta = (lo + hi) / 2;
    const r = simulateRange2D(from.y, v0, theta, spinRadS);
    if (r < D) lo = theta; else hi = theta;
  }
  theta = (lo + hi) / 2;

  const vH = v0 * Math.cos(theta);
  const vel = {
    x: dirX * vH,
    y: v0 * Math.sin(theta),
    z: dirZ * vH,
  };
  // Spin axis: horizontal, perpendicular to aim. With dir=(0,0,-1) and
  // topspin (+), axis must be (-1,0,0): c = (dirZ, 0, -dirX).
  const spin = {
    x: dirZ * spinRadS,
    y: ySpinRadS,
    z: -dirX * spinRadS,
  };
  return { vel, spin, theta, speed: v0 };
}
