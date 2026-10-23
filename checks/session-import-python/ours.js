#!/usr/bin/env node
// The page's side of the session-import check: what standalone/shared/sessions.js
// reads from each file in files/ and the estimates for several selections and
// groupings. run.py reads the same files with pandas and recomputes everything
// with src/inference.py and scipy.
//
//   node checks/session-import-python/ours.js           # print
//   node checks/session-import-python/ours.js --write   # save web.json
//   node checks/session-import-python/ours.js --check   # compare with web.json (CI)
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const S = require("../../standalone/shared/sessions.js");

// Selections: which sessions are summarized (all of them unless filtered).
const SELECTIONS = {
  "sessions-mixed.csv": [
    { id: "all" },
    { id: "NL25", stakes: ["NL25"] },
    { id: "NL25+NL50", stakes: ["NL25", "NL50"] },
    { id: "PLO", games: ["PLO"] },
    { id: "2025-10 to 2026-03", from: "2025-10", to: "2026-03" },
    { id: "NL50 NLHE from 2026-01", stakes: ["NL50"], games: ["NLHE 6-max"], from: "2026-01" },
  ],
  "mixed-dates.csv": [
    { id: "all, dated or not" },
    { id: "2026-01 to 2026-02 (dated only)", from: "2026-01", to: "2026-02" },
  ],
};
const GROUPINGS = { "sessions-mixed.csv": ["stake", "game", "month", "quarter", "year"], "drifting.csv": ["quarter"], "mixed-dates.csv": ["month", "quarter"] };

const round = (value) => (typeof value === "number" ? Number(value.toPrecision(15)) : value);
const clean = (value) => JSON.parse(JSON.stringify(value, (_, v) => round(v)));

const files = fs.readdirSync(path.join(__dirname, "files")).filter((name) => name.endsWith(".csv")).sort();
const out = files.map((name) => {
  const read = S.parseCsv(fs.readFileSync(path.join(__dirname, "files", name), "utf8"));
  if (read.error) throw new Error(`${name}: ${read.error}`);
  const selections = (SELECTIONS[name] || [{ id: "all" }]).map(({ id, stakes, games, from = null, to = null }) => {
    const chosen = S.filterSessions(read.sessions, { stakes: stakes && new Set(stakes), games: games && new Set(games), from, to });
    return { id, filter: { stakes: stakes || null, games: games || null, from, to }, summary: S.summarize(chosen) };
  });
  const groupings = (GROUPINGS[name] || []).map((by) => {
    const compared = S.compareGroups(read.sessions, by);
    return { by, groups: compared.groups.map(({ key, n, hands, winRate, sd, standardError }) => ({ key, n, hands, winRate, sd, standardError })), test: compared.test };
  });
  return {
    file: name, delimiter: read.delimiter, columns: read.columns, rows: read.rows,
    sessions: read.sessions.map(({ line, hands, profit, stake, game, date }) => ({ line, hands, profit, stake, game, date })),
    problems: read.problems.map(({ line }) => line),
    selections, groupings,
  };
});

const text = JSON.stringify(clean({ files: out }), null, 1) + "\n";
const file = path.join(__dirname, "web.json");
if (process.argv.includes("--check")) {
  if (fs.readFileSync(file, "utf8") !== text) {
    console.error("Session import results differ from checks/session-import-python/web.json. If intended, run with --write and re-run run.py.");
    process.exit(1);
  }
  console.log(`PASS: ${out.length} session files match web.json.`);
} else if (process.argv.includes("--write")) {
  fs.writeFileSync(file, text);
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
} else {
  process.stdout.write(text);
}
