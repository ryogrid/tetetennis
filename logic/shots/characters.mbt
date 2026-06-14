// Character stats + roster. Ported from old/src/characters.js. Stats 0-100.
// MoonBit is the source of truth for ids/order/stats; the JS UI carries the
// matching display table keyed by the same index (see design doc 5.5).

///|
pub(all) struct Stats {
  pow : Double
  spn : Double
  slc : Double
  srv : Double
  spd : Double
  ctl : Double
  rea : Double
  net : Double // net-play tendency: how readily the AI rushes the net
}

///|
pub(all) struct Character {
  id : String
  name : String
  archetype : String
  color : Int
  desc : String
  style : String
  stats : Stats
}

///|
pub let characters : Array[Character] = [
  {
    id: "boom",
    name: "Boom",
    archetype: "Big Server",
    color: 0xd84a3a,
    desc: "Huge serve and heavy flat strokes. Slow feet, shaky control.",
    style: "server",
    stats: { pow: 85, spn: 45, slc: 50, srv: 96, spd: 55, ctl: 58, rea: 88, net: 55 },
  },
  {
    id: "rojo",
    name: "Rojo",
    archetype: "Spin Grinder",
    color: 0xe07b2a,
    desc: "Brutal topspin that kicks high, especially on clay. Modest serve.",
    style: "grinder",
    stats: { pow: 74, spn: 96, slc: 55, srv: 62, spd: 82, ctl: 70, rea: 60, net: 22 },
  },
  {
    id: "dash",
    name: "Dash",
    archetype: "Counterpuncher",
    color: 0x3aa0d8,
    desc: "Fastest on tour with laser control. Lacks raw power.",
    style: "counter",
    stats: { pow: 55, spn: 65, slc: 60, srv: 50, spd: 96, ctl: 88, rea: 55, net: 35 },
  },
  {
    id: "sly",
    name: "Sly",
    archetype: "Slice Specialist",
    color: 0x9b59b6,
    desc: "Knifing slices that skid low on grass. Weak topspin game.",
    style: "slicer",
    stats: { pow: 60, spn: 38, slc: 95, srv: 74, spd: 72, ctl: 80, rea: 70, net: 58 },
  },
  {
    id: "ace",
    name: "Ace",
    archetype: "All-Rounder",
    color: 0x2ecc71,
    desc: "No weaknesses, no superweapon. Solid everywhere.",
    style: "allround",
    stats: { pow: 74, spn: 72, slc: 70, srv: 74, spd: 74, ctl: 74, rea: 70, net: 45 },
  },
]
