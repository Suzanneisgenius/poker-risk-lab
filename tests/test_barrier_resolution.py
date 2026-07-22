"""Tests for the barrier-resolution experiment and Brownian-bridge correction."""

import numpy as np
import pytest

from src.experiments.barrier_resolution import (
    Scenario,
    bridge_crossing_prob,
    run_barrier_resolution,
    simulate_barrier_rates,
    wilson,
)
from src.validation import brownian_ruin_finite

SC = Scenario(winrate_bb100=1.0, std_bb100=90.0, bankroll_bb=800.0,
              ruin_threshold_bb=0.0, n_hands=50_000)


def test_bridge_prob_bounds_and_monotonicity():
    s2 = 8100.0
    # In [0,1].
    a0 = np.array([10.0, 100.0, 500.0])
    a1 = np.array([10.0, 100.0, 500.0])
    p = bridge_crossing_prob(a0, a1, s2)
    assert np.all((p >= 0) & (p <= 1))
    # Farther from the barrier -> lower crossing probability.
    assert p[0] > p[1] > p[2]
    # Endpoints at the barrier -> certain crossing.
    assert bridge_crossing_prob(np.array([0.0]), np.array([5.0]), s2)[0] == pytest.approx(1.0)


def test_wilson_interval_contains_estimate():
    lo, hi = wilson(300, 1000)
    assert lo <= 0.3 <= hi
    assert 0.0 <= lo < hi <= 1.0


def test_bridge_ge_endpoint_always():
    # bridge = endpoint OR crossing, so bridge rate >= endpoint rate.
    for step in (10, 100, 500):
        r = simulate_barrier_rates(SC, step, n_paths=4000, seed=1)
        assert r["bridge_ruin"] >= r["endpoint_ruin"] - 1e-12


def test_endpoint_bias_grows_with_step():
    analytic = brownian_ruin_finite(1.0, 90.0, 800.0, 50_000, 0.0)["probability"]
    fine = simulate_barrier_rates(SC, 5, n_paths=6000, seed=2)
    coarse = simulate_barrier_rates(SC, 500, n_paths=6000, seed=2)
    # Coarse endpoint monitoring underestimates more than fine monitoring.
    assert abs(coarse["endpoint_ruin"] - analytic) > abs(fine["endpoint_ruin"] - analytic)
    assert coarse["endpoint_ruin"] < analytic  # underestimate


def test_bridge_reduces_bias_at_coarse_resolution():
    analytic = brownian_ruin_finite(1.0, 90.0, 800.0, 50_000, 0.0)["probability"]
    r = simulate_barrier_rates(SC, 500, n_paths=8000, seed=3)
    endpoint_err = abs(r["endpoint_ruin"] - analytic)
    bridge_err = abs(r["bridge_ruin"] - analytic)
    # The bridge correction is meaningfully closer to the continuous benchmark.
    assert bridge_err < endpoint_err


def test_reproducible_same_seed():
    a = simulate_barrier_rates(SC, 100, n_paths=3000, seed=7)
    b = simulate_barrier_rates(SC, 100, n_paths=3000, seed=7)
    assert a["endpoint_ruin"] == b["endpoint_ruin"]
    assert a["bridge_ruin"] == b["bridge_ruin"]


def test_run_returns_expected_columns():
    df = run_barrier_resolution(SC, [100, 500], n_paths=2000, seed=1)
    for col in ("endpoint_ruin", "bridge_ruin", "analytic_continuous",
                "endpoint_abs_err", "bridge_abs_err", "runtime_s"):
        assert col in df.columns
    assert len(df) == 2
