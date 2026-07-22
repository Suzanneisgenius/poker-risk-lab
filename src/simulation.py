"""Vectorized Monte Carlo bankroll-variance engine.

The bankroll is measured in big blinds (bb). Play proceeds in discrete steps of
``step_hands`` hands. Each step applies a Normal increment:

    increment ~ Normal(mean = winrate_bb100 * step_hands / 100,
                       std  = std_bb100 * sqrt(step_hands / 100))

A path is *ruined* the first time its bankroll is <= ``ruin_threshold_bb``.
Ruin is absorbing: a ruined path is clipped to the threshold for all later
steps and can never recover.

All randomness flows through ``np.random.default_rng(seed)`` so that every
reported number is reproducible from the config alone. No module-level RNG.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SimulationConfig:
    """Immutable parameter set for one simulation run.

    Attributes
    ----------
    n_paths:
        Number of independent Monte Carlo paths.
    n_hands:
        Simulation horizon in hands.
    winrate_bb100:
        Expected win rate in big blinds per 100 hands.
    std_bb100:
        Standard deviation of results in big blinds per 100 hands.
    bankroll_bb:
        Starting bankroll in big blinds.
    ruin_threshold_bb:
        Bankroll level (bb) at or below which a path is ruined.
    seed:
        Seed for ``np.random.default_rng``.
    step_hands:
        Number of hands aggregated into a single Normal increment.
    """

    n_paths: int
    n_hands: int
    winrate_bb100: float
    std_bb100: float
    bankroll_bb: float
    ruin_threshold_bb: float = 0.0
    seed: int = 42
    step_hands: int = 100

    def validate(self) -> None:
        """Raise ``ValueError`` with a clear message on invalid input."""
        if self.n_paths <= 0:
            raise ValueError("n_paths must be a positive integer.")
        if self.n_hands <= 0:
            raise ValueError("n_hands must be a positive integer.")
        if self.step_hands <= 0:
            raise ValueError("step_hands must be a positive integer.")
        if self.n_hands < self.step_hands:
            raise ValueError(
                "n_hands must be at least step_hands "
                f"(got n_hands={self.n_hands}, step_hands={self.step_hands})."
            )
        if self.std_bb100 < 0:
            raise ValueError("std_bb100 must be non-negative.")
        if self.bankroll_bb <= self.ruin_threshold_bb:
            raise ValueError(
                "Starting bankroll must be above the ruin threshold "
                f"(bankroll_bb={self.bankroll_bb}, "
                f"ruin_threshold_bb={self.ruin_threshold_bb})."
            )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _step_sizes(n_hands: int, step_hands: int) -> list[int]:
    """Return per-step hand counts, handling a partial final step."""
    n_full, remainder = divmod(n_hands, step_hands)
    sizes = [step_hands] * n_full
    if remainder:
        sizes.append(remainder)
    return sizes


def estimate_memory_bytes(n_paths: int, n_steps: int) -> int:
    """Rough peak memory for a full (non-chunked) run, in bytes.

    We hold several float64 arrays of shape ``(n_paths, n_steps + 1)``
    simultaneously (raw, clipped, running peak, drawdown). The factor of 5
    is a deliberately conservative estimate.
    """
    return int(n_paths) * (int(n_steps) + 1) * 8 * 5


# ---------------------------------------------------------------------------
# Core engine
# ---------------------------------------------------------------------------


def simulate_bankroll(
    n_paths: int,
    n_hands: int,
    winrate_bb100: float,
    std_bb100: float,
    bankroll_bb: float,
    ruin_threshold_bb: float = 0.0,
    seed: int | None = None,
    step_hands: int = 100,
    store_n_paths: int | None = None,
    max_memory_gb: float = 2.0,
    chunk_paths: int | None = None,
) -> dict[str, Any]:
    """Run a vectorized Monte Carlo bankroll simulation.

    Parameters
    ----------
    store_n_paths:
        Number of full bankroll paths to retain for plotting. ``None`` stores
        all paths. Summary statistics are always computed over *all* paths.
    max_memory_gb:
        If a single-block allocation would exceed this, the run is executed in
        path-chunks automatically. Set generously; a hard ceiling still raises.
    chunk_paths:
        Explicit chunk size (paths per block). ``None`` picks a size that keeps
        each block under ``max_memory_gb``.

    Returns
    -------
    dict with keys:
        ``bankroll_paths`` (sample, absorbed/clipped), ``ruined`` (bool),
        ``ruin_step`` (int, -1 if survived), ``ruin_hand`` (int, -1 if survived),
        ``terminal_bankroll``, ``max_drawdown``, ``max_drawdown_pct``,
        ``running_peak`` (sample), ``sample_index``, ``parameters``.
    """
    config = SimulationConfig(
        n_paths=n_paths,
        n_hands=n_hands,
        winrate_bb100=winrate_bb100,
        std_bb100=std_bb100,
        bankroll_bb=bankroll_bb,
        ruin_threshold_bb=ruin_threshold_bb,
        seed=42 if seed is None else int(seed),
        step_hands=step_hands,
    )
    config.validate()

    sizes = _step_sizes(n_hands, step_hands)
    n_steps = len(sizes)
    n_cols = n_steps + 1  # include the starting column

    # Per-step Normal parameters (bb per step).
    step_arr = np.asarray(sizes, dtype=np.float64)
    step_mean = winrate_bb100 * step_arr / 100.0
    step_std = std_bb100 * np.sqrt(step_arr / 100.0)

    # Decide on chunking.
    hard_ceiling_bytes = 8 * 1024**3  # absolute refusal above 8 GB
    est = estimate_memory_bytes(n_paths, n_steps)
    limit_bytes = int(max_memory_gb * 1024**3)
    if chunk_paths is None:
        if est <= limit_bytes:
            chunk_paths = n_paths
        else:
            per_path = max(estimate_memory_bytes(1, n_steps), 1)
            chunk_paths = max(1, limit_bytes // per_path)
    chunk_paths = int(min(chunk_paths, n_paths))

    if estimate_memory_bytes(chunk_paths, n_steps) > hard_ceiling_bytes:
        raise MemoryError(
            "This configuration would allocate more than 8 GB even when "
            "chunked. Reduce n_paths, reduce the horizon, or increase "
            "step_hands."
        )

    if store_n_paths is None:
        store_n_paths = n_paths
    store_n_paths = int(min(store_n_paths, n_paths))

    rng = np.random.default_rng(config.seed)
    threshold = float(ruin_threshold_bb)
    col_idx = np.arange(n_cols)

    # Summary accumulators (allocated once, filled per chunk).
    ruined = np.empty(n_paths, dtype=bool)
    ruin_step = np.empty(n_paths, dtype=np.int64)
    terminal_bankroll = np.empty(n_paths, dtype=np.float64)
    max_drawdown = np.empty(n_paths, dtype=np.float64)
    max_drawdown_pct = np.empty(n_paths, dtype=np.float64)

    # Reservoir of stored sample paths (first ``store_n_paths`` paths).
    sample_index = np.arange(store_n_paths, dtype=np.int64)
    sample_paths = np.empty((store_n_paths, n_cols), dtype=np.float64)
    sample_peaks = np.empty((store_n_paths, n_cols), dtype=np.float64)

    start = 0
    while start < n_paths:
        stop = min(start + chunk_paths, n_paths)
        m = stop - start

        # Standard normals -> scaled increments (m, n_steps).
        z = rng.standard_normal(size=(m, n_steps))
        increments = step_mean[np.newaxis, :] + step_std[np.newaxis, :] * z

        # Raw (unabsorbed) bankroll, including the starting column.
        raw = np.empty((m, n_cols), dtype=np.float64)
        raw[:, 0] = bankroll_bb
        np.cumsum(increments, axis=1, out=raw[:, 1:])
        raw[:, 1:] += bankroll_bb

        # First ruin column (<= threshold).
        breached = raw <= threshold
        any_ruined = breached.any(axis=1)
        first = np.where(any_ruined, breached.argmax(axis=1), -1)

        # Absorb: clip everything at and after the first breach to threshold.
        clipped = raw.copy()
        after = (col_idx[np.newaxis, :] >= first[:, np.newaxis]) & any_ruined[
            :, np.newaxis
        ]
        clipped[after] = threshold

        # Running peak and drawdown on the absorbed path.
        peak = np.maximum.accumulate(clipped, axis=1)
        dd = peak - clipped
        mdd = dd.max(axis=1)

        # Percentage drawdown with a safe denominator (peak > 0).
        with np.errstate(divide="ignore", invalid="ignore"):
            dd_pct = np.where(peak > 0, dd / peak, np.nan)
        mdd_pct = np.nanmax(dd_pct, axis=1)

        # Store summaries.
        ruined[start:stop] = any_ruined
        ruin_step[start:stop] = first
        terminal_bankroll[start:stop] = clipped[:, -1]
        max_drawdown[start:stop] = mdd
        max_drawdown_pct[start:stop] = mdd_pct

        # Store sample paths that fall in the retained range.
        lo = start
        hi = min(stop, store_n_paths)
        if hi > lo:
            sample_paths[lo:hi] = clipped[: hi - lo]
            sample_peaks[lo:hi] = peak[: hi - lo]

        start = stop

    # Map a ruin column index to the exact cumulative hand count. Using
    # ``ruin_step * step_hands`` would overstate the ruin hand when the final
    # step is a partial (shorter) interval, so we index an explicit hand grid.
    hand_grid = np.concatenate([[0], np.cumsum(sizes)]).astype(np.int64)  # len n_cols
    ruin_hand = np.where(ruined, hand_grid[ruin_step], -1).astype(np.int64)

    return {
        "bankroll_paths": sample_paths,
        "running_peak": sample_peaks,
        "sample_index": sample_index,
        "ruined": ruined,
        "ruin_step": ruin_step,
        "ruin_hand": ruin_hand,
        "terminal_bankroll": terminal_bankroll,
        "max_drawdown": max_drawdown,
        "max_drawdown_pct": max_drawdown_pct,
        "step_sizes": np.asarray(sizes, dtype=np.int64),
        "hand_grid": hand_grid,
        "parameters": asdict(config),
    }


def simulate_from_config(
    config: SimulationConfig, **kwargs: Any
) -> dict[str, Any]:
    """Convenience wrapper: run :func:`simulate_bankroll` from a config."""
    return simulate_bankroll(
        n_paths=config.n_paths,
        n_hands=config.n_hands,
        winrate_bb100=config.winrate_bb100,
        std_bb100=config.std_bb100,
        bankroll_bb=config.bankroll_bb,
        ruin_threshold_bb=config.ruin_threshold_bb,
        seed=config.seed,
        step_hands=config.step_hands,
        **kwargs,
    )
