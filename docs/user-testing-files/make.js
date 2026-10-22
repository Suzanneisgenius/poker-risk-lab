#!/usr/bin/env node
// Writes the Risk Lab comparison files used in Task 3 of docs/user-testing-plan.md:
//   node docs/user-testing-files/make.js
"use strict";

const fs = require("fs");
const path = require("path");
const { compute } = require("../../server/compute.js");

const NOTE = "Difference of point estimates. Intervals describe Monte Carlo error only; no interval or significance test is given for the difference.";

// Same shape as labComparisonRecord in standalone/build/app.js.
function scenario(name, params, metrics, model) {
  return {
    name,
    inputs: { winrate_bb100: params.wr, std_bb100: params.sd, bankroll_bi: params.bank / 100, ruin_threshold_bi: params.thr / 100, hands: params.hands, paths: params.paths, seed: params.seed },
    results: { risk_of_ruin: metrics.risk, ci95_low: metrics.confidenceInterval[0], ci95_high: metrics.confidenceInterval[1], survival: metrics.survival, p95_max_drawdown_bi: metrics.p95Drawdown },
    model,
  };
}
function record(savedAt, a, b) {
  return {
    type: "poker-analytics/risk-lab-comparison", schema_version: 1, saved_at: savedAt, a, b,
    difference: { risk_b_minus_a_pp: (b.results.risk_of_ruin - a.results.risk_of_ruin) * 100, changed_inputs: ["Win rate"], note: NOTE },
  };
}
const current = (wr, seed) => {
  const result = compute("risk-lab", { wr, sd: 90, bank: 3000, hands: 100000, paths: 2000, seed, includeCurve: false });
  return [result.params, result.metrics, result.model];
};

// Outputs of the functional-fix engine (commit a176da7, computeRiskLab, seed 42).
// That version could not save comparisons and had no version field, so these real
// outputs are wrapped in the current file format with the version filled in by hand.
const oldModel = { name: "bankroll-monte-carlo", version: "2026-10-05", ruinMonitoring: "at 100-hand step ends", randomNumbers: "one mulberry32 stream for all paths" };
const oldParams = (wr) => ({ wr, sd: 90, bank: 3000, thr: 0, hands: 100000, paths: 2000, step: 100, seed: 42 });
const oldA = { risk: 0.2775, confidenceInterval: [0.2583165599610281, 0.2975365573712002], survival: 0.7225, p95Drawdown: 45.690075332932196 };
const oldB = { risk: 0.0785, confidenceInterval: [0.06750412746874632, 0.0911120026684861], survival: 0.9215, p95Drawdown: 39.8343685689615 };

const files = {
  "1-earlier-engine.json": record("2026-10-06T10:00:00.000Z",
    scenario("Break-even", oldParams(0), oldA, oldModel), scenario("+3 bb/100", oldParams(3), oldB, oldModel)),
  "2-seed-7.json": record("2026-10-22T10:00:00.000Z",
    scenario("Break-even, seed 7", ...current(0, 7)), scenario("+3 bb/100, seed 7", ...current(3, 7))),
};
// The current engine's seed-42 result with B's risk changed by hand after saving.
// The edit is consistent (survival and the 95% interval changed to match), so
// the import accepts it and only recomputing shows that it does not match.
const wilson = (p, n, z = 1.96) => {
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
};
const edited = record("2026-10-22T10:05:00.000Z", scenario("Break-even", ...current(0, 42)), scenario("+3 bb/100", ...current(3, 42)));
edited.b.results.risk_of_ruin = 0.0535;
edited.b.results.survival = 1 - 0.0535;
[edited.b.results.ci95_low, edited.b.results.ci95_high] = wilson(0.0535, edited.b.inputs.paths);
edited.difference.risk_b_minus_a_pp = (edited.b.results.risk_of_ruin - edited.a.results.risk_of_ruin) * 100;
files["3-edited-by-hand.json"] = edited;

for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(__dirname, name), JSON.stringify(value, null, 2) + "\n");
// A file cut off part-way, as from an interrupted download.
fs.writeFileSync(path.join(__dirname, "4-broken.json"), JSON.stringify(files["2-seed-7.json"], null, 2).slice(0, 400));
console.log(`Wrote ${Object.keys(files).length + 1} files to ${path.relative(process.cwd(), __dirname)}`);
