// Game orchestrator: app/point/rally state machines + fixed/frame update.
// Ported from old/src/game.js. Owns all state; drives the JS render/sound/input
// host via @ffi. JS backend only (.js.mbt).

// ---------------- constants ----------------

///|
let surface_ids : Array[String] = ["clay", "grass", "hard"]

///|
let point_over_dur : Double = 2.0

///|
let slowmo_scale : Double = 0.6

///|
let slowmo_margin : Double = 2.0

///|
let slowmo_tau : Double = 0.08

///|
let timing_window : Double = 1.0

///|
let timing_tol : Double = 0.07

///|
let swing_window : Double = 0.09

///|
let magnet_radius : Double = 1.2

///|
let magnet_strength : Double = 0.6

///|
let magnet_input_cut : Double = 0.3

///|
pub let swing_contact_t : Double = 0.18

///|
pub let swing_dur : Double = 0.45

// ---- charge / Perfect-Hit (Appendix A.2) ----

///|
let charge_time : Double = 0.8 // seconds of hold to reach full charge

///|
let charge_max : Double = 1.25 // overcharge ceiling

///|
let charge_gauge_move_eps : Double = 0.05 // below this speed the player counts as stopped (charge bar shows)

///|
let cpu_charge : Double = 0.375 // CPU swings at neutral power (0.85+0.40*0.375=1.0)

///|
let safety_drop_y : Double = 0.4 // auto-swing only once a low ball drops below this
// (kept below the normal strike band ~[0.55,1.15] so the anti-stall auto-swing no
//  longer steals a deliberate hold-and-release at comfortable contact height; the
//  `passed` guard in should_safety_hit still catches a ball escaping behind the player)

///|
let safety_approach_rate : Double = 3.0 // ...unless still closing faster than this

///|
let whiff_cd_dur : Double = 0.25 // cooldown after a release out of reach

///|
let stiff_dur : Double = 0.35 // post-impact stiffness duration

///|
let stiff_factor : Double = 0.12 // movement multiplier while stiff

///|
let full_assist_charge : Double = 0.7 // auto-charge level under Full assist

///|
let volley_forecourt : Double = 7.0 // hit a still-airborne ball within this of the net = volley

///|
let serve_meter_period : Double = 1.2 // oscillating serve power meter period (s)

///|
let open_court_enabled : Bool = true // Appendix A.6 floor highlight

///|
let serve_sweet_lo : Double = 0.70 // power-meter sweet-spot band

///|
let serve_sweet_hi : Double = 0.88

// ---------------- enums ----------------

///|
enum AppState {
  MenuChar
  MenuOpp
  MenuSurface
  MenuDifficulty
  MenuGames
  MenuAssist
  Match
  Results
} derive(Eq)

// Games-to-win options for the set length selector (Appendix A.6).
///|
let games_options : Array[Int] = [2, 4, 6]

///|
fn games_idx_of(n : Int) -> Int {
  for i = 0; i < games_options.length(); i = i + 1 {
    if games_options[i] == n {
      return i
    }
  }
  games_options.length() - 1
}

///|
enum PointState {
  PreServe
  Serving
  Rally
  PointOver
} derive(Eq)

// Match statistics (Appendix A.6), accumulated through the match and shown on
// the end screen. p = human, c = CPU.
///|
struct MatchStats {
  mut p_winners : Int
  mut c_winners : Int
  mut p_unforced : Int
  mut c_unforced : Int
  mut p_double_faults : Int
  mut c_double_faults : Int
  mut points_played : Int
  mut total_rally_shots : Int
  mut rally_shots : Int // shots in the current point
  mut p_first_serves : Int
  mut p_first_in : Int
  mut c_first_serves : Int
  mut c_first_in : Int
  mut p_run : Double // running distance (m)
  mut c_run : Double
  mut p_net_pts : Int
  mut p_net_won : Int
  mut c_net_pts : Int
  mut c_net_won : Int
  mut p_came_net : Bool // came to net during the current point
  mut c_came_net : Bool
}

///|
fn new_match_stats() -> MatchStats {
  {
    p_winners: 0,
    c_winners: 0,
    p_unforced: 0,
    c_unforced: 0,
    p_double_faults: 0,
    c_double_faults: 0,
    points_played: 0,
    total_rally_shots: 0,
    rally_shots: 0,
    p_first_serves: 0,
    p_first_in: 0,
    c_first_serves: 0,
    c_first_in: 0,
    p_run: 0.0,
    c_run: 0.0,
    p_net_pts: 0,
    p_net_won: 0,
    c_net_pts: 0,
    c_net_won: 0,
    p_came_net: false,
    c_came_net: false,
  }
}

///|
enum RallyPhase {
  Idle
  Serve
  Live
  Over
} derive(Eq)

// ---------------- state ----------------

///|
struct MatchState {
  human : Player
  cpu : Player
  ai : @ai.Ai
  ball : @physics.Ball
  m : @rules.Match
  surface : @physics.Surface
  surface_id : String
  mut point_state : PointState
  mut serve_number : Int
  mut court_side : @shots.CourtSide
  mut rally_phase : RallyPhase
  mut last_hit_by : @rules.Side?
  mut bounces : Int
  mut serve_net_touched : Bool
  mut ball_stamp : Int
  mut sweet_stamp : Int
  mut has_sweet : Bool
  mut sweet_x : Double
  mut sweet_y : Double
  mut sweet_z : Double
  mut sweet_hit_valid : Bool
  mut sweet_hit_t : Double
  mut sweet_hit_clock : Double
  mut time : Double
  mut state_timer : Double
  mut serve_meter : Double // current oscillating power-meter value [0,1]
  mut serve_meter_t : Double // meter phase clock (s)
  stats : MatchStats
  mut cpu_serve_plan : @ai.ServePlan?
  mut last_shot_pref : @shots.ShotType?
  mut was_in_reach : Bool
  events : Array[@physics.Event]
}

///|
struct Game {
  host : @ffi.Host
  rng : @rng.Gauss
  mut state : AppState
  mut menu_idx : Int
  mut sel_player : Int
  mut sel_opp : Int
  mut sel_surface : Int
  mut sel_difficulty : Int
  mut sel_games : Int // games to win the set
  mut paused : Bool
  mut time_scale : Double
  mut ms : MatchState?
}

///|
let the_game : Ref[Game?] = { val: None }

///|
fn g() -> Game {
  the_game.val.unwrap()
}

// ---------------- small helpers ----------------

///|
fn side_int(s : @rules.Side) -> Int {
  match s {
    @rules.P => 0
    @rules.C => 1
  }
}

///|
fn ent(ms : MatchState, side : @rules.Side) -> Player {
  match side {
    @rules.P => ms.human
    @rules.C => ms.cpu
  }
}

///|
fn shot_type_str(t : @shots.ShotType) -> String {
  match t {
    Flat => "flat"
    Topspin => "topspin"
    Slice => "slice"
    Lob => "topspin"
    Drop => "drop"
  }
}

///|
fn serve_flash_str(t : @shots.ServeType) -> String {
  match t {
    ServeKick => "topspin"
    ServeSlice => "slice"
    ServeFlat => "flat"
  }
}

///|
fn stroke_to_serve(t : @shots.ShotType) -> @shots.ServeType {
  match t {
    Topspin => ServeKick
    Slice => ServeSlice
    _ => ServeFlat
  }
}

