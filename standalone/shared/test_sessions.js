"use strict";
// Session import checks:  node standalone/shared/test_sessions.js
// The estimates are compared with src/inference.py in
// checks/session-import-python/; their behaviour under unequal session lengths
// is simulated in checks/session-lengths/.
const assert = require("node:assert/strict");
const St = require("./stats.js");
const S = require("./sessions.js");

const close = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${label}: ${actual} vs ${expected}`);

// --- Distributions against scipy (values from scipy 1.18) ----------------------
[[0.3, 1.0957979948180756], [2.5, 0.2846828704729192], [10, 12.801827480081469], [57.2, 173.16000143329242], [171.5, 709.1431630309283]]
  .forEach(([x, v]) => close(St.logGamma(x), v, 1e-13, `logGamma(${x})`));
[[0.5, 0.2, 0.47291074313446196], [3, 2, 0.3233235838169364], [50, 65, 0.9764876021901913], [200, 190, 0.24334742710062368]]
  .forEach(([a, x, v]) => close(St.gammaP(a, x), v, 1e-12, `gammaP(${a}, ${x})`));
[[0.5, 0.5, 0.3, 0.36901011956554536], [2, 3, 0.4, 0.5247999999999999], [100, 150, 0.45, 0.9455167660069934], [3.5, 60, 0.03, 0.18976789923310203]]
  .forEach(([a, b, x, v]) => close(St.betaI(a, b, x), v, 1e-12, `betaI(${a}, ${b}, ${x})`));
[[0.025, 4, 0.4844185570879299], [0.975, 149, 184.68695493443445], [0.5, 1, 0.454936423119572], [0.999, 2000, 2201.156196586629]]
  .forEach(([p, k, v]) => close(St.chiSquareQuantile(p, k), v, 1e-11, `chi-square quantile(${p}, ${k})`));
[[1.2, 10, 12, 0.623046875], [0.5, 74, 74, 0.0016282933154411312], [2.1, 3, 200, 0.8985383401914089]]
  .forEach(([x, a, b, v]) => close(St.fCdf(x, a, b), v, 1e-12, `F cdf(${x}; ${a}, ${b})`));

// --- Reading files ---------------------------------------------------------------
const messy = "﻿Date;Stake;Game;Hands;Profit (bb)\n2026-01-05;NL25;NLHE;412;18,5\n2026-01-06;NL25;NLHE;1250;−64\n\n# a comment\n"
  + '2026-01-09;NL50;"NLHE; 6-max";385;(7.25)\n31/01/2026;NL50;NLHE;300;1\n2026-02-01;NL50;NLHE;0;1\n2026-02-02;NL50;PLO;600;abc\n2026-02-30;NL50;PLO;600;1\n';
const read = S.parseCsv(messy);
assert.equal(read.delimiter, ";");
assert.deepEqual(read.sessions.map((s) => [s.line, s.hands, s.profit, s.stake, s.game, s.date]), [
  [2, 412, 18.5, "NL25", "NLHE", "2026-01-05"], [3, 1250, -64, "NL25", "NLHE", "2026-01-06"], [6, 385, -7.25, "NL50", "NLHE; 6-max", "2026-01-09"],
]);
assert.deepEqual(read.problems.map((p) => p.line), [7, 8, 9, 10], "unreadable rows are listed by line, not guessed");
assert.match(read.problems[0].message, /not YYYY-MM-DD/);
assert.deepEqual(read.columns, { hands: "Hands", profit: "Profit (bb)", stake: "Stake", game: "Game", date: "Date" });
assert.match(S.parseCsv("a,b\n1,2").error, /needs a hands column and a profit_bb column/);
assert.match(S.parseCsv("").error, /empty/);
const quoted = S.parseCsv('hands,net_bb,notes\n"1,200","-1,050.5","multi\nline, note"\r\n300,4\r\n');
assert.deepEqual(quoted.sessions.map((s) => [s.line, s.hands, s.profit]), [[2, 1200, -1050.5], [4, 300, 4]], "quoted thousands and line breaks");
assert.deepEqual(S.parseCsv(S.TEMPLATE).sessions.length, 3, "the template reads back");
assert.equal(S.parseNumber("12,5", ";"), 12.5);
assert.ok(Number.isNaN(S.parseNumber("12,5", ",")), "a decimal comma needs a non-comma delimiter");
assert.equal(S.parseNumber("1,234.5", ","), 1234.5);
assert.equal(S.parseNumber("-3.5bb", ","), -3.5);
assert.equal(S.parseDate("2026/3/7 21:15"), "2026-03-07");
assert.equal(S.parseDate("2026-02-29"), null, "not a leap year");

// --- Estimates -------------------------------------------------------------------
// Two sessions: 100 hands +10 bb and 100 hands 0 bb -> +5 bb/100 (as src/inference.py).
const two = S.summarize([{ hands: 100, profit: 10, order: 0 }, { hands: 100, profit: 0, order: 1 }]);
close(two.winRate, 5, 1e-15, "hands-weighted win rate");
close(two.sd, Math.sqrt(50), 1e-15, "weighted volatility with n - 1");
const uneven = [{ hands: 100, profit: 10 }, { hands: 900, profit: -9 }, { hands: 500, profit: 20 }].map((s, order) => ({ ...s, order }));
const est = S.summarize(uneven);
close(est.winRate, (100 * 21) / 1500, 1e-15, "weighted by hands, not by session");
const w = uneven.map((s) => s.hands / 100), r = uneven.map((s) => (100 * s.profit) / s.hands);
close(est.sd, Math.sqrt(w.reduce((a, wi, i) => a + wi * (r[i] - est.winRate) ** 2, 0) / 2), 1e-14, "volatility formula");
close(est.standardError, est.sd / Math.sqrt(15), 1e-15, "standard error");
assert.equal(est.scaling, null, "too few sessions for the length check");

// Synthetic history (sfc32-free LCG is enough here): the checks stay quiet when
// the model holds and the volatility interval contains the truth.
let state = 7;
const uniform = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state + 0.5) / 4294967296; };
const normal = () => St.normalQuantile(uniform());
const make = (n, rate) => Array.from({ length: n }, (_, order) => {
  const hands = 50 + Math.floor(uniform() * 1950);
  return { hands, profit: rate(order) * hands / 100 + 90 * Math.sqrt(hands / 100) * normal(), order, date: null, stake: order % 3 ? "NL25" : "NL50", game: "NLHE" };
});
const steady = S.summarize(make(400, () => 3));
assert.ok(steady.sdInterval[0] < 90 && 90 < steady.sdInterval[1], `volatility interval ${steady.sdInterval} contains 90`);
assert.ok(!steady.scaling.flag && !steady.stability.flag, "no flags when the model holds");
assert.equal(steady.stability.groups, 10);
// A win rate that jumps halfway is caught by the stability check, and widening helps.
const jump = S.summarize(make(400, (i) => (i < 200 ? 15 : -9)));
assert.ok(jump.stability.flag && jump.stability.multiplier > 1.5, `jump flagged, multiplier ${jump.stability.multiplier}`);
// Short sessions that swing far more per hand than long ones are caught by the length check.
const lopsided = make(400, () => 3).map((s) => ({ ...s, profit: s.profit + (s.hands < 500 ? 150 * normal() : 0) }));
assert.ok(S.summarize(lopsided).scaling.flag, "spread against length flagged");

// --- Filters and groups ------------------------------------------------------------
const dated = S.parseCsv("date,stake,game,hands,profit_bb\n2026-01-05,NL25,NLHE,400,10\n2026-02-10,NL50,NLHE,600,-20\n2026-04-01,NL25,PLO,500,30\n,NL25,NLHE,100,1\n").sessions;
assert.equal(S.filterSessions(dated, { stakes: new Set(["NL25"]) }).length, 3);
assert.equal(S.filterSessions(dated, { from: "2026-02", to: "2026-04" }).length, 2, "a period filter leaves out undated sessions");
assert.deepEqual(S.groupSessions(dated, "quarter").map((g) => [g.key, g.sessions.length]), [["2026-Q1", 2], ["2026-Q2", 1], ["", 1]]);
assert.deepEqual(S.groupSessions(dated, "stake").map((g) => g.key), ["NL25", "NL50"], "most hands first");
const compared = S.compareGroups(make(300, () => 3), "stake");
assert.equal(compared.groups.length, 2);
assert.ok(compared.test.p > 0.01, "two stakes with the same win rate do not differ");
const differ = make(300, () => 3).map((s) => ({ ...s, profit: s.profit + (s.stake === "NL50" ? -0.2 * s.hands : 0) }));
assert.ok(S.compareGroups(differ, "stake").test.p < 0.001, "a 20 bb/100 gap between stakes is found");

console.log("PASS: distributions against scipy, CSV reading (delimiters, decimal commas, quotes, problems by line), hands-weighted estimates, length and stability checks, filters and group comparisons.");
