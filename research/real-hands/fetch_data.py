"""Download the hand histories the real-hand analyses read, at a pinned commit.

The PHH dataset (Kim 2024, arXiv:2312.11753; CC BY 4.0) is fetched with git as a
sparse, blob-less clone holding only the two folders used here: PartyPoker and
Ongame no-limit hold'em, $2/$4, 1-23 July 2009 (HandHQ logs). That is 1,736
files and about 1.3 GB. Keep the clone outside this repository: the hands carry
(obfuscated) player IDs, and only aggregate results belong here.

Usage, from the repository root:
    python -I research/real-hands/fetch_data.py <destination>           # clone, then check
    python -I research/real-hands/fetch_data.py <destination> --check   # check an existing clone

The check confirms the commit and the file count and total size that
build_tables.py recorded when it built the tables behind the saved results.
"""
import subprocess
import sys
from pathlib import Path

URL = "https://github.com/uoftcprg/phh-dataset.git"
COMMIT = "e47fbd5816372360bade4de5d712346fe1bb70f6"
FOLDERS = ("data/handhq/ONG-2009-07-01_2009-07-23_400NLH_OBFU",
           "data/handhq/PTY-2009-07-01_2009-07-23_400NLH_OBFU")
EXPECTED = {"files": 1736, "bytes": 1316228698}
REPO = Path(__file__).resolve().parents[2]


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout.strip()


def fetch(dest):
    git("clone", "--filter=blob:none", "--no-checkout", "--sparse", URL, str(dest))
    git("-C", str(dest), "sparse-checkout", "set", *FOLDERS)
    git("-C", str(dest), "checkout", "--quiet", COMMIT)


def check(dest):
    head = git("-C", str(dest), "rev-parse", "HEAD")
    files = sorted(f for folder in FOLDERS for f in (dest / folder).rglob("*.phhs"))
    found = {"files": len(files), "bytes": sum(f.stat().st_size for f in files)}
    problems = ([f"commit {head}, expected {COMMIT}"] if head != COMMIT else []) + [
        f"{key}: {found[key]:,}, expected {EXPECTED[key]:,}" for key in EXPECTED if found[key] != EXPECTED[key]]
    if problems:
        sys.exit("Clone does not match: " + "; ".join(problems))
    print(f"OK: commit {COMMIT[:7]}, {found['files']:,} files, {found['bytes']:,} bytes.")


def main(dest, *flags):
    dest = Path(dest).expanduser().resolve()
    if dest == REPO or REPO in dest.parents:
        sys.exit("Choose a destination outside this repository.")
    if "--check" not in flags:
        if dest.exists():
            sys.exit(f"{dest} already exists; use --check to check it.")
        fetch(dest)
    check(dest)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(*sys.argv[1:])
