"""Poker Bankroll Risk Simulator — Streamlit decision-support app.

Run with:  streamlit run app.py

Interaction model: expensive simulations run only when the user clicks
**Run Simulation**. When inputs change afterwards, a "results are stale" banner
appears until the next run. All simulation and sweep results are cached by their
exact parameter tuple, so repeated runs are instant and fully reproducible.
"""

from __future__ import annotations

import io
import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import streamlit as st

from src import __version__
from src.analytics import (
    drawdown_analytics,
    estimate_risk_of_ruin,
    growth_analytics,
    time_to_ruin_analytics,
)
from src.formatting import Units, fmt_amount, fmt_bb, fmt_hands, fmt_pct
from src.plotting import (
    COLORS,
    comparison_bars,
    drawdown_distribution,
    fan_chart,
    risk_curve,
    risk_heatmap,
    terminal_distribution,
)
from src.recommendations import build_recommendations, interpret_validation
from src.scenarios import PRESETS, PRESET_BY_KEY
from src.sensitivity import (
    required_bankroll_for_target,
    risk_surface,
    sweep_parameter,
    winrate_uncertainty_sweep,
)
from src.simulation import (
    SimulationConfig,
    estimate_memory_bytes,
    simulate_bankroll,
)
from src.validation import validation_comparison

BUYIN_BB = 100.0  # convention: 1 buy-in = 100 bb
MODE_PATHS = {"Fast preview": 5_000, "Standard": 20_000, "High precision": 100_000}

st.set_page_config(
    page_title="Poker Bankroll Risk Simulator",
    layout="wide",
    initial_sidebar_state="expanded",
)


# ---------------------------------------------------------------------------
# Cached compute
# ---------------------------------------------------------------------------


@st.cache_data(show_spinner=False)
def run_sim(n_paths, n_hands, winrate, std, bankroll, threshold, seed, step):
    return simulate_bankroll(
        n_paths=n_paths, n_hands=n_hands, winrate_bb100=winrate,
        std_bb100=std, bankroll_bb=bankroll, ruin_threshold_bb=threshold,
        seed=seed, step_hands=step,
    )


@st.cache_data(show_spinner=False)
def cached_sweep(key, field, values, n_paths):
    base = SimulationConfig(*key)
    return sweep_parameter(base, field, list(values), n_paths=n_paths)


@st.cache_data(show_spinner=False)
def cached_heatmap(key, banks, wrs, n_paths):
    base = SimulationConfig(*key)
    return risk_surface(base, list(banks), list(wrs), n_paths=n_paths)


@st.cache_data(show_spinner=False)
def cached_validation(key, n_paths):
    base = SimulationConfig(*key)
    res = run_sim(*_key_for(base, n_paths))
    ror = estimate_risk_of_ruin(res, seed=base.seed)
    return validation_comparison(res, ror)


def _key_for(cfg: SimulationConfig, n_paths: int | None = None) -> tuple:
    return (
        cfg.n_paths if n_paths is None else n_paths,
        cfg.n_hands, cfg.winrate_bb100, cfg.std_bb100, cfg.bankroll_bb,
        cfg.ruin_threshold_bb, cfg.seed, cfg.step_hands,
    )


def _config_from_widgets() -> SimulationConfig:
    s = st.session_state
    return SimulationConfig(
        n_paths=int(s.paths),
        n_hands=int(s.hands),
        winrate_bb100=float(s.wr),
        std_bb100=float(s.sd),
        bankroll_bb=float(s.bankroll_bi) * BUYIN_BB,
        ruin_threshold_bb=float(s.thr_bi) * BUYIN_BB,
        seed=int(s.seed),
        step_hands=int(s.step),
    )


# ---------------------------------------------------------------------------
# Session defaults + preset handling
# ---------------------------------------------------------------------------

DEFAULTS = dict(
    preset="conservative_regular", units="Buy-ins", bb_size=1.0,
    wr=3.0, sd=90.0, bankroll_bi=50.0, thr_bi=0.0, hands=100_000,
    paths=20_000, step=100, seed=42, mode="Standard",
    wr_unc_on=False, wr_unc=2.0, target_ror=5.0,
)
for k, v in DEFAULTS.items():
    st.session_state.setdefault(k, v)
st.session_state.setdefault("comparisons", [])


