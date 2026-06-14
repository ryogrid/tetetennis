// CPU brain: exact physics prediction degraded by stat- and difficulty-driven
// error. Ported from old/src/ai.js. The JS `ctx.requestSwing` callback becomes
// a swing request on the returned AiMove.

///|
struct StyleBias {
  flat : Double
  topspin : Double
  slice : Double
  corner : Double
  short_ : Double
}

///|
fn style_bias(style : String) -> StyleBias {
  match style {
    "server" => { flat: 0.30, topspin: 0.00, slice: 0.05, corner: 0.25, short_: 0.00 }
    "grinder" => { flat: 0.00, topspin: 0.40, slice: 0.00, corner: 0.10, short_: 0.00 }
    "counter" => { flat: 0.05, topspin: 0.20, slice: 0.10, corner: 0.05, short_: 0.05 }
    "slicer" => { flat: 0.05, topspin: 0.00, slice: 0.40, corner: 0.10, short_: 0.25 }
    _ => { flat: 0.10, topspin: 0.15, slice: 0.10, corner: 0.10, short_: 0.05 }
  }
}

///|
pub(all) struct Difficulty {
  id : String
  name : String
  desc : String
  pos_err : Double
  jitter : Double
  react : Double
  speed_mul : Double
  serve_q : Double
  choice_noise : Double
}

///|
pub let difficulties : Array[Difficulty] = [
  {
    id: "easy",
    name: "Easy",
    desc: "Slow reads, late reactions, soft serves.",
    pos_err: 2.0,
    jitter: 2.0,
    react: 0.55,
    speed_mul: 0.70,
    serve_q: -0.10,
    choice_noise: 0.45,
  },
  {
    id: "normal",
    name: "Normal",
    desc: "A solid club player. Fair fight.",
    pos_err: 1.0,
    jitter: 1.0,
    react: 0.22,
    speed_mul: 1.0,
    serve_q: 0.0,
    choice_noise: 0.25,
  },
  {
    id: "hard",
    name: "Hard",
    desc: "Sharp anticipation, big serves, few gifts.",
    pos_err: 0.35,
    jitter: 0.5,
    react: 0.06,
    speed_mul: 1.10,
    serve_q: 0.08,
    choice_noise: 0.12,
  },
]

///|
pub fn difficulty_by_id(id : String) -> Difficulty {
  for d in difficulties {
    if d.id == id {
      return d
    }
  }
  difficulties[1] // normal
}

///|
pub(all) struct Ai {
  stats : @shots.Stats
  style : String
  diff : Difficulty
  mut pred_stamp : Int
  mut has_pred : Bool
  mut pred_x : Double
  mut pred_y : Double
  mut pred_z : Double
  mut pred_t_abs : Double
  mut has_plan : Bool
  mut plan_type : @shots.ShotType
  mut plan_aim_x : Double
  mut plan_aim_depth : Double
  mut committed : Bool
  mut react_at : Double
  mut next_predict_at : Double
  mut err_x : Double
  mut err_z : Double
  mut landing_out : Bool
  mut swing_jitter : Double
  mut home_x : Double
  mut home_z : Double
}

///|
pub fn create_ai(character : @shots.Character, difficulty_id : String) -> Ai {
  {
    stats: character.stats,
    style: character.style,
    diff: difficulty_by_id(difficulty_id),
    pred_stamp: -1,
    has_pred: false,
    pred_x: 0.0,
    pred_y: 0.0,
    pred_z: 0.0,
    pred_t_abs: 0.0,
    has_plan: false,
    plan_type: Flat,
    plan_aim_x: 0.0,
    plan_aim_depth: 0.0,
    committed: false,
    react_at: 0.0,
    next_predict_at: 0.0,
    err_x: 0.0,
    err_z: 0.0,
    landing_out: false,
    swing_jitter: 0.0,
    home_x: 0.0,
    home_z: -12.3,
  }
}

