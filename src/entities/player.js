// Stick-figure player: primitive rig + procedural pose animation. Built facing
// -z (human default); CPU (side 1) is rotated 180 degrees.
//
// Adapted from old/src/entities/player.js. Movement physics is gone — the
// MoonBit logic owns position/velocity and pushes them via setPlayer(); the rig
// only renders a cosmetic pose. It runs its OWN swing/serve clocks (advanced in
// tick(dt)) for the pose keyframes; the logic just triggers them.
import * as THREE from 'three';

const SWING_DUR = 0.45;

// reusable temporaries for the contact-point aim (immersion 01 §1.4); shared
// because updateVisual runs sequentially per rig, never concurrently.
const _ikHead = new THREE.Vector3();
const _ikSh = new THREE.Vector3();
const _ikToHead = new THREE.Vector3();
const _ikToBall = new THREE.Vector3();
const _ikQd = new THREE.Quaternion();
const _ikQs = new THREE.Quaternion();
const _ikQsh = new THREE.Quaternion();
const _ikQnew = new THREE.Quaternion();
const _ikQpar = new THREE.Quaternion();

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

  // chest carries the whole upper body so it can rotate independently of the
  // hips → hip–shoulder separation / X-factor. Sits at the hips origin, so the
  // torso/shoulder offsets below are unchanged. (immersion 01 §1.1)
  const chest = new THREE.Group();
  hips.add(chest);
  joints.chest = chest;

  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.13, 0.34, 4, 10),
    new THREE.MeshLambertMaterial({ color }),
  );
  torso.position.y = 0.30;
  torso.castShadow = true;
  chest.add(torso);

  // neck lets the head tilt/turn (auto-driven toward the ball)
  const neck = new THREE.Group();
  neck.position.y = 0.52;
  chest.add(neck);
  joints.neck = neck;

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 10),
    new THREE.MeshLambertMaterial({ color: SKIN }),
  );
  head.position.y = 0.20; // 0.72 in the hips frame minus the neck offset
  head.castShadow = true;
  neck.add(head);

  // arms (limbs extend -y from their joint). Limbs are deliberately thick:
  // the only rig the player ever sees is 12-24 m away in FPV.
  for (const side of ['R', 'L']) {
    const sx = side === 'R' ? 1 : -1;
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.23, 0.52, 0);
    chest.add(shoulder);
    shoulder.add(limbMesh(0.28, 0.062, SKIN));
    const elbow = new THREE.Group();
    elbow.position.y = -0.28;
    shoulder.add(elbow);
    elbow.add(limbMesh(0.26, 0.055, SKIN));
    joints['shoulder' + side] = shoulder;
    joints['elbow' + side] = elbow;
  }

  // wrist between the forearm and the racket → racket-head lag + pronation
  const wristR = new THREE.Group();
  wristR.position.y = -0.26;
  joints.elbowR.add(wristR);
  joints.wristR = wristR;
  // racket on the right hand (now hangs off the wrist, same head geometry)
  const racket = new THREE.Group();
  racket.position.y = 0;
  wristR.add(racket);
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
    // ankle + foot: the ankle counter-rotates to keep the foot flat on the
    // ground despite hip/knee swing → believable footing (immersion 01 §1.1)
    const ankle = new THREE.Group();
    ankle.position.y = -0.42;
    knee.add(ankle);
    const foot = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, 0.06, 0.22),
      new THREE.MeshLambertMaterial({ color: 0x222228 }),
    );
    foot.position.set(0, -0.03, 0.06);
    foot.castShadow = true;
    ankle.add(foot);
    joints['hip' + side] = hip;
    joints['knee' + side] = knee;
    joints['ankle' + side] = ankle;
  }

  // Collect every body/racket material so the rig can be dimmed to translucent
  // (behind-player camera). Captured here, before the reach-zone / hit-point
  // rings are added in createPlayerRig, so those overlays are never dimmed.
  const bodyMats = [];
  root.traverse((o) => {
    if (o.material) {
      bodyMats.push({ mat: o.material, op: o.material.opacity, tr: o.material.transparent });
    }
  });

  return { root, joints, bodyMats };
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

// rest → peak (at normalized time `peak`) → rest, for proximal→distal
// sequencing where authors set "when + how much" rather than aligning arrays.
// (immersion 01 §1.2)
function peakAt(n, peak, rest, amp) {
  return kf(n, [0, peak, 1], [rest, amp, rest]);
}

// ---- per-shot-type swing keyframes (normalised time n, contact at 0.4) ----

// Forehand: unit-turn → left arm tracks ball → tucks → rises to catch racket
function fhLeftArm(n) {
  // shoulderL pitch: point forward at the ball on the turn, tuck during swing, rise at finish
  const sp = kf(n, [0, 0.25, 0.4, 0.55, 0.8, 1], [0.3, 1.25, 0.6, 0.8, 1.05, 0.25]);
  const sy = kf(n, [0, 0.25, 0.4, 1], [-0.18, -0.85, -0.2, -0.18]); // reach across to sight the ball
  const sr = kf(n, [0, 0.4, 1], [0, -0.15, 0]);
  const ep = kf(n, [0, 0.25, 0.4, 1], [0.9, 0.2, 1.55, 0.9]); // straighten the point at takeback
  return { shoulderL: [sp, sy, sr], elbowL: [ep, 0, 0] };
}

