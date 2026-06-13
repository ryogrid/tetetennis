// Ground bounce: vertical restitution + Coulomb friction impulse with a
// grip/slide branch. Hollow sphere I = (2/3) m r^2 -> rolling factor alpha = 2/5.
// Ported from old/src/physics/bounce.js. Mutates the ball's vel + spin in place.

///|
let alpha : Double = 2.0 / 5.0

// Effective vertical restitution at this impact speed (ball deforms, returns
// less energy the harder it hits; anchored at the ITF drop-test speed).
///|
pub fn effective_ey(ey : Double, vy_in_abs : Double) -> Double {
  let f = 1.0 - bounce_slope * (vy_in_abs - bounce_v_ref)
  ey * @vec.dmax(bounce_min_frac, @vec.dmin(1.0, f))
}

///|
pub fn apply_bounce(b : Ball, surface : Surface) -> Unit {
  let mu = surface.mu
  let vy_in = b.vy // < 0
  let ey = effective_ey(surface.ey, @vec.dabs(vy_in))
  let jn = (1.0 + ey) * @vec.dabs(vy_in) // normal impulse per unit mass
  b.vy = -ey * vy_in

  // Contact-point slip velocity (horizontal). w x n with n=(0,1,0) = (-w.z, 0, w.x).
  let slip_x = b.vx - ball_r * -b.sz
  let slip_z = b.vz - ball_r * b.sx
  let slip_mag = @vec.hypot2(slip_x, slip_z)
  if slip_mag < 1.0e-9 {
    b.sy = b.sy * 0.6
    return
  }
  if mu * jn >= alpha * slip_mag {
    // GRIP: contact reaches rolling during impact ("bite")
    b.vx = b.vx - alpha * slip_x
    b.vz = b.vz - alpha * slip_z
    // pure rolling: w.z = -v.x/R, w.x = v.z/R
    b.sx = b.vz / ball_r
    b.sz = -b.vx / ball_r
    b.sy = b.sy * 0.6
  } else {
    // SLIDE: full friction impulse opposing slip
    let dx = slip_x / slip_mag
    let dz = slip_z / slip_mag
    b.vx = b.vx - mu * jn * dx
    b.vz = b.vz - mu * jn * dz
    // angular impulse: dw = -(3 mu Jn / 2R) * (n x d), n x d = (-dz, 0, dx)
    let k = 3.0 * mu * jn / (2.0 * ball_r)
    b.sx = b.sx - k * -dz
    b.sz = b.sz - k * dx
    b.sy = b.sy * 0.6
  }
}
