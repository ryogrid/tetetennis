// Bootstrap: renderer, scene, fixed-step loop. The MoonBit logic owns the
// game loop's brain; this layer builds the `host` object it drives via FFI and
// runs the requestAnimationFrame loop.
import * as THREE from 'three';
import * as logic from '../_build/js/release/build/logic/game/game.js';
import { buildLights } from './court.js';
import { createCameraRig } from './camera.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createUI } from './ui.js';
import { createRenderHost } from './render-host.js';
import { createMinimap } from './minimap.js';
import { registerPWA } from './pwa.js';

const DT = 1 / 240; // fixed physics step (mirrors the MoonBit DT)

const ASSIST_KEY = 'assistLevel';
const ASSIST_LEVELS = ['off', 'on', 'full'];

registerPWA();

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
buildLights(scene);

const camera = new THREE.PerspectiveCamera(
  70, window.innerWidth / window.innerHeight, 0.1, 200,
);
camera.position.set(0, 1.62, 12.5);
camera.lookAt(0, 0.9, -6);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const audio = createAudio();
const input = createInput(audio.initAudio);
const ui = createUI({
  onVirtualKey: (c, d) => input.setVirtualKey(c, d),
  onMoveAxis: (x, z) => input.setMoveAxis(x, z),
});
const render = createRenderHost(scene);
const cameraRig = createCameraRig(camera, render);
const minimap = createMinimap();

const host = {
  render,
  audio,
  ui,
  camera: cameraRig,
  input,
  loadAssist() {
    try {
      const v = localStorage.getItem(ASSIST_KEY);
      return v && ASSIST_LEVELS.includes(v) ? v : '';
    } catch { return ''; }
  },
  saveAssist(level) {
    try {
      if (ASSIST_LEVELS.includes(level)) localStorage.setItem(ASSIST_KEY, level);
    } catch { /* localStorage unavailable */ }
  },
};

const seed = (Math.random() * 0x7fffffff) | 0;
logic.init(host, seed);
ui.setMenuTapHandler((idx) => logic.menuTap(idx));

window.__host = host; // for debugging / e2e checks
window.__cam = camera;

let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  logic.handleInput();
  // Approach slow-motion: scale simulated time (not the camera or physics
  // step) so the ball gives the player more real milliseconds to react.
  const sdt = dt * logic.getTimeScale(dt);
  acc += sdt;
  while (acc >= DT) {
    logic.fixedUpdate(DT);
    acc -= DT;
  }
  logic.frameUpdate(sdt);
  render.tick(sdt);
  input.endFrame();
  renderer.render(scene, camera);
  minimap.update(
    render.getBall(),
    render.getPlayer(0),
    render.getPlayer(1),
    render.isActive() && cameraRig.getMode() !== 'overhead',
  );
}
requestAnimationFrame(frame);
