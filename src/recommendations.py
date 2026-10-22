"""Neutral, decision-support interpretation of simulation outputs.

This module translates numbers into plain-language risk interpretation. It does
NOT encourage gambling, promise outcomes, or claim certainty. Risk categories
are interface labels, not universal bankroll-management standards.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from src.analytics import estimate_risk_of_ruin
from src.sensitivity import required_bankroll_for_target, sweep_parameter
from src.simulation import SimulationConfig, simulate_from_config

# (upper_bound_exclusive, label)
RISK_BANDS: list[tuple[float, str]] = [
    (0.01, "Very low modeled ruin risk"),
    (0.05, "Low modeled ruin risk"),
    (0.15, "Material modeled ruin risk"),
    (0.30, "High modeled ruin risk"),
    (float("inf"), "Very high modeled ruin risk"),
]


def classify_risk(ror: float) -> str:
    """Map a ruin probability to an interface label (not a poker standard)."""
    for upper, label in RISK_BANDS:
        if ror < upper:
            return label
    return RISK_BANDS[-1][1]


@dataclass(frozen=True)
class Driver:
    parameter: str
    label: str
    ror_low: float
    ror_high: float

    @property
    def swing(self) -> float:
        return abs(self.ror_high - self.ror_low)


def strongest_driver(
    base: SimulationConfig,
    winrate_delta: float = 1.0,
    std_delta: float = 15.0,
    bankroll_delta_bb: float = 500.0,
    n_paths: int = 8000,
) -> Driver | None:
    """Which single parameter moves ruin risk most under a small +/- nudge.

    Each parameter is perturbed by a comparable "one notch" amount and the
    resulting swing in ruin risk is compared. Returns the largest swing.
    """
    specs = [
        ("winrate_bb100", "win rate",
         base.winrate_bb100 - winrate_delta, base.winrate_bb100 + winrate_delta),
        ("std_bb100", "standard deviation",
         max(1.0, base.std_bb100 - std_delta), base.std_bb100 + std_delta),
        ("bankroll_bb", "bankroll",
         max(base.ruin_threshold_bb + 1.0, base.bankroll_bb - bankroll_delta_bb),
         base.bankroll_bb + bankroll_delta_bb),
    ]
    drivers: list[Driver] = []
    for field, label, lo, hi in specs:
        df = sweep_parameter(base, field, [lo, hi], n_paths=n_paths)
        if len(df) < 2:
            continue
        r_lo = float(df.iloc[0]["risk_of_ruin"])
        r_hi = float(df.iloc[-1]["risk_of_ruin"])
        drivers.append(Driver(field, label, r_lo, r_hi))
    if not drivers:
        return None
    return max(drivers, key=lambda d: d.swing)


def build_recommendations(
    result: dict[str, Any],
    base: SimulationConfig,
    target_ror: float = 0.05,
    compute_required_bankroll: bool = True,
    compute_driver: bool = True,
) -> dict[str, Any]:
    """Assemble a neutral decision-support summary.

    Only the parts that need extra simulation (driver, required bankroll) are
    optional so the caller can keep the UI responsive.
    """
    ror = estimate_risk_of_ruin(result, seed=0)
    p = ror["point_estimate"]
    n_hands = base.n_hands

    lines: list[str] = []
    lines.append(
        f"At the selected assumptions, about {p * 100:.1f}% of simulated paths "
        f"reached the ruin threshold within {n_hands:,} hands "
        f"(95% CI {ror['ci_low'] * 100:.1f}%-{ror['ci_high'] * 100:.1f}%)."
    )

    driver = None
    if compute_driver:
        driver = strongest_driver(base)
        if driver is not None:
            lines.append(
                f"Ruin risk is most sensitive to the {driver.label} assumption: "
                f"a small change moves it between {driver.ror_low * 100:.1f}% "
                f"and {driver.ror_high * 100:.1f}% in this model."
            )

    required = None
    if compute_required_bankroll:
        lo = max(base.ruin_threshold_bb + 1.0, base.bankroll_bb * 0.25)
        hi = base.bankroll_bb * 4.0
        required = required_bankroll_for_target(
            base, target_ror, lo_bb=lo, hi_bb=hi
        )
        if required["bracketed"]:
            lines.append(
                f"A bankroll near {required['bankroll_bb']:,.0f} bb "
                f"({required['bankroll_bb'] / base.step_hands:.0f}x the step "
                f"size) keeps simulated ruin risk at or below "
                f"{target_ror * 100:.0f}% under the current variance and "
                f"horizon assumptions."
            )
        else:
            lines.append(
                f"Even at {hi:,.0f} bb, simulated ruin risk stays above the "
                f"{target_ror * 100:.0f}% target in this range — the edge or "
                f"variance assumptions dominate."
            )

    lines.append(
        "Remember that your win rate is itself an estimate; if it is lower than "
        "assumed, real ruin risk is higher than shown."
    )

    return {
        "risk_of_ruin": p,
        "risk_label": classify_risk(p),
        "target_ror": target_ror,
        "required_bankroll": required,
        "driver": driver,
        "narrative": lines,
    }


def interpret_validation(comparison: dict[str, Any]) -> str:
    """One neutral sentence summarizing the validation comparison."""
    m = comparison["methods"]
    mc = m["monte_carlo_finite"]
    fin = m["brownian_finite"]
    inf = m["brownian_infinite"]
    return (
        f"The Monte Carlo estimate ({mc * 100:.1f}%) is "
        f"{comparison['verdict_mc_vs_finite']} with the finite-horizon Brownian "
        f"approximation ({fin * 100:.1f}%). The infinite-horizon figure "
        f"({inf * 100:.1f}%) is an upper bound that assumes unlimited time, so "
        f"it is expected to sit higher."
    )
