"""Does the page read session files and estimate from them as the Python code does?

The page (standalone/shared/sessions.js) and this script handle the same files
separately:

                        page                          this script
  reading the file      its own CSV reader            pandas (options given per file below)
  win rate, volatility, hands-weighted, its own code  src.inference.estimate_edge
  standard error
  volatility interval   own chi-square quantile       scipy.stats.chi2
  length check          own Welch test                numpy + scipy.stats.norm
  stability check       own blocks and F test         src.inference.estimate_edge (scipy.stats.f)
  group comparison      own F test                    numpy + scipy.stats.f
  time order            date if every session has     the same rule, in pandas
                        one, else file order

This is an internal check: both sides are this repository's code, so agreement
shows the page computes what the research code computes, not that the model
describes real results (checks/session-lengths/ tests that by simulation).

    python -I checks/session-import-python/run.py            # print
    python -I checks/session-import-python/run.py --write    # also save results.json
    python -I checks/session-import-python/run.py --check    # compare with results.json
    pytest tests/test_web_session_import.py                  # the same comparison, in CI

It reads web.json, which ours.js writes, so it needs no Node.
"""

from __future__ import annotations

import json
import math
import os
import platform
import sys
import warnings
from importlib.metadata import version

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, REPO)

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from scipy import stats  # noqa: E402

from src.inference import estimate_edge  # noqa: E402

# How each file is to be read, stated here rather than detected, and what its columns mean.
READ = {
    "european.csv": {"options": {"sep": ";", "decimal": ",", "comment": "#"},
                     "columns": {"Date": "date", "Stake": "stake", "Hands": "hands", "Profit (bb)": "profit"}},
}
DEFAULT_READ = {"options": {}, "columns": {"date": "date", "stake": "stake", "game": "game", "hands": "hands", "profit_bb": "profit"}}
TOLERANCE = {"relative": 1e-9, "probability": 1e-6}


def read_sessions(name: str) -> pd.DataFrame:
    spec = READ.get(name, DEFAULT_READ)
    df = pd.read_csv(os.path.join(HERE, "files", name), dtype=str, keep_default_na=False, **spec["options"])
    df = df.rename(columns=spec["columns"])
    for column in ("stake", "game", "date"):
        if column not in df:
            df[column] = ""
    decimal = spec["options"].get("decimal", ".")
    df["hands"] = pd.to_numeric(df["hands"].str.strip(), errors="coerce")
    df["profit"] = pd.to_numeric(df["profit"].str.strip().str.replace(decimal, ".", regex=False), errors="coerce")
    parsed = pd.to_datetime(df["date"].str.strip(), format="%Y-%m-%d", errors="coerce")
    ok = (df["hands"] > 0) & (df["hands"] % 1 == 0) & df["profit"].notna() & ((df["date"].str.strip() == "") | parsed.notna())
    df = df[ok].copy()
    df["date"] = parsed[ok].dt.strftime("%Y-%m-%d").fillna("")
    df["order"] = range(len(df))
    df["dropped"] = int((~ok).sum())
    return df.reset_index(drop=True)


def chronological(df: pd.DataFrame) -> pd.DataFrame:
    return df.sort_values(["date", "order"], kind="stable") if (df["date"] != "").all() else df


def weighted(df: pd.DataFrame) -> dict:
    h, p = df["hands"].to_numpy(float), df["profit"].to_numpy(float)
    rate = 100 * p.sum() / h.sum()
    w, r = h / 100, 100 * p / h
    return {"n": len(df), "hands": h.sum(), "profit": p.sum(), "winRate": rate,
            "variance": float(np.sum(w * (r - rate) ** 2) / (len(df) - 1)) if len(df) > 1 else None}


def heterogeneity(groups: list[dict], win_rate: float) -> dict:
    # One-way ANOVA weighted by hands: between groups against within them.
    total = sum(g["hands"] for g in groups) / 100
    b = sum((g["hands"] / 100) * (g["winRate"] - win_rate) ** 2 for g in groups)
    e = sum((g["n"] - 1) * g["variance"] for g in groups if g["n"] > 1)
    se = sum((g["hands"] / 100 / total) ** 2 * (g["winRate"] - win_rate) ** 2 for g in groups)
    G, n = len(groups), sum(g["n"] for g in groups)
    f = p = None
    if n > G and (b > 0 or e > 0):
        f = (b / (G - 1)) / (e / (n - G)) if e > 0 else math.inf
        p = float(stats.f.sf(f, G - 1, n - G)) if e > 0 else 0.0
    return {"groups": G, "f": f, "df": [G - 1, n - G], "p": p, "standardError": math.sqrt(G / (G - 1) * se)}


