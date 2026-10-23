"""Tests for frequentist edge estimation from block history."""

import warnings

import numpy as np
import pytest
from scipy import stats

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


def _drifting_blocks(n_blocks=150, seed=4):
    # Win rate stepping from +20 down to -12 bb/100 over the history.
    rng = np.random.default_rng(seed)
    hands = np.full(n_blocks, 1000.0)
    rate = np.linspace(20.0, -12.0, n_blocks)
    profit = rng.normal(rate * 10.0, 90.0 * np.sqrt(10.0))
    return hands, profit


def test_stability_check_matches_its_definition():
    hands, profit = synthetic_blocks(3.0, 90.0, 1000, 53, seed=3)
    est = estimate_edge(hands, profit)
    # 53 blocks -> 10 groups cut at floor(k * 53 / 10).
    edges = [k * 53 // 10 for k in range(11)]
    gh = np.array([hands[a:b].sum() for a, b in zip(edges, edges[1:])])
    gp = np.array([profit[a:b].sum() for a, b in zip(edges, edges[1:])])
    rate, w = 100 * gp / gh, gh / 100
    b = np.sum(w * (rate - est.winrate_bb100) ** 2)
    # Between plus within is the whole weighted residual sum of squares.
    e = 52 * est.std_bb100 ** 2 - b
    f = (b / 9) / (e / 43)
    between = np.sqrt(10 / 9 * np.sum((w / w.sum()) ** 2 * (rate - est.winrate_bb100) ** 2))
    assert est.stability_groups == 10
    assert est.stability_f == pytest.approx(f, rel=1e-10)
    assert est.stability_p == pytest.approx(1 - stats.f.cdf(f, 9, 43), rel=1e-9)
    assert est.se_between_groups == pytest.approx(between, rel=1e-12)
    assert est.stability_multiplier == pytest.approx(min(10, max(1, between / est.se_winrate)))


def test_stability_check_is_the_one_way_anova():
    # 20 blocks of 100 hands, 4 groups of 5: group means -15, -5, 5, 15 bb/100,
    # residuals -20..20. With equal weights the check is a one-way ANOVA, so
    # scipy.stats.f_oneway is an independent reference: F = 10/3, p = 0.046.
    # Reading B / sigma_hat^2 = 7.31 as chi-square(3) gave p = 0.063.
    groups = [[m + e for e in (-20, -10, 0, 10, 20)] for m in (-15, -5, 5, 15)]
    with pytest.warns(UserWarning, match="differs between 4 consecutive groups"):
        est = estimate_edge(np.full(20, 100.0), np.concatenate(groups))
    reference = stats.f_oneway(*groups)
    assert est.stability_groups == 4
    assert est.stability_f == pytest.approx(reference.statistic, rel=1e-12)
    assert est.stability_p == pytest.approx(reference.pvalue, rel=1e-9)
    assert est.stability_flag


def test_stability_check_false_alarm_rate_with_few_blocks():
    # One win rate, 20 blocks of unequal length: the F test flags about 5% of
    # histories. The chi-square reading flagged about 3.3% here (exactly
    # P(F(3, 16) > 3.73)), so a real change was missed more often too.
    rng = np.random.default_rng(11)
    runs, flags = 4000, 0
    for _ in range(runs):
        hands = rng.integers(50, 2000, size=20).astype(float)
        profit = rng.normal(3 * hands / 100, 90 * np.sqrt(hands / 100))
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            flags += estimate_edge(hands, profit).stability_flag
    se = np.sqrt(0.05 * 0.95 / runs)
    assert abs(flags / runs - 0.05) < 4 * se


def test_steady_win_rate_is_not_widened():
    hands, profit = synthetic_blocks(3.0, 90.0, 1000, 50, seed=3)
    est = estimate_edge(hands, profit)
    assert est.stability_groups == 10 and not est.stability_flag
    assert est.se_multiplier == 1.0 and est.se_winrate_adjusted == est.se_winrate


def test_drifting_win_rate_is_flagged_and_widened():
    hands, profit = _drifting_blocks()
    with pytest.warns(UserWarning, match="differs between 10 consecutive groups"):
        est = estimate_edge(hands, profit)
    assert est.stability_flag and est.stability_p < 0.05
    assert est.se_multiplier == est.stability_multiplier > 1
    assert est.se_winrate_adjusted == pytest.approx(est.se_winrate * est.se_multiplier)
    lo, hi = est.ci_low, est.ci_high
    # The order of the blocks is what the check sees: shuffled, the drift is gone.
    order = np.random.default_rng(0).permutation(hands.size)
    shuffled = estimate_edge(hands[order], profit[order])
    assert shuffled.winrate_bb100 == pytest.approx(est.winrate_bb100)
    assert not shuffled.stability_flag and shuffled.se_multiplier == 1.0
    assert hi - lo > shuffled.ci_high - shuffled.ci_low


def test_widen_choice():
    hands, profit = _drifting_blocks()
    est = estimate_edge(hands, profit, widen=False)
    assert est.stability_flag and est.se_multiplier == 1.0
    steady = synthetic_blocks(3.0, 90.0, 1000, 50, seed=3)
    always = estimate_edge(*steady, widen=True)
    assert always.se_multiplier == always.stability_multiplier >= 1.0


def test_stability_check_needs_20_blocks():
    hands, profit = synthetic_blocks(3.0, 90.0, 1000, 19, seed=3)
    with pytest.warns(UserWarning, match="stability check is not run"):
        est = estimate_edge(hands, profit)
    assert est.stability_groups == 0 and est.stability_p is None
    assert est.se_multiplier == 1.0 and est.se_winrate_adjusted == est.se_winrate


def test_as_dict_roundtrip():
    est = estimate_edge([500, 500, 500], [20.0, -5.0, 10.0])
    d = est.as_dict()
    assert d["n_blocks"] == 3 and "se_winrate" in d
