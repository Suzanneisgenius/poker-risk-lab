"""Figures for questions 1 and 2, drawn from results.json and ruin_calibrated.json.

Usage, from the repository root:
    python -I -B research/real-hands/make_figures_q1q2.py [analysis dir]
The analysis dir defaults to reports/real-hands/q1q2.
"""
import json
import sys
import textwrap
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy import stats

SURFACE, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3de"
BLUE, ORANGE, AQUA, GRAY = "#2a78d6", "#eb6834", "#1baf7a", "#8a8984"
plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "text.color": INK, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2,
    "axes.edgecolor": "#b9b8b2", "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
    "axes.spines.top": False, "axes.spines.right": False, "font.size": 9.5,
    "axes.titlesize": 10.5, "axes.titleweight": "bold", "axes.titlelocation": "left",
    "lines.linewidth": 1.6, "legend.frameon": False,
})


def unit_t_sf(x, df):
    return stats.t.sf(x * np.sqrt(df / (df - 2)), df)


def save(fig, out, name, note):
    fig.tight_layout()
    width = int(fig.get_figwidth() * 15)
    fig.text(0.01, -0.01, textwrap.fill(note, width), color=INK2, fontsize=7.5, ha="left", va="top")
    fig.savefig(out / name, dpi=200, bbox_inches="tight")
    plt.close(fig)


def fig_tails(r, out):
    tc = r["sites"]["both"]["tail_curve"]
    x = np.array(tc["x"]); grid = np.linspace(1, 5, 200)
    n = r["sites"]["both"]["blocks"]
    fig, axes = plt.subplots(1, 2, figsize=(9.2, 3.8), sharey=True)
    for ax, key, title in ((axes[0], "below_minus_x", "Losing tail: share of blocks below -x SD"),
                           (axes[1], "above_x", "Winning tail: share of blocks above +x SD")):
        y = np.array(tc[key]); ok = y > 0
        ax.fill_between(grid, unit_t_sf(grid, 10), unit_t_sf(grid, 7), color=AQUA, alpha=0.25, lw=0,
                        label="Student-t, df 7 to 10")
        ax.plot(grid, stats.norm.sf(grid), color=GRAY, label="Normal")
        ax.plot(grid, unit_t_sf(grid, 3), color=ORANGE, label="Student-t, df 3 (case study)")
        ax.plot(x[ok], y[ok], "o", ms=4.2, color=BLUE, mec=SURFACE, mew=0.6, label="Real 100-hand blocks")
        ax.set_yscale("log"); ax.set_ylim(1e-5, 0.4); ax.set_xlim(1, 5.05)
        ax.set_xlabel("x, in standard deviations of that player's blocks")
        ax.set_title(title)
    axes[0].set_ylabel("Share of blocks")
    axes[0].text(4.2, unit_t_sf(4.2, 3) * 1.6, "df 3", color=INK2, fontsize=8.5)
    axes[0].text(3.55, stats.norm.sf(3.55) / 3.2, "Normal", color=INK2, fontsize=8.5)
    axes[1].legend(loc="upper right", fontsize=8.5)
    save(fig, out, "fig1_tails.png",
         f"PartyPoker and Ongame \\$2/\\$4, July 2009: {n:,} blocks of 100 hands from "
         f"{r['sites']['both']['players']} players with at least 5,000 hands. Each player's blocks are "
         "standardized by that player's own mean and SD; curves are unit-variance distributions.")


def fig_kurtosis(r, out):
    fig, ax = plt.subplots(figsize=(6.4, 4.0))
    for site, color, label in (("ONG", BLUE, "Ongame"), ("PTY", ORANGE, "PartyPoker")):
        rows = r["sites"][site]["kurtosis_by_block"]
        n = np.array([k["block_hands"] for k in rows], float)
        k = np.array([k["excess_kurtosis"] for k in rows])
        lo = np.array([k_["ci"][0] for k_ in rows]); hi = np.array([k_["ci"][1] for k_ in rows])
        k1 = k[0]
        line = np.geomspace(1, 600, 50)
        ax.plot(line, k1 / line, color=color, lw=1.0, ls="--", alpha=0.9)
        ax.errorbar(n, k, yerr=[k - np.maximum(lo, 0.02), hi - k], fmt="o", ms=5, color=color,
                    mec=SURFACE, mew=0.6, elinewidth=1.0, capsize=0, label=label)
    ax.axvline(100, color=GRAY, lw=0.8)
    ax.text(108, 40, "case-study\nstep: 100 hands", color=INK2, fontsize=8)
    ax.text(1.3, 0.5, "dashed: kurtosis of one hand / n,\nwhat independent hands would give", color=INK2, fontsize=8)
    ax.set_xscale("log"); ax.set_yscale("log"); ax.set_ylim(0.02, 200)
    ax.set_xticks([1, 10, 25, 50, 100, 200, 500]); ax.set_xticklabels(["1", "10", "25", "50", "100", "200", "500"])
    ax.set_xlabel("Hands per block (n)"); ax.set_ylabel("Excess kurtosis of block results")
    ax.set_title("Heavy tails fade at the rate independent hands predict")
    ax.legend(loc="lower left", fontsize=8.5)
    save(fig, out, "fig2_kurtosis_by_block.png",
         "Points: pooled within-player excess kurtosis (Normal = 0), corrected for the standardization "
         "bias; bars: 95% player bootstrap.")