function fhFlatPose(n) {
  // Level swing → arm rises through contact, finishes upper-left (left shoulder).
  return {
    hips: [
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.10, 0.15, 0.30, 0.24, 0.18, 0.12]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.3, -1.25, 0.3, 0.5, 0.8, 0.5]), // deeper unit-turn coil
      0,
    ],
    shoulderR: [
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.2, -0.4, -0.3, -0.65, -0.5, 0.1]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0, -0.9, 0.0, 0.4, 0.7, 0.3]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.25, 0.7, 1.45, 1.05, 0.9, 0.7]), // wrap over the left shoulder
    ],
    elbowR: [kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.6, 1.0, 0.2, 0.4, 0.75, 0.65]), 0, 0],
    racket: [kf(n, [0, 0.25, 0.4, 1], [0.3, 0.9, 0.05, 0.3]), 0, 0],
    // D1-tuned X-factor + a flatter wrist drive (less lag than topspin)
    chest: [0, kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.10, -0.50, -0.12, 0.08, 0.20, 0.12]), 0],
    wristR: [kf(n, [0, 0.25, 0.4, 0.5, 1], [0.0, 0.45, 0.0, -0.35, -0.10]), 0, 0],
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
      // drop the racket lower below the ball before brushing up (more topspin)
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.35, -0.7, -0.95, -1.1, -0.6, 0.15]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0, -0.9, 0.05, 0.35, 0.7, 0.3]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.25, 0.5, 1.6, 1.05, 0.8, 0.55]), // wrap over the left shoulder
    ],
    elbowR: [kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.6, 0.9, 0.15, 0.3, 0.8, 0.55]), 0, 0],
    racket: [kf(n, [0, 0.25, 0.4, 1], [0.3, 0.8, -0.2, 0.2]), 0, 0],
    // D1-tuned X-factor: shoulders coil ~30° past the hips at takeback, then the
    // hips fire first and the chest unwinds through contact (immersion 02 / 01 §1.2)
    chest: [0, kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.10, -0.55, -0.18, 0.05, 0.18, 0.12]), 0],
    // racket-head lag: wrist laid back through the takeback, windshield-wipers
    // through just after contact for topspin
    wristR: [kf(n, [0, 0.25, 0.4, 0.5, 1], [0.0, 0.6, 0.1, -0.5, -0.15]), 0, 0],
    kneeBend: kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.3, 0.65, 0.40, 0.25, 0.18, 0.22]),
    baseY: 0.83 - kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.01, 0.10, 0.05, 0.05, 0, 0.01]),
  };
}

function fhSlicePose(n) {
  // Continental grip: racket set high (~shoulder), chop high→low under the ball,
  // and finish side-on by pulling the left arm back (chest opens) so the body
  // never squares up to the net.
  return {
    hips: [
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0.10, 0.18, 0.28, 0.22, 0.12]),
      kf(n, [0, 0.3, 0.4, 0.65, 1], [-0.2, -0.8, 0.10, 0.30, 0.25]), // restrained opening — stay sideways
      0,
    ],
    shoulderR: [
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0.3, 0.5, 0.05, -0.2, -0.1]), // set high → chop down
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0, -0.9, 0.05, 0.9, 0.7]),
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0.25, 0.8, 1.2, 0.7, 0.4]),
    ],
    elbowR: [kf(n, [0, 0.3, 0.4, 0.65, 1], [0.6, 1.2, 0.3, 0.6, 0.6]), 0, 0],
    // left arm pulls back/behind on the finish — chest-opening counterbalance
    shoulderL: [
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0.2, 0.1, 0.0, -0.3, -0.4]),
      kf(n, [0, 0.3, 0.4, 0.65, 1], [-0.1, 0.3, 0.5, 0.9, 1.0]),
      0,
    ],
    elbowL: [kf(n, [0, 0.3, 0.4, 1], [0.8, 0.5, 0.35, 0.3]), 0, 0],
    racket: [kf(n, [0, 0.3, 0.4, 1], [0.3, 1.1, 0.2, 0.35]), 0, 0], // face slightly open at contact
    kneeBend: kf(n, [0, 0.3, 0.4, 0.7, 1], [0.25, 0.45, 0.30, 0.22, 0.22]),
    baseY: 0.83 - kf(n, [0, 0.3, 0.4, 0.7, 1], [0.01, 0.06, 0.02, 0, 0.01]),
  };
}

function fhDropPose(n) {
  // Disguised as a normal drive through the takeback, then the swing is checked
  // (寸止め): the speed dies at contact with almost no follow-through — a soft,
  // open-faced touch. Values hold nearly constant after n=0.4 (the freeze).
  return {
    hips: [
      kf(n, [0, 0.25, 0.4, 1], [0.10, 0.15, 0.22, 0.18]), // full-looking coil, then no rotation-through
      kf(n, [0, 0.25, 0.4, 1], [-0.3, -1.0, -0.1, 0.0]),
      0,
    ],
    shoulderR: [
      kf(n, [0, 0.25, 0.4, 1], [-0.2, -0.4, -0.15, -0.05]),
      kf(n, [0, 0.25, 0.4, 1], [0, -0.85, 0.0, 0.05]),
      kf(n, [0, 0.25, 0.4, 1], [0.25, 0.7, 0.6, 0.55]), // no big wrap — checked
    ],
    elbowR: [kf(n, [0, 0.25, 0.4, 1], [0.6, 1.0, 0.6, 0.6]), 0, 0], // soft, no whip
    // left arm points at the ball (disguise) then settles — no rising finish
    shoulderL: [
      kf(n, [0, 0.25, 0.4, 1], [0.3, 1.1, 0.7, 0.6]),
      kf(n, [0, 0.25, 0.4, 1], [-0.18, -0.6, -0.3, -0.2]),
      0,
    ],
    elbowL: [kf(n, [0, 0.25, 0.4, 1], [0.9, 0.4, 0.8, 0.9]), 0, 0],
    racket: [kf(n, [0, 0.25, 0.4, 1], [0.3, 0.9, 0.3, 0.3]), 0, 0], // cocked like a drive → open soft face, held
    kneeBend: kf(n, [0, 0.25, 0.4, 1], [0.22, 0.4, 0.3, 0.28]),
    baseY: 0.83 - kf(n, [0, 0.25, 0.4, 1], [0.01, 0.05, 0.03, 0.02]),
  };
}

// ---- backhand (double-handed) keyframes ----
// Left arm tracks right arm to simulate both hands on the racket.

