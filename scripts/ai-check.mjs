// Headless CPU-AI check: feeds realistic human shots and measures how often
// the CPU reaches the ball (contact) and puts the return in, per difficulty.
// node scripts/ai-check.mjs
import { SURFACES, COURT, LINE_GRACE, STATS_MAP, DT, PLAYER_BOUNDS } from '../src/physics/constants.js';
import { makeBall, copyBall, stepBall, predictLanding } from '../src/physics/ball.js';
import { computeStroke } from '../src/game/shots.js';
import { createAI, updateAI, DIFFICULTIES } from '../src/ai.js';
import { CHARACTERS } from '../src/characters.js';

// keep in sync with src/entities/player.js
const SWING_CONTACT_T = 0.18;
const SWING_DUR = 0.45;

let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failures++;
}

function inCourt(pos, zSign) {
  return Math.sign(pos.z) === zSign &&
    Math.abs(pos.x) <= COURT.halfWidth + LINE_GRACE &&
    Math.abs(pos.z) <= COURT.halfLen + LINE_GRACE;
}

// One point: a human shot vs the CPU. Returns {contact, returnIn} or null
// (shot did not land in on the CPU side -> not the CPU's problem).
// mode 'mixed': everyday rally balls; 'pressing': hard flat drives into the
// corners — where difficulty separation must show.
function playBall(ai, character, surface, seed, mode) {
  const pressing = mode === 'pressing';
  const hitter = pressing
    ? CHARACTERS.find((c) => c.id === 'boom').stats
    : CHARACTERS[seed % CHARACTERS.length].stats;
  const humanPos = pressing
    ? { x: (seed % 2) * 2 - 1, z: 11.5 }
    : { x: -3 + (seed % 7), z: 11 + (seed % 3) };
  const ballPos = { x: humanPos.x + 0.5, y: 0.8 + (seed % 5) * 0.12, z: humanPos.z - 0.2 };
  const res = computeStroke({
    playerPos: humanPos,
    ballPos,
    ballVel: { x: 0, y: -2, z: 12 },
    stats: hitter,
    shotType: pressing ? 'flat' : ['flat', 'topspin', 'slice'][seed % 3],
    aim: pressing
      ? { x: (seed % 2) * 2 - 1, depth: 1 } // corner-to-corner, deep
      : { x: ((seed * 7) % 5 - 2) / 2, depth: ((seed * 3) % 5 - 2) / 2 },
    side: 'P',
  });
  if (!res || res.mishit) return null;

  const ball = makeBall();
  ball.pos = { ...ballPos };
  ball.vel = res.vel;
  ball.spin = res.spin;
  ball.active = true;
  const landing = predictLanding(copyBall(ball), surface);
  if (!landing || !inCourt(landing.pos, -1)) return null; // out: CPU rightly lets it go

  // CPU stub entity, moved exactly like entities/player.js
  const maxSpeed = STATS_MAP.runSpeed(character.stats.SPD) * ai.diff.speedMul;
  const accel = STATS_MAP.runAccel(character.stats.SPD) * ai.diff.speedMul;
  const cpu = { pos: { x: 0, z: -12.3 }, vel: { x: 0, z: 0 }, swing: null,
    pendingType: null, pendingAim: null };
  const human = { pos: humanPos };
  const ballEnt = { state: ball };
  const ballStamp = seed; // unique per point -> AI treats it as a new shot
  let gameTime = seed * 50;
  let cpuBounces = 0;
  let contact = false, returnIn = false;

  for (let t = 0; t < 5 && !contact; t += DT) {
    const move = updateAI(ai, {
      ball: ballEnt, ballStamp, surface, cpu, human, gameTime,
      canHit: true,
      bounced: cpuBounces > 0,
      requestSwing(type, aim) {
        if (cpu.swing) return;
        cpu.swing = { t: 0, contactDone: false };
        cpu.pendingType = type;
        cpu.pendingAim = aim;
      },
    });
    // integrate movement (keep in sync with player.update's accel/brake model)
    const slow = cpu.swing ? 0.45 : 1;
    const dvx = move.x * maxSpeed * slow - cpu.vel.x;
    const dvz = move.z * maxSpeed * slow - cpu.vel.z;
    const dv = Math.hypot(dvx, dvz);
    if (dv > 1e-6) {
      const braking = cpu.vel.x * dvx + cpu.vel.z * dvz < 0;
      const step = Math.min(dv, (braking ? accel * 1.8 : accel) * DT);
      cpu.vel.x += dvx / dv * step;
      cpu.vel.z += dvz / dv * step;
    }
    cpu.pos.x += cpu.vel.x * DT;
    cpu.pos.z += cpu.vel.z * DT;
    cpu.pos.x = Math.max(PLAYER_BOUNDS.xMin, Math.min(PLAYER_BOUNDS.xMax, cpu.pos.x));
    cpu.pos.z = Math.max(-PLAYER_BOUNDS.zMax, Math.min(-PLAYER_BOUNDS.zMin, cpu.pos.z));

    // swing progress + contact attempt (same gates as game.js attemptContact)
    if (cpu.swing) {
      cpu.swing.t += DT;
      if (!cpu.swing.contactDone && cpu.swing.t >= SWING_CONTACT_T) {
        cpu.swing.contactDone = true;
        if (ball.pos.z * -1 >= -0.2) { // ball on the CPU side
          const r = computeStroke({
            playerPos: { x: cpu.pos.x, z: cpu.pos.z },
            ballPos: ball.pos,
            ballVel: ball.vel,
            stats: character.stats,
            shotType: cpu.pendingType,
            aim: cpu.pendingAim,
            side: 'C',
          });
          if (r) {
            contact = true;
            const rb = makeBall();
            rb.pos = { ...ball.pos };
            rb.vel = r.vel;
            rb.spin = r.spin;
            rb.active = true;
            const l2 = predictLanding(rb, surface);
            returnIn = !!l2 && inCourt(l2.pos, 1);
          }
        }
      }
      if (cpu.swing.t >= SWING_DUR) cpu.swing = null;
    }

    const ev = [];
    stepBall(ball, DT, surface, ev);
    for (const e of ev) {
      if (e.type === 'bounce' && e.pos.z < 0) cpuBounces++;
    }
    if (cpuBounces >= 2) break; // double bounce: CPU missed it
    gameTime += DT;
  }
  return { contact, returnIn };
}

