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

///|
// Short mid-rally crowd reaction ("groan"|"cheer"|"ooh"), 0..1 intensity.
pub extern "js" fn host_sfx_crowd_react(h : Host, kind : String, intensity : Double) -> Unit =
  "(h,k,i)=>h.audio.sfxCrowdReact(k,i)"

///|
// Spawn a bounce dust puff + skid mark at the ground bounce point (render-only).
pub extern "js" fn host_bounce_fx(h : Host, x : Double, z : Double, speed : Double, surface : String) -> Unit =
  "(h,x,z,s,id)=>h.render.bounceFx(x,z,s,id)"

///|
// A bounce within a few cm of a singles boundary → Hawk-Eye review inset.
pub extern "js" fn host_close_call(h : Host, x : Double, z : Double, is_in : Bool) -> Unit =
  "(h,x,z,i)=>h.ui.hawkEye(x,z,i)"

// ---------------- presentation / drama signals (output-only) ----------------

///|
// The dramatic situation of the upcoming point ("match"|"break"|"deuce"|"normal").
pub extern "js" fn host_point_situation(h : Host, kind : String) -> Unit =
  "(h,k)=>h.onPointSituation(k)"

///|
// Normalized 0..1 tension, fanned out to crowd/music/camera by the host.
pub extern "js" fn host_tension(h : Host, value : Double) -> Unit =
  "(h,v)=>h.onTension(v)"

///|
// Emitted at point end describing why the point was notable (replay/highlights).
pub extern "js" fn host_point_highlight(
  h : Host,
  winner : Int,
  is_break : Bool,
  is_set : Bool,
  is_match : Bool,
  rally_len : Int,
) -> Unit =
  "(h,w,b,s,m,r)=>h.onPointHighlight(w,b,s,m,r)"

// ---------------- match lifecycle ----------------

///|
pub extern "js" fn host_start_match(h : Host, surface_id : String, p_idx : Int, c_idx : Int) -> Unit =
  "(h,s,p,c)=>{h.render.startMatch(s,p,c);h.audio.ambient(true)}"

///|
pub extern "js" fn host_teardown_match(h : Host) -> Unit =
  "(h)=>{h.render.teardownMatch();h.audio.ambient(false)}"

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
// Between-points celebration on the rig ("big" fist pump | "point").
pub extern "js" fn host_celebrate(h : Host, side : Int, kind : String) -> Unit =
  "(h,s,k)=>h.render.celebrate(s,k)"

///|
pub extern "js" fn host_start_swing(h : Host, side : Int, ty : String, fh : Bool, motion : String) -> Unit =
  "(h,s,t,fh,m)=>h.render.startSwing(s,t,fh,m)"

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

// Screen 1: the consolidated setup screen. `is_practice` picks the mode; the
// rest are the current selections (the JS UI owns the label arrays). `row` is
// the focused row index within the mode-dependent row list.
///|
pub extern "js" fn host_show_setup(
  h : Host,
  is_practice : Bool,
  row : Int,
  surface : Int,
  difficulty : Int,
  games_idx : Int,
  assist : Int,
  feed : Int,
  shot : Int,
  depth : Int,
) -> Unit =
  "(h,p,r,su,d,g,a,f,sh,de)=>h.ui.showSetup(p,r,su,d,g,a,f,sh,de)"

// Screen 2: pick your player + opponent. `sel` is the focused section
// (0 = you, 1 = opponent); player/opp are the chosen character indices.
///|
pub extern "js" fn host_show_players(h : Host, sel : Int, player : Int, opp : Int) -> Unit =
  "(h,s,p,o)=>h.ui.showPlayers(s,p,o)"

///|
// Title / brand entry screen (option b). No args — the JS UI owns the markup.
pub extern "js" fn host_show_title(h : Host) -> Unit = "(h)=>h.ui.showTitle()"

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

// serve type + speed combined (shown when the user serves)
///|
pub extern "js" fn host_serve_info(h : Host, ty : String, kmh : Double) -> Unit =
  "(h,t,k)=>h.ui.serveInfo(t,k)"

// hitting-point quality 0..100 (non-serve hits), shown on the left
///|
pub extern "js" fn host_hit_quality(h : Host, q : Int) -> Unit =
  "(h,q)=>{h.ui.hitQuality(q);h.input.haptic(q)}"

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