def fig_dependence(r, out):
    d = r["sites"]["both"]; mc = r["model_curves"]
    ar, rg = mc["AR(1), phi 0.3"], mc["Regimes"]
    fig, axes = plt.subplots(1, 3, figsize=(13.0, 3.9))

    ax = axes[0]
    lags = np.arange(1, 21)
    rho = np.array(d["acf"]["all"][:20]); ci = np.array(d["acf"]["all_ci"][:20])
    ax.axhline(0, color=GRAY, lw=0.8)
    ax.plot(lags, ar["acf"], color=ORANGE, marker="o", ms=3.5, label="AR(1), phi 0.3 (case study)")
    ax.fill_between(lags, ci[:, 0], ci[:, 1], color=BLUE, alpha=0.18, lw=0)
    ax.plot(lags, rho, color=BLUE, marker="o", ms=3.5, label="Real data, 95% band")
    ax.set_xlabel("Lag (blocks of 100 hands)"); ax.set_ylabel("Correlation")
    ax.set_title("Results of nearby blocks"); ax.set_ylim(-0.05, 0.32)
    ax.text(2.4, 0.27, "AR(1), phi 0.3", color=INK2, fontsize=8.5)
    ax.text(12, 0.03, "real data", color=INK2, fontsize=8.5)

    ax = axes[1]
    lags = np.arange(1, 11)
    rho = np.array(d["acf"]["abs"][:10]); ci = np.array(d["acf"]["abs_ci"][:10])
    ax.axhline(0, color=GRAY, lw=0.8)
    ax.plot(lags, rg["acf_abs"][:10], color=AQUA, marker="o", ms=3.5, label="Regimes (case study)")
    ax.fill_between(lags, ci[:, 0], ci[:, 1], color=BLUE, alpha=0.18, lw=0)
    ax.plot(lags, rho, color=BLUE, marker="o", ms=3.5)
    ax.set_xlabel("Lag (blocks of 100 hands)"); ax.set_ylabel("Correlation of |z|")
    ax.set_title("Size of swings in nearby blocks"); ax.set_ylim(-0.02, 0.06)
    ax.text(5.5, 0.033, "regimes", color=INK2, fontsize=8.5)
    ax.text(5.5, -0.012, "real data", color=INK2, fontsize=8.5)

    ax = axes[2]
    hands = np.array(d["variance_ratio"]["hands"])
    vr = np.array(d["variance_ratio"]["vr"]); ci = np.array(d["variance_ratio"]["ci"])
    ax.axhline(1, color=GRAY, lw=0.8)
    ax.plot(hands, ar["vr"], color=ORANGE)
    ax.plot(hands, rg["vr"], color=AQUA)
    ax.fill_between(hands, ci[:, 0], ci[:, 1], color=BLUE, alpha=0.18, lw=0)
    ax.plot(hands, vr, color=BLUE)
    ax.set_xlabel("Hands summed"); ax.set_ylabel("Variance ratio")
    ax.set_title("Long-run variance / short-run variance"); ax.set_ylim(0.8, 1.9)
    ax.text(2600, 1.74, "AR(1), phi 0.3", color=INK2, fontsize=8.5)
    ax.text(2600, 1.06, "regimes", color=INK2, fontsize=8.5)
    ax.text(2600, 0.88, "real data", color=INK2, fontsize=8.5)

    handles = [plt.Line2D([], [], color=c, marker="o", ms=4) for c in (BLUE, ORANGE, AQUA)]
    fig.legend(handles, ["Real data (shaded: 95% player bootstrap)", "AR(1), phi 0.3 (case study)",
                         "Regime switching (case study)"],
               loc="upper center", ncol=3, fontsize=8.5, bbox_to_anchor=(0.5, 1.04))
    save(fig, out, "fig3_dependence.png",
         "Both sites pooled. Model curves are the case study's own models simulated with the same players' "
         "block counts and put through the same estimators.")


def fig_ruin(ruin, out):
    runs = ruin["runs"][::-1]
    labels = [x["label"] for x in runs]
    p = np.array([x["risk_of_ruin"] for x in runs]) * 100
    se = np.array([x["mc_se"] for x in runs]) * 100
    colors = [GRAY if "baseline" in l else BLUE if "data" in l else ORANGE for l in labels]
    fig, ax = plt.subplots(figsize=(7.4, 3.6))
    ax.barh(labels, p, color=colors, height=0.62, xerr=1.96 * se, error_kw={"elinewidth": 0.9, "ecolor": INK2})
    for i, (v, e) in enumerate(zip(p, se)):
        ax.text(v + 1.96 * e + 0.3, i, f"{v:.2f}%", va="center", color=INK, fontsize=8.5)
    ax.grid(axis="y", visible=False); ax.set_axisbelow(True)
    ax.set_xlim(0, 23); ax.set_xlabel("Risk of ruin over 100,000 hands (%)")
    ax.set_title("Chapter 3 scenario: case-study stress settings vs settings fitted to data")
    save(fig, out, "fig4_ruin.png",
         "Win rate 3 bb/100, SD 90 bb/100, bankroll 3,000 bb, 40,000 paths, seed 20240601. "
         "Orange: case-study stress settings; blue: settings from the real data; bars: 95% Monte Carlo error.")


def main(out=Path(__file__).resolve().parents[2] / "reports" / "real-hands" / "q1q2"):
    out = Path(out)
    r = json.loads((out / "results.json").read_text())
    ruin = json.loads((out / "ruin_calibrated.json").read_text())
    fig_tails(r, out); fig_kurtosis(r, out); fig_dependence(r, out); fig_ruin(ruin, out)


if __name__ == "__main__":
    main(*sys.argv[1:2])
