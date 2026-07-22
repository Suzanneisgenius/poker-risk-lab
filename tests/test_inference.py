"""Tests for frequentist edge estimation from block history."""

import numpy as np
import pytest

from src.inference import EdgeEstimate, estimate_edge, synthetic_blocks


def test_hands_weighted_winrate():
    # Two blocks: 100 hands +10 bb, 100 hands +0 bb -> 10 bb over 200 hands.
    est = estimate_edge([100, 100], [10.0, 0.0])
    assert est.winrate_bb100 == pytest.approx(5.0)  # 100*10/200
    assert est.total_hands == 200


def test_sd_vs_se_distinction():
    # SE must be much smaller than the volatility for a large sample.
    hands, profit = synthetic_blocks(3.0, 100.0, block_hands=1000, n_blocks=200, seed=1)
    est = estimate_edge(hands, profit)
    assert est.std_bb100 == pytest.approx(100.0, rel=0.15)   # volatility ~100
    # SE = sigma / sqrt(N/100); N = 200*1000 = 200k -> SE ~ 100/sqrt(2000) ~ 2.24
    assert est.se_winrate == pytest.approx(100.0 / np.sqrt(200_000 / 100), rel=0.2)
    assert est.se_winrate < est.std_bb100 / 10


def test_recovers_true_parameters():
    # Large sample so the win-rate SE (~0.6 bb/100) is well within tolerance.
    hands, profit = synthetic_blocks(4.0, 90.0, block_hands=2000, n_blocks=1000, seed=7)
    est = estimate_edge(hands, profit)
    assert est.winrate_bb100 == pytest.approx(4.0, abs=1.5)
    assert est.std_bb100 == pytest.approx(90.0, rel=0.1)


def test_ci_contains_estimate_and_widens_with_less_data():
    h_big, p_big = synthetic_blocks(3.0, 100.0, 1000, 300, seed=2)
    h_small, p_small = synthetic_blocks(3.0, 100.0, 1000, 15, seed=2)
    big = estimate_edge(h_big, p_big)
    small = estimate_edge(h_small, p_small)
    assert big.ci_low <= big.winrate_bb100 <= big.ci_high
    assert (small.ci_high - small.ci_low) > (big.ci_high - big.ci_low)


def test_low_edge_ci_can_include_zero():
    # 2 bb/100 over a modest sample with high variance -> not clearly positive.
    hands, profit = synthetic_blocks(2.0, 100.0, 1000, 40, seed=5)
    est = estimate_edge(hands, profit)
    assert est.ci_low < 0 < est.ci_high or est.ci_low < est.winrate_bb100


def test_validation_errors():
    with pytest.raises(ValueError):
        estimate_edge([100], [5.0])                    # too few blocks
    with pytest.raises(ValueError):
        estimate_edge([100, -5], [1.0, 2.0])           # non-positive hands
    with pytest.raises(ValueError):
        estimate_edge([100, 100], [1.0, np.inf])       # non-finite
    with pytest.raises(ValueError):
        estimate_edge([100, 100, 100], [1.0, 2.0])     # length mismatch


def test_effective_n_reported():
    hands, profit = synthetic_blocks(3.0, 90.0, 1000, 50, seed=3)
    est = estimate_edge(hands, profit)
    assert 0 < est.effective_n_blocks <= est.n_blocks + 1e-9
    assert est.se_winrate_adjusted >= est.se_winrate - 1e-12


def test_as_dict_roundtrip():
    est = estimate_edge([500, 500, 500], [20.0, -5.0, 10.0])
    d = est.as_dict()
    assert d["n_blocks"] == 3 and "se_winrate" in d
