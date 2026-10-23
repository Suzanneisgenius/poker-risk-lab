#!/usr/bin/env node
// Seven-card evaluator: the earlier evaluator against the current one, on the
// same machine, the same hands and the same Node process.
//
//   node checks/evaluator-benchmark/run.js           print
//   node checks/evaluator-benchmark/run.js --write   also save results.json
//
// Speed depends on the machine, Node version and load; results.json records
// all three. Agreement (identical scores on every hand) does not.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { scoreHand } = require("../../standalone/engines/equity.js");

const HANDS = 200000;
const REPEATS = 7;
const SEED = 20261022;

// --- earlier evaluator --------------------------------------------------------
// Copied from standalone/engines/equity.js at commit 890d39a (rank5, C7, best7):
// ranks all 21 five-card subsets and allocates arrays for each.
function rank5(cs){
  const rs = cs.map(c=>c%13).sort((a,b)=>b-a);
  const ss = cs.map(c=>(c/13)|0);
  const flush = ss.every(s=>s===ss[0]);
  const cnt = {};
  rs.forEach(r=>cnt[r]=(cnt[r]||0)+1);
  const groups = Object.keys(cnt).map(Number).sort((a,b)=> (cnt[b]-cnt[a]) || (b-a));
  const counts = groups.map(g=>cnt[g]);
  const uniq = [...new Set(rs)].sort((a,b)=>b-a);
  let isStraight=false, sHigh=-1;
  if (uniq.length===5){
    if (uniq[0]-uniq[4]===4){ isStraight=true; sHigh=uniq[0]; }
    else if (uniq[0]===12 && uniq[1]===3 && uniq[4]===0){ isStraight=true; sHigh=3; }
  }
  let cat, tie;
  if (isStraight && flush){ cat=8; tie=[sHigh]; }
  else if (counts[0]===4){ cat=7; tie=groups; }
  else if (counts[0]===3 && counts[1]===2){ cat=6; tie=groups; }
  else if (flush){ cat=5; tie=rs; }
  else if (isStraight){ cat=4; tie=[sHigh]; }
  else if (counts[0]===3){ cat=3; tie=groups; }
  else if (counts[0]===2 && counts[1]===2){ cat=2; tie=groups; }
  else if (counts[0]===2){ cat=1; tie=groups; }
  else { cat=0; tie=rs; }
  let score = cat;
  for (let i = 0; i < 5; i++) score = score*15 + (i < tie.length ? tie[i]+1 : 0);
  return score;
}
const C7 = (function(){
  const out=[];
  for(let a=0;a<7;a++)for(let b=a+1;b<7;b++)for(let c=b+1;c<7;c++)
    for(let d=c+1;d<7;d++)for(let e=d+1;e<7;e++) out.push([a,b,c,d,e]);
  return out;
})();
function oldBest7(cards7){
  let best=-1;
  for(const cb of C7){
    const s = rank5([cards7[cb[0]],cards7[cb[1]],cards7[cb[2]],cards7[cb[3]],cards7[cb[4]]]);
    if(s>best) best=s;
  }
  return best;
}

// --- hands -------------------------------------------------------------------
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
const random = sfc32(SEED);
const deck = Array.from({ length: 52 }, (_, i) => i);
const flat = new Uint8Array(HANDS * 7);
for (let n = 0; n < HANDS; n += 1) {
  for (let i = 0; i < 7; i += 1) {
    const j = i + Math.floor(random() * (52 - i));
    [deck[i], deck[j]] = [deck[j], deck[i]];
    flat[n * 7 + i] = deck[i];
  }
}
const asArrays = Array.from({ length: HANDS }, (_, n) => Array.from(flat.subarray(n * 7, n * 7 + 7)));
const asBuffers = Array.from({ length: HANDS }, (_, n) => flat.subarray(n * 7, n * 7 + 7));

// --- agreement ------------------------------------------------------------------
let mismatches = 0;
for (let n = 0; n < HANDS; n += 1) if (oldBest7(asArrays[n]) !== scoreHand(asBuffers[n], 7)) mismatches += 1;

// --- speed ------------------------------------------------------------------------
function time(fn) {
  const rates = [];
  let sink = 0;
  fn(() => {});                                   // warm-up pass
  for (let r = 0; r < REPEATS; r += 1) {
    const start = process.hrtime.bigint();
    sink += fn();
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    rates.push(HANDS / seconds);
  }
  rates.sort((x, y) => x - y);
  return { evaluations_per_second: { min: Math.round(rates[0]), median: Math.round(rates[REPEATS >> 1]), max: Math.round(rates[REPEATS - 1]) }, sink };
}
const old = time(() => { let s = 0; for (let n = 0; n < HANDS; n += 1) s += oldBest7(asArrays[n]); return s; });
const current = time(() => { let s = 0; for (let n = 0; n < HANDS; n += 1) s += scoreHand(asBuffers[n], 7); return s; });

const result = {
  purpose: "Same hands, same process: earlier seven-card evaluator (commit 890d39a) against the current bitmask scorer.",
  command: "node checks/evaluator-benchmark/run.js --write",
  conditions: {
    cpu: os.cpus()[0]?.model || "unknown", cores: os.cpus().length, platform: `${os.platform()} ${os.release()}`,
    node: process.version, hands: HANDS, seed: SEED, repeats: REPEATS, warm_up: "one untimed pass per evaluator",
  },
  agreement: { hands: HANDS, score_mismatches: mismatches },
  earlier: { evaluations_per_second: old.evaluations_per_second },
  current: { evaluations_per_second: current.evaluations_per_second },
  median_speedup: Math.round((current.evaluations_per_second.median / old.evaluations_per_second.median) * 10) / 10,
  limits: "One machine, single thread, synthetic random hands; a micro-benchmark, not an end-to-end request time.",
};
if (process.argv.includes("--write")) fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(result, null, 2) + "\n");
const fmt = (v) => (v / 1e6).toFixed(2) + "M";
console.log(`${result.conditions.cpu} · Node ${process.version} · ${HANDS.toLocaleString()} hands × ${REPEATS}`);
console.log(`Agreement: ${mismatches} score mismatches`);
console.log(`Earlier: ${fmt(old.evaluations_per_second.median)}/s (min ${fmt(old.evaluations_per_second.min)}, max ${fmt(old.evaluations_per_second.max)})`);
console.log(`Current: ${fmt(current.evaluations_per_second.median)}/s (min ${fmt(current.evaluations_per_second.min)}, max ${fmt(current.evaluations_per_second.max)})`);
console.log(`Median speed-up ×${result.median_speedup}`);
