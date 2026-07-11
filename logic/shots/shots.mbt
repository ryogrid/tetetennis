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
// like Lob); its moderate theta band gives a low arc while backspin floats
// the ball just over the net.
///|
pub fn shot_def(t : ShotType) -> (Double, Double, Double) {
  match t {
    Flat => (@tuning.t.flat_speed_mul, 0.0, @tuning.t.flat_theta_max)
    Topspin =>
      (
        @tuning.t.topspin_speed_mul,
        @tuning.t.topspin_theta_min,
        @tuning.t.topspin_theta_max,
      )
    Slice => (@tuning.t.slice_speed_mul, 1.0, 16.0)
    Lob => (1.00, 28.0, 55.0)
    Drop => (0.50, 26.0, 32.0)
  }
}

// Always-on reach grace for the human (m): connect to slightly out-of-position
// balls (in-reach quality unchanged).
///|
let reach_grace : Double = 0.2

// ---- practice-mode feed mapping (design/practice-mode) ----
// Stroke feeds offer all five shot types, indexed in menu order.
///|
pub fn practice_stroke_type(i : Int) -> ShotType {
  match i {
    0 => Flat
    1 => Topspin
    2 => Slice
    3 => Lob
    _ => Drop
  }
}

// 9-target cells: shallow feed = the down row (a true short ball), deep feed
// = the none row (the up row would fault too many reps to drill against).
///|
pub let practice_shallow_aim : Double = -1.0 // forecourt bounce (down row)

///|
pub let practice_deep_aim : Double = 0.0 // backcourt bounce (none row)

// Depth choice -> compute_stroke aim_depth. 0 shallow, 1 deep, 2 random (the
// caller supplies the coin flip so this stays pure / testable).
///|
pub fn practice_depth_aim(depth : Int, pick_deep : Bool) -> Double {
  match depth {
    0 => practice_shallow_aim
    1 => practice_deep_aim
    _ => if pick_deep { practice_deep_aim } else { practice_shallow_aim }
  }
}

// Topspin/Slice charge enhancements (Appendix A.2). cc in [0,1] (overcharge caps
// the enhancement at 1) amplifies each shot's identity.
///|
let topspin_charge_spin_gain : Double = 0.6

///|
let topspin_charge_angle : Double = 0.7

///|
let topspin_attack_shorten : Double = 5.5 // max pull toward the net (m)

///|
let topspin_attack_min_depth : Double = 4.0 // never pull closer than this (m)

///|
let slice_charge_back_gain : Double = 0.6

///|
let slice_charge_depth : Double = 2.0 // max extra depth toward the baseline (m)

// Smash (Appendix A.3): a high point in the forecourt hit Flat slams downward.
///|
let smash_height : Double = 1.7 // contact height to qualify (m)

///|
let smash_forecourt : Double = 8.5 // max distance from the net to qualify (m)

///|
let smash_theta_min : Double = -14.0

///|
let smash_theta_max : Double = 2.0

// Choose the swing motion for animation at swing-start, mirroring the smash/volley
// contact criteria so the rendered motion matches the shot's physics judgment.
// `volley_forecourt` lives in the game layer, so it is passed in.
///|
pub fn swing_motion(
  bounces : Int,
  ball_y : Double,
  ball_z : Double,
  ty : ShotType,
  volley_forecourt : Double,
) -> String {
  if ty == Flat && ball_y >= smash_height && @vec.dabs(ball_z) < smash_forecourt {
    "smash"
  } else if bounces == 0 &&
    @vec.dabs(ball_z) < volley_forecourt &&
    (ty == Flat || ty == Slice) {
    "volley"
  } else {
    ""
  }
}

