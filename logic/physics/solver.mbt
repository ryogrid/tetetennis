// Shot solver: elevation-sweep with 3D forward simulation.
// Two solver modes: drive (speed-priority, sweeps elevation) and
// control (converges to target with fallback).

///|
let sim_dt : Double = 1.0 / 120.0

///|
let sim_max_t : Double = 4.0

// Newton sqrt — @math.sqrt is not available in MoonBit's current math package.
///|
fn sqrt(x : Double) -> Double {
  if x <= 0.0 { return 0.0 }
  let mut r = x
  for _i = 0; _i < 8; _i = _i + 1 {
    r = (r + x / r) * 0.5
  }
  r
}

// Convert degrees to radians.
///|
fn to_rad(deg : Int) -> Double {
  deg.to_double() * (@math.PI / 180.0)
}

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

// ---- 3D forward sim (no net/bounce — pure flight) ----

// Simulate a 3D trajectory from launch to y=ball_r (landing). Returns (land_x, land_z)
// or None if max time exceeded. Does NOT apply net collision or bounce.
///|
fn sim_flight(
  px0 : Double, py0 : Double, pz0 : Double,
  vx0 : Double, vy0 : Double, vz0 : Double,
  sx0 : Double, sy0 : Double, sz0 : Double,
) -> (Double, Double)? {
  let mut px = px0; let mut py = py0; let mut pz = pz0
  let mut vx = vx0; let mut vy = vy0; let mut vz = vz0
  let mut sx = sx0; let mut sy = sy0; let mut sz = sz0
  let decay = @math.exp(-sim_dt / aero_spin_decay_tau)
  for t = 0.0; t < sim_max_t; t = t + sim_dt {
    let speed = @vec.hypot3(vx, vy, vz)
    let mut ax = 0.0; let mut ay = -g; let mut az = 0.0
    if speed > 1.0e-6 {
      let drag = aero_k * aero_cd * speed
      ax = ax - drag * vx
      ay = ay - drag * vy
      az = az - drag * vz
      let w_mag = @vec.hypot3(sx, sy, sz)
      if w_mag > 1.0 {
        let s_ = ball_r * w_mag / speed
        let cl = @vec.dmin(1.0 / (2.0 + 1.0 / s_), aero_cl_max)
        let k = aero_k * cl * speed / w_mag
        ax = ax + k * (sy * vz - sz * vy)
        ay = ay + k * (sz * vx - sx * vz)
        az = az + k * (sx * vy - sy * vx)
      }
    }
    vx = vx + ax * sim_dt
    vy = vy + ay * sim_dt
    vz = vz + az * sim_dt
    let prev_py = py
    px = px + vx * sim_dt
    py = py + vy * sim_dt
    pz = pz + vz * sim_dt
    sx = sx * decay; sy = sy * decay; sz = sz * decay
    if py <= ball_r && vy < 0.0 {
      let f = (prev_py - ball_r) / (prev_py - py)
      let lx = px - vx * sim_dt * (1.0 - f)
      let lz = pz - vz * sim_dt * (1.0 - f)
      return Some((lx, lz))
    }
  }
  None
}

