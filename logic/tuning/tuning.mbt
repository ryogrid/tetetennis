// Runtime-tunable parameter registry for the autotune pipeline
// (autotune_design/02-parameter-registry.md). Leaf package: physics/shots/ai
// read it; it imports nothing. Defaults equal the historical source literals
// (scales are exactly 1.0), so behavior with no set_param calls is
// bit-identical to the pre-registry build.
//
// cpu_p flags that side P is AI-driven (CPU-vs-CPU mode); it is set by
// setCpuMode, never by set_param, and reset_params does not touch it.

///|
pub(all) struct Tuning {
  // ball physics
  mut aero_cd : Double
  mut aero_cl_max : Double
  mut aero_spin_decay_tau : Double
  mut bounce_v_ref : Double
  mut bounce_slope : Double
  mut bounce_min_frac : Double
  mut spin_bounce_vertical : Double
  // stat -> physics mappings
  mut flat_speed_base : Double
  mut flat_speed_slope : Double
  mut topspin_rpm_base : Double
  mut topspin_rpm_slope : Double
  mut slice_rpm_base : Double
  mut slice_rpm_slope : Double
  mut err_mul_hi : Double // error multiplier at ctl=0
  mut err_mul_slope : Double // reduction at ctl=100 (value there = hi - slope)
  mut run_speed_scale : Double
  mut run_accel_scale : Double
  mut reach_scale : Double
  // stroke model
  mut stroke_err_x : Double
  mut stroke_err_z : Double
  mut stroke_err_spin : Double
  mut stroke_err_speed : Double
  mut err_quality_gain : Double
  mut mishit_q_max : Double
  mut mishit_prob : Double
  mut q_speed_floor : Double
  mut jam_threshold : Double
  mut jam_scale : Double
  mut aim_x_scale : Double
  mut rally_depth_min : Double
  mut rally_depth_max : Double
  // serve model
  mut serve_err_x : Double
  mut serve_err_z : Double
  mut serve_err_speed : Double
  mut serve_speed_min : Double
  mut serve_speed_max : Double
  mut serve_stat_base : Double
  mut serve_stat_slope : Double
  mut serve_sweet_lo : Double
  mut serve_sweet_hi : Double // full-accuracy band = [lo, hi]; hi < 1.0
  // AI skill scales (uniform across difficulty presets)
  mut ai_pos_err_scale : Double
  mut ai_jitter_scale : Double
  mut ai_react_scale : Double
  mut ai_choice_noise_scale : Double
  mut ai_tactical_scale : Double
  // mode flag (not a tunable)
  mut cpu_p : Bool
}

///|
fn defaults() -> Tuning {
  {
    aero_cd: 0.55,
    aero_cl_max: 0.40,
    aero_spin_decay_tau: 7.0,
    bounce_v_ref: 7.1,
    bounce_slope: 0.012,
    bounce_min_frac: 0.65,
    spin_bounce_vertical: 0.004,
    flat_speed_base: 18.0,
    flat_speed_slope: 7.0,
    topspin_rpm_base: 2200.0,
    topspin_rpm_slope: 2600.0,
    slice_rpm_base: 1500.0,
    slice_rpm_slope: 1800.0,
    err_mul_hi: 1.6,
    err_mul_slope: 1.2,
    run_speed_scale: 1.0,
    run_accel_scale: 1.0,
    reach_scale: 1.0,
    stroke_err_x: 0.30,
    stroke_err_z: 0.55,
    stroke_err_spin: 0.06,
    stroke_err_speed: 0.03,
    err_quality_gain: 2.2,
    mishit_q_max: 0.3,
    mishit_prob: 0.35,
    q_speed_floor: 0.65,
    jam_threshold: 26.0,
    jam_scale: 14.0,
    aim_x_scale: 2.8,
    rally_depth_min: 4.5,
    rally_depth_max: 11.2,
    serve_err_x: 0.30,
    serve_err_z: 0.35,
    serve_err_speed: 0.025,
    serve_speed_min: 30.0,
    serve_speed_max: 54.0,
    serve_stat_base: 0.82,
    serve_stat_slope: 0.36,
    serve_sweet_lo: 0.70,
    serve_sweet_hi: 0.88,
    ai_pos_err_scale: 1.0,
    ai_jitter_scale: 1.0,
    ai_react_scale: 1.0,
    ai_choice_noise_scale: 1.0,
    ai_tactical_scale: 1.0,
    cpu_p: false,
  }
}