def _apply_preset():
    p = PRESET_BY_KEY[st.session_state.preset]
    st.session_state.wr = p.winrate_bb100
    st.session_state.sd = p.std_bb100
    st.session_state.bankroll_bi = p.bankroll_bb / BUYIN_BB
    st.session_state.thr_bi = p.ruin_threshold_bb / BUYIN_BB
    st.session_state.hands = p.n_hands


def _apply_mode():
    st.session_state.paths = MODE_PATHS[st.session_state.mode]


def _reset():
    for k, v in DEFAULTS.items():
        st.session_state[k] = v
    _apply_preset()


# ---------------------------------------------------------------------------
# Sidebar
# ---------------------------------------------------------------------------

with st.sidebar:
    st.markdown("### Scenario")
    st.selectbox(
        "Preset", [p.key for p in PRESETS],
        format_func=lambda k: PRESET_BY_KEY[k].name,
        key="preset", on_change=_apply_preset,
    )
    st.caption(PRESET_BY_KEY[st.session_state.preset].description)
    st.radio("Display units", ["Buy-ins", "Big blinds"], key="units",
             horizontal=True)
    st.number_input("Big-blind size ($, for money display)", min_value=0.0,
                    step=0.25, key="bb_size",
                    help="Set to 0 to hide dollar figures. 1 buy-in = 100 bb.")
    st.button("Reset scenario", on_click=_reset, use_container_width=True)

    st.markdown("### Player assumptions")
    st.number_input("Win rate (bb/100)", min_value=-30.0, max_value=30.0,
                    step=0.5, key="wr")
    st.number_input("Std dev (bb/100)", min_value=1.0, max_value=400.0,
                    step=5.0, key="sd")
    st.checkbox("Add win-rate uncertainty band", key="wr_unc_on",
                help="Treat your win rate as an estimate with a +/- range.")
    if st.session_state.wr_unc_on:
        st.number_input("Win-rate uncertainty (± bb/100)", min_value=0.5,
                        max_value=15.0, step=0.5, key="wr_unc")

    st.markdown("### Bankroll policy")
    st.number_input("Starting bankroll (buy-ins)", min_value=1.0,
                    max_value=1000.0, step=1.0, key="bankroll_bi")
    st.number_input("Ruin threshold (buy-ins)", min_value=-50.0,
                    max_value=500.0, step=1.0, key="thr_bi",
                    help="Bankroll level counted as ruin. 0 = broke.")
    st.number_input("Target max ruin probability (%)", min_value=0.1,
                    max_value=50.0, step=0.5, key="target_ror")

    st.markdown("### Simulation")
    st.selectbox("Compute mode", list(MODE_PATHS), key="mode",
                 on_change=_apply_mode)
    st.number_input("Simulation paths", min_value=500, max_value=500_000,
                    step=1000, key="paths")
    st.number_input("Hands (horizon)", min_value=100, max_value=5_000_000,
                    step=10_000, key="hands")
    st.number_input("Step size (hands)", min_value=1, max_value=1000,
                    step=10, key="step")
    st.number_input("Random seed", min_value=0, max_value=1_000_000,
                    step=1, key="seed")

    n_steps = int(np.ceil(st.session_state.hands / st.session_state.step))
    est_mb = estimate_memory_bytes(int(st.session_state.paths), n_steps) / 1024**2
    st.caption(f"Estimated peak memory: ~{est_mb:,.0f} MB · "
               f"{int(st.session_state.paths):,} paths x {n_steps:,} steps")
    if est_mb > 2048:
        st.warning("This configuration may need more than 2 GB. The engine "
                   "will chunk automatically, but consider fewer paths or a "
                   "larger step size.")
    run_clicked = st.button("Run simulation", type="primary",
                            use_container_width=True)


# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------

st.title("Poker Bankroll Risk Simulator")
st.markdown(
    "Monte Carlo risk analysis for cash-game bankroll decisions. Explore how "
    "bankroll size, estimated edge, variance, and playing horizon affect the "
    "probability of reaching a defined loss threshold."
)
st.caption(
    "Research and educational tool. Results depend on simplified model "
    "assumptions and are not financial or gambling advice."
)

# Validate inputs before allowing a run.
cfg_now = None
input_error = None
try:
    cfg_now = _config_from_widgets()
    cfg_now.validate()
except ValueError as e:
    input_error = str(e)

if input_error:
    st.error(input_error)

if run_clicked and cfg_now is not None:
    st.session_state.run_key = _key_for(cfg_now)

