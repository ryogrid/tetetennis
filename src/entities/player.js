// Stick-figure player: primitive rig + procedural pose animation. Built facing
// -z (human default); CPU (side 1) is rotated 180 degrees.
//
// Adapted from old/src/entities/player.js. Movement physics is gone — the
// MoonBit logic owns position/velocity and pushes them via setPlayer(); the rig
// only renders a cosmetic pose. It runs its OWN swing/serve clocks (advanced in
// tick(dt)) for the pose keyframes; the logic just triggers them.
import * as THREE from 'three';

const SWING_DUR = 0.45;

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

// ---- per-shot-type swing keyframes (normalised time n, contact at 0.4) ----

// Forehand: unit-turn → left arm tracks ball → tucks → rises to catch racket
function fhLeftArm(n) {
  // shoulderL pitch: extend forward to track, tuck during swing, rise at finish
  const sp = kf(n, [0, 0.25, 0.4, 0.55, 0.8, 1], [0.25, 1.1, 0.6, 0.8, 1.0, 0.25]);
  const sy = kf(n, [0, 0.25, 0.4, 1], [-0.18, -0.7, -0.2, -0.18]);
  const sr = kf(n, [0, 0.4, 1], [0, -0.15, 0]);
  const ep = kf(n, [0, 0.25, 0.4, 1], [0.9, 0.35, 1.55, 0.9]);
  return { shoulderL: [sp, sy, sr], elbowL: [ep, 0, 0] };
}

function fhFlatPose(n) {
  // Level swing → arm rises through contact, finishes upper-left (left shoulder).
  return {
    hips: [
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.10, 0.15, 0.30, 0.24, 0.18, 0.12]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.3, -1.1, 0.3, 0.5, 0.8, 0.5]),
      0,
    ],
    shoulderR: [
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.2, -0.4, -0.3, -0.65, -0.5, 0.1]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0, -0.9, 0.0, 0.4, 0.7, 0.3]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.25, 0.7, 1.45, 1.0, 0.7, 0.4]),
    ],
    elbowR: [kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.6, 1.0, 0.2, 0.4, 0.75, 0.55]), 0, 0],
    racket: [kf(n, [0, 0.25, 0.4, 1], [0.3, 0.9, 0.05, 0.3]), 0, 0],
    kneeBend: kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.3, 0.55, 0.35, 0.25, 0.20, 0.22]),
    baseY: 0.83 - kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.02, 0.09, 0.03, 0.04, 0, 0.01]),
  };
}

function fhTopspinPose(n) {
  // Steep low→high swing: racket drops below ball, windshield-wiper to upper-left.
  return {
    hips: [
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.10, 0.12, 0.32, 0.22, 0.16, 0.12]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.3, -1.2, 0.25, 0.45, 0.8, 0.5]),
      0,
    ],
    shoulderR: [
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.35, -0.55, -0.75, -1.0, -0.6, 0.1]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0, -0.9, 0.05, 0.35, 0.7, 0.3]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.25, 0.5, 1.6, 1.0, 0.6, 0.3]),
    ],
    elbowR: [kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.6, 0.9, 0.15, 0.3, 0.8, 0.5]), 0, 0],
    racket: [kf(n, [0, 0.25, 0.4, 1], [0.3, 0.75, -0.1, 0.2]), 0, 0],
    kneeBend: kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.3, 0.65, 0.40, 0.25, 0.18, 0.22]),
    baseY: 0.83 - kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.01, 0.10, 0.05, 0.05, 0, 0.01]),
  };
}

function fhSlicePose(n) {
  // High→low swing, open stance (less rotation), knife-through follow-through
  return {
    hips: [
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0.10, 0.18, 0.28, 0.22, 0.12]),
      kf(n, [0, 0.3, 0.4, 0.65, 1], [-0.2, -0.9, 0.2, 0.8, 0.6]), // less coil, less follow
      0,
    ],
    shoulderR: [
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0.1, -0.15, 0.05, 0.2, 0.2]), // starts higher, high→low
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0, -0.9, 0.05, 1.0, 0.8]),
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0.25, 0.8, 1.2, 0.7, 0.4]),
    ],
    elbowR: [kf(n, [0, 0.3, 0.4, 0.65, 1], [0.6, 1.2, 0.3, 0.6, 0.6]), 0, 0],
    racket: [kf(n, [0, 0.3, 0.4, 1], [0.3, 1.1, 0.15, 0.35]), 0, 0],
    kneeBend: kf(n, [0, 0.3, 0.4, 0.7, 1], [0.25, 0.45, 0.30, 0.22, 0.22]),
    baseY: 0.83 - kf(n, [0, 0.3, 0.4, 0.7, 1], [0.01, 0.06, 0.02, 0, 0.01]),
  };
}