///|
pub let t : Tuning = defaults()

///|
pub fn cpu_p_active() -> Bool {
  t.cpu_p
}

///|
pub fn set_cpu_p(on : Bool) -> Unit {
  t.cpu_p = on
}

///|
// Restore all tunables to defaults. Deliberately leaves cpu_p alone —
// mode and tunables are orthogonal.
pub fn reset_params() -> Unit {
  let d = defaults()
  t.aero_cd = d.aero_cd
  t.aero_cl_max = d.aero_cl_max
  t.aero_spin_decay_tau = d.aero_spin_decay_tau
  t.bounce_v_ref = d.bounce_v_ref
  t.bounce_slope = d.bounce_slope
  t.bounce_min_frac = d.bounce_min_frac
  t.spin_bounce_vertical = d.spin_bounce_vertical
  t.flat_speed_base = d.flat_speed_base
  t.flat_speed_slope = d.flat_speed_slope
  t.topspin_rpm_base = d.topspin_rpm_base
  t.topspin_rpm_slope = d.topspin_rpm_slope
  t.slice_rpm_base = d.slice_rpm_base
  t.slice_rpm_slope = d.slice_rpm_slope
  t.err_mul_hi = d.err_mul_hi
  t.err_mul_slope = d.err_mul_slope
  t.run_speed_scale = d.run_speed_scale
  t.run_accel_scale = d.run_accel_scale
  t.reach_scale = d.reach_scale
  t.stroke_err_x = d.stroke_err_x
  t.stroke_err_z = d.stroke_err_z
  t.stroke_err_spin = d.stroke_err_spin
  t.stroke_err_speed = d.stroke_err_speed
  t.err_quality_gain = d.err_quality_gain
  t.mishit_q_max = d.mishit_q_max
  t.mishit_prob = d.mishit_prob
  t.q_speed_floor = d.q_speed_floor
  t.jam_threshold = d.jam_threshold
  t.jam_scale = d.jam_scale
  t.aim_x_scale = d.aim_x_scale
  t.rally_depth_min = d.rally_depth_min
  t.rally_depth_max = d.rally_depth_max
  t.serve_err_x = d.serve_err_x
  t.serve_err_z = d.serve_err_z
  t.serve_err_speed = d.serve_err_speed
  t.serve_speed_min = d.serve_speed_min
  t.serve_speed_max = d.serve_speed_max
  t.serve_stat_base = d.serve_stat_base
  t.serve_stat_slope = d.serve_stat_slope
  t.serve_sweet_lo = d.serve_sweet_lo
  t.serve_sweet_hi = d.serve_sweet_hi
  t.ai_pos_err_scale = d.ai_pos_err_scale
  t.ai_jitter_scale = d.ai_jitter_scale
  t.ai_react_scale = d.ai_react_scale
  t.ai_choice_noise_scale = d.ai_choice_noise_scale
  t.ai_tactical_scale = d.ai_tactical_scale
}

