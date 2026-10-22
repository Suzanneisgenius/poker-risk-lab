"""The three questions behind the case study page (case-study/index.html).

One scenario throughout: the Risk Lab default (30 buy-ins, +3 bb/100,
90 bb/100 standard deviation, 100,000 hands). Each case reads
configs/case_study/<case>.yaml and writes reports/case-study/<case>.json
(results plus provenance: commit, engine settings, seeds, path counts and
environment) and a figure, reports/case-study/<case>.png. ``overview`` puts
the three on one risk axis and needs the other three outputs.

Run:
    python -m src.experiments.case_study --case all
    python -m src.experiments.case_study --case noise        # or uncertainty, assumptions, overview
"""

from __future__ import annotations

import argparse
import json
import math
import os
from typing import Any

import numpy as np

from src.bayes import Prior, normal_normal_posterior, posterior_risk, skeptical_prior, weakly_informative_prior
from src.experiments._provenance import provenance
from src.models import MODELS, run_model
from src.simulation import _step_sizes, simulate_bankroll
from src.validation import brownian_ruin_finite

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONFIGS = os.path.join(REPO_ROOT, "configs", "case_study")
OUTDIR = os.path.join(REPO_ROOT, "reports", "case-study")
Z95 = 1.959963984540054
CASES = ("noise", "uncertainty", "assumptions")

LABELS = {
    "gaussian": "Independent, Normal (baseline)",
    "student_t": "Heavy tails (Student-t, df 3)",
    "shock_mixture": "Rare large losses (3% shocks)",
    "ar1": "Swings carry over (AR(1), φ 0.3)",
    "regime_switching": "Bad stretches cluster (regimes)",
}


def load_config(name: str) -> dict[str, Any]:
    import yaml
    with open(os.path.join(CONFIGS, f"{name}.yaml")) as f:
        return yaml.safe_load(f)


def wilson(successes: int, total: int, z: float = Z95) -> tuple[float, float]:
    p = successes / total
    denom = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denom
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denom
    return centre - half, centre + half


def exact_risk(sc: dict[str, Any], winrate: float | None = None) -> float:
    return brownian_ruin_finite(
        sc["winrate_bb100"] if winrate is None else winrate, sc["std_bb100"],
        sc["bankroll_bb"], sc["n_hands"], sc.get("ruin_threshold_bb", 0.0))["probability"]


# ---------------------------------------------------------------------------
# Case 1: Monte Carlo noise
# ---------------------------------------------------------------------------

def case_noise(cfg: dict[str, Any]) -> dict[str, Any]:
    sc = cfg["scenario"]
    seeds = list(range(cfg["seeds"]["first"], cfg["seeds"]["first"] + cfg["seeds"]["count"]))
    exact = exact_risk(sc)
    rows = []
    for n in cfg["budgets"]:
        ruined = []
        for seed in seeds:
            sim = simulate_bankroll(
                n_paths=n, n_hands=sc["n_hands"], winrate_bb100=sc["winrate_bb100"],
                std_bb100=sc["std_bb100"], bankroll_bb=sc["bankroll_bb"],
                ruin_threshold_bb=sc.get("ruin_threshold_bb", 0.0), seed=seed,
                step_hands=sc["step_hands"], store_n_paths=0, bridge=cfg["bridge"])
            ruined.append(int(np.sum(sim["ruined"])))
        est = np.array(ruined) / n
        theory_sd = math.sqrt(exact * (1 - exact) / n)
        rows.append({
            "paths": n,
            "ruined": ruined,
            "estimates": est.tolist(),
            "mean": float(est.mean()),
            "sd": float(est.std(ddof=1)),
            "min": float(est.min()),
            "max": float(est.max()),
            "theory_sd": theory_sd,
            "theory_95": [exact - Z95 * theory_sd, exact + Z95 * theory_sd],
            "wilson_intervals_covering_exact": sum(lo <= exact <= hi for lo, hi in (wilson(k, n) for k in ruined)),
        })
    return {
        "question": "Why does the same setting give a different number on every run?",
        "exact_risk": exact,
        "exact_method": "Finite-horizon Brownian first-passage formula (src/validation.py); "
                        "exact for this model because ruin is monitored continuously.",
        "rows": rows,
        "provenance": provenance(
            experiment="case_study.noise", config=cfg, seeds=seeds,
            engine={"module": "src/simulation.py", "bridge": cfg["bridge"],
                    "random_numbers": "numpy default_rng(seed) per run (PCG64)"}),
    }


# ---------------------------------------------------------------------------
# Case 2: parameter uncertainty versus Monte Carlo error
# ---------------------------------------------------------------------------

