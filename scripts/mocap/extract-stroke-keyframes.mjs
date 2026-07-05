#!/usr/bin/env node

const DEFAULT_PHASES = {
  start: 0.0,
  coil: 0.25,
  contact: 0.4,
  release: 0.5,
  finish: 0.7,
  recover: 1.0,
};

function usage() {
  return [
    'Usage: npm run mocap:stroke -- --input <cleaned-joints.json> --side <forehand|backhand> [options]',
    '',
    'Required:',
    '  --input <path>          Cleaned or trimmed joint-track JSON file',
    '  --side <name>           forehand or backhand',
    '',
    'Optional:',
    '  --output <path>         Output JSON path (default: alongside input)',
    '  --fps <number>          Override source fps',
    '  --contact-frame <int>   Frame index of ball contact',
    '  --name <text>           Label stored in output metadata',
    '  --emit-js               Also write a stroke-template JS snippet',
    '  --emit-js-path <path>   Override the emitted JS snippet path',
    '  --help                  Show this help',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    input: '',
    output: '',
    side: '',
    fps: 0,
    contactFrame: -1,
    name: '',
    emitJs: false,
    emitJsPath: '',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--input') { options.input = argv[index + 1] || ''; index += 1; }
    else if (arg === '--output') { options.output = argv[index + 1] || ''; index += 1; }
    else if (arg === '--side') { options.side = argv[index + 1] || ''; index += 1; }
    else if (arg === '--fps') { options.fps = Number(argv[index + 1] || 0); index += 1; }
    else if (arg === '--contact-frame') { options.contactFrame = Number(argv[index + 1] || -1); index += 1; }
    else if (arg === '--name') { options.name = argv[index + 1] || ''; index += 1; }
    else if (arg === '--emit-js') options.emitJs = true;
    else if (arg === '--emit-js-path') { options.emitJsPath = argv[index + 1] || ''; index += 1; }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function ensureFrame(frame, index) {
  if (!frame || typeof frame !== 'object' || !frame.joints || typeof frame.joints !== 'object') {
    throw new Error(`Frame ${index} is missing or invalid.`);
  }
}

function ensureJoint(frame, name, index) {
  const joint = frame.joints[name];
  if (!joint) throw new Error(`Frame ${index} is missing required joint: ${name}`);
  for (const axis of ['x', 'y', 'z']) {
    if (!Number.isFinite(joint[axis])) throw new Error(`Joint ${name} in frame ${index} is missing numeric axis ${axis}`);
  }
}

function normalizeTrack(data, options) {
  const frames = data.frames || [];
  if (!Array.isArray(frames) || frames.length < 2) throw new Error('Input must contain at least two frames.');
  frames.forEach((frame, index) => ensureFrame(frame, index));
  const fps = options.fps || Number(data.fps || 0);
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('A positive fps is required.');
  const required = ['hips', 'shoulderR', 'elbowR', 'wristR', 'shoulderL', 'elbowL', 'kneeR', 'kneeL'];
  frames.forEach((frame, index) => required.forEach((joint) => ensureJoint(frame, joint, index)));
  const contactFrame = options.contactFrame >= 0
    ? options.contactFrame
    : Number.isInteger(data.suggestedContactFrame) ? data.suggestedContactFrame : Math.round(frames.length * DEFAULT_PHASES.contact);
  if (!Number.isInteger(contactFrame) || contactFrame < 0 || contactFrame >= frames.length) {
    throw new Error(`contact frame ${contactFrame} is outside the input range 0..${frames.length - 1}`);
  }
  const lastFrame = Math.max(1, frames.length - 1);
  const hips0 = frames[0].joints.hips;
  const normalizedFrames = frames.map((frame, index) => {
    const joints = {};
    for (const [name, joint] of Object.entries(frame.joints)) {
      joints[name] = {
        x: joint.x - hips0.x,
        y: joint.y - hips0.y,
        z: joint.z - hips0.z,
      };
    }
    let t = 0;
    if (index <= contactFrame) t = contactFrame === 0 ? 0 : DEFAULT_PHASES.contact * (index / contactFrame);
    else {
      const tail = lastFrame - contactFrame;
      t = tail <= 0 ? 1 : DEFAULT_PHASES.contact + (1 - DEFAULT_PHASES.contact) * ((index - contactFrame) / tail);
    }
    return { index: Number.isInteger(frame.index) ? frame.index : index, t, joints };
  });
  return { fps, contactFrame, frames: normalizedFrames };
}

function frameAt(track, phase) {
  let best = track.frames[0];
  let bestDist = Math.abs(best.t - phase);
  for (const frame of track.frames) {
    const dist = Math.abs(frame.t - phase);
    if (dist < bestDist) { best = frame; bestDist = dist; }
  }
  return best;
}

function vector(from, to) { return { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }; }
function magnitude(v) { return Math.hypot(v.x, v.y, v.z); }
function clamp(value, lo, hi) { return Math.max(lo, Math.min(hi, value)); }
function normalize(v) { const len = magnitude(v) || 1; return { x: v.x / len, y: v.y / len, z: v.z / len }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function average(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }; }
function round3(value) { return Number(value.toFixed(3)); }
function armPitch(v) { return round3(clamp(Math.atan2(v.y, Math.hypot(v.x, v.z)) + Math.PI / 2, -1.2, 3.2)); }
function armYaw(v) { return round3(clamp(Math.atan2(v.z, Math.abs(v.x) + 1e-6), -1.6, 1.6)); }
function armRoll(v) { return round3(clamp(Math.atan2(v.x, Math.abs(v.y) + 1e-6), -1.8, 1.8)); }
function elbowFlexion(upper, fore) { return round3(Math.acos(clamp(dot(normalize(upper), normalize(fore)), -1, 1))); }
function torsoPitch(hips, shoulderMid) { const torso = vector(hips, shoulderMid); return round3(clamp(Math.atan2(torso.z, Math.max(0.001, torso.y)), -0.8, 0.8)); }
function torsoYaw(shoulderLine) { return round3(clamp(Math.atan2(shoulderLine.z, Math.max(0.001, shoulderLine.x)) * 1.8, -1.5, 1.5)); }

function summarizePhase(frame) {
  const hips = frame.joints.hips;
  const shoulderR = frame.joints.shoulderR;
  const elbowR = frame.joints.elbowR;
  const wristR = frame.joints.wristR;
  const shoulderL = frame.joints.shoulderL;
  const elbowL = frame.joints.elbowL;
  const kneeR = frame.joints.kneeR;
  const kneeL = frame.joints.kneeL;
  const shoulderMid = average(shoulderL, shoulderR);
  return {
    hips,
    shoulderMid,
    shoulderLine: vector(shoulderL, shoulderR),
    armRUpper: vector(shoulderR, elbowR),
    armRFore: vector(elbowR, wristR),
    armLUpper: vector(shoulderL, elbowL),
    kneeSpread: Math.abs(kneeR.x - kneeL.x),
    reachHeight: wristR.y,
    baseHeight: hips.y,
  };
}

function formatArray(values) { return `[${values.map((value) => round3(value).toFixed(3)).join(', ')}]`; }

function buildStrokeTemplate(sampled, side) {
  const order = ['start', 'coil', 'contact', 'release', 'finish', 'recover'];
  const template = {
    times: order.map((name) => DEFAULT_PHASES[name]),
    hips: [[], [], []],
    shoulderR: [[], [], []],
    elbowR: [[], [], []],
    shoulderL: [[], [], []],
    elbowL: [[], [], []],
    racket: [[], [], []],
    chest: [[], [], []],
    wristR: [[], [], []],
    kneeBend: [],
    baseYDelta: [],
    notes: [
      `${side} stroke first-pass template.`,
      'Use for flat/topspin only; keep slice, drop, and volley on the existing authored motion.',
    ],
  };

  const baseHeights = order.map((name) => sampled[name].baseHeight);
  const minBase = Math.min(...baseHeights);
  const maxBase = Math.max(...baseHeights);
  const baseSpan = Math.max(0.001, maxBase - minBase);

  for (const name of order) {
    const phase = sampled[name];
    template.hips[0].push(torsoPitch(phase.hips, phase.shoulderMid));
    template.hips[1].push(torsoYaw(phase.shoulderLine));
    template.hips[2].push(0);
    template.shoulderR[0].push(armPitch(phase.armRUpper));
    template.shoulderR[1].push(armYaw(phase.armRUpper));
    template.shoulderR[2].push(armRoll(phase.armRUpper));
    template.elbowR[0].push(elbowFlexion(phase.armRUpper, phase.armRFore));
    template.elbowR[1].push(0);
    template.elbowR[2].push(0);
    template.shoulderL[0].push(armPitch(phase.armLUpper));
    template.shoulderL[1].push(armYaw(phase.armLUpper));
    template.shoulderL[2].push(armRoll(phase.armLUpper));
    template.elbowL[0].push(round3(clamp(armPitch(phase.armLUpper) * 0.22, 0.02, 1.6)));
    template.elbowL[1].push(0);
    template.elbowL[2].push(0);
    template.racket[0].push(round3(clamp(0.35 - armPitch(phase.armRFore) * 0.15, -0.25, 1.2)));
    template.racket[1].push(0);
    template.racket[2].push(0);
    template.chest[0].push(0);
    template.chest[1].push(round3(clamp(template.hips[1].at(-1) * 0.45, -0.8, 0.8)));
    template.chest[2].push(0);
    template.wristR[0].push(round3(clamp((template.shoulderR[0].at(-1) - template.racket[0].at(-1)) * 0.18, -0.6, 0.6)));
    template.wristR[1].push(0);
    template.wristR[2].push(0);
    const crouch = (maxBase - phase.baseHeight) / baseSpan;
    template.kneeBend.push(round3(0.22 + crouch * 0.45));
    template.baseYDelta.push(round3(-phase.baseHeight));
  }
  return template;
}

function buildStrokeSnippet(template, meta, side) {
  const lines = [];
  const symbol = side === 'forehand' ? 'IMPORTED_FOREHAND_STROKE_TEMPLATE' : 'IMPORTED_BACKHAND_STROKE_TEMPLATE';
  lines.push(`// Generated by scripts/mocap/extract-stroke-keyframes.mjs from ${meta.source}`);
  lines.push('// Coarse first pass only; use for flat/topspin. Keep slice, drop, and volley on authored motion.');
  lines.push(`const ${symbol} = {`);
  for (const key of ['hips', 'shoulderR', 'elbowR', 'shoulderL', 'elbowL', 'racket', 'chest', 'wristR']) {
    lines.push(`  ${key}: { times: ${formatArray(template.times)}, values: [`);
    for (const axisValues of template[key]) lines.push(`    ${formatArray(axisValues)},`);
    lines.push('  ] },');
  }
  lines.push(`  kneeBend: { times: ${formatArray(template.times)}, values: ${formatArray(template.kneeBend)} },`);
  lines.push(`  baseY: { base: 0.83, scale: 1, times: ${formatArray(template.times)}, values: ${formatArray(template.baseYDelta)} },`);
  lines.push('};');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.input || !options.side) {
    console.log(usage());
    process.exit(options.help ? 0 : 1);
  }
  if (!['forehand', 'backhand'].includes(options.side)) throw new Error(`Invalid --side: ${options.side}`);
  const { readFile, writeFile, mkdir } = await import('node:fs/promises');
  const path = await import('node:path');
  const inputPath = path.resolve(options.input);
  const raw = await readFile(inputPath, 'utf8');
  const data = JSON.parse(raw);
  const track = normalizeTrack(data, options);

  const sampled = {};
  const sampledFrames = {};
  for (const [name, phase] of Object.entries(DEFAULT_PHASES)) {
    const frame = frameAt(track, phase);
    sampled[name] = summarizePhase(frame);
    sampledFrames[name] = frame.index;
  }

  const template = buildStrokeTemplate(sampled, options.side);
  const output = {
    meta: {
      source: options.name || path.basename(inputPath),
      fps: track.fps,
      side: options.side,
      contactFrame: track.contactFrame,
    },
    phases: DEFAULT_PHASES,
    sampledFrames,
    joints: sampled,
    strokeTemplate: template,
    notes: template.notes,
  };

  const outputPath = options.output
    ? path.resolve(options.output)
    : path.join(path.dirname(inputPath), `${path.basename(inputPath, path.extname(inputPath))}.${options.side}.stroke-keyframes.json`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  let jsPath = '';
  if (options.emitJs) {
    const snippet = buildStrokeSnippet(template, output.meta, options.side);
    jsPath = options.emitJsPath
      ? path.resolve(options.emitJsPath)
      : path.join(path.dirname(outputPath), `${path.basename(inputPath, path.extname(inputPath))}.${options.side}.stroke-snippet.js`);
    await mkdir(path.dirname(jsPath), { recursive: true });
    await writeFile(jsPath, snippet, 'utf8');
  }

  console.log(`Wrote stroke authoring aid: ${outputPath}`);
  console.log(`Sampled frames: ${JSON.stringify(sampledFrames)}`);
  if (jsPath) console.log(`Wrote stroke snippet: ${jsPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});