"""Independent cross-checks for the Monte Carlo ruin estimate.

Three methods, answering *slightly different questions*:

1. Infinite-horizon Brownian (gambler's ruin):
       P(ruin) approx  exp(-2 mu b / sigma^2)      (mu > 0)
   The classic closed form. It assumes an unbounded horizon, so for zero or
   negative drift it tends to 1.

2. Finite-horizon Brownian first-passage:
       P(min_{t<=T} X_t <= 0)  for X_0 = b, drift mu, variance sigma^2.
   This is the estimate most directly comparable to a finite-horizon Monte
   Carlo run.

3. Markov-chain absorption on a discretized bankroll grid, iterated for the
   same number of steps as the simulation (finite-step absorption).

Unit conventions (per hand):
    mu     = winrate_bb100 / 100                 (bb per hand)
    sigma2 = std_bb100 ** 2 / 100                (bb^2 per hand)
    b      = bankroll_bb - ruin_threshold_bb     (effective bankroll, bb)
    T      = n_hands                             (time, in hands)

Note that ``exp(-2 mu b / sigma^2)`` simplifies so the per-100 unit cancels:
``-2 * winrate_bb100 * b / std_bb100**2``.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy import sparse
from scipy.special import log_ndtr
from scipy.stats import norm

# ---------------------------------------------------------------------------
# Unit helpers
# ---------------------------------------------------------------------------


def per_hand_params(
    winrate_bb100: float, std_bb100: float
) -> tuple[float, float]:
    """Return (mu, sigma2) per hand from per-100-hand inputs."""
    mu = winrate_bb100 / 100.0
    sigma2 = std_bb100**2 / 100.0
    return mu, sigma2


# ---------------------------------------------------------------------------
# 5.1 Infinite-horizon Brownian approximation
# ---------------------------------------------------------------------------


def brownian_ruin_infinite(
    winrate_bb100: float,
    std_bb100: float,
    bankroll_bb: float,
    ruin_threshold_bb: float = 0.0,
) -> dict[str, Any]:
    """Infinite-horizon gambler's-ruin approximation.

    For non-positive drift the infinite-horizon ruin probability approaches 1.
    """
    b = bankroll_bb - ruin_threshold_bb
    if b <= 0:
        return {"probability": 1.0, "note": "effective bankroll <= 0"}
    if std_bb100 <= 0:
        # No variance: ruin only with negative drift (deterministic).
        prob = 1.0 if winrate_bb100 < 0 else 0.0
        return {"probability": prob, "note": "zero variance (deterministic)"}
    if winrate_bb100 <= 0:
        return {
            "probability": 1.0,
            "note": "non-positive drift -> ruin certain in the infinite horizon",
        }
    exponent = -2.0 * winrate_bb100 * b / (std_bb100**2)
    return {
        "probability": float(np.exp(exponent)),
        "note": "positive drift, infinite horizon",
    }


# ---------------------------------------------------------------------------
# 5.2 Finite-horizon Brownian first-passage
# ---------------------------------------------------------------------------


def brownian_ruin_finite(
    winrate_bb100: float,
    std_bb100: float,
    bankroll_bb: float,
    n_hands: int,
    ruin_threshold_bb: float = 0.0,
) -> dict[str, Any]:
    """Finite-horizon first-passage probability of hitting the ruin barrier.

    Uses the running-minimum law for Brownian motion with drift:

        P = Phi((-b - mu T)/(s sqrt(T)))
            + exp(-2 mu b / sigma^2) * Phi((-b + mu T)/(s sqrt(T)))

    computed in log-space for numerical stability.
    """
    b = bankroll_bb - ruin_threshold_bb
    if b <= 0:
        return {"probability": 1.0, "note": "effective bankroll <= 0"}

    mu, sigma2 = per_hand_params(winrate_bb100, std_bb100)
    T = float(n_hands)

    if sigma2 <= 0:
        # Deterministic drift line; ruin iff it crosses the barrier by T.
        crosses = (b + mu * T) <= 0
        return {
            "probability": 1.0 if crosses else 0.0,
            "note": "zero variance (deterministic)",
        }

    s = np.sqrt(sigma2)
    denom = s * np.sqrt(T)
    arg1 = (-b - mu * T) / denom
    arg2 = (-b + mu * T) / denom

    # term1 = Phi(arg1); term2 = exp(-2 mu b / sigma2) * Phi(arg2), stable.
    log_term1 = log_ndtr(arg1)
    log_factor = -2.0 * mu * b / sigma2
    log_term2 = log_factor + log_ndtr(arg2)
    prob = np.exp(log_term1) + np.exp(log_term2)
    prob = float(min(1.0, max(0.0, prob)))
    return {"probability": prob, "note": "finite horizon first-passage"}


# ---------------------------------------------------------------------------
# 5.3 Markov-chain absorption
# ---------------------------------------------------------------------------


def markov_chain_ruin(
    winrate_bb100: float,
    std_bb100: float,
    bankroll_bb: float,
    n_hands: int,
    ruin_threshold_bb: float = 0.0,
    step_hands: int = 100,
    state_bb: float | None = None,
    cap_bb: float | None = None,
    max_states: int = 4000,
    cap_mass_warn: float = 1e-3,
) -> dict[str, Any]:
    """Finite-step absorption probability on a discretized bankroll grid.

    The grid runs from the ruin threshold (absorbing state 0) up to an upper
    cap. This is *not* a reflecting boundary: any upper-tail probability mass
    that would leave the top of the grid is **aggregated into the highest
    represented bankroll state**. That truncation is only harmless when little
    mass reaches the cap, so ``mass_at_cap`` and a ``truncation_warning`` flag
    (triggered when the cap mass exceeds ``cap_mass_warn``) are returned as
    diagnostics.

    One-step transitions come from bucketed Normal increments over
    ``step_hands`` hands. The distribution is iterated ``n_hands / step_hands``
    times, and the mass in the ruin state is returned. This is a *finite-step*
    quantity, directly comparable to the finite-horizon Monte Carlo estimate.
    """
    b = bankroll_bb - ruin_threshold_bb
    if b <= 0:
        return {"probability": 1.0, "note": "effective bankroll <= 0"}
    if std_bb100 <= 0:
        return brownian_ruin_finite(
            winrate_bb100, std_bb100, bankroll_bb, n_hands, ruin_threshold_bb
        ) | {"note": "zero variance -> deterministic"}

    # Per-step Normal parameters (bb).
    mu_step = winrate_bb100 * step_hands / 100.0
    sd_step = std_bb100 * np.sqrt(step_hands / 100.0)

    # Choose the cap and resolution.
    if cap_bb is None:
        # Comfortably above the start: start + a large multiple of per-step sd.
        cap_bb = bankroll_bb + max(6.0 * sd_step, 2.0 * b)
    span = cap_bb - ruin_threshold_bb
    if state_bb is None:
        state_bb = span / 800.0  # ~800 interior states by default
    n_interior = int(np.ceil(span / state_bb))
    if n_interior + 1 > max_states:
        raise ValueError(
            "The selected Markov-chain resolution is too fine for interactive "
            f"calculation ({n_interior + 1} states > max_states={max_states}). "
            "Use a larger state interval or a lower bankroll cap."
        )

    # State 0 = ruin (absorbing). States 1..n_interior = bankroll bins,
    # centered at threshold + (i - 0.5) * state_bb.
    centers = ruin_threshold_bb + (np.arange(1, n_interior + 1) - 0.5) * state_bb
    # Bin edges (interior), plus barrier at threshold and cap at top edge.
    edges = ruin_threshold_bb + np.arange(0, n_interior + 1) * state_bb
    n_states = n_interior + 1  # + ruin state

    # Build transition matrix rows for interior states.
    rows, cols, vals = [], [], []
    # Ruin state -> ruin (absorbing).
    rows.append(0)
    cols.append(0)
    vals.append(1.0)

    # For each interior state, next = center + Normal(mu_step, sd_step).
    # P(next in bin j) = Phi(edge_{j} upper) - Phi(edge lower). Mass below
    # threshold -> ruin; mass above cap -> top interior state (reflecting).
    for i, c in enumerate(centers, start=1):
        # CDF at all interior edges (threshold .. cap) given this start.
        z = (edges - c) / sd_step - (mu_step / sd_step)
        cdf = norm.cdf(z)
        # Probability mass in each interior bin between consecutive edges.
        bin_mass = np.diff(cdf)  # length n_interior
        p_ruin = float(cdf[0])  # below threshold
        p_above = float(1.0 - cdf[-1])  # above cap

        rows.append(i)
        cols.append(0)
        vals.append(p_ruin)

        nz = np.nonzero(bin_mass)[0]
        for j in nz:
            rows.append(i)
            cols.append(j + 1)  # interior bins map to states 1..n_interior
            vals.append(float(bin_mass[j]))

        # Aggregate any over-cap mass into the top interior state (truncation,
        # NOT a reflecting boundary). Tracked via mass_at_cap below.
        if p_above > 0:
            rows.append(i)
            cols.append(n_interior)
            vals.append(p_above)

    P = sparse.csr_matrix((vals, (rows, cols)), shape=(n_states, n_states))

    # Row-sum diagnostic.
    row_sums = np.asarray(P.sum(axis=1)).ravel()
    max_row_err = float(np.max(np.abs(row_sums - 1.0)))

    # Initial distribution: all mass in the state containing the start.
    start_state = int(np.clip(
        np.searchsorted(edges, bankroll_bb, side="right"), 1, n_interior
    ))
    dist = np.zeros(n_states)
    dist[start_state] = 1.0

    n_steps = int(np.ceil(n_hands / step_hands))
    Pt = P.transpose().tocsr()
    for _ in range(n_steps):
        dist = Pt.dot(dist)

    prob_ruin = float(dist[0])
    prob_at_cap = float(dist[n_interior])  # mass aggregated at the top state
    return {
        "probability": prob_ruin,
        "n_states": n_states,
        "state_bb": float(state_bb),
        "cap_bb": float(cap_bb),
        "n_steps": n_steps,
        "max_row_sum_error": max_row_err,
        "mass_at_cap": prob_at_cap,
        "truncation_warning": bool(prob_at_cap > cap_mass_warn),
        "upper_boundary": "aggregated into highest state (not reflecting)",
        "note": "finite-step absorption",
    }


# ---------------------------------------------------------------------------
# 5.4 Comparison table
# ---------------------------------------------------------------------------


def validation_comparison(
    result: dict[str, Any],
    mc_risk: dict[str, Any],
    run_markov: bool = True,
    markov_kwargs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Assemble the Monte Carlo vs analytical vs Markov comparison.

    ``mc_risk`` is the dict from :func:`src.analytics.estimate_risk_of_ruin`.
    Differences are reported against the finite-horizon Brownian estimate,
    which is the most comparable analytical benchmark.
    """
    p = result["parameters"]
    wr, sd = p["winrate_bb100"], p["std_bb100"]
    bank, thr = p["bankroll_bb"], p["ruin_threshold_bb"]
    n_hands, step = p["n_hands"], p["step_hands"]

    finite = brownian_ruin_finite(wr, sd, bank, n_hands, thr)
    infinite = brownian_ruin_infinite(wr, sd, bank, thr)

    methods = {
        "monte_carlo_finite": mc_risk["point_estimate"],
        "monte_carlo_ci": (mc_risk["ci_low"], mc_risk["ci_high"]),
        "brownian_finite": finite["probability"],
        "brownian_infinite": infinite["probability"],
    }

    markov = None
    if run_markov:
        markov = markov_chain_ruin(
            wr, sd, bank, n_hands, thr, step_hands=step,
            **(markov_kwargs or {}),
        )
        methods["markov_chain"] = markov["probability"]

    # Differences vs the finite-horizon Brownian benchmark.
    ref = finite["probability"]
    diffs: dict[str, dict[str, float]] = {}
    for name in ("monte_carlo_finite", "brownian_infinite", "markov_chain"):
        if name in methods:
            val = methods[name]
            abs_d = abs(val - ref)
            rel_d = abs_d / ref if ref > 0 else float("nan")
            diffs[name] = {"absolute": abs_d, "relative": rel_d}

    # Neutral consistency wording for MC vs finite-horizon Brownian.
    mc_val = methods["monte_carlo_finite"]
    lo, hi = methods["monte_carlo_ci"]
    if lo <= ref <= hi:
        verdict = "consistent within simulation uncertainty"
    elif abs(mc_val - ref) <= max(0.02, 0.25 * ref):
        verdict = "directionally consistent"
    else:
        verdict = (
            "difference likely reflects finite-horizon or discretization "
            "assumptions"
        )

    return {
        "methods": methods,
        "finite": finite,
        "infinite": infinite,
        "markov": markov,
        "differences_vs_finite": diffs,
        "verdict_mc_vs_finite": verdict,
    }
