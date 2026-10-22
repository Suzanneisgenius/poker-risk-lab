"""Tests for sensitivity sweeps and the required-bankroll solver."""

import numpy as np
import pytest

from src.recommendations import classify_risk, strongest_driver
from src.scenarios import PRESET_BY_KEY, get_preset
from src.sensitivity import (
    required_bankroll_for_target,
    risk_surface,
    sweep_parameter,
    winrate_uncertainty_sweep,
)
from src.simulation import SimulationConfig


def base_cfg(**kw):
    data = dict(
        n_paths=4000, n_hands=50_000, winrate_bb100=1.5, std_bb100=100.0,
        bankroll_bb=2000.0, ruin_threshold_bb=0.0, seed=42, step_hands=100,
    )
    data.update(kw)
    return SimulationConfig(**data)


def test_risk_decreases_with_bankroll():
    cfg = base_cfg()
    vals = np.linspace(1000.0, 4000.0, 6)
    df = sweep_parameter(cfg, "bankroll_bb", vals, n_paths=4000)
    r = df["risk_of_ruin"].to_numpy()
    # Allow Monte Carlo noise but the trend must be downward overall.
    assert r[0] > r[-1]
    assert np.polyfit(df["bankroll_bb"], r, 1)[0] < 0


def test_risk_increases_with_variance():
    cfg = base_cfg(bankroll_bb=1500.0)
    df = sweep_parameter(cfg, "std_bb100", [60.0, 100.0, 160.0], n_paths=4000)
    r = df["risk_of_ruin"].to_numpy()
    assert r[0] < r[-1]


def test_sweep_preserves_requested_values():
    cfg = base_cfg()
    vals = [1500.0, 2500.0, 3500.0]
    df = sweep_parameter(cfg, "bankroll_bb", vals, n_paths=2000)
    assert list(df["bankroll_bb"]) == vals


def test_sweep_reproducible():
    cfg = base_cfg()
    a = sweep_parameter(cfg, "winrate_bb100", [0.0, 2.0, 4.0], n_paths=3000)
    b = sweep_parameter(cfg, "winrate_bb100", [0.0, 2.0, 4.0], n_paths=3000)
    assert np.allclose(a["risk_of_ruin"], b["risk_of_ruin"])


def test_sweep_skips_invalid_points():
    cfg = base_cfg(ruin_threshold_bb=0.0)
    # A bankroll of 0 is invalid (not above threshold) and must be skipped.
    df = sweep_parameter(cfg, "bankroll_bb", [0.0, 1000.0, 2000.0], n_paths=1500)
    assert 0.0 not in list(df["bankroll_bb"])
    assert len(df) == 2


def test_winrate_uncertainty_band_centered():
    cfg = base_cfg()
    df = winrate_uncertainty_sweep(cfg, 2.0, 2.0, n_points=5, n_paths=2000)
    assert df["winrate_bb100"].min() == pytest.approx(0.0)
    assert df["winrate_bb100"].max() == pytest.approx(4.0)
    assert "delta_from_estimate" in df


def test_required_bankroll_hits_target():
    cfg = base_cfg(winrate_bb100=2.0, bankroll_bb=2000.0)
    out = required_bankroll_for_target(
        cfg, 0.05, lo_bb=500.0, hi_bb=8000.0, n_paths=8000
    )
    assert out["bracketed"]
    assert out["risk_of_ruin"] <= 0.05 + 0.01


def test_required_bankroll_unreachable_flagged():
    # Negative edge: no bankroll in range keeps long-horizon ruin below 1%.
    cfg = base_cfg(winrate_bb100=-3.0, n_hands=200_000)
    out = required_bankroll_for_target(
        cfg, 0.01, lo_bb=1000.0, hi_bb=5000.0, n_paths=4000
    )
    assert out["bracketed"] is False


def test_risk_surface_shape():
    cfg = base_cfg()
    df = risk_surface(cfg, [1500.0, 3000.0], [0.0, 3.0, 6.0], n_paths=1500)
    assert len(df) == 6
    assert set(df.columns) == {"bankroll_bb", "winrate_bb100", "risk_of_ruin"}


def test_strongest_driver_returns_a_driver():
    cfg = base_cfg(bankroll_bb=1500.0)
    d = strongest_driver(cfg, n_paths=3000)
    assert d is not None
    assert d.parameter in {"winrate_bb100", "std_bb100", "bankroll_bb"}
    assert d.swing >= 0


def test_classify_risk_bands():
    assert classify_risk(0.005) == "Very low modeled ruin risk"
    assert classify_risk(0.03) == "Low modeled ruin risk"
    assert classify_risk(0.10) == "Material modeled ruin risk"
    assert classify_risk(0.20) == "High modeled ruin risk"
    assert classify_risk(0.60) == "Very high modeled ruin risk"


def test_presets_produce_valid_configs():
    for key in PRESET_BY_KEY:
        get_preset(key).to_config().validate()  # must not raise
