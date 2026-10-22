"use strict";

// Unit checks for the server modules that do not need a running HTTP server:
//   node server/test_unit.js

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  compute,
  computeBankroll,
  computeEquity,
  computeGto,
  estimateCost,
  simulateBankroll,
  simulationPathSteps,
  brownFinite,
  logPhi,
  MAX_PATH_STEPS,
} = require("./compute.js");
const { clientIp } = require("./client_ip.js");
const { ValidationError } = require("./errors.js");

function closeRelative(actual, expected, tolerance, label) {
  assert.ok(Number.isFinite(actual), `${label}: expected a finite number, got ${actual}`);
  assert.ok(
    Math.abs(actual - expected) <= tolerance * Math.abs(expected),
    `${label}: got ${actual}, expected ${expected} (relative tolerance ${tolerance})`,
  );
}

// --- Brownian first-passage reference -------------------------------------
// Expected values come from the same formula evaluated with Python's
// double-precision math.erfc (the Python engine uses scipy's log_ndtr).
const logPhiReference = [
  [-30, -454.3212439563431],
  [-10, -53.23128515051246],
  [-3, -6.607726221510348],
  [0, -0.6931471805599453],
  [2, -0.02301290932896349],
];
for (const [x, expected] of logPhiReference) closeRelative(logPhi(x), expected, 1e-6, `logPhi(${x})`);
assert.ok(Math.abs(logPhi(8)) < 1e-12, "logPhi(8) should be ~0");
assert.ok(Number.isFinite(logPhi(-1e5)), "logPhi must not underflow far in the lower tail");
assert.ok(Math.abs(logPhi(40)) < 1e-300, "logPhi(40) should be 0");

const brownianReference = [
  [[3, 90, 3000, 0, 100000], 0.0716915021207792],
  [[-5, 90, 3000, 0, 100000], 0.8591651929969678],
  [[0, 90, 3000, 0, 100000], 0.2918405451437886],
  [[10, 50, 2000, 0, 1000000], 1.1253517471925912e-07],
  [[2, 100, 500, 100, 50000], 0.7818337881965545],
  [[-5, 90, 30000, 0, 1000000], 0.9906190216815429],
];
for (const [args, expected] of brownianReference) {
  closeRelative(brownFinite(...args), expected, 1e-5, `brownFinite(${args.join(", ")})`);
}

// Negative drift with a huge bankroll over a short horizon: the reflection
// factor overflows to Infinity in linear space. The old code returned 1 here.
const shortHorizon = brownFinite(-50, 10, 1000000, 0, 100);
assert.ok(shortHorizon >= 0 && shortHorizon < 1e-12, `short-horizon ruin should be ~0, got ${shortHorizon}`);
const overflowCase = computeBankroll({ wr: -50, sd: 10, bank: 1000000, thr: 0, hands: 100, paths: 100, seed: 1 });
assert.equal(overflowCase.metrics.risk, 0);
assert.ok(overflowCase.metrics.brownian < 1e-12, "Brownian reference must agree with Monte Carlo when ruin is impossible");
for (const value of overflowCase.curve.analytical) assert.ok(value >= 0 && value <= 1);
// Strong positive drift and strong negative drift stay inside [0, 1].
const tinyRisk = brownFinite(100, 5, 10, 0, 1000000);
assert.ok(tinyRisk > 0 && tinyRisk < 1e-30, `expected a tiny positive risk, got ${tinyRisk}`);
closeRelative(brownFinite(-100, 10, 100, 0, 1000000), 1, 1e-12, "certain ruin");

// --- Brownian-bridge correction -----------------------------------------------
// Endpoint-only monitoring misses dips to the threshold inside a 100-hand step
// and underestimates first-passage risk; the bridge correction removes that
// bias. Short-bankroll case: 3 BI, 0 bb/100, 20k hands.
{
  const scenario = { wr: 0, sd: 90, bank: 300, thr: 0, hands: 20000, step: 100, seed: 11 };
  const paths = 40000;
  const benchmark = brownFinite(scenario.wr, scenario.sd, scenario.bank, scenario.thr, scenario.hands);
  const se = Math.sqrt(benchmark * (1 - benchmark) / paths);
  const bridged = simulateBankroll(scenario, paths, 0).ruinedCount / paths;
  const endpoint = simulateBankroll(scenario, paths, 0, { bridge: false }).ruinedCount / paths;
  assert.ok(Math.abs(bridged - benchmark) < 4 * se, `bridge-corrected ${bridged} should match the continuous benchmark ${benchmark}`);
  assert.ok(endpoint < benchmark - 10 * se, `endpoint-only ${endpoint} should be clearly below ${benchmark}`);
  // Same paths, same swings: the bridge can only add ruins, never remove them.
  for (const seed of [1, 2, 3]) {
    const params = { wr: 2, sd: 100, bank: 2000, thr: 500, hands: 50000, step: 100, seed };
    assert.ok(simulateBankroll(params, 2000, 0).ruinedCount >= simulateBankroll(params, 2000, 0, { bridge: false }).ruinedCount);
  }
  // Reproducible for a seed, different across seeds; zero variance stays finite.
  const again = simulateBankroll(scenario, 2000, 0);
  assert.equal(again.ruinedCount, simulateBankroll(scenario, 2000, 0).ruinedCount);
  assert.notEqual(again.ruinedCount, simulateBankroll({ ...scenario, seed: 12 }, 2000, 0).ruinedCount);
  const flat = simulateBankroll({ wr: -10, sd: 0, bank: 500, thr: 0, hands: 10000, step: 100, seed: 1 }, 100, 0);
  assert.equal(flat.ruinedCount, 100, "a deterministic losing path is always ruined");
  assert.ok(Array.from(flat.terminals).every(Number.isFinite));
}

