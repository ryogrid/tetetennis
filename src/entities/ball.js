// Ball visuals: mesh, ground shadow blob (depth cue), landing ring decal.
import * as THREE from 'three';
import { makeBall } from '../physics/ball.js';

const VISUAL_R = 0.05; // slightly exaggerated for readability (physics uses 0.033)

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

  // "stand here" marker: where the player should be to make a clean contact
  const sweet = new THREE.Group();
  const sweetRing = new THREE.Mesh(
    new THREE.RingGeometry(0.30, 0.40, 28),
    new THREE.MeshBasicMaterial({ color: 0x39d7ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  const sweetDot = new THREE.Mesh(
    new THREE.CircleGeometry(0.09, 16),
    new THREE.MeshBasicMaterial({ color: 0x39d7ff, transparent: true, opacity: 0.4 }),
  );
  sweet.add(sweetRing, sweetDot);
  sweet.rotation.x = -Math.PI / 2;
  sweet.position.y = 0.012;
  sweet.visible = false;
  scene.add(sweet);

  let ringT = 0;

  return {
    state,
    mesh,
    sweetMarker: sweet,
    updateVisual(dt) {
      mesh.visible = state.active;
      blob.visible = state.active && state.pos.y < 12;
      mesh.position.set(state.pos.x, Math.max(state.pos.y, VISUAL_R), state.pos.z);
      blob.position.x = state.pos.x;
      blob.position.z = state.pos.z;
      const h = Math.min(state.pos.y / 6, 1);
      blob.material.opacity = 0.38 * (1 - h * 0.7);
      blob.scale.setScalar(1 + h * 1.4);
      ringT += dt;
      if (ring.visible) {
        ring.scale.setScalar(1 + 0.12 * Math.sin(ringT * 9));
      }
      if (sweet.visible) {
        sweet.scale.setScalar(1 + 0.07 * Math.sin(ringT * 5));
      }
    },
    showLanding(pos) {
      ring.visible = true;
      ring.position.x = pos.x;
      ring.position.z = pos.z;
    },
    hideLanding() { ring.visible = false; },
    showSweetSpot(pos) {
      sweet.visible = true;
      sweet.position.x = pos.x;
      sweet.position.z = pos.z;
    },
    hideSweetSpot() { sweet.visible = false; },
    dispose() {
      scene.remove(mesh, blob, ring, sweet);
    },
  };
}
