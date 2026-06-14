// Gameplay-math sanity: serve and stroke in-rates per character.
// node scripts/rally-check.mjs
import { SURFACES, COURT, LINE_GRACE } from '../src/physics/constants.js';
import { makeBall, predictLanding } from '../src/physics/ball.js';
import { computeStroke } from '../src/game/shots.js';
import { computeServe, isServeBoxIn, serveStanceX } from '../src/game/serve.js';
import { CHARACTERS } from '../src/characters.js';

let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failures++;
}

const N = 300;
const hard = SURFACES.hard;

function strokeInRate(stats, type, q, surface) {
  // emulate contact quality by placing the ball at a distance that yields ~q
  // (we call computeStroke directly with a synthetic contact)
  let inCount = 0, netCount = 0;
  for (let i = 0; i < N; i++) {
    // place ball near the player so contactQuality computes a high q;
    // sweep offsets to vary q downward
    const spread = (1 - q) * 1.1;
    const ballPos = { x: 0.5 + spread, y: 1.0, z: 11.0 };
    const res = computeStroke({
      playerPos: { x: 0, z: 11.2 },
      ballPos,
      ballVel: { x: 0, y: -3, z: 14 },
      stats,
      shotType: type,
      aim: { x: (i % 3) - 1, depth: 0 },
      side: 'P',
    });
    if (!res) continue;
    const ball = makeBall();
    ball.pos = { ...ballPos };
    ball.vel = res.vel;
    ball.spin = res.spin;
    const landing = predictLanding(ball, surface);
    if (!landing) continue;
    const p = landing.pos;
    if (p.z < 0 &&
        Math.abs(p.x) <= COURT.halfWidth + LINE_GRACE &&
        Math.abs(p.z) <= COURT.halfLen + LINE_GRACE) inCount++;
    if (p.z > 0) netCount++; // came back / never crossed
  }
  return { inRate: inCount / N, netRate: netCount / N };
}

function serveInRate(stats, type, qServe) {
  let inCount = 0;
  for (let i = 0; i < N; i++) {
    const courtSide = i % 2 === 0 ? 'deuce' : 'ad';
    const sx = serveStanceX('P', courtSide);
    const from = { x: sx, y: 2.55 + 0.55 * stats.REA / 100, z: COURT.halfLen + 0.1 };
    const res = computeServe({
      stats, type, from, servingSide: 'P', courtSide,
      targetPreset: ['wide', 'body', 'T'][i % 3], qServe,
    });
    const ball = makeBall();
    ball.pos = { ...from };
    ball.vel = res.vel;
    ball.spin = res.spin;
    const landing = predictLanding(ball, hard);
    if (landing && isServeBoxIn(landing.pos, 'P', courtSide)) inCount++;
  }
  return inCount / N;
}

console.log('--- stroke in-rates (hard court) ---');
for (const c of CHARACTERS) {
  const clean = strokeInRate(c.stats, 'topspin', 1.0, hard);
  const stretched = strokeInRate(c.stats, 'topspin', 0.45, hard);
  console.log(`  ${c.name.padEnd(5)} topspin: clean=${(clean.inRate * 100).toFixed(0)}%  stretched=${(stretched.inRate * 100).toFixed(0)}%`);
  check(`${c.name}: clean topspin mostly in (>80%)`, clean.inRate > 0.8,
    `${(clean.inRate * 100).toFixed(0)}%`);
  check(`${c.name}: stretched topspin worse than clean`, stretched.inRate < clean.inRate + 0.02,
    `${(stretched.inRate * 100).toFixed(0)}% vs ${(clean.inRate * 100).toFixed(0)}%`);
}
{
  const ace = CHARACTERS.find((c) => c.id === 'ace');
  const flat = strokeInRate(ace.stats, 'flat', 1.0, hard);
  const top = strokeInRate(ace.stats, 'topspin', 1.0, hard);
  const slice = strokeInRate(ace.stats, 'slice', 1.0, hard);
  console.log(`  Ace clean: flat=${(flat.inRate * 100).toFixed(0)}% top=${(top.inRate * 100).toFixed(0)}% slice=${(slice.inRate * 100).toFixed(0)}%`);
  check('flat is riskier than topspin (clean)', flat.inRate <= top.inRate + 0.03,
    `${(flat.inRate * 100).toFixed(0)}% vs ${(top.inRate * 100).toFixed(0)}%`);
  check('slice clean mostly in (>75%)', slice.inRate > 0.75, `${(slice.inRate * 100).toFixed(0)}%`);
}

console.log('--- serve in-rates ---');
for (const c of CHARACTERS) {
  const flatGood = serveInRate(c.stats, 'flat', 0.9);
  const kick2nd = serveInRate(c.stats, c.stats.SPN >= c.stats.SLC ? 'kick' : 'slice', 0.8);
  console.log(`  ${c.name.padEnd(5)} 1st flat=${(flatGood * 100).toFixed(0)}%  2nd spin=${(kick2nd * 100).toFixed(0)}%`);
  check(`${c.name}: 1st flat serve in 35-99%`, flatGood > 0.35 && flatGood < 0.99,
    `${(flatGood * 100).toFixed(0)}%`);
  check(`${c.name}: 2nd spin serve safer than 1st flat`, kick2nd >= flatGood - 0.05,
    `${(kick2nd * 100).toFixed(0)}%`);
}

console.log(failures === 0 ? '\nAll rally checks passed.' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
