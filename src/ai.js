// CPU brain: exact physics prediction degraded by stat-driven error.
// Imports physics only; receives entities via ctx.
import { predictHitPoint, predictLanding } from './physics/ball.js';
import { COURT, LINE_GRACE } from './physics/constants.js';
import { gauss } from './game/shots.js';

const STYLE_BIAS = {
  server:   { flat: 0.30, topspin: 0.00, slice: 0.05, corner: 0.25, short: 0.00 },
  grinder:  { flat: 0.00, topspin: 0.40, slice: 0.00, corner: 0.10, short: 0.00 },
  counter:  { flat: 0.05, topspin: 0.20, slice: 0.10, corner: 0.05, short: 0.05 },
  slicer:   { flat: 0.05, topspin: 0.00, slice: 0.40, corner: 0.10, short: 0.25 },
  allround: { flat: 0.10, topspin: 0.15, slice: 0.10, corner: 0.10, short: 0.05 },
};

export function createAI(character) {
  return {
    character,
    stats: character.stats,
    style: character.style,
    predStamp: -1,
    pred: null,       // {pos, tAbs}
    landingOut: false,
    plan: null,       // {type, aim}
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
        + Math.random() * 0.25;
      candidates.push({ u, type, tg });
    }
  }
  candidates.sort((a, b) => b.u - a.u);
  const pick = candidates[0];
  // convert target -> aim input understood by computeStroke
  const baseZ = pick.type === 'slice' ? 9.5 : 10.3;
  return {
    type: pick.type,
    aim: {
      x: pick.tg.x / 2.8,
      depth: (pick.tg.z - baseZ) / 2.4,
    },
  };
}

export function chooseServe(ai, isSecond) {
  const { stats, style } = ai;
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
    preset = r2 < 0.4 ? 'wide' : r2 < 0.75 ? 'T' : 'body';
  }
  const base = isSecond ? 0.78 : 0.7;
  const qServe = Math.max(0.4, Math.min(1,
    base + 0.3 * Math.random() * (0.5 + stats.CTL / 200)));
  return { type, preset, qServe };
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

  // (re)predict when the trajectory changes
  if (ai.predStamp !== ctx.ballStamp) {
    ai.predStamp = ctx.ballStamp;
    const landing = predictLanding(ball, ctx.surface);
    ai.landingOut = !!landing && Math.sign(landing.pos.z) < 0 &&
      (Math.abs(landing.pos.x) > COURT.halfWidth + LINE_GRACE ||
       Math.abs(landing.pos.z) > COURT.halfLen + LINE_GRACE);
    const hp = predictHitPoint(ball, ctx.surface, -1);
    if (hp && !ai.landingOut) {
      const posErr = 0.7 * (1 - ai.stats.CTL / 100);
      ai.pred = {
        pos: { x: hp.pos.x + gauss() * posErr * 0.5, y: hp.pos.y, z: hp.pos.z },
        tAbs: ctx.gameTime + hp.t,
      };
      const runDist = Math.hypot(hp.pos.x - ctx.cpu.pos.x, hp.pos.z - ctx.cpu.pos.z);
      const pressure = 1 + 0.6 * Math.min(1, runDist / 6);
      ai.swingJitter = gauss() * 0.045 * (1.15 - ai.stats.CTL / 100) * pressure;
      ai.plan = chooseStroke(ai, ctx, hp.pos);
    } else {
      ai.pred = null; // ball flying out or unreachable: let it go
    }
  }

  if (!ai.pred) {
    seek(move, ctx.cpu.pos, ai.home, 0.25);
    return move;
  }

  // run to the strike point (stand a bit behind it, facing the net)
  const stand = { x: ai.pred.pos.x, z: ai.pred.pos.z - 0.35 };
  seek(move, ctx.cpu.pos, stand, 0.08);

  // commit the swing so the racket meets the ball at the contact moment
  const lead = 0.18 + ai.swingJitter;
  if (!ctx.cpu.swing && ctx.gameTime >= ai.pred.tAbs - lead) {
    ctx.requestSwing(ai.plan.type, ai.plan.aim);
    ai.pred = null;
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
