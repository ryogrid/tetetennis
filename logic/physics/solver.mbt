// Target-based shot solver: bisect the elevation angle using a 2D drag+Magnus
// sim in the shot's vertical plane. Ported from old/src/physics/shotSolver.js.

///|
let sim_dt : Double = 1.0 / 120.0

///|
let sim_max_t : Double = 4.0

///|
let deg : Double = @math.PI / 180.0

///|
pub struct Shot {
  vx : Double
  vy : Double
  vz : Double
  sx : Double
  sy : Double
  sz : Double
  theta : Double
  speed : Double
}

// Horizontal distance at which the ball reaches y = ball_r descending.
// spin_rad_s > 0 = topspin (dips).
///|
fn simulate_range_2d(
  y0 : Double,
  v0 : Double,
  theta : Double,
  spin_rad_s : Double,
) -> Double {
  let mut s = 0.0
  let mut y = y0
  let mut vs = v0 * @math.cos(theta)
  let mut vy = v0 * @math.sin(theta)
  let mut w = @vec.dabs(spin_rad_s)
  let sgn = @vec.dsign(spin_rad_s)
  let decay = @math.exp(-sim_dt / aero_spin_decay_tau)
  for t = 0.0; t < sim_max_t; t = t + sim_dt {
    let speed = @vec.hypot2(vs, vy)
    let mut as_ = 0.0
    let mut ay = -g
    if speed > 1.0e-6 {
      let drag = aero_k * aero_cd * speed
      as_ = as_ - drag * vs
      ay = ay - drag * vy
      if w > 1.0 {
        let s_ = ball_r * w / speed
        let cl = @vec.dmin(1.0 / (2.0 + 1.0 / s_), aero_cl_max)
        let m = aero_k * cl * speed
        // topspin (sgn=+1): accel = m*(vy, -vs) -> dips when moving forward
        as_ = as_ + m * sgn * vy
        ay = ay + m * sgn * -vs
      }
    }
    vs = vs + as_ * sim_dt
    vy = vy + ay * sim_dt
    let prev_y = y
    s = s + vs * sim_dt
    y = y + vy * sim_dt
    w = w * decay
    if y <= ball_r && vy < 0.0 {
      // interpolate within the step
      let f = (prev_y - ball_r) / (prev_y - y)
      return s - vs * sim_dt * (1.0 - f)
    }
  }
  s
}

// Solve a shot. from/target in court coords; speed m/s; spin_rad_s signed
// (+ topspin); y_spin_rad_s extra vertical-axis spin (curve); theta band in deg.
///|
pub fn solve_shot(
  from_x~ : Double,
  from_y~ : Double,
  from_z~ : Double,
  target_x~ : Double,
  target_z~ : Double,
  speed~ : Double,
  spin_rad_s~ : Double = 0.0,
  y_spin_rad_s~ : Double = 0.0,
  theta_min_deg~ : Double,
  theta_max_deg~ : Double,
) -> Shot {
  let dx = target_x - from_x
  let dz = target_z - from_z
  let d = @vec.hypot2(dx, dz)
  let dir_x = dx / d
  let dir_z = dz / d
  let mut v0 = speed
  let mut lo = theta_min_deg * deg
  let mut hi = theta_max_deg * deg

  // Bracket: grow/shrink speed if the band can't reach / overshoots.
  for _tries = 0; _tries < 3; _tries = _tries + 1 {
    let r_max = simulate_range_2d(from_y, v0, hi, spin_rad_s)
    let r_min = simulate_range_2d(from_y, v0, lo, spin_rad_s)
    if r_max < d {
      v0 = v0 * 1.12 // can't reach: hit harder
      continue
    }
    if r_min > d {
      v0 = v0 * 0.88 // too hot even at min angle
      continue
    }
    break
  }

  // Bisection (range monotonic in theta within the bands used). 11 iterations.
  let mut theta = (lo + hi) / 2.0
  for _i = 0; _i < 11; _i = _i + 1 {
    theta = (lo + hi) / 2.0
    let r = simulate_range_2d(from_y, v0, theta, spin_rad_s)
    if r < d {
      lo = theta
    } else {
      hi = theta
    }
  }
  theta = (lo + hi) / 2.0
  let v_h = v0 * @math.cos(theta)
  // Spin axis: horizontal, perpendicular to aim. dir=(0,0,-1), topspin(+) -> (-1,0,0).
  {
    vx: dir_x * v_h,
    vy: v0 * @math.sin(theta),
    vz: dir_z * v_h,
    sx: dir_z * spin_rad_s,
    sy: y_spin_rad_s,
    sz: -dir_x * spin_rad_s,
    theta,
    speed: v0,
  }
}