///|
pub(all) struct AiCtx {
  ball : @physics.Ball
  ball_stamp : Int
  surface : @physics.Surface
  cpu_x : Double
  cpu_z : Double
  cpu_swinging : Bool
  human_x : Double
  human_z : Double
  game_time : Double
  can_hit : Bool
  bounced : Bool
}

///|
pub(all) struct AiMove {
  x : Double
  z : Double
  swing : Bool
  swing_type : @shots.ShotType
  swing_aim_x : Double
  swing_aim_depth : Double
}

///|
struct StrokePlan {
  type_ : @shots.ShotType
  aim_x : Double
  aim_depth : Double
}

///|
fn choose_stroke(ai : Ai, ctx : AiCtx, pred_x : Double, pred_z : Double, rng : @rng.Gauss) -> StrokePlan {
  let stats = ai.stats
  let bias = style_bias(ai.style)
  let human_x = ctx.human_x
  let human_z = ctx.human_z
  let aggr = (stats.pow + stats.srv) / 200.0
  let cons = stats.ctl / 100.0
  let run_dist = @vec.hypot2(pred_x - ctx.cpu_x, pred_z - ctx.cpu_z)
  let stretch = @vec.dmin(run_dist / 6.0, 1.0)

  // targets: (x, z, corner, short)
  let targets = [
    (-3.0, 10.3, 1.0, 0.0),
    (0.0, 10.6, 0.0, 0.0),
    (3.0, 10.3, 1.0, 0.0),
    (-2.6, 5.0, 0.0, 1.0),
    (2.6, 5.0, 0.0, 1.0),
    (human_x * 0.5, 9.5, 0.0, 0.0),
  ]
  let types : Array[@shots.ShotType] = [Flat, Topspin, Slice]
  let mut best_u = -1.0e18
  let mut best_type : @shots.ShotType = Flat
  let mut best_tx = 0.0
  let mut best_tz = 0.0
  for tg in targets {
    let tgx = tg.0
    let tgz = tg.1
    let corner = tg.2
    let short_ = tg.3
    for ty in types {
      let open = @vec.hypot2(tgx - human_x, tgz - human_z) / 10.0
      let type_bias = match ty {
        Flat => bias.flat
        Topspin => bias.topspin
        Slice => bias.slice
        _ => 0.0
      }
      let flat_term = match ty {
        Flat => 0.35
        _ => 0.0
      }
      let topspin_term = match ty {
        Topspin => 0.30
        _ => 0.0
      }
      let u = open +
        aggr * (corner * 0.35 + flat_term) +
        cons * (topspin_term + (if @vec.dabs(tgx) < 2.0 { 0.15 } else { 0.0 })) -
        stretch * ((match ty { Flat => 0.5; _ => 0.0 }) + corner * 0.4 + short_ * 0.25) * 1.1 +
        type_bias +
        corner * bias.corner +
        short_ * bias.short_ +
        rng.uniform() * ai.diff.choice_noise
      if u > best_u {
        best_u = u
        best_type = ty
        best_tx = tgx
        best_tz = tgz
      }
    }
  }
  let base_z = match best_type {
    Flat => 10.6
    Topspin => 9.8
    _ => 9.2
  }
  { type_: best_type, aim_x: best_tx / 2.8, aim_depth: (best_tz - base_z) / 2.4 }
}

///|
pub(all) struct ServePlan {
  type_ : @shots.ServeType
  preset : @shots.Preset
  q_serve : Double
}

