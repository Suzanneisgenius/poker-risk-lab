"""Does the page's posterior bankroll calculation agree with the Python research code?

The page (server/bankroll_posterior.js) and this script compute the same model
separately:

                         page                          this script
  posterior              its own conjugate update      src.bayes.normal_normal_posterior
  normal CDF, quantile   Chebyshev erfc, AS 241        scipy log_ndtr (in src.validation), norm.ppf
  model risk R(mu)       brownFinite                   src.validation.brownian_ruin_finite
  average risk           closed form                   adaptive quadrature over the posterior
  bankroll needed        bisection                     Brent's method

The average risk is also compared with src.bayes.posterior_risk, the research
pipeline's own Monte Carlo average over 20,000 posterior draws.

This is an internal check: both sides are this repository's code and share the
model, so agreement shows that the page computes what the research code
computes, not that the model describes real results.

    python -I checks/bankroll-posterior-python/run.py            # print
    python -I checks/bankroll-posterior-python/run.py --write    # also save results.json
    python -I checks/bankroll-posterior-python/run.py --check    # compare with results.json
    pytest tests/test_web_bankroll_posterior.py                  # the same comparison, in CI

It reads web.json, which ours.js writes, so it needs no Node.
"""

from __future__ import annotations

import json
import math
import os
import platform
import sys
from importlib.metadata import version

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, REPO)

from scipy import integrate, optimize  # noqa: E402
from scipy.stats import norm  # noqa: E402

from src.bayes import (  # noqa: E402
    empirical_prior, normal_normal_posterior, posterior_risk, skeptical_prior, weakly_informative_prior,
)
from src.validation import brownian_ruin_finite  # noqa: E402

PRIORS = {"none": empirical_prior(), "weak": weakly_informative_prior(10.0), "skeptical": skeptical_prior(2.0)}
LEVEL = 0.95
MC_DRAWS, MC_SEED = 20_000, 0
# The page's normal CDF has a relative error below 1.2e-7; everything else is
# exact to rounding, so these leave room only for that.
TOLERANCE = {"probability": 1e-6, "win_rate": 1e-9, "bankroll_relative": 1e-5, "hands": 1, "mc_se": 4.0}


def risk(mu: float, sd: float, bank: float, thr: float, horizon: int) -> float:
    return brownian_ruin_finite(mu, sd, bank, horizon, thr)["probability"]


def average_risk(mean: float, std: float, sd: float, bank: float, thr: float, horizon: int) -> float:
    """E[R(mu)] over mu ~ N(mean, std^2) by adaptive quadrature in z = (mu - mean) / std."""
    def at(z: float) -> float:
        return risk(mean + std * z, sd, bank, thr, horizon)
    # R falls from 1 to 0 around one win rate; tell quad where.
    try:
        points = [optimize.brentq(lambda z: at(z) - 0.5, -12, 12)]
    except ValueError:
        points = None
    value, _ = integrate.quad(lambda z: at(z) * norm.pdf(z), -12, 12, points=points,
                              epsabs=1e-13, epsrel=1e-11, limit=500)
    return value


def bankroll_for(risk_at, target: float, thr: float, scale: float) -> float:
    high = thr + max(1.0, scale)
    while risk_at(high) > target:
        high = thr + 2 * (high - thr)
    return optimize.brentq(lambda b: risk_at(b) - target, thr + 1e-12, high, xtol=1e-12, rtol=1e-14, maxiter=500)


def evaluate(p: dict, sd: float, prior: str, hands: int) -> dict:
    se = p["seMultiplier"] * sd / math.sqrt(hands / 100)
    post = normal_normal_posterior(p["winRate"], se, PRIORS[prior])
    low, high = post.credible_interval(LEVEL)
    credible = post.mean - float(norm.ppf(p["credibility"])) * post.std
    prior_precision = 0.0 if math.isinf(PRIORS[prior].std) else 1 / PRIORS[prior].std ** 2
    bank, thr, horizon, target = p["bank"] * p["bbPerBuyIn"], p["thr"] * p["bbPerBuyIn"], p["horizon"], p["target"]
    scale = sd * math.sqrt(horizon / 100)
    target_win_rate = optimize.brentq(lambda mu: risk(mu, sd, bank, thr, horizon) - target, -1e4, 1e4,
                                      xtol=1e-13, rtol=1e-15, maxiter=500)
    return {
        "post": post, "se": se, "interval": [low, high], "credible": credible,
        "data_weight": (1 / se ** 2) / (1 / se ** 2 + prior_precision),
        "plug_in": risk(p["winRate"], sd, bank, thr, horizon),
        "average": average_risk(post.mean, post.std, sd, bank, thr, horizon),
        "median": risk(post.mean, sd, bank, thr, horizon),
        "risk_interval": [risk(high, sd, bank, thr, horizon), risk(low, sd, bank, thr, horizon)],
        "upper": risk(credible, sd, bank, thr, horizon),
        "prob_at_most_target": float(norm.sf((target_win_rate - post.mean) / post.std)),
        "bankroll_credible": bankroll_for(lambda b: risk(credible, sd, b, thr, horizon), target, thr, scale),
        "params": (bank, thr, horizon, target, scale),
    }


