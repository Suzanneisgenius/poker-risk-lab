"""Tests for the Monte Carlo convergence / coverage experiment."""

import numpy as np
import pytest

from src.experiments.monte_carlo_convergence import (
    Scenario,
    _seeds,
    fit_rate,
    reference_probability,
    run_convergence,
    sequential_stopping,
    wilson,
)

SC = Scenario(winrate_bb100=3.0, std_bb100=90.0, bankroll_bb=2000.0,
              ruin_threshold_bb=0.0, n_hands=30_000, step_hands=100)


def test_fit_rate_recovers_known_slope():
    # Synthetic exact power law y = 0.3 * N^(-0.5).
    import pandas as pd
    N = np.array([1000, 2000, 4000, 8000, 16000], dtype=float)
    df = pd.DataFrame({"n_paths": N, "empirical_std": 0.3 * N ** -0.5})
    r = fit_rate(df, "empirical_std")
    assert r["slope"] == pytest.approx(-0.5, abs=1e-6)


def test_seeds_reproducible_and_distinct():
    a = _seeds(123, 8)
    b = _seeds(123, 8)
    assert a == b
    assert len(set(a)) == 8  # distinct


def test_wilson_basic():
    lo, hi = wilson(70, 1000)
    assert lo <= 0.07 <= hi
    assert 0 <= lo < hi <= 1


def test_run_convergence_std_decreases_with_budget():
    df = run_convergence(SC, [1000, 4000, 16000], n_seeds=6, base_seed=1,
                         reference=0.078)
    stds = df["empirical_std"].to_numpy()
    # Estimator std should fall as the budget grows (allow tiny MC noise).
    assert stds[0] > stds[-1]
    for col in ("bias", "coverage", "avg_ci_width", "theoretical_std"):
        assert col in df.columns


def test_empirical_std_near_theoretical():
    ref = reference_probability(SC, 40_000, 999)
    df = run_convergence(SC, [4000, 16000], n_seeds=10, base_seed=5, reference=ref)
    # Empirical and theoretical std should agree to the same order of magnitude.
    ratio = df["empirical_std"] / df["theoretical_std"]
    assert np.all((ratio > 0.5) & (ratio < 2.0))


def test_real_slope_near_minus_half():
    ref = reference_probability(SC, 40_000, 999)
    df = run_convergence(SC, [1000, 2000, 4000, 8000, 16000], n_seeds=10,
                         base_seed=3, reference=ref)
    slope = fit_rate(df, "empirical_std")["slope"]
    # O(N^-1/2): slope near -0.5. Loose band for a small real run.
    assert -0.75 < slope < -0.30


def test_sequential_stopping_reproducible_and_bounded():
    a = sequential_stopping(SC, tol_halfwidth=0.006, min_paths=2000,
                            max_paths=40000, batch=5000, seed=7)
    b = sequential_stopping(SC, tol_halfwidth=0.006, min_paths=2000,
                            max_paths=40000, batch=5000, seed=7)
    assert a == b
    assert 2000 <= a["paths_used"] <= 40000
    assert a["stopping_reason"] in ("tolerance met", "reached max_paths")
    if a["stopping_reason"] == "tolerance met":
        assert a["final_halfwidth"] <= 0.006 + 1e-9


def test_sequential_hits_max_when_tolerance_tiny():
    r = sequential_stopping(SC, tol_halfwidth=1e-5, min_paths=2000,
                            max_paths=15000, batch=5000, seed=1)
    assert r["stopping_reason"] == "reached max_paths"
    assert r["paths_used"] == 15000
