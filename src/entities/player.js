// Stick-figure player: primitive rig, movement, swing/serve state, and
// procedural pose animation. Built facing -z (human default); CPU is
// rotated 180 degrees.
import * as THREE from 'three';
import { STATS_MAP, PLAYER_BOUNDS } from '../physics/constants.js';

const SWING_DUR = 0.45;
export const SWING_CONTACT_T = 0.18;

const SKIN = 0xe8c39e;
const SHORTS = 0x2b2b35;

function limbMesh(len, r, color) {
  const geo = new THREE.CylinderGeometry(r, r * 0.85, len, 8);
  geo.translate(0, -len / 2, 0); // pivot at top
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  m.castShadow = true;
  return m;
}

function buildRig(color) {
  const root = new THREE.Group();
  const joints = {};

  const hips = new THREE.Group();
  hips.position.y = 0.86;
  root.add(hips);
  joints.hips = hips;

  const pelvis = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 10, 8),
    new THREE.MeshLambertMaterial({ color: SHORTS }),
  );
  pelvis.castShadow = true;
  hips.add(pelvis);

  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.13, 0.34, 4, 10),
    new THREE.MeshLambertMaterial({ color }),
  );
  torso.position.y = 0.30;
  torso.castShadow = true;
  hips.add(torso);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 10),
    new THREE.MeshLambertMaterial({ color: SKIN }),
  );
  head.position.y = 0.72;
  head.castShadow = true;
  hips.add(head);

  // arms (limbs extend -y from their joint). Limbs are deliberately thick:
  // the only rig the player ever sees is 12-24 m away in FPV.
  for (const side of ['R', 'L']) {
    const sx = side === 'R' ? 1 : -1;
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.23, 0.52, 0);
    hips.add(shoulder);
    shoulder.add(limbMesh(0.28, 0.062, SKIN));
    const elbow = new THREE.Group();
    elbow.position.y = -0.28;
    shoulder.add(elbow);
    elbow.add(limbMesh(0.26, 0.055, SKIN));
    joints['shoulder' + side] = shoulder;
    joints['elbow' + side] = elbow;
  }

  // racket on the right hand
  const racket = new THREE.Group();
  racket.position.y = -0.26;
  joints.elbowR.add(racket);
  const handle = limbMesh(0.3, 0.028, 0x333333);
  racket.add(handle);
  const headRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.15, 0.022, 8, 18),
    new THREE.MeshLambertMaterial({ color: 0xdddddd }),
  );
  headRing.position.y = -0.44;
  racket.add(headRing);
  const strings = new THREE.Mesh(
    new THREE.CircleGeometry(0.14, 16),
    new THREE.MeshLambertMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
  );
  strings.position.y = -0.44;
  racket.add(strings);
  joints.racket = racket;

  // legs
  for (const side of ['R', 'L']) {
    const sx = side === 'R' ? 1 : -1;
    const hip = new THREE.Group();
    hip.position.set(sx * 0.10, -0.02, 0);
    hips.add(hip);
    hip.add(limbMesh(0.40, 0.068, SHORTS));
    const knee = new THREE.Group();
    knee.position.y = -0.40;
    hip.add(knee);
    knee.add(limbMesh(0.42, 0.06, SKIN));
    joints['hip' + side] = hip;
    joints['knee' + side] = knee;
  }

  return { root, joints };
}

// piecewise-linear keyframe interpolation
function kf(t, times, values) {
  if (t <= times[0]) return values[0];
  for (let i = 1; i < times.length; i++) {
    if (t <= times[i]) {
      const f = (t - times[i - 1]) / (times[i] - times[i - 1]);
      return values[i - 1] + (values[i] - values[i - 1]) * f;
    }
  }
  return values[values.length - 1];
}

