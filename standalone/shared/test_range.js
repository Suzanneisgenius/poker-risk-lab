"use strict";
// Range notation checks:  node standalone/shared/test_range.js
// PokerKit's parser is compared separately in checks/range-equity-pokerkit/.
const assert = require("node:assert/strict");
const R = require("./range.js");
const { computePreflop } = require("../../server/compute.js");

const parse = (text) => {
  const parsed = R.parseRange(text);
  assert.equal(parsed.error, undefined, `${text}: ${parsed.error}`);
  return parsed.weights;
};
const count = (text) => R.summarize(parse(text)).combos;
const canonical = (text) => R.formatRange(parse(text));
const errorOf = (text) => R.parseRange(text).error;

// --- Combo and class tables --------------------------------------------------
assert.equal(R.COMBOS.length, 1326);
assert.equal(new Set(R.COMBOS.map(([a, b]) => `${a},${b}`)).size, 1326);
R.COMBOS.forEach(([a, b], index) => assert.equal(R.comboIndex(b, a), index));
assert.equal(R.CLASSES.length, 169);
assert.deepEqual([...new Set(R.CLASS_COMBOS.map((list) => list.length))].sort(), [12, 4, 6]);
assert.equal(R.CLASS_COMBOS.flat().length, 1326, "every combo belongs to exactly one starting hand");
// Same matrix orientation as the Preflop tab: aces top-left, suited above the diagonal.
const preflop = computePreflop({ scenarioId: computePreflop({}).scenarios[0].id }).scenario;
for (const hand of preflop.hands) assert.equal(R.classAt(hand.row, hand.column), hand.hand);

// --- Notation ----------------------------------------------------------------
const cases = [
  ["AA", 6, "AA"], ["QQ+", 18, "QQ+"], ["22+", 78, "22+"], ["AKs", 4, "AKs"], ["AKo", 12, "AKo"],
  ["AK", 16, "AK"], ["KA", 16, "AK"], ["ATs+", 16, "ATs+"], ["KTo+", 36, "KTo+"], ["AT+", 64, "AT+"],
  ["A5s-A2s", 16, "A5s-A2s"], ["A2s-A5s", 16, "A5s-A2s"], ["K9o-K6o", 48, "K9o-K6o"],
  ["22-55", 24, "55-22"], ["99-66", 24, "99-66"], ["T9s-65s", 20, "T9s, 98s, 87s, 76s, 65s"],
  ["AsKs", 1, "AsKs"], ["AhKd, AdKh", 2, "AdKh, AhKd"], ["AhAs", 1, "AsAh"], ["AsKs, AhKh, AdKd, AcKc", 4, "AKs"],
  ["QQ+, KK:0", 12, "AA, QQ"], ["AKs:0.5", 2, "AKs:0.5"], ["AKs:50%", 2, "AKs:0.5"], ["AK:.25", 4, "AK:0.25"],
  ["qq+ , aks;ako", 34, "QQ+, AK"], ["QQ +, AKs : 0.5", 20, "QQ+, AKs:0.5"], ["A10s", 4, "ATs"],
  ["AA+", 6, "AA"], ["AKs+", 4, "AKs"], ["QQo", 6, "QQ"], ["", 0, ""], [" , ", 0, ""],
  ["TT+, AQs+, AKo", 50, "TT+, AQs+, AKo"], ["JJ-88, AJs-A9s, KQo", 48, "JJ-88, AJs-A9s, KQo"],
];
for (const [text, combos, formatted] of cases) {
  assert.equal(count(text), combos, `${text} has ${combos} combos`);
  assert.equal(canonical(text), formatted, `${text} formats as ${formatted}`);
}
for (const bad of ["AKx", "QQs", "QQs+", "AK-QQ", "AKs-AQo", "AK-QT", "AsAs", "AKs:1.5", "AKs:-1", "AKs:abc", "AKs:0.5:1", ":0.5", "any", "A1s", "AKss"]) {
  assert.ok(errorOf(bad), `${bad} is rejected`);
}
assert.match(errorOf("aks, akx"), /“akx”/, "errors quote the entry as typed");
assert.match(errorOf("x".repeat(20001)), /too long/);

// --- Formatting round trip ---------------------------------------------------
// Random class-level and combo-level ranges survive format -> parse unchanged.
let state = 20261022;
const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
const levels = [0, 0, 0, 1, 1, 0.5, 0.25, 0.75, 0.1];
for (let trial = 0; trial < 300; trial++) {
  const weights = new Float64Array(1326);
  R.CLASS_COMBOS.forEach((list) => {
    const w = levels[Math.floor(random() * levels.length)];
    for (const combo of list) weights[combo] = trial % 3 === 0 && random() < 0.1 ? levels[Math.floor(random() * levels.length)] : w;
  });
  const text = R.formatRange(weights);
  assert.deepEqual(parse(text), weights, `round trip: ${text.slice(0, 80)}`);
}

// --- Summaries, matrix cells and toggling --------------------------------------
const tens = parse("TT+, AKs");
assert.deepEqual(R.summarize(tens), { combos: 34, live: 34, hands: 6, share: 34 / 1326 });
const deadAce = 3 * 13 + 12, deadKing = 3 * 13 + 11; // As, Ks
assert.equal(R.summarize(tens, [deadAce, deadKing]).live, 30 - 3 - 3 + 3, "card removal: AA and KK lose 3 combos each, AKs keeps 3");
const aks = R.CLASS_INDEX.get("AKs");
assert.deepEqual(R.classState(parse("AKs:0.5"), aks), { weight: 0.5, mixed: false });
assert.deepEqual(R.classState(parse("AsKs"), aks), { weight: 0.25, mixed: true });
assert.equal(R.formatRange(R.toggleClass(parse("QQ+"), aks)), "QQ+, AKs", "toggle adds a hand");
assert.equal(R.formatRange(R.toggleClass(parse("QQ+, AKs"), aks)), "QQ+", "toggle removes a full hand");
assert.equal(R.formatRange(R.toggleClass(parse("AKs:0.5"), aks)), "AKs", "toggle fills a partial hand");

// --- Hand order and Top % ------------------------------------------------------
const order = R.handOrder().hands;
assert.equal(order.length, 169);
assert.deepEqual(new Set(order.map((h) => h.hand)), new Set(R.CLASSES));
order.slice(1).forEach((h, i) => assert.ok(order[i].equity >= h.equity, "sorted by equity"));
assert.equal(order[0].hand, "AA");
assert.equal(order.at(-1).hand, "32o");
// Published PokerStove values against a random hand: AA 85.2%, 32o 32.3%.
assert.ok(Math.abs(order[0].equity - 0.852) < 0.001 && Math.abs(order.at(-1).equity - 0.323) < 0.001);
assert.equal(R.formatRange(R.topPercent(0)), "");
assert.equal(R.summarize(R.topPercent(100)).combos, 1326);
let previous = 0;
for (let pct = 1; pct <= 100; pct++) {
  const combos = R.summarize(R.topPercent(pct)).combos;
  assert.ok(combos >= previous, "Top % never shrinks as the percentage grows");
  // The closest prefix of the order is never more than half a hand (6 combos) off.
  assert.ok(Math.abs(combos - pct / 100 * 1326) <= 6, `top ${pct}% lands within 6 combos`);
  previous = combos;
}
assert.equal(R.formatRange(R.topPercent(5)), "77+, AJs+, AKo");

console.log("PASS: range tables, notation (pairs, +, dashes, connectors, combos, weights, overrides), errors, format round trip, card removal, matrix cells and toggling, hand order, Top %.");
