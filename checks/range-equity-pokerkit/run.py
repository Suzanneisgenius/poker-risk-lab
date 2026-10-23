"""Cross-check range parsing and range equity against PokerKit.

PokerKit (University of Toronto Computer Poker Research Group) is an
independent open-source implementation. It is pinned in requirements.txt.

    pip install -r checks/range-equity-pokerkit/requirements.txt
    python -I checks/range-equity-pokerkit/run.py            # print a summary
    python -I checks/range-equity-pokerkit/run.py --write    # also save results.json
    python -I checks/range-equity-pokerkit/run.py --check    # compare with results.json

Three comparisons:
1. Notation: the combos our parser reads from each range text must be
   exactly the combos PokerKit's parse_range reads, with the same weight on
   each. PokerKit has no weights, repeats or overrides, so this script applies
   them itself: the last entry for a combo sets its weight.
2. Exact equity on the flop, turn and river: every live combo on every
   runout, ranked by PokerKit, with combos parsed by PokerKit and weights
   applied here. The total, the equity and share of every hand in the range,
   and the weighted share of combos hero is ahead of, even with and behind
   must equal ours (to 1e-9; the shares to 1e-12).
3. Preflop: our exact value (every combo on all 1,712,304 runouts) against an
   independent Monte Carlo estimate: combos parsed and hands ranked by
   PokerKit, sampling written below (a combo by weight, then five board cards
   from the cards left). Must be within 4 standard errors. Our stratified
   Monte Carlo is reported against our exact value too.

PokerKit's own calculate_equities is not used for (3) because it draws from
set orderings that change with Python's hash seed, so its output cannot be
reproduced run to run. It also has no weights.
"""

from __future__ import annotations

import itertools
import json
import math
import os
import platform
import random
import re
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from importlib.metadata import version

from pokerkit import Card, StandardHighHand, parse_range

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
RANKS, SUITS = "23456789TJQKA", "cdhs"
ALL = [r + s for s in SUITS for r in RANKS]
PREFLOP_CHUNKS = 16
PREFLOP_SAMPLES_PER_CHUNK = 20000
PREFLOP_SEED = 20261022

_PARSED: dict[str, Card] = {}


def card(text: str) -> Card:
    if text not in _PARSED:
        _PARSED[text] = next(iter(Card.parse(text)))
    return _PARSED[text]


def cards(text: str) -> list[str]:
    return [text[i:i + 2] for i in range(0, len(text), 2)]


def hand(hole: list[str], board: list[str]) -> StandardHighHand:
    return StandardHighHand.from_game([card(c) for c in hole], [card(c) for c in board])


def combo_key(combo) -> str:
    """'AsKs'-style text for a PokerKit combo, higher rank first, as ours.js writes it."""
    a, b = sorted((repr(c) for c in combo), key=lambda t: (RANKS.index(t[0]), SUITS.index(t[1])), reverse=True)
    return a + b


def pokerkit_combos(text: str) -> set[str]:
    return {combo_key(c) for c in parse_range(text)}


def weighted_range(text: str) -> dict[str, float]:
    """Combos with weights, written here independently of the app's parser.

    Entries are 'hands' or 'hands:weight' (0-1, or a percentage); PokerKit reads
    the hands. A repeated combo takes the weight of its last entry, and a weight
    of 0 removes it.
    """
    weights: dict[str, float] = {}
    for entry in re.split(r"[\s,;]+", text.strip()):
        hands, _, weight = entry.partition(":")
        value = float(weight[:-1]) / 100 if weight.endswith("%") else float(weight) if weight else 1.0
        for combo in pokerkit_combos(hands):
            weights[combo] = value
    return {c: w for c, w in weights.items() if w > 0}


def hand_class(combo: str) -> str:
    """'AsKs' -> 'AKs', 'AhKd' -> 'AKo', 'QsQd' -> 'QQ' (higher rank first)."""
    a, b = combo[:2], combo[2:]
    return a[0] + b[0] if a[0] == b[0] else a[0] + b[0] + ("s" if a[1] == b[1] else "o")


def live_combos(text: str, known: list[str]) -> list[tuple[str, float]]:
    return sorted((c, w) for c, w in weighted_range(text).items() if not set(cards(c)) & set(known))


