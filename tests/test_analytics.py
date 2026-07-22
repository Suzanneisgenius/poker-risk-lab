"""Tests for the analytics layer."""

import numpy as np
import pytest

from src.analytics import (
    drawdown_analytics,
    estimate_risk_of_ruin,
    growth_analytics,
    summarize,
    time_to_ruin_analytics,
)
from src.simulation import simulate_bankroll


def make(**overrides):
    params = dict(
        n_paths=5000, n_hands=50_000, winrate_bb100=1.0, std_bb100=90.0,
        bankroll_bb=1000.0, ruin_threshold_bb=0.0, seed=42,
    )
    params.update(overrides)
    return simulate_bankroll(**params)


def test_risk_matches_ruined_mask_mean():
    res = make()
    est = estimate_risk_of_ruin(res, seed=0)
    assert est["point_estimate"] == pytest.approx(res["ruined"].mean())


def test_ci_contains_point_estimate_bootstrap():
    res = make()
    est = estimate_risk_of_ruin(res, seed=0, n_bootstrap=1000)
    assert est["ci_low"] <= est["point_estimate"] <= est["ci_high"]


def test_ci_contains_point_estimate_binomial():
    res = make()
    est = estimate_risk_of_ruin(res, method="binomial")
    assert est["ci_low"] <= est["point_estimate"] <= est["ci_high"]
    assert est["method"] == "binomial"


def test_default_method_is_wilson():
    res = make()
    est = estimate_risk_of_ruin(res)
    assert est["method"] == "wilson"


def test_bootstrap_and_wilson_close():
    res = make()
    a = estimate_risk_of_ruin(res, seed=1, n_bootstrap=2000, method="bootstrap")
    b = estimate_risk_of_ruin(res, method="wilson")
    assert a["point_estimate"] == pytest.approx(b["point_estimate"])
    # Bootstrap and Wilson intervals agree closely for a single proportion.
    assert a["ci_low"] == pytest.approx(b["ci_low"], abs=0.01)


def test_drawdown_nonnegative():
    res = make()
    dd = drawdown_analytics(res)
    for key in ("median_max_drawdown", "p95_max_drawdown", "p99_max_drawdown"):
        assert dd[key] >= 0


def test_zero_volatility_predictable_drawdown():
    # Positive edge, no variance -> monotonic increase -> zero drawdown.
    res = simulate_bankroll(
        n_paths=100, n_hands=10_000, winrate_bb100=2.0, std_bb100=0.0,
        bankroll_bb=500.0, seed=1,
    )
    dd = drawdown_analytics(res)
    assert dd["p99_max_drawdown"] == pytest.approx(0.0, abs=1e-9)


def test_growth_mean_and_median_present_and_correct():
    res = make(winrate_bb100=5.0, bankroll_bb=100_000.0)
    g = growth_analytics(res)
    assert g["mean_terminal_bankroll"] == pytest.approx(
        res["terminal_bankroll"].mean()
    )
    assert g["median_terminal_bankroll"] == pytest.approx(
        np.median(res["terminal_bankroll"])
    )
    assert 0.0 <= g["prob_profit"] <= 1.0


def test_time_to_ruin_ignores_survivors():
    res = make(winrate_bb100=-3.0, bankroll_bb=400.0)
    t = time_to_ruin_analytics(res)
    ruined_hands = res["ruin_hand"][res["ruined"]]
    assert t["median_ruin_hand"] == pytest.approx(np.median(ruined_hands))
    # Cumulative pct ruined by 100% >= by 50%.
    assert t["pct_ruined_by_100pct"] >= t["pct_ruined_by_50pct"]


def test_prob_double_bounds():
    res = make()
    g = growth_analytics(res)
    assert 0.0 <= g["prob_double"] <= 1.0


def test_summarize_bundles_all_blocks():
    res = make()
    s = summarize(res, seed=0, n_bootstrap=500)
    assert set(s) == {"risk_of_ruin", "drawdown", "growth", "time_to_ruin"}
