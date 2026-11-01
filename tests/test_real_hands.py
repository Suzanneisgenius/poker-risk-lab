"""The real-hand numbers in the configs must be the saved results of the scripts in
research/real-hands. The hand data are not in the repository, so these tests check
the saved aggregate results (reports/real-hands) rather than rerunning the fits."""

import hashlib
import json
import os

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(REPO, "research", "real-hands")
REPORTS = os.path.join(REPO, "reports", "real-hands")


def load(*parts):
    with open(os.path.join(REPO, *parts)) as f:
        return json.load(f)


def sha256(name):
    with open(os.path.join(SCRIPTS, name), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


@pytest.fixture(scope="module")
def q12():
    return load("reports", "real-hands", "q1q2", "results.json")


@pytest.fixture(scope="module")
def q3():
    return load("reports", "real-hands", "q3", "results.json")


def test_saved_results_come_from_the_scripts_here(q12, q3):
    assert q12["provenance"]["script_sha256"] == sha256("analyze_q1q2.py")
    assert q3["provenance"]["script_sha256"] == sha256("analyze_q3.py")
    # The derived tables both analyses read were built by build_tables.py as it is here.
    for r in (q12, q3):
        assert r["provenance"]["build_inputs"]["build_script_sha256"] == sha256("build_tables.py")
    assert q12["provenance"]["derived_tables"]["player_hands.parquet"] == q3["provenance"]["derived_tables"]["player_hands.parquet"]


def test_chapter3_fitted_block_matches_question_1_and_2(q12):
    # The saved case-study result carries the config's block; the page reads it from there.
    src = load("reports", "case-study", "assumptions.json")["fitted"]["source"]
    both = q12["sites"]["both"]
    assert src["players"] == both["players"]
    assert src["blocks"] == both["blocks"]
    assert src["min_hands"] == q12["settings"]["min_blocks"] * q12["settings"]["block_hands"]
    t = both["student_t"]
    assert src["student_t_df"]["estimate"] == pytest.approx(t["df_hat"], abs=0.005)
    assert src["student_t_df"]["ci95"] == pytest.approx(t["df_ci"], abs=0.005)
    assert src["lag1_correlation"]["estimate"] == pytest.approx(both["fingerprint"]["rho1"], abs=5e-5)
    assert src["lag1_correlation"]["ci95"] == pytest.approx(both["fingerprint_ci"]["rho1"], abs=5e-5)
    assert src["variance_ratio_5000_hands"]["estimate"] == pytest.approx(both["fingerprint"]["vr_5000_hands"], abs=0.005)
    assert src["variance_ratio_5000_hands"]["ci95"] == pytest.approx(both["fingerprint_ci"]["vr_5000_hands"], abs=0.005)


def test_population_priors_match_question_3(q3):
    spec = load("configs", "population_priors.json")
    brackets = q3["population"]["brackets"]
    components = spec["priors"]["players"]["components"]
    assert len(components) == len(brackets)
    for c, (label, b) in zip(components, brackets.items()):
        assert c["hands"] == label.replace("-", "–")
        assert c["players"] == b["players"]
        assert c["mean"] == pytest.approx(b["m"], abs=5e-4)
        assert c["sd"] == pytest.approx(b["tau"], abs=5e-4)
        assert c["mean_ci"] == pytest.approx(b["m_ci"], abs=5e-3)
        assert c["sd_ci"] == pytest.approx(b["tau_ci"], abs=5e-3)
    # Regulars are the 10,000+ group; the all-players prior is the mixture.
    reg, top = spec["priors"]["regulars"], list(brackets.values())[-1]
    assert (reg["mean"], reg["sd"], reg["players"]) == (components[-1]["mean"], components[-1]["sd"], top["players"])
    mix, players = q3["population"]["mixture"], spec["priors"]["players"]
    assert players["players"] == sum(b["players"] for b in brackets.values())
    assert players["mean"] == pytest.approx(mix["mean"], abs=5e-4)
    assert players["sd"] == pytest.approx(mix["sd"], abs=5e-4)
    assert players["mean_ci"] == pytest.approx(mix["mean_ci"], abs=5e-3)
    assert players["sd_ci"] == pytest.approx(mix["sd_ci"], abs=5e-3)


def test_population_prior_checks_match_question_3(q3):
    checks = load("configs", "population_priors.json")["checks"]
    rake = q3["rake_check"]
    assert checks["rake_bb100_per_seat"]["Ongame"] == pytest.approx(rake["ONG"]["rake_bb100_per_seat"], abs=0.005)
    assert checks["rake_bb100_per_seat"]["PartyPoker"] == pytest.approx(rake["PTY"]["rake_bb100_per_seat"], abs=0.005)
    halves = q3["prediction"]["half_fits"]["brackets"]
    for label, h in halves.items():
        c = checks["later_minus_earlier_half"][label.replace("-", "–")]
        assert c["earlier"] == pytest.approx(h["m"], abs=0.005)
        assert c["later"] == pytest.approx(h["later_half_m"], abs=0.005)
        assert c["difference"] == pytest.approx(h["later_minus_earlier"], abs=0.005)
        assert c["difference_ci"] == pytest.approx(h["later_minus_earlier_ci"], abs=0.005)
    pred, saved = checks["regulars_prediction"], q3["prediction"]["priors"]
    assert pred["players"] == saved["fitted, by volume bracket"]["regulars"]["players"]
    for key, name in (("weak_prior", "case study N(0, 10^2)"), ("fitted_prior", "fitted, by volume bracket")):
        assert pred[key]["squared_error_vs_raw"] == pytest.approx(saved[name]["regulars"]["mse_vs_raw"], abs=5e-4)
        assert pred[key]["coverage95"] == pytest.approx(saved[name]["regulars"]["coverage95"], abs=5e-4)
    gains = q3["population"]["thresholds"]
    assert checks["normal_shape_loglik_gain_of_npmle"]["regulars"] == pytest.approx(gains["10000"]["npmle"]["loglik_gain_vs_normal"], abs=0.005)
    assert checks["normal_shape_loglik_gain_of_npmle"]["players_1000_plus"] == pytest.approx(gains["1000"]["npmle"]["loglik_gain_vs_normal"], abs=0.005)
