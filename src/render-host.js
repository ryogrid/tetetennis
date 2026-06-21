// host.render: owns the Three.js scene contents (court, two player rigs, ball
// + markers) and implements the render contract the MoonBit logic drives.
// Also stores the latest per-side player pos/vel and the ball pos/active so the
// camera rig can read them (createCameraRig(camera, renderHost)).
import * as THREE from 'three';
import { buildCourt } from './court.js';
import { createBallEntity } from './entities/ball.js';
import { createPlayerRig } from './entities/player.js';
import { CHARACTERS, reachRadius } from './characters.js';

const SURFACE_IDS = ['clay', 'grass', 'hard'];
const REACH_IDLE = 0x3988ff; // blue
const REACH_HOT = 0xff50a0;  // pink (ball in range)

export function createRenderHost(scene, audio = null) {
  let court = null;
  let ball = null;
  const players = [null, null]; // [human(side 0), cpu(side 1)]
  let surfaceId = 'hard';

  // footstep/slide SFX bookkeeping per side (immersion 03 §3.4)
  const stepAcc = [0, 0];
  const lastPos = [null, null];
  const lastSpeed = [0, 0];
  const slideCd = [0, 0];

  // open-court highlight: a translucent patch on the CPU's vacated side
  const openCourt = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 4.2),
    new THREE.MeshBasicMaterial({
      color: 0x50e678, transparent: true, opacity: 0.16, depthWrite: false,
    }),
  );
  openCourt.rotation.x = -Math.PI / 2;
  openCourt.position.y = 0.02;
  openCourt.visible = false;
  scene.add(openCourt);

  function startMatch(sid, pIdx, cIdx) {
    teardownMatch();
    surfaceId = SURFACE_IDS.includes(sid) ? sid : 'hard';
    court = buildCourt(surfaceId);
    scene.add(court);

    const pChar = CHARACTERS[pIdx] || CHARACTERS[0];
    const cChar = CHARACTERS[cIdx] || CHARACTERS[0];
    players[0] = createPlayerRig({
      side: 0, color: pChar.color, reach: reachRadius(pChar.stats.REA), scene,
    });
    players[1] = createPlayerRig({
      side: 1, color: cChar.color, reach: 0, scene,
    });
    ball = createBallEntity(scene);
  }

  function teardownMatch() {
    openCourt.visible = false;
    if (court) {
      scene.remove(court);
      // dispose court geometry/materials/textures (incl. the crowd) so a
      // rematch's buildCourt() doesn't leak GPU resources.
      court.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          for (const mtl of Array.isArray(o.material) ? o.material : [o.material]) {
            if (mtl.map) mtl.map.dispose();
            mtl.dispose();
          }
        }
      });
      court = null;
    }
    for (let i = 0; i < players.length; i++) {
      if (players[i]) { players[i].dispose(); players[i] = null; }
    }
    if (ball) { ball.dispose(); ball = null; }
  }

  return {
    startMatch,
    teardownMatch,

    setBall(active, px, py, pz, sx, sy, sz) {
      if (ball) ball.setBall(active, px, py, pz, sx, sy, sz);
    },
    showLanding(x, z) { if (ball) ball.showLanding(x, z); },
    hideLanding() { if (ball) ball.hideLanding(); },
    setSweet(show, x, y, z, cdShow, cdFrac, cdGood) {
      if (ball) ball.setSweet(show, x, y, z, cdShow, cdFrac, cdGood);
    },
    showTrail(arr, idealIdx) { if (ball) ball.showTrail(arr, idealIdx); },
    hideTrail() { if (ball) ball.hideTrail(); },
    bounceFx(x, z, speed, surface) { if (ball) ball.bounceFx(x, z, speed, surface); },

    setPlayer(side, x, z, vx, vz) {
      const p = players[side];
      if (p) p.setPlayer(x, z, vx, vz);
    },
    startSwing(side, type, fh, motion) {
      const p = players[side];
      if (p) p.startSwing(type, fh, motion);
    },
    serveAnim(side, on) {
      const p = players[side];
      if (p) p.serveAnim(on);
    },
    setReachColor(inReach) {
      if (players[0]) players[0].setReachZoneColor(inReach ? REACH_HOT : REACH_IDLE);
    },
    // dim the human rig to translucent (behind-player camera) so the ball stays
    // visible through it; opaque again in overhead view.
    setHumanTransparent(on) {
      if (players[0]) players[0].setTransparent(on);
    },
    setOpenCourt(show, x, z) {
      openCourt.visible = !!show;
      if (show) { openCourt.position.x = x; openCourt.position.z = z; }
    },

    // advance every rig's cosmetic pose/stride + the ball spin/pulse. main.js
    // calls this once per render frame, right before renderer.render.
    tick(dt) {
      if (players[0]) players[0].tick(dt);
      if (players[1]) players[1].tick(dt);
      if (ball) ball.tick(dt);
      // footstep / clay-slide SFX, derived from each rig's motion (no FFI)
      if (audio) {
        for (let side = 0; side < 2; side++) {
          const p = players[side];
          if (!p) { lastPos[side] = null; continue; }
          const sp = Math.hypot(p.vel.x, p.vel.z);
          const pan = Math.max(-1, Math.min(1, p.pos.x / 6));
          const lp = lastPos[side];
          if (lp) {
            stepAcc[side] += Math.hypot(p.pos.x - lp.x, p.pos.z - lp.z);
            if (stepAcc[side] >= 0.85 && sp > 1.2) {
              audio.sfxFootstep && audio.sfxFootstep(sp, surfaceId, pan);
              stepAcc[side] -= 0.85;
            }
            const decel = dt > 0 ? (lastSpeed[side] - sp) / dt : 0;
            slideCd[side] -= dt;
            if (surfaceId === 'clay' && sp > 3 && decel > 6 && slideCd[side] <= 0) {
              audio.sfxSlide && audio.sfxSlide(Math.max(sp, lastSpeed[side]), pan);
              slideCd[side] = 0.45;
            }
          }
          lastPos[side] = { x: p.pos.x, z: p.pos.z };
          lastSpeed[side] = sp;
        }
      }
    },

    // --- read access for the camera rig ---
    getPlayer(side) {
      return players[side] || { pos: { x: 0, z: side === 0 ? 12.5 : -12.5 } };
    },
    getBall() {
      return ball ? ball.state : { active: false, pos: { x: 0, y: 0, z: 0 } };
    },
    isActive() { return ball !== null; },
  };
}