// --- Risk curve: common random numbers and pointwise intervals --------------------
for (const input of [
  { wr: 0, sd: 90, bank: 3000, thr: 0, hands: 100000, paths: 2000, seed: 42 },
  { wr: 3, sd: 90, bank: 1500, thr: 0, hands: 50000, paths: 6000, seed: 7 },
  { wr: -1, sd: 120, bank: 4000, thr: 1000, hands: 200000, paths: 100, seed: 0 },
]) {
  const { curve } = computeBankroll(input);
  assert.equal(curve.xs.length, 9);
  for (const key of ["monteCarlo", "lower", "upper", "analytical"]) assert.equal(curve[key].length, 9, `curve.${key}`);
  for (let i = 0; i < 9; i++) {
    assert.ok(curve.lower[i] <= curve.monteCarlo[i] && curve.monteCarlo[i] <= curve.upper[i], `point ${i} lies inside its interval`);
    if (i > 0) {
      assert.ok(curve.xs[i] > curve.xs[i - 1]);
      assert.ok(curve.monteCarlo[i] <= curve.monteCarlo[i - 1], `risk must not rise with a larger bankroll (${JSON.stringify(input)}, point ${i})`);
    }
  }
}

// --- Client IP resolution --------------------------------------------------
const fakeRequest = (forwarded) => ({
  headers: forwarded === undefined ? {} : { "x-forwarded-for": forwarded },
  socket: { remoteAddress: "10.0.0.5" },
});
assert.equal(clientIp(fakeRequest("198.51.100.7"), 0), "10.0.0.5", "hops=0 ignores the header");
assert.equal(clientIp(fakeRequest("198.51.100.7, 203.0.113.9"), 1), "203.0.113.9", "hops=1 trusts only the entry the proxy appended");
assert.equal(clientIp(fakeRequest(" 198.51.100.7 ,203.0.113.9 , 10.1.1.1"), 2), "203.0.113.9");
assert.equal(clientIp(fakeRequest("203.0.113.9"), 2), "10.0.0.5", "a chain shorter than the trusted hops falls back to the socket");
assert.equal(clientIp(fakeRequest(undefined), 1), "10.0.0.5");
assert.equal(clientIp(fakeRequest(""), 1), "10.0.0.5");

