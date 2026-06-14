// Serve model: types, target presets, box geometry, fault detection.
// Ported from old/src/game/serve.js.

///|
pub(all) enum CourtSide {
  Deuce
  Ad
} derive(Eq, Show)

///|
pub(all) enum Preset {
  Wide
  Body
  T
} derive(Eq, Show)

///|
pub(all) enum ServeType {
  ServeFlat
  ServeKick
  ServeSlice
} derive(Eq, Show)

// (speed_mul, theta_min_deg, theta_max_deg)
///|
pub fn serve_def(t : ServeType) -> (Double, Double, Double) {
  match t {
    ServeFlat => (1.00, -6.0, 4.0)
    ServeKick => (0.64, 2.0, 14.0)
    ServeSlice => (0.84, -4.0, 6.0)
  }
}

///|
pub(all) struct ServeBoxR {
  x_min : Double
  x_max : Double
  z_min : Double
  z_max : Double
  x_sign : Double
  z_sign : Double
}

// Box x-sign is opposite the server's stance x. serving_side P serves toward -z.
///|
pub fn serve_box(serving_side : @rules.Side, court_side : CourtSide) -> ServeBoxR {
  let z_sign = match serving_side {
    @rules.P => -1.0
    @rules.C => 1.0
  }
  let deuce_x_sign = match serving_side {
    @rules.P => -1.0
    @rules.C => 1.0
  }
  let x_sign = match court_side {
    Deuce => deuce_x_sign
    Ad => -deuce_x_sign
  }
  {
    x_min: @vec.dmin(0.0, x_sign * @physics.court_half_width),
    x_max: @vec.dmax(0.0, x_sign * @physics.court_half_width),
    z_min: @vec.dmin(0.0, z_sign * @physics.court_service_line),
    z_max: @vec.dmax(0.0, z_sign * @physics.court_service_line),
    x_sign,
    z_sign,
  }
}

///|
pub fn is_serve_box_in(
  pos_x : Double,
  pos_z : Double,
  serving_side : @rules.Side,
  court_side : CourtSide,
) -> Bool {
  let b = serve_box(serving_side, court_side)
  pos_x >= b.x_min - @physics.line_grace &&
  pos_x <= b.x_max + @physics.line_grace &&
  pos_z >= b.z_min - @physics.line_grace &&
  pos_z <= b.z_max + @physics.line_grace
}

// Stance x for the server (small offset from center mark, correct half).
///|
pub fn serve_stance_x(serving_side : @rules.Side, court_side : CourtSide) -> Double {
  let deuce_x_sign = match serving_side {
    @rules.P => 1.0
    @rules.C => -1.0
  }
  (match court_side {
    Deuce => deuce_x_sign
    Ad => -deuce_x_sign
  }) *
  0.35
}

///|
pub(all) struct Serve {
  vx : Double
  vy : Double
  vz : Double
  sx : Double
  sy : Double
  sz : Double
}

