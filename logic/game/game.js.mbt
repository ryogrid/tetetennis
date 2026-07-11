// Game orchestrator: app/point/rally state machines + fixed/frame update.
// Ported from old/src/game.js. Owns all state; drives the JS render/sound/input
// host via @ffi. JS backend only (.js.mbt).

// ---------------- constants ----------------

///|
let point_over_dur : Double = 2.0

///|
let slowmo_scale : Double = 0.6

///|
let slowmo_margin : Double = 2.0

///|
let slowmo_tau : Double = 0.08

///|
let swing_window : Double = 0.09

///|
let return_reach_mul : Double = 1.25 // human reach boost on return of serve

///|
pub let swing_contact_t : Double = 0.18

///|
pub let swing_dur : Double = 0.45

// ---- charge / Perfect-Hit (Appendix A.2) ----

///|
let charge_time : Double = 0.8 // seconds of hold to reach full charge

///|
let charge_max : Double = 1.25 // maximum charge

///|
let charge_gauge_move_eps : Double = 0.05 // below this speed the player counts as stopped (charge bar shows)

///|
let charge_power_bonus : Double = 0.25 // full charge adds +25% pace over the 1.0 baseline

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
  MenuTitle // NEW (option b): branded entry screen, shown before setup
  MenuSetup // screen 1: MATCH/PRACTICE mode + mode-dependent settings as rows
  Match
  Results
} derive(Eq)

// One configurable row on the setup screen. The row list is mode-dependent
// (see Game::setup_rows); ←/→ changes the focused row's value in place.
///|
enum RowKind {
  Mode
  Difficulty
  Games
  Assist
  Feed
  Shot
  Depth
} derive(Eq)

// Practice-mode feed configuration (design/practice-mode). Present on a
// MatchState only when the match is a practice session; None for a scored match.
///|
struct Practice {
  feed : Int // 0 stroke, 1 serve
  shot : Int // index into the per-feed shot list
  depth : Int // 0 shallow, 1 deep, 2 random
}

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
  // rally groundstroke first bounces (in-bounds; serves excluded) and how many
  // landed behind the service line (|z| >= court_service_line)
  mut total_first_bounces : Int
  mut deep_first_bounces : Int
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
    total_first_bounces: 0,
    deep_first_bounces: 0,
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
  mut was_in_reach : Bool
  practice : Practice? // None = scored match; Some = practice feed session
  events : Array[@physics.Event]
  // CPU-vs-CPU autotune mode (autotune.js.mbt); ai_p is Some only then
  ai_p : @ai.Ai?
  mut p_serve_plan : @ai.ServePlan?
  p_view_ball : @physics.Ball // scratch mirrored view for the P-side AI
  point_log : Array[PointRecord]
  mut last_end_kind : Int // 0 winner, 1 unforced, 2 double fault, 3 other
  mut point_start_t : Double // ms.time at the point's first serve attempt; <0 = unset
}

///|
struct Game {
  host : @ffi.Host
  rng : @rng.Gauss
  mut state : AppState
  mut setup_row : Int // focused row on the MenuSetup screen
  sel_player : Int
  sel_opp : Int
  mut sel_difficulty : Int
  mut sel_games : Int // games to win the set
  mut is_practice : Bool // home-screen mode: false = MATCH, true = PRACTICE
  mut prac_feed : Int // practice: 0 stroke, 1 serve
  mut prac_shot : Int // practice: shot index
  mut prac_depth : Int // practice: 0 shallow, 1 deep, 2 random
  mut camera_overhead : Bool // false = default eye-level view, true = bird's-eye
  mut paused : Bool
  mut time_scale : Double
  mut ms : MatchState?
  mut cpu_vs_cpu : Bool // autotune: side P is AI-driven (autotune.js.mbt)
  mut last_report : String // JSON report of the last completed match
}

// Number of shot-type choices on the practice shot screen (5 strokes / 3 serves).
///|
fn prac_shot_count(self : Game) -> Int {
  if self.prac_feed == 0 {
    5
  } else {
    3
  }
}