def summarize(df: pd.DataFrame) -> dict:
    # In time order, which the stability check needs; the rest does not depend on order.
    ordered = chronological(df)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        est = estimate_edge(ordered["hands"].to_numpy(float), ordered["profit"].to_numpy(float))
    n, sd, se = est.n_blocks, est.std_bb100, est.se_winrate
    h = df["hands"].to_numpy(float)
    out = {
        "n": n, "hands": float(est.total_hands), "winRate": est.winrate_bb100, "sd": sd, "standardError": se,
        "sdInterval": [sd * math.sqrt((n - 1) / stats.chi2.ppf(0.975, n - 1)), sd * math.sqrt((n - 1) / stats.chi2.ppf(0.025, n - 1))],
        "lengths": {"min": h.min(), "max": h.max(), "mean": h.mean(), "median": float(np.median(h)), "cv": float(h.std() / h.mean())},
        "scaling": None, "stability": None,
    }
    if h.min() != h.max() and n >= 20:
        by_length = df.sort_values(["hands", "order"], kind="stable")
        half = n // 2
        parts = []
        for part in (by_length.iloc[:half], by_length.iloc[half:]):
            ph, pp = part["hands"].to_numpy(float), part["profit"].to_numpy(float)
            d = np.sqrt(ph / 100) * np.abs(100 * pp / ph - est.winrate_bb100)
            parts.append((len(part), d.mean(), d.var(ddof=1), math.sqrt(weighted(part)["variance"])))
        (ns, ms, vs, sds), (nl, ml, vl, sdl) = parts
        z = (ms - ml) / math.sqrt(vs / ns + vl / nl)
        p = min(1.0, 2 * float(stats.norm.sf(abs(z))))
        out["scaling"] = {"short": {"n": ns, "sd": sds}, "long": {"n": nl, "sd": sdl}, "ratio": ms / ml, "z": z, "p": p,
                          "flag": bool(p < 0.01 and abs(math.log(ms / ml)) > math.log(1.12))}
    if est.stability_groups:
        out["stability"] = {"groups": est.stability_groups, "f": est.stability_f,
                            "df": [est.stability_groups - 1, n - est.stability_groups], "p": est.stability_p,
                            "standardError": est.se_between_groups, "flag": est.stability_flag,
                            "multiplier": est.stability_multiplier}
    return out