// Return y at the moment the ball crosses z=0, or None if it doesn't.
///|
fn net_cross_y(
  px0 : Double, py0 : Double, pz0 : Double,
  vx0 : Double, vy0 : Double, vz0 : Double,
  sx0 : Double, sy0 : Double, sz0 : Double,
) -> Double? {
  let mut px = px0; let mut py = py0; let mut pz = pz0
  let mut vx = vx0; let mut vy = vy0; let mut vz = vz0
  let mut sx = sx0; let mut sy = sy0; let mut sz = sz0
  let decay = @math.exp(-sim_dt / aero_spin_decay_tau)
  for t = 0.0; t < sim_max_t; t = t + sim_dt {
    let prev_pz = pz
    let speed = @vec.hypot3(vx, vy, vz)
    let mut ax = 0.0; let mut ay = -g; let mut az = 0.0
    if speed > 1.0e-6 {
      let drag = aero_k * aero_cd * speed
      ax = ax - drag * vx
      ay = ay - drag * vy
      az = az - drag * vz
      let w_mag = @vec.hypot3(sx, sy, sz)
      if w_mag > 1.0 {
        let s_ = ball_r * w_mag / speed
        let cl = @vec.dmin(1.0 / (2.0 + 1.0 / s_), aero_cl_max)
        let k = aero_k * cl * speed / w_mag
        ax = ax + k * (sy * vz - sz * vy)
        ay = ay + k * (sz * vx - sx * vz)
        az = az + k * (sx * vy - sy * vx)
      }
    }
    vx = vx + ax * sim_dt
    vy = vy + ay * sim_dt
    vz = vz + az * sim_dt
    px = px + vx * sim_dt
    py = py + vy * sim_dt
    pz = pz + vz * sim_dt
    sx = sx * decay; sy = sy * decay; sz = sz * decay
    if prev_pz != 0.0 && @vec.dsign(pz) != @vec.dsign(prev_pz) {
      let f = prev_pz / (prev_pz - pz)
      return Some(py - vy * sim_dt * (1.0 - f))
    }
    if py <= ball_r { break } // hit ground before net
  }
  None
}

// ---- spin axis helper ----

///|
fn spin_axis(dir_x : Double, dir_z : Double, spin_rad_s : Double) -> (Double, Double, Double) {
  // Horizontal axis perpendicular to aim direction.
  // dir=(dx, dz), spin axis = (dz, 0, -dx) * spin_rad_s
  (dir_z * spin_rad_s, 0.0, -dir_x * spin_rad_s)
}

// ---- solve_drive: speed-priority, sweep elevation ----

///|
fn solve_drive(
  from_x : Double, from_y : Double, from_z : Double,
  target_x : Double, target_z : Double,
  speed : Double, spin_rad_s : Double,
  net_margin : Double, side_sign : Double,
) -> Shot {
  let dx = target_x - from_x
  let dz = target_z - from_z
  let horiz = @vec.hypot2(dx, dz)
  let mut dir_x = 0.0
  let mut dir_z = -side_sign
  if horiz > 1.0e-6 {
    dir_x = dx / horiz
    dir_z = dz / horiz
  }
  let mut best_vx = dir_x * speed
  let mut best_vy = 4.0
  let mut best_vz = dir_z * speed
  let mut best_err = 1.0e9
  let mut best_any_vx = best_vx
  let mut best_any_vy = best_vy
  let mut best_any_vz = best_vz
  let mut best_any_cross = -1.0e9

  for deg_i = -32; deg_i <= 34; deg_i = deg_i + 1 {
    let th = to_rad(deg_i)
    let vh = speed * @math.cos(th)
    let vy = speed * @math.sin(th)
    let vx = dir_x * vh
    let vz = dir_z * vh
    let (sx, sy, sz) = spin_axis(dir_x, dir_z, spin_rad_s)

    let cross = net_cross_y(from_x, from_y, from_z, vx, vy, vz, sx, sy, sz)
    match cross {
      Some(yc) => {
        if yc > best_any_cross {
          best_any_cross = yc
          best_any_vx = vx
          best_any_vy = vy
          best_any_vz = vz
        }
        if yc >= net_height(0.0) + net_margin {
          match sim_flight(from_x, from_y, from_z, vx, vy, vz, sx, sy, sz) {
            Some((lx, lz)) => {
              let err = @vec.hypot2(lx - target_x, lz - target_z)
              if err < best_err {
                best_err = err
                best_vx = vx
                best_vy = vy
                best_vz = vz
              }
            }
            None => ()
          }
        }
      }
      None => ()
    }
  }

  let (sx, sy, sz) = spin_axis(dir_x, dir_z, spin_rad_s)
  // If no solution clears net + lands, use best net-clear or best any
  if best_err > 1.0e8 {
    best_vx = best_any_vx
    best_vy = best_any_vy
    best_vz = best_any_vz
  }
  {
    vx: best_vx, vy: best_vy, vz: best_vz,
    sx, sy, sz,
    theta: @math.atan2(best_vy, @vec.hypot2(best_vx, best_vz)),
    speed,
  }
}

