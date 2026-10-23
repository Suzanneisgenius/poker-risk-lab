#!/usr/bin/env node
// Do the session estimates hold up when sessions differ in length?
//
//   node checks/session-lengths/run.js            # print
//   node checks/session-lengths/run.js --write    # also save results.json
//   node checks/session-lengths/run.js --check    # compare with results.json
//
// Simulates histories of 150 sessions with known win rate (+3 bb/100) and
// volatility (90 bb/100) under four length patterns and four ways results can
// arrive, and runs each history through the page's own estimator
// (standalone/shared/sessions.js). Reported per cell:
//  - error of the hands-weighted win rate, against the plain average of the
//    sessions' win rates;
//  - the weighted volatility, against the naive one (spread of session win
//    rates scaled to the average session length);
//  - how often the 95% interval (win rate +/- 1.96 standard errors, as the page
//    shows with no prior) covers the true win rate: as is; widened by the lag-1
//    correlation of the session win rates whenever it is positive (the rule
//    src/inference.py used until 2026-10-22); and widened by the between-block
//    standard error when the stability check flags (the page's rule, and
//    src/inference.py's since then);
//  - how often the page's two checks flag (spread against length, stability),
//    and how often a lag-1 test of the raw session win rates would.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const S = require("../../standalone/shared/sessions.js");
const Stats = require("../../standalone/shared/stats.js");

const SEED = 20261022;
const HISTORIES = 4000;
const SESSIONS = 150;
const WIN_RATE = 3;
const SD = 90;

// sfc32 with Box-Muller normals: small, fast and good enough for a study.
function generator(seed) {
  let a = seed | 0, b = 0x9e3779b9, c = 0x243f6a88, d = 1;
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 16; i++) next();
  let spare = null;
  const normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0; while (u <= 1e-12) u = next();
    const v = next(), m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
  return { uniform: next, normal };
}

const PATTERNS = {
  equal: { label: "All 500 hands", draw: () => 500 },
  uniform: { label: "100 to 1,500 hands, evenly spread", draw: (g) => 100 + Math.floor(g.uniform() * 1401) },
  lognormal: { label: "Skewed: median 400, 5–95% about 80–2,000", draw: (g) => Math.min(10000, Math.max(20, Math.round(400 * Math.exp(g.normal())))) },
  mixed: { label: "70% short (30–150), 30% long (1,500–4,000)", draw: (g) => (g.uniform() < 0.7 ? 30 + Math.floor(g.uniform() * 121) : 1500 + Math.floor(g.uniform() * 2501)) },
};

// Each returns profit for a session of h hands; `state` carries a drifting win rate.
const MODELS = {
  model: { label: "As the model assumes", profit: (g, h) => (WIN_RATE * h) / 100 + SD * Math.sqrt(h / 100) * g.normal() },
  sessionEffect: {
    label: "Extra swing per session (SD 80 bb, any length)",
    profit: (g, h) => (WIN_RATE * h) / 100 + SD * Math.sqrt(h / 100) * g.normal() + 80 * g.normal(),
  },
  drift: {
    label: "Win rate drifts between sessions (AR(1), 0.9, SD 10)",
    profit: (g, h, state) => {
      state.rate = WIN_RATE + 0.9 * ((state.rate ?? WIN_RATE) - WIN_RATE) + 10 * Math.sqrt(1 - 0.81) * g.normal();
      return (state.rate * h) / 100 + SD * Math.sqrt(h / 100) * g.normal();
    },
  },
  heavyTails: {
    label: "Heavy-tailed sessions (Student t, 4 df, same variance)",
    profit: (g, h) => {
      const chi4 = -2 * Math.log(Math.max(1e-300, g.uniform() * g.uniform()));
      return (WIN_RATE * h) / 100 + SD * Math.sqrt(h / 100) * (g.normal() / Math.sqrt(chi4 / 4)) / Math.SQRT2;
    },
  },
};

