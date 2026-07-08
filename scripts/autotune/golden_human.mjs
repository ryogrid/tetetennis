#!/usr/bin/env node
// Human-mode input-tape golden (autotune_design/06-apply-back-and-verification.md).
//
// Drives a normal human-vs-CPU match (setCpuMode is NEVER called) with a
// deterministic procedural input tape, and records the partial match report
// after a fixed step count. This is the automated proof that the flag-off /
// human path (charge model, timing-window contact, serve meter, assist
// branches, reach_grace) survives registry rewrites byte-identically —
// CPU-mode goldens never execute that code.
//
//   node golden_human.mjs write   goldens/human-mode.json
//   node golden_human.mjs check   goldens/human-mode.json

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeHost } from './host-mock.mjs';

const BUNDLE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../_build/js/release/build/logic/game/game.js',
);
const logic = await import(BUNDLE);

const DT = 1 / 240;
const STEPS = 240 * 180; // 3 sim-minutes
const SEED = 7777;

// Procedural tape: everything is a pure function of the step counter, so the
// run is fully deterministic. The "player" serves with Space + flat, then
// hold-charges topspin in bursts and wanders with the d-pad — bad tennis,
// which is good coverage (faults, whiffs, safety hits, errors).
function makeTape() {
  let step = 0;
  return {
    tick: () => { step++; },
    moveX: () => [0, 1, 0, -1][(step >> 7) & 3],
    moveZ: () => [0, -1, 0, 1][(step >> 8) & 3],
    wasPressed: (code) => code === 'Space' && step % 480 === 0 && step > 0,
    shotKey: () => (step % 480 === 120 ? 'flat' : ''),
    shotHeld: () => (step % 240 < 200 ? 'topspin' : ''),
    isDown: () => false,
  };
}

function run() {
  const state = { done: false };
  const host = makeHost(state);
  const tape = makeTape();
  host.input = {
    moveX: tape.moveX,
    moveZ: tape.moveZ,
    shotKey: tape.shotKey,
    shotHeld: tape.shotHeld,
    wasPressed: tape.wasPressed,
    isDown: tape.isDown,
    touchStroke: () => '',
    touchServe: () => '',
    haptic: () => {},
  };
  host.loadAssist = () => 'on'; // exercise the assist branches too
  logic.init(host, SEED);
  logic.menuCmd('play', 0, 0);
  logic.menuCmd('set', 0, 0); // MATCH
  logic.menuCmd('set', 1, 2); // hard court
  logic.menuCmd('set', 2, 1); // Assist = On
  logic.menuCmd('set', 3, 1); // normal difficulty
  logic.menuCmd('set', 4, 2); // games = 6
  logic.menuCmd('go', 0, 0);
  logic.menuCmd('you', 4, 0);
  logic.menuCmd('opp', 1, 0);
  logic.menuCmd('go', 0, 0);
  for (let i = 0; i < STEPS && !state.done; i++) {
    logic.handleInput();
    logic.fixedUpdate(DT);
    tape.tick();
  }
  return logic.getMatchStats();
}

const [mode, file] = process.argv.slice(2);
if (mode !== 'write' && mode !== 'check') {
  console.error('usage: golden_human.mjs write|check <file>');
  process.exit(1);
}
const raw = run();
if (raw === '') {
  console.error('no report produced — bundle missing getMatchStats?');
  process.exit(1);
}
if (mode === 'write') {
  writeFileSync(file, raw + '\n');
  const r = JSON.parse(raw);
  console.error(`human golden: points=${r.points_played} written to ${file}`);
} else {
  const want = readFileSync(file, 'utf8').trimEnd();
  if (want !== raw) {
    console.error('HUMAN GOLDEN MISMATCH — the human/flag-off path changed');
    process.exit(1);
  }
  console.error('human golden: byte-identical');
}