function bhFlatPose(n) {
  // Double-handed: deep left coil, swing forward, finish upper-right (right shoulder).
  return {
    hips: [
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.10, 0.13, 0.28, 0.24, 0.18, 0.12]),
      // deeper coil (right shoulder under chin), then a restrained opening vs the forehand
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.3, 1.35, -0.2, -0.4, -0.55, -0.4]),
      0,
    ],
    shoulderR: [
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.2, -0.45, -0.3, -0.65, -0.5, 0.2]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0, 1.0, 0.0, -0.5, -0.8, -0.3]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.25, 0.5, 1.1, 0.9, 0.75, 0.6]), // finish over the right shoulder
    ],
    elbowR: [kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.6, 1.0, 0.15, 0.35, 0.75, 0.55]), 0, 0],
    // Left arm (non-dominant) follows the right — double-handed grip
    shoulderL: [
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.2, -0.45, -0.35, -0.6, -0.5, 0.15]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.2, 1.25, 0.0, -0.4, -0.55, -0.3]),
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
      // deeper coil, restrained opening through contact
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.3, 1.4, -0.15, -0.4, -0.55, -0.4]),
      0,
    ],
    shoulderR: [
      // drop lower below the ball before brushing up (more topspin)
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.35, -0.7, -0.95, -1.1, -0.6, 0.2]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0, 1.0, 0.0, -0.45, -0.8, -0.3]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.25, 0.45, 1.3, 0.9, 0.7, 0.55]), // finish over the right shoulder
    ],
    elbowR: [kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.6, 0.9, 0.1, 0.25, 0.8, 0.5]), 0, 0],
    shoulderL: [
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.35, -0.7, -0.95, -1.05, -0.6, 0.15]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.2, 1.3, 0.0, -0.4, -0.55, -0.3]),
      kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [-0.2, 0.3, 0.9, 0.65, 0.4, 0.1]),
    ],
    elbowL: [kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.6, 0.85, 0.05, 0.2, 0.75, 0.55]), 0, 0],
    racket: [kf(n, [0, 0.25, 0.4, 1], [0.3, 0.7, -0.15, 0.2]), 0, 0],
    // D1-tuned X-factor (backhand coils the opposite way) + two-handed wrist lag
    chest: [0, kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.10, 0.55, 0.15, -0.05, -0.18, -0.12]), 0],
    wristR: [kf(n, [0, 0.25, 0.4, 0.5, 1], [0.0, -0.4, 0.0, 0.4, 0.12]), 0, 0],
    kneeBend: kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.3, 0.65, 0.38, 0.25, 0.18, 0.22]),
    baseY: 0.83 - kf(n, [0, 0.25, 0.4, 0.5, 0.7, 1], [0.01, 0.10, 0.04, 0.05, 0, 0.01]),
  };
}

function bhSlicePose(n) {
  // One-handed slice action: racket set high, chop high→low, and the left
  // (non-dominant) arm releases the grip and pulls back so the body stays side-on.
  return {
    hips: [
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0.10, 0.16, 0.26, 0.20, 0.12]),
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0.2, 0.95, -0.1, -0.35, -0.3]), // restrained opening — stay sideways
      0,
    ],
    shoulderR: [
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0.3, 0.45, 0.1, -0.15, -0.05]), // set high → chop down
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0, 1.0, 0, -0.8, -0.6]),
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0.2, 0.6, 1.0, 0.6, 0.4]),
    ],
    elbowR: [kf(n, [0, 0.3, 0.4, 0.65, 1], [0.6, 1.2, 0.25, 0.55, 0.6]), 0, 0],
    // left arm releases and pulls back behind on the finish (one-handed slice)
    shoulderL: [
      kf(n, [0, 0.3, 0.4, 0.65, 1], [0.05, 0.0, 0.0, -0.3, -0.4]),
      kf(n, [0, 0.3, 0.4, 0.65, 1], [-0.15, 0.5, 0.2, -0.8, -1.0]),
      0,
    ],
    elbowL: [kf(n, [0, 0.3, 0.4, 1], [0.6, 0.5, 0.4, 0.3]), 0, 0],
    racket: [kf(n, [0, 0.3, 0.4, 1], [0.3, 1.05, 0.2, 0.35]), 0, 0],
    kneeBend: kf(n, [0, 0.3, 0.4, 0.65, 1], [0.25, 0.45, 0.28, 0.22, 0.22]),
    baseY: 0.83 - kf(n, [0, 0.3, 0.4, 0.65, 1], [0.01, 0.06, 0.02, 0, 0.01]),
  };
}

function bhDropPose(n) {
  // Backhand drop: disguised two-handed takeback like a drive, then checked at
  // contact (寸止め) — values hold nearly constant after n=0.4 (the freeze).
  return {
    hips: [
      kf(n, [0, 0.25, 0.4, 1], [0.10, 0.13, 0.20, 0.16]),
      kf(n, [0, 0.25, 0.4, 1], [0.3, 1.0, 0.0, -0.05]),
      0,
    ],
    shoulderR: [
      kf(n, [0, 0.25, 0.4, 1], [-0.2, -0.45, -0.15, -0.05]),
      kf(n, [0, 0.25, 0.4, 1], [0, 0.95, 0.0, -0.05]),
      kf(n, [0, 0.25, 0.4, 1], [0.25, 0.5, 0.6, 0.55]),
    ],
    elbowR: [kf(n, [0, 0.25, 0.4, 1], [0.6, 1.0, 0.6, 0.6]), 0, 0],
    shoulderL: [
      kf(n, [0, 0.25, 0.4, 1], [-0.2, -0.45, -0.2, -0.1]),
      kf(n, [0, 0.25, 0.4, 1], [-0.2, 1.0, 0.0, -0.05]),
      kf(n, [0, 0.25, 0.4, 1], [-0.2, 0.4, 0.5, 0.45]),
    ],
    elbowL: [kf(n, [0, 0.25, 0.4, 1], [0.6, 0.95, 0.55, 0.6]), 0, 0],
    racket: [kf(n, [0, 0.25, 0.4, 1], [0.3, 0.85, 0.3, 0.3]), 0, 0], // open soft face, held
    kneeBend: kf(n, [0, 0.25, 0.4, 1], [0.22, 0.4, 0.3, 0.28]),
    baseY: 0.83 - kf(n, [0, 0.25, 0.4, 1], [0.01, 0.05, 0.03, 0.02]),
  };
}

