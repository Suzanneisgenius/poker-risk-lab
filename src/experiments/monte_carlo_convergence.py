"""Monte Carlo convergence, confidence-interval coverage, and cost scaling.

Fixing a scenario and monitoring resolution, we study the ruin-probability
*estimator* as the simulation budget N grows:

- **Bias** relative to a high-precision reference estimate.
- **Estimator standard deviation** across independent seeds.
- **RMSE** and **empirical O(N^-1/2) rate** (the log-log slope is *fitted*, not
  assumed to be -0.5, and reported with its standard error).
- **Wilson interval coverage** and average interval width.
- **Runtime** per budget.

A reproducible sequential stopping rule is also provided: keep adding batches of
paths until the Wilson half-width falls below a tolerance, subject to min/max
path budgets, and report how many paths were actually used.

Run:
    python -m src.experiments.monte_carlo_convergence --config configs/monte_carlo_convergence.yaml
"""

from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from src.experiments._provenance import provenance
from src.simulation import simulate_bankroll

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
Z95 = 1.959963984540054


@dataclass(frozen=True)
class Scenario:
    winrate_bb100: float
    std_bb100: float
    bankroll_bb: float
    ruin_threshold_bb: float
    n_hands: int
    step_hands: int = 100


def _seeds(base_seed: int, n: int) -> list[int]:
    """Principled, reproducible seed splitting via SeedSequence."""
    children = np.random.SeedSequence(base_seed).spawn(n)
    return [int(c.generate_state(1)[0]) for c in children]


def ruin_estimate(sc: Scenario, n_paths: int, seed: int) -> float:
    # The estimand here is the discretely monitored ruin probability, so the
    # bridge correction stays off (this also keeps the saved results
    # reproducible).
    res = simulate_bankroll(
        n_paths=n_paths, n_hands=sc.n_hands, winrate_bb100=sc.winrate_bb100,
        std_bb100=sc.std_bb100, bankroll_bb=sc.bankroll_bb,
        ruin_threshold_bb=sc.ruin_threshold_bb, seed=seed,
        step_hands=sc.step_hands, store_n_paths=0, bridge=False,
    )
    return float(res["ruined"].mean())


def wilson(k: int, n: int, z: float = Z95) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def reference_probability(sc: Scenario, ref_paths: int, ref_seed: int) -> float:
    """High-precision reference estimate of the (discrete-monitoring) estimand."""
    return ruin_estimate(sc, ref_paths, ref_seed)


def run_convergence(
    sc: Scenario,
    budgets: list[int],
    n_seeds: int,
    base_seed: int,
    reference: float,
) -> pd.DataFrame:
    """Estimator diagnostics per budget, aggregated over independent seeds."""
    seeds = _seeds(base_seed, n_seeds)
    rows = []
    for n_paths in budgets:
        phats, widths, covered, runtimes = [], [], [], []
        for s in seeds:
            t0 = time.perf_counter()
            p = ruin_estimate(sc, n_paths, s)
            runtimes.append(time.perf_counter() - t0)
            k = int(round(p * n_paths))
            lo, hi = wilson(k, n_paths)
            phats.append(p)
            widths.append(hi - lo)
            covered.append(lo <= reference <= hi)
        phats = np.asarray(phats)
        bias = float(phats.mean() - reference)
        emp_std = float(phats.std(ddof=1))
        rmse = float(np.sqrt(np.mean((phats - reference) ** 2)))
        theo_std = float(np.sqrt(reference * (1 - reference) / n_paths))
        rows.append({
            "n_paths": n_paths,
            "mean_estimate": float(phats.mean()),
            "bias": bias,
            "empirical_std": emp_std,
            "theoretical_std": theo_std,
            "rmse": rmse,
            "coverage": float(np.mean(covered)),
            "avg_ci_width": float(np.mean(widths)),
            "mean_runtime_s": float(np.mean(runtimes)),
            "n_seeds": n_seeds,
        })
    return pd.DataFrame(rows)


