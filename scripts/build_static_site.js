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
const shellMarker = "<!--__ASSUMPTIONS_SUMMARY__-->";
const shell = fs.readFileSync(path.join(standalone, "build", "shell.html"), "utf8");
if (!shell.includes(shellMarker)) throw new Error("Missing assumptions-summary marker in shell.html");
const page = [
  shell.replace(shellMarker, () => assumptionsSummary),
  "\n<script>\n",
  rangeScript,
  "\n",
  reviewedApp,
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
