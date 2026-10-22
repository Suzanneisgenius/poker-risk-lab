"""Reproducible validation run.

Runs one seeded scenario, prints the headline metrics and the
Monte Carlo vs analytical vs Markov comparison table. Every number here is a
deterministic function of the CLI arguments (including --seed).

Example
-------
    python scripts/run_validation.py \
        --winrate 3.0 --std 90 --bankroll 3000 \
        --hands 100000 --paths 50000 --seed 42
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.analytics import (  # noqa: E402
    drawdown_analytics,
    estimate_risk_of_ruin,
    growth_analytics,
    time_to_ruin_analytics,
)
from src.simulation import simulate_bankroll  # noqa: E402
from src.validation import validation_comparison  # noqa: E402


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Bankroll risk validation run.")
    p.add_argument("--winrate", type=float, default=3.0, help="bb/100")
    p.add_argument("--std", type=float, default=90.0, help="bb/100")
    p.add_argument("--bankroll", type=float, default=3000.0, help="bb")
    p.add_argument("--threshold", type=float, default=0.0, help="ruin bb")
    p.add_argument("--hands", type=int, default=100_000)
    p.add_argument("--paths", type=int, default=50_000)
    p.add_argument("--step", type=int, default=100)
    p.add_argument("--seed", type=int, default=42)
    return p.parse_args()


def main() -> None:
    a = parse_args()
    res = simulate_bankroll(
        n_paths=a.paths, n_hands=a.hands, winrate_bb100=a.winrate,
        std_bb100=a.std, bankroll_bb=a.bankroll,
        ruin_threshold_bb=a.threshold, seed=a.seed, step_hands=a.step,
    )
    ror = estimate_risk_of_ruin(res, seed=a.seed)
    dd = drawdown_analytics(res)
    growth = growth_analytics(res)
    ttr = time_to_ruin_analytics(res)
    comp = validation_comparison(res, ror)

    print("=" * 62)
    print("POKER BANKROLL RISK — VALIDATION RUN")
    print("=" * 62)
    print(f"Parameters: winrate={a.winrate} bb/100  std={a.std} bb/100")
    print(f"            bankroll={a.bankroll} bb  threshold={a.threshold} bb")
    print(f"            hands={a.hands:,}  paths={a.paths:,}  "
          f"step={a.step}  seed={a.seed}")
    print("-" * 62)
    print("HEADLINE METRICS")
    print(f"  Risk of Ruin            : {ror['point_estimate']:.4f} "
          f"[95% CI {ror['ci_low']:.4f}, {ror['ci_high']:.4f}]")
    print(f"  P95 Max Drawdown        : {dd['p95_max_drawdown']:.1f} bb")
    print(f"  Expected Growth (mean)  : {growth['mean_net_growth']:.1f} bb "
          f"({growth['expected_growth_pct']:.1f}%)")
    print(f"  Median Terminal Bankroll: {growth['median_terminal_bankroll']:.1f} bb")
    print(f"  Probability of Profit   : {growth['prob_profit']:.4f}")
    med = ttr["median_ruin_hand"]
    print(f"  Median Time to Ruin     : "
          f"{'n/a' if med != med else f'{med:,.0f} hands'}")
    print(f"  Paths Simulated         : {ror['n_paths']:,}")
    print("-" * 62)
    print("VALIDATION COMPARISON")
    print(f"  {'Method':<42}{'Risk of Ruin'}")
    m = comp["methods"]
    lo, hi = m["monte_carlo_ci"]
    print(f"  {'Monte Carlo, finite horizon':<42}{m['monte_carlo_finite']:.4f}")
    print(f"  {'  95% confidence interval':<42}[{lo:.4f}, {hi:.4f}]")
    print(f"  {'Brownian approx, finite horizon':<42}{m['brownian_finite']:.4f}")
    print(f"  {'Brownian approx, infinite horizon':<42}{m['brownian_infinite']:.4f}")
    if "markov_chain" in m:
        print(f"  {'Markov chain, finite step':<42}{m['markov_chain']:.4f}")
    print("-" * 62)
    print("DIFFERENCES vs finite-horizon Brownian benchmark")
    for name, d in comp["differences_vs_finite"].items():
        rel = "n/a" if d["relative"] != d["relative"] else f"{d['relative']*100:.1f}%"
        print(f"  {name:<28} abs={d['absolute']:.4f}  rel={rel}")
    print(f"\n  Verdict (MC vs finite Brownian): {comp['verdict_mc_vs_finite']}")
    print("=" * 62)
    print("Reproduce with:")
    print(f"  python scripts/run_validation.py --winrate {a.winrate} "
          f"--std {a.std} --bankroll {a.bankroll} --hands {a.hands} "
          f"--paths {a.paths} --seed {a.seed}")


if __name__ == "__main__":
    main()