// ---- solve_control: converge to target, net check with fallback ----

// Analytic initial velocity from a drag-free parabola.
///|
fn analytic_initial(
  from_x : Double, from_y : Double, from_z : Double,
  to_x : Double, to_z : Double, _speed : Double, apex : Double,
) -> (Double, Double, Double) {
  let dx = to_x - from_x
  let dz = to_z - from_z
  let hd = @vec.hypot2(dx, dz)
  let dy = 0.0 - from_y // target y = 0 (ground)
  let rise = @vec.dmax(apex - from_y, 0.1)
  let mut vy0 = sqrt(2.0 * g * rise)
  let a = 0.5 * g
  let b = -vy0
  let c = dy
  let disc = b * b - 4.0 * a * c
  let mut flight_t = 1.0
  if disc >= 0.0 {
    flight_t = (-b + sqrt(disc)) / (2.0 * a)
  } else {
    flight_t = hd / @vec.dmax(1.0, 1.0)
    vy0 = dy / flight_t + 0.5 * g * flight_t
  }
  let denom = @vec.dmax(flight_t, 1.0e-3)
  let vx = dx / denom
  let vz = dz / denom
  (vx, vy0, vz)
}

// Forward-simulate correction: adjust vx, vz to converge landing to target.
///|
fn correct_landing(
  from_x : Double, from_y : Double, from_z : Double,
  vx0 : Double, vy0 : Double, vz0 : Double,
  sx : Double, sy : Double, sz : Double,
  target_x : Double, target_z : Double,
) -> (Double, Double, Double) {
  let mut vx = vx0
  let vy = vy0
  let mut vz = vz0
  let gain = 0.7
  for _i = 0; _i < 4; _i = _i + 1 {
    match sim_flight(from_x, from_y, from_z, vx, vy, vz, sx, sy, sz) {
      Some((lx, lz)) => {
        let err_x = target_x - lx
        let err_z = target_z - lz
        if @vec.hypot2(err_x, err_z) < 0.2 { break }
        // Approximate flight time from vy and gravity
        let tflight = (vy + sqrt(vy * vy + 2.0 * g * from_y)) / g
        vx = vx + (err_x / @vec.dmax(tflight, 0.1)) * gain
        vz = vz + (err_z / @vec.dmax(tflight, 0.1)) * gain
      }
      None => break
    }
  }
  (vx, vy, vz)
}

// Net-clearance fallback: sweep elevation angles looking for one that clears.
///|
fn clear_net_fallback(
  from_x : Double, from_y : Double, from_z : Double,
  dir_x : Double, dir_z : Double,
  speed : Double, spin_rad_s : Double,
  net_margin : Double, target_x : Double, target_z : Double,
) -> Shot {
  let (sx, sy, sz) = spin_axis(dir_x, dir_z, spin_rad_s)
  let mut best_vx = dir_x * speed
  let mut best_vy = 4.0
  let mut best_vz = dir_z * speed
  let mut best_err = 1.0e9
  let mut any_vx = best_vx
  let mut any_vy = best_vy
  let mut any_vz = best_vz
  let mut any_cross = -1.0e9

  for deg_i = 4; deg_i <= 70; deg_i = deg_i + 1 {
    let th = to_rad(deg_i)
    let vh = speed * @math.cos(th)
    let vy = speed * @math.sin(th)
    let vx = dir_x * vh
    let vz = dir_z * vh
    match net_cross_y(from_x, from_y, from_z, vx, vy, vz, sx, sy, sz) {
      Some(yc) => {
        if yc > any_cross { any_cross = yc; any_vx = vx; any_vy = vy; any_vz = vz }
        if yc >= net_height(0.0) + net_margin {
          match sim_flight(from_x, from_y, from_z, vx, vy, vz, sx, sy, sz) {
            Some((lx, lz)) => {
              let err = @vec.hypot2(lx - target_x, lz - target_z)
              if err < best_err {
                best_err = err; best_vx = vx; best_vy = vy; best_vz = vz
              }
            }
            None => ()
          }
        }
      }
      None => ()
    }
  }

  if best_err > 1.0e8 {
    best_vx = any_vx
    best_vy = any_vy
    best_vz = any_vz
  }
  {
    vx: best_vx, vy: best_vy, vz: best_vz,
    sx, sy, sz,
    theta: @math.atan2(best_vy, @vec.hypot2(best_vx, best_vz)),
    speed,
  }
}