// ---- improved serve keyframes ----

// Keep the serve as data so offline mocap tooling can replace just these arrays
// without having to rewrite the evaluator logic in this file.
const SERVE_POSE_TEMPLATE = {
  hips: {
    times: [0, 0.30, 0.50, 0.62, 1],
    values: [
      [0.08, -0.10, -0.34, 0.20, 0.12],
      [-0.6, -0.85, -0.5, 0.0, 0.25, 0.2],
      [0, 0, 0, 0, 0],
    ],
  },
  shoulderL: {
    times: [0, 0.30, 0.50, 1],
    values: [
      [0.3, 2.5, 2.75, 0.5],
      [0, -0.2, -0.15, 0],
      [-0.1, -0.1, -0.1, -0.1],
    ],
  },
  elbowL: {
    times: [0, 0.30, 1],
    values: [
      [0.3, 0.05, 0.3],
      [0, 0, 0],
      [0, 0, 0],
    ],
  },
  shoulderR: {
    times: [0, 0.30, 0.50, 0.62, 0.85, 1],
    values: [
      [0.35, 1.8, 2.4, 3.05, 1.4, 0.7],
      [0.0, 0.0, 0.0, 0.0, 0.5, 0.7],
      [0.25, 0.25, 0.25, 0.25, 0.95, 0.95],
    ],
  },
  elbowR: {
    times: [0, 0.30, 0.50, 0.62, 1],
    values: [
      [0.4, 1.5, 1.85, 0.05, 0.5],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ],
  },
  racket: {
    times: [0, 0.45, 0.62, 0.78, 1],
    values: [
      [0.5, 0.9, 0.0, 0.55, 0.3],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ],
  },
  kneeBend: {
    times: [0, 0.45, 0.62, 1],
    values: [0.2, 0.78, 0.04, 0.22],
  },
  baseY: {
    base: 0.83,
    scale: -1,
    times: [0, 0.45, 0.58, 0.66, 1],
    values: [0.01, 0.15, 0.05, -0.07, 0.02],
  },
};

// First-pass template extracted from movie/serve.mp4 after trimming around the
// active motion window. Kept opt-in until it has been visually tuned.
const IMPORTED_SERVE_POSE_TEMPLATE = {
  hips: {
    times: [0, 0.30, 0.50, 0.62, 0.85, 1],
    values: [
      [-1.000, -1.000, 0.800, 0.800, 0.800, 0.800],
      [-1.200, -1.200, -1.200, -1.176, 1.160, 1.200],
      [0, 0, 0, 0, 0, 0],
    ],
  },
  shoulderL: {
    times: [0, 0.30, 0.50, 0.62, 0.85, 1],
    values: [
      [0.102, 0.533, 0.925, 1.114, 2.751, 2.508],
      [1.382, -0.467, -1.137, -1.018, 0.202, -1.195],
      [0.019, 0.485, 0.509, 0.818, 0.384, 0.263],
    ],
  },
  elbowL: {
    times: [0, 0.30, 0.50, 0.62, 0.85, 1],
    values: [
      [0.022, 0.117, 0.204, 0.245, 0.605, 0.552],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ],
  },
  shoulderR: {
    times: [0, 0.30, 0.50, 0.62, 0.85, 1],
    values: [
      [2.477, 2.290, 0.955, 0.753, 2.153, 2.369],
      [-1.262, -1.308, -0.090, 0.010, 0.008, -0.814],
      [-0.234, 0.289, 0.953, 0.753, 0.988, 0.590],
    ],
  },
  elbowR: {
    times: [0, 0.30, 0.50, 0.62, 0.85, 1],
    values: [
      [1.386, 1.304, 2.115, 0.782, 2.811, 1.600],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ],
  },
  racket: {
    times: [0, 0.30, 0.50, 0.62, 0.85, 1],
    values: [
      [0.310, 0.267, 0.251, 0.444, 0.377, 0.106],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ],
  },
  kneeBend: {
    times: [0, 0.30, 0.50, 0.62, 0.85, 1],
    values: [0.200, 0.780, 0.551, 0.513, 0.342, 0.516],
  },
  baseY: {
    base: 0.83,
    scale: 1,
    times: [0, 0.30, 0.50, 0.62, 0.85, 1],
    values: [0.000, 0.001, 0.001, 0.001, 0.000, 0.001],
  },
};

function retimeScalarSeries(srcTimes, srcValues, dstTimes) {
  return dstTimes.map((t) => kf(t, srcTimes, srcValues));
}

function retimeVec3Template(src, dstTimes) {
  return {
    times: dstTimes,
    values: src.values.map((axisValues) => retimeScalarSeries(src.times, axisValues, dstTimes)),
  };
}

function blendSeries(base, imported, mix, lo = -Infinity, hi = Infinity) {
  return base.map((value, index) => Math.max(lo, Math.min(hi, value * (1 - mix) + imported[index] * mix)));
}

function blendSeriesByMixes(base, imported, mixes, lo = -Infinity, hi = Infinity) {
  return base.map((value, index) => {
    const mix = mixes[index] ?? mixes[mixes.length - 1] ?? 0;
    return Math.max(lo, Math.min(hi, value * (1 - mix) + imported[index] * mix));
  });
}

