// Ball flight: gravity + quadratic drag + Magnus lift, semi-implicit Euler,
// plus ground bounce + net collision emitting events. Ported from
// old/src/physics/ball.js. Flat mutable struct mirrors the in-place integrator.

///|
pub(all) struct Ball {
  mut px : Double
  mut py : Double
  mut pz : Double
  mut vx : Double
  mut vy : Double
  mut vz : Double
  mut sx : Double
  mut sy : Double
  mut sz : Double
  mut active : Bool
}

///|
pub(all) enum Event {
  Bounce(Double, Double, Double, Double) // px, py, pz, pre-bounce 3D speed
  Net(Bool) // tape (over the cord) vs body
}

///|
pub fn Ball::activate(self : Ball) -> Unit {
  self.active = true
}

///|
pub fn Ball::deactivate(self : Ball) -> Unit {
  self.active = false
}

///|
pub fn make_ball() -> Ball {
  {
    px: 0.0,
    py: 1.0,
    pz: 0.0,
    vx: 0.0,
    vy: 0.0,
    vz: 0.0,
    sx: 0.0,
    sy: 0.0,
    sz: 0.0,
    active: false,
  }
}

///|
pub fn copy_ball(s : Ball) -> Ball {
  {
    px: s.px,
    py: s.py,
    pz: s.pz,
    vx: s.vx,
    vy: s.vy,
    vz: s.vz,
    sx: s.sx,
    sy: s.sy,
    sz: s.sz,
    active: s.active,
  }
}

// Acceleration for the given velocity/spin. Returns (ax, ay, az).
///|
pub fn accel(
  vx : Double,
  vy : Double,
  vz : Double,
  sx : Double,
  sy : Double,
  sz : Double,
) -> (Double, Double, Double) {
  let speed = @vec.hypot3(vx, vy, vz)
  let mut ax = 0.0
  let mut ay = -g
  let mut az = 0.0
  if speed < 1.0e-6 {
    return (ax, ay, az)
  }
  let drag = aero_k * aero_cd * speed
  ax = ax - drag * vx
  ay = ay - drag * vy
  az = az - drag * vz
  let w_mag = @vec.hypot3(sx, sy, sz)
  if w_mag > 1.0 {
    let s_ = ball_r * w_mag / speed
    let cl = @vec.dmin(1.0 / (2.0 + 1.0 / s_), aero_cl_max)
    let k = aero_k * cl * speed / w_mag // includes 1/|w| for the unit axis
    ax = ax + k * (sy * vz - sz * vy)
    ay = ay + k * (sz * vx - sx * vz)
    az = az + k * (sx * vy - sy * vx)
  }
  (ax, ay, az)
}

// One fixed step. Pushes Bounce/Net events onto `events`.
///|
pub fn step_ball(
  b : Ball,
  dt : Double,
  surface : Surface,
  events : Array[Event],
) -> Unit {
  let prev_x = b.px
  let prev_y = b.py
  let prev_z = b.pz
  let (ax, ay, az) = accel(b.vx, b.vy, b.vz, b.sx, b.sy, b.sz)
  b.vx = b.vx + ax * dt
  b.vy = b.vy + ay * dt
  b.vz = b.vz + az * dt
  b.px = b.px + b.vx * dt
  b.py = b.py + b.vy * dt
  b.pz = b.pz + b.vz * dt
  let decay = @math.exp(-dt / aero_spin_decay_tau)
  b.sx = b.sx * decay
  b.sy = b.sy * decay
  b.sz = b.sz * decay

  // Net crossing (z = 0 plane)
  if (prev_z > 0.0) != (b.pz > 0.0) && prev_z != b.pz {
    let f = prev_z / (prev_z - b.pz)
    let xc = prev_x + (b.px - prev_x) * f
    let yc = prev_y + (b.py - prev_y) * f
    if @vec.dabs(xc) < court_net_post_x + 0.15 && yc < net_height(xc) + ball_r {
      let tape = yc > net_height(xc) - 0.02
      let dir = if prev_z > 0.0 { 1.0 } else { -1.0 } // incoming side sign
      if tape {
        // net cord: trickles over, keeps direction, pops up
        b.px = xc
        b.py = yc
        b.pz = -dir * 0.02
        b.vz = b.vz * 0.45
        b.vx = b.vx * 0.7
        b.vy = @vec.dabs(b.vy) * 0.25 + 0.4
        b.sx = b.sx * 0.3
        b.sy = b.sy * 0.3
        b.sz = b.sz * 0.3
      } else {
        // body of the net: rebounds back to incoming side
        b.px = xc
        b.py = yc
        b.pz = dir * 0.03
        b.vz = b.vz * -0.22
        b.vx = b.vx * 0.55
        b.vy = b.vy * 0.35
        b.sx = b.sx * 0.2
        b.sy = b.sy * 0.2
        b.sz = b.sz * 0.2
      }
      events.push(Net(tape))
    }
  }

  // Ground bounce
  if b.py - ball_r <= 0.0 && b.vy < 0.0 {
    let speed = @vec.hypot3(b.vx, b.vy, b.vz)
    apply_bounce(b, surface)
    b.py = ball_r
    events.push(Bounce(b.px, b.py, b.pz, speed))
  }
}

// Predictions use 120 Hz (half cost, within the error budget of aiming/AI).
///|
let predict_dt : Double = 1.0 / 120.0

///|
pub struct Landing {
  x : Double
  y : Double
  z : Double
  t : Double
  vx : Double
  vy : Double
  vz : Double
}

