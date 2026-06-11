// Chase camera behind the human player.
import * as THREE from 'three';

export function createCameraRig(camera) {
  const pos = new THREE.Vector3(0, 5.6, 18);
  const look = new THREE.Vector3(0, 1, -2);
  const desiredPos = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();

  return {
    update(dt, mode, player, ball) {
      if (mode === 'serve') {
        desiredPos.set(player.pos.x + 1.1, 3.2, player.pos.z + 4.2);
        desiredLook.set(player.pos.x * 0.4, 0.4, 2.0);
      } else {
        desiredPos.set(
          THREE.MathUtils.clamp(player.pos.x * 0.45, -3.0, 3.0),
          6.8,
          Math.max(player.pos.z, 11.0) + 7.5,
        );
        desiredLook.set(ball ? ball.pos.x * 0.30 : 0, 0.2, 3.0);
      }
      const k = 1 - Math.pow(0.001, dt);
      pos.lerp(desiredPos, k);
      look.lerp(desiredLook, k);
      camera.position.copy(pos);
      camera.lookAt(look);
    },
    snap(mode, player, ball) {
      this.update(10, mode, player, ball); // big dt => effectively snap
    },
  };
}
