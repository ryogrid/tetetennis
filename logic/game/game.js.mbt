// Game-logic entry points exported to JS. JS backend only (.js.mbt) because it
// drives the host via FFI. The full state machine lands in a later phase; this
// is the spike: prove one MoonBit -> JS round trip (render + sound).

///|
priv struct Game {
  host : @ffi.Host
  mut t : Double
}

///|
let game : Ref[Game?] = { val: None }

///|
pub fn game_init(h : @ffi.Host, seed : Int) -> Unit {
  ignore(seed) // RNG seeding lands with the logic port
  game.val = Some({ host: h, t: 0.0 })
}

///|
pub fn fixed_update(dt : Double) -> Unit {
  match game.val {
    Some(g) => {
      g.t = g.t + dt
      // drive the ball along x by accumulated time, and tick a sound — both
      // calls cross the FFI boundary into the JS host.
      @ffi.host_set_ball(g.host, true, g.t, 1.0, 0.0, 0.0, 0.0, 0.0)
      @ffi.host_sfx(g.host, "tick")
    }
    None => ()
  }
}
