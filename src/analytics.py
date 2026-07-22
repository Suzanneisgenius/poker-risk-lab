"""Pure, independently testable analytics over simulation results.

Every function here takes the ``dict`` returned by
:func:`src.simulation.simulate_bankroll` (or the raw arrays) and returns plain
Python / NumPy values. No plotting, no global state, no RNG except the
explicit, seeded bootstrap.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy import stats

# ---------------------------------------------------------------------------
# 4.1 Risk of ruin
# ---------------------------------------------------------------------------


def estimate_risk_of_ruin(
    result: dict[str, Any],
    confidence_level: float = 0.95,
    n_bootstrap: int = 2000,
    seed: int | None = None,
    method: str = "wilson",
) -> dict[str, Any]:
    """Estimate P(ruin) with a confidence interval.

    Ruin is a Bernoulli outcome per path, so the Wilson score interval is the
    default: it is exact-in-distribution to first order, well-behaved near 0 and
    1, and needs no resampling. The nonparametric bootstrap is retained as an
    option but is *not* the default because it allocates an
    ``(n_bootstrap, n_paths)`` index matrix — O(n_bootstrap * n_paths) memory
    that is wasteful for a single proportion.

    Parameters
    ----------
    method:
        ``"wilson"`` (default, alias ``"binomial"``) — Wilson score interval.
        ``"bootstrap"`` — path-level nonparametric resampling (memory-heavy).

    Returns point estimate, CI, standard error, counts, and the method used.
    """
    ruined = np.asarray(result["ruined"], dtype=bool)
    n = ruined.size
    if n == 0:
        raise ValueError("No paths to estimate risk of ruin from.")
    n_ruined = int(ruined.sum())
    p_hat = n_ruined / n
    alpha = 1.0 - confidence_level

    if method == "bootstrap":
        rng = np.random.default_rng(seed)
        # Resample path outcomes in chunks to avoid an (n_bootstrap, n) matrix.
        boot = np.empty(n_bootstrap, dtype=np.float64)
        chunk = max(1, min(n_bootstrap, 4_000_000 // max(n, 1)))
        for start in range(0, n_bootstrap, chunk):
            stop = min(start + chunk, n_bootstrap)
            idx = rng.integers(0, n, size=(stop - start, n))
            boot[start:stop] = ruined[idx].mean(axis=1)
        lo, hi = np.quantile(boot, [alpha / 2, 1 - alpha / 2])
        se = float(boot.std(ddof=1))
    elif method in ("binomial", "wilson"):
        # Wilson score interval — well-behaved near 0 and 1.
        z = float(stats.norm.ppf(1 - alpha / 2))
        denom = 1 + z**2 / n
        center = (p_hat + z**2 / (2 * n)) / denom
        half = (
            z
            * np.sqrt(p_hat * (1 - p_hat) / n + z**2 / (4 * n**2))
            / denom
        )
        lo, hi = center - half, center + half
        se = float(np.sqrt(p_hat * (1 - p_hat) / n))
    else:
        raise ValueError(f"Unknown method: {method!r}")

    return {
        "point_estimate": float(p_hat),
        "ci_low": float(max(0.0, lo)),
        "ci_high": float(min(1.0, hi)),
        "confidence_level": float(confidence_level),
        "standard_error": se,
        "n_ruined": n_ruined,
        "n_paths": int(n),
        "method": method,
    }


# ---------------------------------------------------------------------------
# 4.2 Drawdown analytics
# ---------------------------------------------------------------------------


def drawdown_analytics(result: dict[str, Any]) -> dict[str, Any]:
    """Percentile summary of maximum drawdown (bb, from prior peak).

    Ruined paths are *not* treated as recovered; their max drawdown is
    measured on the absorbed path (drawdown to the ruin threshold).
    """
    mdd = np.asarray(result["max_drawdown"], dtype=np.float64)
    ruined = np.asarray(result["ruined"], dtype=bool)
    terminal = np.asarray(result["terminal_bankroll"], dtype=np.float64)
    start = float(result["parameters"]["bankroll_bb"])

    survivors = ~ruined
    finished_below = terminal[survivors] < start

    return {
        "median_max_drawdown": float(np.median(mdd)),
        "p75_max_drawdown": float(np.percentile(mdd, 75)),
        "p90_max_drawdown": float(np.percentile(mdd, 90)),
        "p95_max_drawdown": float(np.percentile(mdd, 95)),
        "p99_max_drawdown": float(np.percentile(mdd, 99)),
        "mean_max_drawdown": float(mdd.mean()),
        "prop_survivors_below_start": (
            float(finished_below.mean()) if survivors.any() else float("nan")
        ),
        "n_survivors": int(survivors.sum()),
    }


# ---------------------------------------------------------------------------
# 4.3 Growth analytics
# ---------------------------------------------------------------------------


def growth_analytics(
    result: dict[str, Any],
    percentiles: tuple[float, ...] = (5, 10, 25, 50, 75, 90, 95),
) -> dict[str, Any]:
    """Terminal-bankroll growth summary.

    Mean and median are always reported together because the terminal
    distribution is typically right-skewed.
    """
    terminal = np.asarray(result["terminal_bankroll"], dtype=np.float64)
    start = float(result["parameters"]["bankroll_bb"])
    net = terminal - start

    pct = {
        f"p{int(p)}_terminal": float(np.percentile(terminal, p))
        for p in percentiles
    }

    return {
        "mean_terminal_bankroll": float(terminal.mean()),
        "median_terminal_bankroll": float(np.median(terminal)),
        "mean_net_growth": float(net.mean()),
        "median_net_growth": float(np.median(net)),
        "expected_growth_pct": (
            float(net.mean() / start * 100.0) if start != 0 else float("nan")
        ),
        "prob_profit": float((terminal > start).mean()),
        "prob_double": float((terminal >= 2 * start).mean()),
        **pct,
    }


# ---------------------------------------------------------------------------
# 4.4 Time-to-ruin analytics
# ---------------------------------------------------------------------------


def time_to_ruin_analytics(result: dict[str, Any]) -> dict[str, Any]:
    """Distribution of the ruin hand among ruined paths only."""
    ruined = np.asarray(result["ruined"], dtype=bool)
    ruin_hand = np.asarray(result["ruin_hand"], dtype=np.float64)
    n_hands = int(result["parameters"]["n_hands"])
    n = ruined.size

    ruined_hands = ruin_hand[ruined]
    out: dict[str, Any] = {
        "n_ruined": int(ruined.sum()),
        "n_paths": int(n),
    }
    if ruined_hands.size == 0:
        out.update(
            median_ruin_hand=float("nan"),
            p25_ruin_hand=float("nan"),
            p75_ruin_hand=float("nan"),
        )
    else:
        out.update(
            median_ruin_hand=float(np.median(ruined_hands)),
            p25_ruin_hand=float(np.percentile(ruined_hands, 25)),
            p75_ruin_hand=float(np.percentile(ruined_hands, 75)),
        )

    # Cumulative fraction of *all* paths ruined by each horizon fraction.
    for frac in (0.25, 0.50, 0.75, 1.00):
        cutoff = frac * n_hands
        by_frac = ruined & (ruin_hand <= cutoff) & (ruin_hand >= 0)
        out[f"pct_ruined_by_{int(frac * 100)}pct"] = float(by_frac.mean())
    return out


# ---------------------------------------------------------------------------
# Convenience: full summary
# ---------------------------------------------------------------------------


def summarize(
    result: dict[str, Any],
    confidence_level: float = 0.95,
    n_bootstrap: int = 2000,
    seed: int | None = None,
) -> dict[str, Any]:
    """Bundle all four analytics blocks into one dict."""
    return {
        "risk_of_ruin": estimate_risk_of_ruin(
            result, confidence_level, n_bootstrap, seed
        ),
        "drawdown": drawdown_analytics(result),
        "growth": growth_analytics(result),
        "time_to_ruin": time_to_ruin_analytics(result),
    }
