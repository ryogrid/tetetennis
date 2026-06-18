// Ball visuals: mesh, ground shadow blob (depth cue), landing ring decal,
// "stand here" sweet-spot marker + countdown ring, predicted-path trail,
// and past-position motion trail. Adapted from old/src/entities/ball.js.
//
// The physics state object is gone: the MoonBit logic drives the visuals via
// explicit args. setBall(active, px,py,pz, sx,sy,sz) positions the mesh/shadow
// and stores the spin for the per-frame tumble; tick(dt) advances the spin
// rotation and the ring/sweet pulse (formerly the tail of updateVisual()).
import * as THREE from 'three';

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
  // latest state pushed by setBall(); the camera reads .active/.pos
  const state = {
    active: false,
    pos: { x: 0, y: 0, z: 0 },
    spin: { x: 0, y: 0, z: 0 },
  };

  // past-position ring buffer for motion trail (last ~50 cm of flight)
  const hist = [];

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

  // past-position motion trail: fading spheres behind the ball (~50 cm)
  const PAST_CAP = 32;
  const pastTrail = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.035, 8, 6),
    new THREE.MeshBasicMaterial({
      color: 0xc8e030,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
    PAST_CAP,
  );
  pastTrail.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(PAST_CAP * 3), 3,
  );
  pastTrail.count = 0;
  pastTrail.visible = false;
  pastTrail.frustumCulled = false;
  scene.add(pastTrail);
  const _mPast = new THREE.Matrix4();
  const _cBall = new THREE.Color(0xc8e030);
  const _cDark = new THREE.Color(0x141605);
  const _cTmp = new THREE.Color();

  // "stand here" marker: a large, bright circle on the court showing where the
  // player should stand to make a clean contact (only the player's current side
  // of the ideal hit point is shown — driven from the logic layer).
  const SWEET_COL = 0x6dff5a; // bright green, distinct from the orange hit point
  const sweet = new THREE.Group();
  const sweetRing = new THREE.Mesh(
    new THREE.RingGeometry(0.52, 0.70, 36),
    new THREE.MeshBasicMaterial({ color: SWEET_COL, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
  );
  const sweetDot = new THREE.Mesh(
    new THREE.CircleGeometry(0.16, 24),
    new THREE.MeshBasicMaterial({ color: SWEET_COL, transparent: true, opacity: 0.5 }),
  );
  // countdown ring: starts wide and shrinks onto the sweet ring as the ideal
  // contact instant approaches, so depth-over-time is read in-world
  const sweetCount = new THREE.Mesh(
    new THREE.RingGeometry(0.52, 0.62, 36),
    new THREE.MeshBasicMaterial({ color: SWEET_COL, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  sweetCount.visible = false;
  sweet.add(sweetRing, sweetDot, sweetCount);
  sweet.rotation.x = -Math.PI / 2;
  sweet.position.y = 0.012;
  sweet.visible = false;
  scene.add(sweet);

  const _spinAxis = new THREE.Vector3();
  let ringT = 0;

  return {
    state,
    mesh,
    // active + position + spin (rad/s) of the ball this frame.
    setBall(active, px, py, pz, sx, sy, sz) {
      state.active = active;
      state.pos.x = px; state.pos.y = py; state.pos.z = pz;
      state.spin.x = sx; state.spin.y = sy; state.spin.z = sz;
      mesh.visible = active;
      blob.visible = active && py < 12;
      mesh.position.set(px, Math.max(py, VISUAL_R), pz);
      blob.position.x = px;
      blob.position.z = pz;
      // Always-readable shadow: darkens and tightens as the ball nears the
      // ground so the landing spot reads clearly.
      const h = Math.min(py / 8, 1);
      blob.material.opacity = 0.30 + 0.25 * (1 - h);
      blob.scale.setScalar(1 + h * 0.9);
      // motion trail: record visual position
      if (active) {
        hist.push({ x: px, y: Math.max(py, VISUAL_R), z: pz });
        if (hist.length > 16) hist.shift();
      } else {
        hist.length = 0;
      }
    },
    // per-frame cosmetic advance: spin tumble + ring/sweet pulse
    tick(dt) {
      // Spin-based rotation: the white seam lines tumble with the spin so
      // the player can read topspin (rolls forward), slice (spins back), etc.
      const s = state.spin;
      const mag = Math.hypot(s.x, s.y, s.z);
      if (state.active && mag > 0.1) {
        const vis = Math.min(mag * 0.5, 50); // cap for readability
        _spinAxis.set(s.x, s.y, s.z).normalize();
        mesh.rotateOnWorldAxis(_spinAxis, vis * dt);
      }
      ringT += dt;
      if (ring.visible) {
        ring.scale.setScalar(1 + 0.12 * Math.sin(ringT * 9));
      }
      if (sweet.visible) {
        sweet.scale.setScalar(1 + 0.07 * Math.sin(ringT * 5));
      }
      // --- past-position motion trail ---
      if (state.active && hist.length >= 1) {
        const pts = [];
        let dist = 0;
        const cy = Math.max(state.pos.y, VISUAL_R);
        pts.push({ x: state.pos.x, y: cy, z: state.pos.z });

        let px = state.pos.x, py = cy, pz = state.pos.z;
        for (let i = hist.length - 1; i >= 0 && dist < 0.50 && pts.length < PAST_CAP; i--) {
          const h = hist[i];
          const dx = px - h.x, dy = py - h.y, dz = pz - h.z;
          const seg = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (seg < 0.001) continue;
          const rem = 0.50 - dist;
          if (seg <= rem) {
            if (seg > 0.04) {
              // interpolate intermediate points for smoothness
              const steps = Math.min(Math.ceil(seg / 0.025), PAST_CAP - pts.length);
              for (let s = 1; s <= steps && pts.length < PAST_CAP; s++) {
                const t = s / (steps + 1);
                pts.push({ x: px - dx * t, y: py - dy * t, z: pz - dz * t });
              }
            }
            pts.push({ x: h.x, y: h.y, z: h.z });
            dist += seg;
          } else {
            // partial step to hit exactly 50 cm
            const t = rem / seg;
            if (rem > 0.04) {
              const substeps = Math.min(Math.ceil(rem / 0.025), PAST_CAP - pts.length);
              for (let s = 1; s <= substeps && pts.length < PAST_CAP; s++) {
                const tt = (t * s) / substeps;
                pts.push({ x: px - dx * tt, y: py - dy * tt, z: pz - dz * tt });
              }
            } else {
              pts.push({ x: px - dx * t, y: py - dy * t, z: pz - dz * t });
            }
            dist = 0.50;
          }
          px = h.x; py = h.y; pz = h.z;
        }

        const n = Math.min(pts.length, PAST_CAP);
        for (let i = 0; i < n; i++) {
          const frac = n > 1 ? i / (n - 1) : 0; // 0 = newest, 1 = oldest
          const sc = 0.90 - frac * 0.78; // newest ~0.90, oldest ~0.12
          _mPast.makeScale(sc, sc, sc);
          _mPast.setPosition(pts[i].x, pts[i].y, pts[i].z);
          pastTrail.setMatrixAt(i, _mPast);
          _cTmp.lerpColors(_cBall, _cDark, frac);
          pastTrail.setColorAt(i, _cTmp);
        }
        pastTrail.count = n;
        pastTrail.instanceMatrix.needsUpdate = true;
        pastTrail.instanceColor.needsUpdate = true;
        pastTrail.visible = n > 0;
      } else if (!state.active) {
        pastTrail.visible = false;
        pastTrail.count = 0;
        hist.length = 0;
      }
    },
    showLanding(x, z) {
      ring.visible = true;
      ring.position.x = x;
      ring.position.z = z;
    },
    hideLanding() { ring.visible = false; },
    // show/position the sweet marker and drive the countdown ring.
    setSweet(show, x, y, z, cdShow, cdFrac, cdGood) {
      sweet.visible = show;
      if (show) {
        sweet.position.x = x;
        sweet.position.z = z;
      }
      if (show && cdShow) {
        const f = Math.max(0, Math.min(1, cdFrac));
        sweetCount.visible = true;
        sweetCount.scale.setScalar(1 + f * 1.6);
        sweetCount.material.color.setHex(cdGood ? 0xb6ff4a : SWEET_COL);
        sweetCount.material.opacity = 0.5 + 0.4 * (1 - f);
      } else {
        sweetCount.visible = false;
      }
    },
    // arr: flat [x,y,z,afterBounce, ...]; idealIdx (optional) marks the
    // waist-height point of the arc — drawn bigger and orange
    showTrail(arr, idealIdx = -1) {
      const n = Math.min((arr.length / 4) | 0, TRAIL_CAP);
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        const x = arr[o], y = arr[o + 1], z = arr[o + 2];
        const afterBounce = arr[o + 3];
        const sc = i === idealIdx ? 2.2 : 1;
        _m.makeScale(sc, sc, sc);
        _m.setPosition(x, Math.max(y, 0.04), z);
        trail.setMatrixAt(i, _m);
        trail.setColorAt(i, i === idealIdx ? _cIdeal : (afterBounce ? _cPost : _cPre));
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
    dispose() {
      scene.remove(mesh, blob, ring, sweet, trail, pastTrail);
      mesh.geometry.dispose();
      mesh.material.dispose();
      blob.geometry.dispose();
      blob.material.dispose();
      ring.geometry.dispose();
      ring.material.dispose();
      trail.geometry.dispose();
      trail.material.dispose();
      pastTrail.geometry.dispose();
      pastTrail.material.dispose();
      sweetRing.geometry.dispose();
      sweetRing.material.dispose();
      sweetDot.geometry.dispose();
      sweetDot.material.dispose();
      sweetCount.geometry.dispose();
      sweetCount.material.dispose();
    },
  };
}
