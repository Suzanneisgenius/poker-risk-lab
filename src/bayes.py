"""Bayesian win-rate inference and posterior-integrated ruin risk.

The observed win rate is an estimate, not the truth. Treating it as known (a
"plug-in" estimate) ignores parameter uncertainty and, because ruin risk is
convex and steeply increasing as the edge falls, tends to *understate* risk.

This module places a Normal prior on the true win rate mu, forms the conjugate
Normal-Normal posterior given the estimated edge and its standard error (with a
plug-in volatility sigma), and propagates that posterior through the conditional
ruin-risk function:

    P(ruin | D) = integral P(ruin | mu, sigma, B0, H) p(mu | D) dmu,

approximated with deterministic posterior draws. It reports the plug-in risk and
the uncertainty-integrated risk side by side, with credible intervals and
threshold-exceedance probabilities.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy import stats

from src.validation import brownian_ruin_finite


@dataclass(frozen=True)
class Prior:
    """Normal prior on the win rate mu (bb/100)."""
    mean: float
    std: float
    name: str = "custom"


def skeptical_prior(std: float = 2.0) -> Prior:
    """Centered at break-even (0 bb/100): 'assume no edge until shown'."""
    return Prior(0.0, std, "skeptical")


def weakly_informative_prior(std: float = 10.0) -> Prior:
    """Centered at 0 but very diffuse: barely nudges the data."""
    return Prior(0.0, std, "weakly-informative")


def empirical_prior() -> Prior:
    """A flat prior (infinite variance): the posterior equals the likelihood."""
    return Prior(0.0, float("inf"), "empirical-flat")


@dataclass(frozen=True)
class Posterior:
    mean: float
    std: float
    prior: Prior
    prob_positive: float          # P(mu > 0 | D)

    def credible_interval(self, level: float = 0.95) -> tuple[float, float]:
        z = float(stats.norm.ppf(0.5 + level / 2))
        return (self.mean - z * self.std, self.mean + z * self.std)

    def draws(self, n: int, seed: int = 0) -> np.ndarray:
        return np.random.default_rng(seed).normal(self.mean, self.std, size=n)


def normal_normal_posterior(
    mu_hat: float, se: float, prior: Prior,
) -> Posterior:
    """Conjugate Normal-Normal update.

    Likelihood for mu is N(mu_hat, se^2) (sufficient statistic with plug-in
    volatility). With prior N(m0, t0^2):

        1/t_n^2 = 1/t0^2 + 1/se^2
        m_n     = t_n^2 (m0/t0^2 + mu_hat/se^2).
    """
    if se <= 0:
        raise ValueError("Standard error must be positive.")
    prior_prec = 0.0 if not np.isfinite(prior.std) else 1.0 / prior.std ** 2
    like_prec = 1.0 / se ** 2
    post_prec = prior_prec + like_prec
    post_var = 1.0 / post_prec
    post_mean = post_var * (prior.mean * prior_prec + mu_hat * like_prec)
    post_std = float(np.sqrt(post_var))
    prob_pos = float(stats.norm.cdf(post_mean / post_std)) if post_std > 0 else float(post_mean > 0)
    return Posterior(float(post_mean), post_std, prior, prob_pos)


def conditional_ruin_risk(
    winrate_bb100: float, std_bb100: float, bankroll_bb: float,
    n_hands: int, ruin_threshold_bb: float = 0.0,
) -> float:
    """P(ruin | mu, ...) via the finite-horizon Brownian first-passage formula.

    Deterministic and smooth, which makes it ideal for integrating over many
    posterior draws (no Monte Carlo noise inside the integral).
    """
    return brownian_ruin_finite(
        winrate_bb100, std_bb100, bankroll_bb, n_hands, ruin_threshold_bb
    )["probability"]


def posterior_risk(
    posterior: Posterior,
    std_bb100: float,
    bankroll_bb: float,
    n_hands: int,
    ruin_threshold_bb: float = 0.0,
    plug_in_winrate: float | None = None,
    n_draws: int = 20_000,
    seed: int = 0,
    thresholds: tuple[float, ...] = (0.05, 0.10, 0.25),
    credible_levels: tuple[float, ...] = (0.50, 0.80, 0.90, 0.95),
) -> dict[str, Any]:
    """Propagate posterior uncertainty in mu into the ruin-risk distribution.

    ``plug_in_winrate`` defaults to the posterior mean; pass the raw estimate
    mu_hat to compare the naive plug-in risk against the integrated risk.
    """
    mus = posterior.draws(n_draws, seed=seed)
    risks = np.array([
        conditional_ruin_risk(m, std_bb100, bankroll_bb, n_hands, ruin_threshold_bb)
        for m in mus
    ])

    plug_mu = posterior.mean if plug_in_winrate is None else plug_in_winrate
    plug_in = conditional_ruin_risk(plug_mu, std_bb100, bankroll_bb, n_hands,
                                    ruin_threshold_bb)

    ci = {}
    for lvl in credible_levels:
        a = (1 - lvl) / 2
        lo, hi = np.quantile(risks, [a, 1 - a])
        ci[f"ci_{int(lvl*100)}"] = (float(lo), float(hi))

    exceed = {f"p_risk_gt_{int(t*100)}pct": float(np.mean(risks > t))
              for t in thresholds}

    return {
        "plug_in_risk": float(plug_in),
        "plug_in_winrate": float(plug_mu),
        "expected_risk": float(risks.mean()),
        "median_risk": float(np.median(risks)),
        "risk_std": float(risks.std(ddof=1)),
        "credible_intervals": ci,
        "threshold_exceedance": exceed,
        "n_draws": n_draws,
        "understatement_factor": float(risks.mean() / plug_in) if plug_in > 0 else float("nan"),
        "_risk_draws": risks,   # for plotting; not part of the headline summary
        "_mu_draws": mus,
    }