def _exact_chunk(args: tuple[str, str, list[tuple[str, float]]]) -> list[tuple[float, int]]:
    """Hero's pot shares summed over every runout, and the runout count, for each combo."""
    hero, board, combos = args
    hero_cards, board_cards = cards(hero), cards(board)
    need = 5 - len(board_cards)
    hero_scores: dict[tuple[str, ...], StandardHighHand] = {}
    out = []
    for combo, _ in combos:
        villain = cards(combo)
        deck = [c for c in ALL if c not in hero_cards + board_cards + villain]
        share, runouts = 0.0, 0
        for runout in itertools.combinations(deck, need):
            full = board_cards + list(runout)
            if runout not in hero_scores:
                hero_scores[runout] = hand(hero_cards, full)
            h, v = hero_scores[runout], hand(villain, full)
            share += 1.0 if h > v else 0.5 if h == v else 0.0
            runouts += 1
        out.append((share, runouts))
    return out


def _preflop_chunk(args: tuple[str, list[tuple[str, float]], int, int]) -> tuple[float, float, int]:
    """Sum and sum of squares of hero's pot share over `samples` random deals."""
    hero, combos, samples, seed = args
    rng = random.Random(seed)
    hero_cards = cards(hero)
    population = [cards(c) for c, _ in combos]
    weights = [w for _, w in combos]
    deck = [c for c in ALL if c not in hero_cards]
    total = squares = 0.0
    for villain in rng.choices(population, weights, k=samples):
        board = rng.sample([c for c in deck if c not in villain], 5)
        h, v = hand(hero_cards, board), hand(villain, board)
        share = 1.0 if h > v else 0.5 if h == v else 0.0
        total += share
        squares += share * share
    return total, squares, samples


