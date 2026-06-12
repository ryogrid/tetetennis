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
    new THREE.CircleGeometry(0.18, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }),
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

  // predicted-path trail: dots from just before the bounce through the
  // post-bounce arc (yellow = incoming, cyan = after the bounce)
  const TRAIL_CAP = 64;
  const trail = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.035, 8, 6),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8 }),
    TRAIL_CAP,
  );
  trail.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(TRAIL_CAP * 3), 3,
  );
  trail.count = 0;
  trail.visible = false;
  trail.frustumCulled = false;
  scene.add(trail);
  const _m = new THREE.Matrix4();
  const _cPre = new THREE.Color(0xffe34d);
  const _cPost = new THREE.Color(0x39d7ff);
  const _cIdeal = new THREE.Color(0xff8a3d); // ideal (waist-height) hit point

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
      const h = Math.min(state.pos.y / 8, 1);
      blob.material.opacity = 0.48 * (1 - h * 0.6);
      blob.scale.setScalar(1 + h * 1.2);
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
    // points: [{x, y, z, afterBounce}]; idealIdx (optional) marks the
    // waist-height point of the arc — drawn bigger and orange
    showTrail(points, idealIdx = -1) {
      const n = Math.min(points.length, TRAIL_CAP);
      for (let i = 0; i < n; i++) {
        const p = points[i];
        const s = i === idealIdx ? 2.2 : 1;
        _m.makeScale(s, s, s);
        _m.setPosition(p.x, Math.max(p.y, 0.04), p.z);
        trail.setMatrixAt(i, _m);
        trail.setColorAt(i, i === idealIdx ? _cIdeal : (p.afterBounce ? _cPost : _cPre));
      }
      trail.count = n;
      trail.instanceMatrix.needsUpdate = true;
      trail.instanceColor.needsUpdate = true;
      trail.visible = n > 0;
    },
    hideTrail() {
      trail.visible = false;
      trail.count = 0;
    },
    trailMarker: trail,
    dispose() {
      scene.remove(mesh, blob, ring, sweet, trail);
    },
  };
}
