// Ball flight: gravity + quadratic drag + Magnus lift (Stepanek empirical CL),
// semi-implicit Euler. Also ground bounce + net collision, emitting events.
// Render-free: plain {x,y,z} objects only.
import { G, AERO, BALL, COURT, netHeight } from './constants.js';
import { applyBounce } from './bounce.js';

export function makeBall() {
  return {
    pos: { x: 0, y: 1, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    spin: { x: 0, y: 0, z: 0 },
    active: false,
  };
}

export function copyBall(src) {
  return {
    pos: { ...src.pos },
    vel: { ...src.vel },
    spin: { ...src.spin },
    active: src.active,
  };
}

// Acceleration into `out`.
export function accel(vel, spin, out) {
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  out.x = 0; out.y = -G; out.z = 0;
  if (speed < 1e-6) return out;
  const drag = AERO.kAero * AERO.cd * speed;
  out.x -= drag * vel.x;
  out.y -= drag * vel.y;
  out.z -= drag * vel.z;
  const wMag = Math.hypot(spin.x, spin.y, spin.z);
  if (wMag > 1) {
    const S = BALL.r * wMag / speed;
    const cl = Math.min(1 / (2 + 1 / S), AERO.clMax);
    const k = AERO.kAero * cl * speed / wMag; // includes 1/|w| for the unit axis
    out.x += k * (spin.y * vel.z - spin.z * vel.y);
    out.y += k * (spin.z * vel.x - spin.x * vel.z);
    out.z += k * (spin.x * vel.y - spin.y * vel.x);
  }
  return out;
}

const _a = { x: 0, y: 0, z: 0 };

// One fixed step. Pushes events ({type:'bounce',pos,speed} | {type:'net',tape})
// onto `events` (if provided). Surface = {ey, mu}.
export function stepBall(ball, dt, surface, events) {
  const prevX = ball.pos.x, prevY = ball.pos.y, prevZ = ball.pos.z;

  accel(ball.vel, ball.spin, _a);
  ball.vel.x += _a.x * dt;
  ball.vel.y += _a.y * dt;
  ball.vel.z += _a.z * dt;
  ball.pos.x += ball.vel.x * dt;
  ball.pos.y += ball.vel.y * dt;
  ball.pos.z += ball.vel.z * dt;

  const decay = Math.exp(-dt / AERO.spinDecayTau);
  ball.spin.x *= decay;
  ball.spin.y *= decay;
  ball.spin.z *= decay;

  // Net crossing (z = 0 plane)
  if ((prevZ > 0) !== (ball.pos.z > 0) && prevZ !== ball.pos.z) {
    const f = prevZ / (prevZ - ball.pos.z);
    const xc = prevX + (ball.pos.x - prevX) * f;
    const yc = prevY + (ball.pos.y - prevY) * f;
    if (Math.abs(xc) < COURT.netPostX + 0.15 && yc < netHeight(xc) + BALL.r) {
      const tape = yc > netHeight(xc) - 0.02;
      const dir = prevZ > 0 ? 1 : -1; // incoming side sign
      if (tape) {
        // net cord: ball trickles over (or drops), keeps direction, pops up
        ball.pos.x = xc; ball.pos.y = yc; ball.pos.z = -dir * 0.02;
        ball.vel.z *= 0.45;
        ball.vel.x *= 0.7;
        ball.vel.y = Math.abs(ball.vel.y) * 0.25 + 0.4;
        ball.spin.x *= 0.3; ball.spin.y *= 0.3; ball.spin.z *= 0.3;
      } else {
        // body of the net: ball rebounds back to incoming side
        ball.pos.x = xc; ball.pos.y = yc; ball.pos.z = dir * 0.03;
        ball.vel.z *= -0.22;
        ball.vel.x *= 0.55;
        ball.vel.y *= 0.35;
        ball.spin.x *= 0.2; ball.spin.y *= 0.2; ball.spin.z *= 0.2;
      }
      if (events) events.push({ type: 'net', tape });
    }
  }

  // Ground bounce
  if (ball.pos.y - BALL.r <= 0 && ball.vel.y < 0) {
    const speed = Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z);
    applyBounce(ball.vel, ball.spin, surface);
    ball.pos.y = BALL.r;
    if (events) {
      events.push({ type: 'bounce', pos: { ...ball.pos }, speed });
    }
  }

  return events;
}

