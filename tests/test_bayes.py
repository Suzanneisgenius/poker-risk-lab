"""Tests for Bayesian posterior and posterior-integrated ruin risk."""

import numpy as np
import pytest

from src.bayes import (
    Prior,
    empirical_prior,
    normal_normal_posterior,
    posterior_risk,
    skeptical_prior,
    weakly_informative_prior,
)


def test_conjugate_posterior_closed_form():
    mu_hat, se = 4.0, 3.0
    prior = Prior(mean=0.0, std=2.0)
    post = normal_normal_posterior(mu_hat, se, prior)
    # Recompute the closed form.
    pp, lp = 1 / 2.0**2, 1 / 3.0**2
    var = 1 / (pp + lp)
    mean = var * (0.0 * pp + mu_hat * lp)
    assert post.mean == pytest.approx(mean)
    assert post.std == pytest.approx(np.sqrt(var))


def test_flat_prior_equals_likelihood():
    post = normal_normal_posterior(3.0, 2.5, empirical_prior())
    assert post.mean == pytest.approx(3.0)
    assert post.std == pytest.approx(2.5)


def test_skeptical_prior_shrinks_toward_zero():
    post = normal_normal_posterior(5.0, 3.0, skeptical_prior(std=2.0))
    assert 0.0 < post.mean < 5.0     # pulled toward the prior mean (0)


def test_prob_positive_between_zero_and_one():
    post = normal_normal_posterior(1.0, 3.0, weakly_informative_prior())
    assert 0.0 <= post.prob_positive <= 1.0
    # A weak edge with large SE -> far from certain to be a winner.
    assert post.prob_positive < 0.75


def test_credible_interval_contains_mean():
    post = normal_normal_posterior(3.0, 2.0, weakly_informative_prior())
    lo, hi = post.credible_interval(0.95)
    assert lo <= post.mean <= hi


def test_posterior_integrated_risk_exceeds_plug_in():
    # Convex, decreasing risk in mu -> Jensen: E[risk] >= risk(E[mu]).
    post = normal_normal_posterior(1.5, 2.0, empirical_prior())
    out = posterior_risk(post, std_bb100=100.0, bankroll_bb=2000.0,
                         n_hands=100_000, plug_in_winrate=post.mean,
                         n_draws=8000, seed=1)
    assert out["expected_risk"] >= out["plug_in_risk"] - 1e-6
    assert out["understatement_factor"] >= 1.0 - 1e-6


def test_posterior_risk_outputs_valid_ranges():
    post = normal_normal_posterior(2.0, 2.5, weakly_informative_prior())
    out = posterior_risk(post, std_bb100=90.0, bankroll_bb=1500.0,
                         n_hands=100_000, n_draws=5000, seed=2)
    assert 0.0 <= out["expected_risk"] <= 1.0
    assert 0.0 <= out["median_risk"] <= 1.0
    for v in out["threshold_exceedance"].values():
        assert 0.0 <= v <= 1.0
    lo, hi = out["credible_intervals"]["ci_90"]
    assert 0.0 <= lo <= hi <= 1.0


def test_posterior_draws_reproducible():
    post = normal_normal_posterior(3.0, 2.0, weakly_informative_prior())
    a = posterior_risk(post, 90.0, 2000.0, 100_000, n_draws=3000, seed=42)
    b = posterior_risk(post, 90.0, 2000.0, 100_000, n_draws=3000, seed=42)
    assert a["expected_risk"] == b["expected_risk"]