function run(difficulty, mode) {
  const surfaces = [SURFACES.hard, SURFACES.clay, SURFACES.grass];
  const chars = [CHARACTERS.find((c) => c.id === 'ace'), CHARACTERS.find((c) => c.id === 'boom')];
  let played = 0, contacts = 0, returnsIn = 0;
  let seed = 1;
  for (const surface of surfaces) {
    for (const character of chars) {
      const ai = createAI(character, difficulty);
      for (let i = 0; i < 60; i++) {
        const out = playBall(ai, character, surface, seed++, mode);
        if (!out) continue;
        played++;
        if (out.contact) contacts++;
        if (out.returnIn) returnsIn++;
      }
    }
  }
  return { played, contactRate: contacts / played, returnInRate: returnsIn / played };
}

const results = {};
for (const mode of ['mixed', 'pressing']) {
  console.log(`--- CPU return ability per difficulty (${mode} balls) ---`);
  results[mode] = {};
  for (const d of DIFFICULTIES) {
    const r = run(d.id, mode);
    results[mode][d.id] = r;
    console.log(`  ${d.id.padEnd(6)}: contact=${(r.contactRate * 100).toFixed(0)}%  returnIn=${(r.returnInRate * 100).toFixed(0)}%  (n=${r.played})`);
  }
}

const mixed = results.mixed, press = results.pressing;
check('normal: CPU reaches most playable balls (>80%, mixed)',
  mixed.normal.contactRate > 0.8, `${(mixed.normal.contactRate * 100).toFixed(0)}%`);
check('hard: CPU reaches almost everything (>90%, mixed)',
  mixed.hard.contactRate > 0.9, `${(mixed.hard.contactRate * 100).toFixed(0)}%`);
check('contact rate ordering easy <= normal <= hard (mixed)',
  mixed.easy.contactRate <= mixed.normal.contactRate + 0.03 &&
  mixed.normal.contactRate <= mixed.hard.contactRate + 0.03,
  `${(mixed.easy.contactRate * 100).toFixed(0)} / ${(mixed.normal.contactRate * 100).toFixed(0)} / ${(mixed.hard.contactRate * 100).toFixed(0)}`);
check('contact ordering also holds under pressure',
  press.easy.contactRate <= press.normal.contactRate + 0.03 &&
  press.normal.contactRate <= press.hard.contactRate + 0.03,
  `${(press.easy.contactRate * 100).toFixed(0)} / ${(press.normal.contactRate * 100).toFixed(0)} / ${(press.hard.contactRate * 100).toFixed(0)}`);
check('easy is clearly softer than hard under pressure (gap > 10 pts)',
  press.hard.returnInRate - press.easy.returnInRate > 0.10,
  `${(press.easy.returnInRate * 100).toFixed(0)}% vs ${(press.hard.returnInRate * 100).toFixed(0)}%`);

console.log(failures === 0 ? '\nAll AI checks passed.' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