function buildTunedServeTemplate(baseTpl, importedTpl) {
  const times = importedTpl.hips.times;
  const base = {
    hips: retimeVec3Template(baseTpl.hips, times),
    shoulderL: retimeVec3Template(baseTpl.shoulderL, times),
    elbowL: retimeVec3Template(baseTpl.elbowL, times),
    shoulderR: retimeVec3Template(baseTpl.shoulderR, times),
    elbowR: retimeVec3Template(baseTpl.elbowR, times),
    racket: retimeVec3Template(baseTpl.racket, times),
    kneeBend: { times, values: retimeScalarSeries(baseTpl.kneeBend.times, baseTpl.kneeBend.values, times) },
    baseY: { ...baseTpl.baseY, times, values: retimeScalarSeries(baseTpl.baseY.times, baseTpl.baseY.values, times) },
  };

  return {
    hips: {
      times,
      values: [
        blendSeriesByMixes(base.hips.values[0], importedTpl.hips.values[0], [0.02, 0.04, 0.08, 0.08, 0.04, 0.04], -0.38, 0.24),
        blendSeriesByMixes(base.hips.values[1], importedTpl.hips.values[1], [0.03, 0.06, 0.10, 0.10, 0.06, 0.05], -0.95, 0.35),
        [0, 0, 0, 0, 0, 0],
      ],
    },
    shoulderL: {
      times,
      values: [
        blendSeriesByMixes(base.shoulderL.values[0], importedTpl.shoulderL.values[0], [0.08, 0.10, 0.14, 0.16, 0.08, 0.06], 0.2, 2.85),
        blendSeriesByMixes(base.shoulderL.values[1], importedTpl.shoulderL.values[1], [0.05, 0.08, 0.12, 0.12, 0.08, 0.06], -0.45, 0.10),
        blendSeriesByMixes(base.shoulderL.values[2], importedTpl.shoulderL.values[2], [0.03, 0.08, 0.10, 0.12, 0.08, 0.05], -0.18, 0.18),
      ],
    },
    elbowL: {
      times,
      values: [
        blendSeriesByMixes(base.elbowL.values[0], importedTpl.elbowL.values[0], [0.04, 0.06, 0.08, 0.10, 0.08, 0.06], 0.05, 0.40),
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
      ],
    },
    shoulderR: {
      times,
      values: [
        blendSeriesByMixes(base.shoulderR.values[0], importedTpl.shoulderR.values[0], [0.06, 0.10, 0.14, 0.16, 0.10, 0.08], 0.35, 3.05),
        blendSeriesByMixes(base.shoulderR.values[1], importedTpl.shoulderR.values[1], [0.04, 0.06, 0.08, 0.10, 0.08, 0.06], -0.12, 0.60),
        blendSeriesByMixes(base.shoulderR.values[2], importedTpl.shoulderR.values[2], [0.04, 0.06, 0.10, 0.10, 0.08, 0.06], 0.20, 0.98),
      ],
    },
    elbowR: {
      times,
      values: [
        blendSeriesByMixes(base.elbowR.values[0], importedTpl.elbowR.values[0], [0.04, 0.06, 0.08, 0.10, 0.08, 0.06], 0.05, 1.9),
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
      ],
    },
    racket: {
      times,
      values: [
        blendSeriesByMixes(base.racket.values[0], importedTpl.racket.values[0], [0.04, 0.05, 0.08, 0.08, 0.06, 0.05], 0.0, 0.9),
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
      ],
    },
    kneeBend: {
      times,
      values: blendSeriesByMixes(base.kneeBend.values, importedTpl.kneeBend.values, [0.00, 0.05, 0.08, 0.10, 0.08, 0.06], 0.18, 0.82),
    },
    baseY: {
      base: baseTpl.baseY.base,
      scale: baseTpl.baseY.scale,
      times,
      values: blendSeriesByMixes(base.baseY.values, importedTpl.baseY.values, [0.00, 0.00, 0.00, 0.02, 0.00, 0.00], -0.08, 0.16),
    },
  };
}

const TUNED_IMPORTED_SERVE_POSE_TEMPLATE = buildTunedServeTemplate(
  SERVE_POSE_TEMPLATE,
  IMPORTED_SERVE_POSE_TEMPLATE,
);

function getServePoseTemplate() {
  let choice = 'rear-serve-01-trimmed';
  try {
    choice = window.localStorage.getItem('servePoseTemplate') || 'rear-serve-01-trimmed';
  } catch {
    // localStorage can fail in tests or restricted browser contexts.
  }
  if (choice === 'rear-serve-01-raw') return IMPORTED_SERVE_POSE_TEMPLATE;
  if (choice === 'legacy-default') return SERVE_POSE_TEMPLATE;
  if (choice === 'rear-serve-01-trimmed') return TUNED_IMPORTED_SERVE_POSE_TEMPLATE;
  return TUNED_IMPORTED_SERVE_POSE_TEMPLATE;
}

function sampleVec3Template(n, spec) {
  return spec.values.map((axisValues) => kf(n, spec.times, axisValues));
}

function servePoseFromTemplate(n, tpl) {
  return {
    hips: sampleVec3Template(n, tpl.hips),
    shoulderL: sampleVec3Template(n, tpl.shoulderL),
    elbowL: sampleVec3Template(n, tpl.elbowL),
    shoulderR: sampleVec3Template(n, tpl.shoulderR),
    elbowR: sampleVec3Template(n, tpl.elbowR),
    racket: sampleVec3Template(n, tpl.racket),
    kneeBend: kf(n, tpl.kneeBend.times, tpl.kneeBend.values),
    baseY: tpl.baseY.base + tpl.baseY.scale * kf(n, tpl.baseY.times, tpl.baseY.values),
  };
}

function servePose(n) {
  // n=0..1 mapped over ~1.1s active animation. Contact at n≈0.62.
  // Phases: sideways routine → toss + trophy (deep knee load) → kick-up + body
  // rotation to the highest contact → pronated follow-through across the left.
  return servePoseFromTemplate(n, getServePoseTemplate());
}

// ---- no-bounce keyframes: smash & volley ----

