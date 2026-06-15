// FFI bindings to the JS render/sound/input host. JS backend only (.js.mbt).
// The Host is an opaque JS object { render, audio, ui, camera, input } built by
// the bootstrap and handed to the logic layer at init; MoonBit only ever passes
// it back to these externs. Doubles/Ints/Strings/Bool/Array[Double] marshal
// zero-cost.

///|
#external
pub type Host

// ---------------- audio ----------------

///|
pub extern "js" fn host_sfx(h : Host, name : String) -> Unit = "(h,n)=>h.audio[n]()"

///|
pub extern "js" fn host_sfx_hit(
  h : Host,
  speed : Double,
  shot : String,
  pan : Double,
  jammed : Bool,
) -> Unit =
  "(h,s,t,p,j)=>h.audio.sfxHit(s,t,p,j)"

///|
pub extern "js" fn host_sfx_bounce(h : Host, speed : Double, surface : String) -> Unit =
  "(h,s,id)=>h.audio.sfxBounce(s,id)"

///|
pub extern "js" fn host_sfx_crowd(h : Host, intensity : Double) -> Unit =
  "(h,i)=>h.audio.sfxCrowd(i)"

// ---------------- match lifecycle ----------------

///|
pub extern "js" fn host_start_match(h : Host, surface_id : String, p_idx : Int, c_idx : Int) -> Unit =
  "(h,s,p,c)=>h.render.startMatch(s,p,c)"

///|
pub extern "js" fn host_teardown_match(h : Host) -> Unit = "(h)=>h.render.teardownMatch()"

// ---------------- render: ball ----------------

///|
pub extern "js" fn host_set_ball(
  h : Host,
  active : Bool,
  px : Double,
  py : Double,
  pz : Double,
  sx : Double,
  sy : Double,
  sz : Double,
) -> Unit =
  "(h,a,px,py,pz,sx,sy,sz)=>h.render.setBall(a,px,py,pz,sx,sy,sz)"

///|
pub extern "js" fn host_show_landing(h : Host, x : Double, z : Double) -> Unit =
  "(h,x,z)=>h.render.showLanding(x,z)"

///|
pub extern "js" fn host_hide_landing(h : Host) -> Unit = "(h)=>h.render.hideLanding()"

///|
pub extern "js" fn host_set_sweet(
  h : Host,
  show : Bool,
  x : Double,
  y : Double,
  z : Double,
  cd_show : Bool,
  cd_frac : Double,
  cd_good : Bool,
) -> Unit =
  "(h,s,x,y,z,cs,f,g)=>h.render.setSweet(s,x,y,z,cs,f,g)"

// trail: flat [x,y,z,afterBounce, ...]; ideal_idx marks the waist-height point
///|
pub extern "js" fn host_show_trail(h : Host, pts : Array[Double], ideal_idx : Int) -> Unit =
  "(h,a,i)=>h.render.showTrail(a,i)"

///|
pub extern "js" fn host_hide_trail(h : Host) -> Unit = "(h)=>h.render.hideTrail()"

// ---------------- render: players ----------------

///|
pub extern "js" fn host_set_player(
  h : Host,
  side : Int,
  x : Double,
  z : Double,
  vx : Double,
  vz : Double,
) -> Unit =
  "(h,s,x,z,vx,vz)=>h.render.setPlayer(s,x,z,vx,vz)"

///|
pub extern "js" fn host_start_swing(h : Host, side : Int, ty : String, fh : Bool) -> Unit =
  "(h,s,t,fh)=>h.render.startSwing(s,t,fh)"

///|
pub extern "js" fn host_serve_anim(h : Host, side : Int, on : Bool) -> Unit =
  "(h,s,on)=>h.render.serveAnim(s,on)"

///|
pub extern "js" fn host_reach_color(h : Host, in_reach : Bool) -> Unit =
  "(h,r)=>h.render.setReachColor(r)"

///|
pub extern "js" fn host_open_court(
  h : Host,
  show : Bool,
  x : Double,
  z : Double,
) -> Unit =
  "(h,s,x,z)=>h.render.setOpenCourt(s,x,z)"

// ---------------- camera ----------------
// The camera reads the latest player/ball positions the logic already pushed.

///|
pub extern "js" fn host_camera_update(h : Host, dt : Double, mode : String) -> Unit =
  "(h,dt,m)=>h.camera.update(dt,m)"

///|
pub extern "js" fn host_camera_snap(h : Host, mode : String) -> Unit =
  "(h,m)=>h.camera.snap(m)"

///|
pub extern "js" fn host_serve_look_x(h : Host, x : Double) -> Unit =
  "(h,x)=>h.camera.setServeLookX(x)"

// ---------------- ui: menus ----------------
// The card display data lives in the JS UI keyed by index (same order as the
// MoonBit lists); MoonBit passes the selected index + the screen.

///|
pub extern "js" fn host_show_char_select(h : Host, title : String, idx : Int, subtitle : String) -> Unit =
  "(h,t,i,s)=>h.ui.showCharSelect(t,i,s)"

///|
pub extern "js" fn host_show_surface_select(h : Host, idx : Int) -> Unit =
  "(h,i)=>h.ui.showSurfaceSelect(i)"

///|
pub extern "js" fn host_show_difficulty_select(h : Host, idx : Int) -> Unit =
  "(h,i)=>h.ui.showDifficultySelect(i)"

///|
pub extern "js" fn host_show_assist_select(h : Host, idx : Int) -> Unit =
  "(h,i)=>h.ui.showAssistSelect(i)"