///|
fn str_to_shot(s : String) -> @shots.ShotType? {
  match s {
    "flat" => Some(Flat)
    "topspin" => Some(Topspin)
    "slice" => Some(Slice)
    "drop" => Some(Drop)
    _ => None
  }
}

///|
fn assist_idx() -> Int {
  match @assist.get_assist_level() {
    Off => 0
    On => 1
    Full => 2
  }
}

///|
fn level_from_idx(i : Int) -> @assist.AssistLevel {
  match i {
    0 => Off
    1 => On
    _ => Full
  }
}

///|
fn level_str(l : @assist.AssistLevel) -> String {
  match l {
    Off => "off"
    On => "on"
    Full => "full"
  }
}

///|
fn char_name(idx : Int) -> String {
  @shots.characters[idx].name
}

///|
fn names_p() -> String {
  char_name(g().sel_player) + " (You)"
}

///|
fn names_c() -> String {
  char_name(g().sel_opp)
}

// ---------------- menu navigation ----------------

///|
fn show_char_menu(self : Game) -> Unit {
  @ffi.host_show_char_select(self.host, "SELECT YOUR PLAYER", self.menu_idx, "")
}

///|
fn show_opp_menu(self : Game) -> Unit {
  @ffi.host_show_char_select(
    self.host, "SELECT OPPONENT", self.menu_idx, "You: " + char_name(self.sel_player),
  )
}

///|
fn confirm_char(self : Game) -> Unit {
  @ffi.host_sfx(self.host, "sfxConfirm")
  self.sel_player = self.menu_idx
  self.state = MenuOpp
  self.menu_idx = 0
  self.show_opp_menu()
}

///|
fn confirm_opp(self : Game) -> Unit {
  @ffi.host_sfx(self.host, "sfxConfirm")
  self.sel_opp = self.menu_idx
  self.state = MenuSurface
  self.menu_idx = 2 // default hard
  @ffi.host_show_surface_select(self.host, self.menu_idx)
}

///|
fn confirm_surface(self : Game) -> Unit {
  @ffi.host_sfx(self.host, "sfxConfirm")
  self.sel_surface = self.menu_idx
  self.state = MenuDifficulty
  self.menu_idx = 1 // default normal
  @ffi.host_show_difficulty_select(self.host, self.menu_idx)
}

///|
fn confirm_difficulty(self : Game) -> Unit {
  @ffi.host_sfx(self.host, "sfxConfirm")
  self.sel_difficulty = self.menu_idx
  self.state = MenuGames
  self.menu_idx = games_idx_of(self.sel_games)
  @ffi.host_show_games_select(self.host, self.menu_idx)
}

///|
fn confirm_games(self : Game) -> Unit {
  @ffi.host_sfx(self.host, "sfxConfirm")
  self.sel_games = games_options[self.menu_idx]
  self.state = MenuAssist
  self.menu_idx = assist_idx()
  @ffi.host_show_assist_select(self.host, self.menu_idx)
}

///|
fn confirm_assist(self : Game) -> Unit {
  @ffi.host_sfx(self.host, "sfxConfirm")
  let lvl = level_from_idx(self.menu_idx)
  @assist.set_assist_level(lvl)
  @ffi.host_save_assist(self.host, level_str(lvl))
  self.start_match()
}

///|
fn back_to_char_menu(self : Game) -> Unit {
  self.state = MenuChar
  self.menu_idx = 0
  self.show_char_menu()
}

// ---------------- match setup ----------------

///|
fn names_for(ms : MatchState, side : @rules.Side) -> String {
  match side {
    @rules.P => names_p()
    @rules.C => names_c()
  }
}

// End-screen stats payload: ';'-separated "Label\tYou\tOpp" rows (Appendix A.6).
///|
fn stats_string(ms : MatchState) -> String {
  let s = ms.stats
  let pts = if s.points_played == 0 { 1 } else { s.points_played }
  let avg10 = (s.total_rally_shots.to_double() / pts.to_double() * 10.0).to_int()
  let p_fs = if s.p_first_serves == 0 { 1 } else { s.p_first_serves }
  let c_fs = if s.c_first_serves == 0 { 1 } else { s.c_first_serves }
  let p1 = (s.p_first_in.to_double() / p_fs.to_double() * 100.0).to_int()
  let c1 = (s.c_first_in.to_double() / c_fs.to_double() * 100.0).to_int()
  "Winners\t\{s.p_winners}\t\{s.c_winners};" +
  "Unforced errors\t\{s.p_unforced}\t\{s.c_unforced};" +
  "Double faults\t\{s.p_double_faults}\t\{s.c_double_faults};" +
  "1st serve in\t\{p1}%\t\{c1}%;" +
  "Net pts won\t\{s.p_net_won}/\{s.p_net_pts}\t\{s.c_net_won}/\{s.c_net_pts};" +
  "Avg rally\t\{avg10 / 10}.\{avg10 % 10}\t-;" +
  "Distance run\t\{s.p_run.to_int()}m\t\{s.c_run.to_int()}m"
}

///|
fn refresh_score(self : Game, ms : MatchState) -> Unit {
  let ss = @rules.score_strings(ms.m)
  @ffi.host_update_score(self.host, ss.games, ss.points, names_p(), names_c(), ms.serve_number)
}

///|
fn start_match(self : Game) -> Unit {
  @physics.set_pace_factor(if @assist.assist_on() { 0.85 } else { 1.0 })
  let surface_id = surface_ids[self.sel_surface]
  let surface = @physics.surface_by_id(surface_id)
  let char_p = @shots.characters[self.sel_player]
  let char_c = @shots.characters[self.sel_opp]
  let ai = @ai.create_ai(char_c, @ai.difficulties[self.sel_difficulty].id)
  let human = create_player(@rules.P, char_p, 1.0)
  let cpu = create_player(@rules.C, char_c, ai.diff.speed_mul)
  let ms : MatchState = {
    human,
    cpu,
    ai,
    ball: @physics.make_ball(),
    m: @rules.create_match(@rules.P, target_games=self.sel_games),
    surface,
    surface_id,
    point_state: PreServe,
    serve_number: 1,
    court_side: Deuce,
    rally_phase: Idle,
    last_hit_by: None,
    bounces: 0,
    serve_net_touched: false,
    ball_stamp: 0,
    sweet_stamp: -1,
    has_sweet: false,
    sweet_x: 0.0,
    sweet_y: 0.0,
    sweet_z: 0.0,
    sweet_hit_valid: false,
    sweet_hit_t: 0.0,
    sweet_hit_clock: 0.0,
    time: 0.0,
    state_timer: 0.0,
    serve_meter: 0.0,
    serve_meter_t: 0.0,
    stats: new_match_stats(),
    cpu_serve_plan: None,
    last_shot_pref: None,
    was_in_reach: false,
    events: [],
  }
  self.ms = Some(ms)
  self.state = Match
  self.paused = false
  @ffi.host_start_match(self.host, surface_id, self.sel_player, self.sel_opp)
  @ffi.host_hide_menu(self.host)
  @ffi.host_show_hud(self.host)
  self.next_point(ms)
  @ffi.host_camera_snap(self.host, self.camera_mode())
}

