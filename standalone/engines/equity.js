// Poker hand evaluator + equity engine (pure functions, no DOM).
// Card = 0..51.  rank = card % 13  (0=2 ... 8=T,9=J,10=Q,11=K,12=A)
// suit = Math.floor(card / 13)  (0..3)
//
// Server-side only: server/compute.js calls these from a worker thread and the
// public page never receives them. engines/test_engines.js checks them.

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";

function cardToStr(c){ return RANKS[c%13] + SUITS[(c/13)|0]; }
function strToCard(s){
  const r = RANKS.indexOf(s[0].toUpperCase());
  const su = SUITS.indexOf(s[1].toLowerCase());
  if (r<0||su<0) throw new Error("bad card: "+s);
  return su*13 + r;
}

// ---------------------------------------------------------------------------
// Evaluator
//
// Scores a 5-, 6- or 7-card hand directly from rank/suit bitmasks instead of
// ranking all 21 five-card subsets. The score encoding is unchanged:
//   category * 15^5 + five tiebreak slots (rank + 1, or 0 when unused)
// so a higher score is a better hand and equal scores split the pot.
// Categories: 8 straight flush, 7 quads, 6 full house, 5 flush, 4 straight,
// 3 trips, 2 two pair, 1 pair, 0 high card.
// ---------------------------------------------------------------------------

const RANK_OF = new Uint8Array(52);
const SUIT_OF = new Uint8Array(52);
for (let c = 0; c < 52; c++) { RANK_OF[c] = c % 13; SUIT_OF[c] = (c / 13) | 0; }

// STRAIGHT_HIGH[mask] = top rank of the best straight in a 13-bit rank mask,
// 3 for the A-2-3-4-5 wheel, or -1 when there is none.
const STRAIGHT_HIGH = new Int8Array(8192);
for (let mask = 0; mask < 8192; mask++) {
  let high = -1;
  for (let top = 12; top >= 4; top--) {
    if (((mask >> (top - 4)) & 31) === 31) { high = top; break; }
  }
  if (high < 0 && (mask & 0x100f) === 0x100f) high = 3;
  STRAIGHT_HIGH[mask] = high;
}

const rankCounts = new Uint8Array(13);
const topRank = (mask) => 31 - Math.clz32(mask);
const encode = (cat, a, b, c, d, e) => ((((cat * 15 + a) * 15 + b) * 15 + c) * 15 + d) * 15 + e;

// Score of the best five-card hand among cards[0..n-1] (5 <= n <= 7).
function scoreHand(cards, n){
  let rankMask = 0, s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i], r = RANK_OF[c], bit = 1 << r;
    rankMask |= bit;
    rankCounts[r]++;
    switch (SUIT_OF[c]) { case 0: s0 |= bit; break; case 1: s1 |= bit; break; case 2: s2 |= bit; break; default: s3 |= bit; }
  }

  let quad = -1, t1 = -1, t2 = -1, p1 = -1, p2 = -1;
  for (let r = 12; r >= 0; r--) {
    const count = rankCounts[r];
    if (count === 0) continue;
    rankCounts[r] = 0;
    if (count === 4) quad = r;
    else if (count === 3) { if (t1 < 0) t1 = r; else if (t2 < 0) t2 = r; }
    else if (count === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; }
  }

  // With at most 7 cards a flush cannot coexist with quads or a full house,
  // so it can be resolved first.
  const flush = popcount(s0) >= 5 ? s0 : popcount(s1) >= 5 ? s1 : popcount(s2) >= 5 ? s2 : popcount(s3) >= 5 ? s3 : 0;
  if (flush) {
    const straightFlush = STRAIGHT_HIGH[flush];
    if (straightFlush >= 0) return encode(8, straightFlush + 1, 0, 0, 0, 0);
    return topFive(5, flush);
  }
  if (quad >= 0) return encode(7, quad + 1, topRank(rankMask & ~(1 << quad)) + 1, 0, 0, 0);
  if (t1 >= 0 && (t2 >= 0 || p1 >= 0)) return encode(6, t1 + 1, Math.max(t2, p1) + 1, 0, 0, 0);
  const straight = STRAIGHT_HIGH[rankMask];
  if (straight >= 0) return encode(4, straight + 1, 0, 0, 0, 0);
  if (t1 >= 0) {
    let rest = rankMask & ~(1 << t1);
    const k1 = topRank(rest); rest &= ~(1 << k1);
    return encode(3, t1 + 1, k1 + 1, topRank(rest) + 1, 0, 0);
  }
  if (p2 >= 0) return encode(2, p1 + 1, p2 + 1, topRank(rankMask & ~(1 << p1) & ~(1 << p2)) + 1, 0, 0);
  if (p1 >= 0) {
    let rest = rankMask & ~(1 << p1);
    const k1 = topRank(rest); rest &= ~(1 << k1);
    const k2 = topRank(rest); rest &= ~(1 << k2);
    return encode(1, p1 + 1, k1 + 1, k2 + 1, topRank(rest) + 1, 0);
  }
  return topFive(0, rankMask);
}

