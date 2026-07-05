#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PHASES = {
  start: 0.0,
  coil: 0.30,
  trophy: 0.50,
  drive: 0.62,
  follow: 0.85,
  finish: 1.0,
};

const DEFAULT_OUTPUT = {
  meta: {
    source: '',
    fps: 0,
    handedness: 'right',
    contactFrame: 0,
  },
  phases: DEFAULT_PHASES,
  sampledFrames: {},
  joints: {},
  servePoseHints: {
    hips: [],
    shoulderL: [],
    elbowL: [],
    shoulderR: [],
    elbowR: [],
    racket: [],
    kneeBend: [],
    baseY: [],
  },
  servePoseTemplate: {},
  notes: [
    'This file is an authoring aid, not a runtime asset.',
    'Values under servePoseHints are placeholders until you map local rotations into src/entities/player.js.',
  ],
};

function usage() {
  return [
    'Usage: npm run mocap:serve -- --input <cleaned-joints.json> [options]',
    '',
    'Required:',
    '  --input <path>          Cleaned joint-track JSON file',
    '',
    'Optional:',
    '  --output <path>         Output JSON path (default: alongside input)',
    '  --fps <number>          Override source fps',
    '  --contact-frame <int>   Frame index of ball contact',
    '  --left-handed           Mirror input to the repo\'s right-handed rig',
    '  --name <text>           Label stored in output metadata',
    '  --emit-js               Also write a servePose-ready JS snippet',
    '  --emit-js-path <path>   Override the emitted JS snippet path',
    '  --help                  Show this help',
    '',
    'Expected input schema:',
    '  {',
    '    "fps": 120,',
    '    "frames": [',
    '      {',
    '        "index": 0,',
    '        "joints": {',
    '          "hips": { "x": 0, "y": 1.0, "z": 0 },',
    '          "shoulderR": { "x": 0.2, "y": 1.4, "z": -0.1 },',
    '          "elbowR": { "x": 0.5, "y": 1.3, "z": -0.2 },',
    '          "wristR": { "x": 0.8, "y": 1.1, "z": -0.3 },',
    '          "shoulderL": { ... }, "elbowL": { ... },',
    '          "kneeR": { ... }, "kneeL": { ... }',
    '        }',
    '      }',
    '    ]',
    '  }',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    input: '',
    output: '',
    fps: 0,
    contactFrame: -1,
    handedness: 'right',
    name: '',
    emitJs: false,
    emitJsPath: '',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--input') {
      options.input = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--output') {
      options.output = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--fps') {
      options.fps = Number(argv[index + 1] || 0);
      index += 1;
    } else if (arg === '--contact-frame') {
      options.contactFrame = Number(argv[index + 1] || -1);
      index += 1;
    } else if (arg === '--left-handed') {
      options.handedness = 'left';
    } else if (arg === '--name') {
      options.name = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--emit-js') {
      options.emitJs = true;
    } else if (arg === '--emit-js-path') {
      options.emitJsPath = argv[index + 1] || '';
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function ensureFrame(frame, index) {
  if (!frame || typeof frame !== 'object') {
    throw new Error(`Frame ${index} is missing or invalid.`);
  }
  if (!frame.joints || typeof frame.joints !== 'object') {
    throw new Error(`Frame ${index} is missing its joints object.`);
  }
}

function ensureJoint(frame, name, index) {
  const joint = frame.joints[name];
  if (!joint) {
    throw new Error(`Frame ${index} is missing required joint: ${name}`);
  }
  for (const axis of ['x', 'y', 'z']) {
    if (!Number.isFinite(joint[axis])) {
      throw new Error(`Joint ${name} in frame ${index} is missing numeric axis ${axis}`);
    }
  }
  return joint;
}

function normalizeTrack(data, options) {
  const frames = data.frames || [];
  if (!Array.isArray(frames) || frames.length < 2) {
    throw new Error('Input must contain at least two frames.');
  }

  frames.forEach((frame, index) => ensureFrame(frame, index));

  const fps = options.fps || Number(data.fps || 0);
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error('A positive fps is required. Pass --fps or include fps in the input JSON.');
  }

  const required = ['hips', 'shoulderR', 'elbowR', 'wristR', 'shoulderL', 'elbowL', 'kneeR', 'kneeL'];
  frames.forEach((frame, index) => required.forEach((joint) => ensureJoint(frame, joint, index)));

  const contactFrame = options.contactFrame >= 0
    ? options.contactFrame
    : Math.round(frames.length * DEFAULT_PHASES.drive);
  if (!Number.isInteger(contactFrame) || contactFrame < 0 || contactFrame >= frames.length) {
    throw new Error(`contact frame ${contactFrame} is outside the input range 0..${frames.length - 1}`);
  }

  const lastFrame = Math.max(1, frames.length - 1);
  const drivePhase = DEFAULT_PHASES.drive;
  const hips0 = frames[0].joints.hips;
  const normalizedFrames = frames.map((frame, index) => {
    const joints = {};
    for (const [name, joint] of Object.entries(frame.joints)) {
      const x = options.handedness === 'left' ? -joint.x : joint.x;
      joints[name] = {
        x: x - (options.handedness === 'left' ? -hips0.x : hips0.x),
        y: joint.y - hips0.y,
        z: joint.z - hips0.z,
      };
    }
    let t = 0;
    if (index <= contactFrame) {
      t = contactFrame === 0 ? 0 : drivePhase * (index / contactFrame);
    } else {
      const tail = lastFrame - contactFrame;
      t = tail <= 0 ? 1 : drivePhase + (1 - drivePhase) * ((index - contactFrame) / tail);
    }
    return {
      index: Number.isInteger(frame.index) ? frame.index : index,
      t,
      joints,
    };
  });

  return { fps, contactFrame, frames: normalizedFrames };
}

function frameAt(track, phase) {
  let best = track.frames[0];
  let bestDist = Math.abs(best.t - phase);
  for (const frame of track.frames) {
    const dist = Math.abs(frame.t - phase);
    if (dist < bestDist) {
      best = frame;
      bestDist = dist;
    }
  }
  return best;
}

function vector(from, to) {
  return {
    x: to.x - from.x,
    y: to.y - from.y,
    z: to.z - from.z,
  };
}

function magnitude(v) {
  return Math.hypot(v.x, v.y, v.z);
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function normalize(v) {
  const len = magnitude(v) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function average(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

function round3(value) {
  return Number(value.toFixed(3));
}

function armPitch(v) {
  return round3(clamp(Math.atan2(v.y, Math.hypot(v.x, v.z)) + Math.PI / 2, -0.5, 3.2));
}

function armYaw(v) {
  return round3(clamp(Math.atan2(v.z, Math.abs(v.x) + 1e-6), -1.4, 1.4));
}

function armRoll(v) {
  return round3(clamp(Math.atan2(v.x, Math.abs(v.y) + 1e-6), -1.6, 1.6));
}

function elbowFlexion(upper, fore) {
  const angle = Math.acos(clamp(dot(normalize(upper), normalize(fore)), -1, 1));
  return round3(angle);
}

function torsoPitch(hips, shoulderMid) {
  const torso = vector(hips, shoulderMid);
  return round3(clamp(Math.atan2(torso.z, Math.max(0.001, torso.y)), -1.0, 0.8));
}

function torsoYaw(shoulderLine) {
  return round3(clamp(Math.atan2(shoulderLine.z, Math.max(0.001, shoulderLine.x)) * 1.8, -1.2, 1.2));
}

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
    armRUpperLen: magnitude(vector(shoulderR, elbowR)),
    armRForeLen: magnitude(vector(elbowR, wristR)),
  };
}

function buildServePoseHints(sampled) {
  const trophy = sampled.trophy;
  const drive = sampled.drive;
  const finish = sampled.finish;

  return {
    hips: [
      'Map hips.y deltas across phases to baseY and kneeBend coupling.',
      `Drive reach height: ${drive.reachHeight.toFixed(3)}`,
      `Finish shoulder line z-span: ${finish.shoulderLine.z.toFixed(3)}`,
    ],
    shoulderL: [
      `Trophy toss-arm height: ${trophy.armLUpper.y.toFixed(3)}`,
      'Translate toss-arm vector into local pitch/yaw for shoulderL and elbowL.',
    ],
    elbowL: [
      `Trophy toss-arm length: ${(trophy.armRUpperLen + trophy.armRForeLen).toFixed(3)}`,
      'Use this as a consistency check while fitting the toss side.',
    ],
    shoulderR: [
      `Drive hitting-arm upper vector: (${drive.armRUpper.x.toFixed(3)}, ${drive.armRUpper.y.toFixed(3)}, ${drive.armRUpper.z.toFixed(3)})`,
      'Convert these world deltas into local shoulder pitch/yaw/roll samples.',
    ],
    elbowR: [
      `Drive forearm vector: (${drive.armRFore.x.toFixed(3)}, ${drive.armRFore.y.toFixed(3)}, ${drive.armRFore.z.toFixed(3)})`,
      'Fit elbow extension so the contact phase still peaks near n≈0.62.',
    ],
    racket: [
      'No racket-head track is inferred here; keep using the authored racket channel until wristR authoring is introduced.',
    ],
    kneeBend: [
      `Trophy base height: ${trophy.baseHeight.toFixed(3)}`,
      `Drive base height: ${drive.baseHeight.toFixed(3)}`,
      'Derive a monotonic load -> drive curve from hip height and knee spread.',
    ],
    baseY: [
      `Frame-to-frame base heights sampled from hips.y.`,
      'Map these directly onto servePose baseY after visual verification.',
    ],
  };
}

function buildServePoseTemplate(sampled) {
  const order = ['start', 'coil', 'trophy', 'drive', 'follow', 'finish'];
  const baseHeights = order.map((name) => sampled[name].baseHeight);
  const minBase = Math.min(...baseHeights);
  const maxBase = Math.max(...baseHeights);
  const baseSpan = Math.max(0.001, maxBase - minBase);

  const template = {
    times: order.map((name) => DEFAULT_PHASES[name]),
    hips: [[], [], []],
    shoulderL: [[], [], []],
    elbowL: [[], [], []],
    shoulderR: [[], [], []],
    elbowR: [[], [], []],
    racket: [[], [], []],
    kneeBend: [],
    baseYDelta: [],
    notes: [
      'These are coarse angle estimates from sampled joint vectors.',
      'Use them as a first servePose pass, then correct by eye in orbit-camera review.',
    ],
  };

  for (const name of order) {
    const phase = sampled[name];
    const upperR = phase.armRUpper;
    const foreR = phase.armRFore;
    const upperL = phase.armLUpper;
    const shoulderMid = phase.shoulderMid;

    template.hips[0].push(torsoPitch(phase.hips, shoulderMid));
    template.hips[1].push(torsoYaw(phase.shoulderLine));
    template.hips[2].push(0);

    template.shoulderR[0].push(armPitch(upperR));
    template.shoulderR[1].push(armYaw(upperR));
    template.shoulderR[2].push(armRoll(upperR));

    template.shoulderL[0].push(armPitch(upperL));
    template.shoulderL[1].push(armYaw(upperL));
    template.shoulderL[2].push(armRoll(upperL));

    template.elbowR[0].push(elbowFlexion(upperR, foreR));
    template.elbowR[1].push(0);
    template.elbowR[2].push(0);

    template.elbowL[0].push(round3(clamp(armPitch(upperL) * 0.22, 0.02, 1.6)));
    template.elbowL[1].push(0);
    template.elbowL[2].push(0);

    template.racket[0].push(round3(clamp(0.55 - armPitch(foreR) * 0.22, -0.2, 1.1)));
    template.racket[1].push(0);
    template.racket[2].push(0);

    const crouch = (maxBase - phase.baseHeight) / baseSpan;
    template.kneeBend.push(round3(0.2 + crouch * 0.58));
    template.baseYDelta.push(round3(-phase.baseHeight));
  }

  return template;
}

function formatArray(values) {
  return `[${values.map((value) => round3(value).toFixed(3)).join(', ')}]`;
}

function buildServePoseSnippet(template, meta) {
  const lines = [];
  lines.push(`// Generated by scripts/mocap/extract-serve-keyframes.mjs from ${meta.source}`);
  lines.push('// Coarse first pass only; paste as SERVE_POSE_TEMPLATE and tune by eye.');
  lines.push('const IMPORTED_SERVE_POSE_TEMPLATE = {');
  lines.push(`  hips: { times: ${formatArray(template.times)}, values: [`);
  lines.push(`    ${formatArray(template.hips[0])},`);
  lines.push(`    ${formatArray(template.hips[1])},`);
  lines.push(`    ${formatArray(template.hips[2])},`);
  lines.push('  ] },');
  lines.push(`  shoulderL: { times: ${formatArray(template.times)}, values: [`);
  lines.push(`    ${formatArray(template.shoulderL[0])},`);
  lines.push(`    ${formatArray(template.shoulderL[1])},`);
  lines.push(`    ${formatArray(template.shoulderL[2])},`);
  lines.push('  ] },');
  lines.push(`  elbowL: { times: ${formatArray(template.times)}, values: [`);
  lines.push(`    ${formatArray(template.elbowL[0])},`);
  lines.push(`    ${formatArray(template.elbowL[1])},`);
  lines.push(`    ${formatArray(template.elbowL[2])},`);
  lines.push('  ] },');
  lines.push(`  shoulderR: { times: ${formatArray(template.times)}, values: [`);
  lines.push(`    ${formatArray(template.shoulderR[0])},`);
  lines.push(`    ${formatArray(template.shoulderR[1])},`);
  lines.push(`    ${formatArray(template.shoulderR[2])},`);
  lines.push('  ] },');
  lines.push(`  elbowR: { times: ${formatArray(template.times)}, values: [`);
  lines.push(`    ${formatArray(template.elbowR[0])},`);
  lines.push(`    ${formatArray(template.elbowR[1])},`);
  lines.push(`    ${formatArray(template.elbowR[2])},`);
  lines.push('  ] },');
  lines.push(`  racket: { times: ${formatArray(template.times)}, values: [`);
  lines.push(`    ${formatArray(template.racket[0])},`);
  lines.push(`    ${formatArray(template.racket[1])},`);
  lines.push(`    ${formatArray(template.racket[2])},`);
  lines.push('  ] },');
  lines.push(`  kneeBend: { times: ${formatArray(template.times)}, values: ${formatArray(template.kneeBend)} },`);
  lines.push(`  baseY: { base: 0.83, scale: 1, times: ${formatArray(template.times)}, values: ${formatArray(template.baseYDelta)} },`);
  lines.push('};');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.input) {
    console.log(usage());
    process.exit(options.help ? 0 : 1);
  }

  const inputPath = path.resolve(options.input);
  const raw = await fs.readFile(inputPath, 'utf8');
  const data = JSON.parse(raw);
  const track = normalizeTrack(data, options);

  const sampled = {};
  const sampledFrames = {};
  for (const [name, phase] of Object.entries(DEFAULT_PHASES)) {
    const frame = frameAt(track, phase);
    sampled[name] = summarizePhase(frame);
    sampledFrames[name] = frame.index;
  }

  const output = structuredClone(DEFAULT_OUTPUT);
  output.meta = {
    source: options.name || path.basename(inputPath),
    fps: track.fps,
    handedness: options.handedness === 'left' ? 'left-mirrored-to-right' : 'right',
    contactFrame: track.contactFrame,
  };
  output.sampledFrames = sampledFrames;
  output.joints = sampled;
  output.servePoseHints = buildServePoseHints(sampled);
  output.servePoseTemplate = buildServePoseTemplate(sampled);
  output.notes.push('Use the sampledFrames indices to cross-check the original video around trophy/contact/follow-through.');

  const outputPath = options.output
    ? path.resolve(options.output)
    : path.join(path.dirname(inputPath), `${path.basename(inputPath, path.extname(inputPath))}.serve-keyframes.json`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  let jsPath = '';
  if (options.emitJs) {
    const snippet = buildServePoseSnippet(output.servePoseTemplate, output.meta);
    jsPath = options.emitJsPath
      ? path.resolve(options.emitJsPath)
      : path.join(path.dirname(outputPath), `${path.basename(inputPath, path.extname(inputPath))}.serve-pose-snippet.js`);
    await fs.mkdir(path.dirname(jsPath), { recursive: true });
    await fs.writeFile(jsPath, snippet, 'utf8');
  }

  console.log(`Wrote serve authoring aid: ${outputPath}`);
  console.log(`Sampled frames: ${JSON.stringify(sampledFrames)}`);
  if (jsPath) console.log(`Wrote servePose snippet: ${jsPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});