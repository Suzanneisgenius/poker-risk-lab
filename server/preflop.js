"use strict";

/*
 * Demonstration-only preflop dataset.
 *
 * These frequencies are intentionally labelled as illustrative in the UI.
 * The module is structured so licensed solver exports can replace the demo
 * builders without changing the public interface.
 */

const { ValidationError } = require("./errors.js");

const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const RANK_VALUE = Object.fromEntries(RANKS.map((rank, index) => [rank, 14 - index]));
const ACTIONS = ["raise", "call", "jam", "fold"];

const SCENARIO_SPECS = [
  {
    id: "cash-6max-100-btn-rfi-25",
    title: "BTN open 2.5bb · 6-max Cash · 100bb",
    game: "Cash",
    table: "6-max",
    stack: 100,
    hero: "BTN",
    situation: "First in",
    opponent: "Blinds",
    openSize: "2.5bb",
    family: "rfi",
    looseness: 61,
  },
  {
    id: "cash-6max-40-btn-rfi-25",
    title: "BTN open 2.5bb · 6-max Cash · 40bb",
    game: "Cash",
    table: "6-max",
    stack: 40,
    hero: "BTN",
    situation: "First in",
    opponent: "Blinds",
    openSize: "2.5bb",
    family: "rfi",
    looseness: 64,
  },
  {
    id: "cash-6max-100-co-rfi-25",
    title: "CO open 2.5bb · 6-max Cash · 100bb",
    game: "Cash",
    table: "6-max",
    stack: 100,
    hero: "CO",
    situation: "First in",
    opponent: "BTN / Blinds",
    openSize: "2.5bb",
    family: "rfi",
    looseness: 54,
  },
  {
    id: "cash-6max-100-bb-vs-btn",
    title: "BB defense vs BTN 2.5bb · 6-max Cash · 100bb",
    game: "Cash",
    table: "6-max",
    stack: 100,
    hero: "BB",
    situation: "Facing open",
    opponent: "BTN",
    openSize: "2.5bb",
    family: "defend",
    looseness: 67,
  },
  {
    id: "cash-6max-40-sb-vs-btn",
    title: "SB response vs BTN 2.5bb · 6-max Cash · 40bb",
    game: "Cash",
    table: "6-max",
    stack: 40,
    hero: "SB",
    situation: "Facing open",
    opponent: "BTN",
    openSize: "2.5bb",
    family: "attack",
    looseness: 48,
  },
];

function handAt(row, column) {
  const rowRank = RANKS[row];
  const columnRank = RANKS[column];
  if (row === column) return `${rowRank}${columnRank}`;
  return row < column ? `${rowRank}${columnRank}s` : `${columnRank}${rowRank}o`;
}

function handMeta(hand) {
  const pair = hand.length === 2;
  const suited = hand.endsWith("s");
  const rankA = hand[0];
  const rankB = hand[1];
  const high = Math.max(RANK_VALUE[rankA], RANK_VALUE[rankB]);
  const low = Math.min(RANK_VALUE[rankA], RANK_VALUE[rankB]);
  const gap = Math.max(0, high - low - 1);
  const broadway = (high >= 10 ? 1 : 0) + (low >= 10 ? 1 : 0);
  const wheelAce = high === 14 && low <= 5;
  let score = high * 3.2 + low * 1.55 - gap * 2.35;
  if (pair) score = 62 + high * 3.35;
  if (suited) score += 8.5;
  if (!pair && broadway === 2) score += 7;
  if (!pair && gap === 0) score += 5;
  if (!pair && gap === 1) score += 2.5;
  if (wheelAce && suited) score += 5;
  return { pair, suited, high, low, gap, broadway, wheelAce, score };
}

function roundFive(value) {
  return Math.max(0, Math.min(100, Math.round(value / 5) * 5));
}

function complete(actions) {
  const result = { raise: 0, call: 0, jam: 0, fold: 0, ...actions };
  const aggressive = result.raise + result.call + result.jam;
  result.fold = Math.max(0, 100 - aggressive);
  return result;
}

function rfiStrategy(spec, hand, meta) {
  const threshold = 83 - spec.looseness * 0.52;
  let raise = roundFive((meta.score - threshold) * 7.2 + 50);
  if (meta.pair && meta.high >= 7) raise = 100;
  if (meta.suited && meta.high === 14 && meta.low >= 7) raise = 100;
  if (hand === "A5s" && spec.stack === 100 && spec.hero === "BTN") raise = 60;
  if (hand === "A5s" && spec.stack === 40 && spec.hero === "BTN") raise = 85;
  if (hand === "K2s" && spec.hero === "BTN") raise = spec.stack === 40 ? 45 : 25;
  return complete({ raise });
}