// --- Work-proportional rate-limit cost --------------------------------------
const aceKing = [12, 11];
assert.equal(estimateCost("ev", { pot: 10, call: 5, equityPct: 40 }), 1);
assert.equal(estimateCost("preflop", {}), 1);
assert.equal(estimateCost("equity", { hero: aceKing, opponents: [null], board: [], trials: 30000 }), 2);
assert.equal(
  estimateCost("equity", { hero: aceKing, opponents: [null, null, null, null, null], board: [], trials: 150000 }),
  2,
  "the largest multiway request is 900k evaluations",
);
assert.equal(
  estimateCost("equity", { hero: aceKing, opponents: [[51, 38]], board: [] }),
  5,
  "exact heads-up preflop enumerates 1,712,304 runouts (two evaluations each)",
);
// Ranges: exact on the flop (hero once per runout plus every live combo per
// runout), stratified Monte Carlo preflop, exact preflop for a single combo.
const everyHand = "22+, A2+, K2+, Q2+, J2+, T2+, 92+, 82+, 72+, 62+, 52+, 42+, 32";
const flopCards = [10, 18, 0]; // Qc 7d 2c
assert.equal(estimateCost("equity", { hero: aceKing, opponents: [{ range: everyHand }], board: flopCards }), 3, "1,081 combos × 990 runouts + 1,081 hero scores");
assert.equal(estimateCost("equity", { hero: aceKing, opponents: [{ range: "QQ+, AK" }], board: [], trials: 30000 }), 2);
assert.equal(estimateCost("equity", { hero: aceKing, opponents: [{ range: "QsQd" }], board: [] }), 5, "one combo preflop is enumerated exactly");
assert.equal(estimateCost("equity", { hero: aceKing, opponents: [{ range: "AKx" }], board: [] }), 1, "an unreadable range costs the minimum");
assert.equal(estimateCost("equity", { hero: [1, 1], opponents: [null] }), 1, "invalid input costs the minimum");
assert.equal(estimateCost("equity", null), 1);
assert.equal(estimateCost("bankroll", { wr: 3, sd: 90, bank: 3000, hands: 100000, paths: 6000 }), 7);
const quickLab = estimateCost("risk-lab", { wr: 3, sd: 90, bank: 3000, hands: 100000, paths: 2000 });
const detailedLab = estimateCost("risk-lab", { wr: 3, sd: 90, bank: 3000, hands: 300000, paths: 16000 });
assert.ok(quickLab < detailedLab, "longer horizons and more paths must cost more");
assert.ok(detailedLab <= 100, "the UI's most detailed Risk Lab run must still fit in one minute's budget");
assert.ok(
  estimateCost("risk-lab", { wr: 3, sd: 90, bank: 3000, hands: 300000, paths: 2000 })
    > estimateCost("risk-lab", { wr: 3, sd: 90, bank: 3000, hands: 20000, paths: 2000 }),
  "cost grows with hands, not only with paths",
);
assert.equal(estimateCost("gto", { iterations: 300000 }), 8);
assert.ok(estimateCost("gto", { iterations: 500000 }) > estimateCost("gto", { iterations: 100000 }));

// --- Work ceilings -----------------------------------------------------------
assert.throws(
  () => computeBankroll({ wr: 3, sd: 90, bank: 3000, hands: 1000000, paths: 20000 }),
  (error) => error instanceof ValidationError && /Paths × hands/.test(error.message),
);
// The fast evaluator makes the largest equity requests cheap, so they run in
// full: exact heads-up preflop and an uncapped five-way Monte Carlo.
const timed = (run) => { const start = performance.now(); const value = run(); return { value, ms: performance.now() - start }; };
const preflop = timed(() => computeEquity({ hero: [12, 25], opponents: [[11, 24]], board: [] }));
assert.equal(preflop.value.result.method, "exact");
assert.equal(preflop.value.result.trials, 1712304);
closeRelative(preflop.value.result.equity, 0.82637, 1e-4, "AA vs KK exact preflop equity");
assert.ok(preflop.ms < 5000, `exact preflop enumeration took ${Math.round(preflop.ms)} ms`);
const fiveWay = timed(() => computeEquity({ hero: aceKing, opponents: [null, null, null, null, null], board: [], trials: 150000, seed: 3 }));
assert.equal(fiveWay.value.result.trials, 150000);
assert.match(fiveWay.value.methodText, /150,000 trials\.$/);
assert.ok(fiveWay.ms < 5000, `five-way 150k-trial run took ${Math.round(fiveWay.ms)} ms`);

const fullRange = timed(() => computeEquity({ hero: aceKing, opponents: [{ range: everyHand }], board: flopCards }));
assert.equal(fullRange.value.result.method, "exact");
assert.equal(fullRange.value.result.combos, 1081);
assert.equal(fullRange.value.range.text, everyHand, "the response carries the canonical range text");
assert.match(fullRange.value.methodText, /^Exact: 1,081 combos × 990 runouts each/);
assert.ok(fullRange.ms < 2000, `exact flop against every hand took ${Math.round(fullRange.ms)} ms`);
const preflopRange = timed(() => computeEquity({ hero: aceKing, opponents: [{ range: everyHand }], board: [], trials: 150000, seed: 3 }));
assert.equal(preflopRange.value.result.method, "monte-carlo");
assert.equal(preflopRange.value.result.groups.length, 169);
assert.match(preflopRange.value.methodText, /across the 169 hands in the range/);
assert.ok(preflopRange.ms < 5000, `preflop range run took ${Math.round(preflopRange.ms)} ms`);
const oneCombo = computeEquity({ hero: aceKing, opponents: [{ range: "QsQd" }], board: [] });
assert.match(oneCombo.methodText, /^Exact: 1 combo × 1,712,304 runouts each/);

