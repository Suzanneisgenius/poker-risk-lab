"""Questions 1 and 2 of proposal direction B, on the PartyPoker and Ongame $2/$4 tables.

Question 1: is a player's 100-hand result Normal, or heavy-tailed like the case
study's Student-t stress test (df = 3)?
Question 2: are neighbouring 100-hand blocks correlated (the AR(1) scenario uses
phi = 0.3), and does volatility cluster as in the regime-switching scenario?

Each player's usable hands are put in time order and cut into consecutive
100-hand blocks. A gap of more than 30 minutes between two of a player's hands
is treated as a break (a session end or a hole in the logs; the data cannot
tell them apart), and lag pairs are reported both across and within breaks.
Results are standardized within player, so the pooled statistics describe the
shape of one player's results, not the spread of win rates between players.

The case study's own models (src/models.py in this repository) are simulated
with the same players' block counts and put through the same statistics, so
data and models are compared like for like.

Usage, from the repository root (-B keeps bytecode out of the repository):
    python -I -B research/real-hands/analyze_q1q2.py <derived dir> [output dir]
The derived dir is build_tables.py's output; the output dir defaults to
reports/real-hands/q1q2.
"""
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "reports" / "real-hands" / "q1q2"
BLOCK = 100
MIN_BLOCKS = 50                  # players with at least 5,000 usable hands
SESSION_GAP_MIN = 30
MAX_LAG = 49                     # enough for the variance ratio up to 5,000 hands
VR_DIRECT = (2, 5, 10, 20, 50)
KURT_SIZES = (1, 10, 25, 50, 100, 200, 500)
DF_GRID = np.geomspace(2.05, 1000.0, 90)
N_BOOT = 2000
N_SIM = 200
SEED = 20261031
SCENARIO = {"mu": 3.0, "sigma": 90.0}    # case study scenario, bb/100
CASE_MODELS = {
    "Normal": ("gaussian", {}),
    "t, df 3": ("student_t", {"df": 3.0}),
    "AR(1), phi 0.3": ("ar1", {"phi": 0.3}),
    "Regimes": ("regime_switching", {"p_stay_normal": 0.98, "p_stay_adverse": 0.90,
                                     "mu_adverse": -5.0, "vol_mult": 1.6}),
    # Not case-study settings: candidates suggested by the fitted df and the kurtosis.
    "t, df 7": ("student_t", {"df": 7.0}),
    "t, df 10": ("student_t", {"df": 10.0}),
}
ACF_PLOT_LAGS = 20
TAIL_X = np.round(np.arange(1.0, 5.01, 0.1), 2)


# ---------------------------------------------------------------------------
# Data

def load_hands(derived):
    p = pd.read_parquet(derived / "player_hands.parquet",
                        columns=["site", "player", "ts", "table", "hand_id", "net_bb", "status"])
    p = p[p.status == "ok"].drop(columns="status")
    p = p.sort_values(["site", "player", "ts", "table", "hand_id"], kind="stable").reset_index(drop=True)
    gap = p.groupby(["site", "player"], sort=False).ts.diff()
    new = gap.isna() | (gap > pd.Timedelta(minutes=SESSION_GAP_MIN))
    p["session"] = new.groupby([p.site, p.player], sort=False).cumsum().astype(np.int32)
    return p


def make_blocks(p, size):
    """Consecutive complete blocks along each player's whole sequence."""
    k = p.groupby(["site", "player"], sort=False).cumcount() // size
    g = p.assign(k=k).groupby(["site", "player", "k"], sort=False)
    b = g.agg(x=("net_bb", "sum"), n=("net_bb", "size"),
              s0=("session", "first"), s1=("session", "last")).reset_index()
    return b[b.n == size].drop(columns="n").reset_index(drop=True)


def standardize(x, pid):
    """Per-player z scores (ddof 0), so each player has mean 0 and variance 1."""
    cnt = np.bincount(pid)
    m = np.bincount(pid, x) / cnt
    d = x - m[pid]
    s = np.sqrt(np.bincount(pid, d * d) / cnt)
    return d / s[pid], cnt


# ---------------------------------------------------------------------------
# Statistics shared by the data and the simulated models

def lag_sums(z, pid, s0, s1, max_lag, P):
    """Per-player sums of z_t * z_{t+k} and pair counts, all pairs and within-session pairs."""
    S = np.zeros((2, P, max_lag)); N = np.zeros((2, P, max_lag))
    for k in range(1, max_lag + 1):
        same = pid[k:] == pid[:-k]
        prod = z[k:] * z[:-k]
        within = same & (s0[:-k] == s1[k:])
        for j, mask in enumerate((same, within)):
            ids = pid[:-k][mask]
            S[j, :, k - 1] = np.bincount(ids, prod[mask], minlength=P)
            N[j, :, k - 1] = np.bincount(ids, minlength=P)
    return S, N