function popcount(mask){
  mask -= (mask >>> 1) & 0x5555;
  mask = (mask & 0x3333) + ((mask >>> 2) & 0x3333);
  mask = (mask + (mask >>> 4)) & 0x0f0f;
  return (mask + (mask >>> 8)) & 0x1f;
}

function topFive(cat, mask){
  let score = cat;
  for (let i = 0; i < 5; i++) {
    const r = topRank(mask);
    mask &= ~(1 << r);
    score = score * 15 + r + 1;
  }
  return score;
}

// Rank exactly 5 cards -> comparable integer.
function rank5(cs){ return scoreHand(cs, 5); }

// Best 5-card hand from exactly 7 cards -> comparable integer.
function best7(cards7){ return scoreHand(cards7, 7); }

// ---------------------------------------------------------------------------
// Equity
//
// The loops below reuse typed buffers instead of allocating per trial. They
// draw random cards exactly as before (a partial Fisher-Yates shuffle of a
// fresh copy of the remaining deck), so a given seed reproduces the same
// results as earlier versions.
// ---------------------------------------------------------------------------

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

function remainingDeck(used){
  const deck = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
  return Uint8Array.from(deck);
}

// Partial Fisher-Yates: shuffle the first `k` cards of `work` (refilled from
// `deck`), consuming exactly k random numbers.
function shuffleInto(work, deck, k, rnd){
  work.set(deck);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rnd() * (work.length - i));
    const t = work[i]; work[i] = work[j]; work[j] = t;
  }
}

// A 7-card buffer holding `hole` in slots 0-1 and `board` from slot 2.
function handBuffer(hole, board){
  const buffer = new Uint8Array(7);
  buffer[0] = hole[0]; buffer[1] = hole[1];
  for (let i = 0; i < board.length; i++) buffer[2 + i] = board[i];
  return buffer;
}

// Monte Carlo equity of hero(2) vs villain(2) given board(0..5), seed.
function equityMC(hero, villain, board, trials, seed){
  const deck = remainingDeck(new Set([...hero, ...villain, ...board]));
  const work = new Uint8Array(deck.length);
  const need = 5 - board.length, first = 2 + board.length;
  const h = handBuffer(hero, board), v = handBuffer(villain, board);
  const rnd = mulberry32(seed>>>0);
  let win=0, tie=0, lose=0;
  for (let t = 0; t < trials; t++) {
    if (need > 0) {
      shuffleInto(work, deck, need, rnd);
      for (let k = 0; k < need; k++) h[first + k] = v[first + k] = work[k];
    }
    const hs = scoreHand(h, 7), vs = scoreHand(v, 7);
    if (hs > vs) win++; else if (hs < vs) lose++; else tie++;
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
  const deck=remainingDeck(used);
  const randomCount=opponents.length-fixed.length,needBoard=5-board.length,drawCount=randomCount*2+needBoard;
  if(drawCount>deck.length) throw new Error("not enough cards remaining");
  const work=new Uint8Array(deck.length);
  const first=2+board.length;
  const h=handBuffer(hero,board);
  const opp=opponents.map(hand=>handBuffer(hand||[0,0],board));
  const rnd=mulberry32(seed>>>0);
  let win=0,tie=0,lose=0,equitySum=0;
  for(let t=0;t<trials;t++){
    let cursor=0;
    if(drawCount>0){
      shuffleInto(work,deck,drawCount,rnd);
      // Random opponents take the first dealt cards in seat order, then the board.
      for(let o=0;o<opponents.length;o++){
        if(opponents[o])continue;
        opp[o][0]=work[cursor++];opp[o][1]=work[cursor++];
      }
      for(let k=0;k<needBoard;k++){
        const card=work[cursor++];
        h[first+k]=card;
        for(let o=0;o<opp.length;o++)opp[o][first+k]=card;
      }
    }
    const hs=scoreHand(h,7);
    let best=hs,sharing=0;
    for(let o=0;o<opp.length;o++){
      const score=scoreHand(opp[o],7);
      if(score>best)best=score;
      if(score===hs)sharing++;
    }
    if(hs<best){lose++;continue;}
    const winners=1+sharing;
    if(winners===1){win++;equitySum+=1;}else{tie++;equitySum+=1/winners;}
  }
  return {win,tie,lose,trials,equity:equitySum/trials,method:"multiway-monte-carlo",players:opponents.length+1};
}

// Exact enumeration when the number of remaining board runouts is small.
function equityExact(hero, villain, board){
  const deck = remainingDeck(new Set([...hero, ...villain, ...board]));
  const need = 5 - board.length, first = 2 + board.length;
  const h = handBuffer(hero, board), v = handBuffer(villain, board);
  let win=0,tie=0,lose=0,total=0;
  function rec(start, depth){
    if (depth === need) {
      const hs = scoreHand(h, 7), vs = scoreHand(v, 7);
      if(hs>vs)win++; else if(hs<vs)lose++; else tie++; total++; return;
    }
    for (let i = start; i < deck.length; i++) {
      h[first + depth] = v[first + depth] = deck[i];
      rec(i + 1, depth + 1);
    }
  }
  rec(0, 0);
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
  { cardToStr, strToCard, rank5, best7, scoreHand, equityMC, equityMultiwayMC, equityExact, nRunouts, RANKS, SUITS };