///|
fn teardown_match(self : Game) -> Unit {
  @ffi.host_teardown_match(self.host)
  @ffi.host_hide_hud(self.host)
  self.ms = None
}

///|
fn server(ms : MatchState) -> @rules.Side {
  ms.m.server
}

///|
fn receiver(ms : MatchState) -> @rules.Side {
  @rules.other(ms.m.server)
}

// ---------------- sweet spot / trail ----------------

///|
fn show_sweet(self : Game, ms : MatchState, x : Double, y : Double, z : Double) -> Unit {
  ms.has_sweet = true
  ms.sweet_x = x
  ms.sweet_y = y
  ms.sweet_z = z
}

///|
fn hide_sweet(self : Game, ms : MatchState) -> Unit {
  ms.has_sweet = false
  @ffi.host_hide_trail(self.host)
}

///|
fn show_trajectory_trail(self : Game, ms : MatchState) -> Unit {
  let already_bounced = ms.bounces > 0
  let traj = @physics.predict_trajectory(
    ms.ball, ms.surface, 1.0, max_t=4.0, every=0.04, already_bounced~,
  )
  if !traj.has_bounce {
    @ffi.host_hide_trail(self.host)
    return
  }
  let from = if already_bounced { 0.0 } else { traj.bounce_t - 0.45 }
  let buf : Array[Double] = []
  let mut ideal_idx = -1
  let mut best = 0.25
  let mut shown = 0
  for p in traj.points {
    if p.t >= from && p.z > 0.3 {
      if p.after_bounce {
        let dh = @vec.dabs(p.y - @physics.ideal_contact_h)
        if dh < best {
          best = dh
          ideal_idx = shown
        }
      }
      buf.push(p.x)
      buf.push(p.y)
      buf.push(p.z)
      buf.push(if p.after_bounce { 1.0 } else { 0.0 })
      shown = shown + 1
    }
  }
  @ffi.host_show_trail(self.host, buf, ideal_idx)
}

// ---------------- point flow ----------------

///|
fn next_point(self : Game, ms : MatchState) -> Unit {
  ms.court_side = if @rules.point_number_in_game(ms.m) % 2 == 0 { Deuce } else { Ad }
  self.position_for_serve(ms)
  self.refresh_score(ms)
}

///|
fn position_for_serve(self : Game, ms : MatchState) -> Unit {
  let sv = server(ms)
  let rc = receiver(ms)
  let sv_sign = match sv {
    @rules.P => 1.0
    @rules.C => -1.0
  }
  let stance_x = @shots.serve_stance_x(sv, ms.court_side)
  ent(ms, sv).place(stance_x, sv_sign * (@physics.court_half_len + 0.4))
  let box = @shots.serve_box(sv, ms.court_side)
  let box_cx = (box.x_min + box.x_max) / 2.0
  // the CPU receiver reads the serve angle (sharper at higher difficulty); the
  // human receiver uses the neutral bisector and then moves themselves
  let shift = if rc == @rules.C { @ai.return_shift_factor(ms.ai) } else { 1.4 }
  ent(ms, rc).place(box_cx * shift, -sv_sign * (@physics.court_half_len + 0.7))
  if sv == @rules.P {
    @ffi.host_serve_look_x(self.host, box_cx)
  }
  ms.ball.active = false
  @ffi.host_hide_landing(self.host)
  self.hide_sweet(ms)
  ms.rally_phase = Idle
  ms.last_hit_by = None
  ms.bounces = 0
  ms.serve_net_touched = false
  ms.point_state = PreServe
  ms.state_timer = 0.0
  ms.cpu_serve_plan = None
  ent(ms, sv).end_serve_anim()
  @ffi.host_serve_anim(self.host, side_int(sv), false)
}

///|
fn start_toss(self : Game, ms : MatchState) -> Unit {
  let sv = server(ms)
  let e = ent(ms, sv)
  let sv_sign = match sv {
    @rules.P => 1.0
    @rules.C => -1.0
  }
  let b = ms.ball
  b.active = true
  b.px = e.pos_x + 0.15 * sv_sign
  b.py = 1.7
  b.pz = e.pos_z - 0.3 * sv_sign
  let contact_h = @physics.serve_contact_h(e.stats.rea)
  b.vx = 0.0
  b.vy = (2.0 * @physics.g * (contact_h - 1.7 + 0.18)).sqrt()
  b.vz = 0.0
  b.sx = 0.0
  b.sy = 0.0
  b.sz = 0.0
  e.start_serve_anim()
  @ffi.host_serve_anim(self.host, side_int(sv), true)
  ms.point_state = Serving
  ms.serve_meter = 0.0
  ms.serve_meter_t = 0.0
  @ffi.host_sfx(self.host, "sfxToss")
}

// Triangle-wave power meter: 0 -> 1 -> 0 over serve_meter_period seconds.
///|
fn serve_meter_value(t : Double) -> Double {
  let phase = (t % serve_meter_period) / serve_meter_period
  if phase < 0.5 {
    phase * 2.0
  } else {
    2.0 - phase * 2.0
  }
}

///|
fn execute_serve(
  self : Game,
  ms : MatchState,
  ty : @shots.ServeType,
  power : Double,
  preset : @shots.Preset,
  aim_adjust : Double,
  aim_depth : Double,
) -> Unit {
  let sv = server(ms)
  let e = ent(ms, sv)
  if ms.serve_number == 1 {
    match sv {
      @rules.P => ms.stats.p_first_serves = ms.stats.p_first_serves + 1
      @rules.C => ms.stats.c_first_serves = ms.stats.c_first_serves + 1
    }
  }
  let b = ms.ball
  let contact_h = @physics.serve_contact_h(e.stats.rea)
  let from_y = @vec.dmax(1.6, @vec.dmin(b.py, contact_h))
  let res = @shots.compute_serve(
    e.stats, ty, b.px, from_y, b.pz, sv, ms.court_side, preset, aim_adjust, aim_depth,
    power, self.rng,
  )
  b.py = from_y
  b.vx = res.vx
  b.vy = res.vy
  b.vz = res.vz
  b.sx = res.sx
  b.sy = res.sy
  b.sz = res.sz
  ms.rally_phase = Serve
  ms.last_hit_by = Some(sv)
  ms.bounces = 0
  ms.serve_net_touched = false
  ms.point_state = Rally
  ms.ball_stamp = ms.ball_stamp + 1
  let speed = @vec.hypot3(res.vx, res.vy, res.vz)
  @ffi.host_sfx_hit(self.host, speed, "serve", b.px / 5.5, false)
  @ffi.host_serve_speed_toast(self.host, speed * 3.6)
  match @physics.predict_landing(b, ms.surface) {
    Some(l) => @ffi.host_show_landing(self.host, l.x, l.z)
    None => ()
  }
  if sv == @rules.P {
    @ffi.host_flash_shot(self.host, serve_flash_str(ty))
  }
}

