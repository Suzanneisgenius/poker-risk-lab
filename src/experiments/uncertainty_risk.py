"""Parameter uncertainty -> uncertainty-integrated ruin risk (Priority 1).

Pipeline: estimate the edge and its standard error from block history, form a
Normal-Normal posterior for the true win rate, then propagate that posterior
through the conditional ruin-risk function. The headline comparison is the naive
**plug-in** risk (using the point estimate as if it were the truth) versus the
**uncertainty-integrated** risk.

Run:
    python -m src.experiments.uncertainty_risk --config configs/uncertainty_risk.yaml
"""

from __future__ import annotations

import argparse
import json
import os
from typing import Any

import numpy as np

from src.bayes import (
    Prior, empirical_prior, normal_normal_posterior, posterior_risk,
    skeptical_prior, weakly_informative_prior,
)
from src.experiments._provenance import provenance
from src.inference import estimate_edge, load_blocks_csv, synthetic_blocks

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _prior_from_cfg(pc: dict[str, Any]) -> Prior:
    kind = pc.get("kind", "weakly-informative")
    if kind == "skeptical":
        return skeptical_prior(pc.get("std", 2.0))
    if kind == "weakly-informative":
        return weakly_informative_prior(pc.get("std", 10.0))
    if kind == "empirical":
        return empirical_prior()
    return Prior(pc.get("mean", 0.0), pc.get("std", 5.0), "custom")


def run(cfg: dict[str, Any]) -> dict[str, Any]:
    d = cfg["data"]
    if d.get("csv"):
        hands, profit = load_blocks_csv(d["csv"])
    else:
        hands, profit = synthetic_blocks(
            d["true_winrate"], d["true_std"], d["block_hands"],
            d["n_blocks"], d.get("seed", 0))
    est = estimate_edge(hands, profit, cfg.get("confidence_level", 0.95))

    prior = _prior_from_cfg(cfg.get("prior", {}))
    # Likelihood SE: widened by the stability check when it flags.
    post = normal_normal_posterior(est.winrate_bb100, est.se_winrate_adjusted, prior)

    r = cfg["risk"]
    out = posterior_risk(
        post, std_bb100=est.std_bb100, bankroll_bb=r["bankroll_bb"],
        n_hands=r["n_hands"], ruin_threshold_bb=r.get("ruin_threshold_bb", 0.0),
        plug_in_winrate=est.winrate_bb100, n_draws=cfg.get("n_draws", 20000),
        seed=cfg.get("seed", 0),
    )
    return {"estimate": est, "prior": prior, "posterior": post, "risk": out}


def make_figures(res: dict[str, Any], outdir: str, tag: str) -> list[str]:
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
    ACC, POS, RUIN, WARN = "#38BDF8", "#4ADE80", "#F87171", "#FBBF24"
    os.makedirs(outdir, exist_ok=True)
    est, post, out = res["estimate"], res["posterior"], res["risk"]
    mus, risks = out["_mu_draws"], out["_risk_draws"]
    paths = []

    # Fig 1: posterior of win rate (with prior + P(mu>0)).
    fig, ax = plt.subplots(figsize=(7, 4.3))
    ax.hist(mus, bins=60, color=ACC, alpha=0.85, density=True, label="Posterior of μ")
    ax.axvline(0, color=RUIN, ls="--", label="Break-even (0 bb/100)")
    ax.axvline(est.winrate_bb100, color=WARN, ls="-", label=f"Point estimate {est.winrate_bb100:.2f}")
    ax.axvline(post.mean, color=POS, ls="-", label=f"Posterior mean {post.mean:.2f}")
    ax.set_xlabel("True win rate μ (bb/100)")
    ax.set_ylabel("Posterior density")
    ax.set_title(f"Posterior of the win rate — P(μ>0) = {post.prob_positive:.1%}")
    ax.grid(True, alpha=0.3); ax.legend(frameon=False, fontsize=8)
    fig.tight_layout(); p1 = os.path.join(outdir, f"uncertainty_posterior_mu_{tag}.png")
    fig.savefig(p1, dpi=140); plt.close(fig); paths.append(p1)

    # Fig 2: posterior of ruin risk (plug-in vs expected).
    fig, ax = plt.subplots(figsize=(7, 4.3))
    ax.hist(risks, bins=60, color=ACC, alpha=0.85, density=True, label="Posterior of ruin risk")
    ax.axvline(out["plug_in_risk"], color=WARN, ls="-", lw=2,
               label=f"Plug-in risk {out['plug_in_risk']:.1%}")
    ax.axvline(out["expected_risk"], color=POS, ls="-", lw=2,
               label=f"Integrated expected risk {out['expected_risk']:.1%}")
    ax.set_xlabel("Ruin risk")
    ax.set_ylabel("Posterior density")
    ax.set_title("Plug-in vs uncertainty-integrated ruin risk")
    ax.grid(True, alpha=0.3); ax.legend(frameon=False, fontsize=8)
    fig.tight_layout(); p2 = os.path.join(outdir, f"uncertainty_posterior_risk_{tag}.png")
    fig.savefig(p2, dpi=140); plt.close(fig); paths.append(p2)

    # Fig 3: plug-in vs integrated with credible interval.
    fig, ax = plt.subplots(figsize=(7, 4.0))
    ci = out["credible_intervals"]["ci_90"]
    ax.bar([0], [out["plug_in_risk"]], width=0.5, color=WARN, label="Plug-in")
    ax.bar([1], [out["expected_risk"]], width=0.5, color=POS, label="Integrated (mean)")
    ax.errorbar([1], [out["median_risk"]], yerr=[[out["median_risk"] - ci[0]], [ci[1] - out["median_risk"]]],
                fmt="o", color="#E6EDF3", capsize=5, label="Integrated median + 90% CI")
    ax.set_xticks([0, 1]); ax.set_xticklabels(["Plug-in\n(ignores uncertainty)", "Uncertainty-\nintegrated"])
    ax.set_ylabel("Ruin risk")
    ax.set_title(f"Accounting for uncertainty multiplies risk ×{out['understatement_factor']:.1f}")
    ax.grid(True, axis="y", alpha=0.3); ax.legend(frameon=False, fontsize=8)
    fig.tight_layout(); p3 = os.path.join(outdir, f"uncertainty_plugin_vs_integrated_{tag}.png")
    fig.savefig(p3, dpi=140); plt.close(fig); paths.append(p3)
    return paths


