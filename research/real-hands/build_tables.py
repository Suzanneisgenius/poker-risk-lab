"""Build per-hand and per-player net-result tables from HandHQ PHH files.

Usage:
    python -I build_tables.py <phh-dataset checkout> <output dir>

Reads data/handhq/{PTY,ONG}-2009-07-01_2009-07-23_*NLH_OBFU/<bb>/*.phhs and
writes hands.parquet, player_hands.parquet and build_report.json to the output
directory. Nothing is written inside the checkout.

Accounting per hand:
- Replay the betting to get each player's contribution (antes, blinds, calls,
  bets and raises; a raise amount is the player's total for that street).
- The largest contribution above everyone else's is an uncalled bet and is
  handed back.
- PartyPoker's `winnings` include that returned amount; Ongame's do not
  (measured in phh_probe3.py). Net = winnings - amount put in, read the same way.
- Rake = pot - total winnings. Checks: rake is not negative and is at most 10%
  of the pot and the site's cap; no folded player wins anything; winnings are
  present and nonzero.
- Separately, a player's next starting stack at the same table should equal
  this starting stack plus this net result, unless they topped up. That check
  does not use the winnings field.
"""
import datetime as dt
import hashlib
import json
import platform
import re
import subprocess
import sys
import tomllib
from collections import Counter
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

WINNINGS_INCLUDE_UNCALLED = {"PTY": True, "ONG": False}
# Largest rake per hand seen in 99.99% of hands at $2/$4 (Ongame $3.00; PartyPoker
# $3.50, probably $3 plus a jackpot drop). A larger "rake" means a payout is missing.
RAKE_CAP = {"PTY": 3.50, "ONG": 3.00}
FOLDER_RE = re.compile(r"^(?P<site>[A-Z]+)-2009-07-01_2009-07-23_(?P<stake>\d+)NLH_OBFU$")
SECTION_RE = re.compile(r"(?m)^\[(\d+)\]\s*$")
TOL = 0.005

HAND_SCHEMA = pa.schema([
    ("site", pa.string()), ("bb_usd", pa.float64()), ("file", pa.string()), ("idx", pa.int32()),
    ("hand_id", pa.string()), ("ts", pa.timestamp("s")), ("table", pa.string()),
    ("n_players", pa.int8()), ("showdown", pa.bool_()), ("pot_usd", pa.float64()),
    ("rake_usd", pa.float64()), ("returned_usd", pa.float64()), ("status", pa.string()),
    ("flags", pa.string()),
])
PLAYER_SCHEMA = pa.schema([
    ("site", pa.string()), ("hand_id", pa.string()), ("file", pa.string()), ("idx", pa.int32()),
    ("ts", pa.timestamp("s")), ("table", pa.string()), ("position", pa.int8()), ("seat", pa.int8()),
    ("player", pa.string()), ("starting_stack_usd", pa.float64()), ("invested_usd", pa.float64()),
    ("winnings_usd", pa.float64()), ("net_usd", pa.float64()), ("net_bb", pa.float64()),
    ("folded", pa.bool_()), ("status", pa.string()),
])
# Problems that make a hand's net results unusable, most serious first.
FATAL = ["parse_error", "no_winnings", "zero_winnings", "folded_winner", "rake_negative",
         "rake_high", "bet_over_stack", "unknown_action"]


def replay(h, include_uncalled, rake_cap):
    n = len(h["players"])
    stack = [float(s) for s in h["starting_stacks"]]
    gross = [0.0] * n
    street = [0.0] * n
    folded = [False] * n
    flags = set()

    def put(i, amount, kind):
        if amount < -TOL:
            flags.add("negative_bet")
            amount = 0.0
        if kind == "cbr" and amount > stack[i] + TOL:
            flags.add("bet_over_stack")
        amount = min(amount, stack[i])
        stack[i] -= amount
        gross[i] += amount
        street[i] += amount

    for i, a in enumerate(h.get("antes", [])):
        if a:
            put(i, float(a), "ante")
    street[:] = [0.0] * n
    for i, b in enumerate(h.get("blinds_or_straddles", [])):
        if b:
            put(i, float(b), "blind")
    for act in h["actions"]:
        parts = act.split()
        if parts[0] == "d":
            if parts[1] == "db":
                street[:] = [0.0] * n
            elif parts[1] != "dh":
                flags.add("unknown_action")
            continue
        i = int(parts[0][1:]) - 1
        op = parts[1]
        if op == "f":
            folded[i] = True
        elif op == "cc":
            put(i, max(street) - street[i], "cc")
        elif op == "cbr":
            put(i, float(parts[2]) - street[i], "cbr")
        elif op != "sm":
            flags.add("unknown_action")

    order = sorted(range(n), key=lambda i: gross[i], reverse=True)
    netc = gross[:]
    if n > 1 and gross[order[0]] > gross[order[1]] + TOL:
        netc[order[0]] = gross[order[1]]
    returned = gross[order[0]] - netc[order[0]]
    invested = gross if include_uncalled else netc
    pot = sum(invested)
    showdown = sum(not f for f in folded) > 1

    w = h.get("winnings")
    if w is None:
        flags.add("no_winnings")
        return flags, showdown, pot, None, returned, folded, invested, None
    w = [float(x) for x in w]
    if pot > TOL and sum(w) <= TOL:
        flags.add("zero_winnings")
    rake = pot - sum(w)
    if rake < -TOL:
        flags.add("rake_negative")
    if rake > min(0.10 * pot, rake_cap) + TOL:
        flags.add("rake_high")
    if any(folded[i] and w[i] > TOL for i in range(n)):
        flags.add("folded_winner")
    return flags, showdown, pot, rake, returned, folded, invested, w


