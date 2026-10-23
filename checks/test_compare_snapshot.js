"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { compareSnapshot, assertSnapshot } = require("./compare_snapshot.js");

const saved = JSON.parse(fs.readFileSync(path.join(__dirname, "bankroll-posterior-python/web.json"), "utf8"));
const current = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, "bankroll-posterior-python/ours.js")], { encoding: "utf8" }));
assertSnapshot(current, saved, "Live posterior fixture");

function mutate(change) {
  const changed = structuredClone(saved);
  change(changed.cases[0]);
  return changed;
}
const roundoff = mutate(c => { c.result.risk.average += Number.EPSILON; });
assert.equal(compareSnapshot(roundoff, saved).rounded, 1);
assert.equal(compareSnapshot(roundoff, saved).differences.length, 0);

const mutations = [
  c => { c.result.risk.average += 1e-6; },
  c => { c.result.bankroll.credible.bb += 0.01; },
  c => { c.result.sampleSize.totalHands += 1; },
  c => { c.input.winRate += 1e-14; },
  c => { c.result.inputs.target += Number.EPSILON; },
  c => { c.result.bankroll.credible.met = !c.result.bankroll.credible.met; },
  c => { c.result.curve.average.pop(); },
  c => { delete c.result.risk.upper; },
  c => { c.result.risk.extra = 0; },
  c => { c.result.risk.average = null; },
  c => { c.result.risk.average = NaN; },
  c => { c.result.risk.average = Infinity; },
  c => { c.result.risk.average = String(c.result.risk.average); },
];
for (const change of mutations) assert.throws(() => assertSnapshot(mutate(change), saved, "Mutated fixture"), assert.AssertionError);
assert.throws(() => assertSnapshot({ n: 1e12 + 1 }, { n: 1e12 }, "Integer counts"), assert.AssertionError);
assert.throws(() => assertSnapshot({ value: Infinity }, { value: Infinity }, "Non-finite"), assert.AssertionError);
assert.throws(() => assertSnapshot({ values: {} }, { values: [] }, "Container type"), assert.AssertionError);
assert.deepEqual(compareSnapshot({ b: "x", a: 0.5 }, { a: 0.5, b: "x" }).differences, []);
assert.match(compareSnapshot(mutate(mutations[0]), saved).differences[0], /\$\.cases\[0\]\.result\.risk\.average: saved/);
console.log("PASS: snapshot roundoff is accepted; numerical regressions, changed inputs/counts/structure, and non-finite values are rejected.");
