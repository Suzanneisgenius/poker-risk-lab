"""Stochastic increment models for model-misspecification stress testing.

All models share one interface:

    model(rng, n_paths, sizes, winrate_bb100, std_bb100, **params)
        -> (increments[n_paths, n_steps], info: dict)

Every model is calibrated to the **same per-step mean** and, where the model has
finite variance under our control, the **same marginal variance** as the Gaussian
baseline. That way differences in ruin risk isolate *higher moments* (heavy
tails, shocks) or *serial dependence* (regime clustering, autocorrelation) rather
than a trivial change in edge or volatility.

None of these alternatives is claimed to be the true poker-generating process.
They are controlled model-risk scenarios.
"""

from __future__ import annotations

from typing import Any, Callable

import numpy as np


def _mean_std(sizes: np.ndarray, mu: float, sigma: float) -> tuple[np.ndarray, np.ndarray]:
    step_mean = mu * sizes / 100.0
    step_std = sigma * np.sqrt(sizes / 100.0)
    return step_mean, step_std


def gaussian(rng, n_paths, sizes, mu, sigma, **_) -> tuple[np.ndarray, dict]:
    """Model A — Gaussian i.i.d. baseline."""
    m, s = _mean_std(sizes, mu, sigma)
    z = rng.standard_normal((n_paths, sizes.size))
    return m[None, :] + s[None, :] * z, {}


def student_t(rng, n_paths, sizes, mu, sigma, df: float = 4.0, **_) -> tuple[np.ndarray, dict]:
    """Model B — Student-t heavy tails, rescaled to match the baseline variance."""
    if df <= 2:
        raise ValueError("Student-t df must be > 2 for finite variance.")
    m, s = _mean_std(sizes, mu, sigma)
    t = rng.standard_t(df, (n_paths, sizes.size))
    z = t / np.sqrt(df / (df - 2.0))          # standardize to unit variance
    return m[None, :] + s[None, :] * z, {"df": df}


def shock_mixture(rng, n_paths, sizes, mu, sigma, p: float = 0.03,
                  shock_mean: float = -4.0, shock_scale: float = 2.5,
                  **_) -> tuple[np.ndarray, dict]:
    """Model D — rare adverse shocks mixed into a Gaussian, variance-matched.

    With probability ``p`` an interval draws an adverse shock (negative mean,
    larger scale); the base component's mean is set so the mixture mean is 0,
    and the whole innovation is rescaled to unit variance.
    """
    if not 0 < p < 1:
        raise ValueError("p must be in (0, 1).")
    m, s = _mean_std(sizes, mu, sigma)
    base_mean = -p * shock_mean / (1 - p)      # so E[innovation] = 0
    var = (1 - p) * (base_mean ** 2 + 1.0) + p * (shock_mean ** 2 + shock_scale ** 2)
    u = rng.random((n_paths, sizes.size))
    is_shock = u < p
    z = np.where(is_shock,
                 rng.normal(shock_mean, shock_scale, (n_paths, sizes.size)),
                 rng.normal(base_mean, 1.0, (n_paths, sizes.size)))
    z = z / np.sqrt(var)                       # unit variance
    return m[None, :] + s[None, :] * z, {"p": p, "shock_share": float(is_shock.mean())}


def ar1(rng, n_paths, sizes, mu, sigma, phi: float = 0.3, **_) -> tuple[np.ndarray, dict]:
    """Model E — AR(1) standardized innovations: same mean & variance, added dependence.

    ``z_k = phi z_{k-1} + e_k`` with ``e_k ~ N(0, 1-phi^2)`` so the marginal
    variance stays 1. This isolates the effect of serial dependence at a fixed
    edge and volatility. (A stress-test abstraction; hand results are not
    literally AR(1).)
    """
    if not -1 < phi < 1:
        raise ValueError("phi must be in (-1, 1).")
    n = sizes.size
    m, s = _mean_std(sizes, mu, sigma)
    e = rng.normal(0.0, np.sqrt(1 - phi ** 2), (n_paths, n))
    z = np.empty((n_paths, n))
    z[:, 0] = rng.standard_normal(n_paths)
    for k in range(1, n):
        z[:, k] = phi * z[:, k - 1] + e[:, k]
    return m[None, :] + s[None, :] * z, {"phi": phi}


