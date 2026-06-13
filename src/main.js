// Bootstrap: renderer, scene, fixed-step loop.
import * as THREE from 'three';
import { DT } from './physics/constants.js';
import { buildLights } from './court.js';
import { createCameraRig } from './camera.js';
import { createInput } from './input.js';
import { createGame } from './game.js';
import { initAudio } from './audio.js';
import { registerPWA } from './pwa.js';

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

const cameraRig = createCameraRig(camera);
const input = createInput(initAudio);
const game = createGame(scene, cameraRig, input);
window.__game = game; // for debugging / e2e checks
window.__cam = camera;

let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  game.handleInput();
  // Approach slow-motion: scale simulated time (not the camera or physics
  // step) so the ball gives the player more real milliseconds to react.
  const sdt = dt * game.getTimeScale(dt);
  acc += sdt;
  while (acc >= DT) {
    game.fixedUpdate(DT);
    acc -= DT;
  }
  game.frameUpdate(sdt);
  input.endFrame();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
