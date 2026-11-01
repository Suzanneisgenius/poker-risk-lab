"use strict";

// Runs scripts/check_deploy.js against a local server, so the deploy check
// keeps matching the routes, pages and results it checks.

const assert = require("node:assert/strict");
const { spawn, execFile } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const COMMIT = "fedcba9876543210fedcba9876543210fedcba98";

function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "server", "app.js")], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", CALC_WORKERS: "2", TRUST_PROXY_HOPS: "0", RENDER_GIT_COMMIT: COMMIT },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => reject(new Error("Test server did not start.")), 8000);
    child.once("exit", (code) => reject(new Error(`Test server exited with ${code}.`)));
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("listening")) {
        clearTimeout(timer);
        resolve(child);
      }
    });
  });
}

function runCheck(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(__dirname, "check_deploy.js"), ...args], { timeout: 120000 }, (error, stdout) => {
      resolve({ code: error ? error.code : 0, stdout });
    });
  });
}

async function main() {
  // Two servers, because one full run uses most of an address's rate limit.
  const servers = [await startServer(4195), await startServer(4196)];
  try {
    const full = await runCheck(["http://127.0.0.1:4195", "--commit", COMMIT.slice(0, 7), "--heavy"]);
    assert.equal(full.code, 0, full.stdout);
    assert.doesNotMatch(full.stdout, /^FAIL/m);
    assert.match(full.stdout, /PASS  the deployed commit is fedcba9/);
    assert.match(full.stdout, /PASS  \/api\/bankroll-posterior answers/);
    assert.match(full.stdout, /Bankroll simulation near the work ceiling/);
    assert.match(full.stdout, /All checks passed\./);

    const wrongCommit = await runCheck(["http://127.0.0.1:4196", "--commit", "abc1234"]);
    assert.equal(wrongCommit.code, 1, wrongCommit.stdout);
    assert.match(wrongCommit.stdout, /FAIL  the deployed commit is abc1234: it is fedcba98/);

    assert.equal((await runCheck(["127.0.0.1:4195"])).code, 2, "a URL without http(s):// is a usage error");
    process.stdout.write("PASS: the deploy check passes on a local server, reports the commit, and fails on a wrong commit.\n");
  } finally {
    for (const server of servers) {
      server.removeAllListeners("exit");
      server.kill("SIGTERM");
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
