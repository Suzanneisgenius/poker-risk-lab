// Hold'em range notation: parse, format and summarise opponent ranges.
//
// Shared by the server (which re-parses every request) and the public page
// (which previews the range while it is typed). It holds no calculation
// engine. A range is a Float64Array of 1,326 weights, one per two-card combo,
// each from 0 (not in the range) to 1 (always in the range).
//
// Cards use the engine's numbering: card = suit * 13 + rank, rank 0 = 2 ...
// 12 = A, suits c d h s.
const PokerRange = (() => {
  const RANKS = "23456789TJQKA";
  const SUITS = "cdhs";
  const COMBO_COUNT = 1326;

  // Every combo as [lower card, higher card], indexed by comboIndex.
  const comboIndex = (a, b) => { const hi = Math.max(a, b), lo = Math.min(a, b); return hi * (hi - 1) / 2 + lo; };
  const COMBOS = [];
  for (let hi = 1; hi < 52; hi++) for (let lo = 0; lo < hi; lo++) COMBOS.push([lo, hi]);

  // The 169 starting hands in matrix order: row and column 0 are aces, pairs
  // on the diagonal, suited hands above it and offsuit hands below.
  const rankAt = (index) => 12 - index;
  function classAt(row, column) {
    const a = RANKS[rankAt(row)], b = RANKS[rankAt(column)];
    if (row === column) return a + b;
    return row < column ? a + b + "s" : b + a + "o";
  }
  const CLASSES = [];
  for (let row = 0; row < 13; row++) for (let column = 0; column < 13; column++) CLASSES.push(classAt(row, column));
  const CLASS_INDEX = new Map(CLASSES.map((name, index) => [name, index]));

  // Combo indices of one starting hand, e.g. "AKs" -> its 4 combos.
  function combosOfClass(name) {
    const high = RANKS.indexOf(name[0]), low = RANKS.indexOf(name[1]), kind = name[2] || "";
    const out = [];
    for (let s1 = 0; s1 < 4; s1++) for (let s2 = 0; s2 < 4; s2++) {
      const a = s1 * 13 + high, b = s2 * 13 + low;
      if (high === low ? s1 >= s2 : (kind === "s") !== (s1 === s2)) continue;
      out.push(comboIndex(a, b));
    }
    return out;
  }
  const CLASS_COMBOS = CLASSES.map(combosOfClass);
  const COMBO_CLASS = new Int16Array(COMBO_COUNT);
  CLASS_COMBOS.forEach((combos, classIndex) => combos.forEach((combo) => { COMBO_CLASS[combo] = classIndex; }));

  const cardText = (card) => RANKS[card % 13] + SUITS[(card / 13) | 0];
  // Higher rank first (suit breaks a tie), e.g. "AhKd", "AsAh".
  const comboText = (combo) => {
    const [a, b] = COMBOS[combo];
    const first = a % 13 > b % 13 || (a % 13 === b % 13 && a > b);
    return first ? cardText(a) + cardText(b) : cardText(b) + cardText(a);
  };

  const HELP = "Write hands like QQ+, AKs, AQo+, KJ, A5s-A2s, T9s-65s or AsKs, separated by commas. Add :0.5 for half weight.";

  // Class names covered by one hand pattern (no weight), or an error message
  // quoting `entry`, the text as typed.
  function expandPattern(pattern, entry) {
    const combo = pattern.match(/^([2-9TJQKA])([cdhs])([2-9TJQKA])([cdhs])$/);
    if (combo) {
      const a = SUITS.indexOf(combo[2]) * 13 + RANKS.indexOf(combo[1]);
      const b = SUITS.indexOf(combo[4]) * 13 + RANKS.indexOf(combo[3]);
      if (a === b) return { error: `“${entry}” uses the same card twice.` };
      return { combos: [comboIndex(a, b)] };
    }
    const hand = (text) => {
      const m = text.match(/^([2-9TJQKA])([2-9TJQKA])([so]?)$/);
      if (!m) return null;
      let high = RANKS.indexOf(m[1]), low = RANKS.indexOf(m[2]);
      if (low > high) [high, low] = [low, high];
      return { high, low, kind: m[3], pair: high === low };
    };
    const names = (high, low, kind) => {
      if (high === low) return [RANKS[high] + RANKS[low]];
      const base = RANKS[high] + RANKS[low];
      return kind ? [base + kind] : [base + "s", base + "o"];
    };
    const bad = (why) => ({ error: `Can't read “${entry}”${why ? ": " + why : ""}. ${HELP}` });

    const dash = pattern.split("-");
    if (dash.length === 2) {
      const a = hand(dash[0]), b = hand(dash[1]);
      if (!a || !b) return bad();
      if (a.kind !== b.kind) return bad("both ends need the same s/o ending");
      if (a.pair !== b.pair) return bad("a range runs from a pair to a pair, or between two non-pairs");
      if (a.pair && a.kind === "s") return bad("pairs cannot be suited");
      const out = [];
      if (a.pair) {
        for (let r = Math.min(a.high, b.high); r <= Math.max(a.high, b.high); r++) out.push(...names(r, r, ""));
      } else if (a.high === b.high) {
        // Same first card: every kicker between the two, e.g. A5s-A2s.
        for (let r = Math.min(a.low, b.low); r <= Math.max(a.low, b.low); r++) out.push(...names(a.high, r, a.kind));
      } else if (a.high - a.low === b.high - b.low) {
        // Same gap: both cards move together, e.g. T9s-65s.
        const step = a.high < b.high ? 1 : -1;
        for (let h = a.high, l = a.low; ; h += step, l += step) { out.push(...names(h, l, a.kind)); if (h === b.high) break; }
      } else {
        return bad("use the same first card (A5s-A2s) or the same gap (T9s-65s)");
      }
      return { classes: out };
    }
    const plus = pattern.endsWith("+");
    const h = hand(plus ? pattern.slice(0, -1) : pattern);
    if (!h) return bad();
    if (h.pair && h.kind === "s") return bad("pairs cannot be suited");
    if (!plus) return { classes: names(h.high, h.low, h.kind) };
    const out = [];
    // QQ+ adds the higher pairs; ATs+ raises the kicker up to AKs.
    if (h.pair) for (let r = h.high; r <= 12; r++) out.push(...names(r, r, ""));
    else for (let r = h.low; r < h.high; r++) out.push(...names(h.high, r, h.kind));
    return { classes: out };
  }

  // Parse range text. Entries are separated by commas, semicolons or spaces;
  // an entry may end in :weight (0-1, or 0-100%). Later entries override
  // earlier ones for the same combos, so "QQ+, KK:0" removes KK.
  function parseRange(text) {
    const source = String(text ?? "");
    if (source.length > 20000) return { error: "The range text is too long (20,000 characters at most)." };
    const entries = source.replace(/\s*([:-])\s*/g, "$1").replace(/\s+\+/g, "+").split(/[\s,;]+/).filter(Boolean);
    const weights = new Float64Array(COMBO_COUNT);
    for (const entry of entries) {
      const [rawHands, rawWeight, extra] = entry.split(":");
      if (extra !== undefined || rawHands === "") return { error: `Can't read “${entry}”. ${HELP}` };
      let weight = 1;
      if (rawWeight !== undefined) {
        const m = rawWeight.match(/^(\d+(?:\.\d+)?|\.\d+)(%?)$/);
        weight = m ? Number(m[1]) / (m[2] ? 100 : 1) : NaN;
        if (!(weight >= 0 && weight <= 1)) return { error: `The weight in “${entry}” must be from 0 to 1 (or 0% to 100%).` };
      }
      // Ranks upper case, suits and s/o lower case; 10 means T.
      const pattern = rawHands.replace(/10/g, "T").replace(/[2-9tjqka]/g, (c) => c.toUpperCase()).replace(/[CDHSO]/g, (c) => c.toLowerCase());
      const expanded = expandPattern(pattern, entry);
      if (expanded.error) return { error: expanded.error };
      const combos = expanded.combos || expanded.classes.flatMap((name) => CLASS_COMBOS[CLASS_INDEX.get(name)]);
      for (const combo of combos) weights[combo] = weight;
    }
    return { weights };
  }

  const formatWeight = (w) => (w === 1 ? "" : ":" + String(Number(w.toFixed(6))));

  // Shortest-form text for a range, e.g. "TT+, AQs+, KQs, AKo". Hands whose
  // combos do not all share one weight are listed combo by combo.
  function formatRange(weights) {
    const classWeight = CLASS_COMBOS.map((combos) => {
      const w = weights[combos[0]];
      return combos.every((combo) => weights[combo] === w) ? w : null;
    });
    const weightOf = (name) => classWeight[CLASS_INDEX.get(name)];
    // Runs of consecutive ranks with the same nonzero weight, highest first.
    const runs = (ranks, nameOf) => {
      const out = [];
      for (const r of ranks) {
        const w = weightOf(nameOf(r));
        const last = out[out.length - 1];
        if (w && last && last.weight === w && last.bottom === r + 1) last.bottom = r;
        else if (w) out.push({ top: r, bottom: r, weight: w });
      }
      return out;
    };
    const descending = (from) => Array.from({ length: from + 1 }, (_, i) => from - i);
    const pairs = [], suited = [], offsuit = [];
    for (const run of runs(descending(12), (r) => RANKS[r] + RANKS[r])) {
      const top = RANKS[run.top] + RANKS[run.top], bottom = RANKS[run.bottom] + RANKS[run.bottom];
      pairs.push((run.top === run.bottom ? top : run.top === 12 ? bottom + "+" : `${top}-${bottom}`) + formatWeight(run.weight));
    }
    for (let high = 12; high >= 1; high--) {
      const H = RANKS[high];
      const text = (run, kind) => {
        const top = H + RANKS[run.top] + kind, bottom = H + RANKS[run.bottom] + kind;
        return (run.top === run.bottom ? top : run.top === high - 1 ? bottom + "+" : `${top}-${bottom}`) + formatWeight(run.weight);
      };
      const s = runs(descending(high - 1), (r) => H + RANKS[r] + "s");
      const o = runs(descending(high - 1), (r) => H + RANKS[r] + "o");
      const same = (a, b) => a.top === b.top && a.bottom === b.bottom && a.weight === b.weight;
      for (const run of s) suited.push(o.some((x) => same(x, run)) ? text(run, "") : text(run, "s"));
      for (const run of o) if (!s.some((x) => same(x, run))) offsuit.push(text(run, "o"));
    }
    const combos = [];
    CLASS_COMBOS.forEach((list, index) => {
      if (classWeight[index] !== null) return;
      for (const combo of list) if (weights[combo] > 0) combos.push(comboText(combo) + formatWeight(weights[combo]));
    });
    return [...pairs, ...suited, ...offsuit, ...combos].join(", ");
  }

  // Weighted combo counts, overall and after removing known (dead) cards.
  function summarize(weights, deadCards = []) {
    const dead = new Set(deadCards);
    let combos = 0, live = 0, hands = 0;
    CLASS_COMBOS.forEach((list) => {
      let any = false;
      for (const combo of list) {
        const w = weights[combo];
        if (!w) continue;
        any = true;
        combos += w;
        const [a, b] = COMBOS[combo];
        if (!dead.has(a) && !dead.has(b)) live += w;
      }
      if (any) hands++;
    });
    return { combos, live, hands, share: combos / COMBO_COUNT };
  }

  // Weight shown for one matrix cell: the mean over its combos, and whether
  // they differ.
  function classState(weights, classIndex) {
    const list = CLASS_COMBOS[classIndex];
    let sum = 0;
    for (const combo of list) sum += weights[combo];
    const mean = sum / list.length;
    return { weight: mean, mixed: list.some((combo) => weights[combo] !== weights[list[0]]) };
  }

  // A copy of `weights` with one starting hand switched: a hand fully in the
  // range is removed, anything else is added at full weight.
  function toggleClass(weights, classIndex) {
    const next = Float64Array.from(weights);
    const full = CLASS_COMBOS[classIndex].every((combo) => weights[combo] === 1);
    for (const combo of CLASS_COMBOS[classIndex]) next[combo] = full ? 0 : 1;
    return next;
  }

  // The 169 hands ranked by all-in equity against one random hand
  // (scripts/hand_order.js). The page build inlines it; the server reads the
  // file the first time it is needed.
  let handOrderData = /*__HAND_ORDER__*/ null;
  const handOrder = () => handOrderData || (handOrderData = require("./hand-order.json"));

  // The strongest hands by handOrder() whose combos come closest to `percent`
  // of all 1,326 combos.
  function topPercent(percent) {
    const target = Math.min(100, Math.max(0, Number(percent) || 0)) / 100 * COMBO_COUNT;
    const weights = new Float64Array(COMBO_COUNT);
    let total = 0;
    for (const { hand } of handOrder().hands) {
      const combos = CLASS_COMBOS[CLASS_INDEX.get(hand)];
      if (Math.abs(total + combos.length - target) > Math.abs(total - target)) break;
      for (const combo of combos) weights[combo] = 1;
      total += combos.length;
    }
    return weights;
  }

  return {
    RANKS, SUITS, COMBO_COUNT, COMBOS, CLASSES, CLASS_INDEX, CLASS_COMBOS, COMBO_CLASS,
    comboIndex, classAt, comboText, handOrder, parseRange, formatRange, summarize, classState, toggleClass, topPercent,
  };
})();

if (typeof module !== "undefined") module.exports = PokerRange;
