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

// Soft radial-alpha disc, reused for the bounce dust particles.
let _discTex = null;
function discTexture() {
  if (_discTex) return _discTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 32, 32);
  _discTex = new THREE.CanvasTexture(c);
  return _discTex;
}

export function createBallEntity(scene) {
  // latest state pushed by setBall(); the camera reads .active/.pos
  const state = {
    active: false,
    pos: { x: 0, y: 0, z: 0 },
    spin: { x: 0, y: 0, z: 0 },
  };

  // past-position ring buffer for motion trail (last ~1.5 m of flight)
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

  // past-position motion trail: fading spheres behind the ball (~1.5 m)
  const PAST_CAP = 64;
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

  // --- bounce VFX: dust puff + skid marks (immersion 05 §5.3) ---
  const DUST_CAP = 24;
  const dust = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: discTexture(), transparent: true, opacity: 0.55,
      depthWrite: false, color: 0xc8895a,
    }),
    DUST_CAP,
  );
  dust.count = 0;
  dust.visible = false;
  dust.frustumCulled = false;
  scene.add(dust);
  const dustP = []; // active particles {x,y,z,vx,vy,vz,life,max,sz}
  const _mDust = new THREE.Matrix4();
  const _qId = new THREE.Quaternion();
  const _sDust = new THREE.Vector3();
  const _pDust = new THREE.Vector3();

  // skid marks: a ring buffer of flat ground decals that fade out (clay/grass)
  const MARK_CAP = 14;
  const marks = [];
  for (let i = 0; i < MARK_CAP; i++) {
    const mk = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.2),
      new THREE.MeshBasicMaterial({ color: 0x7a3b1e, transparent: true, opacity: 0, depthWrite: false }),
    );
    mk.rotation.x = -Math.PI / 2;
    mk.position.y = 0.013;
    mk.visible = false;
    scene.add(mk);
    marks.push({ mesh: mk, life: 0, max: 1, op0: 0 });
  }
  let markHead = 0;

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
        if (hist.length > 32) hist.shift();
      } else {
        hist.length = 0;
      }
    },
    // Spawn a bounce puff (+ a fading skid mark on gritty surfaces) at the
    // bounce point, scaled by impact speed. Driven from the logic layer via
    // host_bounce_fx → render.bounceFx. (immersion 05 §5.3)
    bounceFx(x, z, speed, surface) {
      const fast = Math.min(speed / 25, 1);
      const tint = surface === 'clay' ? 0xc8895a
        : surface === 'grass' ? 0x9fc77a : 0xc9c9c9;
      dust.material.color.setHex(tint);
      dust.material.opacity = surface === 'clay' ? 0.6 : 0.32;
      const k = surface === 'clay'
        ? 6 + ((fast * 10) | 0)
        : 2 + ((fast * 4) | 0);
      for (let i = 0; i < k; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = (0.35 + Math.random() * 1.1) * (0.6 + fast);
        dustP.push({
          x, y: 0.03, z,
          vx: Math.cos(ang) * sp,
          vy: 0.5 + Math.random() * 1.3 * (0.5 + fast),
          vz: Math.sin(ang) * sp,
          life: 0, max: 0.35 + Math.random() * 0.35,
          sz: 0.10 + Math.random() * 0.14,
        });
      }
      if (dustP.length > DUST_CAP) dustP.splice(0, dustP.length - DUST_CAP);
      // gritty surfaces leave a visible skid streak
      if ((surface === 'clay' || surface === 'grass') && speed > 4) {
        const mk = marks[markHead];
        markHead = (markHead + 1) % MARK_CAP;
        mk.mesh.visible = true;
        mk.mesh.position.set(x, 0.013, z);
        mk.mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI);
        mk.mesh.scale.set(0.6 + fast * 0.9, 1, 1);
        mk.op0 = surface === 'clay' ? 0.5 : 0.22;
        mk.max = mk.life = surface === 'clay' ? 12 : 6;
        mk.mesh.material.color.setHex(surface === 'clay' ? 0x7a3b1e : 0x3a5a28);
        mk.mesh.material.opacity = mk.op0;
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
        for (let i = hist.length - 1; i >= 0 && dist < 1.50 && pts.length < PAST_CAP; i--) {
          const h = hist[i];
          const dx = px - h.x, dy = py - h.y, dz = pz - h.z;
          const seg = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (seg < 0.001) continue;
          const rem = 1.50 - dist;
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
            // partial step to hit exactly 1.5 m
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
            dist = 1.50;
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

      // --- bounce dust: integrate + compact the active particles ---
      if (dustP.length) {
        let w = 0;
        for (let i = 0; i < dustP.length; i++) {
          const p = dustP[i];
          p.life += dt;
          if (p.life >= p.max) continue; // expired → drop
          p.vy -= 2.2 * dt;              // light gravity
          p.vx *= 1 - 1.5 * dt;
          p.vz *= 1 - 1.5 * dt;
          p.x += p.vx * dt;
          p.y = Math.max(0.02, p.y + p.vy * dt);
          p.z += p.vz * dt;
          dustP[w++] = p;
        }
        dustP.length = w;
        const cnt = Math.min(w, DUST_CAP);
        for (let i = 0; i < cnt; i++) {
          const p = dustP[i];
          const fr = p.life / p.max;
          const fade = fr > 0.6 ? 1 - (fr - 0.6) / 0.4 : 1; // shrink out near end
          const sc = p.sz * (0.5 + fr * 1.6) * fade;
          _pDust.set(p.x, p.y, p.z);
          _sDust.set(sc, sc, sc);
          _mDust.compose(_pDust, _qId, _sDust);
          dust.setMatrixAt(i, _mDust);
        }
        dust.count = cnt;
        dust.instanceMatrix.needsUpdate = true;
        dust.visible = cnt > 0;
      } else if (dust.visible) {
        dust.visible = false;
        dust.count = 0;
      }

      // --- skid marks: fade out over their lifetime ---
      for (const mk of marks) {
        if (!mk.mesh.visible) continue;
        mk.life -= dt;
        if (mk.life <= 0) { mk.mesh.visible = false; continue; }
        mk.mesh.material.opacity = mk.op0 * (mk.life / mk.max);
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
      scene.remove(mesh, blob, ring, sweet, trail, pastTrail, dust);
      dust.geometry.dispose();
      if (dust.material.map) dust.material.map.dispose();
      dust.material.dispose();
      for (const mk of marks) {
        scene.remove(mk.mesh);
        mk.mesh.geometry.dispose();
        mk.mesh.material.dispose();
      }
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