def regime_switching(rng, n_paths, sizes, mu, sigma,
                     p_stay_normal: float = 0.98, p_stay_adverse: float = 0.90,
                     mu_adverse: float = -5.0, vol_mult: float = 1.6,
                     **_) -> tuple[np.ndarray, dict]:
    """Model C — two-state regime switching with a clustered adverse regime.

    The normal-regime drift is calibrated so the *stationary* mean equals the
    baseline win rate ``mu``. The adverse regime has a lower drift and higher
    volatility, and it persists (clusters), which fattens the loss tail even
    though the long-run edge is unchanged. Marginal variance is reported, not
    forced, because volatility clustering is the very effect under study.
    """
    n = sizes.size
    pi_adverse = (1 - p_stay_normal) / ((1 - p_stay_normal) + (1 - p_stay_adverse))
    pi_normal = 1 - pi_adverse
    mu_normal = (mu - pi_adverse * mu_adverse) / pi_normal

    # Simulate the regime chain (0 = normal, 1 = adverse) per path.
    states = np.empty((n_paths, n), dtype=np.int8)
    states[:, 0] = (rng.random(n_paths) < pi_adverse).astype(np.int8)
    for k in range(1, n):
        u = rng.random(n_paths)
        prev = states[:, k - 1]
        stay = np.where(prev == 0, p_stay_normal, p_stay_adverse)
        states[:, k] = np.where(u < stay, prev, 1 - prev)

    drift = np.where(states == 0, mu_normal, mu_adverse)     # bb/100 per step
    vol = np.where(states == 0, sigma, sigma * vol_mult)     # bb/100
    step_mean = drift * sizes[None, :] / 100.0
    step_std = vol * np.sqrt(sizes[None, :] / 100.0)
    z = rng.standard_normal((n_paths, n))
    incr = step_mean + step_std * z
    return incr, {
        "pi_adverse_theoretical": float(pi_adverse),
        "adverse_occupancy": float((states == 1).mean()),
        "mu_normal": float(mu_normal),
    }


MODELS: dict[str, Callable] = {
    "gaussian": gaussian,
    "student_t": student_t,
    "shock_mixture": shock_mixture,
    "ar1": ar1,
    "regime_switching": regime_switching,
}


# ---------------------------------------------------------------------------
# Absorbed-path simulation over arbitrary increments
# ---------------------------------------------------------------------------


def summarize_increments(increments: np.ndarray, bankroll_bb: float,
                         threshold: float, step_hands: int) -> dict[str, Any]:
    """Absorbing-ruin summary for a chunk of increment paths (vectorized)."""
    m, n_steps = increments.shape
    n_cols = n_steps + 1
    raw = np.empty((m, n_cols))
    raw[:, 0] = bankroll_bb
    np.cumsum(increments, axis=1, out=raw[:, 1:])
    raw[:, 1:] += bankroll_bb
    breached = raw <= threshold
    ruined = breached.any(axis=1)
    first = np.where(ruined, breached.argmax(axis=1), -1)
    col = np.arange(n_cols)
    after = (col[None, :] >= first[:, None]) & ruined[:, None]
    clipped = raw.copy()
    clipped[after] = threshold
    peak = np.maximum.accumulate(clipped, axis=1)
    mdd = (peak - clipped).max(axis=1)
    terminal = clipped[:, -1]
    ruin_hand = np.where(ruined, first * step_hands, -1)
    return {"ruined": ruined, "terminal": terminal, "max_drawdown": mdd,
            "ruin_hand": ruin_hand}


def run_model(model_key: str, winrate_bb100: float, std_bb100: float,
              bankroll_bb: float, n_hands: int, ruin_threshold_bb: float = 0.0,
              n_paths: int = 20000, seed: int = 0, step_hands: int = 100,
              chunk_paths: int = 4000, params: dict | None = None) -> dict[str, Any]:
    """Run one model and return risk / drawdown / growth / timing summaries."""
    from src.simulation import _step_sizes
    sizes = np.asarray(_step_sizes(n_hands, step_hands), dtype=np.float64)
    model = MODELS[model_key]
    rng = np.random.default_rng(seed)
    params = params or {}

    ruined = np.empty(n_paths, dtype=bool)
    terminal = np.empty(n_paths)
    mdd = np.empty(n_paths)
    ruin_hand = np.empty(n_paths)
    info_acc: dict[str, float] = {}
    start = 0
    while start < n_paths:
        m = min(chunk_paths, n_paths - start)
        incr, info = model(rng, m, sizes, winrate_bb100, std_bb100, **params)
        s = summarize_increments(incr, bankroll_bb, ruin_threshold_bb, step_hands)
        sl = slice(start, start + m)
        ruined[sl], terminal[sl] = s["ruined"], s["terminal"]
        mdd[sl], ruin_hand[sl] = s["max_drawdown"], s["ruin_hand"]
        for k, v in info.items():
            info_acc[k] = info_acc.get(k, 0.0) + v * m
        start += m
    for k in info_acc:
        info_acc[k] /= n_paths

    rh = ruin_hand[ruined]
    return {
        "model": model_key,
        "risk_of_ruin": float(ruined.mean()),
        "mean_max_drawdown": float(mdd.mean()),
        "p95_max_drawdown": float(np.percentile(mdd, 95)),
        "median_terminal": float(np.median(terminal)),
        "p05_terminal": float(np.percentile(terminal, 5)),
        "median_time_to_ruin": float(np.median(rh)) if rh.size else float("nan"),
        "realized_mean_increment": float(np.mean(terminal - bankroll_bb) / n_hands * 100),
        "info": info_acc,
    }