///|
// Set one tunable by registry name. Returns false for unknown names.
pub fn set_param(name : String, v : Double) -> Bool {
  match name {
    "aero_cd" => t.aero_cd = v
    "aero_cl_max" => t.aero_cl_max = v
    "aero_spin_decay_tau" => t.aero_spin_decay_tau = v
    "bounce_v_ref" => t.bounce_v_ref = v
    "bounce_slope" => t.bounce_slope = v
    "bounce_min_frac" => t.bounce_min_frac = v
    "spin_bounce_vertical" => t.spin_bounce_vertical = v
    "flat_speed_base" => t.flat_speed_base = v
    "flat_speed_slope" => t.flat_speed_slope = v
    "topspin_rpm_base" => t.topspin_rpm_base = v
    "topspin_rpm_slope" => t.topspin_rpm_slope = v
    "slice_rpm_base" => t.slice_rpm_base = v
    "slice_rpm_slope" => t.slice_rpm_slope = v
    "err_mul_hi" => t.err_mul_hi = v
    "err_mul_slope" => t.err_mul_slope = v
    "run_speed_scale" => t.run_speed_scale = v
    "run_accel_scale" => t.run_accel_scale = v
    "reach_scale" => t.reach_scale = v
    "stroke_err_x" => t.stroke_err_x = v
    "stroke_err_z" => t.stroke_err_z = v
    "stroke_err_spin" => t.stroke_err_spin = v
    "stroke_err_speed" => t.stroke_err_speed = v
    "err_quality_gain" => t.err_quality_gain = v
    "mishit_q_max" => t.mishit_q_max = v
    "mishit_prob" => t.mishit_prob = v
    "q_speed_floor" => t.q_speed_floor = v
    "jam_threshold" => t.jam_threshold = v
    "jam_scale" => t.jam_scale = v
    "aim_x_scale" => t.aim_x_scale = v
    "rally_depth_min" => t.rally_depth_min = v
    "rally_depth_max" => t.rally_depth_max = v
    "serve_err_x" => t.serve_err_x = v
    "serve_err_z" => t.serve_err_z = v
    "serve_err_speed" => t.serve_err_speed = v
    "serve_speed_min" => t.serve_speed_min = v
    "serve_speed_max" => t.serve_speed_max = v
    "serve_stat_base" => t.serve_stat_base = v
    "serve_stat_slope" => t.serve_stat_slope = v
    "serve_sweet_lo" => t.serve_sweet_lo = v
    "serve_sweet_hi" => t.serve_sweet_hi = v
    "ai_pos_err_scale" => t.ai_pos_err_scale = v
    "ai_jitter_scale" => t.ai_jitter_scale = v
    "ai_react_scale" => t.ai_react_scale = v
    "ai_choice_noise_scale" => t.ai_choice_noise_scale = v
    "ai_tactical_scale" => t.ai_tactical_scale = v
    _ => return false
  }
  true
}

///|
// Read one tunable by registry name; NaN for unknown names.
pub fn get_param(name : String) -> Double {
  match name {
    "aero_cd" => t.aero_cd
    "aero_cl_max" => t.aero_cl_max
    "aero_spin_decay_tau" => t.aero_spin_decay_tau
    "bounce_v_ref" => t.bounce_v_ref
    "bounce_slope" => t.bounce_slope
    "bounce_min_frac" => t.bounce_min_frac
    "spin_bounce_vertical" => t.spin_bounce_vertical
    "flat_speed_base" => t.flat_speed_base
    "flat_speed_slope" => t.flat_speed_slope
    "topspin_rpm_base" => t.topspin_rpm_base
    "topspin_rpm_slope" => t.topspin_rpm_slope
    "slice_rpm_base" => t.slice_rpm_base
    "slice_rpm_slope" => t.slice_rpm_slope
    "err_mul_hi" => t.err_mul_hi
    "err_mul_slope" => t.err_mul_slope
    "run_speed_scale" => t.run_speed_scale
    "run_accel_scale" => t.run_accel_scale
    "reach_scale" => t.reach_scale
    "stroke_err_x" => t.stroke_err_x
    "stroke_err_z" => t.stroke_err_z
    "stroke_err_spin" => t.stroke_err_spin
    "stroke_err_speed" => t.stroke_err_speed
    "err_quality_gain" => t.err_quality_gain
    "mishit_q_max" => t.mishit_q_max
    "mishit_prob" => t.mishit_prob
    "q_speed_floor" => t.q_speed_floor
    "jam_threshold" => t.jam_threshold
    "jam_scale" => t.jam_scale
    "aim_x_scale" => t.aim_x_scale
    "rally_depth_min" => t.rally_depth_min
    "rally_depth_max" => t.rally_depth_max
    "serve_err_x" => t.serve_err_x
    "serve_err_z" => t.serve_err_z
    "serve_err_speed" => t.serve_err_speed
    "serve_speed_min" => t.serve_speed_min
    "serve_speed_max" => t.serve_speed_max
    "serve_stat_base" => t.serve_stat_base
    "serve_stat_slope" => t.serve_stat_slope
    "serve_sweet_lo" => t.serve_sweet_lo
    "serve_sweet_hi" => t.serve_sweet_hi
    "ai_pos_err_scale" => t.ai_pos_err_scale
    "ai_jitter_scale" => t.ai_jitter_scale
    "ai_react_scale" => t.ai_react_scale
    "ai_choice_noise_scale" => t.ai_choice_noise_scale
    "ai_tactical_scale" => t.ai_tactical_scale
    _ => @double.not_a_number
  }
}
