// Player numeric state + movement/swing model. Ported from the non-visual half
// of old/src/entities/player.js (the Three.js rig stays in the JS layer, driven
// by host_set_player/host_start_swing). JS backend only (same package as game).

///|
struct Player {
  side : @rules.Side
  stats : @shots.Stats
  mut pos_x : Double
  mut pos_z : Double
  mut vel_x : Double
  mut vel_z : Double
  mut swinging : Bool
  mut swing_t : Double
  mut swing_type : @shots.ShotType
  mut swing_fh : Bool
  mut contact_done : Bool
  mut serve_anim : Bool
  mut serve_anim_t : Double
  mut run_phase : Double
  // charge / Perfect-Hit state (human-driven; the CPU swings at neutral power)
  mut charging : Bool
  mut charge : Double
  mut charge_type : @shots.ShotType
  mut swing_charge : Double // charge captured when the swing fired
  mut swing_no_perfect : Bool // safety hits forgo the Perfect-Hit bonus
  mut stiff_t : Double // post-impact movement stiffness timer
  mut whiff_cd : Double // cooldown after a whiffed release
  max_speed : Double
  reach : Double
  // pending CPU swing (set when the AI requests a swing)
  mut pending_type : @shots.ShotType
  mut pending_aim_x : Double
  mut pending_aim_depth : Double
}

///|
fn create_player(
  side : @rules.Side,
  character : @shots.Character,
  speed_mul : Double,
) -> Player {
  let stats = character.stats
  {
    side,
    stats,
    pos_x: 0.0,
    pos_z: match side {
      @rules.P => 12.5
      @rules.C => -12.5
    },
    vel_x: 0.0,
    vel_z: 0.0,
    swinging: false,
    swing_t: 0.0,
    swing_type: Flat,
    swing_fh: true,
    contact_done: false,
    serve_anim: false,
    serve_anim_t: 0.0,
    run_phase: 0.0,
    charging: false,
    charge: 0.0,
    charge_type: Flat,
    swing_charge: 0.0,
    swing_no_perfect: false,
    stiff_t: 0.0,
    whiff_cd: 0.0,
    max_speed: @physics.run_speed(stats.spd) * speed_mul,
    reach: @physics.reach(stats.rea),
    pending_type: Flat,
    pending_aim_x: 0.0,
    pending_aim_depth: 0.0,
  }
}

///|
fn Player::start_swing(self : Player, ty : @shots.ShotType, fh : Bool) -> Bool {
  if self.swinging {
    return false
  }
  self.serve_anim = false // a lingering follow-through must not block a hit
  self.swinging = true
  self.swing_t = 0.0
  self.swing_type = ty
  self.swing_fh = fh
  self.contact_done = false
  true
}

///|
fn Player::start_serve_anim(self : Player) -> Unit {
  self.serve_anim = true
  self.serve_anim_t = 0.0
}

///|
fn Player::end_serve_anim(self : Player) -> Unit {
  self.serve_anim = false
}

///|
fn Player::place(self : Player, x : Double, z : Double) -> Unit {
  self.pos_x = x
  self.pos_z = z
  self.vel_x = 0.0
  self.vel_z = 0.0
}

// fixed-step movement; any non-zero move input snaps immediately to a constant
// top speed in that direction. Advances swing/serve timers + run phase.
///|
fn Player::update(self : Player, dt : Double, move_x : Double, move_z : Double) -> Unit {
  // post-impact stiffness nearly halts movement briefly after a hit
  let slow = if self.stiff_t > 0.0 {
    stiff_factor
  } else if self.swinging {
    0.45
  } else {
    1.0
  }
  let move_len = @vec.hypot2(move_x, move_z)
  if move_len > 1.0e-6 {
    let speed = self.max_speed * slow
    self.vel_x = move_x / move_len * speed
    self.vel_z = move_z / move_len * speed
  } else {
    self.vel_x = 0.0
    self.vel_z = 0.0
  }
  self.pos_x = self.pos_x + self.vel_x * dt
  self.pos_z = self.pos_z + self.vel_z * dt
  self.pos_x = @vec.clampd(self.pos_x, @physics.player_x_min, @physics.player_x_max)
  match self.side {
    @rules.P =>
      self.pos_z = @vec.clampd(self.pos_z, @physics.player_z_min, @physics.player_z_max)
    @rules.C =>
      self.pos_z = @vec.clampd(self.pos_z, -@physics.player_z_max, -@physics.player_z_min)
  }
  if self.swinging {
    self.swing_t = self.swing_t + dt
    if self.swing_t >= swing_dur {
      self.swinging = false
    }
  }
  if self.stiff_t > 0.0 {
    self.stiff_t = self.stiff_t - dt
  }
  if self.whiff_cd > 0.0 {
    self.whiff_cd = self.whiff_cd - dt
  }
  if self.serve_anim {
    self.serve_anim_t = self.serve_anim_t + dt
    if self.serve_anim_t > 1.4 {
      self.serve_anim = false
    }
  }
  let sp = @vec.hypot2(self.vel_x, self.vel_z)
  self.run_phase = self.run_phase + dt * (4.0 + sp * 2.2)
}
