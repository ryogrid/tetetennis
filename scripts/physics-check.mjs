// Headless physics sanity checks (no DOM/three): node scripts/physics-check.mjs
import { SURFACES, RPM_TO_RADS, COURT, netHeight, G } from '../src/physics/constants.js';
import { makeBall, stepBall, predictLanding, predictTrajectory } from '../src/physics/ball.js';
import { effectiveEy } from '../src/physics/bounce.js';
import { solveShot } from '../src/physics/shotSolver.js';
import { computeStroke } from '../src/game/shots.js';
import { SERVE_TYPES } from '../src/game/serve.js';

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
  let preVy = 0;
  let apex = 0;
  let flightApex = 0;
  const flightPts = []; // pre-bounce path for shape metrics
  for (let t = 0; t < 4; t += dt) {
    if (!bounce) {
      preSpeedH = Math.hypot(ball.vel.x, ball.vel.z);
      preVy = ball.vel.y;
      flightApex = Math.max(flightApex, ball.pos.y);
      flightPts.push({ z: ball.pos.z, y: ball.pos.y });
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
  // flight shape vs the straight chord from launch to the bounce point:
  // rise = how far the path arcs ABOVE the chord, sag = how far it drops BELOW
  let rise = 0, sag = 0;
  if (bounce) {
    const z0 = flightPts[0].z, y0 = flightPts[0].y;
    const zb = bounce.pos.z, yb = bounce.pos.y || 0;
    for (const p of flightPts) {
      const f = (z0 - p.z) / (z0 - zb);
      if (f < 0 || f > 1) continue;
      const chordY = y0 + (yb - y0) * f;
      rise = Math.max(rise, p.y - chordY);
      sag = Math.max(sag, chordY - p.y);
    }
  }
  return {
    bounce, apex, flightApex, rise, sag,
    descentDeg: bounce ? Math.atan2(Math.abs(preVy), preSpeedH) * 180 / Math.PI : 0,
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

console.log('--- restitution: ITF drop test + speed dependence ---');
{
  // ITF approval test: drop from 100 in (2.54 m) onto concrete -> rebound
  // 53-58 in (1.35-1.47 m). Simulate with full drag on the hard court.
  function dropApex(h0, surface) {
    const ball = makeBall();
    ball.pos = { x: 0, y: h0, z: 0 };
    ball.vel = { x: 0, y: 0, z: 0 };
    ball.active = true;
    const dt = 1 / 240, ev = [];
    let bounced = false, apex = 0;
    for (let t = 0; t < 4; t += dt) {
      ev.length = 0;
      stepBall(ball, dt, surface, ev);
      if (ev.some((e) => e.type === 'bounce')) {
        if (bounced) break;
        bounced = true;
      } else if (bounced) {
        apex = Math.max(apex, ball.pos.y);
        if (ball.vel.y < 0) break;
      }
    }
    return apex;
  }
  const reb = dropApex(2.54, SURFACES.hard);
  console.log(`  2.54 m drop on hard -> rebound apex ${reb.toFixed(2)} m`);
  check('ITF drop test: 2.54 m on hard rebounds 1.30-1.50 m',
    reb > 1.30 && reb < 1.50, `${reb.toFixed(2)} m`);
  check('drop rebound order: clay > hard > grass',
    dropApex(2.54, SURFACES.clay) > reb && reb > dropApex(2.54, SURFACES.grass));
  // non-rigid ball: effective COR falls as the impact gets harder
  const eSlow = effectiveEy(SURFACES.hard.ey, 7.1);
  const eFast = effectiveEy(SURFACES.hard.ey, 20);
  console.log(`  eff COR hard: ${eSlow.toFixed(3)} @ 7.1 m/s -> ${eFast.toFixed(3)} @ 20 m/s`);
  check('effective COR decreases with impact speed (>=10% by 20 m/s)',
    eFast < eSlow * 0.9, `${eSlow.toFixed(3)} -> ${eFast.toFixed(3)}`);
  check('effective COR stays in the live range (>= 0.4 at any speed)',
    effectiveEy(SURFACES.grass.ey, 60) >= 0.4);
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
    { speed: 33.4 * 0.85, spinRpm: 4070, thetaMin: 10, thetaMax: 32, targetZ: -9.8 });
  const sli = fireAndBounce(SURFACES.hard,
    { speed: 33.4 * 0.68, spinRpm: -2800, thetaMin: 1, thetaMax: 10, targetZ: -9.0 });
  for (const [n, s] of [['flat', flat], ['topspin', top], ['slice', sli]]) {
    console.log(`  ${n.padEnd(7)}: arc=${s.flightApex.toFixed(2)}m  preSpeed=${s.preSpeedH.toFixed(1)}  postApex=${s.apex.toFixed(2)}  postSpeed=${s.postSpeedH.toFixed(1)}  descent=${s.descentDeg.toFixed(1)}deg  rise=${s.rise.toFixed(2)}  sag=${s.sag.toFixed(2)}`);
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
  // flight SHAPE (Magnus vs drag): topspin dives into the court much more
  // steeply; slice floats lower and descends shallower ("stretches")
  check('topspin descends much more steeply than flat (>8deg)',
    top.descentDeg > flat.descentDeg + 8,
    `${top.descentDeg.toFixed(1)} vs ${flat.descentDeg.toFixed(1)}deg`);
  check('slice descends much shallower than topspin (>4deg)',
    sli.descentDeg < top.descentDeg - 4,
    `${sli.descentDeg.toFixed(1)} vs ${top.descentDeg.toFixed(1)}deg`);
  check('slice arcs visibly lower than topspin (>0.4m)',
    sli.flightApex < top.flightApex - 0.4,
    `${sli.flightApex.toFixed(2)} vs ${top.flightApex.toFixed(2)}m`);
}

console.log('--- Magnus effect on the trajectory (same launch, spin vs no spin) ---');
{
  // fire the solved shot, then replay the identical launch with spin zeroed:
  // topspin must pull the ball DOWN (lands far shorter), backspin must carry
  // it ("stretch": lands far deeper) — the user-visible dip/float effects
  function landWith(cfg, zeroSpin) {
    const solved = solveShot({
      from: { x: 0, y: 1.0, z: 11.5 }, target: { x: 0, z: cfg.targetZ },
      speed: cfg.speed, spinRadS: cfg.spinRpm * RPM_TO_RADS,
      thetaMinDeg: cfg.thetaMin, thetaMaxDeg: cfg.thetaMax,
    });
    const ball = makeBall();
    ball.pos = { x: 0, y: 1.0, z: 11.5 };
    ball.vel = { ...solved.vel };
    ball.spin = zeroSpin ? { x: 0, y: 0, z: 0 } : solved.spin;
    ball.active = true;
    const landing = predictLanding(ball, SURFACES.hard);
    return landing ? landing.pos.z : null;
  }
  const topCfg = { speed: 33.4 * 0.85, spinRpm: 4070, thetaMin: 10, thetaMax: 32, targetZ: -9.8 };
  const sliCfg = { speed: 33.4 * 0.68, spinRpm: -2800, thetaMin: 1, thetaMax: 10, targetZ: -9.0 };
  const topDip = landWith(topCfg, true) - landWith(topCfg, false);   // < 0: nospin flies deeper
  const sliCarry = landWith(sliCfg, true) - landWith(sliCfg, false); // > 0: nospin falls shorter
  console.log(`  topspin pulls the ball ${(-topDip).toFixed(1)} m shorter; backspin carries it ${sliCarry.toFixed(1)} m deeper`);
  check('topspin dips: same launch without spin lands >4 m deeper', topDip < -4,
    `${topDip.toFixed(1)} m`);
  check('backspin stretches: same launch without spin lands >3 m shorter', sliCarry > 3,
    `${sliCarry.toFixed(1)} m`);
}

console.log('--- bounce decelerates horizontally (Coulomb friction, all surfaces) ---');
{
  // representative in-game shots; max-spin variants included
  const SHOTS = {
    flat:    { speed: 33.4, spinRpm: 700, thetaMin: 0, thetaMax: 10, targetZ: -10.6 },
    topspin: { speed: 28.4, spinRpm: 4800, thetaMin: 10, thetaMax: 32, targetZ: -9.8 },
    slice:   { speed: 22.7, spinRpm: -3300, thetaMin: 1, thetaMax: 10, targetZ: -9.0 },
  };
  let allSlow = true;
  const loss = {};
  for (const [sid, surface] of Object.entries(SURFACES)) {
    for (const [name, shot] of Object.entries(SHOTS)) {
      const r = fireAndBounce(surface, shot);
      const detail = `${sid}/${name}: ${r.preSpeedH.toFixed(1)} -> ${r.postSpeedH.toFixed(1)} m/s`;
      console.log(`  ${detail}`);
      if (!(r.postSpeedH < r.preSpeedH)) allSlow = false;
      if (name === 'flat') loss[sid] = r.preSpeedH - r.postSpeedH;
    }
  }
  check('horizontal speed drops at the bounce for every shot x surface', allSlow);
  check('friction ordering of the speed LOSS: clay > hard > grass',
    loss.clay > loss.hard && loss.hard > loss.grass,
    `clay -${loss.clay.toFixed(1)}  hard -${loss.hard.toFixed(1)}  grass -${loss.grass.toFixed(1)} m/s`);
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
  const clean = meanStroke(0.5);     // inside the ideal arm+racket band
  const stretched = meanStroke(1.15); // well past the band, toward max reach
  console.log(`  clean    : q=${clean.q.toFixed(2)} speed=${clean.speed.toFixed(1)} depth=${clean.depth.toFixed(1)}`);
  console.log(`  stretched: q=${stretched.q.toFixed(2)} speed=${stretched.speed.toFixed(1)} depth=${stretched.depth.toFixed(1)}`);
  check('stretched contact is >10% slower', stretched.speed < clean.speed * 0.9,
    `${stretched.speed.toFixed(1)} vs ${clean.speed.toFixed(1)}`);
  check('stretched contact lands shorter', stretched.depth < clean.depth - 0.5,
    `${stretched.depth.toFixed(1)} vs ${clean.depth.toFixed(1)}`);
}

console.log('--- trajectory sampling (display trail) ---');
{
  const solved = solveShot({
    from: { x: 0, y: 1.0, z: -11.5 }, target: { x: 0, z: 9.8 }, speed: 27,
    spinRadS: 2800 * RPM_TO_RADS, thetaMinDeg: 10, thetaMaxDeg: 32,
  });
  const ball = makeBall();
  ball.pos = { x: 0, y: 1.0, z: -11.5 };
  ball.vel = solved.vel; ball.spin = solved.spin; ball.active = true;
  const landing = predictLanding(ball, SURFACES.hard);
  const { points, bounceT } = predictTrajectory(ball, SURFACES.hard, 1);
  const ordered = points.every((p, i) => i === 0 || p.t > points[i - 1].t);
  const pre = points.filter((p) => !p.afterBounce).length;
  const post = points.filter((p) => p.afterBounce).length;
  check('trajectory points are time-ordered with both phases',
    ordered && pre > 5 && post > 5, `pre=${pre} post=${post}`);
  check('trail bounce time matches predictLanding',
    bounceT !== null && Math.abs(bounceT - landing.t) < 0.05,
    `bounceT=${bounceT && bounceT.toFixed(2)} landing.t=${landing.t.toFixed(2)}`);
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

console.log('--- serve-type shapes (kick dips, slice curves) ---');
{
  // mirror computeServe spin composition (SRV/SPN ~70 server, no aim error)
  function serveFlight(type, fromSide = 'C') {
    const sgn = fromSide === 'C' ? 1 : -1; // serve direction along z
    const from = { x: -0.35 * sgn, y: 2.95, z: -11.9 * sgn };
    const target = { x: 0.45 * sgn, z: 5.85 * sgn };
    const def = SERVE_TYPES[type];
    let spinRpm, ySpinFrac = 0, ySpinSign = 0;
    if (type === 'flat') { spinRpm = 400; }
    else if (type === 'kick') { spinRpm = 3200 + 1600 * 0.7; ySpinFrac = 0.4; ySpinSign = -1; }
    else { spinRpm = -(1800 + 900 * 0.7); ySpinFrac = 0.7; ySpinSign = 1; }
    const wTotal = Math.abs(spinRpm) * RPM_TO_RADS;
    const solved = solveShot({
      from, target,
      speed: 55 * def.speedMul,
      spinRadS: spinRpm * RPM_TO_RADS * (1 - ySpinFrac),
      ySpinRadS: wTotal * ySpinFrac * ySpinSign,
      thetaMinDeg: def.thetaMin, thetaMaxDeg: def.thetaMax,
    });
    const ball = makeBall();
    ball.pos = { ...from };
    ball.vel = solved.vel; ball.spin = solved.spin; ball.active = true;
    const v0 = { ...solved.vel };
    const dt = 1 / 240, ev = [];
    let clearance = null, preVy = 0, preSpeedH = 0;
    for (let t = 0; t < 3; t += dt) {
      preVy = ball.vel.y; preSpeedH = Math.hypot(ball.vel.x, ball.vel.z);
      const zPrev = ball.pos.z;
      ev.length = 0;
      stepBall(ball, dt, SURFACES.hard, ev);
      if (clearance === null && Math.sign(ball.pos.z) !== Math.sign(zPrev)) {
        clearance = ball.pos.y - netHeight(ball.pos.x);
      }
      const b = ev.find((e) => e.type === 'bounce');
      if (b) {
        // lateral deviation of the landing from the launch-direction line
        const latDev = b.pos.x - (from.x + v0.x * (b.pos.z - from.z) / v0.z);
        return {
          clearance, latDev,
          descentDeg: Math.atan2(Math.abs(preVy), preSpeedH) * 180 / Math.PI,
          landing: b.pos,
        };
      }
    }
    return null;
  }
  const fl = serveFlight('flat');
  const ki = serveFlight('kick');
  const sl = serveFlight('slice');
  for (const [n, s] of [['flat', fl], ['kick', ki], ['slice', sl]]) {
    console.log(`  ${n.padEnd(5)}: net clearance=${s.clearance.toFixed(2)}m  descent=${s.descentDeg.toFixed(1)}deg  latDev=${s.latDev.toFixed(2)}m`);
  }
  check('kick serve clears the net much higher than flat (>0.4m)',
    ki.clearance > fl.clearance + 0.4,
    `${ki.clearance.toFixed(2)} vs ${fl.clearance.toFixed(2)}`);
  check('kick serve dives into the box more steeply than flat (>6deg)',
    ki.descentDeg > fl.descentDeg + 6,
    `${ki.descentDeg.toFixed(1)} vs ${fl.descentDeg.toFixed(1)}deg`);
  check('CPU slice serve curves toward the receiver\'s right (>0.25m, +x)',
    sl.latDev > 0.25, `${sl.latDev.toFixed(2)} m`);
  check('flat serve flies essentially straight (|latDev| < 0.1m)',
    Math.abs(fl.latDev) < 0.1, `${fl.latDev.toFixed(2)} m`);
  const slP = serveFlight('slice', 'P');
  check('human slice serve curves toward the CPU receiver\'s right (-x)',
    slP.latDev < -0.25, `${slP.latDev.toFixed(2)} m`);
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
