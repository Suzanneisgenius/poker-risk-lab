"""Unit conversion and display formatting.

Keeps all bb <-> buy-in <-> dollar conversions and number formatting in one
place so the UI and reports stay consistent. No plotting, no simulation.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Units:
    """Display-unit context.

    Attributes
    ----------
    bb_per_buyin:
        Big blinds in one buy-in (typically 100).
    dollars_per_bb:
        Dollar value of one big blind (big-blind size). ``None`` hides money.
    """

    bb_per_buyin: float = 100.0
    dollars_per_bb: float | None = None

    def bb_to_buyins(self, bb: float) -> float:
        return bb / self.bb_per_buyin

    def bb_to_dollars(self, bb: float) -> float | None:
        if self.dollars_per_bb is None:
            return None
        return bb * self.dollars_per_bb


def fmt_bb(bb: float, decimals: int = 0) -> str:
    """Format a big-blind amount with a signed thousands separator."""
    return f"{bb:,.{decimals}f} bb"


def fmt_buyins(bb: float, units: Units, decimals: int = 1) -> str:
    return f"{units.bb_to_buyins(bb):,.{decimals}f} BI"


def fmt_money(bb: float, units: Units) -> str | None:
    dollars = units.bb_to_dollars(bb)
    if dollars is None:
        return None
    sign = "-" if dollars < 0 else ""
    return f"{sign}${abs(dollars):,.0f}"


def fmt_amount(bb: float, units: Units, prefer: str = "bb") -> str:
    """Format an amount in the preferred unit, appending money when available.

    ``prefer`` is ``"bb"`` or ``"buyins"``.
    """
    core = fmt_buyins(bb, units) if prefer == "buyins" else fmt_bb(bb)
    money = fmt_money(bb, units)
    return f"{core} ({money})" if money else core


def fmt_pct(p: float, decimals: int = 1) -> str:
    return f"{p * 100:.{decimals}f}%"


def fmt_hands(n: int | float) -> str:
    """Human-friendly hand count: 50000 -> '50k', 1000000 -> '1.0M'."""
    n = float(n)
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M".replace(".0M", "M")
    if n >= 1_000:
        return f"{n / 1_000:.0f}k"
    return f"{n:.0f}"


def signed(value: float, decimals: int = 0) -> str:
    """Signed number with thousands separators, e.g. '+1,200'."""
    return f"{value:+,.{decimals}f}"