///|
fn solve_control(
  from_x : Double, from_y : Double, from_z : Double,
  target_x : Double, target_z : Double,
  speed : Double, apex0 : Double, spin_rad_s : Double,
  net_margin : Double, side_sign : Double,
) -> Shot {
  let dx = target_x - from_x
  let dz = target_z - from_z
  let horiz = @vec.hypot2(dx, dz)
  let dir_x = if horiz > 1.0e-6 { dx / horiz } else { 0.0 }
  let dir_z = if horiz > 1.0e-6 { dz / horiz } else { -side_sign }

  let mut ap = apex0
  let mut best : Shot? = None
  let mut best_err = 1.0e9

  for retry = 0; retry <= 6; retry = retry + 1 {
    // analytic initial
    let (vx, vy, vz) = analytic_initial(from_x, from_y, from_z, target_x, target_z, speed, ap)
    let (sx, sy, sz) = spin_axis(dir_x, dir_z, spin_rad_s)
    // correction
    let (cvx, cvy, cvz) = correct_landing(from_x, from_y, from_z, vx, vy, vz, sx, sy, sz, target_x, target_z)
    // net check
    match net_cross_y(from_x, from_y, from_z, cvx, cvy, cvz, sx, sy, sz) {
      Some(yc) => {
        if yc >= net_height(0.0) + net_margin {
          match sim_flight(from_x, from_y, from_z, cvx, cvy, cvz, sx, sy, sz) {
            Some((lx, lz)) => {
              let err = @vec.hypot2(lx - target_x, lz - target_z)
              if err < best_err {
                best_err = err
                best = Some({ vx: cvx, vy: cvy, vz: cvz, sx, sy, sz, theta: @math.atan2(cvy, @vec.hypot2(cvx, cvz)), speed })
              }
            }
            None => ()
          }
          if best_err < 1.5 { break }
        } else {
          let deficit = net_height(0.0) + net_margin - yc
          ap = ap + @vec.dmax(deficit + 0.6, 0.8)
        }
      }
      None => {
        ap = ap + @vec.dmax(net_height(0.0) + net_margin + 0.6, 0.8)
      }
    }
  }

  match best {
    Some(b) => b
    None => clear_net_fallback(from_x, from_y, from_z, dir_x, dir_z, speed, spin_rad_s, net_margin, target_x, target_z)
  }
}

// ---- public solve_shot (dispatcher) ----

// Solve a shot. Uses solve_drive when the theta band includes downward angles
// (flat/smash), otherwise solve_control (topspin/slice/lob/drop).
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
  drive~ : Bool = false,
) -> Shot {
  // solve_drive (speed-priority): flat/smash — speed matters, depth varies
  // solve_control (landing-priority): topspin, slice, lob, drop, serves
  let is_drive = drive

  // Determine side_sign from target_z vs from_z
  let side_sign = if target_z < from_z { 1.0 } else { -1.0 }

  // net_margin: how much clearance above net required
  let net_margin = if is_drive { 0.05 } else { 0.25 }

  // apex for control shots
  let apex = @vec.dmax(1.8, @vec.dmin(5.0, 1.8 + (theta_max_deg - 10.0) * 0.07))

  if is_drive {
    solve_drive(from_x, from_y, from_z, target_x, target_z, speed, spin_rad_s, net_margin, side_sign)
  } else {
    solve_control(from_x, from_y, from_z, target_x, target_z, speed, apex, spin_rad_s, net_margin, side_sign)
  }
}
