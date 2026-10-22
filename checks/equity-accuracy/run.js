#!/usr/bin/env node
// Error against time: exact enumeration versus the Monte Carlo the app uses
// for multiway spots, on spots whose exact equity PokerKit confirmed
// (checks/external-pokerkit/results.json).
//
//   node checks/equity-accuracy/run.js           print
//   node checks/equity-accuracy/run.js --write   also save results.json
//
// Errors are deterministic for a given seed list; times depend on the machine.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { strToCard, equityExact, equityMultiwayMC } = require("../../standalone/engines/equity.js");

const TRIALS = [1000, 3000, 10000, 30000, 100000, 150000];   // 150,000 is the app's maximum
const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const external = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "external-pokerkit", "results.json"), "utf8"));
const split = (text) => (text.match(/../g) || []).map(strToCard);

const SPOTS = [
  { id: "preflop-AKs-vs-QQ", label: "Preflop, AsKs vs QhQd (heads-up)" },
  { id: "flop-flush-draw", label: "Flop, AhKh vs 9s9d on Qh7h2c (heads-up)" },
  { id: "flop-three-way", label: "Flop, AsKd vs QhQc vs 8s7s on Js9s2d (three-way)" },
];

function seconds(fn, repeats) {
  const times = [];
  let value;
  for (let r = 0; r < repeats; r += 1) {
    const start = process.hrtime.bigint();
    value = fn();
    times.push(Number(process.hrtime.bigint() - start) / 1e9);
  }
  times.sort((a, b) => a - b);
  return { value, median: times[times.length >> 1] };
}

const spots = SPOTS.map((spot) => {
  let hands, board, exact, exactSeconds = null, runouts;
  if (spot.id === "flop-three-way") {
    const m = external.three_way;
    hands = m.hands.map(split); board = split(m.board);
    exact = m.pokerkit_exact_equity; runouts = m.runouts;   // our engine has no exact multiway mode
  } else {
    const s = external.heads_up_exact.find((x) => x.id === spot.id);
    hands = [split(s.hero), split(s.villain)]; board = split(s.board);
    const timed = seconds(() => equityExact(hands[0], hands[1], board), 5);
    exact = timed.value.equity; exactSeconds = timed.median; runouts = timed.value.trials;
    if (Math.abs(exact - s.pokerkit.equity) > 1e-12) throw new Error(`${spot.id}: exact equity differs from PokerKit`);
  }
  const [hero, ...opponents] = hands;
  const monteCarlo = TRIALS.map((trials) => {
    const errors = [];
    let total = 0;
    for (const seed of SEEDS) {
      const start = process.hrtime.bigint();
      const r = equityMultiwayMC(hero, opponents, board, trials, seed);
      total += Number(process.hrtime.bigint() - start) / 1e9;
      errors.push(r.equity - exact);
    }
    const rmse = Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length);
    return {
      trials,
      rmse_pp: rmse * 100,
      max_abs_error_pp: Math.max(...errors.map(Math.abs)) * 100,
      mean_seconds: total / SEEDS.length,
    };
  });
  return { ...spot, exact_equity: exact, runouts, exact_seconds: exactSeconds, monte_carlo: monteCarlo };
});

const result = {
  purpose: "Error against time: exact enumeration versus Monte Carlo, on spots with a PokerKit-confirmed exact value.",
  command: "node checks/equity-accuracy/run.js --write",
  conditions: { cpu: os.cpus()[0]?.model || "unknown", node: process.version, seeds: `${SEEDS[0]}–${SEEDS[SEEDS.length - 1]}`, seeds_per_size: SEEDS.length },
  monte_carlo_function: "equityMultiwayMC (the app's Monte Carlo; fixed opponents)",
  spots,
  limits: "Times are single-threaded medians on one machine. The three-way exact value comes from PokerKit, because this engine has no exact multiway mode.",
};
if (process.argv.includes("--write")) fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(result, null, 2) + "\n");
for (const s of spots) {
  console.log(`${s.label}: exact ${(s.exact_equity * 100).toFixed(3)}%${s.exact_seconds == null ? " (PokerKit)" : ` in ${(s.exact_seconds * 1000).toFixed(1)} ms over ${s.runouts.toLocaleString()} runouts`}`);
  for (const m of s.monte_carlo) console.log(`  ${String(m.trials).padStart(6)} trials: RMSE ${m.rmse_pp.toFixed(3)} pp, max ${m.max_abs_error_pp.toFixed(3)} pp, ${(m.mean_seconds * 1000).toFixed(2)} ms`);
}
