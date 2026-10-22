// Runnable checks for the JS engines:  node engines/test_engines.js
// Validates the hand evaluator / equity against published matchups and the
// CFR solver against the known Kuhn-poker equilibrium.

const E = require("./equity.js");
const { trainKuhnTracked, averageGameValue } = require("./cfr.js");
const C = E.strToCard;

let failed = 0;
function check(name, got, expect, tol){
  const ok = Math.abs(got - expect) <= tol;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${got.toFixed(3)} (expect ${expect}±${tol})`);
  if (!ok) failed++;
}
const eq = (h,v,tr,sd)=> E.equityMC(h.map(C), v.map(C), [], tr, sd).equity*100;

console.log("== Equity (preflop, published equities) ==");
check("AA vs KK",  eq(["Ah","Ad"],["Kh","Kd"],80000,1), 82.6, 1.0);
check("AKs vs 22", eq(["Ah","Kh"],["2c","2d"],80000,2), 49.9, 1.5);
check("72o vs AA", eq(["7c","2d"],["Ah","Ac"],80000,6), 12.0, 1.5);

function expectTrue(name, ok){
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}

console.log("== Evaluator ordering ==");
const score=(cards)=>E.best7(cards.split(" ").map(C));
const ladder=[
  ["royal flush",        "Ah Kh Qh Jh Th 2c 2d"],
  ["steel wheel",        "5d 4d 3d 2d Ad Kc Kh"],
  ["quads, ace kicker",  "9c 9d 9h 9s Ac 2d 3h"],
  ["quads, king kicker", "9c 9d 9h 9s Kc Kd Kh"],
  ["aces full",          "Ac Ad Ah 2c 2d 7h 8s"],
  ["twos full of aces",  "2c 2d 2h Ac Ad 7h 8s"],
  ["ace-high flush",     "Ah Jh 8h 4h 2h Kc Kd"],
  ["broadway straight",  "Ac Kd Qh Js Tc 2d 3h"],
  ["six-high straight",  "6c 5d 4h 3s 2c Kd Kh"],
  ["wheel straight",     "5c 4d 3h 2s Ac Kd Qh"],
  ["trip aces",          "Ac Ad Ah Kc 9d 7h 2s"],
  ["aces up, king kick", "Ac Ad 8h 8s 3c 3d Kh"],
  ["aces up, queen kick","Ac Ad 8h 8s Qc 2d 3h"],
  ["pair of aces",       "Ac Ad Kh Qs 9c 4d 2h"],
  ["ace high",           "Ac Kd Qh 9s 7c 4d 2h"],
  ["king high",          "Kc Qd Jh 9s 7c 4d 2h"],
];
for (let i = 1; i < ladder.length; i++) {
  expectTrue(`${ladder[i-1][0]} > ${ladder[i][0]}`, score(ladder[i-1][1]) > score(ladder[i][1]));
}
expectTrue("board plays: identical best five split", score("Ac Kd Qh Js Tc 2d 3h") === score("Ah Ks Qc Jd Th 4c 5s"));

// Reference evaluator: rank every 5-card subset with the textbook grouping
// rules. Kept here so the fast bitmask evaluator is checked against an
// independent implementation.
function referenceRank5(cs){
  const rs=cs.map(c=>c%13).sort((a,b)=>b-a), ss=cs.map(c=>(c/13)|0);
  const flush=ss.every(s=>s===ss[0]), cnt={};
  rs.forEach(r=>cnt[r]=(cnt[r]||0)+1);
  const groups=Object.keys(cnt).map(Number).sort((a,b)=>(cnt[b]-cnt[a])||(b-a)), counts=groups.map(g=>cnt[g]);
  const uniq=[...new Set(rs)].sort((a,b)=>b-a);
  let straight=-1;
  if(uniq.length===5){ if(uniq[0]-uniq[4]===4) straight=uniq[0]; else if(uniq[0]===12&&uniq[1]===3&&uniq[4]===0) straight=3; }
  let cat,tie;
  if(straight>=0&&flush){cat=8;tie=[straight];}
  else if(counts[0]===4){cat=7;tie=groups;}
  else if(counts[0]===3&&counts[1]===2){cat=6;tie=groups;}
  else if(flush){cat=5;tie=rs;}
  else if(straight>=0){cat=4;tie=[straight];}
  else if(counts[0]===3){cat=3;tie=groups;}
  else if(counts[0]===2&&counts[1]===2){cat=2;tie=groups;}
  else if(counts[0]===2){cat=1;tie=groups;}
  else{cat=0;tie=rs;}
  let s=cat; for(let i=0;i<5;i++) s=s*15+(i<tie.length?tie[i]+1:0);
  return s;
}
function referenceBest(cards){
  let best=-1; const n=cards.length;
  for(let a=0;a<n;a++)for(let b=a+1;b<n;b++)for(let c=b+1;c<n;c++)for(let d=c+1;d<n;d++)for(let e=d+1;e<n;e++){
    const s=referenceRank5([cards[a],cards[b],cards[c],cards[d],cards[e]]); if(s>best)best=s;
  }
  return best;
}
console.log("== Fast evaluator vs reference (random 5/6/7-card hands) ==");
{
  let state=2024;
  const rnd=()=>{state=(Math.imul(state,1103515245)+12345)>>>0;return state/4294967296;};
  let mismatches=0; const categories=new Set();
  for(const [n,count] of [[5,30000],[6,30000],[7,120000]]){
    for(let i=0;i<count;i++){
      const deck=Array.from({length:52},(_,c)=>c);
      for(let k=0;k<n;k++){const j=k+Math.floor(rnd()*(52-k));[deck[k],deck[j]]=[deck[j],deck[k]];}
      const hand=deck.slice(0,n), expected=referenceBest(hand);
      if(E.scoreHand(hand,n)!==expected) mismatches++;
      categories.add(Math.floor(expected/759375));
    }
  }
  expectTrue(`0 mismatches in 180,000 hands (${mismatches} found), ${categories.size} hand categories seen`, mismatches===0);
}

console.log("== Seeded results are reproducible ==");
// Recorded from the previous (21-subset) evaluator; the fast evaluator and the
// allocation-free loops must reproduce them exactly for the same seed.
const H=(...cards)=>cards.map(C);
const regression=[
  ["MC AA v KK seed 1",         E.equityMC(H("Ah","Ad"),H("Kh","Kd"),[],20000,1),                                    [16556,110,3334]],
  ["MC 72o v AA seed 6",        E.equityMC(H("7c","2d"),H("Ah","Ac"),[],20000,6),                                    [2356,82,17562]],
  ["MC flop seed 7",            E.equityMC(H("Ah","Kh"),H("Qs","Qd"),H("Th","7h","2c"),20000,7),                       [11016,0,8984]],
  ["exact flop",                E.equityExact(H("Ah","Kh"),H("Qs","Qd"),H("Th","7h","2c")),                           [539,0,451]],
  ["exact turn",                E.equityExact(H("9s","8s"),H("Ac","Ad"),H("7s","6d","2s","Kh")),                      [15,0,29]],
  ["3-way fixed seed 9",        E.equityMultiwayMC(H("Ah","Ad"),[H("Kh","Kd"),H("Qh","Qd")],[],20000,9),              [13480,115,6405]],
  ["5 random seed 3",           E.equityMultiwayMC(H("Ah","Kd"),[null,null,null,null,null],[],20000,3),               [5514,391,14095]],
  ["mixed + flop seed 11",      E.equityMultiwayMC(H("Jh","Th"),[H("As","Ks"),null,null],H("9h","8c","2h"),20000,11), [11958,271,7771]],
];
for (const [name, result, [win, tie, lose]] of regression) {
  expectTrue(`${name}: ${result.win}/${result.tie}/${result.lose}`, result.win===win && result.tie===tie && result.lose===lose);
}

console.log("== MC vs exact (flop) ==");
const h=["Ah","Kh"].map(C), v=["Qs","Qd"].map(C), b=["Th","7h","2c"].map(C);
check("MC≈exact", E.equityMC(h,v,b,60000,7).equity*100, E.equityExact(h,v,b).equity*100, 1.0);

console.log("== Multiway equity ==");
const mw=E.equityMultiwayMC([C("Ah"),C("Ad")],[[C("Kh"),C("Kd")],[C("Qh"),C("Qd")]],[],70000,9);
check("AA vs KK vs QQ",mw.equity*100,68.0,1.5);
const split=E.equityMultiwayMC([C("Ah"),C("Kd")],[[C("As"),C("Kc")],[C("Ad"),C("Kh")]],[["2c","3d","4h","5s","6c"].map(C)][0],1,1);
check("three-way board split",split.equity,1/3,0.0001);

console.log("== CFR Kuhn poker ==");
const r = trainKuhnTracked(300000, 10);
check("game value", averageGameValue(r.nodes), -1/18, 0.01);
const bJ=r.strategy.J[1], bK=r.strategy.K[1], bQ=r.strategy.Q[1];
check("K/J bet ratio", bK/bJ, 3.0, 0.7);
check("Q bets first ~0", bQ, 0.0, 0.05);
check("K always calls", r.strategy.Kb[1], 1.0, 0.02);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll engine checks passed.");
process.exit(failed ? 1 : 0);
