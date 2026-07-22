"""Plotly figures for the dashboard (dark quantitative theme).

All colors come from a single token dict. Downside/ruin is the only use of red,
and status is never communicated by color alone — every series is labelled.
Functions take arrays/DataFrames and return ``plotly.graph_objects.Figure``.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import plotly.graph_objects as go

# ---------------------------------------------------------------------------
# Design tokens
# ---------------------------------------------------------------------------

COLORS = {
    "bg": "#0B1220",
    "surface": "#131C2E",
    "grid": "#243247",
    "accent": "#38BDF8",     # primary cyan
    "survive": "#38BDF8",
    "ruin": "#F87171",       # muted red — downside only
    "positive": "#4ADE80",   # restrained green
    "band": "rgba(56,189,248,0.16)",
    "text": "#E6EDF3",
    "muted": "#94A3B8",
    "median": "#FBBF24",     # amber, distinct from cyan/red
}


def _base_layout(title: str, xaxis: str, yaxis: str) -> dict[str, Any]:
    return dict(
        title=dict(text=title, font=dict(color=COLORS["text"], size=16)),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        font=dict(color=COLORS["text"]),
        xaxis=dict(
            title=xaxis, gridcolor=COLORS["grid"], zerolinecolor=COLORS["grid"],
            color=COLORS["muted"],
        ),
        yaxis=dict(
            title=yaxis, gridcolor=COLORS["grid"], zerolinecolor=COLORS["grid"],
            color=COLORS["muted"],
        ),
        legend=dict(bgcolor="rgba(0,0,0,0)", font=dict(color=COLORS["muted"])),
        margin=dict(l=60, r=20, t=50, b=50),
        hovermode="closest",
    )


# ---------------------------------------------------------------------------
# 13.1 Bankroll path fan chart
# ---------------------------------------------------------------------------


def fan_chart(
    result: dict[str, Any],
    max_paths: int = 100,
    show_ruined: bool = True,
    show_band: bool = True,
    units_divisor: float = 1.0,
    unit_label: str = "bb",
) -> go.Figure:
    """Sampled bankroll paths with a percentile band and median.

    Only a subset of paths is drawn (a caption in the UI should say so). The
    percentile band is computed over *all* stored sample paths.
    """
    paths = np.asarray(result["bankroll_paths"], dtype=float) / units_divisor
    ruined = np.asarray(result["ruined"], dtype=bool)[: paths.shape[0]]
    step_sizes = np.asarray(result["step_sizes"], dtype=float)
    hands = np.concatenate([[0.0], np.cumsum(step_sizes)])
    thr = result["parameters"]["ruin_threshold_bb"] / units_divisor
    start = result["parameters"]["bankroll_bb"] / units_divisor

    fig = go.Figure()

    # Percentile band over all sampled paths.
    if show_band and paths.shape[0] >= 20:
        p5 = np.percentile(paths, 5, axis=0)
        p95 = np.percentile(paths, 95, axis=0)
        fig.add_trace(go.Scatter(
            x=np.concatenate([hands, hands[::-1]]),
            y=np.concatenate([p95, p5[::-1]]),
            fill="toself", fillcolor=COLORS["band"],
            line=dict(color="rgba(0,0,0,0)"), hoverinfo="skip",
            name="P5-P95 band",
        ))

    # Sampled individual paths.
    n_show = min(max_paths, paths.shape[0])
    for i in range(n_show):
        is_ruined = ruined[i]
        if is_ruined and not show_ruined:
            continue
        color = COLORS["ruin"] if is_ruined else COLORS["survive"]
        fig.add_trace(go.Scatter(
            x=hands, y=paths[i],
            line=dict(color=color, width=0.7),
            opacity=0.5 if not is_ruined else 0.65,
            hoverinfo="skip", showlegend=False,
        ))

    # Median path.
    median = np.median(paths, axis=0)
    fig.add_trace(go.Scatter(
        x=hands, y=median, line=dict(color=COLORS["median"], width=2.2),
        name="Median path",
    ))

    # Reference lines.
    fig.add_hline(y=start, line=dict(color=COLORS["muted"], dash="dot"),
                  annotation_text="Start", annotation_position="top left")
    fig.add_hline(y=thr, line=dict(color=COLORS["ruin"], dash="dash"),
                  annotation_text="Ruin threshold",
                  annotation_position="bottom left")

    # Legend proxies for path colors.
    fig.add_trace(go.Scatter(x=[None], y=[None], mode="lines",
                             line=dict(color=COLORS["survive"]),
                             name="Surviving paths (sample)"))
    if show_ruined:
        fig.add_trace(go.Scatter(x=[None], y=[None], mode="lines",
                                 line=dict(color=COLORS["ruin"]),
                                 name="Ruined paths (sample)"))

    fig.update_layout(**_base_layout(
        f"Bankroll paths (showing {n_show} of {paths.shape[0]} sampled)",
        "Hands", f"Bankroll ({unit_label})"))
    return fig


# ---------------------------------------------------------------------------
# 13.2 Risk-of-ruin curve
# ---------------------------------------------------------------------------


def risk_curve(
    df: pd.DataFrame,
    x_field: str,
    x_label: str,
    current_x: float | None = None,
    target_ror: float | None = None,
    analytical: pd.DataFrame | None = None,
) -> go.Figure:
    """Risk-of-ruin vs a swept parameter, with CI band and current marker."""
    fig = go.Figure()

    fig.add_trace(go.Scatter(
        x=np.concatenate([df[x_field], df[x_field][::-1]]),
        y=np.concatenate([df["ci_high"], df["ci_low"][::-1]]),
        fill="toself", fillcolor=COLORS["band"],
        line=dict(color="rgba(0,0,0,0)"), hoverinfo="skip",
        name="95% CI",
    ))
    fig.add_trace(go.Scatter(
        x=df[x_field], y=df["risk_of_ruin"],
        line=dict(color=COLORS["accent"], width=2.4),
        mode="lines+markers", name="Monte Carlo risk of ruin",
    ))
    if analytical is not None and "risk_of_ruin" in analytical:
        fig.add_trace(go.Scatter(
            x=analytical[x_field], y=analytical["risk_of_ruin"],
            line=dict(color=COLORS["muted"], width=1.6, dash="dash"),
            name="Analytical reference",
        ))
    if target_ror is not None:
        fig.add_hline(y=target_ror, line=dict(color=COLORS["positive"],
                      dash="dot"),
                      annotation_text=f"Target {target_ror * 100:.0f}%",
                      annotation_position="top right")
    if current_x is not None:
        fig.add_vline(x=current_x, line=dict(color=COLORS["median"], dash="dot"),
                      annotation_text="Current", annotation_position="top")

    fig.update_layout(**_base_layout(
        "Risk of ruin", x_label, "Risk of ruin"))
    fig.update_yaxes(tickformat=".0%")
    return fig


# ---------------------------------------------------------------------------
# 13.3 Max-drawdown distribution
# ---------------------------------------------------------------------------


def drawdown_distribution(
    result: dict[str, Any],
    mode: str = "histogram",
    units_divisor: float = 1.0,
    unit_label: str = "bb",
) -> go.Figure:
    """Histogram or ECDF of maximum drawdown, with median/P90/P95 markers."""
    mdd = np.asarray(result["max_drawdown"], dtype=float) / units_divisor
    med = float(np.median(mdd))
    p90 = float(np.percentile(mdd, 90))
    p95 = float(np.percentile(mdd, 95))

    fig = go.Figure()
    if mode == "ecdf":
        xs = np.sort(mdd)
        ys = np.arange(1, xs.size + 1) / xs.size
        fig.add_trace(go.Scatter(x=xs, y=ys, line=dict(color=COLORS["accent"]),
                                 name="Cumulative probability"))
        fig.update_yaxes(tickformat=".0%")
        ylab = "Cumulative probability"
    else:
        fig.add_trace(go.Histogram(x=mdd, nbinsx=50,
                                   marker=dict(color=COLORS["accent"]),
                                   opacity=0.85, name="Max drawdown"))
        ylab = "Count"

    for value, name, color in (
        (med, "Median", COLORS["median"]),
        (p90, "P90", COLORS["muted"]),
        (p95, "P95", COLORS["ruin"]),
    ):
        fig.add_vline(x=value, line=dict(color=color, dash="dash"),
                      annotation_text=name, annotation_position="top")

    fig.update_layout(**_base_layout(
        "Maximum drawdown (from prior peak)",
        f"Max drawdown ({unit_label})", ylab))
    return fig


# ---------------------------------------------------------------------------
# 13.4 Terminal-bankroll distribution
# ---------------------------------------------------------------------------


def terminal_distribution(
    result: dict[str, Any],
    units_divisor: float = 1.0,
    unit_label: str = "bb",
) -> go.Figure:
    """Terminal-bankroll histogram highlighting mean vs median asymmetry."""
    terminal = np.asarray(result["terminal_bankroll"], dtype=float) / units_divisor
    start = result["parameters"]["bankroll_bb"] / units_divisor
    mean = float(terminal.mean())
    median = float(np.median(terminal))

    fig = go.Figure()
    fig.add_trace(go.Histogram(x=terminal, nbinsx=60,
                               marker=dict(color=COLORS["accent"]),
                               opacity=0.85, name="Terminal bankroll"))
    fig.add_vline(x=start, line=dict(color=COLORS["muted"], dash="dot"),
                  annotation_text="Start", annotation_position="top left")
    fig.add_vline(x=median, line=dict(color=COLORS["median"], dash="dash"),
                  annotation_text="Median", annotation_position="top")
    fig.add_vline(x=mean, line=dict(color=COLORS["positive"], dash="dash"),
                  annotation_text="Mean", annotation_position="top right")
    fig.update_layout(**_base_layout(
        "Terminal bankroll distribution",
        f"Terminal bankroll ({unit_label})", "Count"))
    return fig


# ---------------------------------------------------------------------------
# 7.3 Risk surface heatmap
# ---------------------------------------------------------------------------


def risk_heatmap(
    df: pd.DataFrame,
    units_divisor: float = 1.0,
    unit_label: str = "bb",
) -> go.Figure:
    """2-D risk-of-ruin heatmap over (bankroll, win rate)."""
    pivot = df.pivot(index="winrate_bb100", columns="bankroll_bb",
                     values="risk_of_ruin")
    fig = go.Figure(data=go.Heatmap(
        x=pivot.columns.values / units_divisor,
        y=pivot.index.values,
        z=pivot.values,
        colorscale=[[0, COLORS["survive"]], [0.5, "#1E3A5F"],
                    [1, COLORS["ruin"]]],
        colorbar=dict(title="Risk of ruin", tickformat=".0%"),
        hovertemplate=(f"Bankroll: %{{x:.0f}} {unit_label}<br>"
                       "Win rate: %{y:.1f} bb/100<br>"
                       "Risk of ruin: %{z:.1%}<extra></extra>"),
    ))
    fig.update_layout(**_base_layout(
        "Risk surface", f"Bankroll ({unit_label})", "Win rate (bb/100)"))
    return fig


def comparison_bars(
    labels: list[str], values: list[float], title: str, y_label: str,
    percent: bool = False,
) -> go.Figure:
    """Simple grouped bar chart for scenario comparison."""
    fig = go.Figure(go.Bar(
        x=labels, y=values, marker=dict(color=COLORS["accent"]),
    ))
    fig.update_layout(**_base_layout(title, "", y_label))
    if percent:
        fig.update_yaxes(tickformat=".0%")
    return fig
