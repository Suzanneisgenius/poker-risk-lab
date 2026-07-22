"""Illustrative scenario presets.

These are *labelled illustrative assumptions*, not universal poker truths. Every
value can be overridden in the UI. Each preset maps directly onto
:class:`src.simulation.SimulationConfig` fields plus a short description.
"""

from __future__ import annotations

from dataclasses import dataclass

from src.simulation import SimulationConfig


@dataclass(frozen=True)
class Scenario:
    """A named preset with a plain-language description."""

    key: str
    name: str
    description: str
    winrate_bb100: float
    std_bb100: float
    bankroll_bb: float
    n_hands: int
    ruin_threshold_bb: float = 0.0
    n_paths: int = 20_000
    seed: int = 42
    step_hands: int = 100
    bb_per_buyin: float = 100.0

    def to_config(self, n_paths: int | None = None) -> SimulationConfig:
        return SimulationConfig(
            n_paths=self.n_paths if n_paths is None else n_paths,
            n_hands=self.n_hands,
            winrate_bb100=self.winrate_bb100,
            std_bb100=self.std_bb100,
            bankroll_bb=self.bankroll_bb,
            ruin_threshold_bb=self.ruin_threshold_bb,
            seed=self.seed,
            step_hands=self.step_hands,
        )


PRESETS: list[Scenario] = [
    Scenario(
        key="conservative_regular",
        name="Conservative regular",
        description=(
            "A steady winner with a solid roll. Illustrative: a modest edge, "
            "typical 6-max variance, and a deep bankroll."
        ),
        winrate_bb100=3.0,
        std_bb100=90.0,
        bankroll_bb=5000.0,  # 50 buy-ins
        n_hands=100_000,
    ),
    Scenario(
        key="break_even",
        name="Break-even player",
        description=(
            "No real edge after rake. Illustrative: zero win rate — useful for "
            "seeing how variance alone drives drawdowns and ruin."
        ),
        winrate_bb100=0.0,
        std_bb100=100.0,
        bankroll_bb=3000.0,  # 30 buy-ins
        n_hands=100_000,
    ),
    Scenario(
        key="small_edge",
        name="Small-edge player",
        description=(
            "A thin but real edge in a tougher game. Illustrative: low win "
            "rate against meaningful variance."
        ),
        winrate_bb100=1.5,
        std_bb100=100.0,
        bankroll_bb=3000.0,  # 30 buy-ins
        n_hands=100_000,
    ),
    Scenario(
        key="high_variance_aggressive",
        name="High-variance aggressive",
        description=(
            "A loose, aggressive style: a good edge but big swings. "
            "Illustrative: high win rate paired with high standard deviation."
        ),
        winrate_bb100=5.0,
        std_bb100=150.0,
        bankroll_bb=4000.0,  # 40 buy-ins
        n_hands=100_000,
    ),
    Scenario(
        key="under_rolled",
        name="Under-rolled player",
        description=(
            "A winning player who is playing too high for their roll. "
            "Illustrative: a real edge but a thin bankroll relative to variance."
        ),
        winrate_bb100=3.0,
        std_bb100=100.0,
        bankroll_bb=1500.0,  # 15 buy-ins
        n_hands=100_000,
    ),
    Scenario(
        key="custom",
        name="Custom scenario",
        description="Start from sensible defaults and set every value yourself.",
        winrate_bb100=3.0,
        std_bb100=100.0,
        bankroll_bb=3000.0,
        n_hands=100_000,
    ),
]

PRESET_BY_KEY: dict[str, Scenario] = {s.key: s for s in PRESETS}


def get_preset(key: str) -> Scenario:
    if key not in PRESET_BY_KEY:
        raise KeyError(f"Unknown preset: {key!r}")
    return PRESET_BY_KEY[key]
