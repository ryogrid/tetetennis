// FFI bindings to the JS render/sound/input host. JS backend only (.js.mbt).
// The Host is an opaque JS object { render, audio, ui, camera, input } built by
// the bootstrap and handed to the logic layer at init; MoonBit only ever passes
// it back to these externs.

///|
#external
pub type Host

// ---- spike bindings (the full surface lands with the FFI wiring phase) ----

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
pub extern "js" fn host_sfx(h : Host, name : String) -> Unit = "(h,n)=>h.audio[n]()"
