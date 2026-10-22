#!/usr/bin/env node
// Our side of the range cross-check: test cases and this project's answers,
// printed as JSON for run.py to compare with PokerKit.
"use strict";

const { strToCard, equityVsRange } = require("../../standalone/engines/equity.js");
const R = require("../../standalone/shared/range.js");

// Notation: our parser against PokerKit's parse_range. PokerKit reads a dash
// as "both ranks move together" (T9s-65s, 99-66) and rejects A5s-A2s, so for
// those entries `pokerkit` spells the same hands out.
const NOTATION = [
  { text: "AA" }, { text: "QQ+" }, { text: "22+" }, { text: "99-66" }, { text: "22-55" },
  { text: "AKs" }, { text: "AKo" }, { text: "AK" }, { text: "ATs+" }, { text: "KTo+" }, { text: "AT+" },
  { text: "T9s-65s" }, { text: "AK-QJ" }, { text: "AsKs" }, { text: "AhKd, AdKh" },
  { text: "A5s-A2s", pokerkit: "A5s A4s A3s A2s" },
  { text: "K9o-K6o", pokerkit: "K9o K8o K7o K6o" },
  { text: "QQ+, AKs, AQo+, KQ, JTs, 76s-54s, A5s-A2s, 22", pokerkit: "QQ+ AKs AQo+ KQ JTs 76s-54s A5s A4s A3s A2s 22" },
  { text: "top 15%", ours: R.formatRange(R.topPercent(15)) },
  { text: "top 40%", ours: R.formatRange(R.topPercent(40)) },
];

// Exact spots: every live combo on every runout. Weights use the :w suffix,
// which run.py applies itself (PokerKit ranges carry no weights).
const EVERY_HAND = "22+, A2+, K2+, Q2+, J2+, T2+, 92+, 82+, 72+, 62+, 52+, 42+, 32";
const EXACT = [
  { id: "flop-draw-vs-mixed-range", hero: "AhKh", board: "Qh7h2c", range: "TT+, AQs+, AKo, KQs, QJs, JTs, T9s, 98s, 76s:0.5, A5s:0.5, A4s:0.5" },
  { id: "flop-set-vs-paired-board", hero: "9c9d", board: "9h4s4d", range: "44, 99+, A4s, 54s, A9:0.25, K9s, 98s" },
  { id: "flop-every-hand", hero: "8d7d", board: "9d6c2d", range: EVERY_HAND },
  { id: "turn-flush-draw", hero: "JcTc", board: "Qc9h3c2s", range: "QQ+, AK, KQ, QJs, QTs, Q9s, 99, 33, 22, A2s+:0.5" },
  { id: "river-split-pots", hero: "AdQd", board: "KsJhTc4d4h", range: "AQ, AK:0.75, KQ, QT, 44, KJ, JT, T9s" },
];

// Preflop spots: our stratified Monte Carlo and our exact value (every live
// combo on all 1,712,304 runouts). run.py adds an independent Monte Carlo.
const PREFLOP_TRIALS = 150000;
const PREFLOP_SEED = 7;
const PREFLOP = [
  { id: "preflop-AKs-vs-TT+-AQs+-AKo", hero: "AhKh", range: "TT+, AQs+, AKo" },
  { id: "preflop-JTs-vs-small-pairs-weighted", hero: "JhTh", range: "77-22, KQs:0.5, A5s:0.5" },
];

const cards = (text) => (text.match(/../g) || []).map(strToCard);
function rangeList(text) {
  const parsed = R.parseRange(text);
  if (parsed.error) throw new Error(parsed.error);
  const out = [];
  parsed.weights.forEach((weight, combo) => {
    if (weight > 0) out.push({ cards: R.COMBOS[combo], weight, group: R.CLASSES[R.COMBO_CLASS[combo]] });
  });
  return out;
}
const comboStrings = (text) => rangeList(text).map(({ cards: [a, b] }) => R.comboText(R.comboIndex(a, b))).sort();

const notation = NOTATION.map((c) => {
  const ours = c.ours ?? c.text;
  return { text: c.text, ours, pokerkit: c.pokerkit ?? ours, combos: comboStrings(ours) };
});

const exact = EXACT.map((spot) => {
  const r = equityVsRange(cards(spot.hero), rangeList(spot.range), cards(spot.board));
  if (r.method !== "exact") throw new Error(`${spot.id} is not exact`);
  return { ...spot, method: r.method, combos: r.combos, weight: r.weight, runouts_per_combo: r.runoutsPerCombo, equity: r.equity };
});

const preflop = PREFLOP.map((spot) => {
  const hero = cards(spot.hero), range = rangeList(spot.range);
  const mc = equityVsRange(hero, range, [], { trials: PREFLOP_TRIALS, seed: PREFLOP_SEED });
  const full = equityVsRange(hero, range, [], { exactLimit: Infinity });
  return {
    ...spot, combos: full.combos, weight: full.weight, runouts_per_combo: full.runoutsPerCombo,
    exact_equity: full.equity,
    monte_carlo: { trials: mc.trials, seed: PREFLOP_SEED, equity: mc.equity, standard_error: mc.standardError },
  };
});

process.stdout.write(JSON.stringify({ node: process.version, notation, exact, preflop }));
