// CPU-vs-CPU autotune surface (autotune_design/01, 03). Same package as
// game.js.mbt so it can see Game/MatchState; .js.mbt because those types are
// JS-backend-only. In CPU mode side P is driven by a second @ai.Ai fed a
// mirrored world view, so logic/ai stays side-agnostic (it is hardcoded to
// the -z half).

///|
// Per-point record for the machine-readable match report.
// end_kind: 0 winner, 1 unforced, 2 double_fault, 3 other.
struct PointRecord {
  server : Int // 0 = P, 1 = C
  serve_number : Int // 1 | 2
  winner : Int
  rally_shots : Int
  end_kind : Int
  duration : Double
}

///|
// Enable CPU-vs-CPU mode. Call after init and before menuCmd("play", ...).
pub fn set_cpu_mode(on : Int) -> Unit {
  let self = g()
  self.cpu_vs_cpu = on != 0
  @tuning.set_cpu_p(on != 0)
}

///|
// Per-side shot policy for CPU-vs-CPU balance studies. Call after setCpuMode and
// before menuCmd("go", ...) so start_match snapshots it onto the two AIs.
// force_p / force_c: 0=none / 1=flat / 2=topspin / 3=slice. return_slice: play
// Slice on the return of serve. first_server: 0=P / 1=C.
pub fn set_match_policy(
  force_p : Int,
  force_c : Int,
  return_slice : Int,
  first_server : Int,
) -> Unit {
  @tuning.set_match_policy(force_p, force_c, return_slice != 0, first_server)
}

///|
// JSON report of the current match. During a match this is a live partial
// snapshot (finished:false, winner:""); after completion it is the final
// report snapshotted before teardown; "" if no match since init. The live
// path exists because badly-tuned parameter sets can rally forever — the
// runner still needs deterministic partial stats at its step cap.
pub fn get_match_stats() -> String {
  let self = g()
  match self.ms {
    Some(ms) => if is_practice_ms(ms) { self.last_report } else { build_report(ms, None) }
    None => self.last_report
  }
}

///|
// Registry wrappers (logic/tuning) exported to JS. Call after init and
// before menuCmd("play", ...) — parameters must not change mid-match.
pub fn set_param(name : String, v : Double) -> Bool {
  @tuning.set_param(name, v)
}

///|
pub fn get_param(name : String) -> Double {
  @tuning.get_param(name)
}

///|
pub fn reset_params() -> Unit {
  @tuning.reset_params()
}

///|
fn p_ai(ms : MatchState) -> @ai.Ai {
  ms.ai_p.unwrap()
}

///|
fn end_kind_str(k : Int) -> String {
  match k {
    0 => "winner"
    1 => "unforced"
    2 => "double_fault"
    _ => "other"
  }
}

///|
fn side_str(i : Int) -> String {
  if i == 0 {
    "p"
  } else {
    "c"
  }
}

// Mirrored world view for the P-side AI: a 180-degree rotation about the y
// axis (negate x/z of position, velocity and spin; y components unchanged).
// The scratch ball avoids a per-step allocation. The returned AiMove's x/z
// and swing_aim_x must be negated by the caller; swing_aim_depth passes
// through (compute_stroke applies the side's z_sign itself).
///|
fn p_ai_ctx(ms : MatchState) -> @ai.AiCtx {
  let b = ms.ball
  let vb = ms.p_view_ball
  vb.px = -b.px
  vb.py = b.py
  vb.pz = -b.pz
  vb.vx = -b.vx
  vb.vy = b.vy
  vb.vz = -b.vz
  vb.sx = -b.sx
  vb.sy = b.sy
  vb.sz = -b.sz
  vb.active = b.active
  {
    ball: vb,
    ball_stamp: ms.ball_stamp,
    surface: ms.surface,
    cpu_x: -ms.human.pos_x,
    cpu_z: -ms.human.pos_z,
    cpu_swinging: ms.human.swinging,
    human_x: -ms.cpu.pos_x,
    human_z: -ms.cpu.pos_z,
    game_time: ms.time,
    can_hit: b.active && ms.last_hit_by == Some(@rules.C),
    bounced: ms.bounces > 0,
    is_return: ms.point_state == Rally && ms.stats.rally_shots == 0,
  }
}

///|
fn build_report(ms : MatchState, w : @rules.Side?) -> String {
  let s = ms.stats
  let winner_str = match w {
    Some(side) => side_str(side_int(side))
    None => ""
  }
  let finished = match w {
    Some(_) => "true"
    None => "false"
  }
  let pts_buf : Array[String] = []
  for p in ms.point_log {
    pts_buf.push(
      "{\"server\":\"\{side_str(p.server)}\",\"serve_number\":\{p.serve_number}," +
      "\"winner\":\"\{side_str(p.winner)}\",\"rally_shots\":\{p.rally_shots}," +
      "\"end_kind\":\"\{end_kind_str(p.end_kind)}\",\"duration_s\":\{p.duration}}",
    )
  }
  let side_json = fn(
    winners : Int,
    unforced : Int,
    dfs : Int,
    fs : Int,
    fin : Int,
    run : Double,
    net_pts : Int,
    net_won : Int,
  ) -> String {
    "{\"winners\":\{winners},\"unforced\":\{unforced},\"double_faults\":\{dfs}," +
    "\"first_serves\":\{fs},\"first_in\":\{fin},\"run_m\":\{run}," +
    "\"net_pts\":\{net_pts},\"net_won\":\{net_won}}"
  }
  "{\"schema\":1," +
  "\"finished\":\{finished}," +
  "\"winner\":\"\{winner_str}\"," +
  "\"games_p\":\{ms.m.games_p},\"games_c\":\{ms.m.games_c}," +
  "\"tb_points_p\":\{ms.m.tb_points_p},\"tb_points_c\":\{ms.m.tb_points_c}," +
  "\"duration_s\":\{ms.time}," +
  "\"points_played\":\{s.points_played}," +
  "\"total_rally_shots\":\{s.total_rally_shots}," +
  "\"p\":" +
  side_json(
    s.p_winners, s.p_unforced, s.p_double_faults, s.p_first_serves, s.p_first_in,
    s.p_run, s.p_net_pts, s.p_net_won,
  ) +
  ",\"c\":" +
  side_json(
    s.c_winners, s.c_unforced, s.c_double_faults, s.c_first_serves, s.c_first_in,
    s.c_run, s.c_net_pts, s.c_net_won,
  ) +
  ",\"points\":[" +
  pts_buf.join(",") +
  "]}"
}
