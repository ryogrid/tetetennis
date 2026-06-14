// Single source of truth for physics / court constants. SI units, Y-up.
// Net plane at z = 0. Human on +z, CPU on -z. Ported from old/src/physics/constants.js.

///|
pub let g : Double = 9.81

///|
pub let dt : Double = 1.0 / 240.0

///|
pub let ball_m : Double = 0.057

///|
pub let ball_r : Double = 0.033

// Aerodynamics. aero_k = rho * A / (2m), A = pi r^2.
///|
pub let aero_rho : Double = 1.21

///|
pub let aero_cd : Double = 0.55

///|
pub let aero_k : Double = 1.21 * @math.PI * ball_r * ball_r / (2.0 * ball_m)

///|
pub let aero_cl_max : Double = 0.40

///|
pub let aero_spin_decay_tau : Double = 7.0

// Court geometry.
///|
pub let court_half_len : Double = 11.885

///|
pub let court_half_width : Double = 4.115

///|
pub let court_doubles_half_width : Double = 5.485

///|
pub let court_service_line : Double = 6.40

///|
pub let court_net_post_x : Double = 5.029

// Net.
///|
pub let net_h_center : Double = 0.914

///|
pub let net_h_post : Double = 1.07

///|
pub fn net_height(x : Double) -> Double {
  net_h_center + 0.156 * @vec.dmin(@vec.dabs(x) / court_net_post_x, 1.0)
}

///|
pub let line_grace : Double = ball_r

// Speed dependence of vertical restitution:
//   eyEff = ey * clamp(1 - slope * (|vyIn| - vRef), minFrac, 1)
///|
pub let bounce_v_ref : Double = 7.1

///|
pub let bounce_slope : Double = 0.012

///|
pub let bounce_min_frac : Double = 0.65

// Player movement bounds (human side; mirror z for CPU).
///|
pub let player_x_min : Double = -7.0

///|
pub let player_x_max : Double = 7.0

///|
pub let player_z_min : Double = 0.45

///|
pub let player_z_max : Double = 16.0

///|
pub let rpm_to_rads : Double = @math.PI * 2.0 / 60.0

// Ideal stroke contact: ball at waist height, an arm-plus-racket length away.
///|
pub let ideal_contact_h : Double = 0.85

///|
pub let ideal_contact_r : Double = 0.65

// Global pace: scales every shot's base launch speed.
///|
pub let pace : Double = 0.64

// Runtime pace multiplier on top of pace (the assist axis lowers it). 1 = classic.
///|
let pace_factor : Ref[Double] = { val: 1.0 }

///|
pub fn set_pace_factor(f : Double) -> Unit {
  pace_factor.val = f
}

///|
pub fn get_pace_factor() -> Double {
  pace_factor.val
}

///|
pub fn eff_pace() -> Double {
  pace * pace_factor.val
}

// Surface bounce parameters. ey = vertical restitution at the ITF drop-test
// impact speed, mu = sliding friction.
///|
pub struct Surface {
  id : String
  ey : Double
  mu : Double
}

///|
pub let surface_clay : Surface = { id: "clay", ey: 0.81, mu: 0.80 }

///|
pub let surface_hard : Surface = { id: "hard", ey: 0.75, mu: 0.56 }

///|
pub let surface_grass : Surface = { id: "grass", ey: 0.66, mu: 0.38 }

///|
pub fn surface_by_id(id : String) -> Surface {
  match id {
    "clay" => surface_clay
    "grass" => surface_grass
    _ => surface_hard
  }
}

// Character stat (0-100) -> physics mappings (old STATS_MAP).
///|
pub fn max_flat_speed(pow : Double) -> Double {
  (26.0 + 10.0 * pow / 100.0) * eff_pace()
}

///|
pub fn topspin_rpm(spn : Double) -> Double {
  2200.0 + 2600.0 * spn / 100.0
}

///|
pub fn slice_rpm(slc : Double) -> Double {
  1500.0 + 1800.0 * slc / 100.0
}

///|
pub fn serve_flat_speed(srv : Double) -> Double {
  (40.0 + 16.0 * srv / 100.0) * eff_pace()
}

// Overhead smash: a high forecourt flat slammed down. Much faster than a
// groundstroke and only lightly quality-dependent.
///|
pub fn smash_speed(pow : Double) -> Double {
  (42.0 + 10.0 * pow / 100.0) * eff_pace()
}

///|
pub fn run_speed(spd : Double) -> Double {
  (5.2 + 2.6 * spd / 100.0) * 1.5
}

///|
pub fn run_accel(spd : Double) -> Double {
  (9.0 + 6.0 * spd / 100.0) * 1.5
}

///|
pub fn err_mul_base(ctl : Double) -> Double {
  1.6 - 1.2 * ctl / 100.0
}

///|
pub fn reach(rea : Double) -> Double {
  (1.25 + 0.25 * rea / 100.0) * 1.5
}

///|
pub fn serve_contact_h(rea : Double) -> Double {
  2.55 + 0.55 * rea / 100.0
}