def sample_hands(sd: float, margin: float, level: float, multiplier: float = 1.0) -> float:
    return 100 * (float(norm.ppf(0.5 + level / 2)) * sd * multiplier / margin) ** 2


class Diff:
    """Largest differences by kind, and every comparison that broke tolerance."""

    def __init__(self) -> None:
        self.max = {"probability": 0.0, "win_rate": 0.0, "bankroll_relative": 0.0, "hands": 0.0}
        self.count = 0
        self.failures: list[str] = []

    def add(self, kind: str, name: str, web: float, py: float) -> None:
        diff = abs(web - py) / abs(py) if kind == "bankroll_relative" else abs(web - py)
        self.max[kind] = max(self.max[kind], diff)
        self.count += 1
        if diff > TOLERANCE[kind]:
            self.failures.append(f"{name}: web {web!r}, python {py!r}")


def compare_case(case: dict, mc: bool = True, seed: int = MC_SEED) -> dict:
    web, inp = case["result"], case["result"]["inputs"]
    p = {**inp}
    d = Diff()
    main = evaluate(p, inp["sd"], inp["prior"], inp["hands"])
    bank, thr, horizon, target, scale = main["params"]
    post = main["post"]

    w = web["winRate"]
    d.add("win_rate", "standard error", w["standardError"], main["se"])
    d.add("win_rate", "posterior mean", w["mean"], post.mean)
    d.add("win_rate", "posterior sd", w["sd"], post.std)
    for i in (0, 1):
        d.add("win_rate", f"win-rate interval[{i}]", w["interval"][i], main["interval"][i])
    d.add("win_rate", "credible win rate", w["credible"], main["credible"])
    d.add("probability", "P(win rate > 0)", w["probPositive"], post.prob_positive)
    d.add("probability", "data weight", w["dataWeight"], main["data_weight"])

    r = web["risk"]
    for key, py in (("plugIn", main["plug_in"]), ("average", main["average"]), ("median", main["median"]),
                    ("upper", main["upper"]), ("probAtMostTarget", main["prob_at_most_target"])):
        d.add("probability", f"risk.{key}", r[key], py)
    for i in (0, 1):
        d.add("probability", f"risk interval[{i}]", r["interval"][i], main["risk_interval"][i])

    b = web["bankroll"]
    d.add("bankroll_relative", "bankroll (posterior bound)", b["credible"]["bb"], main["bankroll_credible"])
    d.add("bankroll_relative", "bankroll (average risk)", b["average"]["bb"],
          bankroll_for(lambda x: average_risk(post.mean, post.std, inp["sd"], x, thr, horizon), target, thr, scale))
    d.add("bankroll_relative", "bankroll (observed win rate)", b["plugIn"]["bb"],
          bankroll_for(lambda x: risk(inp["winRate"], inp["sd"], x, thr, horizon), target, thr, scale))

    s = web["sampleSize"]
    total = sample_hands(inp["sd"], inp["margin"], inp["sampleLevel"], inp["seMultiplier"])
    d.add("hands", "hands for the interval", s["totalHands"], total)
    d.add("win_rate", "current half-width", s["currentHalfWidth"],
          float(norm.ppf(0.5 + inp["sampleLevel"] / 2)) * inp["sd"] * inp["seMultiplier"] / math.sqrt(inp["hands"] / 100))

    # Every row of the three "how the answer changes" tables.
    rows = {"volatility": [], "prior": [], "sample": []}
    for kind, args in (("volatility", lambda row: (row["sd"], inp["prior"], inp["hands"])),
                       ("prior", lambda row: (inp["sd"], row["prior"], inp["hands"])),
                       ("sample", lambda row: (inp["sd"], inp["prior"], row["hands"]))):
        for row in web["sensitivity"][kind]:
            py = evaluate(p, *args(row))
            name = f"{kind} {row.get('sd', row.get('prior', row.get('hands')))}"
            d.add("win_rate", f"{name} posterior mean", row["posteriorMean"], py["post"].mean)
            for i in (0, 1):
                d.add("win_rate", f"{name} interval[{i}]", row["interval"][i], py["interval"][i])
            d.add("probability", f"{name} P(win rate > 0)", row["probPositive"], py["post"].prob_positive)
            d.add("probability", f"{name} average risk", row["averageRisk"], py["average"])
            d.add("probability", f"{name} upper risk", row["upperRisk"], py["upper"])
            d.add("bankroll_relative", f"{name} bankroll", row["requiredBuyIns"] * inp["bbPerBuyIn"], py["bankroll_credible"])
            if kind == "volatility":
                d.add("hands", f"{name} hands for the interval", row["handsForMargin"],
                      sample_hands(row["sd"], inp["margin"], inp["sampleLevel"], inp["seMultiplier"]))
                # Rows for the ends of an estimated volatility's interval are not assumptions.
                if row.get("bound") and row["sd"] not in (70, 90, 120, 150):
                    continue
            rows[kind].append(py)

    # Which input moves the risk most, recomputed from the Python rows.
    spans = {
        "winRate": main["risk_interval"][1] - main["risk_interval"][0],
        "volatility": max(x["average"] for x in rows["volatility"]) - min(x["average"] for x in rows["volatility"]),
        "prior": max(x["average"] for x in rows["prior"]) - min(x["average"] for x in rows["prior"]),
    }
    widest_matches = web["sources"]["widest"] == max(spans, key=spans.get)
    if not widest_matches:
        d.failures.append(f"widest source: web {web['sources']['widest']}, python {max(spans, key=spans.get)}")

    # The risk-against-bankroll chart, point by point.
    curve = web["curve"]
    for i, buy_ins in enumerate(curve["bankroll"]):
        x = buy_ins * inp["bbPerBuyIn"]
        d.add("probability", f"curve plug-in {i}", curve["plugIn"][i], risk(inp["winRate"], inp["sd"], x, thr, horizon))
        d.add("probability", f"curve average {i}", curve["average"][i], average_risk(post.mean, post.std, inp["sd"], x, thr, horizon))
        d.add("probability", f"curve upper {i}", curve["upper"][i], risk(main["credible"], inp["sd"], x, thr, horizon))

    out = {
        "id": case["id"], "comparisons": d.count,
        "largest_difference": {k: float(f"{v:.1e}") for k, v in d.max.items()},
        "widest_source": web["sources"]["widest"], "widest_source_matches": widest_matches,
        "failures": d.failures,
    }
    if mc:
        # The research pipeline's own Monte Carlo average over posterior draws.
        draws = posterior_risk(post, std_bb100=inp["sd"], bankroll_bb=bank, n_hands=horizon, ruin_threshold_bb=thr,
                               n_draws=MC_DRAWS, seed=seed)
        se = draws["risk_std"] / math.sqrt(MC_DRAWS)
        z = (r["average"] - draws["expected_risk"]) / se if se > 0 else 0.0
        out["posterior_draws"] = {"draws": MC_DRAWS, "seed": seed, "average": round(draws["expected_risk"], 6),
                                  "difference_in_se": round(z, 2)}
        if abs(z) > TOLERANCE["mc_se"]:
            d.failures.append(f"average risk {r['average']} is {z:+.2f} SE from posterior_risk")
    out["passed"] = not d.failures
    return out