units = Units(bb_per_buyin=BUYIN_BB,
              dollars_per_bb=(st.session_state.bb_size or None))
use_buyins = st.session_state.units == "Buy-ins"
udiv = BUYIN_BB if use_buyins else 1.0
ulabel = "buy-ins" if use_buyins else "bb"
prefer = "buyins" if use_buyins else "bb"


if "run_key" not in st.session_state:
    st.info("Set your scenario in the sidebar, then click **Run simulation**.")
    st.stop()

run_cfg = SimulationConfig(*st.session_state.run_key)
result = run_sim(*st.session_state.run_key)
stale = cfg_now is not None and _key_for(cfg_now) != st.session_state.run_key
if stale:
    st.warning("Parameters changed. Run the simulation to refresh results.")


# ---------------------------------------------------------------------------
# Precompute headline analytics (cheap, from the cached result)
# ---------------------------------------------------------------------------

ror = estimate_risk_of_ruin(result, seed=run_cfg.seed)
dd = drawdown_analytics(result)
growth = growth_analytics(result)
ttr = time_to_ruin_analytics(result)
target = st.session_state.target_ror / 100.0


def money_suffix(bb: float) -> str:
    m = units.bb_to_dollars(bb)
    return f" (${m:,.0f})" if m is not None else ""


tabs = st.tabs(
    ["Overview", "Sensitivity", "Scenario Comparison", "Validation",
     "Methodology"]
)

# ===========================================================================
# Overview
# ===========================================================================
with tabs[0]:
    med_ruin = ttr["median_ruin_hand"]
    st.markdown(
        f"#### Under the selected assumptions, the estimated probability of "
        f"reaching the ruin threshold within {run_cfg.n_hands:,} hands is "
        f"**{fmt_pct(ror['point_estimate'])}** "
        f"[95% CI {fmt_pct(ror['ci_low'])}-{fmt_pct(ror['ci_high'])}]."
    )

    c = st.columns(3)
    c[0].metric("Risk of ruin", fmt_pct(ror["point_estimate"]),
                help="Share of simulated paths that reached the ruin "
                     "threshold within the horizon.")
    c[1].metric(f"P95 max drawdown ({ulabel})",
                fmt_amount(dd["p95_max_drawdown"], units, prefer),
                help="95th-percentile largest drop from a prior peak.")
    c[2].metric(f"Median terminal bankroll ({ulabel})",
                fmt_amount(growth["median_terminal_bankroll"], units, prefer),
                help="Median ending bankroll across all paths.")
    c = st.columns(3)
    c[0].metric("Probability of profit", fmt_pct(growth["prob_profit"]),
                help="Share of paths ending above the starting bankroll.")
    c[1].metric("Median time to ruin",
                "n/a" if med_ruin != med_ruin else f"{med_ruin:,.0f} hands",
                help="Median ruin hand among ruined paths only.")
    c[2].metric("Paths simulated", f"{ror['n_paths']:,}")

    st.divider()
    fan_cols = st.columns([3, 1])
    with fan_cols[1]:
        show_ruined = st.checkbox("Show ruined paths", value=True)
        show_band = st.checkbox("Show P5-P95 band", value=True)
        n_show = st.slider("Paths to draw", 20, 200, 100, step=10)
    with fan_cols[0]:
        st.plotly_chart(
            fan_chart(result, max_paths=n_show, show_ruined=show_ruined,
                      show_band=show_band, units_divisor=udiv,
                      unit_label=ulabel),
            use_container_width=True,
        )
    st.caption("The lines are a sampled subset of paths, not all simulated "
               "paths. The shaded band is the P5-P95 range across the sample.")

    st.divider()
    dcol = st.columns(2)
    with dcol[0]:
        mode = st.radio("Drawdown view", ["histogram", "ecdf"],
                        horizontal=True, format_func=str.title)
        st.plotly_chart(
            drawdown_distribution(result, mode=mode, units_divisor=udiv,
                                  unit_label=ulabel),
            use_container_width=True,
        )
    with dcol[1]:
        st.plotly_chart(
            terminal_distribution(result, units_divisor=udiv,
                                  unit_label=ulabel),
            use_container_width=True,
        )
    st.caption("Mean and median are shown together because the terminal "
               "distribution is typically skewed.")

    st.divider()
    st.markdown("##### Interpretation")
    with st.spinner("Building interpretation..."):
        recs = build_recommendations(result, run_cfg, target_ror=target)
    badge = recs["risk_label"]
    st.markdown(f"**Risk classification:** {badge} "
                f"*(interface label, not a universal bankroll standard)*")
    for line in recs["narrative"]:
        st.markdown(f"- {line}")

