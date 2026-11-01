"""Figures for question 3, drawn from the analysis-q3 results.json.

Usage, from the repository root:
    python -I -B research/real-hands/make_figures_q3.py [analysis dir]
The analysis dir defaults to reports/real-hands/q3.
"""
import json
import sys
import textwrap
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

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
Z = 1.959964


def save(fig, out, name, note):
    fig.tight_layout()
    width = int(fig.get_figwidth() * 15)
    fig.text(0.01, -0.01, textwrap.fill(note, width), color=INK2, fontsize=7.5, ha="left", va="top")
    fig.savefig(out / name, dpi=200, bbox_inches="tight")
    plt.close(fig)


def fig_population(r, out):
    pop, halves = r["population"], r["prediction"]["half_fits"]["brackets"]
    rake = [v["rake_bb100_per_seat"] for v in r["rake_check"].values()]
    mix = pop["mixture"]
    rows = [("Case study prior, N(0, 10²)", 0.0, None, (-Z * 10, Z * 10), ORANGE)]
    rows.append(("All players with 1,000+ hands", mix["mean"], mix["mean_ci"],
                 (mix["quantiles"]["0.025"], mix["quantiles"]["0.975"]), AQUA))
    for k, b in pop["brackets"].items():
        label = f"{k} hands" + (" (regulars)" if k.startswith("10,000") else "")
        rows.append((label, b["m"], b["m_ci"], (b["m"] - Z * b["tau"], b["m"] + Z * b["tau"]), BLUE))

    fig, (ax, bx) = plt.subplots(1, 2, figsize=(11.0, 4.0), gridspec_kw={"width_ratios": [1.5, 1]})
    ax.axvspan(-max(rake), -min(rake), color=GRAY, alpha=0.18, lw=0)
    ax.text(-max(rake) - 0.4, -0.7, "rake per seat", color=INK2, fontsize=8, ha="right", va="center")
    for i, (label, m, mci, (lo, hi), c) in enumerate(rows):
        y = len(rows) - 1 - i
        ax.plot([lo, hi], [y, y], color=c, lw=7, alpha=0.28, solid_capstyle="butt")
        if mci:
            ax.plot(mci, [y, y], color=c, lw=2.2)
        ax.plot(m, y, "o", color=c, ms=6, mec=SURFACE, mew=0.8)
        ax.text(hi + 0.6, y, f"{lo:+.0f} to {hi:+.0f}", va="center", fontsize=8, color=INK2)
    ax.axvline(0, color="#b9b8b2", lw=0.8)
    ax.set_yticks(range(len(rows))[::-1], [r_[0] for r_ in rows])
    ax.set_xlim(-24, 30); ax.set_ylim(-1.0, len(rows) - 0.5)
    ax.set_xlabel("True win rate, bb/100 (bar: middle 95% of players; line: 95% CI of the mean)")
    ax.set_title("How far apart are players' true win rates?")
    ax.grid(axis="y", visible=False)

    labels = list(halves)
    for i, k in enumerate(labels):
        h = halves[k]; y = len(labels) - 1 - i
        if abs(h["later_minus_earlier"]) > 1:
            bx.annotate("", xy=(h["later_half_m"], y), xytext=(h["m"], y),
                        arrowprops=dict(arrowstyle="-|>", color=BLUE, lw=1.4, shrinkA=4, shrinkB=4))
        bx.plot(h["m"], y, "o", color=SURFACE, mec=BLUE, mew=1.4, ms=6.5)
        bx.plot(h["later_half_m"], y, "o", color=BLUE, mec=SURFACE, mew=0.8, ms=6.5)
        lo, hi = h["later_minus_earlier_ci"]
        bx.text(5.6, y, f"{h['later_minus_earlier']:+.1f} [{lo:+.1f}, {hi:+.1f}]", va="center",
                fontsize=8, color=INK2)
    bx.plot([], [], "o", color=SURFACE, mec=BLUE, mew=1.4, label="Earlier half")
    bx.plot([], [], "o", color=BLUE, label="Later half")
    bx.axvline(0, color="#b9b8b2", lw=0.8)
    bx.set_yticks(range(len(labels))[::-1], [f"{k} hands" for k in labels])
    bx.set_xlim(-11, 10.5)
    bx.set_xlabel("Fitted mean win rate, bb/100")
    bx.set_title("Earlier and later half of each player's hands")
    bx.legend(loc="lower left", fontsize=8)
    bx.grid(axis="y", visible=False)
    save(fig, out, "fig5_population.png",
         "PartyPoker and Ongame \\$2/\\$4, 1-23 July 2009, players with at least 1,000 usable hands at one site. "
         "Hierarchical Normal model per volume bracket; 95% intervals resample players (2,000 times). "
         "Right: later minus earlier half with its 95% interval. Players who ended the month with fewer hands "
         "did worse in their later hands; regulars did not change.")


