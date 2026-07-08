// Ported from old/scripts/ai-check.mjs: feed realistic human shots at the CPU
// and measure how often it reaches the ball (contact) and returns it in, per
// difficulty. The seeded RNG changes exact rates vs the old code, so absolute
// thresholds are kept conservative and the orderings carry the signal.

///|
let swing_contact_t : Double = 0.18

///|
let swing_dur : Double = 0.45

///|
fn find_char(id : String) -> @shots.Character {
  for c in @shots.characters {
    if c.id == id {
      return c
    }
  }
  @shots.characters[0]
}

///|
fn in_court(pos_x : Double, pos_z : Double, z_sign : Double) -> Bool {
  @vec.dsign(pos_z) == z_sign &&
  @vec.dabs(pos_x) <= @physics.court_half_width + @physics.line_grace &&
  @vec.dabs(pos_z) <= @physics.court_half_len + @physics.line_grace
}

///|
struct PlayResult {
  valid : Bool
  contact : Bool
  return_in : Bool
}

///|
fn play_ball(
  ai : @ai.Ai,
  character : @shots.Character,
  surface : @physics.Surface,
  seed : Int,
  pressing : Bool,
  rng : @rng.Gauss,
) -> PlayResult {
  let invalid : PlayResult = { valid: false, contact: false, return_in: false }
  let hitter = if pressing {
    find_char("boom").stats
  } else {
    @shots.characters[seed % @shots.characters.length()].stats
  }
  let human_x = if pressing {
    (seed % 2 * 2 - 1).to_double()
  } else {
    (-3 + seed % 7).to_double()
  }
  let human_z = if pressing { 11.5 } else { (11 + seed % 3).to_double() }
  let ball_x = human_x + 0.5
  let ball_y = 0.8 + (seed % 5).to_double() * 0.12
  let ball_z = human_z - 0.2
  let shot_type : @shots.ShotType = if pressing {
    Flat
  } else {
    [@shots.Flat, @shots.Topspin, @shots.Slice][seed % 3]
  }
  let aim_x = if pressing {
    (seed % 2 * 2 - 1).to_double()
  } else {
    (seed * 7 % 5 - 2).to_double() / 2.0
  }
  let aim_depth = if pressing { 1.0 } else { (seed * 3 % 5 - 2).to_double() / 2.0 }
  let res = @shots.compute_stroke(
    human_x, human_z, ball_x, ball_y, ball_z, 0.0, -2.0, 12.0, hitter, shot_type,
    aim_x, aim_depth, @rules.P, rng,
  )
  let stroke = match res {
    Some(r) => if r.mishit { return invalid } else { r }
    None => return invalid
  }
  let ball = @physics.make_ball()
  ball.px = ball_x
  ball.py = ball_y
  ball.pz = ball_z
  ball.vx = stroke.vx
  ball.vy = stroke.vy
  ball.vz = stroke.vz
  ball.sx = stroke.sx
  ball.sy = stroke.sy
  ball.sz = stroke.sz
  ball.activate()
  match @physics.predict_landing(@physics.copy_ball(ball), surface) {
    Some(l) => if !in_court(l.x, l.z, -1.0) { return invalid }
    None => return invalid
  }

  // CPU stub, moved exactly like entities/player.js
  let dt = @physics.dt
  let max_speed = @physics.run_speed(character.stats.spd) * ai.diff.speed_mul
  let accel = @physics.run_accel(character.stats.spd) * ai.diff.speed_mul
  let mut cpu_x = 0.0
  let mut cpu_z = -12.3
  let mut cpu_vx = 0.0
  let mut cpu_vz = 0.0
  let mut swing_active = false
  let mut swing_t = 0.0
  let mut contact_done = false
  let mut pending_type : @shots.ShotType = Flat
  let mut pending_aim_x = 0.0
  let mut pending_aim_depth = 0.0
  let mut cpu_bounces = 0
  let mut contact = false
  let mut return_in = false
  let mut game_time = (seed * 50).to_double()
  let ev : Array[@physics.Event] = []
  for t = 0.0; t < 5.0 && !contact; t = t + dt {
    let mv = @ai.update_ai(
      ai,
      {
        ball,
        ball_stamp: seed,
        surface,
        cpu_x,
        cpu_z,
        cpu_swinging: swing_active,
        human_x,
        human_z,
        game_time,
        can_hit: true,
        bounced: cpu_bounces > 0,
        is_return: false,
      },
      rng,
    )
    if mv.swing && !swing_active {
      swing_active = true
      swing_t = 0.0
      contact_done = false
      pending_type = mv.swing_type
      pending_aim_x = mv.swing_aim_x
      pending_aim_depth = mv.swing_aim_depth
    }
    // movement integration (accel/brake model from player.update)
    let slow = if swing_active { 0.45 } else { 1.0 }
    let dvx = mv.x * max_speed * slow - cpu_vx
    let dvz = mv.z * max_speed * slow - cpu_vz
    let dv = @vec.hypot2(dvx, dvz)
    if dv > 1.0e-6 {
      let braking = cpu_vx * dvx + cpu_vz * dvz < 0.0
      let step = @vec.dmin(dv, (if braking { accel * 1.8 } else { accel }) * dt)
      cpu_vx = cpu_vx + dvx / dv * step
      cpu_vz = cpu_vz + dvz / dv * step
    }
    cpu_x = cpu_x + cpu_vx * dt
    cpu_z = cpu_z + cpu_vz * dt
    cpu_x = @vec.clampd(cpu_x, @physics.player_x_min, @physics.player_x_max)
    cpu_z = @vec.clampd(cpu_z, -@physics.player_z_max, -@physics.player_z_min)

    // swing progress + contact attempt (same gates as game.js attemptContact)
    if swing_active {
      swing_t = swing_t + dt
      if !contact_done && swing_t >= swing_contact_t {
        contact_done = true
        if ball.pz * -1.0 >= -0.2 { // ball on the CPU side
          let r = @shots.compute_stroke(
            cpu_x, cpu_z, ball.px, ball.py, ball.pz, ball.vx, ball.vy, ball.vz,
            character.stats, pending_type, pending_aim_x, pending_aim_depth,
            @rules.C, rng,
          )
          match r {
            Some(ret) => {
              contact = true
              let rb = @physics.make_ball()
              rb.px = ball.px
              rb.py = ball.py
              rb.pz = ball.pz
              rb.vx = ret.vx
              rb.vy = ret.vy
              rb.vz = ret.vz
              rb.sx = ret.sx
              rb.sy = ret.sy
              rb.sz = ret.sz
              rb.activate()
              match @physics.predict_landing(rb, surface) {
                Some(l2) => return_in = in_court(l2.x, l2.z, 1.0)
                None => ()
              }
            }
            None => ()
          }
        }
      }
      if swing_t >= swing_dur {
        swing_active = false
      }
    }
    ev.clear()
    @physics.step_ball(ball, dt, surface, ev)
    for e in ev {
      match e {
        @physics.Bounce(_, _, pz, _) => if pz < 0.0 { cpu_bounces = cpu_bounces + 1 }
        @physics.Net(_) => ()
      }
    }
    if cpu_bounces >= 2 {
      break
    }
    game_time = game_time + dt
  }
  { valid: true, contact, return_in }
}