def acf(S, N, T, W=None):
    """Pooled ACF corrected by its exact mean under within-player shuffling, -1/(T-1) per pair."""
    bias = N * (-1.0 / (T - 1.0))[:, None]
    if W is None:
        return (S.sum(0) - bias.sum(0)) / N.sum(0)
    return (W @ S - W @ bias) / (W @ N)


def vr_from_acf(rho):
    """Variance ratio of m-block sums, m = 1..len(rho)+1, from the ACF (Bartlett form)."""
    rho = np.atleast_2d(rho)
    K = rho.shape[1]
    out = [np.ones(rho.shape[0])]
    for m in range(2, K + 2):
        k = np.arange(1, m)
        out.append(1 + 2 * (rho[:, :m - 1] * (1 - k / m)).sum(1))
    return np.stack(out, 1)


def vr_direct_sums(z, pid, P, m):
    """Per-player numerator and denominator of the direct variance ratio at m blocks."""
    num = np.zeros(P); den = np.zeros(P)
    starts = np.r_[0, np.flatnonzero(np.diff(pid)) + 1]
    ends = np.r_[starts[1:], len(pid)]
    for a, e in zip(starts, ends):
        J = (e - a) // m
        if J < 2:
            continue
        v = z[a:a + J * m]
        v = v - v.mean()
        chunk = v.reshape(J, m).sum(1)
        num[pid[a]] = (chunk ** 2).sum()
        den[pid[a]] = (J - 1) * m * v.var(ddof=1)
    return num, den


def fingerprint(x, pid, s0, s1, max_lag=MAX_LAG, with_parts=False):
    """The statistics used to compare data with models, from block results x."""
    P = pid.max() + 1
    z, T = standardize(x, pid)
    T = T.astype(float)
    S, N = lag_sums(z, pid, s0, s1, max_lag, P)
    absz = np.abs(z)
    ua, _ = standardize(absz, pid)
    Sa, Na = lag_sums(ua, pid, s0, s1, 10, P)
    rho_all = acf(S[0], N[0], T)
    rho_within = acf(S[1], N[1], T)
    rho_abs = acf(Sa[0], Na[0], T)
    vr = vr_from_acf(rho_all)[0]
    if with_parts == "acf":
        return rho_all[:ACF_PLOT_LAGS], rho_abs, vr
    out = {
        "skew": float(np.mean(z ** 3)),
        "excess_kurtosis": float(np.mean(z ** 4) - 3),
        "p_below_-3_per_1000": float(np.mean(z < -3) * 1000),
        "p_above_3_per_1000": float(np.mean(z > 3) * 1000),
        "q_0.001": float(np.quantile(z, 0.001)),
        "q_0.999": float(np.quantile(z, 0.999)),
        "rho1": float(rho_all[0]),
        "rho1_within_session": float(rho_within[0]),
        "rho1_abs": float(rho_abs[0]),
        "vr_1000_hands": float(vr[9]),
        "vr_5000_hands": float(vr[49]) if max_lag >= 49 else np.nan,
    }
    if with_parts:
        parts = dict(z=z, T=T, S=S, N=N, Sa=Sa, Na=Na, P=P,
                     z3=np.bincount(pid, z ** 3, minlength=P), z4=np.bincount(pid, z ** 4, minlength=P))
        return out, parts
    return out


# ---------------------------------------------------------------------------
# Student-t profile likelihood: shared df, per-player location and scale

def t_profile(x, pid, P):
    """Per-player log-likelihood at each df on DF_GRID (EM for loc/scale), and under the Normal."""
    cnt = np.bincount(pid, minlength=P).astype(float)
    mean = np.bincount(pid, x, minlength=P) / cnt
    var = np.bincount(pid, (x - mean[pid]) ** 2, minlength=P) / cnt
    ll_norm = np.bincount(pid, stats.norm.logpdf(x, mean[pid], np.sqrt(var[pid])), minlength=P)
    med = pd.Series(x).groupby(pid).median().to_numpy()
    ll = np.zeros((P, DF_GRID.size))
    for j, nu in enumerate(DF_GRID):
        mu, s2 = med.copy(), var.copy()
        for _ in range(2000):
            r2 = (x - mu[pid]) ** 2 / s2[pid]
            w = (nu + 1) / (nu + r2)
            mu_new = np.bincount(pid, w * x, minlength=P) / np.bincount(pid, w, minlength=P)
            s2_new = np.bincount(pid, w * (x - mu_new[pid]) ** 2, minlength=P) / cnt
            done = np.max(np.abs(mu_new - mu)) < 1e-9 and np.max(np.abs(s2_new / s2 - 1)) < 1e-10
            mu, s2 = mu_new, s2_new
            if done:
                break
        ll[:, j] = np.bincount(pid, stats.t.logpdf(x, nu, mu[pid], np.sqrt(s2[pid])), minlength=P)
    return ll, ll_norm