// q_serve in [0.4, 1] from toss timing. aim_adjust/aim_depth in [-1,1].
///|
pub fn compute_serve(
  stats : Stats,
  type_ : ServeType,
  from_x : Double,
  from_y : Double,
  from_z : Double,
  serving_side : @rules.Side,
  court_side : CourtSide,
  target_preset : Preset,
  aim_adjust : Double,
  aim_depth : Double,
  power : Double, // serve power meter value p in [0,1]
  rng : @rng.Gauss,
) -> Serve {
  let box = serve_box(serving_side, court_side)
  let (def_speed_mul, def_theta_min, def_theta_max) = serve_def(type_)

  // target points 0.5 m inside the box lines
  let x_inner = if box.x_sign > 0.0 { 0.45 } else { -0.45 } // near center line (T)
  let x_outer = box.x_sign * (@physics.court_half_width - 0.55) // near sideline (wide)
  let depth = @vec.clampd(aim_depth, -1.0, 1.0)
  let z_inset = if depth >= 0.0 {
    0.55 - 0.25 * depth
  } else {
    0.55 - 1.05 * depth
  }
  let z_deep = box.z_sign * (@physics.court_service_line - z_inset)
  let mut tx = match target_preset {
    T => x_inner
    Wide => x_outer
    Body => (x_inner + x_outer) / 2.0
  }
  tx = tx + @vec.clampd(aim_adjust, -1.0, 1.0) * 1.6
  tx = @vec.clampd(tx, @vec.dmin(x_inner, x_outer), @vec.dmax(x_inner, x_outer))
  let mut target_x = tx
  let mut target_z = z_deep
  // Power meter: speed grows with p; accuracy peaks in the sweet band
  // [0.70, 0.88], scales down below it, and collapses in the overpower zone.
  let p = @vec.clampd(power, 0.0, 1.0)
  let acc = if p <= 0.70 {
    0.5 + 0.5 * p / 0.70
  } else if p <= 0.88 {
    1.0
  } else {
    @vec.dmax(0.35, 1.0 - (p - 0.88) / 0.12 * 0.6)
  }
  let mut speed = @physics.serve_power_speed(stats.srv, p) * def_speed_mul

  // spin: rpm + axis split between lateral (top/back) and vertical (side)
  let mut spin_rpm = 0.0
  let mut y_spin_frac = 0.0
  let mut y_spin_sign = 0.0
  match type_ {
    ServeFlat => {
      spin_rpm = 400.0
      y_spin_frac = 0.0
    }
    ServeKick => {
      spin_rpm = 3200.0 + 1600.0 * stats.spn / 100.0
      y_spin_frac = 0.4
      y_spin_sign = -1.0
    }
    ServeSlice => {
      spin_rpm = -(1800.0 + 900.0 * stats.srv / 100.0)
      y_spin_frac = 0.7
      y_spin_sign = 1.0
    }
  }

  // error model (same shape as strokes); accuracy from the power band
  let err_mul = @physics.err_mul_base(stats.ctl) * (1.0 + 2.2 * (1.0 - acc))
  target_x = target_x + rng.draw() * 0.30 * err_mul
  target_z = target_z + box.z_sign * rng.draw() * 0.35 * err_mul
  speed = speed * (1.0 + rng.draw() * 0.025 * err_mul)
  let w_total = @vec.dabs(spin_rpm) * @physics.rpm_to_rads
  let lateral = spin_rpm * @physics.rpm_to_rads * (1.0 - y_spin_frac)
  let y_spin = w_total * y_spin_frac * y_spin_sign
  let mut solved = @physics.solve_shot(
    from_x~,
    from_y~,
    from_z~,
    target_x~,
    target_z~,
    speed~,
    spin_rad_s=lateral,
    y_spin_rad_s=y_spin,
    theta_min_deg=def_theta_min,
    theta_max_deg=def_theta_max,
  )

  // Side spin curves the ball laterally, which the 2D solver cannot see. One
  // correction pass: simulate the real 3D landing, shift aim by the drift, re-solve.
  if y_spin_frac > 0.0 {
    let b = @physics.make_ball()
    b.px = from_x
    b.py = from_y
    b.pz = from_z
    b.vx = solved.vx
    b.vy = solved.vy
    b.vz = solved.vz
    b.sx = solved.sx
    b.sy = solved.sy
    b.sz = solved.sz
    b.activate()
    match @physics.predict_landing(b, @physics.surface_hard) {
      Some(landing) => {
        let new_x = target_x - @vec.clampd(landing.x - target_x, -2.5, 2.5)
        let z_corr = @vec.clampd(landing.z - target_z, -2.5, 2.5)
        let new_z = target_z - z_corr
        let final_z = if @vec.dsign(new_z) == @vec.dsign(target_z) {
          new_z
        } else {
          target_z
        }
        solved = @physics.solve_shot(
          from_x~,
          from_y~,
          from_z~,
          target_x=new_x,
          target_z=final_z,
          speed~,
          spin_rad_s=lateral,
          y_spin_rad_s=y_spin,
          theta_min_deg=def_theta_min,
          theta_max_deg=def_theta_max,
        )
      }
      None => ()
    }
  }
  { vx: solved.vx, vy: solved.vy, vz: solved.vz, sx: solved.sx, sy: solved.sy, sz: solved.sz }
}
