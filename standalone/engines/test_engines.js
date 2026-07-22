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

console.log("== Evaluator ordering ==");
const gt=(a,b)=>E.best7(a.map(C))>E.best7(b.map(C));
console.log((gt(["Ah","Kh","Qh","Jh","Th","2c","2d"],["As","Ac","Ad","Ah","Kh","Kd","2c"])?"PASS":"FAIL")+"  royal flush > quads");
console.log((gt(["5h","6d","7c","8s","9h","2c","2d"],["Ah","Ad","As","7c","9h","2c","3d"])?"PASS":"FAIL")+"  straight > trips");

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