def refine_argmax(curve):
    """Argmax of a log-likelihood curve on DF_GRID, refined by a parabola in log df."""
    j = int(np.argmax(curve))
    if 0 < j < DF_GRID.size - 1:
        u = np.log(DF_GRID[j - 1:j + 2]); y = curve[j - 1:j + 2]
        a, b, _ = np.polyfit(u, y, 2)
        if a < 0:
            return float(np.exp(-b / (2 * a)))
    return float(DF_GRID[j])


# ---------------------------------------------------------------------------
# Case-study models, simulated with the data's block counts

def load_models(repo):
    spec = importlib.util.spec_from_file_location("case_models", repo / "src" / "models.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.MODELS


def simulate(model, params, T, rng):
    P, Tmax = T.size, int(T.max())
    incr, _ = model(rng, P, np.full(Tmax, float(BLOCK)), SCENARIO["mu"], SCENARIO["sigma"], **params)
    keep = np.arange(Tmax)[None, :] < T[:, None]
    x = incr[keep]
    pid = np.repeat(np.arange(P), T)
    zero = np.zeros_like(pid)
    return x, pid, zero, zero


# ---------------------------------------------------------------------------

def site_analysis(name, blocks, hands, rng):
    pid = pd.factorize(blocks.player)[0]
    x = blocks.x.to_numpy(); s0 = blocks.s0.to_numpy(); s1 = blocks.s1.to_numpy()
    fp, parts = fingerprint(x, pid, s0, s1, with_parts=True)
    P, T, z = parts["P"], parts["T"], parts["z"]
    W = rng.multinomial(P, np.full(P, 1.0 / P), size=N_BOOT).astype(float)
    Nb = W @ T

    def ci(a):
        return [float(np.quantile(a, 0.025)), float(np.quantile(a, 0.975))]

    rho_all_b = acf(parts["S"][0], parts["N"][0], T, W)
    rho_within_b = acf(parts["S"][1], parts["N"][1], T, W)
    rho_abs_b = acf(parts["Sa"][0], parts["Na"][0], T, W)
    vr_b = vr_from_acf(rho_all_b)
    rho_all = acf(parts["S"][0], parts["N"][0], T)
    rho_within = acf(parts["S"][1], parts["N"][1], T)
    rho_abs = acf(parts["Sa"][0], parts["Na"][0], T)
    cross = parts["N"][0] - parts["N"][1]
    rho_cross = acf(parts["S"][0] - parts["S"][1], cross, T)
    rho_cross_b = acf(parts["S"][0] - parts["S"][1], cross, T, W)
    vr = vr_from_acf(rho_all)[0]

    # Tilt check: after an unusually bad (or good) block, does the next block's mean or
    # spread change? prev / (T - 1) removes the -z_t / (T - 1) mean that shuffling gives.
    same = pid[1:] == pid[:-1]
    prev, nxt, owner = z[:-1][same], z[1:][same], pid[:-1][same]
    adj = nxt + prev / (T[owner] - 1)
    sd_bb = float(np.median(pd.Series(x).groupby(pid).std(ddof=0)))
    tilt = {"median_player_sd_bb100": sd_bb}
    for label, cond in (("after_below_-2", prev < -2), ("after_above_2", prev > 2),
                        ("after_within_1", np.abs(prev) < 1)):
        o = owner[cond]
        s1 = np.bincount(o, adj[cond], minlength=P)
        s2 = np.bincount(o, nxt[cond] ** 2, minlength=P)
        c = np.bincount(o, minlength=P).astype(float)
        tilt[label] = {"pairs": int(cond.sum()),
                       "next_mean_z": float(s1.sum() / c.sum()), "next_mean_z_ci": ci((W @ s1) / (W @ c)),
                       "next_mean_sq_z": float(s2.sum() / c.sum()), "next_mean_sq_z_ci": ci((W @ s2) / (W @ c))}

    direct = {}
    for m in VR_DIRECT:
        num, den = vr_direct_sums(z, pid, P, m)
        use = den > 0
        direct[m] = {"vr": float(num.sum() / den.sum()),
                     "ci": ci((W[:, use] @ num[use]) / (W[:, use] @ den[use])),
                     "players": int(use.sum())}

    ll, ll_norm = t_profile(x, pid, P)
    curve = ll.sum(0)
    df_hat = refine_argmax(curve)
    df_boot = [refine_argmax(c) for c in W @ ll]
    lr_vs_normal = float(2 * (curve.max() - ll_norm.sum()))

    # Excess kurtosis by block size; the Normal-null mean removes the standardization bias.
    kurt = []
    for size in KURT_SIZES:
        if size == 1:
            xs, ps = hands.net_bb.to_numpy(), pd.factorize(hands.player)[0]
        else:
            b = make_blocks(hands, size)
            xs, ps = b.x.to_numpy(), pd.factorize(b.player)[0]
        zs, Ts = standardize(xs, ps)
        raw = float(np.mean(zs ** 4) - 3)
        null = []
        for _ in range(100 if size > 1 else 0):
            g = rng.standard_normal(xs.size)
            gz, _ = standardize(g, ps)
            null.append(np.mean(gz ** 4) - 3)
        bias = float(np.mean(null)) if null else 0.0
        P_s = ps.max() + 1
        Wk = rng.multinomial(P_s, np.full(P_s, 1.0 / P_s), size=500).astype(float)
        boot = (Wk @ np.bincount(ps, zs ** 4)) / (Wk @ Ts) - 3 - bias
        kurt.append({"block_hands": size, "excess_kurtosis": raw - bias, "ci": ci(boot),
                     "standardization_bias": bias, "players": int(P_s), "blocks": int(xs.size)})
    k1 = kurt[0]["excess_kurtosis"]
    for r in kurt:
        r["iid_prediction"] = k1 / r["block_hands"]

    return {
        "site": name,
        "players": int(P), "blocks": int(T.sum()),
        "blocks_per_player": {"median": float(np.median(T)), "max": int(T.max())},
        "lag1_pairs": {"all": int(parts["N"][0][:, 0].sum()), "within_session": int(parts["N"][1][:, 0].sum())},
        "fingerprint": fp,
        "fingerprint_ci": {
            "skew": ci((W @ parts["z3"]) / Nb),
            "excess_kurtosis": ci((W @ parts["z4"]) / Nb - 3),
            "rho1": ci(rho_all_b[:, 0]), "rho1_within_session": ci(rho_within_b[:, 0]),
            "rho1_abs": ci(rho_abs_b[:, 0]),
            "vr_1000_hands": ci(vr_b[:, 9]), "vr_5000_hands": ci(vr_b[:, 49]),
        },
        "rho1_across_break": {"value": float(rho_cross[0]), "ci": ci(rho_cross_b[:, 0]),
                              "pairs": int(cross[:, 0].sum())},
        "acf": {"lag": list(range(1, MAX_LAG + 1)), "all": rho_all.tolist(),
                "all_ci": [ci(rho_all_b[:, k]) for k in range(MAX_LAG)],
                "within_session": rho_within.tolist(),
                "within_session_ci": [ci(rho_within_b[:, k]) for k in range(MAX_LAG)],
                "abs": rho_abs.tolist(), "abs_ci": [ci(rho_abs_b[:, k]) for k in range(10)]},
        "variance_ratio": {"hands": [BLOCK * m for m in range(1, MAX_LAG + 2)], "vr": vr.tolist(),
                           "ci": [ci(vr_b[:, j]) for j in range(vr.size)]},
        "variance_ratio_direct": {str(BLOCK * m): v for m, v in direct.items()},
        "tilt": tilt,
        "student_t": {"df_hat": df_hat, "df_ci": ci(df_boot), "lr_vs_normal": lr_vs_normal,
                      "profile_df": DF_GRID.tolist(), "profile_ll": (curve - curve.max()).tolist(),
                      "normal_ll": float(ll_norm.sum() - curve.max())},
        "kurtosis_by_block": kurt,
        "tail_curve": {"x": TAIL_X.tolist(),
                       "below_minus_x": [float(np.mean(z < -t)) for t in TAIL_X],
                       "above_x": [float(np.mean(z > t)) for t in TAIL_X]},
        "_T": T,
    }


def model_fingerprints(models, T, rng):
    out, curves = {}, {}
    for label, (key, params) in CASE_MODELS.items():
        rows = [fingerprint(*simulate(models[key], params, T, rng)) for _ in range(N_SIM)]
        df = pd.DataFrame(rows)
        out[label] = {c: {"mean": float(df[c].mean()),
                          "range95": [float(df[c].quantile(0.025)), float(df[c].quantile(0.975))]}
                      for c in df.columns}
        if key in ("ar1", "regime_switching"):
            sims = [fingerprint(*simulate(models[key], params, T, rng), with_parts="acf") for _ in range(50)]
            curves[label] = {"acf": np.mean([s[0] for s in sims], 0).tolist(),
                             "acf_abs": np.mean([s[1] for s in sims], 0).tolist(),
                             "vr": np.mean([s[2] for s in sims], 0).tolist()}
    return out, curves


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def git(*args):
    return subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True, check=True).stdout.strip()