# ===========================================================================
# Sensitivity
# ===========================================================================
with tabs[1]:
    st.markdown("#### Risk-of-ruin curve")
    x_choice = st.radio(
        "Sweep parameter", ["bankroll_bb", "winrate_bb100", "std_bb100"],
        format_func={"bankroll_bb": "Bankroll",
                     "winrate_bb100": "Win rate",
                     "std_bb100": "Std dev"}.get,
        horizontal=True,
    )
    sweep_paths = st.slider("Paths per sweep point", 2000, 40000, 8000,
                            step=2000,
                            help="Lower is faster; higher is smoother.")
    if x_choice == "bankroll_bb":
        vals = np.linspace(max(run_cfg.ruin_threshold_bb + BUYIN_BB,
                               run_cfg.bankroll_bb * 0.3),
                           run_cfg.bankroll_bb * 2.0, 12)
        current_x = run_cfg.bankroll_bb / udiv
        xlabel = f"Bankroll ({ulabel})"
    elif x_choice == "winrate_bb100":
        vals = np.linspace(max(-5.0, run_cfg.winrate_bb100 - 4),
                           run_cfg.winrate_bb100 + 4, 12)
        current_x = run_cfg.winrate_bb100
        xlabel = "Win rate (bb/100)"
    else:
        vals = np.linspace(max(20.0, run_cfg.std_bb100 - 40),
                           run_cfg.std_bb100 + 40, 12)
        current_x = run_cfg.std_bb100
        xlabel = "Std dev (bb/100)"

    with st.spinner("Sweeping..."):
        df = cached_sweep(st.session_state.run_key, x_choice,
                          tuple(float(v) for v in vals), sweep_paths)
    if not df.empty:
        plot_df = df.copy()
        if x_choice == "bankroll_bb":
            plot_df["bankroll_bb"] = plot_df["bankroll_bb"] / udiv
        st.plotly_chart(
            risk_curve(plot_df, x_choice, xlabel, current_x=current_x,
                       target_ror=target),
            use_container_width=True,
        )

    st.divider()
    st.markdown("#### Find bankroll for a target risk")
    if st.button("Solve required bankroll"):
        with st.spinner("Searching..."):
            req = required_bankroll_for_target(
                run_cfg, target,
                lo_bb=max(run_cfg.ruin_threshold_bb + BUYIN_BB,
                          run_cfg.bankroll_bb * 0.2),
                hi_bb=run_cfg.bankroll_bb * 5.0,
            )
        if req["bracketed"]:
            st.success(
                f"A bankroll near **{fmt_amount(req['bankroll_bb'], units, prefer)}** "
                f"keeps modeled ruin risk at or below {st.session_state.target_ror:.0f}% "
                f"(achieved {fmt_pct(req['risk_of_ruin'])})."
            )
        else:
            st.warning("Target not reached within the search range; the edge or "
                       "variance assumptions dominate.")

    st.divider()
    st.markdown("#### Win-rate uncertainty")
    st.caption("Observed win rates are estimates. This sweeps a plausible band "
               "around your assumption to show how much risk depends on it.")
    unc = st.session_state.wr_unc if st.session_state.wr_unc_on else 2.0
    unc = st.slider("Uncertainty band (± bb/100)", 0.5, 10.0, float(unc),
                    step=0.5)
    with st.spinner("Sweeping win rate..."):
        wr_df = winrate_uncertainty_sweep(
            run_cfg, run_cfg.winrate_bb100, unc, n_points=9,
            n_paths=sweep_paths,
        )
    if not wr_df.empty:
        st.plotly_chart(
            risk_curve(wr_df, "winrate_bb100", "Win rate (bb/100)",
                       current_x=run_cfg.winrate_bb100, target_ror=target),
            use_container_width=True,
        )

    st.divider()
    with st.expander("Risk surface (2-D heatmap) — heavier compute"):
        if st.button("Compute risk surface"):
            banks = np.linspace(max(run_cfg.ruin_threshold_bb + BUYIN_BB,
                                    run_cfg.bankroll_bb * 0.3),
                                run_cfg.bankroll_bb * 2.0, 9)
            wrs = np.linspace(max(-4.0, run_cfg.winrate_bb100 - 4),
                              run_cfg.winrate_bb100 + 4, 9)
            with st.spinner("Building surface (coarse grid)..."):
                surf = cached_heatmap(
                    st.session_state.run_key,
                    tuple(float(b) for b in banks),
                    tuple(float(w) for w in wrs), 4000)
            st.plotly_chart(
                risk_heatmap(surf, units_divisor=udiv, unit_label=ulabel),
                use_container_width=True,
            )