///|
pub struct PosT {
  x : Double
  y : Double
  z : Double
  t : Double
}

///|
pub struct TrailPoint {
  x : Double
  y : Double
  z : Double
  t : Double
  after_bounce : Bool
}

///|
pub struct Trajectory {
  points : Array[TrailPoint]
  bounce_t : Double
  has_bounce : Bool
}

// First ground contact of the current trajectory (net included).
///|
pub fn predict_landing(b : Ball, surface : Surface, max_t~ : Double = 5.0) -> Landing? {
  let sim = copy_ball(b)
  let ev : Array[Event] = []
  for t = 0.0; t < max_t; t = t + predict_dt {
    ev.clear()
    step_ball(sim, predict_dt, surface, ev)
    for e in ev {
      match e {
        Bounce(ex, ey2, ez, _) =>
          return Some({
            x: ex,
            y: ey2,
            z: ez,
            t,
            vx: sim.vx,
            vy: sim.vy,
            vz: sim.vz,
          })
        Net(_) => ()
      }
    }
  }
  None
}

// First descending point at/just above waist height after the first bounce on
// `side_z_sign`'s side.
///|
pub fn predict_hit_point(
  b : Ball,
  surface : Surface,
  side_z_sign : Double,
  max_t~ : Double = 6.0,
) -> Landing? {
  let sim = copy_ball(b)
  let ev : Array[Event] = []
  let mut bounced_on_side = false
  for t = 0.0; t < max_t; t = t + predict_dt {
    ev.clear()
    step_ball(sim, predict_dt, surface, ev)
    for e in ev {
      match e {
        Bounce(_, _, ez, _) =>
          if @vec.dsign(ez) == side_z_sign {
            bounced_on_side = true
          }
        Net(_) => ()
      }
    }
    if bounced_on_side &&
      sim.vy < 0.0 &&
      sim.py <= ideal_contact_h + 0.1 &&
      @vec.dsign(sim.pz) == side_z_sign {
      return Some({
        x: sim.px,
        y: sim.py,
        z: sim.pz,
        t,
        vx: sim.vx,
        vy: sim.vy,
        vz: sim.vz,
      })
    }
  }
  None
}

// Candidate contact points between the first and second bounce on that side.
///|
pub fn sample_hit_points(
  b : Ball,
  surface : Surface,
  side_z_sign : Double,
  max_t~ : Double = 6.0,
  every~ : Double = 0.06,
  already_bounced~ : Bool = false,
) -> Array[PosT] {
  let sim = copy_ball(b)
  let ev : Array[Event] = []
  let out : Array[PosT] = []
  let mut bounces = if already_bounced { 1 } else { 0 }
  let mut next_sample = 0.0
  for t = 0.0; t < max_t; t = t + predict_dt {
    ev.clear()
    step_ball(sim, predict_dt, surface, ev)
    for e in ev {
      match e {
        Bounce(_, _, ez, _) => if @vec.dsign(ez) == side_z_sign { bounces = bounces + 1 }
        Net(_) => ()
      }
    }
    if bounces >= 2 {
      break
    }
    if bounces == 1 &&
      t >= next_sample &&
      @vec.dsign(sim.pz) == side_z_sign &&
      sim.py >= 0.3 &&
      sim.py <= 1.9 {
      out.push({ x: sim.px, y: sim.py, z: sim.pz, t })
      next_sample = t + every
    }
  }
  out
}

// Sampled predicted path for display.
///|
pub fn predict_trajectory(
  b : Ball,
  surface : Surface,
  side_z_sign : Double,
  max_t~ : Double = 4.0,
  every~ : Double = 0.04,
  already_bounced~ : Bool = false,
) -> Trajectory {
  let sim = copy_ball(b)
  let ev : Array[Event] = []
  let points : Array[TrailPoint] = []
  let mut bounces = if already_bounced { 1 } else { 0 }
  let mut bounce_t = 0.0
  let mut has_bounce = already_bounced
  let mut next_sample = 0.0
  for t = 0.0; t < max_t; t = t + predict_dt {
    ev.clear()
    step_ball(sim, predict_dt, surface, ev)
    for e in ev {
      match e {
        Bounce(_, _, ez, _) =>
          if @vec.dsign(ez) == side_z_sign {
            bounces = bounces + 1
            if !has_bounce {
              bounce_t = t
              has_bounce = true
            }
          }
        Net(_) => ()
      }
    }
    if bounces >= 2 {
      break
    }
    if t >= next_sample {
      points.push({
        x: sim.px,
        y: sim.py,
        z: sim.pz,
        t,
        after_bounce: bounces >= 1,
      })
      next_sample = t + every
    }
  }
  { points, bounce_t, has_bounce }
}

// Where/when the ball crosses the plane z = z_plane (before any 2nd bounce).
///|
pub fn predict_at_z(
  b : Ball,
  surface : Surface,
  z_plane : Double,
  max_t~ : Double = 5.0,
) -> Landing? {
  let sim = copy_ball(b)
  let ev : Array[Event] = []
  let mut prev_z = sim.pz
  for t = 0.0; t < max_t; t = t + predict_dt {
    ev.clear()
    step_ball(sim, predict_dt, surface, ev)
    if (prev_z - z_plane) * (sim.pz - z_plane) <= 0.0 && prev_z != sim.pz {
      return Some({
        x: sim.px,
        y: sim.py,
        z: sim.pz,
        t,
        vx: sim.vx,
        vy: sim.vy,
        vz: sim.vz,
      })
    }
    prev_z = sim.pz
  }
  None
}
