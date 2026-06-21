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
import { createReplayBuffer } from './replay-buffer.js';
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

// Immersion / Presentation settings (the home for every immersion toggle),
// persisted in localStorage and surfaced by the in-game gear panel.
const IMM_KEY = 'immSettings';
const IMM_DEFAULTS = {
  lightMood: 'day', crowd: 1, grunts: true, footsteps: true, haptics: true, replays: true,
};
function loadImmSettings() {
  try { return { ...IMM_DEFAULTS, ...JSON.parse(localStorage.getItem(IMM_KEY) || '{}') }; }
  catch { return { ...IMM_DEFAULTS }; }
}
const immSettings = loadImmSettings();

const scene = new THREE.Scene();
const lights = buildLights(scene, immSettings.lightMood); // { setMood }

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

let replaysEnabled = true; // instant replays on notable points (immersion 04 §4.1)

// Apply (and persist) one immersion setting by routing it to the right system.
function applyImmSetting(key, val) {
  immSettings[key] = val;
  try { localStorage.setItem(IMM_KEY, JSON.stringify(immSettings)); } catch { /* ignore */ }
  switch (key) {
    case 'lightMood': lights.setMood(val); break;
    case 'crowd':
      audio.setAmbientLevel(val === 2 ? 0.07 : val === 1 ? 0.035 : 0);
      if (val === 0) audio.ambient(false);
      break;
    case 'grunts': audio.setGrunts(val); break;
    case 'footsteps': audio.setFootsteps(val); break;
    case 'haptics': input.setHaptics(val); break;
    case 'replays': replaysEnabled = val; break;
  }
}
// apply saved settings at boot (lightMood was already applied by buildLights)
for (const k of Object.keys(immSettings)) {
  if (k !== 'lightMood') applyImmSetting(k, immSettings[k]);
}

const ui = createUI({
  onVirtualKey: (c, d) => input.setVirtualKey(c, d),
  onMoveAxis: (x, z) => input.setMoveAxis(x, z),
  settings: immSettings,
  onSetting: applyImmSetting,
});
const render = createRenderHost(scene, audio);
const cameraRig = createCameraRig(camera, render);
const minimap = createMinimap();

// --- instant replay (immersion 04 §4.1) + highlight reel (06 §6.8) ---
const replay = createReplayBuffer();
const highlights = []; // captured clips ranked by drama, for the end-of-match reel
let replayState = null;   // {clips,ci,t,wall,speed} while playing back
let pendingReplay = false; // a notable point just ended → start playback this frame
const _rTarget = new THREE.Vector3();
const _rCam = new THREE.Vector3();
const replayBadge = document.createElement('div');
replayBadge.textContent = '● REPLAY';
replayBadge.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);'
  + 'z-index:55;display:none;color:#ff5a5a;font:700 16px sans-serif;letter-spacing:2px;'
  + 'text-shadow:0 1px 4px #000';
document.body.appendChild(replayBadge);

// latest notable-point descriptor (consumed by replay / highlight features)
let lastHighlight = null;

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
  // reset replay/highlight state when a fresh match starts
  onMatchStart() {
    highlights.length = 0;
    replay.clear();
    replayState = null;
    replayBadge.style.display = 'none';
  },
  // ---- presentation / drama signals (immersion 06 §6.0), fanned out ----
  onPointSituation(kind) {
    ui.pointSituation(kind);
  },
  onTension(v) {
    audio.setTension(v);
    if (cameraRig.setTension) cameraRig.setTension(v);
  },
  onPointHighlight(winner, isBreak, isSet, isMatch, rallyLen) {
    lastHighlight = { winner, isBreak, isSet, isMatch, rallyLen };
    pendingReplay = true; // frame loop decides whether it's worth replaying
    // capture a clip of notable points for the end-of-match reel
    if (replaysEnabled) {
      const notable = isBreak || isSet || isMatch || rallyLen >= 8;
      if (notable && replay.frames() >= 60) {
        const rank = (isMatch ? 100 : isSet ? 80 : isBreak ? 50 : 0) + rallyLen;
        highlights.push({ clip: replay.snapshot(165), rank });
        if (highlights.length > 16) highlights.shift();
      }
    }
  },
};

