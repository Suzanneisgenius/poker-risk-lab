"""Reproducibility metadata attached to every experiment output."""

from __future__ import annotations

import platform
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any


def _git_commit() -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=3,
        )
        return out.stdout.strip() or None
    except Exception:
        return None


def package_versions() -> dict[str, str]:
    versions: dict[str, str] = {"python": sys.version.split()[0]}
    for name in ("numpy", "scipy", "pandas", "matplotlib"):
        try:
            mod = __import__(name)
            versions[name] = getattr(mod, "__version__", "unknown")
        except Exception:
            versions[name] = "not installed"
    return versions


def provenance(**params: Any) -> dict[str, Any]:
    """Return a reproducibility record: timestamp, versions, git, parameters."""
    return {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git_commit": _git_commit(),
        "platform": platform.platform(),
        "packages": package_versions(),
        "parameters": params,
    }