// Returns true if a stroke was actually made (false on any guard/whiff).
///|
fn attempt_contact(
  self : Game,
  ms : MatchState,
  side : @rules.Side,
  ty : @shots.ShotType,
  aim_x : Double,
  aim_depth : Double,
  power_mul~ : Double = 1.0,
  perfect_eligible~ : Bool = false,
  overcharge~ : Double = 0.0,
  charge_cc~ : Double = 0.0,
) -> Bool {
  let b = ms.ball
  if !b.active || ms.rally_phase != Live {
    return false
  }
  if ms.last_hit_by == Some(side) {
    return false
  }
  let side_sign = match side {
    @rules.P => 1.0
    @rules.C => -1.0
  }
  if b.pz * side_sign < -0.2 {
    return false // ball not on this player's side
  }
  let e = ent(ms, side)
  // a still-airborne ball met near the net (Flat/Slice) is a volley
  let volley = ms.bounces == 0 &&
    @vec.dabs(b.pz) < volley_forecourt &&
    (ty == @shots.Flat || ty == @shots.Slice)
  let res = @shots.compute_stroke(
    e.pos_x, e.pos_z, b.px, b.py, b.pz, b.vx, b.vy, b.vz, e.stats, ty, aim_x,
    aim_depth, side, self.rng, power_mul~, perfect_eligible~, overcharge~,
    charge_cc~, volley~,
  )
  match res {
    None => false // whiff
    Some(r) => {
      if side == @rules.P {
        self.hide_sweet(ms)
      }
      b.vx = r.vx
      b.vy = r.vy
      b.vz = r.vz
      b.sx = r.sx
      b.sy = r.sy
      b.sz = r.sz
      ms.last_hit_by = Some(side)
      ms.bounces = 0
      ms.serve_net_touched = false
      ms.ball_stamp = ms.ball_stamp + 1
      ent(ms, side).stiff_t = stiff_dur
      ms.stats.rally_shots = ms.stats.rally_shots + 1
      if r.volley {
        match side {
          @rules.P => ms.stats.p_came_net = true
          @rules.C => ms.stats.c_came_net = true
        }
      }
      @ffi.host_sfx_hit(
        self.host, @vec.hypot3(r.vx, r.vy, r.vz), shot_type_str(r.shot_type),
        b.px / 5.5, r.mishit,
      )
      if side == @rules.P {
        @ffi.host_flash_shot(self.host, shot_type_str(r.shot_type))
        if r.perfect {
          @ffi.host_sfx(self.host, "sfxPerfect")
        }
        if r.smash {
          @ffi.host_toast(self.host, "SMASH!", 700)
        }
      }
      match @physics.predict_landing(b, ms.surface) {
        Some(l) => @ffi.host_show_landing(self.host, l.x, l.z)
        None => @ffi.host_hide_landing(self.host)
      }
      true
    }
  }
}

///|
fn fault(self : Game, ms : MatchState) -> Unit {
  @ffi.host_hide_landing(self.host)
  if ms.serve_number == 1 {
    ms.serve_number = 2
    @ffi.host_banner(self.host, "FAULT")
    @ffi.host_sfx(self.host, "sfxFault")
    self.position_for_serve(ms)
    self.refresh_score(ms)
  } else {
    @ffi.host_banner(self.host, "DOUBLE FAULT")
    @ffi.host_sfx(self.host, "sfxFault")
    match server(ms) {
      @rules.P => ms.stats.p_double_faults = ms.stats.p_double_faults + 1
      @rules.C => ms.stats.c_double_faults = ms.stats.c_double_faults + 1
    }
    self.record_error(ms, server(ms))
    self.point_end(ms, receiver(ms), "")
  }
}

// ---- match-stats helpers (Appendix A.6) ----

///|
fn record_winner(self : Game, ms : MatchState, side : @rules.Side) -> Unit {
  ignore(self)
  match side {
    @rules.P => ms.stats.p_winners = ms.stats.p_winners + 1
    @rules.C => ms.stats.c_winners = ms.stats.c_winners + 1
  }
}

///|
fn record_error(self : Game, ms : MatchState, side : @rules.Side) -> Unit {
  ignore(self)
  match side {
    @rules.P => ms.stats.p_unforced = ms.stats.p_unforced + 1
    @rules.C => ms.stats.c_unforced = ms.stats.c_unforced + 1
  }
}

///|
fn let_serve(self : Game, ms : MatchState) -> Unit {
  @ffi.host_banner(self.host, "LET")
  @ffi.host_sfx(self.host, "sfxFault")
  @ffi.host_hide_landing(self.host)
  self.position_for_serve(ms)
}

///|
fn point_end(self : Game, ms : MatchState, winner : @rules.Side, call_text : String) -> Unit {
  ms.rally_phase = Over
  ms.point_state = PointOver
  ms.state_timer = 0.0
  @ffi.host_hide_landing(self.host)
  self.hide_sweet(ms)
  // accumulate per-point stats (rally length, net-point outcomes)
  let st = ms.stats
  st.points_played = st.points_played + 1
  st.total_rally_shots = st.total_rally_shots + st.rally_shots
  st.rally_shots = 0
  if st.p_came_net {
    st.p_net_pts = st.p_net_pts + 1
    if winner == @rules.P {
      st.p_net_won = st.p_net_won + 1
    }
  }
  if st.c_came_net {
    st.c_net_pts = st.c_net_pts + 1
    if winner == @rules.C {
      st.c_net_won = st.c_net_won + 1
    }
  }
  st.p_came_net = false
  st.c_came_net = false
  let ev = @rules.add_point(ms.m, winner)
  let win_name = names_for(ms, winner)
  @ffi.host_sfx_crowd(self.host, if winner == @rules.P { 1.0 } else { 0.55 })
  if call_text != "" {
    @ffi.host_banner(self.host, call_text)
  }
  match ev {
    Game => {
      let total = ms.m.games_p + ms.m.games_c
      @ffi.host_toast(
        self.host,
        "GAME " + win_name + (if total % 2 == 1 { " — Changeover" } else { "" }),
        2000,
      )
    }
    TiebreakStart => @ffi.host_toast(self.host, "GAME — 6-6: TIEBREAK", 2200)
    SetWon => @ffi.host_toast(self.host, "GAME, SET, MATCH " + win_name, 2400)
    Point => if call_text == "" { @ffi.host_toast(self.host, "Point: " + win_name, 1200) }
  }
  ms.serve_number = 1
  self.refresh_score(ms)
}

///|
fn process_bounce(self : Game, ms : MatchState, px : Double, pz : Double, speed : Double) -> Unit {
  @ffi.host_sfx_bounce(self.host, speed, ms.surface_id)
  @ffi.host_hide_landing(self.host)
  if ms.rally_phase == Over || ms.rally_phase == Idle {
    return
  }
  if ms.rally_phase == Serve {
    if @shots.is_serve_box_in(px, pz, server(ms), ms.court_side) {
      if ms.serve_net_touched {
        self.let_serve(ms)
        return
      }
      if ms.serve_number == 1 {
        match server(ms) {
          @rules.P => ms.stats.p_first_in = ms.stats.p_first_in + 1
          @rules.C => ms.stats.c_first_in = ms.stats.c_first_in + 1
        }
      }
      ms.rally_phase = Live
      ms.bounces = 1
    } else {
      self.fault(ms)
    }
    return
  }
  // live rally
  let side : @rules.Side = if pz > 0.0 { @rules.P } else { @rules.C }
  let last = ms.last_hit_by
  if ms.bounces == 0 {
    if ms.last_hit_by == Some(side) {
      // ball never made it across (net dribble / mishit straight down)
      self.record_error(ms, side) // unforced error by the hitter
      self.point_end(ms, @rules.other(side), "")
      return
    }
    let in_x = @vec.dabs(px) <= @physics.court_half_width + @physics.line_grace
    let in_z = @vec.dabs(pz) <= @physics.court_half_len + @physics.line_grace
    if in_x && in_z {
      ms.bounces = 1
    } else {
      @ffi.host_sfx(self.host, "sfxOut")
      let w = match last {
        Some(@rules.P) => @rules.C
        _ => @rules.P
      }
      match last {
        Some(s) => self.record_error(ms, s) // hit out = unforced error
        None => ()
      }
      self.point_end(ms, w, "OUT")
    }
  } else {
    // double bounce: opponent of last hitter failed to return = a winner
    match last {
      Some(s) => {
        self.record_winner(ms, s)
        self.point_end(ms, s, "")
      }
      None => ()
    }
  }
}

