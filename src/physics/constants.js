// Single source of truth for all physics / court constants.
// SI units, Three.js Y-up. Net plane at z = 0.
// Human player on +z side, CPU on -z side.

export const G = 9.81;
export const DT = 1 / 240;

export const BALL = {
  m: 0.057,
  r: 0.033,
};

export const AERO = {
  rho: 1.21,
  cd: 0.55,
  // rho * A / (2m), A = pi r^2
  kAero: (1.21 * Math.PI * BALL.r * BALL.r) / (2 * BALL.m),
  clMax: 0.35,
  spinDecayTau: 7.0, // s
};

export const COURT = {
  halfLen: 11.885,    // baseline z
  halfWidth: 4.115,   // singles sideline x
  doublesHalfWidth: 5.485,
  serviceLine: 6.40,  // |z| of service lines
  netPostX: 5.029,    // singles sticks
  centerMark: 0.0,
};

export const NET = {
  hCenter: 0.914,
  hPost: 1.07,
};

export function netHeight(x) {
  return NET.hCenter + 0.156 * Math.min(Math.abs(x) / COURT.netPostX, 1);
}

export const LINE_GRACE = BALL.r; // ball touching the line counts in

// Surface bounce parameters. ey = vertical restitution, mu = sliding friction.
export const SURFACES = {
  clay:  { id: 'clay',  ey: 0.83, mu: 0.75 },
  hard:  { id: 'hard',  ey: 0.78, mu: 0.56 },
  grass: { id: 'grass', ey: 0.66, mu: 0.35 },
};

// Player movement bounds (human side; mirror z for CPU)
export const PLAYER_BOUNDS = {
  xMin: -7.0, xMax: 7.0,
  zMin: 0.45,  // closest to net
  zMax: 16.0,
};

export const RPM_TO_RADS = Math.PI * 2 / 60;

// Character stat (0-100) -> physics mappings
export const STATS_MAP = {
  maxFlatSpeed:  (POW) => 26 + 10 * POW / 100,        // m/s
  topspinRpm:    (SPN) => 1500 + 1800 * SPN / 100,
  sliceRpm:      (SLC) => 1000 + 1400 * SLC / 100,
  serveFlatSpeed:(SRV) => 40 + 16 * SRV / 100,        // m/s
  runSpeed:      (SPD) => 5.2 + 2.6 * SPD / 100,      // m/s
  runAccel:      (SPD) => 18 + 14 * SPD / 100,        // m/s^2
  errMulBase:    (CTL) => 1.6 - 1.2 * CTL / 100,
  reach:         (REA) => 1.25 + 0.25 * REA / 100,    // m
  serveContactH: (REA) => 2.55 + 0.55 * REA / 100,    // m
};
