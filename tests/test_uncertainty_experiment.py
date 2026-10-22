"""Integration test for the uncertainty -> risk experiment pipeline."""

import pytest

from src.experiments.uncertainty_risk import DEFAULT, run


def test_pipeline_runs_and_understates():
    res = run(DEFAULT)
    est, post, risk = res["estimate"], res["posterior"], res["risk"]
    assert est.total_hands == DEFAULT["data"]["n_blocks"] * DEFAULT["data"]["block_hands"]
    assert 0.0 <= post.prob_positive <= 1.0
    # Ignoring parameter uncertainty should not *over*state risk here.
    assert risk["expected_risk"] >= risk["plug_in_risk"] - 1e-6
    assert risk["understatement_factor"] >= 1.0 - 1e-6
    for v in risk["threshold_exceedance"].values():
        assert 0.0 <= v <= 1.0


def test_skeptical_prior_lowers_prob_positive():
    cfg_emp = {**DEFAULT, "prior": {"kind": "empirical"}}
    cfg_skep = {**DEFAULT, "prior": {"kind": "skeptical", "std": 2.0}}
    p_emp = run(cfg_emp)["posterior"].prob_positive
    p_skep = run(cfg_skep)["posterior"].prob_positive
    # A skeptical prior (centered at 0) should not raise confidence in an edge.
    assert p_skep <= p_emp + 1e-9