// Smash: an overhead, serve-like motion compressed onto the SWING_DUR clock with
// contact at n=0.4 — half-turn, racket cocked behind the head (trophy), left arm
// raised to sight the ball, reach to the highest point, then snap down and across.
// Overhead is not side-dependent, so this ignores forehand/backhand.
function smashPose(n) {
  return {
    hips: [
      kf(n, [0, 0.25, 0.4, 0.55, 1], [0.10, -0.15, -0.30, 0.12, 0.08]),
      kf(n, [0, 0.25, 0.4, 1], [-0.5, -0.7, 0.0, 0.2]), // sideways → square up
      0,
    ],
    shoulderL: [
      // left arm points up to sight the toss/ball, then drops across the body
      kf(n, [0, 0.25, 0.4, 1], [1.6, 2.6, 2.2, 0.4]),
      0, -0.1,
    ],
    elbowL: [kf(n, [0, 0.3, 1], [0.2, 0.1, 0.5]), 0, 0],
    shoulderR: [
      // cock behind head → reach the highest point at contact → follow down
      kf(n, [0, 0.25, 0.4, 0.6, 1], [1.0, 2.3, 3.05, 1.5, 0.7]),
      0, 0.22,
    ],
    elbowR: [
      // bent trophy, snaps straight at the overhead contact, bends on follow-through
      kf(n, [0, 0.25, 0.4, 0.6, 1], [1.6, 1.7, 0.05, 0.8, 0.5]),
      0, 0,
    ],
    racket: [kf(n, [0, 0.3, 0.4, 1], [0.9, 1.1, 0.0, 0.3]), 0, 0],
    kneeBend: kf(n, [0, 0.25, 0.4, 0.55, 1], [0.25, 0.6, 0.05, 0.2, 0.22]),
    baseY: 0.83 - kf(n, [0, 0.3, 0.4, 0.55, 1], [0.02, 0.1, -0.04, 0.04, 0.02]),
  };
}

// Volley: a compact block/punch. Racket is set up in front at ~eye height with
// almost no backswing, a short step-in through contact, then it stops abruptly
// (minimal follow-through). Arms mirror for the backhand (fh === false), where the
// left hand supports the racket across the body.
function volleyPose(n, fh) {
  const s = fh ? 1 : -1; // forehand stays on the right; backhand crosses to the left
  const pose = {
    hips: [
      kf(n, [0, 0.3, 0.4, 0.6, 1], [0.05, 0.08, 0.12, 0.08, 0.05]),
      kf(n, [0, 0.3, 0.4, 1], [-0.25 * s, -0.4 * s, 0.0, -0.1 * s]),
      0,
    ],
    shoulderR: [
      kf(n, [0, 0.25, 0.4, 0.5, 1], [0.4, 0.55, 0.35, 0.3, 0.45]), // up in front
      kf(n, [0, 0.25, 0.4, 0.5, 1], [-0.3 * s, -0.5 * s, -0.15 * s, -0.1 * s, -0.3 * s]),
      kf(n, [0, 0.4, 1], [0.5, 0.7, 0.5]), // roll keeps the face up as a wall
    ],
    elbowR: [kf(n, [0, 0.25, 0.4, 0.5, 1], [0.5, 0.7, 0.35, 0.35, 0.5]), 0, 0],
    racket: [kf(n, [0, 0.4, 1], [0.4, 0.2, 0.4]), 0, 0],
    kneeBend: kf(n, [0, 0.3, 0.4, 0.6, 1], [0.25, 0.4, 0.3, 0.25, 0.25]),
    baseY: 0.83 - kf(n, [0, 0.3, 0.4, 0.6, 1], [0.02, 0.05, 0.03, 0.02, 0.02]),
  };
  if (!fh) {
    // two-handed backhand block: the left hand supports near the racket
    pose.shoulderL = [
      kf(n, [0, 0.25, 0.4, 0.5, 1], [0.4, 0.55, 0.35, 0.3, 0.45]),
      kf(n, [0, 0.25, 0.4, 0.5, 1], [0.3, 0.5, 0.15, 0.1, 0.3]),
      0,
    ];
    pose.elbowL = [kf(n, [0, 0.25, 0.4, 0.5, 1], [0.6, 0.8, 0.45, 0.45, 0.6]), 0, 0];
  }
  return pose;
}

