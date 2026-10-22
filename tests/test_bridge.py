"""Tests for continuous ruin monitoring (Brownian-bridge correction) in the engine."""

import numpy as np
import pytest

from src.simulation import SimulationConfig, simulate_bankroll, simulate_from_config
from src.validation import brownian_ruin_finite

SHORT = dict(n_paths=40_000, n_hands=20_000, winrate_bb100=0.0, std_bb100=90.0,
             bankroll_bb=300.0, seed=11, store_n_paths=0)


def _z(rate, benchmark, n):
    return (rate - benchmark) / np.sqrt(benchmark * (1 - benchmark) / n)


def test_bridge_is_the_default():
    res = simulate_bankroll(n_paths=10, n_hands=1000, winrate_bb100=0.0,
                            std_bb100=90.0, bankroll_bb=300.0)
    assert res["parameters"]["bridge"] is True
    assert SimulationConfig(10, 1000, 0.0, 90.0, 300.0).bridge is True


def test_endpoint_only_reproduces_previous_engine():
    # Recorded from the engine before the bridge correction existed.
    for kwargs, expected in [
        (dict(n_paths=5000, n_hands=100_000, winrate_bb100=0.0, std_bb100=90.0,
              bankroll_bb=3000.0, seed=42),
         (1401, 738955, 15411739.277814854, 15104908.001133833)),
        (dict(n_paths=3000, n_hands=25_050, winrate_bb100=-1.0, std_bb100=100.0,
              bankroll_bb=800.0, ruin_threshold_bb=100.0, seed=7),
         (2049, 154322, 2114251.0069336705, 3528494.6789226104)),
    ]:
        res = simulate_bankroll(**kwargs, bridge=False)
        assert int(res["ruined"].sum()) == expected[0]
        assert int(res["ruin_step"].sum()) == expected[1]
        assert float(res["terminal_bankroll"].sum()) == pytest.approx(expected[2], rel=1e-12)
        assert float(res["max_drawdown"].sum()) == pytest.approx(expected[3], rel=1e-12)


def test_bridge_matches_continuous_benchmark_and_endpoint_does_not():
    benchmark = brownian_ruin_finite(0.0, 90.0, 300.0, 20_000)["probability"]
    bridged = simulate_bankroll(**SHORT)["ruined"].mean()
    endpoint = simulate_bankroll(**SHORT, bridge=False)["ruined"].mean()
    assert abs(_z(bridged, benchmark, SHORT["n_paths"])) < 4
    assert _z(endpoint, benchmark, SHORT["n_paths"]) < -10


@pytest.mark.parametrize("step_hands", [100, 500, 2000])
def test_bridge_removes_dependence_on_step_size(step_hands):
    # Coarser steps miss more intrastep dips; the bridge accounts for them, so
    # the estimate stays on the continuous benchmark at every resolution.
    params = dict(n_paths=40_000, n_hands=100_000, winrate_bb100=2.0,
                  std_bb100=90.0, bankroll_bb=1500.0, seed=5, store_n_paths=0,
                  step_hands=step_hands)
    benchmark = brownian_ruin_finite(2.0, 90.0, 1500.0, 100_000)["probability"]
    assert abs(_z(simulate_bankroll(**params)["ruined"].mean(), benchmark, 40_000)) < 4
    endpoint_z = _z(simulate_bankroll(**params, bridge=False)["ruined"].mean(), benchmark, 40_000)
    assert endpoint_z < (-4 if step_hands >= 500 else 0)


def test_bridge_only_adds_ruin_on_the_same_paths():
    # The bridge uses its own random stream, so the Normal increments are the
    # same: every endpoint ruin is still a ruin, at the same step or earlier.
    params = dict(n_paths=5000, n_hands=50_000, winrate_bb100=1.0,
                  std_bb100=100.0, bankroll_bb=1500.0, ruin_threshold_bb=300.0, seed=3)
    bridged = simulate_bankroll(**params)
    endpoint = simulate_bankroll(**params, bridge=False)
    assert np.all(bridged["ruined"][endpoint["ruined"]])
    both = endpoint["ruined"]
    assert np.all(bridged["ruin_step"][both] <= endpoint["ruin_step"][both])
    assert bridged["ruined"].sum() > endpoint["ruined"].sum()
    # Paths the bridge never touched are identical.
    untouched = ~bridged["ruined"]
    np.testing.assert_array_equal(bridged["terminal_bankroll"][untouched],
                                  endpoint["terminal_bankroll"][untouched])


def test_bridge_ruin_is_absorbed_at_the_step_end():
    res = simulate_bankroll(n_paths=3000, n_hands=30_000, winrate_bb100=0.0,
                            std_bb100=90.0, bankroll_bb=400.0, ruin_threshold_bb=100.0,
                            seed=9, store_n_paths=3000)
    ruined = res["ruined"]
    paths = res["bankroll_paths"]
    for i in np.flatnonzero(ruined)[:200]:
        step = res["ruin_step"][i]
        assert np.all(paths[i, step:] == 100.0)
        assert np.all(paths[i, :step] > 100.0)
        assert res["ruin_hand"][i] == res["hand_grid"][step]
    assert np.all(res["terminal_bankroll"][ruined] == 100.0)


def test_bridge_is_independent_of_chunking_and_reproducible():
    common = dict(n_paths=3000, n_hands=40_000, winrate_bb100=1.0, std_bb100=90.0,
                  bankroll_bb=800.0, seed=21)
    full = simulate_bankroll(**common, chunk_paths=None, max_memory_gb=8.0)
    chunked = simulate_bankroll(**common, chunk_paths=700)
    for key in ("ruined", "ruin_step", "terminal_bankroll", "max_drawdown"):
        np.testing.assert_array_equal(full[key], chunked[key])
    again = simulate_bankroll(**common)
    np.testing.assert_array_equal(full["ruin_step"], again["ruin_step"])
    other = simulate_bankroll(**{**common, "seed": 22})
    assert not np.array_equal(full["ruin_step"], other["ruin_step"])


def test_bridge_with_partial_final_step():
    res = simulate_bankroll(n_paths=4000, n_hands=10_050, winrate_bb100=0.0,
                            std_bb100=90.0, bankroll_bb=200.0, seed=4)
    assert res["step_sizes"][-1] == 50
    benchmark = brownian_ruin_finite(0.0, 90.0, 200.0, 10_050)["probability"]
    assert abs(_z(res["ruined"].mean(), benchmark, 4000)) < 4
    assert res["ruin_hand"][res["ruined"]].max() <= 10_050


def test_zero_variance_has_no_bridge_crossings_or_warnings():
    with np.errstate(all="raise"):
        up = simulate_bankroll(n_paths=50, n_hands=5000, winrate_bb100=5.0,
                               std_bb100=0.0, bankroll_bb=100.0, seed=1)
        down = simulate_bankroll(n_paths=50, n_hands=5000, winrate_bb100=-5.0,
                                 std_bb100=0.0, bankroll_bb=100.0, seed=1)
    assert not up["ruined"].any()
    assert down["ruined"].all()
    assert np.all(down["ruin_hand"] == 2000)


def test_config_bridge_flag_flows_through_simulate_from_config():
    cfg = SimulationConfig(n_paths=4000, n_hands=20_000, winrate_bb100=0.0,
                           std_bb100=90.0, bankroll_bb=300.0, seed=2, bridge=False)
    endpoint = simulate_from_config(cfg)
    assert endpoint["parameters"]["bridge"] is False
    bridged = simulate_from_config(cfg, bridge=True)
    assert bridged["ruined"].sum() > endpoint["ruined"].sum()