def fit_rate(df: pd.DataFrame, col: str = "empirical_std") -> dict[str, float]:
    """Fit log(col) = a + b log(N); return slope b and its standard error.

    For an O(N^-1/2) estimator the slope should be near -0.5. We *report* it.
    """
    x = np.log(df["n_paths"].to_numpy(dtype=float))
    y = np.log(df[col].to_numpy(dtype=float))
    n = x.size
    b, a = np.polyfit(x, y, 1)
    yhat = a + b * x
    resid = y - yhat
    s2 = float(np.sum(resid ** 2) / (n - 2)) if n > 2 else float("nan")
    sxx = float(np.sum((x - x.mean()) ** 2))
    se_b = float(np.sqrt(s2 / sxx)) if sxx > 0 else float("nan")
    return {"slope": float(b), "slope_se": se_b, "intercept": float(a)}


def sequential_stopping(
    sc: Scenario,
    tol_halfwidth: float,
    min_paths: int,
    max_paths: int,
    batch: int,
    seed: int,
) -> dict[str, Any]:
    """Add batches of paths until the Wilson half-width < tol (reproducible).

    Batching is deterministic: batch i uses a fixed child seed, so the whole
    run is reproducible and independent of timing.
    """
    child = _seeds(seed, max(1, max_paths // batch + 1))
    n_used = 0
    n_ruined = 0
    i = 0
    reason = "reached max_paths"
    while n_used < max_paths:
        b = min(batch, max_paths - n_used)
        p = ruin_estimate(sc, b, child[i])
        n_ruined += int(round(p * b))
        n_used += b
        i += 1
        if n_used >= min_paths:
            lo, hi = wilson(n_ruined, n_used)
            if (hi - lo) / 2 <= tol_halfwidth:
                reason = "tolerance met"
                break
    lo, hi = wilson(n_ruined, n_used)
    return {
        "paths_used": n_used,
        "estimate": n_ruined / n_used,
        "ci_low": lo, "ci_high": hi,
        "final_halfwidth": (hi - lo) / 2,
        "stopping_reason": reason,
    }


# ---------------------------------------------------------------------------
# Figures
# ---------------------------------------------------------------------------


def make_figures(df: pd.DataFrame, rate: dict[str, float], outdir: str, tag: str) -> list[str]:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({
        "figure.facecolor": "#0B1220", "axes.facecolor": "#0B1220",
        "savefig.facecolor": "#0B1220", "text.color": "#E6EDF3",
        "axes.labelcolor": "#E6EDF3", "xtick.color": "#94A3B8",
        "ytick.color": "#94A3B8", "axes.edgecolor": "#243247",
        "grid.color": "#243247", "font.size": 10,
    })
    ACC, POS, WARN = "#38BDF8", "#4ADE80", "#FBBF24"
    os.makedirs(outdir, exist_ok=True)
    paths = []

    # Fig 1: std vs N (log-log) with fitted slope + theoretical.
    fig, ax = plt.subplots(figsize=(7, 4.3))
    ax.loglog(df["n_paths"], df["empirical_std"], "o", color=ACC, label="Empirical std")
    ax.loglog(df["n_paths"], df["theoretical_std"], "--", color=WARN, label="Theoretical √(p(1−p)/N)")
    xline = np.array([df["n_paths"].min(), df["n_paths"].max()], dtype=float)
    yline = np.exp(rate["intercept"]) * xline ** rate["slope"]
    ax.loglog(xline, yline, "-", color=POS, alpha=0.7,
              label=f"Fit slope = {rate['slope']:.3f} ± {rate['slope_se']:.3f}")
    ax.set_xlabel("Simulation budget N (paths, log scale)")
    ax.set_ylabel("Estimator standard deviation (log scale)")
    ax.set_title("Monte Carlo convergence rate (expected slope ≈ −0.5)")
    ax.grid(True, which="both", alpha=0.3); ax.legend(frameon=False, fontsize=9)
    fig.tight_layout(); p1 = os.path.join(outdir, f"mc_convergence_rate_{tag}.png")
    fig.savefig(p1, dpi=140); plt.close(fig); paths.append(p1)

    # Fig 2: coverage vs N.
    fig, ax = plt.subplots(figsize=(7, 4.3))
    ax.semilogx(df["n_paths"], df["coverage"], "o-", color=ACC, label="Wilson 95% coverage")
    ax.axhline(0.95, color=POS, ls="--", label="Nominal 95%")
    ax.set_ylim(0.75, 1.02)
    ax.set_xlabel("Simulation budget N (paths, log scale)")
    ax.set_ylabel("Empirical coverage")
    ax.set_title("Confidence-interval coverage vs budget")
    ax.grid(True, alpha=0.3); ax.legend(frameon=False, fontsize=9)
    fig.tight_layout(); p2 = os.path.join(outdir, f"mc_coverage_{tag}.png")
    fig.savefig(p2, dpi=140); plt.close(fig); paths.append(p2)

    # Fig 3: CI width and runtime vs N.
    fig, ax = plt.subplots(figsize=(7, 4.3))
    ax.loglog(df["n_paths"], df["avg_ci_width"], "o-", color=ACC, label="Avg CI width")
    ax2 = ax.twinx()
    ax2.loglog(df["n_paths"], df["mean_runtime_s"], "s--", color=WARN, label="Runtime (s)")
    ax2.set_ylabel("Runtime (s)", color=WARN)
    ax.set_xlabel("Simulation budget N (paths, log scale)")
    ax.set_ylabel("Average CI width", color=ACC)
    ax.set_title("Precision and cost vs budget")
    ax.grid(True, which="both", alpha=0.3)
    fig.tight_layout(); p3 = os.path.join(outdir, f"mc_width_runtime_{tag}.png")
    fig.savefig(p3, dpi=140); plt.close(fig); paths.append(p3)
    return paths


# ---------------------------------------------------------------------------
# Config + CLI
# ---------------------------------------------------------------------------


def load_config(path: str) -> dict[str, Any]:
    with open(path) as f:
        text = f.read()
    if path.endswith((".yaml", ".yml")):
        import yaml
        return yaml.safe_load(text)
    return json.loads(text)


DEFAULT = {
    "scenario": {"winrate_bb100": 3.0, "std_bb100": 90.0, "bankroll_bb": 3000.0,
                 "ruin_threshold_bb": 0.0, "n_hands": 100000, "step_hands": 100},
    "budgets": [1000, 2500, 5000, 10000, 25000, 50000, 100000],
    "n_seeds": 40, "base_seed": 20240501,
    "reference_paths": 500000, "reference_seed": 999,
    "sequential": {"tol_halfwidth": 0.005, "min_paths": 2000,
                   "max_paths": 200000, "batch": 5000, "seed": 7},
}


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Monte Carlo convergence experiment.")
    ap.add_argument("--config", type=str, default=None)
    ap.add_argument("--n-seeds", type=int, default=None)
    ap.add_argument("--outdir", type=str, default=os.path.join(REPO_ROOT, "reports"))
    ap.add_argument("--tag", type=str, default="run")
    args = ap.parse_args(argv)

    cfg = load_config(args.config) if args.config else dict(DEFAULT)
    if args.n_seeds:
        cfg["n_seeds"] = args.n_seeds
    sc = Scenario(**cfg["scenario"])

    ref = reference_probability(sc, cfg["reference_paths"], cfg["reference_seed"])
    df = run_convergence(sc, cfg["budgets"], cfg["n_seeds"], cfg["base_seed"], ref)
    rate = fit_rate(df, "empirical_std")
    seq = sequential_stopping(sc, **cfg["sequential"])

    tables = os.path.join(args.outdir, "tables")
    figures = os.path.join(args.outdir, "figures")
    os.makedirs(tables, exist_ok=True)
    df.to_csv(os.path.join(tables, f"mc_convergence_{args.tag}.csv"), index=False)
    prov = provenance(experiment="monte_carlo_convergence", scenario=cfg["scenario"],
                      budgets=cfg["budgets"], n_seeds=cfg["n_seeds"],
                      reference=ref, rate=rate, sequential_result=seq)
    with open(os.path.join(tables, f"mc_convergence_{args.tag}.provenance.json"), "w") as f:
        json.dump(prov, f, indent=2)
    figs = make_figures(df, rate, figures, args.tag)

    pd.set_option("display.width", 200, "display.max_columns", 20)
    print(df.to_string(index=False))
    print(f"\nReference (high-precision) ruin prob: {ref:.4f}")
    print(f"Fitted convergence slope: {rate['slope']:.3f} ± {rate['slope_se']:.3f} "
          f"(theory -0.5)")
    print(f"Mean coverage across budgets: {df['coverage'].mean():.3f} (nominal 0.95)")
    print(f"Sequential stop: {seq['paths_used']:,} paths, reason='{seq['stopping_reason']}', "
          f"half-width={seq['final_halfwidth']:.4f}")
    print("Saved figures:", *[os.path.basename(p) for p in figs])


if __name__ == "__main__":
    main()
