#!/usr/bin/env node
// Writes the synthetic session files used by this check, and the page's
// example file (standalone/shared/sessions-example.csv):
//   node checks/session-import-python/make_files.js
// Every number is simulated from a fixed seed; none is a real player's result.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function generator(seed) {
  let a = seed | 0, b = 0x9e3779b9, c = 0x243f6a88, d = 1;
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 16; i++) next();
  const normal = () => {
    let u = 0; while (u <= 1e-12) u = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  return { uniform: next, normal };
}
const profit = (g, hands, rate, sd) => Math.round(((rate * hands) / 100 + sd * Math.sqrt(hands / 100) * g.normal()) * 100) / 100;
const day = (start, offset) => new Date(Date.UTC(...start) + offset * 86400000).toISOString().slice(0, 10);

const files = {};

// The format src/inference.py's load_blocks_csv reads: equal 1,000-hand blocks.
{
  const g = generator(1);
  files["equal-blocks.csv"] = "hands,profit_bb\n" + Array.from({ length: 60 }, () => `1000,${profit(g, 1000, 3, 90)}`).join("\n") + "\n";
}

// A year of sessions at three stakes and two games, of very different lengths.
// Win rates differ by stake and game, and PLO swings more.
{
  const g = generator(2);
  const rows = [];
  for (let i = 0; i < 360; i++) {
    const stake = ["NL25", "NL25", "NL50", "NL50", "NL100"][Math.floor(g.uniform() * 5)];
    const game = g.uniform() < 0.8 ? "NLHE 6-max" : "PLO";
    const hands = Math.min(6000, Math.max(25, Math.round(450 * Math.exp(0.9 * g.normal()))));
    const rate = { NL25: 6, NL50: 2, NL100: -1 }[stake] + (game === "PLO" ? -3 : 0);
    rows.push(`${day([2025, 6, 1], Math.floor(i * 365 / 360))},${stake},${game},${hands},${profit(g, hands, rate, game === "PLO" ? 140 : 90)}`);
  }
  files["sessions-mixed.csv"] = "date,stake,game,hands,profit_bb\n" + rows.join("\n") + "\n";
}

// A European spreadsheet export: semicolons, decimal commas, a comment line and
// three rows that cannot be read (a day-first date, zero hands, text for profit).
{
  const g = generator(3);
  const rows = Array.from({ length: 80 }, (_, i) => {
    const hands = 200 + Math.floor(g.uniform() * 1300);
    return `${day([2026, 0, 1], i)};NL10;${hands};${String(profit(g, hands, 4, 85)).replace(".", ",")}`;
  });
  rows.splice(10, 0, "# exported from a spreadsheet");
  rows.splice(20, 0, "15/01/2026;NL10;800;12,5");
  rows.splice(40, 0, "2026-02-20;NL10;0;3");
  rows.splice(60, 0, "2026-03-05;NL10;650;n/a");
  files["european.csv"] = "Date;Stake;Hands;Profit (bb)\n" + rows.join("\n") + "\n";
}

// A win rate that falls from +20 to -12 bb/100 over the year: the stability check should flag it.
{
  const g = generator(4);
  files["drifting.csv"] = "date,hands,profit_bb\n" + Array.from({ length: 240 }, (_, i) => {
    const hands = 300 + Math.floor(g.uniform() * 900);
    return `${day([2025, 0, 1], Math.floor(i * 1.5))},${hands},${profit(g, hands, 20 - (32 * i) / 239, 90)}`;
  }).join("\n") + "\n";
}

// Dates on two sessions in three, and one dated out of file order: with no
// period filter every session counts, and the time order is the file's.
{
  const g = generator(6);
  files["mixed-dates.csv"] = "date,stake,hands,profit_bb\n" + Array.from({ length: 60 }, (_, i) => {
    const hands = 200 + Math.floor(g.uniform() * 1200);
    const date = i % 3 === 1 ? "" : i === 12 ? "2026-03-20" : day([2026, 0, 1], i);
    return `${date},NL25,${hands},${profit(g, hands, 4, 90)}`;
  }).join("\n") + "\n";
}

// Short sessions that swing much more per hand than long ones (an extra swing
// of 120 bb per session, whatever its length): the length check should flag it.
{
  const g = generator(5);
  files["short-and-long.csv"] = "hands,profit_bb\n" + Array.from({ length: 300 }, () => {
    const hands = g.uniform() < 0.6 ? 30 + Math.floor(g.uniform() * 120) : 1500 + Math.floor(g.uniform() * 2500);
    return `${hands},${Math.round((profit(g, hands, 3, 90) + 120 * g.normal()) * 100) / 100}`;
  }).join("\n") + "\n";
}

const dir = path.join(__dirname, "files");
fs.mkdirSync(dir, { recursive: true });
for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
fs.writeFileSync(path.join(__dirname, "..", "..", "standalone", "shared", "sessions-example.csv"), files["sessions-mixed.csv"]);
console.log(`wrote ${Object.keys(files).length} files and standalone/shared/sessions-example.csv`);
