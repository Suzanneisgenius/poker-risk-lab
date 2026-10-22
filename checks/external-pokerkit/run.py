"""Cross-check this project's hand evaluator and equity against PokerKit.

PokerKit (University of Toronto Computer Poker Research Group) is an
independent open-source implementation. It is pinned in requirements.txt.

    pip install -r checks/external-pokerkit/requirements.txt
    python -I checks/external-pokerkit/run.py            # print a summary
    python -I checks/external-pokerkit/run.py --write    # also save results.json
    python -I checks/external-pokerkit/run.py --check    # compare with results.json

Three comparisons:
1. Hand order: 20,000 random seven-card hands sorted by our score; every
   neighbouring pair must compare the same way (better / equal) in PokerKit.
2. Heads-up equity: seven spots enumerated exactly by both implementations;
   win / tie / lose counts must match exactly.
3. Three-way equity: our Monte Carlo (150,000 trials) against PokerKit's exact
   enumeration; the difference must be within 4 Monte Carlo standard errors.

The preflop spots evaluate 3.4 million hands each in PokerKit, so the run uses
all CPU cores and takes a minute or two.
"""

from __future__ import annotations

import itertools
import json
import math
import os
import platform
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from importlib.metadata import version

from pokerkit import Card, StandardHighHand

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
RANKS, SUITS = "23456789TJQKA", "cdhs"
ALL = [r + s for s in SUITS for r in RANKS]


def cards(text: str) -> list[str]:
    return [text[i:i + 2] for i in range(0, len(text), 2)]


_PARSED: dict[str, Card] = {}


def card(text: str) -> Card:
    if text not in _PARSED:
        _PARSED[text] = next(iter(Card.parse(text)))
    return _PARSED[text]


def hand(hole: list[str], board: list[str]) -> StandardHighHand:
    return StandardHighHand.from_game([card(c) for c in hole], [card(c) for c in board])


def _count_boards(args: tuple[list[list[str]], list[str], list[str], int]) -> list[int]:
    """Win/tie/lose counts per player for every board completion starting with deck[first]."""
    holes, board, deck, first = args
    need = 5 - len(board)
    counts = [[0, 0, 0] for _ in holes]   # win, tie, lose per player
    equity = [0.0 for _ in holes]
    rest = deck[first + 1:]
    combos = itertools.combinations(rest, need - 1) if need > 0 else [()]
    for extra in combos:
        full = board + ([deck[first]] if need > 0 else []) + list(extra)
        ranked = [hand(h, full) for h in holes]
        best = max(ranked)
        winners = [i for i, r in enumerate(ranked) if r == best]
        for i in range(len(holes)):
            if i not in winners:
                counts[i][2] += 1
            elif len(winners) == 1:
                counts[i][0] += 1
                equity[i] += 1.0
            else:
                counts[i][1] += 1
                equity[i] += 1.0 / len(winners)
    return [counts, equity]


def enumerate_exact(holes: list[list[str]], board: list[str], pool: ProcessPoolExecutor) -> dict:
    used = set(sum(holes, [])) | set(board)
    deck = [c for c in ALL if c not in used]
    need = 5 - len(board)
    starts = range(len(deck)) if need > 0 else [0]
    if need == 0:
        parts = [_count_boards((holes, board, deck, 0))]
    else:
        parts = list(pool.map(_count_boards, [(holes, board, deck, i) for i in starts]))
    counts = [[sum(p[0][i][k] for p in parts) for k in range(3)] for i in range(len(holes))]
    equity = [sum(p[1][i] for p in parts) for i in range(len(holes))]
    total = sum(counts[0])
    return {"counts": counts, "equity_sum": equity, "runouts": total}