// Fast-ball jam / counter (Appendix A.3): thresholds live in @tuning
// (jam_threshold 26 m/s, jam_scale 14 m/s).
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
  reach_mul~ : Double = 1.0,
) -> ContactQuality {
  let d = @vec.hypot2(ball_x - player_x, ball_z - player_z)
  let h = ball_y
  let reach = @physics.reach(stats.rea) * reach_mul
  let human = side == @rules.P && !@tuning.cpu_p_active()
  let reach_eff = reach + (if human { reach_grace } else { 0.0 })
  let h_max = 1.15 + reach_eff
  if d > reach_eff || h > h_max {
    return { q: 0.0, whiff: true, d, stretched: true }
  }
  // assist (human only) widens the forgiving bands; the CPU is never eased
  let aid = human && @assist.assist_on()
  // Sweet-zone half-widths doubled around the ideal contact radius (the flat
  // band is twice as forgiving left/right). lo goes slightly negative, so the
  // too-close "jam" branch below no longer fires within reach.
  let lo = @physics.ideal_contact_r - 0.70
  let hi = @physics.ideal_contact_r + (if aid { 0.80 } else { 0.50 })
  let q_dist = if d < lo {
    (if aid { 0.70 } else { 0.55 }) + (if aid { 0.30 } else { 0.45 }) * (d / lo)
  } else if d <= hi {
    1.0
  } else {
    @vec.clampd(1.0 - (d - hi) / (reach - hi), 0.0, 1.0)
  }
  // Height flat band and the penalty ramp both doubled (twice as forgiving
  // up/down); h_cap is the max penalty depth, not a band width, so it is left.
  let h_flat = if aid { 0.90 } else { 0.6 }
  let h_cap = if aid { 0.40 } else { 0.55 }
  let q_height = 1.0 -
    @vec.clampd(
      (@vec.dabs(h - @physics.ideal_contact_h) - h_flat) / 1.8,
      0.0,
      h_cap,
    )
  let v_in = @vec.hypot3(vx, vy, vz)
  let q_speed = @vec.clampd(
    1.0 - (v_in - 18.0) / 55.0,
    if aid { 0.80 } else { @tuning.t.q_speed_floor },
    1.0,
  )
  let q = q_dist * q_height * q_speed
  { q, whiff: false, d, stretched: d > hi && q_dist < 0.35 }
}

///|
/// Quantize an aim pair to the 9 cells: radial gate, then eight even
/// 45-degree sectors (an axis registers when its magnitude exceeds
/// sin(22.5deg) of the radial magnitude). Keyboard singles (1,0) and
/// diagonals (~0.707,0.707) classify exactly; any joystick push past 35%
/// deflection aims at full cell strength.
pub fn aim_cells(ax : Double, az : Double) -> (Double, Double) {
  let r = @vec.hypot2(ax, az)
  if r < 0.35 {
    return (0.0, 0.0)
  }
  let lim = 0.383 * r // sin(22.5deg)
  let cx = if ax > lim { 1.0 } else if ax < -lim { -1.0 } else { 0.0 }
  let cz = if az > lim { 1.0 } else if az < -lim { -1.0 } else { 0.0 }
  (cx, cz)
}

///|
/// Hitter-frame cell -> (lateral offset toward the hitter's right, depth
/// from the net) for rally shots. Single lateral presses use the safe side
/// margin; diagonals hug the corner. Drop keeps its short identity with its
/// own depth rows.
pub fn rally_cell_target(
  cell_x : Double,
  cell_z : Double,
  typ : ShotType,
) -> (Double, Double) {
  // Diagonals (corners) get their own looser depth + width than the straight
  // rows, so a corner aim is aggressive but not a near-certain out.
  let is_corner = cell_x != 0.0 && cell_z != 0.0
  let depth = if typ == Drop {
    if cell_z > 0.0 { 3.8 } else if cell_z < 0.0 { 1.8 } else { 2.4 }
  } else if cell_z > 0.0 {
    @physics.court_half_len -
    (if is_corner { @tuning.t.aim_corner_deep_margin } else { @tuning.t.aim_deep_margin })
  } else if cell_z < 0.0 {
    if is_corner { @tuning.t.aim_corner_short_depth } else { @tuning.t.aim_short_depth }
  } else {
    @tuning.t.aim_safe_depth
  }
  let margin = if is_corner {
    @tuning.t.aim_corner_margin
  } else {
    @tuning.t.aim_side_safe_margin
  }
  (cell_x * (@physics.court_half_width - margin), depth)
}