def sections(text):
    try:
        return sorted(tomllib.loads(text).items(), key=lambda kv: int(kv[0])), 0
    except tomllib.TOMLDecodeError:
        parts = SECTION_RE.split(text)
        out, bad = [], 0
        for k, body in zip(parts[1::2], parts[2::2]):
            try:
                out.append((k, tomllib.loads(body)))
            except tomllib.TOMLDecodeError:
                bad += 1
        return out, bad


def timestamp(h):
    t = h.get("time")
    try:
        return dt.datetime(h["year"], h["month"], h["day"], t.hour, t.minute, t.second)
    except (KeyError, AttributeError, TypeError, ValueError):
        return None


def process(args):
    path, root = args
    rel = str(Path(path).relative_to(root))
    folder = Path(rel).parts[0]
    site = FOLDER_RE.match(folder)["site"]
    bb = float(Path(rel).parts[1])
    include_uncalled = WINNINGS_INCLUDE_UNCALLED[site]
    hands = {f.name: [] for f in HAND_SCHEMA}
    players = {f.name: [] for f in PLAYER_SCHEMA}
    counts = Counter()
    secs, bad = sections(Path(path).read_text(encoding="utf-8"))
    counts["section_parse_errors"] += bad
    for key, h in secs:
        try:
            flags, showdown, pot, rake, returned, folded, invested, w = replay(h, include_uncalled, RAKE_CAP[site])
        except (KeyError, ValueError, IndexError, TypeError):
            counts["replay_errors"] += 1
            continue
        blinds = sorted(float(b) for b in h.get("blinds_or_straddles", []) if b)
        if blinds != [bb / 2, bb]:
            flags.add("unusual_blinds")  # informational: straddle or dead blind
        status = next((f for f in FATAL if f in flags), "ok")
        ts = timestamp(h)
        hid = str(h.get("hand", ""))
        table = str(h.get("table", ""))
        seats = h.get("seats") or [None] * len(h["players"])
        hands["site"].append(site); hands["bb_usd"].append(bb); hands["file"].append(rel)
        hands["idx"].append(int(key)); hands["hand_id"].append(hid); hands["ts"].append(ts)
        hands["table"].append(table); hands["n_players"].append(len(h["players"]))
        hands["showdown"].append(showdown); hands["pot_usd"].append(pot); hands["rake_usd"].append(rake)
        hands["returned_usd"].append(returned); hands["status"].append(status)
        hands["flags"].append(",".join(sorted(flags)))
        for i, p in enumerate(h["players"]):
            win = None if w is None else w[i]
            net = None if w is None else win - invested[i]
            players["site"].append(site); players["hand_id"].append(hid); players["file"].append(rel)
            players["idx"].append(int(key)); players["ts"].append(ts); players["table"].append(table)
            players["position"].append(i + 1); players["seat"].append(seats[i])
            players["player"].append(str(p)); players["starting_stack_usd"].append(float(h["starting_stacks"][i]))
            players["invested_usd"].append(invested[i]); players["winnings_usd"].append(win)
            players["net_usd"].append(net); players["net_bb"].append(None if net is None else net / bb)
            players["folded"].append(folded[i]); players["status"].append(status)
        counts["hands"] += 1
    return hands, players, counts


def flush(writer, buf, schema):
    if buf[schema.names[0]]:
        writer.write_table(pa.table(buf, schema=schema))
        for k in buf:
            buf[k] = []


