"use strict";
// Session results from a CSV file, for Bankroll Risk's "Import sessions":
// reading the file, filtering and grouping by stake, game and period, and the
// hands-weighted estimates with two checks of the model they rest on. Shared by
// the page (the file is read in the browser; only the totals are sent to the
// server) and the checks in checks/session-*.
//
// Model: session i with h_i hands has profit p_i ~ Normal(mu h_i / 100,
// sigma^2 h_i / 100), independently. Its win rate r_i = 100 p_i / h_i then has
// variance sigma^2 / w_i with w_i = h_i / 100, so a long session counts for more:
//   win rate     mu^ = sum(p) / sum(h) * 100      (= sum(w r) / sum(w))
//   volatility   sigma^2 = sum(w (r - mu^)^2) / (n - 1)
//   standard error of mu^ = sigma / sqrt(sum(h) / 100)
// These match src/inference.py (estimate_edge).
const PokerSessions = (() => {
  const Stats = typeof PokerStats !== "undefined" ? PokerStats : require("./stats.js");

  const MAX_CHARACTERS = 10000000;
  const MAX_SESSIONS = 50000;
  const MAX_HANDS_PER_SESSION = 1000000;
  // Column names are compared after lower-casing and turning anything that is
  // not a letter or digit into "_" ("Profit (bb)" -> "profit_bb").
  const COLUMNS = {
    hands: ["hands", "hand_count", "num_hands", "number_of_hands", "hands_played", "total_hands"],
    profit: ["profit_bb", "net_bb", "bb_won", "won_bb", "result_bb", "profit_in_bb", "net_won_bb", "winnings_bb", "amount_won_bb", "net_bb_won"],
    stake: ["stake", "stakes", "level", "limit", "blinds", "game_size"],
    game: ["game", "variant", "game_type", "format", "type"],
    date: ["date", "session_date", "start", "start_time", "started", "day"],
  };
  const TEMPLATE = "date,stake,game,hands,profit_bb\n2026-01-05,NL25,NLHE 6-max,412,18.5\n2026-01-06,NL25,NLHE 6-max,1250,-64\n2026-01-09,NL50,NLHE 6-max,385,7.25\n";

  const normalizeName = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  // The delimiter used most often outside quotes on the first line.
  function detectDelimiter(text) {
    const counts = { ",": 0, ";": 0, "\t": 0 };
    let quoted = false;
    for (const ch of text) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === "\n") break;
      else if (!quoted && ch in counts) counts[ch]++;
    }
    return Object.keys(counts).reduce((best, key) => (counts[key] > counts[best] ? key : best), ",");
  }

  // Rows of cells with the line each row starts on. Quoted cells may hold the
  // delimiter, line breaks and "" for a quote.
  function splitRows(text, delimiter) {
    const rows = [];
    let row = [], cell = "", quoted = false, line = 1, start = 1;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else { if (ch === "\n") line++; cell += ch; }
      } else if (ch === '"') quoted = true;
      else if (ch === delimiter) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push({ line: start, cells: row });
        row = []; cell = ""; line++; start = line;
      } else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push({ line: start, cells: row }); }
    return rows;
  }

  // A number as people write it in spreadsheets: 1,234.5 (or 12,5 when the
  // delimiter is not a comma), a Unicode minus, (12.5) for -12.5, a trailing "bb".
  function parseNumber(raw, delimiter) {
    let s = String(raw).trim().replace(/−/g, "-").replace(/\s+/g, "").replace(/bb$/i, "");
    let negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
    if (delimiter !== "," && /^[-+]?\d+,\d+$/.test(s)) s = s.replace(",", ".");
    else if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    const value = Number(s);
    return negative ? -value : value;
  }

  // YYYY-MM-DD or YYYY/MM/DD, optionally followed by a time. Other orders
  // (31/01/2026, 01/31/2026) are ambiguous, so they are not guessed.
  function parseDate(raw) {
    const m = String(raw).trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
    if (!m) return null;
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${m[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // Read a CSV file. Returns { sessions, columns, delimiter, problems } or
  // { error }. Rows that cannot be read are skipped and listed in problems.
  function parseCsv(text) {
    let source = String(text ?? "");
    if (source.length > MAX_CHARACTERS) return { error: "The file is too large (10 MB at most)." };
    source = source.replace(/^﻿/, "");
    const delimiter = detectDelimiter(source);
    const rows = splitRows(source, delimiter).filter((row) => row.cells.some((cell) => cell.trim() !== "") && !row.cells[0].trim().startsWith("#"));
    if (!rows.length) return { error: "The file is empty." };
    const header = rows[0].cells.map((cell) => cell.trim());
    const names = header.map(normalizeName);
    const index = {};
    for (const [field, aliases] of Object.entries(COLUMNS)) {
      const at = names.findIndex((name) => aliases.includes(name));
      if (at >= 0) index[field] = at;
    }
    if (index.hands === undefined || index.profit === undefined) {
      return { error: `The file needs a hands column and a profit_bb column (profit in big blinds). Columns found: ${header.filter(Boolean).join(", ") || "none"}.` };
    }
    if (rows.length - 1 > MAX_SESSIONS) return { error: `The file has ${(rows.length - 1).toLocaleString("en-US")} rows; ${MAX_SESSIONS.toLocaleString("en-US")} at most.` };
    const sessions = [], problems = [];
    const text_ = (row, field) => (index[field] === undefined ? "" : String(row.cells[index[field]] ?? "").trim());
    for (const row of rows.slice(1)) {
      const hands = parseNumber(text_(row, "hands"), delimiter);
      const profit = parseNumber(text_(row, "profit"), delimiter);
      const rawDate = text_(row, "date");
      const date = rawDate ? parseDate(rawDate) : null;
      let problem = "";
      if (!(Number.isInteger(hands) && hands > 0 && hands <= MAX_HANDS_PER_SESSION)) problem = `hands “${text_(row, "hands")}” is not a whole number from 1 to 1,000,000`;
      else if (!Number.isFinite(profit) || Math.abs(profit) > 1e7) problem = `profit_bb “${text_(row, "profit")}” is not a number`;
      else if (rawDate && !date) problem = `the date “${rawDate}” is not YYYY-MM-DD`;
      if (problem) { problems.push({ line: row.line, message: problem }); continue; }
      sessions.push({
        line: row.line, order: sessions.length, hands, profit,
        stake: text_(row, "stake").slice(0, 40), game: text_(row, "game").slice(0, 40), date,
      });
    }
    const columns = Object.fromEntries(Object.entries(index).map(([field, at]) => [field, header[at]]));
    return { sessions, columns, delimiter, problems, rows: rows.length - 1 };
  }

  const periodOf = (date, unit) => {
    if (!date) return "";
    if (unit === "year") return date.slice(0, 4);
    if (unit === "quarter") return `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;
    return date.slice(0, 7);
  };

  // Sessions matching the chosen stakes, games and months (YYYY-MM, inclusive).
  // A period filter leaves out sessions without a date.
  function filterSessions(sessions, { stakes = null, games = null, from = null, to = null } = {}) {
    return sessions.filter((s) => (!stakes || stakes.has(s.stake)) && (!games || games.has(s.game))
      && (!from || (s.date && s.date.slice(0, 7) >= from)) && (!to || (s.date && s.date.slice(0, 7) <= to)));
  }

  // Groups by "stake", "game", "month", "quarter" or "year": periods in time
  // order, the others with the most hands first.
  function groupSessions(sessions, by) {
    const groups = new Map();
    for (const s of sessions) {
      const key = by === "stake" || by === "game" ? s[by] : periodOf(s.date, by);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    const list = [...groups].map(([key, items]) => ({ key, sessions: items, hands: items.reduce((sum, s) => sum + s.hands, 0) }));
    return by === "stake" || by === "game"
      ? list.sort((a, b) => b.hands - a.hands || a.key.localeCompare(b.key))
      : list.sort((a, b) => (a.key === "") - (b.key === "") || a.key.localeCompare(b.key));
  }

  // Sessions in time order (by date, then file order); file order without dates.
  const chronological = (sessions) => [...sessions].sort((a, b) => (a.date && b.date && a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.order - b.order));

  function weighted(sessions) {
    let hands = 0, profit = 0;
    for (const s of sessions) { hands += s.hands; profit += s.profit; }
    const winRate = (100 * profit) / hands;
    let squares = 0;
    for (const s of sessions) {
      const w = s.hands / 100, r = (100 * s.profit) / s.hands;
      squares += w * (r - winRate) ** 2;
    }
    return { n: sessions.length, hands, profit, winRate, variance: sessions.length > 1 ? squares / (sessions.length - 1) : null };
  }

  // Win rates of groups of sessions compared with the overall one: the
  // statistic Q = sum(W_g (mu_g - mu)^2) / sigma^2, with W_g = hands_g / 100,
  // is chi-square with G - 1 degrees of freedom when every group shares one
  // win rate. Also returns the between-group (cluster-robust) standard error
  // of the overall win rate, sqrt(G / (G - 1) * sum((W_g / W)^2 (mu_g - mu)^2)).
  function heterogeneity(groups, winRate, sd) {
    const G = groups.length;
    if (G < 2 || !(sd > 0)) return null;
    const total = groups.reduce((sum, g) => sum + g.hands, 0) / 100;
    let q = 0, between = 0;
    for (const g of groups) {
      const w = g.hands / 100, rate = (100 * g.profit) / g.hands;
      q += (w * (rate - winRate) ** 2) / (sd * sd);
      between += (w / total) ** 2 * (rate - winRate) ** 2;
    }
    return { groups: G, q, p: 1 - Stats.chiSquareCdf(q, G - 1), standardError: Math.sqrt((G / (G - 1)) * between) };
  }

  // Estimates for a set of sessions, with two checks of the model:
  //  - lengths: does the spread grow with hands as the model says? Compares the
  //    standardized results sqrt(w_i) |r_i - mu^| of the shorter and the longer
  //    half of the sessions (a Brown-Forsythe style test on absolute
  //    deviations, which, unlike a variance-ratio F test, heavy tails do not
  //    set off). Their mean ratio estimates the ratio of the two volatilities.
  //  - stability: is the win rate the same throughout? The sessions in time
  //    order are cut into up to 10 consecutive blocks of equal count and the
  //    blocks' win rates compared (heterogeneity, above). When it flags, the
  //    between-block standard error is the honest one: the page offers to
  //    widen the interval by that ratio.
  // The lag-1 correlation src/inference.py uses was tried first; in
  // checks/session-lengths it rarely noticed a drifting win rate and widening
  // by it did not restore the interval's coverage.
  function summarize(sessions) {
    const base = weighted(sessions);
    if (base.n < 2) return { ...base, sd: null, standardError: null };
    const sd = Math.sqrt(base.variance);
    const standardError = sd / Math.sqrt(base.hands / 100);
    const df = base.n - 1;
    const sdInterval = sd > 0 ? [sd * Math.sqrt(df / Stats.chiSquareQuantile(0.975, df)), sd * Math.sqrt(df / Stats.chiSquareQuantile(0.025, df))] : [0, 0];
    const sizes = sessions.map((s) => s.hands).sort((a, b) => a - b);
    const mean = base.hands / base.n;
    const lengths = {
      min: sizes[0], max: sizes.at(-1), mean,
      median: sizes.length % 2 ? sizes[(sizes.length - 1) / 2] : (sizes[sizes.length / 2 - 1] + sizes[sizes.length / 2]) / 2,
      cv: Math.sqrt(sizes.reduce((sum, h) => sum + (h - mean) ** 2, 0) / base.n) / mean,
    };
    const deviation = (s) => Math.sqrt(s.hands / 100) * Math.abs((100 * s.profit) / s.hands - base.winRate);

    let scaling = null;
    if (lengths.min !== lengths.max && base.n >= 20 && sd > 0) {
      const byLength = [...sessions].sort((a, b) => a.hands - b.hands || a.order - b.order);
      const half = Math.floor(base.n / 2);
      const parts = [byLength.slice(0, half), byLength.slice(half)].map((part) => {
        const d = part.map(deviation), m = d.reduce((a, b) => a + b, 0) / d.length;
        return { n: part.length, mean: m, variance: d.reduce((a, x) => a + (x - m) ** 2, 0) / (d.length - 1), sd: Math.sqrt(weighted(part).variance) };
      });
      const [short, long] = parts;
      const z = (short.mean - long.mean) / Math.sqrt(short.variance / short.n + long.variance / long.n);
      const p = Math.min(1, 2 * (1 - Stats.phi(Math.abs(z))));
      const ratio = short.mean / long.mean;
      scaling = {
        short: { n: short.n, maxHands: byLength[half - 1].hands, sd: short.sd },
        long: { n: long.n, minHands: byLength[half].hands, sd: long.sd },
        ratio, z, p,
        // Flagged when the difference is both clear (p < 0.01) and sizeable
        // (the two volatilities differ by more than about 12%).
        flag: p < 0.01 && Math.abs(Math.log(ratio)) > Math.log(1.12),
      };
    }

    let stability = null;
    if (base.n >= 20 && sd > 0) {
      const ordered = chronological(sessions);
      const G = Math.min(10, Math.floor(base.n / 5));
      const blocks = Array.from({ length: G }, (_, g) => weighted(ordered.slice(Math.floor((g * base.n) / G), Math.floor(((g + 1) * base.n) / G))));
      const h = heterogeneity(blocks, base.winRate, sd);
      stability = {
        ...h, ordered: sessions.every((s) => s.date) ? "date" : "file",
        flag: h.p < 0.05,
        multiplier: Math.min(10, Math.max(1, h.standardError / standardError)),
      };
    }
    return { ...base, sd, standardError, sdInterval, lengths, scaling, stability };
  }

  // Groups (from groupSessions) with each one's estimates, and whether their
  // win rates differ by more than chance, using the volatility of all of them.
  function compareGroups(sessions, by) {
    const all = summarize(sessions);
    const groups = groupSessions(sessions, by).map((g) => ({ key: g.key, ...summarize(g.sessions) }));
    return { groups, test: groups.length > 1 && all.sd ? heterogeneity(groups, all.winRate, all.sd) : null };
  }

  return { COLUMNS, TEMPLATE, MAX_SESSIONS, parseCsv, parseNumber, parseDate, filterSessions, groupSessions, summarize, compareGroups, heterogeneity, periodOf, chronological };
})();
if (typeof module !== "undefined") module.exports = PokerSessions;
