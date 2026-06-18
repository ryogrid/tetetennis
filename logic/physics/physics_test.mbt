// Ported from old/scripts/physics-check.mjs. Validates the canonical (assist-off)
// physics balance. Inequality bands hold on both backends; exact JS-vs-old parity
// is checked on --target js.

///|
struct FireResult {
  has_bounce : Bool
  apex : Double // post-bounce apex
  flight_apex : Double // pre-bounce arc apex
  descent_deg : Double // descent angle just before the bounce
  pre_speed_h : Double
  pre_speed_3d : Double
  post_speed_h : Double
  retention : Double
}

///|
fn fire_and_bounce(
  surface : Surface,
  speed : Double,
  spin_rpm : Double,
  theta_min : Double,
  theta_max : Double,
  target_z : Double,
) -> FireResult {
  let solved = solve_shot(
    from_x=0.0,
    from_y=1.0,
    from_z=11.5,
    target_x=0.0,
    target_z~,
    speed~,
    spin_rad_s=spin_rpm * rpm_to_rads,
    theta_min_deg=theta_min,
    theta_max_deg=theta_max,
  )
  let b = make_ball()
  b.px = 0.0
  b.py = 1.0
  b.pz = 11.5
  b.vx = solved.vx
  b.vy = solved.vy
  b.vz = solved.vz
  b.sx = solved.sx
  b.sy = solved.sy
  b.sz = solved.sz
  b.activate()
  let step = 1.0 / 240.0
  let ev : Array[Event] = []
  let mut has_bounce = false
  let mut pre_speed_h = 0.0
  let mut pre_vy = 0.0
  let mut post_speed_h = 0.0
  let mut apex = 0.0
  let mut flight_apex = 0.0
  for t = 0.0; t < 4.0; t = t + step {
    if !has_bounce {
      pre_speed_h = @vec.hypot2(b.vx, b.vz)
      pre_vy = b.vy
      flight_apex = @vec.dmax(flight_apex, b.py)
    }
    ev.clear()
    step_ball(b, step, surface, ev)
    let mut bounced_now = false
    for e in ev {
      match e {
        Bounce(_, _, _, _) => bounced_now = true
        Net(_) => ()
      }
    }
    if bounced_now && !has_bounce {
      has_bounce = true
      post_speed_h = @vec.hypot2(b.vx, b.vz) // capture at the bounce frame
    } else if has_bounce {
      apex = @vec.dmax(apex, b.py)
      if b.vy < 0.0 && b.py < 0.05 {
        break
      }
      if bounced_now {
        break
      } // second bounce
    }
  }
  let descent_deg = if has_bounce {
    @math.atan2(@vec.dabs(pre_vy), pre_speed_h) * 180.0 / @math.PI
  } else {
    0.0
  }
  let pre_speed_3d = if has_bounce {
    @vec.hypot2(pre_speed_h, pre_vy)
  } else {
    0.0
  }
  {
    has_bounce,
    apex,
    flight_apex,
    descent_deg,
    pre_speed_h,
    pre_speed_3d,
    post_speed_h,
    retention: if has_bounce { post_speed_h / pre_speed_h } else { 0.0 },
  }
}

///|
fn drop_apex(h0 : Double, surface : Surface) -> Double {
  let b = make_ball()
  b.px = 0.0
  b.py = h0
  b.pz = 0.0
  b.activate()
  let step = 1.0 / 240.0
  let ev : Array[Event] = []
  let mut bounced = false
  let mut apex = 0.0
  for t = 0.0; t < 4.0; t = t + step {
    ev.clear()
    step_ball(b, step, surface, ev)
    let mut bounced_now = false
    for e in ev {
      match e {
        Bounce(_, _, _, _) => bounced_now = true
        Net(_) => ()
      }
    }
    if bounced_now {
      if bounced {
        break
      }
      bounced = true
    } else if bounced {
      apex = @vec.dmax(apex, b.py)
      if b.vy < 0.0 {
        break
      }
    }
  }
  apex
}

