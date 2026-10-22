# Checks

Each folder holds a script, its saved output (`results.json`) and, where useful,
a README. The [Validation page](../case-study/validation.html) is built from
these outputs.

| Folder | What it checks | Against | Command | Time |
|---|---|---|---|---|
| [`external-pokerkit/`](external-pokerkit/) | Hand order on 20,000 random hands; exact heads-up equity on 7 spots; three-way Monte Carlo | PokerKit 0.7.7 (independent) | `pip install -r checks/external-pokerkit/requirements.txt`, then `python -I checks/external-pokerkit/run.py --check` | ~80 s, all cores |
| [`range-equity-pokerkit/`](range-equity-pokerkit/) | Range notation on 20 texts; exact range equity on 5 flop/turn/river spots; 2 preflop range spots | PokerKit 0.7.7 (independent) | `pip install -r checks/range-equity-pokerkit/requirements.txt`, then `python -I checks/range-equity-pokerkit/run.py --check` | ~25 s, all cores |
| [`equity-accuracy/`](equity-accuracy/) | Monte Carlo error and time against exact enumeration | PokerKit-confirmed exact values | `node checks/equity-accuracy/run.js` | ~5 s |
| [`evaluator-benchmark/`](evaluator-benchmark/) | Earlier and current evaluator: identical scores, speed | Each other, same machine | `node checks/evaluator-benchmark/run.js` | ~25 s |
| [`engine-agreement/`](engine-agreement/) | Web (JS) and research (Python) bankroll engines | Each other and the exact value | `python -I checks/engine-agreement/run.py` | ~30 s |
| [`calculation-change-2026-10-21/`](calculation-change-2026-10-21/README.md) | Every number in the CHANGELOG's calculation-change note | Earlier engine, exact value | `npm run check:calc-change` (runs in CI) | ~7 s |
| [`../standalone/shared/hand-order.json`](../standalone/shared/hand-order.json) | The order of the 169 starting hands behind Top % ranges (equity against one random hand) | Published PokerStove values for the ends (AA 85.2%, 32o 32.3%) | `node scripts/hand_order.js --check` | ~30 s, all cores |
| `functionality-2026-10-05/`, `decision-views-2026-10-05/` | Earlier acceptance records (screenshots, notes) | — | — | — |

Errors and agreement are reproducible from the seeds recorded in each output.
Timings depend on the machine; each output records the CPU and runtime
versions it was measured with. `--write` refreshes a saved output.

Independent means a separate implementation by other authors (PokerKit).
Checks of this repository's code against other code in this repository —
the engine-agreement check and the reference evaluator in
`standalone/engines/test_engines.js` — are internal: they show the
implementations agree, not that the shared model is right.
