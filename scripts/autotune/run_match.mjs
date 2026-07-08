#!/usr/bin/env node
// Headless CPU-vs-CPU match runner (autotune_design/04-headless-runner.md).
//
//   node run_match.mjs --job job.json      # batch run (or job JSON on stdin)
//   node run_match.mjs --bench             # steps/sec benchmark
//   node run_match.mjs --golden DIR        # write the golden report matrix
//
// stdout: one JSON document { runner_version, results: [...] }.
// stderr: diagnostics. Non-zero exit only for infrastructure errors.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeHost } from './host-mock.mjs';

const RUNNER_VERSION = 1;
const DT = 1 / 240;
const BUNDLE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../_build/js/release/build/logic/game/game.js',
);

const SURFACES = { clay: 0, grass: 1, hard: 2 };
const DIFFICULTIES = { easy: 0, normal: 1, hard: 2 };
const GAMES = { 2: 0, 4: 1, 6: 2 };
const MATCH_ROWS = { mode: 0, surface: 1, assist: 2, difficulty: 3, games: 4 };

let logic;
try {
  logic = await import(BUNDLE);
} catch (e) {
  console.error(`cannot load logic bundle at ${BUNDLE}\nrun: npm run logic:build\n${e.message}`);
  process.exit(1);
}
for (const fn of ['init', 'fixedUpdate', 'menuCmd', 'setCpuMode', 'getMatchStats']) {
  if (typeof logic[fn] !== 'function') {
    console.error(`bundle is stale: missing export ${fn}; run: npm run logic:build`);
    process.exit(1);
  }
}
const hasParams = typeof logic.setParam === 'function'; // arrives in Stage C

function runMatch(m, params, maxSteps) {
  const state = { done: false };
  const host = makeHost(state);
  logic.init(host, m.seed); // fresh Game per match — clean state per seed
  if (hasParams) {
    logic.resetParams();
    for (const [k, v] of Object.entries(params)) {
      if (!logic.setParam(k, v)) {
        console.error(`unknown param: ${k}`);
        process.exit(1);
      }
    }
  } else if (Object.keys(params).length > 0) {
    console.error('bundle has no setParam export but job has params; rebuild after Stage C');
    process.exit(1);
  }
  logic.setCpuMode(1);
  logic.menuCmd('play', 0, 0);
  logic.menuCmd('set', MATCH_ROWS.mode, 0); // MATCH (never rely on the default)
  logic.menuCmd('set', MATCH_ROWS.surface, SURFACES[m.surface]);
  logic.menuCmd('set', MATCH_ROWS.assist, 0); // Off
  logic.menuCmd('set', MATCH_ROWS.difficulty, DIFFICULTIES[m.difficulty]);
  logic.menuCmd('set', MATCH_ROWS.games, GAMES[m.games]);
  logic.menuCmd('go', 0, 0);
  logic.menuCmd('you', m.you, 0);
  logic.menuCmd('opp', m.opp, 0);
  logic.menuCmd('go', 0, 0);

  const t0 = performance.now();
  let steps = 0;
  while (!state.done && steps < maxSteps) {
    logic.fixedUpdate(DT);
    steps++;
  }
  const wallMs = performance.now() - t0;
  const raw = logic.getMatchStats();
  const report = raw === '' ? null : JSON.parse(raw);
  return { ...m, steps, wall_ms: Math.round(wallMs), timed_out: !state.done, report };
}

function validateMatch(m, i) {
  const fail = (msg) => { console.error(`matches[${i}]: ${msg}`); process.exit(1); };
  if (!Number.isInteger(m.seed)) fail('seed must be an integer');
  if (!(m.surface in SURFACES)) fail(`surface must be one of ${Object.keys(SURFACES)}`);
  if (!(m.difficulty in DIFFICULTIES)) fail(`difficulty must be one of ${Object.keys(DIFFICULTIES)}`);
  if (!(String(m.games) in GAMES)) fail('games must be 2, 4 or 6');
  if (!Number.isInteger(m.you) || m.you < 0 || m.you > 4) fail('you must be 0..4');
  if (!Number.isInteger(m.opp) || m.opp < 0 || m.opp > 4) fail('opp must be 0..4');
}