def _prior(pc: dict[str, Any]) -> Prior:
    if pc.get("kind") == "skeptical":
        return skeptical_prior(pc.get("std", 2.0))
    if pc.get("kind", "weakly-informative") == "weakly-informative":
        return weakly_informative_prior(pc.get("std", 10.0))
    return Prior(pc.get("mean", 0.0), pc.get("std", 5.0), "custom")


def case_uncertainty(cfg: dict[str, Any]) -> dict[str, Any]:
    sc, level = cfg["scenario"], cfg.get("level", 0.95)
    observed = cfg["observed_winrate_bb100"]
    plug_in = exact_risk(sc, observed)
    prior = _prior(cfg.get("prior", {}))
    key = f"ci_{int(level * 100)}"
    history = []
    for hands in cfg["history_hands"]:
        # Standard error of a win rate measured over `hands` independent hands.
        se = sc["std_bb100"] / math.sqrt(hands / 100)
        post = normal_normal_posterior(observed, se, prior)
        out = posterior_risk(
            post, std_bb100=sc["std_bb100"], bankroll_bb=sc["bankroll_bb"], n_hands=sc["n_hands"],
            ruin_threshold_bb=sc.get("ruin_threshold_bb", 0.0), plug_in_winrate=observed,
            n_draws=cfg["n_draws"], seed=cfg["seed"], credible_levels=(level,))
        history.append({
            "hands": hands,
            "winrate_standard_error": se,
            "winrate_interval": list(post.credible_interval(level)),
            "risk_interval": list(out["credible_intervals"][key]),
            "expected_risk": out["expected_risk"],
            "median_risk": out["median_risk"],
            "p_risk_above_10pct": out["threshold_exceedance"]["p_risk_gt_10pct"],
        })
    monte_carlo = []
    for n in cfg["mc_paths"]:
        half = Z95 * math.sqrt(plug_in * (1 - plug_in) / n)
        monte_carlo.append({"paths": n, "interval": [plug_in - half, plug_in + half], "halfwidth": half})
    return {
        "question": "If the win rate itself is uncertain, how much do more simulation paths help?",
        "plug_in_risk": plug_in,
        "level": level,
        "history": history,
        "monte_carlo": monte_carlo,
        "provenance": provenance(
            experiment="case_study.uncertainty", config=cfg,
            engine={"risk": "finite-horizon Brownian formula per posterior draw (no simulation noise)",
                    "posterior": "Normal-Normal conjugate update, standard deviation held fixed",
                    "monte_carlo_interval": "binomial 95% interval at the plug-in risk"}),
    }


# ---------------------------------------------------------------------------
# Case 3: model assumptions
# ---------------------------------------------------------------------------

def case_assumptions(cfg: dict[str, Any]) -> dict[str, Any]:
    sc = cfg["scenario"]
    n = cfg["n_paths"]
    sizes = np.asarray(_step_sizes(sc["n_hands"], sc["step_hands"]), dtype=np.float64)
    rows = []
    for index, key in enumerate(cfg["models"]):
        params = cfg.get("params", {}).get(key, {})
        r = run_model(key, winrate_bb100=sc["winrate_bb100"], std_bb100=sc["std_bb100"],
                      bankroll_bb=sc["bankroll_bb"], n_hands=sc["n_hands"],
                      ruin_threshold_bb=sc.get("ruin_threshold_bb", 0.0), n_paths=n,
                      seed=cfg["seed"], step_hands=sc["step_hands"], params=params)
        ruined = int(round(r["risk_of_ruin"] * n))
        # How much the 100k-hand total varies without absorption, relative to
        # independent Normal steps with the same per-step standard deviation.
        rng = np.random.default_rng([cfg["seed"], index, 1])
        incr, _ = MODELS[key](rng, cfg["spread_paths"], sizes, sc["winrate_bb100"], sc["std_bb100"], **params)
        totals = incr.sum(axis=1)
        step_sd = float(incr[:, 1:].std())
        rows.append({
            "model": key,
            "label": LABELS[key],
            "risk": r["risk_of_ruin"],
            "ruined": ruined,
            "wilson95": list(wilson(ruined, n)),
            "p95_max_drawdown_bi": r["p95_max_drawdown"] / 100,
            "per_step_sd_bb": step_sd,
            "total_sd_ratio": float(totals.std() / (sc["std_bb100"] * math.sqrt(sc["n_hands"] / 100))),
            "realized_winrate_bb100": float(totals.mean() / sc["n_hands"] * 100),
            "info": r["info"],
        })
    base = rows[0]["risk"]
    for row in rows:
        row["risk_vs_baseline"] = row["risk"] / base if base > 0 else float("nan")
    return {
        "question": "If results are not independent or not Normal, is the estimate still reliable?",
        "monitoring": "Ruin checked at 100-hand step ends for every model.",
        "n_paths": n,
        "rows": rows,
        "provenance": provenance(
            experiment="case_study.assumptions", config=cfg,
            engine={"module": "src/models.py run_model", "bridge": False,
                    "random_numbers": f"numpy default_rng({cfg['seed']}) per model (PCG64)"}),
    }


