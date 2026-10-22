"""Estimate a player's edge and its uncertainty from historical results.

Input is block-level history: for each block, the number of hands played and the
profit in big blinds. The central statistical point is the distinction between
two very different quantities:

- ``std_bb100`` (volatility): how bumpy an individual stretch of hands is. This
  does **not** shrink with more data.
- ``se_winrate`` (standard error of the *mean*): how precisely the true win rate
  is pinned down. This shrinks like ``1/sqrt(hands)``.

A 3 bb/100 observed edge over 100k hands with volatility 100 bb/100 has a
standard error near 3.2 bb/100 — i.e. it is not clearly distinguishable from
break-even. Conflating SD with SE is the classic mistake this module avoids.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy import stats


@dataclass(frozen=True)
class EdgeEstimate:
    n_blocks: int
    total_hands: int
    winrate_bb100: float          # hands-weighted point estimate of mu
    std_bb100: float              # per-100-hand volatility (sigma)
    se_winrate: float             # standard error of the win-rate estimate
    ci_low: float                 # frequentist CI for the win rate
    ci_high: float
    confidence_level: float
    lag1_autocorr: float
    effective_n_blocks: float
    se_winrate_adjusted: float    # SE inflated for autocorrelation
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {k: getattr(self, k) for k in self.__dataclass_fields__}


def _validate(hands: np.ndarray, profit: np.ndarray) -> list[str]:
    if hands.size != profit.size:
        raise ValueError("hands and profit_bb must have the same length.")
    if hands.size == 0:
        raise ValueError("No blocks provided.")
    if not np.all(np.isfinite(hands)) or not np.all(np.isfinite(profit)):
        raise ValueError("hands and profit_bb must be finite (no NaN/inf).")
    if np.any(hands <= 0):
        raise ValueError("All block hand counts must be positive.")
    if hands.size < 2:
        raise ValueError("At least 2 blocks are required to estimate variance.")

    msgs: list[str] = []
    total = float(hands.sum())
    if hands.size < 5:
        msgs.append(f"Only {hands.size} blocks: variance and autocorrelation "
                    "estimates are rough.")
    if total < 10_000:
        msgs.append(f"Only {total:,.0f} hands: the win-rate estimate is very "
                    "imprecise (wide confidence interval).")
    cv = float(hands.std() / hands.mean()) if hands.mean() > 0 else 0.0
    if cv > 0.75:
        msgs.append("Block sizes vary substantially; weighted estimates assume "
                    "the model holds across block sizes.")
    return msgs


def estimate_edge(
    block_hands: np.ndarray | list[float],
    profit_bb: np.ndarray | list[float],
    confidence_level: float = 0.95,
) -> EdgeEstimate:
    """Hands-weighted win-rate estimate with volatility, SE, and CI.

    Model: block ``i`` profit ``p_i ~ N(mu * h_i/100, sigma^2 * h_i/100)``.
    Then the block win rate ``r_i = 100 p_i / h_i`` has mean ``mu`` and variance
    ``sigma^2 / w_i`` with weight ``w_i = h_i/100``.
    """
    hands = np.asarray(block_hands, dtype=np.float64)
    profit = np.asarray(profit_bb, dtype=np.float64)
    msgs = _validate(hands, profit)

    total_hands = float(hands.sum())
    w = hands / 100.0                       # weight in units of 100-hand blocks
    r = 100.0 * profit / hands              # per-block win rate (bb/100)
    mu_hat = float(np.sum(profit) / total_hands * 100.0)  # = sum(w r)/sum(w)

    n = hands.size
    # Weighted residual variance -> sigma^2 (per 100 hands).
    sigma2 = float(np.sum(w * (r - mu_hat) ** 2) / (n - 1))
    sigma = float(np.sqrt(max(sigma2, 0.0)))

    # SE of the mean win rate: Var(mu_hat) = sigma^2 / sum(w) = 100 sigma^2 / N.
    se = float(sigma / np.sqrt(total_hands / 100.0)) if total_hands > 0 else float("inf")

    # Lag-1 autocorrelation of block win rates -> effective sample size.
    if n >= 3 and np.std(r) > 0:
        rho = float(np.corrcoef(r[:-1], r[1:])[0, 1])
    else:
        rho = 0.0
    rho = 0.0 if not np.isfinite(rho) else rho
    raw_factor = (1 + rho) / (1 - rho) if abs(rho) < 1 else np.inf
    # Conservative: only ever *penalize* for positive autocorrelation; negative
    # autocorrelation is not credited (so effective_n <= n_blocks always).
    factor = min(max(raw_factor, 1.0), 1e6)
    eff_n = float(n / factor)
    se_adj = float(se * np.sqrt(factor))
    if rho > 0.2:
        msgs.append(f"Lag-1 autocorrelation {rho:+.2f} detected; the effective "
                    "sample is smaller than the block count and the SE is "
                    "widened accordingly.")

    # Frequentist CI using Student-t with n-1 df (proper for estimated sigma).
    tcrit = float(stats.t.ppf(0.5 + confidence_level / 2, df=n - 1))
    lo, hi = mu_hat - tcrit * se_adj, mu_hat + tcrit * se_adj

    if msgs:
        for m in msgs:
            warnings.warn(m, stacklevel=2)

    return EdgeEstimate(
        n_blocks=n, total_hands=int(total_hands), winrate_bb100=mu_hat,
        std_bb100=sigma, se_winrate=se, ci_low=lo, ci_high=hi,
        confidence_level=confidence_level, lag1_autocorr=rho,
        effective_n_blocks=eff_n, se_winrate_adjusted=se_adj, warnings=msgs,
    )


def load_blocks_csv(path: str) -> tuple[np.ndarray, np.ndarray]:
    """Load a CSV with columns ``hands`` and ``profit_bb``."""
    import pandas as pd
    df = pd.read_csv(path)
    cols = {c.lower(): c for c in df.columns}
    if "hands" not in cols or "profit_bb" not in cols:
        raise ValueError("CSV must have columns 'hands' and 'profit_bb'.")
    return (df[cols["hands"]].to_numpy(dtype=float),
            df[cols["profit_bb"]].to_numpy(dtype=float))


def synthetic_blocks(
    winrate_bb100: float, std_bb100: float, block_hands: int, n_blocks: int,
    seed: int = 0,
) -> tuple[np.ndarray, np.ndarray]:
    """Generate block history from the model (for demos and tests)."""
    rng = np.random.default_rng(seed)
    hands = np.full(n_blocks, block_hands, dtype=float)
    mean = winrate_bb100 * block_hands / 100.0
    sd = std_bb100 * np.sqrt(block_hands / 100.0)
    profit = rng.normal(mean, sd, size=n_blocks)
    return hands, profit