///|
pub fn choose_serve(ai : Ai, is_second : Bool, rng : @rng.Gauss) -> ServePlan {
  let stats = ai.stats
  let style = ai.style
  let diff = ai.diff
  let r = rng.uniform()
  let mut type_ : @shots.ServeType = ServeFlat
  let mut preset : @shots.Preset = Body
  if is_second {
    type_ = ServeKick
    preset = Body
  } else {
    let slice_p = if style == "slicer" {
      0.35
    } else if style == "server" {
      0.25
    } else {
      0.15
    }
    type_ = if r < slice_p { ServeSlice } else { ServeFlat }
    let r2 = rng.uniform()
    let wide_p = if diff.id == "hard" { 0.45 } else { 0.4 }
    let t_p = if diff.id == "hard" { 0.45 } else { 0.35 }
    preset = if r2 < wide_p {
      Wide
    } else if r2 < wide_p + t_p {
      T
    } else {
      Body
    }
  }
  let base = (if is_second { 0.78 } else { 0.7 }) + diff.serve_q
  let q_serve = @vec.dmax(
    0.4,
    @vec.dmin(1.0, base + 0.3 * rng.uniform() * (0.5 + stats.ctl / 200.0)),
  )
  { type_, preset, q_serve }
}

// Time to cover `dist` from rest with limited accel, then top speed.
///|
fn travel_time(dist : Double, vmax : Double, accel : Double) -> Double {
  let d_acc = vmax * vmax / (2.0 * accel)
  if dist <= d_acc {
    (2.0 * dist / accel).sqrt()
  } else {
    dist / vmax + vmax / (2.0 * accel)
  }
}

// Pick the most comfortable reachable contact point, else the least-bad one.
///|
fn pick_intercept(ai : Ai, ctx : AiCtx, opts : Array[@physics.PosT]) -> @physics.PosT? {
  if opts.length() == 0 {
    return None
  }
  let vmax = @physics.run_speed(ai.stats.spd) * ai.diff.speed_mul
  let accel = @physics.run_accel(ai.stats.spd) * ai.diff.speed_mul
  let z_reach = @physics.player_z_max - 0.4
  let mut best : @physics.PosT? = None
  let mut best_u = -1.0e18
  let mut fallback : @physics.PosT? = None
  let mut fallback_bad = 1.0e18
  for p in opts {
    let dist = @vec.hypot2(p.x - ctx.cpu_x, p.z - ctx.cpu_z)
    let arrive = travel_time(dist, vmax, accel) + 0.08
    let spare = p.t - arrive
    let in_bounds = @vec.dabs(p.z) <= z_reach
    if spare >= 0.05 && in_bounds {
      let u = -@vec.dabs(p.y - @physics.ideal_contact_h) + @vec.dmin(spare, 0.6) * 0.5
      if u > best_u {
        best_u = u
        best = Some(p)
      }
    } else {
      let bad = (if in_bounds { 0.0 } else { 10.0 }) + @vec.dmax(0.0, -spare)
      if bad < fallback_bad {
        fallback_bad = bad
        fallback = Some(p)
      }
    }
  }
  match best {
    Some(_) => best
    None => fallback
  }
}

///|
fn seek(from_x : Double, from_z : Double, to_x : Double, to_z : Double, deadzone : Double) -> (Double, Double) {
  let dx = to_x - from_x
  let dz = to_z - from_z
  let d = @vec.hypot2(dx, dz)
  if d < deadzone {
    return (0.0, 0.0)
  }
  let soft = @vec.dmin(d / 0.8, 1.0)
  (dx / d * soft, dz / d * soft)
}