def run() -> dict:
    ours = json.loads(subprocess.run(
        ["node", os.path.join(HERE, "ours.js")], check=True, capture_output=True, text=True).stdout)
    started = time.perf_counter()

    # 1. Hand order.
    order = sorted(ours["hands"], key=lambda h: h["score"])
    ranked = [StandardHighHand.from_game([card(c) for c in cards(h["cards"])], []) for h in order]
    disagreements = []
    for a, b, ha, hb in zip(order, order[1:], ranked, ranked[1:]):
        ours_equal = a["score"] == b["score"]
        if ours_equal != (ha == hb) or (not ours_equal and not ha < hb):
            disagreements.append({"lower": a["cards"], "higher": b["cards"], "pokerkit": [str(ha), str(hb)]})
    categories: dict[str, int] = {}
    for r in ranked:
        name = str(r).split(" (")[0]
        categories[name] = categories.get(name, 0) + 1

    with ProcessPoolExecutor() as pool:
        # 2. Heads-up exact equity.
        heads_up = []
        for spot in ours["heads_up"]:
            pk = enumerate_exact([cards(spot["hero"]), cards(spot["villain"])], cards(spot["board"]), pool)
            win, tie, lose = pk["counts"][0]
            heads_up.append({
                "id": spot["id"], "hero": spot["hero"], "villain": spot["villain"], "board": spot["board"],
                "runouts": pk["runouts"],
                "ours": {"win": spot["win"], "tie": spot["tie"], "lose": spot["lose"], "equity": spot["equity"]},
                "pokerkit": {"win": win, "tie": tie, "lose": lose, "equity": (win + tie / 2) / pk["runouts"]},
                "match": [spot["win"], spot["tie"], spot["lose"], spot["runouts"]] == [win, tie, lose, pk["runouts"]],
            })

        # 3. Three-way: our Monte Carlo against PokerKit's exact value.
        mw = ours["multiway"]
        pk = enumerate_exact([cards(h) for h in mw["hands"]], cards(mw["board"]), pool)
    exact = pk["equity_sum"][0] / pk["runouts"]
    # Standard error of a mean of per-trial pot shares in [0, 1]; the share
    # variance is bounded by its Bernoulli value, so this is conservative.
    se = math.sqrt(exact * (1 - exact) / mw["trials"])
    multiway = {
        "id": mw["id"], "hands": mw["hands"], "board": mw["board"], "runouts": pk["runouts"],
        "pokerkit_exact_equity": exact, "ours_monte_carlo_equity": mw["equity"],
        "trials": mw["trials"], "seed": mw["seed"], "standard_error": se,
        "difference_in_se": (mw["equity"] - exact) / se,
        "within_4_se": abs(mw["equity"] - exact) <= 4 * se,
    }

    return {
        "purpose": "Independent cross-check of the hand evaluator and equity engine against PokerKit.",
        "command": "python -I checks/external-pokerkit/run.py --check",
        "environment": {
            "pokerkit": version("pokerkit"), "python": sys.version.split()[0], "node": ours["node"],
        },
        "hand_order": {
            "hands": len(order), "seed": ours["hand_seed"], "neighbouring_pairs": len(order) - 1,
            "disagreements": disagreements[:20], "disagreement_count": len(disagreements),
            "categories": dict(sorted(categories.items(), key=lambda kv: -kv[1])),
        },
        "heads_up_exact": heads_up,
        "three_way": multiway,
        "all_passed": not disagreements and all(s["match"] for s in heads_up) and multiway["within_4_se"],
        "_seconds": time.perf_counter() - started,
    }


def main() -> None:
    result = run()
    seconds = result.pop("_seconds")
    text = json.dumps(result, indent=2) + "\n"
    path = os.path.join(HERE, "results.json")
    if "--check" in sys.argv:
        with open(path) as f:
            saved = f.read()
        if saved != text:
            sys.exit(f"Results differ from {os.path.relpath(path, REPO)}.")
        print(f"Results match {os.path.relpath(path, REPO)}.")
        return
    if "--write" in sys.argv:
        with open(path, "w") as f:
            f.write(text)
    ho = result["hand_order"]
    print(f"PokerKit {result['environment']['pokerkit']} · {platform.machine()} · {seconds:.0f} s")
    print(f"Hand order: {ho['disagreement_count']} disagreements in {ho['neighbouring_pairs']:,} neighbouring pairs "
          f"({len(ho['categories'])} categories)")
    for s in result["heads_up_exact"]:
        print(f"  {s['id']:<22} {s['runouts']:>9,} runouts  ours {s['ours']['equity']:.6f}  "
              f"pokerkit {s['pokerkit']['equity']:.6f}  {'match' if s['match'] else 'MISMATCH'}")
    m = result["three_way"]
    print(f"  {m['id']:<22} exact {m['pokerkit_exact_equity']:.5f}  ours MC {m['ours_monte_carlo_equity']:.5f}  "
          f"({m['difference_in_se']:+.2f} SE)")
    print("All passed." if result["all_passed"] else "FAILED.")
    if not result["all_passed"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