///|
fn is_practice_ms(ms : MatchState) -> Bool {
  match ms.practice {
    Some(_) => true
    None => false
  }
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

// Uppercase display label for a groundstroke's shot type (smash-style toast).
///|
fn stroke_label(t : @shots.ShotType) -> String {
  match t {
    Flat => "FLAT"
    Topspin => "TOPSPIN"
    Slice => "SLICE"
    Lob => "LOB"
    Drop => "DROP"
  }
}

// Uppercase display label for a serve type.
///|
fn serve_label(t : @shots.ServeType) -> String {
  match t {
    ServeKick => "KICK"
    ServeSlice => "SLICE"
    ServeFlat => "FLAT"
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
  }
}

///|
fn level_from_idx(i : Int) -> @assist.AssistLevel {
  match i {
    0 => Off
    _ => On
  }
}

///|
fn level_str(l : @assist.AssistLevel) -> String {
  match l {
    Off => "off"
    On => "on"
  }
}

///|
fn names_p() -> String {
  "Player"
}

///|
fn names_c() -> String {
  "Opponent"
}

// ---------------- menu navigation ----------------

// The ordered list of rows shown on the setup screen for the current mode.
// MATCH: mode + assist + difficulty + games.
// PRACTICE: mode + assist + feed + shot (+ depth, stroke feeds only).
///|
fn setup_rows(self : Game) -> Array[RowKind] {
  // Rows common to both modes (Mode, Assist) come first, in the same order, so
  // toggling MATCH/PRACTICE never shifts them; mode-specific rows
  // follow.
  if self.is_practice {
    if self.prac_feed == 0 {
      [Mode, Assist, Feed, Shot, Depth]
    } else {
      [Mode, Assist, Feed, Shot]
    }
  } else {
    [Mode, Assist, Difficulty, Games]
  }
}

///|
fn show_setup(self : Game) -> Unit {
  @ffi.host_show_setup(
    self.host,
    self.is_practice,
    self.setup_row,
    2,
    self.sel_difficulty,
    games_idx_of(self.sel_games),
    assist_idx(),
    self.prac_feed,
    self.prac_shot,
    self.prac_depth,
  )
}

// Change the focused row's value by `dir` (+1 / -1), wrapping. Mode/Feed are
// toggles (any direction flips). Assist is applied + persisted live.
///|
fn setup_change(self : Game, dir : Int) -> Unit {
  let rows = self.setup_rows()
  match rows[self.setup_row] {
    Mode => {
      self.is_practice = !self.is_practice
      // the row list changed length; keep focus in range
      let n = self.setup_rows().length()
      if self.setup_row >= n {
        self.setup_row = n - 1
      }
    }
    Difficulty => self.sel_difficulty = (self.sel_difficulty + dir + 3) % 3
    Games => {
      let i = (games_idx_of(self.sel_games) + dir + 3) % 3
      self.sel_games = games_options[i]
    }
    Assist => {
      let lvl = level_from_idx((assist_idx() + dir + 2) % 2)
      @assist.set_assist_level(lvl)
      @ffi.host_save_assist(self.host, level_str(lvl))
    }
    Feed => {
      self.prac_feed = 1 - self.prac_feed
      if self.prac_shot >= self.prac_shot_count() {
        self.prac_shot = 0
      }
    }
    Shot => {
      let c = self.prac_shot_count()
      self.prac_shot = (self.prac_shot + dir + c) % c
    }
    Depth => self.prac_depth = (self.prac_depth + dir + 3) % 3
  }
  @ffi.host_sfx(self.host, "sfxMenu")
  self.show_setup()
}

// Set the value of row `row` to `val` directly (desktop: clicking one of the
// horizontally-laid-out option chips). Mirrors setup_change's per-kind logic.
///|
fn setup_set(self : Game, row : Int, val : Int) -> Unit {
  let rows = self.setup_rows()
  if row < 0 || row >= rows.length() {
    return
  }
  self.setup_row = row
  match rows[row] {
    Mode => {
      self.is_practice = val == 1
      let n = self.setup_rows().length()
      if self.setup_row >= n {
        self.setup_row = n - 1
      }
    }
    Difficulty => if val >= 0 && val < 3 { self.sel_difficulty = val }
    Games => if val >= 0 && val < games_options.length() { self.sel_games = games_options[val] }
    Assist =>
      if val >= 0 && val < 3 {
        let lvl = level_from_idx(val)
        @assist.set_assist_level(lvl)
        @ffi.host_save_assist(self.host, level_str(lvl))
      }
    Feed =>
      if val >= 0 && val < 2 {
        self.prac_feed = val
        if self.prac_shot >= self.prac_shot_count() {
          self.prac_shot = 0
        }
      }
    Shot => if val >= 0 && val < self.prac_shot_count() { self.prac_shot = val }
    Depth => if val >= 0 && val < 3 { self.prac_depth = val }
  }
  @ffi.host_sfx(self.host, "sfxMenu")
  self.show_setup()
}

///|
fn back_to_home(self : Game) -> Unit {
  self.state = MenuSetup
  self.setup_row = 0
  self.show_setup()
}

///|
fn show_title(self : Game) -> Unit {
  @ffi.host_show_title(self.host)
}

///|
fn title_to_setup(self : Game) -> Unit {
  self.state = MenuSetup
  self.setup_row = 0
  @ffi.host_sfx(self.host, "sfxConfirm")
  self.show_setup()
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

// Practice HUD read-out, e.g. "Stroke · Topspin · Deep" / "Serve · Kick".
///|
fn practice_label(p : Practice) -> String {
  if p.feed == 1 {
    let name = match @shots.practice_serve_type(p.shot) {
      ServeFlat => "Flat"
      ServeSlice => "Slice"
      ServeKick => "Kick"
    }
    "Serve · " + name
  } else {
    let name = shot_label(@shots.practice_stroke_type(p.shot))
    let depth = match p.depth {
      0 => "Shallow"
      1 => "Deep"
      _ => "Random"
    }
    "Stroke · " + name + " · " + depth
  }
}

///|
fn shot_label(t : @shots.ShotType) -> String {
  match t {
    Flat => "Flat"
    Topspin => "Topspin"
    Slice => "Slice"
    Lob => "Lob"
    Drop => "Drop"
  }
}

///|
fn refresh_score(self : Game, ms : MatchState) -> Unit {
  match ms.practice {
    Some(p) => @ffi.host_practice_hud(self.host, practice_label(p))
    None => {
      let ss = @rules.score_strings(ms.m)
      @ffi.host_update_score(
        self.host, ss.games, ss.points, names_p(), names_c(), ms.serve_number,
      )
    }
  }
}

///|
// Map a balance-study shot-policy code to a forced type (0=none / 1=flat /
// 2=topspin / 3=slice).
fn policy_type(code : Int) -> @shots.ShotType? {
  match code {
    1 => Some(Flat)
    2 => Some(Topspin)
    3 => Some(Slice)
    _ => None
  }
}

///|
fn start_match(self : Game) -> Unit {
  let surface_id = "hard"
  let surface = @physics.surface_by_id(surface_id)
  let char_p = @shots.characters[self.sel_player]
  let char_c = @shots.characters[self.sel_opp]
  let ai = @ai.create_ai(char_c, @ai.difficulties[self.sel_difficulty].id)
  // autotune CPU-vs-CPU: side P gets its own AI and the AI speed multiplier
  let ai_p : @ai.Ai? = if self.cpu_vs_cpu && !self.is_practice {
    @assist.set_assist_level(Off)
    Some(@ai.create_ai(char_p, @ai.difficulties[self.sel_difficulty].id))
  } else {
    None
  }
  // Balance-study per-side shot policy (default off): side C = ai, side P = ai_p.
  ai.forced_type = policy_type(@tuning.t.force_type_c)
  ai.return_slice = @tuning.t.return_slice
  match ai_p {
    Some(a) => {
      a.forced_type = policy_type(@tuning.t.force_type_p)
      a.return_slice = @tuning.t.return_slice
    }
    None => ()
  }
  let human = match ai_p {
    Some(a) => create_player(@rules.P, char_p, a.diff.speed_mul)
    None => create_player(@rules.P, char_p, 1.2) // human-only speed buff
  }
  let cpu = create_player(@rules.C, char_c, ai.diff.speed_mul)
  let practice : Practice? = if self.is_practice {
    Some({ feed: self.prac_feed, shot: self.prac_shot, depth: self.prac_depth })
  } else {
    None
  }
  // practice: the CPU is the permanent feeder; points never alternate the server.
  // Otherwise side P serves first unless a balance study set first_server = 1 (C).
  let first_server = if self.is_practice {
    @rules.C
  } else if @tuning.t.first_server == 1 {
    @rules.C
  } else {
    @rules.P
  }
  let ms : MatchState = {
    human,
    cpu,
    ai,
    ball: @physics.make_ball(),
    m: @rules.create_match(first_server, target_games=self.sel_games),
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
    was_in_reach: false,
    practice,
    events: [],
    ai_p,
    p_serve_plan: None,
    p_view_ball: @physics.make_ball(),
    point_log: [],
    last_end_kind: 3,
    point_start_t: -1.0,
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
/// Human reach multiplier: boosted only while returning the CPU's serve
/// (serve in play, no rally shot yet; practice feeds and CPU-driven side P
/// are excluded).
fn human_reach_mul(ms : MatchState) -> Double {
  let returning = ms.point_state == Rally &&
    ms.stats.rally_shots == 0 &&
    ms.last_hit_by == Some(@rules.C) &&
    (match ms.practice {
      None => true
      Some(_) => false
    }) &&
    !@tuning.cpu_p_active()
  if returning {
    return_reach_mul
  } else {
    1.0
  }
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
  let ys : Array[Double] = []
  let after : Array[Bool] = []
  let mut shown = 0
  for p in traj.points {
    if p.t >= from && p.z > 0.3 {
      buf.push(p.x)
      buf.push(p.y)
      buf.push(p.z)
      buf.push(if p.after_bounce { 1.0 } else { 0.0 })
      ys.push(p.y)
      after.push(p.after_bounce)
      shown = shown + 1
    }
  }
  // Apex of the after-bounce arc splits the two best-hit points: the rising
  // crossing of waist height (before/at the apex) and the descending one (after
  // it, on the way to the second bounce). Each is the after-bounce sample
  // closest to waist height on its side, within the same tolerance.
  let mut apex_i = -1
  let mut apex_y = -1.0
  for i = 0; i < shown; i = i + 1 {
    if after[i] && ys[i] > apex_y {
      apex_y = ys[i]
      apex_i = i
    }
  }
  let mut ideal_idx = -1
  let mut best = 0.25
  for i = 0; i <= apex_i; i = i + 1 {
    if after[i] {
      let dh = @vec.dabs(ys[i] - @physics.ideal_contact_h)
      if dh < best {
        best = dh
        ideal_idx = i
      }
    }
  }
  // Only mark the descending point when the arc truly reached waist height (a
  // genuine second opportunity), matching predict_hit_point_fall.
  let mut ideal_idx2 = -1
  if apex_y >= @physics.ideal_contact_h {
    let mut best2 = 0.25
    for i = apex_i + 1; i < shown; i = i + 1 {
      if after[i] {
        let dh = @vec.dabs(ys[i] - @physics.ideal_contact_h)
        if dh < best2 {
          best2 = dh
          ideal_idx2 = i
        }
      }
    }
  }
  @ffi.host_show_trail(self.host, buf, ideal_idx, ideal_idx2)
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
  let shift = if rc == @rules.C {
    @ai.return_shift_factor(ms.ai)
  } else {
    match ms.ai_p {
      Some(a) => @ai.return_shift_factor(a) // CPU-vs-CPU: symmetric read
      None => 1.4
    }
  }
  ent(ms, rc).place(box_cx * shift, -sv_sign * (@physics.court_half_len + 0.7))
  // practice stroke feed isn't a serve: the receiver waits at centre baseline
  match ms.practice {
    Some(p) =>
      if p.feed == 0 {
        ent(ms, rc).place(0.0, -sv_sign * (@physics.court_half_len + 0.7))
      }
    None => ()
  }
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
  ms.p_serve_plan = None
  ent(ms, sv).end_serve_anim()
  @ffi.host_serve_anim(self.host, side_int(sv), false)
  // tell the presentation layer how tense the upcoming point is
  let sit = @rules.point_situation(ms.m)
  @ffi.host_point_situation(self.host, sit)
  @ffi.host_tension(self.host, @rules.situation_tension(sit))
}

///|
fn start_toss(self : Game, ms : MatchState) -> Unit {
  if ms.point_start_t < 0.0 {
    ms.point_start_t = ms.time // first serve attempt (lets/2nd serves keep it)
  }
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
  aim_x : Double,
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
    e.stats, ty, b.px, from_y, b.pz, sv, ms.court_side, aim_x, aim_depth,
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
  match @physics.predict_landing(b, ms.surface) {
    Some(l) => @ffi.host_show_landing(self.host, l.x, l.z)
    None => ()
  }
  if sv == @rules.P {
    @ffi.host_flash_shot(self.host, serve_flash_str(ty))
    // user's serve: show serve type + speed together
    @ffi.host_serve_info(self.host, serve_label(ty), speed * 3.6)
  } else {
    @ffi.host_serve_speed_toast(self.host, speed * 3.6)
  }
}

// Practice serve feed: randomized placement so returns vary side to side.
///|
fn prac_random_preset(self : Game) -> @shots.Preset {
  let r = self.rng.uniform()
  if r < 0.34 {
    Wide
  } else if r < 0.67 {
    Body
  } else {
    T
  }
}

// Practice stroke feed (design/practice-mode): the CPU launches a forced
// groundstroke from its racket toward the human — chosen shot type, forced
// depth, randomized lateral aim. No toss, no serve-box check: it enters play as
// a live groundstroke the human returns.
///|
fn start_feed(self : Game, ms : MatchState, p : Practice) -> Unit {
  let cpu = ms.cpu
  let b = ms.ball
  // ball at the CPU's racket: a clean, slow contact so any shot type computes
  b.active = true
  b.px = cpu.pos_x
  b.py = @physics.ideal_contact_h
  b.pz = cpu.pos_z
  b.vx = 0.0
  b.vy = 0.0
  b.vz = 0.0
  b.sx = 0.0
  b.sy = 0.0
  b.sz = 0.0
  let ty = @shots.practice_stroke_type(p.shot)
  let aim_depth = @shots.practice_depth_aim(p.depth, self.rng.uniform() < 0.5)
  let aim_x = (self.rng.uniform() * 2.0 - 1.0) * 0.85
  let res = @shots.compute_stroke(
    cpu.pos_x, cpu.pos_z, b.px, b.py, b.pz, b.vx, b.vy, b.vz, cpu.stats, ty,
    aim_x, aim_depth, @rules.C, self.rng,
  )
  match res {
    None => {
      // shouldn't happen with a ball at the racket; retry on the next tick
      b.active = false
      ms.state_timer = 0.0
    }
    Some(r) => {
      b.vx = r.vx
      b.vy = r.vy
      b.vz = r.vz
      b.sx = r.sx
      b.sy = r.sy
      b.sz = r.sz
      ms.rally_phase = Live // a groundstroke is already in play
      ms.last_hit_by = Some(@rules.C)
      ms.bounces = 0
      ms.serve_net_touched = false
      ms.point_state = Rally
      ms.ball_stamp = ms.ball_stamp + 1
      let fh = (b.px - cpu.pos_x) * -1.0 >= 0.0 // CPU faces +z
      cpu.start_swing(ty, fh) |> ignore
      let motion = @shots.swing_motion(ms.bounces, b.py, b.pz, ty, volley_forecourt)
      @ffi.host_start_swing(self.host, 1, shot_type_str(ty), fh, motion)
      @ffi.host_sfx_hit(
        self.host, @vec.hypot3(r.vx, r.vy, r.vz), shot_type_str(r.shot_type),
        b.px / 5.5, r.mishit,
      )
      match @physics.predict_landing(b, ms.surface) {
        Some(l) => @ffi.host_show_landing(self.host, l.x, l.z)
        None => ()
      }
    }
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
  let reach_mul = if side == @rules.P { human_reach_mul(ms) } else { 1.0 }
  let res = @shots.compute_stroke(
    e.pos_x, e.pos_z, b.px, b.py, b.pz, b.vx, b.vy, b.vz, e.stats, ty, aim_x,
    aim_depth, side, self.rng, power_mul~, perfect_eligible~,
    charge_cc~, volley~, reach_mul~,
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
        // hitting-point quality (0..100) feedback on the left of the screen
        @ffi.host_hit_quality(self.host, (r.q * 100.0).to_int())
        if r.perfect {
          @ffi.host_sfx(self.host, "sfxPerfect")
        }
        // smash-style label: SMASH / VOLLEY / the groundstroke's shot type
        if r.smash {
          @ffi.host_toast(self.host, "SMASH!", 700)
        } else if r.volley {
          @ffi.host_toast(self.host, "VOLLEY", 700)
        } else {
          @ffi.host_toast(self.host, stroke_label(r.shot_type), 700)
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
  if is_practice_ms(ms) {
    // practice serve feed missed the box: end the rep and re-feed
    @ffi.host_banner(self.host, "FAULT")
    self.point_end(ms, @rules.P, "")
    return
  }
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
    ms.last_end_kind = 2 // refine: unforced error of the double-fault kind
    self.point_end(ms, receiver(ms), "")
  }
}

// ---- match-stats helpers (Appendix A.6) ----

///|
fn record_winner(self : Game, ms : MatchState, side : @rules.Side) -> Unit {
  @ffi.host_sfx_crowd_react(self.host, "cheer", 0.7)
  ms.last_end_kind = 0
  match side {
    @rules.P => ms.stats.p_winners = ms.stats.p_winners + 1
    @rules.C => ms.stats.c_winners = ms.stats.c_winners + 1
  }
}

///|
fn record_error(self : Game, ms : MatchState, side : @rules.Side) -> Unit {
  @ffi.host_sfx_crowd_react(self.host, "groan", 0.55)
  ms.last_end_kind = 1
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
  // practice: no scoring, no stats, no banners — just re-feed after the cooldown
  if is_practice_ms(ms) {
    ms.stats.rally_shots = 0
    if call_text != "" {
      @ffi.host_banner(self.host, call_text)
    }
    return
  }
  // accumulate per-point stats (rally length, net-point outcomes)
  let st = ms.stats
  let rally_len = st.rally_shots // capture before the reset below
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
  let pre_server = ms.m.server
  // per-point log for the autotune match report (autotune.js.mbt)
  ms.point_log.push({
    server: side_int(pre_server),
    serve_number: ms.serve_number,
    winner: side_int(winner),
    rally_shots: rally_len,
    end_kind: ms.last_end_kind,
    duration: if ms.point_start_t >= 0.0 { ms.time - ms.point_start_t } else { 0.0 },
  })
  ms.last_end_kind = 3
  ms.point_start_t = -1.0
  let ev = @rules.add_point(ms.m, winner)
  // notable-point signal for replays / highlight ranking / tension audio
  let is_game = ev == @rules.Game || ev == @rules.SetWon
  let is_set = ev == @rules.SetWon
  let is_break = is_game && winner != pre_server
  @ffi.host_point_highlight(
    self.host, side_int(winner), is_break, is_set, is_set, rally_len,
  )
  // the winner celebrates a game / break / set
  if is_game || is_break {
    @ffi.host_celebrate(self.host, side_int(winner), "big")
  }
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
  @ffi.host_bounce_fx(self.host, px, pz, speed, ms.surface_id)
  // Hawk-Eye: a bounce within ~10 cm of the singles sideline/baseline
  let ax = if px < 0.0 { -px } else { px }
  let az = if pz < 0.0 { -pz } else { pz }
  let dxs = ax - @physics.court_half_width
  let dzs = az - @physics.court_half_len
  let mx = if dxs < 0.0 { -dxs } else { dxs }
  let mz = if dzs < 0.0 { -dzs } else { dzs }
  if mx < 0.10 || mz < 0.10 {
    let is_in = ax <= @physics.court_half_width && az <= @physics.court_half_len
    @ffi.host_close_call(self.host, px, pz, is_in)
  }
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
      // this in-bounds rally shot's first bounce; deep = behind the service line
      ms.stats.total_first_bounces = ms.stats.total_first_bounces + 1
      if @vec.dabs(pz) >= @physics.court_service_line {
        ms.stats.deep_first_bounces = ms.stats.deep_first_bounces + 1
      }
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
  // the player-toggled bird's-eye view overrides the serve/rally framing
  if self.camera_overhead {
    return "overhead"
  }
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
fn confirm_pressed(self : Game) -> Bool {
  @ffi.host_was_pressed(self.host, "Enter") || @ffi.host_was_pressed(self.host, "Space")
}

///|
// Touch (mobile) shot-type selections, chosen via the on-screen F/T/S picker.
// These replace the old random pick; the JS side remembers serve and stroke
// independently (defaults: stroke=Flat, serve=Topspin/"spin").
fn touch_stroke_type(self : Game) -> @shots.ShotType {
  match str_to_shot(@ffi.host_touch_stroke(self.host)) {
    Some(t) => t
    None => Flat
  }
}

///|
fn touch_serve_type(self : Game) -> @shots.ShotType {
  match str_to_shot(@ffi.host_touch_serve(self.host)) {
    Some(t) => t
    None => Topspin
  }
}

///|
fn do_serve(self : Game, ms : MatchState, kind : @shots.ShotType) -> Unit {
  // power is locked from the oscillating meter at the moment the serve key fires
  let power = ms.serve_meter
  let ty = stroke_to_serve(kind)
  let aim_x = @ffi.host_move_x(self.host)
  let aim_depth = -@ffi.host_move_z(self.host)
  self.execute_serve(ms, ty, power, aim_x, aim_depth)
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
  if !live || ph.swinging || ph.whiff_cd > 0.0 {
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
        None => self.touch_stroke_type()
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
    // The bar reflects the elapsed press time as a fraction of charge_max.
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
  ph.start_swing(ph.charge_type, fh) |> ignore
  let motion = @shots.swing_motion(
    ms.bounces, b.py, b.pz, ph.charge_type, volley_forecourt,
  )
  @ffi.host_start_swing(self.host, 0, shot_type_str(ph.charge_type), fh, motion)
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
  if d > ph.reach * human_reach_mul(ms) {
    return false
  }
  let passed = b.pz > ph.pos_z && b.vz > 0.0
  let low = b.py <= safety_drop_y && b.vy < 0.0 && b.vz < safety_approach_rate
  passed || low
}

///|
pub fn handle_input() -> Unit {
  let self = g()
  if self.cpu_vs_cpu {
    return // CPU-vs-CPU: menus are driven via menu_cmd; no host input exists
  }
  let h = self.host
  match self.state {
    MenuTitle =>
      if self.confirm_pressed() {
        self.title_to_setup()
      }
    MenuSetup => {
      let n = self.setup_rows().length()
      if @ffi.host_was_pressed(h, "ArrowUp") {
        self.setup_row = (self.setup_row + n - 1) % n
        @ffi.host_sfx(h, "sfxMenu")
        self.show_setup()
      } else if @ffi.host_was_pressed(h, "ArrowDown") {
        self.setup_row = (self.setup_row + 1) % n
        @ffi.host_sfx(h, "sfxMenu")
        self.show_setup()
      }
      if @ffi.host_was_pressed(h, "ArrowLeft") {
        self.setup_change(-1)
      } else if @ffi.host_was_pressed(h, "ArrowRight") {
        self.setup_change(1)
      }
      if self.confirm_pressed() {
        @ffi.host_sfx(h, "sfxConfirm")
        self.start_match()
      }
    }
    Results =>
      if @ffi.host_was_pressed(self.host, "KeyR") {
        self.start_match() // rematch with the same settings
      } else if self.confirm_pressed() {
        self.back_to_home()
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
      self.back_to_home()
    }
    return
  }
  if @ffi.host_was_pressed(h, "Escape") {
    self.paused = true
    @ffi.host_show_pause(self.host)
    return
  }
  // B (or the on-screen camera button) toggles the bird's-eye view
  if @ffi.host_was_pressed(h, "KeyB") {
    self.camera_overhead = !self.camera_overhead
    @ffi.host_sfx(self.host, "sfxMenu")
  }
  let shot = str_to_shot(@ffi.host_shot_key(h))
  let touch_shot = @ffi.host_was_pressed(h, "TouchShot")
  if ms.point_state == PreServe && server(ms) == @rules.P {
    // any shot-select key (Z/X/C/V) — or the mobile shot button — tosses
    match shot {
      Some(_) => self.start_toss(ms)
      None => if touch_shot { self.start_toss(ms) }
    }
  } else if ms.point_state == Serving && server(ms) == @rules.P {
    match shot {
      Some(s) => self.do_serve(ms, s)
      None => if touch_shot { self.do_serve(ms, self.touch_serve_type()) }
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

  if self.cpu_vs_cpu && !is_practice_ms(ms) {
    // P-side AI drive (mirror of the C block below; see autotune.js.mbt)
    if ms.point_state == Rally && ms.rally_phase != Over {
      let mv = @ai.update_ai(p_ai(ms), p_ai_ctx(ms), self.rng)
      if mv.swing {
        let fh = b.px - ms.human.pos_x >= 0.0 // P faces -z
        if ms.human.start_swing(mv.swing_type, fh) {
          ms.human.pending_type = mv.swing_type
          // aim is hitter-frame (mirror-invariant) — no un-mirror needed
          ms.human.pending_aim_x = mv.swing_aim_x
          ms.human.pending_aim_depth = mv.swing_aim_depth
          let motion = @shots.swing_motion(
            ms.bounces, b.py, b.pz, mv.swing_type, volley_forecourt,
          )
          @ffi.host_start_swing(self.host, 0, shot_type_str(mv.swing_type), fh, motion)
        }
      }
      ms.human.update(dt, -mv.x, -mv.z) // un-mirror movement
    } else {
      ms.human.update(dt, 0.0, 0.0)
    }
    if (ms.point_state == PreServe || ms.point_state == Serving) &&
      server(ms) == @rules.P {
      // pin the AI server's stance like the C branch below pins C's
      ms.human.pos_x = @shots.serve_stance_x(@rules.P, ms.court_side)
      ms.human.pos_z = @physics.court_half_len + 0.4
    }
  } else {
    // human movement
    let mut hx = @ffi.host_move_x(self.host)
    let mut hz = @ffi.host_move_z(self.host)
    // While charging, d-pad controls aim only — no movement
    if ms.human.charging {
      hx = 0.0
      hz = 0.0
    }
    if (ms.point_state == PreServe || ms.point_state == Serving) && server(ms) == @rules.P {
      hz = 0.0 // slide along the baseline only
    }
    ms.human.update(dt, hx, hz)
  }
  ms.stats.p_run = ms.stats.p_run +
    @vec.hypot2(ms.human.vel_x, ms.human.vel_z) * dt
  ms.stats.c_run = ms.stats.c_run +
    @vec.hypot2(ms.cpu.vel_x, ms.cpu.vel_z) * dt
  if !self.cpu_vs_cpu &&
    (ms.point_state == PreServe || ms.point_state == Serving) &&
    server(ms) == @rules.P {
    let sx = @shots.serve_stance_x(@rules.P, ms.court_side)
    if sx > 0.0 {
      ms.human.pos_x = @vec.clampd(ms.human.pos_x, 0.2, 3.9)
    } else {
      ms.human.pos_x = @vec.clampd(ms.human.pos_x, -3.9, -0.2)
    }
    ms.human.pos_z = @physics.court_half_len + 0.4
  }

  // CPU movement / brain. In practice the CPU only feeds and never rallies, so
  // its brain/contact are suppressed; it just stands after each feed.
  if !is_practice_ms(ms) && ms.point_state == Rally && ms.rally_phase != Over {
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
        is_return: ms.point_state == Rally && ms.stats.rally_shots == 0,
      },
      self.rng,
    )
    if mv.swing {
      let fh = (b.px - ms.cpu.pos_x) * -1.0 >= 0.0 // CPU faces +z
      if ms.cpu.start_swing(mv.swing_type, fh) {
        ms.cpu.pending_type = mv.swing_type
        ms.cpu.pending_aim_x = mv.swing_aim_x
        ms.cpu.pending_aim_depth = mv.swing_aim_depth
        let motion = @shots.swing_motion(
          ms.bounces, b.py, b.pz, mv.swing_type, volley_forecourt,
        )
        @ffi.host_start_swing(self.host, 1, shot_type_str(mv.swing_type), fh, motion)
      }
    }
    ms.cpu.update(dt, mv.x, mv.z)
  } else {
    ms.cpu.update(dt, 0.0, 0.0)
  }
  if (ms.point_state == PreServe || ms.point_state == Serving) && server(ms) == @rules.C {
    ms.cpu.pos_z = -(@physics.court_half_len + 0.4)
    // a stroke feed comes from centre baseline; a serve feed from the serve stance
    ms.cpu.pos_x = match ms.practice {
      Some(p) => if p.feed == 0 { 0.0 } else { @shots.serve_stance_x(@rules.C, ms.court_side) }
      None => @shots.serve_stance_x(@rules.C, ms.court_side)
    }
  }

  // human charge / release (hold to charge, release to swing)
  if !self.cpu_vs_cpu {
    self.update_human_charge(ms, dt)
  }

  // swing contacts: human gets a forgiving timing window; CPU is exact.
  let ph = ms.human
  if self.cpu_vs_cpu {
    // CPU-vs-CPU: side P contacts exactly, mirroring the C block below
    if ph.swinging && !ph.contact_done && ph.swing_t >= swing_contact_t {
      ph.contact_done = true
      self.attempt_contact(
        ms, @rules.P, ph.pending_type, ph.pending_aim_x, ph.pending_aim_depth,
        power_mul=1.0,
      )
      |> ignore
    }
  } else if ph.swinging && !ph.contact_done && ph.swing_t >= swing_contact_t - swing_window {
    let aim_x = @ffi.host_move_x(self.host)
    let aim_depth = -@ffi.host_move_z(self.host)
    // Charge adds a bonus on top of the full no-charge baseline.
    let power_mul = 1.0 + charge_power_bonus * ph.swing_charge
    let charge_cc = ph.swing_charge
    if self.attempt_contact(
        ms, @rules.P, ph.swing_type, aim_x, aim_depth, power_mul~,
        perfect_eligible=(!ph.swing_no_perfect), charge_cc~,
      ) {
      ph.contact_done = true
    } else if ph.swing_t >= swing_contact_t + swing_window {
      ph.contact_done = true
      ph.whiff_cd = whiff_cd_dur // released/swung out of reach -> brief cooldown
    }
  }
  let pc = ms.cpu
  if !is_practice_ms(ms) && pc.swinging && !pc.contact_done && pc.swing_t >= swing_contact_t {
    pc.contact_done = true
    self.attempt_contact(
      ms, @rules.C, pc.pending_type, pc.pending_aim_x, pc.pending_aim_depth,
      power_mul=1.0, // CPU swings at the neutral baseline
    )
    |> ignore
  }

  // state-specific
  match ms.point_state {
    PreServe => {
      ms.state_timer = ms.state_timer + dt
      match ms.practice {
        Some(p) =>
          if ms.state_timer > 0.8 {
            if p.feed == 1 {
              // serve feed: forced type, randomized placement, sweet-band power
              ms.cpu_serve_plan = Some({
                type_: @shots.practice_serve_type(p.shot),
                preset: self.prac_random_preset(),
                row: 0.0,
                power: 0.8,
              })
              self.start_toss(ms)
            } else {
              self.start_feed(ms, p)
            }
          }
        None =>
          if server(ms) == @rules.C && ms.state_timer > 1.0 {
            ms.cpu_serve_plan = Some(
              @ai.choose_serve(ms.ai, ms.serve_number == 2, self.rng),
            )
            self.start_toss(ms)
          } else if self.cpu_vs_cpu &&
            server(ms) == @rules.P &&
            ms.state_timer > 1.0 {
            // CPU-vs-CPU: the P-side AI serves with the same plan machinery
            ms.p_serve_plan = Some(
              @ai.choose_serve(p_ai(ms), ms.serve_number == 2, self.rng),
            )
            self.start_toss(ms)
          }
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
            self.execute_serve(
              ms, plan.type_, plan.power,
              @shots.preset_aim_x(plan.preset, sv, ms.court_side), plan.row,
            )
            return
          }
        None => ()
      }
      match ms.p_serve_plan {
        Some(plan) =>
          if sv == @rules.P && b.vy < 0.0 && b.py <= contact_h {
            ms.p_serve_plan = None
            self.execute_serve(
              ms, plan.type_, plan.power,
              @shots.preset_aim_x(plan.preset, sv, ms.court_side), plan.row,
            )
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
        @physics.Bounce(bx, _, bz, speed) =>
          if speed > 2.0 {
            @ffi.host_sfx_bounce(self.host, speed, ms.surface_id)
            @ffi.host_bounce_fx(self.host, bx, bz, speed, ms.surface_id)
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
        // snapshot before teardown_match destroys the MatchState (human
        // matches too — the human-mode golden reads it when a match ends
        // within its step budget)
        self.last_report = build_report(ms, Some(w))
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
  let h_reach = ms.human.reach * human_reach_mul(ms)
  let in_reach = b.active &&
    @vec.hypot2(b.px - ms.human.pos_x, b.pz - ms.human.pos_z) <= h_reach &&
    b.py <= 1.15 + h_reach
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

  // tell the touch shot-type picker whether it's selecting the serve or the
  // stroke right now (your pending serve vs a rally). Sent every frame; the UI
  // only touches the DOM when the value actually changes.
  let shot_ctx = if (ms.point_state == PreServe || ms.point_state == Serving) &&
    server(ms) == @rules.P {
    "serve"
  } else {
    "stroke"
  }
  @ffi.host_set_shot_context(h, shot_ctx)

  // (the on-screen move-assist arrow has been removed)

  // recommended shot type for the current incoming ball
  let ttc = time_to_contact(ms)
  match ttc {
    Some(_) =>
      match recommend_shot_type(ms) {
        Some(t) => @ffi.host_set_recommended_shot(h, shot_type_str(t))
        None => @ffi.host_set_recommended_shot(h, "")
      }
    None => @ffi.host_set_recommended_shot(h, "")
  }
  // sweet-spot position marker (no countdown ring: cd_show = false).
  @ffi.host_set_sweet(
    h, ms.has_sweet, ms.sweet_x, ms.sweet_y, ms.sweet_z, false, 0.0, false,
  )
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
          ms.human.reach * human_reach_mul(ms) + slowmo_margin {
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
// Touch/click bridge. The JS UI tags each interactive element with a string
// `action` and an integer `arg` (a row index, a character index, or 0):
//   setup screen: "row" K (focus row K) · "dec"/"inc" K (change row K's value) · "go"
//   players screen: "you"/"opp" I (pick character I) · "go" (start) · "back"
//   results screen: any tap returns to setup.
pub fn menu_cmd(action : String, a : Int, b : Int) -> Unit {
  let self = g()
  match self.state {
    MenuTitle =>
      if action == "play" {
        self.title_to_setup()
      }
    Results => self.back_to_home()
    MenuSetup => {
      let n = self.setup_rows().length()
      match action {
        "row" =>
          if a >= 0 && a < n {
            self.setup_row = a
            @ffi.host_sfx(self.host, "sfxMenu")
            self.show_setup()
          }
        "dec" =>
          if a >= 0 && a < n {
            self.setup_row = a
            self.setup_change(-1)
          }
        "inc" =>
          if a >= 0 && a < n {
            self.setup_row = a
            self.setup_change(1)
          }
        // desktop: click an option chip to set row `a` to value `b` directly
        "set" => self.setup_set(a, b)
        "go" => {
          @ffi.host_sfx(self.host, "sfxConfirm")
          self.start_match()
        }
        _ => ()
      }
    }
    Match => ()
  }
}

// ---------------- init ----------------

///|
pub fn game_init(host : @ffi.Host, seed : Int) -> Unit {
  let self : Game = {
    host,
    rng: @rng.Gauss::new(seed),
    state: MenuTitle, // option b: open on the branded title screen
    setup_row: 0,
    sel_player: 4,
    sel_opp: 4,
    sel_difficulty: 1,
    sel_games: 6,
    is_practice: false,
    prac_feed: 0,
    prac_shot: 0,
    prac_depth: 2, // default to random depth
    camera_overhead: true, // default to the bird's-eye view
    paused: false,
    time_scale: 1.0,
    ms: None,
    cpu_vs_cpu: false,
    last_report: "",
  }
  the_game.val = Some(self)
  @tuning.set_cpu_p(false) // init resets CPU mode; setCpuMode re-enables it
  // restore assist preference (persisted by the JS layer)
  match @ffi.host_load_assist(host) {
    "off" => @assist.set_assist_level(Off)
    "on" => @assist.set_assist_level(On)
    _ => () // unknown (incl. legacy "full") keeps the default On
  }
  self.show_title()
}