def main(derived, out=OUT):
    derived, out, repo = Path(derived), Path(out), REPO
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(SEED)
    hands = load_hands(derived)
    blocks = make_blocks(hands, BLOCK)
    blocks["unit"] = blocks.site + ":" + blocks.player
    hands["unit"] = hands.site + ":" + hands.player
    nb = blocks.unit.value_counts()
    keep = nb[nb >= MIN_BLOCKS].index
    blocks = blocks[blocks.unit.isin(keep)]       # boolean masks keep each player's time order
    hands = hands[hands.unit.isin(keep)]

    results = {"settings": {"block_hands": BLOCK, "min_blocks": MIN_BLOCKS,
                            "session_gap_minutes": SESSION_GAP_MIN, "bootstrap": N_BOOT,
                            "model_simulations": N_SIM, "seed": SEED, "scenario": SCENARIO,
                            "models": {k: v[1] | {"model": v[0]} for k, v in CASE_MODELS.items()}},
               "sites": {}}
    for site in ("ONG", "PTY", "both"):
        b = blocks if site == "both" else blocks[blocks.site == site]
        h = hands if site == "both" else hands[hands.site == site]
        b = b.assign(player=b.unit).reset_index(drop=True)
        h = h.assign(player=h.unit).reset_index(drop=True)
        results["sites"][site] = site_analysis(site, b, h, rng)
        print(f"{site}: done", flush=True)

    T_all = results["sites"]["both"]["_T"].astype(int)
    results["models"], results["model_curves"] = model_fingerprints(load_models(repo), T_all, rng)
    for r in results["sites"].values():
        r.pop("_T")

    build = json.loads((derived / "build_report.json").read_text())
    results["provenance"] = {
        "derived_tables": {f: sha256(derived / f) for f in ("player_hands.parquet", "build_report.json")},
        "build_inputs": build.get("inputs"),
        "case_study_models_sha256": sha256(repo / "src" / "models.py"),
        "script_sha256": sha256(__file__),
        "repo_commit": git("rev-parse", "--short", "HEAD"),
        "repo_uncommitted_changes": bool(git("status", "--porcelain", "--", "src", "configs", "research")),
        "versions": {"python": sys.version.split()[0], "numpy": np.__version__,
                     "pandas": pd.__version__, "scipy": __import__("scipy").__version__},
    }
    (out / "results.json").write_text(json.dumps(results, indent=1))
    write_tables(results, out)