function defendStrategy(spec, hand, meta) {
  const continueThreshold = 60 - spec.looseness * 0.19;
  const continuePct = roundFive((meta.score - continueThreshold) * 5.4 + 55);
  let raise = 0;
  let jam = 0;
  if (meta.pair && meta.high >= 11) raise = meta.high >= 13 ? 85 : 55;
  else if (hand === "AKs" || hand === "AKo") raise = 80;
  else if (meta.suited && meta.high === 14 && meta.low <= 5) raise = 35;
  else if (meta.suited && meta.gap <= 1 && meta.high <= 10) raise = 20;
  if (spec.stack <= 40 && ((meta.pair && meta.high >= 11) || hand === "AKs")) {
    jam = meta.pair && meta.high >= 13 ? 70 : 35;
    raise = 0;
  }
  const call = Math.max(0, Math.min(100 - raise - jam, continuePct - raise - jam));
  return complete({ raise, call, jam });
}

function attackStrategy(spec, hand, meta) {
  let jam = 0;
  let raise = 0;
  let call = 0;
  if (meta.pair && meta.high >= 10) jam = meta.high >= 13 ? 100 : 65;
  else if (hand === "AKs" || hand === "AKo") jam = 85;
  else if (hand === "AQs" || hand === "AQo") jam = 45;
  else if (meta.suited && meta.high === 14 && meta.low <= 5) jam = 30;
  else if (meta.score >= 78) raise = 70;
  else if (meta.score >= 66) raise = 35;
  if (!jam && meta.score >= 62) call = Math.max(0, 75 - raise);
  if (hand === "A5s") ({ jam, raise, call } = { jam: 55, raise: 0, call: 20 });
  return complete({ raise, call, jam });
}

function strategyFor(spec, hand) {
  const meta = handMeta(hand);
  if (spec.family === "rfi") return rfiStrategy(spec, hand, meta);
  if (spec.family === "attack") return attackStrategy(spec, hand, meta);
  return defendStrategy(spec, hand, meta);
}

function combosFor(hand) {
  if (hand.length === 2) return 6;
  return hand.endsWith("s") ? 4 : 12;
}

function guidanceFor(actions) {
  const available = ACTIONS.filter((action) => action !== "fold" && actions[action] > 0);
  if (!available.length) return "This hand usually sits outside the continuing range in this demo spot.";
  const sorted = available.sort((a, b) => actions[b] - actions[a]);
  if (sorted.length > 1) return `This is a mixed demo decision: mostly ${sorted[0]}, with some ${sorted[1]} to keep the range varied.`;
  if (actions.fold > 0) return `This is a mixed demo decision: ${sorted[0]} sometimes and fold the rest.`;
  return `This hand takes the ${sorted[0]} action throughout this demonstration range.`;
}

function buildScenario(spec) {
  const hands = [];
  for (let row = 0; row < RANKS.length; row += 1) {
    for (let column = 0; column < RANKS.length; column += 1) {
      const hand = handAt(row, column);
      const actions = strategyFor(spec, hand);
      hands.push({
        hand,
        row,
        column,
        combos: combosFor(hand),
        actions,
        guidance: guidanceFor(actions),
      });
    }
  }
  return {
    id: spec.id,
    title: spec.title,
    game: spec.game,
    table: spec.table,
    stack: spec.stack,
    hero: spec.hero,
    situation: spec.situation,
    opponent: spec.opponent,
    openSize: spec.openSize,
    hands,
  };
}

const SCENARIOS = new Map(SCENARIO_SPECS.map((spec) => [spec.id, buildScenario(spec)]));

function scenarioSummary(scenario) {
  const { hands, ...metadata } = scenario;
  return metadata;
}

function getPreflopDataset(scenarioId = SCENARIO_SPECS[0].id) {
  const scenario = SCENARIOS.get(scenarioId);
  if (!scenario) throw new ValidationError("Choose an available preflop scenario.");
  return {
    dataset: {
      id: "demo-preflop-v1",
      label: "Demo strategy dataset",
      solverVerified: false,
      note: "Illustrative frequencies for interface evaluation. Import licensed solver output before using these ranges for strategy decisions.",
    },
    scenarios: [...SCENARIOS.values()].map(scenarioSummary),
    scenario,
  };
}

module.exports = { ACTIONS, RANKS, getPreflopDataset };