///|
pub extern "js" fn host_show_games_select(h : Host, idx : Int) -> Unit =
  "(h,i)=>h.ui.showGamesSelect(i)"

// practice-mode screens (design/practice-mode)
///|
pub extern "js" fn host_show_mode_select(h : Host, idx : Int) -> Unit =
  "(h,i)=>h.ui.showModeSelect(i)"

///|
pub extern "js" fn host_show_practice_feed(h : Host, idx : Int) -> Unit =
  "(h,i)=>h.ui.showPracticeFeed(i)"

// kind: 0 stroke (5 shot types) / 1 serve (3 serve types)
///|
pub extern "js" fn host_show_practice_shot(h : Host, idx : Int, kind : Int) -> Unit =
  "(h,i,k)=>h.ui.showPracticeShot(i,k)"

///|
pub extern "js" fn host_show_practice_depth(h : Host, idx : Int) -> Unit =
  "(h,i)=>h.ui.showPracticeDepth(i)"

// practice HUD: a single read-out line replacing the scoreboard
///|
pub extern "js" fn host_practice_hud(h : Host, label : String) -> Unit =
  "(h,l)=>h.ui.practiceHud(l)"

///|
pub extern "js" fn host_show_pause(h : Host) -> Unit = "(h)=>h.ui.showPause()"

///|
pub extern "js" fn host_hide_pause(h : Host) -> Unit = "(h)=>h.ui.hidePause()"

///|
pub extern "js" fn host_hide_menu(h : Host) -> Unit = "(h)=>h.ui.hideMenu()"

///|
// stats is a ';'-separated list of "Label\tYou\tOpp" rows for the end screen.
pub extern "js" fn host_show_results(
  h : Host,
  win : String,
  lose : String,
  games : String,
  player_won : Bool,
  difficulty : String,
  stats : String,
) -> Unit =
  "(h,w,l,g,pw,d,s)=>h.ui.showResults(w,l,g,pw,d,s)"

// ---------------- ui: hud ----------------

///|
pub extern "js" fn host_show_hud(h : Host) -> Unit = "(h)=>h.ui.showHUD()"

///|
pub extern "js" fn host_hide_hud(h : Host) -> Unit = "(h)=>h.ui.hideHUD()"

///|
pub extern "js" fn host_update_score(
  h : Host,
  games : String,
  points : String,
  p : String,
  c : String,
  serve_no : Int,
) -> Unit =
  "(h,g,pt,p,c,n)=>h.ui.updateScore(g,pt,p,c,n)"

///|
pub extern "js" fn host_banner(h : Host, text : String) -> Unit = "(h,t)=>h.ui.banner(t)"

///|
pub extern "js" fn host_toast(h : Host, text : String, ms : Int) -> Unit =
  "(h,t,ms)=>h.ui.toast(t,ms)"

///|
pub extern "js" fn host_flash_shot(h : Host, ty : String) -> Unit = "(h,t)=>h.ui.flashShot(t)"

///|
pub extern "js" fn host_serve_speed_toast(h : Host, kmh : Double) -> Unit =
  "(h,k)=>h.ui.serveSpeedToast(k)"

///|
pub extern "js" fn host_set_recommended_shot(h : Host, ty : String) -> Unit =
  "(h,t)=>h.ui.setRecommendedShot(t)"

// name in {toss, timing, height}
///|
pub extern "js" fn host_gauge(
  h : Host,
  name : String,
  frac : Double,
  lo : Double,
  hi : Double,
  good : Bool,
) -> Unit =
  "(h,n,f,lo,hi,g)=>h.ui.gauge(n,f,lo,hi,g)"

///|
pub extern "js" fn host_hide_gauge(h : Host, name : String) -> Unit =
  "(h,n)=>h.ui.hideGauge(n)"

// charge bar: frac in [0,1] of the overcharge ceiling; over = in overcharge zone
///|
pub extern "js" fn host_charge(h : Host, frac : Double) -> Unit =
  "(h,f)=>h.ui.charge(f)"

///|
pub extern "js" fn host_hide_charge(h : Host) -> Unit = "(h)=>h.ui.hideCharge()"

///|
pub extern "js" fn host_move_hint(h : Host, dx : Double, dz : Double) -> Unit =
  "(h,dx,dz)=>h.ui.moveHint(dx,dz)"

///|
pub extern "js" fn host_hide_move_hint(h : Host) -> Unit = "(h)=>h.ui.hideMoveHint()"

// ---------------- input (pull) ----------------

///|
pub extern "js" fn host_was_pressed(h : Host, code : String) -> Bool = "(h,c)=>h.input.wasPressed(c)"

///|
pub extern "js" fn host_move_x(h : Host) -> Double = "(h)=>h.input.moveX()"

///|
pub extern "js" fn host_move_z(h : Host) -> Double = "(h)=>h.input.moveZ()"

// "" | "flat" | "topspin" | "slice"
///|
pub extern "js" fn host_shot_key(h : Host) -> String = "(h)=>h.input.shotKey()"

// currently-held shot key (for hold-to-charge): "" | "flat" | "topspin" | ...
///|
pub extern "js" fn host_shot_held(h : Host) -> String = "(h)=>h.input.shotHeld()"

///|
pub extern "js" fn host_is_down(h : Host, code : String) -> Bool =
  "(h,c)=>h.input.isDown(c)"

// ---------------- assist persistence ----------------

///|
pub extern "js" fn host_load_assist(h : Host) -> String = "(h)=>h.loadAssist()"

///|
pub extern "js" fn host_save_assist(h : Host, level : String) -> Unit = "(h,l)=>h.saveAssist(l)"