# ===========================================================================
# Scenario Comparison
# ===========================================================================
with tabs[2]:
    st.markdown("#### Compare up to three scenarios")
    cc = st.columns([1, 1, 2])
    if cc[0].button("Save current scenario"):
        if len(st.session_state.comparisons) >= 3:
            st.session_state.comparisons.pop(0)
        st.session_state.comparisons.append(st.session_state.run_key)
    if cc[1].button("Clear saved"):
        st.session_state.comparisons = []

    if not st.session_state.comparisons:
        st.info("Run a scenario, then click **Save current scenario** to add "
                "it here (up to three).")
    else:
        rows = []
        for i, key in enumerate(st.session_state.comparisons, start=1):
            cfg = SimulationConfig(*key)
            res = run_sim(*key)
            r = estimate_risk_of_ruin(res, seed=cfg.seed)
            d = drawdown_analytics(res)
            g = growth_analytics(res)
            comp = validation_comparison(res, r, run_markov=False)
            rows.append({
                "Scenario": f"#{i}",
                "Win rate": f"{cfg.winrate_bb100:g} bb/100",
                "Std": f"{cfg.std_bb100:g}",
                "Bankroll": fmt_amount(cfg.bankroll_bb, units, prefer),
                "Hands": fmt_hands(cfg.n_hands),
                "Risk of ruin": fmt_pct(r["point_estimate"]),
                "P95 drawdown": fmt_amount(d["p95_max_drawdown"], units, prefer),
                "Median terminal": fmt_amount(g["median_terminal_bankroll"],
                                              units, prefer),
                "Prob. profit": fmt_pct(g["prob_profit"]),
                "Analytical RoR": fmt_pct(comp["methods"]["brownian_finite"]),
            })
        cmp_df = pd.DataFrame(rows).set_index("Scenario")
        st.dataframe(cmp_df, use_container_width=True)
        labels = list(cmp_df.index)
        rors = [estimate_risk_of_ruin(run_sim(*k), seed=SimulationConfig(*k).seed)
                ["point_estimate"] for k in st.session_state.comparisons]
        st.plotly_chart(
            comparison_bars(labels, rors, "Risk of ruin by scenario",
                            "Risk of ruin", percent=True),
            use_container_width=True,
        )

# ===========================================================================
# Validation
# ===========================================================================
with tabs[3]:
    st.markdown("#### Cross-checking the Monte Carlo estimate")
    st.caption("Three methods answer slightly different questions. They are not "
               "expected to be identical.")
    if st.button("Run validation comparison"):
        with st.spinner("Computing analytical + Markov cross-checks..."):
            comp = cached_validation(st.session_state.run_key, run_cfg.n_paths)
        m = comp["methods"]
        lo, hi = m["monte_carlo_ci"]
        table = pd.DataFrame({
            "Method": [
                "Monte Carlo, finite horizon",
                "  95% confidence interval",
                "Brownian approx, finite horizon",
                "Brownian approx, infinite horizon",
                "Markov chain, finite step",
            ],
            "Risk of ruin": [
                fmt_pct(m["monte_carlo_finite"]),
                f"[{fmt_pct(lo)}, {fmt_pct(hi)}]",
                fmt_pct(m["brownian_finite"]),
                fmt_pct(m["brownian_infinite"]),
                fmt_pct(m["markov_chain"]),
            ],
        }).set_index("Method")
        st.dataframe(table, use_container_width=True)
        st.markdown(interpret_validation(comp))
        diffs = comp["differences_vs_finite"]
        drows = [{"Method": k,
                  "Abs. diff": f"{v['absolute'] * 100:.2f} pts",
                  "Rel. diff": ("n/a" if v["relative"] != v["relative"]
                                else f"{v['relative'] * 100:.1f}%")}
                 for k, v in diffs.items()]
        st.dataframe(pd.DataFrame(drows).set_index("Method"),
                     use_container_width=True)
    else:
        st.info("Click **Run validation comparison** to compute the analytical "
                "and Markov cross-checks for the current scenario.")