const seed = (Math.random() * 0x7fffffff) | 0;
logic.init(host, seed);
ui.setMenuTapHandler((action, a, b) => logic.menuCmd(action, a, b));

window.__host = host; // for debugging / e2e checks
window.__cam = camera;
window.__lights = lights; // lighting-mood controller (settings UI hooks this)

let last = performance.now();
let acc = 0;

// Begin playback if the point that just ended was notable. On the match-winning
// point this plays a multi-clip HIGHLIGHT REEL (top moments by drama); otherwise
// a single slow-motion replay of the last couple of seconds. Hard caps below
// guarantee it always ends and the sim resumes.
function maybeStartReplay() {
  if (!replaysEnabled || !lastHighlight) return;
  const h = lastHighlight;
  const notable = h.isBreak || h.isSet || h.isMatch || h.rallyLen >= 8;
  if (!notable) return;
  if (replay.frames() < 60) return; // not enough footage yet
  let clips;
  let badge = '● REPLAY';
  if (h.isMatch && highlights.length > 1) {
    // end-of-match reel: top moments by rank, oldest→newest for a narrative
    clips = highlights.slice().sort((a, b) => b.rank - a.rank).slice(0, 5)
      .map((x) => x.clip).reverse();
    badge = '★ MATCH HIGHLIGHTS';
  } else {
    clips = [replay.snapshot(165)]; // last ~2.75 s
  }
  if (!clips.length || !clips[0].length) return;
  replayState = { clips, ci: 0, t: 0, wall: 0, speed: 0.5 };
  render.setReplayMode(true);
  render.setHumanTransparent(false);
  replayBadge.textContent = badge;
  replayBadge.style.display = 'block';
}

function endReplay() {
  replayState = null;
  render.setReplayMode(false);
  replayBadge.style.display = 'none';
}

// Drive one playback frame from the current clip: push a recorded row into the
// renderer and frame it with a cinematic side angle.
function runReplayFrame(dt) {
  const rs = replayState;
  rs.wall += dt;
  rs.t += dt * rs.speed;
  let clip = rs.clips[rs.ci];
  let fi = Math.floor(rs.t * 60);
  if (fi >= clip.length) { // advance to the next clip in the reel
    rs.ci++; rs.t = 0; fi = 0;
    if (rs.ci >= rs.clips.length) { endReplay(); return; }
    clip = rs.clips[rs.ci];
  }
  if (rs.wall > 18) { endReplay(); return; } // absolute safety cap
  const r = clip[fi];
  render.setBall(r.active, r.bx, r.by, r.bz, r.sx, r.sy, r.sz);
  render.setPlayer(0, r.p0x, r.p0z, 0, 0);
  render.setPlayer(1, r.p1x, r.p1z, 0, 0);
  render.tick(dt);
  _rTarget.set(r.bx, r.by, r.bz);
  _rCam.set(13, 7, r.bz * 0.4); // elevated broadcast side angle
  camera.position.lerp(_rCam, 0.12);
  camera.lookAt(_rTarget);
  renderer.render(scene, camera);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (replayState) { runReplayFrame(dt); return; }

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
  // record render state for instant replay (skipped while replaying)
  if (replaysEnabled && render.isActive()) {
    replay.record(render.getBall(), render.getPlayer(0), render.getPlayer(1));
  }
  // a notable point just ended → maybe kick off a replay (sim freezes meanwhile)
  if (pendingReplay) { pendingReplay = false; maybeStartReplay(); }
  // behind-player view → dim the human so the incoming ball stays visible
  const behind = render.isActive() && cameraRig.getMode() !== 'overhead';
  render.setHumanTransparent(behind);
  renderer.render(scene, camera);
  minimap.update(
    render.getBall(),
    render.getPlayer(0),
    render.getPlayer(1),
    behind,
  );
}
requestAnimationFrame(frame);
