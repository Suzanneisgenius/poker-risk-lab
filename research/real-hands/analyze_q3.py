"""Question 3 of proposal direction B: how are true win rates spread across players?

Chapter 2 of the case study puts a Normal prior on the win rate, centred at 0
with SD 10 bb/100. That is an assumption. Here the spread of true win rates is
estimated from the PartyPoker and Ongame $2/$4 tables with a hierarchical
(empirical Bayes) Normal model:

    observed win rate x_i ~ N(mu_i, se_i^2),    mu_i ~ N(m, tau^2),

with se_i from the player's own per-hand standard deviation. Hands are treated
as independent, which questions 1 and 2 support.

Population: players with at least 1,000 usable hands at one site's $2/$4 tables
in the 23 days. IDs are per site, so someone who played on both sites counts
twice. Win rates rise with volume, so the model is fitted within volume brackets
and the population is the player-weighted mixture of the bracket fits.

Checks:
- shape: a nonparametric prior (NPMLE on a grid) against the Normal;
- spread without standard errors: the covariance of each player's odd-hand and
  even-hand win rates, which estimates tau^2 directly;
- selection: with the month split at each site's median hand time, does
  first-period volume still predict second-period win rate?
- prediction: predict each player's later half of hands from the earlier half
  under each prior, and score against what happened.

Chapter 2 is then rerun with the fitted priors through the case study's own code
(src/experiments/case_study.py). The summary numbers used by the live tool and
the case study are copied from these results into configs/population_priors.json.

Usage, from the repository root (-B keeps bytecode out of the repository):
    python -I -B research/real-hands/analyze_q3.py <derived dir> [output dir]
The derived dir is build_tables.py's output; the output dir defaults to
reports/real-hands/q3.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import optimize, stats

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "reports" / "real-hands" / "q3"
MIN_HANDS = 1000
THRESHOLDS = (500, 1000, 2500, 5000, 10000)
BRACKETS = ((1000, 2500), (2500, 5000), (5000, 10000), (10000, None))
REGULARS = 10000
GRID = np.linspace(-40.0, 30.0, 281)          # NPMLE support, bb/100, step 0.25
NPMLE_ITERS = 5000
N_BOOT = 2000
SEED = 20261101
CASE_PRIOR = {"mean": 0.0, "std": 10.0}       # configs/case_study/uncertainty.yaml
PERIOD_BRACKETS = ((500, 1250), (1250, 2500), (2500, 5000), (5000, None))
MIN_RETURN = 300                              # second-period hands to count as returning
Z95 = float(stats.norm.ppf(0.975))


# ---------------------------------------------------------------------------
# Data

def load_hands(derived):
    p = pd.read_parquet(derived / "player_hands.parquet",
                        columns=["site", "player", "ts", "table", "hand_id", "net_bb", "status"])
    p = p[p.status == "ok"].drop(columns="status")
    p = p.sort_values(["site", "player", "ts", "table", "hand_id"], kind="stable").reset_index(drop=True)
    p["unit"] = p.site + ":" + p.player
    return p


def win_rates(p, by=None):
    """Hands, win rate (bb/100) and its standard error per player, or per player and `by`."""
    keys = ["unit"] if by is None else ["unit", by]
    g = p.groupby(keys, sort=False).net_bb.agg(n="size", s="sum", v="var")
    return pd.DataFrame({"n": g.n, "wr": 100 * g.s / g.n, "se": 100 * np.sqrt(g.v / g.n)})


def bracket_label(lo, hi):
    return f"{lo:,}+" if hi is None else f"{lo:,}-{hi - 1:,}"


def in_bracket(n, lo, hi):
    return (n >= lo) & (True if hi is None else n < hi)


# ---------------------------------------------------------------------------
# Hierarchical Normal model and checks

def normal_fit(x, se):
    """Maximum likelihood (m, tau) for x_i ~ N(m, tau^2 + se_i^2); m is profiled out."""
    def profile(tau):
        w = 1.0 / (tau * tau + se * se)
        m = np.sum(w * x) / np.sum(w)
        return m, 0.5 * np.sum(np.log(w) - w * (x - m) ** 2) - 0.5 * x.size * np.log(2 * np.pi)
    r = optimize.minimize_scalar(lambda t: -profile(t)[1], bounds=(0.0, 40.0), method="bounded",
                                 options={"xatol": 1e-6})
    tau = r.x if profile(r.x)[1] >= profile(0.0)[1] else 0.0
    m, ll = profile(tau)
    return float(m), float(tau), float(ll)


def npmle(x, se):
    """Kiefer-Wolfowitz nonparametric prior on GRID by EM; returns weights and log-likelihood."""
    L = stats.norm.pdf(x[:, None], GRID[None, :], se[:, None])
    w = np.full(GRID.size, 1.0 / GRID.size)
    for _ in range(NPMLE_ITERS):
        w = w * (L / (L @ w)[:, None]).mean(0)
    return w, float(np.log(L @ w).sum())


def ci(a):
    return [float(np.percentile(a, 2.5)), float(np.percentile(a, 97.5))]


def fit_with_ci(d, rng):
    x, se = d.wr.to_numpy(), d.se.to_numpy()
    m, tau, ll = normal_fit(x, se)
    bt = np.array([normal_fit(x[i], se[i])[:2] for i in (rng.integers(0, x.size, x.size) for _ in range(N_BOOT))])
    return {"players": int(x.size), "hands": int(d.n.sum()), "m": m, "m_ci": ci(bt[:, 0]),
            "tau": tau, "tau_ci": ci(bt[:, 1]), "loglik": ll,
            "tau_zero_lr": float(2 * (ll - normal_fit_fixed_tau(x, se, 0.0))),
            "raw_mean": float(x.mean()), "raw_sd": float(x.std(ddof=1)),
            "rms_se": float(np.sqrt(np.mean(se ** 2))), "_boot": bt}


def normal_fit_fixed_tau(x, se, tau):
    w = 1.0 / (tau * tau + se * se)
    m = np.sum(w * x) / np.sum(w)
    return 0.5 * np.sum(np.log(w) - w * (x - m) ** 2) - 0.5 * x.size * np.log(2 * np.pi)


def odd_even(d, rng):
    """Covariance across players of odd-hand and even-hand win rates: an estimate of tau^2."""
    a, b = d.wr_odd.to_numpy(), d.wr_even.to_numpy()
    c = float(np.cov(a, b)[0, 1])
    bt = [np.cov(a[i], b[i])[0, 1] for i in (rng.integers(0, a.size, a.size) for _ in range(N_BOOT))]
    lo, hi = ci(bt)
    return {"cov": c, "cov_ci": [lo, hi], "tau_upper_95": float(np.sqrt(max(hi, 0.0)))}


def mixture_summary(comps):
    """Mean, SD and quantiles of a player-weighted mixture of Normal components."""
    w = np.array([c["weight"] for c in comps]); m = np.array([c["m"] for c in comps])
    s = np.array([max(c["tau"], 1e-9) for c in comps])
    mean = float(w @ m)
    sd = float(np.sqrt(w @ (s ** 2 + m ** 2) - mean ** 2))
    xs = np.linspace(-60, 60, 24001)
    cdf = (w[:, None] * stats.norm.cdf(xs[None, :], m[:, None], s[:, None])).sum(0)
    q = {str(a): float(xs[np.searchsorted(cdf, a)]) for a in (0.025, 0.1, 0.25, 0.5, 0.75, 0.9, 0.975)}
    return {"mean": mean, "sd": sd, "quantiles": q, "share_above_0": float(1 - np.interp(0, xs, cdf))}


# ---------------------------------------------------------------------------
# Analyses

def population(p, rng):
    wr = win_rates(p)
    parity = win_rates(p, p.groupby("unit", sort=False).cumcount().mod(2).rename("odd"))
    parity = parity.wr.unstack("odd").rename(columns={0: "wr_even", 1: "wr_odd"})
    wr = wr.join(parity)
    out = {"thresholds": {}, "brackets": {}}
    for t in THRESHOLDS:
        d = wr[wr.n >= t]
        f = fit_with_ci(d, rng)
        w, ll_np = npmle(d.wr.to_numpy(), d.se.to_numpy())
        mean = float(w @ GRID)
        f["npmle"] = {"mean": mean, "sd": float(np.sqrt(w @ (GRID - mean) ** 2)),
                      "loglik_gain_vs_normal": ll_np - f["loglik"],
                      "weights": w.tolist() if t in (MIN_HANDS, REGULARS) else None}
        f["odd_even"] = odd_even(d, rng)
        f.pop("_boot")
        out["thresholds"][str(t)] = f
        print(f">= {t}: m {f['m']:.2f} tau {f['tau']:.2f}", flush=True)
    boots = []
    for lo, hi in BRACKETS:
        d = wr[in_bracket(wr.n, lo, hi)]
        f = fit_with_ci(d, rng)
        f["odd_even"] = odd_even(d, rng)
        f["sites"] = {s: {k: v for k, v in zip(("m", "tau"), normal_fit(e.wr.to_numpy(), e.se.to_numpy())[:2])}
                      | {"players": int(len(e))}
                      for s, e in d.groupby(d.index.str[:3])}
        boots.append(f.pop("_boot"))
        out["brackets"][bracket_label(lo, hi)] = f
    total = sum(b["players"] for b in out["brackets"].values())
    comps = [{"weight": b["players"] / total, "m": b["m"], "tau": b["tau"]} for b in out["brackets"].values()]
    mix = mixture_summary(comps)
    mb = np.array([[v for v in mixture_summary([c | {"m": bt[j, 0], "tau": bt[j, 1]}
                                                for c, bt in zip(comps, boots)]).values()][:2]
                   for j in range(N_BOOT)])
    mix |= {"mean_ci": ci(mb[:, 0]), "sd_ci": ci(mb[:, 1]), "components": comps}
    out["mixture"] = mix
    out["sites_pooled"] = {s: dict(zip(("m", "tau"), normal_fit(e.wr.to_numpy(), e.se.to_numpy())[:2]))
                           | {"players": int(len(e))}
                           for s, e in wr[wr.n >= MIN_HANDS].groupby(lambda u: u[:3])}
    return out


def rake_check(p, derived):
    h = pd.read_parquet(derived / "hands.parquet", columns=["site", "hand_id", "bb_usd", "rake_usd", "status"])
    h = h[h.status == "ok"]
    out = {}
    for s in ("ONG", "PTY"):
        seats = int((p.site == s).sum())
        out[s] = {"seat_hands": seats,
                  "mean_net_bb100": float(100 * p.net_bb[p.site == s].mean()),
                  "rake_bb100_per_seat": float(100 * (h.rake_usd / h.bb_usd)[h.site == s].sum() / seats)}
    return out


def periods(p, rng):
    """Volume in the first half of the month against win rate in the second half."""
    cut = p.groupby("site").ts.transform("median")
    late = (p.ts > cut).rename("late")
    w = win_rates(p, late).unstack("late")
    w.columns = [f"{a}{int(b) + 1}" for a, b in w.columns]
    w = w.fillna({"n1": 0, "n2": 0})
    out = {"cut": {s: str(t) for s, t in p.groupby("site").ts.median().items()}, "brackets": {}}
    for lo, hi in PERIOD_BRACKETS:
        d = w[in_bracket(w.n1, lo, hi)]
        r = d[d.n2 >= MIN_RETURN]
        row = {"players": int(len(d)), "returned": int(len(r)), "returned_share": float(len(r) / len(d))}
        for tag, x, se in (("first_all", d.wr1, d.se1), ("first_returned", r.wr1, r.se1),
                           ("second_returned", r.wr2, r.se2)):
            f = fit_with_ci(pd.DataFrame({"wr": x, "se": se, "n": 0}), rng)
            row[tag] = {"m": f["m"], "m_ci": f["m_ci"], "tau": f["tau"], "tau_ci": f["tau_ci"]}
        out["brackets"][bracket_label(lo, hi)] = row
    return out


def predictions(p, rng):
    """Predict each player's later half of hands from the earlier half under each prior."""
    k = p.groupby("unit", sort=False).cumcount()
    n = p.groupby("unit", sort=False).net_bb.transform("size")
    keep = n >= MIN_HANDS
    q = p[keep]
    w = win_rates(q, (k[keep] >= n[keep] // 2).rename("later")).unstack("later")
    w.columns = [f"{a}{int(b) + 1}" for a, b in w.columns]
    total = w.n1 + w.n2
    m_pool, tau_pool, _ = normal_fit(w.wr1.to_numpy(), w.se1.to_numpy())
    m_br = np.zeros(len(w)); tau_br = np.zeros(len(w)); fits = {}
    for lo, hi in BRACKETS:
        sel = in_bracket(total, lo, hi).to_numpy()
        m, tau, _ = normal_fit(w.wr1.to_numpy()[sel], w.se1.to_numpy()[sel])
        m_br[sel], tau_br[sel] = m, tau
        a1, s1, a2, s2 = (w[c].to_numpy()[sel] for c in ("wr1", "se1", "wr2", "se2"))
        m2, tau2, _ = normal_fit(a2, s2)
        diff = [normal_fit(a2[i], s2[i])[0] - normal_fit(a1[i], s1[i])[0]
                for i in (rng.integers(0, a1.size, a1.size) for _ in range(N_BOOT))]
        fits[bracket_label(lo, hi)] = {"m": m, "tau": tau, "players": int(sel.sum()),
                                       "later_half_m": m2, "later_half_tau": tau2,
                                       "later_minus_earlier": m2 - m, "later_minus_earlier_ci": ci(diff)}
    priors = {
        "none (raw first-half win rate)": (np.zeros(len(w)), np.full(len(w), np.inf)),
        "case study N(0, 10^2)": (np.full(len(w), CASE_PRIOR["mean"]), np.full(len(w), CASE_PRIOR["std"])),
        "fitted, one Normal for all": (np.full(len(w), m_pool), np.full(len(w), tau_pool)),
        "fitted, by volume bracket": (m_br, tau_br),
    }
    x1, se1, x2, se2 = (w[c].to_numpy() for c in ("wr1", "se1", "wr2", "se2"))
    reg = (total >= REGULARS).to_numpy()
    out = {"players": int(len(w)), "half_fits": {"pooled": {"m": m_pool, "tau": tau_pool}, "brackets": fits},
           "priors": {}}
    for name, (m, tau) in priors.items():
        prec = np.where(np.isinf(tau), 0.0, 1.0 / np.maximum(tau, 1e-6) ** 2)
        pv = 1.0 / (prec + 1.0 / se1 ** 2)
        pred = pv * (prec * m + x1 / se1 ** 2)
        sd = np.sqrt(pv + se2 ** 2)
        row = {}
        for tag, s in (("all", np.ones(len(w), bool)), ("regulars", reg)):
            err2 = (x2[s] - pred[s]) ** 2
            excess = float(np.mean(err2) - np.mean(se2[s] ** 2))
            row[tag] = {"players": int(s.sum()), "mse": float(np.mean(err2)),
                        "rmse_true_rate": float(np.sqrt(max(excess, 0.0))),
                        "coverage95": float(np.mean(np.abs(x2[s] - pred[s]) <= Z95 * sd[s]))}
        out["priors"][name] = row
    base = out["priors"]["none (raw first-half win rate)"]
    for row in out["priors"].values():
        for tag in ("all", "regulars"):
            row[tag]["mse_vs_raw"] = row[tag]["mse"] / base[tag]["mse"]
    return out


# ---------------------------------------------------------------------------
# Chapter 2 of the case study under the fitted priors

def chapter2(repo, pop):
    sys.path.insert(0, str(repo))
    from src.bayes import conditional_ruin_risk
    from src.experiments.case_study import case_uncertainty, load_config

    cfg = load_config("uncertainty")
    stored = json.loads((repo / "reports" / "case-study" / "uncertainty.json").read_text())
    reg = pop["thresholds"][str(REGULARS)]
    mix = pop["mixture"]
    normals = {
        "case study, N(0, 10^2)": cfg["prior"],
        "players with 1,000+ hands (Normal, same mean and SD as the mixture)":
            {"kind": "custom", "mean": mix["mean"], "std": mix["sd"]},
        "players with 1,000+ hands (one Normal fitted to all)":
            {"kind": "custom", "mean": pop["thresholds"][str(MIN_HANDS)]["m"],
             "std": pop["thresholds"][str(MIN_HANDS)]["tau"]},
        f"regulars, {REGULARS:,}+ hands": {"kind": "custom", "mean": reg["m"], "std": reg["tau"]},
    }
    out = {"scenario": cfg["scenario"], "observed_winrate_bb100": cfg["observed_winrate_bb100"],
           "n_draws": cfg["n_draws"], "seed": cfg["seed"], "level": cfg["level"], "priors": {}}
    for name, prior in normals.items():
        r = case_uncertainty(cfg | {"prior": prior})
        out["priors"][name] = {"prior": prior, "history": r["history"], "plug_in_risk": r["plug_in_risk"],
                               "engine": "case_study.case_uncertainty"}
    diffs = [abs(u - v) for a, b in zip(out["priors"]["case study, N(0, 10^2)"]["history"], stored["history"])
             for u, v in zip(a["risk_interval"] + [a["expected_risk"]], b["risk_interval"] + [b["expected_risk"]])]
    out["max_diff_from_stored_chapter2"] = max(diffs)

    # The mixture itself: the posterior is a mixture of Normal posteriors.
    sc = cfg["scenario"]; obs = cfg["observed_winrate_bb100"]
    w = np.array([c["weight"] for c in mix["components"]]); m = np.array([c["m"] for c in mix["components"]])
    t2 = np.array([max(c["tau"], 1e-6) ** 2 for c in mix["components"]])
    hist = []
    for hands in cfg["history_hands"]:
        se = sc["std_bb100"] / np.sqrt(hands / 100)
        like = w * stats.norm.pdf(obs, m, np.sqrt(t2 + se ** 2)); pw = like / like.sum()
        pv = 1 / (1 / t2 + 1 / se ** 2); pm = pv * (m / t2 + obs / se ** 2)
        rng = np.random.default_rng(cfg["seed"])
        j = rng.choice(w.size, cfg["n_draws"], p=pw)
        mus = rng.normal(pm[j], np.sqrt(pv[j]))
        risks = np.array([conditional_ruin_risk(u, sc["std_bb100"], sc["bankroll_bb"], sc["n_hands"],
                                                sc.get("ruin_threshold_bb", 0.0)) for u in mus])
        a = (1 - cfg["level"]) / 2
        hist.append({"hands": hands, "winrate_standard_error": float(se),
                     "winrate_interval": [float(v) for v in np.quantile(mus, [a, 1 - a])],
                     "risk_interval": [float(v) for v in np.quantile(risks, [a, 1 - a])],
                     "expected_risk": float(risks.mean()), "median_risk": float(np.median(risks)),
                     "p_risk_above_10pct": float(np.mean(risks > 0.10)),
                     "component_weights": pw.tolist()})
    out["priors"]["players with 1,000+ hands (mixture of brackets)"] = {
        "prior": {"kind": "mixture", "components": mix["components"]}, "history": hist,
        "engine": "this script; risk per draw from src.bayes.conditional_ruin_risk"}
    return out


# ---------------------------------------------------------------------------

def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=True).stdout.strip()


def main(derived, out=OUT):
    derived, out, repo = Path(derived), Path(out), REPO
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(SEED)
    p = load_hands(derived)
    results = {"settings": {"min_hands": MIN_HANDS, "thresholds": THRESHOLDS,
                            "brackets": [bracket_label(*b) for b in BRACKETS], "regulars": REGULARS,
                            "npmle_grid": [GRID[0], GRID[-1], GRID.size], "npmle_iterations": NPMLE_ITERS,
                            "bootstrap": N_BOOT, "seed": SEED, "case_prior": CASE_PRIOR,
                            "period_brackets": [bracket_label(*b) for b in PERIOD_BRACKETS],
                            "min_return_hands": MIN_RETURN}}
    results["rake_check"] = rake_check(p, derived)
    results["population"] = population(p, rng)
    results["periods"] = periods(p, rng)
    results["prediction"] = predictions(p, rng)
    results["chapter2"] = chapter2(repo, results["population"])
    build = json.loads((derived / "build_report.json").read_text())
    results["provenance"] = {
        "derived_tables": {f: sha256(derived / f) for f in ("player_hands.parquet", "hands.parquet",
                                                            "build_report.json")},
        "build_inputs": build.get("inputs"),
        "repo_files_sha256": {f: sha256(repo / f) for f in ("src/bayes.py", "src/validation.py",
                                                            "src/experiments/case_study.py",
                                                            "configs/case_study/uncertainty.yaml")},
        "repo_commit": git(repo, "rev-parse", "--short", "HEAD"),
        "repo_uncommitted_changes": bool(git(repo, "status", "--porcelain", "--", "src", "configs", "research")),
        "script_sha256": sha256(__file__),
        "versions": {"python": sys.version.split()[0], "numpy": np.__version__,
                     "pandas": pd.__version__, "scipy": __import__("scipy").__version__},
    }
    (out / "results.json").write_text(json.dumps(results, indent=1))
    write_tables(results, out)


def write_tables(r, out):
    pop = r["population"]
    rows = [{"group": f"{k}+ hands", **{c: v for c, v in f.items() if not isinstance(v, (dict, list))},
             "m_lo": f["m_ci"][0], "m_hi": f["m_ci"][1], "tau_lo": f["tau_ci"][0], "tau_hi": f["tau_ci"][1],
             "npmle_mean": f["npmle"]["mean"], "npmle_sd": f["npmle"]["sd"],
             "npmle_gain": f["npmle"]["loglik_gain_vs_normal"], "odd_even_cov": f["odd_even"]["cov"],
             "odd_even_tau_upper": f["odd_even"]["tau_upper_95"]}
            for k, f in pop["thresholds"].items()]
    rows += [{"group": f"{k} hands", **{c: v for c, v in f.items() if not isinstance(v, (dict, list))},
              "m_lo": f["m_ci"][0], "m_hi": f["m_ci"][1], "tau_lo": f["tau_ci"][0], "tau_hi": f["tau_ci"][1],
              "odd_even_cov": f["odd_even"]["cov"], "odd_even_tau_upper": f["odd_even"]["tau_upper_95"]}
             for k, f in pop["brackets"].items()]
    pd.DataFrame(rows).to_csv(out / "population.csv", index=False, float_format="%.4f")
    rows = []
    for name, pr in r["chapter2"]["priors"].items():
        for h in pr["history"]:
            rows.append({"prior": name, "hands": h["hands"], "winrate_lo": h["winrate_interval"][0],
                         "winrate_hi": h["winrate_interval"][1], "risk_lo": h["risk_interval"][0],
                         "risk_hi": h["risk_interval"][1], "expected_risk": h["expected_risk"],
                         "median_risk": h["median_risk"], "p_risk_above_10pct": h["p_risk_above_10pct"]})
    pd.DataFrame(rows).to_csv(out / "chapter2.csv", index=False, float_format="%.5f")


if __name__ == "__main__":
    main(*sys.argv[1:3])
