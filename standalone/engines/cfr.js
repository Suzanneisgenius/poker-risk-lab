// Vanilla Counterfactual Regret Minimization (CFR) on Kuhn poker.
//
// Kuhn poker: a 3-card deck (J<Q<K), each player antes 1 and is dealt one card.
// Player 0 acts first: pass (check) or bet (1). Standard betting tree. CFR
// converges to a Nash equilibrium; the known game value to player 0 is -1/18.
//
// This is a faithful, compact teaching implementation (Neller & Lanctot style).
// The same code is inlined into the suite HTML.

const PASS = 0, BET = 1, NACTIONS = 2;
const CARD_NAMES = ["J", "Q", "K"];

function makeNode(){
  return { regretSum: [0,0], strategySum: [0,0], strategy: [0,0] };
}

function getStrategy(node, realizationWeight){
  let normal = 0;
  for (let a=0;a<NACTIONS;a++){
    node.strategy[a] = node.regretSum[a] > 0 ? node.regretSum[a] : 0;
    normal += node.strategy[a];
  }
  for (let a=0;a<NACTIONS;a++){
    node.strategy[a] = normal > 0 ? node.strategy[a]/normal : 1/NACTIONS;
    node.strategySum[a] += realizationWeight * node.strategy[a];
  }
  return node.strategy;
}

function averageStrategy(node){
  const avg=[0,0]; let normal=0;
  for (let a=0;a<NACTIONS;a++) normal += node.strategySum[a];
  for (let a=0;a<NACTIONS;a++) avg[a] = normal>0 ? node.strategySum[a]/normal : 1/NACTIONS;
  return avg;
}

// Recursive CFR. `cards` is the dealt permutation; `history` the action string.
function cfr(nodes, cards, history, p0, p1){
  const plays = history.length;
  const player = plays % 2;
  const opponent = 1 - player;

  if (plays >= 2){
    const terminalPass = history[history.length-1] === "p";
    const doubleBet = history.slice(-2) === "bb";
    const higher = cards[player] > cards[opponent];
    if (terminalPass){
      if (history === "pp") return higher ? 1 : -1;
      return 1; // opponent bet, current player passed earlier -> last actor wins the ante
    } else if (doubleBet){
      return higher ? 2 : -2;
    }
  }

  const infoSet = CARD_NAMES[cards[player]] + history;
  let node = nodes[infoSet];
  if (!node){ node = makeNode(); nodes[infoSet] = node; }

  const strategy = getStrategy(node, player === 0 ? p0 : p1);
  const util = [0,0];
  let nodeUtil = 0;
  for (let a=0;a<NACTIONS;a++){
    const nextHistory = history + (a === PASS ? "p" : "b");
    util[a] = player === 0
      ? -cfr(nodes, cards, nextHistory, p0 * strategy[a], p1)
      : -cfr(nodes, cards, nextHistory, p0, p1 * strategy[a]);
    nodeUtil += strategy[a] * util[a];
  }
  for (let a=0;a<NACTIONS;a++){
    const regret = util[a] - nodeUtil;
    node.regretSum[a] += (player === 0 ? p1 : p0) * regret;
  }
  return nodeUtil;
}

function permutations(arr){
  if (arr.length <= 1) return [arr];
  const out=[];
  arr.forEach((v,i)=>{
    const rest=arr.slice(0,i).concat(arr.slice(i+1));
    for (const p of permutations(rest)) out.push([v, ...p]);
  });
  return out;
}

// Small deterministic RNG so repeated training runs with the same seed match.
function cfrMulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

// Train for `iters` iterations. Returns {value, strategy: {infoSet:[pPass,pBet]}}.
function trainKuhn(iters, seed=42){
  const nodes = {};
  const deals = permutations([0,1,2]);
  const rnd = cfrMulberry32(seed>>>0);
  let value = 0;
  for (let i=0;i<iters;i++){
    const cards = deals[Math.floor(rnd()*deals.length)];
    value += cfr(nodes, cards, "", 1, 1);
  }
  const strategy = {};
  for (const k of Object.keys(nodes).sort()) strategy[k] = averageStrategy(nodes[k]);
  return { value: value/iters, strategy, nodes };
}

// Exploitability proxy: exact game value under the average strategy, computed by
// enumerating all 6 deals and both players following the average strategy.
function averageGameValue(nodes){
  const deals = permutations([0,1,2]);
  const avg = {};
  for (const k of Object.keys(nodes)) avg[k] = averageStrategy(nodes[k]);
  function walk(cards, history){
    const plays=history.length, player=plays%2, opponent=1-player;
    if (plays>=2){
      const terminalPass = history[history.length-1]==="p";
      const doubleBet = history.slice(-2)==="bb";
      const higher = cards[player] > cards[opponent];
      if (terminalPass){ if (history==="pp") return higher?1:-1; return 1; }
      else if (doubleBet){ return higher?2:-2; }
    }
    const infoSet = CARD_NAMES[cards[player]] + history;
    const s = avg[infoSet] || [0.5,0.5];
    let u=0;
    u += s[PASS]*(-walk(cards, history+"p"));
    u += s[BET]*(-walk(cards, history+"b"));
    return u;
  }
  let v=0; for (const d of deals) v += walk(d, "");
  return v/deals.length;
}

// Like trainKuhn but records the running average game value at intervals so the
// UI can draw a convergence curve.
function trainKuhnTracked(iters, samples, seed=42){
  const nodes = {};
  const deals = permutations([0,1,2]);
  const rnd = cfrMulberry32(seed>>>0);
  let value = 0;
  const history = [];
  const every = Math.max(1, Math.floor(iters / (samples || 40)));
  for (let i=0;i<iters;i++){
    const cards = deals[Math.floor(rnd()*deals.length)];
    value += cfr(nodes, cards, "", 1, 1);
    if ((i+1) % every === 0) history.push({ iter: i+1, value: value/(i+1) });
  }
  const strategy = {};
  for (const k of Object.keys(nodes).sort()) strategy[k] = averageStrategy(nodes[k]);
  return { value: value/iters, strategy, nodes, history };
}

if (typeof module!=="undefined") module.exports =
  { trainKuhn, trainKuhnTracked, averageGameValue, CARD_NAMES };