///|
fn camera_mode(self : Game) -> String {
  match self.ms {
    Some(ms) =>
      if (ms.point_state == PreServe || ms.point_state == Serving) &&
        server(ms) == @rules.P {
        "serve"
      } else {
        "rally"
      }
    None => "rally"
  }
}

// ---------------- input ----------------

///|
fn handle_menu_nav(self : Game, count : Int) -> Bool {
  let mut moved = false
  if @ffi.host_was_pressed(self.host, "ArrowLeft") {
    self.menu_idx = (self.menu_idx + count - 1) % count
    moved = true
  }
  if @ffi.host_was_pressed(self.host, "ArrowRight") {
    self.menu_idx = (self.menu_idx + 1) % count
    moved = true
  }
  if moved {
    @ffi.host_sfx(self.host, "sfxMenu")
  }
  moved
}

///|
fn confirm_pressed(self : Game) -> Bool {
  @ffi.host_was_pressed(self.host, "Enter") || @ffi.host_was_pressed(self.host, "Space")
}

///|
fn rand_stroke(self : Game) -> @shots.ShotType {
  let kinds : Array[@shots.ShotType] = [Flat, Topspin, Slice]
  kinds[(self.rng.uniform() * 3.0).to_int()]
}

///|
fn do_serve(self : Game, ms : MatchState, kind : @shots.ShotType) -> Unit {
  // power is locked from the oscillating meter at the moment the serve key fires
  let power = ms.serve_meter
  let ty = stroke_to_serve(kind)
  let aim_x = @ffi.host_move_x(self.host)
  let aim_depth = -@ffi.host_move_z(self.host)
  self.execute_serve(ms, ty, power, Body, aim_x, aim_depth)
}

// Hold-to-charge rally strokes (Appendix A.2). Charge builds while a shot key
// (or the touch SHOT button) is held; releasing fires the swing, a Safety Hit
// auto-fires before the ball escapes, and releasing out of reach whiffs.
///|
fn update_human_charge(self : Game, ms : MatchState, dt : Double) -> Unit {
  let ph = ms.human
  let live = ms.point_state == Rally &&
    ms.rally_phase == Live &&
    ms.last_hit_by == Some(@rules.C) &&
    ms.ball.active
  // Full assist auto-charges/auto-swings via the auto-swing block; no manual hold.
  if !live || @assist.assist_full() || ph.swinging || ph.whiff_cd > 0.0 {
    if ph.charging {
      ph.charging = false
      @ffi.host_hide_charge(self.host)
    }
    return
  }
  let kb = str_to_shot(@ffi.host_shot_held(self.host))
  let touch = @ffi.host_is_down(self.host, "TouchShot")
  let kb_held = match kb {
    Some(_) => true
    None => false
  }
  let held = kb_held || touch
  if !ph.charging {
    if held {
      ph.charging = true
      ph.charge = 0.0
      ph.charge_type = match kb {
        Some(t) => t
        None => self.rand_stroke()
      }
    } else {
      @ffi.host_hide_charge(self.host)
      return
    }
  }
  if held {
    ph.charge = @vec.dmin(charge_max, ph.charge + dt / charge_time)
    // Show the charge bar only once the player has finished moving and stopped
    // (T4). The charge still accumulates while moving; only the gauge is gated.
    // The bar reflects elapsed press time only — no good-range / overcharge tint.
    if @vec.hypot2(ph.vel_x, ph.vel_z) < charge_gauge_move_eps {
      @ffi.host_charge(self.host, ph.charge / charge_max)
    } else {
      @ffi.host_hide_charge(self.host)
    }
    if self.should_safety_hit(ms) {
      self.fire_charged_swing(ms, true)
    }
  } else {
    self.fire_charged_swing(ms, false) // released -> swing
  }
}

///|
fn fire_charged_swing(self : Game, ms : MatchState, safety : Bool) -> Unit {
  let ph = ms.human
  let b = ms.ball
  let fh = b.px - ph.pos_x >= 0.0
  ph.swing_charge = ph.charge
  ph.swing_no_perfect = safety
  ph.charging = false
  ms.last_shot_pref = Some(ph.charge_type)
  ph.start_swing(ph.charge_type, fh) |> ignore
  @ffi.host_start_swing(self.host, 0, shot_type_str(ph.charge_type), fh)
  @ffi.host_hide_charge(self.host)
}

// Auto-fire while charging if the ball is in reach but about to escape: it has
// passed the player horizontally, or it has dropped low and is no longer
// closing fast. Prevents a held charge from sailing past unhit.
///|
fn should_safety_hit(self : Game, ms : MatchState) -> Bool {
  ignore(self)
  let ph = ms.human
  let b = ms.ball
  let d = @vec.hypot2(b.px - ph.pos_x, b.pz - ph.pos_z)
  if d > ph.reach {
    return false
  }
  let passed = b.pz > ph.pos_z && b.vz > 0.0
  let low = b.py <= safety_drop_y && b.vy < 0.0 && b.vz < safety_approach_rate
  passed || low
}

///|
pub fn handle_input() -> Unit {
  let self = g()
  let h = self.host
  match self.state {
    MenuChar => {
      if self.handle_menu_nav(@shots.characters.length()) {
        self.show_char_menu()
      }
      if self.confirm_pressed() {
        self.confirm_char()
      }
    }
    MenuOpp => {
      if self.handle_menu_nav(@shots.characters.length()) {
        self.show_opp_menu()
      }
      if @ffi.host_was_pressed(h, "Escape") {
        self.state = MenuChar
        self.menu_idx = self.sel_player
        self.show_char_menu()
      } else if self.confirm_pressed() {
        self.confirm_opp()
      }
    }
    MenuSurface => {
      if self.handle_menu_nav(3) {
        @ffi.host_show_surface_select(h, self.menu_idx)
      }
      if @ffi.host_was_pressed(h, "Escape") {
        self.state = MenuOpp
        self.menu_idx = self.sel_opp
        self.show_opp_menu()
      } else if self.confirm_pressed() {
        self.confirm_surface()
      }
    }
    MenuDifficulty => {
      if self.handle_menu_nav(3) {
        @ffi.host_show_difficulty_select(h, self.menu_idx)
      }
      if @ffi.host_was_pressed(h, "Escape") {
        self.state = MenuSurface
        self.menu_idx = self.sel_surface
        @ffi.host_show_surface_select(h, self.menu_idx)
      } else if self.confirm_pressed() {
        self.confirm_difficulty()
      }
    }
    MenuGames => {
      if self.handle_menu_nav(3) {
        @ffi.host_show_games_select(h, self.menu_idx)
      }
      if @ffi.host_was_pressed(h, "Escape") {
        self.state = MenuDifficulty
        self.menu_idx = self.sel_difficulty
        @ffi.host_show_difficulty_select(h, self.menu_idx)
      } else if self.confirm_pressed() {
        self.confirm_games()
      }
    }
    MenuAssist => {
      if self.handle_menu_nav(3) {
        @ffi.host_show_assist_select(h, self.menu_idx)
      }
      if @ffi.host_was_pressed(h, "Escape") {
        self.state = MenuGames
        self.menu_idx = games_idx_of(self.sel_games)
        @ffi.host_show_games_select(h, self.menu_idx)
      } else if self.confirm_pressed() {
        self.confirm_assist()
      }
    }
    Results =>
      if @ffi.host_was_pressed(self.host, "KeyR") {
        self.start_match() // rematch with the same settings
      } else if self.confirm_pressed() {
        self.back_to_char_menu()
      }
    Match => self.handle_match_input()
  }
}

