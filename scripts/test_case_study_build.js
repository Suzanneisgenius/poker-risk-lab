"use strict";
// A failed check must reach the Validation page as a failure and stop the
// release build:  node scripts/test_case_study_build.js
// Works on in-memory copies of the saved results; nothing on disk changes.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { loadInputs, render } = require("./build_case_study.js");

// Page text outside the scripts (the table-rendering script holds both wordings).
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "");

const real = render(loadInputs());
assert.deepEqual(real.failures, [], "the saved results all pass");
// The preview near the top quotes the 40-seed averages from the saved check.
const calcPlus3 = loadInputs().calc.multi_seed.rows.find((r) => r.winrate_bb100 === 3);
const preview = text(real.pages.index).match(/<section aria-labelledby="checked">[\s\S]*?<\/section>/)[0];
for (const v of [calcPlus3.mean_risk_endpoint_only, calcPlus3.mean_risk_bridge, calcPlus3.analytical_finite_horizon_brownian]) {
  assert.ok(preview.includes((v * 100).toFixed(2) + "%"), `the preview shows ${(v * 100).toFixed(2)}%`);
}
assert.doesNotMatch(text(real.pages.validation), /<span class="fail">/);

// The regressions from the review: an exact range spot off by 0.1, a preflop
// spot 9 standard errors out, all_passed false; plus PokerKit and posterior failures.
const broken = structuredClone(loadInputs());
Object.assign(broken.ranges.exact[0], { match: false, difference: 0.1 });
Object.assign(broken.ranges.preflop[0], { within_4_se: false });
broken.ranges.preflop[0].independent_monte_carlo.difference_in_se = 9;
broken.ranges.all_passed = false;
broken.pokerkit.heads_up_exact[0].match = false;
broken.pokerkit.three_way.difference_in_se = 6;
broken.posterior.cases[0].passed = false;
broken.posterior.cases[0].failures = ["risk.average: web 0.2, python 0.1"];
Object.assign(broken.sessionImport.files[0], { passed: false, failures: ["winRate: web 1, python 2"] });
broken.sessionLengths.cells.find((c) => c.model === "model").coverage_95.as_is = 0.9;
const { pages, failures } = render(broken);
for (const name of ["Range equity, flop to river", "Range equity, preflop", "Range check (all_passed)",
  "PokerKit heads-up equity", "PokerKit three-way equity", "Bankroll from results against Python",
  "Session import against Python", "Unequal session lengths (simulation)"]) {
  assert.ok(failures.includes(name), `${name} is reported as failed`);
}
const html = text(pages.validation);
assert.match(html, /<span class="fail">different, by up to 1 × 10⁻¹ \(1 × 10⁻⁹ allowed\)<\/span>/);
assert.match(html, /<span class="fail">9\.00 and 0\.91 standard errors \(4 allowed\)<\/span>/);
assert.match(html, /<span class="fail">different in 1 of 7<\/span>/);
assert.match(html, /<span class="fail">6\.00 standard errors, more than the 4 allowed,<\/span>/);
assert.match(html, new RegExp(`<span class="fail">outside tolerance in 1 of ${broken.posterior.cases.length} cases</span>`));
assert.match(html, new RegExp(`<span class="fail">differ in 1 of ${broken.sessionImport.files.length} files</span>`));
assert.match(html, /<span class="fail">not within 4 Monte Carlo standard errors of 95%<\/span>/);
assert.doesNotMatch(html, /class="pass">equal to within/);
assert.doesNotMatch(html, /class="pass">9\.00/);
// The summary table data carries the verdicts too.
const summary = JSON.parse(pages.validation.match(/<script id="data" type="application\/json">(.*?)<\/script>/s)[1]).summary;
assert.equal(summary.find((r) => r.check === "Range equity, flop to river").ok, false);
assert.equal(summary.find((r) => r.check === "Bankroll from results").ok, false);

// The release build exits non-zero, and --allow-failures keeps going.
const script = path.join(__dirname, "build_case_study.js");
const runWith = (flags) => spawnSync(process.execPath, ["-e", `
  const fs = require("fs"); const read = fs.readFileSync;
  fs.readFileSync = (file, ...rest) => String(file).endsWith(${JSON.stringify(path.join("range-equity-pokerkit", "results.json"))})
    ? JSON.stringify({ ...JSON.parse(read(file, "utf8")), all_passed: false }) : read(file, ...rest);
  fs.writeFileSync = () => {}; console.log = () => {};
  process.argv.push(...${JSON.stringify(flags)});
  require(${JSON.stringify(script)}).main();`], { encoding: "utf8" });
const stopped = runWith([]);
assert.equal(stopped.status, 1, "a failed check stops the build");
assert.match(stopped.stderr, /Validation checks failed: Range check \(all_passed\)/);
assert.equal(runWith(["--allow-failures"]).status, 0);

console.log("PASS: Validation pages show failed checks as failures, and the build stops on them.");
