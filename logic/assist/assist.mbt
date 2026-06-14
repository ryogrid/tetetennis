// Player-side assist axis, decoupled from CPU difficulty. Ported from
// old/src/assist.js (localStorage persistence stays in the JS layer).
//   Off  — classic balance
//   On   — slow-mo approach, easier pace, contact forgiveness (DEFAULT)
//   Full — On + auto-swing + positioning magnetism

///|
pub(all) enum AssistLevel {
  Off
  On
  Full
} derive(Eq, Show)

///|
let level : Ref[AssistLevel] = { val: On }

///|
pub fn assist_on() -> Bool {
  level.val != Off
}

///|
pub fn assist_full() -> Bool {
  level.val == Full
}

///|
pub fn set_assist_level(l : AssistLevel) -> Unit {
  level.val = l
}

///|
pub fn get_assist_level() -> AssistLevel {
  level.val
}
