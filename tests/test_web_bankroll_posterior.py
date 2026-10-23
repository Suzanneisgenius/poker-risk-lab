"""The page's posterior bankroll numbers (checks/bankroll-posterior-python/web.json)
must match the Python research code. The Node CI job checks that web.json is
still what the page computes; this test recomputes it in Python."""

import importlib.util
import os

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
RUN = os.path.join(os.path.dirname(HERE), "checks", "bankroll-posterior-python", "run.py")


@pytest.fixture(scope="module")
def check():
    spec = importlib.util.spec_from_file_location("bankroll_posterior_check", RUN)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_every_web_number_matches_python(check):
    result = check.run(mc=True)
    failures = [f"{c['id']}: {f}" for c in result["cases"] for f in c["failures"]]
    assert not failures, "\n".join(failures)
    assert result["comparisons"] > 2000


def test_sample_size_example(check):
    # Volatility 100 bb/100, independent results, stable win rate: a 95%
    # interval of +/- 1 bb/100 needs about 3.84 million hands in total.
    assert check.sample_hands(100, 1, 0.95) == pytest.approx(3_841_459, abs=1)