///|
fn handle_match_input(self : Game) -> Unit {
  let h = self.host
  let ms = match self.ms {
    Some(ms) => ms
    None => return
  }
  // pause menu (physical pause): Esc toggles it; while paused, only Resume/Quit
  if self.paused {
    if @ffi.host_was_pressed(h, "Escape") || @ffi.host_was_pressed(h, "KeyP") {
      self.paused = false
      @ffi.host_hide_pause(self.host)
    } else if @ffi.host_was_pressed(h, "KeyQ") {
      self.paused = false
      @ffi.host_hide_pause(self.host)
      self.teardown_match()
      self.back_to_char_menu()
    }
    return
  }
  if @ffi.host_was_pressed(h, "Escape") {
    self.paused = true
    @ffi.host_show_pause(self.host)
    return
  }
  let shot = str_to_shot(@ffi.host_shot_key(h))
  let touch_shot = @ffi.host_was_pressed(h, "TouchShot")
  if ms.point_state == PreServe && server(ms) == @rules.P {
    if @ffi.host_was_pressed(h, "Space") || touch_shot {
      self.start_toss(ms)
    }
  } else if ms.point_state == Serving && server(ms) == @rules.P {
    match shot {
      Some(s) => self.do_serve(ms, s)
      None => if touch_shot { self.do_serve(ms, self.rand_stroke()) }
    }
  }
  // Rally strokes use the hold-to-charge model handled in fixed_update
  // (update_human_charge), not an edge-triggered press here.
}

// ---------------- fixed update ----------------

///|
pub fn fixed_update(dt : Double) -> Unit {
  let self = g()
  if self.state != Match || self.paused {
    return // physical pause: no simulation advance
  }
  let ms = match self.ms {
    Some(ms) => ms
    None => return
  }
  ms.time = ms.time + dt
  let b = ms.ball

  // oscillating serve power meter (human's serve only)
  if ms.point_state == Serving && server(ms) == @rules.P {
    ms.serve_meter_t = ms.serve_meter_t + dt
    ms.serve_meter = serve_meter_value(ms.serve_meter_t)
  }

  // human movement (+ optional positioning magnetism)
  let mut hx = @ffi.host_move_x(self.host)
  let mut hz = @ffi.host_move_z(self.host)
  if (ms.point_state == PreServe || ms.point_state == Serving) && server(ms) == @rules.P {
    hz = 0.0 // slide along the baseline only
  }
  if @assist.assist_full() &&
    ms.point_state == Rally &&
    ms.last_hit_by == Some(@rules.C) &&
    ms.has_sweet {
    let dx = ms.sweet_x - ms.human.pos_x
    let dz = ms.sweet_z - ms.human.pos_z
    let dist = @vec.hypot2(dx, dz)
    let input_mag = @vec.hypot2(hx, hz)
    if dist < magnet_radius && dist > 0.05 && input_mag < magnet_input_cut {
      let pull = magnet_strength * (1.0 - input_mag / magnet_input_cut)
      hx = hx + dx / dist * pull
      hz = hz + dz / dist * pull
      let mag = @vec.hypot2(hx, hz)
      if mag > 1.0 {
        hx = hx / mag
        hz = hz / mag
      }
    }
  }
  ms.human.update(dt, hx, hz)
  ms.stats.p_run = ms.stats.p_run +
    @vec.hypot2(ms.human.vel_x, ms.human.vel_z) * dt
  ms.stats.c_run = ms.stats.c_run +
    @vec.hypot2(ms.cpu.vel_x, ms.cpu.vel_z) * dt
  if (ms.point_state == PreServe || ms.point_state == Serving) && server(ms) == @rules.P {
    let sx = @shots.serve_stance_x(@rules.P, ms.court_side)
    if sx > 0.0 {
      ms.human.pos_x = @vec.clampd(ms.human.pos_x, 0.2, 3.9)
    } else {
      ms.human.pos_x = @vec.clampd(ms.human.pos_x, -3.9, -0.2)
    }
    ms.human.pos_z = @physics.court_half_len + 0.4
  }

  // CPU movement / brain
  if ms.point_state == Rally && ms.rally_phase != Over {
    let mv = @ai.update_ai(
      ms.ai,
      {
        ball: b,
        ball_stamp: ms.ball_stamp,
        surface: ms.surface,
        cpu_x: ms.cpu.pos_x,
        cpu_z: ms.cpu.pos_z,
        cpu_swinging: ms.cpu.swinging,
        human_x: ms.human.pos_x,
        human_z: ms.human.pos_z,
        game_time: ms.time,
        can_hit: b.active && ms.last_hit_by == Some(@rules.P),
        bounced: ms.bounces > 0,
      },
      self.rng,
    )
    if mv.swing {
      let fh = (b.px - ms.cpu.pos_x) * -1.0 >= 0.0 // CPU faces +z
      if ms.cpu.start_swing(mv.swing_type, fh) {
        ms.cpu.pending_type = mv.swing_type
        ms.cpu.pending_aim_x = mv.swing_aim_x
        ms.cpu.pending_aim_depth = mv.swing_aim_depth
        @ffi.host_start_swing(self.host, 1, shot_type_str(mv.swing_type), fh)
      }
    }
    ms.cpu.update(dt, mv.x, mv.z)
  } else {
    ms.cpu.update(dt, 0.0, 0.0)
  }
  if (ms.point_state == PreServe || ms.point_state == Serving) && server(ms) == @rules.C {
    ms.cpu.pos_z = -(@physics.court_half_len + 0.4)
    ms.cpu.pos_x = @shots.serve_stance_x(@rules.C, ms.court_side)
  }

  // human charge / release (hold to charge, release to swing); Full assist
  // auto-charges + auto-releases at the sweet spot below.
  self.update_human_charge(ms, dt)

  // auto-swing assist (full assist only): auto-release at the sweet spot
  if @assist.assist_full() &&
    ms.point_state == Rally &&
    ms.last_hit_by == Some(@rules.C) &&
    !ms.human.swinging {
    match time_to_contact(ms) {
      Some(ttc) =>
        if ttc <= swing_contact_t {
          let ty = match ms.last_shot_pref {
            Some(t) => Some(t)
            None => recommend_shot_type(ms)
          }
          match ty {
            Some(t) => {
              let fh = b.px - ms.human.pos_x >= 0.0
              ms.human.swing_charge = full_assist_charge
              ms.human.swing_no_perfect = false
              ms.human.start_swing(t, fh) |> ignore
              @ffi.host_start_swing(self.host, 0, shot_type_str(t), fh)
              ms.last_shot_pref = None
            }
            None => ()
          }
        }
      None => ()
    }
  }

  // swing contacts: human gets a forgiving timing window; CPU is exact.
  let ph = ms.human
  if ph.swinging && !ph.contact_done && ph.swing_t >= swing_contact_t - swing_window {
    let aim_x = @ffi.host_move_x(self.host)
    let aim_depth = -@ffi.host_move_z(self.host)
    let power_mul = 0.85 + 0.40 * @vec.dmin(ph.swing_charge, 1.0)
    let overcharge = @vec.dmax(0.0, ph.swing_charge - 1.0)
    let charge_cc = @vec.dmin(ph.swing_charge, 1.0)
    if self.attempt_contact(
        ms, @rules.P, ph.swing_type, aim_x, aim_depth, power_mul~,
        perfect_eligible=(!ph.swing_no_perfect), overcharge~, charge_cc~,
      ) {
      ph.contact_done = true
    } else if ph.swing_t >= swing_contact_t + swing_window {
      ph.contact_done = true
      ph.whiff_cd = whiff_cd_dur // released/swung out of reach -> brief cooldown
    }
  }
  let pc = ms.cpu
  if pc.swinging && !pc.contact_done && pc.swing_t >= swing_contact_t {
    pc.contact_done = true
    let cpu_power = 0.85 + 0.40 * @vec.dmin(cpu_charge, 1.0)
    self.attempt_contact(
      ms, @rules.C, pc.pending_type, pc.pending_aim_x, pc.pending_aim_depth,
      power_mul=cpu_power,
    )
    |> ignore
  }

  // state-specific
  match ms.point_state {
    PreServe => {
      ms.state_timer = ms.state_timer + dt
      if server(ms) == @rules.C && ms.state_timer > 1.0 {
        ms.cpu_serve_plan = Some(@ai.choose_serve(ms.ai, ms.serve_number == 2, self.rng))
        self.start_toss(ms)
      }
    }
    Serving => {
      ms.events.clear()
      @physics.step_ball(b, dt, ms.surface, ms.events)
      let sv = server(ms)
      let contact_h = @physics.serve_contact_h(ent(ms, sv).stats.rea)
      match ms.cpu_serve_plan {
        Some(plan) =>
          if sv == @rules.C && b.vy < 0.0 && b.py <= contact_h {
            ms.cpu_serve_plan = None
            self.execute_serve(ms, plan.type_, plan.power, plan.preset, 0.0, 0.0)
            return
          }
        None => ()
      }
      if b.py < 1.2 && b.vy < 0.0 {
        b.active = false
        ms.point_state = PreServe
        ms.state_timer = 0.7
        ent(ms, sv).end_serve_anim()
        @ffi.host_serve_anim(self.host, side_int(sv), false)
      }
    }
    Rally => self.rally_step(ms, dt)
    PointOver => self.point_over_step(ms, dt)
  }
}

