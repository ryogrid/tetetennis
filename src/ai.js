// CPU brain: exact physics prediction degraded by stat- and difficulty-driven
// error. Imports physics only; receives entities via ctx.
import { sampleHitPoints, predictLanding } from './physics/ball.js';
import { COURT, LINE_GRACE, STATS_MAP, PLAYER_BOUNDS } from './physics/constants.js';
import { gauss } from './game/shots.js';

const STYLE_BIAS = {
  server:   { flat: 0.30, topspin: 0.00, slice: 0.05, corner: 0.25, short: 0.00 },
  grinder:  { flat: 0.00, topspin: 0.40, slice: 0.00, corner: 0.10, short: 0.00 },
  counter:  { flat: 0.05, topspin: 0.20, slice: 0.10, corner: 0.05, short: 0.05 },
  slicer:   { flat: 0.05, topspin: 0.00, slice: 0.40, corner: 0.10, short: 0.25 },
  allround: { flat: 0.10, topspin: 0.15, slice: 0.10, corner: 0.10, short: 0.05 },
};

// Difficulty scales only the brain (and a touch of foot speed) — never the
// character's stats/identity.
export const DIFFICULTIES = [
  {
    id: 'easy', name: 'Easy', desc: 'Slow reads, late reactions, soft serves.',
    posErr: 2.0, jitter: 2.0, react: 0.38, speedMul: 0.82,
    serveQ: -0.10, choiceNoise: 0.45,
  },
  {
    id: 'normal', name: 'Normal', desc: 'A solid club player. Fair fight.',
    posErr: 1.0, jitter: 1.0, react: 0.16, speedMul: 1.0,
    serveQ: 0.0, choiceNoise: 0.25,
  },
  {
    id: 'hard', name: 'Hard', desc: 'Sharp anticipation, big serves, few gifts.',
    posErr: 0.35, jitter: 0.5, react: 0.05, speedMul: 1.10,
    serveQ: 0.08, choiceNoise: 0.12,
  },
];

export function createAI(character, difficultyId = 'normal') {
  const diff = DIFFICULTIES.find((d) => d.id === difficultyId) || DIFFICULTIES[1];
  return {
    character,
    stats: character.stats,
    style: character.style,
    diff,
    predStamp: -1,
    pred: null,        // {pos, tAbs}
    plan: null,        // {type, aim}
    committed: false,  // swing requested for the current read
    reactAt: 0,        // gameTime before which the new shot isn't "seen"
    nextPredictAt: 0,  // gameTime of the next trajectory re-read
    errVec: { x: 0, z: 0 },
    landingOut: false,
    swingJitter: 0,
    home: { x: 0, z: -12.3 },
  };
}

function chooseStroke(ai, ctx, predPos) {
  const { stats, style } = ai;
  const bias = STYLE_BIAS[style];
  const humanX = ctx.human.pos.x;
  const humanZ = ctx.human.pos.z;
  const aggr = (stats.POW + stats.SRV) / 200;
  const cons = stats.CTL / 100;
  // how stretched will the CPU be at contact?
  const runDist = Math.hypot(predPos.x - ctx.cpu.pos.x, predPos.z - ctx.cpu.pos.z);
  const stretch = Math.min(runDist / 6, 1);

  const candidates = [];
  const targets = [
    { x: -3.0, z: 10.3, corner: 1, short: 0 },
    { x: 0.0,  z: 10.6, corner: 0, short: 0 },
    { x: 3.0,  z: 10.3, corner: 1, short: 0 },
    { x: -2.6, z: 5.0,  corner: 0, short: 1 },
    { x: 2.6,  z: 5.0,  corner: 0, short: 1 },
    { x: humanX * 0.5, z: 9.5, corner: 0, short: 0 },
  ];
  for (const tg of targets) {
    for (const type of ['flat', 'topspin', 'slice']) {
      // CPU hits toward +z (human side); distance from human to target
      const open = Math.hypot(tg.x - humanX, tg.z - humanZ) / 10;
      const risk = (type === 'flat' ? 0.5 : 0) + tg.corner * 0.4 + tg.short * 0.25;
      let u = open
        + aggr * (tg.corner * 0.35 + (type === 'flat' ? 0.35 : 0))
        + cons * ((type === 'topspin' ? 0.30 : 0) + (Math.abs(tg.x) < 2 ? 0.15 : 0))
        - stretch * risk * 1.1
        + bias[type] + tg.corner * bias.corner + tg.short * bias.short
        + Math.random() * ai.diff.choiceNoise;
      candidates.push({ u, type, tg });
    }
  }
  candidates.sort((a, b) => b.u - a.u);
  const pick = candidates[0];
  // convert target -> aim input understood by computeStroke (its per-type
  // base depths)
  const baseZ = pick.type === 'flat' ? 10.6 : pick.type === 'topspin' ? 9.8 : 9.2;
  return {
    type: pick.type,
    aim: {
      x: pick.tg.x / 2.8,
      depth: (pick.tg.z - baseZ) / 2.4,
    },
  };
}

