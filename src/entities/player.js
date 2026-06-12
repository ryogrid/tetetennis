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

  // arms (limbs extend -y from their joint)
  for (const side of ['R', 'L']) {
    const sx = side === 'R' ? 1 : -1;
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.23, 0.52, 0);
    hips.add(shoulder);
    shoulder.add(limbMesh(0.28, 0.045, SKIN));
    const elbow = new THREE.Group();
    elbow.position.y = -0.28;
    shoulder.add(elbow);
    elbow.add(limbMesh(0.26, 0.04, SKIN));
    joints['shoulder' + side] = shoulder;
    joints['elbow' + side] = elbow;
  }

  // racket on the right hand
  const racket = new THREE.Group();
  racket.position.y = -0.26;
  joints.elbowR.add(racket);
  const handle = limbMesh(0.3, 0.02, 0x333333);
  racket.add(handle);
  const headRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.13, 0.016, 8, 18),
    new THREE.MeshLambertMaterial({ color: 0xcccccc }),
  );
  headRing.position.y = -0.42;
  racket.add(headRing);
  const strings = new THREE.Mesh(
    new THREE.CircleGeometry(0.12, 16),
    new THREE.MeshLambertMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
  );
  strings.position.y = -0.42;
  racket.add(strings);
  joints.racket = racket;

  // legs
  for (const side of ['R', 'L']) {
    const sx = side === 'R' ? 1 : -1;
    const hip = new THREE.Group();
    hip.position.set(sx * 0.10, -0.02, 0);
    hips.add(hip);
    hip.add(limbMesh(0.40, 0.05, SHORTS));
    const knee = new THREE.Group();
    knee.position.y = -0.40;
    hip.add(knee);
    knee.add(limbMesh(0.42, 0.045, SKIN));
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
      if (this.swing || this.serveAnim) return false;
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

    // fixed-step movement; move = {x, z} in [-1,1]
    update(dt, move) {
      const slow = this.swing ? 0.45 : 1;
      const tx = move.x * maxSpeed * slow;
      const tz = move.z * maxSpeed * slow;
      const k = Math.min(1, accel * dt / Math.max(maxSpeed, 0.01));
      this.vel.x += (tx - this.vel.x) * k;
      this.vel.z += (tz - this.vel.z) * k;
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

      // base targets: idle/run blend
      const t = {};
      const sw = Math.sin(this.runPhase) * 0.6 * spN;
      t.hips = [0.12 * spN, 0, -lvx / maxSpeed * 0.12];
      t.hipR = [sw, 0, 0];
      t.hipL = [-sw, 0, 0];
      t.kneeR = [Math.max(0, -sw) * 0.9 + 0.06, 0, 0];
      t.kneeL = [Math.max(0, sw) * 0.9 + 0.06, 0, 0];
      t.shoulderR = [-sw * 0.5, 0, 0.18];
      t.shoulderL = [sw * 0.5, 0, -0.18];
      t.elbowR = [0.5, 0, 0];
      t.elbowL = [0.5, 0, 0];
      t.racket = [0.3, 0, 0];
      const bobY = 0.86 + Math.sin(this.runPhase * 2) * 0.02 * (0.4 + spN);

      if (this.swing) {
        const n = this.swing.t / SWING_DUR; // contact at 0.4
        const m = this.swing.fh ? 1 : -1;
        t.hips[1] = m * kf(n, [0, 0.3, 0.4, 0.75, 1], [-0.15, -0.75, 0.25, 0.85, 0.6]);
        t.shoulderR = [
          kf(n, [0, 0.3, 0.4, 0.7, 1], [-0.2, -0.5, -0.35, -0.2, 0]),
          m * kf(n, [0, 0.3, 0.4, 0.7, 1], [0, -0.9, 0.1, 1.1, 0.8]),
          kf(n, [0, 0.3, 0.4, 0.7, 1], [0.2, 0.5, 1.25, 0.9, 0.4]),
        ];
        t.elbowR = [kf(n, [0, 0.3, 0.4, 0.8, 1], [0.5, 1.0, 0.25, 0.7, 0.5]), 0, 0];
        t.racket = [kf(n, [0, 0.3, 0.4, 1], [0.3, 0.8, 0.1, 0.4]), 0, 0];
      }

      if (this.serveAnim) {
        const n = Math.min(this.serveAnim.t / 1.1, 1);
        // toss arm (left) rises, hitting arm trophy -> overhead extension
        t.shoulderL = [kf(n, [0, 0.3, 0.55, 1], [0.3, 2.3, 2.6, 0.6]), 0, -0.1];
        t.elbowL = [kf(n, [0, 0.3, 1], [0.3, 0.1, 0.3]), 0, 0];
        t.shoulderR = [
          kf(n, [0, 0.35, 0.55, 0.62, 0.85, 1], [0.4, 1.9, 2.3, 3.05, 1.6, 0.8]),
          0, 0.25,
        ];
        t.elbowR = [kf(n, [0, 0.35, 0.55, 0.62, 1], [0.4, 1.6, 1.8, 0.1, 0.5]), 0, 0];
        t.racket = [kf(n, [0, 0.5, 0.62, 1], [0.5, 0.8, 0.05, 0.3]), 0, 0];
        t.hips[0] = kf(n, [0, 0.45, 0.62, 1], [0, -0.18, 0.12, 0.05]);
      }

      // smooth-apply
      const k = 1 - Math.pow(0.000001, dt); // fast but not instant
      for (const name of Object.keys(t)) {
        const j = J[name];
        j.rotation.x += (t[name][0] - j.rotation.x) * k;
        j.rotation.y += (t[name][1] - j.rotation.y) * k;
        j.rotation.z += (t[name][2] - j.rotation.z) * k;
      }
      J.hips.position.y += (bobY - J.hips.position.y) * k;
    },

    dispose() {
      scene.remove(root);
    },
  };
  return p;
}