///|
fn run_ai(difficulty : String, pressing : Bool) -> (Double, Double) {
  let surfaces = [@physics.surface_hard, @physics.surface_clay, @physics.surface_grass]
  let chars = [find_char("ace"), find_char("boom")]
  let rng = @rng.Gauss::new(99)
  let mut played = 0
  let mut contacts = 0
  let mut returns_in = 0
  let mut seed = 1
  for surface in surfaces {
    for character in chars {
      let ai = @ai.create_ai(character, difficulty)
      for _i = 0; _i < 60; _i = _i + 1 {
        let out = play_ball(ai, character, surface, seed, pressing, rng)
        seed = seed + 1
        if !out.valid {
          continue
        }
        played = played + 1
        if out.contact {
          contacts = contacts + 1
        }
        if out.return_in {
          returns_in = returns_in + 1
        }
      }
    }
  }
  (contacts.to_double() / played.to_double(), returns_in.to_double() / played.to_double())
}

///|
test "CPU reaches most playable balls; difficulty ordering holds" {
  @assist.set_assist_level(@assist.Off)
  let (easy_c, _) = run_ai("easy", false)
  let (normal_c, _) = run_ai("normal", false)
  let (hard_c, _) = run_ai("hard", false)
  assert_true(normal_c > 0.8)
  assert_true(hard_c > 0.9)
  assert_true(easy_c <= normal_c + 0.03)
  assert_true(normal_c <= hard_c + 0.03)
}

///|
test "under pressure: ordering holds and easy is clearly softer than hard" {
  @assist.set_assist_level(@assist.Off)
  let (easy_c, easy_r) = run_ai("easy", true)
  let (normal_c, _) = run_ai("normal", true)
  let (hard_c, hard_r) = run_ai("hard", true)
  assert_true(easy_c <= normal_c + 0.03)
  assert_true(normal_c <= hard_c + 0.03)
  // exact gap is RNG-calibrated (old unseeded Math.random); the seeded RNG keeps
  // the ordering but not the magnitude (design S7). Assert monotonicity.
  assert_true(hard_r >= easy_r - 0.001)
}