///|
fn rally_step(self : Game, ms : MatchState, dt : Double) -> Unit {
  let b = ms.ball
  if !b.active {
    return
  }
  ms.events.clear()
  @physics.step_ball(b, dt, ms.surface, ms.events)
  for e in ms.events {
    match e {
      @physics.Net(_) => {
        @ffi.host_sfx(self.host, "sfxNet")
        if ms.rally_phase == Serve {
          ms.serve_net_touched = true
        }
        ms.ball_stamp = ms.ball_stamp + 1
        if ms.rally_phase != Over {
          match @physics.predict_landing(b, ms.surface) {
            Some(l) => @ffi.host_show_landing(self.host, l.x, l.z)
            None => ()
          }
        }
      }
      @physics.Bounce(px, py, pz, speed) => {
        ignore(py)
        self.process_bounce(ms, px, pz, speed)
        if ms.point_state != Rally {
          break
        }
      }
    }
  }
  // sweet-spot marker + contact clock
  if ms.last_hit_by == Some(@rules.C) {
    ms.sweet_hit_clock = ms.sweet_hit_clock + dt
  }
  if ms.point_state == Rally &&
    ms.last_hit_by == Some(@rules.C) &&
    ms.sweet_stamp != ms.ball_stamp {
    ms.sweet_stamp = ms.ball_stamp
    match @physics.predict_hit_point(b, ms.surface, 1.0) {
      Some(hp) => {
        ms.sweet_hit_t = hp.t
        ms.sweet_hit_valid = true
        ms.sweet_hit_clock = 0.0
        // Stand to the side of the hit point the player is currently on, so only
        // the relevant forehand/backhand stance is shown (not both sides).
        let stance_off = if ms.human.pos_x <= hp.x { -0.55 } else { 0.55 }
        self.show_sweet(
          ms,
          @vec.clampd(hp.x + stance_off, @physics.player_x_min, @physics.player_x_max),
          hp.y,
          @vec.dmin(@physics.player_z_max, hp.z + 0.15),
        )
      }
      None => {
        self.hide_sweet(ms)
        ms.sweet_hit_valid = false
      }
    }
    self.show_trajectory_trail(ms)
  }
}

///|
fn point_over_step(self : Game, ms : MatchState, dt : Double) -> Unit {
  let b = ms.ball
  if b.active {
    ms.events.clear()
    @physics.step_ball(b, dt, ms.surface, ms.events)
    for e in ms.events {
      match e {
        @physics.Bounce(_, _, _, speed) =>
          if speed > 2.0 {
            @ffi.host_sfx_bounce(self.host, speed, ms.surface_id)
          }
        @physics.Net(_) => ()
      }
    }
    let sp = @vec.hypot3(b.vx, b.vy, b.vz)
    if sp < 0.3 && b.py < 0.1 {
      b.active = false
    }
  }
  ms.state_timer = ms.state_timer + dt
  if ms.state_timer >= point_over_dur {
    match ms.m.winner {
      Some(w) => {
        self.state = Results
        let win_name = names_for(ms, w)
        let lose_name = names_for(ms, @rules.other(w))
        let g_str = if w == @rules.P {
          "\{ms.m.games_p}-\{ms.m.games_c}"
        } else {
          "\{ms.m.games_c}-\{ms.m.games_p}"
        }
        let diff_name = @ai.difficulties[self.sel_difficulty].name
        let stats_str = stats_string(ms)
        self.teardown_match()
        @ffi.host_show_results(
          self.host, win_name, lose_name, g_str, w == @rules.P, diff_name, stats_str,
        )
      }
      None => self.next_point(ms)
    }
  }
}

// ---------------- frame update ----------------

///|
fn time_to_contact(ms : MatchState) -> Double? {
  if !ms.sweet_hit_valid || ms.last_hit_by != Some(@rules.C) {
    return None
  }
  Some(ms.sweet_hit_t - ms.sweet_hit_clock)
}

