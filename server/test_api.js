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
      env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", CALC_WORKERS: "2" },
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
  for (const secretMarker of ["function equityMC", "function equityExact", "function simulateBankroll", "function trainKuhnTracked", "averageGameValue("]) {
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

    const limitHeaders = { "X-Forwarded-For": "203.0.113.10" };
    for (let request = 1; request <= 100; request += 1) {
      const withinLimit = await post("/api/ev", { pot: request, call: 1, equityPct: 50 }, limitHeaders);
      assert.equal(withinLimit.status, 200, `request ${request} should fit within the 100-point limit`);
    }
    const overLimit = await post("/api/ev", { pot: 101, call: 1, equityPct: 50 }, limitHeaders);
    assert.equal(overLimit.status, 429);
    assert.ok(Number(overLimit.headers.get("retry-after")) >= 1);

    process.stdout.write("API, cache, 100-point rate limit, security-header, validation, and public-bundle tests passed.\n");
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
