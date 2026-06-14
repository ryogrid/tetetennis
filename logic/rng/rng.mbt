// Seeded PRNG (mulberry32) + Box-Muller Gaussian, replacing the old unseeded
// Math.random(). Same distributions/clamps as old/src/game/shots.js gauss(), so
// balance is unchanged; the sequence is now deterministic from a seed.
// mulberry32 lowers to Math.imul/>>>/|0 on the JS backend (verified).

///|
pub struct Rng {
  mut s : UInt
}

///|
pub fn Rng::new(seed : Int) -> Rng {
  { s: seed.reinterpret_as_uint() }
}

// Uniform in [0, 1).
///|
pub fn Rng::next_f64(self : Rng) -> Double {
  self.s = self.s + 0x6D2B79F5
  let mut t = self.s
  t = (t ^ (t >> 15)) * (t | 1)
  t = (t + ((t ^ (t >> 7)) * (t | 61))) ^ t
  (t ^ (t >> 14)).to_uint64().to_double() / 4294967296.0
}

// Box-Muller normal with a cached spare, matching the old gauss(): two uniform
// draws produce two normals, one returned, one cached. Clamped to [-2.5, 2.5].
///|
pub struct Gauss {
  rng : Rng
  mut spare : Double
  mut has_spare : Bool
}

///|
pub fn Gauss::new(seed : Int) -> Gauss {
  { rng: Rng::new(seed), spare: 0.0, has_spare: false }
}

///|
pub fn Gauss::draw(self : Gauss) -> Double {
  if self.has_spare {
    self.has_spare = false
    return self.spare
  }
  let mut u = 0.0
  while u == 0.0 {
    u = self.rng.next_f64()
  }
  let mut v = 0.0
  while v == 0.0 {
    v = self.rng.next_f64()
  }
  let m = (-2.0 * @math.ln(u)).sqrt()
  self.spare = m * @math.sin(2.0 * @math.PI * v)
  self.has_spare = true
  @vec.clampd(m * @math.cos(2.0 * @math.PI * v), -2.5, 2.5)
}

// Uniform passthrough for the old bare Math.random() calls (mishit roll, AI
// choices, reaction jitter).
///|
pub fn Gauss::uniform(self : Gauss) -> Double {
  self.rng.next_f64()
}
