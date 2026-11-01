"use strict";

// Checks a running copy of the app from outside, the way a visitor reaches it:
// the health check and deployed commit, the pages and their security headers,
// one small request per calculation, and the refusal of cross-origin
// calculations. With --heavy it also times the largest runs the page offers,
// to compare with the route timeouts on the actual instance.
//
//   node scripts/check_deploy.js https://<your-app>.onrender.com [--commit <sha>] [--heavy]
//
// It sends only GET requests and calculation POSTs. A run with --heavy uses
// about 85 of the 100 rate-limit points one address gets per minute, so wait a
// minute between runs.

// A sleeping free Render service takes about a minute to start.
const WAKE_LIMIT_MS = 150000;
const PAGES = ["/", "/case-study/", "/case-study/validation.html", "/dashboard/"];

function parseArgs(argv) {
  const args = { base: null, commit: null, heavy: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--heavy") args.heavy = true;
    else if (argv[index] === "--commit") args.commit = argv[++index] || "";
    else if (!args.base) args.base = argv[index];
    else throw new Error(`Unexpected argument: ${argv[index]}`);
  }
  if (!args.base || !/^https?:\/\//.test(args.base)) {
    throw new Error("Usage: node scripts/check_deploy.js https://<your-app>.onrender.com [--commit <sha>] [--heavy]");
  }
  if (args.commit !== null && !/^[0-9a-f]{7,40}$/.test(args.commit)) throw new Error("--commit needs a commit hash (7 to 40 hex characters).");
  return args;
}

let failures = 0;
const report = (status, message) => process.stdout.write(`${status.padEnd(5)} ${message}\n`);
function check(ok, message, problem) {
  if (ok) report("PASS", message);
  else {
    failures += 1;
    report("FAIL", problem ? `${message}: ${problem}` : message);
  }
  return ok;
}

