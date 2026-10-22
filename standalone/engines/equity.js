// Poker hand evaluator + equity engine (pure functions, no DOM).
// Card = 0..51.  rank = card % 13  (0=2 ... 8=T,9=J,10=Q,11=K,12=A)
// suit = Math.floor(card / 13)  (0..3)
//
// The same functions are inlined into the suite HTML; this module keeps them
// testable in isolation (see engines/test_engines.js).

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";

function cardToStr(c){ return RANKS[c%13] + SUITS[(c/13)|0]; }
function strToCard(s){
  const r = RANKS.indexOf(s[0].toUpperCase());
  const su = SUITS.indexOf(s[1].toLowerCase());
  if (r<0||su<0) throw new Error("bad card: "+s);
  return su*13 + r;
}

// Rank the best 5-card poker hand from exactly 5 cards -> comparable integer.
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
    else if (uniq[0]===12 && uniq[1]===3 && uniq[4]===0){ isStraight=true; sHigh=3; } // wheel A-5
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
  // Fixed-width encoding: category is always the dominant term, followed by
  // exactly 5 tiebreak slots (rank+1, zero-padded). Variable-length packing
  // would let, e.g., a pair outrank a straight.
  let score = cat;
  for (let i = 0; i < 5; i++) score = score*15 + (i < tie.length ? tie[i]+1 : 0);
  return score;
}

// 21 combinations of choosing 5 from 7.
const C7 = (function(){
  const out=[];
  for(let a=0;a<7;a++)for(let b=a+1;b<7;b++)for(let c=b+1;c<7;c++)
    for(let d=c+1;d<7;d++)for(let e=d+1;e<7;e++) out.push([a,b,c,d,e]);
  return out;
})();

function best7(cards7){
  let best=-1;
  for(const cb of C7){
    const s = rank5([cards7[cb[0]],cards7[cb[1]],cards7[cb[2]],cards7[cb[3]],cards7[cb[4]]]);
    if(s>best) best=s;
  }
  return best;
}

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

// Fisher-Yates partial shuffle to draw `k` cards from `deck` (mutates a copy).
function draw(deck, k, rnd){
  const d = deck.slice();
  for(let i=0;i<k;i++){
    const j = i + Math.floor(rnd()*(d.length-i));
    const t=d[i]; d[i]=d[j]; d[j]=t;
  }
  return d.slice(0,k);
}

// Monte Carlo equity of hero(2) vs villain(2) given board(0..5), seed.
function equityMC(hero, villain, board, trials, seed){
  const used = new Set([...hero, ...villain, ...board]);
  const deck=[]; for(let c=0;c<52;c++) if(!used.has(c)) deck.push(c);
  const need = 5 - board.length;
  const rnd = mulberry32(seed>>>0);
  let win=0, tie=0, lose=0;
  for(let t=0;t<trials;t++){
    const extra = need>0 ? draw(deck, need, rnd) : [];
    const full = board.concat(extra);
    const hs = best7(hero.concat(full));
    const vs = best7(villain.concat(full));
    if(hs>vs)win++; else if(hs<vs)lose++; else tie++;
  }
  return {win,tie,lose,trials,equity:(win+tie/2)/trials,method:"monte-carlo"};
}

// Hero equity against 1..5 opponents. Each opponent is either a fixed
// two-card array or null, in which case a legal random hand is dealt on every
// trial. Ties are split by the number of players sharing the best hand.
function equityMultiwayMC(hero, opponents, board, trials, seed){
  if(!Array.isArray(opponents)||opponents.length<1||opponents.length>5) throw new Error("opponents must contain 1..5 hands");
  const fixed=opponents.filter(Boolean);
  if(fixed.some(hand=>!Array.isArray(hand)||hand.length!==2)) throw new Error("each fixed opponent needs 2 cards");
  const used=new Set([...hero,...board,...fixed.flat()]);
  if(used.size!==hero.length+board.length+fixed.length*2) throw new Error("duplicate known card");
  const deckBase=[];for(let c=0;c<52;c++)if(!used.has(c))deckBase.push(c);
  const randomCount=opponents.length-fixed.length,needBoard=5-board.length,drawCount=randomCount*2+needBoard;
  if(drawCount>deckBase.length) throw new Error("not enough cards remaining");
  const rnd=mulberry32(seed>>>0);
  let win=0,tie=0,lose=0,equitySum=0;
  for(let t=0;t<trials;t++){
    const dealt=draw(deckBase,drawCount,rnd);let cursor=0;
    const trialOpp=opponents.map(hand=>hand||[dealt[cursor++],dealt[cursor++]]);
    const full=board.concat(dealt.slice(cursor,cursor+needBoard));
    const hs=best7(hero.concat(full)),scores=trialOpp.map(hand=>best7(hand.concat(full)));
    const best=Math.max(hs,...scores);
    if(hs<best){lose++;continue;}
    const winners=1+scores.filter(score=>score===hs).length;
    if(winners===1){win++;equitySum+=1;}else{tie++;equitySum+=1/winners;}
  }
  return {win,tie,lose,trials,equity:equitySum/trials,method:"multiway-monte-carlo",players:opponents.length+1};
}

// Exact enumeration when the number of remaining board runouts is small.
function equityExact(hero, villain, board){
  const used = new Set([...hero, ...villain, ...board]);
  const deck=[]; for(let c=0;c<52;c++) if(!used.has(c)) deck.push(c);
  const need = 5 - board.length;
  let win=0,tie=0,lose=0,total=0;
  function rec(start, chosen){
    if(chosen.length===need){
      const full=board.concat(chosen);
      const hs=best7(hero.concat(full)), vs=best7(villain.concat(full));
      if(hs>vs)win++; else if(hs<vs)lose++; else tie++; total++; return;
    }
    for(let i=start;i<deck.length;i++){ chosen.push(deck[i]); rec(i+1,chosen); chosen.pop(); }
  }
  rec(0,[]);
  return {win,tie,lose,trials:total,equity:(win+tie/2)/total,method:"exact"};
}

// Number of board runouts C(remaining, need) — used to pick exact vs MC.
function nRunouts(hero,villain,board){
  const used=new Set([...hero,...villain,...board]).size;
  const remaining=52-used, need=5-board.length;
  let n=1; for(let i=0;i<need;i++) n=n*(remaining-i)/(i+1);
  return Math.round(n);
}

if (typeof module!=="undefined") module.exports =
  { cardToStr, strToCard, rank5, best7, equityMC, equityMultiwayMC, equityExact, nRunouts, RANKS, SUITS };
