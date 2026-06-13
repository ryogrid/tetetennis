// Ball visuals: mesh, ground shadow blob (depth cue), landing ring decal.
import * as THREE from 'three';
import { makeBall } from '../physics/ball.js';

const VISUAL_R = 0.05; // slightly exaggerated for readability (physics uses 0.033)

// Procedural tennis-ball texture: yellow-green felt base with white seam lines.
// Drawn once on an off-screen canvas so we never load an image asset.
function createBallTexture() {
  const W = 256, H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Base felt colour with subtle noise for a fibrous look
  const img = ctx.createImageData(W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    // yellow-green base with small random variation
    const r = 200 + (Math.random() - 0.5) * 18;
    const g = 224 + (Math.random() - 0.5) * 18;
    const b = 48 + (Math.random() - 0.5) * 14;
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // Two white seam curves (equirectangular projection of a tennis ball)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';

  // Curve 1: sinusoidal sweep across u (x axis)
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    const uOff = pass * Math.PI;
    for (let py = 0; py <= H; py++) {
      const v = py / H; // 0 (top) → 1 (bottom)
      const u = 0.5 + uOff / (2 * Math.PI) + 0.18 * Math.sin(v * Math.PI * 2);
      const px = (u * W + W) % W;
      if (py === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // Blur the seams slightly for a soft edge
  ctx.filter = 'blur(0.6px)';
  ctx.globalAlpha = 0.3;
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    const uOff = pass * Math.PI;
    for (let py = 0; py <= H; py++) {
      const v = py / H;
      const u = 0.5 + uOff / (2 * Math.PI) + 0.18 * Math.sin(v * Math.PI * 2);
      const px = (u * W + W) % W;
      if (py === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapU = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let _ballTex = null;
function ballTexture() {
  if (!_ballTex) _ballTex = createBallTexture();
  return _ballTex;
}

export function createBallEntity(scene) {
  const state = makeBall();

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(VISUAL_R, 24, 18),
    new THREE.MeshStandardMaterial({
      map: ballTexture(),
      roughness: 0.88,
      metalness: 0,
      emissive: 0x1a1a00,
      emissiveIntensity: 0.3,
    }),
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
  // countdown ring: starts wide and shrinks onto the sweet ring as the ideal
  // contact instant approaches, so depth-over-time is read in-world
  const sweetCount = new THREE.Mesh(
    new THREE.RingGeometry(0.30, 0.35, 28),
    new THREE.MeshBasicMaterial({ color: 0x39d7ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  sweetCount.visible = false;
  sweet.add(sweetRing, sweetDot, sweetCount);
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
      // Spin-based rotation: the white seam lines tumble with the spin so
      // the player can read topspin (rolls forward), slice (spins back), etc.
      const s = state.spin;
      const mag = Math.hypot(s.x, s.y, s.z);
      if (mag > 0.1) {
        const vis = Math.min(mag * 0.5, 50); // cap for readability
        mesh.rotateOnWorldAxis(
          new THREE.Vector3(s.x, s.y, s.z).normalize(),
          vis * dt,
        );
      }
      blob.position.x = state.pos.x;
      blob.position.z = state.pos.z;
      // Always-readable shadow: stays visible at height (the old version faded
      // out exactly when the ball was hardest to read), darkening and tightening
      // as the ball nears the ground so the landing spot reads clearly.
      const h = Math.min(state.pos.y / 8, 1);
      blob.material.opacity = 0.30 + 0.25 * (1 - h);
      blob.scale.setScalar(1 + h * 0.9);
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
    hideSweetSpot() { sweet.visible = false; sweetCount.visible = false; },
    // frac in [0,1]: 1 = contact far off, 0 = contact now. good => snap green.
    setSweetCountdown(frac, good) {
      const f = Math.max(0, Math.min(1, frac));
      sweetCount.visible = true;
      sweetCount.scale.setScalar(1 + f * 1.6);
      sweetCount.material.color.setHex(good ? 0x50e678 : 0x39d7ff);
      sweetCount.material.opacity = 0.5 + 0.4 * (1 - f);
    },
    hideSweetCountdown() { sweetCount.visible = false; },
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
