// First-person camera: the on-court player's eyes, looking at the opponent
// court. Serve mode keeps facing the target box (no toss tracking); the toss
// is shown on a HUD gauge instead.
//
// Adapted from old/src/camera.js. The old update() took (dt, mode, player,
// ball); it now reads the latest human player + ball positions that the
// render-host stored (passed in as `renderHost`). The exact camera math
// (CAMERA_BACK, EYE_H, lerp constants, look offsets) is unchanged.
import * as THREE from 'three';

const EYE_H = 1.62;
const EYE_BACK = 0.15; // eyes slightly behind the body position
const CAMERA_BACK = 2.5; // meters behind body — pull back enough to see the full player
const SERVICE_LINE = 6.40; // |z| of the service line (was COURT.serviceLine)
// Overhead ("bird's-eye") view: high and behind the player, looking down-court.
const OVER_H = 8.5; // meters above the court
const OVER_BACK = 5.5; // meters behind the player
const OVER_LOOK_AHEAD = 16; // look at a point this far down-court from the player
const OVER_LOOK_X = 0.4; // fraction of the player's x carried into the look target

export function createCameraRig(camera, renderHost) {
  const pos = new THREE.Vector3(0, EYE_H, 12.5);
  const look = new THREE.Vector3(0, 0.9, -6);
  const desiredPos = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  let serveLookX = 0;
  let _mode = 'rally';

  return {
    // x of the target service box center; set when players are placed
    setServeLookX(x) { serveLookX = x; },
    getMode() { return _mode; },
    update(dt, mode) {
      _mode = mode;
      const player = renderHost.getPlayer(0); // human (side 0, +z)
      const ball = renderHost.getBall();
      const eyeX = player.pos.x;
      const eyeZ = player.pos.z + CAMERA_BACK;
      if (mode === 'overhead') {
        // Overhead view overrides the serve/rally framing: a high, over-the-
        // shoulder angle behind and above the player, looking down-court. It
        // follows the player and ignores serveLookX.
        desiredPos.set(eyeX, OVER_H, player.pos.z + OVER_BACK);
        desiredLook.set(eyeX * OVER_LOOK_X, 0, player.pos.z - OVER_LOOK_AHEAD);
      } else {
        desiredPos.set(eyeX, EYE_H, eyeZ);
        // All look targets are EYE-RELATIVE: the player strafes facing forward,
        // their own movement never rotates the view.
        if (mode === 'serve') {
          // forward gaze toward the service box; the toss gauge handles timing
          desiredLook.set(
            eyeX + (serveLookX - eyeX) * 0.2,
            1.0,
            -SERVICE_LINE + (CAMERA_BACK - EYE_BACK),
          );
        } else if (ball && ball.active) {
          // tiny ball-relative offset (<= ~6 deg) for awareness only
          desiredLook.set(
            eyeX + THREE.MathUtils.clamp((ball.pos.x - eyeX) * 0.25, -1.2, 1.2),
            0.9,
            eyeZ - 12,
          );
        } else {
          desiredLook.set(eyeX, 0.9, eyeZ - 12);
        }
      }
      // position follows tightly (lag here feels swimmy); gaze is softer
      const kPos = 1 - Math.pow(0.000001, dt);
      const kLook = 1 - Math.pow(0.0005, dt);
      pos.lerp(desiredPos, kPos);
      look.lerp(desiredLook, kLook);
      camera.position.copy(pos);
      camera.lookAt(look);
    },
    snap(mode) {
      this.update(10, mode); // big dt => effectively snap
    },
  };
}