export function createPlayer({ side, character, scene, speedMul = 1 }) {
  const { root, joints } = buildRig(character.color);
  if (side === 'C') root.rotation.y = Math.PI;
  scene.add(root);

  const stats = character.stats;
  const maxSpeed = STATS_MAP.runSpeed(stats.SPD) * speedMul;
  const accel = STATS_MAP.runAccel(stats.SPD) * speedMul;

  const p = {
    side, character, stats, root, joints,
    isHuman: side === 'P',
    pos: { x: 0, z: side === 'P' ? 12.5 : -12.5 },
    vel: { x: 0, z: 0 },
    swing: null,      // {t, type, fh, contactDone}
    serveAnim: null,  // {t, hit}
    runPhase: 0,
    maxSpeed,
    reach: STATS_MAP.reach(stats.REA),

    startSwing(type, fh) {
      if (this.swing) return false;
      this.serveAnim = null; // a lingering follow-through must not block a hit
      this.swing = { t: 0, type, fh, contactDone: false };
      return true;
    },

    startServeAnim() {
      this.serveAnim = { t: 0, hit: false };
    },

    endServeAnim() {
      this.serveAnim = null;
    },

    place(x, z) {
      this.pos.x = x; this.pos.z = z;
      this.vel.x = 0; this.vel.z = 0;
    },

    // fixed-step movement; move = {x, z} in [-1,1].
    // Constant-force model: accelerate toward the desired velocity with a
    // limited force; braking (reversing/stopping) is 1.8x stronger, like
    // real footwork. Gives build-up, momentum and overshoot on reversals.
    update(dt, move) {
      const slow = this.swing ? 0.45 : 1;
      const tx = move.x * maxSpeed * slow;
      const tz = move.z * maxSpeed * slow;
      const dvx = tx - this.vel.x, dvz = tz - this.vel.z;
      const dv = Math.hypot(dvx, dvz);
      if (dv > 1e-6) {
        const braking = this.vel.x * dvx + this.vel.z * dvz < 0;
        const step = Math.min(dv, (braking ? accel * 1.8 : accel) * dt);
        this.vel.x += dvx / dv * step;
        this.vel.z += dvz / dv * step;
      }
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;

      const b = PLAYER_BOUNDS;
      this.pos.x = Math.max(b.xMin, Math.min(b.xMax, this.pos.x));
      if (side === 'P') this.pos.z = Math.max(b.zMin, Math.min(b.zMax, this.pos.z));
      else this.pos.z = Math.max(-b.zMax, Math.min(-b.zMin, this.pos.z));

      if (this.swing) {
        this.swing.t += dt;
        if (this.swing.t >= SWING_DUR) this.swing = null;
      }
      if (this.serveAnim) {
        this.serveAnim.t += dt;
        if (this.serveAnim.t > 1.4) this.serveAnim = null;
      }

      const sp = Math.hypot(this.vel.x, this.vel.z);
      this.runPhase += dt * (4 + sp * 2.2);
    },

    updateVisual(dt) {
      root.position.set(this.pos.x, 0, this.pos.z);
      const J = joints;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      const spN = Math.min(sp / maxSpeed, 1);
      // local-frame lateral velocity (for lean)
      const dirSign = side === 'P' ? 1 : -1;
      const lvx = this.vel.x * dirSign;

      // base targets: athletic ready stance (knees bent, racket in front),
      // leaning into the run. The stride oscillation is NOT in here — it is
      // added after the smoothing so the low-pass can't flatten it.
      const t = {};
      t.hips = [0.10 + 0.22 * spN, 0, -lvx / maxSpeed * 0.25];
      t.hipR = [0, 0, 0];
      t.hipL = [0, 0, 0];
      t.kneeR = [0.22, 0, 0];
      t.kneeL = [0.22, 0, 0];
      t.shoulderR = [0.25, 0, 0.18];
      t.shoulderL = [0.25, 0, -0.18];
      t.elbowR = [0.9, 0, 0];
      t.elbowL = [0.9, 0, 0];
      t.racket = [0.3, 0, 0];
      let baseY = 0.83;

      if (this.swing) {
        const n = this.swing.t / SWING_DUR; // contact at 0.4
        const m = this.swing.fh ? 1 : -1;
        t.hips[0] = kf(n, [0, 0.3, 0.4, 0.7, 1], [0.1, 0.15, 0.3, 0.2, 0.12]);
        t.hips[1] = m * kf(n, [0, 0.3, 0.4, 0.75, 1], [-0.3, -1.1, 0.35, 1.2, 0.85]);
        t.shoulderR = [
          kf(n, [0, 0.3, 0.4, 0.7, 1], [-0.2, -0.55, -0.35, -0.2, 0.1]),
          m * kf(n, [0, 0.3, 0.4, 0.7, 1], [0, -1.2, 0.15, 1.5, 1.1]),
          kf(n, [0, 0.3, 0.4, 0.7, 1], [0.25, 0.7, 1.45, 1.0, 0.5]),
        ];
        t.elbowR = [kf(n, [0, 0.3, 0.4, 0.8, 1], [0.6, 1.1, 0.2, 0.7, 0.6]), 0, 0];
        t.racket = [kf(n, [0, 0.3, 0.4, 1], [0.3, 0.9, 0.05, 0.4]), 0, 0];
        // load the legs into the shot, then push up through contact
        const bend = kf(n, [0, 0.3, 0.4, 0.8, 1], [0.3, 0.55, 0.35, 0.2, 0.22]);
        t.kneeR[0] = bend; t.kneeL[0] = bend;
        baseY = 0.83 - kf(n, [0, 0.3, 0.4, 0.8, 1], [0.02, 0.09, 0.03, 0, 0.01]);
      }

      if (this.serveAnim) {
        const n = Math.min(this.serveAnim.t / 1.1, 1);
        // toss arm (left) rises, hitting arm trophy -> overhead extension
        t.shoulderL = [kf(n, [0, 0.3, 0.55, 1], [0.3, 2.3, 2.6, 0.6]), 0, -0.1];
        t.elbowL = [kf(n, [0, 0.3, 1], [0.3, 0.05, 0.3]), 0, 0];
        t.shoulderR = [
          kf(n, [0, 0.35, 0.55, 0.62, 0.85, 1], [0.4, 1.9, 2.3, 3.05, 1.6, 0.8]),
          0, 0.25,
        ];
        t.elbowR = [kf(n, [0, 0.35, 0.55, 0.62, 1], [0.4, 1.6, 1.8, 0.05, 0.5]), 0, 0];
        t.racket = [kf(n, [0, 0.5, 0.62, 1], [0.5, 0.8, 0.05, 0.3]), 0, 0];
        // deep knee bend + back arch in the trophy, drive up into the contact
        t.hips[0] = kf(n, [0, 0.45, 0.62, 1], [0, -0.35, 0.18, 0.06]);
        const bend = kf(n, [0, 0.45, 0.62, 1], [0.15, 0.65, 0.05, 0.2]);
        t.kneeR[0] = bend; t.kneeL[0] = bend;
        baseY = 0.83 - kf(n, [0, 0.45, 0.58, 0.66, 1], [0, 0.12, 0.02, -0.06, 0.02]);
      }

      // smooth-apply the base pose. The filter state lives in this._sm (NOT
      // in the joint rotations) so the additive stride below never leaks
      // into the smoothing.
      const k = 1 - Math.pow(0.00000001, dt); // tau ~54 ms
      const sm = this._sm || (this._sm = {});
      for (const name of Object.keys(t)) {
        const s = sm[name] ||
          (sm[name] = { x: t[name][0], y: t[name][1], z: t[name][2] });
        s.x += (t[name][0] - s.x) * k;
        s.y += (t[name][1] - s.y) * k;
        s.z += (t[name][2] - s.z) * k;
        J[name].rotation.set(s.x, s.y, s.z);
      }
      if (this._smY === undefined) this._smY = baseY;
      this._smY += (baseY - this._smY) * k;
      J.hips.position.y = this._smY +
        Math.sin(this.runPhase * 2) * 0.025 * (0.3 + spN) * spN;

      // full-amplitude run stride on top of the smoothed pose
      const sw = Math.sin(this.runPhase) * 0.9 * spN;
      J.hipR.rotation.x += sw;
      J.hipL.rotation.x -= sw;
      J.kneeR.rotation.x += Math.max(0, -sw) * 1.0;
      J.kneeL.rotation.x += Math.max(0, sw) * 1.0;
      // arms pump counter to the legs (unless they are busy)
      if (!this.swing && !this.serveAnim) J.shoulderR.rotation.x -= sw * 0.8;
      if (!this.serveAnim) J.shoulderL.rotation.x += sw * 0.8;
    },

    dispose() {
      scene.remove(root);
    },
  };

  // Reach zone — filled ground circle + wireframe cylinder so the
  // player can see the full 3D hittable volume (horizontal radius +
  // vertical ceiling). Only for the human player.
  if (p.isHuman) {
    const reach = p.reach;
    const hMax = 1.15 + reach; // max contact height from contactQuality

    // Filled circle on the ground — the full horizontal reach area
    const circGeo = new THREE.CircleGeometry(reach, 48);
    const circMat = new THREE.MeshBasicMaterial({
      color: 0x3988ff, transparent: true, opacity: 0.25, side: THREE.DoubleSide,
    });
    const circle = new THREE.Mesh(circGeo, circMat);
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.012;
    root.add(circle);

    // Wireframe cylinder — the vertical extent (ground → hMax)
    const cylGeo = new THREE.CylinderGeometry(reach, reach, hMax, 32, 4, true);
    const cylMat = new THREE.MeshBasicMaterial({
      color: 0x3988ff, wireframe: true, transparent: true, opacity: 0.35,
    });
    const cyl = new THREE.Mesh(cylGeo, cylMat);
    cyl.position.y = hMax / 2;
    root.add(cyl);

    p._reachZone = { circle, cyl };
  }

  return p;
}
