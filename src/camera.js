// First-person camera: the on-court player's eyes, looking at the opponent
// court. Serve mode keeps facing the target box (no toss tracking); the toss
// is shown on a HUD gauge instead.
import * as THREE from 'three';
import { COURT } from './physics/constants.js';

const EYE_H = 1.62;
const EYE_BACK = 0.15; // eyes slightly behind the body position

export function createCameraRig(camera) {
  const pos = new THREE.Vector3(0, EYE_H, 12.5);
  const look = new THREE.Vector3(0, 0.9, -6);
  const desiredPos = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  let serveLookX = 0;

  return {
    // x of the target service box center; set when players are placed
    setServeLookX(x) { serveLookX = x; },
    update(dt, mode, player, ball) {
      const eyeX = player.pos.x;
      const eyeZ = player.pos.z + EYE_BACK;
      desiredPos.set(eyeX, EYE_H, eyeZ);
      if (mode === 'serve') {
        // fixed forward gaze at the service box; the toss gauge handles timing
        desiredLook.set(serveLookX * 0.5, 1.0, -COURT.serviceLine);
      } else if (ball && ball.active) {
        // track the ball, but never look behind the eyes or pitch too far
        desiredLook.set(
          THREE.MathUtils.clamp(ball.pos.x, eyeX - 6, eyeX + 6),
          THREE.MathUtils.clamp(ball.pos.y, 0.3, 2.6),
          Math.min(ball.pos.z, eyeZ - 3.0),
        );
      } else {
        desiredLook.set(0, 0.9, -COURT.halfLen * 0.5);
      }
      // position follows tightly (lag here feels swimmy); gaze is softer
      const kPos = 1 - Math.pow(0.000001, dt);
      const kLook = 1 - Math.pow(0.0005, dt);
      pos.lerp(desiredPos, kPos);
      look.lerp(desiredLook, kLook);
      camera.position.copy(pos);
      camera.lookAt(look);
    },
    snap(mode, player, ball) {
      this.update(10, mode, player, ball); // big dt => effectively snap
    },
  };
}
