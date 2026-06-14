// Ported from old/scripts/physics-check.mjs (stroke + serve sections).
// Canonical assist-off balance; Monte-Carlo means use a fixed seed.

///|
let test_stats : Stats = { pow: 70, spn: 70, slc: 60, srv: 60, spd: 60, ctl: 70, rea: 60, net: 45 }

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

// Mean launch speed + landing depth (past the net) of a stroke type hit from a
// given contact depth; n counts samples that cleared into the opponent court.
///|
fn mean_stroke_typ(typ : ShotType, contact_z : Double) -> (Double, Double, Int) {
  let g = @rng.Gauss::new(999)
  let mut speed_sum = 0.0
  let mut depth_sum = 0.0
  let mut n = 0
  for _i = 0; _i < 300; _i = _i + 1 {
    let res = compute_stroke(
      0.0, contact_z, 0.5, @physics.ideal_contact_h, contact_z, 0.0, 2.0, 8.0,
      test_stats, typ, 0.0, 0.0, @rules.P, g,
    )
    match res {
      Some(r) =>
        if r.shot_type == typ {
          let b = @physics.make_ball()
          b.px = 0.5
          b.py = @physics.ideal_contact_h
          b.pz = contact_z
          b.vx = r.vx
          b.vy = r.vy
          b.vz = r.vz
          b.sx = r.sx
          b.sy = r.sy
          b.sz = r.sz
          b.activate()
          match @physics.predict_landing(b, @physics.surface_hard) {
            Some(l) =>
              if l.z < 0.0 {
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
  let nn = if n == 0 { 1 } else { n }
  (speed_sum / nn.to_double(), depth_sum / nn.to_double(), n)
}

///|
test "drop shot: slower and lands shorter than a slice, and clears into court" {
  @assist.set_assist_level(Off)
  // hit from a forecourt contact (z=6), where a drop is realistically played
  let (drop_speed, drop_depth, drop_n) = mean_stroke_typ(Drop, 6.0)
  let (slice_speed, slice_depth, slice_n) = mean_stroke_typ(Slice, 6.0)
  assert_true(drop_n > 250) // the drop reliably clears the net into the court
  assert_true(slice_n > 250)
  assert_true(drop_speed < slice_speed) // drop is the slowest stroke
  assert_true(drop_depth < slice_depth - 1.0) // and lands clearly shorter
  assert_true(drop_depth < 5.0) // dies near the front of the court
}

// Output launch speed of a stroke at a given charge power_mul / perfect flag,
// from an ideal forecourt contact (q ~ 1) with a fixed seed.
///|
fn charged_stroke(
  power_mul : Double,
  perfect_eligible : Bool,
) -> (Double, Bool) {
  let r = compute_stroke(
    0.0, 6.0, 0.5, @physics.ideal_contact_h, 6.0, 0.0, 2.0, 6.0, test_stats, Flat,
    0.0, 0.0, @rules.P, @rng.Gauss::new(3), power_mul~, perfect_eligible~,
  )
  match r {
    Some(s) => (@vec.hypot3(s.vx, s.vy, s.vz), s.perfect)
    None => (0.0, false)
  }
}

///|
test "charge: full power is much faster than no charge; perfect adds a bonus" {
  @assist.set_assist_level(Off)
  let (lo, _) = charged_stroke(0.85, false) // tap, no charge
  let (hi, _) = charged_stroke(1.25, false) // full + overcharge power
  assert_true(hi > lo * 1.4) // power 0.85 -> 1.25 is ~+47%
  // same power, same seed: a Perfect Hit on an ideal contact adds ~8% speed
  let (plain, plain_pf) = charged_stroke(1.0, false)
  let (perf, perf_pf) = charged_stroke(1.0, true)
  assert_true(!plain_pf)
  assert_true(perf_pf) // ideal contact (q ~ 1) qualifies for Perfect
  assert_true(perf > plain * 1.05)
}

// Fraction of topspin shots that land in the opponent court at a given
// overcharge, hit from the baseline.
///|
fn overcharge_in_rate(oc : Double) -> Double {
  let g = @rng.Gauss::new(555)
  let mut inn = 0
  let mut tot = 0
  for _i = 0; _i < 200; _i = _i + 1 {
    // aim deep (toward the baseline) so the overcharge spray pushes balls out
    let r = compute_stroke(
      0.0, 11.2, 0.5, @physics.ideal_contact_h, 11.0, 0.0, 2.0, 8.0, test_stats,
      Topspin, 0.0, 1.0, @rules.P, g, power_mul=1.0, overcharge=oc,
    )
    match r {
      Some(s) => {
        tot = tot + 1
        let b = @physics.make_ball()
        b.px = 0.5
        b.py = @physics.ideal_contact_h
        b.pz = 11.0
        b.vx = s.vx
        b.vy = s.vy
        b.vz = s.vz
        b.sx = s.sx
        b.sy = s.sy
        b.sz = s.sz
        b.activate()
        match @physics.predict_landing(b, @physics.surface_hard) {
          Some(l) =>
            if l.z < 0.0 &&
              -l.z <= @physics.court_half_len + 0.1 &&
              @vec.dabs(l.x) <= @physics.court_half_width + 0.1 {
              inn = inn + 1
            }
          None => ()
        }
      }
      None => ()
    }
  }
  inn.to_double() / (if tot == 0 { 1 } else { tot }).to_double()
}

///|
test "overcharge sprays the ball: fewer land in than a clean hit" {
  @assist.set_assist_level(Off)
  let clean = overcharge_in_rate(0.0)
  let over = overcharge_in_rate(0.25)
  assert_true(clean > over) // overcharge lowers the in-rate (more faults)
  assert_true(over < 0.99) // and produces real out/net errors
}

// Landing point of a single charged stroke from the baseline (fixed seed).
///|
fn landing_of(
  typ : ShotType,
  ball_y : Double,
  aim_x : Double,
  cc : Double,
) -> (Double, Double) {
  let r = compute_stroke(
    0.0, 11.2, 0.5, ball_y, 11.0, 0.0, 2.0, 6.0, test_stats, typ, aim_x, 0.0,
    @rules.P, @rng.Gauss::new(11), power_mul=1.0, charge_cc=cc,
  )
  match r {
    Some(s) => {
      let b = @physics.make_ball()
      b.px = 0.5
      b.py = ball_y
      b.pz = 11.0
      b.vx = s.vx
      b.vy = s.vy
      b.vz = s.vz
      b.sx = s.sx
      b.sy = s.sy
      b.sz = s.sz
      b.activate()
      match @physics.predict_landing(b, @physics.surface_hard) {
        Some(l) => (l.x, l.z)
        None => (0.0, 0.0)
      }
    }
    None => (0.0, 0.0)
  }
}

///|
test "slice charge extends depth toward the baseline" {
  @assist.set_assist_level(Off)
  let (_, z0) = landing_of(Slice, @physics.ideal_contact_h, 0.0, 0.0)
  let (_, z1) = landing_of(Slice, @physics.ideal_contact_h, 0.0, 1.0)
  // P hits toward -z; deeper landing = larger -z
  assert_true(-z1 > -z0 + 1.0)
}

///|
test "topspin charge short-angle attack: pulls shorter and wider" {
  @assist.set_assist_level(Off)
  // high, angled, slow-pace contact -> the attack triggers at full charge
  let (x0, z0) = landing_of(Topspin, 1.2, 1.0, 0.0)
  let (x1, z1) = landing_of(Topspin, 1.2, 1.0, 1.0)
  assert_true(-z1 < -z0 - 2.0) // clearly shorter (toward the service line)
  assert_true(@vec.dabs(x1) > @vec.dabs(x0)) // and pulled wider cross-court
}

// Launch speed + smash flag of a Flat stroke at a given contact height/depth.
///|
fn flat_stroke(ball_y : Double, ball_z : Double) -> (Double, Bool) {
  let r = compute_stroke(
    0.0, ball_z + 0.2, 0.5, ball_y, ball_z, 0.0, 2.0, 6.0, test_stats, Flat, 0.0,
    0.0, @rules.P, @rng.Gauss::new(5),
  )
  match r {
    Some(s) => (@vec.hypot3(s.vx, s.vy, s.vz), s.smash)
    None => (0.0, false)
  }
}

///|
test "smash: a high forecourt flat is much faster than a high baseline flat" {
  @assist.set_assist_level(Off)
  let (sm_sp, sm_f) = flat_stroke(1.8, 6.0) // high point, forecourt -> smash
  let (bl_sp, bl_f) = flat_stroke(1.8, 11.0) // high point, baseline -> weak flat
  assert_true(sm_f) // forecourt overhead is a smash
  assert_true(!bl_f) // the baseline high ball is not
  assert_true(sm_sp > bl_sp * 1.4) // and the smash is far faster
}

// Mean launch speed and mean |landing x| of a forecourt Flat, with/without the
// volley block. aim_x = 0, so tighter landings cluster nearer x = 0.
///|
fn volley_profile(volley : Bool) -> (Double, Double, Bool) {
  let g = @rng.Gauss::new(77)
  let mut sum_speed = 0.0
  let mut sum_absx = 0.0
  let mut n = 0
  let mut flag = false
  for _i = 0; _i < 150; _i = _i + 1 {
    let r = compute_stroke(
      0.0, 5.0, 0.5, 1.0, 4.5, 0.0, 2.0, 10.0, test_stats, Flat, 0.0, 0.0,
      @rules.P, g, volley~,
    )
    match r {
      Some(s) => {
        flag = s.volley
        let b = @physics.make_ball()
        b.px = 0.5
        b.py = 1.0
        b.pz = 4.5
        b.vx = s.vx
        b.vy = s.vy
        b.vz = s.vz
        b.sx = s.sx
        b.sy = s.sy
        b.sz = s.sz
        b.activate()
        match @physics.predict_landing(b, @physics.surface_hard) {
          Some(l) => {
            sum_speed = sum_speed + @vec.hypot3(s.vx, s.vy, s.vz)
            sum_absx = sum_absx + @vec.dabs(l.x)
            n = n + 1
          }
          None => ()
        }
      }
      None => ()
    }
  }
  let nn = (if n == 0 { 1 } else { n }).to_double()
  (sum_speed / nn, sum_absx / nn, flag)
}

///|
test "volley: restrained power but tighter aim than a groundstroke" {
  @assist.set_assist_level(Off)
  let (sp_v, ax_v, f_v) = volley_profile(true)
  let (sp_n, ax_n, f_n) = volley_profile(false)
  assert_true(f_v && !f_n) // the flag reflects the volley
  assert_true(sp_v < sp_n) // restrained block is slower
  assert_true(ax_v < ax_n) // and lands tighter to the aimed line
}

// Whether a stroke off an incoming ball of the given pace gets jam-mishit, hit
// from an ideal contact with no charge prep.
///|
fn jam_mishit(typ : ShotType, in_pace : Double) -> Bool {
  let r = compute_stroke(
    0.0, 11.2, 0.65, @physics.ideal_contact_h, 11.0, 0.0, 0.0, in_pace,
    test_stats, typ, 0.0, 0.0, @rules.P, @rng.Gauss::new(9),
  )
  match r {
    Some(s) => s.mishit
    None => false
  }
}

///|
fn flat_jam_speed(cc : Double) -> Double {
  let r = compute_stroke(
    0.0, 11.2, 0.65, @physics.ideal_contact_h, 11.0, 0.0, 0.0, 42.0, test_stats,
    Flat, 0.0, 0.0, @rules.P, @rng.Gauss::new(9), power_mul=1.0, charge_cc=cc,
  )
  match r {
    Some(s) => @vec.hypot3(s.vx, s.vy, s.vz)
    None => 0.0
  }
}

///|
test "fast-ball jam: topspin jams off pace, a slice blocks it, slow balls are fine" {
  @assist.set_assist_level(Off)
  assert_true(jam_mishit(Topspin, 42.0)) // a full topspin swing breaks down
  assert_true(!jam_mishit(Slice, 42.0)) // a slice block handles the pace
  assert_true(!jam_mishit(Topspin, 10.0)) // normal rally pace never jams
  // charging up the same shot against the same fast ball tames the jam
  assert_true(flat_jam_speed(1.0) > flat_jam_speed(0.0))
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

// Serve: simulate compute_serve from C's side, return (net clearance, in-box,
// launch speed). power is the meter value; seed varies the error draw.
///|
fn serve_flight_p(
  type_ : ServeType,
  power : Double,
  seed : Int,
  ctl~ : Double = 95.0,
) -> (Double, Bool, Double) {
  @assist.set_assist_level(Off)
  let stats : Stats = { pow: 74, spn: 70, slc: 60, srv: 85, spd: 60, ctl, rea: 70, net: 45 }
  let g = @rng.Gauss::new(seed)
  let s = compute_serve(
    stats, type_, -0.35, 2.95, -11.9, @rules.C, Deuce, Body, 0.0, 0.0, power, g,
  )
  let launch = @vec.hypot3(s.vx, s.vy, s.vz)
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
      return (clearance, in_box, launch)
    }
  }
  (clearance, false, launch)
}

///|
fn serve_flight(type_ : ServeType) -> (Double, Bool) {
  let r = serve_flight_p(type_, 0.8, 7)
  (r.0, r.1)
}

///|
fn serve_in_rate(power : Double) -> Double {
  let mut inn = 0
  for s = 1; s < 41; s = s + 1 {
    // a mid-control server so the band's accuracy actually matters
    let r = serve_flight_p(ServeFlat, power, s, ctl=58.0)
    if r.1 {
      inn = inn + 1
    }
  }
  inn.to_double() / 40.0
}

///|
test "serve power meter: more power is faster; overpower sprays out of the box" {
  @assist.set_assist_level(Off)
  let slow = serve_flight_p(ServeFlat, 0.5, 7).2
  let fast = serve_flight_p(ServeFlat, 0.88, 7).2
  // more meter power = faster (the box geometry caps the top end ~47 m/s)
  assert_true(fast > slow * 1.05)
  assert_true(serve_in_rate(0.80) > serve_in_rate(1.0)) // sweet > overpower accuracy
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
