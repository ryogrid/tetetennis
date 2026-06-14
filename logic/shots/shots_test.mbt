// Ported from old/scripts/physics-check.mjs (stroke + serve sections).
// Canonical assist-off balance; Monte-Carlo means use a fixed seed.

///|
let test_stats : Stats = { pow: 70, spn: 70, slc: 60, srv: 60, spd: 60, ctl: 70, rea: 60 }

// Mean launch speed + landing depth of a topspin stroke as the ball distance
// (ball_x) moves from the ideal band out toward the reach limit.
///|
fn mean_stroke(ball_x : Double) -> (Double, Double) {
  let g = @rng.Gauss::new(12345)
  let mut speed_sum = 0.0
  let mut depth_sum = 0.0
  let mut n = 0
  for _i = 0; _i < 300; _i = _i + 1 {
    let res = compute_stroke(
      0.0, 11.2, ball_x, 1.0, 11.0, 0.0, -3.0, 14.0, test_stats, Topspin, 0.0,
      0.0, @rules.P, g,
    )
    match res {
      Some(r) =>
        if r.shot_type == Topspin {
          let b = @physics.make_ball()
          b.px = ball_x
          b.py = 1.0
          b.pz = 11.0
          b.vx = r.vx
          b.vy = r.vy
          b.vz = r.vz
          b.sx = r.sx
          b.sy = r.sy
          b.sz = r.sz
          b.activate()
          match @physics.predict_landing(b, @physics.surface_hard) {
            Some(l) =>
              if l.z <= 0.0 {
                speed_sum = speed_sum + @vec.hypot3(r.vx, r.vy, r.vz)
                depth_sum = depth_sum + -l.z
                n = n + 1
              }
            None => ()
          }
        }
      None => ()
    }
  }
  (speed_sum / n.to_double(), depth_sum / n.to_double())
}

///|
test "contact quality sensitivity: stretched contact is slower and shorter" {
  @assist.set_assist_level(Off)
  let (clean_speed, clean_depth) = mean_stroke(0.5)
  let (str_speed, str_depth) = mean_stroke(1.60)
  assert_true(str_speed < clean_speed * 0.96)
  assert_true(str_depth < clean_depth - 0.5)
}

///|
test "contact quality: whiff out of reach, full quality in the band" {
  @assist.set_assist_level(Off)
  // far out of reach -> whiff
  let far = contact_quality(0.0, 11.2, 9.0, 1.0, 11.0, 0.0, -3.0, 14.0, test_stats, @rules.C)
  assert_true(far.whiff)
  // ideal: waist height, arm+racket length away, slow ball -> q ~ 1
  let ideal = contact_quality(
    0.0, 11.2, 0.65, @physics.ideal_contact_h, 11.2, 0.0, -1.0, 10.0, test_stats,
    @rules.C,
  )
  assert_true(!ideal.whiff && ideal.q > 0.95)
}

// Serve: simulate compute_serve from C's side, return (net clearance, in-box).
///|
fn serve_flight(type_ : ServeType) -> (Double, Bool) {
  @assist.set_assist_level(Off)
  // high-control server to keep the error term tiny for a deterministic check
  let stats : Stats = { pow: 74, spn: 70, slc: 60, srv: 85, spd: 60, ctl: 95, rea: 70 }
  let g = @rng.Gauss::new(7)
  let s = compute_serve(
    stats, type_, -0.35, 2.95, -11.9, @rules.C, Deuce, Body, 0.0, 0.0, 1.0, g,
  )
  let b = @physics.make_ball()
  b.px = -0.35
  b.py = 2.95
  b.pz = -11.9
  b.vx = s.vx
  b.vy = s.vy
  b.vz = s.vz
  b.sx = s.sx
  b.sy = s.sy
  b.sz = s.sz
  b.activate()
  let ev : Array[@physics.Event] = []
  let mut clearance = 0.0
  let mut got_clearance = false
  let step = 1.0 / 240.0
  for t = 0.0; t < 3.0; t = t + step {
    let z_prev = b.pz
    ev.clear()
    @physics.step_ball(b, step, @physics.surface_hard, ev)
    if !got_clearance && @vec.dsign(b.pz) != @vec.dsign(z_prev) {
      clearance = b.py - @physics.net_height(b.px)
      got_clearance = true
    }
    let mut bounced = false
    let mut bx = 0.0
    let mut bz = 0.0
    for e in ev {
      match e {
        @physics.Bounce(px, _, pz, _) => {
          bounced = true
          bx = px
          bz = pz
        }
        @physics.Net(_) => ()
      }
    }
    if bounced {
      let in_box = is_serve_box_in(bx, bz, @rules.C, Deuce)
      return (clearance, in_box)
    }
  }
  (clearance, false)
}

///|
test "serve shapes: all types land in the box; kick clears the net higher" {
  let fl = serve_flight(ServeFlat)
  let ki = serve_flight(ServeKick)
  let sl = serve_flight(ServeSlice)
  assert_true(fl.1) // flat lands in the service box
  assert_true(ki.1) // kick lands in the service box
  assert_true(sl.1) // slice lands in the service box
  assert_true(ki.0 > fl.0 + 0.4) // kick clears the net much higher than flat
}
