#!/usr/bin/env node
// The web side of the posterior bankroll check: the cases and what the page's
// calculation (server/bankroll_posterior.js) returns for them. run.py
// recomputes every number with the Python research code and scipy.
//
//   node checks/bankroll-posterior-python/ours.js           # print
//   node checks/bankroll-posterior-python/ours.js --write   # save web.json
//   node checks/bankroll-posterior-python/ours.js --check   # compare with web.json (CI)
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { computeBankrollPosterior, POSTERIOR_MODEL } = require("../../server/bankroll_posterior.js");

// One record of results seen under several sample sizes, priors and
// volatilities, plus cases that move the plan and the question.
const CASES = [
  { id: "40k-hands-plus-4-assumed-90", hands: 40000, winRate: 4, sd: 90, sdSource: "assumed", prior: "weak", bank: 30, horizon: 100000 },
  { id: "40k-hands-plus-4-tracker-85-no-prior", hands: 40000, winRate: 4, sd: 85, sdSource: "tracker", prior: "none", bank: 30, horizon: 100000 },
  { id: "case-study-50k-plus-3", hands: 50000, winRate: 3, sd: 90, prior: "weak", bank: 30, horizon: 100000 },
  { id: "5k-hands-plus-12-skeptical", hands: 5000, winRate: 12, sd: 110, prior: "skeptical", bank: 20, horizon: 50000 },
  { id: "2m-hands-threshold-1pct-95", hands: 2000000, winRate: 2.5, sd: 95, prior: "weak", bank: 50, thr: 10, horizon: 1000000, target: 1, credibility: 95 },
  { id: "losing-100k-minus-3", hands: 100000, winRate: -3, sd: 80, prior: "none", bank: 100, horizon: 200000, target: 10, credibility: 60 },
  { id: "200bb-buy-ins", hands: 300000, winRate: 1, sd: 130, prior: "weak", bank: 25, bbPerBuyIn: 200, horizon: 500000, target: 2, credibility: 90 },
  { id: "sample-size-100-at-95-and-99", hands: 20000, winRate: 6, sd: 100, prior: "none", bank: 40, horizon: 100000, margin: 1, sampleLevel: 95 },
  { id: "sample-size-half-bb-at-99", hands: 20000, winRate: 6, sd: 100, prior: "skeptical", bank: 40, horizon: 100000, margin: 0.5, sampleLevel: 99 },
  // From imported sessions: an estimated volatility with its interval, and a
  // standard error widened for a win rate that drifts.
  { id: "sessions-estimated-volatility", hands: 180412, winRate: 3.86, sd: 90.4, sdSource: "sessions", sdRange: [82.9, 99.6], prior: "weak", bank: 40, horizon: 200000 },
  { id: "sessions-widened-for-drift", hands: 180412, winRate: 3.86, sd: 90.4, sdSource: "sessions", sdRange: [82.9, 99.6], seMultiplier: 1.88, prior: "none", bank: 40, horizon: 200000 },
];

const cases = CASES.map(({ id, ...input }) => ({ id, input, result: computeBankrollPosterior(input) }));
const text = JSON.stringify({ model: POSTERIOR_MODEL, cases }, null, 1) + "\n";
const file = path.join(__dirname, "web.json");

if (process.argv.includes("--check")) {
  if (fs.readFileSync(file, "utf8") !== text) {
    console.error("The posterior bankroll results differ from checks/bankroll-posterior-python/web.json. If the change is intended, run with --write and re-run run.py.");
    process.exit(1);
  }
  console.log(`PASS: ${cases.length} posterior bankroll cases match web.json.`);
} else if (process.argv.includes("--write")) {
  fs.writeFileSync(file, text);
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
} else {
  process.stdout.write(text);
}
