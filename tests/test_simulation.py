"""Tests for the Monte Carlo simulation engine."""

import numpy as np
import pytest

from src.simulation import (
    SimulationConfig,
    _step_sizes,
    simulate_bankroll,
    simulate_from_config,
)

BASE = dict(
    n_paths=2000,
    n_hands=50_000,
    winrate_bb100=3.0,
    std_bb100=90.0,
    bankroll_bb=2000.0,
    ruin_threshold_bb=0.0,
    step_hands=100,
)


def run(**overrides):
    params = {**BASE, **overrides}
    return simulate_bankroll(seed=params.pop("seed", 42), **params)


def test_identical_seed_identical_output():
    a = run(seed=7)
    b = run(seed=7)
    assert np.array_equal(a["terminal_bankroll"], b["terminal_bankroll"])
    assert np.array_equal(a["ruined"], b["ruined"])


def test_different_seed_differs():
    a = run(seed=1)
    b = run(seed=2)
    assert not np.array_equal(a["terminal_bankroll"], b["terminal_bankroll"])


def test_ruined_paths_are_absorbed():
    # Negative edge to force many ruins.
    res = run(winrate_bb100=-5.0, bankroll_bb=500.0, seed=3)
    paths = res["bankroll_paths"]
    ruined = res["ruined"][: paths.shape[0]]
    thr = res["parameters"]["ruin_threshold_bb"]
    for i in np.where(ruined)[0]:
        step = res["ruin_step"][i]
        # Everything at/after the ruin step sits exactly at the threshold.
        assert np.allclose(paths[i, step:], thr)
        # And it never rises back above the threshold afterwards.
        assert np.all(paths[i, step:] <= thr + 1e-9)


def test_ruin_step_recorded_correctly():
    res = run(winrate_bb100=-5.0, bankroll_bb=400.0, seed=5)
    paths = res["bankroll_paths"]
    thr = res["parameters"]["ruin_threshold_bb"]
    for i in np.where(res["ruined"][: paths.shape[0]])[0]:
        step = res["ruin_step"][i]
        assert step >= 1
        # The step before ruin was above threshold (raw path crossed here).
        assert paths[i, step - 1] > thr


def test_survivors_have_ruin_step_minus_one():
    res = run(winrate_bb100=10.0, bankroll_bb=5000.0, seed=9)
    survivors = ~res["ruined"]
    assert np.all(res["ruin_step"][survivors] == -1)
    assert np.all(res["ruin_hand"][survivors] == -1)


def test_terminal_consistency_with_paths():
    res = run(seed=11)
    paths = res["bankroll_paths"]
    n = paths.shape[0]
    assert np.allclose(res["terminal_bankroll"][:n], paths[:, -1])


def test_shapes():
    res = run(seed=4)
    n = BASE["n_paths"]
    n_cols = BASE["n_hands"] // BASE["step_hands"] + 1
    assert res["ruined"].shape == (n,)
    assert res["terminal_bankroll"].shape == (n,)
    assert res["bankroll_paths"].shape[1] == n_cols


def test_step_scaling_mean_matches_theory():
    # With no ruin possible (huge bankroll), mean terminal ~ start + edge*hands.
    res = simulate_bankroll(
        n_paths=40_000, n_hands=100_000, winrate_bb100=5.0, std_bb100=90.0,
        bankroll_bb=1_000_000.0, ruin_threshold_bb=0.0, seed=42,
    )
    expected_growth = 5.0 * 100_000 / 100.0  # bb
    got = res["terminal_bankroll"].mean() - 1_000_000.0
    assert got == pytest.approx(expected_growth, rel=0.05)


def test_partial_final_step_handled():
    sizes = _step_sizes(1050, 100)
    assert sizes == [100] * 10 + [50]
    res = simulate_bankroll(
        n_paths=100, n_hands=1050, winrate_bb100=2.0, std_bb100=80.0,
        bankroll_bb=3000.0, seed=1, step_hands=100,
    )
    assert res["bankroll_paths"].shape[1] == 12  # 11 steps + start


def test_chunked_matches_unchunked():
    common = dict(
        n_paths=3000, n_hands=20_000, winrate_bb100=2.0, std_bb100=85.0,
        bankroll_bb=1500.0, seed=123, step_hands=100,
    )
    full = simulate_bankroll(**common, chunk_paths=None, max_memory_gb=8.0)
    chunked = simulate_bankroll(**common, chunk_paths=500)
    # Full-array RNG draw differs from chunked draw order, so exact equality is
    # not expected; instead the ruin rate must agree closely.
    assert full["ruined"].mean() == pytest.approx(
        chunked["ruined"].mean(), abs=0.02
    )


def test_zero_variance_is_deterministic():
    res = simulate_bankroll(
        n_paths=50, n_hands=10_000, winrate_bb100=1.0, std_bb100=0.0,
        bankroll_bb=100.0, seed=1,
    )
    assert res["ruined"].sum() == 0
    # Every path identical and linear.
    assert np.allclose(res["terminal_bankroll"], res["terminal_bankroll"][0])


def test_config_validation():
    with pytest.raises(ValueError):
        SimulationConfig(1000, 10_000, 3.0, 90.0, 100.0, 200.0).validate()
    with pytest.raises(ValueError):
        SimulationConfig(0, 10_000, 3.0, 90.0, 100.0).validate()
    with pytest.raises(ValueError):
        SimulationConfig(10, 50, 3.0, 90.0, 100.0, step_hands=100).validate()


def test_simulate_from_config_equivalent():
    cfg = SimulationConfig(500, 10_000, 3.0, 90.0, 1500.0, seed=8)
    a = simulate_from_config(cfg)
    b = simulate_bankroll(500, 10_000, 3.0, 90.0, 1500.0, seed=8)
    assert np.array_equal(a["terminal_bankroll"], b["terminal_bankroll"])