function fhDropPose(n) {
  // Short takeback, soft abbreviated follow-through, minimal lower body
  return {
    hips: [
      kf(n, [0, 0.3, 0.4, 0.6, 1], [0.10, 0.14, 0.22, 0.16, 0.12]),
      kf(n, [0, 0.3, 0.4, 0.6, 1], [-0.15, -0.7, 0.15, 0.6, 0.4]),
      0,
    ],
    shoulderR: [
      kf(n, [0, 0.3, 0.4, 0.6, 1], [0.0, -0.25, -0.1, 0.05, 0.2]),
      kf(n, [0, 0.3, 0.4, 0.6, 1], [0, -0.7, 0.05, 0.8, 0.6]),
      kf(n, [0, 0.3, 0.4, 0.6, 1], [0.2, 0.5, 1.0, 0.7, 0.4]),
    ],
    elbowR: [kf(n, [0, 0.3, 0.4, 0.6, 1], [0.6, 1.0, 0.25, 0.5, 0.65]), 0, 0],
    racket: [kf(n, [0, 0.3, 0.4, 1], [0.3, 0.7, 0.1, 0.35]), 0, 0],
    kneeBend: kf(n, [0, 0.3, 0.4, 0.6, 1], [0.22, 0.35, 0.28, 0.22, 0.22]),
    baseY: 0.83 - kf(n, [0, 0.3, 0.4, 0.6, 1], [0.01, 0.04, 0.02, 0, 0]),
  };
}

// ---- backhand (double-handed) keyframes ----
// Left arm tracks right arm to simulate both hands on the racket.

function bhFlatPose(n) {
  // Double-handed: deep left coil, swing forward, finish upper-right (right shoulder).
  return {
    hips: [
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.10, 0.13, 0.28, 0.24, 0.18, 0.12]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.3, 1.2, -0.25, -0.5, -0.8, -0.5]),
      0,
    ],
    shoulderR: [
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.2, -0.45, -0.3, -0.65, -0.5, 0.2]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0, 1.0, 0.0, -0.5, -0.8, -0.3]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.25, 0.5, 1.1, 0.85, 0.6, 0.4]),
    ],
    elbowR: [kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.6, 1.0, 0.15, 0.35, 0.75, 0.55]), 0, 0],
    // Left arm (non-dominant) follows the right — double-handed grip
    shoulderL: [
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.2, -0.45, -0.35, -0.6, -0.5, 0.15]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.2, 1.1, 0.0, -0.5, -0.8, -0.3]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.2, 0.35, 0.75, 0.6, 0.4, 0.15]),
    ],
    elbowL: [kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.6, 0.95, 0.1, 0.3, 0.7, 0.6]), 0, 0],
    racket: [kf(n, [0, 0.25, 0.4, 1], [0.3, 0.85, -0.05, 0.3]), 0, 0],
    kneeBend: kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.3, 0.55, 0.35, 0.25, 0.20, 0.22]),
    baseY: 0.83 - kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.02, 0.09, 0.03, 0.04, 0, 0.01]),
  };
}

function bhTopspinPose(n) {
  // Double-handed topspin: steeper low→high, finish upper-right.
  return {
    hips: [
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.10, 0.12, 0.30, 0.22, 0.15, 0.12]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.3, 1.3, -0.2, -0.5, -0.8, -0.5]),
      0,
    ],
    shoulderR: [
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.35, -0.55, -0.75, -1.0, -0.6, 0.2]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0, 1.0, 0.0, -0.45, -0.8, -0.3]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.25, 0.45, 1.3, 0.85, 0.5, 0.3]),
    ],
    elbowR: [kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.6, 0.9, 0.1, 0.25, 0.8, 0.5]), 0, 0],
    shoulderL: [
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.35, -0.55, -0.78, -0.95, -0.6, 0.15]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.2, 1.1, 0.0, -0.5, -0.8, -0.3]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.2, 0.3, 0.9, 0.65, 0.4, 0.1]),
    ],
    elbowL: [kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.6, 0.85, 0.05, 0.2, 0.75, 0.55]), 0, 0],
    racket: [kf(n, [0, 0.25, 0.4, 1], [0.3, 0.7, -0.15, 0.2]), 0, 0],
    kneeBend: kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.3, 0.65, 0.38, 0.25, 0.18, 0.22]),
    baseY: 0.83 - kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.01, 0.10, 0.04, 0.05, 0, 0.01]),
  };
}

