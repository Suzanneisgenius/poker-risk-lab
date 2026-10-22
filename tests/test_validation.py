"""Tests for the validation layer (analytical + Markov cross-checks)."""

import numpy as np
import pytest

from src.analytics import estimate_risk_of_ruin
from src.simulation import simulate_bankroll
from src.validation import (
    brownian_ruin_finite,
    brownian_ruin_infinite,
    markov_chain_ruin,
    per_hand_params,
    validation_comparison,
)


def test_unit_conversion():
    mu, sigma2 = per_hand_params(3.0, 90.0)
    assert mu == pytest.approx(0.03)
    assert sigma2 == pytest.approx(81.0)


def test_infinite_positive_drift_between_zero_and_one():
    p = brownian_ruin_infinite(3.0, 90.0, 3000.0)["probability"]
    assert 0.0 < p < 1.0


def test_infinite_matches_closed_form():
    # exp(-2 * wr * b / std^2)
    p = brownian_ruin_infinite(3.0, 90.0, 2000.0, 0.0)["probability"]
    expected = np.exp(-2 * 3.0 * 2000.0 / 90.0**2)
    assert p == pytest.approx(expected)


def test_infinite_nonpositive_drift_is_one():
    assert brownian_ruin_infinite(0.0, 90.0, 3000.0)["probability"] == 1.0
    assert brownian_ruin_infinite(-2.0, 90.0, 3000.0)["probability"] == 1.0


def test_finite_between_zero_and_one():
    p = brownian_ruin_finite(3.0, 90.0, 3000.0, 100_000)["probability"]
    assert 0.0 <= p <= 1.0


def test_finite_leq_infinite_for_positive_drift():
    fin = brownian_ruin_finite(3.0, 90.0, 3000.0, 100_000)["probability"]
    inf = brownian_ruin_infinite(3.0, 90.0, 3000.0)["probability"]
    # Finite horizon can only ruin in fewer ways than infinite horizon.
    assert fin <= inf + 1e-9


def test_finite_increases_with_horizon():
    short = brownian_ruin_finite(3.0, 90.0, 3000.0, 20_000)["probability"]
    long = brownian_ruin_finite(3.0, 90.0, 3000.0, 500_000)["probability"]
    assert long >= short


def test_markov_rows_sum_to_one():
    m = markov_chain_ruin(3.0, 90.0, 3000.0, 100_000)
    assert m["max_row_sum_error"] < 1e-9


def test_markov_between_zero_and_one():
    m = markov_chain_ruin(3.0, 90.0, 3000.0, 100_000)
    assert 0.0 <= m["probability"] <= 1.0


def test_markov_reports_truncation_diagnostics():
    m = markov_chain_ruin(3.0, 90.0, 3000.0, 100_000)
    # Precise upper-boundary description: aggregation, explicitly not reflecting.
    assert "aggregated" in m["upper_boundary"]
    assert "not reflecting" in m["upper_boundary"]
    assert "mass_at_cap" in m and "truncation_warning" in m
    assert 0.0 <= m["mass_at_cap"] <= 1.0
    # The warning flag must be consistent with the reported cap mass.
    assert m["truncation_warning"] == (m["mass_at_cap"] > 1e-3)


def test_markov_generous_cap_has_negligible_truncation():
    # A very high cap should leave almost no mass at the top state.
    m = markov_chain_ruin(3.0, 90.0, 3000.0, 100_000, cap_bb=30_000.0)
    assert m["mass_at_cap"] < 1e-3
    assert m["truncation_warning"] is False


def test_markov_stable_under_resolution_change():
    a = markov_chain_ruin(3.0, 90.0, 3000.0, 100_000, state_bb=8.0)
    b = markov_chain_ruin(3.0, 90.0, 3000.0, 100_000, state_bb=4.0)
    assert a["probability"] == pytest.approx(b["probability"], abs=0.02)


def test_markov_resolution_too_fine_raises():
    with pytest.raises(ValueError):
        markov_chain_ruin(3.0, 90.0, 3000.0, 100_000, state_bb=0.1,
                          max_states=500)


def test_mc_finite_and_markov_reasonably_consistent():
    # A parameter set with a meaningful, moderate ruin probability.
    common = dict(n_paths=40_000, n_hands=100_000, winrate_bb100=2.0,
                  std_bb100=90.0, bankroll_bb=1500.0, seed=42)
    endpoint = estimate_risk_of_ruin(simulate_bankroll(**common, bridge=False), seed=0)
    bridged = estimate_risk_of_ruin(simulate_bankroll(**common), seed=0)
    fin = brownian_ruin_finite(2.0, 90.0, 1500.0, 100_000)["probability"]
    mk = markov_chain_ruin(2.0, 90.0, 1500.0, 100_000)["probability"]
    # Endpoint-only MC and the Markov chain both monitor ruin at 100-hand
    # steps, so they agree closely.
    assert abs(endpoint["point_estimate"] - mk) < 0.03
    # The default bridge-corrected MC monitors continuously, like the Brownian
    # first-passage formula, so it lands within its own interval of it.
    assert bridged["ci_low"] - 0.005 <= fin <= bridged["ci_high"] + 0.005
    assert abs(bridged["point_estimate"] - fin) < abs(endpoint["point_estimate"] - fin)


def test_comparison_assembles_table():
    res = simulate_bankroll(
        n_paths=8000, n_hands=100_000, winrate_bb100=2.0, std_bb100=90.0,
        bankroll_bb=1500.0, seed=42,
    )
    mc = estimate_risk_of_ruin(res, seed=0)
    comp = validation_comparison(res, mc)
    assert "monte_carlo_finite" in comp["methods"]
    assert "brownian_finite" in comp["methods"]
    assert "brownian_infinite" in comp["methods"]
    assert "markov_chain" in comp["methods"]
    assert isinstance(comp["verdict_mc_vs_finite"], str)