async function send(base, path, { method = "GET", body, headers = {}, timeoutMs = 30000, redirect = "follow" } = {}) {
  const started = Date.now();
  const response = await fetch(new URL(path, base), {
    method,
    redirect,
    signal: AbortSignal.timeout(timeoutMs),
    headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { response, text, ms: Date.now() - started };
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const seconds = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

// Waits through Render's spin-up: until then the health check may refuse the
// connection or answer with Render's own loading page instead of JSON.
async function wake(base) {
  const started = Date.now();
  while (Date.now() - started < WAKE_LIMIT_MS) {
    try {
      const { response, text } = await send(base, "/api/health", { timeoutMs: WAKE_LIMIT_MS - (Date.now() - started) });
      const health = parse(text);
      if (response.ok && health) return { health, ms: Date.now() - started };
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return null;
}

async function checkHealth(base, expectedCommit) {
  const woken = await wake(base);
  if (!woken) return check(false, "health check answers", `no JSON answer from /api/health within ${seconds(WAKE_LIMIT_MS)}`);
  const { health, ms } = woken;
  check(health.ok === true && health.service === "poker-analytics-api", `health check answers (${seconds(ms)}, commit ${health.commit || "not reported"})`, JSON.stringify(health));
  if (expectedCommit !== null) {
    check(typeof health.commit === "string" && health.commit.startsWith(expectedCommit), `the deployed commit is ${expectedCommit}`,
      health.commit ? `it is ${health.commit}` : "the health check does not report a commit (RENDER_GIT_COMMIT is not set)");
  }
  return true;
}

async function checkPages(base) {
  for (const page of PAGES) {
    const { response, text } = await send(base, page);
    const csp = response.headers.get("content-security-policy") || "";
    const problems = [];
    if (response.status !== 200) problems.push(`status ${response.status}`);
    if (!/text\/html/.test(response.headers.get("content-type") || "")) problems.push("not HTML");
    if (!csp.includes("frame-ancestors 'none'")) problems.push("no Content-Security-Policy");
    if (response.headers.get("x-content-type-options") !== "nosniff") problems.push("no X-Content-Type-Options");
    if (page === "/" && !/<script[^>]*cdn\.plot\.ly[^>]*integrity="sha384-/.test(text)) problems.push("Plotly is loaded without an integrity hash");
    check(!problems.length, `${page} is served with its security headers`, problems.join(", "));
  }
  const bare = await send(base, "/case-study", { redirect: "manual" });
  check(bare.response.status === 301 && bare.response.headers.get("location") === "/case-study/", "/case-study redirects to /case-study/", `status ${bare.response.status}`);
  for (const file of ["/server/app.js", "/render.yaml"]) {
    const { response } = await send(base, file);
    check(response.status === 404, `${file} is not served`, `status ${response.status}`);
  }
}

async function checkCalculations(base, seed) {
  const calculations = [
    ["/api/ev", { pot: 10, call: 5, equityPct: 40 }, (r) => Math.abs(r.evCall - 1) < 1e-9],
    ["/api/equity", { hero: [51, 38], opponents: [null], board: [], trials: 1000, seed }, (r) => typeof r.result === "object"],
    ["/api/bankroll", { wr: 3, sd: 90, bank: 3000, thr: 0, hands: 1000, paths: 100, seed }, (r) => r.model?.name === "bankroll-monte-carlo"],
    ["/api/risk-lab", { wr: 3, sd: 90, bank: 3000, thr: 0, hands: 1000, paths: 100, seed, includeCurve: false }, (r) => r.model?.name === "bankroll-monte-carlo"],
    // The all-players prior has four groups and the real hands' licence: this
    // fails if the deploy predates the priors estimated from real hands.
    ["/api/bankroll-posterior", { hands: 40000, winRate: 4, sd: 90, sdSource: "assumed", prior: "players", bank: 30, thr: 0, bbPerBuyIn: 100, horizon: 100000 },
      (r) => r.winRate?.components?.length === 4 && r.priorSource?.license === "CC BY 4.0"],
    ["/api/preflop", { scenarioId: "cash-6max-40-sb-vs-btn" }, (r) => Array.isArray(r.scenario?.hands)],
    ["/api/gto", { iterations: 10000, seed }, (r) => r.iterations === 10000],
  ];
  for (const [endpoint, body, valid] of calculations) {
    try {
      const { response, text, ms } = await send(base, endpoint, { method: "POST", body, timeoutMs: 60000 });
      const result = parse(text);
      const problem = response.status === 429 ? "rate limited; wait a minute and run again"
        : response.status !== 200 ? `status ${response.status}: ${result?.error || text.slice(0, 120)}`
        : response.headers.get("cache-control") !== "no-store" ? "answer is not marked no-store"
        : !result || !valid(result) ? "unexpected result" : null;
      check(!problem, `${endpoint} answers in ${seconds(ms)}`, problem);
    } catch (error) {
      check(false, endpoint, error.message);
    }
  }
  const crossOrigin = await send(base, "/api/ev", { method: "POST", body: { pot: 10, call: 5, equityPct: 40 }, headers: { Origin: "https://example.invalid" } });
  check(crossOrigin.response.status === 403, "a calculation from another site is refused", `status ${crossOrigin.response.status}`);
  const get = await send(base, "/api/ev");
  check(get.response.status === 405, "calculations refuse GET", `status ${get.response.status}`);
}

// The largest runs the page can send. Route timeouts are those in
// server/app.js; the page gives up after its own, longer timeouts
// (standalone/build/app.js).
async function checkHeavy(base, seed) {
  const runs = [
    { label: "Risk Lab, detailed run at the longest horizon (16,000 paths × 300,000 hands)", endpoint: "/api/risk-lab", serverMs: 55000, pageMs: 70000,
      body: { wr: 3, sd: 90, bank: 3000, thr: 0, hands: 300000, paths: 16000, seed, includeCurve: true } },
    { label: "Bankroll simulation near the work ceiling (20,000 paths × 400,000 hands)", endpoint: "/api/bankroll", serverMs: 45000, pageMs: 60000,
      body: { wr: 3, sd: 90, bank: 3000, thr: 0, hands: 400000, paths: 20000, seed } },
  ];
  for (const run of runs) {
    try {
      const { response, text, ms } = await send(base, run.endpoint, { method: "POST", body: run.body, timeoutMs: run.pageMs });
      if (response.status !== 200) {
        check(false, run.label, `status ${response.status}: ${parse(text)?.error || text.slice(0, 120)}`);
      } else if (ms > run.serverMs / 2) {
        report("WARN", `${run.label}: ${seconds(ms)} of the ${seconds(run.serverMs)} route timeout. Two such runs at once share the CPU and take about twice as long.`);
      } else {
        check(true, `${run.label}: ${seconds(ms)} (route timeout ${seconds(run.serverMs)})`);
      }
    } catch (error) {
      check(false, run.label, error.name === "TimeoutError" ? `no answer within the page's ${seconds(run.pageMs)}` : error.message);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // A new seed each run, so calculations are not answered from the server's cache.
  const seed = Date.now() % 1000000000;
  process.stdout.write(`Checking ${args.base}\n`);
  if (await checkHealth(args.base, args.commit)) {
    await checkPages(args.base);
    await checkCalculations(args.base, seed);
    if (args.heavy) await checkHeavy(args.base, seed);
  }
  process.stdout.write(failures ? `${failures} check(s) failed.\n` : "All checks passed.\n");
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
});
