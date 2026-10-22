"""Edge-case tests across the engine and analytics."""

import numpy as np
import pytest

from src.analytics import drawdown_analytics, estimate_risk_of_ruin
from src.simulation import simulate_bankroll


def sim(**kw):
    base = dict(
        n_paths=1000, n_hands=10_000, winrate_bb100=2.0, std_bb100=90.0,
        bankroll_bb=1000.0, seed=42,
    )
    base.update(kw)
    return simulate_bankroll(**base)


def test_zero_winrate():
    res = sim(winrate_bb100=0.0)
    assert 0.0 <= estimate_risk_of_ruin(res)["point_estimate"] <= 1.0


def test_negative_winrate_higher_ruin():
    low = sim(winrate_bb100=5.0, bankroll_bb=500.0)["ruined"].mean()
    high = sim(winrate_bb100=-5.0, bankroll_bb=500.0)["ruined"].mean()
    assert high > low


def test_very_high_variance():
    res = sim(std_bb100=400.0, bankroll_bb=500.0)
    assert res["ruined"].mean() > 0


def test_tiny_bankroll_mostly_ruins():
    res = sim(bankroll_bb=20.0, winrate_bb100=0.0, std_bb100=90.0)
    assert res["ruined"].mean() > 0.5


def test_bankroll_near_threshold():
    res = simulate_bankroll(
        n_paths=500, n_hands=5000, winrate_bb100=1.0, std_bb100=90.0,
        bankroll_bb=101.0, ruin_threshold_bb=100.0, seed=1,
    )
    assert res["ruined"].mean() > 0.5


def test_zero_variance_no_ruin_with_positive_edge():
    res = sim(std_bb100=0.0, winrate_bb100=1.0)
    assert res["ruined"].sum() == 0


def test_short_horizon():
    res = simulate_bankroll(
        n_paths=200, n_hands=100, winrate_bb100=2.0, std_bb100=90.0,
        bankroll_bb=1000.0, seed=1, step_hands=100,
    )
    assert res["bankroll_paths"].shape[1] == 2


def test_large_horizon_runs():
    res = simulate_bankroll(
        n_paths=200, n_hands=1_000_000, winrate_bb100=3.0, std_bb100=90.0,
        bankroll_bb=3000.0, seed=1,
    )
    assert res["terminal_bankroll"].shape == (200,)


def test_single_path():
    res = sim(n_paths=1)
    assert res["ruined"].shape == (1,)
    assert res["terminal_bankroll"].shape == (1,)


def test_custom_nonzero_threshold():
    res = simulate_bankroll(
        n_paths=1000, n_hands=20_000, winrate_bb100=1.0, std_bb100=90.0,
        bankroll_bb=1500.0, ruin_threshold_bb=500.0, seed=2,
    )
    thr = 500.0
    # Terminal for ruined paths equals the threshold exactly.
    ruined = res["ruined"]
    assert np.allclose(res["terminal_bankroll"][ruined], thr)
    dd = drawdown_analytics(res)
    assert dd["p95_max_drawdown"] >= 0


def test_drawdown_pct_safe_after_ruin():
    res = sim(winrate_bb100=-5.0, bankroll_bb=300.0)
    # No infs / spurious values in percentage drawdown.
    assert np.all(np.isfinite(res["max_drawdown_pct"]))


def test_memory_guard_raises_when_absurd():
    with pytest.raises(MemoryError):
        simulate_bankroll(
            n_paths=10_000_000, n_hands=1_000_000, winrate_bb100=1.0,
            std_bb100=90.0, bankroll_bb=1000.0, seed=1, max_memory_gb=0.001,
            chunk_paths=10_000_000,
        )
