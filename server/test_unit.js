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
  simulationPathSteps,
  brownFinite,
  logPhi,
  MAX_EQUITY_EVALUATIONS,
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
assert.equal(estimateCost("equity", { hero: aceKing, opponents: [null], board: [], trials: 30000 }), 3);
assert.equal(
  estimateCost("equity", { hero: aceKing, opponents: [null, null, null, null, null], board: [], trials: 150000 }),
  1 + Math.ceil(MAX_EQUITY_EVALUATIONS / 50000),
  "five-way requests are charged for their capped trial count",
);
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
const capped = computeEquity({ hero: aceKing, opponents: [null, null, null, null, null], board: [0, 14, 28, 42], trials: 150000, seed: 3 });
assert.equal(capped.result.trials, MAX_EQUITY_EVALUATIONS / 6);
assert.match(capped.methodText, /capped from 150,000/);

// --- Error types ---------------------------------------------------------------
for (const [type, input] of [
  ["ev", { pot: -1, call: 5, equityPct: 40 }],
  ["ev", []],
  ["equity", { hero: [51, 51], opponents: [null] }],
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
  const match = page.match(new RegExp(`clamp\\(parseInt\\(\\$\\('${id}'\\)\\.value\\)\\|\\|\\d+,\\d+,(\\d+)\\)`));
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
