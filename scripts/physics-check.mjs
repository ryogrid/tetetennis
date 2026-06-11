// Headless physics sanity checks (no DOM/three): node scripts/physics-check.mjs
import { SURFACES, RPM_TO_RADS, COURT } from '../src/physics/constants.js';
import { makeBall, stepBall, predictLanding } from '../src/physics/ball.js';
import { solveShot } from '../src/physics/shotSolver.js';

let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failures++;
}

// Simulate a shot from the baseline and report bounce + post-bounce apex/speed.
function fireAndBounce(surface, { speed, spinRpm, thetaMin, thetaMax, targetZ }) {
  const solved = solveShot({
    from: { x: 0, y: 1.0, z: 11.5 },
    target: { x: 0, z: targetZ },
    speed,
    spinRadS: spinRpm * RPM_TO_RADS,
    thetaMinDeg: thetaMin,
    thetaMaxDeg: thetaMax,
  });
  const ball = makeBall();
  ball.pos = { x: 0, y: 1.0, z: 11.5 };
  ball.vel = solved.vel;
  ball.spin = solved.spin;
  ball.active = true;

  const dt = 1 / 240;
  const ev = [];
  let bounce = null;
  let preSpeedH = 0;
  let apex = 0;
  for (let t = 0; t < 4; t += dt) {
    if (!bounce) preSpeedH = Math.hypot(ball.vel.x, ball.vel.z);
    ev.length = 0;
    stepBall(ball, dt, surface, ev);
    const b = ev.find((e) => e.type === 'bounce');
    if (b && !bounce) {
      bounce = {
        pos: b.pos,
        postSpeedH: Math.hypot(ball.vel.x, ball.vel.z),
        preSpeedH,
      };
    } else if (bounce) {
      apex = Math.max(apex, ball.pos.y);
      if (ball.vel.y < 0 && ball.pos.y < 0.05) break;
      if (ev.some((e) => e.type === 'bounce')) break; // second bounce
    }
  }
  return { bounce, apex, retention: bounce ? bounce.postSpeedH / bounce.preSpeedH : 0 };
}

console.log('--- shot solver accuracy ---');
{
  const target = { x: 0, z: -10.3 };
  const solved = solveShot({
    from: { x: 0, y: 1.0, z: 11.5 }, target, speed: 33,
    spinRadS: 500 * RPM_TO_RADS, thetaMinDeg: 1, thetaMaxDeg: 14,
  });
  const ball = makeBall();
  ball.pos = { x: 0, y: 1.0, z: 11.5 };
  ball.vel = solved.vel; ball.spin = solved.spin; ball.active = true;
  const landing = predictLanding(ball, SURFACES.hard);
  const err = Math.hypot(landing.pos.x - target.x, landing.pos.z - target.z);
  check('flat 33 m/s lands within 1 m of target', err < 1.0, `err=${err.toFixed(2)}m`);
  check('flat 33 m/s crosses into opponent court', landing.pos.z < 0,
    `landing z=${landing.pos.z.toFixed(2)}`);
}

console.log('--- surface behavior ---');
{
  const top = { speed: 26, spinRpm: 3000, thetaMin: 4, thetaMax: 26, targetZ: -10.0 };
  const sli = { speed: 21, spinRpm: -2200, thetaMin: 1, thetaMax: 18, targetZ: -9.5 };

  const topClay = fireAndBounce(SURFACES.clay, top);
  const topGrass = fireAndBounce(SURFACES.grass, top);
  const sliClay = fireAndBounce(SURFACES.clay, sli);
  const sliGrass = fireAndBounce(SURFACES.grass, sli);
  const sliHard = fireAndBounce(SURFACES.hard, sli);

  console.log(`  topspin clay : apex=${topClay.apex.toFixed(2)} retention=${topClay.retention.toFixed(2)}`);
  console.log(`  topspin grass: apex=${topGrass.apex.toFixed(2)} retention=${topGrass.retention.toFixed(2)}`);
  console.log(`  slice clay   : apex=${sliClay.apex.toFixed(2)} retention=${sliClay.retention.toFixed(2)}`);
  console.log(`  slice grass  : apex=${sliGrass.apex.toFixed(2)} retention=${sliGrass.retention.toFixed(2)}`);
  console.log(`  slice hard   : apex=${sliHard.apex.toFixed(2)} retention=${sliHard.retention.toFixed(2)}`);

  check('topspin bounces higher on clay than grass', topClay.apex > topGrass.apex,
    `${topClay.apex.toFixed(2)} vs ${topGrass.apex.toFixed(2)}`);
  check('topspin retains more speed than slice (clay)',
    topClay.retention > sliClay.retention,
    `${topClay.retention.toFixed(2)} vs ${sliClay.retention.toFixed(2)}`);
  check('slice stays low on grass (< 0.7 m apex)', sliGrass.apex < 0.7,
    `${sliGrass.apex.toFixed(2)}`);
  check('slice retains more speed on grass than clay',
    sliGrass.retention > sliClay.retention,
    `${sliGrass.retention.toFixed(2)} vs ${sliClay.retention.toFixed(2)}`);
  check('grass slice faster through court than hard slice',
    sliGrass.retention > sliHard.retention,
    `${sliGrass.retention.toFixed(2)} vs ${sliHard.retention.toFixed(2)}`);
}

console.log('--- serve plausibility ---');
{
  const solved = solveShot({
    from: { x: 0.35, y: 2.95, z: 11.9 },
    target: { x: -0.45, z: -5.85 },
    speed: 55, spinRadS: 400 * RPM_TO_RADS,
    thetaMinDeg: -6, thetaMaxDeg: 4,
  });
  const ball = makeBall();
  ball.pos = { x: 0.35, y: 2.95, z: 11.9 };
  ball.vel = solved.vel; ball.spin = solved.spin; ball.active = true;
  const landing = predictLanding(ball, SURFACES.hard);
  const inBox = landing && Math.abs(landing.pos.x) < COURT.halfWidth &&
    landing.pos.z < 0 && landing.pos.z > -COURT.serviceLine - 0.05;
  check('flat serve at 198 km/h lands in the service box', !!inBox,
    landing ? `x=${landing.pos.x.toFixed(2)} z=${landing.pos.z.toFixed(2)}` : 'no landing');
}

console.log('--- solver performance ---');
{
  const t0 = performance.now();
  for (let i = 0; i < 10000; i++) {
    solveShot({
      from: { x: (i % 7) - 3, y: 1.0, z: 11.5 },
      target: { x: ((i * 13) % 6) - 3, z: -9 - (i % 3) },
      speed: 24 + (i % 12),
      spinRadS: ((i % 5) - 2) * 1200 * RPM_TO_RADS,
      thetaMinDeg: 1, thetaMaxDeg: 26,
    });
  }
  const ms = performance.now() - t0;
  check('10,000 solves under 2000 ms', ms < 2000, `${ms.toFixed(0)} ms`);
}

console.log(failures === 0 ? '\nAll physics checks passed.' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