// Called every fixed step during RALLY when the CPU may play the ball.
///|
pub fn update_ai(ai : Ai, ctx : AiCtx, rng : @rng.Gauss) -> AiMove {
  let ball = ctx.ball
  let no_swing : AiMove = { x: 0.0, z: 0.0, swing: false, swing_type: Flat, swing_aim_x: 0.0, swing_aim_depth: 0.0 }
  let incoming = ball.active && ctx.can_hit
  if !incoming {
    ai.has_pred = false
    ai.pred_stamp = -1
    ai.home_x = @vec.dmax(-2.0, @vec.dmin(2.0, ctx.human_x * -0.2))
    let (mx, mz) = seek(ctx.cpu_x, ctx.cpu_z, ai.home_x, ai.home_z, 0.25)
    return { ..no_swing, x: mx, z: mz }
  }

  // new shot: start reaction clock, draw this shot's read error
  if ai.pred_stamp != ctx.ball_stamp {
    ai.pred_stamp = ctx.ball_stamp
    ai.react_at = ctx.game_time + ai.diff.react * (0.7 + 0.6 * rng.uniform())
    ai.next_predict_at = 0.0
    ai.err_x = rng.draw()
    ai.err_z = rng.draw()
    ai.swing_jitter = rng.draw() * 0.045 * (1.15 - ai.stats.ctl / 100.0) * ai.diff.jitter
    ai.has_pred = false
    ai.has_plan = false
    ai.committed = false
  }

  if ctx.game_time < ai.react_at {
    let (mx, mz) = seek(ctx.cpu_x, ctx.cpu_z, ai.home_x, ai.home_z, 0.25)
    return { ..no_swing, x: mx, z: mz }
  }

  // periodic re-read: error shrinks as the ball nears
  if !ai.committed && ctx.game_time >= ai.next_predict_at {
    ai.next_predict_at = ctx.game_time + 0.25
    if ctx.bounced {
      ai.landing_out = false
    } else {
      match @physics.predict_landing(ball, ctx.surface) {
        Some(l) =>
          ai.landing_out = @vec.dsign(l.z) < 0.0 &&
            (@vec.dabs(l.x) > @physics.court_half_width + @physics.line_grace ||
            @vec.dabs(l.z) > @physics.court_half_len + @physics.line_grace)
        None => ai.landing_out = false
      }
    }
    let pick = if ai.landing_out {
      None
    } else {
      pick_intercept(
        ai,
        ctx,
        @physics.sample_hit_points(
          ball, ctx.surface, -1.0, max_t=6.0, every=0.06, already_bounced=ctx.bounced,
        ),
      )
    }
    match pick {
      Some(p) => {
        let pos_err = 0.7 * (1.0 - ai.stats.ctl / 100.0) * ai.diff.pos_err
        let shrink = @vec.dmax(0.25, @vec.dmin(1.0, p.t / 1.2))
        ai.pred_x = p.x + ai.err_x * pos_err * 0.5 * shrink
        ai.pred_y = p.y
        ai.pred_z = p.z + ai.err_z * pos_err * 0.3 * shrink
        ai.pred_t_abs = ctx.game_time + p.t
        ai.has_pred = true
        if !ai.has_plan {
          let plan = choose_stroke(ai, ctx, p.x, p.z, rng)
          ai.plan_type = plan.type_
          ai.plan_aim_x = plan.aim_x
          ai.plan_aim_depth = plan.aim_depth
          ai.has_plan = true
        }
      }
      None => ai.has_pred = false // ball flying out: let it go
    }
  }

  if !ai.has_pred {
    let (mx, mz) = seek(ctx.cpu_x, ctx.cpu_z, ai.home_x, ai.home_z, 0.25)
    return { ..no_swing, x: mx, z: mz }
  }

  // run to a spot a bit behind/forehand of the strike point
  let stand_x = @vec.dmax(
    @physics.player_x_min,
    @vec.dmin(@physics.player_x_max, ai.pred_x + 0.55),
  )
  let stand_z = @vec.dmax(
    -@physics.player_z_max,
    @vec.dmin(-@physics.player_z_min, ai.pred_z - 0.35),
  )
  let (mx, mz) = seek(ctx.cpu_x, ctx.cpu_z, stand_x, stand_z, 0.08)
  let mut swing = false
  let lead = 0.18 + ai.swing_jitter
  if !ai.committed && !ctx.cpu_swinging && ctx.game_time >= ai.pred_t_abs - lead {
    swing = true
    ai.committed = true
  }

  // whiff recovery: swing over, ball still live -> re-evaluate
  if ai.committed && !ctx.cpu_swinging && ctx.game_time > ai.pred_t_abs + 0.05 {
    ai.pred_stamp = -1
  }
  {
    x: mx,
    z: mz,
    swing,
    swing_type: ai.plan_type,
    swing_aim_x: ai.plan_aim_x,
    swing_aim_depth: ai.plan_aim_depth,
  }
}