export function chooseServe(ai, isSecond) {
  const { stats, style, diff } = ai;
  const r = Math.random();
  let type, preset;
  if (isSecond) {
    type = stats.SPN >= stats.SLC ? 'kick' : 'slice';
    preset = 'body';
  } else {
    if (style === 'server') type = r < 0.7 ? 'flat' : 'slice';
    else if (style === 'grinder') type = r < 0.5 ? 'kick' : 'flat';
    else if (style === 'slicer') type = r < 0.55 ? 'slice' : 'flat';
    else type = r < 0.45 ? 'flat' : (r < 0.75 ? 'slice' : 'kick');
    const r2 = Math.random();
    // hard goes for the corners more often
    const wideP = diff.id === 'hard' ? 0.45 : 0.4;
    const tP = diff.id === 'hard' ? 0.45 : 0.35;
    preset = r2 < wideP ? 'wide' : r2 < wideP + tP ? 'T' : 'body';
  }
  const base = (isSecond ? 0.78 : 0.7) + diff.serveQ;
  const qServe = Math.max(0.4, Math.min(1,
    base + 0.3 * Math.random() * (0.5 + stats.CTL / 200)));
  return { type, preset, qServe };
}

// Pick the contact point: the most comfortable one the CPU can actually reach
// in time; if none is reachable, the least-bad one (keep chasing — never
// stand and watch a playable ball).
// Time to cover `dist` from rest with limited acceleration, then top speed.
function travelTime(dist, vmax, accel) {
  const dAcc = vmax * vmax / (2 * accel);
  return dist <= dAcc
    ? Math.sqrt(2 * dist / accel)
    : dist / vmax + vmax / (2 * accel);
}

function pickIntercept(ai, ctx, opts) {
  if (!opts.length) return null;
  const vmax = STATS_MAP.runSpeed(ai.stats.SPD) * ai.diff.speedMul;
  const accel = STATS_MAP.runAccel(ai.stats.SPD) * ai.diff.speedMul;
  const zReach = PLAYER_BOUNDS.zMax - 0.4;
  let best = null, bestU = -Infinity;
  let fallback = null, fallbackBad = Infinity;
  for (const p of opts) {
    const dist = Math.hypot(p.pos.x - ctx.cpu.pos.x, p.pos.z - ctx.cpu.pos.z);
    const arrive = travelTime(dist, vmax, accel) + 0.08;
    const spare = p.t - arrive;
    const inBounds = Math.abs(p.pos.z) <= zReach;
    if (spare >= 0.05 && inBounds) {
      const u = -Math.abs(p.pos.y - 1.0) + Math.min(spare, 0.6) * 0.5;
      if (u > bestU) { bestU = u; best = p; }
    } else {
      const bad = (inBounds ? 0 : 10) + Math.max(0, -spare);
      if (bad < fallbackBad) { fallbackBad = bad; fallback = p; }
    }
  }
  return best || fallback;
}