// Predictions don't need the full 240 Hz: 120 Hz halves their cost and is
// still well within the error budget of aiming and AI reads.
const PREDICT_DT = 1 / 120;

// First ground contact of the ball's current trajectory (net included).
export function predictLanding(ball, surface, maxT = 5) {
  const sim = copyBall(ball);
  const ev = [];
  for (let t = 0; t < maxT; t += PREDICT_DT) {
    ev.length = 0;
    stepBall(sim, PREDICT_DT, surface, ev);
    for (const e of ev) {
      if (e.type === 'bounce') return { pos: e.pos, t, vel: { ...sim.vel } };
    }
  }
  return null;
}

// For the AI: find a comfortable strike point on `sideZSign`'s side --
// after the first bounce on that side, the first descending point at/below
// shoulder-ish height. Returns {pos, t} or null.
export function predictHitPoint(ball, surface, sideZSign, maxT = 6) {
  const sim = copyBall(ball);
  const ev = [];
  let bouncedOnSide = false;
  for (let t = 0; t < maxT; t += PREDICT_DT) {
    ev.length = 0;
    stepBall(sim, PREDICT_DT, surface, ev);
    for (const e of ev) {
      if (e.type === 'bounce' && Math.sign(e.pos.z) === sideZSign) {
        bouncedOnSide = true;
      }
    }
    if (bouncedOnSide && sim.vel.y < 0 && sim.pos.y <= 1.05 &&
        Math.sign(sim.pos.z) === sideZSign) {
      return { pos: { ...sim.pos }, t, vel: { ...sim.vel } };
    }
  }
  return null;
}

// Candidate contact points for an interceptor on `sideZSign`'s side: sampled
// every `every` seconds between the first and second bounce there, inside the
// hittable height window. Returns [{pos, t}], earliest first.
// Pass alreadyBounced=true when the ball has had its first bounce on that
// side (then sampling starts immediately and ends at the NEXT bounce).
export function sampleHitPoints(ball, surface, sideZSign, maxT = 6, every = 0.06,
                                alreadyBounced = false) {
  const sim = copyBall(ball);
  const ev = [];
  const out = [];
  let bounces = alreadyBounced ? 1 : 0;
  let nextSample = 0;
  for (let t = 0; t < maxT; t += PREDICT_DT) {
    ev.length = 0;
    stepBall(sim, PREDICT_DT, surface, ev);
    for (const e of ev) {
      if (e.type === 'bounce' && Math.sign(e.pos.z) === sideZSign) bounces++;
    }
    if (bounces >= 2) break; // double bounce: too late to play
    if (bounces === 1 && t >= nextSample &&
        Math.sign(sim.pos.z) === sideZSign &&
        sim.pos.y >= 0.3 && sim.pos.y <= 1.9) {
      out.push({ pos: { ...sim.pos }, t });
      nextSample = t + every;
    }
  }
  return out;
}

// Where/when the ball crosses the plane z = zPlane (before any 2nd bounce).
export function predictAtZ(ball, surface, zPlane, maxT = 5) {
  const sim = copyBall(ball);
  let prevZ = sim.pos.z;
  for (let t = 0; t < maxT; t += PREDICT_DT) {
    stepBall(sim, PREDICT_DT, surface, null);
    if ((prevZ - zPlane) * (sim.pos.z - zPlane) <= 0 && prevZ !== sim.pos.z) {
      return { pos: { ...sim.pos }, vel: { ...sim.vel }, t };
    }
    prevZ = sim.pos.z;
  }
  return null;
}
