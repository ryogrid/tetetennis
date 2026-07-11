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

// Practice-mode serve feed: menu index -> serve type (0 Flat, 1 Slice, 2 Kick).
///|
pub fn practice_serve_type(i : Int) -> ServeType {
  match i {
    0 => ServeFlat
    1 => ServeSlice
    _ => ServeKick
  }
}

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

// CPU tactical preset -> hitter-frame lateral cell for compute_serve.
// T hugs the center line, Wide the sideline; Body is centered. Derived so
// that compute_serve's `t_lat = cell_x * -z_sign` maps back onto the box:
// T needs t_lat = -x_sign, Wide needs +x_sign, so cell_x = ±(x_sign*z_sign).
///|
pub fn preset_aim_x(
  preset : Preset,
  serving_side : @rules.Side,
  court_side : CourtSide,
) -> Double {
  let box = serve_box(serving_side, court_side)
  match preset {
    Body => 0.0
    T => box.x_sign * box.z_sign
    Wide => -box.x_sign * box.z_sign
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

// Discrete 9-target aiming (design_docs/ball-control-and-aiming.md):
// aim_x/aim_depth are hitter-frame axes, quantized to cells. Columns map
// onto the box's [T .. wide] band; depth rows are insets from the service
// line, with the achieved depth gated by the meter accuracy (length control
// = internal power modulation).
///|
pub fn compute_serve(
  stats : Stats,
  type_ : ServeType,
  from_x : Double,
  from_y : Double,
  from_z : Double,
  serving_side : @rules.Side,
  court_side : CourtSide,
  aim_x : Double,
  aim_depth : Double,
  power : Double, // serve power meter value p in [0,1]
  rng : @rng.Gauss,
) -> Serve {
  let box = serve_box(serving_side, court_side)
  let (def_speed_mul, def_theta_min, def_theta_max) = serve_def(type_)
  let (cell_x, cell_z) = aim_cells(aim_x, aim_depth)

  // lateral: hitter-frame cell onto the box's [T .. wide] band
  let x_inner = if box.x_sign > 0.0 { 0.45 } else { -0.45 } // near center line (T)
  let x_outer = box.x_sign * (@physics.court_half_width - 0.55) // near sideline (wide)
  let x_mid = (x_inner + x_outer) / 2.0
  let lat_span = @vec.dabs(x_outer - x_inner) / 2.0
  let t_lat = cell_x * -box.z_sign // hitter's right in world +x terms
  let mut target_x = @vec.clampd(
    x_mid + t_lat * lat_span,
    @vec.dmin(x_inner, x_outer),
    @vec.dmax(x_inner, x_outer),
  )
  // Power meter: speed grows with p; accuracy peaks in the sweet band
  // [sweet_lo, sweet_hi] (defaults [0.70, 0.88]), scales down
  // below it, and collapses in the overpower zone.
  let sweet_lo = @tuning.t.serve_sweet_lo
  let sweet_hi = @tuning.t.serve_sweet_hi
  let p = @vec.clampd(power, 0.0, 1.0)
  let acc = if p <= sweet_lo {
    0.5 + 0.5 * p / sweet_lo
  } else if p <= sweet_hi {
    1.0
  } else {
    @vec.dmax(0.35, 1.0 - (p - sweet_hi) / (1.0 - sweet_hi) * 0.6)
  }
  // depth row -> inset from the service line, gated by meter accuracy
  let row_inset = if cell_z > 0.0 {
    @tuning.t.serve_deep_inset
  } else if cell_z < 0.0 {
    @tuning.t.serve_short_inset
  } else {
    @tuning.t.serve_safe_inset
  }
  let serve_len_ctrl = @vec.clampd((acc - 0.40) / 0.60, 0.0, 1.0)
  let achieved_inset = @tuning.t.serve_safe_inset +
    (row_inset - @tuning.t.serve_safe_inset) * serve_len_ctrl
  let mut target_z = box.z_sign *
    (@physics.court_service_line - achieved_inset)
  let mut speed = @physics.serve_power_speed(stats.srv, p) * def_speed_mul
  // short row: internal power modulation — a full-pace serve cannot land
  // short. Per-type cut (kick's loft already drops it short).
  if cell_z < 0.0 {
    speed = speed *
      (match type_ {
        ServeFlat => 0.68
        ServeSlice => 0.72
        ServeKick => 0.85
      })
  }

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
  let err_mul = @physics.err_mul_base(stats.ctl) *
    (1.0 + @tuning.t.err_quality_gain * (1.0 - acc))
  target_x = target_x + rng.draw() * @tuning.t.serve_err_x * err_mul
  target_z = target_z + box.z_sign * rng.draw() * @tuning.t.serve_err_z * err_mul
  speed = speed * (1.0 + rng.draw() * @tuning.t.serve_err_speed * err_mul)
  let w_total = @vec.dabs(spin_rpm) * @physics.rpm_to_rads
  let lateral = spin_rpm * @physics.rpm_to_rads * (1.0 - y_spin_frac)
  let y_spin = w_total * y_spin_frac * y_spin_sign
  // uniform ball-speed reduction (same scale as strokes); default 1.0
  speed = speed * @tuning.t.ball_speed_scale
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
    drive=true,
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
          drive=true,
        )
      }
      None => ()
    }
  }
  { vx: solved.vx, vy: solved.vy, vz: solved.vz, sx: solved.sx, sy: solved.sy, sz: solved.sz }
}
