#!/usr/bin/env node
// Rank the 169 starting hands by all-in equity against one random hand (the
// PokerStove convention). The ranking defines "Top X%" ranges in Hand Equity.
//
//   node scripts/hand_order.js            # print a summary
//   node scripts/hand_order.js --write    # also save standalone/shared/hand-order.json
//   node scripts/hand_order.js --check    # compare with the saved file
//
// Each hand is simulated separately with the equity engine's multiway Monte
// Carlo (one random opponent, random board), seeded from its matrix index, on
// all CPU cores. Neighbours whose difference is within twice the combined
// standard error may swap places in other tools' tables.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const { equityMultiwayMC } = require("../standalone/engines/equity.js");
const { CLASSES, CLASS_COMBOS, COMBOS } = require("../standalone/shared/range.js");

const TRIALS = 10000000;
const SEED_BASE = 20261022;
const OUT = path.join(__dirname, "..", "standalone", "shared", "hand-order.json");

if (!isMainThread) {
  for (const index of workerData.indices) {
    const result = equityMultiwayMC(COMBOS[CLASS_COMBOS[index][0]], [null], [], TRIALS, SEED_BASE + index);
    parentPort.postMessage({ index, equity: result.equity });
  }
  return;
}

async function main() {
  const started = Date.now();
  const workers = Math.max(1, Math.min(CLASSES.length, os.availableParallelism() - 1));
  const equity = new Array(CLASSES.length);
  await Promise.all(Array.from({ length: workers }, (_, w) => new Promise((resolve, reject) => {
    const indices = CLASSES.map((_, i) => i).filter((i) => i % workers === w);
    const worker = new Worker(__filename, { workerData: { indices } });
    worker.on("message", ({ index, equity: value }) => { equity[index] = value; });
    worker.on("error", reject);
    worker.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`))));
  })));

  // Conservative standard error: a pot share in [0, 1] has variance at most p(1 - p).
  const hands = CLASSES.map((hand, i) => ({
    hand,
    equity: Number(equity[i].toFixed(5)),
    standard_error: Number(Math.sqrt(equity[i] * (1 - equity[i]) / TRIALS).toFixed(6)),
  })).sort((a, b) => b.equity - a.equity || CLASSES.indexOf(a.hand) - CLASSES.indexOf(b.hand));
  const close = hands.slice(1).filter((h, i) =>
    hands[i].equity - h.equity < 2 * Math.hypot(hands[i].standard_error, h.standard_error)).length;
  const result = {
    description: "The 169 starting hands ranked by all-in equity against one random hand (the PokerStove convention). Hand Equity uses this order for Top X% ranges.",
    command: "node scripts/hand_order.js --write",
    method: `Monte Carlo per hand with the equity engine (one random opponent hand, random board), ${TRIALS.toLocaleString("en-US")} trials, seed ${SEED_BASE} + matrix index.`,
    trials_per_hand: TRIALS,
    seed_base: SEED_BASE,
    neighbours_within_2_se: close,
    hands,
  };
  const text = JSON.stringify(result, null, 2) + "\n";
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(OUT, "utf8") !== text) { console.error(`Results differ from ${path.relative(process.cwd(), OUT)}.`); process.exit(1); }
    console.log(`Results match ${path.relative(process.cwd(), OUT)} (${seconds} s).`);
    return;
  }
  if (process.argv.includes("--write")) fs.writeFileSync(OUT, text);
  const pct = (h) => `${h.hand} ${(h.equity * 100).toFixed(2)}%`;
  console.log(`${workers} workers · ${seconds} s · ${TRIALS.toLocaleString("en-US")} trials per hand`);
  console.log(`Strongest: ${hands.slice(0, 5).map(pct).join(", ")}`);
  console.log(`Weakest: ${hands.slice(-5).map(pct).join(", ")}`);
  console.log(`Neighbours within 2 SE of each other: ${close} of 168`);
}

main().catch((error) => { console.error(error); process.exit(1); });