def load_config(path: str) -> dict[str, Any]:
    with open(path) as f:
        text = f.read()
    if path.endswith((".yaml", ".yml")):
        import yaml
        return yaml.safe_load(text)
    return json.loads(text)


DEFAULT = {
    "data": {"true_winrate": 3.0, "true_std": 100.0, "block_hands": 1000,
             "n_blocks": 50, "seed": 1},
    "prior": {"kind": "weakly-informative", "std": 10.0},
    "risk": {"bankroll_bb": 2000.0, "n_hands": 100000, "ruin_threshold_bb": 0.0},
    "n_draws": 20000, "seed": 0, "confidence_level": 0.95,
}


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Uncertainty-integrated ruin risk.")
    ap.add_argument("--config", type=str, default=None)
    ap.add_argument("--outdir", type=str, default=os.path.join(REPO_ROOT, "reports"))
    ap.add_argument("--tag", type=str, default="run")
    args = ap.parse_args(argv)

    cfg = load_config(args.config) if args.config else dict(DEFAULT)
    res = run(cfg)
    est, post, out = res["estimate"], res["posterior"], res["risk"]

    tables = os.path.join(args.outdir, "tables")
    figures = os.path.join(args.outdir, "figures")
    os.makedirs(tables, exist_ok=True)
    summary = {
        "estimate": {k: v for k, v in est.as_dict().items() if k != "warnings"},
        "prior": {"mean": post.prior.mean, "std": post.prior.std, "name": post.prior.name},
        "posterior": {"mean": post.mean, "std": post.std, "prob_positive": post.prob_positive},
        "risk": {k: v for k, v in out.items() if not k.startswith("_")},
    }
    with open(os.path.join(tables, f"uncertainty_risk_{args.tag}.json"), "w") as f:
        json.dump(summary, f, indent=2)
    with open(os.path.join(tables, f"uncertainty_risk_{args.tag}.provenance.json"), "w") as f:
        json.dump(provenance(experiment="uncertainty_risk", config=cfg), f, indent=2)
    figs = make_figures(res, figures, args.tag)

    print("=" * 64)
    print("PARAMETER UNCERTAINTY -> RUIN RISK")
    print("=" * 64)
    print(f"Observed edge      : {est.winrate_bb100:.2f} bb/100 over {est.total_hands:,} hands")
    print(f"Volatility (sigma) : {est.std_bb100:.1f} bb/100")
    print(f"SE of the edge     : {est.se_winrate:.2f} bb/100 "
          f"(used {est.se_winrate_adjusted:.2f})")
    if est.stability_groups:
        print(f"Stability check    : {est.stability_groups} groups of blocks, "
              f"p = {est.stability_p:.3f}, "
              + (f"SE widened ×{est.se_multiplier:.2f}" if est.se_multiplier > 1 else "SE not widened"))
    print(f"{int(est.confidence_level*100)}% CI for edge   : "
          f"[{est.ci_low:.2f}, {est.ci_high:.2f}] bb/100")
    print(f"Prior              : {post.prior.name} (mean {post.prior.mean}, std {post.prior.std})")
    print(f"Posterior          : mean {post.mean:.2f}, std {post.std:.2f}, "
          f"P(edge>0) = {post.prob_positive:.1%}")
    print("-" * 64)
    print(f"Plug-in ruin risk           : {out['plug_in_risk']:.1%}")
    print(f"Uncertainty-integrated risk : {out['expected_risk']:.1%} "
          f"(median {out['median_risk']:.1%})")
    print(f"Understatement factor       : x{out['understatement_factor']:.2f}")
    for k, v in out["threshold_exceedance"].items():
        print(f"  P(risk > {k.split('_')[-1]:>4}) : {v:.1%}")
    print("Saved figures:", *[os.path.basename(p) for p in figs])


if __name__ == "__main__":
    main()
