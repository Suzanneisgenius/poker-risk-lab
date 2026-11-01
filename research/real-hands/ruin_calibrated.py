"""Chapter 3's ruin scenario rerun with tail and dependence settings taken from the data.

Uses this repository's run_model (src/models.py) with the case study's scenario, path count
and seed. Case study section 3 now computes the fitted rows itself (src/experiments/case_study.py);
this script keeps the figure-4 comparison of questions 1 and 2.

Usage, from the repository root:
    python -I -B research/real-hands/ruin_calibrated.py [output json]
The output defaults to reports/real-hands/q1q2/ruin_calibrated.json.
"""
import json
import sys
from pathlib import Path

import numpy as np

SCENARIO = dict(winrate_bb100=3.0, std_bb100=90.0, bankroll_bb=3000.0, n_hands=100000,
                ruin_threshold_bb=0.0, n_paths=40000, seed=20240601, step_hands=100)
RUNS = [
    ("Normal (case study baseline)", "gaussian", {}),
    ("t, df 3 (case study)", "student_t", {"df": 3.0}),
    ("t, df 7 (data, likelihood fit)", "student_t", {"df": 7.0}),
    ("t, df 10 (data, kurtosis)", "student_t", {"df": 10.0}),
    ("AR(1), phi 0.3 (case study)", "ar1", {"phi": 0.3}),
    ("AR(1), phi 0.01 (data, upper end)", "ar1", {"phi": 0.01}),
    ("Regimes (case study)", "regime_switching",
     {"p_stay_normal": 0.98, "p_stay_adverse": 0.90, "mu_adverse": -5.0, "vol_mult": 1.6}),
]


REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "reports" / "real-hands" / "q1q2" / "ruin_calibrated.json"


def main(out=OUT):
    sys.path.insert(0, str(REPO))
    from src.models import run_model
    rows = []
    for label, key, params in RUNS:
        r = run_model(key, params=params, **SCENARIO)
        p = r["risk_of_ruin"]
        rows.append({"label": label, "model": key, "params": params, "risk_of_ruin": p,
                     "mc_se": float(np.sqrt(p * (1 - p) / SCENARIO["n_paths"])),
                     "p95_max_drawdown": r["p95_max_drawdown"]})
        print(f"{label:36s} {p:7.2%} ± {rows[-1]['mc_se']:.2%}", flush=True)
    Path(out).write_text(json.dumps({"scenario": SCENARIO, "runs": rows}, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:2])