///|
fn land_z(
  speed : Double,
  spin_rpm : Double,
  theta_min : Double,
  theta_max : Double,
  target_z : Double,
  zero_spin : Bool,
) -> Double {
  let solved = solve_shot(
    from_x=0.0,
    from_y=1.0,
    from_z=11.5,
    target_x=0.0,
    target_z~,
    speed~,
    spin_rad_s=spin_rpm * rpm_to_rads,
    theta_min_deg=theta_min,
    theta_max_deg=theta_max,
  )
  let b = make_ball()
  b.px = 0.0
  b.py = 1.0
  b.pz = 11.5
  b.vx = solved.vx
  b.vy = solved.vy
  b.vz = solved.vz
  if !zero_spin {
    b.sx = solved.sx
    b.sy = solved.sy
    b.sz = solved.sz
  }
  b.activate()
  match predict_landing(b, surface_hard) {
    Some(l) => l.z
    None => 0.0
  }
}

///|
test "shot solver accuracy: flat 33 m/s lands within 1 m and crosses the net" {
  let solved = solve_shot(
    from_x=0.0,
    from_y=1.0,
    from_z=11.5,
    target_x=0.0,
    target_z=-10.3,
    speed=33.0,
    spin_rad_s=500.0 * rpm_to_rads,
    theta_min_deg=1.0,
    theta_max_deg=14.0,
  )
  let b = make_ball()
  b.px = 0.0
  b.py = 1.0
  b.pz = 11.5
  b.vx = solved.vx
  b.vy = solved.vy
  b.vz = solved.vz
  b.sx = solved.sx
  b.sy = solved.sy
  b.sz = solved.sz
  b.activate()
  let l = predict_landing(b, surface_hard).unwrap()
  let err = @vec.hypot2(l.x - 0.0, l.z - -10.3)
  assert_true(err < 1.0)
  assert_true(l.z < 0.0)
}

///|
test "restitution: ITF drop test + speed dependence" {
  let reb = drop_apex(2.54, surface_hard)
  assert_true(reb > 1.30 && reb < 1.50)
  assert_true(drop_apex(2.54, surface_clay) > reb && reb > drop_apex(2.54, surface_grass))
  let e_slow = effective_ey(surface_hard.ey, 7.1)
  let e_fast = effective_ey(surface_hard.ey, 20.0)
  assert_true(e_fast < e_slow * 0.9)
  assert_true(effective_ey(surface_grass.ey, 60.0) >= 0.4)
}

///|
test "shot-type contrast (flat/topspin/slice, hard court)" {
  let flat = fire_and_bounce(surface_hard, 21.4, 500.0, 0.0, 16.0, -6.0)
  let top = fire_and_bounce(surface_hard, 21.4 * 0.85, 4070.0, 10.0, 32.0, -8.0)
  let sli = fire_and_bounce(surface_hard, 21.4 * 0.76, -2800.0, 1.0, 16.0, -6.0)
  assert_true(flat.pre_speed_h > top.pre_speed_h * 1.10)
  assert_true(top.pre_speed_3d >= sli.pre_speed_3d * 0.97)
  assert_true(top.flight_apex > flat.flight_apex + 0.5)
  assert_true(top.apex >= sli.apex * 1.5)
  assert_true(sli.post_speed_h < top.post_speed_h)
  assert_true(top.descent_deg > flat.descent_deg + 8.0)
  assert_true(sli.descent_deg < top.descent_deg - 4.0)
  assert_true(sli.flight_apex < top.flight_apex - 0.4)
}

///|
test "Magnus: topspin dips, backspin stretches" {
  let top_dip = land_z(21.4 * 0.85, 4070.0, 10.0, 32.0, -8.0, true) -
    land_z(21.4 * 0.85, 4070.0, 10.0, 32.0, -8.0, false)
  let sli_carry = land_z(21.4 * 0.76, -2800.0, 1.0, 16.0, -6.0, true) -
    land_z(21.4 * 0.76, -2800.0, 1.0, 16.0, -6.0, false)
  assert_true(top_dip < -2.5)
  assert_true(sli_carry > 1.2) // backspin extends range (solver change adjusts value)
}