///|
/// Shallow-contact aggression: a shorter contact point yields a faster shot.
/// Piecewise-linear in distance-from-net: gentle baseline->service-line ramp
/// (1.0 -> shallow_speed_mid), steep service-line->net ramp (mid -> net).
/// Contact behind the baseline clamps to 1.0.
fn shallow_speed_mul(contact_z_abs : Double) -> Double {
  let sl = @physics.court_service_line
  let hl = @physics.court_half_len
  let d = @vec.clampd(contact_z_abs, 0.0, hl)
  if d >= sl {
    1.0 + (@tuning.t.shallow_speed_mid - 1.0) * (hl - d) / (hl - sl)
  } else {
    @tuning.t.shallow_speed_net +
    (@tuning.t.shallow_speed_mid - @tuning.t.shallow_speed_net) * d / sl
  }
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
  smash : Bool
  volley : Bool
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
  charge_cc~ : Double = 0.0,
  volley~ : Bool = false,
  reach_mul~ : Double = 1.0,
) -> Stroke? {
  let cq = contact_quality(
    player_x, player_z, ball_x, ball_y, ball_z, vx, vy, vz, stats, side,
    reach_mul~,
  )
  if cq.whiff {
    return None
  }
  // human only: soften every bad-contact penalty by lifting quality 20%
  // toward 1 (CPU-driven side P in balance studies is exempt)
  let human = side == @rules.P && !@tuning.cpu_p_active()
  let q = if human { cq.q + (1.0 - cq.q) * 0.2 } else { cq.q }
  let aid = side == @rules.P && @assist.assist_on()
  let mut typ = shot_type
  if cq.stretched && typ != Slice {
    typ = Lob // forced defensive ball
  }
  let z_sign = match side {
    @rules.P => -1.0
    @rules.C => 1.0
  }
  let (def_speed_mul, def_theta_min0, def_theta_max0) = shot_def(typ)
  let mut def_theta_min = def_theta_min0
  let mut def_theta_max = def_theta_max0
  // Discrete 9-target aiming (design_docs/ball-control-and-aiming.md):
  // quantize the aim pair to a cell, map it to hitter-frame coordinates, and
  // gate the DEPTH authority by contact quality — length control is internal
  // power modulation the hitter can only execute on clean contact. Lateral
  // aim keeps full authority (the error model already widens with bad q).
  let (cell_x, cell_z) = aim_cells(aim_x, aim_depth)
  let (x_right, cell_depth) = rally_cell_target(cell_x, cell_z, typ)
  let natural_z = match typ {
    Flat => 7.0
    Topspin => 7.5
    Slice => 6.5
    Lob => 7.5
    Drop => 2.4 // dies just past the net
  }
  let len_ctrl = @vec.clampd((q - 0.30) / 0.60, 0.0, 1.0)
  let achieved_z = natural_z + (cell_depth - natural_z) * len_ctrl
  let mut tx = -z_sign * x_right // hitter's right is -z_sign in world x
  let mut tz = z_sign * achieved_z
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
      speed = 10.0 + 4.0 * stats.pow / 100.0
      spin_rpm = 500.0
    }
    Drop => {
      // slowest stroke: a backspin touch that floats just over the net and
      // checks on the bounce. Speed scales with slice skill, not power.
      speed = 8.0 + 2.5 * stats.slc / 100.0
      spin_rpm = -@physics.slice_rpm(stats.slc) * (0.55 + 0.45 * q) * 0.9
    }
  }
  // Smash: a high point in the forecourt hit Flat becomes a downward bomb.
  // Less quality-dependent, so it stays fast even from an awkward overhead.
  let is_smash = typ == Flat &&
    ball_y >= smash_height &&
    @vec.dabs(ball_z) < smash_forecourt
  if is_smash {
    speed = @physics.smash_speed(stats.pow) * (0.80 + 0.20 * q) // light q-dependence
    spin_rpm = 200.0 + 200.0 * q
    def_theta_min = smash_theta_min
    def_theta_max = smash_theta_max
  }
  // Volley: a Flat/Slice taken out of the air in the forecourt is a block/punch
  // (restrained power, flatter, very accurate, and charge barely matters). The
  // game layer passes `volley` when the ball has not bounced and is near the net.
  let do_volley = volley && !is_smash
  if do_volley {
    speed = speed * 0.80 // restrained block
    def_theta_max = @vec.dmin(def_theta_max, 12.0) // punch flatter
  }
  // Topspin/Slice charge enhancements: charge amplifies each shot's identity.
  let cc = @vec.clampd(charge_cc, 0.0, 1.0)
  if cc > 0.0 && !do_volley {
    match typ {
      Topspin => {
        // heavier topspin + wider cross-court angle
        spin_rpm = spin_rpm * (1.0 + topspin_charge_spin_gain * cc)
        tx = @vec.clampd(
          tx * (1.0 + topspin_charge_angle * cc),
          -(@physics.court_half_width - @tuning.t.aim_corner_margin),
          @physics.court_half_width - @tuning.t.aim_corner_margin,
        )
        // short-angle "attack": under a high, controlled, angled hit, pull the
        // landing toward the service line and drive it lower & faster.
        let height_cond = if ball_y >= 1.0 { 1.0 } else { 0.0 }
        let v_in = @vec.hypot3(vx, vy, vz)
        let pace_ok = if v_in < 22.0 { 1.0 } else { 0.0 }
        let angle_frac = @vec.clampd(@vec.dabs(aim_x), 0.0, 1.0)
        let pull = topspin_attack_shorten * cc * height_cond * pace_ok * angle_frac
        // never DEEPEN an already-short (down-cell) aim
        if pull >= 1.0 && @vec.dabs(tz) > topspin_attack_min_depth {
          let cur = @vec.dabs(tz)
          tz = z_sign * @vec.dmax(topspin_attack_min_depth, cur - pull)
          speed = speed * (1.0 + 0.18 * cc) // low/fast drive
          def_theta_max = @vec.dmax(20.0, def_theta_max - 8.0 * cc) // flatter
        }
      }
      Slice => {
        // deeper float with more bite (spin_rpm is negative -> grow magnitude);
        // capped at the up-row line so charge never pushes past the deepest cell
        spin_rpm = spin_rpm * (1.0 + slice_charge_back_gain * cc)
        let cur = @vec.dabs(tz)
        tz = z_sign *
          @vec.dmin(
            @physics.court_half_len - @tuning.t.aim_deep_margin,
            cur + slice_charge_depth * cc,
          )
      }
      _ => ()
    }
  }
  // charge: power scales the launch speed; a sweet-spot release (Perfect Hit)
  // adds a modest speed/spin bonus and tightens aim; overcharge sprays the ball.
  let perfect = perfect_eligible && q >= 0.90
  let eff_power = if do_volley { 1.0 } else { power_mul } // charge barely matters
  speed = speed * eff_power
  if perfect {
    speed = speed * 1.08
    spin_rpm = spin_rpm * 1.12
  }
  // a volley is a precise block -> much tighter aim
  let aim_acc = (if perfect { 0.6 } else { 1.0 }) * (if do_volley { 0.4 } else { 1.0 })
  // error model
  let err_mul = @physics.err_mul_base(stats.ctl) *
    (1.0 + @tuning.t.err_quality_gain * (1.0 - q))
  tx = tx + rng.draw() * @tuning.t.stroke_err_x * err_mul * aim_acc
  tz = tz + z_sign * (rng.draw() * @tuning.t.stroke_err_z * err_mul * aim_acc)
  tz = z_sign *
    @vec.clampd(@vec.dabs(tz), 2.0, @physics.court_half_len + 2.5)
  spin_rpm = spin_rpm * (1.0 + rng.draw() * @tuning.t.stroke_err_spin * err_mul)
  speed = speed * (1.0 + rng.draw() * @tuning.t.stroke_err_speed * err_mul)
  let mut mishit = false
  let mut yaw_err = 0.0
  // The human's mishit gate is looser (independent of assist): it triggers
  // only on clearly poor contact and less often, so off-centre hits punish
  // less. The CPU / autotune-driven side keeps the full criteria.
  let mishit_q = if human { @tuning.t.mishit_q_max * 0.7 } else { @tuning.t.mishit_q_max }
  let mishit_p = if aid {
    0.10
  } else if human {
    0.16
  } else {
    @tuning.t.mishit_prob
  }
  if q < mishit_q && rng.uniform() < mishit_p {
    mishit = true
    yaw_err = (rng.uniform() - 0.5) * 0.5
    speed = speed * 0.55
    spin_rpm = spin_rpm * 0.3
  }
  // Fast-ball jam + counter/redirect: incoming pace above ~26 m/s either jams a
  // weak looping sitter (worst for topspin, best blocked with slice, reduced by
  // charge prep and good posture) or, when handled cleanly, is redirected faster.
  let in_pace = @vec.hypot3(vx, vy, vz)
  let pace_over = @vec.dmax(0.0, in_pace - @tuning.t.jam_threshold)
  if pace_over > 0.0 {
    let weakness = match typ {
      Slice => 0.35
      Flat => 0.60
      Topspin => 1.00
      Lob => 1.30
      Drop => 1.30
    }
    let jam = @vec.clampd(
      pace_over / @tuning.t.jam_scale * weakness * (1.0 - 0.7 * cc) * (0.5 + 0.5 * (1.0 - q)),
      0.0,
      1.0,
    )
    if jam > 0.0 {
      speed = speed * (1.0 - 0.55 * jam)
      spin_rpm = spin_rpm * (1.0 - 0.7 * jam)
      def_theta_min = def_theta_min + 6.0 * jam // loft the sitter up
      def_theta_max = def_theta_max + 10.0 * jam
      let cur = @vec.dabs(tz)
      tz = z_sign * @vec.dmax(2.5, cur - 3.0 * jam) // and shorter
      // the human is jammed into an outright mishit less readily
      if jam > (if human { 0.45 } else { 0.3 }) {
        mishit = true
      }
    }
    // counter/redirect: a clean block/drive off pace comes back faster
    let counter_gain = match typ {
      Flat => 0.30
      Slice => 0.30
      Topspin => 0.12
      _ => 0.0
    }
    speed = speed *
      (1.0 + counter_gain * @vec.dmin(1.0, pace_over / 18.0) * (1.0 - jam) * q)
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
  // Depth-dependent speed: aiming short/long is internal power modulation.
  // Only drive shots (Flat) need the explicit cut — the control solver
  // (Topspin/Slice/Lob/Drop) derives pace from the target geometry itself.
  // Reads achieved_z so poor contact collapses the modulation together with
  // the depth authority.
  if typ == Flat && !is_smash {
    let safe = @tuning.t.aim_safe_depth
    let mul = if achieved_z >= safe {
      let deep = @physics.court_half_len - @tuning.t.aim_deep_margin
      1.0 + 0.05 * (achieved_z - safe) / @vec.dmax(deep - safe, 0.1)
    } else {
      1.0 -
      @tuning.t.aim_short_speed_drop *
      (safe - achieved_z) /
      @vec.dmax(safe - @tuning.t.aim_short_depth, 0.1)
    }
    speed = speed * @vec.clampd(mul, 0.6, 1.05)
  }
  // shallow-contact aggression (groundstrokes only; volleys/smash/touch
  // shots keep their own speed identity)
  if !do_volley && !is_smash && (typ == Flat || typ == Topspin || typ == Slice) {
    speed = speed * shallow_speed_mul(@vec.dabs(ball_z))
  }
  // uniform ball-speed reduction across every shot category (flat/topspin/slice/
  // volley/smash/lob/drop all funnel through `speed`); default scale 1.0.
  speed = speed * @tuning.t.ball_speed_scale
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
    drive=typ == Flat, // speed-priority for flat/smash, control for spin shots
  )
  let mut out_vx = solved.vx
  let mut out_vz = solved.vz
  if yaw_err != 0.0 {
    let c = @math.cos(yaw_err)
    let s = @math.sin(yaw_err)
    out_vx = solved.vx * c - solved.vz * s
    out_vz = solved.vx * s + solved.vz * c
  }
  let out_vy = solved.vy
  Some({
    vx: out_vx,
    vy: out_vy,
    vz: out_vz,
    sx: solved.sx,
    sy: solved.sy,
    sz: solved.sz,
    q,
    mishit,
    perfect,
    smash: is_smash,
    volley: do_volley,
    shot_type: typ,
  })
}
