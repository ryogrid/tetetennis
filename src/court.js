// Court, net, stands, lighting. buildCourt(surfaceId) returns a THREE.Group.
// Adapted from old/src/court.js; the court geometry constants (formerly in
// physics/constants.js, now owned by the MoonBit logic layer) are inlined here
// since they only drive visuals.
import * as THREE from 'three';

// Court geometry (visual). Mirrors the MoonBit COURT/NET constants.
const COURT = {
  halfLen: 11.885,    // baseline z
  halfWidth: 4.115,   // singles sideline x
  doublesHalfWidth: 5.485,
  serviceLine: 6.40,  // |z| of service lines
  netPostX: 5.029,    // singles sticks
};
const NET = {
  hCenter: 0.914,
  hPost: 1.07,
};

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

// Procedural spectator sprite: a head + shoulders silhouette on a transparent
// canvas, light-toned so the per-instance tint (shirt colour) shows through.
function makeSpectatorTexture() {
  const c = document.createElement('canvas');
  c.width = 48;
  c.height = 64;
  const x = c.getContext('2d');
  // shoulders / torso
  x.fillStyle = '#d8d8d8';
  x.beginPath();
  x.moveTo(8, 64);
  x.quadraticCurveTo(8, 34, 24, 32);
  x.quadraticCurveTo(40, 34, 40, 64);
  x.closePath();
  x.fill();
  // head
  x.fillStyle = '#caa07a';
  x.beginPath();
  x.arc(24, 20, 11, 0, Math.PI * 2);
  x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A stadium crowd built as ONE InstancedMesh of billboard sprites (cheap, one
// draw call). Seats are banked up the two side stands and the far stand, each
// facing inward toward the court; per-instance colour + jitter give it life.
// Static (no per-frame matrix churn) to stay mobile-friendly. (immersion 05 §5.1)
function buildCrowd(group, density = 1) {
  const tex = makeSpectatorTexture();
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide,
    depthWrite: true,
  });
  const geo = new THREE.PlaneGeometry(0.5, 0.7);

  const shirts = [
    0xb23b3b, 0x3b6bb2, 0x3bb26a, 0xc9a33b, 0x8a4fb2, 0xb2683b,
    0xcfcfcf, 0x4a4a55, 0xd95f8c, 0x2f9c9c,
  ];
  const seats = [];
  const colStep = 0.62 / density;
  // two side banks
  for (const sx of [-1, 1]) {
    for (let row = 0; row < 6; row++) {
      const bx = sx * (10.4 + row * 0.85);
      const by = 1.55 + row * 0.78;
      const rotY = -sx * Math.PI / 2; // face the court centre (−x for right bank)
      for (let z = -16.5; z <= 16.5; z += colStep) {
        if (Math.random() < 0.18) continue; // empty seats
        seats.push([bx + (Math.random() - 0.5) * 0.2, by + Math.random() * 0.12,
          z + (Math.random() - 0.5) * 0.2, rotY]);
      }
    }
  }
  // far bank (behind the baseline), facing +z toward the court
  for (let row = 0; row < 6; row++) {
    const bz = -19.5 - row * 0.8;
    const by = 1.55 + row * 0.78;
    for (let x = -9.5; x <= 9.5; x += colStep) {
      if (Math.random() < 0.18) continue;
      seats.push([x + (Math.random() - 0.5) * 0.2, by + Math.random() * 0.12,
        bz + (Math.random() - 0.5) * 0.2, 0]);
    }
  }

  const mesh = new THREE.InstancedMesh(geo, mat, seats.length);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(seats.length * 3), 3);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const col = new THREE.Color();
  for (let i = 0; i < seats.length; i++) {
    const [px, py, pz, rotY] = seats[i];
    const sc = 0.85 + Math.random() * 0.5;
    e.set(0, rotY, 0);
    q.setFromEuler(e);
    pos.set(px, py, pz);
    s.set(sc, sc, sc);
    m.compose(pos, q, s);
    mesh.setMatrixAt(i, m);
    col.setHex(shirts[(Math.random() * shirts.length) | 0]);
    col.multiplyScalar(0.65 + Math.random() * 0.5); // brightness variety
    mesh.setColorAt(i, col);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  return mesh;
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

  // populate the stands with a procedural crowd
  buildCrowd(g);

  return g;
}

// Lighting / atmosphere presets. `day` keeps the original look exactly; `dusk`
// and `night` (floodlit) are selectable moods. (immersion 05 §5.6)
export const LIGHT_MOODS = {
  day: {
    sun: 0xffffff, sunI: 1.1, sunPos: [12, 22, 8],
    amb: 0xffffff, ambI: 0.55, bg: 0x0d0d14, fog: 0x0d0d14,
  },
  dusk: {
    sun: 0xffc89a, sunI: 0.85, sunPos: [16, 14, 6],
    amb: 0xffd0b0, ambI: 0.42, bg: 0x1b1018, fog: 0x241420,
  },
  night: {
    // cool, bright floodlight from high up + low cool ambient → stadium-at-night
    sun: 0xdfe8ff, sunI: 1.35, sunPos: [10, 28, 10],
    amb: 0x9fb0d8, ambI: 0.38, bg: 0x05060d, fog: 0x070912,
  },
};

export function buildLights(scene, mood = 'day') {
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -16;
  sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -20;
  sun.shadow.camera.far = 60;
  scene.add(sun);
  const amb = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(amb);

  function setMood(name) {
    const m = LIGHT_MOODS[name] || LIGHT_MOODS.day;
    sun.color.setHex(m.sun);
    sun.intensity = m.sunI;
    sun.position.set(m.sunPos[0], m.sunPos[1], m.sunPos[2]);
    amb.color.setHex(m.amb);
    amb.intensity = m.ambI;
    if (scene.background instanceof THREE.Color) scene.background.setHex(m.bg);
    else scene.background = new THREE.Color(m.bg);
    if (scene.fog) { scene.fog.color.setHex(m.fog); }
    else scene.fog = new THREE.Fog(m.fog, 45, 120);
  }

  scene.fog = new THREE.Fog(0x0d0d14, 45, 120);
  scene.background = new THREE.Color(0x0d0d14);
  setMood(mood);
  return { setMood };
}
