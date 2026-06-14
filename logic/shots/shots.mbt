// Stroke model: shot types, contact quality, stroke computation + error model.
// Ported from old/src/game/shots.js. The seeded RNG (rng~) replaces the old
// global gauss()/Math.random().

///|
pub(all) enum ShotType {
  Flat
  Topspin
  Slice
  Lob
  Drop
} derive(Eq, Show)

// (speed_mul, theta_min_deg, theta_max_deg) per shot type.
// Drop's speed_mul is unused (the Drop branch sets an absolute touch speed,
// like Lob); its high theta band lets a slow ball loft just over the net.
///|
pub fn shot_def(t : ShotType) -> (Double, Double, Double) {
  match t {
    Flat => (1.00, 0.0, 16.0)
    Topspin => (0.85, 10.0, 32.0)
    Slice => (0.76, 1.0, 16.0)
    Lob => (1.00, 28.0, 55.0)
    Drop => (0.50, 26.0, 50.0)
  }
}

// Always-on reach grace for the human (m): connect to slightly out-of-position
// balls (in-reach quality unchanged).
///|
let reach_grace : Double = 0.2

///|
pub(all) struct ContactQuality {
  q : Double
  whiff : Bool
  d : Double
  stretched : Bool
}

// Contact quality q in [0,1] from player/ball geometry. side P = human.
///|
pub fn contact_quality(
  player_x : Double,
  player_z : Double,
  ball_x : Double,
  ball_y : Double,
  ball_z : Double,
  vx : Double,
  vy : Double,
  vz : Double,
  stats : Stats,
  side : @rules.Side,
) -> ContactQuality {
  let d = @vec.hypot2(ball_x - player_x, ball_z - player_z)
  let h = ball_y
  let reach = @physics.reach(stats.rea)
  let human = side == @rules.P
  let reach_eff = reach + (if human { reach_grace } else { 0.0 })
  let h_max = 1.15 + reach_eff
  if d > reach_eff || h > h_max {
    return { q: 0.0, whiff: true, d, stretched: true }
  }
  // assist (human only) widens the forgiving bands; the CPU is never eased
  let aid = human && @assist.assist_on()
  let lo = @physics.ideal_contact_r - 0.35
  let hi = @physics.ideal_contact_r + (if aid { 0.40 } else { 0.25 })
  let q_dist = if d < lo {
    (if aid { 0.70 } else { 0.55 }) + (if aid { 0.30 } else { 0.45 }) * (d / lo)
  } else if d <= hi {
    1.0
  } else {
    @vec.clampd(1.0 - (d - hi) / (reach - hi), 0.0, 1.0)
  }
  let h_flat = if aid { 0.45 } else { 0.3 }
  let h_cap = if aid { 0.40 } else { 0.55 }
  let q_height = 1.0 -
    @vec.clampd(
      (@vec.dabs(h - @physics.ideal_contact_h) - h_flat) / 0.9,
      0.0,
      h_cap,
    )
  let v_in = @vec.hypot3(vx, vy, vz)
  let q_speed = @vec.clampd(
    1.0 - (v_in - 18.0) / 55.0,
    if aid { 0.80 } else { 0.65 },
    1.0,
  )
  let q = q_dist * q_height * q_speed
  { q, whiff: false, d, stretched: d > hi && q_dist < 0.35 }
}

///|
pub(all) struct Stroke {
  vx : Double
  vy : Double
  vz : Double
  sx : Double
  sy : Double
  sz : Double
  q : Double
  mishit : Bool
  perfect : Bool
  shot_type : ShotType
}

