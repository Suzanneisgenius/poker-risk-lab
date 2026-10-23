"""Model-misspecification stress test (Priority 3).

Runs the same scenario under five increment models — Gaussian baseline,
Student-t heavy tails, a shock mixture, AR(1) dependence, and regime switching —
all calibrated to the same edge (and, where possible, the same variance). It then
compares ruin risk, drawdown, ending-bankroll tails, and time to ruin, to answer:
how much does ruin risk change when the Gaussian i.i.d. assumption is relaxed,
and in which direction?

Run:
    python -m src.experiments.model_risk --config configs/model_risk.yaml
"""

from __future__ import annotations

import argparse
import json
import os
from typing import Any

import pandas as pd

from src.experiments._provenance import provenance
from src.models import MODELS, run_model

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

LABELS = {
    "gaussian": "Gaussian (baseline)",
    "student_t": "Student-t tails",
    "shock_mixture": "Shock mixture",
    "ar1": "AR(1) dependence",
    "regime_switching": "Regime switching",
}


def run_stress_test(cfg: dict[str, Any]) -> pd.DataFrame:
    sc = cfg["scenario"]
    rows = []
    for key in cfg["models"]:
        params = cfg.get("params", {}).get(key, {})
        r = run_model(
            key, winrate_bb100=sc["winrate_bb100"], std_bb100=sc["std_bb100"],
            bankroll_bb=sc["bankroll_bb"], n_hands=sc["n_hands"],
            ruin_threshold_bb=sc.get("ruin_threshold_bb", 0.0),
            n_paths=cfg.get("n_paths", 20000), seed=cfg.get("seed", 0),
            step_hands=sc.get("step_hands", 100), params=params,
        )
        rows.append(r)
    df = pd.DataFrame(rows)
    base = df[df["model"] == "gaussian"].iloc[0]["risk_of_ruin"]
    df["ruin_vs_gaussian_x"] = df["risk_of_ruin"] / base if base > 0 else float("nan")
    return df


def make_figures(df: pd.DataFrame, outdir: str, tag: str) -> list[str]:
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
    ACC, RUIN = "#38BDF8", "#F87171"
    os.makedirs(outdir, exist_ok=True)
    labels = [LABELS.get(m, m) for m in df["model"]]
    colors = [ACC if m == "gaussian" else RUIN for m in df["model"]]
    paths = []

    # Fig 1: ruin risk by model.
    fig, ax = plt.subplots(figsize=(7.4, 4.3))
    ax.bar(labels, df["risk_of_ruin"], color=colors)
    for i, v in enumerate(df["risk_of_ruin"]):
        ax.text(i, v, f"{v:.1%}", ha="center", va="bottom", fontsize=9, color="#E6EDF3")
    ax.set_ylabel("Risk of ruin")
    ax.set_title("Ruin risk under model misspecification (same edge)")
    ax.grid(True, axis="y", alpha=0.3)
    plt.xticks(rotation=18, ha="right")
    fig.tight_layout(); p1 = os.path.join(outdir, f"model_risk_ruin_{tag}.png")
    fig.savefig(p1, dpi=140); plt.close(fig); paths.append(p1)

    # Fig 2: P95 drawdown by model.
    fig, ax = plt.subplots(figsize=(7.4, 4.3))
    ax.bar(labels, df["p95_max_drawdown"], color=colors)
    ax.set_ylabel("P95 max drawdown (bb)")
    ax.set_title("Tail drawdown under model misspecification")
    ax.grid(True, axis="y", alpha=0.3)
    plt.xticks(rotation=18, ha="right")
    fig.tight_layout(); p2 = os.path.join(outdir, f"model_risk_drawdown_{tag}.png")
    fig.savefig(p2, dpi=140); plt.close(fig); paths.append(p2)
    return paths


def load_config(path: str) -> dict[str, Any]:
    with open(path) as f:
        text = f.read()
    if path.endswith((".yaml", ".yml")):
        import yaml
        return yaml.safe_load(text)
    return json.loads(text)


DEFAULT = {
    "scenario": {"winrate_bb100": 2.0, "std_bb100": 90.0, "bankroll_bb": 1500.0,
                 "ruin_threshold_bb": 0.0, "n_hands": 100000, "step_hands": 100},
    "models": ["gaussian", "student_t", "shock_mixture", "ar1", "regime_switching"],
    "params": {
        "student_t": {"df": 3.0},
        "shock_mixture": {"p": 0.03, "shock_mean": -4.0, "shock_scale": 2.5},
        "ar1": {"phi": 0.3},
        "regime_switching": {"p_stay_normal": 0.98, "p_stay_adverse": 0.90,
                             "mu_adverse": -5.0, "vol_mult": 1.6},
    },
    "n_paths": 20000, "seed": 20240601,
}


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Model-misspecification stress test.")
    ap.add_argument("--config", type=str, default=None)
    ap.add_argument("--n-paths", type=int, default=None)
    ap.add_argument("--outdir", type=str, default=os.path.join(REPO_ROOT, "reports"))
    ap.add_argument("--tag", type=str, default="run")
    args = ap.parse_args(argv)

    cfg = load_config(args.config) if args.config else dict(DEFAULT)
    if args.n_paths:
        cfg["n_paths"] = args.n_paths
    df = run_stress_test(cfg)

    tables = os.path.join(args.outdir, "tables")
    os.makedirs(tables, exist_ok=True)
    show = df.drop(columns=["info"])
    show.to_csv(os.path.join(tables, f"model_risk_{args.tag}.csv"), index=False)
    with open(os.path.join(tables, f"model_risk_{args.tag}.provenance.json"), "w") as f:
        json.dump(provenance(experiment="model_risk", config=cfg,
                             info={r["model"]: r["info"] for _, r in df.iterrows()}),
                  f, indent=2)
    figs = make_figures(df, os.path.join(args.outdir, "figures"), args.tag)

    pd.set_option("display.width", 220, "display.max_columns", 20)
    print(show.to_string(index=False))
    base = df[df["model"] == "gaussian"].iloc[0]["risk_of_ruin"]
    print(f"\nGaussian baseline ruin risk: {base:.1%}")
    worst = df.loc[df["risk_of_ruin"].idxmax()]
    print(f"Highest-risk model: {LABELS.get(worst['model'])} "
          f"at {worst['risk_of_ruin']:.1%} (x{worst['ruin_vs_gaussian_x']:.2f} vs Gaussian)")
    print("Saved figures:", *[os.path.basename(p) for p in figs])


if __name__ == "__main__":
    main()
