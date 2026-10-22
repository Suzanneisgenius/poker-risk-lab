"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const port = 4197;
const base = `http://127.0.0.1:${port}`;

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "app.js")], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", CALC_WORKERS: "2", TRUST_PROXY_HOPS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => reject(new Error("Test server did not start.")), 8000);
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("exit", (code) => reject(new Error(`Test server exited with ${code}: ${stderr}`)));
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("listening")) {
        clearTimeout(timer);
        resolve(child);
      }
    });
  });
}

async function post(endpoint, body, headers = {}) {
  return fetch(`${base}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function main() {
  const publicPage = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const secretMarker of ["function equityMC", "function equityExact", "function simulateBankroll", "function trainKuhnTracked", "function rfiStrategy", "averageGameValue("]) {
    assert.equal(publicPage.includes(secretMarker), false, `public HTML leaked ${secretMarker}`);
  }

  const server = await startServer();
  try {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal((await fetch(`${base}/standalone/engines/equity.js`)).status, 404);
    assert.equal((await fetch(`${base}/server/preflop.js`)).status, 404);

    const ev = await post("/api/ev", { pot: 10, call: 5, equityPct: 40 });
    assert.equal(ev.status, 200);
    assert.equal(ev.headers.get("x-calculation-cache"), "MISS");
    const evResult = await ev.json();
    assert.equal(evResult.profitable, true);
    assert.ok(Math.abs(evResult.evCall - 1) < 1e-12);
    const cachedEv = await post("/api/ev", { pot: 10, call: 5, equityPct: 40 });
    assert.equal(cachedEv.status, 200);
    assert.equal(cachedEv.headers.get("x-calculation-cache"), "HIT");

    const equity = await post("/api/equity", {
      hero: [51, 38],
      opponents: [[50, 24]],
      board: [0, 14, 28, 42, 5],
      trials: 1000,
      seed: 42,
    });
    assert.equal(equity.status, 200);
    const equityResult = await equity.json();
    assert.equal(equityResult.result.method, "exact");
    assert.equal(equityResult.result.trials, 1);

    const duplicateCard = await post("/api/equity", {
      hero: [51, 51], opponents: [null], board: [], trials: 1000, seed: 42,
    });
    assert.equal(duplicateCard.status, 400);
    assert.equal((await duplicateCard.json()).error, "The same card cannot be used twice.");

    // Input errors raised inside the worker keep their 4xx status; the old
    // message-regex classification is gone.
    const tooManyPathSteps = await post("/api/bankroll", { wr: 3, sd: 90, bank: 3000, hands: 1000000, paths: 20000 });
    assert.equal(tooManyPathSteps.status, 400);
    assert.match((await tooManyPathSteps.json()).error, /Paths × hands/);
    const unknownScenario = await post("/api/preflop", { scenarioId: "does-not-exist" });
    assert.equal(unknownScenario.status, 400);
    const wrongType = await fetch(`${base}/api/ev`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
    assert.equal(wrongType.status, 415);
    const oversized = await post("/api/ev", { padding: "x".repeat(40000) });
    assert.equal(oversized.status, 413);
    const badJson = await fetch(`${base}/api/ev`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    assert.equal(badJson.status, 400);

    const foreignOrigin = await post("/api/ev", { pot: 10, call: 5, equityPct: 40 }, { Origin: "https://example.com" });
    assert.equal(foreignOrigin.status, 403);

    const risk = await post("/api/risk-lab", {
      wr: 3, sd: 90, bank: 3000, thr: 0, hands: 1000, paths: 100, seed: 42,
    });
    assert.equal(risk.status, 200);
    const riskResult = await risk.json();
    assert.equal(riskResult.fan.paths.length, 80);
    assert.equal(riskResult.fan.p50.length, riskResult.fan.xs.length);
    assert.equal(riskResult.curve.xs.length, 9);
    assert.equal(riskResult.curve.pathsPerPoint, 200);
    const detailedRisk = await post("/api/risk-lab", {
      wr: 3, sd: 90, bank: 3000, thr: 0, hands: 1000, paths: 100, seed: 42, includeCurve: false,
    });
    assert.equal(detailedRisk.status, 200);
    assert.equal((await detailedRisk.json()).curve, null);

    const preflop = await post("/api/preflop", { scenarioId: "cash-6max-100-btn-rfi-25" });
    assert.equal(preflop.status, 200);
    const preflopResult = await preflop.json();
    assert.equal(preflopResult.dataset.solverVerified, false);
    assert.equal(preflopResult.scenarios.length, 5);
    assert.equal(preflopResult.scenario.hands.length, 169);
    for (const hand of preflopResult.scenario.hands) {
      assert.equal(
        Object.values(hand.actions).reduce((total, frequency) => total + frequency, 0),
        100,
        `${hand.hand} action frequencies should total 100`,
      );
    }
    const a5s = preflopResult.scenario.hands.find((hand) => hand.hand === "A5s");
    assert.deepEqual(a5s.actions, { raise: 60, call: 0, jam: 0, fold: 40 });
    const jamRange = await post("/api/preflop", { scenarioId: "cash-6max-40-sb-vs-btn" });
    assert.equal(jamRange.status, 200);
    const jamResult = await jamRange.json();
    assert.ok(jamResult.scenario.hands.some((hand) => hand.actions.jam > 0));

    const limitHeaders = { "X-Forwarded-For": "203.0.113.10" };
    for (let request = 1; request <= 100; request += 1) {
      const withinLimit = await post("/api/ev", { pot: request, call: 1, equityPct: 50 }, limitHeaders);
      assert.equal(withinLimit.status, 200, `request ${request} should fit within the 100-point limit`);
    }
    const overLimit = await post("/api/ev", { pot: 101, call: 1, equityPct: 50 }, limitHeaders);
    assert.equal(overLimit.status, 429);
    assert.ok(Number(overLimit.headers.get("retry-after")) >= 1);

    // Forged entries to the left of the proxy-appended address must not open
    // a fresh bucket: all of these belong to 203.0.113.20.
    for (let request = 1; request <= 100; request += 1) {
      const forged = { "X-Forwarded-For": `198.51.100.${request}, 203.0.113.20` };
      const withinLimit = await post("/api/ev", { pot: 1000 + request, call: 1, equityPct: 50 }, forged);
      assert.equal(withinLimit.status, 200, `forged request ${request} should share one bucket`);
    }
    const forgedOverLimit = await post("/api/ev", { pot: 2000, call: 1, equityPct: 50 }, { "X-Forwarded-For": "192.0.2.1, 203.0.113.20" });
    assert.equal(forgedOverLimit.status, 429, "a new forged first entry must not reset the limit");

    // Expensive requests are charged by work: one detailed Risk Lab run costs
    // far more than one point.
    const heavyHeaders = { "X-Forwarded-For": "203.0.113.30" };
    const heavy = await post("/api/risk-lab", { wr: 3, sd: 90, bank: 3000, hands: 300000, paths: 16000, seed: 7 }, heavyHeaders);
    assert.equal(heavy.status, 200);
    let cheapAllowed = 0;
    for (let request = 1; request <= 100; request += 1) {
      const cheap = await post("/api/ev", { pot: 3000 + request, call: 1, equityPct: 50 }, heavyHeaders);
      if (cheap.status !== 200) break;
      cheapAllowed += 1;
    }
    assert.ok(cheapAllowed < 80, `a detailed Risk Lab run should use a large share of the budget (then ${cheapAllowed} EV calls fit)`);

    process.stdout.write("API, cache, work-weighted rate limit, forged X-Forwarded-For, error status, security-header, validation, and public-bundle tests passed.\n");
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