// Compute a stroke. side P hits toward -z, C toward +z. aim_depth +1 deep / -1
// short. Returns None on whiff.
///|
pub fn compute_stroke(
  player_x : Double,
  player_z : Double,
  ball_x : Double,
  ball_y : Double,
  ball_z : Double,
  vx : Double,
  vy : Double,
  vz : Double,
  stats : Stats,
  shot_type : ShotType,
  aim_x : Double,
  aim_depth : Double,
  side : @rules.Side,
  rng : @rng.Gauss,
  power_mul~ : Double = 1.0,
  perfect_eligible~ : Bool = false,
  overcharge~ : Double = 0.0,
) -> Stroke? {
  let cq = contact_quality(
    player_x, player_z, ball_x, ball_y, ball_z, vx, vy, vz, stats, side,
  )
  if cq.whiff {
    return None
  }
  let q = cq.q
  let aid = side == @rules.P && @assist.assist_on()
  let mut typ = shot_type
  if cq.stretched && typ != Slice {
    typ = Lob // forced defensive ball
  }
  let z_sign = match side {
    @rules.P => -1.0
    @rules.C => 1.0
  }
  let (def_speed_mul, def_theta_min, def_theta_max) = shot_def(typ)
  let type_z = match typ {
    Flat => 6.5
    Topspin => 8.0
    Slice => 5.5
    Lob => 5.5
    Drop => 2.2 // dies just past the net
  }
  let base_z = type_z - (1.0 - q) * 1.5
  // Drop is allowed to target much shorter than the rally floor of 4.5 m.
  let min_depth = if typ == Drop { 1.5 } else { 4.5 }
  let mut tx = @vec.clampd(aim_x, -1.0, 1.0) * 2.8
  let mut tz = z_sign *
    @vec.clampd(base_z + @vec.clampd(aim_depth, -1.0, 1.0) * 2.4, min_depth, 11.2)
  let flat_speed = @physics.max_flat_speed(stats.pow) * (0.52 + 0.48 * q)
  let mut speed = 0.0
  let mut spin_rpm = 0.0
  match typ {
    Flat => {
      speed = flat_speed
      spin_rpm = 300.0 + 400.0 * q
    }
    Topspin => {
      speed = flat_speed * def_speed_mul
      spin_rpm = @physics.topspin_rpm(stats.spn) * (0.5 + 0.5 * q)
    }
    Slice => {
      speed = flat_speed * def_speed_mul
      spin_rpm = -@physics.slice_rpm(stats.slc) * (0.5 + 0.5 * q)
    }
    Lob => {
      speed = (15.0 + 4.0 * stats.pow / 100.0) * @physics.eff_pace()
      spin_rpm = 500.0
    }
    Drop => {
      // slowest stroke: a backspin touch that floats just over the net and
      // checks on the bounce. Speed scales with slice skill, not power.
      speed = (12.0 + 4.0 * stats.slc / 100.0) * @physics.eff_pace()
      spin_rpm = -@physics.slice_rpm(stats.slc) * (0.55 + 0.45 * q) * 0.9
    }
  }
  // charge: power scales the launch speed; a sweet-spot release (Perfect Hit)
  // adds a modest speed/spin bonus and tightens aim; overcharge sprays the ball.
  let perfect = perfect_eligible && q >= 0.90
  speed = speed * power_mul
  if perfect {
    speed = speed * 1.08
    spin_rpm = spin_rpm * 1.12
  }
  let aim_acc = if perfect { 0.6 } else { 1.0 }
  // error model
  let err_mul = @physics.err_mul_base(stats.ctl) * (1.0 + 2.2 * (1.0 - q))
  tx = tx + rng.draw() * 0.30 * err_mul * aim_acc + rng.draw() * overcharge * 2.8
  tz = tz +
    z_sign * (rng.draw() * 0.55 * err_mul * aim_acc + rng.draw() * overcharge * 2.8)
  tz = z_sign *
    @vec.clampd(@vec.dabs(tz), 2.0, @physics.court_half_len + 2.5)
  spin_rpm = spin_rpm * (1.0 + rng.draw() * 0.06 * err_mul)
  speed = speed * (1.0 + rng.draw() * 0.03 * err_mul)
  let mut mishit = false
  let mut yaw_err = 0.0
  if q < 0.3 && rng.uniform() < (if aid { 0.15 } else { 0.35 }) {
    mishit = true
    yaw_err = (rng.uniform() - 0.5) * 0.5
    speed = speed * 0.55
    spin_rpm = spin_rpm * 0.3
  }
  // slice drifts: a touch of vertical-axis spin (sign by court side of contact)
  let y_spin = if typ == Slice {
    @vec.dabs(spin_rpm) *
    0.27 *
    @physics.rpm_to_rads *
    (if ball_x >= player_x { 1.0 } else { -1.0 })
  } else {
    0.0
  }
  let solved = @physics.solve_shot(
    from_x=ball_x,
    from_y=@vec.dmax(ball_y, 0.15),
    from_z=ball_z,
    target_x=tx,
    target_z=tz,
    speed~,
    spin_rad_s=spin_rpm * @physics.rpm_to_rads,
    y_spin_rad_s=y_spin,
    theta_min_deg=def_theta_min,
    theta_max_deg=def_theta_max,
  )
  let mut out_vx = solved.vx
  let mut out_vz = solved.vz
  if yaw_err != 0.0 {
    let c = @math.cos(yaw_err)
    let s = @math.sin(yaw_err)
    out_vx = solved.vx * c - solved.vz * s
    out_vz = solved.vx * s + solved.vz * c
  }
  Some({
    vx: out_vx,
    vy: solved.vy,
    vz: out_vz,
    sx: solved.sx,
    sy: solved.sy,
    sz: solved.sz,
    q,
    mishit,
    perfect,
    shot_type: typ,
  })
}