def summarize(out, totals, files, src, script):
    h = pq.read_table(out / "hands.parquet").to_pandas()
    p = pq.read_table(out / "player_hands.parquet").to_pandas()
    report = {"inputs": {}, "sites": {}, "stack_continuity": {}, "players": {}, "preliminary_blocks": {}}
    report["inputs"] = {
        "phh_dataset_commit": subprocess.run(["git", "-C", str(src), "rev-parse", "HEAD"],
                                             capture_output=True, text=True).stdout.strip(),
        "files": len(files), "bytes": sum(f.stat().st_size for f in files),
        "build_script_sha256": hashlib.sha256(script.read_bytes()).hexdigest(),
        "python": platform.python_version(), "pyarrow": pa.__version__, "pandas": pd.__version__,
        "built_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "parse": {k: v for k, v in totals.items() if k != "hands"},
    }
    for site, g in h.groupby("site"):
        ok = g[g.status == "ok"]
        raked = ok[ok.pot_usd > 0]
        report["sites"][site] = {
            "hands": int(len(g)),
            "status": {k: int(v) for k, v in g.status.value_counts().items()},
            "ok_share": round(float((g.status == "ok").mean()), 5),
            "unusual_blinds_share": round(float(g["flags"].str.contains("unusual_blinds").mean()), 5),
            "first_ts": str(g.ts.min()), "last_ts": str(g.ts.max()),
            "days_covered": int(g.ts.dt.date.nunique()),
            "tables": int(g["table"].nunique()),
            "duplicate_hand_ids": int(g.hand_id.duplicated().sum()),
            "rake_bb_per_hand_mean": round(float((ok.rake_usd / ok.bb_usd).mean()), 4),
            "raked_hand_share": round(float((raked.rake_usd > TOL).mean()), 4),
            "rake_usd_max": round(float(ok.rake_usd.max()), 2),
            "rake_share_of_pot_p99": round(float((raked.rake_usd / raked.pot_usd).quantile(0.99)), 4),
        }

    usable = p[p.net_usd.notna()].sort_values(["site", "table", "player", "ts", "hand_id"])
    g = usable.groupby(["site", "table", "player"], sort=False)
    nxt = g.starting_stack_usd.shift(-1)
    gap = (g.ts.shift(-1) - usable.ts).dt.total_seconds()
    pair = nxt.notna() & gap.between(0, 300)
    diff = (nxt - (usable.starting_stack_usd + usable.net_usd))[pair]
    for site in sorted(usable.site.unique()):
        d = diff[usable.site[pair] == site]
        st = usable.status[pair][usable.site[pair] == site]
        report["stack_continuity"][site] = {
            "pairs_within_5_min": int(len(d)),
            "match_within_1_cent": round(float((d.abs() <= 0.011).mean()), 5),
            "next_stack_higher": round(float((d > 0.011).mean()), 5),
            "next_stack_lower": round(float((d < -0.011).mean()), 5),
            "match_when_hand_ok": round(float((d[st == "ok"].abs() <= 0.011).mean()), 5),
        }

    ok = p[p.status == "ok"]
    for site, g in ok.groupby("site"):
        n = g.groupby("player").size()
        days = g.assign(day=g.ts.dt.date).groupby("player").day.nunique()
        report["players"][site] = {
            "distinct": int(len(n)),
            **{f"with_at_least_{t}_hands": int((n >= t).sum()) for t in (1000, 5000, 10000, 20000, 50000)},
            "top_10_hand_counts": [int(x) for x in n.sort_values(ascending=False).head(10)],
            "median_days_for_players_with_1000_plus": float(days[n[n >= 1000].index].median()),
        }
        # Preliminary only: per-player SD of 100-hand block totals, in time order.
        sds, means = [], []
        for _, s in g[g.player.isin(n[n >= 5000].index)].sort_values(["ts", "hand_id"]).groupby("player"):
            x = s.net_bb.to_numpy()
            k = len(x) // 100
            blocks = x[: k * 100].reshape(k, 100).sum(axis=1)
            sds.append(blocks.std(ddof=1))
            means.append(blocks.mean())
        if sds:
            report["preliminary_blocks"][site] = {
                "players": len(sds),
                "block_sd_bb100_median": round(float(np.median(sds)), 1),
                "block_sd_bb100_iqr": [round(float(q), 1) for q in np.percentile(sds, [25, 75])],
                "winrate_bb100_median": round(float(np.median(means)), 2),
                "winrate_bb100_iqr": [round(float(q), 2) for q in np.percentile(means, [25, 75])],
            }
    return report


def main():
    src, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    root = src / "data" / "handhq"
    files = []
    for folder in sorted(root.iterdir()):
        m = FOLDER_RE.match(folder.name)
        if m and m["site"] in WINNINGS_INCLUDE_UNCALLED:
            files += sorted(folder.rglob("*.phhs"))
    out.mkdir(parents=True, exist_ok=True)
    hw = pq.ParquetWriter(out / "hands.parquet", HAND_SCHEMA, compression="zstd")
    pw = pq.ParquetWriter(out / "player_hands.parquet", PLAYER_SCHEMA, compression="zstd")
    hbuf = {f.name: [] for f in HAND_SCHEMA}
    pbuf = {f.name: [] for f in PLAYER_SCHEMA}
    totals = Counter()
    with Pool(14) as pool:
        for done, (hands, players, counts) in enumerate(
                pool.imap_unordered(process, [(str(f), str(root)) for f in files], chunksize=4), 1):
            totals.update(counts)
            for k in hbuf:
                hbuf[k] += hands[k]
            for k in pbuf:
                pbuf[k] += players[k]
            if len(pbuf["player"]) >= 500_000:
                flush(hw, hbuf, HAND_SCHEMA)
                flush(pw, pbuf, PLAYER_SCHEMA)
            if done % 200 == 0:
                print(f"{done}/{len(files)} files, {totals['hands']:,} hands", flush=True)
    flush(hw, hbuf, HAND_SCHEMA)
    flush(pw, pbuf, PLAYER_SCHEMA)
    hw.close()
    pw.close()
    report = summarize(out, totals, files, src, Path(__file__).resolve())
    (out / "build_report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
