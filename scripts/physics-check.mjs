// Headless physics sanity checks (no DOM/three): node scripts/physics-check.mjs
import { SURFACES, RPM_TO_RADS, COURT } from '../src/physics/constants.js';
import { makeBall, stepBall, predictLanding } from '../src/physics/ball.js';
import { solveShot } from '../src/physics/shotSolver.js';
import { computeStroke } from '../src/game/shots.js';

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
  let flightApex = 0;
  for (let t = 0; t < 4; t += dt) {
    if (!bounce) {
      preSpeedH = Math.hypot(ball.vel.x, ball.vel.z);
      flightApex = Math.max(flightApex, ball.pos.y);
    }
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
  return {
    bounce, apex, flightApex,
    preSpeedH: bounce ? bounce.preSpeedH : 0,
    postSpeedH: bounce ? bounce.postSpeedH : 0,
    retention: bounce ? bounce.postSpeedH / bounce.preSpeedH : 0,
  };
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

console.log('--- shot-type contrast (POW/SPN/SLC ~72 player, hard court) ---');
{
  // mirror SHOT_TYPES + STATS_MAP regimes for a typical character at q=1
  const flat = fireAndBounce(SURFACES.hard,
    { speed: 33.4, spinRpm: 500, thetaMin: 0, thetaMax: 10, targetZ: -10.6 });
  const top = fireAndBounce(SURFACES.hard,
    { speed: 33.4 * 0.85, spinRpm: 3530, thetaMin: 10, thetaMax: 32, targetZ: -9.8 });
  const sli = fireAndBounce(SURFACES.hard,
    { speed: 33.4 * 0.62, spinRpm: -2350, thetaMin: 1, thetaMax: 10, targetZ: -9.0 });
  for (const [n, s] of [['flat', flat], ['topspin', top], ['slice', sli]]) {
    console.log(`  ${n.padEnd(7)}: arc=${s.flightApex.toFixed(2)}m  preSpeed=${s.preSpeedH.toFixed(1)}  postApex=${s.apex.toFixed(2)}  postSpeed=${s.postSpeedH.toFixed(1)}`);
  }
  check('flat arrives much faster than topspin (>10%)',
    flat.preSpeedH > top.preSpeedH * 1.10,
    `${flat.preSpeedH.toFixed(1)} vs ${top.preSpeedH.toFixed(1)}`);
  check('topspin arrives much faster than slice (>15%)',
    top.preSpeedH > sli.preSpeedH * 1.15,
    `${top.preSpeedH.toFixed(1)} vs ${sli.preSpeedH.toFixed(1)}`);
  check('topspin arcs visibly higher than flat (>0.5m)',
    top.flightApex > flat.flightApex + 0.5,
    `${top.flightApex.toFixed(2)} vs ${flat.flightApex.toFixed(2)}`);
  check('topspin kicks much higher off the bounce than slice (>=1.5x)',
    top.apex >= sli.apex * 1.5,
    `${top.apex.toFixed(2)} vs ${sli.apex.toFixed(2)}`);
  check('slice is slower through the bounce than topspin',
    sli.postSpeedH < top.postSpeedH,
    `${sli.postSpeedH.toFixed(1)} vs ${top.postSpeedH.toFixed(1)}`);
}

console.log('--- surface pace (flat drive ~28 m/s) ---');
{
  const flat = { speed: 28, spinRpm: 500, thetaMin: 1, thetaMax: 14, targetZ: -10.0 };
  const hard = fireAndBounce(SURFACES.hard, flat);
  const clay = fireAndBounce(SURFACES.clay, flat);
  const grass = fireAndBounce(SURFACES.grass, flat);
  console.log(`  flat hard : apex=${hard.apex.toFixed(2)} retention=${hard.retention.toFixed(2)}`);
  console.log(`  flat clay : apex=${clay.apex.toFixed(2)} retention=${clay.retention.toFixed(2)}`);
  console.log(`  flat grass: apex=${grass.apex.toFixed(2)} retention=${grass.retention.toFixed(2)}`);
  check('pace order: grass > hard > clay',
    grass.retention > hard.retention && hard.retention > clay.retention,
    `g=${grass.retention.toFixed(2)} h=${hard.retention.toFixed(2)} c=${clay.retention.toFixed(2)}`);
  check('bounce height order: clay > hard > grass',
    clay.apex > hard.apex && hard.apex > grass.apex,
    `c=${clay.apex.toFixed(2)} h=${hard.apex.toFixed(2)} g=${grass.apex.toFixed(2)}`);
  check('grass keeps most of the pace (retention > 0.75)', grass.retention > 0.75,
    grass.retention.toFixed(2));
  check('clay takes pace off (retention < 0.70)', clay.retention < 0.70,
    clay.retention.toFixed(2));
}

console.log('--- contact quality sensitivity (stroke) ---');
{
  const stats = { POW: 70, SPN: 70, SLC: 60, SRV: 60, SPD: 60, CTL: 70, REA: 60 };
  function meanStroke(ballX) {
    // ballX controls the distance from the player -> contact quality
    let speedSum = 0, depthSum = 0, qSum = 0, n = 0;
    for (let i = 0; i < 300; i++) {
      const ballPos = { x: ballX, y: 1.0, z: 11.0 };
      const res = computeStroke({
        playerPos: { x: 0, z: 11.2 },
        ballPos,
        ballVel: { x: 0, y: -3, z: 14 },
        stats, shotType: 'topspin', aim: { x: 0, depth: 0 }, side: 'P',
      });
      if (!res || res.type !== 'topspin') continue;
      const ball = makeBall();
      ball.pos = { ...ballPos };
      ball.vel = res.vel;
      ball.spin = res.spin;
      const landing = predictLanding(ball, SURFACES.hard);
      if (!landing || landing.pos.z > 0) continue;
      speedSum += Math.hypot(res.vel.x, res.vel.y, res.vel.z);
      depthSum += -landing.pos.z;
      qSum += res.q;
      n++;
    }
    return { speed: speedSum / n, depth: depthSum / n, q: qSum / n, n };
  }
  const clean = meanStroke(0.5);
  const stretched = meanStroke(0.95); // near the edge of reach: q ~ 0.45
  console.log(`  clean    : q=${clean.q.toFixed(2)} speed=${clean.speed.toFixed(1)} depth=${clean.depth.toFixed(1)}`);
  console.log(`  stretched: q=${stretched.q.toFixed(2)} speed=${stretched.speed.toFixed(1)} depth=${stretched.depth.toFixed(1)}`);
  check('stretched contact is >10% slower', stretched.speed < clean.speed * 0.9,
    `${stretched.speed.toFixed(1)} vs ${clean.speed.toFixed(1)}`);
  check('stretched contact lands shorter', stretched.depth < clean.depth - 0.5,
    `${stretched.depth.toFixed(1)} vs ${clean.depth.toFixed(1)}`);
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
{
  const solved = solveShot({
    from: { x: 0, y: 1.0, z: 11.5 }, target: { x: 0, z: -10 }, speed: 30,
    spinRadS: 2500 * RPM_TO_RADS, thetaMinDeg: 10, thetaMaxDeg: 32,
  });
  const ball = makeBall();
  ball.pos = { x: 0, y: 1.0, z: 11.5 };
  ball.vel = solved.vel; ball.spin = solved.spin; ball.active = true;
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) predictLanding(ball, SURFACES.hard);
  const ms = performance.now() - t0;
  check('1,000 landing predictions under 800 ms', ms < 800, `${ms.toFixed(0)} ms`);
}

console.log(failures === 0 ? '\nAll physics checks passed.' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