def run(mc: bool = True) -> dict:
    with open(os.path.join(HERE, "web.json")) as f:
        web = json.load(f)
    # A separate seed per case, so the cases are independent Monte Carlo checks.
    cases = [compare_case(case, mc, MC_SEED + i) for i, case in enumerate(web["cases"])]
    return {
        "purpose": "Internal check: the page's posterior bankroll calculation against the Python research code and scipy.",
        "command": "python -I checks/bankroll-posterior-python/run.py --check",
        "model": web["model"],
        "tolerance": TOLERANCE,
        "environment": {"python": platform.python_version(), "scipy": version("scipy"), "numpy": version("numpy")},
        "cases": cases,
        "comparisons": sum(c["comparisons"] for c in cases),
        "all_passed": all(c["passed"] for c in cases),
    }


def main() -> None:
    result = run()
    text = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    path = os.path.join(HERE, "results.json")
    if "--check" in sys.argv:
        with open(path) as f:
            if f.read() != text:
                sys.exit(f"Results differ from {os.path.relpath(path, REPO)}.")
        print(f"Results match {os.path.relpath(path, REPO)}.")
        return
    if "--write" in sys.argv:
        with open(path, "w") as f:
            f.write(text)
    for c in result["cases"]:
        largest = c["largest_difference"]
        print(f"  {c['id']:<40} {c['comparisons']:>4} numbers  prob {largest['probability']:.1e}  "
              f"bankroll {largest['bankroll_relative']:.1e}  draws {c['posterior_draws']['difference_in_se']:+.2f} SE  "
              f"{'pass' if c['passed'] else 'FAIL'}")
        for failure in c["failures"]:
            print(f"      {failure}")
    print(f"{result['comparisons']} numbers compared. " + ("All passed." if result["all_passed"] else "FAILED."))
    if not result["all_passed"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