// The lag-1 correlation src/inference.py used until 2026-10-22: of the raw session win rates.
function rawRateRho(sessions) {
  const r = S.chronological(sessions).map((s) => (100 * s.profit) / s.hands);
  const x = r.slice(0, -1), y = r.slice(1), n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

function cell(patternKey, modelKey, index) {
  const g = generator(SEED + 1009 * index);
  const z = 1.959963984540054;
  const sums = { errW: 0, sqW: 0, sqU: 0, sd: 0, sdNaive: 0, cover: 0, coverPy: 0, coverPage: 0, coverBlocks: 0, scaling: 0, scalingTested: 0, stability: 0, rawFlag: 0 };
  for (let rep = 0; rep < HISTORIES; rep++) {
    const state = {};
    const sessions = [];
    for (let i = 0; i < SESSIONS; i++) {
      const hands = PATTERNS[patternKey].draw(g);
      sessions.push({ hands, profit: MODELS[modelKey].profit(g, hands, state), order: i, date: null, stake: "", game: "" });
    }
    const est = S.summarize(sessions);
    const rates = sessions.map((s) => (100 * s.profit) / s.hands);
    const unweighted = rates.reduce((a, b) => a + b, 0) / SESSIONS;
    const rateSd = Math.sqrt(rates.reduce((a, r) => a + (r - unweighted) ** 2, 0) / (SESSIONS - 1));
    const err = est.winRate - WIN_RATE;
    sums.errW += err; sums.sqW += err * err; sums.sqU += (unweighted - WIN_RATE) ** 2;
    sums.sd += est.sd; sums.sdNaive += rateSd * Math.sqrt(est.lengths.mean / 100);
    const covers = (multiplier) => Math.abs(err) <= z * est.standardError * multiplier;
    const rawRho = rawRateRho(sessions);
    sums.cover += covers(1);
    sums.coverPy += covers(rawRho > 0 ? Math.sqrt((1 + rawRho) / (1 - rawRho)) : 1);
    sums.coverPage += covers(est.stability.flag ? est.stability.multiplier : 1);
    sums.coverBlocks += covers(est.stability.multiplier);
    if (est.scaling) { sums.scalingTested++; sums.scaling += est.scaling.flag; }
    sums.stability += est.stability.flag;
    sums.rawFlag += rawRho > 0 && 1 - Stats.phi(rawRho * Math.sqrt(SESSIONS)) < 0.05;
  }
  const r4 = (v) => Math.round(v * 10000) / 10000;
  return {
    pattern: patternKey, model: modelKey,
    win_rate: { bias: r4(sums.errW / HISTORIES), rmse_weighted: r4(Math.sqrt(sums.sqW / HISTORIES)), rmse_unweighted: r4(Math.sqrt(sums.sqU / HISTORIES)) },
    volatility: { mean_weighted: r4(sums.sd / HISTORIES), mean_naive: r4(sums.sdNaive / HISTORIES) },
    coverage_95: { as_is: r4(sums.cover / HISTORIES), widened_by_lag1: r4(sums.coverPy / HISTORIES),
      widened_by_blocks_when_flagged: r4(sums.coverPage / HISTORIES), widened_by_blocks_always: r4(sums.coverBlocks / HISTORIES) },
    flags: {
      spread_against_length: sums.scalingTested ? r4(sums.scaling / sums.scalingTested) : null,
      stability: r4(sums.stability / HISTORIES),
      lag1_on_raw_rates: r4(sums.rawFlag / HISTORIES),
    },
  };
}

const started = Date.now();
const cells = [];
let index = 0;
for (const pattern of Object.keys(PATTERNS)) for (const model of Object.keys(MODELS)) cells.push(cell(pattern, model, index++));
const result = {
  purpose: "Simulation check of the hands-weighted session estimates and the page's two model checks under unequal session lengths.",
  command: "node checks/session-lengths/run.js --check",
  settings: { seed: SEED, histories_per_cell: HISTORIES, sessions_per_history: SESSIONS, true_win_rate_bb100: WIN_RATE, true_volatility_bb100: SD,
    coverage_monte_carlo_se: Math.round(Math.sqrt(0.95 * 0.05 / HISTORIES) * 10000) / 10000 },
  patterns: Object.fromEntries(Object.entries(PATTERNS).map(([k, v]) => [k, v.label])),
  models: Object.fromEntries(Object.entries(MODELS).map(([k, v]) => [k, v.label])),
  cells,
};
const text = JSON.stringify(result, null, 1) + "\n";
const file = path.join(__dirname, "results.json");
if (process.argv.includes("--check")) {
  if (fs.readFileSync(file, "utf8") !== text) { console.error("Results differ from checks/session-lengths/results.json."); process.exit(1); }
  console.log(`Results match checks/session-lengths/results.json (${Math.round((Date.now() - started) / 1000)} s).`);
} else {
  if (process.argv.includes("--write")) fs.writeFileSync(file, text);
  const pct = (v) => (v == null ? "  —  " : (v * 100).toFixed(1).padStart(5) + "%");
  console.log("pattern    model           RMSE w/unw   sd w / naive   cover   lag1  blocks always  spread stable  lag1");
  for (const c of cells) {
    console.log(`${c.pattern.padEnd(10)} ${c.model.padEnd(14)} ${c.win_rate.rmse_weighted.toFixed(2).padStart(5)} / ${c.win_rate.rmse_unweighted.toFixed(2).padStart(5)}  `
      + `${c.volatility.mean_weighted.toFixed(1).padStart(5)} / ${c.volatility.mean_naive.toFixed(1).padStart(5)}  `
      + `${pct(c.coverage_95.as_is)} ${pct(c.coverage_95.widened_by_lag1)} ${pct(c.coverage_95.widened_by_blocks_when_flagged)} ${pct(c.coverage_95.widened_by_blocks_always)}  `
      + `${pct(c.flags.spread_against_length)} ${pct(c.flags.stability)} ${pct(c.flags.lag1_on_raw_rates)}`);
  }
  console.log(`${Math.round((Date.now() - started) / 1000)} s`);
}
