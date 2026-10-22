#!/usr/bin/env node
// Builds case-study/index.html and case-study/validation.html from the saved
// experiment and check outputs (reports/case-study/, checks/*/results.json).
// Every number in the page text is filled in here from those files, so the
// pages cannot drift from the results they cite. The pages are static: they
// need no server and no network.
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "case-study", "src");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));

const noise = read("reports/case-study/noise.json");
const uncertainty = read("reports/case-study/uncertainty.json");
const assumptions = read("reports/case-study/assumptions.json");
const overview = read("reports/case-study/overview.json");
const calc = read("checks/calculation-change-2026-10-21/results.json");
const pokerkit = read("checks/external-pokerkit/results.json");
const ranges = read("checks/range-equity-pokerkit/results.json");
const handOrder = read("standalone/shared/hand-order.json");
const accuracy = read("checks/equity-accuracy/results.json");
const benchmark = read("checks/evaluator-benchmark/results.json");
const engines = read("checks/engine-agreement/results.json");

const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";
const points = (v, d = 2) => (v * 100).toFixed(d);
const int = (v) => Math.round(v).toLocaleString("en-US");
const millions = (v) => (v / 1e6).toFixed(v < 1e6 ? 3 : 2) + " M";

const noiseBy = Object.fromEntries(noise.rows.map((r) => [r.paths, r]));
const historyBy = Object.fromEntries(uncertainty.history.map((h) => [h.hands, h]));
const modelBy = Object.fromEntries(assumptions.rows.map((r) => [r.model, r]));
const risks = assumptions.rows.map((r) => r.risk);
const calcPlus3 = calc.single_seed.rows.find((r) => r.winrate_bb100 === 3);
const multiPlus3 = calc.multi_seed.rows.find((r) => r.winrate_bb100 === 3);
const preflop = accuracy.spots.find((s) => s.id === "preflop-AKs-vs-QQ");
const flop = accuracy.spots.find((s) => s.id === "flop-flush-draw");
const largest = (s) => s.monte_carlo[s.monte_carlo.length - 1];

