// Small immutable 3-vector + scalar helpers shared across the logic packages.
// Hot simulation state uses flat `mut Double` structs (see physics); Vec3 is for
// pure results (targets, predicted positions) where clarity beats allocation.

///|
pub struct Vec3 {
  x : Double
  y : Double
  z : Double
} derive(Eq)

// 3-arg magnitude. Reproduces JS `Math.hypot(x, y, z)` via nested 2-arg hypot
// (which lowers to `Math.hypot` on the JS backend) so parity holds.
///|
pub fn hypot3(x : Double, y : Double, z : Double) -> Double {
  @math.hypot(@math.hypot(x, y), z)
}

///|
pub fn hypot2(x : Double, y : Double) -> Double {
  @math.hypot(x, y)
}

///|
pub fn dabs(x : Double) -> Double {
  if x < 0.0 {
    -x
  } else {
    x
  }
}

///|
pub fn dmin(a : Double, b : Double) -> Double {
  if a < b {
    a
  } else {
    b
  }
}

///|
pub fn dmax(a : Double, b : Double) -> Double {
  if a > b {
    a
  } else {
    b
  }
}

// Signum matching JS `Math.sign(x) || 0`: 0 for zero/NaN-free inputs.
///|
pub fn dsign(x : Double) -> Double {
  if x > 0.0 {
    1.0
  } else if x < 0.0 {
    -1.0
  } else {
    0.0
  }
}

///|
pub fn clampd(x : Double, lo : Double, hi : Double) -> Double {
  dmax(lo, dmin(hi, x))
}
