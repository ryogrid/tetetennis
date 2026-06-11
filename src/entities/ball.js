// Ball visuals: mesh, ground shadow blob (depth cue), landing ring decal.
import * as THREE from 'three';
import { makeBall } from '../physics/ball.js';

const VISUAL_R = 0.075; // exaggerated for readability (physics uses 0.033)

export function createBallEntity(scene) {
  const state = makeBall();

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(VISUAL_R, 16, 12),
    new THREE.MeshLambertMaterial({ color: 0xd8f24b, emissive: 0x5a6b10 }),
  );
  mesh.castShadow = true;
  scene.add(mesh);

  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.13, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.011;
  scene.add(blob);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.14, 0.22, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe34d, transparent: true, opacity: 0.65, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.013;
  ring.visible = false;
  scene.add(ring);

  let ringT = 0;

  return {
    state,
    mesh,
    updateVisual(dt) {
      mesh.visible = state.active;
      blob.visible = state.active && state.pos.y < 12;
      mesh.position.set(state.pos.x, Math.max(state.pos.y, VISUAL_R), state.pos.z);
      blob.position.x = state.pos.x;
      blob.position.z = state.pos.z;
      const h = Math.min(state.pos.y / 6, 1);
      blob.material.opacity = 0.38 * (1 - h * 0.7);
      blob.scale.setScalar(1 + h * 1.4);
      if (ring.visible) {
        ringT += dt;
        const s = 1 + 0.12 * Math.sin(ringT * 9);
        ring.scale.setScalar(s);
      }
    },
    showLanding(pos) {
      ring.visible = true;
      ring.position.x = pos.x;
      ring.position.z = pos.z;
    },
    hideLanding() { ring.visible = false; },
    dispose() {
      scene.remove(mesh, blob, ring);
    },
  };
}
