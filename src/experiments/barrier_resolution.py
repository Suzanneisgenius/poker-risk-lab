"""Discrete vs continuous barrier monitoring — convergence experiment.

Monte Carlo detects ruin only at step boundaries, so it can miss an intrastep
crossing of the ruin barrier. This experiment runs the *same* bankroll scenario
at a range of monitoring resolutions (``step_hands``) and compares three ruin
estimates:

1. endpoint-only Monte Carlo (what the base engine does),
2. Brownian-bridge-corrected Monte Carlo (adds intrastep crossing probability),
3. the analytical continuous first-passage probability (resolution-independent).

For each resolution we report both MC estimates with Wilson intervals, the
absolute/relative error vs the analytical benchmark, the runtime, and the number
of steps. The question — does endpoint monitoring converge to the continuous
benchmark as ``step_hands`` shrinks, and does the bridge correction remove the
bias at coarse resolution? — is answered from the generated numbers, not assumed.

Run:
    python -m src.experiments.barrier_resolution --config configs/barrier_resolution.yaml
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
from src.simulation import _step_sizes
from src.validation import brownian_ruin_finite

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@dataclass(frozen=True)
class Scenario:
    winrate_bb100: float
    std_bb100: float
    bankroll_bb: float
    ruin_threshold_bb: float
    n_hands: int


def bridge_crossing_prob(a0: np.ndarray, a1: np.ndarray, s2: float) -> np.ndarray:
    """P(Brownian bridge between two above-barrier endpoints dips to the barrier).

    For endpoints at distances ``a0, a1 > 0`` above an absorbing barrier over an
    interval of variance ``s2``, the conditional crossing probability is
    ``exp(-2 a0 a1 / s2)``. Non-positive endpoints are handled by the caller.
    """
    with np.errstate(over="ignore", under="ignore", invalid="ignore"):
        p = np.exp(-2.0 * a0 * a1 / s2)
    return np.clip(p, 0.0, 1.0)


def wilson(k: int, n: int, z: float = 1.959963984540054) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, center - half), min(1.0, center + half))


def simulate_barrier_rates(
    sc: Scenario,
    step_hands: int,
    n_paths: int,
    seed: int,
    chunk_paths: int = 1000,
) -> dict[str, Any]:
    """Endpoint-only and bridge-corrected ruin rates for one resolution.

    Fully vectorized and chunked; never stores an ``n_paths x n_steps`` matrix
    across the whole run. The same RNG stream draws increments then bridge
    uniforms, so results are reproducible for a given seed.
    """
    sizes = np.asarray(_step_sizes(sc.n_hands, step_hands), dtype=np.float64)
    n_steps = sizes.size
    n_cols = n_steps + 1
    step_mean = sc.winrate_bb100 * sizes / 100.0
    step_std = sc.std_bb100 * np.sqrt(sizes / 100.0)
    interval_var = (sc.std_bb100 ** 2) * sizes / 100.0  # variance per interval
    b = sc.ruin_threshold_bb
    rng = np.random.default_rng(seed)

    n_end = 0
    n_bridge = 0
    start = 0
    while start < n_paths:
        m = min(chunk_paths, n_paths - start)
        z = rng.standard_normal(size=(m, n_steps))
        incr = step_mean[None, :] + step_std[None, :] * z
        raw = np.empty((m, n_cols))
        raw[:, 0] = sc.bankroll_bb
        np.cumsum(incr, axis=1, out=raw[:, 1:])
        raw[:, 1:] += sc.bankroll_bb
        a = raw - b  # distance above the barrier

        endpoint = (a <= 0).any(axis=1)
        n_end += int(endpoint.sum())

        # Bridge correction on intervals where both endpoints are above barrier.
        a0 = a[:, :-1]
        a1 = a[:, 1:]
        both_above = (a0 > 0) & (a1 > 0)
        pc = bridge_crossing_prob(a0, a1, interval_var[None, :])
        u = rng.random(size=(m, n_steps))
        cross = (both_above & (u < pc)).any(axis=1)
        bridge = endpoint | cross
        n_bridge += int(bridge.sum())
        start += m

    return {
        "step_hands": step_hands,
        "n_steps": n_steps,
        "n_paths": n_paths,
        "endpoint_ruin": n_end / n_paths,
        "endpoint_ci": wilson(n_end, n_paths),
        "bridge_ruin": n_bridge / n_paths,
        "bridge_ci": wilson(n_bridge, n_paths),
    }


def run_barrier_resolution(
    sc: Scenario,
    resolutions: list[int],
    n_paths: int,
    seed: int,
    chunk_paths: int = 1000,
) -> pd.DataFrame:
    """Run the experiment across resolutions; return a tidy DataFrame."""
    analytic = brownian_ruin_finite(
        sc.winrate_bb100, sc.std_bb100, sc.bankroll_bb, sc.n_hands,
        sc.ruin_threshold_bb,
    )["probability"]
    rows = []
    for step in resolutions:
        t0 = time.perf_counter()
        r = simulate_barrier_rates(sc, step, n_paths, seed, chunk_paths)
        runtime = time.perf_counter() - t0
        rows.append({
            "step_hands": step,
            "n_steps": r["n_steps"],
            "endpoint_ruin": r["endpoint_ruin"],
            "endpoint_ci_low": r["endpoint_ci"][0],
            "endpoint_ci_high": r["endpoint_ci"][1],
            "bridge_ruin": r["bridge_ruin"],
            "bridge_ci_low": r["bridge_ci"][0],
            "bridge_ci_high": r["bridge_ci"][1],
            "analytic_continuous": analytic,
            "endpoint_abs_err": abs(r["endpoint_ruin"] - analytic),
            "endpoint_rel_err": abs(r["endpoint_ruin"] - analytic) / analytic if analytic > 0 else np.nan,
            "bridge_abs_err": abs(r["bridge_ruin"] - analytic),
            "bridge_rel_err": abs(r["bridge_ruin"] - analytic) / analytic if analytic > 0 else np.nan,
            "runtime_s": runtime,
        })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Figures
# ---------------------------------------------------------------------------


def make_figures(df: pd.DataFrame, sc: Scenario, outdir: str, tag: str) -> list[str]:
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
    ACC, RUIN, POS = "#38BDF8", "#F87171", "#4ADE80"
    os.makedirs(outdir, exist_ok=True)
    paths = []
    analytic = float(df["analytic_continuous"].iloc[0])

    # Fig 1: risk vs step size
    fig, ax = plt.subplots(figsize=(7, 4.3))
    ax.errorbar(df["step_hands"], df["endpoint_ruin"],
                yerr=[df["endpoint_ruin"] - df["endpoint_ci_low"], df["endpoint_ci_high"] - df["endpoint_ruin"]],
                fmt="o-", color=ACC, capsize=3, label="Endpoint-only MC")
    ax.errorbar(df["step_hands"], df["bridge_ruin"],
                yerr=[df["bridge_ruin"] - df["bridge_ci_low"], df["bridge_ci_high"] - df["bridge_ruin"]],
                fmt="s-", color=POS, capsize=3, label="Bridge-corrected MC")
    ax.axhline(analytic, color="#FBBF24", ls="--", label=f"Analytical continuous ({analytic:.3f})")
    ax.set_xscale("log")
    ax.set_xlabel("Monitoring resolution — step size (hands, log scale)")
    ax.set_ylabel("Estimated risk of ruin")
    ax.set_title("Ruin estimate vs barrier-monitoring resolution")
    ax.grid(True, alpha=0.3); ax.legend(frameon=False, fontsize=9)
    fig.tight_layout(); p1 = os.path.join(outdir, f"barrier_risk_vs_step_{tag}.png")
    fig.savefig(p1, dpi=140); plt.close(fig); paths.append(p1)

    # Fig 2: absolute error vs step size (log-log)
    fig, ax = plt.subplots(figsize=(7, 4.3))
    ax.loglog(df["step_hands"], df["endpoint_abs_err"].clip(lower=1e-6), "o-", color=ACC, label="Endpoint-only")
    ax.loglog(df["step_hands"], df["bridge_abs_err"].clip(lower=1e-6), "s-", color=POS, label="Bridge-corrected")
    ax.set_xlabel("Step size (hands, log scale)")
    ax.set_ylabel("|MC − analytical continuous| (log scale)")
    ax.set_title("Discretization error vs monitoring resolution")
    ax.grid(True, which="both", alpha=0.3); ax.legend(frameon=False, fontsize=9)
    fig.tight_layout(); p2 = os.path.join(outdir, f"barrier_error_vs_step_{tag}.png")
    fig.savefig(p2, dpi=140); plt.close(fig); paths.append(p2)

    # Fig 3: runtime vs accuracy
    fig, ax = plt.subplots(figsize=(7, 4.3))
    ax.scatter(df["endpoint_abs_err"].clip(lower=1e-6), df["runtime_s"], color=ACC, label="Endpoint-only")
    for _, r in df.iterrows():
        ax.annotate(f"{int(r['step_hands'])}", (max(r["endpoint_abs_err"], 1e-6), r["runtime_s"]),
                    fontsize=8, color="#94A3B8", xytext=(4, 2), textcoords="offset points")
    ax.set_xscale("log")
    ax.set_xlabel("Absolute error vs analytical (log scale)")
    ax.set_ylabel("Runtime (s)")
    ax.set_title("Accuracy–runtime trade-off (labels = step size in hands)")
    ax.grid(True, alpha=0.3)
    fig.tight_layout(); p3 = os.path.join(outdir, f"barrier_runtime_vs_accuracy_{tag}.png")
    fig.savefig(p3, dpi=140); plt.close(fig); paths.append(p3)
    return paths


# ---------------------------------------------------------------------------
# Config + CLI
# ---------------------------------------------------------------------------


def load_config(path: str) -> dict[str, Any]:
    with open(path) as f:
        text = f.read()
    if path.endswith((".yaml", ".yml")):
        try:
            import yaml
            return yaml.safe_load(text)
        except ImportError as e:
            raise SystemExit("PyYAML is required for .yaml configs: pip install pyyaml") from e
    return json.loads(text)


DEFAULT = {
    "scenario": {"winrate_bb100": 1.0, "std_bb100": 90.0, "bankroll_bb": 800.0,
                 "ruin_threshold_bb": 0.0, "n_hands": 50000},
    "resolutions": [1, 5, 10, 25, 50, 100, 250, 500],
    "n_paths": 20000, "seed": 42, "chunk_paths": 1000,
}


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Barrier-resolution convergence experiment.")
    ap.add_argument("--config", type=str, default=None)
    ap.add_argument("--n-paths", type=int, default=None)
    ap.add_argument("--outdir", type=str, default=os.path.join(REPO_ROOT, "reports"))
    ap.add_argument("--tag", type=str, default="run")
    args = ap.parse_args(argv)

    cfg = load_config(args.config) if args.config else dict(DEFAULT)
    if args.n_paths:
        cfg["n_paths"] = args.n_paths
    sc = Scenario(**cfg["scenario"])
    df = run_barrier_resolution(sc, cfg["resolutions"], cfg["n_paths"],
                                cfg["seed"], cfg.get("chunk_paths", 1000))

    tables = os.path.join(args.outdir, "tables")
    figures = os.path.join(args.outdir, "figures")
    os.makedirs(tables, exist_ok=True)
    df.to_csv(os.path.join(tables, f"barrier_resolution_{args.tag}.csv"), index=False)
    prov = provenance(experiment="barrier_resolution", scenario=cfg["scenario"],
                      resolutions=cfg["resolutions"], n_paths=cfg["n_paths"],
                      seed=cfg["seed"])
    with open(os.path.join(tables, f"barrier_resolution_{args.tag}.provenance.json"), "w") as f:
        json.dump(prov, f, indent=2)
    figs = make_figures(df, sc, figures, args.tag)

    pd.set_option("display.width", 200, "display.max_columns", 20)
    print(df.to_string(index=False))
    print("\nAnalytical continuous benchmark:", round(float(df['analytic_continuous'].iloc[0]), 4))
    print("Saved table + provenance to", tables)
    print("Saved figures:", *[os.path.basename(p) for p in figs])


if __name__ == "__main__":
    main()
