// Ground bounce: vertical restitution + Coulomb friction impulse with a
// grip/slide branch. Ball treated as hollow sphere, I = (2/3) m r^2, which
// gives the "reach rolling" impulse factor alpha = 2/5.
//
// Horizontal deceleration at the bounce is surface-friction driven:
// - SLIDE (friction too weak to stop the slip during impact):
//     dv_h = mu * Jn,  Jn = (1+ey)*|vy_in|  -> loss proportional to mu,
//   so clay (mu .80) takes far more pace off than grass (mu .38).
// - GRIP (friction "bites" and the contact reaches rolling):
//     dv_h = (2/5) * slip  -> mu no longer matters once it is sufficient,
//   which is why heavy topspin loses similar pace on every surface while
//   the bounce HEIGHT still differs via ey.
import { BALL, BOUNCE_EY } from './constants.js';

const ALPHA = 2 / 5;

// Effective vertical restitution at this impact speed: the ball is hollow
// and deforms, so it returns proportionally less energy the harder it hits
// (anchored at the ITF drop-test speed where surface.ey holds).
export function effectiveEy(ey, vyInAbs) {
  const f = 1 - BOUNCE_EY.slope * (vyInAbs - BOUNCE_EY.vRef);
  return ey * Math.max(BOUNCE_EY.minFrac, Math.min(1, f));
}

// Mutates vel and spin in place. Surface = {ey, mu}.
export function applyBounce(vel, spin, surface) {
  const { mu } = surface;
  const vyIn = vel.y; // < 0
  const ey = effectiveEy(surface.ey, Math.abs(vyIn));
  const Jn = (1 + ey) * Math.abs(vyIn); // normal impulse per unit mass
  vel.y = -ey * vyIn;

  // Contact-point slip velocity (horizontal): slip = v_h - R * (w x n)_h, n = +y
  // (w x n) = (wy*0 - wz*1, ..., wx*1 - wy*0) horizontal parts: (-wz... )
  // w x n with n=(0,1,0): (w.z* ... ) compute: (w.y*n.z - w.z*n.y, w.z*n.x - w.x*n.z, w.x*n.y - w.y*n.x)
  //                     = (-w.z, 0, w.x)
  const slipX = vel.x - BALL.r * (-spin.z);
  const slipZ = vel.z - BALL.r * (spin.x);
  const slipMag = Math.hypot(slipX, slipZ);

  if (slipMag < 1e-9) {
    spin.y *= 0.6;
    return;
  }

  if (mu * Jn >= ALPHA * slipMag) {
    // GRIP: contact reaches rolling during impact ("bite")
    vel.x -= ALPHA * slipX;
    vel.z -= ALPHA * slipZ;
    // pure rolling: R*(w x n)_h = v_h  =>  w.z = -v.x/R, w.x = v.z/R
    spin.x = vel.z / BALL.r;
    spin.z = -vel.x / BALL.r;
    spin.y *= 0.6;
  } else {
    // SLIDE: full friction impulse opposing slip
    const dx = slipX / slipMag, dz = slipZ / slipMag;
    vel.x -= mu * Jn * dx;
    vel.z -= mu * Jn * dz;
    // Angular impulse: dw = -(3 mu Jn / 2R) * (n x d), n x d = (-dz, 0, dx)
    const k = 3 * mu * Jn / (2 * BALL.r);
    spin.x -= k * -dz;
    spin.z -= k * dx;
    spin.y *= 0.6;
  }
}