const facts = {
  exact: pct(noise.exact_risk, 2),
  n2000_half: "±" + points(noiseBy[2000].theory_95[1] - noise.exact_risk),
  u50_lo: pct(historyBy[50000].risk_interval[0]),
  u50_hi: pct(historyBy[50000].risk_interval[1]),
  u_draws: int(uncertainty.provenance.parameters.config.n_draws),
  a_min: pct(Math.min(...risks)),
  a_max: pct(Math.max(...risks)),
  a_base: pct(modelBy.gaussian.risk),
  a_t: pct(modelBy.student_t.risk),
  a_shock: pct(modelBy.shock_mixture.risk),
  a_ar1: pct(modelBy.ar1.risk),
  a_ar1_x: modelBy.ar1.risk_vs_baseline.toFixed(2),
  a_ar1_total: modelBy.ar1.total_sd_ratio.toFixed(2),
  a_regime_sd: modelBy.regime_switching.per_step_sd_bb.toFixed(0),
  a_paths: int(assumptions.n_paths),
  c_before: pct(calcPlus3.functional_fix_2026_10_05.risk, 2),
  c_stream: pct(calcPlus3.new_streams_endpoint_only.risk, 2),
  c_after: pct(calcPlus3.model_2026_10_21.risk, 2),
  c_stream_pp: calcPlus3.random_stream_change_pp.toFixed(2).replace("-", "−"),
  c_bridge_pp: calcPlus3.bridge_change_pp.toFixed(2),
  c_mean_pp: multiPlus3.mean_bridge_increase_pp.toFixed(3),
  c_mean: pct(multiPlus3.mean_risk_bridge, 2),
  c_se: multiPlus3.standard_error_of_mean_bridge_pp.toFixed(2),
  c_endpoint: pct(multiPlus3.mean_risk_endpoint_only, 2),
  c_endpoint_gap: multiPlus3.mean_bridge_increase_pp.toFixed(3),
  cov_500: String(noiseBy[500].wilson_intervals_covering_exact),
  cov_2000: String(noiseBy[2000].wilson_intervals_covering_exact),
  cov_20000: String(noiseBy[20000].wilson_intervals_covering_exact),
  pk_version: pokerkit.environment.pokerkit,
  pk_hands: int(pokerkit.hand_order.hands),
  pk_seed: String(pokerkit.hand_order.seed),
  pk_pairs: int(pokerkit.hand_order.neighbouring_pairs),
  pk_disagreements: String(pokerkit.hand_order.disagreement_count),
  pk_categories: String(Object.keys(pokerkit.hand_order.categories).length),
  pk_preflop_runouts: int(pokerkit.heads_up_exact.find((s) => !s.board).runouts),
  pk_mw_trials: int(pokerkit.three_way.trials),
  pk_mw_ours: pct(pokerkit.three_way.ours_monte_carlo_equity, 2),
  pk_mw_exact: pct(pokerkit.three_way.pokerkit_exact_equity, 2),
  pk_mw_se: Math.abs(pokerkit.three_way.difference_in_se).toFixed(2),
  acc_seeds: String(accuracy.conditions.seeds_per_size),
  acc_flop_ms: (flop.exact_seconds * 1000).toFixed(1),
  acc_pre_ms: (preflop.exact_seconds * 1000).toFixed(0),
  acc_pre_mc_ms: (largest(preflop).mean_seconds * 1000).toFixed(0),
  acc_pre_mc_rmse: largest(preflop).rmse_pp.toFixed(2),
  acc_cpu: accuracy.conditions.cpu,
  acc_node: accuracy.conditions.node.replace(/^v/, ""),
  b_hands: int(benchmark.conditions.hands),
  b_repeats: String(benchmark.conditions.repeats),
  b_old_med: millions(benchmark.earlier.evaluations_per_second.median),
  b_old_min: millions(benchmark.earlier.evaluations_per_second.min),
  b_old_max: millions(benchmark.earlier.evaluations_per_second.max),
  b_new_med: millions(benchmark.current.evaluations_per_second.median),
  b_new_min: millions(benchmark.current.evaluations_per_second.min),
  b_new_max: millions(benchmark.current.evaluations_per_second.max),
  b_speedup: String(benchmark.median_speedup),
  b_mismatch: String(benchmark.agreement.score_mismatches),
  b_cpu: benchmark.conditions.cpu,
  b_node: benchmark.conditions.node.replace(/^v/, ""),
  r_notation: String(ranges.notation.length),
  r_notation_match: String(ranges.notation.filter((c) => c.match).length),
  r_exact: String(ranges.exact.length),
  r_every_combos: int(ranges.exact.find((s) => s.id === "flop-every-hand").combos),
  r_max_diff: ranges.exact.reduce((m, s) => Math.max(m, Math.abs(s.difference)), 0).toExponential(0)
    .replace(/e-(\d+)/, (_, power) => " × 10⁻" + [...power].map((d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[d]).join("")),
  r_pre: String(ranges.preflop.length),
  r_pre_samples: int(ranges.preflop[0].independent_monte_carlo.samples),
  r_pre_runouts: int(ranges.preflop[0].runouts_per_combo),
  r_pre_se: ranges.preflop.map((s) => Math.abs(s.independent_monte_carlo.difference_in_se).toFixed(2)).join(" and "),
  r_pre_ours_se: ranges.preflop.map((s) => Math.abs(s.ours_monte_carlo.difference_in_se).toFixed(2)).join(" and "),
  r_pre_trials: int(ranges.preflop[0].ours_monte_carlo.trials),
  o_trials: int(handOrder.trials_per_hand),
  o_close: String(handOrder.neighbours_within_2_se),
  o_top: pct(handOrder.hands[0].equity, 1),
  o_bottom: pct(handOrder.hands.at(-1).equity, 1),
  e_paths: int(engines.paths_per_run),
  e_seed: String(engines.seed),
};

// "Recorded with" for the reproduction table.
function recorded(result, extra) {
  const p = result.provenance;
  const code = p.git_commit ? `commit ${p.git_commit}${p.code_changed_since_commit ? " + local changes" : ""}` : "no commit recorded";
  return `${code}; Python ${p.packages.python}, NumPy ${p.packages.numpy}; ${p.timestamp_utc.slice(0, 10)}${extra ? "; " + extra : ""}`;
}
const command = (name) => `python -m src.experiments.case_study --case ${name}`;
const reproduce = [
  { figure: "The short answer", config: "combines the three below", command: command("overview"), recorded: recorded(overview) },
  { figure: "1 · Simulation noise", config: "configs/case_study/noise.yaml", command: command("noise"),
    recorded: recorded(noise, `seeds ${noise.provenance.parameters.seeds[0]}–${noise.provenance.parameters.seeds.at(-1)}; ${noise.rows.map((r) => int(r.paths)).join(" / ")} paths; bridge on`) },
  { figure: "2 · Uncertain win rate", config: "configs/case_study/uncertainty.yaml", command: command("uncertainty"),
    recorded: recorded(uncertainty, `${int(uncertainty.provenance.parameters.config.n_draws)} posterior draws, seed ${uncertainty.provenance.parameters.config.seed}`) },
  { figure: "3 · Model assumptions", config: "configs/case_study/assumptions.yaml", command: command("assumptions"),
    recorded: recorded(assumptions, `${int(assumptions.n_paths)} paths per model, seed ${assumptions.provenance.parameters.config.seed}`) },
];

const summary = [
  { check: "Hand order", benchmark: `PokerKit ${pokerkit.environment.pokerkit} (independent)`, compared: `${int(pokerkit.hand_order.hands)} random 7-card hands`, result: `${pokerkit.hand_order.disagreement_count} disagreements` },
  { check: "Heads-up equity", benchmark: "PokerKit, exact enumeration", compared: `${pokerkit.heads_up_exact.length} spots, win/tie/lose counts`, result: pokerkit.heads_up_exact.every((s) => s.match) ? "identical" : "differences" },
  { check: "Three-way equity", benchmark: "PokerKit, exact enumeration", compared: `Monte Carlo, ${int(pokerkit.three_way.trials)} trials`, result: `${Math.abs(pokerkit.three_way.difference_in_se).toFixed(2)} SE apart` },
  { check: "Range notation", benchmark: "PokerKit parse_range", compared: `${ranges.notation.length} range texts`, result: `same combos in ${ranges.notation.filter((c) => c.match).length}` },
  { check: "Range equity, flop to river", benchmark: "PokerKit hand ranking, exact enumeration", compared: `${ranges.exact.length} spots, up to ${int(Math.max(...ranges.exact.map((s) => s.combos)))} combos`, result: ranges.exact.every((s) => s.match) ? "equal" : "differences" },
  { check: "Range equity, preflop", benchmark: "Monte Carlo with PokerKit ranking", compared: `${ranges.preflop.length} spots against the exact value`, result: ranges.preflop.map((s) => Math.abs(s.independent_monte_carlo.difference_in_se).toFixed(2)).join(", ") + " SE apart" },
  { check: "Evaluator rewrite", benchmark: "Earlier evaluator, same machine", compared: `${int(benchmark.conditions.hands)} hands: scores and speed`, result: `${benchmark.agreement.score_mismatches} differences; ×${benchmark.median_speedup} faster` },
  { check: "Bankroll risk", benchmark: "Finite-horizon Brownian formula (exact for the model)", compared: "40 seeds, bridge on and off", result: `${pct(multiPlus3.mean_risk_bridge, 2)} vs ${pct(noise.exact_risk, 2)}` },
  { check: "Interval coverage", benchmark: "Exact value", compared: "40 runs at each of 3 sizes", result: noise.rows.map((r) => r.wilson_intervals_covering_exact).join(", ") + " of 40" },
  { check: "Two engines", benchmark: "Each other (internal)", compared: `${int(engines.paths_per_run)} paths, 4 settings`, result: `largest gap ${Math.max(...engines.rows.map((r) => Math.abs(r.difference_in_se))).toFixed(2)} SE` },
];

const pageData = {
  index: {
    overview: { rows: overview.rows, reference_risk: overview.reference_risk },
    noise: { exact_risk: noise.exact_risk, rows: noise.rows.map(({ paths, estimates, theory_95, min, max, wilson_intervals_covering_exact }) => ({ paths, estimates, theory_95, min, max, wilson_intervals_covering_exact })) },
    uncertainty: { plug_in_risk: uncertainty.plug_in_risk, history: uncertainty.history, monte_carlo: uncertainty.monte_carlo },
    assumptions: { rows: assumptions.rows.map(({ model, label, risk, wilson95, risk_vs_baseline, per_step_sd_bb, total_sd_ratio }) => ({ model, label, risk, wilson95, risk_vs_baseline, per_step_sd_bb, total_sd_ratio })) },
    calc: calc.single_seed.rows,
    reproduce,
  },
  validation: {
    summary,
    pokerkit: pokerkit.heads_up_exact,
    ranges: ranges.exact.map(({ id, hero, board, range, combos, ours, pokerkit: theirs, match }) => ({ id, hero, board, range, combos, ours, pokerkit: theirs, match })),
    accuracy: { spots: accuracy.spots },
    engines: engines.rows,
  },
};

const style = fs.readFileSync(path.join(SRC, "style.css"), "utf8").trim();
const charts = fs.readFileSync(path.join(SRC, "charts.js"), "utf8").trim();
const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function build(name) {
  let html = fs.readFileSync(path.join(SRC, `${name}.html`), "utf8");
  html = html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in facts)) throw new Error(`${name}.html: unknown placeholder {{${key}}}`);
    return escapeHtml(facts[key]);
  });
  const json = JSON.stringify(pageData[name]).replace(/</g, "\\u003c");
  html = html.replace("/*STYLE*/", () => style).replace("/*CHARTS*/", () => charts).replace("/*DATA*/", () => json);
  fs.writeFileSync(path.join(ROOT, "case-study", `${name}.html`), html);
  console.log(`wrote case-study/${name}.html`);
}

build("index");
build("validation");

// The README's main finding quotes the same numbers; fail the build if they drift.
const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
for (const quoted of [`exact model risk ${facts.exact}`, `${facts.n2000_half} points`, `${facts.u50_lo} to ${facts.u50_hi}`, `${facts.a_min} to ${facts.a_max}`]) {
  if (!readme.includes(quoted)) throw new Error(`README.md main finding is out of date: expected "${quoted}"`);
}
