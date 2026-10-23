"""The page's session import (checks/session-import-python/web.json) must read the
files and estimate from them as pandas, src/inference.py and scipy do. The Node
CI job checks that web.json is still what the page computes; this test
recomputes it in Python."""

import importlib.util
import json
import os

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
RUN = os.path.join(os.path.dirname(HERE), "checks", "session-import-python", "run.py")


@pytest.fixture(scope="module")
def check():
    spec = importlib.util.spec_from_file_location("session_import_check", RUN)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_every_web_number_matches_python(check):
    result = check.run()
    failures = [f"{f['file']}: {x}" for f in result["files"] for x in f["failures"]]
    assert not failures, "\n".join(failures)
    assert result["comparisons"] > 5000


def test_the_flagged_files_are_flagged():
    with open(os.path.join(os.path.dirname(RUN), "web.json")) as f:
        by_file = {entry["file"]: entry for entry in json.load(f)["files"]}
    assert by_file["drifting.csv"]["selections"][0]["summary"]["stability"]["flag"] is True
    assert by_file["short-and-long.csv"]["selections"][0]["summary"]["scaling"]["flag"] is True
    assert by_file["european.csv"]["problems"] == [22, 42, 62]