function bhSlicePose(n) {
  return {
    hips: [
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0.10, 0.16, 0.26, 0.20, 0.12]),
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0.2, 1.0, -0.15, -0.7, -0.5]),
      0,
    ],
    shoulderR: [
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0.05, -0.1, 0.1, 0.3, 0.2]),
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0, 1.0, 0, -0.8, -0.6]),
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0.2, 0.6, 1.0, 0.6, 0.4]),
    ],
    elbowR: [kf(n, [0, 0.3, 0.4, 0.65, 1], [0.6, 1.2, 0.25, 0.55, 0.6]), 0, 0],
    shoulderL: [
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0.05, -0.05, 0.05, 0.3, 0.2]),
      kf(n, [0, 0.3, 0.4, 0.65, 1], [-0.15, 1.0, 0.02, -0.75, -0.55]),
      kf(n, [0, 0.3, 0.4, 0.65, 1], [-0.15, 0.4, 0.7, 0.4, 0.15]),
    ],
    elbowL: [kf(n, [0, 0.3, 0.4, 0.65, 1], [0.6, 1.1, 0.2, 0.5, 0.65]), 0, 0],
    racket: [kf(n, [0, 0.3, 0.4, 1], [0.3, 1.05, 0.2, 0.35]), 0, 0],
    kneeBend: kf(n, [0, 0.3, 0.4, 0.65, 1], [0.25, 0.45, 0.28, 0.22, 0.22]),
    baseY: 0.83 - kf(n, [0, 0.3, 0.4, 0.65, 1], [0.01, 0.06, 0.02, 0, 0.01]),
  };
}

// ---- improved serve keyframes ----

function servePose(n) {
  // n=0..1 mapped over ~1.1s active animation.
  // Phases: routine→toss+trophy→knee-drive+contact→follow-through→recovery
  return {
    hips: [
      kf(n, [0, 0.30, 0.50, 0.62, 1], [0.08, -0.08, -0.30, 0.18, 0.08]),
      0, 0,
    ],
    shoulderL: [
      // left arm: rises for toss, then drops
      kf(n, [0, 0.30, 0.50, 1], [0.3, 2.4, 2.7, 0.5]),
      0, -0.1,
    ],
    elbowL: [
      kf(n, [0, 0.30, 1], [0.3, 0.05, 0.3]),
      0, 0,
    ],
    shoulderR: [
      kf(n, [0, 0.30, 0.50, 0.62, 0.85, 1], [0.35, 1.8, 2.4, 3.05, 1.4, 0.7]),
      0, 0.25,
    ],
    elbowR: [
      kf(n, [0, 0.30, 0.50, 0.62, 1], [0.4, 1.5, 1.85, 0.05, 0.5]),
      0, 0,
    ],
    racket: [
      kf(n, [0, 0.45, 0.62, 1], [0.5, 0.9, 0.05, 0.3]),
      0, 0,
    ],
    kneeBend: kf(n, [0, 0.45, 0.62, 1], [0.2, 0.70, 0.08, 0.22]),
    baseY: 0.83 - kf(n, [0, 0.45, 0.58, 0.66, 1], [0.01, 0.14, 0.04, -0.05, 0.02]),
  };
}

// ---- swing pose dispatch ----
// Returns {joints, baseY} for the given swing state, or null if swing done.
function getSwingPose(swing) {
  const n = swing.t / SWING_DUR;
  if (!swing.fh) {
    // Backhand (double-handed) — left arm tracks right
    switch (swing.type) {
      case 'topspin': return bhTopspinPose(n);
      case 'slice': return bhSlicePose(n);
      default: return bhFlatPose(n); // flat, drop, lob, default
    }
  }
  // Forehand
  switch (swing.type) {
    case 'topspin': return fhTopspinPose(n);
    case 'slice': return fhSlicePose(n);
    case 'drop': return fhDropPose(n);
    default: return fhFlatPose(n); // flat, default
  }
}