def group_key(df: pd.DataFrame, by: str) -> pd.Series:
    if by in ("stake", "game"):
        return df[by]
    dated = df["date"] != ""
    if by == "year":
        return df["date"].str[:4]
    if by == "quarter":
        month = pd.to_numeric(df["date"].str[5:7], errors="coerce").fillna(1).astype(int)
        return (df["date"].str[:4] + "-Q" + ((month + 2) // 3).astype(str)).where(dated, "")
    return df["date"].str[:7]


class Diff:
    def __init__(self) -> None:
        self.count, self.largest, self.failures = 0, {"relative": 0.0, "probability": 0.0}, []

    def add(self, name: str, web, py, kind: str = "relative") -> None:
        if isinstance(py, list):
            for i, (a, b) in enumerate(zip(web, py)):
                self.add(f"{name}[{i}]", a, b, kind)
            if len(web) != len(py):
                self.failures.append(f"{name}: lengths differ")
            return
        self.count += 1
        if py is None or web is None:
            if web is not py:
                self.failures.append(f"{name}: web {web!r}, python {py!r}")
            return
        if isinstance(py, bool) or isinstance(web, bool) or isinstance(py, str):
            if web != py:
                self.failures.append(f"{name}: web {web!r}, python {py!r}")
            return
        diff = abs(web - py) / max(1.0, abs(py)) if kind == "relative" else abs(web - py)
        self.largest[kind] = max(self.largest[kind], diff)
        if diff > TOLERANCE[kind]:
            self.failures.append(f"{name}: web {web!r}, python {py!r}")

    def summary(self, web: dict, py: dict, name: str) -> None:
        for key in ("n", "hands", "winRate", "sd", "standardError"):
            self.add(f"{name} {key}", web[key], py[key])
        for i in (0, 1):
            self.add(f"{name} volatility interval[{i}]", web["sdInterval"][i], py["sdInterval"][i])
        for key, value in py["lengths"].items():
            self.add(f"{name} lengths.{key}", web["lengths"][key], value)
        for check in ("scaling", "stability"):
            if (web[check] is None) != (py[check] is None):
                self.failures.append(f"{name} {check}: present on one side only")
                continue
            if py[check] is None:
                continue
            for key, value in py[check].items():
                if isinstance(value, dict):
                    for sub, v in value.items():
                        self.add(f"{name} {check}.{key}.{sub}", web[check][key][sub], v)
                else:
                    self.add(f"{name} {check}.{key}", web[check][key], value, "probability" if key == "p" else "relative")


def compare_file(entry: dict) -> dict:
    d = Diff()
    df = read_sessions(entry["file"])
    d.add("sessions read", len(entry["sessions"]), len(df))
    d.add("rows that could not be read", len(entry["problems"]), int(df["dropped"].iloc[0]) if len(df) else 0)
    for i, (session, (_, row)) in enumerate(zip(entry["sessions"], df.iterrows())):
        d.add(f"session {i} hands", session["hands"], float(row["hands"]))
        d.add(f"session {i} profit", session["profit"], float(row["profit"]))
        for key in ("stake", "game", "date"):
            d.add(f"session {i} {key}", session[key] or "", row[key] or "")
    for selection in entry["selections"]:
        f = selection["filter"]
        chosen = df
        if f["stakes"]:
            chosen = chosen[chosen["stake"].isin(f["stakes"])]
        if f["games"]:
            chosen = chosen[chosen["game"].isin(f["games"])]
        if f["from"]:
            chosen = chosen[(chosen["date"] != "") & (chosen["date"].str[:7] >= f["from"])]
        if f["to"]:
            chosen = chosen[(chosen["date"] != "") & (chosen["date"].str[:7] <= f["to"])]
        d.summary(selection["summary"], summarize(chosen.reset_index(drop=True)), selection["id"])
    for grouping in entry["groupings"]:
        overall = summarize(df)
        keys = group_key(df, grouping["by"])
        py_groups = []
        for web_group in grouping["groups"]:
            part = df[keys == web_group["key"]]
            g = weighted(part)
            py_groups.append(g)
            name = f"{grouping['by']} {web_group['key'] or '(none)'}"
            d.add(f"{name} n", web_group["n"], g["n"])
            d.add(f"{name} win rate", web_group["winRate"], g["winRate"])
            if g["variance"] is not None:
                d.add(f"{name} sd", web_group["sd"], math.sqrt(g["variance"]))
                d.add(f"{name} standard error", web_group["standardError"], math.sqrt(g["variance"]) / math.sqrt(g["hands"] / 100))
        d.add(f"{grouping['by']}: every session in exactly one group", sum(g["n"] for g in py_groups), len(df))
        het = heterogeneity(py_groups, overall["winRate"])
        for key, value in het.items():
            d.add(f"{grouping['by']} test {key}", grouping["test"][key], value, "probability" if key == "p" else "relative")
    return {"file": entry["file"], "sessions": len(df), "comparisons": d.count,
            "largest_difference": {k: float(f"{v:.1e}") for k, v in d.largest.items()},
            "failures": d.failures[:20], "passed": not d.failures}


def run() -> dict:
    with open(os.path.join(HERE, "web.json")) as f:
        web = json.load(f)
    files = [compare_file(entry) for entry in web["files"]]
    return {
        "purpose": "Internal check: the page's session import and estimates against pandas, src/inference.py and scipy.",
        "command": "python -I checks/session-import-python/run.py --check",
        "tolerance": TOLERANCE,
        "environment": {"python": platform.python_version(), "pandas": version("pandas"), "scipy": version("scipy"), "numpy": version("numpy")},
        "files": files,
        "comparisons": sum(f["comparisons"] for f in files),
        "all_passed": all(f["passed"] for f in files),
    }


def main() -> None:
    result = run()
    text = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    path = os.path.join(HERE, "results.json")
    if "--check" in sys.argv:
        with open(path) as f:
            if f.read() != text:
                sys.exit(f"Results differ from {os.path.relpath(path, REPO)}.")
        print(f"Results match {os.path.relpath(path, REPO)}.")
        return
    if "--write" in sys.argv:
        with open(path, "w") as f:
            f.write(text)
    for f in result["files"]:
        print(f"  {f['file']:<22} {f['sessions']:>4} sessions {f['comparisons']:>5} numbers  "
              f"largest {f['largest_difference']['relative']:.1e} / p {f['largest_difference']['probability']:.1e}  "
              f"{'pass' if f['passed'] else 'FAIL'}")
        for failure in f["failures"]:
            print(f"      {failure}")
    print(f"{result['comparisons']} numbers compared. " + ("All passed." if result["all_passed"] else "FAILED."))
    if not result["all_passed"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
