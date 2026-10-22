#!/usr/bin/env node
// Our side of the PokerKit cross-check: deterministic test cases and this
// project's answers for them, printed as JSON for run.py to compare.
"use strict";

const { strToCard, cardToStr, scoreHand, equityExact, equityMultiwayMC } = require("../../standalone/engines/equity.js");

const HAND_COUNT = 20000;
const HAND_SEED = 20261022;
const MULTIWAY_TRIALS = 150000;
const MULTIWAY_SEED = 1;

// Heads-up spots, enumerated exactly. Chosen to cover preflop, draws, a
// paired board, a full-house-over-full-house runout and a split pot.
const HEADS_UP = [
  { id: "preflop-AKs-vs-QQ", hero: "AsKs", villain: "QhQd", board: "" },
  { id: "preflop-76s-vs-AKo", hero: "7c6c", villain: "AhKd", board: "" },
  { id: "flop-flush-draw", hero: "AhKh", villain: "9s9d", board: "Qh7h2c" },
  { id: "flop-combo-draw", hero: "8d7d", villain: "AcAs", board: "9d6c2d" },
  { id: "flop-trips-board", hero: "KdKc", villain: "QsQh", board: "AsAhAd" },
  { id: "turn-flush-draw", hero: "JcTc", villain: "KsKh", board: "Qc9h3c2s" },
  { id: "river-split", hero: "AdQd", villain: "AcQc", board: "KsJhTc4d4h" },
];
// Three-way spot: our multiway Monte Carlo against PokerKit's exact enumeration.
const MULTIWAY = { id: "flop-three-way", hands: ["AsKd", "QhQc", "8s7s"], board: "Js9s2d" };

const split = (text) => (text.match(/../g) || []).map(strToCard);

function sfc32(seed) {
  let a = seed | 0, b = 0x9e3779b9, c = 0x243f6a88, d = 1;
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11); c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i += 1) next();
  return next;
}

// Random 7-card hands (partial Fisher-Yates per hand).
const random = sfc32(HAND_SEED);
const deck = Array.from({ length: 52 }, (_, i) => i);
const hands = [];
for (let n = 0; n < HAND_COUNT; n += 1) {
  for (let i = 0; i < 7; i += 1) {
    const j = i + Math.floor(random() * (52 - i));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const cards = deck.slice(0, 7);
  hands.push({ cards: cards.map(cardToStr).join(""), score: scoreHand(Uint8Array.from(cards), 7) });
}

const headsUp = HEADS_UP.map((spot) => {
  const r = equityExact(split(spot.hero), split(spot.villain), split(spot.board));
  return { ...spot, win: r.win, tie: r.tie, lose: r.lose, runouts: r.trials, equity: r.equity };
});

const [hero, ...opponents] = MULTIWAY.hands.map(split);
const mw = equityMultiwayMC(hero, opponents, split(MULTIWAY.board), MULTIWAY_TRIALS, MULTIWAY_SEED);

process.stdout.write(JSON.stringify({
  node: process.version,
  hand_seed: HAND_SEED,
  hands,
  heads_up: headsUp,
  multiway: { ...MULTIWAY, trials: MULTIWAY_TRIALS, seed: MULTIWAY_SEED, equity: mw.equity, win: mw.win, tie: mw.tie, lose: mw.lose },
}));