// ---- swing pose dispatch ----
// Returns {joints, baseY} for the given swing state, or null if swing done.
function getSwingPose(swing) {
  const n = swing.t / SWING_DUR;
  if (swing.motion === 'smash') return smashPose(n);
  if (swing.motion === 'volley') return volleyPose(n, swing.fh);
  if (!swing.fh) {
    // Backhand (double-handed) — left arm tracks right
    switch (swing.type) {
      case 'topspin': return bhTopspinPose(n);
      case 'slice': return bhSlicePose(n);
      case 'drop': return bhDropPose(n);
      default: return bhFlatPose(n); // flat, lob, default
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
  const { root, joints, bodyMats } = buildRig(color);
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
    splitSt: null,     // {t} split-step hop in anticipation of the opponent's hit
    celebSt: null,     // {t, kind} between-points celebration
    slideSt: null,     // {t} clay braking slide
    runPhase: 0,
    _sm: null,
    _smY: undefined,
    _ball: null, // latest active ball world pos, for the contact-point aim

    setPlayer(x, z, vx, vz) {
      this.pos.x = x; this.pos.z = z;
      this.vel.x = vx; this.vel.z = vz;
      root.position.set(x, 0, z);
    },

    startSwing(type, fh, motion) {
      this.serveAnimSt = null; // a lingering follow-through must not block a hit
      this.swing = { t: 0, type, fh, motion: motion || '' };
    },

    serveAnim(on) {
      this.serveAnimSt = on ? { t: 0 } : null;
    },

    // Split-step: a quick load-and-hop as the opponent strikes, the universal
    // "ready" move in tennis. Triggered from render-host when the OTHER side
    // starts a swing. Ignored if already swinging/serving. (immersion 01 §1.3)
    splitStep() {
      if (!this.swing && !this.serveAnimSt) this.splitSt = { t: 0 };
    },

    // Between-points celebration (immersion 06 §6.4): "big" = overhead fist
    // pump, else a small fist. Ignored mid-swing/serve.
    celebrate(kind) {
      if (!this.swing && !this.serveAnimSt) this.celebSt = { t: 0, kind: kind || 'point' };
    },

    // Clay slide: a brief braking crouch, triggered from render-host when a hard
    // deceleration is detected on clay. (immersion 01 §1.3)
    slide() {
      if (!this.swing && !this.serveAnimSt) this.slideSt = { t: 0 };
    },

    // per-frame cosmetic advance: swing/serve clocks, run phase, then pose.
    // `ballState` ({active,pos}|null) lets the swing aim at the real ball.
    tick(dt, ballState) {
      this._ball = ballState && ballState.active ? ballState.pos : null;
      if (this.swing) {
        this.swing.t += dt;
        if (this.swing.t >= SWING_DUR) this.swing = null;
      }
      if (this.serveAnimSt) {
        this.serveAnimSt.t += dt;
        if (this.serveAnimSt.t > 1.4) this.serveAnimSt = null;
      }
      if (this.splitSt) {
        this.splitSt.t += dt;
        if (this.splitSt.t > 0.42) this.splitSt = null;
      }
      if (this.celebSt) {
        this.celebSt.t += dt;
        if (this.celebSt.t > 1.7) this.celebSt = null;
      }
      if (this.slideSt) {
        this.slideSt.t += dt;
        if (this.slideSt.t > 0.5) this.slideSt = null;
      }
      const sp = Math.hypot(this.vel.x, this.vel.z);
      // Distance-locked stride: advance the leg cycle by ground distance covered,
      // not by time, so the feet stop skating (the #1 realism killer). One full
      // cycle (2 steps) ≈ 1.6 m. (immersion 01 §1.5)
      this.runPhase += (sp * dt / 1.6) * (Math.PI * 2);
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
      t.chest = [0, 0, 0];   // X-factor: extra upper-body yaw over the hips
      t.neck = [0.05, 0, 0]; // slight athletic look-down by default
      t.wristR = [0, 0, 0];  // racket-head lag / pronation
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
          // X-factor: shoulders lead the hips. If a pose authors its own chest
          // we honour it; otherwise split the hip yaw so the chest carries ~45%
          // extra rotation and the hips/legs rotate less — hip–shoulder
          // separation. (immersion 01 §1.1-1.2)
          if (pose.chest) {
            t.chest = pose.chest;
          } else {
            t.chest = [0, t.hips[1] * 0.45, 0];
            t.hips[1] *= 0.55;
          }
          // racket-head lag: the wrist lays back through the takeback and whips
          // through just after contact (only possible now the wrist exists)
          const nn = this.swing.t / SWING_DUR;
          t.wristR = pose.wristR
            || [kf(nn, [0, 0.3, 0.4, 0.5, 1], [0.0, 0.5, 0.0, -0.4, -0.1]), 0, 0];
        }
      }

      if (this.serveAnimSt) {
        const n = Math.min(this.serveAnimSt.t / 1.1, 1);
        const sp = servePose(n);
        t.hips[0] = sp.hips[0];
        t.hips[1] = sp.hips[1]; // sideways stance → front rotation through contact
        t.shoulderL = sp.shoulderL;
        t.elbowL = sp.elbowL;
        t.shoulderR = sp.shoulderR;
        t.elbowR = sp.elbowR;
        t.racket = sp.racket;
        t.kneeR[0] = sp.kneeBend;
        t.kneeL[0] = sp.kneeBend;
        baseY = sp.baseY;
        // serve X-factor + wrist pronation snap across contact (n≈0.62)
        t.chest = [0, t.hips[1] * 0.4, 0];
        t.hips[1] *= 0.6;
        t.wristR = [kf(n, [0, 0.5, 0.62, 0.78, 1], [0.2, 0.3, -0.3, 0.45, 0.2]), 0, 0];
      }

      // neck: gentle auto-track toward the ball (subtle on a featureless head,
      // but wires the joint and tilts toward high/low balls). (immersion 01 §1.1)
      if (this._ball) {
        const fwd = isHuman ? 1 : -1;
        const dx = (this._ball.x - this.pos.x) * fwd;
        const dz = Math.max(0.5, Math.abs(this.pos.z - this._ball.z));
        const yaw = Math.max(-0.6, Math.min(0.6, Math.atan2(dx, dz)));
        const pitch = Math.max(-0.4, Math.min(0.4, -(this._ball.y - 1.45) * 0.12 + 0.05));
        t.neck = [pitch, yaw, 0];
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

      // split-step hop: a quick crouch-and-rise with knee load, additive on top
      // of the smoothed stance so it reads crisply (immersion 01 §1.3)
      if (this.splitSt && !this.swing && !this.serveAnimSt) {
        const hop = Math.sin(Math.min(this.splitSt.t / 0.42, 1) * Math.PI); // 0→1→0
        J.hips.position.y -= hop * 0.06;
        J.kneeR.rotation.x += hop * 0.5;
        J.kneeL.rotation.x += hop * 0.5;
      }

      // celebration: raise + pump the racket arm overhead (immersion 06 §6.4)
      if (this.celebSt && !this.swing && !this.serveAnimSt) {
        const ct = this.celebSt.t;
        const big = this.celebSt.kind === 'big';
        const pump = Math.abs(Math.sin(ct * 8)) * (big ? 0.55 : 0.3);
        const fade = ct > 1.3 ? Math.max(0, 1 - (ct - 1.3) / 0.4) : 1;
        J.shoulderR.rotation.x = (big ? -2.2 : -1.4) * fade + pump;
        J.shoulderR.rotation.z = 0.3 * fade;
        J.elbowR.rotation.x = (1.2 - pump) * fade + 0.4;
        J.chest.rotation.x = -0.12 * fade;
      }

      // contact-point aim: during the contact window, rotate the racket shoulder
      // so the racket head swings toward the REAL ball, blended in/out so the
      // stylized swing is preserved everywhere else. World-space (so the CPU's
      // 180° flip is handled), bounded by the blend weight so it can't break the
      // pose. (immersion 01 §1.4)
      if (this.swing && this._ball) {
        const n = this.swing.t / SWING_DUR;
        if (n > 0.28 && n < 0.52) {
          const w = Math.sin(((n - 0.28) / 0.24) * Math.PI); // 0→1→0, peak ~n=0.40
          root.updateMatrixWorld(true);
          const head = _ikHead.set(0, -0.44, 0);
          J.racket.localToWorld(head); // racket sweet-spot in world space
          const sh = _ikSh.setFromMatrixPosition(J.shoulderR.matrixWorld);
          const toBall = _ikToBall.set(
            this._ball.x - sh.x, this._ball.y - sh.y, this._ball.z - sh.z);
          const toHead = _ikToHead.set(head.x - sh.x, head.y - sh.y, head.z - sh.z);
          const db = toBall.length();
          if (db > 0.05 && db < 1.5 && toHead.length() > 0.05) {
            toBall.normalize();
            toHead.normalize();
            _ikQd.setFromUnitVectors(toHead, toBall);   // rotation head→ball
            _ikQs.identity().slerp(_ikQd, Math.min(w, 1) * 0.8); // partial, weighted
            J.shoulderR.getWorldQuaternion(_ikQsh);
            _ikQnew.multiplyQuaternions(_ikQs, _ikQsh); // new world orientation
            J.shoulderR.parent.getWorldQuaternion(_ikQpar).invert();
            J.shoulderR.quaternion.copy(_ikQpar.multiply(_ikQnew)); // back to local
          }
        }
      }

      // clay braking slide: a quick crouch-and-settle (immersion 01 §1.3)
      if (this.slideSt && !this.swing && !this.serveAnimSt) {
        const s = Math.sin(Math.min(this.slideSt.t / 0.5, 1) * Math.PI); // 0→1→0
        J.hips.position.y -= s * 0.05;
        J.kneeR.rotation.x += s * 0.45;
        J.kneeL.rotation.x += s * 0.45;
        J.hips.rotation.x -= s * 0.12; // slight lean back
      }

      // keep the feet roughly flat on the ground despite hip/knee swing — the
      // ankle counter-rotates the leg's accumulated pitch (immersion 01 §1.1/1.5)
      if (J.ankleR) {
        J.ankleR.rotation.x = -(J.hipR.rotation.x + J.kneeR.rotation.x) * 0.7;
        J.ankleL.rotation.x = -(J.hipL.rotation.x + J.kneeL.rotation.x) * 0.7;
      }
    },

    setReachZoneColor(hex) {
      if (this._reachMat) this._reachMat.color.setHex(hex);
    },

    // Charge aura: a vertical additive glow enveloping the body whose size and
    // brightness grow with the charge fraction. Additive blending brightens
    // rather than occludes, so the player stays readable (視認性).
    setAura(frac) {
      const g = this._aura;
      if (!g) return;
      const f = Math.max(0, Math.min(1, frac));
      if (f <= 0.01) { g.visible = false; return; }
      g.visible = true;
      const r = 0.35 + 0.55 * f;   // radius: 0.35 → 0.90 m
      g.scale.set(r, 0.85 + 0.35 * f, r); // slight vertical stretch with charge
      if (this._auraMat) this._auraMat.opacity = 0.12 + 0.4 * f;
    },
    hideAura() { if (this._aura) this._aura.visible = false; },

    // Swing-timing ring: a flat circle concentric with the reach zone that
    // shrinks from the reach radius (frac=1) to the player centre (frac=0).
    setTimingRing(show, frac) {
      const m = this._timingRing;
      if (!m) return;
      const f = Math.max(0, Math.min(1, frac));
      if (!show || f <= 0.001) { m.visible = false; return; }
      m.visible = true;
      m.scale.set(f, f, 1);
    },

    // Dim the whole body + racket to translucent (behind-player camera) so the
    // incoming ball and effects stay visible through the player; restore on
    // overhead view. Overlays (reach zone, hit-point rings) are untouched.
    setTransparent(on) {
      if (this._transparent === on) return;
      this._transparent = on;
      for (const b of bodyMats) {
        const wantTransparent = on || b.tr;
        // toggling `transparent` at runtime needs needsUpdate so the renderer
        // re-evaluates the blending state it cached on first render (otherwise a
        // material first drawn opaque, e.g. starting in overhead, never picks up
        // the change when we later switch to the behind-player view).
        if (b.mat.transparent !== wantTransparent) b.mat.needsUpdate = true;
        b.mat.transparent = wantTransparent;
        b.mat.opacity = on ? b.op * 0.35 : b.op;
      }
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

    // Swing-timing ring: a thin bright annulus concentric with the reach zone,
    // laid flat just above it. Driven by setTimingRing (scaled from the reach
    // radius down to the player centre as the best-hit window approaches).
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffe24a, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });
    const timingRing = new THREE.Mesh(
      new THREE.RingGeometry(reach * 0.9, reach, 48), ringMat,
    );
    timingRing.rotation.x = -Math.PI / 2;
    timingRing.position.y = 0.013;
    timingRing.visible = false;
    root.add(timingRing);
    p._timingRing = timingRing;

    // Charge aura: an open, double-sided additive cylinder wrapping the torso.
    // Radius/height/opacity are driven by setAura; hidden at zero charge.
    const auraMat = new THREE.MeshBasicMaterial({
      color: 0xffcf5a, transparent: true, opacity: 0.0,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const aura = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 2.2, 24, 1, true), auraMat,
    );
    aura.position.y = 1.1;
    aura.visible = false;
    root.add(aura);
    p._aura = aura;
    p._auraMat = auraMat;

    // Best hit-point markers: a hollow green ring on each side of the player at
    // waist/contact height. The hole is ~2x the ball diameter (ball Ø ≈ 0.10 m)
    // so the player can judge where to meet the ball. Standing in the rig root,
    // they follow the player; the torus plane (normal +z) faces the incoming
    // ball. Green harmonises with the on-court sweet-spot marker.
    const hitMat = new THREE.MeshBasicMaterial({
      color: 0x49e08a, transparent: true, opacity: 0.6, side: THREE.DoubleSide,
    });
    for (const sx of [-1, 1]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.10, 0.02, 10, 28), hitMat);
      hoop.position.set(sx * 0.55, 0.95, 0);
      root.add(hoop);
    }
  }

  return p;
}
