#!/usr/bin/env node
// Reproduces the figures in CHANGELOG.md ("Read this first: the bankroll
// numbers changed") and saves them with their settings and seeds.
//
//   node checks/calculation-change-2026-10-21/run.js           print the results
//   node checks/calculation-change-2026-10-21/run.js --write   also save results.json
//   node checks/calculation-change-2026-10-21/run.js --check   compare with results.json
//
// --first N --count N --stride N choose the seeds for the multi-seed part
// (default 0 40 1, i.e. seeds 0–39). Results are deterministic; the run takes
// a few seconds.
"use strict";

const fs = require("fs");
const path = require("path");
const { simulateBankroll, brownFinite, BANKROLL_MODEL } = require("../../server/compute.js");

const SETTINGS = Object.freeze({
  bankroll_bi: 30,
  bankroll_bb: 3000,
  ruin_threshold_bb: 0,
  std_bb100: 90,
  hands: 100000,
  step_hands: 100,
  paths: 2000,
  winrates_bb100: [0, 3],
  single_seed: 42,
});

// --- functional-fix (2026-10-05) engine -------------------------------------
// The random stream and ruin check of that version, copied from server/compute.js
// at commit a176da7 (mulberry32, gaussFactory, simulateBankroll). All paths draw
// from one shared stream. Drawdowns and stored paths are left out: they change
// neither which numbers are drawn nor which paths are ruined.
function mulberry32(seed) {
  let value = seed | 0;
  return function random() {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function oldGaussFactory(seed) {
  const random = mulberry32(seed >>> 0);
  let spare = null;
  return function gaussian() {
    if (spare !== null) {
      const saved = spare;
      spare = null;
      return saved;
    }
    let u = 0;
    while (u <= 1e-12) u = random();
    const v = random();
    const magnitude = Math.sqrt(-2 * Math.log(u));
    spare = magnitude * Math.sin(2 * Math.PI * v);
    return magnitude * Math.cos(2 * Math.PI * v);
  };
}

function oldRuinedCount(params) {
  const steps = Math.ceil(params.hands / params.step);
  const finalStep = params.hands - (steps - 1) * params.step;
  const regularDrift = (params.wr * params.step) / 100;
  const regularSwing = params.sd * Math.sqrt(params.step / 100);
  const finalDrift = (params.wr * finalStep) / 100;
  const finalSwing = params.sd * Math.sqrt(finalStep / 100);
  const gaussian = oldGaussFactory(params.seed);
  let ruinedCount = 0;
  for (let index = 0; index < params.paths; index += 1) {
    let bankroll = params.bank;
    for (let step = 1; step <= steps; step += 1) {
      const isFinalStep = step === steps;
      bankroll += (isFinalStep ? finalDrift : regularDrift) + (isFinalStep ? finalSwing : regularSwing) * gaussian();
      if (bankroll <= params.thr) {
        ruinedCount += 1;
        break;
      }
    }
  }
  return ruinedCount;
}

// --- helpers -----------------------------------------------------------------
const params = (wr, seed) => ({
  wr,
  sd: SETTINGS.std_bb100,
  bank: SETTINGS.bankroll_bb,
  thr: SETTINGS.ruin_threshold_bb,
  hands: SETTINGS.hands,
  paths: SETTINGS.paths,
  step: SETTINGS.step_hands,
  seed,
});
const ruined = (wr, seed, bridge) => simulateBankroll(params(wr, seed), SETTINGS.paths, 0, { bridge }).ruinedCount;
const round = (value, digits = 6) => Number(value.toFixed(digits));

function wilson(successes, total, z = 1.959963984540054) {
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  return [round(centre - half), round(centre + half)];
}

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  if (at < 0) return fallback;
  const value = Number(process.argv[at + 1]);
  if (!Number.isInteger(value)) throw new Error(`${name} needs an integer`);
  return value;
}

// --- run ---------------------------------------------------------------------
function run({ first, count, stride }) {
  const seeds = Array.from({ length: count }, (_, i) => first + i * stride);
  const singleSeed = SETTINGS.winrates_bb100.map((wr) => {
    const seed = SETTINGS.single_seed;
    const before = oldRuinedCount(params(wr, seed));
    const endpoint = ruined(wr, seed, false);
    const bridge = ruined(wr, seed, true);
    const n = SETTINGS.paths;
    return {
      winrate_bb100: wr,
      functional_fix_2026_10_05: { ruined: before, risk: before / n, wilson95: wilson(before, n) },
      new_streams_endpoint_only: { ruined: endpoint, risk: endpoint / n, wilson95: wilson(endpoint, n) },
      model_2026_10_21: { ruined: bridge, risk: bridge / n, wilson95: wilson(bridge, n) },
      random_stream_change_pp: round(((endpoint - before) / n) * 100, 4),
      bridge_change_pp: round(((bridge - endpoint) / n) * 100, 4),
      total_change_pp: round(((bridge - before) / n) * 100, 4),
    };
  });

  const perSeed = [];
  const multiSeed = SETTINGS.winrates_bb100.map((wr) => {
    const rows = seeds.map((seed) => {
      const row = { winrate_bb100: wr, seed, ruined_endpoint_only: ruined(wr, seed, false), ruined_bridge: ruined(wr, seed, true) };
      perSeed.push(row);
      return row;
    });
    const n = SETTINGS.paths;
    const risks = rows.map((r) => r.ruined_bridge / n);
    const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
    const meanBridge = mean(risks);
    const sd = Math.sqrt(risks.reduce((a, r) => a + (r - meanBridge) ** 2, 0) / (risks.length - 1));
    const increases = rows.map((r) => ((r.ruined_bridge - r.ruined_endpoint_only) / n) * 100);
    const analytical = brownFinite(wr, SETTINGS.std_bb100, SETTINGS.bankroll_bb, SETTINGS.ruin_threshold_bb, SETTINGS.hands);
    return {
      winrate_bb100: wr,
      mean_risk_endpoint_only: round(mean(rows.map((r) => r.ruined_endpoint_only / n)), 8),
      mean_risk_bridge: round(meanBridge, 8),
      standard_error_of_mean_bridge_pp: round((sd / Math.sqrt(rows.length)) * 100, 4),
      mean_bridge_increase_pp: round(mean(increases), 4),
      bridge_increase_range_pp: [round(Math.min(...increases), 4), round(Math.max(...increases), 4)],
      seeds_where_bridge_lowered_risk: increases.filter((v) => v < 0).length,
      analytical_finite_horizon_brownian: round(analytical, 8),
      mean_bridge_minus_analytical_pp: round((meanBridge - analytical) * 100, 4),
    };
  });

  return {
    purpose: "Reproduce the bankroll calculation change described in CHANGELOG.md.",
    command: `node checks/calculation-change-2026-10-21/run.js --first ${first} --count ${count} --stride ${stride}`,
    current_model: BANKROLL_MODEL.version,
    settings: SETTINGS,
    single_seed: { seed: SETTINGS.single_seed, rows: singleSeed },
    multi_seed: {
      seeds: { first, count, stride, list: seeds },
      paths_per_seed: SETTINGS.paths,
      note: "Paired runs: each seed is run with and without the bridge correction. The two runs share every path's random numbers, so the bridge run ruins every path the endpoint-only run ruins, plus the paths that dipped to the threshold between checkpoints.",
      rows: multiSeed,
      per_seed: perSeed,
    },
  };
}

const seeds = { first: option("--first", 0), count: option("--count", 40), stride: option("--stride", 1) };
const result = run(seeds);
const file = path.join(__dirname, "results.json");
const text = JSON.stringify(result, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const saved = fs.readFileSync(file, "utf8");
  if (saved !== text) {
    console.error(`Results differ from ${path.relative(process.cwd(), file)}.`);
    process.exit(1);
  }
  console.log(`Results match ${path.relative(process.cwd(), file)}.`);
} else {
  if (process.argv.includes("--write")) fs.writeFileSync(file, text);
  const pct = (v) => (v * 100).toFixed(2) + "%";
  console.log(`Seed ${SETTINGS.single_seed}, ${SETTINGS.paths} paths:`);
  for (const r of result.single_seed.rows) {
    console.log(`  ${r.winrate_bb100} bb/100: ${pct(r.functional_fix_2026_10_05.risk)} → ${pct(r.new_streams_endpoint_only.risk)} (new streams, ${r.random_stream_change_pp} pp) → ${pct(r.model_2026_10_21.risk)} (bridge, +${r.bridge_change_pp} pp)`);
  }
  console.log(`Seeds ${seeds.first}… (${seeds.count} seeds, stride ${seeds.stride}), ${SETTINGS.paths} paths each:`);
  for (const r of result.multi_seed.rows) {
    console.log(`  ${r.winrate_bb100} bb/100: endpoint ${pct(r.mean_risk_endpoint_only)}, bridge ${pct(r.mean_risk_bridge)} (±${r.standard_error_of_mean_bridge_pp} pp s.e.), +${r.mean_bridge_increase_pp} pp; analytical ${pct(r.analytical_finite_horizon_brownian)}`);
  }
}