def write_tables(results, out):
    rows = []
    for site, r in results["sites"].items():
        rows.append({"source": f"data {site}", **r["fingerprint"]})
    for label, m in results["models"].items():
        rows.append({"source": f"model {label}", **{k: v["mean"] for k, v in m.items()}})
    pd.DataFrame(rows).to_csv(out / "fingerprint.csv", index=False, float_format="%.4f")
    acf_rows, vr_rows, k_rows = [], [], []
    for site, r in results["sites"].items():
        a = r["acf"]
        for i, lag in enumerate(a["lag"]):
            acf_rows.append({"site": site, "lag_blocks": lag, "rho": a["all"][i],
                             "ci_low": a["all_ci"][i][0], "ci_high": a["all_ci"][i][1],
                             "rho_within_session": a["within_session"][i]})
        v = r["variance_ratio"]
        for i, h in enumerate(v["hands"]):
            vr_rows.append({"site": site, "hands": h, "vr": v["vr"][i],
                            "ci_low": v["ci"][i][0], "ci_high": v["ci"][i][1]})
        for k in r["kurtosis_by_block"]:
            k_rows.append({"site": site, **{kk: vv for kk, vv in k.items() if kk != "ci"},
                           "ci_low": k["ci"][0], "ci_high": k["ci"][1]})
    pd.DataFrame(acf_rows).to_csv(out / "acf.csv", index=False, float_format="%.5f")
    pd.DataFrame(vr_rows).to_csv(out / "variance_ratio.csv", index=False, float_format="%.5f")
    pd.DataFrame(k_rows).to_csv(out / "kurtosis_by_block.csv", index=False, float_format="%.5f")


if __name__ == "__main__":
    main(*sys.argv[1:3])
