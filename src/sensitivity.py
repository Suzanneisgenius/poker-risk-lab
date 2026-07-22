"""Parameter sweeps and the required-bankroll solver.

Each sweep holds all parameters fixed except one and returns a tidy
``pandas.DataFrame``. These functions are pure (seeded) and do no plotting.
"""

from __future__ import annotations

from typing import Iterable

import numpy as np
import pandas as pd

from src.analytics import estimate_risk_of_ruin
from src.simulation import SimulationConfig, simulate_from_config

SWEEP_FIELDS = (
    "bankroll_bb",
    "winrate_bb100",
    "std_bb100",
    "n_hands",
    "ruin_threshold_bb",
)


def _ci_method(n_paths: int) -> str:
    """Bootstrap is fine; use the fast Wilson interval for large path counts."""
    return "binomial" if n_paths >= 20_000 else "bootstrap"


def sweep_parameter(
    base: SimulationConfig,
    field: str,
    values: Iterable[float],
    n_paths: int | None = None,
    ci_seed: int = 0,
) -> pd.DataFrame:
    """Sweep one field across ``values``, holding all others fixed.

    Returns a DataFrame with columns: the swept ``field``, ``risk_of_ruin``,
    ``ci_low``, ``ci_high``, ``median_terminal_bb``, ``prob_profit``.
    """
    if field not in SWEEP_FIELDS:
        raise ValueError(
            f"Cannot sweep {field!r}; choose one of {SWEEP_FIELDS}."
        )
    rows = []
    for v in values:
        kwargs = {field: type(getattr(base, field))(v)}
        cfg = _replace(base, n_paths=n_paths, **kwargs)
        try:
            cfg.validate()
        except ValueError:
            continue  # skip invalid points (e.g. bankroll <= threshold)
        res = simulate_from_config(cfg)
        ror = estimate_risk_of_ruin(
            res, seed=ci_seed, method=_ci_method(cfg.n_paths)
        )
        median_terminal = float(np.median(res["terminal_bankroll"]))
        prob_profit = float((res["terminal_bankroll"] > cfg.bankroll_bb).mean())
        rows.append(
            {
                field: getattr(cfg, field),
                "risk_of_ruin": ror["point_estimate"],
                "ci_low": ror["ci_low"],
                "ci_high": ror["ci_high"],
                "median_terminal_bb": median_terminal,
                "prob_profit": prob_profit,
            }
        )
    return pd.DataFrame(rows)


def _replace(base: SimulationConfig, n_paths: int | None = None, **changes):
    data = dict(
        n_paths=base.n_paths if n_paths is None else n_paths,
        n_hands=base.n_hands,
        winrate_bb100=base.winrate_bb100,
        std_bb100=base.std_bb100,
        bankroll_bb=base.bankroll_bb,
        ruin_threshold_bb=base.ruin_threshold_bb,
        seed=base.seed,
        step_hands=base.step_hands,
    )
    data.update(changes)
    return SimulationConfig(**data)


def winrate_uncertainty_sweep(
    base: SimulationConfig,
    estimated_winrate: float,
    uncertainty: float,
    n_points: int = 9,
    n_paths: int | None = None,
    ci_seed: int = 0,
) -> pd.DataFrame:
    """Sweep win rate across ``estimated +/- uncertainty`` (a plausible band).

    This addresses the fact that an observed win rate is itself an estimate.
    """
    lo = estimated_winrate - uncertainty
    hi = estimated_winrate + uncertainty
    values = np.linspace(lo, hi, n_points)
    df = sweep_parameter(base, "winrate_bb100", values, n_paths, ci_seed)
    df["delta_from_estimate"] = df["winrate_bb100"] - estimated_winrate
    return df


def risk_surface(
    base: SimulationConfig,
    bankroll_values: Iterable[float],
    winrate_values: Iterable[float],
    n_paths: int = 4000,
    ci_seed: int = 0,
) -> pd.DataFrame:
    """Coarse 2-D risk-of-ruin grid over (bankroll, win rate).

    Uses a controlled path count to stay responsive. Returns long-form rows
    with columns ``bankroll_bb``, ``winrate_bb100``, ``risk_of_ruin``.
    """
    rows = []
    for wr in winrate_values:
        for bank in bankroll_values:
            cfg = _replace(
                base, n_paths=n_paths,
                winrate_bb100=float(wr), bankroll_bb=float(bank),
            )
            try:
                cfg.validate()
            except ValueError:
                rows.append(
                    {"bankroll_bb": float(bank), "winrate_bb100": float(wr),
                     "risk_of_ruin": np.nan}
                )
                continue
            res = simulate_from_config(cfg)
            rows.append(
                {
                    "bankroll_bb": float(bank),
                    "winrate_bb100": float(wr),
                    "risk_of_ruin": float(res["ruined"].mean()),
                }
            )
    return pd.DataFrame(rows)


def required_bankroll_for_target(
    base: SimulationConfig,
    target_ror: float,
    lo_bb: float,
    hi_bb: float,
    n_paths: int = 20_000,
    tol_bb: float = 25.0,
    max_iter: int = 24,
    ci_seed: int = 0,
) -> dict:
    """Bisection search for the minimum bankroll with ruin risk <= target.

    Ruin risk is monotone decreasing in bankroll, so bisection is valid up to
    Monte Carlo noise. Returns the solved bankroll and the achieved risk, plus
    a ``bracketed`` flag if the target lies outside [lo, hi].
    """
    def ror_at(bank: float) -> float:
        cfg = _replace(base, n_paths=n_paths, bankroll_bb=float(bank))
        cfg.validate()
        return float(simulate_from_config(cfg)["ruined"].mean())

    r_lo = ror_at(lo_bb)  # highest risk (smallest bankroll)
    r_hi = ror_at(hi_bb)  # lowest risk (largest bankroll)

    if r_lo <= target_ror:
        return {"bankroll_bb": lo_bb, "risk_of_ruin": r_lo,
                "bracketed": True, "note": "target met at the low end"}
    if r_hi > target_ror:
        return {"bankroll_bb": hi_bb, "risk_of_ruin": r_hi,
                "bracketed": False,
                "note": "target not reached within the search range"}

    lo, hi = lo_bb, hi_bb
    best = hi_bb
    best_r = r_hi
    for _ in range(max_iter):
        mid = 0.5 * (lo + hi)
        r_mid = ror_at(mid)
        if r_mid <= target_ror:
            best, best_r = mid, r_mid
            hi = mid
        else:
            lo = mid
        if hi - lo <= tol_bb:
            break
    return {"bankroll_bb": best, "risk_of_ruin": best_r,
            "bracketed": True, "note": "bisection converged"}