def fig_chapter2(r, out):
    c = r["chapter2"]
    priors = [("case study, N(0, 10^2)", "Case study prior, N(0, 10²)", ORANGE),
              ("players with 1,000+ hands (mixture of brackets)", "All players with 1,000+ hands", AQUA),
              ("regulars, 10,000+ hands", "Regulars, 10,000+ hands", BLUE)]
    hands = [h["hands"] for h in c["priors"][priors[0][0]]["history"]]
    plug = c["priors"][priors[0][0]]["plug_in_risk"]
    fig, ax = plt.subplots(figsize=(8.6, 4.2))
    for gi, n in enumerate(hands):
        for pi, (key, label, col) in enumerate(priors):
            h = c["priors"][key]["history"][gi]
            y = (len(hands) - 1 - gi) * 4 + (2 - pi)
            lo, hi = (100 * v for v in h["risk_interval"])
            ax.plot([max(lo, 1e-3), hi], [y, y], color=col, lw=5, alpha=0.45, solid_capstyle="butt")
            ax.plot(100 * h["median_risk"], y, "o", color=col, mec=SURFACE, mew=0.8, ms=6,
                    label=label if gi == 0 else None)
            ax.text(118, y, f"{lo:.2g}% to {hi:.3g}%", va="center", fontsize=7.8, color=INK2)
    ax.axvline(100 * plug, color=INK2, lw=0.9, ls="--")
    ax.text(100 * plug * 1.06, (len(hands) - 1) * 4 + 3.1, f"plug-in {100 * plug:.1f}%", fontsize=8, color=INK2)
    ax.set_xscale("log"); ax.set_xlim(1e-3, 100)
    ax.set_xticks([1e-3, 1e-2, 0.1, 1, 10, 100], ["0.001%", "0.01%", "0.1%", "1%", "10%", "100%"])
    ax.set_yticks([(len(hands) - 1 - gi) * 4 + 1 for gi in range(len(hands))],
                  [f"{n:,} hands" for n in hands])
    ax.set_ylim(-0.8, len(hands) * 4 - 0.2)
    ax.grid(axis="y", visible=False)
    ax.set_xlabel("Ruin risk over the next 100,000 hands (bar: 95% interval; dot: median)")
    ax.set_title("Chapter 2 rerun: history averaging +3 bb/100, under each prior")
    ax.legend(loc="lower left", fontsize=8, ncol=3, bbox_to_anchor=(0, -0.32))
    save(fig, out, "fig6_chapter2.png",
         "Chapter 2's scenario: SD 90 bb/100, 3,000 bb bankroll, 20,000 posterior draws, seed 0, risk per draw from "
         "the finite-horizon Brownian formula (the case study's own code). The case-study row reproduces "
         "reports/case-study/uncertainty.json exactly. The all-player prior is the mixture of the bracket fits.")


def main(out=Path(__file__).resolve().parents[2] / "reports" / "real-hands" / "q3"):
    out = Path(out)
    r = json.loads((out / "results.json").read_text())
    fig_population(r, out)
    fig_chapter2(r, out)


if __name__ == "__main__":
    main(*sys.argv[1:2])