// --- Error types ---------------------------------------------------------------
for (const [type, input] of [
  ["ev", { pot: -1, call: 5, equityPct: 40 }],
  ["ev", []],
  ["equity", { hero: [51, 51], opponents: [null] }],
  ["equity", { hero: aceKing, opponents: [{ range: "QQ+" }, null] }],
  ["equity", { hero: aceKing, opponents: [{ range: "AKx" }] }],
  ["equity", { hero: aceKing, opponents: [{ range: " , " }] }],
  ["equity", { hero: aceKing, opponents: [{ range: ["QQ"] }] }],
  ["equity", { hero: [12, 11], opponents: [{ range: "Ac2c" }], board: [] }],
  ["equity", { hero: aceKing, opponents: [{ range: "QQ" }], board: [12] }],
  ["bankroll", { wr: 3, sd: 90, bank: 100, thr: 200, hands: 1000, paths: 100 }],
  ["preflop", { scenarioId: "does-not-exist" }],
  ["unknown", {}],
]) {
  assert.throws(
    () => compute(type, input),
    (error) => error instanceof ValidationError && error.status === 400,
    `${type} should reject ${JSON.stringify(input)} with a ValidationError`,
  );
}

// --- Public page limits match the server -----------------------------------
// Checked against the built index.html, so run `npm run build` first.
const page = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const inputMax = (id) => {
  const match = page.match(new RegExp(`<input id="${id}"[^>]*\\smax="(\\d+)"`));
  assert.ok(match, `input #${id} should declare a max`);
  return Number(match[1]);
};
const clampMax = (id) => {
  // Accepts both `clamp(parseInt($('id').value)||d,min,max)` and `clamp(integerInput('id',d),min,max)`.
  const match = page.match(new RegExp(`clamp\\((?:parseInt\\(\\$\\('${id}'\\)\\.value\\)\\|\\|\\d+|integerInput\\('${id}',\\d+\\)),\\d+,(\\d+)\\)`));
  assert.ok(match, `#${id} should be clamped before it is sent`);
  return Number(match[1]);
};
const acceptsAtLimit = (run, limit, label) => {
  run(limit);
  assert.throws(() => run(limit + 1), ValidationError, `${label}: server should reject ${limit + 1}`);
};

const trialsLimit = inputMax("eq_trials");
assert.equal(clampMax("eq_trials"), trialsLimit, "equity trials clamp matches the input max");
acceptsAtLimit(
  (trials) => computeEquity({ hero: aceKing, opponents: [[0, 1]], board: [2, 3, 4, 5, 6], trials }),
  trialsLimit,
  "equity trials",
);
const iterationsLimit = inputMax("gto_iters");
assert.equal(clampMax("gto_iters"), iterationsLimit, "GTO iterations clamp matches the input max");
// Validation runs before training, so an over-limit request fails instantly.
assert.throws(() => computeGto({ iterations: iterationsLimit + 1 }), ValidationError);
assert.equal(estimateCost("gto", { iterations: iterationsLimit }) > 1, true, "GTO iterations at the input max are accepted");

// The page reduces bankroll paths with its own copy of the work formula; it
// must match the server's exactly, or users will hit 400s the UI promised away.
const frontendBudget = page.split("\n").filter((line) =>
  /^(const BK_MAX_PATH_STEPS=|function bankrollPathSteps\(|function maxBankrollPaths\()/.test(line)
);
assert.equal(frontendBudget.length, 3, "bankroll budget helpers should be present in the page");
const budget = new Function(
  "clamp",
  `${frontendBudget.join("\n")}\nreturn { BK_MAX_PATH_STEPS, bankrollPathSteps, maxBankrollPaths };`,
)((value, min, max) => Math.min(max, Math.max(min, value)));
assert.equal(budget.BK_MAX_PATH_STEPS, MAX_PATH_STEPS);
for (const hands of [100, 150, 99999, 100000, 250000, 333333, 500000, 1000000]) {
  for (const paths of [100, 1999, 2000, 5000, 6000, 20000]) {
    assert.equal(
      budget.bankrollPathSteps(hands, paths),
      simulationPathSteps({ hands, paths, step: 100 }, true),
      `path-step formula differs for ${hands} hands × ${paths} paths`,
    );
  }
  const maxPaths = budget.maxBankrollPaths(hands);
  assert.ok(simulationPathSteps({ hands, paths: maxPaths, step: 100 }, true) <= MAX_PATH_STEPS, `${hands} hands: ${maxPaths} paths must fit`);
  if (maxPaths < 20000) {
    assert.ok(simulationPathSteps({ hands, paths: maxPaths + 100, step: 100 }, true) > MAX_PATH_STEPS, `${hands} hands: the page should not cut paths further than needed`);
  }
}
assert.equal(budget.maxBankrollPaths(1000000), 5500);
assert.equal(budget.maxBankrollPaths(100000), 20000);

process.stdout.write("Brownian, client-IP, rate-limit cost, work-ceiling, error-type, and frontend-limit unit tests passed.\n");