// Doc-03 invariants; violations warn (never fatal mid-study).
function sanityCheck(result) {
  const r = result.report;
  if (!r) return;
  const warn = (msg) => console.error(`sanity[seed=${result.seed}]: ${msg}`);
  if (r.points.length !== r.points_played) warn('points.length != points_played');
  const rallySum = r.points.reduce((a, p) => a + p.rally_shots, 0);
  if (rallySum !== r.total_rally_shots) warn('rally_shots sum mismatch');
  if (r.p.first_serves + r.c.first_serves < r.points_played) warn('first_serves < points_played');
  for (const p of r.points) {
    if (p.end_kind === 'double_fault' && p.serve_number !== 2) warn('DF on 1st serve');
    if (p.end_kind === 'other') warn('end_kind=other (attribution gap)');
    if (!(p.duration_s > 0)) warn('non-positive point duration');
  }
  if (r.finished) {
    const target = result.games;
    const hi = Math.max(r.games_p, r.games_c);
    if (hi < target) warn(`winner has ${hi} games < requested target ${target} (bootstrap failed?)`);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

  if (has('--bench')) {
    const spec = { seed: 1, you: 4, opp: 4, surface: 'hard', difficulty: 'hard', games: 4 };
    const STEPS = 240 * 120; // 2 sim-minutes, fixed (matches never finish on defaults)
    runMatch(spec, {}, STEPS); // unmeasured warm-up (JIT/module init)
    const r = runMatch(spec, {}, STEPS);
    const sps = r.steps / (r.wall_ms / 1000);
    console.error(`bench: ${r.steps} steps in ${r.wall_ms} ms = ${Math.round(sps)} steps/s (${Math.round(sps / 240)}x realtime)`);
    process.stdout.write(JSON.stringify({ runner_version: RUNNER_VERSION, bench_steps_per_s: Math.round(sps) }) + '\n');
    return;
  }

  if (has('--golden')) {
    const dir = arg('--golden');
    if (!dir) { console.error('--golden needs a directory'); process.exit(1); }
    mkdirSync(dir, { recursive: true });
    const GOLDEN_STEPS = 240 * 300; // 5 sim-minutes partial report; no completion needed
    const pairs = [[4, 4], [0, 3], [1, 2]]; // Ace/Ace, Boom/Sly, Rojo/Dash
    let n = 0;
    for (const surface of Object.keys(SURFACES)) {
      for (const [you, opp] of pairs) {
        for (let seed = 1000; seed <= 1002; seed++) {
          const res = runMatch({ seed, you, opp, surface, difficulty: 'hard', games: 4 }, {}, GOLDEN_STEPS);
          const file = join(dir, `${surface}-${you}${opp}-${seed}.json`);
          writeFileSync(file, JSON.stringify(res.report) + '\n');
          n++;
        }
      }
    }
    console.error(`golden: wrote ${n} reports to ${dir}`);
    return;
  }

  const jobPath = arg('--job');
  const jobText = jobPath ? readFileSync(jobPath, 'utf8') : readFileSync(0, 'utf8');
  let job;
  try {
    job = JSON.parse(jobText);
  } catch (e) {
    console.error(`bad job JSON: ${e.message}`);
    process.exit(1);
  }
  const params = job.params ?? {};
  const maxSteps = job.max_steps ?? 600000;
  if (!Array.isArray(job.matches) || job.matches.length === 0) {
    console.error('job.matches must be a non-empty array');
    process.exit(1);
  }
  job.matches.forEach(validateMatch);

  const results = [];
  for (const m of job.matches) {
    const res = runMatch(m, params, maxSteps);
    sanityCheck(res);
    results.push(res);
  }
  process.stdout.write(JSON.stringify({ runner_version: RUNNER_VERSION, results }) + '\n');
}

main();
