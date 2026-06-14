// Court, net, stands, lighting. buildCourt(surfaceId) returns a THREE.Group.
import * as THREE from 'three';
import { COURT, NET } from './physics/constants.js';

export const SURFACE_THEMES = {
  clay:  { court: 0xb1551e, apron: 0x8f4318, line: 0xf5f0e6, label: 'Clay' },
  grass: { court: 0x2e8b3d, apron: 0x246b30, line: 0xffffff, label: 'Grass' },
  hard:  { court: 0x2966a3, apron: 0x1b4f72, line: 0xffffff, label: 'Hard' },
};

function lineStrip(x1, z1, x2, z2, color, width = 0.06) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const geo = new THREE.PlaneGeometry(
    Math.abs(x2 - x1) > Math.abs(z2 - z1) ? len : width,
    Math.abs(x2 - x1) > Math.abs(z2 - z1) ? width : len,
  );
  const mat = new THREE.MeshLambertMaterial({ color });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set((x1 + x2) / 2, 0.012, (z1 + z2) / 2);
  m.receiveShadow = true;
  return m;
}

// Faint, unlit cross-court reference line (depth ladder). Sits just under the
// real court lines so those still render on top.
function faintLine(x1, z1, x2, z2, color, opacity = 0.13, width = 0.05) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const geo = new THREE.PlaneGeometry(
    Math.abs(x2 - x1) > Math.abs(z2 - z1) ? len : width,
    Math.abs(x2 - x1) > Math.abs(z2 - z1) ? width : len,
  );
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set((x1 + x2) / 2, 0.009, (z1 + z2) / 2);
  return m;
}

export function buildCourt(surfaceId) {
  const theme = SURFACE_THEMES[surfaceId];
  const g = new THREE.Group();

  // apron / outer ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 64),
    new THREE.MeshLambertMaterial({ color: theme.apron }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  g.add(ground);

  // court proper (doubles footprint for looks)
  const court = new THREE.Mesh(
    new THREE.PlaneGeometry(COURT.doublesHalfWidth * 2 + 0.4, COURT.halfLen * 2 + 0.4),
    new THREE.MeshLambertMaterial({ color: theme.court }),
  );
  court.rotation.x = -Math.PI / 2;
  court.position.y = 0.005;
  court.receiveShadow = true;
  g.add(court);

  const W = COURT.halfWidth, DW = COURT.doublesHalfWidth;
  const L = COURT.halfLen, S = COURT.serviceLine;
  const lc = theme.line;
  // baselines
  g.add(lineStrip(-DW, L, DW, L, lc, 0.1));
  g.add(lineStrip(-DW, -L, DW, -L, lc, 0.1));
  // sidelines (singles + doubles)
  g.add(lineStrip(-W, -L, -W, L, lc));
  g.add(lineStrip(W, -L, W, L, lc));
  g.add(lineStrip(-DW, -L, -DW, L, lc));
  g.add(lineStrip(DW, -L, DW, L, lc));
  // service lines
  g.add(lineStrip(-W, S, W, S, lc));
  g.add(lineStrip(-W, -S, W, -S, lc));
  // center service line
  g.add(lineStrip(0, -S, 0, S, lc));
  // center marks
  g.add(lineStrip(0, L - 0.2, 0, L, lc));
  g.add(lineStrip(0, -L, 0, -L + 0.2, lc));
  // depth ladder: faint cross-court reference lines on the human (+z) half so
  // the fixed camera has perspective references for judging ball distance
  for (const f of [0.3, 0.55, 0.8]) {
    g.add(faintLine(-W, L * f, W, L * f, lc));
  }

  // net
  const netMesh = new THREE.Mesh(
    new THREE.BoxGeometry(COURT.netPostX * 2, NET.hCenter, 0.02),
    new THREE.MeshLambertMaterial({ color: 0x111418, transparent: true, opacity: 0.55 }),
  );
  netMesh.position.set(0, NET.hCenter / 2, 0);
  g.add(netMesh);
  const tape = new THREE.Mesh(
    new THREE.BoxGeometry(COURT.netPostX * 2, 0.06, 0.03),
    new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }),
  );
  tape.position.set(0, NET.hCenter - 0.03, 0);
  g.add(tape);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, NET.hPost, 8),
      new THREE.MeshLambertMaterial({ color: 0x222222 }),
    );
    post.position.set(sx * COURT.netPostX, NET.hPost / 2, 0);
    post.castShadow = true;
    g.add(post);
  }

  // stands: stepped dark boxes around the court
  const standMat = new THREE.MeshLambertMaterial({ color: 0x1a1a24 });
  const standMat2 = new THREE.MeshLambertMaterial({ color: 0x232330 });
  for (const sx of [-1, 1]) {
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(4, 2.2, 36), standMat);
    s1.position.set(sx * 12, 1.1, 0);
    g.add(s1);
    const s2 = new THREE.Mesh(new THREE.BoxGeometry(4, 4.4, 36), standMat2);
    s2.position.set(sx * 16, 2.2, 0);
    g.add(s2);
  }
  const sFar = new THREE.Mesh(new THREE.BoxGeometry(20, 3.2, 4), standMat2);
  sFar.position.set(0, 1.6, -21);
  g.add(sFar);

  return g;
}

export function buildLights(scene) {
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(12, 22, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -16;
  sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -20;
  sun.shadow.camera.far = 60;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  scene.background = new THREE.Color(0x0d0d14);
  scene.fog = new THREE.Fog(0x0d0d14, 45, 120);
}