# ---------------------------------------------------------------------------
# Figures
# ---------------------------------------------------------------------------

def _style():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({
        "figure.facecolor": "#0B1220", "axes.facecolor": "#0B1220", "savefig.facecolor": "#0B1220",
        "text.color": "#E6EDF3", "axes.labelcolor": "#E6EDF3", "xtick.color": "#94A3B8",
        "ytick.color": "#94A3B8", "axes.edgecolor": "#243247", "grid.color": "#243247",
        "font.size": 10, "svg.hashsalt": "case-study", "path.simplify": False,
    })
    return plt


ACC, POS, RUIN, WARN, MUTED = "#38BDF8", "#4ADE80", "#F87171", "#FBBF24", "#94A3B8"
pct = lambda v: f"{v * 100:.1f}%"


def figure_noise(res: dict[str, Any], path: str) -> None:
    plt = _style()
    fig, ax = plt.subplots(figsize=(8, 3.6))
    exact = res["exact_risk"]
    for y, row in enumerate(res["rows"]):
        lo, hi = row["theory_95"]
        ax.plot([lo * 100, hi * 100], [y, y], color=ACC, lw=8, alpha=0.22, solid_capstyle="butt")
        jitter = (np.arange(len(row["estimates"])) % 5 - 2) * 0.06
        ax.scatter(np.array(row["estimates"]) * 100, y + jitter, s=14, color=ACC, zorder=3)
    ax.axvline(exact * 100, color=WARN, lw=1.4, ls="--")
    ax.text(exact * 100, len(res["rows"]) - 0.45, f"exact {pct(exact)}", color=WARN, ha="center", fontsize=9)
    ax.set_yticks(range(len(res["rows"])), [f"{r['paths']:,} paths" for r in res["rows"]])
    ax.set_xlabel("Estimated risk of ruin (%) — one dot per seed, 40 seeds; band = expected 95% range")
    ax.set_ylim(-0.6, len(res["rows"]) - 0.2)
    ax.grid(axis="x", alpha=0.5)
    ax.set_title("Same assumptions, different seeds: how far one run can land from the exact value")
    fig.tight_layout()
    fig.savefig(path, dpi=150, bbox_inches="tight")
    plt.close(fig)


def figure_uncertainty(res: dict[str, Any], path: str) -> None:
    plt = _style()
    fig, ax = plt.subplots(figsize=(8, 3.8))
    rows = [(f"Simulation, {m['paths']:,} paths", m["interval"], ACC) for m in res["monte_carlo"]]
    rows += [(f"Win rate from {h['hands']:,} hands", h["risk_interval"], WARN) for h in res["history"]]
    for y, (label, (lo, hi), color) in enumerate(rows):
        ax.plot([lo * 100, hi * 100], [y, y], color=color, lw=7, solid_capstyle="butt")
        ax.text(hi * 100 + 0.6, y, f"{pct(lo)}–{pct(hi)}", va="center", fontsize=8.5, color=MUTED)
    ax.axvline(res["plug_in_risk"] * 100, color=MUTED, lw=1, ls="--")
    ax.set_yticks(range(len(rows)), [r[0] for r in rows])
    ax.invert_yaxis()
    ax.set_xlim(0, 100)
    ax.set_xlabel(f"Risk of ruin (%) — {int(res['level'] * 100)}% interval")
    ax.grid(axis="x", alpha=0.5)
    ax.set_title("More paths shrink simulation error; only more history narrows the win rate")
    fig.tight_layout()
    fig.savefig(path, dpi=150, bbox_inches="tight")
    plt.close(fig)


