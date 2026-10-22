"""Do the two bankroll engines agree? The web engine (server/compute.js) and the
research engine (src/simulation.py) implement the same model with different
code and different random numbers, so they should agree within Monte Carlo
error, and with the bridge correction both should match the finite-horizon
Brownian formula.

    python -I checks/engine-agreement/run.py            # print
    python -I checks/engine-agreement/run.py --write    # also save results.json

Run from the repository root.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, REPO)

from src.simulation import simulate_bankroll  # noqa: E402
from src.validation import brownian_ruin_finite  # noqa: E402

PATHS = 200_000
SEED = 1
SCENARIOS = [
    {"winrate_bb100": 3.0, "std_bb100": 90.0, "bankroll_bb": 3000.0, "n_hands": 100_000},
    {"winrate_bb100": 0.0, "std_bb100": 90.0, "bankroll_bb": 3000.0, "n_hands": 100_000},
]
JS = """
const {simulateBankroll} = require(process.argv[1] + "/server/compute.js");
const [wr, sd, bank, hands, paths, seed, bridge] = JSON.parse(process.argv[2]);
const r = simulateBankroll({wr, sd, bank, thr: 0, hands, paths, step: 100, seed}, paths, 0, {bridge});
process.stdout.write(String(r.ruinedCount));
"""


def js_ruined(sc: dict, bridge: bool) -> int:
    args = json.dumps([sc["winrate_bb100"], sc["std_bb100"], sc["bankroll_bb"], sc["n_hands"], PATHS, SEED, bridge])
    out = subprocess.run(["node", "-e", JS, REPO, args], check=True, capture_output=True, text=True)
    return int(out.stdout)


def py_ruined(sc: dict, bridge: bool) -> int:
    sim = simulate_bankroll(n_paths=PATHS, n_hands=sc["n_hands"], winrate_bb100=sc["winrate_bb100"],
                            std_bb100=sc["std_bb100"], bankroll_bb=sc["bankroll_bb"], seed=SEED,
                            store_n_paths=0, bridge=bridge)
    return int(sim["ruined"].sum())


def z(a: float, b: float, n: int) -> float:
    se = math.sqrt(a * (1 - a) / n + b * (1 - b) / n)
    return (a - b) / se if se > 0 else 0.0


def main() -> None:
    rows = []
    for sc in SCENARIOS:
        exact = brownian_ruin_finite(sc["winrate_bb100"], sc["std_bb100"], sc["bankroll_bb"], sc["n_hands"])["probability"]
        for bridge in (True, False):
            js, py = js_ruined(sc, bridge) / PATHS, py_ruined(sc, bridge) / PATHS
            row = {"scenario": sc, "bridge": bridge, "web_engine": js, "research_engine": py,
                   "difference_pp": (js - py) * 100, "difference_in_se": z(js, py, PATHS)}
            if bridge:
                row.update({"analytical": exact,
                            "web_vs_analytical_se": (js - exact) / math.sqrt(exact * (1 - exact) / PATHS),
                            "research_vs_analytical_se": (py - exact) / math.sqrt(exact * (1 - exact) / PATHS)})
            rows.append(row)
    result = {
        "purpose": "Web engine (server/compute.js) against research engine (src/simulation.py), and both against the analytical value.",
        "command": "python -I checks/engine-agreement/run.py --write",
        "paths_per_run": PATHS, "seed": SEED,
        "note": "Different random-number generators (sfc32 per path in the web engine, numpy PCG64 in the research engine), so agreement is statistical, not exact. Without the bridge correction there is no closed-form value; the two engines are compared with each other only.",
        "rows": rows,
        "all_within_3_se": all(abs(r["difference_in_se"]) <= 3 and abs(r.get("web_vs_analytical_se", 0)) <= 3
                               and abs(r.get("research_vs_analytical_se", 0)) <= 3 for r in rows),
    }
    if "--write" in sys.argv:
        with open(os.path.join(HERE, "results.json"), "w") as f:
            json.dump(result, f, indent=2)
            f.write("\n")
    for r in rows:
        line = (f"{r['scenario']['winrate_bb100']:+.0f} bb/100, bridge {'on ' if r['bridge'] else 'off'}: "
                f"web {r['web_engine']:.4%}  research {r['research_engine']:.4%}  ({r['difference_in_se']:+.2f} SE)")
        if r["bridge"]:
            line += f"  analytical {r['analytical']:.4%}"
        print(line)
    print("All within 3 SE." if result["all_within_3_se"] else "Some differences exceed 3 SE.")


if __name__ == "__main__":
    main()