# ===========================================================================
# Methodology + Export
# ===========================================================================
with tabs[4]:
    st.markdown("#### Methodology")
    with st.expander("Bankroll process and Monte Carlo"):
        st.markdown(
            "- Bankroll in big blinds, updated in steps of `step_hands` hands.\n"
            "- Each step: `increment ~ Normal(winrate*step/100, "
            "std*sqrt(step/100))`.\n"
            "- Ruin is absorbing: once bankroll <= threshold, the path is "
            "clipped there and cannot recover.\n"
            "- Risk of ruin = fraction of ruined paths; CI by path-level "
            "bootstrap (or Wilson interval for large path counts).")
    with st.expander("Validation methods and why they differ"):
        st.markdown(
            "- **Finite-horizon Brownian** first-passage is the most "
            "comparable analytical benchmark.\n"
            "- **Infinite-horizon gambler's ruin** `exp(-2*mu*b/sigma^2)` "
            "assumes unlimited time and is an upper bound.\n"
            "- **Markov chain** discretizes the bankroll and iterates the same "
            "number of steps (finite-step absorption).")
    with st.expander("Assumptions and limitations"):
        st.markdown(
            "- i.i.d. results ignore session dependence and autocorrelation.\n"
            "- Stationary win rate ignores learning, tilt, and game selection.\n"
            "- Normal increments may understate heavy tails.\n"
            "- Win-rate estimates carry sampling uncertainty.\n"
            "- Deposits, withdrawals, and stake changes are excluded.\n"
            "- Cash-game variance only — not tournament ICM.\n"
            "- Outputs are conditional model estimates, not guarantees.")

    st.divider()
    st.markdown("#### Export and reproducibility")
    params = result["parameters"]
    metrics = {
        "risk_of_ruin": ror["point_estimate"],
        "ror_ci_low": ror["ci_low"], "ror_ci_high": ror["ci_high"],
        "p95_max_drawdown_bb": dd["p95_max_drawdown"],
        "median_terminal_bb": growth["median_terminal_bankroll"],
        "mean_terminal_bb": growth["mean_terminal_bankroll"],
        "prob_profit": growth["prob_profit"],
        "median_ruin_hand": ttr["median_ruin_hand"],
        "paths_simulated": ror["n_paths"],
    }
    ec = st.columns(3)
    ec[0].download_button(
        "Config (JSON)", json.dumps(params, indent=2),
        file_name="scenario_config.json", mime="application/json",
        use_container_width=True)
    ec[1].download_button(
        "Metrics (CSV)",
        pd.DataFrame([metrics]).to_csv(index=False),
        file_name="headline_metrics.csv", mime="text/csv",
        use_container_width=True)

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    report = io.StringIO()
    report.write(f"# Bankroll Risk Report\n\n")
    report.write(f"- Generated: {ts}\n- Model version: {__version__}\n")
    report.write(f"- Seed: {params['seed']}\n\n## Parameters\n\n")
    for k, v in params.items():
        report.write(f"- {k}: {v}\n")
    report.write("\n## Headline results\n\n")
    report.write(f"- Risk of ruin: {fmt_pct(ror['point_estimate'])} "
                 f"[{fmt_pct(ror['ci_low'])}, {fmt_pct(ror['ci_high'])}]\n")
    report.write(f"- P95 max drawdown: {fmt_bb(dd['p95_max_drawdown'])}\n")
    report.write(f"- Median terminal bankroll: "
                 f"{fmt_bb(growth['median_terminal_bankroll'])}\n")
    report.write(f"- Probability of profit: {fmt_pct(growth['prob_profit'])}\n")
    report.write("\n## Limitations\n\n")
    report.write("Model estimates only; i.i.d. Normal increments, stationary "
                 "win rate, cash-game variance (not ICM). Not financial or "
                 "gambling advice.\n")
    ec[2].download_button(
        "Report (Markdown)", report.getvalue(),
        file_name="bankroll_risk_report.md", mime="text/markdown",
        use_container_width=True)

    st.markdown("**Reproduce this run from the command line:**")
    st.code(
        "python scripts/run_validation.py "
        f"--winrate {params['winrate_bb100']:g} --std {params['std_bb100']:g} "
        f"--bankroll {params['bankroll_bb']:g} --hands {params['n_hands']} "
        f"--paths {params['n_paths']} --seed {params['seed']}",
        language="bash",
    )
