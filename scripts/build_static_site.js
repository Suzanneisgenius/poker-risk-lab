"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const standalone = path.join(root, "standalone");
// Embed the saved research case with its original settings. No analysis is rerun.
const resultPath = "reports/tables/uncertainty_risk_demo.json";
const provenancePath = "reports/tables/uncertainty_risk_demo.provenance.json";
const reference = {
  result: JSON.parse(fs.readFileSync(path.join(root, resultPath), "utf8")),
  provenance: JSON.parse(fs.readFileSync(path.join(root, provenancePath), "utf8")),
  sources: [resultPath, provenancePath].map(file => ({file,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex")})),
};
const marker = "/*__UNCERTAINTY_REFERENCE__*/ null";
const app = fs.readFileSync(path.join(standalone, "build", "app.js"), "utf8");
if (!app.includes(marker)) throw new Error("Missing saved-reference binding in app.js");
const reviewedApp = app.replace(marker, JSON.stringify(reference).replaceAll("<", "\\u003c"));
// The range parser is shared with the server; the page gets the hand order inline.
const handOrderMarker = "/*__HAND_ORDER__*/ null";
const rangeSource = fs.readFileSync(path.join(standalone, "shared", "range.js"), "utf8");
if (!rangeSource.includes(handOrderMarker)) throw new Error("Missing hand-order binding in range.js");
const handOrder = fs.readFileSync(path.join(standalone, "shared", "hand-order.json"), "utf8");
const rangeScript = rangeSource.replace(handOrderMarker, JSON.stringify(JSON.parse(handOrder)).replaceAll("<", "\\u003c"));
// The Risk Lab's robustness note quotes the case study's saved model-assumption
// results (question 3), so its figures and scenario cannot drift from them.
const assumptions = JSON.parse(fs.readFileSync(path.join(root, "reports/case-study/assumptions.json"), "utf8"));
const byModel = Object.fromEntries(assumptions.rows.map((row) => [row.model, row]));
const scenario = assumptions.provenance.parameters.config.scenario;
const times = (model) => "×" + byModel[model].risk_vs_baseline.toFixed(2);
const pct = (value) => (value * 100).toFixed(1) + "%";
const assumptionsSummary = `<p>Same ${scenario.winrate_bb100 > 0 ? "+" : ""}${scenario.winrate_bb100} bb/100 edge, ${scenario.bankroll_bb / 100} buy-ins, `
  + `${scenario.std_bb100} bb/100 swings and ${scenario.n_hands.toLocaleString("en-US")} hands, with ruin observed at ${scenario.step_hands}-hand checkpoints `
  + `(${pct(byModel.gaussian.risk)} for independent Normal steps). Swings that carry over between steps (AR(1)) raise ruin <span class="big">${times("ar1")}</span>, `
  + `with the same spread per step but a ${byModel.ar1.total_sd_ratio.toFixed(2)}× wider total. Clustered regimes give <span class="big">${times("regime_switching")}</span>, `
  + `but their steps are also wider (SD about ${byModel.regime_switching.per_step_sd_bb.toFixed(0)} instead of ${scenario.std_bb100}), so that model does not hold the variance fixed. `
  + `Heavy tails (${times("student_t")}) and rare shocks (${times("shock_mixture")}) at the same spread per step barely move it. `
  + `Details in <a href="case-study/#q3">case study question 3</a>.</p>`;
// The Risk Lab's research summary quotes the same saved results as the research
// dashboard, through the dashboard's own loader, so the two pages cannot disagree.
const research = require("./build_dashboard.js").dataset();
const pct1 = (value) => (value * 100).toFixed(1) + "%";
const pct2 = (value) => (value * 100).toFixed(2) + "%";
const span = ([lo, hi]) => `${pct1(lo)}–${pct1(hi)}`;
const signedPp = (value) => (value > 0 ? "+" : value < 0 ? "−" : "") + Math.abs(value).toFixed(2);
const bar = ([lo, hi]) => `<div class="lab-source-track" aria-hidden="true"><i style="left:${(lo * 100).toFixed(2)}%;width:${((hi - lo) * 100).toFixed(2)}%"></i></div>`;
const ref = research.uncertainty.config.scenario;
const byPaths = (n) => research.uncertainty.monteCarlo.find((x) => x.paths === n);
const byHands = (n) => research.uncertainty.history.find((x) => x.hands === n);
const fewPaths = byPaths(2000), manyPaths = byPaths(200000), someHistory = byHands(50000), longHistory = byHands(1000000);
const modelRisk = research.assumptions.rows.map((row) => row.risk);
const modelRange = [Math.min(...modelRisk), Math.max(...modelRisk)];
// The summary names the five models; a different saved set must update that text.
if (modelRisk.length !== 5) throw new Error("The Risk Lab summary describes five return models");
const calc = research.calculation;
const seeds = calc.multi_seed.rows.find((row) => row.winrate_bb100 === 3);
const seedRows = calc.multi_seed.per_seed.filter((row) => row.winrate_bb100 === 3);
const raised = seedRows.filter((row) => row.ruined_bridge > row.ruined_endpoint_only).length;
const oneSeed = calc.single_seed.rows.find((row) => row.winrate_bb100 === 3);
for (const value of [fewPaths, manyPaths, someHistory, longHistory, seeds, oneSeed]) if (!value) throw new Error("Missing saved research result for the Risk Lab summary");
const source = (n, name, range, text) => `<li class="lab-source"><h4><span class="lab-source-n">${n}</span>${name}</h4>`
  + `<strong class="lab-source-value">${span(range)}</strong><p>${text}</p>${bar(range)}</li>`;
const researchSummary = `<div class="lab-sources"><ol>`
  + source(1, "Simulation noise", fewPaths.interval, `Where another run of ${fewPaths.paths.toLocaleString("en-US")} paths could land (approximate 95% range). ${manyPaths.paths.toLocaleString("en-US")} paths narrow it to ${span(manyPaths.interval)}. <a href="case-study/#q1">Question 1</a>`)
  + source(2, "Uncertain win rate", someHistory.risk_interval, `95% posterior interval after ${someHistory.hands.toLocaleString("en-US")} observed hands at +${research.uncertainty.config.observed_winrate_bb100} bb/100. More paths do not narrow it; ${longHistory.hands.toLocaleString("en-US")} hands give ${span(longHistory.risk_interval)}. <a href="case-study/#q2">Question 2</a>`)
  + source(3, "Return-model assumptions", modelRange, `Lowest and highest of five return models: independent Normal steps, and versions with heavy tails, rare shocks, swings that carry over, or clustered regimes. More paths do not narrow it; it depends on which model describes the game. <a href="case-study/#q3">Question 3</a>`)
  + `</ol><div class="lab-source-axis" aria-hidden="true"><span><b>0%</b><b>25%</b><b>50%</b><b>75%</b><b>100%</b></span></div>`
  + `<p class="lab-sources-note">Reference case: +${ref.winrate_bb100} bb/100, ${ref.bankroll_bb / 100} buy-ins, ${ref.std_bb100} bb/100 swings, the next ${ref.n_hands.toLocaleString("en-US")} hands. The three ranges answer different questions, so they are not interchangeable intervals. The model range checks ruin at 100-hand step ends; the other two monitor it continuously.</p></div>`
  + `<article class="lab-story" aria-labelledby="lab_story_title"><div class="lab-story-head"><h4 id="lab_story_title">A correction that a single run hid</h4><a href="case-study/#investigation">The full investigation</a></div>`
  + `<div class="lab-story-values"><div><span>Ruin checked at step ends</span><strong>${pct2(seeds.mean_risk_endpoint_only)}</strong></div><span class="lab-story-arrow" aria-hidden="true">→</span>`
  + `<div><span>With the Brownian-bridge correction</span><strong>${pct2(seeds.mean_risk_bridge)}</strong></div><div><span>Analytical value</span><strong>${pct2(seeds.analytical_finite_horizon_brownian)}</strong></div></div>`
  + `<p>Checking ruin only every 100 hands misses paths that dip below zero and recover before the next check. Over ${seedRows.length} paired seeds of ${calc.multi_seed.paths_per_seed.toLocaleString("en-US")} paths, the correction raises risk from ${pct2(seeds.mean_risk_endpoint_only)} to ${pct2(seeds.mean_risk_bridge)} (s.e. ${seeds.standard_error_of_mean_bridge_pp.toFixed(2)} points), close to the analytical ${pct2(seeds.analytical_finite_horizon_brownian)}. It raised risk at ${raised} of ${seedRows.length} seeds.</p>`
  + `<p>One run pointed the other way. At seed ${calc.single_seed.seed}, the engine update that added the correction moved risk from ${pct2(oneSeed.functional_fix_2026_10_05.risk)} to ${pct2(oneSeed.model_2026_10_21.risk)}: the new random-number streams account for ${signedPp(oneSeed.random_stream_change_pp)} points and the correction for ${signedPp(oneSeed.bridge_change_pp)}. The drop was a different random sample, not a lower real risk.</p></article>`;
const researchMarker = "<!--__RESEARCH_SUMMARY__-->";
const shellMarker = "<!--__ASSUMPTIONS_SUMMARY__-->";
const shell = fs.readFileSync(path.join(standalone, "build", "shell.html"), "utf8");
if (!shell.includes(shellMarker)) throw new Error("Missing assumptions-summary marker in shell.html");
if (!shell.includes(researchMarker)) throw new Error("Missing research-summary marker in shell.html");
// Session import: the shared reader and statistics, and the example file.
const statsScript = fs.readFileSync(path.join(standalone, "shared", "stats.js"), "utf8");
const sessionsScript = fs.readFileSync(path.join(standalone, "shared", "sessions.js"), "utf8");
const exampleMarker = "/*__SESSION_EXAMPLE__*/ null";
if (!reviewedApp.includes(exampleMarker)) throw new Error("Missing session-example binding in app.js");
const example = JSON.stringify(fs.readFileSync(path.join(standalone, "shared", "sessions-example.csv"), "utf8")).replaceAll("<", "\\u003c");
const page = [
  shell.replace(shellMarker, () => assumptionsSummary).replace(researchMarker, () => researchSummary),
  "\n<script>\n",
  statsScript,
  "\n",
  sessionsScript,
  "\n",
  rangeScript,
  "\n",
  reviewedApp.replace(exampleMarker, () => example),
  "\n</script></body></html>\n",
].join("");

for (const target of [
  path.join(standalone, "poker-analytics-suite.html"),
  path.join(root, "index.html"),
  path.join(root, "site", "index.html"),
]) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, page, "utf8");
  process.stdout.write(`wrote ${path.relative(root, target)}\n`);
}
