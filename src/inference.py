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

The standard error assumes one win rate throughout. A stability check (the one
the web page's session import uses, standalone/shared/sessions.js) cuts the
blocks, in the order given, into up to 10 consecutive groups and compares their
win rates; when they differ by more than chance, the SE is widened to the
between-group one. It replaced a lag-1 autocorrelation adjustment on
2026-10-22: in checks/session-lengths/ that rarely noticed a drifting win rate
and widening by it did not restore the interval's coverage.
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
    # Stability check: 0 groups (and None below) when not run, which needs at
    # least 20 blocks and some spread.
    stability_groups: int
    stability_q: float | None     # heterogeneity statistic, chi-square(groups - 1)
    stability_p: float | None
    stability_flag: bool          # p < 0.05
    se_between_groups: float | None
    stability_multiplier: float | None  # se_between_groups / se_winrate, within [1, 10]
    se_multiplier: float          # applied to se_winrate: 1, or stability_multiplier
    se_winrate_adjusted: float    # se_winrate * se_multiplier
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
        msgs.append(f"Only {hands.size} blocks: the volatility estimate is rough.")
    if total < 10_000:
        msgs.append(f"Only {total:,.0f} hands: the win-rate estimate is very "
                    "imprecise (wide confidence interval).")
    cv = float(hands.std() / hands.mean()) if hands.mean() > 0 else 0.0
    if cv > 0.75:
        msgs.append("Block sizes vary substantially; weighted estimates assume "
                    "the model holds across block sizes.")
    return msgs


STABILITY_MIN_BLOCKS = 20
STABILITY_MAX_GROUPS = 10


def stability_check(hands: np.ndarray, profit: np.ndarray, mu_hat: float,
                    sigma: float, se: float) -> dict[str, Any] | None:
    """Is the win rate the same throughout? Blocks in time order.

    The blocks are cut into ``G = min(10, n // 5)`` consecutive groups of equal
    count. With ``W_g`` the group's hands / 100 and ``mu_g`` its win rate,
    ``Q = sum(W_g (mu_g - mu_hat)^2) / sigma^2`` is chi-square with ``G - 1``
    degrees of freedom when every group shares one win rate, and the
    between-group standard error of ``mu_hat`` is
    ``sqrt(G / (G - 1) * sum((W_g / W)^2 (mu_g - mu_hat)^2))``.
    """
    n = hands.size
    if n < STABILITY_MIN_BLOCKS or not sigma > 0:
        return None
    g = min(STABILITY_MAX_GROUPS, n // 5)
    edges = [(k * n) // g for k in range(g + 1)]
    gh = np.array([hands[a:b].sum() for a, b in zip(edges[:-1], edges[1:])])
    gp = np.array([profit[a:b].sum() for a, b in zip(edges[:-1], edges[1:])])
    w, rate = gh / 100.0, 100.0 * gp / gh
    q = float(np.sum(w * (rate - mu_hat) ** 2) / sigma ** 2)
    between = float(np.sqrt(g / (g - 1) * np.sum((w / w.sum()) ** 2 * (rate - mu_hat) ** 2)))
    return {"groups": g, "q": q, "p": float(stats.chi2.sf(q, g - 1)),
            "se_between": between, "multiplier": min(10.0, max(1.0, between / se))}


def estimate_edge(
    block_hands: np.ndarray | list[float],
    profit_bb: np.ndarray | list[float],
    confidence_level: float = 0.95,
    widen: bool | None = None,
) -> EdgeEstimate:
    """Hands-weighted win-rate estimate with volatility, SE, and CI.

    Model: block ``i`` profit ``p_i ~ N(mu * h_i/100, sigma^2 * h_i/100)``.
    Then the block win rate ``r_i = 100 p_i / h_i`` has mean ``mu`` and variance
    ``sigma^2 / w_i`` with weight ``w_i = h_i/100``.

    Blocks are taken to be in time order. ``widen`` decides whether the SE is
    widened by the stability check: ``None`` (default) when it flags, as the web
    page does; ``True`` always (it never narrows); ``False`` never.
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

    check = stability_check(hands, profit, mu_hat, sigma, se)
    flag = bool(check is not None and check["p"] < 0.05)
    apply = check is not None and (flag if widen is None else widen)
    multiplier = check["multiplier"] if apply else 1.0
    se_adj = float(se * multiplier)
    if check is None:
        msgs.append(f"Fewer than {STABILITY_MIN_BLOCKS} blocks (or no spread): the "
                    "stability check is not run, so the SE assumes one win rate "
                    "throughout.")
    elif flag:
        msgs.append(f"The win rate differs between {check['groups']} consecutive "
                    f"groups of blocks more than chance allows (p = {check['p']:.2g}). "
                    + (f"The SE is widened ×{multiplier:.2f}, which only partly "
                       "corrects for a changing win rate." if multiplier > 1 else
                       "The SE is not widened."))

    # Frequentist CI using Student-t with n-1 df (proper for estimated sigma).
    # When widened, the SE comes from only the groups, so this is optimistic.
    tcrit = float(stats.t.ppf(0.5 + confidence_level / 2, df=n - 1))
    lo, hi = mu_hat - tcrit * se_adj, mu_hat + tcrit * se_adj

    if msgs:
        for m in msgs:
            warnings.warn(m, stacklevel=2)

    return EdgeEstimate(
        n_blocks=n, total_hands=int(total_hands), winrate_bb100=mu_hat,
        std_bb100=sigma, se_winrate=se, ci_low=lo, ci_high=hi,
        confidence_level=confidence_level,
        stability_groups=check["groups"] if check else 0,
        stability_q=check["q"] if check else None,
        stability_p=check["p"] if check else None,
        stability_flag=flag,
        se_between_groups=check["se_between"] if check else None,
        stability_multiplier=check["multiplier"] if check else None,
        se_multiplier=float(multiplier), se_winrate_adjusted=se_adj, warnings=msgs,
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