///|
test "surface behavior: pace + bounce-height ordering" {
  let flat = (17.9, 500.0, 1.0, 14.0, -10.0)
  let hard = fire_and_bounce(surface_hard, flat.0, flat.1, flat.2, flat.3, flat.4)
  let clay = fire_and_bounce(surface_clay, flat.0, flat.1, flat.2, flat.3, flat.4)
  let grass = fire_and_bounce(surface_grass, flat.0, flat.1, flat.2, flat.3, flat.4)
  assert_true(grass.retention > hard.retention + 0.05)
  assert_true(hard.retention >= clay.retention - 0.005)
  assert_true(clay.apex > hard.apex && hard.apex > grass.apex)
  assert_true(grass.retention > 0.72)
  assert_true(clay.retention < 0.70)
}

///|
test "serve plausibility: flat serve lands in the service box" {
  let solved = solve_shot(
    from_x=0.35,
    from_y=2.95,
    from_z=11.9,
    target_x=-0.45,
    target_z=-5.85,
    speed=35.2,
    spin_rad_s=400.0 * rpm_to_rads,
    theta_min_deg=-6.0,
    theta_max_deg=4.0,
  )
  let b = make_ball()
  b.px = 0.35
  b.py = 2.95
  b.pz = 11.9
  b.vx = solved.vx
  b.vy = solved.vy
  b.vz = solved.vz
  b.sx = solved.sx
  b.sy = solved.sy
  b.sz = solved.sz
  b.activate()
  let l = predict_landing(b, surface_hard).unwrap()
  assert_true(
    @vec.dabs(l.x) < court_half_width &&
    l.z < 0.0 &&
    l.z > -court_service_line - 0.05,
  )
}

///|
test "pace: slowed base speeds are not re-inflated by the solver" {
  // (speed, spinRpm, thetaMin, thetaMax, targetZ)
  let shots = [
    (21.4, 500.0, 0.0, 16.0, -6.0),
    (21.4 * 0.85, 4070.0, 10.0, 32.0, -8.0),
    (21.4 * 0.76, -2800.0, 1.0, 16.0, -5.0),
    (35.2, 400.0, -6.0, 4.0, -5.85),
  ]
  for s in shots {
    let from_z = if s.0 > 30.0 { 11.9 } else { 11.5 }
    let from_x = if s.0 > 30.0 { 0.35 } else { 0.0 }
    let from_y = if s.0 > 30.0 { 2.95 } else { 1.0 }
    let target_x = if s.0 > 30.0 { -0.45 } else { 0.0 }
    let solved = solve_shot(
      from_x~,
      from_y~,
      from_z~,
      target_x~,
      target_z=s.4,
      speed=s.0,
      spin_rad_s=s.1 * rpm_to_rads,
      theta_min_deg=s.2,
      theta_max_deg=s.3,
    )
    assert_true(solved.speed <= s.0 * 1.001)
  }
}

///|
test "trajectory sampling: ordered, both phases, bounce time matches landing" {
  let solved = solve_shot(
    from_x=0.0,
    from_y=1.0,
    from_z=-11.5,
    target_x=0.0,
    target_z=9.8,
    speed=27.0,
    spin_rad_s=2800.0 * rpm_to_rads,
    theta_min_deg=10.0,
    theta_max_deg=32.0,
  )
  let b = make_ball()
  b.px = 0.0
  b.py = 1.0
  b.pz = -11.5
  b.vx = solved.vx
  b.vy = solved.vy
  b.vz = solved.vz
  b.sx = solved.sx
  b.sy = solved.sy
  b.sz = solved.sz
  b.activate()
  let landing = predict_landing(b, surface_hard).unwrap()
  let traj = predict_trajectory(b, surface_hard, 1.0)
  let mut ordered = true
  let mut prev_t = -1.0
  let mut pre = 0
  let mut post = 0
  for p in traj.points {
    if p.t <= prev_t {
      ordered = false
    }
    prev_t = p.t
    if p.after_bounce {
      post = post + 1
    } else {
      pre = pre + 1
    }
  }
  assert_true(ordered && pre > 5 && post > 5)
  assert_true(traj.has_bounce && @vec.dabs(traj.bounce_t - landing.t) < 0.05)
}
