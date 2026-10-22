"""Regression tests for the partial-final-step ruin-timing fix.

Ruin time must map through the exact cumulative hand grid, not
``ruin_step * step_hands`` (which overstates the ruin hand when the final step
is a shorter, partial interval).
"""

import numpy as np

from src.simulation import _step_sizes, simulate_bankroll


def test_hand_grid_ends_exactly_at_n_hands():
    for n_hands, step in [(100_000, 100), (100_050, 100), (1234, 100), (777, 250)]:
        res = simulate_bankroll(
            n_paths=200, n_hands=n_hands, winrate_bb100=0.0, std_bb100=90.0,
            bankroll_bb=1000.0, seed=1, step_hands=step,
        )
        assert res["hand_grid"][0] == 0
        assert res["hand_grid"][-1] == n_hands
        assert np.all(np.diff(res["hand_grid"]) > 0)


def test_ruin_hand_never_exceeds_horizon():
    # Divisible and non-divisible horizons, high ruin rate.
    for n_hands, step in [(50_000, 100), (50_050, 100), (9_999, 100)]:
        res = simulate_bankroll(
            n_paths=3000, n_hands=n_hands, winrate_bb100=-5.0, std_bb100=120.0,
            bankroll_bb=300.0, seed=7, step_hands=step,
        )
        rh = res["ruin_hand"][res["ruined"]]
        assert np.all(rh <= n_hands)
        assert np.all(rh > 0)


def test_ruin_in_final_partial_step_maps_to_n_hands():
    # n_hands = 1050, step 100 -> final step is 50 hands (columns 0..11).
    n_hands, step = 1050, 100
    sizes = _step_sizes(n_hands, step)
    assert sizes[-1] == 50
    res = simulate_bankroll(
        n_paths=5000, n_hands=n_hands, winrate_bb100=-20.0, std_bb100=150.0,
        bankroll_bb=200.0, seed=3, step_hands=step,
    )
    grid = res["hand_grid"]
    # Every ruin hand must be one of the exact grid points and <= n_hands.
    rh = res["ruin_hand"][res["ruined"]]
    assert np.all(np.isin(rh, grid))
    assert rh.max() <= n_hands
    # The old buggy mapping (ruin_step * step_hands) could give 12*100 = 1200.
    assert rh.max() != 1200


def test_ruin_hand_matches_grid_indexing():
    res = simulate_bankroll(
        n_paths=1000, n_hands=30_050, winrate_bb100=-4.0, std_bb100=100.0,
        bankroll_bb=400.0, seed=11, step_hands=100,
    )
    grid = res["hand_grid"]
    ruined = res["ruined"]
    expected = np.where(ruined, grid[res["ruin_step"]], -1)
    assert np.array_equal(res["ruin_hand"], expected)