// side: 0 = human (+z, faces -z), 1 = cpu (-z, rotated PI).
// reach: horizontal reach radius for the human zone circle (ignored for cpu).
export function createPlayerRig({ side, color, reach, scene }) {
  const { root, joints } = buildRig(color);
  const isHuman = side === 0;
  if (!isHuman) root.rotation.y = Math.PI;
  scene.add(root);

  // velocity magnitude is normalised against an assumed top foot speed only for
  // the cosmetic stride/lean amplitude (was maxSpeed in the old physics rig).
  const SPEED_REF = 11.7; // ~ (5.2 + 2.6) * 1.5, the fastest runSpeed

  const p = {
    side, root, joints,
    isHuman,
    pos: { x: 0, z: isHuman ? 12.5 : -12.5 },
    vel: { x: 0, z: 0 },
    swing: null,      // {t, type, fh}
    serveAnimSt: null, // {t}
    runPhase: 0,
    _sm: null,
    _smY: undefined,

    setPlayer(x, z, vx, vz) {
      this.pos.x = x; this.pos.z = z;
      this.vel.x = vx; this.vel.z = vz;
      root.position.set(x, 0, z);
    },

    startSwing(type, fh) {
      this.serveAnimSt = null; // a lingering follow-through must not block a hit
      this.swing = { t: 0, type, fh };
    },

    serveAnim(on) {
      this.serveAnimSt = on ? { t: 0 } : null;
    },

    // per-frame cosmetic advance: swing/serve clocks, run phase, then pose.
    tick(dt) {
      if (this.swing) {
        this.swing.t += dt;
        if (this.swing.t >= SWING_DUR) this.swing = null;
      }
      if (this.serveAnimSt) {
        this.serveAnimSt.t += dt;
        if (this.serveAnimSt.t > 1.4) this.serveAnimSt = null;
      }
      const sp = Math.hypot(this.vel.x, this.vel.z);
      this.runPhase += dt * (4 + sp * 2.2);
      this.updateVisual(dt);
    },

    updateVisual(dt) {
      root.position.set(this.pos.x, 0, this.pos.z);
      const J = joints;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      const spN = Math.min(sp / SPEED_REF, 1);
      // local-frame lateral velocity (for lean)
      const dirSign = isHuman ? 1 : -1;
      const lvx = this.vel.x * dirSign;

      // base targets: athletic ready stance (knees bent, racket in front),
      // leaning into the run. The stride oscillation is NOT in here — it is
      // added after the smoothing so the low-pass can't flatten it.
      const t = {};
      t.hips = [0.10 + 0.22 * spN, 0, -lvx / SPEED_REF * 0.25];
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
        const pose = getSwingPose(this.swing);
        if (pose) {
          t.hips[0] = pose.hips[0];
          t.hips[1] = pose.hips[1];
          t.shoulderR = [pose.shoulderR[0], pose.shoulderR[1], pose.shoulderR[2]];
          t.elbowR = [pose.elbowR[0], 0, 0];
          t.racket = [pose.racket[0], 0, 0];
          t.kneeR[0] = pose.kneeBend;
          t.kneeL[0] = pose.kneeBend;
          baseY = pose.baseY;
          // Left arm: forehand tracking or backhand double-grip
          if (pose.shoulderL) {
            t.shoulderL = pose.shoulderL;
            if (pose.elbowL) t.elbowL = pose.elbowL;
          } else if (this.swing.fh) {
            // Forehand: left arm tracks ball then tucks
            const n = this.swing.t / SWING_DUR;
            const la = fhLeftArm(n);
            t.shoulderL = la.shoulderL;
            t.elbowL = la.elbowL;
          }
        }
      }

      if (this.serveAnimSt) {
        const n = Math.min(this.serveAnimSt.t / 1.1, 1);
        const sp = servePose(n);
        t.hips[0] = sp.hips[0];
        t.shoulderL = sp.shoulderL;
        t.elbowL = sp.elbowL;
        t.shoulderR = sp.shoulderR;
        t.elbowR = sp.elbowR;
        t.racket = sp.racket;
        t.kneeR[0] = sp.kneeBend;
        t.kneeL[0] = sp.kneeBend;
        baseY = sp.baseY;
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
      if (!this.swing && !this.serveAnimSt) J.shoulderR.rotation.x -= sw * 0.8;
      if (!this.serveAnimSt) J.shoulderL.rotation.x += sw * 0.8;
    },

    setReachZoneColor(hex) {
      if (this._reachMat) this._reachMat.color.setHex(hex);
    },

    dispose() {
      scene.remove(root);
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    },
  };

  // Reach zone — filled ground circle showing the horizontal reach area.
  // Only for the human player.
  if (isHuman) {
    const circGeo = new THREE.CircleGeometry(reach, 48);
    const circMat = new THREE.MeshBasicMaterial({
      color: 0x3988ff, transparent: true, opacity: 0.25, side: THREE.DoubleSide,
    });
    const circle = new THREE.Mesh(circGeo, circMat);
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.012;
    root.add(circle);
    p._reachMat = circMat;
  }

  return p;
}