///|
fn recommend_shot_type(ms : MatchState) -> @shots.ShotType? {
  if !ms.has_sweet {
    return None
  }
  let y = ms.sweet_y
  if y < 0.6 {
    Some(Slice)
  } else if y > 1.3 {
    Some(Flat)
  } else {
    Some(Topspin)
  }
}

///|
pub fn frame_update(dt : Double) -> Unit {
  let self = g()
  if self.state != Match && self.state != Results {
    return
  }
  let ms = match self.ms {
    Some(ms) => ms
    None => return
  }
  let h = self.host
  let b = ms.ball
  // push entity visuals once per render frame
  @ffi.host_set_ball(h, b.active, b.px, b.py, b.pz, b.sx, b.sy, b.sz)
  @ffi.host_set_player(h, 0, ms.human.pos_x, ms.human.pos_z, ms.human.vel_x, ms.human.vel_z)
  @ffi.host_set_player(h, 1, ms.cpu.pos_x, ms.cpu.pos_z, ms.cpu.vel_x, ms.cpu.vel_z)
  @ffi.host_camera_update(h, dt, self.camera_mode())

  // reach zone colour + alert
  let in_reach = b.active &&
    @vec.hypot2(b.px - ms.human.pos_x, b.pz - ms.human.pos_z) <= ms.human.reach &&
    b.py <= 1.15 + ms.human.reach
  @ffi.host_reach_color(h, in_reach)
  if in_reach && !ms.was_in_reach {
    @ffi.host_sfx(h, "sfxReachAlert")
  }
  ms.was_in_reach = in_reach

  // open-court highlight: the side the CPU has vacated, while you're on strike
  if open_court_enabled &&
    ms.point_state == Rally &&
    ms.rally_phase == Live &&
    ms.last_hit_by == Some(@rules.C) &&
    @vec.dabs(ms.cpu.pos_x) > 1.0 {
    @ffi.host_open_court(h, true, -@vec.dsign(ms.cpu.pos_x) * 2.7, -7.5)
  } else {
    @ffi.host_open_court(h, false, 0.0, 0.0)
  }

  // serve power meter (replaces the old toss gauge)
  if ms.point_state == Serving && server(ms) == @rules.P && b.active {
    let p = ms.serve_meter
    @ffi.host_gauge(
      h, "power", p, serve_sweet_lo, serve_sweet_hi, p >= serve_sweet_lo && p <=
      serve_sweet_hi,
    )
  } else {
    @ffi.host_hide_gauge(h, "power")
  }

  // (the on-screen move-assist arrow has been removed)

  // swing timing meter + recommended shot + countdown
  let ttc = time_to_contact(ms)
  match ttc {
    Some(t) =>
      if t <= timing_window && t > -0.15 {
        let w = timing_window
        let frac = @vec.clampd(1.0 - t / w, 0.0, 1.0)
        let band_lo = @vec.clampd(1.0 - (swing_contact_t + timing_tol) / w, 0.0, 1.0)
        let band_hi = @vec.clampd(1.0 - (swing_contact_t - timing_tol) / w, 0.0, 1.0)
        @ffi.host_gauge(h, "timing", frac, band_lo, band_hi, @vec.dabs(t - swing_contact_t) <= timing_tol)
      } else {
        @ffi.host_hide_gauge(h, "timing")
      }
    None => @ffi.host_hide_gauge(h, "timing")
  }
  match ttc {
    Some(_) =>
      match recommend_shot_type(ms) {
        Some(t) => @ffi.host_set_recommended_shot(h, shot_type_str(t))
        None => @ffi.host_set_recommended_shot(h, "")
      }
    None => @ffi.host_set_recommended_shot(h, "")
  }
  // sweet-spot marker + countdown ring
  match ttc {
    Some(t) =>
      if ms.has_sweet {
        @ffi.host_set_sweet(
          h, true, ms.sweet_x, ms.sweet_y, ms.sweet_z, true,
          @vec.clampd(t / timing_window, 0.0, 1.0), t <= swing_contact_t,
        )
      } else {
        @ffi.host_set_sweet(h, false, 0.0, 0.0, 0.0, false, 0.0, false)
      }
    None =>
      if ms.has_sweet {
        @ffi.host_set_sweet(h, true, ms.sweet_x, ms.sweet_y, ms.sweet_z, false, 0.0, false)
      } else {
        @ffi.host_set_sweet(h, false, 0.0, 0.0, 0.0, false, 0.0, false)
      }
  }
  // (the vertical incoming-ball-height gauge has been removed)
}

// ---------------- slow-motion ----------------

///|
pub fn get_time_scale(dt : Double) -> Double {
  let self = g()
  let mut target = 1.0
  match self.ms {
    Some(ms) =>
      if @assist.assist_on() &&
        self.state == Match &&
        ms.point_state == Rally &&
        ms.last_hit_by == Some(@rules.C) {
        let b = ms.ball
        let approaching = b.active && b.vz > 0.0
        if approaching &&
          @vec.hypot2(b.px - ms.human.pos_x, b.pz - ms.human.pos_z) <=
          ms.human.reach + slowmo_margin {
          target = slowmo_scale
        }
      }
    None => ()
  }
  let k = @vec.dmin(1.0, dt / slowmo_tau)
  self.time_scale = self.time_scale + (target - self.time_scale) * k
  self.time_scale
}

// ---------------- menu tap ----------------

///|
pub fn menu_tap(idx : Int) -> Unit {
  let self = g()
  if self.state == Results {
    self.back_to_char_menu()
    return
  }
  let count = match self.state {
    MenuSurface | MenuDifficulty | MenuGames | MenuAssist => 3
    MenuChar | MenuOpp => @shots.characters.length()
    _ => return
  }
  if idx < 0 || idx >= count {
    return
  }
  if idx == self.menu_idx {
    match self.state {
      MenuChar => self.confirm_char()
      MenuOpp => self.confirm_opp()
      MenuSurface => self.confirm_surface()
      MenuDifficulty => self.confirm_difficulty()
      MenuGames => self.confirm_games()
      MenuAssist => self.confirm_assist()
      _ => ()
    }
  } else {
    self.menu_idx = idx
    @ffi.host_sfx(self.host, "sfxMenu")
    match self.state {
      MenuChar => self.show_char_menu()
      MenuOpp => self.show_opp_menu()
      MenuSurface => @ffi.host_show_surface_select(self.host, self.menu_idx)
      MenuDifficulty => @ffi.host_show_difficulty_select(self.host, self.menu_idx)
      MenuAssist => @ffi.host_show_assist_select(self.host, self.menu_idx)
      _ => ()
    }
  }
}

// ---------------- init ----------------

///|
pub fn game_init(host : @ffi.Host, seed : Int) -> Unit {
  let self : Game = {
    host,
    rng: @rng.Gauss::new(seed),
    state: MenuChar,
    menu_idx: 0,
    sel_player: 0,
    sel_opp: 0,
    sel_surface: 2,
    sel_difficulty: 1,
    sel_games: 6,
    paused: false,
    time_scale: 1.0,
    ms: None,
  }
  the_game.val = Some(self)
  // restore assist preference (persisted by the JS layer)
  match @ffi.host_load_assist(host) {
    "off" => @assist.set_assist_level(Off)
    "on" => @assist.set_assist_level(On)
    "full" => @assist.set_assist_level(Full)
    _ => ()
  }
  self.show_char_menu()
}