def figure_assumptions(res: dict[str, Any], path: str) -> None:
    plt = _style()
    fig, ax = plt.subplots(figsize=(8, 3.6))
    rows = res["rows"]
    for y, row in enumerate(rows):
        lo, hi = row["wilson95"]
        color = ACC if y == 0 else RUIN
        ax.plot([lo * 100, hi * 100], [y, y], color=color, lw=2)
        ax.scatter([row["risk"] * 100], [y], color=color, s=36, zorder=3)
        ax.text(hi * 100 + 0.4, y, f"{pct(row['risk'])}  (×{row['risk_vs_baseline']:.2f})", va="center", fontsize=8.5, color=MUTED)
    ax.set_yticks(range(len(rows)), [r["label"] for r in rows])
    ax.invert_yaxis()
    ax.set_xlim(0, max(r["wilson95"][1] for r in rows) * 100 * 1.35)
    ax.set_xlabel(f"Risk of ruin (%) with 95% interval — {res['n_paths']:,} paths per model, same edge")
    ax.grid(axis="x", alpha=0.5)
    ax.set_title("Same edge: dependence between results moves risk most")
    fig.tight_layout()
    fig.savefig(path, dpi=150, bbox_inches="tight")
    plt.close(fig)


def overview(noise: dict, uncertainty: dict, assumptions: dict) -> dict[str, Any]:
    by_paths = {r["paths"]: r for r in noise["rows"]}
    by_hands = {h["hands"]: h for h in uncertainty["history"]}
    risks = [r["risk"] for r in assumptions["rows"]]
    return {
        "question": "Where does the uncertainty in one risk number come from?",
        "rows": [
            {"source": "Simulation noise, 2,000 paths (Risk Lab default)", "kind": "noise", "interval": by_paths[2000]["theory_95"]},
            {"source": "Simulation noise, 20,000 paths", "kind": "noise", "interval": by_paths[20000]["theory_95"]},
            {"source": "Win rate known from 50,000 hands", "kind": "parameter", "interval": by_hands[50000]["risk_interval"]},
            {"source": "Win rate known from 1,000,000 hands", "kind": "parameter", "interval": by_hands[1000000]["risk_interval"]},
            {"source": "Five models of how results arrive", "kind": "model", "interval": [min(risks), max(risks)]},
        ],
        "reference_risk": noise["exact_risk"],
        "provenance": provenance(experiment="case_study.overview",
                                 inputs=["noise.json", "uncertainty.json", "assumptions.json"]),
    }


def figure_overview(res: dict[str, Any], path: str) -> None:
    plt = _style()
    fig, ax = plt.subplots(figsize=(8, 3.4))
    colors = {"noise": ACC, "parameter": WARN, "model": RUIN}
    for y, row in enumerate(res["rows"]):
        lo, hi = row["interval"]
        ax.plot([lo * 100, hi * 100], [y, y], color=colors[row["kind"]], lw=7, solid_capstyle="butt")
        ax.text(hi * 100 + 0.8, y, f"{pct(lo)}–{pct(hi)}", va="center", fontsize=8.5, color=MUTED)
    ax.axvline(res["reference_risk"] * 100, color=MUTED, lw=1, ls="--")
    ax.set_yticks(range(len(res["rows"])), [r["source"] for r in res["rows"]])
    ax.invert_yaxis()
    ax.set_xlim(0, 100)
    ax.set_xlabel("Risk of ruin (%) — 30 buy-ins, +3 bb/100, 90 bb/100, 100,000 hands")
    ax.grid(axis="x", alpha=0.5)
    ax.set_title("One risk estimate, three sources of uncertainty")
    fig.tight_layout()
    fig.savefig(path, dpi=150, bbox_inches="tight")
    plt.close(fig)


FIGURES = {"noise": figure_noise, "uncertainty": figure_uncertainty, "assumptions": figure_assumptions}
RUNNERS = {"noise": case_noise, "uncertainty": case_uncertainty, "assumptions": case_assumptions}


def _write(name: str, res: dict[str, Any], outdir: str) -> None:
    with open(os.path.join(outdir, f"{name}.json"), "w") as f:
        json.dump(res, f, indent=2)
        f.write("\n")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Case study experiments.")
    ap.add_argument("--case", choices=[*CASES, "overview", "all"], default="all")
    ap.add_argument("--outdir", default=OUTDIR)
    args = ap.parse_args(argv)
    os.makedirs(args.outdir, exist_ok=True)

    for name in CASES if args.case == "all" else [args.case] if args.case in CASES else []:
        res = RUNNERS[name](load_config(name))
        _write(name, res, args.outdir)
        FIGURES[name](res, os.path.join(args.outdir, f"{name}.png"))
        print(f"{name}: wrote {name}.json and {name}.png")
    if args.case in ("overview", "all"):
        loaded = []
        for name in CASES:
            with open(os.path.join(args.outdir, f"{name}.json")) as f:
                loaded.append(json.load(f))
        res = overview(*loaded)
        _write("overview", res, args.outdir)
        figure_overview(res, os.path.join(args.outdir, "overview.png"))
        print("overview: wrote overview.json and overview.png")


if __name__ == "__main__":
    main()