def run() -> dict:
    ours = json.loads(subprocess.run(
        ["node", os.path.join(HERE, "ours.js")], check=True, capture_output=True, text=True).stdout)
    started = time.perf_counter()

    # 1. Notation.
    notation = []
    for case in ours["notation"]:
        theirs_weighted = weighted_range(case["pokerkit"])
        mine, theirs = set(case["combos"]), set(theirs_weighted)
        weights_match = mine == theirs and all(abs(case["weights"][c] - theirs_weighted[c]) <= 1e-12 for c in mine)
        notation.append({
            "text": case["text"], "ours": case["ours"], "pokerkit": case["pokerkit"],
            "combos": len(mine), "pokerkit_combos": len(theirs),
            "weighted_count": round(sum(case["weights"].values()), 10),
            "pokerkit_weighted_count": round(sum(theirs_weighted.values()), 10),
            "only_ours": sorted(mine - theirs)[:10], "only_pokerkit": sorted(theirs - mine)[:10],
            "weights_match": weights_match,
            "match": mine == theirs and weights_match,
        })

    with ProcessPoolExecutor() as pool:
        # 2. Exact flop, turn and river spots.
        exact = []
        for spot in ours["exact"]:
            combos = live_combos(spot["range"], cards(spot["hero"]) + cards(spot["board"]))
            chunks = [combos[i::64] for i in range(64)]
            results = dict(zip(
                [c for chunk in chunks for c, _ in chunk],
                [r for part in pool.map(_exact_chunk, [(spot["hero"], spot["board"], chunk) for chunk in chunks]) for r in part],
            ))
            weight = sum(w for _, w in combos)
            equity = sum(w * results[c][0] / results[c][1] for c, w in combos) / weight
            runouts = {r for _, r in results.values()}
            # Per hand: weighted equity and share, and the weight of combos hero is
            # ahead of / even with / behind, decided per combo on whole counts.
            groups: dict[str, dict] = {}
            for c, w in combos:
                total, n = results[c]
                g = groups.setdefault(hand_class(c), {"weight": 0.0, "equity": 0.0, "ahead": 0.0, "even": 0.0, "behind": 0.0})
                g["weight"] += w
                g["equity"] += w * total / n
                g["ahead" if 2 * total > n else "even" if 2 * total == n else "behind"] += w
            split = {k: sum(g[k] for g in groups.values()) / weight for k in ("ahead", "even", "behind")}
            mine = {g["group"]: g for g in spot["groups"]}
            group_gap = 0.0
            for name, g in groups.items():
                ours_group = mine.get(name)
                if ours_group is None:
                    group_gap = math.inf
                    continue
                theirs_group = {"share": g["weight"] / weight, "equity": g["equity"] / g["weight"],
                                **{k: g[k] / g["weight"] for k in ("ahead", "even", "behind")}}
                group_gap = max(group_gap, abs(ours_group["share"] - theirs_group["share"]), abs(ours_group["equity"] - theirs_group["equity"]),
                                *(abs(ours_group["split"][k] - theirs_group[k]) for k in ("ahead", "even", "behind")))
            split_gap = max(abs(spot["split"][k] - split[k]) for k in split)
            exact.append({
                "id": spot["id"], "hero": spot["hero"], "board": spot["board"], "range": spot["range"],
                "combos": len(combos), "ours_combos": spot["combos"], "weight": weight,
                "runouts_per_combo": runouts.pop() if len(runouts) == 1 else sorted(runouts),
                "ours": spot["equity"], "pokerkit": equity, "difference": spot["equity"] - equity,
                "hands": len(groups), "ours_hands": len(mine),
                "split": {k: round(v, 12) for k, v in split.items()}, "ours_split": {k: round(spot["split"][k], 12) for k in split},
                "largest_hand_difference": float(f"{group_gap:.1e}"),
                "match": len(combos) == spot["combos"] and abs(spot["equity"] - equity) <= 1e-9
                and len(groups) == len(mine) and group_gap <= 1e-9 and split_gap <= 1e-12,
            })

        # 3. Preflop: independent Monte Carlo against our exact value.
        preflop = []
        for index, spot in enumerate(ours["preflop"]):
            combos = live_combos(spot["range"], cards(spot["hero"]))
            seeds = [PREFLOP_SEED + 1000 * index + i for i in range(PREFLOP_CHUNKS)]
            parts = list(pool.map(_preflop_chunk, [(spot["hero"], combos, PREFLOP_SAMPLES_PER_CHUNK, s) for s in seeds]))
            n = sum(p[2] for p in parts)
            mean = sum(p[0] for p in parts) / n
            variance = (sum(p[1] for p in parts) / n - mean * mean) * n / (n - 1)
            se = math.sqrt(variance / n)
            exact_value = spot["exact_equity"]
            mc = spot["monte_carlo"]
            preflop.append({
                "id": spot["id"], "hero": spot["hero"], "range": spot["range"],
                "combos": len(combos), "ours_combos": spot["combos"],
                "runouts_per_combo": spot["runouts_per_combo"], "ours_exact": exact_value,
                "independent_monte_carlo": {
                    "samples": n, "seeds": f"{seeds[0]}..{seeds[-1]}", "equity": mean, "standard_error": se,
                    "difference_in_se": (mean - exact_value) / se,
                },
                "ours_monte_carlo": {**mc, "difference_in_se": (mc["equity"] - exact_value) / mc["standard_error"]},
                "within_4_se": len(combos) == spot["combos"] and abs(mean - exact_value) <= 4 * se
                and abs(mc["equity"] - exact_value) <= 4 * mc["standard_error"],
            })

    return {
        "purpose": "Independent cross-check of range parsing and range equity against PokerKit.",
        "command": "python -I checks/range-equity-pokerkit/run.py --check",
        "environment": {"pokerkit": version("pokerkit"), "python": sys.version.split()[0], "node": ours["node"]},
        "notation": notation,
        "exact": exact,
        "preflop": preflop,
        "all_passed": all(c["match"] for c in notation) and all(s["match"] for s in exact)
        and all(s["within_4_se"] for s in preflop),
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
    print(f"PokerKit {result['environment']['pokerkit']} · {platform.machine()} · {seconds:.0f} s")
    matched = sum(c["match"] for c in result["notation"])
    print(f"Notation: {matched} of {len(result['notation'])} range texts give the same combos and weights")
    for c in result["notation"]:
        if not c["match"]:
            print(f"  MISMATCH {c['text']}: only ours {c['only_ours']}, only PokerKit {c['only_pokerkit']}")
    for s in result["exact"]:
        print(f"  {s['id']:<30} {s['combos']:>5} combos  ours {s['ours']:.9f}  pokerkit {s['pokerkit']:.9f}  "
              f"{s['hands']} hands (largest gap {s['largest_hand_difference']:.0e})  ahead {s['split']['ahead']:.4f}  "
              f"{'match' if s['match'] else 'MISMATCH'}")
    for s in result["preflop"]:
        m, o = s["independent_monte_carlo"], s["ours_monte_carlo"]
        print(f"  {s['id']:<36} exact {s['ours_exact']:.5f}  independent MC {m['equity']:.5f} ({m['difference_in_se']:+.2f} SE)"
              f"  our MC {o['equity']:.5f} ({o['difference_in_se']:+.2f} SE)")
    print("All passed." if result["all_passed"] else "FAILED.")
    if not result["all_passed"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