// Called every fixed step during RALLY when the CPU may have to play the ball.
// ctx: {ball (entity), ballStamp, surface, cpu, human, gameTime, canHit,
//       requestSwing(type, aim)}
// Returns the desired move vector {x, z} for the CPU.
export function updateAI(ai, ctx) {
  const ball = ctx.ball.state;
  const move = { x: 0, z: 0 };

  const incoming = ball.active && ctx.canHit;
  if (!incoming) {
    ai.pred = null;
    ai.predStamp = -1;
    // recover toward home, leaning slightly to cover the open court
    ai.home.x = Math.max(-2, Math.min(2, ctx.human.pos.x * -0.2));
    seek(move, ctx.cpu.pos, ai.home, 0.25);
    return move;
  }

  // new shot: start the reaction clock, draw this shot's read error
  if (ai.predStamp !== ctx.ballStamp) {
    ai.predStamp = ctx.ballStamp;
    ai.reactAt = ctx.gameTime + ai.diff.react * (0.7 + 0.6 * Math.random());
    ai.nextPredictAt = 0;
    ai.errVec = { x: gauss(), z: gauss() };
    ai.swingJitter = gauss() * 0.045 * (1.15 - ai.stats.CTL / 100) * ai.diff.jitter;
    ai.pred = null;
    ai.plan = null;
    ai.committed = false;
  }

  if (ctx.gameTime < ai.reactAt) {
    seek(move, ctx.cpu.pos, ai.home, 0.25);
    return move;
  }

  // periodic re-read: the error shrinks as the ball gets closer, so a bad
  // first read gets corrected instead of being final
  if (!ai.committed && ctx.gameTime >= ai.nextPredictAt) {
    ai.nextPredictAt = ctx.gameTime + 0.25;
    // "let it go" only applies before the first bounce: after it, the next
    // predicted landing is the (always far) second bounce, not an out call
    if (ctx.bounced) {
      ai.landingOut = false;
    } else {
      const landing = predictLanding(ball, ctx.surface);
      ai.landingOut = !!landing && Math.sign(landing.pos.z) < 0 &&
        (Math.abs(landing.pos.x) > COURT.halfWidth + LINE_GRACE ||
         Math.abs(landing.pos.z) > COURT.halfLen + LINE_GRACE);
    }
    const pick = ai.landingOut ? null
      : pickIntercept(ai, ctx,
          sampleHitPoints(ball, ctx.surface, -1, 6, 0.06, ctx.bounced));
    if (pick) {
      const posErr = 0.7 * (1 - ai.stats.CTL / 100) * ai.diff.posErr;
      const shrink = Math.max(0.25, Math.min(1, pick.t / 1.2));
      ai.pred = {
        pos: {
          x: pick.pos.x + ai.errVec.x * posErr * 0.5 * shrink,
          y: pick.pos.y,
          z: pick.pos.z + ai.errVec.z * posErr * 0.3 * shrink,
        },
        tAbs: ctx.gameTime + pick.t,
      };
      if (!ai.plan) ai.plan = chooseStroke(ai, ctx, pick.pos);
    } else {
      ai.pred = null; // ball flying out: let it go
    }
  }

  if (!ai.pred) {
    seek(move, ctx.cpu.pos, ai.home, 0.25);
    return move;
  }

  // run to the strike point (stand a bit behind it, facing the net)
  const stand = {
    x: Math.max(PLAYER_BOUNDS.xMin, Math.min(PLAYER_BOUNDS.xMax, ai.pred.pos.x)),
    z: Math.max(-PLAYER_BOUNDS.zMax, Math.min(-PLAYER_BOUNDS.zMin, ai.pred.pos.z - 0.35)),
  };
  seek(move, ctx.cpu.pos, stand, 0.08);

  // commit the swing so the racket meets the ball at the contact moment
  const lead = 0.18 + ai.swingJitter;
  if (!ai.committed && !ctx.cpu.swing && ctx.gameTime >= ai.pred.tAbs - lead) {
    ctx.requestSwing(ai.plan.type, ai.plan.aim);
    ai.committed = true;
  }

  // whiff recovery: the swing is over, the ball is still live on our watch —
  // re-evaluate for a second attempt instead of giving up
  if (ai.committed && !ctx.cpu.swing && ctx.gameTime > ai.pred.tAbs + 0.05) {
    ai.predStamp = -1;
  }
  return move;
}

function seek(move, from, to, deadzone) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d < deadzone) return;
  const soft = Math.min(d / 0.8, 1); // ease in near the target
  move.x = dx / d * soft;
  move.z = dz / d * soft;
}
