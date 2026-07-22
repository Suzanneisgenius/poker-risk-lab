"""Statistical tests for the increment models and the stress-test runner."""

import numpy as np
import pytest
from scipy import stats

from src.models import MODELS, run_model

SIZES = np.array([100.0] * 400)   # 400 steps of 100 hands
MU, SIGMA = 2.0, 90.0


def _increments(key, n_paths=6000, seed=1, **params):
    rng = np.random.default_rng(seed)
    incr, info = MODELS[key](rng, n_paths, SIZES, MU, SIGMA, **params)
    return incr, info


def test_gaussian_matches_moments():
    incr, _ = _increments("gaussian")
    # Per step (100 hands): mean = mu*1 = 2, std = sigma*1 = 90.
    assert incr.mean() == pytest.approx(MU, abs=0.5)
    assert incr.std() == pytest.approx(SIGMA, rel=0.05)


def test_student_t_variance_matched_but_heavier_tails():
    g, _ = _increments("gaussian")
    t, _ = _increments("student_t", df=4.0)
    assert t.std() == pytest.approx(SIGMA, rel=0.06)         # variance matched
    # Excess kurtosis of Student-t exceeds Gaussian's ~0.
    assert stats.kurtosis(t.ravel()) > stats.kurtosis(g.ravel()) + 0.5


def test_shock_mixture_variance_matched():
    s, info = _increments("shock_mixture", p=0.03, shock_mean=-4.0, shock_scale=2.5)
    assert s.std() == pytest.approx(SIGMA, rel=0.06)
    assert s.mean() == pytest.approx(MU, abs=0.7)
    assert 0.01 < info["shock_share"] < 0.06


def test_ar1_variance_matched_and_autocorrelated():
    a, info = _increments("ar1", phi=0.4)
    assert a.std() == pytest.approx(SIGMA, rel=0.06)         # marginal variance
    # Standardized series lag-1 autocorrelation should be near phi.
    z = (a - a.mean()) / a.std()
    rho = np.mean([np.corrcoef(z[i, :-1], z[i, 1:])[0, 1] for i in range(z.shape[0])])
    assert rho == pytest.approx(0.4, abs=0.08)


def test_regime_switching_mean_calibrated():
    r, info = _increments("regime_switching", n_paths=8000,
                          p_stay_normal=0.98, p_stay_adverse=0.90,
                          mu_adverse=-5.0, vol_mult=1.6)
    # Stationary mean is calibrated to the baseline edge.
    assert r.mean() == pytest.approx(MU, abs=0.8)
    assert info["adverse_occupancy"] == pytest.approx(info["pi_adverse_theoretical"], abs=0.03)


def test_student_t_requires_finite_variance():
    with pytest.raises(ValueError):
        _increments("student_t", df=2.0)


def test_run_model_reproducible_and_valid():
    a = run_model("regime_switching", MU, SIGMA, 1500.0, 40000, n_paths=3000, seed=5)
    b = run_model("regime_switching", MU, SIGMA, 1500.0, 40000, n_paths=3000, seed=5)
    assert a["risk_of_ruin"] == b["risk_of_ruin"]
    assert 0.0 <= a["risk_of_ruin"] <= 1.0
    assert a["p95_max_drawdown"] >= 0


def test_dependence_raises_ruin_vs_gaussian():
    # At a thin bankroll, AR(1) positive dependence should not reduce ruin risk.
    g = run_model("gaussian", MU, SIGMA, 1500.0, 100000, n_paths=8000, seed=3)
    a = run_model("ar1", MU, SIGMA, 1500.0, 100000, n_paths=8000, seed=3,
                  params={"phi": 0.4})
    assert a["risk_of_ruin"] > g["risk_of_ruin"]
